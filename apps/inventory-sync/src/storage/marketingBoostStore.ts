import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'
import { saveEducationSubsidyAgentScanSnapshot } from './educationSubsidyAgentScanStore.js'

type DistributorQuote = {
  source?: string
  groupName?: string
  sourceFile?: string
  quoteDate?: string
  pnMtm?: string
  productName?: string
  pickupPrice?: number
  remark?: string
  libraryMatch?: {
    status?: string
    primarySkuKey?: string
    canonicalName?: string
    currentStock?: number
    sellableStock?: number
    evidence?: string
  }
}

type DistributorQuoteSnapshot = {
  generatedAt?: string
  quoteDate?: string
  quoteFile?: string
  quotes?: DistributorQuote[]
}

type InventoryMovementRecord = {
  id: string
  skuKey: string
  quantity: number
  movementType: string
  businessDate: string
  serialNumber?: string
  documentNumber?: string
  operatorName?: string
  storeName?: string
  productName?: string
  pnMtm?: string
  spec?: string
  note?: string
  updatedAt: string
}

type InventoryMovementsSnapshot = {
  records?: InventoryMovementRecord[]
}

type ProductLibraryProduct = {
  id?: string
  canonical_name?: string
  primary_sku_key?: string
  pn_mtm?: string
  current_stock?: number
  sellable_stock?: number
  default_category?: string
  source_category?: string
  jd_subcategory?: string
}

type ProductLibraryProductsSnapshot = {
  items?: ProductLibraryProduct[]
  count?: number
}

export type MarketingBoostActivity = {
  id: string
  sourceType: 'distributor_remark' | 'manual_upload_ocr' | 'manual_activity'
  activityCategory: 'po_boost' | 'education_discount' | 'bundle_gift' | 'aipc_campaign' | 'designated_ai_campaign' | 'general_marketing'
  activityLabel: string
  sourceSheetName?: string
  sourceFile?: string
  evidenceImagePath?: string
  capturedAt: string
  activityDate: string
  lockedDisplayDate: string
  validFrom: string
  validTo: string
  groupName?: string
  productName: string
  pnMtm?: string
  skuKey?: string
  matchStatus: 'inventory_matched' | 'product_library_only' | 'unmatched'
  matchEvidence: string
  poSalesPrice?: number
  boostAmount?: number
  educationDiscountAmount?: number
  pickupPrice?: number
  ruleText: string
  rawText: string
}

export type MarketingBoostEligibleInventoryItem = {
  activityId: string
  activityCategory: MarketingBoostActivity['activityCategory']
  activityLabel: string
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  currentStock: number
  sellableStock: number
  serialCount: number
  physicalHoldStock?: number
  inventoryAverageCost?: number
  poSalesPrice?: number
  boostAmount?: number
  educationDiscountAmount?: number
  lockedDisplayDate: string
  activityDate: string
  validFrom: string
  validTo: string
  ruleText: string
  sourceFile?: string
}

export type MarketingBoostHeroCard = {
  id: string
  activityId: string
  activityCategory: MarketingBoostActivity['activityCategory']
  activityLabel: string
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  orderNumber: string
  outboundDate: string
  lockedDisplayDate: string
  outboundDocumentNumber?: string
  outboundOperatorName?: string
  outboundStoreName?: string
  serialNumbers: string[]
  quantity: number
  physicalHoldStock?: number
  inventoryAverageCost?: number
  poSalesPrice?: number
  boostAmount?: number
  educationDiscountAmount?: number
  pickupPrice?: number
  estimatedMarketingSupportAmount: number
  estimatedCostGapAmount: number
  status: '待申请' | '已申请' | '已核销'
  sourceFile?: string
  evidenceImagePath?: string
  ruleText: string
  paymentReceived?: boolean
  paymentReceivedAt?: string
  paymentReceivedNote?: string
  historySource?: 'auto_sales_outbound' | 'manual_po_protection' | 'sales_po_policy'
}

export type MarketingBoostSnapshot = {
  generatedAt: string
  source: 'marketing_boost_activity'
  quoteDate?: string
  ruleVersion?: string
  ruleSourceTitle?: string
  ruleSourceLink?: string
  ruleSourceFileId?: string
  ruleSourceFile?: string
  summary: {
    activityCount: number
    distributorRemarkActivityCount: number
    manualUploadActivityCount: number
    eligibleInventoryCount: number
    heroCardCount: number
    historyCount: number
    productLibraryOnlyCount: number
    unmatchedActivityCount: number
    activityHistoryCount: number
    totalEstimatedMarketingSupportAmount: number
    totalEstimatedCostGapAmount: number
    categoryBreakdown: Array<{
      category: MarketingBoostActivity['activityCategory']
      label: string
      count: number
    }>
  }
  activities: MarketingBoostActivity[]
  activityHistory: MarketingBoostActivity[]
  eligibleInventory: MarketingBoostEligibleInventoryItem[]
  heroCards: MarketingBoostHeroCard[]
  history: MarketingBoostHeroCard[]
  unmatchedProductLibrary: MarketingBoostActivity[]
  salesPoSettlementValidations?: SalesPoSettlementValidation[]
}

type MarketingBoostHistorySnapshot = {
  generatedAt: string
  source: 'marketing_boost_activity_history'
  ruleVersion?: string
  ruleSourceTitle?: string
  ruleSourceLink?: string
  ruleSourceFileId?: string
  ruleSourceFile?: string
  activities: MarketingBoostActivity[]
  cards?: MarketingBoostHeroCard[]
}

type DuplicateSubsidyAuditItem = {
  key: string
  activityCategory: MarketingBoostHeroCard['activityCategory']
  orderNumber: string
  skuKey?: string
  pnMtm?: string
  productName: string
  duplicateCount: number
  amountField: 'boostAmount' | 'educationDiscountAmount'
  amount: number
  outboundDate?: string
  cardIds: string[]
  serialNumberSets: string[][]
}

type DuplicateSubsidyAuditSnapshot = {
  generatedAt: string
  source: 'marketing_boost_duplicate_subsidy_audit'
  summary: {
    duplicateGroupCount: number
    duplicateCardCount: number
  }
  duplicates: DuplicateSubsidyAuditItem[]
}

type ManualMarketingBoostHistorySnapshot = {
  records?: Array<Partial<MarketingBoostHeroCard>>
}

type SalesPoPolicyRecord = {
  skuKey?: string
  pnMtm: string
  productName: string
  spec?: string
  category?: string
  poSalesPrice: number
  settlementPrice: number
  boostAmount: number
  customerReferencePrice?: number
  storeWelfareRate?: number
  ruleText?: string
}

type SalesPoSettlementValidation = {
  policyName: string
  pnMtm: string
  productName: string
  expectedSettlementPrice: number
  quoteDate?: string
  quoteFile?: string
  distributorSettlementPrice?: number
  status: 'matched' | 'price_mismatch' | 'missing_distributor_quote' | 'stale_quote_date'
  message: string
}

type SalesPoPolicySnapshot = {
  policyName?: string
  source?: string
  sourceEvidence?: string
  capturedAt?: string
  validFrom: string
  validTo: string
  salesOnly?: boolean
  records?: SalesPoPolicyRecord[]
}

const marketingBoostHistoryFileName = 'latest-marketing-boost-history.json'
const marketingBoostRuleVersion = '2.0升级版'
const marketingBoostRuleSourceTitle = '附2教育特惠机型明细-20250508'
const marketingBoostRuleSourceLink = 'https://www.kdocs.cn/l/cg2irMfWUM28'
const marketingBoostRuleSourceFileId = '400450070061'

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

async function readJsonIfExists<T>(filePath: string) {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => null)
}

function getBeijingDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function isActivityActiveOnDate(activity: MarketingBoostActivity, date: string) {
  const from = normalizeText(activity.validFrom)
  const to = normalizeText(activity.validTo)
  if (!from || !to) return true
  return from <= date && to >= date
}

