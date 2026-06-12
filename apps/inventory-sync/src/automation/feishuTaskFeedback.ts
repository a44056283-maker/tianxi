import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { ScheduledTaskWatchdogSnapshot } from './scheduledTaskWatchdog.js'
import type { ScheduledTaskReport } from './scheduledTasks.js'

type RetailZoneSnapshot = {
  generatedAt?: string
  decisions?: {
    items?: RetailDecisionItem[]
  }
}

type RetailDecisionItem = {
  skuKey?: string
  productName?: string
  pnMtm?: string
  category?: string
  currentStock?: number
  sellableStock?: number
  recommendedPreSubsidyPrice?: number
  regularChannelSubsidyPrice?: number
  fullServiceSubsidyPrice?: number
  platformSubsidyPrice?: number
  defensiveLowSubsidyPrice?: number
  jdPrice?: number
  lenovoOfficialPrice?: number
  taobaoPrice?: number
}

type CompetitorMonitorSnapshot = {
  generatedAt?: string
  quoteDate?: string
  isCarriedForward?: boolean
  itemCount?: number
  completenessAudit?: {
    status?: 'complete' | 'incomplete'
    expectedTotalCount?: number
    actualItemCount?: number
    missingItemCount?: number
    incompleteItemCount?: number
    staleItemCount?: number
    missingBucketCount?: number
    missingBrandCount?: number
    blockers?: string[]
  }
  brands?: Array<{
    brand: string
    itemCount?: number
    latestCapturedAt?: string
    items?: CompetitorMonitorItem[]
  }>
}

type CompetitorMonitorItem = {
  brand?: string
  rank?: number
  productName?: string
  configSummary?: string
  salesVolumeText?: string
  jdSelfPrice?: number
  jdPreSubsidyPrice?: number
  jdSubsidyPrice?: number
  keepCustomerSubsidyPrice?: number
  jdUrl?: string
  activityNotes?: string[]
}

type MarketingBoostSnapshot = {
  generatedAt?: string
  quoteDate?: string
  eligibleInventory?: MarketingBoostEligibleInventoryItem[]
}

type MarketingBoostEligibleInventoryItem = {
  skuKey?: string
  productName?: string
  pnMtm?: string
  currentStock?: number
  boostAmount?: number
  educationDiscountAmount?: number
  validTo?: string
}

type FeishuPostResult = {
  enabled: boolean
  ok: boolean
  sentAt: string
  messageType: 'scheduled_task_report' | 'watchdog' | 'daily_inventory_price_broadcast' | 'daily_competitor_broadcast'
  title: string
  statusCode?: number
  feishuCode?: number
  feishuMessage?: string
  error?: string
}

const latestFeedbackPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-feishu-task-feedback.json')
const feedbackLogPath = path.resolve(config.lenovoRetail.artifactDir, 'feishu-task-feedback-runs.jsonl')
const retailZonePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-retail-zone-snapshot.json')
const competitorMonitorPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-competitor-monitor.json')
const marketingBoostPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-marketing-boost-snapshot.json')

