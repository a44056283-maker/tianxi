import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

export type GaokaoKnowledgeItem = {
  id: string
  title: string
  category: 'seed' | 'inventory' | 'service' | 'activity'
  tags: string[]
  content: string
  sourceName: string
  sourceType: 'seed' | 'snapshot'
  updatedAt: string
}

export type GaokaoAiKnowledgeBaseSnapshot = {
  generatedAt: string
  summary: {
    seedItemCount: number
    inventoryItemCount: number
    adminItemCount: number
    totalItemCount: number
  }
  items: GaokaoKnowledgeItem[]
}

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

type GaokaoDailyLearningSnapshot = {
  tracks?: Array<{
    id?: string
    title?: string
    routeLabel?: string
    relatedMajors?: string[]
    keyHighlights?: string[]
    marketingActivities?: string[]
    recommendationScript?: string
    inventoryLearning?: string
    updatedAt?: string
  }>
  dailyLearnings?: Array<{
    id?: string
    title?: string
    tags?: string[]
    content?: string
    updatedAt?: string
  }>
}

type ProductSalesSignal = {
  orderCount: number
  quantity: number
  lastSoldAt: string
  channels: string[]
}

type ParsedProductSpecs = {
  memoryLabel: string
  storageLabel: string
  gpuLabel: string
  screenLabel: string
  refreshLabel: string
  cpuFamily: string
  isOled: boolean
  isAiPc: boolean
}

const webDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
const seedPath = path.resolve(config.appDir, '../../docs/marketing/gaokao-ai-knowledge-seed.json')
const gaokaoSupportedCategories = new Set(['轻薄笔记本', '游戏笔记本', '平板电脑'])

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

function toKnowledgeTags(...values: unknown[]) {
  return Array.from(new Set(values
    .flatMap((value) => String(value ?? '').split(/[\/,，|｜\s]+/))
    .map((item) => item.trim())
    .filter(Boolean)))
}

