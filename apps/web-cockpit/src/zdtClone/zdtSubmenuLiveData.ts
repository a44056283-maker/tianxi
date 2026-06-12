import type {
  InventoryMovementsSnapshot,
  ProductLibraryCategorySummarySnapshot,
  ProductLibraryOverview,
  ProductLibraryProductsSnapshot,
  PublishedProductProjectionSnapshot,
  RetailCoreCustomers,
  RetailCoreSalesOrders,
  RetailCoreSerialItems,
  RetailCoreStatus,
  SnSalesComplianceSnapshot,
  StandardInventorySnapshot,
} from '../domain/inventoryQuote/service'

export type ZdtLiveMetric = {
  label: string
  value: string
  note: string
}

export type ZdtLivePreviewRow = {
  title: string
  subtitle: string
  meta: string[]
}

export type ZdtSubmenuLivePanel = {
  title: string
  source: string
  status: 'connected' | 'partial' | 'pending'
  metrics: ZdtLiveMetric[]
  rows: ZdtLivePreviewRow[]
  emptyText: string
}

type BuildZdtSubmenuLivePanelArgs = {
  submenuKey: string
  status: RetailCoreStatus | null
  inventory: StandardInventorySnapshot | null
  movements: InventoryMovementsSnapshot | null
  salesOrders: RetailCoreSalesOrders | null
  customers: RetailCoreCustomers | null
  serialItems: RetailCoreSerialItems | null
  snSalesCompliance: SnSalesComplianceSnapshot | null
  productOverview: ProductLibraryOverview | null
  productCategories: ProductLibraryCategorySummarySnapshot | null
  productItems: ProductLibraryProductsSnapshot | null
  publishedProjection: PublishedProductProjectionSnapshot | null
}

