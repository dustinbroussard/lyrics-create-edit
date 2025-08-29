const CACHE_NAME = 'lyricsmith-v4';
const APP_SHELL = [
    './',
    'index.html',
    'style.css',
    'config.js',
    'script.js',
    'editor/editor.html',
    'editor/editor.js',
    'editor/editor.css',
    'editor/songs.js',
    'manifest.webmanifest',
    'assets/icons/icon-192x192.png',
    'assets/icons/icon-512x512.png',
    'assets/images/mylogo.png',
    'lib/mammoth.browser.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Add shell entries individually so one failure doesn't abort install
    await Promise.allSettled(APP_SHELL.map(async (url) => {
      try {
        const resp = await fetch(new Request(url, { cache: 'reload' }));
        await cache.put(url, resp.clone());
      } catch (e) {
        // Ignore failures (e.g., 404 in some deploy layouts)
      }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request).then(resp => {
        cache.put(request, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached || network;
    })());
  } else {
    event.respondWith((async () => {
      try {
        const resp = await fetch(request);
        return resp;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        return cached || Response.error();
      }
    })());
  }
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
