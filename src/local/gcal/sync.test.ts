import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { at, freshDb } from "@/test/db"
import { FakeCalendar } from "@/test/fakeCalendar"
import { getDb } from "../db"
import { pomodoro } from "../pomodoro"
import { setSettings } from "../settings"
import { createTask, deleteTask, flushPush, listTasks, moveTask, updateTask } from "../tasks"
import { __setTokenForTests, authState, setManualClientId } from "./auth"
import { setClientFactory } from "./client"
import { installGcalHooks, pull, shouldImport, syncAll } from "./sync"
import { createEvent, deleteEvent, listDay, patchEvent } from "./view"

const T0 = at("2026-09-29T10:00:00")
let fake: FakeCalendar
let connected = true

beforeEach(async () => {
  await freshDb()
  fake = new FakeCalendar()
  connected = true
  setClientFactory(() => (connected ? fake : null))
  __setTokenForTests(null, true) // 「一度接続した端末」
  installGcalHooks()
})

afterEach(() => {
  setClientFactory(null)
  __setTokenForTests(null, false)
  setManualClientId("")
})

const row = async (id: number) => (await getDb()).get("tasks", id)

describe("接続状態（GIS のトークン）", () => {
  it("クライアント ID が無ければ unconfigured、あれば未接続/接続中/期限切れ", () => {
    setManualClientId("")
    expect(authState()).toBe("unconfigured")
    setManualClientId("123.apps.googleusercontent.com")
    __setTokenForTests(null, false)
    expect(authState()).toBe("disconnected")
    __setTokenForTests({ access_token: "t", expires_at: Date.now() + 3600_000 })
    expect(authState()).toBe("connected")
    // 期限切れ（1 分前から切れた扱い）→ 再接続待ち
    __setTokenForTests({ access_token: "t", expires_at: Date.now() + 30_000 })
    expect(authState()).toBe("expired")
  })

  it("トークンは localStorage に書かない（sessionStorage だけ）", () => {
    __setTokenForTests({ access_token: "secret-token", expires_at: Date.now() + 3600_000 })
    const all = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join()
    expect(all).not.toContain("secret-token")
    expect(sessionStorage.getItem("dopa:gcal-token")).toContain("secret-token")
  })
})

describe("push（カード → 予定）", () => {
  it("時刻付きカードは予定になり、done で ✅ ＋ colorId 8、時刻を外すと予定は消える", async () => {
    const t = await createTask({ title: "打ち合わせ", note: "資料", start_at: "2026-09-29T13:00:00+09:00" }, T0)
    await flushPush()
    const id = (await row(t.id))!.gcal_event_id!
    const ev = fake.events.get(id)!
    expect(ev.summary).toBe("打ち合わせ")
    expect(ev.end?.dateTime).toBe("2026-09-29T14:00:00+09:00") // 終了なしは 1 時間
    expect(ev.extendedProperties?.private).toMatchObject({ dopa: "1", cardId: String(t.id) })
    expect(ev.description).toContain(`dopa card #${t.id}`)

    await moveTask(t.id, "done", null, T0)
    await flushPush()
    expect(fake.events.get(id)).toMatchObject({ summary: "✅ 打ち合わせ", colorId: "8" })

    await moveTask(t.id, "todo", null, T0)
    await flushPush()
    expect(fake.events.get(id)).toMatchObject({ summary: "打ち合わせ", colorId: null })

    await updateTask(t.id, { start_at: null, end_at: null }, T0)
    await flushPush()
    expect(fake.events.has(id)).toBe(false)
    expect((await row(t.id))!.gcal_event_id).toBeNull()
  })

  it("カードを消すと予定も消える", async () => {
    const t = await createTask({ title: "X", start_at: "2026-09-29T13:00:00+09:00" }, T0)
    await flushPush()
    const id = (await row(t.id))!.gcal_event_id!
    await deleteTask(t.id, T0)
    await flushPush()
    expect(fake.events.has(id)).toBe(false)
  })

  it("未接続（期限切れ）のあいだは dirty にして、次の同期で送る", async () => {
    connected = false
    const t = await createTask({ title: "あとで", start_at: "2026-09-29T15:00:00+09:00" }, T0)
    await flushPush()
    expect((await row(t.id))!.gcal_dirty).toBe(true)
    connected = true
    const r = await syncAll(fake, T0)
    expect(r.pushed).toBe(1)
    expect((await row(t.id))!).toMatchObject({ gcal_dirty: false })
    expect(fake.events.size).toBe(1)
  })

  it("一度も接続していない端末では溜めない", async () => {
    connected = false
    __setTokenForTests(null, false)
    const t = await createTask({ title: "ローカルだけ", start_at: "2026-09-29T15:00:00+09:00" }, T0)
    await flushPush()
    expect((await row(t.id))!.gcal_dirty).toBe(false)
  })

  it("Google が失敗してもカード操作は止まらず dirty になる", async () => {
    fake.failNext = true
    const t = await createTask({ title: "失敗", start_at: "2026-09-29T15:00:00+09:00" }, T0)
    await flushPush()
    expect((await listTasks()).map((x) => x.title)).toEqual(["失敗"])
    expect((await row(t.id))!.gcal_dirty).toBe(true)
  })
})

