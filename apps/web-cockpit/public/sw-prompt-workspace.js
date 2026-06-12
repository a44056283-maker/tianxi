const CACHE_NAME = 'lenovo-prompt-workspace-v2026053101'
const APP_SHELL = [
  '/prompt-workspace.html',
  '/prompt-workspace.webmanifest',
  '/favicon.svg',
  '/icon-192.png?v=202605260554',
  '/icon-512.png?v=202605260554',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/prompt-workspace') || url.pathname.startsWith('/api/openclaw/chat-board')) {
    event.respondWith(
      fetch(request).catch(() => caches.match('/prompt-workspace.html')),
    )
    return
  }
  if (
    !url.pathname.startsWith('/prompt-workspace')
    && url.pathname !== '/prompt-workspace.html'
    && url.pathname !== '/prompt-workspace.webmanifest'
    && url.pathname !== '/favicon.svg'
    && !url.pathname.startsWith('/icon-')
  ) {
    return
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        const cloned = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned))
        return response
      })
    }),
  )
})
