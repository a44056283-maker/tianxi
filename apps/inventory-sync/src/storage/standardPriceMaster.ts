import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot, StandardInventorySku } from '../types.js'
import type { MarketplacePriceRecord, MarketplaceSource } from './marketplacePriceCollector.js'
import type { ProductUrlLockSnapshot } from './productUrlLockStore.js'

export type StandardPriceMasterSource = Extract<MarketplaceSource, 'jd' | 'lenovo_official'>

export type StandardPriceMasterEvidenceField =
  | 'evidenceUrl'
  | 'screenshotPath'
  | 'capturedAt'
  | 'capturedBy'
  | 'note'

export type StandardPriceMasterEvidenceStatus =
  | 'complete_for_sync'
  | 'missing_required_fields'
  | 'stale_capture'
  | 'non_detail_url'
  | 'placeholder_only'
  | 'unavailable'
  | 'missing_record'

export type StandardPriceMasterSourceSelection = {
  source: StandardPriceMasterSource
  sourceLabel: string
  recordCount: number
  lockStatus: 'locked' | 'candidate' | 'pending_lock' | 'unavailable'
  lockedUrl?: string
  selectedRecord?: {
    recordKey: string
    comparablePrice?: number
    comparablePriceField?: 'price' | 'preSubsidyPrice'
    price?: number
    preSubsidyPrice?: number
    couponAdjustedPrice?: number
    postSubsidyPrice?: number
    priceType: MarketplacePriceRecord['priceType']
    priceBasis: string
    confidence: MarketplacePriceRecord['confidence']
    collectionStatus: MarketplacePriceRecord['collectionStatus']
    configuredUrl?: string
    matchTitle?: string
    evidence: MarketplacePriceRecord['evidence']
  }
  evidenceAudit: {
    status: StandardPriceMasterEvidenceStatus
    requiredFields: StandardPriceMasterEvidenceField[]
    missingFields: StandardPriceMasterEvidenceField[]
    isDirectDetailUrl: boolean
    hasComparablePrice: boolean
    syncEligible: boolean
    reasons: string[]
  }
}

export type StandardPriceMasterComparisonStatus =
  | 'ready_for_compare'
  | 'missing_source'
  | 'manual_review_required'
  | 'evidence_incomplete'
  | 'unavailable'

export type StandardPriceMasterSyncStatus =
  | 'ready_for_unified_sync'
  | 'hold_missing_source'
  | 'hold_manual_review'
  | 'hold_evidence_incomplete'
  | 'hold_large_gap_review'

export type StandardPriceMasterRow = {
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  currentStock: number
  sellableStock: number
  sources: Record<StandardPriceMasterSource, StandardPriceMasterSourceSelection>
  comparison: {
    status: StandardPriceMasterComparisonStatus
    jdComparablePrice?: number
    lenovoOfficialComparablePrice?: number
    absoluteGap?: number
    cheaperSource?: StandardPriceMasterSource | 'same_price'
    comparedAt?: string
    notes: string[]
  }
  syncDecision: {
    status: StandardPriceMasterSyncStatus
    suggestedUnifiedPrice?: number
    basis: 'min_source_price' | 'same_price' | 'not_ready'
    reasons: string[]
  }
}

export type StandardPriceMasterSnapshot = {
  generatedAt: string
  source: 'standard_price_master'
  scope: 'in_stock_inventory_skus'
  policy: {
    aggregateFirst: string
    compareThenSync: string
    manualEvidenceBoundary: string
  }
  totals: {
    inventorySkuCount: number
    inStockSkuCount: number
    skuWithAnyCollectedSourceCount: number
    readyForCompareCount: number
    readyForUnifiedSyncCount: number
    manualReviewRequiredCount: number
    evidenceIncompleteCount: number
    missingSourceCount: number
  }
  rows: StandardPriceMasterRow[]
}

export type StandardPriceFrontendSnapshot = {
  generatedAt: string
  source: 'standard_price_master_frontend_snapshot'
  totals: StandardPriceMasterSnapshot['totals']
  rows: Array<{
    skuKey: string
    productName: string
    category?: string
    currentStock: number
    jdPrice?: number
    lenovoOfficialPrice?: number
    priceGap?: number
    cheaperSource?: StandardPriceMasterRow['comparison']['cheaperSource']
    comparisonStatus: StandardPriceMasterComparisonStatus
    syncStatus: StandardPriceMasterSyncStatus
    suggestedUnifiedPrice?: number
    lastCapturedAt?: string
    evidenceSummary: string
  }>
}

