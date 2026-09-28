/*
 * dopa の Service Worker（オフラインでも開けるように）。
 * - 画面（ナビゲーション）: ネット優先 → 失敗したらキャッシュの index.html
 * - ビルド成果物（assets/ 以下はファイル名にハッシュ付き）: キャッシュ優先
 * - その他の同一オリジン GET: キャッシュを返しつつ裏で更新
 * 外部（Google のログイン部品・Calendar API）には関わらない。データ（IndexedDB）にも触らない。
 */
const CACHE = "dopa-v1"
const scope = self.registration.scope
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png"].map(
  (p) => new URL(p, scope).href,
)

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || !req.url.startsWith(scope)) return

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put(new URL("./index.html", scope).href, copy))
          return res
        })
        .catch(() => caches.match(new URL("./index.html", scope).href).then((r) => r || Response.error())),
    )
    return
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              void caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => hit || Response.error())
      return hit || net
    }),
  )
})
