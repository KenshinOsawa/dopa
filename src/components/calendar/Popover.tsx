import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

interface PopoverProps {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  className?: string
  label: string
}

/** クリック位置に出す小さなパネル。Esc・外側クリックで閉じる。画面外にはみ出さないよう補正。 */
export function Popover({ x, y, onClose, children, className, label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(x - width - 12, window.innerWidth - width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(y - 16, window.innerHeight - height - 8))}px`
  }, [x, y])

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{ left: x, top: y }}
      className={cn("fixed z-50 w-72 rounded-xl border border-white/10 bg-(--kb-panel-2) p-3 shadow-xl", className)}
    >
      {children}
    </div>
  )
}
