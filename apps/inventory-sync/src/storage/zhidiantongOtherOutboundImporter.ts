import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import {
  type InventoryMovementRecord,
  loadInventoryMovements,
  saveInventoryMovements,
} from '../inventoryQuote/dataService.js'

type OtherOutboundImportItem = {
  skuKey: string
  productName?: string
  pnMtm?: string
  spec?: string
  unitName?: string
  outboundQuantity?: number
  salesCost?: number
  amount?: number
  serialNumbers?: string[]
}

type OtherOutboundImportRecord = {
  documentNumber: string
  documentType?: string
  direction?: string
  businessDate: string
  createdAt?: string
  operatorName?: string
  storeName?: string
  locationName?: string
  note?: string
  items: OtherOutboundImportItem[]
}

type OtherOutboundImportPayload = {
  generatedAt?: string
  source?: string
  skippedDocuments?: string[]
  skipReason?: string
  records: OtherOutboundImportRecord[]
}

type ImportOtherOutboundResult = {
  sourceFile: string
  importedCount: number
  mergedRecordCount: number
  files: Awaited<ReturnType<typeof saveInventoryMovements>>['files']
  sample: InventoryMovementRecord[]
}

function normalizeBusinessDate(value: string) {
  const text = value.trim()
  if (!text) return new Date().toISOString()
  const normalized = text
    .replace(/[年./]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${normalized} 00:00:00`
  return normalized
}

function dedupeSerials(serialNumbers: string[]) {
  return [...new Set(serialNumbers.map((item) => item.trim()).filter(Boolean))]
}

function mergeRecords(existing: InventoryMovementRecord[], incoming: InventoryMovementRecord[]) {
  const map = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
}

function isInventoryMovementRecord(value: unknown): value is InventoryMovementRecord {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as InventoryMovementRecord).skuKey === 'string'
    && typeof (value as InventoryMovementRecord).movementType === 'string'
    && typeof (value as InventoryMovementRecord).quantity === 'number',
  )
}

async function findLatestOtherOutboundImport() {
  const files = await fs.readdir(config.lenovoRetail.artifactDir).catch(() => [])
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const file of files) {
    if (!/zhidiantong-other-outbound(?:-\d{4}-\d{2}-\d{2}|-capture-\d{4}-\d{2}-\d{2}\.partial)?\.json$/i.test(file)) continue
    const filePath = path.resolve(config.lenovoRetail.artifactDir, file)
    const stat = await fs.stat(filePath).catch(() => undefined)
    if (!stat?.isFile()) continue
    matched.push({ filePath, mtimeMs: stat.mtimeMs })
  }
  return matched.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath
}

export async function importZhidiantongOtherOutbound(inputFile?: string): Promise<ImportOtherOutboundResult> {
  const sourceFile = inputFile ? path.resolve(inputFile) : await findLatestOtherOutboundImport()
  if (!sourceFile) throw new Error('未找到智店通其它出库网页直读 JSON。')

  const payload = JSON.parse(await fs.readFile(sourceFile, 'utf-8')) as { records?: unknown[] } | unknown[]
  const rawRecords = Array.isArray(payload) ? payload : payload.records ?? []
  const records: InventoryMovementRecord[] = []
  const updatedAt = new Date().toISOString()

  if (rawRecords.every((item) => isInventoryMovementRecord(item))) {
    for (const item of rawRecords as InventoryMovementRecord[]) {
      records.push({
        ...item,
        updatedAt,
      })
    }
  } else {
    for (const [recordIndex, record] of (rawRecords as OtherOutboundImportRecord[]).entries()) {
      const documentNumber = String(record.documentNumber ?? '').trim()
      const businessDate = normalizeBusinessDate(String(record.businessDate ?? ''))
      if (!documentNumber || !businessDate) continue
      for (const [itemIndex, item] of (record.items ?? []).entries()) {
        const skuKey = String(item.skuKey ?? '').trim()
        if (!skuKey) continue
        const serialNumbers = dedupeSerials(item.serialNumbers ?? [])
        for (const serialNumber of serialNumbers) {
          records.push({
            id: `${documentNumber}-${skuKey}-${serialNumber}`,
            skuKey,
            quantity: 1,
            movementType: 'transfer_outbound',
            businessDate,
            createdAt: record.createdAt?.trim() || undefined,
            serialNumber,
            documentNumber,
            sourceDocumentType: record.documentType?.trim() || record.direction?.trim() || '其他出库',
            operatorName: record.operatorName?.trim() || undefined,
            storeName: record.storeName?.trim() || undefined,
            locationName: record.locationName?.trim() || undefined,
            productName: item.productName?.trim() || undefined,
            pnMtm: item.pnMtm?.trim() || undefined,
            spec: item.spec?.trim() || undefined,
            unitName: item.unitName?.trim() || undefined,
            unitCost: item.salesCost,
            amount: item.salesCost,
            note: record.note?.trim() || `智店通其他出库网页直读同步，业务单 ${documentNumber}，非零售出库`,
            updatedAt,
          })
        }

        const outboundQuantity = Math.max(Number(item.outboundQuantity ?? 0), 0)
        const remainingQuantity = Math.max(outboundQuantity - serialNumbers.length, 0)
        if (remainingQuantity > 0) {
          records.push({
            id: `OTHEROUTQ-${documentNumber}-${skuKey}-${recordIndex + 1}-${itemIndex + 1}`,
            skuKey,
            quantity: remainingQuantity,
            movementType: 'transfer_outbound',
            businessDate,
            createdAt: record.createdAt?.trim() || undefined,
            documentNumber,
            sourceDocumentType: record.documentType?.trim() || record.direction?.trim() || '其他出库',
            operatorName: record.operatorName?.trim() || undefined,
            storeName: record.storeName?.trim() || undefined,
            locationName: record.locationName?.trim() || undefined,
            productName: item.productName?.trim() || undefined,
            pnMtm: item.pnMtm?.trim() || undefined,
            spec: item.spec?.trim() || undefined,
            unitName: item.unitName?.trim() || undefined,
            unitCost: item.salesCost,
            amount: item.amount,
            note: record.note?.trim() || `智店通其他出库网页直读同步，业务单 ${documentNumber}，非零售出库`,
            updatedAt,
          })
        }
      }
    }
  }

  const mergedRecords = mergeRecords(await loadInventoryMovements(), records)
  const movementSave = await saveInventoryMovements(mergedRecords)

  return {
    sourceFile,
    importedCount: records.length,
    mergedRecordCount: mergedRecords.length,
    files: movementSave.files,
    sample: records.slice(0, 10),
  }
}
