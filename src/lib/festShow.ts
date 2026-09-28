/**
 * 「やった」のフェス演出（TASK CLEAR ショー）の実体。設計値・タイムラインは lib/fest.ts（純粋関数・テスト済み）。
 *
 * - 全画面オーバーレイ（pointer-events: none。ボードの D&D を妨げない）に少数の DOM を差し込み、
 *   動かすのは transform / opacity だけ（WAAPI・CSS アニメ。コンポジタで回る）
 * - 花火・紙吹雪は canvas-confetti の既存の 1 枚の canvas（Worker 描画）に撃つ。canvas は増やさない
 * - クリック・キー操作（Esc 等）・次のドラッグでフェードアウトしてスキップ。音もバスごと絞る
 * - 音（効果音バス → 3.5kHz lowpass → 共有の出力段 audioOut）:
 *   ライザー（帯域ノイズ + サインを 0.6 秒かけて立ち上げ）→ ドロップの和音 → 歓声（帯域ノイズの束・0.35 秒で立ち上げ）
 *   重低音のインパクト＋拍のキックは lib/haptics の play（振動トグル・揺れ・実振動）に同じバス経由で渡す
 */
import type confetti from "canvas-confetti"
import { audioOut, getAudio } from "./audio"
import {
  BEAT_MS,
  crowdSpec,
  dropChord,
  FEST_LOWPASS,
  festOutputs,
  festPeak,
  festRumble,
  festTier,
  festTimeline,
  riserSpec,
  SKIP_FADE_MS,
  type FestOutputs,
  type FestTier,
  type FestTimeline,
} from "./fest"
import { ATTACK, canVibrate, hapticsEnabled, play as haptic, renderSpec, type HapticSpec } from "./haptics"
import { soundEnabled } from "./sound"

// ---------------------------------------------------------------- 音

let pink: AudioBuffer | null = null

/** ピンクノイズ（ホワイトより高域が穏やか。2.5 秒・ループで使う） */
function pinkNoise(ac: BaseAudioContext): AudioBuffer {
  if (pink && pink.sampleRate === ac.sampleRate) return pink
  const len = Math.round(ac.sampleRate * 2.5)
  const b = ac.createBuffer(1, len, ac.sampleRate)
  const d = b.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
  }
  pink = b
  return b
}

/** 効果音バス: gain（スキップで絞る）→ lowpass（4kHz 未満）→ dest */
export function festBus(ac: BaseAudioContext, dest: AudioNode): GainNode {
  const bus = ac.createGain()
  const lp = ac.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = FEST_LOWPASS
  lp.Q.value = 0.5
  bus.connect(lp).connect(dest)
  return bus
}

/** ライザー: 帯域ノイズの中心とサインのピッチを上げながら、ゆっくり（指数で）立ち上げ、ドロップ直前に絞る */
export function renderRiser(ac: BaseAudioContext, dest: AudioNode, t0: number): void {
  const s = riserSpec()
  const end = t0 + s.dur
  const env = (g: AudioParam, peak: number) => {
    g.setValueAtTime(0.0001, t0)
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + s.attack)
    g.setValueAtTime(Math.max(0.0002, peak), end - s.release)
    g.exponentialRampToValueAtTime(0.0001, end)
    g.setValueAtTime(0, end + 0.005)
  }
  const src = ac.createBufferSource()
  src.buffer = pinkNoise(ac)
  src.loop = true
  const bp = ac.createBiquadFilter()
  bp.type = "bandpass"
  bp.Q.value = s.noise.q
  bp.frequency.setValueAtTime(s.noise.from, t0)
  bp.frequency.exponentialRampToValueAtTime(s.noise.to, end)
  const ng = ac.createGain()
  env(ng.gain, festPeak(s.noise.level) * 2.5) // 帯域を絞ったぶん持ち上げる（ピークは festPeak 基準）
  src.connect(bp).connect(ng).connect(dest)
  src.start(t0)
  src.stop(end + 0.03)

  const o = ac.createOscillator()
  o.type = "sine"
  o.frequency.setValueAtTime(s.tone.from, t0)
  o.frequency.exponentialRampToValueAtTime(s.tone.to, end)
  const og = ac.createGain()
  env(og.gain, festPeak(s.tone.level))
  o.connect(og).connect(dest)
  o.start(t0)
  o.stop(end + 0.03)
  src.onended = () => ng.disconnect()
  o.onended = () => og.disconnect()
}

