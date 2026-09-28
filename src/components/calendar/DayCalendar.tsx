import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react"
import type * as React from "react"
import { useDndContext, useDroppable } from "@dnd-kit/core"
import { CalendarOff, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Settings2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { ContextMenu, type MenuItem } from "@/components/board/ContextMenu"
import { Popover } from "./Popover"
import {
  useCalendarDay,
  useCreateEvent,
  useDeleteEvent,
  usePatchEvent,
  useScheduleTask,
} from "@/hooks/useCalendar"
import { useGcalAuth } from "@/hooks/useGcalAuth"
import { useDeleteTask, useMoveTask, useUpdateTask } from "@/hooks/useTasks"
import {
  addDays,
  type CalendarDropData,
  clamp,
  clipToDay,
  clockLabel,
  DAY_MIN,
  eventColor,
  eventTextColor,
  HOUR_PX,
  isoAt,
  layoutEvents,
  PX_PER_MIN,
  snap,
  SNAP_MIN,
  snapDown,
  unsyncedCards,
} from "@/lib/calendar"
import { dateOf, toLocalIso } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { CalendarEvent, Task } from "@/types"

interface DayCalendarProps {
  /** 全カード（フィルタ前）。未連携の時刻付きカードの帯・カード編集に使う */
  tasks: Task[]
  onOpenTask: (task: Task) => void
  className?: string
  /** スマホのフローティング表示で「たたむ」ボタンを出す */
  onCollapse?: () => void
}

/** 帯 1 本 */
interface Item {
  key: string
  title: string
  /** その日の 0:00 からの分（日をまたぐ予定は切り詰め済み） */
  start: number
  end: number
  /** ドラッグで時刻を動かせるか */
  movable: boolean
  event: CalendarEvent | null
  task: Task | null
  /** 未連携・未 push の時刻付きカード（点線） */
  ghost: boolean
}

interface DragState {
  key: string
  mode: "move" | "resize"
  y0: number
  origStart: number
  origEnd: number
  start: number
  end: number
  moved: boolean
}

interface SelectState {
  anchor: number
  start: number
  end: number
  dragging: boolean
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]
const DONE_PREFIX = "✅ "
/** 帯の最小の高さ（15 分 = 12px − 隙間 1px。これ未満の予定だけ実時間より少し高くなる） */
const MIN_BAND_PX = 11
const DURATION_KEY = "dopa:calendar-default-minutes"
const DURATIONS = [15, 30, 45, 60, 90, 120]
/** ドロップしたカード・クリックで作る予定の既定の長さ（設定で変更可） */
const DEFAULT_MINUTES = 60

function loadDuration(): number {
  try {
    const v = Number(localStorage.getItem(DURATION_KEY))
    if (DURATIONS.includes(v)) return v
  } catch {
    /* noop */
  }
  return DEFAULT_MINUTES
}

/** 現在のローカル時刻（日付と 0:00 からの分） */
function localNow(ms: number): { date: string; minutes: number } {
  const d = new Date(ms)
  return { date: dateOf(d), minutes: d.getHours() * 60 + d.getMinutes() }
}

function dayTitle(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return `${m}/${d}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}

function minutesBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60_000)
}

export function DayCalendar({ tasks, onOpenTask, className, onCollapse }: DayCalendarProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const now = localNow(nowMs)
  const [date, setDate] = useState(now.date)
  const auth = useGcalAuth()
  const { data, isLoading, isError, error } = useCalendarDay(date)
  const ready = data?.logged_in === true

  const [newMinutes, setNewMinutesState] = useState(loadDuration)
  const [showSettings, setShowSettings] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [select, setSelect] = useState<SelectState | null>(null)
  const [creating, setCreating] = useState<{ x: number; y: number } | null>(null)
  const [pending, setPending] = useState<{ title: string; start: number; end: number } | null>(null)
  const [popover, setPopover] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item } | null>(null)
  const [confirm, setConfirm] = useState<Item | null>(null)

  const patchEvent = usePatchEvent()
  const schedule = useScheduleTask()
  const createEvent = useCreateEvent()
  const deleteEvent = useDeleteEvent()
  const moveTask = useMoveTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)

  // 現在時刻の赤線（30 秒ごと）
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // 開いたとき・日付を変えたとき: 今日なら現在時刻の少し上、他の日は 8:00 へ
  useEffect(() => {
    const el = scrollRef.current
    if (!ready || !el || scrolledFor.current === date) return
    const cur = localNow(Date.now())
    const target = cur.date === date ? cur.minutes - 90 : 8 * 60
    el.scrollTop = Math.max(0, target * PX_PER_MIN)
    scrolledFor.current = date
  }, [ready, date])

  function setNewMinutes(v: number) {
    setNewMinutesState(v)
    try {
      localStorage.setItem(DURATION_KEY, String(v))
    } catch {
      /* noop */
    }
  }

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  const { timed, allDay } = useMemo(() => {
    const timed: Item[] = []
    const allDay: CalendarEvent[] = []
    if (!data?.logged_in) return { timed, allDay }
    for (const ev of data.events) {
      if (ev.all_day) {
        if (ev.start_date && ev.end_date && ev.start_date <= date && date < ev.end_date) allDay.push(ev)
        continue
      }
      if (!ev.start) continue
      const clip = clipToDay(date, ev.start, ev.end)
      if (!clip) continue
      const task = ev.task_id != null ? (tasksById.get(ev.task_id) ?? null) : null
      timed.push({
        key: `e:${ev.id}`,
        title: ev.title,
        start: clip.start,
        end: clip.end,
        movable: ev.can_edit && clip.whole,
        event: ev,
        task,
        ghost: false,
      })
    }
    // 予定になっていない時刻付きカード（未ログイン中に作った・push 失敗・同期待ち）は点線で。
    // 同じ予定が Google 側にある（紐付き・calendar 由来・同タイトルで重なる）ものは出さない。
    // 重なりの配置（layoutEvents）はこの除外の後に行う
    for (const g of unsyncedCards(tasks, data.events, date)) {
      timed.push({
        key: `t:${g.task.id}`,
        title: g.task.title,
        start: g.start,
        end: g.end,
        movable: g.whole,
        event: null,
        task: g.task,
        ghost: true,
      })
    }
    return { timed, allDay }
  }, [data, date, tasks, tasksById])

  const placed = useMemo(() => layoutEvents(timed), [timed])

  // ──── ボードからのドロップ ────
  const minuteAt = useCallback((clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return null
    return clamp((clientY - rect.top) / PX_PER_MIN, 0, DAY_MIN)
  }, [])

  const dropLength = useCallback(
    (task: Task) =>
      task.start_at && task.end_at
        ? clamp(minutesBetween(task.start_at, task.end_at), SNAP_MIN, 12 * 60)
        : newMinutes,
    [newMinutes],
  )

  function dropTask(task: Task, clientY: number) {
    const m = minuteAt(clientY)
    if (m == null) return
    const len = dropLength(task)
    const start = clamp(snapDown(m), 0, DAY_MIN - len)
    const startIso = isoAt(date, start)
    const endIso = isoAt(date, start + len)
    if (task.source === "calendar" && task.gcal_event_id) {
      patchEvent.mutate(task.gcal_event_id, { start: startIso, end: endIso })
    } else {
      schedule.mutate(task.id, startIso, endIso)
    }
  }

  const dropId = `calendar:${useId()}`
  const dropData: CalendarDropData = { kind: "calendar", onDropTask: dropTask }
  const { setNodeRef: setDropRef } = useDroppable({ id: dropId, data: dropData, disabled: !ready })
  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      setDropRef(el)
    },
    [setDropRef],
  )

  // ドラッグ中のカードが上に来ている間は、落ちる位置に帯のプレビューを出す
  const { active, over } = useDndContext()
  const hovering = ready && active != null && over?.id === dropId
  const [hoverMin, setHoverMin] = useState<number | null>(null)
  useEffect(() => {
    if (!hovering) return
    const onMove = (e: PointerEvent) => setHoverMin(minuteAt(e.clientY))
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [hovering, minuteAt])
  let preview: { title: string; start: number; end: number } | null = null
  if (hovering && hoverMin != null) {
    const task = tasksById.get(Number(active.id))
    const m = hoverMin
    if (task) {
      const len = dropLength(task)
      const start = clamp(snapDown(m), 0, DAY_MIN - len)
      preview = { title: task.title, start, end: start + len }
    }
  }

  // ──── 帯の移動・リサイズ・クリック ────
  function onItemPointerDown(e: React.PointerEvent, item: Item, mode: DragState["mode"]) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      key: item.key,
      mode,
      y0: e.clientY,
      origStart: item.start,
      origEnd: item.end,
      start: item.start,
      end: item.end,
      moved: false,
    })
  }

  function onItemPointerMove(e: React.PointerEvent, item: Item) {
    if (!drag || drag.key !== item.key) return
    const dy = e.clientY - drag.y0
    if (!drag.moved && Math.abs(dy) < 4) return
    if (!item.movable) return
    const delta = snap(dy / PX_PER_MIN)
    if (drag.mode === "move") {
      const len = drag.origEnd - drag.origStart
      const start = clamp(drag.origStart + delta, 0, DAY_MIN - len)
      setDrag({ ...drag, start, end: start + len, moved: true })
    } else {
      const end = clamp(drag.origEnd + delta, drag.origStart + SNAP_MIN, DAY_MIN)
      setDrag({ ...drag, end, moved: true })
    }
  }

  function onItemPointerUp(e: React.PointerEvent, item: Item) {
    const d = drag
    setDrag(null)
    if (!d || d.key !== item.key) return
    if (!d.moved) {
      openItem(item, e.clientX, e.clientY)
      return
    }
    if (d.start === d.origStart && d.end === d.origEnd) return
    const startIso = isoAt(date, d.start)
    const endIso = isoAt(date, d.end)
    if (item.event) patchEvent.mutate(item.event.id, { start: startIso, end: endIso })
    else if (item.task) schedule.mutate(item.task.id, startIso, endIso)
  }

  function openItem(item: Item, x: number, y: number) {
    if (item.task) onOpenTask(item.task)
    else if (item.event) setPopover({ event: item.event, x, y })
  }

  function openMenu(e: React.MouseEvent, item: Item) {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }

  function menuItems(item: Item): MenuItem[] {
    const items: MenuItem[] = []
    const task = item.task
    if (task) {
      items.push({ label: "編集", onSelect: () => onOpenTask(task) })
      if (task.status !== "done") {
        items.push({
          label: "やった にする",
          onSelect: () => moveTask.mutate({ id: task.id, status: "done", before_id: null }),
        })
      } else {
        items.push({
          label: "未着手に戻す",
          onSelect: () => moveTask.mutate({ id: task.id, status: "todo", before_id: null }),
        })
      }
      if (task.source !== "calendar") {
        items.push({
          label: "時刻を外す（カードだけ残す）",
          onSelect: () => updateTask.mutate({ id: task.id, input: { start_at: null, end_at: null } }),
        })
      }
    } else if (item.event) {
      const ev = item.event
      items.push({ label: "詳細・編集", onSelect: () => setPopover({ event: ev, x: menu?.x ?? 0, y: menu?.y ?? 0 }) })
    }
    const link = item.event?.html_link
    if (link) items.push({ label: "Google カレンダーで開く", onSelect: () => window.open(link, "_blank", "noopener") })
    items.push({ label: "削除…", onSelect: () => setConfirm(item), danger: true })
    return items
  }

  function confirmDelete(item: Item) {
    if (item.event) deleteEvent.mutate(item.event, { onSettled: () => setConfirm(null) })
    else if (item.task) deleteTask.mutate(item.task.id, { onSettled: () => setConfirm(null) })
  }

  // ──── 空き時間のクリック／ドラッグで作成 ────
  function onGridPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    if (creating || popover) return // 開いているパネルを閉じるだけ
    const m = minuteAt(e.clientY)
    if (m == null) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const anchor = clamp(snapDown(m), 0, DAY_MIN - SNAP_MIN)
    setSelect({ anchor, start: anchor, end: anchor + SNAP_MIN, dragging: true })
  }

  function onGridPointerMove(e: React.PointerEvent) {
    if (!select?.dragging) return
    const m = minuteAt(e.clientY)
    if (m == null) return
    const a = select.anchor
    const next =
      m >= a
        ? { start: a, end: clamp(Math.ceil(m / SNAP_MIN) * SNAP_MIN, a + SNAP_MIN, DAY_MIN) }
        : { start: snapDown(m), end: a + SNAP_MIN }
    if (next.start !== select.start || next.end !== select.end) setSelect({ ...select, ...next })
  }

  function onGridPointerUp(e: React.PointerEvent) {
    if (!select?.dragging) return
    const clicked = select.start === select.anchor && select.end === select.anchor + SNAP_MIN
    const end = clicked ? Math.min(select.anchor + newMinutes, DAY_MIN) : select.end
    setSelect({ ...select, end, dragging: false })
    setCreating({ x: e.clientX, y: e.clientY })
  }

  const closeCreate = useCallback(() => {
    setCreating(null)
    setSelect(null)
  }, [])

  function submitCreate(title: string) {
    if (!select) return
    const { start, end } = select
    setPending({ title, start, end })
    closeCreate()
    createEvent.mutate(
      { title, start: isoAt(date, start), end: isoAt(date, end) },
      { onSettled: () => setPending(null) },
    )
  }

  const closeMenu = useCallback(() => setMenu(null), [])
  const closePopover = useCallback(() => setPopover(null), [])

  const today = now.date
  const header = (
    <div className="flex items-center gap-1 px-3 pt-3 pb-2">
      <h2 className="mr-1 text-sm font-semibold text-zinc-200">カレンダー</h2>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="xs" onClick={() => setDate(today)} disabled={date === today}>
        今日
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => setDate(addDays(date, 1))} aria-label="次の日">
        <ChevronRight />
      </Button>
      <span className={cn("ml-1 text-sm font-medium tabular-nums", date === today ? "text-cyan-300" : "text-zinc-300")}>
        {dayTitle(date)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-7"
        onClick={() => setShowSettings((v) => !v)}
        aria-expanded={showSettings}
        aria-label="カレンダー設定"
        title="カレンダー設定"
      >
        <Settings2 />
      </Button>
      {onCollapse && (
        <Button variant="ghost" size="icon" className="size-7" onClick={onCollapse} aria-label="たたむ">
          <ChevronDown />
        </Button>
      )}
    </div>
  )

  let body: React.ReactNode
  if (isLoading) {
    body = <p className="px-4 py-6 text-sm text-zinc-500">予定を読み込み中...</p>
  } else if (isError) {
    body = (
      <p className="px-4 py-6 text-sm text-red-400">
        予定を取得できませんでした{error instanceof Error ? `: ${error.message}` : ""}
      </p>
    )
  } else if (!ready) {
    const expired = auth.state === "expired"
    body = (
      <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm text-zinc-400">
        <p className="flex items-start gap-2">
          <CalendarOff className="mt-0.5 size-4 shrink-0" />
          {expired
            ? "Google カレンダーの接続が切れました（安全のため約 1 時間ごとに切れます）"
            : "Google カレンダーに接続すると、今日の予定をここに出して、カードをドロップで予定にできます"}
        </p>
        <Button size="sm" onClick={auth.connect} disabled={auth.connecting}>
          <CalendarPlus />
          {expired ? "再接続" : "Google カレンダーに接続"}
        </Button>
      </div>
    )
  } else {
    body = (
      <>
        {allDay.length > 0 && (
          <div className="flex flex-col gap-0.5 border-b border-white/10 px-2 pb-1.5 pl-11">
            {allDay.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={(e) => setPopover({ event: ev, x: e.clientX, y: e.clientY })}
                onContextMenu={(e) =>
                  openMenu(e, { key: `a:${ev.id}`, title: ev.title, start: 0, end: 0, movable: false, event: ev, task: null, ghost: false })
                }
                className="truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium"
                style={{
                  background: `color-mix(in srgb, ${eventColor(ev.color_id)} var(--kb-event-mix), var(--kb-event-sink))`,
                  color: eventTextColor(ev.color_id),
                }}
                title={ev.title}
              >
                {ev.title}
              </button>
            ))}
          </div>
        )}
        <div ref={setScrollRef} className={cn("min-h-0 flex-1 overflow-y-auto", hovering && "bg-cyan-400/5")}>
          <div ref={gridRef} className="relative select-none" style={{ height: DAY_MIN * PX_PER_MIN }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute inset-x-0" style={{ top: h * HOUR_PX }}>
                {h > 0 && (
                  <span className="absolute left-0 w-9 -translate-y-1/2 pr-1 text-right text-[10px] text-zinc-500 tabular-nums">
                    {h}:00
                  </span>
                )}
                <div className="ml-10 border-t border-white/5" />
              </div>
            ))}
            <div
              className="absolute inset-y-0 right-1 left-10 cursor-cell"
              data-testid="calendar-grid"
              onPointerDown={onGridPointerDown}
              onPointerMove={onGridPointerMove}
              onPointerUp={onGridPointerUp}
              onPointerCancel={() => setSelect(null)}
            >
              {timed.map((item) => {
                const pos = placed.get(item) ?? { left: 0, width: 100, z: 1 }
                const dragging = drag?.key === item.key && drag.moved
                const start = dragging ? drag.start : item.start
                const end = dragging ? drag.end : item.end
                return (
                  <Band
                    key={item.key}
                    item={item}
                    start={start}
                    end={end}
                    left={pos.left}
                    width={pos.width}
                    z={pos.z}
                    dragging={dragging}
                    onPointerDown={onItemPointerDown}
                    onPointerMove={onItemPointerMove}
                    onPointerUp={onItemPointerUp}
                    onPointerCancel={() => setDrag(null)}
                    onContextMenu={openMenu}
                    onOpen={openItem}
                  />
                )
              })}
              {select && <Ghost title="(新しい予定)" start={select.start} end={select.end} tone="select" />}
              {pending && <Ghost title={pending.title} start={pending.start} end={pending.end} tone="pending" />}
              {preview && <Ghost title={preview.title} start={preview.start} end={preview.end} tone="drop" />}
            </div>
            {date === today && (
              <div
                className="pointer-events-none absolute right-0 left-9 z-20"
                style={{ top: now.minutes * PX_PER_MIN }}
                aria-hidden
              >
                <div className="absolute -top-[5px] -left-[5px] size-2.5 rounded-full bg-pink-400 shadow-[0_0_10px_2px_rgb(255_62_165/0.9)]" />
                <div className="h-0.5 bg-linear-to-r from-pink-400 to-orange-300 shadow-[0_0_8px_rgb(255_62_165/0.9)]" />
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <section aria-label="カレンダー" className={cn("flex min-h-0 flex-col", className)}>
      {header}
      {showSettings && (
        <label className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-zinc-300">
          新しい予定・ドロップしたカードの長さ
          <select
            value={newMinutes}
            onChange={(e) => setNewMinutes(Number(e.target.value))}
            className="ml-auto rounded-md border border-white/15 bg-(--kb-panel-2) px-1.5 py-0.5 text-xs"
          >
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m} 分
              </option>
            ))}
          </select>
        </label>
      )}
      {body}

      {creating && select && (
        <Popover x={creating.x} y={creating.y} onClose={closeCreate} label="予定を作成">
          <CreateForm
            label={`${dayTitle(date)} ${clockLabel(select.start)}–${clockLabel(select.end)}`}
            onSubmit={submitCreate}
            onCancel={closeCreate}
          />
        </Popover>
      )}
      {popover && (
        <Popover x={popover.x} y={popover.y} onClose={closePopover} label="予定の詳細">
          <EventEditor
            key={popover.event.id}
            event={popover.event}
            date={date}
            onSave={(input) => {
              if (Object.keys(input).length > 0) patchEvent.mutate(popover.event.id, input)
              closePopover()
            }}
            onDelete={() => {
              const ev = popover.event
              closePopover()
              setConfirm({ key: `e:${ev.id}`, title: ev.title, start: 0, end: 0, movable: false, event: ev, task: null, ghost: false })
            }}
          />
        </Popover>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.item)} onClose={closeMenu} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.event ? "予定を削除" : "カードを削除"}
          message={
            confirm.event
              ? `「${confirm.title}」を Google カレンダーから削除しますか？${confirm.task ? "（カードも削除されます）" : ""}${
                  confirm.event.recurring ? "（繰り返し予定のこの回だけ）" : ""
                }`
              : `「${confirm.title}」を削除しますか？`
          }
          confirmLabel="削除"
          pending={deleteEvent.isPending || deleteTask.isPending}
          onConfirm={() => confirmDelete(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  )
}

// ──── 帯 ────
interface BandProps {
  item: Item
  start: number
  end: number
  /** 配置（%）と重ね順 */
  left: number
  width: number
  z: number
  dragging: boolean
  onPointerDown: (e: React.PointerEvent, item: Item, mode: DragState["mode"]) => void
  onPointerMove: (e: React.PointerEvent, item: Item) => void
  onPointerUp: (e: React.PointerEvent, item: Item) => void
  onPointerCancel: () => void
  onContextMenu: (e: React.MouseEvent, item: Item) => void
  onOpen: (item: Item, x: number, y: number) => void
}

function Band({
  item,
  start,
  end,
  left,
  width,
  z,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
  onOpen,
}: BandProps) {
  const ev = item.event
  // 「✅ 」はタイトルから外し、done は見た目（薄く・取り消し線）で表す
  const marked = item.title.startsWith(DONE_PREFIX)
  const title = marked ? item.title.slice(DONE_PREFIX.length) : item.title
  const done = item.task ? item.task.status === "done" : (ev?.done ?? false) || marked
  const pomodoro = ev?.kind === "pomodoro"
  const declined = ev?.response === "declined"
  const unanswered = ev?.response === "needsAction" || ev?.response === "tentative"
  const color = eventColor(ev?.color_id)
  // 高さは実時間どおり（次の帯に被らない。下に 1px の隙間）。
  // 1 時間未満は「タイトル, 12:45」の 1 行（はみ出しは帯の端で切る）、1 時間以上は 2 行目に時刻範囲
  const height = Math.max((end - start) * PX_PER_MIN - 1, MIN_BAND_PX)
  const size: "tiny" | "short" | "tall" = end - start < 25 ? "tiny" : end - start < 60 ? "short" : "tall"

  // 左端に細いカラーストライプ。未回答・欠席の招待は枠線だけ（中は塗らない）
  // 色は colorId どおり、少しだけ暗色（--kb-event-sink。休憩中の明るいテーマでも白文字が読める濃さ）に沈めて縁を明るく光らせる
  const stripe = `3px solid color-mix(in srgb, ${color} 50%, white)`
  let style: React.CSSProperties
  if (item.ghost) {
    style = {
      background: "color-mix(in srgb, var(--kb-contrast) 5%, transparent)",
      border: "1.5px dashed color-mix(in srgb, var(--kb-contrast) 35%, transparent)",
      color: "var(--kb-muted-text)",
    }
  } else if (pomodoro) {
    style = { background: `color-mix(in srgb, ${color} 22%, var(--kb-panel))`, borderLeft: `3px solid ${color}`, color: "var(--kb-muted-text)" }
  } else if (declined || unanswered) {
    style = {
      background: "var(--kb-panel)",
      border: `1px solid ${color}`,
      borderLeft: `3px solid ${color}`,
      color: `color-mix(in srgb, ${color} 50%, var(--kb-contrast))`,
    }
  } else {
    style = {
      background: `color-mix(in srgb, ${color} var(--kb-event-mix), var(--kb-event-sink))`,
      borderLeft: stripe,
      color: eventTextColor(ev?.color_id),
      boxShadow: done ? undefined : `0 0 12px -4px ${color}`,
    }
  }

  const time = `${clockLabel(start)}–${clockLabel(end)}`
  const notes = [
    item.ghost && "カレンダー未反映",
    done && "やった",
    ev?.recurring && "繰り返し予定",
    pomodoro && "集中の記録",
    declined && "欠席",
    unanswered && "未回答",
  ].filter(Boolean)
  const tooltip = `${title}\n${time}${notes.length ? `\n${notes.join("・")}` : ""}`

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={tooltip.replaceAll("\n", " ")}
      title={tooltip}
      data-cal-item={item.key}
      onPointerDown={(e) => onPointerDown(e, item, "move")}
      onPointerMove={(e) => onPointerMove(e, item)}
      onPointerUp={(e) => onPointerUp(e, item)}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => onContextMenu(e, item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          onOpen(item, r.left, r.top)
        }
      }}
      style={{
        ...style,
        top: start * PX_PER_MIN,
        height,
        left: `${left}%`,
        width: `calc(${width}% - 2px)`,
        zIndex: dragging ? 30 : z,
      }}
      className={cn(
        "absolute overflow-hidden rounded-[5px] pr-1 pl-1 break-words outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400",
        left > 0 && "shadow-[0_0_0_1px_var(--kb-void)]", // 重ねた・並べた帯は背景色の縁で区切る
        size === "tiny" && "py-0 text-[10px] leading-[11px] whitespace-nowrap",
        size === "short" && "py-0.5 text-[11px] leading-[14px] whitespace-nowrap",
        size === "tall" && "py-0.5 text-[11px] leading-[15px]",
        item.movable ? "cursor-grab" : "cursor-pointer",
        dragging && "cursor-grabbing opacity-90 shadow-lg",
        done && "opacity-50",
      )}
    >
      {size !== "tall" ? (
        // 「買い出し, 12:45」を 1 行で（Google カレンダーと同じ形）
        <p className={cn("overflow-hidden", (done || declined) && "line-through")}>
          <span className="font-semibold">{title}</span>
          <span className="tabular-nums">, {clockLabel(start)}</span>
        </p>
      ) : (
        <>
          <p className={cn("font-semibold", (done || declined) && "line-through")}>{title}</p>
          <p className="tabular-nums opacity-80">{time}</p>
        </>
      )}
      {item.movable && (
        <div
          aria-hidden
          data-resize-handle
          onPointerDown={(e) => onPointerDown(e, item, "resize")}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
        />
      )}
    </div>
  )
}

function Ghost({ title, start, end, tone }: { title: string; start: number; end: number; tone: "select" | "pending" | "drop" }) {
  return (
    <div
      aria-hidden
      data-cal-ghost={tone}
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] leading-tight",
        tone === "select" && "bg-fuchsia-500/75 text-white shadow-[0_0_16px_-2px_rgb(217_70_239/0.8)]",
        tone === "pending" && "border border-dashed border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100",
        tone === "drop" && "border-2 border-dashed border-pink-400 bg-pink-500/20 text-pink-50 shadow-[0_0_20px_-4px_rgb(255_62_165/0.8)]",
      )}
      style={{ top: start * PX_PER_MIN, height: Math.max((end - start) * PX_PER_MIN, MIN_BAND_PX) }}
    >
      <div className="truncate font-medium">{title}</div>
      <div className="truncate tabular-nums opacity-80">
        {clockLabel(start)}–{clockLabel(end)}
      </div>
    </div>
  )
}

// ──── ポップオーバーの中身 ────
function CreateForm({ label, onSubmit, onCancel }: { label: string; onSubmit: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("")
  function submit(e: FormEvent) {
    e.preventDefault()
    if (title.trim()) onSubmit(title.trim())
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-xs text-zinc-400 tabular-nums">{label}</p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル（カードも作成）" autoFocus aria-label="タイトル" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" size="sm" disabled={!title.trim()}>
          作成
        </Button>
      </div>
    </form>
  )
}

function EventEditor({
  event,
  date,
  onSave,
  onDelete,
}: {
  event: CalendarEvent
  date: string
  onSave: (input: { title?: string; start?: string; end?: string }) => void
  onDelete: () => void
}) {
  const timed = !event.all_day && event.start != null && event.end != null
  const sameDay = timed && event.start!.slice(0, 10) === date && event.end!.slice(0, 10) === date
  const editableTime = event.can_edit && sameDay
  const [title, setTitle] = useState(event.title)
  const [start, setStart] = useState(timed ? event.start!.slice(11, 16) : "")
  const [end, setEnd] = useState(timed ? event.end!.slice(11, 16) : "")

  function submit(e: FormEvent) {
    e.preventDefault()
    const input: { title?: string; start?: string; end?: string } = {}
    if (title.trim() && title.trim() !== event.title) input.title = title.trim()
    if (editableTime && (start !== event.start!.slice(11, 16) || end !== event.end!.slice(11, 16))) {
      if (!start || !end || end <= start) return
      input.start = toLocalIso(date, start)
      input.end = toLocalIso(date, end)
    }
    onSave(input)
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="タイトル" disabled={!event.can_edit} />
      {timed ? (
        editableTime ? (
          <div className="flex items-center gap-1.5">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="開始" step={900} />
            <span className="text-zinc-500">–</span>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="終了" step={900} />
          </div>
        ) : (
          <p className="text-xs text-zinc-400 tabular-nums">
            {event.start!.slice(5, 16).replace("T", " ")} – {event.end!.slice(5, 16).replace("T", " ")}
          </p>
        )
      ) : (
        <p className="text-xs text-zinc-400">終日</p>
      )}
      {event.recurring && <p className="text-xs text-zinc-400">繰り返し予定（変更はこの回だけ）</p>}
      {!event.can_edit && <p className="text-xs text-zinc-400">招待された予定のため変更できません</p>}
      <div className="flex items-center gap-1 pt-1">
        {event.html_link && (
          <a
            href={event.html_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
          >
            <ExternalLink className="size-3.5" />
            Google カレンダーで開く
          </a>
        )}
        <Button type="button" variant="ghost" size="icon" className="ml-auto size-8 text-red-400 hover:bg-red-500/15" onClick={onDelete} aria-label="削除" title="削除">
          <Trash2 />
        </Button>
        {event.can_edit && (
          <Button type="submit" size="sm">
            保存
          </Button>
        )}
      </div>
    </form>
  )
}
