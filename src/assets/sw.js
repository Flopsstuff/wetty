const CACHE = 'wetty-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([
        './',
        './client/wetty.js',
        './client/wetty.css',
      ]),
    ),
  );
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only handle same-origin GET requests. Everything else — POST (socket.io
  // long-polling), cross-origin requests, and auth-proxy redirects (e.g.
  // Cloudflare Access) — is left untouched so it hits the network directly.
  // The Cache API rejects non-GET requests, and intercepting cross-origin
  // redirects would otherwise surface as bogus 503s.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached ?? new Response('Offline', { status: 503 }),
        ),
      ),
  );
});
