import { useEffect } from "react"
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { BoardPage } from "@/pages/BoardPage"
import { onBroadcast, type Topic } from "@/local/bus"
import { authState, subscribeAuth } from "@/local/gcal/auth"
import { syncAll } from "@/local/gcal/sync"
import { CAL_KEY, GCAL_KEY, POMO_KEY, REPORT_KEY, TASKS_KEY, XP_KEY } from "@/lib/queryKeys"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
})

const KEYS: Record<Exclude<Topic, "all">, readonly unknown[][]> = {
  tasks: [[...TASKS_KEY], [...REPORT_KEY]],
  xp: [[...XP_KEY]],
  pomodoro: [[...POMO_KEY], [...XP_KEY]],
  report: [[...REPORT_KEY]],
  calendar: [[...CAL_KEY], [...GCAL_KEY]],
}

/** 定期同期（Google カレンダー）の間隔 */
const SYNC_INTERVAL_MS = 5 * 60_000

/**
 * データ層（IndexedDB・カレンダー同期）の変化を画面のキャッシュへ。
 * - 同じタブ・別タブでの書き込み → 該当するクエリを取り直す
 * - 接続状態が変わった → カレンダーを取り直す
 * - 接続中は 5 分ごとに同期（予定 → カード）
 */
function LiveSync() {
  const qc = useQueryClient()

  useEffect(
    () =>
      onBroadcast((topics) => {
        if (topics.includes("all")) {
          void qc.invalidateQueries()
          return
        }
        for (const t of topics) for (const key of KEYS[t as Exclude<Topic, "all">] ?? []) void qc.invalidateQueries({ queryKey: key })
      }),
    [qc],
  )

  useEffect(() => {
    let prev = authState()
    const run = () => {
      if (authState() === "connected") void syncAll().catch(() => undefined)
    }
    const unsub = subscribeAuth(() => {
      const next = authState()
      if (next === prev) return
      prev = next
      void qc.invalidateQueries({ queryKey: CAL_KEY })
      void qc.invalidateQueries({ queryKey: GCAL_KEY })
      if (next === "connected") run()
    })
    run()
    const id = window.setInterval(run, SYNC_INTERVAL_MS)
    return () => {
      unsub()
      window.clearInterval(id)
    }
  }, [qc])

  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveSync />
      <BoardPage />
      <Toaster richColors theme="dark" position="top-center" />
    </QueryClientProvider>
  )
}
