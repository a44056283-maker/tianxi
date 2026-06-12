import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot, StandardInventorySku } from '../types.js'
import { saveMarketplacePriceSnapshot, type MarketplacePriceRecord, type MarketplacePriceSnapshot, type MarketplaceSource } from './marketplacePriceCollector.js'

type JustOnePlatform = 'jd' | 'taobao'

type CandidateItem = {
  id?: string
  itemId?: string
  skuId?: string
  title?: string
  name?: string
  price?: unknown
  finalPrice?: unknown
  promotionPrice?: unknown
  salePrice?: unknown
  originalPrice?: unknown
  url?: string
  itemUrl?: string
  detailUrl?: string
  shopName?: string
  raw?: unknown
}

const platformSearchPath: Record<JustOnePlatform, string | undefined> = {
  jd: '/api/jd/search-item-list/v1',
  taobao: '/api/taobao/search-item-list/v1',
}

function cleanSearchTerm(value?: string) {
  return String(value ?? '')
    .replace(/\*/g, '')
    .replace(/\bWIN(?:DOWS)?\s*11\b/gi, '')
    .replace(/\b11C\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchKeyword(row: StandardInventorySku) {
  const text = cleanSearchTerm(`${row.productName} ${row.spec ?? ''}`)
  const model = text.match(/(ThinkPad|YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|战7000|GEEKPRO|[RY]\d{4}P?|Y\d{4}P?|N\d{3}[A-Z]?|PRO\s?\d{2}(?:GT)?|AIR\s?\d{2}|TAB|Y700|moto|razr|edge|天逸\d+[A-Z]?)/i)?.[0]
  const cpu = text.match(/(?:ULTRA\s?[579][-\s]?\d{3}[A-Z]*|I[3579][-\s]?\d{4,5}[A-Z]*|R[3579][-\s]?[A-Z]?\d{3,5}[A-Z]*|R7[-\s]?H255|I[3579]\d{4,5}[A-Z]*)/i)?.[0]
  const memory = text.match(/\b(?:8|12|16|24|32|64)G(?:B)?\b/i)?.[0]
  const storage = text.match(/\b(?:512G|1T|2T)(?:SSD|固态)?\b/i)?.[0]
  const gpu = text.match(/RTX\s?(?:3050|4050|4060|4070|5050|5060|5070|5070TI|5080|5090)(?:-\dG)?/i)?.[0]
  const color = text.match(/(钛晶黑|碳晶黑|冰魄白|月幕白|深空灰|曜石金|灰色|白色|黑色|黑|白)/)?.[0]
  const tokens = [model, cpu, memory, storage, gpu, color].filter(Boolean) as string[]
  return tokens.length >= 2 ? tokens.join(' ') : cleanSearchTerm(row.productName).slice(0, 48)
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number(value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function collectCandidates(payload: unknown): CandidateItem[] {
  if (Array.isArray(payload)) return payload as CandidateItem[]
  if (!payload || typeof payload !== 'object') return []
  const object = payload as Record<string, unknown>
  for (const key of ['items', 'list', 'result', 'results', 'data']) {
    const value = object[key]
    if (Array.isArray(value)) return value as CandidateItem[]
    const nested = collectCandidates(value)
    if (nested.length) return nested
  }
  return []
}

function getPlatformSource(platform: JustOnePlatform): MarketplaceSource {
  if (platform === 'jd') return 'jd'
  return 'taobao_subsidy'
}

function getSourceLabel(source: MarketplaceSource) {
  if (source === 'jd') return '京东'
  if (source === 'taobao_subsidy') return '淘宝百亿补贴'
  return '联想官网'
}

function getEvidenceUrl(platform: JustOnePlatform, keyword: string, item: CandidateItem) {
  if (item.url || item.itemUrl || item.detailUrl) return String(item.url ?? item.itemUrl ?? item.detailUrl)
  const encoded = encodeURIComponent(keyword)
  if (platform === 'jd') return `https://search.jd.com/Search?keyword=${encoded}`
  return `https://s.taobao.com/search?q=${encoded}`
}

function toMarketplaceRecord(platform: JustOnePlatform, sku: StandardInventorySku, keyword: string, item: CandidateItem): MarketplacePriceRecord {
  const source = getPlatformSource(platform)
  const price = parseOptionalNumber(item.finalPrice)
    ?? parseOptionalNumber(item.promotionPrice)
    ?? parseOptionalNumber(item.salePrice)
    ?? parseOptionalNumber(item.price)
    ?? parseOptionalNumber(item.originalPrice)
  const title = String(item.title ?? item.name ?? keyword)
  return {
    source,
    sourceLabel: getSourceLabel(source),
    sourceType: source === 'jd' ? 'subsidy_reference_price' : 'subsidy_reference_price',
    productId: sku.skuKey,
    query: keyword,
    configuredUrl: getEvidenceUrl(platform, keyword, item),
    productName: sku.productName,
    platformSkuId: String(item.skuId ?? item.itemId ?? item.id ?? ''),
    matchTitle: title,
    price,
    priceType: 'display_price',
    priceBasis: 'JustOneAPI 商品搜索结果展示价；需要按平台页面二次确认是否为国补前价。',
    taxIncluded: platform === 'jd',
    serviceIncluded: platform === 'jd',
    confidence: price ? 'manual' : 'sample',
    collectionStatus: price ? 'captured' : 'manual_review_required',
    evidence: {
      evidenceUrl: getEvidenceUrl(platform, keyword, item),
      capturedAt: new Date().toISOString(),
      capturedBy: 'justoneapi',
      note: '来自 JustOneAPI 商品搜索接口，已进入统一 marketplace 价格快照。',
    },
    raw: {
      shopName: item.shopName,
      justOnePlatform: platform,
      item,
    },
  }
}

async function callJustOneApi(platform: JustOnePlatform, keyword: string) {
  const pathName = platformSearchPath[platform]
  if (!pathName) return []
  if (!config.justOneApi.token) throw new Error('缺少 JUSTONEAPI_TOKEN，请写入 apps/inventory-sync/.env。')

  const url = new URL(`${config.justOneApi.baseUrl}${pathName}`)
  url.searchParams.set('keyword', keyword)
  url.searchParams.set('token', config.justOneApi.token)
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`JustOneAPI ${platform} 请求失败：${response.status} ${body.slice(0, 300)}`)
  }
  const payload = await response.json()
  if (payload && typeof payload === 'object' && 'code' in payload && Number((payload as { code?: unknown }).code) !== 0) {
    const message = String((payload as { message?: unknown }).message ?? 'unknown_error')
    throw new Error(`JustOneAPI ${platform} 业务错误：${message}`)
  }
  return collectCandidates(payload).slice(0, 1)
}

function buildSourceSummaries(records: MarketplacePriceRecord[]): MarketplacePriceSnapshot['sources'] {
  return (['jd', 'lenovo_official', 'taobao_subsidy'] as MarketplaceSource[]).map((source) => {
    const sourceRecords = records.filter((record) => record.source === source)
    return {
      source,
      label: getSourceLabel(source),
      sourceType: source === 'lenovo_official' ? 'sales_reference_price' : 'subsidy_reference_price',
      captureMethod: sourceRecords.some((record) => record.evidence.capturedBy === 'justoneapi') ? 'justoneapi' : 'configured_url_placeholder',
      recordCount: sourceRecords.length,
      capturedCount: sourceRecords.filter((record) => record.collectionStatus === 'captured' || record.price !== undefined).length,
    }
  })
}

export async function collectJustOneApiMarketplacePrices() {
  const inventoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf-8')) as StandardInventorySnapshot
  const platforms = config.justOneApi.platforms.filter((platform): platform is JustOnePlatform => (
    platform === 'jd' || platform === 'taobao'
  ))
  const skus = inventory.skus.filter((sku) => sku.currentStock > 0).slice(0, config.justOneApi.maxSkus)
  const records: MarketplacePriceRecord[] = []
  const errors: Array<{ skuKey: string; platform: string; message: string }> = []

  for (const sku of skus) {
    const keyword = buildSearchKeyword(sku)
    for (const platform of platforms) {
      try {
        const candidates = await callJustOneApi(platform, keyword)
        records.push(...candidates.map((item) => toMarketplaceRecord(platform, sku, keyword, item)))
      } catch (error) {
        errors.push({
          skuKey: sku.skuKey,
          platform,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const manualSnapshot: MarketplacePriceSnapshot & { errors: typeof errors } = {
    generatedAt: new Date().toISOString(),
    collector: {
      name: 'marketplace-price-collector',
      mode: 'manual_or_sample_placeholder',
      version: 1,
      limitation: 'JustOneAPI 接入阶段只写入商品搜索首个候选价格；国补前/后、店铺类型和服务口径仍需二次校验。',
      nextStep: '根据 JustOneAPI 实际返回字段继续加强 SKU 匹配、店铺筛选、自营判断和价格字段映射。',
    },
    sources: buildSourceSummaries(records),
    itemCount: records.length,
    records,
    errors,
  }

  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })
  const manualInputPath = path.resolve(config.lenovoRetail.artifactDir, 'justoneapi-marketplace-records.json')
  await fs.writeFile(manualInputPath, JSON.stringify(manualSnapshot, null, 2), 'utf-8')
  const result = await saveMarketplacePriceSnapshot(manualInputPath)

  return { ...result, manualInputPath, errors, apiRecords: records }
}
