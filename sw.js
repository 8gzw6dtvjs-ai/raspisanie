// Офлайн-режим: страница и последнее скачанное расписание открываются без интернета.
const CACHE = 'pary-v6-quiet-refresh';
const SHELL = ['./', 'index.html', 'practice.js', 'practice.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Расписание и сама страница: сначала сеть, без сети — копия из кэша.
  const fresh = url.pathname.endsWith('data.json') || e.request.mode === 'navigate';
  if (fresh) {
    const key = url.pathname.endsWith('data.json') ? 'data.json' : e.request;
    e.respondWith(
      fetch(e.request).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return r;
      }).catch(() => caches.match(key).then((m) => m || caches.match('index.html')))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request)));
});

