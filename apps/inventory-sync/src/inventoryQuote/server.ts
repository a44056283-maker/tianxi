import http from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  getInventoryQuotePrices,
  getInventoryQuoteRetailZone,
  getInventoryQuoteSerials,
  getInventoryQuoteSummary,
  getAdjustedInventorySnapshot,
  loadInventoryAdjustments,
  loadManualPriceOverrides,
  loadInventoryMovements,
  loadSerialOverrides,
  saveInventoryAdjustments,
  saveInventoryMovements,
  saveManualPriceOverrides,
  saveSerialOverrides,
} from './dataService.js'

type Handler = (url: URL) => Promise<unknown>
type RequestHandler = (url: URL, request: http.IncomingMessage) => Promise<unknown>

function parseQuery(url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? '')
  const offset = Number(url.searchParams.get('offset') ?? '')
  return {
    search: url.searchParams.get('search') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    riskLevel: url.searchParams.get('riskLevel') as '低' | '中' | '高' | undefined,
    approval: url.searchParams.get('approval') as '销售可用' | '店长审批' | '老板审批' | undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  }
}

const handlers: Record<string, Handler> = {
  '/api/inventory-quote/inventory': () => getAdjustedInventorySnapshot(),
  '/api/inventory-quote/summary': () => getInventoryQuoteSummary(),
  '/api/inventory-quote/serials': (url) => getInventoryQuoteSerials(parseQuery(url)),
  '/api/inventory-quote/prices': (url) => getInventoryQuotePrices(parseQuery(url)),
  '/api/inventory-quote/retail-zone': (url) => getInventoryQuoteRetailZone(parseQuery(url)),
}

const requestHandlers: Record<string, RequestHandler> = {
  '/api/inventory-quote/manual-overrides': async (_url, request) => {
    if (request.method === 'GET') {
      const current = await loadManualPriceOverrides()
      return {
        generatedAt: current.mtime?.toISOString() ?? new Date().toISOString(),
        source: 'system_manual_price_overrides',
        overrides: current.overrides,
      }
    }
    if (request.method !== 'POST') {
      return { error: 'method_not_allowed', message: 'Only GET and POST are supported.' }
    }
    const body = await readRequestBody(request)
    const payload = body ? JSON.parse(body) as { overrides?: unknown } : {}
    if (!payload.overrides || typeof payload.overrides !== 'object') {
      return { error: 'bad_request', message: 'overrides must be an object.' }
    }
    return saveManualPriceOverrides(payload.overrides as Parameters<typeof saveManualPriceOverrides>[0])
  },
  '/api/inventory-quote/inventory-adjustments': async (_url, request) => {
    if (request.method === 'GET') {
      return {
        generatedAt: new Date().toISOString(),
        source: 'system_inventory_adjustments',
        adjustments: await loadInventoryAdjustments(),
      }
    }
    if (request.method !== 'POST') {
      return { error: 'method_not_allowed', message: 'Only GET and POST are supported.' }
    }
    const body = await readRequestBody(request)
    const payload = body ? JSON.parse(body) as { adjustments?: unknown } : {}
    if (!payload.adjustments || typeof payload.adjustments !== 'object') {
      return { error: 'bad_request', message: 'adjustments must be an object.' }
    }
    return saveInventoryAdjustments(payload.adjustments as Parameters<typeof saveInventoryAdjustments>[0])
  },
  '/api/inventory-quote/inventory-movements': async (_url, request) => {
    if (request.method === 'GET') {
      return {
        generatedAt: new Date().toISOString(),
        source: 'system_inventory_movements',
        records: await loadInventoryMovements(),
      }
    }
    if (request.method !== 'POST') {
      return { error: 'method_not_allowed', message: 'Only GET and POST are supported.' }
    }
    const body = await readRequestBody(request)
    const payload = body ? JSON.parse(body) as { records?: unknown } : {}
    if (!Array.isArray(payload.records)) {
      return { error: 'bad_request', message: 'records must be an array.' }
    }
    return saveInventoryMovements(payload.records as Parameters<typeof saveInventoryMovements>[0])
  },
  '/api/inventory-quote/serial-overrides': async (_url, request) => {
    if (request.method === 'GET') {
      return {
        generatedAt: new Date().toISOString(),
        source: 'system_serial_overrides',
        overrides: await loadSerialOverrides(),
      }
    }
    if (request.method !== 'POST') {
      return { error: 'method_not_allowed', message: 'Only GET and POST are supported.' }
    }
    const body = await readRequestBody(request)
    const payload = body ? JSON.parse(body) as { overrides?: unknown } : {}
    if (!payload.overrides || typeof payload.overrides !== 'object') {
      return { error: 'bad_request', message: 'overrides must be an object.' }
    }
    return saveSerialOverrides(payload.overrides as Parameters<typeof saveSerialOverrides>[0])
  },
}

function readRequestBody(request: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ''
    request.setEncoding('utf-8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        request.destroy(new Error('request_body_too_large'))
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload, null, 2))
}

export function createInventoryQuoteServer() {
  return http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, null)
      return
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const requestHandler = requestHandlers[url.pathname]
    if (requestHandler) {
      const payload = await requestHandler(url, request)
      if (payload && typeof payload === 'object' && 'error' in payload) {
        sendJson(response, payload.error === 'method_not_allowed' ? 405 : 400, payload)
        return
      }
      sendJson(response, 200, payload)
      return
    }

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'method_not_allowed', message: 'Only GET is supported.' })
      return
    }
    if (url.pathname === '/healthz') {
      sendJson(response, 200, { ok: true })
      return
    }

    const handler = handlers[url.pathname]
    if (!handler) {
      sendJson(response, 404, {
        error: 'not_found',
        message: 'Unknown inventory quote endpoint.',
        endpoints: Object.keys(handlers),
      })
      return
    }

    try {
      sendJson(response, 200, await handler(url))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 500, { error: 'inventory_quote_api_error', message })
    }
  })
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMainModule) {
  const port = Number(process.env.INVENTORY_QUOTE_API_PORT ?? process.env.PORT ?? 4318)
  const host = process.env.INVENTORY_QUOTE_API_HOST ?? '127.0.0.1'
  const server = createInventoryQuoteServer()
  server.listen(port, host, () => {
    console.log(`inventory quote api listening on http://${host}:${port}`)
  })
}
