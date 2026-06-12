import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { loadInventoryMovements, type InventoryMovementRecord } from '../inventoryQuote/dataService.js'
import type { MarketingBoostHeroCard, MarketingBoostSnapshot } from './marketingBoostStore.js'

export type EducationSubsidyAgentScanRow = {
  id: string
  sourceType: 'wechat_group_manual' | 'xhey_api_manual' | 'watermark_camera_manual'
  sourceGroupName: string
  collectionSource: string
  sourceFile?: string
  scanDate: string
  lockedDisplayDate: string
  productName: string
  sourceSkuKey?: string
  sourcePnMtm?: string
  skuKey?: string
  pnMtm?: string
  spec?: string
  category?: string
  quantity: number
  educationDiscountAmount: number
  scannedEducationDiscountAmount?: number
  totalEducationDiscountAmount: number
  serviceFeePerUnit: number
  totalServiceFee: number
  orderNumber?: string
  outboundDate?: string
  outboundStoreName?: string
  outboundOperatorName?: string
  outboundMatchSource?: 'sql_inventory_movements' | 'marketing_boost_history' | 'manual_record'
  matchedOutboundMovementId?: string
  matchedOutboundOrderId?: string
  matchedSalesOrderId?: string
  matchedOutboundSkuKey?: string
  matchedOutboundPnMtm?: string
  serialNumbers: string[]
  paymentReceived?: boolean
  paymentReceivedAt?: string
  paymentReceivedNote?: string
  status: '待出库同步' | '未付' | '已付'
  activityLabel?: string
  ruleText?: string
  customerName?: string
  customerPhone?: string
  agentPhone?: string
  modelText?: string
  voucherCode?: string
  voucherVerifiedAt?: string
  reportStatus?: string
  serviceRuleKey?: string
  serviceRuleLabel?: string
  zhixiangjinAmount?: number
  bundleGroupId?: string
  bundleMatchedOrderNumber?: string
  bundleMatchedPnMtms?: string[]
  bundleMatchedProductTypes?: string[]
  bundleChargeApplied?: boolean
  bundleTotalServiceFee?: number
  bundleTotalZhixiangjinAmount?: number
}

export type EducationAgentBundleOrderAudit = {
  orderNumber: string
  businessDate: string
  orderStatusName: string
  customerName: string
  storeName: string
  truthRuleKey: 'three_piece_bundle' | 'two_piece_bundle' | 'legion_dual_screen_combo'
  truthRuleLabel: string
  truthProductTypes: string[]
  truthPnMtms: string[]
  truthSerialNumbers: string[]
  truthProducts: Array<{
    skuKey: string
    productName: string
    pnMtm: string
    spec: string
    productType: string
    serialNumbers: string[]
  }>
  currentRowCount: number
  currentRuleKeys: string[]
  currentPhones: string[]
  currentVoucherMissingCount: number
  currentVerificationMissingCount: number
  auditStatus: 'ok' | 'missing_agent_scan' | 'rule_mismatch' | 'verification_gap'
  message: string
}

export type EducationSubsidyAgentScanSnapshot = {
  generatedAt: string
  source: 'education_subsidy_agent_scan_summary'
  sourceGroupName: string
  sourceGroupNames: string[]
  summary: {
    totalCount: number
    pendingOutboundCount: number
    unpaidCount: number
    paidCount: number
    matchedOutboundCount: number
    totalEducationDiscountAmount: number
    totalServiceFee: number
    unpaidServiceFee: number
    phoneMismatchCount: number
  }
  groupSummaries: Array<{
    sourceGroupName: string
    collectionSource: string
    serviceFeePerUnit: number
    totalCount: number
    pendingOutboundCount: number
    unpaidCount: number
    paidCount: number
    matchedOutboundCount: number
    totalEducationDiscountAmount: number
    totalServiceFee: number
    unpaidServiceFee: number
  }>
  bundleSummary?: EducationAgentBundleSummary
  bundleOrderAuditSummary?: {
    truthOrderCount: number
    truthThreePieceCount: number
    truthTwoPieceCount: number
    truthLegionCount: number
    okCount: number
    missingAgentScanCount: number
    ruleMismatchCount: number
    verificationGapCount: number
  }
  bundleOrderAudit?: EducationAgentBundleOrderAudit[]
  rows: EducationSubsidyAgentScanRow[]
  phoneMismatchAlerts?: Array<{
    id: string
    orderNumber?: string
    serialNumber?: string
    sourceGroupName?: string
    customerName?: string
    customerPhone?: string
    agentPhone?: string
    message: string
  }>
}

type ManualEducationSubsidyAgentScanRecord = {
  id?: string
  sourceType?: EducationSubsidyAgentScanRow['sourceType']
  sourceGroupName?: string
  collectionSource?: string
  sourceFile?: string
  scanDate?: string
  lockedDisplayDate?: string
  productName?: string
  skuKey?: string
  pnMtm?: string
  spec?: string
  category?: string
  quantity?: number
  educationDiscountAmount?: number
  orderNumber?: string
  outboundDate?: string
  outboundStoreName?: string
  outboundOperatorName?: string
  serialNumbers?: string[]
  paymentReceived?: boolean
  paymentReceivedAt?: string
  paymentReceivedNote?: string
  activityLabel?: string
  ruleText?: string
  customerName?: string
  customerPhone?: string
  agentPhone?: string
  modelText?: string
  voucherCode?: string
  voucherVerifiedAt?: string
  reportStatus?: string
  customer?: string
  customerPhoneNumber?: string
  phone?: string
  mobile?: string
  reportPhone?: string
  voucherNo?: string
  couponCode?: string
  verificationTime?: string
  verifiedAt?: string
  model?: string
  serviceFeePerUnit?: number
  totalServiceFee?: number
  serviceRuleKey?: string
  serviceRuleLabel?: string
  zhixiangjinAmount?: number
}

type ManualEducationSubsidyAgentScanPayload = {
  records?: ManualEducationSubsidyAgentScanRecord[]
  confirmedNoNewRecords?: boolean
  sourceType?: EducationSubsidyAgentScanRow['sourceType']
  sourceGroupName?: string
  collectionSource?: string
  group?: string
  scanDate?: string
  date?: string
  localDate?: string
  checkedAt?: string
  createdAt?: string
  recordedAt?: string
  status?: string
  result?: string
  executionOutcome?: string
  blockingReason?: string
  observations?: string[]
}

type ZhidiantongSalesOrderLine = {
  skuKey?: string
  productName?: string
  pnMtm?: string
  spec?: string
  serialNumbers?: string[]
}

type ZhidiantongSalesOrder = {
  id?: string
  businessDate?: string
  operatorName?: string
  storeName?: string
  lines?: ZhidiantongSalesOrderLine[]
}

type ZhidiantongSalesOrdersSnapshot = {
  orders?: ZhidiantongSalesOrder[]
}

type RetailCoreSalesOrderLine = {
  sku_key?: string
  product_name?: string
  pn_mtm?: string
  spec?: string
  serial_numbers?: string[] | null
}

type RetailCoreSalesOrderRecord = {
  order_no?: string
  order_number?: string
  external_order_no?: string
  business_no?: string
  business_date?: string
  status_name?: string
  customer_name?: string
  customer_phone?: string
  shop_name?: string
  total_quantity?: number
  raw_payload_json?: string
  lines?: RetailCoreSalesOrderLine[]
}

type RetailCoreSalesOrdersSnapshot = {
  items?: RetailCoreSalesOrderRecord[]
  orders?: RetailCoreSalesOrderRecord[]
  records?: RetailCoreSalesOrderRecord[]
}

type RetailCoreInventoryMovementRecord = {
  id?: string
  sku_key?: string
  quantity?: number
  movement_type?: string
  business_date?: string
  serial_number?: string
  document_no?: string
  operator_name?: string
  supplier_name?: string
  store_name?: string
  location_name?: string
  product_name?: string
  pn_mtm?: string
  spec?: string
  unit_name?: string
  unit_cost?: number
  amount?: number
  note?: string
  created_at?: string
}

type RetailCoreInventoryMovementsSnapshot = {
  items?: RetailCoreInventoryMovementRecord[]
  records?: RetailCoreInventoryMovementRecord[]
}

type EducationAgentBundleProductType = 'pc' | 'tablet' | 'phone' | 'printer' | 'other'

type EducationAgentBundleRuleKey = keyof typeof EDUCATION_AGENT_SCAN_BUNDLE_RULES

type EducationAgentBundleEligibility = {
  pnMtm: string
  productType: EducationAgentBundleProductType
  ruleKeys: Set<EducationAgentBundleRuleKey>
}

type EducationAgentBundleSalesOrderMatch = {
  orderNumber: string
  ruleKey: EducationAgentBundleRuleKey
  label: string
  activityLabel: string
  totalServiceFee: number
  zhixiangjinAmount: number
  matchedPnMtms: string[]
  matchedProductTypes: EducationAgentBundleProductType[]
  matchedSerialNumbers: string[]
}

type EducationAgentBundleSummary = {
  totalGroups: number
  unresolvedCount: number
  threePieceCount: number
  twoPieceCount: number
  legionCount: number
  pendingCount: number
  unpaidCount: number
  paidCount: number
  totalServiceFee: number
  totalZhixiangjinAmount: number
}

const MIN_AGENT_SCAN_EDUCATION_DISCOUNT_AMOUNT = 0
const SNAPSHOT_FILE_NAME = 'latest-education-subsidy-agent-scan-summary.json'
const PHONE_MISMATCH_ALERT_FILE_NAME = 'latest-education-agent-scan-phone-mismatch-alerts.json'
const DETAIL_BACKFILL_QUEUE_FILE_NAME = 'latest-education-agent-scan-detail-backfill-queue.json'
const EDUCATION_AGENT_SCAN_GROUPS = [
  { name: '智店通入库群', collectionSource: '智店通入库群', serviceFeePerUnit: 50 },
  { name: '教育补贴群', collectionSource: '教育补贴群', serviceFeePerUnit: 30 },
] as const
const EDUCATION_AGENT_SCAN_BUNDLE_RULES = {
  three_piece_bundle: {
    key: 'three_piece_bundle',
    label: '三件套代扫费 300',
    activityLabel: '青春有AI三件套',
    totalServiceFee: 300,
    zhixiangjinAmount: 2000,
  },
  two_piece_bundle: {
    key: 'two_piece_bundle',
    label: '两件套代扫费 130',
    activityLabel: '锦鲤跃龙门两件套',
    totalServiceFee: 130,
    zhixiangjinAmount: 0,
  },
  legion_dual_screen_combo: {
    key: 'legion_dual_screen_combo',
    label: '拯救者双屏畅玩两件套代扫费 150',
    activityLabel: '拯救者双屏畅玩两件套',
    totalServiceFee: 150,
    zhixiangjinAmount: 1000,
  },
} as const
const EDUCATION_AGENT_SCAN_BUNDLE_RULE_KEYS = Object.keys(EDUCATION_AGENT_SCAN_BUNDLE_RULES) as Array<keyof typeof EDUCATION_AGENT_SCAN_BUNDLE_RULES>
const EDUCATION_AGENT_SCAN_UNMATCHED_BUNDLE_RULE_KEY = 'bundle_candidate_unmatched'
const EXCLUDED_FAKE_BUNDLE_ORDER_NUMBERS = new Set([
  'XS26052318808119568',
])
const SOURCE_GROUP_NAME = EDUCATION_AGENT_SCAN_GROUPS[0].name
const SOURCE_GROUP_NAMES: string[] = EDUCATION_AGENT_SCAN_GROUPS.map((item) => item.name)

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

