import { describe, expect, it } from "vitest"
import { inferYear, parseDateHeading, parseText, parseTimeRange } from "./importer"

const TODAY = "2026-09-29"

describe("parseText（テキストから一括）", () => {
  it("日付見出し・番号行・字下げ note・【HH:MM〜】", () => {
    const text = [
      "9/27(日) やること",
      "1. 企画書のたたき台を作る",
      "2) 資料を読む",
      "　https://example.com/doc",
      "  二行目のメモ",
      "【19:30〜】電話",
      "・【19:00–20:15】打ち合わせ",
    ].join("\n")
    const items = parseText(text, null, TODAY)
    expect(items.map((i) => i.title)).toEqual(["企画書のたたき台を作る", "資料を読む", "電話", "打ち合わせ"])
    expect(items.every((i) => i.date === "2026-09-27")).toBe(true)
    expect(items[1].note).toBe("https://example.com/doc\n二行目のメモ")
    expect(items[2].start_at).toBe("2026-09-27T19:30:00+09:00")
    expect(items[2].end_at).toBeNull()
    expect(items[3].start_at).toBe("2026-09-27T19:00:00+09:00")
    expect(items[3].end_at).toBe("2026-09-27T20:15:00+09:00")
  })

  it("見出しは複数あれば都度切り替え。見出しが無ければ既定日", () => {
    const items = parseText("やること:\nA\n9/30 予定\nB\n10/1\nC", "2026-09-28", TODAY)
    expect(items.map((i) => [i.title, i.date])).toEqual([
      ["A", "2026-09-28"],
      ["B", "2026-09-30"],
      ["C", "2026-10-01"],
    ])
  })

  it("# 見出し・末尾コロン・空行は無視。先頭の字下げ行はカードになる", () => {
    const items = parseText("  先頭の字下げ\n\n# 見出し\nメモ：\n- 箇条書き", null, TODAY)
    expect(items.map((i) => i.title)).toEqual(["先頭の字下げ", "箇条書き"])
  })

  it("時刻だけ・日付なしは今日。日をまたぐ終了は翌日", () => {
    const [a] = parseText("【23:30〜0:30】夜更かし", null, TODAY)
    expect(a.date).toBe(TODAY)
    expect(a.start_at).toBe("2026-09-29T23:30:00+09:00")
    expect(a.end_at).toBe("2026-09-30T00:30:00+09:00")
    const [b] = parseText("【10:00】", null, TODAY)
    expect(b.title).toBe("(無題)")
  })

  it("年なし日付は今日に最も近い年（年末に 1/2 と書けば翌年）", () => {
    expect(inferYear(1, 2, "2026-12-31")).toBe("2027-01-02")
    expect(inferYear(12, 30, "2027-01-02")).toBe("2026-12-30")
    expect(parseDateHeading("2025/3/4 やること", TODAY)).toBe("2025-03-04")
    expect(parseDateHeading("9/31", TODAY)).toBeNull() // 存在しない日付
    expect(parseDateHeading("9/27 買い物に行く", TODAY)).toBeNull() // 見出しでなくタスク
  })

  it("parseTimeRange", () => {
    expect(parseTimeRange("19:30-20:30", TODAY)).toEqual(["2026-09-29T19:30:00+09:00", "2026-09-29T20:30:00+09:00"])
    expect(parseTimeRange("7：05〜", TODAY)).toEqual(["2026-09-29T07:05:00+09:00", null])
    expect(() => parseTimeRange("夜", TODAY)).toThrow()
  })
})
