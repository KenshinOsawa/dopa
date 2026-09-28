/**
 * カード ⇄ Google カレンダーの同期（旧 gcal_sync.py 相当。ブラウザから直接 API を叩く）。
 *
 * - push（カード → 予定）: start_at を持つ source!=calendar のカードを予定として作成・更新・削除。
 *   予定の description に「dopa card #id」印、extendedProperties.private に dopa=1 / cardId を入れて自作予定を識別。
 *   done なら「✅ 」＋ colorId=8
 * - done マーク（calendar 由来カード）: done に移すと予定タイトル先頭に「✅ 」＋ colorId=8。
 *   元のタイトル・色は gcal_orig_* に退避し、done から戻したら復元する
 * - pull（予定 → カード）: 今日〜7 日後の単発・時刻付きの予定を todo にカード化（gcal_event_id で冪等）。
 *   繰り返し予定・終日予定は取り込まない。時刻変更は反映、予定が消えた/辞退したら（done 以外の）カードを削除
 * - 失敗や未接続でカード操作は止めない。一度でも接続した端末では gcal_dirty を立てて次回同期で再送
 */
import { localDate, localIso, msAt, normalizeIso, timeZone } from "@/lib/time"
import { broadcast } from "../bus"
import { getDb, locked } from "../db"
import { setSessionWriter } from "../pomodoro"
import type { PomodoroSessionRow, TaskRow } from "../rows"
import { addRow, normalize, setAfterWrite } from "../tasks"
import { wasConnected } from "./auth"
import { getClient, NotFound, type CalendarClient, type EventBody, type GEvent } from "./client"

export const MARK = "dopa"
export const DONE_PREFIX = "✅ "
export const DONE_COLOR = "8" // graphite
export const WINDOW_DAYS = 7
const DEFAULT_DURATION_MS = 60 * 60_000
export const POMODORO_MARK = "dopa pomodoro"
const POMODORO_COLOR = "11" // tomato

export const syncState: { last_sync_at: string | null; last_error: string | null } = {
  last_sync_at: null,
  last_error: null,
}

// ──── 予定 ⇄ カード変換 ────
const eventTime = (iso: string) => ({ dateTime: iso, timeZone: timeZone() })

export function buildEventBody(task: TaskRow): EventBody {
  const start = task.start_at!
  const end = task.end_at ?? localIso(Date.parse(start) + DEFAULT_DURATION_MS)
  const done = task.status === "done"
  const marker = `── ${MARK} card #${task.id}`
  return {
    summary: done ? DONE_PREFIX + task.title : task.title,
    description: task.note ? `${task.note}\n\n${marker}` : marker,
    start: eventTime(start),
    end: eventTime(end),
    colorId: done ? DONE_COLOR : null,
    extendedProperties: { private: { dopa: "1", cardId: String(task.id) } },
  }
}

export function isOwnEvent(event: GEvent): boolean {
  if (event.extendedProperties?.private?.dopa === "1") return true
  return (event.description ?? "").includes(`${MARK} card #`)
}

export function isPomodoroEvent(event: GEvent): boolean {
  if (event.extendedProperties?.private?.pomodoro === "1") return true
  return (event.description ?? "").includes(POMODORO_MARK)
}

/**
 * 単発の時刻付き予定だけ取り込む。
 * 除外: 繰り返し予定・終日予定・辞退した予定・自分主催でない無回答の招待・キャンセル済み・勤務場所。
 */
export function shouldImport(event: GEvent): boolean {
  if (event.status === "cancelled") return false
  if (event.eventType === "workingLocation") return false
  if (event.recurringEventId || event.recurrence) return false
  if (!event.start?.dateTime) return false
  const me = event.attendees?.find((a) => a.self)
  if (me) {
    if (me.responseStatus === "declined") return false
    if (me.responseStatus === "needsAction" && !event.organizer?.self) return false
  }
  return true
}

export function eventFields(event: GEvent): Pick<TaskRow, "title" | "date" | "start_at" | "end_at"> {
  const title = (event.summary ?? "").trim() || "(無題の予定)"
  if (event.start?.dateTime) {
    const s = normalizeIso(event.start.dateTime)!
    const e = normalizeIso(event.end?.dateTime)
    return { title, date: s.slice(0, 10), start_at: s, end_at: e && Date.parse(e) > Date.parse(s) ? e : null }
  }
  return { title, date: event.start?.date ?? null, start_at: null, end_at: null }
}

// ──── push ────
export function needsPush(task: TaskRow): boolean {
  if (task.source === "calendar") {
    if (task.gcal_event_id === null || task.deleted_at !== null) return false
    const marked = task.gcal_orig_title !== null
    return (task.status === "done") !== marked
  }
  return task.start_at !== null || task.gcal_event_id !== null
}

