import type * as React from "react"
import { useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { SortableTaskCard, type FocusProps } from "./TaskCard"
import { STATUS_ACCENT, STATUS_LABEL } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Task, TaskStatus } from "@/types"

interface ColumnProps {
  status: TaskStatus
  tasks: Task[]
  onOpen: (task: Task) => void
  showDate: boolean
  dragging: boolean
  focus?: FocusProps
  /** 列（とその中のカード）の右クリック。taskId はカード上なら そのカード */
  onContextMenu?: (e: React.MouseEvent, status: TaskStatus, taskId: number | null) => void
}

export function Column({ status, tasks, onOpen, showDate, dragging, focus, onContextMenu }: ColumnProps) {
  const accent = STATUS_ACCENT[status]
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <section
      className="flex w-[78vw] max-w-80 shrink-0 flex-col sm:w-80"
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        const card = (e.target as HTMLElement).closest<HTMLElement>("[data-task-id]")
        onContextMenu(e, status, card ? Number(card.dataset.taskId) : null)
      }}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("size-2.5 rounded-full", accent.dot)} />
        <h2 className={cn("bg-clip-text text-sm font-black tracking-wide text-transparent", accent.text)}>
          {STATUS_LABEL[status]}
        </h2>
        <span className="rounded-full bg-white/10 px-1.5 text-xs font-bold text-zinc-300 tabular-nums ring-1 ring-white/10">
          {tasks.length}
        </span>
      </div>

      <SortableContext id={status} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-1.5 transition-colors",
            dragging && isOver && cn("ring-2", accent.ring, accent.bg),
          )}
        >
          {tasks.length === 0 ? (
            <div className="flex min-h-24 flex-1 items-center justify-center rounded-lg border border-dashed border-white/15 p-6 text-center text-xs text-zinc-500">
              カードはありません
            </div>
          ) : (
            tasks.map((task, i) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onOpen={onOpen}
                showDate={showDate}
                focus={focus}
                number={status === "todo" ? i + 1 : undefined}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  )
}
