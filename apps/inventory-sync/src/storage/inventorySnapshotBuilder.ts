import nodeFs from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { DatabaseSync } from 'node:sqlite'

// Lazy canonical_name cache loaded from SQLite product_master
let _canonicalNameCache: Map<string, string> | null = null

function getRetailCoreDbPath(): string {
  const appDir = path.resolve(config.appDir, '..')
  return path.resolve(appDir, 'api-server', 'data', 'retail-core.sqlite3')
}

function loadCanonicalNameCache(): Map<string, string> {
  if (_canonicalNameCache) return _canonicalNameCache
  const dbPath = getRetailCoreDbPath()
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    _canonicalNameCache = new Map()
    return _canonicalNameCache
  }
  const rows = db.prepare("SELECT id, canonical_name FROM product_master WHERE canonical_name IS NOT NULL AND canonical_name != ''").all() as { id: string; canonical_name: string }[]
  db.close()
  _canonicalNameCache = new Map(rows.map(r => [r.id.replace('PROD-', ''), r.canonical_name]))
  return _canonicalNameCache
}

function getCanonicalName(skuKey: string): string | undefined {
  return loadCanonicalNameCache().get(skuKey)
}
import type {
  LenovoRetailSerialItem,
  LenovoRetailStockSummaryItem,
  StandardInventorySerial,
  StandardInventorySnapshot,
  StandardInventorySku,
} from '../types.js'
import {
  findLatestStockQuantityExport,
  findLatestStockSnExport,
  parseStockQuantityExport,
  parseStockSnExport,
} from './excelInventoryParser.js'

type SerialOverride = {
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
}

function getSkuKey(input: { skuCode?: string; productCode?: string; pnMtm?: string; productName?: string }) {
  return input.skuCode || input.productCode || input.pnMtm || input.productName || 'UNKNOWN'
}

type CatalogClassification = {
  category: string
  jdSubcategory: string
  catalogSource?: string
}

type TabletAccessoryClassificationInput = {
  productName: string
  category?: string
  pnMtm?: string
  sourceCategory?: string
  priceHint?: number
}

type LenovoStockPriceRow = {
  skuCode?: string
  productCode?: string
  pnMtm?: string
  stockWarningLevel?: string
  agentPriceText?: string
  salesCostPriceText?: string
}

type LenovoStockPriceIndex = Map<string, LenovoStockPriceRow>
type DistributorQuoteFallback = {
  pnMtm?: string
  pickupPrice?: number
  quoteDate?: string
  sourceFile?: string
}
type DistributorQuoteFallbackIndex = Map<string, DistributorQuoteFallback>
type ManualCategoryOverride = {
  skuKey?: string
  pnMtm?: string
  productName?: string
  category: string
  jdSubcategory: string
  catalogSource?: string
  note?: string
}

type ManualCategoryOverrideIndex = Map<string, ManualCategoryOverride>

const manualCategoryOverrideFileName = 'latest-manual-category-overrides.json'

function parseCurrency(value?: string) {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '')
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalNumber(value?: string) {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '')
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isTabletContextText(text: string) {
  return /平板|\bTAB\b|\bPAD\b|(?<![0-9A-Z])TB\d+|(?:拯救者\s*)?Y700(?!0)|Y900/i.test(text)
}

function hasTabletAccessoryKeyword(text: string) {
  return /配件|键盘|磁吸键盘|手写笔|触控笔|触控手写笔|保护套|保护壳|保护夹|钢化膜|贴膜|支架|底座|散热壳|妙想键盘|笔尖|套装/i.test(text)
}

function isTabletAccessoryUnder500(item: TabletAccessoryClassificationInput) {
  const text = `${item.category ?? ''} ${item.sourceCategory ?? ''} ${item.productName} ${item.pnMtm ?? ''}`.toUpperCase()
  if (!isTabletContextText(text)) return false
  if (!hasTabletAccessoryKeyword(text)) return false
  if (typeof item.priceHint !== 'number' || !Number.isFinite(item.priceHint) || item.priceHint <= 0) return true
  return item.priceHint < 1000
}

