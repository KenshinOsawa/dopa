/** テスト用の Google カレンダー（メモリ上）。本物の Google には接続しない。 */
import type { CalendarClient, EventBody, GEvent } from "@/local/gcal/client"
import { NotFound } from "@/local/gcal/client"

export class FakeCalendar implements CalendarClient {
  events = new Map<string, GEvent>()
  calls: string[] = []
  private seq = 0
  failNext = false

  seed(event: Partial<GEvent> & { id?: string }): GEvent {
    const id = event.id ?? `seed${++this.seq}`
    const e = { status: "confirmed", ...event, id } as GEvent
    this.events.set(id, e)
    return e
  }

  private check() {
    if (this.failNext) {
      this.failNext = false
      throw new Error("fake failure")
    }
  }

  async listEvents(timeMin: string, timeMax: string): Promise<GEvent[]> {
    this.calls.push("list")
    const lo = Date.parse(timeMin)
    const hi = Date.parse(timeMax)
    return [...this.events.values()].filter((e) => {
      const s = e.start?.dateTime ? Date.parse(e.start.dateTime) : Date.parse(`${e.start?.date}T00:00:00+09:00`)
      return s >= lo && s < hi
    })
  }

  async get(id: string): Promise<GEvent> {
    this.calls.push(`get ${id}`)
    const e = this.events.get(id)
    if (!e) throw new NotFound(404, "not found")
    return structuredClone(e)
  }

  async insert(body: EventBody): Promise<GEvent> {
    this.check()
    const id = `ev${++this.seq}`
    const e = { ...structuredClone(body), id, status: "confirmed", htmlLink: `https://calendar.example/${id}` } as GEvent
    this.events.set(id, e)
    this.calls.push(`insert ${id}`)
    return structuredClone(e)
  }

  async patch(id: string, body: EventBody): Promise<GEvent> {
    this.check()
    const e = this.events.get(id)
    if (!e) throw new NotFound(404, "not found")
    const next = { ...e, ...structuredClone(body) } as GEvent
    this.events.set(id, next)
    this.calls.push(`patch ${id}`)
    return structuredClone(next)
  }

  async delete(id: string): Promise<void> {
    this.check()
    this.events.delete(id)
    this.calls.push(`delete ${id}`)
  }
}
