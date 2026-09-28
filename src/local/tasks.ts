/**
 * カード操作（追加・編集・移動・削除・一括取り込み）。
 *
 * - 列内順序は sort_order。移動は before_id の直前（無ければ末尾）に置き、列を振り直す
 * - done に入れた時刻を done_at に（done 内の並べ替えでは変えない・done から出したら null）
 * - 列が変わったら XP（やってる/やった へのカードごと初回だけ）
 * - 削除は論理削除（カレンダー由来カードを消しても次の取り込みで復活させない）
 * - 書き込みの後、カレンダー接続中なら予定へ反映（失敗しても操作は止めない）
 */
import { AppError } from "@/lib/errors"
import { localDate, localIso, normalizeIso } from "@/lib/time"
import type {
  BulkResult,
  CreateTaskInput,
  MoveResult,
  Task,
  TaskSource,
  TaskStatus,
  UpdateTaskInput,
} from "@/types"
import { broadcast } from "./bus"
import { getDb, locked } from "./db"
import { parseText } from "./importer"
import type { TaskRow, XpEventRow } from "./rows"
import { awardMove, computeStats } from "./xp"

/**
 * 書き込み後のフック（カレンダーへの反映）。gcal/sync.ts が登録する（循環 import を避けるため）。
 * 待たない: 画面の操作（演出・XP）はネットワークを待たずに返し、反映が終わったら bus で取り直させる。
 */
type AfterWrite = (ids: number[]) => Promise<void>
let afterWriteHook: AfterWrite = async () => undefined
let pendingPush: Promise<void> = Promise.resolve()
export function setAfterWrite(fn: AfterWrite): void {
  afterWriteHook = fn
}
function afterWrite(ids: number[]): void {
  // 順番どおりに（同じカードの push が追い越さないように）
  pendingPush = pendingPush.then(() => afterWriteHook(ids)).catch(() => undefined)
}
/** テスト用: 裏で走っているカレンダー反映を待つ */
export function flushPush(): Promise<void> {
  return pendingPush
}

const STATUSES: TaskStatus[] = ["todo", "doing", "done"]

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status,
    sort_order: row.sort_order,
    date: row.date,
    start_at: row.start_at,
    end_at: row.end_at,
    source: row.source,
    gcal_event_id: row.gcal_event_id,
    done_at: row.done_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const alive = (t: TaskRow) => t.deleted_at === null
const byOrder = (a: TaskRow, b: TaskRow) => a.sort_order - b.sort_order || a.id - b.id

function cleanTitle(title: string): string {
  const t = (title ?? "").trim()
  if (!t) throw new AppError("タイトルを入力してください")
  return t
}

/** 日付・時刻の整合を取る。start があって date が無ければ start の日付を date に。 */
export function normalize<T extends { date: string | null; start_at: string | null; end_at: string | null }>(task: T): T {
  const start = normalizeIso(task.start_at)
  const end = normalizeIso(task.end_at)
  if (end !== null && start === null) throw new AppError("終了時刻だけの指定はできません（開始時刻も指定してください）")
  if (start !== null && end !== null && Date.parse(end) <= Date.parse(start)) {
    throw new AppError("終了は開始より後にしてください")
  }
  task.start_at = start
  task.end_at = end
  if (start !== null && !task.date) task.date = start.slice(0, 10)
  if (task.date === "") task.date = null
  return task
}

export function newRow(fields: Partial<TaskRow> & { title: string }, nowMs = Date.now()): Omit<TaskRow, "id"> {
  const now = localIso(nowMs)
  return {
    note: "",
    status: "todo",
    sort_order: 0,
    date: null,
    start_at: null,
    end_at: null,
    source: "manual",
    gcal_event_id: null,
    gcal_orig_title: null,
    gcal_orig_color: null,
    gcal_dirty: false,
    done_at: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    ...fields,
  }
}

/** 列の並べ替え（純粋関数。テスト用に公開）。column は移動するカードを除いた同じ列のカード。 */
export function placeInColumn(column: TaskRow[], moving: TaskRow, beforeId: number | null): TaskRow[] {
  const sorted = [...column].sort(byOrder)
  let index = sorted.length
  if (beforeId != null) {
    const i = sorted.findIndex((t) => t.id === beforeId)
    if (i >= 0) index = i
  }
  sorted.splice(index, 0, moving)
  return sorted
}

