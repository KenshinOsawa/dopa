/** 最初に開いたときのウェルカム（使い方 3 行 ＋ サンプルカード 3 枚）。 */
import { broadcast } from "./bus"
import { getSetting, setSettings } from "./settings"
import { upsertMany } from "./tasks"

export const WELCOME_LINES = [
  "カードをドラッグして「未着手 → やってる → やった」へ。やったで XP とお祝いが出ます",
  "右のポモドーロで集中 25 分 → 休憩 3 分。集中を終えるたびに XP",
  "「今日やったこと」で、その日の完了をまとめてコピーできます",
] as const

export const SAMPLE_CARDS = [
  { title: "このカードを「やってる」へドラッグしてみる", note: "クリックで編集、右クリックでメニュー" },
  { title: "終わったら「やった」へ入れてお祝いを見る", note: "続けて片付けるとコンボ、5 連続で FEVER" },
  { title: "ポモドーロで 25 分だけ集中する", note: "「やってる」のカードを選んでから開始" },
] as const

export async function isWelcomed(): Promise<boolean> {
  return Boolean(await getSetting("app.welcomed"))
}

export async function finishWelcome(withSamples: boolean): Promise<void> {
  if (withSamples) await upsertMany(SAMPLE_CARDS.map((c) => ({ ...c })))
  await setSettings({ "app.welcomed": true })
  broadcast("all")
}
