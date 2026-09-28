/**
 * ポモドーロタイマー。状態は IndexedDB の 1 行（state ストアの "pomodoro"）で、残り時間は保存しない。
 *
 * - 残り = duration − (elapsed_sec + (now − started_at))。開いた時点の now で計算するので、
 *   タブを閉じていても・リロードしても続く
 * - 集中が時間切れ → セッションを記録して休憩を自動開始。
 *   休憩が時間切れ → 設定「自動で回す」（既定オン）なら休憩の終了時刻から次の集中を自動開始、
 *   オフなら集中に切り替えて「開始」待ち
 * - 各フェーズは前のフェーズの終了時刻から始めるので、閉じている間に何周しても、次に開いた時点で
 *   正しいフェーズ・残り時間に追いつき、その間に完了した集中もそれぞれ 1 回として記録（XP も 1 回ずつ）する
 * - 集中セッション終了（完了、またはスキップ/リセットで 5 分以上経過）で記録し、
 *   設定オン＋カレンダー接続中なら「集中｜<カード名>」を Google カレンダーに書く
 */
import { AppError } from "@/lib/errors"
import { localDate, localIso, msAt } from "@/lib/time"
import type { Pomodoro, PomodoroPhase, PomodoroSettings } from "@/types"
import { broadcast } from "./bus"
import { getDb, locked } from "./db"
import type { PomodoroSessionRow, PomodoroStateRow, TaskRow, XpEventRow } from "./rows"
import { pomodoroSettings, setSettings } from "./settings"
import { awardFocus } from "./xp"

export const MIN_RECORD_SEC = 5 * 60

type Conf = Pick<PomodoroSettings, "focus_minutes" | "break_minutes" | "auto_cycle">

/** 終わった集中（記録対象） */
export interface FinishedFocus {
  task_id: number | null
  started_at: string
  ended_at: string
  focused_sec: number
  completed: boolean
}

export interface Step {
  state: PomodoroStateRow
  finished: FinishedFocus[]
  changed: boolean
}

export const phaseDuration = (conf: Conf, phase: PomodoroPhase) =>
  (phase === "focus" ? conf.focus_minutes : conf.break_minutes) * 60

export function initialState(conf: Conf, nowMs: number): PomodoroStateRow {
  return {
    phase: "focus",
    status: "idle",
    duration_sec: phaseDuration(conf, "focus"),
    elapsed_sec: 0,
    started_at: null,
    phase_started_at: null,
    task_id: null,
    updated_at: localIso(nowMs),
  }
}

export function elapsed(state: PomodoroStateRow, nowMs: number): number {
  let total = state.elapsed_sec
  if (state.status === "running" && state.started_at) total += Math.max(0, (nowMs - Date.parse(state.started_at)) / 1000)
  return total
}

export function remaining(state: PomodoroStateRow, nowMs: number): number {
  return Math.max(0, state.duration_sec - elapsed(state, nowMs))
}

function goIdle(s: PomodoroStateRow, phase: PomodoroPhase, duration: number): void {
  Object.assign(s, { phase, status: "idle", duration_sec: duration, elapsed_sec: 0, started_at: null, phase_started_at: null })
}

function run(s: PomodoroStateRow, phase: PomodoroPhase, duration: number, atMs: number): void {
  const at = localIso(atMs)
  Object.assign(s, { phase, status: "running", duration_sec: duration, elapsed_sec: 0, started_at: at, phase_started_at: at })
}

function finishFocus(s: PomodoroStateRow, endMs: number, focused: number, completed: boolean): FinishedFocus | null {
  if (!completed && focused < MIN_RECORD_SEC) return null
  const started = s.phase_started_at ? Date.parse(s.phase_started_at) : endMs - focused * 1000
  return {
    task_id: s.task_id,
    started_at: localIso(started),
    ended_at: localIso(endMs),
    focused_sec: Math.round(focused),
    completed,
  }
}

