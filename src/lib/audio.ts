/**
 * 演出の音（lib/sound.ts の効果音・lib/haptics.ts の重低音）で共有する AudioContext と出力段。
 *
 * - 出力段は 30Hz ハイパス → 軽いサチュレーション → DynamicsCompressor（リミッター寄り）→ destination。
 *   効果音と重低音が同時に鳴ってもクリップしない
 * - 自動再生ポリシー: ユーザー操作（pointerdown / keydown）の後で作る・resume する。
 *   それより前は `{ create: false }` で呼ぶと null（ホバーだけでは鳴らさない）
 * - ポモドーロのフェーズ切り替えの合図（lib/timerChime.ts）もこの出力段を通す（トグルは「タイマー音」で別）
 */

let ctx: AudioContext | null = null
let out: AudioNode | null = null
let gestured = false

/** ユーザー操作があったか（AudioContext を作ってよいか） */
export function hasUserGesture(): boolean {
  return gestured
}

/**
 * 最初のユーザー操作で AudioContext を起こす。main.tsx から 1 回だけ呼ぶ。
 * capture で拾うので、stopPropagation しているボタン（カードの ▶ 等）でも効く。
 */
export function installAudioUnlock(): void {
  const unlock = () => {
    gestured = true
    const ac = getAudio()
    if (ac && ac.state === "running") {
      window.removeEventListener("pointerdown", unlock, true)
      window.removeEventListener("keydown", unlock, true)
    }
  }
  window.addEventListener("pointerdown", unlock, true)
  window.addEventListener("keydown", unlock, true)
}

/**
 * 共有の AudioContext。create=false のときは既に動いている場合だけ返す
 * （ユーザー操作前のホバー等で新しく作らない・suspended を起こそうとしない）。
 */
export function getAudio(opts: { create?: boolean } = {}): AudioContext | null {
  const create = opts.create ?? true
  try {
    if (!ctx) {
      if (!create || typeof AudioContext === "undefined") return null
      ctx = new AudioContext()
    }
    if (ctx.state === "suspended") {
      if (!create) return null
      void ctx.resume()
    }
    return ctx
  } catch {
    return null
  }
}

/** tanh の柔らかいサチュレーション（drive 0〜1）。-1〜1 → -1〜1 の単調増加 */
export function saturationCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const k = 1 + Math.max(0, Math.min(1, drive)) * 8
  const c = new Float32Array(n)
  const norm = Math.tanh(k)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(k * x) / norm
  }
  return c
}

/**
 * 出力段を組む: 30Hz 以下を切るハイパス（低音を上げても全体が濁らない・スピーカーを守る）
 * → 軽いサチュレーション（倍音で内蔵スピーカーでも低音を感じさせる・音圧）
 * → コンプレッサー（リミッター寄り。クリップさせない）→ dest。入口のノードを返す。
 * OfflineAudioContext でも同じ段を組める（帯域の検証用）。
 */
export function buildOutput(ac: BaseAudioContext, dest: AudioNode): AudioNode {
  const hp = ac.createBiquadFilter()
  hp.type = "highpass"
  hp.frequency.value = 30
  hp.Q.value = 0.7
  const shaper = ac.createWaveShaper()
  shaper.curve = saturationCurve(0.01)
  shaper.oversample = "4x"
  const comp = ac.createDynamicsCompressor()
  // 速いアタック×高レシオは低音の波形そのものを潰して歪む（ボツボツの一因）。ゆっくり・浅めに
  comp.threshold.value = -18
  comp.knee.value = 12
  comp.ratio.value = 4
  comp.attack.value = 0.02
  comp.release.value = 0.2
  hp.connect(shaper).connect(comp).connect(dest)
  return hp
}

/** 最後段（ハイパス → サチュレーション → コンプレッサー → スピーカー）。ここに繋ぐ */
export function audioOut(ac: AudioContext): AudioNode {
  if (out && out.context === ac) return out
  out = buildOutput(ac, ac.destination)
  return out
}
