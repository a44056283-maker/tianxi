import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'

export type MarketplaceSource = 'jd' | 'lenovo_official' | 'taobao_subsidy'

export type MarketplacePriceEvidence = {
  evidenceUrl?: string
  screenshotPath?: string
  capturedAt?: string
  capturedBy: 'manual' | 'sample' | 'configured_url' | 'legacy_jd_monitor' | 'justoneapi' | 'browser_rpa' | 'user_supplied_url' | 'user_supplied_visible_price'
  note?: string
}

export type MarketplacePriceRecord = {
  source: MarketplaceSource
  sourceLabel: string
  sourceType: 'sales_reference_price' | 'subsidy_reference_price'
  productId: string
  query: string
  configuredUrl?: string
  productName?: string
  platformSkuId?: string
  matchTitle?: string
  price?: number
  preSubsidyPrice?: number
  postSubsidyPrice?: number
  couponAdjustedPrice?: number
  priceType: 'display_price' | 'pre_discount_price' | 'pre_subsidy_price' | 'post_subsidy_price' | 'coupon_adjusted_price' | 'manual_price' | 'url_configured_only'
  priceBasis: string
  taxIncluded?: boolean
  serviceIncluded?: boolean
  confidence: 'confirmed' | 'provisional' | 'manual' | 'sample' | 'url_configured_only'
  collectionStatus: 'captured' | 'manual_review_required' | 'url_configured_only' | 'unavailable'
  evidence: MarketplacePriceEvidence
  raw?: Record<string, unknown>
}

export type MarketplacePriceSnapshot = {
  generatedAt: string
  collector: {
    name: 'marketplace-price-collector'
    mode: 'manual_or_sample_placeholder'
    version: 1
    limitation: string
    nextStep: string
  }
  sources: Array<{
    source: MarketplaceSource
    label: string
    sourceType: MarketplacePriceRecord['sourceType']
    captureMethod: 'legacy_json' | 'manual_snapshot' | 'configured_url_placeholder' | 'justoneapi' | 'browser_rpa'
    recordCount: number
    capturedCount: number
  }>
  itemCount: number
  records: MarketplacePriceRecord[]
}

type LegacyJdPriceMonitorItem = {
  jdSelfPrice?: number
  capturedAt?: string
  source?: string
  priceBasis?: string
  query?: string
  matchTitle?: string
  priceType?: MarketplacePriceRecord['priceType']
}

type ManualRecordInput = Partial<MarketplacePriceRecord> & {
  skuCode?: string
  skuKey?: string
  id?: string
  url?: string
  evidenceUrl?: string
  screenshot?: string
  screenshotPath?: string
  price?: number | string
}

type ProductUrlLockSnapshot = {
  locks?: Array<{
    skuKey: string
    productName: string
    source: 'jd_self' | 'jd_supermarket' | 'jd_authorized' | 'lenovo_official' | 'manmanbuy_hint'
    url: string
    platformSkuId?: string
    matchTitle?: string
    matchStatus: 'locked' | 'candidate' | 'unavailable'
    confidence: 'confirmed' | 'manual_review_required'
    price?: number
    capturedAt?: string
    evidenceNote?: string
    raw?: Record<string, unknown>
  }>
}

const sourceLabels: Record<MarketplaceSource, string> = {
  jd: '京东',
  lenovo_official: '联想官网',
  taobao_subsidy: '淘宝百亿补贴',
}

const sourceTypes: Record<MarketplaceSource, MarketplacePriceRecord['sourceType']> = {
  jd: 'subsidy_reference_price',
  lenovo_official: 'sales_reference_price',
  taobao_subsidy: 'subsidy_reference_price',
}

const jdLenovoSelfMallUrl = 'https://lenovo1.jd.com/'
const lenovoShopSearchBaseUrl = 'https://s.lenovo.com.cn/search/'

const placeholderTargets = [
  { productId: '20003124', query: '联想 R7000P R9-8945HX 16G 1T RTX5060' },
  { productId: '20003130', query: '联想 Y9000P Ultra 9-275 32G 1T RTX5060' },
  { productId: '20006803', query: 'TB323FU TAB 16G+512GWH-CN 拯救者Y700 五代 16+512' },
]

