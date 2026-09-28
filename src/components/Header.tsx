import { ClipboardList, Plus, RefreshCw, Search, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { XpBar } from "@/components/XpBar"
import { useGcalAuth } from "@/hooks/useGcalAuth"
import { useGcalStatus, useGcalSync } from "@/hooks/useTasks"
import { cn } from "@/lib/utils"
import type { DateFilter } from "@/types"

const FILTERS: { value: DateFilter; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "tomorrow", label: "明日" },
  { value: "all", label: "全部" },
]

interface HeaderProps {
  filter: DateFilter
  onFilter: (f: DateFilter) => void
  query: string
  onQuery: (q: string) => void
  onCreate: () => void
  /** 「今日やったこと」を開く */
  onReport: () => void
  /** 設定を開く */
  onSettings: () => void
}

export function Header({ filter, onFilter, query, onQuery, onCreate, onReport, onSettings }: HeaderProps) {
  const { data: gcal } = useGcalStatus()
  const sync = useGcalSync()
  const auth = useGcalAuth()
  const loggedIn = auth.state === "connected"
  const syncTitle = loggedIn
    ? `Google カレンダーと同期${gcal?.last_sync_at ? `（最終 ${gcal.last_sync_at.slice(11, 16)}）` : ""}${gcal?.last_error ? `\n直近のエラー: ${gcal.last_error}` : ""}`
    : auth.state === "expired"
      ? "Google カレンダーの接続が切れました（押すと再接続）"
      : "Google カレンダーに接続"

  return (
    <header className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-(--kb-header) px-4 py-2.5 shadow-[0_1px_0_rgb(255_62_165/0.15),0_8px_30px_-12px_rgb(168_85_247/0.45)] backdrop-blur-md sm:gap-3">
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-linear-to-br from-fuchsia-500 via-violet-500 to-cyan-400 text-sm font-black text-white shadow-[0_0_16px_-2px_rgb(217_70_239/0.8)]">
          D
        </div>
        <span className="hidden bg-linear-to-r from-white to-fuchsia-200 bg-clip-text text-base font-black tracking-tight text-transparent sm:inline">dopa</span>
      </div>

      <div role="group" aria-label="日付で絞り込み" className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onFilter(f.value)}
            aria-pressed={filter === f.value}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-bold transition-[color,background-color,box-shadow,scale] duration-150 active:scale-95",
              filter === f.value
                ? "bg-linear-to-r from-fuchsia-500 to-violet-500 text-white shadow-[0_0_14px_-3px_rgb(217_70_239/0.9)] break:from-[#fbcfe8] break:to-[#bae6fd] break:text-[#0f172a] break:shadow-[0_2px_10px_-4px_rgb(56_189_248/0.6)]"
                : "text-zinc-400 hover:bg-white/10 hover:text-white",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative hidden max-w-xs flex-1 md:block">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-500" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="検索..."
          aria-label="カードを検索"
          className="pl-8"
        />
      </div>

      <div className="ml-auto min-w-0">
        <XpBar />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onReport} title="今日やったことを書き出す" aria-label="今日やったこと">
          <ClipboardList />
          <span className="hidden lg:inline">今日やったこと</span>
        </Button>
        {auth.state !== "unconfigured" && (
          <Button
            variant="outline"
            onClick={() => (loggedIn ? sync.mutate() : auth.connect())}
            disabled={sync.isPending || auth.connecting}
            title={syncTitle}
            className={cn(!loggedIn && "text-zinc-400")}
          >
            <RefreshCw className={cn(sync.isPending && "animate-spin")} />
            <span className="hidden sm:inline">{loggedIn ? "同期" : auth.state === "expired" ? "再接続" : "接続"}</span>
          </Button>
        )}
        <Button variant="outline" size="icon" onClick={onSettings} title="設定" aria-label="設定">
          <Settings />
        </Button>
        <Button onClick={onCreate}>
          <Plus />
          <span className="hidden sm:inline">追加</span>
        </Button>
      </div>
    </header>
  )
}
