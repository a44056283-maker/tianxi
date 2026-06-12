import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import readXlsxFile from 'read-excel-file/node'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'
import { saveRetailPriceAuditSnapshot } from '../inventoryQuote/retailPriceAudit.js'
import { saveWarrantyCheckQueue } from '../inventoryQuote/warrantyCheckQueue.js'
import { saveMarketplacePriceSnapshot } from '../storage/marketplacePriceCollector.js'
import {
  type InventoryMovementRecord,
  loadInventoryMovements,
  saveAdjustedInventorySnapshot,
  saveInventoryMovements,
  saveSerialOverrides,
  saveRetailZoneSnapshot,
  loadSerialOverrides,
} from '../inventoryQuote/dataService.js'
import { findLatestDistributorQuoteFile, saveDistributorQuoteArtifacts } from '../storage/distributorQuoteParser.js'
import { saveMarketingBoostSnapshot, type MarketingBoostSnapshot } from '../storage/marketingBoostStore.js'
import { inspectEducationSubsidyAgentScanAcquisition } from '../storage/educationSubsidyAgentScanStore.js'
import { buildGaokaoDailyLearningSnapshot } from '../storage/gaokaoDailyLearning.js'
import { saveGrayWholesaleSnapshotFromText } from '../storage/grayWholesaleQuoteParser.js'
import { prepareGrayChannelCapturePlan, recordGrayChannelVisitEvidence } from '../storage/grayChannelCollector.js'
import { saveCompetitorCollectionPlan, saveCompetitorMonitorSnapshot } from '../storage/competitorMonitor.js'
import { saveCollectionOperationPlan } from '../storage/collectionOperationPlan.js'
import { buildGaokaoAiKnowledgeBase } from '../storage/gaokaoAiKnowledgeBase.js'
import { buildGaokaoKnowledgeGuides } from '../storage/gaokaoKnowledgeGuides.js'
import { saveProductUrlLockSnapshot } from '../storage/productUrlLockStore.js'
import { buildInventoryMasterSnapshot } from '../storage/inventoryMasterMerge.js'
import { findLatestStockQuantityExport, findLatestStockSnExport } from '../storage/excelInventoryParser.js'
import { importZhidiantongOtherOutbound } from '../storage/zhidiantongOtherOutboundImporter.js'
import { importZhidiantongPurchaseWeb } from '../storage/zhidiantongPurchaseWebImporter.js'
import { buildZhidiantongSalesOrdersSnapshot, importZhidiantongSalesExport } from '../storage/zhidiantongSalesExportImporter.js'
import { importZhidiantongStockStream } from '../storage/zhidiantongStockStreamImporter.js'
import { saveZdtOpenclawBridgeSnapshot } from '../storage/zdtOpenclawBridge.js'
import { buildSemiAutoExecutionPlan } from '../semiAuto/taskPlanner.js'
import { sendScheduledTaskReportCard } from './feishuTaskFeedback.js'

export const scheduledTaskNames = [
  'daily-price-channel-check',
  'daily-gray-channel-check',
  'daily-competitor-monitor-check',
  'daily-jd-lenovo-price-sync',
  'zhidiantong-sync-cycle',
  'sync-health-spot-check',
  'sn-warranty-backfill',
  'daily-audit-and-snapshot-rebuild',
  'daily-sn-sales-compliance-refresh',
  'daily-stale-inventory-check',
  'gaokao-daily-learning-refresh',
  'gaokao-ai-knowledge-refresh',
  'gaokao-major-guide-refresh',
  'daily-development-plan-update',
] as const

export type ScheduledTaskName = (typeof scheduledTaskNames)[number]
type TaskStatus = 'completed' | 'completed_with_warnings' | 'failed'
type TaskExecutionOutcome =
  | 'real_completed'
  | 'executed_not_closed'
  | 'blocked_missing_input'
  | 'blocked_page_risk'

type TaskStepResult = {
  step: string
  status: 'completed' | 'skipped' | 'failed'
  detail?: string
  metrics?: Record<string, number | string | boolean | undefined>
  files?: string[]
}

export type ScheduledTaskReport = {
  taskName: ScheduledTaskName
  executedAt: string
  finishedAt: string
  durationMs: number
  status: TaskStatus
  executionOutcome: TaskExecutionOutcome
  manualActionRequired: boolean
  blockingReason?: string
  warnings: string[]
  steps: TaskStepResult[]
  metrics: {
    newRecordCount: number
    updatedRecordCount: number
    unmatchedProductCount: number
    missingLinkCount: number
    missingPriceCount: number
    missingWarrantyCount: number
    frontendRefreshed: boolean
    inStockSkuCount?: number
    frontendBlankPriceCount?: number
    newStockPriorityCount?: number
    newStockImmediateClosureCount?: number
    task1ClosureReady?: boolean
  }
  artifacts: {
    reportPath: string
    latestReportPath: string
    dashboardPath: string
    webDashboardPath: string
    evidencePaths: string[]
  }
}

type ScheduledTaskDashboard = {
  generatedAt: string
  latestByTask: Partial<Record<ScheduledTaskName, ScheduledTaskReport>>
}

type CollectionPlanItem = {
  skuKey?: string
  productName?: string
  category?: string
  currentStock?: number
  retailUrlLocks?: Record<string, {
    status?: string
    url?: string
    price?: number
  }>
}

type EducationAgentScanSyncGapSnapshot = {
  generatedAt?: string
  source?: string
  salesOrderCount?: number
  agentScanSerialCount?: number
  gapCount?: number
  items?: Array<{
    orderNumber?: string
    operateTime?: string
    skuKey?: string
    productName?: string
    serialNumbers?: string[]
    missingSerialNumbers?: string[]
  }>
}

type CollectionPlanSnapshot = {
  items?: CollectionPlanItem[]
  totals?: {
    inStockSkuCount?: number
    missingRetailLockCount?: number
  }
}

type InventoryMasterSnapshot = {
  rows?: Array<{
    skuKey?: string | number
    productName?: string
    category?: string
    currentStock?: number
    inStock?: boolean
    lifecycleStatus?: string
    stockAgeDays?: number
    inboundDate?: string
    serialNumber?: string
    sourceRefs?: Array<{
      kind?: string
      documentNumber?: string
      capturedAt?: string
      filePath?: string
    }>
  }>
  exceptions?: unknown[]
  totals?: {
    rowWithInboundDateCount?: number
  }
}

type SnStockOrderBackfillResult = {
  addedCount: number
  updatedCount: number
  orderIds: string[]
  files?: Awaited<ReturnType<typeof saveInventoryMovements>>
}

type RetailPriceAuditSnapshot = {
  totals?: {
    missingPriceCount?: number
    manualReviewRequiredCount?: number
  }
}

type RetailZoneSnapshot = {
  decisions?: {
    items?: Array<{
      skuKey?: string
      productName?: string
      category?: string
      currentStock?: number
      jdPrice?: number
      lenovoOfficialPrice?: number
      taobaoPrice?: number
    }>
  }
}

type TerminalPriceConsistencyAudit = {
  status?: string
  summary?: {
    mismatchCount?: number
    publishedProjectionItemCount?: number
    channelViewChecks?: number
    staticRetailZoneChecks?: number
    apiRetailZoneChecks?: number
    apiRetailZoneStatus?: string
  }
  mismatches?: unknown[]
}

type TerminalTitleConsistencyAudit = {
  status?: string
  summary?: {
    issueCount?: number
    activePublishedProjectionItemCount?: number
    channelViewChecks?: number
    staticRetailZoneChecks?: number
    standardPriceMasterChecks?: number
    standardPriceMasterFrontendChecks?: number
    apiRetailZoneChecks?: number
    apiRetailZoneStatus?: string
  }
  issues?: unknown[]
}

type WarrantyQueueSnapshot = {
  total?: number
}

type WarrantySnapshot = {
  total?: number
  successCount?: number
  captchaRequiredCount?: number
  failedCount?: number
}

type StaleInventoryReport = {
  generatedAt: string
  thresholds: {
    staleDays: number
    warrantyExpiringDays: number
  }
  totals: {
    staleSerialCount: number
    staleSkuCount: number
    expiringWarrantySerialCount: number
    expiredWarrantySerialCount: number
  }
  categories: Array<{
    category: string
    staleSerialCount: number
    expiringWarrantySerialCount: number
    expiredWarrantySerialCount: number
    rows: Array<{
      skuKey: string
      productName: string
      pnMtm?: string
      currentStock: number
      staleSerialCount: number
      expiringWarrantySerialCount: number
      expiredWarrantySerialCount: number
      oldestStockAgeDays?: number
      serialSamples: string[]
    }>
  }>
}

type SnSalesComplianceSnapshot = {
  generatedAt?: string
  summary?: {
    totalCount?: number
    compliantCount?: number
    blockedCount?: number
    warningCount?: number
    claimableAmount?: number
    manualReviewCount?: number
  }
  items?: Array<{
    status?: string
    orderNumber?: string
    serialNumber?: string
    recommendedAction?: string
  }>
  automation?: {
    realTimeCollectionMode?: string
    realTimeCollectionReason?: string
  }
}

type ProtectedRetailRuleState = {
  filePath: string
  exists: boolean
  size: number
  sha256: string
}

const reportDir = path.resolve(config.lenovoRetail.artifactDir, 'scheduled-task-runs')
const latestReportsPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-scheduled-task-reports.json')
const dashboardPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-scheduled-task-dashboard.json')
const webDashboardPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-scheduled-task-dashboard.json')
const execFileAsync = promisify(execFile)
const ENABLE_ZHIDIANTONG_MOVEMENT_SYNC = true
const GRAY_CHANNEL_CARRY_FORWARD_BASELINE_DATE = '2026-05-29'

function maxDateString(a: string | undefined, b: string | undefined) {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

function protectedRetailRulePaths() {
  return [
    artifactPath('latest-manual-price-overrides.json'),
    webDataPath('latest-manual-price-overrides.json'),
  ]
}

async function readProtectedRetailRuleState(filePath: string): Promise<ProtectedRetailRuleState> {
  try {
    const buffer = await fs.readFile(filePath)
    return {
      filePath,
      exists: true,
      size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    }
  } catch (error) {
    return {
      filePath,
      exists: false,
      size: 0,
      sha256: `missing:${error instanceof Error ? error.name : 'unknown'}`,
    }
  }
}

async function captureProtectedRetailRuleStates() {
  const states = await Promise.all(protectedRetailRulePaths().map((filePath) => readProtectedRetailRuleState(filePath)))
  return new Map(states.map((item) => [item.filePath, item]))
}

function diffProtectedRetailRuleStates(
  before: Map<string, ProtectedRetailRuleState>,
  after: Map<string, ProtectedRetailRuleState>,
) {
  return protectedRetailRulePaths().flatMap((filePath) => {
    const left = before.get(filePath)
    const right = after.get(filePath)
    if (!left || !right) return []
    if (left.exists !== right.exists || left.size !== right.size || left.sha256 !== right.sha256) {
      return [{
        filePath,
        before: left,
        after: right,
      }]
    }
    return []
  })
}

function projectRootPath() {
  return path.resolve(config.appDir, '../..')
}

function scheduledSqlAuditPath() {
  return artifactPath('latest-scheduled-sql-auto-sync-audit.json')
}

function scheduledSqlAuditWebPath() {
  return webDataPath('latest-scheduled-sql-auto-sync-audit.json')
}

function purchaseInboundGapAuditPath() {
  return artifactPath('latest-purchase-inbound-gap-audit.json')
}

function purchaseInboundGapAuditWebPath() {
  return webDataPath('latest-purchase-inbound-gap-audit.json')
}

function expectedSqlMirrorSnapshotsForTask(taskName: ScheduledTaskName) {
  const shared = [
    'latest-scheduled-task-dashboard.json',
    'latest-semi-auto-execution-plan.json',
    'latest-retail-core-status.json',
    'latest-retail-core-sync-gap-queue.json',
  ]
  const byTask: Record<ScheduledTaskName, string[]> = {
    'daily-price-channel-check': [
      'latest-distributor-quotes.json',
      'latest-price-protection-snapshot.json',
      'latest-retail-core-distributor-quotes.json',
      'latest-retail-core-price-signals.json',
      'latest-marketing-boost-snapshot.json',
    ],
    'daily-gray-channel-check': [
      'latest-gray-wholesale-quotes.json',
      'latest-retail-core-gray-wholesale-quotes.json',
      'latest-retail-core-price-signals.json',
    ],
    'daily-competitor-monitor-check': [
      'latest-competitor-monitor.json',
      'latest-competitor-collection-plan.json',
    ],
    'daily-jd-lenovo-price-sync': [
      'latest-marketplace-price-snapshot.json',
      'latest-product-url-locks.json',
      'latest-collection-operation-plan.json',
      'latest-retail-price-audit.json',
      'latest-retail-zone-snapshot.json',
      'latest-published-product-projection.json',
      'latest-standard-price-master.json',
      'latest-terminal-price-consistency-audit.json',
      'latest-terminal-title-consistency-audit.json',
    ],
    'zhidiantong-sync-cycle': [
      'latest-zdt-openclaw-bridge.json',
      'latest-inventory-movements.json',
      'latest-standard-inventory-snapshot.json',
      'latest-adjusted-inventory-snapshot.json',
      'latest-inventory-master-snapshot.json',
      'latest-serial-overrides.json',
      'latest-zhidiantong-sales-orders.json',
      'latest-retail-core-inventory-movements.json',
      'latest-retail-core-sales-orders.json',
      'latest-retail-core-serial-items.json',
      'latest-retail-core-order-sync-registry.json',
      'latest-retail-core-sync-gap-queue.json',
      'latest-marketing-boost-snapshot.json',
      'latest-education-subsidy-agent-scan-summary.json',
    ],
    'sync-health-spot-check': [
      'latest-zdt-openclaw-bridge.json',
      'latest-standard-inventory-snapshot.json',
      'latest-adjusted-inventory-snapshot.json',
      'latest-inventory-master-snapshot.json',
      'latest-inventory-movements.json',
      'latest-retail-core-inventory-movements.json',
      'latest-retail-core-serial-items.json',
      'latest-retail-core-sync-gap-queue.json',
      'latest-purchase-inbound-gap-audit.json',
      'latest-scheduled-sql-auto-sync-audit.json',
    ],
    'sn-warranty-backfill': [
      'latest-lenovo-warranty-snapshot.json',
      'latest-warranty-check-queue.json',
      'latest-retail-core-serial-items.json',
    ],
    'daily-audit-and-snapshot-rebuild': [
      'latest-inventory-movements.json',
      'latest-standard-inventory-snapshot.json',
      'latest-adjusted-inventory-snapshot.json',
      'latest-inventory-master-snapshot.json',
      'latest-product-url-locks.json',
      'latest-collection-operation-plan.json',
      'latest-retail-price-audit.json',
      'latest-retail-zone-snapshot.json',
      'latest-marketing-boost-snapshot.json',
      'latest-published-product-projection.json',
      'latest-terminal-price-consistency-audit.json',
      'latest-terminal-title-consistency-audit.json',
      'latest-retail-core-order-sync-registry.json',
      'latest-retail-core-sync-gap-queue.json',
    ],
    'daily-sn-sales-compliance-refresh': [
      'latest-retail-core-sales-orders.json',
      'latest-retail-core-serial-items.json',
      'latest-retail-core-sync-gap-queue.json',
      'latest-retail-core-sales-price-protection-history.json',
      'latest-sn-sales-compliance-snapshot.json',
    ],
    'daily-stale-inventory-check': [
      'latest-stale-inventory-report.json',
    ],
    'gaokao-daily-learning-refresh': [
      'latest-gaokao-daily-learning.json',
    ],
    'gaokao-ai-knowledge-refresh': [
      'latest-gaokao-ai-knowledge-base.json',
      'latest-gaokao-ai-knowledge-admin-base.json',
    ],
    'gaokao-major-guide-refresh': [
      'latest-gaokao-major-guides.json',
    ],
    'daily-development-plan-update': [
      'latest-scheduled-task-dashboard.json',
      'latest-local-sync-report.json',
    ],
  }
  return Array.from(new Set([...shared, ...byTask[taskName]]))
}

function shouldBlockOnOpenSqlGaps(taskName: ScheduledTaskName) {
  return taskName === 'zhidiantong-sync-cycle' || taskName === 'daily-audit-and-snapshot-rebuild'
}

function shouldBlockForSqlAudit(taskName: ScheduledTaskName, openGapCount: number, criticalOpenGapCount: number) {
  if (!shouldBlockOnOpenSqlGaps(taskName)) {
    return openGapCount > 0
  }
  if (taskName === 'zhidiantong-sync-cycle') {
    return openGapCount > 0
  }
  return criticalOpenGapCount > 0
}

type SqlAutoSyncAudit = {
  generatedAt: string
  taskName: ScheduledTaskName
  status: 'completed' | 'failed'
  checkedSnapshots: string[]
  sqliteDatabase?: string
  seeded?: Record<string, unknown>
  snapshotCache?: {
    syncedCount?: number
    skippedCount?: number
  }
  localSyncWrittenCount?: number
  openGapCount: number
  criticalOpenGapCount: number
  warningOpenGapCount: number
  openGapSamples: Array<{
    orderNumber?: string
    gapType?: string
    severity?: string
    businessDate?: string
    serialNumber?: string
    message?: string
  }>
  blockCurrentTask: boolean
  error?: string
}

type InventoryTerminalSyncAudit = {
  scriptPath: string
  database: string
  writtenCount: number
  writtenKeys: string[]
  blocking: boolean
  audit: {
    summary?: {
      coreStockSnMismatchCount?: number
      projectionVsStandardMismatchCount?: number
      channelStockSnMismatchCount?: number
      distMismatchCount?: number
      liveMismatchCount?: number
    }
    samples?: Record<string, Array<Record<string, unknown>>>
  }
}

type PurchaseInboundCompletenessAudit = {
  generatedAt: string
  status: 'completed' | 'failed'
  purchaseInboundTotal: number
  missingCostCount: number
  missingSupplierCount: number
  missingSerialDisplayCount: number
  scaledCostCount: number
  absurdAmountCount: number
  sameDayMissingCostCount: number
  sameDayMissingSerialCount: number
  sameDayScaledCostCount: number
  sameDayAbsurdAmountCount: number
  manualAdjustmentCgrCount: number
  sampleMissingCostRows: Array<Record<string, unknown>>
  sampleMissingSerialRows: Array<Record<string, unknown>>
  sampleScaledCostRows: Array<Record<string, unknown>>
  sampleAbsurdAmountRows: Array<Record<string, unknown>>
  blockCurrentTask: boolean
  error?: string
}

function normalizeGapSample(item: Record<string, unknown>) {
  return {
    orderNumber: String(item.order_number ?? item.orderNumber ?? ''),
    gapType: String(item.gap_type ?? item.gapType ?? ''),
    severity: String(item.severity ?? ''),
    businessDate: String(item.business_date ?? item.businessDate ?? ''),
    serialNumber: String(item.serial_number ?? item.serialNumber ?? ''),
    message: String(item.message ?? ''),
  }
}

async function syncSqlMirrorAndBuildGapAudit(taskName: ScheduledTaskName): Promise<SqlAutoSyncAudit> {
  const checkedSnapshots = expectedSqlMirrorSnapshotsForTask(taskName)
  const generatedAt = new Date().toISOString()
  const pythonCode = [
    'from pathlib import Path',
    'import json, os',
    'from app import retail_core, local_sync',
    'data_dir = Path(os.environ.get("PROJECT_ROOT", ".")) / "apps" / "web-cockpit" / "public" / "data"',
    'snapshot_names = json.loads(os.environ.get("SQL_SYNC_SNAPSHOT_NAMES", "[]"))',
    'seed = retail_core.seed_reference_data(data_dir)',
    'written = local_sync.write_static_snapshots(data_dir)',
    'cache = retail_core.sync_snapshot_cache(data_dir, snapshot_names)',
    'gaps = retail_core.list_sync_gap_queue(limit=500)',
    'print(json.dumps({"seed": seed, "writtenCount": len(written), "snapshotCache": cache, "gapQueue": gaps}, ensure_ascii=False))',
  ].join('\n')

  try {
    const projectRoot = projectRootPath()
    const { stdout } = await execFileAsync('python3', ['-c', pythonCode], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: path.resolve(projectRoot, 'apps/api-server'),
        SQL_SYNC_SNAPSHOT_NAMES: JSON.stringify(checkedSnapshots),
      },
      maxBuffer: 1024 * 1024 * 24,
    })
    const payload = JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as {
      seed?: Record<string, unknown>
      writtenCount?: number
      snapshotCache?: { syncedCount?: number; skippedCount?: number }
      gapQueue?: { items?: Array<Record<string, unknown>>; statusCounts?: Record<string, number> }
    }
    const gapItems = payload.gapQueue?.items ?? []
    const openGaps = gapItems.filter((item) => String(item.status ?? '') === 'open')
    const criticalOpenGaps = openGaps.filter((item) => String(item.severity ?? '') === 'critical')
    const warningOpenGaps = openGaps.filter((item) => String(item.severity ?? '') !== 'critical')
    const shouldBlock = shouldBlockForSqlAudit(taskName, openGaps.length, criticalOpenGaps.length)
    const audit: SqlAutoSyncAudit = {
      generatedAt,
      taskName,
      status: 'completed',
      checkedSnapshots,
      sqliteDatabase: String(payload.seed?.database ?? ''),
      seeded: payload.seed,
      snapshotCache: payload.snapshotCache,
      localSyncWrittenCount: payload.writtenCount,
      openGapCount: openGaps.length,
      criticalOpenGapCount: criticalOpenGaps.length,
      warningOpenGapCount: warningOpenGaps.length,
      openGapSamples: openGaps.slice(0, 12).map(normalizeGapSample),
      blockCurrentTask: shouldBlock,
    }
    await Promise.all([
      writeFileAtomic(scheduledSqlAuditPath(), `${JSON.stringify(audit, null, 2)}\n`),
      writeFileAtomic(scheduledSqlAuditWebPath(), `${JSON.stringify(audit, null, 2)}\n`),
    ])
    return audit
  } catch (error) {
    const audit: SqlAutoSyncAudit = {
      generatedAt,
      taskName,
      status: 'failed',
      checkedSnapshots,
      openGapCount: 0,
      criticalOpenGapCount: 0,
      warningOpenGapCount: 0,
      openGapSamples: [],
      blockCurrentTask: shouldBlockOnOpenSqlGaps(taskName),
      error: error instanceof Error ? error.message : String(error),
    }
    await Promise.all([
      writeFileAtomic(scheduledSqlAuditPath(), `${JSON.stringify(audit, null, 2)}\n`),
      writeFileAtomic(scheduledSqlAuditWebPath(), `${JSON.stringify(audit, null, 2)}\n`),
    ])
    return audit
  }
}

