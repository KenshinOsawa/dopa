/** カレンダー 1 日ビューの計算（時刻はすべてローカル。日時はローカルのオフセット付き ISO。lib/time.ts） */
import { addDays as addDaysImpl, isoAtMinutes } from "./time"
import type { Task } from "@/types"

/** ボードのカードをカレンダーへ落としたときに Board から呼ばれる（カレンダーの useDroppable の data）。 */
export interface CalendarDropData {
  kind: "calendar"
  onDropTask: (task: Task, clientY: number) => void
}

/** カレンダーの droppable の id は "calendar:" で始まる */
export const isCalendarDropId = (id: unknown) => String(id).startsWith("calendar:")

export const HOUR_PX = 48
export const PX_PER_MIN = HOUR_PX / 60
export const SNAP_MIN = 15
export const DAY_MIN = 24 * 60

/** Google カレンダーの予定の色（colorId → 色）。未指定はカレンダーの既定色（Peacock）。 */
export const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", // Lavender
  "2": "#33b679", // Sage
  "3": "#8e24aa", // Grape
  "4": "#e67c73", // Flamingo
  "5": "#f6bf26", // Banana
  "6": "#f4511e", // Tangerine
  "7": "#039be5", // Peacock
  "8": "#616161", // Graphite
  "9": "#3f51b5", // Blueberry
  "10": "#0b8043", // Basil
  "11": "#d50000", // Tomato
}
export const DEFAULT_EVENT_COLOR = "#039be5"

export function eventColor(colorId: string | null | undefined): string {
  return (colorId && EVENT_COLORS[colorId]) || DEFAULT_EVENT_COLOR
}

/** 明るい色（Banana）は黒文字 */
export function eventTextColor(colorId: string | null | undefined): string {
  return colorId === "5" ? "#1f1f1f" : "#ffffff"
}

/** YYYY-MM-DD に n 日足す */
export const addDays = addDaysImpl

/** ISO（ローカルのオフセット付き）の 0:00 からの分 */
export function minutesOf(iso: string): number {
  return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))
}

/** 日付 + 0:00 からの分 → ローカルのオフセット付き ISO（1440 分 = 翌日 0:00） */
export const isoAt = isoAtMinutes

export function clockLabel(minutes: number): string {
  const m = Math.max(0, Math.min(DAY_MIN, Math.round(minutes)))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
}

export const snap = (minutes: number, step = SNAP_MIN) => Math.round(minutes / step) * step
export const snapDown = (minutes: number, step = SNAP_MIN) => Math.floor(minutes / step) * step
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 予定の [start, end) をその日の分に切り詰める。その日にかからなければ null。
 * 日をまたぐ予定は 0:00 / 24:00 で切る。
 */
export function clipToDay(
  date: string,
  startIso: string,
  endIso: string | null,
): { start: number; end: number; whole: boolean } | null {
  const sDate = startIso.slice(0, 10)
  const eIso = endIso ?? startIso
  const eDate = eIso.slice(0, 10)
  if (sDate > date || eDate < date) return null
  const start = sDate < date ? 0 : minutesOf(startIso)
  const end = eDate > date ? DAY_MIN : minutesOf(eIso)
  if (eDate === date && sDate === date && end < start) return null
  if (eDate === date && end === 0 && sDate < date) return null // 前日 → 今日 0:00 ちょうどで終わる
  // 丸ごとその日の中（翌 0:00 ちょうどに終わるものも含む）なら動かせる
  const whole = sDate === date && (eDate === date || (eDate === addDays(date, 1) && minutesOf(eIso) === 0))
  return { start, end: Math.max(end, start), whole }
}

export interface Placed {
  /** 左端（%） */
  left: number
  /** 幅（%） */
  width: number
  /** 重ね順（後から始まる予定ほど上） */
  z: number
}

/** 開始がこれ未満しか離れていない重なりは、タイトルが隠れるので横に並べる（分） */
export const TITLE_MIN = 25
/** カスケード 1 段ぶんの字下げ（%） */
export const INDENT_PCT = 14
const MAX_DEPTH = 3

