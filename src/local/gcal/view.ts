/**
 * カレンダー 1 日ビュー向けの読み書き（旧 calendar_view.py 相当）。
 *
 * - 読み取り: primary の予定を「Google 上の見たまま」全部返す（繰り返し・終日・招待・集中記録も）
 * - 書き込み: 予定がカードに紐付いていれば、カードの start_at / end_at も同じ値にする。
 *   カード由来の予定は buildEventBody で作り直す（次回 push と同じ内容なので巻き戻らない）。
 *   calendar 由来カードは予定を直接 patch し、カードも合わせる。Google が失敗したらカードは変えない
 * - 繰り返し予定はインスタンス ID で操作するので「この回だけ」が変わる
 */
import { AppError } from "@/lib/errors"
import { addDays, localIso, msAt, normalizeIso, timeZone } from "@/lib/time"
import type { CalendarCreateResult, CalendarDay, CalendarEvent, CalendarEventPatch, Task } from "@/types"
import { broadcast } from "../bus"
import { getDb, locked } from "../db"
import type { TaskRow } from "../rows"
import { addRow, normalize, toTask } from "../tasks"
import { authState } from "./auth"
import { getClient, type CalendarClient, type EventBody, type GEvent } from "./client"
import { DONE_PREFIX, isPomodoroEvent, pushOne, saveGcalFields } from "./sync"

export const MAX_DAYS = 14
export const NOT_CONNECTED = "Google カレンダーに接続していません"

function requireClient(): CalendarClient {
  const c = getClient()
  if (!c) throw new AppError(NOT_CONNECTED)
  return c
}

async function tasksByEvent(ids: string[]): Promise<Map<string, TaskRow>> {
  const want = new Set(ids)
  const out = new Map<string, TaskRow>()
  for (const t of await (await getDb()).getAll("tasks")) {
    if (t.deleted_at === null && t.gcal_event_id && want.has(t.gcal_event_id)) out.set(t.gcal_event_id, t)
  }
  return out
}

export function toView(event: GEvent, task: TaskRow | null | undefined): CalendarEvent {
  let title = (event.summary ?? "").trim() || "(無題の予定)"
  const done = task != null && task.status === "done"
  if (done && title.startsWith(DONE_PREFIX)) title = title.slice(DONE_PREFIX.length)
  const me = event.attendees?.find((a) => a.self)
  const organizerIsMe = Boolean(event.organizer?.self) || !event.organizer
  const common = {
    id: event.id,
    title,
    color_id: event.colorId ?? null,
    html_link: event.htmlLink ?? null,
    recurring: Boolean(event.recurringEventId || event.recurrence),
    kind: task != null ? ("card" as const) : isPomodoroEvent(event) ? ("pomodoro" as const) : ("event" as const),
    task_id: task?.id ?? null,
    done,
    response: me?.responseStatus ?? null,
    can_edit: organizerIsMe || Boolean(event.guestsCanModify),
  }
  if (event.start?.dateTime) {
    const s = normalizeIso(event.start.dateTime)!
    const e = normalizeIso(event.end?.dateTime)
    return {
      ...common,
      start: s,
      end: e && Date.parse(e) > Date.parse(s) ? e : s,
      all_day: false,
      start_date: null,
      end_date: null,
    }
  }
  const sDate = event.start?.date ?? ""
  const eDate = event.end?.date ?? addDays(sDate, 1)
  return { ...common, start: null, end: null, all_day: true, start_date: sDate, end_date: eDate }
}

// 勤務場所は Google でも予定の帯としては出ない。キャンセル済みは消えた予定
const visible = (e: GEvent) => e.status !== "cancelled" && e.eventType !== "workingLocation"

export async function listDay(date: string, days = 1): Promise<CalendarDay> {
  const n = Math.max(1, Math.min(days, MAX_DAYS))
  const client = getClient()
  if (!client) {
    const state = authState()
    return {
      logged_in: false,
      message: state === "expired" ? "接続の期限が切れました" : NOT_CONNECTED,
      date,
      days: n,
      events: [],
    }
  }
  const events = (await client.listEvents(localIso(msAt(date)), localIso(msAt(addDays(date, n))))).filter(visible)
  const tasks = await tasksByEvent(events.map((e) => e.id))
  return { logged_in: true, message: null, date, days: n, events: events.map((e) => toView(e, tasks.get(e.id))) }
}

const eventTime = (iso: string) => ({ dateTime: iso, timeZone: timeZone() })

