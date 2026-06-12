import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { config } from '../config.js'
import { getLenovoWarrantyLookupUrl } from './lenovoWarrantyUrl.js'
import { buildWarrantyCheckQueue } from './warrantyCheckQueue.js'

type LenovoWarrantyStatus = 'success' | 'not_found' | 'captcha_required' | 'failed'

export type LenovoWarrantyRecord = {
  serialNumber: string
  skuKey: string
  productName: string
  pnMtm?: string
  officialLookupUrl: string
  status: LenovoWarrantyStatus
  checkedAt: string
  officialWarrantyStart?: string
  officialWarrantyEnd?: string
  servicePlan?: string
  officialProductName?: string
  evidenceScreenshotPath?: string
  evidenceTextPath?: string
  failureReason?: string
  rawTextExcerpt?: string
}

export type LenovoWarrantySnapshot = {
  generatedAt: string
  source: 'lenovo-official-warranty'
  total: number
  successCount: number
  notFoundCount: number
  captchaRequiredCount: number
  failedCount: number
  records: LenovoWarrantyRecord[]
}

export type LenovoWarrantyRunStats = {
  attemptedCount: number
  newSuccessCount: number
  newNotFoundCount: number
  newCaptchaRequiredCount: number
  newFailedCount: number
}

export type ManualWarrantyImportStats = {
  importedCount: number
  successCount: number
  notFoundCount: number
  failedCount: number
}

async function loadExistingWarrantySnapshot(): Promise<LenovoWarrantySnapshot | null> {
  const outputArtifactPath = artifactPath('latest-lenovo-warranty-snapshot.json')
  return fs.readFile(outputArtifactPath, 'utf-8')
    .then((content) => JSON.parse(content) as LenovoWarrantySnapshot)
    .catch(() => null)
}

function mergeWarrantyRecords(
  existingRecords: LenovoWarrantyRecord[],
  incomingRecords: LenovoWarrantyRecord[],
): LenovoWarrantyRecord[] {
  const bySerial = new Map(existingRecords.map((record) => [record.serialNumber, record]))
  for (const incoming of incomingRecords) {
    const existing = bySerial.get(incoming.serialNumber)
    if (!existing) {
      bySerial.set(incoming.serialNumber, incoming)
      continue
    }
    const keepExistingWarranty =
      Boolean(existing.officialWarrantyStart || existing.officialWarrantyEnd)
      && !incoming.officialWarrantyStart
      && !incoming.officialWarrantyEnd
      && incoming.status !== 'success'
    bySerial.set(incoming.serialNumber, {
      ...existing,
      ...incoming,
      officialWarrantyStart: keepExistingWarranty ? existing.officialWarrantyStart : (incoming.officialWarrantyStart || existing.officialWarrantyStart),
      officialWarrantyEnd: keepExistingWarranty ? existing.officialWarrantyEnd : (incoming.officialWarrantyEnd || existing.officialWarrantyEnd),
      servicePlan: incoming.servicePlan || existing.servicePlan,
      officialProductName: incoming.officialProductName || existing.officialProductName,
      evidenceScreenshotPath: incoming.evidenceScreenshotPath || existing.evidenceScreenshotPath,
      evidenceTextPath: incoming.evidenceTextPath || existing.evidenceTextPath,
      failureReason: incoming.status === 'success'
        ? undefined
        : (incoming.failureReason || existing.failureReason),
      rawTextExcerpt: incoming.rawTextExcerpt || existing.rawTextExcerpt,
      status: keepExistingWarranty ? existing.status : incoming.status,
      checkedAt: incoming.checkedAt || existing.checkedAt,
    })
  }
  return [...bySerial.values()].sort((left, right) => left.serialNumber.localeCompare(right.serialNumber))
}

function artifactPath(name: string) {
  return path.resolve(config.lenovoRetail.artifactDir, name)
}

