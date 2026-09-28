/**
 * 「今日やったこと」の本文（src/local/report.ts から使う）。
 *
 *   今日やったこと
 *   ✅ <今日 done に移したカード>（完了順）
 *   やってること
 *   <doing 列のカード>（記号なし）
 *   未着手
 *   <todo 列のカード>（記号なし・列順）
 *   <最後に一言>（空なら付かない）
 *
 * 空行なし・1 行 1 項目（改行は空白にまとめる）。0 件のブロックは見出しごと省く
 * （両方 0 件なら「今日やったこと」の見出しだけ残す）。
 */
export const HEADING = "今日やったこと"
export const DOING_HEADING = "やってること"
export const TODO_HEADING = "未着手"
export const DONE_MARK = "✅ "

export function oneLine(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

export function buildReportText(done: string[], doing: string[], note = "", todo: string[] = []): string {
  const doneLines = done.map(oneLine).filter(Boolean).map((t) => DONE_MARK + t)
  const doingLines = doing.map(oneLine).filter(Boolean)
  const todoLines = todo.map(oneLine).filter(Boolean)
  const lines: string[] = []
  if (doneLines.length > 0 || (doingLines.length === 0 && todoLines.length === 0)) lines.push(HEADING, ...doneLines)
  if (doingLines.length > 0) lines.push(DOING_HEADING, ...doingLines)
  if (todoLines.length > 0) lines.push(TODO_HEADING, ...todoLines)
  if (oneLine(note)) lines.push(oneLine(note))
  return lines.join("\n")
}

/**
 * 手で編集した本文の末尾の一言を差し替える。末尾が前の一言ならその行を置き換え、
 * そうでなければ（消した・書き換えた）末尾に付け足す。新しい一言が空なら付けない。
 */
export function replaceNote(text: string, prevNote: string, nextNote: string): string {
  const prev = oneLine(prevNote)
  const next = oneLine(nextNote)
  let body = text.replace(/\s+$/, "")
  if (prev) {
    const lines = body.split("\n")
    if (lines.length > 1 && lines[lines.length - 1].trim() === prev) body = lines.slice(0, -1).join("\n")
  }
  return next ? `${body}\n${next}` : body
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]

/** YYYY-MM-DD を days 日ずらす（暦日。タイムゾーンに依らない）。 */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

/** 9/28(月) */
export function reportDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}/${d}(${wd})`
}
