import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'
import {
  buildQuoteDecisions,
  type DistributorQuote,
  type ExternalPlatform,
  type GrayWholesaleQuote,
  type ManualPriceOverride,
  type PriceMonitorEntry,
  type PriceSourceName,
  type QuoteDecision,
  type SourceSyncStatus,
} from './priceEngine.js'

type DistributorQuoteSnapshot = {
  generatedAt?: string
  quoteDate?: string
  quoteFile?: string
  quoteCount?: number
  summary?: {
    inventoryMatchedCount: number
    productLibraryMatchedCount: number
    unmatchedCount: number
  }
  quotes?: DistributorQuote[]
}

type GrayWholesaleSnapshot = {
  generatedAt?: string
  quotes?: GrayWholesaleQuote[]
}

type MarketplacePriceRecord = {
  source?: 'jd' | 'lenovo_official' | 'taobao_subsidy'
  productId?: string
  query?: string
  configuredUrl?: string
  matchTitle?: string
  price?: number
  preSubsidyPrice?: number
  postSubsidyPrice?: number
  couponAdjustedPrice?: number
  priceType?: string
  priceBasis?: string
  taxIncluded?: boolean
  serviceIncluded?: boolean
  confidence?: string
  collectionStatus?: string
  evidence?: {
    evidenceUrl?: string
    screenshotPath?: string
    capturedAt?: string
    capturedBy?: string
    note?: string
  }
  raw?: Record<string, unknown>
}

type MarketplacePriceSnapshot = {
  generatedAt?: string
  records?: MarketplacePriceRecord[]
}

type MarketingBoostPriceItem = {
  skuKey?: string
  validFrom?: string
  validTo?: string
  educationDiscountAmount?: number
}

type MarketingBoostSnapshotLite = {
  generatedAt?: string
  activities?: MarketingBoostPriceItem[]
  activityHistory?: MarketingBoostPriceItem[]
  eligibleInventory?: MarketingBoostPriceItem[]
}

const marketplaceFreshnessHours = 36

function isUsableMarketplaceConfidence(confidence?: string) {
  if (!confidence) return true
  return confidence === 'confirmed'
    || confidence === 'provisional'
    || confidence.startsWith('confirmed_')
}

type MarketplaceCollectionAudit = {
  confirmedCount: number
  provisionalCount: number
  manualReviewCount: number
  placeholderCount: number
  unavailableCount: number
}

export type ManualPriceOverridesSnapshot = {
  generatedAt: string
  source: 'system_manual_price_overrides'
  overrides: Record<string, ManualPriceOverride>
}

export type InventoryAdjustment = {
  currentStock?: number
  sellableStock?: number
  unsellableStock?: number
  pendingInboundStock?: number
  note?: string
  updatedAt: string
}

export type InventoryAdjustmentsSnapshot = {
  generatedAt: string
  source: 'system_inventory_adjustments'
  adjustments: Record<string, InventoryAdjustment>
}

type ProductLibraryProductsSnapshot = {
  items?: Array<{
    primary_sku_key?: string
    canonical_name?: string
  }>
}

export type InventoryMovementType = 'sales_outbound' | 'purchase_inbound' | 'transfer_inbound' | 'transfer_outbound' | 'manual_adjustment'

export type InventoryMovementRecord = {
  id: string
  skuKey: string
  quantity: number
  movementType: InventoryMovementType
  businessDate: string
  createdAt?: string
  serialNumber?: string
  documentNumber?: string
  sourceRef?: string
  sourceDocumentType?: string
  operatorName?: string
  supplierName?: string
  storeName?: string
  locationName?: string
  productName?: string
  pnMtm?: string
  spec?: string
  unitName?: string
  unitCost?: number
  amount?: number
  note?: string
  updatedAt: string
}

export type InventoryMovementsSnapshot = {
  generatedAt: string
  source: 'system_inventory_movements'
  records: InventoryMovementRecord[]
}

export type SerialOverride = {
  skuKey?: string
  inboundDate?: string
  purchaseCost?: number
  documentNumber?: string
  operatorName?: string
  supplierName?: string
  storeName?: string
  locationName?: string
  productName?: string
  pnMtm?: string
  spec?: string
  note?: string
  updatedAt: string
}

export type SerialOverridesSnapshot = {
  generatedAt: string
  source: 'system_serial_overrides'
  overrides: Record<string, SerialOverride>
}

type RetailZoneQuery = {
  search?: string
  category?: string
  riskLevel?: QuoteDecision['riskLevel']
  approval?: QuoteDecision['approval']
  limit?: number
  offset?: number
}

type PreviousRetailZoneDecision = Partial<Pick<
  QuoteDecision,
  | 'skuKey'
  | 'inventoryAverageCost'
  | 'realtimePurchasePrice'
  | 'grayWholesalePrice'
  | 'grayRetailPreSubsidyPrice'
  | 'graySubsidyPrice'
  | 'match'
>>

const platformFiles: Record<ExternalPlatform, { file: string; source: PriceSourceName; missingNote: string }> = {
  lenovoOfficial: {
    file: 'latest-lenovo-official-price-monitor.json',
    source: '联想官网',
    missingNote: '未发现 latest-lenovo-official-price-monitor.json，暂用联想订货平台和京东价辅助决策。',
  },
  jd: {
    file: 'latest-jd-price-monitor.json',
    source: '京东',
    missingNote: '未发现 latest-jd-price-monitor.json。',
  },
  taobao: {
    file: 'latest-taobao-price-monitor.json',
    source: '淘宝百亿补贴',
    missingNote: '未发现 latest-taobao-price-monitor.json，防流失价缺少淘宝低价锚点。',
  },
}

const staleStockThresholdDays = 180

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

async function readJson<T>(fileName: string): Promise<{ data?: T; mtime?: Date; filePath: string }> {
  const filePath = artifactPath(fileName)
  const [content, stat] = await Promise.all([
    fs.readFile(filePath, 'utf-8').catch(() => undefined),
    fs.stat(filePath).catch(() => undefined),
  ])
  if (!content) return { filePath }
  return { data: JSON.parse(content) as T, mtime: stat?.mtime, filePath }
}

async function loadProductLibraryCanonicalTitles() {
  const filePath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-product-library-products.json')
  const content = await fs.readFile(filePath, 'utf-8').catch(() => undefined)
  if (!content) return {}
  const snapshot = JSON.parse(content) as ProductLibraryProductsSnapshot
  return Object.fromEntries(
    (snapshot.items ?? [])
      .map((item) => [String(item.primary_sku_key ?? '').trim(), String(item.canonical_name ?? '').trim()] as const)
      .filter(([skuKey, canonicalName]) => skuKey && canonicalName),
  )
}

async function loadPreviousRetailZoneDecisionMap() {
  const snapshot = await readJson<{
    decisions?: {
      items?: PreviousRetailZoneDecision[]
    }
  }>('latest-retail-zone-snapshot.json')
  const items = snapshot.data?.decisions?.items ?? []
  return new Map(
    items
      .filter((item): item is PreviousRetailZoneDecision & { skuKey: string } => typeof item?.skuKey === 'string' && item.skuKey.trim().length > 0)
      .map((item) => [item.skuKey, item] as const),
  )
}

function normalizeMonitorMap(data: unknown): Record<string, PriceMonitorEntry> {
  if (!data || typeof data !== 'object') return {}
  if (Array.isArray(data)) {
    return Object.fromEntries(data
      .map((item) => item && typeof item === 'object' ? item as PriceMonitorEntry & { skuKey?: string; skuCode?: string; productCode?: string; pnMtm?: string } : undefined)
      .filter((item): item is PriceMonitorEntry & { skuKey?: string; skuCode?: string; productCode?: string; pnMtm?: string } => Boolean(item))
      .map((item) => [item.skuKey ?? item.skuCode ?? item.productCode ?? item.pnMtm ?? '', item])
      .filter(([key]) => key))
  }

  const rows = 'rows' in data && Array.isArray((data as { rows?: unknown[] }).rows)
    ? (data as { rows: unknown[] }).rows
    : undefined
  if (rows) return normalizeMonitorMap(rows)

  return data as Record<string, PriceMonitorEntry>
}

function toPlatformFromMarketplace(source?: MarketplacePriceRecord['source']): ExternalPlatform | undefined {
  if (source === 'jd') return 'jd'
  if (source === 'lenovo_official') return 'lenovoOfficial'
  if (source === 'taobao_subsidy') return 'taobao'
  return undefined
}

function hasUnavailableMarketplaceSignal(record: MarketplacePriceRecord) {
  if (
    record.collectionStatus === 'captured'
    && hasDirectOfficialProductUrl(record)
    && (
      record.confidence === 'confirmed'
      || record.confidence === 'provisional'
    )
    && (
      record.price !== undefined
      || record.preSubsidyPrice !== undefined
      || record.postSubsidyPrice !== undefined
      || record.couponAdjustedPrice !== undefined
    )
  ) {
    return false
  }
  return record.collectionStatus === 'unavailable'
    || /已下架|下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知|不可购买|停止销售|商品不存在/i.test(JSON.stringify(record))
}

