import type { StandardInventorySnapshot, StandardInventorySku } from '../types.js'

export type ExternalPlatform = 'lenovoOfficial' | 'jd' | 'taobao'
export type PriceSourceName =
  | '库存进货价'
  | '实时进货价'
  | '灰渠批发价'
  | '联想订货平台'
  | '联想官网'
  | '京东'
  | '淘宝百亿补贴'

export type QuotePriceSource = {
  skuKey: string
  productName: string
  pnMtm?: string
  source: PriceSourceName
  sourceType: '成本参考' | '进货参考' | '销售参考' | '低价参考'
  price?: number
  taxIncluded: boolean
  serviceIncluded: boolean
  capturedAt?: string
  publishedAt?: string
  confidence: '高' | '中' | '低'
  evidence: string
  available: boolean
}

export type SourceSyncStatus = {
  source: PriceSourceName
  status: 'fresh' | 'stale' | 'missing'
  capturedAt?: string
  itemCount: number
  note: string
}

export type QuoteDecision = {
  skuKey: string
  productName: string
  pnMtm?: string
  category?: string
  currentStock: number
  sellableStock: number
  serialCount: number
  inventoryAverageCost?: number
  realtimePurchasePrice?: number
  grayWholesalePrice?: number
  grayRetailPreSubsidyPrice?: number
  graySubsidyPrice?: number
  lenovoOfficialPrice?: number
  lenovoOfficialPostSubsidyPrice?: number
  jdPrice?: number
  jdPostSubsidyPrice?: number
  platformSubsidyPrice?: number
  taobaoPrice?: number
  fullServiceSubsidyPrice?: number
  regularChannelSubsidyPrice?: number
  defensiveLowSubsidyPrice?: number
  recommendedPreSubsidyPrice?: number
  floorPreSubsidyPrice?: number
  expectedRegularMargin?: number
  expectedDefensiveMargin?: number
  approval: '销售可用' | '店长审批' | '老板审批'
  riskLevel: '低' | '中' | '高'
  approvalReasons: string[]
  salesNote: string
  riskNote: string
  jdUrl?: string
  lenovoUrl?: string
  tmallUrl?: string
  priceSources: QuotePriceSource[]
  match: {
    realtimePurchasePrice?: MatchMeta
    grayWholesalePrice?: MatchMeta
  }
}

export type SubsidyRule = {
  region: string
  ratio: number
  cap: number
  categoryCaps: {
    computer: number
    tablet: number
    phone: number
  }
  eligibleCategories: string[]
  eligibilityNote: string
  regularApprovalRequired: boolean
  defensiveApprovalRequired: boolean
  serviceRiskRequired: boolean
}

export type PriceMonitorEntry = {
  price?: number
  jdSelfPrice?: number
  lenovoOfficialPrice?: number
  taobaoPrice?: number
  preSubsidyPrice?: number
  postSubsidyPrice?: number
  couponAdjustedPrice?: number
  capturedAt?: string
  publishedAt?: string
  source?: string
  priceBasis?: string
  query?: string
  matchTitle?: string
  evidence?: string
  url?: string
  configuredUrl?: string
  collectionStatus?: 'captured' | 'manual_review_required' | 'url_configured_only' | 'unavailable'
  confidence?: string
  raw?: Record<string, unknown>
}

export type DistributorQuote = {
  pnMtm?: string
  productName: string
  pickupPrice?: number
  subsidyPrice?: number
  quoteDate?: string
  sourceFile?: string
  matchFingerprint?: string
  skuKey?: string
  libraryMatch?: {
    primarySkuKey?: string
    confidence?: number
    evidence?: string
  }
}

export type GrayWholesaleQuote = {
  productText: string
  marketWholesalePrice?: number
  maskedPriceText?: string
  quoteDate?: string
  capturedAt?: string
  taxIncluded?: boolean
  serviceIncluded?: boolean
  matchFingerprint?: string
  evidenceText?: string
}

export type PriceEngineInput = {
  inventory: StandardInventorySnapshot
  distributorQuotes: DistributorQuote[]
  grayWholesaleQuotes: GrayWholesaleQuote[]
  priceMonitors: Partial<Record<ExternalPlatform, Record<string, PriceMonitorEntry>>>
  manualPriceOverrides?: Record<string, ManualPriceOverride>
  educationSubsidies?: Record<string, number>
  canonicalTitles?: Record<string, string>
  sourceStatus: SourceSyncStatus[]
}

export type ManualPriceOverride = {
  realtimePurchasePrice?: number
  marketWholesalePrice?: number
  retailPreSubsidyPrice?: number
  defensivePostSubsidyPrice?: number
  updatedAt: string
}

type MatchMeta = {
  method: 'sku' | 'pn_mtm' | 'configuration_fingerprint'
  confidence: number
  evidence: string
}

type MatchedQuote<T> = {
  quote: T
  match: MatchMeta
}

const subsidyRule: SubsidyRule = {
  region: '河南',
  ratio: 0.15,
  cap: 1500,
  categoryCaps: {
    computer: 1500,
    tablet: 500,
    phone: 500,
  },
  eligibleCategories: ['游戏笔记本', '轻薄笔记本', '平板电脑', '一体机', '商务台式', '游戏主机', '手机'],
  eligibilityNote: '2026 门店执行口径：电脑类最高补 15%，单台封顶 1500 元；手机和平板 6000 元以下补 15%，单台封顶 500 元，6000 元及以上不参与补贴；只补一级能耗，需在报价证据中确认；配件、显示器、打印机、耳机音箱等非国补目录只展示零售价。',
  regularApprovalRequired: false,
  defensiveApprovalRequired: true,
  serviceRiskRequired: true,
}

const marketplaceFreshnessHours = 36
const unavailableRetailPattern = /已下架|下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知|不可购买|停止销售|商品不存在/i

function normalizeColorSignal(value?: string) {
  const text = String(value ?? '')
  if (!text) return undefined
  if (/冰魄白|月幕白|白色|白|WHE/i.test(text)) return 'white'
  if (/碳晶黑|钛晶黑|幻影黑|黑色|黑/i.test(text)) return 'black'
  if (/深空灰|卷云灰|灰色|灰/i.test(text)) return 'gray'
  if (/霜雪银|银色|银/i.test(text)) return 'silver'
  return undefined
}

function getSkuColorSignal(sku: StandardInventorySku) {
  return normalizeColorSignal(`${sku.productName} ${sku.spec ?? ''} ${sku.pnMtm ?? ''}`)
}

function getMonitorEntryInspectionText(entry?: PriceMonitorEntry) {
  return [
    entry?.matchTitle,
    entry?.query,
    entry?.priceBasis,
    entry?.evidence,
    entry?.url,
    entry?.configuredUrl,
    entry?.raw ? JSON.stringify(entry.raw) : '',
  ].filter(Boolean).join(' ')
}

function isFreshMarketplaceCapture(capturedAt?: string) {
  if (!capturedAt) return false
  const parsed = Date.parse(capturedAt)
  if (!Number.isFinite(parsed)) return false
  return (Date.now() - parsed) / 36e5 <= marketplaceFreshnessHours
}

function isUsableRetailPlatformEntry(entry: PriceMonitorEntry | undefined, sku: StandardInventorySku) {
  if (!entry) return false
  if (!isFreshMarketplaceCapture(entry.capturedAt)) return false
  if (entry.collectionStatus === 'unavailable') return false
  const inspectionText = getMonitorEntryInspectionText(entry)
  if (unavailableRetailPattern.test(inspectionText)) return false
  const skuColor = getSkuColorSignal(sku)
  const entryColor = normalizeColorSignal(inspectionText)
  if (skuColor && entryColor && skuColor !== entryColor) return false
  return true
}

function isSelectableRetailPlatformEntry(entry: PriceMonitorEntry | undefined, sku: StandardInventorySku) {
  if (!entry) return false
  const comparablePrice = getEntryPreSubsidyPrice(entry)
  if (!comparablePrice || !Number.isFinite(comparablePrice) || comparablePrice <= 0) return false
  const inspectionText = getMonitorEntryInspectionText(entry)
  // 门店标价基准可沿用已确认的历史可见价格；可售性只影响复核状态，不影响锁价展示。
  const skuColor = getSkuColorSignal(sku)
  const entryColor = normalizeColorSignal(inspectionText)
  if (skuColor && entryColor && skuColor !== entryColor) return false
  return true
}

function normalizeConfigText(value?: string) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/酷睿|英特尔|INTEL/g, '')
    .replace(/锐龙|AMD/g, '')
    .replace(/集成显卡|集显|集\//g, '集')
    .replace(/固态|SSD/g, '')
    .replace(/RTX\s*/g, 'RTX')
    .replace(/GB/g, 'G')
    .replace(/1TB/g, '1T')
    .replace(/2TB/g, '2T')
}

