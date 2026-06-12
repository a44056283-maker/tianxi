import fs from 'node:fs/promises'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { config } from '../config.js'
import { loadInventoryMovements } from '../inventoryQuote/dataService.js'

type Cell = string | number | boolean | Date | null

type AuditSourceFile = {
  filePath: string
  kind: 'sales_export' | 'stock_stream' | 'historical_sales_artifact'
  discoveredBy: 'filename' | 'header' | 'fixed_artifact'
  rowCount?: number
  salesRowCount?: number
  orderCount?: number
  dateCoverage: string[]
  notes: string[]
}

type AuditMismatch = {
  id: string
  localBusinessDate: string
  historicalBusinessDate: string
}

export type SalesAuditDaySummary = {
  date: string
  localSalesCount: number
  historicalSalesCount: number
  sourceEvidenceRowCount: number
  sourceEvidenceKinds: Array<'sales_export' | 'stock_stream' | 'historical_sales_artifact'>
  hasSourceEvidence: boolean
  hasLocalSales: boolean
  status: 'covered' | 'local_only' | 'evidence_only' | 'missing'
}

export type SalesSyncAuditReport = {
  generatedAt: string
  period: {
    from: string
    to: string
  }
  sourceFiles: AuditSourceFile[]
  localSalesMovements: {
    count: number
    byDate: Record<string, number>
    orderCount: number
  }
  historicalSalesArtifact?: {
    path: string
    count: number
    byDate: Record<string, number>
  }
  daySummary: SalesAuditDaySummary[]
  missingEvidenceDays: string[]
  mismatchedHistoricalDates: AuditMismatch[]
  consistency: {
    status: 'consistent' | 'inconsistent' | 'insufficient_evidence'
    reasons: string[]
  }
  rerun: {
    canReplayCurrentSalesExport: boolean
    canReplayUnifiedStockStream: boolean
    commands: string[]
    blockers: string[]
  }
}

function listDates(from: string, to: string) {
  const dates: string[] = []
  let cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor.getTime() + 86400000)
  }
  return dates
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
  }
  return []
}

function hasSalesHeaders(header: string[]) {
  const hasOrder = ['订单编号', '订单号', '单号', '销售单号', '业务单编号'].some((name) => header.includes(name))
  const hasSerial = ['SN', '序列号', '商品SN', '设备SN'].some((name) => header.includes(name))
  const hasSkuIdentity = ['SKU编码', '商品编码', 'SKU', '货号', 'PN/MTM', 'MTM', 'PN', '商品名称', '货品名称', '商品信息']
    .some((name) => header.includes(name))
  return hasOrder && hasSerial && hasSkuIdentity
}

function hasStockStreamHeaders(header: string[]) {
  const hasBizType = ['业务类型', '出入库类型', '流水类型', '单据类型', '类型'].some((name) => header.includes(name))
  const hasDoc = ['单据编号', '业务单号', '业务单编号', '单号', '单据号'].some((name) => header.includes(name))
  const hasDate = ['业务时间', '业务日期', '创建时间', '操作时间'].some((name) => header.includes(name))
  const hasProduct = ['商品名称', '货品名称', '商品信息', '商品明细'].some((name) => header.includes(name))
  const hasQuantity = ['数量', '变动数量', '出入库数量', '库存变化数量', '入出库数'].some((name) => header.includes(name))
  return hasBizType && hasDoc && hasDate && hasProduct && hasQuantity
}

