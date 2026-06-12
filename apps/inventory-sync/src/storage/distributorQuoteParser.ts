import fs from 'node:fs/promises'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'
import { saveMarketingBoostSnapshot } from './marketingBoostStore.js'

type ExcelCell = string | number | boolean | Date | null

type DistributorQuote = {
  source: 'wechat-distributor-group'
  groupName: string
  sourceFile: string
  quoteDate: string
  barcode?: string
  aiPc?: string
  pnMtm: string
  productName: string
  pickupPrice: number
  subsidyPrice?: number
  educationSubsidy?: number
  stockSignals: Record<string, string>
  sampleRequired?: string
  remark?: string
  isQianfan?: string
  matchFingerprint: string
  isCarriedForward?: boolean
  carryForwardFromQuoteDate?: string
  libraryMatch?: {
    status: 'inventory_pn_mtm' | 'inventory_fingerprint' | 'product_library_pn_mtm' | 'product_library_fingerprint' | 'unmatched'
    confidence: number
    primarySkuKey?: string
    productId?: string
    canonicalName?: string
    defaultCategory?: string
    sourceCategory?: string
    jdSubcategory?: string
    currentStock?: number
    sellableStock?: number
    evidence: string
  }
}

type QuoteMatchMethod = 'pn_mtm' | 'configuration_fingerprint'

type PriceProtectionCandidate = {
  skuKey: string
  productName: string
  pnMtm?: string
  currentStock: number
  serialCount: number
  inventoryAverageCost: number
  realtimePurchasePrice: number
  unitDiff: number
  estimatedProtectionAmount: number
  quoteDate: string
  quoteSourceFile: string
  status: '待申请' | '已申请' | '已核销'
  reason: string
  matchMethod: QuoteMatchMethod
  matchConfidence: number
}

type ProductLibraryProduct = {
  id: string
  canonical_name: string
  default_category?: string
  primary_sku_key?: string
  configuration_summary?: string
  pn_mtm?: string
  current_stock?: number
  sellable_stock?: number
  source_category?: string
  jd_subcategory?: string
}

type DistributorQuoteSnapshot = {
  generatedAt: string
  quoteDate?: string
  quoteFile?: string
  quoteCount: number
  isCarriedForward?: boolean
  carryForwardFrom?: string
  summary: {
    inventoryMatchedCount: number
    productLibraryMatchedCount: number
    unmatchedCount: number
    carryForwardCount?: number
  }
  quotes: DistributorQuote[]
}

function normalizeCell(cell: ExcelCell) {
  if (cell === null || cell === undefined) return ''
  return String(cell).trim()
}

function getNumber(cell: ExcelCell) {
  const raw = normalizeCell(cell).replace(/[^\d.-]/g, '')
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
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

function buildConfigFingerprint(productName?: string, spec?: string, pnMtm?: string) {
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

  addAll(/(YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|GEEKPRO)/g, (value) => value === 'LECOO' ? '来酷' : value === 'LEGION' ? '拯救者' : value)
  addAll(/([RY]\d{4}P?|战\d{4}|N\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[46]C)/g)
  addAll(/(ULTRA[579][-]?\d{3}[A-Z]*|CORE[3579][-]?\d{3}[A-Z]*|U[3579][-]?\d{3,4}[A-Z]*|I[3579][-]?\d{4,5}[A-Z]*)/g, (value) => value.replace(/^ULTRA/, 'U').replace(/^CORE/, 'U'))
  addAll(/(ULTRA[579]|CORE[3579]|U[3579]|I[3579]|R[3579])/g, (value) => value.replace(/^ULTRA/, 'U').replace(/^CORE/, 'U'))
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{5})(?:HX|H|U|V|P)/g, (value) => `CPU${value}`)
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{3,4})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/R[3579]-[A-Z]?([0-9]{3,5})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/(?:RTX)?(3050|4060|4070|5060|5070|5070TI|5080|5090)/g)
  addAll(/(?:^|[^0-9])((?:8|12|16|24|32|64)G)/g)
  addGroup(/(?:ULTRA[579][-]?\d{0,4}[A-Z]*|CORE[3579][-]?\d{0,4}[A-Z]*|U[3579][-]?\d{0,4}[A-Z]*|I[3579][-]?\d{0,5}[A-Z]*|R[3579]-[A-Z]?\d{0,5}[A-Z]*)((?:8|12|16|24|32|64)G)/g, 1)
  addAll(/(?:^|[^0-9])((?:128|256|512)G?|[12]T)/g, (value) => /G$|T$/.test(value) ? value : `${value}G`)
  addAll(/(\d{2}(\.\d)?寸)/g)

  const modelPrefix = String(pnMtm ?? '').trim().slice(0, 4).toUpperCase()
  if (modelPrefix) tokens.add(modelPrefix)
  return Array.from(tokens).sort().join('|')
}

