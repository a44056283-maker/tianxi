import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

type CompetitorMonitorBrand = '联想京东自营' | 'THINK笔记本' | '华硕笔记本' | '惠普笔记本' | '华为笔记本'

type GrayWholesaleQuote = {
  productText: string
  marketWholesalePrice: number
}

type GrayWholesaleSnapshot = {
  quotes: GrayWholesaleQuote[]
}

export type CompetitorMonitorItem = {
  brand: CompetitorMonitorBrand
  rank: number
  rankingBucket?: 'light-notebook' | 'gaming-notebook' | 'tablet'
  productName: string
  configSummary?: string
  salesVolumeText?: string
  jdSelfPrice?: number
  jdPreSubsidyPrice?: number
  jdSubsidyPrice?: number
  jdUrl?: string
  capturedAt: string
  sourceFile?: string
  note?: string
  activityNotes?: string[]
  educationSubsidyNotes?: string[]
  grayWholesalePrice?: number
  keepCustomerRetailPrice?: number
  keepCustomerSubsidyPrice?: number
}

export type CompetitorCompletenessAudit = {
  status: 'complete' | 'incomplete'
  expectedTotalCount: number
  actualItemCount: number
  missingItemCount: number
  incompleteItemCount: number
  staleItemCount: number
  missingBucketCount: number
  missingBrandCount: number
  blockers: string[]
  brandAudits: Array<{
    brand: CompetitorMonitorBrand
    expectedItemCount: number
    actualItemCount: number
    missingItemCount: number
    incompleteItemCount: number
    staleItemCount: number
    missingBuckets: string[]
    bucketAudits: Array<{
      rankingBucket: 'light-notebook' | 'gaming-notebook' | 'tablet'
      label: string
      expectedItemCount: number
      actualItemCount: number
      missingItemCount: number
    }>
  }>
}

export type CompetitorMonitorSnapshot = {
  generatedAt: string
  quoteDate?: string
  isCarriedForward: boolean
  carryForwardFrom?: string
  partialUpdateBlocked?: boolean
  partialUpdateReason?: string
  partialUpdateItemCount?: number
  partialUpdateQuoteDate?: string
  partialUpdateSourceFile?: string
  itemCount: number
  completenessAudit?: CompetitorCompletenessAudit
  brands: Array<{
    brand: CompetitorMonitorBrand
    itemCount: number
    latestCapturedAt?: string
    items: CompetitorMonitorItem[]
  }>
}

type CompetitorStoreFavorite = {
  brand: CompetitorMonitorBrand
  storeName: string
  storeUrl: string
  sourceNote?: string
}

type CompetitorStoreFavoriteSnapshot = {
  generatedAt: string
  storeCount: number
  stores: CompetitorStoreFavorite[]
}

type CompetitorLinkRepositoryItem = {
  brand: CompetitorMonitorBrand
  rank: number
  productName: string
  configSummary?: string
  jdUrl: string
  lastCapturedAt: string
  lastQuoteDate?: string
  sourceFile?: string
  note?: string
}

type CompetitorLinkRepositorySnapshot = {
  generatedAt: string
  itemCount: number
  items: CompetitorLinkRepositoryItem[]
}

type CompetitorCollectionPlanTarget = {
  brand: CompetitorMonitorBrand
  rank: number
  rankingBucket?: 'light-notebook' | 'gaming-notebook' | 'tablet'
  expectedItemCount?: number
  source: 'store-sales-ranking' | 'stored-link' | 'store-entry'
  storeName: string
  storeUrl: string
  jdUrl?: string
  productName?: string
  configSummary?: string
  lastCapturedAt?: string
  lastQuoteDate?: string
  action: string
}

type CompetitorCollectionPlanSnapshot = {
  generatedAt: string
  quoteDate: string
  targetPerBrand: number
  expectedTotalCount: number
  sourcePolicy: string
  outputFile: string
  acceptedStoreScopes: string[]
  forbiddenSources: string[]
    brands: Array<{
      brand: CompetitorMonitorBrand
      storeName: string
      storeUrl: string
      expectedItemCount: number
      targetMix: Array<{
        rankingBucket: 'light-notebook' | 'gaming-notebook' | 'tablet'
        label: string
        expectedItemCount: number
      }>
      storedLinkCount: number
      targets: CompetitorCollectionPlanTarget[]
    }>
}

