/**
 * ブラウザ内の保存先（IndexedDB）。データはこの端末のこのブラウザの中だけにあり、どこにも送らない。
 *
 * ストア:
 * - tasks     カード（論理削除: deleted_at）
 * - settings  { key, value }（ポモドーロの分数・日報の境界・一言 report.note.YYYY-MM-DD など）
 * - state     { key, value }（ポモドーロの現在状態 key="pomodoro"）
 * - sessions  終わった集中セッション
 * - xp        XP の台帳（追記のみ）
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import type { PomodoroSessionRow, PomodoroStateRow, TaskRow, XpEventRow } from "./rows"

export const DB_NAME = "dopa"
export const DB_VERSION = 1

export interface DopaDB extends DBSchema {
  tasks: { key: number; value: TaskRow; indexes: { status: string; gcal_event_id: string } }
  settings: { key: string; value: { key: string; value: unknown } }
  state: { key: string; value: { key: string; value: PomodoroStateRow } }
  sessions: { key: number; value: PomodoroSessionRow }
  xp: { key: number; value: XpEventRow }
}

export type StoreName = "tasks" | "settings" | "state" | "sessions" | "xp"
export const STORES: StoreName[] = ["tasks", "settings", "state", "sessions", "xp"]

let dbPromise: Promise<IDBPDatabase<DopaDB>> | null = null

export function getDb(): Promise<IDBPDatabase<DopaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DopaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const tasks = db.createObjectStore("tasks", { keyPath: "id", autoIncrement: true })
        tasks.createIndex("status", "status")
        tasks.createIndex("gcal_event_id", "gcal_event_id")
        db.createObjectStore("settings", { keyPath: "key" })
        db.createObjectStore("state", { keyPath: "key" })
        db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true })
        db.createObjectStore("xp", { keyPath: "id", autoIncrement: true })
      },
      blocking() {
        // 別タブが新しい版を開こうとしている → 閉じて譲る（次の操作で開き直す）
        void dbPromise?.then((db) => db.close())
        dbPromise = null
      },
    })
  }
  return dbPromise
}

/** テスト用: 接続を閉じて忘れる（fake-indexeddb を作り直すとき） */
export async function closeDb(): Promise<void> {
  const p = dbPromise
  dbPromise = null
  if (p) (await p).close()
}

// ──── 排他 ────
// 読んで → 計算して → 書く 操作が重ならないように。Web Locks があればタブをまたいで、無ければタブ内で直列化する。
let chain: Promise<unknown> = Promise.resolve()

export function locked<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (locks?.request) return locks.request("dopa-db", () => fn()) as Promise<T>
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}
