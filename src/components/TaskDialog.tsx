import { useState, type FormEvent } from "react"
import { CalendarCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Linkified } from "@/components/Linkified"
import {
  useCreateTask,
  useDeleteTask,
  useImportText,
  useMoveTask,
  useUpdateTask,
} from "@/hooks/useTasks"
import { hhmm, isCalendarLinked, localDate, STATUS_LABEL, STATUSES, toLocalIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Task, TaskStatus } from "@/types"

interface TaskDialogProps {
  /** null = 新規作成 */
  task: Task | null
  defaultDate: string
  /** 新規作成時の列（右クリックの「ここに追加」。省略 = 未着手） */
  defaultStatus?: TaskStatus
  /** 新規作成時にこのカードの直前へ入れる（省略 / null = 列の末尾） */
  beforeId?: number | null
  onClose: () => void
}

const IMPORT_PLACEHOLDER = `9/27(日) やること
1. やること1
2. やること2
\u3000メモや URL はインデントして次の行に
【19:30〜20:30】固定の予定`

/** open のときだけマウントする（初期値は task から作る）。 */
export function TaskDialog({ task, defaultDate, defaultStatus, beforeId, onClose }: TaskDialogProps) {
  const [mode, setMode] = useState<"single" | "import">("single")
  return (
    <Dialog open onClose={onClose} className="max-w-lg" labelledBy="task-dialog-title">
      <div className="p-5 sm:p-6">
        <h2 id="task-dialog-title" className="mb-4 pr-8 text-base font-semibold text-zinc-50">
          {task
            ? "カードを編集"
            : defaultStatus && defaultStatus !== "todo"
              ? `カードを追加（${STATUS_LABEL[defaultStatus]}）`
              : "カードを追加"}
        </h2>
        {!task && !defaultStatus && (
          <div className="mb-4 flex gap-1 rounded-lg bg-white/10 p-0.5 text-sm">
            {(
              [
                ["single", "1枚追加"],
                ["import", "テキストから一括"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 font-medium transition-colors",
                  mode === value ? "bg-linear-to-r from-fuchsia-500/80 to-violet-500/80 text-white shadow-[0_0_12px_-3px_rgb(217_70_239/0.8)]" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {mode === "import" && !task ? (
          <ImportForm defaultDate={defaultDate} onDone={onClose} />
        ) : (
          <TaskForm
            task={task}
            defaultDate={defaultDate}
            status={defaultStatus}
            beforeId={beforeId}
            onDone={onClose}
          />
        )}
      </div>
    </Dialog>
  )
}

function TaskForm({
  task,
  defaultDate,
  status,
  beforeId,
  onDone,
}: {
  task: Task | null
  defaultDate: string
  status?: TaskStatus
  beforeId?: number | null
  onDone: () => void
}) {
  const create = useCreateTask()
  const update = useUpdateTask()
  const remove = useDeleteTask()
  const move = useMoveTask()

  const [title, setTitle] = useState(task?.title ?? "")
  const [note, setNote] = useState(task?.note ?? "")
  const [date, setDate] = useState(task ? (task.date ?? "") : defaultDate)
  const [start, setStart] = useState(hhmm(task?.start_at ?? null))
  const [end, setEnd] = useState(hhmm(task?.end_at ?? null))
  const fromCalendar = task?.source === "calendar"
  const pending = create.isPending || update.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("タイトルを入力してください")
      return
    }
    if (end && !start) {
      toast.error("終了時刻だけは指定できません")
      return
    }
    const day = date || (start ? localDate() : "")
    const input = {
      title: title.trim(),
      note,
      date: day || null,
      start_at: start ? toLocalIso(day, start) : null,
      end_at: start && end ? toLocalIso(end <= start ? nextDay(day) : day, end) : null,
    }
    if (task) {
      update.mutate({ id: task.id, input }, { onSuccess: onDone })
    } else {
      create.mutate(
        { ...input, ...(status && { status }), ...(beforeId != null && { before_id: beforeId }) },
        { onSuccess: onDone },
      )
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">タイトル</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">メモ（URL は自動リンク）</span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
      </label>
      {task?.note && /https?:\/\//.test(task.note) && (
        <p className="rounded-lg bg-white/5 p-2 text-xs whitespace-pre-wrap text-zinc-300">
          <Linkified text={task.note} />
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-3 block sm:col-span-1">
          <span className="mb-1 block text-xs font-medium text-zinc-400">日付</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">開始</span>
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">終了</span>
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {task && isCalendarLinked(task) && (
        <p className="text-xs text-zinc-400">
          <CalendarCheck className="mr-1 inline size-3.5 align-[-2px] text-cyan-300" />
          {fromCalendar
            ? "カレンダーの予定から取り込んだカードです（予定側の変更は同期時に上書きされます）"
            : "時刻付きのカードは Google カレンダーに予定として書き出されます"}
        </p>
      )}

      {task && (
        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-400">列</span>
          <div className="flex gap-1">
            {STATUSES.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={task.status === s ? "default" : "outline"}
                onClick={() =>
                  task.status !== s &&
                  move.mutate({ id: task.id, status: s, before_id: null }, { onSuccess: onDone })
                }
              >
                {STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        {task && (
          <Button
            type="button"
            variant="ghost"
            className="text-red-400 hover:bg-red-500/15 hover:text-red-300"
            onClick={() => {
              if (window.confirm(`「${task.title}」を削除しますか？`)) {
                remove.mutate(task.id, { onSuccess: onDone })
              }
            }}
          >
            <Trash2 />
            削除
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            キャンセル
          </Button>
          <Button type="submit" disabled={pending}>
            {task ? "保存" : "追加"}
          </Button>
        </div>
      </div>
    </form>
  )
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

function ImportForm({ defaultDate, onDone }: { defaultDate: string; onDone: () => void }) {
  const importText = useImportText()
  const [text, setText] = useState("")
  const [date, setDate] = useState(defaultDate)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    importText.mutate({ text, date: date || null }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        placeholder={IMPORT_PLACEHOLDER}
        className="font-mono text-xs"
        autoFocus
      />
      <p className="text-xs leading-relaxed text-zinc-400">
        番号付き行＝1枚。インデント行は直前カードのメモ。【HH:MM〜HH:MM】は時刻枠。先頭の「9/27(日)」見出しがその日付になります。同じタイトル＋日付は上書き。
      </p>
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-zinc-400">見出しが無いときの日付</span>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onDone}>
          キャンセル
        </Button>
        <Button type="submit" disabled={importText.isPending || !text.trim()}>
          取り込む
        </Button>
      </div>
    </form>
  )
}
