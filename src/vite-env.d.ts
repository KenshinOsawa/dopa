/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth クライアント ID（ウェブアプリ）。未設定ならカレンダー連携を出さない */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
