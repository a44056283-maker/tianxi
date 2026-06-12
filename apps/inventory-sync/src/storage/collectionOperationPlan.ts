import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot, StandardInventorySku } from '../types.js'
import type { ProductUrlLockSnapshot } from './productUrlLockStore.js'
import {
  buildStandardPriceMasterSnapshot,
  saveStandardPriceMasterSnapshot,
  type StandardPriceFrontendSnapshot,
  type StandardPriceMasterRow,
} from './standardPriceMaster.js'

type RetailSourceKey = 'jd_self' | 'lenovo_official' | 'taobao_100b'

type CollectionOperationPlanItem = {
  skuKey: string
  productName: string
  pnMtm?: string
  category?: string
  currentStock: number
  sellableStock: number
  costTrust: {
    stockCostStatus: 'available' | 'missing'
    stockCost?: number
    distributorQuoteStatus: 'available' | 'pending_lock'
    grayWholesaleStatus: 'available' | 'pending_lock'
  }
  retailUrlLocks: Record<RetailSourceKey, {
    status: 'locked' | 'candidate' | 'pending_lock' | 'unavailable'
    url?: string
    price?: number
    matchTitle?: string
    evidenceNote?: string
  }>
  aftersales: {
    warrantyQueueStatus: 'queued_or_collected' | 'pending_queue'
  }
  priceMaster: {
    comparisonStatus: StandardPriceMasterRow['comparison']['status']
    syncStatus: StandardPriceMasterRow['syncDecision']['status']
    jdComparablePrice?: number
    lenovoOfficialComparablePrice?: number
    suggestedUnifiedPrice?: number
    evidenceSummary: string
  }
}

type CollectionOperationPlan = {
  generatedAt: string
  source: 'collection_operation_plan'
  policy: {
    lockFirst: string
    noThirdPartyApi: string
    retailCaptureRule: string
    costCaptureRule: string
    aftersalesRule: string
  }
  commands: Record<string, {
    purpose: string
    command: string
    writePolicy: string
  }>
  totals: {
    inventorySkuCount: number
    inStockSkuCount: number
    jdLockedCount: number
    lenovoOfficialLockedCount: number
    taobaoLockedCount: number
    missingRetailLockCount: number
  }
  items: CollectionOperationPlanItem[]
}

type MarketplaceSnapshot = {
  generatedAt?: string
  records?: Array<{
    productId?: string
    source?: string
    collectionStatus?: string
    confidence?: string
    configuredUrl?: string
    price?: number
    preSubsidyPrice?: number
    couponAdjustedPrice?: number
    postSubsidyPrice?: number
    matchTitle?: string
    evidence?: {
      evidenceUrl?: string
      capturedAt?: string
      note?: string
    }
  }>
}

type PriceMasterIndexValue = Pick<CollectionOperationPlanItem['priceMaster'], 'comparisonStatus' | 'syncStatus' | 'jdComparablePrice' | 'lenovoOfficialComparablePrice' | 'suggestedUnifiedPrice' | 'evidenceSummary'>
const marketplaceFreshnessHours = 36

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

async function readJson<T>(filePath: string) {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined)
}

function isFreshTimestamp(value?: string) {
  if (!value) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  return (Date.now() - parsed) / 36e5 <= marketplaceFreshnessHours
}

function lockKey(source: RetailSourceKey) {
  if (source === 'jd_self') return 'jd_self'
  if (source === 'lenovo_official') return 'lenovo_official'
  return 'taobao_100b'
}

