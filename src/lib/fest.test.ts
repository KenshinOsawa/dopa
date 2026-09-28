import { describe, expect, it, vi } from "vitest"
import {
  BEAT_MS,
  BPM,
  createShowGate,
  crowdSpec,
  DROP_MS,
  dropChord,
  FADE_MS,
  FEST_LOWPASS,
  festOutputs,
  festPeak,
  festRumble,
  festTier,
  festTimeline,
  FEVER_COMBO,
  riserSpec,
  shiftSpec,
} from "./fest"
import { ATTACK, MAX_GAIN, peakGain, VOLUME } from "./haptics"

const combos = [1, 2, 3, 4, 5, 6]

describe("festTier（コンボ段階）", () => {
  it("コンボが上がるほどレーザー・花火・持続・色数が増える（下がらない）", () => {
    const t = combos.map(festTier)
    for (let i = 1; i < t.length; i++) {
      expect(t[i].lasers).toBeGreaterThan(t[i - 1].lasers)
      expect(t[i].fireworks).toBeGreaterThan(t[i - 1].fireworks)
      expect(t[i].durationMs).toBeGreaterThanOrEqual(t[i - 1].durationMs)
      expect(t[i].colors.length).toBeGreaterThanOrEqual(t[i - 1].colors.length)
      expect(t[i].kicks).toBeGreaterThanOrEqual(t[i - 1].kicks)
    }
  })

  it("5 コンボ以上は FEVER（虹色 7 色）、4 までは通常", () => {
    expect(FEVER_COMBO).toBe(5)
    expect(festTier(4).fever).toBe(false)
    expect(festTier(5).fever).toBe(true)
    expect(festTier(5).colors).toHaveLength(7)
    expect(festTier(1).colors.length).toBeLessThan(festTier(4).colors.length)
  })

  it("全体は 3〜4 秒・キックは 2〜4 発・上限あり（巨大コンボでも暴れない）", () => {
    for (const c of [...combos, 20, 100]) {
      const t = festTier(c)
      expect(t.durationMs).toBeGreaterThanOrEqual(3000)
      expect(t.durationMs).toBeLessThanOrEqual(4000)
      expect(t.kicks).toBeGreaterThanOrEqual(2)
      expect(t.kicks).toBeLessThanOrEqual(4)
    }
    expect({ ...festTier(20), combo: 6 }).toEqual(festTier(6))
    expect(festTier(0).combo).toBe(1)
    expect(festTier(Number.NaN).lasers).toBe(festTier(1).lasers)
  })
})