export function buildConfigFingerprint(productName?: string, spec?: string, pnMtm?: string) {
  const text = normalizeConfigText(`${productName ?? ''} ${spec ?? ''}`)
  const tokens = new Set<string>()

  const addAll = (pattern: RegExp, mapper = (value: string) => value) => {
    for (const match of text.matchAll(pattern)) tokens.add(mapper(match[1] ?? match[0]))
  }
  const addGroup = (pattern: RegExp, groupIndex: number, mapper = (value: string) => value) => {
    for (const match of text.matchAll(pattern)) {
      const token = match[groupIndex]
      if (token) tokens.add(mapper(token))
    }
  }

  addAll(/(YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|GEEKPRO|THINKPAD|THINKBOOK|THINKCENTRE|THINKSTATION)/g, (value) => value === 'LECOO' ? '来酷' : value === 'LEGION' ? '拯救者' : value)
  addAll(/(THINKBOOK\d{2}\+?|THINKPAD[A-Z0-9]+|小新(?:PRO)?(?:11|12\.?1|14|15|16|24|27)(?:C|GT)?|YOGA(?:27|32|360(?:14)?)|酷\d{3,4}|[RY]\d{4}P?|战\d{4}|锋\d{4}|N\d{3}[A-Z]?|TB\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[456]C)/g)
  addAll(/(PRO\d{2})(?:C|GT)?/g)
  addAll(/(TB\d{3}[A-Z]?)/g)
  if (/N176B?|战7000/.test(text)) tokens.add('战7000')
  addAll(/(ULTRA[579][-]?\d{3}[A-Z]*|CORE[3579][-]?\d{3}[A-Z]*|U[3579][-]?\d{3,4}[A-Z]*|I[3579][-]?\d{4,5}[A-Z]*)/g, (value) => value.replace(/^ULTRA/, 'U').replace(/^CORE/, 'U'))
  addAll(/(ULTRA[579]|CORE[3579]|U[3579]|I[3579]|R[3579])/g, (value) => value.replace(/^ULTRA/, 'U').replace(/^CORE/, 'U'))
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{5})(?:HX|H|U|V|P)/g, (value) => `CPU${value}`)
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{3,4})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/R[3579]-[A-Z]?([0-9]{3,5})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/R[3579]-?H?([0-9]{3,5})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/(?:^|[^0-9])(?:2)?(125|170|225|255)(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/(?:RTX)?(3050|4060|4070|5060|5070|5070TI|5080|5090)/g)
  addAll(/(?:^|[^0-9])((?:8|12|16|24|32|64)G)/g)
  addGroup(/(?:ULTRA[579][-]?\d{0,4}[A-Z]*|CORE[3579][-]?\d{0,4}[A-Z]*|U[3579][-]?\d{0,4}[A-Z]*|I[3579][-]?\d{0,5}[A-Z]*|R[3579]-[A-Z]?\d{0,5}[A-Z]*)((?:8|12|16|24|32|64)G)/g, 1)
  addAll(/(?:^|[^0-9])((?:128|256|512)G?|[12]T)/g, (value) => /G$|T$/.test(value) ? value : `${value}G`)
  addAll(/(\d{2}(?:\.\d)?寸)/g)

  const modelPrefix = String(pnMtm ?? '').trim().slice(0, 4).toUpperCase()
  if (modelPrefix) tokens.add(modelPrefix)
  return Array.from(tokens).sort().join('|')
}

function getTokenWeight(token: string) {
  if (/^(?:THINKBOOK\d{2}\+?|THINKPAD[A-Z0-9]+|小新(?:PRO)?(?:11|12\.?1|14|15|16|24|27)(?:C|GT)?|YOGA(?:27|32|360(?:14)?)|酷\d{3,4}|[RY]\d{4}P?|战\d{4}|锋\d{4}|N\d{3}[A-Z]?|TB\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[456]C)$/i.test(token)) return 4
  if (/^(?:CPU\d{3,5}|U[3579]|I[3579]|R[3579]|3050|4060|4070|5060|5070|5070TI|5080|5090)/i.test(token)) return 3
  if (/^(?:8|12|16|24|32|64)G$/i.test(token)) return 2
  return 1
}

function getProductBrandBucket(value?: string) {
  const text = String(value ?? '').toUpperCase()
  if (/MOTO|RAZR|摩托/.test(text)) return 'moto'
  if (/来酷|LECOO|斗战者|N\d{3}[A-Z]?/.test(text)) return 'lecoo'
  if (/小新|XIAOXIN|PADPRO|TB\d{3}[A-Z]?/.test(text)) return 'xiaoxin'
  if (/YOGA/.test(text)) return 'yoga'
  if (/THINKPAD|THINKBOOK|THINKCENTRE|THINKSTATION|\bTHINK\b/.test(text)) return 'think'
  if (/拯救者|LEGION|Y7000|Y9000|R7000|R9000/.test(text)) return 'legion'
  return undefined
}

function extractGrayExactModelTokens(value?: string) {
  const text = String(value ?? '').toUpperCase()
  const tokens = new Set<string>()
  for (const match of text.matchAll(/(TB\d{3}[A-Z]{1,2}|510S(?:-\d{2})?|PRO16GT|N1(?:55|75)[A-Z]?|AIR1[34]|1[46]C)/g)) {
    tokens.add(match[1])
  }
  return tokens
}

function extractConfigAtoms(value?: string) {
  const text = String(value ?? '').toUpperCase()
  const atoms = new Set<string>()
  for (const match of text.matchAll(/((?:6|8|12|16|24|32|64)G|(?:128|256|512)G|[12]T|I[3579]-?\d{4,5}[A-Z]*|U[3579]-?\d{3,4}[A-Z]*|R[3579]-?[A-Z]?\d{3,5}[A-Z]*|3050|4060|4070|5060|5070|5080|5090)/g)) {
    const token = match[1].replace(/\s+/g, '')
    atoms.add(
      token
        .replace(/^(I[3579])(\d{4,5})[A-Z]*$/i, '$1-$2')
        .replace(/^(U[3579])(\d{3,4})[A-Z]*$/i, '$1-$2')
        .replace(/^(R[3579])([A-Z]?)(\d{3,5})[A-Z]*$/i, (_, family: string, prefix: string, digits: string) => `${family}-${prefix}${digits}`),
    )
  }
  return atoms
}

function hasMeaningfulExactModelOverlap(leftText?: string, rightText?: string) {
  const leftModels = extractGrayExactModelTokens(leftText)
  const rightModels = extractGrayExactModelTokens(rightText)
  if (!leftModels.size || !rightModels.size) return false
  const overlap = Array.from(leftModels).filter((token) => rightModels.has(token))
  return overlap.length > 0
}

function hasCompatibleConfigAtoms(leftText?: string, rightText?: string) {
  const leftAtoms = extractConfigAtoms(leftText)
  const rightAtoms = extractConfigAtoms(rightText)
  if (!leftAtoms.size || !rightAtoms.size) return true

  const mustMatchGroups = [
    Array.from(leftAtoms).filter((token) => /^(?:6|8|12|16|24|32|64)G$/.test(token)),
    Array.from(leftAtoms).filter((token) => /^(?:128|256|512)G|[12]T$/.test(token)),
    Array.from(leftAtoms).filter((token) => /^(?:I[3579]-?\d{4,5}[A-Z]*|U[3579]-?\d{3,4}[A-Z]*|R[3579]-?[A-Z]?\d{3,5}[A-Z]*)$/.test(token)),
  ]

  for (const group of mustMatchGroups) {
    if (!group.length) continue
    const rightGroup = group.filter((token) => rightAtoms.has(token))
    if (!rightGroup.length) return false
  }
  return true
}

function isProductBrandCompatible(leftText: string, rightText: string) {
  const leftBrand = getProductBrandBucket(leftText)
  const rightBrand = getProductBrandBucket(rightText)
  if (!leftBrand || !rightBrand) return true
  return leftBrand === rightBrand
}

