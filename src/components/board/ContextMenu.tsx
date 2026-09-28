import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { cn } from "@/lib/utils"

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** 右クリックの小さなメニュー。Esc・外側クリック・スクロール・リサイズで閉じる。 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // 画面外にはみ出さないよう位置を補正
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - height - 8))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.querySelector<HTMLButtonElement>("button")?.focus()
  }, [x, y])

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    const close = () => onClose()
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", close)
    window.addEventListener("blur", close)
    document.addEventListener("scroll", close, true)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", close)
      window.removeEventListener("blur", close)
      document.removeEventListener("scroll", close, true)
    }
  }, [onClose])

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-44 rounded-lg border border-white/10 bg-(--kb-panel-2) p-1 shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className={cn(
            "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm outline-none",
            item.danger
              ? "text-red-400 hover:bg-red-500/15 focus-visible:bg-red-500/15"
              : "text-zinc-200 hover:bg-white/10 focus-visible:bg-white/10",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
