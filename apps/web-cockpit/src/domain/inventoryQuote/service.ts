import {
  priceSources,
  competitorRankItems,
  quoteDecisions,
  serialInventory,
  sourceSyncStatus,
  subsidyRule,
  type PriceSourceItem,
  type CompetitorRankItem,
  type QuoteDecision,
  type SerialInventoryItem,
} from '../../mock/inventoryQuote.mock'

export type InventoryQuoteMetric = {
  label: string
  value: string
  note: string
  tone: 'good' | 'info' | 'warn' | 'danger'
}

export type RiskItem = {
  title: string
  body: string
}

export type InventoryQuoteSnapshot = {
  metrics: InventoryQuoteMetric[]
  serialInventory: SerialInventoryItem[]
  quoteDecisions: QuoteDecision[]
  priceSources: PriceSourceItem[]
  competitorRankItems: CompetitorRankItem[]
  sourceSyncStatus: typeof sourceSyncStatus
  subsidyRule: typeof subsidyRule
  risks: RiskItem[]
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
  serials: Array<{
    serialNumber: string
    productName?: string
    pnMtm?: string
    spec?: string
    organizationName?: string
    warehouseCode?: string
    inboundDate?: string
    purchaseCost?: number
    inboundDocumentNumber?: string
    inboundOperatorName?: string
    supplierName?: string
    locationName?: string
    stockAgeDays?: number
    warrantyStart?: string
    warrantyEnd?: string
    isPhysicalHold?: boolean
  }>
  dataQuality: {
    stockAndSerialMatched: boolean
    stockQuantityDiff: number
    warnings: string[]
  }
}

export type StandardInventorySnapshot = {
  source: string
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
    physicalHoldStock?: number
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
  inStock?: boolean
  inboundDate?: string
  purchaseCost?: number
  inboundDocumentNumber?: string
  inboundOperatorName?: string
  supplierName?: string
  locationName?: string
  physicalHold?: boolean
  physicalHoldStockWithinSku?: number
  stockAgeDays?: number
  warrantyStart?: string
  warrantyEnd?: string
  dataQuality?: {
    warnings?: string[]
  }
}

export type InventoryMasterException = {
  type: string
  skuKey?: string
  serialNumber?: string
  documentNumber?: string
  sourceFile?: string
  message: string
}

export type InventoryMasterSnapshot = {
  generatedAt?: string
  warnings?: string[]
  files?: {
    stockQuantityFile?: string
    stockSnFile?: string
  }
  totals?: {
    rowCount?: number
    skuCount?: number
    inStockRowCount?: number
    rowWithInboundDateCount?: number
    rowWithInboundDocumentCount?: number
    rowWithLatestMovementCount?: number
    skuWithoutSerialCount?: number
    exceptionCount?: number
  }
  rows?: InventoryMasterRow[]
  exceptions?: InventoryMasterException[]
}

export type StaleInventoryReportRow = {
  skuKey: string
  productName: string
  pnMtm?: string
  currentStock: number
  staleSerialCount: number
  expiringWarrantySerialCount: number
  expiredWarrantySerialCount: number
  oldestStockAgeDays: number
  serialSamples: string[]
}

export type StaleInventoryReportCategory = {
  category: string
  staleSerialCount: number
  expiringWarrantySerialCount: number
  expiredWarrantySerialCount: number
  rows: StaleInventoryReportRow[]
}

export type StaleInventoryReportSnapshot = {
  generatedAt: string
  thresholds: {
    staleDays: number
    warrantyExpiringDays: number
  }
  totals: {
    staleSerialCount: number
    staleSkuCount: number
    expiringWarrantySerialCount: number
    expiredWarrantySerialCount: number
  }
  categories: StaleInventoryReportCategory[]
}

export type DistributorQuote = {
  source: 'wechat-distributor-group'
  groupName: string
  sourceFile: string
  quoteDate: string
  pnMtm: string
  productName: string
  pickupPrice: number
  subsidyPrice?: number
  educationSubsidy?: number
  stockSignals: Record<string, string>
  remark?: string
  libraryMatch?: {
    status: 'inventory_pn_mtm' | 'inventory_fingerprint' | 'product_library_pn_mtm' | 'product_library_fingerprint' | 'unmatched'
    confidence: number
    primarySkuKey?: string
    productId?: string
    canonicalName?: string
    defaultCategory?: string
    sourceCategory?: string
    jdSubcategory?: string
    currentStock?: number
    sellableStock?: number
    evidence: string
  }
}

export type DistributorQuoteSnapshot = {
  generatedAt: string
  quoteDate?: string
  quoteFile?: string
  quoteCount?: number
  summary?: {
    inventoryMatchedCount: number
    productLibraryMatchedCount: number
    unmatchedCount: number
  }
  quotes: DistributorQuote[]
}

type DistributorQuoteLibraryMatch = NonNullable<DistributorQuote['libraryMatch']>

export type InventoryPriceSignalRow = {
  skuKey: string
  pnMtm?: string
  productName?: string
  inventoryAverageCost?: number
  realtimePurchasePrice?: number
  grayWholesalePrice?: number
  distributorQuoteDate?: string
  grayQuoteDate?: string
  realtimeMatchMethod?: string
  realtimeMatchConfidence?: number
  realtimeMatchEvidence?: string
  grayMatchMethod?: string
  grayMatchConfidence?: number
  grayMatchEvidence?: string
  sourceGeneratedAt?: string
  updatedAt: string
}

export type InventoryPriceSignalSnapshot = {
  generatedAt: string
  source: string
  sourceGeneratedAt?: string
  itemCount: number
  items: InventoryPriceSignalRow[]
}

export type FrontendDisplayControlsSnapshot = {
  generatedAt: string
  controls: {
    showMarketingPo: boolean
    showEducationSubsidy: boolean
  }
}

export type FrontendActivityDisplayCatalogSnapshot = {
  generatedAt: string
  categoryCount: number
  skuCount: number
  categories: Array<{
    category: string
    skuCount: number
    items: Array<{
      skuKey: string
      productName: string
      pnMtm?: string
      currentStock: number
    }>
  }>
}

export type FrontendActivityDisplayOverridesSnapshot = {
  generatedAt: string
  count: number
  items: Array<{
    activityId?: string
    skuKey: string
    productName?: string
    pnMtm?: string
    category?: string
    currentStock?: number
    marketingPoEnabled: boolean
    marketingPoAmount?: number | null
    educationSubsidyEnabled: boolean
    educationSubsidyAmount?: number | null
    note?: string
    updatedAt?: string
  }>
}

export type PriceProtectionCandidate = {
  skuKey: string
  productName: string
  pnMtm?: string
  currentStock: number
  serialCount: number
  inventoryAverageCost: number
  realtimePurchasePrice: number
  unitDiff: number
  estimatedProtectionAmount: number
  quoteDate: string
  quoteSourceFile: string
  status: '待申请' | '已申请' | '已核销'
  reason: string
  matchMethod: 'pn_mtm' | 'configuration_fingerprint'
  matchConfidence: number
  evidenceImagePath?: string
  evidenceCaption?: string
}

export type PriceProtectionSnapshot = {
  generatedAt: string
  source: string
  groupName: string
  quoteDate?: string
  quoteFile?: string
  quoteCount: number
  matchedSkuCount: number
  candidates: PriceProtectionCandidate[]
}

export type MarketingBoostActivity = {
  id: string
  sourceType: 'distributor_remark' | 'manual_upload_ocr' | 'manual_activity'
  activityCategory: 'po_boost' | 'education_discount' | 'bundle_gift' | 'aipc_campaign' | 'designated_ai_campaign' | 'general_marketing'
  activityLabel: string
  sourceSheetName?: string
  sourceFile?: string
  evidenceImagePath?: string
  capturedAt: string
  activityDate: string
  lockedDisplayDate: string
  validFrom: string
  validTo: string
  groupName?: string
  productName: string
  pnMtm?: string
  skuKey?: string
  matchStatus: 'inventory_matched' | 'product_library_only' | 'unmatched'
  matchEvidence: string
  poSalesPrice?: number
  boostAmount?: number
  educationDiscountAmount?: number
  pickupPrice?: number
  ruleText: string
  rawText: string
}

export type MarketingBoostEligibleInventoryItem = {
  activityId: string
  activityCategory: MarketingBoostActivity['activityCategory']
  activityLabel: string
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  currentStock: number
  sellableStock: number
  serialCount: number
  physicalHoldStock?: number
  inventoryAverageCost?: number
  poSalesPrice?: number
  boostAmount?: number
  educationDiscountAmount?: number
  lockedDisplayDate: string
  activityDate: string
  validFrom?: string
  validTo?: string
  ruleText: string
  sourceFile?: string
}

export type MarketingBoostHeroCard = {
  id: string
  activityId: string
  activityCategory: MarketingBoostActivity['activityCategory']
  activityLabel: string
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  orderNumber: string
  outboundDate: string
  lockedDisplayDate: string
  outboundDocumentNumber?: string
  outboundOperatorName?: string
  outboundStoreName?: string
  serialNumbers: string[]
  quantity: number
  physicalHoldStock?: number
  inventoryAverageCost?: number
  poSalesPrice?: number
  boostAmount?: number
  educationDiscountAmount?: number
  pickupPrice?: number
  estimatedMarketingSupportAmount: number
  estimatedCostGapAmount: number
  status: '待申请' | '已申请' | '已核销'
  sourceFile?: string
  evidenceImagePath?: string
  ruleText: string
  paymentReceived?: boolean
  paymentReceivedAt?: string
  paymentReceivedNote?: string
  historySource?: 'auto_sales_outbound' | 'manual_po_protection' | 'sales_po_policy'
}

export type MarketingBoostSnapshot = {
  generatedAt: string
  source: 'marketing_boost_activity'
  quoteDate?: string
  ruleVersion?: string
  ruleSourceTitle?: string
  ruleSourceLink?: string
  ruleSourceFileId?: string
  ruleSourceFile?: string
  summary: {
    activityCount: number
    distributorRemarkActivityCount: number
    manualUploadActivityCount: number
    eligibleInventoryCount: number
    heroCardCount: number
    historyCount: number
    productLibraryOnlyCount: number
    unmatchedActivityCount: number
    activityHistoryCount: number
    totalEstimatedMarketingSupportAmount: number
    totalEstimatedCostGapAmount: number
    categoryBreakdown: Array<{
      category: MarketingBoostActivity['activityCategory']
      label: string
      count: number
    }>
  }
  activities: MarketingBoostActivity[]
  activityHistory: MarketingBoostActivity[]
  eligibleInventory: MarketingBoostEligibleInventoryItem[]
  heroCards: MarketingBoostHeroCard[]
  history: MarketingBoostHeroCard[]
  unmatchedProductLibrary: MarketingBoostActivity[]
}

export type EducationSubsidyAgentScanRow = {
  id: string
  sourceType: 'wechat_group_manual' | 'xhey_api_manual' | 'watermark_camera_manual'
  sourceGroupName: string
  collectionSource?: string
  sourceFile?: string
  scanDate: string
  lockedDisplayDate: string
  productName: string
  sourceSkuKey?: string
  sourcePnMtm?: string
  skuKey?: string
  pnMtm?: string
  spec?: string
  category?: string
  quantity: number
  educationDiscountAmount: number
  scannedEducationDiscountAmount?: number
  totalEducationDiscountAmount: number
  serviceFeePerUnit: number
  totalServiceFee: number
  orderNumber?: string
  outboundDate?: string
  outboundStoreName?: string
  outboundOperatorName?: string
  outboundMatchSource?: 'sql_inventory_movements' | 'marketing_boost_history' | 'manual_record'
  matchedOutboundMovementId?: string
  matchedOutboundOrderId?: string
  matchedSalesOrderId?: string
  matchedOutboundSkuKey?: string
  matchedOutboundPnMtm?: string
  serialNumbers: string[]
  paymentReceived?: boolean
  paymentReceivedAt?: string
  paymentReceivedNote?: string
  status: '待出库同步' | '未付' | '已付'
  activityLabel?: string
  ruleText?: string
  customerName?: string
  customerPhone?: string
  agentPhone?: string
  modelText?: string
  voucherCode?: string
  voucherVerifiedAt?: string
  reportStatus?: string
  serviceRuleKey?: string
  serviceRuleLabel?: string
  zhixiangjinAmount?: number
  bundleGroupId?: string
  bundleMatchedOrderNumber?: string
  bundleMatchedPnMtms?: string[]
  bundleMatchedProductTypes?: string[]
  bundleChargeApplied?: boolean
  bundleTotalServiceFee?: number
  bundleTotalZhixiangjinAmount?: number
}

export type EducationAgentBundleSummary = {
  totalGroups: number
  unresolvedCount: number
  threePieceCount: number
  twoPieceCount: number
  legionCount: number
  pendingCount: number
  unpaidCount: number
  paidCount: number
  totalServiceFee: number
  totalZhixiangjinAmount: number
}

export type EducationAgentBundleOrderAudit = {
  orderNumber: string
  businessDate: string
  orderStatusName: string
  customerName: string
  storeName: string
  truthRuleKey: 'three_piece_bundle' | 'two_piece_bundle' | 'legion_dual_screen_combo'
  truthRuleLabel: string
  truthProductTypes: string[]
  truthPnMtms: string[]
  truthSerialNumbers: string[]
  truthProducts: Array<{
    skuKey: string
    productName: string
    pnMtm: string
    spec: string
    productType: string
    serialNumbers: string[]
  }>
  currentRowCount: number
  currentRuleKeys: string[]
  currentPhones: string[]
  currentVoucherMissingCount: number
  currentVerificationMissingCount: number
  auditStatus: 'ok' | 'missing_agent_scan' | 'rule_mismatch' | 'verification_gap'
  message: string
}

export type EducationSubsidyAgentScanSnapshot = {
  generatedAt: string
  source: 'education_subsidy_agent_scan_summary'
  sourceGroupName: string
  sourceGroupNames?: string[]
  summary: {
    totalCount: number
    pendingOutboundCount: number
    unpaidCount: number
    paidCount: number
    matchedOutboundCount: number
    totalEducationDiscountAmount: number
    totalServiceFee: number
    totalZhixiangjinAmount?: number
    unpaidServiceFee: number
    phoneMismatchCount?: number
  }
  groupSummaries?: Array<{
    sourceGroupName: string
    collectionSource: string
    serviceFeePerUnit: number
    totalCount: number
    pendingOutboundCount: number
    unpaidCount: number
    paidCount: number
    matchedOutboundCount: number
    totalEducationDiscountAmount: number
    totalServiceFee: number
    totalZhixiangjinAmount?: number
    unpaidServiceFee: number
  }>
  bundleSummary?: EducationAgentBundleSummary
  bundleOrderAuditSummary?: {
    truthOrderCount: number
    truthThreePieceCount: number
    truthTwoPieceCount: number
    truthLegionCount: number
    okCount: number
    missingAgentScanCount: number
    ruleMismatchCount: number
    verificationGapCount: number
  }
  bundleOrderAudit?: EducationAgentBundleOrderAudit[]
  rows: EducationSubsidyAgentScanRow[]
  phoneMismatchAlerts?: Array<{
    id: string
    orderNumber?: string
    serialNumber?: string
    sourceGroupName?: string
    customerName?: string
    customerPhone?: string
    agentPhone?: string
    message: string
  }>
}

export type GrayWholesaleQuote = {
  source: 'wechat-official-account'
  accountName: string
  entryPoint: string
  quoteDate: string
  capturedAt: string
  productText: string
  marketWholesalePrice?: number
  maskedPriceText?: string
  taxIncluded: false
  serviceIncluded: false
  matchFingerprint: string
  evidenceText?: string
}

export type GrayWholesaleSnapshot = {
  generatedAt: string
  accountName: string
  entryPoint: string
  quoteDate?: string
  latestVisibleArticleDate?: string
  effectiveQuoteDate?: string
  hasSupportedLenovoQuotes?: boolean
  isCarriedForward: boolean
  carryForwardFrom?: string
  sourceFile?: string
  quoteCount: number
  quotes: GrayWholesaleQuote[]
}

export type CompetitorMonitorBrand = '联想京东自营' | 'THINK笔记本' | '华硕笔记本' | '惠普笔记本' | '华为笔记本'

