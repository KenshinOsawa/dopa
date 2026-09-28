/** ポモドーロの進みリング（components/pomodoro/ProgressRing）の計算。 */

/** 経過の割合 0〜1（経過で埋まる）。長さ 0 は 0 */
export function ringProgress(durationSec: number, remainingSec: number): number {
  if (!(durationSec > 0)) return 0
  return Math.min(1, Math.max(0, 1 - remainingSec / durationSec))
}

/**
 * stroke-dasharray = 円周 のとき、進み p を描く dashoffset。
 * 線は（-90° 回した）12 時から時計回りに p × 円周 だけ見える
 */
export function ringDashOffset(circumference: number, progress: number): number {
  return circumference * (1 - Math.min(1, Math.max(0, progress)))
}