type SourceLockStatus = StandardPriceMasterSourceSelection['lockStatus']

const standardPriceMasterFileName = 'latest-standard-price-master.json'
const standardPriceFrontendFileName = 'latest-standard-price-master-frontend-snapshot.json'
const marketplaceFreshnessHours = 36

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

function isDirectDetailUrl(source: StandardPriceMasterSource, url?: string) {
  if (!url) return false
  if (source === 'jd') return /^https:\/\/item\.jd\.com\/\d+\.html(?:[?#].*)?$/i.test(url)
  return /^https:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(url)
}

function getSourceLabel(source: StandardPriceMasterSource) {
  return source === 'jd' ? '京东' : '联想官旗'
}

function isFreshTimestamp(value?: string) {
  if (!value) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  return (Date.now() - parsed) / 36e5 <= marketplaceFreshnessHours
}

function buildLockIndex(snapshot?: ProductUrlLockSnapshot) {
  const index = new Map<string, { status: SourceLockStatus; url?: string }>()
  for (const lock of snapshot?.locks ?? []) {
    if (!lock || typeof lock.source !== 'string' || typeof lock.skuKey !== 'string') continue
    const normalizedSource = (
      lock.source === 'jd_self'
      || lock.source === 'jd_authorized'
      || lock.source === 'jd_supermarket'
    )
      ? 'jd'
      : lock.source === 'lenovo_official' ? 'lenovo_official' : undefined
    if (!normalizedSource) continue
    const key = `${lock.skuKey}:${normalizedSource}`
    const value = {
      status: lock.matchStatus === 'locked'
        ? 'locked'
        : lock.matchStatus === 'candidate'
          ? 'candidate'
          : 'unavailable',
      url: lock.url,
    } satisfies { status: SourceLockStatus; url?: string }
    const previous = index.get(key)
    if (!previous || (previous.status !== 'locked' && value.status === 'locked')) {
      index.set(key, value)
    }
  }
  return index
}

function getComparablePrice(record: MarketplacePriceRecord) {
  if (typeof record.price === 'number') return { field: 'price' as const, value: record.price }
  if (typeof record.preSubsidyPrice === 'number') return { field: 'preSubsidyPrice' as const, value: record.preSubsidyPrice }
  return undefined
}

function capturedAtTime(record: MarketplacePriceRecord) {
  const value = record.evidence.capturedAt ? Date.parse(record.evidence.capturedAt) : Number.NaN
  return Number.isFinite(value) ? value : 0
}

function scoreRecord(record: MarketplacePriceRecord, source: StandardPriceMasterSource, lockedUrl?: string) {
  const url = record.evidence.evidenceUrl ?? record.configuredUrl
  const directUrl = isDirectDetailUrl(source, url)
  const exactLockedUrl = Boolean(lockedUrl && url === lockedUrl)
  const comparable = getComparablePrice(record)
  let score = 0
  if (directUrl) score += 40
  if (exactLockedUrl) score += 20
  if (record.collectionStatus === 'captured') score += 35
  if (record.confidence === 'confirmed') score += 15
  if (record.confidence === 'provisional') score += 8
  if (record.collectionStatus === 'manual_review_required') score -= 18
  if (record.collectionStatus === 'url_configured_only') score -= 24
  if (record.collectionStatus === 'unavailable') score -= 30
  if (comparable) score += 22
  if (record.evidence.screenshotPath) score += 6
  if (record.evidence.capturedBy === 'browser_rpa') score += 8
  if (record.evidence.capturedBy === 'manual') score += 6
  if (record.evidence.capturedBy === 'user_supplied_visible_price') score += 5
  if (record.evidence.capturedBy === 'configured_url') score -= 12
  if (!isFreshTimestamp(record.evidence.capturedAt)) score -= 60
  return score
}

function pickBestRecord(
  records: MarketplacePriceRecord[],
  source: StandardPriceMasterSource,
  lockedUrl?: string,
) {
  return records
    .slice()
    .sort((left, right) => {
      const scoreDiff = scoreRecord(right, source, lockedUrl) - scoreRecord(left, source, lockedUrl)
      if (scoreDiff !== 0) return scoreDiff
      return capturedAtTime(right) - capturedAtTime(left)
    })[0]
}

function getRequiredEvidenceFields(record?: MarketplacePriceRecord): StandardPriceMasterEvidenceField[] {
  if (!record) return []
  if (record.collectionStatus === 'unavailable') return ['evidenceUrl', 'capturedAt', 'capturedBy', 'note']
  if (
    record.collectionStatus === 'captured'
    || record.evidence.capturedBy === 'manual'
    || record.evidence.capturedBy === 'browser_rpa'
    || record.evidence.capturedBy === 'user_supplied_visible_price'
    || record.evidence.capturedBy === 'user_supplied_url'
  ) {
    if (record.evidence.capturedBy === 'configured_url') {
      return ['evidenceUrl', 'capturedAt', 'capturedBy', 'note']
    }
    return ['evidenceUrl', 'screenshotPath', 'capturedAt', 'capturedBy', 'note']
  }
  if (record.collectionStatus === 'url_configured_only') return ['evidenceUrl']
  return ['evidenceUrl', 'capturedAt', 'capturedBy', 'note']
}

function buildEvidenceAudit(
  source: StandardPriceMasterSource,
  lockStatus: SourceLockStatus,
  record?: MarketplacePriceRecord,
) {
  if (!record) {
    return {
      status: 'missing_record',
      requiredFields: [],
      missingFields: [],
      isDirectDetailUrl: false,
      hasComparablePrice: false,
      syncEligible: false,
      reasons: ['没有可用原始采集记录。'],
    } satisfies StandardPriceMasterSourceSelection['evidenceAudit']
  }

  const requiredFields = getRequiredEvidenceFields(record)
  const evidenceUrl = record.evidence.evidenceUrl ?? record.configuredUrl
  const missingFields = requiredFields.filter((field) => {
    if (field === 'evidenceUrl') return !evidenceUrl
    if (field === 'screenshotPath') return !record.evidence.screenshotPath
    if (field === 'capturedAt') return !record.evidence.capturedAt
    if (field === 'capturedBy') return !record.evidence.capturedBy
    return !record.evidence.note
  })
  const directDetailUrl = isDirectDetailUrl(source, evidenceUrl)
  const comparable = getComparablePrice(record)
  const freshCapture = isFreshTimestamp(record.evidence.capturedAt)
  const reasons: string[] = []

  if (lockStatus === 'pending_lock') reasons.push('尚未锁定详情页 URL。')
  if (!directDetailUrl && record.collectionStatus !== 'unavailable') reasons.push('证据 URL 不是商品详情页，只能作为线索。')
  if (!comparable && record.collectionStatus !== 'unavailable') reasons.push('没有可比较的主报价字段。')
  if (
    !comparable
    && record.collectionStatus !== 'unavailable'
    && (typeof record.couponAdjustedPrice === 'number' || typeof record.postSubsidyPrice === 'number')
  ) {
    reasons.push('记录只包含券后价/国补后价，禁止作为京东/官旗主零售价。')
  }
  if (!freshCapture && record.collectionStatus !== 'unavailable') reasons.push(`采集时间已超过 ${marketplaceFreshnessHours} 小时，不能继续视为当前实时价。`)
  if (missingFields.length > 0) reasons.push(`缺少证据字段：${missingFields.join(', ')}`)
  if (record.collectionStatus === 'manual_review_required') reasons.push('原始记录仍处于人工复核状态。')
  if (record.collectionStatus === 'url_configured_only') reasons.push('当前只是 URL 占位，尚未形成正式报价。')
  if (record.collectionStatus === 'unavailable') reasons.push('页面不可销售，仅保留证据。')

  const status: StandardPriceMasterEvidenceStatus = record.collectionStatus === 'unavailable'
    ? 'unavailable'
    : record.collectionStatus === 'url_configured_only'
      ? 'placeholder_only'
      : !freshCapture
        ? 'stale_capture'
      : !directDetailUrl
        ? 'non_detail_url'
        : missingFields.length > 0
          ? 'missing_required_fields'
          : 'complete_for_sync'

  return {
    status,
    requiredFields,
    missingFields,
    isDirectDetailUrl: directDetailUrl,
    hasComparablePrice: Boolean(comparable),
    syncEligible: (
      lockStatus === 'locked'
      && record.collectionStatus === 'captured'
      && record.confidence === 'confirmed'
      && freshCapture
      && directDetailUrl
      && missingFields.length === 0
      && Boolean(comparable)
    ),
    reasons,
  } satisfies StandardPriceMasterSourceSelection['evidenceAudit']
}

function buildRecordKey(record: MarketplacePriceRecord) {
  return [
    record.source,
    record.productId,
    record.evidence.evidenceUrl ?? record.configuredUrl ?? 'no-url',
    record.evidence.capturedAt ?? 'no-time',
  ].join(':')
}

function buildSourceSelection(
  sku: StandardInventorySku,
  source: StandardPriceMasterSource,
  records: MarketplacePriceRecord[],
  lockIndex: Map<string, { status: SourceLockStatus; url?: string }>,
) {
  const lock = lockIndex.get(`${sku.skuKey}:${source}`)
  const lockStatus = lock?.status ?? 'pending_lock'
  const selected = pickBestRecord(records, source, lock?.url)
  const comparable = selected ? getComparablePrice(selected) : undefined
  return {
    source,
    sourceLabel: getSourceLabel(source),
    recordCount: records.length,
    lockStatus,
    lockedUrl: lock?.url,
    selectedRecord: selected
      ? {
          recordKey: buildRecordKey(selected),
          comparablePrice: comparable?.value,
          comparablePriceField: comparable?.field,
          price: selected.price,
          preSubsidyPrice: selected.preSubsidyPrice,
          couponAdjustedPrice: selected.couponAdjustedPrice,
          postSubsidyPrice: selected.postSubsidyPrice,
          priceType: selected.priceType,
          priceBasis: selected.priceBasis,
          confidence: selected.confidence,
          collectionStatus: selected.collectionStatus,
          configuredUrl: selected.configuredUrl,
          matchTitle: selected.matchTitle,
          evidence: selected.evidence,
        }
      : undefined,
    evidenceAudit: buildEvidenceAudit(source, lockStatus, selected),
  } satisfies StandardPriceMasterSourceSelection
}

function buildComparison(
  jd: StandardPriceMasterSourceSelection,
  lenovoOfficial: StandardPriceMasterSourceSelection,
) {
  const notes = [...jd.evidenceAudit.reasons, ...lenovoOfficial.evidenceAudit.reasons]
  const jdPrice = jd.selectedRecord?.comparablePrice
  const lenovoPrice = lenovoOfficial.selectedRecord?.comparablePrice

  if (jd.evidenceAudit.status === 'unavailable' && lenovoOfficial.evidenceAudit.status === 'unavailable') {
    return {
      status: 'unavailable',
      notes,
    } satisfies StandardPriceMasterRow['comparison']
  }
  if (!jd.selectedRecord || !lenovoOfficial.selectedRecord) {
    return {
      status: 'missing_source',
      jdComparablePrice: jdPrice,
      lenovoOfficialComparablePrice: lenovoPrice,
      notes,
    } satisfies StandardPriceMasterRow['comparison']
  }
  if (jd.evidenceAudit.status === 'missing_required_fields' || lenovoOfficial.evidenceAudit.status === 'missing_required_fields') {
    return {
      status: 'evidence_incomplete',
      jdComparablePrice: jdPrice,
      lenovoOfficialComparablePrice: lenovoPrice,
      notes,
    } satisfies StandardPriceMasterRow['comparison']
  }
  if (!jd.evidenceAudit.syncEligible || !lenovoOfficial.evidenceAudit.syncEligible) {
    return {
      status: 'manual_review_required',
      jdComparablePrice: jdPrice,
      lenovoOfficialComparablePrice: lenovoPrice,
      notes,
    } satisfies StandardPriceMasterRow['comparison']
  }

  const absoluteGap = jdPrice !== undefined && lenovoPrice !== undefined
    ? Number(Math.abs(jdPrice - lenovoPrice).toFixed(2))
    : undefined
  const cheaperSource = jdPrice === undefined || lenovoPrice === undefined
    ? undefined
    : jdPrice === lenovoPrice ? 'same_price' : jdPrice < lenovoPrice ? 'jd' : 'lenovo_official'

  return {
    status: 'ready_for_compare',
    jdComparablePrice: jdPrice,
    lenovoOfficialComparablePrice: lenovoPrice,
    absoluteGap,
    cheaperSource,
    comparedAt: new Date().toISOString(),
    notes,
  } satisfies StandardPriceMasterRow['comparison']
}

function buildSyncDecision(comparison: StandardPriceMasterRow['comparison']) {
  if (comparison.status === 'missing_source') {
    return {
      status: 'hold_missing_source',
      basis: 'not_ready',
      reasons: comparison.notes,
    } satisfies StandardPriceMasterRow['syncDecision']
  }
  if (comparison.status === 'evidence_incomplete') {
    return {
      status: 'hold_evidence_incomplete',
      basis: 'not_ready',
      reasons: comparison.notes,
    } satisfies StandardPriceMasterRow['syncDecision']
  }
  if (comparison.status !== 'ready_for_compare') {
    return {
      status: 'hold_manual_review',
      basis: 'not_ready',
      reasons: comparison.notes,
    } satisfies StandardPriceMasterRow['syncDecision']
  }
  if ((comparison.absoluteGap ?? 0) > 100) {
    return {
      status: 'hold_large_gap_review',
      basis: 'not_ready',
      reasons: [`京东与联想官旗价差 ${comparison.absoluteGap}，超过自动统一同步阈值 100 元。`, ...comparison.notes],
    } satisfies StandardPriceMasterRow['syncDecision']
  }
  const jdPrice = comparison.jdComparablePrice
  const lenovoPrice = comparison.lenovoOfficialComparablePrice
  if (jdPrice === undefined || lenovoPrice === undefined) {
    return {
      status: 'hold_missing_source',
      basis: 'not_ready',
      reasons: comparison.notes,
    } satisfies StandardPriceMasterRow['syncDecision']
  }
  if (jdPrice === lenovoPrice) {
    return {
      status: 'ready_for_unified_sync',
      suggestedUnifiedPrice: jdPrice,
      basis: 'same_price',
      reasons: ['京东与联想官旗价格一致，可直接统一同步。'],
    } satisfies StandardPriceMasterRow['syncDecision']
  }
  return {
    status: 'ready_for_unified_sync',
    suggestedUnifiedPrice: Math.min(jdPrice, lenovoPrice),
    basis: 'min_source_price',
    reasons: ['两端价格均完成锁链校验；当前按较低的可确认展示价生成统一同步候选值。'],
  } satisfies StandardPriceMasterRow['syncDecision']
}

function buildRows(
  inventory: StandardInventorySnapshot,
  marketplace: { records?: MarketplacePriceRecord[] } | undefined,
  lockSnapshot: ProductUrlLockSnapshot | undefined,
) {
  const lockIndex = buildLockIndex(lockSnapshot)
  const records = (marketplace?.records ?? []).filter((record): record is MarketplacePriceRecord => (
    Boolean(record.productId)
    && (record.source === 'jd' || record.source === 'lenovo_official')
  ))
  const recordsByKey = new Map<string, MarketplacePriceRecord[]>()
  for (const record of records) {
    const key = `${record.productId}:${record.source}`
    const bucket = recordsByKey.get(key)
    if (bucket) bucket.push(record)
    else recordsByKey.set(key, [record])
  }

  return inventory.skus
    .filter((sku) => sku.currentStock > 0)
    .map((sku) => {
      const jd = buildSourceSelection(sku, 'jd', recordsByKey.get(`${sku.skuKey}:jd`) ?? [], lockIndex)
      const lenovoOfficial = buildSourceSelection(
        sku,
        'lenovo_official',
        recordsByKey.get(`${sku.skuKey}:lenovo_official`) ?? [],
        lockIndex,
      )
      const comparison = buildComparison(jd, lenovoOfficial)
      const syncDecision = buildSyncDecision(comparison)
      return {
        skuKey: sku.skuKey,
        productName: sku.productName,
        pnMtm: sku.pnMtm,
        spec: sku.spec,
        category: sku.category,
        currentStock: sku.currentStock,
        sellableStock: sku.sellableStock,
        sources: {
          jd,
          lenovo_official: lenovoOfficial,
        },
        comparison,
        syncDecision,
      } satisfies StandardPriceMasterRow
    })
    .sort((left, right) => (
      right.currentStock - left.currentStock
      || left.syncDecision.status.localeCompare(right.syncDecision.status)
      || left.skuKey.localeCompare(right.skuKey)
    ))
}

function buildFrontendSnapshot(snapshot: StandardPriceMasterSnapshot): StandardPriceFrontendSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    source: 'standard_price_master_frontend_snapshot',
    totals: snapshot.totals,
    rows: snapshot.rows.map((row) => ({
      skuKey: row.skuKey,
      productName: row.productName,
      category: row.category,
      currentStock: row.currentStock,
      jdPrice: row.comparison.jdComparablePrice,
      lenovoOfficialPrice: row.comparison.lenovoOfficialComparablePrice,
      priceGap: row.comparison.absoluteGap,
      cheaperSource: row.comparison.cheaperSource,
      comparisonStatus: row.comparison.status,
      syncStatus: row.syncDecision.status,
      suggestedUnifiedPrice: row.syncDecision.suggestedUnifiedPrice,
      lastCapturedAt: [
        row.sources.jd.selectedRecord?.evidence.capturedAt,
        row.sources.lenovo_official.selectedRecord?.evidence.capturedAt,
      ].filter(Boolean).sort().at(-1),
      evidenceSummary: [
        `JD:${row.sources.jd.evidenceAudit.status}`,
        `Lenovo:${row.sources.lenovo_official.evidenceAudit.status}`,
      ].join(' | '),
    })),
  }
}