describe("pull（予定 → カード）", () => {
  const timed = (id: string, summary: string, s: string, e: string, extra = {}) =>
    fake.seed({ id, summary, start: { dateTime: s }, end: { dateTime: e }, ...extra })

  it("単発・時刻付きだけ取り込む（繰り返し・終日・自作・集中記録・辞退・無回答の招待は除外）", async () => {
    timed("a", "歯医者", "2026-09-29T18:00:00+09:00", "2026-09-29T19:00:00+09:00")
    timed("b", "毎朝の運動", "2026-09-29T07:00:00+09:00", "2026-09-29T07:30:00+09:00", { recurringEventId: "r1" })
    fake.seed({ id: "c", summary: "連休", start: { date: "2026-09-30" }, end: { date: "2026-10-01" } })
    timed("d", "自作", "2026-09-29T12:00:00+09:00", "2026-09-29T13:00:00+09:00", { extendedProperties: { private: { dopa: "1" } } })
    timed("e", "集中｜x", "2026-09-29T09:00:00+09:00", "2026-09-29T09:25:00+09:00", { description: "── dopa pomodoro" })
    timed("f", "欠席", "2026-09-29T14:00:00+09:00", "2026-09-29T15:00:00+09:00", { attendees: [{ self: true, responseStatus: "declined" }] })
    timed("g", "無回答", "2026-09-29T16:00:00+09:00", "2026-09-29T17:00:00+09:00", { attendees: [{ self: true, responseStatus: "needsAction" }], organizer: { self: false } })
    timed("h", "来週すぎ", "2026-10-08T10:00:00+09:00", "2026-10-08T11:00:00+09:00")
    const r = await pull(fake, T0)
    expect(r.created).toBe(1)
    const cards = await listTasks()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ title: "歯医者", source: "calendar", status: "todo", date: "2026-09-29", gcal_event_id: "a" })
    expect(shouldImport({ id: "x", start: { dateTime: "2026-09-29T10:00:00+09:00" }, status: "cancelled" })).toBe(false)
  })

  it("冪等・時刻変更を反映・消えた予定のカードは片付く（done は記録として残す）", async () => {
    timed("a", "A", "2026-09-29T18:00:00+09:00", "2026-09-29T19:00:00+09:00")
    timed("b", "B", "2026-09-30T18:00:00+09:00", "2026-09-30T19:00:00+09:00")
    await pull(fake, T0)
    expect((await pull(fake, T0)).created).toBe(0)
    fake.events.get("a")!.start = { dateTime: "2026-09-29T20:00:00Z" } // オフセット違いでも揃える
    fake.events.get("a")!.end = { dateTime: "2026-09-29T21:00:00Z" }
    expect((await pull(fake, T0)).updated).toBe(1)
    const a = (await listTasks()).find((t) => t.title === "A")!
    expect(a.start_at).toBe("2026-09-30T05:00:00+09:00")
    const b = (await listTasks()).find((t) => t.title === "B")!
    await moveTask(b.id, "done", null, T0)
    await flushPush()
    fake.events.delete("a")
    fake.events.delete("b")
    const r = await pull(fake, T0)
    expect(r.removed).toBe(1)
    const left = await listTasks()
    expect(left.map((t) => [t.title, t.gcal_event_id])).toEqual([["B", null]])
  })

  it("取り込んだ予定を done にすると元の予定に ✅（元のタイトル・色は戻せる）", async () => {
    timed("a", "歯医者", "2026-09-29T18:00:00+09:00", "2026-09-29T19:00:00+09:00", { colorId: "5" })
    await pull(fake, T0)
    const card = (await listTasks())[0]
    await moveTask(card.id, "done", null, T0)
    await flushPush()
    expect(fake.events.get("a")).toMatchObject({ summary: "✅ 歯医者", colorId: "8" })
    // 次の pull でもタイトルは ✅ 抜きのまま
    await pull(fake, T0)
    expect((await listTasks())[0].title).toBe("歯医者")
    await moveTask(card.id, "doing", null, T0)
    await flushPush()
    expect(fake.events.get("a")).toMatchObject({ summary: "歯医者", colorId: "5" })
  })

  it("ボードから消した取り込みカードは復活しない（予定も消さない）", async () => {
    timed("a", "A", "2026-09-29T18:00:00+09:00", "2026-09-29T19:00:00+09:00")
    await pull(fake, T0)
    await deleteTask((await listTasks())[0].id, T0)
    await flushPush()
    expect(fake.events.has("a")).toBe(true)
    await pull(fake, T0)
    expect(await listTasks()).toEqual([])
  })
})

