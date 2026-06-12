import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import {
  type InventoryMovementRecord,
  loadInventoryMovements,
  loadSerialOverrides,
  saveInventoryMovements,
  saveSerialOverrides,
  type SerialOverride,
} from '../inventoryQuote/dataService.js'

type ZhidiantongSession = {
  token: string
  tenantId: string
  channelId: string
  lang: string
  baseUrl: string
  source: 'env' | 'session-file' | 'storage-state' | 'browser-capture'
  capturedAt: string
}

type ZhidiantongSyncState = {
  generatedAt: string
  salesOrderIds: string[]
  purchaseRecordIds: string[]
  otherOutboundRecordIds: string[]
  warnings: string[]
}

type ZhidiantongApiEnvelope<T> = {
  code?: number
  msg?: string
  message?: string
  data?: T
}

type ZhidiantongSalesDetail = {
  id?: string | number
  orderNo?: string
  createdTime?: string
  payTime?: string
  productList?: ZhidiantongProductRow[]
}

type ZhidiantongStockDetail = {
  id?: string | number
  sourceNo?: string
  createdTime?: string
  stockInTime?: string
  stockOutTime?: string
  productList?: ZhidiantongProductRow[]
}

type ZhidiantongProductRow = {
  id?: string | number
  productName?: string
  productItemNo?: string
  skuNo?: string
  mtmCode?: string
  specification?: string
  unitName?: string
  quantity?: number | string
  stockInNum?: number | string
  num?: number | string
  amount?: number | string
  serialNumberList?: string[]
  snList?: string[]
  snCheckList?: Array<{ serialNumber?: string; costPrice?: number }>
  costPrice?: number
}

type ZhidiantongSyncResult = {
  sessionSource: ZhidiantongSession['source']
  files: {
    sessionFilePath: string
    syncStateFilePath: string
    inventoryMovementsPath: string
    serialOverridesPath: string
  }
  salesOutbound: { requested: number; synced: number }
  purchaseInbound: { requested: number; synced: number }
  otherOutbound: { requested: number; synced: number }
  mergedInventoryMovementCount: number
  mergedSerialOverrideCount: number
  warnings: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function normalizeId(value: unknown) {
  const text = String(value ?? '').trim()
  return text || undefined
}

function normalizeDate(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return new Date().toISOString().slice(0, 10)
  return text.slice(0, 10)
}

function normalizeSkuKey(row: ZhidiantongProductRow) {
  const candidates = [
    row.productItemNo,
    row.skuNo,
    row.mtmCode,
  ]
  for (const value of candidates) {
    const text = String(value ?? '').trim()
    if (!text) continue
    const match = text.match(/\b(\d{8})\b/)
    if (match) return match[1]
    if (/^\d{8}$/.test(text)) return text
  }
  return undefined
}

function normalizeSerials(row: ZhidiantongProductRow) {
  const serials = new Set<string>()
  for (const value of asArray(row.serialNumberList)) {
    const serial = String(value ?? '').trim()
    if (serial) serials.add(serial)
  }
  for (const value of asArray(row.snList)) {
    const serial = String(value ?? '').trim()
    if (serial) serials.add(serial)
  }
  for (const item of asArray(row.snCheckList)) {
    if (!isObject(item)) continue
    const serial = String(item.serialNumber ?? '').trim()
    if (serial) serials.add(serial)
  }
  return [...serials]
}

function normalizePurchaseCost(row: ZhidiantongProductRow) {
  const normalizePurchaseMoneyUnit = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
    const normalized = Math.abs(value) >= 50000 ? value / 100 : value
    return Number(normalized.toFixed(2))
  }
  for (const item of asArray(row.snCheckList)) {
    if (!isObject(item)) continue
    const normalized = normalizePurchaseMoneyUnit(item.costPrice)
    if (typeof normalized === 'number' && normalized >= 0) return normalized
  }
  const normalized = normalizePurchaseMoneyUnit(row.costPrice)
  if (typeof normalized === 'number' && normalized >= 0) return normalized
  return undefined
}

function normalizeQuantityValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  const text = String(value ?? '').trim()
  if (!text) return 0
  const numeric = Number(text.replace(/[^\d.-]/g, ''))
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

