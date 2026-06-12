import fs from 'node:fs/promises'
import path from 'node:path'
import XLSX from 'xlsx'
import { config } from '../config.js'
import type { LenovoRetailSerialItem, LenovoRetailStockSummaryItem } from '../types.js'

type ExcelCell = string | number | boolean | Date | null

function normalizeCell(cell: ExcelCell) {
  if (cell === null || cell === undefined) return ''
  return String(cell).trim()
}

function normalizeHeader(row: ExcelCell[]) {
  return row.map(normalizeCell)
}

function getCell(row: ExcelCell[], header: string[], name: string) {
  const index = header.indexOf(name)
  if (index < 0) return ''
  return normalizeCell(row[index])
}

function getFirstCell(row: ExcelCell[], header: string[], names: string[]) {
  for (const name of names) {
    const value = getCell(row, header, name)
    if (value) return value
  }
  return ''
}

function getNumber(row: ExcelCell[], header: string[], name: string) {
  const value = getCell(row, header, name).replace(/[^\d.-]/g, '')
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getOptionalNumber(row: ExcelCell[], header: string[], names: string[]) {
  const value = getFirstCell(row, header, names).replace(/[^\d.-]/g, '')
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getOptionalDate(row: ExcelCell[], header: string[], names: string[]) {
  const raw = getFirstCell(row, header, names)
  if (!raw) return undefined
  const normalized = raw.replace(/[./年]/g, '-').replace(/月/g, '-').replace(/日/g, '').trim()
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return raw
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

async function listFilesByPrefix(prefix: string) {
  await fs.mkdir(config.lenovoRetail.downloadDir, { recursive: true })
  const searchDirs = [config.lenovoRetail.downloadDir]
  const matched = []
  for (const searchDir of searchDirs) {
    const files = await fs.readdir(searchDir).catch(() => [])
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith('.xlsx')) continue
      const filePath = path.resolve(searchDir, file)
      const stat = await fs.stat(filePath)
      matched.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  return matched.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export async function findLatestStockQuantityExport() {
  return (await listFilesByPrefix('商品库存统计_'))[0]?.filePath
}

export async function findLatestStockSnExport() {
  return (await listFilesByPrefix('商品库存SN统计_'))[0]?.filePath
}

export async function parseStockQuantityExport(filePath: string): Promise<LenovoRetailStockSummaryItem[]> {
  const rows = await readWorkbookRows(filePath)
  const [headerRow, ...dataRows] = rows
  const header = normalizeHeader(headerRow ?? [])

  const items: LenovoRetailStockSummaryItem[] = []
  for (const row of dataRows) {
    const productName = getCell(row, header, '商品名称')
    const productCode = getCell(row, header, '商品编码')
    const skuCode = getCell(row, header, 'SKU编码')
    if (!productName || !productCode || !skuCode) continue

    items.push({
      source: 'lenovo-retail-web',
      productName,
      pnMtm: getCell(row, header, 'PN/MTM'),
      spec: getCell(row, header, '规格'),
      currentStock: getNumber(row, header, '现有库存'),
      sellableStock: getNumber(row, header, '可售库存'),
      occupiedStock: getNumber(row, header, '占用库存'),
      unsellableStock: getNumber(row, header, '不可售库存'),
      pendingInboundStock: getNumber(row, header, '待入库库存'),
      category: getCell(row, header, '分类'),
      productCode,
      skuCode,
      organizationName: getCell(row, header, '组织名称'),
      organizationCode: getCell(row, header, '组织编码'),
      stockType: getCell(row, header, '库存类型'),
      raw: { sourceFile: filePath, row: row.map(normalizeCell) },
    })
  }
  return items
}

export async function parseStockSnExport(filePath: string): Promise<LenovoRetailSerialItem[]> {
  const rows = await readWorkbookRows(filePath)
  const [headerRow, ...dataRows] = rows
  const header = normalizeHeader(headerRow ?? [])

  const items: LenovoRetailSerialItem[] = []
  for (const row of dataRows) {
    const serialNumber = getCell(row, header, 'SN')
    const productName = getCell(row, header, '商品名称')
    if (!serialNumber || !productName) continue

    items.push({
      source: 'lenovo-retail-web',
      storeName: getCell(row, header, '组织名称'),
      locationName: getCell(row, header, '组织名称'),
      locationType: 'store',
      skuCode: getCell(row, header, 'SKU编码'),
      productName,
      mtm: getCell(row, header, 'PN/MTM'),
      model: getCell(row, header, 'PN/MTM'),
      serialNumber,
      inboundDate: getOptionalDate(row, header, ['进货时间', '入库时间', '入库日期', '采购日期', '到货日期']),
      purchaseCost: getOptionalNumber(row, header, ['进货价', '采购价', '采购成本', '入库成本']),
      stockAgeDays: getOptionalNumber(row, header, ['库龄', '库存天数', '在库天数']),
      warrantyStart: getOptionalDate(row, header, ['保修开始', '保修开始日期', '质保开始', '质保开始日期']),
      warrantyEnd: getOptionalDate(row, header, ['保修结束', '保修截止', '保修截止日期', '质保结束', '质保截止', '质保截止日期']),
      raw: {
        sourceFile: filePath,
        spec: getCell(row, header, '规格'),
        category: getCell(row, header, '分类'),
        productCode: getCell(row, header, '商品编码'),
        organizationCode: getCell(row, header, '组织编码'),
        productSource: getCell(row, header, '商品来源'),
        row: row.map(normalizeCell),
      },
    })
  }
  return items
}

async function readWorkbookRows(filePath: string): Promise<ExcelCell[][]> {
  const workbook = XLSX.readFile(filePath, { cellDates: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []

  const worksheet = workbook.Sheets[firstSheetName]
  if (!worksheet) return []

  const keys = Object.keys(worksheet).filter((key) => !key.startsWith('!'))
  if (keys.length === 0) return []

  let maxRow = 0
  let maxCol = 0
  for (const key of keys) {
    const match = key.match(/^([A-Z]+)(\d+)$/)
    if (!match) continue
    const [, colLetters, rowText] = match
    const row = Number(rowText)
    if (Number.isFinite(row) && row > maxRow) maxRow = row

    let col = 0
    for (const letter of colLetters) col = col * 26 + letter.charCodeAt(0) - 64
    if (col > maxCol) maxCol = col
  }

  if (maxRow > 0 && maxCol > 0) {
    worksheet['!ref'] = XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: maxCol - 1, r: maxRow - 1 },
    })
  }

  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
  }) as ExcelCell[][]
}
