/**
 * ポモドーロのフェーズ切り替えの合図（WebAudio 合成。音源ファイルなし）。旧 lib/alert.ts のビープを置き換え。
 *
 * 2 種類を聞き分けられるように作る:
 * - 休憩へ（集中おわり）= 明るく緩む: 低音の「ドゥン」1 発 → 上行する柔らかい長三和音のチャイム 3 音（C4 → E4 → G4）
 * - 集中へ（休憩おわり）= 引き締まる: 心拍「ドクン」二連打 → 低めの 5 度の和音（D3 + A3 + D4）を短く
 *
 * 耳に刺さらないこと（「ボツボツ」と痛く聞こえない）を最優先に lib/haptics.ts の方針に従う:
 * - アタックは 15ms 以上（トーンは 25ms 以上）、0 からの立ち上げ・0 への減衰は指数で繋いでクリックを出さない
 * - ノイズ（ノック）は使わない。倍音も含めて 3.5kHz 以下（さらに全体を CHIME_LOWPASS で切る）
 * - 音量は haptics の VOLUME（0.35）基準。重なったトーンの合計も VOLUME を超えない
 * - 出力は共有の出力段 audioOut（30Hz HPF → 軽いサチュレーション → コンプレッサー）経由
 *
 * 「タイマー音」トグル（既定オン・localStorage）は効果音・振動トグルとは独立（タイマーの通知なので、
 * 効果音をオフにしていても鳴らせる）。
 * バックグラウンドタブ: 共有 AudioContext が suspended なら resume してから鳴らす。起こせないとき
 * （まだ一度も操作していない等）は鳴らさず、ブラウザ通知だけになる。
 */
import { audioOut, getAudio } from "./audio"
import { ATTACK, beatDo, beatKun, type Hit, MAX_GAIN, renderSpec, VOLUME } from "./haptics"

export type ChimeKind = "toBreak" | "toFocus"

/** チャイムの 1 音（サイン + 少しの整数倍音） */
export interface ChimeTone {
  freq: number
  /** 開始（秒、チャイムの頭から） */
  at: number
  /** 立ち上がり（秒）。ATTACK 以上 */
  attack: number
  /** 消えるまで（秒） */
  decay: number
  /** 音量（0〜1。× VOLUME） */
  gain: number
  /** 倍音（ratio × freq を level の比で重ねる） */
  partials: { ratio: number; level: number }[]
}

export interface Chime {
  /** 重低音の打（lib/haptics の Hit。ノイズ無し） */
  hits: Hit[]
  tones: ChimeTone[]
}

/** トーン全体を切るローパス（Hz） */
export const CHIME_LOWPASS = 3200
/** 倍音も含めて出してよい上限（Hz） */
export const CHIME_MAX_HZ = 3500
/** トーンのアタック（秒）。低音の打（ATTACK = 15ms）より少し長く、柔らかく */
export const TONE_ATTACK = 0.025

const C4 = 261.63
const E4 = 329.63
const G4 = 392
const D3 = 146.83
const A3 = 220
const D4 = 293.66

/** ベル寄りの柔らかい倍音（2 倍・3 倍を薄く） */
const SOFT_BELL = [
  { ratio: 2, level: 0.22 },
  { ratio: 3, level: 0.06 },
]

/** 「ドゥン」: 報酬インパクトより短め・少し軽いボディ */
function doon(at: number, gain: number): Hit {
  return {
    at,
    gain,
    sub: { from: 95, to: 50, drop: 0.1, decay: 0.42 },
    body: { freq: 128, level: 0.9, decay: 0.34 },
    over: { freq: 205, level: 0.22 },
    knock: null,
  }
}

export const CHIMES: Record<ChimeKind, Chime> = {
  /** 集中おわり → 休憩: 「ドゥン」→ 上行する長三和音（ポロン・ポロン・ポローン）。後の音ほど長く残る */
  toBreak: {
    hits: [doon(0, 0.7)],
    tones: [
      { freq: C4, at: 0.3, attack: 0.03, decay: 1.5, gain: 0.26, partials: SOFT_BELL },
      { freq: E4, at: 0.5, attack: 0.03, decay: 1.6, gain: 0.24, partials: SOFT_BELL },
      { freq: G4, at: 0.7, attack: 0.03, decay: 2.0, gain: 0.24, partials: SOFT_BELL },
    ],
  },
  /** 休憩おわり → 集中: 心拍「ドクン」→ 低い 5 度の和音を同時に短く（キュッと締める） */
  toFocus: {
    hits: [beatDo(0, 0.72), beatKun(0.2, 0.62)],
    tones: [
      { freq: D3, at: 0.46, attack: TONE_ATTACK, decay: 0.75, gain: 0.3, partials: [{ ratio: 2, level: 0.18 }] },
      { freq: A3, at: 0.46, attack: TONE_ATTACK, decay: 0.7, gain: 0.22, partials: [{ ratio: 2, level: 0.12 }] },
      { freq: D4, at: 0.46, attack: TONE_ATTACK, decay: 0.65, gain: 0.16, partials: [] },
    ],
  },
}

/** トーンの最大の周波数（倍音込み） */
export function maxToneHz(chime: Chime): number {
  return Math.max(...chime.tones.flatMap((t) => [t.freq, ...t.partials.map((p) => t.freq * p.ratio)]))
}