export type CompetitorMonitorItem = {
  brand: CompetitorMonitorBrand
  rank: number
  rankingBucket?: 'light-notebook' | 'gaming-notebook' | 'tablet'
  productName: string
  configSummary?: string
  salesVolumeText?: string
  jdSelfPrice?: number
  jdPreSubsidyPrice?: number
  jdSubsidyPrice?: number
  jdUrl?: string
  capturedAt: string
  sourceFile?: string
  note?: string
  activityNotes?: string[]
  educationSubsidyNotes?: string[]
  grayWholesalePrice?: number
  keepCustomerRetailPrice?: number
  keepCustomerSubsidyPrice?: number
}

export type CompetitorMonitorSnapshot = {
  generatedAt: string
  quoteDate?: string
  isCarriedForward: boolean
  carryForwardFrom?: string
  itemCount: number
  completenessAudit?: {
    status: 'complete' | 'incomplete'
    expectedTotalCount: number
    actualItemCount: number
    missingItemCount: number
    incompleteItemCount: number
    staleItemCount: number
    missingBucketCount: number
    missingBrandCount: number
    blockers: string[]
  }
  brands: Array<{
    brand: CompetitorMonitorBrand
    itemCount: number
    latestCapturedAt?: string
    items: CompetitorMonitorItem[]
  }>
}

export type RetailZoneDecision = {
  skuKey: string
  productName: string
  pnMtm?: string
  category?: string
  currentStock: number
  sellableStock: number
  serialCount: number
  physicalHoldStock?: number
  totalStock?: number
  inventoryAverageCost?: number
  realtimePurchasePrice?: number
  grayWholesalePrice?: number
  grayRetailPreSubsidyPrice?: number
  graySubsidyPrice?: number
  lenovoOfficialPrice?: number
  lenovoOfficialPostSubsidyPrice?: number
  jdPrice?: number
  jdPostSubsidyPrice?: number
  platformSubsidyPrice?: number
  taobaoPrice?: number
  jdUrl?: string
  lenovoUrl?: string
  lenovoOfficialUrl?: string
  tmallUrl?: string
  fullServiceSubsidyPrice?: number
  regularChannelSubsidyPrice?: number
  defensiveLowSubsidyPrice?: number
  recommendedPreSubsidyPrice?: number
  floorPreSubsidyPrice?: number
  expectedRegularMargin?: number
  expectedDefensiveMargin?: number
  approval: '销售可用' | '店长审批' | '老板审批'
  riskLevel: '低' | '中' | '高'
  approvalReasons: string[]
  salesNote: string
  riskNote: string
}

export type ManualPriceField = 'realtimePurchasePrice' | 'marketWholesalePrice' | 'retailPreSubsidyPrice' | 'defensivePostSubsidyPrice'

export type ManualPriceOverride = Partial<Record<ManualPriceField, number>> & {
  updatedAt: string
}

export type ManualPriceOverrides = Record<string, ManualPriceOverride>

export type ManualPriceOverridesSnapshot = {
  generatedAt: string
  source: 'system_manual_price_overrides'
  overrides: ManualPriceOverrides
  retailZone?: RetailZoneSnapshot
}

export type StoreManualPromotionMode = 'minus_amount' | 'fixed_price'

export type StoreManualPromotion = {
  id: string
  skuKey: string
  productName?: string
  pnMtm?: string
  category?: string
  mode: StoreManualPromotionMode
  value: number
  validFrom: string
  validTo: string
  note?: string
  enabled: boolean
  updatedAt: string
}

export type StoreManualPromotionsSnapshot = {
  generatedAt: string
  source: string
  itemCount: number
  items: StoreManualPromotion[]
}

export type ManufacturerManualPromotion = {
  id: string
  sourceKey: string
  outboundDate: string
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  boostAmount: number
  educationAmount: number
  validFrom?: string
  validTo?: string
  marketingPoEnabled: boolean
  educationEnabled: boolean
  sourceActivityIds?: string[]
  sourceLabels?: string[]
  note?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ManufacturerManualPromotionsSnapshot = {
  generatedAt: string
  source: string
  itemCount: number
  items: ManufacturerManualPromotion[]
}

export type CrossOutboundCheckMatchMode = 'sku' | 'mtm'
export type CrossOutboundCheckSettlementMode = 'priceDiff' | 'perUnitAmount'

export type CrossOutboundCheckRule = {
  id: string
  matchMode: CrossOutboundCheckMatchMode
  sourceKey: string
  sourceLabel?: string
  skuKey?: string
  pnMtm?: string
  productName?: string
  spec?: string
  category?: string
  counterparty: string
  settlementMode: CrossOutboundCheckSettlementMode
  calculationBasis?: 'salesPrice' | 'purchaseCost'
  settlementPrice?: number | null
  perUnitAmount?: number | null
  validFrom: string
  validTo: string
  note?: string
  enabled: boolean
  createdAt?: string
  updatedAt: string
}

export type CrossOutboundCheckRulesSnapshot = {
  generatedAt: string
  source: string
  itemCount: number
  items: CrossOutboundCheckRule[]
}

export type CrossOutboundCheckHistoryItem = {
  id: string
  ruleId?: string
  sourceKey?: string
  orderNumber: string
  outboundDate: string
  businessDate?: string
  skuKey: string
  pnMtm?: string
  productName: string
  spec?: string
  category?: string
  productLine?: string
  quantity: number
  costUnitPrice?: number | null
  costTotalAmount?: number | null
  costSource?: 'serialActual' | 'movementCost' | 'inventoryAverageCost' | 'fallbackAverageCost' | 'unknown'
  serialCosts?: number[]
  salesUnitPrice?: number | null
  salesTotalAmount?: number | null
  settlementMode: CrossOutboundCheckSettlementMode
  calculationBasis?: 'salesPrice' | 'purchaseCost'
  settlementPrice?: number | null
  perUnitAmount?: number | null
  crossCheckAmount: number
  counterparty: string
  serialNumbers?: string[]
  storeName?: string
  operatorName?: string
  note?: string
  ruleValidFrom?: string
  ruleValidTo?: string
  createdAt?: string
  updatedAt: string
}

export type CrossOutboundCheckHistorySnapshot = {
  generatedAt: string
  source: string
  itemCount: number
  items: CrossOutboundCheckHistoryItem[]
}

export type ProductActivityCurrentItem = {
  id: string
  skuKey: string
  activityKind: string
  activityLabel: string
  amount: number
  validFrom?: string
  validTo?: string
  ruleText?: string
  sourceFile?: string
  sourceType?: string
  sourceActivityId?: string
  payload?: Record<string, unknown>
  updatedAt?: string
}

export type ProductActivityCurrentSnapshot = {
  generatedAt: string
  source: string
  itemCount: number
  items: ProductActivityCurrentItem[]
}

export type InventoryAdjustmentField = 'currentStock' | 'sellableStock' | 'unsellableStock' | 'pendingInboundStock'

export type InventoryAdjustment = Partial<Record<InventoryAdjustmentField, number>> & {
  note?: string
  updatedAt: string
}

export type InventoryAdjustments = Record<string, InventoryAdjustment>

export type InventoryAdjustmentsSnapshot = {
  generatedAt: string
  source: 'system_inventory_adjustments'
  adjustments: InventoryAdjustments
  inventory?: StandardInventorySnapshot
  retailZone?: RetailZoneSnapshot
}

export type InventoryMovementType =
  | 'sales_outbound'
  | 'purchase_inbound'
  | 'transfer_inbound'
  | 'transfer_outbound'
  | 'po_hold_inbound'
  | 'po_hold_release'
  | 'po_hold_outbound'
  | 'manual_adjustment'

export type InventoryMovementRecord = {
  id: string
  skuKey: string
  quantity: number
  movementType: InventoryMovementType
  businessDate: string
  serialNumber?: string
  serialNumbersDisplay?: string
  documentNumber?: string
  sourceRef?: string
  sourceDocumentType?: string
  operatorName?: string
  supplierName?: string
  storeName?: string
  locationName?: string
  purchaseCost?: number
  productName?: string
  pnMtm?: string
  spec?: string
  note?: string
  isNonNormalPurchaseInbound?: boolean
  updatedAt: string
}

export type InventoryMovementsSnapshot = {
  generatedAt: string
  source: 'system_inventory_movements'
  records: InventoryMovementRecord[]
  inventory?: StandardInventorySnapshot
  retailZone?: RetailZoneSnapshot
}

export type SerialOverride = {
  skuKey?: string
  inboundDate?: string
  purchaseCost?: number
  documentNumber?: string
  operatorName?: string
  supplierName?: string
  storeName?: string
  locationName?: string
  productName?: string
  pnMtm?: string
  spec?: string
  note?: string
  updatedAt: string
}

export type SerialOverrides = Record<string, SerialOverride>

export type SerialOverridesSnapshot = {
  generatedAt: string
  source: 'system_serial_overrides'
  overrides: SerialOverrides
  inventory?: StandardInventorySnapshot
  retailZone?: RetailZoneSnapshot
}

export type RetailZoneSnapshot = {
  generatedAt: string
  summary: {
    risks?: RiskItem[]
  }
  subsidyRule: {
    region: string
    ratio: number
    cap: number
    categoryCaps?: {
      computer: number
      tablet: number
      phone: number
    }
    eligibilityNote?: string
  }
  sourceStatus: Array<{
    source: string
    status: 'fresh' | 'stale' | 'missing'
    capturedAt?: string
    itemCount: number
    note: string
  }>
  decisions: {
    total: number
    offset: number
    limit: number
    items: RetailZoneDecision[]
  }
}

export type PublishedProductProjectionItem = {
  skuKey: string
  displayTitle: string
  productName?: string
  pnMtm?: string
  spec?: string
  category?: string
  currentStock: number
  sellableStock: number
  serialCount: number
  physicalHoldStock?: number
  storeCurrentStock?: number
  storeSellableStock?: number
  totalStock?: number
  availableSerialCount?: number
  pricing?: {
    storeRetailPrice?: number
    adjustedPreSubsidyPrice?: number
    nationalSubsidyPrice?: number
    finalPrice?: number
    marketingPoAmount?: number
    educationDiscountAmount?: number
    storeManualPromotionAmount?: number
    effectiveFrom?: string
    effectiveTo?: string
    countdownDays?: number
    priceVersion?: string
  }
  marketingPoActivity?: {
    id?: string
    kind?: string
    label?: string
    amount?: number
    validFrom?: string
    validTo?: string
    countdownDays?: number
    ruleText?: string
    sourceFile?: string
    sourceType?: string
  } | null
  educationActivity?: {
    id?: string
    kind?: string
    label?: string
    amount?: number
    validFrom?: string
    validTo?: string
    countdownDays?: number
    ruleText?: string
    sourceFile?: string
    sourceType?: string
  } | null
  storeManualPromotion?: {
    id?: string
    mode?: string
    value?: number
    validFrom?: string
    validTo?: string
    note?: string
    enabled?: boolean
    updatedAt?: string
  } | null
  activityLabels?: string[]
  channelViews?: {
    retailHero?: Record<string, unknown>
    cashier?: Record<string, unknown>
    adMachine?: Record<string, unknown>
  }
}

export type PublishedProductProjectionSnapshot = {
  generatedAt: string
  itemCount: number
  pricedCount?: number
  subsidyCount?: number
  finalPriceCount?: number
  items: PublishedProductProjectionItem[]
}

export type MarketplacePriceSnapshot = {
  generatedAt: string
  collector?: {
    name?: string
    mode?: string
    version?: number
    limitation?: string
    nextStep?: string
  }
  sources: Array<{
    source: 'jd' | 'lenovo_official' | 'taobao_subsidy'
    label: string
    recordCount: number
    capturedCount: number
    captureMethod: string
  }>
  itemCount: number
  records?: Array<{
    source: 'jd' | 'lenovo_official' | 'taobao_subsidy'
    productId: string
    query: string
    configuredUrl?: string
    matchTitle?: string
    price?: number
    preSubsidyPrice?: number
    postSubsidyPrice?: number
    couponAdjustedPrice?: number
    priceType: 'display_price' | 'pre_discount_price' | 'pre_subsidy_price' | 'post_subsidy_price' | 'coupon_adjusted_price' | 'manual_price' | 'url_configured_only'
    priceBasis: string
    confidence?: 'confirmed' | 'provisional' | 'manual' | 'sample' | 'url_configured_only'
    collectionStatus: 'captured' | 'manual_review_required' | 'url_configured_only' | 'unavailable'
    evidence: {
      evidenceUrl?: string
      capturedAt?: string
      capturedBy: string
      note?: string
    }
    raw?: {
      platformMainTitle?: string
      configSubtitle?: string
      selectedSpecText?: string
      visibleConfig?: string
      matchedConfig?: string
      mainTitle?: string
      productTitle?: string
      searchTitle?: string
      subTitle?: string
      subtitle?: string
      subheading?: string
      viceTitle?: string
      sellingPoint?: string
      configurationTitle?: string
      specTitle?: string
      discountNotes?: string[]
      platformCouponNotes?: string[]
      educationDiscountNotes?: string[]
      governmentSubsidyNotes?: string[]
      displayedPostSubsidyPrice?: number
      educationDiscountAmount?: number | null
      platformCouponAmount?: number | null
      governmentSubsidyAmount?: number | null
      couponAmountCaptureStatus?: 'amount_captured' | 'amount_not_expanded'
      rawText?: string
      matchScore?: number
    }
  }>
}

export type ProductUrlLockSnapshot = {
  generatedAt: string
  source: 'product_url_lock_store'
  locks: Array<{
    skuKey: string
    pnMtm?: string
    productName: string
    category?: string
    source: 'jd_self' | 'jd_supermarket' | 'jd_authorized' | 'lenovo_official' | 'manmanbuy'
    url: string
    platformSkuId?: string
    matchTitle?: string
    matchStatus: 'locked' | 'candidate' | 'unavailable'
    confidence: 'confirmed' | 'manual_review_required' | 'url_configured_only'
    priority: number
    price?: number
    capturedAt: string
    evidenceNote?: string
    raw?: {
      platformMainTitle?: string
      configSubtitle?: string
      selectedSpecText?: string
      visibleConfig?: string
      matchedConfig?: string
      mainTitle?: string
      productTitle?: string
      searchTitle?: string
      subTitle?: string
      subtitle?: string
      subheading?: string
      viceTitle?: string
      sellingPoint?: string
      configurationTitle?: string
      specTitle?: string
      discountNotes?: string[]
      platformCouponNotes?: string[]
      educationDiscountNotes?: string[]
      governmentSubsidyNotes?: string[]
      educationDiscountAmount?: number | null
      platformCouponAmount?: number | null
      governmentSubsidyAmount?: number | null
      couponAmountCaptureStatus?: 'amount_captured' | 'amount_not_expanded'
      discoveryMethod?: string
    }
  }>
}

export type LenovoWarrantySnapshot = {
  generatedAt: string
  total: number
  successCount: number
  captchaRequiredCount: number
  failedCount: number
  records: Array<{
    serialNumber: string
    skuKey: string
    officialLookupUrl: string
    status: 'success' | 'not_found' | 'captcha_required' | 'failed'
    checkedAt: string
    officialWarrantyStart?: string
    officialWarrantyEnd?: string
    servicePlan?: string
    officialProductName?: string
    evidenceScreenshotPath?: string
    evidenceTextPath?: string
    rawTextExcerpt?: string
    failureReason?: string
  }>
}

export type WarrantyCheckQueueSnapshot = {
  generatedAt: string
  source: 'lenovo-official-warranty-placeholder'
  limitation: string
  nextStep: string
  total: number
  items: Array<{
    serialNumber: string
    skuKey: string
    productName: string
    pnMtm?: string
    status: 'pending'
    riskHint: string
    officialLookupUrl: string
  }>
}

export type ProductLibraryOverview = {
  productMasterCount: number
  skuCount: number
  serialCount: number
  sourceLinkCount: number
  evidenceCount: number
  replayCount: number
  priceAdjustmentCount: number
  businessRuleCount: number
  collectionOverrideCount: number
}

export type ProductLibraryCategorySummaryItem = {
  category: string
  product_count: number
  sku_count: number
  current_stock: number
  sellable_stock: number
  serial_count: number
  inbound_units: number
  outbound_units: number
  protection_count: number
  pending_protection_count: number
  pending_protection_amount: number
}

export type ProductLibraryCategorySummarySnapshot = {
  items: ProductLibraryCategorySummaryItem[]
  count: number
}

export type ProductLibraryProductListItem = {
  id: string
  canonical_name: string
  default_category: string
  primary_sku_key: string
  configuration_summary: string
  review_status: string
  source_confidence: string
  last_source_system: string
  last_synced_at: string
  updated_at: string
  pn_mtm?: string
  sellable_stock?: number
  current_stock?: number
  source_category?: string
  jd_subcategory?: string
  catalog_source?: string
  pending_protection_count?: number
  pending_protection_amount?: number
}

export type ProductLibraryProductsSnapshot = {
  items: ProductLibraryProductListItem[]
  count: number
}

export type ProductLibraryDetailSnapshot = {
  generatedAt?: string
  items: ProductLibraryDetail[]
}

export type ProductLibraryBusinessRule = {
  product_id: string
  store_price_rule_text: string
  subsidy_rule_text: string
  collection_rule_text: string
  inbound_rule_text: string
  outbound_rule_text: string
  protection_rule_text: string
  notes: string
  updated_by: string
  updated_at: string
}

export type ProductLibraryCollectionOverride = {
  sku_key: string
  jd_url: string
  lenovo_url: string
  tmall_url: string
  distributor_quote_note: string
  gray_quote_note: string
  capture_note: string
  updated_by: string
  updated_at: string
}

export type ProductLibrarySourceLink = {
  id: string
  entity_type: string
  entity_id: string
  source_system: string
  source_type: string
  source_key: string
  source_value: string
  snapshot_file: string
  first_seen_at: string
  last_seen_at: string
  payload?: Record<string, unknown>
}

export type ProductLibraryEvidence = {
  id: string
  entity_type: string
  entity_id: string
  source_system: string
  evidence_type: string
  title: string
  file_path: string
  source_url: string
  captured_at: string
  captured_by: string
  checksum: string
  note: string
  payload?: Record<string, unknown>
  created_at: string
}

export type ProductLibraryReplay = {
  id: string
  replay_type: string
  source_system: string
  source_ref: string
  scope?: Record<string, unknown>
  status: string
  result?: Record<string, unknown>
  error_message: string
  created_by: string
  started_at: string
  finished_at: string
}

export type ProductLibraryChangeLog = {
  id: string
  entity_type: string
  entity_id: string
  field_name: string
  before_value: string
  after_value: string
  change_reason: string
  changed_by: string
  source_system: string
  created_at: string
}

export type ProductLibraryDetail = {
  id: string
  product_id: string
  canonical_name: string
  default_category: string
  primary_sku_key: string
  configuration_summary: string
  review_status: string
  source_confidence: string
  notes: string
  updated_at: string
  skus: Array<Record<string, unknown>>
  serials: Array<Record<string, unknown>>
  sourceLinks: Array<Record<string, unknown>>
  evidence: Array<Record<string, unknown>>
  priceAdjustments: Array<Record<string, unknown>>
  businessRule: ProductLibraryBusinessRule
  collectionOverrides: ProductLibraryCollectionOverride[]
  recentMovements: Array<Record<string, unknown>>
  priceProtectionHistory: Array<Record<string, unknown>>
  movementSummary: {
    inboundUnits: number
    outboundUnits: number
    movementCount: number
  }
  protectionSummary: {
    historyCount: number
    pendingCount: number
    pendingAmount: number
  }
  sqlPriceContext?: {
    retailDecisions: Array<Record<string, unknown>>
    priceSignals: Array<Record<string, unknown>>
    marketplaceRecords: Array<Record<string, unknown>>
    marketingActivities: Array<Record<string, unknown>>
    storeManualPromotions: Array<Record<string, unknown>>
    snapshotSources: string[]
  }
}

export type ProductLibrarySourceLinkSnapshot = {
  items: ProductLibrarySourceLink[]
  count: number
}

export type ProductLibraryEvidenceSnapshot = {
  items: ProductLibraryEvidence[]
  count: number
}

export type ProductLibraryReplaySnapshot = {
  items: ProductLibraryReplay[]
  count: number
}

export type ProductLibraryChangeLogSnapshot = {
  items: ProductLibraryChangeLog[]
  count: number
}

export type LocalSyncPipeline = {
  name: string
  label: string
  description: string
}

export type LocalSyncPipelineSnapshot = {
  items: LocalSyncPipeline[]
  count: number
}

export type LocalSyncLatestReport = Record<string, unknown>
export type LocalSyncFailureQueue = Record<string, unknown>
export type ProductLibraryRebuildLinkedViewsResult = {
  ok: boolean
  report?: Record<string, unknown>
}

export type ScheduledTaskConsoleOverview = {
  taskCount: number
  enabledTaskCount: number
  computerUseTaskCount: number
  watchdogSummary?: Record<string, unknown>
  generatedAt: string
}

export type ScheduledTaskConsoleTask = {
  taskName: string
  label: string
  category: string
  priority: number
  requiresComputerUse: boolean
  relatedPipeline: string
  defaultPrompt: string
  currentPrompt: string
  workflowSummary: string
  stepItems: string[]
  sourceItems: string[]
  boundaryItems: string[]
  timeWindows: Array<{ label: string; window: string }>
  operatorNotes: string
  enabled: boolean
  updatedBy: string
  updatedAt: string
  latestReport?: Record<string, unknown>
  watchdogChecks?: Array<Record<string, unknown>>
}

export type ScheduledTaskConsoleTaskSnapshot = {
  items: ScheduledTaskConsoleTask[]
  count: number
}

export type OpenClawReceiptStatus = 'completed'
  | 'completed_with_warnings'
  | 'blocked_missing_input'
  | 'blocked_page_risk'
  | 'executed_not_closed'
  | 'failed'

export type OpenClawReceipt = {
  receiptId: string
  taskName: string
  taskCategory: string
  status: OpenClawReceiptStatus
  capturedAt: string
  sourceSystem: string
  sourceWindow?: string
  rawEvidencePaths: string[]
  structuredOutputPaths: string[]
  dedupeKeys: string[]
  recordCount: number
  blockingReason?: string | null
  manualActionRequired?: boolean
  codexActionRequired?: boolean
  codexAction?: string | null
  receiptPath?: string
  notes?: string[]
}

export type OpenClawReceiptSnapshot = {
  generatedAt: string
  rootDir: string
  total: number
  byStatus: Record<string, number>
  latestCapturedAt?: string
  readyForCodex: OpenClawReceipt[]
  unresolved: OpenClawReceipt[]
  manualActionRequired: OpenClawReceipt[]
  latestByTask: Record<string, OpenClawReceipt>
  receipts: OpenClawReceipt[]
}

export type ZdtOpenclawBridgeSnapshot = {
  generatedAt: string
  source?: string
  summary?: {
    latestCapturedAt?: string
    latestBusinessDate?: string
    productCount?: number
    orderCount?: number
    inventoryCount?: number
  }
}

export type OpenClawCommandStatus =
  | 'drafted'
  | 'queued'
  | 'steered'
  | 'acknowledged'
  | 'executing'
  | 'completed'
  | 'blocked'
  | 'cancelled'

export type OpenClawCommand = {
  commandId: string
  title: string
  instruction: string
  status: OpenClawCommandStatus
  createdAt: string
  updatedAt?: string
  taskName?: string
  sourceSystem: 'codex' | 'openclaw'
  targetSystem: 'openclaw' | 'codex'
  sourceSession?: string
  relatedReceiptId?: string
  operator?: string
  resultSummary?: string
  blockingReason?: string
  evidencePaths?: string[]
}

export type OpenClawCommandBoardSnapshot = {
  generatedAt: string
  rootDir: string
  total: number
  byStatus: Record<string, number>
  latestUpdatedAt?: string
  pendingForOpenClaw: OpenClawCommand[]
  pendingForCodex: OpenClawCommand[]
  latestByTask: Record<string, OpenClawCommand>
  commands: OpenClawCommand[]
}

export type OpenClawChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  kind: 'message' | 'command' | 'receipt' | 'feedback'
  text: string
  timestamp: string
  taskName?: string
  status?: string
  commandId?: string
  receiptId?: string
  tone?: 'info' | 'good' | 'warn' | 'danger'
}