async function loadSerialOverrides() {
  const filePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-serial-overrides.json')
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  if (!content) return {} as Record<string, SerialOverride>
  const parsed = JSON.parse(content) as unknown
  if (parsed && typeof parsed === 'object' && 'overrides' in parsed) {
    const overrides = (parsed as { overrides?: Record<string, SerialOverride> }).overrides
    return overrides ?? {}
  }
  return (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, SerialOverride>
}

function mergeSerialOverrides(
  serialItems: LenovoRetailSerialItem[],
  overrides: Record<string, SerialOverride>,
  stockSummaryItems: LenovoRetailStockSummaryItem[],
): LenovoRetailSerialItem[] {
  if (!Object.keys(overrides).length) return serialItems

  const stockBySku = new Map(stockSummaryItems.map((item) => [getSkuKey(item), item.currentStock]))
  const merged = serialItems.map((item) => {
    const override = overrides[item.serialNumber]
    if (!override) return item
    return {
      ...item,
      productName: override.productName ?? item.productName,
      mtm: override.pnMtm ?? item.mtm,
      serialNumber: item.serialNumber,
      inboundDate: override.inboundDate ?? item.inboundDate,
      purchaseCost: override.purchaseCost ?? item.purchaseCost,
      storeName: override.storeName ?? item.storeName,
      locationName: override.locationName ?? item.locationName,
      raw: {
        ...item.raw,
        spec: override.spec ?? item.raw.spec,
        inboundDocumentNumber: override.documentNumber ?? item.raw.inboundDocumentNumber,
        inboundOperatorName: override.operatorName ?? item.raw.inboundOperatorName,
        supplierName: override.supplierName ?? item.raw.supplierName,
        locationName: override.locationName ?? item.raw.locationName,
      },
    } satisfies LenovoRetailSerialItem
  })

  const existingSerials = new Set(merged.map((item) => item.serialNumber))
  const existingCountBySku = new Map<string, number>()
  for (const item of merged) {
    const skuKey = getSkuKey(item)
    existingCountBySku.set(skuKey, (existingCountBySku.get(skuKey) ?? 0) + 1)
  }
  for (const [serialNumber, override] of Object.entries(overrides)) {
    if (existingSerials.has(serialNumber) || !override.skuKey) continue
    const stockLimit = stockBySku.get(override.skuKey)
    const currentCount = existingCountBySku.get(override.skuKey) ?? 0
    if (typeof stockLimit === 'number' && currentCount >= stockLimit) continue
    merged.push({
      source: 'lenovo-retail-web',
      storeName: override.storeName,
      locationName: override.locationName,
      locationType: 'store',
      skuCode: override.skuKey,
      productName: override.productName ?? override.skuKey,
      mtm: override.pnMtm,
      serialNumber,
      inboundDate: override.inboundDate,
      purchaseCost: override.purchaseCost,
      raw: {
        spec: override.spec,
        inboundDocumentNumber: override.documentNumber,
        inboundOperatorName: override.operatorName,
        supplierName: override.supplierName,
        locationName: override.locationName,
      },
    })
    existingCountBySku.set(override.skuKey, currentCount + 1)
  }
  return merged
}

function getPriceIndexKey(input: { skuCode?: string; productCode?: string; pnMtm?: string }) {
  return input.skuCode || input.productCode || input.pnMtm || ''
}

async function loadLatestStockPriceIndex(): Promise<LenovoStockPriceIndex> {
  const filePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-lenovo-stock-table-with-prices.json')
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  if (!content) return new Map()

  const parsed = JSON.parse(content) as { rows?: LenovoStockPriceRow[] }
  const rows = parsed.rows ?? []
  const index: LenovoStockPriceIndex = new Map()
  for (const row of rows) {
    const key = getPriceIndexKey(row)
    if (key) index.set(key, row)
  }
  return index
}

async function loadDistributorQuoteFallbackIndex(): Promise<DistributorQuoteFallbackIndex> {
  const filePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-distributor-quotes.json')
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  if (!content) return new Map()

  const parsed = JSON.parse(content) as { quotes?: DistributorQuoteFallback[] }
  const index: DistributorQuoteFallbackIndex = new Map()
  for (const quote of parsed.quotes ?? []) {
    const pn = String(quote.pnMtm ?? '').trim().toUpperCase()
    const price = quote.pickupPrice
    if (!pn || !price || !Number.isFinite(price) || price <= 0) continue
    const current = index.get(pn)
    if (!current) {
      index.set(pn, quote)
      continue
    }
    const currentDate = String(current.quoteDate ?? '')
    const nextDate = String(quote.quoteDate ?? '')
    if (nextDate >= currentDate) index.set(pn, quote)
  }
  return index
}

function buildManualCategoryOverrideLookupKey(kind: 'sku' | 'pn' | 'name', value?: string) {
  const normalized = value?.trim()
  return normalized ? `${kind}:${normalized}` : ''
}

function loadManualCategoryOverrideIndex(): ManualCategoryOverrideIndex {
  const filePath = path.resolve(config.lenovoRetail.artifactDir, manualCategoryOverrideFileName)
  const content = nodeFs.existsSync(filePath) ? nodeFs.readFileSync(filePath, 'utf-8') : ''
  if (!content) return new Map()

  const parsed = JSON.parse(content) as { overrides?: Record<string, ManualCategoryOverride> }
  const overrides = parsed.overrides ?? {}
  const index: ManualCategoryOverrideIndex = new Map()

  for (const [recordKey, override] of Object.entries(overrides)) {
    if (!override || typeof override !== 'object') continue
    const normalizedOverride: ManualCategoryOverride = {
      ...override,
      skuKey: override.skuKey?.trim() || recordKey.trim() || undefined,
      pnMtm: override.pnMtm?.trim() || undefined,
      productName: override.productName?.trim() || undefined,
      category: String(override.category ?? '').trim(),
      jdSubcategory: String(override.jdSubcategory ?? '').trim(),
      catalogSource: override.catalogSource?.trim() || undefined,
      note: override.note?.trim() || undefined,
    }
    if (!normalizedOverride.category || !normalizedOverride.jdSubcategory) continue

    const keys = [
      buildManualCategoryOverrideLookupKey('sku', normalizedOverride.skuKey),
      buildManualCategoryOverrideLookupKey('pn', normalizedOverride.pnMtm),
      buildManualCategoryOverrideLookupKey('name', normalizedOverride.productName),
    ].filter(Boolean)

    for (const key of keys) index.set(key, normalizedOverride)
  }

  return index
}

function findManualCategoryOverride(
  sku: Pick<StandardInventorySku, 'skuKey' | 'pnMtm' | 'productName'>,
  index: ManualCategoryOverrideIndex,
) {
  const keys = [
    buildManualCategoryOverrideLookupKey('sku', sku.skuKey),
    buildManualCategoryOverrideLookupKey('pn', sku.pnMtm),
    buildManualCategoryOverrideLookupKey('name', sku.productName),
  ].filter(Boolean)

  for (const key of keys) {
    const override = index.get(key)
    if (override) return override
  }
  return undefined
}

function applyManualCategoryOverride(sku: StandardInventorySku, index: ManualCategoryOverrideIndex) {
  const override = findManualCategoryOverride(sku, index)
  if (!override) return sku

  const nextWarnings = [...sku.dataQuality.warnings]
  const overrideNote = override.note
    ?? `已按本地分类覆盖层将原分类 ${sku.sourceCategory || sku.category || '未分类'} 覆盖为 ${override.category}。`
  if (!nextWarnings.includes(overrideNote)) nextWarnings.push(overrideNote)

  return {
    ...sku,
    category: override.category,
    jdSubcategory: override.jdSubcategory,
    catalogSource: override.catalogSource ?? sku.catalogSource,
    dataQuality: {
      ...sku.dataQuality,
      warnings: nextWarnings,
    },
  }
}

function classifyByJdLenovoCatalog(item: TabletAccessoryClassificationInput): CatalogClassification {
  const name = item.productName
  const sourceCategory = item.category ?? ''
  const text = `${sourceCategory} ${name} ${item.pnMtm ?? ''}`
  const lecooOfficialSource = '来酷京东官方目录补充'

  if (isTabletAccessoryUnder500({
    ...item,
    sourceCategory: item.sourceCategory ?? sourceCategory,
  })) {
    return { category: '电脑配件', jdSubcategory: '平板配件' }
  }

  if (/拯救者火力强化/i.test(sourceCategory)) {
    return { category: '电脑配件', jdSubcategory: '存储升级' }
  }
  if (/拯救者$/i.test(sourceCategory)) {
    return { category: '游戏笔记本', jdSubcategory: '拯救者游戏本' }
  }
  if (/小新$/i.test(sourceCategory)) {
    if (/24-ILL|27-ILL|27-IRH|一体机|AIO/i.test(text)) return { category: '一体机', jdSubcategory: '小新一体机' }
    if (/Pro/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '小新Pro' }
    if (/Air/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '小新Air' }
    return { category: '轻薄笔记本', jdSubcategory: '小新数字系列' }
  }
  if (/来酷Lecoo/i.test(sourceCategory)) {
    if (/战7000/i.test(text)) return { category: '游戏笔记本', jdSubcategory: '来酷战7000', catalogSource: lecooOfficialSource }
    if (/斗战者|N176|RTX|5060|5070/i.test(text)) return { category: '游戏笔记本', jdSubcategory: '斗战者游戏本', catalogSource: lecooOfficialSource }
    if (/Air|N175/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '来酷Air', catalogSource: lecooOfficialSource }
    if (/Pro/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '来酷Pro', catalogSource: lecooOfficialSource }
    if (/N155|15/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '来酷15', catalogSource: lecooOfficialSource }
    return { category: '轻薄笔记本', jdSubcategory: '来酷轻薄本', catalogSource: lecooOfficialSource }
  }
  if (/YOGA/i.test(text) && /(Air\s*14|IPH\d*|ILL\d*|Ultra|U[3579]\d{0,3}G|UX\d{0,4}G)/i.test(name)) {
    return { category: '轻薄笔记本', jdSubcategory: 'YOGA笔记本' }
  }
  if (/小新平板|拯救者平板|YOGA平板/i.test(sourceCategory)) {
    if (/拯救者|Y700/i.test(text)) return { category: '平板电脑', jdSubcategory: '拯救者平板' }
    if (/YOGA/i.test(text)) return { category: '平板电脑', jdSubcategory: 'YOGA平板' }
    return { category: '平板电脑', jdSubcategory: '小新平板' }
  }
  if (/天逸/i.test(sourceCategory)) {
    return { category: '商务台式', jdSubcategory: '天逸台式机' }
  }
  if (/GeekPro/i.test(sourceCategory)) {
    return { category: '游戏主机', jdSubcategory: 'GeekPro游戏主机' }
  }

  if (/显示器|Monitor|27Q|L2435/i.test(text)) {
    return { category: '显示器', jdSubcategory: /拯救者|Legion/i.test(text) ? '电竞显示器' : '办公显示器' }
  }
  if (/平板|TAB|Pad|TB\d+/i.test(text)) {
    if (/拯救者|Y700/i.test(text)) return { category: '平板电脑', jdSubcategory: '拯救者平板' }
    if (/YOGA/i.test(text)) return { category: '平板电脑', jdSubcategory: 'YOGA平板' }
    return { category: '平板电脑', jdSubcategory: '小新平板' }
  }
  if (/耳机|耳麦|headset|X600|Y360|R360/i.test(text)) {
    return { category: '耳机音箱', jdSubcategory: /拯救者|电竞/i.test(text) ? '电竞耳机' : '蓝牙耳机' }
  }
  if (/打印机|一体机|喷墨|激光|鲸鱼|Panda|CM408/i.test(text)) {
    return { category: '打印机', jdSubcategory: /激光|Panda/i.test(text) ? '激光打印机' : '喷墨打印机' }
  }
  if (/moto|razr|直板机|折叠机|PHN|XT\d+|edge/i.test(text)) {
    return { category: '智能生活', jdSubcategory: /razr|折叠/i.test(text) ? 'moto折叠屏手机' : 'moto手机' }
  }
  if (/鼠标|键盘|支架|适配器|充电器|硬盘|箱包|背包|保护|钢化膜|手写笔|键鼠|火力强化|GM11|GK10|QXR|QXD|QX4|GX21|ZG38|QZQ|QXB/i.test(text)) {
    if (/鼠标|GM11/i.test(text)) return { category: '电脑配件', jdSubcategory: '鼠标' }
    if (/键盘|键鼠|GK10/i.test(text)) return { category: '电脑配件', jdSubcategory: '键盘/键鼠套装' }
    if (/支架/i.test(text)) return { category: '电脑配件', jdSubcategory: '支架' }
    if (/适配器|充电器|氮化镓/i.test(text)) return { category: '电脑配件', jdSubcategory: '电源适配器' }
    if (/硬盘|火力强化/i.test(text)) return { category: '电脑配件', jdSubcategory: '存储升级' }
    if (/保护|钢化膜|手写笔/i.test(text)) return { category: '电脑配件', jdSubcategory: '平板配件' }
    if (/箱包|背包/i.test(text)) return { category: '电脑配件', jdSubcategory: '电脑包' }
    return { category: '电脑配件', jdSubcategory: '其他配件' }
  }
  if (/GeekPro/i.test(text)) {
    return { category: '游戏主机', jdSubcategory: 'GeekPro游戏主机' }
  }
  if (/天逸|510S/i.test(text)) {
    return { category: '商务台式', jdSubcategory: '天逸台式机' }
  }
  if (/一体机|AIO|24-ILL|27-ILL|27-IRH/i.test(text)) {
    return { category: '一体机', jdSubcategory: /小新/i.test(text) ? '小新一体机' : '联想一体机' }
  }
  if (/拯救者|Legion|Y7000|Y9000|R7000|R9000|斗战者|战7000|RTX|5060|5070/i.test(text)) {
    if (/战7000/i.test(text)) return { category: '游戏笔记本', jdSubcategory: '来酷战7000', catalogSource: lecooOfficialSource }
    if (/来酷|Lecoo|斗战者/i.test(text)) return { category: '游戏笔记本', jdSubcategory: '斗战者游戏本', catalogSource: lecooOfficialSource }
    return { category: '游戏笔记本', jdSubcategory: '拯救者游戏本' }
  }
  if (/小新|YOGA|Lecoo|来酷|Air|Pro|N155|N175|14|15|16/i.test(text)) {
    if (/Pro/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '小新Pro' }
    if (/Air/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '小新Air' }
    if (/N175/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '来酷Air', catalogSource: lecooOfficialSource }
    if (/N155|来酷|Lecoo/i.test(text)) return { category: '轻薄笔记本', jdSubcategory: '来酷15', catalogSource: lecooOfficialSource }
    return { category: '轻薄笔记本', jdSubcategory: '小新数字系列' }
  }

  return { category: '智能生活', jdSubcategory: sourceCategory || '其他' }
}

function toStandardSerial(item: LenovoRetailSerialItem): StandardInventorySerial {
  return {
    serialNumber: item.serialNumber,
    source: item.source,
    productName: item.productName,
    pnMtm: item.mtm,
    spec: typeof item.raw.spec === 'string' ? item.raw.spec : undefined,
    productCode: typeof item.raw.productCode === 'string' ? item.raw.productCode : undefined,
    skuCode: item.skuCode,
    organizationName: item.storeName,
    organizationCode: typeof item.raw.organizationCode === 'string' ? item.raw.organizationCode : undefined,
    productSource: typeof item.raw.productSource === 'string' ? item.raw.productSource : undefined,
    inboundDate: item.inboundDate,
    purchaseCost: item.purchaseCost,
    inboundDocumentNumber: typeof item.raw.inboundDocumentNumber === 'string' ? item.raw.inboundDocumentNumber : undefined,
    inboundOperatorName: typeof item.raw.inboundOperatorName === 'string' ? item.raw.inboundOperatorName : undefined,
    supplierName: typeof item.raw.supplierName === 'string' ? item.raw.supplierName : undefined,
    locationName: typeof item.raw.locationName === 'string' ? item.raw.locationName : undefined,
    stockAgeDays: item.stockAgeDays,
    warrantyStart: item.warrantyStart,
    warrantyEnd: item.warrantyEnd,
  }
}

function getDerivedSalesCostPriceFromSerials(serials: StandardInventorySerial[]) {
  const pricedSerials = serials.filter((serial) => (
    typeof serial.purchaseCost === 'number'
    && Number.isFinite(serial.purchaseCost)
    && serial.purchaseCost > 0
  ))
  if (!pricedSerials.length) return undefined
  const total = pricedSerials.reduce((sum, serial) => sum + Number(serial.purchaseCost), 0)
  return {
    value: Number((total / pricedSerials.length).toFixed(2)),
    pricedSerialCount: pricedSerials.length,
    serialCount: serials.length,
  }
}

function buildSkuFromStock(
  item: LenovoRetailStockSummaryItem,
  serials: StandardInventorySerial[],
  priceIndex: LenovoStockPriceIndex,
  distributorQuoteIndex: DistributorQuoteFallbackIndex,
): StandardInventorySku {
  const warnings: string[] = []
  const stockQuantityDiff = item.currentStock - serials.length
  const priceRow = priceIndex.get(getPriceIndexKey(item))
  const agentPrice = item.agentPrice ?? parseCurrency(priceRow?.agentPriceText)
  const jdCategory = classifyByJdLenovoCatalog({
    ...item,
    sourceCategory: item.category,
    priceHint: agentPrice,
  })
  const rawSalesCostPrice = item.salesCostPrice ?? parseCurrency(priceRow?.salesCostPriceText)
  const derivedSalesCost = getDerivedSalesCostPriceFromSerials(serials)
  const distributorQuote = distributorQuoteIndex.get(String(item.pnMtm ?? '').trim().toUpperCase())
  const distributorFallbackCost = distributorQuote?.pickupPrice
  const salesCostPrice = rawSalesCostPrice && rawSalesCostPrice > 0
    ? rawSalesCostPrice
    : derivedSalesCost?.value ?? distributorFallbackCost
  const priceSource = rawSalesCostPrice && rawSalesCostPrice > 0
    ? (priceRow ? '智店通商品库存表' : undefined)
    : derivedSalesCost
      ? `SN入库成本回灌（${derivedSalesCost.pricedSerialCount}/${derivedSalesCost.serialCount} 条在库SN有成本）`
      : distributorFallbackCost
        ? `分销群报价代填（PN/MTM 精确命中，报价日 ${distributorQuote?.quoteDate ?? '待补'}，待智店通入库成本复核）`
        : undefined

  if (item.currentStock > 0 && serials.length === 0) {
    warnings.push('该 SKU 有库存数量，但导出的 SN 明细中未找到对应序列号。')
  }
  if (serials.length > 0 && item.currentStock !== serials.length) {
    warnings.push(`库存数量为 ${item.currentStock}，SN 数量为 ${serials.length}，两者不一致。`)
  }
  if ((!rawSalesCostPrice || rawSalesCostPrice <= 0) && derivedSalesCost && derivedSalesCost.pricedSerialCount < derivedSalesCost.serialCount) {
    warnings.push(`库存成本由在库 SN 入库成本回灌，当前 ${derivedSalesCost.serialCount} 条 SN 中仅 ${derivedSalesCost.pricedSerialCount} 条已补真实进货成本。`)
  }
  if ((!rawSalesCostPrice || rawSalesCostPrice <= 0) && !derivedSalesCost && distributorFallbackCost) {
    warnings.push(`库存进货价暂按分销群报价精确 PN/MTM 代填 ${distributorFallbackCost} 元，待智店通商品入库单明细补到后自动覆盖。`)
  }

  return {
    skuKey: getSkuKey(item),
    productName: getCanonicalName(getSkuKey(item)) ?? item.productName,
    pnMtm: item.pnMtm,
    spec: item.spec || (serials[0]?.spec ?? undefined),
    category: jdCategory.category,
    sourceCategory: item.category,
    jdSubcategory: jdCategory.jdSubcategory,
    catalogSource: jdCategory.catalogSource ?? '联想京东自营旗舰店目录',
    productCode: item.productCode,
    skuCode: item.skuCode,
    organizationName: item.organizationName,
    organizationCode: item.organizationCode,
    stockType: item.stockType,
    stockWarningLevel: parseOptionalNumber(priceRow?.stockWarningLevel),
    agentPrice,
    salesCostPrice,
    priceSource,
    currentStock: item.currentStock,
    sellableStock: item.sellableStock,
    occupiedStock: item.occupiedStock,
    unsellableStock: item.unsellableStock,
    pendingInboundStock: item.pendingInboundStock,
    serialCount: serials.length,
    serials,
    dataQuality: {
      stockAndSerialMatched: stockQuantityDiff === 0,
      stockQuantityDiff,
      warnings,
    },
  }
}

function buildSkuFromSerialOnly(serial: StandardInventorySerial): StandardInventorySku {
  const jdCategory = classifyByJdLenovoCatalog({
    productName: serial.productName,
    category: serial.spec,
    pnMtm: serial.pnMtm,
  })

  return {
    skuKey: getSkuKey(serial),
    productName: serial.productName,
    pnMtm: serial.pnMtm,
    spec: serial.spec,
    category: jdCategory.category,
    sourceCategory: serial.spec,
    jdSubcategory: jdCategory.jdSubcategory,
    catalogSource: jdCategory.catalogSource ?? '联想京东自营旗舰店目录',
    productCode: serial.productCode,
    skuCode: serial.skuCode,
    organizationName: serial.organizationName,
    organizationCode: serial.organizationCode,
    currentStock: 0,
    sellableStock: 0,
    occupiedStock: 0,
    unsellableStock: 0,
    pendingInboundStock: 0,
    serialCount: 1,
    serials: [serial],
    dataQuality: {
      stockAndSerialMatched: false,
      stockQuantityDiff: -1,
      warnings: ['该 SN 在序列号导出中存在，但库存数量表中未找到对应 SKU。'],
    },
  }
}

function buildCategorySummary(skus: StandardInventorySku[]): StandardInventorySnapshot['categories'] {
  const categoryMap = new Map<string, StandardInventorySku[]>()

  for (const sku of skus) {
    const category = sku.category?.trim() || '未分类'
    const group = categoryMap.get(category) ?? []
    group.push(sku)
    categoryMap.set(category, group)
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
        {
          currentStock: 0,
          sellableStock: 0,
          unsellableStock: 0,
          pendingInboundStock: 0,
          serialCount: 0,
        },
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

export function buildStandardInventorySnapshot(input: {
  stockSummaryItems: LenovoRetailStockSummaryItem[]
  serialItems: LenovoRetailSerialItem[]
  stockQuantityFile?: string
  stockSnFile?: string
  priceIndex?: LenovoStockPriceIndex
  distributorQuoteIndex?: DistributorQuoteFallbackIndex
}): StandardInventorySnapshot {
  const priceIndex = input.priceIndex ?? new Map()
  const distributorQuoteIndex = input.distributorQuoteIndex ?? new Map()
  const manualCategoryOverrideIndex = loadManualCategoryOverrideIndex()
  const serialsBySku = new Map<string, StandardInventorySerial[]>()
  const standardSerials = input.serialItems.map(toStandardSerial)

  for (const serial of standardSerials) {
    const skuKey = getSkuKey(serial)
    const group = serialsBySku.get(skuKey) ?? []
    group.push(serial)
    serialsBySku.set(skuKey, group)
  }

  const usedSerialSkuKeys = new Set<string>()
  const skus = input.stockSummaryItems.map((item) => {
    const skuKey = getSkuKey(item)
    usedSerialSkuKeys.add(skuKey)
    return buildSkuFromStock(item, serialsBySku.get(skuKey) ?? [], priceIndex, distributorQuoteIndex)
  })

  const orphanSerials: StandardInventorySerial[] = []
  for (const [skuKey, serials] of serialsBySku.entries()) {
    if (usedSerialSkuKeys.has(skuKey)) continue
    orphanSerials.push(...serials)
  }

  const normalizedSkus = skus.map((sku) => applyManualCategoryOverride(sku, manualCategoryOverrideIndex))

  const totals = normalizedSkus.reduce(
    (acc, item) => {
      acc.currentStock += item.currentStock
      acc.sellableStock += item.sellableStock
      acc.occupiedStock += item.occupiedStock
      acc.unsellableStock += item.unsellableStock
      acc.pendingInboundStock += item.pendingInboundStock
      acc.serialCount += item.serialCount
      if (item.currentStock === 0 && item.serialCount > 0) {
        acc.unmatchedSerialCount += item.serialCount
      }
      return acc
    },
    {
      skuCount: normalizedSkus.length,
      currentStock: 0,
      sellableStock: 0,
      occupiedStock: 0,
      unsellableStock: 0,
      pendingInboundStock: 0,
      serialCount: 0,
      unmatchedSerialCount: 0,
    },
  )

  const firstSku = normalizedSkus.find((item) => item.organizationName || item.organizationCode)
  const warningSet = new Set<string>()
  const positiveStockSkuCount = normalizedSkus.filter((item) => item.currentStock > 0).length
  const serialMatchedSkuCount = normalizedSkus.filter((item) => item.serialCount > 0 && item.currentStock > 0).length

  if (totals.serialCount > 0 && serialMatchedSkuCount === 0) {
    warningSet.add('SN 导出文件与库存数量导出文件没有匹配到相同 SKU，可能不是同一筛选条件或同一时间导出。')
  }
  if (orphanSerials.length > 0) {
    warningSet.add(`发现 ${orphanSerials.length} 条仅存在于SN导出、但不在当天库存数量表中的历史SN，已从当前在库快照排除。`)
  }
  if (totals.currentStock > 0 && totals.serialCount > totals.currentStock) {
    warningSet.add(`SN 数量 ${totals.serialCount} 大于库存数量 ${totals.currentStock}，需要重新导出同一范围的数据。`)
  }
  if (positiveStockSkuCount > 0 && totals.serialCount === 0) {
    warningSet.add('库存数量表存在有库存 SKU，但没有可用 SN 明细。')
  }
  for (const item of normalizedSkus) {
    for (const warning of item.dataQuality.warnings) {
      warningSet.add(warning)
    }
  }

  return {
    source: 'lenovo-retail-web',
    generatedAt: new Date().toISOString(),
    storeName: firstSku?.organizationName,
    organizationCode: firstSku?.organizationCode,
    totals,
    dataQuality: {
      stockAndSerialScopeLikelyMatched: totals.serialCount === 0 || serialMatchedSkuCount > 0,
      warnings: Array.from(warningSet),
    },
    categories: buildCategorySummary(normalizedSkus),
    skus: normalizedSkus,
    files: {
      stockQuantityFile: input.stockQuantityFile,
      stockSnFile: input.stockSnFile,
    },
  }
}

export async function buildSnapshotFromLatestExports() {
  const stockQuantityFile = await findLatestStockQuantityExport()
  const stockSnFile = await findLatestStockSnExport()

  const stockSummaryItems = stockQuantityFile ? await parseStockQuantityExport(stockQuantityFile) : []
  const serialItems = stockSnFile ? await parseStockSnExport(stockSnFile) : []
  const serialOverrides = await loadSerialOverrides()
  const priceIndex = await loadLatestStockPriceIndex()
  const distributorQuoteIndex = await loadDistributorQuoteFallbackIndex()

  return buildStandardInventorySnapshot({
    stockSummaryItems,
    serialItems: mergeSerialOverrides(serialItems, serialOverrides, stockSummaryItems),
    stockQuantityFile,
    stockSnFile,
    priceIndex,
    distributorQuoteIndex,
  })
}

export async function saveInventorySnapshot(snapshot: StandardInventorySnapshot) {
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(webPublicDataDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.resolve(config.lenovoRetail.artifactDir, `${stamp}-standard-inventory-snapshot.json`)
  const latestPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const webLatestPath = path.resolve(webPublicDataDir, 'latest-standard-inventory-snapshot.json')

  const content = JSON.stringify(snapshot, null, 2)
  await fs.writeFile(filePath, content, 'utf-8')
  await fs.writeFile(latestPath, content, 'utf-8')
  await fs.writeFile(webLatestPath, content, 'utf-8')

  return { filePath, latestPath, webLatestPath }
}
