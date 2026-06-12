import fs from 'node:fs/promises'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'
import {
  type InventoryMovementRecord,
  loadInventoryMovements,
  saveInventoryMovements,
} from '../inventoryQuote/dataService.js'

type Cell = string | number | boolean | Date | null

type ImportedSalesRow = {
  orderNo: string
  skuKey?: string
  serialNumber?: string
  quantity: number
  lineKey: string
  businessDate: string
  productName?: string
  pnMtm?: string
  spec?: string
  operatorName?: string
  storeName?: string
  note?: string
}

type SalesOrderSummaryRow = {
  orderNo: string
  businessDate: string
  totalAmount: number
  status: string
  operatorName?: string
  storeName?: string
}

type SalesOrderLineSnapshot = {
  skuKey: string
  productName?: string
  pnMtm?: string
  spec?: string
  quantity: number
  dealPrice: number
  lineTotalAmount?: number
  paidAmount?: number
  serialNumbers: string[]
}

type SalesOrderSnapshot = {
  id: string
  businessDate: string
  totalAmount: number
  status: string
  operatorName?: string
  storeName?: string
  note: string
  lines: SalesOrderLineSnapshot[]
}

type ZhidiantongSalesOrdersSnapshot = {
  generatedAt: string
  summaryFile?: string
  productFile?: string
  fallbackSource?: string
  orderCount: number
  orders: SalesOrderSnapshot[]
}

type RetailCoreSalesOrderLine = {
  sku_key?: string
  sku_no?: string
  quantity?: number
  deal_price?: number
  unit_price?: number
  deal_amount?: number
  pay_amount?: number
  product_name?: string
  mtm_code?: string
  spec?: string
  serial_numbers_json?: string
  serial_number?: string
}

type RetailCoreSalesOrderItem = {
  id?: string
  order_no?: string
  order_number?: string
  business_date?: string | null
  pay_time?: string | null
  created_time?: string | null
  total_amount?: number | null
  pay_amount?: number | null
  status_name?: string | null
  cashier_name?: string | null
  shop_name?: string | null
  note?: string | null
  lines?: RetailCoreSalesOrderLine[]
}

type RetailCoreSalesOrdersSnapshot = {
  items?: RetailCoreSalesOrderItem[]
}

type ImportSalesResult = {
  sourceFile: string
  importedCount: number
  mergedRecordCount: number
  skippedCount: number
  warnings: string[]
  files: Awaited<ReturnType<typeof saveInventoryMovements>>['files']
  salesOrderSnapshotFiles?: {
    artifactPath: string
    webPath: string
  }
  sample: InventoryMovementRecord[]
}