function normalizeDate(value: string) {
  const normalized = value
    .replace('T', ' ')
    .replace(/Z$/i, '')
    .replace(/[./年]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .trim()
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return undefined
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function inferDateFromOrderNo(orderNo: string) {
  const match = orderNo.trim().match(/^[A-Z]{2}(\d{2})(\d{2})(\d{2})\d+/i)
  if (!match) return undefined
  const [, year, month, day] = match
  return `20${year}-${month}-${day}`
}

function inferDateFromFilePath(filePath: string) {
  const match = filePath.match(/(20\d{2})-(\d{2})-(\d{2})/)
  if (!match) return undefined
  const [, year, month, day] = match
  return `${year}-${month}-${day}`
}

function isInRange(date: string | undefined, from: string, to: string) {
  return Boolean(date && date >= from && date <= to)
}

function extractOrderNoFromMovementId(id: string) {
  const match = id.match(/^(?:SALE|SALEQ)-([A-Z]{2}\d+)/)
  return match?.[1]
}

function summarizeByDate(dates: string[]) {
  const byDate: Record<string, number> = {}
  for (const date of dates) byDate[date] = (byDate[date] ?? 0) + 1
  return byDate
}

function mapStockMovementType(rawType: string, rawDirection: string, quantityRaw: string) {
  const type = `${rawType} ${rawDirection}`.replace(/\s+/g, '')
  if (/销售出库|零售出库/.test(type)) return 'sales_outbound'
  const numeric = Number(String(quantityRaw || '').replace(/[^\d.-]/g, '').trim())
  if (Number.isFinite(numeric) && numeric < 0 && /出库/.test(type)) return 'sales_outbound'
  return undefined
}

async function findCandidateFiles() {
  const manualDir = path.resolve(config.lenovoRetail.artifactDir, 'manual')
  const searchDirs = [manualDir, config.lenovoRetail.artifactDir, config.lenovoRetail.downloadDir]
  const files = new Set<string>()
  for (const dir of searchDirs) {
    const entries = await fs.readdir(dir).catch(() => [])
    for (const entry of entries) {
      if (!/\.(xlsx|csv)$/i.test(entry)) continue
      if (!/(zhidiantong-sales-export|zhidiantong-stock-stream|库存流水|stock_count|orderProductData)/i.test(entry)) continue
      files.add(path.resolve(dir, entry))
    }
  }
  return [...files].sort()
}

async function inspectSourceFile(filePath: string, from: string, to: string): Promise<AuditSourceFile | undefined> {
  const rows = await readRows(filePath).catch(() => [])
  const header = normalizeHeader(rows[0] ?? [])
  if (!header.length) return undefined

  if (hasSalesHeaders(header)) {
    const dataRows = rows.slice(1)
    const orderDates: string[] = []
    const orderNos = new Set<string>()
    for (const row of dataRows) {
      const orderNo = getFirstCell(row, header, ['订单编号', '订单号', '单号', '销售单号', '业务单编号'])
      if (!orderNo) continue
      const rawDate = getFirstCell(row, header, ['完成时间', '支付时间', '销售时间', '下单时间', '创建时间'])
      const date = normalizeDate(rawDate) ?? inferDateFromOrderNo(orderNo) ?? inferDateFromFilePath(filePath)
      if (!isInRange(date, from, to)) continue
      orderNos.add(orderNo)
      if (date) orderDates.push(date)
    }
    return {
      filePath,
      kind: 'sales_export',
      discoveredBy: 'header',
      rowCount: Math.max(rows.length - 1, 0),
      salesRowCount: orderDates.length,
      orderCount: orderNos.size,
      dateCoverage: [...new Set(orderDates)].sort(),
      notes: header.some((name) => ['完成时间', '支付时间', '销售时间', '下单时间', '创建时间'].includes(name))
        ? []
        : ['文件缺少显式日期列，审计与重跑需要从订单号或文件名推断业务日期。'],
    }
  }

  if (hasStockStreamHeaders(header) || /stock_count|库存流水|zhidiantong-stock-stream/i.test(path.basename(filePath))) {
    const dataRows = rows.slice(1)
    const salesDates: string[] = []
    for (const row of dataRows) {
      const movementType = mapStockMovementType(
        getFirstCell(row, header, ['业务类型', '出入库类型', '流水类型', '单据类型', '类型']),
        getFirstCell(row, header, ['出入方向', '方向', '库存方向']),
        getFirstCell(row, header, ['数量', '变动数量', '出入库数量', '库存变化数量', '入出库数']),
      )
      if (movementType !== 'sales_outbound') continue
      const date = normalizeDate(getFirstCell(row, header, ['业务时间', '业务日期', '创建时间', '操作时间']))
      if (!isInRange(date, from, to)) continue
      salesDates.push(date!)
    }
    return {
      filePath,
      kind: 'stock_stream',
      discoveredBy: hasStockStreamHeaders(header) ? 'header' : 'filename',
      rowCount: Math.max(rows.length - 1, 0),
      salesRowCount: salesDates.length,
      orderCount: salesDates.length,
      dateCoverage: [...new Set(salesDates)].sort(),
      notes: salesDates.length ? [] : ['文件存在，但目标时段内未发现销售出库行。'],
    }
  }

  return undefined
}

async function loadHistoricalSalesArtifact(from: string, to: string) {
  const filePath = path.resolve(config.lenovoRetail.artifactDir, '2026-05-12-zhidiantong-sales-outbound-import.json')
  const content = await fs.readFile(filePath, 'utf-8').catch(() => undefined)
  if (!content) return undefined
  const parsed = JSON.parse(content) as { records?: Array<{ id: string; movementType?: string; businessDate?: string }> }
  const records = (parsed.records ?? []).filter((record) => record.movementType === 'sales_outbound' && isInRange(record.businessDate, from, to))
  return {
    path: filePath,
    records,
    byDate: summarizeByDate(records.map((record) => record.businessDate!)),
  }
}

export async function auditZhidiantongSalesSync(from = '2026-05-01', to = '2026-05-14'): Promise<SalesSyncAuditReport> {
  const sourceFiles = (await Promise.all((await findCandidateFiles()).map((filePath) => inspectSourceFile(filePath, from, to))))
    .filter((item): item is AuditSourceFile => Boolean(item))
  const localRecords = (await loadInventoryMovements())
    .filter((record) => record.movementType === 'sales_outbound' && isInRange(record.businessDate, from, to))
  const localByDate = summarizeByDate(localRecords.map((record) => record.businessDate))
  const localOrders = new Set(localRecords.map((record) => extractOrderNoFromMovementId(record.id)).filter(Boolean))

  const historical = await loadHistoricalSalesArtifact(from, to)
  const localById = new Map(localRecords.map((record) => [record.id, record.businessDate]))
  const mismatchedHistoricalDates = (historical?.records ?? [])
    .map((record) => {
      const localBusinessDate = localById.get(record.id)
      if (!localBusinessDate || localBusinessDate === record.businessDate) return undefined
      return {
        id: record.id,
        localBusinessDate,
        historicalBusinessDate: record.businessDate!,
      }
    })
    .filter((item): item is AuditMismatch => Boolean(item))

  const salesSourceCoverage = new Set(
    sourceFiles
      .filter((item) => item.kind === 'sales_export' || item.kind === 'stock_stream')
      .flatMap((item) => item.dateCoverage),
  )
  const sourceRowCountByDate: Record<string, number> = {}
  const sourceKindsByDate = new Map<string, Set<'sales_export' | 'stock_stream' | 'historical_sales_artifact'>>()
  for (const source of sourceFiles) {
    for (const date of source.dateCoverage) {
      sourceRowCountByDate[date] = (sourceRowCountByDate[date] ?? 0) + (source.salesRowCount ?? 0)
      const kinds = sourceKindsByDate.get(date) ?? new Set<'sales_export' | 'stock_stream' | 'historical_sales_artifact'>()
      kinds.add(source.kind)
      sourceKindsByDate.set(date, kinds)
    }
  }

  const reasons: string[] = []
  let status: SalesSyncAuditReport['consistency']['status'] = 'consistent'

  if (!sourceFiles.some((item) => item.kind === 'sales_export' || item.kind === 'stock_stream')) {
    status = 'insufficient_evidence'
    reasons.push('未找到可审计的智店通销售导出或库存流水原始文件。')
  }
  if (salesSourceCoverage.size && Object.keys(localByDate).some((date) => !salesSourceCoverage.has(date))) {
    status = 'inconsistent'
    reasons.push('本地销售流水日期分布与现存智店通原始文件覆盖日期不一致。')
  }
  if (mismatchedHistoricalDates.length) {
    status = 'inconsistent'
    reasons.push(`发现 ${mismatchedHistoricalDates.length} 条历史销售记录在最新本地流水中的业务日期发生漂移。`)
  }
  if (!salesSourceCoverage.has('2026-05-01') || !salesSourceCoverage.has('2026-05-14')) {
    if (status === 'consistent') status = 'insufficient_evidence'
    reasons.push('现存原始文件未覆盖 2026-05-01 至 2026-05-14 全时段，无法证明该区间与智店通完全一致。')
  }
  if (Object.keys(localByDate).length && Object.keys(localByDate).every((date) => date < '2026-05-14') && !salesSourceCoverage.has('2026-05-14')) {
    reasons.push('2026-05-14 当天未看到任何销售出库原始记录。')
  }

  const daySummary: SalesAuditDaySummary[] = listDates(from, to).map((date) => {
    const localSalesCount = localByDate[date] ?? 0
    const historicalSalesCount = historical?.byDate[date] ?? 0
    const sourceEvidenceKinds = [...(sourceKindsByDate.get(date) ?? new Set())]
    const hasSourceEvidence = sourceEvidenceKinds.length > 0
    const hasLocalSales = localSalesCount > 0
    const statusForDate: SalesAuditDaySummary['status'] = hasSourceEvidence && hasLocalSales
      ? 'covered'
      : hasLocalSales
        ? 'local_only'
        : hasSourceEvidence
          ? 'evidence_only'
          : 'missing'
    return {
      date,
      localSalesCount,
      historicalSalesCount,
      sourceEvidenceRowCount: sourceRowCountByDate[date] ?? 0,
      sourceEvidenceKinds,
      hasSourceEvidence,
      hasLocalSales,
      status: statusForDate,
    }
  })
  const missingEvidenceDays = daySummary
    .filter((item) => !item.hasSourceEvidence)
    .map((item) => item.date)

  const salesExportSource = sourceFiles.find((item) => item.kind === 'sales_export')
  const stockStreamSource = sourceFiles.find((item) => item.kind === 'stock_stream')

  return {
    generatedAt: new Date().toISOString(),
    period: { from, to },
    sourceFiles: [
      ...sourceFiles,
      ...(historical ? [{
        filePath: historical.path,
        kind: 'historical_sales_artifact',
        discoveredBy: 'fixed_artifact',
        rowCount: historical.records.length,
        salesRowCount: historical.records.length,
        orderCount: historical.records.length,
        dateCoverage: Object.keys(historical.byDate).sort(),
        notes: ['历史导入产物，用于和 latest-inventory-movements.json 做日期漂移对比。'],
      } satisfies AuditSourceFile] : []),
    ],
    localSalesMovements: {
      count: localRecords.length,
      byDate: localByDate,
      orderCount: localOrders.size,
    },
    historicalSalesArtifact: historical
      ? {
        path: historical.path,
        count: historical.records.length,
        byDate: historical.byDate,
      }
      : undefined,
    daySummary,
    missingEvidenceDays,
    mismatchedHistoricalDates,
    consistency: {
      status,
      reasons: reasons.length ? reasons : ['现存本地流水与原始文件抽样未发现差异。'],
    },
    rerun: {
      canReplayCurrentSalesExport: Boolean(salesExportSource),
      canReplayUnifiedStockStream: Boolean(stockStreamSource),
      commands: [
        salesExportSource
          ? `cd apps/inventory-sync && node --import tsx/esm src/cli.ts import-zhidiantong-sales-export ${JSON.stringify(salesExportSource.filePath)}`
          : '',
        stockStreamSource
          ? `cd apps/inventory-sync && node --import tsx/esm src/cli.ts import-zhidiantong-stock-stream ${JSON.stringify(stockStreamSource.filePath)}`
          : '',
        'cd apps/inventory-sync && node --import tsx/esm src/cli.ts audit-zhidiantong-sales-sync 2026-05-01 2026-05-14',
      ].filter(Boolean),
      blockers: [
        !salesSourceCoverage.has('2026-05-01') || !salesSourceCoverage.has('2026-05-14')
          ? '缺少覆盖 2026-05-01 至 2026-05-14 全区间的智店通销售导出或库存流水原始文件。'
          : '',
        salesExportSource?.notes.some((note) => note.includes('缺少显式日期列'))
          ? '当前销售导出文件没有显式日期列，重跑依赖订单号/文件名推断日期。'
          : '',
      ].filter(Boolean),
    },
  }
}

export async function saveZhidiantongSalesSyncAuditReport(
  report: SalesSyncAuditReport,
  fileName = 'latest-sales-sync-audit.json',
) {
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(webPublicDataDir, { recursive: true })
  const stampedName = `${new Date().toISOString().replace(/[:.]/g, '-')}-sales-sync-audit.json`
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, stampedName)
  const latestPath = path.resolve(config.lenovoRetail.artifactDir, fileName)
  const webLatestPath = path.resolve(webPublicDataDir, fileName)
  const content = JSON.stringify(report, null, 2)
  await Promise.all([
    fs.writeFile(artifactPath, content, 'utf-8'),
    fs.writeFile(latestPath, content, 'utf-8'),
    fs.writeFile(webLatestPath, content, 'utf-8'),
  ])
  return { artifactPath, latestPath, webLatestPath }
}
