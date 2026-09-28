/**
 * XP・レベル・連続日数・コンボ。台帳（xp ストア）に付与を追記し、表示用の値はすべてそこから計算する。
 *
 * - やってるへ初移動 +5 / やったへ初移動 +20 / 集中完了 +15
 * - カードの XP は kind ごとに 1 回だけ（行ったり来たりで稼げない）
 * - コンボ: 前の「やった」付与から 10 分以内に次の「やった」→ combo+1。ボーナス = 5 × (combo−1)、上限 25
 * - レベル: レベル L の開始 = 50 × L × (L−1) XP（L2=100, L3=300, L4=600, L5=1000 …）
 * - 連続日数: XP を得た日の連続。1 日休んでも「凍結」で途切れない（凍結は 7 日に 1 回まで）
 */
import { addDays, dateOf, localIso } from "@/lib/time"
import type { TaskStatus, XpStats } from "@/types"
import type { XpEventRow } from "./rows"

export const XP_DOING = 5
export const XP_DONE = 20
export const XP_FOCUS = 15
export const COMBO_WINDOW_MS = 10 * 60_000
export const COMBO_STEP = 5
export const COMBO_MAX_BONUS = 25
export const DAILY_GOAL = 200
export const FREEZE_GAP_DAYS = 7

const CARD_KINDS: Partial<Record<TaskStatus, number>> = { doing: XP_DOING, done: XP_DONE }

/** レベル level に到達する累計 XP */
export function levelStart(level: number): number {
  return 50 * level * (level - 1)
}

export function levelFor(total: number): number {
  let level = 1
  while (total >= levelStart(level + 1)) level += 1
  return level
}

export function comboBonus(combo: number): number {
  return Math.min(COMBO_MAX_BONUS, COMBO_STEP * Math.max(0, combo - 1))
}

type NewXp = Omit<XpEventRow, "id">

function lastDone(events: XpEventRow[]): XpEventRow | undefined {
  let last: XpEventRow | undefined
  for (const e of events) if (e.kind === "done" && (!last || e.id > last.id)) last = e
  return last
}

/** カードが status の列へ移ったときの XP。初回だけ（2 回目以降・todo は null）。 */
export function awardMove(events: XpEventRow[], taskId: number, status: TaskStatus, nowMs: number): NewXp | null {
  const base = CARD_KINDS[status]
  if (base == null) return null
  if (events.some((e) => e.kind === status && e.task_id === taskId)) return null
  let combo = 0
  let bonus = 0
  if (status === "done") {
    const prev = lastDone(events)
    const within = prev != null && nowMs - Date.parse(prev.created_at) <= COMBO_WINDOW_MS
    combo = within && prev ? prev.combo + 1 : 1
    bonus = comboBonus(combo)
  }
  return {
    kind: status as "doing" | "done",
    task_id: taskId,
    pomodoro_session_id: null,
    xp: base + bonus,
    combo,
    bonus,
    created_at: localIso(nowMs),
  }
}

/** 集中を時間いっぱい完了したときの XP（セッションごとに 1 回）。 */
export function awardFocus(
  events: XpEventRow[],
  session: { id: number; completed: boolean; task_id: number | null; ended_at: string },
): NewXp | null {
  if (!session.completed) return null
  if (events.some((e) => e.kind === "focus" && e.pomodoro_session_id === session.id)) return null
  return {
    kind: "focus",
    task_id: session.task_id,
    pomodoro_session_id: session.id,
    xp: XP_FOCUS,
    combo: 0,
    bonus: 0,
    created_at: session.ended_at,
  }
}

export interface Streak {
  days: number
  today: boolean
  frozen: string[]
  freezeReady: boolean
}

/**
 * active（XP を得た日 YYYY-MM-DD）から連続日数を出す。今日まだでも昨日までの連続は途切れない。
 * 休んだ日は、その前日が active で、直前（より新しい側）の凍結から 7 日以上離れていれば凍結で守る。
 * 連続日数は active な日だけ数える（凍結した日は数えない）。
 */
export function computeStreak(active: Set<string>, today: string): Streak {
  const result: Streak = { days: 0, today: active.has(today), frozen: [], freezeReady: true }
  let day = result.today ? today : addDays(today, -1)
  let lastFreeze: string | null = null
  const gap = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
  for (;;) {
    if (active.has(day)) {
      result.days += 1
    } else if (
      (result.days > 0 || day === addDays(today, -1)) &&
      active.has(addDays(day, -1)) &&
      (lastFreeze === null || gap(lastFreeze, day) >= FREEZE_GAP_DAYS)
    ) {
      lastFreeze = day
      result.frozen.push(day)
    } else {
      break
    }
    day = addDays(day, -1)
  }
  if (result.days === 0) result.frozen = []
  const newest = result.frozen[0]
  result.freezeReady = newest === undefined || gap(today, newest) >= FREEZE_GAP_DAYS
  return result
}

export function computeStats(events: XpEventRow[], nowMs: number): XpStats {
  const today = dateOf(new Date(nowMs))
  let total = 0
  let todayXp = 0
  const active = new Set<string>()
  let lastId: number | null = null
  let last: { at: number; combo: number } | null = null
  for (const e of events) {
    const at = Date.parse(e.created_at)
    const day = dateOf(new Date(at))
    total += e.xp
    if (e.xp > 0) active.add(day)
    if (day === today) todayXp += e.xp
    if (lastId === null || e.id > lastId) lastId = e.id
    if (e.kind === "done" && (last === null || at >= last.at)) last = { at, combo: e.combo }
  }
  const level = levelFor(total)
  const streak = computeStreak(active, today)
  let combo = 0
  let comboUntil: string | null = null
  if (last && nowMs - last.at <= COMBO_WINDOW_MS) {
    combo = last.combo
    comboUntil = localIso(last.at + COMBO_WINDOW_MS)
  }
  return {
    total_xp: total,
    level,
    level_start: levelStart(level),
    next_level_at: levelStart(level + 1),
    today_xp: todayXp,
    daily_goal: DAILY_GOAL,
    streak_days: streak.days,
    streak_today: streak.today,
    freeze_ready: streak.freezeReady,
    frozen_dates: streak.frozen,
    combo,
    combo_until: comboUntil,
    last_event_id: lastId,
    server_now: localIso(nowMs),
  }
}