function normalizeCell(cell: Cell) {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) {
    const year = cell.getUTCFullYear()
    const month = String(cell.getUTCMonth() + 1).padStart(2, '0')
    const day = String(cell.getUTCDate()).padStart(2, '0')
    const hour = String(cell.getUTCHours()).padStart(2, '0')
    const minute = String(cell.getUTCMinutes()).padStart(2, '0')
    const second = String(cell.getUTCSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  }
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

function normalizeBusinessDateTime(value: string) {
  const normalized = value
    .replace(/[./年]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace('T', ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (!match) return new Date().toISOString().slice(0, 10)
  const [, year, month, day, hour, minute, second] = match
  const datePart = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  if (hour === undefined || minute === undefined) return datePart
  return `${datePart} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${String(second ?? '00').padStart(2, '0')}`
}

function inferBusinessDate(rawDate: string, orderNo: string, sourceFile: string) {
  if (rawDate.trim()) return normalizeBusinessDateTime(rawDate)

  const orderMatch = orderNo.trim().match(/^[A-Z]{2}(\d{2})(\d{2})(\d{2})\d+/i)
  if (orderMatch) {
    const [, year, month, day] = orderMatch
    return `20${year}-${month}-${day}`
  }

  const fileMatch = sourceFile.match(/(20\d{2})-(\d{2})-(\d{2})/)
  if (fileMatch) {
    const [, year, month, day] = fileMatch
    return `${year}-${month}-${day}`
  }

  return new Date().toISOString().slice(0, 10)
}

function splitSerials(value: string) {
  return value
    .split(/[\s,，;；/|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
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
  const value = Number(String(raw || '').replace(/,/g, '').trim())
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(0, Math.floor(value))
}

function isNonInventoryServiceItem(input: { skuRaw?: string; productName?: string; pnMtm?: string }) {
  const skuRaw = String(input.skuRaw || '').trim()
  const productName = String(input.productName || '').trim()
  const pnMtm = String(input.pnMtm || '').trim()
  const normalizedName = normalizeLookupKey(productName)
  const normalizedPn = normalizeLookupKey(pnMtm)
  return (
    normalizedName.includes('LENOVOCARE')
    || normalizedName.includes('智惠')
    || normalizedPn.startsWith('LENOVOCARE')
    || new Set(['10002930', '10002932']).has(skuRaw)
  )
}

function isCompletedStatus(raw: string) {
  const value = raw.trim()
  if (!value) return true
  const normalized = value.replace(/\s+/g, '')
  return new Set(['已完成', '完成', '成功', '交易成功']).has(normalized)
}

function isInboundLikeOrder(input: { orderNo?: string; orderType?: string; businessType?: string; movementHint?: string }) {
  const text = [input.orderType, input.businessType, input.movementHint]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, '')
    .toUpperCase()
  if (/入库|采购|进货|调入|盘盈|回库|收货/.test(text)) return true
  const orderNo = String(input.orderNo || '').trim().toUpperCase()
  return /^CGR\d+/.test(orderNo)
}

function isSalesLikeOrder(input: { orderNo?: string; orderType?: string; businessType?: string; movementHint?: string }) {
  const text = [input.orderType, input.businessType, input.movementHint]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, '')
    .toUpperCase()
  if (/销售|零售|出库|门店订单|收银|POS|线下订单|线下零售/.test(text)) return true
  const orderNo = String(input.orderNo || '').trim().toUpperCase()
  return /^(XS|SO)\d+/.test(orderNo)
}

async function readRows(filePath: string): Promise<Cell[][]> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.csv') {
    return parseCsvRows(await fs.readFile(filePath, 'utf-8'))
  }
  if (extension === '.xlsx') {
    const result = await readXlsxFile(filePath) as unknown
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return result as Cell[][]
    }
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null && 'data' in result[0]) {
      return (result[0] as { data: Cell[][] }).data
    }
    return []
  }
  throw new Error(`暂不支持的销售出库导出格式：${extension || 'unknown'}；请导出为 .xlsx 或 .csv`)
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

function hasSalesHeaders(header: string[]) {
  const hasOrder = ['订单编号', '订单号', '单号', '销售单号', '业务单编号'].some((name) => header.includes(name))
  const hasSerial = ['SN', '序列号', '商品SN', '设备SN'].some((name) => header.includes(name))
  const hasDate = ['完成时间', '支付时间', '销售时间', '下单时间', '创建时间'].some((name) => header.includes(name))
  const hasQuantity = ['数量', '出库数量', '销售数量'].some((name) => header.includes(name))
  const hasSkuIdentity = ['SKU编码', '商品编码', 'SKU', '货号', 'PN/MTM', 'MTM', 'PN', '商品名称', '货品名称']
    .some((name) => header.includes(name))
  return hasOrder && hasDate && (hasSerial || (hasQuantity && hasSkuIdentity))
}

async function findLatestSalesExport() {
  const searchDirs = [config.lenovoRetail.downloadDir, config.lenovoRetail.artifactDir]
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
    if (hasSalesHeaders(header)) return item.filePath
  }
  return undefined
}

async function findSameDaySalesSummaryExports() {
  const searchDirs = [config.lenovoRetail.downloadDir, config.lenovoRetail.artifactDir]
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    const files = await fs.readdir(searchDir).catch(() => [])
    for (const file of files) {
      if (!/^orderData.*\.(xlsx|csv)$/i.test(file)) continue
      const filePath = path.resolve(searchDir, file)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      matched.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  return matched
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map((item) => item.filePath)
}

async function findSameDaySalesProductExports() {
  const searchDirs = [config.lenovoRetail.downloadDir, config.lenovoRetail.artifactDir]
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const searchDir of searchDirs) {
    const files = await fs.readdir(searchDir).catch(() => [])
    for (const file of files) {
      if (!/^orderProductData.*\.(xlsx|csv)$/i.test(file)) continue
      const filePath = path.resolve(searchDir, file)
      const stat = await fs.stat(filePath).catch(() => undefined)
      if (!stat?.isFile()) continue
      matched.push({ filePath, mtimeMs: stat.mtimeMs })
    }
  }
  return matched
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map((item) => item.filePath)
}