export async function buildStandardPriceMasterSnapshot(): Promise<{
  master: StandardPriceMasterSnapshot
  frontend: StandardPriceFrontendSnapshot
}> {
  const [inventory, marketplace, lockSnapshot] = await Promise.all([
    readJson<StandardInventorySnapshot>(artifactPath('latest-standard-inventory-snapshot.json')),
    readJson<{ records?: MarketplacePriceRecord[] }>(artifactPath('latest-marketplace-price-snapshot.json')),
    readJson<ProductUrlLockSnapshot>(artifactPath('latest-product-url-locks.json')),
  ])
  if (!inventory) throw new Error('缺少 latest-standard-inventory-snapshot.json，请先生成库存快照。')

  const rows = buildRows(inventory, marketplace, lockSnapshot)
  const master: StandardPriceMasterSnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'standard_price_master',
    scope: 'in_stock_inventory_skus',
    policy: {
      aggregateFirst: '先把京东/联想官旗原始采集记录按 SKU 和来源归集到标准报价总表，保留锁定 URL、采集方式、时间和截图证据，不直接把零散记录同步到前端。',
      compareThenSync: '总表层只在两端都完成详情页锁定、主报价字段可比、证据字段完整后进入比对；比对通过后再生成统一同步候选价和前端快照。',
      manualEvidenceBoundary: '人工采集或类人工浏览器采集要同时具备详情页 URL、截图路径、采集时间、采集人/采集器标识、备注；搜索页/店铺页、仅 URL 占位、下架页不可直接进入统一同步。联想官旗下架后允许以天猫/淘宝在售详情页替换，京东指定链接失效后允许以京东全站新详情页替换。',
    },
    totals: {
      inventorySkuCount: inventory.skus.length,
      inStockSkuCount: rows.length,
      skuWithAnyCollectedSourceCount: rows.filter((row) => row.sources.jd.recordCount > 0 || row.sources.lenovo_official.recordCount > 0).length,
      readyForCompareCount: rows.filter((row) => row.comparison.status === 'ready_for_compare').length,
      readyForUnifiedSyncCount: rows.filter((row) => row.syncDecision.status === 'ready_for_unified_sync').length,
      manualReviewRequiredCount: rows.filter((row) => row.comparison.status === 'manual_review_required' || row.syncDecision.status === 'hold_large_gap_review').length,
      evidenceIncompleteCount: rows.filter((row) => row.comparison.status === 'evidence_incomplete').length,
      missingSourceCount: rows.filter((row) => row.comparison.status === 'missing_source').length,
    },
    rows,
  }
  return {
    master,
    frontend: buildFrontendSnapshot(master),
  }
}

export async function saveStandardPriceMasterSnapshot() {
  const { master, frontend } = await buildStandardPriceMasterSnapshot()
  const outputs = [
    {
      content: `${JSON.stringify(master, null, 2)}\n`,
      artifact: artifactPath(standardPriceMasterFileName),
      web: webDataPath(standardPriceMasterFileName),
    },
    {
      content: `${JSON.stringify(frontend, null, 2)}\n`,
      artifact: artifactPath(standardPriceFrontendFileName),
      web: webDataPath(standardPriceFrontendFileName),
    },
  ]

  await Promise.all(outputs.flatMap(({ artifact, web }) => [
    fs.mkdir(path.dirname(artifact), { recursive: true }),
    fs.mkdir(path.dirname(web), { recursive: true }),
  ]))
  await Promise.all(outputs.flatMap(({ content, artifact, web }) => [
    fs.writeFile(artifact, content, 'utf-8'),
    fs.writeFile(web, content, 'utf-8'),
  ]))

  return {
    master,
    frontend,
    artifactPaths: outputs.map((item) => item.artifact),
    webPaths: outputs.map((item) => item.web),
  }
}
