import { describe, expect, it } from "vitest"
import { ATTACK, MAX_GAIN, VOLUME } from "./haptics"
import {
  CHIME_LOWPASS,
  CHIME_MAX_HZ,
  CHIMES,
  chimeLength,
  maxToneHz,
  peakToneSum,
  renderChime,
  toneCentroid,
} from "./timerChime"

/** 呼ばれた WebAudio の操作を記録するだけの偽 AudioContext */
function fakeContext() {
  const log = { oscFreqs: [] as number[], ramps: [] as { t0: number; t1: number; to: number }[], buffers: 0, filters: [] as { type: string; freq: number }[] }
  const param = (init = 0, isGain = false) => {
    let last = { t: 0, v: init }
    return {
      value: init,
      setValueAtTime(v: number, t: number) {
        last = { t, v }
      },
      exponentialRampToValueAtTime(v: number, t: number) {
        if (isGain) log.ramps.push({ t0: last.t, t1: t, to: v })
        last = { t, v }
      },
    }
  }
  const node = () => ({ connect: (n: unknown) => n, disconnect() {} })
  const ac = {
    currentTime: 0,
    sampleRate: 48000,
    createOscillator() {
      const frequency = param()
      const o = {
        ...node(),
        type: "sine",
        frequency: {
          ...frequency,
          setValueAtTime(v: number, t: number) {
            log.oscFreqs.push(v)
            frequency.setValueAtTime(v, t)
          },
          exponentialRampToValueAtTime(v: number, t: number) {
            log.oscFreqs.push(v)
            frequency.exponentialRampToValueAtTime(v, t)
          },
        },
        start() {},
        stop() {},
        onended: null as unknown,
      }
      return o
    },
    createGain() {
      return { ...node(), gain: param(1, true) }
    },
    createBiquadFilter() {
      const f = { ...node(), type: "lowpass", frequency: param(), Q: param() }
      queueMicrotask(() => log.filters.push({ type: f.type, freq: f.frequency.value }))
      return f
    },
    createBufferSource() {
      log.buffers++
      return { ...node(), start() {}, stop() {} }
    },
    createBuffer() {
      log.buffers++
      return { getChannelData: () => new Float32Array(1) }
    },
  }
  return { ac: ac as unknown as BaseAudioContext, log }
}

describe("フェーズ切り替えのチャイム（音の設計）", () => {
  const all = Object.entries(CHIMES)

  it("高域は 3.5kHz 以下（倍音込み）・トーンは 3.2kHz の lowpass を通す", () => {
    expect(CHIME_LOWPASS).toBeLessThanOrEqual(CHIME_MAX_HZ)
    expect(CHIME_MAX_HZ).toBeLessThanOrEqual(3500)
    for (const [name, c] of all) expect(maxToneHz(c), name).toBeLessThanOrEqual(CHIME_MAX_HZ)
  })

  it("アタックは 15ms 以上・ノイズのクリック無し", () => {
    for (const [name, c] of all) {
      for (const t of c.tones) expect(t.attack, name).toBeGreaterThanOrEqual(0.015)
      for (const h of c.hits) expect(h.knock, name).toBeNull()
    }
    expect(ATTACK).toBeGreaterThanOrEqual(0.015)
  })

  it("音量は VOLUME 基準: 1 音は MAX_GAIN 以下、重なった和音の合計も 1（= VOLUME）を超えない", () => {
    for (const [name, c] of all) {
      for (const t of c.tones) expect(t.gain, name).toBeLessThanOrEqual(MAX_GAIN)
      for (const h of c.hits) expect(h.gain, name).toBeLessThanOrEqual(MAX_GAIN)
      expect(peakToneSum(c), name).toBeLessThanOrEqual(1)
    }
  })

  it("聞き分け: 休憩へ = ドゥン 1 発 → 上行チャイム / 集中へ = ドクン二連打 → 同時に鳴る低い和音", () => {
    const toBreak = CHIMES.toBreak
    const toFocus = CHIMES.toFocus
    expect(toBreak.hits).toHaveLength(1)
    expect(toFocus.hits).toHaveLength(2)
    expect(toFocus.hits[1].at - toFocus.hits[0].at).toBeCloseTo(0.2)
    // 休憩へ: 2〜3 音が時間差で上がっていく
    expect(toBreak.tones.length).toBeGreaterThanOrEqual(2)
    expect(toBreak.tones.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < toBreak.tones.length; i++) {
      expect(toBreak.tones[i].at).toBeGreaterThan(toBreak.tones[i - 1].at)
      expect(toBreak.tones[i].freq).toBeGreaterThan(toBreak.tones[i - 1].freq)
    }
    // 集中へ: 和音は同時・低め・短め
    expect(new Set(toFocus.tones.map((t) => t.at)).size).toBe(1)
    expect(toneCentroid(toBreak)).toBeGreaterThan(toneCentroid(toFocus) * 1.3)
    expect(Math.min(...toFocus.tones.map((t) => t.freq))).toBeLessThan(Math.min(...toBreak.tones.map((t) => t.freq)))
    expect(chimeLength(toBreak)).toBeGreaterThan(chimeLength(toFocus))
    // どちらも 3 秒以内に収まる
    for (const [name, c] of all) expect(chimeLength(c), name).toBeLessThanOrEqual(3)
  })

  it("描画: ノイズバッファを作らない・発振は 3.5kHz 以下・立ち上がりは 15ms 以上かけて 0 付近から", async () => {
    for (const [name, c] of all) {
      const { ac, log } = fakeContext()
      renderChime(ac, c, { connect: () => {} } as unknown as AudioNode, 0, VOLUME)
      await Promise.resolve()
      expect(log.buffers, name).toBe(0)
      expect(Math.max(...log.oscFreqs), name).toBeLessThanOrEqual(CHIME_MAX_HZ)
      // 立ち上がり（値が上がるランプ）はすべて ATTACK 以上の長さ
      const rises = log.ramps.filter((r) => r.to > 0.001)
      expect(rises.length, name).toBeGreaterThan(0)
      for (const r of rises) expect(r.t1 - r.t0, name).toBeGreaterThanOrEqual(ATTACK - 1e-9)
      // ピークは VOLUME × MAX_GAIN を超えない
      for (const r of rises) expect(r.to, name).toBeLessThanOrEqual(VOLUME * MAX_GAIN + 1e-9)
      expect(log.filters.every((f) => f.type !== "lowpass" || f.freq <= CHIME_MAX_HZ), name).toBe(true)
    }
  })
})