function parseMoney(raw: string) {
  const value = Number(String(raw || '').replace(/,/g, '').trim())
  return Number.isFinite(value) ? value : 0
}

function parseSummaryRows(rows: Cell[][], sourceFile: string) {
  const [headerRow, ...dataRows] = rows
  const header = normalizeHeader(headerRow ?? [])
  const items: SalesOrderSummaryRow[] = []
  for (const row of dataRows) {
    const orderNo = getFirstCell(row, header, ['订单编号', '订单号', '单号', '销售单号', '业务单编号'])
    const status = getFirstCell(row, header, ['订单状态', '状态']) || '已完成'
    if (!orderNo || !isCompletedStatus(status)) continue
    const orderType = getFirstCell(row, header, ['订单类型', '单据类型', '业务类型', '流水类型', '单据业务类型'])
    const businessType = getFirstCell(row, header, ['业务类型', '业务类别', '交易类型'])
    const movementHint = getFirstCell(row, header, ['出入库类型', '库位类型', '库位'])
    if (isInboundLikeOrder({ orderNo, orderType, businessType, movementHint })) continue
    if (!isSalesLikeOrder({ orderNo, orderType, businessType, movementHint })) continue
    const businessTime = getFirstCell(row, header, ['完成时间', '支付时间', '销售时间', '下单时间', '创建时间', '配送时间'])
    items.push({
      orderNo,
      businessDate: inferBusinessDate(businessTime, orderNo, sourceFile),
      totalAmount: parseMoney(getFirstCell(row, header, ['实际金额', '实付金额', '支付金额', '总价', '订单金额'])),
      status,
      operatorName: getFirstCell(row, header, ['收银员', '操作员', '经手人', '店员']) || undefined,
      storeName: getFirstCell(row, header, ['门店', '店铺', '机构名称', '销售门店', '仓库']) || undefined,
    })
  }
  return items
}

function parseProductRows(rows: Cell[][], sourceFile: string, resolveSkuKey: (input: { skuRaw?: string; productName?: string; pnMtm?: string; serialNumber?: string }) => { skuKey: string; serialNumber?: string } | undefined) {
  const [headerRow, ...dataRows] = rows
  const header = normalizeHeader(headerRow ?? [])
  const grouped = new Map<string, SalesOrderSnapshot>()
  for (const row of dataRows) {
    const orderNo = getFirstCell(row, header, ['订单编号', '订单号', '单号', '销售单号', '业务单编号'])
    if (!orderNo) continue
    const productName = getFirstCell(row, header, ['商品名称', '货品名称', '商品信息'])
    const pnMtm = getFirstCell(row, header, ['PN/MTM', 'MTM', 'PN'])
    const skuRaw = getFirstCell(row, header, ['SKU编码', '商品编码', 'SKU', '货号'])
    const serialNumbers = splitSerials(getFirstCell(row, header, ['SN', '序列号', '商品SN', '设备SN']))
    const resolved = resolveSkuKey({ skuRaw, productName, pnMtm, serialNumber: serialNumbers[0] })
    const skuKey = resolved?.skuKey || pickSkuKey(skuRaw)
    if (!skuKey) continue
    if (isNonInventoryServiceItem({ skuRaw, productName, pnMtm })) continue
    const quantity = parseQuantity(getFirstCell(row, header, ['数量', '出库数量', '销售数量'])) || Math.max(serialNumbers.length, 1)
    const businessTime = getFirstCell(row, header, ['完成时间', '支付时间', '销售时间', '下单时间', '创建时间'])
    const order = grouped.get(orderNo) ?? {
      id: orderNo,
      businessDate: inferBusinessDate(businessTime, orderNo, sourceFile),
      totalAmount: 0,
      status: '已完成',
      operatorName: getFirstCell(row, header, ['收银员', '操作员', '经手人', '店员']) || undefined,
      storeName: getFirstCell(row, header, ['门店', '店铺', '机构名称', '销售门店']) || undefined,
      note: `智店通销售出库导出导入，订单 ${orderNo}`,
      lines: [],
    }
    order.lines.push({
      skuKey,
      productName: productName || undefined,
      pnMtm: pnMtm || undefined,
      spec: getFirstCell(row, header, ['商品规格', '规格', '型号规格']) || undefined,
      quantity,
      dealPrice: parseMoney(getFirstCell(row, header, ['实付', '实付金额', '成交单价', '单价'])) || parseMoney(getFirstCell(row, header, ['单价'])),
      lineTotalAmount: parseMoney(getFirstCell(row, header, ['总价', '金额'])),
      paidAmount: parseMoney(getFirstCell(row, header, ['实付', '实付金额'])),
      serialNumbers,
    })
    grouped.set(orderNo, order)
  }
  return grouped
}

