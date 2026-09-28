import { describe, expect, it } from "vitest"
import { at } from "@/test/db"
import { assembleReport, dayRange, reportDay } from "./report"
import type { TaskRow } from "./rows"
import { newRow } from "./tasks"

let id = 0
const row = (fields: Partial<TaskRow> & { title: string }): TaskRow => ({ ...newRow(fields), id: ++id }) as TaskRow

describe("日報の日（朝 5 時境界）", () => {
  it("5:00 より前は前日", () => {
    expect(reportDay(at("2026-09-29T04:59:00"), 5)).toBe("2026-09-28")
    expect(reportDay(at("2026-09-29T05:00:00"), 5)).toBe("2026-09-29")
    expect(reportDay(at("2026-09-29T00:30:00"), 0)).toBe("2026-09-29")
  })
  it("範囲は その日 5:00 〜 翌日 5:00", () => {
    expect(dayRange("2026-09-29", 5)).toEqual([at("2026-09-29T05:00:00"), at("2026-09-30T05:00:00")])
  })
})

describe("assembleReport", () => {
  const tasks = [
    row({ title: "深夜に終えた", status: "done", done_at: "2026-09-29T02:00:00+09:00" }),
    row({ title: "朝に終えた", status: "done", done_at: "2026-09-29T09:00:00+09:00" }),
    row({ title: "先に終えた", status: "done", done_at: "2026-09-29T06:00:00+09:00" }),
    row({ title: "翌朝 4 時に終えた", status: "done", done_at: "2026-09-30T04:00:00+09:00" }),
    row({ title: "予定から", status: "done", done_at: "2026-09-29T10:00:00+09:00", source: "calendar" }),
    row({ title: "消した", status: "done", done_at: "2026-09-29T10:00:00+09:00", deleted_at: "2026-09-29T11:00:00+09:00" }),
    row({ title: "やってる B", status: "doing", sort_order: 1 }),
    row({ title: "やってる A", status: "doing", sort_order: 0 }),
    row({ title: "未着手 1", status: "todo" }),
  ]

  it("今日: 完了順の ✅・やってる・未着手（列順）、予定由来は既定で除外", () => {
    const r = assembleReport(tasks, { nowMs: at("2026-09-29T23:00:00"), startHour: 5, note: "いい日" })
    expect(r.date).toBe("2026-09-29")
    expect(r.is_today).toBe(true)
    expect(r.done.map((t) => t.title)).toEqual(["先に終えた", "朝に終えた", "翌朝 4 時に終えた"])
    expect(r.excluded_calendar).toBe(1)
    expect(r.text).toBe(
      ["今日やったこと", "✅ 先に終えた", "✅ 朝に終えた", "✅ 翌朝 4 時に終えた", "やってること", "やってる A", "やってる B", "未着手", "未着手 1", "いい日"].join("\n"),
    )
  })

  it("深夜 2 時の完了は前日の日報。過去の日には やってる/未着手 を載せない", () => {
    const r = assembleReport(tasks, { nowMs: at("2026-09-29T23:00:00"), startHour: 5, day: "2026-09-28" })
    expect(r.is_today).toBe(false)
    expect(r.done.map((t) => t.title)).toEqual(["深夜に終えた"])
    expect(r.doing).toEqual([])
    expect(r.text).toBe("今日やったこと\n✅ 深夜に終えた")
  })

  it("予定も含める", () => {
    const r = assembleReport(tasks, { nowMs: at("2026-09-29T23:00:00"), startHour: 5, includeCalendar: true })
    expect(r.done.map((t) => t.title)).toContain("予定から")
    expect(r.excluded_calendar).toBe(0)
  })

  it("境界を 0 時にすると深夜 2 時は当日", () => {
    const r = assembleReport(tasks, { nowMs: at("2026-09-29T23:00:00"), startHour: 0 })
    expect(r.done.map((t) => t.title)[0]).toBe("深夜に終えた")
  })
})