async function applyDoneMark(client: CalendarClient, task: TaskRow): Promise<void> {
  const id = task.gcal_event_id!
  try {
    if (task.status === "done" && task.gcal_orig_title === null) {
      const event = await client.get(id)
      const summary = event.summary ?? ""
      const original = summary.startsWith(DONE_PREFIX) ? summary.slice(DONE_PREFIX.length) : summary
      await client.patch(id, { summary: DONE_PREFIX + original, colorId: DONE_COLOR })
      task.gcal_orig_title = original
      task.gcal_orig_color = event.colorId ?? null
    } else if (task.status !== "done" && task.gcal_orig_title !== null) {
      await client.patch(id, { summary: task.gcal_orig_title, colorId: task.gcal_orig_color })
      task.gcal_orig_title = null
      task.gcal_orig_color = null
    }
  } catch (e) {
    if (!(e instanceof NotFound)) throw e // 予定が消えている → 次の pull でカード側を整理
  }
}

/** カードを予定へ反映（task の gcal_* を書き換える）。作成・更新した予定を返す（削除・done マークは null）。 */
export async function pushOne(client: CalendarClient, task: TaskRow): Promise<GEvent | null> {
  if (task.source === "calendar") {
    if (task.gcal_event_id && task.deleted_at === null) await applyDoneMark(client, task)
    return null // calendar 由来カードを消しても元の予定は消さない
  }
  if (task.deleted_at !== null || task.start_at === null) {
    if (task.gcal_event_id) {
      await client.delete(task.gcal_event_id)
      task.gcal_event_id = null
    }
    return null
  }
  const body = buildEventBody(task)
  if (task.gcal_event_id) {
    try {
      return await client.patch(task.gcal_event_id, body)
    } catch (e) {
      if (!(e instanceof NotFound)) throw e // カレンダー側で消された → 作り直す
    }
  }
  const event = await client.insert(body)
  task.gcal_event_id = event.id
  return event
}

type GcalFields = Pick<TaskRow, "gcal_event_id" | "gcal_orig_title" | "gcal_orig_color" | "gcal_dirty">

/** 同期の結果（gcal_* だけ）を最新の行に書き戻す（ネットワーク待ちの間に他の項目が変わっていても消さない） */
export async function saveGcalFields(id: number, fields: Partial<GcalFields>): Promise<void> {
  await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const row = await tx.store.get(id)
    if (row) await tx.store.put({ ...row, ...fields })
    await tx.done
  })
}

const pick = (t: TaskRow): GcalFields => ({
  gcal_event_id: t.gcal_event_id,
  gcal_orig_title: t.gcal_orig_title,
  gcal_orig_color: t.gcal_orig_color,
  gcal_dirty: t.gcal_dirty,
})

/** カード操作の直後に呼ぶ。失敗しても例外は投げない。 */
export async function pushTask(id: number, client: CalendarClient | null = getClient()): Promise<void> {
  const task = await (await getDb()).get("tasks", id)
  if (!task) return
  if (!needsPush(task)) {
    if (task.gcal_dirty) await saveGcalFields(id, { gcal_dirty: false })
    return
  }
  if (client === null) {
    // 一度も接続していない端末では溜めない（接続したら点線の帯から予定にできる）
    if (wasConnected() && !task.gcal_dirty) await saveGcalFields(id, { gcal_dirty: true })
    return
  }
  try {
    await pushOne(client, task)
    task.gcal_dirty = false
  } catch (e) {
    syncState.last_error = e instanceof Error ? e.message : String(e)
    task.gcal_dirty = true
  }
  await saveGcalFields(id, pick(task))
  broadcast("tasks", "calendar")
}

export async function pushTaskIds(ids: number[]): Promise<void> {
  const client = getClient()
  for (const id of ids) await pushTask(id, client)
}

// ──── pull ────
export interface PullResult {
  created: number
  updated: number
  removed: number
}