function normalizePurchaseQuantity(row: ZhidiantongProductRow) {
  const serialCount = normalizeSerials(row).length
  const candidates = [
    normalizeQuantityValue(row.stockInNum),
    normalizeQuantityValue(row.quantity),
    normalizeQuantityValue(row.num),
    serialCount,
  ]
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value))

  if (!candidates.length) return 0
  const saneCandidates = candidates.filter((value) => value <= 100)
  if (saneCandidates.length) return Math.min(...saneCandidates)
  if (serialCount > 0) return serialCount
  return 0
}

async function ensureDirFor(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function readJsonIfExists<T>(filePath: string) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return undefined
  }
}

async function readSeedIds(filePath: string | undefined) {
  if (!filePath) return []
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => '')
    return raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function extractFromStorageState(storageState: unknown): ZhidiantongSession | undefined {
  if (!isObject(storageState) || !Array.isArray(storageState.origins)) return undefined
  for (const originRow of storageState.origins) {
    if (!isObject(originRow)) continue
    const origin = String(originRow.origin ?? '')
    if (!origin.includes('retail-pos.lenovo.com')) continue
    const localStorageRows = Array.isArray(originRow.localStorage) ? originRow.localStorage : []
    const map = new Map<string, string>()
    for (const item of localStorageRows) {
      if (!isObject(item)) continue
      const name = String(item.name ?? '').trim()
      const value = String(item.value ?? '').trim()
      if (name) map.set(name, value)
    }
    const token = map.get('token')
    const tenantId = map.get('tenant-id')
    if (!token || !tenantId) continue
    return {
      token,
      tenantId,
      channelId: map.get('channel-id') || config.lenovoRetail.channelId,
      lang: map.get('lang') || config.lenovoRetail.lang,
      baseUrl: config.lenovoRetail.apiBaseUrl,
      source: 'storage-state',
      capturedAt: new Date().toISOString(),
    }
  }
  return undefined
}

async function saveSession(session: ZhidiantongSession) {
  await ensureDirFor(config.lenovoRetail.sessionFilePath)
  await fs.writeFile(config.lenovoRetail.sessionFilePath, `${JSON.stringify(session, null, 2)}\n`, 'utf-8')
}

export async function captureZhidiantongSession() {
  throw new Error(
    'captureZhidiantongSession 已封禁：只允许使用当前已登录默认 Chrome 会话，禁止 Playwright 拉起新浏览器/新登录页。',
  )
}

async function loadSession(): Promise<ZhidiantongSession> {
  if (config.lenovoRetail.token && config.lenovoRetail.tenantId) {
    return {
      token: config.lenovoRetail.token,
      tenantId: config.lenovoRetail.tenantId,
      channelId: config.lenovoRetail.channelId,
      lang: config.lenovoRetail.lang,
      baseUrl: config.lenovoRetail.apiBaseUrl,
      source: 'env',
      capturedAt: new Date().toISOString(),
    }
  }

  const saved = await readJsonIfExists<ZhidiantongSession>(config.lenovoRetail.sessionFilePath)
  if (saved?.token && saved.tenantId) return saved

  const storageState = await readJsonIfExists<unknown>(config.lenovoRetail.storageStatePath)
  const fromStorage = extractFromStorageState(storageState)
  if (fromStorage) {
    await saveSession(fromStorage)
    return fromStorage
  }

  throw new Error('缺少智店通 API 会话。先运行 npm run capture:zhidiantong-session 或 npm run login:lenovo。')
}