function hasDirectOfficialProductUrl(record: MarketplacePriceRecord) {
  const url = record.evidence?.evidenceUrl ?? record.configuredUrl ?? ''
  if (record.source === 'jd') return /^https:\/\/item\.jd\.com\/\d+\.html/i.test(url)
  if (record.source === 'lenovo_official') return /^https:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(url)
  return true
}

function hasUsableVisibleFallbackPrice(record: MarketplacePriceRecord) {
  const url = record.evidence?.evidenceUrl ?? record.configuredUrl ?? ''
  const capturedBy = record.evidence?.capturedBy
  const hasPrice = (
    record.price !== undefined
    || record.preSubsidyPrice !== undefined
    || record.postSubsidyPrice !== undefined
    || record.couponAdjustedPrice !== undefined
  )
  if (!hasPrice) return false
  if (
    capturedBy !== 'manual'
    && capturedBy !== 'computer_use_chrome'
    && capturedBy !== 'user_supplied_visible_price'
  ) return false
  if (record.source === 'jd') {
    return /^https:\/\/(search\.jd\.com|lenovo1\.jd\.com)\//i.test(url)
  }
  if (record.source === 'lenovo_official') {
    return /^https:\/\/s\.lenovo\.com\.cn\/search\//i.test(url)
  }
  if (record.source === 'taobao_subsidy') {
    return /^https:\/\/(detail\.tmall\.com|item\.taobao\.com)\//i.test(url)
  }
  return false
}

function cleanRetailSearchTerm(value?: string) {
  return String(value ?? '')
    .replace(/\*/g, '')
    .replace(/\bWIN(?:DOWS)?\s*11\b/gi, '')
    .replace(/\b11C\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildRetailSearchQuery(productName?: string, spec?: string) {
  const text = cleanRetailSearchTerm(`${productName ?? ''} ${spec ?? ''}`)
  const model = text.match(/(ThinkPad|YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|战7000|GEEKPRO|AIR\s?\d{2}|PRO\s?\d{2}(?:GT)?|Y\d{4}P?|R\d{4}P?|N\d{3}[A-Z]?|TAB|Y700|天逸\d+[A-Z]?)/i)?.[0]
    ?? cleanRetailSearchTerm(productName).split(/\s+/).slice(0, 3).join(' ')
  const cpu = text.match(/(?:ULTRA\s?[579][-\s]?\d{3}[A-Z]*|I[3579][-\s]?\d{4,5}[A-Z]*|R[3579][-\s]?[A-Z]?\d{3,5}[A-Z]*|R7[-\s]?H255|13650HX|13645HX|14700HX|8945HX|骁龙\s?8\s?GEN\s?3)/i)?.[0]
  const memory = text.match(/\b(?:8|12|16|24|32|64)G(?:B)?\b/i)?.[0]
  const storage = text.match(/\b(?:128G|256G|512G|1T|2T)(?:SSD|固态)?\b/i)?.[0]
  const gpu = text.match(/RTX\s?(?:3050|4050|4060|4070|5050|5060|5070|5070TI|5080|5090)(?:-\dG)?/i)?.[0]
  const color = text.match(/(钛晶黑|碳晶黑|冰魄白|月幕白|深空灰|曜石金|灰色|白色|黑色|黑|白|银色|卷云灰|深空灰)/i)?.[0]
  return cleanRetailSearchTerm([model, cpu, memory, storage, gpu, color].filter(Boolean).join(' '))
    || cleanRetailSearchTerm(productName)
}

function getJdSearchUrl(query: string) {
  return `https://lenovo1.jd.com/?keyword=${encodeURIComponent(query)}`
}

function getLenovoSearchUrl(query: string) {
  return `https://s.lenovo.com.cn/search/?key=${encodeURIComponent(query)}&isProprietary=true&page=`
}

function getTaobaoSearchUrl(query: string) {
  return `https://s.taobao.com/search?q=${encodeURIComponent(query)}`
}

function isFreshTimestamp(value?: string) {
  if (!value) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  return (Date.now() - parsed) / 36e5 <= marketplaceFreshnessHours
}

function getFreshnessNote(value?: string) {
  if (!value) return '未记录采集时间，需尽快复核。'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return '采集时间格式异常，需尽快复核。'
  const ageHours = (Date.now() - parsed) / 36e5
  if (ageHours <= marketplaceFreshnessHours) return undefined
  return `最近一次可见采集距今约 ${Math.floor(ageHours)} 小时；前端保留固定链接和最近价展示，但每日任务仍必须重新复核。`
}

function getMarketplaceAuditState(record: MarketplacePriceRecord) {
  if (record.collectionStatus === 'unavailable') return 'unavailable' as const
  if (record.collectionStatus === 'manual_review_required') return 'manual_review' as const
  if (record.collectionStatus === 'url_configured_only' || record.confidence === 'url_configured_only') return 'placeholder' as const
  if (record.collectionStatus !== 'captured') return 'manual_review' as const
  if (!hasDirectOfficialProductUrl(record)) return 'manual_review' as const
  if (record.confidence === 'confirmed') return 'confirmed' as const
  if (record.confidence === 'provisional') return 'provisional' as const
  return 'manual_review' as const
}

function summarizeMarketplaceCollection(snapshot?: MarketplacePriceSnapshot) {
  const result: Partial<Record<ExternalPlatform, MarketplaceCollectionAudit>> = {}
  for (const record of snapshot?.records ?? []) {
    const platform = toPlatformFromMarketplace(record.source)
    if (!platform) continue
    const current = result[platform] ?? {
      confirmedCount: 0,
      provisionalCount: 0,
      manualReviewCount: 0,
      placeholderCount: 0,
      unavailableCount: 0,
    }
    const state = getMarketplaceAuditState(record)
    if (state === 'confirmed') current.confirmedCount += 1
    else if (state === 'provisional') current.provisionalCount += 1
    else if (state === 'manual_review') current.manualReviewCount += 1
    else if (state === 'placeholder') current.placeholderCount += 1
    else if (state === 'unavailable') current.unavailableCount += 1
    result[platform] = current
  }
  return result
}

function normalizeMarketplaceSnapshot(snapshot?: MarketplacePriceSnapshot): Partial<Record<ExternalPlatform, Record<string, PriceMonitorEntry>>> {
  const result: Partial<Record<ExternalPlatform, Record<string, PriceMonitorEntry>>> = {}
  for (const record of snapshot?.records ?? []) {
    const platform = toPlatformFromMarketplace(record.source)
    const productId = String(record.productId ?? '').trim()
    if (!platform || !productId) continue
    const directOfficialUrl = hasDirectOfficialProductUrl(record)
    const visibleFallbackPrice = hasUsableVisibleFallbackPrice(record)
    const capturedManualDetailPrice = record.collectionStatus === 'captured'
      && directOfficialUrl
      && (
        record.price !== undefined
        || record.preSubsidyPrice !== undefined
        || record.postSubsidyPrice !== undefined
        || record.couponAdjustedPrice !== undefined
      )
      && (
        record.confidence === 'manual'
        || record.confidence === 'manual_review_aligned'
      )
    const urlOnlyManualReview = record.collectionStatus === 'manual_review_required'
      && record.priceType === 'url_configured_only'
      && directOfficialUrl
    const urlOnlyTitleEvidence = record.collectionStatus === 'url_configured_only'
      && directOfficialUrl
      && Boolean(String(record.matchTitle ?? '').trim())
    if (hasUnavailableMarketplaceSignal(record)) continue
    if (record.collectionStatus !== 'captured' && !visibleFallbackPrice && !urlOnlyManualReview && !urlOnlyTitleEvidence) continue
    const confidence = 'confidence' in record ? (record as MarketplacePriceRecord & { confidence?: string }).confidence : undefined
    if (!visibleFallbackPrice && !urlOnlyManualReview && !urlOnlyTitleEvidence && !capturedManualDetailPrice && !isUsableMarketplaceConfidence(confidence)) continue
    if (!directOfficialUrl && !visibleFallbackPrice) continue

    const price = record.preSubsidyPrice ?? record.price
    const capturedAt = record.evidence?.capturedAt ?? snapshot?.generatedAt
    const freshnessNote = getFreshnessNote(capturedAt)
    if ((price === undefined || !Number.isFinite(price) || price <= 0) && !urlOnlyManualReview && !urlOnlyTitleEvidence) continue
    const entry: PriceMonitorEntry = {
      price,
      jdSelfPrice: platform === 'jd' ? price : undefined,
      lenovoOfficialPrice: platform === 'lenovoOfficial' ? price : undefined,
      taobaoPrice: platform === 'taobao' ? price : undefined,
      preSubsidyPrice: record.preSubsidyPrice,
      postSubsidyPrice: record.postSubsidyPrice,
      couponAdjustedPrice: record.couponAdjustedPrice,
      capturedAt,
      source: record.source,
      priceBasis: record.priceBasis,
      query: record.query,
      matchTitle: record.matchTitle,
      configuredUrl: record.configuredUrl,
      collectionStatus: record.collectionStatus as PriceMonitorEntry['collectionStatus'],
      confidence,
      evidence: [
        record.evidence?.evidenceUrl ?? record.evidence?.screenshotPath ?? record.evidence?.note,
        freshnessNote,
      ].filter(Boolean).join('；'),
      url: record.evidence?.evidenceUrl,
      raw: ('raw' in record && record.raw && typeof record.raw === 'object') ? record.raw as Record<string, unknown> : undefined,
    }

    result[platform] = {
      ...(result[platform] ?? {}),
      [productId]: entry,
    }
  }
  return result
}

function getFreshness(mtime?: Date) {
  if (!mtime) return 'missing'
  const ageHours = (Date.now() - mtime.getTime()) / 36e5
  return ageHours > marketplaceFreshnessHours ? 'stale' : 'fresh'
}

function getCapturedAtFromMonitor(map: Record<string, PriceMonitorEntry>) {
  return Object.values(map)
    .map((entry) => entry.capturedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
}

async function loadInventory() {
  const { data } = await readJson<StandardInventorySnapshot>('latest-standard-inventory-snapshot.json')
  if (!data) {
    throw new Error('缺少 artifacts/latest-standard-inventory-snapshot.json，请先运行 npm run build:snapshot。')
  }
  const isSqlBackedSnapshot = typeof data.source === 'string' && data.source.startsWith('sqlite.retail_core')
  if (isSqlBackedSnapshot) {
    const inventoryAdjustments = await loadInventoryAdjustments()
    const snapshotGeneratedAt = Date.parse(data.generatedAt)
    const freshAdjustments = Object.fromEntries(
      Object.entries(inventoryAdjustments).filter(([, value]) => {
        const updatedAt = Date.parse(value.updatedAt)
        if (Number.isNaN(snapshotGeneratedAt) || Number.isNaN(updatedAt)) return false
        return updatedAt > snapshotGeneratedAt
      }),
    )
    const inventoryAdjusted = applyInventoryAdjustments(ensureSerialStockAgeDays(data), freshAdjustments)
    const warningSet = new Set(inventoryAdjusted.dataQuality.warnings)
    warningSet.add('当前库存快照已改为 SQL 实时库存主链，跳过旧导出文件叠加推算。')
    return {
      ...inventoryAdjusted,
      generatedAt: new Date().toISOString(),
      dataQuality: {
        ...inventoryAdjusted.dataQuality,
        warnings: Array.from(warningSet),
      },
    }
  }
  const serialAdjusted = ensureSerialStockAgeDays(applySerialOverrides(data, await loadSerialOverrides()))
  const movementsAfterSourceExport = await loadMovementsAfterInventorySourceExport(data)
  const movementAdjusted = movementsAfterSourceExport.length
    ? applyInventoryMovementAdjustments(serialAdjusted, movementsAfterSourceExport)
    : serialAdjusted
  const inventoryAdjustments = await loadInventoryAdjustments()
  const snapshotGeneratedAt = Date.parse(movementAdjusted.generatedAt || data.generatedAt)
  const freshAdjustments = Object.fromEntries(
    Object.entries(inventoryAdjustments).filter(([, value]) => {
      const updatedAt = Date.parse(value.updatedAt)
      if (Number.isNaN(snapshotGeneratedAt) || Number.isNaN(updatedAt)) return false
      return updatedAt > snapshotGeneratedAt
    }),
  )
  const inventoryAdjusted = applyInventoryAdjustments(movementAdjusted, freshAdjustments)
  const warningSet = new Set(inventoryAdjusted.dataQuality.warnings)
  warningSet.add('库存详情与实时报价专区当前以智店通商品库存总表为真值；晚于库存总表导出时间的库存流水会叠加到当前库存，避免当天中途出入库漏同步。')
  return {
    ...inventoryAdjusted,
    generatedAt: new Date().toISOString(),
    dataQuality: {
      ...inventoryAdjusted.dataQuality,
      warnings: Array.from(warningSet),
    },
  }
}

function parseBusinessDate(value: string) {
  const timestamp = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(timestamp) ? timestamp : undefined
}

async function getInventorySourceExportMtime(snapshot: StandardInventorySnapshot) {
  const files = [snapshot.files.stockQuantityFile, snapshot.files.stockSnFile].filter((file): file is string => Boolean(file))
  const mtimes = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(file).catch(() => undefined)
    return stat?.mtimeMs
  }))
  const validMtimes = mtimes.filter((mtime): mtime is number => typeof mtime === 'number' && Number.isFinite(mtime))
  return validMtimes.length ? Math.max(...validMtimes) : undefined
}

