import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySku, StandardInventorySnapshot } from '../types.js'
import type { MarketplacePriceRecord, MarketplacePriceSnapshot, MarketplaceSource } from '../storage/marketplacePriceCollector.js'

type RetailAuditSource = Extract<MarketplaceSource, 'jd' | 'lenovo_official' | 'taobao_subsidy'>
const marketplaceFreshnessHours = 36

export type RetailPriceAuditItem = {
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  jdSubcategory?: string
  currentStock: number
  sellableStock: number
  costBasis?: number
  costBasisLabel: 'salesCostPrice' | 'agentPrice' | 'missing'
  markupGroup: 'accessory' | 'computer_or_other'
  maxMarkupRate: number
  maxAllowedRetailPrice?: number
  sourceStatus: Array<{
    source: RetailAuditSource
    sourceLabel: string
    price?: number
    matchTitle?: string
    evidenceUrl?: string
    capturedAt?: string
    status: 'valid' | 'missing' | 'over_markup' | 'missing_cost'
    markupRate?: number
    reason: string
  }>
  auditStatus: 'valid' | 'missing_price' | 'over_markup' | 'missing_cost'
  manualReviewRequired: boolean
  searchUrls: Record<RetailAuditSource, string>
}

export type RetailPriceAuditSnapshot = {
  generatedAt: string
  policy: {
    sources: RetailAuditSource[]
    accessoryMaxMarkupRate: number
    computerAndOtherMaxMarkupRate: number
    pddExcluded: true
    limitation: string
  }
  totals: {
    skuCount: number
    inStockSkuCount: number
    validCount: number
    missingPriceCount: number
    overMarkupCount: number
    missingCostCount: number
    manualReviewRequiredCount: number
  }
  items: RetailPriceAuditItem[]
  priorityManualCaptureItems: RetailPriceAuditItem[]
}

const auditSources: RetailAuditSource[] = ['jd', 'lenovo_official', 'taobao_subsidy']
const jdLenovoSelfMallUrl = 'https://lenovo1.jd.com/'
const lenovoShopSearchBaseUrl = 'https://s.lenovo.com.cn/search/'
const taobaoSearchBaseUrl = 'https://s.taobao.com/search'

