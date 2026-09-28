/**
 * 完了の演出（紙吹雪・パーティクル・ポップテキスト・+XP・コンボ・レベルアップ）。
 *
 * - React の state を通さず、専用レイヤー（fixed の div と紙吹雪の canvas）に DOM を直接差し込む。
 *   ボードの再描画やドラッグの性能に影響しない
 * - 紙吹雪は canvas-confetti を別 canvas + Worker で描く。粒子数は控えめ（同時多発しても 60fps）
 * - prefers-reduced-motion のときは紙吹雪・揺れを出さず、色と XP の文字だけ（CSS 側でフェードのみ）
 * - 呼ぶのはドロップ確定後（useMoveTask の mutate）だけ
 * - 重低音の振動（lib/haptics）も同じタイミングで。揺れは haptics に一本化（振動トグル・reduced-motion に従う）
 * - 「やった」はフェス演出（lib/festShow.ts の TASK CLEAR ショー）。レベルアップはショーの後に続けて出す（重ねない）
 */
import confetti from "canvas-confetti"
import { createShowGate } from "./fest"
import { FestShow } from "./festShow"
import { cardEl, play as haptic } from "./haptics"
import { playFocus, playGo, playLevelUp, playXp } from "./sound"
import type { TaskStatus, XpAward } from "@/types"

const PINK = ["#ff3ea5", "#ff8a1f", "#ffd23f", "#ff6ad5"]
const DONE = ["#a3ff3c", "#22e4ff", "#ffffff", "#c084fc", "#ff3ea5"]
const LEVEL = ["#a3ff3c", "#22e4ff", "#a855f7", "#ff3ea5", "#ffd23f"]

const GO_WORDS = ["LET'S GO!", "やるぞ!", "GO GO GO!", "IN THE ZONE!", "START!!", "いくぞ!", "FIRE UP!"]

let fire: confetti.CreateTypes | null = null
let layer: HTMLDivElement | null = null
/** ローカル操作で既に演出した XP（ヘッダーの外部増分と二重に出さないため） */
let claimed = 0
/** 今のフェス演出（1 本だけ）と、その後に続ける演出の待ち行列 */
let show: FestShow | null = null
const gate = createShowGate()

export function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

function confettiFire(): confetti.CreateTypes | null {
  if (fire) return fire
  try {
    const canvas = document.createElement("canvas")
    canvas.setAttribute("aria-hidden", "true")
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "85", // レベルアップの全画面（80）より手前
    })
    document.body.appendChild(canvas)
    // reduced-motion の判定は呼ぶ側で（フェス演出は reduced-motion でも控えめな紙吹雪だけ出す）
    fire = confetti.create(canvas, { resize: true, useWorker: true, disableForReducedMotion: false })
  } catch {
    fire = null
  }
  return fire
}

function fxLayer(): HTMLDivElement {
  if (layer && layer.isConnected) return layer
  layer = document.createElement("div")
  layer.className = "kb-fx-layer"
  layer.setAttribute("aria-hidden", "true")
  document.body.appendChild(layer)
  return layer
}