function getSearchUrl(source: MarketplaceSource, query: string) {
  const encoded = encodeURIComponent(query)
  if (source === 'jd') return `${jdLenovoSelfMallUrl}?keyword=${encoded}`
  if (source === 'lenovo_official') return `${lenovoShopSearchBaseUrl}?key=${encoded}&isProprietary=true&page=`
  return `https://s.taobao.com/search?q=${encoded}`
}

function getPriceBasis(source: MarketplaceSource) {
  if (source === 'jd') return '京东自营/平台展示价格；占位阶段不扣除不可见优惠，保留国补前/后字段'
  if (source === 'lenovo_official') return '联想官网公开展示价格；占位阶段由手工快照或后续抓取填充'
  return '淘宝百亿补贴展示价格；占位阶段由手工快照或后续抓取填充'
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number(value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function isDecimalPrice(value: number | undefined) {
  return value !== undefined && !Number.isInteger(value)
}

function stripGeneratedUnavailableNote(value: unknown) {
  return String(value ?? '')
    .replace(/下架\/待发布\/无货价格不进入报价引擎。?/g, '')
    .replace(/商品不可销售，不作为报价参考。?/g, '')
}

function hasHardUnavailableSignal(value: unknown) {
  return /已下架|下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知|不可购买|停止销售|商品不存在/i.test(stripGeneratedUnavailableNote(value))
}

function hasTerminalNoExactMatchSignal(value: unknown) {
  return /no_exact_match_after_spec_check|确无同配|无目标同配/i.test(String(value ?? ''))
}

function hasReviewOnlyNoMatchSignal(value: unknown) {
  const text = String(value ?? '')
    .replace(/不能再?把?[^。；;]*无同配[^。；;]*/g, '')
    .replace(/禁止[^。；;]*无同配[^。；;]*/g, '')
    .replace(/不得[^。；;]*无同配[^。；;]*/g, '')
    .replace(/不能判定无同配/g, '')
  return /无同配|未找到|错配|不写错配|不作为报价参考/i.test(text)
}

function recordHasUnavailableSignal(input: ManualRecordInput) {
  return [
    input.collectionStatus,
    input.matchTitle,
    input.productName,
    input.priceBasis,
    input.evidence?.note,
    input.evidence?.evidenceUrl,
    input.evidenceUrl,
    input.raw ? JSON.stringify(input.raw) : undefined,
  ].some((value) => hasHardUnavailableSignal(value) || hasTerminalNoExactMatchSignal(value))
}

function recordHasReviewOnlyNoMatchSignal(input: ManualRecordInput) {
  return [
    input.collectionStatus,
    input.matchTitle,
    input.productName,
    input.priceBasis,
    input.evidence?.note,
    input.evidence?.evidenceUrl,
    input.evidenceUrl,
    input.raw ? JSON.stringify(input.raw) : undefined,
  ].some(hasReviewOnlyNoMatchSignal)
}

function hasMismatchSignal(input: ManualRecordInput) {
  const productText = `${input.productName ?? ''} ${input.query ?? ''}`.toLowerCase()
  const pageText = `${input.matchTitle ?? ''} ${input.raw ? JSON.stringify(input.raw) : ''}`.toLowerCase()
  if (/笔记本|游戏本|轻薄本/.test(productText) && /台式|主机|刃7000|刃9000|geekpro|510s/i.test(pageText)) return true
  return false
}

function hasInvalidJdPageSignal(input: ManualRecordInput) {
  const text = `${input.matchTitle ?? ''} ${input.raw ? JSON.stringify(input.raw) : ''}`
  return /京东\(JD\.COM\)-正品低价|京东首页|JD\.COM-正品低价/i.test(text)
}

function isDirectOfficialUrl(source: MarketplaceSource, url?: string) {
  if (!url) return false
  if (source === 'jd') return /^https:\/\/item\.jd\.com\/\d+\.html(?:[?#].*)?$/i.test(url)
  if (source === 'lenovo_official') return /^https:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(url)
  return true
}

function isOfficialNonDirectUrl(source: MarketplaceSource, url?: string) {
  return (source === 'jd' || source === 'lenovo_official') && !isDirectOfficialUrl(source, url)
}

function normalizeSource(value: unknown): MarketplaceSource | undefined {
  if (value === 'jd' || value === 'lenovo_official' || value === 'taobao_subsidy') return value
  if (value === 'lenovo' || value === 'lenovoOfficial') return 'lenovo_official'
  if (value === 'taobao' || value === 'tmall' || value === 'taobao_100b_subsidy') return 'taobao_subsidy'
  return undefined
}

function buildUrlOnlyRecord(source: MarketplaceSource, productId: string, query: string): MarketplacePriceRecord {
  const configuredUrl = getSearchUrl(source, query)
  return {
    source,
    sourceLabel: sourceLabels[source],
    sourceType: sourceTypes[source],
    productId,
    query,
    configuredUrl,
    priceType: 'url_configured_only',
    priceBasis: getPriceBasis(source),
    confidence: 'url_configured_only',
    collectionStatus: 'url_configured_only',
    evidence: {
      evidenceUrl: configuredUrl,
      capturedBy: 'configured_url',
      note: '仅配置采集入口 URL；当前不依赖真实登录、不绕过平台限制，价格和截图待人工快照或后续 Playwright 采集补齐。',
    },
  }
}

function normalizeManualRecord(input: ManualRecordInput): MarketplacePriceRecord | null {
  const source = normalizeSource(input.source)
  const productId = String(input.productId ?? input.skuCode ?? input.skuKey ?? input.id ?? '').trim()
  const query = String(input.query ?? input.productName ?? input.matchTitle ?? '').trim()
  if (!source || !productId || !query) return null

  const configuredUrl = input.configuredUrl ?? input.url ?? getSearchUrl(source, query)
  const evidenceUrl = input.evidence?.evidenceUrl ?? input.evidenceUrl ?? configuredUrl
  const capturedAt = input.evidence?.capturedAt
  const price = parseOptionalNumber(input.price)
  const unavailable = recordHasUnavailableSignal(input)
  const reviewOnlyNoMatch = !unavailable && recordHasReviewOnlyNoMatchSignal(input)
  if (source === 'jd' && hasInvalidJdPageSignal(input)) return null
  if (!unavailable && hasMismatchSignal(input)) return null
  const officialNonDirectUrl = !unavailable && isOfficialNonDirectUrl(source, evidenceUrl)
  const directOfficialUrl = isDirectOfficialUrl(source, evidenceUrl)
  const couponAdjustedInput = input.priceType === 'coupon_adjusted_price'
  const allowUnavailableVisiblePrice = unavailable
    && directOfficialUrl
    && price !== undefined
    && /Chrome 实际打开|Chrome 可见|页面主价|会员价|政府补贴价|最后可见参考价/.test(
      `${input.evidence?.note ?? ''} ${input.priceBasis ?? ''}`,
    )
  const jdDecimalPrice = source === 'jd' && isDecimalPrice(price)
  const hasPrice = price !== undefined && (!unavailable || allowUnavailableVisiblePrice) && !jdDecimalPrice && !couponAdjustedInput
  const preSubsidyPrice = parseOptionalNumber(input.preSubsidyPrice)
  const postSubsidyPrice = parseOptionalNumber(input.postSubsidyPrice)
  const couponAdjustedPrice = parseOptionalNumber(input.couponAdjustedPrice)
  const normalizedCouponAdjustedPrice = couponAdjustedPrice ?? (couponAdjustedInput ? price : undefined)
  const basePriceBasis = input.priceBasis ?? getPriceBasis(source)
  const nonDirectBasis = basePriceBasis.includes('非商品详情页采集线索')
    ? basePriceBasis
    : `非商品详情页采集线索，不能作为正式官方价；必须反查到 item.jd.com 或 item.lenovo.com.cn/product 详情页后再确认。原口径：${basePriceBasis}`
  const baseNote = input.evidence?.note ?? '手工/样例快照输入；待后续替换为 Playwright 页面抓取。'
  const nonDirectNote = baseNote.includes('搜索页/店铺页不能冒充商品详情页')
    ? baseNote
    : `搜索页/店铺页不能冒充商品详情页，价格仅作找链接线索。${baseNote}`

  return {
    source,
    sourceLabel: input.sourceLabel ?? sourceLabels[source],
    sourceType: input.sourceType ?? sourceTypes[source],
    productId,
    query,
    configuredUrl,
    productName: input.productName,
    platformSkuId: input.platformSkuId,
    matchTitle: input.matchTitle,
    price: hasPrice ? price : undefined,
    preSubsidyPrice: (unavailable && !allowUnavailableVisiblePrice) || couponAdjustedInput || (source === 'jd' && isDecimalPrice(preSubsidyPrice)) ? undefined : preSubsidyPrice,
    postSubsidyPrice: unavailable && !allowUnavailableVisiblePrice ? undefined : postSubsidyPrice ?? (jdDecimalPrice ? price : undefined),
    couponAdjustedPrice: unavailable && !allowUnavailableVisiblePrice ? undefined : normalizedCouponAdjustedPrice,
    priceType: unavailable && !allowUnavailableVisiblePrice ? 'url_configured_only' : couponAdjustedInput ? 'coupon_adjusted_price' : input.priceType ?? (hasPrice ? 'manual_price' : 'url_configured_only'),
    priceBasis: unavailable
      ? allowUnavailableVisiblePrice
        ? `${basePriceBasis}；页面显示商品已下架，当前按最后可见参考价保留。`
        : `${basePriceBasis}；商品不可销售，不作为报价参考。`
      : reviewOnlyNoMatch
        ? `${basePriceBasis}；未见目标规格点击/选中态证据，不能判定无同配，保留为待同配复核。`
      : jdDecimalPrice
        ? `${basePriceBasis}；读取到小数价格，按国补后/优惠后线索处理，不作为京东国补前主零售价。`
      : couponAdjustedInput
        ? `${basePriceBasis}；该记录标记为券后/优惠后价，只保留到 couponAdjustedPrice，不作为京东/官旗主零售价。`
      : officialNonDirectUrl
        ? nonDirectBasis
        : basePriceBasis,
    taxIncluded: input.taxIncluded,
    serviceIncluded: input.serviceIncluded,
    confidence: unavailable && !allowUnavailableVisiblePrice ? 'url_configured_only' : officialNonDirectUrl ? 'manual' : input.confidence ?? (hasPrice ? 'manual' : 'url_configured_only'),
    collectionStatus: unavailable && !allowUnavailableVisiblePrice
      ? 'unavailable'
      : officialNonDirectUrl || reviewOnlyNoMatch || input.collectionStatus === 'unavailable'
        ? 'manual_review_required'
        : input.collectionStatus ?? (hasPrice ? 'manual_review_required' : 'url_configured_only'),
    evidence: {
      evidenceUrl,
      screenshotPath: input.evidence?.screenshotPath ?? input.screenshotPath ?? input.screenshot,
      capturedAt,
      capturedBy: input.evidence?.capturedBy ?? (hasPrice ? 'manual' : 'configured_url'),
      note: unavailable
        ? allowUnavailableVisiblePrice
          ? `${input.evidence?.note ?? '采集页显示不可销售状态'}；当前保留最后可见参考价。`
          : `${input.evidence?.note ?? '采集页显示不可销售状态'}；下架/待发布/无货价格不进入报价引擎。`
        : reviewOnlyNoMatch
          ? `${baseNote}；缺少目标规格点击/选中态证据，禁止写成无同配。`
        : jdDecimalPrice
          ? `${baseNote}；小数价格已从主价格字段移除，需在详情页图片展示位前读取国补前整数展示价。`
        : couponAdjustedInput
          ? `${baseNote}；券后/优惠后价格已从主价格字段移除，必须重新采集国补前正常展示价。`
        : officialNonDirectUrl
          ? nonDirectNote
          : baseNote,
    },
    raw: input.raw,
  }
}

function normalizeManualSnapshot(value: unknown): MarketplacePriceRecord[] {
  const records = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { records?: unknown }).records)
      ? (value as { records: unknown[] }).records
      : []

  return records
    .map((record) => normalizeManualRecord(record as ManualRecordInput))
    .filter((record): record is MarketplacePriceRecord => record !== null)
}

function getShanghaiCompactDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replace(/-/g, '')
}

async function listTodayManualSupplementFiles(inputFile?: string) {
  const compactDate = getShanghaiCompactDate()
  const manualFilePattern = new RegExp(`^manual-price-supplements-${compactDate}(?:-.+)?\\.json$`, 'i')
  const searchDirs = [
    config.lenovoRetail.artifactDir,
    path.resolve(config.lenovoRetail.artifactDir, 'manual'),
  ]
  const files = new Set<string>()

  for (const dir of searchDirs) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !manualFilePattern.test(entry.name)) continue
      files.add(path.resolve(dir, entry.name))
    }
  }

  if (inputFile) files.add(path.resolve(inputFile))
  return Array.from(files).sort()
}

