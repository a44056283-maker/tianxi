import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { ScheduledTaskName } from './scheduledTasks.js'
import { sendScheduledTaskWatchdogCard } from './feishuTaskFeedback.js'

type TaskExecutionOutcome =
  | 'real_completed'
  | 'executed_not_closed'
  | 'blocked_missing_input'
  | 'blocked_page_risk'

type ScheduledTaskReport = {
  taskName: ScheduledTaskName
  executedAt: string
  finishedAt: string
  status: 'completed' | 'completed_with_warnings' | 'failed'
  executionOutcome: TaskExecutionOutcome
  manualActionRequired: boolean
  blockingReason?: string
}

type LatestTaskReportIndex = Partial<Record<ScheduledTaskName, ScheduledTaskReport>>

const TASK_REPORT_ALIASES: Partial<Record<ScheduledTaskName, string[]>> = {}

type WatchdogRule =
  | {
      id: string
      type: 'daily_checkpoint'
      taskName: ScheduledTaskName
      title: string
      dueHour: number
      dueMinute: number
      windowStartHour: number
      windowStartMinute: number
      skipIfAnyRealCompletedToday?: boolean
    }
  | {
      id: string
      type: 'interval_freshness'
      taskName: ScheduledTaskName
      title: string
      intervalMinutes: number
      graceMinutes: number
      activeStartHour: number
      activeEndHour: number
    }

type WatchdogCheckStatus = 'ok' | 'pending_window' | 'missed' | 'attention'

type WatchdogCheck = {
  id: string
  taskName: ScheduledTaskName
  title: string
  status: WatchdogCheckStatus
  reason: string
  dueAt?: string
  expectedSince?: string
  latestFinishedAt?: string
  latestExecutionOutcome?: TaskExecutionOutcome
  manualActionRequired?: boolean
  blockingReason?: string
}

type AutomationPayloadDefinition = {
  id: string
  name?: string
  status?: string
}

type AutomationAuditIssueType =
  | 'missing_file'
  | 'not_active'
  | 'missing_exit_guard'
  | 'missing_feishu_guard'

type AutomationAuditIssue = {
  id: string
  name: string
  type: AutomationAuditIssueType
  detail: string
  filePath: string
}

type AutomationAudit = {
  ok: boolean
  expectedActiveCount: number
  actualActiveCount: number
  expectedSourcePath: string
  automationsRootPath: string
  missingAutomationIds: string[]
  nonActiveAutomationIds: string[]
  missingExitGuardIds: string[]
  missingFeishuGuardIds: string[]
  issues: AutomationAuditIssue[]
}

export type ScheduledTaskWatchdogSnapshot = {
  generatedAt: string
  timezone: string
  summary: {
    totalCheckCount: number
    okCount: number
    pendingCount: number
    missedCount: number
    attentionCount: number
    notify: boolean
  }
  checks: WatchdogCheck[]
  notifications: string[]
  automationAudit?: AutomationAudit
}

const latestReportsPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-scheduled-task-reports.json')
const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-scheduled-task-watchdog.json')
const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-scheduled-task-watchdog.json')
const automationPayloadPath = path.resolve(config.appDir, '../../../automation_payloads.json')
const automationRootPath = path.resolve(process.env.HOME ?? '/Users/luxiangnan', '.codex/automations')