function getTokenWeight(token: string) {
  if (/^(?:[RY]\d{4}P?|战\d{4}|N\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[46]C)$/i.test(token)) return 4
  if (/^(?:ULTRA|CORE|U[3579]|I[3579]|R[3579]|3050|4060|4070|5060|5070|5070TI|5080|5090)/i.test(token)) return 3
  if (/^(?:8|12|16|24|32|64)G$/i.test(token)) return 2
  return 1
}

function getFingerprintScore(a: string, b: string) {
  const left = new Set(a.split('|').filter(Boolean))
  const right = new Set(b.split('|').filter(Boolean))
  if (!left.size || !right.size) return 0

  const pick = (tokens: Set<string>, kind: 'series' | 'model' | 'cpu' | 'gpu' | 'memory' | 'storage') => Array.from(tokens).filter((token) => {
    if (kind === 'series') return /^(?:YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|GEEKPRO)$/i.test(token)
    if (kind === 'model') return /^(?:[RY]\d{4}P?|战\d{4}|N\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[46]C)$/i.test(token)
    if (kind === 'cpu') return /^(?:CPU\d{3,5}|U[3579]|I[3579]|R[3579])/i.test(token)
    if (kind === 'gpu') return /^(?:3050|4060|4070|5060|5070|5070TI|5080|5090)$/i.test(token)
    if (kind === 'memory') return /^(?:8|12|16|24|32|64)G$/i.test(token)
    return /^(?:(?:128|256|512)G|[12]T)$/i.test(token)
  })
  const hasOverlap = (leftTokens: string[], rightTokens: string[]) => leftTokens.some((token) => rightTokens.includes(token))
  const leftSeries = pick(left, 'series')
  const rightSeries = pick(right, 'series')
  if (leftSeries.length && rightSeries.length && !hasOverlap(leftSeries, rightSeries)) return 0

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
  if (criticalMatched >= 3) return 1

  let matched = 0
  let totalWeight = 0
  for (const item of left) {
    const weight = getTokenWeight(item)
    totalWeight += weight
    if (right.has(item)) matched += weight
  }
  const weightedScore = matched / Math.max(totalWeight, 1)
  if (criticalCompared < 2) return Math.min(weightedScore, 0.5)
  if (criticalCompared >= 2 && criticalMatched === criticalCompared && weightedScore >= 0.55) {
    return Math.max(weightedScore, 0.82)
  }
  return weightedScore
}

function isAccessoryOrLowValueSku(sku: StandardInventorySnapshot['skus'][number]) {
  const text = `${sku.category ?? ''} ${sku.jdSubcategory ?? ''} ${sku.productName}`
  return /电脑配件|耳机音箱|键盘|鼠标|适配器|支架|保护夹|钢化膜|背包|配件|耗材/.test(text)
    || Boolean(sku.agentPrice && sku.agentPrice <= 2500)
}

function isPlausibleMatchedPrice(sku: StandardInventorySnapshot['skus'][number], price?: number) {
  if (!price) return false
  if (isAccessoryOrLowValueSku(sku) && price > 2500) return false
  if (sku.agentPrice && price > sku.agentPrice + 2500) return false
  return true
}

function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => null)
}

function matchQuoteByFingerprint<T extends { matchFingerprint?: string }>(
  quoteFingerprint: string,
  targets: T[],
  getLabel: (target: T) => string,
) {
  let best: { target: T; confidence: number; evidence: string } | null = null
  for (const target of targets) {
    const candidateFingerprint = String(target.matchFingerprint ?? '').trim()
    if (!candidateFingerprint) continue
    const confidence = getFingerprintScore(quoteFingerprint, candidateFingerprint)
    if (confidence < 0.55) continue
    if (!best || confidence > best.confidence) {
      best = {
        target,
        confidence,
        evidence: `按配置指纹匹配 ${getLabel(target)}`,
      }
    }
  }
  return best
}

