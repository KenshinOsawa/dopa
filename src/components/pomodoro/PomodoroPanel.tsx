import { useState, useSyncExternalStore } from "react"
import { Bell, BellOff, ChevronDown, Coffee, Pause, Timer, Play, RotateCcw, Settings2, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useGcalAuth } from "@/hooks/useGcalAuth"
import { formatClock, type PomodoroView } from "@/hooks/usePomodoro"
import { ProgressRing } from "./ProgressRing"
import { setTimerSoundEnabled, subscribeTimerSound, timerSoundEnabled } from "@/lib/timerChime"
import { cn } from "@/lib/utils"
import type { PomodoroSettings, Task } from "@/types"

interface PomodoroPanelProps {
  pomo: PomodoroView
  /** 「やってる」列のカード（紐付け候補） */
  doingTasks: Task[]
  /** モバイルのフローティング表示で「たたむ」ボタンを出す */
  onCollapse?: () => void
}

const PHASE_LABEL = { focus: "集中", break: "休憩" } as const
const STATUS_LABEL = { idle: "待機中", running: "計測中", paused: "一時停止中" } as const

export function PomodoroPanel({ pomo, doingTasks, onCollapse }: PomodoroPanelProps) {
  const { data, remaining, act, pending } = pomo
  const [showSettings, setShowSettings] = useState(false)
  const timerSound = useSyncExternalStore(subscribeTimerSound, timerSoundEnabled)

  if (!data) {
    return <div className="p-4 text-sm text-zinc-500">タイマーを読み込み中...</div>
  }

  const focus = data.phase === "focus"
  // 紐付け中のカードが「やってる」から外れていても選択肢に残す
  const options = doingTasks.some((t) => t.id === data.task_id)
    ? doingTasks
    : data.task_id != null
      ? [{ id: data.task_id, title: data.task_title ?? `#${data.task_id}` }, ...doingTasks]
      : doingTasks

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-200">ポモドーロ</h2>
        <span
          className="text-sm tabular-nums"
          title={`今日完了した集中: ${data.today_count} 回`}
          aria-label={`今日完了した集中 ${data.today_count} 回`}
        >
          <Timer className="inline size-4 align-[-3px] text-pink-400" /> {data.today_count} 回
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setTimerSoundEnabled(!timerSound)}
            aria-pressed={timerSound}
            aria-label="タイマー音"
            title={timerSound ? "タイマー音: オン（集中・休憩の切り替えで鳴らす）" : "タイマー音: オフ"}
          >
            {timerSound ? <Bell /> : <BellOff />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
            aria-label="タイマー設定"
            title="タイマー設定"
          >
            <Settings2 />
          </Button>
          {onCollapse && (
            <Button variant="ghost" size="icon" className="size-7" onClick={onCollapse} aria-label="たたむ">
              <ChevronDown />
            </Button>
          )}
        </div>
      </div>

      {showSettings && (
        <SettingsForm
          key={JSON.stringify(data.settings)}
          initial={data.settings}
          onSave={async (s) => {
            await pomo.saveSettings(s)
            setShowSettings(false)
          }}
        />
      )}

      {!focus && (
        <div
          role="status"
          className="kb-phase-in flex items-center justify-center gap-2.5 rounded-xl border border-[#bae6fd] bg-linear-to-r from-[#e0f2fe] via-[#ffffff] to-[#ffedd5] px-3 py-2.5 text-[#0c4a6e] shadow-[0_6px_20px_-10px_rgb(56_189_248/0.6)]"
        >
          <Coffee className="size-7 shrink-0" />
          <div className="text-left leading-tight">
            <div className="text-3xl font-black tracking-wide">休憩中</div>
            <div className="text-xs font-semibold text-[#075985]">肩の力を抜いて、ひと息つこう</div>
          </div>
        </div>
      )}

      <div
        className={cn(
          "flex justify-center rounded-xl border p-4",
          focus
            ? "border-pink-400/35 bg-linear-to-br from-pink-500/15 to-orange-400/10 shadow-[0_0_30px_-10px_rgb(255_62_165/0.8)]"
            : "border-[#bae6fd] bg-linear-to-br from-[#f0f9ff] to-[#fff7ed] shadow-[0_8px_30px_-14px_rgb(56_189_248/0.55)]",
        )}
      >
        <ProgressRing
          size={208}
          stroke={12}
          durationSec={data.duration_sec}
          remainingSec={remaining}
          endsAt={pomo.endsAt}
        >
          <div className={cn("text-xs font-semibold", focus ? "text-pink-300" : "text-[#0369a1]")}>
            {focus ? <Timer className="inline size-3.5 align-[-2px]" /> : <Coffee className="inline size-3.5 align-[-2px]" />}{" "}
            {PHASE_LABEL[data.phase]}
          </div>
          <div
            className={cn(
              "my-0.5 bg-clip-text text-5xl font-black tracking-tight text-transparent tabular-nums",
              focus
                ? "bg-linear-to-r from-pink-300 to-orange-200 drop-shadow-[0_0_12px_rgb(255_62_165/0.55)]"
                : "bg-linear-to-r from-[#0c4a6e] to-[#0e7490]",
            )}
            role="timer"
            aria-live="off"
          >
            {formatClock(remaining)}
          </div>
          <div className={cn("text-xs font-medium", focus ? "text-zinc-400" : "text-[#075985]")}>
            {data.status === "paused" && <Pause className="mr-0.5 inline size-3 align-[-1px]" />}
            {STATUS_LABEL[data.status]}
          </div>
        </ProgressRing>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {data.status === "running" ? (
          <Button onClick={() => act({ type: "pause" })} disabled={pending}>
            <Pause />
            一時停止
          </Button>
        ) : (
          <Button onClick={() => act({ type: "start" })} disabled={pending}>
            <Play />
            {data.status === "paused" ? "再開" : "開始"}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={() => act({ type: "reset" })}
          disabled={pending || (data.status === "idle" && focus)}
          title="リセット（集中の最初に戻す）"
          aria-label="リセット"
        >
          <RotateCcw />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => act({ type: "skip" })}
          disabled={pending}
          title={focus ? "スキップ（休憩へ）" : "スキップ（集中へ）"}
          aria-label="スキップ"
        >
          <SkipForward />
        </Button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">集中するカード（やってる）</span>
        <select
          value={data.task_id ?? ""}
          onChange={(e) =>
            act({ type: "task", taskId: e.target.value === "" ? null : Number(e.target.value) })
          }
          disabled={pending}
          className="h-9 w-full rounded-lg border border-white/15 bg-white/5 px-2 text-sm text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/40"
        >
          <option value="">（カードなし）</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {doingTasks.length === 0 && (
          <span className="text-xs text-zinc-500">「やってる」列のカードから選べます</span>
        )}
      </label>
    </div>
  )
}