async function auditPurchaseInboundCompleteness(): Promise<PurchaseInboundCompletenessAudit> {
  const generatedAt = new Date().toISOString()
  const isolatedPlaceholderNote = '自动隔离：重复占位采购行，无PG采购明细/库存入库源'
  const todayToken = getTodayDateString().slice(2).replace(/-/g, '')
  const sameDayDocumentExpr = `(COALESCE(source_ref, '') LIKE '%${todayToken}%' OR COALESCE(inbound_document_no, '') LIKE '%${todayToken}%')`
  const pythonCode = [
    'import json, sqlite3',
    'conn = sqlite3.connect("apps/api-server/data/retail-core.sqlite3")',
    'conn.row_factory = sqlite3.Row',
    'cur = conn.cursor()',
    'cur.execute("""',
    "SELECT COUNT(*) AS total,",
    "       SUM(CASE WHEN unit_cost IS NULL OR unit_cost = 0 THEN 1 ELSE 0 END) AS missing_cost,",
    `       SUM(CASE WHEN (supplier_name IS NULL OR TRIM(supplier_name) = '') AND COALESCE(note, '') NOT LIKE '%${isolatedPlaceholderNote}%' THEN 1 ELSE 0 END) AS missing_supplier,`,
    `       SUM(CASE WHEN (serial_number IS NULL OR TRIM(serial_number) = '' OR serial_number = '[]') AND COALESCE(note, '') NOT LIKE '%${isolatedPlaceholderNote}%' THEN 1 ELSE 0 END) AS missing_serial,`,
    "       SUM(CASE WHEN unit_cost >= 50000 THEN 1 ELSE 0 END) AS scaled_cost,",
    "       SUM(CASE WHEN amount >= 1000000 THEN 1 ELSE 0 END) AS absurd_amount,",
    `       SUM(CASE WHEN date(business_date)=date('now','localtime') AND ${sameDayDocumentExpr} AND (unit_cost IS NULL OR unit_cost = 0) THEN 1 ELSE 0 END) AS same_day_missing_cost,`,
    `       SUM(CASE WHEN date(business_date)=date('now','localtime') AND ${sameDayDocumentExpr} AND (serial_number IS NULL OR TRIM(serial_number) = '' OR serial_number = '[]') AND COALESCE(note, '') NOT LIKE '%${isolatedPlaceholderNote}%' THEN 1 ELSE 0 END) AS same_day_missing_serial,`,
    `       SUM(CASE WHEN date(business_date)=date('now','localtime') AND ${sameDayDocumentExpr} AND unit_cost >= 50000 THEN 1 ELSE 0 END) AS same_day_scaled_cost,`,
    `       SUM(CASE WHEN date(business_date)=date('now','localtime') AND ${sameDayDocumentExpr} AND amount >= 1000000 THEN 1 ELSE 0 END) AS same_day_absurd_amount,`,
    "       SUM(CASE WHEN movement_type='purchase_inbound' AND (UPPER(COALESCE(source_ref, '')) LIKE 'CGR%' OR UPPER(COALESCE(id, '')) LIKE 'ZDT-CGR%') AND (UPPER(COALESCE(source_document_type, '')) <> '采购入库') THEN 1 ELSE 0 END) AS manual_adjustment_cgr",
    "FROM inventory_movement",
    "WHERE movement_type = 'purchase_inbound'",
    '""")',
    'totals = dict(cur.fetchone())',
    'cur.execute("""',
    "SELECT id, source_ref, inbound_document_no, sku_key, quantity, unit_cost, supplier_name",
    "FROM inventory_movement",
    "WHERE movement_type = 'purchase_inbound' AND (unit_cost IS NULL OR unit_cost = 0)",
    "ORDER BY business_date DESC, created_at DESC LIMIT 20",
    '""")',
    'missing_cost_rows = [dict(row) for row in cur.fetchall()]',
    'cur.execute("""',
    "SELECT id, source_ref, inbound_document_no, sku_key, quantity, serial_number",
    "FROM inventory_movement",
    `WHERE movement_type = 'purchase_inbound' AND (serial_number IS NULL OR TRIM(serial_number) = '' OR serial_number = '[]') AND COALESCE(note, '') NOT LIKE '%${isolatedPlaceholderNote}%'`,
    "ORDER BY business_date DESC, created_at DESC LIMIT 20",
    '""")',
    'missing_serial_rows = [dict(row) for row in cur.fetchall()]',
    'cur.execute("""',
    "SELECT id, source_ref, inbound_document_no, sku_key, quantity, unit_cost, amount",
    "FROM inventory_movement",
    "WHERE movement_type = 'purchase_inbound' AND unit_cost >= 50000",
    "ORDER BY business_date DESC, created_at DESC LIMIT 20",
    '""")',
    'scaled_cost_rows = [dict(row) for row in cur.fetchall()]',
    'cur.execute("""',
    "SELECT id, source_ref, inbound_document_no, sku_key, quantity, unit_cost, amount",
    "FROM inventory_movement",
    "WHERE movement_type = 'purchase_inbound' AND amount >= 1000000",
    "ORDER BY amount DESC LIMIT 20",
    '""")',
    'absurd_amount_rows = [dict(row) for row in cur.fetchall()]',
    'conn.close()',
    'print(json.dumps({"totals": totals, "missingCostRows": missing_cost_rows, "missingSerialRows": missing_serial_rows, "scaledCostRows": scaled_cost_rows, "absurdAmountRows": absurd_amount_rows}, ensure_ascii=False))',
  ].join('\n')

  try {
    const projectRoot = projectRootPath()
    const { stdout } = await execFileAsync('python3', ['-c', pythonCode], {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    })
    const payload = JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as {
      totals?: Record<string, unknown>
      missingCostRows?: Array<Record<string, unknown>>
      missingSerialRows?: Array<Record<string, unknown>>
      scaledCostRows?: Array<Record<string, unknown>>
      absurdAmountRows?: Array<Record<string, unknown>>
    }
    const missingCostCount = Number(payload.totals?.missing_cost ?? 0)
    const missingSupplierCount = Number(payload.totals?.missing_supplier ?? 0)
    const missingSerialDisplayCount = Number(payload.totals?.missing_serial ?? 0)
    const scaledCostCount = Number(payload.totals?.scaled_cost ?? 0)
    const absurdAmountCount = Number(payload.totals?.absurd_amount ?? 0)
    const sameDayMissingCostCount = Number(payload.totals?.same_day_missing_cost ?? 0)
    const sameDayMissingSerialCount = Number(payload.totals?.same_day_missing_serial ?? 0)
    const sameDayScaledCostCount = Number(payload.totals?.same_day_scaled_cost ?? 0)
    const sameDayAbsurdAmountCount = Number(payload.totals?.same_day_absurd_amount ?? 0)
    const manualAdjustmentCgrCount = Number(payload.totals?.manual_adjustment_cgr ?? 0)
    const audit: PurchaseInboundCompletenessAudit = {
      generatedAt,
      status: 'completed',
      purchaseInboundTotal: Number(payload.totals?.total ?? 0),
      missingCostCount,
      missingSupplierCount,
      missingSerialDisplayCount,
      scaledCostCount,
      absurdAmountCount,
      sameDayMissingCostCount,
      sameDayMissingSerialCount,
      sameDayScaledCostCount,
      sameDayAbsurdAmountCount,
      manualAdjustmentCgrCount,
      sampleMissingCostRows: payload.missingCostRows ?? [],
      sampleMissingSerialRows: payload.missingSerialRows ?? [],
      sampleScaledCostRows: payload.scaledCostRows ?? [],
      sampleAbsurdAmountRows: payload.absurdAmountRows ?? [],
      blockCurrentTask: sameDayMissingCostCount > 0 || sameDayMissingSerialCount > 0 || sameDayScaledCostCount > 0 || sameDayAbsurdAmountCount > 0 || manualAdjustmentCgrCount > 0,
    }
    await Promise.all([
      writeFileAtomic(purchaseInboundGapAuditPath(), `${JSON.stringify(audit, null, 2)}\n`),
      writeFileAtomic(purchaseInboundGapAuditWebPath(), `${JSON.stringify(audit, null, 2)}\n`),
    ])
    return audit
  } catch (error) {
    const audit: PurchaseInboundCompletenessAudit = {
      generatedAt,
      status: 'failed',
      purchaseInboundTotal: 0,
      missingCostCount: 0,
      missingSupplierCount: 0,
      missingSerialDisplayCount: 0,
      scaledCostCount: 0,
      absurdAmountCount: 0,
      sameDayMissingCostCount: 0,
      sameDayMissingSerialCount: 0,
      sameDayScaledCostCount: 0,
      sameDayAbsurdAmountCount: 0,
      manualAdjustmentCgrCount: 0,
      sampleMissingCostRows: [],
      sampleMissingSerialRows: [],
      sampleScaledCostRows: [],
      sampleAbsurdAmountRows: [],
      blockCurrentTask: true,
      error: error instanceof Error ? error.message : String(error),
    }
    await Promise.all([
      writeFileAtomic(purchaseInboundGapAuditPath(), `${JSON.stringify(audit, null, 2)}\n`),
      writeFileAtomic(purchaseInboundGapAuditWebPath(), `${JSON.stringify(audit, null, 2)}\n`),
    ])
    return audit
  }
}

type PythonUtilityScriptResult = {
  scriptPath: string
  stdout: string
  exitCode: number
}

type PythonUtilityScriptOptions = {
  allowNonZeroExit?: boolean
}

type ExecFileErrorWithOutput = Error & {
  code?: number
  stdout?: string
  stderr?: string
}

async function runPythonUtilityScript(
  relativeScriptPath: string,
  args: string[] = [],
  options: PythonUtilityScriptOptions = {},
): Promise<PythonUtilityScriptResult> {
  const projectRoot = projectRootPath()
  const scriptPath = path.resolve(projectRoot, relativeScriptPath)
  try {
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 1024 * 1024 * 24,
    })
    const merged = [stdout, stderr].filter(Boolean).join('\n').trim()
    return {
      scriptPath,
      stdout: merged,
      exitCode: 0,
    }
  } catch (error) {
    const execError = error as ExecFileErrorWithOutput
    const merged = [execError.stdout, execError.stderr].filter(Boolean).join('\n').trim()
    if (options.allowNonZeroExit && merged) {
      return {
        scriptPath,
        stdout: merged,
        exitCode: Number(execError.code ?? 1),
      }
    }
    throw error
  }
}

async function syncInventoryTerminalState(): Promise<InventoryTerminalSyncAudit> {
  const result = await runPythonUtilityScript('scripts/sync_inventory_terminal_state.py', [], { allowNonZeroExit: true })
  const payload = JSON.parse(result.stdout.trim().split('\n').at(-1) || '{}') as Omit<InventoryTerminalSyncAudit, 'scriptPath'>
  return {
    scriptPath: result.scriptPath,
    database: String(payload.database ?? ''),
    writtenCount: Number(payload.writtenCount ?? 0),
    writtenKeys: Array.isArray(payload.writtenKeys) ? payload.writtenKeys.map((item) => String(item)) : [],
    blocking: Boolean(payload.blocking),
    audit: payload.audit ?? {},
  }
}

async function runTerminalPriceConsistencyAudit(): Promise<{
  artifactPath: string
  webPath: string
  snapshot: TerminalPriceConsistencyAudit
}> {
  await runPythonUtilityScript('scripts/audit_terminal_price_consistency.py')
  const artifactFile = artifactPath('latest-terminal-price-consistency-audit.json')
  const webFile = webDataPath('latest-terminal-price-consistency-audit.json')
  const snapshot = await readJsonIfExists<TerminalPriceConsistencyAudit>(artifactFile)
  if (Number(snapshot?.summary?.mismatchCount ?? 0) > 0 || snapshot?.status === 'fail') {
    throw new Error(`terminal price consistency audit failed: mismatchCount=${snapshot?.summary?.mismatchCount ?? 'unknown'}`)
  }
  return {
    artifactPath: artifactFile,
    webPath: webFile,
    snapshot: snapshot ?? {},
  }
}

async function runTerminalTitleConsistencyAudit(): Promise<{
  artifactPath: string
  webPath: string
  snapshot: TerminalTitleConsistencyAudit
}> {
  await runPythonUtilityScript('scripts/audit_terminal_title_consistency.py')
  const artifactFile = artifactPath('latest-terminal-title-consistency-audit.json')
  const webFile = webDataPath('latest-terminal-title-consistency-audit.json')
  const snapshot = await readJsonIfExists<TerminalTitleConsistencyAudit>(artifactFile)
  if (Number(snapshot?.summary?.issueCount ?? 0) > 0 || snapshot?.status === 'fail') {
    throw new Error(`terminal title consistency audit failed: issueCount=${snapshot?.summary?.issueCount ?? 'unknown'}`)
  }
  return {
    artifactPath: artifactFile,
    webPath: webFile,
    snapshot: snapshot ?? {},
  }
}

function getTimestampKey(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function getTodayDateString() {
  return getShanghaiDateString()
}

function getTodayCompactDateString() {
  return getTodayDateString().replace(/-/g, '')
}

function getTodayChineseDateString() {
  const [year, month, day] = getTodayDateString().split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function getTodayDateAliases() {
  const today = getTodayDateString()
  const compact = today.replace(/-/g, '')
  const [year, month, day] = today.split('-')
  const looseChinese = `${year}年${Number(month)}月${Number(day)}日`
  const paddedChinese = `${year}年${month}月${day}日`
  return [today, compact, today.replace(/-/g, '_'), looseChinese, paddedChinese]
}

function fileNameIncludesToday(filePath?: string) {
  if (!filePath) return false
  const fileName = path.basename(filePath)
  return getTodayDateAliases().some((alias) => fileName.includes(alias))
}

function getShanghaiDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function getRecentShanghaiDateStrings() {
  const today = getShanghaiDateString()
  const yesterday = getShanghaiDateString(new Date(Date.now() - 24 * 60 * 60 * 1000))
  return [today, yesterday]
}

function isShanghaiBusinessHours() {
  const hourText = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  const hour = Number(hourText)
  return Number.isFinite(hour) && hour >= 10 && hour < 22
}

async function listFilesIfExists(dirPath: string) {
  return fs.readdir(dirPath).catch(() => [] as string[])
}

export type VisibleEvidenceSummary = {
  summaryPath: string
  screenshotPaths: string[]
  hasFrontendEvidence: boolean
  hasPageContentEvidence: boolean
}

export async function findLatestTaskVisibleEvidence(taskName: ScheduledTaskName) : Promise<VisibleEvidenceSummary | null> {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const today = getTodayDateString()
  const entries = await fs.readdir(manualDir, { withFileTypes: true }).catch(() => [])
  const matchingDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${taskName}-${today}-`))
    .map((entry) => entry.name)
    .sort()
    .reverse()

  for (const dirName of matchingDirs) {
    const dirPath = path.resolve(manualDir, dirName)
    const files = await fs.readdir(dirPath).catch(() => [] as string[])
    const summaryFileName = files.find((file) => /visible-evidence-summary\.(md|json)$/i.test(file))
    if (!summaryFileName) continue
    const summaryPath = path.resolve(dirPath, summaryFileName)
    const screenshotPaths = files
      .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
      .map((file) => path.resolve(dirPath, file))
    const lowerNames = files.map((file) => file.toLowerCase())
    const hasFrontendEvidence = lowerNames.some((file) => file.includes('frontend'))
    const hasPageContentEvidence = lowerNames.some((file) => (
      file.includes('wechat')
      || file.includes('zdt')
      || file.includes('frontend')
      || file.includes('visible')
    ))
    return {
      summaryPath,
      screenshotPaths,
      hasFrontendEvidence,
      hasPageContentEvidence,
    }
  }
  return null
}

async function getTodayManualWarrantyEvidence() {
  const today = getTodayDateString()
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual', 'warranty', today)
  const legacyDir = path.resolve(config.lenovoRetail.artifactDir, 'warranty', today)
  const [manualFiles, legacyFiles] = await Promise.all([
    listFilesIfExists(manualDir),
    listFilesIfExists(legacyDir),
  ])
  return {
    today,
    manualDir,
    legacyDir,
    manualFiles,
    legacyFiles,
    totalCount: manualFiles.length + legacyFiles.length,
  }
}

type ManualWarrantyPageRiskMarker = {
  observedAt: string
  executionOutcome?: 'blocked_page_risk'
  blockingReason?: string
  serialNumber?: string
  page?: string
  detail?: string
}

async function getTodayManualWarrantyPageRisk(manualDir: string) {
  const markerPath = path.resolve(manualDir, 'page-risk.json')
  const marker = await fs.readFile(markerPath, 'utf-8')
    .then((content) => JSON.parse(content) as ManualWarrantyPageRiskMarker)
    .catch(() => null)
  return { markerPath, marker }
}

function isTask1ComputerScope(item?: { category?: string; productName?: string }) {
  const text = `${item?.category ?? ''} ${item?.productName ?? ''}`
  if (/(配件|手机|平板|保护膜|钢化膜|保护夹|键盘|鼠标|耳机|音箱|显示器|打印机|智能生活)/.test(text)) return false
  return /(轻薄笔记本|游戏笔记本|商务台式|游戏主机|一体机|台式|主机|笔记本|GeekPro|天逸510S|Legion|Lecoo|小新)/i.test(text)
}

function daysUntil(dateText?: string) {
  if (!dateText) return undefined
  const time = Date.parse(dateText)
  if (!Number.isFinite(time)) return undefined
  const today = new Date(`${getShanghaiDateString()}T00:00:00+08:00`).getTime()
  return Math.ceil((time - today) / 86_400_000)
}

async function saveStaleInventoryReport() {
  const snapshot = await saveAdjustedInventorySnapshot()
  const staleDays = 180
  const warrantyExpiringDays = 60
  const byCategory = new Map<string, StaleInventoryReport['categories'][number]>()

  for (const sku of snapshot.snapshot.skus) {
    const staleSerials = (sku.serials ?? []).filter((serial) => Number(serial.stockAgeDays ?? 0) >= staleDays)
    const expiringWarrantySerials = (sku.serials ?? []).filter((serial) => {
      const left = daysUntil(serial.warrantyEnd)
      return left !== undefined && left >= 0 && left <= warrantyExpiringDays
    })
    const expiredWarrantySerials = (sku.serials ?? []).filter((serial) => {
      const left = daysUntil(serial.warrantyEnd)
      return left !== undefined && left < 0
    })
    if (!staleSerials.length && !expiringWarrantySerials.length && !expiredWarrantySerials.length) continue

    const category = sku.category || '未分类'
    const group = byCategory.get(category) ?? {
      category,
      staleSerialCount: 0,
      expiringWarrantySerialCount: 0,
      expiredWarrantySerialCount: 0,
      rows: [],
    }
    group.staleSerialCount += staleSerials.length
    group.expiringWarrantySerialCount += expiringWarrantySerials.length
    group.expiredWarrantySerialCount += expiredWarrantySerials.length
    group.rows.push({
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      currentStock: sku.currentStock,
      staleSerialCount: staleSerials.length,
      expiringWarrantySerialCount: expiringWarrantySerials.length,
      expiredWarrantySerialCount: expiredWarrantySerials.length,
      oldestStockAgeDays: Math.max(0, ...((sku.serials ?? []).map((serial) => Number(serial.stockAgeDays ?? 0)))),
      serialSamples: [
        ...staleSerials,
        ...expiringWarrantySerials,
        ...expiredWarrantySerials,
      ].slice(0, 8).map((serial) => serial.serialNumber),
    })
    byCategory.set(category, group)
  }

  const categories = [...byCategory.values()]
    .map((category) => ({
      ...category,
      rows: category.rows.sort((a, b) => b.staleSerialCount - a.staleSerialCount || b.expiredWarrantySerialCount - a.expiredWarrantySerialCount),
    }))
    .sort((a, b) => b.staleSerialCount - a.staleSerialCount || b.expiredWarrantySerialCount - a.expiredWarrantySerialCount)

  const report: StaleInventoryReport = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      staleDays,
      warrantyExpiringDays,
    },
    totals: {
      staleSerialCount: categories.reduce((sum, item) => sum + item.staleSerialCount, 0),
      staleSkuCount: categories.reduce((sum, item) => sum + item.rows.filter((row) => row.staleSerialCount > 0).length, 0),
      expiringWarrantySerialCount: categories.reduce((sum, item) => sum + item.expiringWarrantySerialCount, 0),
      expiredWarrantySerialCount: categories.reduce((sum, item) => sum + item.expiredWarrantySerialCount, 0),
    },
    categories,
  }
  const artifactPath = artifactPathForStaleInventory()
  const webPath = webDataPath('latest-stale-inventory-report.json')
  await Promise.all([
    writeFileAtomic(artifactPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFileAtomic(webPath, `${JSON.stringify(report, null, 2)}\n`),
  ])
  return { report, artifactPath, webPath }
}

function artifactPathForStaleInventory() {
  return artifactPath('latest-stale-inventory-report.json')
}

async function appendDevelopmentPlanUpdate() {
  const reports = await readJsonIfExists<Partial<Record<ScheduledTaskName, ScheduledTaskReport>>>(latestReportsPath)
  const planPath = path.resolve(config.appDir, '../../../联想智慧零售_开发计划_每日更新.md')
  const now = new Date().toISOString()
  const lines = [
    '',
    `## ${getShanghaiDateString()} 定时任务自动更新`,
    '',
    `- 更新时间：${now}`,
    `- 智店通同步：${reports?.['zhidiantong-sync-cycle']?.executionOutcome ?? 'no_report'}${reports?.['zhidiantong-sync-cycle']?.blockingReason ? `，${reports['zhidiantong-sync-cycle']!.blockingReason}` : ''}`,
    `- 价格同步编排：${reports?.['daily-jd-lenovo-price-sync']?.executionOutcome ?? 'no_report'}${reports?.['daily-jd-lenovo-price-sync']?.blockingReason ? `，${reports['daily-jd-lenovo-price-sync']!.blockingReason}` : ''}`,
    `- 分销报价：${reports?.['daily-price-channel-check']?.executionOutcome ?? 'no_report'}${reports?.['daily-price-channel-check']?.blockingReason ? `，${reports['daily-price-channel-check']!.blockingReason}` : ''}`,
    `- 灰渠报价：${reports?.['daily-gray-channel-check']?.executionOutcome ?? 'no_report'}${reports?.['daily-gray-channel-check']?.blockingReason ? `，${reports['daily-gray-channel-check']!.blockingReason}` : ''}`,
    `- 保修补齐：${reports?.['sn-warranty-backfill']?.executionOutcome ?? 'no_report'}${reports?.['sn-warranty-backfill']?.blockingReason ? `，${reports['sn-warranty-backfill']!.blockingReason}` : ''}`,
  ]
  await fs.mkdir(path.dirname(planPath), { recursive: true })
  await fs.appendFile(planPath, `${lines.join('\n')}\n`, 'utf-8')
  return { planPath, updatedAt: now }
}

function hasTask1DisplayPrice(item?: { jdPrice?: number; lenovoOfficialPrice?: number; taobaoPrice?: number }) {
  return [item?.jdPrice, item?.lenovoOfficialPrice, item?.taobaoPrice].some((value) => typeof value === 'number' && Number.isFinite(value))
}

function hasAnyLockedRetailUrl(item?: CollectionPlanItem) {
  return Object.values(item?.retailUrlLocks ?? {}).some((lock) => lock?.status === 'locked' && isRetailDetailUrl(lock.url))
}

function hasAnyUsableRetailEvidence(item?: CollectionPlanItem) {
  return Object.values(item?.retailUrlLocks ?? {}).some((lock) => (
    (lock?.status === 'locked' || lock?.status === 'candidate')
    && isRetailDetailUrl(lock.url)
    && (lock.status === 'locked' || typeof lock.price === 'number')
  ))
}

function isRetailDetailUrl(url?: string) {
  const value = String(url ?? '')
  return /^https?:\/\/item\.jd\.com\/\d+\.html/i.test(value)
    || /^https?:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(value)
    || /^https?:\/\/detail\.tmall\.com\/item\.htm/i.test(value)
    || /^https?:\/\/item\.taobao\.com\/item\.htm/i.test(value)
}

function parseInboundDate(value?: string) {
  if (!value) return undefined
  const timestamp = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function buildNewStockPrioritySet(master?: InventoryMasterSnapshot) {
  const result = new Set<string>()
  const now = Date.now()
  for (const row of master?.rows ?? []) {
    const skuKey = String(row.skuKey ?? '')
    if (!skuKey) continue
    if (row.inStock === false || row.lifecycleStatus === 'sold') continue
    if (!isTask1ComputerScope(row)) continue
    const explicitAge = typeof row.stockAgeDays === 'number' ? row.stockAgeDays : undefined
    const inboundTimestamp = parseInboundDate(row.inboundDate)
    const inferredAge = inboundTimestamp ? Math.floor((now - inboundTimestamp) / 86_400_000) : undefined
    const stockAgeDays = explicitAge ?? inferredAge
    if (stockAgeDays !== undefined && stockAgeDays >= 0 && stockAgeDays <= 30) result.add(skuKey)
  }
  return result
}

async function inspectLatestInventoryTruthExports() {
  const [stockQuantityFile, stockSnFile] = await Promise.all([
    findLatestStockQuantityExport(),
    findLatestStockSnExport(),
  ])
  const today = getShanghaiDateString()
  const quantityIsToday = fileNameIncludesToday(stockQuantityFile)
  const snIsToday = fileNameIncludesToday(stockSnFile)
  return {
    today,
    stockQuantityFile,
    stockSnFile,
    quantityIsToday,
    snIsToday,
    ready: Boolean(stockQuantityFile && stockSnFile && quantityIsToday && snIsToday),
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined)
}

async function ensureReportDirs(taskName: ScheduledTaskName) {
  await Promise.all([
    fs.mkdir(path.join(reportDir, taskName), { recursive: true }),
    fs.mkdir(path.dirname(webDashboardPath), { recursive: true }),
  ])
}

async function writeFileAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, filePath)
}

async function loadGrayWholesaleRawText() {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const artifactDir = path.resolve(config.lenovoRetail.artifactDir)
  const today = getTodayDateString()
  const preferred = [
    path.resolve(manualDir, `gray-wholesale-${today}.txt`),
    path.resolve(manualDir, `gray-wholesale-${today}.md`),
    path.resolve(manualDir, 'gray-wholesale.txt'),
    path.resolve(manualDir, 'gray-wholesale.md'),
    path.resolve(artifactDir, `gray-wholesale-${today}.txt`),
    path.resolve(artifactDir, `gray-wholesale-${today}.md`),
  ]

  for (const filePath of preferred) {
    const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
    if (content.trim()) return { rawText: content, sourceFile: filePath }
  }

  const searchDirs = [manualDir, artifactDir]
  const candidates = (
    await Promise.all(searchDirs.map(async (dirPath) => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [])
      return Promise.all(entries
        .filter((entry) => entry.isFile() && /^gray-wholesale.*\.(txt|md)$/i.test(entry.name))
        .map(async (entry) => {
          const filePath = path.resolve(dirPath, entry.name)
          const stat = await fs.stat(filePath)
          return { filePath, mtimeMs: stat.mtimeMs }
        }))
    }))
  ).flat()
  const latest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!latest) return {}
  const rawText = await fs.readFile(latest.filePath, 'utf-8').catch(() => '')
  return rawText.trim() ? { rawText, sourceFile: latest.filePath } : {}
}

