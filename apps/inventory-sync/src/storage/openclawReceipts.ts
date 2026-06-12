import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

type OpenClawReceiptStatus = 'completed'
  | 'completed_with_warnings'
  | 'blocked_missing_input'
  | 'blocked_page_risk'
  | 'executed_not_closed'
  | 'failed'

export type OpenClawCollectionReceipt = {
  receiptId: string
  taskName: string
  taskCategory: string
  status: OpenClawReceiptStatus
  capturedAt: string
  sourceSystem: string
  sourceWindow?: string
  rawEvidencePaths: string[]
  structuredOutputPaths: string[]
  dedupeKeys: string[]
  recordCount: number
  blockingReason?: string
  manualActionRequired?: boolean
  codexActionRequired?: boolean
  codexAction?: string
  receiptPath?: string
  notes?: string[]
}

type OpenClawReceiptSnapshot = {
  generatedAt: string
  rootDir: string
  total: number
  byStatus: Record<string, number>
  latestCapturedAt?: string
  readyForCodex: OpenClawCollectionReceipt[]
  unresolved: OpenClawCollectionReceipt[]
  manualActionRequired: OpenClawCollectionReceipt[]
  latestByTask: Record<string, OpenClawCollectionReceipt>
  receipts: OpenClawCollectionReceipt[]
}

const openclawRoot = path.resolve(config.lenovoRetail.artifactDir, 'manual/openclaw')
const receiptDir = path.resolve(openclawRoot, 'receipts')
const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-openclaw-collection-receipts.json')
const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-openclaw-collection-receipts.json')

function isReceipt(value: unknown): value is OpenClawCollectionReceipt {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.receiptId === 'string'
    && typeof item.taskName === 'string'
    && typeof item.taskCategory === 'string'
    && typeof item.status === 'string'
    && typeof item.capturedAt === 'string'
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.resolve(dir, entry.name)
    if (entry.isDirectory()) return walkJsonFiles(entryPath)
    if (entry.isFile() && entry.name.endsWith('.json')) return [entryPath]
    return []
  }))
  return nested.flat()
}

async function readReceipt(filePath: string) {
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  if (!content.trim()) return undefined
  try {
    const payload = JSON.parse(content) as unknown
    if (isReceipt(payload)) return { ...payload, receiptPath: filePath }
    if (payload && typeof payload === 'object' && isReceipt((payload as { receipt?: unknown }).receipt)) {
      return { ...(payload as { receipt: OpenClawCollectionReceipt }).receipt, receiptPath: filePath }
    }
  } catch {
    return undefined
  }
  return undefined
}

async function writeFileAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, filePath)
}

export async function buildOpenClawReceiptSnapshot() {
  await fs.mkdir(receiptDir, { recursive: true })
  const files = await walkJsonFiles(receiptDir)
  const receipts = (await Promise.all(files.map(readReceipt)))
    .filter(Boolean) as OpenClawCollectionReceipt[]

  receipts.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.receiptId.localeCompare(a.receiptId))

  const latestByTask: Record<string, OpenClawCollectionReceipt> = {}
  const byStatus: Record<string, number> = {}
  for (const receipt of receipts) {
    byStatus[receipt.status] = (byStatus[receipt.status] ?? 0) + 1
    if (!latestByTask[receipt.taskName]) latestByTask[receipt.taskName] = receipt
  }

  const readyForCodex = receipts.filter((receipt) => (
    (receipt.status === 'completed' || receipt.status === 'completed_with_warnings')
    && (receipt.codexActionRequired === true || receipt.recordCount > 0 || receipt.structuredOutputPaths.length > 0)
    && receipt.taskCategory !== 'watchdog'
  ))

  const unresolved = receipts.filter((receipt) => (
    receipt.status === 'blocked_missing_input'
    || receipt.status === 'blocked_page_risk'
    || receipt.status === 'executed_not_closed'
    || receipt.status === 'failed'
  ))

  const manualActionRequired = receipts.filter((receipt) => receipt.manualActionRequired === true)

  const snapshot: OpenClawReceiptSnapshot = {
    generatedAt: new Date().toISOString(),
    rootDir: openclawRoot,
    total: receipts.length,
    byStatus,
    latestCapturedAt: receipts[0]?.capturedAt,
    readyForCodex: readyForCodex.slice(0, 100),
    unresolved: unresolved.slice(0, 100),
    manualActionRequired: manualActionRequired.slice(0, 100),
    latestByTask,
    receipts: receipts.slice(0, 200),
  }

  const content = `${JSON.stringify(snapshot, null, 2)}\n`
  await Promise.all([
    writeFileAtomic(artifactPath, content),
    writeFileAtomic(webPath, content),
  ])

  return { snapshot, artifactPath, webPath, receiptDir }
}
