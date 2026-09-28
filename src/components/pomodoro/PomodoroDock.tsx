import { useState, type ReactNode } from "react"
import { Coffee, Pause, Timer } from "lucide-react"
import { PomodoroPanel } from "./PomodoroPanel"
import { ProgressRing } from "./ProgressRing"
import { formatClock, type PomodoroView } from "@/hooks/usePomodoro"
import { cn } from "@/lib/utils"
import type { Task } from "@/types"

const OPEN_KEY = "dopa:pomodoro-open"

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1"
  } catch {
    return false
  }
}

interface DockProps {
  pomo: PomodoroView
  doingTasks: Task[]
}

/** PC 幅: 画面右の固定サイドバー。ポモドーロの下に children（カレンダー）を並べる。 */
export function PomodoroSidebar({ pomo, doingTasks, children }: DockProps & { children?: ReactNode }) {
  return (
    <aside
      aria-label="ポモドーロタイマーとカレンダー"
      className="hidden w-[380px] shrink-0 flex-col xl:w-[420px] overflow-y-auto border-l border-white/10 bg-(--kb-sidebar) lg:flex"
    >
      <div className="shrink-0">
        <PomodoroPanel pomo={pomo} doingTasks={doingTasks} />
      </div>
      {children}
    </aside>
  )
}

/** スマホ・狭い幅: 右下の折りたたみフローティング（ボードの横スクロールを邪魔しない）。 */
export function PomodoroFloating({ pomo, doingTasks }: DockProps) {
  const [open, setOpenState] = useState(loadOpen)
  const { data, remaining } = pomo

  function setOpen(v: boolean) {
    setOpenState(v)
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0")
    } catch {
      /* noop */
    }
  }

  const focus = data?.phase !== "break"
  const active = data != null && data.status !== "idle"

  return (
    <div className="lg:hidden">
      {open ? (
        <div
          role="dialog"
          aria-label="ポモドーロタイマー"
          className="fixed inset-x-3 bottom-3 z-40 mx-auto max-h-[80dvh] max-w-sm overflow-y-auto rounded-2xl border border-white/10 bg-(--kb-panel) shadow-[0_0_40px_-10px_rgb(168_85_247/0.6)]"
        >
          <PomodoroPanel pomo={pomo} doingTasks={doingTasks} onCollapse={() => setOpen(false)} />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="ポモドーロタイマーを開く"
          className={cn(
            "fixed right-3 bottom-3 z-40 flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold shadow-lg tabular-nums",
            active && focus && "border-pink-400/50 bg-[#1f0c24] text-pink-200 shadow-[0_0_18px_-4px_rgb(255_62_165/0.8)]",
            active && !focus && "border-[#7dd3fc] bg-[#effaff] text-[#0c4a6e] shadow-[0_0_18px_-4px_rgb(56_189_248/0.6)]",
            !active && "border-white/15 bg-(--kb-panel) text-zinc-200",
          )}
        >
          <ProgressRing
            size={28}
            stroke={3}
            glow={false}
            durationSec={data?.duration_sec ?? 0}
            remainingSec={active ? remaining : (data?.duration_sec ?? 0)}
            endsAt={active ? pomo.endsAt : null}
            className="-ml-1"
          >
            {focus ? <Timer className="size-3.5" /> : <Coffee className="size-3.5" />}
          </ProgressRing>
          {active ? (
            <span>
              {data.status === "paused" && <Pause className="mr-0.5 inline size-3.5 align-[-2px]" />}
              {formatClock(remaining)}
            </span>
          ) : (
            <span>{data?.today_count ?? 0} 回</span>
          )}
        </button>
      )}
    </div>
  )
}