export type OpenClawChatPreset = {
  key: string
  taskName: string
  title: string
  category: string
  summary: string
  prompt: string
  commandMode?: 'normal' | 'scheduled_task' | 'history_collection' | 'custom_collection'
}

export type OpenClawChatBoardSnapshot = {
  generatedAt: string
  session: {
    sessionId: string
    updatedAt: string
  }
  dispatch: {
    running: boolean
    pendingOpenClawCount: number
    pendingCodexCount: number
    blockedCount: number
    lastRequestedAt?: string | null
    lastFinishedAt?: string | null
    lastError?: string | null
  }
  stats: {
    receiptTotal: number
    commandTotal: number
    blockedCount: number
    pendingOpenClawCount: number
    pendingCodexCount: number
  }
  presetTasks: OpenClawChatPreset[]
  pendingOpenClawTasks: OpenClawCommand[]
  pendingCodexTasks: OpenClawCommand[]
  blockedItems: OpenClawReceipt[]
  latestReceipt?: OpenClawReceipt | null
  latestCommand?: OpenClawCommand | null
  messages: OpenClawChatMessage[]
}

export type PromptWorkspaceAuditItem = {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  advice: string
}

export type PromptWorkspaceBlueprint = {
  taskUnderstanding?: {
    title?: string
    projectName?: string
    coreProblem?: string
    targetOutcome?: string
  }
  functionalBlueprint?: string[]
  keywordSuggestions?: string[]
  missingFields?: string[]
}

export type PromptWorkspaceAudit = {
  firstPrinciplesReview?: PromptWorkspaceAuditItem[]
  logicSuggestions?: string[]
  riskAlerts?: string[]
  minimaxReview?: {
    qualityVerdict?: 'pass' | 'warn' | 'fail'
    firstPrinciplesReview?: string[]
    logicIssues?: string[]
    rewriteSuggestions?: string[]
    acceptanceRisks?: string[]
  }
}

export type PromptWorkspaceEntry = {
  id: string
  title: string
  category: string
  primaryCategory: string
  secondaryCategory: string
  sequenceNo: number
  isFavorite: boolean
  projectName: string
  systemPurpose: string
  existingContext: string
  currentProblem: string
  targetOutcome: string
  rawNotes: string
  generatedPrompt: string
  optimizedPrompt: string
  generatedSummary: string
  blueprint: PromptWorkspaceBlueprint
  audit: PromptWorkspaceAudit
  sourcePayload: Record<string, unknown>
  minimaxStatus: string
  minimaxPayload: Record<string, unknown>
  keywords: string[]
  revisions?: Array<{
    id: string
    revisionNo: number
    actionType: string
    generatedPrompt: string
    optimizedPrompt: string
    generatedSummary: string
    blueprint: PromptWorkspaceBlueprint
    audit: PromptWorkspaceAudit
    minimaxStatus: string
    minimaxPayload: Record<string, unknown>
    createdAt: string
  }>
  createdAt: string
  updatedAt: string
}

export type PromptWorkspaceKnowledgeItem = {
  id: string
  title: string
  keyword: string
  content: string
  tags: string[]
  knowledgeType?: string
  placementKey?: string
  sceneKey?: string
  sceneLabel?: string
  recommendedPrompt?: string
  matchScore?: number
  sourceEntryId?: string
  sourceKind?: string
  createdAt: string
  updatedAt: string
}

export type PromptWorkspaceKnowledgeRecommendBundle = {
  items: PromptWorkspaceKnowledgeItem[]
  count: number
  query: string
  scene?: {
    sceneKey?: string
    sceneLabel?: string
    reason?: string
    searchTerms?: string[]
    engine?: string
  }
}

export type PromptWorkspaceTemplate = {
  preset: string
  sections: Array<{ key: string; label: string }>
  defaultRules: string[]
  defaultAcceptanceCriteria: string[]
  defaultCategoryDraft: {
    primaryCategory: string
    secondaryCategory: string
    sequenceNo: number
  }
  defaultBackground: {
    projectName: string
    systemPurpose: string
    existingContext: string
  }
  lastBackground: {
    projectName: string
    systemPurpose: string
    existingContext: string
  }
  ruleSceneCatalog?: Array<{ key: string; label: string; keywords: string[] }>
  templateExample: string
}

export type PromptWorkspaceTemplateResponse = {
  ok: boolean
  template: PromptWorkspaceTemplate
}

export type RetailCoreStatus = {
  database: string
  seeded?: {
    skus: number
    serials: number
    movements: number
  }
  tableCounts: Record<string, number>
}

export type AdminUserSnapshot = {
  generatedAt: string
  items: Array<{
    username: string
    displayName: string
    active: boolean
    createdAt: string
    updatedAt: string
  }>
}

export type RetailCoreCategoryTree = {
  categoryNodes: Array<{
    id: string
    source_system: 'smart_retail' | 'zhidiantong' | 'catalog_source'
    name: string
    level: number
    parent_id?: string | null
    display_order: number
  }>
  skuMappings: Array<{
    sku_key: string
    smart_retail_category: string
    zhidiantong_category: string
    jd_subcategory: string
    catalog_source: string
  }>
  summary: {
    categoryNodeCount: number
    skuMappingCount: number
    zhidiantongCategoryCount: number
    smartRetailCategoryCount: number
    jdSubcategoryCount: number
  }
}

export type RetailCoreSerialItem = {
  serial_number: string
  sku_key: string
  product_name: string
  pn_mtm?: string
  spec?: string
  status: string
  warehouse_code: string
  location_code: string
  cost_amount?: number
  inbound_date?: string
  inbound_document_no?: string
  operator_name?: string
  supplier_name?: string
  warranty_status: string
  warranty_checked_at?: string
  official_warranty_start?: string
  official_warranty_end?: string
  warranty_service_plan?: string
  warranty_official_product_name?: string
  warranty_official_lookup_url?: string
  warranty_evidence_screenshot_path?: string
  warranty_evidence_text_path?: string
  warranty_failure_reason?: string
  updated_at: string
}

export type RetailCoreSerialItems = {
  items: RetailCoreSerialItem[]
  count: number
  statusCounts: Record<string, number>
}

export type PhysicalStockHoldItem = {
  serial_number: string
  sku_key: string
  source_order_no: string
  source_order_line_id: string
  hold_reason: string
  warehouse_code: string
  location_code: string
  hold_status: string
  matched_service_order_no?: string
  matched_outbound_movement_id?: string
  note?: string
  created_at: string
  updated_at: string
  source_sales_business_date?: string
  product_name?: string
  pn_mtm?: string
  spec?: string
  serial_status?: string
}

export type PhysicalStockHoldSnapshot = {
  generatedAt: string
  source: string
  count: number
  statusCounts: Record<string, number>
  items: PhysicalStockHoldItem[]
}

export type PhysicalHoldSalesOrderCandidate = {
  orderNumber: string
  businessDate: string
  customerName: string
  cashierName: string
  shopName: string
  statusName: string
  payAmount?: number | null
  serialCount: number
  transferredSerialCount: number
  eligibleTransferCount: number
  activeHoldCount: number
  consumedHoldCount: number
  releasedHoldCount: number
  revokedHoldCount?: number
  transferStatus: string
  transferStatusLabel: string
  serialNumbers: string[]
  eligibleSerialNumbers: string[]
  skuKeys: string[]
  productNames: string[]
}

export type PhysicalHoldSalesOrderCandidateSnapshot = {
  generatedAt: string
  source: string
  count: number
  summary: Record<string, number>
  items: PhysicalHoldSalesOrderCandidate[]
}

export type RetailCoreMovement = {
  id: string
  sku_key: string
  product_name?: string
  category?: string
  source_category?: string
  jd_subcategory?: string
  serial_number?: string
  serial_numbers_display?: string
  movement_type: string
  quantity: number
  business_date: string
  source_system: string
  source_ref?: string
  service_no?: string
  source_document_type?: string
  store_name?: string
  unit_name?: string
  unit_cost?: number | null
  amount?: number | null
  service_type_name?: string
  operate_type_name?: string
  pay_remark?: string
  company_name?: string
  shop_name?: string
  warehouse_location_name?: string
  property_name?: string
  property_value?: string
  spu_no?: string
  user_name?: string
  pay_time?: string
  flow_category?: string
  pn_mtm?: string
  spec?: string
  location_name?: string
  operator_name?: string
  supplier_name?: string
  inbound_document_no?: string
  note?: string
  created_at: string
}

export type RetailCoreMovements = {
  items: RetailCoreMovement[]
  count: number
  typeCounts: Record<string, number>
  flowCategoryCounts?: Record<string, number>
  operateTypeCounts?: Record<string, number>
}