async function saveZhidiantongSalesOrdersSnapshot(snapshot: ZhidiantongSalesOrdersSnapshot) {
  const payload = JSON.stringify(snapshot, null, 2)
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-zhidiantong-sales-orders.json')
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-zhidiantong-sales-orders.json')
  await fs.mkdir(path.dirname(artifactPath), { recursive: true })
  await fs.mkdir(path.dirname(webPath), { recursive: true })
  await fs.writeFile(artifactPath, payload, 'utf-8')
  await fs.writeFile(webPath, payload, 'utf-8')
  return { artifactPath, webPath }
}

async function loadRetailCoreSalesOrdersSnapshot() {
  const candidates = [
    path.resolve(config.appDir, '../web-cockpit/public/data/latest-retail-core-sales-orders.json'),
    path.resolve(config.lenovoRetail.artifactDir, 'latest-retail-core-sales-orders.json'),
  ]
  for (const filePath of candidates) {
    const payload = await fs.readFile(filePath, 'utf-8')
      .then((content) => JSON.parse(content) as RetailCoreSalesOrdersSnapshot)
      .catch(() => null)
    if (payload && Array.isArray(payload.items) && payload.items.length) {
      return { filePath, items: payload.items }
    }
  }
  return null
}

function parseRetailCoreSerialNumbers(line: RetailCoreSalesOrderLine) {
  const raw = String(line.serial_numbers_json || '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
      }
    } catch {
      return splitSerials(raw)
    }
  }
  return line.serial_number ? [String(line.serial_number).trim()].filter(Boolean) : []
}

function buildSalesOrderSnapshotFromRetailCore(item: RetailCoreSalesOrderItem): SalesOrderSnapshot | null {
  const orderId = String(item.id || item.order_no || item.order_number || '').trim()
  if (!orderId) return null
  const lines = Array.isArray(item.lines) ? item.lines : []
  if (!lines.length) return null
  const mappedLines = lines
    .map<SalesOrderLineSnapshot | null>((line) => {
      const skuKey = String(line.sku_key || line.sku_no || '').trim()
      if (!skuKey) return null
      const quantity = Number(line.quantity ?? 0)
      const serialNumbers = parseRetailCoreSerialNumbers(line)
      return {
        skuKey,
        productName: line.product_name || undefined,
        pnMtm: line.mtm_code || undefined,
        spec: line.spec || undefined,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : Math.max(serialNumbers.length, 1),
        dealPrice: Number(line.deal_price ?? line.unit_price ?? 0) || 0,
        lineTotalAmount: Number(line.deal_amount ?? 0) || undefined,
        paidAmount: Number(line.pay_amount ?? 0) || undefined,
        serialNumbers,
      }
    })
    .filter((line): line is SalesOrderLineSnapshot => Boolean(line))
  if (!mappedLines.length) return null
  const businessDate = inferBusinessDate(
    String(item.business_date || item.pay_time || item.created_time || ''),
    orderId,
    'latest-retail-core-sales-orders.json',
  )
  const totalFromLines = mappedLines.reduce((sum, line) => (
    sum + ((line.paidAmount && line.paidAmount > 0)
      ? line.paidAmount
      : line.lineTotalAmount || line.dealPrice * line.quantity)
  ), 0)
  return {
    id: orderId,
    businessDate,
    totalAmount: Number(item.total_amount ?? item.pay_amount ?? 0) || totalFromLines,
    status: String(item.status_name || '已完成').trim() || '已完成',
    operatorName: item.cashier_name || undefined,
    storeName: item.shop_name || undefined,
    note: item.note || `零售主库销售订单桥接，订单 ${orderId}`,
    lines: mappedLines,
  }
}

