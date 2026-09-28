import type { Task, TaskStatus } from "@/types"

export const STATUSES: TaskStatus[] = ["todo", "doing", "done"]

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "未着手",
  doing: "やってる",
  done: "やった",
}

export interface StatusAccent {
  /** 見出しの丸（グラデ＋グロー） */
  dot: string
  /** ドロップ先の枠 */
  ring: string
  /** ドロップ先の面 */
  bg: string
  /** 見出しのグラデ文字 */
  text: string
  /** カード左端の帯 */
  bar: string
  /** カードのホバー時のネオングロー */
  glow: string
}

/** 未着手 = 紫→青 / やってる = ピンク→オレンジ / やった = ライム→シアン */
export const STATUS_ACCENT: Record<TaskStatus, StatusAccent> = {
  todo: {
    dot: "bg-linear-to-br from-violet-400 to-blue-500 shadow-[0_0_10px_2px_rgb(139_92_246/0.7)] break:from-[#c4b5fd] break:to-[#93c5fd] break:shadow-[0_0_8px_1px_rgb(147_197_253/0.8)]",
    ring: "ring-violet-400/80",
    bg: "bg-violet-500/10 shadow-[0_0_32px_-6px_rgb(139_92_246/0.6)]",
    text: "bg-linear-to-r from-violet-300 to-blue-400",
    bar: "bg-linear-to-b from-violet-400 to-blue-500 break:from-[#c4b5fd] break:to-[#93c5fd]",
    glow: "hover:shadow-[0_0_22px_-4px_rgb(139_92_246/0.75)] hover:border-violet-400/50",
  },
  doing: {
    dot: "bg-linear-to-br from-pink-400 to-orange-400 shadow-[0_0_10px_2px_rgb(255_62_165/0.75)] break:from-[#f9a8d4] break:to-[#fdba74] break:shadow-[0_0_8px_1px_rgb(249_168_212/0.8)]",
    ring: "ring-pink-400/80",
    bg: "bg-pink-500/10 shadow-[0_0_32px_-6px_rgb(255_62_165/0.6)]",
    text: "bg-linear-to-r from-pink-400 to-orange-300",
    bar: "bg-linear-to-b from-pink-500 to-orange-400 break:from-[#f9a8d4] break:to-[#fdba74]",
    glow: "hover:shadow-[0_0_22px_-4px_rgb(255_62_165/0.8)] hover:border-pink-400/50",
  },
  done: {
    dot: "bg-linear-to-br from-lime-300 to-cyan-400 shadow-[0_0_10px_2px_rgb(163_255_60/0.6)] break:from-[#bef264] break:to-[#67e8f9] break:shadow-[0_0_8px_1px_rgb(103_232_249/0.8)]",
    ring: "ring-lime-300/80",
    bg: "bg-lime-400/10 shadow-[0_0_32px_-6px_rgb(163_255_60/0.5)]",
    text: "bg-linear-to-r from-lime-300 to-cyan-300",
    bar: "bg-linear-to-b from-lime-300 to-cyan-400 break:from-[#bef264] break:to-[#67e8f9]",
    glow: "hover:shadow-[0_0_22px_-4px_rgb(34_228_255/0.7)] hover:border-cyan-300/50",
  },
}

export { localDate, toLocalIso } from "./time"
import { localDate } from "./time"

/** 日時はローカルのオフセット付き ISO に揃えてあるので、文字列から直接 HH:MM を取る。 */
export function hhmm(iso: string | null): string {
  return iso ? iso.slice(11, 16) : ""
}

export function isoDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ""
}

export function timeLabel(task: Task): string | null {
  if (!task.start_at) return null
  return task.end_at ? `${hhmm(task.start_at)}–${hhmm(task.end_at)}` : `${hhmm(task.start_at)}〜`
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]

export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  if (date === localDate()) return "今日"
  if (date === localDate(1)) return "明日"
  return `${m}/${d}(${wd})`
}

export function isCalendarLinked(task: Task): boolean {
  return task.source === "calendar" || task.gcal_event_id != null
}

/** データ層の moveTask と同じ並べ替えをキャッシュ上で再現（楽観的更新用）。 */
export function applyMove(
  tasks: Task[],
  id: number,
  status: TaskStatus,
  beforeId: number | null,
): Task[] {
  const moving = tasks.find((t) => t.id === id)
  if (!moving) return tasks
  const column = tasks
    .filter((t) => t.status === status && t.id !== id)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  let index = column.length
  if (beforeId != null) {
    const i = column.findIndex((t) => t.id === beforeId)
    if (i >= 0) index = i
  }
  column.splice(index, 0, { ...moving, status })
  const order = new Map(column.map((t, i) => [t.id, i]))
  return tasks.map((t) =>
    order.has(t.id)
      ? { ...t, status: t.id === id ? status : t.status, sort_order: order.get(t.id)! }
      : t,
  )
}