/**
 * Google カレンダー風の配置。
 * - 開始が近い（TITLE_MIN 未満）重なりは横に並べて幅を分ける
 * - それより後から始まる重なりは、前の予定の上に少し右へずらして重ねる（カスケード）。
 *   下の予定のタイトルは上端にあるので隠れず、上の予定もほぼ全幅でタイトルが読める
 * 重なりは実際の時刻の半開区間 [start, end) で判定する（12:45–13:00 と 13:00– は重ならない）。
 * 短い帯は表示側で実時間の高さに収める（コンパクト表示）ので、見た目の高さでは判定しない。
 */
export function layoutEvents<T extends { start: number; end: number }>(items: T[]): Map<T, Placed> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  interface Row {
    depth: number
    start: number
    members: { item: T; end: number }[]
  }
  const rows: Row[] = []
  const rowOf = new Map<T, Row>()
  const placed: { item: T; start: number; end: number }[] = []

  for (const item of sorted) {
    const end = Math.max(item.end, item.start + 1) // 0 分の予定も 1 分として扱う
    const over = placed.filter((p) => p.start < end && item.start < p.end)
    // タイトルがぶつかる（開始が近い）重なり → 同じ段に横並び
    const peer = over.find((p) => item.start - p.start < TITLE_MIN)
    if (peer) {
      const row = rowOf.get(peer.item)!
      row.members.push({ item, end })
      rowOf.set(item, row)
    } else {
      const depth = over.length ? Math.min(MAX_DEPTH, Math.max(...over.map((p) => rowOf.get(p.item)!.depth)) + 1) : 0
      const row: Row = { depth, start: item.start, members: [{ item, end }] }
      rows.push(row)
      rowOf.set(item, row)
    }
    placed.push({ item, start: item.start, end })
  }

  const out = new Map<T, Placed>()
  rows.forEach((row, r) => {
    const left = row.depth * INDENT_PCT
    const width = (100 - left) / row.members.length
    row.members.forEach((m, i) => out.set(m.item, { left: left + i * width, width, z: r + 1 }))
  })
  return out
}

const DONE_PREFIX = "✅ "

/** 重複判定用のタイトル（done の「✅ 」や前後の空白を無視） */
export function sameTitleKey(title: string): string {
  const t = title.trim()
  return (t.startsWith(DONE_PREFIX) ? t.slice(DONE_PREFIX.length) : t).trim().toLowerCase()
}

export interface UnsyncedCard {
  task: Task
  start: number
  end: number
  /** 丸ごとその日の中（ドラッグで動かせる） */
  whole: boolean
}

/**
 * 予定になっていない時刻付きカード（点線の帯）。Google の予定と二重に出さないため、次は除く:
 * - 予定に紐付いているカード（events の task_id）
 * - calendar 由来カード（元が Google の予定。連携が切れていても予定側が見えている）
 * - 同じタイトルで時間が重なる予定が既にあるカード
 */
export function unsyncedCards(
  tasks: Task[],
  events: { title: string; start: string | null; end: string | null; all_day: boolean; task_id: number | null }[],
  date: string,
): UnsyncedCard[] {
  const linked = new Set(events.flatMap((e) => (e.task_id != null ? [e.task_id] : [])))
  const timed = events.flatMap((e) => {
    if (e.all_day || !e.start) return []
    const clip = clipToDay(date, e.start, e.end)
    return clip ? [{ key: sameTitleKey(e.title), start: clip.start, end: clip.end }] : []
  })
  const out: UnsyncedCard[] = []
  for (const task of tasks) {
    if (!task.start_at || linked.has(task.id) || task.source === "calendar") continue
    const end = task.end_at ?? isoAt(task.start_at.slice(0, 10), minutesOf(task.start_at) + 60)
    const clip = clipToDay(date, task.start_at, end)
    if (!clip) continue
    const key = sameTitleKey(task.title)
    const dup = timed.some(
      (e) => e.key === key && e.start < Math.max(clip.end, clip.start + 1) && clip.start < Math.max(e.end, e.start + 1),
    )
    if (!dup) out.push({ task, ...clip })
  }
  return out
}
