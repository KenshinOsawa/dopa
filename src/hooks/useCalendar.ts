import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import * as local from "@/local"
import { errorMessage } from "@/lib/errors"
import { CAL_KEY, TASKS_KEY } from "@/lib/queryKeys"
import type { CalendarDay, CalendarEvent, CalendarEventCreate, CalendarEventPatch, Task } from "@/types"

type QC = ReturnType<typeof useQueryClient>

/** 1 日分の予定。60 秒ごと＋ウィンドウのフォーカス時に取り直す。 */
export function useCalendarDay(date: string, enabled = true) {
  return useQuery({
    queryKey: [...CAL_KEY, date],
    queryFn: () => local.listDay(date),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

function refetchAll(qc: QC) {
  void qc.invalidateQueries({ queryKey: CAL_KEY })
  void qc.invalidateQueries({ queryKey: TASKS_KEY })
}

function fail(err: unknown, fallback: string) {
  toast.error(err instanceof Error && err.message ? err.message : errorMessage(err, fallback))
}

/** 変更前のキャッシュ（失敗時に戻す） */
interface Snapshot {
  cal: [readonly unknown[], CalendarDay | undefined][]
  tasks: Task[] | undefined
}

function snapshot(qc: QC): Snapshot {
  return {
    cal: qc.getQueriesData<CalendarDay>({ queryKey: CAL_KEY }),
    tasks: qc.getQueryData<Task[]>(TASKS_KEY),
  }
}

function restore(qc: QC, snap: Snapshot) {
  for (const [key, data] of snap.cal) qc.setQueryData(key, data)
  if (snap.tasks) qc.setQueryData(TASKS_KEY, snap.tasks)
}

function editEvents(qc: QC, fn: (events: CalendarEvent[]) => CalendarEvent[]) {
  for (const [key, data] of qc.getQueriesData<CalendarDay>({ queryKey: CAL_KEY })) {
    if (data) qc.setQueryData<CalendarDay>(key, { ...data, events: fn(data.events) })
  }
}

function editTasks(qc: QC, fn: (tasks: Task[]) => Task[]) {
  const prev = qc.getQueryData<Task[]>(TASKS_KEY)
  if (prev) qc.setQueryData<Task[]>(TASKS_KEY, fn(prev))
}

function stopRefetch(qc: QC) {
  void qc.cancelQueries({ queryKey: CAL_KEY })
  void qc.cancelQueries({ queryKey: TASKS_KEY })
}

/**
 * 予定のタイトル・時刻を変える（楽観的更新 → 失敗したら戻してトースト）。
 * カードに紐付く予定なら、カードの start/end もデータ層で同じ値になる。
 * 楽観的更新は mutate を呼んだその場で同期的に当てる（ドロップ直後に元の位置へ戻りかけないように）。
 */
export function usePatchEvent() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CalendarEventPatch; snap: Snapshot }) =>
      local.patchEvent(id, input),
    onSuccess: (event) => editEvents(qc, (events) => events.map((e) => (e.id === event.id ? event : e))),
    onError: (err, vars) => {
      restore(qc, vars.snap)
      fail(err, "予定の変更に失敗しました")
    },
    onSettled: () => refetchAll(qc),
  })
  const mutate = (id: string, input: CalendarEventPatch) => {
    stopRefetch(qc)
    const snap = snapshot(qc)
    const taskId =
      snap.cal.flatMap(([, d]) => d?.events ?? []).find((e) => e.id === id)?.task_id ?? null
    editEvents(qc, (events) =>
      events.map((e) =>
        e.id !== id
          ? e
          : {
              ...e,
              ...(input.title !== undefined && { title: input.title }),
              ...(input.start !== undefined && { start: input.start }),
              ...(input.end !== undefined && { end: input.end }),
            },
      ),
    )
    if (taskId != null) {
      editTasks(qc, (tasks) =>
        tasks.map((t) =>
          t.id !== taskId
            ? t
            : {
                ...t,
                ...(input.title !== undefined && { title: input.title }),
                ...(input.start !== undefined && { start_at: input.start, date: input.start.slice(0, 10) }),
                ...(input.end !== undefined && { end_at: input.end }),
              },
        ),
      )
    }
    mutation.mutate({ id, input, snap })
  }
  return { ...mutation, mutate }
}

/**
 * カードに時刻を入れる（ボードからのドロップ・未連携カードの帯を動かしたとき）。
 * カードの PATCH は予定の書き出し（push）も行う。
 */
export function useScheduleTask() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, start, end }: { id: number; start: string; end: string; snap: Snapshot }) =>
      local.updateTask(id, { start_at: start, end_at: end, date: start.slice(0, 10) }),
    onSuccess: (task) => editTasks(qc, (tasks) => tasks.map((t) => (t.id === task.id ? task : t))),
    onError: (err, vars) => {
      restore(qc, vars.snap)
      fail(err, "カードの時刻を変更できませんでした")
    },
    onSettled: () => refetchAll(qc),
  })
  const mutate = (id: number, start: string, end: string) => {
    stopRefetch(qc)
    const snap = snapshot(qc)
    editTasks(qc, (tasks) =>
      tasks.map((t) => (t.id === id ? { ...t, start_at: start, end_at: end, date: start.slice(0, 10) } : t)),
    )
    // 既に予定になっているカードは、その帯も一緒に動かす
    editEvents(qc, (events) => events.map((e) => (e.task_id === id ? { ...e, start, end } : e)))
    mutation.mutate({ id, start, end, snap })
  }
  return { ...mutation, mutate }
}

/** 空き時間から作成（カードも同時に作る）。 */
export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CalendarEventCreate) => local.createEvent(input),
    onSuccess: ({ task, event }) => {
      editTasks(qc, (tasks) => [...tasks.filter((t) => t.id !== task.id), task])
      if (event) {
        const day = event.start?.slice(0, 10)
        const data = day ? qc.getQueryData<CalendarDay>([...CAL_KEY, day]) : undefined
        if (data) qc.setQueryData<CalendarDay>([...CAL_KEY, day], { ...data, events: [...data.events, event] })
        toast.success("予定とカードを作成しました")
      } else {
        toast.warning("カードは作成しました（カレンダーへの書き出しは次回同期で再送します）")
      }
    },
    onError: (err) => fail(err, "予定を作成できませんでした"),
    onSettled: () => refetchAll(qc),
  })
}

/** 予定を削除（カード由来ならカードも消える）。 */
export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: CalendarEvent) => local.deleteEvent(event.id),
    onMutate: (event) => {
      stopRefetch(qc)
      const snap = snapshot(qc)
      editEvents(qc, (events) => events.filter((e) => e.id !== event.id))
      if (event.task_id != null) editTasks(qc, (tasks) => tasks.filter((t) => t.id !== event.task_id))
      return snap
    },
    onSuccess: () => toast.success("予定を削除しました"),
    onError: (err, _event, snap) => {
      if (snap) restore(qc, snap)
      fail(err, "予定を削除できませんでした")
    },
    onSettled: () => refetchAll(qc),
  })
}
