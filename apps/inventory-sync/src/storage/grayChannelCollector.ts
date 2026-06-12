import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { GrayWholesaleQuote, GrayWholesaleSnapshot } from './grayWholesaleQuoteParser.js'

/**
 * 灰渠公众号报价采集器
 *
 * 功能：整理 Chrome 已登录 https://localhost:3001/ 网页微信中取得的公众号「郑州市创业」市场批发报价证据
 * 入口：文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部菜单日期报价按钮（如"5.07报价"）
 *
 * 采集策略：
 * 1. 只复用 Chrome 已登录的 https://localhost:3001/ 网页微信可见会话
 * 2. 通过截图/OCR/人工整理文本识别报价文章内容
 * 3. 解析提取产品名称和价格
 * 4. 复用现有的 grayWholesaleQuoteParser 进行结构化处理
 */

export type GrayChannelCollectionTarget = {
  accountName: string
  accountId: string
  menuButtonText: string  // 如 "5.07报价"
  entryPoint: string
}

export type GrayChannelCollectionResult = {
  status: 'success' | 'carry_forward' | 'blocked' | 'failed'
  reason?: string
  rawText?: string
  sourceFile?: string
  quoteDate?: string
  capturedAt: string
  evidencePaths: string[]
}

export type GrayChannelCollectionBundle = {
  generatedAt: string
  triggerTaskName?: string
  runner: {
    provider: 'retired-visible-chrome-only'
    baseUrl: string
    model: string
    headless: boolean
    maxSteps: number
  }
  target: GrayChannelCollectionTarget
  prompt: string
}

// 灰渠公众号目标配置
const GRAY_CHANNEL_TARGET: GrayChannelCollectionTarget = {
  accountName: '郑州市创业',
  accountId: 'zzcskj',
  menuButtonText: '', // 动态日期，如 "5.07报价"
  entryPoint: '文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部日期报价按钮',
}

function getTodayMenuButtonText(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  return `${month}.${day}报价`
}

function buildGrayChannelCollectionPrompt(target: GrayChannelCollectionTarget): string {
  return [
    '你是联想智慧零售项目的灰渠公众号报价证据整理代理，不是外部页面采集器。',
    '',
    '任务：整理用户已在网页微信可见界面中取得的市场批发报价证据',
    `公众号名称：${target.accountName}`,
    `入口：文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部菜单的"${target.menuButtonText}"按钮`,
    '',
    '执行边界：',
    '1. 禁止脚本自动点击网页微信、禁止无头浏览器、禁止新浏览器 Profile、禁止高频点击。',
    '2. 真实入口是文件传输助手聊天记录区下方固定公众号入口；公众号文章、滚动和截图只能由当前已登录 Chrome 可见窗口低频手工完成。若执行记录仍指向收藏夹/收藏方块入口，视为旧流程残留，先修正规则再采集。',
    '3. 点击、滚动、打开文章之间必须自适应停顿；页面白屏、登录失效、二维码、验证码或卡顿时立即 blocked。',
    '4. 本任务只允许整理已经保存到本地的原文、截图 OCR 或人工复制文本。',
    '',
    '识别规则：',
    '- 产品名称通常包含：拯救者、小新、来酷、YOGA 等联想系列',
    '- 价格格式：通常在产品名称后面，如 "拯救者 Y9000P 2024 8999"',
    '- 过滤无效行：包含"冻晓永"、"价格以当时报价为准"等字样的行',
    '',
    '输出格式：',
    '请按以下格式输出，每行一条：',
    '产品名称1 价格1',
    '产品名称2 价格2',
    '...',
    '',
    '重要提示：',
    '- 如果遇到登录验证、验证码、403、白屏、网页微信掉线等问题，立即停止并返回 "blocked"',
    '- 如果找不到对应菜单按钮，返回 "not_found"',
    '- 禁止打开微信桌面版；禁止使用新浏览器 Profile；禁止绕过登录和安全限制；禁止脚本自动点击采集',
    '- 只能采集公开可见内容，不要尝试登录或绕过限制',
  ].join('\n')
}

function artifactPath(fileName: string): string {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string): string {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined)
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

/**
 * 构建灰渠采集任务包
 */