/** ある瞬間に鳴りうるトーンのピークの合計（× VOLUME 前）。重なっても VOLUME を超えないことの検証用 */
export function peakToneSum(chime: Chime): number {
  const level = (t: ChimeTone) => t.gain * (1 + t.partials.reduce((a, p) => a + p.level, 0))
  return Math.max(
    ...chime.tones.map((probe) =>
      chime.tones
        .filter((t) => t.at <= probe.at + probe.attack && probe.at < t.at + t.decay)
        .reduce((a, t) => a + level(t), 0),
    ),
  )
}

/** 音量で重み付けした平均の高さ（Hz）。聞き分けの目安（休憩へ > 集中へ） */
export function toneCentroid(chime: Chime): number {
  const w = chime.tones.reduce((a, t) => a + t.gain, 0)
  return chime.tones.reduce((a, t) => a + t.freq * t.gain, 0) / w
}

/** チャイム全体の長さ（秒） */
export function chimeLength(chime: Chime): number {
  const hits = chime.hits.map((h) => h.at + Math.max(h.sub.decay, h.body?.decay ?? 0))
  return Math.max(...hits, ...chime.tones.map((t) => t.at + t.decay))
}

/** 指数エンベロープ（0.0001 から attack で peak、decay で 0.0001 へ。最後に 0） */
function envelope(g: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  g.setValueAtTime(0.0001, t)
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
  g.exponentialRampToValueAtTime(0.0001, t + Math.max(attack * 2, decay))
  g.setValueAtTime(0, t + decay + 0.005)
}

/**
 * チャイムを dest に鳴らす（OfflineAudioContext・テストの偽 AudioContext でも同じものが描ける）。
 * トーンは CHIME_LOWPASS の lowpass を通す。重低音の打は haptics.renderSpec（900Hz lowpass）で。
 */
export function renderChime(
  ac: BaseAudioContext,
  chime: Chime,
  dest: AudioNode,
  t0 = ac.currentTime + 0.02,
  volume = VOLUME,
): void {
  if (chime.hits.length) renderSpec(ac, { hits: chime.hits, shake: null, vibrate: [] }, dest, t0, volume)
  const lp = ac.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = CHIME_LOWPASS
  lp.Q.value = 0.5
  lp.connect(dest)
  for (const tone of chime.tones) {
    const start = t0 + tone.at
    const layers = [{ ratio: 1, level: 1 }, ...tone.partials]
    for (const p of layers) {
      const osc = ac.createOscillator()
      osc.type = "sine"
      osc.frequency.setValueAtTime(tone.freq * p.ratio, start)
      const g = ac.createGain()
      // 倍音は少し早く消す（ベルの減衰）
      const decay = p.ratio === 1 ? tone.decay : tone.decay * 0.6
      envelope(g.gain, start, Math.min(MAX_GAIN, tone.gain) * p.level * volume, Math.max(ATTACK, tone.attack), decay)
      osc.connect(g).connect(lp)
      osc.start(start)
      osc.stop(start + decay + 0.02)
      osc.onended = () => g.disconnect()
    }
  }
  const ms = (chimeLength(chime) + 0.2) * 1000
  if (typeof window !== "undefined" && typeof AudioContext !== "undefined" && ac instanceof AudioContext) {
    window.setTimeout(() => lp.disconnect(), ms)
  }
}

// ---------------------------------------------------------------- トグル

const KEY = "dopa:timer-sound"
let enabled = load()
const listeners = new Set<() => void>()

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0"
  } catch {
    return true
  }
}

export function timerSoundEnabled(): boolean {
  return enabled
}

export function setTimerSoundEnabled(v: boolean): void {
  enabled = v
  try {
    localStorage.setItem(KEY, v ? "1" : "0")
  } catch {
    /* 保存できなくても今のタブでは効く */
  }
  listeners.forEach((l) => l())
}

export function subscribeTimerSound(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------- 再生

/** resume を待つ上限（これより遅れて起きたら、ずれた合図になるので鳴らさない） */
const RESUME_WAIT_MS = 3000

/**
 * フェーズ切り替えの合図を鳴らす。タイマー音オフなら何もしない（false）。
 * 鳴らす段取りをした（= 呼び出し側は重ねて別の効果音を鳴らさなくてよい）なら true。
 */
export function playChime(kind: ChimeKind): boolean {
  if (!enabled) return false
  const ac = getAudio()
  if (!ac) return false
  const render = () => {
    try {
      renderChime(ac, CHIMES[kind], audioOut(ac))
    } catch {
      /* WebAudio の失敗でタイマーを止めない */
    }
  }
  if (ac.state === "running") {
    render()
    return true
  }
  // バックグラウンド等で suspended → 起こしてから。起きなければ通知だけ
  const asked = Date.now()
  ac.resume()
    .then(() => {
      if (ac.state === "running" && Date.now() - asked < RESUME_WAIT_MS) render()
    })
    .catch(() => {})
  return true
}

/** 開始ボタン等のユーザー操作の中で呼んで、バックグラウンドでも鳴らせるよう AudioContext を起こしておく */
export function unlockTimerAudio(): void {
  getAudio()
}
