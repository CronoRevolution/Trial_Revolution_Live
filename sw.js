// Service Worker mínimo — solo para hacer la PWA instalable.
// No cachea (offline lo haremos más adelante si hace falta).

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Pass-through: todas las peticiones van a red sin caché
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => new Response('Offline', { status: 503 })));
});