type ManualCompetitorItem = {
  brand?: string
  rank?: number
  rankingBucket?: 'light-notebook' | 'gaming-notebook' | 'tablet'
  productName?: string
  configSummary?: string
  salesVolumeText?: string
  jdSelfPrice?: number
  jdPreSubsidyPrice?: number
  jdSubsidyPrice?: number
  jdUrl?: string
  capturedAt?: string
  sourceFile?: string
  sourceStoreName?: string
  storeScope?: string
  note?: string
  activityNotes?: string[]
  educationSubsidyNotes?: string[]
}

type ManualCompetitorPayload =
  | ManualCompetitorItem[]
  | {
      quoteDate?: string
      sourceFile?: string
      items?: ManualCompetitorItem[]
    }

type ManualCompetitorStoreFavoritePayload = {
  stores?: Array<{
    brand?: string
    storeName?: string
    storeUrl?: string
    sourceNote?: string
  }>
}

const defaultStoreFavorites: CompetitorStoreFavorite[] = [
  {
    brand: '联想京东自营',
    storeName: '联想京东自营旗舰店',
    storeUrl: 'https://lenovo1.jd.com/',
    sourceNote: '京东联想自营店，独立于零售库存，进入轻薄笔记本、游戏笔记本、平板电脑三个分类按销量各采集 TOP10',
  },
  {
    brand: 'THINK笔记本',
    storeName: 'ThinkPad京东自营旗舰店',
    storeUrl: 'https://mall.jd.com/index-1000000158.html',
    sourceNote: '京东自营店首页，当前无独立游戏本分类；按店铺商品列表切到销量排序后采笔记本 TOP10，过滤配件、台式机与服务类',
  },
  {
    brand: '华硕笔记本',
    storeName: '华硕京东自营官方旗舰店',
    storeUrl: 'https://mall.jd.com/index-1000000182.html',
    sourceNote: '京东自营店首页，必须进入轻薄笔记本和游戏笔记本两个口径分别按销量排序',
  },
  {
    brand: '惠普笔记本',
    storeName: '惠普京东自营旗舰店',
    storeUrl: 'https://mall.jd.com/index-1000482851.html?cu=true',
    sourceNote: '京东自营店首页，当前只有轻薄笔记本分类；游戏主机为台式机口径，不能混入惠普笔记本竞品库',
  },
  {
    brand: '华为笔记本',
    storeName: '华为京东自营旗舰店',
    storeUrl: 'https://mall.jd.com/view_search-466323-8779620-1-0-20-1.html',
    sourceNote: '京东自营店笔记本电脑分类页，必须按销量排序，禁止首页手机热区混入',
  },
]

function getBeijingTodayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function normalizeBrand(value?: string): CompetitorMonitorBrand | undefined {
  const text = String(value ?? '').toUpperCase()
  if (/联想京东自营|LENOVO_JD|LENOVO1|联想自营/.test(text)) return '联想京东自营'
  if (/THINK/.test(text)) return 'THINK笔记本'
  if (/ASUS|华硕/.test(text)) return '华硕笔记本'
  if (/HP|惠普/.test(text)) return '惠普笔记本'
  if (/HUAWEI|华为/.test(text)) return '华为笔记本'
  return undefined
}

function normalizePrice(value: unknown) {
  const price = Number(value)
  return Number.isFinite(price) && price > 0 ? price : undefined
}

