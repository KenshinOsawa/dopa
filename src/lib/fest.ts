/**
 * 「やった」のフェス演出（TASK CLEAR ショー）の設計値。純粋関数だけ（DOM・WebAudio の実体は lib/festShow.ts）。
 *
 * 流れ（BPM 128 の拍に合わせる。1 拍 ≈ 469ms）:
 *   ① 暗転＋ビルドアップ（1.5 拍）: サーチライトが左右にスイープ・ボードの色が 8 分で脈打つ・ライザー
 *   ② ドロップ: 白フラッシュ＋「TASK CLEAR!!」とタスク名・重低音インパクト・画面全体の揺れ
 *   ③ 花火の連発（半拍ごと）＋下からのレーザー（扇状に交差・回転）＋紙吹雪の雨・歓声・拍のキック
 *   ④ XP の大きなカウントアップ＋コンボ → フェードアウト
 * コンボで段階的に派手に（レーザー本数・花火の発数・持続・色数）。5 コンボ以上は FEVER（虹色）。
 * reduced-motion: 揺れ・フラッシュ・レーザー・サーチライト・花火なし。静的な文字＋控えめな紙吹雪だけ。
 */
import { outputs, SUB_LEVEL, VOLUME, type HapticSpec, type Hit } from "./haptics"

export const BPM = 128
/** 1 拍（ms） */
export const BEAT_MS = 60_000 / BPM
/** ビルドアップの長さ（= ドロップの時刻）。1.5 拍 */
export const DROP_MS = Math.round(BEAT_MS * 1.5)
/** フェードアウトの長さ */
export const FADE_MS = 500
/** スキップ（クリック・Esc・次の操作）のフェード */
export const SKIP_FADE_MS = 220
/** FEVER になるコンボ */
export const FEVER_COMBO = 5

const RAINBOW = ["#ff3ea5", "#ff8a1f", "#ffd23f", "#a3ff3c", "#22e4ff", "#3b82f6", "#a855f7"]
/** コンボ段階で増えていく色（先頭から使う） */
const LADDER = ["#a3ff3c", "#22e4ff", "#ffffff", "#ff3ea5", "#a855f7", "#ffd23f"]

export interface FestTier {
  combo: number
  fever: boolean
  /** レーザーの本数（左右 2 か所から扇状に） */
  lasers: number
  /** 花火の発数（半拍ごと） */
  fireworks: number
  /** 花火 1 発の粒数 */
  particles: number
  /** 紙吹雪の雨（上から降らせる回数） */
  rain: number
  colors: string[]
  /** ショー全体の長さ（ms、フェードアウト込み） */
  durationMs: number
  /** ドロップ後に拍で明滅する回数 */
  pulses: number
  /** ドロップ後、拍に合わせたキックの数 */
  kicks: number
  /** ドロップの画面揺れ（px） */
  shakePx: number
}

/** コンボ（1〜）の段階。6 以上は 6 と同じ */
export function festTier(combo: number): FestTier {
  const c = Math.max(1, Math.min(6, Math.floor(combo) || 1))
  const fever = c >= FEVER_COMBO
  const step = c - 1 // 0〜5
  return {
    combo: Math.max(1, Math.floor(combo) || 1),
    fever,
    lasers: fever ? 12 + (c - FEVER_COMBO) * 2 : 4 + step * 2, // 4,6,8,10 → 12,14
    fireworks: fever ? 8 + (c - FEVER_COMBO) : 3 + step, // 3,4,5,6 → 8,9
    particles: fever ? 64 : 48 + step * 4,
    rain: fever ? 4 : step >= 2 ? 3 : 2,
    colors: fever ? RAINBOW : LADDER.slice(0, 3 + step),
    durationMs: fever ? 4000 : 3200 + step * 200, // 3.2 → 3.8 → FEVER 4.0 秒
    pulses: c >= 3 ? 3 : 2,
    kicks: Math.min(4, 1 + c),
    shakePx: fever ? 9 : 5 + step,
  }
}

export interface FestTimeline {
  /** ドロップ（フラッシュ・タイトル・インパクト） */
  drop: number
  /** 白フラッシュの長さ（0 なら無し） */
  flashMs: number
  /** ビルドアップ中の 8 分の脈打ち（ドロップまでの時刻） */
  buildPulses: number[]
  /** ドロップ後の拍の明滅 */
  beatPulses: number[]
  /** 花火の発射時刻 */
  fireworks: number[]
  /** 紙吹雪の雨 */
  rain: number[]
  /** キック（ドロップ後の拍） */
  kicks: number[]
  /** XP カウントアップの開始と長さ */
  xpAt: number
  xpMs: number
  /** フェードアウト開始・終了（= 全体の長さ） */
  fadeAt: number
  end: number
  /** サーチライト・レーザー・揺れ・フラッシュを出すか */
  lights: boolean
  lasers: number
  searchlights: boolean
  shake: boolean
  /** 文字のアニメーション（ズーム・グリッチ）。false ならフェードだけ */
  textMotion: boolean
}