export type RetailCoreSalesOrder = {
  id: string
  order_no?: string
  order_number?: string
  business_no?: string
  external_order_no?: string
  store_code: string
  operator_id: string
  customer_name?: string
  status: string
  status_name?: string
  order_type?: number | null
  order_type_name?: string
  channel_type_name?: string
  cashier_name?: string
  total_quantity?: number
  pay_amount?: number | null
  pay_time?: string
  created_time?: string
  shop_id?: string
  shop_name?: string
  company_id?: string
  operate_time?: string
  total_amount: number | null
  amount_status?: string
  amount_source?: string
  business_date: string
  note?: string
  created_at: string
  lines?: Array<{
    id: string
    order_id: string
    sku_key: string
    sku_no?: string
    product_name?: string
    product_no?: string
    mtm_code?: string
    spec?: string
    supplier_name?: string
    quantity: number
    deal_price: number | null
    unit_price?: number | null
    pay_amount?: number | null
    deal_amount?: number | null
    discount_amount?: number | null
    serial_number?: string
    serial_numbers_json?: string
    created_at: string
  }>
}

export type RetailCoreSalesOrders = {
  items: RetailCoreSalesOrder[]
  count: number
}

export type RetailCoreCustomer = {
  id: string
  name: string
  phone?: string
  created_at: string
  order_count?: number
  latest_order_date?: string
  total_paid_amount?: number
}

export type RetailCoreCustomers = {
  items: RetailCoreCustomer[]
  count: number
  source?: string
}

export type RetailCoreSyncGap = {
  id: string
  order_number: string
  external_order_number?: string
  gap_type: string
  status: 'open' | 'resolved' | string
  severity: 'critical' | 'warning' | string
  business_date?: string
  sku_key?: string
  product_name?: string
  serial_number?: string
  missing_fields?: string[]
  source_flags?: Record<string, boolean>
  message?: string
  source_files?: string[]
  created_at?: string
  updated_at?: string
}

export type RetailCoreSyncGapQueue = {
  items: RetailCoreSyncGap[]
  count: number
  statusCounts?: Record<string, number>
}

export type EducationAgentScanSyncGapItem = {
  orderNumber: string
  operateTime?: string
  sourceGroupName?: string
  collectionSource?: string
  skuKey?: string
  productName?: string
  serialNumbers: string[]
  missingSerialNumbers: string[]
}

export type EducationAgentScanSyncGapSnapshot = {
  generatedAt?: string
  source?: string
  salesOrderCount?: number
  agentScanSerialCount?: number
  gapCount?: number
  items: EducationAgentScanSyncGapItem[]
}

export type RetailCoreSalesPriceProtectionHistoryItem = {
  id: string
  order_number: string
  sku_key: string
  product_name: string
  pn_mtm?: string
  serial_numbers_json?: string
  quantity: number
  outbound_date: string
  outbound_movement_ids_json?: string
  protection_quote_date?: string
  realtime_purchase_price?: number
  inventory_average_cost?: number
  unit_diff?: number
  estimated_protection_amount?: number
  inbound_date?: string
  inbound_cost_amount?: number
  inbound_document_no?: string
  inbound_operator_name?: string
  supplier_name?: string
  source_note?: string
  source_quote_file?: string
  status: string
  updated_at: string
}

export type RetailCoreSalesPriceProtectionHistory = {
  items: RetailCoreSalesPriceProtectionHistoryItem[]
  count: number
}

export type SnSalesComplianceItem = {
  id: string
  orderNumber: string
  salesDate?: string
  outboundDate?: string
  outboundDocumentNumber?: string
  skuKey: string
  productName: string
  pnMtm?: string
  spec?: string
  category?: string
  productLine: 'computer' | 'mobileTablet' | string
  serialNumber?: string
  quantity: number
  salesUnitPrice?: number | null
  salesAmount?: number | null
  payAmount?: number | null
  storeName?: string
  operatorName?: string
  inboundDate?: string
  inboundDocumentNumber?: string
  purchaseCost?: number | null
  supplierName?: string
  locationName?: string
  activityLabels?: string[]
  marketingPoAmount?: number
  educationAmount?: number
  priceProtectionAmount?: number
  claimableAmount?: number
  validation: {
    isValidSalesCandidate: boolean
    chainComplete: boolean
    poEligible: boolean
    educationEligible: boolean
    priceProtectionReady: boolean
    poCompliant: boolean
    hasStockConflict: boolean
    hasOpenSyncGap: boolean
    hasTransferOrOtherOutbound: boolean
  }
  movementChain: {
    hasInbound: boolean
    hasSalesOutbound: boolean
    hasTransferOrOtherOutbound: boolean
    currentStockDiff: number
    openGapTypes: string[]
    movementCount: number
  }
  manualReview: {
    required: boolean
    mode: string
    reason?: string
  }
  status: 'compliant_pass' | 'warning_sn_conflict' | 'warning_activity_gap' | 'warning_chain_gap' | 'blocked_missing_evidence' | string
  statusLabel: string
  recommendedAction?: string
  warnings: string[]
  updatedAt?: string
}

export type SnSalesComplianceSnapshot = {
  generatedAt: string
  source: string
  automation?: {
    autoRefreshSupported: boolean
    realTimeCollectionMode?: string
    realTimeCollectionReason?: string
  }
  summary: {
    totalCount: number
    compliantCount: number
    blockedCount: number
    warningCount: number
    poEligibleCount: number
    educationEligibleCount: number
    priceProtectionReadyCount: number
    claimableAmount: number
    manualReviewCount: number
  }
  items: SnSalesComplianceItem[]
  count: number
}

export type RetailCoreSyncTask = {
  id: string
  external_system_id: string
  task_type: string
  entity_type: string
  entity_id: string
  status: string
  retry_count: number
  last_error?: string
  created_at: string
  updated_at: string
}

export type RetailCoreSyncTasks = {
  items: RetailCoreSyncTask[]
  count: number
}

export type RetailSalesOrderCreatePayload = {
  storeCode: string
  operatorId: string
  customerName?: string
  note?: string
  lines: Array<{
    skuKey: string
    quantity: number
    serialNumbers: string[]
    dealPrice: number
  }>
}

export type RetailPurchaseOrderCreatePayload = {
  supplierId: string
  operatorId: string
  locationCode?: string
  note?: string
  lines: Array<{
    skuKey: string
    productName?: string
    pnMtm?: string
    spec?: string
    category?: string
    sourceCategory?: string
    jdSubcategory?: string
    catalogSource?: string
    quantity: number
    serialNumbers: string[]
    costPrice?: number
  }>
}

export type RetailPriceTagUpdatePayload = {
  skuKey: string
  templateId?: string
  deviceId?: string
  storeCode?: string
  pricePayload: Record<string, string | number | undefined>
}

export type PriceTagConsoleStatus = {
  generatedAt: string
  storeCode: string
  gateway: {
    id: string
    name: string
    system_type: string
    status: string
    created_at: string
  }
  counts: {
    templateCount: number
    deviceCount: number
    bindingCount: number
    pendingTaskCount: number
  }
  templates: Array<{
    id: string
    name: string
    template_type: string
    payload?: Record<string, unknown>
    created_at: string
  }>
  devices: Array<{
    id: string
    vendor: string
    model: string
    store_code: string
    status: string
    battery_level?: number | null
    signal_level?: number | null
    last_seen_at?: string | null
    created_at: string
  }>
  bindings: Array<{
    id: string
    device_id: string
    sku_key: string
    store_code: string
    status: string
    updated_at: string
    vendor?: string
    model?: string
    device_status?: string
  }>
  tasks: Array<{
    id: string
    device_id?: string | null
    sku_key: string
    template_id: string
    pricePayload?: Record<string, unknown>
    status: string
    retry_count: number
    last_error?: string
    created_at: string
    updated_at: string
  }>
  cloudReadiness: string
  source: string
}

const localBrowserHosts = new Set(['127.0.0.1', 'localhost', '::1'])
type InventoryQuoteDataMode = 'api' | 'api_strict' | 'static'

function inferInventoryQuoteApiBase() {
  const configuredBase = import.meta.env.VITE_INVENTORY_QUOTE_API_BASE?.trim()
  if (configuredBase) return configuredBase.replace(/\/$/, '')
  if (typeof window === 'undefined') return 'http://127.0.0.1:8000'
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:8000'
  if (window.location.port === '8000') return window.location.origin
  if (localBrowserHosts.has(window.location.hostname)) {
    return `${window.location.protocol}//${window.location.hostname}:8000`
  }
  // 域名部署默认走同源反向代理，避免强制 :8000 端口导致实时 API 不可达。
  return window.location.origin
}

const inventoryQuoteApiBase = inferInventoryQuoteApiBase()
const offlineReadableCacheName = 'lenovo-smart-retail-readable-cache-v1'
const offlineReadableCacheStore = 'payloads'
let offlineReadableCacheOpenPromise: Promise<IDBDatabase | null> | null = null
const apiResponseMemoryCache = new Map<string, {
  expiresAt: number
  payload?: unknown
  promise?: Promise<unknown | null>
}>()

function inferInventoryQuoteDataMode() {
  const configured = import.meta.env.VITE_INVENTORY_QUOTE_DATA_MODE?.trim() as InventoryQuoteDataMode | undefined
  if (configured === 'api' || configured === 'api_strict' || configured === 'static') return configured
  if (typeof window === 'undefined') return 'api_strict'
  if (window.location.protocol === 'file:') return 'static'
  // 展示页默认优先走实时 API，但 API 超时或短暂不可达时必须能回退到静态快照，
  // 避免只读页面整块空白或把业务数据渲染成 0。
  return 'api'
}

const inventoryQuoteDataMode: InventoryQuoteDataMode = inferInventoryQuoteDataMode()

function inventoryQuoteApiUrl(path: string) {
  if (inventoryQuoteDataMode === 'static') {
    throw new Error('inventory quote api disabled')
  }
  return `${inventoryQuoteApiBase}${path}`
}

function allowStaticFallback() {
  return false
}

function allowOperationalStaticFallback() {
  // 出入库/订单/客户/SN 等运营主链只能走 SQLite/API，不允许 JSON 快照压过新鲜数据。
  return false
}

function normalizeReadableCacheKey(path: string) {
  const [pathname, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.delete('ts')
  const entries = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right))
  const normalized = new URLSearchParams(entries).toString()
  return normalized ? `${pathname}?${normalized}` : pathname
}

