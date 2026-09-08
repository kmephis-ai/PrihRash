const CACHE = 'prihrash-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.mjs',
  '/presentation.mjs',
  '/reader-cache.mjs',
  '/reader-load.mjs',
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