/** ショーのタイムライン（ms、ショー開始 = 0） */
export function festTimeline(tier: FestTier, reducedMotion = false): FestTimeline {
  const beat = BEAT_MS
  if (reducedMotion) {
    // 暗転もビルドアップも無し。文字は静かに出て消える・紙吹雪は 1 回だけ控えめに
    const end = 2400
    return {
      drop: 0,
      flashMs: 0,
      buildPulses: [],
      beatPulses: [],
      fireworks: [],
      rain: [0],
      kicks: [1, 2].slice(0, Math.min(2, tier.kicks)).map((k) => Math.round(k * beat)),
      xpAt: 300,
      xpMs: 0,
      fadeAt: end - FADE_MS,
      end,
      lights: false,
      lasers: 0,
      searchlights: false,
      shake: false,
      textMotion: false,
    }
  }
  const drop = DROP_MS
  const half = beat / 2
  const end = tier.durationMs
  const fadeAt = end - FADE_MS
  const r = (x: number) => Math.round(x)
  return {
    drop,
    flashMs: 200,
    // 8 分（半拍）で 3 回。だんだん強く（DOM 側で強さを上げる）
    buildPulses: [0, 1, 2].map((i) => r(drop - (3 - i) * half)),
    beatPulses: Array.from({ length: tier.pulses }, (_, i) => r(drop + i * beat)),
    fireworks: Array.from({ length: tier.fireworks }, (_, i) => r(drop + 80 + i * (tier.fever ? half * 0.75 : half))).filter(
      (t) => t < fadeAt - 300,
    ),
    rain: Array.from({ length: tier.rain }, (_, i) => r(drop + beat * (0.5 + i * 0.75))),
    kicks: Array.from({ length: tier.kicks }, (_, i) => r(drop + (i + 1) * beat)),
    xpAt: r(drop + beat * 1.5),
    xpMs: 700,
    fadeAt,
    end,
    lights: true,
    lasers: tier.lasers,
    searchlights: true,
    shake: true,
    textMotion: true,
  }
}

// ---------------------------------------------------------------- 出力（トグルの組み合わせ）

export interface FestOutputs {
  /** ライザー・歓声・ドロップの和音（効果音トグル） */
  riser: boolean
  crowd: boolean
  chord: boolean
  /** ドロップのインパクト＋キック（重低音）。振動オンなら振動として、振動オフ・効果音オンなら効果音として 1 回だけ */
  kicks: "rumble" | "effects" | null
  /** 画面全体の揺れ（振動オン・reduced-motion でない） */
  shake: boolean
  /** navigator.vibrate */
  vibrate: boolean
}

/**
 * 効果音・振動トグルと reduced-motion から何を鳴らすか。
 * - 効果音オフ・振動オン → 重低音（インパクト＋キック）と揺れだけ
 * - 効果音オン・振動オフ → ライザー・歓声・和音＋キック（揺れ無し）
 * - 両方オフ → 無音
 */
export function festOutputs(t: {
  sound: boolean
  vibration: boolean
  reducedMotion: boolean
  canVibrate: boolean
}): FestOutputs {
  const o = outputs(t)
  return {
    riser: o.effects && !t.reducedMotion, // reduced-motion はビルドアップが無いのでライザーも無し
    crowd: o.effects,
    chord: o.effects,
    kicks: o.rumble ? "rumble" : o.effects ? "effects" : null,
    shake: o.shake,
    vibrate: o.vibrate,
  }
}

// ---------------------------------------------------------------- 音の設計

/**
 * ノイズ系（ライザー・歓声）の帯域。耳に刺さらないよう 4kHz 未満に収め、
 * さらに全体を FEST_LOWPASS で切る。立ち上がりは ATTACK（15ms）よりずっと遅い。
 */
export const FEST_LOWPASS = 3500

export interface RiserSpec {
  /** 秒 */
  dur: number
  /** ノイズの bandpass 中心を from → to へ上げる */
  noise: { from: number; to: number; q: number; level: number }
  /** サインのピッチライザー */
  tone: { from: number; to: number; level: number }
  /** 立ち上がり（秒）。急に出さない */
  attack: number
  /** ドロップ直前に絞る長さ（秒） */
  release: number
}

export function riserSpec(dropMs = DROP_MS): RiserSpec {
  return {
    dur: dropMs / 1000,
    noise: { from: 350, to: 2200, q: 0.9, level: 0.32 },
    tone: { from: 98, to: 392, level: 0.26 },
    attack: (dropMs / 1000) * 0.85,
    release: 0.06,
  }
}

