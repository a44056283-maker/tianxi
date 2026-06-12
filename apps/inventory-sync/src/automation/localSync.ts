import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { runScheduledTask, type ScheduledTaskName, type ScheduledTaskReport } from './scheduledTasks.js'

export const localSyncPipelineNames = [
  'inventory-master-sync',
  'quote-master-sync',
  'full-daily-sync',
] as const

export type LocalSyncPipelineName = (typeof localSyncPipelineNames)[number]
type LocalSyncStatus = 'completed' | 'completed_with_warnings' | 'failed' | 'dry_run'

type LocalSyncTrigger = 'cli' | 'api' | 'cron' | 'manual'

type LocalSyncOptions = {
  dryRun?: boolean
  trigger?: LocalSyncTrigger | string
  operator?: string
}

type LocalSyncSourceDefinition = {
  sourceKey: string
  label: string
  description: string
  preferredFiles: string[]
  fallbackFiles?: string[]
  consumedBy: ScheduledTaskName[]
}

type LocalSyncTaskSummary = {
  taskName: ScheduledTaskName
  status: ScheduledTaskReport['status']
  reportPath: string
  warnings: string[]
  evidencePaths: string[]
}

type LocalSyncFailureQueueItem = {
  id: string
  pipeline: LocalSyncPipelineName
  taskName: ScheduledTaskName
  severity: 'warning' | 'failed' | 'blocked'
  step?: string
  detail: string
  suggestedAction: string
  evidencePaths: string[]
  createdAt: string
}

type LocalSyncRunReport = {
  runId: string
  pipeline: LocalSyncPipelineName
  trigger: string
  operator?: string
  dryRun: boolean
  generatedAt: string
  finishedAt: string
  status: LocalSyncStatus
  taskSequence: ScheduledTaskName[]
  sourceDefinitions: LocalSyncSourceDefinition[]
  taskReports: LocalSyncTaskSummary[]
  evidencePaths: string[]
  failureQueue: {
    total: number
    path: string
    webPath: string
    items: LocalSyncFailureQueueItem[]
  }
  manualFollowUps: string[]
  notes: string[]
  artifacts: {
    reportPath: string
    latestReportPath: string
    latestIndexPath: string
  }
}

type LocalSyncLatestIndex = {
  generatedAt: string
  latestByPipeline: Partial<Record<LocalSyncPipelineName, LocalSyncRunReport>>
}

type LocalSyncPipelineDefinition = {
  name: LocalSyncPipelineName
  label: string
  description: string
  taskSequence: ScheduledTaskName[]
  sourceDefinitions: LocalSyncSourceDefinition[]
  manualBackfillRules: string[]
}