export async function buildGrayChannelCollectionBundle(triggerTaskName?: string): Promise<{
  bundle: GrayChannelCollectionBundle
  artifactPath: string
  webPath: string
}> {
  const target: GrayChannelCollectionTarget = {
    ...GRAY_CHANNEL_TARGET,
    menuButtonText: getTodayMenuButtonText(),
  }

  const bundle: GrayChannelCollectionBundle = {
    generatedAt: new Date().toISOString(),
    triggerTaskName,
    runner: {
      provider: 'retired-visible-chrome-only',
      baseUrl: 'not-used',
      model: 'not-used',
      headless: false,
      maxSteps: 0,
    },
    target,
    prompt: buildGrayChannelCollectionPrompt(target),
  }

  const bundleFileName = `gray-channel-collection-bundle-${Date.now()}.json`
  const artifact = artifactPath(bundleFileName)
  const web = webDataPath(bundleFileName)

  await Promise.all([writeJsonFile(artifact, bundle), writeJsonFile(web, bundle)])

  return { bundle, artifactPath: artifact, webPath: web }
}

/**
 * 从采集结果解析报价
 */
export function parseGrayChannelResult(
  rawText: string,
  capturedAt: string
): { quotes: GrayWholesaleQuote[]; quoteDate?: string } {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const quotes: GrayWholesaleQuote[] = []
  const datePattern = /(20\d{2})[-年.\/](\d{1,2})[-月.\/](\d{1,2})/
  let quoteDate: string | undefined

  for (const line of lines) {
    // 提取日期
    if (!quoteDate) {
      const dateMatch = line.match(datePattern)
      if (dateMatch) {
        const [, year, month, day] = dateMatch
        quoteDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
      }
    }

    // 过滤注释行
    if (/冻晓永|价格以当时报价为准|郑州创业科技|电脑报价|^\d{4}[-年]/.test(line)) {
      continue
    }

    // 提取价格
    const priceMatches = Array.from(line.matchAll(/(?:¥|￥)?\s*(\d{3,5})(?:\s*元)?(?=\s|$)/g))
    const priceMatch = priceMatches.at(-1)
    if (!priceMatch) continue

    const price = Number(priceMatch[1])
    if (!Number.isFinite(price) || price < 300) continue

    // 提取产品名称（去除价格部分）
    const productText = line
      .replace(priceMatch[0], '')
      .replace(/\s*创业\s*$/, '')
      .trim()

    if (productText.length < 4) continue

    // 检查是否支持的产品系列
    if (!/小新|拯救者|来酷|斗战者|YOGA|LEGION|[RY]\d{4}P?|战\d{4}/i.test(productText)) {
      continue
    }

    // 构建配置指纹
    const matchFingerprint = buildConfigFingerprint(productText)

    quotes.push({
      source: 'wechat-official-account',
      accountName: '郑州市创业',
      entryPoint: '文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部日期报价按钮',
      quoteDate: quoteDate || new Date().toISOString().slice(0, 10),
      capturedAt,
      productText,
      marketWholesalePrice: price,
      taxIncluded: false,
      serviceIncluded: false,
      matchFingerprint,
      evidenceText: line,
    })
  }

  return { quotes, quoteDate }
}

function normalizeConfigText(value?: string): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/酷睿|英特尔|INTEL/g, '')
    .replace(/锐龙|AMD/g, '')
    .replace(/集成显卡|集显|集\//g, '集')
    .replace(/固态|SSD/g, '')
    .replace(/RTX\s*/g, 'RTX')
    .replace(/GB/g, 'G')
    .replace(/1TB/g, '1T')
    .replace(/2TB/g, '2T')
}

function buildConfigFingerprint(value?: string): string {
  const text = normalizeConfigText(value)
  const tokens = new Set<string>()

  const addAll = (pattern: RegExp, mapper = (v: string) => v) => {
    for (const match of text.matchAll(pattern)) tokens.add(mapper(match[1] ?? match[0]))
  }
  const addGroup = (pattern: RegExp, groupIndex: number, mapper = (v: string) => v) => {
    for (const match of text.matchAll(pattern)) {
      const token = match[groupIndex]
      if (token) tokens.add(mapper(token))
    }
  }

  addAll(/(YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|GEEKPRO)/g, (value) =>
    value === 'LECOO' ? '来酷' : value === 'LEGION' ? '拯救者' : value
  )
  addAll(/([RY]\d{4}P?|战\d{4}|N\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[46]C)/g)
  addAll(/(?:RTX)?(3050|4060|4070|5060|5070|5070TI|5080|5090)/g)
  addAll(/(?:^|[^0-9])((?:8|12|16|24|32|64)G)/g)
  addGroup(
    /(?:ULTRA[579][-]?\d{0,4}[A-Z]*|CORE[3579][-]?\d{0,4}[A-Z]*|U[3579][-]?\d{0,4}[A-Z]*|I[3579][-]?\d{0,5}[A-Z]*|R[3579]-[A-Z]?\d{0,5}[A-Z]*)((?:8|12|16|24|32|64)G)/g,
    1
  )
  addAll(/(?:^|[^0-9])((?:128|256|512)G?|[12]T)/g, (value) =>
    /G$|T$/.test(value) ? value : `${value}G`
  )
  addAll(/(\d{2}(?:\.\d)?寸)/g)

  return Array.from(tokens).sort().join('|')
}