function datedEvidencePath(serialNumber: string, extension: 'png' | 'txt') {
  const date = new Date().toISOString().slice(0, 10)
  const safeSn = serialNumber.replace(/[^a-z0-9_-]/gi, '_')
  return artifactPath(`warranty/${date}/${safeSn}.${extension}`)
}

function normalizeLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseManualWarrantyStatus(text: string): LenovoWarrantyStatus {
  if (/^officialWarranty(Start|End):\s*20\d{2}-\d{2}-\d{2}$/mi.test(text)) return 'success'
  if (/(未见|没有|无)(风控|验证码|滑块|安全验证)/.test(text)) return 'success'
  if (/验证码|滑块|安全验证|访问受限|captcha/i.test(text)) return 'captcha_required'
  if (/未查询到|没有查到|不存在|无效|暂无数据|抱歉，没有查到保修信息/i.test(text)) return 'not_found'
  if (/主要服务保修期|整机保修|保修服务信息|将在\d+天后结束/i.test(text)) return 'success'
  return 'failed'
}

function parseCheckedAtFromManualText(text: string) {
  const match = text.match(/checkedAt:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s+([0-9]{2}:[0-9]{2})\s*CST/i)
  if (!match) return undefined
  return `${match[1]}T${match[2]}:00+08:00`
}

function extractField(text: string, fieldName: string) {
  const match = text.match(new RegExp(`^${fieldName}:\\s*(.+)$`, 'mi'))
  return match?.[1]?.trim()
}

async function collectManualWarrantyRecordsForDate(date: string): Promise<LenovoWarrantyRecord[]> {
  const manualDir = artifactPath(`manual/warranty/${date}`)
  const entries = await fs.readdir(manualDir, { withFileTypes: true }).catch(() => [])
  const textFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .map((entry) => entry.name)
    .sort()
  const queueSnapshot = await buildWarrantyCheckQueue()
  const queueMap = new Map(queueSnapshot.items.map((item) => [item.serialNumber.trim().toUpperCase(), item]))
  const records: LenovoWarrantyRecord[] = []

  for (const fileName of textFiles) {
    const textPath = path.resolve(manualDir, fileName)
    const rawText = await fs.readFile(textPath, 'utf-8')
    const serialNumber = (extractField(rawText, 'serialNumber') ?? fileName.replace(/-not-found|-success|-failed/gi, '').replace(/\.txt$/i, '')).trim()
    if (!serialNumber) continue
    const queueItem = queueMap.get(serialNumber.toUpperCase())
    if (!queueItem) continue

    const checkedAt = parseCheckedAtFromManualText(rawText) ?? new Date().toISOString()
    const status = parseManualWarrantyStatus(rawText)
    const screenshotPath = textPath.replace(/\.txt$/i, '.png')
    const screenshotExists = await fs.access(screenshotPath).then(() => true).catch(() => false)
    const parsed = status === 'success' ? parseWarrantyText(rawText) : {}
    const visibleResult = extractField(rawText, 'visibleResult')

    records.push({
      serialNumber: queueItem.serialNumber,
      skuKey: queueItem.skuKey,
      productName: queueItem.productName,
      pnMtm: queueItem.pnMtm,
      officialLookupUrl: extractField(rawText, 'officialLookupUrl') ?? queueItem.officialLookupUrl,
      status,
      checkedAt,
      ...parsed,
      evidenceScreenshotPath: screenshotExists ? screenshotPath : undefined,
      evidenceTextPath: textPath,
      failureReason: status === 'not_found'
        ? (visibleResult || '官网未查询到该 SN 的售后记录。')
        : status === 'captcha_required'
          ? '官网触发验证码或安全验证，已保留当天手工证据。'
          : status === 'failed'
            ? (visibleResult || '当天手工证据未能解析出明确官网结果。')
            : undefined,
      rawTextExcerpt: rawText.slice(0, 500),
    })
  }

  return records
}

