/** アプリ設定（settings ストアの KV）。 */
import { getDb } from "./db"
import type { PomodoroSettings } from "@/types"

export const DEFAULTS: Record<string, unknown> = {
  "pomodoro.focus_minutes": 25,
  "pomodoro.break_minutes": 3,
  // 集中した時間を Google カレンダーに記録（既定オフ）
  "pomodoro.gcal_enabled": false,
  // 集中 → 休憩 → 集中 … を止めるまで自動で回す（オフ = 休憩明けは「開始」待ち）
  "pomodoro.auto_cycle": true,
  // 「今日やったこと」の日の境界（ローカル時刻の時。これより前の完了は前日扱い）
  "report.day_start_hour": 5,
  // 最初のウェルカムを出したか
  "app.welcomed": false,
  // 設定画面で入力した OAuth クライアント ID（ビルド時の VITE_GOOGLE_CLIENT_ID が無いとき用）
  "gcal.client_id": "",
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const row = await (await getDb()).get("settings", key)
  return (row === undefined ? DEFAULTS[key] : row.value) as T
}

export async function setSettings(values: Record<string, unknown>): Promise<void> {
  const db = await getDb()
  const tx = db.transaction("settings", "readwrite")
  for (const [key, value] of Object.entries(values)) void tx.store.put({ key, value })
  await tx.done
}

export async function deleteSetting(key: string): Promise<void> {
  await (await getDb()).delete("settings", key)
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

export async function pomodoroSettings(): Promise<PomodoroSettings> {
  return {
    focus_minutes: clampInt(await getSetting("pomodoro.focus_minutes"), 1, 180, 25),
    break_minutes: clampInt(await getSetting("pomodoro.break_minutes"), 1, 60, 3),
    gcal_enabled: Boolean(await getSetting("pomodoro.gcal_enabled")),
    auto_cycle: Boolean(await getSetting("pomodoro.auto_cycle")),
  }
}

export async function dayStartHour(): Promise<number> {
  return clampInt(await getSetting("report.day_start_hour"), 0, 23, 5)
}