function enrichDistributorQuotes(
  quotes: DistributorQuote[],
  inventory: StandardInventorySnapshot,
  productLibraryProducts: ProductLibraryProduct[],
) {
  const inventoryPnMap = new Map(
    inventory.skus
      .filter((sku) => sku.pnMtm)
      .map((sku) => [String(sku.pnMtm).trim().toUpperCase(), sku] as const),
  )
  const inventoryTargets = inventory.skus.map((sku) => ({
    skuKey: sku.skuKey,
    productName: sku.productName,
    pnMtm: sku.pnMtm,
    currentStock: sku.currentStock,
    sellableStock: sku.sellableStock,
    matchFingerprint: buildConfigFingerprint(sku.productName, sku.spec, sku.pnMtm),
  }))
  const productLibraryPnMap = new Map(
    productLibraryProducts
      .filter((item) => item.pn_mtm)
      .map((item) => [String(item.pn_mtm).trim().toUpperCase(), item] as const),
  )
  const productLibraryTargets = productLibraryProducts.map((item) => ({
    ...item,
    matchFingerprint: buildConfigFingerprint(item.canonical_name, item.configuration_summary, item.pn_mtm),
  }))

  let inventoryMatchedCount = 0
  let productLibraryMatchedCount = 0
  let unmatchedCount = 0

  const enrichedQuotes = quotes.map((quote) => {
    const pnKey = String(quote.pnMtm ?? '').trim().toUpperCase()
    const inventoryPnMatched = pnKey ? inventoryPnMap.get(pnKey) : undefined
    if (inventoryPnMatched) {
      inventoryMatchedCount += 1
      return {
        ...quote,
        libraryMatch: {
          status: 'inventory_pn_mtm' as const,
          confidence: 1,
          primarySkuKey: inventoryPnMatched.skuKey,
          canonicalName: inventoryPnMatched.productName,
          currentStock: inventoryPnMatched.currentStock,
          sellableStock: inventoryPnMatched.sellableStock,
          evidence: `按 PN/MTM 命中在库 SKU ${inventoryPnMatched.skuKey}`,
        },
      }
    }

    const inventoryFingerprintMatched = matchQuoteByFingerprint(
      quote.matchFingerprint,
      inventoryTargets,
      (target) => `${target.skuKey} ${target.productName}`,
    )
    if (inventoryFingerprintMatched) {
      inventoryMatchedCount += 1
      return {
        ...quote,
        libraryMatch: {
          status: 'inventory_fingerprint' as const,
          confidence: inventoryFingerprintMatched.confidence,
          primarySkuKey: inventoryFingerprintMatched.target.skuKey,
          canonicalName: inventoryFingerprintMatched.target.productName,
          currentStock: inventoryFingerprintMatched.target.currentStock,
          sellableStock: inventoryFingerprintMatched.target.sellableStock,
          evidence: inventoryFingerprintMatched.evidence,
        },
      }
    }

    const productLibraryPnMatched = pnKey ? productLibraryPnMap.get(pnKey) : undefined
    if (productLibraryPnMatched) {
      productLibraryMatchedCount += 1
      return {
        ...quote,
        libraryMatch: {
          status: 'product_library_pn_mtm' as const,
          confidence: 1,
          primarySkuKey: productLibraryPnMatched.primary_sku_key,
          productId: productLibraryPnMatched.id,
          canonicalName: productLibraryPnMatched.canonical_name,
          defaultCategory: productLibraryPnMatched.default_category,
          sourceCategory: productLibraryPnMatched.source_category,
          jdSubcategory: productLibraryPnMatched.jd_subcategory,
          currentStock: productLibraryPnMatched.current_stock,
          sellableStock: productLibraryPnMatched.sellable_stock,
          evidence: `按 PN/MTM 命中标准商品库 ${productLibraryPnMatched.id}`,
        },
      }
    }

    const productLibraryFingerprintMatched = matchQuoteByFingerprint(
      quote.matchFingerprint,
      productLibraryTargets,
      (target) => `${target.id} ${target.canonical_name}`,
    )
    if (productLibraryFingerprintMatched) {
      productLibraryMatchedCount += 1
      return {
        ...quote,
        libraryMatch: {
          status: 'product_library_fingerprint' as const,
          confidence: productLibraryFingerprintMatched.confidence,
          primarySkuKey: productLibraryFingerprintMatched.target.primary_sku_key,
          productId: productLibraryFingerprintMatched.target.id,
          canonicalName: productLibraryFingerprintMatched.target.canonical_name,
          defaultCategory: productLibraryFingerprintMatched.target.default_category,
          sourceCategory: productLibraryFingerprintMatched.target.source_category,
          jdSubcategory: productLibraryFingerprintMatched.target.jd_subcategory,
          currentStock: productLibraryFingerprintMatched.target.current_stock,
          sellableStock: productLibraryFingerprintMatched.target.sellable_stock,
          evidence: productLibraryFingerprintMatched.evidence,
        },
      }
    }

    unmatchedCount += 1
    return {
      ...quote,
      libraryMatch: {
        status: 'unmatched' as const,
        confidence: 0,
        evidence: '当前未命中在库 SKU，也未命中标准商品库。',
      },
    }
  })

  return {
    quotes: enrichedQuotes,
    summary: {
      inventoryMatchedCount,
      productLibraryMatchedCount,
      unmatchedCount,
    },
  }
}