const WATCHDOG_RULES: WatchdogRule[] = [
  {
    id: 'daily-jd-lenovo-price-sync-hourly',
    type: 'interval_freshness',
    taskName: 'daily-jd-lenovo-price-sync',
    title: '京东联想价格同步编排',
    intervalMinutes: 60,
    graceMinutes: 15,
    activeStartHour: 10,
    activeEndHour: 22,
  },
  {
    id: 'daily-price-channel-check-am',
    type: 'daily_checkpoint',
    taskName: 'daily-price-channel-check',
    title: '分销商群报价检查-上午',
    dueHour: 12,
    dueMinute: 5,
    windowStartHour: 11,
    windowStartMinute: 55,
  },
  {
    id: 'daily-price-channel-check-noon',
    type: 'daily_checkpoint',
    taskName: 'daily-price-channel-check',
    title: '分销商群报价补查-中午',
    dueHour: 13,
    dueMinute: 55,
    windowStartHour: 13,
    windowStartMinute: 45,
    skipIfAnyRealCompletedToday: true,
  },
  {
    id: 'daily-gray-channel-check-am',
    type: 'daily_checkpoint',
    taskName: 'daily-gray-channel-check',
    title: '灰渠公众号报价检查-午前',
    dueHour: 12,
    dueMinute: 5,
    windowStartHour: 11,
    windowStartMinute: 50,
  },
  {
    id: 'daily-gray-channel-check-pm',
    type: 'daily_checkpoint',
    taskName: 'daily-gray-channel-check',
    title: '灰渠公众号报价补查-午后',
    dueHour: 14,
    dueMinute: 0,
    windowStartHour: 13,
    windowStartMinute: 50,
    skipIfAnyRealCompletedToday: true,
  },
  {
    id: 'daily-competitor-monitor-check',
    type: 'daily_checkpoint',
    taskName: 'daily-competitor-monitor-check',
    title: '竞品监控-4点更新',
    dueHour: 4,
    dueMinute: 20,
    windowStartHour: 4,
    windowStartMinute: 0,
  },
  {
    id: 'zhidiantong-sync-30m',
    type: 'interval_freshness',
    taskName: 'zhidiantong-sync-cycle',
    title: '智店通进销存30分钟同步',
    intervalMinutes: 30,
    graceMinutes: 10,
    activeStartHour: 10,
    activeEndHour: 22,
  },
  {
    id: 'sync-health-spot-check-irregular',
    type: 'interval_freshness',
    taskName: 'sync-health-spot-check',
    title: '同步动作不定时抽检',
    intervalMinutes: 75,
    graceMinutes: 20,
    activeStartHour: 10,
    activeEndHour: 22,
  },
  {
    id: 'sn-warranty-backfill-12',
    type: 'daily_checkpoint',
    taskName: 'sn-warranty-backfill',
    title: 'SN保修补齐-12点后',
    dueHour: 12,
    dueMinute: 25,
    windowStartHour: 12,
    windowStartMinute: 20,
  },
  {
    id: 'sn-warranty-backfill-15',
    type: 'daily_checkpoint',
    taskName: 'sn-warranty-backfill',
    title: 'SN保修补齐-15点后',
    dueHour: 15,
    dueMinute: 25,
    windowStartHour: 15,
    windowStartMinute: 20,
  },
  {
    id: 'sn-warranty-backfill-19',
    type: 'daily_checkpoint',
    taskName: 'sn-warranty-backfill',
    title: 'SN保修补齐-19点后',
    dueHour: 19,
    dueMinute: 25,
    windowStartHour: 19,
    windowStartMinute: 20,
  },
  {
    id: 'daily-audit-and-snapshot-rebuild',
    type: 'daily_checkpoint',
    taskName: 'daily-audit-and-snapshot-rebuild',
    title: '每日审计与快照重建',
    dueHour: 19,
    dueMinute: 40,
    windowStartHour: 19,
    windowStartMinute: 35,
  },
]

function toLocalDate(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
}

function withTime(base: Date, hour: number, minute: number) {
  const local = toLocalDate(base)
  local.setHours(hour, minute, 0, 0)
  return local
}

function isoString(date: Date) {
  return date.toISOString()
}

function sameLocalDay(a: Date, b: Date) {
  const aLocal = toLocalDate(a)
  const bLocal = toLocalDate(b)
  return aLocal.getFullYear() === bLocal.getFullYear()
    && aLocal.getMonth() === bLocal.getMonth()
    && aLocal.getDate() === bLocal.getDate()
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined)
}

