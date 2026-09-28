import { describe, expect, it } from "vitest"
import { award, takeExternal } from "./celebrate"
import type { XpAward } from "@/types"

describe("takeExternal", () => {
  it("ローカルで演出済みの XP を差し引き、残り（集中完了・他タブ等）だけ返す", () => {
    const a = { event_id: 1, kind: "done", xp: 25, combo: 2, bonus: 5 } as XpAward
    // DOM が無い環境でも claim だけは記録される（演出はタイマー内で行う）
    globalThis.window ??= { setTimeout: () => 0 } as unknown as Window & typeof globalThis
    award(a, 1)
    expect(takeExternal(25)).toBe(0)
    expect(takeExternal(20)).toBe(20)
    award({ ...a, xp: 5 }, 2)
    expect(takeExternal(20)).toBe(15)
    expect(takeExternal(3)).toBe(3)
  })
})