function isJdSelfOperatedStoreItem(item: ManualCompetitorItem) {
  const storeScope = String(item.storeScope ?? '').trim().toLowerCase()
  if (storeScope === 'jd-self-operated-store') return true
  if (storeScope === 'jd-ranking-page') return false

  const sourceBundle = `${String(item.sourceFile ?? '')} ${String(item.jdUrl ?? '')}`
  const noteBundle = `${String(item.sourceStoreName ?? '')} ${String(item.note ?? '')}`
  if (/jd\.com\/phb\//i.test(sourceBundle)) return false

  const hasJdStorePage =
    /item\.jd\.com\/\d+\.html/i.test(sourceBundle) ||
    /mall\.jd\.com\/index-\d+\.html/i.test(sourceBundle) ||
    /mall\.jd\.com\/view_search/i.test(sourceBundle)
  const mentionsSelfOperated = /京东自营|自营旗舰店|官方自营|官方旗舰店/.test(noteBundle)
  return hasJdStorePage && mentionsSelfOperated
}

function normalizeTo99EndingRetailPrice(value?: number) {
  if (!value || !Number.isFinite(value)) return undefined
  if (value <= 1000) return Math.round(value)
  const normalized = Math.ceil((value + 1) / 100) * 100 - 1
  return Math.max(normalized, 1099)
}

function applyComputerSubsidy(price?: number) {
  if (!price || !Number.isFinite(price)) return undefined
  return Number((price - Math.min(price * 0.15, 1500)).toFixed(2))
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

function buildFingerprintTokens(value?: string) {
  const text = normalizeConfigText(value)
  const tokens = new Set<string>()
  const addAll = (pattern: RegExp, mapper = (input: string) => input) => {
    for (const match of text.matchAll(pattern)) tokens.add(mapper(match[1] ?? match[0]))
  }
  addAll(/(THINKBOOK|THINKPAD|YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|GEEKPRO)/g, (token) => token === 'LEGION' ? '拯救者' : token === 'LECOO' ? '来酷' : token)
  addAll(/([RY]\d{4}P?|战\d{4}|N\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|THINKBOOK\d{2}\+?)/g)
  addAll(/(ULTRA[579][-]?\d{3}[A-Z]*|CORE[3579][-]?\d{3}[A-Z]*|U[3579][-]?\d{3,4}[A-Z]*|I[3579][-]?\d{4,5}[A-Z]*)/g, (value) => value.replace(/^ULTRA/, 'U').replace(/^CORE/, 'U'))
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{5})(?:HX|H|U|V|P)/g, (value) => `CPU${value}`)
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{3,4})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/R[3579]-[A-Z]?([0-9]{3,5})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/(?:RTX)?(3050|4060|4070|5060|5070|5070TI|5080|5090)/g)
  addAll(/(?:^|[^0-9])((?:8|12|16|24|32|64)G)/g)
  addAll(/(?:^|[^0-9])((?:128|256|512)G?|[12]T)/g, (value) => /G$|T$/.test(value) ? value : `${value}G`)
  return tokens
}

function getFingerprintScore(leftText?: string, rightText?: string) {
  const left = buildFingerprintTokens(leftText)
  const right = buildFingerprintTokens(rightText)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  const denominator = Math.max(left.size, right.size)
  return denominator ? shared / denominator : 0
}

async function loadGrayWholesaleSnapshot() {
  const filePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-gray-wholesale-quotes.json')
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as GrayWholesaleSnapshot)
    .catch(() => null)
}

async function loadManualCompetitorPayload(inputFile?: string) {
  const today = getBeijingTodayDateString()
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const preferred = inputFile
    ? [inputFile]
    : [
      path.resolve(manualDir, `competitor-monitor-${today}.json`),
      path.resolve(manualDir, `competitor-jd-top10-${today}.json`),
    ]

  for (const filePath of preferred) {
    const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
    if (!content.trim()) continue
    return {
      filePath,
      payload: JSON.parse(content) as ManualCompetitorPayload,
    }
  }
  return null
}

async function loadStoreFavorites() {
  const manualPath = path.resolve(config.lenovoRetail.artifactDir, 'manual', 'competitor-store-favorites.json')
  const content = await fs.readFile(manualPath, 'utf-8').catch(() => '')
  if (!content.trim()) return defaultStoreFavorites
  const payload = JSON.parse(content) as ManualCompetitorStoreFavoritePayload
  const stores = (payload.stores ?? []).flatMap((item) => {
    const brand = normalizeBrand(item.brand)
    const storeName = String(item.storeName ?? '').trim()
    const storeUrl = String(item.storeUrl ?? '').trim()
    if (!brand || !storeName || !storeUrl) return []
    return [{
      brand,
      storeName,
      storeUrl,
      sourceNote: item.sourceNote,
    } satisfies CompetitorStoreFavorite]
  })
  return stores.length ? stores : defaultStoreFavorites
}

async function loadCompetitorLinkRepository() {
  const filePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-link-repository.json')
  return fs.readFile(filePath, 'utf-8')
    .then((raw) => JSON.parse(raw) as CompetitorLinkRepositorySnapshot)
    .catch(() => null)
}

function getCompetitorManualOutputPath(date = getBeijingTodayDateString()) {
  return path.resolve(config.lenovoRetail.artifactDir, 'manual', `competitor-monitor-${date}.json`)
}

