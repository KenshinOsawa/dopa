/**
 * Google カレンダーへの接続（サーバー無し）: Google Identity Services（GIS）の token model。
 *
 * - スコープは calendar.events だけ。アクセストークンは約 1 時間で切れる（リフレッシュトークンは無い）
 * - トークンはメモリと sessionStorage（このタブを閉じたら消える）にだけ置き、永続保存しない
 * - 切れたら「再接続」ボタンで取り直す（ポップアップはユーザー操作の中でしか開けないので自動では取らない）
 * - クライアント ID はビルド時の VITE_GOOGLE_CLIENT_ID、無ければ設定画面で入力した値。どちらも無ければ連携は出さない
 */
export const SCOPE = "https://www.googleapis.com/auth/calendar.events"
const GIS_SRC = "https://accounts.google.com/gsi/client"
const TOKEN_KEY = "dopa:gcal-token"
const CONNECTED_KEY = "dopa:gcal-connected"
/** 期限のこれだけ前から「切れた」扱いにする */
const EXPIRY_MARGIN_MS = 60_000

export type GcalAuthState = "unconfigured" | "disconnected" | "connected" | "expired"

interface Token {
  access_token: string
  expires_at: number
}

let manualClientId = ""
let token: Token | null = loadToken()
let expiryTimer: number | undefined
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeAuth(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function envClientId(): string {
  try {
    return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? ""
  } catch {
    return ""
  }
}

/** ビルド時に埋め込まれたクライアント ID があるか（あれば設定画面の入力欄は出さない） */
export const hasBuiltInClientId = () => envClientId() !== ""

export function clientId(): string {
  return envClientId() || manualClientId
}

export function setManualClientId(id: string): void {
  manualClientId = id.trim()
  emit()
}

export const isConfigured = () => clientId() !== ""

function loadToken(): Token | null {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as Token
    return typeof t.access_token === "string" && typeof t.expires_at === "number" ? t : null
  } catch {
    return null
  }
}

function saveToken(t: Token | null) {
  token = t
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t))
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* noop */
  }
  scheduleExpiry()
  emit()
}

function scheduleExpiry() {
  if (typeof window === "undefined") return
  window.clearTimeout(expiryTimer)
  if (!token) return
  const wait = token.expires_at - EXPIRY_MARGIN_MS - Date.now()
  if (wait > 0) expiryTimer = window.setTimeout(emit, Math.min(wait + 50, 2 ** 31 - 1))
}
scheduleExpiry()

/** 以前この端末で接続したことがあるか（トークンではなく「接続中にしておきたい」印だけ） */
export function wasConnected(): boolean {
  try {
    return localStorage.getItem(CONNECTED_KEY) === "1"
  } catch {
    return false
  }
}

function setConnectedFlag(v: boolean) {
  try {
    if (v) localStorage.setItem(CONNECTED_KEY, "1")
    else localStorage.removeItem(CONNECTED_KEY)
  } catch {
    /* noop */
  }
}

/** 有効なアクセストークン（無い・切れていれば null） */
export function accessToken(): string | null {
  if (!token) return null
  if (token.expires_at - EXPIRY_MARGIN_MS <= Date.now()) return null
  return token.access_token
}

/** API が 401 を返したとき（トークンが失効している） */
export function expireToken(): void {
  saveToken(null)
}

export function authState(): GcalAuthState {
  if (!isConfigured()) return "unconfigured"
  if (accessToken()) return "connected"
  return wasConnected() ? "expired" : "disconnected"
}

// ──── GIS ────
interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}
interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (r: TokenResponse) => void
    error_callback?: (e: { type?: string; message?: string }) => void
  }) => TokenClient
  revoke: (token: string, done?: () => void) => void
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

let gisPromise: Promise<GoogleOAuth2> | null = null

function loadGis(): Promise<GoogleOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2)
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script")
      s.src = GIS_SRC
      s.async = true
      s.onload = () => {
        const o = window.google?.accounts?.oauth2
        if (o) resolve(o)
        else reject(new Error("Google のログイン部品を読み込めませんでした"))
      }
      s.onerror = () => {
        gisPromise = null
        reject(new Error("Google のログイン部品を読み込めませんでした（オフライン？）"))
      }
      document.head.appendChild(s)
    })
  }
  return gisPromise
}

/**
 * 接続（再接続）。必ずクリックなどのユーザー操作の中から呼ぶ（ポップアップが開くため）。
 * 初回は同意画面、2 回目以降は選択済みアカウントですぐ戻ることが多い。
 */
export async function connect(): Promise<void> {
  const id = clientId()
  if (!id) throw new Error("OAuth クライアント ID が設定されていません")
  const oauth2 = await loadGis()
  await new Promise<void>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: id,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error_description || r.error || "接続できませんでした"))
          return
        }
        const sec = Number(r.expires_in ?? 3600)
        saveToken({ access_token: r.access_token, expires_at: Date.now() + (Number.isFinite(sec) ? sec : 3600) * 1000 })
        setConnectedFlag(true)
        resolve()
      },
      error_callback: (e) => {
        reject(new Error(e.type === "popup_closed" ? "接続をキャンセルしました" : e.message || "接続できませんでした"))
      },
    })
    client.requestAccessToken({ prompt: wasConnected() ? "" : "consent" })
  })
}

/** 切断: トークンを取り消し、この端末の接続印を消す（カードは残る） */
export function disconnect(): void {
  const t = token?.access_token
  saveToken(null)
  setConnectedFlag(false)
  if (t) {
    try {
      window.google?.accounts?.oauth2?.revoke(t)
    } catch {
      /* noop */
    }
  }
  emit()
}

/** テスト用 */
export function __setTokenForTests(t: Token | null, connected = t !== null): void {
  saveToken(t)
  setConnectedFlag(connected)
}
