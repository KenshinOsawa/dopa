import { useMemo, useState } from "react"
import type * as React from "react"
import {
  closestCenter,
  closestCorners,
  DndContext,
  pointerWithin,
  DragOverlay,
  type DropAnimation,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { Column } from "./Column"
import { TaskCard, type FocusProps } from "./TaskCard"
import { isCalendarDropId, type CalendarDropData } from "@/lib/calendar"
import { buzz, setDragging, thud } from "@/lib/haptics"
import { STATUSES } from "@/lib/format"
import { useMoveTask } from "@/hooks/useTasks"
import type { Task, TaskStatus } from "@/types"

type Columns = Record<TaskStatus, number[]>

interface BoardProps {
  tasks: Task[]
  onOpen: (task: Task) => void
  showDate: boolean
  focus?: FocusProps
  onContextMenu?: (e: React.MouseEvent, status: TaskStatus, taskId: number | null) => void
  /**
   * ボードの右に並べるもの（サイドバー）。同じ DndContext の中に置くので、
   * そこにあるカレンダーへカードをドロップできる。
   */
  aside?: React.ReactNode
}

function group(tasks: Task[]): Columns {
  const cols: Columns = { todo: [], doing: [], done: [] }
  const sorted = [...tasks].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  for (const t of sorted) cols[t.status].push(t.id)
  return cols
}

// ドロップ時はオーバーレイを「新しい位置」へ短く滑らせて着地させる。
const dropAnimation: DropAnimation = {
  duration: 160,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
}

// 衝突判定: まずポインタが乗っている「列」を決め、その列のカードの中で中心が最も近いものを選ぶ。
// - pointerWithin だけだと、カードとカードの隙間で「列そのもの」が当たり判定になり、
//   並べ替えのプレビューが崩れて他のカードまで動いたり、ドロップが空振りして元に戻ったりする
// - closestCorners だけだと、背の高い空の列は角が遠く、隣の列のカードに負けて列をまたげない
// カレンダー（サイドバー）はポインタが乗っているときだけ当たる（最寄り判定には参加させない）。
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  const calendar = within.find((c) => isCalendarDropId(c.id))
  if (calendar) return [calendar]
  const board = { ...args, droppableContainers: args.droppableContainers.filter((c) => !isCalendarDropId(c.id)) }
  const column = within.find((c) => isStatus(c.id))
  if (!column) return closestCorners(board)
  const cards = board.droppableContainers.filter(
    (c) => c.data.current?.sortable?.containerId === column.id,
  )
  if (cards.length === 0) return [column]
  return closestCenter({ ...args, droppableContainers: cards })
}

const isStatus = (id: UniqueIdentifier): id is TaskStatus =>
  (STATUSES as UniqueIdentifier[]).includes(id)

/** ドロップ時のポインタの y（開始時の位置 + 移動量） */
function pointerY(e: DragEndEvent): number | null {
  const ev = e.activatorEvent
  if (typeof MouseEvent !== "undefined" && ev instanceof MouseEvent) return ev.clientY + e.delta.y
  if (typeof TouchEvent !== "undefined" && ev instanceof TouchEvent) {
    const t = ev.touches[0] ?? ev.changedTouches[0]
    return t ? t.clientY + e.delta.y : null
  }
  return null
}

export function Board({ tasks, onOpen, showDate, focus, onContextMenu, aside }: BoardProps) {
  const move = useMoveTask()
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const grouped = useMemo(() => group(tasks), [tasks])
  // ドラッグ中だけ使う一時的な列構成（列をまたぐプレビュー用）。
  const [dragCols, setDragCols] = useState<Columns | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  // カレンダーの上で離したときは、カードが列へ戻るアニメーションを出さない（ドラッグ開始でリセット）。
  const [overCalendar, setOverCalendar] = useState(false)
  // ドロップ直後、キャッシュ更新が描画に届くまでの間だけ使う「着地後の列構成」。
  // これが無いと 1〜数フレーム旧データで描画され、カードが元の位置へ戻りかける。
  // tasks が更新された時点で自動的に無効になるよう、ドロップ時の tasks を一緒に持つ。
  const [settled, setSettled] = useState<{ cols: Columns; base: Task[] } | null>(null)
  const settledCols = settled?.base === tasks ? settled.cols : null
  const cols = dragCols ?? settledCols ?? grouped

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // スマホは長押しでドラッグ開始（通常のスワイプは横スクロール）。
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findCol = (c: Columns, id: UniqueIdentifier): TaskStatus | null =>
    isStatus(id) ? id : (STATUSES.find((s) => c[s].includes(Number(id))) ?? null)

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id))
    setDragCols(grouped)
    setOverCalendar(false)
    setDragging(true)
    buzz()
  }

  function onDragOver({ active, over }: DragOverEvent) {
    setOverCalendar(over != null && isCalendarDropId(over.id))
    if (!over || !dragCols) return
    const from = findCol(dragCols, active.id)
    const to = findCol(dragCols, over.id)
    if (!from || !to || from === to) return
    const id = Number(active.id)
    const target = dragCols[to].filter((x) => x !== id)
    const overIndex = isStatus(over.id) ? -1 : target.indexOf(Number(over.id))
    target.splice(overIndex < 0 ? target.length : overIndex, 0, id)
    setDragCols({ ...dragCols, [from]: dragCols[from].filter((x) => x !== id), [to]: target })
  }

  function finish() {
    setActiveId(null)
    setDragCols(null)
    setDragging(false)
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    const current = dragCols
    finish()
    // 着地の「ドン」（演出だけ。下の並べ替え・楽観的更新には関わらない）
    if (over) thud(isCalendarDropId(over.id) ? null : Number(active.id))
    // カレンダーへドロップ: 列はそのまま、カードに時刻を入れる
    if (over && isCalendarDropId(over.id)) {
      setSettled(null)
      const task = byId.get(Number(active.id))
      const y = pointerY(e)
      const data = over.data.current as CalendarDropData | undefined
      if (task && y != null && data?.kind === "calendar") data.onDropTask(task, y)
      return
    }
    if (!over || !current) {
      setSettled(null)
      return
    }
    const id = Number(active.id)
    const status = findCol(current, id)
    if (!status) return
    let list = current[status]
    if (!isStatus(over.id) && list.includes(Number(over.id))) {
      list = arrayMove(list, list.indexOf(id), list.indexOf(Number(over.id)))
    }
    setSettled({ cols: { ...current, [status]: list }, base: tasks })
    const idx = list.indexOf(id)
    const beforeId = list[idx + 1] ?? null

    // 元の位置から変わっていなければ何もしない。
    const task = byId.get(id)
    if (!task) return
    const original = grouped[task.status]
    const origIdx = original.indexOf(id)
    if (task.status === status && (original[origIdx + 1] ?? null) === beforeId) return
    move.mutate({ id, status, before_id: beforeId })
  }

  const activeTask = activeId != null ? byId.get(activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <main className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full w-max gap-3 px-4 py-4 sm:gap-4">
        {STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={cols[status].flatMap((id) => byId.get(id) ?? [])}
            onOpen={onOpen}
            showDate={showDate}
            dragging={activeId != null}
            focus={focus}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
      </main>
      {aside}
      <DragOverlay dropAnimation={overCalendar ? null : dropAnimation}>
        {activeTask ? (
          <TaskCard task={activeTask} onOpen={() => {}} showDate={showDate} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
