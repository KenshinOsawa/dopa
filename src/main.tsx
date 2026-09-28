import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import "./styles/fx.css"
import App from "./App"
import { installAudioUnlock } from "./lib/audio"
import { installPressHaptics } from "./lib/haptics"
import { registerServiceWorker, requestPersistentStorage } from "./lib/pwa"
import { installGcalHooks } from "./local"
import { setManualClientId } from "./local/gcal/auth"
import { getSetting } from "./local/settings"

// 最初の操作で AudioContext を起こす（先に登録: 押下の tick より前に走る）→ ボタン類を押したら軽い「ぶっ」
installAudioUnlock()
installPressHaptics()
// カードの書き込み・集中の記録を Google カレンダーへ反映するフック（接続中だけ動く）
installGcalHooks()
registerServiceWorker()
requestPersistentStorage()

async function boot() {
  try {
    // 設定画面で入力した OAuth クライアント ID（ビルド時の VITE_GOOGLE_CLIENT_ID が無いとき用）
    setManualClientId(String((await getSetting("gcal.client_id")) ?? ""))
  } catch {
    /* IndexedDB が使えなくても画面は出す（読み込みエラーは画面側で出る） */
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
void boot()
