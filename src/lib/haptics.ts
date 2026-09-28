/**
 * 重低音の「バイブレーション」（触感音 + 画面・カードの微振動 + 使えれば実振動）。
 *
 * Mac の Chrome では navigator.vibrate もトラックパッドの触覚も Web から叩けないので、
 * WebAudio で合成した「腹に来る低音」で表現する。1 発（Hit）は次の層の重ね合わせ:
 * - sub:   サイン波。90〜100Hz → 45〜55Hz へピッチを落とすキック型（「ドン」の芯）
 * - body:  100〜150Hz のサイン。MacBook 内蔵スピーカーで聞こえるのはここなので一番大事
 * - over:  150〜250Hz の倍音（ボディの厚み）
 * - knock: 帯域ノイズの短いアタック（「ド」のノック感・報酬インパクトの中域の当たり）
 * 高域のピコピコ・矩形波は使わない。出力段（lib/audio.ts）で 30Hz 以下を切り、軽いサチュレーション
 * → コンプレッサーで音圧を出しつつクリップさせない。
 *
 * 音の型（参考: 心拍の二連打と報酬インパクト）:
 * - やってる = 心拍「ドクン」（1 打目 = サブ + ベース + 少しのノック、0.2 秒後の 2 打目 = ほぼ純粋な重低音）
 * - やった   = 報酬インパクト「ドゥン！」（サブ + 強いボディ + 短いアタック + 300〜600ms の低音テール）
 * - コンボ   = 段階でテールを長く・サブを強く / レベルアップ = インパクト×3 のうねり
 *
 * - ヘッダーの「振動」トグル（既定オン・localStorage）。効果音トグル（lib/sound.ts）とは独立
 *   → 効果音オフ・振動オンなら重低音だけ、両方オフなら無音
 * - prefers-reduced-motion のときは視覚の振動だけ抑える（音・実振動は出す）
 * - navigator.vibrate があれば（Android 等）同じタイミングで実振動も
 * - ホバーの tick はユーザー操作前は鳴らさない（AudioContext を作らない。自動再生ポリシー）
 * - React の state を通さない（ドラッグ中の再描画を増やさない）。視覚の振動は WAAPI で `translate` だけ動かす
 */
import { audioOut, getAudio, hasUserGesture } from "./audio"

// ---------------------------------------------------------------- プリセット

export type Preset = "tick" | "buzz" | "thud" | "rumbleMid" | "rumbleStrong" | "rumbleMax" | "focus"

/** 視覚の振動をどこに出すか */
export type ShakeScope = "card" | "board" | "screen"

/** 1 発の低音 */
export interface Hit {
  /** 開始（秒、プリセットの頭から） */
  at: number
  /** この発の音量（0〜1。MAX_GAIN で頭打ち） */
  gain: number
  /**
   * 芯のサイン: from Hz → to Hz へ drop 秒で落とし、decay 秒で消える（= 低音テール）。
   * level の既定は SUB_LEVEL（控えめ。60Hz 未満は内蔵スピーカーで聞こえずヘッドルームを食うだけなので、
   * エネルギーの主役は body の 100〜150Hz に置く）
   */
  sub: { from: number; to: number; drop: number; decay: number; level?: number }
  /** 100〜150Hz のボディ（内蔵スピーカーで聞こえる帯域） */
  body: { freq: number; level: number; decay: number } | null
  /** 150〜250Hz の倍音（body の decay で消える） */
  over: { freq: number; level: number } | null
  /** 帯域ノイズのアタック（中心 Hz・音量・長さ秒） */
  knock: { freq: number; level: number; dur: number } | null
}

export interface HapticSpec {
  hits: Hit[]
  /** 視覚の振動（px・ms・どこ）。null なら揺らさない */
  shake: { px: number; ms: number; scope: ShakeScope } | null
  /** navigator.vibrate のパターン（ms） */
  vibrate: number[]
}

/**
 * アタック（秒）。50〜120Hz は 1 周期が 8〜20ms あるので、それより短い立ち上がりは
 * 「ボツッ」というクリックとして耳に刺さる（「ボツボツボツ」と痛く聞こえる）。1 周期ぶん以上かけて立ち上げる
 */