async function loadMovementsAfterInventorySourceExport(snapshot: StandardInventorySnapshot) {
  const sourceMtime = await getInventorySourceExportMtime(snapshot)
  if (!sourceMtime) return []
  return (await loadInventoryMovements()).filter((record) => {
    const businessTime = parseBusinessDate(record.businessDate)
    return businessTime !== undefined && businessTime > sourceMtime
  })
}

function ensureSerialStockAgeDays(inventory: StandardInventorySnapshot): StandardInventorySnapshot {
  const skus = inventory.skus.map((sku) => ({
    ...sku,
    serials: sku.serials.map((serial) => ({
      ...serial,
      stockAgeDays: serial.stockAgeDays ?? deriveStockAgeDays(serial.inboundDate),
    })),
  }))
  return {
    ...inventory,
    skus,
  }
}

async function loadRawInventory() {
  const { data } = await readJson<StandardInventorySnapshot>('latest-standard-inventory-snapshot.json')
  if (!data) {
    throw new Error('缺少 artifacts/latest-standard-inventory-snapshot.json，请先运行 npm run build:snapshot。')
  }
  return data
}

function normalizeStockNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

function normalizeInventoryAdjustments(input: unknown): Record<string, InventoryAdjustment> {
  if (!input || typeof input !== 'object') return {}
  const rawAdjustments = 'adjustments' in input && typeof (input as { adjustments?: unknown }).adjustments === 'object'
    ? (input as { adjustments?: unknown }).adjustments
    : input
  if (!rawAdjustments || typeof rawAdjustments !== 'object') return {}

  const result: Record<string, InventoryAdjustment> = {}
  for (const [skuKey, value] of Object.entries(rawAdjustments as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const row = value as Partial<InventoryAdjustment>
    const next: InventoryAdjustment = {
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    }
    for (const field of ['currentStock', 'sellableStock', 'unsellableStock', 'pendingInboundStock'] as const) {
      const numberValue = normalizeStockNumber(row[field])
      if (numberValue !== undefined) next[field] = numberValue
    }
    if (typeof row.note === 'string' && row.note.trim()) next.note = row.note.trim()
    if (
      next.currentStock !== undefined
      || next.sellableStock !== undefined
      || next.unsellableStock !== undefined
      || next.pendingInboundStock !== undefined
      || next.note
    ) {
      result[skuKey] = next
    }
  }
  return result
}

export async function loadInventoryAdjustments() {
  const artifact = await readJson<InventoryAdjustmentsSnapshot>('latest-inventory-adjustments.json')
  return normalizeInventoryAdjustments(artifact.data)
}

function normalizeInventoryMovementType(value: unknown): InventoryMovementType | undefined {
  return value === 'sales_outbound'
    || value === 'purchase_inbound'
    || value === 'transfer_inbound'
    || value === 'transfer_outbound'
    || value === 'manual_adjustment'
    ? value
    : undefined
}

function normalizeInventoryMovements(input: unknown): InventoryMovementRecord[] {
  if (!input || typeof input !== 'object') return []
  const rawRecords = 'records' in input && Array.isArray((input as { records?: unknown[] }).records)
    ? (input as { records: unknown[] }).records
    : Array.isArray(input) ? input : []
  const result: InventoryMovementRecord[] = []
  for (const value of rawRecords) {
    if (!value || typeof value !== 'object') continue
    const row = value as Partial<InventoryMovementRecord>
    const skuKey = typeof row.skuKey === 'string' ? row.skuKey.trim() : ''
    const movementType = normalizeInventoryMovementType(row.movementType)
    const quantity = normalizeStockNumber(row.quantity)
    const businessDate = typeof row.businessDate === 'string' ? row.businessDate.trim() : ''
    if (!skuKey || !movementType || !quantity || !businessDate) continue
    result.push({
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `${skuKey}:${movementType}:${businessDate}:${result.length + 1}`,
      skuKey,
      quantity,
      movementType,
      businessDate,
      createdAt: typeof row.createdAt === 'string' && row.createdAt.trim() ? row.createdAt.trim() : undefined,
      serialNumber: typeof row.serialNumber === 'string' && row.serialNumber.trim() ? row.serialNumber.trim() : undefined,
      documentNumber: typeof row.documentNumber === 'string' && row.documentNumber.trim() ? row.documentNumber.trim() : undefined,
      sourceRef: typeof row.sourceRef === 'string' && row.sourceRef.trim() ? row.sourceRef.trim() : undefined,
      sourceDocumentType: typeof row.sourceDocumentType === 'string' && row.sourceDocumentType.trim() ? row.sourceDocumentType.trim() : undefined,
      operatorName: typeof row.operatorName === 'string' && row.operatorName.trim() ? row.operatorName.trim() : undefined,
      supplierName: typeof row.supplierName === 'string' && row.supplierName.trim() ? row.supplierName.trim() : undefined,
      storeName: typeof row.storeName === 'string' && row.storeName.trim() ? row.storeName.trim() : undefined,
      locationName: typeof row.locationName === 'string' && row.locationName.trim() ? row.locationName.trim() : undefined,
      productName: typeof row.productName === 'string' && row.productName.trim() ? row.productName.trim() : undefined,
      pnMtm: typeof row.pnMtm === 'string' && row.pnMtm.trim() ? row.pnMtm.trim() : undefined,
      spec: typeof row.spec === 'string' && row.spec.trim() ? row.spec.trim() : undefined,
      unitName: typeof row.unitName === 'string' && row.unitName.trim() ? row.unitName.trim() : undefined,
      unitCost: typeof row.unitCost === 'number' && Number.isFinite(row.unitCost) ? row.unitCost : normalizeStockNumber(row.unitCost),
      amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : normalizeStockNumber(row.amount),
      note: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : undefined,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    })
  }
  return result.sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
}

export async function loadInventoryMovements() {
  const artifact = await readJson<InventoryMovementsSnapshot>('latest-inventory-movements.json')
  return dedupeInventoryMovements(normalizeInventoryMovements(artifact.data))
}

function buildMovementDelta(records: InventoryMovementRecord[]) {
  const delta = new Map<string, number>()
  for (const record of records) {
    const sign = record.movementType === 'sales_outbound' || record.movementType === 'transfer_outbound' ? -1 : 1
    delta.set(record.skuKey, (delta.get(record.skuKey) ?? 0) + sign * record.quantity)
  }
  return delta
}

function normalizeSerialLookupKey(value: string | undefined) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function buildLogicalMovementKey(record: InventoryMovementRecord) {
  return [
    record.movementType,
    record.documentNumber ?? '',
    record.skuKey,
    normalizeSerialLookupKey(record.serialNumber),
    record.businessDate,
    record.quantity,
    record.sourceDocumentType ?? '',
    record.operatorName ?? '',
    record.locationName ?? '',
  ].join('::')
}

function dedupeInventoryMovements(records: InventoryMovementRecord[]) {
  // ── 第一阶段：按 (movementType, documentNumber/sourceRef) 去重 ───────────────
  // 同一订单号可能出现多条记录（ZDT-XS / SALEQ / SALE 导出路径不同），
  // 按 type_score 保留最优1条，避免同一 source_ref 被多次写入
  // type_score: SALE-* =3(有SN) > SALEQ-* =2(有amount) > ZDT-XS* =1 > other=0
  type Score = number
  const bySrcRef = new Map<string, [InventoryMovementRecord, Score]>()
  for (const record of records) {
    const srcRef = record.documentNumber ?? record.sourceRef ?? ''
    if (!srcRef) {
      // 无 source_ref，跳过去重（保留原样）
      continue
    }
    const id = record.id ?? ''
    let score: Score = 0
    if (id.startsWith('SALE-')) score = 3
    else if (id.startsWith('SALEQ-')) score = 2
    else if (id.startsWith('ZDT-XS')) score = 1

    const existing = bySrcRef.get(srcRef)
    if (!existing) {
      bySrcRef.set(srcRef, [record, score])
      continue
    }
    const [, existingScore] = existing
    if (score > existingScore) {
      bySrcRef.set(srcRef, [record, score])
    }
  }

  // ── 第二阶段：按 buildLogicalMovementKey 进一步去重（保底） ──────────────
  // 对无 source_ref 的记录走原有复合键逻辑
  const byLogicalKey = new Map<string, InventoryMovementRecord>()
  for (const [record, _] of bySrcRef.values()) {
    const key = buildLogicalMovementKey(record)
    const existing = byLogicalKey.get(key)
    if (!existing) {
      byLogicalKey.set(key, record)
      continue
    }
    const existingUpdatedAt = new Date(existing.updatedAt).getTime()
    const currentUpdatedAt = new Date(record.updatedAt).getTime()
    if (Number.isFinite(currentUpdatedAt) && (!Number.isFinite(existingUpdatedAt) || currentUpdatedAt >= existingUpdatedAt)) {
      byLogicalKey.set(key, record)
    }
  }
  // 加入无 source_ref 的记录（走原有逻辑）
  for (const record of records) {
    const srcRef = record.documentNumber ?? record.sourceRef ?? ''
    if (srcRef) continue // 已处理
    const key = buildLogicalMovementKey(record)
    const existing = byLogicalKey.get(key)
    if (!existing) {
      byLogicalKey.set(key, record)
      continue
    }
    const existingUpdatedAt = new Date(existing.updatedAt).getTime()
    const currentUpdatedAt = new Date(record.updatedAt).getTime()
    if (Number.isFinite(currentUpdatedAt) && (!Number.isFinite(existingUpdatedAt) || currentUpdatedAt >= existingUpdatedAt)) {
      byLogicalKey.set(key, record)
    }
  }
  return [...byLogicalKey.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
}

function buildOutboundSerialMap(records: InventoryMovementRecord[]) {
  const serialsBySku = new Map<string, Set<string>>()
  for (const record of records) {
    if (record.movementType !== 'sales_outbound' && record.movementType !== 'transfer_outbound') continue
    if (!record.serialNumber) continue
    const serials = serialsBySku.get(record.skuKey) ?? new Set<string>()
    const serialKey = normalizeSerialLookupKey(record.serialNumber)
    if (!serialKey) continue
    serials.add(serialKey)
    serialsBySku.set(record.skuKey, serials)
  }
  return serialsBySku
}

export function applyInventoryMovementAdjustments(
  inventory: StandardInventorySnapshot,
  records: InventoryMovementRecord[],
): StandardInventorySnapshot {
  if (!records.length) return inventory
  const delta = buildMovementDelta(records)
  const outboundSerialsBySku = buildOutboundSerialMap(records)
  const warningSet = new Set(inventory.dataQuality.warnings)
  warningSet.add(`已加载库存流水 ${records.length} 条，当前库存按销售出库/采购入库净变动重算。`)
  const skus = inventory.skus.map((sku) => {
    const netDelta = delta.get(sku.skuKey) ?? 0
    const outboundSerials = outboundSerialsBySku.get(sku.skuKey)
    if (!netDelta && !outboundSerials?.size) return sku
    const currentStock = Math.max(0, sku.currentStock + netDelta)
    const occupiedStock = Math.min(sku.occupiedStock, currentStock)
    const desiredSellableStock = Math.max(0, sku.sellableStock + netDelta)
    const sellableStock = Math.min(desiredSellableStock, Math.max(0, currentStock - occupiedStock))
    const unsellableStock = Math.min(sku.unsellableStock, Math.max(0, currentStock - occupiedStock - sellableStock))
    let removedSerialCount = 0
    const serials = outboundSerials?.size
      ? sku.serials.filter((serial) => {
          const shouldRemove = outboundSerials.has(normalizeSerialLookupKey(serial.serialNumber))
          if (shouldRemove) removedSerialCount += 1
          return !shouldRemove
        })
      : sku.serials
    const serialCount = serials.length
    const warnings = [
      ...sku.dataQuality.warnings,
      `已按库存流水校准：净变动 ${netDelta > 0 ? '+' : ''}${netDelta}，原现有 ${sku.currentStock} / 可售 ${sku.sellableStock} / 不可售 ${sku.unsellableStock}，现有 ${currentStock} / 可售 ${sellableStock} / 不可售 ${unsellableStock}。`,
    ]
    if (removedSerialCount) warnings.push(`已按出库流水移除 ${removedSerialCount} 个 SN，防止零售专区继续展示已出库序列号。`)
    return {
      ...sku,
      currentStock,
      sellableStock,
      occupiedStock,
      unsellableStock,
      serialCount,
      serials,
      dataQuality: {
        stockAndSerialMatched: currentStock === serialCount,
        stockQuantityDiff: currentStock - serialCount,
        warnings,
      },
    }
  })
  const totals = skus.reduce(
    (acc, item) => {
      acc.currentStock += item.currentStock
      acc.sellableStock += item.sellableStock
      acc.occupiedStock += item.occupiedStock
      acc.unsellableStock += item.unsellableStock
      acc.pendingInboundStock += item.pendingInboundStock
      acc.serialCount += item.serialCount
      if (item.currentStock === 0 && item.serialCount > 0) acc.unmatchedSerialCount += item.serialCount
      return acc
    },
    { skuCount: skus.length, currentStock: 0, sellableStock: 0, occupiedStock: 0, unsellableStock: 0, pendingInboundStock: 0, serialCount: 0, unmatchedSerialCount: 0 },
  )
  return {
    ...inventory,
    generatedAt: new Date().toISOString(),
    totals,
    categories: buildAdjustedCategorySummary(skus),
    skus,
    dataQuality: {
      ...inventory.dataQuality,
      warnings: Array.from(warningSet),
    },
  }
}

function normalizeSerialOverrides(input: unknown): Record<string, SerialOverride> {
  if (!input || typeof input !== 'object') return {}
  const rawOverrides = 'overrides' in input && typeof (input as { overrides?: unknown }).overrides === 'object'
    ? (input as { overrides?: unknown }).overrides
    : input
  if (!rawOverrides || typeof rawOverrides !== 'object') return {}
  const result: Record<string, SerialOverride> = {}
  for (const [serialNumber, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const row = value as Partial<SerialOverride>
    const next: SerialOverride = {
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    }
    if (typeof row.skuKey === 'string' && row.skuKey.trim()) next.skuKey = row.skuKey.trim()
    if (typeof row.inboundDate === 'string' && row.inboundDate.trim()) next.inboundDate = row.inboundDate.trim()
    if (typeof row.purchaseCost === 'number' && Number.isFinite(row.purchaseCost) && row.purchaseCost >= 0) next.purchaseCost = row.purchaseCost
    if (typeof row.documentNumber === 'string' && row.documentNumber.trim()) next.documentNumber = row.documentNumber.trim()
    if (typeof row.operatorName === 'string' && row.operatorName.trim()) next.operatorName = row.operatorName.trim()
    if (typeof row.supplierName === 'string' && row.supplierName.trim()) next.supplierName = row.supplierName.trim()
    if (typeof row.storeName === 'string' && row.storeName.trim()) next.storeName = row.storeName.trim()
    if (typeof row.locationName === 'string' && row.locationName.trim()) next.locationName = row.locationName.trim()
    if (typeof row.productName === 'string' && row.productName.trim()) next.productName = row.productName.trim()
    if (typeof row.pnMtm === 'string' && row.pnMtm.trim()) next.pnMtm = row.pnMtm.trim()
    if (typeof row.spec === 'string' && row.spec.trim()) next.spec = row.spec.trim()
    if (typeof row.note === 'string' && row.note.trim()) next.note = row.note.trim()
    if (
      next.skuKey
      || next.inboundDate
      || next.purchaseCost !== undefined
      || next.documentNumber
      || next.operatorName
      || next.supplierName
      || next.storeName
      || next.locationName
      || next.productName
      || next.pnMtm
      || next.spec
      || next.note
    ) result[serialNumber.trim()] = next
  }
  return result
}

function deriveSkuCostFromSerials(serials: StandardInventorySnapshot['skus'][number]['serials']) {
  const priced = serials.filter((serial) => (
    typeof serial.purchaseCost === 'number'
    && Number.isFinite(serial.purchaseCost)
    && serial.purchaseCost > 0
  ))
  if (!priced.length) return undefined
  return {
    value: Number((priced.reduce((sum, serial) => sum + Number(serial.purchaseCost), 0) / priced.length).toFixed(2)),
    pricedSerialCount: priced.length,
    serialCount: serials.length,
  }
}

export async function loadSerialOverrides() {
  const artifact = await readJson<SerialOverridesSnapshot>('latest-serial-overrides.json')
  return normalizeSerialOverrides(artifact.data)
}

export function applySerialOverrides(
  inventory: StandardInventorySnapshot,
  rawOverrides: Record<string, SerialOverride>,
): StandardInventorySnapshot {
  const overrides = normalizeSerialOverrides(rawOverrides)
  if (!Object.keys(overrides).length) return inventory
  const overridesBySku = Object.entries(overrides).reduce((map, [serialNumber, override]) => {
    if (!override.skuKey) return map
    const rows = map.get(override.skuKey) ?? []
    rows.push([serialNumber, override])
    map.set(override.skuKey, rows)
    return map
  }, new Map<string, Array<[string, SerialOverride]>>())
  const warningSet = new Set(inventory.dataQuality.warnings)
  warningSet.add(`已加载 SN 覆盖 ${Object.keys(overrides).length} 条，SN 入库时间/成本按覆盖值展示。`)
  const skus = inventory.skus.map((sku) => {
    let touched = false
    const serials = sku.serials.map((serial) => {
      const override = overrides[serial.serialNumber]
      if (!override) return serial
      touched = true
      return {
        ...serial,
        inboundDate: override.inboundDate ?? serial.inboundDate,
        purchaseCost: override.purchaseCost ?? serial.purchaseCost,
        inboundDocumentNumber: override.documentNumber ?? serial.inboundDocumentNumber,
        inboundOperatorName: override.operatorName ?? serial.inboundOperatorName,
        supplierName: override.supplierName ?? serial.supplierName,
        organizationName: override.storeName ?? serial.organizationName,
        locationName: override.locationName ?? serial.locationName,
        productName: override.productName ?? serial.productName,
        pnMtm: override.pnMtm ?? serial.pnMtm,
        spec: override.spec ?? serial.spec,
        stockAgeDays: override.inboundDate ? deriveStockAgeDays(override.inboundDate) : serial.stockAgeDays,
      }
    })
    const existingSerials = new Set(serials.map((item) => item.serialNumber))
    const maxInjectCount = Math.max((sku.currentStock ?? 0) - serials.length, 0)
    const injectedSerials = (overridesBySku.get(sku.skuKey) ?? [])
      .filter(([serialNumber]) => !existingSerials.has(serialNumber))
      .slice(0, maxInjectCount)
      .map(([serialNumber, override]) => ({
        serialNumber,
        source: 'lenovo-retail-web' as const,
        productName: override.productName ?? sku.productName,
        pnMtm: override.pnMtm ?? sku.pnMtm,
        spec: override.spec ?? sku.spec,
        productCode: sku.productCode,
        skuCode: sku.skuCode,
        organizationName: override.storeName ?? sku.organizationName,
        organizationCode: sku.organizationCode,
        inboundDate: override.inboundDate,
        purchaseCost: override.purchaseCost,
        inboundDocumentNumber: override.documentNumber,
        inboundOperatorName: override.operatorName,
        supplierName: override.supplierName,
        locationName: override.locationName,
        stockAgeDays: deriveStockAgeDays(override.inboundDate),
      }))
    if (injectedSerials.length) touched = true
    const nextSerials = injectedSerials.length ? [...serials, ...injectedSerials] : serials
    if (!touched) return sku
    const stockQuantityDiff = sku.currentStock - nextSerials.length
    const derivedSalesCost = (!sku.salesCostPrice || sku.salesCostPrice <= 0)
      ? deriveSkuCostFromSerials(nextSerials)
      : undefined
    const nextWarnings = [
      ...sku.dataQuality.warnings,
      '部分 SN 已按后台覆盖值修正入库时间或入库成本。',
      ...(injectedSerials.length ? [`已根据入库流水补入 ${injectedSerials.length} 个新增 SN。`] : []),
      ...((derivedSalesCost && derivedSalesCost.pricedSerialCount < derivedSalesCost.serialCount)
        ? [`库存进货价已按在库 SN 入库成本回灌，当前 ${derivedSalesCost.serialCount} 条 SN 中仅 ${derivedSalesCost.pricedSerialCount} 条有真实成本。`]
        : []),
    ]
    return {
      ...sku,
      salesCostPrice: (!sku.salesCostPrice || sku.salesCostPrice <= 0)
        ? (derivedSalesCost?.value ?? sku.salesCostPrice)
        : sku.salesCostPrice,
      priceSource: (!sku.salesCostPrice || sku.salesCostPrice <= 0) && derivedSalesCost
        ? `SN入库成本回灌（${derivedSalesCost.pricedSerialCount}/${derivedSalesCost.serialCount} 条在库SN有成本）`
        : sku.priceSource,
      serialCount: nextSerials.length,
      serials: nextSerials,
      dataQuality: {
        ...sku.dataQuality,
        stockAndSerialMatched: stockQuantityDiff === 0,
        stockQuantityDiff,
        warnings: nextWarnings,
      },
    }
  })
  return {
    ...inventory,
    generatedAt: new Date().toISOString(),
    totals: skus.reduce((acc, sku) => {
      acc.skuCount += 1
      acc.currentStock += sku.currentStock
      acc.sellableStock += sku.sellableStock
      acc.occupiedStock += sku.occupiedStock
      acc.unsellableStock += sku.unsellableStock
      acc.pendingInboundStock += sku.pendingInboundStock
      acc.serialCount += sku.serialCount
      acc.unmatchedSerialCount += Math.max(0, sku.currentStock - sku.serialCount)
      return acc
    }, {
      skuCount: 0,
      currentStock: 0,
      sellableStock: 0,
      occupiedStock: 0,
      unsellableStock: 0,
      pendingInboundStock: 0,
      serialCount: 0,
      unmatchedSerialCount: 0,
    }),
    skus,
    categories: buildAdjustedCategorySummary(skus),
    dataQuality: {
      ...inventory.dataQuality,
      warnings: Array.from(warningSet),
    },
  }
}

function buildAdjustedCategorySummary(skus: StandardInventorySnapshot['skus']): StandardInventorySnapshot['categories'] {
  const categoryMap = new Map<string, StandardInventorySnapshot['skus']>()
  for (const sku of skus) {
    const category = sku.category?.trim() || '未分类'
    categoryMap.set(category, [...(categoryMap.get(category) ?? []), sku])
  }
  return Array.from(categoryMap.entries())
    .map(([category, group]) => {
      const totals = group.reduce(
        (acc, sku) => {
          acc.currentStock += sku.currentStock
          acc.sellableStock += sku.sellableStock
          acc.unsellableStock += sku.unsellableStock
          acc.pendingInboundStock += sku.pendingInboundStock
          acc.serialCount += sku.serialCount
          return acc
        },
        { currentStock: 0, sellableStock: 0, unsellableStock: 0, pendingInboundStock: 0, serialCount: 0 },
      )
      return {
        category,
        skuCount: group.length,
        ...totals,
        topSkus: [...group]
          .sort((a, b) => b.currentStock - a.currentStock)
          .slice(0, 5)
          .map((sku) => ({
            skuKey: sku.skuKey,
            productName: sku.productName,
            pnMtm: sku.pnMtm,
            currentStock: sku.currentStock,
            sellableStock: sku.sellableStock,
            unsellableStock: sku.unsellableStock,
          })),
      }
    })
    .sort((a, b) => b.currentStock - a.currentStock)
}

function deriveStockAgeDays(inboundDate?: string) {
  if (!inboundDate) return undefined
  const parsed = new Date(inboundDate)
  if (Number.isNaN(parsed.getTime())) return undefined
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000))
}

export function applyInventoryAdjustments(
  inventory: StandardInventorySnapshot,
  rawAdjustments: Record<string, InventoryAdjustment>,
): StandardInventorySnapshot {
  const adjustments = normalizeInventoryAdjustments(rawAdjustments)
  if (!Object.keys(adjustments).length) return inventory

  const skus = inventory.skus.map((sku) => {
    const adjustment = adjustments[sku.skuKey]
    if (!adjustment) return sku
    const currentStock = adjustment.currentStock ?? sku.currentStock
    const sellableStock = adjustment.sellableStock ?? sku.sellableStock
    const unsellableStock = adjustment.unsellableStock ?? sku.unsellableStock
    const pendingInboundStock = adjustment.pendingInboundStock ?? sku.pendingInboundStock
    const serials = currentStock < sku.serials.length ? sku.serials.slice(0, currentStock) : sku.serials
    const serialCount = serials.length
    const warnings = [
      ...sku.dataQuality.warnings,
      `后台库存已校准：原现有 ${sku.currentStock} / 可售 ${sku.sellableStock} / 不可售 ${sku.unsellableStock}，现有 ${currentStock} / 可售 ${sellableStock} / 不可售 ${unsellableStock}${adjustment.note ? `；${adjustment.note}` : ''}`,
    ]
    if (serialCount !== sku.serialCount) warnings.push(`库存校准已将展示 SN 数从 ${sku.serialCount} 调整为 ${serialCount}，待人工确认实际留存序列号。`)
    return {
      ...sku,
      currentStock,
      sellableStock,
      unsellableStock,
      pendingInboundStock,
      serialCount,
      serials,
      dataQuality: {
        stockAndSerialMatched: currentStock === serialCount,
        stockQuantityDiff: currentStock - serialCount,
        warnings,
      },
    }
  })

  const totals = skus.reduce(
    (acc, item) => {
      acc.currentStock += item.currentStock
      acc.sellableStock += item.sellableStock
      acc.occupiedStock += item.occupiedStock
      acc.unsellableStock += item.unsellableStock
      acc.pendingInboundStock += item.pendingInboundStock
      acc.serialCount += item.serialCount
      if (item.currentStock === 0 && item.serialCount > 0) acc.unmatchedSerialCount += item.serialCount
      return acc
    },
    { skuCount: skus.length, currentStock: 0, sellableStock: 0, occupiedStock: 0, unsellableStock: 0, pendingInboundStock: 0, serialCount: 0, unmatchedSerialCount: 0 },
  )
  const warningSet = new Set(inventory.dataQuality.warnings)
  warningSet.add(`已加载后台库存校准 ${Object.keys(adjustments).length} 个 SKU，报价和库存页面按校准后库存展示。`)
  for (const sku of skus) {
    for (const warning of sku.dataQuality.warnings) warningSet.add(warning)
  }
  return {
    ...inventory,
    generatedAt: new Date().toISOString(),
    totals,
    categories: buildAdjustedCategorySummary(skus),
    skus,
    dataQuality: {
      ...inventory.dataQuality,
      warnings: Array.from(warningSet),
    },
  }
}

export async function getAdjustedInventorySnapshot() {
  return loadInventory()
}

export async function saveAdjustedInventorySnapshot() {
  const snapshot = await getAdjustedInventorySnapshot()
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-adjusted-inventory-snapshot.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-adjusted-inventory-snapshot.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  return { snapshot, artifactPath, webPath }
}

export async function saveInventoryAdjustments(adjustments: Record<string, InventoryAdjustment>) {
  const snapshot: InventoryAdjustmentsSnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'system_inventory_adjustments',
    adjustments: normalizeInventoryAdjustments(adjustments),
  }
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-inventory-adjustments.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-inventory-adjustments.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  const inventory = await saveAdjustedInventorySnapshot()
  const retailZone = await saveRetailZoneSnapshot()
  return {
    snapshot,
    inventory: inventory.snapshot,
    retailZone: retailZone.snapshot,
    files: {
      artifactPath,
      webPath,
      inventoryArtifactPath: inventory.artifactPath,
      inventoryWebPath: inventory.webPath,
      retailZoneArtifactPath: retailZone.artifactPath,
      retailZoneWebPath: retailZone.webPath,
    },
  }
}