function SettingsForm({
  initial,
  onSave,
}: {
  initial: PomodoroSettings
  onSave: (s: PomodoroSettings) => Promise<void>
}) {
  const [focus, setFocus] = useState(String(initial.focus_minutes))
  const [brk, setBrk] = useState(String(initial.break_minutes))
  const [gcalOn, setGcalOn] = useState(initial.gcal_enabled)
  const [autoOn, setAutoOn] = useState(initial.auto_cycle)
  const [saving, setSaving] = useState(false)
  const { state: gcalState } = useGcalAuth()

  const f = Number(focus)
  const b = Number(brk)
  const valid = Number.isInteger(f) && f >= 1 && f <= 180 && Number.isInteger(b) && b >= 1 && b <= 60

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        setSaving(true)
        try {
          await onSave({ focus_minutes: f, break_minutes: b, gcal_enabled: gcalOn, auto_cycle: autoOn })
        } catch {
          /* トースト済み */
        } finally {
          setSaving(false)
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">集中（分）</span>
          <Input type="number" min={1} max={180} inputMode="numeric" value={focus} onChange={(e) => setFocus(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">休憩（分）</span>
          <Input type="number" min={1} max={60} inputMode="numeric" value={brk} onChange={(e) => setBrk(e.target.value)} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-pink-500"
          checked={autoOn}
          onChange={(e) => setAutoOn(e.target.checked)}
        />
        <span>
          自動で回す
          <span className="block text-xs text-zinc-500">
            集中 → 休憩 → 集中 … を止めるまで続けます（止めるのはリセットか一時停止）。オフなら休憩明けは「開始」待ち
          </span>
        </span>
      </label>
      {gcalState !== "unconfigured" && (
        <label className="flex items-start gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-pink-500"
            checked={gcalOn}
            onChange={(e) => setGcalOn(e.target.checked)}
          />
          <span>
            集中した時間を Google カレンダーに記録
            <span className="block text-xs text-zinc-500">
              「集中｜カード名」で書きます（休憩は書きません）
              {gcalOn && gcalState !== "connected" && "。未接続のあいだは記録されません"}
            </span>
          </span>
        </label>
      )}
      <p className="text-xs text-zinc-500">計測中・一時停止中のフェーズの長さは変わりません（次から反映）</p>
      <Button type="submit" size="sm" disabled={!valid || saving}>
        保存
      </Button>
    </form>
  )
}