export const ATTACK = 0.015

/** サブの既定の音量比（body = 1 前後に対して） */
export const SUB_LEVEL = 0.45

/** 心拍の 1 打目「ド」: サブ + ベースが最大、ボディ少し、ノック少し */
export function beatDo(at: number, gain: number): Hit {
  return {
    at,
    gain,
    sub: { from: 92, to: 50, drop: 0.07, decay: 0.24 },
    body: { freq: 122, level: 0.9, decay: 0.16 },
    over: { freq: 200, level: 0.15 },
    knock: null,
  }
}

/** 心拍の 2 打目「クン」: ほぼ純粋な重低音（120Hz より上は出さない） */
export function beatKun(at: number, gain: number): Hit {
  return {
    at,
    gain,
    sub: { from: 82, to: 47, drop: 0.06, decay: 0.3 },
    body: { freq: 100, level: 0.6, decay: 0.15 },
    over: null,
    knock: null,
  }
}

/** 報酬インパクト「ドゥン！」。tail = 低音テールの長さ、sub = サブの強さ */
export function impact(at: number, gain: number, tail = 0.5, sub = 1): Hit {
  return {
    at,
    gain,
    sub: { from: 100, to: 48, drop: 0.12, decay: tail, level: SUB_LEVEL * sub },
    body: { freq: 130, level: 1, decay: Math.min(0.5, tail * 0.75) },
    over: { freq: 210, level: 0.35 },
    knock: null,
  }
}