function normalizeText(value?: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizePnMtm(value?: string) {
  return normalizeText(value).toUpperCase()
}

function normalizeSourceGroupName(value?: string) {
  const text = normalizeText(value)
  if (!text) return SOURCE_GROUP_NAME
  const matched = EDUCATION_AGENT_SCAN_GROUPS.find((item) => item.name === text)
  return matched?.name ?? text
}

function getGroupFeeConfig(sourceGroupName?: string) {
  const normalized = normalizeSourceGroupName(sourceGroupName)
  return EDUCATION_AGENT_SCAN_GROUPS.find((item) => item.name === normalized)
    ?? { name: normalized, collectionSource: normalized, serviceFeePerUnit: 50 }
}

function resolveSourceGroupName(sourceGroupName?: string, collectionSource?: string) {
  const normalizedGroupName = normalizeSourceGroupName(sourceGroupName)
  const normalizedCollectionSource = normalizeSourceGroupName(collectionSource)
  const groupNameMatched = SOURCE_GROUP_NAMES.includes(normalizedGroupName)
  const collectionMatched = SOURCE_GROUP_NAMES.includes(normalizedCollectionSource)
  if (groupNameMatched && collectionMatched && normalizedGroupName !== normalizedCollectionSource) {
    return normalizedCollectionSource
  }
  if (collectionMatched) return normalizedCollectionSource
  return normalizedGroupName
}

function getDatePart(value?: string) {
  const text = normalizeText(value)
  if (!text) return undefined
  const direct = text.match(/20\d{2}-\d{2}-\d{2}/)?.[0]
  if (direct) return direct
  const parsed = Date.parse(text.replace(' ', 'T'))
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString().slice(0, 10)
}

function getTimestamp(value?: string) {
  const text = normalizeText(value)
  if (!text) return undefined
  const parsed = Date.parse(text.replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function normalizeSerialNumbers(serialNumbers?: string[]) {
  return Array.from(new Set((serialNumbers ?? [])
    .flatMap((item) => String(item ?? '').split(/[\s,，/]+/g))
    .map((item) => normalizeText(item))
    .filter((item) => item && item !== '-1' && item.toUpperCase() !== 'N/A')))
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function serialsLikelyMatch(left: string, right: string) {
  const normalizedLeft = normalizeText(left).toUpperCase()
  const normalizedRight = normalizeText(right).toUpperCase()
  if (!normalizedLeft || !normalizedRight) return false
  if (normalizedLeft === normalizedRight) return true
  const numericLeft = /^\d+$/.test(normalizedLeft)
  const numericRight = /^\d+$/.test(normalizedRight)
  if (numericLeft && numericRight && Math.min(normalizedLeft.length, normalizedRight.length) >= 12) {
    return normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft)
  }
  return false
}

function serialSetsLikelyOverlap(leftSerials: string[], rightSerials: string[]) {
  return leftSerials.some((left) => rightSerials.some((right) => serialsLikelyMatch(left, right)))
}

function normalizePhone(value?: string) {
  const digits = String(value ?? '').replace(/[^\d]/g, '')
  if (!digits) return ''
  if (digits.startsWith('86') && digits.length > 11) return digits.slice(-11)
  return digits
}

function firstNonEmptyText(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }
  return ''
}

async function readJsonIfExists<T>(filePath: string) {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => null)
}

async function loadRetailCoreSalesOutboundRows() {
  const snapshot = await readJsonIfExists<RetailCoreInventoryMovementsSnapshot>(webDataPath('latest-retail-core-inventory-movements.json'))
  const rows = snapshot?.items ?? snapshot?.records ?? []
  return rows
    .filter((item) => normalizeText(item.movement_type) === 'sales_outbound')
    .map((item) => ({
      id: normalizeText(item.id),
      skuKey: normalizeText(item.sku_key),
      quantity: Math.abs(Number(item.quantity ?? 0) || 0) || 1,
      movementType: 'sales_outbound' as const,
      businessDate: normalizeText(item.business_date),
      createdAt: normalizeText(item.created_at),
      serialNumber: normalizeText(item.serial_number),
      documentNumber: normalizeText(item.document_no),
      operatorName: normalizeText(item.operator_name),
      supplierName: normalizeText(item.supplier_name),
      storeName: normalizeText(item.store_name),
      locationName: normalizeText(item.location_name),
      productName: normalizeText(item.product_name),
      pnMtm: normalizeText(item.pn_mtm),
      spec: normalizeText(item.spec),
      unitName: normalizeText(item.unit_name),
      unitCost: Number(item.unit_cost ?? 0) || undefined,
      amount: Number(item.amount ?? 0) || undefined,
      note: normalizeText(item.note),
      updatedAt: normalizeText(item.created_at) || new Date().toISOString(),
    }))
    .filter((item) => item.id && item.businessDate)
}

function extractOrderNumberFromLooseText(...values: Array<string | undefined>) {
  for (const value of values) {
    const text = normalizeText(value)
    if (!text) continue
    const matched = text.match(/XS\d{8,}/i)
    if (matched) return matched[0].toUpperCase()
  }
  return ''
}

async function loadRetailCoreSalesOrders() {
  const snapshot = await readJsonIfExists<RetailCoreSalesOrdersSnapshot>(webDataPath('latest-retail-core-sales-orders.json'))
  return snapshot?.items ?? snapshot?.orders ?? snapshot?.records ?? []
}

function isUnknownLikeText(value?: string) {
  const text = normalizeText(value)
  if (!text) return true
  return /^(未知|待补|待补型号|N\/A|NA|-|无)$/i.test(text)
}

function isGenericEducationProductName(value?: string) {
  const text = normalizeText(value)
  if (!text) return true
  return /联想指定.*机型|教育补贴.*机型|待补型号|待补产品|未知/i.test(text)
}

function parseRetailCoreRawPayload(order: RetailCoreSalesOrderRecord) {
  const rawText = normalizeText(order.raw_payload_json)
  if (!rawText) return null
  try {
    return JSON.parse(rawText) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractRetailCoreCustomerName(order: RetailCoreSalesOrderRecord) {
  const rawPayload = parseRetailCoreRawPayload(order)
  const candidates = [
    order.customer_name,
    typeof rawPayload?.buyerNick === 'string' ? rawPayload.buyerNick : '',
    typeof rawPayload?.receiverName === 'string' ? rawPayload.receiverName : '',
  ]
  return firstNonEmptyText(...candidates)
}

function extractRetailCoreCustomerPhone(order: RetailCoreSalesOrderRecord) {
  const rawPayload = parseRetailCoreRawPayload(order)
  const candidates = [
    order.customer_phone,
    typeof rawPayload?.buyerPhone === 'string' ? rawPayload.buyerPhone : '',
    typeof rawPayload?.receiverPhone === 'string' ? rawPayload.receiverPhone : '',
  ].map((item) => normalizePhone(item))
  return candidates.find(Boolean) || ''
}

type RetailCoreSalesOrderLookupLine = {
  skuKey: string
  productName: string
  pnMtm: string
  spec: string
  serialNumbers: string[]
}

type RetailCoreSalesOrderLookupEntry = {
  orderNumber: string
  businessDate: string
  statusName: string
  customerName: string
  customerPhone: string
  storeName: string
  operatorName: string
  lineCount: number
  lines: RetailCoreSalesOrderLookupLine[]
}

function buildRetailCoreSalesOrderLookup(orders: RetailCoreSalesOrderRecord[]) {
  const byOrder = new Map<string, RetailCoreSalesOrderLookupEntry>()
  const bySerial = new Map<string, RetailCoreSalesOrderLookupEntry[]>()
  for (const order of orders) {
    const orderNumber = extractOrderNumberFromLooseText(order.order_number, order.order_no, order.external_order_no, order.business_no)
    if (!orderNumber) continue
    const rawPayload = parseRetailCoreRawPayload(order)
    const rawLines = Array.isArray(rawPayload?.orderItemList)
      ? rawPayload.orderItemList as Array<Record<string, unknown>>
      : Array.isArray(rawPayload?.lines)
        ? rawPayload.lines as Array<Record<string, unknown>>
        : []
    const normalizedLines: RetailCoreSalesOrderLookupLine[] = (order.lines ?? []).map((line, index) => {
      const rawLine = rawLines[index] ?? {}
      const rawSerialNumbers = Array.isArray(rawLine.serialNumbers)
        ? rawLine.serialNumbers.map((item) => String(item ?? ''))
        : [
          typeof rawLine.serialNumber === 'string' ? rawLine.serialNumber : '',
          typeof rawLine.serial_numbers_json === 'string' ? rawLine.serial_numbers_json : '',
        ]
      const serialNumbers = normalizeSerialNumbers([
        ...(line.serial_numbers ?? []),
        ...rawSerialNumbers,
      ])
      return {
        skuKey: normalizeText(line.sku_key) || normalizeText(rawLine.skuKey as string) || normalizeText(rawLine.sku_no as string),
        productName: normalizeText(line.product_name) || normalizeText(rawLine.productName as string),
        pnMtm: normalizePnMtm(line.pn_mtm) || normalizePnMtm(rawLine.mtmCode as string) || normalizePnMtm(rawLine.mtm_code as string),
        spec: normalizeText(line.spec) || normalizeText(rawLine.spec as string) || normalizeText(rawLine.propertiesIndb as string),
        serialNumbers,
      }
    })
    const operatorName = firstNonEmptyText(
      typeof rawPayload?.cashierName === 'string' ? rawPayload.cashierName : '',
      typeof rawPayload?.operatorName === 'string' ? rawPayload.operatorName : '',
    )
    const entry: RetailCoreSalesOrderLookupEntry = {
      orderNumber,
      businessDate: normalizeText(order.business_date),
      statusName: normalizeText(order.status_name),
      customerName: extractRetailCoreCustomerName(order),
      customerPhone: extractRetailCoreCustomerPhone(order),
      storeName: normalizeText(order.shop_name) || firstNonEmptyText(typeof rawPayload?.shopName === 'string' ? rawPayload.shopName : ''),
      operatorName,
      lineCount: Math.max(normalizedLines.length, Number(order.total_quantity ?? 0) || 0),
      lines: normalizedLines,
    }
    byOrder.set(orderNumber, entry)
    for (const line of normalizedLines) {
      for (const serialNumber of line.serialNumbers) {
        const bucket = bySerial.get(serialNumber) ?? []
        bucket.push(entry)
        bySerial.set(serialNumber, bucket)
      }
    }
  }
  return { byOrder, bySerial }
}

function choosePreferredRetailCoreEntry(entries: RetailCoreSalesOrderLookupEntry[]) {
  return entries
    .slice()
    .sort((left, right) => {
      const leftCanceled = /取消|退货|退款/.test(left.statusName) ? 1 : 0
      const rightCanceled = /取消|退货|退款/.test(right.statusName) ? 1 : 0
      return leftCanceled - rightCanceled
        || right.lineCount - left.lineCount
        || right.businessDate.localeCompare(left.businessDate)
    })[0]
}

function findMatchingRetailCoreLine(
  row: EducationSubsidyAgentScanRow,
  entry?: RetailCoreSalesOrderLookupEntry,
) {
  if (!entry) return undefined
  const rowSerials = normalizeSerialNumbers(row.serialNumbers)
  const rowSkuKey = normalizeText(row.matchedOutboundSkuKey || row.skuKey || row.sourceSkuKey)
  const rowPnMtm = normalizePnMtm(row.matchedOutboundPnMtm || row.pnMtm || row.sourcePnMtm)
  const rowProductName = normalizeText(row.productName).toUpperCase()
  const scored = entry.lines
    .map((line) => {
      let score = 0
      if (rowSerials.length && line.serialNumbers.length && serialSetsLikelyOverlap(rowSerials, line.serialNumbers)) score += 100
      if (rowSkuKey && normalizeText(line.skuKey) === rowSkuKey) score += 20
      if (rowPnMtm && normalizePnMtm(line.pnMtm) === rowPnMtm) score += 20
      if (rowProductName && normalizeText(line.productName).toUpperCase() === rowProductName) score += 8
      return { line, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
  return scored[0]?.line
}

function enrichRowsWithRetailCoreSalesOrders(
  rows: EducationSubsidyAgentScanRow[],
  retailCoreSalesOrders: RetailCoreSalesOrderRecord[],
) {
  const lookup = buildRetailCoreSalesOrderLookup(retailCoreSalesOrders)
  return rows.map((row) => {
    const rowOrderNumber = extractOrderNumberFromLooseText(row.orderNumber, row.matchedOutboundOrderId, row.matchedSalesOrderId)
    const rowSerials = normalizeSerialNumbers(row.serialNumbers)
    const serialMatches = rowSerials.flatMap((serialNumber) => lookup.bySerial.get(serialNumber) ?? [])
    const preferredEntry = (
      (rowOrderNumber && lookup.byOrder.get(rowOrderNumber))
      || (serialMatches.length ? choosePreferredRetailCoreEntry(serialMatches) : undefined)
    )
    const preferredLine = findMatchingRetailCoreLine(row, preferredEntry)
    const preferredOrderNumber = preferredEntry?.orderNumber || rowOrderNumber
    const customerName = firstNonEmptyText(
      isUnknownLikeText(row.customerName) ? '' : row.customerName,
      preferredEntry?.customerName,
    )
    const customerPhone = normalizePhone(row.customerPhone || preferredEntry?.customerPhone)
    const productName = isGenericEducationProductName(row.productName)
      ? firstNonEmptyText(preferredLine?.productName, row.productName)
      : row.productName
    const skuKey = firstNonEmptyText(row.skuKey, preferredLine?.skuKey, row.sourceSkuKey)
    const pnMtm = firstNonEmptyText(row.pnMtm, preferredLine?.pnMtm, row.sourcePnMtm)
    const spec = firstNonEmptyText(row.spec, preferredLine?.spec)
    const serialNumbers = rowSerials.length
      ? rowSerials
      : normalizeSerialNumbers(preferredLine?.serialNumbers)
    return {
      ...row,
      productName,
      skuKey,
      pnMtm,
      spec,
      orderNumber: rowOrderNumber || preferredOrderNumber || row.orderNumber,
      matchedOutboundOrderId: extractOrderNumberFromLooseText(row.matchedOutboundOrderId, preferredOrderNumber) || row.matchedOutboundOrderId,
      matchedSalesOrderId: extractOrderNumberFromLooseText(row.matchedSalesOrderId, preferredOrderNumber) || row.matchedSalesOrderId,
      matchedOutboundSkuKey: firstNonEmptyText(row.matchedOutboundSkuKey, preferredLine?.skuKey, skuKey),
      matchedOutboundPnMtm: firstNonEmptyText(row.matchedOutboundPnMtm, preferredLine?.pnMtm, pnMtm),
      outboundDate: firstNonEmptyText(row.outboundDate, preferredEntry?.businessDate),
      outboundStoreName: firstNonEmptyText(row.outboundStoreName, preferredEntry?.storeName),
      outboundOperatorName: firstNonEmptyText(row.outboundOperatorName, preferredEntry?.operatorName),
      customerName,
      customerPhone,
      serialNumbers,
    }
  })
}

function buildEducationAgentScanDetailBackfillQueue(rows: EducationSubsidyAgentScanRow[]) {
  const items = rows
    .map((row) => {
      const missingFields: string[] = []
      if (isUnknownLikeText(row.customerName)) missingFields.push('客户姓名')
      if (!normalizePhone(row.customerPhone)) missingFields.push('客户电话')
      if (!normalizePhone(row.agentPhone)) missingFields.push('代扫电话')
      if (!normalizeText(row.voucherCode)) missingFields.push('券编号')
      if (!normalizeText(row.voucherVerifiedAt)) missingFields.push('核销时间')
      if (!normalizeText(row.reportStatus) || !/完成|成功/.test(normalizeText(row.reportStatus))) missingFields.push('上报状态')
      if (isPlaceholderOrderNumber(row.orderNumber)) missingFields.push('销售出库单号')
      if (!normalizeText(row.matchedOutboundSkuKey || row.skuKey)) missingFields.push('商品 SKU')
      if (!normalizeText(row.matchedOutboundPnMtm || row.pnMtm)) missingFields.push('商品 MTM')
      if (isGenericEducationProductName(row.productName)) missingFields.push('真实商品名称')
      if (!missingFields.length) return undefined
      const hasSerial = normalizeSerialNumbers(row.serialNumbers).length > 0
      const resolvedSourceGroupName = resolveSourceGroupName(row.sourceGroupName, row.collectionSource)
      const hint = hasSerial
        ? '优先按 SN 回查销售单、客户卡片与核销截图；若同 SN 存在更新版本，以最新可见图片时间覆盖旧值'
        : '当前缺少可直接反查 SN，请回原群图补订单号、客户信息和核销截图后再固化'
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        serialNumbers: row.serialNumbers,
        sourceGroupName: resolvedSourceGroupName,
        collectionSource: firstNonEmptyText(row.collectionSource, resolvedSourceGroupName),
        scanDate: row.scanDate,
        productName: row.productName,
        skuKey: firstNonEmptyText(row.matchedOutboundSkuKey, row.skuKey),
        pnMtm: firstNonEmptyText(row.matchedOutboundPnMtm, row.pnMtm),
        outboundDate: row.outboundDate,
        outboundStoreName: row.outboundStoreName,
        outboundOperatorName: row.outboundOperatorName,
        currentCustomerName: row.customerName,
        currentCustomerPhone: row.customerPhone,
        currentAgentPhone: row.agentPhone,
        currentVoucherCode: row.voucherCode,
        currentVoucherVerifiedAt: row.voucherVerifiedAt,
        currentReportStatus: row.reportStatus,
        sourceFile: row.sourceFile,
        missingFields,
        hint,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.scanDate.localeCompare(left.scanDate) || left.id.localeCompare(right.id))
  return {
    generatedAt: new Date().toISOString(),
    source: 'education_subsidy_agent_scan_summary',
    date: getShanghaiDateString(),
    count: items.length,
    items,
  }
}

function getBundleRuleLabel(ruleKey: 'three_piece_bundle' | 'two_piece_bundle' | 'legion_dual_screen_combo') {
  return EDUCATION_AGENT_SCAN_BUNDLE_RULES[ruleKey].label
}

function getManualDir() {
  return path.resolve(config.lenovoRetail.artifactDir, 'manual/education-agent-scan')
}

async function listManualPayloadFiles() {
  const manualDir = getManualDir()
  const entries = await fs.readdir(manualDir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && /^education-agent-scan-.*\.json$/i.test(entry.name))
    .map((entry) => path.resolve(manualDir, entry.name))
}

function getPayloadRecords(
  payload: ManualEducationSubsidyAgentScanPayload | ManualEducationSubsidyAgentScanRecord[] | null,
) {
  if (!payload) return []
  return Array.isArray(payload) ? payload : payload.records ?? []
}

async function loadManualRecords() {
  const payloadFiles = await listManualPayloadFiles()
  const rows: ManualEducationSubsidyAgentScanRecord[] = []
  for (const filePath of payloadFiles) {
    const payload = await readJsonIfExists<ManualEducationSubsidyAgentScanPayload | ManualEducationSubsidyAgentScanRecord[]>(filePath)
    const items = getPayloadRecords(payload)
    rows.push(
      ...items
        .map((item) => ({ ...item, sourceFile: item.sourceFile ?? filePath }))
        .filter((item) => {
          const sourceGroupName = normalizeSourceGroupName(item.sourceGroupName || item.collectionSource)
          const sourceType = normalizeText(item.sourceType)
          return SOURCE_GROUP_NAMES.includes(sourceGroupName)
            || sourceType === 'xhey_api_manual'
            || sourceType === 'watermark_camera_manual'
        }),
    )
  }
  return rows
}

function getShanghaiDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function isCompletedSameDayAgentScanRecord(record: ManualEducationSubsidyAgentScanRecord) {
  const serialCount = normalizeSerialNumbers(record.serialNumbers).length
  const orderNumber = normalizeText(record.orderNumber)
  const reportStatus = normalizeText(record.reportStatus)
  const ruleText = normalizeText(record.ruleText)
  const productName = normalizeText(record.productName)
  const modelText = normalizeText(record.modelText)
  const voucherCode = normalizeText(record.voucherCode || record.voucherNo || record.couponCode)
  const incompleteText = `${reportStatus} ${ruleText} ${productName} ${modelText}`.toLowerCase()
  if (/visible_not_closed|voucher_visible_not_closed|仅见券图|待补产品图|待补|未收口|等待用户完成绑定/.test(incompleteText)) {
    return false
  }
  return Boolean(serialCount && voucherCode && (orderNumber || /上报完成|核销成功|有效/.test(reportStatus)))
}

export async function inspectEducationSubsidyAgentScanAcquisition(today = getShanghaiDateString()) {
  const payloadFiles = await listManualPayloadFiles()
  const groupResults = EDUCATION_AGENT_SCAN_GROUPS.map((group) => ({
    sourceGroupName: group.name,
    sameDayFiles: new Set<string>(),
    sameDayRecordFiles: new Set<string>(),
    noNewConfirmationFiles: new Set<string>(),
    sameDayRecordCount: 0,
    latestRecordScanDate: '',
    latestRecordFile: '',
    latestConfirmedTimestamp: -Infinity,
    latestConfirmedFile: '',
    latestIncompleteTimestamp: -Infinity,
    latestIncompleteFile: '',
    latestIncompleteReason: '',
    latestIncompleteObservation: '',
  }))
  const byGroup = new Map<string, (typeof groupResults)[number]>(groupResults.map((item) => [item.sourceGroupName, item]))
  const sameDayFiles = new Set<string>()
  const sameDayRecordFiles = new Set<string>()
  const noNewConfirmationFiles = new Set<string>()
  let sameDayRecordCount = 0
  let latestRecordScanDate = ''
  let latestRecordFile = ''
  let latestConfirmedTimestamp = -Infinity
  let latestConfirmedFile = ''
  let latestIncompleteTimestamp = -Infinity
  let latestIncompleteFile = ''
  let latestIncompleteReason = ''
  let latestIncompleteObservation = ''
  const sameDaySourceTypes = new Set<string>()
  const sameDayCollectionSources = new Set<string>()

  for (const filePath of payloadFiles) {
    const payload = await readJsonIfExists<ManualEducationSubsidyAgentScanPayload | ManualEducationSubsidyAgentScanRecord[]>(filePath)
    const records = getPayloadRecords(payload)
    if (payload && !Array.isArray(payload)) {
      const payloadDate = getDatePart(payload.scanDate || payload.checkedAt || payload.date || payload.localDate || payload.createdAt || payload.recordedAt)
      const sourceGroupName = normalizeSourceGroupName(payload.sourceGroupName || payload.collectionSource || payload.group)
      const groupResult = byGroup.get(sourceGroupName)
      if (payloadDate === today && groupResult) {
        sameDayFiles.add(filePath)
        groupResult.sameDayFiles.add(filePath)
        if (normalizeText(payload.sourceType)) sameDaySourceTypes.add(normalizeText(payload.sourceType))
        if (normalizeText(payload.collectionSource)) sameDayCollectionSources.add(normalizeText(payload.collectionSource))
        const payloadTimestamp = getTimestamp(payload.checkedAt || payload.recordedAt || payload.createdAt || payload.scanDate || payload.date) ?? -Infinity
        if (payload.confirmedNoNewRecords && records.length === 0) {
          noNewConfirmationFiles.add(filePath)
          groupResult.noNewConfirmationFiles.add(filePath)
          if (payloadTimestamp >= latestConfirmedTimestamp) {
            latestConfirmedTimestamp = payloadTimestamp
            latestConfirmedFile = filePath
          }
          if (payloadTimestamp >= groupResult.latestConfirmedTimestamp) {
            groupResult.latestConfirmedTimestamp = payloadTimestamp
            groupResult.latestConfirmedFile = filePath
          }
        } else if (
          records.length === 0
          && (
          normalizeText(payload.status)
          || normalizeText(payload.result)
          || normalizeText(payload.executionOutcome)
          || normalizeText(payload.blockingReason)
          || (payload.observations ?? []).some((item) => /代扫|教育补|核销|箱码|上报|SN|外箱/i.test(item))
          )
        ) {
          if (payloadTimestamp >= latestIncompleteTimestamp) {
            latestIncompleteTimestamp = payloadTimestamp
            latestIncompleteFile = filePath
            latestIncompleteReason = normalizeText(payload.blockingReason || payload.result || payload.executionOutcome || payload.status)
            latestIncompleteObservation = normalizeText((payload.observations ?? []).find((item) => /代扫|教育补|核销|箱码|上报|SN|外箱/i.test(item)))
          }
          if (payloadTimestamp >= groupResult.latestIncompleteTimestamp) {
            groupResult.latestIncompleteTimestamp = payloadTimestamp
            groupResult.latestIncompleteFile = filePath
            groupResult.latestIncompleteReason = normalizeText(payload.blockingReason || payload.result || payload.executionOutcome || payload.status)
            groupResult.latestIncompleteObservation = normalizeText((payload.observations ?? []).find((item) => /代扫|教育补|核销|箱码|上报|SN|外箱/i.test(item)))
          }
        } else if (records.length === 0 && payloadTimestamp >= latestIncompleteTimestamp) {
          latestIncompleteTimestamp = payloadTimestamp
          latestIncompleteFile = filePath
          if (payloadTimestamp >= groupResult.latestIncompleteTimestamp) {
            groupResult.latestIncompleteTimestamp = payloadTimestamp
            groupResult.latestIncompleteFile = filePath
          }
        }
      }
    }
    for (const record of records) {
      const sourceGroupName = normalizeSourceGroupName(record.sourceGroupName || record.collectionSource)
      const groupResult = byGroup.get(sourceGroupName)
      if (!groupResult) continue
      const scanDate = getDatePart(record.scanDate || record.lockedDisplayDate || record.outboundDate)
      if (scanDate && scanDate > latestRecordScanDate) {
        latestRecordScanDate = scanDate
        latestRecordFile = filePath
      }
      if (scanDate && scanDate > groupResult.latestRecordScanDate) {
        groupResult.latestRecordScanDate = scanDate
        groupResult.latestRecordFile = filePath
      }
      const educationDiscountAmount = Number(record.educationDiscountAmount ?? 0) || 0
      if (
        scanDate === today
        && educationDiscountAmount >= MIN_AGENT_SCAN_EDUCATION_DISCOUNT_AMOUNT
        && isCompletedSameDayAgentScanRecord(record)
      ) {
        if (normalizeText(record.sourceType)) sameDaySourceTypes.add(normalizeText(record.sourceType))
        if (normalizeText(record.collectionSource)) sameDayCollectionSources.add(normalizeText(record.collectionSource))
        sameDayRecordCount += 1
        sameDayRecordFiles.add(filePath)
        sameDayFiles.add(filePath)
        groupResult.sameDayRecordCount += 1
        groupResult.sameDayRecordFiles.add(filePath)
        groupResult.sameDayFiles.add(filePath)
      }
    }
  }

  const publicGroupResults = groupResults.map((item) => {
    const hasLaterIncompleteScan = item.latestIncompleteTimestamp > item.latestConfirmedTimestamp
    const hasConflictingNoNewConfirmation = item.sameDayRecordCount > 0 && item.noNewConfirmationFiles.size > 0
    const status = hasLaterIncompleteScan || hasConflictingNoNewConfirmation
      ? 'missing_same_day_group_scan_evidence'
      : item.sameDayRecordCount > 0
        ? 'same_day_records_present'
        : item.noNewConfirmationFiles.size > 0
          ? 'same_day_no_new_confirmed'
          : 'missing_same_day_group_scan_evidence'
    return {
      sourceGroupName: item.sourceGroupName,
      status,
      sameDayRecordCount: item.sameDayRecordCount,
      sameDayRecordFileCount: item.sameDayRecordFiles.size,
      sameDayNoNewConfirmationFileCount: item.noNewConfirmationFiles.size,
      hasConflictingNoNewConfirmation,
      latestRecordScanDate: item.latestRecordScanDate,
      latestRecordFile: item.latestRecordFile,
      latestIncompleteFile: item.latestIncompleteFile,
      latestConfirmedFile: item.latestConfirmedFile,
      files: [...item.sameDayFiles],
    }
  })
  const hasLaterIncompleteScan = latestIncompleteTimestamp > latestConfirmedTimestamp
  const hasConflictingNoNewConfirmation = publicGroupResults.some((item) => item.hasConflictingNoNewConfirmation)
  const hasAnyNoNewConfirmation = noNewConfirmationFiles.size > 0
  const status = sameDayRecordCount > 0
    ? 'same_day_records_present'
    : hasAnyNoNewConfirmation
      ? 'same_day_no_new_confirmed'
      : 'missing_same_day_collection_evidence'
  const missingGroups = publicGroupResults.filter((item) => item.status === 'missing_same_day_group_scan_evidence').map((item) => item.sourceGroupName)
  const sourceTypeText = Array.from(sameDaySourceTypes).join('、') || '未标记来源类型'
  const collectionSourceText = Array.from(sameDayCollectionSources).join('、') || '未标记采集来源'
  const detail = status === 'same_day_records_present'
    ? `已发现 ${today} 教育补代扫采集记录 ${sameDayRecordCount} 条；来源类型：${sourceTypeText}；采集来源：${collectionSourceText}。`
    : hasLaterIncompleteScan
      ? `已发现 ${today} 教育补代扫存在未收口记录（${path.basename(latestIncompleteFile)}${latestIncompleteReason ? `：${latestIncompleteReason}` : ''}${latestIncompleteObservation ? `；可见观察：${latestIncompleteObservation}` : ''}）；关联费率分组：${missingGroups.join('、') || SOURCE_GROUP_NAMES.join('、')}。旧的无新增确认 ${latestConfirmedFile ? `(${path.basename(latestConfirmedFile)})` : ''}不能覆盖本轮执行窗口。`
    : hasConflictingNoNewConfirmation
      ? `已发现 ${today} 教育补代扫存在“同日正式记录”和“无新增确认”并存的冲突状态；关联费率分组：${missingGroups.join('、') || SOURCE_GROUP_NAMES.join('、')}。必须继续补齐当天记录，不能提前收口。`
    : status === 'same_day_no_new_confirmed'
      ? `已发现 ${today} 教育补代扫无新增确认；来源类型：${sourceTypeText}；采集来源：${collectionSourceText}。`
      : `未发现 ${today} 教育补代扫正式记录或无新增确认；当前仅保留提醒，不再以原微信群扫描流程阻断智店通主同步。`

  return {
    today,
    manualDir: getManualDir(),
    sourceGroupName: SOURCE_GROUP_NAMES.join('、'),
    sourceGroupNames: SOURCE_GROUP_NAMES,
    groupResults: publicGroupResults,
    status,
    sameDayRecordCount,
    sameDayRecordFileCount: sameDayRecordFiles.size,
    sameDayNoNewConfirmationFileCount: noNewConfirmationFiles.size,
    latestRecordScanDate,
    latestRecordFile,
    latestIncompleteFile,
    latestConfirmedFile,
    files: [...sameDayFiles],
    sourceTypes: Array.from(sameDaySourceTypes),
    collectionSources: Array.from(sameDayCollectionSources),
    detail,
  }
}

function identityKey(item: { skuKey?: string; pnMtm?: string; productName?: string }) {
  const skuKey = normalizeText(item.skuKey)
  if (skuKey) return `sku:${skuKey}`
  const pnMtm = normalizeText(item.pnMtm).toUpperCase()
  if (pnMtm) return `pn:${pnMtm}`
  return `name:${normalizeText(item.productName).toUpperCase()}`
}

function findMatchedHistoryRow(
  record: ManualEducationSubsidyAgentScanRecord,
  historyRows: MarketingBoostHeroCard[],
) {
  const key = identityKey(record)
  const scanDate = getDatePart(record.scanDate || record.lockedDisplayDate || record.outboundDate)
  const educationRows = historyRows
    .filter((item) => item.activityCategory === 'education_discount' || Number(item.educationDiscountAmount ?? 0) > 0)
    .filter((item) => {
      const outboundDate = getDatePart(item.outboundDate)
      if (!scanDate || !outboundDate) return true
      return outboundDate >= scanDate
    })

  const recordSerials = new Set(normalizeSerialNumbers(record.serialNumbers))
  const serialMatchedCandidates = recordSerials.size
    ? educationRows.filter((item) => serialSetsLikelyOverlap(Array.from(recordSerials), normalizeSerialNumbers(item.serialNumbers)))
    : []
  const candidates = (serialMatchedCandidates.length ? serialMatchedCandidates : educationRows.filter((item) => identityKey(item) === key))
    .sort((left, right) => left.outboundDate.localeCompare(right.outboundDate))
  return candidates[0]
}

function extractOrderNumber(note?: string, fallback?: string) {
  const text = normalizeText(note)
  const matched = text.match(/(?:XS|XSD|LS|LSD)\d{8,}/i)?.[0]
  return normalizeText(matched || fallback)
}

function isPlaceholderOrderNumber(value?: string) {
  const text = normalizeText(value)
  return !text || /^PENDING/i.test(text) || /^THREE-PIECE-|^TWO-PIECE-/i.test(text)
}

function isFormalOutboundOrderNumber(value?: string) {
  return /^(XS|XSD|LS|LSD)\d{8,}$/i.test(normalizeText(value))
}

function findMatchedSalesOutboundRow(
  record: ManualEducationSubsidyAgentScanRecord,
  salesOutboundRows: InventoryMovementRecord[],
) {
  const scanDate = getDatePart(record.scanDate || record.lockedDisplayDate || record.outboundDate)
  const recordOrderNumber = normalizeText(record.orderNumber)
  const recordSerials = new Set(normalizeSerialNumbers(record.serialNumbers))
  const skuKey = normalizeText(record.skuKey)
  const pnMtm = normalizeText(record.pnMtm).toUpperCase()
  const productName = normalizeText(record.productName).toUpperCase()

  const candidates = salesOutboundRows
    .filter((item) => {
      const outboundDate = getDatePart(item.businessDate)
      if (!scanDate || !outboundDate) return true
      return outboundDate >= scanDate
    })
    .filter((item) => {
      const outboundSerials = normalizeSerialNumbers(item.serialNumber ? [item.serialNumber] : [])
      if (recordSerials.size && outboundSerials.length) return serialSetsLikelyOverlap(Array.from(recordSerials), outboundSerials)
      if (skuKey && normalizeText(item.skuKey) === skuKey) return true
      if (pnMtm && normalizeText(item.pnMtm).toUpperCase() === pnMtm) return true
      return productName && normalizeText(item.productName).toUpperCase() === productName
    })
    .sort((left, right) => {
      const leftOrderNumber = extractOrderNumber(left.note, left.documentNumber)
      const rightOrderNumber = extractOrderNumber(right.note, right.documentNumber)
      const leftOrderLineCount = leftOrderNumber
        ? salesOutboundRows.filter((item) => extractOrderNumber(item.note, item.documentNumber) === leftOrderNumber).length
        : 0
      const rightOrderLineCount = rightOrderNumber
        ? salesOutboundRows.filter((item) => extractOrderNumber(item.note, item.documentNumber) === rightOrderNumber).length
        : 0
      return rightOrderLineCount - leftOrderLineCount
        || normalizeText(right.businessDate).localeCompare(normalizeText(left.businessDate))
    })
  if (!recordOrderNumber) return candidates[0]
  return candidates.find((item) => (
    normalizeText(item.documentNumber) === recordOrderNumber
    || normalizeText(item.note).includes(recordOrderNumber)
  )) ?? candidates[0]
}

function findMatchedSalesOrderLine(
  record: ManualEducationSubsidyAgentScanRecord,
  salesOrders: ZhidiantongSalesOrder[],
) {
  const scanDate = getDatePart(record.scanDate || record.lockedDisplayDate || record.outboundDate)
  const recordOrderNumber = normalizeText(record.orderNumber)
  const recordSerials = new Set(normalizeSerialNumbers(record.serialNumbers))
  const skuKey = normalizeText(record.skuKey)
  const pnMtm = normalizeText(record.pnMtm).toUpperCase()
  const productName = normalizeText(record.productName).toUpperCase()

  const lineCandidates = salesOrders
    .filter((order) => {
      const businessDate = getDatePart(order.businessDate)
      if (!scanDate || !businessDate) return true
      return businessDate >= scanDate
    })
    .flatMap((order) => (order.lines ?? []).map((line) => ({ order, line })))
    .filter(({ line }) => {
      const serials = normalizeSerialNumbers(line.serialNumbers)
      if (recordSerials.size && serials.length > 0) return serialSetsLikelyOverlap(Array.from(recordSerials), serials)
      if (skuKey && normalizeText(line.skuKey) === skuKey) return true
      if (pnMtm && normalizeText(line.pnMtm).toUpperCase() === pnMtm) return true
      return productName && normalizeText(line.productName).toUpperCase() === productName
    })
    .sort((left, right) => {
      const leftLineCount = left.order.lines?.length ?? 0
      const rightLineCount = right.order.lines?.length ?? 0
      return rightLineCount - leftLineCount
        || normalizeText(right.order.businessDate).localeCompare(normalizeText(left.order.businessDate))
    })

  if (!recordOrderNumber) return lineCandidates[0]
  return lineCandidates.find(({ order }) => normalizeText(order.id) === recordOrderNumber) ?? lineCandidates[0]
}

function buildRowFromManualRecord(
  record: ManualEducationSubsidyAgentScanRecord,
  historyRows: MarketingBoostHeroCard[],
  salesOutboundRows: InventoryMovementRecord[],
  salesOrders: ZhidiantongSalesOrder[],
): EducationSubsidyAgentScanRow | undefined {
  const productName = normalizeText(record.productName)
  const scanDate = getDatePart(record.scanDate || record.lockedDisplayDate || record.outboundDate)
  const normalizedRecordSerials = normalizeSerialNumbers(record.serialNumbers)
  const incompleteText = `${normalizeText(record.reportStatus)} ${normalizeText(record.ruleText)} ${productName} ${normalizeText(record.modelText)}`.toLowerCase()
  // 允许“仅箱码先入库”：只要有采集日期且有 SN/订单号，也先入 SQL，后续再按 SN 回补详情。
  if (!scanDate) return undefined
  if (
    /visible_not_closed|voucher_visible_not_closed|仅见券图|待补产品图|未收口|等待用户完成绑定/.test(incompleteText)
    && !normalizedRecordSerials.length
    && !normalizeText(record.orderNumber)
  ) {
    return undefined
  }
  if (!productName && !normalizedRecordSerials.length && !normalizeText(record.orderNumber)) return undefined
  const matchedHistory = findMatchedHistoryRow(record, historyRows)
  const matchedSalesOutbound = findMatchedSalesOutboundRow(record, salesOutboundRows)
  const matchedSalesOrder = matchedSalesOutbound ? undefined : findMatchedSalesOrderLine(record, salesOrders)
  const scannedEducationDiscountAmount = Number(record.educationDiscountAmount ?? 0) || 0
  const educationDiscountAmount = Number(
    record.educationDiscountAmount
    ?? matchedHistory?.educationDiscountAmount
    ?? 0,
  ) || 0
  if (educationDiscountAmount < MIN_AGENT_SCAN_EDUCATION_DISCOUNT_AMOUNT) return undefined
  const paymentReceived = Boolean(record.paymentReceived)
  const explicitServiceRuleKey = normalizeText(record.serviceRuleKey)
  const resolvedSourceGroupName = resolveSourceGroupName(record.sourceGroupName, record.collectionSource)
  const groupConfig = getGroupFeeConfig(resolvedSourceGroupName)
  const manualServiceFeePerUnit = Number(record.serviceFeePerUnit ?? 0) || 0
  const manualTotalServiceFee = Number(record.totalServiceFee ?? 0) || 0
  const matchedSalesOrderSerials = normalizeSerialNumbers(matchedSalesOrder?.line?.serialNumbers)
  const matchedPrimarySerial = normalizeSerialNumbers([
    matchedSalesOutbound?.serialNumber || '',
    matchedSalesOrderSerials[0] || '',
  ])[0]
  const preferMatchedSingleRow = isEducationAgentBundlePlaceholder({
    id: normalizeText(record.id) || 'manual-record',
    sourceType: record.sourceType === 'xhey_api_manual' || record.sourceType === 'watermark_camera_manual'
      ? record.sourceType
      : 'wechat_group_manual',
    sourceGroupName: resolvedSourceGroupName,
    collectionSource: groupConfig.collectionSource,
    scanDate,
    lockedDisplayDate: scanDate,
    productName,
    quantity: Math.max(1, Number(record.quantity ?? 1) || 1),
    educationDiscountAmount,
    totalEducationDiscountAmount: educationDiscountAmount,
    serviceFeePerUnit: manualServiceFeePerUnit > 0 ? manualServiceFeePerUnit : groupConfig.serviceFeePerUnit,
    totalServiceFee: manualTotalServiceFee,
    orderNumber: normalizeText(record.orderNumber),
    serialNumbers: normalizedRecordSerials,
    status: '待出库同步',
    serviceRuleKey: normalizeText(record.serviceRuleKey) || undefined,
    serviceRuleLabel: firstNonEmptyText(record.serviceRuleLabel) || undefined,
    ruleText: normalizeText(record.ruleText) || undefined,
  }) && normalizedRecordSerials.length > 1 && Boolean(matchedPrimarySerial)
  const quantity = preferMatchedSingleRow ? 1 : Math.max(1, Number(record.quantity ?? 1) || 1)
  const resolvedServiceFeePerUnit = manualServiceFeePerUnit > 0 ? manualServiceFeePerUnit : groupConfig.serviceFeePerUnit
  const resolvedTotalServiceFee = manualTotalServiceFee > 0
    ? Number(manualTotalServiceFee.toFixed(2))
    : Number((resolvedServiceFeePerUnit * quantity).toFixed(2))
  const status: EducationSubsidyAgentScanRow['status'] = paymentReceived
    ? '已付'
    : matchedHistory || matchedSalesOutbound || matchedSalesOrder || record.outboundDate
      ? '未付'
      : '待出库同步'
  const outboundOrderNumber = extractOrderNumber(matchedSalesOutbound?.note, matchedSalesOutbound?.documentNumber)
  const preferMatchedOrderNumber = isPlaceholderOrderNumber(record.orderNumber)
    || (!isFormalOutboundOrderNumber(record.orderNumber) && Boolean(matchedHistory?.orderNumber || outboundOrderNumber || normalizeText(matchedSalesOrder?.order?.id)))
  const preferredOrderNumber = preferMatchedOrderNumber
    ? (matchedHistory?.orderNumber || outboundOrderNumber || normalizeText(matchedSalesOrder?.order?.id))
    : normalizeText(record.orderNumber)
  const outboundMatchSource: EducationSubsidyAgentScanRow['outboundMatchSource'] | undefined = matchedSalesOutbound
    ? 'sql_inventory_movements'
    : matchedSalesOrder
      ? 'manual_record'
    : matchedHistory
      ? 'marketing_boost_history'
      : record.outboundDate
        ? 'manual_record'
        : undefined
  const hasOutboundMatched = Boolean(matchedSalesOutbound || matchedSalesOrder || record.outboundDate)
  const normalizedRecordId = normalizeText(record.id)
  const resolvedId = normalizedRecordId
    ? (hasOutboundMatched ? normalizedRecordId.replace(/-pending-outbound$/i, '-matched-outbound') : normalizedRecordId)
    : `education-agent-scan-${hashText([productName, normalizeText(record.skuKey), normalizeText(record.pnMtm), scanDate, normalizeText(record.orderNumber)].join('|'))}`
  const baseRuleText = normalizeText(record.ruleText) || matchedHistory?.ruleText || ''
  const resolvedRuleText = hasOutboundMatched
    ? baseRuleText
      .replace(/先进入待出库同步；待后续出库流水同步后按 SN 自动匹配销售单。?/g, '')
      .replace(/智店通当前未见[^。]*。?/g, '')
      .replace(/智店通当前仅有采购入库[^。]*。?/g, '')
      .trim()
    : baseRuleText
  return {
    id: resolvedId,
    sourceType: record.sourceType === 'xhey_api_manual' || record.sourceType === 'watermark_camera_manual'
      ? record.sourceType
      : 'wechat_group_manual',
    sourceGroupName: groupConfig.name,
    collectionSource: groupConfig.collectionSource,
    sourceFile: record.sourceFile,
    scanDate,
    lockedDisplayDate: scanDate,
    productName: matchedHistory?.productName || normalizeText(matchedSalesOutbound?.productName) || normalizeText(matchedSalesOrder?.line?.productName) || productName || '待补型号',
    sourceSkuKey: normalizeText(record.skuKey),
    sourcePnMtm: normalizeText(record.pnMtm),
    skuKey: matchedHistory?.skuKey || normalizeText(matchedSalesOutbound?.skuKey) || normalizeText(matchedSalesOrder?.line?.skuKey) || normalizeText(record.skuKey),
    pnMtm: matchedHistory?.pnMtm || normalizeText(matchedSalesOutbound?.pnMtm) || normalizeText(matchedSalesOrder?.line?.pnMtm) || normalizeText(record.pnMtm),
    spec: matchedHistory?.spec || normalizeText(matchedSalesOutbound?.spec) || normalizeText(matchedSalesOrder?.line?.spec) || normalizeText(record.spec),
    category: matchedHistory?.category || normalizeText(record.category),
    quantity,
    educationDiscountAmount,
    scannedEducationDiscountAmount: scannedEducationDiscountAmount > 0 ? scannedEducationDiscountAmount : undefined,
    totalEducationDiscountAmount: Number((educationDiscountAmount * quantity).toFixed(2)),
    serviceFeePerUnit: resolvedServiceFeePerUnit,
    totalServiceFee: resolvedTotalServiceFee,
    orderNumber: preferredOrderNumber || normalizeText(record.orderNumber) || matchedHistory?.orderNumber || outboundOrderNumber || normalizeText(matchedSalesOrder?.order?.id),
    outboundDate: normalizeText(record.outboundDate) || matchedHistory?.outboundDate || matchedSalesOutbound?.businessDate || normalizeText(matchedSalesOrder?.order?.businessDate),
    outboundStoreName: normalizeText(record.outboundStoreName) || matchedHistory?.outboundStoreName || matchedSalesOutbound?.storeName || normalizeText(matchedSalesOrder?.order?.storeName),
    outboundOperatorName: normalizeText(record.outboundOperatorName) || matchedHistory?.outboundOperatorName || matchedSalesOutbound?.operatorName || normalizeText(matchedSalesOrder?.order?.operatorName),
    outboundMatchSource,
    matchedOutboundMovementId: matchedSalesOutbound?.id,
    matchedOutboundOrderId: preferredOrderNumber || normalizeText(record.orderNumber) || matchedHistory?.orderNumber || outboundOrderNumber || normalizeText(matchedSalesOrder?.order?.id),
    matchedSalesOrderId: preferredOrderNumber || normalizeText(record.orderNumber) || matchedHistory?.orderNumber || outboundOrderNumber || normalizeText(matchedSalesOrder?.order?.id),
    matchedOutboundSkuKey: normalizeText(matchedSalesOutbound?.skuKey) || normalizeText(matchedSalesOrder?.line?.skuKey),
    matchedOutboundPnMtm: normalizeText(matchedSalesOutbound?.pnMtm) || normalizeText(matchedSalesOrder?.line?.pnMtm),
    serialNumbers: preferMatchedSingleRow
      ? [matchedPrimarySerial as string]
      : normalizedRecordSerials.length
        ? normalizedRecordSerials
        : matchedHistory?.serialNumbers ?? (matchedSalesOutbound?.serialNumber ? [matchedSalesOutbound.serialNumber] : matchedSalesOrderSerials),
    paymentReceived,
    paymentReceivedAt: record.paymentReceivedAt,
    paymentReceivedNote: record.paymentReceivedNote,
    activityLabel: record.activityLabel || matchedHistory?.activityLabel || '教育补贴',
    customerName: firstNonEmptyText(record.customerName, record.customer),
    customerPhone: normalizePhone(firstNonEmptyText(record.customerPhone, record.customerPhoneNumber, record.phone, record.mobile)),
    agentPhone: normalizePhone(firstNonEmptyText(record.agentPhone, record.reportPhone)),
    modelText: firstNonEmptyText(record.modelText, record.model, record.spec),
    voucherCode: firstNonEmptyText(record.voucherCode, record.voucherNo, record.couponCode),
    voucherVerifiedAt: firstNonEmptyText(record.voucherVerifiedAt, record.verificationTime, record.verifiedAt),
    reportStatus: firstNonEmptyText(record.reportStatus) || '待上报',
    serviceRuleKey: explicitServiceRuleKey || undefined,
    serviceRuleLabel: firstNonEmptyText(record.serviceRuleLabel) || undefined,
    zhixiangjinAmount: Number(record.zhixiangjinAmount ?? 0) || undefined,
    ruleText: [
      resolvedRuleText,
      scannedEducationDiscountAmount > 0 && scannedEducationDiscountAmount !== educationDiscountAmount
        ? `群内图片核销值 ${scannedEducationDiscountAmount.toFixed(2)} 仅作代扫凭证，不覆盖正式教育补金额 ${educationDiscountAmount.toFixed(2)}。`
        : '',
    ].filter(Boolean).join(' '),
    status,
  }
}

function educationRowBusinessKey(row: EducationSubsidyAgentScanRow) {
  const identity = normalizeText(row.skuKey)
    ? `sku:${normalizeText(row.skuKey)}`
    : normalizeText(row.pnMtm)
      ? `pn:${normalizeText(row.pnMtm).toUpperCase()}`
      : `name:${normalizeText(row.productName).toUpperCase()}`
  const orderNumber = normalizeText(row.orderNumber) || `scan:${row.scanDate}`
  return [
    orderNumber,
    identity,
    row.totalEducationDiscountAmount,
    row.totalServiceFee,
    row.quantity,
  ].join('|')
}

function educationRowsShouldMerge(left: EducationSubsidyAgentScanRow, right: EducationSubsidyAgentScanRow) {
  if (resolveSourceGroupName(left.sourceGroupName, left.collectionSource) !== resolveSourceGroupName(right.sourceGroupName, right.collectionSource)) {
    return false
  }
  const leftSerials = normalizeSerialNumbers(left.serialNumbers)
  const rightSerials = normalizeSerialNumbers(right.serialNumbers)
  const hasSharedSerial = leftSerials.length > 0
    && rightSerials.length > 0
    && leftSerials.some((serial) => rightSerials.includes(serial))
  if (hasSharedSerial && left.scanDate === right.scanDate) return true
  if (educationRowBusinessKey(left) !== educationRowBusinessKey(right)) return false
  if (leftSerials.length === 0 || rightSerials.length === 0) return true
  return hasSharedSerial
}

function choosePreferredEducationRow(left: EducationSubsidyAgentScanRow, right: EducationSubsidyAgentScanRow) {
  const detailScore = (item: EducationSubsidyAgentScanRow) => (
    (normalizeText(item.customerName) ? 2 : 0)
    + (normalizePhone(item.customerPhone) ? 2 : 0)
    + (normalizePhone(item.agentPhone) ? 2 : 0)
    + (normalizeText(item.modelText) ? 1 : 0)
    + (normalizeText(item.voucherCode) ? 2 : 0)
    + (normalizeText(item.voucherVerifiedAt) ? 2 : 0)
    + (normalizeText(item.reportStatus) ? 1 : 0)
  )
  const leftScore = (
    normalizeSerialNumbers(left.serialNumbers).length * 10
    + (left.status === '已付' ? 6 : left.status === '未付' ? 3 : 0)
    + (left.outboundDate ? 3 : 0)
    + (left.outboundStoreName ? 1 : 0)
    + (left.outboundOperatorName ? 1 : 0)
    + detailScore(left)
  )
  const rightScore = (
    normalizeSerialNumbers(right.serialNumbers).length * 10
    + (right.status === '已付' ? 6 : right.status === '未付' ? 3 : 0)
    + (right.outboundDate ? 3 : 0)
    + (right.outboundStoreName ? 1 : 0)
    + (right.outboundOperatorName ? 1 : 0)
    + detailScore(right)
  )
  if (rightScore > leftScore) return right
  if (leftScore > rightScore) return left
  return (right.outboundDate || right.scanDate).localeCompare(left.outboundDate || left.scanDate) >= 0 ? right : left
}

function mergeEducationRows(left: EducationSubsidyAgentScanRow, right: EducationSubsidyAgentScanRow): EducationSubsidyAgentScanRow {
  const preferred = choosePreferredEducationRow(left, right)
  const fallback = preferred === left ? right : left
  return {
    ...fallback,
    ...preferred,
    id: preferred.id || fallback.id,
    serialNumbers: normalizeSerialNumbers([...left.serialNumbers, ...right.serialNumbers]),
    sourceSkuKey: preferred.sourceSkuKey || fallback.sourceSkuKey,
    sourcePnMtm: preferred.sourcePnMtm || fallback.sourcePnMtm,
    orderNumber: preferred.orderNumber || fallback.orderNumber,
    outboundDate: preferred.outboundDate || fallback.outboundDate,
    outboundStoreName: preferred.outboundStoreName || fallback.outboundStoreName,
    outboundOperatorName: preferred.outboundOperatorName || fallback.outboundOperatorName,
    outboundMatchSource: preferred.outboundMatchSource || fallback.outboundMatchSource,
    matchedOutboundSkuKey: preferred.matchedOutboundSkuKey || fallback.matchedOutboundSkuKey,
    matchedOutboundPnMtm: preferred.matchedOutboundPnMtm || fallback.matchedOutboundPnMtm,
    paymentReceived: preferred.paymentReceived ?? fallback.paymentReceived,
    paymentReceivedAt: preferred.paymentReceivedAt ?? fallback.paymentReceivedAt,
    paymentReceivedNote: preferred.paymentReceivedNote ?? fallback.paymentReceivedNote,
    activityLabel: preferred.activityLabel || fallback.activityLabel,
    customerName: preferred.customerName || fallback.customerName,
    customerPhone: preferred.customerPhone || fallback.customerPhone,
    agentPhone: preferred.agentPhone || fallback.agentPhone,
    modelText: preferred.modelText || fallback.modelText,
    voucherCode: preferred.voucherCode || fallback.voucherCode,
    voucherVerifiedAt: preferred.voucherVerifiedAt || fallback.voucherVerifiedAt,
    reportStatus: preferred.reportStatus || fallback.reportStatus,
    ruleText: Array.from(new Set([left.ruleText, right.ruleText].filter(Boolean))).join(' '),
    collectionSource: preferred.collectionSource || fallback.collectionSource,
    sourceGroupName: preferred.sourceGroupName || fallback.sourceGroupName,
    status: preferred.status,
  }
}

function createEmptySummary() {
  return {
    totalCount: 0,
    pendingOutboundCount: 0,
    unpaidCount: 0,
    paidCount: 0,
    matchedOutboundCount: 0,
    totalEducationDiscountAmount: 0,
    totalServiceFee: 0,
    unpaidServiceFee: 0,
    phoneMismatchCount: 0,
  }
}

function addRowToSummary<T extends ReturnType<typeof createEmptySummary>>(current: T, item: EducationSubsidyAgentScanRow) {
  current.totalCount += 1
  if (item.status === '待出库同步') current.pendingOutboundCount += 1
  if (item.status === '未付') current.unpaidCount += 1
  if (item.status === '已付') current.paidCount += 1
  if (item.outboundDate) current.matchedOutboundCount += 1
  current.totalEducationDiscountAmount = Number((current.totalEducationDiscountAmount + item.totalEducationDiscountAmount).toFixed(2))
  current.totalServiceFee = Number((current.totalServiceFee + item.totalServiceFee).toFixed(2))
  if (item.status !== '已付') current.unpaidServiceFee = Number((current.unpaidServiceFee + item.totalServiceFee).toFixed(2))
  if (item.customerPhone && item.agentPhone && item.customerPhone !== item.agentPhone) {
    current.phoneMismatchCount += 1
  }
  return current
}

function dedupeEducationRows(rows: EducationSubsidyAgentScanRow[]) {
  // 两个群必须分开保留；同一 SN 只在同组内去重，避免跨群串源。
  const byGroupSn = new Map<string, EducationSubsidyAgentScanRow>()
  const noSnRows: EducationSubsidyAgentScanRow[] = []

  for (const row of rows) {
    const serials = normalizeSerialNumbers(row.serialNumbers)
    const groupKey = resolveSourceGroupName(row.sourceGroupName, row.collectionSource)
    const normalizedRow = {
      ...row,
      sourceGroupName: groupKey,
      collectionSource: getGroupFeeConfig(groupKey).collectionSource,
      serialNumbers: serials,
    }
    if (!serials.length) {
      noSnRows.push(normalizedRow)
      continue
    }
    // 历史套装候选先单独保留，避免多 SN 占位行吞掉后续补录的真实单扫记录。
    if (isEducationAgentBundlePlaceholder(normalizedRow) && serials.length > 1) {
      noSnRows.push(normalizedRow)
      continue
    }
    for (const serial of serials) {
      const key = `${groupKey}::${serial.toUpperCase()}`
      const current = byGroupSn.get(key)
      if (!current) {
        byGroupSn.set(key, normalizedRow)
        continue
      }
      byGroupSn.set(key, mergeEducationRows(current, normalizedRow))
    }
  }

  // 无 SN 的行按旧逻辑做弱去重，避免完全丢失记录。
  const fallbackBuckets = new Map<string, EducationSubsidyAgentScanRow[]>()
  for (const row of noSnRows) {
    const key = educationRowBusinessKey(row)
    const candidates = fallbackBuckets.get(key) ?? []
    const existingIndex = candidates.findIndex((item) => educationRowsShouldMerge(item, row))
    if (existingIndex >= 0) {
      candidates[existingIndex] = mergeEducationRows(candidates[existingIndex], row)
    } else {
      candidates.push(row)
    }
    fallbackBuckets.set(key, candidates)
  }

  const collapseRows = (items: EducationSubsidyAgentScanRow[]) => {
    const merged = new Map<string, EducationSubsidyAgentScanRow[]>()
    for (const row of items) {
      const groupKey = resolveSourceGroupName(row.sourceGroupName, row.collectionSource)
      const serialKey = normalizeSerialNumbers(row.serialNumbers).join('|')
      const rowKey = row.id || [
        groupKey,
        normalizeText(row.orderNumber),
        normalizeText(row.scanDate),
        normalizeText(row.productName),
        serialKey,
      ].join('::')
      const bucket = merged.get(rowKey) ?? []
      const existingIndex = bucket.findIndex((item) => educationRowsShouldMerge(item, row))
      if (existingIndex >= 0) {
        bucket[existingIndex] = mergeEducationRows(bucket[existingIndex], row)
      } else {
        bucket.push(row)
      }
      merged.set(rowKey, bucket)
    }
    return Array.from(merged.values()).flat()
  }

  return collapseRows([
    ...Array.from(byGroupSn.values()),
    ...Array.from(fallbackBuckets.values()).flat(),
  ])
}

function getPrimaryCategoryTag(row: EducationSubsidyAgentScanRow) {
  const text = `${normalizeText(row.category)} ${normalizeText(row.productName)} ${normalizeText(row.spec)}`.toLowerCase()
  if (/打印机|printer|喷墨|激光/.test(text)) return 'printer'
  if (/平板|tablet|tab|pad/.test(text)) return 'tablet'
  if (/手机|moto|motorola|razr|edge/.test(text)) return 'phone'
  if (/显示器|monitor|屏/.test(text)) return 'display'
  if (/游戏|拯救者|legion|y7000|y9000|r7000|r9000|斗战者|战7000/.test(text)) return 'gaming_pc'
  if (/台式|主机|一体机|笔记本|电脑|小新|yoga|thinkpad|thinkbook|来酷/.test(text)) return 'pc'
  return 'other'
}

function getBundleProductTypeFromText(text: string): EducationAgentBundleProductType {
  const normalized = text.toLowerCase()
  if (/打印机|printer|喷墨|激光/.test(normalized)) return 'printer'
  if (/平板|tablet|tab|pad/.test(normalized)) return 'tablet'
  if (/手机|moto|motorola|razr|edge/.test(normalized)) return 'phone'
  if (/台式|主机|一体机|笔记本|电脑|小新|yoga|thinkpad|thinkbook|来酷|拯救者|legion|y7000|y9000|r7000|r9000/.test(normalized)) return 'pc'
  return 'other'
}

function isLegionPcText(text: string) {
  return /拯救者|legion|y7000|y9000|r7000|r9000/.test(text.toLowerCase())
}

function getBundleProductTypeFromMarketingItem(item: {
  category?: string
  productName?: string
  spec?: string
  ruleText?: string
  rawText?: string
}) {
  return getBundleProductTypeFromText([
    normalizeText(item.category),
    normalizeText(item.productName),
    normalizeText(item.spec),
    normalizeText(item.ruleText),
    normalizeText(item.rawText),
  ].join(' '))
}

function isEducationAgentBundlePlaceholder(row: EducationSubsidyAgentScanRow) {
  const pnMtm = normalizePnMtm(row.pnMtm)
  const orderNumber = normalizeText(row.orderNumber)
  const combinedText = [
    normalizeText(row.productName),
    normalizeText(row.serviceRuleKey),
    normalizeText(row.serviceRuleLabel),
    normalizeText(row.ruleText),
  ].join(' ')
  return /^THREE-PIECE-|^TWO-PIECE-/i.test(orderNumber)
    || /三件套|两件套|双屏/.test(combinedText)
    || (
      (pnMtm === 'PENDING' || /^PENDING/i.test(orderNumber))
      && /套装|候选|锦鲤|双屏|三件套|两件套/.test(combinedText)
    )
}

function appendRuleNote(existing: string | undefined, note: string) {
  const normalizedExisting = normalizeText(existing)
  if (!normalizedExisting) return note
  if (normalizedExisting.includes(note)) return normalizedExisting
  return `${normalizedExisting} ${note}`.trim()
}

function isSyntheticGeneratedBundleRow(row: EducationSubsidyAgentScanRow) {
  const orderNumber = normalizeText(row.orderNumber)
  const productName = normalizeText(row.productName)
  const serialCount = normalizeSerialNumbers(row.serialNumbers).length
  return /^THREE-PIECE-|^TWO-PIECE-|^PENDING-PRINTER-BUNDLE/i.test(orderNumber)
    || /三件套（|两件套（|打印机两件套/.test(productName)
    || (row.serviceRuleKey === EDUCATION_AGENT_SCAN_UNMATCHED_BUNDLE_RULE_KEY && !serialCount)
}

function getEffectiveRowPnMtm(row: EducationSubsidyAgentScanRow) {
  return normalizePnMtm(row.matchedOutboundPnMtm || row.pnMtm || row.sourcePnMtm)
}

function shouldApplyZdtPhoneBundleRule(row: EducationSubsidyAgentScanRow) {
  return (
    row.sourceGroupName === '智店通入库群'
    && (row.scanDate || '') >= '2026-05-31'
    && !isFormalOutboundOrderNumber(row.orderNumber)
  )
}

function fillZdtCustomerInfo(rows: EducationSubsidyAgentScanRow[]) {
  const grouped = new Map<string, EducationSubsidyAgentScanRow[]>()
  for (const row of rows) {
    if (row.sourceGroupName !== '智店通入库群') continue
    const phone = normalizePhone(row.customerPhone || row.agentPhone)
    if (!phone) continue
    const key = `${row.scanDate}::${phone}`
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }

  return rows.map((row) => {
    if (row.sourceGroupName !== '智店通入库群') return row
    const phone = normalizePhone(row.customerPhone || row.agentPhone)
    if (!phone) return row
    const bucket = grouped.get(`${row.scanDate}::${phone}`) ?? []
    if (!bucket.length) return row
    const preferred = bucket
      .slice()
      .sort((left, right) => {
        const leftName = normalizeText(left.customerName)
        const rightName = normalizeText(right.customerName)
        const leftScore = (leftName && leftName !== '未知' ? 3 : 0) + (normalizePhone(left.customerPhone) ? 2 : 0) + (normalizePhone(left.agentPhone) ? 1 : 0)
        const rightScore = (rightName && rightName !== '未知' ? 3 : 0) + (normalizePhone(right.customerPhone) ? 2 : 0) + (normalizePhone(right.agentPhone) ? 1 : 0)
        return rightScore - leftScore
      })[0]
    const preferredName = normalizeText(preferred?.customerName)
    return {
      ...row,
      customerName: normalizeText(row.customerName) && normalizeText(row.customerName) !== '未知'
        ? row.customerName
        : (preferredName && preferredName !== '未知' ? preferred?.customerName : row.customerName),
      customerPhone: normalizePhone(row.customerPhone || preferred?.customerPhone || phone),
      agentPhone: normalizePhone(row.agentPhone || preferred?.agentPhone || phone),
    }
  })
}

function resolvePhoneBundleMatch(
  groupRows: EducationSubsidyAgentScanRow[],
  eligibilityByPn: Map<string, EducationAgentBundleEligibility>,
) {
  if (groupRows.length < 2) return undefined
  const distinctFormalOrderNumbers = Array.from(new Set(
    groupRows
      .map((row) => normalizeText(row.orderNumber))
      .filter((orderNumber) => isFormalOutboundOrderNumber(orderNumber)),
  ))
  if (distinctFormalOrderNumbers.length > 1) return undefined
  const lines = groupRows.map((row) => {
    const pnMtm = getEffectiveRowPnMtm(row)
    const eligibility = eligibilityByPn.get(pnMtm)
    const combinedText = `${normalizeText(row.productName)} ${normalizeText(row.spec)} ${pnMtm}`
    return {
      row,
      pnMtm,
      productType: eligibility?.productType ?? getBundleProductTypeFromText(combinedText),
      isLegionPc: isLegionPcText(combinedText),
      ruleKeys: eligibility?.ruleKeys ?? new Set<EducationAgentBundleRuleKey>(),
    }
  }).filter((line) => line.pnMtm || line.productType !== 'other')
  if (lines.length < 2) return undefined

  const buildRuleMatch = (ruleKey: EducationAgentBundleRuleKey) => {
    const matchedLines = lines.filter((line) => line.ruleKeys.has(ruleKey))
    const pnMtms = Array.from(new Set(matchedLines.map((line) => line.pnMtm).filter(Boolean)))
    const productTypes = Array.from(new Set(matchedLines.map((line) => line.productType)))
    return { matchedLines, pnMtms, productTypes }
  }

  const threePiece = buildRuleMatch('three_piece_bundle')
  if (
    threePiece.matchedLines.length >= 3
    && ['pc', 'tablet', 'phone'].every((type) => threePiece.productTypes.includes(type as EducationAgentBundleProductType))
  ) {
    const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.three_piece_bundle
    return {
      ruleKey: rule.key,
      label: rule.label,
      activityLabel: rule.activityLabel,
      totalServiceFee: rule.totalServiceFee,
      zhixiangjinAmount: rule.zhixiangjinAmount,
      matchedRowIds: threePiece.matchedLines.map((line) => line.row.id),
      matchedPnMtms: threePiece.pnMtms,
      matchedProductTypes: threePiece.productTypes,
    }
  }

  const allPnMtms = Array.from(new Set(lines.map((line) => line.pnMtm).filter(Boolean)))
  const allProductTypes = Array.from(new Set(lines.map((line) => line.productType)))
  if (
    lines.length >= 3
    && ['pc', 'tablet', 'phone'].every((type) => allProductTypes.includes(type as EducationAgentBundleProductType))
  ) {
    const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.three_piece_bundle
    return {
      ruleKey: rule.key,
      label: rule.label,
      activityLabel: rule.activityLabel,
      totalServiceFee: rule.totalServiceFee,
      zhixiangjinAmount: rule.zhixiangjinAmount,
      matchedRowIds: lines.map((line) => line.row.id),
      matchedPnMtms: allPnMtms,
      matchedProductTypes: allProductTypes,
    }
  }

  const legion = buildRuleMatch('legion_dual_screen_combo')
  if (legion.matchedLines.length >= 2 && legion.productTypes.length >= 2) {
    const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.legion_dual_screen_combo
    return {
      ruleKey: rule.key,
      label: rule.label,
      activityLabel: rule.activityLabel,
      totalServiceFee: rule.totalServiceFee,
      zhixiangjinAmount: rule.zhixiangjinAmount,
      matchedRowIds: legion.matchedLines.map((line) => line.row.id),
      matchedPnMtms: legion.pnMtms,
      matchedProductTypes: legion.productTypes,
    }
  }

  if (
    lines.length >= 2
    && allProductTypes.includes('pc')
    && allProductTypes.includes('tablet')
    && (lines.some((line) => line.ruleKeys.has('legion_dual_screen_combo')) || lines.some((line) => line.productType === 'pc' && line.isLegionPc))
  ) {
    const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.legion_dual_screen_combo
    return {
      ruleKey: rule.key,
      label: rule.label,
      activityLabel: rule.activityLabel,
      totalServiceFee: rule.totalServiceFee,
      zhixiangjinAmount: rule.zhixiangjinAmount,
      matchedRowIds: lines.map((line) => line.row.id),
      matchedPnMtms: allPnMtms,
      matchedProductTypes: allProductTypes,
    }
  }

  const twoPiece = buildRuleMatch('two_piece_bundle')
  if (twoPiece.matchedLines.length >= 2 && twoPiece.productTypes.length >= 2) {
    const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.two_piece_bundle
    return {
      ruleKey: rule.key,
      label: rule.label,
      activityLabel: rule.activityLabel,
      totalServiceFee: rule.totalServiceFee,
      zhixiangjinAmount: rule.zhixiangjinAmount,
      matchedRowIds: twoPiece.matchedLines.map((line) => line.row.id),
      matchedPnMtms: twoPiece.pnMtms,
      matchedProductTypes: twoPiece.productTypes,
    }
  }

  if (lines.length >= 2 && allProductTypes.length >= 2) {
    const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.two_piece_bundle
    return {
      ruleKey: rule.key,
      label: rule.label,
      activityLabel: rule.activityLabel,
      totalServiceFee: rule.totalServiceFee,
      zhixiangjinAmount: rule.zhixiangjinAmount,
      matchedRowIds: lines.map((line) => line.row.id),
      matchedPnMtms: allPnMtms,
      matchedProductTypes: allProductTypes,
    }
  }

  return undefined
}

function buildMarketingBundleEligibilityMap(marketingBoost?: MarketingBoostSnapshot | null) {
  const eligibilityByPn = new Map<string, EducationAgentBundleEligibility>()
  const register = (
    pnMtmValue: string | undefined,
    productType: EducationAgentBundleProductType,
    activityLabel?: string,
    ruleText?: string,
    rawText?: string,
  ) => {
    const pnMtm = normalizePnMtm(pnMtmValue)
    if (!pnMtm) return
    const text = [normalizeText(activityLabel), normalizeText(ruleText), normalizeText(rawText)].join(' ')
    const matchedRuleKeys = new Set<EducationAgentBundleRuleKey>()
    if (/青春有ai三件套/i.test(text)) matchedRuleKeys.add('three_piece_bundle')
    if (/锦鲤跃龙门两件套/i.test(text)) matchedRuleKeys.add('two_piece_bundle')
    if (/拯救者双屏畅玩两件套/i.test(text)) matchedRuleKeys.add('legion_dual_screen_combo')
    const normalizedRawText = normalizeText(rawText)
    if (!matchedRuleKeys.size && normalizedRawText) {
      if (/[|｜]\s*✔\s*[|｜]\s*✔\s*[|｜]\s*✔/.test(normalizedRawText)) {
        matchedRuleKeys.add('three_piece_bundle')
        matchedRuleKeys.add('two_piece_bundle')
        matchedRuleKeys.add('legion_dual_screen_combo')
      } else if (/[|｜]\s*✔\s*[|｜]\s*✔\s*[|｜]\s*×/.test(normalizedRawText)) {
        matchedRuleKeys.add('three_piece_bundle')
        matchedRuleKeys.add('two_piece_bundle')
      } else if (/[|｜]\s*✔\s*[|｜]\s*×\s*[|｜]\s*✔/.test(normalizedRawText)) {
        matchedRuleKeys.add('three_piece_bundle')
        matchedRuleKeys.add('legion_dual_screen_combo')
      } else if (/[|｜]\s*×\s*[|｜]\s*✔\s*[|｜]\s*✔/.test(normalizedRawText)) {
        matchedRuleKeys.add('two_piece_bundle')
        matchedRuleKeys.add('legion_dual_screen_combo')
      } else if (/[|｜]\s*✔\s*[|｜]\s*×\s*[|｜]\s*×/.test(normalizedRawText)) {
        matchedRuleKeys.add('three_piece_bundle')
      } else if (/[|｜]\s*×\s*[|｜]\s*✔\s*[|｜]\s*×/.test(normalizedRawText)) {
        matchedRuleKeys.add('two_piece_bundle')
      } else if (/[|｜]\s*×\s*[|｜]\s*×\s*[|｜]\s*✔/.test(normalizedRawText)) {
        matchedRuleKeys.add('legion_dual_screen_combo')
      }
    }
    if (!matchedRuleKeys.size) return
    const current = eligibilityByPn.get(pnMtm) ?? { pnMtm, productType, ruleKeys: new Set<EducationAgentBundleRuleKey>() }
    current.productType = current.productType === 'other' ? productType : current.productType
    for (const ruleKey of matchedRuleKeys) current.ruleKeys.add(ruleKey)
    eligibilityByPn.set(pnMtm, current)
  }

  for (const item of marketingBoost?.eligibleInventory ?? []) {
    register(item.pnMtm, getBundleProductTypeFromMarketingItem(item), item.activityLabel, item.ruleText)
  }
  for (const item of marketingBoost?.activities ?? []) {
    register(item.pnMtm, getBundleProductTypeFromMarketingItem(item), item.activityLabel, item.ruleText, item.rawText)
  }
  for (const item of marketingBoost?.activityHistory ?? []) {
    register(item.pnMtm, getBundleProductTypeFromMarketingItem(item), item.activityLabel, item.ruleText, item.rawText)
  }
  return eligibilityByPn
}

function buildSalesOrderBundleMatchMap(
  salesOrders: ZhidiantongSalesOrder[],
  eligibilityByPn: Map<string, EducationAgentBundleEligibility>,
) {
  const bundleMatchByOrder = new Map<string, EducationAgentBundleSalesOrderMatch>()
  for (const order of salesOrders) {
    const orderNumber = normalizeText(order.id)
    if (!orderNumber) continue
    if (EXCLUDED_FAKE_BUNDLE_ORDER_NUMBERS.has(orderNumber)) continue
    const lines = (order.lines ?? []).map((line) => {
      const pnMtm = normalizePnMtm(line.pnMtm)
      const eligibility = eligibilityByPn.get(pnMtm)
      const combinedText = `${normalizeText(line.productName)} ${normalizeText(line.spec)} ${pnMtm}`
      return {
        pnMtm,
        productType: eligibility?.productType ?? getBundleProductTypeFromText(combinedText),
        ruleKeys: eligibility?.ruleKeys ?? new Set<EducationAgentBundleRuleKey>(),
        isLegionPc: isLegionPcText(combinedText),
        serialNumber: normalizeSerialNumbers(line.serialNumbers)[0] ?? '',
      }
    }).filter((line) => line.pnMtm || line.productType !== 'other')
    if (lines.length < 2) continue

    const allProductTypes = Array.from(new Set(lines.map((line) => line.productType))).filter((item) => item !== 'other')
    const allPnMtms = Array.from(new Set(lines.map((line) => line.pnMtm).filter(Boolean)))
    const allSerialNumbers = Array.from(new Set(lines.map((line) => line.serialNumber).filter(Boolean)))
    if (allProductTypes.length < 2) continue
    if (allSerialNumbers.length < 2) continue

    const matchByRule = new Map<EducationAgentBundleRuleKey, { pnMtms: string[]; productTypes: EducationAgentBundleProductType[] }>()
    for (const ruleKey of EDUCATION_AGENT_SCAN_BUNDLE_RULE_KEYS) {
      const eligibleLines = lines.filter((line) => line.ruleKeys.has(ruleKey))
      const pnMtms = Array.from(new Set(eligibleLines.map((line) => line.pnMtm)))
      const productTypes = Array.from(new Set(eligibleLines.map((line) => line.productType)))
      if (!pnMtms.length) continue
      matchByRule.set(ruleKey, { pnMtms, productTypes })
    }

    const threePiece = matchByRule.get('three_piece_bundle')
    if (threePiece && ['pc', 'tablet', 'phone'].every((type) => threePiece.productTypes.includes(type as EducationAgentBundleProductType))) {
      const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.three_piece_bundle
      bundleMatchByOrder.set(orderNumber, {
        orderNumber,
        ruleKey: rule.key,
        label: rule.label,
        activityLabel: rule.activityLabel,
        totalServiceFee: rule.totalServiceFee,
        zhixiangjinAmount: rule.zhixiangjinAmount,
        matchedPnMtms: threePiece.pnMtms,
        matchedProductTypes: threePiece.productTypes,
        matchedSerialNumbers: allSerialNumbers,
      })
      continue
    }

    if (
      allProductTypes.includes('pc')
      && allProductTypes.includes('tablet')
      && allProductTypes.includes('phone')
    ) {
      const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.three_piece_bundle
      bundleMatchByOrder.set(orderNumber, {
        orderNumber,
        ruleKey: rule.key,
        label: rule.label,
        activityLabel: rule.activityLabel,
        totalServiceFee: rule.totalServiceFee,
        zhixiangjinAmount: rule.zhixiangjinAmount,
        matchedPnMtms: allPnMtms,
        matchedProductTypes: allProductTypes,
        matchedSerialNumbers: allSerialNumbers,
      })
      continue
    }

    const legion = matchByRule.get('legion_dual_screen_combo')
    if (legion && legion.productTypes.length >= 2) {
      const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.legion_dual_screen_combo
      bundleMatchByOrder.set(orderNumber, {
        orderNumber,
        ruleKey: rule.key,
        label: rule.label,
        activityLabel: rule.activityLabel,
        totalServiceFee: rule.totalServiceFee,
        zhixiangjinAmount: rule.zhixiangjinAmount,
        matchedPnMtms: legion.pnMtms,
        matchedProductTypes: legion.productTypes,
        matchedSerialNumbers: allSerialNumbers,
      })
      continue
    }

    if (
      allProductTypes.includes('pc')
      && allProductTypes.includes('tablet')
      && lines.some((line) => line.isLegionPc)
    ) {
      const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.legion_dual_screen_combo
      bundleMatchByOrder.set(orderNumber, {
        orderNumber,
        ruleKey: rule.key,
        label: rule.label,
        activityLabel: rule.activityLabel,
        totalServiceFee: rule.totalServiceFee,
        zhixiangjinAmount: rule.zhixiangjinAmount,
        matchedPnMtms: allPnMtms,
        matchedProductTypes: allProductTypes,
        matchedSerialNumbers: allSerialNumbers,
      })
      continue
    }

    const twoPiece = matchByRule.get('two_piece_bundle')
    if (twoPiece && twoPiece.productTypes.length >= 2) {
      const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.two_piece_bundle
      bundleMatchByOrder.set(orderNumber, {
        orderNumber,
        ruleKey: rule.key,
        label: rule.label,
        activityLabel: rule.activityLabel,
        totalServiceFee: rule.totalServiceFee,
        zhixiangjinAmount: rule.zhixiangjinAmount,
        matchedPnMtms: twoPiece.pnMtms,
        matchedProductTypes: twoPiece.productTypes,
        matchedSerialNumbers: allSerialNumbers,
      })
      continue
    }

    if (allProductTypes.includes('pc') && allProductTypes.length >= 2) {
      const rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.two_piece_bundle
      bundleMatchByOrder.set(orderNumber, {
        orderNumber,
        ruleKey: rule.key,
        label: rule.label,
        activityLabel: rule.activityLabel,
        totalServiceFee: rule.totalServiceFee,
        zhixiangjinAmount: rule.zhixiangjinAmount,
        matchedPnMtms: allPnMtms,
        matchedProductTypes: allProductTypes,
        matchedSerialNumbers: allSerialNumbers,
      })
    }
  }
  return bundleMatchByOrder
}

function buildRetailCoreSalesOrderBundleMatchMap(
  salesOrders: RetailCoreSalesOrderRecord[],
) {
  const bundleMatchByOrder = new Map<string, EducationAgentBundleSalesOrderMatch>()
  const lookup = buildRetailCoreSalesOrderLookup(salesOrders)
  for (const order of lookup.byOrder.values()) {
    const orderNumber = order.orderNumber
    if (!orderNumber) continue
    if (EXCLUDED_FAKE_BUNDLE_ORDER_NUMBERS.has(orderNumber)) continue
    if (/取消|退货|退款/.test(normalizeText(order.statusName))) continue
    const lines = order.lines.map((line) => {
      const pnMtm = normalizePnMtm(line.pnMtm)
      const combinedText = `${normalizeText(line.productName)} ${normalizeText(line.spec)} ${pnMtm}`
      return {
        pnMtm,
        productType: getBundleProductTypeFromText(combinedText),
        isLegionPc: isLegionPcText(combinedText),
        serialNumbers: normalizeSerialNumbers(line.serialNumbers ?? []),
      }
    }).filter((line) => line.pnMtm || line.productType !== 'other')
    if (lines.length < 2) continue
    const allProductTypes = Array.from(new Set(lines.map((line) => line.productType))).filter((item) => item !== 'other')
    const allPnMtms = Array.from(new Set(lines.map((line) => line.pnMtm).filter(Boolean)))
    const allSerialNumbers = Array.from(new Set(lines.flatMap((line) => line.serialNumbers).filter(Boolean)))
    if (allProductTypes.length < 2) continue
    if (allSerialNumbers.length < 2) continue

    let rule:
      | typeof EDUCATION_AGENT_SCAN_BUNDLE_RULES.two_piece_bundle
      | typeof EDUCATION_AGENT_SCAN_BUNDLE_RULES.three_piece_bundle
      | typeof EDUCATION_AGENT_SCAN_BUNDLE_RULES.legion_dual_screen_combo
      = EDUCATION_AGENT_SCAN_BUNDLE_RULES.two_piece_bundle
    if (allProductTypes.includes('pc') && allProductTypes.includes('tablet') && allProductTypes.includes('phone')) {
      rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.three_piece_bundle
    } else if (allProductTypes.includes('pc') && allProductTypes.includes('tablet') && lines.some((line) => line.isLegionPc)) {
      rule = EDUCATION_AGENT_SCAN_BUNDLE_RULES.legion_dual_screen_combo
    }
    bundleMatchByOrder.set(orderNumber, {
      orderNumber,
      ruleKey: rule.key,
      label: rule.label,
      activityLabel: rule.activityLabel,
      totalServiceFee: rule.totalServiceFee,
      zhixiangjinAmount: rule.zhixiangjinAmount,
      matchedPnMtms: allPnMtms,
      matchedProductTypes: allProductTypes,
      matchedSerialNumbers: allSerialNumbers,
    })
  }
  return bundleMatchByOrder
}

function applyBundleServiceRules(
  rows: EducationSubsidyAgentScanRow[],
  salesOrders: ZhidiantongSalesOrder[],
  retailCoreSalesOrders: RetailCoreSalesOrderRecord[],
  marketingBoost?: MarketingBoostSnapshot | null,
) {
  const eligibilityByPn = buildMarketingBundleEligibilityMap(marketingBoost)
  const salesOrderBundleMatchByOrder = buildSalesOrderBundleMatchMap(salesOrders, eligibilityByPn)
  const retailCoreBundleMatchByOrder = buildRetailCoreSalesOrderBundleMatchMap(retailCoreSalesOrders)
  const normalizedRows = fillZdtCustomerInfo(rows).map((row) => ({ ...row }))
  const retainedRows = normalizedRows.filter((row) => !isSyntheticGeneratedBundleRow(row))
  const phoneGroupMatchByRowId = new Map<string, {
    ruleKey: EducationAgentBundleRuleKey
    label: string
    activityLabel: string
    totalServiceFee: number
    zhixiangjinAmount: number
    matchedRowIds: string[]
    matchedPnMtms: string[]
    matchedProductTypes: EducationAgentBundleProductType[]
    groupKey: string
  }>()
  const phoneGroupedRows = new Map<string, EducationSubsidyAgentScanRow[]>()

  for (const row of retainedRows) {
    if (!shouldApplyZdtPhoneBundleRule(row)) continue
    const phone = normalizePhone(row.customerPhone || row.agentPhone)
    if (!phone) continue
    const key = `${row.scanDate}::${phone}`
    const bucket = phoneGroupedRows.get(key) ?? []
    bucket.push(row)
    phoneGroupedRows.set(key, bucket)
  }

  for (const [groupKey, groupRows] of phoneGroupedRows) {
    const match = resolvePhoneBundleMatch(groupRows, eligibilityByPn)
    if (!match) continue
    for (const rowId of match.matchedRowIds) {
      phoneGroupMatchByRowId.set(rowId, { ...match, groupKey })
    }
  }

  for (const row of retainedRows) {
    const groupFeeConfig = getGroupFeeConfig(row.sourceGroupName)
    const quantity = Math.max(1, Number(row.quantity ?? 1) || 1)
    const phoneBundleMatch = phoneGroupMatchByRowId.get(row.id)

    row.bundleGroupId = undefined
    row.bundleMatchedOrderNumber = undefined
    row.bundleMatchedPnMtms = undefined
    row.bundleMatchedProductTypes = undefined
    row.bundleChargeApplied = false
    row.bundleTotalServiceFee = undefined
    row.bundleTotalZhixiangjinAmount = undefined
    row.serviceRuleKey = undefined
    row.serviceRuleLabel = undefined
    row.zhixiangjinAmount = 0

    if (phoneBundleMatch) {
      const bundleRows = (phoneGroupedRows.get(phoneBundleMatch.groupKey) ?? [])
        .filter((item) => phoneBundleMatch.matchedRowIds.includes(item.id))
        .sort((left, right) => (
          getEffectiveRowPnMtm(left).localeCompare(getEffectiveRowPnMtm(right))
          || left.id.localeCompare(right.id)
        ))
      const carrierId = bundleRows[0]?.id
      const isCarrier = carrierId === row.id
      row.serviceRuleKey = phoneBundleMatch.ruleKey
      row.serviceRuleLabel = phoneBundleMatch.label
      row.activityLabel = phoneBundleMatch.activityLabel
      row.bundleGroupId = `${phoneBundleMatch.ruleKey}:${phoneBundleMatch.groupKey}`
      row.bundleMatchedOrderNumber = normalizeText(row.orderNumber)
      row.bundleMatchedPnMtms = phoneBundleMatch.matchedPnMtms
      row.bundleMatchedProductTypes = phoneBundleMatch.matchedProductTypes
      row.bundleChargeApplied = isCarrier
      row.bundleTotalServiceFee = phoneBundleMatch.totalServiceFee
      row.bundleTotalZhixiangjinAmount = phoneBundleMatch.zhixiangjinAmount
      row.serviceFeePerUnit = isCarrier ? phoneBundleMatch.totalServiceFee : 0
      row.totalServiceFee = isCarrier ? phoneBundleMatch.totalServiceFee : 0
      row.zhixiangjinAmount = isCarrier ? phoneBundleMatch.zhixiangjinAmount : 0
      row.ruleText = appendRuleNote(
        row.ruleText,
        `按同手机号同日上报与营销库 MTM 粗筛匹配为${phoneBundleMatch.activityLabel}；代扫费用按套装整单计费，仅首条持久化载体行计费。`,
      )
      continue
    }

    const orderNumber = normalizeText(row.orderNumber)
    const salesOrderBundleMatch = orderNumber
      ? (salesOrderBundleMatchByOrder.get(orderNumber) ?? retailCoreBundleMatchByOrder.get(orderNumber))
      : undefined
    const normalizedCustomerName = normalizeText(row.customerName)
    const hasNamedMatch = Boolean(
      salesOrderBundleMatch
      && normalizedCustomerName
      && normalizedCustomerName !== '未知',
    )

    if (salesOrderBundleMatch && hasNamedMatch && row.sourceGroupName === '智店通入库群') {
      const orderRows = retainedRows
        .filter((item) => normalizeText(item.orderNumber) === orderNumber)
        .filter((item) => {
          const itemName = normalizeText(item.customerName)
          return Boolean(itemName && itemName !== '未知')
        })
        .sort((left, right) => (
          getEffectiveRowPnMtm(left).localeCompare(getEffectiveRowPnMtm(right))
          || left.id.localeCompare(right.id)
        ))
      const carrierId = orderRows[0]?.id
      const isCarrier = carrierId === row.id
      row.serviceRuleKey = salesOrderBundleMatch.ruleKey
      row.serviceRuleLabel = salesOrderBundleMatch.label
      row.activityLabel = salesOrderBundleMatch.activityLabel
      row.bundleGroupId = `${salesOrderBundleMatch.ruleKey}:order::${orderNumber}`
      row.bundleMatchedOrderNumber = orderNumber
      row.bundleMatchedPnMtms = salesOrderBundleMatch.matchedPnMtms
      row.bundleMatchedProductTypes = salesOrderBundleMatch.matchedProductTypes
      row.bundleChargeApplied = isCarrier
      row.bundleTotalServiceFee = salesOrderBundleMatch.totalServiceFee
      row.bundleTotalZhixiangjinAmount = salesOrderBundleMatch.zhixiangjinAmount
      row.serviceFeePerUnit = isCarrier ? salesOrderBundleMatch.totalServiceFee : 0
      row.totalServiceFee = isCarrier ? salesOrderBundleMatch.totalServiceFee : 0
      row.zhixiangjinAmount = isCarrier ? salesOrderBundleMatch.zhixiangjinAmount : 0
      row.ruleText = appendRuleNote(
        row.ruleText,
        `按真实销售单 ${orderNumber} 与姓名+SN 命中归类为${salesOrderBundleMatch.activityLabel}；代扫费用按套装整单计费，仅首条持久化载体行计费。`,
      )
      continue
    }

    row.serviceFeePerUnit = groupFeeConfig.serviceFeePerUnit
    row.totalServiceFee = Number((groupFeeConfig.serviceFeePerUnit * quantity).toFixed(2))
    row.ruleText = appendRuleNote(
      row.ruleText,
      `未命中营销库套装 MTM 与同销售出库单组合，按${groupFeeConfig.name}普通代扫规则持久化计费。`,
    )
  }

  return retainedRows
}

function buildEducationBundleSummary(rows: EducationSubsidyAgentScanRow[]): EducationAgentBundleSummary {
  const bundleGroups = new Map<string, EducationSubsidyAgentScanRow[]>()
  for (const row of rows) {
    const groupKey = row.bundleGroupId
      || (row.serviceRuleKey === EDUCATION_AGENT_SCAN_UNMATCHED_BUNDLE_RULE_KEY ? `unresolved:${row.id}` : '')
    if (!groupKey) continue
    const bucket = bundleGroups.get(groupKey) ?? []
    bucket.push(row)
    bundleGroups.set(groupKey, bucket)
  }

  const summary: EducationAgentBundleSummary = {
    totalGroups: bundleGroups.size,
    unresolvedCount: 0,
    threePieceCount: 0,
    twoPieceCount: 0,
    legionCount: 0,
    pendingCount: 0,
    unpaidCount: 0,
    paidCount: 0,
    totalServiceFee: 0,
    totalZhixiangjinAmount: 0,
  }

  for (const [, groupRows] of bundleGroups) {
    const representative = groupRows[0]
    if (representative.serviceRuleKey === EDUCATION_AGENT_SCAN_UNMATCHED_BUNDLE_RULE_KEY) summary.unresolvedCount += 1
    if (representative.serviceRuleKey === 'three_piece_bundle') summary.threePieceCount += 1
    if (representative.serviceRuleKey === 'two_piece_bundle') summary.twoPieceCount += 1
    if (representative.serviceRuleKey === 'legion_dual_screen_combo') summary.legionCount += 1
    const statuses = new Set(groupRows.map((item) => item.status))
    if (statuses.has('待出库同步')) summary.pendingCount += 1
    else if (statuses.size === 1 && statuses.has('已付')) summary.paidCount += 1
    else summary.unpaidCount += 1
    summary.totalServiceFee = Number((summary.totalServiceFee + groupRows.reduce((sum, item) => sum + Number(item.totalServiceFee ?? 0), 0)).toFixed(2))
    summary.totalZhixiangjinAmount = Number((summary.totalZhixiangjinAmount + groupRows.reduce((sum, item) => sum + Number(item.zhixiangjinAmount ?? 0), 0)).toFixed(2))
  }

  return summary
}

function buildBundleOrderAudit(
  rows: EducationSubsidyAgentScanRow[],
  salesOutboundRows: InventoryMovementRecord[],
  retailCoreSalesOrders: RetailCoreSalesOrderRecord[],
) {
  const salesOrderBuckets = new Map<string, InventoryMovementRecord[]>()
  for (const row of salesOutboundRows) {
    const orderNumber = extractOrderNumber(row.note, row.documentNumber)
    if (!orderNumber) continue
    const bucket = salesOrderBuckets.get(orderNumber) ?? []
    bucket.push(row)
    salesOrderBuckets.set(orderNumber, bucket)
  }
  const salesOrderMetaByOrder = new Map<string, RetailCoreSalesOrderRecord>()
  for (const order of retailCoreSalesOrders) {
    const orderNumber = extractOrderNumberFromLooseText(order.order_number, order.order_no, order.external_order_no, order.business_no)
    if (!orderNumber) continue
    salesOrderMetaByOrder.set(orderNumber, order)
  }

  const truthOrders: EducationAgentBundleOrderAudit[] = []
  const currentRowsByOrder = new Map<string, EducationSubsidyAgentScanRow[]>()
  for (const row of rows.filter((item) => item.sourceGroupName === '智店通入库群')) {
    const orderNumber = normalizeText(row.orderNumber)
    if (!orderNumber) continue
    const bucket = currentRowsByOrder.get(orderNumber) ?? []
    bucket.push(row)
    currentRowsByOrder.set(orderNumber, bucket)
  }

  for (const [orderNumber, orderRows] of salesOrderBuckets) {
    if (EXCLUDED_FAKE_BUNDLE_ORDER_NUMBERS.has(orderNumber)) continue
    const salesOrderMeta = salesOrderMetaByOrder.get(orderNumber)
    const orderStatusName = normalizeText(salesOrderMeta?.status_name)
    if (/取消|退货|退款/.test(orderStatusName)) continue
    const lines = orderRows
      .filter((item) => normalizeText(item.movementType) === 'sales_outbound')
      .map((item) => {
        const combinedText = `${normalizeText(item.productName)} ${normalizeText(item.spec)} ${normalizeText(item.pnMtm)}`
        return {
          skuKey: normalizeText(item.skuKey),
          productName: normalizeText(item.productName),
          spec: normalizeText(item.spec),
          productType: getBundleProductTypeFromText(combinedText),
          isLegionPc: isLegionPcText(combinedText),
          pnMtm: normalizePnMtm(item.pnMtm),
          serialNumber: normalizeText(item.serialNumber),
        }
      })
      .filter((item) => item.productType !== 'other')
    const truthProductMap = new Map<string, {
      skuKey: string
      productName: string
      pnMtm: string
      spec: string
      productType: string
      serialNumbers: string[]
    }>()
    for (const line of lines) {
      const key = [line.skuKey, line.pnMtm, line.productName, line.spec, line.productType].join('::')
      const current = truthProductMap.get(key) ?? {
        skuKey: line.skuKey,
        productName: line.productName,
        pnMtm: line.pnMtm,
        spec: line.spec,
        productType: line.productType,
        serialNumbers: [],
      }
      if (line.serialNumber && !current.serialNumbers.includes(line.serialNumber)) current.serialNumbers.push(line.serialNumber)
      truthProductMap.set(key, current)
    }

    const truthProductTypes = Array.from(new Set(lines.map((item) => item.productType))).sort()
    if (truthProductTypes.length < 2) continue
    const truthSerialNumbers = Array.from(new Set(lines.map((item) => item.serialNumber).filter(Boolean))).sort()
    if (truthSerialNumbers.length < 2) continue
    let truthRuleKey: EducationAgentBundleOrderAudit['truthRuleKey'] | undefined
    if (truthProductTypes.includes('pc') && truthProductTypes.includes('phone') && truthProductTypes.includes('tablet')) {
      truthRuleKey = 'three_piece_bundle'
    } else if (
      truthProductTypes.includes('pc')
      && truthProductTypes.includes('tablet')
      && lines.some((item) => item.isLegionPc)
    ) {
      truthRuleKey = 'legion_dual_screen_combo'
    } else {
      truthRuleKey = 'two_piece_bundle'
    }
    if (!truthRuleKey) continue

    const currentRows = currentRowsByOrder.get(orderNumber) ?? []
    const currentRuleKeys = Array.from(new Set(currentRows.map((item) => normalizeText(item.serviceRuleKey)).filter(Boolean))).sort()
    const currentPhones = Array.from(new Set(currentRows.map((item) => normalizePhone(item.customerPhone || item.agentPhone)).filter(Boolean))).sort()
    const currentVoucherMissingCount = currentRows.filter((item) => !normalizeText(item.voucherCode)).length
    const currentVerificationMissingCount = currentRows.filter((item) => {
      const reportStatus = normalizeText(item.reportStatus)
      return !normalizeText(item.voucherVerifiedAt) || !/完成|成功/.test(reportStatus)
    }).length

    let auditStatus: EducationAgentBundleOrderAudit['auditStatus'] = 'ok'
    let message = '真实销售单与当前代扫归类一致。'
    if (!currentRows.length) {
      auditStatus = 'missing_agent_scan'
      message = '真实销售单已完成，但当前智店通入库群代扫页没有对应记录。'
    } else if (!currentRuleKeys.includes(truthRuleKey)) {
      auditStatus = 'rule_mismatch'
      message = `真实销售单应归 ${getBundleRuleLabel(truthRuleKey)}，当前代扫归类为 ${currentRuleKeys.join(' / ') || '单扫'}。`
    } else if (currentVoucherMissingCount > 0 || currentVerificationMissingCount > 0) {
      auditStatus = 'verification_gap'
      message = `真实销售单已归类，但仍有 ${currentVoucherMissingCount} 条缺券码、${currentVerificationMissingCount} 条未完成核销/上报。`
    }

    truthOrders.push({
      orderNumber,
      businessDate: normalizeText(salesOrderMeta?.business_date) || normalizeText(orderRows[0]?.businessDate),
      orderStatusName,
      customerName: firstNonEmptyText(
        normalizeText(salesOrderMeta?.customer_name),
        ...currentRows.map((item) => normalizeText(item.customerName)).filter((item) => item && item !== '未知'),
      ),
      storeName: normalizeText(salesOrderMeta?.shop_name) || normalizeText(orderRows[0]?.storeName),
      truthRuleKey,
      truthRuleLabel: getBundleRuleLabel(truthRuleKey),
      truthProductTypes,
      truthPnMtms: Array.from(new Set(lines.map((item) => item.pnMtm).filter(Boolean))).sort(),
      truthSerialNumbers,
      truthProducts: Array.from(truthProductMap.values()).sort((left, right) => (
        left.productType.localeCompare(right.productType, 'zh-CN')
        || left.productName.localeCompare(right.productName, 'zh-CN')
      )),
      currentRowCount: currentRows.length,
      currentRuleKeys,
      currentPhones,
      currentVoucherMissingCount,
      currentVerificationMissingCount,
      auditStatus,
      message,
    })
  }

  const bundleOrderAudit = truthOrders
    .sort((left, right) => right.businessDate.localeCompare(left.businessDate) || left.orderNumber.localeCompare(right.orderNumber))

  const bundleOrderAuditSummary = {
    truthOrderCount: bundleOrderAudit.length,
    truthThreePieceCount: bundleOrderAudit.filter((item) => item.truthRuleKey === 'three_piece_bundle').length,
    truthTwoPieceCount: bundleOrderAudit.filter((item) => item.truthRuleKey === 'two_piece_bundle').length,
    truthLegionCount: bundleOrderAudit.filter((item) => item.truthRuleKey === 'legion_dual_screen_combo').length,
    okCount: bundleOrderAudit.filter((item) => item.auditStatus === 'ok').length,
    missingAgentScanCount: bundleOrderAudit.filter((item) => item.auditStatus === 'missing_agent_scan').length,
    ruleMismatchCount: bundleOrderAudit.filter((item) => item.auditStatus === 'rule_mismatch').length,
    verificationGapCount: bundleOrderAudit.filter((item) => item.auditStatus === 'verification_gap').length,
  }

  return { bundleOrderAuditSummary, bundleOrderAudit }
}

export async function buildEducationSubsidyAgentScanSnapshot(marketingBoostSnapshot?: MarketingBoostSnapshot): Promise<EducationSubsidyAgentScanSnapshot> {
  const marketingBoost = marketingBoostSnapshot
    ?? await readJsonIfExists<MarketingBoostSnapshot>(artifactPath('latest-marketing-boost-snapshot.json'))
  const historyRows = marketingBoost?.history ?? []
  const baseSalesOutboundRows = (await loadInventoryMovements()).filter((item) => item.movementType === 'sales_outbound')
  const retailCoreSalesOutboundRows = await loadRetailCoreSalesOutboundRows()
  const salesOutboundRows = [...baseSalesOutboundRows, ...retailCoreSalesOutboundRows]
  const retailCoreSalesOrders = await loadRetailCoreSalesOrders()
  const salesOrdersSnapshot = await readJsonIfExists<ZhidiantongSalesOrdersSnapshot>(artifactPath('latest-zhidiantong-sales-orders.json'))
  const salesOrders = salesOrdersSnapshot?.orders ?? []
  const manualRecords = await loadManualRecords()
  const manualRows = manualRecords
    .map((record) => buildRowFromManualRecord(record, historyRows, salesOutboundRows, salesOrders))
    .filter((item): item is EducationSubsidyAgentScanRow => Boolean(item))
  const enrichedRows = enrichRowsWithRetailCoreSalesOrders(dedupeEducationRows([...manualRows]), retailCoreSalesOrders)
  const rows = applyBundleServiceRules(dedupeEducationRows(enrichedRows), salesOrders, retailCoreSalesOrders, marketingBoost)
    .sort((left, right) => (
      (right.scanDate || '').localeCompare(left.scanDate || '')
      || (right.outboundDate || '').localeCompare(left.outboundDate || '')
      || left.productName.localeCompare(right.productName, 'zh-CN')
    ))
  const summary = rows.reduce<EducationSubsidyAgentScanSnapshot['summary']>(addRowToSummary, createEmptySummary())
  const groupSummaries = EDUCATION_AGENT_SCAN_GROUPS.map((group) => ({
    sourceGroupName: group.name,
    collectionSource: group.collectionSource,
    serviceFeePerUnit: group.serviceFeePerUnit,
    ...rows
      .filter((item) => item.sourceGroupName === group.name)
      .reduce(addRowToSummary, createEmptySummary()),
  }))
  const phoneMismatchAlerts = rows
    .filter((item) => item.customerPhone && item.agentPhone && item.customerPhone !== item.agentPhone)
    .map((item) => ({
      id: item.id,
      orderNumber: item.orderNumber,
      serialNumber: item.serialNumbers[0],
      sourceGroupName: item.sourceGroupName,
      customerName: item.customerName,
      customerPhone: item.customerPhone,
      agentPhone: item.agentPhone,
      message: `电话不一致：客户电话 ${item.customerPhone} 与代扫电话 ${item.agentPhone} 不一致`,
    }))
  const { bundleOrderAuditSummary, bundleOrderAudit } = buildBundleOrderAudit(rows, salesOutboundRows, retailCoreSalesOrders)
  return {
    generatedAt: new Date().toISOString(),
    source: 'education_subsidy_agent_scan_summary',
    sourceGroupName: SOURCE_GROUP_NAMES.join('、'),
    sourceGroupNames: SOURCE_GROUP_NAMES,
    summary,
    groupSummaries,
    bundleSummary: buildEducationBundleSummary(rows),
    bundleOrderAuditSummary,
    bundleOrderAudit,
    rows,
    phoneMismatchAlerts,
  }
}

export async function saveEducationSubsidyAgentScanSnapshot(marketingBoostSnapshot?: MarketingBoostSnapshot) {
  const snapshot = await buildEducationSubsidyAgentScanSnapshot(marketingBoostSnapshot)
  const detailBackfillQueuePayload = buildEducationAgentScanDetailBackfillQueue(snapshot.rows)
  const artifact = artifactPath(SNAPSHOT_FILE_NAME)
  const web = webDataPath(SNAPSHOT_FILE_NAME)
  const phoneAlertPayload = {
    generatedAt: snapshot.generatedAt,
    source: 'education_subsidy_agent_scan_summary',
    count: snapshot.phoneMismatchAlerts?.length ?? 0,
    items: snapshot.phoneMismatchAlerts ?? [],
  }
  const phoneAlertArtifact = artifactPath(PHONE_MISMATCH_ALERT_FILE_NAME)
  const phoneAlertWeb = webDataPath(PHONE_MISMATCH_ALERT_FILE_NAME)
  const detailBackfillArtifact = artifactPath(DETAIL_BACKFILL_QUEUE_FILE_NAME)
  const detailBackfillWeb = webDataPath(DETAIL_BACKFILL_QUEUE_FILE_NAME)
  await Promise.all([
    fs.mkdir(path.dirname(artifact), { recursive: true }),
    fs.mkdir(path.dirname(web), { recursive: true }),
    fs.mkdir(path.dirname(phoneAlertArtifact), { recursive: true }),
    fs.mkdir(path.dirname(phoneAlertWeb), { recursive: true }),
    fs.mkdir(path.dirname(detailBackfillArtifact), { recursive: true }),
    fs.mkdir(path.dirname(detailBackfillWeb), { recursive: true }),
    fs.writeFile(artifact, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(web, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(phoneAlertArtifact, `${JSON.stringify(phoneAlertPayload, null, 2)}\n`, 'utf-8'),
    fs.writeFile(phoneAlertWeb, `${JSON.stringify(phoneAlertPayload, null, 2)}\n`, 'utf-8'),
    fs.writeFile(detailBackfillArtifact, `${JSON.stringify(detailBackfillQueuePayload, null, 2)}\n`, 'utf-8'),
    fs.writeFile(detailBackfillWeb, `${JSON.stringify(detailBackfillQueuePayload, null, 2)}\n`, 'utf-8'),
  ])
  return { snapshot, artifactPath: artifact, webPath: web }
}
