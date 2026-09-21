/**
 * Service worker: faz o app abrir instantaneamente e funcionar sem rede.
 * Chamadas de /api/ nunca são cacheadas — dados vem sempre do servidor.
 * Suba SHELL_VERSION ao publicar mudanças no front para invalidar o cache.
 */
const SHELL_VERSION = 'v1';
const SHELL_CACHE = `lista-shell-${SHELL_VERSION}`;

const SHELL_FILES = [
  '/',
  '/index.html',
  '/app.css',
  '/manifest.webmanifest',
  '/js/app.js',
  '/js/actions.js',
  '/js/api.js',
  '/js/dom.js',
  '/js/live.js',
  '/js/router.js',
  '/js/state.js',
  '/js/ui.js',
  '/js/views.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // dados sempre da rede

  // Navegacao: tenta a rede, cai para o app shell guardado.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/'))),
    );
    return;
  }

  // Estáticos: responde do cache e atualiza em segundo plano.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
