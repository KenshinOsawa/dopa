import * as React from "react"
import { cn } from "@/lib/utils"

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-lg border border-white/15 bg-white/5 text-zinc-50 px-3 py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-zinc-500 focus-visible:border-fuchsia-400/70 focus-visible:ring-2 focus-visible:ring-fuchsia-500/30 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
))
Input.displayName = "Input"
