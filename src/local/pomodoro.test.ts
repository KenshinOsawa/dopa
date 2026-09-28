import { beforeEach, describe, expect, it } from "vitest"
import { at, freshDb } from "@/test/db"
import { localIso } from "@/lib/time"
import { getDb } from "./db"
import { advance, current, initialState, MIN_RECORD_SEC, pause, pomodoro, remaining, reset, skip, start } from "./pomodoro"
import { setSettings } from "./settings"
import { createTask } from "./tasks"
import { getXpStats } from "./xpStats"

const conf = { focus_minutes: 25, break_minutes: 3, auto_cycle: true }
const T0 = at("2026-09-29T10:00:00")
const min = (n: number) => n * 60_000

describe("追いつき計算（純粋関数）", () => {
  it("開始から 26 分後に開く → 休憩中・残り 2 分、集中 1 回を記録（休憩は集中の終了時刻から）", () => {
    const s = start(initialState(conf, T0), T0, conf).state
    const step = advance(s, T0 + min(26), conf)
    expect(step.state.phase).toBe("break")
    expect(step.state.status).toBe("running")
    expect(step.state.started_at).toBe(localIso(T0 + min(25)))
    expect(remaining(step.state, T0 + min(26))).toBeCloseTo(120)
    expect(step.finished).toHaveLength(1)
    expect(step.finished[0]).toMatchObject({ completed: true, focused_sec: 1500, started_at: localIso(T0), ended_at: localIso(T0 + min(25)) })
  })

  it("閉じている間に何周しても正しいフェーズ・残りに追いつき、完了した集中をそれぞれ数える", () => {
    const s = start(initialState(conf, T0), T0, conf).state
    // 28 分 × 3 周 + 10 分 = 94 分後 → 4 周目の集中の 10 分目
    const step = advance(s, T0 + min(94), conf)
    expect(step.finished).toHaveLength(3)
    expect(step.state.phase).toBe("focus")
    expect(step.state.started_at).toBe(localIso(T0 + min(84)))
    expect(remaining(step.state, T0 + min(94))).toBeCloseTo(15 * 60)
  })

  it("自動で回すオフなら、休憩明けは集中の「開始」待ち（idle）", () => {
    const off = { ...conf, auto_cycle: false }
    const s = start(initialState(off, T0), T0, off).state
    const step = advance(s, T0 + min(40), off)
    expect(step.state).toMatchObject({ phase: "focus", status: "idle", duration_sec: 1500 })
    expect(step.finished).toHaveLength(1)
  })

  it("一時停止中は進まない・再開で残りが続く", () => {
    let s = start(initialState(conf, T0), T0, conf).state
    s = pause(s, T0 + min(10), conf).state
    expect(s.elapsed_sec).toBe(600)
    expect(remaining(s, T0 + min(500))).toBe(900)
    s = start(s, T0 + min(500), conf).state
    expect(remaining(s, T0 + min(505))).toBeCloseTo(600)
  })

  it("リセット・スキップ: 5 分以上なら中断として記録、未満は記録しない", () => {
    const s = start(initialState(conf, T0), T0, conf).state
    expect(reset(s, T0 + MIN_RECORD_SEC * 1000 - 1000, conf).finished).toHaveLength(0)
    const r = reset(s, T0 + min(6), conf)
    expect(r.finished[0]).toMatchObject({ completed: false, focused_sec: 360 })
    expect(r.state).toMatchObject({ phase: "focus", status: "idle" })
    const k = skip(s, T0 + min(7), conf)
    expect(k.state).toMatchObject({ phase: "break", status: "running" })
    expect(k.finished[0].completed).toBe(false)
  })

  it("idle 中は設定の変更を即反映", () => {
    const s = initialState(conf, T0)
    const step = current(s, T0, { ...conf, focus_minutes: 50 })
    expect(step.state.duration_sec).toBe(3000)
    expect(step.changed).toBe(true)
  })
})

describe("保存（IndexedDB）", () => {
  beforeEach(freshDb)

  it("開始 → 26 分後に取得: 休憩へ進み、セッション記録と XP +15 が 1 回だけ", async () => {
    const task = await createTask({ title: "資料を読む", status: "doing" }, T0)
    const started = await pomodoro({ type: "start", taskId: task.id }, T0)
    expect(started).toMatchObject({ phase: "focus", status: "running", task_id: task.id, task_title: "資料を読む" })
    expect(started.ends_at).toBe(localIso(T0 + min(25)))

    const later = await pomodoro({ type: "get" }, T0 + min(26))
    expect(later).toMatchObject({ phase: "break", status: "running", today_count: 1 })
    expect(later.remaining_sec).toBeCloseTo(120)
    // もう一度読んでも二重に数えない
    const again = await pomodoro({ type: "get" }, T0 + min(26) + 5000)
    expect(again.today_count).toBe(1)
    const sessions = await (await getDb()).getAll("sessions")
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ task_title: "資料を読む", completed: true, focused_sec: 1500 })
    const stats = await getXpStats(T0 + min(27))
    expect(stats.total_xp).toBe(15) // 作成時の列には XP が付かない。集中完了の +15 だけ
  })

  it("設定の分数が次のフェーズから効く", async () => {
    await setSettings({ "pomodoro.focus_minutes": 1, "pomodoro.break_minutes": 1 })
    await pomodoro({ type: "start" }, T0)
    const p = await pomodoro({ type: "get" }, T0 + min(5) + 30_000)
    // 1+1 分 × 2 周 + 1 分 = 5 分 → 3 周目の休憩の 30 秒目
    expect(p).toMatchObject({ phase: "break", today_count: 3 })
    expect(p.remaining_sec).toBeCloseTo(30)
  })
})
