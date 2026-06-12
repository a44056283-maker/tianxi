import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { config } from '../config.js'

type AuditSummary = {
  standardTotals?: {
    skuCount?: number
    currentStock?: number
    sellableStock?: number
    serialCount?: number
    unmatchedSerialCount?: number
    physicalHoldStock?: number
    excessSerialCount?: number
  }
  projectionItemCount?: number
  liveItemCount?: number
  coreStockSnMismatchCount?: number
  projectionVsStandardMismatchCount?: number
  channelStockSnMismatchCount?: number
  distMismatchCount?: number
  liveMismatchCount?: number
}

type AuditSampleCore = {
  skuKey: string
  currentStock: number
  sellableStock: number
  serialCount: number
  rawSerialCount: number
  missingSerialCount: number
  excessSerialCount: number
}

type AuditSampleProjection = {
  skuKey: string
  projection: [number, number, number]
  standard: [number, number, number]
}

type AuditPayload = {
  generatedAt?: string
  summary?: AuditSummary
  samples?: {
    core?: AuditSampleCore[]
    projectionVsStandard?: AuditSampleProjection[]
    channel?: unknown[]
    dist?: unknown[]
    live?: unknown[]
  }
}

export type SnReconciliationMismatch = {
  sku_key: string
  name: string
  pn_mtm: string
  current_stock: number
  in_stock_sn: number
  diff: number
  note?: string
}

export type SnReconciliationSnapshot = {
  generatedAt: string
  source: string
  auditRunAt: string
  mismatchCount: number
  overSerialCount: number
  underSerialCount: number
  mismatches: SnReconciliationMismatch[]
}

export type SnReconciliationSummarySnapshot = {
  generatedAt: string
  source: string
  auditRunAt: string
  mismatchCount: number
  overSerialCount: number
  underSerialCount: number
  coreStockSnMismatchCount?: number
  projectionVsStandardMismatchCount?: number
  channelStockSnMismatchCount?: number
  distMismatchCount?: number
  liveMismatchCount?: number
  standardTotals?: AuditSummary['standardTotals']
  top5: SnReconciliationMismatch[]
}

type ProductLibraryRow = {
  primary_sku_key?: string
  canonical_name?: string
  configuration_summary?: string
}