const localSyncDefinitions: Record<LocalSyncPipelineName, LocalSyncPipelineDefinition> = {
  'inventory-master-sync': {
    name: 'inventory-master-sync',
    label: '库存总表统一同步',
    description: '优先消费智店通库存流水总表；缺失时回退销售出库、商品入库、其他出库拆分文件，并统一重建库存与零售快照。',
    taskSequence: ['zhidiantong-sync-cycle', 'daily-audit-and-snapshot-rebuild'],
    sourceDefinitions: [
      {
        sourceKey: 'zhidiantong_stock_stream',
        label: '库存总表',
        description: '智店通 库存 -> 库存流水 导出，作为库存/出入库统一入口。',
        preferredFiles: [
          'artifacts/manual/zhidiantong-stock-stream-YYYY-MM-DD.xlsx',
          'artifacts/manual/库存流水-YYYY-MM-DD.xlsx',
        ],
        fallbackFiles: [
          'artifacts/manual/zhidiantong-sales-export-YYYY-MM-DD.xlsx',
          'artifacts/manual/zhidiantong-purchase-inbound-import-YYYY-MM-DD.json',
          'artifacts/manual/zhidiantong-other-outbound-YYYY-MM-DD.json',
        ],
        consumedBy: ['zhidiantong-sync-cycle'],
      },
    ],
    manualBackfillRules: [
      '库存流水缺 SN 时，只同步数量流水，SN/单据字段改走 serial overrides 或 SN库存订单补差。',
      '若库存总表缺失，必须显式记录本轮使用了销售/入库/其他出库拆分回退，不得记为总表同步完成。',
    ],
  },
  'quote-master-sync': {
    name: 'quote-master-sync',
    label: '报价总表统一同步',
    description: '依次消费分销报价总表、灰渠原文/截图、京东/联想手工价格批次，并统一生成待复核计划与零售区快照。',
    taskSequence: ['daily-price-channel-check', 'daily-gray-channel-check', 'daily-jd-lenovo-price-sync'],
    sourceDefinitions: [
      {
        sourceKey: 'distributor_quote_master',
        label: '报价总表',
        description: '分销群/报价总表原始文件，由解析器映射到 sku。',
        preferredFiles: [
          'artifacts/latest-distributor-quotes.json',
          'artifacts/manual/distributor-quotes-YYYY-MM-DD.*',
        ],
        consumedBy: ['daily-price-channel-check'],
      },
      {
        sourceKey: 'gray_channel_raw',
        label: '灰渠原文',
        description: '灰渠公众号当天原文、截图或整理文本。',
        preferredFiles: [
          'artifacts/manual/gray-wholesale-YYYY-MM-DD.txt',
          'artifacts/manual/gray-wholesale-YYYY-MM-DD.md',
        ],
        consumedBy: ['daily-gray-channel-check'],
      },
      {
        sourceKey: 'manual_marketplace_batch',
        label: '零售价手工批次',
        description: 'Chrome 人工复核后落地的京东/联想价格批次 JSON。',
        preferredFiles: [
          'artifacts/manual/manual-price-supplements-YYYYMMDD-*.json',
        ],
        consumedBy: ['daily-jd-lenovo-price-sync'],
      },
    ],
    manualBackfillRules: [
      '灰渠沿用旧值只能记为 carry forward，不能记为新采集完成。',
      '京东/联想没有手工批次时，本轮只能输出待采清单和 blocked 项，不得伪造实时价格完成态。',
    ],
  },
  'full-daily-sync': {
    name: 'full-daily-sync',
    label: '全量日更编排',
    description: '串行执行库存总表同步、报价总表同步、保修补录，形成完整的本地日更闭环。',
    taskSequence: [
      'zhidiantong-sync-cycle',
      'daily-price-channel-check',
      'daily-gray-channel-check',
      'daily-jd-lenovo-price-sync',
      'sn-warranty-backfill',
      'daily-audit-and-snapshot-rebuild',
    ],
    sourceDefinitions: [
      {
        sourceKey: 'zhidiantong_stock_stream',
        label: '库存总表',
        description: '库存流水总表优先，拆分导入为回退。',
        preferredFiles: ['artifacts/manual/zhidiantong-stock-stream-YYYY-MM-DD.xlsx'],
        fallbackFiles: [
          'artifacts/manual/zhidiantong-sales-export-YYYY-MM-DD.xlsx',
          'artifacts/manual/zhidiantong-purchase-inbound-import-YYYY-MM-DD.json',
          'artifacts/manual/zhidiantong-other-outbound-YYYY-MM-DD.json',
        ],
        consumedBy: ['zhidiantong-sync-cycle'],
      },
      {
        sourceKey: 'quote_master',
        label: '报价总表',
        description: '分销报价、灰渠原文、京东/联想手工批次的组合输入。',
        preferredFiles: [
          'artifacts/latest-distributor-quotes.json',
          'artifacts/manual/gray-wholesale-YYYY-MM-DD.txt',
          'artifacts/manual/manual-price-supplements-YYYYMMDD-*.json',
        ],
        consumedBy: ['daily-price-channel-check', 'daily-gray-channel-check', 'daily-jd-lenovo-price-sync'],
      },
    ],
    manualBackfillRules: [
      '库存、报价、保修三条链路都要留下原始文件或截图路径，不能只留最终 JSON。',
      '任一来源 blocked 时，失败队列必须保留 suggestedAction 和 evidencePaths，供人工补差闭环。',
    ],
  },
}

const localSyncReportDir = path.resolve(config.lenovoRetail.artifactDir, 'local-sync-runs')
const localSyncLatestReportPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-local-sync-report.json')
const localSyncLatestIndexPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-local-sync-index.json')
const localSyncFailureQueuePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-local-sync-failure-queue.json')
const localSyncWebLatestReportPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-local-sync-report.json')
const localSyncWebLatestIndexPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-local-sync-index.json')
const localSyncWebFailureQueuePath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-local-sync-failure-queue.json')

function getTimestampKey(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

async function writeFileAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, filePath)
}

function getRunId(pipeline: LocalSyncPipelineName) {
  return `local-sync-${pipeline}-${getTimestampKey()}`
}

function normalizeFailureDetail(task: ScheduledTaskReport, warning: string) {
  if (warning.includes('沿用')) return 'warning'
  if (warning.includes('等待') || warning.includes('未发现') || warning.includes('未找到')) return 'blocked'
  return task.status === 'failed' ? 'failed' : 'warning'
}

