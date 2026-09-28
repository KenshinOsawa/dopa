import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import * as local from "@/local"
import { errorMessage } from "@/lib/errors"
import { notify, requestNotificationPermission, startTicker } from "@/lib/alert"
import { focusDone } from "@/lib/celebrate"
import { POMO_KEY, XP_KEY } from "@/lib/queryKeys"
import { applyPhaseTheme, prefersReducedMotion, themePhaseOf } from "@/lib/phaseTheme"
import { playChime, unlockTimerAudio } from "@/lib/timerChime"
import type { Pomodoro, PomodoroSettings } from "@/types"

const BASE_TITLE = "dopa"

export type PomodoroAction =
  | { type: "start"; taskId?: number | null }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "skip" }
  | { type: "task"; taskId: number | null }

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

export interface PomodoroView {
  data: Pomodoro | undefined
  /** 残り秒（running 中は now から計算） */
  remaining: number
  /** 計測中: このフェーズが終わるブラウザ時計の時刻（ms）。止まっていれば null */
  endsAt: number | null
  act: (action: PomodoroAction) => void
  saveSettings: (s: PomodoroSettings) => Promise<unknown>
  pending: boolean
}

/**
 * ポモドーロの状態（IndexedDB が正本。開始時刻から計算）。BoardPage で 1 回だけ呼ぶ。
 * - 残り時間 = ends_at − now（setInterval の積算はしない）
 * - 終了時刻に setTimeout と Worker の tick の両方で気づき、合図（音・通知）して次のフェーズへ進める
 * - フェーズの切り替わりでチャイム（休憩へ／集中へで別の音。lib/timerChime.ts）＋通知、タブのタイトルに残り時間
 */
export function usePomodoro(): PomodoroView {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: POMO_KEY,
    queryFn: () => local.pomodoro({ type: "get" }),
    // 時間切れの処理（追いつき）を定期的に
    refetchInterval: 15_000,
  })
  const data = query.data
  const running = data?.status === "running"
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const tick = () => setNow(Date.now())
    const stop = startTicker(tick)
    document.addEventListener("visibilitychange", tick)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", tick)
    }
  }, [running])

  const endsAt = data && running && data.ends_at ? Date.parse(data.ends_at) : null
  const remaining = endsAt != null ? Math.max(0, (endsAt - now) / 1000) : (data?.remaining_sec ?? 0)

  // 終了時刻ちょうどに起こす（Worker の tick が間引かれても・ tick より先に）
  useEffect(() => {
    if (endsAt == null) return
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, endsAt - Date.now()) + 30)
    return () => window.clearTimeout(id)
  }, [endsAt])

  // 終了検知 → 合図して次のフェーズへ（データ層が追いつき計算する）
  const firedFor = useRef<string | null>(null)
  const endedKey = data && running && remaining <= 0 ? data.ends_at : null
  const endedPhase = data?.phase
  const endedTitle = data?.task_title
  const autoCycle = data?.settings.auto_cycle ?? true
  useEffect(() => {
    if (!endedKey || firedFor.current === endedKey) return
    firedFor.current = endedKey
    // 閉じていたタブを後から開いたときの古い終了では鳴らさない
    if (Date.now() - Date.parse(endedKey) < 60_000) {
      if (endedPhase === "focus") {
        const chimed = playChime("toBreak")
        notify("休憩しよう", `${endedTitle ? `${endedTitle} — ` : ""}集中おわり。ひと息つきましょう`)
        focusDone({ quiet: chimed })
      } else {
        playChime("toFocus")
        if (autoCycle) notify("集中スタート", endedTitle ? `${endedTitle} — 次の集中が始まりました` : "次の集中が始まりました")
        else notify("休憩おわり", "次の集中を始めましょう")
      }
    }
    void qc.invalidateQueries({ queryKey: POMO_KEY })
    // 集中完了の +XP（データ層が付与）をヘッダーに出す
    if (endedPhase === "focus") {
      window.setTimeout(() => qc.invalidateQueries({ queryKey: XP_KEY }), 800)
    }
    // 切り替えの計算が時計の端数でわずかに早かった場合の取り直し
    const retry = window.setTimeout(() => qc.invalidateQueries({ queryKey: POMO_KEY }), 1500)
    return () => window.clearTimeout(retry)
  }, [endedKey, endedPhase, endedTitle, autoCycle, qc])

  // 休憩中はアプリ全体を明るいテーマに（最初の反映はフェードしない）
  const themePhase = themePhaseOf(data)
  const themed = useRef(false)
  const loaded = data != null
  useEffect(() => {
    if (!loaded) return
    applyPhaseTheme(document.documentElement, themePhase, {
      animate: themed.current,
      reducedMotion: prefersReducedMotion(),
    })
    themed.current = true
  }, [loaded, themePhase])

  // タブのタイトルに残り時間
  const titleLabel =
    data && data.status !== "idle"
      ? `${data.status === "paused" ? "⏸ " : ""}${formatClock(remaining)} ${data.phase === "focus" ? "集中" : "休憩"} – ${BASE_TITLE}`
      : BASE_TITLE
  useEffect(() => {
    document.title = titleLabel
  }, [titleLabel])
  useEffect(() => () => void (document.title = BASE_TITLE), [])

  const mutation = useMutation({
    mutationFn: (action: PomodoroAction) => local.pomodoro(action),
    onSuccess: (p) => qc.setQueryData(POMO_KEY, p),
    onError: (err) => {
      toast.error(errorMessage(err, "タイマーの操作に失敗しました"))
      void qc.invalidateQueries({ queryKey: POMO_KEY })
    },
  })

  const settingsMutation = useMutation({
    mutationFn: (s: PomodoroSettings) => local.savePomodoroSettings(s),
    onSuccess: () => toast.success("タイマー設定を保存しました"),
    onError: (err) =>
      toast.error(errorMessage(err, "設定の保存に失敗しました")),
    onSettled: () => qc.invalidateQueries({ queryKey: POMO_KEY }),
  })

  function act(action: PomodoroAction) {
    if (action.type === "start") {
      // ユーザー操作の中で音と通知の許可を取っておく（バックグラウンドで鳴らすため）
      unlockTimerAudio()
      requestNotificationPermission()
    }
    mutation.mutate(action)
  }

  return {
    data,
    remaining,
    endsAt,
    act,
    saveSettings: settingsMutation.mutateAsync,
    pending: mutation.isPending || settingsMutation.isPending,
  }
}