export async function pull(client: CalendarClient, nowMs = Date.now()): Promise<PullResult> {
  const today = localDate(0, nowMs)
  const timeMin = localIso(msAt(today))
  const timeMax = localIso(msAt(localDate(WINDOW_DAYS + 1, nowMs)))
  const events = await client.listEvents(timeMin, timeMax)
  const windowEnd = localDate(WINDOW_DAYS, nowMs)

  const result = await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const store = tx.store as unknown as {
      add: (v: TaskRow) => Promise<number>
      put: (v: TaskRow) => Promise<number>
      getAll: () => Promise<TaskRow[]>
    }
    const all = await store.getAll()
    let created = 0
    let updated = 0
    let removed = 0
    const seen = new Set<string>()
    for (const event of events) {
      // 自作予定（カード由来・集中の記録）はカードに取り込まない
      if (isOwnEvent(event) || isPomodoroEvent(event) || !shouldImport(event)) continue
      seen.add(event.id)
      const fields = eventFields(event)
      const existing = all.find((t) => t.gcal_event_id === event.id)
      if (!existing) {
        await addRow(store, all, { ...fields, source: "calendar", status: "todo", gcal_event_id: event.id }, nowMs)
        created += 1
        continue
      }
      if (existing.deleted_at !== null) continue // ボードから消したカードは復活させない
      if (existing.gcal_orig_title !== null && fields.title.startsWith(DONE_PREFIX)) {
        fields.title = fields.title.slice(DONE_PREFIX.length)
      }
      const same = (a: string | null, b: string | null) =>
        a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b))
      const changed =
        existing.title !== fields.title ||
        existing.date !== fields.date ||
        !same(existing.start_at, fields.start_at) ||
        !same(existing.end_at, fields.end_at)
      if (changed) {
        Object.assign(existing, fields)
        normalize(existing)
        existing.updated_at = localIso(nowMs)
        await store.put(existing)
        updated += 1
      }
    }
    // 窓内にあったはずの calendar 由来カードで、予定が消えた/辞退したものを片付ける
    for (const task of all) {
      if (task.source !== "calendar" || task.deleted_at !== null || task.gcal_event_id === null) continue
      if (task.date === null || task.date < today || task.date > windowEnd) continue
      if (seen.has(task.gcal_event_id)) continue
      if (task.status === "done") {
        task.gcal_event_id = null // やった記録は残し、連携だけ切る
      } else {
        task.deleted_at = localIso(nowMs)
        task.updated_at = task.deleted_at
        removed += 1
      }
      await store.put(task)
    }
    await tx.done
    return { created, updated, removed }
  })
  broadcast("tasks", "calendar")
  return result
}

export interface SyncResult extends PullResult {
  logged_in: boolean
  pushed: number
}

/** 未送信（dirty）の push → pull。未接続なら logged_in: false。 */
export async function syncAll(client: CalendarClient | null = getClient(), nowMs = Date.now()): Promise<SyncResult> {
  if (client === null) return { logged_in: false, pushed: 0, created: 0, updated: 0, removed: 0 }
  try {
    const dirty = (await (await getDb()).getAll("tasks")).filter((t) => t.gcal_dirty)
    for (const t of dirty) await pushTask(t.id, client)
    const result = await pull(client, nowMs)
    syncState.last_sync_at = localIso(nowMs)
    syncState.last_error = null
    return { logged_in: true, pushed: dirty.length, ...result }
  } catch (e) {
    syncState.last_error = e instanceof Error ? e.message : String(e)
    throw e
  }
}

// ──── 集中の記録 ────
export function buildPomodoroBody(s: PomodoroSessionRow): EventBody {
  const lines = [`── ${POMODORO_MARK}`]
  if (s.task_id !== null) lines.push(`card id: ${s.task_id}`)
  lines.push(`集中 ${Math.round(s.focused_sec / 60)} 分${s.completed ? "" : "（中断）"}`)
  const priv: Record<string, string> = { dopa: "1", pomodoro: "1" }
  if (s.task_id !== null) priv.cardId = String(s.task_id)
  return {
    summary: s.task_title ? `集中｜${s.task_title}` : "集中",
    description: lines.join("\n"),
    start: eventTime(s.started_at),
    end: eventTime(s.ended_at),
    colorId: POMODORO_COLOR,
    extendedProperties: { private: priv },
  }
}

/** 設定オン・接続中のときだけ書く。未接続・失敗は黙ってスキップ（同期エラーにしない）。 */
export async function writeSessions(sessions: PomodoroSessionRow[], client: CalendarClient | null = getClient()): Promise<void> {
  if (client === null) return
  for (const s of sessions) {
    try {
      const event = await client.insert(buildPomodoroBody(s))
      await locked(async () => {
        const db = await getDb()
        const row = await db.get("sessions", s.id)
        if (row) await db.put("sessions", { ...row, gcal_event_id: event.id })
      })
    } catch {
      /* 記録は黙ってスキップ */
    }
  }
  broadcast("calendar")
}

/** tasks / pomodoro の書き込みフックに登録（アプリ起動時に 1 回） */
export function installGcalHooks(): void {
  setAfterWrite(pushTaskIds)
  setSessionWriter(writeSessions)
}