/**
 * 执行灰渠采集任务并保存结果
 */
export async function runGrayChannelCollection(
  triggerTaskName?: string
): Promise<{
  status: 'success' | 'carry_forward' | 'blocked' | 'failed'
  reason?: string
  quoteCount: number
  files: string[]
}> {
  const bundleResult = await buildGrayChannelCollectionBundle(triggerTaskName)
  const capturedAt = new Date().toISOString()

  // 真实采集必须走 Chrome https://localhost:3001/ 的可见网页微信会话；
  // MiniMax/browser-use 已退役，不再启动 browser-use 新浏览器，也不打开桌面微信。
  const previousPath = artifactPath('latest-gray-wholesale-quotes.json')
  const previous = await readJsonIfExists<GrayWholesaleSnapshot>(previousPath)

  return {
    status: previous ? 'carry_forward' : 'blocked',
    reason: previous
      ? `MiniMax/browser-use 已退役；灰渠公众号真实采集必须走已登录 Chrome 的 https://localhost:3001/ 可见网页微信会话。本轮无新人工证据，沿用 ${previous.quoteDate} 的报价。`
      : 'MiniMax/browser-use 已退役；灰渠公众号真实采集必须走已登录 Chrome 的 https://localhost:3001/ 可见网页微信会话。本轮无历史报价可沿用。',
    quoteCount: previous?.quoteCount ?? 0,
    files: [bundleResult.artifactPath],
  }
}

/**
 * 保存采集结果（用于手动模式）
 */
export async function saveGrayChannelSnapshot(
  rawText?: string,
  sourceFile?: string
): Promise<{
  artifactPath: string
  webPath: string
  snapshot: GrayWholesaleSnapshot
}> {
  const previousPath = artifactPath('latest-gray-wholesale-quotes.json')
  const previous = await readJsonIfExists<GrayWholesaleSnapshot>(previousPath)
  const capturedAt = new Date().toISOString()

  const { quotes, quoteDate } = rawText
    ? parseGrayChannelResult(rawText, capturedAt)
    : { quotes: [], quoteDate: undefined }

  const snapshot: GrayWholesaleSnapshot = quotes.length
    ? {
        generatedAt: capturedAt,
        accountName: '郑州市创业',
        entryPoint: '文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部日期报价按钮',
        quoteDate: quoteDate || quotes[0]?.quoteDate,
        isCarriedForward: false,
        quoteCount: quotes.length,
        quotes,
      }
    : {
        generatedAt: capturedAt,
        accountName: '郑州市创业',
        entryPoint: '文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部日期报价按钮',
        quoteDate: previous?.quoteDate,
        isCarriedForward: Boolean(previous),
        carryForwardFrom: previous?.quoteDate,
        quoteCount: previous?.quoteCount ?? 0,
        quotes: previous?.quotes ?? [],
      }

  const artifact = artifactPath('latest-gray-wholesale-quotes.json')
  const web = webDataPath('latest-gray-wholesale-quotes.json')

  await Promise.all([writeJsonFile(artifact, snapshot), writeJsonFile(web, snapshot)])

  return { artifactPath: artifact, webPath: web, snapshot }
}

// =====================================================================
// 2026-06-08: 灰渠公众号入口访问与采集计划强制流
// 把"准备计划 / 记录访问证据 / 落盘原文"拆为三步独立函数，调度层
// 缺任一步都会映射到独立的执行终态。前端 5174 可见状态卡。
// =====================================================================

export type GrayChannelCapturePlan = {
  generatedAt: string
  triggerTaskName?: string
  accountName: string
  accountId: string
  entryPoint: string
  todayMenuButtonText: string
  todayDateString: string
  steps: string[]
  artifacts: {
    rawTextName: string
    screenshotName: string
    visibleArticleName: string
  }
  blockerIfMissing: {
    noVisitEvidence: string
    noRawText: string
    staleArticleDate: string
  }
}