async function apiFetch<T>(session: ZhidiantongSession, endpoint: string, init?: RequestInit) {
  const response = await fetch(`${session.baseUrl}${endpoint}`, {
    ...init,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      token: session.token,
      'tenant-id': session.tenantId,
      'channel-id': session.channelId,
      lang: session.lang,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new Error(`智店通接口失败 ${response.status} ${response.statusText}: ${endpoint}`)
  }
  const payload = await response.json() as ZhidiantongApiEnvelope<T>
  if ((payload.code ?? 0) !== 0) {
    throw new Error(`智店通接口返回异常 code=${payload.code ?? 'unknown'} endpoint=${endpoint} message=${payload.msg ?? payload.message ?? 'unknown error'}`)
  }
  return payload.data as T
}

function mergeInventoryMovements(existing: InventoryMovementRecord[], incoming: InventoryMovementRecord[]) {
  const map = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
}

function mergeSerialOverrides(existing: Record<string, SerialOverride>, incoming: Record<string, SerialOverride>) {
  return {
    ...existing,
    ...incoming,
  }
}

function buildSalesOutbound(detail: ZhidiantongSalesDetail) {
  const records: InventoryMovementRecord[] = []
  const orderId = normalizeId(detail.id) ?? 'unknown-order'
  const orderNo = normalizeId(detail.orderNo) ?? orderId
  const businessDate = normalizeDate(detail.payTime ?? detail.createdTime)
  for (const row of detail.productList ?? []) {
    const skuKey = normalizeSkuKey(row)
    if (!skuKey) continue
    const serials = normalizeSerials(row)
    if (!serials.length) continue
    for (const serialNumber of serials) {
      records.push({
        id: `SALE-${orderNo}-${serialNumber}`,
        skuKey,
        quantity: 1,
        movementType: 'sales_outbound',
        businessDate,
        serialNumber,
        note: `智店通线下门店订单销售出库同步，订单 ${orderNo}，后台ID ${orderId}`,
        updatedAt: new Date().toISOString(),
      })
    }
  }
  return records
}

function buildPurchaseInbound(detail: ZhidiantongStockDetail, serialMap: Map<string, string[]>) {
  const records: InventoryMovementRecord[] = []
  const overrides: Record<string, SerialOverride> = {}
  let pendingSnQuantity = 0
  const pendingSnSkuKeys = new Set<string>()
  const sourceNo = normalizeId(detail.sourceNo) ?? normalizeId(detail.id) ?? 'unknown-purchase'
  const businessDate = normalizeDate(detail.stockInTime ?? detail.createdTime)
  for (const row of detail.productList ?? []) {
    const rowId = normalizeId(row.id)
    const skuKey = normalizeSkuKey(row)
    if (!skuKey) continue
    const serials = (rowId ? serialMap.get(rowId) : undefined) ?? normalizeSerials(row)
    const purchaseCost = normalizePurchaseCost(row)
    const quantity = normalizePurchaseQuantity(row)
    for (const serialNumber of serials) {
      records.push({
        id: `PURCHASE-${sourceNo}-${serialNumber}`,
        skuKey,
        quantity: 1,
        movementType: 'purchase_inbound',
        businessDate,
        serialNumber,
        documentNumber: sourceNo,
        sourceRef: sourceNo,
        sourceDocumentType: '采购入库',
        productName: row.productName?.trim() || undefined,
        pnMtm: row.mtmCode?.trim() || undefined,
        spec: row.specification?.trim() || undefined,
        unitName: row.unitName?.trim() || undefined,
        unitCost: purchaseCost,
        amount: purchaseCost,
        note: `智店通采购入库同步，业务单 ${sourceNo}`,
        updatedAt: new Date().toISOString(),
      })
      overrides[serialNumber] = {
        skuKey,
        inboundDate: businessDate,
        documentNumber: sourceNo,
        purchaseCost,
        productName: row.productName?.trim() || undefined,
        pnMtm: row.mtmCode?.trim() || undefined,
        spec: row.specification?.trim() || undefined,
        note: `智店通采购入库同步，业务单 ${sourceNo}`,
        updatedAt: new Date().toISOString(),
      }
    }
    const remainingQuantity = Math.max(quantity - serials.length, 0)
    if (remainingQuantity > 0) {
      pendingSnQuantity += remainingQuantity
      pendingSnSkuKeys.add(skuKey)
      records.push({
        id: `PURCHASEQ-${sourceNo}-${skuKey}-${rowId ?? 'row'}`,
        skuKey,
        quantity: remainingQuantity,
        movementType: 'purchase_inbound',
        businessDate,
        documentNumber: sourceNo,
        sourceRef: sourceNo,
        sourceDocumentType: '采购入库',
        productName: row.productName?.trim() || undefined,
        pnMtm: row.mtmCode?.trim() || undefined,
        spec: row.specification?.trim() || undefined,
        unitName: row.unitName?.trim() || undefined,
        unitCost: purchaseCost,
        amount: purchaseCost ? Number((purchaseCost * remainingQuantity).toFixed(2)) : undefined,
        note: serials.length
          ? `智店通采购入库同步，业务单 ${sourceNo}；剩余 ${remainingQuantity} 台待补 SN`
          : `智店通采购入库同步，业务单 ${sourceNo}；当前仅同步数量，待补 SN`,
        updatedAt: new Date().toISOString(),
      })
    }
  }
  return {
    records,
    overrides,
    pendingSnQuantity,
    pendingSnSkuKeys: [...pendingSnSkuKeys],
  }
}

function buildOtherOutbound(detail: ZhidiantongStockDetail, serialMap: Map<string, string[]>) {
  const records: InventoryMovementRecord[] = []
  const sourceNo = normalizeId(detail.sourceNo) ?? normalizeId(detail.id) ?? 'unknown-other-outbound'
  const businessDate = normalizeDate(detail.stockOutTime ?? detail.createdTime)
  for (const row of detail.productList ?? []) {
    const rowId = normalizeId(row.id)
    const skuKey = normalizeSkuKey(row)
    if (!rowId || !skuKey) continue
    const serials = serialMap.get(rowId) ?? normalizeSerials(row)
    if (!serials.length) continue
    for (const serialNumber of serials) {
      records.push({
        id: `${sourceNo}-${skuKey}-${serialNumber}`,
        skuKey,
        quantity: 1,
        movementType: 'transfer_outbound',
        businessDate,
        serialNumber,
        note: `智店通其他出库同步，业务单 ${sourceNo}，非零售出库`,
        updatedAt: new Date().toISOString(),
      })
    }
  }
  return records
}

async function fetchPurchaseSerialMap(session: ZhidiantongSession, detail: ZhidiantongStockDetail) {
  const map = new Map<string, string[]>()
  for (const row of detail.productList ?? []) {
    const rowId = normalizeId(row.id)
    if (!rowId) continue
    const response = await apiFetch<{ list?: Array<{ serialNumber?: string }> }>(
      session,
      '/prd/backend/storeStockPurchaseRecord/serialNumberByPage',
      {
        method: 'POST',
        body: JSON.stringify({
          count: true,
          pageNum: 1,
          pageSize: 1000,
          storeOrderId: detail.id,
          storeProductDetailId: row.id,
        }),
      },
    )
    const serials = asArray(response?.list).map((item) => isObject(item) ? String(item.serialNumber ?? '').trim() : '').filter(Boolean)
    map.set(rowId, serials)
  }
  return map
}

async function fetchOtherOutboundSerialMap(session: ZhidiantongSession, detail: ZhidiantongStockDetail) {
  const map = new Map<string, string[]>()
  for (const row of detail.productList ?? []) {
    const rowId = normalizeId(row.id)
    if (!rowId) continue
    const response = await apiFetch<{ list?: Array<{ serialNumber?: string }> }>(
      session,
      '/prd/backend/shop/serialNumber/findPage',
      {
        method: 'POST',
        body: JSON.stringify({
          stockDealId: row.id,
          pageNum: 1,
          pageSize: 1000,
        }),
      },
    )
    const serials = asArray(response?.list).map((item) => isObject(item) ? String(item.serialNumber ?? '').trim() : '').filter(Boolean)
    map.set(rowId, serials)
  }
  return map
}

async function loadSyncState() {
  const current = await readJsonIfExists<ZhidiantongSyncState>(config.lenovoRetail.syncStateFilePath)
  return current ?? {
    generatedAt: new Date().toISOString(),
    salesOrderIds: [],
    purchaseRecordIds: [],
    otherOutboundRecordIds: [],
    warnings: [],
  }
}

async function saveSyncState(state: ZhidiantongSyncState) {
  await ensureDirFor(config.lenovoRetail.syncStateFilePath)
  await fs.writeFile(config.lenovoRetail.syncStateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
}

export async function syncZhidiantongSeededData(): Promise<ZhidiantongSyncResult> {
  const session = await loadSession()
  const syncState = await loadSyncState()
  const warnings = new Set<string>()

  const salesIds = (await readSeedIds(config.lenovoRetail.salesOrderIdsFile))
    .filter((item) => !syncState.salesOrderIds.includes(item))
  const purchaseIds = (await readSeedIds(config.lenovoRetail.purchaseRecordIdsFile))
    .filter((item) => !syncState.purchaseRecordIds.includes(item))
  const otherIds = (await readSeedIds(config.lenovoRetail.otherOutboundIdsFile))
    .filter((item) => !syncState.otherOutboundRecordIds.includes(item))

  const newMovementRecords: InventoryMovementRecord[] = []
  let newSerialOverrides: Record<string, SerialOverride> = {}

  for (const orderId of salesIds) {
    try {
      const detail = await apiFetch<ZhidiantongSalesDetail>(session, `/trade/backend/omsOrder/getById?orderId=${encodeURIComponent(orderId)}`)
      const records = buildSalesOutbound(detail)
      if (!records.length) {
        warnings.add(`销售出库订单 ${orderId} 已取到详情，但未解析出任何 SN 流水，暂不标记为已同步，保留下次重试。`)
        continue
      }
      newMovementRecords.push(...records)
      syncState.salesOrderIds.push(orderId)
    } catch (error) {
      warnings.add(`销售出库订单 ${orderId} 同步失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const recordId of purchaseIds) {
    try {
      const detail = await apiFetch<ZhidiantongStockDetail>(session, `/prd/backend/storeStockPurchaseRecord/getDetailById?id=${encodeURIComponent(recordId)}`)
      const serialMap = await fetchPurchaseSerialMap(session, detail)
      const built = buildPurchaseInbound(detail, serialMap)
      if (!built.records.length) {
        warnings.add(`采购入库单 ${recordId} 已取到详情，但未解析出任何 SN 入库流水，暂不标记为已同步，保留下次重试。`)
        continue
      }
      newMovementRecords.push(...built.records)
      newSerialOverrides = mergeSerialOverrides(newSerialOverrides, built.overrides)
      if (built.pendingSnQuantity > 0) {
        warnings.add(
          `采购入库单 ${recordId} 已同步数量/成本/供应商等主字段，但仍有 ${built.pendingSnQuantity} 台待补 SN（SKU: ${built.pendingSnSkuKeys.join(', ') || '待补'}）。`,
        )
      }
      syncState.purchaseRecordIds.push(recordId)
    } catch (error) {
      warnings.add(`采购入库单 ${recordId} 同步失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const recordId of otherIds) {
    try {
      const detail = await apiFetch<ZhidiantongStockDetail>(session, `/prd/backend/storeStockModifyRecord/getDetailById?id=${encodeURIComponent(recordId)}`)
      const serialMap = await fetchOtherOutboundSerialMap(session, detail)
      const records = buildOtherOutbound(detail, serialMap)
      if (!records.length) {
        warnings.add(`其他出库单 ${recordId} 已取到详情，但未解析出任何 SN 出库流水，暂不标记为已同步，保留下次重试。`)
        continue
      }
      newMovementRecords.push(...records)
      syncState.otherOutboundRecordIds.push(recordId)
    } catch (error) {
      warnings.add(`其他出库单 ${recordId} 同步失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const mergedMovements = mergeInventoryMovements(await loadInventoryMovements(), newMovementRecords)
  const mergedOverrides = mergeSerialOverrides(await loadSerialOverrides(), newSerialOverrides)

  const inventorySaveResult = await saveInventoryMovements(mergedMovements)
  const serialSaveResult = await saveSerialOverrides(mergedOverrides)

  if (salesIds.length && newMovementRecords.filter((item) => item.movementType === 'sales_outbound').length !== salesIds.length) {
    warnings.add(`销售出库本次请求 ${salesIds.length} 条种子记录，但实际落库 SN 流水未必等于零售实际订单数。当前已知历史问题是只落了 7/18 条，需要继续校准销售列表入口。`)
  }

  syncState.generatedAt = new Date().toISOString()
  syncState.warnings = [...warnings]
  await saveSyncState(syncState)
  await saveSession(session)

  return {
    sessionSource: session.source,
    files: {
      sessionFilePath: config.lenovoRetail.sessionFilePath,
      syncStateFilePath: config.lenovoRetail.syncStateFilePath,
      inventoryMovementsPath: inventorySaveResult.files.artifactPath,
      serialOverridesPath: serialSaveResult.files.artifactPath,
    },
    salesOutbound: { requested: salesIds.length, synced: newMovementRecords.filter((item) => item.movementType === 'sales_outbound').length },
    purchaseInbound: { requested: purchaseIds.length, synced: newMovementRecords.filter((item) => item.movementType === 'purchase_inbound').length },
    otherOutbound: { requested: otherIds.length, synced: newMovementRecords.filter((item) => item.movementType === 'transfer_outbound').length },
    mergedInventoryMovementCount: mergedMovements.length,
    mergedSerialOverrideCount: Object.keys(mergedOverrides).length,
    warnings: [...warnings],
  }
}
