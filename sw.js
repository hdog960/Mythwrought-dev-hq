const cacheName = 'mythwrought-hq-shell-fd737ec38f2f473b';
const shell = ["./","./app.mjs","./assets/apple-touch.png","./assets/icon-192.png","./assets/icon-512.png","./automation.mjs","./command-center.mjs","./creator-notes.mjs","./dashboard.mjs","./estimates.mjs","./ideas.mjs","./index.html","./insights.mjs","./live-github.mjs","./manifest.webmanifest","./model.mjs","./operations.mjs","./releases.mjs","./roadmap.mjs","./styles.css","./ui.mjs"];
const shellURLs = new Set(shell.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(shell.map(path => new Request(path, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('mythwrought-hq-shell-') && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'activate-hq-update') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(self.registration.scope)) return;
  if (!shellURLs.has(url.href) && event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    if (event.request.mode === 'navigate') {
      return (await cache.match(new URL('index.html', self.registration.scope))) ?? fetch(event.request);
    }
    return (await cache.match(event.request)) ?? fetch(event.request);
  })());
});
