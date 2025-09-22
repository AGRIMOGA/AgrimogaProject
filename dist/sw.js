// --- Agrimoga Service Worker (v6) ---
const CACHE_NAME = 'agrimoga-v6';
const CORE_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const noCache =
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/manifest.json') ||
    url.pathname.endsWith('/sw.js');

  if (noCache) {
    // network-first لهاذ الملفات
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // cache-first لباقي الملفات
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
