/* StudyAcceleration Service Worker — オフライン閲覧用
   方針:
   - 同一オリジン: ネットワーク優先(常に最新を表示)、失敗時にキャッシュへフォールバック。
     成功したレスポンスは都度キャッシュ → 一度開いたページはオフラインでも読める
   - KaTeX (cdn.jsdelivr.net): キャッシュ優先(URLにバージョンが入っており不変のため)。
     これが唯一の外部通信(CLAUDE.mdの方針どおり)
   - その他のクロスオリジン: 介入しない(存在しない想定)
   更新: このファイルを変更して再デプロイすると新SWが有効化され、旧キャッシュは削除される */
"use strict";
const CACHE = "sa-v1";
const PRECACHE = [
  "./",
  "index.html",
  "assets/style.css",
  "assets/app.js",
  "assets/math.js",
  "data/topics.js",
  "manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // 1件失敗しても全体を止めない(ベストエフォート)
      Promise.allSettled(PRECACHE.map((u) => c.add(u)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // KaTeX CDN: キャッシュ優先(バージョン付きURLのため不変)
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // 同一オリジンのみ: ネットワーク優先+キャッシュフォールバック
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(
          (hit) =>
            hit ||
            (req.mode === "navigate" ? caches.match("index.html") : undefined)
        )
      )
  );
});
