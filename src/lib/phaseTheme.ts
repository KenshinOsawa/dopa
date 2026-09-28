/**
 * ポモドーロのフェーズでアプリ全体の配色を切り替える（色の定義は styles/phase.css）。
 *
 * - 休憩中は <html data-phase="break">（明るいパステル）、集中中・待機中は data-phase="focus"（ネオン暗色）
 * - 切り替えの間だけ <html data-phase-fade> を付けて色をフェード（FADE_MS。reduced-motion は FADE_MS_REDUCED）。
 *   最初の反映（ページを開いたとき）はフェードしない
 */
import type { Pomodoro } from "@/types"

export type ThemePhase = "focus" | "break"

/** styles/phase.css の --kb-fade と揃える */
export const FADE_MS = 1600
export const FADE_MS_REDUCED = 300

/** 休憩フェーズ（計測中・一時停止中）の間は明るいテーマ */
export function themePhaseOf(p: Pick<Pomodoro, "phase"> | undefined | null): ThemePhase {
  return p?.phase === "break" ? "break" : "focus"
}

export function fadeMs(reducedMotion: boolean): number {
  return reducedMotion ? FADE_MS_REDUCED : FADE_MS
}

/** テスト用に差し替えられる最小の要素（document.documentElement） */
export interface ThemeRoot {
  dataset: DOMStringMap
}

let fadeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * テーマ属性を付ける。animate なら data-phase-fade をフェード時間ぶん付けてから外す。
 * 変わらなければ何もしない（false）。
 */
export function applyPhaseTheme(
  root: ThemeRoot,
  phase: ThemePhase,
  opts: { animate: boolean; reducedMotion?: boolean },
): boolean {
  if (root.dataset.phase === phase) return false
  if (fadeTimer != null) {
    clearTimeout(fadeTimer)
    fadeTimer = null
  }
  if (opts.animate) {
    // 同じフレームで付ける（transition は切り替え後のスタイルの transition-property で走る）
    root.dataset.phaseFade = ""
    fadeTimer = setTimeout(() => {
      delete root.dataset.phaseFade
      fadeTimer = null
    }, fadeMs(opts.reducedMotion ?? false) + 150)
  } else {
    delete root.dataset.phaseFade
  }
  root.dataset.phase = phase
  return true
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}
