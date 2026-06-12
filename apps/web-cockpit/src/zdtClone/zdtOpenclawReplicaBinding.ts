import type {
  InventoryMovementsSnapshot,
  OpenClawCommandBoardSnapshot,
  OpenClawReceiptSnapshot,
  ProductLibraryCategorySummarySnapshot,
  ProductLibraryOverview,
  ProductLibraryProductsSnapshot,
  PublishedProductProjectionSnapshot,
  RetailCoreSalesOrders,
  RetailCoreSerialItems,
  RetailCoreStatus,
  StandardInventorySnapshot,
  ZdtOpenclawBridgeSnapshot,
} from '../domain/inventoryQuote/service'

export type ZdtReplicaMenuKey = 'organization' | 'product' | 'order' | 'inventory'

export type ZdtReplicaFieldValue = string | number | null

export type ZdtReplicaDetailField = {
  key: string
  label: string
  value: ZdtReplicaFieldValue
}

export type ZdtReplicaFilterOption = {
  label: string
  value: string
}

export type ZdtReplicaFilter = {
  key: string
  label: string
  options: ZdtReplicaFilterOption[]
}

export type ZdtReplicaRow = {
  id: string
  source: 'retail_core' | 'openclaw' | 'retail_system' | 'mixed'
  cells: Record<string, ZdtReplicaFieldValue>
}

export type ZdtReplicaSection = {
  menu: ZdtReplicaMenuKey
  columns: string[]
  rows: ZdtReplicaRow[]
  detailFields: ZdtReplicaDetailField[]
  filters: ZdtReplicaFilter[]
}

export type ZdtOpenclawReplicaBindingInput = {
  retailCoreStatus?: RetailCoreStatus | null
  inventory?: StandardInventorySnapshot | null
  inventoryMovements?: InventoryMovementsSnapshot | null
  retailCoreSalesOrders?: RetailCoreSalesOrders | null
  retailCoreSerialItems?: RetailCoreSerialItems | null
  productOverview?: ProductLibraryOverview | null
  productCategories?: ProductLibraryCategorySummarySnapshot | null
  productItems?: ProductLibraryProductsSnapshot | null
  publishedProjection?: PublishedProductProjectionSnapshot | null
  openclawBridge?: ZdtOpenclawBridgeSnapshot | null
  openclawReceipts?: OpenClawReceiptSnapshot | null
  openclawCommands?: OpenClawCommandBoardSnapshot | null
}

export type ZdtOpenclawReplicaBinding = {
  generatedAt: string
  menus: Record<ZdtReplicaMenuKey, ZdtReplicaSection>
}

const EMPTY_FILTERS: ZdtReplicaFilterOption[] = [{ label: '全部', value: '' }]

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((item) => (item ?? '').trim()).filter(Boolean)))
}

