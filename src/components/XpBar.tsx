import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Flame, Snowflake, Vibrate, VibrateOff, Volume2, VolumeX, Zap } from "lucide-react"
import { useXp } from "@/hooks/useXp"
import { hapticsEnabled, play as haptic, setHapticsEnabled, subscribeHaptics } from "@/lib/haptics"
import { setSoundEnabled, soundEnabled, subscribeSound } from "@/lib/sound"
import { cn } from "@/lib/utils"
import type { XpStats } from "@/types"

/** ヘッダーの XP ゲージ（今日の XP / 目標）・レベル・連続日数・コンボ・効果音トグル・振動トグル */
export function XpBar() {
  const { data } = useXp()
  const sound = useSyncExternalStore(subscribeSound, soundEnabled)
  const haptics = useSyncExternalStore(subscribeHaptics, hapticsEnabled)

  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      {data && (
        <>
          <Level stats={data} />
          <TodayGauge stats={data} />
          <Streak stats={data} />
          <Combo stats={data} />
        </>
      )}
      <button
        type="button"
        onClick={() => setSoundEnabled(!sound)}
        aria-pressed={sound}
        aria-label={sound ? "効果音をオフ" : "効果音をオン"}
        title={sound ? "効果音: オン" : "効果音: オフ"}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-[color,background-color,scale] duration-150 hover:scale-110 hover:bg-white/10 hover:text-white active:scale-90 motion-reduce:hover:scale-100"
      >
        {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
      </button>
      <button
        type="button"
        onClick={() => {
          setHapticsEnabled(!haptics)
          // オンにしたら確認の「ぶぶぶ」
          if (!haptics) haptic("buzz")
        }}
        aria-pressed={haptics}
        aria-label={haptics ? "振動をオフ" : "振動をオン"}
        title={haptics ? "振動（重低音）: オン" : "振動（重低音）: オフ"}
        className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-[color,background-color,scale] duration-150 hover:scale-110 hover:bg-white/10 hover:text-white active:scale-90 motion-reduce:hover:scale-100 sm:-ml-2"
      >
        {haptics ? <Vibrate className="size-4" /> : <VibrateOff className="size-4" />}
      </button>
    </div>
  )
}

function Level({ stats }: { stats: XpStats }) {
  const span = stats.next_level_at - stats.level_start
  const into = stats.total_xp - stats.level_start
  const pct = span > 0 ? Math.min(100, (into / span) * 100) : 0
  return (
    <div
      className="relative flex h-8 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-linear-to-br from-violet-600 via-fuchsia-600 to-pink-500 px-2 shadow-[0_0_16px_-3px_rgb(217_70_239/0.85)]"
      title={`レベル ${stats.level}（累計 ${stats.total_xp} XP）\n次のレベルまで ${stats.next_level_at - stats.total_xp} XP`}
    >
      <span className="text-[13px] leading-none font-black text-white italic tabular-nums">
        <span className="text-[9px] not-italic opacity-80">LV</span>
        {stats.level}
      </span>
      <span className="absolute inset-x-1 bottom-1 h-[3px] overflow-hidden rounded-full bg-black/30">
        <span
          className="block h-full rounded-full bg-linear-to-r from-lime-300 to-cyan-300"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  )
}

function TodayGauge({ stats }: { stats: XpStats }) {
  const pct = Math.min(100, (stats.today_xp / stats.daily_goal) * 100)
  const over = stats.today_xp >= stats.daily_goal
  // 増えたらゲージを一瞬光らせる
  const barRef = useRef<HTMLSpanElement>(null)
  const prev = useRef(stats.today_xp)
  useEffect(() => {
    if (stats.today_xp > prev.current && barRef.current) {
      const el = barRef.current
      el.classList.remove("kb-gauge-flash")
      void el.offsetWidth
      el.classList.add("kb-gauge-flash")
    }
    prev.current = stats.today_xp
  }, [stats.today_xp])

  return (
    <div
      data-xp-gauge
      className="flex min-w-0 flex-col gap-1"
      title={`今日 ${stats.today_xp} XP（目標 ${stats.daily_goal} XP）\nやってる +5 / やった +20（10 分以内の連続でコンボ）/ 集中完了 +15`}
    >
      <div className="flex items-baseline gap-1 text-[11px] leading-none font-bold">
        <Zap className="size-3 self-center text-lime-300" />
        <span className="hidden text-zinc-400 sm:inline">今日</span>
        <span className="text-white tabular-nums">{stats.today_xp}</span>
        <span className="text-zinc-500 tabular-nums">/ {stats.daily_goal} XP</span>
      </div>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10 sm:w-36">
        <span
          ref={barRef}
          className={cn(
            "block h-full rounded-full bg-linear-to-r from-lime-300 via-cyan-300 to-violet-400 transition-[width] duration-700 ease-out",
            over
              ? "shadow-[0_0_12px_rgb(163_255_60/0.9)]"
              : "shadow-[0_0_8px_rgb(34_228_255/0.7)]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Streak({ stats }: { stats: XpStats }) {
  const days = stats.streak_days
  const lit = days > 0 && stats.streak_today
  const frozen = stats.frozen_dates.length > 0
  const lines = [
    days > 0 ? `${days} 日連続で XP をゲット中` : "今日なにか 1 つ動かすと連続記録スタート",
    days > 0 && !stats.streak_today && "今日はまだ。1 つ動かすと記録が伸びる",
    frozen && `凍結で守った日: ${stats.frozen_dates.map((d) => d.slice(5).replace("-", "/")).join(", ")}`,
    stats.freeze_ready ? "1 日休んでも凍結で守れます（7 日に 1 回）" : "凍結は使用済み（7 日たつと復活）",
  ].filter(Boolean)
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-black tabular-nums",
        lit ? "text-orange-200" : "text-zinc-400",
      )}
      title={lines.join("\n")}
      aria-label={`${days} 日連続`}
    >
      <Flame
        className={cn(
          "size-4",
          lit
            ? "fill-orange-500/60 text-orange-400 drop-shadow-[0_0_6px_rgb(255_138_31/0.9)]"
            : days > 0
              ? "text-orange-400/60"
              : "text-zinc-500",
        )}
      />
      <span>{days}</span>
      <span className="hidden font-bold sm:inline">日連続</span>
      {frozen && <Snowflake className="ml-0.5 size-3.5 text-cyan-300 drop-shadow-[0_0_4px_rgb(34_228_255/0.9)]" />}
    </div>
  )
}

/** 10 分以内の連続完了中だけ出る（残り時間つき） */
function Combo({ stats }: { stats: XpStats }) {
  const until = stats.combo >= 2 && stats.combo_until ? Date.parse(stats.combo_until) : null
  // 時刻はこのブラウザの時計で計算しているので時計差は無い
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [until])
  if (until == null) return null
  const left = Math.min(600, Math.ceil((until - now) / 1000))
  if (left <= 0) return null
  return (
    <div
      className="hidden shrink-0 items-center gap-1 rounded-lg bg-linear-to-r from-pink-500 to-orange-400 px-2 py-1 text-xs font-black text-white italic shadow-[0_0_14px_-2px_rgb(255_62_165/0.9)] sm:flex"
      title="あと少しで次を「やった」にするとコンボが伸びる"
    >
      {stats.combo} COMBO
      <span className="font-bold not-italic opacity-85 tabular-nums">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </span>
    </div>
  )
}
