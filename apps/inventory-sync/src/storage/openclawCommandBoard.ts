import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

export type OpenClawCommandStatus =
  | 'drafted'
  | 'queued'
  | 'steered'
  | 'acknowledged'
  | 'executing'
  | 'completed'
  | 'blocked'
  | 'cancelled'

export type OpenClawCommand = {
  commandId: string
  title: string
  instruction: string
  status: OpenClawCommandStatus
  createdAt: string
  updatedAt?: string
  taskName?: string
  sourceSystem: 'codex' | 'openclaw'
  targetSystem: 'openclaw' | 'codex'
  sourceSession?: string
  relatedReceiptId?: string
  operator?: string
  resultSummary?: string
  blockingReason?: string
  evidencePaths?: string[]
}

type OpenClawCommandBoardSnapshot = {
  generatedAt: string
  rootDir: string
  total: number
  byStatus: Record<string, number>
  latestUpdatedAt?: string
  pendingForOpenClaw: OpenClawCommand[]
  pendingForCodex: OpenClawCommand[]
  latestByTask: Record<string, OpenClawCommand>
  commands: OpenClawCommand[]
}

const openclawRoot = path.resolve(config.lenovoRetail.artifactDir, 'manual/openclaw')
const commandDir = path.resolve(openclawRoot, 'commands')
const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-openclaw-command-board.json')
const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-openclaw-command-board.json')

function isCommand(value: unknown): value is OpenClawCommand {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.commandId === 'string'
    && typeof item.title === 'string'
    && typeof item.instruction === 'string'
    && typeof item.status === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.sourceSystem === 'string'
    && typeof item.targetSystem === 'string'
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

async function readCommand(filePath: string) {
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  if (!content.trim()) return undefined
  try {
    const payload = JSON.parse(content) as unknown
    if (isCommand(payload)) return payload
    if (payload && typeof payload === 'object' && isCommand((payload as { command?: unknown }).command)) {
      return (payload as { command: OpenClawCommand }).command
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

export async function buildOpenClawCommandBoardSnapshot() {
  await fs.mkdir(commandDir, { recursive: true })
  const files = await walkJsonFiles(commandDir)
  const commands = (await Promise.all(files.map(readCommand))).filter(Boolean) as OpenClawCommand[]

  commands.sort((a, b) => {
    const aTime = a.updatedAt ?? a.createdAt
    const bTime = b.updatedAt ?? b.createdAt
    return bTime.localeCompare(aTime) || b.commandId.localeCompare(a.commandId)
  })

  const byStatus: Record<string, number> = {}
  const latestByTask: Record<string, OpenClawCommand> = {}
  for (const command of commands) {
    byStatus[command.status] = (byStatus[command.status] ?? 0) + 1
    if (command.taskName && !latestByTask[command.taskName]) latestByTask[command.taskName] = command
  }

  const pendingForOpenClaw = commands.filter((command) => (
    command.targetSystem === 'openclaw'
    && ['drafted', 'queued', 'steered', 'acknowledged', 'executing', 'blocked'].includes(command.status)
  ))

  const pendingForCodex = commands.filter((command) => (
    command.targetSystem === 'codex'
    && ['drafted', 'queued', 'steered', 'acknowledged', 'executing', 'blocked'].includes(command.status)
  ))

  const snapshot: OpenClawCommandBoardSnapshot = {
    generatedAt: new Date().toISOString(),
    rootDir: openclawRoot,
    total: commands.length,
    byStatus,
    latestUpdatedAt: commands[0] ? (commands[0].updatedAt ?? commands[0].createdAt) : undefined,
    pendingForOpenClaw: pendingForOpenClaw.slice(0, 100),
    pendingForCodex: pendingForCodex.slice(0, 100),
    latestByTask,
    commands: commands.slice(0, 200),
  }

  const content = `${JSON.stringify(snapshot, null, 2)}\n`
  await Promise.all([
    writeFileAtomic(artifactPath, content),
    writeFileAtomic(webPath, content),
  ])

  return { snapshot, artifactPath, webPath, commandDir }
}