function getFingerprintScore(a: string, b: string) {
  const left = new Set(a.split('|').filter(Boolean))
  const right = new Set(b.split('|').filter(Boolean))
  if (!left.size || !right.size) return 0

  const pick = (tokens: Set<string>, kind: 'series' | 'model' | 'cpu' | 'gpu' | 'memory' | 'storage') => Array.from(tokens).filter((token) => {
    if (kind === 'series') return /^(?:YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|GEEKPRO|THINKPAD|THINKBOOK|THINKCENTRE|THINKSTATION)$/i.test(token)
    if (kind === 'model') return /^(?:THINKBOOK\d{2}\+?|THINKPAD[A-Z0-9]+|小新(?:PRO)?(?:11|12\.?1|14|15|16|24|27)(?:C|GT)?|YOGA(?:27|32|360(?:14)?)|酷\d{3,4}|[RY]\d{4}P?|战\d{4}|锋\d{4}|N\d{3}[A-Z]?|TB\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[456]C)$/i.test(token)
    if (kind === 'cpu') return /^(?:CPU\d{3,5}|U[3579]|I[3579]|R[3579])/i.test(token)
    if (kind === 'gpu') return /^(?:3050|4060|4070|5060|5070|5070TI|5080|5090)$/i.test(token)
    if (kind === 'memory') return /^(?:8|12|16|24|32|64)G$/i.test(token)
    return /^(?:(?:128|256|512)G|[12]T)$/i.test(token)
  })
  const hasOverlap = (leftTokens: string[], rightTokens: string[]) => leftTokens.some((token) => rightTokens.includes(token))
  const leftSeries = pick(left, 'series')
  const rightSeries = pick(right, 'series')
  const hasSeriesOverlap = hasOverlap(leftSeries, rightSeries)
  if (leftSeries.length && rightSeries.length && !hasSeriesOverlap) return 0
  const leftModels = pick(left, 'model')
  const rightModels = pick(right, 'model')
  const hasModelOverlap = hasOverlap(leftModels, rightModels)
  const hasModelConflict = leftModels.length > 0 && rightModels.length > 0 && !hasModelOverlap
  const hasAnyModel = leftModels.length > 0 || rightModels.length > 0

  const criticalKinds: Array<'model' | 'cpu' | 'gpu' | 'memory' | 'storage'> = ['model', 'cpu', 'gpu', 'memory', 'storage']
  let criticalCompared = 0
  let criticalMatched = 0
  for (const kind of criticalKinds) {
    const leftCritical = pick(left, kind)
    const rightCritical = pick(right, kind)
    if (!leftCritical.length || !rightCritical.length) continue
    criticalCompared += 1
    if (hasOverlap(leftCritical, rightCritical)) criticalMatched += 1
  }
  if (!hasModelConflict && (!hasAnyModel || hasModelOverlap) && criticalCompared >= 4 && criticalMatched >= 4) return 1
  if (!hasModelConflict && hasModelOverlap && criticalCompared >= 3 && criticalMatched >= 3) return 0.92

  let matched = 0
  let totalWeight = 0
  for (const token of left) {
    const weight = getTokenWeight(token)
    totalWeight += weight
    if (right.has(token)) matched += weight
  }
  const weightedScore = matched / Math.max(totalWeight, 1)
  return weightedScore >= 0.82 ? 1 : weightedScore
}

function roundPrice(value: number) {
  return Math.round(value / 10) * 10 - 1
}

function normalizeTo99EndingPrice(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return undefined
  const normalized = Math.ceil((value + 1) / 100) * 100 - 1
  return Math.max(normalized, 99)
}

function getMaskedWholesaleEstimate(maskedPriceText?: string) {
  if (!maskedPriceText || !maskedPriceText.includes('*')) return undefined
  const normalized = maskedPriceText.replace(/[^\d*]/g, '')
  if (!normalized || !/\d/.test(normalized)) return undefined
  const estimated = Number(normalized.replace(/\*/g, '5'))
  return Number.isFinite(estimated) && estimated > 0 ? estimated : undefined
}

function getGrayWholesaleBasis(quote?: GrayWholesaleQuote) {
  if (!quote) return undefined
  return quote.marketWholesalePrice ?? getMaskedWholesaleEstimate(quote.maskedPriceText)
}

function normalizeTo9EndingPrice(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return undefined
  return Math.max(Math.ceil(value / 10) * 10 - 1, 9)
}

function getAccessoryRetailPrice(officialPrice: number) {
  return normalizeTo9EndingPrice(officialPrice * 1.1)
}

function getAccessoryMarkup(officialPrice: number) {
  const retailPrice = getAccessoryRetailPrice(officialPrice)
  return retailPrice ? Number((retailPrice - officialPrice).toFixed(2)) : 0
}

function getSubsidyCategory(sku: StandardInventorySku): 'computer' | 'tablet' | 'phone' | undefined {
  const text = `${sku.category ?? ''} ${sku.jdSubcategory ?? ''} ${sku.productName} ${sku.spec ?? ''}`
  if (/电脑配件|耳机音箱|显示器|打印机|喷墨|墨仓|打印|复印|扫描|CM408|键盘|鼠标|适配器|支架|保护夹|钢化膜|背包|耗材|手写笔|散热|贴膜/i.test(text)) return undefined
  if (/平板|\bTAB\b|\bPAD\b|(?<![0-9A-Z])TB\d+|(?:拯救者\s*)?Y700(?!0)/i.test(text)) return 'tablet'
  if (/手机|moto|razr|edge|PHN|XT\d+|折叠机|直板机/i.test(text)) return 'phone'
  if (/游戏笔记本|轻薄笔记本|一体机|商务台式|游戏主机|笔记本|电脑|主机|台式|拯救者|LEGION|小新|YOGA|来酷|LECOO|斗战者|ThinkPad|ThinkBook|GeekPro|天逸/i.test(text)) return 'computer'
  return undefined
}

function getSkuSearchText(sku: StandardInventorySku) {
  return `${sku.productName} ${sku.spec ?? ''} ${sku.category ?? ''} ${sku.jdSubcategory ?? ''} ${sku.sourceCategory ?? ''}`.toUpperCase()
}

function isSameRetailPriceCategory(sku: StandardInventorySku) {
  return /一体机|台式|游戏主机|主机|平板|\bTAB\b|\bPAD\b|(?<![0-9A-Z])TB\d+|打印机|显示器|电脑配件|耳机音箱|键盘|鼠标|适配器|电源|充电器|支架|保护夹|钢化膜|背包|配件|耗材/i.test(getSkuSearchText(sku))
}

function isGamingNotebook(sku: StandardInventorySku) {
  const categoryText = `${sku.category ?? ''} ${sku.sourceCategory ?? ''} ${sku.jdSubcategory ?? ''}`
  if (/轻薄|平板|手机|配件|显示器|打印|一体机|台式/i.test(categoryText)) return false
  if (/游戏笔记本|游戏本/i.test(categoryText)) return true
  return /拯救者|LEGION|斗战者|[RY]\d{4}P?/i.test(getSkuSearchText(sku))
}

function isWhiteGamingNotebook(sku: StandardInventorySku) {
  return isGamingNotebook(sku) && getSkuColorSignal(sku) === 'white'
}

function isThinNotebook(sku: StandardInventorySku) {
  return /轻薄|小新|YOGA|AIR|PRO14|PRO16|来酷|LECOO/i.test(getSkuSearchText(sku))
}

function isNotebookSku(sku: StandardInventorySku) {
  const text = getSkuSearchText(sku)
  if (isAccessorySku(sku)) return false
  if (/台式|一体机|显示器|平板|手机|配件|打印|耳机|路由|摄像头/i.test(text)) return false
  return /笔记本|游戏本|轻薄本|YOGA|小新|拯救者|LEGION|ThinkPad|ThinkBook|来酷|LECOO|斗战者|[RY]\d{4}P?/i.test(text)
}

function isAccessorySku(sku: StandardInventorySku) {
  return /电脑配件|耳机音箱|打印机|喷墨|墨仓|打印|复印|扫描|CM408|键盘|鼠标|适配器|电源|充电器|支架|保护夹|钢化膜|背包|配件|耗材|手写笔|散热/i.test(getSkuSearchText(sku))
}

function getRetailPricePolicy(sku: StandardInventorySku, officialPrice?: number) {
  if (!officialPrice) return undefined
  if (isAccessorySku(sku)) {
    const markup = getAccessoryMarkup(officialPrice)
    return { markup, label: '配件按采集价 ×1.1 后取9尾' }
  }
  const subsidyCategory = getSubsidyCategory(sku)
  if (subsidyCategory === 'tablet' || subsidyCategory === 'phone') return { markup: 0, label: '手机/平板平台最低价99尾' }
  if (isSameRetailPriceCategory(sku)) return { markup: 0, label: subsidyCategory ? '电脑平台最低价99尾' : '平台最低价同价类' }
  if (isGamingNotebook(sku)) {
    const baseMarkup = officialPrice >= 10000 ? 400 : 300
    const whiteExtraMarkup = isWhiteGamingNotebook(sku) ? 500 : 0
    const markup = baseMarkup + whiteExtraMarkup
    return { markup, label: whiteExtraMarkup ? `电脑平台最低价 +${baseMarkup}+白色游戏本${whiteExtraMarkup}` : `电脑平台最低价 +${markup}` }
  }
  if (isThinNotebook(sku)) {
    const markup = officialPrice >= 5000 ? 300 : 200
    return { markup, label: `电脑平台最低价 +${markup}` }
  }
  return undefined
}

