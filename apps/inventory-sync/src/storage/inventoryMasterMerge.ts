import fs from 'node:fs/promises'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { config } from '../config.js'
import { loadInventoryMovements, loadSerialOverrides, type InventoryMovementRecord, type SerialOverride } from '../inventoryQuote/dataService.js'
import type { LenovoWarrantySnapshot } from '../inventoryQuote/lenovoWarrantyCollector.js'
import { type StandardInventorySnapshot, type StandardInventorySerial } from '../types.js'
import { buildStandardInventorySnapshot } from './inventorySnapshotBuilder.js'
import { auditZhidiantongSalesSync, type SalesAuditDaySummary } from './zhidiantongSalesSyncAudit.js'
import {
  findLatestStockQuantityExport,
  findLatestStockSnExport,
  parseStockQuantityExport,
  parseStockSnExport,
} from './excelInventoryParser.js'

type Cell = string | number | boolean | Date | null

type InventoryMasterSourceKind =
  | 'stock_quantity_export'
  | 'stock_sn_export'
  | 'stock_stream_export'
  | 'sn_stock_order_export'
  | 'stock_order_export'
  | 'inventory_movements_snapshot'
  | 'serial_overrides_snapshot'

type InventoryMasterLifecycleStatus = 'in_stock' | 'sold' | 'transferred_out' | 'transferred_in' | 'adjusted' | 'unknown'

type InventoryMasterEvidenceSource =
  | 'stock_sn_export'
  | 'serial_override'
  | 'inventory_movement'
  | 'sn_stock_order'
  | 'stock_order'

type SourceFileManifest = {
  stockQuantityFile?: string
  stockSnFile?: string
  stockStreamFile?: string
  snStockOrderFile?: string
  stockOrderFile?: string
}

type InventoryMasterSourceRef = {
  kind: InventoryMasterSourceKind
  filePath?: string
  rowKey?: string
  documentNumber?: string
  capturedAt?: string
}

export type InventoryMasterRow = {
  serialNumber: string
  skuKey: string
  skuCode?: string
  productCode?: string
  pnMtm?: string
  productName: string
  spec?: string
  category?: string
  organizationName?: string
  organizationCode?: string
  stockType?: string
  currentStock: number
  sellableStock: number
  occupiedStock: number
  unsellableStock: number
  pendingInboundStock: number
  serialCountWithinSku: number
  inStock: boolean
  lifecycleStatus: InventoryMasterLifecycleStatus
  locationName?: string
  stockAgeDays?: number
  warrantyStart?: string
  warrantyEnd?: string
  inboundDate?: string
  inboundDocumentNumber?: string
  inboundDocumentType?: string
  inboundOperatorName?: string
  supplierName?: string
  latestBusinessDate?: string
  latestDocumentNumber?: string
  latestDocumentType?: string
  latestMovementType?: InventoryMovementRecord['movementType']
  latestOperatorName?: string
  latestStoreName?: string
  latestLocationName?: string
  latestNote?: string
  evidencePriority: InventoryMasterEvidenceSource[]
  sourceRefs: InventoryMasterSourceRef[]
  dataQuality: {
    hasSnapshotSerial: boolean
    hasInboundEvidence: boolean
    hasDocumentEvidence: boolean
    hasMovementEvidence: boolean
    warnings: string[]
  }
}

export type InventoryMasterExceptionRow = {
  type:
    | 'sku_without_serials'
    | 'unmatched_sn_stock_order'
    | 'unmatched_stock_order'
    | 'movement_serial_not_in_snapshot'
    | 'override_serial_not_in_snapshot'
  message: string
  skuKey?: string
  serialNumber?: string
  documentNumber?: string
  sourceFile?: string
  rowKey?: string
}

export type InventoryMasterSnapshot = {
  source: 'lenovo-retail-web'
  generatedAt: string
  files: SourceFileManifest
  totals: {
    rowCount: number
    skuCount: number
    inStockRowCount: number
    rowWithInboundDateCount: number
    rowWithInboundDocumentCount: number
    rowWithLatestMovementCount: number
    skuWithoutSerialCount: number
    exceptionCount: number
  }
  coverage: {
    inboundDateCoverage: number
    inboundDocumentCoverage: number
    movementCoverage: number
  }
  salesAuditSummary?: {
    period: {
      from: string
      to: string
    }
    consistencyStatus: 'consistent' | 'inconsistent' | 'insufficient_evidence'
    missingEvidenceDays: string[]
    mismatchedHistoricalRecordCount: number
    localSalesByDate: Record<string, number>
    historicalSalesByDate?: Record<string, number>
    daySummary: SalesAuditDaySummary[]
  }
  warnings: string[]
  rows: InventoryMasterRow[]
  exceptions: InventoryMasterExceptionRow[]
}

type InventoryOrderRow = {
  rowKey: string
  documentNumber: string
  documentType?: string
  businessDate?: string
  skuKey?: string
  skuRaw?: string
  productName?: string
  pnMtm?: string
  spec?: string
  serialNumber?: string
  quantity?: number
  operatorName?: string
  supplierName?: string
  organizationName?: string
  locationName?: string
  note?: string
}

type BuildInventoryMasterOptions = {
  files?: Partial<SourceFileManifest>
}

function normalizeCell(cell: Cell) {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 19).replace('T', ' ')
  return String(cell).trim()
}

function normalizeHeader(row: Cell[]) {
  return row.map(normalizeCell)
}

function getCell(row: Cell[], header: string[], name: string) {
  const index = header.indexOf(name)
  if (index < 0) return ''
  return normalizeCell(row[index])
}

function getFirstCell(row: Cell[], header: string[], names: string[]) {
  for (const name of names) {
    const value = getCell(row, header, name)
    if (value) return value
  }
  return ''
}

