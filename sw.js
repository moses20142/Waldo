/* ====================================================================
   GoldenPalm Service Worker
   - Caches app shell on install for offline use
   - Network-first for HTML pages (always fresh)
   - Cache-first for CSS / JS / images / fonts
   ==================================================================== */

const CACHE = 'goldenpalm-v1';
const OFFLINE_PAGE = '/index.html';

const APP_SHELL = [
  '/',
  '/index.html',
  '/account.html',
  '/admin.html',
  '/styles.css',
  '/admin.css',
  '/script.js',
  '/account.js',
  '/admin.js',
  '/services.js',
  '/config.js',
  '/database/db.js',
  '/manifest.json',
  '/icon.svg',
];

/* ----- Install: pre-cache app shell ----- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })))
        .catch(err => console.warn('[SW] Pre-cache failed for some files:', err))
    ).then(() => self.skipWaiting())
  );
});

/* ----- Activate: delete old caches ----- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ----- Fetch strategy ----- */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests (analytics, maps, etc.)
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const isHTML = request.headers.get('accept')?.includes('text/html');
  const isAsset = /\.(css|js|svg|png|jpg|jpeg|webp|woff2|ico)$/i.test(url.pathname);

  if (isHTML) {
    // Network-first for HTML pages
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match(OFFLINE_PAGE)))
    );
  } else if (isAsset) {
    // Cache-first for static assets
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (!res || !res.ok) return res;
          caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        });
      })
    );
  }
  // Everything else: normal network pass-through
});

/* ----- Background sync message ----- */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
