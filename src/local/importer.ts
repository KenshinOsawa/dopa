/**
 * テキストからカードを取り出すパーサ（「テキストから一括」）。
 *
 * 書式（例）:
 *
 *     9/27(日) やること
 *     1. 企画書のたたき台を作る
 *     2. 資料を読む
 *     （全角スペース）https://example.com/doc
 *     【19:30〜】友だちと電話
 *     【19:00–20:15】打ち合わせ
 *
 * ルール:
 * - 「9/27(日) やること」のような日付見出し行 → 以降の既定 date（複数あれば都度切替）
 * - 番号付き行（1. / 1) / 1、）・箇条書き（- ・ *）・その他の非インデント行 → 1 カード
 * - 全角スペース・空白・タブで始まる行 → 直前カードの note に追記
 * - 【HH:MM〜】【HH:MM–HH:MM】→ start/end にしてタイトルから外す
 * - 空行・見出し（日付見出し / # 見出し / 末尾が「:」「：」の行）は無視
 */
import { isoAtMinutes, localDate } from "@/lib/time"

const DASH = "[〜~～\\-–—ー－]"
const TIME_BRACKET = new RegExp(
  `【\\s*(\\d{1,2})[:：](\\d{2})\\s*(?:${DASH}\\s*(?:(\\d{1,2})[:：](\\d{2}))?)?\\s*】`,
)
const TIME_RANGE = new RegExp(
  `^\\s*(\\d{1,2})[:：](\\d{2})\\s*(?:${DASH}\\s*(?:(\\d{1,2})[:：](\\d{2}))?)?\\s*$`,
)
const DATE_HEAD = /^(?:(\d{4})[/\-年.])?(\d{1,2})[/月.](\d{1,2})日?\s*(?:[(（][^)）]*[)）])?\s*(.*)$/
const HEAD_WORDS = /^(?:の)?(?:やること|やる事|TODO|ToDo|todo|タスク|予定)?\s*[:：]?$/
const NUMBERED = /^(?:\d{1,3}[.．、)）]|[・\-*•●○□☐])\s*(.+)$/
const INDENT = /^[ \t\u3000]/

export interface ParsedItem {
  title: string
  note: string
  /** YYYY-MM-DD */
  date: string | null
  start_at: string | null
  end_at: string | null
}

function ymd(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return t.toISOString().slice(0, 10)
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/** 年なし日付は today に最も近い年を採用（12/31 に 1/2 と書けば翌年）。 */
export function inferYear(month: number, day: number, today: string): string | null {
  const year = Number(today.slice(0, 4))
  const candidates = [year - 1, year, year + 1].flatMap((y) => {
    const v = ymd(y, month, day)
    return v ? [v] : []
  })
  if (candidates.length === 0) return null
  return candidates.reduce((best, c) => (dayDiff(c, today) < dayDiff(best, today) ? c : best))
}

export function parseDateHeading(line: string, today: string): string | null {
  const m = DATE_HEAD.exec(line.trim())
  if (!m || !HEAD_WORDS.test(m[4].trim())) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (m[1]) return ymd(Number(m[1]), month, day)
  return inferYear(month, day, today)
}

function toRange(day: string, h1: number, m1: number, h2: number | null, m2: number | null): [string, string | null] {
  const s = h1 * 60 + m1
  const start = isoAtMinutes(day, s)
  if (h2 == null || m2 == null) return [start, null]
  let e = h2 * 60 + m2
  if (e <= s) e += 24 * 60
  return [start, isoAtMinutes(day, e)]
}

/** '19:30-20:30' / '19:30〜' / '19:30' を (start, end|null) に。 */
export function parseTimeRange(text: string, day: string): [string, string | null] {
  const m = TIME_RANGE.exec(text)
  if (!m) throw new Error(`時刻の書式が不正です: ${text}（例 19:30-20:30）`)
  return toRange(day, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, m[4] ? Number(m[4]) : null)
}

function extractTime(title: string, day: string | null, today: string) {
  const m = TIME_BRACKET.exec(title)
  if (!m) return { title, date: day, start_at: null, end_at: null }
  const d = day ?? today
  const [start, end] = toRange(d, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, m[4] ? Number(m[4]) : null)
  const rest = `${title.slice(0, m.index)} ${title.slice(m.index + m[0].length)}`.trim().replace(/\s+/g, " ")
  return { title: rest || "(無題)", date: d, start_at: start, end_at: end }
}

export function parseText(text: string, defaultDate: string | null = null, today: string = localDate()): ParsedItem[] {
  let current = defaultDate
  const items: (ParsedItem & { lines: string[] })[] = []

  const newItem = (raw: string) => {
    items.push({ ...extractTime(raw.trim(), current, today), note: "", lines: [] })
  }

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue
    if (INDENT.test(line)) {
      if (items.length > 0) items[items.length - 1].lines.push(line.trim())
      else newItem(line)
      continue
    }
    const stripped = line.trim()
    const heading = parseDateHeading(stripped, today)
    if (heading !== null) {
      current = heading
      continue
    }
    if (stripped.startsWith("#") || stripped.endsWith(":") || stripped.endsWith("：")) continue
    const m = NUMBERED.exec(stripped)
    newItem(m ? m[1] : stripped)
  }

  return items.map(({ lines, ...item }) => ({ ...item, note: lines.join("\n") }))
}