function normalizeText(value?: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function dedupeTextFragments(...segments: Array<string | undefined>) {
  const normalized = segments
    .flatMap((segment) => String(segment ?? '').split('；'))
    .map((item) => normalizeText(item))
    .filter(Boolean)
  return Array.from(new Set(normalized)).join('；')
}

function ensureNewRuleTag(ruleText?: string) {
  const text = dedupeTextFragments(ruleText)
  if (!text) return '新规则'
  if (text.includes('新规则')) return text
  return `${text}；新规则`
}

function getDatePart(value?: string) {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  const direct = text.match(/20\d{2}-\d{2}-\d{2}/)?.[0]
  if (direct) return direct
  const parsed = Date.parse(text.replace(' ', 'T'))
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  return undefined
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function normalizeSerialNumbers(serialNumbers?: string[]) {
  return Array.from(new Set((serialNumbers ?? []).map((item) => normalizeText(item)).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function parseMoneyNear(text: string, keyword: RegExp) {
  const normalized = normalizeText(text)
  const match = normalized.match(new RegExp(`${keyword.source}[^0-9]{0,12}(\\d{3,6}(?:\\.\\d+)?)`, 'i'))
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function extractPoSalesPrice(text: string) {
  return parseMoneyNear(text, /PO|po|销售价|政策价|活动价/)
}

function extractBoostAmount(text: string) {
  return parseMoneyNear(text, /加磅|营销|补贴|红包|返利|费用/)
}

function extractEducationDiscountAmount(text: string) {
  return parseMoneyNear(text, /教育补|学生优惠|学生价差|满额返|教育特惠/)
}

function isMarketingBoostText(text?: string) {
  return /加磅|PO|po|营销费用|限时|红包|返利|政策价|销售价|活动价|教育补|教育特惠|学生优惠|买赠|AIPC|AI PC/.test(normalizeText(text))
}

function isServiceActivity(productName?: string, ruleText?: string) {
  const text = normalizeText([productName, ruleText].filter(Boolean).join('；'))
  return /服务|服务费|服务包|延保|保修|安装|上门|软件服务|会员|权益|care|智惠服务|无忧服务/i.test(text)
}

function classifyActivityCategory(
  productName?: string,
  ruleText?: string,
  sourceFile?: string,
  sourceSheetName?: string,
): Pick<MarketingBoostActivity, 'activityCategory' | 'activityLabel'> {
  const text = normalizeText([sourceSheetName, sourceFile, productName, ruleText].filter(Boolean).join('；'))
  if (/教育补|教育特惠|学生优惠|学生认证|满额返/.test(text)) {
    return { activityCategory: 'education_discount', activityLabel: '教育补贴' }
  }
  if (/买赠|赠品|套装|多件套/.test(text)) {
    return { activityCategory: 'bundle_gift', activityLabel: '买赠活动' }
  }
  if (/AIPC|AI PC|AIP C/i.test(text)) {
    return { activityCategory: 'aipc_campaign', activityLabel: 'AIPC活动' }
  }
  if (/指定AI|指定 AI|AI指定|AI平/i.test(text)) {
    return { activityCategory: 'designated_ai_campaign', activityLabel: '指定AI活动' }
  }
  if (/PO|po|加磅|营销费用|返利|红包|活动价|政策价/.test(text)) {
    return { activityCategory: 'po_boost', activityLabel: 'PO加磅' }
  }
  return { activityCategory: 'general_marketing', activityLabel: '营销活动' }
}

function matchInventorySku(
  inventory: StandardInventorySnapshot,
  productName?: string,
  pnMtm?: string,
  skuKey?: string,
) {
  if (skuKey) {
    const direct = inventory.skus.find((sku) => sku.skuKey === skuKey)
    if (direct) return { sku: direct, evidence: `按 SKU ${skuKey} 命中库存` }
  }
  if (pnMtm) {
    const direct = inventory.skus.find((sku) => sku.pnMtm?.toUpperCase() === pnMtm.toUpperCase())
    if (direct) return { sku: direct, evidence: `按 PN/MTM ${pnMtm} 命中库存` }
  }
  const name = normalizeText(productName).toUpperCase()
  if (name.length >= 8) {
    const direct = inventory.skus.find((sku) => normalizeText(sku.productName).toUpperCase() === name)
    if (direct) return { sku: direct, evidence: '按完整商品名命中库存' }
    const compactName = name.replace(/\s+/g, '')
    const fuzzy = inventory.skus.find((sku) => {
      const skuName = normalizeText(sku.productName).toUpperCase().replace(/\s+/g, '')
      if (!skuName) return false
      return skuName.includes(compactName) || compactName.includes(skuName)
    })
    if (fuzzy) return { sku: fuzzy, evidence: '按标题规范化兜底命中库存' }
  }
  return undefined
}

function matchProductLibrarySku(
  productLibraryProducts: ProductLibraryProduct[],
  productName?: string,
  pnMtm?: string,
  skuKey?: string,
) {
  if (skuKey) {
    const direct = productLibraryProducts.find((item) => item.primary_sku_key === skuKey)
    if (direct) return { product: direct, evidence: `按 SKU ${skuKey} 命中标准商品库` }
  }
  if (pnMtm) {
    const direct = productLibraryProducts.find((item) => item.pn_mtm?.toUpperCase() === pnMtm.toUpperCase())
    if (direct) return { product: direct, evidence: `按 PN/MTM ${pnMtm} 命中标准商品库 ${direct.id ?? ''}`.trim() }
  }
  const name = normalizeText(productName).toUpperCase()
  if (name.length >= 8) {
    const direct = productLibraryProducts.find((item) => normalizeText(item.canonical_name).toUpperCase() === name)
    if (direct) return { product: direct, evidence: '按完整商品名命中标准商品库' }
    const compactName = name.replace(/\s+/g, '')
    const fuzzy = productLibraryProducts.find((item) => {
      const canonical = normalizeText(item.canonical_name).toUpperCase().replace(/\s+/g, '')
      if (!canonical) return false
      return canonical.includes(compactName) || compactName.includes(canonical)
    })
    if (fuzzy) return { product: fuzzy, evidence: '按标题规范化兜底命中标准商品库' }
  }
  return undefined
}

function buildActivityFromQuote(quote: DistributorQuote): MarketingBoostActivity | undefined {
  const rawText = normalizeText([quote.productName, quote.remark].filter(Boolean).join('；'))
  if (!isMarketingBoostText(rawText)) return undefined
  if (isServiceActivity(quote.productName, quote.remark)) return undefined
  const activityDate = quote.quoteDate || getBeijingDateString()
  const skuKey = quote.libraryMatch?.primarySkuKey
  const matchStatus = skuKey
    ? quote.libraryMatch?.currentStock && quote.libraryMatch.currentStock > 0 ? 'inventory_matched' : 'product_library_only'
    : 'unmatched'
  const category = classifyActivityCategory(quote.productName, quote.remark, quote.sourceFile, quote.groupName)
  const isEducationDiscount = category.activityCategory === 'education_discount'
  return {
    id: `dist-${activityDate}-${hashText(`${quote.pnMtm ?? ''}-${rawText}`)}`,
    sourceType: 'distributor_remark',
    activityCategory: category.activityCategory,
    activityLabel: category.activityLabel,
    sourceSheetName: quote.groupName,
    sourceFile: quote.sourceFile,
    capturedAt: new Date().toISOString(),
    activityDate,
    lockedDisplayDate: activityDate,
    validFrom: activityDate,
    validTo: activityDate,
    groupName: quote.groupName,
    productName: normalizeText(quote.productName) || normalizeText(quote.libraryMatch?.canonicalName) || '待匹配营销活动产品',
    pnMtm: quote.pnMtm,
    skuKey,
    matchStatus,
    matchEvidence: quote.libraryMatch?.evidence ?? '分销备注未匹配库存或标准商品库',
    poSalesPrice: isEducationDiscount ? undefined : extractPoSalesPrice(rawText),
    boostAmount: isEducationDiscount ? undefined : extractBoostAmount(rawText),
    educationDiscountAmount: isEducationDiscount ? extractEducationDiscountAmount(rawText) : undefined,
    pickupPrice: quote.pickupPrice,
    ruleText: normalizeText(quote.remark) || '分销商报价备注识别到营销/加磅活动',
    rawText,
  }
}

async function loadManualActivities(): Promise<MarketingBoostActivity[]> {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual/marketing-boost')
  const entries = await fs.readdir(manualDir, { withFileTypes: true }).catch(() => [])
  const activities: MarketingBoostActivity[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|txt|md)$/i.test(entry.name)) continue
    if (!/^marketing-boost-.*\.(json|txt|md)$/i.test(entry.name)) continue
    const filePath = path.resolve(manualDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => '')
    if (!raw.trim()) continue
    if (/\.json$/i.test(entry.name)) {
      const payload = JSON.parse(raw) as { activities?: Partial<MarketingBoostActivity>[] } | Partial<MarketingBoostActivity>[]
      const rows = Array.isArray(payload) ? payload : payload.activities ?? []
      for (const row of rows) {
        const rawText = normalizeText(row.rawText ?? row.ruleText ?? row.productName)
        if (isServiceActivity(row.productName, row.ruleText ?? rawText)) continue
        const activityDate = row.activityDate ?? row.lockedDisplayDate ?? getDatePart(row.capturedAt) ?? getBeijingDateString()
        const category = classifyActivityCategory(row.productName, row.ruleText ?? rawText, row.sourceFile ?? filePath, row.sourceSheetName)
        const activityCategory = row.activityCategory ?? category.activityCategory
        const isEducationDiscount = activityCategory === 'education_discount'
        activities.push({
          id: row.id ?? `manual-${activityDate}-${hashText(`${row.pnMtm ?? ''}-${rawText}`)}`,
          sourceType: row.sourceType === 'manual_activity' ? 'manual_activity' : 'manual_upload_ocr',
          activityCategory,
          activityLabel: row.activityLabel ?? category.activityLabel,
          sourceSheetName: row.sourceSheetName,
          sourceFile: row.sourceFile ?? filePath,
          evidenceImagePath: row.evidenceImagePath,
          capturedAt: row.capturedAt ?? new Date().toISOString(),
          activityDate,
          lockedDisplayDate: row.lockedDisplayDate ?? activityDate,
          validFrom: row.validFrom ?? activityDate,
          validTo: row.validTo ?? activityDate,
          groupName: row.groupName,
          productName: normalizeText(row.productName) || '手工识别营销活动产品',
          pnMtm: row.pnMtm,
          skuKey: row.skuKey,
          matchStatus: row.matchStatus ?? 'unmatched',
          matchEvidence: row.matchEvidence ?? '手工上传识别，待库存匹配',
          poSalesPrice: isEducationDiscount ? undefined : row.poSalesPrice ?? extractPoSalesPrice(rawText),
          boostAmount: isEducationDiscount ? undefined : row.boostAmount ?? extractBoostAmount(rawText),
          educationDiscountAmount: isEducationDiscount ? row.educationDiscountAmount ?? extractEducationDiscountAmount(rawText) : undefined,
          pickupPrice: row.pickupPrice,
          ruleText: normalizeText(row.ruleText) || rawText,
          rawText,
        })
      }
      continue
    }
    if (!isMarketingBoostText(raw)) continue
    if (isServiceActivity(entry.name, raw)) continue
    const fileDate = getDatePart(entry.name) ?? getBeijingDateString()
    const category = classifyActivityCategory(entry.name, raw, filePath, undefined)
    const isEducationDiscount = category.activityCategory === 'education_discount'
    activities.push({
      id: `manual-${fileDate}-${hashText(raw)}`,
      sourceType: 'manual_activity',
      activityCategory: category.activityCategory,
      activityLabel: category.activityLabel,
      sourceFile: filePath,
      capturedAt: new Date().toISOString(),
      activityDate: fileDate,
      lockedDisplayDate: fileDate,
      validFrom: fileDate,
      validTo: fileDate,
      productName: normalizeText(raw.split(/\n/).find((line) => line.trim()) ?? '手工识别营销活动产品'),
      matchStatus: 'unmatched',
      matchEvidence: '手工文本识别，待库存匹配',
      poSalesPrice: isEducationDiscount ? undefined : extractPoSalesPrice(raw),
      boostAmount: isEducationDiscount ? undefined : extractBoostAmount(raw),
      educationDiscountAmount: isEducationDiscount ? extractEducationDiscountAmount(raw) : undefined,
      ruleText: normalizeText(raw),
      rawText: normalizeText(raw),
    })
  }
  return activities
}

async function loadManualHistoryCards(): Promise<MarketingBoostHeroCard[]> {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual/marketing-boost')
  const entries = await fs.readdir(manualDir, { withFileTypes: true }).catch(() => [])
  const cards: MarketingBoostHeroCard[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !/^marketing-boost-history-.*\.json$/i.test(entry.name)) continue
    const filePath = path.resolve(manualDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => '')
    if (!raw.trim()) continue
    const payload = JSON.parse(raw) as ManualMarketingBoostHistorySnapshot | Array<Partial<MarketingBoostHeroCard>>
    const rows = Array.isArray(payload) ? payload : payload.records ?? []
    for (const row of rows) {
      const skuKey = normalizeText(row.skuKey)
      const productName = normalizeText(row.productName)
      const outboundDate = normalizeText(row.outboundDate)
      const orderNumber = normalizeText(row.orderNumber)
      if (!skuKey || !productName || !outboundDate || !orderNumber) continue
      cards.push({
        id: row.id ?? `manual-history-${hashText(`${skuKey}-${orderNumber}-${outboundDate}`)}`,
        activityId: row.activityId ?? `manual-activity-${skuKey}`,
        activityCategory: row.activityCategory ?? 'po_boost',
        activityLabel: row.activityLabel ?? '营销PO价保',
        skuKey,
        productName,
        pnMtm: row.pnMtm,
        spec: row.spec,
        category: row.category,
        orderNumber,
        outboundDate,
        lockedDisplayDate: getDatePart(outboundDate) ?? row.lockedDisplayDate ?? getBeijingDateString(),
        outboundDocumentNumber: row.outboundDocumentNumber ?? orderNumber,
        outboundOperatorName: row.outboundOperatorName,
        outboundStoreName: row.outboundStoreName,
        serialNumbers: Array.isArray(row.serialNumbers) ? row.serialNumbers.map((item) => normalizeText(String(item))).filter(Boolean) : [],
        quantity: Math.max(1, Number(row.quantity ?? 1) || 1),
        inventoryAverageCost: row.inventoryAverageCost,
        poSalesPrice: row.poSalesPrice,
        boostAmount: row.boostAmount,
        educationDiscountAmount: row.educationDiscountAmount,
        pickupPrice: row.pickupPrice,
        estimatedMarketingSupportAmount: Number(row.estimatedMarketingSupportAmount ?? 0),
        estimatedCostGapAmount: Number(row.estimatedCostGapAmount ?? 0),
        status: row.status === '已核销' ? '已核销' : row.status === '已申请' ? '已申请' : '待申请',
        sourceFile: row.sourceFile ?? filePath,
        evidenceImagePath: row.evidenceImagePath,
        ruleText: normalizeText(row.ruleText) || '手工固化营销PO价保历史',
        paymentReceived: Boolean(row.paymentReceived),
        paymentReceivedAt: row.paymentReceivedAt,
        paymentReceivedNote: row.paymentReceivedNote,
        historySource: 'manual_po_protection',
      })
    }
  }
  return cards
}

async function loadSalesPoPolicies(): Promise<Array<SalesPoPolicySnapshot & { sourceFile: string }>> {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual/marketing-boost')
  const entries = await fs.readdir(manualDir, { withFileTypes: true }).catch(() => [])
  const policies: Array<SalesPoPolicySnapshot & { sourceFile: string }> = []
  for (const entry of entries) {
    if (!entry.isFile() || !/^sales-po-policy-.*\.json$/i.test(entry.name)) continue
    const filePath = path.resolve(manualDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf-8')
    const payload = JSON.parse(raw) as SalesPoPolicySnapshot
    if (!payload.validFrom || !payload.validTo || !Array.isArray(payload.records)) continue
    policies.push({
      ...payload,
      sourceFile: filePath,
      salesOnly: payload.salesOnly ?? true,
      records: payload.records.filter((record) => record.pnMtm && record.productName && record.boostAmount > 0),
    })
  }
  return policies
}

function dedupeActivities(activities: MarketingBoostActivity[]) {
  const map = new Map<string, MarketingBoostActivity>()
  for (const activity of activities) {
    const productIdentity = activity.skuKey
      ? `sku:${activity.skuKey}`
      : activity.pnMtm
        ? `pn:${activity.pnMtm.toUpperCase()}`
        : `name:${normalizeText(activity.productName).toUpperCase()}`
    const key = [activity.activityDate, activity.validFrom, activity.validTo, activity.activityCategory, productIdentity].join('|')
    const existing = map.get(key)
    if (!existing) {
      map.set(key, activity)
      continue
    }
    const prefersManualEvidence = activity.sourceType === 'manual_upload_ocr' && existing.sourceType !== 'manual_upload_ocr'
    map.set(key, {
      ...existing,
      id: existing.id,
      activityCategory: existing.activityCategory,
      activityLabel: existing.activityLabel || activity.activityLabel,
      sourceSheetName: existing.sourceSheetName ?? activity.sourceSheetName,
      sourceType: prefersManualEvidence ? activity.sourceType : existing.sourceType,
      sourceFile: activity.sourceFile ?? existing.sourceFile,
      evidenceImagePath: activity.evidenceImagePath ?? existing.evidenceImagePath,
      capturedAt: activity.capturedAt > existing.capturedAt ? activity.capturedAt : existing.capturedAt,
      productName: existing.productName || activity.productName,
      pnMtm: existing.pnMtm ?? activity.pnMtm,
      skuKey: existing.skuKey ?? activity.skuKey,
      matchStatus: existing.matchStatus === 'inventory_matched' ? existing.matchStatus : activity.matchStatus,
      matchEvidence: existing.matchStatus === 'inventory_matched' ? existing.matchEvidence : activity.matchEvidence,
      poSalesPrice: existing.poSalesPrice ?? activity.poSalesPrice,
      boostAmount: existing.boostAmount ?? activity.boostAmount,
      educationDiscountAmount: existing.educationDiscountAmount ?? activity.educationDiscountAmount,
      pickupPrice: existing.pickupPrice ?? activity.pickupPrice,
      rawText: dedupeTextFragments(existing.rawText, activity.rawText),
      ruleText: dedupeTextFragments(existing.ruleText, activity.ruleText),
    })
  }
  return Array.from(map.values()).sort((left, right) => right.activityDate.localeCompare(left.activityDate) || left.productName.localeCompare(right.productName, 'zh-CN'))
}

function activityHistoryKey(activity: MarketingBoostActivity) {
  const productIdentity = activity.skuKey
    ? `sku:${activity.skuKey}`
    : activity.pnMtm
      ? `pn:${activity.pnMtm.toUpperCase()}`
      : `name:${normalizeText(activity.productName).toUpperCase()}`
  return [activity.activityDate, activity.validFrom, activity.validTo, activity.activityCategory, productIdentity, hashText(activity.ruleText || activity.rawText)].join('|')
}

function mergeActivityHistory(previous: MarketingBoostActivity[], current: MarketingBoostActivity[]) {
  const map = new Map<string, MarketingBoostActivity>()
  for (const activity of previous) map.set(activityHistoryKey(activity), activity)
  for (const activity of current) {
    const key = activityHistoryKey(activity)
    const existing = map.get(key)
    map.set(key, existing ? {
      ...existing,
      ...activity,
      id: existing.id || activity.id,
      activityCategory: existing.activityCategory || activity.activityCategory,
      activityLabel: existing.activityLabel || activity.activityLabel,
      capturedAt: activity.capturedAt > existing.capturedAt ? activity.capturedAt : existing.capturedAt,
      sourceFile: activity.sourceFile ?? existing.sourceFile,
      evidenceImagePath: activity.evidenceImagePath ?? existing.evidenceImagePath,
      rawText: dedupeTextFragments(existing.rawText, activity.rawText),
      ruleText: dedupeTextFragments(existing.ruleText, activity.ruleText),
    } : {
      ...activity,
      ruleText: ensureNewRuleTag(activity.ruleText),
    })
  }
  return Array.from(map.values()).sort((left, right) => (
    right.validTo.localeCompare(left.validTo)
    || right.activityDate.localeCompare(left.activityDate)
    || left.productName.localeCompare(right.productName, 'zh-CN')
  ))
}

function enrichActivitiesWithInventory(
  activities: MarketingBoostActivity[],
  inventory: StandardInventorySnapshot,
  productLibraryProducts: ProductLibraryProduct[],
) {
  return activities.map((activity) => {
    const matched = matchInventorySku(inventory, activity.productName, activity.pnMtm, activity.skuKey)
    if (matched) {
      return {
        ...activity,
        skuKey: matched.sku.skuKey,
        pnMtm: activity.pnMtm ?? matched.sku.pnMtm,
        productName: matched.sku.productName || activity.productName,
        matchStatus: matched.sku.currentStock > 0 ? 'inventory_matched' as const : 'product_library_only' as const,
        matchEvidence: matched.evidence,
      }
    }
    const productLibraryMatched = matchProductLibrarySku(productLibraryProducts, activity.productName, activity.pnMtm, activity.skuKey)
    if (!productLibraryMatched) return activity
    return {
      ...activity,
      skuKey: activity.skuKey ?? productLibraryMatched.product.primary_sku_key,
      pnMtm: activity.pnMtm ?? productLibraryMatched.product.pn_mtm,
      productName: activity.productName || productLibraryMatched.product.canonical_name || '标准商品库营销活动产品',
      matchStatus: 'product_library_only' as const,
      matchEvidence: productLibraryMatched.evidence,
    }
  })
}

function buildEligibleInventory(activities: MarketingBoostActivity[], inventory: StandardInventorySnapshot[]) {
  const latestInventory = inventory[0]
  if (!latestInventory) return []
  const bySku = new Map(latestInventory.skus.map((sku) => [sku.skuKey, sku]))
  return activities.flatMap((activity) => {
    if (!activity.skuKey) return []
    const sku = bySku.get(activity.skuKey)
    if (!sku || sku.currentStock <= 0) return []
    return [{
      activityId: activity.id,
      activityCategory: activity.activityCategory,
      activityLabel: activity.activityLabel,
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      spec: sku.spec,
      category: sku.category,
      currentStock: sku.currentStock,
      sellableStock: sku.sellableStock,
      serialCount: sku.serialCount,
      physicalHoldStock: Number(sku.physicalHoldStock ?? 0),
      inventoryAverageCost: sku.salesCostPrice ?? sku.agentPrice,
      poSalesPrice: activity.poSalesPrice,
      boostAmount: activity.boostAmount,
      educationDiscountAmount: activity.educationDiscountAmount,
      lockedDisplayDate: activity.lockedDisplayDate,
      activityDate: activity.activityDate,
      validFrom: activity.validFrom,
      validTo: activity.validTo,
      ruleText: activity.ruleText,
      sourceFile: activity.sourceFile,
    }]
  }).sort((left, right) => right.currentStock - left.currentStock || left.productName.localeCompare(right.productName, 'zh-CN'))
}

function extractOrderNumber(note?: string, fallback?: string) {
  return normalizeText(note).match(/[A-Z]{2}\d{8,}/)?.[0] ?? fallback ?? '待补'
}

function buildRefundedOrderSkuKeys(movements: InventoryMovementRecord[]) {
  const refunded = new Set<string>()
  for (const movement of movements) {
    if (movement.movementType !== 'transfer_inbound') continue
    const refundOrderNumber = extractOrderNumber(movement.note, movement.documentNumber)
    if (!refundOrderNumber || refundOrderNumber === '待补' || !movement.skuKey) continue
    refunded.add(`${refundOrderNumber}::${movement.skuKey}`)
  }
  return refunded
}

function isRefundedOrderSku(
  refundedOrderSkuKeys: Set<string>,
  orderNumber?: string,
  skuKey?: string,
) {
  if (!orderNumber || !skuKey) return false
  return refundedOrderSkuKeys.has(`${orderNumber}::${skuKey}`)
}

function isLocalPlaceholderOrder(orderNumber?: string, sourceText?: string) {
  const normalizedOrderNumber = normalizeText(orderNumber)
  const normalizedSourceText = normalizeText(sourceText)
  return normalizedOrderNumber.startsWith('SO-') || normalizedSourceText.includes('本地销售单')
}

function buildHeroCards(
  activities: MarketingBoostActivity[],
  inventory: StandardInventorySnapshot,
  movements: InventoryMovementRecord[],
  refundedOrderSkuKeys: Set<string>,
  productLibrarySnapshot?: ProductLibraryProductsSnapshot | null,
) {
  const bySku = new Map(inventory.skus.map((sku) => [sku.skuKey, sku]))
  const productLibraryBySku = new Map(
    (productLibrarySnapshot?.items ?? [])
      .filter((item) => item.primary_sku_key)
      .map((item) => [item.primary_sku_key as string, item]),
  )
  const productLibraryByPn = new Map(
    (productLibrarySnapshot?.items ?? [])
      .filter((item) => item.pn_mtm)
      .map((item) => [normalizeText(item.pn_mtm), item]),
  )
  const activityBySku = new Map<string, MarketingBoostActivity[]>()
  const activityByPn = new Map<string, MarketingBoostActivity[]>()
  for (const activity of activities) {
    if (activity.skuKey) {
      const rows = activityBySku.get(activity.skuKey) ?? []
      rows.push(activity)
      activityBySku.set(activity.skuKey, rows)
    }
    const pn = normalizeText(activity.pnMtm)
    if (pn) {
      const rows = activityByPn.get(pn) ?? []
      rows.push(activity)
      activityByPn.set(pn, rows)
    }
  }

  return movements
    .filter((movement) => movement.movementType === 'sales_outbound')
    .flatMap((movement) => {
      const saleDate = getDatePart(movement.businessDate)
      if (!saleDate) return []
      const orderNumber = extractOrderNumber(movement.note, movement.documentNumber)
      if (isLocalPlaceholderOrder(orderNumber, movement.note)) return []
      if (isRefundedOrderSku(refundedOrderSkuKeys, orderNumber, movement.skuKey)) return []
      const candidateActivities = [
        ...(activityBySku.get(movement.skuKey) ?? []),
        ...(activityByPn.get(normalizeText(movement.pnMtm)) ?? []),
      ]
      const matchedActivities = Array.from(new Map(candidateActivities.map((activity) => [activity.id, activity])).values())
        .filter((activity) => saleDate >= activity.validFrom && saleDate <= activity.validTo)
      const sku = bySku.get(movement.skuKey)
      const productLibraryItem = productLibraryBySku.get(movement.skuKey)
        ?? productLibraryByPn.get(normalizeText(movement.pnMtm))
      return matchedActivities.map((activity) => {
        const quantity = Math.max(1, Math.abs(Number(movement.quantity) || 1))
        const inventoryAverageCost = sku?.salesCostPrice ?? sku?.agentPrice
        const estimatedMarketingSupportAmount = Number(((activity.boostAmount ?? 0) * quantity).toFixed(2))
        const poCostBasis = activity.poSalesPrice !== undefined && activity.boostAmount !== undefined
          ? activity.poSalesPrice - activity.boostAmount
          : undefined
        const estimatedCostGapAmount = inventoryAverageCost !== undefined && poCostBasis !== undefined
          ? Number((Math.max(0, inventoryAverageCost - poCostBasis) * quantity).toFixed(2))
          : 0
        const evidenceDate = activity.lockedDisplayDate || activity.activityDate
        return {
          id: `boost-${hashText([
            movement.id,
            movement.skuKey,
            saleDate,
            activity.activityCategory,
            activity.activityLabel,
            evidenceDate,
          ].join('|'))}`,
          activityId: activity.id,
          activityCategory: activity.activityCategory,
          activityLabel: activity.activityLabel,
          skuKey: movement.skuKey,
          productName: sku?.productName ?? movement.productName ?? activity.productName,
          pnMtm: sku?.pnMtm ?? movement.pnMtm ?? activity.pnMtm,
          spec: sku?.spec ?? movement.spec,
          category: sku?.category ?? productLibraryItem?.default_category ?? productLibraryItem?.source_category ?? productLibraryItem?.jd_subcategory,
          orderNumber,
          outboundDate: movement.businessDate,
          lockedDisplayDate: saleDate,
          outboundDocumentNumber: movement.documentNumber,
          outboundOperatorName: movement.operatorName,
          outboundStoreName: movement.storeName,
          serialNumbers: movement.serialNumber ? [movement.serialNumber] : [],
          quantity,
          physicalHoldStock: Number(sku?.physicalHoldStock ?? 0),
          inventoryAverageCost,
          poSalesPrice: activity.poSalesPrice,
          boostAmount: activity.boostAmount,
          educationDiscountAmount: activity.educationDiscountAmount,
          pickupPrice: activity.pickupPrice,
          estimatedMarketingSupportAmount,
          estimatedCostGapAmount,
          status: '待申请' as const,
          sourceFile: activity.sourceFile,
          evidenceImagePath: activity.evidenceImagePath,
          ruleText: `${activity.ruleText}；凭证日期固定为 ${saleDate}，后续活动更新不得回刷该销售记录`,
          historySource: 'auto_sales_outbound' as const,
        }
      })
    })
    .sort((left, right) => right.lockedDisplayDate.localeCompare(left.lockedDisplayDate) || right.estimatedCostGapAmount - left.estimatedCostGapAmount)
}

function buildSalesPoPolicyHeroCards(
  policies: Array<SalesPoPolicySnapshot & { sourceFile: string }>,
  inventory: StandardInventorySnapshot,
  movements: InventoryMovementRecord[],
  refundedOrderSkuKeys: Set<string>,
  productLibrarySnapshot?: ProductLibraryProductsSnapshot | null,
) {
  const bySku = new Map(inventory.skus.map((sku) => [sku.skuKey, sku]))
  const productLibraryBySku = new Map(
    (productLibrarySnapshot?.items ?? [])
      .filter((item) => item.primary_sku_key)
      .map((item) => [item.primary_sku_key as string, item]),
  )
  const productLibraryByPn = new Map(
    (productLibrarySnapshot?.items ?? [])
      .filter((item) => item.pn_mtm)
      .map((item) => [normalizeText(item.pn_mtm), item]),
  )
  const policyBySku = new Map<string, Array<SalesPoPolicyRecord & SalesPoPolicySnapshot & { sourceFile: string }>>()
  const policyByPn = new Map<string, Array<SalesPoPolicyRecord & SalesPoPolicySnapshot & { sourceFile: string }>>()
  for (const policy of policies.filter((item) => item.salesOnly !== false)) {
    for (const record of policy.records ?? []) {
      const row = {
        ...policy,
        ...record,
        records: undefined,
      }
      if (record.skuKey) {
        const rows = policyBySku.get(record.skuKey) ?? []
        rows.push(row)
        policyBySku.set(record.skuKey, rows)
      }
      const pn = normalizeText(record.pnMtm)
      if (pn) {
        const rows = policyByPn.get(pn) ?? []
        rows.push(row)
        policyByPn.set(pn, rows)
      }
    }
  }
  return movements
    .filter((movement) => movement.movementType === 'sales_outbound')
    .flatMap((movement) => {
      const saleDate = getDatePart(movement.businessDate)
      if (!saleDate) return []
      const orderNumber = extractOrderNumber(movement.note, movement.documentNumber)
      if (isLocalPlaceholderOrder(orderNumber, movement.note)) return []
      if (isRefundedOrderSku(refundedOrderSkuKeys, orderNumber, movement.skuKey)) return []
      const candidates = [
        ...(policyBySku.get(movement.skuKey) ?? []),
        ...(policyByPn.get(normalizeText(movement.pnMtm)) ?? []),
      ]
      const matchedPolicies = Array.from(new Map(candidates.map((policy) => [
        `${policy.policyName ?? 'sales-po'}::${policy.pnMtm}::${policy.validFrom}::${policy.validTo}`,
        policy,
      ])).values()).filter((policy) => saleDate >= policy.validFrom && saleDate <= policy.validTo)
      const sku = bySku.get(movement.skuKey)
      const productLibraryItem = productLibraryBySku.get(movement.skuKey)
        ?? productLibraryByPn.get(normalizeText(movement.pnMtm))
        ?? productLibraryByPn.get(normalizeText(matchedPolicies[0]?.pnMtm))
      return matchedPolicies.map((policy) => {
        const quantity = Math.max(1, Math.abs(Number(movement.quantity) || 1))
        const inventoryAverageCost = sku?.salesCostPrice ?? sku?.agentPrice
        const estimatedMarketingSupportAmount = Number((policy.boostAmount * quantity).toFixed(2))
        const estimatedCostGapAmount = estimatedMarketingSupportAmount
        const ruleText = [
          policy.ruleText || `${policy.policyName ?? '销售出库PO核算'}：${policy.productName}，联想结算价基准 ${policy.settlementPrice}，销售PO后返 ${policy.boostAmount}，有效期 ${policy.validFrom} 至 ${policy.validTo}`,
          `结算价不在本卡中代替每日群报价；每日群报价必须另行校验 PN/MTM 当日结算价是否已执行到 ${policy.settlementPrice}`,
          policy.customerReferencePrice !== undefined ? `政策表用户到手价 ${policy.customerReferencePrice} 仅作源表参考，不写入零售英雄卡` : undefined,
          policy.storeWelfareRate !== undefined ? `店面福利点 ${Number((policy.storeWelfareRate * 100).toFixed(2))}%` : undefined,
          `凭证日期固定为 ${saleDate}，后续活动更新不得回刷该销售记录`,
          '本规则只用于销售出库 PO 后返核算，不作为客户奖励或零售报价展示',
        ].filter(Boolean).join('；')
        return {
          id: `sales-po-${hashText([
            movement.id,
            movement.skuKey,
            normalizeText(policy.pnMtm),
            saleDate,
            policy.validFrom,
            policy.validTo,
          ].join('|'))}`,
          activityId: `sales-po-policy-${hashText([policy.sourceFile, policy.pnMtm, policy.validFrom, policy.validTo].join('|'))}`,
          activityCategory: 'po_boost' as const,
          activityLabel: '销售出库PO核算',
          skuKey: movement.skuKey,
          productName: sku?.productName ?? movement.productName ?? policy.productName,
          pnMtm: sku?.pnMtm ?? movement.pnMtm ?? policy.pnMtm,
          spec: sku?.spec ?? movement.spec ?? policy.spec,
          category: sku?.category ?? policy.category ?? productLibraryItem?.default_category ?? productLibraryItem?.source_category ?? productLibraryItem?.jd_subcategory,
          orderNumber,
          outboundDate: movement.businessDate,
          lockedDisplayDate: saleDate,
          outboundDocumentNumber: movement.documentNumber,
          outboundOperatorName: movement.operatorName,
          outboundStoreName: movement.storeName,
          serialNumbers: movement.serialNumber ? [movement.serialNumber] : [],
          quantity,
          physicalHoldStock: Number(sku?.physicalHoldStock ?? 0),
          inventoryAverageCost,
          poSalesPrice: policy.poSalesPrice,
          boostAmount: policy.boostAmount,
          estimatedMarketingSupportAmount,
          estimatedCostGapAmount,
          status: '待申请' as const,
          sourceFile: policy.sourceFile,
          ruleText,
          historySource: 'sales_po_policy' as const,
        }
      })
    })
}

function buildSalesPoSettlementValidations(
  policies: Array<SalesPoPolicySnapshot & { sourceFile: string }>,
  distributorSnapshot?: DistributorQuoteSnapshot | null,
): SalesPoSettlementValidation[] {
  const quoteByPn = new Map<string, DistributorQuote>()
  for (const quote of distributorSnapshot?.quotes ?? []) {
    const pn = normalizeText(quote.pnMtm)
    if (!pn || quote.pickupPrice === undefined) continue
    const existing = quoteByPn.get(pn)
    if (!existing || String(quote.quoteDate ?? '').localeCompare(String(existing.quoteDate ?? '')) >= 0) {
      quoteByPn.set(pn, quote)
    }
  }
  const rows: SalesPoSettlementValidation[] = []
  for (const policy of policies.filter((item) => item.salesOnly !== false)) {
    for (const record of policy.records ?? []) {
      const quote = quoteByPn.get(normalizeText(record.pnMtm))
      const quoteDate = quote?.quoteDate
      const distributorSettlementPrice = quote?.pickupPrice
      const common = {
        policyName: policy.policyName ?? '销售出库PO核算',
        pnMtm: record.pnMtm,
        productName: record.productName,
        expectedSettlementPrice: record.settlementPrice,
        quoteDate,
        quoteFile: quote?.sourceFile ?? distributorSnapshot?.quoteFile,
        distributorSettlementPrice,
      }
      if (!quote) {
        rows.push({
          ...common,
          status: 'missing_distributor_quote',
          message: `群报价未找到 PN/MTM ${record.pnMtm}，无法确认分销商是否执行联想结算价 ${record.settlementPrice}。`,
        })
        continue
      }
      if (!quoteDate || quoteDate < policy.validFrom) {
        rows.push({
          ...common,
          status: 'stale_quote_date',
          message: `群报价日期 ${quoteDate ?? '待补'} 早于政策生效日 ${policy.validFrom}，不能证明已执行新结算价 ${record.settlementPrice}。`,
        })
        continue
      }
      if (distributorSettlementPrice !== record.settlementPrice) {
        rows.push({
          ...common,
          status: 'price_mismatch',
          message: `群报价 ${distributorSettlementPrice} 与联想结算价 ${record.settlementPrice} 不一致，需复核分销商报价是否已按新结算价执行。`,
        })
        continue
      }
      rows.push({
        ...common,
        status: 'matched',
        message: `群报价日期 ${quoteDate} 已按 PN/MTM 命中，结算价 ${distributorSettlementPrice} 与政策一致。`,
      })
    }
  }
  return rows.sort((left, right) => (
    left.status.localeCompare(right.status)
    || left.pnMtm.localeCompare(right.pnMtm)
  ))
}

function getHeroCardAmountInfo(card: MarketingBoostHeroCard) {
  const educationDiscountAmount = Number(card.educationDiscountAmount ?? 0)
  if (educationDiscountAmount > 0) {
    return { amountField: 'educationDiscountAmount' as const, amount: educationDiscountAmount }
  }
  const boostAmount = Number(card.boostAmount ?? 0)
  if (boostAmount > 0) {
    return { amountField: 'boostAmount' as const, amount: boostAmount }
  }
  return undefined
}

function historyCardBaseKey(card: MarketingBoostHeroCard) {
  const productIdentity = card.skuKey
    ? `sku:${card.skuKey}`
    : card.pnMtm
      ? `pn:${normalizeText(card.pnMtm).toUpperCase()}`
      : `name:${normalizeText(card.productName).toUpperCase()}`
  const orderNumber = normalizeText(card.orderNumber) || normalizeText(card.outboundDocumentNumber) || '待补'
  const businessDate = normalizeText((card.lockedDisplayDate || card.outboundDate || '').slice(0, 10)) || 'date:pending'
  return [
    orderNumber,
    productIdentity,
    businessDate,
  ].join('|')
}

function historyCardBusinessKey(card: MarketingBoostHeroCard) {
  const serialKey = normalizeSerialNumbers(card.serialNumbers)
  return `${historyCardBaseKey(card)}|serial:${serialKey.length > 0 ? serialKey.join(',') : 'none'}`
}

function heroCardsShouldMerge(left: MarketingBoostHeroCard, right: MarketingBoostHeroCard) {
  if (historyCardBaseKey(left) !== historyCardBaseKey(right)) return false
  const leftSerials = normalizeSerialNumbers(left.serialNumbers)
  const rightSerials = normalizeSerialNumbers(right.serialNumbers)
  if (leftSerials.length === 0 || rightSerials.length === 0) return true
  return leftSerials.some((serial) => rightSerials.includes(serial))
}

function choosePreferredHeroCard(left: MarketingBoostHeroCard, right: MarketingBoostHeroCard) {
  const leftScore = (
    normalizeSerialNumbers(left.serialNumbers).length * 10
    + (left.paymentReceived ? 5 : 0)
    + (left.outboundStoreName ? 2 : 0)
    + (left.outboundOperatorName ? 2 : 0)
    + (left.evidenceImagePath ? 1 : 0)
    + (left.sourceFile ? 1 : 0)
  )
  const rightScore = (
    normalizeSerialNumbers(right.serialNumbers).length * 10
    + (right.paymentReceived ? 5 : 0)
    + (right.outboundStoreName ? 2 : 0)
    + (right.outboundOperatorName ? 2 : 0)
    + (right.evidenceImagePath ? 1 : 0)
    + (right.sourceFile ? 1 : 0)
  )
  if (rightScore > leftScore) return right
  if (leftScore > rightScore) return left
  return right.outboundDate.localeCompare(left.outboundDate) >= 0 ? right : left
}

function mergeHeroCards(left: MarketingBoostHeroCard, right: MarketingBoostHeroCard): MarketingBoostHeroCard {
  const preferred = choosePreferredHeroCard(left, right)
  const fallback = preferred === left ? right : left
  return {
    ...fallback,
    ...preferred,
    id: preferred.id || fallback.id,
    activityId: preferred.activityId || fallback.activityId,
    serialNumbers: normalizeSerialNumbers([...normalizeSerialNumbers(left.serialNumbers), ...normalizeSerialNumbers(right.serialNumbers)]),
    poSalesPrice: preferred.poSalesPrice ?? fallback.poSalesPrice,
    boostAmount: Math.max(Number(preferred.boostAmount ?? 0), Number(fallback.boostAmount ?? 0)) || undefined,
    educationDiscountAmount: Math.max(Number(preferred.educationDiscountAmount ?? 0), Number(fallback.educationDiscountAmount ?? 0)) || undefined,
    pickupPrice: preferred.pickupPrice ?? fallback.pickupPrice,
    inventoryAverageCost: preferred.inventoryAverageCost ?? fallback.inventoryAverageCost,
    estimatedMarketingSupportAmount: Math.max(preferred.estimatedMarketingSupportAmount ?? 0, fallback.estimatedMarketingSupportAmount ?? 0),
    estimatedCostGapAmount: Math.max(preferred.estimatedCostGapAmount ?? 0, fallback.estimatedCostGapAmount ?? 0),
    sourceFile: preferred.sourceFile ?? fallback.sourceFile,
    evidenceImagePath: preferred.evidenceImagePath ?? fallback.evidenceImagePath,
    ruleText: dedupeTextFragments(left.ruleText, right.ruleText),
    outboundDate: preferred.outboundDate || fallback.outboundDate,
    lockedDisplayDate: preferred.lockedDisplayDate || fallback.lockedDisplayDate,
    outboundDocumentNumber: preferred.outboundDocumentNumber ?? fallback.outboundDocumentNumber,
    outboundOperatorName: preferred.outboundOperatorName ?? fallback.outboundOperatorName,
    outboundStoreName: preferred.outboundStoreName ?? fallback.outboundStoreName,
    paymentReceived: preferred.paymentReceived ?? fallback.paymentReceived,
    paymentReceivedAt: preferred.paymentReceivedAt ?? fallback.paymentReceivedAt,
    paymentReceivedNote: preferred.paymentReceivedNote ?? fallback.paymentReceivedNote,
    status: preferred.status ?? fallback.status,
    historySource: preferred.historySource ?? fallback.historySource,
  }
}

function dedupeHeroCards(cards: MarketingBoostHeroCard[]) {
  const buckets = new Map<string, MarketingBoostHeroCard[]>()
  for (const card of cards) {
    const baseKey = historyCardBaseKey(card)
    const rows = buckets.get(baseKey) ?? []
    const existingIndex = rows.findIndex((item) => heroCardsShouldMerge(item, card))
    if (existingIndex >= 0) {
      rows[existingIndex] = mergeHeroCards(rows[existingIndex], card)
    } else {
      rows.push(card)
    }
    buckets.set(baseKey, rows)
  }
  return Array.from(buckets.values()).flat().sort((left, right) => (
    right.lockedDisplayDate.localeCompare(left.lockedDisplayDate)
    || right.outboundDate.localeCompare(left.outboundDate)
    || left.productName.localeCompare(right.productName, 'zh-CN')
  ))
}

function normalizeHeroCardRuleTexts(cards: MarketingBoostHeroCard[]) {
  return cards.map((card) => ({
    ...card,
    ruleText: dedupeTextFragments(card.ruleText),
  }))
}

function buildDuplicateSubsidyAudit(cards: MarketingBoostHeroCard[]): DuplicateSubsidyAuditSnapshot {
  const groups = new Map<string, MarketingBoostHeroCard[]>()
  for (const card of cards) {
    const amountInfo = getHeroCardAmountInfo(card)
    if (!amountInfo) continue
    const key = historyCardBaseKey(card)
    const rows = groups.get(key) ?? []
    rows.push(card)
    groups.set(key, rows)
  }
  const duplicates = Array.from(groups.entries())
    .map(([key, rows]) => {
      const suspectedRows = rows.filter((row, index) => rows.findIndex((candidate) => heroCardsShouldMerge(candidate, row)) !== index)
      return { key, rows: suspectedRows }
    })
    .filter((entry) => entry.rows.length > 1)
    .map(({ key, rows }) => {
      const first = rows[0]
      const amountInfo = getHeroCardAmountInfo(first)!
      return {
        key,
        activityCategory: first.activityCategory,
        orderNumber: first.orderNumber,
        skuKey: first.skuKey,
        pnMtm: first.pnMtm,
        productName: first.productName,
        duplicateCount: rows.length,
        amountField: amountInfo.amountField,
        amount: amountInfo.amount,
        outboundDate: first.outboundDate,
        cardIds: rows.map((item) => item.id),
        serialNumberSets: rows.map((item) => normalizeSerialNumbers(item.serialNumbers)),
      }
    })
    .sort((left, right) => right.duplicateCount - left.duplicateCount || right.orderNumber.localeCompare(left.orderNumber))
  return {
    generatedAt: new Date().toISOString(),
    source: 'marketing_boost_duplicate_subsidy_audit',
    summary: {
      duplicateGroupCount: duplicates.length,
      duplicateCardCount: duplicates.reduce((sum, item) => sum + item.duplicateCount, 0),
    },
    duplicates,
  }
}

function mergeFrozenHistoryCards(
  previous: MarketingBoostHeroCard[],
  current: MarketingBoostHeroCard[],
  refundedOrderSkuKeys: Set<string>,
) {
  const buckets = new Map<string, MarketingBoostHeroCard[]>()
  for (const card of previous) {
    if (isLocalPlaceholderOrder(card.orderNumber, `${card.outboundDocumentNumber ?? ''} ${card.ruleText ?? ''}`)) continue
    if (isRefundedOrderSku(refundedOrderSkuKeys, card.orderNumber, card.skuKey)) continue
    const baseKey = historyCardBaseKey(card)
    const rows = buckets.get(baseKey) ?? []
    const existingIndex = rows.findIndex((item) => heroCardsShouldMerge(item, card))
    if (existingIndex >= 0) {
      rows[existingIndex] = mergeHeroCards(rows[existingIndex], card)
    } else {
      rows.push(card)
    }
    buckets.set(baseKey, rows)
  }
  for (const card of current) {
    if (isLocalPlaceholderOrder(card.orderNumber, `${card.outboundDocumentNumber ?? ''} ${card.ruleText ?? ''}`)) continue
    if (isRefundedOrderSku(refundedOrderSkuKeys, card.orderNumber, card.skuKey)) continue
    const baseKey = historyCardBaseKey(card)
    const rows = buckets.get(baseKey) ?? []
    const existingIndex = rows.findIndex((item) => heroCardsShouldMerge(item, card))
    if (existingIndex >= 0) {
      rows[existingIndex] = mergeHeroCards(rows[existingIndex], card)
    } else {
      rows.push(card)
    }
    buckets.set(baseKey, rows)
  }
  return Array.from(buckets.values()).flat().sort((left, right) => (
    right.lockedDisplayDate.localeCompare(left.lockedDisplayDate)
    || right.outboundDate.localeCompare(left.outboundDate)
    || left.productName.localeCompare(right.productName, 'zh-CN')
  ))
}

function frozenHistoryRecordKey(card: MarketingBoostHeroCard) {
  return [
    normalizeText(card.id) || 'id:pending',
    historyCardBusinessKey(card),
    normalizeText(card.activityCategory) || 'category:pending',
    normalizeText(card.activityId) || 'activity:pending',
    String(Number(card.boostAmount ?? 0)),
    String(Number(card.educationDiscountAmount ?? 0)),
  ].join('|')
}

function mergeFrozenHistoryRecordsAppendOnly(
  previous: MarketingBoostHeroCard[],
  current: MarketingBoostHeroCard[],
  refundedOrderSkuKeys: Set<string>,
) {
  const map = new Map<string, MarketingBoostHeroCard>()
  for (const card of previous) {
    if (isLocalPlaceholderOrder(card.orderNumber, `${card.outboundDocumentNumber ?? ''} ${card.ruleText ?? ''}`)) continue
    if (isRefundedOrderSku(refundedOrderSkuKeys, card.orderNumber, card.skuKey)) continue
    map.set(frozenHistoryRecordKey(card), card)
  }
  for (const card of current) {
    if (isLocalPlaceholderOrder(card.orderNumber, `${card.outboundDocumentNumber ?? ''} ${card.ruleText ?? ''}`)) continue
    if (isRefundedOrderSku(refundedOrderSkuKeys, card.orderNumber, card.skuKey)) continue
    const key = frozenHistoryRecordKey(card)
    const existing = map.get(key)
    map.set(key, existing ? mergeHeroCards(existing, card) : card)
  }
  return Array.from(map.values()).sort((left, right) => (
    right.lockedDisplayDate.localeCompare(left.lockedDisplayDate)
    || right.outboundDate.localeCompare(left.outboundDate)
    || left.productName.localeCompare(right.productName, 'zh-CN')
  ))
}

function propagateMarketingBoostAcrossHistoryRows(cards: MarketingBoostHeroCard[]) {
  const byBaseKey = new Map<string, MarketingBoostHeroCard[]>()
  for (const card of cards) {
    const key = historyCardBaseKey(card)
    const rows = byBaseKey.get(key) ?? []
    rows.push(card)
    byBaseKey.set(key, rows)
  }
  return cards.map((card) => {
    const siblingWithBoost = (byBaseKey.get(historyCardBaseKey(card)) ?? [])
      .filter((item) => Number(item.boostAmount ?? 0) > 0)
      .sort((left, right) => Number(right.boostAmount ?? 0) - Number(left.boostAmount ?? 0))[0]
    if (!siblingWithBoost || Number(card.boostAmount ?? 0) > 0) return card
    return {
      ...card,
      poSalesPrice: card.poSalesPrice ?? siblingWithBoost.poSalesPrice,
      boostAmount: siblingWithBoost.boostAmount,
      estimatedMarketingSupportAmount: Math.max(
        Number(card.estimatedMarketingSupportAmount ?? 0),
        Number(siblingWithBoost.estimatedMarketingSupportAmount ?? 0),
      ),
      estimatedCostGapAmount: Math.max(
        Number(card.estimatedCostGapAmount ?? 0),
        Number(siblingWithBoost.estimatedCostGapAmount ?? 0),
      ),
      ruleText: dedupeTextFragments(card.ruleText, siblingWithBoost.ruleText),
    }
  })
}

function applyEducationAgentScanOverrides(
  cards: MarketingBoostHeroCard[],
  agentRows: Array<{
    orderNumber?: string
    skuKey?: string
    serialNumbers?: string[]
    educationDiscountAmount?: number
    sourceGroupName?: string
    collectionSource?: string
  }>,
) {
  const byOrderSku = new Map<string, Array<{
    orderNumber?: string
    skuKey?: string
    serialNumbers?: string[]
    educationDiscountAmount?: number
    sourceGroupName?: string
    collectionSource?: string
  }>>()
  for (const row of agentRows ?? []) {
    const orderNumber = normalizeText(row.orderNumber)
    const skuKey = normalizeText(row.skuKey)
    if (!orderNumber || !skuKey) continue
    const key = `${orderNumber}::${skuKey}`
    const rows = byOrderSku.get(key) ?? []
    rows.push(row)
    byOrderSku.set(key, rows)
  }
  for (const card of cards) {
    const key = `${normalizeText(card.orderNumber)}::${normalizeText(card.skuKey)}`
    const matches = byOrderSku.get(key)
    if (!matches?.length) continue
    const cardSerials = normalizeSerialNumbers(card.serialNumbers)
    const matched = matches.find((item) => {
      const rowSerials = normalizeSerialNumbers(item.serialNumbers ?? [])
      if (cardSerials.length === 0 || rowSerials.length === 0) return true
      return cardSerials.some((serial) => rowSerials.includes(serial))
    }) ?? matches[0]
    const educationAmount = Number(matched.educationDiscountAmount ?? 0)
    if (!Number.isFinite(educationAmount) || educationAmount <= 0) continue
    card.educationDiscountAmount = educationAmount
    if (card.activityCategory !== 'education_discount') {
      card.activityCategory = 'education_discount'
      card.activityLabel = '教育补贴'
    }
    const sourceNote = `教育补代扫优先金额：${educationAmount.toFixed(2)}（${matched.sourceGroupName || matched.collectionSource || '未标注来源'}）`
    if (!card.ruleText.includes(sourceNote)) {
      card.ruleText = dedupeTextFragments(card.ruleText, sourceNote)
    }
  }
}

async function buildMarketingBoostSnapshotData() {
  const [distributorSnapshot, inventory, movementsSnapshot, manualActivities, manualHistoryCards, salesPoPolicies, productLibrarySnapshot] = await Promise.all([
    readJsonIfExists<DistributorQuoteSnapshot>(artifactPath('latest-distributor-quotes.json')),
    readJsonIfExists<StandardInventorySnapshot>(artifactPath('latest-adjusted-inventory-snapshot.json'))
      .then((data) => data ?? readJsonIfExists<StandardInventorySnapshot>(artifactPath('latest-standard-inventory-snapshot.json'))),
    readJsonIfExists<InventoryMovementsSnapshot>(artifactPath('latest-inventory-movements.json')),
    loadManualActivities(),
    loadManualHistoryCards(),
    loadSalesPoPolicies(),
    readJsonIfExists<ProductLibraryProductsSnapshot>(webDataPath('latest-product-library-products.json')),
  ])
  if (!inventory) throw new Error('缺少库存快照，无法生成营销加磅产品库。')
  const movements = movementsSnapshot?.records ?? []
  const refundedOrderSkuKeys = buildRefundedOrderSkuKeys(movements)
  const distributorActivities = (distributorSnapshot?.quotes ?? []).flatMap((quote) => {
    const activity = buildActivityFromQuote(quote)
    return activity ? [activity] : []
  })
  const allActivities = dedupeActivities(
    enrichActivitiesWithInventory(
      [...distributorActivities, ...manualActivities],
      inventory,
      productLibrarySnapshot?.items ?? [],
    ),
  )
  const today = getBeijingDateString()
  const activities = allActivities.filter((activity) => isActivityActiveOnDate(activity, today))
  const eligibleInventory = buildEligibleInventory(activities, [inventory])
  const autoHeroCards = buildHeroCards(allActivities, inventory, movements, refundedOrderSkuKeys, productLibrarySnapshot)
  const salesPoHeroCards = buildSalesPoPolicyHeroCards(salesPoPolicies, inventory, movements, refundedOrderSkuKeys, productLibrarySnapshot)
  const salesPoSettlementValidations = buildSalesPoSettlementValidations(salesPoPolicies, distributorSnapshot)
  const preDedupeHistory = [...autoHeroCards, ...salesPoHeroCards, ...manualHistoryCards]
    .filter((item) => !isRefundedOrderSku(refundedOrderSkuKeys, item.orderNumber, item.skuKey))
  const duplicateSubsidyAudit = buildDuplicateSubsidyAudit(preDedupeHistory)
  const heroCards = normalizeHeroCardRuleTexts(dedupeHeroCards([...autoHeroCards, ...salesPoHeroCards]))
  const history = normalizeHeroCardRuleTexts(dedupeHeroCards([...heroCards, ...manualHistoryCards]))
    .filter((item) => !isRefundedOrderSku(refundedOrderSkuKeys, item.orderNumber, item.skuKey))
    .sort((left, right) => (
      right.lockedDisplayDate.localeCompare(left.lockedDisplayDate)
      || right.outboundDate.localeCompare(left.outboundDate)
      || left.productName.localeCompare(right.productName, 'zh-CN')
    ))
  const unmatchedProductLibrary = activities.filter((activity) => activity.matchStatus === 'unmatched')
  const productLibraryOnlyCount = activities.filter((activity) => activity.matchStatus === 'product_library_only').length
  const snapshot: MarketingBoostSnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'marketing_boost_activity',
    quoteDate: distributorSnapshot?.quoteDate,
    ruleVersion: marketingBoostRuleVersion,
    ruleSourceTitle: marketingBoostRuleSourceTitle,
    ruleSourceLink: marketingBoostRuleSourceLink,
    ruleSourceFileId: marketingBoostRuleSourceFileId,
    ruleSourceFile: activities.find((item) => item.sourceFile)?.sourceFile,
    summary: {
      activityCount: activities.length,
      distributorRemarkActivityCount: distributorActivities.length,
      manualUploadActivityCount: manualActivities.length,
      eligibleInventoryCount: eligibleInventory.length,
      heroCardCount: heroCards.length,
      historyCount: history.length,
      productLibraryOnlyCount,
      unmatchedActivityCount: unmatchedProductLibrary.length,
      activityHistoryCount: allActivities.length,
      totalEstimatedMarketingSupportAmount: Number(heroCards.reduce((sum, item) => sum + item.estimatedMarketingSupportAmount, 0).toFixed(2)),
      totalEstimatedCostGapAmount: Number(heroCards.reduce((sum, item) => sum + item.estimatedCostGapAmount, 0).toFixed(2)),
      categoryBreakdown: Array.from(activities.reduce((map, activity) => {
        const current = map.get(activity.activityCategory) ?? {
          category: activity.activityCategory,
          label: activity.activityLabel,
          count: 0,
        }
        current.count += 1
        map.set(activity.activityCategory, current)
        return map
      }, new Map<MarketingBoostActivity['activityCategory'], { category: MarketingBoostActivity['activityCategory']; label: string; count: number }>()).values())
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN')),
    },
    activities,
    activityHistory: allActivities,
    eligibleInventory,
    heroCards,
    history,
    unmatchedProductLibrary,
    salesPoSettlementValidations,
  }
  return { snapshot, refundedOrderSkuKeys, duplicateSubsidyAudit }
}

export async function buildMarketingBoostSnapshot(): Promise<MarketingBoostSnapshot> {
  return (await buildMarketingBoostSnapshotData()).snapshot
}

export async function saveMarketingBoostSnapshot() {
  const { snapshot, refundedOrderSkuKeys, duplicateSubsidyAudit } = await buildMarketingBoostSnapshotData()
  const educationAgentScan = await saveEducationSubsidyAgentScanSnapshot(snapshot)
  const artifact = artifactPath('latest-marketing-boost-snapshot.json')
  const web = webDataPath('latest-marketing-boost-snapshot.json')
  const heroArtifact = artifactPath('latest-marketing-boost-hero-snapshot.json')
  const webHero = webDataPath('latest-marketing-boost-hero-snapshot.json')
  const historyArtifact = artifactPath(marketingBoostHistoryFileName)
  const webHistory = webDataPath(marketingBoostHistoryFileName)
  const duplicateAuditArtifact = artifactPath('latest-marketing-boost-duplicate-subsidy-audit.json')
  const duplicateAuditWeb = webDataPath('latest-marketing-boost-duplicate-subsidy-audit.json')
  const previousHistory = await readJsonIfExists<MarketingBoostHistorySnapshot>(historyArtifact)
  const today = getBeijingDateString()
  if ((previousHistory?.activities?.length ?? 0) > 0) {
    const historicalActiveActivities = (previousHistory?.activities ?? []).filter((activity) => isActivityActiveOnDate(activity, today))
    if (historicalActiveActivities.length > 0) {
      // 修正 2026-06-08:merge 后立刻按政策签名 (pnMtm/skuKey/productName + activityCategory + validFrom) 去重, 同政策取 validTo 较小者
      const policyKey = (a: MarketingBoostActivity) => [a.pnMtm || a.skuKey || a.productName || "", a.activityCategory, a.validFrom].join("|")
      const dedupedSnapshot = new Map<string, MarketingBoostActivity>()
      for (const item of [...snapshot.activities, ...historicalActiveActivities]) {
        const k = policyKey(item)
        const existing = dedupedSnapshot.get(k)
        if (!existing || item.validTo < existing.validTo) dedupedSnapshot.set(k, item)
      }
      snapshot.activityHistory = dedupeActivities([...snapshot.activityHistory, ...(previousHistory?.activities ?? [])])
      snapshot.unmatchedProductLibrary = snapshot.activities.filter((activity) => activity.matchStatus === 'unmatched')
      snapshot.summary.activityCount = snapshot.activities.length
      snapshot.summary.unmatchedActivityCount = snapshot.unmatchedProductLibrary.length
      snapshot.summary.productLibraryOnlyCount = snapshot.activities.filter((activity) => activity.matchStatus === 'product_library_only').length
      snapshot.summary.activityHistoryCount = snapshot.activityHistory.length
      snapshot.summary.categoryBreakdown = Array.from(snapshot.activities.reduce((map, activity) => {
        const current = map.get(activity.activityCategory) ?? {
          category: activity.activityCategory,
          label: activity.activityLabel,
          count: 0,
        }
        current.count += 1
        map.set(activity.activityCategory, current)
        return map
      }, new Map<MarketingBoostActivity['activityCategory'], { category: MarketingBoostActivity['activityCategory']; label: string; count: number }>()).values())
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
    }
  }
  // Guardrail: if this round yields zero activities (usually source remark/input gap),
  // keep the last known activity library from history instead of hard-clearing frontend tabs.
  if ((snapshot.activities?.length ?? 0) === 0 && (previousHistory?.activities?.length ?? 0) > 0) {
    const fallbackActivities = dedupeActivities(previousHistory?.activities ?? [])
    const fallbackInventory = await readJsonIfExists<StandardInventorySnapshot>(artifactPath('latest-adjusted-inventory-snapshot.json'))
      .then((data) => data ?? readJsonIfExists<StandardInventorySnapshot>(artifactPath('latest-standard-inventory-snapshot.json')))
    snapshot.activities = fallbackActivities
    snapshot.activityHistory = fallbackActivities
    snapshot.eligibleInventory = fallbackInventory ? buildEligibleInventory(fallbackActivities, [fallbackInventory]) : []
    snapshot.unmatchedProductLibrary = fallbackActivities.filter((activity) => activity.matchStatus === 'unmatched')
    snapshot.summary.activityCount = fallbackActivities.length
    snapshot.summary.distributorRemarkActivityCount = fallbackActivities.filter((activity) => activity.sourceType === 'distributor_remark').length
    snapshot.summary.manualUploadActivityCount = fallbackActivities.filter((activity) => activity.sourceType !== 'distributor_remark').length
    snapshot.summary.eligibleInventoryCount = snapshot.eligibleInventory.length
    snapshot.summary.unmatchedActivityCount = snapshot.unmatchedProductLibrary.length
    snapshot.summary.productLibraryOnlyCount = fallbackActivities.filter((activity) => activity.matchStatus === 'product_library_only').length
    snapshot.summary.activityHistoryCount = fallbackActivities.length
    snapshot.summary.categoryBreakdown = Array.from(fallbackActivities.reduce((map, activity) => {
      const current = map.get(activity.activityCategory) ?? {
        category: activity.activityCategory,
        label: activity.activityLabel,
        count: 0,
      }
      current.count += 1
      map.set(activity.activityCategory, current)
      return map
    }, new Map<MarketingBoostActivity['activityCategory'], { category: MarketingBoostActivity['activityCategory']; label: string; count: number }>()).values())
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
  }
  const activityHistory = mergeActivityHistory(previousHistory?.activities ?? [], snapshot.activities)
  const frozenAutoHistory = normalizeHeroCardRuleTexts(mergeFrozenHistoryRecordsAppendOnly(
    previousHistory?.cards ?? [],
    snapshot.history.filter((item) => item.historySource === 'auto_sales_outbound' || item.historySource === 'sales_po_policy'),
    refundedOrderSkuKeys,
  ))
  const mergedHistory = normalizeHeroCardRuleTexts([...frozenAutoHistory, ...snapshot.history.filter((item) => item.historySource !== 'auto_sales_outbound' && item.historySource !== 'sales_po_policy')])
    .sort((left, right) => (
      right.lockedDisplayDate.localeCompare(left.lockedDisplayDate)
      || right.outboundDate.localeCompare(left.outboundDate)
      || left.productName.localeCompare(right.productName, 'zh-CN')
    ))
  snapshot.activityHistory = activityHistory
  snapshot.history = propagateMarketingBoostAcrossHistoryRows(mergedHistory)
  // 活动库按业务语义做“只增不减”保护,避免误覆盖导致历史活动突然消失。
  // 修正 2026-06-08:同 PN 同 validFrom 的“政策缩短/收窄”不再回填——以“政策签名”识别同一政策的多次有效化,取 validTo 较小者。
  if ((previousHistory?.activities?.length ?? 0) > snapshot.activities.length) {
    const previousActive = previousHistory?.activities ?? []
    console.log(`[GUARD] previousActive=${previousActive.length} snapshot.activities=${snapshot.activities.length}`)
    // 政策签名不包含 activityDate:同 PN 同 validFrom 视为同政策 (新源 vs history frozen 同一政策的多次有效化)
    const policySignature = (a: MarketingBoostActivity) => [
      a.pnMtm || a.skuKey || a.productName || "",
      a.activityCategory,
      a.validFrom,
    ].join("|")
    const currentByPolicy = new Map<string, MarketingBoostActivity>()
    for (const item of snapshot.activities) {
      const sig = policySignature(item)
      const existing = currentByPolicy.get(sig)
      if (!existing || item.validTo < existing.validTo) {
        currentByPolicy.set(sig, item)
      }
    }
    let _skip=0, _push=0, _sameid=0
    for (const item of previousActive) {
      const sig = policySignature(item)
      const newer = currentByPolicy.get(sig)
      if (newer && newer.validTo < item.validTo) {
        // 已有 validTo 较短的同政策,旧的长 validTo 政策被收窄了,不回填
        if (item.pnMtm === "83F300AXCD" || item.pnMtm === "83QF0002CD") console.log(`[GUARD-SKIP] ${item.pnMtm} sig=${sig} newer.id=${newer.id} newer.vt=${newer.validTo} item.vt=${item.validTo}`)
        _skip++
        continue
      }
      if (newer && newer.id === item.id) { _sameid++; continue }
      if (item.pnMtm === "83F300AXCD" || item.pnMtm === "83QF0002CD") console.log(`[GUARD-PUSH] ${item.pnMtm} sig=${sig} newer.id=${newer?.id} newer.vt=${newer?.validTo} item.vt=${item.validTo}`)
      // 旧活动 id 不同但同政策且 current 没有——保留历史(append-only)
      snapshot.activities.push(item)
      _push++
    }
    console.log(`[GUARD-STATS] skip=${_skip} sameid=${_sameid} push=${_push}`)
  }
  // Guardrail: history is append-only in business semantics. Never shrink below previous recovered baseline.
  if ((previousHistory?.cards?.length ?? 0) > snapshot.history.length) {
    snapshot.history = propagateMarketingBoostAcrossHistoryRows(normalizeHeroCardRuleTexts(mergeFrozenHistoryRecordsAppendOnly(
      previousHistory?.cards ?? [],
      snapshot.history,
      refundedOrderSkuKeys,
    )))
  }
  snapshot.summary.activityHistoryCount = activityHistory.length
  snapshot.summary.historyCount = snapshot.history.length
  applyEducationAgentScanOverrides(snapshot.history, educationAgentScan.snapshot.rows ?? [])
  applyEducationAgentScanOverrides(mergedHistory, educationAgentScan.snapshot.rows ?? [])
  const historySnapshot: MarketingBoostHistorySnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'marketing_boost_activity_history',
    ruleVersion: snapshot.ruleVersion,
    ruleSourceTitle: snapshot.ruleSourceTitle,
    ruleSourceLink: snapshot.ruleSourceLink,
    ruleSourceFileId: snapshot.ruleSourceFileId,
    ruleSourceFile: snapshot.ruleSourceFile,
    activities: activityHistory,
    cards: snapshot.history,
  }
  const heroSnapshot: MarketingBoostSnapshot = {
    ...snapshot,
    activities: [],
    activityHistory: [],
    history: [],
    unmatchedProductLibrary: [],
  }
  await Promise.all([
    fs.mkdir(path.dirname(artifact), { recursive: true }),
    fs.mkdir(path.dirname(web), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifact, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(web, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(heroArtifact, `${JSON.stringify(heroSnapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webHero, `${JSON.stringify(heroSnapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(historyArtifact, `${JSON.stringify(historySnapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webHistory, `${JSON.stringify(historySnapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(duplicateAuditArtifact, `${JSON.stringify(duplicateSubsidyAudit, null, 2)}\n`, 'utf-8'),
    fs.writeFile(duplicateAuditWeb, `${JSON.stringify(duplicateSubsidyAudit, null, 2)}\n`, 'utf-8'),
  ])
  return {
    snapshot,
    artifactPath: artifact,
    webPath: web,
    historyArtifactPath: historyArtifact,
    webHistoryPath: webHistory,
    duplicateAuditArtifactPath: duplicateAuditArtifact,
    duplicateAuditWebPath: duplicateAuditWeb,
    educationAgentScan,
  }
}