/** ドロップの和音（低いパワーコード）と歓声 */
export function renderDrop(ac: BaseAudioContext, dest: AudioNode, t: number, tier: FestTier, o: FestOutputs): void {
  if (o.chord) {
    for (const n of dropChord(tier)) {
      const osc = ac.createOscillator()
      osc.type = n.type
      osc.frequency.setValueAtTime(n.freq, t)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(festPeak(n.level), t + ATTACK * 2)
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.decay)
      g.gain.setValueAtTime(0, t + n.decay + 0.005)
      osc.connect(g).connect(dest)
      osc.start(t)
      osc.stop(t + n.decay + 0.02)
      osc.onended = () => g.disconnect()
    }
  }
  if (o.crowd) {
    const c = crowdSpec(tier)
    const t1 = t + c.at
    const stop = t1 + c.attack + c.hold + c.decay + 0.05
    const src = ac.createBufferSource()
    src.buffer = pinkNoise(ac)
    src.loop = true
    // うねり（トレモロ）: 1−depth 〜 1 の間で揺らす
    const trem = ac.createGain()
    trem.gain.value = 1 - c.lfo.depth / 2
    const lfo = ac.createOscillator()
    lfo.frequency.value = c.lfo.rate
    const lfoAmt = ac.createGain()
    lfoAmt.gain.value = c.lfo.depth / 2
    lfo.connect(lfoAmt).connect(trem.gain)
    const env = ac.createGain()
    const peak = 3 // 帯域を 3 本に絞ったぶん持ち上げる（各帯の音量は festPeak で頭打ち）
    env.gain.setValueAtTime(0.0001, t1)
    env.gain.exponentialRampToValueAtTime(peak, t1 + c.attack)
    env.gain.setValueAtTime(peak, t1 + c.attack + c.hold)
    env.gain.exponentialRampToValueAtTime(0.0001, t1 + c.attack + c.hold + c.decay)
    env.gain.setValueAtTime(0, t1 + c.attack + c.hold + c.decay + 0.005)
    for (const b of c.bands) {
      const bp = ac.createBiquadFilter()
      bp.type = "bandpass"
      bp.frequency.value = b.freq
      bp.Q.value = b.q
      const g = ac.createGain()
      g.gain.value = festPeak(b.level)
      src.connect(bp).connect(g).connect(trem)
    }
    trem.connect(env).connect(dest)
    src.start(t1)
    lfo.start(t1)
    src.stop(stop)
    lfo.stop(stop)
    src.onended = () => env.disconnect()
  }
}

/** 帯域の検証用: ショー 1 回ぶんの音をまとめて描く（OfflineAudioContext で使う） */
export function renderFestOffline(ac: BaseAudioContext, dest: AudioNode, combo: number, o: FestOutputs): void {
  const tier = festTier(combo)
  const tl = festTimeline(tier)
  const bus = festBus(ac, dest)
  const t0 = 0.01
  if (o.riser) renderRiser(ac, bus, t0)
  const td = t0 + tl.drop / 1000
  renderDrop(ac, bus, td, tier, o)
  if (o.kicks) renderSpec(ac, festRumble(tier, tl.kicks, tl.drop), bus, td)
}

// ---------------------------------------------------------------- 画面

type Fire = confetti.CreateTypes

export interface ShowOptions {
  taskId: number
  title: string
  reducedMotion: boolean
  /** 花火・紙吹雪を撃つ canvas-confetti（celebrate.ts の 1 枚の canvas） */
  fire: () => Fire | null
  /** 終わった（スキップも含む）。レベルアップの待ち行列を流す */
  onEnd: () => void
}

export interface XpInfo {
  xp: number
  combo: number
}