export async function buildZhidiantongSalesOrdersSnapshot(options?: {
  summaryFile?: string
  productFile?: string
}): Promise<{ snapshot: ZhidiantongSalesOrdersSnapshot; files: { artifactPath: string; webPath: string } } | null> {
  const summaryFiles = options?.summaryFile
    ? [path.resolve(options.summaryFile)]
    : await findSameDaySalesSummaryExports()
  const productFiles = options?.productFile
    ? [path.resolve(options.productFile)]
    : await findSameDaySalesProductExports()

  const inventorySnapshot = await loadInventorySnapshot()
  const resolveSkuKey = buildSkuResolver(inventorySnapshot)
  const summaries: SalesOrderSummaryRow[] = []
  for (const summaryFile of summaryFiles) {
    const summaryRows = await readRows(summaryFile).catch(() => [])
    if (summaryRows.length) summaries.push(...parseSummaryRows(summaryRows, summaryFile))
  }
  const products = new Map<string, SalesOrderSnapshot>()
  for (const productFile of productFiles) {
    const productRows = await readRows(productFile).catch(() => [])
    if (!productRows.length) continue
    const parsed = parseProductRows(productRows, productFile, resolveSkuKey)
    for (const [orderNo, order] of parsed.entries()) {
    const current = products.get(orderNo)
    if (!current) {
      products.set(orderNo, order)
      continue
    }
      const seenKeys = new Set(current.lines.map((line) => `${line.skuKey}::${line.serialNumbers.join('|')}::${line.dealPrice}`))
      for (const line of order.lines) {
        const key = `${line.skuKey}::${line.serialNumbers.join('|')}::${line.dealPrice}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        current.lines.push(line)
      }
      current.operatorName ||= order.operatorName
      current.storeName ||= order.storeName
    }
  }
  const summaryMap = new Map(summaries.map((item) => [item.orderNo, item]))
  let fallbackSource: string | undefined
  const retailCoreSnapshot = await loadRetailCoreSalesOrdersSnapshot()
  if (retailCoreSnapshot) {
    fallbackSource = retailCoreSnapshot.filePath
    for (const item of retailCoreSnapshot.items) {
      const fallbackOrder = buildSalesOrderSnapshotFromRetailCore(item)
      if (!fallbackOrder) continue
      const orderId = fallbackOrder.id.trim()
      if (!orderId.startsWith('XS')) continue
      if (!products.has(orderId)) {
        products.set(orderId, fallbackOrder)
        continue
      }
      const current = products.get(orderId)!
      current.businessDate ||= fallbackOrder.businessDate
      current.operatorName ||= fallbackOrder.operatorName
      current.storeName ||= fallbackOrder.storeName
      current.note ||= fallbackOrder.note
      if (!current.lines.length && fallbackOrder.lines.length) current.lines = fallbackOrder.lines
    }
    for (const item of retailCoreSnapshot.items) {
      const orderId = String(item.id || item.order_no || item.order_number || '').trim()
      if (!orderId || summaryMap.has(orderId) || !orderId.startsWith('XS')) continue
      const fallbackOrder = buildSalesOrderSnapshotFromRetailCore(item)
      if (!fallbackOrder) continue
      summaryMap.set(orderId, {
        orderNo: orderId,
        businessDate: fallbackOrder.businessDate,
        totalAmount: fallbackOrder.totalAmount,
        status: fallbackOrder.status,
        operatorName: fallbackOrder.operatorName,
        storeName: fallbackOrder.storeName,
      })
    }
  }

  const orderIds = Array.from(new Set([...summaryMap.keys(), ...products.keys()]))
  if (!orderIds.length) return null
  const orders = orderIds.map((orderNo) => {
    const summary = summaryMap.get(orderNo)
    const product = products.get(orderNo)
    const lines = product?.lines ?? []
    const totalFromLines = lines.reduce((sum, line) => sum + ((line.paidAmount && line.paidAmount > 0) ? line.paidAmount : line.lineTotalAmount || line.dealPrice * line.quantity), 0)
    return {
      id: orderNo,
      businessDate: summary?.businessDate || product?.businessDate || new Date().toISOString().slice(0, 10),
      totalAmount: summary?.totalAmount || totalFromLines,
      status: summary?.status || product?.status || '已完成',
      operatorName: summary?.operatorName || product?.operatorName,
      storeName: summary?.storeName || product?.storeName,
      note: product?.note || `智店通销售出库导出导入，订单 ${orderNo}`,
      lines,
    } satisfies SalesOrderSnapshot
  })
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.id.localeCompare(a.id))

  const snapshot: ZhidiantongSalesOrdersSnapshot = {
    generatedAt: new Date().toISOString(),
    summaryFile: summaryFiles.join(', ') || undefined,
    productFile: productFiles.join(', ') || undefined,
    fallbackSource,
    orderCount: orders.length,
    orders,
  }
  const files = await saveZhidiantongSalesOrdersSnapshot(snapshot)
  return { snapshot, files }
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
    if (direct && byCode.has(direct)) return { skuKey: byCode.get(direct)! }
    const pnKey = normalizeLookupKey(input.pnMtm)
    if (pnKey && byPn.has(pnKey)) return { skuKey: byPn.get(pnKey)! }
    const nameKey = normalizeLookupKey(input.productName)
    if (nameKey && byName.has(nameKey)) return { skuKey: byName.get(nameKey)! }
    return undefined
  }
}

function parseSalesRows(
  rows: Cell[][],
  sourceFile: string,
  resolveSkuKey: (input: { skuRaw?: string; productName?: string; pnMtm?: string; serialNumber?: string }) => { skuKey: string; serialNumber?: string } | undefined,
) {
  const [headerRow, ...dataRows] = rows
  const header = normalizeHeader(headerRow ?? [])
  const warnings: string[] = []
  const parsed: ImportedSalesRow[] = []
  const seenMovementKeys = new Set<string>()
  let skippedCount = 0

  for (const [rowIndex, row] of dataRows.entries()) {
    const orderNo = getFirstCell(row, header, ['订单编号', '订单号', '单号', '销售单号', '业务单编号'])
    const status = getFirstCell(row, header, ['订单状态', '状态'])
    const orderType = getFirstCell(row, header, ['订单类型', '单据类型', '业务类型', '流水类型', '单据业务类型'])
    const businessType = getFirstCell(row, header, ['业务类型', '业务类别', '交易类型'])
    const movementHint = getFirstCell(row, header, ['出入库类型', '库位类型', '库位'])
    const productName = getFirstCell(row, header, ['商品名称', '货品名称'])
    const serialRaw = getFirstCell(row, header, ['SN', '序列号', '商品SN', '设备SN'])
    const businessTime = getFirstCell(row, header, ['完成时间', '支付时间', '销售时间', '下单时间', '创建时间'])
    const skuRaw = getFirstCell(row, header, ['SKU编码', '商品编码', 'SKU', '货号'])
    const pnMtm = getFirstCell(row, header, ['PN/MTM', 'MTM', 'PN'])
    const spec = getFirstCell(row, header, ['商品规格', '规格', '型号规格'])
    const operatorName = getFirstCell(row, header, ['收银员', '操作员', '经手人', '店员'])
    const storeName = getFirstCell(row, header, ['门店', '店铺', '机构名称', '销售门店'])
    const quantity = parseQuantity(getFirstCell(row, header, ['数量', '出库数量', '销售数量']))

    if (!orderNo) continue
    if (!isCompletedStatus(status)) continue
    if (isInboundLikeOrder({ orderNo, orderType, businessType, movementHint })) {
      skippedCount += 1
      warnings.push(`单据 ${orderNo} 判定为入库/采购单，已从销售出库导入中剔除。`)
      continue
    }
    if (!isSalesLikeOrder({ orderNo, orderType, businessType, movementHint })) {
      skippedCount += 1
      warnings.push(`单据 ${orderNo} 非明确销售出库类型，已跳过。`)
      continue
    }
    if (!serialRaw) {
      if (isNonInventoryServiceItem({ skuRaw, productName, pnMtm })) {
        skippedCount += 1
        warnings.push(`订单 ${orderNo} 为非库存服务单，已跳过库存出库同步：${productName || skuRaw || pnMtm || 'unknown'}`)
        continue
      }
      const resolved = resolveSkuKey({ skuRaw, productName, pnMtm })
      if (!resolved?.skuKey || quantity <= 0) {
        skippedCount += 1
        warnings.push(`订单 ${orderNo} 缺少 SN 且无法唯一匹配 SKU，已跳过：${productName || skuRaw || pnMtm || 'unknown'}`)
        continue
      }
      const movementKey = `${orderNo}::ROW${rowIndex + 1}::${resolved.skuKey}`
      if (seenMovementKeys.has(movementKey)) continue
      seenMovementKeys.add(movementKey)
      parsed.push({
        orderNo,
        skuKey: resolved.skuKey,
        quantity,
        lineKey: `ROW${rowIndex + 1}`,
        businessDate: inferBusinessDate(businessTime, orderNo, sourceFile),
        productName,
        pnMtm,
        spec,
        operatorName,
        storeName,
        note: `智店通销售出库导出导入，订单 ${orderNo}`,
      })
      continue
    }

    for (const serialNumber of splitSerials(serialRaw)) {
      const resolved = resolveSkuKey({ skuRaw, productName, pnMtm, serialNumber })
      if (!resolved?.skuKey) {
        if (isNonInventoryServiceItem({ skuRaw, productName, pnMtm })) {
          skippedCount += 1
          warnings.push(`订单 ${orderNo} 为非库存服务单，已跳过库存出库同步：${productName || skuRaw || pnMtm || 'unknown'} / ${serialNumber}`)
          continue
        }
        skippedCount += 1
        warnings.push(`订单 ${orderNo} 的 SN ${serialNumber} 未匹配到库存 SKU：${productName || skuRaw || pnMtm || 'unknown'}`)
        continue
      }
      const canonicalSerialNumber = resolved.serialNumber?.trim() || normalizeSerialNumber(serialNumber)
      const movementKey = `${orderNo}::${canonicalSerialNumber}::${resolved.skuKey}`
      if (seenMovementKeys.has(movementKey)) continue
      seenMovementKeys.add(movementKey)
      parsed.push({
        orderNo,
        skuKey: resolved.skuKey,
        serialNumber: canonicalSerialNumber,
        quantity: 1,
        lineKey: canonicalSerialNumber,
        businessDate: inferBusinessDate(businessTime, orderNo, sourceFile),
        productName,
        pnMtm,
        spec,
        operatorName,
        storeName,
        note: `智店通销售出库导出导入，订单 ${orderNo}`,
      })
    }
  }

  return { parsed, warnings, skippedCount }
}

function mergeRecords(existing: InventoryMovementRecord[], incoming: InventoryMovementRecord[]) {
  const map = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
}

export async function importZhidiantongSalesExport(inputFile?: string): Promise<ImportSalesResult> {
  const sourceFile = inputFile ? path.resolve(inputFile) : await findLatestSalesExport()
  if (!sourceFile) {
    throw new Error('未找到销售出库导出文件。请先从智店通手动导出线下门店订单明细（.xlsx 或 .csv）。')
  }

  const rows = await readRows(sourceFile)
  const inventorySnapshot = await loadInventorySnapshot()
  const resolveSkuKey = buildSkuResolver(inventorySnapshot)
  const { parsed, warnings, skippedCount } = parseSalesRows(rows, sourceFile, resolveSkuKey)

  const imported = parsed.map<InventoryMovementRecord>((item) => ({
    id: item.serialNumber
      ? `SALE-${item.orderNo}-${item.serialNumber}`
      : `SALEQ-${item.orderNo}-${item.skuKey}-${item.lineKey}`,
    skuKey: item.skuKey ?? 'UNKNOWN',
    quantity: item.quantity,
    movementType: 'sales_outbound',
    businessDate: item.businessDate,
    serialNumber: item.serialNumber,
    documentNumber: item.orderNo,
    operatorName: item.operatorName,
    storeName: item.storeName,
    productName: item.productName,
    pnMtm: item.pnMtm,
    spec: item.spec,
    note: item.note,
    updatedAt: new Date().toISOString(),
  }))

  const merged = mergeRecords(await loadInventoryMovements(), imported)
  const saved = await saveInventoryMovements(merged)
  const salesOrderSnapshot = await buildZhidiantongSalesOrdersSnapshot({
    productFile: sourceFile,
  }).catch(() => null)

  return {
    sourceFile,
    importedCount: imported.length,
    mergedRecordCount: merged.length,
    skippedCount,
    warnings: Array.from(new Set(warnings)).slice(0, 200),
    files: saved.files,
    salesOrderSnapshotFiles: salesOrderSnapshot?.files,
    sample: imported.slice(0, 12),
  }
}
