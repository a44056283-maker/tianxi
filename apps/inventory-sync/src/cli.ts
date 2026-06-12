import { LenovoRetailConnector } from './connectors/lenovoRetailConnector.js'
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { config } from './config.js'
import {
  findLatestStockQuantityExport,
  findLatestStockSnExport,
  parseStockQuantityExport,
  parseStockSnExport,
} from './storage/excelInventoryParser.js'
import { buildSnapshotFromLatestExports, saveInventorySnapshot } from './storage/inventorySnapshotBuilder.js'
import { saveDistributorQuoteArtifacts } from './storage/distributorQuoteParser.js'
import { saveGrayWholesaleSnapshotFromText } from './storage/grayWholesaleQuoteParser.js'
import { saveMarketplacePriceSnapshot } from './storage/marketplacePriceCollector.js'
import { collectBrowserMarketplacePrices } from './storage/browserMarketplaceCollector.js'
import { collectChromeJdRetailPrices } from './storage/chromeJdRetailCollector.js'
import { collectRetailSites } from './storage/retailSiteCollector.js'
import { saveCollectionOperationPlan } from './storage/collectionOperationPlan.js'
import { saveProductUrlLockSnapshot } from './storage/productUrlLockStore.js'
import { saveWarrantyCheckQueue } from './inventoryQuote/warrantyCheckQueue.js'
import {
  collectLenovoWarrantySnapshot,
  importManualLenovoWarrantyEvidence,
} from './inventoryQuote/lenovoWarrantyCollector.js'
import { saveRetailPriceAuditSnapshot } from './inventoryQuote/retailPriceAudit.js'
import { saveGhostInventoryAuditSnapshot } from './inventoryQuote/ghostInventoryAudit.js'
import { saveSnReconciliationSnapshot } from './inventoryQuote/buildSnReconciliationSnapshot.js'
import { captureZhidiantongSession, syncZhidiantongSeededData } from './storage/zhidiantongAutoSync.js'
import { importZhidiantongOtherOutbound } from './storage/zhidiantongOtherOutboundImporter.js'
import { importZhidiantongPurchaseWeb } from './storage/zhidiantongPurchaseWebImporter.js'
import { importZhidiantongSalesExport } from './storage/zhidiantongSalesExportImporter.js'
import { auditZhidiantongSalesSync, saveZhidiantongSalesSyncAuditReport } from './storage/zhidiantongSalesSyncAudit.js'
import { importZhidiantongStockStream } from './storage/zhidiantongStockStreamImporter.js'
import { saveZdtOpenclawBridgeSnapshot } from './storage/zdtOpenclawBridge.js'
import { buildInventoryMasterSnapshot, saveInventoryMasterSnapshot } from './storage/inventoryMasterMerge.js'
import {
  type InventoryMovementRecord,
  type SerialOverride,
  saveInventoryMovements,
  saveRetailZoneSnapshot,
  saveSerialOverrides,
} from './inventoryQuote/dataService.js'
import { repairLenovoRetailBrowserCache } from './storage/lenovoRetailBrowserRepair.js'
import { runScheduledTask, scheduledTaskNames, type ScheduledTaskName } from './automation/scheduledTasks.js'
import { runScheduledTaskWatchdog } from './automation/scheduledTaskWatchdog.js'
import { listLocalSyncPipelines, localSyncPipelineNames, runLocalSyncPipeline, type LocalSyncPipelineName } from './automation/localSync.js'
import { saveStandardPriceMasterSnapshot } from './storage/standardPriceMaster.js'
import { buildSemiAutoExecutionPlan } from './semiAuto/taskPlanner.js'
import { saveGrayChannelSnapshot } from './storage/grayChannelCollector.js'
import {
  buildQuoteOcrQueueSnapshot,
  buildWechatQuoteEvidenceSnapshot,
} from './storage/wechatQuoteEvidence.js'
import { saveCompetitorCollectionPlan, saveCompetitorMonitorSnapshot } from './storage/competitorMonitor.js'
import { saveMarketingBoostSnapshot } from './storage/marketingBoostStore.js'
import { buildOpenClawReceiptSnapshot } from './storage/openclawReceipts.js'
import { buildOpenClawCommandBoardSnapshot } from './storage/openclawCommandBoard.js'
import {
  sendDailyCompetitorBroadcast,
  sendDailyInventoryPriceBroadcast,
} from './automation/feishuTaskFeedback.js'