async function findLatestCompetitorManualFile() {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const today = getTodayDateString()
  const preferred = [
    path.resolve(manualDir, `competitor-monitor-${today}.json`),
    path.resolve(manualDir, `competitor-jd-top10-${today}.json`),
  ]

  for (const filePath of preferred) {
    const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
    if (content.trim()) return filePath
  }
  return undefined
}

async function buildCurrentMetrics() {
  const [plan, audit, warrantyQueue, warranty] = await Promise.all([
    readJsonIfExists<CollectionPlanSnapshot>(artifactPath('latest-collection-operation-plan.json')),
    readJsonIfExists<RetailPriceAuditSnapshot>(artifactPath('latest-retail-price-audit.json')),
    readJsonIfExists<WarrantyQueueSnapshot>(artifactPath('latest-warranty-check-queue.json')),
    readJsonIfExists<WarrantySnapshot>(artifactPath('latest-lenovo-warranty-snapshot.json')),
  ])

  const missingLinkCount = Number(plan?.totals?.missingRetailLockCount ?? 0)
  const missingPriceCount = Number(audit?.totals?.missingPriceCount ?? audit?.totals?.manualReviewRequiredCount ?? 0)
  const queuedWarrantyCount = Number(warrantyQueue?.total ?? 0)
  const missingWarrantyCount = queuedWarrantyCount

  return {
    missingLinkCount,
    missingPriceCount,
    missingWarrantyCount,
  }
}

async function inspectTask1ClosureState() {
  const [plan, audit, retailZone, inventoryMaster] = await Promise.all([
    readJsonIfExists<CollectionPlanSnapshot>(artifactPath('latest-collection-operation-plan.json')),
    readJsonIfExists<RetailPriceAuditSnapshot>(artifactPath('latest-retail-price-audit.json')),
    readJsonIfExists<RetailZoneSnapshot>(artifactPath('latest-retail-zone-snapshot.json')),
    readJsonIfExists<InventoryMasterSnapshot>(artifactPath('latest-inventory-master-snapshot.json')),
  ])

  const task1ComputerPlanItems = (plan?.items ?? [])
    .filter((item) => Number(item.currentStock ?? 0) > 0)
    .filter(isTask1ComputerScope)
  const task1ComputerRetailItems = (retailZone?.decisions?.items ?? [])
    .filter((item) => Number(item.currentStock ?? 0) > 0)
    .filter(isTask1ComputerScope)

  const inStockSkuCount = task1ComputerPlanItems.length
  const missingLinkCount = task1ComputerPlanItems.filter((item) => !hasAnyUsableRetailEvidence(item)).length
  const missingPriceCount = task1ComputerRetailItems.filter((item) => !hasTask1DisplayPrice(item)).length
  const retailDecisionBySku = new Map(task1ComputerRetailItems.map((item) => [String(item.skuKey ?? ''), item]))
  const newStockSet = buildNewStockPrioritySet(inventoryMaster)
  const newStockImmediateClosureCount = task1ComputerPlanItems
    .filter((item) => newStockSet.has(String(item.skuKey ?? '')))
    .filter((item) => !hasAnyUsableRetailEvidence(item) || !hasTask1DisplayPrice(retailDecisionBySku.get(String(item.skuKey ?? ''))))
    .length
  const frontendBlankPriceCount = (retailZone?.decisions?.items ?? [])
    .filter((item) => Number(item.currentStock ?? 0) > 0)
    .filter(isTask1ComputerScope)
    .filter((item) => !hasTask1DisplayPrice(item))
    .length

  return {
    inStockSkuCount,
    missingLinkCount,
    missingPriceCount,
    newStockImmediateClosureCount,
    frontendBlankPriceCount,
    closureReady: inStockSkuCount > 0
      && missingLinkCount === 0
      && missingPriceCount === 0
      && newStockImmediateClosureCount === 0
      && frontendBlankPriceCount === 0,
  }
}

async function inspectStaleInventoryClosureState() {
  const [latestReports, inventoryMaster] = await Promise.all([
    readJsonIfExists<Partial<Record<ScheduledTaskName, ScheduledTaskReport>>>(latestReportsPath),
    readJsonIfExists<InventoryMasterSnapshot>(artifactPath('latest-inventory-master-snapshot.json')),
  ])

  const zdtReport = latestReports?.['zhidiantong-sync-cycle']
  const inventoryMasterMissing = !inventoryMaster
  const inventoryExceptionCount = Array.isArray(inventoryMaster?.exceptions) ? inventoryMaster.exceptions.length : 0
  const upstreamClosed = zdtReport?.executionOutcome === 'real_completed'

  return {
    inventoryMasterMissing,
    inventoryExceptionCount,
    upstreamClosed,
    upstreamOutcome: zdtReport?.executionOutcome,
    upstreamBlockingReason: zdtReport?.blockingReason,
    closureReady: !inventoryMasterMissing && inventoryExceptionCount === 0 && upstreamClosed,
  }
}

async function findLatestByNames(candidateNames: string[], searchDirs: string[]) {
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    const entries = await fs.readdir(searchDir).catch(() => [])
    for (const name of candidateNames) {
      const entry = entries.find((item) => item === name)
      if (!entry) continue
      const filePath = path.resolve(searchDir, entry)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      matched.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  return matched.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath
}

async function findLatestByRegex(pattern: RegExp, searchDirs: string[]) {
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    const entries = await fs.readdir(searchDir).catch(() => [])
    for (const entry of entries) {
      if (!pattern.test(entry)) continue
      const filePath = path.resolve(searchDir, entry)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      matched.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  return matched.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath
}

type Cell = string | number | boolean | Date | null

function normalizeAuditCell(cell: Cell) {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 19)
  return String(cell).trim()
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      row.push(current)
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(current)
      if (row.some((item) => item.trim())) rows.push(row.map((item) => item.trim()))
      row = []
      current = ''
      continue
    }
    current += char
  }
  row.push(current)
  if (row.some((item) => item.trim())) rows.push(row.map((item) => item.trim()))
  return rows
}

async function readAuditRows(filePath: string): Promise<Cell[][]> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.csv') return parseCsvRows(await fs.readFile(filePath, 'utf-8'))
  if (extension === '.xlsx') {
    const result = await readXlsxFile(filePath) as unknown
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) return result as Cell[][]
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null && 'data' in result[0]) {
      return (result[0] as { data: Cell[][] }).data
    }
    return []
  }
  return []
}

function normalizeAuditDate(value: string) {
  const normalized = value
    .replace('T', ' ')
    .replace(/Z$/i, '')
    .replace(/[./年]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .trim()
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return undefined
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function getFirstAuditCell(row: Cell[], header: string[], names: string[]) {
  for (const name of names) {
    const index = header.indexOf(name)
    if (index < 0) continue
    const value = normalizeAuditCell(row[index])
    if (value) return value
  }
  return ''
}

async function inspectStockStreamBusinessDates(filePath: string) {
  const rows = await readAuditRows(filePath)
  const header = (rows[0] ?? []).map(normalizeAuditCell)
  const dates = new Set<string>()
  let nonEmptyDataRowCount = 0
  for (const row of rows.slice(1)) {
    const hasData = row.some((cell) => normalizeAuditCell(cell).length > 0)
    if (!hasData) continue
    nonEmptyDataRowCount += 1
    const rawDate = getFirstAuditCell(row, header, ['业务时间', '业务日期', '创建时间', '操作时间', '交易日期', '交易时间'])
    const date = normalizeAuditDate(rawDate)
    if (date) dates.add(date)
  }
  return {
    rowCount: Math.max(0, rows.length - 1),
    nonEmptyDataRowCount,
    dates: [...dates].sort(),
  }
}

async function findLatestValidStockStreamFile(names: string[], searchDirs: string[], today: string) {
  const candidates: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    for (const name of names) {
      const filePath = path.resolve(searchDir, name)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      candidates.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }

  const rejected: string[] = []
  for (const candidate of candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const audit = await inspectStockStreamBusinessDates(candidate.filePath).catch(() => ({ rowCount: 0, nonEmptyDataRowCount: 0, dates: [] as string[] }))
    if (audit.rowCount <= 0) {
      rejected.push(`${candidate.filePath}：只有表头，没有任何导出明细行`)
      continue
    }
    if (audit.nonEmptyDataRowCount <= 0) {
      rejected.push(`${candidate.filePath}：表头存在但明细全为空，说明本次智店通导出未包含真实出入库记录，不能同步前端`)
      continue
    }
    if (audit.dates.length === 0) {
      rejected.push(`${candidate.filePath}：有 ${audit.nonEmptyDataRowCount} 行明细，但没有可识别的业务日期/操作时间`)
      continue
    }
    if (!audit.dates.includes(today)) {
      rejected.push(`${candidate.filePath}：业务日期为 ${audit.dates.join(', ')}，不是 ${today}`)
      continue
    }
    return { filePath: candidate.filePath, rejected }
  }
  return { filePath: undefined, rejected }
}

async function findLatestManualMarketplaceBatchFile() {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const compactDate = getTodayCompactDateString()
  return findLatestByRegex(
    new RegExp(`^manual-price-supplements-${compactDate}(?:-.+)?\\.json$`, 'i'),
    [config.lenovoRetail.artifactDir, manualDir],
  )
}

async function countMarketplaceBatchRecords(filePath: string) {
  const payload = JSON.parse(await fs.readFile(filePath, 'utf-8')) as { records?: unknown[] } | unknown[]
  if (Array.isArray(payload)) return payload.length
  if (Array.isArray(payload.records)) return payload.records.length
  return 0
}

async function findScheduledZhidiantongManualFiles() {
  const today = getTodayDateString()
  const compactToday = getTodayCompactDateString()
  const chineseToday = getTodayChineseDateString()
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const searchDirs = [manualDir, config.lenovoRetail.artifactDir, config.lenovoRetail.downloadDir]
  const stockStream = await findLatestValidStockStreamFile([
    `zhidiantong-stock-stream-${today}.xlsx`,
    `zhidiantong-stock-stream-${today}.csv`,
    `stock_count${today}.xlsx`,
    `stock_count${today}.csv`,
    `stock_count${today.replace(/-/g, '')}.xlsx`,
    `stock_count${today.replace(/-/g, '')}.csv`,
    `stock_count_${compactToday}.xlsx`,
    `stock_count_${compactToday}.csv`,
    'zhidiantong-stock-stream.xlsx',
    'zhidiantong-stock-stream.csv',
    `库存流水-${today}.xlsx`,
    `库存流水-${today}.csv`,
    `库存流水-${compactToday}.xlsx`,
    `库存流水-${compactToday}.csv`,
    `库存流水-${chineseToday}.xlsx`,
    `库存流水-${chineseToday}.csv`,
    '库存流水.xlsx',
    '库存流水.csv',
  ], searchDirs, today)
  const snStockOrder = await findLatestValidStockStreamFile([
    `zhidiantong-sn-stock-order-${today}.xlsx`,
    `zhidiantong-sn-stock-order-${today}.csv`,
    `sn-stock-order-${today}.xlsx`,
    `sn-stock-order-${today}.csv`,
    `SN库存订单-${today}.xlsx`,
    `SN库存订单-${today}.csv`,
    `SN库存订单-${compactToday}.xlsx`,
    `SN库存订单-${compactToday}.csv`,
    `SN库存订单-${chineseToday}.xlsx`,
    `SN库存订单-${chineseToday}.csv`,
    'SN库存订单.xlsx',
    'SN库存订单.csv',
    'serialNumberData.xlsx',
    'serialNumberData.csv',
    'serialNumberData (1).xlsx',
    'serialNumberData (1).csv',
  ], searchDirs, today)
  const salesFile = await findLatestByNames([
    `zhidiantong-sales-export-${today}.xlsx`,
    `zhidiantong-sales-export-${today}.csv`,
    `销售出库-${today}.xlsx`,
    `销售出库-${today}.csv`,
    `销售出库-${compactToday}.xlsx`,
    `销售出库-${compactToday}.csv`,
    `销售出库-${chineseToday}.xlsx`,
    `销售出库-${chineseToday}.csv`,
    `零售出库-${today}.xlsx`,
    `零售出库-${today}.csv`,
    `线下门店订单-${today}.xlsx`,
    `线下门店订单-${today}.csv`,
  ], searchDirs)
  const purchaseFile = await findLatestByNames([
    `zhidiantong-purchase-inbound-import-${today}.json`,
    `zhidiantong-purchase-inbound-capture-${today}.partial.json`,
    `商品入库-${today}.json`,
    `商品入库-${compactToday}.json`,
    `商品入库-${chineseToday}.json`,
    `采购入库-${today}.json`,
    `采购入库-${compactToday}.json`,
    `采购入库-${chineseToday}.json`,
    `调拨入库-${today}.json`,
    `调拨入库-${compactToday}.json`,
    `调拨入库-${chineseToday}.json`,
    `zhidiantong-transfer-inbound-capture-${today}.partial.json`,
  ], searchDirs)
  const otherOutboundFile = await findLatestByNames([
    `zhidiantong-other-outbound-${today}.json`,
    `zhidiantong-other-outbound-capture-${today}.partial.json`,
    `其他出库-${today}.json`,
    `其他出库-${compactToday}.json`,
    `其他出库-${chineseToday}.json`,
    `其它出库-${today}.json`,
    `其它出库-${compactToday}.json`,
    `其它出库-${chineseToday}.json`,
    `调拨出库-${today}.json`,
    `调拨出库-${compactToday}.json`,
    `调拨出库-${chineseToday}.json`,
    `zhidiantong-transfer-outbound-capture-${today}.partial.json`,
  ], searchDirs)
  return {
    stockStreamFile: stockStream.filePath,
    snStockOrderFile: snStockOrder.filePath,
    rejectedStockStreamFiles: stockStream.rejected,
    rejectedSnStockOrderFiles: snStockOrder.rejected,
    salesFile,
    purchaseFile,
    otherOutboundFile,
  }
}

const ZHIDIANTONG_ORDER_CAPTURE_REQUIRED_ACTIONS = [
  '必须先在 Chrome 当前已登录智店通会话进入：订单 -> 线下门店订单（/lenovo/web/order/order-list）。',
  '筛选固定为：状态切到“已完成”，下单时间开始=当天 00:00，结束=当天 23:59:59；设置后必须点击搜索。',
  '搜索后必须读取总条数/页数；如果有多页，必须逐页检查并导出，不能只看第一页。',
  '每一页都必须同时执行“导出”和“导出明细”，形成成对 orderData*.xlsx 与 orderProductData*.xlsx。',
  '导出后必须确认下载目录出现本轮新文件，并把文件名、页面订单数、导出订单数、导出明细数记录进报告。',
  '同步前必须把当天库存流水/SN库存订单里的销售出库单号与 orderData/orderProductData 覆盖单号比对；缺任一销售单号只能 executed_not_closed。',
  '线下门店订单（orderData/orderProductData）是销售事实主证据；库存流水、SN库存订单、其它出库、调拨出入库只作为辅助校验与补齐，不得反向否决已成立的线下门店订单销售事实。',
  '若线下门店订单覆盖完整，必须先把主销售链写入 SQL 并刷新前端；辅助链仍有缺口时仅标注 executed_not_closed 持续补齐，不得阻断主销售同步。',
  '调拨出库/调拨入库必须按当天日期筛选、查询、导出或保存页面证据，并进入库存、SN 和出入库流水闭环；但调拨单据不计入营销 PO、教育补贴或价保申请范围，缺调拨源文件只能 executed_not_closed。',
].join(' ')

function missingZhidiantongSourceDetail(sourceLabel: string, expectedFiles: string[]) {
  return [
    `未找到业务日期为当天的 ${sourceLabel}。`,
    '这不是脚本缺口，而是可见页面采集未完成：必须先按智店通页面流程筛当天、查询、导出，再运行同步。',
    `可识别文件名：${expectedFiles.join('、')}。`,
    `销售订单专项动作：${ZHIDIANTONG_ORDER_CAPTURE_REQUIRED_ACTIONS}`,
  ].join(' ')
}

function mergeMovementRecords(existing: InventoryMovementRecord[], incoming: InventoryMovementRecord[]) {
  const map = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
}

export function rebuildSnapshotFileList(rebuilt: Awaited<ReturnType<typeof rebuildDerivedSnapshots>>) {
  return [
    rebuilt.movementSync.files.artifactPath,
    rebuilt.movementSync.files.webPath,
    rebuilt.serialSync.files.artifactPath,
    rebuilt.serialSync.files.webPath,
    rebuilt.standardInventory.artifactPath,
    rebuilt.standardInventory.webPath,
    rebuilt.adjustedInventory.artifactPath,
    rebuilt.adjustedInventory.webPath,
    rebuilt.inventoryMaster.artifactPath,
    rebuilt.inventoryMaster.webPath,
    rebuilt.plan.artifactPath,
    rebuilt.warrantyQueue.artifactPath,
    rebuilt.retailAudit.artifactPath,
    rebuilt.retailZone.artifactPath,
    rebuilt.terminalPriceAudit.artifactPath,
    rebuilt.terminalPriceAudit.webPath,
    rebuilt.marketingBoost.artifactPath,
    rebuilt.marketingBoost.webPath,
    rebuilt.marketingBoost.historyArtifactPath,
    rebuilt.marketingBoost.webHistoryPath,
    rebuilt.marketingBoost.educationAgentScan.artifactPath,
    rebuilt.marketingBoost.educationAgentScan.webPath,
  ]
}

function isSnRequiredSku(item: { category?: string; productName?: string }) {
  const text = `${item.category ?? ''} ${item.productName ?? ''}`
  return !/(键盘|鼠标|耳机|耳麦|音箱|套装|保护|支架|显示器|配件|钢化膜|保护膜)/.test(text)
}

function summarizeInventorySerialConsistency(snapshot: StandardInventorySnapshot) {
  const mismatches = snapshot.skus
    .filter((item) => Number(item.currentStock ?? 0) > 0)
    .filter(isSnRequiredSku)
    .map((item) => ({
      skuKey: item.skuKey,
      productName: item.productName,
      currentStock: Number(item.currentStock ?? 0),
      serialCount: Array.isArray(item.serials) ? item.serials.length : Number(item.serialCount ?? 0),
    }))
    .filter((item) => item.currentStock !== item.serialCount)
  return {
    mismatchCount: mismatches.length,
    sample: mismatches.slice(0, 12),
  }
}

function summarizeOutboundMarketingSync(
  movements: InventoryMovementRecord[],
  marketingBoost: MarketingBoostSnapshot,
  educationAgentScan: Awaited<ReturnType<typeof saveMarketingBoostSnapshot>>['educationAgentScan']['snapshot'],
) {
  const salesOutbound = movements.filter((item) => item.movementType === 'sales_outbound')
  const soldSerials = new Set(salesOutbound.map((item) => item.serialNumber).filter((item): item is string => Boolean(item)))
  const salesHeroCards = marketingBoost.heroCards.filter((item) => Boolean(item.orderNumber))
  const salesHeroCardsWithAmount = salesHeroCards.filter((item) => (
    (item.boostAmount ?? 0) > 0
    || (item.educationDiscountAmount ?? 0) > 0
    || (item.estimatedMarketingSupportAmount ?? 0) > 0
  ))
  const agentRows = educationAgentScan.rows ?? []
  const pendingAgentRowsWithSoldSn = agentRows.filter((row) => (
    row.status === '待出库同步'
    && (row.serialNumbers ?? []).some((serial) => soldSerials.has(serial))
  ))
  return {
    salesOutboundCount: salesOutbound.length,
    salesHeroCardCount: salesHeroCards.length,
    salesHeroCardWithAmountCount: salesHeroCardsWithAmount.length,
    educationAgentScanTotalCount: agentRows.length,
    educationAgentScanMatchedOutboundCount: educationAgentScan.summary.matchedOutboundCount,
    educationAgentScanPendingOutboundCount: educationAgentScan.summary.pendingOutboundCount,
    pendingAgentRowsWithSoldSnCount: pendingAgentRowsWithSoldSn.length,
    pendingAgentRowsWithSoldSnSample: pendingAgentRowsWithSoldSn.slice(0, 5).map((row) => row.id),
  }
}

function summarizeSalesOrderSnapshotCoverage(
  movements: InventoryMovementRecord[],
  salesOrderSnapshot: Awaited<ReturnType<typeof buildZhidiantongSalesOrdersSnapshot>> | null,
  inventoryMaster: InventoryMasterSnapshot,
) {
  const today = getTodayDateString()
  const sameDaySalesOutboundOrderIds = Array.from(new Set(
    movements
      .filter((item) => item.movementType === 'sales_outbound')
      .filter((item) => String(item.businessDate ?? '').slice(0, 10) === today)
      .map((item) => String(item.documentNumber ?? '').trim())
      .filter(Boolean),
  ))
  const snStockOrderOnlyIds = Array.from(new Set(
    (inventoryMaster.rows ?? [])
      .flatMap((row) => (row.sourceRefs ?? []).map((sourceRef) => ({ row, sourceRef })))
      .filter(({ sourceRef }) => sourceRef.kind === 'sn_stock_order_export')
      .filter(({ sourceRef }) => String(sourceRef.capturedAt ?? '').slice(0, 10) === today)
      .map(({ sourceRef }) => String(sourceRef.documentNumber ?? '').trim())
      .filter((orderId) => orderId.startsWith('XS'))
      .filter((orderId) => !sameDaySalesOutboundOrderIds.includes(orderId)),
  ))
  const snapshotOrderIds = new Set(
    (salesOrderSnapshot?.snapshot.orders ?? [])
      .map((item) => String(item.id ?? '').trim())
      .filter(Boolean),
  )
  const missingSalesOrderSnapshotIds = sameDaySalesOutboundOrderIds.filter((orderId) => !snapshotOrderIds.has(orderId))
  const missingOrderIds = Array.from(new Set([...missingSalesOrderSnapshotIds, ...snStockOrderOnlyIds]))
  return {
    sameDaySalesOutboundCount: sameDaySalesOutboundOrderIds.length,
    sameDaySnStockOrderOnlyCount: snStockOrderOnlyIds.length,
    snapshotOrderCount: snapshotOrderIds.size,
    missingOrderCount: missingOrderIds.length,
    missingOrderIds,
    missingSalesOrderSnapshotIds,
    snStockOrderOnlyIds,
  }
}

function summarizeFrontendMovementMirrorCoverage(
  movements: InventoryMovementRecord[],
  retailCoreBridge: Awaited<ReturnType<typeof saveRetailCoreFrontendBridgeSnapshots>>,
) {
  const today = getTodayDateString()
  const sourceOrderIds = Array.from(new Set(
    movements
      .filter((item) => item.movementType === 'sales_outbound')
      .filter((item) => String(item.businessDate ?? '').slice(0, 10) === today)
      .map((item) => String(item.documentNumber ?? '').trim())
      .filter(Boolean),
  ))
  const mirroredOrderIds = new Set(retailCoreBridge.orderIds.filter((orderId) => orderId.startsWith('XS')))
  const missingOrderIds = sourceOrderIds.filter((orderId) => !mirroredOrderIds.has(orderId))
  return {
    sourceSalesOrderCount: sourceOrderIds.length,
    mirroredSalesOrderCount: Array.from(mirroredOrderIds).filter((orderId) => sourceOrderIds.includes(orderId)).length,
    missingOrderCount: missingOrderIds.length,
    missingOrderIds,
  }
}

async function backfillSalesMovementsFromSnStockOrders(): Promise<SnStockOrderBackfillResult> {
  const today = getTodayDateString()
  const inventoryMaster = await buildInventoryMasterSnapshot()
  const movements = await loadInventoryMovements()
  const existingSalesOrderIds = new Set(
    movements
      .filter((item) => item.movementType === 'sales_outbound')
      .filter((item) => !String(item.id ?? '').startsWith('SALE-SNSTOCK-'))
      .map((item) => String(item.documentNumber ?? '').trim())
      .filter(Boolean),
  )
  const byMovementId = new Map(movements.map((item) => [item.id, item]))
  const addedOrderIds: string[] = []
  let updatedCount = 0
  const updatedAt = new Date().toISOString()
  for (const row of inventoryMaster.rows ?? []) {
    const sourceRef = (row.sourceRefs ?? []).find((item) => (
      item.kind === 'sn_stock_order_export'
      && String(item.documentNumber ?? '').startsWith('XS')
      && String(item.capturedAt ?? '').slice(0, 10) === today
    ))
    if (!sourceRef?.documentNumber || existingSalesOrderIds.has(sourceRef.documentNumber)) continue
    const serialNumber = String(row.serialNumber ?? '').trim()
    const skuKey = String(row.skuKey ?? '').trim()
    if (!skuKey) continue
    const movementId = `SALE-SNSTOCK-${sourceRef.documentNumber}-${serialNumber || skuKey}`
    const existing = byMovementId.get(movementId)
    const movement: InventoryMovementRecord = {
      ...existing,
      id: movementId,
      skuKey,
      quantity: 1,
      movementType: 'sales_outbound',
      businessDate: String(sourceRef.capturedAt ?? today).replace('T', ' ').slice(0, 19),
      serialNumber: serialNumber || undefined,
      documentNumber: sourceRef.documentNumber,
      sourceDocumentType: 'SN库存订单',
      productName: row.productName,
      pnMtm: row.pnMtm,
      spec: row.spec,
      operatorName: row.latestOperatorName,
      supplierName: row.supplierName || '联想',
      storeName: row.latestStoreName,
      locationName: row.latestLocationName,
      note: `智店通SN库存订单导出补同步，单据 ${sourceRef.documentNumber}，来源 ${sourceRef.filePath ?? 'sn_stock_order_export'}`,
      updatedAt,
    }
    byMovementId.set(movement.id, movement)
    if (existing) updatedCount += 1
    else addedOrderIds.push(sourceRef.documentNumber)
  }
  if (!addedOrderIds.length && updatedCount === 0) return { addedCount: 0, updatedCount: 0, orderIds: [] }
  const saved = await saveInventoryMovements(
    [...byMovementId.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id)),
  )
  return { addedCount: addedOrderIds.length, updatedCount, orderIds: addedOrderIds, files: saved }
}

async function readArtifactJson<T>(fileName: string): Promise<T> {
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, fileName)
  const content = await fs.readFile(artifactPath, 'utf-8')
  return JSON.parse(content) as T
}