export async function saveInventoryMovements(records: InventoryMovementRecord[]) {
  const snapshot: InventoryMovementsSnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'system_inventory_movements',
    records: dedupeInventoryMovements(normalizeInventoryMovements(records)),
  }
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-inventory-movements.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-inventory-movements.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  const inventory = await saveAdjustedInventorySnapshot()
  const retailZone = await saveRetailZoneSnapshot()
  return {
    snapshot,
    inventory: inventory.snapshot,
    retailZone: retailZone.snapshot,
    files: {
      artifactPath,
      webPath,
      inventoryArtifactPath: inventory.artifactPath,
      inventoryWebPath: inventory.webPath,
      retailZoneArtifactPath: retailZone.artifactPath,
      retailZoneWebPath: retailZone.webPath,
    },
  }
}

export async function saveSerialOverrides(overrides: Record<string, SerialOverride>) {
  const snapshot: SerialOverridesSnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'system_serial_overrides',
    overrides: normalizeSerialOverrides(overrides),
  }
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-serial-overrides.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-serial-overrides.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  const inventory = await saveAdjustedInventorySnapshot()
  const retailZone = await saveRetailZoneSnapshot()
  return {
    snapshot,
    inventory: inventory.snapshot,
    retailZone: retailZone.snapshot,
    files: {
      artifactPath,
      webPath,
      inventoryArtifactPath: inventory.artifactPath,
      inventoryWebPath: inventory.webPath,
      retailZoneArtifactPath: retailZone.artifactPath,
      retailZoneWebPath: retailZone.webPath,
    },
  }
}