async function writeFileAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, filePath)
}

async function listAutomationTomlPaths(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => [])
  const paths: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      paths.push(...await listAutomationTomlPaths(entryPath))
      continue
    }
    if (entry.isFile() && entry.name === 'automation.toml') {
      paths.push(entryPath)
    }
  }
  return paths
}

async function buildAutomationAudit(): Promise<AutomationAudit> {
  const expectedDefinitions = (await readJsonIfExists<AutomationPayloadDefinition[]>(automationPayloadPath)) ?? []
  const expectedActiveDefinitions = expectedDefinitions.filter((item) => item.status === 'ACTIVE')
  const tomlPaths = await listAutomationTomlPaths(automationRootPath)
  const activeFlags = await Promise.all(
    tomlPaths.map(async (filePath) => {
      const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
      return content.includes('status = "ACTIVE"') ? 1 : 0
    }),
  )
  const actualActiveCount = activeFlags.reduce<number>((sum, item) => sum + item, 0)

  const missingAutomationIds: string[] = []
  const nonActiveAutomationIds: string[] = []
  const missingExitGuardIds: string[] = []
  const missingFeishuGuardIds: string[] = []
  const issues: AutomationAuditIssue[] = []

  for (const definition of expectedActiveDefinitions) {
    const filePath = path.resolve(automationRootPath, definition.id, 'automation.toml')
    const content = await fs.readFile(filePath, 'utf-8').catch(() => undefined)
    const name = definition.name?.trim() || definition.id

    if (!content) {
      missingAutomationIds.push(definition.id)
      issues.push({
        id: definition.id,
        name,
        type: 'missing_file',
        detail: '未找到 automation.toml，自动化可能掉线、被移走或未加载到 UI 索引。',
        filePath,
      })
      continue
    }

    if (!content.includes('status = "ACTIVE"')) {
      nonActiveAutomationIds.push(definition.id)
      issues.push({
        id: definition.id,
        name,
        type: 'not_active',
        detail: 'automation.toml 存在，但状态不是 ACTIVE。',
        filePath,
      })
    }

    if (!content.includes('自动化保活与退出禁令')) {
      missingExitGuardIds.push(definition.id)
      issues.push({
        id: definition.id,
        name,
        type: 'missing_exit_guard',
        detail: '缺少“自动化保活与退出禁令”硬规则。',
        filePath,
      })
    }

    if (!content.includes('飞书群反馈')) {
      missingFeishuGuardIds.push(definition.id)
      issues.push({
        id: definition.id,
        name,
        type: 'missing_feishu_guard',
        detail: '缺少“未收口/异常必须飞书群反馈”硬规则。',
        filePath,
      })
    }
  }

  return {
    ok: (
      missingAutomationIds.length === 0
      && nonActiveAutomationIds.length === 0
      && missingExitGuardIds.length === 0
      && missingFeishuGuardIds.length === 0
      && actualActiveCount === expectedActiveDefinitions.length
    ),
    expectedActiveCount: expectedActiveDefinitions.length,
    actualActiveCount,
    expectedSourcePath: automationPayloadPath,
    automationsRootPath: automationRootPath,
    missingAutomationIds,
    nonActiveAutomationIds,
    missingExitGuardIds,
    missingFeishuGuardIds,
    issues,
  }
}

function pickLatestReport(reports: Array<ScheduledTaskReport | undefined>) {
  return reports
    .filter((report): report is ScheduledTaskReport => Boolean(report?.finishedAt))
    .sort((left, right) => new Date(right.finishedAt).getTime() - new Date(left.finishedAt).getTime())[0]
}

function resolveTaskReport(
  latestReports: LatestTaskReportIndex,
  taskName: ScheduledTaskName,
) {
  const aliases = TASK_REPORT_ALIASES[taskName] ?? []
  return pickLatestReport([
    latestReports[taskName],
    ...aliases.map((alias) => (latestReports as Record<string, ScheduledTaskReport | undefined>)[alias]),
  ])
}