function resolveWebhookUrl(raw?: string) {
  const value = raw?.trim()
  if (!value) return undefined
  if (/^https?:\/\//i.test(value)) return value
  return `https://open.feishu.cn/open-apis/bot/v2/hook/${value}`
}

function sign(timestamp: string, secret?: string) {
  if (!secret?.trim()) return undefined
  return crypto
    .createHmac('sha256', `${timestamp}\n${secret}`)
    .update('')
    .digest('base64')
}

function localTime(isoText?: string) {
  if (!isoText) return '-'
  const date = new Date(isoText)
  if (!Number.isFinite(date.getTime())) return isoText
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function statusTone(report: ScheduledTaskReport) {
  if (report.status === 'failed' || report.executionOutcome === 'blocked_page_risk') return 'red'
  if (report.executionOutcome === 'blocked_missing_input') return 'orange'
  if (report.executionOutcome === 'executed_not_closed' || report.manualActionRequired) return 'yellow'
  return 'green'
}

function watchdogTone(snapshot: ScheduledTaskWatchdogSnapshot) {
  if (snapshot.summary.missedCount > 0) return 'red'
  if (snapshot.summary.attentionCount > 0) return 'yellow'
  return 'green'
}

function textElement(content: string) {
  return {
    tag: 'div',
    text: {
      tag: 'lark_md',
      content,
    },
  }
}

function linkText(label: string, url?: string) {
  if (!url) return label
  return `[${label}](${url})`
}

function priceText(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-'
  return `￥${Math.round(value).toLocaleString('zh-CN')}`
}

function precisePriceText(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-'
  return `￥${value.toLocaleString('zh-CN', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function diffDays(from?: string, to?: string) {
  if (!from || !to) return undefined
  const left = new Date(from)
  const right = new Date(to)
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return undefined
  left.setHours(0, 0, 0, 0)
  right.setHours(0, 0, 0, 0)
  return Math.round((right.getTime() - left.getTime()) / 86400000)
}

async function readJsonIfExists<T>(filePath: string) {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined)
}

function isComputerInventoryItem(item: RetailDecisionItem) {
  const text = `${item.category ?? ''} ${item.productName ?? ''}`
  if (/(配件|手机|平板|保护膜|钢化膜|保护夹|键盘|鼠标|耳机|音箱|显示器|打印机|智能生活)/.test(text)) return false
  return /(轻薄笔记本|游戏笔记本|商务台式|游戏主机|一体机|台式|主机|笔记本|GeekPro|天逸510S|Legion|Lecoo|小新|ThinkBook|ThinkPad)/i.test(text)
}

function chunkLines(lines: string[], maxChars = 6200) {
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line
    if (next.length > maxChars && current) {
      chunks.push(current)
      current = line
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function field(short: boolean, content: string) {
  return {
    is_short: short,
    text: {
      tag: 'lark_md',
      content,
    },
  }
}

function buildManualRecoveryHint(taskName: string, blockingReason?: string) {
  const text = `${taskName} ${blockingReason ?? ''}`
  if (/智店通|retail-pos/i.test(text)) {
    return '智店通转圈/白页时：先关闭异常目标页，回首页点登录；如要求输入手机号，只输入 15637798222；如弹出已保存密码候选，只点候选密码；如出现短信验证码，请用户手动登录。'
  }
  if (/京东|jd|403|滑块|验证码|安全验证/i.test(text)) {
    return '京东出现登录失效、403、滑块、验证码或安全验证时，停止当前路径，并提醒用户手动重新登录或完成人机验证后再继续。'
  }
  if (/联想官网|联想商城|shop\\.lenovo|item\\.lenovo/i.test(text)) {
    return '联想官网/商城出现登录失效或安全验证时，停止当前路径，并提醒用户手动重新登录或验证后再继续。'
  }
  if (/天猫|淘宝|tmall|taobao/i.test(text)) {
    return '天猫/淘宝出现登录失效、验证码或安全验证时，停止当前路径，并提醒用户手动重新登录或验证后再继续。'
  }
  if (/微信|localhost:3001|公众号|群报价/i.test(text)) {
    return '网页微信出现登录失效、验证码、白页或文件入口异常时，停止当前路径，并提醒用户手动重新登录或验证后再继续。'
  }
  return reportLikePageRisk(text)
    ? '当前任务遇到登录失效、验证码、403、滑块或安全验证，请用户手动重新登录或完成人机验证后再继续。'
    : undefined
}

function reportLikePageRisk(text: string) {
  return /blocked_page_risk|登录|验证码|403|滑块|安全验证|短信|二次认证|白页|转圈/i.test(text)
}

function buildReportCard(report: ScheduledTaskReport) {
  const title = `定时任务反馈：${report.taskName}`
  const reason = report.blockingReason || report.warnings[0] || '无'
  const recoveryHint = buildManualRecoveryHint(report.taskName, report.executionOutcome === 'blocked_page_risk' ? reason : undefined)
  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: title,
        },
        template: statusTone(report),
      },
      elements: [
        {
          tag: 'column_set',
          flex_mode: 'stretch',
          background_style: 'grey',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [textElement(`**状态**\n${report.status}`)],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [textElement(`**业务结果**\n${report.executionOutcome}`)],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [textElement(`**人工介入**\n${report.manualActionRequired ? '需要' : '不需要'}`)],
            },
          ],
        },
        {
          tag: 'hr',
        },
        {
          tag: 'div',
          fields: [
            field(true, `**完成时间**\n${localTime(report.finishedAt)}`),
            field(true, `**耗时**\n${Math.round(report.durationMs / 1000)} 秒`),
            field(true, `**新增记录**\n${report.metrics.newRecordCount}`),
            field(true, `**更新记录**\n${report.metrics.updatedRecordCount}`),
            field(true, `**缺链**\n${report.metrics.missingLinkCount}`),
            field(true, `**缺价**\n${report.metrics.missingPriceCount}`),
            field(true, `**保修待补**\n${report.metrics.missingWarrantyCount}`),
            field(true, `**前端刷新**\n${report.metrics.frontendRefreshed ? '是' : '否'}`),
          ],
        },
        textElement(`**收口说明**\n${reason}`),
        ...(recoveryHint ? [textElement(`**处理提示**\n${recoveryHint}`)] : []),
        textElement(`**播报群**\n${config.feishuTaskFeedback.groupName}`),
      ],
    },
  }
}

function buildWatchdogCard(snapshot: ScheduledTaskWatchdogSnapshot) {
  const title = `定时任务巡检：漏跑 ${snapshot.summary.missedCount} / 关注 ${snapshot.summary.attentionCount}`
  const risky = snapshot.checks
    .filter((item) => item.status === 'missed' || item.status === 'attention')
    .slice(0, 8)
  const automationAudit = snapshot.automationAudit
  const automationLines = automationAudit?.issues
    .slice(0, 8)
    .map((item) => `- ${item.name}（${item.id}）：${item.detail}`)
    ?? []
  const hints = [...new Set(risky
    .map((item) => buildManualRecoveryHint(item.taskName, item.blockingReason ?? item.reason))
    .filter(Boolean))]
  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: title,
        },
        template: watchdogTone(snapshot),
      },
      elements: [
        {
          tag: 'div',
          fields: [
            field(true, `**检查总数**\n${snapshot.summary.totalCheckCount}`),
            field(true, `**正常**\n${snapshot.summary.okCount}`),
            field(true, `**待窗口**\n${snapshot.summary.pendingCount}`),
            field(true, `**漏跑**\n${snapshot.summary.missedCount}`),
            field(true, `**关注**\n${snapshot.summary.attentionCount}`),
            field(true, `**生成时间**\n${localTime(snapshot.generatedAt)}`),
          ],
        },
        ...(automationAudit ? [
          {
            tag: 'div',
            fields: [
              field(true, `**期望 ACTIVE**\n${automationAudit.expectedActiveCount}`),
              field(true, `**实际 ACTIVE**\n${automationAudit.actualActiveCount}`),
              field(true, `**缺失自动化**\n${automationAudit.missingAutomationIds.length}`),
              field(true, `**非 ACTIVE**\n${automationAudit.nonActiveAutomationIds.length}`),
              field(true, `**缺退出禁令**\n${automationAudit.missingExitGuardIds.length}`),
              field(true, `**缺飞书反馈**\n${automationAudit.missingFeishuGuardIds.length}`),
            ],
          },
        ] : []),
        {
          tag: 'hr',
        },
        textElement(risky.length
          ? `**需要处理**\n${risky.map((item) => `- ${item.status === 'missed' ? '漏跑' : '关注'}：${item.title}，${item.reason}${item.blockingReason ? `；${item.blockingReason}` : ''}`).join('\n')}`
          : '**需要处理**\n无'),
        ...(automationAudit
          ? [textElement(automationLines.length
            ? `**自动化保活审计**\n${automationLines.join('\n')}`
            : `**自动化保活审计**\n期望 ACTIVE ${automationAudit.expectedActiveCount} 个，实际 ACTIVE ${automationAudit.actualActiveCount} 个，未发现缺失、降级或缺规则任务。`)]
          : []),
        ...(hints.length ? [textElement(`**处理提示**\n${hints.map((item) => `- ${item}`).join('\n')}`)] : []),
        textElement(`**播报群**\n${config.feishuTaskFeedback.groupName}`),
      ],
    },
  }
}

function buildMarketingExpiryWarningSummary(snapshot?: MarketingBoostSnapshot) {
  const today = todayDateString()
  const rows = (snapshot?.eligibleInventory ?? [])
    .map((item) => {
      const daysRemaining = diffDays(today, item.validTo)
      const currentStock = Number(item.currentStock ?? 0)
      if (daysRemaining === undefined || daysRemaining < 0 || daysRemaining > 7 || currentStock <= 0) return undefined
      const projectedBoostAmount = Number(((item.boostAmount ?? 0) * currentStock).toFixed(2))
      const projectedEducationAmount = Number(((item.educationDiscountAmount ?? 0) * currentStock).toFixed(2))
      return {
        skuKey: item.skuKey ?? '-',
        productName: item.productName ?? '-',
        pnMtm: item.pnMtm ?? '-',
        currentStock,
        daysRemaining,
        projectedBoostAmount,
        projectedEducationAmount,
        projectedTotalAmount: Number((projectedBoostAmount + projectedEducationAmount).toFixed(2)),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => (
      left.daysRemaining - right.daysRemaining
      || right.projectedTotalAmount - left.projectedTotalAmount
      || right.currentStock - left.currentStock
    ))

  const summarise = (items: typeof rows) => ({
    skuCount: items.length,
    stock: items.reduce((sum, item) => sum + item.currentStock, 0),
    boostAmount: Number(items.reduce((sum, item) => sum + item.projectedBoostAmount, 0).toFixed(2)),
    educationAmount: Number(items.reduce((sum, item) => sum + item.projectedEducationAmount, 0).toFixed(2)),
    totalAmount: Number(items.reduce((sum, item) => sum + item.projectedTotalAmount, 0).toFixed(2)),
  })

  return {
    total: summarise(rows),
    today: summarise(rows.filter((item) => item.daysRemaining === 0)),
    within3Days: summarise(rows.filter((item) => item.daysRemaining <= 3)),
    within7Days: summarise(rows.filter((item) => item.daysRemaining <= 7)),
    topRows: rows.slice(0, 5),
  }
}

function buildInventoryPriceBroadcastCards(snapshot: RetailZoneSnapshot, marketingWarningSummary?: ReturnType<typeof buildMarketingExpiryWarningSummary>) {
  const items = (snapshot.decisions?.items ?? [])
    .filter((item) => Number(item.currentStock ?? 0) > 0)
    .filter(isComputerInventoryItem)
    .sort((left, right) => String(left.category ?? '').localeCompare(String(right.category ?? ''), 'zh-CN') || String(left.productName ?? '').localeCompare(String(right.productName ?? ''), 'zh-CN'))
  const totalStock = items.reduce((sum, item) => sum + Number(item.currentStock ?? 0), 0)
  const totalSellable = items.reduce((sum, item) => sum + Number(item.sellableStock ?? item.currentStock ?? 0), 0)
  const categoryMap = new Map<string, RetailDecisionItem[]>()
  for (const item of items) {
    const category = item.category || '未分类电脑'
    categoryMap.set(category, [...(categoryMap.get(category) ?? []), item])
  }

  const lines = [...categoryMap.entries()].flatMap(([category, rows]) => {
    const header = `**${category}**（${rows.length} SKU / 库存 ${rows.reduce((sum, item) => sum + Number(item.currentStock ?? 0), 0)}）`
    const details = rows.map((item) => {
      const retailPrice = item.recommendedPreSubsidyPrice
      const subsidyPrice = item.regularChannelSubsidyPrice ?? item.fullServiceSubsidyPrice ?? item.platformSubsidyPrice
      return `- ${item.productName ?? '-'}\n  SKU ${item.skuKey ?? '-'} · PN-MTM ${item.pnMtm ?? '-'} · 库存 ${item.currentStock ?? 0} / 可售 ${item.sellableStock ?? item.currentStock ?? 0} · 门店零售价 ${priceText(retailPrice)} · 国补价 ${precisePriceText(subsidyPrice)}`
    })
    return [header, ...details]
  })

  const chunks = chunkLines(lines)
  return (chunks.length ? chunks : ['无在库电脑产品']).map((content, index) => ({
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: chunks.length > 1
            ? `每日电脑库存价格播报 ${index + 1}/${chunks.length}`
            : '每日电脑库存价格播报',
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            field(true, `**电脑SKU**\n${items.length}`),
            field(true, `**当前库存**\n${totalStock}`),
            field(true, `**可售库存**\n${totalSellable}`),
            field(true, `**快照时间**\n${localTime(snapshot.generatedAt)}`),
          ],
        },
        {
          tag: 'hr',
        },
        ...(index === 0 && marketingWarningSummary ? [
          textElement(
            [
              `**7日到期预警**`,
              `- 今日截止：${marketingWarningSummary.today.skuCount} 个SKU / 库存 ${marketingWarningSummary.today.stock} / 预估损失 ${precisePriceText(marketingWarningSummary.today.totalAmount)}`,
              `- 3日内：${marketingWarningSummary.within3Days.skuCount} 个SKU / 库存 ${marketingWarningSummary.within3Days.stock} / 预估损失 ${precisePriceText(marketingWarningSummary.within3Days.totalAmount)}`,
              `- 7日内：${marketingWarningSummary.within7Days.skuCount} 个SKU / 库存 ${marketingWarningSummary.within7Days.stock} / 预估损失 ${precisePriceText(marketingWarningSummary.within7Days.totalAmount)}`,
              `- 待申请营销PO：${precisePriceText(marketingWarningSummary.total.boostAmount)} · 待申请教育补：${precisePriceText(marketingWarningSummary.total.educationAmount)} · 总预估损失：${precisePriceText(marketingWarningSummary.total.totalAmount)}`,
              ...(
                marketingWarningSummary.topRows.length
                  ? ['- 重点SKU：', ...marketingWarningSummary.topRows.map((item) => `  - ${item.productName} · ${item.pnMtm} · 库存 ${item.currentStock} · ${item.daysRemaining === 0 ? '今天截止' : `${item.daysRemaining} 天内到期`} · 损失 ${precisePriceText(item.projectedTotalAmount)}`)]
                  : ['- 当前没有命中 7 日内到期且仍有库存的活动。']
              ),
            ].join('\n'),
          ),
          {
            tag: 'hr',
          },
        ] : []),
        textElement(content),
      ],
    },
  }))
}

function buildCompetitorBroadcastCards(snapshot: CompetitorMonitorSnapshot) {
  const brands = snapshot.brands ?? []
  const audit = snapshot.completenessAudit
  const isComplete = audit?.status === 'complete'
  const buildBrandLines = (selectedBrands: typeof brands) => selectedBrands.flatMap((brand) => {
    const rows = [...(brand.items ?? [])].sort((left, right) => Number(left.rank ?? 0) - Number(right.rank ?? 0))
    const header = `**${brand.brand}**（${rows.length} 款）`
    const details = rows.map((item) => {
      const price = item.jdPreSubsidyPrice ?? item.jdSelfPrice
      const activity = item.activityNotes?.[0] ? ` · 活动 ${item.activityNotes[0]}` : ''
      const configText = item.configSummary ? `\n  配置 ${item.configSummary}` : ''
      return `- TOP ${item.rank ?? '-'} ${linkText(item.productName ?? '-', item.jdUrl)}${configText}\n  国补前 ${priceText(price)} · 国补后 ${precisePriceText(item.jdSubsidyPrice)}${item.keepCustomerSubsidyPrice ? ` · 留客 ${precisePriceText(item.keepCustomerSubsidyPrice)}` : ''}${item.salesVolumeText ? ` · ${item.salesVolumeText}` : ''}${activity}`
    })
    return [header, ...details]
  })
  const buildCard = (title: string, content: string, index: number, count: number, template = snapshot.isCarriedForward || !isComplete ? 'yellow' : 'blue') => ({
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: count > 1 ? `${title} ${index + 1}/${count}` : title,
        },
        template,
      },
      elements: [
        {
          tag: 'div',
          fields: [
            field(true, `**报价日期**\n${snapshot.quoteDate ?? '-'}`),
            field(true, `**竞品总数**\n${snapshot.itemCount ?? brands.reduce((sum, item) => sum + Number(item.itemCount ?? item.items?.length ?? 0), 0)} / ${audit?.expectedTotalCount ?? '-'}`),
            field(true, `**品牌数**\n${brands.length}`),
            field(true, `**完成状态**\n${isComplete ? '已完整收口' : '未收口'}`),
          ],
        },
        {
          tag: 'hr',
        },
        ...(!isComplete && audit?.blockers?.length ? [textElement(`未收口原因：${audit.blockers.join(' ')}`)] : []),
        textElement(content),
      ],
    },
  })

  const lenovoBrands = brands.filter((brand) => brand.brand === '联想京东自营')
  const competitorBrands = brands.filter((brand) => brand.brand !== '联想京东自营')
  const cards: ReturnType<typeof buildCard>[] = []

  const lenovoChunks = chunkLines(buildBrandLines(lenovoBrands))
  lenovoChunks.forEach((content, index) => {
    cards.push(buildCard('京东联想自营排行（轻薄/游戏/平板）', content, index, lenovoChunks.length, isComplete ? 'blue' : 'yellow'))
  })

  const competitorLines = buildBrandLines(competitorBrands)
  const competitorChunks = chunkLines(competitorLines.length ? competitorLines : ['无竞品记录'])
  competitorChunks.forEach((content, index) => {
    cards.push(buildCard('竞品产品播报', content, index, competitorChunks.length))
  })
  return cards
}

async function writeFeedbackResult(result: FeishuPostResult) {
  await fs.mkdir(path.dirname(latestFeedbackPath), { recursive: true })
  await Promise.all([
    fs.writeFile(latestFeedbackPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8'),
    fs.appendFile(feedbackLogPath, `${JSON.stringify(result)}\n`, 'utf-8'),
  ])
}

async function postFeishuCard(payload: unknown, title: string, messageType: FeishuPostResult['messageType']) {
  const webhookUrl = resolveWebhookUrl(config.feishuTaskFeedback.webhookUrl)
  const sentAt = new Date().toISOString()
  if (!config.feishuTaskFeedback.enabled || !webhookUrl) {
    const result = {
      enabled: config.feishuTaskFeedback.enabled,
      ok: false,
      sentAt,
      messageType,
      title,
      error: webhookUrl ? 'feishu task feedback disabled' : 'missing feishu webhook url',
    }
    await writeFeedbackResult(result)
    return result
  }

  const timestamp = String(Math.floor(Date.now() / 1000))
  const signedPayload = {
    timestamp,
    sign: sign(timestamp, config.feishuTaskFeedback.botSecret),
    ...(payload as Record<string, unknown>),
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(signedPayload),
    })
    const responseText = await response.text().catch(() => '')
    const body = responseText ? JSON.parse(responseText) as { code?: number; StatusCode?: number; msg?: string; message?: string; StatusMessage?: string } : undefined
    const feishuCode = body?.code ?? body?.StatusCode
    const feishuMessage = body?.msg ?? body?.message ?? body?.StatusMessage
    const bodyOk = feishuCode === undefined || feishuCode === 0
    const result = {
      enabled: true,
      ok: response.ok && bodyOk,
      sentAt,
      messageType,
      title,
      statusCode: response.status,
      feishuCode,
      feishuMessage,
      error: response.ok && bodyOk ? undefined : responseText.slice(0, 500),
    }
    await writeFeedbackResult(result)
    return result
  } catch (error) {
    const result = {
      enabled: true,
      ok: false,
      sentAt,
      messageType,
      title,
      error: error instanceof Error ? error.message : String(error),
    }
    await writeFeedbackResult(result)
    return result
  }
}

export async function sendScheduledTaskReportCard(report: ScheduledTaskReport) {
  const payload = buildReportCard(report)
  return postFeishuCard(payload, `定时任务反馈：${report.taskName}`, 'scheduled_task_report')
}

export async function sendScheduledTaskWatchdogCard(snapshot: ScheduledTaskWatchdogSnapshot) {
  const payload = buildWatchdogCard(snapshot)
  return postFeishuCard(payload, '定时任务巡检', 'watchdog')
}

export async function sendDailyInventoryPriceBroadcast() {
  const snapshot = await readJsonIfExists<RetailZoneSnapshot>(retailZonePath)
  const marketingSnapshot = await readJsonIfExists<MarketingBoostSnapshot>(marketingBoostPath)
  if (!snapshot) {
    return postFeishuCard({
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: '每日电脑库存价格播报失败' }, template: 'red' },
        elements: [textElement(`未读取到 ${retailZonePath}`)],
      },
    }, '每日电脑库存价格播报失败', 'daily_inventory_price_broadcast')
  }
  const cards = buildInventoryPriceBroadcastCards(snapshot, buildMarketingExpiryWarningSummary(marketingSnapshot))
  const results = []
  for (let index = 0; index < cards.length; index += 1) {
    results.push(await postFeishuCard(cards[index], `每日电脑库存价格播报 ${index + 1}/${cards.length}`, 'daily_inventory_price_broadcast'))
  }
  return {
    enabled: config.feishuTaskFeedback.enabled,
    ok: results.every((item) => item.ok),
    sentAt: new Date().toISOString(),
    messageType: 'daily_inventory_price_broadcast' as const,
    title: '每日电脑库存价格播报',
    cardCount: results.length,
    results,
  }
}

export async function sendDailyCompetitorBroadcast() {
  const snapshot = await readJsonIfExists<CompetitorMonitorSnapshot>(competitorMonitorPath)
  if (!snapshot) {
    return postFeishuCard({
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: '竞品产品播报失败' }, template: 'red' },
        elements: [textElement(`未读取到 ${competitorMonitorPath}`)],
      },
    }, '竞品产品播报失败', 'daily_competitor_broadcast')
  }
  const cards = buildCompetitorBroadcastCards(snapshot)
  const results = []
  for (let index = 0; index < cards.length; index += 1) {
    const cardTitle = cards[index]?.card?.header?.title?.content ?? `竞品产品播报 ${index + 1}/${cards.length}`
    results.push(await postFeishuCard(cards[index], cardTitle, 'daily_competitor_broadcast'))
  }
  return {
    enabled: config.feishuTaskFeedback.enabled,
    ok: results.every((item) => item.ok),
    sentAt: new Date().toISOString(),
    messageType: 'daily_competitor_broadcast' as const,
    title: '竞品产品播报',
    cardCount: results.length,
    results,
  }
}