function parseChineseDate(value: string) {
  const match = value.match(/(20\d{2})[./年-](\d{1,2})[./月-](\d{1,2})/)
  if (!match) return undefined
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function parseWarrantyText(text: string) {
  const lines = normalizeLines(text)
  const resultIndex = lines.findIndex((line) => /联想服务>保修查询>查询结果|设备结果/.test(line))
  const productLine = resultIndex >= 0 ? lines.slice(resultIndex + 1).find((line) => !/更换其他设备|主机编号/.test(line)) : undefined
  const primaryRange = text.match(/主要服务保修期[：:\s]*\n*\s*(20\d{2}[./年-]\d{1,2}[./月-]\d{1,2})\s*[—-]\s*(20\d{2}[./年-]\d{1,2}[./月-]\d{1,2})/)
  const startLine = lines.find((line) => /保修.*(开始|起始)|服务.*(开始|起始)/.test(line))
  const endLine = lines.find((line) => /保修.*(结束|截止|到期)|服务.*(结束|截止|到期)/.test(line))
  const planLine = lines.find((line) => /主要服务保修期|整机保修|上门|送修/.test(line) && line.length <= 80)
  const allDates = Array.from(text.matchAll(/20\d{2}[./年-]\d{1,2}[./月-]\d{1,2}/g)).map((match) => parseChineseDate(match[0])).filter((value): value is string => Boolean(value))
  return {
    officialProductName: productLine,
    servicePlan: planLine ?? '主要服务保修期',
    officialWarrantyStart: parseChineseDate(primaryRange?.[1] ?? '') ?? parseChineseDate(startLine ?? '') ?? allDates[0],
    officialWarrantyEnd: parseChineseDate(primaryRange?.[2] ?? '') ?? parseChineseDate(endLine ?? '') ?? allDates.at(-1),
  }
}

async function collectOne(page: Page, item: { serialNumber: string; skuKey: string; productName: string; pnMtm?: string }): Promise<LenovoWarrantyRecord> {
  const checkedAt = new Date().toISOString()
  const officialLookupUrl = getLenovoWarrantyLookupUrl(item.serialNumber)
  const screenshotPath = datedEvidencePath(item.serialNumber, 'png')
  const textPath = datedEvidencePath(item.serialNumber, 'txt')
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true })

  try {
    await page.goto(officialLookupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1200)
    const text = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
    await fs.writeFile(textPath, text, 'utf-8')

    if (/验证码|滑块|安全验证|访问受限|captcha/i.test(text)) {
      return {
        ...item,
        officialLookupUrl,
        status: 'captcha_required',
        checkedAt,
        evidenceScreenshotPath: screenshotPath,
        evidenceTextPath: textPath,
        failureReason: '官网触发验证码或安全验证，已保留截图和页面文本。',
        rawTextExcerpt: text.slice(0, 500),
      }
    }

    const parsed = parseWarrantyText(text)
    const notFound = /未查询到|没有查到|不存在|无效|请确认.*序列号|暂无数据/.test(text)
    return {
      ...item,
      officialLookupUrl,
      status: notFound ? 'not_found' : 'success',
      checkedAt,
      ...parsed,
      evidenceScreenshotPath: screenshotPath,
      evidenceTextPath: textPath,
      failureReason: notFound ? '官网未查询到该 SN 的售后记录。' : undefined,
      rawTextExcerpt: text.slice(0, 500),
    }
  } catch (error) {
    return {
      ...item,
      officialLookupUrl,
      status: 'failed',
      checkedAt,
      evidenceScreenshotPath: screenshotPath,
      evidenceTextPath: textPath,
      failureReason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function collectLenovoWarrantySnapshot(): Promise<{ artifactPath: string; webPath: string; snapshot: LenovoWarrantySnapshot; runStats: LenovoWarrantyRunStats }> {
  const existingSnapshot = await loadExistingWarrantySnapshot()
  const queueSnapshot = await buildWarrantyCheckQueue()
  const queue = queueSnapshot.items
    .slice(0, config.lenovoWarranty.maxSerials)

  const browser = await chromium.launch({
    headless: config.lenovoWarranty.headless,
    slowMo: config.marketplaceBrowser.slowMoMs,
  })
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  const records: LenovoWarrantyRecord[] = []
  for (const item of queue) {
    const record = await collectOne(page, item)
    records.push(record)
    if (/Target page, context or browser has been closed/i.test(record.failureReason ?? '')) break
  }
  await browser.close()

  const mergedRecords = mergeWarrantyRecords(existingSnapshot?.records ?? [], records)
  const runStats: LenovoWarrantyRunStats = {
    attemptedCount: records.length,
    newSuccessCount: records.filter((record) => record.status === 'success').length,
    newNotFoundCount: records.filter((record) => record.status === 'not_found').length,
    newCaptchaRequiredCount: records.filter((record) => record.status === 'captcha_required').length,
    newFailedCount: records.filter((record) => record.status === 'failed').length,
  }
  const snapshot: LenovoWarrantySnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'lenovo-official-warranty',
    total: mergedRecords.length,
    successCount: mergedRecords.filter((record) => record.status === 'success').length,
    notFoundCount: mergedRecords.filter((record) => record.status === 'not_found').length,
    captchaRequiredCount: mergedRecords.filter((record) => record.status === 'captcha_required').length,
    failedCount: mergedRecords.filter((record) => record.status === 'failed').length,
    records: mergedRecords,
  }

  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })
  const content = JSON.stringify(snapshot, null, 2)
  const outputArtifactPath = artifactPath('latest-lenovo-warranty-snapshot.json')
  const webPath = path.resolve(webPublicDataDir, 'latest-lenovo-warranty-snapshot.json')
  await fs.writeFile(outputArtifactPath, content, 'utf-8')
  await fs.writeFile(webPath, content, 'utf-8')
  return { artifactPath: outputArtifactPath, webPath, snapshot, runStats }
}