describe("festTimeline", () => {
  it("BPM 128: ドロップは 1.5 拍後、ドロップ後の明滅とキックは拍の頭", () => {
    expect(BPM).toBe(128)
    expect(BEAT_MS).toBeCloseTo(468.75)
    for (const c of combos) {
      const tl = festTimeline(festTier(c))
      expect(tl.drop).toBe(DROP_MS)
      expect(DROP_MS).toBe(Math.round(BEAT_MS * 1.5))
      expect(tl.beatPulses.length).toBeGreaterThanOrEqual(2)
      expect(tl.beatPulses.length).toBeLessThanOrEqual(3)
      tl.beatPulses.forEach((t, i) => expect(Math.abs(t - (tl.drop + i * BEAT_MS))).toBeLessThanOrEqual(1))
      tl.kicks.forEach((t, i) => expect(Math.abs(t - (tl.drop + (i + 1) * BEAT_MS))).toBeLessThanOrEqual(1))
    }
  })

  it("フェーズの順序: ビルドアップ → ドロップ → 花火・雨 → XP → フェードアウト → 終了", () => {
    for (const c of combos) {
      const tier = festTier(c)
      const tl = festTimeline(tier)
      expect(Math.max(...tl.buildPulses)).toBeLessThan(tl.drop)
      expect(Math.min(...tl.buildPulses)).toBeGreaterThanOrEqual(0)
      expect(Math.min(...tl.fireworks)).toBeGreaterThan(tl.drop)
      expect(Math.max(...tl.fireworks)).toBeLessThan(tl.fadeAt)
      expect(Math.min(...tl.rain)).toBeGreaterThan(tl.drop)
      expect(tl.xpAt).toBeGreaterThan(tl.drop)
      expect(tl.xpAt + tl.xpMs).toBeLessThan(tl.fadeAt)
      expect(tl.end - tl.fadeAt).toBe(FADE_MS)
      expect(tl.end).toBe(tier.durationMs)
      expect(Math.max(...tl.kicks)).toBeLessThan(tl.end)
      expect(tl.lasers).toBe(tier.lasers)
    }
  })

  it("コンボが上がると花火が増える（持続の中に収まる範囲で）", () => {
    expect(festTimeline(festTier(5)).fireworks.length).toBeGreaterThan(festTimeline(festTier(1)).fireworks.length)
  })

  it("reduced-motion: 揺れ・フラッシュ・レーザー・サーチライト・花火・ビルドアップなし。文字はフェードだけ・紙吹雪は 1 回", () => {
    for (const c of [1, 5]) {
      const tl = festTimeline(festTier(c), true)
      expect(tl.drop).toBe(0)
      expect(tl.flashMs).toBe(0)
      expect(tl.lasers).toBe(0)
      expect(tl.lights).toBe(false)
      expect(tl.searchlights).toBe(false)
      expect(tl.shake).toBe(false)
      expect(tl.textMotion).toBe(false)
      expect(tl.fireworks).toEqual([])
      expect(tl.buildPulses).toEqual([])
      expect(tl.beatPulses).toEqual([])
      expect(tl.rain).toHaveLength(1)
      expect(tl.xpMs).toBe(0) // カウントアップしない（最終値を静かに出す）
      expect(tl.end).toBeLessThanOrEqual(3000)
    }
  })
})

describe("festOutputs（トグルの組み合わせ）", () => {
  const base = { reducedMotion: false, canVibrate: false }
  it("効果音オン・振動オン → ライザー・歓声・和音＋重低音（振動として）＋揺れ", () => {
    expect(festOutputs({ ...base, sound: true, vibration: true })).toEqual({
      riser: true,
      crowd: true,
      chord: true,
      kicks: "rumble",
      shake: true,
      vibrate: false,
    })
  })
  it("効果音オフ・振動オン → 重低音（インパクト＋キック）と揺れだけ", () => {
    expect(festOutputs({ ...base, sound: false, vibration: true })).toEqual({
      riser: false,
      crowd: false,
      chord: false,
      kicks: "rumble",
      shake: true,
      vibrate: false,
    })
  })
  it("効果音オン・振動オフ → ライザー・歓声・和音＋キック（効果音として 1 回だけ）、揺れ無し", () => {
    expect(festOutputs({ ...base, sound: true, vibration: false })).toEqual({
      riser: true,
      crowd: true,
      chord: true,
      kicks: "effects",
      shake: false,
      vibrate: false,
    })
  })
  it("両方オフ → 無音・揺れなし", () => {
    expect(festOutputs({ ...base, sound: false, vibration: false, canVibrate: true })).toEqual({
      riser: false,
      crowd: false,
      chord: false,
      kicks: null,
      shake: false,
      vibrate: false,
    })
  })
  it("reduced-motion: 揺れ無し・ライザー無し（ビルドアップが無い）、音と実振動は出す", () => {
    expect(festOutputs({ sound: true, vibration: true, reducedMotion: true, canVibrate: true })).toEqual({
      riser: false,
      crowd: true,
      chord: true,
      kicks: "rumble",
      shake: false,
      vibrate: true,
    })
  })
})