function getBrandTargetMix(brand: CompetitorMonitorBrand) {
  if (brand === '联想京东自营') {
    return [
      { rankingBucket: 'light-notebook' as const, label: '轻薄笔记本', expectedItemCount: 10 },
      { rankingBucket: 'gaming-notebook' as const, label: '游戏笔记本', expectedItemCount: 10 },
      { rankingBucket: 'tablet' as const, label: '平板电脑', expectedItemCount: 10 },
    ]
  }
  if (brand === 'THINK笔记本') {
    return [
      { rankingBucket: 'light-notebook' as const, label: '笔记本', expectedItemCount: 10 },
      { rankingBucket: 'gaming-notebook' as const, label: '游戏笔记本', expectedItemCount: 10 },
    ]
  }
  if (brand === '惠普笔记本') {
    return [
      { rankingBucket: 'light-notebook' as const, label: '轻薄笔记本', expectedItemCount: 10 },
      { rankingBucket: 'gaming-notebook' as const, label: '游戏笔记本', expectedItemCount: 10 },
    ]
  }
  if (brand === '华硕笔记本') {
    return [
      { rankingBucket: 'light-notebook' as const, label: '轻薄笔记本', expectedItemCount: 10 },
      { rankingBucket: 'gaming-notebook' as const, label: '游戏笔记本', expectedItemCount: 10 },
    ]
  }
  return [
    { rankingBucket: 'light-notebook' as const, label: '轻薄笔记本', expectedItemCount: 10 },
  ]
}

function isSameShanghaiDate(value: string | undefined, date: string | undefined) {
  if (!value || !date) return false
  if (value.startsWith(date)) return true
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed) === date
}

function hasCompleteCompetitorDetail(item: CompetitorMonitorItem) {
  const hasRequiredPrice = Boolean(item.jdPreSubsidyPrice || item.jdSelfPrice || item.jdSubsidyPrice)
  return Boolean(
    item.jdUrl &&
    item.productName &&
    item.configSummary &&
    hasRequiredPrice &&
    item.activityNotes?.length &&
    item.rankingBucket,
  )
}

function mergePartialCompetitorSnapshot(
  previous: CompetitorMonitorSnapshot,
  manualSnapshot: CompetitorMonitorSnapshot,
  sourceFile?: string,
): CompetitorMonitorSnapshot {
  const manualBrands = new Set(manualSnapshot.brands.map((brand) => brand.brand))
  const brands = (['联想京东自营', 'THINK笔记本', '华硕笔记本', '惠普笔记本', '华为笔记本'] as CompetitorMonitorBrand[])
    .flatMap((brandName) => {
      const manualBrand = manualSnapshot.brands.find((brand) => brand.brand === brandName)
      if (manualBrand) return [manualBrand]
      const previousBrand = previous.brands.find((brand) => brand.brand === brandName)
      return previousBrand ? [previousBrand] : []
    })
  const carriedForwardBrands = previous.brands
    .filter((brand) => !manualBrands.has(brand.brand))
    .map((brand) => brand.brand)

  return {
    generatedAt: new Date().toISOString(),
    quoteDate: manualSnapshot.quoteDate,
    isCarriedForward: true,
    carryForwardFrom: previous.quoteDate,
    partialUpdateBlocked: true,
    partialUpdateReason: `当天手工竞品文件只有 ${manualSnapshot.itemCount} 条，完整性门禁为 ${manualSnapshot.completenessAudit?.status ?? 'unknown'}；已用当天真实采集覆盖 ${[...manualBrands].join('、')}，其余 ${carriedForwardBrands.join('、') || '无'} 保留上一版基线并继续标记未收口。`,
    partialUpdateItemCount: manualSnapshot.itemCount,
    partialUpdateQuoteDate: manualSnapshot.quoteDate,
    partialUpdateSourceFile: sourceFile,
    itemCount: brands.reduce((sum, brand) => sum + brand.itemCount, 0),
    brands,
  }
}