function extractQuoteDate(filePath: string) {
  const fileName = path.basename(filePath)
  const match = fileName.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!match) return new Date().toISOString().slice(0, 10)
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function extractQuoteDateFromFileName(filePath: string) {
  const fileName = path.basename(filePath)
  const chinese = fileName.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (chinese) {
    const [, year, month, day] = chinese
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const dashed = fileName.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/)
  if (dashed) {
    const [, year, month, day] = dashed
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const compact = fileName.match(/(20\d{2})(\d{2})(\d{2})/)
  if (compact) {
    const [, year, month, day] = compact
    return `${year}-${month}-${day}`
  }
  return undefined
}

function getBeijingDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

async function findFiles(dir: string, matcher: (filePath: string) => boolean, depth = 0): Promise<string[]> {
  if (depth > 7) return []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    const filePath = path.resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      files.push(...await findFiles(filePath, matcher, depth + 1))
    } else if (matcher(filePath)) {
      files.push(filePath)
    }
  }

  return files
}

async function findRecentDistributorQuoteFiles() {
  const home = process.env.HOME ?? ''
  const sourceRoots = [
    path.resolve(config.lenovoRetail.artifactDir, 'manual/wechat-quote-collection/current'),
    path.resolve(home, '.local/share/wechat-selkies/config/xwechat_files'),
    path.resolve(home, 'Downloads/codex-installs/wechat-selkies/config/xwechat_files'),
  ]
  const files = (await Promise.all(sourceRoots.map((wechatRoot) => (
    findFiles(wechatRoot, (filePath) => /分销库存.*\.xlsx$/i.test(path.basename(filePath)))
  )))).flat()
  const withStats = await Promise.all(files.map(async (filePath) => ({
    filePath,
    quoteDate: extractQuoteDateFromFileName(filePath),
    mtimeMs: (await fs.stat(filePath)).mtimeMs,
  })))
  return withStats
    .filter((item) => item.quoteDate)
    .sort((a, b) => {
      const dateScore = String(b.quoteDate ?? '').localeCompare(String(a.quoteDate ?? ''))
      if (dateScore !== 0) return dateScore
      return b.mtimeMs - a.mtimeMs
    })
}

export async function findLatestDistributorQuoteFile() {
  const today = getBeijingDateString()
  const withStats = await findRecentDistributorQuoteFiles()

  return withStats.sort((a, b) => {
    const todayScore = Number(b.quoteDate === today) - Number(a.quoteDate === today)
    if (todayScore !== 0) return todayScore
    const dateScore = String(b.quoteDate ?? '').localeCompare(String(a.quoteDate ?? ''))
    if (dateScore !== 0) return dateScore
    return b.mtimeMs - a.mtimeMs
  })[0]?.filePath
}