function normalizeManualPriceOverrides(input: unknown): Record<string, ManualPriceOverride> {
  if (!input || typeof input !== 'object') return {}
  const rawOverrides = 'overrides' in input && typeof (input as { overrides?: unknown }).overrides === 'object'
    ? (input as { overrides?: unknown }).overrides
    : input
  if (!rawOverrides || typeof rawOverrides !== 'object') return {}

  const result: Record<string, ManualPriceOverride> = {}
  for (const [skuKey, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const row = value as Partial<ManualPriceOverride>
    const next: ManualPriceOverride = {
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    }
    for (const field of ['realtimePurchasePrice', 'marketWholesalePrice', 'retailPreSubsidyPrice', 'defensivePostSubsidyPrice'] as const) {
      const numberValue = row[field]
      if (typeof numberValue === 'number' && Number.isFinite(numberValue) && numberValue >= 0) {
        next[field] = numberValue
      }
    }
    if (
      next.realtimePurchasePrice !== undefined
      || next.marketWholesalePrice !== undefined
      || next.retailPreSubsidyPrice !== undefined
      || next.defensivePostSubsidyPrice !== undefined
    ) {
      result[skuKey] = next
    }
  }
  return result
}

export async function loadManualPriceOverrides() {
  const artifact = await readJson<ManualPriceOverridesSnapshot>('latest-manual-price-overrides.json')
  return {
    overrides: normalizeManualPriceOverrides(artifact.data),
    mtime: artifact.mtime,
  }
}

export async function saveManualPriceOverrides(overrides: Record<string, ManualPriceOverride>) {
  const snapshot: ManualPriceOverridesSnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'system_manual_price_overrides',
    overrides: normalizeManualPriceOverrides(overrides),
  }
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-manual-price-overrides.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-manual-price-overrides.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  const retailZone = await saveRetailZoneSnapshot()
  return {
    snapshot,
    retailZone: retailZone.snapshot,
    files: {
      artifactPath,
      webPath,
      retailZoneArtifactPath: retailZone.artifactPath,
      retailZoneWebPath: retailZone.webPath,
    },
  }
}