export function auditCompetitorMonitorSnapshot(
  snapshot: Pick<CompetitorMonitorSnapshot, 'quoteDate' | 'itemCount' | 'brands'>,
  plan: CompetitorCollectionPlanSnapshot,
): CompetitorCompletenessAudit {
  const blockers: string[] = []
  const expectedTotalCount = plan.expectedTotalCount
  const actualItemCount = snapshot.itemCount ?? snapshot.brands.reduce((sum, brand) => sum + brand.itemCount, 0)
  const brandAudits = plan.brands.map((plannedBrand) => {
    const brandSnapshot = snapshot.brands.find((brand) => brand.brand === plannedBrand.brand)
    const items = brandSnapshot?.items ?? []
    const incompleteItemCount = items.filter((item) => !hasCompleteCompetitorDetail(item)).length
    const staleItemCount = items.filter((item) => !isSameShanghaiDate(item.capturedAt, snapshot.quoteDate)).length
    const bucketAudits = plannedBrand.targetMix.map((bucket) => {
      const bucketItems = items.filter((item) => item.rankingBucket === bucket.rankingBucket)
      return {
        rankingBucket: bucket.rankingBucket,
        label: bucket.label,
        expectedItemCount: bucket.expectedItemCount,
        actualItemCount: bucketItems.length,
        missingItemCount: Math.max(bucket.expectedItemCount - bucketItems.length, 0),
      }
    })
    const missingBuckets = bucketAudits
      .filter((bucket) => bucket.missingItemCount > 0)
      .map((bucket) => `${bucket.label}缺${bucket.missingItemCount}`)
    return {
      brand: plannedBrand.brand,
      expectedItemCount: plannedBrand.expectedItemCount,
      actualItemCount: items.length,
      missingItemCount: Math.max(plannedBrand.expectedItemCount - items.length, 0),
      incompleteItemCount,
      staleItemCount,
      missingBuckets,
      bucketAudits,
    }
  })
  const missingItemCount = brandAudits.reduce((sum, item) => sum + item.missingItemCount, 0)
  const incompleteItemCount = brandAudits.reduce((sum, item) => sum + item.incompleteItemCount, 0)
  const staleItemCount = brandAudits.reduce((sum, item) => sum + item.staleItemCount, 0)
  const missingBucketCount = brandAudits.reduce((sum, item) => sum + item.missingBuckets.length, 0)
  const missingBrandCount = brandAudits.filter((item) => item.actualItemCount === 0).length

  if (actualItemCount < expectedTotalCount) blockers.push(`竞品排行目标 ${expectedTotalCount} 条，当前只有 ${actualItemCount} 条。`)
  if (missingBrandCount > 0) blockers.push(`缺少 ${missingBrandCount} 个品牌/自营口径。`)
  if (missingBucketCount > 0) blockers.push(`缺少 ${missingBucketCount} 个分类排行口径：${brandAudits.flatMap((item) => item.missingBuckets.map((bucket) => `${item.brand}${bucket}`)).join('，')}。`)
  if (incompleteItemCount > 0) blockers.push(`${incompleteItemCount} 条竞品缺链接、标题、配置、价格、活动或分类字段。`)
  if (staleItemCount > 0) blockers.push(`${staleItemCount} 条竞品采集时间不是 ${snapshot.quoteDate} 当日。`)

  return {
    status: blockers.length ? 'incomplete' : 'complete',
    expectedTotalCount,
    actualItemCount,
    missingItemCount,
    incompleteItemCount,
    staleItemCount,
    missingBucketCount,
    missingBrandCount,
    blockers,
    brandAudits,
  }
}

