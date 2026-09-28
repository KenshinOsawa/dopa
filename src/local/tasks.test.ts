import { beforeEach, describe, expect, it } from "vitest"
import { at, freshDb } from "@/test/db"
import { exportData, importData, parseBackup, wipeAll } from "./backup"
import { getDb } from "./db"
import { finishWelcome, isWelcomed, SAMPLE_CARDS } from "./welcome"
import { createTask, deleteTask, importText, listTasks, moveTask, updateTask, upsertMany } from "./tasks"
import { getXpStats } from "./xpStats"
import { applyMove } from "@/lib/format"

const T0 = at("2026-09-29T10:00:00")
const col = async (status: string) => (await listTasks()).filter((t) => t.status === status).map((t) => t.title)

beforeEach(freshDb)

describe("カードの保存（IndexedDB）", () => {
  it("追加は列の末尾。before_id でその直前に入る", async () => {
    await createTask({ title: "A" }, T0)
    const b = await createTask({ title: "B" }, T0)
    await createTask({ title: "C", before_id: b.id }, T0)
    expect(await col("todo")).toEqual(["A", "C", "B"])
  })

  it("start だけなら date を補完・終了だけ/逆順はエラー・空タイトルはエラー", async () => {
    const t = await createTask({ title: "会議", start_at: "2026-09-30T13:00:00+09:00" }, T0)
    expect(t.date).toBe("2026-09-30")
    await expect(createTask({ title: "x", end_at: "2026-09-30T13:00:00+09:00" })).rejects.toThrow("終了時刻だけ")
    await expect(
      createTask({ title: "x", start_at: "2026-09-30T13:00:00+09:00", end_at: "2026-09-30T12:00:00+09:00" }),
    ).rejects.toThrow("終了は開始より後")
    await expect(createTask({ title: "  " })).rejects.toThrow("タイトル")
  })

  it("移動: before_id の直前に置き列を振り直す（画面の applyMove と同じ結果）", async () => {
    const ids: number[] = []
    for (let i = 1; i <= 12; i++) ids.push((await createTask({ title: `T${i}` }, T0)).id)
    const before = await listTasks()
    // 8 番目を 9 と 10 の隙間へ（= 10 番目の直前）
    await moveTask(ids[7], "todo", ids[9], T0)
    const after = await col("todo")
    expect(after.slice(6, 10)).toEqual(["T7", "T9", "T8", "T10"])
    const predicted = applyMove(before, ids[7], "todo", ids[9])
      .filter((t) => t.status === "todo")
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => t.title)
    expect(after).toEqual(predicted)
  })

  it("done_at: done に入れた時刻・done 内の並べ替えでは変えない・戻したら null", async () => {
    const a = await createTask({ title: "A" }, T0)
    const b = await createTask({ title: "B" }, T0)
    const moved = await moveTask(a.id, "done", null, T0 + 1000)
    expect(moved.done_at).toBe("2026-09-29T10:00:01+09:00")
    await moveTask(b.id, "done", null, T0 + 2000)
    const again = await moveTask(a.id, "done", null, T0 + 60_000)
    expect(again.done_at).toBe("2026-09-29T10:00:01+09:00")
    expect((await moveTask(a.id, "todo", null, T0)).done_at).toBeNull()
  })

  it("XP はカードごと・kind ごとに初回だけ（行ったり来たりで稼げない）", async () => {
    const a = await createTask({ title: "A" }, T0)
    expect((await moveTask(a.id, "doing", null, T0)).xp?.xp).toBe(5)
    const done = await moveTask(a.id, "done", null, T0 + 1000)
    expect(done.xp).toMatchObject({ xp: 20, combo: 1 })
    expect(done.xp?.stats.total_xp).toBe(25)
    await moveTask(a.id, "todo", null, T0 + 2000)
    expect((await moveTask(a.id, "doing", null, T0 + 3000)).xp).toBeNull()
    expect((await moveTask(a.id, "done", null, T0 + 4000)).xp).toBeNull()
    // 同じ列内の並べ替えは XP なし
    const b = await createTask({ title: "B", status: "done" }, T0)
    expect((await moveTask(b.id, "done", a.id, T0)).xp).toBeNull()
    expect((await getXpStats(T0 + 5000)).total_xp).toBe(25)
  })

  it("コンボ: 10 分以内に続けて「やった」", async () => {
    const xs = []
    for (let i = 0; i < 3; i++) {
      const t = await createTask({ title: `C${i}` }, T0)
      xs.push((await moveTask(t.id, "done", null, T0 + i * 5 * 60_000)).xp)
    }
    expect(xs.map((x) => [x?.combo, x?.bonus])).toEqual([
      [1, 0],
      [2, 5],
      [3, 10],
    ])
  })

  it("編集・論理削除（一覧から消えるが行は残る）", async () => {
    const a = await createTask({ title: "A" }, T0)
    await updateTask(a.id, { title: "A2", note: "メモ", start_at: "2026-09-29T09:00:00+09:00", end_at: "2026-09-29T10:00:00+09:00" }, T0)
    expect((await listTasks())[0]).toMatchObject({ title: "A2", note: "メモ", date: "2026-09-29" })
    await deleteTask(a.id, T0)
    expect(await listTasks()).toEqual([])
    expect((await (await getDb()).get("tasks", a.id))?.deleted_at).not.toBeNull()
    await expect(updateTask(a.id, { title: "x" })).rejects.toThrow("見つかりません")
  })

  it("一括取り込み: 同じタイトル＋同じ日付は上書き（二重に作らない・列は動かさない）", async () => {
    const r1 = await importText("9/29 やること\n1. 資料\n2. 電話", null, T0)
    expect(r1).toMatchObject({ created: 2, updated: 0 })
    const phone = r1.tasks[1]
    await moveTask(phone.id, "doing", null, T0)
    const r2 = await importText("9/29\n1. 資料\n　追記メモ\n2. 【15:00〜15:30】電話\n3. 新しい", null, T0)
    expect(r2).toMatchObject({ created: 1, updated: 2 })
    const all = await listTasks()
    expect(all).toHaveLength(3)
    expect(all.find((t) => t.title === "資料")?.note).toBe("追記メモ")
    expect(all.find((t) => t.title === "電話")).toMatchObject({ status: "doing", start_at: "2026-09-29T15:00:00+09:00" })
    await expect(importText("   \n", null, T0)).rejects.toThrow()
  })

  it("upsertMany は日付違いなら別カード", async () => {
    await upsertMany([{ title: "X", date: "2026-09-29" }, { title: "X", date: "2026-09-30" }, { title: "X" }])
    expect(await listTasks()).toHaveLength(3)
  })
})

