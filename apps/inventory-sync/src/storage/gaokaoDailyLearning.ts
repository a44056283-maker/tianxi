import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

type RetailZoneItem = Record<string, unknown>

type RetailCoreSalesLine = {
  sku_key?: string
  mtm_code?: string
  product_name?: string
  quantity?: number
}

type RetailCoreSalesOrder = {
  business_date?: string
  created_at?: string
  created_time?: string
  channel_type_name?: string
  lines?: RetailCoreSalesLine[]
}

type RetailCoreSalesOrdersSnapshot = {
  items?: RetailCoreSalesOrder[]
}

type ProductSalesSignal = {
  orderCount: number
  quantity: number
  lastSoldAt: string
  channels: string[]
}

export type GaokaoDailyLearningTrack = {
  id: string
  title: string
  learningTitle: string
  routeLabel: string
  routeType: 'flagship' | 'balanced' | 'performance' | 'tablet' | 'ai_pc'
  relatedMajors: string[]
  category: string
  representativeProducts: string[]
  keyHighlights: string[]
  marketingActivities: string[]
  recommendationScript: string
  inventoryLearning: string
  updatedAt: string
}

export type GaokaoDailyLearningNote = {
  id: string
  title: string
  tags: string[]
  content: string
  updatedAt: string
}

export type GaokaoDailyLearningSnapshot = {
  generatedAt: string
  summary: {
    trackCount: number
    learningNoteCount: number
    featuredRouteCount: number
  }
  tracks: GaokaoDailyLearningTrack[]
  dailyLearnings: GaokaoDailyLearningNote[]
}

const webDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeText(value: unknown, limit = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function normalizeLookupKey(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildSalesSignalMap(snapshot: RetailCoreSalesOrdersSnapshot | null) {
  const signalMap = new Map<string, ProductSalesSignal>()
  const orders = Array.isArray(snapshot?.items) ? snapshot!.items! : []
  for (const order of orders) {
    const soldAt = normalizeText(order.business_date || order.created_time || order.created_at, 40)
    const channel = normalizeText(order.channel_type_name, 40)
    const lines = Array.isArray(order.lines) ? order.lines : []
    for (const line of lines) {
      const quantity = Math.max(1, safeNumber(line.quantity))
      const keys = [
        normalizeLookupKey(line.sku_key),
        normalizeLookupKey(line.mtm_code),
        normalizeLookupKey(line.product_name),
      ].filter(Boolean)
      for (const key of keys) {
        const current = signalMap.get(key) || {
          orderCount: 0,
          quantity: 0,
          lastSoldAt: '',
          channels: [],
        }
        current.orderCount += 1
        current.quantity += quantity
        if (soldAt && (!current.lastSoldAt || soldAt > current.lastSoldAt)) {
          current.lastSoldAt = soldAt
        }
        if (channel && !current.channels.includes(channel)) {
          current.channels.push(channel)
        }
        signalMap.set(key, current)
      }
    }
  }
  return signalMap
}

function resolveSalesSignal(item: RetailZoneItem, signalMap: Map<string, ProductSalesSignal>) {
  const keys = [
    normalizeLookupKey(item.skuKey),
    normalizeLookupKey(item.pnMtm),
    normalizeLookupKey(item.productName),
  ].filter(Boolean)
  let best: ProductSalesSignal | null = null
  for (const key of keys) {
    const signal = signalMap.get(key)
    if (!signal) continue
    if (!best || signal.quantity > best.quantity || (signal.quantity === best.quantity && signal.orderCount > best.orderCount)) {
      best = signal
    }
  }
  return best
}

function buildMarketingActivities(item: RetailZoneItem) {
  const labels: string[] = []
  const appendOnce = (label: string) => {
    if (label && !labels.includes(label)) labels.push(label)
  }
  if (safeNumber(item.platformSubsidyPrice) > 0 || safeNumber(item.lenovoOfficialPostSubsidyPrice) > 0) {
    appendOnce('可参加国补活动')
  }
  if (safeNumber(item.fullServiceSubsidyPrice) > 0) {
    appendOnce('可核验更长服务权益')
  }
  if (safeNumber(item.regularChannelSubsidyPrice) > 0) {
    appendOnce('可核验正规渠道服务权益')
  }
  const salesNote = normalizeText(item.salesNote, 180)
  if (salesNote.includes('教育补')) appendOnce('可核验教育补活动')
  if (salesNote.includes('三件套')) appendOnce('可叠加 AI 三件套活动')
  if (salesNote.includes('二件套')) appendOnce('可叠加二件套活动')
  return labels.slice(0, 4)
}

function buildRouteConfig() {
  return [
    {
      id: 'yoga-route',
      title: 'YOGA 高预算文科重点推荐话术',
      routeLabel: 'YOGA 轻薄旗舰路线',
      routeType: 'flagship' as const,
      relatedMajors: ['文科', '经管', '师范', '法学'],
      match: (item: RetailZoneItem) => normalizeText(item.productName, 180).includes('YOGA'),
      categoryHint: '轻薄笔记本',
      keyHighlights: ['厂家重点轻薄路线', '更适合课堂通勤和图书馆', '可公开提及张凌赫同款路线', '到店核验更长意外保和服务权益'],
      learningTitle: '高预算文科路线日更建议',
    },
    {
      id: 'xiaoxin-route',
      title: '小新均衡学习路线推荐话术',
      routeLabel: '小新学习创作均衡路线',
      routeType: 'balanced' as const,
      relatedMajors: ['文科', '经管', '计算机', '日常学习'],
      match: (item: RetailZoneItem) => {
        const name = normalizeText(item.productName, 180)
        return name.includes('小新') || name.includes('Pro16')
      },
      categoryHint: '轻薄笔记本',
      keyHighlights: ['更适合学习、创作和日常通勤兼顾', '适合课堂、宿舍和资料整理混合场景', '优先讲公开活动和长期使用体验'],
      learningTitle: '均衡学习路线日更建议',
    },
    {
      id: 'legion-route',
      title: '拯救者性能路线推荐话术',
      routeLabel: '拯救者性能路线',
      routeType: 'performance' as const,
      relatedMajors: ['设计', '传媒', '建筑', '工程', '游戏', '建模'],
      match: (item: RetailZoneItem) => {
        const name = normalizeText(item.productName, 180)
        return name.includes('拯救者') || name.includes('Legion')
      },
      categoryHint: '游戏笔记本',
      keyHighlights: ['更适合显卡、散热和长期高负载课程', '适合建模、渲染、剪辑和游戏兼顾', '库存推荐话术重点讲场景，不讲内部价格'],
      learningTitle: '性能创作路线日更建议',
    },
    {
      id: 'ai-pc-route',
      title: 'AI PC 大内存路线推荐话术',
      routeLabel: 'AI PC 资料整理路线',
      routeType: 'ai_pc' as const,
      relatedMajors: ['计算机', '人工智能', '创作', '日常学习'],
      match: (item: RetailZoneItem) => {
        const name = normalizeText(item.productName, 180)
        return name.includes('AI') || name.includes('32G')
      },
      categoryHint: '轻薄笔记本',
      keyHighlights: ['更适合资料总结、创作辅助和 AI 工具体验', '大内存更适合长期学习周期', '适合搭配 Win11 新机上手知识一起讲解'],
      learningTitle: 'AI 学习装备路线日更建议',
    },
  ]
}

function buildRecommendationScript(
  routeLabel: string,
  representativeProducts: string[],
  relatedMajors: string[],
  keyHighlights: string[],
  marketingActivities: string[],
) {
  const productText = representativeProducts.slice(0, 2).join('、')
  const majorText = relatedMajors.slice(0, 3).join(' / ') || '当前客户方向'
  const highlightText = keyHighlights.slice(0, 3).join('；')
  const activityText = marketingActivities.length ? ` 当前可继续核验：${marketingActivities.slice(0, 3).join('、')}。` : ''
  return `面对 ${majorText} 客户时，优先把 ${routeLabel} 作为到店对比方向。可先从 ${productText || '当前现货机型'} 开始讲，重点围绕 ${highlightText}，最后把客户引导到公开活动、服务权益和现场试机体验。${activityText}`
}

function buildInventoryLearning(
  routeLabel: string,
  itemCount: number,
  salesSignalTotal: number,
  featuredStock: number,
) {
  return `${routeLabel} 当前纳入 ${itemCount} 台候选现货；近期关联销量 ${salesSignalTotal} 台；代表机型可售 ${featuredStock} 台。后续推荐时先讲适合场景、再讲服务权益，不讲库存敏感口径。`
}

export async function buildGaokaoDailyLearningSnapshot() {
  const [retailZone, salesOrdersSnapshot] = await Promise.all([
    readJsonIfExists<{ decisions?: { items?: RetailZoneItem[] } }>(path.resolve(webDataDir, 'latest-retail-zone-snapshot.json')),
    readJsonIfExists<RetailCoreSalesOrdersSnapshot>(path.resolve(webDataDir, 'latest-retail-core-sales-orders.json')),
  ])

  const retailItems = Array.isArray(retailZone?.decisions?.items) ? retailZone!.decisions!.items! : []
  const inStockItems = retailItems.filter((item) => safeNumber(item.sellableStock) > 0)
  const salesSignalMap = buildSalesSignalMap(salesOrdersSnapshot)
  const generatedAt = nowIso()

  const tracks: GaokaoDailyLearningTrack[] = buildRouteConfig().map((route) => {
    const matched = inStockItems
      .filter((item) => route.match(item) || normalizeText(item.category, 40) === route.categoryHint)
      .sort((left, right) => {
        const rightSales = resolveSalesSignal(right, salesSignalMap)
        const leftSales = resolveSalesSignal(left, salesSignalMap)
        const salesDiff = safeNumber(rightSales?.quantity) - safeNumber(leftSales?.quantity)
        if (salesDiff !== 0) return salesDiff
        return safeNumber(right.sellableStock) - safeNumber(left.sellableStock)
      })
      .slice(0, 4)

    const representativeProducts = matched.map((item) => normalizeText(item.productName, 140)).filter(Boolean)
    const marketingActivities = Array.from(new Set(matched.flatMap((item) => buildMarketingActivities(item)))).slice(0, 4)
    const salesSignalTotal = matched.reduce((sum, item) => sum + safeNumber(resolveSalesSignal(item, salesSignalMap)?.quantity), 0)
    const featuredStock = matched.reduce((sum, item) => sum + safeNumber(item.sellableStock), 0)

    return {
      id: route.id,
      title: route.title,
      learningTitle: route.learningTitle,
      routeLabel: route.routeLabel,
      routeType: route.routeType,
      relatedMajors: route.relatedMajors,
      category: route.categoryHint,
      representativeProducts,
      keyHighlights: route.keyHighlights,
      marketingActivities,
      recommendationScript: buildRecommendationScript(
        route.routeLabel,
        representativeProducts,
        route.relatedMajors,
        route.keyHighlights,
        marketingActivities,
      ),
      inventoryLearning: buildInventoryLearning(route.routeLabel, matched.length, salesSignalTotal, featuredStock),
      updatedAt: generatedAt,
    }
  }).filter((track) => track.representativeProducts.length > 0)

  const dailyLearnings: GaokaoDailyLearningNote[] = tracks.map((track) => ({
    id: `learning-${track.id}`,
    title: track.learningTitle || `${track.routeLabel} 日更建议`,
    tags: [track.routeLabel, ...track.relatedMajors, track.category].filter(Boolean),
    content: `${track.recommendationScript} ${track.inventoryLearning}`,
    updatedAt: generatedAt,
  }))

  const snapshot: GaokaoDailyLearningSnapshot = {
    generatedAt,
    summary: {
      trackCount: tracks.length,
      learningNoteCount: dailyLearnings.length,
      featuredRouteCount: tracks.filter((track) => track.representativeProducts.length > 0).length,
    },
    tracks,
    dailyLearnings,
  }

  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-gaokao-daily-learning.json')
  const webPath = path.resolve(webDataDir, 'latest-gaokao-daily-learning.json')
  const content = `${JSON.stringify(snapshot, null, 2)}\n`
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, content, 'utf-8'),
    fs.writeFile(webPath, content, 'utf-8'),
  ])
  return { snapshot, artifactPath, webPath }
}
