import { useEffect, useId, useRef, type ReactNode } from "react"
import { ringDashOffset, ringProgress } from "@/lib/ring"
import { cn } from "@/lib/utils"

interface ProgressRingProps {
  /** 直径（px） */
  size: number
  /** 線の太さ（px） */
  stroke: number
  durationSec: number
  /** 止まっているときの残り秒（計測中は endsAt から毎フレーム計算） */
  remainingSec: number
  /** 計測中: このフェーズが終わるブラウザ時計の時刻（ms）。null なら止まっている */
  endsAt: number | null
  /** グロー（drop-shadow）。小さいリングでは切る */
  glow?: boolean
  className?: string
  children?: ReactNode
}

/**
 * 経過で埋まっていく円形の進み（12 時から時計回り）。SVG の stroke-dasharray / dashoffset。
 * 計測中は requestAnimationFrame で毎フレーム補間（1 秒ごとにカクつかない。React の再描画は通さない）、
 * 一時停止・待機中は止まる。色は CSS 変数（--kb-ring-a/b/glow/track）なので、フェーズ切り替えの
 * フェード（styles/phase.css）と一緒に滑らかに変わる。
 */
export function ProgressRing({
  size,
  stroke,
  durationSec,
  remainingSec,
  endsAt,
  glow = true,
  className,
  children,
}: ProgressRingProps) {
  const r = (size - stroke) / 2 - (glow ? 4 : 0)
  const circumference = 2 * Math.PI * r
  const arc = useRef<SVGCircleElement>(null)
  const gradId = `kb-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  // 計測中は毎秒変わる remainingSec を依存に入れない（rAF が自前で計算する）
  const stoppedRemaining = endsAt == null ? remainingSec : null

  useEffect(() => {
    const el = arc.current
    if (!el) return
    const draw = (remaining: number) => {
      const p = ringProgress(durationSec, remaining)
      el.style.strokeDashoffset = String(ringDashOffset(circumference, p))
      // 0 のときは丸い線端の点も見せない
      el.style.opacity = p <= 0.001 ? "0" : "1"
    }
    if (endsAt == null) {
      draw(stoppedRemaining ?? durationSec)
      return
    }
    let raf = 0
    const loop = () => {
      draw(Math.max(0, (endsAt - Date.now()) / 1000))
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [endsAt, durationSec, stoppedRemaining, circumference])

  const c = size / 2
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--kb-ring-a)" }} />
            <stop offset="100%" style={{ stopColor: "var(--kb-ring-b)" }} />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} style={{ stroke: "var(--kb-ring-track)" }} />
        <circle
          ref={arc}
          data-ring-arc=""
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
          style={glow ? { filter: "drop-shadow(0 0 5px var(--kb-ring-glow))" } : undefined}
        />
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>}
    </div>
  )
}
