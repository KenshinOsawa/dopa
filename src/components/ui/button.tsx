import * as React from "react"
import { cn } from "@/lib/utils"

type Variant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link"
type Size = "default" | "sm" | "xs" | "lg" | "icon"

const VARIANTS: Record<Variant, string> = {
  default:
    "bg-linear-to-r from-fuchsia-500 to-violet-500 text-white shadow-[0_0_18px_-4px_rgb(217_70_239/0.75)] hover:brightness-110 hover:shadow-[0_0_24px_-2px_rgb(217_70_239/0.9)] break:from-[#fbcfe8] break:to-[#bae6fd] break:text-[#0f172a] break:shadow-[0_4px_14px_-6px_rgb(56_189_248/0.6)] break:hover:brightness-105",
  outline:
    "border border-white/15 bg-white/5 text-zinc-200 hover:border-white/25 hover:bg-white/10",
  secondary: "bg-white/10 text-zinc-50 hover:bg-white/15",
  ghost: "text-zinc-300 hover:bg-white/10 hover:text-white",
  destructive:
    "bg-linear-to-r from-rose-500 to-red-500 text-white shadow-[0_0_16px_-4px_rgb(244_63_94/0.8)] hover:brightness-110",
  link: "text-cyan-300 underline-offset-4 hover:underline",
}

const SIZES: Record<Size, string> = {
  default: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-sm",
  xs: "h-7 px-2.5 text-xs",
  lg: "h-10 px-5 text-sm",
  icon: "h-9 w-9",
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,filter,scale] duration-150 ease-out outline-none hover:scale-[1.04] active:scale-[0.94] motion-reduce:hover:scale-100 motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-fuchsia-400/70 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = "Button"
