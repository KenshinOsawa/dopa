import { describe, expect, it } from "vitest"
import { clipToDay, INDENT_PCT, isoAt, layoutEvents, unsyncedCards } from "./calendar"
import type { Task } from "@/types"

const D = "2026-09-28"
const at = (hhmm: string, date = D) => `${date}T${hhmm}:00+09:00`

function task(p: Partial<Task> & { id: number; title: string }): Task {
  return {
    note: "",
    status: "todo",
    sort_order: 0,
    date: D,
    start_at: null,
    end_at: null,
    source: "manual",
    gcal_event_id: null,
    done_at: null,
    created_at: at("00:00"),
    updated_at: at("00:00"),
    ...p,
  }
}

function ev(title: string, start: string, end: string, task_id: number | null = null) {
  return { title, start: at(start), end: at(end), all_day: false, task_id }
}

describe("unsyncedCards（点線の帯）", () => {
  it("予定に紐付いていない時刻付きカードは出す", () => {
    const t = task({ id: 1, title: "資料", start_at: at("10:00"), end_at: at("11:00") })
    expect(unsyncedCards([t], [], D).map((g) => [g.task.id, g.start, g.end])).toEqual([[1, 600, 660]])
  })

  it("予定に紐付いているカードは出さない", () => {
    const t = task({ id: 1, title: "資料", start_at: at("10:00"), end_at: at("11:00") })
    expect(unsyncedCards([t], [ev("資料", "12:00", "13:00", 1)], D)).toEqual([])
  })

  it("calendar 由来のカードは連携が切れていても出さない（done の Lunch・買い出し）", () => {
    const lunch = task({ id: 18, title: "Lunch", status: "done", source: "calendar", start_at: at("13:00"), end_at: at("13:30") })
    expect(unsyncedCards([lunch], [], D)).toEqual([])
  })

  it("同じタイトル（✅ は無視）で時間が重なる予定があれば出さない", () => {
    const lunch = task({ id: 18, title: "Lunch", status: "done", source: "manual", start_at: at("13:00"), end_at: at("13:30") })
    const shopping = task({ id: 17, title: "買い出し", source: "manual", start_at: at("12:45"), end_at: at("13:00") })
    const events = [ev("✅ Lunch", "13:00", "13:30"), ev("✅ 買い出し", "12:50", "13:10")]
    expect(unsyncedCards([lunch, shopping], events, D)).toEqual([])
  })

  it("同じタイトルでも時間が重ならなければ出す／違うタイトルで重なっても出す", () => {
    const a = task({ id: 1, title: "Lunch", start_at: at("18:00"), end_at: at("18:30") })
    const b = task({ id: 2, title: "資料", start_at: at("13:00"), end_at: at("13:30") })
    const events = [ev("✅ Lunch", "13:00", "13:30")]
    expect(unsyncedCards([a, b], events, D).map((g) => g.task.id)).toEqual([1, 2])
  })

  it("終了なしのカードは 1 時間として扱い、別の日は出さない", () => {
    const t = task({ id: 1, title: "x", start_at: at("23:30") })
    const other = task({ id: 2, title: "y", start_at: at("10:00", "2026-09-29") })
    expect(unsyncedCards([t, other], [], D).map((g) => [g.task.id, g.start, g.end, g.whole])).toEqual([
      [1, 1410, 1440, false],
    ])
  })

  it("重なりの列分割は除外の後（除外された点線は列を取らない）", () => {
    const lunch = task({ id: 18, title: "Lunch", source: "manual", start_at: at("13:00"), end_at: at("13:30") })
    const events = [ev("✅ Lunch", "13:00", "13:30")]
    const items = [
      { start: 780, end: 810 }, // Google の Lunch
      ...unsyncedCards([lunch], events, D).map((g) => ({ start: g.start, end: g.end })),
    ]
    expect([...layoutEvents(items).values()].map((p) => p.width)).toEqual([100])
  })
})

describe("clipToDay / isoAt", () => {
  it("日をまたぐ予定はその日の 0:00 / 24:00 で切り、動かせない", () => {
    expect(clipToDay(D, at("23:00", "2026-09-27"), at("07:00"))).toEqual({ start: 0, end: 420, whole: false })
    expect(clipToDay(D, at("23:00"), at("00:00", "2026-09-29"))).toEqual({ start: 1380, end: 1440, whole: true })
    expect(clipToDay(D, at("22:00", "2026-09-27"), at("00:00"))).toBeNull()
  })
  it("1440 分は翌日 0:00", () => {
    expect(isoAt(D, 1440)).toBe("2026-09-29T00:00:00+09:00")
    expect(isoAt(D, 615)).toBe(at("10:15"))
  })
})

describe("layoutEvents（重なりの配置）", () => {
  it("同じ時刻に始まる 30 分の予定 2 本は横に半分ずつ", () => {
    const a = { start: 780, end: 810 }
    const b = { start: 780, end: 810 }
    const l = layoutEvents([a, b])
    expect([l.get(a), l.get(b)].map((p) => [p!.left, p!.width])).toEqual([
      [0, 50],
      [50, 50],
    ])
  })

  it("長い予定の途中から始まる予定は、少しずらして上に重ねる（等分割しない）", () => {
    const long = { start: 540, end: 1320 } // 9:00–22:00
    const a = { start: 720, end: 750 } // 12:00–12:30
    const b = { start: 780, end: 810 } // 13:00–13:30
    const l = layoutEvents([long, a, b])
    expect(l.get(long)).toMatchObject({ left: 0, width: 100 })
    expect(l.get(a)).toMatchObject({ left: INDENT_PCT, width: 100 - INDENT_PCT })
    expect(l.get(b)).toMatchObject({ left: INDENT_PCT, width: 100 - INDENT_PCT })
    expect(l.get(a)!.z).toBeGreaterThan(l.get(long)!.z)
  })

  it("長い予定の途中で同時に始まる 2 本は、字下げした残りを半分ずつ", () => {
    const long = { start: 540, end: 1320 }
    const a = { start: 780, end: 810 }
    const b = { start: 780, end: 810 }
    const l = layoutEvents([long, a, b])
    const w = (100 - INDENT_PCT) / 2
    expect([l.get(a), l.get(b)].map((p) => [p!.left, p!.width])).toEqual([
      [INDENT_PCT, w],
      [INDENT_PCT + w, w],
    ])
  })

  it("重ならない予定は全幅", () => {
    const a = { start: 600, end: 630 }
    const b = { start: 630, end: 660 }
    const l = layoutEvents([a, b])
    expect([l.get(a)!.width, l.get(b)!.width]).toEqual([100, 100])
  })

  it("連続する予定（12:45–13:00 と 13:00–13:30）は重ならない扱いで、どちらも全幅", () => {
    const a = { start: 765, end: 780 }
    const b = { start: 780, end: 810 }
    const c = { start: 810, end: 840 }
    const l = layoutEvents([a, b, c])
    expect([a, b, c].map((x) => [l.get(x)!.left, l.get(x)!.width])).toEqual([
      [0, 100],
      [0, 100],
      [0, 100],
    ])
  })

  it("長い予定の途中で連続する短い予定も、横にはずれず同じ字下げのまま", () => {
    const long = { start: 540, end: 1320 }
    const a = { start: 765, end: 780 }
    const b = { start: 780, end: 810 }
    const l = layoutEvents([long, a, b])
    expect(l.get(a)).toMatchObject({ left: INDENT_PCT, width: 100 - INDENT_PCT })
    expect(l.get(b)).toMatchObject({ left: INDENT_PCT, width: 100 - INDENT_PCT })
  })
})
