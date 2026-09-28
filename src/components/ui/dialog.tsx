import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  /** disable close on backdrop click / Esc */
  dismissable?: boolean
  /** hide the top-right close (×) button entirely */
  hideClose?: boolean
  labelledBy?: string
}

/**
 * Minimal accessible modal dialog. Renders an overlay + centered panel.
 * Closes on Esc and backdrop click (unless dismissable=false).
 */
export function Dialog({
  open,
  onClose,
  children,
  className,
  dismissable = true,
  hideClose = false,
  labelledBy,
}: DialogProps) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose()
    }
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open, onClose, dismissable])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "relative my-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-(--kb-panel-2) text-zinc-100 shadow-[0_0_60px_-12px_rgb(168_85_247/0.55)]",
          className,
        )}
      >
        {!hideClose && (
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="absolute top-4 right-4 z-10 inline-flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
