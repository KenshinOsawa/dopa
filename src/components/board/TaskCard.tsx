import { CalendarCheck, Play, Timer } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Badge } from "@/components/ui/badge"
import { Linkified } from "@/components/Linkified"
import { dateLabel, isCalendarLinked, localDate, STATUS_ACCENT, timeLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Task } from "@/types"

interface TaskCardProps {
  task: Task
  onOpen: (task: Task) => void
  /** 日付フィルタ中は日付バッジを省く */
  showDate: boolean
  /** DragOverlay 内の表示用 */
  overlay?: boolean
  /** ポモドーロ: 「やってる」カードの ▶（このカードで集中） */
  focus?: FocusProps
  /** 未着手列での上からの順番（1 始まり） */
  number?: number
}

export interface FocusProps {
  /** いま紐付いているカード */
  activeTaskId: number | null
  /** 集中フェーズが計測中か */
  running: boolean
  onFocus: (task: Task) => void
}

export function TaskCard({ task, onOpen, showDate, overlay, focus, number }: TaskCardProps) {
  const time = timeLabel(task)
  const linked = isCalendarLinked(task)
  const done = task.status === "done"
  const canFocus = focus != null && task.status === "doing"
  const focusing = canFocus && focus.activeTaskId === task.id
  const accent = STATUS_ACCENT[task.status]

  return (
    <article
      onClick={() => onOpen(task)}
      data-drag-overlay={overlay ? "" : undefined}
      className={cn(
        "glass-card group relative cursor-pointer overflow-hidden rounded-xl border border-white/10 p-3 pl-3.5 text-left",
        "transition-[translate,scale,box-shadow,border-color] duration-150 ease-out",
        "hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.96] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        !overlay && "kb-wiggle",
        accent.glow,
        overlay && "scale-105 rotate-2 border-white/25 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9),0_0_30px_-6px_rgb(255_62_165/0.7)]",
        focusing && "border-pink-400/60 shadow-[0_0_20px_-4px_rgb(255_62_165/0.8)]",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", accent.bar, done && "opacity-60")} />
      <div className="flex items-start gap-2">
        {number != null && (
          <span className="mt-px w-5 shrink-0 bg-linear-to-b from-violet-300 to-blue-400 bg-clip-text text-right text-sm font-black text-transparent tabular-nums">
            {number}
          </span>
        )}
        {time && (
          <span className="mt-px shrink-0 rounded-md bg-fuchsia-500/15 px-1.5 py-0.5 text-xs font-bold text-fuchsia-200 tabular-nums ring-1 ring-fuchsia-400/35">
            {time}
          </span>
        )}
        <h3
          className={cn(
            "min-w-0 flex-1 text-sm leading-snug font-semibold break-words text-zinc-50",
            done && "text-zinc-500 line-through decoration-lime-300/70",
          )}
        >
          {task.title}
        </h3>
        {linked && (
          <span title="Google カレンダーと連携" className="mt-px shrink-0 text-cyan-300">
            <CalendarCheck className="size-4" aria-label="Google カレンダーと連携" />
          </span>
        )}
        {canFocus &&
          (focusing && focus.running ? (
            <span title="このカードで集中中" className="shrink-0 text-pink-400 drop-shadow-[0_0_6px_rgb(255_62_165/0.9)]">
              <Timer className="size-4" />
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                focus.onFocus(task)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              title="このカードで集中（ポモドーロ開始）"
              aria-label={`「${task.title}」で集中する`}
              className="-m-1 flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-pink-500/20 hover:text-pink-300 focus-visible:ring-2 focus-visible:ring-pink-400/60 focus-visible:outline-none"
            >
              <Play className="size-3.5" />
            </button>
          ))}
      </div>

      {task.note && (
        <p className="clamp-3 mt-1.5 text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
          <Linkified text={task.note} />
        </p>
      )}

      {showDate && task.date && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={task.date < localDate() && !done ? "red" : "gray"}>{dateLabel(task.date)}</Badge>
        </div>
      )}
    </article>
  )
}

/** 列内で並べ替え・列間移動できるカード。 */
export function SortableTaskCard(props: Omit<TaskCardProps, "overlay">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  })
  return (
    <div
      ref={setNodeRef}
      data-task-id={props.task.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-30")}
      // 触れた瞬間の「ぶっ」（同じカードは 300ms・全体 80ms で間引き。ドラッグ中・最初の操作前は鳴らない）
      {...attributes}
      {...listeners}
    >
      <TaskCard {...props} />
    </div>
  )
}