function getOptionalNumber(row: Cell[], header: string[], names: string[]) {
  const value = getFirstCell(row, header, names).replace(/[^\d.-]/g, '')
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getOptionalDate(row: Cell[], header: string[], names: string[]) {
  const raw = getFirstCell(row, header, names)
  return normalizeDate(raw)
}

function normalizeDate(value?: string) {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  const normalized = text
    .replace('T', ' ')
    .replace(/Z$/i, '')
    .replace(/[./年]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .trim()
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (!match) return text
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
}

function normalizeLookupKey(value?: string) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function normalizeSerialNumber(value?: string) {
  return normalizeLookupKey(value)
}

function splitSerials(value: string) {
  return [...new Set(
    value
      .split(/[\s,，;；/|]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )]
}

function pickSkuKey(raw?: string) {
  const text = String(raw ?? '').trim()
  const exact = text.match(/\b(\d{8})\b/)
  return exact?.[1]
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      row.push(current)
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(current)
      if (row.some((item) => item.trim())) rows.push(row.map((item) => item.trim()))
      row = []
      current = ''
      continue
    }
    current += char
  }
  row.push(current)
  if (row.some((item) => item.trim())) rows.push(row.map((item) => item.trim()))
  return rows
}

async function readRows(filePath: string): Promise<Cell[][]> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.csv') return parseCsvRows(await fs.readFile(filePath, 'utf-8'))
  if (extension === '.xlsx') {
    const result = await readXlsxFile(filePath) as unknown
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) return result as Cell[][]
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null && 'data' in result[0]) {
      return (result[0] as { data: Cell[][] }).data
    }
    return []
  }
  throw new Error(`暂不支持的导出格式：${extension || 'unknown'}；请导出为 .xlsx 或 .csv`)
}

async function readJsonIfExists<T>(filePath: string) {
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  return content ? JSON.parse(content) as T : undefined
}