function buildLockIndex(snapshot?: ProductUrlLockSnapshot) {
  const index = new Map<string, CollectionOperationPlanItem['retailUrlLocks'][RetailSourceKey]>()
  for (const lock of snapshot?.locks ?? []) {
    const source = (
      lock.source === 'jd_self'
      || lock.source === 'jd_authorized'
      || lock.source === 'jd_supermarket'
    )
      ? 'jd_self'
      : lock.source === 'lenovo_official' ? 'lenovo_official' : undefined
    if (!source) continue
    const key = `${lock.skuKey}:${lockKey(source)}`
    const previous = index.get(key)
    const value: CollectionOperationPlanItem['retailUrlLocks'][RetailSourceKey] = {
      status: lock.matchStatus === 'unavailable'
        ? 'unavailable'
        : lock.matchStatus === 'locked'
          ? 'locked'
          : lock.matchStatus === 'candidate'
            ? 'candidate'
            : 'pending_lock',
      url: lock.url,
      price: lock.price,
      matchTitle: lock.matchTitle,
      evidenceNote: lock.evidenceNote,
    }
    if (
      !previous
      || (previous.status !== 'locked' && value.status === 'locked')
      || (previous.status === 'pending_lock' && value.status !== 'pending_lock')
    ) {
      index.set(key, value)
    }
  }
  return index
}

function buildMarketplaceFallbackIndex(snapshot?: MarketplaceSnapshot) {
  const index = new Map<string, CollectionOperationPlanItem['retailUrlLocks'][RetailSourceKey]>()
  for (const record of snapshot?.records ?? []) {
    const skuKey = String(record.productId ?? '')
    if (!skuKey) continue
    const source = record.source === 'jd'
      ? 'jd_self'
      : record.source === 'lenovo_official'
        ? 'lenovo_official'
        : record.source === 'taobao_subsidy'
          ? 'taobao_100b'
          : undefined
    if (!source) continue
    const url = record.evidence?.evidenceUrl ?? record.configuredUrl
    const price = record.price ?? record.preSubsidyPrice ?? record.couponAdjustedPrice ?? record.postSubsidyPrice
    if (!url && price === undefined) continue
    const isFresh = isFreshTimestamp(record.evidence?.capturedAt ?? snapshot?.generatedAt)
    const value: CollectionOperationPlanItem['retailUrlLocks'][RetailSourceKey] = {
      status: record.collectionStatus === 'captured' && record.confidence === 'confirmed' && isFresh
        ? 'locked'
        : (url || price !== undefined) ? 'candidate' : 'pending_lock',
      url,
      price,
      matchTitle: record.matchTitle,
      evidenceNote: record.evidence?.note,
    }
    const key = `${skuKey}:${lockKey(source)}`
    const previous = index.get(key)
    if (
      !previous
      || (previous.status === 'pending_lock' && value.status !== 'pending_lock')
      || (previous.status === 'candidate' && value.status === 'locked')
      || (previous.price === undefined && value.price !== undefined)
    ) {
      index.set(key, value)
    }
  }
  return index
}

function isRetailDetailUrl(url?: string) {
  const value = String(url ?? '')
  return /^https?:\/\/item\.jd\.com\/\d+\.html/i.test(value)
    || /^https?:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(value)
    || /^https?:\/\/detail\.tmall\.com\/item\.htm/i.test(value)
    || /^https?:\/\/item\.taobao\.com\/item\.htm/i.test(value)
}

function hasUsableRetailEvidence(lock?: CollectionOperationPlanItem['retailUrlLocks'][RetailSourceKey]) {
  return Boolean(lock
    && (lock.status === 'locked' || lock.status === 'candidate')
    && isRetailDetailUrl(lock.url)
    && (lock.status === 'locked' || typeof lock.price === 'number'))
}

function getRetailLock(
  index: Map<string, CollectionOperationPlanItem['retailUrlLocks'][RetailSourceKey]>,
  sku: StandardInventorySku,
  source: RetailSourceKey,
) {
  return index.get(`${sku.skuKey}:${lockKey(source)}`) ?? { status: 'pending_lock' as const }
}

function buildPriceMasterIndex(snapshot?: StandardPriceFrontendSnapshot) {
  const index = new Map<string, PriceMasterIndexValue>()
  for (const row of snapshot?.rows ?? []) {
    index.set(row.skuKey, {
      comparisonStatus: row.comparisonStatus,
      syncStatus: row.syncStatus,
      jdComparablePrice: row.jdPrice,
      lenovoOfficialComparablePrice: row.lenovoOfficialPrice,
      suggestedUnifiedPrice: row.suggestedUnifiedPrice,
      evidenceSummary: row.evidenceSummary,
    })
  }
  return index
}