// ──── 読み取り ────
export async function listTaskRows(): Promise<TaskRow[]> {
  return (await (await getDb()).getAll("tasks")).filter(alive).sort(byOrder)
}

export async function listTasks(): Promise<Task[]> {
  return (await listTaskRows()).map(toTask)
}

export async function getTaskRow(id: number): Promise<TaskRow | undefined> {
  const row = await (await getDb()).get("tasks", id)
  return row && alive(row) ? row : undefined
}

// ──── 内部（ロック内・同じトランザクションで使う） ────
function nextSortOrder(all: TaskRow[], status: TaskStatus): number {
  const col = all.filter((t) => alive(t) && t.status === status)
  return col.length === 0 ? 0 : Math.max(...col.map((t) => t.sort_order)) + 1
}

/** 追加（列末尾）。all は現在の全カード（新しい行も追加される）。 */
export async function addRow(
  store: { add: (v: TaskRow) => Promise<number> },
  all: TaskRow[],
  fields: Partial<TaskRow> & { title: string },
  nowMs = Date.now(),
): Promise<TaskRow> {
  const base = normalize(newRow({ ...fields, title: cleanTitle(fields.title) }, nowMs))
  if (!STATUSES.includes(base.status)) throw new AppError("列が不正です")
  base.done_at = base.status === "done" ? localIso(nowMs) : null
  base.sort_order = nextSortOrder(all, base.status)
  const id = await store.add(base as TaskRow)
  const row = { ...base, id } as TaskRow
  all.push(row)
  return row
}

function moveInTx(
  all: TaskRow[],
  task: TaskRow,
  status: TaskStatus,
  beforeId: number | null,
  nowMs: number,
): TaskRow[] {
  const previous = task.status
  const column = all.filter((t) => alive(t) && t.status === status && t.id !== task.id)
  const ordered = placeInColumn(column, task, beforeId)
  task.status = status
  if (status === "done" && previous !== "done") task.done_at = localIso(nowMs)
  else if (status !== "done") task.done_at = null
  const changed: TaskRow[] = []
  ordered.forEach((t, i) => {
    if (t.sort_order !== i || t === task) {
      t.sort_order = i
      changed.push(t)
    }
  })
  task.updated_at = localIso(nowMs)
  return changed
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tasksStore(tx: { objectStore: (name: "tasks") => any }) {
  return tx.objectStore("tasks") as unknown as {
    add: (v: TaskRow) => Promise<number>
    put: (v: TaskRow) => Promise<number>
    get: (id: number) => Promise<TaskRow | undefined>
    getAll: () => Promise<TaskRow[]>
  }
}

// ──── 書き込み ────
export async function createTask(input: CreateTaskInput, nowMs = Date.now()): Promise<Task> {
  const row = await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const store = tasksStore(tx)
    const all = await store.getAll()
    const task = await addRow(
      store,
      all,
      {
        title: input.title,
        note: input.note ?? "",
        date: input.date ?? null,
        start_at: input.start_at ?? null,
        end_at: input.end_at ?? null,
        status: input.status ?? "todo",
      },
      nowMs,
    )
    if (input.before_id != null) {
      for (const t of moveInTx(all, task, task.status, input.before_id, nowMs)) await store.put(t)
    }
    await tx.done
    return task
  })
  broadcast("tasks")
  afterWrite([row.id])
  return toTask((await getTaskRow(row.id)) ?? row)
}

export async function updateTask(id: number, input: UpdateTaskInput, nowMs = Date.now()): Promise<Task> {
  const row = await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const store = tasksStore(tx)
    const task = await store.get(id)
    if (!task || !alive(task)) throw new AppError("カードが見つかりません")
    const next: TaskRow = { ...task }
    if (input.title !== undefined) next.title = cleanTitle(input.title)
    if (input.note !== undefined) next.note = input.note
    if (input.date !== undefined) next.date = input.date
    if (input.start_at !== undefined) next.start_at = input.start_at
    if (input.end_at !== undefined) next.end_at = input.end_at
    normalize(next)
    next.updated_at = localIso(nowMs)
    await store.put(next)
    await tx.done
    return next
  })
  broadcast("tasks")
  afterWrite([id])
  return toTask((await getTaskRow(id)) ?? row)
}