async function inspectEducationAgentScanSyncGap(targetDates = getRecentShanghaiDateStrings()) {
  const snapshot = await readJsonIfExists<EducationAgentScanSyncGapSnapshot>(webDataPath('latest-education-agent-scan-sync-gap.json'))
    ?? await readJsonIfExists<EducationAgentScanSyncGapSnapshot>(artifactPath('latest-education-agent-scan-sync-gap.json'))
    ?? { items: [] }
  const dateSet = new Set(targetDates.filter(Boolean))
  const recentItems = (snapshot.items ?? []).filter((item) => {
    const operateDate = String(item.operateTime || '').slice(0, 10)
    return operateDate && dateSet.has(operateDate)
  })
  const groupedDates = Array.from(new Set(recentItems.map((item) => String(item.operateTime || '').slice(0, 10)).filter(Boolean))).sort()
  const samples = recentItems.slice(0, 8).map((item) => {
    const serialText = (item.missingSerialNumbers ?? item.serialNumbers ?? []).filter(Boolean).join('/')
    return `${item.orderNumber || '待补订单'}${serialText ? `(${serialText})` : ''}`
  })
  return {
    targetDates,
    recentItems,
    recentGapCount: recentItems.length,
    groupedDates,
    samples,
    files: [
      webDataPath('latest-education-agent-scan-sync-gap.json'),
      artifactPath('latest-education-agent-scan-sync-gap.json'),
    ],
    blocking: recentItems.length > 0,
    detail: recentItems.length > 0
      ? `教育补代扫同步缺口未清空：${groupedDates.join('、')} 共 ${recentItems.length} 条真实销售出库仍缺正式代扫记录。${samples.length ? `样例：${samples.join('，')}` : ''}`
      : `教育补代扫同步缺口已清空；检查日期：${targetDates.join('、')}。`,
  }
}

