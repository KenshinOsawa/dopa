/** PWA: Service Worker の登録（本番ビルドのみ）と、保存領域を消されにくくする依頼。 */

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      /* オフライン対応が無いだけで、アプリは動く */
    })
  })
}

/**
 * ブラウザに「このサイトのデータは消さないで」と頼む（容量不足時の自動削除を避ける）。
 * 許可されるかはブラウザ次第（ホーム画面に追加した PWA だと通りやすい）。
 */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined)
  } catch {
    /* noop */
  }
}