function inferSuggestedAction(taskName: ScheduledTaskName, detail: string) {
  if (/blocked_page_risk|登录失效|验证码|403|滑块|安全验证|白页|转圈|短信验证码|二次认证/i.test(detail)) {
    if (taskName.startsWith('zhidiantong-sync')) {
      return '只在当前默认 Chrome 已登录会话处理智店通：等待确认 -> 刷新一次 -> 返回上一级重进 -> 重新筛当天日期查询；若被动跳登录页，按“打开登录页 -> 输入 15637798222 -> 下一步 -> 点一次密码输入区域 -> 选择浏览器已保存密码候选 -> 确认登录”恢复一次；短信验证码、二次认证、滑块或安全验证立即 blocked_page_risk 并飞书提醒用户处理。'
    }
    if (taskName === 'daily-price-channel-check' || taskName === 'daily-gray-channel-check') {
      return '网页微信只允许当前默认 Chrome 会话；出现登录失效、二维码、白页、入口异常或验证时，立即 blocked_page_risk 并飞书提醒用户在当前会话恢复，禁止新开浏览器/Profile。'
    }
    if (taskName === 'daily-jd-lenovo-price-sync' || taskName === 'daily-competitor-monitor-check') {
      return '京东/联想官网/天猫淘宝只允许当前默认 Chrome 会话；出现登录失效、403、验证码、滑块或安全验证时，立即 blocked_page_risk 并飞书提醒用户在当前会话恢复，禁止新开浏览器/Profile。'
    }
    if (taskName === 'sn-warranty-backfill') {
      return '联想保修页只允许当前默认 Chrome 会话；出现登录失效、验证码或安全验证时，立即 blocked_page_risk 并飞书提醒用户在当前会话恢复，禁止新开浏览器/Profile。'
    }
  }
  if (taskName.startsWith('zhidiantong-sync')) {
    if (detail.includes('库存流水')) return '先确认 OpenClaw SQL 主链是否已具备当日记录并已同步前端；若主链已就绪，仅补齐教育补代扫与金额/导出证据并重跑 zhidiantong-sync-cycle；若主链缺失，再按完整链路补齐导出源数据。'
    return '先走 SQL 主链核对（当日销售出库、采购入库、其他出库、调拨、库存、SN 是否已在 SQL 与前端映射）；仅在 SQL 主链缺失时再补齐导出文件并重跑 zhidiantong-sync-cycle。'
  }
  if (taskName === 'daily-gray-channel-check') {
    return '补当天灰渠原文或截图文本，再重跑灰渠报价任务；沿用旧值只能视为兜底。'
  }
  if (taskName === 'daily-jd-lenovo-price-sync') {
    return '使用 Chrome 现有稳定会话完成手工复核，并生成 manual-price-supplements-YYYYMMDD-*.json 批次文件。'
  }
  if (taskName === 'daily-price-channel-check') {
    return '确认分销报价总表原始文件已落地并可解析，再重跑报价总表同步。'
  }
  if (taskName === 'sn-warranty-backfill') {
    return '验证码或失败项进入人工队列，补查后再重跑保修补录。'
  }
  return '根据失败步骤补齐原始文件或证据后重跑。'
}

function collectManualFollowUps(report: ScheduledTaskReport) {
  return report.warnings.map((warning) => inferSuggestedAction(report.taskName, warning))
}

function toTaskSummary(report: ScheduledTaskReport): LocalSyncTaskSummary {
  return {
    taskName: report.taskName,
    status: report.status,
    reportPath: report.artifacts.reportPath,
    warnings: report.warnings,
    evidencePaths: report.artifacts.evidencePaths,
  }
}

function buildFailureQueueItems(
  pipeline: LocalSyncPipelineName,
  reports: ScheduledTaskReport[],
): LocalSyncFailureQueueItem[] {
  const items: LocalSyncFailureQueueItem[] = []
  for (const report of reports) {
    for (const warning of report.warnings) {
      items.push({
        id: `${pipeline}-${report.taskName}-${items.length + 1}`,
        pipeline,
        taskName: report.taskName,
        severity: normalizeFailureDetail(report, warning) as LocalSyncFailureQueueItem['severity'],
        detail: warning,
        suggestedAction: inferSuggestedAction(report.taskName, warning),
        evidencePaths: report.artifacts.evidencePaths,
        createdAt: report.finishedAt,
      })
    }
    for (const step of report.steps.filter((item) => item.status === 'failed')) {
      items.push({
        id: `${pipeline}-${report.taskName}-${step.step}-${items.length + 1}`,
        pipeline,
        taskName: report.taskName,
        severity: 'failed',
        step: step.step,
        detail: step.detail ?? '步骤失败。',
        suggestedAction: inferSuggestedAction(report.taskName, step.detail ?? step.step),
        evidencePaths: [...(step.files ?? []), ...report.artifacts.evidencePaths],
        createdAt: report.finishedAt,
      })
    }
  }
  return items
}