export async function parseDistributorQuoteFile(filePath: string): Promise<DistributorQuote[]> {
  const result = await readXlsxFile(filePath) as unknown
  const rows = Array.isArray(result) && Array.isArray(result[0])
    ? result as ExcelCell[][]
    : Array.isArray(result) && typeof result[0] === 'object' && result[0] !== null && 'data' in result[0]
      ? (result[0] as { data: ExcelCell[][] }).data
      : []
  const headerRowIndex = rows.findIndex((row) => row.map(normalizeCell).includes('物料编码'))
  if (headerRowIndex < 0) return []

  const header = rows[headerRowIndex].map(normalizeCell)
  const index = Object.fromEntries(header.map((name, i) => [name, i]))
  const quoteDate = extractQuoteDate(filePath)

  const quotes: DistributorQuote[] = []
  for (const row of rows.slice(headerRowIndex + 1)) {
      const pnMtm = normalizeCell(row[index['物料编码']])
      const pickupPrice = getNumber(row[index['提货价']])
      if (!pnMtm || pickupPrice === undefined) continue

      const stockSignals: Record<string, string> = {}
      for (const name of ['小库', 'SEC', '翰林汇天津', '天津诚义T', '翰林汇在途']) {
        const value = normalizeCell(row[index[name]])
        if (value) stockSignals[name] = value
      }

      quotes.push({
        source: 'wechat-distributor-group' as const,
        groupName: '圣之航-河南政策沟通群',
        sourceFile: filePath,
        quoteDate,
        barcode: normalizeCell(row[index['国补69码']]),
        aiPc: normalizeCell(row[index['是否AIPC']]),
        pnMtm,
        productName: normalizeCell(row[index['机型及详细配置']]),
        pickupPrice,
        subsidyPrice: getNumber(row[index['26年国补价格']]),
        educationSubsidy: getNumber(row[index['教育补贴\n学生特惠']]),
        stockSignals,
        sampleRequired: normalizeCell(row[index['是否出样']]),
        remark: normalizeCell(row[index['备注：红包、赠品、活动、临时方案等']]),
        isQianfan: normalizeCell(row[index['是否千帆机型']]),
        matchFingerprint: buildConfigFingerprint(normalizeCell(row[index['机型及详细配置']]), undefined, pnMtm),
      })
  }

  return quotes
}

async function buildCarryForwardDistributorQuotes(
  todayQuotes: DistributorQuote[],
  inventory: StandardInventorySnapshot,
  productLibraryItems: ProductLibraryProduct[],
) {
  const todayQuoteDate = todayQuotes[0]?.quoteDate
  const todayBySku = new Set(
    todayQuotes
      .map((quote) => quote.libraryMatch?.primarySkuKey)
      .filter((value): value is string => Boolean(value)),
  )
  const todayByPn = new Set(
    todayQuotes
      .map((quote) => String(quote.pnMtm || '').trim().toUpperCase())
      .filter(Boolean),
  )
  const recentFiles = await findRecentDistributorQuoteFiles()
  const carryForward: DistributorQuote[] = []
  const carriedSku = new Set<string>()
  const carriedPn = new Set<string>()
  for (const item of recentFiles) {
    if (!item.quoteDate || item.quoteDate === todayQuoteDate) continue
    const parsed = await parseDistributorQuoteFile(item.filePath)
    if (!parsed.length) continue
    const enriched = enrichDistributorQuotes(parsed, inventory, productLibraryItems).quotes
    for (const quote of enriched) {
      const skuKey = String(quote.libraryMatch?.primarySkuKey || '').trim()
      const pnKey = String(quote.pnMtm || '').trim().toUpperCase()
      const targetsCurrentInventory = skuKey
        ? inventory.skus.some((sku) => sku.currentStock > 0 && sku.skuKey === skuKey)
        : false
      if (skuKey) {
        if (!targetsCurrentInventory || todayBySku.has(skuKey) || carriedSku.has(skuKey)) continue
      } else if (!pnKey || todayByPn.has(pnKey) || carriedPn.has(pnKey)) {
        continue
      }
      carryForward.push({
        ...quote,
        isCarriedForward: true,
        carryForwardFromQuoteDate: quote.quoteDate,
      })
      if (skuKey) carriedSku.add(skuKey)
      if (pnKey) carriedPn.add(pnKey)
    }
  }
  return carryForward
}

