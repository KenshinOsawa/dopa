/** ヘッダー・設定画面向けの連携状態と「同期」ボタン。 */
import type { GcalStatus } from "@/types"
import { authState } from "./auth"
import { syncAll, syncState } from "./sync"

export function gcalStatus(message: string | null = null): GcalStatus {
  const state = authState()
  const loggedIn = state === "connected"
  return {
    configured: state !== "unconfigured",
    needs_reconnect: state === "expired",
    logged_in: loggedIn,
    last_sync_at: syncState.last_sync_at,
    last_error: syncState.last_error,
    message:
      message ??
      (state === "expired"
        ? "接続の期限が切れました（再接続してください）"
        : state === "disconnected"
          ? "Google カレンダーに未接続です"
          : null),
  }
}

export async function gcalSync(): Promise<GcalStatus> {
  const r = await syncAll()
  if (!r.logged_in) return gcalStatus()
  return gcalStatus(`同期しました（取込 ${r.created} / 更新 ${r.updated} / 削除 ${r.removed}）`)
}
