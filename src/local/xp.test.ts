import { describe, expect, it } from "vitest"
import { at } from "@/test/db"
import type { XpEventRow } from "./rows"
import { awardFocus, awardMove, comboBonus, computeStats, computeStreak, levelFor, levelStart } from "./xp"

let seq = 0
const ev = (kind: XpEventRow["kind"], created: string, extra: Partial<XpEventRow> = {}): XpEventRow => ({
  id: ++seq,
  kind,
  task_id: seq,
  pomodoro_session_id: null,
  xp: kind === "done" ? 20 : kind === "doing" ? 5 : 15,
  combo: kind === "done" ? 1 : 0,
  bonus: 0,
  created_at: created,
  ...extra,
})

describe("レベル", () => {
  it("L の開始 = 50×L×(L−1)", () => {
    expect([1, 2, 3, 4, 5].map(levelStart)).toEqual([0, 100, 300, 600, 1000])
    expect(levelFor(0)).toBe(1)
    expect(levelFor(99)).toBe(1)
    expect(levelFor(100)).toBe(2)
    expect(levelFor(999)).toBe(4)
  })
})

describe("付与（カードごと初回のみ）とコンボ", () => {
  it("やってる +5 / やった +20、同じカード・同じ kind は 2 回目なし、todo は無し", () => {
    const now = at("2026-09-29T10:00:00")
    expect(awardMove([], 1, "doing", now)?.xp).toBe(5)
    expect(awardMove([], 1, "todo", now)).toBeNull()
    const done = { ...awardMove([], 1, "done", now)!, id: 1 }
    expect(done.xp).toBe(20)
    expect(awardMove([done], 1, "done", now + 1000)).toBeNull()
  })

  it("10 分以内の次の「やった」でコンボ +1、ボーナス 5×(combo−1)・上限 25", () => {
    let events: XpEventRow[] = []
    let t = at("2026-09-29T10:00:00")
    const combos: number[] = []
    for (let id = 1; id <= 8; id++) {
      const a = awardMove(events, id, "done", t)!
      combos.push(a.combo)
      events = [...events, { ...a, id }]
      t += 9 * 60_000
    }
    expect(combos).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(events.map((e) => e.bonus)).toEqual([0, 5, 10, 15, 20, 25, 25, 25])
    expect(comboBonus(100)).toBe(25)
    // 10 分を超えたら 1 から
    expect(awardMove(events, 99, "done", t + 11 * 60_000)!.combo).toBe(1)
  })

  it("集中完了 +15 はセッションごとに 1 回、中断は無し", () => {
    const s = { id: 7, completed: true, task_id: null, ended_at: "2026-09-29T10:25:00+09:00" }
    const a = awardFocus([], s)!
    expect(a.xp).toBe(15)
    expect(awardFocus([{ ...a, id: 1 }], s)).toBeNull()
    expect(awardFocus([], { ...s, completed: false })).toBeNull()
  })
})

describe("連続日数（凍結）", () => {
  const set = (...d: string[]) => new Set(d)
  it("今日まだでも昨日までの連続は生きている", () => {
    const s = computeStreak(set("2026-09-27", "2026-09-28"), "2026-09-29")
    expect(s).toMatchObject({ days: 2, today: false })
  })
  it("1 日休んでも凍結で守る（凍結した日は数えない）", () => {
    const s = computeStreak(set("2026-09-25", "2026-09-26", "2026-09-28", "2026-09-29"), "2026-09-29")
    expect(s.days).toBe(4)
    expect(s.frozen).toEqual(["2026-09-27"])
    expect(s.freezeReady).toBe(false)
  })
  it("凍結は 7 日に 1 回まで", () => {
    // 9/27 と 9/24 の 2 回休み → 新しい方だけ凍結、古い方で途切れる
    const s = computeStreak(set("2026-09-22", "2026-09-23", "2026-09-25", "2026-09-26", "2026-09-28", "2026-09-29"), "2026-09-29")
    expect(s.days).toBe(4)
    expect(s.frozen).toEqual(["2026-09-27"])
  })
  it("2 日連続で休むと途切れる", () => {
    expect(computeStreak(set("2026-09-26"), "2026-09-29").days).toBe(0)
  })
})

describe("computeStats", () => {
  it("累計・今日・レベル・コンボの残り", () => {
    const now = at("2026-09-29T10:05:00")
    const events = [
      ev("doing", "2026-09-28T20:00:00+09:00"),
      ev("done", "2026-09-29T09:58:00+09:00", { xp: 20, combo: 1 }),
      ev("done", "2026-09-29T10:01:00+09:00", { xp: 25, combo: 2, bonus: 5 }),
    ]
    const s = computeStats(events, now)
    expect(s.total_xp).toBe(50)
    expect(s.today_xp).toBe(45)
    expect(s.level).toBe(1)
    expect(s.next_level_at).toBe(100)
    expect(s.streak_days).toBe(2)
    expect(s.combo).toBe(2)
    expect(s.combo_until).toBe("2026-09-29T10:11:00+09:00")
    expect(computeStats(events, now + 10 * 60_000).combo).toBe(0)
  })
})