function artifactPath(fileName: string): string {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webPath(fileName: string): string {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

function nowIso(): string {
  return new Date().toISOString()
}

function readJsonSync<T>(file: string): T | null {
  try {
    const raw = fsSync.readFileSync(file, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function listSkusToInspect(audit: AuditPayload): Set<string> {
  const skus = new Set<string>()
  for (const c of audit.samples?.core ?? []) {
    if (c.skuKey) skus.add(c.skuKey)
  }
  for (const p of audit.samples?.projectionVsStandard ?? []) {
    if (p.skuKey) skus.add(p.skuKey)
  }
  return skus
}

function loadProductLibrary(skus: Set<string>): Map<string, { name: string; pnMtm: string }> {
  const lib = new Map<string, { name: string; pnMtm: string }>()
  const file = webPath('latest-product-library-products.json')
  const data = readJsonSync<{ items?: ProductLibraryRow[] }>(file)
  if (!data?.items) return lib
  for (const it of data.items) {
    const sku = it.primary_sku_key
    if (!sku || !skus.has(sku)) continue
    lib.set(sku, {
      name: it.canonical_name ?? '',
      pnMtm: it.configuration_summary ?? '',
    })
  }
  return lib
}

function spawnAudit(): AuditPayload {
  const scriptPath = path.resolve(config.appDir, '..', '..', 'scripts', 'audit_terminal_stock_sn_sync.py')
  const result = spawnSync('python3', [scriptPath], { encoding: 'utf-8' })
  // The audit script exits 1 when blocking=true (i.e. when mismatches exist).
  // That is the normal case; we still want to parse the JSON it printed.
  if (!result.stdout) {
    throw new Error(`audit_terminal_stock_sn_sync.py produced no stdout (stderr=${result.stderr ?? ''})`)
  }
  try {
    return JSON.parse(result.stdout) as AuditPayload
  } catch (err) {
    throw new Error(`audit stdout not JSON: ${(err as Error).message}\nstdout head: ${result.stdout.slice(0, 200)}`)
  }
}

function buildMismatchList(audit: AuditPayload, lib: Map<string, { name: string; pnMtm: string }>): SnReconciliationMismatch[] {
  const seen = new Map<string, SnReconciliationMismatch>()
  for (const c of audit.samples?.core ?? []) {
    const sku = c.skuKey
    if (!sku) continue
    const info = lib.get(sku) ?? { name: '', pnMtm: '' }
    seen.set(sku, {
      sku_key: sku,
      name: info.name,
      pn_mtm: info.pnMtm,
      current_stock: c.currentStock,
      in_stock_sn: c.serialCount,
      diff: c.serialCount - c.currentStock,
    })
  }
  for (const p of audit.samples?.projectionVsStandard ?? []) {
    if (!p.skuKey) continue
    if (seen.has(p.skuKey)) continue
    const info = lib.get(p.skuKey) ?? { name: '', pnMtm: '' }
    const [cur, , sn] = p.standard
    seen.set(p.skuKey, {
      sku_key: p.skuKey,
      name: info.name,
      pn_mtm: info.pnMtm,
      current_stock: cur,
      in_stock_sn: sn,
      diff: sn - cur,
      note: `projection vs standard drift: projection=${JSON.stringify(p.projection)} standard=${JSON.stringify(p.standard)}`,
    })
  }
  return Array.from(seen.values()).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
}

/**
 * Read the live audit, look up product metadata, and derive the SN
 * reconciliation snapshot. Pure function — no filesystem writes.
 */
export function buildSnReconciliationSnapshot(): {
  mismatch: SnReconciliationSnapshot
  summary: SnReconciliationSummarySnapshot
} {
  const audit = spawnAudit()
  const skus = listSkusToInspect(audit)
  const lib = loadProductLibrary(skus)
  const mismatches = buildMismatchList(audit, lib)
  const over = mismatches.filter((m) => m.diff > 0).length
  const under = mismatches.filter((m) => m.diff < 0).length
  const now = nowIso()
  const summary = audit.summary ?? {}

  const mismatchSnapshot: SnReconciliationSnapshot = {
    generatedAt: now,
    source: 'audit_terminal_stock_sn_sync.py',
    auditRunAt: audit.generatedAt ?? now,
    mismatchCount: mismatches.length,
    overSerialCount: over,
    underSerialCount: under,
    mismatches,
  }

  const summarySnapshot: SnReconciliationSummarySnapshot = {
    generatedAt: now,
    source: 'audit_terminal_stock_sn_sync.py',
    auditRunAt: audit.generatedAt ?? now,
    mismatchCount: mismatches.length,
    overSerialCount: over,
    underSerialCount: under,
    coreStockSnMismatchCount: summary.coreStockSnMismatchCount,
    projectionVsStandardMismatchCount: summary.projectionVsStandardMismatchCount,
    channelStockSnMismatchCount: summary.channelStockSnMismatchCount,
    distMismatchCount: summary.distMismatchCount,
    liveMismatchCount: summary.liveMismatchCount,
    standardTotals: summary.standardTotals,
    top5: mismatches.slice(0, 5),
  }

  return { mismatch: mismatchSnapshot, summary: summarySnapshot }
}

/**
 * Build and write both snapshots (artifact + web mirror). Returns the same
 * payload as `buildSnReconciliationSnapshot` plus the resolved file paths.
 */
export async function saveSnReconciliationSnapshot(): Promise<{
  mismatch: SnReconciliationSnapshot
  summary: SnReconciliationSummarySnapshot
  files: {
    mismatch: { artifactPath: string; webPath: string }
    summary: { artifactPath: string; webPath: string }
  }
}> {
  const { mismatch, summary } = buildSnReconciliationSnapshot()

  const targets = [
    { name: 'mismatch' as const, file: 'latest-sn-reconciliation-mismatch.json', payload: mismatch },
    { name: 'summary' as const, file: 'latest-sn-reconciliation-summary.json', payload: summary },
  ]

  const fileMap = { mismatch: { artifactPath: '', webPath: '' }, summary: { artifactPath: '', webPath: '' } }

  for (const t of targets) {
    const artifact = artifactPath(t.file)
    const web = webPath(t.file)
    await fs.mkdir(path.dirname(artifact), { recursive: true})
    await fs.mkdir(path.dirname(web), {recursive: true})
    const body = `${JSON.stringify(t.payload, null, 2)}\n`
    await Promise.all([fs.writeFile(artifact, body, 'utf-8'), fs.writeFile(web, body, 'utf-8')])
    fileMap[t.name] = { artifactPath: artifact, webPath: web }
  }

  return { mismatch, summary, files: fileMap }
}
