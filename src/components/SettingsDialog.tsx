import { useRef, useState, type FormEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarCheck, CalendarOff, Download, RefreshCw, Settings, ShieldCheck, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useGcalAuth } from "@/hooks/useGcalAuth"
import type { PomodoroView } from "@/hooks/usePomodoro"
import * as local from "@/local"
import type { Backup } from "@/local/backup"
import { clientId, hasBuiltInClientId, setManualClientId } from "@/local/gcal/auth"
import { errorMessage } from "@/lib/errors"
import { REPORT_KEY } from "@/lib/queryKeys"
import type { PomodoroSettings } from "@/types"

const SETTINGS_KEY = ["settings", "report-hour"] as const

/** 設定: ポモドーロ・日報の境界・Google カレンダー・データ（エクスポート/インポート/全削除）。 */
export function SettingsDialog({ pomo, onClose }: { pomo: PomodoroView; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} className="max-w-lg" labelledBy="settings-dialog-title">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="settings-dialog-title" className="flex items-center gap-2 pr-8 text-base font-semibold text-zinc-50">
          <Settings className="size-4 text-fuchsia-300" />
          設定
        </h2>
        <Section title="ポモドーロ">
          {pomo.data ? (
            <PomodoroForm key={JSON.stringify(pomo.data.settings)} initial={pomo.data.settings} onSave={pomo.saveSettings} />
          ) : (
            <p className="text-xs text-zinc-500">読み込み中...</p>
          )}
        </Section>
        <Section title="今日やったこと">
          <ReportHourForm />
        </Section>
        <Section title="Google カレンダー（任意）">
          <CalendarSettings />
        </Section>
        <Section title="データ">
          <DataSettings onWiped={onClose} />
        </Section>
      </div>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3.5">
      <h3 className="text-sm font-bold text-zinc-100">{title}</h3>
      {children}
    </section>
  )
}

function PomodoroForm({ initial, onSave }: { initial: PomodoroSettings; onSave: (s: PomodoroSettings) => Promise<unknown> }) {
  const [focus, setFocus] = useState(String(initial.focus_minutes))
  const [brk, setBrk] = useState(String(initial.break_minutes))
  const [autoOn, setAutoOn] = useState(initial.auto_cycle)
  const [gcalOn, setGcalOn] = useState(initial.gcal_enabled)
  const [saving, setSaving] = useState(false)
  const { state } = useGcalAuth()
  const f = Number(focus)
  const b = Number(brk)
  const valid = Number.isInteger(f) && f >= 1 && f <= 180 && Number.isInteger(b) && b >= 1 && b <= 60

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    try {
      await onSave({ focus_minutes: f, break_minutes: b, auto_cycle: autoOn, gcal_enabled: gcalOn })
    } catch {
      /* トースト済み */
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
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
        <input type="checkbox" className="mt-0.5 size-4 accent-pink-500" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} />
        <span>
          自動で回す
          <span className="block text-xs text-zinc-500">集中 → 休憩 → 集中 … を止めるまで続けます（オフなら休憩明けは「開始」待ち）</span>
        </span>
      </label>
      {state !== "unconfigured" && (
        <label className="flex items-start gap-2 text-sm text-zinc-200">
          <input type="checkbox" className="mt-0.5 size-4 accent-pink-500" checked={gcalOn} onChange={(e) => setGcalOn(e.target.checked)} />
          <span>
            集中した時間を Google カレンダーに記録
            <span className="block text-xs text-zinc-500">「集中｜カード名」で書きます（休憩は書きません）。接続中だけ</span>
          </span>
        </label>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!valid || saving}>
          保存
        </Button>
      </div>
    </form>
  )
}

function ReportHourForm() {
  const qc = useQueryClient()
  const { data: hour } = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => local.dayStartHour() })
  if (hour === undefined) return null
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-200">
      日の切り替わり
      <select
        aria-label="日の切り替わりの時刻"
        value={hour}
        onChange={async (e) => {
          await local.saveDayStartHour(Number(e.target.value))
          void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
          void qc.invalidateQueries({ queryKey: REPORT_KEY })
          toast.success("保存しました")
        }}
        className="h-8 rounded-md border border-white/15 bg-(--kb-panel-2) px-2 text-sm"
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            朝 {h} 時
          </option>
        ))}
      </select>
      <span className="text-xs text-zinc-500">これより前の完了は前日扱い</span>
    </label>
  )
}

