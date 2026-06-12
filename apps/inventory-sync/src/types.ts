export type SyncSource = 'lenovo-retail-web'

export type SyncStatus = 'success' | 'partial' | 'failed'

export type InventoryLocationType = 'store' | 'warehouse' | 'in_transit' | 'unknown'

export type LenovoRetailSerialItem = {
  source: SyncSource
  storeName?: string
  locationName?: string
  locationType: InventoryLocationType
  skuCode?: string
  productName: string
  model?: string
  mtm?: string
  color?: string
  serialNumber: string
  inboundDate?: string
  purchaseCost?: number
  stockAgeDays?: number
  warrantyStart?: string
  warrantyEnd?: string
  raw: Record<string, unknown>
}

export type LenovoRetailStockSummaryItem = {
  source: SyncSource
  productName: string
  pnMtm?: string
  spec?: string
  currentStock: number
  sellableStock: number
  occupiedStock: number
  unsellableStock: number
  pendingInboundStock: number
  category?: string
  productCode?: string
  skuCode?: string
  organizationName?: string
  organizationCode?: string
  stockType?: string
  agentPrice?: number
  salesCostPrice?: number
  raw: Record<string, unknown>
}

export type LenovoRetailSyncResult = {
  source: SyncSource
  status: SyncStatus
  syncedAt: string
  stockSummaryItems: LenovoRetailStockSummaryItem[]
  inventoryItems: LenovoRetailSerialItem[]
  artifacts: string[]
  warnings: string[]
}

export type StandardInventorySerial = {
  serialNumber: string
  source: SyncSource
  productName: string
  pnMtm?: string
  spec?: string
  productCode?: string
  skuCode?: string
  organizationName?: string
  organizationCode?: string
  productSource?: string
  inboundDate?: string
  purchaseCost?: number
  inboundDocumentNumber?: string
  inboundOperatorName?: string
  supplierName?: string
  locationName?: string
  stockAgeDays?: number
  warrantyStart?: string
  warrantyEnd?: string
}

export type StandardInventorySku = {
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  sourceCategory?: string
  jdSubcategory?: string
  catalogSource?: string
  productCode?: string
  skuCode?: string
  organizationName?: string
  organizationCode?: string
  stockType?: string
  stockWarningLevel?: number
  agentPrice?: number
  salesCostPrice?: number
  priceSource?: string
  currentStock: number
  sellableStock: number
  occupiedStock: number
  unsellableStock: number
  pendingInboundStock: number
  physicalHoldStock?: number
  physicalHoldSerialCount?: number
  serialCount: number
  serials: StandardInventorySerial[]
  dataQuality: {
    stockAndSerialMatched: boolean
    stockQuantityDiff: number
    warnings: string[]
  }
}

export type StandardInventoryCategory = {
  category: string
  skuCount: number
  currentStock: number
  sellableStock: number
  unsellableStock: number
  pendingInboundStock: number
  serialCount: number
  topSkus: Array<{
    skuKey: string
    productName: string
    pnMtm?: string
    currentStock: number
    sellableStock: number
    unsellableStock: number
  }>
}

export type StandardInventorySnapshot = {
  source: SyncSource
  generatedAt: string
  storeName?: string
  organizationCode?: string
  totals: {
    skuCount: number
    currentStock: number
    sellableStock: number
    occupiedStock: number
    unsellableStock: number
    pendingInboundStock: number
    serialCount: number
    unmatchedSerialCount: number
  }
  dataQuality: {
    stockAndSerialScopeLikelyMatched: boolean
    warnings: string[]
  }
  categories: StandardInventoryCategory[]
  skus: StandardInventorySku[]
  files: {
    stockQuantityFile?: string
    stockSnFile?: string
  }
}
