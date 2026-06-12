import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'

type InventoryMasterRow = {
  serialNumber: string
  skuKey: string
  productName: string
  pnMtm?: string
  currentStock: number
  sellableStock: number
  inStock?: boolean
}

type InventoryMasterSnapshot = {
  generatedAt?: string
  rows?: InventoryMasterRow[]
}

type RetailZoneDecision = {
  skuKey: string
  productName: string
  pnMtm?: string
  currentStock: number
  sellableStock: number
  serialCount: number
}

type RetailZoneSnapshot = {
  generatedAt?: string
  decisions?: {
    total?: number
    items?: RetailZoneDecision[]
  }
}

type GhostInventoryAuditItem = {
  skuKey: string
  productName: string
  pnMtm?: string
  currentStock: number
  sellableStock: number
  serialCount: number
  note: string
}

export type GhostInventoryAuditSnapshot = {
  generatedAt: string
  source: 'ghost_inventory_audit'
  files: {
    standardInventory: string
    adjustedInventory: string
    inventoryMaster: string
    retailZone: string
  }
  totals: {
    inStockSkuCount: number
    uiInventoryMismatchCount: number
    retailZoneMissingCount: number
    retailZoneGhostCount: number
    stockWithoutSnCount: number
    partialSnCoverageCount: number
  }
  uiInventoryMismatches: Array<{
    skuKey: string
    productName: string
    pnMtm?: string
    standard: { currentStock: number; sellableStock: number; serialCount: number }
    adjusted: { currentStock: number; sellableStock: number; serialCount: number }
  }>
  retailZoneMissing: GhostInventoryAuditItem[]
  retailZoneGhosts: GhostInventoryAuditItem[]
  stockWithoutSn: GhostInventoryAuditItem[]
  partialSnCoverage: GhostInventoryAuditItem[]
}

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

async function readJson<T>(fileName: string): Promise<T> {
  return JSON.parse(await fs.readFile(artifactPath(fileName), 'utf-8')) as T
}

function compactItem(input: {
  skuKey: string
  productName: string
  pnMtm?: string
  currentStock: number
  sellableStock: number
  serialCount: number
  note: string
}): GhostInventoryAuditItem {
  return {
    skuKey: input.skuKey,
    productName: input.productName,
    pnMtm: input.pnMtm,
    currentStock: input.currentStock,
    sellableStock: input.sellableStock,
    serialCount: input.serialCount,
    note: input.note,
  }
}

function isSnManagedSku(input: { category?: string; productName: string }) {
  const category = String(input.category ?? '').trim()
  const productName = String(input.productName ?? '').trim()
  if (category !== '电脑配件') return true
  if (/(鼠标|键盘)/.test(productName)) return false
  return true
}