async function loadPriceMonitor(platform: ExternalPlatform) {
  const meta = platformFiles[platform]
  const { data, mtime } = await readJson<unknown>(meta.file)
  const map = normalizeMonitorMap(data)
  const itemCount = Object.keys(map).length
  const status = itemCount ? getFreshness(mtime) : 'missing'
  const sourceStatus: SourceSyncStatus = {
    source: meta.source,
    status,
    capturedAt: getCapturedAtFromMonitor(map) ?? mtime?.toISOString(),
    itemCount,
    note: itemCount ? `${meta.file} 已加载 ${itemCount} 条。` : meta.missingNote,
  }
  return { map, sourceStatus }
}

function getTodayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isActiveMarketingPriceItem(item: MarketingBoostPriceItem, today: string) {
  const validFrom = String(item.validFrom ?? '')
  const validTo = String(item.validTo ?? '')
  if (validFrom && today < validFrom) return false
  if (validTo && today > validTo) return false
  return true
}

async function loadEducationSubsidies() {
  const { data } = await readJson<MarketingBoostSnapshotLite>('latest-marketing-boost-snapshot.json')
  const today = getTodayDateString()
  const subsidies: Record<string, number> = {}
  const items = [
    ...(data?.eligibleInventory ?? []),
    ...(data?.activities ?? []),
    ...(data?.activityHistory ?? []),
  ]
  for (const item of items) {
    const skuKey = String(item.skuKey ?? '').trim()
    const amount = Number(item.educationDiscountAmount ?? 0)
    if (!skuKey || !Number.isFinite(amount) || amount <= 0) continue
    if (!isActiveMarketingPriceItem(item, today)) continue
    subsidies[skuKey] = Math.max(subsidies[skuKey] ?? 0, amount)
  }
  return subsidies
}

