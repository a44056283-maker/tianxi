import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import {
  type InventoryMovementRecord,
  loadInventoryMovements,
  loadSerialOverrides,
  saveInventoryMovements,
  saveSerialOverrides,
  type SerialOverride,
} from '../inventoryQuote/dataService.js'

type PurchaseWebImportItem = {
  skuKey: string
  productName?: string
  pnMtm?: string
  spec?: string
  unitName?: string
  purchaseQuantity?: number
  inboundQuantity?: number
  amount?: number
  purchaseCost?: number
  serialNumbers: string[]
}

type PurchaseWebImportRecord = {
  documentNumber: string
  businessDate: string
  createdAt?: string
  operatorName?: string
  supplierName?: string
  storeName?: string
  locationName?: string
  note?: string
  items: PurchaseWebImportItem[]
}

type PurchaseWebImportPayload = {
  generatedAt?: string
  source?: string
  records: PurchaseWebImportRecord[]
}

type ImportPurchaseResult = {
  sourceFile: string
  importedCount: number
  overrideCount: number
  mergedRecordCount: number
  mergedOverrideCount: number
  files: Awaited<ReturnType<typeof saveInventoryMovements>>['files']
  serialOverrideFiles: Awaited<ReturnType<typeof saveSerialOverrides>>['files']
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

function mergeOverrides(existing: Record<string, SerialOverride>, incoming: Record<string, SerialOverride>) {
  return {
    ...existing,
    ...incoming,
  }
}

async function findLatestPurchaseImport() {
  const files = await fs.readdir(config.lenovoRetail.artifactDir).catch(() => [])
  const matched: Array<{ filePath: string; mtimeMs: number }> = []
  for (const file of files) {
    if (!/zhidiantong-purchase-inbound(?:-import|-capture)?(?:-\d{4}-\d{2}-\d{2}(?:\.partial)?)?\.json$/i.test(file)) continue
    const filePath = path.resolve(config.lenovoRetail.artifactDir, file)
    const stat = await fs.stat(filePath).catch(() => undefined)
    if (!stat?.isFile()) continue
    matched.push({ filePath, mtimeMs: stat.mtimeMs })
  }
  return matched.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath
}

export async function importZhidiantongPurchaseWeb(inputFile?: string): Promise<ImportPurchaseResult> {
  const sourceFile = inputFile ? path.resolve(inputFile) : await findLatestPurchaseImport()
  if (!sourceFile) throw new Error('未找到智店通商品入库网页直读 JSON。')

  const payload = JSON.parse(await fs.readFile(sourceFile, 'utf-8')) as PurchaseWebImportPayload
  const records: InventoryMovementRecord[] = []
  const overrides: Record<string, SerialOverride> = {}
  const updatedAt = new Date().toISOString()

  for (const [recordIndex, record] of (payload.records ?? []).entries()) {
    const documentNumber = String(record.documentNumber ?? '').trim()
    const businessDate = normalizeBusinessDate(String(record.businessDate ?? ''))
    if (!documentNumber || !businessDate) continue
    for (const [itemIndex, item] of (record.items ?? []).entries()) {
      const skuKey = String(item.skuKey ?? '').trim()
      if (!skuKey) continue
      const serialNumbers = dedupeSerials(item.serialNumbers ?? [])
      for (const serialNumber of serialNumbers) {
        records.push({
          id: `PURCHASE-${documentNumber}-${serialNumber}`,
          skuKey,
          quantity: 1,
          movementType: 'purchase_inbound',
          businessDate,
          createdAt: record.createdAt?.trim() || undefined,
          serialNumber,
          documentNumber,
          sourceDocumentType: '商品入库',
          operatorName: record.operatorName?.trim() || undefined,
          supplierName: record.supplierName?.trim() || undefined,
          storeName: record.storeName?.trim() || undefined,
          locationName: record.locationName?.trim() || undefined,
          productName: item.productName?.trim() || undefined,
          pnMtm: item.pnMtm?.trim() || undefined,
          spec: item.spec?.trim() || undefined,
          unitName: item.unitName?.trim() || undefined,
          unitCost: item.purchaseCost,
          amount: item.purchaseCost,
          note: record.note?.trim() || `智店通商品入库网页直读同步，业务单 ${documentNumber}`,
          updatedAt,
        })
        overrides[serialNumber] = {
          skuKey,
          inboundDate: businessDate,
          purchaseCost: item.purchaseCost,
          documentNumber,
          operatorName: record.operatorName?.trim() || undefined,
          supplierName: record.supplierName?.trim() || undefined,
          storeName: record.storeName?.trim() || undefined,
          locationName: record.locationName?.trim() || undefined,
          productName: item.productName?.trim() || undefined,
          pnMtm: item.pnMtm?.trim() || undefined,
          spec: item.spec?.trim() || undefined,
          note: record.note?.trim() || `智店通商品入库网页直读同步，业务单 ${documentNumber}`,
          updatedAt,
        }
      }

      const inboundQuantity = Math.max(Number(item.inboundQuantity ?? item.purchaseQuantity ?? 0), 0)
      const remainingQuantity = Math.max(inboundQuantity - serialNumbers.length, 0)
      if (remainingQuantity > 0) {
        records.push({
          id: `PURCHASEQ-${documentNumber}-${skuKey}-${recordIndex + 1}-${itemIndex + 1}`,
          skuKey,
          quantity: remainingQuantity,
          movementType: 'purchase_inbound',
          businessDate,
          createdAt: record.createdAt?.trim() || undefined,
          documentNumber,
          sourceDocumentType: '商品入库',
          operatorName: record.operatorName?.trim() || undefined,
          supplierName: record.supplierName?.trim() || undefined,
          storeName: record.storeName?.trim() || undefined,
          locationName: record.locationName?.trim() || undefined,
          productName: item.productName?.trim() || undefined,
          pnMtm: item.pnMtm?.trim() || undefined,
          spec: item.spec?.trim() || undefined,
          unitName: item.unitName?.trim() || undefined,
          unitCost: item.purchaseCost,
          amount: item.amount,
          note: record.note?.trim() || `智店通商品入库网页直读同步，业务单 ${documentNumber}`,
          updatedAt,
        })
      }
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
    files: movementSave.files,
    serialOverrideFiles: overrideSave.files,
    sample: records.slice(0, 10),
  }
}
