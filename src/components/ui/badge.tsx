import * as React from "react"
import { cn } from "@/lib/utils"

type Tone = "gray" | "red" | "amber" | "green" | "blue" | "violet"

const TONES: Record<Tone, string> = {
  gray: "bg-white/8 text-zinc-300 ring-1 ring-white/10",
  red: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/40",
  amber: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/30",
  green: "bg-lime-400/15 text-lime-200 ring-1 ring-lime-300/30",
  blue: "bg-sky-400/15 text-sky-200 ring-1 ring-sky-300/30",
  violet: "bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/30",
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ className, tone = "gray", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}