async function saveFailureQueue(items: LocalSyncFailureQueueItem[]) {
  const payload = {
    generatedAt: new Date().toISOString(),
    total: items.length,
    items,
  }
  await Promise.all([
    writeFileAtomic(localSyncFailureQueuePath, `${JSON.stringify(payload, null, 2)}\n`),
    writeFileAtomic(localSyncWebFailureQueuePath, `${JSON.stringify(payload, null, 2)}\n`),
  ])
  return payload
}

export function listLocalSyncPipelines() {
  return localSyncPipelineNames.map((name) => localSyncDefinitions[name])
}

export async function runLocalSyncPipeline(
  pipeline: LocalSyncPipelineName,
  options: LocalSyncOptions = {},
): Promise<LocalSyncRunReport> {
  const definition = localSyncDefinitions[pipeline]
  if (!definition) throw new Error(`未知本地同步管线: ${pipeline}`)

  const runId = getRunId(pipeline)
  const generatedAt = new Date().toISOString()
  const reportPath = path.join(localSyncReportDir, pipeline, `${runId}.json`)

  if (options.dryRun) {
    const dryRunReport: LocalSyncRunReport = {
      runId,
      pipeline,
      trigger: options.trigger ?? 'cli',
      operator: options.operator,
      dryRun: true,
      generatedAt,
      finishedAt: generatedAt,
      status: 'dry_run',
      taskSequence: definition.taskSequence,
      sourceDefinitions: definition.sourceDefinitions,
      taskReports: [],
      evidencePaths: [],
      failureQueue: {
        total: 0,
        path: localSyncFailureQueuePath,
        webPath: localSyncWebFailureQueuePath,
        items: [],
      },
      manualFollowUps: definition.manualBackfillRules,
      notes: [definition.description],
      artifacts: {
        reportPath,
        latestReportPath: localSyncLatestReportPath,
        latestIndexPath: localSyncLatestIndexPath,
      },
    }
    await writeLocalSyncReport(dryRunReport)
    return dryRunReport
  }

  const taskReports: ScheduledTaskReport[] = []
  for (const taskName of definition.taskSequence) {
    taskReports.push(await runScheduledTask(taskName))
  }

  const failureQueuePayload = await saveFailureQueue(buildFailureQueueItems(pipeline, taskReports))
  const evidencePaths = [...new Set(taskReports.flatMap((item) => item.artifacts.evidencePaths))]
  const manualFollowUps = [...new Set([
    ...definition.manualBackfillRules,
    ...taskReports.flatMap(collectManualFollowUps),
  ])]
  const status: LocalSyncStatus = taskReports.some((item) => item.status === 'failed')
    ? 'failed'
    : taskReports.some((item) => item.status === 'completed_with_warnings')
      ? 'completed_with_warnings'
      : 'completed'

  const finalReport: LocalSyncRunReport = {
    runId,
    pipeline,
    trigger: options.trigger ?? 'cli',
    operator: options.operator,
    dryRun: false,
    generatedAt,
    finishedAt: new Date().toISOString(),
    status,
    taskSequence: definition.taskSequence,
    sourceDefinitions: definition.sourceDefinitions,
    taskReports: taskReports.map(toTaskSummary),
    evidencePaths,
    failureQueue: {
      total: failureQueuePayload.total,
      path: localSyncFailureQueuePath,
      webPath: localSyncWebFailureQueuePath,
      items: failureQueuePayload.items,
    },
    manualFollowUps,
    notes: [definition.description],
    artifacts: {
      reportPath,
      latestReportPath: localSyncLatestReportPath,
      latestIndexPath: localSyncLatestIndexPath,
    },
  }
  await writeLocalSyncReport(finalReport)
  return finalReport
}

async function writeLocalSyncReport(report: LocalSyncRunReport) {
  const previousIndex = await fs.readFile(localSyncLatestIndexPath, 'utf-8')
    .then((content) => JSON.parse(content) as LocalSyncLatestIndex)
    .catch(() => ({ generatedAt: report.finishedAt, latestByPipeline: {} as LocalSyncLatestIndex['latestByPipeline'] }))

  const nextIndex: LocalSyncLatestIndex = {
    generatedAt: report.finishedAt,
    latestByPipeline: {
      ...previousIndex.latestByPipeline,
      [report.pipeline]: report,
    },
  }

  await Promise.all([
    writeFileAtomic(report.artifacts.reportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFileAtomic(localSyncLatestReportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFileAtomic(localSyncLatestIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`),
    writeFileAtomic(localSyncWebLatestReportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFileAtomic(localSyncWebLatestIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`),
  ])
}