describe("音の設計（耳に刺さらない）", () => {
  it("全体の lowpass と帯域ノイズの中心は 4kHz 未満", () => {
    expect(FEST_LOWPASS).toBeLessThan(4000)
    const r = riserSpec()
    expect(r.noise.to).toBeLessThan(4000)
    expect(r.tone.to).toBeLessThan(4000)
    for (const c of combos) for (const b of crowdSpec(festTier(c)).bands) expect(b.freq).toBeLessThan(4000)
    for (const c of combos) for (const n of dropChord(festTier(c))) expect(n.freq).toBeLessThan(400)
  })

  it("ノイズは急に立ち上げない（ライザー・歓声のアタックは 15ms よりずっと遅い）", () => {
    expect(riserSpec().attack).toBeGreaterThan(0.3)
    expect(riserSpec().attack).toBeLessThan(riserSpec().dur)
    expect(riserSpec().release).toBeGreaterThanOrEqual(ATTACK * 2)
    for (const c of combos) expect(crowdSpec(festTier(c)).attack).toBeGreaterThanOrEqual(0.2)
  })

  it("音量は控えめ（VOLUME 0.35 が上限）", () => {
    expect(VOLUME).toBeCloseTo(0.35)
    expect(festPeak(5)).toBeCloseTo(VOLUME)
    for (const c of combos) {
      for (const b of crowdSpec(festTier(c)).bands) expect(festPeak(b.level)).toBeLessThanOrEqual(VOLUME)
      for (const n of dropChord(festTier(c))) expect(n.level).toBeLessThanOrEqual(1)
    }
  })

  it("インパクト＋キック: haptics の帯域ルール（サブ 45〜100Hz・ボディ 100〜150Hz・倍音 150〜250Hz・ノイズのノック無し）", () => {
    for (const c of combos) {
      const tier = festTier(c)
      const tl = festTimeline(tier)
      const spec = festRumble(tier, tl.kicks, tl.drop)
      expect(spec.hits).toHaveLength(1 + tier.kicks)
      expect(spec.hits[0].at).toBe(0)
      spec.hits.slice(1).forEach((h, i) => expect(h.at).toBeCloseTo(((i + 1) * BEAT_MS) / 1000, 2))
      for (const h of spec.hits) {
        expect(h.knock).toBeNull()
        expect(h.sub.from).toBeLessThanOrEqual(100)
        expect(h.sub.to).toBeGreaterThanOrEqual(45)
        expect(h.body!.freq).toBeGreaterThanOrEqual(100)
        expect(h.body!.freq).toBeLessThanOrEqual(150)
        expect(h.over!.freq).toBeLessThanOrEqual(250)
        expect(peakGain(h)).toBeLessThanOrEqual(MAX_GAIN * VOLUME)
      }
      expect(spec.shake?.scope).toBe("screen")
    }
    expect(festRumble(festTier(5), [], DROP_MS).shake!.px).toBeGreaterThan(festRumble(festTier(1), [], DROP_MS).shake!.px)
  })

  it("shiftSpec: hits を後ろへずらし、実振動は先頭に休みを入れる", () => {
    const s = festRumble(festTier(1), [1000], DROP_MS)
    const sh = shiftSpec(s, 0.5)
    expect(sh.hits[0].at).toBeCloseTo(0.5)
    expect(sh.vibrate.slice(0, 2)).toEqual([0, 500])
    expect(sh.vibrate.slice(2)).toEqual(s.vibrate)
  })
})

describe("createShowGate（レベルアップはショーの後に）", () => {
  it("ショー中は待たせ、終わったら順に実行（重ねない）", () => {
    const g = createShowGate()
    const f = vi.fn()
    g.run(f)
    expect(f).toHaveBeenCalledTimes(1) // ショーが無ければすぐ
    g.begin()
    const a = vi.fn()
    const b = vi.fn()
    g.run(a)
    g.run(b)
    expect(a).not.toHaveBeenCalled()
    g.end()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("次のショーが先に始まっていれば、その終わりまで待つ", () => {
    const g = createShowGate()
    const a = vi.fn()
    g.begin() // ショー 1
    g.run(a)
    g.begin() // ショー 2（1 をスキップして始まる）
    g.end() // ショー 1 が畳まれた
    expect(a).not.toHaveBeenCalled()
    expect(g.active).toBe(true)
    g.end()
    expect(a).toHaveBeenCalledTimes(1)
    g.end() // 余分な end は無視
    expect(g.active).toBe(false)
  })
})