type RetailPlatformPrice = {
  source: 'jd' | 'lenovo_official' | 'taobao_subsidy'
  price: number
}

function getAvailableRetailPlatformPrices(input: {
  jdPrice?: number
  lenovoOfficialPrice?: number
  taobaoPrice?: number
}) {
  return [
    { source: 'jd' as const, price: input.jdPrice },
    { source: 'lenovo_official' as const, price: input.lenovoOfficialPrice },
    { source: 'taobao_subsidy' as const, price: input.taobaoPrice },
  ].filter((item): item is RetailPlatformPrice => (
    typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0
  ))
}

function lowestRetailPlatformPrice(items: RetailPlatformPrice[]) {
  if (!items.length) return undefined
  return items.reduce((lowest, item) => (item.price < lowest.price ? item : lowest), items[0])
}

function getRetailBasePriceSelection(
  sku: StandardInventorySku,
  jdEntry?: PriceMonitorEntry,
  lenovoEntry?: PriceMonitorEntry,
  taobaoEntry?: PriceMonitorEntry,
) {
  const jdPrice = isSelectableRetailPlatformEntry(jdEntry, sku) ? getEntryPreSubsidyPrice(jdEntry, 'jd') : undefined
  const lenovoOfficialPrice = isSelectableRetailPlatformEntry(lenovoEntry, sku) ? getEntryPreSubsidyPrice(lenovoEntry, 'lenovoOfficial') : undefined
  const taobaoPrice = isSelectableRetailPlatformEntry(taobaoEntry, sku) ? (taobaoEntry?.preSubsidyPrice ?? getEntryPrice(taobaoEntry, 'taobao')) : undefined
  const subsidyCategory = getSubsidyCategory(sku)
  const allCandidates = getAvailableRetailPlatformPrices({ jdPrice, lenovoOfficialPrice, taobaoPrice })
  if (!allCandidates.length) return undefined

  const jdLenovoCandidates = allCandidates.filter((item) => item.source === 'jd' || item.source === 'lenovo_official')
  if (isGamingNotebook(sku)) {
    const lenovoCandidate = jdLenovoCandidates.find((item) => item.source === 'lenovo_official')
    const jdCandidate = jdLenovoCandidates.find((item) => item.source === 'jd')
    const selected = lenovoCandidate ? [lenovoCandidate] : jdCandidate ? [jdCandidate] : allCandidates.filter((item) => item.source === 'taobao_subsidy')
    const winner = selected[0]
    if (!winner) return undefined
    return {
      source: selected.map((item) => item.source),
      officialPrice: winner.price,
      baseSource: winner.source,
      selectedPrices: selected,
    }
  }
  // 非游戏本门店零售价基准先取京东自营/联想官旗最低价；淘宝只在两者都缺失时兜底。
  const taobaoCandidates = allCandidates.filter((item) => item.source === 'taobao_subsidy')
  const selected = jdLenovoCandidates.length ? jdLenovoCandidates : taobaoCandidates
  const winner = lowestRetailPlatformPrice(selected)
  if (!winner) return undefined
  return {
    source: selected.map((item) => item.source),
    officialPrice: winner.price,
    baseSource: winner.source,
    selectedPrices: selected,
  }
}

function getNotebookEducationAddBackAmount(sku: StandardInventorySku, educationAmount?: number) {
  const amount = Number(educationAmount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (!isNotebookSku(sku)) return 0
  return Math.min(amount, 500)
}

function getEntryPreSubsidyPrice(entry: PriceMonitorEntry | undefined, platform?: ExternalPlatform) {
  if (!entry) return undefined
  return entry.preSubsidyPrice ?? getEntryPrice(entry, platform)
}

function getEntryPostSubsidyPrice(entry: PriceMonitorEntry | undefined, platform: ExternalPlatform, sku: StandardInventorySku) {
  if (!entry) return undefined
  return entry.postSubsidyPrice ?? calculateStandardSubsidyPrice(getEntryPreSubsidyPrice(entry, platform), sku)
}

function getOfficialRetailReference(
  sku: StandardInventorySku,
  jdEntry?: PriceMonitorEntry,
  lenovoEntry?: PriceMonitorEntry,
  taobaoEntry?: PriceMonitorEntry,
) {
  const selection = getRetailBasePriceSelection(sku, jdEntry, lenovoEntry, taobaoEntry)
  const officialPrice = selection?.officialPrice
  const policy = getRetailPricePolicy(sku, officialPrice)
  if (!officialPrice || !policy) return undefined
  const sourceLabels = selection.selectedPrices.map((item) => item.source === 'jd'
    ? '京东自营'
    : item.source === 'lenovo_official'
      ? '联想官旗'
      : '天猫/淘宝补充')
  const source = sourceLabels.length > 1 ? `${sourceLabels.join('/')}最低价` : sourceLabels[0]
  return {
    officialPrice,
    policy,
    source,
    storeRetailPrice: isAccessorySku(sku)
      ? getAccessoryRetailPrice(officialPrice) ?? officialPrice
      : normalizeTo99EndingPrice(officialPrice + policy.markup) ?? officialPrice + policy.markup,
  }
}

type LockedRetailReference = {
  officialPrice: number
  policy: {
    markup: number
    label: string
  }
  source: string
  storeRetailPrice: number
  fallback: boolean
}

function getFallbackRetailPricePolicy(sku: StandardInventorySku, basisPrice: number) {
  if (isAccessorySku(sku)) {
    const markup = Math.max(Math.round(basisPrice * 0.2), 20)
    return { markup, label: '门店锁定价：成本/进货参考 + 配件安全毛利，9尾待复核' }
  }
  const subsidyCategory = getSubsidyCategory(sku)
  if (subsidyCategory === 'tablet' || subsidyCategory === 'phone') {
    const markup = Math.max(Math.round(basisPrice * 0.08), 100)
    return { markup, label: '门店锁定价：成本/进货参考 + 智能终端安全毛利，99尾待复核' }
  }
  if (subsidyCategory === 'computer' || isPrimaryComputerSku(sku)) {
    const markup = Math.max(Math.round(basisPrice * 0.08), 300)
    return { markup, label: '门店锁定价：成本/进货参考 + 电脑安全毛利，99尾待复核' }
  }
  const markup = Math.max(Math.round(basisPrice * 0.12), 50)
  return { markup, label: '门店锁定价：成本/进货参考 + 安全毛利，9尾待复核' }
}

function getCategoryGuardrailRetailPrice(sku: StandardInventorySku) {
  const text = getSkuSearchText(sku)
  if (/MOTO|PHN|XT\d+|RAZR|EDGE|手机/.test(text)) {
    if (/16\+512|16G\+512|16G512|512/.test(text)) return 2999
    if (/12\+256|12G\+256|12G256|256/.test(text)) return 2499
    if (/8\+128|8G\+128|8G128|128/.test(text)) return 999
    return 1999
  }
  if (/手写笔|STYLUS|PEN/.test(text)) return 499
  if (/磁吸.*键盘|键盘.*支架|KEYBOARD/.test(text)) return 499
  if (/保护夹|保护壳|保护套|FOLIO|CASE/.test(text)) return 199
  if (/钢化膜|贴膜|膜/.test(text)) return 99
  if (/打印机/.test(text)) return 999
  if (/键盘/.test(text)) return 199
  if (/鼠标/.test(text)) return 99
  if (/适配器|电源|充电器/.test(text)) return 199
  return undefined
}

function getFallbackRetailReference(input: {
  sku: StandardInventorySku
  jdPrice?: number
  lenovoOfficialPrice?: number
  taobaoPrice?: number
  inventoryCost?: number
  realtimePurchasePrice?: number
  grayWholesalePrice?: number
  orderPlatformPrice?: number
}): LockedRetailReference | undefined {
  const platformPrice = minDefined([input.jdPrice, input.lenovoOfficialPrice, input.taobaoPrice])
  const platformSource = platformPrice
    ? [
      input.jdPrice === platformPrice ? '京东已取价' : undefined,
      input.lenovoOfficialPrice === platformPrice ? '官旗已取价' : undefined,
      input.taobaoPrice === platformPrice ? '天猫/淘宝已取价' : undefined,
    ].filter(Boolean).join('+')
    : ''
  const guardrailPrice = getCategoryGuardrailRetailPrice(input.sku)
  const basisPrice = platformPrice ?? maxDefined([
    input.realtimePurchasePrice,
    input.inventoryCost,
    input.grayWholesalePrice,
    input.orderPlatformPrice,
  ]) ?? guardrailPrice
  if (!basisPrice) return undefined
  const policy = platformPrice
    ? getRetailPricePolicy(input.sku, platformPrice)
    : getFallbackRetailPricePolicy(input.sku, basisPrice)
  if (!policy) return undefined
  const storeRetailPrice = isAccessorySku(input.sku) || !getSubsidyCategory(input.sku)
    ? normalizeTo9EndingPrice(basisPrice + policy.markup)
    : normalizeTo99EndingPrice(basisPrice + policy.markup)
  if (!storeRetailPrice) return undefined
  const source = platformPrice
    ? `${platformSource || '平台已取价'}锁定待复核`
    : guardrailPrice && basisPrice === guardrailPrice
      ? '类目保底锁定待复核'
      : input.realtimePurchasePrice
      ? '分销进货价锁定待复核'
      : input.inventoryCost
        ? '库存进货价锁定待复核'
        : input.grayWholesalePrice
          ? '灰渠参考价锁定待复核'
          : '联想订货平台价锁定待复核'
  return {
    officialPrice: basisPrice,
    policy,
    source,
    storeRetailPrice,
    fallback: true,
  }
}

function formatRetailReferenceText(source: string, officialPrice: number, markup: number) {
  const sourceLabel = source.endsWith('价') ? source : `${source}价`
  return `${sourceLabel} ${Number(officialPrice.toFixed(2))} 元${markup ? ` + ${markup}` : '同价'}`
}

function getSubsidyCap(sku: StandardInventorySku) {
  const category = getSubsidyCategory(sku)
  return category ? subsidyRule.categoryCaps[category] : 0
}

function calculateSubsidyAmount(price: number, sku: StandardInventorySku) {
  const category = getSubsidyCategory(sku)
  if (!category) return 0
  if ((category === 'tablet' || category === 'phone') && price >= 6000) return 0
  if (category === 'computer') return price >= 10000 ? 1500 : price * subsidyRule.ratio
  return Math.min(price * subsidyRule.ratio, subsidyRule.categoryCaps[category])
}

function calculateSubsidyPrice(price: number | undefined, sku: StandardInventorySku) {
  if (!price || !Number.isFinite(price)) return undefined
  const subsidyAmount = calculateSubsidyAmount(price, sku)
  if (!subsidyAmount) return undefined
  return Math.max(Math.round(price - subsidyAmount), 0)
}

function calculateStandardSubsidyPrice(price: number | undefined, sku: StandardInventorySku) {
  if (!price || !Number.isFinite(price)) return undefined
  const category = getSubsidyCategory(sku)
  if (!category) return undefined
  if ((category === 'tablet' || category === 'phone') && price >= 6000) return undefined
  const subsidyAmount = category === 'computer'
    ? (price >= 10000 ? 1500 : price * subsidyRule.ratio)
    : Math.min(price * subsidyRule.ratio, subsidyRule.categoryCaps[category])
  return Number((price - subsidyAmount).toFixed(2))
}

function calculateGraySuggestedRetailPrice(wholesalePrice: number | undefined, sku: StandardInventorySku) {
  if (!wholesalePrice) return undefined
  const category = getSubsidyCategory(sku)
  const multiplier = category === 'tablet' ? 1.15 : 1.13
  return normalizeTo99EndingPrice(Number((wholesalePrice * multiplier).toFixed(2)))
}

function calculateGraySuggestedSubsidyPrice(preSubsidyPrice: number | undefined, sku: StandardInventorySku) {
  if (!preSubsidyPrice) return undefined
  const category = getSubsidyCategory(sku)
  if (category === 'tablet') return Number((preSubsidyPrice * 0.85).toFixed(2))
  return calculateStandardSubsidyPrice(preSubsidyPrice, sku)
}

function getPreSubsidyPriceForAfterSubsidy(afterSubsidyPrice: number | undefined, sku: StandardInventorySku) {
  if (!afterSubsidyPrice || !Number.isFinite(afterSubsidyPrice)) return undefined
  const category = getSubsidyCategory(sku)
  if (!category) return undefined
  const cap = subsidyRule.categoryCaps[category]
  if (!cap) return undefined
  if (category === 'tablet' || category === 'phone') {
    const uncappedPrePrice = afterSubsidyPrice / (1 - subsidyRule.ratio)
    return uncappedPrePrice < 6000 ? roundPrice(uncappedPrePrice) : undefined
  }
  const capThreshold = cap / subsidyRule.ratio
  const uncappedPrePrice = afterSubsidyPrice / (1 - subsidyRule.ratio)
  const prePrice = uncappedPrePrice <= capThreshold
    ? uncappedPrePrice
    : afterSubsidyPrice + cap
  return roundPrice(prePrice)
}

function getDefensivePlatformSubsidyPrice(sku: StandardInventorySku, jdPrice?: number, taobaoPrice?: number) {
  const candidates = [jdPrice, taobaoPrice]
    .map((price) => normalizeTo99EndingPrice(price))
    .map((price) => calculateStandardSubsidyPrice(price, sku))
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0)
  return candidates.length ? Math.min(...candidates) : undefined
}