async function loadManualRecordsFromFiles(files: string[]) {
  const nested = await Promise.all(files.map((filePath) => (
    fs.readFile(filePath, 'utf-8')
      .then((content) => normalizeManualSnapshot(JSON.parse(content)))
      .catch(() => [])
  )))
  return nested.flat()
}

function normalizeProductUrlLocks(value: unknown): MarketplacePriceRecord[] {
  const locks = value && typeof value === 'object' && Array.isArray((value as ProductUrlLockSnapshot).locks)
    ? (value as ProductUrlLockSnapshot).locks ?? []
    : []

  return locks
    .map((lock): MarketplacePriceRecord | null => {
      const source: MarketplaceSource | undefined = lock.source === 'lenovo_official'
        ? 'lenovo_official'
        : lock.source.startsWith('jd_') ? 'jd' : undefined
      if (!source || !lock.skuKey || !isDirectOfficialUrl(source, lock.url)) return null
      const lockText = `${lock.matchTitle ?? ''} ${lock.evidenceNote ?? ''} ${lock.raw ? JSON.stringify(lock.raw) : ''}`
      const unavailable = lock.matchStatus === 'unavailable'
        && (hasHardUnavailableSignal(lockText) || hasTerminalNoExactMatchSignal(lockText))
      const reviewOnlyNoMatch = lock.matchStatus === 'unavailable' && !unavailable
      const captured = lock.matchStatus === 'locked' && lock.confidence === 'confirmed' && typeof lock.price === 'number'
      const jdDecimalLockPrice = source === 'jd' && isDecimalPrice(lock.price)
      const hasMainPrice = captured && !jdDecimalLockPrice
      return {
        source,
        sourceLabel: sourceLabels[source],
        sourceType: sourceTypes[source],
        productId: lock.skuKey,
        query: lock.productName,
        configuredUrl: lock.url,
        productName: lock.productName,
        platformSkuId: lock.platformSkuId,
        matchTitle: lock.matchTitle,
        price: hasMainPrice ? lock.price : undefined,
        postSubsidyPrice: captured && jdDecimalLockPrice ? lock.price : undefined,
        priceType: hasMainPrice ? 'display_price' : captured && jdDecimalLockPrice ? 'post_subsidy_price' : 'url_configured_only',
        priceBasis: hasMainPrice
          ? '锁定商品详情页展示价；后续直接打开该 URL 快速刷新。'
          : captured && jdDecimalLockPrice
            ? '锁定库读取到京东小数价，按优惠后/国补后线索保留，不作为京东主零售价。'
          : unavailable ? '锁定商品详情页当前不可销售，只保留证据链接，不进入报价。' : reviewOnlyNoMatch ? '锁定库原标记为不可用，但缺少目标规格点击/选中态证据，改为待同配复核。' : '锁定商品详情页入口，待浏览器采集国补前价后进入报价。',
        taxIncluded: source === 'jd' || source === 'lenovo_official',
        serviceIncluded: source === 'jd' || source === 'lenovo_official',
        confidence: hasMainPrice ? 'confirmed' : captured && jdDecimalLockPrice ? 'manual' : 'url_configured_only',
        collectionStatus: hasMainPrice ? 'captured' : captured && jdDecimalLockPrice ? 'manual_review_required' : unavailable ? 'unavailable' : reviewOnlyNoMatch ? 'manual_review_required' : 'url_configured_only',
        evidence: {
          evidenceUrl: lock.url,
          capturedAt: lock.capturedAt,
          capturedBy: 'configured_url',
          note: lock.evidenceNote ?? '来自商品 URL 锁定库；只同步真实详情页。',
        },
        raw: lock.raw,
      }
    })
    .filter((record): record is MarketplacePriceRecord => record !== null)
}