function evaluateDailyCheckpoint(
  rule: Extract<WatchdogRule, { type: 'daily_checkpoint' }>,
  report: ScheduledTaskReport | undefined,
  now: Date,
) {
  const dueAt = withTime(now, rule.dueHour, rule.dueMinute)
  const expectedSince = withTime(now, rule.windowStartHour, rule.windowStartMinute)
  const latestFinishedAt = report?.finishedAt ? new Date(report.finishedAt) : undefined

  if (now < dueAt) {
    return {
      status: 'pending_window' as const,
      reason: `当前还未到检查时点，计划于 ${dueAt.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })} 前完成。`,
      dueAt: isoString(dueAt),
      expectedSince: isoString(expectedSince),
    }
  }

  if (rule.skipIfAnyRealCompletedToday && report?.executionOutcome === 'real_completed' && latestFinishedAt && sameLocalDay(latestFinishedAt, now)) {
    return {
      status: 'ok' as const,
      reason: '今天前序轮次已真实完成，本检查点按规则不再强制补跑。',
      dueAt: isoString(dueAt),
      expectedSince: isoString(expectedSince),
      latestFinishedAt: report.finishedAt,
      latestExecutionOutcome: report.executionOutcome,
      manualActionRequired: report.manualActionRequired,
      blockingReason: report.blockingReason,
    }
  }

  if (!latestFinishedAt || latestFinishedAt < expectedSince) {
    return {
      status: 'missed' as const,
      reason: '已过应执行时间，但最新报告不存在或未覆盖本检查窗口。',
      dueAt: isoString(dueAt),
      expectedSince: isoString(expectedSince),
      latestFinishedAt: report?.finishedAt,
      latestExecutionOutcome: report?.executionOutcome,
      manualActionRequired: report?.manualActionRequired,
      blockingReason: report?.blockingReason,
    }
  }

  if (report?.executionOutcome !== 'real_completed') {
    return {
      status: 'attention' as const,
      reason: `本检查窗口已执行，但业务状态仍为 ${report?.executionOutcome ?? 'unknown'}。`,
      dueAt: isoString(dueAt),
      expectedSince: isoString(expectedSince),
      latestFinishedAt: report?.finishedAt,
      latestExecutionOutcome: report?.executionOutcome,
      manualActionRequired: report?.manualActionRequired,
      blockingReason: report?.blockingReason,
    }
  }

  return {
    status: 'ok' as const,
    reason: '本检查窗口已按时生成真实完成报告。',
    dueAt: isoString(dueAt),
    expectedSince: isoString(expectedSince),
    latestFinishedAt: report.finishedAt,
    latestExecutionOutcome: report.executionOutcome,
    manualActionRequired: report.manualActionRequired,
    blockingReason: report.blockingReason,
  }
}

