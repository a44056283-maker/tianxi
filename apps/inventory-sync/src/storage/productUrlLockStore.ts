import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot, StandardInventorySku } from '../types.js'
import type { MarketplacePriceRecord } from './marketplacePriceCollector.js'

export type ProductUrlLockSource = 'jd_self' | 'jd_supermarket' | 'jd_authorized' | 'lenovo_official' | 'manmanbuy_hint'

export type ProductUrlLock = {
  skuKey: string
  pnMtm?: string
  productName: string
  category?: string
  source: ProductUrlLockSource
  url: string
  platformSkuId?: string
  matchTitle?: string
  matchStatus: 'locked' | 'candidate' | 'unavailable'
  confidence: 'confirmed' | 'manual_review_required'
  priority: number
  price?: number
  capturedAt?: string
  evidenceNote?: string
  raw?: Record<string, unknown>
}

export type ProductUrlLockSnapshot = {
  generatedAt: string
  source: 'product_url_lock_store'
  policy: string
  total: number
  bySource: Record<ProductUrlLockSource, number>
  locks: ProductUrlLock[]
}

const lockFileName = 'latest-product-url-locks.json'

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined)
}

function toSource(record: MarketplacePriceRecord): ProductUrlLockSource | undefined {
  const url = record.evidence?.evidenceUrl ?? record.configuredUrl ?? ''
  if (record.source === 'lenovo_official' && isLenovoProductUrl(url)) return 'lenovo_official'
  if (record.source === 'jd' && isJdProductUrl(url) && /授权|index-580799/i.test(JSON.stringify(record))) return 'jd_authorized'
  if (record.source === 'jd' && isJdProductUrl(url)) return 'jd_self'
  if (isManmanbuyProductUrl(url)) return 'manmanbuy_hint'
  return undefined
}