function normalizeLegacyJdMonitor(value: unknown): MarketplacePriceRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []

  return Object.entries(value as Record<string, LegacyJdPriceMonitorItem>)
    .map(([productId, item]): MarketplacePriceRecord | null => {
      if (!item || typeof item !== 'object') return null
      const query = String(item.query ?? '').trim()
      if (!query) return null
      const configuredUrl = getSearchUrl('jd', query)
      return {
        source: 'jd' as const,
        sourceLabel: sourceLabels.jd,
        sourceType: sourceTypes.jd,
        productId,
        query,
        configuredUrl,
        matchTitle: item.matchTitle,
        price: isDecimalPrice(item.jdSelfPrice) ? undefined : item.jdSelfPrice,
        preSubsidyPrice: item.priceType === 'pre_subsidy_price' && !isDecimalPrice(item.jdSelfPrice) ? item.jdSelfPrice : undefined,
        postSubsidyPrice: isDecimalPrice(item.jdSelfPrice) ? item.jdSelfPrice : undefined,
        priceType: isDecimalPrice(item.jdSelfPrice) ? 'url_configured_only' : item.priceType ?? 'display_price',
        priceBasis: isDecimalPrice(item.jdSelfPrice)
          ? `${item.priceBasis ?? getPriceBasis('jd')}；历史京东监控为小数价格，按国补后/优惠后线索处理，不作为主零售价。`
          : item.priceBasis ?? getPriceBasis('jd'),
        taxIncluded: true,
        serviceIncluded: true,
        confidence: 'manual' as const,
        collectionStatus: 'manual_review_required' as const,
        evidence: {
          evidenceUrl: configuredUrl,
          capturedAt: item.capturedAt,
          capturedBy: 'legacy_jd_monitor' as const,
          note: '来自既有 latest-jd-price-monitor.json，但证据 URL 是京东店铺搜索页；只作人工线索，不能作为正式京东自营价。',
        },
        raw: { source: item.source, jdSelfPrice: item.jdSelfPrice },
      }
    })
    .filter((record): record is MarketplacePriceRecord => record !== null)
}