function n(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildOrganizationSection(input: ZdtOpenclawReplicaBindingInput): ZdtReplicaSection {
  const skus = input.inventory?.skus ?? []
  const fallbackShopName = input.retailCoreSalesOrders?.items?.find((item) => item.shop_name || item.store_code)?.shop_name
    ?? input.retailCoreSalesOrders?.items?.find((item) => item.shop_name || item.store_code)?.store_code
    ?? null
  const fallbackShopCode = input.retailCoreSalesOrders?.items?.find((item) => item.shop_id)?.shop_id
    ?? input.retailCoreSalesOrders?.items?.find((item) => item.company_id)?.company_id
    ?? null
  const rowsByOrg = new Map<string, { orgCode: string | null; skuCount: number; currentStock: number; serialCount: number }>()
  for (const sku of skus) {
    const orgName = sku.organizationName ?? fallbackShopName ?? sku.organizationCode ?? fallbackShopCode ?? null
    if (!orgName) continue
    const current = rowsByOrg.get(orgName) ?? { orgCode: sku.organizationCode ?? null, skuCount: 0, currentStock: 0, serialCount: 0 }
    current.skuCount += 1
    current.currentStock += Number(sku.currentStock ?? 0)
    current.serialCount += Number(sku.serialCount ?? 0)
    if (!current.orgCode && sku.organizationCode) current.orgCode = sku.organizationCode
    rowsByOrg.set(orgName, current)
  }

  const rows: ZdtReplicaRow[] = Array.from(rowsByOrg.entries())
    .sort((a, b) => b[1].currentStock - a[1].currentStock)
    .map(([orgName, summary]) => ({
      id: `organization:${orgName}`,
      source: 'mixed',
      cells: {
        name: orgName,
        code: summary.orgCode ?? fallbackShopCode,
        company: orgName,
        province: null,
        city: null,
        region: null,
        type: '门店',
        status: '启用',
        owner: null,
        skuCount: summary.skuCount,
        currentStock: summary.currentStock,
        serialCount: summary.serialCount,
      },
    }))

  const filters: ZdtReplicaFilter[] = [
    {
      key: 'name',
      label: '所属公司',
      options: EMPTY_FILTERS.concat(
        uniq(skus.map((sku) => sku.organizationName).concat(fallbackShopName ? [fallbackShopName] : []))
          .map((value) => ({ label: value, value })),
      ),
    },
  ]

  return {
    menu: 'organization',
    columns: ['name', 'code', 'company', 'province', 'city', 'region', 'type', 'status', 'owner'],
    rows,
    detailFields: [
      { key: 'organizationRowCount', label: '组织行数', value: rows.length },
      { key: 'skuCount', label: 'SKU总数', value: input.inventory?.totals?.skuCount ?? null },
      { key: 'stockCount', label: '当前库存总数', value: input.inventory?.totals?.currentStock ?? null },
      { key: 'openclawLatestBusinessDate', label: 'OpenClaw最新业务日期', value: input.openclawBridge?.summary?.latestBusinessDate ?? null },
      { key: 'openclawLatestCapturedAt', label: 'OpenClaw最新回执时间', value: input.openclawBridge?.summary?.latestCapturedAt ?? null },
    ],
    filters,
  }
}

function buildProductSection(input: ZdtOpenclawReplicaBindingInput): ZdtReplicaSection {
  const projectionItems = input.publishedProjection?.items ?? []
  const productItems = input.productItems?.items ?? []
  const rows: ZdtReplicaRow[] = projectionItems.map((item) => ({
    id: `product:${item.skuKey}`,
    source: 'mixed',
    cells: {
      productInfo: item.productName ?? item.displayTitle,
      category: item.category ?? null,
      source: null,
      type: null,
      productCode: item.skuKey,
      status: null,
      taxCategory: null,
      taxRate: null,
      updatedAt: item.pricing?.priceVersion ?? null,
      currentStock: n(item.currentStock),
      sellableStock: n(item.sellableStock),
      pnMtm: item.pnMtm ?? null,
    },
  }))

  const filters: ZdtReplicaFilter[] = [
    {
      key: 'category',
      label: '商品分类',
      options: EMPTY_FILTERS.concat(uniq(projectionItems.map((item) => item.category)).map((value) => ({ label: value, value }))),
    },
    {
      key: 'pnMtm',
      label: 'PN/MTM',
      options: EMPTY_FILTERS.concat(uniq(projectionItems.map((item) => item.pnMtm)).map((value) => ({ label: value, value }))),
    },
  ]

  return {
    menu: 'product',
    columns: ['productInfo', 'category', 'source', 'type', 'productCode', 'status', 'taxCategory', 'taxRate', 'updatedAt'],
    rows,
    detailFields: [
      { key: 'projectionCount', label: '投影商品数', value: input.publishedProjection?.itemCount ?? null },
      { key: 'productLibraryCount', label: '产品库商品数', value: input.productOverview?.productMasterCount ?? null },
      { key: 'productLibrarySkuCount', label: '产品库SKU数', value: input.productOverview?.skuCount ?? null },
      { key: 'categoryCount', label: '分类数量', value: input.productCategories?.count ?? null },
      { key: 'openclawProductCount', label: 'OpenClaw商品数', value: input.openclawBridge?.summary?.productCount ?? null },
      { key: 'firstProductReviewStatus', label: '首条产品审核状态', value: productItems[0]?.review_status ?? null },
    ],
    filters,
  }
}

function buildOrderSection(input: ZdtOpenclawReplicaBindingInput): ZdtReplicaSection {
  const orders = input.retailCoreSalesOrders?.items ?? []
  const rows: ZdtReplicaRow[] = orders.map((order) => ({
    id: `order:${order.id}`,
    source: 'retail_core',
    cells: {
      productInfo: order.lines?.[0]?.product_name ?? order.lines?.[0]?.sku_key ?? order.order_no ?? order.order_number ?? null,
      recipientInfo: [order.customer_name, order.external_order_no].filter(Boolean).join(' / ') || null,
      orderTime: order.created_time ?? order.business_date ?? null,
      deliveryTime: order.pay_time ?? order.operate_time ?? null,
      shopName: order.shop_name ?? order.store_code ?? null,
      depotName: null,
      paidAmount: n(order.total_amount),
      status: order.status_name ?? order.status ?? null,
      source: order.channel_type_name ?? order.order_type_name ?? null,
      courier: null,
      orderNo: order.order_no ?? order.order_number ?? order.external_order_no ?? null,
      totalQuantity: n(order.total_quantity),
    },
  }))

  const filters: ZdtReplicaFilter[] = [
    {
      key: 'status',
      label: '订单状态',
      options: EMPTY_FILTERS.concat(uniq(orders.map((order) => order.status_name ?? order.status)).map((value) => ({ label: value, value }))),
    },
    {
      key: 'shopName',
      label: '门店',
      options: EMPTY_FILTERS.concat(uniq(orders.map((order) => order.shop_name ?? order.store_code)).map((value) => ({ label: value, value }))),
    },
  ]

  return {
    menu: 'order',
    columns: ['productInfo', 'recipientInfo', 'orderTime', 'deliveryTime', 'shopName', 'depotName', 'paidAmount', 'status', 'source', 'courier'],
    rows,
    detailFields: [
      { key: 'orderCount', label: '订单总数', value: input.retailCoreSalesOrders?.count ?? null },
      { key: 'customerCount', label: '客户总数', value: null },
      { key: 'openclawOrderCount', label: 'OpenClaw订单数', value: input.openclawBridge?.summary?.orderCount ?? null },
      { key: 'latestReceiptCount', label: 'OpenClaw最新回执总数', value: input.openclawReceipts?.total ?? null },
      { key: 'openCommandPending', label: 'OpenClaw待处理命令', value: input.openclawCommands?.pendingForOpenClaw.length ?? null },
    ],
    filters,
  }
}

function buildInventorySection(input: ZdtOpenclawReplicaBindingInput): ZdtReplicaSection {
  const skus = input.inventory?.skus ?? []
  const movementBySku = new Map<string, string>()
  for (const row of input.inventoryMovements?.records ?? []) {
    if (!movementBySku.has(row.skuKey)) movementBySku.set(row.skuKey, row.movementType)
  }

  const rows: ZdtReplicaRow[] = skus.map((sku) => ({
    id: `inventory:${sku.skuKey}`,
    source: 'mixed',
    cells: {
      productName: sku.productName ?? null,
      pnMtm: sku.pnMtm ?? null,
      spec: sku.spec ?? null,
      currentStock: n(sku.currentStock),
      sellableStock: n(sku.sellableStock),
      occupiedStock: n(sku.occupiedStock),
      unsellableStock: n(sku.unsellableStock),
      pendingInboundStock: n(sku.pendingInboundStock),
      warningLevel: null,
      category: sku.category ?? null,
      stockType: sku.stockType ?? null,
      productCode: sku.productCode ?? null,
      skuCode: sku.skuCode ?? sku.skuKey,
      organizationName: sku.organizationName ?? null,
      organizationCode: sku.organizationCode ?? null,
      agentPrice: n(sku.agentPrice),
      salesCostPrice: n(sku.salesCostPrice),
      latestMovementType: movementBySku.get(sku.skuKey) ?? null,
      serialCount: n(sku.serialCount),
    },
  }))

  const filters: ZdtReplicaFilter[] = [
    {
      key: 'category',
      label: '库存分类',
      options: EMPTY_FILTERS.concat(uniq(skus.map((sku) => sku.category)).map((value) => ({ label: value, value }))),
    },
    {
      key: 'stockType',
      label: '库存类型',
      options: EMPTY_FILTERS.concat(uniq(skus.map((sku) => sku.stockType)).map((value) => ({ label: value, value }))),
    },
    {
      key: 'latestMovementType',
      label: '最近流水类型',
      options: EMPTY_FILTERS.concat(uniq(Array.from(movementBySku.values())).map((value) => ({ label: value, value }))),
    },
  ]

  return {
    menu: 'inventory',
    columns: [
      'productName',
      'pnMtm',
      'spec',
      'currentStock',
      'sellableStock',
      'occupiedStock',
      'unsellableStock',
      'pendingInboundStock',
      'warningLevel',
      'category',
      'productCode',
      'skuCode',
      'organizationName',
      'organizationCode',
      'stockType',
      'agentPrice',
      'salesCostPrice',
    ],
    rows,
    detailFields: [
      { key: 'inventorySkuCount', label: '库存SKU总数', value: input.inventory?.totals?.skuCount ?? null },
      { key: 'inventoryCurrentStock', label: '库存总量', value: input.inventory?.totals?.currentStock ?? null },
      { key: 'inventorySerialCount', label: '在库SN总数', value: input.inventory?.totals?.serialCount ?? null },
      { key: 'retailCoreSerialCount', label: 'RetailCore序列号行数', value: input.retailCoreSerialItems?.count ?? null },
      { key: 'movementCount', label: '库存流水总数', value: input.inventoryMovements?.records.length ?? null },
      { key: 'openclawInventoryCount', label: 'OpenClaw库存数', value: input.openclawBridge?.summary?.inventoryCount ?? null },
    ],
    filters,
  }
}

export function buildZdtOpenclawReplicaBinding(input: ZdtOpenclawReplicaBindingInput): ZdtOpenclawReplicaBinding {
  return {
    generatedAt: new Date().toISOString(),
    menus: {
      organization: buildOrganizationSection(input),
      product: buildProductSection(input),
      order: buildOrderSection(input),
      inventory: buildInventorySection(input),
    },
  }
}
