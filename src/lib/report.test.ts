import { describe, expect, it } from "vitest"
import { buildReportText, oneLine, replaceNote, reportDateLabel, shiftDate } from "./report"

describe("今日やったことの本文", () => {
  it("今日やったこと → ✅ 完了 → やってること → 記号なしの doing → 一言。空行なし", () => {
    expect(buildReportText(["A", "B"], ["C", "D"], "一言")).toBe(
      "今日やったこと\n✅ A\n✅ B\nやってること\nC\nD\n一言",
    )
  })

  it("0 件のブロックは見出しごと省く（両方 0 件なら見出しだけ）", () => {
    expect(buildReportText([], ["C"], "一言")).toBe("やってること\nC\n一言")
    expect(buildReportText(["A"], [])).toBe("今日やったこと\n✅ A")
    expect(buildReportText([], [], "一言")).toBe("今日やったこと\n一言")
  })

  it("一言が空なら付かない・改行は 1 行にまとめる・空タイトルは飛ばす", () => {
    expect(buildReportText(["A\nx"], [" "], "  ")).toBe("今日やったこと\n✅ A x")
    expect(buildReportText([], [])).toBe("今日やったこと")
    expect(oneLine("  a \n\n b ")).toBe("a b")
  })
})

describe("編集した本文の一言の差し替え", () => {
  const body = "今日やったこと\n✅ A"
  it("末尾が前の一言ならその行を置き換える", () => {
    expect(replaceNote(`${body}\n前`, "前", "次")).toBe(`${body}\n次`)
  })
  it("空にしたら行ごと消す", () => {
    expect(replaceNote(`${body}\n前`, "前", "")).toBe(body)
  })
  it("一言が無かった・手で消した場合は末尾に付け足す", () => {
    expect(replaceNote(body, "", "次")).toBe(`${body}\n次`)
    expect(replaceNote(`${body}\n手で足した行`, "前", "次")).toBe(`${body}\n手で足した行\n次`)
  })
  it("見出ししか無いときに見出しを消さない", () => {
    expect(replaceNote("今日やったこと", "今日やったこと", "")).toBe("今日やったこと")
  })
  it("末尾の空行は詰める", () => {
    expect(replaceNote(`${body}\n\n`, "", "次")).toBe(`${body}\n次`)
  })
})

describe("日付", () => {
  it("前後の日へ（月・年またぎ）", () => {
    expect(shiftDate("2026-09-28", -1)).toBe("2026-09-27")
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01")
    expect(shiftDate("2027-01-01", -1)).toBe("2026-12-31")
  })
  it("ラベル", () => {
    expect(reportDateLabel("2026-09-28")).toBe("9/28(月)")
  })
})

describe("未着手ブロック", () => {
  it("やってることの後に「未着手」見出しと todo（記号なし）", () => {
    expect(buildReportText(["A"], ["B"], "一言", ["C", "D"])).toBe(
      "今日やったこと\n✅ A\nやってること\nB\n未着手\nC\nD\n一言",
    )
    expect(buildReportText([], [], "", ["C"])).toBe("未着手\nC")
  })
})
