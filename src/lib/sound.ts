/**
 * 演出の効果音（WebAudio で合成。音源ファイルなし）。ヘッダーのトグルでオン/オフ（既定オン）。
 * ポモドーロのフェーズ切り替えの合図（lib/timerChime.ts）はタイマーの通知なので「タイマー音」トグルで別。
 * 重低音の「振動」（lib/haptics.ts）も別トグル。AudioContext と出力段（コンプレッサー）は lib/audio.ts で共有。
 */

import { audioOut, getAudio } from "./audio"

const KEY = "dopa:sound"
let enabled = load()
const listeners = new Set<() => void>()

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0"
  } catch {
    return true
  }
}

export function soundEnabled(): boolean {
  return enabled
}

export function setSoundEnabled(v: boolean): void {
  enabled = v
  try {
    localStorage.setItem(KEY, v ? "1" : "0")
  } catch {
    /* 保存できなくても今のタブでは効く */
  }
  listeners.forEach((l) => l())
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface Note {
  freq: number
  /** 開始（秒、今からの相対） */
  at: number
  dur: number
  type?: "sine" | "triangle"
  gain?: number
  /** この周波数へ滑らせる */
  slide?: number
  /** キラキラ（高域）。インパクトの上に小さく重ねるだけ（音量は SPARKLE_MAX で頭打ち） */
  sparkle?: boolean
}

/** キラキラ 1 音の音量上限（主役は低音） */
export const SPARKLE_MAX = 0.035

/**
 * 音を dest に鳴らす。キラキラ以外は 1.2kHz の lowpass を通す（高域だけの軽い音にしない）。
 * OfflineAudioContext でも同じものが描ける（帯域の検証用）。
 */
export function renderNotes(ac: BaseAudioContext, notes: Note[], dest: AudioNode, t0 = ac.currentTime + 0.01): void {
  const master = ac.createGain()
  master.gain.value = 0.6
  master.connect(dest)
  const lp = ac.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 1200
  lp.Q.value = 0.5
  lp.connect(master)
  for (const n of notes) {
    const start = t0 + n.at
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = n.type ?? "triangle"
    osc.frequency.setValueAtTime(n.freq, start)
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, start + n.dur * 0.8)
    const peak = n.sparkle ? Math.min(SPARKLE_MAX, n.gain ?? SPARKLE_MAX) : (n.gain ?? 0.15)
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(peak, start + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
    osc.connect(g).connect(n.sparkle ? master : lp)
    osc.start(start)
    osc.stop(start + n.dur + 0.02)
    osc.onended = () => g.disconnect()
  }
}

function playNotes(notes: Note[]): void {
  if (!enabled) return
  const ac = getAudio()
  if (!ac) return
  renderNotes(ac, notes, audioOut(ac))
}

const semi = (freq: number, n: number) => freq * 2 ** (n / 12)

// 低めの音域（C2〜E4）。主役は 65〜330Hz のトーンで、腹に来る重さを出す
const C2 = 65.41
const G2 = 98
const A2 = 110
const C3 = 130.81
const E3 = 164.81
const G3 = 196
const C4 = 261.63
const E4 = 329.63

/** やってるへ: 下から持ち上がる「ぐいっ」＋パワーコードのスタブ */
export function goNotes(): Note[] {
  return [
    { freq: 82.41, slide: 165, at: 0, dur: 0.2, gain: 0.2 },
    { freq: A2, at: 0.09, dur: 0.3, type: "sine", gain: 0.2 },
    { freq: E3, at: 0.09, dur: 0.26, gain: 0.12 },
    { freq: 220, at: 0.09, dur: 0.22, gain: 0.08 },
    { freq: 1760, at: 0.1, dur: 0.1, type: "sine", sparkle: true, gain: 0.025 },
  ]
}

/** やったへ: 低めのアルペジオ＋ルート。combo が上がるほど高く、キラキラが増える */
export function doneNotes(combo = 1): Note[] {
  const up = Math.min(combo - 1, 6) * 2
  const notes: Note[] = [{ freq: semi(C2, up), at: 0, dur: 0.45, type: "sine", gain: 0.18 }]
  ;[C3, E3, G3, C4].forEach((f, i) => notes.push({ freq: semi(f, up), at: i * 0.065, dur: 0.22, gain: 0.15 }))
  notes.push(
    { freq: semi(C4, up), at: 0.26, dur: 0.35, gain: 0.08 },
    { freq: semi(E4, up), at: 0.26, dur: 0.35, gain: 0.06 },
  )
  if (combo >= 2) {
    for (let i = 0; i < Math.min(combo, 5); i++) {
      // キラキラは 4kHz 未満に収める（段階で上げない）
      notes.push({ freq: semi(2093, i * 2), at: 0.26 + i * 0.05, dur: 0.12, type: "sine", sparkle: true, gain: 0.03 })
    }
  }
  return notes
}

/** XP 獲得: 「ドゥドゥン」（低い 2 音）＋小さなきらり */
export function xpNotes(): Note[] {
  return [
    { freq: G2, at: 0, dur: 0.09, type: "sine", gain: 0.16 },
    { freq: G3, at: 0, dur: 0.09, gain: 0.08 },
    { freq: C3, at: 0.07, dur: 0.3, type: "sine", gain: 0.18 },
    { freq: C4, at: 0.07, dur: 0.28, gain: 0.08 },
    { freq: 2093, at: 0.08, dur: 0.12, type: "sine", sparkle: true, gain: 0.025 },
  ]
}

/** 集中完了: 低いファンファーレ短め */
export function focusNotes(): Note[] {
  return [
    { freq: G2, at: 0, dur: 0.12, gain: 0.16 },
    { freq: G3, at: 0, dur: 0.12, gain: 0.08 },
    { freq: G2, at: 0.13, dur: 0.12, gain: 0.16 },
    { freq: G3, at: 0.13, dur: 0.12, gain: 0.08 },
    { freq: C2, at: 0.26, dur: 0.6, type: "sine", gain: 0.18 },
    { freq: C3, at: 0.26, dur: 0.55, gain: 0.16 },
    { freq: E3, at: 0.26, dur: 0.5, gain: 0.1 },
    { freq: G3, at: 0.26, dur: 0.5, gain: 0.1 },
    { freq: 1568, at: 0.28, dur: 0.18, type: "sine", sparkle: true, gain: 0.03 },
  ]
}

/** レベルアップ: 低いアルペジオ → 厚いコード＋ルート、上に小さなきらきら */
export function levelUpNotes(): Note[] {
  const notes: Note[] = [G2, C3, E3, G3, C4].map((f, i) => ({ freq: f, at: i * 0.09, dur: 0.18, gain: 0.15 }))
  notes.push(
    { freq: C2, at: 0.5, dur: 0.95, type: "sine", gain: 0.2 },
    { freq: C3, at: 0.5, dur: 0.9, gain: 0.16 },
    { freq: E3, at: 0.5, dur: 0.9, gain: 0.11 },
    { freq: G3, at: 0.5, dur: 0.9, gain: 0.11 },
    { freq: C4, at: 0.5, dur: 0.8, gain: 0.08 },
    { freq: 2093, at: 0.52, dur: 0.25, type: "sine", sparkle: true, gain: 0.03 },
    { freq: 2637, at: 0.6, dur: 0.25, type: "sine", sparkle: true, gain: 0.03 },
  )
  return notes
}

export const playGo = (): void => playNotes(goNotes())
export const playDone = (combo = 1): void => playNotes(doneNotes(combo))
export const playXp = (): void => playNotes(xpNotes())
export const playFocus = (): void => playNotes(focusNotes())
export const playLevelUp = (): void => playNotes(levelUpNotes())