function openOfflineReadableCache(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null)
  if (!offlineReadableCacheOpenPromise) {
    offlineReadableCacheOpenPromise = new Promise((resolve) => {
      const request = window.indexedDB.open(offlineReadableCacheName, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(offlineReadableCacheStore)) {
          database.createObjectStore(offlineReadableCacheStore, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    })
  }
  return offlineReadableCacheOpenPromise
}

async function saveOfflineReadableCache(path: string, payload: unknown) {
  const database = await openOfflineReadableCache()
  if (!database || payload === null || payload === undefined) return
  await new Promise<void>((resolve) => {
    try {
      const tx = database.transaction(offlineReadableCacheStore, 'readwrite')
      tx.objectStore(offlineReadableCacheStore).put({
        key: normalizeReadableCacheKey(path),
        payload,
        savedAt: new Date().toISOString(),
        source: 'sql-api',
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function loadOfflineReadableCache<T>(path: string): Promise<T | null> {
  const database = await openOfflineReadableCache()
  if (!database) return null
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(offlineReadableCacheStore, 'readonly')
      const request = tx.objectStore(offlineReadableCacheStore).get(normalizeReadableCacheKey(path))
      request.onsuccess = () => resolve((request.result?.payload ?? null) as T | null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function loadStaticSnapshot<T>(fileName: string): Promise<T | null> {
  try {
    const origin = typeof window === 'undefined'
      ? 'http://127.0.0.1:5174'
      : window.location.origin
    const response = await fetchWithTimeout(
      `${origin}/data/${encodeURIComponent(fileName)}?ts=${Date.now()}`,
      {
        cache: 'no-store',
      },
    )
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  // 修复：本地 API 3ms 响应，不需要 timeout。
  // 之前 AbortController 在 race condition 下被外部 lifecycle 触发 abort，污染 React state。
  // 透传外部 signal 让调用方主动取消，但不在内部加 timeout。
  return fetch(input, init)
}



function getApiMemoryCacheTtlMs(path: string): number {
  if (/^\/api\/retail-core\/status(?:\?|$)/.test(path)) return 5000
  if (/^\/api\/inventory-quote\/published-product-projection(?:\?|$)/.test(path)) return 5000
  if (/^\/api\/inventory-quote\/retail-zone(?:\?|$)/.test(path)) return 5000
  if (/^\/api\/inventory-quote\/inventory\?compact=1(?:&|$)/.test(path)) return 5000
  return 0
}

async function getMemoryCachedApiPayload<T>(path: string, loader: () => Promise<T | null>): Promise<T | null> {
  const ttlMs = getApiMemoryCacheTtlMs(path)
  if (ttlMs <= 0) return loader()
  const now = Date.now()
  const cached = apiResponseMemoryCache.get(path)
  if (cached?.payload !== undefined && cached.expiresAt > now) {
    return cached.payload as T | null
  }
  if (cached?.promise) {
    return cached.promise as Promise<T | null>
  }
  const promise = loader()
    .then((payload) => {
      apiResponseMemoryCache.set(path, {
        expiresAt: Date.now() + ttlMs,
        payload,
      })
      return payload
    })
    .catch((error) => {
      apiResponseMemoryCache.delete(path)
      throw error
    })
  apiResponseMemoryCache.set(path, {
    expiresAt: now + ttlMs,
    promise,
  })
  return promise
}

function buildEmptyProductLibraryRule(): ProductLibraryBusinessRule {
  return {
    product_id: '',
    store_price_rule_text: '',
    subsidy_rule_text: '',
    collection_rule_text: '',
    inbound_rule_text: '',
    outbound_rule_text: '',
    protection_rule_text: '',
    notes: '',
    updated_by: 'static-fallback',
    updated_at: '',
  }
}

function buildStaticProductLibraryDetail(item: ProductLibraryProductListItem): ProductLibraryDetail {
  return {
    id: item.id,
    product_id: item.id,
    canonical_name: item.canonical_name,
    default_category: item.default_category,
    primary_sku_key: item.primary_sku_key,
    configuration_summary: item.configuration_summary,
    review_status: item.review_status,
    source_confidence: item.source_confidence,
    notes: '当前为远程静态快照视图，详情证据与规则编辑需回到本机 API 模式。',
    updated_at: item.updated_at,
    skus: [],
    serials: [],
    sourceLinks: [],
    evidence: [],
    priceAdjustments: [],
    businessRule: {
      ...buildEmptyProductLibraryRule(),
      product_id: item.id,
      updated_at: item.updated_at,
    },
    collectionOverrides: [{
      sku_key: item.primary_sku_key,
      jd_url: '',
      lenovo_url: '',
      tmall_url: '',
      distributor_quote_note: '',
      gray_quote_note: '',
      capture_note: '当前为远程静态快照视图，采集信息编辑需本机 API。',
      updated_by: 'static-fallback',
      updated_at: item.updated_at,
    }],
    recentMovements: [],
    priceProtectionHistory: [],
    movementSummary: {
      inboundUnits: 0,
      outboundUnits: 0,
      movementCount: 0,
    },
    protectionSummary: {
      historyCount: item.pending_protection_count ?? 0,
      pendingCount: item.pending_protection_count ?? 0,
      pendingAmount: item.pending_protection_amount ?? 0,
    },
  }
}

async function loadStaticProductLibraryDetail(productId: string): Promise<ProductLibraryDetail | null> {
  const details = await loadStaticSnapshot<ProductLibraryDetailSnapshot>('latest-product-library-details.json')
  const detail = details?.items?.find((entry) => entry.id === productId)
  if (detail) return detail
  const snapshot = await loadStaticSnapshot<ProductLibraryProductsSnapshot>('latest-product-library-products.json')
  const item = snapshot?.items.find((entry) => entry.id === productId)
  return item ? buildStaticProductLibraryDetail(item) : null
}

function filterStaticProductLibraryProducts(
  snapshot: ProductLibraryProductsSnapshot,
  limit = 20,
  search = '',
  category = '',
): ProductLibraryProductsSnapshot {
  const normalizedCategory = category === '全部' ? '' : category.trim()
  const keyword = search.trim().toLowerCase()
  const items = snapshot.items
    .filter((item) => !normalizedCategory || item.default_category === normalizedCategory)
    .filter((item) => {
      if (!keyword) return true
      return [
        item.canonical_name,
        item.pn_mtm,
        item.primary_sku_key,
        item.configuration_summary,
        item.default_category,
        item.source_category,
        item.jd_subcategory,
        item.catalog_source,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  return {
    items: items.slice(0, limit),
    count: items.length,
  }
}

function formatCurrency(value?: number) {
  if (!value) return '-'
  return `¥${value.toLocaleString()}`
}

function getLatestSource(source: PriceSourceItem['source']) {
  return priceSources.find((item) => item.source === source)
}

function getAverageStockAge() {
  if (serialInventory.length === 0) return 0
  return Math.round(serialInventory.reduce((total, item) => total + item.stockAgeDays, 0) / serialInventory.length)
}

function getWarrantyRiskCount() {
  return serialInventory.filter((item) => item.warrantyCheck === '异常').length
}

function getCheckedWarrantyCount() {
  return serialInventory.filter((item) => item.warrantyCheck === '已校验').length
}

function getApprovalRiskCount() {
  return quoteDecisions.filter((item) => item.approval !== '销售可用').length
}

function buildMetrics(): InventoryQuoteMetric[] {
  const latestDealerPrice = getLatestSource('分销商日报价')
  const latestGrayPrice = getLatestSource('灰渠公众号')

  return [
    {
      label: 'SN库存样本',
      value: String(serialInventory.length),
      note: `平均周转 ${getAverageStockAge()} 天`,
      tone: 'info',
    },
    {
      label: '保修已校验',
      value: String(getCheckedWarrantyCount()),
      note: `异常 ${getWarrantyRiskCount()} 台`,
      tone: getWarrantyRiskCount() > 0 ? 'warn' : 'good',
    },
    {
      label: '分销商报价',
      value: formatCurrency(latestDealerPrice?.price),
      note: latestDealerPrice?.publishedAt ?? '等待样例',
      tone: 'warn',
    },
    {
      label: '灰渠参考价',
      value: formatCurrency(latestGrayPrice?.price),
      note: latestGrayPrice?.taxIncluded ? '含税' : '不含税 / 需风控',
      tone: 'danger',
    },
  ]
}

function buildRisks(): RiskItem[] {
  const warrantyRisks = getWarrantyRiskCount()
  const approvalRisks = getApprovalRiskCount()
  const disabledGrayProducts = quoteDecisions.filter((item) => item.defensiveSubsidyPrice === 0)

  return [
    {
      title: '保修异常',
      body: `${warrantyRisks} 台 SN 需复核，灰渠货成交前必须确认。`,
    },
    {
      title: '审批价格',
      body: `${approvalRisks} 个报价策略需要店长或老板审批，销售不可直接使用。`,
    },
    {
      title: '灰渠限制',
      body: disabledGrayProducts.length
        ? `${disabledGrayProducts.map((item) => item.productName).join('、')} 禁止灰渠覆盖。`
        : '当前主推 SKU 均允许防流失策略。',
    },
    {
      title: '报价证据',
      body: '外部平台价格需保留截图或链接，避免口径不一致。',
    },
  ]
}

export function calculateSubsidyAmount(price: number) {
  return Math.min(Math.round(price * subsidyRule.ratio), subsidyRule.cap)
}

export function calculateRegularSubsidyPrice(price: number) {
  return Math.max(price - calculateSubsidyAmount(price), 0)
}

export function getInventoryQuoteSnapshot(): InventoryQuoteSnapshot {
  return {
    metrics: buildMetrics(),
    serialInventory,
    quoteDecisions,
    priceSources,
    competitorRankItems,
    sourceSyncStatus,
    subsidyRule,
    risks: buildRisks(),
  }
}

function isMissingSerialPlaceholder(serialNumber?: string) {
  if (!serialNumber) return false
  return /^\[缺SN x\d+\]/.test(serialNumber.trim())
}

function uniqWarnings(values: Array<string | undefined>) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => value.trim()),
    ),
  )
}

function deriveStockAgeDays(inboundDate?: string) {
  if (!inboundDate) return undefined
  const parsed = new Date(inboundDate)
  if (Number.isNaN(parsed.getTime())) return undefined
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000))
}

function mergeInventorySnapshots(
  baseSnapshot: StandardInventorySnapshot,
  masterSnapshot?: InventoryMasterSnapshot | null,
): StandardInventorySnapshot {
  if (!masterSnapshot?.rows?.length) return baseSnapshot

  const skuRowMap = new Map<string, InventoryMasterRow[]>()
  for (const row of masterSnapshot.rows) {
    if (!row?.skuKey) continue
    const current = skuRowMap.get(row.skuKey) ?? []
    current.push(row)
    skuRowMap.set(row.skuKey, current)
  }

  const baseSkuMap = new Map(baseSnapshot.skus.map((sku) => [sku.skuKey, sku]))
  const mergedSkus = Array.from(new Set([...baseSkuMap.keys(), ...skuRowMap.keys()]))
    .map((skuKey) => {
      const baseSku = baseSkuMap.get(skuKey)
      const masterRows = skuRowMap.get(skuKey) ?? []
      if (!masterRows.length) return baseSku

      const referenceRow = masterRows.find((row) => row.inStock) ?? masterRows[0]
      const realSerialRows = masterRows.filter((row) => row.inStock && !isMissingSerialPlaceholder(row.serialNumber))
      const serials = realSerialRows.map((row) => ({
        serialNumber: row.serialNumber,
        productName: row.productName || baseSku?.productName || referenceRow.productName,
        pnMtm: row.pnMtm || baseSku?.pnMtm || referenceRow.pnMtm,
        spec: row.spec || baseSku?.spec || referenceRow.spec,
        organizationName: row.organizationName || baseSku?.organizationName || referenceRow.organizationName,
        warehouseCode: (row as Record<string, unknown>).warehouseCode as string | undefined,
        inboundDate: row.inboundDate,
        purchaseCost: row.purchaseCost,
        inboundDocumentNumber: row.inboundDocumentNumber,
        inboundOperatorName: row.inboundOperatorName,
        supplierName: row.supplierName,
        locationName: row.locationName,
        stockAgeDays: row.stockAgeDays ?? deriveStockAgeDays(row.inboundDate),
        warrantyStart: row.warrantyStart,
        warrantyEnd: row.warrantyEnd,
        isPhysicalHold: Boolean((row as Record<string, unknown>).physicalHold),
      }))
      const maxMasterCurrentStock = masterRows.reduce((max, row) => Math.max(max, row.currentStock ?? 0), 0)
      const maxMasterSellableStock = masterRows.reduce((max, row) => Math.max(max, row.sellableStock ?? 0), 0)
      const maxMasterOccupiedStock = masterRows.reduce((max, row) => Math.max(max, row.occupiedStock ?? 0), 0)
      const maxMasterUnsellableStock = masterRows.reduce((max, row) => Math.max(max, row.unsellableStock ?? 0), 0)
      const maxMasterPendingInboundStock = masterRows.reduce((max, row) => Math.max(max, row.pendingInboundStock ?? 0), 0)
      const inferredCurrentStock = maxMasterCurrentStock || realSerialRows.length || masterRows.length
      const currentStock = baseSku?.currentStock ?? inferredCurrentStock
      const sellableStock = baseSku?.sellableStock ?? (maxMasterSellableStock || currentStock)
      const occupiedStock = baseSku?.occupiedStock ?? maxMasterOccupiedStock ?? 0
      const unsellableStock = baseSku?.unsellableStock ?? maxMasterUnsellableStock ?? 0
      const pendingInboundStock = baseSku?.pendingInboundStock ?? maxMasterPendingInboundStock ?? 0
      const warnings = uniqWarnings([
        ...(baseSku?.dataQuality.warnings ?? []),
        ...masterRows.flatMap((row) => row.dataQuality?.warnings ?? []),
      ])

      return {
        ...(baseSku ?? {
          skuKey,
          productName: referenceRow.productName,
          currentStock: 0,
          sellableStock: 0,
          occupiedStock: 0,
          unsellableStock: 0,
          pendingInboundStock: 0,
          serialCount: 0,
          serials: [],
          dataQuality: {
            stockAndSerialMatched: false,
            stockQuantityDiff: 0,
            warnings: [],
          },
        }),
        productName: baseSku?.productName || referenceRow.productName,
        pnMtm: baseSku?.pnMtm || referenceRow.pnMtm,
        spec: baseSku?.spec || referenceRow.spec,
        category: baseSku?.category || referenceRow.category,
        productCode: baseSku?.productCode || referenceRow.productCode,
        skuCode: baseSku?.skuCode || referenceRow.skuCode,
        organizationName: baseSku?.organizationName || referenceRow.organizationName,
        organizationCode: baseSku?.organizationCode || referenceRow.organizationCode,
        stockType: baseSku?.stockType || referenceRow.stockType,
        currentStock,
        sellableStock,
        occupiedStock,
        unsellableStock,
        pendingInboundStock,
        physicalHoldStock: Number((baseSku as Record<string, unknown> | undefined)?.physicalHoldStock ?? 0),
        physicalHoldSerialCount: Number((baseSku as Record<string, unknown> | undefined)?.physicalHoldSerialCount ?? 0),
        serialCount: serials.length,
        serials,
        dataQuality: {
          stockAndSerialMatched: currentStock === serials.length,
          stockQuantityDiff: currentStock - serials.length,
          warnings,
        },
      }
    })
    .filter((sku): sku is StandardInventorySku => Boolean(sku))

  const categories = Array.from(
    mergedSkus.reduce((map, sku) => {
      const category = sku.category || '未分类'
      const current = map.get(category) ?? {
        category,
        skuCount: 0,
        currentStock: 0,
        sellableStock: 0,
        unsellableStock: 0,
        pendingInboundStock: 0,
        serialCount: 0,
        topSkus: [] as StandardInventoryCategory['topSkus'],
      }
      current.skuCount += 1
      current.currentStock += sku.currentStock
      current.sellableStock += sku.sellableStock
      current.unsellableStock += sku.unsellableStock
      current.pendingInboundStock += sku.pendingInboundStock
      current.serialCount += sku.serialCount
      current.topSkus.push({
        skuKey: sku.skuKey,
        productName: sku.productName,
        pnMtm: sku.pnMtm,
        currentStock: sku.currentStock,
        sellableStock: sku.sellableStock,
        unsellableStock: sku.unsellableStock,
      })
      map.set(category, current)
      return map
    }, new Map<string, StandardInventoryCategory>()).values(),
  ).map((category) => ({
    ...category,
    topSkus: [...category.topSkus]
      .sort((left, right) => right.currentStock - left.currentStock || right.sellableStock - left.sellableStock)
      .slice(0, 5),
  }))

  const totals = mergedSkus.reduce((acc, sku) => {
    acc.skuCount += 1
    acc.currentStock += sku.currentStock
    acc.sellableStock += sku.sellableStock
    acc.occupiedStock += sku.occupiedStock
    acc.unsellableStock += sku.unsellableStock
    acc.pendingInboundStock += sku.pendingInboundStock
    acc.serialCount += sku.serialCount
    acc.unmatchedSerialCount += Math.max(sku.currentStock - sku.serialCount, 0)
    return acc
  }, {
    skuCount: 0,
    currentStock: 0,
    sellableStock: 0,
    occupiedStock: 0,
    unsellableStock: 0,
    pendingInboundStock: 0,
    serialCount: 0,
    unmatchedSerialCount: 0,
  })

  return {
    ...baseSnapshot,
    generatedAt: masterSnapshot.generatedAt || baseSnapshot.generatedAt,
    totals,
    categories,
    skus: mergedSkus,
    dataQuality: {
      stockAndSerialScopeLikelyMatched: totals.serialCount === 0 || totals.serialCount <= totals.currentStock,
      warnings: uniqWarnings([
        ...(baseSnapshot.dataQuality.warnings ?? []),
        ...(masterSnapshot.warnings ?? []),
      ]),
    },
    files: {
      ...baseSnapshot.files,
      stockQuantityFile: masterSnapshot.files?.stockQuantityFile || baseSnapshot.files.stockQuantityFile,
      stockSnFile: masterSnapshot.files?.stockSnFile || baseSnapshot.files.stockSnFile,
    },
  }
}

function mergeWarrantySnapshotIntoInventory(
  inventorySnapshot: StandardInventorySnapshot,
  warrantySnapshot?: LenovoWarrantySnapshot | null,
): StandardInventorySnapshot {
  if (!warrantySnapshot?.records?.length) return inventorySnapshot

  const warrantyBySerial = new Map(
    warrantySnapshot.records
      .filter((record) => record.status === 'success' && (record.officialWarrantyStart || record.officialWarrantyEnd))
      .map((record) => [record.serialNumber, record] as const),
  )

  if (!warrantyBySerial.size) return inventorySnapshot

  const skus = inventorySnapshot.skus.map((sku) => ({
    ...sku,
    serials: sku.serials.map((serial) => {
      const warrantyRecord = warrantyBySerial.get(serial.serialNumber)
      if (!warrantyRecord) return serial
      return {
        ...serial,
        warrantyStart: serial.warrantyStart ?? warrantyRecord.officialWarrantyStart,
        warrantyEnd: serial.warrantyEnd ?? warrantyRecord.officialWarrantyEnd,
      }
    }),
  }))

  return {
    ...inventorySnapshot,
    skus,
  }
}

export async function getLiveInventorySnapshot(options?: { compact?: boolean }): Promise<StandardInventorySnapshot | null> {
  const compact = options?.compact === true
  if (inventoryQuoteDataMode === 'static') {
    const [adjustedSnapshot, standardSnapshot, masterSnapshot, warrantySnapshot] = await Promise.all([
      loadStaticSnapshot<StandardInventorySnapshot>('latest-adjusted-inventory-snapshot.json'),
      loadStaticSnapshot<StandardInventorySnapshot>('latest-standard-inventory-snapshot.json'),
      loadStaticSnapshot<InventoryMasterSnapshot>('latest-inventory-master-snapshot.json'),
      loadStaticSnapshot<LenovoWarrantySnapshot>('latest-lenovo-warranty-snapshot.json'),
    ])
    const baseSnapshot = adjustedSnapshot ?? standardSnapshot
    if (!baseSnapshot) return null
    const mergedInventory = masterSnapshot ? mergeInventorySnapshots(baseSnapshot, masterSnapshot) : baseSnapshot
    return mergeWarrantySnapshotIntoInventory(mergedInventory, warrantySnapshot)
  }
  try {
    const ts = Date.now()
    const inventoryResponse = await fetch(
      inventoryQuoteApiUrl(`/api/inventory-quote/inventory?compact=${compact ? '1' : '0'}&ts=${ts}`),
      {
        cache: 'no-store',
      },
    )
    if (!inventoryResponse.ok) throw new Error(`inventory api ${inventoryResponse.status}`)
    const apiSnapshot = await inventoryResponse.json() as StandardInventorySnapshot
    return apiSnapshot
  } catch {
    return null
  }
}

export async function getInventoryMasterSnapshot(): Promise<InventoryMasterSnapshot | null> {
  return getApiFirstSnapshot<InventoryMasterSnapshot>(
    '/api/inventory-quote/inventory-master',
    'latest-inventory-master-snapshot.json',
    { disableStaticFallback: true },
  )
}

export async function getStaleInventoryReportSnapshot(): Promise<StaleInventoryReportSnapshot | null> {
  return loadStaticSnapshot<StaleInventoryReportSnapshot>('latest-stale-inventory-report.json')
}

async function getRetailCoreApi<T>(path: string, externalSignal?: AbortSignal): Promise<T | null> {
  const disableOfflineReadableCache = /\/api\/retail-core\/(inventory-movements|sales-orders|serial-items|sync-gap-queue)|\/api\/inventory-quote\/inventory-movements/.test(path)
  // timeout 已禁用：本地 API 不需要，本地 3ms 响应远低于任意合理阈值。
  // 保留 getApiRequestTimeoutMs 函数避免破坏外部调用，调试时还能调。
  return getMemoryCachedApiPayload(path, async () => {
    try {
      const response = await fetchWithTimeout(inventoryQuoteApiUrl(`${path}${path.includes('?') ? '&' : '?'}ts=${Date.now()}`), {
        cache: 'no-store',
        ...(externalSignal ? { signal: externalSignal } : {}),
      })
      if (!response.ok) throw new Error(`${path} api ${response.status}`)
      const payload = await response.json() as T
      if (!disableOfflineReadableCache) {
        void saveOfflineReadableCache(path, payload)
      }
      return payload
    } catch (e) {
      // 修复：catch 块 throw 真实错误（带 path 信息）让调用方能看到具体原因，
      // 避免静默 return null 让前端 UI 长期卡在"加载中"或误报"接口空数据"。
      // 保留 offline cache 兜底，但只在非 abort 类错误时使用。
      const errorName = (e as { name?: string } | null)?.name || ''
      if (errorName === 'AbortError') {
        // 上层 useEffect cleanup 或切换路由触发的主动 abort，不算业务错误。
        // 不缓存 null，直接 re-throw 让 Promise.allSettled 走 rejected 路径，
        // 并在 UI 端根据 mounted 标志忽略。
        throw e
      }
      if (disableOfflineReadableCache || inventoryQuoteDataMode === 'api_strict') return null
      return loadOfflineReadableCache<T>(path)
    }
  })
}

async function getApiFirstSnapshot<T>(
  apiPath: string,
  fileName: string,
  options?: {
    disableStaticFallback?: boolean
  },
): Promise<T | null> {
  return getRetailCoreApi<T>(apiPath).then((data) => {
    if (data) return data
    if (options?.disableStaticFallback) return null
    if (!allowStaticFallback()) return null
    return loadStaticSnapshot<T>(fileName)
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asStockSignals(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, item]) => [key, typeof item === 'string' ? item : String(item ?? '')])
      .filter(([, item]) => item.trim()),
  )
}

function normalizeDistributorQuoteMatch(value: unknown): DistributorQuoteLibraryMatch | undefined {
  const record = asRecord(value)
  if (record) {
    return {
      status: (asString(record.status) as DistributorQuoteLibraryMatch['status'] | undefined) ?? 'unmatched',
      confidence: asNumber(record.confidence) ?? 0,
      primarySkuKey: asString(record.primarySkuKey),
      productId: asString(record.productId),
      canonicalName: asString(record.canonicalName),
      defaultCategory: asString(record.defaultCategory),
      sourceCategory: asString(record.sourceCategory),
      jdSubcategory: asString(record.jdSubcategory),
      currentStock: asNumber(record.currentStock),
      sellableStock: asNumber(record.sellableStock),
      evidence: asString(record.evidence) ?? '',
    }
  }
  return undefined
}

function normalizeDistributorQuote(value: unknown): DistributorQuote | null {
  const record = asRecord(value)
  if (!record) return null

  const source = (asString(record.source) ?? 'wechat-distributor-group') as DistributorQuote['source']
  const groupName = asString(record.groupName) ?? asString(record.group_name) ?? '分销群报价'
  const sourceFile = asString(record.sourceFile) ?? asString(record.source_file) ?? asString(record.quoteFile) ?? asString(record.quote_file) ?? ''
  const quoteDate = asString(record.quoteDate) ?? asString(record.quote_date) ?? ''
  const pnMtm = asString(record.pnMtm) ?? asString(record.pn_mtm) ?? ''
  const productName = asString(record.productName) ?? asString(record.product_name) ?? ''
  const pickupPrice = asNumber(record.pickupPrice ?? record.pickup_price)

  if (!pnMtm || !productName || pickupPrice === undefined) return null

  const subsidyPrice = asNumber(record.subsidyPrice ?? record.subsidy_price)
  const educationSubsidy = asNumber(record.educationSubsidy ?? record.education_subsidy)
  const stockSignals = asStockSignals(record.stockSignals ?? record.stock_signals)
  const remark = asString(record.remark)
  const existingMatch = normalizeDistributorQuoteMatch(record.libraryMatch)
  const fallbackMatchStatus = asString(record.matchMethod) ?? asString(record.match_method)
  const fallbackMatchConfidence = asNumber(record.matchConfidence ?? record.match_confidence)
  const fallbackEvidence = asString(record.matchEvidence) ?? asString(record.match_evidence)
  const libraryMatch = existingMatch ?? (
    fallbackMatchStatus || fallbackEvidence || fallbackMatchConfidence !== undefined
      ? {
          status: (fallbackMatchStatus as DistributorQuoteLibraryMatch['status'] | undefined) ?? 'unmatched',
          confidence: fallbackMatchConfidence ?? 0,
          primarySkuKey: asString(record.skuKey) ?? asString(record.sku_key),
          evidence: fallbackEvidence ?? '',
        }
      : undefined
  )

  return {
    source,
    groupName,
    sourceFile,
    quoteDate,
    pnMtm,
    productName,
    pickupPrice,
    subsidyPrice,
    educationSubsidy,
    stockSignals,
    remark,
    libraryMatch,
  }
}

function normalizeDistributorQuoteSnapshot(payload: unknown): DistributorQuoteSnapshot | null {
  const record = asRecord(payload)
  if (!record) return null

  const rawQuotes = Array.isArray(record.quotes) ? record.quotes : []
  const quotes = rawQuotes
    .map((item) => normalizeDistributorQuote(item))
    .filter((item): item is DistributorQuote => Boolean(item))

  const rawSummary = asRecord(record.summary)
  return {
    generatedAt: asString(record.generatedAt) ?? asString(record.generated_at) ?? new Date().toISOString(),
    quoteDate: asString(record.quoteDate) ?? asString(record.quote_date),
    quoteFile: asString(record.quoteFile) ?? asString(record.quote_file),
    quoteCount: asNumber(record.quoteCount ?? record.quote_count) ?? quotes.length,
    summary: rawSummary
      ? {
          inventoryMatchedCount: asNumber(rawSummary.inventoryMatchedCount ?? rawSummary.inventory_matched_count) ?? 0,
          productLibraryMatchedCount: asNumber(rawSummary.productLibraryMatchedCount ?? rawSummary.product_library_matched_count) ?? 0,
          unmatchedCount: asNumber(rawSummary.unmatchedCount ?? rawSummary.unmatched_count) ?? 0,
        }
      : undefined,
    quotes,
  }
}

export function getRetailCoreStatus(): Promise<RetailCoreStatus | null> {
  return getRetailCoreApi<RetailCoreStatus>('/api/retail-core/status')
    .then((data) => {
      if (data) return data
      if (!allowOperationalStaticFallback()) return null
      return loadStaticSnapshot<RetailCoreStatus>('latest-retail-core-status.json')
    })
}

export function getRetailCoreCategoryTree(): Promise<RetailCoreCategoryTree | null> {
  return getRetailCoreApi<RetailCoreCategoryTree>('/api/retail-core/category-tree')
    .then((data) => {
      if (data) return data
      if (!allowStaticFallback()) return null
      return loadStaticSnapshot<RetailCoreCategoryTree>('latest-retail-core-category-tree.json')
    })
}

export function getRetailCoreSerialItems(limit = 5000): Promise<RetailCoreSerialItems | null> {
  return getRetailCoreApi<RetailCoreSerialItems>(`/api/retail-core/serial-items?limit=${limit}`)
}

export function getRetailCorePhysicalStockHolds(limit = 5000, status = '', signal?: AbortSignal): Promise<PhysicalStockHoldSnapshot | null> {
  const query = new URLSearchParams()
  query.set('limit', String(limit))
  if (status) query.set('status', status)
  return getRetailCoreApi<PhysicalStockHoldSnapshot>(`/api/retail-core/physical-stock-holds?${query.toString()}`, signal)
}

export function getRetailCorePhysicalHoldSalesOrderCandidates(
  limit = 120,
  keyword = '',
  transferStatus = '',
  signal?: AbortSignal,
): Promise<PhysicalHoldSalesOrderCandidateSnapshot | null> {
  const query = new URLSearchParams()
  query.set('limit', String(limit))
  if (keyword) query.set('keyword', keyword)
  if (transferStatus) query.set('transfer_status', transferStatus)
  return getRetailCoreApi<PhysicalHoldSalesOrderCandidateSnapshot>(`/api/retail-core/physical-stock-holds/sales-order-candidates?${query.toString()}`, signal)
}

export function getRetailCoreMovements(limit = 120): Promise<RetailCoreMovements | null> {
  return getRetailCoreApi<RetailCoreMovements>(`/api/retail-core/inventory-movements?limit=${limit}`)
}

export async function transferRetailCorePhysicalStockHold(payload: {
  orderNumber: string
  serialNumbers?: string[]
  holdReason?: string
  note?: string
  operatorName?: string
}): Promise<Record<string, unknown> | null> {
  const response = await fetch(inventoryQuoteApiUrl('/api/retail-core/physical-stock-holds/transfer-from-sales-order'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`physical hold transfer api ${response.status}`)
  return response.json()
}

export async function finalizeRetailCorePhysicalStockHold(payload: {
  serviceOrderNo?: string
  serialNumbers?: string[]
  note?: string
  operatorName?: string
}): Promise<Record<string, unknown> | null> {
  const response = await fetch(inventoryQuoteApiUrl('/api/retail-core/physical-stock-holds/finalize-service-outbound'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`physical hold finalize api ${response.status}`)
  return response.json()
}

export async function releaseRetailCorePhysicalStockHold(payload: {
  serialNumbers: string[]
  note?: string
  operatorName?: string
}): Promise<Record<string, unknown> | null> {
  const response = await fetch(inventoryQuoteApiUrl('/api/retail-core/physical-stock-holds/release-to-store'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`physical hold release api ${response.status}`)
  return response.json()
}

export async function revokeRetailCorePhysicalStockHold(payload: {
  serialNumbers: string[]
  note?: string
  operatorName?: string
}): Promise<Record<string, unknown> | null> {
  const response = await fetch(inventoryQuoteApiUrl('/api/retail-core/physical-stock-holds/revoke-transfer'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`physical hold revoke api ${response.status}`)
  return response.json()
}

export async function reopenRetailCorePhysicalStockHold(payload: {
  serialNumbers: string[]
  note?: string
  operatorName?: string
}): Promise<Record<string, unknown> | null> {
  const response = await fetch(inventoryQuoteApiUrl('/api/retail-core/physical-stock-holds/reopen-consumed'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`physical hold reopen api ${response.status}`)
  return response.json()
}

export async function rebindRetailCorePhysicalStockHold(payload: {
  serviceOrderNo: string
  serialNumbers: string[]
  note?: string
  operatorName?: string
}): Promise<Record<string, unknown> | null> {
  const response = await fetch(inventoryQuoteApiUrl('/api/retail-core/physical-stock-holds/rebind-service-outbound'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`physical hold rebind api ${response.status}`)
  return response.json()
}

export function getRetailCoreSalesOrders(limit = 80): Promise<RetailCoreSalesOrders | null> {
  return getRetailCoreApi<RetailCoreSalesOrders>(`/api/retail-core/sales-orders?limit=${limit}`)
}

export function getRetailCoreSyncGapQueue(limit = 120): Promise<RetailCoreSyncGapQueue | null> {
  return getRetailCoreApi<RetailCoreSyncGapQueue>(`/api/retail-core/sync-gap-queue?limit=${limit}`)
}

export function getRetailCoreCustomers(limit = 500): Promise<RetailCoreCustomers | null> {
  return getRetailCoreApi<RetailCoreCustomers>(`/api/retail-core/customers?limit=${limit}`)
}

export function getEducationAgentScanSyncGapSnapshot(): Promise<EducationAgentScanSyncGapSnapshot | null> {
  return getApiFirstSnapshot<EducationAgentScanSyncGapSnapshot>(
    '/api/inventory-quote/education-agent-scan-sync-gap',
    'latest-education-agent-scan-sync-gap.json',
    { disableStaticFallback: true },
  )
}

export function getRetailCoreSalesPriceProtectionHistory(limit = 120): Promise<RetailCoreSalesPriceProtectionHistory | null> {
  return getRetailCoreApi<RetailCoreSalesPriceProtectionHistory>(`/api/retail-core/sales-price-protection-history?limit=${limit}`)
    .then((data) => {
      if (data) return data
      if (!allowStaticFallback()) return null
      return loadStaticSnapshot<RetailCoreSalesPriceProtectionHistory>('latest-retail-core-sales-price-protection-history.json')
    })
}

export function getSnSalesComplianceSnapshot(limit = 2000): Promise<SnSalesComplianceSnapshot | null> {
  return getRetailCoreApi<SnSalesComplianceSnapshot>(`/api/retail-core/sn-sales-compliance?limit=${limit}`)
    .then((data) => {
      if (data) return data
      if (!allowStaticFallback()) return null
      return loadStaticSnapshot<SnSalesComplianceSnapshot>('latest-sn-sales-compliance-snapshot.json')
    })
}

export function getRetailCoreSyncTasks(): Promise<RetailCoreSyncTasks | null> {
  return getRetailCoreApi<RetailCoreSyncTasks>('/api/sync/tasks')
    .then((data) => {
      if (data) return data
      if (!allowOperationalStaticFallback()) return null
      return loadStaticSnapshot<RetailCoreSyncTasks>('latest-retail-core-sync-tasks.json')
    })
}

async function postRetailCoreApi<T>(path: string, payload?: unknown): Promise<T | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      throw new Error(JSON.stringify(errorPayload))
    }
    return await response.json() as T
  } catch (error) {
    console.warn('retail core post failed', path, error)
    return null
  }
}

export function createRetailSalesOrder(payload: RetailSalesOrderCreatePayload): Promise<{ ok: boolean; orderId: string; pendingSyncTaskId: string } | null> {
  return postRetailCoreApi('/api/sales/orders', payload)
}

export async function deleteRetailSalesOrder(orderId: string): Promise<
  | { ok: true; orderId: string; revertedSerialCount: number; revertedSerials: string[] }
  | { ok: false; error: string; orderId: string }
> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/sales/orders/${encodeURIComponent(orderId)}`), {
      method: 'DELETE',
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = payload && typeof payload === 'object' ? (payload.detail ?? payload.error ?? payload) : payload
      return {
        ok: false,
        error: typeof detail === 'string' ? detail : JSON.stringify(detail),
        orderId,
      }
    }
    return {
      ok: true,
      orderId: String(payload.orderId ?? orderId),
      revertedSerialCount: Number(payload.revertedSerialCount ?? 0),
      revertedSerials: Array.isArray(payload.revertedSerials) ? payload.revertedSerials.map((item: unknown) => String(item)) : [],
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'delete_failed',
      orderId,
    }
  }
}

export function createRetailPurchaseOrder(payload: RetailPurchaseOrderCreatePayload): Promise<{ ok: boolean; orderId: string; pendingSyncTaskId: string; serialCount: number } | null> {
  return postRetailCoreApi('/api/purchases/orders', payload)
}

export function createRetailPriceTagUpdate(payload: RetailPriceTagUpdatePayload): Promise<{ ok: boolean; taskId: string; status: string } | null> {
  return postRetailCoreApi('/api/price-tags/update-tasks', payload)
}

export async function getPriceTagStatus(storeCode = 'LENOVO-SR-001'): Promise<PriceTagConsoleStatus | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/price-tags/status?storeCode=${encodeURIComponent(storeCode)}&ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as PriceTagConsoleStatus
  } catch {
    return null
  }
}

export function retryRetailSyncTask(taskId: string): Promise<{ ok: boolean; taskId: string; status: string } | null> {
  return postRetailCoreApi(`/api/sync/tasks/${encodeURIComponent(taskId)}/retry`)
}

export async function getAdminUsers(): Promise<AdminUserSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/admin/users?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as AdminUserSnapshot
  } catch {
    return null
  }
}

export async function loginAdminUser(payload: { username: string; password: string }): Promise<{ ok: true; username: string; displayName: string } | { ok: false; message: string }> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/admin/login'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      return { ok: false, message: String((errorPayload as { detail?: string }).detail || '管理员登录失败。') }
    }
    return await response.json() as { ok: true; username: string; displayName: string }
  } catch {
    return { ok: false, message: '管理员登录失败。' }
  }
}

export async function changeAdminPassword(payload: { username: string; currentPassword: string; newPassword: string }): Promise<{ ok: true; username: string } | { ok: false; message: string }> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/admin/change-password'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      return { ok: false, message: String((errorPayload as { detail?: string }).detail || '管理员密码修改失败。') }
    }
    return await response.json() as { ok: true; username: string }
  } catch {
    return { ok: false, message: '管理员密码修改失败。' }
  }
}

export async function createAdminUser(payload: { username: string; password: string; displayName: string }): Promise<{ ok: true; username: string } | { ok: false; message: string }> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/admin/users'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      return { ok: false, message: String((errorPayload as { detail?: string }).detail || '管理员创建失败。') }
    }
    return await response.json() as { ok: true; username: string }
  } catch {
    return { ok: false, message: '管理员创建失败。' }
  }
}

export async function setAdminUserStatus(payload: { username: string; active: boolean }): Promise<{ ok: true; username: string; active: boolean } | { ok: false; message: string }> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/admin/users/status'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      return { ok: false, message: String((errorPayload as { detail?: string }).detail || '管理员状态更新失败。') }
    }
    return await response.json() as { ok: true; username: string; active: boolean }
  } catch {
    return { ok: false, message: '管理员状态更新失败。' }
  }
}

export async function getPriceProtectionSnapshot(): Promise<PriceProtectionSnapshot | null> {
  return getApiFirstSnapshot<PriceProtectionSnapshot>(
    '/api/inventory-quote/price-protection',
    'latest-price-protection-snapshot.json',
    { disableStaticFallback: true },
  )
}

export async function getMarketingBoostSnapshot(): Promise<MarketingBoostSnapshot | null> {
  return getApiFirstSnapshot<MarketingBoostSnapshot>(
    '/api/inventory-quote/marketing-boost',
    'latest-marketing-boost-snapshot.json',
    { disableStaticFallback: true },
  )
}

export async function getMarketingBoostHeroSnapshot(): Promise<MarketingBoostSnapshot | null> {
  return getRetailCoreApi<MarketingBoostSnapshot>('/api/inventory-quote/marketing-boost-hero')
    .then((data) => data ?? getMarketingBoostSnapshot())
}

export async function getEducationSubsidyAgentScanSnapshot(): Promise<EducationSubsidyAgentScanSnapshot | null> {
  return getApiFirstSnapshot<EducationSubsidyAgentScanSnapshot>(
    '/api/inventory-quote/education-agent-scan',
    'latest-education-subsidy-agent-scan-summary.json',
    { disableStaticFallback: true },
  )
}

export async function getDistributorQuoteSnapshot(): Promise<DistributorQuoteSnapshot | null> {
  const apiData = await getRetailCoreApi<unknown>('/api/inventory-quote/distributor-quotes')
  const normalizedApiData = normalizeDistributorQuoteSnapshot(apiData)
  if (normalizedApiData) return normalizedApiData
  if (!allowStaticFallback()) return null
  const staticData = await loadStaticSnapshot<unknown>('latest-distributor-quotes.json')
  return normalizeDistributorQuoteSnapshot(staticData)
}

export async function getInventoryPriceSignalSnapshot(): Promise<InventoryPriceSignalSnapshot | null> {
  return getApiFirstSnapshot<InventoryPriceSignalSnapshot>(
    '/api/inventory-quote/price-signals',
    'latest-retail-core-price-signals.json',
  )
}

export async function getGrayWholesaleSnapshot(): Promise<GrayWholesaleSnapshot | null> {
  return getApiFirstSnapshot<GrayWholesaleSnapshot>(
    '/api/inventory-quote/gray-wholesale',
    'latest-gray-wholesale-quotes.json',
  )
}

export type GrayChannelCapturePlan = {
  generatedAt: string
  triggerTaskName?: string
  accountName: string
  accountId: string
  entryPoint: string
  todayMenuButtonText: string
  todayDateString: string
  steps: string[]
  artifacts: {
    rawTextName: string
    screenshotName: string
    visibleArticleName: string
  }
  blockerIfMissing: {
    noVisitEvidence: string
    noRawText: string
    staleArticleDate: string
  }
}

export type GrayChannelVisitEvidence = {
  evidencePath: string
  webPath: string
  latestVisibleArticleDate: string
  capturedAt: string
}

export async function getGrayChannelCapturePlan(): Promise<GrayChannelCapturePlan | null> {
  return loadStaticSnapshot<GrayChannelCapturePlan>('latest-gray-channel-capture-plan.json')
}

export async function getGrayChannelVisitEvidence(): Promise<GrayChannelVisitEvidence | null> {
  return loadStaticSnapshot<GrayChannelVisitEvidence>('latest-gray-channel-visible-article.json')
}

export async function getCompetitorMonitorSnapshot(): Promise<CompetitorMonitorSnapshot | null> {
  return getApiFirstSnapshot<CompetitorMonitorSnapshot>(
    '/api/inventory-quote/competitor-monitor',
    'latest-competitor-monitor.json',
  )
}

export async function getRetailZoneSnapshot(options?: { compact?: boolean }): Promise<RetailZoneSnapshot | null> {
  const compact = options?.compact === true
  return getApiFirstSnapshot<RetailZoneSnapshot>(
    `/api/inventory-quote/retail-zone?limit=500${compact ? '&compact=1' : ''}`,
    'latest-retail-zone-snapshot.json',
    { disableStaticFallback: true },
  )
}

export async function getFrontendDisplayControls(): Promise<FrontendDisplayControlsSnapshot | null> {
  return getRetailCoreApi<FrontendDisplayControlsSnapshot>('/api/inventory-quote/frontend-display-controls')
}

export async function setFrontendDisplayControls(payload: { showMarketingPo: boolean; showEducationSubsidy: boolean }): Promise<FrontendDisplayControlsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/frontend-display-controls'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return await response.json() as FrontendDisplayControlsSnapshot
  } catch {
    return null
  }
}

export async function getFrontendActivityDisplayCatalog(): Promise<FrontendActivityDisplayCatalogSnapshot | null> {
  return getRetailCoreApi<FrontendActivityDisplayCatalogSnapshot>('/api/inventory-quote/frontend-activity-display-catalog')
}

export async function getFrontendActivityDisplayOverrides(): Promise<FrontendActivityDisplayOverridesSnapshot | null> {
  return getRetailCoreApi<FrontendActivityDisplayOverridesSnapshot>('/api/inventory-quote/frontend-activity-display-overrides')
}

export async function saveFrontendActivityDisplayOverride(payload: {
  activityId?: string
  skuKey: string
  marketingPoEnabled: boolean
  marketingPoAmount?: number | null
  educationSubsidyEnabled: boolean
  educationSubsidyAmount?: number | null
  note?: string
}): Promise<FrontendActivityDisplayOverridesSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/frontend-activity-display-overrides'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return await response.json() as FrontendActivityDisplayOverridesSnapshot
  } catch {
    return null
  }
}

export async function getPublishedProductProjectionSnapshot(): Promise<PublishedProductProjectionSnapshot | null> {
  const apiPath = '/api/inventory-quote/published-product-projection?scope=live'
  return getMemoryCachedApiPayload(apiPath, async () => {
    try {
      const response = await fetchWithTimeout(inventoryQuoteApiUrl(`${apiPath}&ts=${Date.now()}`), {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`published projection api ${response.status}`)
      const payload = await response.json() as PublishedProductProjectionSnapshot
      void saveOfflineReadableCache(apiPath, payload)
      return payload
    } catch {
      const cached = await loadOfflineReadableCache<PublishedProductProjectionSnapshot>(apiPath)
      if (cached) return cached
      return null
    }
  })
}

export async function getManualPriceOverridesSnapshot(): Promise<ManualPriceOverridesSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/manual-overrides?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`manual overrides api ${response.status}`)
    return await response.json() as ManualPriceOverridesSnapshot
  } catch {
    return null
  }
}

export async function saveManualPriceOverridesSnapshot(overrides: ManualPriceOverrides): Promise<ManualPriceOverridesSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/manual-overrides'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ overrides }),
    })
    if (!response.ok) return null
    return await response.json() as ManualPriceOverridesSnapshot
  } catch {
    return null
  }
}

export async function getStoreManualPromotionsSnapshot(): Promise<StoreManualPromotionsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/store-manual-promotions?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as StoreManualPromotionsSnapshot
  } catch {
    return null
  }
}

export async function saveStoreManualPromotionsSnapshot(items: StoreManualPromotion[]): Promise<StoreManualPromotionsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/store-manual-promotions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items }),
    })
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      const detail = String((errorPayload as { detail?: string }).detail || `store manual promotions api ${response.status}`)
      throw new Error(detail)
    }
    return await response.json() as StoreManualPromotionsSnapshot
  } catch (error) {
    console.warn('保存店面手动满减活动库到 SQL 失败', error)
    return null
  }
}

export async function getManufacturerManualPromotionsSnapshot(): Promise<ManufacturerManualPromotionsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/manufacturer-manual-promotions?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ManufacturerManualPromotionsSnapshot
  } catch {
    return null
  }
}

export async function getCrossOutboundCheckRulesSnapshot(): Promise<CrossOutboundCheckRulesSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/cross-outbound-check-rules?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as CrossOutboundCheckRulesSnapshot
  } catch {
    return null
  }
}

export async function saveCrossOutboundCheckRulesSnapshot(items: CrossOutboundCheckRule[]): Promise<CrossOutboundCheckRulesSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/cross-outbound-check-rules'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items }),
    })
    if (!response.ok) return null
    return await response.json() as CrossOutboundCheckRulesSnapshot
  } catch {
    return null
  }
}

export async function getCrossOutboundCheckHistorySnapshot(): Promise<CrossOutboundCheckHistorySnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/cross-outbound-check-history?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as CrossOutboundCheckHistorySnapshot
  } catch {
    return null
  }
}

export async function saveCrossOutboundCheckHistorySnapshot(items: CrossOutboundCheckHistoryItem[]): Promise<CrossOutboundCheckHistorySnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/cross-outbound-check-history'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items }),
    })
    if (!response.ok) return null
    return await response.json() as CrossOutboundCheckHistorySnapshot
  } catch {
    return null
  }
}

export async function getProductActivitiesSnapshot(): Promise<ProductActivityCurrentSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/product-activities?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductActivityCurrentSnapshot
  } catch {
    return null
  }
}

export async function saveManufacturerManualPromotionsSnapshot(items: ManufacturerManualPromotion[]): Promise<ManufacturerManualPromotionsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/manufacturer-manual-promotions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items }),
    })
    if (!response.ok) return null
    return await response.json() as ManufacturerManualPromotionsSnapshot
  } catch {
    return null
  }
}

export async function getInventoryAdjustmentsSnapshot(): Promise<InventoryAdjustmentsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/inventory-adjustments?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`inventory adjustments api ${response.status}`)
    return await response.json() as InventoryAdjustmentsSnapshot
  } catch {
    return null
  }
}

export async function saveInventoryAdjustmentsSnapshot(adjustments: InventoryAdjustments): Promise<InventoryAdjustmentsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/inventory-adjustments'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ adjustments }),
    })
    if (!response.ok) return null
    return await response.json() as InventoryAdjustmentsSnapshot
  } catch {
    return null
  }
}

export async function getInventoryMovementsSnapshot(): Promise<InventoryMovementsSnapshot | null> {
  if (inventoryQuoteDataMode === 'static') {
    return null
  }
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/inventory-movements?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`inventory movements api ${response.status}`)
    return await response.json() as InventoryMovementsSnapshot
  } catch {
    return null
  }
}

export async function saveInventoryMovementsSnapshot(records: InventoryMovementRecord[]): Promise<InventoryMovementsSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/inventory-movements'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ records }),
    })
    if (!response.ok) return null
    return await response.json() as InventoryMovementsSnapshot
  } catch {
    return null
  }
}

export async function getSerialOverridesSnapshot(): Promise<SerialOverridesSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/inventory-quote/serial-overrides?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`serial overrides api ${response.status}`)
    return await response.json() as SerialOverridesSnapshot
  } catch {
    return null
  }
}

export async function saveSerialOverridesSnapshot(overrides: SerialOverrides): Promise<SerialOverridesSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/inventory-quote/serial-overrides'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ overrides }),
    })
    if (!response.ok) return null
    return await response.json() as SerialOverridesSnapshot
  } catch {
    return null
  }
}

export async function getMarketplacePriceSnapshot(): Promise<MarketplacePriceSnapshot | null> {
  return getApiFirstSnapshot<MarketplacePriceSnapshot>(
    '/api/inventory-quote/prices',
    'latest-marketplace-price-snapshot.json',
  )
}

export async function getProductUrlLockSnapshot(): Promise<ProductUrlLockSnapshot | null> {
  return getApiFirstSnapshot<ProductUrlLockSnapshot>(
    '/api/inventory-quote/product-url-locks',
    'latest-product-url-locks.json',
  )
}

export async function getLenovoWarrantySnapshot(): Promise<LenovoWarrantySnapshot | null> {
  return getApiFirstSnapshot<LenovoWarrantySnapshot>(
    '/api/inventory-quote/warranty',
    'latest-lenovo-warranty-snapshot.json',
  )
}

export async function getWarrantyCheckQueueSnapshot(): Promise<WarrantyCheckQueueSnapshot | null> {
  return getApiFirstSnapshot<WarrantyCheckQueueSnapshot>(
    '/api/inventory-quote/warranty-check-queue',
    'latest-warranty-check-queue.json',
  )
}

export async function getProductLibraryOverview(): Promise<ProductLibraryOverview | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/overview?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryOverview
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticSnapshot<ProductLibraryOverview>('latest-product-library-overview.json')
  }
}

export async function getProductLibraryCategories(): Promise<ProductLibraryCategorySummarySnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/categories?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryCategorySummarySnapshot
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticSnapshot<ProductLibraryCategorySummarySnapshot>('latest-product-library-categories.json')
  }
}

export async function getProductLibraryProducts(limit = 20, search = ''): Promise<ProductLibraryProductsSnapshot | null> {
  return getProductLibraryProductsByCategory(limit, search, '')
}

export async function getProductLibraryProductsByCategory(limit = 20, search = '', category = ''): Promise<ProductLibraryProductsSnapshot | null> {
  const normalizedCategory = category === '全部' ? '' : category.trim()
  const params = new URLSearchParams({
    limit: String(limit),
    search,
    category: normalizedCategory,
    ts: String(Date.now()),
  })
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/products?${params.toString()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryProductsSnapshot
  } catch {
    if (!allowStaticFallback()) return null
    const snapshot = await loadStaticSnapshot<ProductLibraryProductsSnapshot>('latest-product-library-products.json')
    if (!snapshot) return null
    return filterStaticProductLibraryProducts(snapshot, limit, search, normalizedCategory)
  }
}

export async function getProductLibraryProduct(productId: string): Promise<ProductLibraryDetail | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/products/${encodeURIComponent(productId)}?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryDetail
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticProductLibraryDetail(productId)
  }
}

export async function updateProductLibraryProduct(
  productId: string,
  payload: Record<string, unknown>,
): Promise<ProductLibraryDetail | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/products/${encodeURIComponent(productId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { product?: ProductLibraryDetail }
    return result.product ?? null
  } catch {
    return null
  }
}

export async function updateProductLibraryRules(
  productId: string,
  payload: Record<string, unknown>,
): Promise<ProductLibraryBusinessRule | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/products/${encodeURIComponent(productId)}/rules`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { rule?: ProductLibraryBusinessRule }
    return result.rule ?? null
  } catch {
    return null
  }
}

export async function updateProductLibrarySku(
  skuKey: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/skus/${encodeURIComponent(skuKey)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { sku?: Record<string, unknown> }
    return result.sku ?? null
  } catch {
    return null
  }
}

export async function updateProductLibraryCollectionInfo(
  skuKey: string,
  payload: Record<string, unknown>,
): Promise<ProductLibraryCollectionOverride | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/skus/${encodeURIComponent(skuKey)}/collection-info`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { collectionInfo?: ProductLibraryCollectionOverride }
    return result.collectionInfo ?? null
  } catch {
    return null
  }
}

export async function createProductLibraryPriceAdjustment(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/product-library/price-adjustments'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return await response.json() as Record<string, unknown>
  } catch {
    return null
  }
}

export async function getProductLibrarySourceLinks(entityId?: string, entityType?: string, limit = 100): Promise<ProductLibrarySourceLinkSnapshot | null> {
  const params = new URLSearchParams({
    entityId: entityId ?? '',
    entityType: entityType ?? '',
    limit: String(limit),
    ts: String(Date.now()),
  })
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/source-links?${params.toString()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibrarySourceLinkSnapshot
  } catch {
    if (!allowStaticFallback()) return null
    if (entityId && entityType === 'product_master') {
      const detail = await loadStaticProductLibraryDetail(entityId)
      return { items: (detail?.sourceLinks ?? []) as ProductLibrarySourceLink[], count: detail?.sourceLinks?.length ?? 0 }
    }
    return null
  }
}

export async function getProductLibraryEvidence(entityId?: string, entityType?: string, limit = 100): Promise<ProductLibraryEvidenceSnapshot | null> {
  const params = new URLSearchParams({
    entityId: entityId ?? '',
    entityType: entityType ?? '',
    limit: String(limit),
    ts: String(Date.now()),
  })
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/evidence?${params.toString()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryEvidenceSnapshot
  } catch {
    if (!allowStaticFallback()) return null
    if (entityId && entityType === 'product_master') {
      const detail = await loadStaticProductLibraryDetail(entityId)
      return { items: (detail?.evidence ?? []) as ProductLibraryEvidence[], count: detail?.evidence?.length ?? 0 }
    }
    return null
  }
}

export async function getProductLibraryReplays(limit = 50): Promise<ProductLibraryReplaySnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/replays?limit=${limit}&ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryReplaySnapshot
  } catch {
    if (!allowStaticFallback()) return null
    const snapshot = await loadStaticSnapshot<ProductLibraryReplaySnapshot>('latest-product-library-replays.json')
    if (!snapshot) return null
    return {
      items: snapshot.items.slice(0, limit),
      count: snapshot.count,
    }
  }
}

export async function createProductLibraryReplay(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/product-library/replays'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return await response.json() as Record<string, unknown>
  } catch {
    return null
  }
}

export async function getProductLibraryChangeLogs(entityId?: string, entityType?: string, limit = 100): Promise<ProductLibraryChangeLogSnapshot | null> {
  const params = new URLSearchParams({
    entityId: entityId ?? '',
    entityType: entityType ?? '',
    limit: String(limit),
    ts: String(Date.now()),
  })
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/product-library/change-logs?${params.toString()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryChangeLogSnapshot
  } catch {
    if (!allowStaticFallback()) return null
    if (entityId && entityType === 'product_master') {
      const detail = await loadStaticProductLibraryDetail(entityId)
      const items = (detail?.sourceLinks ?? []).slice(0, 20).map((item, index) => ({
        id: `static-${index}`,
        entity_type: 'product_master',
        entity_id: entityId,
        field_name: String((item as ProductLibrarySourceLink).source_key ?? 'source_link'),
        before_value: '',
        after_value: String((item as ProductLibrarySourceLink).source_value ?? ''),
        change_reason: '当前为远程静态快照视图',
        changed_by: 'static-fallback',
        source_system: String((item as ProductLibrarySourceLink).source_system ?? 'static'),
        created_at: String((item as ProductLibrarySourceLink).last_seen_at ?? ''),
      }))
      return { items, count: items.length }
    }
    return null
  }
}

export async function getLocalSyncPipelines(): Promise<LocalSyncPipelineSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/local-sync/pipelines?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as LocalSyncPipelineSnapshot
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticSnapshot<LocalSyncPipelineSnapshot>('latest-local-sync-pipelines.json')
  }
}

export async function getLocalSyncLatestReport(): Promise<LocalSyncLatestReport | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/local-sync/latest-report?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as LocalSyncLatestReport
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticSnapshot<LocalSyncLatestReport>('latest-local-sync-report.json')
  }
}

export async function getLocalSyncFailureQueue(): Promise<LocalSyncFailureQueue | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/local-sync/failure-queue?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as LocalSyncFailureQueue
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticSnapshot<LocalSyncFailureQueue>('latest-local-sync-failure-queue.json')
  }
}

export async function runLocalSyncPipeline(payload: {
  pipeline: string
  dryRun?: boolean
  trigger?: string
  operator?: string
}): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/local-sync/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return await response.json() as Record<string, unknown>
  } catch {
    return null
  }
}

export async function ensureInventoryMasterSync(payload?: {
  trigger?: string
  operator?: string
  source?: string
  force?: boolean
  waitForCompletion?: boolean
  minIntervalSeconds?: number
  maxWaitSeconds?: number
}): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/local-sync/ensure-inventory-master'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
    if (!response.ok) return null
    return await response.json() as Record<string, unknown>
  } catch {
    return null
  }
}

export async function rebuildProductLibraryLinkedViews(scope: 'full' | 'pricing' = 'full'): Promise<ProductLibraryRebuildLinkedViewsResult | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/product-library/rebuild-linked-views'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    })
    if (!response.ok) return null
    return await response.json() as ProductLibraryRebuildLinkedViewsResult
  } catch {
    return null
  }
}

export async function getScheduledTaskConsoleOverview(): Promise<ScheduledTaskConsoleOverview | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/scheduled-task-console/overview?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) {
      if (!allowStaticFallback()) return null
      return loadStaticScheduledTaskConsoleOverview()
    }
    return await response.json() as ScheduledTaskConsoleOverview
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticScheduledTaskConsoleOverview()
  }
}

export async function getScheduledTaskConsoleTasks(): Promise<ScheduledTaskConsoleTaskSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/scheduled-task-console/tasks?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) {
      if (!allowStaticFallback()) return null
      return loadStaticScheduledTaskConsoleTasks()
    }
    return await response.json() as ScheduledTaskConsoleTaskSnapshot
  } catch {
    if (!allowStaticFallback()) return null
    return loadStaticScheduledTaskConsoleTasks()
  }
}

async function loadStaticScheduledTaskConsoleOverview(): Promise<ScheduledTaskConsoleOverview | null> {
  const [dashboard, watchdog] = await Promise.all([
    loadStaticSnapshot<{ generatedAt?: string; latestByTask?: Record<string, Record<string, unknown>> }>('latest-scheduled-task-dashboard.json'),
    loadStaticSnapshot<{ generatedAt?: string; summary?: Record<string, unknown> }>('latest-scheduled-task-watchdog.json'),
  ])
  const latestByTask = dashboard?.latestByTask ?? {}
  const items = Object.values(latestByTask)
  return {
    taskCount: items.length,
    enabledTaskCount: items.length,
    computerUseTaskCount: items.filter((item) => Boolean(item.manualActionRequired)).length,
    watchdogSummary: watchdog?.summary,
    generatedAt: dashboard?.generatedAt ?? watchdog?.generatedAt ?? '',
  }
}

async function loadStaticScheduledTaskConsoleTasks(): Promise<ScheduledTaskConsoleTaskSnapshot | null> {
  const [dashboard, watchdog] = await Promise.all([
    loadStaticSnapshot<{ latestByTask?: Record<string, Record<string, unknown>> }>('latest-scheduled-task-dashboard.json'),
    loadStaticSnapshot<{ checks?: Array<Record<string, unknown>> }>('latest-scheduled-task-watchdog.json'),
  ])
  const latestByTask = dashboard?.latestByTask ?? {}
  const watchdogChecks = watchdog?.checks ?? []
  const items = Object.entries(latestByTask).map(([taskName, report], index) => {
    const steps = Array.isArray(report.steps) ? report.steps as Array<Record<string, unknown>> : []
    const warnings = Array.isArray(report.warnings) ? report.warnings.map(String) : []
    return {
      taskName,
      label: String(report.taskName ?? taskName),
      category: '定时任务',
      priority: index + 1,
      requiresComputerUse: Boolean(report.manualActionRequired),
      relatedPipeline: taskName,
      defaultPrompt: '',
      currentPrompt: '',
      workflowSummary: String(report.blockingReason ?? report.executionOutcome ?? report.status ?? '静态快照'),
      stepItems: steps.map((step) => String(step.detail ?? step.step ?? '')).filter(Boolean),
      sourceItems: [],
      boundaryItems: warnings,
      timeWindows: [],
      operatorNotes: '远程静态快照模式：API 未连接时展示最近一次任务报告，编辑需回到本机 API 模式。',
      enabled: true,
      updatedBy: 'static-fallback',
      updatedAt: String(report.finishedAt ?? report.executedAt ?? ''),
      latestReport: report,
      watchdogChecks: watchdogChecks.filter((check) => check.taskName === taskName),
    } satisfies ScheduledTaskConsoleTask
  })
  return {
    items,
    count: items.length,
  }
}

export async function getOpenClawReceiptSnapshot(): Promise<OpenClawReceiptSnapshot | null> {
  return getRetailCoreApi<OpenClawReceiptSnapshot>('/api/openclaw/collection-receipts')
}

export async function getOpenClawCommandBoardSnapshot(): Promise<OpenClawCommandBoardSnapshot | null> {
  return getRetailCoreApi<OpenClawCommandBoardSnapshot>('/api/openclaw/command-board')
}

export async function getZdtOpenclawBridgeSnapshot(): Promise<ZdtOpenclawBridgeSnapshot | null> {
  return getRetailCoreApi<ZdtOpenclawBridgeSnapshot>('/api/openclaw/zdt-bridge')
}

export async function getOpenClawChatBoardSnapshot(): Promise<OpenClawChatBoardSnapshot | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/openclaw/chat-board?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) {
      return null
    }
    return await response.json() as OpenClawChatBoardSnapshot
  } catch {
    return null
  }
}

export async function sendOpenClawChatBoardMessage(payload: {
  message: string
  title?: string
  taskName?: string
  presetKey?: string
  commandMode?: string
  sourceScope?: string
  targetDate?: string
  dateFrom?: string
  dateTo?: string
  collectionNote?: string
}): Promise<{ ok: boolean; board?: OpenClawChatBoardSnapshot | null } | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/openclaw/chat-board/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return await response.json() as { ok: boolean; board?: OpenClawChatBoardSnapshot | null }
  } catch {
    return null
  }
}

export async function getPromptWorkspaceTemplate(): Promise<PromptWorkspaceTemplate | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/prompt-workspace/template?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    const result = await response.json() as PromptWorkspaceTemplateResponse
    return result.template ?? null
  } catch {
    return null
  }
}

export async function getPromptWorkspaceEntries(query = '', limit = 30): Promise<PromptWorkspaceEntry[]> {
  try {
    const params = new URLSearchParams({ ts: String(Date.now()), limit: String(limit) })
    if (query.trim()) params.set('query', query.trim())
    const response = await fetch(inventoryQuoteApiUrl(`/api/prompt-workspace/entries?${params.toString()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return []
    const result = await response.json() as { items?: PromptWorkspaceEntry[] }
    return result.items ?? []
  } catch {
    return []
  }
}

export async function getPromptWorkspaceEntry(entryId: string): Promise<PromptWorkspaceEntry | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/prompt-workspace/entries/${encodeURIComponent(entryId)}?ts=${Date.now()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    const result = await response.json() as { entry?: PromptWorkspaceEntry }
    return result.entry ?? null
  } catch {
    return null
  }
}

export async function updatePromptWorkspaceEntryMeta(entryId: string, payload: {
  title?: string
  category?: string
  primaryCategory?: string
  secondaryCategory?: string
  sequenceNo?: number
  isFavorite?: boolean
  projectName?: string
  systemPurpose?: string
  existingContext?: string
  currentProblem?: string
  problemDetails?: string[]
  targetOutcome?: string
  targetChecklist?: string[]
  rules?: string[]
  deliverables?: string[]
  acceptanceCriteria?: string[]
  keywords?: string[]
  rawNotes?: string
  autoOptimize?: boolean
}): Promise<PromptWorkspaceEntry | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/prompt-workspace/entries/${encodeURIComponent(entryId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { entry?: PromptWorkspaceEntry }
    return result.entry ?? null
  } catch {
    return null
  }
}

export async function createPromptWorkspaceEntry(payload: Record<string, unknown>): Promise<PromptWorkspaceEntry | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/prompt-workspace/entries'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { entry?: PromptWorkspaceEntry }
    return result.entry ?? null
  } catch {
    return null
  }
}

export async function optimizePromptWorkspaceEntry(entryId: string): Promise<{ ok: boolean; entry?: PromptWorkspaceEntry; meta?: Record<string, unknown> } | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/prompt-workspace/entries/${encodeURIComponent(entryId)}/optimize`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    })
    if (!response.ok) return null
    return await response.json() as { ok: boolean; entry?: PromptWorkspaceEntry; meta?: Record<string, unknown> }
  } catch {
    return null
  }
}

export async function searchPromptWorkspace(query: string, limit = 12): Promise<{ entries: PromptWorkspaceEntry[]; knowledge: PromptWorkspaceKnowledgeItem[] } | null> {
  try {
    const params = new URLSearchParams({ query, limit: String(limit), ts: String(Date.now()) })
    const response = await fetch(inventoryQuoteApiUrl(`/api/prompt-workspace/search?${params.toString()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json() as { entries: PromptWorkspaceEntry[]; knowledge: PromptWorkspaceKnowledgeItem[] }
  } catch {
    return null
  }
}

export async function getPromptWorkspaceKnowledge(query = '', limit = 20): Promise<PromptWorkspaceKnowledgeItem[]> {
  try {
    const params = new URLSearchParams({ limit: String(limit), ts: String(Date.now()) })
    if (query.trim()) params.set('query', query.trim())
    const response = await fetch(inventoryQuoteApiUrl(`/api/prompt-workspace/knowledge?${params.toString()}`), {
      cache: 'no-store',
    })
    if (!response.ok) return []
    const result = await response.json() as { items?: PromptWorkspaceKnowledgeItem[] }
    return result.items ?? []
  } catch {
    return []
  }
}

export async function upsertPromptWorkspaceKnowledge(payload: Record<string, unknown>): Promise<PromptWorkspaceKnowledgeItem | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/prompt-workspace/knowledge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { item?: PromptWorkspaceKnowledgeItem }
    return result.item ?? null
  } catch {
    return null
  }
}

