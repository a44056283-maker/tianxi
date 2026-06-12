import { config } from '../config.js'
import { saveRetailZoneSnapshot } from '../inventoryQuote/dataService.js'
import { collectBrowserMarketplacePrices } from './browserMarketplaceCollector.js'
import { collectChromeJdRetailPrices } from './chromeJdRetailCollector.js'
import { saveMarketplacePriceSnapshot } from './marketplacePriceCollector.js'
import { saveProductUrlLockSnapshot } from './productUrlLockStore.js'

type RetailCollectorStep = 'jd_chrome' | 'lenovo_official' | 'taobao_browser'

function parseSteps() {
  const raw = process.env.RETAIL_SITE_COLLECTORS ?? ''
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is RetailCollectorStep => (
      item === 'jd_chrome'
      || item === 'lenovo_official'
      || item === 'taobao_browser'
    ))
}

export async function collectRetailSites() {
  const steps = parseSteps()
  const summaries: Array<{
    step: RetailCollectorStep
    status: 'completed' | 'skipped' | 'failed'
    reason?: string
    recordCount?: number
    scannedUrlCount?: number
    errorCount?: number
    manualInputPath?: string
    verificationRequiredUrl?: string
  }> = []

  if (steps.length && process.env.RETAIL_COLLECTION_CONFIRMED !== 'true') {
    for (const step of steps) {
      summaries.push({
        step,
        status: 'skipped',
        reason: '采集流程尚未校准。请先运行 npm run build:collection-plan 锁定 URL 和采信规则；校准完成后设置 RETAIL_COLLECTION_CONFIRMED=true 再执行采集。',
      })
    }
    const marketplace = await saveMarketplacePriceSnapshot()
    const locks = await saveProductUrlLockSnapshot()
    const retailZone = await saveRetailZoneSnapshot()
    return {
      steps: summaries,
      files: {
        marketplacePath: marketplace.artifactPath,
        productUrlLocksPath: locks.artifactPath,
        retailZonePath: retailZone.artifactPath,
      },
      totals: {
        marketplaceItemCount: marketplace.snapshot.itemCount,
        productUrlLockCount: locks.snapshot.total,
        retailZoneItemCount: retailZone.snapshot.decisions.total,
      },
    }
  }

  if (steps.includes('jd_chrome')) {
    try {
      const result = await collectChromeJdRetailPrices()
      summaries.push({
        step: 'jd_chrome',
        status: 'completed',
        recordCount: result.recordCount,
        scannedUrlCount: result.scannedUrlCount,
        errorCount: result.errors.length,
        manualInputPath: result.manualInputPath,
        verificationRequiredUrl: result.verificationRequiredUrl,
      })
    } catch (error) {
      summaries.push({ step: 'jd_chrome', status: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  }

  if (steps.includes('lenovo_official')) {
    const previousSources = config.marketplaceBrowser.sources
    config.marketplaceBrowser.sources = ['lenovo_official']
    try {
      const result = await collectBrowserMarketplacePrices()
      summaries.push({
        step: 'lenovo_official',
        status: 'completed',
        recordCount: result.browserRecordCount,
        errorCount: result.errors.length,
        manualInputPath: result.manualInputPath,
      })
    } catch (error) {
      summaries.push({ step: 'lenovo_official', status: 'failed', reason: error instanceof Error ? error.message : String(error) })
    } finally {
      config.marketplaceBrowser.sources = previousSources
    }
  }

  if (steps.includes('taobao_browser')) {
    summaries.push({
      step: 'taobao_browser',
      status: 'skipped',
      reason: '淘宝百亿补贴改为 Codex 原生电脑操控类人采集；当前先锁定搜索/详情 URL 和匹配规范，未校准前不自动写价。',
    })
  }

  const marketplace = await saveMarketplacePriceSnapshot()
  const locks = await saveProductUrlLockSnapshot()
  const retailZone = await saveRetailZoneSnapshot()

  return {
    steps: summaries,
    files: {
      marketplacePath: marketplace.artifactPath,
      productUrlLocksPath: locks.artifactPath,
      retailZonePath: retailZone.artifactPath,
    },
    totals: {
      marketplaceItemCount: marketplace.snapshot.itemCount,
      productUrlLockCount: locks.snapshot.total,
      retailZoneItemCount: retailZone.snapshot.decisions.total,
    },
  }
}