function getEntryPrice(entry?: PriceMonitorEntry, platform?: ExternalPlatform) {
  if (!entry) return undefined
  if (platform === 'jd') return entry.jdSelfPrice ?? entry.price
  if (platform === 'lenovoOfficial') return entry.lenovoOfficialPrice ?? entry.price
  if (platform === 'taobao') return entry.taobaoPrice ?? entry.price
  return entry.price
}

function getMonitorEntry(map: Record<string, PriceMonitorEntry> | undefined, sku: StandardInventorySku) {
  if (!map) return undefined
  return map[sku.skuKey] ?? (sku.skuCode ? map[sku.skuCode] : undefined) ?? (sku.productCode ? map[sku.productCode] : undefined) ?? (sku.pnMtm ? map[sku.pnMtm] : undefined)
}

function matchDistributorQuote(sku: StandardInventorySku, quotes: DistributorQuote[]): MatchedQuote<DistributorQuote> | undefined {
  const skuMatch = quotes.find((quote) => (
    quote.skuKey
    && quote.skuKey === sku.skuKey
    && quote.pickupPrice
  ))
  if (skuMatch) {
    return { quote: skuMatch, match: { method: 'sku', confidence: 1, evidence: skuMatch.sourceFile ?? skuMatch.productName } }
  }
  const librarySkuMatch = quotes.find((quote) => (
    quote.libraryMatch?.primarySkuKey
    && quote.libraryMatch.primarySkuKey === sku.skuKey
    && quote.pickupPrice
  ))
  if (librarySkuMatch) {
    return {
      quote: librarySkuMatch,
      match: {
        method: 'sku',
        confidence: Number(librarySkuMatch.libraryMatch?.confidence ?? 1) || 1,
        evidence: librarySkuMatch.libraryMatch?.evidence ?? librarySkuMatch.sourceFile ?? librarySkuMatch.productName,
      },
    }
  }
  const pnMatch = quotes.find((quote) => quote.pnMtm && sku.pnMtm && quote.pnMtm.toUpperCase() === sku.pnMtm.toUpperCase() && quote.pickupPrice)
  if (pnMatch) {
    return { quote: pnMatch, match: { method: 'pn_mtm', confidence: 1, evidence: pnMatch.sourceFile ?? pnMatch.productName } }
  }
  const fingerprint = buildConfigFingerprint(sku.productName, sku.spec, sku.pnMtm)
  let best: MatchedQuote<DistributorQuote> | undefined
  for (const quote of quotes) {
    if (!quote.pickupPrice) continue
    if (
      quote.pnMtm
      && sku.pnMtm
      && quote.pnMtm.toUpperCase() !== sku.pnMtm.toUpperCase()
    ) continue
    const quoteFingerprint = quote.matchFingerprint || buildConfigFingerprint(quote.productName, undefined, quote.pnMtm)
    if (!quoteFingerprint) continue
    if (!isProductBrandCompatible(sku.productName, quote.productName)) continue
    const confidence = getFingerprintScore(fingerprint, quoteFingerprint)
    if (confidence >= 0.82 && (!best || confidence > best.match.confidence)) {
      best = {
        quote,
        match: {
          method: 'configuration_fingerprint',
          confidence,
          evidence: quote.libraryMatch?.evidence ?? quote.sourceFile ?? quote.productName,
        },
      }
    }
  }
  if (best) return best
  return undefined
}

