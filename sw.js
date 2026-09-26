// Offline support when served over http(s): serve from cache, refresh in the
// background. Bump VERSION when the file list changes.
const VERSION = "kanji-ladder-1";
const FILES = [
  "./", "index.html", "css/app.css", "icon.svg", "manifest.webmanifest",
  "data/kanji-data.js", "data/strokes.js",
  "js/kana.js", "js/srs.js", "js/store.js", "js/render.js", "js/quiz.js", "js/app.js",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    })
  );
});
