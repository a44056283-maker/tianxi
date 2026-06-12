import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

type QuoteEvidenceSource = 'gray_wholesale' | 'distributor_group' | 'unknown'
type QuoteEvidenceKind = 'image' | 'text' | 'spreadsheet' | 'json' | 'other'

export type WechatQuoteEvidenceRecord = {
  source: QuoteEvidenceSource
  kind: QuoteEvidenceKind
  fileName: string
  filePath: string
  relativePath: string
  fileSize: number
  modifiedAt: string
  inferredDate?: string
}

export type WechatQuoteEvidenceSnapshot = {
  generatedAt: string
  rootPath: string
  total: number
  bySource: Record<QuoteEvidenceSource, number>
  byKind: Record<QuoteEvidenceKind, number>
  records: WechatQuoteEvidenceRecord[]
}

export type QuoteOcrQueueItem = {
  source: QuoteEvidenceSource
  imageFileName: string
  imagePath: string
  imageModifiedAt: string
  inferredDate?: string
  pairedTextPath?: string
  status: 'pending_ocr' | 'manual_text_exists'
  note: string
}

export type QuoteOcrQueueSnapshot = {
  generatedAt: string
  rootPath: string
  total: number
  pendingCount: number
  completedCount: number
  items: QuoteOcrQueueItem[]
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const TEXT_EXTENSIONS = new Set(['.txt', '.md'])
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv'])

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

function inferSource(fileName: string): QuoteEvidenceSource {
  const normalized = fileName.toLowerCase()
  if (
    normalized.includes('gray-wholesale')
    || normalized.includes('wechat_mp')
    || normalized.includes('公众号')
  ) return 'gray_wholesale'
  if (
    normalized.includes('distributor')
    || normalized.includes('分销')
    || normalized.includes('库存报价')
  ) return 'distributor_group'
  return 'unknown'
}

function inferKind(ext: string): QuoteEvidenceKind {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet'
  if (ext === '.json') return 'json'
  return 'other'
}

function inferDate(fileName: string) {
  const compact = fileName.match(/(20\d{2})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const dashed = fileName.match(/(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})/)
  if (!dashed) return undefined
  const [, year, month, day] = dashed
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

async function walkFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const filePath = path.resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(filePath, depth + 1))
    } else {
      files.push(filePath)
    }
  }
  return files
}

export async function buildWechatQuoteEvidenceSnapshot() {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const files = await walkFiles(manualDir)
  const records = await Promise.all(files.map(async (filePath) => {
    const stat = await fs.stat(filePath)
    const fileName = path.basename(filePath)
    const ext = path.extname(fileName).toLowerCase()
    return {
      source: inferSource(fileName),
      kind: inferKind(ext),
      fileName,
      filePath,
      relativePath: path.relative(manualDir, filePath),
      fileSize: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      inferredDate: inferDate(fileName),
    } satisfies WechatQuoteEvidenceRecord
  }))

  const bySource: Record<QuoteEvidenceSource, number> = {
    gray_wholesale: 0,
    distributor_group: 0,
    unknown: 0,
  }
  const byKind: Record<QuoteEvidenceKind, number> = {
    image: 0,
    text: 0,
    spreadsheet: 0,
    json: 0,
    other: 0,
  }
  for (const record of records) {
    bySource[record.source] += 1
    byKind[record.kind] += 1
  }

  const snapshot: WechatQuoteEvidenceSnapshot = {
    generatedAt: new Date().toISOString(),
    rootPath: manualDir,
    total: records.length,
    bySource,
    byKind,
    records: records.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
  }

  const content = JSON.stringify(snapshot, null, 2)
  const artifact = artifactPath('latest-wechat-quote-evidence.json')
  const web = webDataPath('latest-wechat-quote-evidence.json')
  await fs.mkdir(path.dirname(artifact), { recursive: true })
  await fs.mkdir(path.dirname(web), { recursive: true })
  await fs.writeFile(artifact, content, 'utf-8')
  await fs.writeFile(web, content, 'utf-8')

  return { artifactPath: artifact, webPath: web, snapshot }
}

export async function buildQuoteOcrQueueSnapshot() {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const files = await walkFiles(manualDir)
  const records = await Promise.all(files.map(async (filePath) => {
    const stat = await fs.stat(filePath)
    const fileName = path.basename(filePath)
    return {
      filePath,
      fileName,
      ext: path.extname(fileName).toLowerCase(),
      modifiedAt: stat.mtime.toISOString(),
      source: inferSource(fileName),
      inferredDate: inferDate(fileName),
    }
  }))

  const textRecords = records.filter((item) => TEXT_EXTENSIONS.has(item.ext))
  const images = records.filter((item) => IMAGE_EXTENSIONS.has(item.ext) && item.source !== 'unknown')

  const pairedText = (source: QuoteEvidenceSource, inferredDate?: string) => {
    const match = textRecords.find((item) => item.source === source && item.inferredDate && item.inferredDate === inferredDate)
    return match?.filePath
  }

  const items: QuoteOcrQueueItem[] = images.map((image) => {
    const pairedTextPath = pairedText(image.source, image.inferredDate)
    const status: QuoteOcrQueueItem['status'] = pairedTextPath ? 'manual_text_exists' : 'pending_ocr'
    return {
      source: image.source,
      imageFileName: image.fileName,
      imagePath: image.filePath,
      imageModifiedAt: image.modifiedAt,
      inferredDate: image.inferredDate,
      pairedTextPath,
      status,
      note: pairedTextPath
        ? '已存在同日期 manual 文本，可直接走文本解析。'
        : '当前无同日期 manual 文本；待 OCR 或人工转录。',
    }
  }).sort((a, b) => b.imageModifiedAt.localeCompare(a.imageModifiedAt))

  const snapshot: QuoteOcrQueueSnapshot = {
    generatedAt: new Date().toISOString(),
    rootPath: manualDir,
    total: items.length,
    pendingCount: items.filter((item) => item.status === 'pending_ocr').length,
    completedCount: items.filter((item) => item.status === 'manual_text_exists').length,
    items,
  }

  const content = JSON.stringify(snapshot, null, 2)
  const artifact = artifactPath('latest-quote-ocr-queue.json')
  const web = webDataPath('latest-quote-ocr-queue.json')
  await fs.mkdir(path.dirname(artifact), { recursive: true })
  await fs.mkdir(path.dirname(web), { recursive: true })
  await fs.writeFile(artifact, content, 'utf-8')
  await fs.writeFile(web, content, 'utf-8')

  return { artifactPath: artifact, webPath: web, snapshot }
}
