/** Google Calendar（primary）REST への薄いクライアント（fetch 直叩き）とテスト用の差し替え口。 */
import { timeZone } from "@/lib/time"
import { accessToken, expireToken } from "./auth"

export const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

/** Google Calendar API の予定（使うところだけ） */
export interface GEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  colorId?: string | null
  htmlLink?: string
  eventType?: string
  recurringEventId?: string
  recurrence?: string[]
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
  organizer?: { self?: boolean }
  guestsCanModify?: boolean
  extendedProperties?: { private?: Record<string, string> }
}

export type EventBody = Partial<Omit<GEvent, "id">>

export class CalendarError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "CalendarError"
    this.status = status
  }
}

export class NotFound extends CalendarError {}

export interface CalendarClient {
  listEvents(timeMin: string, timeMax: string): Promise<GEvent[]>
  get(id: string): Promise<GEvent>
  insert(body: EventBody): Promise<GEvent>
  patch(id: string, body: EventBody): Promise<GEvent>
  delete(id: string): Promise<void>
}

export class GoogleCalendar implements CalendarClient {
  private token: string
  constructor(token: string) {
    this.token = token
  }

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new CalendarError(0, "Google カレンダーに接続できません（オフライン？）")
    }
    if (res.status === 401) {
      expireToken()
      throw new CalendarError(401, "Google カレンダーの接続が切れました（再接続してください）")
    }
    const text = await res.text()
    if (res.status === 404 || res.status === 410) throw new NotFound(res.status, "予定が見つかりません（既に削除された？）")
    if (!res.ok) {
      let msg = text.slice(0, 200)
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg
      } catch {
        /* noop */
      }
      throw new CalendarError(res.status, `Google カレンダー ${res.status}: ${msg}`)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  async listEvents(timeMin: string, timeMax: string): Promise<GEvent[]> {
    const events: GEvent[] = []
    let pageToken: string | undefined
    for (;;) {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        timeZone: timeZone(),
      })
      if (pageToken) params.set("pageToken", pageToken)
      const data = await this.call<{ items?: GEvent[]; nextPageToken?: string }>("GET", `${EVENTS_URL}?${params}`)
      events.push(...(data.items ?? []))
      pageToken = data.nextPageToken
      if (!pageToken) return events
    }
  }

  get(id: string) {
    return this.call<GEvent>("GET", `${EVENTS_URL}/${encodeURIComponent(id)}`)
  }

  insert(body: EventBody) {
    return this.call<GEvent>("POST", EVENTS_URL, body)
  }

  patch(id: string, body: EventBody) {
    return this.call<GEvent>("PATCH", `${EVENTS_URL}/${encodeURIComponent(id)}`, body)
  }

  async delete(id: string) {
    try {
      await this.call<void>("DELETE", `${EVENTS_URL}/${encodeURIComponent(id)}`)
    } catch (e) {
      if (!(e instanceof NotFound)) throw e // 既に消えている
    }
  }
}

// テストでフェイクを差し込むためのフック
let factory: (() => CalendarClient | null) | null = null

export function setClientFactory(f: (() => CalendarClient | null) | null): void {
  factory = f
}

/** 接続中ならクライアント、未接続・期限切れなら null */
export function getClient(): CalendarClient | null {
  if (factory) return factory()
  const t = accessToken()
  return t ? new GoogleCalendar(t) : null
}