function burst(opts: confetti.Options): void {
  if (reducedMotion()) return
  void confettiFire()?.(opts)
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

/** 画面上の点に文字を出して消す */
function floatText(
  text: string,
  x: number,
  y: number,
  opts: { className: string; size?: number; gradient?: string; duration?: number },
): void {
  const el = document.createElement("div")
  el.className = opts.className
  el.textContent = text
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  if (opts.size) el.style.fontSize = `${opts.size}px`
  if (opts.gradient) el.style.backgroundImage = opts.gradient
  fxLayer().appendChild(el)
  window.setTimeout(() => el.remove(), opts.duration ?? 1500)
}

function cardElement(taskId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-id="${taskId}"] > article`)
}

/** カードの中心（見えていなければ画面中央寄り） */
function cardPoint(taskId: number): { x: number; y: number; el: HTMLElement | null; rect: DOMRect | null } {
  const el = cardElement(taskId)
  const r = el?.getBoundingClientRect()
  if (r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, el, rect: r }
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.4, el: null, rect: null }
}

/** ドロップの着地（オーバーレイが滑り終わる 160ms）と再描画を待ってから */
function afterLanding(fn: () => void): void {
  window.setTimeout(() => requestAnimationFrame(fn), 150)
}

function bounce(el: HTMLElement | null): void {
  if (!el || reducedMotion()) return
  el.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.09) rotate(-1.5deg)", offset: 0.25 },
      { transform: "scale(0.96) rotate(1deg)", offset: 0.5 },
      { transform: "scale(1.03)", offset: 0.75 },
      { transform: "scale(1)" },
    ],
    { duration: 520, easing: "cubic-bezier(0.3, 1.5, 0.5, 1)" },
  )
}

function flash(el: HTMLElement | null, color: string): void {
  if (!el) return
  el.animate(
    [{ boxShadow: `0 0 0 2px ${color}, 0 0 36px 4px ${color}` }, { boxShadow: "0 0 0 0 transparent" }],
    { duration: 900, easing: "ease-out" },
  )
}

/** カードが列を移った瞬間（ドロップ確定後）。XP はデータ層の返事を待って award() で出す */
export function cardMoved(taskId: number, to: TaskStatus, title?: string): void {
  if (to === "todo") return
  if (to === "doing") {
    playGo()
    afterLanding(() => {
      const { x, y, el } = cardPoint(taskId)
      haptic("rumbleMid", { card: cardEl(taskId) })
      bounce(el)
      flash(el, "rgb(255 62 165 / 0.7)")
      burst({
        particleCount: 34,
        spread: 360,
        startVelocity: 20,
        gravity: 0.7,
        decay: 0.9,
        ticks: 70,
        scalar: 0.75,
        shapes: ["circle", "square"],
        colors: PINK,
        origin: { x: x / window.innerWidth, y: y / window.innerHeight },
      })
      floatText(pick(GO_WORDS), x, y - 34, {
        className: "kb-pop",
        size: 30,
        gradient: "linear-gradient(90deg, #ff3ea5, #ff8a1f, #ffd23f)",
        duration: 1000,
      })
    })
    return
  }
  // done: フェス演出（前のショーが残っていれば素早く畳んでから）
  const prev = show
  const next = new FestShow({
    taskId,
    title: title ?? "",
    reducedMotion: reducedMotion(),
    fire: confettiFire,
    onEnd: () => {
      if (show === next) show = null
      gate.end()
    },
  })
  gate.begin() // レベルアップはこのショーが終わるまで待たせる
  show = next
  prev?.cancel()
  afterLanding(() => {
    const { el } = cardPoint(taskId)
    bounce(el)
    flash(el, "rgb(163 255 60 / 0.7)")
    next.start()
  })
}

/** XP が付いたとき（カード位置に +XP、コンボは段階的に派手に） */
export function award(a: XpAward, taskId: number): void {
  claimed += a.xp
  // 「やった」の XP・コンボはフェス演出の中で大きく出す
  if (a.kind === "done" && show?.taskId === taskId) {
    show.setXp({ xp: a.xp, combo: a.combo })
    return
  }
  afterLanding(() => {
    const { x, y, rect } = cardPoint(taskId)
    // カードの右上から浮き上がる（タイトルに被らない）
    const px = rect ? rect.right - 44 : x
    const py = rect ? rect.top - 4 : y
    window.setTimeout(() => {
      floatText(`+${a.xp} XP`, px, py, { className: "kb-xp" })
      playXp()
    }, a.kind === "done" ? 180 : 120)
  })
}

/**
 * ポモドーロの集中を完了した。quiet = タイマーのチャイム（lib/timerChime.ts）が鳴るので
 * 効果音・重低音は重ねない（紙吹雪と文字だけ）
 */
export function focusDone(opts: { quiet?: boolean } = {}): void {
  if (!opts.quiet) {
    playFocus()
    haptic("focus")
  }
  const common = { spread: 80, startVelocity: 50, ticks: 150, colors: PINK.concat(DONE) }
  burst({ ...common, particleCount: 60, angle: 60, origin: { x: 0, y: 0.8 } })
  burst({ ...common, particleCount: 60, angle: 120, origin: { x: 1, y: 0.8 } })
  floatText("FOCUS CLEAR!", window.innerWidth / 2, window.innerHeight * 0.32, {
    className: "kb-pop",
    size: 48,
    gradient: "linear-gradient(90deg, #ff3ea5, #ff8a1f, #ffd23f)",
    duration: 1100,
  })
}

/**
 * ヘッダーの XP ゲージで増分を受け取る。ローカル操作で演出済みの分は差し引き、
 * それ以外（集中完了・他タブ）の分だけ返す。
 */
export function takeExternal(delta: number): number {
  const used = Math.min(claimed, delta)
  claimed -= used
  return delta - used
}

/** 画面の外（集中完了・他タブなど）で入った XP をヘッダーのゲージ付近に出す */
export function headerXp(delta: number): void {
  const gauge = document.querySelector<HTMLElement>("[data-xp-gauge]")
  const r = gauge?.getBoundingClientRect()
  const x = r && r.width > 0 ? r.left + r.width / 2 : window.innerWidth / 2
  const y = r && r.width > 0 ? r.bottom + 34 : 80
  floatText(`+${delta} XP`, x, y, { className: "kb-xp" })
  playXp()
}

/** レベルアップ（全画面。クリックか 2.6 秒で消える）。フェス演出の最中なら終わってから */
export function levelUp(level: number): void {
  gate.run(() => levelUpNow(level))
}

function levelUpNow(level: number): void {
  playLevelUp()
  haptic("rumbleMax")
  const el = document.createElement("div")
  el.className = "kb-levelup"
  el.setAttribute("role", "status")
  el.setAttribute("aria-live", "polite")
  const title = document.createElement("div")
  title.className = "kb-levelup-title"
  title.textContent = "LEVEL UP!"
  const sub = document.createElement("div")
  sub.className = "kb-levelup-sub"
  sub.textContent = `LV ${level - 1} → LV ${level}`
  el.append(title, sub)
  const close = () => el.remove()
  el.addEventListener("click", close)
  document.body.appendChild(el)
  window.setTimeout(close, 2600)
  for (let i = 0; i < 5; i++) {
    window.setTimeout(() => {
      burst({
        particleCount: 60,
        spread: 360,
        startVelocity: 38,
        ticks: 140,
        gravity: 0.7,
        shapes: ["star", "circle", "square"],
        colors: LEVEL,
        origin: { x: 0.15 + Math.random() * 0.7, y: 0.2 + Math.random() * 0.35 },
      })
    }, i * 260)
  }
}