export const PRESETS: Record<Preset, HapticSpec> = {
  /** カードにホバー／ボタンを押した瞬間の「ぶっ」。ごく短い 1 発・小音量 */
  tick: {
    hits: [
      {
        at: 0,
        gain: 0.3,
        sub: { from: 95, to: 55, drop: 0.04, decay: 0.08 },
        body: { freq: 125, level: 1, decay: 0.06 },
        over: null,
        knock: null,
      },
    ],
    shake: null,
    vibrate: [8],
  },
  /** ドラッグで持ち上げた瞬間の「ぶぶぶ」（心拍の質感の短い 3 連・間隔 70ms） */
  buzz: {
    hits: [0.55, 0.42, 0.5].map((gain, i) => ({
      at: i * 0.07,
      gain,
      sub: { from: 88, to: 52, drop: 0.035, decay: 0.065 },
      body: { freq: 120, level: i === 1 ? 0.6 : 0.95, decay: 0.06 },
      over: i === 0 ? { freq: 195, level: 0.12 } : null,
      knock: null,
    })),
    shake: { px: 2, ms: 300, scope: "card" },
    vibrate: [40, 30, 40, 30, 40],
  },
  /** ドロップ着地の「ドン」 */
  thud: {
    hits: [
      {
        at: 0,
        gain: 0.62,
        sub: { from: 95, to: 45, drop: 0.09, decay: 0.28 },
        body: { freq: 115, level: 1, decay: 0.18 },
        over: { freq: 190, level: 0.18 },
        knock: null,
      },
    ],
    shake: { px: 2, ms: 180, scope: "card" },
    vibrate: [30],
  },
  /** やってるへ移動: 心拍「ドクン」（二連打の間隔 0.2 秒） */
  rumbleMid: {
    hits: [beatDo(0, 0.72), beatKun(0.2, 0.62)],
    shake: { px: 3, ms: 420, scope: "card" },
    vibrate: [60, 140, 90],
  },
  /** やったへ移動: 報酬インパクト「ドゥン！」 */
  rumbleStrong: {
    hits: [impact(0, 0.85, 0.5)],
    shake: { px: 4, ms: 500, scope: "card" },
    vibrate: [160, 40, 80],
  },
  /** レベルアップ: インパクト×3 のうねり（だんだん強く、最後はテール長め）＋画面全体 */
  rumbleMax: {
    hits: [impact(0, 0.7, 0.45), impact(0.32, 0.8, 0.5, 1.15), impact(0.64, 0.9, 0.95, 1.35)],
    shake: { px: 7, ms: 1100, scope: "screen" },
    vibrate: [180, 140, 200, 120, 320],
  },
  /** ポモドーロの集中完了: 心拍「ドクン」→ インパクト */
  focus: {
    hits: [beatDo(0, 0.6), beatKun(0.2, 0.5), impact(0.45, 0.82, 0.6, 1.1)],
    shake: { px: 4, ms: 700, scope: "screen" },
    vibrate: [60, 140, 90, 120, 200],
  },
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * コンボの段階（2〜、6 で頭打ち）に応じてテールを長く・サブを強く。
 * 3 コンボ以上はボード全体を揺らす（以前の .kb-shake を置き換え。二重に揺らさない）。
 */
export function comboSpec(combo: number): HapticSpec {
  const t = Math.max(0, Math.min(1, (Math.min(combo, 6) - 2) / 4))
  return {
    hits: [impact(0, lerp(0.86, 0.95, t), lerp(0.6, 1.0, t), lerp(1.1, 1.5, t))],
    shake: { px: Math.round(lerp(4, 8, t)), ms: Math.round(lerp(450, 750, t)), scope: combo >= 3 ? "board" : "card" },
    vibrate: [Math.round(lerp(180, 300, t)), 40, Math.round(lerp(100, 200, t))],
  }
}

/** 1 発の長さ（秒）＝一番長い層 */
export function hitLength(h: Hit): number {
  return Math.max(h.sub.decay, h.body?.decay ?? 0, h.knock?.dur ?? 0)
}

/** プリセット全体の長さ（秒） */
export function specLength(spec: HapticSpec): number {
  return Math.max(...spec.hits.map((h) => h.at + hitLength(h)))
}

/** 既定の音量（控えめ）と、1 発あたりの上限（クリップさせない） */
export const VOLUME = 0.35
export const MAX_GAIN = 0.9

export function peakGain(hit: Hit, volume = VOLUME): number {
  return Math.min(MAX_GAIN, Math.max(0, hit.gain)) * volume
}

// ---------------------------------------------------------------- 間引き

/**
 * tick の間引き。同じキー（カード id・ボタン要素）は perKeyMs 以内に再発火しない、
 * 全体でも globalMs 間隔以上。発火してよければ true（そのとき時刻を記録する）。
 */
export function createThrottle(perKeyMs = 300, globalMs = 80) {
  let lastAny = -Infinity
  const prim = new Map<unknown, number>()
  const objs = new WeakMap<object, number>()
  return (key: unknown, now: number): boolean => {
    if (now - lastAny < globalMs) return false
    const isObj = typeof key === "object" && key !== null
    const last = isObj ? objs.get(key as object) : prim.get(key)
    if (last != null && now - last < perKeyMs) return false
    lastAny = now
    if (isObj) objs.set(key as object, now)
    else {
      prim.set(key, now)
      if (prim.size > 500) prim.clear()
    }
    return true
  }
}

// ---------------------------------------------------------------- トグル

export interface Outputs {
  /** 演出の効果音（lib/sound.ts） */
  effects: boolean
  /** 重低音の触感音 */
  rumble: boolean
  /** navigator.vibrate の実振動 */
  vibrate: boolean
  /** カード・ボード・画面の微振動 */
  shake: boolean
}

/** 効果音・振動トグルと reduced-motion から、何を出すか */
export function outputs(t: {
  sound: boolean
  vibration: boolean
  reducedMotion: boolean
  canVibrate: boolean
}): Outputs {
  return {
    effects: t.sound,
    rumble: t.vibration,
    vibrate: t.vibration && t.canVibrate,
    shake: t.vibration && !t.reducedMotion,
  }
}

/** navigator.vibrate が使えるか（Mac の Chrome 等は無い、または何もしない） */
export function canVibrate(nav: unknown = typeof navigator === "undefined" ? undefined : navigator): boolean {
  const n = nav as { vibrate?: unknown } | undefined
  return typeof n?.vibrate === "function"
}

const KEY = "dopa:haptics"
let enabled = load()
const listeners = new Set<() => void>()

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0"
  } catch {
    return true
  }
}

export function hapticsEnabled(): boolean {
  return enabled
}

export function setHapticsEnabled(v: boolean): void {
  enabled = v
  try {
    localStorage.setItem(KEY, v ? "1" : "0")
  } catch {
    /* 保存できなくても今のタブでは効く */
  }
  listeners.forEach((l) => l())
}