const el = (cls: string, parent?: HTMLElement, text?: string): HTMLDivElement => {
  const d = document.createElement("div")
  d.className = cls
  if (text != null) d.textContent = text
  parent?.appendChild(d)
  return d
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

export class FestShow {
  readonly taskId: number
  private opts: ShowOptions
  private root: HTMLDivElement | null = null
  private center: HTMLDivElement | null = null
  private timers: number[] = []
  private raf = 0
  private xp: XpInfo | null = null
  private tier: FestTier = festTier(1)
  private tl: FestTimeline
  private dropped = false
  private xpShown = false
  private ended = false
  private bus: GainNode | null = null
  private started = 0
  private removeListeners: (() => void) | null = null

  constructor(opts: ShowOptions) {
    this.opts = opts
    this.taskId = opts.taskId
    this.tl = festTimeline(this.tier, opts.reducedMotion)
  }

  /** XP 付与（コンボ）。ドロップ前に来ればコンボ段階に反映、XP はカウントアップで出す */
  setXp(x: XpInfo): void {
    this.xp = x
    if (!this.dropped) {
      this.tier = festTier(x.combo)
      this.tl = festTimeline(this.tier, this.opts.reducedMotion)
    } else if (!this.xpShown && this.root && performance.now() - this.started >= this.tl.xpAt) {
      this.showXp()
    }
  }

  private outs(): FestOutputs {
    return festOutputs({
      sound: soundEnabled(),
      vibration: hapticsEnabled(),
      reducedMotion: this.opts.reducedMotion,
      canVibrate: canVibrate(),
    })
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, Math.max(0, ms - (performance.now() - this.started))))
  }

  start(): void {
    if (this.ended) return
    this.started = performance.now()
    const rm = this.opts.reducedMotion
    const root = el("kb-fest")
    root.setAttribute("aria-hidden", "true")
    if (rm) root.classList.add("kb-fest--calm")
    this.root = root
    el("kb-fest-dim", root)
    if (!rm) {
      el("kb-fest-pulse", root)
      const lights = el("kb-fest-lights", root)
      for (const side of ["l", "r"] as const) el(`kb-fest-search kb-fest-search--${side}`, lights)
    }
    this.center = el("kb-fest-center", root)
    document.body.appendChild(root)
    this.animateBuildup()

    // 音: ライザーは今、ドロップ側（和音・歓声・インパクト・キック）はドロップの瞬間に
    const o = this.outs()
    if (o.riser && this.tl.drop > 0) {
      const ac = getAudio()
      if (ac) {
        try {
          renderRiser(ac, this.audioBus(ac), ac.currentTime + 0.01)
        } catch {
          /* WebAudio の失敗で演出を止めない */
        }
      }
    }

    this.at(this.tl.drop, () => this.drop())
    this.listenSkip()
  }

  private audioBus(ac: AudioContext): GainNode {
    if (this.bus && this.bus.context === ac) return this.bus
    this.bus = festBus(ac, audioOut(ac))
    return this.bus
  }

  private animateBuildup(): void {
    const root = this.root!
    const dim = root.querySelector<HTMLElement>(".kb-fest-dim")!
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: this.opts.reducedMotion ? 300 : 140, fill: "forwards" })
    if (this.opts.reducedMotion) return
    const pulse = root.querySelector<HTMLElement>(".kb-fest-pulse")!
    const half = BEAT_MS / 2
    this.tl.buildPulses.forEach((t, i) => {
      pulse.animate([{ opacity: 0 }, { opacity: 0.25 + i * 0.18, offset: 0.15 }, { opacity: 0 }], {
        duration: half,
        delay: t,
        easing: "ease-out",
      })
    })
    // サーチライト: ビルドアップで左右に 1 往復弱スイープ（左右は逆向き → 交差する）
    const [l, r] = root.querySelectorAll<HTMLElement>(".kb-fest-search")
    const sweep = (x: HTMLElement, from: number, to: number) =>
      x.animate(
        [
          { transform: `rotate(${from}deg)`, opacity: 0 },
          { transform: `rotate(${(from + to) / 2}deg)`, opacity: 1, offset: 0.35 },
          { transform: `rotate(${to}deg)`, opacity: 1 },
        ],
        { duration: this.tl.drop, easing: "cubic-bezier(0.45, 0, 0.55, 1)", fill: "forwards" },
      )
    sweep(l, -42, 30)
    sweep(r, 42, -30)
  }

  private drop(): void {
    if (this.ended || !this.root) return
    this.dropped = true
    const { tier, tl } = this
    const rm = this.opts.reducedMotion
    const root = this.root
    root.classList.toggle("kb-fest--fever", tier.fever)
    root.style.setProperty("--fest-a", tier.colors[0])
    root.style.setProperty("--fest-b", tier.colors[1] ?? tier.colors[0])
    root.style.setProperty("--fest-c", tier.colors[3] ?? tier.colors[2] ?? tier.colors[0])

    // 音（ドロップ）
    const o = this.outs()
    const ac = o.chord || o.crowd || o.kicks ? getAudio() : null
    if (ac) {
      try {
        const bus = this.audioBus(ac)
        renderDrop(ac, bus, ac.currentTime + 0.005, tier, o)
        const spec: HapticSpec = festRumble(tier, tl.kicks, tl.drop)
        if (o.kicks === "rumble") haptic(spec, { dest: () => bus })
        else if (o.kicks === "effects") renderSpec(ac, spec, bus)
      } catch {
        /* noop */
      }
    } else if (o.kicks === "rumble") {
      // AudioContext が無くても揺れ・実振動は出す
      haptic(festRumble(tier, tl.kicks, tl.drop))
    }

    // 文字: TASK CLEAR!! とタスク名
    const c = this.center!
    const title = el("kb-fest-title", c, "TASK CLEAR!!")
    title.dataset.text = "TASK CLEAR!!"
    el("kb-fest-name", c, this.opts.title)

    if (rm) {
      // 控えめな紙吹雪 1 回（上からふわっと）
      const fire = this.opts.fire()
      void fire?.({
        particleCount: 36,
        spread: 100,
        startVelocity: 14,
        gravity: 0.5,
        decay: 0.92,
        ticks: 220,
        scalar: 0.8,
        colors: tier.colors,
        origin: { x: 0.5, y: 0.25 },
      })
    } else {
      // 白フラッシュ
      const flash = el("kb-fest-flash", root)
      flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: tl.flashMs, easing: "ease-out", fill: "forwards" })
      // 拍の明滅（ボード全体が脈打つ）
      const pulse = root.querySelector<HTMLElement>(".kb-fest-pulse")!
      tl.beatPulses.forEach((t, i) =>
        pulse.animate([{ opacity: 0.85 - i * 0.15, offset: 0 }, { opacity: 0 }], {
          duration: BEAT_MS * 0.9,
          delay: t - tl.drop,
          easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
        }),
      )
      this.lasers(tier.lasers)
      // サーチライトはゆっくり回し続けて控えめに
      root.querySelectorAll<HTMLElement>(".kb-fest-search").forEach((s, i) => {
        s.getAnimations().forEach((a) => a.cancel())
        const sign = i === 0 ? 1 : -1
        s.animate([{ transform: `rotate(${30 * sign}deg)` }, { transform: `rotate(${-30 * sign}deg)` }], {
          duration: BEAT_MS * 4,
          direction: "alternate",
          iterations: Infinity,
          easing: "ease-in-out",
        })
        s.style.opacity = "0.45"
      })
      tl.fireworks.forEach((t, i) => this.at(t, () => this.firework(i)))
    }
    tl.rain.forEach((t, i) => (rm ? null : this.at(t, () => this.rain(i))))
    this.at(tl.xpAt, () => this.showXp())
    this.at(tl.fadeAt, () => this.fadeOut(tl.end - tl.fadeAt))
  }

  private lasers(n: number): void {
    if (n <= 0 || !this.root) return
    const wrap = el("kb-fest-lasers", this.root)
    const colors = this.tier.colors
    const per = Math.ceil(n / 2)
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0
      const k = Math.floor(i / 2)
      // 左の根本は右上へ、右の根本は左上へ扇状に（中央で交差する）
      const base = (left ? 1 : -1) * (-12 + (k / Math.max(1, per - 1)) * 58)
      const beam = el("kb-fest-laser", wrap)
      beam.style.left = left ? "16%" : "84%"
      beam.style.setProperty("--beam", colors[i % colors.length])
      beam.animate(
        [{ transform: `rotate(${base - 16}deg)` }, { transform: `rotate(${base + 16}deg)` }],
        {
          duration: BEAT_MS * 2,
          delay: -k * 110,
          direction: "alternate",
          iterations: Infinity,
          easing: "ease-in-out",
        },
      )
    }
    wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "forwards" })
  }

  private firework(i: number): void {
    const fire = this.opts.fire()
    if (!fire) return
    const colors = this.tier.colors
    const x = 0.12 + ((i * 0.618 + 0.21) % 1) * 0.76
    const y = 0.12 + ((i * 0.382 + 0.1) % 1) * 0.32
    void fire({
      particleCount: this.tier.particles,
      spread: 360,
      startVelocity: 26 + (this.tier.fever ? 6 : 0),
      decay: 0.91,
      gravity: 0.85,
      ticks: 90,
      scalar: 0.9,
      shapes: ["circle", "star"],
      colors: [colors[i % colors.length], colors[(i + 1) % colors.length], "#ffffff"],
      origin: { x, y },
    })
  }

  private rain(i: number): void {
    const fire = this.opts.fire()
    if (!fire) return
    void fire({
      particleCount: this.tier.fever ? 44 : 32,
      angle: 270,
      spread: 150,
      startVelocity: 6,
      gravity: 0.6,
      decay: 0.95,
      drift: i % 2 === 0 ? 0.6 : -0.6,
      ticks: 300,
      scalar: 1.05,
      shapes: ["square"],
      colors: this.tier.colors,
      origin: { x: 0.12 + ((i * 0.29) % 1) * 0.76, y: -0.08 },
    })
  }

  private showXp(): void {
    if (this.ended || !this.center || this.xpShown || !this.xp) return
    this.xpShown = true
    const { xp, combo } = this.xp
    const c = this.center
    const box = el("kb-fest-xp", c)
    const num = el("kb-fest-xp-num", box, this.tl.xpMs > 0 ? "+0" : `+${xp}`)
    el("kb-fest-xp-unit", box, "XP")
    if (combo >= 2) {
      const cb = el("kb-fest-combo", c, `${combo} COMBO${"!".repeat(Math.min(combo - 1, 4))}`)
      // XP がドロップ後に届いた（reduced-motion はドロップが 0 秒）ときもコンボ数で FEVER を判定する
      if (festTier(combo).fever) {
        cb.classList.add("kb-fest-combo--fever")
        cb.textContent = `FEVER!! ${combo} COMBO`
        if (!this.opts.reducedMotion)
          cb.animate([{ transform: "scale(1.08)" }, { transform: "scale(1)" }], {
            duration: BEAT_MS,
            iterations: 4,
            easing: "ease-out",
          })
      }
    }
    if (this.tl.xpMs <= 0) return
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / this.tl.xpMs)
      num.textContent = `+${Math.round(easeOut(t) * xp)}`
      if (t < 1 && !this.ended) this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  private listenSkip(): void {
    const skip = () => this.skip()
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Shift" && e.key !== "Meta" && e.key !== "Control" && e.key !== "Alt") skip()
    }
    window.addEventListener("pointerdown", skip, true)
    window.addEventListener("keydown", key, true)
    this.removeListeners = () => {
      window.removeEventListener("pointerdown", skip, true)
      window.removeEventListener("keydown", key, true)
    }
  }

  /** クリック・Esc・次の操作で素早くフェードアウト（花火・紙吹雪・音も止める） */
  skip(): void {
    if (this.ended) return
    try {
      this.opts.fire()?.reset()
    } catch {
      /* noop */
    }
    this.fadeOut(SKIP_FADE_MS)
  }

  private fadeOut(ms: number): void {
    if (this.ended) return
    this.ended = true
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers = []
    cancelAnimationFrame(this.raf)
    this.removeListeners?.()
    if (this.bus) {
      const now = this.bus.context.currentTime
      this.bus.gain.cancelScheduledValues(now)
      this.bus.gain.setValueAtTime(this.bus.gain.value, now)
      this.bus.gain.setTargetAtTime(0, now, ms / 1000 / 3)
      const bus = this.bus
      window.setTimeout(() => bus.disconnect(), ms + 2500)
    }
    const root = this.root
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      root?.remove()
      this.opts.onEnd()
    }
    if (!root) return done()
    const a = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "ease-in", fill: "forwards" })
    a.onfinish = done
    // タブが裏にあってアニメが進まなくても必ず片付ける
    window.setTimeout(() => root.isConnected && (a.cancel(), done()), ms + 400)
  }

  /** 開始前に取り消す（ドロップ直後に別のカードが「やった」に来た等） */
  cancel(): void {
    if (this.root) this.skip()
    else if (!this.ended) {
      this.ended = true
      this.opts.onEnd()
    }
  }
}
