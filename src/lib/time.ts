/**
 * 日時はすべて「このブラウザのタイムゾーン」で扱う。
 *
 * - 日付は YYYY-MM-DD（ローカルの暦日）
 * - 日時は ISO 8601 にローカルのオフセットを付けた文字列（例 2026-09-29T10:00:00+09:00）。
 *   アプリ内の日時文字列は必ずこの形に揃えるので、`iso.slice(11, 16)` で HH:MM、`slice(0, 10)` で日付が取れる。
 *   Google カレンダーから来た日時も localIso(Date.parse(x)) で揃えてから使う。
 */

const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0")

/** Date のローカルオフセット（"+09:00" 形式） */
export function offsetOf(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? "+" : "-"
  return `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

/** ローカルの YYYY-MM-DD */
export function dateOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ms（エポック）→ ローカルオフセット付き ISO（秒まで） */
export function localIso(ms: number = Date.now()): string {
  const d = new Date(ms)
  return `${dateOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offsetOf(d)}`
}

/** ISO（どのオフセットでも）→ ローカルオフセット付き ISO。null はそのまま */
export function normalizeIso(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : localIso(ms)
}

/** 今日（+offsetDays 日）の YYYY-MM-DD（ローカル） */
export function localDate(offsetDays = 0, ms: number = Date.now()): string {
  const d = new Date(ms)
  d.setDate(d.getDate() + offsetDays)
  return dateOf(d)
}

/** YYYY-MM-DD を n 日ずらす（暦日。タイムゾーンに依らない） */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** 日付 + 0:00 からの分 → ローカルオフセット付き ISO（1440 分 = 翌日 0:00） */
export function isoAtMinutes(date: string, minutes: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return localIso(new Date(y, m - 1, d, 0, minutes).getTime())
}

/** 日付と "HH:MM" → ローカルオフセット付き ISO */
export function toLocalIso(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number)
  return isoAtMinutes(date, h * 60 + m)
}

/** ローカルの date の hour 時 ちょうどの ms */
export function msAt(date: string, hour = 0, minute = 0): number {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d, hour, minute).getTime()
}

/** ブラウザの IANA タイムゾーン（Google カレンダーに渡す） */
export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}