export async function saveCompetitorCollectionPlan() {
  const [storeFavorites, linkRepository] = await Promise.all([
    loadStoreFavorites(),
    loadCompetitorLinkRepository(),
  ])
  const today = getBeijingTodayDateString()
  const targetPerBrand = 10
  const getTargetPerBrand = (brand: CompetitorMonitorBrand) => (
    getBrandTargetMix(brand).reduce((sum, item) => sum + item.expectedItemCount, 0)
  )
  const expectedTotalCount = storeFavorites.reduce((sum, store) => sum + getTargetPerBrand(store.brand), 0)
  const plan: CompetitorCollectionPlanSnapshot = {
    generatedAt: new Date().toISOString(),
    quoteDate: today,
    targetPerBrand,
    expectedTotalCount,
    sourcePolicy: '每轮必须先用 Chrome 已登录京东会话进入对应京东自营店铺首页或店铺笔记本大类，切到销量排序形成当前 TOP 位次；联想京东自营必须从 lenovo1.jd.com 分别采轻薄笔记本 TOP10、游戏笔记本 TOP10、平板电脑 TOP10；THINK 当前按 ThinkPad 京东自营店商品列表销量排序采笔记本 TOP10，并过滤配件、台式机与服务类；华硕必须分别采轻薄笔记本 TOP10 + 游戏笔记本 TOP10；惠普当前只采轻薄笔记本 TOP10，游戏主机属于台式机口径，不混入惠普笔记本；华为采轻薄笔记本 TOP10。已沉淀详情页只用于二次核价和变化比对，不能替代店铺销量排序。禁止全站排行页、无头脚本、旧 JSON、非自营店铺或首页非笔记本热区冒充当天更新。',
    outputFile: getCompetitorManualOutputPath(today),
    acceptedStoreScopes: ['jd-self-operated-store'],
    forbiddenSources: ['jd-ranking-page', 'whole-site-ranking', 'headless-browser', 'old-json-carry-forward', 'third-party-store'],
    brands: storeFavorites.map((store) => {
      const targetMix = getBrandTargetMix(store.brand)
      const brandTargetCount = getTargetPerBrand(store.brand)
      const storedLinks = (linkRepository?.items ?? [])
        .filter((item) => item.brand === store.brand && item.jdUrl)
        .sort((left, right) => left.rank - right.rank || left.productName.localeCompare(right.productName, 'zh-CN'))
        .slice(0, brandTargetCount)
      const rankingTargets = targetMix.map((lane) => ({
        brand: store.brand,
        rank: 0,
        rankingBucket: lane.rankingBucket,
        expectedItemCount: lane.expectedItemCount,
        source: 'store-sales-ranking' as const,
        storeName: store.storeName,
        storeUrl: store.storeUrl,
        action: store.brand === '联想京东自营'
          ? `本轮必须从 ${store.storeName} 的 lenovo1.jd.com 入口进入 ${lane.label}，切到销量排序，重新采当日 TOP ${lane.expectedItemCount}；排行型号每天可能变化，禁止直接沿用旧链接作为排行。`
          : `本轮必须从 ${store.storeName} 进入${lane.label}口径，必要时店内搜索 ${lane.label.includes('游戏') ? '游戏本' : '笔记本'}，切到销量排序，重新采当日 TOP ${lane.expectedItemCount}；排行型号每天可能变化，禁止直接沿用旧链接作为排行。`,
      } satisfies CompetitorCollectionPlanTarget))
      const targets: CompetitorCollectionPlanTarget[] = [...rankingTargets, ...storedLinks.map((item, index) => ({
        brand: store.brand,
        rank: index + 1,
        source: 'stored-link',
        storeName: store.storeName,
        storeUrl: store.storeUrl,
        jdUrl: item.jdUrl,
        productName: item.productName,
        configSummary: item.configSummary,
        lastCapturedAt: item.lastCapturedAt,
        lastQuoteDate: item.lastQuoteDate,
        action: '这条旧链接只用于二次核价和变化比对，不能作为本轮排行来源；必须先以店铺笔记本大类销量排序生成当日排行，若该商品下架、失效或掉出当前销量榜，必须用销量排序里的有效商品替换。',
      } satisfies CompetitorCollectionPlanTarget))]

      if (storedLinks.length < brandTargetCount) {
        targets.push({
          brand: store.brand,
          rank: storedLinks.length + 1,
          source: 'store-entry',
          storeName: store.storeName,
          storeUrl: store.storeUrl,
          action: store.brand === '联想京东自营'
            ? '从 lenovo1.jd.com 进入轻薄笔记本、游戏笔记本、平板电脑三个分类，按销量排序补齐各 TOP10；每个候选必须来自联想京东自营店分类页或详情页。'
            : store.brand === 'THINK笔记本' || store.brand === '华硕笔记本' || store.brand === '惠普笔记本'
              ? `从京东自营店入口分别进入轻薄笔记本和游戏笔记本口径，按销量排序补齐 TOP ${brandTargetCount}；每个候选必须点开详情页确认是京东自营对应店铺后才允许写入。`
              : `从京东自营店入口进入笔记本大类，按销量排序补齐 TOP ${brandTargetCount} 笔记本商品；每个候选必须点开详情页确认是京东自营对应店铺后才允许写入。`,
        })
      }

      return {
        brand: store.brand,
        storeName: store.storeName,
        storeUrl: store.storeUrl,
        expectedItemCount: brandTargetCount,
        targetMix,
        storedLinkCount: storedLinks.length,
        targets,
      }
    }),
  }

  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-collection-plan.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-competitor-collection-plan.json')
  await fs.mkdir(path.dirname(artifactPath), { recursive: true })
  await fs.mkdir(path.dirname(webPath), { recursive: true })
  const content = `${JSON.stringify(plan, null, 2)}\n`
  await fs.writeFile(artifactPath, content)
  await fs.writeFile(webPath, content)
  return {
    artifactPath,
    webPath,
    plan,
  }
}