async function loadInputs() {
  const [
    inventory,
    distributorSnapshot,
    graySnapshot,
    marketplaceSnapshot,
    manualOverrides,
    lenovoOfficial,
    jd,
    taobao,
    educationSubsidies,
  ] = await Promise.all([
    loadInventory(),
    readJson<DistributorQuoteSnapshot>('latest-distributor-quotes.json'),
    readJson<GrayWholesaleSnapshot>('latest-gray-wholesale-quotes.json'),
    readJson<MarketplacePriceSnapshot>('latest-marketplace-price-snapshot.json'),
    loadManualPriceOverrides(),
    loadPriceMonitor('lenovoOfficial'),
    loadPriceMonitor('jd'),
    loadPriceMonitor('taobao'),
    loadEducationSubsidies(),
  ])

  const distributorQuotes = distributorSnapshot.data?.quotes ?? []
  const grayWholesaleQuotes = graySnapshot.data?.quotes ?? []
  const marketplaceMonitors = normalizeMarketplaceSnapshot(marketplaceSnapshot.data)
  const marketplaceAudit = summarizeMarketplaceCollection(marketplaceSnapshot.data)
  const mergeMonitor = (platform: ExternalPlatform, legacyMap: Record<string, PriceMonitorEntry>) => ({
    ...(platform === 'jd' ? {} : legacyMap),
    ...(marketplaceMonitors[platform] ?? {}),
  })
  const marketplaceCounts = {
    lenovoOfficial: Object.keys(marketplaceMonitors.lenovoOfficial ?? {}).length,
    jd: Object.keys(marketplaceMonitors.jd ?? {}).length,
    taobao: Object.keys(marketplaceMonitors.taobao ?? {}).length,
  }
  const withMarketplaceStatus = (platform: ExternalPlatform, current: SourceSyncStatus): SourceSyncStatus => {
    const count = marketplaceCounts[platform]
    const audit = marketplaceAudit[platform]
    const usableCount = (audit?.confirmedCount ?? 0) + (audit?.provisionalCount ?? 0)
    if (!count && !audit) return current
    const noteParts = [
      audit?.confirmedCount ? `${audit.confirmedCount} 条已确认` : undefined,
      audit?.provisionalCount ? `${audit.provisionalCount} 条待复核` : undefined,
      audit?.manualReviewCount ? `${audit.manualReviewCount} 条人工线索` : undefined,
      audit?.placeholderCount ? `${audit.placeholderCount} 条仅入口` : undefined,
      audit?.unavailableCount ? `${audit.unavailableCount} 条不可用` : undefined,
    ].filter(Boolean)
    return {
      ...current,
      status: getFreshness(marketplaceSnapshot.mtime),
      capturedAt: marketplaceSnapshot.data?.generatedAt ?? marketplaceSnapshot.mtime?.toISOString(),
      itemCount: usableCount || count || current.itemCount,
      note: `来自 latest-marketplace-price-snapshot.json：${noteParts.join('；') || `${count || current.itemCount} 条可用记录`}。${current.itemCount ? ` ${current.note}` : ' 无独立监控文件。'}`,
    }
  }
  const sourceStatus: SourceSyncStatus[] = [
    {
      source: '库存进货价',
      status: 'fresh',
      capturedAt: inventory.generatedAt,
      itemCount: inventory.skus.length,
      note: '来自标准库存快照 salesCostPrice。',
    },
    {
      source: '实时进货价',
      status: distributorQuotes.length ? getFreshness(distributorSnapshot.mtime) : 'missing',
      capturedAt: distributorSnapshot.data?.generatedAt ?? distributorSnapshot.mtime?.toISOString(),
      itemCount: distributorQuotes.length,
      note: distributorQuotes.length ? '来自分销商日报价。' : '未发现 latest-distributor-quotes.json。',
    },
    {
      source: '灰渠批发价',
      status: grayWholesaleQuotes.length ? getFreshness(graySnapshot.mtime) : 'missing',
      capturedAt: graySnapshot.data?.generatedAt ?? graySnapshot.mtime?.toISOString(),
      itemCount: grayWholesaleQuotes.length,
      note: grayWholesaleQuotes.length ? '来自灰渠公众号报价。' : '未发现 latest-gray-wholesale-quotes.json。',
    },
    withMarketplaceStatus('lenovoOfficial', lenovoOfficial.sourceStatus),
    withMarketplaceStatus('jd', jd.sourceStatus),
    withMarketplaceStatus('taobao', taobao.sourceStatus),
  ]
  const canonicalTitles = await loadProductLibraryCanonicalTitles()

  return {
    inventory,
    distributorQuotes,
    grayWholesaleQuotes,
    priceMonitors: {
      lenovoOfficial: mergeMonitor('lenovoOfficial', lenovoOfficial.map),
      jd: mergeMonitor('jd', jd.map),
      taobao: mergeMonitor('taobao', taobao.map),
    },
    manualPriceOverrides: manualOverrides.overrides,
    educationSubsidies,
    canonicalTitles,
    sourceStatus,
  }
}

function getPreferredDecisionUrl(entry: PriceMonitorEntry | undefined, fallback: string) {
  const url = entry?.url
  return url && /^https?:\/\//i.test(url) ? url : fallback
}

function applyQuery(items: QuoteDecision[], query: RetailZoneQuery) {
  const search = query.search?.trim().toLowerCase()
  let result = items
  if (search) {
    result = result.filter((item) => `${item.skuKey} ${item.productName} ${item.pnMtm ?? ''}`.toLowerCase().includes(search))
  }
  if (query.category) result = result.filter((item) => item.category === query.category)
  if (query.riskLevel) result = result.filter((item) => item.riskLevel === query.riskLevel)
  if (query.approval) result = result.filter((item) => item.approval === query.approval)

  const offset = Math.max(query.offset ?? 0, 0)
  const limit = Math.max(Math.min(query.limit ?? 100, 500), 1)
  return {
    total: result.length,
    offset,
    limit,
    items: result.slice(offset, offset + limit),
  }
}