async function findLatestFileByKeywords(keywords: string[][]) {
  const searchDirs = [
    path.resolve(config.lenovoRetail.artifactDir, 'manual'),
    config.lenovoRetail.downloadDir,
    config.lenovoRetail.artifactDir,
  ]
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    const files = await fs.readdir(searchDir).catch(() => [])
    for (const file of files) {
      if (!/\.(xlsx|csv)$/i.test(file)) continue
      const lower = file.toLowerCase()
      const found = keywords.some((group) => group.every((keyword) => lower.includes(keyword.toLowerCase())))
      if (!found) continue
      const filePath = path.resolve(searchDir, file)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      matched.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  return matched.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath
}

async function findLatestSnStockOrderExport() {
  return findLatestFileByKeywords([
    ['sn库存订单'],
    ['sn', '库存订单'],
    ['sn-stock-order'],
    ['serialnumberdata'],
    ['serial', 'number', 'data'],
  ])
}

async function findLatestStockOrderExport() {
  const directMatch = await findLatestFileByKeywords([
    ['库存订单'],
    ['stock-order'],
  ])
  if (directMatch) return directMatch

  const searchDirs = [
    path.resolve(config.lenovoRetail.artifactDir, 'manual'),
    config.lenovoRetail.downloadDir,
    config.lenovoRetail.artifactDir,
  ]
  const candidates: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    const files = await fs.readdir(searchDir).catch(() => [])
    for (const file of files) {
      if (!/\.(xlsx|csv)$/i.test(file)) continue
      if (!file.toLowerCase().includes('stock_count')) continue
      const filePath = path.resolve(searchDir, file)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      const rows = await readRows(filePath).catch(() => [])
      const header = normalizeHeader(rows[0] ?? [])
      if (!hasInventoryOrderHeaders(header)) continue
      candidates.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath
}

function hasInventoryOrderHeaders(header: string[]) {
  const hasDocument = ['业务单据编号', '单据编号', '业务单号', '单号', '单据号'].some((name) => header.includes(name))
  const hasDate = ['交易时间', '业务时间', '业务日期', '创建时间', '入库时间', '出库时间'].some((name) => header.includes(name))
  const hasIdentity = ['SN', '序列号', '商品SN', '设备SN', 'SKU编码', '商品编码', 'PN/MTM', '商品名称'].some((name) => header.includes(name))
  return hasDocument && hasDate && hasIdentity
}

async function parseInventoryOrderExport(filePath: string): Promise<InventoryOrderRow[]> {
  const rows = await readRows(filePath)
  const [headerRow, ...dataRows] = rows
  const header = normalizeHeader(headerRow ?? [])
  if (!hasInventoryOrderHeaders(header)) return []

  const parsed: InventoryOrderRow[] = []
  for (const [rowIndex, row] of dataRows.entries()) {
    const documentNumber = getFirstCell(row, header, ['业务单据编号', '单据编号', '业务单号', '单号', '单据号'])
    if (!documentNumber) continue
    const serialNumbers = splitSerials(getFirstCell(row, header, ['SN', '序列号', '商品SN', '设备SN']))
    const base: InventoryOrderRow = {
      rowKey: `${path.basename(filePath)}#ROW${rowIndex + 2}`,
      documentNumber,
      documentType: getFirstCell(row, header, ['入出库类型', '业务类型', '单据类型', '类型']) || undefined,
      businessDate: getOptionalDate(row, header, ['交易时间', '业务时间', '业务日期', '创建时间', '入库时间', '出库时间']),
      skuKey: pickSkuKey(getFirstCell(row, header, ['SKU编码', '商品编码', 'SKU', '货号'])),
      skuRaw: getFirstCell(row, header, ['SKU编码', '商品编码', 'SKU', '货号']) || undefined,
      productName: getFirstCell(row, header, ['商品名称', '货品名称', '商品信息']) || undefined,
      pnMtm: getFirstCell(row, header, ['PN/MTM', 'MTM', 'PN']) || undefined,
      spec: getFirstCell(row, header, ['规格', '商品规格']) || undefined,
      quantity: getOptionalNumber(row, header, ['数量', '出入库数量', '库存变化数量']),
      operatorName: getFirstCell(row, header, ['交易人员', '操作人', '经手人', '制单人', '业务员']) || undefined,
      supplierName: getFirstCell(row, header, ['供应商', '往来单位']) || undefined,
      organizationName: getFirstCell(row, header, ['门店/仓库名称', '组织名称', '门店名称', '仓库名称']) || undefined,
      locationName: getFirstCell(row, header, ['库位', '库位名称', '仓库', '仓位']) || undefined,
      note: getFirstCell(row, header, ['备注', '说明']) || undefined,
    }
    if (serialNumbers.length === 0) {
      parsed.push(base)
      continue
    }
    for (const serialNumber of serialNumbers) {
      parsed.push({
        ...base,
        serialNumber,
      })
    }
  }
  return parsed
}

function compareBusinessDate(a?: string, b?: string) {
  return String(a ?? '').localeCompare(String(b ?? ''))
}

function appendEvidencePriority(
  current: InventoryMasterEvidenceSource[],
  incoming: InventoryMasterEvidenceSource[],
): InventoryMasterEvidenceSource[] {
  return [...new Set<InventoryMasterEvidenceSource>([...current, ...incoming])]
}

function buildSnapshotSerialIndex(snapshot: StandardInventorySnapshot) {
  const bySerial = new Map<string, { serial: StandardInventorySerial; sku: StandardInventorySnapshot['skus'][number] }>()
  const bySku = new Map<string, StandardInventorySnapshot['skus'][number]>()
  for (const sku of snapshot.skus) {
    bySku.set(sku.skuKey, sku)
    for (const serial of sku.serials) {
      const key = normalizeSerialNumber(serial.serialNumber)
      if (!key) continue
      bySerial.set(key, { serial, sku })
    }
  }
  return { bySerial, bySku }
}

function buildCanonicalRow(
  sku: StandardInventorySnapshot['skus'][number],
  serial: StandardInventorySerial,
): InventoryMasterRow {
  const stockAgeDays = serial.stockAgeDays ?? deriveStockAgeDays(serial.inboundDate)
  return {
    serialNumber: serial.serialNumber,
    skuKey: sku.skuKey,
    skuCode: sku.skuCode,
    productCode: sku.productCode,
    pnMtm: serial.pnMtm ?? sku.pnMtm,
    productName: serial.productName || sku.productName,
    spec: serial.spec ?? sku.spec,
    category: sku.category,
    organizationName: serial.organizationName ?? sku.organizationName,
    organizationCode: serial.organizationCode ?? sku.organizationCode,
    stockType: sku.stockType,
    currentStock: sku.currentStock,
    sellableStock: sku.sellableStock,
    occupiedStock: sku.occupiedStock,
    unsellableStock: sku.unsellableStock,
    pendingInboundStock: sku.pendingInboundStock,
    serialCountWithinSku: sku.serialCount,
    inStock: true,
    lifecycleStatus: 'in_stock',
    locationName: serial.locationName,
    stockAgeDays,
    warrantyStart: serial.warrantyStart,
    warrantyEnd: serial.warrantyEnd,
    inboundDate: serial.inboundDate,
    inboundDocumentNumber: serial.inboundDocumentNumber,
    inboundOperatorName: serial.inboundOperatorName,
    supplierName: serial.supplierName,
    evidencePriority: ['stock_sn_export'],
    sourceRefs: [{ kind: 'stock_sn_export' }],
    dataQuality: {
      hasSnapshotSerial: true,
      hasInboundEvidence: Boolean(serial.inboundDate),
      hasDocumentEvidence: Boolean(serial.inboundDocumentNumber),
      hasMovementEvidence: false,
      warnings: [...sku.dataQuality.warnings],
    },
  }
}

function buildFallbackRowFromOverride(
  sku: StandardInventorySnapshot['skus'][number],
  serialNumber: string,
  override: SerialOverride,
): InventoryMasterRow {
  return {
    serialNumber,
    skuKey: override.skuKey ?? sku.skuKey,
    skuCode: sku.skuCode,
    productCode: sku.productCode,
    pnMtm: override.pnMtm ?? sku.pnMtm,
    productName: override.productName || sku.productName,
    spec: override.spec ?? sku.spec,
    category: sku.category,
    organizationName: override.storeName ?? sku.organizationName,
    organizationCode: sku.organizationCode,
    stockType: sku.stockType,
    currentStock: sku.currentStock,
    sellableStock: sku.sellableStock,
    occupiedStock: sku.occupiedStock,
    unsellableStock: sku.unsellableStock,
    pendingInboundStock: sku.pendingInboundStock,
    serialCountWithinSku: sku.serialCount,
    inStock: true,
    lifecycleStatus: 'in_stock',
    locationName: override.locationName,
    stockAgeDays: undefined,
    warrantyStart: undefined,
    warrantyEnd: undefined,
    inboundDate: undefined,
    inboundDocumentNumber: undefined,
    inboundDocumentType: undefined,
    inboundOperatorName: undefined,
    supplierName: undefined,
    evidencePriority: ['serial_override'],
    sourceRefs: [],
    dataQuality: {
      hasSnapshotSerial: false,
      hasInboundEvidence: false,
      hasDocumentEvidence: false,
      hasMovementEvidence: false,
      warnings: [
        ...sku.dataQuality.warnings,
        '当前 SN 来自人工 serial override，待智店通商品库存SN导出恢复后复核。',
      ],
    },
  }
}

function buildAggregateRowWithoutSerial(
  sku: StandardInventorySnapshot['skus'][number],
  missingCount: number,
): InventoryMasterRow {
  return {
    serialNumber: `[缺SN x${missingCount}] ${sku.skuKey}`,
    skuKey: sku.skuKey,
    skuCode: sku.skuCode,
    productCode: sku.productCode,
    pnMtm: sku.pnMtm,
    productName: sku.productName,
    spec: sku.spec,
    category: sku.category,
    organizationName: sku.organizationName,
    organizationCode: sku.organizationCode,
    stockType: sku.stockType,
    currentStock: sku.currentStock,
    sellableStock: sku.sellableStock,
    occupiedStock: sku.occupiedStock,
    unsellableStock: sku.unsellableStock,
    pendingInboundStock: sku.pendingInboundStock,
    serialCountWithinSku: sku.serialCount,
    inStock: true,
    lifecycleStatus: 'in_stock',
    stockAgeDays: undefined,
    warrantyStart: undefined,
    warrantyEnd: undefined,
    inboundDate: undefined,
    inboundDocumentNumber: undefined,
    inboundDocumentType: undefined,
    inboundOperatorName: undefined,
    supplierName: undefined,
    evidencePriority: [],
    sourceRefs: [],
    dataQuality: {
      hasSnapshotSerial: false,
      hasInboundEvidence: false,
      hasDocumentEvidence: false,
      hasMovementEvidence: false,
      warnings: [
        ...sku.dataQuality.warnings,
        `当前库存仍缺少 ${missingCount} 台 SN 明细，先按 SKU 汇总展示，待智店通商品库存SN导出补齐后回填。`,
      ],
    },
  }
}

function applySerialOverride(row: InventoryMasterRow, override: SerialOverride, sourceFile?: string) {
  if (override.inboundDate) row.inboundDate = row.inboundDate || normalizeDate(override.inboundDate)
  if (override.documentNumber) row.inboundDocumentNumber = row.inboundDocumentNumber || override.documentNumber
  if (override.operatorName) row.inboundOperatorName = row.inboundOperatorName || override.operatorName
  if (override.supplierName) row.supplierName = row.supplierName || override.supplierName
  if (override.locationName) row.locationName = row.locationName || override.locationName
  if (override.productName && !row.productName) row.productName = override.productName
  if (override.pnMtm && !row.pnMtm) row.pnMtm = override.pnMtm
  if (override.spec && !row.spec) row.spec = override.spec
  row.dataQuality.hasInboundEvidence = row.dataQuality.hasInboundEvidence || Boolean(override.inboundDate)
  row.dataQuality.hasDocumentEvidence = row.dataQuality.hasDocumentEvidence || Boolean(override.documentNumber)
  row.sourceRefs.push({
    kind: 'serial_overrides_snapshot',
    filePath: sourceFile,
    documentNumber: override.documentNumber,
  })
  row.evidencePriority = appendEvidencePriority(row.evidencePriority, ['serial_override'])
  row.stockAgeDays = row.stockAgeDays ?? deriveStockAgeDays(row.inboundDate)
}

function classifyLifecycleByMovement(movementType?: InventoryMovementRecord['movementType']): InventoryMasterLifecycleStatus {
  if (movementType === 'sales_outbound') return 'sold'
  if (movementType === 'transfer_outbound') return 'transferred_out'
  if (movementType === 'transfer_inbound') return 'transferred_in'
  if (movementType === 'manual_adjustment') return 'adjusted'
  return 'in_stock'
}

function isOutOfStockLifecycle(status: InventoryMasterLifecycleStatus) {
  return status === 'sold' || status === 'transferred_out'
}

function applyLatestMovement(
  row: InventoryMasterRow,
  records: InventoryMovementRecord[],
  sourceFile?: string,
) {
  if (records.length === 0) return
  const latest = [...records].sort((a, b) => compareBusinessDate(b.businessDate, a.businessDate))[0]!
  const inboundCandidates = records
    .filter((item) => item.movementType === 'purchase_inbound' || item.movementType === 'transfer_inbound')
    .sort((a, b) => compareBusinessDate(a.businessDate, b.businessDate))
  const inbound = inboundCandidates[0]

  row.latestBusinessDate = latest.businessDate
  row.latestDocumentNumber = latest.documentNumber
  row.latestDocumentType = latest.sourceDocumentType
  row.latestMovementType = latest.movementType
  row.latestOperatorName = latest.operatorName
  row.latestStoreName = latest.storeName
  row.latestLocationName = latest.locationName
  row.latestNote = latest.note
  row.lifecycleStatus = classifyLifecycleByMovement(latest.movementType)
  if (isOutOfStockLifecycle(row.lifecycleStatus)) {
    row.inStock = false
  } else if (latest.movementType === 'purchase_inbound' || latest.movementType === 'transfer_inbound') {
    row.inStock = true
  }
  row.dataQuality.hasMovementEvidence = true
  row.sourceRefs.push({
    kind: 'inventory_movements_snapshot',
    filePath: sourceFile,
    rowKey: latest.id,
    documentNumber: latest.documentNumber,
    capturedAt: latest.businessDate,
  })
  row.evidencePriority = appendEvidencePriority(row.evidencePriority, ['inventory_movement'])

  if (inbound) {
    row.inboundDate = row.inboundDate || inbound.businessDate
    row.inboundDocumentNumber = row.inboundDocumentNumber || inbound.documentNumber
    row.inboundDocumentType = row.inboundDocumentType || inbound.sourceDocumentType
    row.inboundOperatorName = row.inboundOperatorName || inbound.operatorName
    row.supplierName = row.supplierName || inbound.supplierName
    row.locationName = row.locationName || inbound.locationName
    row.dataQuality.hasInboundEvidence = row.dataQuality.hasInboundEvidence || Boolean(inbound.businessDate)
    row.dataQuality.hasDocumentEvidence = row.dataQuality.hasDocumentEvidence || Boolean(inbound.documentNumber)
  }
  if (!row.supplierName && (row.inboundDocumentNumber || latest.movementType === 'transfer_inbound')) row.supplierName = '联想'
  row.stockAgeDays = row.stockAgeDays ?? deriveStockAgeDays(row.inboundDate)
}

function applyInboundFromSkuMovements(
  row: InventoryMasterRow,
  records: InventoryMovementRecord[],
  sourceFile?: string,
) {
  if (records.length === 0) return
  const inbound = [...records]
    .filter((item) => item.movementType === 'purchase_inbound' || item.movementType === 'transfer_inbound')
    .sort((a, b) => compareBusinessDate(a.businessDate, b.businessDate))[0]
  if (!inbound) return

  row.inboundDate = row.inboundDate || inbound.businessDate
  row.inboundDocumentNumber = row.inboundDocumentNumber || inbound.documentNumber
  row.inboundDocumentType = row.inboundDocumentType || inbound.sourceDocumentType
  row.inboundOperatorName = row.inboundOperatorName || inbound.operatorName
  row.supplierName = row.supplierName || inbound.supplierName
  row.locationName = row.locationName || inbound.locationName
  if (!row.supplierName && row.inboundDocumentNumber) row.supplierName = '联想'
  row.dataQuality.hasInboundEvidence = row.dataQuality.hasInboundEvidence || Boolean(inbound.businessDate)
  row.dataQuality.hasDocumentEvidence = row.dataQuality.hasDocumentEvidence || Boolean(inbound.documentNumber)
  row.sourceRefs.push({
    kind: 'inventory_movements_snapshot',
    filePath: sourceFile,
    rowKey: inbound.id,
    documentNumber: inbound.documentNumber,
    capturedAt: inbound.businessDate,
  })
  row.evidencePriority = appendEvidencePriority(row.evidencePriority, ['inventory_movement'])
  row.stockAgeDays = row.stockAgeDays ?? deriveStockAgeDays(row.inboundDate)
}

function reconcileRowsWithCurrentLifecycle(rows: InventoryMasterRow[]) {
  const bySku = new Map<string, InventoryMasterRow[]>()
  for (const row of rows) {
    const group = bySku.get(row.skuKey) ?? []
    group.push(row)
    bySku.set(row.skuKey, group)
  }

  for (const group of bySku.values()) {
    const inStockRows = group.filter((row) => row.inStock)
    const realInStockSerialCount = inStockRows.filter((row) => !row.serialNumber.startsWith('[缺SN')).length
    const aggregateInStockCount = inStockRows
      .filter((row) => row.serialNumber.startsWith('[缺SN'))
      .reduce((sum, row) => {
        const match = row.serialNumber.match(/^\[缺SN x(\d+)\]/)
        return sum + (match ? Number(match[1]) : 0)
      }, 0)
    const currentStock = realInStockSerialCount + aggregateInStockCount

    for (const row of group) {
      row.currentStock = currentStock
      row.sellableStock = Math.min(row.sellableStock, currentStock)
      row.occupiedStock = Math.min(row.occupiedStock, currentStock)
      row.unsellableStock = Math.min(row.unsellableStock, Math.max(0, currentStock - row.sellableStock - row.occupiedStock))
      row.serialCountWithinSku = realInStockSerialCount
      if (!row.inStock) {
        row.dataQuality.warnings.push(`SN ${row.serialNumber} 已按最新库存流水标记为 ${row.lifecycleStatus}，不再计入前端在库 SN。`)
      }
    }
  }
}

function applySnOrderEvidence(row: InventoryMasterRow, orderRows: InventoryOrderRow[], sourceFile?: string) {
  if (orderRows.length === 0) return
  const sorted = [...orderRows].sort((a, b) => compareBusinessDate(a.businessDate, b.businessDate))
  const earliest = sorted[0]!
  row.inboundDate = row.inboundDate || earliest.businessDate
  row.inboundDocumentNumber = row.inboundDocumentNumber || earliest.documentNumber
  row.inboundDocumentType = row.inboundDocumentType || earliest.documentType
  row.inboundOperatorName = row.inboundOperatorName || earliest.operatorName
  row.supplierName = row.supplierName || earliest.supplierName
  if (!row.supplierName && row.inboundDocumentNumber) row.supplierName = '联想'
  row.locationName = row.locationName || earliest.locationName
  row.dataQuality.hasInboundEvidence = row.dataQuality.hasInboundEvidence || Boolean(earliest.businessDate)
  row.dataQuality.hasDocumentEvidence = row.dataQuality.hasDocumentEvidence || Boolean(earliest.documentNumber)
  row.sourceRefs.push(...sorted.map((item) => ({
    kind: 'sn_stock_order_export' as const,
    filePath: sourceFile,
    rowKey: item.rowKey,
    documentNumber: item.documentNumber,
    capturedAt: item.businessDate,
  })))
  row.evidencePriority = appendEvidencePriority(['sn_stock_order'], row.evidencePriority)
  row.stockAgeDays = row.stockAgeDays ?? deriveStockAgeDays(row.inboundDate)
}

function applyStockOrderEvidence(row: InventoryMasterRow, orderRows: InventoryOrderRow[], sourceFile?: string) {
  if (orderRows.length === 0) return
  const sorted = [...orderRows].sort((a, b) => compareBusinessDate(a.businessDate, b.businessDate))
  const earliest = sorted[0]!
  row.inboundDate = row.inboundDate || earliest.businessDate
  row.inboundDocumentNumber = row.inboundDocumentNumber || earliest.documentNumber
  row.inboundDocumentType = row.inboundDocumentType || earliest.documentType
  row.inboundOperatorName = row.inboundOperatorName || earliest.operatorName
  row.supplierName = row.supplierName || earliest.supplierName
  if (!row.supplierName && row.inboundDocumentNumber) row.supplierName = '联想'
  row.dataQuality.hasInboundEvidence = row.dataQuality.hasInboundEvidence || Boolean(earliest.businessDate)
  row.dataQuality.hasDocumentEvidence = row.dataQuality.hasDocumentEvidence || Boolean(earliest.documentNumber)
  row.sourceRefs.push(...sorted.map((item) => ({
    kind: 'stock_order_export' as const,
    filePath: sourceFile,
    rowKey: item.rowKey,
    documentNumber: item.documentNumber,
    capturedAt: item.businessDate,
  })))
  row.evidencePriority = appendEvidencePriority(row.evidencePriority, ['stock_order'])
  row.stockAgeDays = row.stockAgeDays ?? deriveStockAgeDays(row.inboundDate)
}

function deriveStockAgeDays(inboundDate?: string) {
  if (!inboundDate) return undefined
  const parsed = new Date(inboundDate)
  if (Number.isNaN(parsed.getTime())) return undefined
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000))
}