function normalizeManualCompetitorItems(payload: ManualCompetitorPayload, sourceFile?: string) {
  const items = Array.isArray(payload) ? payload : payload.items ?? []
  const quoteDate = Array.isArray(payload) ? undefined : payload.quoteDate
  const payloadSourceFile = Array.isArray(payload) ? undefined : payload.sourceFile
  const normalizedItems: CompetitorMonitorItem[] = []
  let rejectedByScopeCount = 0
  for (const item of items) {
    const brand = normalizeBrand(item.brand)
    if (!brand || !item.productName) continue
    if (!isJdSelfOperatedStoreItem(item)) {
      rejectedByScopeCount += 1
      continue
    }
    const jdSelfPrice = normalizePrice(item.jdSelfPrice)
    normalizedItems.push({
      brand,
      rank: Number(item.rank) || 0,
      rankingBucket: item.rankingBucket,
      productName: item.productName,
      configSummary: item.configSummary,
      salesVolumeText: item.salesVolumeText,
      jdSelfPrice,
      jdPreSubsidyPrice: normalizePrice(item.jdPreSubsidyPrice) ?? jdSelfPrice,
      jdSubsidyPrice: normalizePrice(item.jdSubsidyPrice),
      jdUrl: item.jdUrl,
      capturedAt: item.capturedAt || new Date().toISOString(),
      sourceFile: item.sourceFile || payloadSourceFile || sourceFile,
      note: item.note,
      activityNotes: item.activityNotes?.filter(Boolean) ?? [],
      educationSubsidyNotes: item.educationSubsidyNotes?.filter(Boolean) ?? [],
    })
  }
  return {
    quoteDate,
    totalItemCount: items.length,
    rejectedByScopeCount,
    items: normalizedItems.sort((left, right) => left.brand.localeCompare(right.brand, 'zh-CN') || left.rank - right.rank),
  }
}

