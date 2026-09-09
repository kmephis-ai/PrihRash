const CACHE = 'prihrash-shell-v13';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.mjs',
  '/presentation.mjs',
  '/operation-markup.mjs',
  '/reader-cache.mjs',
  '/reader-filters.mjs',
  '/reader-filter-options-view.mjs',
  '/reader-refresh.mjs',
  '/reader-load.mjs',
  '/reader-sync-status.mjs',
  '/reader-view.mjs',
  '/manifest.webmanifest',
];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('prihrash-shell-') && key !== CACHE).map((key) => caches.delete(key)))),
])));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