function cleanSearchTerm(value?: string) {
  return String(value ?? '')
    .replace(/\*/g, '')
    .replace(/\bWIN(?:DOWS)?\s*11\b/gi, '')
    .replace(/\b11C\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchSequence(sku: StandardInventorySku) {
  const text = cleanSearchTerm(`${sku.productName} ${sku.spec ?? ''}`)
  const model = text.match(/(ThinkPad|YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|战7000|GEEKPRO|AIR\s?\d{2}|PRO\s?\d{2}(?:GT)?|Y\d{4}P?|R\d{4}P?|N\d{3}[A-Z]?|TAB|Y700|天逸\d+[A-Z]?)/i)?.[0]
    ?? cleanSearchTerm(sku.productName).split(/\s+/).slice(0, 3).join(' ')
  const cpu = text.match(/(?:ULTRA\s?[579][-\s]?\d{3}[A-Z]*|I[3579][-\s]?\d{4,5}[A-Z]*|R[3579][-\s]?[A-Z]?\d{3,5}[A-Z]*|R7[-\s]?H255|13650HX|13645HX|14700HX|8945HX|骁龙\s?8\s?GEN\s?3)/i)?.[0]
  const memory = text.match(/\b(?:8|12|16|24|32|64)G(?:B)?\b/i)?.[0]
  const storage = text.match(/\b(?:128G|256G|512G|1T|2T)(?:SSD|固态)?\b/i)?.[0]
  const gpu = text.match(/RTX\s?(?:3050|4050|4060|4070|5050|5060|5070|5070TI|5080|5090)(?:-\dG)?/i)?.[0]
  const color = text.match(/(钛晶黑|碳晶黑|冰魄白|月幕白|深空灰|曜石金|灰色|白色|黑色|黑|白|银色|卷云灰|深空灰)/i)?.[0]

  const modelOnly = cleanSearchTerm(model)
  const withConfig = cleanSearchTerm([model, cpu, memory, storage, gpu].filter(Boolean).join(' '))
  const withColor = cleanSearchTerm([model, cpu, memory, storage, gpu, color].filter(Boolean).join(' '))
  return Array.from(new Set([modelOnly, withConfig, withColor].filter((value) => value.length >= 2)))
}

function getSearchUrl(source: RetailAuditSource, query: string) {
  const encoded = encodeURIComponent(query)
  if (source === 'jd') return `${jdLenovoSelfMallUrl}?keyword=${encoded}`
  if (source === 'lenovo_official') return `${lenovoShopSearchBaseUrl}?key=${encoded}&isProprietary=true&page=`
  return `${taobaoSearchBaseUrl}?q=${encoded}`
}

function getSkuQuery(sku: StandardInventorySku) {
  return buildSearchSequence(sku)[0] ?? cleanSearchTerm(sku.productName)
}

function getCostBasis(sku: StandardInventorySku) {
  if (typeof sku.salesCostPrice === 'number' && Number.isFinite(sku.salesCostPrice) && sku.salesCostPrice > 0) {
    return { costBasis: sku.salesCostPrice, costBasisLabel: 'salesCostPrice' as const }
  }
  if (typeof sku.agentPrice === 'number' && Number.isFinite(sku.agentPrice) && sku.agentPrice > 0) {
    return { costBasis: sku.agentPrice, costBasisLabel: 'agentPrice' as const }
  }
  return { costBasis: undefined, costBasisLabel: 'missing' as const }
}

function isAccessorySku(sku: StandardInventorySku) {
  const text = `${sku.category ?? ''} ${sku.sourceCategory ?? ''} ${sku.jdSubcategory ?? ''} ${sku.productName} ${sku.spec ?? ''} ${sku.pnMtm ?? ''}`
  return /电脑配件|耳机音箱|显示器|打印机|鼠标|键盘|键鼠|支架|适配器|充电器|氮化镓|硬盘|箱包|背包|保护|钢化膜|手写笔|耳机|耳麦|音箱|打印|耗材|火力强化/i.test(text)
}

function getComparablePrice(record?: MarketplacePriceRecord) {
  const candidates = [
    record?.price,
    record?.preSubsidyPrice,
    record?.couponAdjustedPrice,
    record?.postSubsidyPrice,
  ]
  return candidates.find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
}

function isFreshTimestamp(value?: string) {
  if (!value) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  return (Date.now() - parsed) / 36e5 <= marketplaceFreshnessHours
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
}

function indexMarketplaceRecords(snapshot: MarketplacePriceSnapshot) {
  const index = new Map<string, MarketplacePriceRecord>()
  for (const record of snapshot.records) {
    if (record.source !== 'jd' && record.source !== 'lenovo_official' && record.source !== 'taobao_subsidy') continue
    const capturedAt = record.evidence?.capturedAt ?? snapshot.generatedAt
    if (!isFreshTimestamp(capturedAt)) continue
    const key = `${record.productId}:${record.source}`
    const previous = index.get(key)
    if (!previous) {
      index.set(key, record)
      continue
    }
    const previousPrice = getComparablePrice(previous)
    const currentPrice = getComparablePrice(record)
    if (currentPrice !== undefined && previousPrice === undefined) index.set(key, record)
    if (record.collectionStatus === 'captured' && previous.collectionStatus !== 'captured') index.set(key, record)
  }
  return index
}

function buildSourceAudit(input: {
  source: RetailAuditSource
  record?: MarketplacePriceRecord
  costBasis?: number
  maxAllowedRetailPrice?: number
}) {
  const price = getComparablePrice(input.record)
  const sourceLabel = input.source === 'jd'
    ? '京东自营'
    : input.source === 'lenovo_official'
      ? '联想官网/官旗'
      : '天猫/淘宝补充'
  if (!input.costBasis || !input.maxAllowedRetailPrice) {
    return {
      source: input.source,
      sourceLabel,
      price,
      matchTitle: input.record?.matchTitle,
      evidenceUrl: input.record?.evidence.evidenceUrl ?? input.record?.configuredUrl,
      capturedAt: input.record?.evidence.capturedAt,
      status: 'missing_cost' as const,
      reason: '库存快照缺少进货价/成本价，无法执行价差上限校验。',
    }
  }
  if (price === undefined) {
    return {
      source: input.source,
      sourceLabel,
      matchTitle: input.record?.matchTitle,
      evidenceUrl: input.record?.evidence.evidenceUrl ?? input.record?.configuredUrl,
      capturedAt: input.record?.evidence.capturedAt,
      status: 'missing' as const,
      reason: `该平台尚未采集到 ${marketplaceFreshnessHours} 小时内可用零售价。`,
    }
  }
  const markupRate = (price - input.costBasis) / input.costBasis
  if (price > input.maxAllowedRetailPrice) {
    return {
      source: input.source,
      sourceLabel,
      price,
      matchTitle: input.record?.matchTitle,
      evidenceUrl: input.record?.evidence.evidenceUrl ?? input.record?.configuredUrl,
      capturedAt: input.record?.evidence.capturedAt,
      status: 'over_markup' as const,
      markupRate,
      reason: `采集价 ${price} 超过允许上限 ${input.maxAllowedRetailPrice}，需要登录页面人工复核后再同步。`,
    }
  }
  return {
    source: input.source,
    sourceLabel,
    price,
    matchTitle: input.record?.matchTitle,
    evidenceUrl: input.record?.evidence.evidenceUrl ?? input.record?.configuredUrl,
    capturedAt: input.record?.evidence.capturedAt,
    status: 'valid' as const,
    markupRate,
    reason: '已通过进货价价差规则。',
  }
}

export async function buildRetailPriceAuditSnapshot(): Promise<RetailPriceAuditSnapshot> {
  const inventoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const marketplacePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-marketplace-price-snapshot.json')
  const inventory = await readJson<StandardInventorySnapshot>(inventoryPath)
  const marketplace = await readJson<MarketplacePriceSnapshot>(marketplacePath).catch(async () => {
    const webMarketplacePath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-marketplace-price-snapshot.json')
    return readJson<MarketplacePriceSnapshot>(webMarketplacePath)
  })
  const marketplaceIndex = indexMarketplaceRecords(marketplace)

  const items = inventory.skus
    .filter((sku) => sku.currentStock > 0)
    .map((sku): RetailPriceAuditItem => {
      const { costBasis, costBasisLabel } = getCostBasis(sku)
      const markupGroup = isAccessorySku(sku) ? 'accessory' : 'computer_or_other'
      const maxMarkupRate = markupGroup === 'accessory' ? 1 : 0.3
      const maxAllowedRetailPrice = costBasis ? Math.round(costBasis * (1 + maxMarkupRate)) : undefined
      const query = getSkuQuery(sku)
      const sourceStatus = auditSources.map((source) => buildSourceAudit({
        source,
        record: marketplaceIndex.get(`${sku.skuKey}:${source}`),
        costBasis,
        maxAllowedRetailPrice,
      }))
      const hasValid = sourceStatus.some((source) => source.status === 'valid')
      const hasOverMarkup = sourceStatus.some((source) => source.status === 'over_markup')
      const allMissing = sourceStatus.every((source) => source.status === 'missing')
      const auditStatus = !costBasis
        ? 'missing_cost'
        : hasOverMarkup
          ? 'over_markup'
          : hasValid
            ? 'valid'
            : allMissing
              ? 'missing_price'
              : 'missing_price'
      return {
        skuKey: sku.skuKey,
        productName: sku.productName,
        pnMtm: sku.pnMtm,
        spec: sku.spec,
        category: sku.category,
        jdSubcategory: sku.jdSubcategory,
        currentStock: sku.currentStock,
        sellableStock: sku.sellableStock,
        costBasis,
        costBasisLabel,
        markupGroup,
        maxMarkupRate,
        maxAllowedRetailPrice,
        sourceStatus,
        auditStatus,
        manualReviewRequired: auditStatus !== 'valid',
        searchUrls: {
          jd: getSearchUrl('jd', query),
          lenovo_official: getSearchUrl('lenovo_official', query),
          taobao_subsidy: getSearchUrl('taobao_subsidy', query),
        },
      }
    })

  const priorityManualCaptureItems = [...items]
    .filter((item) => item.manualReviewRequired)
    .sort((a, b) => {
      const statusPriority: Record<RetailPriceAuditItem['auditStatus'], number> = {
        over_markup: 0,
        missing_price: 1,
        missing_cost: 2,
        valid: 3,
      }
      return statusPriority[a.auditStatus] - statusPriority[b.auditStatus]
        || b.currentStock - a.currentStock
        || a.productName.localeCompare(b.productName, 'zh-Hans-CN')
    })
    .slice(0, 50)

  return {
    generatedAt: new Date().toISOString(),
    policy: {
      sources: auditSources,
      accessoryMaxMarkupRate: 1,
      computerAndOtherMaxMarkupRate: 0.3,
      pddExcluded: true,
      limitation: `本审计主看京东、联想官旗与天猫/淘宝补充；当联想官旗下架/失效时必须继续审天猫/淘宝补充路径，当京东指定链接失效时允许转京东全站补链。超过 ${marketplaceFreshnessHours} 小时未复核的旧价不再视为当期实时价。拼多多仍按业务要求排除。缺价与价差异常不会自动写入有效零售价，需要登录页面复核后同步。`,
    },
    totals: {
      skuCount: inventory.skus.length,
      inStockSkuCount: items.length,
      validCount: items.filter((item) => item.auditStatus === 'valid').length,
      missingPriceCount: items.filter((item) => item.auditStatus === 'missing_price').length,
      overMarkupCount: items.filter((item) => item.auditStatus === 'over_markup').length,
      missingCostCount: items.filter((item) => item.auditStatus === 'missing_cost').length,
      manualReviewRequiredCount: items.filter((item) => item.manualReviewRequired).length,
    },
    items,
    priorityManualCaptureItems,
  }
}

export async function saveRetailPriceAuditSnapshot() {
  const snapshot = await buildRetailPriceAuditSnapshot()
  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })

  const content = JSON.stringify(snapshot, null, 2)
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-retail-price-audit.json')
  const webPath = path.resolve(webPublicDataDir, 'latest-retail-price-audit.json')
  await fs.writeFile(artifactPath, content, 'utf-8')
  await fs.writeFile(webPath, content, 'utf-8')

  return { artifactPath, webPath, snapshot }
}
