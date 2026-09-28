import { afterEach, describe, expect, it, vi } from "vitest"
import { saturationCurve } from "./audio"
import {
  ATTACK,
  canVibrate,
  comboSpec,
  createThrottle,
  hapticsEnabled,
  hitLength,
  MAX_GAIN,
  outputs,
  peakGain,
  play,
  PRESETS,
  setHapticsEnabled,
  shakeFrames,
  specLength,
  VOLUME,
} from "./haptics"
import { doneNotes, focusNotes, goNotes, levelUpNotes, SPARKLE_MAX, xpNotes } from "./sound"

describe("PRESETS（音の設計）", () => {
  const all = Object.entries(PRESETS)

  it("芯は 90〜100Hz → 45〜60Hz に落とすキック型サイン、ボディは 100〜150Hz、倍音は 150〜250Hz", () => {
    for (const [name, p] of all) {
      for (const h of p.hits) {
        expect(h.sub.from, name).toBeGreaterThanOrEqual(80)
        expect(h.sub.from, name).toBeLessThanOrEqual(100)
        expect(h.sub.to, name).toBeGreaterThanOrEqual(45)
        expect(h.sub.to, name).toBeLessThanOrEqual(60)
        expect(h.sub.decay, name).toBeGreaterThan(ATTACK * 2) // アタック後に減衰（クリック防止）
        if (h.body) {
          expect(h.body.freq, name).toBeGreaterThanOrEqual(100)
          expect(h.body.freq, name).toBeLessThanOrEqual(150)
        }
        if (h.over) {
          expect(h.over.freq, name).toBeGreaterThanOrEqual(150)
          expect(h.over.freq, name).toBeLessThanOrEqual(250)
        }
      }
    }
    expect(ATTACK).toBeGreaterThan(0)
  })

  it("全プリセット: ノイズのノック無し・アタックは低音 1 周期（~15ms）以上", () => {
    expect(ATTACK).toBeGreaterThanOrEqual(0.012)
    for (const [name, p] of Object.entries(PRESETS)) for (const h of p.hits) expect(h.knock, name).toBeNull()
  })

  it("やってる = 心拍「ドクン」: 二連打・間隔 0.2 秒・2 打目は 120Hz より上を出さない", () => {
    const [a, b] = PRESETS.rumbleMid.hits
    expect(PRESETS.rumbleMid.hits).toHaveLength(2)
    expect(b.at - a.at).toBeCloseTo(0.2)
    // ノイズのノックは耳に刺さるので使わない（耳が痛い「ボツボツ」になる）
    expect(a.knock).toBeNull()
    expect(b.over).toBeNull()
    expect(b.knock).toBeNull()
    expect(b.body?.freq ?? 0).toBeLessThanOrEqual(120)
  })

  it("持ち上げ = 「ぶぶぶ」: 間隔 60〜80ms の短い 3 連", () => {
    const hits = PRESETS.buzz.hits
    expect(hits).toHaveLength(3)
    for (let i = 1; i < 3; i++) {
      const gap = hits[i].at - hits[i - 1].at
      expect(gap).toBeGreaterThanOrEqual(0.06)
      expect(gap).toBeLessThanOrEqual(0.08)
    }
    for (const h of hits) expect(hitLength(h)).toBeLessThanOrEqual(0.08)
  })

  it("やった = 報酬インパクト: サブ + 強いボディ + 300〜600ms の低音テール", () => {
    const [h] = PRESETS.rumbleStrong.hits
    expect(h.sub.decay).toBeGreaterThanOrEqual(0.3)
    expect(h.sub.decay).toBeLessThanOrEqual(0.6)
    expect(h.body!.level).toBeGreaterThanOrEqual(0.8)
    expect(h.knock).toBeNull()
  })

  it("レベルアップ = インパクト×3 のうねり（だんだん強く）・約 1 秒以上・画面全体", () => {
    const hits = PRESETS.rumbleMax.hits
    expect(hits).toHaveLength(3)
    expect(hits[1].gain).toBeGreaterThan(hits[0].gain)
    expect(hits[2].gain).toBeGreaterThan(hits[1].gain)
    expect(specLength(PRESETS.rumbleMax)).toBeGreaterThanOrEqual(1)
    expect(PRESETS.rumbleMax.shake?.scope).toBe("screen")
  })

  it("tick はごく短い 1 発・小音量で揺らさない", () => {
    expect(PRESETS.tick.hits).toHaveLength(1)
    expect(specLength(PRESETS.tick)).toBeLessThan(0.1)
    expect(PRESETS.tick.hits[0].gain).toBeLessThan(PRESETS.thud.hits[0].gain)
    expect(PRESETS.tick.shake).toBeNull()
  })

  it("音量は上限で頭打ち", () => {
    const h = PRESETS.rumbleStrong.hits[0]
    expect(peakGain({ ...h, gain: 5 })).toBeCloseTo(MAX_GAIN * VOLUME)
    for (const [, p] of all) for (const x of p.hits) expect(peakGain(x)).toBeLessThanOrEqual(MAX_GAIN * VOLUME)
  })
})

describe("comboSpec", () => {
  it("コンボが上がるほどテールが長く・サブが強く、3 以上はボード全体を揺らす（上限は 6）", () => {
    const c2 = comboSpec(2).hits[0]
    const c4 = comboSpec(4).hits[0]
    const c6 = comboSpec(6).hits[0]
    expect(c4.sub.decay).toBeGreaterThan(c2.sub.decay)
    expect(c6.sub.decay).toBeGreaterThan(c4.sub.decay)
    expect(c6.sub.level!).toBeGreaterThan(c2.sub.level!)
    expect(comboSpec(2).shake?.scope).toBe("card")
    expect(comboSpec(3).shake?.scope).toBe("board")
    expect(comboSpec(6).shake!.px).toBeGreaterThan(comboSpec(3).shake!.px)
    expect(comboSpec(20)).toEqual(comboSpec(6))
  })
})