function evaluateIntervalFreshness(
  rule: Extract<WatchdogRule, { type: 'interval_freshness' }>,
  report: ScheduledTaskReport | undefined,
  now: Date,
) {
  const hour = toLocalDate(now).getHours()
  if (hour < rule.activeStartHour || hour > rule.activeEndHour) {
    return {
      status: 'pending_window' as const,
      reason: '当前不在本任务的活跃轮扫时段内。',
    }
  }

  if (!report?.finishedAt) {
    return {
      status: 'missed' as const,
      reason: '活跃轮扫时段内未发现任何最新报告。',
    }
  }

  const latestFinishedAt = new Date(report.finishedAt)
  const ageMinutes = Math.floor((now.getTime() - latestFinishedAt.getTime()) / 60000)
  const maxAge = rule.intervalMinutes + rule.graceMinutes
  if (ageMinutes > maxAge) {
    return {
      status: 'missed' as const,
      reason: `最新报告距今 ${ageMinutes} 分钟，已超过 ${maxAge} 分钟阈值。`,
      latestFinishedAt: report.finishedAt,
      latestExecutionOutcome: report.executionOutcome,
      manualActionRequired: report.manualActionRequired,
      blockingReason: report.blockingReason,
    }
  }

  if (report.executionOutcome !== 'real_completed') {
    return {
      status: 'attention' as const,
      reason: `最近一轮已执行，但业务状态仍为 ${report.executionOutcome}。`,
      latestFinishedAt: report.finishedAt,
      latestExecutionOutcome: report.executionOutcome,
      manualActionRequired: report.manualActionRequired,
      blockingReason: report.blockingReason,
    }
  }

  return {
    status: 'ok' as const,
    reason: `最近一轮报告新鲜度正常，距今 ${ageMinutes} 分钟。`,
    latestFinishedAt: report.finishedAt,
    latestExecutionOutcome: report.executionOutcome,
    manualActionRequired: report.manualActionRequired,
    blockingReason: report.blockingReason,
  }
}

export async function buildScheduledTaskWatchdogSnapshot(nowInput = new Date()) {
  const now = toLocalDate(nowInput)
  const latestReports = (await readJsonIfExists<LatestTaskReportIndex>(latestReportsPath)) ?? {}
  const automationAudit = await buildAutomationAudit()

  const checks: WatchdogCheck[] = WATCHDOG_RULES.map((rule) => {
    const report = resolveTaskReport(latestReports, rule.taskName)
    const evaluated = rule.type === 'daily_checkpoint'
      ? evaluateDailyCheckpoint(rule, report, now)
      : evaluateIntervalFreshness(rule, report, now)

    return {
      id: rule.id,
      taskName: rule.taskName,
      title: rule.title,
      ...evaluated,
    }
  })

  const missedChecks = checks.filter((item) => item.status === 'missed')
  const attentionChecks = checks.filter((item) => item.status === 'attention')
  const notifications = [
    ...missedChecks.map((item) => `[漏跑] ${item.title}: ${item.reason}`),
    ...(automationAudit.ok
      ? []
      : [
          `[自动化保活] 期望 ACTIVE ${automationAudit.expectedActiveCount} 个，当前发现 ACTIVE ${automationAudit.actualActiveCount} 个；缺失 ${automationAudit.missingAutomationIds.length} 个，非 ACTIVE ${automationAudit.nonActiveAutomationIds.length} 个，缺退出禁令 ${automationAudit.missingExitGuardIds.length} 个，缺飞书反馈规则 ${automationAudit.missingFeishuGuardIds.length} 个。`,
        ]),
  ]

  const snapshot: ScheduledTaskWatchdogSnapshot = {
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    summary: {
      totalCheckCount: checks.length,
      okCount: checks.filter((item) => item.status === 'ok').length,
      pendingCount: checks.filter((item) => item.status === 'pending_window').length,
      missedCount: missedChecks.length,
      attentionCount: attentionChecks.length,
      notify: missedChecks.length > 0 || !automationAudit.ok,
    },
    checks,
    notifications,
    automationAudit,
  }

  return snapshot
}

export async function saveScheduledTaskWatchdogSnapshot(snapshot: ScheduledTaskWatchdogSnapshot) {
  await Promise.all([
    writeFileAtomic(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`),
    writeFileAtomic(webPath, `${JSON.stringify(snapshot, null, 2)}\n`),
  ])

  if (snapshot.summary.notify || snapshot.summary.attentionCount > 0) {
    await sendScheduledTaskWatchdogCard(snapshot)
  }

  return {
    artifactPath,
    webPath,
    snapshot,
  }
}

export async function runScheduledTaskWatchdog(nowInput = new Date()) {
  const snapshot = await buildScheduledTaskWatchdogSnapshot(nowInput)
  return saveScheduledTaskWatchdogSnapshot(snapshot)
}
