const CACHE_NAME = 'lenovo-ad-machine-readable-v30'
const META_CACHE = `${CACHE_NAME}-meta`
const CACHE_TS_KEY = '/__cache_ts__'
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const SHELL_ASSETS = [
  '/ad-machine/index.html',
  '/ad-machine/flyer-gaming.html',
  '/ad-machine/flyer-thin-light.html',
  '/ad-machine/flyer-tablet.html',
  '/ad-machine/flyer-phone.html',
  '/ad-machine/full-service.html',
  '/ad-machine/lottery.html',
  '/ad-machine/lottery-entry.html',
  '/ad-machine/accessory-flash-sale.html',
  '/ad-machine/after-sales-pure.html',
  '/ad-machine/after-sales-entry.html',
  '/ad-machine/after-sales-entry-qr.png',
  '/ad-machine/lottery-entry-qr.png',
  '/flyers/lenovo-618-flyers-data.json',
  '/ad-machine.webmanifest',
  '/favicon.svg',
]

function nowTs() {
  return Date.now()
}

function normalizeUrl(urlLike) {
  try {
    const url = new URL(urlLike, self.location.origin)
    if (url.origin !== self.location.origin) return null
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

async function readCacheTsMap() {
  try {
    const cache = await caches.open(META_CACHE)
    const response = await cache.match(CACHE_TS_KEY)
    if (!response) return {}
    return await response.json()
  } catch {
    return {}
  }
}

async function writeCacheTsMap(map) {
  try {
    const cache = await caches.open(META_CACHE)
    await cache.put(CACHE_TS_KEY, new Response(JSON.stringify(map), {
      headers: { 'Content-Type': 'application/json' },
    }))
  } catch {}
}

async function touchCacheTs(requestUrl) {
  const key = normalizeUrl(requestUrl)
  if (!key) return
  const map = await readCacheTsMap()
  map[key] = nowTs()
  await writeCacheTsMap(map)
}

function shouldCache(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  return url.pathname.startsWith('/ad-machine/')
    || url.pathname.startsWith('/flyers/')
}

function isStaticHeavyAsset(url) {
  return url.pathname.includes('/service-hero-cards/')
    || url.pathname.includes('/after-sales-pure-assets-')
    || url.pathname.includes('/lottery-assets/')
    || /\.(png|jpg|jpeg|webp|svg|gif|mp3|wav)$/i.test(url.pathname)
}

async function fetchAndCache(request, timeoutMs = 0) {
  const fetchPromise = fetch(request)
  const response = timeoutMs > 0
    ? await Promise.race([
        fetchPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ])
    : await fetchPromise

  if (response && response.ok) {
    const copy = response.clone()
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => null)
    touchCacheTs(request.url)
  }
  return response
}

async function cleanupExpiredCache(maxAgeHours = 1) {
  const maxAgeMs = Math.max(1, Number(maxAgeHours) || 1) * 60 * 60 * 1000
  const cutoff = nowTs() - maxAgeMs
  const [cache, map] = await Promise.all([caches.open(CACHE_NAME), readCacheTsMap()])
  const keys = await cache.keys()
  let removed = 0
  for (const req of keys) {
    const normalized = normalizeUrl(req.url)
    const ts = normalized ? Number(map[normalized] || 0) : 0
    if (ts > 0 && ts < cutoff) {
      await cache.delete(req)
      if (normalized) delete map[normalized]
      removed += 1
    }
  }
  await writeCacheTsMap(map)
  return removed
}

async function warmupAssets(urls = []) {
  if (!Array.isArray(urls) || !urls.length) return { ok: true, total: 0, success: 0 }
  const cache = await caches.open(CACHE_NAME)
  let success = 0
  const queue = urls
    .map((url) => normalizeUrl(url))
    .filter(Boolean)
  for (const rawUrl of queue) {
    try {
      const response = await fetch(rawUrl, { cache: 'no-store' })
      if (response && response.ok) {
        await cache.put(rawUrl, response.clone())
        await touchCacheTs(rawUrl)
        success += 1
      }
    } catch {}
  }
  return { ok: success > 0, total: queue.length, success }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(async () => {
        const map = await readCacheTsMap()
        const ts = nowTs()
        SHELL_ASSETS.forEach((path) => {
          const key = normalizeUrl(path)
          if (key) map[key] = ts
        })
        return writeCacheTsMap(map)
      })
      .catch(() => null)
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME && key !== META_CACHE && key.startsWith('lenovo-ad-machine-'))
        .map((key) => caches.delete(key))
    )).then(() => cleanupExpiredCache(1))
  )
  self.clients.claim()
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'AD_MACHINE_WARMUP') {
    event.waitUntil((async () => {
      const payload = await warmupAssets(data.urls || [])
      const clients = await self.clients.matchAll({ includeUncontrolled: true })
      clients.forEach((client) => client.postMessage({ type: 'AD_MACHINE_WARMUP_DONE', payload }))
    })())
    return
  }

  if (data.type === 'AD_MACHINE_CACHE_CLEANUP') {
    event.waitUntil((async () => {
      const removed = await cleanupExpiredCache(data.maxAgeHours || 1)
      const clients = await self.clients.matchAll({ includeUncontrolled: true })
      clients.forEach((client) => client.postMessage({ type: 'AD_MACHINE_CACHE_CLEANUP_DONE', payload: { removed } }))
    })())
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (!shouldCache(request)) return
  const url = new URL(request.url)

  // 大图与静态素材：缓存优先 + 后台更新（避免低配设备重复卡顿）
  if (isStaticHeavyAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreSearch: true })
      if (cached) {
        event.waitUntil(fetchAndCache(request).catch(() => null))
        return cached
      }
      try {
        return await fetchAndCache(request)
      } catch {
        return caches.match('/ad-machine/index.html')
      }
    })())
    return
  }

  // 其它页面：先读缓存，后台静默更新
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true })
    if (cached) {
      event.waitUntil(fetchAndCache(request).catch(() => null))
      return cached
    }
    try {
      return await fetchAndCache(request)
    } catch {
      return caches.match('/ad-machine/index.html')
    }
  })())

  // 间隔清理旧缓存
  event.waitUntil((async () => {
    const map = await readCacheTsMap()
    const lastCleanup = Number(map.__lastCleanup || 0)
    if (nowTs() - lastCleanup > CLEANUP_INTERVAL_MS) {
      await cleanupExpiredCache(1)
      map.__lastCleanup = nowTs()
      await writeCacheTsMap(map)
    }
  })())
})