export async function buildCollectionOperationPlan(): Promise<CollectionOperationPlan> {
  const [inventory, locks, warrantyQueue, marketplace, priceMaster] = await Promise.all([
    readJson<StandardInventorySnapshot>(artifactPath('latest-standard-inventory-snapshot.json')),
    readJson<ProductUrlLockSnapshot>(artifactPath('latest-product-url-locks.json')),
    readJson<{ items?: Array<{ skuKey?: string }> }>(artifactPath('latest-warranty-check-queue.json')),
    readJson<MarketplaceSnapshot>(artifactPath('latest-marketplace-price-snapshot.json')),
    buildStandardPriceMasterSnapshot().then((result) => result.frontend).catch(() => undefined),
  ])
  if (!inventory) throw new Error('缺少 latest-standard-inventory-snapshot.json，请先生成库存快照。')

  const lockIndex = buildLockIndex(locks)
  const fallbackIndex = buildMarketplaceFallbackIndex(marketplace)
  const priceMasterIndex = buildPriceMasterIndex(priceMaster)
  const warrantySkuKeys = new Set((warrantyQueue?.items ?? []).map((item) => item.skuKey).filter(Boolean))
  const inStockSkus = inventory.skus.filter((sku) => sku.currentStock > 0)

  const items = inStockSkus.map((sku): CollectionOperationPlanItem => {
    const jd = getRetailLock(lockIndex, sku, 'jd_self').status === 'pending_lock'
      ? getRetailLock(fallbackIndex, sku, 'jd_self')
      : getRetailLock(lockIndex, sku, 'jd_self')
    const lenovo = getRetailLock(lockIndex, sku, 'lenovo_official').status === 'pending_lock'
      ? getRetailLock(fallbackIndex, sku, 'lenovo_official')
      : getRetailLock(lockIndex, sku, 'lenovo_official')
    const taobao = getRetailLock(lockIndex, sku, 'taobao_100b').status === 'pending_lock'
      ? getRetailLock(fallbackIndex, sku, 'taobao_100b')
      : getRetailLock(lockIndex, sku, 'taobao_100b')
    return {
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      category: sku.category,
      currentStock: sku.currentStock,
      sellableStock: sku.sellableStock,
      costTrust: {
        stockCostStatus: typeof sku.salesCostPrice === 'number' || typeof sku.agentPrice === 'number' ? 'available' : 'missing',
        stockCost: sku.salesCostPrice ?? sku.agentPrice,
        distributorQuoteStatus: 'pending_lock',
        grayWholesaleStatus: 'pending_lock',
      },
      retailUrlLocks: {
        jd_self: jd,
        lenovo_official: lenovo,
        taobao_100b: taobao,
      },
      aftersales: {
        warrantyQueueStatus: warrantySkuKeys.has(sku.skuKey) ? 'queued_or_collected' : 'pending_queue',
      },
      priceMaster: priceMasterIndex.get(sku.skuKey) ?? {
        comparisonStatus: 'missing_source',
        syncStatus: 'hold_missing_source',
        evidenceSummary: 'JD:missing_record | Lenovo:missing_record',
      },
    }
  })

  const missingRetailLockCount = items.reduce((count, item) => {
    const missingJd = !hasUsableRetailEvidence(item.retailUrlLocks.jd_self)
    const missingOfficialRoute = !hasUsableRetailEvidence(item.retailUrlLocks.lenovo_official)
      && !hasUsableRetailEvidence(item.retailUrlLocks.taobao_100b)
    return count + (missingJd ? 1 : 0) + (missingOfficialRoute ? 1 : 0)
  }, 0)

  return {
    generatedAt: new Date().toISOString(),
    source: 'collection_operation_plan',
    policy: {
      lockFirst: '所有销售端价格采集必须先锁定真实商品详情 URL；未锁定 URL 的平台只生成待匹配任务，不写入实时零售价。',
      noThirdPartyApi: '停用 JustOneAPI 等第三方收费接口；京东、联想官网、淘宝百亿补贴统一使用 Codex 原生电脑操控/Chrome 类人采集。',
      retailCaptureRule: '优先刷新已锁定 URL；京东指定链接失效时转京东全站补新详情页，联想官旗下架/失效时转天猫或淘宝在售页替换链接与价格；所有补链都必须落到新的详情页证据后再刷新价格。',
      costCaptureRule: '库存采信与实时进货成本来自智店通库存/成本导出；群采集和公众号批发价先形成来源锁定和截图/原文证据，再进入成本参考。',
      aftersalesRule: '售后与保修信息按库存 SN 队列采集；遇到验证码/登录验证时停止并等待人工处理。',
    },
    commands: {
      inventory: {
        purpose: '库存采信、库存成本、SN 基础数据',
        command: 'npm run parse:exports && npm run build:snapshot',
        writePolicy: '允许写入库存快照；这是其它采集任务的 SKU 基准。',
      },
      costQuotes: {
        purpose: '群采集/公众号批发价文本解析',
        command: 'npm run parse:distributor-quotes 或 npm run parse:gray-wholesale -- <原文>',
        writePolicy: '未锁定来源和证据前只作为成本参考，不覆盖库存成本。',
      },
      urlLockPlan: {
        purpose: '生成待锁定 URL 和采集任务清单',
        command: 'npm run build:collection-plan',
        writePolicy: '只写计划，不刷新价格。',
      },
      retailRefresh: {
        purpose: '刷新已锁定 URL 的实时零售价',
        command: '禁止脚本直接采集；先用当前已登录 Chrome 可见窗口低频手工核验并保存人工批次，再运行 npm run parse:competitor-monitor / npm run parse:gray-wholesale / npm run build:collection-plan 等解析重建命令。',
        writePolicy: '脚本只能解析人工可见证据和重建快照；不得打开京东、联想商城、天猫/淘宝详情页采价。',
      },
      priceMaster: {
        purpose: '把原始采集记录先归集为标准报价总表，再比对京东/联想官旗并生成统一同步候选价',
        command: 'npm run build:collection-plan',
        writePolicy: '当前由 build:collection-plan 内联触发 price master 聚合并刷新前端快照；总表未 ready_for_unified_sync 的 SKU 不进入统一同步。',
      },
      warranty: {
        purpose: '实时库存售后/保修信息',
        command: 'npm run build:warranty-queue；保修页查询只能在当前 Chrome 可见窗口低频手工查询后导入证据，禁止 npm 脚本批量打开保修页。',
        writePolicy: '已固化保修不重复采集；验证码、白屏、风控时立即 blocked_page_risk。',
      },
    },
    totals: {
      inventorySkuCount: inventory.skus.length,
      inStockSkuCount: inStockSkus.length,
      jdLockedCount: items.filter((item) => item.retailUrlLocks.jd_self.status === 'locked').length,
      lenovoOfficialLockedCount: items.filter((item) => item.retailUrlLocks.lenovo_official.status === 'locked').length,
      taobaoLockedCount: items.filter((item) => item.retailUrlLocks.taobao_100b.status === 'locked').length,
      missingRetailLockCount,
    },
    items,
  }
}

export async function saveCollectionOperationPlan() {
  await saveStandardPriceMasterSnapshot().catch(() => undefined)
  const snapshot = await buildCollectionOperationPlan()
  const artifact = artifactPath('latest-collection-operation-plan.json')
  const web = webDataPath('latest-collection-operation-plan.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifact), { recursive: true }),
    fs.mkdir(path.dirname(web), { recursive: true }),
  ])
  const content = `${JSON.stringify(snapshot, null, 2)}\n`
  await Promise.all([
    fs.writeFile(artifact, content, 'utf-8'),
    fs.writeFile(web, content, 'utf-8'),
  ])
  return { snapshot, artifactPath: artifact, webPath: web }
}