/** 時間切れのフェーズを進める（放置中に複数フェーズ分経過していても追いつく）。 */
export function advance(input: PomodoroStateRow, nowMs: number, conf: Conf): Step {
  const s = { ...input }
  const finished: FinishedFocus[] = []
  let changed = false
  // 念のための上限（1 分集中 + 1 分休憩でも 1 年分は追いつける）
  for (let guard = 0; guard < 600_000 && s.status === "running" && elapsed(s, nowMs) >= s.duration_sec; guard++) {
    const endMs = Date.parse(s.started_at!) + (s.duration_sec - s.elapsed_sec) * 1000
    if (s.phase === "focus") {
      const f = finishFocus(s, endMs, s.duration_sec, true)
      if (f) finished.push(f)
      run(s, "break", phaseDuration(conf, "break"), endMs)
    } else if (conf.auto_cycle) {
      run(s, "focus", phaseDuration(conf, "focus"), endMs)
    } else {
      goIdle(s, "focus", phaseDuration(conf, "focus"))
    }
    changed = true
  }
  return { state: s, finished, changed }
}

/** 時間切れ処理を済ませた現在状態。idle 中は設定変更を即反映する。 */
export function current(state: PomodoroStateRow, nowMs: number, conf: Conf): Step {
  const step = advance(state, nowMs, conf)
  if (step.state.status === "idle") {
    const d = phaseDuration(conf, step.state.phase)
    if (d !== step.state.duration_sec) {
      step.state.duration_sec = d
      step.changed = true
    }
  }
  return step
}

/** 未開始なら開始・一時停止中なら再開。setTask なら紐付けカードも変える。 */
export function start(state: PomodoroStateRow, nowMs: number, conf: Conf, taskId?: number | null): Step {
  const step = advance(state, nowMs, conf)
  const s = step.state
  if (taskId !== undefined) s.task_id = taskId
  if (s.status === "idle") run(s, s.phase, phaseDuration(conf, s.phase), nowMs)
  else if (s.status === "paused") {
    s.status = "running"
    s.started_at = localIso(nowMs)
  }
  return { ...step, changed: true }
}

export function pause(state: PomodoroStateRow, nowMs: number, conf: Conf): Step {
  const step = advance(state, nowMs, conf)
  const s = step.state
  if (s.status === "running") {
    s.elapsed_sec = Math.round(elapsed(s, nowMs))
    s.status = "paused"
    s.started_at = null
  }
  return { ...step, changed: true }
}

/** 集中の最初に戻す（5 分以上集中していたら中断として記録）。 */
export function reset(state: PomodoroStateRow, nowMs: number, conf: Conf): Step {
  const step = advance(state, nowMs, conf)
  const s = step.state
  if (s.phase === "focus" && s.status !== "idle") {
    const f = finishFocus(s, nowMs, elapsed(s, nowMs), false)
    if (f) step.finished.push(f)
  }
  goIdle(s, "focus", phaseDuration(conf, "focus"))
  return { ...step, changed: true }
}

/** 次のフェーズへ。集中 → 休憩（自動開始）/ 休憩 → 集中（自動で回す設定なら開始・オフなら待機）。 */
export function skip(state: PomodoroStateRow, nowMs: number, conf: Conf): Step {
  const step = advance(state, nowMs, conf)
  const s = step.state
  if (s.phase === "focus") {
    if (s.status !== "idle") {
      const f = finishFocus(s, nowMs, elapsed(s, nowMs), false)
      if (f) step.finished.push(f)
    }
    run(s, "break", phaseDuration(conf, "break"), nowMs)
  } else if (conf.auto_cycle) {
    run(s, "focus", phaseDuration(conf, "focus"), nowMs)
  } else {
    goIdle(s, "focus", phaseDuration(conf, "focus"))
  }
  return { ...step, changed: true }
}

// ──── 保存・画面向け ────
export type PomodoroAction =
  | { type: "get" }
  | { type: "start"; taskId?: number | null }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "skip" }
  | { type: "task"; taskId: number | null }

/** 集中の記録をカレンダーに書くフック（gcal/sync.ts が登録する） */
type SessionWriter = (sessions: PomodoroSessionRow[]) => Promise<void>
let writeSessions: SessionWriter = async () => undefined
export function setSessionWriter(fn: SessionWriter): void {
  writeSessions = fn
}

function apply(action: PomodoroAction, state: PomodoroStateRow, nowMs: number, conf: Conf): Step {
  switch (action.type) {
    case "get":
      return current(state, nowMs, conf)
    case "start":
      return start(state, nowMs, conf, action.taskId)
    case "pause":
      return pause(state, nowMs, conf)
    case "reset":
      return reset(state, nowMs, conf)
    case "skip":
      return skip(state, nowMs, conf)
    case "task": {
      const step = advance(state, nowMs, conf)
      step.state.task_id = action.taskId
      return { ...step, changed: true }
    }
  }
}

