import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import * as local from "@/local"
import { errorMessage } from "@/lib/errors"
import { award, cardMoved } from "@/lib/celebrate"
import { applyMove } from "@/lib/format"
import type { CreateTaskInput, GcalStatus, MoveInput, Task, UpdateTaskInput } from "@/types"
import { CAL_KEY, GCAL_KEY, TASKS_KEY, XP_KEY } from "@/lib/queryKeys"


type QC = ReturnType<typeof useQueryClient>

export function useTasks() {
  return useQuery({
    queryKey: TASKS_KEY,
    queryFn: local.listTasks,
  })
}

function patchList(qc: QC, updater: (tasks: Task[]) => Task[]): Task[] | undefined {
  const prev = qc.getQueryData<Task[]>(TASKS_KEY)
  if (prev) qc.setQueryData<Task[]>(TASKS_KEY, updater(prev))
  return prev
}

/** カードの変更は予定（カレンダー UI）にも波及するので両方取り直す。 */
function refetchAll(qc: QC) {
  void qc.invalidateQueries({ queryKey: TASKS_KEY })
  void qc.invalidateQueries({ queryKey: CAL_KEY })
}

function onFail(qc: QC, err: unknown) {
  toast.error(errorMessage(err, "操作に失敗しました"))
  qc.invalidateQueries({ queryKey: TASKS_KEY })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => local.createTask(input),
    onSuccess: (task) => {
      patchList(qc, (tasks) => [...tasks, task])
      toast.success("カードを追加しました")
    },
    onError: (err) => onFail(qc, err),
    onSettled: () => refetchAll(qc),
  })
}

export function useImportText() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { text: string; date: string | null }) => local.importText(input.text, input.date),
    onSuccess: (r) => toast.success(`作成 ${r.created} 件 / 更新 ${r.updated} 件`),
    onError: (err) => onFail(qc, err),
    onSettled: () => refetchAll(qc),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateTaskInput }) => local.updateTask(id, input),
    onSuccess: (task) => patchList(qc, (tasks) => tasks.map((t) => (t.id === task.id ? task : t))),
    onError: (err) => onFail(qc, err),
    onSettled: () => refetchAll(qc),
  })
}

export function useMoveTask() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, status, before_id }: MoveInput & { prev?: Task[] }) =>
      local.moveTask(id, status, before_id),
    onSuccess: (res, vars) => {
      // XP はカードごと初回だけ（データ層が判定）。付いたらカード位置に +XP・コンボ
      if (res.xp) {
        award(res.xp, vars.id)
        qc.setQueryData(XP_KEY, res.xp.stats)
      }
    },
    onError: (err, vars) => {
      if (vars.prev) qc.setQueryData(TASKS_KEY, vars.prev)
      onFail(qc, err)
    },
    onSettled: () => {
      refetchAll(qc)
      void qc.invalidateQueries({ queryKey: XP_KEY })
    },
  })
  // 楽観的更新は mutate を呼んだその場で同期的に当てる。onMutate（非同期）に任せると、
  // ドロップ直後の数フレームだけ旧データで描画されてカードが元の位置へ戻りかける。
  const mutate = (input: MoveInput, opts?: { onSuccess?: () => void }) => {
    void qc.cancelQueries({ queryKey: TASKS_KEY })
    const prev = patchList(qc, (tasks) => applyMove(tasks, input.id, input.status, input.before_id))
    const moved = prev?.find((t) => t.id === input.id)
    const from = moved?.status
    mutation.mutate({ ...input, prev }, opts)
    // 列が変わったら演出（ドロップ確定後。描画を待ってからカード位置に出す）
    if (from && from !== input.status) cardMoved(input.id, input.status, moved?.title)
  }
  return { ...mutation, mutate }
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => local.deleteTask(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      return { prev: patchList(qc, (tasks) => tasks.filter((t) => t.id !== id)) }
    },
    onSuccess: () => toast.success("カードを削除しました"),
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev)
      onFail(qc, err)
    },
    onSettled: () => refetchAll(qc),
  })
}

export function useGcalStatus() {
  return useQuery({
    queryKey: GCAL_KEY,
    queryFn: () => local.gcalStatus(),
    refetchInterval: 30_000,
  })
}

export function useGcalSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => local.gcalSync(),
    onSuccess: (s: GcalStatus) => {
      qc.setQueryData(GCAL_KEY, s)
      if (s.logged_in) toast.success(s.message ?? "同期しました")
      else toast.warning(s.message ?? "Google カレンダーに未接続です")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? `同期に失敗しました: ${err.message}` : "同期に失敗しました")
      qc.invalidateQueries({ queryKey: GCAL_KEY })
    },
    onSettled: () => refetchAll(qc),
  })
}
