import { useState } from "react"
import { CalendarDays } from "lucide-react"
import { DayCalendar } from "./DayCalendar"
import type { Task } from "@/types"

const OPEN_KEY = "dopa:calendar-open"

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1"
  } catch {
    return false
  }
}

interface Props {
  tasks: Task[]
  onOpenTask: (task: Task) => void
}

/** スマホ・狭い幅: ポモドーロの上に折りたたみのカレンダー（ボードの横スクロールを邪魔しない）。 */
export function CalendarFloating({ tasks, onOpenTask }: Props) {
  const [open, setOpenState] = useState(loadOpen)

  function setOpen(v: boolean) {
    setOpenState(v)
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0")
    } catch {
      /* noop */
    }
  }

  return (
    <div className="lg:hidden">
      {open ? (
        <div
          role="dialog"
          aria-label="カレンダー"
          className="fixed inset-x-3 bottom-3 z-40 mx-auto flex h-[75dvh] max-w-sm flex-col overflow-hidden rounded-2xl border border-white/10 bg-(--kb-panel) shadow-[0_0_40px_-10px_rgb(168_85_247/0.6)]"
        >
          <DayCalendar tasks={tasks} onOpenTask={onOpenTask} className="flex-1" onCollapse={() => setOpen(false)} />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="カレンダーを開く"
          className="fixed right-3 bottom-16 z-40 flex size-10 items-center justify-center rounded-full border border-white/15 bg-(--kb-panel) text-cyan-200 shadow-[0_0_16px_-4px_rgb(34_228_255/0.7)]"
        >
          <CalendarDays className="size-4" />
        </button>
      )}
    </div>
  )
}
