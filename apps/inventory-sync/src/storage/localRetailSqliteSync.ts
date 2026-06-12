import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type LocalRetailSqliteSyncEntity = 'inventory_movement' | 'sales_order' | 'serial_item'

export type LocalRetailSqliteSyncOptions = {
  poll?: boolean
  interval?: number
  entity?: LocalRetailSqliteSyncEntity
}

export type LocalRetailSqliteSyncResult = {
  ok: boolean
  error?: string
  inventory_movement?: { ok: boolean; count?: number; error?: string }
  sales_order?: { ok: boolean; count?: number; error?: string }
  serial_item?: { ok: boolean; count?: number; error?: string }
  stdout?: string
  stderr?: string
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function pythonScriptPath() {
  return path.resolve(moduleDir, 'localRetailSqliteSync.py')
}

export async function runLocalRetailSqliteSync(
  options: LocalRetailSqliteSyncOptions = {},
): Promise<LocalRetailSqliteSyncResult> {
  const args = [pythonScriptPath()]
  if (options.poll) args.push('--poll')
  if (typeof options.interval === 'number' && Number.isFinite(options.interval) && options.interval > 0) {
    args.push('--interval', String(Math.round(options.interval)))
  }
  if (options.entity) {
    args.push('--entity', options.entity)
  }

  const { stdout, stderr } = await execFileAsync('python3', args, {
    cwd: path.resolve(moduleDir, '../../..'),
    maxBuffer: 1024 * 1024 * 16,
  })

  const trimmed = stdout.trim()
  if (options.poll) {
    return {
      ok: true,
      stdout: trimmed,
      stderr: stderr.trim(),
    }
  }

  try {
    const parsed = JSON.parse(trimmed) as LocalRetailSqliteSyncResult
    return {
      ...parsed,
      stdout: trimmed,
      stderr: stderr.trim(),
    }
  } catch {
    return {
      ok: false,
      error: 'invalid_json_output',
      stdout: trimmed,
      stderr: stderr.trim(),
    }
  }
}