function matchGrayQuote(sku: StandardInventorySku, quotes: GrayWholesaleQuote[]): MatchedQuote<GrayWholesaleQuote> | undefined {
  if (isAccessorySku(sku)) return undefined
  const fingerprint = buildConfigFingerprint(sku.productName, sku.spec, sku.pnMtm)
  let best: MatchedQuote<GrayWholesaleQuote> | undefined
  for (const quote of quotes) {
    const quoteFingerprint = buildConfigFingerprint(quote.productText)
    if (!getGrayWholesaleBasis(quote) || !quoteFingerprint) continue
    if (!isProductBrandCompatible(sku.productName, quote.productText)) continue
    if (hasMeaningfulExactModelOverlap(`${sku.productName} ${sku.spec ?? ''} ${sku.pnMtm ?? ''}`, quote.productText)) {
      if (hasCompatibleConfigAtoms(`${sku.productName} ${sku.spec ?? ''} ${sku.pnMtm ?? ''}`, quote.productText)) {
        return {
          quote,
          match: {
            method: 'configuration_fingerprint',
            confidence: 1,
            evidence: `按型号精确命中 ${quote.evidenceText ?? quote.productText}`,
          },
        }
      }
      continue
    }
    const confidence = getFingerprintScore(fingerprint, quoteFingerprint)
    if (confidence >= 0.82 && (!best || confidence > best.match.confidence)) {
      best = { quote, match: { method: 'configuration_fingerprint', confidence, evidence: quote.evidenceText ?? quote.productText } }
    }
  }
  return best
}

function minDefined(values: Array<number | undefined>) {
  const available = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return available.length ? Math.min(...available) : undefined
}

function maxDefined(values: Array<number | undefined>) {
  const available = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return available.length ? Math.max(...available) : undefined
}

function marginFloor(cost?: number, mode: 'regular' | 'defensive' = 'regular') {
  if (!cost) return undefined
  const rate = mode === 'regular' ? 0.08 : 0.025
  const absolute = mode === 'regular' ? 250 : 80
  return roundPrice(cost + Math.max(cost * rate, absolute))
}

function makeSource(base: Omit<QuotePriceSource, 'available'>): QuotePriceSource {
  return { ...base, available: typeof base.price === 'number' && Number.isFinite(base.price) && base.price > 0 }
}

function platformSource(
  sku: StandardInventorySku,
  source: Extract<PriceSourceName, '联想官网' | '京东' | '淘宝百亿补贴'>,
  sourceType: QuotePriceSource['sourceType'],
  entry: PriceMonitorEntry | undefined,
  price: number | undefined,
  fallbackEvidence: string,
): QuotePriceSource {
  return makeSource({
    skuKey: sku.skuKey,
    productName: sku.productName,
    pnMtm: sku.pnMtm,
    source,
    sourceType,
    price,
    taxIncluded: true,
    serviceIncluded: source === '京东' || source === '联想官网',
    capturedAt: entry?.capturedAt,
    publishedAt: entry?.publishedAt,
    confidence: entry ? '中' : '低',
    evidence: entry?.evidence ?? entry?.matchTitle ?? entry?.priceBasis ?? fallbackEvidence,
  })
}

function cleanDisplayTitle(value?: string) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeComparableTitle(value?: string) {
  return cleanDisplayTitle(value)
    .toLowerCase()
    .replace(/[·/／｜|（）()【】\[\]\s,，、:-]/g, '')
    .replace(/gb/g, 'g')
    .replace(/tb/g, 't')
    .replace(/酷睿/g, '')
    .replace(/冰魄白|白色/g, '白')
    .replace(/碳晶黑|钛晶黑|黑色/g, '黑')
    .replace(/霜雪银|银色/g, '银')
    .replace(/凝雾灰|卷云灰|深空灰|信风灰|灰色/g, '灰')
}

function isUsefulTitleDetail(detail?: string, title?: string) {
  const normalizedDetail = normalizeComparableTitle(detail)
  const normalizedTitle = normalizeComparableTitle(title)
  if (!normalizedDetail || normalizedDetail === normalizedTitle) return false
  return !normalizedTitle.includes(normalizedDetail)
}

function extractTitleConfigTokens(value?: string) {
  const text = normalizeComparableTitle(value)
  const tokens = new Set<string>()
  for (const match of text.matchAll(/(?:ultra\d+|i[3579]\d{4,5}|r[3579]\d{3,5}|锐龙\d+|酷睿\d*)/gi)) tokens.add(match[0])
  for (const match of text.matchAll(/rtx\d{4}/gi)) tokens.add(match[0])
  for (const match of text.matchAll(/\d{1,2}g/gi)) tokens.add(match[0])
  for (const match of text.matchAll(/\d{1,2}t/gi)) tokens.add(match[0])
  for (const match of text.matchAll(/\d(?:\.\d)?k\d{2,3}hz/gi)) tokens.add(match[0])
  for (const color of ['黑', '白', '灰', '银', '青', '蓝', '贝', '金']) {
    if (text.includes(color)) tokens.add(color)
  }
  return tokens
}

function hasDuplicateTitleConfig(existing: string, candidate: string) {
  const existingTokens = extractTitleConfigTokens(existing)
  const candidateTokens = extractTitleConfigTokens(candidate)
  if (candidateTokens.size < 3 || existingTokens.size < 3) return false
  let overlap = 0
  for (const token of candidateTokens) {
    if (existingTokens.has(token)) overlap += 1
  }
  return overlap >= Math.min(candidateTokens.size, 4)
}

function appendTitlePart(parts: string[], candidate?: string) {
  const value = cleanDisplayTitle(candidate)
  if (!value || /^(undefined|null|待补|\*)$/i.test(value)) return
  const normalizedValue = normalizeComparableTitle(value)
  if (parts.some((existing) => {
    const normalizedExisting = normalizeComparableTitle(existing)
    return normalizedExisting.includes(normalizedValue) || normalizedValue.includes(normalizedExisting)
      || hasDuplicateTitleConfig(existing, value)
  })) return
  parts.push(value)
}

function parseTitleFromMatchTitle(matchTitle?: string) {
  const title = cleanDisplayTitle(matchTitle)
  if (!title) return { mainTitle: '', detail: '' }
  const parentheticalMatch = title.match(/^(.*?)[(（]([^()（）]+)[)）]\s*([^\s()（）]+)?$/)
  if (parentheticalMatch) {
    return {
      mainTitle: cleanDisplayTitle(parentheticalMatch[1]),
      detail: [parentheticalMatch[2], parentheticalMatch[3]].map(cleanDisplayTitle).filter(Boolean).join(' '),
    }
  }
  const configStartPattern = /(酷睿|锐龙|Ultra\s*\d|U\d{3,4}[A-Z]?|R\d{3,4}[A-Z]?|i[3579]-?\d{4,5}|R[3579]-?\d{3,5}|RTX\s*\d{4}|\d+\s*G(?:B)?\s+\d+\s*T(?:B)?|\d+\s*T(?:B)?\s+\d+\s*G(?:B)?|\d+(?:\.\d+)?K\s*\d+Hz|黑色|白色|灰色|深灰色|云影色|碳晶黑|冰魄白|钛晶黑|幻影黑|深空灰|霜雪银)/i
  const match = configStartPattern.exec(title)
  if (!match || match.index < 8) return { mainTitle: title, detail: '' }
  return {
    mainTitle: cleanDisplayTitle(title.slice(0, match.index)),
    detail: cleanDisplayTitle(title.slice(match.index)),
  }
}

function buildUnifiedDisplayTitle(entry?: PriceMonitorEntry) {
  if (!entry) return ''
  const raw = entry.raw ?? {}
  const parsed = parseTitleFromMatchTitle(entry.matchTitle)
  const mainTitle = cleanDisplayTitle(raw.platformMainTitle as string)
    || cleanDisplayTitle(raw.mainTitle as string)
    || cleanDisplayTitle(raw.productTitle as string)
    || cleanDisplayTitle(raw.searchTitle as string)
    || parsed.mainTitle
    || cleanDisplayTitle(entry.matchTitle)
  const parts: string[] = []
  appendTitlePart(parts, mainTitle)
  for (const value of [
    raw.configSubtitle,
    raw.selectedSpecText,
    raw.visibleConfig,
    raw.matchedConfig,
    raw.configurationTitle,
    raw.specTitle,
    raw.subTitle,
    raw.subtitle,
    raw.subheading,
    raw.viceTitle,
    raw.sellingPoint,
    parsed.detail,
  ]) {
    const detail = cleanDisplayTitle(value as string)
    if (isUsefulTitleDetail(detail, mainTitle)) appendTitlePart(parts, detail)
  }
  return parts.join(' · ')
}

function isInternalCodeLikeTitle(value?: string, sku?: StandardInventorySku) {
  const title = cleanDisplayTitle(value)
  if (!title) return true
  const compactTitle = normalizeComparableTitle(title)
  const skuName = normalizeComparableTitle(sku?.productName)
  const skuSpec = normalizeComparableTitle(sku?.spec)
  const skuPn = normalizeComparableTitle(sku?.pnMtm)
  if (compactTitle && (compactTitle === skuName || compactTitle === skuSpec || compactTitle === skuPn)) return true
  if (/^PHN\s+MOTO\s+XT\d+/i.test(title)) return true
  if (/^(?:Lecoo\s+)?N\d{3}[A-Z]?\s*\d?[A-Z0-9+-]+$/i.test(title)) return true
  if (/^斗战者N\d{3}[A-Z]?\s*\d?[A-Z0-9+-]+$/i.test(title)) return true
  if (/^[A-Z0-9+-]{10,}(?:\s*[·/]\s*[A-Z0-9+-]+)?$/i.test(title) && !/[一-龥]/.test(title)) return true
  return false
}

