import fs from 'node:fs/promises'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'
import {
  type InventoryMovementRecord,
  loadInventoryMovements,
  loadSerialOverrides,
  saveInventoryMovements,
  saveSerialOverrides,
  type SerialOverride,
} from '../inventoryQuote/dataService.js'

type Cell = string | number | boolean | Date | null

type ImportStockStreamResult = {
  sourceFile: string
  importedCount: number
  overrideCount: number
  mergedRecordCount: number
  mergedOverrideCount: number
  skippedCount: number
  warnings: string[]
  files: Awaited<ReturnType<typeof saveInventoryMovements>>['files']
  serialOverrideFiles: Awaited<ReturnType<typeof saveSerialOverrides>>['files']
  sample: InventoryMovementRecord[]
}

type ParsedStreamRow = {
  movementType: InventoryMovementRecord['movementType']
  businessDate: string
  documentNumber: string
  sourceDocumentType: string
  skuKey: string
  productName?: string
  pnMtm?: string
  spec?: string
  unitName?: string
  operatorName?: string
  supplierName?: string
  storeName?: string
  locationName?: string
  unitCost?: number
  amount?: number
  quantity: number
  serialNumbers: string[]
  note: string
}

function normalizeCell(cell: Cell) {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 19)
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
  throw new Error(`暂不支持的库存流水导出格式：${extension || 'unknown'}；请导出为 .xlsx 或 .csv`)
}

