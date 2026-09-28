import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDot, ClipboardList, Copy, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import * as local from "@/local"
import { useGcalAuth } from "@/hooks/useGcalAuth"
import { tick } from "@/lib/haptics"
import { REPORT_KEY } from "@/lib/queryKeys"
import { buildReportText, replaceNote, reportDateLabel, shiftDate } from "@/lib/report"
import { cn } from "@/lib/utils"
import type { Report, ReportItem, ReportNote } from "@/types"

const NOTE_SAVE_DELAY = 500

/**
 * 「今日やったこと」: 本文のプレビュー（編集可）＋ 最後に一言 ＋ コピー。open のときだけマウントする。
 * 本文は項目から lib/report.ts で組み立てる（一言の入力がその場で末尾に反映される）。
 */
export function ReportDialog({ onClose }: { onClose: () => void }) {
  // null = 今日（朝 5 時境界はデータ層が決める）
  const [date, setDate] = useState<string | null>(null)
  const [includeCalendar, setIncludeCalendar] = useState(false)
  const query = useQuery({
    queryKey: [...REPORT_KEY, date ?? "today", includeCalendar],
    queryFn: () => local.getReport(date, includeCalendar),
    placeholderData: keepPreviousData,
    staleTime: 0,
  })
  const report = query.data

  return (
    <Dialog open onClose={onClose} className="max-w-2xl" labelledBy="report-dialog-title">
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 pr-8">
          <h2 id="report-dialog-title" className="flex items-center gap-2 text-base font-semibold text-zinc-50">
            <ClipboardList className="size-4 text-fuchsia-300" />
            今日やったこと
          </h2>
          {report && (
            <div className="flex items-center gap-1" role="group" aria-label="日付を切り替え">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="前の日"
                onClick={() => setDate(shiftDate(report.date, -1))}
              >
                <ChevronLeft />
              </Button>
              <span
                className="min-w-20 text-center text-sm font-bold text-zinc-200 tabular-nums"
                title={`朝 ${report.day_start_hour} 時で日が切り替わります（それより前の完了は前日扱い）`}
              >
                {reportDateLabel(report.date)}
                {report.is_today && <span className="ml-1 text-xs font-semibold text-lime-300">今日</span>}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="次の日"
                disabled={report.is_today}
                onClick={() => setDate(shiftDate(report.date, 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
        {report ? (
          <ReportEditor
            key={report.date}
            report={report}
            includeCalendar={includeCalendar}
            onIncludeCalendar={setIncludeCalendar}
            onClose={onClose}
          />
        ) : (
          <p className="py-10 text-center text-sm text-zinc-500">
            {query.isError ? "取得に失敗しました" : "読み込み中..."}
          </p>
        )}
      </div>
    </Dialog>
  )
}

interface EditorProps {
  report: Report
  /** チェックボックスは手元の値で（取得を待たずに切り替わるように） */
  includeCalendar: boolean
  onIncludeCalendar: (v: boolean) => void
  onClose: () => void
}

/** 1 日分（日付が変わったら key で作り直す）。一言は入力が止まってから保存し、閉じるときにも保存する。 */
function ReportEditor({ report, includeCalendar, onIncludeCalendar, onClose }: EditorProps) {
  const queryClient = useQueryClient()
  const calendarOn = useGcalAuth().state !== "unconfigured"
  const [note, setNote] = useState(report.note)
  // 手で編集した本文（null = 項目から組み立てたまま）
  const [edited, setEdited] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const text =
    edited ??
    buildReportText(
      report.done.map((i) => i.title),
      report.doing.map((i) => i.title),
      note,
      (report.todo ?? []).map((i) => i.title),
    )

  const saveNote = useCallback(() => {
    window.clearTimeout(timer.current)
    const value = pending.current
    if (value === null) return
    pending.current = null
    const day = report.date
    local
      .saveNote(day, value)
      .then((saved: ReportNote) => {
        // 同じ日のキャッシュ（予定あり/なし）に反映（日付を行き来しても消えない）
        queryClient.setQueriesData<Report>({ queryKey: REPORT_KEY }, (old) =>
          old && old.date === day ? { ...old, note: saved.note } : old,
        )
      })
      .catch(() => toast.error("一言の保存に失敗しました"))
  }, [queryClient, report.date])

  // 日付を切り替える・閉じるときに未保存の一言を送る
  useEffect(() => saveNote, [saveNote])

  function onNote(value: string) {
    if (edited !== null) setEdited(replaceNote(edited, note, value))
    setNote(value)
    pending.current = value
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(saveNote, NOTE_SAVE_DELAY)
  }

  function onInclude(v: boolean) {
    setEdited(null)
    onIncludeCalendar(v)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API が使えないときは選択してコピー
      const el = textRef.current
      if (!el) return
      el.select()
      if (!document.execCommand("copy")) {
        toast.error("コピーできませんでした（本文を選択して手動でコピーしてください）")
        return
      }
    }
    tick("report-copy")
    toast.success("コピーしました")
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void copy()
    }
  }

  const lines = text.split("\n").length

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <ItemBlock
          label="やった"
          items={report.done}
          icon={<CheckCircle2 className="size-3.5 shrink-0 text-lime-300" />}
          accent="text-lime-300"
          empty={`まだありません（${report.day_start_hour} 時より前の完了は前日扱い）`}
        />
        <ItemBlock
          label="やってる"
          items={report.is_today ? report.doing : []}
          icon={<CircleDot className="size-3.5 shrink-0 text-orange-300" />}
          accent="text-orange-300"
          empty={report.is_today ? "ありません" : "過去の日は載せません（今の状態なので）"}
        />
        <ItemBlock
          label="未着手"
          items={report.is_today ? (report.todo ?? []) : []}
          icon={<Circle className="size-3.5 shrink-0 text-violet-300" />}
          accent="text-violet-300"
          empty={report.is_today ? "ありません" : "過去の日は載せません（今の状態なので）"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-400">本文（コピーされる内容・直接直せます）</span>
        {(calendarOn || report.excluded_calendar > 0 || includeCalendar) && (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300">
          <input
            type="checkbox"
            className="size-4 accent-pink-500"
            checked={includeCalendar}
            onChange={(e) => onInclude(e.target.checked)}
          />
          予定も含める
          {!includeCalendar && report.excluded_calendar > 0 && (
            <span className="text-zinc-500">（{report.excluded_calendar} 件）</span>
          )}
        </label>
        )}
      </div>

      <Textarea
        ref={textRef}
        aria-label="本文（編集できます）"
        value={text}
        onChange={(e) => setEdited(e.target.value)}
        onKeyDown={onKeyDown}
        rows={Math.min(16, Math.max(6, lines + 1))}
        spellCheck={false}
        className="resize-y font-mono text-[13px] leading-relaxed"
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-400">最後に一言（任意・書くと本文の末尾に 1 行付きます）</span>
        <Input
          value={note}
          onChange={(e) => onNote(e.target.value)}
          onBlur={saveNote}
          onKeyDown={onKeyDown}
          maxLength={500}
          placeholder="例: 明日は午前中に資料を仕上げる"
        />
      </label>

      <div className="mt-1 flex items-center justify-between gap-2">
        <div>
          {edited !== null && (
            <Button variant="ghost" size="sm" onClick={() => setEdited(null)} title="手で直した本文を捨てて組み立て直す">
              <RotateCcw />
              編集を元に戻す
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
          <Button onClick={() => void copy()} title="コピー（⌘Enter）">
            <Copy />
            コピー
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ItemBlockProps {
  label: string
  items: ReportItem[]
  icon: ReactNode
  accent: string
  empty: string
}

/** 「やった」「やってる」の一覧（件数つき・長いときはスクロール） */
function ItemBlock({ label, items, icon, accent, empty }: ItemBlockProps) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-3" aria-label={label}>
      <h3 className="mb-1.5 flex items-baseline gap-1.5 text-sm font-bold text-zinc-100">
        {label}
        <span className={cn("text-xs font-bold tabular-nums", accent)}>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">{empty}</p>
      ) : (
        <ul className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-1.5 text-[13px] text-zinc-200">
              {icon}
              <span className="min-w-0 truncate" title={i.title}>
                {i.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
