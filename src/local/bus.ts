/**
 * 「データが変わった」を知らせる。同じタブの購読者と、同じブラウザの別タブ（BroadcastChannel）の両方へ。
 * 受け取った側は TanStack Query のキャッシュを取り直す。
 */
export type Topic = "tasks" | "xp" | "pomodoro" | "report" | "calendar" | "all"

const CHANNEL = "dopa-changes"
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL)
  } catch {
    channel = null
  }
  return channel
}

const localListeners = new Set<(topics: Topic[]) => void>()

export function broadcast(...topics: Topic[]): void {
  for (const l of localListeners) {
    try {
      l(topics)
    } catch {
      /* noop */
    }
  }
  try {
    getChannel()?.postMessage(topics)
  } catch {
    /* noop */
  }
}

export function onBroadcast(fn: (topics: Topic[]) => void): () => void {
  localListeners.add(fn)
  const ch = getChannel()
  const handler = (e: MessageEvent) => {
    if (Array.isArray(e.data)) fn(e.data as Topic[])
  }
  ch?.addEventListener("message", handler)
  return () => {
    localListeners.delete(fn)
    ch?.removeEventListener("message", handler)
  }
}