export interface CrowdSpec {
  /** ドロップからの開始（秒） */
  at: number
  /** 帯域ノイズの束（群衆の「わー」）。中心 Hz・Q・音量 */
  bands: { freq: number; q: number; level: number }[]
  /** ゆっくり立ち上げる（秒） */
  attack: number
  hold: number
  decay: number
  /** 群衆のうねり（Hz と深さ） */
  lfo: { rate: number; depth: number }
}

export function crowdSpec(tier: FestTier): CrowdSpec {
  const lvl = tier.fever ? 0.55 : 0.42 + (tier.combo - 1) * 0.03
  return {
    at: 0.04,
    bands: [
      { freq: 520, q: 1.4, level: lvl },
      { freq: 950, q: 1.6, level: lvl * 0.85 },
      { freq: 1700, q: 1.8, level: lvl * 0.55 },
    ],
    attack: 0.35,
    hold: tier.fever ? 1.1 : 0.7,
    decay: 1.4,
    lfo: { rate: 5.5, depth: 0.3 },
  }
}

export interface ChordNote {
  freq: number
  type: "sine" | "triangle"
  level: number
  decay: number
}

/** ドロップの和音（低いパワーコード）。コンボで半音ずつ上げる（上限 +5） */
export function dropChord(tier: FestTier): ChordNote[] {
  const up = Math.min(tier.combo - 1, 5)
  const s = (f: number) => f * 2 ** (up / 12)
  return [
    { freq: s(65.41), type: "sine", level: 0.34, decay: 1.1 }, // C2
    { freq: s(130.81), type: "triangle", level: 0.24, decay: 0.95 }, // C3
    { freq: s(196), type: "triangle", level: 0.17, decay: 0.9 }, // G3
    { freq: s(261.63), type: "triangle", level: 0.1, decay: 0.8 }, // C4
  ]
}

/** キック 1 発（「ドン」。lib/haptics の Hit 型・帯域ルールに従う） */
function kick(at: number, gain: number, tail: number): Hit {
  return {
    at,
    gain,
    sub: { from: 96, to: 48, drop: 0.1, decay: tail, level: SUB_LEVEL * 1.2 },
    body: { freq: 125, level: 1, decay: Math.min(0.4, tail * 0.7) },
    over: { freq: 200, level: 0.28 },
    knock: null,
  }
}

/**
 * ドロップのインパクト＋拍のキック（ドロップ = 0 秒）。
 * haptics の play に渡すときは hits をビルドアップぶん後ろへずらす（shiftSpec）。
 */
export function festRumble(tier: FestTier, kicksMs: number[], dropMs: number): HapticSpec {
  const t = Math.min(1, (Math.min(tier.combo, 6) - 1) / 5)
  const hits: Hit[] = [
    { ...kick(0, 0.82, 0.7 + t * 0.4), sub: { from: 100, to: 46, drop: 0.14, decay: 0.7 + t * 0.4, level: SUB_LEVEL * (1.15 + t * 0.3) } },
    ...kicksMs.map((ms) => kick((ms - dropMs) / 1000, 0.62 + t * 0.12, 0.32)),
  ]
  return {
    hits,
    shake: { px: tier.shakePx, ms: 650, scope: "screen" },
    // インパクト 200ms → 拍ごとに 60ms（拍の頭に揃える）
    vibrate: [200, Math.round(BEAT_MS - 200), ...kicksMs.flatMap(() => [60, Math.round(BEAT_MS - 60)])].slice(0, -1),
  }
}

/** spec 全体を sec 秒後ろへずらす（vibrate は先頭に休みを入れる） */
export function shiftSpec(spec: HapticSpec, sec: number): HapticSpec {
  return {
    ...spec,
    hits: spec.hits.map((h) => ({ ...h, at: h.at + sec })),
    vibrate: sec > 0 ? [0, Math.round(sec * 1000), ...spec.vibrate] : spec.vibrate,
  }
}

/** 効果音のピーク（VOLUME = 0.35 を上限に） */
export function festPeak(level: number): number {
  return Math.max(0, Math.min(1, level)) * VOLUME
}

// ---------------------------------------------------------------- 後続の演出（レベルアップ）を待たせる

/**
 * ショーの最中に来たもの（レベルアップの全画面）を、ショーが終わってから順に出す（重ねない）。
 */
export function createShowGate() {
  let active = 0
  const queue: (() => void)[] = []
  return {
    begin(): void {
      active++
    },
    end(): void {
      if (active === 0) return
      active--
      if (active > 0) return
      while (queue.length && active === 0) queue.shift()!()
    },
    /** ショー中なら終わるまで待たせ、そうでなければすぐ実行 */
    run(fn: () => void): void {
      if (active > 0) queue.push(fn)
      else fn()
    },
    get active(): boolean {
      return active > 0
    },
  }
}