export async function importManualLenovoWarrantyEvidence(date = new Date().toISOString().slice(0, 10)): Promise<{
  artifactPath: string
  webPath: string
  snapshot: LenovoWarrantySnapshot
  importStats: ManualWarrantyImportStats
}> {
  const existingSnapshot = await loadExistingWarrantySnapshot()
  const manualRecords = await collectManualWarrantyRecordsForDate(date)
  const mergedRecords = mergeWarrantyRecords(existingSnapshot?.records ?? [], manualRecords)
  const snapshot: LenovoWarrantySnapshot = {
    generatedAt: new Date().toISOString(),
    source: 'lenovo-official-warranty',
    total: mergedRecords.length,
    successCount: mergedRecords.filter((record) => record.status === 'success').length,
    notFoundCount: mergedRecords.filter((record) => record.status === 'not_found').length,
    captchaRequiredCount: mergedRecords.filter((record) => record.status === 'captcha_required').length,
    failedCount: mergedRecords.filter((record) => record.status === 'failed').length,
    records: mergedRecords,
  }

  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })
  const content = JSON.stringify(snapshot, null, 2)
  const outputArtifactPath = artifactPath('latest-lenovo-warranty-snapshot.json')
  const webPath = path.resolve(webPublicDataDir, 'latest-lenovo-warranty-snapshot.json')
  await fs.writeFile(outputArtifactPath, content, 'utf-8')
  await fs.writeFile(webPath, content, 'utf-8')

  return {
    artifactPath: outputArtifactPath,
    webPath,
    snapshot,
    importStats: {
      importedCount: manualRecords.length,
      successCount: manualRecords.filter((record) => record.status === 'success').length,
      notFoundCount: manualRecords.filter((record) => record.status === 'not_found').length,
      failedCount: manualRecords.filter((record) => record.status === 'failed' || record.status === 'captcha_required').length,
    },
  }
}