function applyWarrantySnapshot(
  row: InventoryMasterRow,
  warrantyRecord?: {
    status?: string
    officialWarrantyStart?: string
    officialWarrantyEnd?: string
  },
) {
  if (!warrantyRecord) return
  const start = normalizeDate(warrantyRecord.officialWarrantyStart)
  const end = normalizeDate(warrantyRecord.officialWarrantyEnd)
  if (start && !row.warrantyStart) row.warrantyStart = start
  if (end && !row.warrantyEnd) row.warrantyEnd = end
}

export async function buildInventoryMasterSnapshot(
  options: BuildInventoryMasterOptions = {},
): Promise<InventoryMasterSnapshot> {
  const files: SourceFileManifest = {
    stockQuantityFile: options.files?.stockQuantityFile ?? await findLatestStockQuantityExport(),
    stockSnFile: options.files?.stockSnFile ?? await findLatestStockSnExport(),
    stockStreamFile: options.files?.stockStreamFile,
    snStockOrderFile: options.files?.snStockOrderFile ?? await findLatestSnStockOrderExport(),
    stockOrderFile: options.files?.stockOrderFile ?? await findLatestStockOrderExport(),
  }

  const stockSummaryItems = files.stockQuantityFile ? await parseStockQuantityExport(files.stockQuantityFile) : []
  const serialItems = files.stockSnFile ? await parseStockSnExport(files.stockSnFile) : []
  const standardSnapshot = buildStandardInventorySnapshot({
    stockSummaryItems,
    serialItems,
    stockQuantityFile: files.stockQuantityFile,
    stockSnFile: files.stockSnFile,
  })

  const movementsPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-inventory-movements.json')
  const overridesPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-serial-overrides.json')
  const warrantyPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-lenovo-warranty-snapshot.json')
  const salesAuditPeriod = { from: '2026-05-01', to: '2026-05-14' }
  const [movementSnapshot, overrideSnapshot, warrantySnapshot, snStockOrderRows, stockOrderRows, salesAudit] = await Promise.all([
    readJsonIfExists<{ records?: InventoryMovementRecord[] }>(movementsPath),
    readJsonIfExists<{ overrides?: Record<string, SerialOverride> }>(overridesPath),
    readJsonIfExists<LenovoWarrantySnapshot>(warrantyPath),
    files.snStockOrderFile ? parseInventoryOrderExport(files.snStockOrderFile) : Promise.resolve([]),
    files.stockOrderFile ? parseInventoryOrderExport(files.stockOrderFile) : Promise.resolve([]),
    auditZhidiantongSalesSync(salesAuditPeriod.from, salesAuditPeriod.to),
  ])

  const movements = movementSnapshot?.records ?? await loadInventoryMovements()
  const overrides = overrideSnapshot?.overrides ?? await loadSerialOverrides()
  const warrantyBySerial = new Map(
    (warrantySnapshot?.records ?? [])
      .map((record) => [normalizeSerialNumber(record.serialNumber), record] as const)
      .filter(([serialKey]) => Boolean(serialKey)),
  )
  const { bySerial, bySku } = buildSnapshotSerialIndex(standardSnapshot)
  const coveredSerialKeys = new Set(bySerial.keys())
  const overrideEntries = Object.entries(overrides).map(([serialNumber, override]) => ({
    serialNumber,
    serialKey: normalizeSerialNumber(serialNumber),
    override,
  }))

  const movementBySerial = new Map<string, InventoryMovementRecord[]>()
  const movementBySku = new Map<string, InventoryMovementRecord[]>()
  for (const record of movements) {
    const skuGroup = movementBySku.get(record.skuKey) ?? []
    skuGroup.push(record)
    movementBySku.set(record.skuKey, skuGroup)

    const serialKey = normalizeSerialNumber(record.serialNumber)
    if (!serialKey) continue
    const group = movementBySerial.get(serialKey) ?? []
    group.push(record)
    movementBySerial.set(serialKey, group)
  }

  const snOrderBySerial = new Map<string, InventoryOrderRow[]>()
  for (const row of snStockOrderRows) {
    const serialKey = normalizeSerialNumber(row.serialNumber)
    if (!serialKey) continue
    const group = snOrderBySerial.get(serialKey) ?? []
    group.push(row)
    snOrderBySerial.set(serialKey, group)
  }

  const stockOrderByDocumentAndSku = new Map<string, InventoryOrderRow[]>()
  const stockOrderBySku = new Map<string, InventoryOrderRow[]>()
  for (const row of stockOrderRows) {
    const skuKey = row.skuKey
      || pickSkuKey(row.skuRaw)
      || (row.pnMtm ? Array.from(bySku.values()).find((sku) => normalizeLookupKey(sku.pnMtm) === normalizeLookupKey(row.pnMtm))?.skuKey : undefined)
    if (!skuKey) continue
    const bySkuGroup = stockOrderBySku.get(skuKey) ?? []
    bySkuGroup.push({ ...row, skuKey })
    stockOrderBySku.set(skuKey, bySkuGroup)

    const compositeKey = `${row.documentNumber}::${skuKey}`
    const byDocumentGroup = stockOrderByDocumentAndSku.get(compositeKey) ?? []
    byDocumentGroup.push({ ...row, skuKey })
    stockOrderByDocumentAndSku.set(compositeKey, byDocumentGroup)
  }

  const rows: InventoryMasterRow[] = []
  const exceptions: InventoryMasterExceptionRow[] = []
  const usedSnOrderRowKeys = new Set<string>()
  const usedStockOrderRowKeys = new Set<string>()

  for (const sku of standardSnapshot.skus) {
    if (sku.currentStock > 0 && sku.serials.length === 0) {
      exceptions.push({
        type: 'sku_without_serials',
        skuKey: sku.skuKey,
        message: `SKU ${sku.skuKey} 当前库存 ${sku.currentStock}，但商品库存SN导出没有对应序列号。`,
        sourceFile: files.stockSnFile,
      })
    }

    for (const serial of sku.serials) {
      const row = buildCanonicalRow(sku, serial)
      row.sourceRefs[0]!.filePath = files.stockSnFile

      const serialKey = normalizeSerialNumber(serial.serialNumber)
      applyWarrantySnapshot(row, warrantyBySerial.get(serialKey))
      const override = overrides[serial.serialNumber] ?? overrides[serialKey]
      if (override) applySerialOverride(row, override, overridesPath)

      const serialMovements = movementBySerial.get(serialKey) ?? []
      const skuMovements = movementBySku.get(row.skuKey) ?? []
      if (serialMovements.length > 0) {
        applyLatestMovement(row, serialMovements, movementsPath)
      } else if (skuMovements.length > 0) {
        applyInboundFromSkuMovements(row, skuMovements, movementsPath)
      }

      const snOrders = snOrderBySerial.get(serialKey) ?? []
      if (snOrders.length > 0) {
        applySnOrderEvidence(row, snOrders, files.snStockOrderFile)
        for (const item of snOrders) usedSnOrderRowKeys.add(item.rowKey)
      }

      const stockOrderCandidates = [
        ...(row.inboundDocumentNumber ? stockOrderByDocumentAndSku.get(`${row.inboundDocumentNumber}::${row.skuKey}`) ?? [] : []),
        ...((!row.inboundDocumentNumber && row.skuKey) ? (stockOrderBySku.get(row.skuKey) ?? []).slice(0, 1) : []),
      ]
      if (stockOrderCandidates.length > 0) {
        applyStockOrderEvidence(row, stockOrderCandidates, files.stockOrderFile)
        for (const item of stockOrderCandidates) usedStockOrderRowKeys.add(item.rowKey)
      }

      if (!row.inboundDate) row.dataQuality.warnings.push('缺少入库时间，需补 SN库存订单 或 库存流水 入库证据。')
      if (!row.inboundDocumentNumber) row.dataQuality.warnings.push('缺少入库单据号，当前主表仍不可直接追溯原始单据。')
      if (!row.latestBusinessDate) row.dataQuality.warnings.push('缺少最近一次库存流水证据。')

      rows.push(row)
    }

    const fallbackOverrides = overrideEntries
      .filter((item) => item.override.skuKey === sku.skuKey && item.serialKey && !coveredSerialKeys.has(item.serialKey))
      .sort((a, b) => compareBusinessDate(a.override.inboundDate, b.override.inboundDate))

    const shortage = Math.max(0, sku.currentStock - (sku.serials.length + fallbackOverrides.length))
    const fallbackLimit = shortage > 0 ? fallbackOverrides.length : Math.min(
      fallbackOverrides.length,
      Math.max(0, sku.currentStock - sku.serials.length),
    )

    for (const item of fallbackOverrides.slice(0, fallbackLimit)) {
      const row = buildFallbackRowFromOverride(sku, item.serialNumber, item.override)
      applyWarrantySnapshot(row, warrantyBySerial.get(item.serialKey))
      applySerialOverride(row, item.override, overridesPath)

      const serialMovements = movementBySerial.get(item.serialKey) ?? []
      const skuMovements = movementBySku.get(row.skuKey) ?? []
      if (serialMovements.length > 0) {
        applyLatestMovement(row, serialMovements, movementsPath)
      } else if (skuMovements.length > 0) {
        applyInboundFromSkuMovements(row, skuMovements, movementsPath)
      }

      const snOrders = snOrderBySerial.get(item.serialKey) ?? []
      if (snOrders.length > 0) {
        applySnOrderEvidence(row, snOrders, files.snStockOrderFile)
        for (const snOrder of snOrders) usedSnOrderRowKeys.add(snOrder.rowKey)
      }

      const stockOrderCandidates = [
        ...(row.inboundDocumentNumber ? stockOrderByDocumentAndSku.get(`${row.inboundDocumentNumber}::${row.skuKey}`) ?? [] : []),
        ...((!row.inboundDocumentNumber && row.skuKey) ? (stockOrderBySku.get(row.skuKey) ?? []).slice(0, 1) : []),
      ]
      if (stockOrderCandidates.length > 0) {
        applyStockOrderEvidence(row, stockOrderCandidates, files.stockOrderFile)
        for (const stockOrder of stockOrderCandidates) usedStockOrderRowKeys.add(stockOrder.rowKey)
      }

      if (!row.inboundDate) row.dataQuality.warnings.push('缺少入库时间，需继续从 SN库存订单 或 库存订单 补齐。')
      if (!row.inboundDocumentNumber) row.dataQuality.warnings.push('缺少入库单据号，当前主表仍不可直接追溯原始单据。')
      if (!row.latestBusinessDate) row.dataQuality.warnings.push('缺少最近一次库存流水证据。')

      coveredSerialKeys.add(item.serialKey)
      rows.push(row)
    }

    const representedCount = sku.serials.length + fallbackLimit
    const missingCount = Math.max(0, sku.currentStock - representedCount)
    if (missingCount > 0) {
      const row = buildAggregateRowWithoutSerial(sku, missingCount)
      const skuMovements = movementBySku.get(row.skuKey) ?? []
      if (skuMovements.length > 0) applyLatestMovement(row, skuMovements, movementsPath)

      const stockOrderCandidates = [
        ...((row.inboundDocumentNumber && row.skuKey) ? stockOrderByDocumentAndSku.get(`${row.inboundDocumentNumber}::${row.skuKey}`) ?? [] : []),
        ...(row.skuKey ? (stockOrderBySku.get(row.skuKey) ?? []).slice(0, 1) : []),
      ]
      if (stockOrderCandidates.length > 0) {
        applyStockOrderEvidence(row, stockOrderCandidates, files.stockOrderFile)
        for (const stockOrder of stockOrderCandidates) usedStockOrderRowKeys.add(stockOrder.rowKey)
      }

      if (!row.inboundDate) row.dataQuality.warnings.push('缺少入库时间，需继续从 库存流水入库 或 库存订单 补齐。')
      if (!row.inboundDocumentNumber) row.dataQuality.warnings.push('缺少入库单据号，当前主表仍不可直接追溯原始单据。')
      if (!row.latestBusinessDate) row.dataQuality.warnings.push('缺少最近一次库存流水证据。')

      rows.push(row)
    }
  }

  for (const item of overrideEntries) {
    if (!item.serialKey || coveredSerialKeys.has(item.serialKey)) continue
    const serialMovements = movementBySerial.get(item.serialKey) ?? []
    const latestMovement = [...serialMovements].sort((a, b) => compareBusinessDate(b.businessDate, a.businessDate))[0]
    if (!latestMovement || latestMovement.movementType !== 'transfer_inbound') continue

    const snOrders = snOrderBySerial.get(item.serialKey) ?? []
    if (snOrders.length === 0) continue

    const skuKey = item.override.skuKey ?? latestMovement.skuKey
    const sku = skuKey ? bySku.get(skuKey) : undefined
    if (!sku) continue

    const row = buildFallbackRowFromOverride(sku, item.serialNumber, item.override)
    applyWarrantySnapshot(row, warrantyBySerial.get(item.serialKey))
    applySerialOverride(row, item.override, overridesPath)
    applyLatestMovement(row, serialMovements, movementsPath)
    applySnOrderEvidence(row, snOrders, files.snStockOrderFile)
    for (const snOrder of snOrders) usedSnOrderRowKeys.add(snOrder.rowKey)

    const stockOrderCandidates = [
      ...(row.inboundDocumentNumber ? stockOrderByDocumentAndSku.get(`${row.inboundDocumentNumber}::${row.skuKey}`) ?? [] : []),
      ...((!row.inboundDocumentNumber && row.skuKey) ? (stockOrderBySku.get(row.skuKey) ?? []).slice(0, 1) : []),
    ]
    if (stockOrderCandidates.length > 0) {
      applyStockOrderEvidence(row, stockOrderCandidates, files.stockOrderFile)
      for (const stockOrder of stockOrderCandidates) usedStockOrderRowKeys.add(stockOrder.rowKey)
    }

    row.dataQuality.warnings.push('智店通线下门店退单已完成，但当前商品库存SN导出尚未回显；已按退单回库流水与 SN库存订单临时纳入当前在库。')
    coveredSerialKeys.add(item.serialKey)
    rows.push(row)
  }

  reconcileRowsWithCurrentLifecycle(rows)

  for (const [serialNumber, override] of Object.entries(overrides)) {
    const serialKey = normalizeSerialNumber(serialNumber)
    if (coveredSerialKeys.has(serialKey)) continue
    exceptions.push({
      type: 'override_serial_not_in_snapshot',
      serialNumber,
      skuKey: override.skuKey,
      documentNumber: override.documentNumber,
      sourceFile: overridesPath,
      message: `serial override 中的 SN ${serialNumber} 不在本次商品库存SN导出内，当前主表未纳入。`,
    })
  }

  for (const [serialKey, records] of movementBySerial.entries()) {
    if (bySerial.has(serialKey)) continue
    const latest = [...records].sort((a, b) => compareBusinessDate(b.businessDate, a.businessDate))[0]
    exceptions.push({
      type: 'movement_serial_not_in_snapshot',
      serialNumber: latest?.serialNumber,
      skuKey: latest?.skuKey,
      documentNumber: latest?.documentNumber,
      sourceFile: movementsPath,
      message: `库存流水中的 SN ${latest?.serialNumber ?? serialKey} 不在当前库存SN导出中，保留为历史流水，不进入当前在库主表。`,
    })
  }

  for (const row of snStockOrderRows) {
    if (usedSnOrderRowKeys.has(row.rowKey)) continue
    exceptions.push({
      type: 'unmatched_sn_stock_order',
      serialNumber: row.serialNumber,
      skuKey: row.skuKey,
      documentNumber: row.documentNumber,
      sourceFile: files.snStockOrderFile,
      rowKey: row.rowKey,
      message: `SN库存订单行未匹配到当前在库 SN：${row.serialNumber ?? row.documentNumber}`,
    })
  }

  for (const row of stockOrderRows) {
    if (usedStockOrderRowKeys.has(row.rowKey)) continue
    exceptions.push({
      type: 'unmatched_stock_order',
      skuKey: row.skuKey,
      documentNumber: row.documentNumber,
      sourceFile: files.stockOrderFile,
      rowKey: row.rowKey,
      message: `库存订单行未匹配到当前主表 SN：${row.documentNumber}${row.skuKey ? ` / ${row.skuKey}` : ''}`,
    })
  }

  const rowWithInboundDateCount = rows.filter((item) => Boolean(item.inboundDate)).length
  const rowWithInboundDocumentCount = rows.filter((item) => Boolean(item.inboundDocumentNumber)).length
  const rowWithLatestMovementCount = rows.filter((item) => Boolean(item.latestBusinessDate)).length
  const warnings = [...standardSnapshot.dataQuality.warnings]

  if (!files.snStockOrderFile) warnings.push('未找到 SN库存订单 导出文件；当前单据号/交易人员/库位补齐只能依赖 serial overrides 与 库存流水。')
  if (!files.stockOrderFile) warnings.push('未找到 库存订单 导出文件；当前不能对无 SN 的库存订单做数量级补证。')
  if (!files.stockQuantityFile) warnings.push('未找到 商品库存统计 导出文件；无法确认当前库存真值。')
  if (!files.stockSnFile) warnings.push('未找到 商品库存SN统计 导出文件；无法生成每 SN 一行主表。')
  if (salesAudit.consistency.status !== 'consistent') {
    warnings.push(...salesAudit.consistency.reasons.map((reason) => `销售一致性审计: ${reason}`))
  }

  return {
    source: 'lenovo-retail-web',
    generatedAt: new Date().toISOString(),
    files,
    totals: {
      rowCount: rows.length,
      skuCount: standardSnapshot.skus.length,
      inStockRowCount: rows.filter((item) => item.inStock).length,
      rowWithInboundDateCount,
      rowWithInboundDocumentCount,
      rowWithLatestMovementCount,
      skuWithoutSerialCount: exceptions.filter((item) => item.type === 'sku_without_serials').length,
      exceptionCount: exceptions.length,
    },
    coverage: {
      inboundDateCoverage: rows.length === 0 ? 0 : rowWithInboundDateCount / rows.length,
      inboundDocumentCoverage: rows.length === 0 ? 0 : rowWithInboundDocumentCount / rows.length,
      movementCoverage: rows.length === 0 ? 0 : rowWithLatestMovementCount / rows.length,
    },
    salesAuditSummary: {
      period: salesAudit.period,
      consistencyStatus: salesAudit.consistency.status,
      missingEvidenceDays: salesAudit.missingEvidenceDays,
      mismatchedHistoricalRecordCount: salesAudit.mismatchedHistoricalDates.length,
      localSalesByDate: salesAudit.localSalesMovements.byDate,
      historicalSalesByDate: salesAudit.historicalSalesArtifact?.byDate,
      daySummary: salesAudit.daySummary,
    },
    warnings,
    rows: rows.sort((a, b) => a.skuKey.localeCompare(b.skuKey) || a.serialNumber.localeCompare(b.serialNumber)),
    exceptions,
  }
}

export async function saveInventoryMasterSnapshot(snapshot: InventoryMasterSnapshot) {
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(webPublicDataDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.resolve(config.lenovoRetail.artifactDir, `${stamp}-inventory-master-snapshot.json`)
  const latestPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-inventory-master-snapshot.json')
  const webLatestPath = path.resolve(webPublicDataDir, 'latest-inventory-master-snapshot.json')
  const content = JSON.stringify(snapshot, null, 2)
  await fs.writeFile(filePath, content, 'utf-8')
  await fs.writeFile(latestPath, content, 'utf-8')
  await fs.writeFile(webLatestPath, content, 'utf-8')
  return { filePath, latestPath, webLatestPath }
}
