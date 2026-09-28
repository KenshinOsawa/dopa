import { useCallback, useMemo, useState } from "react"
import type * as React from "react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Header } from "@/components/Header"
import { ReportDialog } from "@/components/ReportDialog"
import { SettingsDialog } from "@/components/SettingsDialog"
import { WelcomeGate } from "@/components/WelcomeDialog"
import { TaskDialog } from "@/components/TaskDialog"
import { Board } from "@/components/board/Board"
import { CalendarFloating } from "@/components/calendar/CalendarFloating"
import { DayCalendar } from "@/components/calendar/DayCalendar"
import { ContextMenu, type MenuItem } from "@/components/board/ContextMenu"
import { PomodoroFloating, PomodoroSidebar } from "@/components/pomodoro/PomodoroDock"
import { useGcalAuth } from "@/hooks/useGcalAuth"
import { usePomodoro } from "@/hooks/usePomodoro"
import { useDeleteTask, useTasks } from "@/hooks/useTasks"
import { localDate } from "@/lib/format"
import type { DateFilter, Task, TaskStatus } from "@/types"

/** 新規作成の置き場所（右クリックの「ここに追加」） */
interface NewTarget {
  status?: TaskStatus
  beforeId?: number | null
}

interface MenuState {
  x: number
  y: number
  status: TaskStatus
  task: Task | null
}

const FILTER_KEY = "dopa:date-filter"

function loadFilter(): DateFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY)
    if (v === "today" || v === "tomorrow" || v === "all") return v
  } catch {
    /* ストレージ不可でも既定で動く */
  }
  return "all"
}

export function BoardPage() {
  const { data: tasks, isLoading, isError } = useTasks()
  const [filter, setFilterState] = useState<DateFilter>(loadFilter)
  const [query, setQuery] = useState("")
  // undefined = 閉じている / null = 新規 / Task = 編集
  const [editing, setEditing] = useState<Task | null | undefined>(undefined)
  const [newTarget, setNewTarget] = useState<NewTarget>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [reporting, setReporting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // OAuth クライアント ID が無ければカレンダーは出さない（ボードだけで完結）
  const calendarOn = useGcalAuth().state !== "unconfigured"
  const remove = useDeleteTask()
  const pomo = usePomodoro()
  const closeMenu = useCallback(() => setMenu(null), [])

  function openNew(target: NewTarget = {}) {
    setNewTarget(target)
    setEditing(null)
  }

  function setFilter(f: DateFilter) {
    setFilterState(f)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      /* noop */
    }
  }

  const day = filter === "today" ? localDate() : filter === "tomorrow" ? localDate(1) : null

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tasks ?? []).filter((t) => {
      if (day && t.date !== day) return false
      if (!q) return true
      return t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)
    })
  }, [tasks, day, query])

  // ポモドーロの紐付け候補（日付フィルタ・検索に関係なく「やってる」全部）
  const doingTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.status === "doing")
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [tasks],
  )
  const focus = {
    activeTaskId: pomo.data?.task_id ?? null,
    running: pomo.data?.phase === "focus" && pomo.data.status === "running",
    onFocus: (task: Task) => pomo.act({ type: "start", taskId: task.id }),
  }

  function onContextMenu(e: React.MouseEvent, status: TaskStatus, taskId: number | null) {
    const task = taskId != null ? ((tasks ?? []).find((t) => t.id === taskId) ?? null) : null
    setMenu({ x: e.clientX, y: e.clientY, status, task })
  }

  function menuItems(m: MenuState): MenuItem[] {
    // カード上なら その直後（= 列で次のカードの直前）に入れる。並びはフィルタ前の列全体で見る
    let beforeId: number | null = null
    if (m.task) {
      const column = (tasks ?? [])
        .filter((t) => t.status === m.status)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      beforeId = column[column.findIndex((t) => t.id === m.task?.id) + 1]?.id ?? null
    }
    const items: MenuItem[] = [
      {
        label: "＋ ここにタスクを追加",
        onSelect: () => openNew({ status: m.status, beforeId }),
      },
    ]
    if (m.task) {
      const task = m.task
      items.push(
        { label: "編集", onSelect: () => setEditing(task) },
        { label: "削除…", onSelect: () => setDeleting(task), danger: true },
      )
    }
    return items
  }

  // 編集中カードは最新の値を見る（他タブ・同期で更新される）。
  const editingTask =
    editing === undefined || editing === null
      ? editing
      : ((tasks ?? []).find((t) => t.id === editing.id) ?? editing)

  const sidebar = (
    <PomodoroSidebar pomo={pomo} doingTasks={doingTasks}>
      {calendarOn && (
        <div className="flex min-h-[28rem] flex-1 flex-col border-t border-white/10">
          <DayCalendar tasks={tasks ?? []} onOpenTask={setEditing} className="flex-1" />
        </div>
      )}
    </PomodoroSidebar>
  )

  return (
    <div className="flex h-dvh flex-col">
      <Header
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        onCreate={() => openNew()}
        onReport={() => setReporting(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        {tasks ? (
          // サイドバー（ポモドーロ＋カレンダー）もボードと同じ DndContext に入れる（カードをカレンダーへドロップできる）
          <Board
            tasks={visible}
            onOpen={setEditing}
            showDate={filter === "all"}
            focus={focus}
            onContextMenu={onContextMenu}
            aside={sidebar}
          />
        ) : (
          <>
            <main className="min-w-0 flex-1">
              {isLoading && (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">読み込み中...</div>
              )}
              {isError && (
                <div className="flex h-full items-center justify-center text-sm text-rose-400">
                  カードを読み込めませんでした（プライベートブラウズでは保存できないことがあります）
                </div>
              )}
            </main>
            {sidebar}
          </>
        )}
      </div>
      {calendarOn && <CalendarFloating tasks={tasks ?? []} onOpenTask={setEditing} />}
      <PomodoroFloating pomo={pomo} doingTasks={doingTasks} />
      {editingTask !== undefined && (
        <TaskDialog
          key={editingTask?.id ?? "new"}
          task={editingTask}
          defaultDate={day ?? ""}
          defaultStatus={editingTask ? undefined : newTarget.status}
          beforeId={editingTask ? undefined : newTarget.beforeId}
          onClose={() => setEditing(undefined)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={closeMenu} />}
      {reporting && <ReportDialog onClose={() => setReporting(false)} />}
      {settingsOpen && <SettingsDialog pomo={pomo} onClose={() => setSettingsOpen(false)} />}
      <WelcomeGate />
      {deleting && (
        <ConfirmDialog
          title="カードを削除"
          message={`「${deleting.title}」を削除しますか？`}
          confirmLabel="削除"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