describe("ウェルカム・エクスポート/インポート/全削除", () => {
  it("初回はウェルカム → サンプル 3 枚 → 2 回目は出ない", async () => {
    expect(await isWelcomed()).toBe(false)
    await finishWelcome(true)
    expect(await isWelcomed()).toBe(true)
    expect(await col("todo")).toEqual(SAMPLE_CARDS.map((c) => c.title))
  })

  it("書き出し → 全削除 → 読み込みで元どおり（ID・XP・設定も）", async () => {
    await finishWelcome(true)
    const t = (await listTasks())[0]
    await moveTask(t.id, "done", null, T0)
    const backup = await exportData(T0)
    expect(backup).toMatchObject({ app: "dopa", version: 1 })
    const json = JSON.stringify(backup)

    await wipeAll()
    expect(await listTasks()).toEqual([])
    expect(await isWelcomed()).toBe(false)
    expect((await getXpStats(T0)).total_xp).toBe(0)

    await importData(parseBackup(json))
    expect((await listTasks()).map((x) => [x.id, x.title, x.status])).toEqual(
      (backup.data.tasks as { id: number; title: string; status: string }[]).map((x) => [x.id, x.title, x.status]),
    )
    expect(await isWelcomed()).toBe(true)
    expect((await getXpStats(T0)).total_xp).toBe(20)
    // 読み込み後の新規カードは ID が衝突しない
    const n = await createTask({ title: "new" }, T0)
    expect(n.id).toBeGreaterThan(Math.max(...(backup.data.tasks as { id: number }[]).map((x) => x.id)))
  })

  it("よそのファイルは読み込まない", () => {
    expect(() => parseBackup("{")).toThrow("JSON")
    expect(() => parseBackup(JSON.stringify({ app: "other", version: 1, data: {} }))).toThrow("dopa")
    expect(() => parseBackup(JSON.stringify({ app: "dopa", version: 99, data: {} }))).toThrow("新しい版")
    expect(() => parseBackup(JSON.stringify({ app: "dopa", version: 1, data: { tasks: {} } }))).toThrow("形式")
  })
})
