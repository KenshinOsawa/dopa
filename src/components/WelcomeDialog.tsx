import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleDot, ShieldCheck, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import * as local from "@/local"
import { WELCOME_KEY } from "@/lib/queryKeys"
import { WELCOME_LINES } from "@/local/welcome"

const ICONS = [CircleDot, Timer, CheckCircle2]

/** 最初に開いたとき（データが空の新しいブラウザ）だけ出す。 */
export function WelcomeGate() {
  const qc = useQueryClient()
  const { data: welcomed } = useQuery({ queryKey: WELCOME_KEY, queryFn: () => local.isWelcomed() })
  const [busy, setBusy] = useState(false)
  if (welcomed !== false) return null

  async function start(withSamples: boolean) {
    setBusy(true)
    try {
      await local.finishWelcome(withSamples)
    } finally {
      setBusy(false)
      void qc.invalidateQueries()
    }
  }

  return (
    <Dialog open onClose={() => void start(false)} className="max-w-md" labelledBy="welcome-title" dismissable={false} hideClose>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-fuchsia-500 via-violet-500 to-cyan-400 text-lg font-black text-white shadow-[0_0_20px_-2px_rgb(217_70_239/0.8)]">
            D
          </div>
          <div>
            <h2 id="welcome-title" className="text-lg font-black text-zinc-50">
              dopa へようこそ
            </h2>
            <p className="text-xs text-zinc-400">やることを片付けるたびに、ちょっと気持ちいいカンバン</p>
          </div>
        </div>
        <ol className="flex flex-col gap-2.5">
          {WELCOME_LINES.map((line, i) => {
            const Icon = ICONS[i]
            return (
              <li key={line} className="flex items-start gap-2.5 text-sm text-zinc-200">
                <Icon className="mt-0.5 size-4 shrink-0 text-fuchsia-300" />
                {line}
              </li>
            )
          })}
        </ol>
        <p className="flex items-start gap-2 rounded-lg bg-white/5 p-2.5 text-xs leading-relaxed text-zinc-400">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-300" />
          データはこのブラウザの中だけに保存されます（どこにも送信しません）。設定から書き出し・読み込みができます。
        </p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button onClick={() => void start(true)} disabled={busy} autoFocus>
            サンプルを 3 枚入れて始める
          </Button>
          <Button variant="outline" onClick={() => void start(false)} disabled={busy}>
            空で始める
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