const fmtCount = (value: number | null | undefined) => String(Number(value ?? 0))
const fmtDate = (value: string | null | undefined) => (value ? String(value).slice(0, 16).replace('T', ' ') : '待补')
const fmtPrice = (value: number | null | undefined) => {
  const numberValue = Number(value ?? 0)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return '待补'
  return `￥${numberValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}
const unique = (values: Array<string | null | undefined>) => Array.from(new Set(values.filter((item): item is string => Boolean(item && item.trim()))))

function buildPendingPanel(title: string, source: string, reason: string): ZdtSubmenuLivePanel {
  return {
    title,
    source,
    status: 'pending',
    metrics: [
      { label: '当前状态', value: '待接入', note: reason },
      { label: '数据来源', value: source, note: '当前先完成同构页面结构，后续再补专属 SQL 表或接口' },
    ],
    rows: [],
    emptyText: '当前子菜单还没有接入稳定 SQL 数据源。',
  }
}

function buildMovementRows(
  movements: InventoryMovementsSnapshot | null,
  predicate: (row: InventoryMovementsSnapshot['records'][number]) => boolean,
): ZdtLivePreviewRow[] {
  return (movements?.records ?? [])
    .filter(predicate)
    .slice(0, 8)
    .map((row) => ({
      title: row.documentNumber || row.sourceRef || row.productName || row.skuKey,
      subtitle: row.productName || row.spec || row.pnMtm || row.skuKey,
      meta: [
        `数量 ${row.quantity}`,
        row.serialNumber ? `SN ${row.serialNumber}` : (row.serialNumbersDisplay ? `SN ${row.serialNumbersDisplay}` : 'SN 待补'),
        row.supplierName ? `供应商 ${row.supplierName}` : (row.storeName ? `门店 ${row.storeName}` : `日期 ${fmtDate(row.businessDate)}`),
      ],
    }))
}

function buildSalesOrderRows(salesOrders: RetailCoreSalesOrders | null): ZdtLivePreviewRow[] {
  return (salesOrders?.items ?? []).slice(0, 8).map((order) => ({
    title: order.order_no || order.order_number || order.external_order_no || order.id,
    subtitle: `${order.customer_name || '匿名客户'} · ${order.shop_name || order.store_code || '门店待补'}`,
    meta: [
      `数量 ${fmtCount(order.total_quantity)}`,
      `实付 ${fmtPrice(order.total_amount)}`,
      `业务日 ${fmtDate(order.business_date)}`,
    ],
  }))
}

function buildSerialRows(serialItems: RetailCoreSerialItems | null): ZdtLivePreviewRow[] {
  return (serialItems?.items ?? []).slice(0, 8).map((item) => ({
    title: item.serial_number,
    subtitle: item.product_name || item.sku_key,
    meta: [
      item.location_code ? `库位 ${item.location_code}` : `仓库 ${item.warehouse_code || '待补'}`,
      item.supplier_name ? `供应商 ${item.supplier_name}` : `成本 ${fmtPrice(item.cost_amount)}`,
      `入库 ${fmtDate(item.inbound_date)}`,
    ],
  }))
}

function buildProductRows(productItems: ProductLibraryProductsSnapshot | null): ZdtLivePreviewRow[] {
  return (productItems?.items ?? []).slice(0, 8).map((item) => ({
    title: item.canonical_name,
    subtitle: item.pn_mtm || item.primary_sku_key,
    meta: [
      `库存 ${fmtCount(item.current_stock)}`,
      `可售 ${fmtCount(item.sellable_stock)}`,
      item.default_category || item.source_category || '分类待补',
    ],
  }))
}

function projectionStoreDisplayPrice(item: PublishedProductProjectionSnapshot['items'][number]) {
  const manualAmount = Number(item.pricing?.storeManualPromotionAmount ?? 0)
  const adjusted = Number(item.pricing?.adjustedPreSubsidyPrice ?? 0)
  const base = Number(item.pricing?.storeRetailPrice ?? 0)
  if (manualAmount > 0 && adjusted > 0) return adjusted
  return base || adjusted || 0
}

function buildProjectionRows(publishedProjection: PublishedProductProjectionSnapshot | null): ZdtLivePreviewRow[] {
  return (publishedProjection?.items ?? []).slice(0, 8).map((item) => ({
    title: item.displayTitle || item.productName || item.skuKey,
    subtitle: item.pnMtm || item.spec || item.category || item.skuKey,
    meta: [
      `活动后国补前执行价 ${fmtPrice(projectionStoreDisplayPrice(item))}`,
      `原门店挂牌价 ${fmtPrice(item.pricing?.storeRetailPrice)}`,
      `终态价 ${fmtPrice(item.pricing?.finalPrice)}`,
      `库存 ${fmtCount(item.currentStock)}`,
    ],
  }))
}

function buildOrganizationRows(inventory: StandardInventorySnapshot | null): ZdtLivePreviewRow[] {
  const skus = inventory?.skus ?? []
  const totalsByOrg = new Map<string, { skuCount: number; stock: number; serials: number }>()
  for (const sku of skus) {
    const key = sku.organizationName || sku.organizationCode || '组织待补'
    const current = totalsByOrg.get(key) ?? { skuCount: 0, stock: 0, serials: 0 }
    current.skuCount += 1
    current.stock += Number(sku.currentStock ?? 0)
    current.serials += Number(sku.serialCount ?? 0)
    totalsByOrg.set(key, current)
  }
  return Array.from(totalsByOrg.entries())
    .sort((left, right) => right[1].stock - left[1].stock)
    .slice(0, 8)
    .map(([name, summary]) => ({
      title: name,
      subtitle: '组织库存归属',
      meta: [
        `SKU ${summary.skuCount}`,
        `库存 ${summary.stock}`,
        `SN ${summary.serials}`,
      ],
    }))
}

function buildWarehouseRows(serialItems: RetailCoreSerialItems | null): ZdtLivePreviewRow[] {
  const rows = new Map<string, { count: number; suppliers: string[] }>()
  for (const item of serialItems?.items ?? []) {
    const key = item.warehouse_code || item.location_code || '仓库待补'
    const current = rows.get(key) ?? { count: 0, suppliers: [] }
    current.count += 1
    if (item.supplier_name) current.suppliers.push(item.supplier_name)
    rows.set(key, current)
  }
  return Array.from(rows.entries()).slice(0, 8).map(([name, summary]) => ({
    title: name,
    subtitle: '仓库 / 库位主链',
    meta: [
      `SN ${summary.count}`,
      `供应商 ${unique(summary.suppliers).slice(0, 2).join(' / ') || '待补'}`,
    ],
  }))
}

function buildSupplierRows(serialItems: RetailCoreSerialItems | null, movements: InventoryMovementsSnapshot | null): ZdtLivePreviewRow[] {
  const rows = new Map<string, { serialCount: number; inboundCount: number }>()
  for (const item of serialItems?.items ?? []) {
    const key = item.supplier_name || '供应商待补'
    const current = rows.get(key) ?? { serialCount: 0, inboundCount: 0 }
    current.serialCount += 1
    rows.set(key, current)
  }
  for (const row of movements?.records ?? []) {
    if (row.movementType !== 'purchase_inbound') continue
    const key = row.supplierName || '供应商待补'
    const current = rows.get(key) ?? { serialCount: 0, inboundCount: 0 }
    current.inboundCount += Number(row.quantity ?? 0)
    rows.set(key, current)
  }
  return Array.from(rows.entries())
    .sort((left, right) => right[1].inboundCount - left[1].inboundCount)
    .slice(0, 8)
    .map(([name, summary]) => ({
      title: name,
      subtitle: '供应商主链',
      meta: [
        `入库 ${summary.inboundCount}`,
        `在库SN ${summary.serialCount}`,
      ],
    }))
}

function buildLocationRows(serialItems: RetailCoreSerialItems | null): ZdtLivePreviewRow[] {
  const rows = new Map<string, number>()
  for (const item of serialItems?.items ?? []) {
    const key = item.location_code || '库位待补'
    rows.set(key, (rows.get(key) ?? 0) + 1)
  }
  return Array.from(rows.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([location, count]) => ({
      title: location,
      subtitle: '库位在库 SN 分布',
      meta: [`SN ${count}`],
    }))
}

function buildCategoryRows(categories: ProductLibraryCategorySummarySnapshot | null): ZdtLivePreviewRow[] {
  return (categories?.items ?? []).slice(0, 8).map((item) => ({
    title: item.category,
    subtitle: '库存总览 / 分类视图',
    meta: [
      `SKU ${item.sku_count}`,
      `库存 ${item.current_stock}`,
      `出库 ${item.outbound_units}`,
    ],
  }))
}

function buildStockRows(inventory: StandardInventorySnapshot | null): ZdtLivePreviewRow[] {
  return (inventory?.skus ?? [])
    .slice()
    .sort((left, right) => Number(right.currentStock ?? 0) - Number(left.currentStock ?? 0))
    .slice(0, 8)
    .map((item) => ({
      title: item.productName || item.skuKey,
      subtitle: item.pnMtm || item.spec || item.skuKey,
      meta: [
        `库存 ${item.currentStock}`,
        `可售 ${item.sellableStock}`,
        `SN ${item.serialCount}`,
      ],
    }))
}

function buildCostRows(inventory: StandardInventorySnapshot | null): ZdtLivePreviewRow[] {
  return (inventory?.skus ?? [])
    .filter((item) => Number(item.salesCostPrice ?? item.agentPrice ?? 0) > 0)
    .slice(0, 8)
    .map((item) => ({
      title: item.productName || item.skuKey,
      subtitle: item.pnMtm || item.spec || item.skuKey,
      meta: [
        `销售成本 ${fmtPrice(item.salesCostPrice)}`,
        `进货价 ${fmtPrice(item.agentPrice)}`,
        `库存 ${fmtCount(item.currentStock)}`,
      ],
    }))
}

function buildDocumentRows(movements: InventoryMovementsSnapshot | null, predicate: (row: InventoryMovementsSnapshot['records'][number]) => boolean): ZdtLivePreviewRow[] {
  const grouped = new Map<string, { productName: string; quantity: number; serialCount: number; businessDate: string }>()
  for (const row of movements?.records ?? []) {
    if (!predicate(row)) continue
    const key = row.documentNumber || row.sourceRef || `${row.movementType}-${row.skuKey}`
    const current = grouped.get(key) ?? { productName: row.productName || row.skuKey, quantity: 0, serialCount: 0, businessDate: row.businessDate }
    current.quantity += Number(row.quantity ?? 0)
    current.serialCount += row.serialNumber || row.serialNumbersDisplay ? 1 : 0
    current.businessDate = row.businessDate || current.businessDate
    grouped.set(key, current)
  }
  return Array.from(grouped.entries()).slice(0, 8).map(([documentNo, item]) => ({
    title: documentNo,
    subtitle: item.productName,
    meta: [
      `数量 ${item.quantity}`,
      `SN ${item.serialCount}`,
      `日期 ${fmtDate(item.businessDate)}`,
    ],
  }))
}

function buildDailySalesRows(salesOrders: RetailCoreSalesOrders | null): ZdtLivePreviewRow[] {
  const grouped = new Map<string, { count: number; amount: number }>()
  for (const row of salesOrders?.items ?? []) {
    const key = String(row.business_date || '').slice(0, 10) || '日期待补'
    const current = grouped.get(key) ?? { count: 0, amount: 0 }
    current.count += 1
    current.amount += Number(row.total_amount ?? 0)
    grouped.set(key, current)
  }
  return Array.from(grouped.entries())
    .sort((left, right) => right[0].localeCompare(left[0]))
    .slice(0, 8)
    .map(([date, summary]) => ({
      title: date,
      subtitle: '销售日报',
      meta: [
        `订单 ${summary.count}`,
        `金额 ${fmtPrice(summary.amount)}`,
      ],
    }))
}

function buildSnComplianceRows(snSalesCompliance: SnSalesComplianceSnapshot | null): ZdtLivePreviewRow[] {
  return (snSalesCompliance?.items ?? [])
    .slice()
    .sort((left, right) => Number(right.claimableAmount ?? 0) - Number(left.claimableAmount ?? 0))
    .slice(0, 8)
    .map((item) => ({
      title: item.productName || item.serialNumber || item.orderNumber,
      subtitle: `${item.statusLabel} · ${item.serialNumber || '待补SN'}`,
      meta: [
        `订单 ${item.orderNumber || '待补'}`,
        `资格 ${fmtPrice(item.claimableAmount)}`,
        item.recommendedAction || (item.validation.chainComplete ? '优先整理申领材料' : '先补链路证据'),
      ],
    }))
}

export function buildZdtSubmenuLivePanel(args: BuildZdtSubmenuLivePanelArgs): ZdtSubmenuLivePanel {
  const {
    submenuKey,
    inventory,
    movements,
    salesOrders,
    customers,
    serialItems,
    snSalesCompliance,
    productOverview,
    productCategories,
    productItems,
    publishedProjection,
  } = args

  switch (submenuKey) {
    case 'organization-shop':
      return {
        title: '门店组织主链',
        source: 'live_inventory',
        status: inventory ? 'connected' : 'partial',
        metrics: [
          { label: '组织数', value: fmtCount(unique((inventory?.skus ?? []).map((item) => item.organizationName)).length), note: '来自库存主链中的组织归属' },
          { label: 'SKU数', value: fmtCount(inventory?.totals?.skuCount), note: '当前按组织归属落到商品库存的 SKU' },
          { label: '库存SN', value: fmtCount(inventory?.totals?.serialCount), note: '在库序列号总量' },
        ],
        rows: buildOrganizationRows(inventory),
        emptyText: '当前还没有识别到门店组织归属数据。',
      }
    case 'organization-warehouse':
      return {
        title: '仓库主链',
        source: 'retail_core.serial_items',
        status: serialItems ? 'connected' : 'partial',
        metrics: [
          { label: '仓库编码', value: fmtCount(unique((serialItems?.items ?? []).map((item) => item.warehouse_code)).length), note: '从序列号主链统计仓库编码' },
          { label: '库位编码', value: fmtCount(unique((serialItems?.items ?? []).map((item) => item.location_code)).length), note: '从序列号主链统计库位编码' },
          { label: '在库SN', value: fmtCount(serialItems?.count), note: '当前在库序列号总量' },
        ],
        rows: buildWarehouseRows(serialItems),
        emptyText: '当前还没有稳定的仓库主档数据。',
      }
    case 'product-city':
      return {
        title: '经销商商品主档',
        source: 'product_library.overview + product_library.products',
        status: productOverview && productItems ? 'connected' : 'partial',
        metrics: [
          { label: '产品主档', value: fmtCount(productOverview?.productMasterCount), note: '产品主档总数' },
          { label: 'SKU数', value: fmtCount(productOverview?.skuCount), note: 'SKU 主档总数' },
          { label: '证据条目', value: fmtCount(productOverview?.evidenceCount), note: '证据留档数量' },
        ],
        rows: buildProductRows(productItems),
        emptyText: '当前还没有可展示的经销商商品主档。',
      }
    case 'product-store':
      return {
        title: '门店商品发布态',
        source: 'published_product_projection_live',
        status: publishedProjection ? 'connected' : 'partial',
        metrics: [
          { label: '投影商品', value: fmtCount(publishedProjection?.itemCount), note: '门店商品投影总数' },
          { label: '已定价', value: fmtCount(publishedProjection?.pricedCount), note: '已形成零售价的商品' },
          { label: '终态价', value: fmtCount(publishedProjection?.finalPriceCount), note: '已形成终态零售价的商品' },
        ],
        rows: buildProjectionRows(publishedProjection),
        emptyText: '当前还没有稳定的门店商品发布投影。',
      }
    case 'product-depot':
      return {
        title: '仓库商品视图',
        source: 'live_inventory + published_product_projection_live',
        status: inventory && publishedProjection ? 'connected' : 'partial',
        metrics: [
          { label: '库存SKU', value: fmtCount(inventory?.totals?.skuCount), note: '当前库存 SKU 数量' },
          { label: '可售库存', value: fmtCount(inventory?.totals?.sellableStock), note: '当前可售数量' },
          { label: '门店投影', value: fmtCount(publishedProjection?.itemCount), note: '已形成前端投影的商品' },
        ],
        rows: buildStockRows(inventory),
        emptyText: '当前还没有仓库商品主链数据。',
      }
    case 'product-hot-sale':
      return buildPendingPanel('收银热卖商品', 'products_hot_sale', 'OpenClaw / 本地产品库还未把热卖位配置表正式接入。')
    case 'product-supplier':
      return {
        title: '供应商主链',
        source: 'retail_core.serial_items + inventory_movements',
        status: serialItems || movements ? 'connected' : 'partial',
        metrics: [
          { label: '供应商数', value: fmtCount(unique([...(serialItems?.items ?? []).map((item) => item.supplier_name), ...(movements?.records ?? []).map((item) => item.supplierName)]).length), note: '序列号与采购流水联合去重' },
          { label: '采购入库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'purchase_inbound').length), note: '采购入库流水行数' },
          { label: '在库SN', value: fmtCount(serialItems?.count), note: '在库 SN 主链可回溯供应商' },
        ],
        rows: buildSupplierRows(serialItems, movements),
        emptyText: '当前还没有供应商主链数据。',
      }
    case 'order-offline':
      return {
        title: '线下门店订单主链',
        source: 'retail_core.sales_orders',
        status: salesOrders ? 'connected' : 'partial',
        metrics: [
          { label: '销售订单', value: fmtCount(salesOrders?.count), note: '销售订单总数' },
          { label: '客户数', value: fmtCount(customers?.count), note: '已沉淀客户数量' },
          { label: '最近业务日', value: fmtDate(salesOrders?.items?.[0]?.business_date), note: '按最新订单读取' },
        ],
        rows: buildSalesOrderRows(salesOrders),
        emptyText: '当前还没有线下门店订单数据。',
      }
    case 'order-offline-refund':
      return buildPendingPanel('线下门店退单', 'order_refunds_offline', '当前退单主链还未从 OpenClaw 完整接入本地查询层。')
    case 'order-online':
      return buildPendingPanel('线上订单', 'online_orders', '线上订单页已完成结构对齐，待接专属订单表。')
    case 'order-online-refund':
      return buildPendingPanel('线上退单', 'order_refunds_online', '线上退单页已完成结构对齐，待接专属退单表。')
    case 'inventory-stock':
      return {
        title: '商品库存主链',
        source: 'live_inventory',
        status: inventory ? 'connected' : 'partial',
        metrics: [
          { label: '库存SKU', value: fmtCount(inventory?.totals?.skuCount), note: '当前库存 SKU 总数' },
          { label: '现有库存', value: fmtCount(inventory?.totals?.currentStock), note: '当前库存数量' },
          { label: '在库SN', value: fmtCount(inventory?.totals?.serialCount), note: '当前在库 SN 数量' },
        ],
        rows: buildStockRows(inventory),
        emptyText: '当前还没有商品库存主链数据。',
      }
    case 'inventory-location':
      return {
        title: '库位库存视图',
        source: 'retail_core.serial_items',
        status: serialItems ? 'connected' : 'partial',
        metrics: [
          { label: '库位数', value: fmtCount(unique((serialItems?.items ?? []).map((item) => item.location_code)).length), note: '按序列号库位编码去重' },
          { label: '仓库数', value: fmtCount(unique((serialItems?.items ?? []).map((item) => item.warehouse_code)).length), note: '按序列号仓库编码去重' },
          { label: '在库SN', value: fmtCount(serialItems?.count), note: '可追溯到库位的序列号' },
        ],
        rows: buildLocationRows(serialItems),
        emptyText: '当前还没有库位库存主链数据。',
      }
    case 'inventory-overview':
      return {
        title: '库存总览视图',
        source: 'product_library.categories + live_inventory',
        status: productCategories || inventory ? 'connected' : 'partial',
        metrics: [
          { label: '分类数', value: fmtCount(productCategories?.count), note: '按产品库分类统计' },
          { label: '库存SKU', value: fmtCount(inventory?.totals?.skuCount), note: '库存主链中的 SKU 总数' },
          { label: '未匹配SN', value: fmtCount(inventory?.totals?.unmatchedSerialCount), note: '库存与序列号未匹配数量' },
        ],
        rows: buildCategoryRows(productCategories),
        emptyText: '当前还没有库存总览分类数据。',
      }
    case 'inventory-movement':
      return {
        title: '库存流水主链',
        source: 'inventory_movements',
        status: movements ? 'connected' : 'partial',
        metrics: [
          { label: '流水行数', value: fmtCount(movements?.records?.length), note: '库存流水记录总数' },
          { label: '销售出库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'sales_outbound').length), note: '销售出库流水行数' },
          { label: '采购入库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'purchase_inbound').length), note: '采购入库流水行数' },
        ],
        rows: buildMovementRows(movements, () => true),
        emptyText: '当前还没有库存流水数据。',
      }
    case 'inventory-stock-order':
      return {
        title: '库存订单视图',
        source: 'inventory_movements by document',
        status: movements ? 'connected' : 'partial',
        metrics: [
          { label: '业务单据', value: fmtCount(unique((movements?.records ?? []).map((item) => item.documentNumber || item.sourceRef)).length), note: '按业务单据号去重' },
          { label: '销售单据', value: fmtCount(unique((movements?.records ?? []).filter((item) => item.movementType === 'sales_outbound').map((item) => item.documentNumber || item.sourceRef)).length), note: '按销售出库单据去重' },
          { label: '采购单据', value: fmtCount(unique((movements?.records ?? []).filter((item) => item.movementType === 'purchase_inbound').map((item) => item.documentNumber || item.sourceRef)).length), note: '按采购入库单据去重' },
        ],
        rows: buildDocumentRows(movements, () => true),
        emptyText: '当前还没有库存订单级数据。',
      }
    case 'inventory-sn-order':
      return {
        title: 'SN 库存订单视图',
        source: 'retail_core.serial_items',
        status: serialItems ? 'connected' : 'partial',
        metrics: [
          { label: 'SN总数', value: fmtCount(serialItems?.count), note: '当前 SN 主链总数' },
          { label: '在保SN', value: fmtCount((serialItems?.items ?? []).filter((item) => item.warranty_status === 'covered').length), note: '当前 warranty_status=covered 的 SN' },
          { label: '可追溯入库单', value: fmtCount((serialItems?.items ?? []).filter((item) => item.inbound_document_no).length), note: '有入库单号的 SN' },
        ],
        rows: buildSerialRows(serialItems),
        emptyText: '当前还没有 SN 台账数据。',
      }
    case 'inventory-cost-price':
      return {
        title: '销售成本价维护视图',
        source: 'live_inventory',
        status: inventory ? 'connected' : 'partial',
        metrics: [
          { label: '有销售成本', value: fmtCount((inventory?.skus ?? []).filter((item) => Number(item.salesCostPrice ?? 0) > 0).length), note: '带 salesCostPrice 的 SKU' },
          { label: '有进货价', value: fmtCount((inventory?.skus ?? []).filter((item) => Number(item.agentPrice ?? 0) > 0).length), note: '带 agentPrice 的 SKU' },
          { label: '库存SKU', value: fmtCount(inventory?.totals?.skuCount), note: '当前库存主链总 SKU' },
        ],
        rows: buildCostRows(inventory),
        emptyText: '当前还没有销售成本价数据。',
      }
    case 'inventory-transfer-out':
      return {
        title: '调拨出库主链',
        source: 'inventory_movements.transfer_outbound',
        status: movements ? 'connected' : 'partial',
        metrics: [
          { label: '调拨出库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'transfer_outbound').length), note: '调拨出库流水行数' },
          { label: '业务单据', value: fmtCount(unique((movements?.records ?? []).filter((item) => item.movementType === 'transfer_outbound').map((item) => item.documentNumber || item.sourceRef)).length), note: '调拨出库单据数' },
          { label: '最近日期', value: fmtDate((movements?.records ?? []).find((item) => item.movementType === 'transfer_outbound')?.businessDate), note: '首条最新记录' },
        ],
        rows: buildDocumentRows(movements, (item) => item.movementType === 'transfer_outbound'),
        emptyText: '当前还没有调拨出库记录。',
      }
    case 'inventory-transfer-in':
      return {
        title: '调拨入库主链',
        source: 'inventory_movements.transfer_inbound',
        status: movements ? 'connected' : 'partial',
        metrics: [
          { label: '调拨入库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'transfer_inbound').length), note: '调拨入库流水行数' },
          { label: '业务单据', value: fmtCount(unique((movements?.records ?? []).filter((item) => item.movementType === 'transfer_inbound').map((item) => item.documentNumber || item.sourceRef)).length), note: '调拨入库单据数' },
          { label: '最近日期', value: fmtDate((movements?.records ?? []).find((item) => item.movementType === 'transfer_inbound')?.businessDate), note: '首条最新记录' },
        ],
        rows: buildDocumentRows(movements, (item) => item.movementType === 'transfer_inbound'),
        emptyText: '当前还没有调拨入库记录。',
      }
    case 'inventory-purchase-in':
      return {
        title: '采购入库主链',
        source: 'inventory_movements.purchase_inbound',
        status: movements ? 'connected' : 'partial',
        metrics: [
          { label: '采购入库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'purchase_inbound').length), note: '采购入库流水行数' },
          { label: '单据数', value: fmtCount(unique((movements?.records ?? []).filter((item) => item.movementType === 'purchase_inbound').map((item) => item.documentNumber || item.sourceRef)).length), note: '采购入库单据数' },
          { label: '带供应商', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'purchase_inbound' && item.supplierName).length), note: '已带供应商字段的流水行数' },
        ],
        rows: buildDocumentRows(movements, (item) => item.movementType === 'purchase_inbound'),
        emptyText: '当前还没有采购入库记录。',
      }
    case 'inventory-other-io':
      return buildPendingPanel('其他出入库', 'other_inout_documents / other_inout_lines', '其他出入库专属表仍待 OpenClaw 完整接入。')
    case 'inventory-location-move':
      return buildPendingPanel('同店换库位', 'same_store_location_change / same_store_location_change_lines', '同店换库位专属表仍待 OpenClaw 完整接入。')
    case 'inventory-config-center':
      return buildPendingPanel('库存配置', 'inventory_config', '库存配置页先保留同构结构，后续再接配置主档。')
    case 'account-employee':
      return buildPendingPanel('员工账号', 'staff accounts / roles', '员工账号与角色表当前未开放到本地 API。')
    case 'account-target':
      return buildPendingPanel('业绩目标', 'performance target', '业绩目标表当前未开放到本地 API。')
    case 'device-pos-manage':
      return buildPendingPanel('POS管理', 'pos devices', 'POS 终端台账当前未开放到本地 API。')
    case 'finance-pay-manage':
      return {
        title: '支付管理过渡视图',
        source: 'retail_core.sales_orders',
        status: salesOrders ? 'partial' : 'pending',
        metrics: [
          { label: '支付订单', value: fmtCount(salesOrders?.count), note: '当前先用销售订单作为支付链过渡视图' },
          { label: '客户数', value: fmtCount(customers?.count), note: '支付主体可从客户维度回溯' },
          { label: '待正式接入', value: '支付渠道', note: '支付渠道与支付主体表待开放' },
        ],
        rows: buildSalesOrderRows(salesOrders),
        emptyText: '当前还没有支付管理专属数据表。',
      }
    case 'finance-self-signing':
      return buildPendingPanel('自助签约', 'self signing / contract status', '签约主体与开通状态当前未开放到本地 API。')
    case 'finance-balance':
      return buildPendingPanel('可用金', 'balance / usable cash', '可用金与余额表当前未开放到本地 API。')
    case 'report-payment':
      return {
        title: '支付统计过渡视图',
        source: 'retail_core.sales_orders',
        status: salesOrders ? 'partial' : 'pending',
        metrics: [
          { label: '销售订单', value: fmtCount(salesOrders?.count), note: '当前用销售订单做支付统计过渡' },
          { label: '客户数', value: fmtCount(customers?.count), note: '客户支付主体数' },
          { label: '最近业务日', value: fmtDate(salesOrders?.items?.[0]?.business_date), note: '统计窗口参考' },
        ],
        rows: buildSalesOrderRows(salesOrders),
        emptyText: '当前还没有支付统计专属报表数据。',
      }
    case 'report-product':
      return {
        title: '商品统计视图',
        source: 'product_library.categories + live_inventory',
        status: productCategories || inventory ? 'connected' : 'partial',
        metrics: [
          { label: '分类数', value: fmtCount(productCategories?.count), note: '当前商品分类数' },
          { label: '库存SKU', value: fmtCount(inventory?.totals?.skuCount), note: '库存主链中的 SKU 数量' },
          { label: '产品主档', value: fmtCount(productOverview?.productMasterCount), note: '产品主档数量' },
        ],
        rows: buildCategoryRows(productCategories),
        emptyText: '当前还没有商品统计数据。',
      }
    case 'report-sales-analysis':
      return {
        title: '销售分析过渡视图',
        source: 'retail_core.sales_orders + inventory_movements',
        status: salesOrders || movements ? 'connected' : 'partial',
        metrics: [
          { label: '销售订单', value: fmtCount(salesOrders?.count), note: '销售订单总数' },
          { label: '销售出库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'sales_outbound').length), note: '销售出库流水行数' },
          { label: '采购入库', value: fmtCount((movements?.records ?? []).filter((item) => item.movementType === 'purchase_inbound').length), note: '采购入库流水行数' },
        ],
        rows: buildSalesOrderRows(salesOrders),
        emptyText: '当前还没有销售分析专属报表数据。',
      }
    case 'report-sales-daily':
      return {
        title: '销售日报视图',
        source: 'retail_core.sales_orders',
        status: salesOrders ? 'connected' : 'partial',
        metrics: [
          { label: '日报天数', value: fmtCount(unique((salesOrders?.items ?? []).map((item) => String(item.business_date).slice(0, 10))).length), note: '当前销售订单涉及的业务日期数' },
          { label: '订单总数', value: fmtCount(salesOrders?.count), note: '销售订单总量' },
          { label: '客户总数', value: fmtCount(customers?.count), note: '客户覆盖数' },
        ],
        rows: buildDailySalesRows(salesOrders),
        emptyText: '当前还没有销售日报数据。',
      }
    case 'report-sn-valid':
      return {
        title: 'SN 有效销量合规视图',
        source: 'retail_core.sn_sales_compliance',
        status: snSalesCompliance?.count ? 'connected' : 'pending',
        metrics: [
          { label: '合规记录', value: fmtCount(snSalesCompliance?.summary.totalCount), note: '按 SN 聚合的有效销量合规记录' },
          { label: '合规通过', value: fmtCount(snSalesCompliance?.summary.compliantCount), note: '链路完整且资格通过' },
          { label: '人工复核', value: fmtCount(snSalesCompliance?.summary.manualReviewCount), note: '仍需补外部资格证据' },
          { label: '待申领金额', value: fmtPrice(snSalesCompliance?.summary.claimableAmount), note: 'PO / 教育补 / 价保合计口径' },
        ],
        rows: buildSnComplianceRows(snSalesCompliance),
        emptyText: '当前还没有 SN 有效销量合规数据；先检查 `/api/retail-core/sn-sales-compliance` 是否已刷新。',
      }
    default:
      return buildPendingPanel('待接入', 'submenu.pending', '当前子菜单还没有配置数据映射。')
  }
}