describe("効果音（lib/sound）も重く", () => {
  const seqs = { go: goNotes(), done: doneNotes(1), combo: doneNotes(5), xp: xpNotes(), focus: focusNotes(), levelUp: levelUpNotes() }
  it("主役は 400Hz 以下のトーン（矩形波なし）、高域はキラキラ扱いで小さく", () => {
    for (const [name, notes] of Object.entries(seqs)) {
      expect(notes.some((n) => !n.sparkle && n.freq <= 110), name).toBe(true) // 低音の芯がある
      for (const n of notes) {
        if (n.sparkle) expect(n.gain ?? 0, name).toBeLessThanOrEqual(SPARKLE_MAX)
        else if (name !== "combo") expect(n.freq, name).toBeLessThanOrEqual(400)
      }
    }
  })
})

describe("createThrottle", () => {
  it("同じキーは 300ms 以内に再発火しない", () => {
    const ok = createThrottle()
    expect(ok(1, 0)).toBe(true)
    expect(ok(1, 150)).toBe(false)
    expect(ok(1, 299)).toBe(false)
    expect(ok(1, 300)).toBe(true)
  })

  it("全体でも 80ms 間隔以上（別のキーでも）", () => {
    const ok = createThrottle()
    expect(ok(1, 0)).toBe(true)
    expect(ok(2, 40)).toBe(false)
    expect(ok(3, 79)).toBe(false)
    expect(ok(4, 80)).toBe(true)
    // 間引かれた発火は記録しない（キー 2 は 40ms で鳴っていない）
    expect(ok(2, 160)).toBe(true)
  })

  it("要素（オブジェクト）もキーにできる", () => {
    const ok = createThrottle()
    const a = {}
    const b = {}
    expect(ok(a, 0)).toBe(true)
    expect(ok(b, 100)).toBe(true)
    expect(ok(a, 200)).toBe(false)
    expect(ok(a, 400)).toBe(true)
  })
})

describe("outputs（トグルの組み合わせ）", () => {
  const base = { reducedMotion: false, canVibrate: false }
  it("効果音オン・振動オン → 全部", () => {
    expect(outputs({ ...base, sound: true, vibration: true })).toEqual({
      effects: true,
      rumble: true,
      vibrate: false,
      shake: true,
    })
  })
  it("効果音オフ・振動オン → 重低音と揺れだけ", () => {
    const o = outputs({ ...base, sound: false, vibration: true })
    expect(o.effects).toBe(false)
    expect(o.rumble).toBe(true)
    expect(o.shake).toBe(true)
  })
  it("効果音オン・振動オフ → 効果音だけ", () => {
    expect(outputs({ ...base, sound: true, vibration: false })).toEqual({
      effects: true,
      rumble: false,
      vibrate: false,
      shake: false,
    })
  })
  it("両方オフ → 無音・揺れなし", () => {
    expect(Object.values(outputs({ ...base, sound: false, vibration: false, canVibrate: true }))).toEqual([
      false,
      false,
      false,
      false,
    ])
  })
  it("reduced-motion は視覚の揺れだけ抑える", () => {
    const o = outputs({ sound: true, vibration: true, reducedMotion: true, canVibrate: true })
    expect(o).toEqual({ effects: true, rumble: true, vibrate: true, shake: false })
  })
  it("実振動は vibrate が使える環境だけ", () => {
    expect(outputs({ ...base, sound: true, vibration: true, canVibrate: true }).vibrate).toBe(true)
    expect(outputs({ ...base, sound: true, vibration: true, canVibrate: false }).vibrate).toBe(false)
  })
})

describe("canVibrate", () => {
  it("navigator.vibrate が関数のときだけ true", () => {
    expect(canVibrate({ vibrate: () => true })).toBe(true)
    expect(canVibrate({})).toBe(false)
    expect(canVibrate({ vibrate: true })).toBe(false)
    expect(canVibrate(undefined)).toBe(false)
  })
})

describe("shakeFrames / saturationCurve", () => {
  it("揺れは 0 から始まり 0 で終わり、振幅は px 以下で減衰する", () => {
    const f = shakeFrames(6, 10)
    expect(f[0].translate).toBe("0 0")
    expect(f[f.length - 1].translate).toBe("0 0")
    const xs = f.slice(1, -1).map((k) => Math.abs(parseFloat(String(k.translate))))
    expect(Math.max(...xs)).toBeLessThanOrEqual(6)
    expect(xs[xs.length - 1]).toBeLessThan(xs[0])
  })
  it("歪みカーブは -1〜1・単調増加", () => {
    const c = saturationCurve(0.5, 64)
    expect(c[0]).toBeCloseTo(-1)
    expect(c[63]).toBeCloseTo(1)
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1])
  })
})

describe("トグル", () => {
  afterEach(() => {
    setHapticsEnabled(true)
    vi.unstubAllGlobals()
  })
  it("既定オン・切り替えられる", () => {
    expect(hapticsEnabled()).toBe(true)
    setHapticsEnabled(false)
    expect(hapticsEnabled()).toBe(false)
  })
  it("振動オフなら navigator.vibrate も呼ばない", () => {
    const vibrate = vi.fn()
    vi.stubGlobal("navigator", { vibrate })
    setHapticsEnabled(false)
    play("buzz")
    expect(vibrate).not.toHaveBeenCalled()
  })
})
