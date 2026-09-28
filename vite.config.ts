/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// GitHub Pages（https://<user>.github.io/<repo>/）では BASE_PATH=/<repo>/ でビルドする（.github/workflows/deploy.yml）
const base = process.env.BASE_PATH || "/"

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 800 },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    // 日時のテストは Asia/Tokyo 前提（アプリ本体はブラウザのタイムゾーンで動く）。
    // .env.local のクライアント ID はテストに持ち込まない（未設定の状態から検証する）
    env: { TZ: "Asia/Tokyo", VITE_GOOGLE_CLIENT_ID: "" },
  },
})