function dedupeRecords(records: MarketplacePriceRecord[]) {
  const byKey = new Map<string, MarketplacePriceRecord>()

  const hasAnyPrice = (record: MarketplacePriceRecord) => (
    record.price !== undefined
    || record.preSubsidyPrice !== undefined
    || record.postSubsidyPrice !== undefined
    || record.couponAdjustedPrice !== undefined
  )

  const isManualReviewOverride = (record: MarketplacePriceRecord) => {
    const rawText = record.raw ? JSON.stringify(record.raw) : ''
    return record.collectionStatus === 'manual_review_required'
      && record.evidence.capturedBy === 'manual'
      && !hasAnyPrice(record)
      && (
        String(record.priceType) === 'manual_review_required'
        || rawText.includes('rejectedPrice')
        || /403|配置|不一致|复核|拒绝/.test(`${record.priceBasis} ${record.evidence.note ?? ''} ${rawText}`)
      )
  }

  const isFreshExactLinkBackfill = (record: MarketplacePriceRecord) => {
    const rawText = record.raw ? JSON.stringify(record.raw) : ''
    const directOfficial = isDirectOfficialUrl(record.source, record.evidence.evidenceUrl ?? record.configuredUrl)
    return record.collectionStatus === 'captured'
      && record.confidence === 'confirmed'
      && record.evidence.capturedBy === 'manual'
      && directOfficial
      && !hasAnyPrice(record)
      && /fresh_exact_link_backfill_only/.test(rawText)
  }

  const isManualUnavailableOverride = (record: MarketplacePriceRecord) => {
    const rawText = record.raw ? JSON.stringify(record.raw) : ''
    return record.collectionStatus === 'unavailable'
      && record.evidence.capturedBy === 'manual'
      && !hasAnyPrice(record)
      && /无同配|未找到|错配|不写错配|不作为报价参考/.test(`${record.priceBasis} ${record.evidence.note ?? ''} ${rawText}`)
  }

  const priorityOf = (record: MarketplacePriceRecord) => {
    let priority = 0
    const directOfficial = isDirectOfficialUrl(record.source, record.evidence.evidenceUrl ?? record.configuredUrl)
    if (directOfficial) priority += 15
    if (record.collectionStatus === 'captured') priority += 30
    if (record.confidence === 'confirmed') priority += 12
    if (record.price !== undefined || record.preSubsidyPrice !== undefined || record.postSubsidyPrice !== undefined || record.couponAdjustedPrice !== undefined) priority += 20
    if (record.evidence.capturedBy === 'legacy_jd_monitor') priority += 9
    if (record.evidence.capturedBy === 'browser_rpa') priority += 8
    if (record.evidence.capturedBy === 'justoneapi') priority += 7
    if (record.evidence.capturedBy === 'manual') priority += 5
    if (record.collectionStatus === 'url_configured_only') priority -= 10
    if (record.collectionStatus === 'manual_review_required') priority -= 20
    if (record.collectionStatus === 'unavailable') priority -= 40
    // Even when the item is unavailable, an exact direct detail page is still a better lock than a generic search page.
    if (record.collectionStatus === 'unavailable' && directOfficial) priority += 20
    return priority
  }

  const capturedAtTime = (record: MarketplacePriceRecord) => {
    const value = record.evidence.capturedAt ? Date.parse(record.evidence.capturedAt) : Number.NaN
    return Number.isFinite(value) ? value : 0
  }

  for (const record of records) {
    const key = `${record.source}:${record.productId}`
    const previous = byKey.get(key)
    if (isManualReviewOverride(record)) {
      byKey.set(key, record)
      continue
    }
    if (isFreshExactLinkBackfill(record)) {
      byKey.set(key, record)
      continue
    }
    if (isManualUnavailableOverride(record)) {
      byKey.set(key, record)
      continue
    }
    if (previous && isManualReviewOverride(previous) && !hasAnyPrice(record)) continue
    if (previous && isFreshExactLinkBackfill(previous) && !hasAnyPrice(record)) continue
    if (previous && isManualUnavailableOverride(previous) && !hasAnyPrice(record)) continue
    if (!previous) {
      byKey.set(key, record)
      continue
    }
    const priority = priorityOf(record)
    const previousPriority = priorityOf(previous)
    if (priority > previousPriority || (priority === previousPriority && capturedAtTime(record) >= capturedAtTime(previous))) {
      byKey.set(key, record)
    }
  }
  return Array.from(byKey.values())
}