async function refreshSqlBackedStaticSnapshots(): Promise<{ writtenCount: number; writtenKeys: string[] }> {
  const pythonCode = [
    'from pathlib import Path',
    'import json, os',
    'from app import local_sync',
    'data_dir = Path(os.environ.get("PROJECT_ROOT", ".")) / "apps" / "web-cockpit" / "public" / "data"',
    'written = local_sync.write_static_snapshots(data_dir)',
    'print(json.dumps({"writtenCount": len(written), "writtenKeys": sorted(written.keys())}, ensure_ascii=False))',
  ].join('\n')
  const projectRoot = projectRootPath()
  const { stdout } = await execFileAsync('python3', ['-c', pythonCode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONPATH: path.resolve(projectRoot, 'apps/api-server'),
    },
    maxBuffer: 1024 * 1024 * 24,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as { writtenCount: number; writtenKeys: string[] }
}

async function refreshPublishedProductProjectionSnapshots(): Promise<{ writtenCount: number; writtenKeys: string[] }> {
  const pythonCode = [
    'from pathlib import Path',
    'import json, os',
    'from app import product_library',
    'data_dir = Path(os.environ.get("PROJECT_ROOT", ".")) / "apps" / "web-cockpit" / "public" / "data"',
    'written = product_library.write_published_product_projection_snapshots(data_dir)',
    'print(json.dumps({"writtenCount": len(written), "writtenKeys": sorted(written.keys())}, ensure_ascii=False))',
  ].join('\n')
  const projectRoot = projectRootPath()
  const { stdout } = await execFileAsync('python3', ['-c', pythonCode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONPATH: path.resolve(projectRoot, 'apps/api-server'),
    },
    maxBuffer: 1024 * 1024 * 24,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as { writtenCount: number; writtenKeys: string[] }
}

export async function rebuildDerivedSnapshots() {
  const [movements, overrides] = await Promise.all([
    loadInventoryMovements(),
    loadSerialOverrides(),
  ])
  const movementSync = await saveInventoryMovements(movements)
  const serialSync = await saveSerialOverrides(overrides)
  const sqlRefresh = await refreshSqlBackedStaticSnapshots()
  const standardInventory = await readArtifactJson<StandardInventorySnapshot>('latest-standard-inventory-snapshot.json')
  const adjustedInventorySnapshot = await readArtifactJson<StandardInventorySnapshot>('latest-adjusted-inventory-snapshot.json')
  const inventoryMaster = await readArtifactJson<InventoryMasterSnapshot>('latest-inventory-master-snapshot.json')
  const locks = await saveProductUrlLockSnapshot()
  const plan = await saveCollectionOperationPlan()
  const warrantyQueue = await saveWarrantyCheckQueue()
  const retailAudit = await saveRetailPriceAuditSnapshot()
  const retailZone = await saveRetailZoneSnapshot()
  const marketingBoost = await saveMarketingBoostSnapshot()
  const publishedProjectionRefresh = await refreshPublishedProductProjectionSnapshots()
  const terminalPriceAudit = await runTerminalPriceConsistencyAudit()
  const terminalTitleAudit = await runTerminalTitleConsistencyAudit()
  return {
    movementSync,
    serialSync,
    sqlRefresh,
    standardInventory: {
      snapshot: standardInventory,
      artifactPath: path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json'),
      webPath: path.resolve(config.appDir, '../web-cockpit/public/data/latest-standard-inventory-snapshot.json'),
    },
    adjustedInventory: {
      snapshot: adjustedInventorySnapshot,
      artifactPath: path.resolve(config.lenovoRetail.artifactDir, 'latest-adjusted-inventory-snapshot.json'),
      webPath: path.resolve(config.appDir, '../web-cockpit/public/data/latest-adjusted-inventory-snapshot.json'),
    },
    inventoryMaster: {
      snapshot: inventoryMaster,
      artifactPath: path.resolve(config.lenovoRetail.artifactDir, 'latest-inventory-master-snapshot.json'),
      webPath: path.resolve(config.appDir, '../web-cockpit/public/data/latest-inventory-master-snapshot.json'),
    },
    locks,
    plan,
    warrantyQueue,
    retailAudit,
    retailZone,
    publishedProjectionRefresh,
    terminalPriceAudit,
    terminalTitleAudit,
    marketingBoost,
  }
}

function toStringValue(value: unknown) {
  return String(value ?? '').trim()
}

function toNumberValue(value: unknown, fallback = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

async function saveRetailCoreFrontendBridgeSnapshots(rebuilt: Awaited<ReturnType<typeof rebuildDerivedSnapshots>>) {
  const generatedAt = new Date().toISOString()
  const movementRecords = rebuilt.movementSync.snapshot.records as Array<Record<string, unknown>>
  const salesMovementRecords = movementRecords.filter((record) => toStringValue(record.movementType) === 'sales_outbound')
  const salesOrderMap = new Map<string, {
    id: string
    business_date: string
    note: string
    created_at: string
    lineCount: number
  }>()

  for (const record of salesMovementRecords) {
    const orderId = toStringValue(record.documentNumber) || toStringValue(record.sourceRef) || toStringValue(record.id)
    if (!orderId) continue
    const existing = salesOrderMap.get(orderId)
    const businessDate = toStringValue(record.businessDate).slice(0, 10)
    const createdAt = toStringValue(record.updatedAt) || generatedAt
    if (existing) {
      existing.lineCount += 1
      if (createdAt > existing.created_at) existing.created_at = createdAt
      continue
    }
    salesOrderMap.set(orderId, {
      id: orderId,
      business_date: businessDate,
      note: toStringValue(record.note) || `智店通销售出库导入，单据 ${orderId}`,
      created_at: createdAt,
      lineCount: 1,
    })
  }

  const salesOrders = Array.from(salesOrderMap.values())
    .sort((a, b) => `${b.business_date} ${b.created_at}`.localeCompare(`${a.business_date} ${a.created_at}`))
    .map((order) => ({
      id: order.id,
      store_code: 'STORE-XY-SYL',
      operator_id: 'ZHIDIANTONG',
      customer_name: '',
      status: 'completed',
      total_amount: null,
      amount_status: 'pending_source_export',
      amount_source: 'missing_orderData_orderProductData',
      business_date: order.business_date,
      note: order.note,
      created_at: order.created_at,
      source_line_count: order.lineCount,
    }))

  const existingSalesOrdersPayload = (
    await readJsonIfExists<{ items?: Array<Record<string, unknown>> }>(webDataPath('latest-retail-core-sales-orders.json'))
  ) ?? (
    await readJsonIfExists<{ items?: Array<Record<string, unknown>> }>(artifactPath('latest-retail-core-sales-orders.json'))
  )
  const existingSalesOrders = Array.isArray(existingSalesOrdersPayload?.items)
    ? existingSalesOrdersPayload.items
    : []
  const mergedSalesOrderMap = new Map<string, Record<string, unknown>>()
  for (const item of existingSalesOrders) {
    const orderId = toStringValue(item.id || item.order_number || item.order_no)
    if (!orderId) continue
    mergedSalesOrderMap.set(orderId, item)
  }
  for (const bridgeOrder of salesOrders as Array<Record<string, unknown>>) {
    const bridgeOrderId = toStringValue(bridgeOrder.id)
    const existing = mergedSalesOrderMap.get(bridgeOrderId)
    if (!existing) {
      mergedSalesOrderMap.set(bridgeOrderId, bridgeOrder)
      continue
    }
    const merged = { ...bridgeOrder, ...existing }
    for (const [key, value] of Object.entries(bridgeOrder)) {
      const current = merged[key]
      if (
        current === undefined
        || current === null
        || (typeof current === 'string' && !current.trim())
      ) {
        merged[key] = value
      }
    }
    mergedSalesOrderMap.set(bridgeOrderId, merged)
  }
  const mergedSalesOrders = Array.from(mergedSalesOrderMap.values()).sort((a, b) => (
    `${toStringValue(b.business_date)} ${toStringValue(b.created_at)}`
      .localeCompare(`${toStringValue(a.business_date)} ${toStringValue(a.created_at)}`)
  ))

  const movementItems = movementRecords
    .map((record) => {
      const movementType = toStringValue(record.movementType)
      const supplierName = toStringValue(record.supplierName) || (
        movementType === 'purchase_inbound' || movementType === 'transfer_inbound'
          ? '联想'
          : ''
      )
      return {
        id: toStringValue(record.id),
        sku_key: toStringValue(record.skuKey),
        product_name: toStringValue(record.productName),
        category: toStringValue(record.category),
        source_category: toStringValue(record.sourceCategory),
        jd_subcategory: toStringValue(record.jdSubcategory),
        serial_number: toStringValue(record.serialNumber),
        movement_type: movementType,
        quantity: toNumberValue(record.quantity),
        business_date: toStringValue(record.businessDate).slice(0, 10),
        source_system: toStringValue(record.sourceSystem) || 'system_inventory_movements',
        source_ref: toStringValue(record.documentNumber) || toStringValue(record.sourceRef),
        note: toStringValue(record.note),
        created_at: toStringValue(record.updatedAt) || generatedAt,
        pn_mtm: toStringValue(record.pnMtm),
        spec: toStringValue(record.spec),
        location_name: toStringValue(record.locationName),
        operator_name: toStringValue(record.operatorName),
        supplier_name: supplierName,
        inbound_document_no: toStringValue(record.inboundDocumentNo) || toStringValue(record.documentNumber),
      }
    })
    .sort((a, b) => `${b.business_date} ${b.created_at}`.localeCompare(`${a.business_date} ${a.created_at}`))

  const typeCounts = movementItems.reduce<Record<string, number>>((acc, item) => {
    if (!item.movement_type) return acc
    acc[item.movement_type] = (acc[item.movement_type] ?? 0) + 1
    return acc
  }, {})

  const masterRows = rebuilt.inventoryMaster.snapshot.rows as Array<Record<string, unknown>>
  const serialItems = masterRows
    .filter((row) => toStringValue(row.serialNumber))
    .map((row) => {
      const inStock = Boolean(row.inStock)
      return {
        serial_number: toStringValue(row.serialNumber),
        sku_key: toStringValue(row.skuKey),
        product_name: toStringValue(row.productName),
        pn_mtm: toStringValue(row.pnMtm),
        spec: toStringValue(row.spec),
        status: inStock ? 'in_stock' : 'out_of_stock',
        warehouse_code: 'STORE',
        location_code: toStringValue(row.locationName) || 'SALES_FLOOR',
        cost_amount: toNumberValue(row.purchaseCost, 0) || null,
        inbound_date: toStringValue(row.inboundDate),
        inbound_document_no: toStringValue(row.inboundDocumentNumber),
        operator_name: toStringValue(row.inboundOperatorName),
        supplier_name: toStringValue(row.supplierName),
        warranty_status: toStringValue(row.warrantyStatus) || 'unknown',
        updated_at: generatedAt,
      }
    })

  const statusCounts = serialItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})
  const tableCounts = {
    sales_order: salesOrders.length,
    inventory_movement: movementItems.length,
    serial_item: serialItems.length,
  }
  const payloads = {
    'latest-retail-core-status.json': {
      generatedAt,
      source: 'zhidiantong-sync-cycle-frontend-bridge',
      tableCounts,
    },
    'latest-retail-core-sales-orders.json': {
      generatedAt,
      source: 'inventory_movements_sales_outbound_bridge',
      items: mergedSalesOrders.slice(0, 4000),
      count: mergedSalesOrders.length,
    },
    'latest-retail-core-inventory-movements.json': {
      generatedAt,
      source: 'inventory_movements_bridge',
      items: movementItems.slice(0, 1000),
      count: movementItems.length,
      typeCounts,
    },
    'latest-retail-core-serial-items.json': {
      generatedAt,
      source: 'inventory_master_bridge',
      items: serialItems.slice(0, 1200),
      count: serialItems.length,
      statusCounts,
    },
  }
  const files: string[] = []
  for (const [fileName, payload] of Object.entries(payloads)) {
    const artifactFile = artifactPath(fileName)
    const webFile = webDataPath(fileName)
    await Promise.all([
      writeFileAtomic(artifactFile, `${JSON.stringify(payload, null, 2)}\n`),
      writeFileAtomic(webFile, `${JSON.stringify(payload, null, 2)}\n`),
    ])
    files.push(artifactFile, webFile)
  }
  return {
    files,
    orderIds: mergedSalesOrders.map((order) => toStringValue(order.id || order.order_number || order.order_no)).filter(Boolean),
    metrics: {
      salesOrderCount: mergedSalesOrders.length,
      inventoryMovementCount: movementItems.length,
      serialItemCount: serialItems.length,
      salesOutboundMovementCount: typeCounts.sales_outbound ?? 0,
    },
  }
}

async function saveTaskReport(report: Omit<ScheduledTaskReport, 'artifacts'>) {
  await ensureReportDirs(report.taskName)
  const reportPath = path.join(reportDir, report.taskName, `${getTimestampKey(new Date(report.finishedAt))}.json`)

  const previousReports = (await readJsonIfExists<Partial<Record<ScheduledTaskName, ScheduledTaskReport>>>(latestReportsPath)) ?? {}
  const nextLatestReports = {
    ...previousReports,
    [report.taskName]: {
      ...report,
      artifacts: {
        reportPath,
        latestReportPath: latestReportsPath,
        dashboardPath,
        webDashboardPath,
        evidencePaths: [],
      },
    },
  } satisfies Partial<Record<ScheduledTaskName, ScheduledTaskReport>>

  const dashboard: ScheduledTaskDashboard = {
    generatedAt: new Date().toISOString(),
    latestByTask: nextLatestReports,
  }

  const artifactReport: ScheduledTaskReport = {
    ...report,
    artifacts: {
      reportPath,
      latestReportPath: latestReportsPath,
      dashboardPath,
      webDashboardPath,
      evidencePaths: report.steps.flatMap((step) => step.files ?? []),
    },
  }
  nextLatestReports[report.taskName] = artifactReport
  dashboard.latestByTask[report.taskName] = artifactReport

  await Promise.all([
    writeFileAtomic(reportPath, `${JSON.stringify(artifactReport, null, 2)}\n`),
    writeFileAtomic(latestReportsPath, `${JSON.stringify(nextLatestReports, null, 2)}\n`),
    writeFileAtomic(dashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`),
    writeFileAtomic(webDashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`),
  ])

  await sendScheduledTaskReportCard(artifactReport)

  return artifactReport
}

function createBaseReport(taskName: ScheduledTaskName) {
  return {
    taskName,
    executedAt: new Date().toISOString(),
    warnings: [] as string[],
    steps: [] as TaskStepResult[],
    frontendRefreshed: false,
    newRecordCount: 0,
    updatedRecordCount: 0,
    unmatchedProductCount: 0,
    executionOutcome: undefined as TaskExecutionOutcome | undefined,
    manualActionRequired: false,
    blockingReason: undefined as string | undefined,
  }
}

const STRICT_VISIBLE_CONTENT_TASKS = new Set<ScheduledTaskName>([
  'daily-jd-lenovo-price-sync',
  'daily-price-channel-check',
  'daily-gray-channel-check',
  'daily-competitor-monitor-check',
  'zhidiantong-sync-cycle',
  'sn-warranty-backfill',
])

const STRICT_FRONTEND_VISIBLE_SYNC_TASKS = new Set<ScheduledTaskName>([
  'daily-jd-lenovo-price-sync',
  'daily-price-channel-check',
  'daily-gray-channel-check',
  'daily-competitor-monitor-check',
  'zhidiantong-sync-cycle',
  'daily-stale-inventory-check',
])

function hasCompletedStep(steps: TaskStepResult[], stepName: string) {
  return steps.some((step) => step.step === stepName && step.status === 'completed')
}

function hasAnyStep(steps: TaskStepResult[], stepName: string) {
  return steps.some((step) => step.step === stepName)
}

function enforceStrictVisibleClosureGates(
  taskName: ScheduledTaskName,
  base: ReturnType<typeof createBaseReport>,
) {
  if (STRICT_VISIBLE_CONTENT_TASKS.has(taskName) && !hasCompletedStep(base.steps, 'verify_visible_page_content_gate')) {
    if (!hasAnyStep(base.steps, 'verify_visible_page_content_gate')) {
      base.steps.push({
        step: 'verify_visible_page_content_gate',
        status: 'failed',
        detail: '本轮缺少页面内容复核证据：仅有页面打开、文件解析、快照重建或脚本执行，不足以判定真实完成。必须留下可见页面中的标题/群名、规格配置、价格或状态区证据。',
      })
    }
    base.warnings.push('缺少“页面内容复核”证据：未确认可见页面标题/规格/价格/状态区，不能把打开页面当成已采集完成。')
    if (base.executionOutcome === undefined || base.executionOutcome === 'real_completed') {
      base.executionOutcome = 'executed_not_closed'
    }
    base.manualActionRequired = true
    base.blockingReason ??= '缺少页面内容复核证据，当前只能记为已执行未收口。'
  }

  if (
    STRICT_FRONTEND_VISIBLE_SYNC_TASKS.has(taskName)
    && (!base.frontendRefreshed || !hasCompletedStep(base.steps, 'verify_frontend_visible_sync_gate'))
  ) {
    if (!hasAnyStep(base.steps, 'verify_frontend_visible_sync_gate')) {
      base.steps.push({
        step: 'verify_frontend_visible_sync_gate',
        status: 'failed',
        detail: '本轮缺少前端可见复核证据：SQL/API 或静态快照更新不等于用户已看到最新值。必须确认前端页面已显示本轮最新结果。',
      })
    }
    base.warnings.push('缺少“前端可见复核”证据：SQL/API 已更新但未确认前端页面实际显示本轮最新数据。')
    if (base.executionOutcome === undefined || base.executionOutcome === 'real_completed') {
      base.executionOutcome = 'executed_not_closed'
    }
    base.manualActionRequired = true
    base.blockingReason ??= '缺少前端可见复核证据，当前只能记为已执行未收口。'
  }
}

function getPageRiskRecoveryHint(taskName: ScheduledTaskName, blockingReason?: string) {
  const text = `${taskName} ${blockingReason ?? ''}`
  if (taskName.startsWith('zhidiantong-sync') || /智店通|retail-pos/i.test(text)) {
    return '已要求按智店通恢复口径处理：只在当前默认 Chrome 会话执行“等待确认 -> 刷新一次 -> 返回上一级重进 -> 重新筛当天日期查询”；若被动跳登录页，再按“打开登录页 -> 输入 15637798222 -> 下一步 -> 点一次密码输入区域 -> 选择浏览器已保存密码候选 -> 确认登录”恢复一次；短信验证码、二次认证、滑块或安全验证改为 blocked_page_risk 并飞书提醒用户处理。'
  }
  if (taskName === 'daily-price-channel-check' || taskName === 'daily-gray-channel-check' || /localhost:3001|网页微信|公众号|分销群/i.test(text)) {
    return '已要求网页微信停止当前路径，并通过飞书群提醒用户在当前默认 Chrome 会话恢复登录或验证；禁止新开浏览器/Profile。'
  }
  if (taskName === 'daily-jd-lenovo-price-sync' || taskName === 'daily-competitor-monitor-check' || /京东|联想官网|天猫|淘宝|403|滑块|验证码|安全验证/i.test(text)) {
    return '已要求相关商城路径停止当前操作，并通过飞书群提醒用户在当前默认 Chrome 会话恢复登录或完成人机验证；禁止新开浏览器/Profile。'
  }
  if (taskName === 'sn-warranty-backfill') {
    return '已要求联想保修查询路径停止当前操作，并通过飞书群提醒用户在当前默认 Chrome 会话恢复登录或验证；禁止新开浏览器/Profile。'
  }
  return '已要求停止当前路径，并通过飞书群提醒用户在当前默认 Chrome 会话恢复登录或验证后再继续；禁止新开浏览器/Profile。'
}


async function writeLatestGrayChannelAlias(sourcePath: string, aliasName: string) {
  const payload = await fs.readFile(sourcePath, 'utf-8').catch(() => '')
  if (!payload.trim()) return
  const aliasArtifact = artifactPath(aliasName)
  const aliasWeb = webDataPath(aliasName)
  await Promise.all([writeFileAtomic(aliasArtifact, payload), writeFileAtomic(aliasWeb, payload)])
}

export async function executeGrayChannelCheck(base: ReturnType<typeof createBaseReport>, taskName: ScheduledTaskName): Promise<void> {
  const capturePlan = await prepareGrayChannelCapturePlan(taskName)
  base.steps.push({
    step: 'prepare_gray_channel_capture_plan',
    status: 'completed',
    detail: '已写灰渠公众号入口访问与采集计划，含入口链路、菜单按钮、落盘文件名与缺任一步时的阻塞原因。',
    files: [capturePlan.capturePlanPath, capturePlan.webPath],
  })

  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const today = getShanghaiDateString()
  const visitEvidencePath = path.resolve(manualDir, `gray-channel-visible-article-${today}.txt`)
  const visitContent = await fs.readFile(visitEvidencePath, 'utf-8').catch(() => '')
  const visitDateMatch = visitContent.match(/(?:#\s*可见文章日期:\s*)(20\d{2}-\d{2}-\d{2})/)
  const visitDate = visitDateMatch?.[1]
  const hasVisit = Boolean(visitContent.trim())
  const visitIsToday = visitDate === today
  const visitIsStale = Boolean(visitDate && visitDate < today)

  const source = await loadGrayWholesaleRawText()
  const rawText = source.rawText
  const sourceFile = source.sourceFile
  const rawTextIsToday = rawText ? rawText.includes(today) : false

  if (!hasVisit) {
    base.executionOutcome = 'blocked_page_risk'
    base.manualActionRequired = true
    base.blockingReason = `灰渠公众号入口到报价页链路失败：未发现 ${capturePlan.visibleArticleName} 访问证据文件，必须先在当前默认 Chrome 会话中进入文件传输助手聊天记录区下的固定公众号入口，并写访问证据。`
    base.steps.push({
      step: 'record_gray_channel_visit_evidence',
      status: 'failed',
      detail: '未发现今天日期的灰渠公众号入口访问证据文件；视为入口未到达。',
      files: [visitEvidencePath],
    })
  } else if (visitIsToday && rawText && rawTextIsToday) {
    const result = await saveGrayWholesaleSnapshotFromText(rawText, {
      expectedFreshQuoteDate: today,
      sourceFile,
      visitEvidencePath: visitEvidencePath,
    })
    base.updatedRecordCount += result.snapshot.quoteCount
    base.executionOutcome = 'real_completed'
    base.steps.push({
      step: 'record_gray_channel_visit_evidence',
      status: 'completed',
      detail: `已记录可见文章日期 ${visitDate}；入口已到达。`,
      files: [visitEvidencePath],
    })
    base.steps.push({
      step: 'parse_gray_wholesale',
      status: 'completed',
      detail: `已解析今天新的灰渠报价原文，quoteCount=${result.snapshot.quoteCount}`,
      metrics: {
        quoteCount: result.snapshot.quoteCount,
        isCarriedForward: result.snapshot.isCarriedForward,
        effectiveQuoteDate: result.snapshot.effectiveQuoteDate,
        latestVisibleArticleDate: result.snapshot.latestVisibleArticleDate,
      },
      files: [result.artifactPath, result.webPath, ...(sourceFile ? [sourceFile] : [])],
    })
  } else if (visitIsToday && (!rawText || !rawTextIsToday)) {
    const result = await saveGrayWholesaleSnapshotFromText(rawText, {
      expectedFreshQuoteDate: today,
      sourceFile,
      visitEvidencePath: visitEvidencePath,
    })
    base.updatedRecordCount += result.snapshot.quoteCount
    base.executionOutcome = 'blocked_missing_input'
    base.manualActionRequired = true
    base.blockingReason = `灰渠公众号今天已到达入口并记录了 ${visitDate}，但缺当天落盘原文或原文日期不是 ${today}；当前沿用最后一次有效原文。`
    base.steps.push({
      step: 'record_gray_channel_visit_evidence',
      status: 'completed',
      detail: `已记录可见文章日期 ${visitDate}；入口已到达。`,
      files: [visitEvidencePath],
    })
    base.steps.push({
      step: 'parse_gray_wholesale',
      status: 'failed',
      detail: '入口已到达但当天原文未到，按最后一次有效原文重建快照。',
      metrics: {
        isCarriedForward: result.snapshot.isCarriedForward,
        latestVisibleArticleDate: result.snapshot.latestVisibleArticleDate,
        effectiveQuoteDate: result.snapshot.effectiveQuoteDate,
      },
      files: [result.artifactPath, result.webPath, ...(sourceFile ? [sourceFile] : [])],
    })
  } else {
    const result = await saveGrayWholesaleSnapshotFromText(rawText, {
      expectedFreshQuoteDate: today,
      sourceFile,
      visitEvidencePath: visitEvidencePath,
    })
    base.updatedRecordCount += result.snapshot.quoteCount
    base.executionOutcome = 'executed_not_closed'
    base.manualActionRequired = true
    base.blockingReason = `灰渠公众号最新可见文章 ${visitDate ?? '未知'} 早于 ${today}，正文无当天可写入联想正式快照的报价；当前沿用最后一次有效联想报价。`
    base.steps.push({
      step: 'record_gray_channel_visit_evidence',
      status: 'completed',
      detail: `已记录可见文章日期 ${visitDate}；非当天可见文章。`,
      files: [visitEvidencePath],
    })
    base.steps.push({
      step: 'parse_gray_wholesale',
      status: 'failed',
      detail: '公众号进入完成但当天无新报价，按最后一次有效联想报价重建快照。',
      metrics: {
        isCarriedForward: result.snapshot.isCarriedForward,
        latestVisibleArticleDate: result.snapshot.latestVisibleArticleDate,
        effectiveQuoteDate: result.snapshot.effectiveQuoteDate,
      },
      files: [result.artifactPath, result.webPath, ...(sourceFile ? [sourceFile] : [])],
    })
  }

  // 写 latest 别名供前端 5174 直接 fetch
  await writeLatestGrayChannelAlias(capturePlan.capturePlanPath, 'latest-gray-channel-capture-plan.json')
  const latestVisitPath = path.resolve(config.lenovoRetail.artifactDir, 'manual', `gray-channel-visible-article-${today}.txt`)
  await writeLatestGrayChannelAlias(latestVisitPath, 'latest-gray-channel-visible-article.json')

}

export async function runScheduledTask(taskName: ScheduledTaskName): Promise<ScheduledTaskReport> {
  const startedAt = Date.now()
  const base = createBaseReport(taskName)
  const taskNameKey = String(taskName)
  const protectedRetailRuleStateBefore = await captureProtectedRetailRuleStates()

  try {
  if (taskName === 'sync-health-spot-check') {
      const sqlAudit = await syncSqlMirrorAndBuildGapAudit(taskName)
      const inventoryTerminalSync = await syncInventoryTerminalState()
      const inventoryTerminalSummary = inventoryTerminalSync.audit.summary ?? {}
      const inventoryTerminalMismatchCount =
        Number(inventoryTerminalSummary.coreStockSnMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.projectionVsStandardMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.channelStockSnMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.distMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.liveMismatchCount ?? 0)
      const purchaseInboundAudit = await auditPurchaseInboundCompleteness()

      base.frontendRefreshed = true
      base.steps.push({
        step: 'sync_sql_mirror_and_gap_audit',
        status: sqlAudit.status === 'completed' ? (sqlAudit.blockCurrentTask ? 'failed' : 'completed') : 'failed',
        detail: sqlAudit.status !== 'completed'
          ? `SQL 自动同步与缺口审计执行失败：${sqlAudit.error ?? 'unknown error'}`
          : sqlAudit.blockCurrentTask
            ? `SQL 同步缺口未收口：open=${sqlAudit.openGapCount}，critical=${sqlAudit.criticalOpenGapCount}，warning=${sqlAudit.warningOpenGapCount}。`
            : 'SQL 自动同步与缺口审计通过：本轮抽检未发现阻塞级 open gap。',
        metrics: {
          openGapCount: sqlAudit.openGapCount,
          criticalOpenGapCount: sqlAudit.criticalOpenGapCount,
          warningOpenGapCount: sqlAudit.warningOpenGapCount,
          localSyncWrittenCount: sqlAudit.localSyncWrittenCount ?? 0,
          snapshotCacheSyncedCount: Number(sqlAudit.snapshotCache?.syncedCount ?? 0),
          snapshotCacheSkippedCount: Number(sqlAudit.snapshotCache?.skippedCount ?? 0),
        },
        files: [
          scheduledSqlAuditPath(),
          scheduledSqlAuditWebPath(),
        ],
      })
      base.steps.push({
        step: 'sync_inventory_terminal_state',
        status: inventoryTerminalSync.blocking ? 'failed' : 'completed',
        detail: inventoryTerminalSync.blocking
          ? '抽检已执行库存终端同步脚本，但主库/标准快照/终端投影仍存在库存或 SN 不一致。'
          : '抽检已执行库存终端同步脚本，主库、标准库存快照和全部终端投影一致。',
        metrics: {
          writtenCount: inventoryTerminalSync.writtenCount,
          coreStockSnMismatchCount: Number(inventoryTerminalSummary.coreStockSnMismatchCount ?? 0),
          projectionVsStandardMismatchCount: Number(inventoryTerminalSummary.projectionVsStandardMismatchCount ?? 0),
          channelStockSnMismatchCount: Number(inventoryTerminalSummary.channelStockSnMismatchCount ?? 0),
          distMismatchCount: Number(inventoryTerminalSummary.distMismatchCount ?? 0),
          liveMismatchCount: Number(inventoryTerminalSummary.liveMismatchCount ?? 0),
        },
        files: [
          inventoryTerminalSync.scriptPath,
          artifactPath('latest-standard-inventory-snapshot.json'),
          webDataPath('latest-standard-inventory-snapshot.json'),
        ],
      })
      base.steps.push({
        step: 'verify_purchase_inbound_detail_coverage',
        status: purchaseInboundAudit.status === 'completed' && !purchaseInboundAudit.blockCurrentTask ? 'completed' : 'failed',
        detail: purchaseInboundAudit.status !== 'completed'
          ? `采购入库抽检执行失败：${purchaseInboundAudit.error ?? 'unknown error'}`
          : purchaseInboundAudit.blockCurrentTask
            ? `采购入库抽检仍发现缺口：缺成本 ${purchaseInboundAudit.sameDayMissingCostCount}、缺SN ${purchaseInboundAudit.sameDayMissingSerialCount}、分/元异常 ${purchaseInboundAudit.sameDayScaledCostCount}、金额异常 ${purchaseInboundAudit.sameDayAbsurdAmountCount}。`
            : '采购入库抽检通过：同日采购入库成本、SN、金额单位和金额计算均已收口。',
        metrics: {
          purchaseInboundTotal: purchaseInboundAudit.purchaseInboundTotal,
          missingCostCount: purchaseInboundAudit.missingCostCount,
          missingSupplierCount: purchaseInboundAudit.missingSupplierCount,
          missingSerialDisplayCount: purchaseInboundAudit.missingSerialDisplayCount,
          sameDayMissingCostCount: purchaseInboundAudit.sameDayMissingCostCount,
          sameDayMissingSerialCount: purchaseInboundAudit.sameDayMissingSerialCount,
          sameDayScaledCostCount: purchaseInboundAudit.sameDayScaledCostCount,
          sameDayAbsurdAmountCount: purchaseInboundAudit.sameDayAbsurdAmountCount,
          manualAdjustmentCgrCount: purchaseInboundAudit.manualAdjustmentCgrCount,
        },
        files: [
          purchaseInboundGapAuditPath(),
          purchaseInboundGapAuditWebPath(),
        ],
      })
      if (sqlAudit.status !== 'completed') {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `同步动作抽检失败：SQL 自动同步审计执行异常：${sqlAudit.error ?? 'unknown error'}`
        base.warnings.push(base.blockingReason)
      } else if (sqlAudit.blockCurrentTask) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `同步动作抽检未通过：当前仍有 ${sqlAudit.openGapCount} 条 SQL open gap。`
        base.warnings.push(base.blockingReason)
      } else if (inventoryTerminalSync.blocking || inventoryTerminalMismatchCount > 0) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `同步动作抽检未通过：库存终端仍有 ${inventoryTerminalMismatchCount} 处库存/SN 不一致。`
        base.warnings.push(base.blockingReason)
      } else if (purchaseInboundAudit.status !== 'completed') {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `同步动作抽检失败：采购入库审计执行异常：${purchaseInboundAudit.error ?? 'unknown error'}`
        base.warnings.push(base.blockingReason)
      } else if (purchaseInboundAudit.blockCurrentTask) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = purchaseInboundAudit.sameDayMissingCostCount > 0
          ? `同步动作抽检未通过：同日采购入库仍有 ${purchaseInboundAudit.sameDayMissingCostCount} 条进货成本价待补。`
          : purchaseInboundAudit.sameDayMissingSerialCount > 0
            ? `同步动作抽检未通过：同日采购入库仍有 ${purchaseInboundAudit.sameDayMissingSerialCount} 条采购 SN 待补。`
            : purchaseInboundAudit.sameDayScaledCostCount > 0
              ? `同步动作抽检未通过：同日采购入库仍有 ${purchaseInboundAudit.sameDayScaledCostCount} 条分/元单位异常。`
              : purchaseInboundAudit.sameDayAbsurdAmountCount > 0
                ? `同步动作抽检未通过：同日采购入库仍有 ${purchaseInboundAudit.sameDayAbsurdAmountCount} 条金额异常。`
                : `同步动作抽检未通过：采购入库仍有 ${purchaseInboundAudit.missingSupplierCount} 条供应商待补。`
        base.warnings.push(base.blockingReason)
      } else {
        base.executionOutcome = 'real_completed'
        base.manualActionRequired = false
      }
    }
    if (taskName === 'daily-price-channel-check') {
      try {
        let marketingBoostSync: Awaited<ReturnType<typeof saveMarketingBoostSnapshot>> | undefined
        const latestDistributorSnapshot = await readJsonIfExists<{
          quoteDate?: string
          quoteCount?: number
          quotes?: unknown[]
          quoteFile?: string
          generatedAt?: string
        }>(artifactPath('latest-distributor-quotes.json'))
        const webDistributorSnapshot = await readJsonIfExists<{
          quoteDate?: string
          quoteCount?: number
          quotes?: unknown[]
          quoteFile?: string
        }>(webDataPath('latest-distributor-quotes.json'))
        const distDistributorSnapshot = await readJsonIfExists<{
          quoteDate?: string
          quoteCount?: number
          quotes?: unknown[]
          quoteFile?: string
        }>(path.resolve(config.appDir, '../web-cockpit/dist/data/latest-distributor-quotes.json'))
        const quoteDate = latestDistributorSnapshot?.quoteDate
        const quoteCount = latestDistributorSnapshot?.quoteCount ?? latestDistributorSnapshot?.quotes?.length ?? 0
        const latestQuoteFile = await findLatestDistributorQuoteFile()
        const alreadySyncedLatestFile = Boolean(
          latestQuoteFile
          && latestDistributorSnapshot?.quoteFile
          && path.resolve(latestQuoteFile) === path.resolve(latestDistributorSnapshot.quoteFile),
        )
        const webSyncedLatestFile = Boolean(
          latestQuoteFile
          && webDistributorSnapshot?.quoteDate === getTodayDateString()
          && webDistributorSnapshot?.quoteFile
          && path.resolve(latestQuoteFile) === path.resolve(webDistributorSnapshot.quoteFile),
        )
        const distSyncedLatestFile = Boolean(
          latestQuoteFile
          && distDistributorSnapshot?.quoteDate === getTodayDateString()
          && distDistributorSnapshot?.quoteFile
          && path.resolve(latestQuoteFile) === path.resolve(distDistributorSnapshot.quoteFile),
        )
        if (quoteDate === getTodayDateString() && alreadySyncedLatestFile && webSyncedLatestFile && distSyncedLatestFile) {
          const marketingBoost = await saveMarketingBoostSnapshot()
          marketingBoostSync = marketingBoost
          base.updatedRecordCount += 0
          base.unmatchedProductCount = 0
          base.executionOutcome = 'real_completed'
          base.manualActionRequired = false
          base.steps.push({
            step: 'scan_distributor_quote_source',
            status: 'completed',
            detail: '已扫描分销群报价原始文件；最新文件已同步过且快照为当天，本轮不重复覆盖实时进货价。',
            metrics: {
              quoteCount,
              quoteDate,
              hasLatestQuoteFile: Boolean(latestQuoteFile),
              alreadySyncedLatestFile,
              webSyncedLatestFile,
              distSyncedLatestFile,
            },
            files: [
              artifactPath('latest-distributor-quotes.json'),
              webDataPath('latest-distributor-quotes.json'),
              path.resolve(config.appDir, '../web-cockpit/dist/data/latest-distributor-quotes.json'),
              marketingBoost.artifactPath,
              marketingBoost.webPath,
              ...(latestQuoteFile ? [latestQuoteFile] : []),
            ],
          })
        } else {
          const result = await saveDistributorQuoteArtifacts()
          marketingBoostSync = result.marketingBoost
          base.updatedRecordCount += result.quoteCount
          base.unmatchedProductCount = Math.max(result.quoteCount - result.priceProtection.matchedSkuCount, 0)
          base.executionOutcome = result.priceProtection.quoteDate === getTodayDateString()
            ? 'real_completed'
            : 'executed_not_closed'
          base.manualActionRequired = result.priceProtection.quoteDate !== getTodayDateString()
          if (result.priceProtection.quoteDate !== getTodayDateString()) {
            base.blockingReason = `分销报价文件日期不是今天：${result.priceProtection.quoteDate ?? '未识别'}`
          }
          base.steps.push({
            step: 'parse_distributor_quotes',
            status: 'completed',
            detail: quoteDate === getTodayDateString()
              ? '已扫描到新的当天群报价原始文件，已解析并同步实时进货价。'
              : '现有分销群报价快照不是当天，已按每日流程查找并解析当天原始文件。',
            metrics: {
              quoteCount: result.quoteCount,
              matchedSkuCount: result.priceProtection.matchedSkuCount,
              candidateCount: result.priceProtection.candidates.length,
              quoteDate: result.priceProtection.quoteDate ?? '',
            },
            files: [
              result.quoteFile,
              result.quotesPath,
              result.priceProtectionPath,
              result.webQuotesPath,
              result.webPriceProtectionPath,
              result.distQuotesPath,
              result.distPriceProtectionPath,
              result.marketingBoost.artifactPath,
              result.marketingBoost.webPath,
            ],
          })
        }
        if (marketingBoostSync) {
          base.steps.push({
            step: 'sync_marketing_boost_activity_library',
            status: 'completed',
            detail: '已随群报价同步扫描营销活动备注与手工图片识别结果，刷新 PO 加磅营销活动库。',
            metrics: {
              activityCount: marketingBoostSync.snapshot.summary.activityCount,
              distributorRemarkActivityCount: marketingBoostSync.snapshot.summary.distributorRemarkActivityCount,
              manualUploadActivityCount: marketingBoostSync.snapshot.summary.manualUploadActivityCount,
              eligibleInventoryCount: marketingBoostSync.snapshot.summary.eligibleInventoryCount,
              heroCardCount: marketingBoostSync.snapshot.summary.heroCardCount,
              unmatchedActivityCount: marketingBoostSync.snapshot.summary.unmatchedActivityCount,
            },
            files: [
              marketingBoostSync.artifactPath,
              marketingBoostSync.webPath,
            ],
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        base.warnings.push(`分销商报价未完成: ${message}`)
        base.executionOutcome = 'blocked_missing_input'
        base.manualActionRequired = true
        base.blockingReason = message
        base.steps.push({
          step: 'parse_distributor_quotes',
          status: 'failed',
          detail: message,
        })
      }

      const rebuilt = await rebuildDerivedSnapshots()
      base.frontendRefreshed = true
      base.steps.push({
        step: 'rebuild_derived_snapshots',
        status: 'completed',
        files: rebuildSnapshotFileList(rebuilt),
      })
      const visibleEvidence = await findLatestTaskVisibleEvidence('daily-price-channel-check')
      if (visibleEvidence?.hasPageContentEvidence) {
        base.steps.push({
          step: 'verify_visible_page_content_gate',
          status: 'completed',
          detail: '已发现当前任务的可见页面复核证据文件，包含网页微信/报价页可见内容截图与摘要。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
      if (visibleEvidence?.hasFrontendEvidence) {
        base.steps.push({
          step: 'verify_frontend_visible_sync_gate',
          status: 'completed',
          detail: '已发现当前任务的前端可见复核证据文件，确认 5174 页面已显示本轮最新群报价结果。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
    }


  if (taskName === 'daily-gray-channel-check') {
      await executeGrayChannelCheck(base, taskName)
      const rebuilt = await rebuildDerivedSnapshots()
      base.frontendRefreshed = true
      base.steps.push({
        step: 'rebuild_derived_snapshots',
        status: 'completed',
        files: rebuildSnapshotFileList(rebuilt),
      })
      const visibleEvidence = await findLatestTaskVisibleEvidence('daily-gray-channel-check')
      if (visibleEvidence?.hasPageContentEvidence) {
        base.steps.push({
          step: 'verify_visible_page_content_gate',
          status: 'completed',
          detail: '已发现当前任务的可见页面复核证据文件，包含网页微信公众号正文截图与摘要。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
      if (visibleEvidence?.hasFrontendEvidence) {
        base.steps.push({
          step: 'verify_frontend_visible_sync_gate',
          status: 'completed',
          detail: '已发现当前任务的前端可见复核证据文件，确认 5174 页面已显示本轮灰渠报价结果。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
    }
    if (taskName === 'daily-competitor-monitor-check') {
      const sourceFile = await findLatestCompetitorManualFile()
      const collectionPlan = await saveCompetitorCollectionPlan()
      const result = await saveCompetitorMonitorSnapshot(sourceFile)
      const competitorAudit = result.snapshot.completenessAudit
      const expectedCompetitorCount = competitorAudit?.expectedTotalCount ?? collectionPlan.plan.expectedTotalCount
      base.updatedRecordCount += result.snapshot.itemCount
      if (result.totalItemCount > 0 && result.acceptedItemCount === 0) {
        base.warnings.push(`竞品原始文件已到位，但 ${result.rejectedByScopeCount} 条记录都不是京东自营对应店铺来源。`)
        base.executionOutcome = 'blocked_missing_input'
        base.manualActionRequired = true
        base.blockingReason = `竞品原始文件存在但没有任何京东自营对应店铺来源记录；已生成采集计划 ${collectionPlan.artifactPath}，必须按计划补真实 Chrome 京东自营店详情页后重跑`
      } else if (result.snapshot.partialUpdateBlocked) {
        base.warnings.push(result.snapshot.partialUpdateReason
          ?? `竞品监控当天文件只有 ${result.snapshot.partialUpdateItemCount ?? result.acceptedItemCount} 条，未达到完整门禁；已保留上一版未覆盖部分并继续标记未收口。`)
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = result.snapshot.partialUpdateReason
          ?? `竞品排行当天手工文件不完整；必须按采集计划补齐 ${expectedCompetitorCount} 条后重跑，局部样本不能覆盖前端快照。`
      } else if (result.snapshot.isCarriedForward) {
        base.warnings.push(`竞品监控未发现新的手工排行快照，沿用 ${result.snapshot.carryForwardFrom ?? result.snapshot.quoteDate ?? '最近一次'}。`)
        base.executionOutcome = 'blocked_missing_input'
        base.manualActionRequired = true
        base.blockingReason = `竞品监控缺少当天真实采集结果；已生成采集计划 ${collectionPlan.artifactPath}，必须按计划用 Chrome 京东自营店/详情页补齐后重跑`
      } else if (!competitorAudit || competitorAudit.status !== 'complete') {
        base.warnings.push(`竞品监控当天文件已解析，但未达到完整完成门禁：目标 ${expectedCompetitorCount} 条，当前 ${result.snapshot.itemCount} 条，缺分类 ${competitorAudit?.missingBucketCount ?? 0} 个，字段不完整 ${competitorAudit?.incompleteItemCount ?? 0} 条，非当天采集 ${competitorAudit?.staleItemCount ?? 0} 条。`)
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = competitorAudit?.blockers.length
          ? `竞品排行未收口：${competitorAudit.blockers.join(' ')}`
          : `竞品排行必须补齐 ${expectedCompetitorCount} 条，并且每条都要有链接、商品名、配置、价格、活动 notes 和分类口径；当前不能写 real_completed。`
      } else {
        base.executionOutcome = 'real_completed'
      }
      base.steps.push({
        step: 'build_competitor_collection_plan',
        status: 'completed',
        detail: '已生成当天竞品真实采集计划；定时任务不能只等旧 JSON，必须按该计划完成 Chrome 京东自营店销量排序与详情页证据采集。',
        metrics: {
          brandCount: collectionPlan.plan.brands.length,
          targetPerBrand: collectionPlan.plan.targetPerBrand,
          targetCount: expectedCompetitorCount,
        },
        files: [
          collectionPlan.artifactPath,
          collectionPlan.webPath,
        ],
      })
      base.steps.push({
        step: 'parse_competitor_monitor',
        status: 'completed',
        detail: result.acceptedItemCount === 0
          ? result.totalItemCount > 0
            ? '已解析竞品原始文件，但没有任何条目通过京东自营对应店铺门禁，不能写成真实完成。'
            : '未发现当天竞品手工排行文件，沿用上一版展示并保持阻塞状态。'
          : result.snapshot.partialUpdateBlocked
            ? '已解析当天竞品手工文件，但内容少于上一版且未达完整门禁；本轮拦截局部覆盖，沿用上一版展示并保持未收口。'
            : result.snapshot.isCarriedForward ? '沿用上一版竞品监控快照。' : '已解析新的竞品监控手工排行快照。',
        metrics: {
          totalItemCount: result.totalItemCount,
          acceptedItemCount: result.acceptedItemCount,
          rejectedByScopeCount: result.rejectedByScopeCount,
          itemCount: result.snapshot.itemCount,
          brandCount: result.snapshot.brands.length,
          isCarriedForward: result.snapshot.isCarriedForward,
          partialUpdateBlocked: result.snapshot.partialUpdateBlocked,
          partialUpdateItemCount: result.snapshot.partialUpdateItemCount,
          partialUpdateQuoteDate: result.snapshot.partialUpdateQuoteDate,
          expectedCompetitorCount,
          missingItemCount: competitorAudit?.missingItemCount,
          missingBrandCount: competitorAudit?.missingBrandCount,
          missingBucketCount: competitorAudit?.missingBucketCount,
          incompleteItemCount: competitorAudit?.incompleteItemCount,
          staleItemCount: competitorAudit?.staleItemCount,
        },
        files: [
          ...(result.sourceFile ? [result.sourceFile] : []),
          result.artifactPath,
          result.webPath,
          result.storeFavoritesArtifactPath,
          result.storeFavoritesWebPath,
          result.linkRepositoryArtifactPath,
          result.linkRepositoryWebPath,
          result.collectionPlanArtifactPath,
          result.collectionPlanWebPath,
        ],
      })
    }
    if (taskName === 'daily-jd-lenovo-price-sync') {
      const manualBatchFile = await findLatestManualMarketplaceBatchFile()
      if (manualBatchFile) {
        const recordCount = await countMarketplaceBatchRecords(manualBatchFile)
        const marketplace = await saveMarketplacePriceSnapshot(manualBatchFile)
        base.updatedRecordCount += recordCount
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = '任务1编排层已吃入当天手工批次，但真实 Chrome 页面复核仍需继续收口。'
        base.steps.push({
          step: 'ingest_manual_marketplace_batch',
          status: 'completed',
          detail: '已按规则吃入当天手工批次价格文件，不启用 MiniMax 或无头浏览器采集。',
          metrics: {
            recordCount,
            marketplaceItemCount: marketplace.snapshot.itemCount,
          },
          files: [
            manualBatchFile,
            marketplace.artifactPath,
            marketplace.webPath,
          ],
        })

        const rebuilt = await rebuildDerivedSnapshots()
        base.frontendRefreshed = true
        base.steps.push({
          step: 'rebuild_derived_snapshots',
          status: 'completed',
          files: rebuildSnapshotFileList(rebuilt),
        })
      } else {
        base.warnings.push('任务1当前未发现当天手工价格批次文件；本轮仅生成待采清单，等待 Chrome 现有稳定会话进行电脑操控采集。')
        base.executionOutcome = 'blocked_missing_input'
        base.manualActionRequired = true
        base.blockingReason = '未发现当天手工价格批次文件，无法完成真实页面采价收口。'
        base.steps.push({
          step: 'ingest_manual_marketplace_batch',
          status: 'skipped',
          detail: '未发现当天手工价格批次文件，未执行任何无头/脚本采集。',
        })
      }
      base.steps.push({
        step: 'manual_chrome_capture_required',
        status: 'skipped',
        detail: '任务1正式规则要求使用 Chrome 现有稳定会话与电脑操控手工采集；CLI 调度器只负责编排、批次入库、快照重建和待采清单输出。',
      })
      const visibleEvidence = await findLatestTaskVisibleEvidence('daily-jd-lenovo-price-sync')
      if (visibleEvidence?.hasPageContentEvidence) {
        base.steps.push({
          step: 'verify_visible_page_content_gate',
          status: 'completed',
          detail: '已发现当前任务的可见页面复核证据文件，包含真实页面标题、规格配置、价格或状态区截图与摘要。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
      if (visibleEvidence?.hasFrontendEvidence) {
        base.steps.push({
          step: 'verify_frontend_visible_sync_gate',
          status: 'completed',
          detail: '已发现当前任务的前端可见复核证据文件，确认 5174 页面已显示本轮最新价格复核结果。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
    }
    if (
      taskName === 'zhidiantong-sync-cycle'
    ) {
      const zdtOpenclawBridgePrecheck = await saveZdtOpenclawBridgeSnapshot()
      const sqlPrimaryBridgeReady = zdtOpenclawBridgePrecheck.snapshot.connected
        && Number(zdtOpenclawBridgePrecheck.snapshot.totals.todayRecords ?? 0) > 0
      const orderEntityTodayRecords = (zdtOpenclawBridgePrecheck.snapshot.entitySummaries ?? [])
        .filter((item) => /order|订单/i.test(String(item.entityName ?? '')))
        .reduce((sum, item) => sum + Number(item.todayRecords ?? 0), 0)
      const shouldTriggerEducationAgentScan = sqlPrimaryBridgeReady
        && zdtOpenclawBridgePrecheck.snapshot.isFresh
        && orderEntityTodayRecords > 0
      let agentScanGateMissing = false
      let agentScanGateBlockingReason = ''
      base.steps.push({
        step: 'precheck_zdt_openclaw_sql_bridge',
        status: sqlPrimaryBridgeReady ? 'completed' : 'failed',
        detail: sqlPrimaryBridgeReady
          ? 'OpenClaw SQL 主链已具备当日记录，本轮允许“SQL主链优先同步 + 导出证据补齐”并行，不再因个别导出缺失阻断主同步。'
          : 'OpenClaw SQL 主链缺少当日记录，仍需以当日导出文件作为同步主输入。',
        metrics: {
          connected: zdtOpenclawBridgePrecheck.snapshot.connected,
          todayRecords: zdtOpenclawBridgePrecheck.snapshot.totals.todayRecords,
          isFresh: zdtOpenclawBridgePrecheck.snapshot.isFresh,
        },
        files: [zdtOpenclawBridgePrecheck.artifactPath, zdtOpenclawBridgePrecheck.webPath],
      })
      if (shouldTriggerEducationAgentScan) {
        const agentScanAcquisition = await inspectEducationSubsidyAgentScanAcquisition()
        const agentScanSyncGap = await inspectEducationAgentScanSyncGap()
        if (agentScanAcquisition.status === 'missing_same_day_collection_evidence') {
          base.warnings.push(agentScanAcquisition.detail)
        }
        if (agentScanSyncGap.blocking) {
          agentScanGateMissing = true
          agentScanGateBlockingReason = agentScanGateBlockingReason
            ? `${agentScanGateBlockingReason}；${agentScanSyncGap.detail}`
            : agentScanSyncGap.detail
          base.manualActionRequired = true
          base.warnings.push(agentScanSyncGap.detail)
        }
        base.steps.push({
          step: 'precheck_today_camera_education_agent_scan',
          status: agentScanSyncGap.blocking
            ? 'failed'
            : agentScanAcquisition.status === 'missing_same_day_collection_evidence'
              ? 'skipped'
              : 'completed',
          detail: `${agentScanAcquisition.detail}${agentScanSyncGap.blocking ? `；${agentScanSyncGap.detail}` : ''} 旧的“网页微信群逐图回扫”前置门禁已退役。本轮教育补采集以今日相机/水印相机上传照片为优先来源：当天有新增时，先生成 education-agent-scan-${agentScanAcquisition.today}-*.json，逐条写明 sourceType、sourceGroupName(仅作费率归类)、collectionSource、serialNumbers(SN)、customerName、customerPhone、agentPhone(代扫电话)、modelText、voucherCode、voucherVerifiedAt、reportStatus、销售出库单号与图片时间证据，并保留 photoId / mediaUrl / takenAt 等原始来源字段。单个订单归并规则保持不变：客户电话一致、SN一致、姓名一致三者任一成立即可归并。普通单扫至少要有 1 张产品信息图 + 1 张教育优惠券核销码图；二件套要有 2 个产品信息 + 3 个核销码；三件套要有 3 个产品信息 + 4 个核销码。普通单扫费率暂仍沿用既有分组口径：智店通口径 50 元/台、教育补口径 30 元/台；sourceGroupName 字段当前仅承担费率归类，不再代表微信群采集来源。两件套、三件套、拯救者双屏畅玩两件套仍必须额外通过“营销库 MTM 物料号 + 同一销售出库单号”匹配后才能归类，且套装代扫费只能按整单计算一次，不得重复计算单品代扫费。若 customerPhone 与 agentPhone 不一致，仍需生成 latest-education-agent-scan-phone-mismatch-alerts.json。缺少当天采集记录现在只记提醒，不再单独阻断智店通主同步；真正阻断条件保留为 education-agent-scan-sync-gap 未清空、SQL 未写入或前端未可见。`,
          metrics: {
            sameDayRecordCount: agentScanAcquisition.sameDayRecordCount,
            sameDayRecordFileCount: agentScanAcquisition.sameDayRecordFileCount,
            sameDayNoNewConfirmationFileCount: agentScanAcquisition.sameDayNoNewConfirmationFileCount,
            hasSameDayAgentScanGate: agentScanAcquisition.status !== 'missing_same_day_collection_evidence',
            openRecentGapCount: agentScanSyncGap.recentGapCount,
            openRecentGapDates: agentScanSyncGap.groupedDates.join('、'),
            sourceGroupNames: agentScanAcquisition.sourceGroupNames.join('、'),
            sourceTypes: (agentScanAcquisition.sourceTypes ?? []).join('、'),
            collectionSources: (agentScanAcquisition.collectionSources ?? []).join('、'),
            groupResults: JSON.stringify(agentScanAcquisition.groupResults),
            latestIncompleteFile: agentScanAcquisition.latestIncompleteFile,
            latestConfirmedFile: agentScanAcquisition.latestConfirmedFile,
          },
          files: [
            agentScanAcquisition.manualDir,
            ...agentScanAcquisition.files,
            ...agentScanSyncGap.files,
          ],
        })
      } else {
        base.steps.push({
          step: 'precheck_today_camera_education_agent_scan',
          status: 'skipped',
          detail: '未触发教育补代扫：仅当 OpenClaw 自动对接已连接、数据新鲜（isFresh=true）且当日存在销售订单记录时才触发教育补采集提醒；原微信群前置门禁已退役。',
          metrics: {
            connected: zdtOpenclawBridgePrecheck.snapshot.connected,
            isFresh: zdtOpenclawBridgePrecheck.snapshot.isFresh,
            todayRecords: Number(zdtOpenclawBridgePrecheck.snapshot.totals.todayRecords ?? 0),
            todayOrderRecords: orderEntityTodayRecords,
          },
          files: [zdtOpenclawBridgePrecheck.artifactPath, zdtOpenclawBridgePrecheck.webPath],
        })
      }

      if (!ENABLE_ZHIDIANTONG_MOVEMENT_SYNC) {
        base.steps.push({
          step: 'zhidiantong_movement_sync_paused',
          status: 'skipped',
          detail: '已按当前策略剥离出入库定时导入任务；本任务仅保留教育补贴群/智店通入库群教育代扫采信与同步。',
          metrics: {
            movementSyncEnabled: false,
            educationAgentScanTriggered: shouldTriggerEducationAgentScan,
            educationAgentScanGateMissing: agentScanGateMissing,
          },
        })
        const marketingBoostSync = await saveMarketingBoostSnapshot()
        const rebuilt = await rebuildDerivedSnapshots()
        base.frontendRefreshed = true
        base.steps.push({
          step: 'sync_marketing_boost_and_education_agent_scan',
          status: 'completed',
          detail: '已刷新教育补代扫汇总并同步 SQL/前端快照。',
          metrics: {
            activityCount: marketingBoostSync.snapshot.summary.activityCount,
            educationAgentScanCount: marketingBoostSync.educationAgentScan.snapshot.summary.totalCount,
          },
          files: [
            marketingBoostSync.artifactPath,
            marketingBoostSync.webPath,
            marketingBoostSync.educationAgentScan.artifactPath,
            marketingBoostSync.educationAgentScan.webPath,
          ],
        })
        base.steps.push({
          step: 'rebuild_derived_snapshots',
          status: 'completed',
          files: rebuildSnapshotFileList(rebuilt),
        })
        if (agentScanGateMissing) {
          base.executionOutcome = 'executed_not_closed'
          base.manualActionRequired = true
          base.blockingReason = agentScanGateBlockingReason || '教育补代扫缺少当天采集证据。'
        } else {
          base.executionOutcome = 'real_completed'
          base.manualActionRequired = false
          base.blockingReason = ''
        }
      } else {
      const manualFiles = await findScheduledZhidiantongManualFiles()
      let totalImportedCount = 0
      let totalMergedCount = 0
      let usedUnifiedStockStream = false
      if (manualFiles.rejectedStockStreamFiles.length) {
        base.warnings.push(...manualFiles.rejectedStockStreamFiles.map((item) => `已拒绝非当天库存流水：${item}`))
      }
      if (manualFiles.rejectedSnStockOrderFiles.length) {
        base.warnings.push(...manualFiles.rejectedSnStockOrderFiles.map((item) => `已拒绝非当天SN库存订单：${item}`))
      }
      if (manualFiles.stockStreamFile) {
        try {
          const result = await importZhidiantongStockStream(manualFiles.stockStreamFile)
          totalImportedCount += result.importedCount
          totalMergedCount += result.mergedRecordCount
          if (result.warnings.length) base.warnings.push(...result.warnings)
          base.steps.push({
            step: 'import_zhidiantong_stock_stream',
            status: 'completed',
            detail: '已优先使用智店通库存流水导出统一同步销售/入库/其它出库及 SN。',
            metrics: {
              importedCount: result.importedCount,
              overrideCount: result.overrideCount,
              mergedRecordCount: result.mergedRecordCount,
              mergedOverrideCount: result.mergedOverrideCount,
              skippedCount: result.skippedCount,
            },
            files: [
              result.sourceFile,
              result.files.artifactPath,
              result.files.webPath,
              result.serialOverrideFiles.artifactPath,
              result.serialOverrideFiles.webPath,
            ],
          })
          usedUnifiedStockStream = true
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          base.warnings.push(`库存流水统一导入失败，已回退拆分导入：${message}`)
          base.steps.push({
            step: 'import_zhidiantong_stock_stream',
            status: 'failed',
            detail: message,
          })
        }
      } else {
        base.steps.push({
          step: 'import_zhidiantong_stock_stream',
          status: sqlPrimaryBridgeReady ? 'completed' : 'skipped',
          detail: sqlPrimaryBridgeReady
            ? '未发现当日库存流水导出文件，但 OpenClaw SQL 当日记录已就绪，本轮按 SQL 主链继续同步；导出文件作为补证据项后续补齐。'
            : missingZhidiantongSourceDetail('智店通库存流水导出文件', [
              `zhidiantong-stock-stream-${getTodayDateString()}.xlsx/csv`,
              `stock_count${getTodayDateString()}.xlsx/csv`,
              `stock_count${getTodayCompactDateString()}.xlsx/csv`,
              `库存流水-${getTodayDateString()}.xlsx/csv`,
            ]),
        })
        if (!sqlPrimaryBridgeReady) base.manualActionRequired = true
      }
      if (manualFiles.snStockOrderFile) {
        try {
          const result = await importZhidiantongStockStream(manualFiles.snStockOrderFile)
          totalImportedCount += result.importedCount
          totalMergedCount += result.mergedRecordCount
          if (result.warnings.length) base.warnings.push(...result.warnings)
          base.steps.push({
            step: 'import_zhidiantong_sn_stock_order',
            status: 'completed',
            detail: '已导入当天 SN库存订单，补齐订单出入库对应 SN 明细。',
            metrics: {
              importedCount: result.importedCount,
              overrideCount: result.overrideCount,
              mergedRecordCount: result.mergedRecordCount,
              mergedOverrideCount: result.mergedOverrideCount,
              skippedCount: result.skippedCount,
            },
            files: [
              result.sourceFile,
              result.files.artifactPath,
              result.files.webPath,
              result.serialOverrideFiles.artifactPath,
              result.serialOverrideFiles.webPath,
            ],
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          base.warnings.push(`SN库存订单导入失败：${message}`)
          base.steps.push({
            step: 'import_zhidiantong_sn_stock_order',
            status: 'failed',
            detail: message,
          })
        }
      } else {
        base.steps.push({
          step: 'import_zhidiantong_sn_stock_order',
          status: sqlPrimaryBridgeReady ? 'completed' : 'skipped',
          detail: sqlPrimaryBridgeReady
            ? '未发现当日 SN库存订单导出文件，但 OpenClaw SQL 当日记录已就绪，本轮按 SQL 主链继续同步；SN 导出文件作为补证据项后续补齐。'
            : missingZhidiantongSourceDetail('SN库存订单导出文件', [
              `zhidiantong-sn-stock-order-${getTodayDateString()}.xlsx/csv`,
              `SN库存订单-${getTodayDateString()}.xlsx/csv`,
              'serialNumberData.xlsx/csv',
            ]),
        })
        if (!sqlPrimaryBridgeReady) base.manualActionRequired = true
      }
      if (!usedUnifiedStockStream && manualFiles.salesFile) {
        const result = await importZhidiantongSalesExport(manualFiles.salesFile)
        totalImportedCount += result.importedCount
        totalMergedCount += result.mergedRecordCount
        if (result.warnings.length) base.warnings.push(...result.warnings)
        base.steps.push({
          step: 'import_zhidiantong_sales_export',
          status: 'completed',
          metrics: {
            importedCount: result.importedCount,
            mergedRecordCount: result.mergedRecordCount,
            skippedCount: result.skippedCount,
          },
          files: [result.sourceFile, result.files.artifactPath, result.files.webPath],
        })
      } else if (!usedUnifiedStockStream) {
        if (!sqlPrimaryBridgeReady) {
          base.warnings.push('未找到当日销售出库导出文件，等待人工导出后重跑。')
          base.manualActionRequired = true
        }
        base.steps.push({
          step: 'import_zhidiantong_sales_export',
          status: sqlPrimaryBridgeReady ? 'completed' : 'skipped',
          detail: sqlPrimaryBridgeReady
            ? '未发现当日销售导出文件，但 OpenClaw SQL 当日订单已到位，本轮按 SQL 主链继续同步；orderData/orderProductData 作为金额核验补证据项。'
            : missingZhidiantongSourceDetail('销售出库/线下门店订单导出文件', [
              `销售出库-${getTodayDateString()}.xlsx/csv`,
              `线下门店订单-${getTodayDateString()}.xlsx/csv`,
              'orderData*.xlsx/csv + orderProductData*.xlsx/csv',
            ]),
        })
      }
      const initialSalesOrderSnapshot = await buildZhidiantongSalesOrdersSnapshot().catch(() => null)
      if (initialSalesOrderSnapshot) {
        base.steps.push({
          step: 'sync_zhidiantong_sales_orders_snapshot',
          status: 'completed',
          detail: `已从智店通 orderData / orderProductData 生成销售单金额快照，供 SQL 销售价与前端出库金额参考映射使用。注意：文件存在不等于采集完成，仍必须用库存流水/SN库存订单销售单号反查覆盖率。${ZHIDIANTONG_ORDER_CAPTURE_REQUIRED_ACTIONS}`,
          metrics: {
            orderCount: initialSalesOrderSnapshot.snapshot.orderCount,
          },
          files: [
            initialSalesOrderSnapshot.snapshot.summaryFile,
            initialSalesOrderSnapshot.snapshot.productFile,
            initialSalesOrderSnapshot.files.artifactPath,
            initialSalesOrderSnapshot.files.webPath,
          ].filter(Boolean) as string[],
        })
      } else {
        base.warnings.push('未找到 orderData / orderProductData，当天销售单金额无法写入 SQL，仅保留出库流水。')
        base.steps.push({
          step: 'sync_zhidiantong_sales_orders_snapshot',
          status: 'skipped',
          detail: missingZhidiantongSourceDetail('orderData/orderProductData 成对销售订单金额文件', [
            'orderData*.xlsx/csv',
            'orderProductData*.xlsx/csv',
          ]),
        })
      }
      const snStockOrderBackfill = await backfillSalesMovementsFromSnStockOrders()
      if (snStockOrderBackfill.addedCount > 0 || snStockOrderBackfill.updatedCount > 0) {
        totalImportedCount += snStockOrderBackfill.addedCount
        base.steps.push({
          step: 'backfill_sales_movements_from_sn_stock_orders',
          status: 'completed',
          detail: '已把当天 SN库存订单导出中已采到但未进入库存流水的销售单，直接补写为前端出库流水。',
          metrics: {
            addedCount: snStockOrderBackfill.addedCount,
            updatedCount: snStockOrderBackfill.updatedCount,
          },
          files: [
            snStockOrderBackfill.files?.files.artifactPath,
            snStockOrderBackfill.files?.files.webPath,
          ].filter(Boolean) as string[],
        })
        base.warnings.push(snStockOrderBackfill.orderIds.length
          ? `已从 SN库存订单导出补同步销售出库流水：${snStockOrderBackfill.orderIds.join(', ')}`
          : `已从 SN库存订单导出更新销售出库流水字段：${snStockOrderBackfill.updatedCount} 条`)
      } else {
        base.steps.push({
          step: 'backfill_sales_movements_from_sn_stock_orders',
          status: 'completed',
          detail: 'SN库存订单导出中没有发现需要补写到前端出库流水的新增销售单或字段更新。',
        })
      }
      if (!usedUnifiedStockStream && manualFiles.purchaseFile) {
        const result = await importZhidiantongPurchaseWeb(manualFiles.purchaseFile)
        totalImportedCount += result.importedCount
        totalMergedCount += result.mergedRecordCount
        base.steps.push({
          step: 'import_zhidiantong_purchase_web',
          status: 'completed',
          metrics: {
            importedCount: result.importedCount,
            overrideCount: result.overrideCount,
            mergedRecordCount: result.mergedRecordCount,
            mergedOverrideCount: result.mergedOverrideCount,
          },
          files: [
            result.sourceFile,
            result.files.artifactPath,
            result.files.webPath,
            result.serialOverrideFiles.artifactPath,
            result.serialOverrideFiles.webPath,
          ],
        })
      } else if (!usedUnifiedStockStream) {
        if (!sqlPrimaryBridgeReady) {
          base.warnings.push('未找到当日商品入库导出 JSON，等待人工导出后重跑。')
          base.manualActionRequired = true
        }
        base.steps.push({
          step: 'import_zhidiantong_purchase_web',
          status: sqlPrimaryBridgeReady ? 'completed' : 'skipped',
          detail: sqlPrimaryBridgeReady
            ? '未发现当日商品入库导出 JSON，但 OpenClaw SQL 当日记录已到位，本轮按 SQL 主链继续同步；入库导出作为补证据项。'
            : missingZhidiantongSourceDetail('商品入库/采购入库网页采集 JSON', [
              `商品入库-${getTodayDateString()}.json`,
              `采购入库-${getTodayDateString()}.json`,
              `调拨入库-${getTodayDateString()}.json/xlsx/csv`,
              `zhidiantong-purchase-inbound-capture-${getTodayDateString()}.partial.json`,
            ]),
        })
      }
      if (!usedUnifiedStockStream && manualFiles.otherOutboundFile) {
        const result = await importZhidiantongOtherOutbound(manualFiles.otherOutboundFile)
        totalImportedCount += result.importedCount
        totalMergedCount += result.mergedRecordCount
        base.steps.push({
          step: 'import_zhidiantong_other_outbound',
          status: 'completed',
          metrics: {
            importedCount: result.importedCount,
            mergedRecordCount: result.mergedRecordCount,
          },
          files: [manualFiles.otherOutboundFile, result.files.artifactPath, result.files.webPath],
        })
      } else if (!usedUnifiedStockStream) {
        base.steps.push({
          step: 'import_zhidiantong_other_outbound',
          status: sqlPrimaryBridgeReady ? 'completed' : 'skipped',
          detail: sqlPrimaryBridgeReady
            ? '未发现当日其他/调拨出库导出文件，但 OpenClaw SQL 当日记录已到位，本轮按 SQL 主链继续同步；导出文件作为补证据项。'
            : missingZhidiantongSourceDetail('其他出库网页采集 JSON', [
              `其他出库-${getTodayDateString()}.json`,
              `其它出库-${getTodayDateString()}.json`,
              `调拨出库-${getTodayDateString()}.json/xlsx/csv`,
              `zhidiantong-other-outbound-capture-${getTodayDateString()}.partial.json`,
            ]),
        })
        if (!sqlPrimaryBridgeReady) base.manualActionRequired = true
      } else {
        base.steps.push({
          step: 'import_zhidiantong_split_fallback',
          status: 'skipped',
          detail: '已使用库存流水统一导入，本轮跳过销售/入库/其它出库拆分导入。',
        })
      }

      let detailBackfillFailed = false
      try {
        const result = await runPythonUtilityScript('apps/inventory-sync/src/storage/zdtSalesOrderSync.py')
        base.steps.push({
          step: 'sync_zdt_sales_order_detail_bridge',
          status: 'completed',
          detail: result.stdout
            ? `已从 PG fact_orders / fact_order_items 回写销售订单实付金额、订单行、SN 与出库金额。${result.stdout.split('\n').slice(-6).join(' ')}`
            : '已从 PG fact_orders / fact_order_items 回写销售订单实付金额、订单行、SN 与出库金额。',
          files: [result.scriptPath],
        })
      } catch (error) {
        detailBackfillFailed = true
        const message = error instanceof Error ? error.message : String(error)
        base.warnings.push(`销售订单金额/明细桥接失败：${message}`)
        base.steps.push({
          step: 'sync_zdt_sales_order_detail_bridge',
          status: 'failed',
          detail: message,
        })
      }

      try {
        const result = await runPythonUtilityScript('apps/inventory-sync/src/storage/zdtSalesDedupeAndFill.py')
        base.steps.push({
          step: 'fill_zdt_sales_purchase_detail_gaps',
          status: 'completed',
          detail: result.stdout
            ? `已执行销售去重、出库金额补全、采购入库供应商/进货价/采购SN/serial_item 成本补齐。${result.stdout.split('\n').slice(-8).join(' ')}`
            : '已执行销售去重、出库金额补全、采购入库供应商/进货价/采购SN/serial_item 成本补齐。',
          files: [result.scriptPath],
        })
      } catch (error) {
        detailBackfillFailed = true
        const message = error instanceof Error ? error.message : String(error)
        base.warnings.push(`销售/采购明细补链失败：${message}`)
        base.steps.push({
          step: 'fill_zdt_sales_purchase_detail_gaps',
          status: 'failed',
          detail: message,
        })
      }

      const purchaseInboundAudit = await auditPurchaseInboundCompleteness()
      base.steps.push({
        step: 'verify_purchase_inbound_detail_coverage',
        status: purchaseInboundAudit.status === 'failed'
          ? 'failed'
          : purchaseInboundAudit.blockCurrentTask
            ? 'failed'
            : 'completed',
        detail: purchaseInboundAudit.status === 'failed'
          ? `采购入库完整性审计失败：${purchaseInboundAudit.error ?? 'unknown error'}`
          : purchaseInboundAudit.blockCurrentTask
            ? `采购入库明细仍未收口：共 ${purchaseInboundAudit.purchaseInboundTotal} 条采购入库流水，缺进货价 ${purchaseInboundAudit.missingCostCount} 条，缺供应商 ${purchaseInboundAudit.missingSupplierCount} 条，缺 SN ${purchaseInboundAudit.missingSerialDisplayCount} 条，分/元单位异常 ${purchaseInboundAudit.scaledCostCount} 条，异常金额 ${purchaseInboundAudit.absurdAmountCount} 条；其中同日缺进货价 ${purchaseInboundAudit.sameDayMissingCostCount} 条、同日缺 SN ${purchaseInboundAudit.sameDayMissingSerialCount} 条、同日分/元异常 ${purchaseInboundAudit.sameDayScaledCostCount} 条、同日异常金额 ${purchaseInboundAudit.sameDayAbsurdAmountCount} 条、CGR/待商确认错误归类 ${purchaseInboundAudit.manualAdjustmentCgrCount} 条。`
            : `采购入库明细闭环通过：${purchaseInboundAudit.purchaseInboundTotal} 条采购入库流水已具备进货价、供应商、SN 和正常金额展示字段。`,
        metrics: {
          purchaseInboundTotal: purchaseInboundAudit.purchaseInboundTotal,
          missingPurchaseInboundCostCount: purchaseInboundAudit.missingCostCount,
          missingPurchaseInboundSupplierCount: purchaseInboundAudit.missingSupplierCount,
          missingPurchaseInboundSerialCount: purchaseInboundAudit.missingSerialDisplayCount,
          scaledPurchaseInboundCostCount: purchaseInboundAudit.scaledCostCount,
          absurdPurchaseInboundAmountCount: purchaseInboundAudit.absurdAmountCount,
          sameDayMissingPurchaseInboundCostCount: purchaseInboundAudit.sameDayMissingCostCount,
          sameDayMissingPurchaseInboundSerialCount: purchaseInboundAudit.sameDayMissingSerialCount,
          sameDayScaledPurchaseInboundCostCount: purchaseInboundAudit.sameDayScaledCostCount,
          sameDayAbsurdPurchaseInboundAmountCount: purchaseInboundAudit.sameDayAbsurdAmountCount,
          purchaseInboundMisclassifiedCgrCount: purchaseInboundAudit.manualAdjustmentCgrCount,
        },
        files: [
          purchaseInboundGapAuditPath(),
          purchaseInboundGapAuditWebPath(),
        ],
      })
      if (purchaseInboundAudit.blockCurrentTask) {
        detailBackfillFailed = true
        const samples = purchaseInboundAudit.sampleMissingCostRows
          .concat(purchaseInboundAudit.sampleMissingSerialRows)
          .concat(purchaseInboundAudit.sampleScaledCostRows)
          .concat(purchaseInboundAudit.sampleAbsurdAmountRows)
          .slice(0, 6)
          .map((item) => String(item.inbound_document_no ?? item.source_ref ?? item.id ?? '').trim())
          .filter(Boolean)
        base.warnings.push(
          `采购入库明细缺口未清空：缺进货价 ${purchaseInboundAudit.missingCostCount} 条，缺SN ${purchaseInboundAudit.missingSerialDisplayCount} 条，分/元单位异常 ${purchaseInboundAudit.scaledCostCount} 条，异常金额 ${purchaseInboundAudit.absurdAmountCount} 条；同日缺进货价 ${purchaseInboundAudit.sameDayMissingCostCount} 条、同日缺SN ${purchaseInboundAudit.sameDayMissingSerialCount} 条、同日分/元异常 ${purchaseInboundAudit.sameDayScaledCostCount} 条、同日异常金额 ${purchaseInboundAudit.sameDayAbsurdAmountCount} 条、CGR错误归类 ${purchaseInboundAudit.manualAdjustmentCgrCount} 条。${samples.length ? `样例：${samples.join(', ')}` : ''}`,
        )
      }

      const exportTruthPair = await inspectLatestInventoryTruthExports()
      if (exportTruthPair.ready) {
        base.steps.push({
          step: 'verify_today_inventory_truth_exports',
          status: 'completed',
          detail: '已确认当天完整库存数量表与库存SN表成对导出，可作为前端库存真值同步底稿。',
          metrics: {
            quantityIsToday: exportTruthPair.quantityIsToday,
            snIsToday: exportTruthPair.snIsToday,
          },
          files: [exportTruthPair.stockQuantityFile!, exportTruthPair.stockSnFile!],
        })
      } else {
        base.manualActionRequired = true
        base.steps.push({
          step: 'verify_today_inventory_truth_exports',
          status: 'failed',
          detail: `未确认当天成对总表。库存同步必须先导出 商品库存统计_${exportTruthPair.today}.xlsx 与 商品库存SN统计_${exportTruthPair.today}.xlsx，再统一重建前端库存与SN。`,
          metrics: {
            quantityIsToday: exportTruthPair.quantityIsToday,
            snIsToday: exportTruthPair.snIsToday,
          },
          files: [exportTruthPair.stockQuantityFile, exportTruthPair.stockSnFile].filter(Boolean) as string[],
        })
      }

      const hasMovementPrimarySource = sqlPrimaryBridgeReady || usedUnifiedStockStream || totalImportedCount > 0 || totalMergedCount > 0
      if (
        hasMovementPrimarySource
        && exportTruthPair.ready
        && !agentScanGateMissing
      ) {
        base.executionOutcome = 'real_completed'
      } else if (agentScanGateMissing) {
        base.executionOutcome = 'executed_not_closed'
        base.blockingReason = agentScanGateBlockingReason
      } else if (hasMovementPrimarySource) {
        base.executionOutcome = 'executed_not_closed'
        base.blockingReason = `已导入当日入库/出库流水，但未确认当天成对库存总表（商品库存统计 + 商品库存SN统计），不能写成库存同步已收口。`
      } else {
        base.executionOutcome = 'blocked_missing_input'
        base.blockingReason = '未发现可导入的智店通库存流水/销售/入库/其他出库原始文件。'
      }

      const rebuilt = await rebuildDerivedSnapshots()
      const zdtOpenclawBridge = zdtOpenclawBridgePrecheck
      const retailCoreFrontendBridge = await saveRetailCoreFrontendBridgeSnapshots(rebuilt)
      const salesOrderSnapshot = await buildZhidiantongSalesOrdersSnapshot().catch(() => initialSalesOrderSnapshot)
      const serialConsistency = summarizeInventorySerialConsistency(rebuilt.adjustedInventory.snapshot)
      const inventoryTerminalSync = await syncInventoryTerminalState()
      const inventoryTerminalSummary = inventoryTerminalSync.audit.summary ?? {}
      const inventoryTerminalMismatchCount =
        Number(inventoryTerminalSummary.coreStockSnMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.projectionVsStandardMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.channelStockSnMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.distMismatchCount ?? 0)
        + Number(inventoryTerminalSummary.liveMismatchCount ?? 0)
      const outboundMarketingSync = summarizeOutboundMarketingSync(
        rebuilt.movementSync.snapshot.records,
        rebuilt.marketingBoost.snapshot,
        rebuilt.marketingBoost.educationAgentScan.snapshot,
      )
      const salesOrderCoverage = summarizeSalesOrderSnapshotCoverage(
        rebuilt.movementSync.snapshot.records,
        salesOrderSnapshot,
        rebuilt.inventoryMaster.snapshot,
      )
      const frontendMovementCoverage = summarizeFrontendMovementMirrorCoverage(
        rebuilt.movementSync.snapshot.records,
        retailCoreFrontendBridge,
      )
      const enforceFreshnessGate = isShanghaiBusinessHours()
      const freshnessGatePassed = zdtOpenclawBridge.snapshot.isFresh || !enforceFreshnessGate
      const missingMovementInput = !sqlPrimaryBridgeReady && !usedUnifiedStockStream && totalImportedCount <= 0 && totalMergedCount <= 0
      base.newRecordCount += totalImportedCount
      base.updatedRecordCount += totalMergedCount
      base.frontendRefreshed = true
      base.steps.push({
        step: 'rebuild_derived_snapshots',
        status: 'completed',
        files: rebuildSnapshotFileList(rebuilt),
      })
      base.steps.push({
        step: 'sync_zdt_openclaw_sql_bridge',
        status: zdtOpenclawBridge.snapshot.connected && freshnessGatePassed ? 'completed' : 'failed',
        detail: zdtOpenclawBridge.snapshot.connected
          ? freshnessGatePassed
            ? 'zdt_sync SQL桥接已同步且采集新鲜度通过，前端可见审计快照已刷新。'
            : `zdt_sync SQL桥接已连接，但营业时段内最新采集超过 ${zdtOpenclawBridge.snapshot.staleThresholdMinutes} 分钟，暂不允许收口。`
          : `zdt_sync SQL桥接失败：${zdtOpenclawBridge.snapshot.error ?? 'unknown error'}`,
        metrics: {
          connected: zdtOpenclawBridge.snapshot.connected,
          isFresh: zdtOpenclawBridge.snapshot.isFresh,
          enforceFreshnessGate,
          freshnessGatePassed,
          totalRecords: zdtOpenclawBridge.snapshot.totals.totalRecords,
          todayRecords: zdtOpenclawBridge.snapshot.totals.todayRecords,
        },
        files: [zdtOpenclawBridge.artifactPath, zdtOpenclawBridge.webPath],
      })
      base.steps.push({
        step: 'sync_retail_core_frontend_bridge',
        status: 'completed',
        detail: '已在 zhidiantong-sync-cycle 代码内直接生成前端 retail-core 桥接快照，销售单流水、出入库流水、SN 状态不再依赖用户提醒后手动刷新。',
        metrics: retailCoreFrontendBridge.metrics,
        files: retailCoreFrontendBridge.files,
      })
      base.steps.push({
        step: 'sync_inventory_terminal_state',
        status: inventoryTerminalSync.blocking ? 'failed' : 'completed',
        detail: inventoryTerminalSync.blocking
          ? '库存终端同步脚本已执行，但 SQLite 主库、标准库存快照或终端投影仍存在库存/SN 不一致。'
          : '库存终端同步脚本已执行：SQLite 主库、标准库存快照、零售英雄卡、广告机、收银端库存/SN 已对齐。',
        metrics: {
          writtenCount: inventoryTerminalSync.writtenCount,
          coreStockSnMismatchCount: Number(inventoryTerminalSummary.coreStockSnMismatchCount ?? 0),
          projectionVsStandardMismatchCount: Number(inventoryTerminalSummary.projectionVsStandardMismatchCount ?? 0),
          channelStockSnMismatchCount: Number(inventoryTerminalSummary.channelStockSnMismatchCount ?? 0),
          distMismatchCount: Number(inventoryTerminalSummary.distMismatchCount ?? 0),
          liveMismatchCount: Number(inventoryTerminalSummary.liveMismatchCount ?? 0),
        },
        files: [
          inventoryTerminalSync.scriptPath,
          rebuilt.adjustedInventory.artifactPath,
          rebuilt.inventoryMaster.artifactPath,
        ],
      })
      base.steps.push({
        step: 'verify_inventory_serial_consistency',
        status: serialConsistency.mismatchCount > 0 || inventoryTerminalMismatchCount > 0 ? 'failed' : 'completed',
        detail: serialConsistency.mismatchCount > 0 || inventoryTerminalMismatchCount > 0
          ? `库存/SN 对账未通过：标准库存快照发现 ${serialConsistency.mismatchCount} 个 SKU 不一致，终端同步脚本额外发现 core=${Number(inventoryTerminalSummary.coreStockSnMismatchCount ?? 0)} / projection=${Number(inventoryTerminalSummary.projectionVsStandardMismatchCount ?? 0)} / channel=${Number(inventoryTerminalSummary.channelStockSnMismatchCount ?? 0)} / dist=${Number(inventoryTerminalSummary.distMismatchCount ?? 0)} / live=${Number(inventoryTerminalSummary.liveMismatchCount ?? 0)}。`
          : '已确认标准库存快照与所有终端投影的库存数量、可售数量和 SN 数量一致。',
        metrics: {
          mismatchCount: serialConsistency.mismatchCount,
          coreStockSnMismatchCount: Number(inventoryTerminalSummary.coreStockSnMismatchCount ?? 0),
          projectionVsStandardMismatchCount: Number(inventoryTerminalSummary.projectionVsStandardMismatchCount ?? 0),
          channelStockSnMismatchCount: Number(inventoryTerminalSummary.channelStockSnMismatchCount ?? 0),
          distMismatchCount: Number(inventoryTerminalSummary.distMismatchCount ?? 0),
          liveMismatchCount: Number(inventoryTerminalSummary.liveMismatchCount ?? 0),
        },
        files: [
          inventoryTerminalSync.scriptPath,
          rebuilt.adjustedInventory.artifactPath,
          rebuilt.inventoryMaster.artifactPath,
        ],
      })
      base.steps.push({
        step: 'verify_outbound_marketing_education_sync',
        status: outboundMarketingSync.pendingAgentRowsWithSoldSnCount > 0 ? 'failed' : 'completed',
        detail: outboundMarketingSync.pendingAgentRowsWithSoldSnCount > 0
          ? `发现 ${outboundMarketingSync.pendingAgentRowsWithSoldSnCount} 条教育补代扫记录已有销售出库 SN，但仍停留在待出库同步。`
          : '已同步销售出库后的营销 PO、教育补贴和教育补代扫对账快照。',
        metrics: {
          salesOutboundCount: outboundMarketingSync.salesOutboundCount,
          salesHeroCardCount: outboundMarketingSync.salesHeroCardCount,
          salesHeroCardWithAmountCount: outboundMarketingSync.salesHeroCardWithAmountCount,
          educationAgentScanTotalCount: outboundMarketingSync.educationAgentScanTotalCount,
          educationAgentScanMatchedOutboundCount: outboundMarketingSync.educationAgentScanMatchedOutboundCount,
          educationAgentScanPendingOutboundCount: outboundMarketingSync.educationAgentScanPendingOutboundCount,
          pendingAgentRowsWithSoldSnCount: outboundMarketingSync.pendingAgentRowsWithSoldSnCount,
        },
        files: [
          rebuilt.marketingBoost.webPath,
          rebuilt.marketingBoost.educationAgentScan.webPath,
        ],
      })
      base.steps.push({
        step: 'verify_sales_orders_snapshot_coverage',
        status: missingMovementInput ? 'skipped' : salesOrderCoverage.missingOrderCount > 0 ? 'failed' : 'completed',
        detail: missingMovementInput
          ? '未发现可导入的当天库存流水/SN库存订单/销售订单原始明细，本轮不能把 0 条源单判定为订单闭环已通过。'
          : salesOrderCoverage.missingOrderCount > 0
          ? `订单闭环未通过：当天库存流水已出现 ${salesOrderCoverage.sameDaySalesOutboundCount} 笔销售出库单，SN订单导出另有 ${salesOrderCoverage.sameDaySnStockOrderOnlyCount} 笔未进入库存流水，orderData/orderProductData 销售金额快照覆盖 ${salesOrderCoverage.snapshotOrderCount} 笔，仍缺 ${salesOrderCoverage.missingOrderCount} 笔。仅有文件存在不算同步完成。`
          : '订单闭环已通过：当天库存流水、SN订单导出和销售订单金额快照互相覆盖。',
        metrics: {
          sameDaySalesOutboundCount: salesOrderCoverage.sameDaySalesOutboundCount,
          sameDaySnStockOrderOnlyCount: salesOrderCoverage.sameDaySnStockOrderOnlyCount,
          salesOrderSnapshotCount: salesOrderCoverage.snapshotOrderCount,
          missingSalesOrderCount: salesOrderCoverage.missingOrderCount,
          missingAmountSnapshotCount: salesOrderCoverage.missingSalesOrderSnapshotIds.length,
          snStockOrderOnlyCount: salesOrderCoverage.snStockOrderOnlyIds.length,
        },
        files: [
          path.resolve(config.lenovoRetail.artifactDir, 'latest-zhidiantong-sales-orders.json'),
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-zhidiantong-sales-orders.json'),
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-retail-core-sales-orders.json'),
        ],
      })
      base.steps.push({
        step: 'verify_frontend_movement_mirror_coverage',
        status: missingMovementInput ? 'skipped' : frontendMovementCoverage.missingOrderCount > 0 ? 'failed' : 'completed',
        detail: missingMovementInput
          ? '未发现可导入的当天出入库源明细，本轮只刷新了历史快照，不能声明当天前端出入库流水已同步。'
          : frontendMovementCoverage.missingOrderCount > 0
          ? `前端出入库流水镜像未覆盖当天全部销售出库：源库存流水 ${frontendMovementCoverage.sourceSalesOrderCount} 笔，前端 retail-core 镜像覆盖 ${frontendMovementCoverage.mirroredSalesOrderCount} 笔，缺 ${frontendMovementCoverage.missingOrderCount} 笔。`
          : '已确认当天销售出库单号全部进入前端 retail-core 出入库流水镜像。',
        metrics: {
          sourceSalesOrderCount: frontendMovementCoverage.sourceSalesOrderCount,
          mirroredSalesOrderCount: frontendMovementCoverage.mirroredSalesOrderCount,
          missingFrontendMovementCount: frontendMovementCoverage.missingOrderCount,
        },
        files: [
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-inventory-movements.json'),
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-retail-core-inventory-movements.json'),
        ],
      })
      base.steps.push({
        step: 'verify_frontend_static_sync_gate',
        status: missingMovementInput
          || !zdtOpenclawBridge.snapshot.connected
          || !freshnessGatePassed
          || serialConsistency.mismatchCount > 0
          || inventoryTerminalMismatchCount > 0
          || outboundMarketingSync.pendingAgentRowsWithSoldSnCount > 0
          || salesOrderCoverage.missingOrderCount > 0
          || frontendMovementCoverage.missingOrderCount > 0
          ? 'failed'
          : 'completed',
        detail: missingMovementInput
          || !zdtOpenclawBridge.snapshot.connected
          || !freshnessGatePassed
          || serialConsistency.mismatchCount > 0
          || inventoryTerminalMismatchCount > 0
          || outboundMarketingSync.pendingAgentRowsWithSoldSnCount > 0
          || salesOrderCoverage.missingOrderCount > 0
          || frontendMovementCoverage.missingOrderCount > 0
          ? '前端静态同步门禁未通过：库存/SN、教育补代扫对账、销售订单金额快照或前端出入库流水镜像仍存在缺口。'
          : '前端静态同步门禁通过：本轮已由 zhidiantong-sync-cycle 代码直接刷新销售单流水、出入库流水、教育补代扫服务费、库存数量、可售数量和 SN 状态。',
        files: [
          zdtOpenclawBridge.webPath,
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-retail-core-sales-orders.json'),
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-retail-core-inventory-movements.json'),
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-education-subsidy-agent-scan-summary.json'),
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-standard-inventory-snapshot.json'),
          path.resolve(config.appDir, '../web-cockpit/public/data/latest-retail-core-serial-items.json'),
        ],
      })
      const visibleEvidence = await findLatestTaskVisibleEvidence('zhidiantong-sync-cycle')
      if (visibleEvidence?.hasPageContentEvidence) {
        base.steps.push({
          step: 'verify_visible_page_content_gate',
          status: 'completed',
          detail: '已发现当前任务的可见页面复核证据文件，包含真实页面标题/群名/价格或状态区截图与摘要。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
      if (visibleEvidence?.hasFrontendEvidence) {
        base.steps.push({
          step: 'verify_frontend_visible_sync_gate',
          status: 'completed',
          detail: '已发现当前任务的前端可见复核证据文件，确认 5174 页面已显示本轮最新同步结果。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
      if (serialConsistency.mismatchCount > 0 || inventoryTerminalMismatchCount > 0) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `库存数量与 SN 数量未完全对齐：标准库存快照 ${serialConsistency.mismatchCount} 个 SKU 不一致，终端同步脚本额外发现 ${inventoryTerminalMismatchCount} 处主库/投影不一致，需重新导出同轮商品库存统计和商品库存SN统计并重跑 scripts/sync_inventory_terminal_state.py。`
        base.warnings.push(base.blockingReason)
      }
      if (outboundMarketingSync.pendingAgentRowsWithSoldSnCount > 0) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `销售出库已同步，但教育补代扫仍有 ${outboundMarketingSync.pendingAgentRowsWithSoldSnCount} 条未进入对账。`
        base.warnings.push(`${base.blockingReason} 样例：${outboundMarketingSync.pendingAgentRowsWithSoldSnSample.join(', ')}`)
      }
      if (salesOrderCoverage.missingOrderCount > 0) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `订单闭环缺 ${salesOrderCoverage.missingOrderCount} 笔：库存流水销售出库 ${salesOrderCoverage.sameDaySalesOutboundCount} 笔，SN订单导出未入流水 ${salesOrderCoverage.sameDaySnStockOrderOnlyCount} 笔，销售订单金额快照覆盖 ${salesOrderCoverage.snapshotOrderCount} 笔；必须补齐库存流水和成对的 orderData/orderProductData 后再收口。`
        base.warnings.push(`${base.blockingReason} 缺口单号：${salesOrderCoverage.missingOrderIds.slice(0, 10).join(', ')}`)
      }
      if (frontendMovementCoverage.missingOrderCount > 0) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = `前端出入库流水镜像缺 ${frontendMovementCoverage.missingOrderCount} 笔当天销售出库，采集后不得写成已同步前端。`
        base.warnings.push(`${base.blockingReason} 缺口单号：${frontendMovementCoverage.missingOrderIds.slice(0, 10).join(', ')}`)
      }
      if (!zdtOpenclawBridge.snapshot.connected || !freshnessGatePassed) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        base.blockingReason = !zdtOpenclawBridge.snapshot.connected
          ? `zdt_sync SQL 桥接失败：${zdtOpenclawBridge.snapshot.error ?? 'unknown error'}`
          : `zdt_sync SQL 桥接数据在营业时段超过 ${zdtOpenclawBridge.snapshot.staleThresholdMinutes} 分钟未刷新。`
        base.warnings.push(base.blockingReason)
      }
      if (detailBackfillFailed) {
        base.executionOutcome = 'executed_not_closed'
        base.manualActionRequired = true
        if (purchaseInboundAudit.sameDayMissingCostCount > 0) {
          base.blockingReason = `采购入库进货成本价仍缺 ${purchaseInboundAudit.sameDayMissingCostCount} 条同日记录，当前不能写成出入库明细已收口。`
        } else if (purchaseInboundAudit.sameDayScaledCostCount > 0) {
          base.blockingReason = `采购入库仍有 ${purchaseInboundAudit.sameDayScaledCostCount} 条同日记录以“分”写入进货价，当前不能写成出入库明细已收口。`
        } else if (purchaseInboundAudit.sameDayAbsurdAmountCount > 0) {
          base.blockingReason = `采购入库仍有 ${purchaseInboundAudit.sameDayAbsurdAmountCount} 条同日记录金额异常，当前不能写成出入库明细已收口。`
        } else if (purchaseInboundAudit.sameDayMissingSerialCount > 0) {
          base.blockingReason = `采购入库 SN 仍缺 ${purchaseInboundAudit.sameDayMissingSerialCount} 条同日记录，当前不能写成出入库明细已收口。`
        } else if (purchaseInboundAudit.missingSupplierCount > 0) {
          base.blockingReason = `采购入库供应商仍缺 ${purchaseInboundAudit.missingSupplierCount} 条记录，当前不能写成出入库明细已收口。`
        } else {
          base.blockingReason = '销售实付金额或采购入库进货价/SN/供应商/金额补链未完成，当前不能写成出入库明细已收口。'
        }
        base.warnings.push(base.blockingReason)
      }
    }
    }
    if (taskNameKey === 'sn-warranty-backfill') {
      const queue = await saveWarrantyCheckQueue()
      const evidence = await getTodayManualWarrantyEvidence()
      const pageRisk = await getTodayManualWarrantyPageRisk(evidence.manualDir)
      const manualEvidenceCount = evidence.manualFiles.length
      const legacyEvidenceCount = evidence.legacyFiles.length
      base.executionOutcome = queue.snapshot.total > 0 ? 'executed_not_closed' : 'real_completed'
      base.manualActionRequired = queue.snapshot.total > 0
      if (pageRisk.marker && queue.snapshot.total > 0) {
        base.executionOutcome = 'blocked_page_risk'
        base.manualActionRequired = true
        base.blockingReason = pageRisk.marker.blockingReason
          ?? `联想保修页 ${pageRisk.marker.page ?? '可见查询页'} 出现页面异常，无法完成当天手工查询；保修队列剩余 ${queue.snapshot.total} 条。`
      }
      if (queue.snapshot.total > 0) {
        if (!base.blockingReason) {
          base.blockingReason = manualEvidenceCount > 0
            ? `已发现 ${manualEvidenceCount} 个 ${evidence.today} 当天手工保修证据文件；当前仍需继续在 Chrome 可见会话中手工查询剩余 SN，并在每批后运行本地导入与队列重建。保修队列剩余 ${queue.snapshot.total} 条。`
            : legacyEvidenceCount > 0
              ? `仅发现 ${legacyEvidenceCount} 个旧保修产物位于 ${evidence.legacyDir}，不能当作当天手工证据；保修队列剩余 ${queue.snapshot.total} 条。`
              : `保修队列剩余 ${queue.snapshot.total} 条，且未发现 ${evidence.today} 当天手工保修证据；禁止直接运行后台网页采集。`
        }
        base.warnings.push('sn-warranty-backfill 当前只允许构建队列和检查手工证据，不再自动打开联想官网。')
      }
      base.steps.push({
        step: 'build_warranty_queue',
        status: 'completed',
        metrics: {
          total: queue.snapshot.total,
        },
        files: [queue.artifactPath, queue.webPath],
      })
      base.steps.push({
        step: 'check_manual_warranty_evidence',
        status: pageRisk.marker ? 'failed' : (manualEvidenceCount > 0 ? 'completed' : 'failed'),
        detail: pageRisk.marker
          ? (pageRisk.marker.detail ?? pageRisk.marker.blockingReason ?? '已记录当天 Chrome 可见页面查询风险，当前轮次不得继续固化。')
          : manualEvidenceCount > 0
            ? '已发现当天手工保修证据文件；当前任务不会再后台打开官网，后续应继续手工查询剩余 SN，并在每批后执行本地导入与队列重建。'
            : legacyEvidenceCount > 0
              ? '仅发现旧保修产物目录，未发现当天手工保修证据；这些旧文件不能冒充本轮人工查询结果。'
              : '未发现当天手工保修证据目录内容；本轮只允许维持 executed_not_closed，等待 Chrome 可见页面手工查询后再固化。',
        metrics: {
          queueCount: queue.snapshot.total,
          todayManualEvidenceFileCount: manualEvidenceCount,
          legacyEvidenceFileCount: legacyEvidenceCount,
        },
        files: pageRisk.marker ? [evidence.manualDir, pageRisk.markerPath, evidence.legacyDir] : [evidence.manualDir, evidence.legacyDir],
      })
    }
    if (taskNameKey === 'daily-audit-and-snapshot-rebuild') {
      base.executionOutcome = 'real_completed'
      const rebuilt = await rebuildDerivedSnapshots()
      base.frontendRefreshed = true
      base.updatedRecordCount += rebuilt.retailZone.snapshot.decisions.total
      base.steps.push({
        step: 'rebuild_derived_snapshots',
        status: 'completed',
        metrics: {
          standardInventorySkuCount: rebuilt.standardInventory.snapshot.skus.length,
          standardInventoryCurrentStock: rebuilt.standardInventory.snapshot.totals.currentStock,
          standardInventorySerialCount: rebuilt.standardInventory.snapshot.totals.serialCount,
          standardInventoryUnmatchedSerialCount: rebuilt.standardInventory.snapshot.totals.unmatchedSerialCount,
          adjustedInventorySkuCount: rebuilt.adjustedInventory.snapshot.skus.length,
          inventoryMasterRowCount: rebuilt.inventoryMaster.snapshot.rows?.length ?? 0,
          inventoryPendingExceptionCount: rebuilt.inventoryMaster.snapshot.exceptions?.length ?? 0,
          inventoryPendingInboundGapCount: Math.max(
            (rebuilt.inventoryMaster.snapshot.rows?.length ?? 0) - (rebuilt.inventoryMaster.snapshot.totals?.rowWithInboundDateCount ?? 0),
            0,
          ),
          movementRecordCount: rebuilt.movementSync.snapshot.records.length,
          serialOverrideCount: Object.keys(rebuilt.serialSync.snapshot.overrides).length,
          retailZoneItemCount: rebuilt.retailZone.snapshot.decisions.total,
          missingPriceCount: rebuilt.retailAudit.snapshot.totals.missingPriceCount,
          missingLinkCount: rebuilt.plan.snapshot.totals.missingRetailLockCount,
          warrantyQueueCount: rebuilt.warrantyQueue.snapshot.total,
        },
        files: [
          ...rebuildSnapshotFileList(rebuilt),
          rebuilt.locks.artifactPath,
        ],
      })
    }
    if (taskNameKey === 'daily-sn-sales-compliance-refresh') {
      const sqlRefresh = await refreshSqlBackedStaticSnapshots()
      const compliance = await readArtifactJson<SnSalesComplianceSnapshot>('latest-sn-sales-compliance-snapshot.json')
      const manualReviewCount = Number(compliance.summary?.manualReviewCount ?? 0)
      base.executionOutcome = 'real_completed'
      base.frontendRefreshed = true
      base.updatedRecordCount += Number(compliance.summary?.totalCount ?? 0)
      if (manualReviewCount > 0) {
        base.manualActionRequired = true
        base.warnings.push(`合规校验预警已刷新，但仍有 ${manualReviewCount} 条记录需要 Codex 手动补外部页面资格证据。`)
      }
      if (String(compliance.automation?.realTimeCollectionMode || '') === 'codex_manual_task') {
        base.warnings.push('外部有效销量 / 厂家资格页面当前不能走 CLI 实时采集；自动化仅刷新 SQL 已落库链路。')
      }
      base.steps.push({
        step: 'refresh_sn_sales_compliance_snapshot',
        status: 'completed',
        detail: compliance.automation?.realTimeCollectionReason || '已按 SQL 主链刷新 SN 有效销量合规快照。',
        metrics: {
          writtenSnapshotCount: sqlRefresh.writtenCount,
          complianceRowCount: Number(compliance.summary?.totalCount ?? 0),
          compliantCount: Number(compliance.summary?.compliantCount ?? 0),
          blockedCount: Number(compliance.summary?.blockedCount ?? 0),
          warningCount: Number(compliance.summary?.warningCount ?? 0),
          manualReviewCount,
          claimableAmount: Number(compliance.summary?.claimableAmount ?? 0),
        },
        files: [
          artifactPath('latest-sn-sales-compliance-snapshot.json'),
          webDataPath('latest-sn-sales-compliance-snapshot.json'),
        ],
      })
    }
    if (taskNameKey === 'daily-stale-inventory-check') {
      const staleReport = await saveStaleInventoryReport()
      base.executionOutcome = 'real_completed'
      base.frontendRefreshed = true
      base.updatedRecordCount += staleReport.report.totals.staleSerialCount
      base.steps.push({
        step: 'build_stale_inventory_report',
        status: 'completed',
        metrics: {
          staleSerialCount: staleReport.report.totals.staleSerialCount,
          staleSkuCount: staleReport.report.totals.staleSkuCount,
          expiringWarrantySerialCount: staleReport.report.totals.expiringWarrantySerialCount,
          expiredWarrantySerialCount: staleReport.report.totals.expiredWarrantySerialCount,
        },
        files: [staleReport.artifactPath, staleReport.webPath],
      })
      const visibleEvidence = await findLatestTaskVisibleEvidence('daily-stale-inventory-check')
      if (visibleEvidence?.hasFrontendEvidence) {
        base.steps.push({
          step: 'verify_frontend_visible_sync_gate',
          status: 'completed',
          detail: '已发现当前任务的前端可见复核证据文件，确认 5174 页面已显示本轮最新陈旧库存结果。',
          files: [visibleEvidence.summaryPath, ...visibleEvidence.screenshotPaths],
        })
      }
    }
    if (taskNameKey === 'gaokao-daily-learning-refresh') {
      const dailyLearning = await buildGaokaoDailyLearningSnapshot()
      base.executionOutcome = 'real_completed'
      base.frontendRefreshed = true
      base.updatedRecordCount += dailyLearning.snapshot.summary.trackCount + dailyLearning.snapshot.summary.learningNoteCount
      base.steps.push({
        step: 'build_gaokao_daily_learning_snapshot',
        status: 'completed',
        detail: '已按当前现货、近期销售和厂家重点路线生成电脑知识分享与库存推荐话术的每日学习快照。',
        metrics: {
          trackCount: dailyLearning.snapshot.summary.trackCount,
          learningNoteCount: dailyLearning.snapshot.summary.learningNoteCount,
          featuredRouteCount: dailyLearning.snapshot.summary.featuredRouteCount,
        },
        files: [dailyLearning.artifactPath, dailyLearning.webPath],
      })
    }
    if (taskNameKey === 'gaokao-ai-knowledge-refresh') {
      const knowledgeBase = await buildGaokaoAiKnowledgeBase()
      base.executionOutcome = 'real_completed'
      base.frontendRefreshed = true
      base.updatedRecordCount += knowledgeBase.snapshot.summary.totalItemCount
      base.steps.push({
        step: 'build_gaokao_ai_knowledge_base',
        status: 'completed',
        detail: '已按高考活动知识种子、Win11 电脑使用技巧、库存推荐话术日更快照和当前门店活动快照重建客户安全知识库，同时输出后台完整知识库。',
        metrics: {
          seedItemCount: knowledgeBase.snapshot.summary.seedItemCount,
          inventoryItemCount: knowledgeBase.snapshot.summary.inventoryItemCount,
          adminItemCount: knowledgeBase.snapshot.summary.adminItemCount,
          totalItemCount: knowledgeBase.snapshot.summary.totalItemCount,
        },
        files: [knowledgeBase.artifactPath, knowledgeBase.adminArtifactPath, knowledgeBase.webPath],
      })
    }
    if (taskNameKey === 'gaokao-major-guide-refresh') {
      const guides = await buildGaokaoKnowledgeGuides()
      base.executionOutcome = 'real_completed'
      base.frontendRefreshed = true
      base.updatedRecordCount += guides.snapshot.summary.guideCount
      base.steps.push({
        step: 'build_gaokao_major_guides',
        status: 'completed',
        detail: '已按专业方向、宿舍场景、Win11 电脑使用技巧、库存推荐话术日更快照和当前活动方向重建电脑选购知识分享内容包。',
        metrics: {
          guideCount: guides.snapshot.summary.guideCount,
          featuredProductCount: guides.snapshot.summary.featuredProductCount,
        },
        files: [guides.artifactPath, guides.webPath],
      })
    }
    if (taskNameKey === 'daily-development-plan-update') {
      const result = await appendDevelopmentPlanUpdate()
      base.executionOutcome = 'real_completed'
      base.updatedRecordCount += 1
      base.steps.push({
        step: 'append_development_plan_update',
        status: 'completed',
        detail: `已按 latest-scheduled-task-reports 追加每日开发计划摘要：${result.updatedAt}`,
        metrics: {
          updatedRecordCount: 1,
        },
        files: [result.planPath],
      })
    }

    const currentMetrics = await buildCurrentMetrics()
    const semiAutoPlan = await buildSemiAutoExecutionPlan(taskName)
    if (taskName === 'daily-jd-lenovo-price-sync' && semiAutoPlan.plan.summary.retailPriceVerificationCount > 0) {
      base.warnings.push(`仍有 ${semiAutoPlan.plan.summary.retailPriceVerificationCount} 条已锁定零售链接待通过 Chrome 现有稳定会话做手工复核。`)
      base.executionOutcome = 'executed_not_closed'
      base.manualActionRequired = true
      base.blockingReason = `仍有 ${semiAutoPlan.plan.summary.retailPriceVerificationCount} 条已锁定链接待真实手工复核`
    }
    if (taskName === 'daily-jd-lenovo-price-sync' && semiAutoPlan.plan.summary.retailLinkBackfillCount > 0) {
      base.executionOutcome = 'executed_not_closed'
      base.manualActionRequired = true
      base.blockingReason = `仍有 ${semiAutoPlan.plan.summary.retailLinkBackfillCount} 条缺失链接待补链`
    }
    const task1ClosureState = taskName === 'daily-jd-lenovo-price-sync'
      ? await inspectTask1ClosureState()
      : undefined
    const staleInventoryClosureState = taskName === 'daily-stale-inventory-check'
      ? await inspectStaleInventoryClosureState()
      : undefined
    if (taskName === 'daily-jd-lenovo-price-sync' && task1ClosureState && !task1ClosureState.closureReady) {
      base.executionOutcome = 'executed_not_closed'
      base.manualActionRequired = true
      const reasons = [
        task1ClosureState.newStockImmediateClosureCount > 0 ? `${task1ClosureState.newStockImmediateClosureCount} 个新入库SKU缺详情页或零售价` : undefined,
        task1ClosureState.missingPriceCount > 0 ? `${task1ClosureState.missingPriceCount} 条缺价` : undefined,
        task1ClosureState.missingLinkCount > 0 ? `${task1ClosureState.missingLinkCount} 条缺链` : undefined,
        task1ClosureState.frontendBlankPriceCount > 0 ? `${task1ClosureState.frontendBlankPriceCount} 条前端空白` : undefined,
      ].filter(Boolean)
      base.blockingReason = reasons.length
        ? `任务1未收口：${reasons.join('，')}`
        : '任务1未收口：仍未满足电脑类轮抽与 48 小时全量更新时间闭环'
      base.warnings.push('任务1硬规则：电脑类轮抽清单、48 小时全量更新时间、固定链接核价任一未收口，都不得报 real_completed。')
      if (task1ClosureState.newStockImmediateClosureCount > 0) {
        base.warnings.push('新品入库硬规则：入库同步后必须第一时间补京东/联想官旗真实详情页链接和零售价；缺任一项不得收口。')
      }
    }
    if (taskName === 'daily-stale-inventory-check' && staleInventoryClosureState && !staleInventoryClosureState.closureReady) {
      base.executionOutcome = 'executed_not_closed'
      base.manualActionRequired = true
      const reasons = [
        staleInventoryClosureState.inventoryMasterMissing ? '库存主快照缺失' : undefined,
        staleInventoryClosureState.inventoryExceptionCount > 0 ? `库存主快照仍有 ${staleInventoryClosureState.inventoryExceptionCount} 条异常` : undefined,
        !staleInventoryClosureState.upstreamClosed
          ? `当天智店通出入库未收口（${staleInventoryClosureState.upstreamOutcome ?? 'no_report'}${staleInventoryClosureState.upstreamBlockingReason ? `：${staleInventoryClosureState.upstreamBlockingReason}` : ''}）`
          : undefined,
      ].filter(Boolean)
      base.blockingReason = reasons.join('，') || '陈旧库存审计缺少主快照或同日出入库收口证据。'
      base.warnings.push('陈旧库存任务硬规则：库存主快照缺失、主快照仍有异常、或当天出入库未收口时，只能记 executed_not_closed。')
    }
    base.steps.push({
      step: 'build_semi_auto_execution_plan',
      status: 'completed',
      metrics: {
        pendingTaskCount: semiAutoPlan.plan.summary.pendingTaskCount,
        retailFullCaptureCount: semiAutoPlan.plan.summary.retailFullCaptureCount,
        retailPriceVerificationCount: semiAutoPlan.plan.summary.retailPriceVerificationCount,
        retailLinkBackfillCount: semiAutoPlan.plan.summary.retailLinkBackfillCount,
        newStockPriorityCount: semiAutoPlan.plan.summary.newStockPriorityCount,
        newStockImmediateClosureCount: semiAutoPlan.plan.summary.newStockImmediateClosureCount,
        frontendBlankPriceCount: semiAutoPlan.plan.summary.frontendBlankPriceCount,
        zhidiantongSerialGapCount: semiAutoPlan.plan.summary.zhidiantongSerialGapCount,
      },
      files: [semiAutoPlan.artifactPath, semiAutoPlan.webPath],
    })
    const sqlAutoSyncAudit = await syncSqlMirrorAndBuildGapAudit(taskName)
    base.steps.push({
      step: 'sync_sql_mirror_and_gap_audit',
      status: sqlAutoSyncAudit.status === 'failed' || sqlAutoSyncAudit.blockCurrentTask ? 'failed' : 'completed',
      detail: sqlAutoSyncAudit.status === 'failed'
        ? `SQL 自动镜像/缺口审计失败：${sqlAutoSyncAudit.error ?? 'unknown_error'}。采集结果不能只停留在 JSON。`
        : sqlAutoSyncAudit.openGapCount > 0
          ? `已把本轮采集快照同步到 SQLite/snapshot_cache，并用 order_sync_registry/sync_gap_queue 做智能比对；当前仍有 ${sqlAutoSyncAudit.openGapCount} 条 open 缺口，其中 critical=${sqlAutoSyncAudit.criticalOpenGapCount}、warning=${sqlAutoSyncAudit.warningOpenGapCount}。`
          : '已把本轮采集快照同步到 SQLite/snapshot_cache，并确认 sync_gap_queue 无 open 缺口。',
      metrics: {
        checkedSnapshotCount: sqlAutoSyncAudit.checkedSnapshots.length,
        snapshotCacheSyncedCount: sqlAutoSyncAudit.snapshotCache?.syncedCount,
        snapshotCacheSkippedCount: sqlAutoSyncAudit.snapshotCache?.skippedCount,
        localSyncWrittenCount: sqlAutoSyncAudit.localSyncWrittenCount,
        openSyncGapCount: sqlAutoSyncAudit.openGapCount,
        criticalOpenSyncGapCount: sqlAutoSyncAudit.criticalOpenGapCount,
        warningOpenSyncGapCount: sqlAutoSyncAudit.warningOpenGapCount,
      },
      files: [scheduledSqlAuditPath(), scheduledSqlAuditWebPath()],
    })
    if (sqlAutoSyncAudit.status === 'failed') {
      base.executionOutcome = 'executed_not_closed'
      base.manualActionRequired = true
      base.blockingReason = `SQL 自动镜像/缺口审计失败：${sqlAutoSyncAudit.error ?? 'unknown_error'}。`
      base.warnings.push(base.blockingReason)
    } else if (sqlAutoSyncAudit.blockCurrentTask) {
      base.executionOutcome = 'executed_not_closed'
      base.manualActionRequired = true
      base.blockingReason = `SQL 智能比对发现 ${sqlAutoSyncAudit.openGapCount} 条未闭环缺口，不能把本轮写成已同步完成。`
      const samples = sqlAutoSyncAudit.openGapSamples
        .map((item) => `${item.orderNumber || 'unknown'}:${item.gapType || 'unknown'}`)
        .filter(Boolean)
        .slice(0, 8)
      base.warnings.push(`${base.blockingReason} 样例：${samples.join(', ') || '无样例'}`)
    } else if (sqlAutoSyncAudit.openGapCount > 0) {
      base.warnings.push(`SQL 智能比对仍有 ${sqlAutoSyncAudit.openGapCount} 条 open 缺口；本任务不是进销存闭环任务，已记录到 latest-scheduled-sql-auto-sync-audit.json。`)
    }
    const protectedRetailRuleStateAfter = await captureProtectedRetailRuleStates()
    const protectedRetailRuleDiffs = diffProtectedRetailRuleStates(
      protectedRetailRuleStateBefore,
      protectedRetailRuleStateAfter,
    )
    base.steps.push({
      step: 'verify_store_retail_rule_protection',
      status: protectedRetailRuleDiffs.length > 0 ? 'failed' : 'completed',
      detail: protectedRetailRuleDiffs.length > 0
        ? '检测到手动门店零售价规则文件在定时任务期间被改写；定时任务只允许更新本轮原始数据和派生快照，禁止改写门店零售价手动规则。'
        : '已确认本轮定时任务未改写手动门店零售价规则文件。',
      metrics: {
        protectedRuleFileCount: protectedRetailRulePaths().length,
        changedProtectedRuleFileCount: protectedRetailRuleDiffs.length,
      },
      files: protectedRetailRulePaths(),
    })
    if (protectedRetailRuleDiffs.length > 0) {
      base.executionOutcome = 'executed_not_closed'
      base.manualActionRequired = true
      const changedFiles = protectedRetailRuleDiffs.map((item) => path.basename(item.filePath)).join(', ')
      base.blockingReason = `定时任务改写了手动门店零售价规则文件：${changedFiles}；本轮只能算数据采集执行，不能算门店零售价规则安全收口。`
      base.warnings.push(base.blockingReason)
    }
    const allStepsCompleted = base.steps.length > 0 && base.steps.every((step) => step.status === 'completed')
    if (allStepsCompleted && base.executionOutcome === 'blocked_missing_input') {
      base.executionOutcome = 'real_completed'
      base.manualActionRequired = false
      base.blockingReason = undefined
    }
    enforceStrictVisibleClosureGates(taskName, base)
    const finishedAt = new Date().toISOString()
    const executionOutcome = base.executionOutcome ?? (base.warnings.length ? 'executed_not_closed' : 'real_completed')
    if (executionOutcome === 'blocked_page_risk') {
      base.manualActionRequired = true
      const hint = getPageRiskRecoveryHint(taskName, base.blockingReason)
      if (!base.blockingReason?.includes(hint)) {
        base.blockingReason = base.blockingReason ? `${base.blockingReason} ${hint}` : hint
      }
    }
    const status: TaskStatus = base.steps.some((step) => step.status === 'failed')
      ? (base.steps.some((step) => step.status === 'completed') ? 'completed_with_warnings' : 'failed')
      : (base.warnings.length ? 'completed_with_warnings' : 'completed')

    return saveTaskReport({
      taskName,
      executedAt: base.executedAt,
      finishedAt,
      durationMs: Date.now() - startedAt,
      status,
      executionOutcome,
      manualActionRequired: base.manualActionRequired,
      blockingReason: base.blockingReason,
      warnings: base.warnings,
      steps: base.steps,
      metrics: {
        newRecordCount: base.newRecordCount,
        updatedRecordCount: base.updatedRecordCount,
        unmatchedProductCount: base.unmatchedProductCount,
        missingLinkCount: task1ClosureState?.missingLinkCount ?? currentMetrics.missingLinkCount,
        missingPriceCount: task1ClosureState?.missingPriceCount ?? currentMetrics.missingPriceCount,
        missingWarrantyCount: currentMetrics.missingWarrantyCount,
        frontendRefreshed: base.frontendRefreshed,
        inStockSkuCount: task1ClosureState?.inStockSkuCount,
        frontendBlankPriceCount: task1ClosureState?.frontendBlankPriceCount,
        newStockPriorityCount: semiAutoPlan.plan.summary.newStockPriorityCount,
        newStockImmediateClosureCount: semiAutoPlan.plan.summary.newStockImmediateClosureCount,
        task1ClosureReady: task1ClosureState?.closureReady,
      },
    })
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : String(error)
    const hint = getPageRiskRecoveryHint(taskName, message)
    base.warnings.push(message)
    base.steps.push({
      step: 'task_execution',
      status: 'failed',
      detail: message,
    })
    return saveTaskReport({
      taskName,
      executedAt: base.executedAt,
      finishedAt,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      executionOutcome: 'blocked_page_risk',
      manualActionRequired: true,
      blockingReason: `${message} ${hint}`.trim(),
      warnings: base.warnings,
      steps: base.steps,
      metrics: {
        newRecordCount: base.newRecordCount,
        updatedRecordCount: base.updatedRecordCount,
        unmatchedProductCount: base.unmatchedProductCount,
        missingLinkCount: 0,
        missingPriceCount: 0,
        missingWarrantyCount: 0,
        frontendRefreshed: base.frontendRefreshed,
        inStockSkuCount: 0,
        frontendBlankPriceCount: 0,
        task1ClosureReady: false,
      },
    })
  }
}