describe("1 日ビュー（予定の見たまま・動かす・作る・消す）", () => {
  it("種類・終日・繰り返し・招待の編集可否", async () => {
    fake.seed({ id: "r", summary: "定例", recurringEventId: "rr", start: { dateTime: "2026-09-29T09:00:00+09:00" }, end: { dateTime: "2026-09-29T09:30:00+09:00" }, organizer: { self: false } })
    fake.seed({ id: "all", summary: "休み", start: { date: "2026-09-29" }, end: { date: "2026-09-30" } })
    fake.seed({ id: "p", summary: "集中", description: "── dopa pomodoro", start: { dateTime: "2026-09-29T11:00:00+09:00" }, end: { dateTime: "2026-09-29T11:25:00+09:00" } })
    const t = await createTask({ title: "カード", start_at: "2026-09-29T15:00:00+09:00" }, T0)
    await flushPush()
    const day = await listDay("2026-09-29")
    expect(day.logged_in).toBe(true)
    const by = Object.fromEntries(day.events.map((e) => [e.title, e]))
    expect(by["定例"]).toMatchObject({ recurring: true, can_edit: false, kind: "event" })
    expect(by["休み"]).toMatchObject({ all_day: true, start_date: "2026-09-29", end_date: "2026-09-30" })
    expect(by["集中"].kind).toBe("pomodoro")
    expect(by["カード"]).toMatchObject({ kind: "card", task_id: t.id, start: "2026-09-29T15:00:00+09:00" })
  })

  it("未接続なら logged_in: false（Google には行かない）", async () => {
    connected = false
    const day = await listDay("2026-09-29")
    expect(day).toMatchObject({ logged_in: false, events: [] })
    expect(fake.calls).toEqual([])
  })

  it("カード由来の予定を動かすとカードも同じ時刻に", async () => {
    const t = await createTask({ title: "カード", start_at: "2026-09-29T15:00:00+09:00", end_at: "2026-09-29T16:00:00+09:00" }, T0)
    await flushPush()
    const id = (await row(t.id))!.gcal_event_id!
    const v = await patchEvent(id, { start: "2026-09-29T17:00:00+09:00", end: "2026-09-29T17:30:00+09:00" }, T0)
    expect(v).toMatchObject({ start: "2026-09-29T17:00:00+09:00", end: "2026-09-29T17:30:00+09:00", task_id: t.id })
    expect((await listTasks())[0]).toMatchObject({ start_at: "2026-09-29T17:00:00+09:00", end_at: "2026-09-29T17:30:00+09:00" })
    expect(fake.events.get(id)?.start?.dateTime).toBe("2026-09-29T17:00:00+09:00")
  })

  it("Google が失敗したらカードは動かさない", async () => {
    const t = await createTask({ title: "カード", start_at: "2026-09-29T15:00:00+09:00" }, T0)
    await flushPush()
    const id = (await row(t.id))!.gcal_event_id!
    fake.failNext = true
    await expect(patchEvent(id, { start: "2026-09-29T18:00:00+09:00", end: "2026-09-29T19:00:00+09:00" })).rejects.toThrow()
    expect((await listTasks())[0].start_at).toBe("2026-09-29T15:00:00+09:00")
  })

  it("繰り返し予定はこの回（インスタンス ID）だけ patch", async () => {
    fake.seed({ id: "inst_20260929", summary: "定例", recurringEventId: "rr", start: { dateTime: "2026-09-29T09:00:00+09:00" }, end: { dateTime: "2026-09-29T09:30:00+09:00" } })
    await patchEvent("inst_20260929", { start: "2026-09-29T10:00:00+09:00", end: "2026-09-29T10:30:00+09:00" })
    expect(fake.calls).toContain("patch inst_20260929")
    expect(fake.calls.some((c) => c.includes("rr"))).toBe(false)
  })

  it("空き時間から作成 → カードと予定、削除 → 両方消える", async () => {
    const { task, event } = await createEvent({ title: "買い出し", start: "2026-09-29T12:00:00+09:00", end: "2026-09-29T12:30:00+09:00" }, T0)
    expect(task).toMatchObject({ title: "買い出し", status: "todo", source: "manual", date: "2026-09-29" })
    expect(event?.task_id).toBe(task.id)
    await deleteEvent(event!.id, T0)
    expect(fake.events.size).toBe(0)
    expect(await listTasks()).toEqual([])
  })
})

describe("集中の記録（任意・既定オフ）", () => {
  it("設定オンのときだけ「集中｜カード名」を書く", async () => {
    const t = await createTask({ title: "執筆", status: "doing" }, T0)
    await pomodoro({ type: "start", taskId: t.id }, T0)
    await pomodoro({ type: "get" }, T0 + 26 * 60_000)
    await new Promise((r) => setTimeout(r, 10))
    expect(fake.events.size).toBe(0) // 既定オフ

    await setSettings({ "pomodoro.gcal_enabled": true })
    await pomodoro({ type: "get" }, T0 + 60 * 60_000) // 2 回目の集中（28〜53 分）が完了
    await new Promise((r) => setTimeout(r, 10))
    const evs = [...fake.events.values()]
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ summary: "集中｜執筆", colorId: "11" })
    expect(evs[0].start?.dateTime).toBe("2026-09-29T10:28:00+09:00")
    expect(evs[0].extendedProperties?.private).toMatchObject({ pomodoro: "1" })
  })
})