export async function buildGhostInventoryAuditSnapshot(): Promise<GhostInventoryAuditSnapshot> {
  const standardFile = 'latest-standard-inventory-snapshot.json'
  const adjustedFile = 'latest-adjusted-inventory-snapshot.json'
  const masterFile = 'latest-inventory-master-snapshot.json'
  const retailFile = 'latest-retail-zone-snapshot.json'

  const [standard, adjusted, master, retail] = await Promise.all([
    readJson<StandardInventorySnapshot>(standardFile),
    readJson<StandardInventorySnapshot>(adjustedFile),
    readJson<InventoryMasterSnapshot>(masterFile),
    readJson<RetailZoneSnapshot>(retailFile),
  ])

  const standardMap = new Map(standard.skus.map((sku) => [sku.skuKey, sku]))
  const adjustedMap = new Map(adjusted.skus.map((sku) => [sku.skuKey, sku]))
  const retailMap = new Map((retail.decisions?.items ?? []).map((item) => [item.skuKey, item]))
  const masterRealSerials = new Map<string, number>()

  for (const row of master.rows ?? []) {
    if (!row.inStock) continue
    if (row.serialNumber.startsWith('[缺SN x')) continue
    masterRealSerials.set(row.skuKey, (masterRealSerials.get(row.skuKey) ?? 0) + 1)
  }

  const inStockSkus = standard.skus.filter((sku) => sku.currentStock > 0 || sku.sellableStock > 0)

  const uiInventoryMismatches = inStockSkus.flatMap((sku) => {
    const adjustedSku = adjustedMap.get(sku.skuKey)
    const expectedSerialCount = Math.max(sku.serialCount, masterRealSerials.get(sku.skuKey) ?? 0)
    if (!adjustedSku) {
      return [{
        skuKey: sku.skuKey,
        productName: sku.productName,
        pnMtm: sku.pnMtm,
        standard: {
          currentStock: sku.currentStock,
          sellableStock: sku.sellableStock,
          serialCount: expectedSerialCount,
        },
        adjusted: {
          currentStock: -1,
          sellableStock: -1,
          serialCount: -1,
        },
      }]
    }
    if (
      adjustedSku.currentStock !== sku.currentStock
      || adjustedSku.sellableStock !== sku.sellableStock
      || adjustedSku.serialCount !== expectedSerialCount
    ) {
      return [{
        skuKey: sku.skuKey,
        productName: sku.productName,
        pnMtm: sku.pnMtm,
        standard: {
          currentStock: sku.currentStock,
          sellableStock: sku.sellableStock,
          serialCount: expectedSerialCount,
        },
        adjusted: {
          currentStock: adjustedSku.currentStock,
          sellableStock: adjustedSku.sellableStock,
          serialCount: adjustedSku.serialCount,
        },
      }]
    }
    return []
  })

  const retailZoneMissing = inStockSkus
    .filter((sku) => !retailMap.has(sku.skuKey))
    .map((sku) => compactItem({
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      currentStock: sku.currentStock,
      sellableStock: sku.sellableStock,
      serialCount: sku.serialCount,
      note: '真实库存中有在库数据，但实时报价专区未展示。',
    }))

  const retailZoneGhosts = (retail.decisions?.items ?? [])
    .flatMap((item) => {
      const standardSku = standardMap.get(item.skuKey)
      if (!standardSku) {
        return [compactItem({
          skuKey: item.skuKey,
          productName: item.productName,
          pnMtm: item.pnMtm,
          currentStock: item.currentStock,
          sellableStock: item.sellableStock,
          serialCount: item.serialCount,
          note: '实时报价专区存在，但真实库存快照不存在该 SKU。',
        })]
      }
      if (standardSku.currentStock <= 0 && standardSku.sellableStock <= 0 && standardSku.serialCount <= 0) {
        return [compactItem({
          skuKey: item.skuKey,
          productName: item.productName,
          pnMtm: item.pnMtm,
          currentStock: item.currentStock,
          sellableStock: item.sellableStock,
          serialCount: item.serialCount,
          note: '实时报价专区显示有货，但真实库存当前为 0。',
        })]
      }
      return []
    })

  const stockWithoutSn = inStockSkus
    .filter((sku) => isSnManagedSku(sku))
    .filter((sku) => (masterRealSerials.get(sku.skuKey) ?? 0) === 0)
    .map((sku) => compactItem({
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      currentStock: sku.currentStock,
      sellableStock: sku.sellableStock,
      serialCount: 0,
      note: '真实库存有货，但 inventory master 中没有真实 SN。',
    }))

  const partialSnCoverage = inStockSkus
    .filter((sku) => isSnManagedSku(sku))
    .filter((sku) => {
      const realSn = masterRealSerials.get(sku.skuKey) ?? 0
      return realSn > 0 && realSn < sku.currentStock
    })
    .map((sku) => compactItem({
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      currentStock: sku.currentStock,
      sellableStock: sku.sellableStock,
      serialCount: masterRealSerials.get(sku.skuKey) ?? 0,
      note: '真实库存有货，且已有部分真实 SN，但仍未补齐全部 SN。',
    }))

  return {
    generatedAt: new Date().toISOString(),
    source: 'ghost_inventory_audit',
    files: {
      standardInventory: artifactPath(standardFile),
      adjustedInventory: artifactPath(adjustedFile),
      inventoryMaster: artifactPath(masterFile),
      retailZone: artifactPath(retailFile),
    },
    totals: {
      inStockSkuCount: inStockSkus.length,
      uiInventoryMismatchCount: uiInventoryMismatches.length,
      retailZoneMissingCount: retailZoneMissing.length,
      retailZoneGhostCount: retailZoneGhosts.length,
      stockWithoutSnCount: stockWithoutSn.length,
      partialSnCoverageCount: partialSnCoverage.length,
    },
    uiInventoryMismatches,
    retailZoneMissing,
    retailZoneGhosts,
    stockWithoutSn,
    partialSnCoverage,
  }
}

export async function saveGhostInventoryAuditSnapshot() {
  const snapshot = await buildGhostInventoryAuditSnapshot()
  const artifactOutputPath = artifactPath('latest-ghost-inventory-audit.json')
  const webOutputPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-ghost-inventory-audit.json')
  await Promise.all([
    fs.mkdir(path.dirname(artifactOutputPath), { recursive: true }),
    fs.mkdir(path.dirname(webOutputPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
    fs.writeFile(webOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
  ])
  return {
    snapshot,
    artifactPath: artifactOutputPath,
    webPath: webOutputPath,
  }
}
