import { useCallback, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { authState, connect, disconnect, subscribeAuth, type GcalAuthState } from "@/local/gcal/auth"

/**
 * Google カレンダーの接続状態（unconfigured / disconnected / connected / expired）と接続・切断。
 * connect はクリックの中から呼ぶ（GIS のポップアップはユーザー操作の中でしか開けない）。
 */
export function useGcalAuth(): {
  state: GcalAuthState
  connecting: boolean
  connect: () => void
  disconnect: () => void
} {
  const state = useSyncExternalStore(subscribeAuth, authState)
  const [connecting, setConnecting] = useState(false)
  const doConnect = useCallback(() => {
    setConnecting(true)
    connect()
      .then(() => toast.success("Google カレンダーに接続しました"))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "接続できませんでした"))
      .finally(() => setConnecting(false))
  }, [])
  const doDisconnect = useCallback(() => {
    disconnect()
    toast.success("Google カレンダーとの接続を切りました（カードは残ります）")
  }, [])
  return { state, connecting, connect: doConnect, disconnect: doDisconnect }
}