export async function saveCompetitorMonitorSnapshot(inputFile?: string) {
  const previousPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-monitor.json')
  const previous = await fs.readFile(previousPath, 'utf-8')
    .then((content) => JSON.parse(content) as CompetitorMonitorSnapshot)
    .catch(() => null)
  const [manual, collectionPlan] = await Promise.all([
    loadManualCompetitorPayload(inputFile),
    saveCompetitorCollectionPlan(),
  ])
  const normalized = manual
    ? normalizeManualCompetitorItems(manual.payload, manual.filePath)
    : { quoteDate: undefined, totalItemCount: 0, rejectedByScopeCount: 0, items: [] as CompetitorMonitorItem[] }
  const grayWholesale = await loadGrayWholesaleSnapshot()

  const items: CompetitorMonitorItem[] = normalized.items.map((item) => {
    if (item.brand !== 'THINK笔记本') return item
    const bestGrayQuote = (grayWholesale?.quotes ?? [])
      .map((quote) => ({
        quote,
        score: getFingerprintScore(`${item.productName} ${item.configSummary ?? ''}`, quote.productText),
      }))
      .sort((left, right) => right.score - left.score)[0]
    if (!bestGrayQuote || bestGrayQuote.score < 0.45) return item
    const grayWholesalePrice = bestGrayQuote.quote.marketWholesalePrice
    const keepCustomerRetailPrice = normalizeTo99EndingRetailPrice(Number((grayWholesalePrice * 1.13).toFixed(2)))
    return {
      ...item,
      grayWholesalePrice,
      keepCustomerRetailPrice,
      keepCustomerSubsidyPrice: applyComputerSubsidy(keepCustomerRetailPrice),
    }
  })

  const manualSnapshot: CompetitorMonitorSnapshot | undefined = manual
    ? {
        generatedAt: new Date().toISOString(),
        quoteDate: normalized.quoteDate ?? getBeijingTodayDateString(),
        isCarriedForward: false,
        itemCount: items.length,
        brands: (['联想京东自营', 'THINK笔记本', '华硕笔记本', '惠普笔记本', '华为笔记本'] as CompetitorMonitorBrand[])
          .map((brand) => {
            const brandItems = items.filter((item) => item.brand === brand).sort((left, right) => left.rank - right.rank)
            return {
              brand,
              itemCount: brandItems.length,
              latestCapturedAt: brandItems.map((item) => item.capturedAt).sort().at(-1),
              items: brandItems,
            }
          })
          .filter((brand) => brand.itemCount > 0),
      }
    : undefined
  if (manualSnapshot) {
    manualSnapshot.completenessAudit = auditCompetitorMonitorSnapshot(manualSnapshot, collectionPlan.plan)
  }

  const shouldPreservePreviousSnapshot = Boolean(
    manualSnapshot
      && previous
      && previous.itemCount > manualSnapshot.itemCount
      && manualSnapshot.completenessAudit?.status !== 'complete',
  )

  const snapshot: CompetitorMonitorSnapshot = manualSnapshot
    ? shouldPreservePreviousSnapshot
      ? mergePartialCompetitorSnapshot(previous!, manualSnapshot, manual?.filePath)
      : manualSnapshot
    : previous && previous.itemCount
      ? {
        generatedAt: new Date().toISOString(),
        quoteDate: previous?.quoteDate,
        isCarriedForward: true,
        carryForwardFrom: previous?.quoteDate,
        itemCount: previous?.itemCount ?? 0,
        brands: previous?.brands ?? [],
      }
      : {
        generatedAt: new Date().toISOString(),
        quoteDate: getBeijingTodayDateString(),
        isCarriedForward: false,
        itemCount: 0,
        brands: [],
      }

  snapshot.completenessAudit = auditCompetitorMonitorSnapshot(snapshot, collectionPlan.plan)

  const content = JSON.stringify(snapshot, null, 2)
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-monitor.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-competitor-monitor.json')
  await fs.mkdir(path.dirname(artifactPath), { recursive: true })
  await fs.mkdir(path.dirname(webPath), { recursive: true })
  await fs.writeFile(artifactPath, content)
  await fs.writeFile(webPath, content)

  const storeFavorites = await loadStoreFavorites()
  const storeFavoritesSnapshot: CompetitorStoreFavoriteSnapshot = {
    generatedAt: new Date().toISOString(),
    storeCount: storeFavorites.length,
    stores: storeFavorites,
  }
  const storeFavoritesArtifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-store-favorites.json')
  const storeFavoritesWebPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-competitor-store-favorites.json')
  await fs.writeFile(storeFavoritesArtifactPath, JSON.stringify(storeFavoritesSnapshot, null, 2))
  await fs.writeFile(storeFavoritesWebPath, JSON.stringify(storeFavoritesSnapshot, null, 2))

  const previousLinkRepositoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-link-repository.json')
  const previousLinkRepository = await fs.readFile(previousLinkRepositoryPath, 'utf-8')
    .then((raw) => JSON.parse(raw) as CompetitorLinkRepositorySnapshot)
    .catch(() => null)
  const linkMap = new Map(
    (previousLinkRepository?.items ?? []).map((item) => [`${item.brand}::${item.jdUrl}`, item] as const),
  )
  for (const item of items) {
    if (!item.jdUrl) continue
    linkMap.set(`${item.brand}::${item.jdUrl}`, {
      brand: item.brand,
      rank: item.rank,
      productName: item.productName,
      configSummary: item.configSummary,
      jdUrl: item.jdUrl,
      lastCapturedAt: item.capturedAt,
      lastQuoteDate: snapshot.quoteDate,
      sourceFile: item.sourceFile,
      note: item.note,
    })
  }
  const linkRepositorySnapshot: CompetitorLinkRepositorySnapshot = {
    generatedAt: new Date().toISOString(),
    itemCount: linkMap.size,
    items: [...linkMap.values()].sort((left, right) => left.brand.localeCompare(right.brand, 'zh-CN') || left.rank - right.rank || left.productName.localeCompare(right.productName, 'zh-CN')),
  }
  const linkRepositoryArtifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-link-repository.json')
  const linkRepositoryWebPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-competitor-link-repository.json')
  await fs.writeFile(linkRepositoryArtifactPath, JSON.stringify(linkRepositorySnapshot, null, 2))
  await fs.writeFile(linkRepositoryWebPath, JSON.stringify(linkRepositorySnapshot, null, 2))

  return {
    artifactPath,
    webPath,
    snapshot,
    sourceFile: manual?.filePath,
    totalItemCount: normalized.totalItemCount,
    acceptedItemCount: items.length,
    rejectedByScopeCount: normalized.rejectedByScopeCount,
    storeFavoritesArtifactPath,
    storeFavoritesWebPath,
    linkRepositoryArtifactPath,
    linkRepositoryWebPath,
    collectionPlanArtifactPath: collectionPlan.artifactPath,
    collectionPlanWebPath: collectionPlan.webPath,
  }
}
