const CACHE_NAME = 'lenovo-pos-readable-v4'
const SHELL_ASSETS = [
  '/android-pos',
  '/android-pos-lite.html',
  '/manifest.webmanifest',
  '/pos-lite.webmanifest',
  '/pos-root.webmanifest',
  '/favicon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => null))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key.startsWith('lenovo-pos-')).map((key) => caches.delete(key))))
  )
  self.clients.claim()
})

function shouldCache(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  return url.pathname.startsWith('/android-pos')
    || url.pathname.startsWith('/ad-machine/lottery-assets/')
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (!shouldCache(request)) return
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => null)
        }
        return response
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match('/android-pos-lite.html')))
  )
})
