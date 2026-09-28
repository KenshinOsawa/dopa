/**
 * タイマーのブラウザ通知と、バックグラウンドでも止まらない tick。
 * フェーズ切り替えの音は lib/timerChime.ts（旧ビープは廃止）。
 */

export function requestNotificationPermission(): void {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission()
    }
  } catch {
    /* noop */
  }
}

export function notify(title: string, body: string): void {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: "dopa-pomodoro" })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    }
  } catch {
    /* noop */
  }
}

/**
 * 1 秒ごとの tick。バックグラウンドタブでは main スレッドのタイマーが最大 1 分単位に
 * まとめられるので、Worker のタイマーを使う（表示は時刻から計算するので tick は描画のきっかけだけ）。
 */
export function startTicker(onTick: () => void): () => void {
  try {
    const src = "setInterval(() => postMessage(0), 1000)"
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }))
    const worker = new Worker(url)
    worker.onmessage = onTick
    return () => {
      worker.terminate()
      URL.revokeObjectURL(url)
    }
  } catch {
    const id = window.setInterval(onTick, 1000)
    return () => window.clearInterval(id)
  }
}