function buildSourceSummaries(records: MarketplacePriceRecord[]): MarketplacePriceSnapshot['sources'] {
  const captureMethodBySource: Record<MarketplaceSource, MarketplacePriceSnapshot['sources'][number]['captureMethod']> = {
    jd: records.some((record) => record.source === 'jd' && record.evidence.capturedBy === 'justoneapi')
      ? 'justoneapi'
      : records.some((record) => record.source === 'jd' && record.evidence.capturedBy === 'legacy_jd_monitor') ? 'legacy_json' : 'configured_url_placeholder',
    lenovo_official: 'configured_url_placeholder',
    taobao_subsidy: records.some((record) => record.source === 'taobao_subsidy' && record.evidence.capturedBy === 'justoneapi') ? 'justoneapi' : 'configured_url_placeholder',
  }

  return (['jd', 'lenovo_official', 'taobao_subsidy'] as MarketplaceSource[]).map((source) => {
    const sourceRecords = records.filter((record) => record.source === source)
    if (sourceRecords.some((record) => record.evidence.capturedBy === 'manual')) captureMethodBySource[source] = 'manual_snapshot'
    if (sourceRecords.some((record) => record.evidence.capturedBy === 'justoneapi')) captureMethodBySource[source] = 'justoneapi'
    if (sourceRecords.some((record) => record.evidence.capturedBy === 'browser_rpa')) captureMethodBySource[source] = 'browser_rpa'
    return {
      source,
      label: sourceLabels[source],
      sourceType: sourceTypes[source],
      captureMethod: captureMethodBySource[source],
      recordCount: sourceRecords.length,
      capturedCount: sourceRecords.filter((record) => (
        record.collectionStatus === 'captured'
        && record.confidence === 'confirmed'
        && isDirectOfficialUrl(record.source, record.evidence.evidenceUrl ?? record.configuredUrl)
      )).length,
    }
  })
}