function parseProductSpecs(item: Record<string, unknown>): ParsedProductSpecs {
  const name = normalizeText(item.productName, 220)
  const tokens = name
    .replace(/[·()（）]/g, ' ')
    .split(/[\s/]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  const memoryLabel = tokens.find((token) => /^(8|12|16|24|32|48|64|96)G$/i.test(token)) || ''
  const storageLabel = tokens.find((token) => /^(256G|512G|1T|2T|4T)$/i.test(token)) || ''
  const gpuMatch = name.match(/(RTX\s?\d{4}|MX\d+|Arc|Radeon\s?\w*)/i)
  const screenMatch = name.match(/(2\.5K|2\.8K|3K|4K|FHD\+?|QHD\+?|OLED)/i)
  const refreshMatch = name.match(/(\d{2,3}Hz)/i)
  const cpuFamily = name.includes('锐龙')
    ? '锐龙'
    : (name.includes('酷睿') || name.includes('Ultra') ? '酷睿' : '')
  return {
    memoryLabel: normalizeText(memoryLabel, 20),
    storageLabel: normalizeText(storageLabel, 20),
    gpuLabel: normalizeText(gpuMatch?.[1] || '', 40),
    screenLabel: normalizeText(screenMatch?.[1] || '', 20),
    refreshLabel: normalizeText(refreshMatch?.[1] || '', 20),
    cpuFamily,
    isOled: /OLED/i.test(name),
    isAiPc: name.includes('AI'),
  }
}

function buildProductSpecHints(item: Record<string, unknown>) {
  const specs = parseProductSpecs(item)
  const hints: string[] = []
  if (['24G', '32G', '48G', '64G', '96G'].includes(specs.memoryLabel.toUpperCase())) {
    hints.push('大内存更适合多任务、代码环境、容器和更长使用周期')
  } else if (specs.memoryLabel.toUpperCase() === '16G') {
    hints.push('16G 内存更适合主流课程、多标签资料和日常并行使用')
  }
  if (['1T', '2T', '4T'].includes(specs.storageLabel.toUpperCase())) {
    hints.push('大硬盘更适合课程资料、素材、开发环境和长期文件管理')
  } else if (specs.storageLabel.toUpperCase() === '512G') {
    hints.push('512G 更适合日常学习起步，资料较多时建议尽早规划存储')
  }
  if (specs.gpuLabel && /RTX|MX|Arc|Radeon/i.test(specs.gpuLabel)) {
    hints.push('独显路线更适合建模、剪辑、渲染和更高负载场景')
  }
  if (specs.isOled || /2\.5K|2\.8K|3K|4K/i.test(specs.screenLabel)) {
    hints.push('高分辨率高素质屏幕更适合长时间看资料、写代码和内容创作')
  }
  if (specs.refreshLabel && /1[4-9]\dHz|2\d{2}Hz/i.test(specs.refreshLabel)) {
    hints.push('高刷新率屏幕更适合游戏和动态画面体验')
  }
  if (specs.isAiPc) {
    hints.push('更适合平时会接触 AI 工具、资料总结和创作辅助的同学')
  }
  if (specs.cpuFamily === '锐龙') {
    hints.push('锐龙路线更适合兼顾续航、日常多任务和均衡体验')
  }
  if (specs.cpuFamily === '酷睿') {
    hints.push('酷睿路线更适合课堂办公、主流软件兼容和均衡使用')
  }
  return Array.from(new Set(hints)).slice(0, 4)
}

function buildMarketingActivities(item: Record<string, unknown>) {
  const labels: string[] = []
  const appendOnce = (label: string) => {
    if (label && !labels.includes(label)) labels.push(label)
  }
  if (safeNumber(item.platformSubsidyPrice) > 0 || safeNumber(item.lenovoOfficialPostSubsidyPrice) > 0) {
    appendOnce('可到店核验国补活动')
  }
  if (safeNumber(item.fullServiceSubsidyPrice) > 0) {
    appendOnce('可核验延保服务升级')
  }
  if (safeNumber(item.regularChannelSubsidyPrice) > 0) {
    appendOnce('可参加正规渠道服务权益')
  }
  if (safeNumber(item.defensiveLowSubsidyPrice) > 0) {
    appendOnce('可到店核验专项活动方案')
  }
  const salesNote = normalizeText(item.salesNote, 160)
  if (salesNote.includes('教育补')) appendOnce('可到店核验教育补活动')
  if (salesNote.includes('三件套')) appendOnce('可叠加 AI 三件套活动')
  if (salesNote.includes('二件套')) appendOnce('可叠加二件套活动')
  return labels.slice(0, 5)
}

function buildProductSceneHints(item: Record<string, unknown>) {
  const name = normalizeText(item.productName, 160)
  const category = normalizeText(item.category, 60)
  const hints: string[] = []
  if (category === '轻薄笔记本') {
    hints.push('适合课堂通勤、图书馆、自习室和长期背着走')
  }
  if (category === '游戏笔记本') {
    hints.push('适合建模、剪辑、渲染、重度编程和性能型课程')
  }
  if (category === '平板电脑') {
    hints.push('适合笔记整理、课件批注和补充学习场景')
  }
  if (name.includes('YOGA')) {
    hints.push('更适合重视便携、质感和日常创作的同学')
  }
  if (name.includes('拯救者') || name.includes('Legion')) {
    hints.push('更适合重视显卡、散热和长期高负载使用的方向')
  }
  if (name.includes('小新') || name.includes('Pro16')) {
    hints.push('更适合学习、创作和课堂通勤一起兼顾')
  }
  if (name.includes('Air')) {
    hints.push('更适合高频课堂携带和长续航场景')
  }
  if (name.includes('AI')) {
    hints.push('更适合日常会接触 AI 工具、资料总结和本地辅助场景')
  }
  hints.push(...buildProductSpecHints(item))
  return Array.from(new Set(hints)).slice(0, 4)
}

function buildProductKnowledgeFocus(item: Record<string, unknown>) {
  const name = normalizeText(item.productName, 160)
  const category = normalizeText(item.category, 60)
  const focus: string[] = []
  if (category === '轻薄笔记本') {
    focus.push('优先看重量、续航、屏幕舒适度和长期随身携带体验')
  }
  if (category === '游戏笔记本') {
    focus.push('优先看散热、稳定性和多软件并行下的持续性能')
  }
  if (category === '平板电脑') {
    focus.push('优先看资料同步、批注效率和搭配笔记本后的补充场景')
  }
  if (name.includes('YOGA')) {
    focus.push('更偏质感、便携和轻创作体验')
  }
  if (name.includes('拯救者') || name.includes('Legion')) {
    focus.push('更偏显卡、散热和长期高负载路线')
  }
  if (name.includes('小新') || name.includes('Pro16')) {
    focus.push('更偏学习、创作和日常使用的均衡路线')
  }
  focus.push(...buildProductSpecHints(item))
  return Array.from(new Set(focus)).slice(0, 3)
}

function mergeSalesSignal(target: ProductSalesSignal, quantity: number, channel: string, soldAt: string) {
  target.orderCount += 1
  target.quantity += quantity
  if (soldAt && (!target.lastSoldAt || soldAt > target.lastSoldAt)) {
    target.lastSoldAt = soldAt
  }
  if (channel && !target.channels.includes(channel)) {
    target.channels.push(channel)
  }
}

function buildSalesSignalMap(snapshot: RetailCoreSalesOrdersSnapshot | null) {
  const signalMap = new Map<string, ProductSalesSignal>()
  const orders = Array.isArray(snapshot?.items) ? snapshot!.items! : []
  for (const order of orders) {
    const channel = normalizeText(order.channel_type_name, 40)
    const soldAt = normalizeText(order.business_date || order.created_time || order.created_at, 40)
    const lines = Array.isArray(order.lines) ? order.lines : []
    for (const line of lines) {
      const quantity = Math.max(1, safeNumber(line.quantity))
      const keys = [
        normalizeLookupKey(line.sku_key),
        normalizeLookupKey(line.mtm_code),
        normalizeLookupKey(line.product_name),
      ].filter(Boolean)
      for (const key of keys) {
        const current = signalMap.get(key) || { orderCount: 0, quantity: 0, lastSoldAt: '', channels: [] }
        mergeSalesSignal(current, quantity, channel, soldAt)
        signalMap.set(key, current)
      }
    }
  }
  return signalMap
}

function resolveSalesSignal(item: Record<string, unknown>, signalMap: Map<string, ProductSalesSignal>) {
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

function buildCustomerFacingKnowledgeText(item: Record<string, unknown>, salesSignal: ProductSalesSignal | null) {
  const category = normalizeText(item.category, 60) || '现货电脑'
  const sceneHints = buildProductSceneHints(item)
  const focusHints = buildProductKnowledgeFocus(item)
  const marketingActivities = buildMarketingActivities(item)
  const specs = parseProductSpecs(item)
  const specSummary = [specs.memoryLabel, specs.storageLabel, specs.gpuLabel, specs.screenLabel, specs.refreshLabel]
    .filter(Boolean)
    .join(' / ')
  return [
    `${category}方向，可作为高考购机候选机型。`,
    specSummary ? `公开配置关注点：${specSummary}。` : '',
    sceneHints.length ? `适合场景：${sceneHints.join('；')}。` : '',
    focusHints.length ? `选机重点：${focusHints.join('；')}。` : '',
    salesSignal && salesSignal.orderCount >= 2 ? '门店近期在同类需求里更常被咨询和选择，可优先到店对比。' : '',
    marketingActivities.length ? `当前可重点核验：${marketingActivities.join('、')}。` : '当前以到店核验配置、服务权益和活动口径为准。',
  ].filter(Boolean).join(' ')
}

function buildActivityKnowledgeItems(
  retailItems: Array<Record<string, unknown>>,
  salesSignalMap: Map<string, ProductSalesSignal>,
  generatedAt: string,
) {
  return retailItems
    .filter((item) => safeNumber(item.sellableStock) > 0)
    .filter((item) => gaokaoSupportedCategories.has(normalizeText(item.category, 40)))
    .map((item) => ({ item, salesSignal: resolveSalesSignal(item, salesSignalMap) }))
    .filter((entry) => Boolean(entry.salesSignal))
    .sort((left, right) => {
      const quantityDiff = safeNumber(right.salesSignal?.quantity) - safeNumber(left.salesSignal?.quantity)
      if (quantityDiff !== 0) return quantityDiff
      return safeNumber(right.item.sellableStock) - safeNumber(left.item.sellableStock)
    })
    .slice(0, 12)
    .map(({ item, salesSignal }, index) => {
      const productName = normalizeText(item.productName, 120)
      const category = normalizeText(item.category, 40) || '现货电脑'
      const pnMtm = normalizeText(item.pnMtm, 40)
      const marketingActivities = buildMarketingActivities(item)
      return {
        id: `activity-${pnMtm || normalizeText(item.skuKey, 60) || index + 1}`,
        title: `${productName} 选购提示`,
        category: 'activity' as const,
        tags: toKnowledgeTags(category, productName, pnMtm, item.skuKey, '热销', '选购', ...buildProductSpecHints(item)),
        content: [
          `${productName} 属于门店近期更常被选择的方向。`,
          buildCustomerFacingKnowledgeText(item, salesSignal),
          salesSignal?.channels?.length ? `常见成交渠道：${salesSignal.channels.slice(0, 3).join('、')}。` : '',
        ].filter(Boolean).join(' '),
        sourceName: 'latest-retail-core-sales-orders.json',
        sourceType: 'snapshot' as const,
        updatedAt: generatedAt,
      }
    })
}

export async function buildGaokaoAiKnowledgeBase() {
  const [seedPayload, retailZone, salesOrdersSnapshot, dailyLearningSnapshot] = await Promise.all([
    readJsonIfExists<{ items?: Array<Record<string, unknown>> }>(seedPath),
    readJsonIfExists<{ decisions?: { items?: Array<Record<string, unknown>> } }>(path.resolve(webDataDir, 'latest-retail-zone-snapshot.json')),
    readJsonIfExists<RetailCoreSalesOrdersSnapshot>(path.resolve(webDataDir, 'latest-retail-core-sales-orders.json')),
    readJsonIfExists<GaokaoDailyLearningSnapshot>(path.resolve(webDataDir, 'latest-gaokao-daily-learning.json')),
  ])

  const generatedAt = nowIso()
  const seedItems: GaokaoKnowledgeItem[] = Array.isArray(seedPayload?.items)
    ? seedPayload!.items.map((item, index) => ({
      id: normalizeText(item.id, 60) || `seed-${index + 1}`,
      title: normalizeText(item.title, 80) || `知识条目 ${index + 1}`,
      category: normalizeText(item.category, 20) === 'service' ? 'service' : 'seed',
      tags: toKnowledgeTags(item.tags, item.title, item.category),
      content: normalizeText(item.content, 800),
      sourceName: normalizeText(item.sourceName, 80) || '高考活动知识种子',
      sourceType: 'seed',
      updatedAt: normalizeText(item.updatedAt, 40) || generatedAt,
    }))
    : []

  const retailItems = Array.isArray(retailZone?.decisions?.items) ? retailZone!.decisions!.items! : []
  const salesSignalMap = buildSalesSignalMap(salesOrdersSnapshot)
  const inventoryItems: GaokaoKnowledgeItem[] = retailItems
    .filter((item) => safeNumber(item.sellableStock) > 0)
    .filter((item) => gaokaoSupportedCategories.has(normalizeText(item.category, 40)))
    .sort((left, right) => {
      const rightSales = resolveSalesSignal(right, salesSignalMap)
      const leftSales = resolveSalesSignal(left, salesSignalMap)
      const salesDiff = safeNumber(rightSales?.quantity) - safeNumber(leftSales?.quantity)
      if (salesDiff !== 0) return salesDiff
      const stockDiff = safeNumber(right.sellableStock) - safeNumber(left.sellableStock)
      if (stockDiff !== 0) return stockDiff
      return safeNumber(right.recommendedPreSubsidyPrice) - safeNumber(left.recommendedPreSubsidyPrice)
    })
    .slice(0, 40)
    .map((item, index) => {
      const productName = normalizeText(item.productName, 120)
      const category = normalizeText(item.category, 40) || '现货电脑'
      const pnMtm = normalizeText(item.pnMtm, 40)
      const salesSignal = resolveSalesSignal(item, salesSignalMap)
      return {
        id: pnMtm || normalizeText(item.skuKey, 60) || `inventory-${index + 1}`,
        title: productName,
        category: 'inventory',
        tags: toKnowledgeTags(category, productName, pnMtm, item.skuKey),
        content: buildCustomerFacingKnowledgeText(item, salesSignal),
        sourceName: 'latest-retail-zone-snapshot.json',
        sourceType: 'snapshot',
        updatedAt: generatedAt,
      }
    })

  const activityItems = buildActivityKnowledgeItems(retailItems, salesSignalMap, generatedAt)
  const learningItems: GaokaoKnowledgeItem[] = [
    ...((Array.isArray(dailyLearningSnapshot?.dailyLearnings) ? dailyLearningSnapshot!.dailyLearnings! : []).map((item, index) => ({
      id: normalizeText(item.id, 60) || `daily-learning-${index + 1}`,
      title: normalizeText(item.title, 80) || `每日学习建议 ${index + 1}`,
      category: 'activity' as const,
      tags: toKnowledgeTags(item.tags, item.title, '日更学习', '库存话术'),
      content: normalizeText(item.content, 800),
      sourceName: 'latest-gaokao-daily-learning.json',
      sourceType: 'snapshot' as const,
      updatedAt: normalizeText(item.updatedAt, 40) || generatedAt,
    }))),
    ...((Array.isArray(dailyLearningSnapshot?.tracks) ? dailyLearningSnapshot!.tracks! : []).map((item, index) => ({
      id: normalizeText(item.id, 60) || `daily-track-${index + 1}`,
      title: normalizeText(item.title, 80) || `库存推荐话术 ${index + 1}`,
      category: 'activity' as const,
      tags: toKnowledgeTags(item.routeLabel, item.relatedMajors, item.keyHighlights, '库存推荐', '话术'),
      content: [
        normalizeText(item.recommendationScript, 500),
        normalizeText(item.inventoryLearning, 300),
        Array.isArray(item.marketingActivities) && item.marketingActivities.length
          ? `公开活动可继续核验：${item.marketingActivities.map((entry) => normalizeText(entry, 30)).filter(Boolean).join('、')}。`
          : '',
      ].filter(Boolean).join(' '),
      sourceName: 'latest-gaokao-daily-learning.json',
      sourceType: 'snapshot' as const,
      updatedAt: normalizeText(item.updatedAt, 40) || generatedAt,
    }))),
  ]

  const adminItems: GaokaoKnowledgeItem[] = retailItems
    .filter((item) => safeNumber(item.sellableStock) > 0)
    .filter((item) => gaokaoSupportedCategories.has(normalizeText(item.category, 40)))
    .sort((left, right) => {
      const rightSales = resolveSalesSignal(right, salesSignalMap)
      const leftSales = resolveSalesSignal(left, salesSignalMap)
      const salesDiff = safeNumber(rightSales?.quantity) - safeNumber(leftSales?.quantity)
      if (salesDiff !== 0) return salesDiff
      const stockDiff = safeNumber(right.sellableStock) - safeNumber(left.sellableStock)
      if (stockDiff !== 0) return stockDiff
      return safeNumber(right.recommendedPreSubsidyPrice) - safeNumber(left.recommendedPreSubsidyPrice)
    })
    .slice(0, 40)
    .map((item, index) => {
      const productName = normalizeText(item.productName, 120)
      const category = normalizeText(item.category, 40) || '现货电脑'
      const stock = safeNumber(item.sellableStock)
      const preSubsidyPrice = safeNumber(item.recommendedPreSubsidyPrice)
      const officialPrice = safeNumber(item.lenovoOfficialPrice)
      const subsidyPrice = safeNumber(item.fullServiceSubsidyPrice || item.platformSubsidyPrice)
      const salesNote = normalizeText(item.salesNote, 200)
      const riskNote = normalizeText(item.riskNote, 160)
      const pnMtm = normalizeText(item.pnMtm, 40)
      const marketingActivities = buildMarketingActivities(item)
      const salesSignal = resolveSalesSignal(item, salesSignalMap)
      return {
        id: pnMtm || normalizeText(item.skuKey, 60) || `inventory-admin-${index + 1}`,
        title: productName,
        category: 'inventory',
        tags: toKnowledgeTags(category, productName, pnMtm, item.skuKey, marketingActivities.join(' ')),
        content: [
          `${category}，当前可售 ${stock} 台现货。`,
          preSubsidyPrice > 0 ? `建议价 ${preSubsidyPrice} 元。` : '',
          officialPrice > 0 ? `联想官旗价 ${officialPrice} 元。` : '',
          subsidyPrice > 0 ? `补贴参考价 ${subsidyPrice} 元。` : '',
          salesSignal ? `近期销售：${salesSignal.orderCount} 单 / ${salesSignal.quantity} 台。` : '',
          salesSignal?.channels?.length ? `常见成交渠道：${salesSignal.channels.slice(0, 3).join('、')}。` : '',
          marketingActivities.length ? `当前活动：${marketingActivities.join('、')}。` : '',
          buildCustomerFacingKnowledgeText(item, salesSignal),
          salesNote ? `销售建议：${salesNote}` : '',
          riskNote ? `注意：${riskNote}` : '',
        ].filter(Boolean).join(' '),
        sourceName: 'latest-retail-zone-snapshot.json',
        sourceType: 'snapshot',
        updatedAt: generatedAt,
      }
    })

  const items = [...seedItems, ...inventoryItems, ...activityItems, ...learningItems]
  const snapshot: GaokaoAiKnowledgeBaseSnapshot = {
    generatedAt,
    summary: {
      seedItemCount: seedItems.length,
      inventoryItemCount: inventoryItems.length + activityItems.length + learningItems.length,
      adminItemCount: seedItems.length + adminItems.length + activityItems.length + learningItems.length,
      totalItemCount: items.length,
    },
    items,
  }

  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-gaokao-ai-knowledge-base.json')
  const adminArtifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-gaokao-ai-knowledge-admin-base.json')
  const webPath = path.resolve(webDataDir, 'latest-gaokao-ai-knowledge-base.json')
  const content = `${JSON.stringify(snapshot, null, 2)}\n`
  const adminContent = `${JSON.stringify({
    ...snapshot,
    summary: {
      ...snapshot.summary,
      totalItemCount: seedItems.length + adminItems.length + activityItems.length + learningItems.length,
    },
    items: [...seedItems, ...adminItems, ...activityItems, ...learningItems],
  }, null, 2)}\n`
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(adminArtifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, content, 'utf-8'),
    fs.writeFile(adminArtifactPath, adminContent, 'utf-8'),
    fs.writeFile(webPath, content, 'utf-8'),
  ])
  return { snapshot, artifactPath, adminArtifactPath, webPath }
}