function getReadableInventoryTitle(sku: StandardInventorySku) {
  const name = cleanDisplayTitle(sku.productName)
  const motoMatch = name.match(/PHN\s+MOTO\s+XT\d+-\d\s+CN\s+\S+\s+([0-9+]+)\s+DS\s+RTL[（(]([^()（）]+)[)）]/i)
  if (motoMatch) {
    return `moto ${cleanDisplayTitle(motoMatch[2]).replace(/\s+/g, ' ')}`
  }
  const parenthetical = name.match(/^[^(（]+[（(]([^()（）]+)[)）]/)
  if (parenthetical && /来酷|Lecoo|moto|Air|Pro|R7|i[3579]|锐龙|酷睿/i.test(parenthetical[1])) {
    return cleanDisplayTitle(parenthetical[1])
  }
  return ''
}

function getPlatformDisplayTitle(entry: PriceMonitorEntry | undefined, sku: StandardInventorySku) {
  const title = buildUnifiedDisplayTitle(entry)
  if (!title || isInternalCodeLikeTitle(title, sku)) return ''
  return title
}

function isPrimaryComputerSku(sku: StandardInventorySku) {
  return /游戏笔记本|轻薄笔记本|商务台式|游戏主机|一体机|台式|电脑/.test(`${sku.category ?? ''} ${sku.productName}`)
    && !/电脑配件|鼠标|键盘|背包|支架|耳机|音箱|打印机|喷墨|墨仓|打印|复印|扫描|CM408|适配器|钢化膜|保护夹/.test(`${sku.category ?? ''} ${sku.productName}`)
}

function chooseRetailDisplayTitle(input: {
  sku: StandardInventorySku
  jdEntry?: PriceMonitorEntry
  lenovoEntry?: PriceMonitorEntry
  taobaoEntry?: PriceMonitorEntry
  distributorTitle?: string
  canonicalTitle?: string
}) {
  const canonicalTitle = cleanDisplayTitle(input.canonicalTitle)
  const candidates = [
    getPlatformDisplayTitle(input.jdEntry, input.sku),
    getPlatformDisplayTitle(input.lenovoEntry, input.sku),
    getPlatformDisplayTitle(input.taobaoEntry, input.sku),
    // 京东主标题优先，其次再回退到其他平台或产品主档，避免把详细配置压没。
    canonicalTitle,
    cleanDisplayTitle(input.distributorTitle),
    getReadableInventoryTitle(input.sku),
    isPrimaryComputerSku(input.sku)
      ? [input.sku.productName, input.sku.spec].filter((value) => isUsefulTitleDetail(value, input.sku.productName) || value === input.sku.productName).map(cleanDisplayTitle).filter(Boolean).join(' · ')
      : cleanDisplayTitle(input.sku.productName),
  ].filter((value) => value && !isInternalCodeLikeTitle(value, input.sku))
  return candidates[0] || input.sku.productName
}

function getApproval(
  reasons: string[],
  regularMargin?: number,
  defensiveMargin?: number,
): QuoteDecision['approval'] {
  if (reasons.some((reason) => /亏损|灰渠|缺少/.test(reason))) return '老板审批'
  if ((regularMargin ?? 0) < 200 || (defensiveMargin ?? 0) < 80 || reasons.length) return '店长审批'
  return '销售可用'
}

function isSubsidyEligible(sku: StandardInventorySku) {
  return Boolean(getSubsidyCategory(sku))
}

export function buildQuoteDecisions(input: PriceEngineInput) {
  const decisions: QuoteDecision[] = []
  const sources: QuotePriceSource[] = []

  for (const sku of input.inventory.skus.filter((item) => item.currentStock > 0)) {
    const distributor = matchDistributorQuote(sku, input.distributorQuotes)
    const gray = matchGrayQuote(sku, input.grayWholesaleQuotes)
    const jdEntry = getMonitorEntry(input.priceMonitors.jd, sku)
    const lenovoEntry = getMonitorEntry(input.priceMonitors.lenovoOfficial, sku)
    const taobaoEntry = getMonitorEntry(input.priceMonitors.taobao, sku)
    const manualOverride = input.manualPriceOverrides?.[sku.skuKey]

    const inventoryCost = sku.salesCostPrice
    const realtimePurchasePrice = manualOverride?.realtimePurchasePrice ?? distributor?.quote.pickupPrice
    const grayWholesalePrice = manualOverride?.marketWholesalePrice ?? getGrayWholesaleBasis(gray?.quote)
    const lenovoOfficialPrice = getEntryPreSubsidyPrice(lenovoEntry, 'lenovoOfficial')
    const lenovoOfficialPostSubsidyPrice = getEntryPostSubsidyPrice(lenovoEntry, 'lenovoOfficial', sku)
    const jdPrice = getEntryPreSubsidyPrice(jdEntry, 'jd')
    const jdPostSubsidyPrice = getEntryPostSubsidyPrice(jdEntry, 'jd', sku)
    const taobaoPrice = taobaoEntry?.preSubsidyPrice ?? getEntryPrice(taobaoEntry, 'taobao')
    const taobaoLowReferencePrice = getEntryPrice(taobaoEntry, 'taobao')
    const orderPlatformPrice = sku.agentPrice
    const displayTitle = chooseRetailDisplayTitle({
      sku,
      jdEntry,
      lenovoEntry,
      taobaoEntry,
      distributorTitle: distributor?.quote.productName,
      canonicalTitle: input.canonicalTitles?.[sku.skuKey],
    })

    const skuSources = [
      makeSource({
        skuKey: sku.skuKey,
        productName: displayTitle,
        pnMtm: sku.pnMtm,
        source: '库存进货价',
        sourceType: '成本参考',
        price: inventoryCost,
        taxIncluded: true,
        serviceIncluded: true,
        confidence: inventoryCost ? '高' : '低',
        evidence: sku.priceSource ?? '标准库存快照 salesCostPrice',
      }),
      makeSource({
        skuKey: sku.skuKey,
        productName: displayTitle,
        pnMtm: sku.pnMtm,
        source: '实时进货价',
        sourceType: '进货参考',
        price: realtimePurchasePrice,
        taxIncluded: true,
        serviceIncluded: true,
        publishedAt: distributor?.quote.quoteDate,
        confidence: distributor ? (distributor.match.confidence >= 1 ? '高' : '中') : '低',
        evidence: distributor?.match.evidence ?? '未匹配到分销商日报价',
      }),
      makeSource({
        skuKey: sku.skuKey,
        productName: displayTitle,
        pnMtm: sku.pnMtm,
        source: '灰渠批发价',
        sourceType: '低价参考',
        price: grayWholesalePrice,
        taxIncluded: false,
        serviceIncluded: false,
        capturedAt: gray?.quote.capturedAt,
        publishedAt: gray?.quote.quoteDate,
        confidence: gray ? '中' : '低',
        evidence: gray?.match.evidence ?? '未匹配到灰渠公众号报价',
      }),
      makeSource({
        skuKey: sku.skuKey,
        productName: displayTitle,
        pnMtm: sku.pnMtm,
        source: '联想订货平台',
        sourceType: '进货参考',
        price: orderPlatformPrice,
        taxIncluded: true,
        serviceIncluded: true,
        confidence: orderPlatformPrice ? '中' : '低',
        evidence: sku.priceSource ?? '标准库存快照 agentPrice',
      }),
      platformSource(sku, '联想官网', '销售参考', lenovoEntry, lenovoOfficialPrice, '未接入联想官网价格监控'),
      platformSource(sku, '京东', '销售参考', jdEntry, jdPrice, '未匹配到京东价格监控'),
      platformSource(sku, '淘宝百亿补贴', '销售参考', taobaoEntry, taobaoPrice ?? taobaoLowReferencePrice, '未接入淘宝价格监控'),
    ]

    const regularCostBasis = maxDefined([inventoryCost, realtimePurchasePrice]) ?? inventoryCost ?? realtimePurchasePrice
    const lowCostBasis = minDefined([realtimePurchasePrice, grayWholesalePrice, inventoryCost])
    const officialRetailReference = getOfficialRetailReference(sku, jdEntry, lenovoEntry, taobaoEntry)
    const usableJd = isUsableRetailPlatformEntry(jdEntry, sku)
    const usableLenovo = isUsableRetailPlatformEntry(lenovoEntry, sku)
    const platformSubsidyPrice = minDefined([
      usableJd ? jdPostSubsidyPrice : undefined,
      usableLenovo ? lenovoOfficialPostSubsidyPrice : undefined,
    ])
    const defensivePlatformSubsidyPrice = getDefensivePlatformSubsidyPrice(sku, jdPrice, taobaoPrice)
    const lowReference = minDefined([taobaoLowReferencePrice, jdPrice, grayWholesalePrice ? grayWholesalePrice * 1.05 : undefined])
    const defensiveAfterSubsidyFloor = marginFloor(lowCostBasis, 'defensive')
    const fallbackRetailReference = officialRetailReference ? undefined : getFallbackRetailReference({
      sku,
      jdPrice,
      lenovoOfficialPrice,
      taobaoPrice,
      inventoryCost,
      realtimePurchasePrice,
      grayWholesalePrice,
      orderPlatformPrice,
    })
    const retailReference = officialRetailReference ?? fallbackRetailReference
    const notebookEducationAddBackAmount = officialRetailReference
      ? getNotebookEducationAddBackAmount(sku, input.educationSubsidies?.[sku.skuKey])
      : 0
    const automaticRecommendedPreSubsidyPrice = retailReference?.storeRetailPrice !== undefined
      ? isAccessorySku(sku)
        ? retailReference.storeRetailPrice
        : normalizeTo99EndingPrice(retailReference.storeRetailPrice + notebookEducationAddBackAmount) ?? retailReference.storeRetailPrice + notebookEducationAddBackAmount
      : undefined
    const subsidyCategory = getSubsidyCategory(sku)
    const subsidyEligible = Boolean(subsidyCategory)
    const floorPreSubsidyPrice = maxDefined([
      lowReference ? roundPrice(lowReference) : undefined,
      getPreSubsidyPriceForAfterSubsidy(defensiveAfterSubsidyFloor, sku),
    ])
    const recommendedPreSubsidyPrice = manualOverride?.retailPreSubsidyPrice ?? automaticRecommendedPreSubsidyPrice
    const fullServiceSubsidyPrice = subsidyEligible ? calculateStandardSubsidyPrice(recommendedPreSubsidyPrice, sku) : undefined
    const regularChannelSubsidyPrice = fullServiceSubsidyPrice
    const grayDefensivePreSubsidyPrice = calculateGraySuggestedRetailPrice(grayWholesalePrice, sku)
    const grayDefensiveAfterSubsidyPrice = subsidyEligible
      ? calculateGraySuggestedSubsidyPrice(grayDefensivePreSubsidyPrice, sku)
      : undefined
    const defensiveLowSubsidyPrice = subsidyEligible
      ? manualOverride?.defensivePostSubsidyPrice ?? minDefined([
        grayDefensiveAfterSubsidyPrice,
        defensivePlatformSubsidyPrice,
        regularChannelSubsidyPrice,
      ]) ?? calculateStandardSubsidyPrice(floorPreSubsidyPrice, sku)
      : undefined
    const expectedRegularMargin = regularChannelSubsidyPrice && regularCostBasis ? Math.round(regularChannelSubsidyPrice - regularCostBasis) : undefined
    const expectedDefensiveMargin = defensiveLowSubsidyPrice && lowCostBasis ? Math.round(defensiveLowSubsidyPrice - lowCostBasis) : undefined

    const approvalReasons: string[] = []
    if (!officialRetailReference && !manualOverride?.retailPreSubsidyPrice) approvalReasons.push(fallbackRetailReference ? '缺少京东/联想官网有效销售参考价，已生成门店锁定待复核价' : '缺少京东/联想官网有效销售参考价')
    if (!realtimePurchasePrice) approvalReasons.push('缺少分销商实时进货价')
    if (grayWholesalePrice && (!gray?.quote.taxIncluded || !gray?.quote.serviceIncluded)) approvalReasons.push('灰渠报价不含税或不含服务')
    if (manualOverride?.retailPreSubsidyPrice) approvalReasons.push('门店已手动校准国补前零售价')
    if (notebookEducationAddBackAmount) approvalReasons.push(`笔记本教育补已按门店零售价规则封顶加回 ${notebookEducationAddBackAmount} 元`)
    if (manualOverride?.defensivePostSubsidyPrice) approvalReasons.push('门店已手动校准防流失补贴后价')
    if ((subsidyCategory === 'tablet' || subsidyCategory === 'phone') && recommendedPreSubsidyPrice && recommendedPreSubsidyPrice >= 6000) {
      approvalReasons.push('手机/平板 6000 元及以上不参与国补')
    }
    if (subsidyEligible && expectedRegularMargin !== undefined && expectedRegularMargin < 200) approvalReasons.push('正规渠道国补价毛利偏低')
    if (subsidyEligible && expectedDefensiveMargin !== undefined && expectedDefensiveMargin < 80) approvalReasons.push('防流失低价接近成本')
    if (subsidyEligible && defensiveLowSubsidyPrice && inventoryCost && defensiveLowSubsidyPrice < inventoryCost) approvalReasons.push('防流失低价低于库存进货价')

    const approval = getApproval(approvalReasons, expectedRegularMargin, expectedDefensiveMargin)
    const riskLevel: QuoteDecision['riskLevel'] = approval === '老板审批' ? '高' : approval === '店长审批' ? '中' : '低'
    const riskNote = subsidyEligible
      ? (approvalReasons.length ? approvalReasons.join('；') : '价格证据完整，按门店日常授权执行。')
      : '非国补目录：配件、显示器、打印机等只展示零售价，不生成国补价。'
    const salesNote = !subsidyEligible
      ? retailReference
        ? `该 SKU 不参与国补，门店零售价按${formatRetailReferenceText(retailReference.source, retailReference.officialPrice, retailReference.policy.markup)}${notebookEducationAddBackAmount ? `，教育补封顶加回 ${notebookEducationAddBackAmount} 元` : ''}。${fallbackRetailReference ? '该价格为门店锁定待复核价，销售前按店内授权确认。' : ''}`
        : '该 SKU 不参与国补，缺少可用价格依据，需老板手动定价后销售。'
      : defensiveLowSubsidyPrice && regularChannelSubsidyPrice && defensiveLowSubsidyPrice < regularChannelSubsidyPrice
      ? `先报正规厂家渠道国补价，强比价客户再申请防流失低价；防流失价差约 ${Number((regularChannelSubsidyPrice - defensiveLowSubsidyPrice).toFixed(2))} 元。`
      : retailReference
      ? `门店零售价按${formatRetailReferenceText(retailReference.source, retailReference.officialPrice, retailReference.policy.markup)}${notebookEducationAddBackAmount ? `，教育补封顶加回 ${notebookEducationAddBackAmount} 元` : ''}；${fallbackRetailReference ? '该价格为门店锁定待复核价，后续采到京东/官旗价再覆盖。' : '优先使用正规厂家渠道国补价，保留外部平台截图或链接。'}`
      : '缺少可用价格依据，需老板手动定价后销售。'

    sources.push(...skuSources)
    decisions.push({
      skuKey: sku.skuKey,
      productName: displayTitle,
      pnMtm: sku.pnMtm,
      category: sku.category,
      currentStock: sku.currentStock,
      sellableStock: sku.sellableStock,
      serialCount: sku.serialCount,
      inventoryAverageCost: inventoryCost,
      realtimePurchasePrice,
      grayWholesalePrice,
      grayRetailPreSubsidyPrice: grayDefensivePreSubsidyPrice,
      graySubsidyPrice: grayDefensiveAfterSubsidyPrice,
      lenovoOfficialPrice,
      lenovoOfficialPostSubsidyPrice,
      jdPrice,
      jdPostSubsidyPrice,
      platformSubsidyPrice,
      taobaoPrice,
      fullServiceSubsidyPrice,
      regularChannelSubsidyPrice,
      defensiveLowSubsidyPrice,
      recommendedPreSubsidyPrice,
      floorPreSubsidyPrice,
      expectedRegularMargin,
      expectedDefensiveMargin,
      approval,
      riskLevel,
      approvalReasons,
      salesNote,
      riskNote,
      priceSources: skuSources,
      match: {
        realtimePurchasePrice: distributor?.match,
        grayWholesalePrice: gray?.match,
      },
    })
  }

  decisions.sort((a, b) => {
    const riskOrder = { 高: 3, 中: 2, 低: 1 }
    return riskOrder[b.riskLevel] - riskOrder[a.riskLevel] || b.currentStock - a.currentStock
  })

  return {
    generatedAt: new Date().toISOString(),
    subsidyRule,
    sourceStatus: input.sourceStatus,
    quoteDecisions: decisions,
    priceSources: sources,
  }
}