function normalizeDate(value: string) {
  const numericDate = Number(value)
  if (Number.isFinite(numericDate) && numericDate > 25000 && numericDate < 70000) {
    const millisecondsPerDay = 24 * 60 * 60 * 1000
    const excelEpoch = Date.UTC(1899, 11, 30)
    const date = new Date(excelEpoch + numericDate * millisecondsPerDay)
    const pad = (input: number) => String(input).padStart(2, '0')
    return [
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    ].join(' ')
  }
  const normalized = value
    .replace('T', ' ')
    .replace(/Z$/i, '')
    .replace(/[./年]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .trim()
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (!match) return new Date().toISOString().slice(0, 19).replace('T', ' ')
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
}

function splitSerials(value: string) {
  return [...new Set(
    value
      .split(/[\s,，;；/|]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )]
}

function normalizeLookupKey(value: string | undefined) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function normalizeSerialNumber(value: string | undefined) {
  return normalizeLookupKey(value)
}

function pickSkuKey(raw: string) {
  const text = raw.trim()
  const exact = text.match(/\b(\d{8})\b/)
  return exact?.[1]
}

function parseQuantity(raw: string) {
  const value = Number(String(raw || '').replace(/[^\d.-]/g, '').trim())
  if (!Number.isFinite(value)) return 0
  return Math.abs(value)
}

function hasStockStreamHeaders(header: string[]) {
  const hasBizType = ['业务类型', '出入库类型', '流水类型', '单据类型', '类型', '业务单据类型', '入出库类型'].some((name) => header.includes(name))
  const hasDoc = ['单据编号', '业务单号', '业务单编号', '单号', '单据号', '业务单据编号'].some((name) => header.includes(name))
  const hasDate = ['业务时间', '业务日期', '创建时间', '操作时间', '交易日期', '交易时间'].some((name) => header.includes(name))
  const hasProduct = ['商品名称', '货品名称', '商品信息', '商品明细'].some((name) => header.includes(name))
  const hasQuantity = ['数量', '变动数量', '出入库数量', '库存变化数量', '入出库数'].some((name) => header.includes(name))
  const hasSerial = ['SN', '序列号', '商品SN', '设备SN'].some((name) => header.includes(name))
  return hasBizType && hasDoc && hasDate && hasProduct && (hasQuantity || hasSerial)
}

async function findLatestStockStreamImport() {
  const searchDirs = [path.resolve(config.lenovoRetail.artifactDir, 'manual'), config.lenovoRetail.downloadDir, config.lenovoRetail.artifactDir]
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    const files = await fs.readdir(searchDir).catch(() => [])
    for (const file of files) {
      if (!/\.(xlsx|csv)$/i.test(file)) continue
      const filePath = path.resolve(searchDir, file)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      matched.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  for (const item of matched.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const rows = await readRows(item.filePath).catch(() => [])
    const header = normalizeHeader(rows[0] ?? [])
    if (hasStockStreamHeaders(header)) return item.filePath
  }
  return undefined
}

async function loadInventorySnapshot() {
  const snapshotPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  return JSON.parse(await fs.readFile(snapshotPath, 'utf-8')) as StandardInventorySnapshot
}

function buildSkuResolver(snapshot: StandardInventorySnapshot) {
  const byCode = new Map<string, string>()
  const byName = new Map<string, string>()
  const byPn = new Map<string, string>()
  const bySerial = new Map<string, { skuKey: string; serialNumber: string }>()
  const nameCandidates = new Map<string, Set<string>>()

  for (const sku of snapshot.skus) {
    const values = [sku.skuKey, sku.productCode, sku.skuCode]
    for (const value of values) {
      const key = pickSkuKey(String(value ?? ''))
      if (key) byCode.set(key, sku.skuKey)
    }
    if (sku.productName) {
      const nameKey = normalizeLookupKey(sku.productName)
      const candidates = nameCandidates.get(nameKey) ?? new Set<string>()
      candidates.add(sku.skuKey)
      nameCandidates.set(nameKey, candidates)
    }
    if (sku.pnMtm) byPn.set(normalizeLookupKey(sku.pnMtm), sku.skuKey)
    for (const serial of sku.serials ?? []) {
      const serialNumber = normalizeSerialNumber(serial.serialNumber)
      if (serialNumber) bySerial.set(serialNumber, { skuKey: sku.skuKey, serialNumber: serial.serialNumber.trim() })
    }
  }

  for (const [nameKey, candidates] of nameCandidates.entries()) {
    if (candidates.size === 1) byName.set(nameKey, [...candidates][0]!)
  }

  return (input: { skuRaw?: string; productName?: string; pnMtm?: string; serialNumber?: string }) => {
    const serialKey = normalizeSerialNumber(input.serialNumber)
    if (serialKey && bySerial.has(serialKey)) return bySerial.get(serialKey)
    const direct = pickSkuKey(input.skuRaw ?? '')
    if (direct) return { skuKey: byCode.get(direct) ?? direct }
    const pnKey = normalizeLookupKey(input.pnMtm)
    if (pnKey && byPn.has(pnKey)) return { skuKey: byPn.get(pnKey)! }
    const nameKey = normalizeLookupKey(input.productName)
    if (nameKey && byName.has(nameKey)) return { skuKey: byName.get(nameKey)! }
    return undefined
  }
}

function mapMovementType(rawType: string, rawDirection: string, quantityRaw: string, documentNumber = '') {
  const type = `${rawType} ${rawDirection}`.replace(/\s+/g, '')
  const documentPrefix = documentNumber.trim().toUpperCase()
  if (/销售出库|零售出库|订单出库/.test(type)) return 'sales_outbound' as const
  if (/商品入库|采购入库|入库/.test(type) && !/调拨/.test(type) && !/其他/.test(type) && !/其它/.test(type)) return 'purchase_inbound' as const
  if (/其他出库|其它出库|调拨出库|出库/.test(type)) return 'transfer_outbound' as const
  if (/其他入库|其它入库|调拨入库/.test(type)) return 'transfer_inbound' as const
  if (/^CGR/.test(documentPrefix)) return 'purchase_inbound' as const
  if (/^(XSD|XS|LSD|LS)/.test(documentPrefix)) return 'sales_outbound' as const
  if (/盘亏/.test(type)) return 'transfer_outbound' as const
  if (/盘盈|调整入库/.test(type)) return 'transfer_inbound' as const

  const numeric = Number(String(quantityRaw || '').replace(/[^\d.-]/g, '').trim())
  if (Number.isFinite(numeric) && numeric < 0) return 'transfer_outbound' as const
  if (Number.isFinite(numeric) && numeric > 0) return 'transfer_inbound' as const
  return undefined
}

function buildMovementId(
  movementType: InventoryMovementRecord['movementType'],
  documentNumber: string,
  skuKey: string,
  serialNumber: string | undefined,
  rowIndex: number,
) {
  if (movementType === 'sales_outbound') {
    return serialNumber ? `SALE-${documentNumber}-${serialNumber}` : `SALEQ-${documentNumber}-${skuKey}-ROW${rowIndex + 1}`
  }
  if (movementType === 'purchase_inbound') {
    return serialNumber ? `PURCHASE-${documentNumber}-${serialNumber}` : `PURCHASEQ-${documentNumber}-${skuKey}-ROW${rowIndex + 1}`
  }
  if (movementType === 'transfer_outbound') {
    return serialNumber ? `${documentNumber}-${skuKey}-${serialNumber}` : `OTHEROUTQ-${documentNumber}-${skuKey}-ROW${rowIndex + 1}`
  }
  if (movementType === 'transfer_inbound') {
    return serialNumber ? `TRANSFERIN-${documentNumber}-${serialNumber}` : `TRANSFERINQ-${documentNumber}-${skuKey}-ROW${rowIndex + 1}`
  }
  return `ADJUST-${documentNumber}-${skuKey}-${serialNumber ?? `ROW${rowIndex + 1}`}`
}

function mergeRecords(existing: InventoryMovementRecord[], incoming: InventoryMovementRecord[]) {
  const serialQuantityByDocumentSku = new Map<string, number>()
  for (const item of [...existing, ...incoming]) {
    if (!item.serialNumber) continue
    const key = `${item.movementType}::${item.documentNumber ?? ''}::${item.skuKey}`
    serialQuantityByDocumentSku.set(key, (serialQuantityByDocumentSku.get(key) ?? 0) + item.quantity)
  }

  const map = new Map(
    existing
      .filter((item) => {
        if (item.serialNumber) return true
        const key = `${item.movementType}::${item.documentNumber ?? ''}::${item.skuKey}`
        return (serialQuantityByDocumentSku.get(key) ?? 0) < item.quantity
      })
      .map((item) => [item.id, item]),
  )
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()]
    .filter((item) => {
      if (item.serialNumber) return true
      const key = `${item.movementType}::${item.documentNumber ?? ''}::${item.skuKey}`
      return (serialQuantityByDocumentSku.get(key) ?? 0) < item.quantity
    })
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
}

function mergeOverrides(existing: Record<string, SerialOverride>, incoming: Record<string, SerialOverride>) {
  return {
    ...existing,
    ...incoming,
  }
}

function parseRows(
  rows: Cell[][],
  resolveSkuKey: (input: { skuRaw?: string; productName?: string; pnMtm?: string; serialNumber?: string }) => { skuKey: string; serialNumber?: string } | undefined,
) {
  const [headerRow, ...dataRows] = rows
  const header = normalizeHeader(headerRow ?? [])
  const parsed: ParsedStreamRow[] = []
  const warnings: string[] = []
  let skippedCount = 0

  for (const [rowIndex, row] of dataRows.entries()) {
    const rawType = getFirstCell(row, header, ['业务类型', '出入库类型', '流水类型', '单据类型', '类型', '业务单据类型'])
    const rawDirection = getFirstCell(row, header, ['出入方向', '方向', '库存方向', '入出库类型', '入出库方式'])
    const documentNumber = getFirstCell(row, header, ['单据编号', '业务单号', '业务单编号', '单号', '单据号', '业务单据编号'])
    const movementType = mapMovementType(rawType, rawDirection, getFirstCell(row, header, ['数量', '变动数量', '出入库数量', '库存变化数量', '入出库数']), documentNumber)
    const businessDate = normalizeDate(getFirstCell(row, header, ['业务时间', '业务日期', '创建时间', '操作时间', '交易日期', '交易时间']))
    const skuRaw = getFirstCell(row, header, ['SKU编码', '商品编码', 'SKU', '货号'])
    const productName = getFirstCell(row, header, ['商品名称', '货品名称', '商品信息', '商品明细'])
    const pnMtm = getFirstCell(row, header, ['PN/MTM', 'MTM', 'PN'])
    const spec = getFirstCell(row, header, ['规格', '商品规格'])
    const serialNumbers = splitSerials(getFirstCell(row, header, ['SN', '序列号', '商品SN', '设备SN']))
    const rawQuantity = getFirstCell(row, header, ['数量', '变动数量', '出入库数量', '库存变化数量', '入出库数'])
    const quantity = rawQuantity ? parseQuantity(rawQuantity) : serialNumbers.length
    const operatorName = getFirstCell(row, header, ['操作人', '经手人', '制单人', '业务员', '交易人员'])
    const supplierName = getFirstCell(row, header, ['供应商', '往来单位'])
      || (movementType === 'purchase_inbound' || movementType === 'transfer_inbound' ? '联想' : '')
    const storeName = getFirstCell(row, header, ['组织名称', '门店', '门店名称', '门店/仓库名称'])
    const locationName = getFirstCell(row, header, ['库位', '仓库', '仓库名称', '库位名称', '门店/仓库名称'])
    const sourceDocumentType = rawType || rawDirection || '库存流水'
    const note = `智店通库存流水导出导入，单据 ${documentNumber || `ROW${rowIndex + 1}`}`

    if (!movementType || !documentNumber || !quantity) {
      skippedCount += 1
      continue
    }

    const resolvedBySerial: Array<{ skuKey: string; serialNumber: string }> = []
    for (const serialNumber of serialNumbers) {
      const resolved = resolveSkuKey({ skuRaw, productName, pnMtm, serialNumber })
      if (!resolved?.skuKey) {
        warnings.push(`库存流水 ${documentNumber} 的 SN ${serialNumber} 未匹配到库存 SKU：${productName || skuRaw || pnMtm || 'unknown'}`)
        continue
      }
      resolvedBySerial.push({
        skuKey: resolved.skuKey,
        serialNumber: resolved.serialNumber?.trim() || serialNumber,
      })
    }

    const fallbackResolved = resolveSkuKey({ skuRaw, productName, pnMtm })
    const skuKey = resolvedBySerial[0]?.skuKey ?? fallbackResolved?.skuKey
    if (!skuKey) {
      skippedCount += 1
      warnings.push(`库存流水 ${documentNumber} 未匹配到 SKU：${productName || skuRaw || pnMtm || 'unknown'}`)
      continue
    }

    parsed.push({
      movementType,
      businessDate,
      documentNumber,
      sourceDocumentType,
      skuKey,
      productName: productName || undefined,
      pnMtm: pnMtm || undefined,
      spec: spec || undefined,
      unitName: getFirstCell(row, header, ['单位', '计量单位']) || undefined,
      operatorName: operatorName || undefined,
      supplierName: supplierName || undefined,
      storeName: storeName || undefined,
      locationName: locationName || undefined,
      unitCost: getOptionalNumber(row, header, ['成本单价', '单价', '进货价', '采购价', '成本价']),
      amount: getOptionalNumber(row, header, ['金额', '总金额', '成本金额']),
      quantity,
      serialNumbers: resolvedBySerial.map((item) => item.serialNumber).filter(Boolean),
      note,
    })
  }

  return { parsed, warnings, skippedCount }
}

export async function importZhidiantongStockStream(inputFile?: string): Promise<ImportStockStreamResult> {
  const sourceFile = inputFile ? path.resolve(inputFile) : await findLatestStockStreamImport()
  if (!sourceFile) throw new Error('未找到智店通库存流水导出文件。')

  const rows = await readRows(sourceFile)
  const header = normalizeHeader(rows[0] ?? [])
  if (!hasStockStreamHeaders(header)) throw new Error('库存流水导出表头未识别，请确认导出的确是“库存流水” Excel/CSV。')

  const inventorySnapshot = await loadInventorySnapshot()
  const resolveSkuKey = buildSkuResolver(inventorySnapshot)
  const { parsed, warnings, skippedCount } = parseRows(rows, resolveSkuKey)

  const updatedAt = new Date().toISOString()
  const records: InventoryMovementRecord[] = []
  const overrides: Record<string, SerialOverride> = {}

  for (const [rowIndex, row] of parsed.entries()) {
    for (const serialNumber of row.serialNumbers) {
      records.push({
        id: buildMovementId(row.movementType, row.documentNumber, row.skuKey, serialNumber, rowIndex),
        skuKey: row.skuKey,
        quantity: 1,
        movementType: row.movementType,
        businessDate: row.businessDate,
        serialNumber,
        documentNumber: row.documentNumber,
        sourceDocumentType: row.sourceDocumentType,
        operatorName: row.operatorName,
        supplierName: row.supplierName,
        storeName: row.storeName,
        locationName: row.locationName,
        productName: row.productName,
        pnMtm: row.pnMtm,
        spec: row.spec,
        unitName: row.unitName,
        unitCost: row.unitCost,
        amount: row.amount,
        note: row.note,
        updatedAt,
      })

      if (row.movementType === 'purchase_inbound' || row.movementType === 'transfer_inbound') {
        overrides[serialNumber] = {
          skuKey: row.skuKey,
          inboundDate: row.businessDate,
          purchaseCost: row.unitCost,
          documentNumber: row.documentNumber,
          operatorName: row.operatorName,
          supplierName: row.supplierName,
          storeName: row.storeName,
          locationName: row.locationName,
          productName: row.productName,
          pnMtm: row.pnMtm,
          spec: row.spec,
          note: row.note,
          updatedAt,
        }
      }
    }

    const remainingQuantity = Math.max(row.quantity - row.serialNumbers.length, 0)
    if (remainingQuantity > 0) {
      records.push({
        id: buildMovementId(row.movementType, row.documentNumber, row.skuKey, undefined, rowIndex),
        skuKey: row.skuKey,
        quantity: remainingQuantity,
        movementType: row.movementType,
        businessDate: row.businessDate,
        documentNumber: row.documentNumber,
        sourceDocumentType: row.sourceDocumentType,
        operatorName: row.operatorName,
        supplierName: row.supplierName,
        storeName: row.storeName,
        locationName: row.locationName,
        productName: row.productName,
        pnMtm: row.pnMtm,
        spec: row.spec,
        unitName: row.unitName,
        unitCost: row.unitCost,
        amount: row.amount,
        note: row.note,
        updatedAt,
      })
    }
  }

  const mergedRecords = mergeRecords(await loadInventoryMovements(), records)
  const mergedOverrides = mergeOverrides(await loadSerialOverrides(), overrides)
  const movementSave = await saveInventoryMovements(mergedRecords)
  const overrideSave = await saveSerialOverrides(mergedOverrides)

  return {
    sourceFile,
    importedCount: records.length,
    overrideCount: Object.keys(overrides).length,
    mergedRecordCount: mergedRecords.length,
    mergedOverrideCount: Object.keys(mergedOverrides).length,
    skippedCount,
    warnings: Array.from(new Set(warnings)).slice(0, 200),
    files: movementSave.files,
    serialOverrideFiles: overrideSave.files,
    sample: records.slice(0, 12),
  }
}
