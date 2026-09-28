/// <reference types="node" />
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EVENT_COLORS } from "./calendar"
import { applyPhaseTheme, FADE_MS, FADE_MS_REDUCED, fadeMs, themePhaseOf, type ThemeRoot } from "./phaseTheme"
import { ringDashOffset, ringProgress } from "./ring"

// vitest は CSS の import を空にするので、ファイルをそのまま読む
const readCss = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const indexCss = readCss("../index.css")
const phaseCss = readCss("../styles/phase.css")

function root(phase?: string): ThemeRoot {
  const dataset: DOMStringMap = {}
  if (phase) dataset.phase = phase
  return { dataset }
}

describe("テーマ属性（休憩中は明るいテーマ）", () => {
  afterEach(() => vi.useRealTimers())

  it("休憩フェーズ（計測中・一時停止中）は break、集中・待機・未取得は focus", () => {
    expect(themePhaseOf({ phase: "break" })).toBe("break")
    expect(themePhaseOf({ phase: "focus" })).toBe("focus")
    expect(themePhaseOf(undefined)).toBe("focus")
  })

  it("切り替え: data-phase を変え、フェード時間だけ data-phase-fade を付けて外す", () => {
    vi.useFakeTimers()
    const r = root("focus")
    expect(applyPhaseTheme(r, "break", { animate: true })).toBe(true)
    expect(r.dataset.phase).toBe("break")
    expect(r.dataset.phaseFade).toBe("")
    vi.advanceTimersByTime(FADE_MS - 50)
    expect(r.dataset.phaseFade).toBe("")
    vi.advanceTimersByTime(400)
    expect(r.dataset.phaseFade).toBeUndefined()
  })

  it("reduced-motion はフェードを短く（0.3 秒）", () => {
    vi.useFakeTimers()
    const r = root("break")
    applyPhaseTheme(r, "focus", { animate: true, reducedMotion: true })
    vi.advanceTimersByTime(FADE_MS_REDUCED + 200)
    expect(r.dataset.phaseFade).toBeUndefined()
    expect(fadeMs(true)).toBe(300)
    expect(fadeMs(false)).toBeGreaterThanOrEqual(1200)
    expect(fadeMs(false)).toBeLessThanOrEqual(2000)
  })

  it("最初の反映はフェードしない・同じフェーズなら何もしない", () => {
    const r = root()
    applyPhaseTheme(r, "break", { animate: false })
    expect(r.dataset.phase).toBe("break")
    expect(r.dataset.phaseFade).toBeUndefined()
    expect(applyPhaseTheme(r, "break", { animate: true })).toBe(false)
    expect(r.dataset.phaseFade).toBeUndefined()
  })

  it("CSS のフェード時間（--kb-fade）が JS と揃っている・属性で切り替える", () => {
    expect(phaseCss).toContain(`--kb-fade: ${FADE_MS / 1000}s`)
    expect(phaseCss).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--kb-fade: 0\.3s/)
    expect(phaseCss).toContain('html[data-phase="break"]')
    expect(phaseCss).toContain("html[data-phase-fade]")
    expect(indexCss).toContain('@custom-variant break (&:where([data-phase="break"], [data-phase="break"] *))')
  })
})

// ---------------------------------------------------------------- 可読性（コントラスト比）

function hex(v: string): [number, number, number] {
  const h = v.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
function mix(a: [number, number, number], b: [number, number, number], p: number): [number, number, number] {
  return a.map((v, i) => v * p + b[i] * (1 - p)) as [number, number, number]
}

/** 休憩テーマのブロックから `--name: #hex;` を拾う */
function breakVars(): Record<string, string> {
  const block = phaseCss.slice(phaseCss.indexOf('html[data-phase="break"] {'))
  const body = block.slice(0, block.indexOf("\n}"))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2]]))
}

describe("休憩テーマの可読性（4.5:1 以上）", () => {
  const v = breakVars()
  // 明るい背景: 地・白いカード/パネル・背景グラデの淡い水色とピーチ
  const grounds = [v["kb-void"], "#ffffff", "#e8f5fe", "#fff1e8"].map(hex)

  it("本文・補助の文字色（zinc 50〜500 の差し替え先）", () => {
    for (const shade of ["50", "100", "200", "300", "400", "500"]) {
      const fg = hex(v[`color-zinc-${shade}`])
      for (const bg of grounds) expect(contrast(fg, bg), `zinc-${shade}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(hex(v["kb-text"]), hex(v["kb-void"]))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex(v["kb-muted-text"]), hex("#ffffff"))).toBeGreaterThanOrEqual(4.5)
  })

  it("カレンダーの予定: 全色で帯の文字が読める（予定色 66% を濃紺に沈める）", () => {
    const pct = Number(/--kb-event-mix:\s*(\d+)%/.exec(phaseCss.slice(phaseCss.indexOf('html[data-phase="break"]')))?.[1])
    const sink = hex(v["kb-event-sink"])
    for (const [id, color] of Object.entries(EVENT_COLORS)) {
      const band = mix(hex(color), sink, pct / 100)
      const text = id === "5" ? hex("#1f1f1f") : hex("#ffffff")
      expect(contrast(band, text), `colorId ${id}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("パステルのボタン・休憩中の見出しの文字", () => {
    for (const bg of ["#fbcfe8", "#bae6fd", "#e0f2fe", "#ffedd5", "#effaff"]) {
      expect(contrast(hex("#0f172a"), hex(bg))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex(v["kb-ring-text"]), hex(bg))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex("#075985"), hex(bg))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe("進みリング", () => {
  it("経過で埋まる（0 → 1）・範囲外は丸める", () => {
    expect(ringProgress(60, 60)).toBe(0)
    expect(ringProgress(60, 30)).toBeCloseTo(0.5)
    expect(ringProgress(60, 0)).toBe(1)
    expect(ringProgress(60, 90)).toBe(0)
    expect(ringProgress(0, 10)).toBe(0)
  })

  it("dashoffset: 0 で円周ぶん隠れ、1 で全部見える", () => {
    expect(ringDashOffset(100, 0)).toBe(100)
    expect(ringDashOffset(100, 0.25)).toBe(75)
    expect(ringDashOffset(100, 1)).toBe(0)
    expect(ringDashOffset(100, 2)).toBe(0)
  })
})