export function subscribeHaptics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 音

/** 指数エンベロープ: ATTACK で peak、decay 秒で消える（0 から/0 へは指数で繋いでクリックを出さない） */
function envelope(g: AudioParam, t: number, peak: number, decay: number): void {
  g.setValueAtTime(0.0001, t)
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + ATTACK)
  g.exponentialRampToValueAtTime(0.0001, t + Math.max(ATTACK * 2, decay))
  g.setValueAtTime(0, t + decay + 0.005)
}

let noise: AudioBuffer | null = null

function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ac.sampleRate) return noise
  const len = Math.round(ac.sampleRate * 0.05)
  const b = ac.createBuffer(1, len, ac.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  noise = b
  return b
}

/** 1 発を dest に鳴らす（t = 開始時刻） */
function renderHit(ac: BaseAudioContext, h: Hit, dest: AudioNode, t: number, volume: number): void {
  const peak = peakGain(h, volume)
  const tone = (freq: number, level: number, decay: number, from?: number, drop?: number) => {
    const o = ac.createOscillator()
    o.type = "sine"
    if (from != null && drop != null) {
      o.frequency.setValueAtTime(from, t)
      o.frequency.exponentialRampToValueAtTime(freq, t + drop)
    } else o.frequency.setValueAtTime(freq, t)
    const g = ac.createGain()
    envelope(g.gain, t, peak * level, decay)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + decay + 0.02)
    o.onended = () => g.disconnect()
  }
  tone(h.sub.to, h.sub.level ?? SUB_LEVEL, h.sub.decay, h.sub.from, h.sub.drop)
  if (h.body) {
    // ボディも少しだけ上から落とす（アタックの「ド」）
    tone(h.body.freq, h.body.level, h.body.decay, h.body.freq * 1.1, 0.06)
    if (h.over) tone(h.over.freq, h.over.level, h.body.decay * 0.8)
  }
  if (h.knock) {
    const src = ac.createBufferSource()
    src.buffer = noiseBuffer(ac)
    const bp = ac.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = h.knock.freq
    bp.Q.value = 1.2
    const g = ac.createGain()
    envelope(g.gain, t, peak * h.knock.level, h.knock.dur)
    src.connect(bp).connect(g).connect(dest)
    src.start(t)
    src.stop(t + h.knock.dur + 0.02)
    src.onended = () => g.disconnect()
  }
}

/**
 * プリセットを dest に鳴らす。OfflineAudioContext でも同じものが描ける（帯域の検証用）。
 * 高域を切る lowpass（900Hz。耳に刺さる成分を落とす）を通してから dest へ。
 */
export function renderSpec(
  ac: BaseAudioContext,
  spec: HapticSpec,
  dest: AudioNode,
  t0 = ac.currentTime + 0.005,
  volume = VOLUME,
): void {
  const lp = ac.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 900
  lp.Q.value = 0.5
  lp.connect(dest)
  for (const h of spec.hits) renderHit(ac, h, lp, t0 + h.at, volume)
  // 最後の発が消えたら切る
  const ms = (specLength(spec) + 0.1) * 1000
  if (typeof window !== "undefined" && ac instanceof AudioContext) window.setTimeout(() => lp.disconnect(), ms)
}

// ---------------------------------------------------------------- 視覚の振動

/** 減衰していく左右の揺れ（WAAPI の keyframes。translate だけ動かす） */
export function shakeFrames(px: number, steps: number): Keyframe[] {
  const n = Math.max(2, steps)
  const frames: Keyframe[] = [{ translate: "0 0" }]
  for (let i = 1; i < n; i++) {
    const a = px * (1 - i / n)
    const x = (i % 2 === 1 ? 1 : -1) * a
    const y = (i % 3 === 0 ? -1 : 1) * a * 0.35
    frames.push({ translate: `${x.toFixed(2)}px ${y.toFixed(2)}px` })
  }
  frames.push({ translate: "0 0" })
  return frames
}

const running = new WeakMap<Element, { anim: Animation; px: number }>()

/**
 * 同じ要素は 1 本だけ（二重に揺らさない）。揺れている最中に来たものは、同じか強いときだけ置き換える
 * （着地の thud がやったの強い揺れを打ち消さない）。
 */
