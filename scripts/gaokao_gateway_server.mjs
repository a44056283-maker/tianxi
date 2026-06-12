import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const host = process.env.GAOKAO_GATEWAY_HOST || '127.0.0.1'
const port = Number(process.env.GAOKAO_GATEWAY_PORT || '19518')
const apiOrigin = (process.env.GAOKAO_GATEWAY_API_ORIGIN || 'http://127.0.0.1:8000').replace(/\/$/, '')
const staticRoot = resolve(process.env.GAOKAO_GATEWAY_STATIC_ROOT || join(process.cwd(), 'apps/web-cockpit/public'))

const STATIC_CONTENT_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
}

const apiCacheRules = [
  { prefix: '/api/marketing/gaokao-2026/summary', ttlMs: 15_000 },
  { prefix: '/api/marketing/gaokao-2026/knowledge-guides', ttlMs: 300_000 },
  { prefix: '/api/marketing/gaokao-2026/portal/feed', ttlMs: 10_000 },
  { prefix: '/api/marketing/gaokao-2026/leads', ttlMs: 10_000 },
]

const responseCache = new Map()
const inflightRequests = new Map()

function cacheRuleFor(pathname) {
  return apiCacheRules.find((rule) => pathname.startsWith(rule.prefix)) || null
}

function isStaticAsset(pathname) {
  return pathname.startsWith('/gaokao-2026/assets/') || pathname.startsWith('/gaokao-2026/uploads/')
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { ok: false, error: message })
}

function requestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolveBody(chunks.length ? Buffer.concat(chunks) : null))
    req.on('error', rejectBody)
  })
}

function upstreamHeaders(req, body) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue
    const lowered = key.toLowerCase()
    if (['host', 'connection', 'content-length'].includes(lowered)) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  if (body && !headers.has('content-type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
  }
  return headers
}

async function fetchApi(req, pathname, search) {
  const cacheRule = req.method === 'GET' ? cacheRuleFor(pathname) : null
  const cacheKey = cacheRule ? `${pathname}${search}` : null
  const now = Date.now()

  if (cacheRule && cacheKey) {
    const cached = responseCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return { ...cached, fromCache: true }
    }
    if (inflightRequests.has(cacheKey)) {
      return inflightRequests.get(cacheKey)
    }
  }

  const upstreamTimeoutMs = req.method === 'GET' ? 10_000 : 35_000

  const promise = (async () => {
    const body = ['GET', 'HEAD'].includes(req.method) ? null : await requestBody(req)
    const response = await fetch(`${apiOrigin}${pathname}${search}`, {
      method: req.method,
      headers: upstreamHeaders(req, body),
      body,
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    })
    const payload = Buffer.from(await response.arrayBuffer())
    const headerPairs = {}
    response.headers.forEach((value, key) => {
      if (!['connection', 'transfer-encoding', 'keep-alive', 'content-length', 'content-encoding', 'cache-control', 'pragma', 'expires'].includes(key.toLowerCase())) {
        headerPairs[key] = value
      }
    })
    const result = {
      status: response.status,
      headers: headerPairs,
      body: payload,
      fromCache: false,
    }
    if (cacheRule && cacheKey && response.ok) {
      responseCache.set(cacheKey, {
        ...result,
        expiresAt: now + cacheRule.ttlMs,
      })
    }
    return result
  })()

  if (cacheRule && cacheKey) {
    inflightRequests.set(cacheKey, promise)
    promise.finally(() => inflightRequests.delete(cacheKey))
  }

  return promise
}

function staticPathFor(pathname) {
  if (pathname === '/' || pathname === '') return join(staticRoot, 'gaokao-2026/mobile.html')
  if (pathname === '/healthz') return null
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  return join(staticRoot, safePath)
}

async function serveStatic(req, res, pathname) {
  const filePath = staticPathFor(pathname)
  if (!filePath) {
    sendJson(res, 200, {
      ok: true,
      service: 'gaokao-gateway',
      staticRoot,
      now: new Date().toISOString(),
    })
    return
  }

  if (!filePath.startsWith(staticRoot)) {
    sendError(res, 403, 'Forbidden path')
    return
  }

  if (!existsSync(filePath)) {
    sendError(res, 404, 'File not found')
    return
  }

  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) {
    sendError(res, 404, 'File not found')
    return
  }

  const ext = extname(filePath).toLowerCase()
  const headers = {
    'Content-Type': STATIC_CONTENT_TYPES[ext] || 'application/octet-stream',
    'Content-Length': String(fileStat.size),
    'Last-Modified': fileStat.mtime.toUTCString(),
    'Cache-Control': ext === '.html'
      ? 'public, max-age=15, stale-while-revalidate=60'
      : (isStaticAsset(pathname) ? 'public, max-age=86400, immutable' : 'public, max-age=300, stale-while-revalidate=600'),
  }

  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname
    const search = url.search || ''

    if (pathname.startsWith('/api/')) {
      const upstream = await fetchApi(req, pathname, search)
      const headers = {
        ...upstream.headers,
        'x-gaokao-gateway-cache': upstream.fromCache ? 'HIT' : 'MISS',
        'Cache-Control': upstream.fromCache
          ? 'public, max-age=10, stale-while-revalidate=30'
          : 'no-store',
        'Content-Length': String(upstream.body.length),
      }
      res.writeHead(upstream.status, headers)
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(upstream.body)
      return
    }

    await serveStatic(req, res, pathname)
  } catch (error) {
    sendError(res, 502, error instanceof Error ? error.message : 'Gateway failed')
  }
})

server.keepAliveTimeout = 65_000
server.headersTimeout = 70_000

server.listen(port, host, () => {
  console.log(`[gaokao-gateway] listening on http://${host}:${port}`)
})