function isJdProductUrl(url: string) {
  return /^https:\/\/item\.jd\.com\/\d+\.html(?:[?#].*)?$/i.test(url)
}

function isLenovoProductUrl(url: string) {
  return /^https:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(url)
}

function isManmanbuyProductUrl(url: string) {
  return /manmanbuy\.com/i.test(url) && !/\/search\/|keyword=|btnSearch=/i.test(url)
}

function isValidLockUrl(lock: Pick<ProductUrlLock, 'source' | 'url'>) {
  if (lock.source === 'lenovo_official') return isLenovoProductUrl(lock.url)
  if (lock.source === 'jd_self' || lock.source === 'jd_supermarket' || lock.source === 'jd_authorized') return isJdProductUrl(lock.url)
  return isManmanbuyProductUrl(lock.url)
}

function hasInvalidJdPageSignal(source: ProductUrlLockSource, text: string) {
  if (source !== 'jd_self' && source !== 'jd_supermarket' && source !== 'jd_authorized') return false
  return /京东\(JD\.COM\)-正品低价|京东首页|JD\.COM-正品低价/i.test(text)
}

function platformSkuIdFromUrl(url: string) {
  return url.match(/item\.jd\.com\/(\d+)\.html(?:[?#].*)?$/i)?.[1]
    ?? url.match(/product\/(\d+)\.html/i)?.[1]
    ?? url.match(/discuxiao_(\d+)\.aspx/i)?.[1]
}

function getPriority(source: ProductUrlLockSource) {
  if (source === 'jd_self') return 10
  if (source === 'lenovo_official') return 9
  if (source === 'jd_supermarket') return 8
  if (source === 'jd_authorized') return 7
  return 3
}

function stripGeneratedUnavailableNote(value: unknown) {
  return String(value ?? '')
    .replace(/下架\/待发布\/无货价格不进入报价引擎。?/g, '')
    .replace(/商品不可销售，不作为报价参考。?/g, '')
}

function hasHardUnavailableSignal(value: unknown) {
  return /已下架|页面为已下架状态|商品已下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知|不可购买|停止销售|商品不存在/i.test(stripGeneratedUnavailableNote(value))
}

function hasTerminalNoExactMatchSignal(value: unknown) {
  return /no_exact_match_after_spec_check|确无同配|无目标同配/i.test(String(value ?? ''))
}

function skuByKey(inventory: StandardInventorySnapshot) {
  return new Map(inventory.skus.map((sku) => [sku.skuKey, sku]))
}

function buildLock(record: MarketplacePriceRecord, sku?: StandardInventorySku): ProductUrlLock | undefined {
  const url = record.evidence?.evidenceUrl ?? record.configuredUrl
  const source = toSource(record)
  if (!url || !source || !record.productId) return undefined
  const recordText = `${record.matchTitle ?? ''} ${record.raw ? JSON.stringify(record.raw) : ''}`
  const pageMatchText = record.matchTitle ?? ''
  const trustedExactLinkBackfill = record.collectionStatus === 'captured'
    && record.confidence === 'confirmed'
    && record.evidence?.capturedBy === 'manual'
    && record.raw?.reason === 'fresh_exact_link_backfill_only'
  if (hasInvalidJdPageSignal(source, recordText)) return undefined
  if (!trustedExactLinkBackfill && sku && hasSkuPageMismatch(sku, pageMatchText)) return undefined
  const unavailable = record.collectionStatus === 'unavailable'
    ? (hasHardUnavailableSignal(recordText) || hasTerminalNoExactMatchSignal(recordText))
    : hasHardUnavailableSignal(recordText)
  const userConfirmedUrlCorrection = record.collectionStatus === 'manual_review_required'
    && record.confidence === 'manual'
    && record.raw?.reason === 'old_product_configuration_mismatch'
  return {
    skuKey: record.productId,
    pnMtm: sku?.pnMtm ?? (record.raw?.pnMtm as string | undefined),
    productName: sku?.productName ?? record.productName ?? record.matchTitle ?? record.query,
    category: sku?.category,
    source,
    url,
    platformSkuId: record.platformSkuId ?? platformSkuIdFromUrl(url),
    matchTitle: record.matchTitle,
    matchStatus: unavailable ? 'unavailable' : record.collectionStatus === 'captured' && record.confidence === 'confirmed' || userConfirmedUrlCorrection ? 'locked' : 'candidate',
    confidence: record.collectionStatus === 'captured' && record.confidence === 'confirmed' || userConfirmedUrlCorrection ? 'confirmed' : 'manual_review_required',
    priority: getPriority(source),
    price: unavailable ? undefined : record.price ?? record.preSubsidyPrice ?? record.couponAdjustedPrice ?? record.postSubsidyPrice,
    capturedAt: record.evidence?.capturedAt,
    evidenceNote: record.evidence?.note,
    raw: record.raw,
  }
}

function normalizeForMatch(value: string) {
  return value.toUpperCase().replace(/[-\s/]+/g, '')
}

function normalizeCpuToken(value: string | undefined) {
  if (!value) return undefined
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

function hasSkuPageMismatch(sku: StandardInventorySku, pageTextInput: string) {
  const skuText = normalizeForMatch(`${sku.productName} ${sku.spec ?? ''}`)
  const pageText = normalizeForMatch(pageTextInput)
  if (!pageText) return false
  if (/笔记本|游戏本|轻薄本/.test(`${sku.productName} ${sku.category ?? ''}`) && /台式|主机|刃7000|刃9000|GEEKPRO|510S/i.test(pageTextInput)) return true

  const skuCpu = skuText.match(/(?:I[3579]\d{4,5}[A-Z]*|R[3579]\d{3,4}[A-Z]*|ULTRA[579]\d{3}[A-Z]*|H255|8945HX|14900HX|13645HX)/i)?.[0]
  const pageCpu = pageText.match(/(?:I[3579]\d{4,5}[A-Z]*|R[3579]\d{3,4}[A-Z]*|ULTRA[579]\d{3}[A-Z]*|H255|8945HX|14900HX|13645HX|13650HX|14650HX)/i)?.[0]
  if (skuCpu && pageCpu) {
    const normalizedSkuCpu = normalizeCpuToken(skuCpu)
    const normalizedPageCpu = normalizeCpuToken(pageCpu)
    const cpuCompatible = normalizedSkuCpu === normalizedPageCpu
      || normalizedSkuCpu?.startsWith(normalizedPageCpu ?? '')
      || normalizedPageCpu?.startsWith(normalizedSkuCpu ?? '')
    if (!cpuCompatible) return true
  }
  if (/R9/i.test(skuText) && /I[3579]/i.test(pageText)) return true
  if (/I[3579]/i.test(skuText) && /R[3579]/i.test(pageText)) return true

  const skuStorage = skuText.match(/(?:256G|512G|1T|2T|4T)/i)?.[0]
  const pageStorage = pageText.match(/(?:256G|512G|1T|2T|4T)/i)?.[0]
  if (skuStorage && pageStorage && skuStorage !== pageStorage && !pageText.includes(skuStorage)) return true
  return false
}

function dedupeLocks(locks: ProductUrlLock[]) {
  const byKey = new Map<string, ProductUrlLock>()
  for (const lock of locks) {
    const key = `${lock.skuKey}:${lock.source}`
    const previous = byKey.get(key)
    const previousTime = previous?.capturedAt ? Date.parse(previous.capturedAt) : 0
    const lockTime = lock.capturedAt ? Date.parse(lock.capturedAt) : 0
    const hasBetterPrice = lock.price !== undefined && previous?.price === undefined
    const hasNewerUnavailableEvidence = lockTime > previousTime && lock.matchStatus === 'unavailable'
    const hasNewerEvidence = lockTime > previousTime && (
      lock.price !== undefined
      || lock.evidenceNote !== previous?.evidenceNote
      || lock.matchStatus === 'locked'
      || lock.matchStatus === 'unavailable'
    )
    const hasSameTimeCorrection = lockTime >= previousTime && (
      lock.matchTitle !== previous?.matchTitle
      || lock.evidenceNote !== previous?.evidenceNote
      || JSON.stringify(lock.raw ?? {}) !== JSON.stringify(previous?.raw ?? {})
    )
    if (
      !previous
      || hasNewerUnavailableEvidence
      || lock.priority > previous.priority
      || (lock.matchStatus === 'locked' && previous.matchStatus !== 'locked')
      || hasBetterPrice
      || hasNewerEvidence
      || hasSameTimeCorrection
    ) {
      byKey.set(key, lock)
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.skuKey.localeCompare(b.skuKey) || b.priority - a.priority || a.source.localeCompare(b.source))
}

function normalizeExistingLock(lock: ProductUrlLock, sku?: StandardInventorySku): ProductUrlLock | undefined {
  if (!isValidLockUrl(lock)) return undefined
  const lockText = `${lock.matchTitle ?? ''} ${lock.raw ? JSON.stringify(lock.raw) : ''}`
  const pageMatchText = lock.matchTitle ?? ''
  if (hasInvalidJdPageSignal(lock.source, lockText)) return undefined
  if (sku && hasSkuPageMismatch(sku, pageMatchText)) return undefined
  const productText = `${lock.productName} ${lock.category ?? ''}`.toLowerCase()
  const pageText = `${lock.matchTitle ?? ''} ${lock.raw ? JSON.stringify(lock.raw) : ''}`.toLowerCase()
  if (/笔记本|游戏本|轻薄本/.test(productText) && /台式|主机|刃7000|刃9000|geekpro|510s/i.test(pageText)) return undefined
  const unavailable = hasHardUnavailableSignal(lockText) || hasTerminalNoExactMatchSignal(lockText)
  return unavailable
    ? {
        ...lock,
        matchStatus: 'unavailable',
        confidence: 'manual_review_required',
        price: undefined,
      }
    : lock
}

function isProductUrlLockCandidate(value: unknown): value is ProductUrlLock {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProductUrlLock>
  return typeof candidate.skuKey === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.productName === 'string'
    && typeof candidate.matchStatus === 'string'
    && typeof candidate.confidence === 'string'
    && typeof candidate.priority === 'number'
}

export async function buildProductUrlLockSnapshot() {
  const [inventory, marketplace, existing] = await Promise.all([
    readJson<StandardInventorySnapshot>(artifactPath('latest-standard-inventory-snapshot.json')),
    readJson<{ records?: MarketplacePriceRecord[] }>(artifactPath('latest-marketplace-price-snapshot.json')),
    readJson<ProductUrlLockSnapshot>(artifactPath(lockFileName)),
  ])
  if (!inventory) throw new Error('缺少 latest-standard-inventory-snapshot.json，请先生成库存快照。')
  const skuMap = skuByKey(inventory)
  const locks = dedupeLocks([
    ...(existing?.locks ?? [])
      .filter(isProductUrlLockCandidate)
      .map((lock) => normalizeExistingLock(lock, skuMap.get(lock.skuKey)))
      .filter((lock): lock is ProductUrlLock => Boolean(lock)),
    ...((marketplace?.records ?? [])
      .map((record) => buildLock(record, skuMap.get(record.productId)))
      .filter((lock): lock is ProductUrlLock => Boolean(lock))),
  ])
  const bySource = locks.reduce((acc, lock) => {
    acc[lock.source] = (acc[lock.source] ?? 0) + 1
    return acc
  }, { jd_self: 0, jd_supermarket: 0, jd_authorized: 0, lenovo_official: 0, manmanbuy_hint: 0 } as Record<ProductUrlLockSource, number>)
  return {
    generatedAt: new Date().toISOString(),
    source: 'product_url_lock_store',
    policy: '只允许真实商品详情页进入锁定库：京东必须是 item.jd.com/数字.html（允许 ?bbtf=1 等查询参数），联想必须是 item.lenovo.com.cn/product/数字.html；mall.jd.com、shop.lenovo.com.cn、s.lenovo.com.cn/search 只能作为采集起点，不能冒充商品网址。首次慢速采集锁定真实商品详情页；后续刷新价格优先按锁定 URL 用 Chrome 模拟人工打开。京东自营优先，其次联想商城，再次京东超市联想自营和京东官方授权店，慢慢买只作找详情页的兜底线索。',
    total: locks.length,
    bySource,
    locks,
  } satisfies ProductUrlLockSnapshot
}

export async function saveProductUrlLockSnapshot() {
  const snapshot = await buildProductUrlLockSnapshot()
  const artifact = artifactPath(lockFileName)
  const web = webDataPath(lockFileName)
  await Promise.all([
    fs.mkdir(path.dirname(artifact), { recursive: true }),
    fs.mkdir(path.dirname(web), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifact, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(web, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  return { snapshot, artifactPath: artifact, webPath: web }
}