const command = process.argv[2]
const connector = new LenovoRetailConnector()
const projectRoot = path.resolve(config.appDir, '..', '..')

function printBlockedExternalPageCollector(reasonCommand?: string) {
  const payload = {
    status: 'blocked',
    executionOutcome: 'blocked_page_risk',
    blockedCommand: reasonCommand ?? command,
    reason: '外部页面真实采集入口已封禁：禁止脚本/无头/高频点击/新浏览器/空白浏览器/新浏览器 Profile 直接采集京东、联想商城、天猫/淘宝、网页微信、智店通或联想保修页。',
    allowedWorkflow: [
      '只允许在用户当前已经登录的默认 Chrome 可见窗口中类人低频操作取得原始证据。',
      '禁止重新打开新的浏览器、禁止打开空白浏览器、禁止新建 Chrome Profile、禁止清理登录缓存、禁止退出账号后重登。',
      '禁止使用 Browser/in-app browser/browser-use/Playwright/Puppeteer/Chromium launch 打开外部采集页面。',
      '每次点击、滚动、打开详情、返回列表之间必须自适应停顿。',
      '遇到验证码、403、快速验证、滑块、白屏或账号异常立即停止并写 blocked_page_risk。',
      '本地命令只允许解析已取得的人工证据、写入快照、重建前端和生成报告。',
    ],
  }
  console.log(JSON.stringify(payload, null, 2))
  process.exitCode = 2
}

function readFlagValue(flag: string) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function readFlagValues(flag: string) {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1])
    }
  }
  return values
}

