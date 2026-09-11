const CACHE_NAME = 'reporte-fluvial-v4';
const ASSETS = [
  './',
  './index.html',
  './privacidad.html',
  './terminos.html',
  './acerca.html',
  './manifest.json',
  './favicon.svg',
  'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;600;700&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Para data.json usamos Network First guardando copia en caché para modo offline
  if (e.request.url.includes('data.json')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            const cloneBase = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, clone);
              cache.put('./data.json', cloneBase);
            });
          }
          return response;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(cached => cached || caches.match('./data.json')))
    );
    return;
  }
  // Para otros assets usamos Cache First con respaldo de red
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});

// Evento de clic en notificaciones
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});