function shakeEl(el: Element | null, px: number, ms: number): void {
  if (!el || typeof (el as HTMLElement).animate !== "function") return
  const cur = running.get(el)
  if (cur) {
    if (cur.px > px) return
    cur.anim.cancel()
  }
  const anim = (el as HTMLElement).animate(shakeFrames(px, Math.round(ms / 35)), {
    duration: ms,
    easing: "linear",
  })
  running.set(el, { anim, px })
  const done = () => {
    if (running.get(el)?.anim === anim) running.delete(el)
  }
  anim.onfinish = done
  anim.oncancel = done
}

export function cardEl(taskId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`)
}

function scopeEl(scope: ShakeScope, card: Element | null): Element | null {
  if (scope === "card") return card
  if (scope === "board") return document.querySelector("main")
  return document.getElementById("root") ?? document.body
}

// ---------------------------------------------------------------- 再生

let dragging = false
const throttle = createThrottle()

export interface PlayOptions {
  /** 揺らすカード（scope が card のとき）。関数なら揺らす瞬間に引く */
  card?: Element | null | (() => Element | null)
  /** 視覚の振動を遅らせる（ドロップの着地を待つ等） */
  shakeDelayMs?: number
  /** false ならユーザー操作前に AudioContext を作らない（ホバー） */
  create?: boolean
  /** 音の出口（既定は共有の出力段 audioOut）。フェス演出はスキップで絞れるよう自前のゲートを挟む */
  dest?: (ac: AudioContext) => AudioNode
}

export function play(preset: Preset | HapticSpec, opts: PlayOptions = {}): void {
  if (!enabled) return
  const spec = typeof preset === "string" ? PRESETS[preset] : preset
  const o = outputs({ sound: true, vibration: enabled, reducedMotion: reducedMotion(), canVibrate: canVibrate() })
  if (o.rumble) {
    const ac = getAudio({ create: opts.create ?? true })
    if (ac) {
      try {
        renderSpec(ac, spec, opts.dest ? opts.dest(ac) : audioOut(ac))
      } catch {
        /* WebAudio の失敗で操作を止めない */
      }
    }
  }
  if (o.vibrate && hasUserGesture()) {
    try {
      navigator.vibrate(spec.vibrate)
    } catch {
      /* noop */
    }
  }
  if (o.shake && spec.shake) {
    const { px, ms, scope } = spec.shake
    const run = () => {
      const card = typeof opts.card === "function" ? opts.card() : (opts.card ?? null)
      shakeEl(scopeEl(scope, card), px, ms)
    }
    if (opts.shakeDelayMs) window.setTimeout(() => requestAnimationFrame(run), opts.shakeDelayMs)
    else run()
  }
}

/** カードにホバーした・ボタンを押した瞬間の「ぶっ」（間引きあり） */
export function tick(key: unknown, opts: { hover?: boolean } = {}): void {
  if (!enabled) return
  if (opts.hover && (dragging || !hasUserGesture())) return
  if (!throttle(key, performance.now())) return
  play("tick", { create: !opts.hover })
}

/** ドラッグ中はホバーの tick を出さない（Board の onDragStart / onDragEnd から） */
export function setDragging(v: boolean): void {
  dragging = v
}

/** 持ち上げた瞬間の「ぶぶぶ」。揺らすのはドラッグ中のオーバーレイのカード */
export function buzz(): void {
  play("buzz", {
    card: () => document.querySelector("[data-drag-overlay]"),
    shakeDelayMs: 1, // オーバーレイが描画されてから
  })
}

/** ドロップ着地の「ドン」（カードは着地アニメ 160ms を待ってから揺らす） */
export function thud(taskId: number | null): void {
  play("thud", { card: () => (taskId == null ? null : cardEl(taskId)), shakeDelayMs: 160 })
}

/** ボタン・リンク等を押したら軽い tick（main.tsx で 1 回だけ登録） */
export function installPressHaptics(): void {
  window.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target instanceof Element ? e.target : null
      const el = t?.closest("button, a[href], [role='button'], [role='menuitem'], select, input[type='checkbox']")
      if (el) tick(el)
    },
    true,
  )
}
