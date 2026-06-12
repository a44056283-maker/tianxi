const CACHE_NAME = 'lenovo-retail-ops-terminal-v202605272002'
const SHELL_FILES = [
  '/retail-ops-terminal.html',
  '/retail-ops-terminal.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request))
    return
  }
  if (url.pathname.endsWith('/retail-ops-terminal.html') || url.pathname === '/retail-ops-terminal.html') {
    event.respondWith(
      fetch(request).then((response) => {
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {})
        return response
      }).catch(() => caches.match(request)),
    )
    return
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const clone = response.clone()
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {})
      return response
    })),
  )
})