export async function recommendPromptWorkspaceKnowledge(payload: Record<string, unknown>): Promise<PromptWorkspaceKnowledgeItem[]> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/prompt-workspace/knowledge/recommend'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return []
    const result = await response.json() as { items?: PromptWorkspaceKnowledgeItem[] }
    return result.items ?? []
  } catch {
    return []
  }
}

export async function recommendPromptWorkspaceKnowledgeBundle(payload: Record<string, unknown>): Promise<PromptWorkspaceKnowledgeRecommendBundle | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/prompt-workspace/knowledge/recommend'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    return await response.json() as PromptWorkspaceKnowledgeRecommendBundle
  } catch {
    return null
  }
}

export async function updateScheduledTaskConsoleTask(
  taskName: string,
  payload: Record<string, unknown>,
): Promise<ScheduledTaskConsoleTask | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/scheduled-task-console/tasks/${encodeURIComponent(taskName)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { task?: ScheduledTaskConsoleTask }
    return result.task ?? null
  } catch {
    return null
  }
}

export type AdMachineLotteryResult = {
  id: string
  code: string
  customerName: string
  phone: string
  productModel: string
  orderNumber?: string
  level: string
  prize: string
  createdAt: string
}

export type AdMachineLeadSubmission = {
  id: string
  name: string
  phone: string
  orderNumber?: string
  storeName?: string
  productModel?: string
  lotteryCode?: string
  createdAt: string
  syncStatus: string
}