export async function buildMarketplacePriceSnapshot(inputFile?: string): Promise<MarketplacePriceSnapshot> {
  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  const legacyJdPath = path.resolve(webPublicDataDir, 'latest-jd-price-monitor.json')
  const existingMarketplacePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-marketplace-price-snapshot.json')
  const productUrlLockPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-product-url-locks.json')
  const inventoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const manualFiles = await listTodayManualSupplementFiles(inputFile)
  const existingRecords = await fs.readFile(existingMarketplacePath, 'utf-8')
    .then((content) => normalizeManualSnapshot(JSON.parse(content)))
    .catch(() => [])
  const legacyJd = await fs.readFile(legacyJdPath, 'utf-8')
    .then((content) => normalizeLegacyJdMonitor(JSON.parse(content)))
    .catch(() => [])
  const productUrlLocks = await fs.readFile(productUrlLockPath, 'utf-8')
    .then((content) => normalizeProductUrlLocks(JSON.parse(content)))
    .catch(() => [])
  const inventory = await fs.readFile(inventoryPath, 'utf-8')
    .then((content) => JSON.parse(content) as StandardInventorySnapshot)
    .catch(() => undefined)

  const manualRecords = await loadManualRecordsFromFiles(manualFiles)

  const seededTargets = new Map<string, string>()
  for (const sku of inventory?.skus ?? []) {
    if (sku.currentStock > 0) seededTargets.set(sku.skuKey, sku.productName)
  }
  for (const record of [...existingRecords, ...legacyJd, ...productUrlLocks, ...manualRecords]) seededTargets.set(record.productId, record.query)
  for (const target of placeholderTargets) seededTargets.set(target.productId, target.query)

  const placeholders = Array.from(seededTargets.entries()).flatMap(([productId, query]) => (
    (['jd', 'lenovo_official', 'taobao_subsidy'] as MarketplaceSource[])
      .map((source) => buildUrlOnlyRecord(source, productId, query))
  ))

  const records = dedupeRecords([...placeholders, ...existingRecords, ...legacyJd, ...productUrlLocks, ...manualRecords])
    .sort((a, b) => a.productId.localeCompare(b.productId) || a.source.localeCompare(b.source))

  return {
    generatedAt: new Date().toISOString(),
    collector: {
      name: 'marketplace-price-collector',
      mode: 'manual_or_sample_placeholder',
      version: 1,
      limitation: '当前占位实现只读取配置 URL、手工/样例快照和既有京东 JSON，不使用真实登录态，不绕过平台访问限制。',
      nextStep: '后续可在保持 records/evidence 结构不变的前提下，将单个平台 source 替换为 Playwright 页面抓取。',
    },
    sources: buildSourceSummaries(records),
    itemCount: records.length,
    records,
  }
}

export async function saveMarketplacePriceSnapshot(inputFile?: string) {
  const snapshot = await buildMarketplacePriceSnapshot(inputFile)
  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })

  const content = JSON.stringify(snapshot, null, 2)
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-marketplace-price-snapshot.json')
  const webPath = path.resolve(webPublicDataDir, 'latest-marketplace-price-snapshot.json')
  await fs.writeFile(artifactPath, content, 'utf-8')
  await fs.writeFile(webPath, content, 'utf-8')

  return { artifactPath, webPath, snapshot }
}
