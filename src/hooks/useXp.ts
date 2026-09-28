import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import * as local from "@/local"
import { headerXp, levelUp, takeExternal } from "@/lib/celebrate"
import { XP_KEY } from "@/lib/queryKeys"
import type { XpStats } from "@/types"

/**
 * XP・レベル・連続日数（台帳から計算した値）。ヘッダーで 1 回だけ呼ぶ。
 * - ボードの操作で入った XP はその場（カード位置）で演出済み。それ以外で増えた分
 *   （ポモドーロの集中完了・他タブ）はヘッダーのゲージ付近に +XP を出す
 * - レベルが上がったら全画面の演出（初回読み込みでは出さない）
 */
export function useXp() {
  const query = useQuery({
    queryKey: XP_KEY,
    queryFn: (): Promise<XpStats> => local.getXpStats(),
    // コンボの残り時間・日付の切り替わりのため
    refetchInterval: 30_000,
  })
  const data = query.data
  const seen = useRef<{ total: number; level: number } | null>(null)

  useEffect(() => {
    if (!data) return
    const prev = seen.current
    seen.current = { total: data.total_xp, level: data.level }
    if (!prev) return
    const delta = data.total_xp - prev.total
    if (delta > 0) {
      const external = takeExternal(delta)
      if (external > 0) headerXp(external)
    }
    if (data.level > prev.level) levelUp(data.level)
  }, [data])

  return query
}
