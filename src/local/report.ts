/**
 * 「今日やったこと」（日報）の組み立て。本文は lib/report.ts の buildReportText。
 *
 * - 「今日」はローカル時刻、境界は朝 report.day_start_hour 時（既定 5。5:00 前の完了は前日扱い）
 * - 判定は done_at（やったへ移した時刻）
 * - doing / todo 列は「今」の状態なので今日の日報にだけ載せる
 * - source=calendar のカードは既定で除外（includeCalendar で含める）
 * - 一言は日付ごとに settings（report.note.YYYY-MM-DD）に保存
 */
import { buildReportText, oneLine } from "@/lib/report"
import { addDays, dateOf, msAt } from "@/lib/time"
import type { Report, ReportItem, ReportNote } from "@/types"
import { broadcast } from "./bus"
import type { TaskRow } from "./rows"
import { dayStartHour, deleteSetting, getSetting, setSettings } from "./settings"
import { listTaskRows } from "./tasks"

export const NOTE_PREFIX = "report.note."

/** now が属する「日報の日」（start_hour 時より前は前日） */
export function reportDay(nowMs: number, startHour: number): string {
  const d = new Date(nowMs)
  const day = dateOf(d)
  return d.getHours() < startHour ? addDays(day, -1) : day
}

/** その日の [開始, 終了) の ms。day の start_hour:00 〜 翌日の start_hour:00（ローカル） */
export function dayRange(day: string, startHour: number): [number, number] {
  return [msAt(day, startHour), msAt(addDays(day, 1), startHour)]
}

const item = (t: TaskRow, withDone = false): ReportItem => ({
  id: t.id,
  title: t.title,
  source: t.source,
  done_at: withDone ? t.done_at : null,
})

/** 純粋関数版（テスト用） */
export function assembleReport(
  tasks: TaskRow[],
  opts: { nowMs: number; startHour: number; day?: string | null; includeCalendar?: boolean; note?: string },
): Report {
  const hour = opts.startHour
  const today = reportDay(opts.nowMs, hour)
  const day = opts.day ?? today
  const [start, end] = dayRange(day, hour)
  const alive = tasks.filter((t) => t.deleted_at === null)
  let done = alive
    .filter((t) => t.status === "done" && t.done_at !== null)
    .filter((t) => {
      const at = Date.parse(t.done_at!)
      return start <= at && at < end
    })
    .sort((a, b) => Date.parse(a.done_at!) - Date.parse(b.done_at!) || a.id - b.id)
  const column = (status: TaskRow["status"]) =>
    alive.filter((t) => t.status === status).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  let doing = day === today ? column("doing") : []
  let todo = day === today ? column("todo") : []
  let excluded = 0
  const include = opts.includeCalendar ?? false
  if (!include) {
    excluded = [...done, ...doing, ...todo].filter((t) => t.source === "calendar").length
    done = done.filter((t) => t.source !== "calendar")
    doing = doing.filter((t) => t.source !== "calendar")
    todo = todo.filter((t) => t.source !== "calendar")
  }
  const note = opts.note ?? ""
  return {
    date: day,
    day_start_hour: hour,
    is_today: day === today,
    include_calendar: include,
    done: done.map((t) => item(t, true)),
    doing: doing.map((t) => item(t)),
    todo: todo.map((t) => item(t)),
    excluded_calendar: excluded,
    note,
    text: buildReportText(
      done.map((t) => t.title),
      doing.map((t) => t.title),
      note,
      todo.map((t) => t.title),
    ),
  }
}

export async function getNote(day: string): Promise<string> {
  const v = await getSetting<unknown>(NOTE_PREFIX + day)
  return typeof v === "string" ? v : ""
}

export async function getReport(day: string | null, includeCalendar: boolean, nowMs = Date.now()): Promise<Report> {
  const hour = await dayStartHour()
  const target = day ?? reportDay(nowMs, hour)
  return assembleReport(await listTaskRows(), {
    nowMs,
    startHour: hour,
    day: target,
    includeCalendar,
    note: await getNote(target),
  })
}

/** 一言を保存。空なら消す。 */
export async function saveNote(day: string, note: string): Promise<ReportNote> {
  const value = oneLine(note)
  if (value) await setSettings({ [NOTE_PREFIX + day]: value })
  else await deleteSetting(NOTE_PREFIX + day)
  broadcast("report")
  return { date: day, note: value }
}

export async function saveDayStartHour(hour: number): Promise<number> {
  const h = Math.min(23, Math.max(0, Math.round(hour)))
  await setSettings({ "report.day_start_hour": h })
  broadcast("report")
  return h
}