function CalendarSettings() {
  const auth = useGcalAuth()
  const builtIn = hasBuiltInClientId()
  const [id, setId] = useState(() => (builtIn ? "" : clientId()))

  async function saveClientId(e: FormEvent) {
    e.preventDefault()
    const v = id.trim()
    if (v && !v.endsWith(".apps.googleusercontent.com")) {
      toast.error("クライアント ID は「….apps.googleusercontent.com」の形です")
      return
    }
    await local.setSettings({ "gcal.client_id": v })
    setManualClientId(v)
    toast.success(v ? "クライアント ID を保存しました" : "クライアント ID を消しました")
  }

  return (
    <div className="flex flex-col gap-3 text-sm text-zinc-300">
      {auth.state === "unconfigured" ? (
        <p className="text-xs leading-relaxed text-zinc-400">
          カレンダー連携は使わなくてもボードはすべて動きます。使うには Google の OAuth クライアント ID が必要です（配布した人に聞いてください）。
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2">
            {auth.state === "connected" ? (
              <CalendarCheck className="size-4 text-lime-300" />
            ) : (
              <CalendarOff className="size-4 text-zinc-500" />
            )}
            {auth.state === "connected" ? "接続中" : auth.state === "expired" ? "接続の期限切れ（再接続してください）" : "未接続"}
          </p>
          <div className="flex flex-wrap gap-2">
            {auth.state !== "connected" && (
              <Button size="sm" onClick={auth.connect} disabled={auth.connecting}>
                <RefreshCw />
                {auth.state === "expired" ? "再接続" : "接続する"}
              </Button>
            )}
            {auth.state !== "disconnected" && (
              <Button size="sm" variant="outline" onClick={auth.disconnect}>
                切断
              </Button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">
            ブラウザから直接 Google に接続します（間にサーバーはありません）。接続は安全のため約 1 時間で切れるので、そのときは「再接続」を押してください。
            時刻付きのカードは予定として書き出され、今日から 7 日分の予定（単発・時刻付き）はカードとして取り込まれます。
          </p>
        </>
      )}
      {!builtIn && (
        <form onSubmit={saveClientId} className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">OAuth クライアント ID</span>
          <div className="flex gap-2">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
              aria-label="OAuth クライアント ID"
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" size="sm" variant="outline" className="h-9">
              保存
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function DataSettings({ onWiped }: { onWiped: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<Backup | null>(null)
  const [wiping, setWiping] = useState(false)
  const [busy, setBusy] = useState(false)

  async function doExport() {
    try {
      const data = await local.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = local.backupFileName()
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success(`書き出しました（カード ${data.data.tasks.length} 枚）`)
    } catch (e) {
      toast.error(errorMessage(e, "書き出せませんでした"))
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      setPendingImport(local.parseBackup(await file.text()))
    } catch (e) {
      toast.error(errorMessage(e, "読み込めませんでした"))
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-400">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-300" />
        データはこのブラウザの中（IndexedDB）だけに保存され、どこにも送信されません。別の端末・ブラウザとは共有されないので、引っ越しやバックアップは書き出したファイルで。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void doExport()}>
          <Download />
          書き出す（JSON）
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload />
          読み込む
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="バックアップファイル"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button size="sm" variant="ghost" className="ml-auto text-red-400 hover:bg-red-500/15 hover:text-red-300" onClick={() => setWiping(true)}>
          <Trash2 />
          全部消す
        </Button>
      </div>
      {pendingImport && (
        <ConfirmDialog
          title="バックアップを読み込む"
          message={`今のデータを消して、${pendingImport.exported_at.slice(0, 16).replace("T", " ")} に書き出したデータ（カード ${
            (pendingImport.data.tasks ?? []).length
          } 枚）に置き換えます。よろしいですか？`}
          confirmLabel="置き換える"
          pending={busy}
          onConfirm={async () => {
            setBusy(true)
            try {
              const r = await local.importData(pendingImport)
              toast.success(`読み込みました（カード ${r.tasks} 枚）`)
              setPendingImport(null)
            } catch (e) {
              toast.error(errorMessage(e, "読み込めませんでした"))
            } finally {
              setBusy(false)
            }
          }}
          onClose={() => setPendingImport(null)}
        />
      )}
      {wiping && (
        <ConfirmDialog
          title="全部消す"
          message="カード・XP・ポモドーロの記録・設定をこのブラウザから消します。元に戻せません（先に書き出しておくと安心です）。"
          confirmLabel="全部消す"
          pending={busy}
          onConfirm={async () => {
            setBusy(true)
            try {
              await local.wipeAll()
              toast.success("全部消しました")
              setWiping(false)
              onWiped()
            } catch (e) {
              toast.error(errorMessage(e, "消せませんでした"))
            } finally {
              setBusy(false)
            }
          }}
          onClose={() => setWiping(false)}
        />
      )}
    </div>
  )
}