export type AdMachineServiceTicket = {
  id: string
  code: string
  category: string
  customerName: string
  phone: string
  createdAt: string
  status: 'waiting' | 'serving' | 'done'
}

export type AdMachineRuntime = {
  updatedAt?: string
  lotteryRecords: AdMachineLotteryResult[]
  leadSubmissions: AdMachineLeadSubmission[]
  serviceTickets: AdMachineServiceTicket[]
}

export async function getAdMachineRuntime(): Promise<AdMachineRuntime | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl(`/api/ad-machine/runtime?ts=${Date.now()}`), { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json() as AdMachineRuntime
  } catch {
    return null
  }
}

export async function createAdMachineLotteryDraw(payload: {
  customerName: string
  phone: string
  productModel: string
  orderNumber?: string
}): Promise<AdMachineLotteryResult | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/ad-machine/lottery/draw'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { result?: AdMachineLotteryResult }
    return result.result ?? null
  } catch {
    return null
  }
}

export async function submitAdMachineLead(payload: {
  name: string
  phone: string
  orderNumber?: string
  storeName?: string
  productModel?: string
  lotteryCode?: string
  note?: string
}): Promise<AdMachineLeadSubmission | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/ad-machine/leads'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { lead?: AdMachineLeadSubmission }
    return result.lead ?? null
  } catch {
    return null
  }
}

export async function createAdMachineServiceTicket(payload: {
  category: string
  customerName?: string
  phone?: string
}): Promise<AdMachineServiceTicket | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/ad-machine/service-tickets'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return null
    const result = await response.json() as { ticket?: AdMachineServiceTicket }
    return result.ticket ?? null
  } catch {
    return null
  }
}

export async function callNextAdMachineServiceTicket(): Promise<AdMachineServiceTicket[] | null> {
  try {
    const response = await fetch(inventoryQuoteApiUrl('/api/ad-machine/service-tickets/call-next'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) return null
    const result = await response.json() as { serviceTickets?: AdMachineServiceTicket[] }
    return result.serviceTickets ?? null
  } catch {
    return null
  }
}

export function getProductLibraryExportUrl(kind: string, options?: { category?: string; search?: string; productId?: string }) {
  const normalizedCategory = options?.category === '全部' ? '' : (options?.category ?? '')
  const params = new URLSearchParams({
    kind,
    category: normalizedCategory,
    search: options?.search ?? '',
    productId: options?.productId ?? '',
    ts: String(Date.now()),
  })
  return inventoryQuoteApiUrl(`/api/product-library/export?${params.toString()}`)
}
