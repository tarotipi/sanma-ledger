// 画面の部品を端末に保存して、2回目以降の起動を速くする。データ（/api）は保存しない。
const CACHE = "sanma-v3";
const MAX_ASSETS = 60; // 古いビルドの部品が溜まり続けないように、新しい順にこの数だけ残す
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return;
  // ページ本体：ネット優先、つながらなければ保存分
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  // 名前にハッシュが付いた部品とフォント：保存分を優先
  if ((url.origin === location.origin && url.pathname.startsWith("/assets/"))) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok || res.type === "opaque") {
              const copy = res.clone();
              caches.open(CACHE).then(async (c) => {
                await c.put(e.request, copy);
                const keys = (await c.keys()).filter((k) => new URL(k.url).pathname.startsWith("/assets/"));
                await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => c.delete(k)));
              });
            }
            return res;
          }),
      ),
    );
  }
});