export function buildPriceProtectionSnapshot(inventory: StandardInventorySnapshot, quotes: DistributorQuote[]) {
  const quoteByMtm = new Map(quotes.map((quote) => [quote.pnMtm, quote]))
  const matchedInventory = inventory.skus
    .map((sku) => {
      const directQuote = sku.pnMtm ? quoteByMtm.get(sku.pnMtm) : undefined
      if (directQuote && isPlausibleMatchedPrice(sku, directQuote.pickupPrice)) {
        return { sku, quote: directQuote, matchMethod: 'pn_mtm' as const, matchConfidence: 1 }
      }
      return null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const candidates: PriceProtectionCandidate[] = matchedInventory
    .filter(({ sku, quote }) => sku.currentStock > 0 && Boolean(sku.salesCostPrice) && (sku.salesCostPrice ?? 0) > quote.pickupPrice)
    .map(({ sku, quote, matchMethod, matchConfidence }) => {
      const inventoryAverageCost = sku.salesCostPrice ?? 0
      const unitDiff = Number((inventoryAverageCost - quote.pickupPrice).toFixed(2))
      return {
        skuKey: sku.skuKey,
        productName: sku.productName,
        pnMtm: sku.pnMtm,
        currentStock: sku.currentStock,
        serialCount: sku.serialCount,
        inventoryAverageCost,
        realtimePurchasePrice: quote.pickupPrice,
        unitDiff,
        estimatedProtectionAmount: Number((unitDiff * sku.currentStock).toFixed(2)),
        quoteDate: quote.quoteDate,
        quoteSourceFile: quote.sourceFile,
        status: '待申请' as const,
        reason: '库存进货价高于分销商当日提货价',
        matchMethod,
        matchConfidence,
      }
    })
    .sort((a, b) => b.estimatedProtectionAmount - a.estimatedProtectionAmount)

  return {
    generatedAt: new Date().toISOString(),
    source: 'wechat-distributor-group',
    groupName: '圣之航-河南政策沟通群',
    quoteDate: quotes[0]?.quoteDate,
    quoteFile: quotes[0]?.sourceFile,
    quoteCount: quotes.length,
    matchedSkuCount: matchedInventory.length,
    candidates,
  }
}

export async function saveDistributorQuoteArtifacts() {
  const quoteFile = await findLatestDistributorQuoteFile()
  if (!quoteFile) throw new Error('未找到分销库存报价文件')

  const quotes = await parseDistributorQuoteFile(quoteFile)
  const quoteDate = quotes[0]?.quoteDate
  const today = getBeijingDateString()
  if (!quoteDate) throw new Error('无法确认分销报价日期')
  const inventoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf-8')) as StandardInventorySnapshot
  const productLibraryPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-product-library-products.json')
  const productLibrarySnapshot = await readJsonIfExists<{ items?: ProductLibraryProduct[] }>(productLibraryPath)
  const todayEnriched = enrichDistributorQuotes(quotes, inventory, productLibrarySnapshot?.items ?? [])
  const carryForwardQuotes = await buildCarryForwardDistributorQuotes(quotes, inventory, productLibrarySnapshot?.items ?? [])
  const mergedQuotes = [...todayEnriched.quotes, ...carryForwardQuotes]
  const enriched = {
    quotes: mergedQuotes,
    summary: {
      ...todayEnriched.summary,
      carryForwardCount: carryForwardQuotes.length,
    },
  }
  const priceProtection = buildPriceProtectionSnapshot(inventory, mergedQuotes)

  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  const webDistDataDir = path.resolve(config.appDir, '../web-cockpit/dist/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })
  await fs.mkdir(webDistDataDir, { recursive: true })

  const quotesPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-distributor-quotes.json')
  const priceProtectionPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-price-protection-snapshot.json')
  const webQuotesPath = path.resolve(webPublicDataDir, 'latest-distributor-quotes.json')
  const webPriceProtectionPath = path.resolve(webPublicDataDir, 'latest-price-protection-snapshot.json')
  const distQuotesPath = path.resolve(webDistDataDir, 'latest-distributor-quotes.json')
  const distPriceProtectionPath = path.resolve(webDistDataDir, 'latest-price-protection-snapshot.json')

  const quoteSnapshot: DistributorQuoteSnapshot = {
    generatedAt: new Date().toISOString(),
    quoteDate,
    quoteFile,
    quoteCount: mergedQuotes.length,
    isCarriedForward: quoteDate !== today,
    carryForwardFrom: quoteDate !== today ? quoteDate : undefined,
    summary: enriched.summary,
    quotes: mergedQuotes,
  }

  await fs.writeFile(quotesPath, JSON.stringify(quoteSnapshot, null, 2))
  await fs.writeFile(priceProtectionPath, JSON.stringify(priceProtection, null, 2))
  await fs.writeFile(webQuotesPath, JSON.stringify(quoteSnapshot, null, 2))
  await fs.writeFile(webPriceProtectionPath, JSON.stringify(priceProtection, null, 2))
  await fs.writeFile(distQuotesPath, JSON.stringify(quoteSnapshot, null, 2))
  await fs.writeFile(distPriceProtectionPath, JSON.stringify(priceProtection, null, 2))
  const marketingBoost = await saveMarketingBoostSnapshot()

  return {
    quotesPath,
    priceProtectionPath,
    webQuotesPath,
    webPriceProtectionPath,
    distQuotesPath,
    distPriceProtectionPath,
    quoteFile,
    quoteCount: mergedQuotes.length,
    priceProtection,
    marketingBoost,
  }
}