function buildSummary(
  inventory: StandardInventorySnapshot,
  quoteDecisions: QuoteDecision[],
  sourceStatus: SourceSyncStatus[],
  generatedAt: string,
) {
  const approvalCount = quoteDecisions.filter((item) => item.approval !== '销售可用').length
  const highRiskCount = quoteDecisions.filter((item) => item.riskLevel === '高').length
  const missingSources = sourceStatus.filter((item) => item.status === 'missing').map((item) => item.source)
  const pricedSkuCount = quoteDecisions.filter((item) => item.regularChannelSubsidyPrice || item.defensiveLowSubsidyPrice).length
  const regularMargins = quoteDecisions
    .map((item) => item.expectedRegularMargin)
    .filter((value): value is number => typeof value === 'number')
  const staleSerials = inventory.skus.flatMap((sku) => sku.serials
    .filter((serial) => (serial.stockAgeDays ?? -1) >= staleStockThresholdDays)
    .map((serial) => ({ sku, serial })))
  const staleSkuCount = new Set(staleSerials.map((item) => item.sku.skuKey)).size

  return {
    generatedAt,
    storeName: inventory.storeName,
    organizationCode: inventory.organizationCode,
    totals: inventory.totals,
    categories: inventory.categories,
    metrics: [
      { key: 'skuCount', label: 'SKU 数', value: inventory.totals.skuCount, note: `${inventory.totals.sellableStock} 件可售` },
      { key: 'serialCount', label: 'SN 数', value: inventory.totals.serialCount, note: `${inventory.totals.unmatchedSerialCount} 个未匹配` },
      { key: 'staleSerialCount', label: '超期库存', value: staleSerials.length, note: `${staleSkuCount} 个 SKU 达到 ${staleStockThresholdDays} 天` },
      { key: 'pricedSkuCount', label: '已出价 SKU', value: pricedSkuCount, note: `${quoteDecisions.length} 个库存 SKU 参与价格引擎` },
      { key: 'approvalCount', label: '需审批', value: approvalCount, note: `${highRiskCount} 个高风险` },
      {
        key: 'avgRegularMargin',
        label: '正规价平均毛利',
        value: regularMargins.length ? Math.round(regularMargins.reduce((sum, value) => sum + value, 0) / regularMargins.length) : 0,
        note: '按正规厂家渠道国补价测算',
      },
    ],
    dataQuality: inventory.dataQuality,
    sourceStatus,
    risks: [
      ...inventory.dataQuality.warnings.map((warning) => ({ title: '库存数据质量', body: warning })),
      ...(staleSerials.length ? [{ title: '陈旧库存提醒', body: `共有 ${staleSerials.length} 台 SN 库龄达到 ${staleStockThresholdDays} 天，建议店面优先销售并纳入定时提醒。` }] : []),
      ...(missingSources.length ? [{ title: '价格源缺失', body: `${missingSources.join('、')} 暂无本地监控文件，相关价格需人工复核。` }] : []),
      ...(highRiskCount ? [{ title: '高风险报价', body: `${highRiskCount} 个 SKU 触发老板审批，销售不可直接使用防流失价。` }] : []),
    ],
  }
}

export async function getInventoryQuoteData() {
  const input = await loadInputs()
  const previousDecisionMap = await loadPreviousRetailZoneDecisionMap()
  const priceResult = buildQuoteDecisions(input)
  const inventoryBySku = new Map(input.inventory.skus.map((sku) => [sku.skuKey, sku]))
  const quoteDecisions = priceResult.quoteDecisions.map((item) => {
    const sku = inventoryBySku.get(item.skuKey)
    const previous = previousDecisionMap.get(item.skuKey)
    const query = buildRetailSearchQuery(sku?.productName ?? item.productName, sku?.spec)
    const jdEntry = input.priceMonitors.jd?.[item.skuKey]
      ?? (sku?.skuCode ? input.priceMonitors.jd?.[sku.skuCode] : undefined)
      ?? (sku?.productCode ? input.priceMonitors.jd?.[sku.productCode] : undefined)
      ?? (sku?.pnMtm ? input.priceMonitors.jd?.[sku.pnMtm] : undefined)
    const lenovoEntry = input.priceMonitors.lenovoOfficial?.[item.skuKey]
      ?? (sku?.skuCode ? input.priceMonitors.lenovoOfficial?.[sku.skuCode] : undefined)
      ?? (sku?.productCode ? input.priceMonitors.lenovoOfficial?.[sku.productCode] : undefined)
      ?? (sku?.pnMtm ? input.priceMonitors.lenovoOfficial?.[sku.pnMtm] : undefined)
    const taobaoEntry = input.priceMonitors.taobao?.[item.skuKey]
      ?? (sku?.skuCode ? input.priceMonitors.taobao?.[sku.skuCode] : undefined)
      ?? (sku?.productCode ? input.priceMonitors.taobao?.[sku.productCode] : undefined)
      ?? (sku?.pnMtm ? input.priceMonitors.taobao?.[sku.pnMtm] : undefined)
    return {
      ...item,
      inventoryAverageCost: item.inventoryAverageCost ?? previous?.inventoryAverageCost,
      realtimePurchasePrice: item.realtimePurchasePrice ?? previous?.realtimePurchasePrice,
      grayWholesalePrice: item.grayWholesalePrice ?? previous?.grayWholesalePrice,
      grayRetailPreSubsidyPrice: item.grayRetailPreSubsidyPrice ?? previous?.grayRetailPreSubsidyPrice,
      graySubsidyPrice: item.graySubsidyPrice ?? previous?.graySubsidyPrice,
      match: {
        realtimePurchasePrice: item.match.realtimePurchasePrice ?? previous?.match?.realtimePurchasePrice,
        grayWholesalePrice: item.match.grayWholesalePrice ?? previous?.match?.grayWholesalePrice,
      },
      jdUrl: getPreferredDecisionUrl(jdEntry, getJdSearchUrl(query)),
      lenovoUrl: getPreferredDecisionUrl(lenovoEntry, getLenovoSearchUrl(query)),
      tmallUrl: getPreferredDecisionUrl(taobaoEntry, getTaobaoSearchUrl(query)),
    }
  })
  const summary = buildSummary(input.inventory, quoteDecisions, priceResult.sourceStatus, priceResult.generatedAt)

  return {
    ...priceResult,
    quoteDecisions,
    inventory: input.inventory,
    summary,
  }
}

export async function getInventoryQuoteSummary() {
  const data = await getInventoryQuoteData()
  return data.summary
}

export async function getInventoryQuoteSerials(query: RetailZoneQuery) {
  const data = await getInventoryQuoteData()
  const decisionBySku = new Map(data.quoteDecisions.map((item) => [item.skuKey, item]))
  const rows = data.inventory.skus.flatMap((sku) => {
    const decision = decisionBySku.get(sku.skuKey)
    return sku.serials.map((serial) => ({
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      category: sku.category,
      serialNumber: serial.serialNumber,
      inboundDate: serial.inboundDate,
      purchaseCost: serial.purchaseCost,
      stockAgeDays: serial.stockAgeDays,
      warrantyStart: serial.warrantyStart,
      warrantyEnd: serial.warrantyEnd,
      organizationName: serial.organizationName,
      organizationCode: serial.organizationCode,
      regularChannelSubsidyPrice: decision?.regularChannelSubsidyPrice,
      defensiveLowSubsidyPrice: decision?.defensiveLowSubsidyPrice,
      approval: decision?.approval,
      riskLevel: decision?.riskLevel,
    }))
  })
  const search = query.search?.trim().toLowerCase()
  const filtered = search
    ? rows.filter((item) => `${item.serialNumber} ${item.skuKey} ${item.productName} ${item.pnMtm ?? ''}`.toLowerCase().includes(search))
    : rows
  const offset = Math.max(query.offset ?? 0, 0)
  const limit = Math.max(Math.min(query.limit ?? 100, 500), 1)
  return {
    generatedAt: data.generatedAt,
    total: filtered.length,
    offset,
    limit,
    items: filtered.slice(offset, offset + limit),
  }
}

export async function getInventoryQuotePrices(query: RetailZoneQuery) {
  const data = await getInventoryQuoteData()
  return {
    generatedAt: data.generatedAt,
    subsidyRule: data.subsidyRule,
    sourceStatus: data.sourceStatus,
    decisions: applyQuery(data.quoteDecisions, query),
    priceSources: data.priceSources,
  }
}

export async function getInventoryQuoteRetailZone(query: RetailZoneQuery) {
  const data = await getInventoryQuoteData()
  return {
    generatedAt: data.generatedAt,
    summary: data.summary,
    subsidyRule: data.subsidyRule,
    sourceStatus: data.sourceStatus,
    categories: data.inventory.categories,
    decisions: applyQuery(data.quoteDecisions, query),
  }
}

export async function saveRetailZoneSnapshot() {
  const snapshot = await getInventoryQuoteRetailZone({ limit: 500 })
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-retail-zone-snapshot.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-retail-zone-snapshot.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  return { snapshot, artifactPath, webPath }
}