/** 予定のタイトル・時刻を変える。紐付いたカードも同じ値に。Google が失敗したらカードは変えずに例外。 */
export async function patchEvent(id: string, input: CalendarEventPatch, nowMs = Date.now()): Promise<CalendarEvent> {
  if (input.start && input.end && Date.parse(input.end) <= Date.parse(input.start)) {
    throw new AppError("終了は開始より後にしてください")
  }
  const client = requireClient()
  const task = (await tasksByEvent([id])).get(id)
  const title = input.title?.trim()
  if (input.title !== undefined && !title) throw new AppError("タイトルを入力してください")

  if (!task) {
    const body: EventBody = {}
    if (title) body.summary = title
    if (input.start) body.start = eventTime(input.start)
    if (input.end) body.end = eventTime(input.end)
    const event = await client.patch(id, body)
    broadcast("calendar")
    return toView(event, null)
  }

  const next: TaskRow = { ...task }
  if (title) next.title = title
  if (input.start) {
    next.start_at = input.start
    next.date = normalizeIso(input.start)!.slice(0, 10)
  }
  if (input.end) next.end_at = input.end
  normalize(next)
  next.updated_at = localIso(nowMs)

  let event: GEvent | null
  if (task.source === "calendar") {
    // 取り込んだ予定: 予定そのものを直接動かす（✅ 中ならタイトルは退避側を書き換える）
    const body: EventBody = {}
    if (title) {
      if (next.gcal_orig_title !== null) {
        next.gcal_orig_title = title
        body.summary = DONE_PREFIX + title
      } else body.summary = title
    }
    if (input.start) body.start = eventTime(next.start_at!)
    if (input.end) body.end = eventTime(next.end_at!)
    event = await client.patch(id, body)
  } else {
    // カード由来: カードから予定を作り直す
    event = await pushOne(client, next)
  }
  next.gcal_dirty = false
  await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const latest = await tx.store.get(task.id)
    if (latest) {
      await tx.store.put({
        ...latest,
        title: next.title,
        date: next.date,
        start_at: next.start_at,
        end_at: next.end_at,
        gcal_event_id: next.gcal_event_id,
        gcal_orig_title: next.gcal_orig_title,
        gcal_dirty: false,
        updated_at: next.updated_at,
      })
    }
    await tx.done
  })
  broadcast("tasks", "calendar")
  return toView(event ?? (await client.get(id)), next)
}

/** 空き時間から作成: カード（manual / todo / 時刻付き）を作り、予定として書き出す。 */
export async function createEvent(
  input: { title: string; start: string; end: string; note?: string },
  nowMs = Date.now(),
): Promise<CalendarCreateResult> {
  if (Date.parse(input.end) <= Date.parse(input.start)) throw new AppError("終了は開始より後にしてください")
  const client = requireClient()
  const row = await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const store = tx.store as unknown as { add: (v: TaskRow) => Promise<number>; getAll: () => Promise<TaskRow[]> }
    const all = await store.getAll()
    const r = await addRow(
      store,
      all,
      {
        title: input.title,
        note: input.note ?? "",
        status: "todo",
        source: "manual",
        date: normalizeIso(input.start)!.slice(0, 10),
        start_at: input.start,
        end_at: input.end,
      },
      nowMs,
    )
    await tx.done
    return r
  })
  let event: GEvent | null = null
  try {
    event = await pushOne(client, row)
    row.gcal_dirty = false
  } catch {
    row.gcal_dirty = true
  }
  await saveGcalFields(row.id, { gcal_event_id: row.gcal_event_id, gcal_dirty: row.gcal_dirty })
  broadcast("tasks", "calendar")
  const task: Task = toTask(row)
  return { task, event: event ? toView(event, row) : null }
}

/** 予定を消す。紐付いたカードも消す（done の calendar 由来カードは記録として残し連携だけ切る）。 */
export async function deleteEvent(id: string, nowMs = Date.now()): Promise<void> {
  const client = requireClient()
  await client.delete(id) // 失敗したらカードは触らない
  await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    for (const t of await tx.store.getAll()) {
      if (t.deleted_at !== null || t.gcal_event_id !== id) continue
      t.gcal_event_id = null
      t.gcal_dirty = false
      if (!(t.source === "calendar" && t.status === "done")) {
        t.deleted_at = localIso(nowMs)
        t.updated_at = t.deleted_at
      }
      await tx.store.put(t)
    }
    await tx.done
  })
  broadcast("tasks", "calendar")
}