function runPythonScript(scriptRelativePath: string, args: string[] = []) {
  const scriptPath = path.resolve(projectRoot, scriptRelativePath)
  const result = spawnSync('python3', [scriptPath, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exitCode = result.status
  }
}

if (command === 'blocked-external-page-collector') {
  printBlockedExternalPageCollector(process.argv[3])
} else if (command === 'login') {
  printBlockedExternalPageCollector(command)
} else if (command === 'probe') {
  printBlockedExternalPageCollector(command)
} else if (command === 'repair-lenovo-browser-cache') {
  const clearLogin = process.argv.includes('--clear-login')
  if (clearLogin) {
    printBlockedExternalPageCollector('repair-lenovo-browser-cache --clear-login')
  } else {
  const result = await repairLenovoRetailBrowserCache({ clearLogin })
  console.log(JSON.stringify(result, null, 2))
  }
} else if (command === 'capture-zhidiantong-session') {
  printBlockedExternalPageCollector(command)
} else if (command === 'sync-zhidiantong-seeded-data') {
  const result = await syncZhidiantongSeededData()
  console.log(JSON.stringify(result, null, 2))
} else if (command === 'import-zhidiantong-sales-export') {
  const inputFile = process.argv[3]
  const result = await importZhidiantongSalesExport(inputFile)
  console.log(JSON.stringify({
    sourceFile: result.sourceFile,
    importedCount: result.importedCount,
    mergedRecordCount: result.mergedRecordCount,
    skippedCount: result.skippedCount,
    warnings: result.warnings.slice(0, 20),
    files: result.files,
    sample: result.sample,
  }, null, 2))
} else if (command === 'audit-zhidiantong-sales-sync') {
  const from = process.argv[3] || '2026-05-01'
  const to = process.argv[4] || '2026-05-14'
  const result = await auditZhidiantongSalesSync(from, to)
  const files = await saveZhidiantongSalesSyncAuditReport(result)
  console.log(JSON.stringify({ ...result, files }, null, 2))
} else if (command === 'import-zhidiantong-purchase-web') {
  const inputFile = process.argv[3]
  const result = await importZhidiantongPurchaseWeb(inputFile)
  console.log(JSON.stringify({
    sourceFile: result.sourceFile,
    importedCount: result.importedCount,
    overrideCount: result.overrideCount,
    mergedRecordCount: result.mergedRecordCount,
    mergedOverrideCount: result.mergedOverrideCount,
    files: result.files,
    serialOverrideFiles: result.serialOverrideFiles,
    sample: result.sample,
  }, null, 2))
} else if (command === 'import-zhidiantong-other-outbound') {
  const inputFile = process.argv[3]
  const result = await importZhidiantongOtherOutbound(inputFile)
  console.log(JSON.stringify({
    sourceFile: result.sourceFile,
    importedCount: result.importedCount,
    mergedRecordCount: result.mergedRecordCount,
    files: result.files,
    sample: result.sample,
  }, null, 2))
} else if (command === 'import-zhidiantong-stock-stream') {
  const inputFile = process.argv[3]
  const result = await importZhidiantongStockStream(inputFile)
  console.log(JSON.stringify({
    sourceFile: result.sourceFile,
    importedCount: result.importedCount,
    overrideCount: result.overrideCount,
    mergedRecordCount: result.mergedRecordCount,
    mergedOverrideCount: result.mergedOverrideCount,
    skippedCount: result.skippedCount,
    warnings: result.warnings.slice(0, 20),
    files: result.files,
    serialOverrideFiles: result.serialOverrideFiles,
    sample: result.sample,
  }, null, 2))
} else if (command === 'sync-zdt-openclaw-bridge') {
  const result = await saveZdtOpenclawBridgeSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    snapshot: result.snapshot,
  }, null, 2))
} else if (command === 'sync-education-subsidy-cli') {
  const minDate = readFlagValue('--min-date')
  const maxDate = readFlagValue('--max-date')
  const maxFiles = readFlagValue('--max-files-per-dir')
  const sourceRoot = readFlagValue('--source-root')
  const reportDir = readFlagValue('--report-dir')
  const registryFile = readFlagValue('--registry-file')
  const apiBase = readFlagValue('--api-base')
  const sourceDirs = readFlagValues('--source-dir')
  const skipIncoming = process.argv.includes('--skip-watermark-incoming')
  const onlyLegacyPrefix = process.argv.includes('--only-legacy-prefix')
  const allowEvidenceOnlySql = process.argv.includes('--allow-evidence-only-sql')
  const args = [
    ...(minDate ? ['--min-date', minDate] : []),
    ...(maxDate ? ['--max-date', maxDate] : []),
    ...(maxFiles ? ['--max-files-per-dir', maxFiles] : []),
    ...(sourceRoot ? ['--source-root', sourceRoot] : []),
    ...(reportDir ? ['--report-dir', reportDir] : []),
    ...(registryFile ? ['--registry-file', registryFile] : []),
    ...(apiBase ? ['--api-base', apiBase] : []),
    ...sourceDirs.flatMap((sourceDir) => ['--source-dir', sourceDir]),
    ...(skipIncoming ? ['--skip-watermark-incoming'] : []),
    ...(onlyLegacyPrefix ? ['--only-legacy-prefix'] : []),
    ...(allowEvidenceOnlySql ? ['--allow-evidence-only-sql'] : []),
  ]
  runPythonScript('scripts/run_education_subsidy_cli_sync.py', args)
} else if (command === 'sync-education-subsidy-watermark-incoming') {
  runPythonScript('scripts/watermark_camera_sync.py', ['--once'])
} else if (command === 'save-inventory-movements') {
  const inputFile = process.argv[3]
  if (!inputFile) throw new Error('缺少流水文件路径。')
  const content = await fs.readFile(inputFile, 'utf-8')
  const payload = JSON.parse(content) as { records?: unknown[] } | unknown[]
  const result = await saveInventoryMovements((Array.isArray(payload) ? payload : payload.records ?? []) as InventoryMovementRecord[])
  console.log(JSON.stringify({
    files: result.files,
    generatedAt: result.snapshot.generatedAt,
    recordCount: result.snapshot.records.length,
    sample: result.snapshot.records.slice(0, 12),
  }, null, 2))
} else if (command === 'save-serial-overrides') {
  const inputFile = process.argv[3]
  if (!inputFile) throw new Error('缺少 SN 覆盖文件路径。')
  const content = await fs.readFile(inputFile, 'utf-8')
  const payload = JSON.parse(content) as { overrides?: Record<string, unknown> } | Record<string, unknown>
  const result = await saveSerialOverrides(('overrides' in payload ? payload.overrides ?? {} : payload) as Record<string, SerialOverride>)
  console.log(JSON.stringify({
    files: result.files,
    generatedAt: result.snapshot.generatedAt,
    overrideCount: Object.keys(result.snapshot.overrides).length,
    sample: Object.entries(result.snapshot.overrides).slice(0, 12),
  }, null, 2))
} else if (command === 'sync') {
  printBlockedExternalPageCollector(command)
} else if (command === 'parse-exports') {
  const quantityFile = await findLatestStockQuantityExport()
  const snFile = await findLatestStockSnExport()
  const stockSummaryItems = quantityFile ? await parseStockQuantityExport(quantityFile) : []
  const inventoryItems = snFile ? await parseStockSnExport(snFile) : []
  console.log(JSON.stringify({
    quantityFile,
    snFile,
    stockSummaryCount: stockSummaryItems.length,
    serialCount: inventoryItems.length,
    stockSummarySample: stockSummaryItems.slice(0, 3),
    serialSample: inventoryItems.slice(0, 3),
  }, null, 2))
} else if (command === 'build-snapshot') {
  const snapshot = await buildSnapshotFromLatestExports()
  const files = await saveInventorySnapshot(snapshot)
  console.log(JSON.stringify({
    files,
    totals: snapshot.totals,
    dataQuality: snapshot.dataQuality,
    storeName: snapshot.storeName,
    organizationCode: snapshot.organizationCode,
    sample: snapshot.skus.slice(0, 3),
  }, null, 2))
} else if (command === 'build-inventory-master') {
  const snapshot = await buildInventoryMasterSnapshot()
  const files = await saveInventoryMasterSnapshot(snapshot)
  console.log(JSON.stringify({
    files,
    generatedAt: snapshot.generatedAt,
    totals: snapshot.totals,
    coverage: snapshot.coverage,
    warnings: snapshot.warnings,
    sample: snapshot.rows.slice(0, 8),
    exceptions: snapshot.exceptions.slice(0, 12),
  }, null, 2))
} else if (command === 'parse-distributor-quotes') {
  const result = await saveDistributorQuoteArtifacts()
  console.log(JSON.stringify({
    quoteFile: result.quoteFile,
    quoteCount: result.quoteCount,
    matchedSkuCount: result.priceProtection.matchedSkuCount,
    candidateCount: result.priceProtection.candidates.length,
    candidates: result.priceProtection.candidates.slice(0, 10),
    files: {
      quotesPath: result.quotesPath,
      priceProtectionPath: result.priceProtectionPath,
      webQuotesPath: result.webQuotesPath,
      webPriceProtectionPath: result.webPriceProtectionPath,
      marketingBoostPath: result.marketingBoost.artifactPath,
      webMarketingBoostPath: result.marketingBoost.webPath,
    },
    marketingBoost: {
      activityCount: result.marketingBoost.snapshot.summary.activityCount,
      eligibleInventoryCount: result.marketingBoost.snapshot.summary.eligibleInventoryCount,
      heroCardCount: result.marketingBoost.snapshot.summary.heroCardCount,
    },
  }, null, 2))
} else if (command === 'build-marketing-boost') {
  const result = await saveMarketingBoostSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    summary: result.snapshot.summary,
    sampleActivities: result.snapshot.activities.slice(0, 8),
    sampleHeroCards: result.snapshot.heroCards.slice(0, 8),
  }, null, 2))
} else if (command === 'parse-gray-wholesale') {
  const args = process.argv.slice(3)
  const rawText = args[0] && await fs.stat(args[0]).then((stat) => stat.isFile()).catch(() => false)
    ? await fs.readFile(args[0], 'utf-8')
    : args.join(' ')
  const result = await saveGrayWholesaleSnapshotFromText(rawText || undefined)
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    quoteDate: result.snapshot.quoteDate,
    isCarriedForward: result.snapshot.isCarriedForward,
    quoteCount: result.snapshot.quoteCount,
    sample: result.snapshot.quotes.slice(0, 10),
  }, null, 2))
} else if (command === 'parse-competitor-monitor') {
  const sourceFile = process.argv[3]
  const result = await saveCompetitorMonitorSnapshot(sourceFile)
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
      storeFavoritesArtifactPath: result.storeFavoritesArtifactPath,
      storeFavoritesWebPath: result.storeFavoritesWebPath,
      linkRepositoryArtifactPath: result.linkRepositoryArtifactPath,
      linkRepositoryWebPath: result.linkRepositoryWebPath,
    },
    quoteDate: result.snapshot.quoteDate,
    isCarriedForward: result.snapshot.isCarriedForward,
    totalItemCount: result.totalItemCount,
    acceptedItemCount: result.acceptedItemCount,
    rejectedByScopeCount: result.rejectedByScopeCount,
    itemCount: result.snapshot.itemCount,
    brands: result.snapshot.brands.map((brand) => ({
      brand: brand.brand,
      itemCount: brand.itemCount,
      latestCapturedAt: brand.latestCapturedAt,
    })),
    sample: result.snapshot.brands.flatMap((brand) => brand.items).slice(0, 10),
  }, null, 2))
} else if (command === 'build-competitor-collection-plan') {
  const result = await saveCompetitorCollectionPlan()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    quoteDate: result.plan.quoteDate,
    brandCount: result.plan.brands.length,
    targetPerBrand: result.plan.targetPerBrand,
    targetCount: result.plan.brands.reduce((sum, brand) => sum + brand.targets.length, 0),
    outputFile: result.plan.outputFile,
    brands: result.plan.brands.map((brand) => ({
      brand: brand.brand,
      storeName: brand.storeName,
      storedLinkCount: brand.storedLinkCount,
      targetCount: brand.targets.length,
    })),
  }, null, 2))
} else if (command === 'build-openclaw-receipts') {
  const result = await buildOpenClawReceiptSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
      receiptDir: result.receiptDir,
    },
    generatedAt: result.snapshot.generatedAt,
    total: result.snapshot.total,
    byStatus: result.snapshot.byStatus,
    latestByTask: result.snapshot.latestByTask,
  }, null, 2))
} else if (command === 'build-openclaw-command-board') {
  const result = await buildOpenClawCommandBoardSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
      commandDir: result.commandDir,
    },
    generatedAt: result.snapshot.generatedAt,
    total: result.snapshot.total,
    byStatus: result.snapshot.byStatus,
    latestByTask: result.snapshot.latestByTask,
  }, null, 2))
} else if (command === 'build-wechat-quote-evidence') {
  const result = await buildWechatQuoteEvidenceSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    total: result.snapshot.total,
    bySource: result.snapshot.bySource,
    byKind: result.snapshot.byKind,
    sample: result.snapshot.records.slice(0, 12),
  }, null, 2))
} else if (command === 'build-quote-ocr-queue') {
  const result = await buildQuoteOcrQueueSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    total: result.snapshot.total,
    pendingCount: result.snapshot.pendingCount,
    completedCount: result.snapshot.completedCount,
    sample: result.snapshot.items.slice(0, 12),
  }, null, 2))
} else if (command === 'collect-marketplace-prices') {
  const inputFile = process.argv[3]
  const result = await saveMarketplacePriceSnapshot(inputFile)
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    itemCount: result.snapshot.itemCount,
    sources: result.snapshot.sources,
    sample: result.snapshot.records.slice(0, 12),
  }, null, 2))
} else if (command === 'collect-justoneapi-prices') {
  console.log(JSON.stringify({
    status: 'skipped',
    reason: 'JustOneAPI 已停用。零售价格后续只通过 Codex 原生电脑操控/Chrome 类人采集，不再使用第三方收费 API。',
  }, null, 2))
} else if (command === 'collect-browser-marketplace-prices') {
  printBlockedExternalPageCollector(command)
} else if (command === 'collect-lenovo-official-prices') {
  printBlockedExternalPageCollector(command)
} else if (command === 'collect-taobao-subsidy-prices' || command === 'collect-jd-api-prices') {
  console.log(JSON.stringify({
    status: 'skipped',
    command,
    reason: command === 'collect-taobao-subsidy-prices'
      ? '淘宝百亿补贴采集改为 Codex 原生电脑操控类人采集；当前先锁定 URL 和校准匹配规则，未校准前不自动写价。'
      : '京东 API 兜底已停用；京东价格只使用已锁定 URL 的 Chrome/CDP 类人采集。',
  }, null, 2))
} else if (command === 'collect-chrome-jd-retail') {
  printBlockedExternalPageCollector(command)
} else if (command === 'collect-retail-sites') {
  printBlockedExternalPageCollector(command)
} else if (command === 'build-product-url-locks') {
  const result = await saveProductUrlLockSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    total: result.snapshot.total,
    bySource: result.snapshot.bySource,
    sample: result.snapshot.locks.slice(0, 12),
  }, null, 2))
} else if (command === 'build-collection-plan') {
  const result = await saveCollectionOperationPlan()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    totals: result.snapshot.totals,
    commands: result.snapshot.commands,
    sample: result.snapshot.items.slice(0, 12),
  }, null, 2))
} else if (command === 'build-standard-price-master') {
  const result = await saveStandardPriceMasterSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPaths: result.artifactPaths,
      webPaths: result.webPaths,
    },
    generatedAt: result.master.generatedAt,
    totals: result.master.totals,
    sample: result.master.rows.slice(0, 12),
    frontendSample: result.frontend.rows.slice(0, 12),
  }, null, 2))
} else if (command === 'build-warranty-queue') {
  const result = await saveWarrantyCheckQueue()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    total: result.snapshot.total,
    limitation: result.snapshot.limitation,
    sample: result.snapshot.items.slice(0, 10),
  }, null, 2))
} else if (command === 'collect-lenovo-warranty') {
  printBlockedExternalPageCollector(command)
} else if (command === 'import-manual-lenovo-warranty') {
  const date = process.argv[3]
  const result = await importManualLenovoWarrantyEvidence(date)
  const refreshedQueue = await saveWarrantyCheckQueue()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
      refreshedQueueArtifactPath: refreshedQueue.artifactPath,
      refreshedQueueWebPath: refreshedQueue.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    total: result.snapshot.total,
    successCount: result.snapshot.successCount,
    notFoundCount: result.snapshot.notFoundCount,
    failedCount: result.snapshot.failedCount,
    importStats: result.importStats,
    remainingQueueTotal: refreshedQueue.snapshot.total,
    sample: result.snapshot.records.slice(0, 10),
  }, null, 2))
} else if (command === 'audit-retail-prices') {
  const result = await saveRetailPriceAuditSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    policy: result.snapshot.policy,
    totals: result.snapshot.totals,
    priorityManualCaptureItems: result.snapshot.priorityManualCaptureItems.slice(0, 20),
  }, null, 2))
} else if (command === 'audit-ghost-inventory') {
  const result = await saveGhostInventoryAuditSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    totals: result.snapshot.totals,
    stockWithoutSn: result.snapshot.stockWithoutSn.slice(0, 20),
    partialSnCoverage: result.snapshot.partialSnCoverage.slice(0, 20),
    retailZoneMissing: result.snapshot.retailZoneMissing.slice(0, 20),
    retailZoneGhosts: result.snapshot.retailZoneGhosts.slice(0, 20),
  }, null, 2))
} else if (command === 'build-sn-reconciliation-snapshot') {
  const result = await saveSnReconciliationSnapshot()
  console.log(JSON.stringify({
    files: result.files,
    mismatchCount: result.mismatch.mismatchCount,
    overSerialCount: result.mismatch.overSerialCount,
    underSerialCount: result.mismatch.underSerialCount,
    top5: result.summary.top5,
    standardTotals: result.summary.standardTotals,
    coreStockSnMismatchCount: result.summary.coreStockSnMismatchCount,
    projectionVsStandardMismatchCount: result.summary.projectionVsStandardMismatchCount,
    channelStockSnMismatchCount: result.summary.channelStockSnMismatchCount,
    distMismatchCount: result.summary.distMismatchCount,
    liveMismatchCount: result.summary.liveMismatchCount,
  }, null, 2))
} else if (command === 'build-retail-zone') {
  const result = await saveRetailZoneSnapshot()
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.snapshot.generatedAt,
    total: result.snapshot.decisions.total,
    sample: result.snapshot.decisions.items.slice(0, 10).map((item) => ({
      skuKey: item.skuKey,
      productName: item.productName,
      jdPrice: item.jdPrice,
      lenovoOfficialPrice: item.lenovoOfficialPrice,
      recommendedPreSubsidyPrice: item.recommendedPreSubsidyPrice,
    })),
  }, null, 2))
} else if (command === 'build-semi-auto-plan') {
  const triggerTaskName = process.argv[3]
  const result = await buildSemiAutoExecutionPlan(triggerTaskName)
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    generatedAt: result.plan.generatedAt,
    triggerTaskName: result.plan.triggerTaskName,
    summary: result.plan.summary,
    sample: result.plan.tasks.slice(0, 6),
  }, null, 2))
} else if (command === 'run-scheduled-task') {
  const taskName = process.argv[3] as ScheduledTaskName | undefined
  if (!taskName || !scheduledTaskNames.includes(taskName)) {
    throw new Error(`未知定时任务。允许值: ${scheduledTaskNames.join(', ')}`)
  }
  const result = await runScheduledTask(taskName)
  console.log(JSON.stringify(result, null, 2))
  if (result.status === 'failed') process.exitCode = 1
} else if (command === 'run-scheduled-task-watchdog') {
  const result = await runScheduledTaskWatchdog()
  console.log(JSON.stringify({
    artifactPath: result.artifactPath,
    webPath: result.webPath,
    summary: result.snapshot.summary,
    notifications: result.snapshot.notifications,
    checks: result.snapshot.checks,
  }, null, 2))
  if (result.snapshot.summary.notify) process.exitCode = 2
} else if (command === 'send-daily-inventory-price-broadcast') {
  const result = await sendDailyInventoryPriceBroadcast()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 2
} else if (command === 'send-daily-competitor-broadcast') {
  const result = await sendDailyCompetitorBroadcast()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 2
} else if (command === 'list-local-sync-pipelines') {
  console.log(JSON.stringify({
    pipelines: listLocalSyncPipelines(),
  }, null, 2))
} else if (command === 'run-local-sync') {
  const pipelineName = process.argv[3] as LocalSyncPipelineName | undefined
  if (!pipelineName || !localSyncPipelineNames.includes(pipelineName)) {
    throw new Error(`未知本地同步管线。允许值: ${localSyncPipelineNames.join(', ')}`)
  }
  const result = await runLocalSyncPipeline(pipelineName, {
    dryRun: process.argv.includes('--dry-run'),
    trigger: readFlagValue('--trigger'),
    operator: readFlagValue('--operator'),
  })
  console.log(JSON.stringify(result, null, 2))
  if (result.status === 'failed') process.exitCode = 1
} else if (command === 'collect-gray-channel') {
  // 灰渠公众号采集（手动模式）
  // 使用方法: npm run collect-gray-channel -- [文本文件路径]
  // 如果不提供文件路径，则尝试从 manual 目录加载
  const inputFile = process.argv[3]
  let rawText: string | undefined
  let sourceFile: string | undefined

  if (inputFile) {
    try {
      rawText = await fs.readFile(inputFile, 'utf-8')
      sourceFile = inputFile
    } catch {
      rawText = inputFile // 可能是直接传入的文本
    }
  }

  const result = await saveGrayChannelSnapshot(rawText, sourceFile)
  console.log(JSON.stringify({
    files: {
      artifactPath: result.artifactPath,
      webPath: result.webPath,
    },
    quoteDate: result.snapshot.quoteDate,
    isCarriedForward: result.snapshot.isCarriedForward,
    carryForwardFrom: result.snapshot.carryForwardFrom,
    quoteCount: result.snapshot.quoteCount,
    sample: result.snapshot.quotes.slice(0, 10),
  }, null, 2))
} else {
  console.log('Usage: npm run login:lenovo | npm run probe:lenovo | npm run repair:lenovo-browser-cache [-- --clear-login] | npm run capture:zhidiantong-session | npm run sync:zhidiantong-seeded | npm run import-zhidiantong-sales-export [-- <xlsx-or-csv-file>] | node --import tsx/esm src/cli.ts audit-zhidiantong-sales-sync [from] [to] | npm run import-zhidiantong-purchase-web [-- <json-file>] | npm run import-zhidiantong-other-outbound [-- <json-file>] | npm run import-zhidiantong-stock-stream [-- <xlsx-or-csv-file>] | node --import tsx/esm src/cli.ts sync-education-subsidy-cli [--source-dir <今日相册目录或ZIP>] [--source-root <dir>] [--report-dir <dir>] [--registry-file <file>] [--api-base <url>] [--min-date YYYY-MM-DD] [--max-date YYYY-MM-DD] [--max-files-per-dir N] [--skip-watermark-incoming] | node --import tsx/esm src/cli.ts sync-education-subsidy-watermark-incoming | npm run save-inventory-movements -- <json-file> | npm run save-serial-overrides -- <json-file> | npm run sync:lenovo | npm run parse:exports | npm run build:snapshot | npm run build-inventory-master | npm run build-standard-price-master | npm run parse-distributor-quotes | npm run parse-gray-wholesale | npm run parse:competitor-monitor | node --import tsx/esm src/cli.ts build-wechat-quote-evidence | node --import tsx/esm src/cli.ts build-quote-ocr-queue | npm run build-product-url-locks | npm run build:collection-plan | npm run build:warranty-queue | node --import tsx/esm src/cli.ts import-manual-lenovo-warranty [date] | npm run audit:retail-prices | node --import tsx/esm src/cli.ts audit-ghost-inventory | npm run build:sn-reconciliation-snapshot | npm run build:retail-zone | npm run build-semi-auto-plan [-- <trigger-task-name>] | npm run run:scheduled-task -- <task-name> | node --import tsx/esm src/cli.ts run-scheduled-task-watchdog | node --import tsx/esm src/cli.ts list-local-sync-pipelines | node --import tsx/esm src/cli.ts run-local-sync <pipeline> [--dry-run] [--trigger api] [--operator <name>]. External page collector commands are intentionally blocked; use visible Chrome manual evidence then parse/rebuild.')
  process.exitCode = 1
}