export async function pomodoro(action: PomodoroAction = { type: "get" }, nowMs = Date.now()): Promise<Pomodoro> {
  const conf = await pomodoroSettings()
  const { out, recorded } = await locked(async () => {
    const db = await getDb()
    const tx = db.transaction(["state", "tasks", "sessions", "xp"], "readwrite")
    const stateStore = tx.objectStore("state")
    const tasks = tx.objectStore("tasks")
    const sessions = tx.objectStore("sessions")
    const xp = tx.objectStore("xp")
    const saved = (await stateStore.get("pomodoro"))?.value
    const base = saved ?? initialState(conf, nowMs)
    if ((action.type === "start" || action.type === "task") && action.taskId != null) {
      const t = (await tasks.get(action.taskId)) as TaskRow | undefined
      if (!t || t.deleted_at) throw new AppError("カードが見つかりません")
    }
    const step = apply(action, base, nowMs, conf)
    const recorded: PomodoroSessionRow[] = []
    if (step.finished.length > 0) {
      const events = (await xp.getAll()) as XpEventRow[]
      for (const f of step.finished) {
        const task = f.task_id != null ? ((await tasks.get(f.task_id)) as TaskRow | undefined) : undefined
        const row = {
          ...f,
          task_id: task ? task.id : null,
          task_title: task ? task.title : null,
          gcal_event_id: null,
          created_at: localIso(nowMs),
        }
        const id = (await sessions.add(row as PomodoroSessionRow)) as number
        const session = { ...row, id } as PomodoroSessionRow
        recorded.push(session)
        const award = awardFocus(events, session)
        if (award) {
          const xpId = (await xp.add(award as XpEventRow)) as number
          events.push({ ...award, id: xpId } as XpEventRow)
        }
      }
    }
    const state = step.state
    if (step.changed || !saved) {
      state.updated_at = localIso(nowMs)
      await stateStore.put({ key: "pomodoro", value: state })
    }
    const task = state.task_id != null ? ((await tasks.get(state.task_id)) as TaskRow | undefined) : undefined
    const since = msAt(localDate(0, nowMs))
    let todayCount = 0
    for (const s of (await sessions.getAll()) as PomodoroSessionRow[]) {
      if (s.completed && Date.parse(s.ended_at) >= since) todayCount += 1
    }
    await tx.done
    const left = remaining(state, nowMs)
    const out: Pomodoro = {
      phase: state.phase,
      status: state.status,
      duration_sec: state.duration_sec,
      elapsed_sec: state.elapsed_sec,
      started_at: state.started_at,
      ends_at: state.status === "running" ? localIso(nowMs + left * 1000) : null,
      remaining_sec: left,
      server_now: localIso(nowMs),
      task_id: state.task_id,
      task_title: task && !task.deleted_at ? task.title : null,
      today_count: todayCount,
      settings: conf,
    }
    return { out, recorded }
  })
  if (action.type !== "get") broadcast("pomodoro")
  if (recorded.length > 0) {
    broadcast("pomodoro", "xp")
    if (conf.gcal_enabled) void writeSessions(recorded).catch(() => undefined)
  }
  return out
}

export async function savePomodoroSettings(s: PomodoroSettings): Promise<PomodoroSettings> {
  const valid =
    Number.isInteger(s.focus_minutes) && s.focus_minutes >= 1 && s.focus_minutes <= 180 &&
    Number.isInteger(s.break_minutes) && s.break_minutes >= 1 && s.break_minutes <= 60
  if (!valid) throw new AppError("集中は 1〜180 分、休憩は 1〜60 分で指定してください")
  await setSettings({
    "pomodoro.focus_minutes": s.focus_minutes,
    "pomodoro.break_minutes": s.break_minutes,
    "pomodoro.gcal_enabled": s.gcal_enabled,
    "pomodoro.auto_cycle": s.auto_cycle,
  })
  await pomodoro({ type: "get" }) // idle 中なら新しい長さを反映
  broadcast("pomodoro")
  return pomodoroSettings()
}