export type GrayChannelCapturePlanResult = {
  capturePlanPath: string
  webPath: string
  rawTextName: string
  screenshotName: string
  visibleArticleName: string
  todayDateString: string
}

function getTodayDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const VISIT_ARTICLE_DATE_PATTERN = /^(20\d{2})-(\d{2})-(\d{2})$/

export async function prepareGrayChannelCapturePlan(
  triggerTaskName?: string
): Promise<GrayChannelCapturePlanResult> {
  const today = getTodayDateString()
  const plan: GrayChannelCapturePlan = {
    generatedAt: new Date().toISOString(),
    triggerTaskName,
    accountName: '郑州市创业',
    accountId: 'zzcskj',
    entryPoint: '文件传输助手聊天记录区下方固定公众号入口 -> 公众号页最下面带日期的报价快捷入口',
    todayMenuButtonText: getTodayMenuButtonText(),
    todayDateString: today,
    steps: [
      '1. 打开 Chrome 已登录的 https://localhost:3001/ 网页微信，进入文件传输助手聊天记录区',
      '2. 点击聊天记录下方固定放置的「郑州市创业」公众号入口（不要搜索公众号名称）',
      '3. 点击公众号页最下面带日期的报价快捷入口（日期必须是当天或当前最新有效报价日期）',
      '4. 记录「最新可见文章日期」与「最后一次有效联想报价日期」到访问证据文件',
      '5. 落盘原文到 gray-wholesale-YYYY-MM-DD.txt + 截图到 gray-channel-screenshot-YYYY-MM-DD.png',
      '6. 运行 bash scripts/run_scheduled_task.sh daily-gray-channel-check',
    ],
    artifacts: {
      rawTextName: `gray-wholesale-${today}.txt`,
      screenshotName: `gray-channel-screenshot-${today}.png`,
      visibleArticleName: `gray-channel-visible-article-${today}.txt`,
    },
    blockerIfMissing: {
      noVisitEvidence: '灰渠公众号入口访问证据未记录，必须先在当前默认 Chrome 会话中进入公众号入口并落盘访问证据',
      noRawText: '灰渠公众号落盘原文未到，必须先把当天有效原文落盘到 manual/gray-wholesale-YYYY-MM-DD.txt',
      staleArticleDate: '灰渠公众号最新可见文章日期早于今天，正文无当天可写入联想正式快照的报价',
    },
  }

  const baseName = `gray-channel-capture-plan-${today}`
  const artifact = artifactPath(`${baseName}.json`)
  const web = webDataPath(`${baseName}.json`)
  await Promise.all([writeJsonFile(artifact, plan), writeJsonFile(web, plan)])

  return {
    capturePlanPath: artifact,
    webPath: web,
    rawTextName: plan.artifacts.rawTextName,
    screenshotName: plan.artifacts.screenshotName,
    visibleArticleName: plan.artifacts.visibleArticleName,
    todayDateString: today,
  }
}

export type GrayChannelVisitEvidenceResult = {
  evidencePath: string
  webPath: string
  latestVisibleArticleDate: string
  capturedAt: string
}

export async function recordGrayChannelVisitEvidence(options: {
  latestVisibleArticleDate: string
  triggerTaskName?: string
}): Promise<GrayChannelVisitEvidenceResult> {
  const { latestVisibleArticleDate } = options
  if (!VISIT_ARTICLE_DATE_PATTERN.test(latestVisibleArticleDate)) {
    throw new Error(`Invalid latest visible article date: ${latestVisibleArticleDate}; expected YYYY-MM-DD`)
  }
  const today = getTodayDateString()
  const fileName = `gray-channel-visible-article-${today}.txt`
  const artifact = artifactPath(fileName)
  const web = webDataPath(fileName)
  const capturedAt = new Date().toISOString()
  const content = [
    '# 灰渠公众号入口访问证据',
    `# 访问时间: ${capturedAt}`,
    `# 可见文章日期: ${latestVisibleArticleDate}`,
    `# 菜单按钮: ${getTodayMenuButtonText()}`,
    '# 入口: 文件传输助手聊天记录区下方固定公众号入口 -> 公众号页最下面带日期的报价快捷入口',
    '',
  ].join('\n')
  await fs.mkdir(path.dirname(artifact), { recursive: true })
  await Promise.all([fs.writeFile(artifact, content, 'utf-8'), fs.writeFile(web, content, 'utf-8')])
  return { evidencePath: artifact, webPath: web, latestVisibleArticleDate, capturedAt }
}