export async function moveTask(
  id: number,
  status: TaskStatus,
  beforeId: number | null,
  nowMs = Date.now(),
): Promise<MoveResult> {
  if (!STATUSES.includes(status)) throw new AppError("列が不正です")
  const result = await locked(async () => {
    const db = await getDb()
    const tx = db.transaction(["tasks", "xp"], "readwrite")
    const store = tasksStore(tx)
    const xpStore = tx.objectStore("xp")
    const all = await store.getAll()
    const task = all.find((t) => t.id === id)
    if (!task || !alive(task)) throw new AppError("カードが見つかりません")
    const previous = task.status
    for (const t of moveInTx(all, task, status, beforeId, nowMs)) await store.put(t)
    let award: MoveResult["xp"] = null
    if (previous !== status) {
      const events = await xpStore.getAll()
      const add = awardMove(events, id, status, nowMs)
      if (add) {
        const eventId = (await xpStore.add(add as XpEventRow)) as number
        const saved = { ...add, id: eventId } as XpEventRow
        award = {
          event_id: eventId,
          kind: saved.kind,
          xp: saved.xp,
          combo: saved.combo,
          bonus: saved.bonus,
          stats: computeStats([...events, saved], nowMs),
        }
      }
    }
    await tx.done
    return { task, award }
  })
  broadcast("tasks", "xp")
  afterWrite([id])
  return { ...toTask((await getTaskRow(id)) ?? result.task), xp: result.award }
}

export async function deleteTask(id: number, nowMs = Date.now()): Promise<void> {
  await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const store = tasksStore(tx)
    const task = await store.get(id)
    if (!task || !alive(task)) throw new AppError("カードが見つかりません")
    task.deleted_at = localIso(nowMs)
    task.updated_at = task.deleted_at
    await store.put(task)
    await tx.done
  })
  broadcast("tasks")
  afterWrite([id])
}

export interface UpsertItem {
  title: string
  note?: string
  date?: string | null
  start_at?: string | null
  end_at?: string | null
  source?: TaskSource
}

/** 一括投入。同じタイトル＋同じ date の生存カードがあれば更新（二重作成しない。status は動かさない）。 */
export async function upsertMany(items: UpsertItem[], nowMs = Date.now()): Promise<BulkResult> {
  const out = await locked(async () => {
    const db = await getDb()
    const tx = db.transaction("tasks", "readwrite")
    const store = tasksStore(tx)
    const all = await store.getAll()
    const rows: TaskRow[] = []
    let created = 0
    let updated = 0
    for (const item of items) {
      const probe = normalize({
        title: cleanTitle(item.title),
        note: item.note ?? "",
        date: item.date ?? null,
        start_at: item.start_at ?? null,
        end_at: item.end_at ?? null,
      })
      const existing = all
        .filter((t) => alive(t) && t.title === probe.title && (t.date ?? null) === (probe.date ?? null))
        .sort((a, b) => a.id - b.id)[0]
      if (!existing) {
        rows.push(await addRow(store, all, { ...probe, source: item.source ?? "manual" }, nowMs))
        created += 1
        continue
      }
      let changed = false
      if (probe.note && probe.note !== existing.note) {
        existing.note = probe.note
        changed = true
      }
      if (probe.start_at !== null) {
        existing.start_at = probe.start_at
        existing.end_at = probe.end_at
        changed = true
      }
      if (changed) {
        normalize(existing)
        existing.updated_at = localIso(nowMs)
        await store.put(existing)
      }
      rows.push(existing)
      updated += 1
    }
    await tx.done
    return { rows, created, updated }
  })
  broadcast("tasks")
  afterWrite(out.rows.map((r) => r.id))
  return { created: out.created, updated: out.updated, tasks: out.rows.map(toTask) }
}

/** 「テキストから一括」 */
export async function importText(text: string, date: string | null, nowMs = Date.now()): Promise<BulkResult> {
  const items = parseText(text, date, localDate(0, nowMs))
  if (items.length === 0) throw new AppError("取り込めるカードがありませんでした")
  return upsertMany(items.map((p) => ({ ...p, source: "manual" as const })), nowMs)
}
