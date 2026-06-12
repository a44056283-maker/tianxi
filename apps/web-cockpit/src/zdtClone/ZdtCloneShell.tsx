import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Building2,
  ChevronDown,
  ExternalLink,
  FileDown,
  Pencil,
  CreditCard,
  HardDrive,
  LayoutGrid,
  MonitorSmartphone,
  Package2,
  Users2,
  X,
} from 'lucide-react'
import './zdtReplica.css'
import { zdtTopMenus, type ZdtSubmenuItem, type ZdtTopMenu, type ZdtTopMenuKey } from './zdtMenuConfig'
import { buildZdtSubmenuLivePanel, type ZdtLivePreviewRow } from './zdtSubmenuLiveData'
import { zdtSubmenuReplicaSpecByLabel } from './zdtReplicaSpec'
import { buildZdtOpenclawReplicaBinding, type ZdtReplicaRow, type ZdtReplicaSection } from './zdtOpenclawReplicaBinding'
import {
  getOpenClawCommandBoardSnapshot,
  getOpenClawReceiptSnapshot,
  getInventoryMovementsSnapshot,
  getLiveInventorySnapshot,
  getProductLibraryProduct,
  getProductLibraryCategories,
  getProductLibraryOverview,
  getProductLibraryProducts,
  getPublishedProductProjectionSnapshot,
  getRetailCoreCustomers,
  getRetailCoreMovements,
  getRetailCoreSalesOrders,
  getRetailCoreSerialItems,
  getRetailCoreStatus,
  getSnSalesComplianceSnapshot,
  getZdtOpenclawBridgeSnapshot,
  type InventoryMovementsSnapshot,
  type OpenClawCommandBoardSnapshot,
  type OpenClawReceiptSnapshot,
  type ProductLibraryCategorySummarySnapshot,
  type ProductLibraryDetail,
  type ProductLibraryOverview,
  type ProductLibraryProductsSnapshot,
  type PublishedProductProjectionSnapshot,
  type RetailCoreCustomers,
  type RetailCoreMovements,
  type RetailCoreSalesOrders,
  type RetailCoreSerialItems,
  type RetailCoreStatus,
  type SnSalesComplianceSnapshot,
  type StandardInventorySnapshot,
  type ZdtOpenclawBridgeSnapshot,
} from '../domain/inventoryQuote/service'

const topMenuIcons: Record<ZdtTopMenuKey, typeof Building2> = {
  organization: Building2,
  product: Package2,
  order: LayoutGrid,
  inventory: HardDrive,
  account: Users2,
  device: MonitorSmartphone,
  finance: CreditCard,
  report: BarChart3,
}

const DATE_PRESETS = ['今天', '近3天', '近7天', '近30天', '本月', '全部'] as const
type DatePreset = typeof DATE_PRESETS[number]

type ZdtDialogMode = 'view' | 'edit' | 'action'
type ZdtActionDialog = {
  title: string
  mode: ZdtDialogMode
  actionLabel: string
  hasRowContext: boolean
  buttons: string[]
  submitLabel?: string
  confirmLabel?: string
  successMessage?: string
  sections: Array<{
    heading?: string
    fields: Array<{ label: string; value: string }>
  }>
}

type ZdtDialogReceipt = {
  receiptId: string
  actionLabel: string
  topMenuLabel: string
  submenuLabel: string
  operator: string
  executedAt: string
  targetName: string
  summary: string
  fields: Array<{ label: string; value: string }>
  logs: string[]
}

type ZdtSummaryMetric = {
  label: string
  value: string
}

type RenderRow = {
  id: string
  cells: string[]
  searchableText: string
  actionLabels: string[]
  meta?: {
    orderNo?: string
    externalOrderNo?: string
    orderId?: string
    customerName?: string
    customerPhone?: string
    orderSource?: string
    orderStatus?: string
    paidAmount?: string
    orderCount?: string
    deliveryStation?: string
    courier?: string
    note?: string
    productSource?: string
    productCategory?: string
    productType?: string
    productCode?: string
    productStatus?: string
    salesChannel?: string
    updatedAt?: string
    productId?: string
    sourceConfidence?: string
    currentStock?: string
    sellableStock?: string
    serialCount?: string
    skuKey?: string
    skuCode?: string
    productName?: string
    pnMtm?: string
    spec?: string
    organizationCode?: string
    organizationName?: string
  }
}

type FilterControl = {
  key: string
  label: string
  kind: 'select' | 'text' | 'date'
  prominent?: boolean
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function resolveDateRange(preset: DatePreset) {
  const now = new Date()
  const end = toDateInputValue(now)
  if (preset === '全部') return { start: '', end: '' }
  if (preset === '今天') return { start: end, end }
  if (preset === '本月') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: toDateInputValue(start), end }
  }
  const days = preset === '近3天' ? 2 : preset === '近7天' ? 6 : 29
  const start = new Date(now)
  start.setDate(now.getDate() - days)
  return { start: toDateInputValue(start), end }
}

function extractComparableDate(value: string) {
  const match = value.match(/(\d{4})[-/](\d{2})[-/](\d{2})/)
  if (!match) return ''
  return `${match[1]}-${match[2]}-${match[3]}`
}

function getFirstSubmenu(menu: ZdtTopMenu): ZdtSubmenuItem {
  return menu.groups[0].items[0]
}

function findTopMenuBySubmenuKey(submenuKey: string) {
  return zdtTopMenus.find((topMenu) =>
    topMenu.groups.some((group) => group.items.some((item) => item.key === submenuKey)),
  ) ?? null
}

function normalizeQuerySubmenuKey(submenuKey: string | null) {
  if (!submenuKey) return null
  const aliases: Record<string, string> = {
    'product-dealer': 'product-city',
  }
  return aliases[submenuKey] ?? submenuKey
}

function resolveInitialCloneRoute() {
  if (typeof window === 'undefined') {
    return {
      topMenuKey: zdtTopMenus[0].key,
      submenuKey: getFirstSubmenu(zdtTopMenus[0]).key,
      dialogAction: null as string | null,
      dialogRowIndex: null as number | null,
    }
  }
  const url = new URL(window.location.href)
  const queryTop = url.searchParams.get('top')
  const querySubmenu = normalizeQuerySubmenuKey(url.searchParams.get('submenu'))
  const queryDialogAction = url.searchParams.get('dialogAction')
  const dialogRowRaw = url.searchParams.get('dialogRow')
  const dialogRowIndex = dialogRowRaw !== null && /^\d+$/.test(dialogRowRaw) ? Number(dialogRowRaw) : null
  const topMenuFromSubmenu = querySubmenu ? findTopMenuBySubmenuKey(querySubmenu) : null
  const resolvedTopMenu = topMenuFromSubmenu
    ?? zdtTopMenus.find((item) => item.key === queryTop)
    ?? zdtTopMenus[0]
  const resolvedSubmenu = querySubmenu
    && resolvedTopMenu.groups.some((group) => group.items.some((item) => item.key === querySubmenu))
      ? querySubmenu
      : getFirstSubmenu(resolvedTopMenu).key
  return {
    topMenuKey: resolvedTopMenu.key,
    submenuKey: resolvedSubmenu,
    dialogAction: queryDialogAction,
    dialogRowIndex,
  }
}

function isDateLikeField(value: string) {
  return /(开始|结束|日期|时间|范围)/.test(value)
}

function uniqueOrdered(values: string[]) {
  return values.filter((value, index) => value && values.indexOf(value) === index)
}

function sanitizeActionLabels(labels: string[]) {
  return labels
    .map((label) => label.replace(/^\d+(?=\D)/, '').trim())
    .filter((label) => {
      const value = label.trim()
      if (!value) return false
      if (/^\d+$/.test(value)) return false
      if (/^(XS|CGR|DB|RK|CK|TH|PO)?\d{8,}$/.test(value)) return false
      if (/^\d{10,}$/.test(value)) return false
      return true
    })
}

function buildOrganizationPageRows(
  inventory: StandardInventorySnapshot | null,
  salesOrders: RetailCoreSalesOrders | null,
): RenderRow[] {
  const firstOrder = salesOrders?.items?.find((item) => item.shop_name || item.store_code)
  const shopName = resolveDefaultOrganizationName(inventory, salesOrders)
  const shopCode = resolveDefaultOrganizationCode(inventory, salesOrders)
  return [{
    id: 'organization-shop-default',
    cells: [shopName, String(shopCode), shopName, '--', '--', '--', '门店', '启用', '--'],
    searchableText: [shopName, shopCode].join(' '),
    actionLabels: ['查看'],
    meta: {
      organizationName: shopName,
      organizationCode: String(shopCode),
      orderSource: firstOrder?.channel_type_name ?? '',
    },
  }]
}

function resolveDefaultOrganizationName(
  inventory: StandardInventorySnapshot | null,
  salesOrders: RetailCoreSalesOrders | null,
) {
  const isCodeLikeName = (value: string) => (
    !/[\u4e00-\u9fa5]/.test(value)
    && (/^STORE(?:[-_A-Z0-9]+)?$/i.test(value) || /^[A-Z]{2,}\d*$/i.test(value) || /^D\d+$/i.test(value) || /^[A-Z]?\d{6,}$/i.test(value))
  )
  const firstReadableShopName = salesOrders?.items
    ?.map((item) => item.shop_name?.trim())
    .find((value) => value && !isCodeLikeName(value))
  const inventoryName = inventory?.skus?.find((item) => item.organizationName)?.organizationName
  const firstOrder = salesOrders?.items?.find((item) => item.shop_name || item.store_code)
  const fallbackStoreCode = firstOrder?.store_code?.trim()
  if (firstReadableShopName) return firstReadableShopName
  if (inventoryName?.trim() && !isCodeLikeName(inventoryName.trim())) return inventoryName.trim()
  if (fallbackStoreCode && !isCodeLikeName(fallbackStoreCode)) {
    return fallbackStoreCode
  }
  return '联想体验店（新野县书院路）'
}

function resolveDefaultOrganizationCode(
  inventory: StandardInventorySnapshot | null,
  salesOrders: RetailCoreSalesOrders | null,
) {
  return salesOrders?.items?.find((item) => item.shop_id)?.shop_id
    ?? salesOrders?.items?.find((item) => item.store_code)?.store_code
    ?? inventory?.skus?.find((item) => item.organizationCode)?.organizationCode
    ?? '--'
}

function buildWarehousePageRows(serialItems: RetailCoreSerialItems | null): RenderRow[] {
  const firstWarehouse = serialItems?.items?.find((item) => item.warehouse_code || item.location_code)
  const warehouseName = firstWarehouse?.warehouse_code ?? firstWarehouse?.location_code ?? '销售库'
  return [{
    id: 'organization-warehouse-default',
    cells: [warehouseName, warehouseName, '--', '--', '--', '--', '启用', '--'],
    searchableText: warehouseName,
    actionLabels: ['查看'],
    meta: {
      organizationName: warehouseName,
      organizationCode: warehouseName,
    },
  }]
}

function buildOrderPageRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  return (salesOrders?.items ?? []).slice(0, 120).map((order) => ({
    id: `order-page-${order.id}`,
    cells: [
      order.lines?.[0]?.product_name ?? order.lines?.[0]?.sku_key ?? order.order_no ?? order.order_number ?? '--',
      [order.customer_name, order.external_order_no].filter(Boolean).join(' / ') || '--',
      order.created_time ?? order.business_date ?? '--',
      order.pay_time ?? order.operate_time ?? '--',
      order.shop_name ?? order.store_code ?? '--',
      '--',
      formatCellValue(order.total_amount),
      order.status_name ?? order.status ?? '--',
      order.channel_type_name ?? order.order_type_name ?? '--',
      '--',
    ],
    searchableText: [
      order.order_no,
      order.order_number,
      order.external_order_no,
      order.customer_name,
      order.shop_name,
      order.store_code,
      order.lines?.[0]?.product_name,
    ].filter(Boolean).join(' '),
    actionLabels: ['查看详情', '订单备注'],
    meta: {
      orderNo: order.order_no ?? order.order_number ?? '',
      externalOrderNo: order.external_order_no ?? '',
      orderId: order.id ? String(order.id) : '',
      customerName: order.customer_name ?? '',
      customerPhone: '',
      orderSource: order.channel_type_name ?? order.order_type_name ?? '',
      orderStatus: order.status_name ?? order.status ?? '',
      paidAmount: formatCellValue(order.total_amount),
      deliveryStation: '',
      courier: '',
      note: order.note ?? '',
      productName: order.lines?.[0]?.product_name ?? '',
      skuKey: order.lines?.[0]?.sku_key ?? '',
      pnMtm: order.lines?.[0]?.mtm_code ?? '',
      spec: order.lines?.[0]?.spec ?? '',
      organizationCode: order.store_code ?? '',
      organizationName: order.shop_name ?? '',
    },
  }))
}

function buildOnlineOrderRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  return (salesOrders?.items ?? [])
    .filter((order) => (order.order_type_name || '') === '线上订单' && (order.status_name || order.status) !== '已退货')
    .slice(0, 120)
    .map((order) => ({
      id: `online-order-${order.id}`,
      cells: [
        order.lines?.[0]?.product_name ?? order.lines?.[0]?.sku_key ?? order.id ?? '--',
        [order.customer_name, order.external_order_no].filter(Boolean).join(' / ') || '--',
        order.created_time ?? order.business_date ?? '--',
        order.pay_time ?? order.operate_time ?? '--',
        order.shop_name ?? order.store_code ?? '--',
        formatCellValue(order.total_amount),
        order.status_name ?? order.status ?? '--',
        order.amount_status ?? '--',
        order.cashier_name ?? '--',
        order.channel_type_name ?? order.order_type_name ?? '--',
      ],
      searchableText: [
        order.id,
        order.external_order_no,
        order.customer_name,
        order.shop_name,
        order.store_code,
        order.channel_type_name,
        order.lines?.[0]?.product_name,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看详情'],
      meta: {
        orderNo: order.id,
        externalOrderNo: order.external_order_no ?? '',
        orderId: order.id,
        customerName: order.customer_name ?? '',
        customerPhone: '',
        orderSource: order.channel_type_name ?? order.order_type_name ?? '',
        orderStatus: order.status_name ?? order.status ?? '',
        paidAmount: formatCellValue(order.total_amount),
        deliveryStation: '',
        courier: '',
        note: order.note ?? '',
        productName: order.lines?.[0]?.product_name ?? '',
        skuKey: order.lines?.[0]?.sku_key ?? '',
        pnMtm: order.lines?.[0]?.mtm_code ?? '',
        spec: order.lines?.[0]?.spec ?? '',
        organizationCode: order.store_code ?? '',
        organizationName: order.shop_name ?? '',
      },
    }))
}

function buildOnlineRefundRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  return (salesOrders?.items ?? [])
    .filter((order) => (order.order_type_name || '') === '线上订单' && (order.status_name || order.status) === '已退货')
    .slice(0, 120)
    .map((order) => ({
      id: `online-refund-${order.id}`,
      cells: [
        order.lines?.[0]?.product_name ?? order.lines?.[0]?.sku_key ?? order.id ?? '--',
        order.business_date ?? '--',
        formatCellValue(order.total_quantity ?? order.lines?.[0]?.quantity ?? '--'),
        formatCellValue(order.total_amount),
        order.status_name ?? order.status ?? '--',
        order.channel_type_name ?? order.order_type_name ?? '--',
        order.shop_name ?? order.store_code ?? '--',
      ],
      searchableText: [
        order.id,
        order.external_order_no,
        order.shop_name,
        order.store_code,
        order.channel_type_name,
        order.lines?.[0]?.product_name,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看详情'],
      meta: {
        orderNo: order.id,
        externalOrderNo: order.external_order_no ?? '',
        orderId: order.id,
        customerName: order.customer_name ?? '',
        orderSource: order.channel_type_name ?? order.order_type_name ?? '',
        orderStatus: order.status_name ?? order.status ?? '',
        paidAmount: formatCellValue(order.total_amount),
        note: order.note ?? '',
        productName: order.lines?.[0]?.product_name ?? '',
        skuKey: order.lines?.[0]?.sku_key ?? '',
        pnMtm: order.lines?.[0]?.mtm_code ?? '',
        spec: order.lines?.[0]?.spec ?? '',
        organizationCode: order.store_code ?? '',
        organizationName: order.shop_name ?? '',
      },
    }))
}

function buildOfflineRefundRows(movements: RetailCoreMovements | null): RenderRow[] {
  return (movements?.items ?? [])
    .filter((item) =>
      item.movement_type === 'transfer_inbound'
      && (/退单|退货|原销售单/.test(item.note ?? '') || (item.source_ref ?? '').startsWith('RTN-')),
    )
    .slice(0, 120)
    .map((item, index) => ({
      id: `offline-refund-${item.id}-${index}`,
      cells: [
        item.product_name ?? '--',
        item.serial_number ?? item.source_ref ?? '--',
        item.shop_name ?? item.store_name ?? '--',
        item.source_document_type ?? item.service_type_name ?? '--',
        '线下门店退单',
        item.operator_name ?? '--',
        formatCellValue(item.amount ?? item.unit_cost ?? item.quantity),
        item.serial_number ? '是' : '否',
        item.business_date ?? '--',
        '已完成',
      ],
      searchableText: [
        item.id,
        item.source_ref,
        item.product_name,
        item.shop_name,
        item.store_name,
        item.note,
        item.serial_number,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看'],
      meta: {
        orderNo: item.source_ref ?? item.id,
        externalOrderNo: item.id,
        orderStatus: '已完成',
        orderSource: item.source_document_type ?? item.service_type_name ?? '线下门店退单',
        paidAmount: formatCellValue(item.amount ?? item.unit_cost ?? item.quantity),
        note: item.note ?? '',
        productName: item.product_name ?? '',
        skuKey: item.sku_key ?? '',
        pnMtm: item.pn_mtm ?? '',
        spec: item.spec ?? '',
        organizationCode: item.store_name ?? '',
        organizationName: item.shop_name ?? item.store_name ?? '',
      },
    }))
}

function buildOfflineRefundSnapshotRows(movements: InventoryMovementsSnapshot | null): RenderRow[] {
  return (movements?.records ?? [])
    .filter((item) =>
      item.movementType === 'transfer_inbound'
      && (/退单|退货|原销售单/.test(item.note ?? '') || (item.documentNumber ?? item.sourceRef ?? '').startsWith('RTN-')),
    )
    .slice(0, 120)
    .map((item, index) => ({
      id: `offline-refund-snapshot-${item.id}-${index}`,
      cells: [
        item.productName ?? '--',
        item.serialNumber ?? item.documentNumber ?? item.sourceRef ?? '--',
        item.storeName ?? '--',
        item.sourceDocumentType ?? item.movementType ?? '--',
        '线下门店退单',
        item.operatorName ?? '--',
        formatCellValue(item.purchaseCost ?? item.quantity),
        item.serialNumber ? '是' : '否',
        item.businessDate ?? '--',
        '已完成',
      ],
      searchableText: [
        item.id,
        item.documentNumber,
        item.sourceRef,
        item.productName,
        item.storeName,
        item.note,
        item.serialNumber,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看'],
      meta: {
        orderNo: item.documentNumber ?? item.sourceRef ?? item.id,
        externalOrderNo: item.id,
        orderStatus: '已完成',
        orderSource: item.sourceDocumentType ?? item.movementType ?? '线下门店退单',
        paidAmount: formatCellValue(item.purchaseCost ?? item.quantity),
        note: item.note ?? '',
        productName: item.productName ?? '',
        skuKey: item.skuKey ?? '',
        pnMtm: item.pnMtm ?? '',
        spec: item.spec ?? '',
        organizationCode: item.storeName ?? '',
        organizationName: item.storeName ?? '',
      },
    }))
}

function parseSerialNumbersFromOrderLine(line: Record<string, unknown>) {
  const directSerial = typeof line.serial_number === 'string' && line.serial_number.trim() ? [line.serial_number.trim()] : []
  const raw = line.serial_numbers_json
  if (typeof raw !== 'string' || !raw.trim()) return directSerial
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return directSerial
    return [...new Set([...directSerial, ...parsed.map((item) => String(item).trim()).filter(Boolean)])]
  } catch {
    return directSerial
  }
}

function buildPaymentReportRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  const defaultOrganizationName = resolveDefaultOrganizationName(null, salesOrders)
  const grouped = new Map<string, {
    shopName: string
    channel: string
    received: number
    orderCount: number
    refundedAmount: number
    refundCount: number
    completedOrderCount: number
  }>()
  for (const order of salesOrders?.items ?? []) {
    const rawShopName = String(order.shop_name ?? order.store_code ?? '--')
    const shopName =
      rawShopName
        && !/[\u4e00-\u9fa5]/.test(rawShopName)
        && (/^STORE(?:[-_A-Z0-9]+)?$/i.test(rawShopName) || /^[A-Z]{2,}\d*$/i.test(rawShopName) || /^D\d+$/i.test(rawShopName))
        ? defaultOrganizationName
        : rawShopName
    const channel = order.channel_type_name ?? order.order_type_name ?? '--'
    const key = `${shopName}::${channel}`
    const current = grouped.get(key) ?? {
      shopName,
      channel,
      received: 0,
      orderCount: 0,
      refundedAmount: 0,
      refundCount: 0,
      completedOrderCount: 0,
    }
    const orderPayment = order as RetailCoreSalesOrders['items'][number] & { pay_amount?: number | null }
    const amount = Number(orderPayment.pay_amount ?? order.total_amount ?? 0) || 0
    current.orderCount += 1
    if ((order.status_name ?? order.status) === '已退货') {
      current.refundedAmount += amount
      current.refundCount += 1
    } else {
      current.received += amount
      current.completedOrderCount += 1
    }
    grouped.set(key, current)
  }
  return Array.from(grouped.values())
    .sort((left, right) => right.received - left.received)
    .slice(0, 120)
    .map((item, index) => ({
      id: `report-payment-${index}-${item.shopName}-${item.channel}`,
      cells: [
        item.shopName,
        item.channel,
        formatAmountDisplay(item.received),
        formatCellValue(item.completedOrderCount),
        formatAmountDisplay(item.refundedAmount),
        formatCellValue(item.refundCount),
        formatAmountDisplay(0),
        formatAmountDisplay(item.received - item.refundedAmount),
        formatCellValue(item.completedOrderCount),
        formatCellValue(item.refundCount),
      ],
      searchableText: [item.shopName, item.channel].filter(Boolean).join(' '),
      actionLabels: [],
    }))
}

function buildProductReportRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  const grouped = new Map<string, {
    category: string
    productName: string
    pnMtm: string
    spec: string
    qty: number
    refundQty: number
    orderCount: number
    validOrderCount: number
    refundOrderCount: number
    dealAmount: number
    paidAmount: number
    discountAmount: number
    costAmount: number
  }>()
  for (const order of salesOrders?.items ?? []) {
    const isRefund = (order.status_name ?? order.status) === '已退货'
    for (const rawLine of order.lines ?? []) {
      const line = rawLine as Record<string, unknown>
      const skuKey = String(line.sku_key ?? line.sku_no ?? '')
      const key = skuKey || `${line.product_name ?? ''}-${line.mtm_code ?? ''}-${line.spec ?? ''}`
      const quantity = Number(line.quantity ?? 0) || 0
      const dealAmount = Number(line.deal_amount ?? line.pay_amount ?? line.deal_price ?? 0) || 0
      const discountAmount = Number(line.discount_amount ?? 0) || 0
      const unitCost = Number(line.unit_cost ?? 0) || 0
      const current = grouped.get(key) ?? {
        category: skuKey.startsWith('2') ? '商品' : '--',
        productName: String(line.product_name ?? skuKey ?? '--'),
        pnMtm: String(line.mtm_code ?? '--'),
        spec: String(line.spec ?? '--'),
        qty: 0,
        refundQty: 0,
        orderCount: 0,
        validOrderCount: 0,
        refundOrderCount: 0,
        dealAmount: 0,
        paidAmount: 0,
        discountAmount: 0,
        costAmount: 0,
      }
      current.qty += quantity
      current.orderCount += 1
      current.dealAmount += dealAmount
      current.paidAmount += dealAmount
      current.discountAmount += discountAmount
      current.costAmount += unitCost * quantity
      if (isRefund) {
        current.refundQty += quantity
        current.refundOrderCount += 1
      } else {
        current.validOrderCount += 1
      }
      grouped.set(key, current)
    }
  }
  return Array.from(grouped.values())
    .sort((left, right) => right.dealAmount - left.dealAmount)
    .slice(0, 120)
    .map((item, index) => {
      const grossProfit = item.dealAmount - item.costAmount
      const grossRate = item.dealAmount > 0 ? (grossProfit / item.dealAmount) * 100 : 0
      return {
        id: `report-product-${index}-${item.pnMtm}`,
        cells: [
          item.category,
          item.productName,
          item.pnMtm,
          item.spec,
          '台',
          formatCellValue(item.qty - item.refundQty),
          formatCellValue(item.refundQty),
          formatCellValue(item.qty),
          formatCellValue(item.orderCount),
          formatCellValue(item.validOrderCount),
          formatCellValue(item.refundOrderCount),
          formatAmountDisplay(item.qty ? item.dealAmount / item.qty : 0),
          formatAmountDisplay(item.dealAmount),
          formatAmountDisplay(item.discountAmount),
          formatAmountDisplay(item.qty ? item.costAmount / item.qty : 0),
          formatAmountDisplay(item.costAmount),
          formatAmountDisplay(grossProfit),
          formatAmountDisplay(grossRate),
          '--',
          '--',
          '--',
          formatAmountDisplay(item.validOrderCount ? grossProfit / item.validOrderCount : 0),
          formatAmountDisplay(item.paidAmount),
          formatAmountDisplay(item.qty ? item.paidAmount / item.qty : 0),
        ],
        searchableText: [item.category, item.productName, item.pnMtm, item.spec].filter(Boolean).join(' '),
        actionLabels: [],
      }
    })
}

function buildSalesAnalysisRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  const defaultOrganizationName = resolveDefaultOrganizationName(null, salesOrders)
  const rows: RenderRow[] = []
  for (const order of salesOrders?.items ?? []) {
    for (const rawLine of order.lines ?? []) {
      const line = rawLine as Record<string, unknown>
      const quantity = Number(line.quantity ?? 0) || 0
      const paidAmount = Number(line.pay_amount ?? line.deal_amount ?? line.deal_price ?? 0) || 0
      const unitPrice = Number(line.unit_price ?? line.deal_price ?? 0) || 0
      const costUnit = Number(line.unit_cost ?? 0) || 0
      const totalCost = costUnit * quantity
      const grossProfit = paidAmount - totalCost
      const grossRate = paidAmount > 0 ? (grossProfit / paidAmount) * 100 : 0
      const serialNumbers = parseSerialNumbersFromOrderLine(line)
      const rawShopName = String(order.shop_name ?? order.store_code ?? '--')
      const shopName =
        rawShopName
          && !/[\u4e00-\u9fa5]/.test(rawShopName)
          && (/^STORE(?:[-_A-Z0-9]+)?$/i.test(rawShopName) || /^[A-Z]{2,}\d*$/i.test(rawShopName) || /^D\d+$/i.test(rawShopName))
          ? defaultOrganizationName
          : rawShopName
      rows.push({
        id: `report-sales-analysis-${order.id}-${String(line.id ?? line.sku_key ?? rows.length)}`,
        cells: [
          order.order_no ?? order.order_number ?? order.id,
          order.business_date ?? order.created_time ?? '--',
          '--',
          shopName,
          String(line.mtm_code ?? '--'),
          String(line.product_name ?? '--'),
          order.channel_type_name ?? order.order_type_name ?? '--',
          formatCellValue(quantity),
          formatAmountDisplay(unitPrice),
          formatAmountDisplay(quantity ? paidAmount / quantity : 0),
          formatAmountDisplay(paidAmount),
          formatAmountDisplay(Number(line.discount_amount ?? 0) || 0),
          formatAmountDisplay(paidAmount),
          formatAmountDisplay(costUnit),
          formatAmountDisplay(totalCost),
          formatAmountDisplay(grossProfit),
          formatAmountDisplay(grossRate),
          order.channel_type_name ?? '--',
          order.order_type_name ?? '--',
          String(line.spec ?? '--'),
          serialNumbers.join(', ') || '--',
          order.cashier_name ?? order.operator_id ?? '--',
          order.note ?? '--',
        ],
        searchableText: [
          order.order_no,
          order.shop_name,
          line.product_name,
          line.mtm_code,
          line.spec,
          serialNumbers.join(' '),
          order.cashier_name,
        ].filter(Boolean).join(' '),
        actionLabels: [],
      })
    }
  }
  return rows.slice(0, 120)
}

function buildSalesDailyRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  const grouped = new Map<string, {
    date: string
    shopName: string
    orderCount: number
    validOrderCount: number
    refundOrderCount: number
    quantity: number
    salesAmount: number
    discountAmount: number
    paidAmount: number
    costAmount: number
  }>()
  for (const order of salesOrders?.items ?? []) {
    const date = String(order.business_date ?? order.created_time ?? '--').slice(0, 10)
    const shopName = order.shop_name ?? order.store_code ?? '--'
    const key = `${date}::${shopName}`
    const current = grouped.get(key) ?? {
      date,
      shopName,
      orderCount: 0,
      validOrderCount: 0,
      refundOrderCount: 0,
      quantity: 0,
      salesAmount: 0,
      discountAmount: 0,
      paidAmount: 0,
      costAmount: 0,
    }
    current.orderCount += 1
    const isRefund = (order.status_name ?? order.status) === '已退货'
    if (isRefund) current.refundOrderCount += 1
    else current.validOrderCount += 1
    for (const rawLine of order.lines ?? []) {
      const line = rawLine as Record<string, unknown>
      const quantity = Number(line.quantity ?? 0) || 0
      const paidAmount = Number(line.pay_amount ?? line.deal_amount ?? line.deal_price ?? 0) || 0
      const discountAmount = Number(line.discount_amount ?? 0) || 0
      const costUnit = Number(line.unit_cost ?? 0) || 0
      current.quantity += quantity
      current.salesAmount += paidAmount
      current.discountAmount += discountAmount
      current.paidAmount += paidAmount
      current.costAmount += costUnit * quantity
    }
    grouped.set(key, current)
  }
  return Array.from(grouped.values())
    .sort((left, right) => String(right.date).localeCompare(String(left.date)) || right.paidAmount - left.paidAmount)
    .slice(0, 120)
    .map((item, index) => {
      const grossProfit = item.paidAmount - item.costAmount
      const grossRate = item.paidAmount > 0 ? (grossProfit / item.paidAmount) * 100 : 0
      return {
        id: `report-sales-daily-${index}-${item.date}-${item.shopName}`,
        cells: [
          item.date,
          item.shopName,
          formatCellValue(item.orderCount),
          formatCellValue(item.validOrderCount),
          formatCellValue(item.refundOrderCount),
          formatCellValue(item.quantity),
          formatCellValue(item.salesAmount),
          formatCellValue(item.discountAmount),
          formatCellValue(item.paidAmount),
          formatCellValue(item.costAmount),
          formatCellValue(grossProfit),
          formatCellValue(grossRate),
        ],
        searchableText: [item.date, item.shopName].join(' '),
        actionLabels: [],
      }
    })
}

function buildSnValidSalesRows(snSalesCompliance: SnSalesComplianceSnapshot | null): RenderRow[] {
  return (snSalesCompliance?.items ?? [])
    .slice()
    .sort((left, right) => String(right.salesDate || right.outboundDate || '').localeCompare(String(left.salesDate || left.outboundDate || '')))
    .slice(0, 240)
    .map((item, index) => {
      const isValidSales = item.validation.isValidSalesCandidate && item.validation.chainComplete
      const isPoCompliant = item.validation.poCompliant && item.validation.poEligible
      const lockStatus = item.manualReview?.required ? '否' : item.status === 'compliant_pass' ? '是' : '待核'
      const firstSaleStatus = item.validation.chainComplete && !item.validation.hasTransferOrOtherOutbound ? '是' : '待核'
      const processSummary = [
        item.validation.chainComplete ? '链路完整' : '链路未闭合',
        item.validation.hasOpenSyncGap ? '存在同步缺口' : null,
        item.validation.hasStockConflict ? '存在库存冲突' : null,
      ].filter(Boolean).join(' / ') || '--'
      const poWriteback = item.activityLabels?.length
        ? `${item.activityLabels.join(' / ')} · PO ${formatAmountDisplay(Number(item.marketingPoAmount ?? 0))} / 教育补 ${formatAmountDisplay(Number(item.educationAmount ?? 0))}`
        : '未命中活动标签'
      return {
        id: `report-sn-valid-${item.id}-${index}`,
        cells: [
          item.statusLabel || (isValidSales ? '有效销量' : '待补证据'),
          processSummary,
          [item.orderNumber || '--', item.productName || '--'].join(' / '),
          poWriteback,
          item.serialNumber || '--',
          isValidSales ? '是' : '否',
          isPoCompliant ? '是' : '否',
          lockStatus,
          firstSaleStatus,
          '待接入',
          '待接入',
          item.pnMtm || '--',
          item.category || '--',
          item.orderNumber || '--',
          String(item.salesDate || item.outboundDate || '--').slice(0, 19),
          '--',
          item.storeName || '--',
          '门店',
          '--',
          item.storeName || '--',
          formatCellValue(Number(item.payAmount ?? item.salesAmount ?? 0) || 0),
          '零售收款',
          '--',
          '--',
        ],
        searchableText: [
          item.orderNumber,
          item.pnMtm,
          item.productName,
          item.serialNumber,
          item.storeName,
          item.statusLabel,
          ...(item.activityLabels ?? []),
          ...(item.warnings ?? []),
        ].filter(Boolean).join(' '),
        actionLabels: [],
      }
    })
}

function formatAmountDisplay(value: number) {
  if (!Number.isFinite(value)) return '--'
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function buildFinanceChannelRows(
  salesOrders: RetailCoreSalesOrders | null,
  mode: 'payment' | 'signing' | 'balance',
): RenderRow[] {
  const fallbackOrganizationName = resolveDefaultOrganizationName(null, salesOrders)
  const grouped = new Map<string, {
    storeCode: string
    shopName: string
    channel: string
    orderCount: number
    paidAmount: number
    lastAt: string
  }>()
  for (const order of salesOrders?.items ?? []) {
    const storeCode = String(order.store_code ?? order.shop_id ?? '--')
    const rawShopName = order.shop_name?.trim() || storeCode
    const shopName =
      rawShopName
        && !/[\u4e00-\u9fa5]/.test(rawShopName)
        && (/^STORE(?:[-_A-Z0-9]+)?$/i.test(rawShopName) || /^[A-Z]{2,}\d*$/i.test(rawShopName) || /^D\d+$/i.test(rawShopName))
        ? fallbackOrganizationName
        : rawShopName
    const channel = order.channel_type_name ?? order.order_type_name ?? '--'
    const key = `${shopName}::${channel}`
    const current = grouped.get(key) ?? {
      storeCode,
      shopName,
      channel,
      orderCount: 0,
      paidAmount: 0,
      lastAt: '',
    }
    current.orderCount += 1
    current.paidAmount += Number(order.total_amount ?? 0) || 0
    const candidateTime = String(order.pay_time ?? order.created_time ?? order.business_date ?? '')
    if (candidateTime && (!current.lastAt || candidateTime > current.lastAt)) {
      current.lastAt = candidateTime
    }
    if ((current.storeCode === '--' || current.storeCode === current.shopName) && storeCode && storeCode !== '--') {
      current.storeCode = storeCode
    }
    grouped.set(key, current)
  }
  return Array.from(grouped.values())
    .sort((left, right) => right.paidAmount - left.paidAmount)
    .slice(0, 120)
    .map((item, index) => {
      const isWechat = /微信|有赞/i.test(item.channel)
      const isAlipay = /支付宝/i.test(item.channel)
      const amountDisplay = formatAmountDisplay(item.paidAmount)
      const appStatus = mode === 'balance' ? amountDisplay : mode === 'signing' ? '已签约' : '已接入'
      const requestStatus = mode === 'balance' ? formatCellValue(item.orderCount) : mode === 'signing' ? '已生效' : '正常'
      const smsStatus = mode === 'signing' ? '已签署' : '--'
      const dataStatus = mode === 'balance' ? '可用金账户' : mode === 'signing' ? '签约进度' : '支付协议'
      const returnReason = mode === 'balance' ? `可用金 ${amountDisplay}` : mode === 'signing' ? '签约主体正常' : '协议链路正常'
      return {
        id: `finance-${mode}-${index}-${item.storeCode}-${item.channel}`,
        cells: [
          item.storeCode,
          item.shopName,
          item.channel,
          appStatus,
          requestStatus,
          isWechat ? '已授权' : '--',
          isAlipay ? '已授权' : '--',
          smsStatus,
          returnReason,
          item.lastAt || '--',
          dataStatus,
        ],
        searchableText: [item.storeCode, item.shopName, item.channel, appStatus, requestStatus].filter(Boolean).join(' '),
        actionLabels: ['变更协议'],
        meta: {
          organizationCode: item.storeCode,
          organizationName: item.shopName,
          orderSource: item.channel,
          paidAmount: amountDisplay,
          orderCount: String(item.orderCount),
          productStatus: dataStatus,
          note: returnReason,
        },
      }
    })
}

function buildAccountEmployeeRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  const blockedAccounts = ['ZHIDIANTONG', 'OPENCLAW', 'SYSTEM', 'ENGINEER_API', 'CODEx', 'CODEX']
  const grouped = new Map<string, {
    account: string
    name: string
    phone: string
    organization: string
    role: string
    status: string
    tag: string
    lastAt: string
    orderCount: number
  }>()
  for (const order of salesOrders?.items ?? []) {
    const account = String(order.operator_id ?? order.cashier_name ?? '').trim()
    const name = String(order.cashier_name ?? order.operator_id ?? '').trim()
    if (!account && !name) continue
    const normalizedAccount = account.toUpperCase()
    const normalizedName = name.toUpperCase()
    if (blockedAccounts.includes(normalizedAccount) || blockedAccounts.includes(normalizedName)) continue
    const key = account || name
    const organization = order.shop_name ?? order.store_code ?? '--'
    const role = order.channel_type_name === '有赞' ? '线上运营' : '门店收银'
    const candidateTime = String(order.pay_time ?? order.created_time ?? order.business_date ?? '')
    const current = grouped.get(key) ?? {
      account: account || name,
      name: name || account,
      phone: '--',
      organization,
      role,
      status: '启用',
      tag: '',
      lastAt: '',
      orderCount: 0,
    }
    current.orderCount += 1
    if (!current.lastAt || candidateTime > current.lastAt) current.lastAt = candidateTime
    if (current.organization === '--' && organization !== '--') current.organization = organization
    if (current.role === '门店收银' && role !== current.role) current.role = role
    grouped.set(key, current)
  }
  return Array.from(grouped.values())
    .sort((left, right) => right.orderCount - left.orderCount)
    .slice(0, 120)
    .map((item, index) => ({
      id: `account-employee-${index}-${item.account}`,
      cells: [
        item.account || '--',
        item.name || '--',
        item.phone,
        item.organization,
        item.role,
        item.status,
        item.orderCount >= 30 ? '高频出单' : '--',
      ],
      searchableText: [item.account, item.name, item.organization, item.role].filter(Boolean).join(' '),
      actionLabels: ['重置账号密码'],
      meta: {
        organizationName: item.organization,
        organizationCode: item.organization,
        orderSource: item.role,
        orderStatus: item.status,
        note: `最近活跃 ${item.lastAt || '--'} · 出单 ${item.orderCount}`,
      },
    }))
}

function buildAccountTargetRows(salesOrders: RetailCoreSalesOrders | null): RenderRow[] {
  const grouped = new Map<string, {
    organization: string
    name: string
    phone: string
    month: string
    salesAmount: number
    grossAmount: number
    updatedAt: string
    updatedBy: string
  }>()
  for (const order of salesOrders?.items ?? []) {
    const name = String(order.cashier_name ?? order.operator_id ?? '').trim()
    if (!name) continue
    const businessDate = String(order.business_date ?? order.created_time ?? '').slice(0, 7)
    const key = `${order.shop_name ?? order.store_code ?? '--'}::${name}::${businessDate}`
    const current = grouped.get(key) ?? {
      organization: order.shop_name ?? order.store_code ?? '--',
      name,
      phone: '--',
      month: businessDate || '--',
      salesAmount: 0,
      grossAmount: 0,
      updatedAt: '',
      updatedBy: name,
    }
    const amount = Number(order.total_amount ?? 0) || 0
    current.salesAmount += amount
    current.grossAmount += amount
    const candidateTime = String(order.pay_time ?? order.created_time ?? order.business_date ?? '')
    if (!current.updatedAt || candidateTime > current.updatedAt) current.updatedAt = candidateTime
    grouped.set(key, current)
  }
  return Array.from(grouped.values())
    .sort((left, right) => String(right.month).localeCompare(String(left.month)) || right.salesAmount - left.salesAmount)
    .slice(0, 120)
    .map((item, index) => ({
      id: `account-target-${index}-${item.organization}-${item.name}-${item.month}`,
      cells: [
        item.organization,
        item.name,
        item.phone,
        item.month,
        '--',
        '--',
        formatAmountDisplay(item.salesAmount),
        '--',
        formatAmountDisplay(item.grossAmount),
        '--',
        item.updatedAt || '--',
        item.updatedBy || '--',
      ],
      searchableText: [item.organization, item.name, item.month].filter(Boolean).join(' '),
      actionLabels: [],
      meta: {
        organizationName: item.organization,
        organizationCode: item.organization,
        orderSource: '销售映射',
        note: `月销售额 ${formatAmountDisplay(item.salesAmount)}`,
      },
    }))
}

function buildDevicePosRows(
  salesOrders: RetailCoreSalesOrders | null,
  inventory: StandardInventorySnapshot | null,
): RenderRow[] {
  const defaultOrganizationName = resolveDefaultOrganizationName(inventory, salesOrders)
  const grouped = new Map<string, {
    terminalNo: string
    deviceId: string
    mac: string
    organization: string
    activated: string
    activationTime: string
    useStatus: string
    createdAt: string
  }>()
  for (const order of salesOrders?.items ?? []) {
    const storeCode = String(order.store_code ?? order.shop_id ?? '').trim()
    const organization = order.shop_name ?? defaultOrganizationName ?? storeCode ?? '--'
    if (!storeCode && !organization) continue
    const terminalNo = storeCode || organization
    const key = terminalNo
    const candidateTime = String(order.pay_time ?? order.created_time ?? order.business_date ?? '')
    const current = grouped.get(key) ?? {
      terminalNo,
      deviceId: '--',
      mac: '--',
      organization: organization || '--',
      activated: '已激活',
      activationTime: candidateTime || '--',
      useStatus: '启用中',
      createdAt: candidateTime || '--',
    }
    if (candidateTime && (!current.activationTime || candidateTime < current.activationTime)) {
      current.activationTime = candidateTime
    }
    if (candidateTime && (!current.createdAt || candidateTime < current.createdAt)) {
      current.createdAt = candidateTime
    }
    if (current.organization === '--' && organization) current.organization = organization
    grouped.set(key, current)
  }
  return Array.from(grouped.values())
    .sort((left, right) => left.terminalNo.localeCompare(right.terminalNo))
    .slice(0, 120)
    .map((item, index) => ({
      id: `device-pos-${index}-${item.terminalNo}`,
      cells: [
        item.terminalNo || '--',
        item.deviceId,
        item.mac,
        item.organization,
        item.activated,
        item.activationTime || '--',
        item.useStatus,
        item.createdAt || '--',
      ],
      searchableText: [item.terminalNo, item.organization, item.useStatus].filter(Boolean).join(' '),
      actionLabels: ['详情', '编辑', '重置', '删除'],
      meta: {
        organizationName: item.organization,
        organizationCode: item.terminalNo,
        orderStatus: item.useStatus,
        note: `激活 ${item.activationTime || '--'}`,
      },
    }))
}

function buildDealerProductPageRows(
  projection: PublishedProductProjectionSnapshot | null,
  inventory: StandardInventorySnapshot | null,
  products: ProductLibraryProductsSnapshot | null,
): RenderRow[] {
  const inventoryBySku = new Map((inventory?.skus ?? []).map((item) => [item.skuKey, item]))
  const projectionRows = (projection?.items ?? []).slice(0, 120).map((item) => {
    const inventoryItem = inventoryBySku.get(item.skuKey)
    const extra = item as typeof item & {
      productId?: string
      catalogSource?: string
      sourceCategory?: string
      updatedAt?: string
    }
    return {
      id: `dealer-product-page-${item.skuKey}`,
      cells: [
        item.productName ?? item.displayTitle,
        inventoryItem?.category ?? item.category ?? '--',
        extra.catalogSource ?? inventoryItem?.catalogSource ?? extra.sourceCategory ?? inventoryItem?.sourceCategory ?? '--',
        item.spec ?? '--',
        inventoryItem?.productCode ?? item.skuKey,
        Number(inventoryItem?.currentStock ?? item.currentStock ?? 0) > 0 ? '启用' : '待发布',
        '标准税率',
        '--',
        extra.updatedAt ?? item.pricing?.priceVersion ?? '--',
      ],
      searchableText: [
        item.productName,
        item.displayTitle,
        item.pnMtm,
        item.skuKey,
        item.category,
        inventoryItem?.catalogSource,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看', '编辑'],
      meta: {
        productId: extra.productId,
        skuKey: item.skuKey,
        productName: item.productName ?? item.displayTitle ?? '',
        pnMtm: item.pnMtm ?? '',
        spec: item.spec ?? '',
        productSource: extra.catalogSource ?? inventoryItem?.catalogSource ?? extra.sourceCategory ?? inventoryItem?.sourceCategory ?? '',
        productCategory: inventoryItem?.category ?? item.category ?? '',
        productType: item.spec ?? '',
        productCode: inventoryItem?.productCode ?? item.skuKey,
        productStatus: Number(inventoryItem?.currentStock ?? item.currentStock ?? 0) > 0 ? '启用' : '待发布',
        salesChannel: '标准税率',
        updatedAt: extra.updatedAt ?? item.pricing?.priceVersion ?? '',
        sourceConfidence: 'projection',
        currentStock: formatCellValue(inventoryItem?.currentStock ?? item.currentStock),
        sellableStock: formatCellValue(inventoryItem?.sellableStock ?? item.sellableStock),
        serialCount: formatCellValue(item.serialCount),
      },
    }
  })
  if (projectionRows.length) return projectionRows
  return (products?.items ?? []).slice(0, 120).map((item) => ({
    id: `dealer-library-product-${item.primary_sku_key}`,
    cells: [
      item.canonical_name,
      item.default_category ?? '--',
      item.catalog_source ?? '--',
      item.configuration_summary ?? '--',
      item.primary_sku_key,
      item.review_status ?? '--',
      '标准税率',
      '--',
      item.updated_at ?? item.last_synced_at ?? '--',
    ],
    searchableText: [
      item.canonical_name,
      item.pn_mtm,
      item.primary_sku_key,
      item.default_category,
      item.catalog_source,
    ].filter(Boolean).join(' '),
    actionLabels: ['查看', '编辑'],
    meta: {
      productId: item.id,
      skuKey: item.primary_sku_key,
      productName: item.canonical_name,
      pnMtm: item.pn_mtm ?? '',
      spec: item.configuration_summary ?? '',
      productSource: item.catalog_source ?? '',
      productCategory: item.default_category ?? '',
      productType: item.configuration_summary ?? '',
      productCode: item.primary_sku_key,
      productStatus: item.review_status ?? '',
      salesChannel: '标准税率',
      updatedAt: item.updated_at ?? item.last_synced_at ?? '',
      sourceConfidence: item.source_confidence ?? '',
      currentStock: formatCellValue(item.current_stock),
      sellableStock: formatCellValue(item.sellable_stock),
      serialCount: '0',
    },
  }))
}

function buildLibraryProductRows(
  products: ProductLibraryProductsSnapshot | null,
  mode: 'store' | 'depot',
): RenderRow[] {
  return (products?.items ?? []).slice(0, 120).map((item) => ({
    id: `${mode}-library-product-${item.primary_sku_key}`,
    cells: [
      item.canonical_name,
      item.catalog_source ?? '--',
      item.default_category ?? '--',
      item.configuration_summary ?? '--',
      item.primary_sku_key,
      item.review_status ?? '--',
      mode === 'store' ? '门店零售' : '--',
      item.updated_at ?? item.last_synced_at ?? '--',
    ],
    searchableText: [
      item.canonical_name,
      item.pn_mtm,
      item.primary_sku_key,
      item.default_category,
      item.catalog_source,
    ].filter(Boolean).join(' '),
    actionLabels: mode === 'store' ? ['查看', '编辑'] : ['查看'],
    meta: {
      productId: item.id,
      skuKey: item.primary_sku_key,
      productName: item.canonical_name,
      pnMtm: item.pn_mtm ?? '',
      spec: item.configuration_summary ?? '',
      productSource: item.catalog_source ?? '',
      productCategory: item.default_category ?? '',
      productType: item.configuration_summary ?? '',
      productCode: item.primary_sku_key,
      productStatus: item.review_status ?? '',
      salesChannel: mode === 'store' ? '门店零售' : '',
      updatedAt: item.updated_at ?? item.last_synced_at ?? '',
      sourceConfidence: item.source_confidence ?? '',
      currentStock: formatCellValue(item.current_stock),
      sellableStock: formatCellValue(item.sellable_stock),
      serialCount: '0',
    },
  }))
}

function buildCashierHotSaleRows(
  salesOrders: RetailCoreSalesOrders | null,
  projection: PublishedProductProjectionSnapshot | null,
  inventory: StandardInventorySnapshot | null,
): RenderRow[] {
  const projectionBySku = new Map((projection?.items ?? []).map((item) => [item.skuKey, item]))
  const inventoryBySku = new Map((inventory?.skus ?? []).map((item) => [item.skuKey, item]))
  const grouped = new Map<string, {
    skuKey: string
    productName: string
    category: string
    channel: string
    productCode: string
    currentStock: number
    quantity: number
  }>()

  for (const order of salesOrders?.items ?? []) {
    const orderChannel = order.channel_type_name || order.order_type_name || '--'
    for (const line of order.lines ?? []) {
      const skuKey = line.sku_key || line.sku_no || ''
      const projectionItem = skuKey ? projectionBySku.get(skuKey) : undefined
      const inventoryItem = skuKey ? inventoryBySku.get(skuKey) : undefined
      const normalizedCategory =
        inventoryItem?.category && inventoryItem.category !== '--'
          ? inventoryItem.category
          : projectionItem?.category && projectionItem.category !== '--'
          ? projectionItem.category
          : '未分类'
      const key = skuKey || line.product_no || line.product_name || line.id
      const current = grouped.get(key) ?? {
        skuKey,
        productName: line.product_name || projectionItem?.productName || projectionItem?.displayTitle || skuKey || '--',
        category: normalizedCategory,
        channel: orderChannel,
        productCode: line.product_no || inventoryItem?.productCode || skuKey || '--',
        currentStock: Number(inventoryItem?.currentStock ?? projectionItem?.currentStock ?? 0),
        quantity: 0,
      }
      current.quantity += Number(line.quantity ?? 0)
      grouped.set(key, current)
    }
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 120)
    .map((item) => ({
      id: `product-hot-sale-${item.skuKey || item.productCode}`,
      cells: [
        item.productName,
        item.category,
        item.channel,
        item.productCode,
        '否',
        item.currentStock > 0 ? '是' : '否',
      ],
      searchableText: [
        item.productName,
        item.category,
        item.channel,
        item.productCode,
        item.skuKey,
      ].filter(Boolean).join(' '),
      actionLabels: [],
      meta: {
        skuKey: item.skuKey,
        productName: item.productName,
        productCategory: item.category || '未分类',
        productCode: item.productCode,
        salesChannel: item.channel,
        productStatus: item.currentStock > 0 ? '上架中' : '未上架',
        currentStock: formatCellValue(item.currentStock),
        sellableStock: formatCellValue(item.currentStock),
      },
    }))
}

function buildSupplierManagementRows(
  serialItems: RetailCoreSerialItems | null,
  inventory: StandardInventorySnapshot | null,
): RenderRow[] {
  const fallbackOrganizationName = inventory?.skus?.find((item) => item.organizationName)?.organizationName ?? '联想体验店（新野县书院路）'
  const grouped = new Map<string, {
    supplierName: string
    status: string
    organizationName: string
    createdAt: string
    skuCount: number
  }>()

  for (const item of serialItems?.items ?? []) {
    const supplierName = item.supplier_name?.trim()
    if (!supplierName) continue
    const warehouseName = item.warehouse_code?.trim() || item.location_code?.trim() || '--'
    const readableOrganization = warehouseName === '--' || /^[A-Z]{2,}\d*$/i.test(warehouseName) || warehouseName === 'STORE'
      ? fallbackOrganizationName
      : warehouseName
    const current = grouped.get(supplierName) ?? {
      supplierName,
      status: '启用',
      organizationName: readableOrganization,
      createdAt: item.inbound_date || '--',
      skuCount: 0,
    }
    current.skuCount += 1
    if ((current.organizationName === '--' || current.organizationName === 'STORE') && readableOrganization) current.organizationName = readableOrganization
    if (current.createdAt === '--' && item.inbound_date) current.createdAt = item.inbound_date
    grouped.set(supplierName, current)
  }

  if (!grouped.size) {
    for (const sku of inventory?.skus ?? []) {
      for (const serial of sku.serials ?? []) {
        const supplierName = serial.supplierName?.trim()
        if (!supplierName) continue
        const current = grouped.get(supplierName) ?? {
          supplierName,
          status: '启用',
          organizationName: sku.organizationName || '--',
          createdAt: serial.inboundDate || '--',
          skuCount: 0,
        }
        current.skuCount += 1
        if (current.organizationName === '--' && sku.organizationName) current.organizationName = sku.organizationName
        if (current.createdAt === '--' && serial.inboundDate) current.createdAt = serial.inboundDate
        grouped.set(supplierName, current)
      }
    }
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.skuCount - left.skuCount)
    .slice(0, 120)
    .map((item) => ({
      id: `product-supplier-${item.supplierName}`,
      cells: [
        item.supplierName,
        item.status,
        item.organizationName,
        item.createdAt,
      ],
      searchableText: [item.supplierName, item.status, item.organizationName, item.createdAt].filter(Boolean).join(' '),
      actionLabels: ['编辑'],
      meta: {
        organizationName: item.organizationName,
        orderStatus: item.status,
        updatedAt: item.createdAt,
        note: `SKU ${item.skuCount}`,
      },
    }))
}

function buildStoreProductPageRows(
  projection: PublishedProductProjectionSnapshot | null,
  inventory: StandardInventorySnapshot | null,
): RenderRow[] {
  const inventoryBySku = new Map((inventory?.skus ?? []).map((item) => [item.skuKey, item]))
  return (projection?.items ?? []).slice(0, 120).map((item) => {
    const inventoryItem = inventoryBySku.get(item.skuKey)
    const extra = item as typeof item & {
      productId?: string
      catalogSource?: string
      sourceCategory?: string
      channelViews?: unknown
      updatedAt?: string
    }
    return {
      id: `store-product-page-${item.skuKey}`,
      cells: [
        item.productName ?? item.displayTitle,
        extra.catalogSource ?? inventoryItem?.catalogSource ?? extra.sourceCategory ?? inventoryItem?.sourceCategory ?? '--',
        inventoryItem?.category ?? item.category ?? '--',
        item.spec ?? '--',
        item.skuKey,
        inventoryItem?.currentStock ? '上架中' : '待上架',
        extra.channelViews ? '门店零售' : '--',
        extra.updatedAt ?? item.storeManualPromotion?.updatedAt ?? item.pricing?.priceVersion ?? '--',
      ],
      searchableText: [
        item.productName,
        item.displayTitle,
        item.pnMtm,
        item.skuKey,
        item.category,
        inventoryItem?.organizationName,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看', '编辑'],
      meta: {
        productId: extra.productId,
        skuKey: item.skuKey,
        productName: item.productName ?? item.displayTitle ?? '',
        pnMtm: item.pnMtm ?? '',
        spec: item.spec ?? '',
        productSource: extra.catalogSource ?? inventoryItem?.catalogSource ?? extra.sourceCategory ?? inventoryItem?.sourceCategory ?? '',
        productCategory: inventoryItem?.category ?? item.category ?? '',
        productType: item.spec ?? '',
        productCode: item.skuKey,
        productStatus: inventoryItem?.currentStock ? '上架中' : '待上架',
        salesChannel: extra.channelViews ? '门店零售' : '',
        updatedAt: extra.updatedAt ?? item.storeManualPromotion?.updatedAt ?? item.pricing?.priceVersion ?? '',
        sourceConfidence: 'projection',
        currentStock: formatCellValue(inventoryItem?.currentStock ?? item.currentStock),
        sellableStock: formatCellValue(inventoryItem?.sellableStock ?? item.sellableStock),
        serialCount: formatCellValue(item.serialCount),
        organizationName: inventoryItem?.organizationName ?? '',
        organizationCode: inventoryItem?.organizationCode ?? '',
      },
    }
  })
}

function buildDepotProductPageRows(
  projection: PublishedProductProjectionSnapshot | null,
  serialItems: RetailCoreSerialItems | null,
): RenderRow[] {
  const warehouseBySku = new Map<string, { warehouse: string; updatedAt: string; status: string }>()
  for (const item of serialItems?.items ?? []) {
    if (!warehouseBySku.has(item.sku_key)) {
      warehouseBySku.set(item.sku_key, {
        warehouse: item.warehouse_code || item.location_code || '--',
        updatedAt: item.updated_at || '--',
        status: item.status || '',
      })
    }
  }
  return (projection?.items ?? []).slice(0, 120).map((item) => {
    const extra = item as typeof item & {
      productId?: string
      catalogSource?: string
      sourceCategory?: string
      updatedAt?: string
    }
    return {
      id: `depot-product-page-${item.skuKey}`,
      cells: [
        item.productName ?? item.displayTitle,
        extra.catalogSource ?? extra.sourceCategory ?? '--',
        item.category ?? '--',
        item.spec ?? '--',
        item.skuKey,
        warehouseBySku.get(item.skuKey)?.status || '--',
        warehouseBySku.get(item.skuKey)?.warehouse ?? '--',
        extra.updatedAt ?? warehouseBySku.get(item.skuKey)?.updatedAt ?? item.pricing?.priceVersion ?? '--',
      ],
      searchableText: [
        item.productName,
        item.displayTitle,
        item.pnMtm,
        item.skuKey,
        item.category,
        warehouseBySku.get(item.skuKey)?.warehouse,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看'],
      meta: {
        productId: extra.productId,
        skuKey: item.skuKey,
        productName: item.productName ?? item.displayTitle ?? '',
        pnMtm: item.pnMtm ?? '',
        spec: item.spec ?? '',
        productSource: extra.catalogSource ?? extra.sourceCategory ?? '',
        productCategory: item.category ?? '',
        productType: item.spec ?? '',
        productCode: item.skuKey,
        productStatus: warehouseBySku.get(item.skuKey)?.status || '',
        salesChannel: warehouseBySku.get(item.skuKey)?.warehouse ?? '',
        updatedAt: extra.updatedAt ?? warehouseBySku.get(item.skuKey)?.updatedAt ?? item.pricing?.priceVersion ?? '',
        sourceConfidence: 'projection',
        currentStock: '--',
        sellableStock: '--',
        serialCount: formatCellValue(item.serialCount),
      },
    }
  })
}

function buildInventoryPageRows(inventory: StandardInventorySnapshot | null): RenderRow[] {
  return (inventory?.skus ?? []).slice(0, 120).map((item) => ({
    id: `inventory-page-${item.skuKey}`,
    cells: [
      item.productName ?? item.skuKey,
      item.pnMtm ?? '--',
      item.spec ?? '--',
      formatCellValue(item.currentStock),
      formatCellValue(item.sellableStock),
      formatCellValue(item.occupiedStock),
      formatCellValue(item.unsellableStock),
      formatCellValue(item.pendingInboundStock),
      '--',
      item.category ?? '--',
      item.productCode ?? '--',
      item.skuCode ?? item.skuKey,
      item.organizationName ?? '--',
      item.organizationCode ?? '--',
      item.stockType ?? '--',
      formatCellValue(item.agentPrice),
      formatCellValue(item.salesCostPrice),
    ],
    searchableText: [item.productName, item.skuKey, item.pnMtm, item.organizationName, item.category].filter(Boolean).join(' '),
    actionLabels: ['库存流水', '查看序列号'],
    meta: {
      skuKey: item.skuKey,
      skuCode: item.skuCode,
      productName: item.productName ?? undefined,
      pnMtm: item.pnMtm ?? undefined,
      spec: item.spec ?? undefined,
      organizationCode: item.organizationCode ?? undefined,
      organizationName: item.organizationName ?? undefined,
    },
  }))
}

function resolveAverageSerialPurchaseCost(item: StandardInventorySnapshot['skus'][number]) {
  const purchaseCosts = (item.serials ?? [])
    .map((serial) => Number(serial.purchaseCost ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (!purchaseCosts.length) return undefined
  return purchaseCosts.reduce((sum, value) => sum + value, 0) / purchaseCosts.length
}

function buildInventoryOverviewRows(inventory: StandardInventorySnapshot | null): RenderRow[] {
  return [...(inventory?.skus ?? [])]
    .sort((left, right) => {
      const stockDiff = Number(right.currentStock ?? 0) - Number(left.currentStock ?? 0)
      if (stockDiff !== 0) return stockDiff
      return Number(right.sellableStock ?? 0) - Number(left.sellableStock ?? 0)
    })
    .slice(0, 120)
    .map((item) => ({
      id: `inventory-overview-${item.skuKey}`,
      cells: [
        item.productName ?? item.skuKey,
        item.pnMtm ?? '--',
        item.spec ?? '--',
        formatCellValue(item.currentStock),
        formatCellValue(item.sellableStock),
        formatCellValue(item.occupiedStock),
        formatCellValue(item.unsellableStock),
        formatCellValue(item.pendingInboundStock),
        formatCellValue(item.stockWarningLevel),
        item.category ?? item.sourceCategory ?? '--',
        item.productCode ?? '--',
        item.skuCode ?? item.skuKey,
        item.stockType ?? '--',
        formatCellValue(item.agentPrice),
        formatCellValue(item.salesCostPrice),
      ],
      searchableText: [
        item.productName,
        item.pnMtm,
        item.spec,
        item.category,
        item.sourceCategory,
        item.productCode,
        item.skuCode,
        item.skuKey,
        item.stockType,
      ].filter(Boolean).join(' '),
      actionLabels: ['库存查看', '导出库存SN'],
      meta: {
        skuKey: item.skuKey,
        skuCode: item.skuCode,
        productName: item.productName ?? undefined,
        pnMtm: item.pnMtm ?? undefined,
        spec: item.spec ?? undefined,
        organizationCode: item.organizationCode ?? undefined,
        organizationName: item.organizationName ?? undefined,
      },
    }))
}

function buildInventoryCostPriceRows(inventory: StandardInventorySnapshot | null): RenderRow[] {
  return [...(inventory?.skus ?? [])]
    .sort((left, right) => {
      const salesCostDiff = Number(right.salesCostPrice ?? 0) - Number(left.salesCostPrice ?? 0)
      if (salesCostDiff !== 0) return salesCostDiff
      return Number(right.agentPrice ?? 0) - Number(left.agentPrice ?? 0)
    })
    .slice(0, 120)
    .map((item) => {
      const inventoryCost = resolveAverageSerialPurchaseCost(item)
      return {
        id: `inventory-cost-price-${item.skuKey}`,
        cells: [
          item.catalogSource ?? item.sourceCategory ?? '--',
          item.productName ?? item.skuKey,
          item.pnMtm ?? '--',
          item.category ?? item.sourceCategory ?? '--',
          item.productCode ?? '--',
          item.skuCode ?? item.skuKey,
          item.organizationName ?? '--',
          item.organizationCode ?? '--',
          formatCellValue(item.agentPrice),
          formatCellValue(inventoryCost),
          formatCellValue(item.salesCostPrice),
          formatCellValue(item.salesCostPrice),
        ],
        searchableText: [
          item.catalogSource,
          item.sourceCategory,
          item.productName,
          item.pnMtm,
          item.category,
          item.productCode,
          item.skuCode,
          item.skuKey,
          item.organizationName,
          item.organizationCode,
        ].filter(Boolean).join(' '),
        actionLabels: ['销售成本记录', '查看'],
        meta: {
          skuKey: item.skuKey,
          skuCode: item.skuCode,
          productName: item.productName ?? undefined,
          pnMtm: item.pnMtm ?? undefined,
          spec: item.spec ?? undefined,
          organizationCode: item.organizationCode ?? undefined,
          organizationName: item.organizationName ?? undefined,
        },
      }
    })
}

function buildInventoryLocationRows(
  serialItems: RetailCoreSerialItems | null,
  inventory: StandardInventorySnapshot | null,
): RenderRow[] {
  const inventoryBySku = new Map((inventory?.skus ?? []).map((item) => [item.skuKey, item]))
  const rowsByLocation = new Map<string, {
    pnMtm?: string
    spec?: string
    productName?: string
    warehouseCode?: string
    locationCode?: string
    category?: string
    skuCode?: string
    skuKey?: string
    totalStock: number
    occupiedStock: number
    pendingInbound: number
    salesProperty?: string
  }>()

  for (const item of serialItems?.items ?? []) {
    const key = `${item.location_code || '--'}::${item.sku_key}`
    const current = rowsByLocation.get(key) ?? {
      pnMtm: item.pn_mtm,
      spec: item.spec,
      productName: item.product_name,
      warehouseCode: item.warehouse_code,
      locationCode: item.location_code,
      category: inventoryBySku.get(item.sku_key)?.category,
      skuKey: item.sku_key,
      totalStock: 0,
      occupiedStock: 0,
      pendingInbound: 0,
      salesProperty: item.status,
    }
    current.totalStock += 1
    if (item.status && /占用/.test(item.status)) current.occupiedStock += 1
    rowsByLocation.set(key, current)
  }

  return Array.from(rowsByLocation.values())
    .sort((left, right) => right.totalStock - left.totalStock)
    .slice(0, 120)
    .map((item, index) => ({
      id: `inventory-location-${item.locationCode || 'unknown'}-${item.skuKey || index}`,
      cells: [
        item.productName ?? item.skuKey ?? '--',
        item.pnMtm ?? '--',
        item.spec ?? '--',
        formatCellValue(item.totalStock),
        formatCellValue(item.totalStock - item.occupiedStock),
        formatCellValue(item.occupiedStock),
        formatCellValue(item.pendingInbound),
        item.locationCode ?? '--',
        item.salesProperty ?? '--',
        item.category ?? '--',
        item.skuKey ?? '--',
      ],
      searchableText: [
        item.productName,
        item.pnMtm,
        item.spec,
        item.locationCode,
        item.warehouseCode,
        item.skuKey,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看'],
      meta: {
        skuKey: item.skuKey,
        productName: item.productName,
        pnMtm: item.pnMtm,
        spec: item.spec,
        productCategory: item.category,
        productCode: item.skuCode,
        productStatus: item.salesProperty,
      },
    }))
}

function buildInventoryLocationFallbackRows(inventory: StandardInventorySnapshot | null): RenderRow[] {
  const grouped = new Map<string, {
    productName?: string
    pnMtm?: string
    spec?: string
    totalStock: number
    stock: number
    occupied: number
    pending: number
    locationCode?: string
    salesProperty?: string
    category?: string
    productCode?: string
    skuKey?: string
  }>()

  for (const sku of inventory?.skus ?? []) {
    if (sku.serials?.length) {
      for (const serial of sku.serials) {
        const key = `${sku.skuKey}::${serial.locationName || '--'}`
        const current = grouped.get(key) ?? {
          productName: serial.productName ?? sku.productName,
          pnMtm: serial.pnMtm ?? sku.pnMtm,
          spec: serial.spec ?? sku.spec,
          totalStock: 0,
          stock: 0,
          occupied: 0,
          pending: 0,
          locationCode: serial.locationName,
          salesProperty: sku.stockType,
          category: sku.category ?? sku.sourceCategory,
          productCode: sku.productCode ?? sku.skuCode,
          skuKey: sku.skuKey,
        }
        current.totalStock += 1
        current.stock += 1
        grouped.set(key, current)
      }
      continue
    }
    grouped.set(`${sku.skuKey}::--`, {
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      spec: sku.spec,
      totalStock: Number(sku.currentStock ?? 0),
      stock: Number(sku.sellableStock ?? sku.currentStock ?? 0),
      occupied: Number(sku.occupiedStock ?? 0),
      pending: Number(sku.pendingInboundStock ?? 0),
      locationCode: '--',
      salesProperty: sku.stockType,
      category: sku.category ?? sku.sourceCategory,
      productCode: sku.productCode ?? sku.skuCode,
      skuKey: sku.skuKey,
    })
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.totalStock - left.totalStock)
    .slice(0, 120)
    .map((item, index) => ({
      id: `inventory-location-fallback-${item.locationCode || 'unknown'}-${item.skuKey || index}`,
      cells: [
        item.productName ?? item.skuKey ?? '--',
        item.pnMtm ?? '--',
        item.spec ?? '--',
        formatCellValue(item.totalStock),
        formatCellValue(item.stock),
        formatCellValue(item.occupied),
        formatCellValue(item.pending),
        item.locationCode ?? '--',
        item.salesProperty ?? '--',
        item.category ?? '--',
        item.productCode ?? '--',
      ],
      searchableText: [
        item.productName,
        item.pnMtm,
        item.spec,
        item.locationCode,
        item.category,
        item.productCode,
        item.skuKey,
      ].filter(Boolean).join(' '),
      actionLabels: ['查看'],
      meta: {
        skuKey: item.skuKey,
        productName: item.productName,
        pnMtm: item.pnMtm,
        spec: item.spec,
        productCategory: item.category,
        productCode: item.productCode,
        productStatus: item.salesProperty,
      },
    }))
}

function buildLocationMoveRows(
  serialItems: RetailCoreSerialItems | null,
  inventory: StandardInventorySnapshot | null,
): RenderRow[] {
  const inventoryBySku = new Map((inventory?.skus ?? []).map((item) => [item.skuKey, item]))
  const grouped = new Map<string, {
    productName?: string
    productCode?: string
    pnMtm?: string
    spec?: string
    category?: string
    locationCode?: string
    propertyValue?: string
    totalStock: number
    skuKey?: string
  }>()

  for (const item of serialItems?.items ?? []) {
    const key = `${item.sku_key}::${item.location_code || '--'}`
    const inventoryItem = inventoryBySku.get(item.sku_key)
    const current = grouped.get(key) ?? {
      productName: item.product_name ?? inventoryItem?.productName,
      productCode: inventoryItem?.productCode,
      pnMtm: item.pn_mtm ?? inventoryItem?.pnMtm,
      spec: item.spec ?? inventoryItem?.spec,
      category: inventoryItem?.category ?? inventoryItem?.sourceCategory,
      locationCode: item.location_code,
      propertyValue: item.status,
      totalStock: 0,
      skuKey: item.sku_key,
    }
    current.totalStock += 1
    grouped.set(key, current)
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.totalStock - left.totalStock)
    .slice(0, 120)
    .map((item, index) => ({
      id: `inventory-location-move-${item.skuKey || index}-${item.locationCode || 'unknown'}`,
      cells: [
        item.productName ?? item.skuKey ?? '--',
        item.productCode ?? '--',
        item.pnMtm ?? '--',
        item.spec ?? '--',
        item.category ?? '--',
        item.locationCode ?? '--',
        item.propertyValue ?? '--',
        formatCellValue(item.totalStock),
      ],
      searchableText: [
        item.productName,
        item.productCode,
        item.pnMtm,
        item.spec,
        item.category,
        item.locationCode,
        item.propertyValue,
        item.skuKey,
      ].filter(Boolean).join(' '),
      actionLabels: ['出入库'],
      meta: {
        skuKey: item.skuKey,
        productName: item.productName,
        pnMtm: item.pnMtm,
        spec: item.spec,
        productCategory: item.category,
        productCode: item.productCode,
        productStatus: item.propertyValue,
      },
    }))
}

function buildLocationMoveFallbackRows(inventory: StandardInventorySnapshot | null): RenderRow[] {
  return (inventory?.skus ?? [])
    .flatMap((sku) => {
      const serialRows = (sku.serials ?? []).map((serial, index) => ({
        id: `inventory-location-move-fallback-${sku.skuKey}-${serial.serialNumber || index}`,
        cells: [
          serial.productName ?? sku.productName ?? '--',
          sku.productCode ?? '--',
          serial.pnMtm ?? sku.pnMtm ?? '--',
          serial.spec ?? sku.spec ?? '--',
          sku.category ?? sku.sourceCategory ?? '--',
          serial.locationName ?? '--',
          sku.stockType ?? '--',
          '1',
        ],
        searchableText: [
          serial.productName,
          sku.productCode,
          serial.pnMtm,
          sku.pnMtm,
          serial.spec,
          sku.spec,
          sku.category,
          sku.sourceCategory,
          serial.locationName,
          sku.skuKey,
          serial.serialNumber,
        ].filter(Boolean).join(' '),
        actionLabels: ['出入库'],
      }))
      return serialRows.length ? serialRows : [{
        id: `inventory-location-move-stock-${sku.skuKey}`,
        cells: [
          sku.productName ?? sku.skuKey,
          sku.productCode ?? '--',
          sku.pnMtm ?? '--',
          sku.spec ?? '--',
          sku.category ?? sku.sourceCategory ?? '--',
          '--',
          sku.stockType ?? '--',
          formatCellValue(sku.currentStock),
        ],
        searchableText: [
          sku.productName,
          sku.productCode,
          sku.pnMtm,
          sku.spec,
          sku.category,
          sku.sourceCategory,
          sku.skuKey,
          sku.stockType,
        ].filter(Boolean).join(' '),
        actionLabels: ['出入库'],
      }]
    })
    .slice(0, 120)
}

function buildInventoryConfigRows(inventory: StandardInventorySnapshot | null): RenderRow[] {
  return [...(inventory?.skus ?? [])]
    .sort((left, right) => Number(right.currentStock ?? 0) - Number(left.currentStock ?? 0))
    .slice(0, 120)
    .map((item) => ({
      id: `inventory-config-${item.skuKey}`,
      cells: [
        item.productName ?? item.skuKey,
        item.pnMtm ?? '--',
        item.spec ?? '--',
        formatCellValue(item.currentStock),
        formatCellValue(item.sellableStock),
        formatCellValue(item.occupiedStock),
        formatCellValue(item.unsellableStock),
        formatCellValue(item.pendingInboundStock),
        formatCellValue(item.stockWarningLevel),
        item.category ?? item.sourceCategory ?? '--',
        item.productCode ?? '--',
        item.skuCode ?? item.skuKey,
        item.organizationName ?? '--',
        item.organizationCode ?? '--',
        item.stockType ?? '--',
        formatCellValue(item.agentPrice),
        formatCellValue(item.salesCostPrice),
      ],
      searchableText: [
        item.productName,
        item.pnMtm,
        item.spec,
        item.category,
        item.sourceCategory,
        item.productCode,
        item.skuCode,
        item.skuKey,
        item.organizationName,
        item.organizationCode,
        item.stockType,
      ].filter(Boolean).join(' '),
      actionLabels: ['库存流水', '查看序列号', '销售成本记录'],
      meta: {
        skuKey: item.skuKey,
        skuCode: item.skuCode,
        productName: item.productName ?? undefined,
        pnMtm: item.pnMtm ?? undefined,
        spec: item.spec ?? undefined,
        organizationCode: item.organizationCode ?? undefined,
        organizationName: item.organizationName ?? undefined,
      },
    }))
}

function buildInventoryMovementRows(movements: RetailCoreMovements | null): RenderRow[] {
  return (movements?.items ?? []).slice(0, 120).map((item) => ({
    id: `inventory-movement-page-${item.id}`,
    cells: [
      item.service_no ?? item.source_ref ?? '--',
      item.pn_mtm ?? '--',
      item.service_type_name ?? item.movement_type ?? '--',
      item.id,
      item.shop_name ?? item.store_name ?? item.unit_name ?? '--',
      item.location_name ?? item.warehouse_location_name ?? '--',
      item.property_value ?? item.property_name ?? '--',
      item.operate_type_name ?? item.flow_category ?? '--',
      item.spu_no ?? '--',
      item.sku_key,
      item.product_name ?? item.spec ?? '--',
      formatCellValue(item.quantity),
      formatCellValue(item.amount),
      item.operator_name ?? item.user_name ?? '--',
      item.created_at ?? item.business_date ?? '--',
    ],
    searchableText: [
      item.service_no,
      item.source_ref,
      item.pn_mtm,
      item.product_name,
      item.sku_key,
      item.shop_name,
      item.store_name,
      item.location_name,
      item.operate_type_name,
    ].filter(Boolean).join(' '),
    actionLabels: ['查看'],
  }))
}

function buildInventoryMovementSnapshotRows(movements: InventoryMovementsSnapshot | null): RenderRow[] {
  return (movements?.records ?? []).slice(0, 120).map((item) => ({
    id: `inventory-movement-snapshot-${item.id}`,
    cells: [
      item.documentNumber ?? item.sourceRef ?? '--',
      item.pnMtm ?? '--',
      item.sourceDocumentType ?? item.movementType ?? '--',
      item.id,
      item.storeName ?? '--',
      item.locationName ?? '--',
      '--',
      item.movementType,
      item.skuKey,
      item.skuKey,
      item.productName ?? item.spec ?? '--',
      formatCellValue(item.quantity),
      formatCellValue(item.purchaseCost),
      item.operatorName ?? '--',
      item.updatedAt ?? item.businessDate ?? '--',
    ],
    searchableText: [
      item.documentNumber,
      item.sourceRef,
      item.pnMtm,
      item.productName,
      item.skuKey,
      item.storeName,
      item.locationName,
      item.movementType,
    ].filter(Boolean).join(' '),
    actionLabels: ['查看'],
  }))
}

function resolveRetailMovementDocumentNumber(item: RetailCoreMovements['items'][number]) {
  return item.service_no ?? item.source_ref ?? item.inbound_document_no ?? item.id
}

function buildRetailMovementDocumentRows(
  movements: RetailCoreMovements | null,
  predicate: (item: RetailCoreMovements['items'][number]) => boolean,
  projector: (item: RetailCoreMovements['items'][number], documentNumber: string) => { cells: string[]; searchableValues: Array<string | undefined> },
): RenderRow[] {
  const grouped = new Map<string, RetailCoreMovements['items'][number]>()
  for (const item of movements?.items ?? []) {
    if (!predicate(item)) continue
    const documentNumber = resolveRetailMovementDocumentNumber(item)
    if (!grouped.has(documentNumber)) {
      grouped.set(documentNumber, item)
    }
  }
  return Array.from(grouped.values())
    .slice(0, 120)
    .map((item, index) => {
      const documentNumber = resolveRetailMovementDocumentNumber(item)
      const projection = projector(item, documentNumber)
      return {
        id: `inventory-document-${item.movement_type}-${documentNumber}-${index}`,
        cells: projection.cells,
        searchableText: projection.searchableValues.filter(Boolean).join(' '),
        actionLabels: ['查看'],
      }
    })
}

function buildSnapshotMovementDocumentRows(
  movements: InventoryMovementsSnapshot | null,
  predicate: (item: InventoryMovementsSnapshot['records'][number]) => boolean,
  projector: (item: InventoryMovementsSnapshot['records'][number], documentNumber: string) => { cells: string[]; searchableValues: Array<string | undefined> },
): RenderRow[] {
  const grouped = new Map<string, InventoryMovementsSnapshot['records'][number]>()
  for (const item of movements?.records ?? []) {
    if (!predicate(item)) continue
    const documentNumber = item.documentNumber ?? item.sourceRef ?? item.id
    if (!grouped.has(documentNumber)) {
      grouped.set(documentNumber, item)
    }
  }
  return Array.from(grouped.values())
    .slice(0, 120)
    .map((item, index) => {
      const documentNumber = item.documentNumber ?? item.sourceRef ?? item.id
      const projection = projector(item, documentNumber)
      return {
        id: `inventory-document-snapshot-${item.movementType}-${documentNumber}-${index}`,
        cells: projection.cells,
        searchableText: projection.searchableValues.filter(Boolean).join(' '),
        actionLabels: ['查看'],
      }
    })
}

function buildTransferOutboundRows(movements: RetailCoreMovements | null): RenderRow[] {
  return buildRetailMovementDocumentRows(
    movements,
    (item) => item.movement_type === 'transfer_outbound',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.company_name ?? '--',
        item.shop_name ?? item.store_name ?? '--',
        item.business_date ?? '--',
        item.created_at ?? '--',
        item.operator_name ?? item.user_name ?? '--',
        item.operate_type_name ?? item.service_type_name ?? '--',
      ],
      searchableValues: [
        documentNumber,
        item.company_name,
        item.shop_name,
        item.store_name,
        item.operate_type_name,
        item.service_type_name,
        item.operator_name,
      ],
    }),
  )
}

function buildTransferInboundRows(movements: RetailCoreMovements | null): RenderRow[] {
  return buildRetailMovementDocumentRows(
    movements,
    (item) => item.movement_type === 'transfer_inbound',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.shop_name ?? item.store_name ?? '--',
        item.location_name ?? item.warehouse_location_name ?? '--',
        item.company_name ?? '--',
        item.business_date ?? '--',
        item.created_at ?? '--',
        item.operator_name ?? item.user_name ?? '--',
        item.operate_type_name ?? item.service_type_name ?? '--',
      ],
      searchableValues: [
        documentNumber,
        item.shop_name,
        item.store_name,
        item.location_name,
        item.warehouse_location_name,
        item.company_name,
        item.operate_type_name,
        item.service_type_name,
        item.operator_name,
      ],
    }),
  )
}

function buildPurchaseInboundRows(movements: RetailCoreMovements | null): RenderRow[] {
  return buildRetailMovementDocumentRows(
    movements,
    (item) => item.movement_type === 'purchase_inbound',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.shop_name ?? item.store_name ?? '--',
        item.location_name ?? item.warehouse_location_name ?? '--',
        item.supplier_name ?? item.company_name ?? '--',
        item.business_date ?? '--',
        item.operator_name ?? item.user_name ?? '--',
        item.operate_type_name ?? item.service_type_name ?? '--',
        item.note ?? '--',
      ],
      searchableValues: [
        documentNumber,
        item.shop_name,
        item.store_name,
        item.location_name,
        item.warehouse_location_name,
        item.supplier_name,
        item.company_name,
        item.operate_type_name,
        item.service_type_name,
        item.operator_name,
        item.note,
      ],
    }),
  )
}

function buildOtherInventoryIoRows(movements: RetailCoreMovements | null): RenderRow[] {
  return buildRetailMovementDocumentRows(
    movements,
    (item) => item.movement_type === 'manual_adjustment',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.service_type_name ?? item.source_document_type ?? '--',
        item.operate_type_name ?? item.flow_category ?? '--',
        item.shop_name ?? item.store_name ?? '--',
        item.created_at ?? item.business_date ?? '--',
        item.operator_name ?? item.user_name ?? '--',
      ],
      searchableValues: [
        documentNumber,
        item.service_type_name,
        item.source_document_type,
        item.operate_type_name,
        item.flow_category,
        item.shop_name,
        item.store_name,
        item.operator_name,
        item.note,
      ],
    }),
  )
}

function buildTransferOutboundSnapshotRows(movements: InventoryMovementsSnapshot | null): RenderRow[] {
  return buildSnapshotMovementDocumentRows(
    movements,
    (item) => item.movementType === 'transfer_outbound',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.storeName ?? '--',
        item.storeName ?? '--',
        item.businessDate ?? '--',
        item.updatedAt ?? '--',
        item.operatorName ?? '--',
        item.sourceDocumentType ?? item.movementType ?? '--',
      ],
      searchableValues: [
        documentNumber,
        item.storeName,
        item.sourceDocumentType,
        item.movementType,
        item.operatorName,
      ],
    }),
  )
}

function buildTransferInboundSnapshotRows(movements: InventoryMovementsSnapshot | null): RenderRow[] {
  return buildSnapshotMovementDocumentRows(
    movements,
    (item) => item.movementType === 'transfer_inbound',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.storeName ?? '--',
        item.locationName ?? '--',
        item.storeName ?? '--',
        item.businessDate ?? '--',
        item.updatedAt ?? '--',
        item.operatorName ?? '--',
        item.sourceDocumentType ?? item.movementType ?? '--',
      ],
      searchableValues: [
        documentNumber,
        item.storeName,
        item.locationName,
        item.sourceDocumentType,
        item.movementType,
        item.operatorName,
      ],
    }),
  )
}

function buildPurchaseInboundSnapshotRows(movements: InventoryMovementsSnapshot | null): RenderRow[] {
  return buildSnapshotMovementDocumentRows(
    movements,
    (item) => item.movementType === 'purchase_inbound',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.storeName ?? '--',
        item.locationName ?? '--',
        '--',
        item.businessDate ?? '--',
        item.operatorName ?? '--',
        item.sourceDocumentType ?? item.movementType ?? '--',
        '--',
      ],
      searchableValues: [
        documentNumber,
        item.storeName,
        item.locationName,
        item.sourceDocumentType,
        item.movementType,
        item.operatorName,
      ],
    }),
  )
}

function buildOtherInventoryIoSnapshotRows(movements: InventoryMovementsSnapshot | null): RenderRow[] {
  return buildSnapshotMovementDocumentRows(
    movements,
    (item) => item.movementType === 'manual_adjustment',
    (item, documentNumber) => ({
      cells: [
        documentNumber,
        item.sourceDocumentType ?? '--',
        item.movementType ?? '--',
        item.storeName ?? '--',
        item.updatedAt ?? item.businessDate ?? '--',
        item.operatorName ?? '--',
      ],
      searchableValues: [
        documentNumber,
        item.sourceDocumentType,
        item.movementType,
        item.storeName,
        item.operatorName,
      ],
    }),
  )
}

function buildInventoryStockOrderRows(movements: RetailCoreMovements | null): RenderRow[] {
  return (movements?.items ?? []).slice(0, 120).map((item) => ({
    id: `inventory-stock-order-${item.id}`,
    cells: [
      item.source_system ?? '--',
      item.company_name ?? '--',
      item.service_no ?? item.source_ref ?? '--',
      item.shop_name ?? item.store_name ?? item.unit_name ?? '--',
      item.location_name ?? item.warehouse_location_name ?? '--',
      item.source_document_type ?? item.service_type_name ?? item.movement_type ?? '--',
      item.inbound_document_no ?? item.service_no ?? item.source_ref ?? '--',
      item.pn_mtm ?? '--',
      item.spu_no ?? '--',
      item.sku_key,
      item.product_name ?? '--',
      item.spec ?? '--',
      item.unit_name ?? '--',
      item.operate_type_name ?? item.flow_category ?? '--',
      formatCellValue(item.quantity),
      item.operator_name ?? item.user_name ?? '--',
      item.business_date ?? '--',
      item.created_at ?? '--',
      item.note ?? item.pay_remark ?? '--',
    ],
    searchableText: [
      item.source_system,
      item.company_name,
      item.shop_name,
      item.location_name,
      item.service_type_name,
      item.service_no,
      item.inbound_document_no,
      item.source_ref,
      item.pn_mtm,
      item.spu_no,
      item.sku_key,
      item.product_name,
      item.spec,
      item.operate_type_name,
      item.operator_name,
      item.business_date,
    ].filter(Boolean).join(' '),
    actionLabels: [],
  }))
}

function buildInventoryStockOrderSnapshotRows(movements: InventoryMovementsSnapshot | null): RenderRow[] {
  return (movements?.records ?? []).slice(0, 120).map((item) => ({
    id: `inventory-stock-order-snapshot-${item.id}`,
    cells: [
      item.sourceDocumentType ?? '--',
      item.storeName ?? '--',
      item.documentNumber ?? item.sourceRef ?? '--',
      item.storeName ?? '--',
      item.locationName ?? '--',
      item.sourceDocumentType ?? item.movementType ?? '--',
      item.documentNumber ?? item.sourceRef ?? '--',
      item.pnMtm ?? '--',
      item.skuKey,
      item.skuKey,
      item.productName ?? '--',
      item.spec ?? '--',
      '--',
      item.movementType ?? '--',
      formatCellValue(item.quantity),
      item.operatorName ?? '--',
      item.businessDate ?? '--',
      item.updatedAt ?? '--',
      '--',
    ],
    searchableText: [
      item.sourceDocumentType,
      item.storeName,
      item.documentNumber,
      item.sourceRef,
      item.locationName,
      item.sourceDocumentType,
      item.pnMtm,
      item.skuKey,
      item.productName,
      item.spec,
      item.movementType,
      item.operatorName,
      item.businessDate,
    ].filter(Boolean).join(' '),
    actionLabels: [],
  }))
}

function buildInventorySnOrderRows(serialItems: RetailCoreSerialItems | null): RenderRow[] {
  return (serialItems?.items ?? []).slice(0, 120).map((item, index) => ({
    id: `inventory-sn-order-${item.serial_number || item.sku_key || index}`,
    cells: [
      item.product_name ?? '--',
      item.pn_mtm ?? '--',
      item.spec ?? '--',
      item.sku_key,
      item.serial_number ?? '--',
      item.inbound_document_no ?? '--',
      item.warehouse_code ?? '--',
      item.supplier_name ?? '--',
      item.location_code ?? '--',
      item.status ?? '--',
      item.warranty_status ?? '--',
      item.inbound_document_no ?? '--',
      item.status ?? '--',
      item.operator_name ?? '--',
      item.updated_at ?? '--',
      item.warranty_failure_reason ?? '--',
    ],
    searchableText: [
      item.product_name,
      item.pn_mtm,
      item.spec,
      item.sku_key,
      item.serial_number,
      item.inbound_document_no,
      item.warehouse_code,
      item.supplier_name,
      item.location_code,
      item.status,
      item.operator_name,
    ].filter(Boolean).join(' '),
    actionLabels: [],
  }))
}

function buildInventorySnOrderFallbackRows(inventory: StandardInventorySnapshot | null): RenderRow[] {
  const rows = (inventory?.skus ?? [])
    .flatMap((sku) => (sku.serials ?? []).map((serial, index) => ({
      id: `inventory-sn-order-fallback-${serial.serialNumber || sku.skuKey}-${index}`,
      cells: [
        serial.productName ?? sku.productName ?? '--',
        serial.pnMtm ?? sku.pnMtm ?? '--',
        serial.spec ?? sku.spec ?? '--',
        sku.skuKey,
        serial.serialNumber ?? '--',
        sku.productCode ?? '--',
        sku.organizationCode ?? '--',
        sku.organizationName ?? '--',
        serial.locationName ?? '--',
        sku.stockType ?? '--',
        serial.inboundDocumentNumber ?? '--',
        serial.inboundDocumentNumber ?? '--',
        '在库',
        serial.inboundOperatorName ?? '--',
        serial.inboundDate ?? '--',
        serial.supplierName ?? '--',
      ],
      searchableText: [
        serial.productName,
        serial.pnMtm,
        serial.spec,
        sku.skuKey,
        serial.serialNumber,
        sku.productCode,
        sku.organizationCode,
        sku.organizationName,
        serial.locationName,
        serial.inboundDocumentNumber,
        serial.inboundOperatorName,
        serial.inboundDate,
        serial.supplierName,
      ].filter(Boolean).join(' '),
      actionLabels: [],
    })))
    .slice(0, 120)
  return rows
}

function formatCellValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '--'
  return String(value)
}

function parseFormattedNumber(value: unknown) {
  const normalized = String(value ?? '')
    .replace(/[,\s]/g, '')
    .replace(/[^0-9.\-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeBindingRow(row: ZdtReplicaRow, section: ZdtReplicaSection, rowIndex: number, actionLabels: string[]): RenderRow {
  const valueCells = section.columns.map((column) => formatCellValue(row.cells[column]))
  return {
    id: row.id || `binding-row-${rowIndex}`,
    cells: valueCells,
    searchableText: valueCells.join(' '),
    actionLabels,
  }
}

function normalizeLiveRow(row: ZdtLivePreviewRow, rowIndex: number, actionLabels: string[]): RenderRow {
  const cells = [row.title, row.subtitle, ...row.meta].map(formatCellValue)
  return {
    id: `live-row-${rowIndex}-${row.title}`,
    cells,
    searchableText: cells.join(' '),
    actionLabels,
  }
}

function resolveReplicaRowActions(
  baseActions: string[],
  rowIndex: number,
  rowActionPatterns: Array<{ rowIndex: number; actions: string[] }>,
  detailEntrances: string[],
) {
  const directMatch = rowActionPatterns.find((item) => item.rowIndex === rowIndex)
  const directActions = sanitizeActionLabels(directMatch?.actions ?? [])
  if (directActions.length) return directActions
  if (baseActions.length) return sanitizeActionLabels(baseActions)
  const fallbackPattern = [...rowActionPatterns]
    .sort((left, right) => left.rowIndex - right.rowIndex)
    .find((item) => sanitizeActionLabels(item.actions).length > 0)
  const fallbackActions = sanitizeActionLabels(fallbackPattern?.actions ?? [])
  if (fallbackActions.length) return fallbackActions
  return sanitizeActionLabels(detailEntrances)
}

function compactUniqueLabels(values: string[]) {
  const seen = new Set<string>()
  const ordered: string[] = []
  values.forEach((value) => {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    ordered.push(normalized)
  })
  return ordered
}

function normalizeFilterSemanticKey(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[：:／/（）()]/g, '')
    .replace(/^名称商品编码$/, '商品信息')
    .replace(/^商品名称编码$/, '商品信息')
    .replace(/^SKU编码PNMTM$/, 'SKU编码PNMTM')
    .replace(/^业务类型$/, '入出库类型')
    .replace(/^操作时间$/, '日期范围')
    .replace(/^开始日期$/, '开始日期')
    .replace(/^结束日期$/, '结束日期')
}

function sanitizeDialogButtons(
  buttons: string[],
  ignoredLabels: string[],
) {
  const ignored = new Set(ignoredLabels.filter(Boolean))
  return uniqueOrdered(
    buttons
      .map((button) => button.trim())
      .filter((button) => button && !ignored.has(button)),
  )
}

function normalizeDialogActionLabel(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
}

export function ZdtCloneShell() {
  const initialRoute = useMemo(() => resolveInitialCloneRoute(), [])
  const [sqlStatus, setSqlStatus] = useState<RetailCoreStatus | null>(null)
  const [sqlInventory, setSqlInventory] = useState<StandardInventorySnapshot | null>(null)
  const [directInventory, setDirectInventory] = useState<StandardInventorySnapshot | null>(null)
  const [sqlMovements, setSqlMovements] = useState<InventoryMovementsSnapshot | null>(null)
  const [retailCoreMovements, setRetailCoreMovements] = useState<RetailCoreMovements | null>(null)
  const [directRetailCoreMovements, setDirectRetailCoreMovements] = useState<RetailCoreMovements | null>(null)
  const [sqlSalesOrders, setSqlSalesOrders] = useState<RetailCoreSalesOrders | null>(null)
  const [directSalesOrders, setDirectSalesOrders] = useState<RetailCoreSalesOrders | null>(null)
  const [sqlCustomers, setSqlCustomers] = useState<RetailCoreCustomers | null>(null)
  const [sqlSerialItems, setSqlSerialItems] = useState<RetailCoreSerialItems | null>(null)
  const [sqlSnSalesCompliance, setSqlSnSalesCompliance] = useState<SnSalesComplianceSnapshot | null>(null)
  const [directSerialItems, setDirectSerialItems] = useState<RetailCoreSerialItems | null>(null)
  const [productOverview, setProductOverview] = useState<ProductLibraryOverview | null>(null)
  const [productCategories, setProductCategories] = useState<ProductLibraryCategorySummarySnapshot | null>(null)
  const [productItems, setProductItems] = useState<ProductLibraryProductsSnapshot | null>(null)
  const [directProductItems, setDirectProductItems] = useState<ProductLibraryProductsSnapshot | null>(null)
  const [productDetailCache, setProductDetailCache] = useState<Record<string, ProductLibraryDetail | null>>({})
  const [publishedProjection, setPublishedProjection] = useState<PublishedProductProjectionSnapshot | null>(null)
  const [directProjection, setDirectProjection] = useState<PublishedProductProjectionSnapshot | null>(null)
  const [openclawBridge, setOpenclawBridge] = useState<ZdtOpenclawBridgeSnapshot | null>(null)
  const [openclawReceipts, setOpenclawReceipts] = useState<OpenClawReceiptSnapshot | null>(null)
  const [openclawCommands, setOpenclawCommands] = useState<OpenClawCommandBoardSnapshot | null>(null)
  const [activeTopMenuKey, setActiveTopMenuKey] = useState<ZdtTopMenuKey>(initialRoute.topMenuKey)
  const [activeSubmenuKey, setActiveSubmenuKey] = useState<string>(initialRoute.submenuKey)
  const defaultDateRange = useMemo(() => resolveDateRange('全部'), [])
  const [datePreset, setDatePreset] = useState<DatePreset>('全部')
  const [dateStart, setDateStart] = useState(defaultDateRange.start)
  const [dateEnd, setDateEnd] = useState(defaultDateRange.end)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [filterInputValues, setFilterInputValues] = useState<Record<string, string>>({})
  const [filterSelectValues, setFilterSelectValues] = useState<Record<string, string>>({})
  const [activeStatusTab, setActiveStatusTab] = useState('')
  const [pageIndex, setPageIndex] = useState(1)
  const [activeDialog, setActiveDialog] = useState<ZdtActionDialog | null>(null)
  const [dialogDraft, setDialogDraft] = useState<Record<string, string>>({})
  const [dialogPhase, setDialogPhase] = useState<'editing' | 'confirming' | 'submitted'>('editing')
  const [dialogReceipt, setDialogReceipt] = useState<ZdtDialogReceipt | null>(null)
  const [dialogRowContextBySubmenu, setDialogRowContextBySubmenu] = useState<Record<string, RenderRow | undefined>>({})
  const [pendingDeepLinkDialog, setPendingDeepLinkDialog] = useState<{
    submenuKey: string
    actionLabel: string
    rowIndex: number | null
  } | null>(
    initialRoute.dialogAction
      ? {
          submenuKey: initialRoute.submenuKey,
          actionLabel: initialRoute.dialogAction,
          rowIndex: initialRoute.dialogRowIndex,
        }
      : null,
  )
  const [submenuLoadingState, setSubmenuLoadingState] = useState<Record<string, boolean>>({})
  const [submenuRowOverrides] = useState<Record<string, RenderRow[]>>({})
  const [productCityRows, setProductCityRows] = useState<RenderRow[]>([])
  const [productStoreRows, setProductStoreRows] = useState<RenderRow[]>([])
  const [productDepotRows, setProductDepotRows] = useState<RenderRow[]>([])
  const [productHotSaleRows, setProductHotSaleRows] = useState<RenderRow[]>([])
  const [productSupplierRows, setProductSupplierRows] = useState<RenderRow[]>([])
  const [orderOfflineRows, setOrderOfflineRows] = useState<RenderRow[]>([])
  const [orderOfflineRefundRows, setOrderOfflineRefundRows] = useState<RenderRow[]>([])
  const [orderOnlineRows, setOrderOnlineRows] = useState<RenderRow[]>([])
  const [orderOnlineRefundRows, setOrderOnlineRefundRows] = useState<RenderRow[]>([])
  const [inventoryMovementRows, setInventoryMovementRows] = useState<RenderRow[]>([])
  const [inventoryLocationRows, setInventoryLocationRows] = useState<RenderRow[]>([])
  const [inventoryLocationMoveRows, setInventoryLocationMoveRows] = useState<RenderRow[]>([])

  function resolveProductCitySeedRows() {
    return buildDealerProductPageRows(
      directProjection ?? publishedProjection,
      directInventory ?? sqlInventory,
      directProductItems ?? productItems,
    )
  }

  function resolveProductStoreSeedRows() {
    return buildStoreProductPageRows(
      directProjection ?? publishedProjection,
      directInventory ?? sqlInventory,
    )
  }

  function resolveProductDepotSeedRows() {
    const depotRows = buildDepotProductPageRows(
      directProjection ?? publishedProjection,
      directSerialItems ?? sqlSerialItems,
    )
    if (depotRows.length) return depotRows
    return buildLibraryProductRows(directProductItems ?? productItems, 'depot')
  }

  function resolveProductHotSaleSeedRows() {
    return buildCashierHotSaleRows(
      directSalesOrders ?? sqlSalesOrders,
      directProjection ?? publishedProjection,
      directInventory ?? sqlInventory,
    )
  }

  function resolveProductSupplierSeedRows() {
    return buildSupplierManagementRows(
      directSerialItems ?? sqlSerialItems,
      directInventory ?? sqlInventory,
    )
  }

  function resolveOrderOfflineSeedRows() {
    return buildOrderPageRows(directSalesOrders ?? sqlSalesOrders)
  }

  function resolveOrderOfflineRefundSeedRows() {
    const retailRows = buildOfflineRefundRows(directRetailCoreMovements ?? retailCoreMovements)
    if (retailRows.length) return retailRows
    return buildOfflineRefundSnapshotRows(sqlMovements)
  }

  function resolveOrderOnlineSeedRows() {
    return buildOnlineOrderRows(directSalesOrders ?? sqlSalesOrders)
  }

  function resolveOrderOnlineRefundSeedRows() {
    return buildOnlineRefundRows(directSalesOrders ?? sqlSalesOrders)
  }

  function resolveInventoryMovementSeedRows() {
    const retailRows = buildInventoryMovementRows(directRetailCoreMovements ?? retailCoreMovements)
    if (retailRows.length) return retailRows
    return buildInventoryMovementSnapshotRows(sqlMovements)
  }

  function resolveInventoryLocationSeedRows() {
    const retailRows = buildInventoryLocationRows(directSerialItems ?? sqlSerialItems, directInventory ?? sqlInventory)
    if (retailRows.length) return retailRows
    return buildInventoryLocationFallbackRows(directInventory ?? sqlInventory)
  }

  function resolveInventoryLocationMoveSeedRows() {
    const retailRows = buildLocationMoveRows(directSerialItems ?? sqlSerialItems, directInventory ?? sqlInventory)
    if (retailRows.length) return retailRows
    return buildLocationMoveFallbackRows(directInventory ?? sqlInventory)
  }

  async function fetchInventoryMovementApiFallback() {
    try {
      const response = await fetch(`/api/retail-core/inventory-movements?limit=120&ts=${Date.now()}`, {
        cache: 'no-store',
      })
      if (!response.ok) return null
      const payload = await response.json() as RetailCoreMovements
      return Array.isArray(payload.items) && payload.items.length ? payload : null
    } catch {
      return null
    }
  }

  async function fetchInventoryMovementStaticFallback(): Promise<
    | { type: 'retail'; payload: RetailCoreMovements }
    | { type: 'snapshot'; payload: InventoryMovementsSnapshot }
    | null
  > {
    return null
  }

  async function fetchRetailCoreSerialItemsStaticFallback(): Promise<RetailCoreSerialItems | null> {
    return null
  }

  async function fetchInventoryStaticFallback(): Promise<StandardInventorySnapshot | null> {
    return null
  }

  async function fetchRetailCoreSalesOrdersStaticFallback(): Promise<RetailCoreSalesOrders | null> {
    return null
  }

  async function fetchPublishedProjectionStaticFallback(): Promise<PublishedProductProjectionSnapshot | null> {
    return null
  }

  async function fetchProductLibraryProductsStaticFallback(): Promise<ProductLibraryProductsSnapshot | null> {
    return null
  }

  async function fetchInventoryMovementsStaticSnapshot(): Promise<InventoryMovementsSnapshot | null> {
    return null
  }

  const activeTopMenu = useMemo(
    () => zdtTopMenus.find((item) => item.key === activeTopMenuKey) ?? zdtTopMenus[0],
    [activeTopMenuKey],
  )

  const flattenedSubmenus = useMemo(
    () => activeTopMenu.groups.flatMap((group) => group.items),
    [activeTopMenu],
  )

  const activeSubmenu = useMemo(
    () => flattenedSubmenus.find((item) => item.key === activeSubmenuKey) ?? getFirstSubmenu(activeTopMenu),
    [activeSubmenuKey, activeTopMenu, flattenedSubmenus],
  )

  const activeReplicaSpec = useMemo(
    () => zdtSubmenuReplicaSpecByLabel[activeSubmenu.label] ?? null,
    [activeSubmenu.label],
  )

  function resolveProductDetailId(row?: RenderRow) {
    if (row?.meta?.productId) return row.meta.productId
    const skuKey = row?.meta?.skuKey
    if (!skuKey) return null
    const directProjectionItem = directProjection?.items?.find((item) => item.skuKey === skuKey) as (PublishedProductProjectionSnapshot['items'][number] & { productId?: string }) | undefined
    const projectionItem = publishedProjection?.items?.find((item) => item.skuKey === skuKey) as (PublishedProductProjectionSnapshot['items'][number] & { productId?: string }) | undefined
    return directProjectionItem?.productId
      ?? projectionItem?.productId
      ?? directProductItems?.items?.find((item) => item.primary_sku_key === skuKey)?.id
      ?? productItems?.items?.find((item) => item.primary_sku_key === skuKey)?.id
      ?? null
  }

  function resolveProductDetail(row?: RenderRow) {
    const productId = resolveProductDetailId(row)
    return productId ? productDetailCache[productId] ?? null : null
  }

  useEffect(() => {
    const defaultTab = activeReplicaSpec?.tabs.includes('全部') ? '全部' : ''
    setActiveStatusTab(defaultTab)
    setPageIndex(1)
    setSearchKeyword('')
    setFilterInputValues({})
    setFilterSelectValues({})
    const range = resolveDateRange('全部')
    setDatePreset('全部')
    setDateStart(range.start)
    setDateEnd(range.end)
  }, [activeSubmenu.key, activeReplicaSpec])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('top', activeTopMenuKey)
    url.searchParams.set('submenu', activeSubmenu.key)
    window.history.replaceState({}, '', url.toString())
  }, [activeTopMenuKey, activeSubmenu.key])

  useEffect(() => {
    if (activeTopMenuKey !== 'product') return
    const rememberedRow = dialogRowContextBySubmenu[activeSubmenu.key]
    const productId = resolveProductDetailId(rememberedRow)
    if (!productId || productDetailCache[productId] !== undefined) return
    let cancelled = false
    getProductLibraryProduct(productId)
      .then((detail) => {
        if (cancelled) return
        setProductDetailCache((current) => {
          if (current[productId] !== undefined) return current
          return { ...current, [productId]: detail }
        })
      })
      .catch(() => {
        if (cancelled) return
        setProductDetailCache((current) => {
          if (current[productId] !== undefined) return current
          return { ...current, [productId]: null }
        })
      })
    return () => {
      cancelled = true
    }
  }, [
    activeSubmenu.key,
    activeTopMenuKey,
    dialogRowContextBySubmenu,
    directProductItems,
    directProjection,
    productDetailCache,
    productItems,
    publishedProjection,
  ])

  useEffect(() => {
    let active = true
    const bind = <T,>(loader: Promise<T | null>, setter: (value: T) => void) => {
      loader
        .then((payload) => {
          if (!active || !payload) return
          setter(payload)
        })
        .catch(() => undefined)
    }
    bind(getRetailCoreStatus(), setSqlStatus)
    bind(getLiveInventorySnapshot({ compact: true }), setSqlInventory)
    bind(getInventoryMovementsSnapshot(), setSqlMovements)
    bind(getRetailCoreMovements(120), setRetailCoreMovements)
    bind(getRetailCoreSalesOrders(120), setSqlSalesOrders)
    bind(getRetailCoreCustomers(120), setSqlCustomers)
    bind(getRetailCoreSerialItems(120), setSqlSerialItems)
    bind(getSnSalesComplianceSnapshot(2400), setSqlSnSalesCompliance)
    bind(getProductLibraryOverview(), setProductOverview)
    bind(getProductLibraryCategories(), setProductCategories)
    bind(getProductLibraryProducts(120), setProductItems)
    bind(getPublishedProductProjectionSnapshot(), setPublishedProjection)
    bind(getZdtOpenclawBridgeSnapshot(), setOpenclawBridge)
    bind(getOpenClawReceiptSnapshot(), setOpenclawReceipts)
    bind(getOpenClawCommandBoardSnapshot(), setOpenclawCommands)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (directSalesOrders?.items?.length || sqlSalesOrders?.items?.length) return
    let active = true
    getRetailCoreSalesOrders(120)
      .then((payload) => {
        if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
        setDirectSalesOrders(payload)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [directSalesOrders, sqlSalesOrders])

  useEffect(() => {
    if (directInventory?.skus?.length || sqlInventory?.skus?.length) return
    let active = true
    getLiveInventorySnapshot({ compact: true })
      .then((payload) => {
        if (!active || !payload || !Array.isArray(payload.skus) || payload.skus.length === 0) return
        setDirectInventory(payload)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [directInventory, sqlInventory])

  useEffect(() => {
    if (directProjection?.items?.length || publishedProjection?.items?.length) return
    let active = true
    getPublishedProductProjectionSnapshot()
      .then((payload) => {
        if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
        setDirectProjection(payload)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [directProjection, publishedProjection])

  useEffect(() => {
    if (directProductItems?.items?.length || productItems?.items?.length) return
    let active = true
    getProductLibraryProducts(120)
      .then((payload) => {
        if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
        setDirectProductItems(payload)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [directProductItems, productItems])

  useEffect(() => {
    if (directSerialItems?.items?.length || sqlSerialItems?.items?.length) return
    let active = true
    getRetailCoreSerialItems(120)
      .then((payload) => {
        if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
        setDirectSerialItems(payload)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [directSerialItems, sqlSerialItems])

  useEffect(() => {
    if (directRetailCoreMovements?.items?.length || retailCoreMovements?.items?.length) return
    let active = true
    getRetailCoreMovements(120)
      .then((payload) => {
        if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
        setDirectRetailCoreMovements(payload)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [directRetailCoreMovements, retailCoreMovements])

  useEffect(() => {
    let active = true

    if (activeSubmenu.key === 'product-depot'
      && !(directProjection?.items?.length || publishedProjection?.items?.length)) {
      setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
      fetch(`/api/inventory-quote/published-product-projection?ts=${Date.now()}`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
          setDirectProjection(payload as PublishedProductProjectionSnapshot)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        })
        .catch(() => undefined)
    }

    if (activeSubmenu.key === 'product-depot'
      && !(directProductItems?.items?.length || productItems?.items?.length)) {
      setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
      fetch(`/api/product-library/products?limit=120&ts=${Date.now()}`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
          setDirectProductItems(payload as ProductLibraryProductsSnapshot)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        })
        .catch(() => undefined)
    }

    if ((activeSubmenu.key === 'inventory-location' || activeSubmenu.key === 'inventory-location-move')
      && !(directSerialItems?.items?.length || sqlSerialItems?.items?.length)) {
      setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
      fetch(`/api/retail-core/serial-items?limit=120&ts=${Date.now()}`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
          setDirectSerialItems(payload as RetailCoreSerialItems)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        })
        .catch(() => undefined)
    }

    return () => {
      active = false
    }
  }, [activeSubmenu.key, directProductItems, directProjection, directRetailCoreMovements, directSalesOrders, directSerialItems, productItems, publishedProjection, retailCoreMovements, sqlMovements, sqlSalesOrders, sqlSerialItems])

  useEffect(() => {
    let active = true

    async function loadSubmenuRows() {
      if (activeSubmenu.key === 'product-city') {
        const seedRows = resolveProductCitySeedRows()
        if (seedRows.length) {
          setProductCityRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchPublishedProjectionStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectProjection((current) => current?.items?.length ? current : payload)
            const nextRows = buildDealerProductPageRows(
              payload,
              directInventory ?? sqlInventory,
              directProductItems ?? productItems,
            )
            if (nextRows.length) {
              setProductCityRows((current) => current.length ? current : nextRows)
            }
          })
          void fetchProductLibraryProductsStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectProductItems((current) => current?.items?.length ? current : payload)
            const nextRows = buildDealerProductPageRows(
              directProjection ?? publishedProjection,
              directInventory ?? sqlInventory,
              payload,
            )
            if (nextRows.length) {
              setProductCityRows((current) => current.length ? current : nextRows)
            }
          })
          const [projectionResult, inventoryResult, productResult] = await Promise.allSettled([
            getPublishedProductProjectionSnapshot(),
            getLiveInventorySnapshot({ compact: true }),
            getProductLibraryProducts(120),
          ])
          if (!active) return
          const projectionPayload = projectionResult.status === 'fulfilled' ? projectionResult.value : null
          const inventoryPayload = inventoryResult.status === 'fulfilled' ? inventoryResult.value : null
          const productPayload = productResult.status === 'fulfilled' ? productResult.value : null
          if (projectionPayload?.items?.length) setDirectProjection(projectionPayload)
          if (inventoryPayload?.skus?.length) setDirectInventory(inventoryPayload)
          if (productPayload?.items?.length) setDirectProductItems(productPayload)
          setProductCityRows(buildDealerProductPageRows(
            projectionPayload ?? directProjection ?? publishedProjection,
            inventoryPayload ?? directInventory ?? sqlInventory,
            productPayload ?? directProductItems ?? productItems,
          ))
        } finally {
          if (active) setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        }
      }

      if (activeSubmenu.key === 'product-store') {
        const seedRows = resolveProductStoreSeedRows()
        if (seedRows.length) {
          setProductStoreRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          const [projectionPayload, inventoryPayload] = await Promise.all([
            getPublishedProductProjectionSnapshot(),
            getLiveInventorySnapshot({ compact: true }),
          ])
          if (!active || !projectionPayload || !Array.isArray(projectionPayload.items) || projectionPayload.items.length === 0) return
          const initialRows = buildStoreProductPageRows(projectionPayload, inventoryPayload ?? directInventory ?? sqlInventory)
          setDirectProjection(projectionPayload)
          if (inventoryPayload?.skus?.length) {
            setDirectInventory(inventoryPayload)
          }
          setProductStoreRows(initialRows)
        } catch {
          return
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'product-depot') {
        const seedRows = resolveProductDepotSeedRows()
        if (seedRows.length) {
          setProductDepotRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          const [projectionResult, productResult, serialResult] = await Promise.allSettled([
            getPublishedProductProjectionSnapshot(),
            getProductLibraryProducts(120),
            getRetailCoreSerialItems(120),
          ])
          if (!active) return
          const projectionPayload = projectionResult.status === 'fulfilled' ? projectionResult.value : null
          const productPayload = productResult.status === 'fulfilled' ? productResult.value : null
          const serialPayload = serialResult.status === 'fulfilled' ? serialResult.value : null
          if (projectionPayload?.items?.length) {
            setDirectProjection(projectionPayload)
          }
          if (productPayload?.items?.length) {
            setDirectProductItems(productPayload)
          }
          if (serialPayload?.items?.length) {
            setDirectSerialItems(serialPayload)
          }
          const depotRows = buildDepotProductPageRows(
            projectionPayload ?? directProjection ?? publishedProjection,
            serialPayload ?? directSerialItems ?? sqlSerialItems,
          )
          setProductDepotRows(
            depotRows.length ? depotRows : buildLibraryProductRows(productPayload ?? directProductItems ?? productItems, 'depot'),
          )
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'order-offline') {
        const seedRows = resolveOrderOfflineSeedRows()
        if (seedRows.length) {
          setOrderOfflineRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSalesOrders((current) => current?.items?.length ? current : payload)
            setOrderOfflineRows((current) => current.length ? current : buildOrderPageRows(payload))
          })
          const payload = await getRetailCoreSalesOrders(120)
          if (!active || !payload?.items?.length) return
          setDirectSalesOrders(payload)
          setOrderOfflineRows(buildOrderPageRows(payload))
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'order-offline-refund') {
        const seedRows = resolveOrderOfflineRefundSeedRows()
        if (seedRows.length) {
          setOrderOfflineRefundRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchInventoryMovementsStaticSnapshot().then((payload) => {
            if (!active || !payload?.records?.length) return
            setSqlMovements(payload)
            const fallbackRows = buildOfflineRefundSnapshotRows(payload)
            if (fallbackRows.length) {
              setOrderOfflineRefundRows((current) => current.length ? current : fallbackRows)
            }
          })
          const response = await fetch(`/api/retail-core/inventory-movements?limit=4000&ts=${Date.now()}`, { cache: 'no-store' })
          const payload = response.ok ? await response.json() as RetailCoreMovements : null
          if (!active || !payload?.items?.length) return
          setDirectRetailCoreMovements(payload)
          const refundRows = buildOfflineRefundRows(payload)
          if (refundRows.length) {
            setOrderOfflineRefundRows(refundRows)
          }
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'order-online') {
        const seedRows = resolveOrderOnlineSeedRows()
        if (seedRows.length) {
          setOrderOnlineRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSalesOrders((current) => current?.items?.length ? current : payload)
            setOrderOnlineRows((current) => current.length ? current : buildOnlineOrderRows(payload))
          })
          const payload = await getRetailCoreSalesOrders(120)
          if (!active || !payload?.items?.length) return
          setDirectSalesOrders(payload)
          setOrderOnlineRows(buildOnlineOrderRows(payload))
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'order-online-refund') {
        const seedRows = resolveOrderOnlineRefundSeedRows()
        if (seedRows.length) {
          setOrderOnlineRefundRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSalesOrders((current) => current?.items?.length ? current : payload)
            setOrderOnlineRefundRows((current) => current.length ? current : buildOnlineRefundRows(payload))
          })
          const payload = await getRetailCoreSalesOrders(120)
          if (!active || !payload?.items?.length) return
          setDirectSalesOrders(payload)
          setOrderOnlineRefundRows(buildOnlineRefundRows(payload))
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (
        activeSubmenu.key.startsWith('report-')
        || activeSubmenu.key.startsWith('finance-')
        || activeSubmenu.key.startsWith('account-')
        || activeSubmenu.key.startsWith('device-')
      ) {
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSalesOrders((current) => current?.items?.length ? current : payload)
          })
          const payload = await getRetailCoreSalesOrders(120)
          if (!active || !payload?.items?.length) return
          setDirectSalesOrders(payload)
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'product-hot-sale') {
        const seedRows = resolveProductHotSaleSeedRows()
        if (seedRows.length) {
          setProductHotSaleRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSalesOrders((current) => current?.items?.length ? current : payload)
            const nextRows = buildCashierHotSaleRows(
              payload,
              directProjection ?? publishedProjection,
              directInventory ?? sqlInventory,
            )
            if (nextRows.length) {
              setProductHotSaleRows((current) => current.length ? current : nextRows)
            }
          })
          void fetchPublishedProjectionStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectProjection((current) => current?.items?.length ? current : payload)
            const nextRows = buildCashierHotSaleRows(
              directSalesOrders ?? sqlSalesOrders,
              payload,
              directInventory ?? sqlInventory,
            )
            if (nextRows.length) {
              setProductHotSaleRows((current) => current.length ? current : nextRows)
            }
          })
          void fetchInventoryStaticFallback().then((payload) => {
            if (!active || !payload?.skus?.length) return
            setDirectInventory((current) => current?.skus?.length ? current : payload)
            const nextRows = buildCashierHotSaleRows(
              directSalesOrders ?? sqlSalesOrders,
              directProjection ?? publishedProjection,
              payload,
            )
            if (nextRows.length) {
              setProductHotSaleRows((current) => current.length ? current : nextRows)
            }
          })
          const [salesResult, projectionResult, inventoryResult] = await Promise.allSettled([
            getRetailCoreSalesOrders(120),
            getPublishedProductProjectionSnapshot(),
            getLiveInventorySnapshot({ compact: true }),
          ])
          if (!active) return
          const salesPayload = salesResult.status === 'fulfilled' ? salesResult.value : null
          const projectionPayload = projectionResult.status === 'fulfilled' ? projectionResult.value : null
          const inventoryPayload = inventoryResult.status === 'fulfilled' ? inventoryResult.value : null
          if (salesPayload?.items?.length) setDirectSalesOrders(salesPayload)
          if (projectionPayload?.items?.length) setDirectProjection(projectionPayload)
          if (inventoryPayload?.skus?.length) setDirectInventory(inventoryPayload)
          setProductHotSaleRows(buildCashierHotSaleRows(
            salesPayload ?? directSalesOrders ?? sqlSalesOrders,
            projectionPayload ?? directProjection ?? publishedProjection,
            inventoryPayload ?? directInventory ?? sqlInventory,
          ))
        } finally {
          if (active) setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        }
      }

      if (activeSubmenu.key === 'product-supplier') {
        const seedRows = resolveProductSupplierSeedRows()
        if (seedRows.length) {
          setProductSupplierRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchRetailCoreSerialItemsStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSerialItems((current) => current?.items?.length ? current : payload)
            const nextRows = buildSupplierManagementRows(
              payload,
              directInventory ?? sqlInventory,
            )
            if (nextRows.length) {
              setProductSupplierRows((current) => current.length ? current : nextRows)
            }
          })
          void fetchInventoryStaticFallback().then((payload) => {
            if (!active || !payload?.skus?.length) return
            setDirectInventory((current) => current?.skus?.length ? current : payload)
            const nextRows = buildSupplierManagementRows(
              directSerialItems ?? sqlSerialItems,
              payload,
            )
            if (nextRows.length) {
              setProductSupplierRows((current) => current.length ? current : nextRows)
            }
          })
          const [serialResult, inventoryResult] = await Promise.allSettled([
            getRetailCoreSerialItems(5000),
            getLiveInventorySnapshot({ compact: true }),
          ])
          if (!active) return
          const serialPayload = serialResult.status === 'fulfilled' ? serialResult.value : null
          const inventoryPayload = inventoryResult.status === 'fulfilled' ? inventoryResult.value : null
          if (serialPayload?.items?.length) setDirectSerialItems(serialPayload)
          if (inventoryPayload?.skus?.length) setDirectInventory(inventoryPayload)
          setProductSupplierRows(buildSupplierManagementRows(
            serialPayload ?? directSerialItems ?? sqlSerialItems,
            inventoryPayload ?? directInventory ?? sqlInventory,
          ))
        } finally {
          if (active) setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        }
      }

      if (activeSubmenu.key === 'inventory-movement') {
        const seedRows = resolveInventoryMovementSeedRows()
        if (seedRows.length) {
          setInventoryMovementRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchInventoryMovementStaticFallback().then((fallback) => {
            if (!active || !fallback) return
            if (fallback.type === 'retail') {
              setDirectRetailCoreMovements((current) => current?.items?.length ? current : fallback.payload)
              const fallbackRows = buildInventoryMovementRows(fallback.payload)
              if (fallbackRows.length) {
                setInventoryMovementRows((current) => (current.length ? current : fallbackRows))
              }
              return
            }
            setSqlMovements((current) => current?.records?.length ? current : fallback.payload)
            const fallbackRows = buildInventoryMovementSnapshotRows(fallback.payload)
            if (fallbackRows.length) {
              setInventoryMovementRows((current) => (current.length ? current : fallbackRows))
            }
          })
          void getInventoryMovementsSnapshot().then((snapshotPayload) => {
            if (!active) return
            const snapshotRows = buildInventoryMovementSnapshotRows(snapshotPayload)
            if (snapshotPayload?.records?.length) {
              setSqlMovements(snapshotPayload)
            }
            if (snapshotRows.length) {
              setInventoryMovementRows((current) => (current.length ? current : snapshotRows))
            }
          })
          const retailFallbackPromise = fetchInventoryMovementApiFallback()
          const retailPayload = await getRetailCoreMovements(120)
          if (!active) return
          const retailRows = buildInventoryMovementRows(retailPayload)
          if (retailPayload?.items?.length) {
            setDirectRetailCoreMovements(retailPayload)
          }
          if (retailRows.length) {
            setInventoryMovementRows(retailRows)
            return
          }
          const retailFallbackPayload = await retailFallbackPromise
          if (!active) return
          const retailFallbackRows = buildInventoryMovementRows(retailFallbackPayload)
          if (retailFallbackPayload?.items?.length) {
            setDirectRetailCoreMovements(retailFallbackPayload)
          }
          if (retailFallbackRows.length) {
            setInventoryMovementRows(retailFallbackRows)
            return
          }
        } catch {
          return
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (['inventory-stock-order', 'inventory-transfer-out', 'inventory-transfer-in', 'inventory-purchase-in', 'inventory-other-io'].includes(activeSubmenu.key)
        && !(directRetailCoreMovements?.items?.length || retailCoreMovements?.items?.length || sqlMovements?.records?.length)) {
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchInventoryMovementStaticFallback().then((fallback) => {
            if (!active || !fallback) return
            if (fallback.type === 'retail') {
              setDirectRetailCoreMovements((current) => current?.items?.length ? current : fallback.payload)
              return
            }
            setSqlMovements((current) => current?.records?.length ? current : fallback.payload)
          })
          const retailPayload = await getRetailCoreMovements(120)
          if (!active) return
          if (retailPayload?.items?.length) {
            setDirectRetailCoreMovements(retailPayload)
            return
          }
          const snapshotPayload = await getInventoryMovementsSnapshot()
          if (!active) return
          if (snapshotPayload?.records?.length) {
            setSqlMovements(snapshotPayload)
          }
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'inventory-sn-order'
        && !(directSerialItems?.items?.length || sqlSerialItems?.items?.length || directInventory?.skus?.length || sqlInventory?.skus?.length)) {
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchRetailCoreSerialItemsStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSerialItems((current) => current?.items?.length ? current : payload)
          })
          const serialPayload = await getRetailCoreSerialItems(120)
          if (!active) return
          if (serialPayload?.items?.length) {
            setDirectSerialItems(serialPayload)
            return
          }
          const inventoryPayload = await getLiveInventorySnapshot({ compact: true })
          if (!active) return
          if (inventoryPayload?.skus?.length) {
            setDirectInventory(inventoryPayload)
          }
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'inventory-location') {
        const seedRows = resolveInventoryLocationSeedRows()
        if (seedRows.length) {
          setInventoryLocationRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchInventoryStaticFallback().then((payload) => {
            if (!active || !payload?.skus?.length) return
            setDirectInventory((current) => current?.skus?.length ? current : payload)
            const fallbackRows = buildInventoryLocationFallbackRows(payload)
            if (fallbackRows.length) {
              setInventoryLocationRows((current) => current.length ? current : fallbackRows)
            }
          })
          void fetchRetailCoreSerialItemsStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSerialItems((current) => current?.items?.length ? current : payload)
            const retailRows = buildInventoryLocationRows(payload, directInventory ?? sqlInventory)
            if (retailRows.length) {
              setInventoryLocationRows((current) => current.length ? current : retailRows)
            }
          })
          const [serialResult, inventoryResult] = await Promise.allSettled([
            getRetailCoreSerialItems(5000),
            getLiveInventorySnapshot({ compact: true }),
          ])
          if (!active) return
          const serialPayload = serialResult.status === 'fulfilled' ? serialResult.value : null
          const inventoryPayload = inventoryResult.status === 'fulfilled' ? inventoryResult.value : null
          if (serialPayload?.items?.length) setDirectSerialItems(serialPayload)
          if (inventoryPayload?.skus?.length) setDirectInventory(inventoryPayload)
          const retailRows = buildInventoryLocationRows(
            serialPayload ?? directSerialItems ?? sqlSerialItems,
            inventoryPayload ?? directInventory ?? sqlInventory,
          )
          setInventoryLocationRows(retailRows.length
            ? retailRows
            : buildInventoryLocationFallbackRows(inventoryPayload ?? directInventory ?? sqlInventory))
        } finally {
          if (active) setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        }
      }

      if (activeSubmenu.key === 'inventory-location-move'
        && !(directSerialItems?.items?.length || sqlSerialItems?.items?.length || directInventory?.skus?.length || sqlInventory?.skus?.length)) {
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          const [serialPayload, inventoryPayload] = await Promise.all([
            getRetailCoreSerialItems(120),
            getLiveInventorySnapshot({ compact: true }),
          ])
          if (!active) return
          if (serialPayload?.items?.length) {
            setDirectSerialItems(serialPayload)
          }
          if (inventoryPayload?.skus?.length) {
            setDirectInventory(inventoryPayload)
          }
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }

      if (activeSubmenu.key === 'inventory-location-move') {
        const seedRows = resolveInventoryLocationMoveSeedRows()
        if (seedRows.length) {
          setInventoryLocationMoveRows(seedRows)
          setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          return
        }
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          void fetchInventoryStaticFallback().then((payload) => {
            if (!active || !payload?.skus?.length) return
            setDirectInventory((current) => current?.skus?.length ? current : payload)
            const fallbackRows = buildLocationMoveFallbackRows(payload)
            if (fallbackRows.length) {
              setInventoryLocationMoveRows((current) => current.length ? current : fallbackRows)
            }
          })
          void fetchRetailCoreSerialItemsStaticFallback().then((payload) => {
            if (!active || !payload?.items?.length) return
            setDirectSerialItems((current) => current?.items?.length ? current : payload)
            const retailRows = buildLocationMoveRows(payload, directInventory ?? sqlInventory)
            if (retailRows.length) {
              setInventoryLocationMoveRows((current) => current.length ? current : retailRows)
            }
          })
          const [serialResult, inventoryResult] = await Promise.allSettled([
            getRetailCoreSerialItems(5000),
            getLiveInventorySnapshot({ compact: true }),
          ])
          if (!active) return
          const serialPayload = serialResult.status === 'fulfilled' ? serialResult.value : null
          const inventoryPayload = inventoryResult.status === 'fulfilled' ? inventoryResult.value : null
          if (serialPayload?.items?.length) setDirectSerialItems(serialPayload)
          if (inventoryPayload?.skus?.length) setDirectInventory(inventoryPayload)
          const moveRows = buildLocationMoveRows(
            serialPayload ?? directSerialItems ?? sqlSerialItems,
            inventoryPayload ?? directInventory ?? sqlInventory,
          )
          setInventoryLocationMoveRows(moveRows.length
            ? moveRows
            : buildLocationMoveFallbackRows(inventoryPayload ?? directInventory ?? sqlInventory))
        } finally {
          if (active) setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        }
      }

      if (activeSubmenu.key === 'report-sn-valid' && !(sqlSnSalesCompliance?.items?.length)) {
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          const payload = await getSnSalesComplianceSnapshot(2400)
          if (!active || !payload?.items?.length) return
          setSqlSnSalesCompliance(payload)
        } finally {
          if (active) setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
        }
      }

      const inventorySerialDetailSubmenus = ['inventory-stock', 'inventory-config-center']
      const inventoryMovementDetailSubmenus = ['inventory-stock', 'inventory-config-center']
      const inventoryConfigNeedsSerials = inventorySerialDetailSubmenus.includes(activeSubmenu.key)
        && !(directSerialItems?.items?.length || sqlSerialItems?.items?.length)
      const inventoryConfigNeedsMovements = inventoryMovementDetailSubmenus.includes(activeSubmenu.key)
        && !(directRetailCoreMovements?.items?.length || retailCoreMovements?.items?.length || sqlMovements?.records?.length)
      const inventoryFamilyNeedsInventory = ['inventory-stock', 'inventory-overview', 'inventory-cost-price', 'inventory-config-center'].includes(activeSubmenu.key)
        && !(directInventory?.skus?.length || sqlInventory?.skus?.length)
      if (inventoryFamilyNeedsInventory || inventoryConfigNeedsSerials || inventoryConfigNeedsMovements) {
        setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
        try {
          if (inventoryFamilyNeedsInventory) {
            void fetchInventoryStaticFallback().then((payload) => {
              if (!active || !payload?.skus?.length) return
              setDirectInventory((current) => current?.skus?.length ? current : payload)
            })
          }
          if (inventoryConfigNeedsMovements) {
            void fetchInventoryMovementStaticFallback().then((fallback) => {
              if (!active || !fallback) return
              if (fallback.type === 'retail') {
                setDirectRetailCoreMovements((current) => current?.items?.length ? current : fallback.payload)
                return
              }
              setSqlMovements((current) => current?.records?.length ? current : fallback.payload)
            })
          }
          const [inventoryPayload, categoriesPayload, serialPayload, retailMovementPayload, snapshotMovementPayload] = await Promise.all([
            getLiveInventorySnapshot({ compact: true }),
            activeSubmenu.key === 'inventory-overview' ? getProductLibraryCategories() : Promise.resolve(null),
            inventorySerialDetailSubmenus.includes(activeSubmenu.key) ? getRetailCoreSerialItems(5000) : Promise.resolve(null),
            inventoryMovementDetailSubmenus.includes(activeSubmenu.key) ? getRetailCoreMovements(120) : Promise.resolve(null),
            inventoryMovementDetailSubmenus.includes(activeSubmenu.key) ? getInventoryMovementsSnapshot() : Promise.resolve(null),
          ])
          if (!active) return
          if (inventoryPayload?.skus?.length) {
            setDirectInventory(inventoryPayload)
          }
          if (categoriesPayload?.items?.length) {
            setProductCategories(categoriesPayload)
          }
          if (serialPayload?.items?.length) {
            setDirectSerialItems(serialPayload)
          } else if (inventorySerialDetailSubmenus.includes(activeSubmenu.key)) {
            void fetchRetailCoreSerialItemsStaticFallback().then((payload) => {
              if (!active || !payload?.items?.length) return
              setDirectSerialItems((current) => current?.items?.length ? current : payload)
            })
          }
          if (retailMovementPayload?.items?.length) {
            setDirectRetailCoreMovements(retailMovementPayload)
          } else if (snapshotMovementPayload?.records?.length) {
            setSqlMovements(snapshotMovementPayload)
          }
        } finally {
          if (active) {
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          }
        }
      }
    }

    void loadSubmenuRows()

    return () => {
      active = false
    }
  }, [activeSubmenu.key])

  useEffect(() => {
    if (activeSubmenu.key === 'product-store'
      || activeSubmenu.key === 'product-depot'
      || activeSubmenu.key === 'order-offline'
      || activeSubmenu.key === 'order-offline-refund'
      || activeSubmenu.key === 'order-online'
      || activeSubmenu.key === 'order-online-refund'
      || activeSubmenu.key === 'inventory-movement') {
      return
    }
    const needsProductPolling = activeSubmenu.key === 'product-depot'
      && !(directProjection?.items?.length || publishedProjection?.items?.length || directProductItems?.items?.length || productItems?.items?.length)
    const needsMovementPolling = false
    if (!needsProductPolling && !needsMovementPolling) {
      setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
      return
    }

    let active = true
    setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: true }))
    const timer = window.setInterval(() => {
      if (!active) return
      if (needsProductPolling) {
        fetch(`/api/inventory-quote/published-product-projection?ts=${Date.now()}`, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
            setDirectProjection(payload as PublishedProductProjectionSnapshot)
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          })
          .catch(() => undefined)
        fetch(`/api/product-library/products?limit=120&ts=${Date.now()}`, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
            setDirectProductItems(payload as ProductLibraryProductsSnapshot)
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          })
          .catch(() => undefined)
      }
      if (needsMovementPolling) {
        fetch(`/api/retail-core/inventory-movements?limit=120&ts=${Date.now()}`, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!active || !payload || !Array.isArray(payload.items) || payload.items.length === 0) return
            setDirectRetailCoreMovements(payload as RetailCoreMovements)
            setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
          })
          .catch(() => undefined)
        if (!(directRetailCoreMovements?.items?.length || retailCoreMovements?.items?.length)) {
          fetch(`/api/inventory-quote/inventory-movements?ts=${Date.now()}`, { cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
              if (!active || !payload || !Array.isArray(payload.records) || payload.records.length === 0) return
              setSqlMovements(payload as InventoryMovementsSnapshot)
              setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
            })
            .catch(() => undefined)
        }
      }
    }, 1800)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [activeSubmenu.key, directProductItems, directProjection, directRetailCoreMovements, productItems, publishedProjection, retailCoreMovements, sqlMovements])

  const livePanel = useMemo(() => buildZdtSubmenuLivePanel({
    submenuKey: activeSubmenu.key,
    status: sqlStatus,
    inventory: sqlInventory,
    movements: sqlMovements,
    salesOrders: sqlSalesOrders,
    customers: sqlCustomers,
    serialItems: sqlSerialItems,
    snSalesCompliance: sqlSnSalesCompliance,
    productOverview,
    productCategories,
    productItems,
    publishedProjection,
  }), [
    activeSubmenu.key,
    productCategories,
    productItems,
    productOverview,
    publishedProjection,
    sqlCustomers,
    sqlInventory,
    sqlMovements,
    sqlSalesOrders,
    sqlSerialItems,
    sqlSnSalesCompliance,
    sqlStatus,
  ])

  const openclawReplicaBinding = useMemo(
    () =>
      buildZdtOpenclawReplicaBinding({
        retailCoreStatus: sqlStatus,
        inventory: sqlInventory,
        inventoryMovements: sqlMovements,
        retailCoreSalesOrders: sqlSalesOrders,
        retailCoreSerialItems: sqlSerialItems,
        productOverview,
        productCategories,
        productItems,
        publishedProjection,
        openclawBridge,
        openclawReceipts,
        openclawCommands,
      }),
    [
      openclawBridge,
      openclawCommands,
      openclawReceipts,
      productCategories,
      productItems,
      productOverview,
      publishedProjection,
      sqlInventory,
      sqlMovements,
      sqlSalesOrders,
      sqlSerialItems,
      sqlStatus,
    ],
  )

  const bindingSection = useMemo(() => {
    if (!['organization', 'product', 'order', 'inventory'].includes(activeTopMenuKey)) return null
    return openclawReplicaBinding.menus[activeTopMenuKey as 'organization' | 'product' | 'order' | 'inventory']
  }, [activeTopMenuKey, openclawReplicaBinding])

  const specSubnav = activeReplicaSpec?.subnav ?? []
  const specCoversAllSubmenus = specSubnav.length >= flattenedSubmenus.length
  const subnavItems = (specCoversAllSubmenus ? specSubnav : flattenedSubmenus.map((item) => ({
    key: item.key,
    label: item.label,
    url: item.url,
    summary: item.summary,
    targetDomain: item.targetDomain,
  })))

  const toolbarButtons = activeReplicaSpec?.toolbarButtons ?? []
  const detailEntranceButtons = uniqueOrdered(activeReplicaSpec?.detailEntrances ?? [])
  const tabs = activeReplicaSpec?.tabs ?? []
  const listHeaderOverrides: Record<string, string[]> = {
    'report-payment': ['门店名称', '支付渠道', '收款金额', '成功支付笔数', '退款金额', '退款笔数', '贴息金额', '净收金额', '成功支付订单数', '退款订单数'],
    'finance-pay-manage': ['门店编码', '门店名称', '收款方式', '协议状态', '请求结果状态', '微信授权状态', '支付宝授权状态', '短信签合同状态', '协议状态说明', '提交时间', '协议类型', '操作', '操作'],
  }
  const listHeaders = listHeaderOverrides[activeSubmenu.key]
    ?? (activeReplicaSpec?.tableHeaders.length ? activeReplicaSpec.tableHeaders : ['信息', '说明', '操作'])
  const operationColumnIndexes = listHeaders
    .map((header, headerIndex) => ({ header, headerIndex }))
    .filter((item) => item.header.includes('操作'))
    .map((item) => item.headerIndex)

  const filterControls = useMemo(() => {
    const controls: FilterControl[] = []
    const semanticKinds = new Map<string, FilterControl['kind']>()
    const labels = activeReplicaSpec?.filters.labelPairs ?? []
    const placeholders = activeReplicaSpec?.filters.inputPlaceholders ?? []
    const placeholderSemanticKeys = new Set(
      placeholders
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => normalizeFilterSemanticKey(item)),
    )

    labels.forEach((pair, index) => {
      const label = pair.labels[0]?.trim()
      if (!label) return
      const semanticKey = normalizeFilterSemanticKey(label)
      const kind: FilterControl['kind'] = isDateLikeField(label) ? 'date' : 'select'
      if (kind === 'date' && placeholderSemanticKeys.has('开始日期') && placeholderSemanticKeys.has('结束日期')) {
        return
      }
      if (placeholderSemanticKeys.has(semanticKey)) {
        return
      }
      if (semanticKinds.has(semanticKey)) return
      semanticKinds.set(semanticKey, kind)
      controls.push({
        key: `label-${index}-${label}`,
        label,
        kind,
      })
    })

    placeholders.forEach((placeholder, index) => {
      const label = placeholder.trim()
      if (!label) return
      const kind: FilterControl['kind'] = isDateLikeField(label) ? 'date' : 'text'
      const semanticKey = normalizeFilterSemanticKey(label)
      if (semanticKinds.has(semanticKey)) return
      semanticKinds.set(semanticKey, kind)
      controls.push({
        key: `placeholder-${index}-${label}`,
        label,
        kind,
        prominent: !isDateLikeField(label) && controls.every((item) => item.kind !== 'text'),
      })
    })
    return controls
  }, [activeReplicaSpec])
  const dateFieldLabels = filterControls.filter((item) => item.kind === 'date').map((item) => item.label).slice(0, 2)

  const normalizedRows = useMemo(() => {
    const rowActionPatterns = activeReplicaSpec?.rowActions ?? []
    let sourceRows: RenderRow[] = []
    if (activeSubmenu.key === 'product-city' && productCityRows.length) {
      sourceRows = productCityRows
    } else if (activeSubmenu.key === 'product-store' && productStoreRows.length) {
      sourceRows = productStoreRows
    } else if (activeSubmenu.key === 'product-depot' && productDepotRows.length) {
      sourceRows = productDepotRows
    } else if (activeSubmenu.key === 'product-hot-sale' && productHotSaleRows.length) {
      sourceRows = productHotSaleRows
    } else if (activeSubmenu.key === 'product-supplier' && productSupplierRows.length) {
      sourceRows = productSupplierRows
    } else if (activeSubmenu.key === 'order-offline' && orderOfflineRows.length) {
      sourceRows = orderOfflineRows
    } else if (activeSubmenu.key === 'order-offline-refund' && orderOfflineRefundRows.length) {
      sourceRows = orderOfflineRefundRows
    } else if (activeSubmenu.key === 'order-online' && orderOnlineRows.length) {
      sourceRows = orderOnlineRows
    } else if (activeSubmenu.key === 'order-online-refund' && orderOnlineRefundRows.length) {
      sourceRows = orderOnlineRefundRows
    } else if (activeSubmenu.key === 'inventory-movement' && inventoryMovementRows.length) {
      sourceRows = inventoryMovementRows
    } else if (activeSubmenu.key === 'inventory-location' && inventoryLocationRows.length) {
      sourceRows = inventoryLocationRows
    } else if (activeSubmenu.key === 'inventory-location-move' && inventoryLocationMoveRows.length) {
      sourceRows = inventoryLocationMoveRows
    } else {
      const overrideRows = submenuRowOverrides[activeSubmenu.key]
      if (overrideRows?.length) {
        sourceRows = overrideRows
      } else if (activeSubmenu.key === 'organization-shop') {
        sourceRows = buildOrganizationPageRows(directInventory ?? sqlInventory, directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'organization-warehouse') {
        sourceRows = buildWarehousePageRows(sqlSerialItems)
      } else if (activeSubmenu.key === 'order-offline') {
        sourceRows = buildOrderPageRows(directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'order-offline-refund') {
        const retailRows = buildOfflineRefundRows(directRetailCoreMovements ?? retailCoreMovements)
        sourceRows = retailRows.length ? retailRows : buildOfflineRefundSnapshotRows(sqlMovements)
      } else if (activeSubmenu.key === 'order-online') {
        sourceRows = buildOnlineOrderRows(directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'order-online-refund') {
        sourceRows = buildOnlineRefundRows(directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'product-city') {
        sourceRows = buildDealerProductPageRows(
          directProjection ?? publishedProjection,
          directInventory ?? sqlInventory,
          directProductItems ?? productItems,
        )
      } else if (activeSubmenu.key === 'product-store') {
        const storeRows = buildStoreProductPageRows(directProjection ?? publishedProjection, directInventory ?? sqlInventory)
        sourceRows = storeRows.length ? storeRows : buildLibraryProductRows(directProductItems ?? productItems, 'store')
      } else if (activeSubmenu.key === 'product-depot') {
        const depotRows = buildDepotProductPageRows(directProjection ?? publishedProjection, directSerialItems ?? sqlSerialItems)
        sourceRows = depotRows.length ? depotRows : buildLibraryProductRows(directProductItems ?? productItems, 'depot')
      } else if (activeSubmenu.key === 'product-hot-sale') {
        sourceRows = buildCashierHotSaleRows(
          directSalesOrders ?? sqlSalesOrders,
          directProjection ?? publishedProjection,
          directInventory ?? sqlInventory,
        )
      } else if (activeSubmenu.key === 'product-supplier') {
        sourceRows = buildSupplierManagementRows(directSerialItems ?? sqlSerialItems, directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'inventory-stock') {
        sourceRows = buildInventoryPageRows(directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'inventory-overview') {
        sourceRows = buildInventoryOverviewRows(directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'inventory-location') {
        const retailRows = buildInventoryLocationRows(directSerialItems ?? sqlSerialItems, directInventory ?? sqlInventory)
        sourceRows = retailRows.length ? retailRows : buildInventoryLocationFallbackRows(directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'inventory-location-move') {
        const moveRows = buildLocationMoveRows(directSerialItems ?? sqlSerialItems, directInventory ?? sqlInventory)
        sourceRows = moveRows.length ? moveRows : buildLocationMoveFallbackRows(directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'inventory-movement') {
        const retailRows = buildInventoryMovementRows(directRetailCoreMovements ?? retailCoreMovements)
        sourceRows = retailRows.length ? retailRows : buildInventoryMovementSnapshotRows(sqlMovements)
      } else if (activeSubmenu.key === 'inventory-stock-order') {
        const retailRows = buildInventoryStockOrderRows(directRetailCoreMovements ?? retailCoreMovements)
        sourceRows = retailRows.length ? retailRows : buildInventoryStockOrderSnapshotRows(sqlMovements)
      } else if (activeSubmenu.key === 'inventory-sn-order') {
        const serialRows = buildInventorySnOrderRows(directSerialItems ?? sqlSerialItems)
        sourceRows = serialRows.length ? serialRows : buildInventorySnOrderFallbackRows(directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'inventory-transfer-out') {
        const retailRows = buildTransferOutboundRows(directRetailCoreMovements ?? retailCoreMovements)
        sourceRows = retailRows.length ? retailRows : buildTransferOutboundSnapshotRows(sqlMovements)
      } else if (activeSubmenu.key === 'inventory-transfer-in') {
        const retailRows = buildTransferInboundRows(directRetailCoreMovements ?? retailCoreMovements)
        sourceRows = retailRows.length ? retailRows : buildTransferInboundSnapshotRows(sqlMovements)
      } else if (activeSubmenu.key === 'inventory-purchase-in') {
        const retailRows = buildPurchaseInboundRows(directRetailCoreMovements ?? retailCoreMovements)
        sourceRows = retailRows.length ? retailRows : buildPurchaseInboundSnapshotRows(sqlMovements)
      } else if (activeSubmenu.key === 'inventory-other-io') {
        const retailRows = buildOtherInventoryIoRows(directRetailCoreMovements ?? retailCoreMovements)
        sourceRows = retailRows.length ? retailRows : buildOtherInventoryIoSnapshotRows(sqlMovements)
      } else if (activeSubmenu.key === 'inventory-config-center') {
        sourceRows = buildInventoryConfigRows(directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'inventory-cost-price') {
        sourceRows = buildInventoryCostPriceRows(directInventory ?? sqlInventory)
      } else if (activeSubmenu.key === 'report-payment') {
        sourceRows = buildPaymentReportRows(directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'report-product') {
        sourceRows = buildProductReportRows(directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'report-sales-analysis') {
        sourceRows = buildSalesAnalysisRows(directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'report-sales-daily') {
        sourceRows = buildSalesDailyRows(directSalesOrders ?? sqlSalesOrders)
      } else if (activeSubmenu.key === 'report-sn-valid') {
        sourceRows = buildSnValidSalesRows(sqlSnSalesCompliance)
      } else if (activeSubmenu.key === 'finance-pay-manage') {
        sourceRows = buildFinanceChannelRows(directSalesOrders ?? sqlSalesOrders, 'payment')
      } else if (activeSubmenu.key === 'finance-self-signing') {
        sourceRows = buildFinanceChannelRows(directSalesOrders ?? sqlSalesOrders, 'signing')
      } else if (activeSubmenu.key === 'finance-balance') {
        sourceRows = buildFinanceChannelRows(directSalesOrders ?? sqlSalesOrders, 'balance')
      } else if (activeSubmenu.key === 'account-employee') {
      sourceRows = buildAccountEmployeeRows(directSalesOrders ?? sqlSalesOrders)
    } else if (activeSubmenu.key === 'account-target') {
      sourceRows = buildAccountTargetRows(directSalesOrders ?? sqlSalesOrders)
    } else if (activeSubmenu.key === 'device-pos-manage') {
      sourceRows = buildDevicePosRows(directSalesOrders ?? sqlSalesOrders, directInventory ?? sqlInventory)
    } else if (bindingSection?.rows.length) {
        sourceRows = bindingSection.rows.map((row, rowIndex) =>
          normalizeBindingRow(row, bindingSection, rowIndex, []),
        )
      } else {
        sourceRows = livePanel.rows.map((row, rowIndex) => normalizeLiveRow(row, rowIndex, []))
      }
    }
    return sourceRows.map((row, rowIndex) => ({
      ...row,
      actionLabels: resolveReplicaRowActions(row.actionLabels, rowIndex, rowActionPatterns, detailEntranceButtons),
    }))
  }, [activeReplicaSpec, activeSubmenu.key, bindingSection, detailEntranceButtons, directInventory, directProductItems, directProjection, directRetailCoreMovements, directSalesOrders, directSerialItems, inventoryLocationMoveRows, inventoryLocationRows, inventoryMovementRows, livePanel.rows, orderOfflineRefundRows, orderOfflineRows, orderOnlineRefundRows, orderOnlineRows, productCityRows, productDepotRows, productHotSaleRows, productItems, productStoreRows, productSupplierRows, publishedProjection, retailCoreMovements, sqlInventory, sqlMovements, sqlSalesOrders, sqlSerialItems, sqlSnSalesCompliance, submenuRowOverrides])

  const selectOptions = useMemo(() => {
    const options: Record<string, string[]> = {}
    filterControls.forEach((control) => {
      if (control.kind !== 'select') return
      const bindingFilter = bindingSection?.filters.find((item) => item.label === control.label)
      if (bindingFilter) {
        options[control.key] = bindingFilter.options.map((item) => item.label)
        return
      }
      options[control.key] = ['全部']
    })
    return options
  }, [bindingSection, filterControls])

  const filteredRows = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    return normalizedRows.filter((row) => {
      if (keyword && !row.searchableText.toLowerCase().includes(keyword)) return false
      if (activeStatusTab && activeStatusTab !== '全部' && !row.searchableText.toLowerCase().includes(activeStatusTab.toLowerCase())) return false
      for (const value of Object.values(filterInputValues)) {
        const normalized = value.trim().toLowerCase()
        if (normalized && !row.searchableText.toLowerCase().includes(normalized)) return false
      }
      for (const value of Object.values(filterSelectValues)) {
        const normalized = value.trim().toLowerCase()
        if (normalized && normalized !== '全部' && !row.searchableText.toLowerCase().includes(normalized)) return false
      }
      if (!dateStart && !dateEnd) return true
      const rowDate = extractComparableDate(row.searchableText)
      if (!rowDate) return true
      if (dateStart && rowDate < dateStart) return false
      if (dateEnd && rowDate > dateEnd) return false
      return true
    })
  }, [activeStatusTab, dateEnd, dateStart, filterInputValues, filterSelectValues, normalizedRows, searchKeyword])

  const reportPaymentSummary = useMemo<ZdtSummaryMetric[]>(() => {
    if (activeSubmenu.key !== 'report-payment') return []
    if (!filteredRows.length) return []
    const channelCount = new Set<string>()
    const shopCount = new Set<string>()
    let received = 0
    let refunded = 0
    let netAmount = 0
    let paidOrderCount = 0
    let refundedOrderCount = 0

    filteredRows.forEach((row) => {
      const shopName = buildDialogValue(row, 0)
      const channelName = buildDialogValue(row, 1)
      if (shopName && shopName !== '--') shopCount.add(shopName)
      if (channelName && channelName !== '--') channelCount.add(channelName)
      received += parseFormattedNumber(buildDialogValue(row, 2))
      refunded += parseFormattedNumber(buildDialogValue(row, 4))
      netAmount += parseFormattedNumber(buildDialogValue(row, 7))
      paidOrderCount += parseFormattedNumber(buildDialogValue(row, 8))
      refundedOrderCount += parseFormattedNumber(buildDialogValue(row, 9))
    })

    return [
      { label: '收款门店数', value: formatCellValue(shopCount.size) },
      { label: '支付渠道数', value: formatCellValue(channelCount.size) },
      { label: '收款金额合计', value: formatAmountDisplay(received) },
      { label: '退款金额合计', value: formatAmountDisplay(refunded) },
      { label: '净收金额合计', value: formatAmountDisplay(netAmount) },
      { label: '成功支付订单数', value: formatCellValue(paidOrderCount) },
      { label: '退款订单数', value: formatCellValue(refundedOrderCount) },
    ]
  }, [activeSubmenu.key, filteredRows])

  const rowsPerPage = 10
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage))
  const safePageIndex = Math.min(pageIndex, totalPages)
  const pageRows = filteredRows.slice((safePageIndex - 1) * rowsPerPage, safePageIndex * rowsPerPage)
  const activeSubmenuLoading = submenuLoadingState[activeSubmenu.key] === true
  const paginationWindow = useMemo(() => {
    const windowSize = 7
    const half = Math.floor(windowSize / 2)
    const start = Math.max(1, Math.min(safePageIndex - half, totalPages - windowSize + 1))
    const end = Math.min(totalPages, start + windowSize - 1)
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
  }, [safePageIndex, totalPages])

  const detailFieldLabels = useMemo(() => {
    const rawLabels = uniqueOrdered((activeReplicaSpec?.detail.fieldPairs ?? []).map((item) => item.labels[0]).filter(Boolean))
    if (rawLabels.length) return rawLabels
    const filterLabels = compactUniqueLabels(filterControls.map((item) => item.label))
    if (filterLabels.length) return filterLabels
    return listHeaders.filter((item) => !item.includes('操作'))
  }, [activeReplicaSpec, filterControls, listHeaders])

  const dialogButtons = useMemo(() => {
    const ignored = [
      ...zdtTopMenus.map((item) => item.label),
      ...subnavItems.map((item) => item.label),
      ...toolbarButtons,
      ...detailEntranceButtons,
      ...tabs,
      activeSubmenu.label,
      activeReplicaSpec?.submenu.pageTitle ?? '',
    ]
    return sanitizeDialogButtons(activeReplicaSpec?.detail.buttons ?? [], ignored)
  }, [activeReplicaSpec, activeSubmenu.label, detailEntranceButtons, subnavItems, tabs, toolbarButtons])

  useEffect(() => {
    if (!pendingDeepLinkDialog) return
    if (pendingDeepLinkDialog.submenuKey !== activeSubmenu.key) return
    if (!normalizedRows.length) return
    const row = pendingDeepLinkDialog.rowIndex === null
      ? undefined
      : normalizedRows[pendingDeepLinkDialog.rowIndex] ?? undefined
    openActionDialog(pendingDeepLinkDialog.actionLabel, row)
    setPendingDeepLinkDialog(null)
  }, [activeSubmenu.key, normalizedRows, pendingDeepLinkDialog])

  useEffect(() => {
    if (!activeDialog) return
    const normalizedActionLabel = normalizeDialogActionLabel(activeDialog.actionLabel)
    if (!['查看序列号', '销售成本记录', '库存流水'].includes(normalizedActionLabel)) return
    const rememberedRow = dialogRowContextBySubmenu[activeSubmenu.key]
    if (!rememberedRow && !activeDialog.hasRowContext) return
    const nextSections = buildDialogSections(rememberedRow, 'view', normalizedActionLabel)
    const currentSectionsSignature = JSON.stringify(activeDialog.sections)
    const nextSectionsSignature = JSON.stringify(nextSections)
    if (currentSectionsSignature === nextSectionsSignature) return
    setActiveDialog((current) => {
      if (!current || normalizeDialogActionLabel(current.actionLabel) !== normalizedActionLabel) return current
      return {
        ...current,
        hasRowContext: Boolean(rememberedRow),
        buttons: [],
        sections: nextSections,
      }
    })
  }, [
    activeDialog,
    activeSubmenu.key,
    dialogRowContextBySubmenu,
    directInventory,
    sqlInventory,
    directSerialItems,
    sqlSerialItems,
    directRetailCoreMovements,
    retailCoreMovements,
  ])

  useEffect(() => {
    if (!activeDialog) return
    if (activeTopMenuKey !== 'product') return
    const rememberedRow = dialogRowContextBySubmenu[activeSubmenu.key]
    if (!rememberedRow && !activeDialog.hasRowContext) return
    const productId = resolveProductDetailId(rememberedRow)
    if (!productId || productDetailCache[productId] === undefined) return
    const nextSections = buildDialogSections(rememberedRow, activeDialog.mode, activeDialog.actionLabel)
    const currentSectionsSignature = JSON.stringify(activeDialog.sections)
    const nextSectionsSignature = JSON.stringify(nextSections)
    if (currentSectionsSignature === nextSectionsSignature) return
    setActiveDialog((current) => {
      if (!current) return current
      if (current.title !== activeDialog.title || current.actionLabel !== activeDialog.actionLabel) return current
      return {
        ...current,
        hasRowContext: Boolean(rememberedRow),
        sections: nextSections,
      }
    })
  }, [
    activeDialog,
    activeSubmenu.key,
    activeTopMenuKey,
    dialogRowContextBySubmenu,
    directProductItems,
    directProjection,
    productDetailCache,
    productItems,
    publishedProjection,
  ])

  useEffect(() => {
    if (!activeDialog || activeDialog.mode !== 'action') return
    if (activeTopMenuKey !== 'product') return
    if (activeDialog.hasRowContext) return
    const nextSections = buildDialogSections(undefined, 'action', activeDialog.actionLabel)
    if (!nextSections.length) return
    const currentSectionsSignature = JSON.stringify(activeDialog.sections)
    const nextSectionsSignature = JSON.stringify(nextSections)
    if (currentSectionsSignature === nextSectionsSignature) return
    setActiveDialog((current) => {
      if (!current || current.mode !== 'action' || current.actionLabel !== activeDialog.actionLabel) return current
      return {
        ...current,
        sections: nextSections,
      }
    })
  }, [
    activeDialog,
    activeTopMenuKey,
    activeSubmenu.key,
    filteredRows,
    normalizedRows,
    productCityRows,
    productDepotRows,
    productHotSaleRows,
    productStoreRows,
    productSupplierRows,
    directInventory,
    directProductItems,
    directProjection,
    productItems,
    publishedProjection,
    sqlInventory,
  ])

  useEffect(() => {
    if (normalizedRows.length > 0 && submenuLoadingState[activeSubmenu.key]) {
      setSubmenuLoadingState((current) => ({ ...current, [activeSubmenu.key]: false }))
    }
  }, [activeSubmenu.key, normalizedRows.length, submenuLoadingState])

  async function prefetchSubmenuData(submenuKey: string) {
    if (submenuKey === 'product-store') {
      const seedRows = resolveProductStoreSeedRows()
      if (seedRows.length) {
        setProductStoreRows(seedRows)
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
        return
      }
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        const [projectionPayload, inventoryPayload] = await Promise.all([
          getPublishedProductProjectionSnapshot(),
          getLiveInventorySnapshot({ compact: true }),
        ])
        if (!projectionPayload || !Array.isArray(projectionPayload.items) || projectionPayload.items.length === 0) return
        setDirectProjection(projectionPayload)
        if (inventoryPayload?.skus?.length) {
          setDirectInventory(inventoryPayload)
        }
        setProductStoreRows(buildStoreProductPageRows(projectionPayload, inventoryPayload ?? directInventory ?? sqlInventory))
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'product-depot') {
      const seedRows = resolveProductDepotSeedRows()
      if (seedRows.length) {
        setProductDepotRows(seedRows)
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
        return
      }
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        const [projectionPayload, productPayload, serialPayload] = await Promise.all([
          getPublishedProductProjectionSnapshot(),
          getProductLibraryProducts(120),
          getRetailCoreSerialItems(120),
        ])
        if (projectionPayload?.items?.length) {
          setDirectProjection(projectionPayload)
        }
        if (productPayload?.items?.length) {
          setDirectProductItems(productPayload)
        }
        if (serialPayload?.items?.length) {
          setDirectSerialItems(serialPayload)
        }
        const depotRows = buildDepotProductPageRows(
          projectionPayload ?? directProjection ?? publishedProjection,
          serialPayload ?? directSerialItems ?? sqlSerialItems,
        )
        setProductDepotRows(
          depotRows.length ? depotRows : buildLibraryProductRows(productPayload ?? directProductItems ?? productItems, 'depot'),
        )
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'order-offline') {
      const seedRows = resolveOrderOfflineSeedRows()
      if (seedRows.length) {
        setOrderOfflineRows(seedRows)
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
        return
      }
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
          if (!payload?.items?.length) return
          setDirectSalesOrders((current) => current?.items?.length ? current : payload)
          setOrderOfflineRows((current) => current.length ? current : buildOrderPageRows(payload))
        })
        const payload = await getRetailCoreSalesOrders(120)
        if (payload?.items?.length) {
          setDirectSalesOrders(payload)
          setOrderOfflineRows(buildOrderPageRows(payload))
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'order-offline-refund') {
      const seedRows = resolveOrderOfflineRefundSeedRows()
      if (seedRows.length) {
        setOrderOfflineRefundRows(seedRows)
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
        return
      }
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchInventoryMovementsStaticSnapshot().then((payload) => {
          if (!payload?.records?.length) return
          setSqlMovements(payload)
          const fallbackRows = buildOfflineRefundSnapshotRows(payload)
          if (fallbackRows.length) {
            setOrderOfflineRefundRows((current) => current.length ? current : fallbackRows)
          }
        })
        const response = await fetch(`/api/retail-core/inventory-movements?limit=4000&ts=${Date.now()}`, { cache: 'no-store' })
        const payload = response.ok ? await response.json() as RetailCoreMovements : null
        if (payload?.items?.length) {
          setDirectRetailCoreMovements(payload)
          const refundRows = buildOfflineRefundRows(payload)
          if (refundRows.length) {
            setOrderOfflineRefundRows(refundRows)
          }
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'order-online') {
      const seedRows = resolveOrderOnlineSeedRows()
      if (seedRows.length) {
        setOrderOnlineRows(seedRows)
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
        return
      }
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
          if (!payload?.items?.length) return
          setDirectSalesOrders((current) => current?.items?.length ? current : payload)
          setOrderOnlineRows((current) => current.length ? current : buildOnlineOrderRows(payload))
        })
        const payload = await getRetailCoreSalesOrders(120)
        if (payload?.items?.length) {
          setDirectSalesOrders(payload)
          setOrderOnlineRows(buildOnlineOrderRows(payload))
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'order-online-refund') {
      const seedRows = resolveOrderOnlineRefundSeedRows()
      if (seedRows.length) {
        setOrderOnlineRefundRows(seedRows)
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
        return
      }
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
          if (!payload?.items?.length) return
          setDirectSalesOrders((current) => current?.items?.length ? current : payload)
          setOrderOnlineRefundRows((current) => current.length ? current : buildOnlineRefundRows(payload))
        })
        const payload = await getRetailCoreSalesOrders(120)
        if (payload?.items?.length) {
          setDirectSalesOrders(payload)
          setOrderOnlineRefundRows(buildOnlineRefundRows(payload))
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (
      submenuKey.startsWith('report-')
      || submenuKey.startsWith('finance-')
      || submenuKey.startsWith('account-')
      || submenuKey.startsWith('device-')
    ) {
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchRetailCoreSalesOrdersStaticFallback().then((payload) => {
          if (!payload?.items?.length) return
          setDirectSalesOrders((current) => current?.items?.length ? current : payload)
        })
        const payload = await getRetailCoreSalesOrders(120)
        if (payload?.items?.length) {
          setDirectSalesOrders(payload)
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'inventory-movement') {
      const seedRows = resolveInventoryMovementSeedRows()
      if (seedRows.length) {
        setInventoryMovementRows(seedRows)
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
        return
      }
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchInventoryMovementStaticFallback().then((fallback) => {
          if (!fallback) return
          if (fallback.type === 'retail') {
            setDirectRetailCoreMovements((current) => current?.items?.length ? current : fallback.payload)
            const fallbackRows = buildInventoryMovementRows(fallback.payload)
            if (fallbackRows.length) {
              setInventoryMovementRows((current) => (current.length ? current : fallbackRows))
            }
            return
          }
          setSqlMovements((current) => current?.records?.length ? current : fallback.payload)
          const fallbackRows = buildInventoryMovementSnapshotRows(fallback.payload)
          if (fallbackRows.length) {
            setInventoryMovementRows((current) => (current.length ? current : fallbackRows))
          }
        })
        void getInventoryMovementsSnapshot().then((snapshotPayload) => {
          const snapshotRows = buildInventoryMovementSnapshotRows(snapshotPayload)
          if (snapshotPayload?.records?.length) {
            setSqlMovements(snapshotPayload)
          }
          if (snapshotRows.length) {
            setInventoryMovementRows((current) => (current.length ? current : snapshotRows))
          }
        })
        const retailFallbackPromise = fetchInventoryMovementApiFallback()
        const retailPayload = await getRetailCoreMovements(120)
        const retailRows = buildInventoryMovementRows(retailPayload)
        if (retailPayload?.items?.length) {
          setDirectRetailCoreMovements(retailPayload)
        }
        if (retailRows.length) {
          setInventoryMovementRows(retailRows)
          return
        }
        const retailFallbackPayload = await retailFallbackPromise
        const retailFallbackRows = buildInventoryMovementRows(retailFallbackPayload)
        if (retailFallbackPayload?.items?.length) {
          setDirectRetailCoreMovements(retailFallbackPayload)
        }
        if (retailFallbackRows.length) {
          setInventoryMovementRows(retailFallbackRows)
          return
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'inventory-stock-order') {
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchInventoryMovementStaticFallback().then((fallback) => {
          if (!fallback) return
          if (fallback.type === 'retail') {
            setDirectRetailCoreMovements((current) => current?.items?.length ? current : fallback.payload)
            return
          }
          setSqlMovements((current) => current?.records?.length ? current : fallback.payload)
        })
        const retailPayload = await getRetailCoreMovements(120)
        if (retailPayload?.items?.length) {
          setDirectRetailCoreMovements(retailPayload)
          return
        }
        const snapshotPayload = await getInventoryMovementsSnapshot()
        if (snapshotPayload?.records?.length) {
          setSqlMovements(snapshotPayload)
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }

    if (submenuKey === 'inventory-sn-order') {
      setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: true }))
      try {
        void fetchRetailCoreSerialItemsStaticFallback().then((payload) => {
          if (!payload?.items?.length) return
          setDirectSerialItems((current) => current?.items?.length ? current : payload)
        })
        const serialPayload = await getRetailCoreSerialItems(120)
        if (serialPayload?.items?.length) {
          setDirectSerialItems(serialPayload)
          return
        }
        const inventoryPayload = await getLiveInventorySnapshot({ compact: true })
        if (inventoryPayload?.skus?.length) {
          setDirectInventory(inventoryPayload)
        }
      } finally {
        setSubmenuLoadingState((current) => ({ ...current, [submenuKey]: false }))
      }
    }
  }

  function applyDatePreset(nextPreset: DatePreset) {
    setDatePreset(nextPreset)
    const range = resolveDateRange(nextPreset)
    setDateStart(range.start)
    setDateEnd(range.end)
  }

  function buildDialogValue(row: RenderRow | undefined, fieldIndex: number) {
    if (!row) return '--'
    return formatCellValue(row.cells[fieldIndex] ?? row.cells[row.cells.length - 1] ?? '--')
  }

  function buildInventoryContextRequiredSections(actionLabel: string) {
    return [{
      heading: actionLabel,
      fields: [{
        label: '状态',
        value: '请先在列表中选择一条记录后，再查看该明细。',
      }],
    }]
  }

  function resolveInventorySerialRecords(row?: RenderRow) {
    const inventorySku = resolveInventorySkuForDialog(row)
    const skuKey = inventorySku?.skuKey ?? row?.meta?.skuKey ?? ''
    const pnText = inventorySku?.pnMtm ?? row?.meta?.pnMtm ?? row?.cells?.[1] ?? ''
    const productName = inventorySku?.productName ?? row?.meta?.productName ?? row?.cells?.[0] ?? ''
    const serialRecords = (directSerialItems ?? sqlSerialItems)?.items ?? []
    const matched = serialRecords.filter((item) =>
      (skuKey && item.sku_key === skuKey)
      || (pnText && item.pn_mtm === pnText)
      || (productName && item.product_name === productName),
    )
    const preferred = matched.filter((item) => !/sold|return|returned/i.test(item.status ?? ''))
    return {
      inventorySku,
      serialRecords: preferred.length ? preferred : matched,
    }
  }

  function resolveInventorySkuForDialog(row?: RenderRow) {
    if (!row) return null
    const inventory = directInventory ?? sqlInventory
    if (!inventory?.skus?.length) return null
    const metaSkuKey = row.meta?.skuKey
    const primaryText = row.cells[0]
    const metaPnText = row.meta?.pnMtm
    const metaSpecText = row.meta?.spec
    const pnText = metaPnText ?? row.cells[1]
    const specText = metaSpecText ?? row.cells[2]
    return inventory.skus.find((item) =>
      (metaSkuKey && item.skuKey === metaSkuKey)
      || (primaryText && item.productName === primaryText)
      || (pnText && item.pnMtm === pnText)
      || (specText && item.spec === specText),
    ) ?? null
  }

  function buildInventorySerialDialogSections(row?: RenderRow) {
    const { inventorySku, serialRecords } = resolveInventorySerialRecords(row)
    if (serialRecords.length) {
      return serialRecords.slice(0, 8).map((serial, index) => ({
        heading: `序列号 ${index + 1}`,
        fields: [
          { label: 'SN', value: serial.serial_number ?? '--' },
          { label: '状态', value: serial.status ?? '--' },
          { label: '库位', value: serial.location_code ?? '--' },
          { label: '仓库', value: serial.warehouse_code ?? '--' },
          { label: '供应商', value: serial.supplier_name ?? '--' },
          { label: '入库单号', value: serial.inbound_document_no ?? '--' },
          { label: '入库时间', value: serial.inbound_date ?? '--' },
          { label: '入库操作人', value: serial.operator_name ?? '--' },
        ],
      }))
    }
    const inventorySerials = inventorySku?.serials ?? []
    if (!inventorySerials.length) {
      return [{
        heading: '序列号明细',
        fields: [{ label: '状态', value: '当前没有可展示的序列号明细。' }],
      }]
    }
    return inventorySerials.slice(0, 8).map((serial, index) => ({
      heading: `序列号 ${index + 1}`,
      fields: [
        { label: 'SN', value: serial.serialNumber ?? '--' },
        { label: '库位', value: serial.locationName ?? '--' },
        { label: '供应商', value: serial.supplierName ?? '--' },
        { label: '入库单号', value: serial.inboundDocumentNumber ?? '--' },
        { label: '入库时间', value: serial.inboundDate ?? '--' },
        { label: '入库操作人', value: serial.inboundOperatorName ?? '--' },
      ],
    }))
  }

  function buildInventoryCostDialogSections(row?: RenderRow) {
    const inventorySku = resolveInventorySkuForDialog(row)
    if (!inventorySku) {
      return [{
        heading: '销售成本记录',
        fields: [{ label: '状态', value: '当前没有命中的成本价记录。' }],
      }]
    }
    return [{
      heading: '销售成本记录',
      fields: [
        { label: '商品名称', value: inventorySku.productName ?? '--' },
        { label: 'PN/MTM', value: inventorySku.pnMtm ?? '--' },
        { label: '规格', value: inventorySku.spec ?? '--' },
        { label: '分类', value: inventorySku.category ?? inventorySku.sourceCategory ?? '--' },
        { label: '组织名称', value: inventorySku.organizationName ?? '--' },
        { label: '组织编码', value: inventorySku.organizationCode ?? '--' },
        { label: '代理价', value: formatCellValue(inventorySku.agentPrice) },
        { label: '销售成本价', value: formatCellValue(inventorySku.salesCostPrice) },
        { label: '现有库存', value: formatCellValue(inventorySku.currentStock) },
        { label: '可售库存', value: formatCellValue(inventorySku.sellableStock) },
        { label: 'SN数量', value: formatCellValue(inventorySku.serialCount) },
        { label: '库存预警额', value: formatCellValue(inventorySku.stockWarningLevel) },
      ],
    }]
  }

  function buildInventoryMovementDialogSections(row?: RenderRow) {
    const inventorySku = resolveInventorySkuForDialog(row)
    const skuKey = inventorySku?.skuKey ?? row?.meta?.skuKey ?? ''
    const pnText = inventorySku?.pnMtm ?? row?.meta?.pnMtm ?? row?.cells?.[1] ?? ''
    const movements = (directRetailCoreMovements ?? retailCoreMovements)?.items ?? []
    const matchedRetail = movements.filter((item) =>
      (skuKey && item.sku_key === skuKey) || (pnText && item.pn_mtm === pnText),
    )
    const matchedSnapshot = (sqlMovements?.records ?? []).filter((item) =>
      (skuKey && item.skuKey === skuKey) || (pnText && item.pnMtm === pnText),
    )
    if (!matchedRetail.length && !matchedSnapshot.length) {
      return [{
        heading: '库存流水',
        fields: [{ label: '状态', value: '当前没有命中的库存流水记录。' }],
      }]
    }
    const retailSections = matchedRetail.slice(0, 4).map((item, index) => ({
      heading: `流水 ${index + 1}`,
      fields: [
        { label: '业务单编号', value: item.service_no ?? item.source_ref ?? '--' },
        { label: '类型', value: item.operate_type_name ?? item.service_type_name ?? item.movement_type ?? '--' },
        { label: '商品', value: item.product_name ?? '--' },
        { label: '库位', value: item.location_name ?? item.warehouse_location_name ?? '--' },
        { label: '数量', value: formatCellValue(item.quantity) },
        { label: '业务日期', value: item.business_date ?? '--' },
        { label: '操作时间', value: item.created_at ?? '--' },
        { label: '操作人', value: item.operator_name ?? item.user_name ?? '--' },
      ],
    }))
    const snapshotSections = matchedSnapshot
      .slice(0, Math.max(0, 6 - retailSections.length))
      .map((item, index) => ({
        heading: `快照流水 ${index + 1}`,
        fields: [
          { label: '业务单编号', value: item.documentNumber ?? item.sourceRef ?? '--' },
          { label: '类型', value: item.movementType ?? item.sourceDocumentType ?? '--' },
          { label: '商品', value: item.productName ?? '--' },
          { label: '库位', value: item.locationName ?? '--' },
          { label: '数量', value: formatCellValue(item.quantity) },
          { label: '业务日期', value: item.businessDate ?? '--' },
          { label: '操作时间', value: item.updatedAt ?? '--' },
          { label: '操作人', value: item.operatorName ?? '--' },
        ],
      }))
    return [...retailSections, ...snapshotSections]
  }

  function resolveActiveSelectScope(fallback = '全部') {
    return Object.values(filterSelectValues).find((value) => value && value !== '全部') || fallback
  }

  function sumNumericMeta(rows: RenderRow[], key: keyof NonNullable<RenderRow['meta']>) {
    return rows.reduce((sum, row) => {
      const raw = row.meta?.[key]
      const value = Number(typeof raw === 'string' ? raw.replace(/,/g, '') : raw ?? 0)
      return Number.isFinite(value) ? sum + value : sum
    }, 0)
  }

  function sumNumericCell(rows: RenderRow[], cellIndex: number) {
    return rows.reduce((sum, row) => {
      const raw = row.cells[cellIndex]
      const value = Number(String(raw ?? '0').replace(/,/g, ''))
      return Number.isFinite(value) ? sum + value : sum
    }, 0)
  }

  function buildInventoryLocationDialogSections(row?: RenderRow, mode: ZdtDialogMode = 'view', actionLabel?: string) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    if (!row) {
      if (mode === 'action') {
        const visibleStock = sumNumericCell(filteredRows, 3)
        const visibleSellable = sumNumericCell(filteredRows, 4)
        return [{
          heading: normalizedActionLabel || '库位库存',
          fields: [
            { label: '组织架构', value: resolveActiveSelectScope('全部') },
            { label: '库位范围', value: resolveActiveSelectScope('全部') },
            { label: '当前记录数', value: String(filteredRows.length) },
            { label: '在库数量', value: formatCellValue(visibleStock) },
            { label: '可售数量', value: formatCellValue(visibleSellable) },
          ],
        }]
      }
      return [{
        heading: '库位库存',
        fields: [{ label: '状态', value: '请先在列表中选择一条库位库存记录。' }],
      }]
    }
    if (mode === 'action') {
      return [{
        heading: normalizedActionLabel || '库存动作',
        fields: [
          { label: '商品名称', value: row.meta?.productName ?? buildDialogValue(row, 0) },
          { label: 'PN/MTM', value: row.meta?.pnMtm ?? buildDialogValue(row, 1) },
          { label: '规格', value: row.meta?.spec ?? buildDialogValue(row, 2) },
          { label: '库位', value: buildDialogValue(row, 7) },
          { label: '库存', value: buildDialogValue(row, 4) },
          { label: '占用库存', value: buildDialogValue(row, 5) },
          { label: '待入库', value: buildDialogValue(row, 6) },
          { label: '动作类型', value: normalizedActionLabel || '库存动作' },
        ],
      }]
    }
    return [{
      heading: '库位库存',
      fields: [
        { label: '商品名称', value: row.meta?.productName ?? buildDialogValue(row, 0) },
        { label: 'PN/MTM', value: row.meta?.pnMtm ?? buildDialogValue(row, 1) },
        { label: '规格', value: row.meta?.spec ?? buildDialogValue(row, 2) },
        { label: '总库存', value: buildDialogValue(row, 3) },
        { label: '库存', value: buildDialogValue(row, 4) },
        { label: '占用库存', value: buildDialogValue(row, 5) },
        { label: '待入库', value: buildDialogValue(row, 6) },
        { label: '库位', value: buildDialogValue(row, 7) },
        { label: '销售属性', value: buildDialogValue(row, 8) },
        { label: '分类', value: row.meta?.productCategory ?? buildDialogValue(row, 9) },
        { label: '商品编码', value: row.meta?.productCode ?? buildDialogValue(row, 10) },
      ],
    }]
  }

  function buildInventoryLocationMoveDialogSections(row?: RenderRow, mode: ZdtDialogMode = 'view', actionLabel?: string) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    if (!row) {
      if (mode === 'action') {
        const visibleStock = sumNumericCell(filteredRows, 7)
        return [{
          heading: normalizedActionLabel || '同店换库位',
          fields: [
            { label: '组织架构', value: resolveActiveSelectScope('全部') },
            { label: '商品分类', value: resolveActiveSelectScope('全部') },
            { label: '当前记录数', value: String(filteredRows.length) },
            { label: '在库数量', value: formatCellValue(visibleStock) },
          ],
        }]
      }
      return [{
        heading: '同店换库位',
        fields: [{ label: '状态', value: '请先在列表中选择一条库位变更记录。' }],
      }]
    }
    return [{
      heading: mode === 'action' ? (normalizedActionLabel || '同店换库位') : '同店换库位',
      fields: [
        { label: '商品名称', value: row.meta?.productName ?? buildDialogValue(row, 0) },
        { label: '商品编码', value: row.meta?.productCode ?? buildDialogValue(row, 1) },
        { label: 'PN/MTM', value: row.meta?.pnMtm ?? buildDialogValue(row, 2) },
        { label: '规格', value: row.meta?.spec ?? buildDialogValue(row, 3) },
        { label: '分类', value: row.meta?.productCategory ?? buildDialogValue(row, 4) },
        { label: '库位', value: buildDialogValue(row, 5) },
        { label: '销售属性', value: row.meta?.productStatus ?? buildDialogValue(row, 6) },
        { label: '库存', value: buildDialogValue(row, 7) },
        ...(mode === 'action' ? [{ label: '动作类型', value: normalizedActionLabel || '同店换库位' }] : []),
      ],
    }]
  }

  function buildProductDialogSections(
    row: RenderRow | undefined,
    mode: ZdtDialogMode = 'view',
    actionLabel?: string,
  ) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    const productActionSeedRow = activeSubmenu.key === 'product-store'
      ? productStoreRows[0]
      : activeSubmenu.key === 'product-depot'
        ? productDepotRows[0]
        : activeSubmenu.key === 'product-city'
          ? productCityRows[0]
          : activeSubmenu.key === 'product-hot-sale'
            ? productHotSaleRows[0]
            : activeSubmenu.key === 'product-supplier'
              ? productSupplierRows[0]
              : undefined
    const leadActionRow = row
      ?? dialogRowContextBySubmenu[activeSubmenu.key]
      ?? filteredRows[0]
      ?? normalizedRows[0]
      ?? productActionSeedRow
    if (activeSubmenu.key === 'product-city' && mode === 'action' && /配置税率/.test(normalizedActionLabel)) {
      return [{
        heading: '配置税率',
        fields: [
          { label: '组织架构', value: resolveActiveSelectScope('全部') },
          { label: '商品分类', value: resolveActiveSelectScope('全部') },
          { label: '税率方案', value: '标准税率' },
          { label: '主SKU', value: leadActionRow?.meta?.skuKey ?? leadActionRow?.cells?.[4] ?? '--' },
          { label: '商品信息', value: leadActionRow?.meta?.productName ?? leadActionRow?.cells?.[0] ?? '--' },
          { label: '当前库存', value: leadActionRow?.meta?.currentStock ?? '--' },
          { label: '可售库存', value: leadActionRow?.meta?.sellableStock ?? '--' },
        ],
      }]
    }
    if (activeSubmenu.key === 'product-hot-sale') {
      const resolvedHotSaleCategory =
        row?.meta?.productCategory && row.meta.productCategory !== '--'
          ? row.meta.productCategory
          : row
          ? buildDialogValue(row, 1) || '未分类'
          : '未分类'
      if (!row) {
        if (mode === 'action') {
          const totalSellable = sumNumericMeta(filteredRows.length ? filteredRows : normalizedRows, 'sellableStock')
          return [{
            heading: /选择商品/.test(normalizedActionLabel) ? '选择商品' : '收银热卖商品',
            fields: [
              { label: '门店', value: resolveActiveSelectScope('全部') },
              { label: '热卖首项', value: leadActionRow?.meta?.productName ?? leadActionRow?.cells?.[0] ?? '--' },
              { label: '成交渠道', value: leadActionRow?.meta?.salesChannel ?? leadActionRow?.cells?.[2] ?? '--' },
              { label: '可售库存合计', value: formatCellValue(totalSellable) },
              { label: '主SKU', value: leadActionRow?.meta?.skuKey ?? leadActionRow?.cells?.[3] ?? '--' },
            ],
          }]
        }
        return [{
          heading: '收银热卖商品',
          fields: [{ label: '状态', value: '请先在列表中选择一条热卖商品记录。' }],
        }]
      }
      if (mode === 'action') {
        const hotIndex = filteredRows.findIndex((item) => item.id === row.id)
        return [{
          heading: normalizedActionLabel || '收银热卖商品',
          fields: [
            { label: '商品信息', value: row.meta?.productName ?? buildDialogValue(row, 0) },
            { label: '分类', value: resolvedHotSaleCategory },
            { label: '销售渠道', value: row.meta?.salesChannel ?? buildDialogValue(row, 2) },
            { label: '商品编码', value: row.meta?.productCode ?? buildDialogValue(row, 3) },
            { label: '是否上架', value: row.meta?.productStatus ?? buildDialogValue(row, 5) },
            { label: '当前热卖位次', value: hotIndex >= 0 ? String(hotIndex + 1) : '--' },
            { label: '当前库存', value: row.meta?.currentStock ?? '--' },
            { label: '热卖调整', value: normalizedActionLabel || '收银热卖商品' },
          ],
        }]
      }
      return [{
        heading: '收银热卖商品',
        fields: [
          { label: '商品信息', value: row.meta?.productName ?? buildDialogValue(row, 0) },
          { label: '分类', value: resolvedHotSaleCategory },
          { label: '销售渠道', value: row.meta?.salesChannel ?? buildDialogValue(row, 2) },
          { label: '商品编码', value: row.meta?.productCode ?? buildDialogValue(row, 3) },
          { label: '是否组合商品', value: buildDialogValue(row, 4) },
          { label: '是否上架', value: buildDialogValue(row, 5) },
          { label: '库存', value: row.meta?.currentStock ?? '--' },
        ],
      }]
    }

    if (activeSubmenu.key === 'product-supplier') {
      if (!row) {
        if (mode === 'action' || mode === 'edit') {
          return [{
            heading: /新建/.test(normalizedActionLabel) ? '新建供应商' : '供应商管理',
            fields: [
              { label: '供应商名称', value: '' },
              { label: '状态', value: '启用' },
              { label: '所属公司', value: leadActionRow?.meta?.organizationName ?? '--' },
              { label: '样本供应商', value: leadActionRow?.cells?.[0] ?? '--' },
              { label: '最近入库时间', value: leadActionRow?.meta?.updatedAt ?? '--' },
              { label: '关联SKU数', value: leadActionRow?.meta?.note ?? '--' },
            ],
          }]
        }
        return [{
          heading: '供应商管理',
          fields: [{ label: '状态', value: '请先在列表中选择一条供应商记录。' }],
        }]
      }
      if (mode === 'action') {
        return [{
          heading: normalizedActionLabel || '供应商动作',
          fields: [
            { label: '供应商名称', value: buildDialogValue(row, 0) },
            { label: '状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 1) },
            { label: '所属公司', value: row.meta?.organizationName ?? buildDialogValue(row, 2) },
            { label: '创建时间', value: row.meta?.updatedAt ?? buildDialogValue(row, 3) },
            { label: '关联SKU数', value: row.meta?.note ?? '--' },
            { label: '供应商操作', value: normalizedActionLabel || '供应商动作' },
          ],
        }]
      }
      return [{
        heading: mode === 'edit' ? '编辑供应商' : '供应商信息',
        fields: [
          { label: '供应商名称', value: buildDialogValue(row, 0) },
          { label: '状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 1) },
          { label: '所属公司', value: row.meta?.organizationName ?? buildDialogValue(row, 2) },
          { label: '创建时间', value: row.meta?.updatedAt ?? buildDialogValue(row, 3) },
          { label: '备注', value: row.meta?.note ?? '--' },
        ],
      }]
    }

    if (!row) {
      if (mode === 'action') {
        const scopeLabel = activeSubmenu.key === 'product-city'
          ? '组织架构'
          : activeSubmenu.key === 'product-store'
            ? '门店范围'
            : '仓库范围'
        const scopeValue = resolveActiveSelectScope('全部')
        if (/导出/.test(normalizedActionLabel)) {
          return [{
            heading: '导出商品',
            fields: [
              { label: scopeLabel, value: scopeValue },
              { label: '样本商品', value: leadActionRow?.meta?.productName ?? '--' },
              { label: '主SKU', value: leadActionRow?.meta?.skuKey ?? '--' },
              { label: '当前状态', value: leadActionRow?.meta?.productStatus ?? '--' },
              { label: '当前库存', value: leadActionRow?.meta?.currentStock ?? '--' },
              { label: '可售库存', value: leadActionRow?.meta?.sellableStock ?? '--' },
              { label: '开始日期', value: dateStart || '--' },
              { label: '结束日期', value: dateEnd || '--' },
              { label: '来源置信度', value: leadActionRow?.meta?.sourceConfidence ?? '--' },
            ],
          }]
        }
        if (/批量发布|发布/.test(normalizedActionLabel)) {
          return [{
            heading: '发布范围',
            fields: [
              { label: scopeLabel, value: scopeValue },
              { label: '样本商品', value: leadActionRow?.meta?.productName ?? '--' },
              { label: '主SKU', value: leadActionRow?.meta?.skuKey ?? '--' },
              { label: '当前状态', value: leadActionRow?.meta?.productStatus ?? '--' },
              { label: '当前库存', value: leadActionRow?.meta?.currentStock ?? '--' },
              { label: '可售库存合计', value: formatCellValue(sumNumericMeta(filteredRows.length ? filteredRows : normalizedRows, 'sellableStock')) },
              { label: '来源置信度', value: leadActionRow?.meta?.sourceConfidence ?? '--' },
            ],
          }]
        }
        if (/批量上架|批量下架|上架|下架/.test(normalizedActionLabel)) {
          return [{
            heading: normalizedActionLabel,
            fields: [
              { label: scopeLabel, value: scopeValue },
              { label: '样本商品', value: leadActionRow?.meta?.productName ?? '--' },
              { label: '主SKU', value: leadActionRow?.meta?.skuKey ?? '--' },
              { label: '当前状态', value: leadActionRow?.meta?.productStatus ?? '--' },
              { label: '当前库存', value: leadActionRow?.meta?.currentStock ?? '--' },
              { label: '可售库存', value: leadActionRow?.meta?.sellableStock ?? '--' },
              { label: '来源置信度', value: leadActionRow?.meta?.sourceConfidence ?? '--' },
            ],
          }]
        }
        if (/同步/.test(normalizedActionLabel)) {
          return [{
            heading: '同步任务',
            fields: [
              { label: scopeLabel, value: scopeValue },
              { label: '样本商品', value: leadActionRow?.meta?.productName ?? '--' },
              { label: '主SKU', value: leadActionRow?.meta?.skuKey ?? '--' },
              { label: '当前状态', value: leadActionRow?.meta?.productStatus ?? '--' },
              { label: '当前库存', value: leadActionRow?.meta?.currentStock ?? '--' },
              { label: '来源置信度', value: leadActionRow?.meta?.sourceConfidence ?? '--' },
              { label: '最近同步', value: leadActionRow?.meta?.updatedAt ?? new Date().toLocaleString('zh-CN') },
            ],
          }]
        }
      }
      return [{
        heading: activeSubmenu.label,
        fields: [{ label: '状态', value: '请先在列表中选择一条商品记录。' }],
      }]
    }
    const detail = resolveProductDetail(row)
    const primarySku = (detail?.skus?.[0] ?? {}) as Record<string, unknown>
    const currentStock = String(row.meta?.currentStock ?? primarySku.current_stock ?? '--')
    const sellableStock = String(row.meta?.sellableStock ?? primarySku.sellable_stock ?? '--')
    const serialCount = String(detail?.serials?.length ?? row.meta?.serialCount ?? '--')
    const evidenceCount = String(detail?.evidence?.length ?? 0)
    const sourceLinkCount = String(detail?.sourceLinks?.length ?? 0)
    const movementCount = String(detail?.movementSummary?.movementCount ?? 0)
    const pendingProtectionCount = String(detail?.protectionSummary?.pendingCount ?? 0)
    const sourceConfidence = detail?.source_confidence ?? row.meta?.sourceConfidence ?? '--'
    const updatedAt = detail?.updated_at ?? row.meta?.updatedAt ?? buildDialogValue(row, 7)
    const statusValue = activeSubmenu.key === 'product-city'
      ? detail?.review_status ?? row.meta?.productStatus ?? buildDialogValue(row, 5)
      : row.meta?.productStatus ?? detail?.review_status ?? buildDialogValue(row, 5)
    const channelOrTaxValue = activeSubmenu.key === 'product-city'
      ? '--'
      : row.meta?.salesChannel ?? buildDialogValue(row, 6)
    const baseFields = [
      { label: '商品信息', value: detail?.canonical_name ?? row.meta?.productName ?? buildDialogValue(row, 0) },
      { label: 'PN/MTM', value: String(primarySku.pn_mtm ?? row.meta?.pnMtm ?? '--') },
      { label: '商品分类', value: detail?.default_category ?? row.meta?.productCategory ?? buildDialogValue(row, 2) },
      { label: '商品来源', value: String(primarySku.catalog_source ?? row.meta?.productSource ?? buildDialogValue(row, 1)) },
      { label: '商品类型', value: detail?.configuration_summary ?? row.meta?.productType ?? buildDialogValue(row, 3) },
      { label: '商品编码', value: detail?.primary_sku_key ?? row.meta?.productCode ?? buildDialogValue(row, 4) },
      { label: '状态', value: statusValue || '--' },
      { label: activeSubmenu.key === 'product-city' ? '税率分类' : '销售渠道', value: channelOrTaxValue || '--' },
      { label: '更新时间', value: updatedAt || '--' },
    ]
    const supplyFields = [
      { label: '主SKU', value: detail?.primary_sku_key ?? row.meta?.skuKey ?? '--' },
      { label: '当前库存', value: currentStock },
      { label: '可售库存', value: sellableStock },
      { label: '在库SN', value: serialCount },
      { label: '来源置信度', value: sourceConfidence || '--' },
      { label: '证据条数', value: evidenceCount },
      { label: '来源链接', value: sourceLinkCount },
      { label: '流水条数', value: movementCount },
      { label: '待价保记录', value: pendingProtectionCount },
    ]

    if (mode === 'edit') {
      return [{
        heading: '编辑商品',
        fields: baseFields,
      }, {
        heading: '同步字段',
        fields: [
          { label: '主SKU', value: detail?.primary_sku_key ?? row.meta?.skuKey ?? '--' },
          { label: '来源置信度', value: sourceConfidence || '--' },
          { label: activeSubmenu.key === 'product-store' ? '门店' : activeSubmenu.key === 'product-depot' ? '仓库' : '组织架构', value: row.meta?.organizationName ?? row.meta?.organizationCode ?? '--' },
          { label: activeSubmenu.key === 'product-city' ? '税率' : '可售库存', value: activeSubmenu.key === 'product-city' ? '--' : sellableStock },
          { label: activeSubmenu.key === 'product-city' ? '税率分类' : '在库SN', value: activeSubmenu.key === 'product-city' ? '--' : serialCount },
        ],
      }]
    }

    if (mode === 'action') {
      if (/发布/.test(normalizedActionLabel)) {
        return [{
          heading: '发布商品',
          fields: [
            { label: '商品信息', value: detail?.canonical_name ?? row.meta?.productName ?? '--' },
            { label: '主SKU', value: detail?.primary_sku_key ?? row.meta?.skuKey ?? '--' },
            { label: '商品来源', value: String(primarySku.catalog_source ?? row.meta?.productSource ?? '--') },
            { label: '当前状态', value: statusValue || '--' },
            { label: '当前库存', value: currentStock },
            { label: '可售库存', value: sellableStock },
            { label: '来源置信度', value: sourceConfidence || '--' },
            { label: '证据条数', value: evidenceCount },
          ],
        }]
      }
      if (/上架|下架/.test(normalizedActionLabel)) {
        return [{
          heading: normalizedActionLabel,
          fields: [
            { label: '商品信息', value: detail?.canonical_name ?? row.meta?.productName ?? '--' },
            { label: '销售渠道', value: row.meta?.salesChannel ?? '--' },
            { label: '当前状态', value: statusValue || '--' },
            { label: '主SKU', value: detail?.primary_sku_key ?? row.meta?.skuKey ?? '--' },
            { label: '当前库存', value: currentStock },
            { label: '可售库存', value: sellableStock },
          ],
        }]
      }
      if (/导出/.test(normalizedActionLabel)) {
        return [{
          heading: '导出商品',
          fields: [
            { label: '商品信息', value: detail?.canonical_name ?? row.meta?.productName ?? '--' },
            { label: '主SKU', value: detail?.primary_sku_key ?? row.meta?.skuKey ?? '--' },
            { label: activeSubmenu.key === 'product-store' ? '门店' : activeSubmenu.key === 'product-depot' ? '仓库' : '组织架构', value: row.meta?.organizationName ?? row.meta?.organizationCode ?? '--' },
            { label: '当前状态', value: statusValue || '--' },
            { label: '当前库存', value: currentStock },
            { label: '可售库存', value: sellableStock },
            { label: '开始日期', value: dateStart || '--' },
            { label: '结束日期', value: dateEnd || '--' },
            { label: '来源置信度', value: sourceConfidence || '--' },
          ],
        }]
      }
      if (/同步/.test(normalizedActionLabel)) {
        return [{
          heading: '同步任务',
          fields: [
            { label: '商品信息', value: detail?.canonical_name ?? row.meta?.productName ?? '--' },
            { label: '主SKU', value: detail?.primary_sku_key ?? row.meta?.skuKey ?? '--' },
            { label: activeSubmenu.key === 'product-store' ? '门店' : '仓库', value: row.meta?.organizationName ?? row.meta?.organizationCode ?? '--' },
            { label: '销售渠道', value: row.meta?.salesChannel ?? '--' },
            { label: '来源链接', value: sourceLinkCount },
            { label: '更新时间', value: updatedAt || '--' },
          ],
        }]
      }
      return [{
        heading: normalizedActionLabel || activeSubmenu.label,
        fields: baseFields,
      }]
    }

    return [{
      heading: activeSubmenu.label,
      fields: baseFields,
    }, {
      heading: '商品链路',
      fields: supplyFields,
    }, {
      heading: '来源链路',
      fields: [
        { label: '来源备注', value: detail?.notes || '--' },
        { label: '最近同步', value: updatedAt || '--' },
        { label: '规则接入状态', value: detail?.businessRule?.product_id ? '已接产品规则主链' : '待补业务规则' },
      ],
    }]
  }

  function buildOrganizationDialogSections(row?: RenderRow) {
    if (!row) return []
    if (activeSubmenu.key === 'organization-shop') {
      return [{
        heading: '门店信息',
        fields: [
          { label: '所属公司', value: row.meta?.organizationName ?? buildDialogValue(row, 2) },
          { label: '所在地区', value: [buildDialogValue(row, 3), buildDialogValue(row, 4), buildDialogValue(row, 5)].filter((value) => value && value !== '--').join(' / ') || '--' },
          { label: '详细地址', value: '--' },
          { label: '店铺编码', value: row.meta?.organizationCode ?? buildDialogValue(row, 1) },
          { label: '店铺名称', value: row.meta?.organizationName ?? buildDialogValue(row, 0) },
          { label: '电话', value: '--' },
          { label: '负责人姓名', value: '--' },
          { label: '负责人电话', value: '--' },
          { label: '描述', value: '--' },
          { label: '状态', value: buildDialogValue(row, 7) },
          { label: '门店类型', value: buildDialogValue(row, 6) },
          { label: '入驻平台', value: row.meta?.orderSource ?? '--' },
        ],
      }]
    }
    return [{
      heading: '仓库信息',
      fields: [
        { label: '所属公司', value: row.meta?.organizationName ?? buildDialogValue(row, 2) },
        { label: '所在地区', value: [buildDialogValue(row, 3), buildDialogValue(row, 4), buildDialogValue(row, 5)].filter((value) => value && value !== '--').join(' / ') || '--' },
        { label: '详细地址', value: '--' },
        { label: '仓库编码', value: row.meta?.organizationCode ?? buildDialogValue(row, 1) },
        { label: '仓库名称', value: row.meta?.organizationName ?? buildDialogValue(row, 0) },
        { label: '电话', value: '--' },
        { label: '负责人姓名', value: '--' },
        { label: '负责人电话', value: '--' },
        { label: '描述', value: '--' },
        { label: '状态', value: buildDialogValue(row, 6) },
      ],
    }]
  }

  function buildOrderDetailDialogSections(row?: RenderRow) {
    if (!row) return []
    return [{
      heading: '用户信息',
      fields: [
        { label: '商品信息', value: row.meta?.productName ?? buildDialogValue(row, 0) },
        { label: '收货信息', value: row.meta?.customerPhone ? [row.meta.customerName, row.meta.customerPhone].filter(Boolean).join(' / ') : buildDialogValue(row, 1) },
        { label: '下单时间', value: buildDialogValue(row, 2) },
        { label: '送货时间', value: buildDialogValue(row, 3) },
        { label: '门店/微商城', value: row.meta?.organizationCode ?? buildDialogValue(row, 4) },
        { label: '配送站/仓库', value: row.meta?.deliveryStation ?? buildDialogValue(row, 5) },
        { label: '实付金额', value: row.meta?.paidAmount ?? buildDialogValue(row, 6) },
        { label: '订单状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 7) },
        { label: '订单来源', value: row.meta?.orderSource ?? buildDialogValue(row, 8) },
        { label: '配送商', value: row.meta?.courier ?? buildDialogValue(row, 9) },
        { label: '订单号', value: row.meta?.orderNo || '--' },
        { label: '外部订单号', value: row.meta?.externalOrderNo || '--' },
        { label: '订单ID', value: row.meta?.orderId || '--' },
      ],
    }]
  }

  function buildOfflineRefundDialogSections(row?: RenderRow) {
    if (!row) return []
    return [{
      heading: '退款信息',
      fields: [
        { label: '订单号', value: row.meta?.orderNo || '--' },
        { label: '退款单号', value: row.meta?.externalOrderNo || row.id || '--' },
        { label: '所属店铺', value: row.meta?.organizationName || '--' },
        { label: '配送所属', value: row.meta?.organizationCode || '--' },
        { label: '申请时间', value: buildDialogValue(row, 8) },
        { label: '退款单类型', value: buildDialogValue(row, 4) },
        { label: '商品信息', value: row.meta?.productName ?? buildDialogValue(row, 0) },
        { label: '收货信息', value: buildDialogValue(row, 1) },
        { label: '门店', value: buildDialogValue(row, 2) },
        { label: '订单来源', value: row.meta?.orderSource ?? buildDialogValue(row, 3) },
        { label: '申请人', value: buildDialogValue(row, 5) },
        { label: '申请退款金额', value: row.meta?.paidAmount ?? buildDialogValue(row, 6) },
        { label: '是否退货', value: buildDialogValue(row, 7) },
        { label: '状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 9) },
      ],
    }]
  }

  function buildOnlineOrderDialogSections(row?: RenderRow) {
    if (!row) return []
    return [{
      heading: '订单信息',
      fields: [
        { label: '所属门店', value: row.meta?.organizationName || buildDialogValue(row, 4) },
        { label: '下单时间', value: buildDialogValue(row, 2) },
        { label: '订单渠道', value: row.meta?.orderSource ?? buildDialogValue(row, 9) },
        { label: '订单号', value: row.meta?.orderNo || '--' },
        { label: 'OMS订单号', value: '--' },
        { label: '渠道订单号', value: row.meta?.externalOrderNo || '--' },
        { label: '商品信息', value: row.meta?.productName ?? buildDialogValue(row, 0) },
        { label: '收货信息', value: buildDialogValue(row, 1) },
        { label: '支付时间', value: buildDialogValue(row, 3) },
        { label: '实收金额', value: row.meta?.paidAmount ?? buildDialogValue(row, 5) },
        { label: '订单状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 6) },
        { label: 'OMS订单状态', value: buildDialogValue(row, 7) },
        { label: '下单人', value: buildDialogValue(row, 8) },
      ],
    }]
  }

  function buildOnlineRefundDialogSections(row?: RenderRow) {
    if (!row) return []
    return [{
      heading: '退单信息',
      fields: [
        { label: '所属门店', value: row.meta?.organizationName || buildDialogValue(row, 6) },
        { label: '申请时间', value: buildDialogValue(row, 1) },
        { label: '订单渠道', value: row.meta?.orderSource ?? buildDialogValue(row, 5) },
        { label: '退单号', value: row.meta?.externalOrderNo || '--' },
        { label: '订单号', value: row.meta?.orderNo || '--' },
        { label: '退单类型', value: '线上退单' },
        { label: '商品信息', value: row.meta?.productName ?? buildDialogValue(row, 0) },
        { label: '申请数量', value: buildDialogValue(row, 2) },
        { label: '申请退款金额', value: row.meta?.paidAmount ?? buildDialogValue(row, 3) },
        { label: '退单状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 4) },
      ],
    }]
  }

  function buildFinanceDialogSections(row?: RenderRow, mode: ZdtDialogMode = 'view', actionLabel?: string) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    const rememberedRow = row ?? dialogRowContextBySubmenu[activeSubmenu.key]
    const leadRow = rememberedRow ?? filteredRows[0]
    if (mode === 'action') {
      if (/签署新协议/.test(normalizedActionLabel)) {
        return [{
          heading: '签约范围',
          fields: [
            { label: '所属门店', value: leadRow?.meta?.organizationName ?? resolveActiveSelectScope('全部') },
            { label: '门店编码', value: leadRow?.meta?.organizationCode ?? (leadRow ? buildDialogValue(leadRow, 0) : '--') },
            { label: '签约收款方式', value: leadRow?.meta?.orderSource ?? '微信 / 支付宝 / 其它收款方式' },
            { label: '整单支付订单数', value: leadRow?.meta?.orderCount ?? '--' },
            { label: '渠道收款金额', value: leadRow?.meta?.paidAmount ?? '--' },
            { label: '最近提交时间', value: leadRow ? buildDialogValue(leadRow, 9) : '--' },
            { label: '协议状态', value: leadRow ? buildDialogValue(leadRow, 3) : '--' },
          ],
        }]
      }
      if (/线下已签转线上变更|变更协议/.test(normalizedActionLabel)) {
        return [{
          heading: '协议变更',
          fields: [
            { label: '变更对象', value: rememberedRow?.meta?.organizationName ?? leadRow?.meta?.organizationName ?? resolveActiveSelectScope('全部') },
            { label: '当前收款方式', value: rememberedRow?.meta?.orderSource ?? '--' },
            { label: '当前协议状态', value: rememberedRow ? buildDialogValue(rememberedRow, 3) : '--' },
            { label: '渠道收款金额', value: rememberedRow?.meta?.paidAmount ?? leadRow?.meta?.paidAmount ?? '--' },
            { label: '整单支付订单数', value: rememberedRow?.meta?.orderCount ?? leadRow?.meta?.orderCount ?? '--' },
            { label: '最近提交时间', value: rememberedRow ? buildDialogValue(rememberedRow, 9) : leadRow ? buildDialogValue(leadRow, 9) : '--' },
            { label: '门店编码', value: rememberedRow?.meta?.organizationCode ?? (rememberedRow ? buildDialogValue(rememberedRow, 0) : leadRow ? buildDialogValue(leadRow, 0) : '--') },
          ],
        }]
      }
    }
    if (!row) return []
    return [{
      heading: activeSubmenu.label,
      fields: [
        { label: '门店编码', value: buildDialogValue(row, 0) },
        { label: '门店名称', value: row.meta?.organizationName ?? buildDialogValue(row, 1) },
        { label: '收款方式', value: row.meta?.orderSource ?? buildDialogValue(row, 2) },
        { label: '申请状态', value: buildDialogValue(row, 3) },
        { label: '请求结果状态', value: buildDialogValue(row, 4) },
        { label: '微信授权状态', value: buildDialogValue(row, 5) },
        { label: '支付宝授权状态', value: buildDialogValue(row, 6) },
        { label: '短信签合同状态', value: buildDialogValue(row, 7) },
        { label: '协议退回原因', value: row.meta?.note ?? buildDialogValue(row, 8) },
        { label: '提交时间', value: buildDialogValue(row, 9) },
        { label: '统计口径', value: buildDialogValue(row, 10) },
        { label: '订单笔数', value: row.meta?.orderCount ?? '--' },
        { label: '渠道收款金额', value: row.meta?.paidAmount ?? '--' },
      ],
    }]
  }

  function buildAccountDialogSections(row?: RenderRow, mode: ZdtDialogMode = 'view', actionLabel?: string) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    const leadRow = row ?? dialogRowContextBySubmenu[activeSubmenu.key] ?? filteredRows[0]
    if (activeSubmenu.key === 'account-target') {
      if (!row && mode === 'action') {
        return [{
          heading: /导入/.test(normalizedActionLabel) ? '导入目标' : '导出目标',
          fields: [
            { label: '所属组织', value: leadRow?.meta?.organizationName ?? resolveActiveSelectScope('全部') },
            { label: '目标月份', value: buildDialogValue(leadRow, 3) || `${dateStart || '--'} ~ ${dateEnd || '--'}` },
            { label: '本月销售额', value: leadRow ? buildDialogValue(leadRow, 6) : '--' },
            { label: '本月毛利', value: leadRow ? buildDialogValue(leadRow, 8) : '--' },
            { label: '最近更新', value: leadRow ? buildDialogValue(leadRow, 10) : '--' },
            { label: '更新人', value: leadRow ? buildDialogValue(leadRow, 11) : '--' },
          ],
        }]
      }
      if (!row) return []
      return [{
        heading: '业绩目标',
        fields: [
          { label: '所属组织', value: row.meta?.organizationName ?? buildDialogValue(row, 0) },
          { label: '姓名', value: buildDialogValue(row, 1) },
          { label: '手机号', value: buildDialogValue(row, 2) },
          { label: '目标月份', value: buildDialogValue(row, 3) },
          { label: '销售目标(元)', value: buildDialogValue(row, 4) },
          { label: '毛利目标(元)', value: buildDialogValue(row, 5) },
          { label: '销售额(元)', value: buildDialogValue(row, 6) },
          { label: '销售目标完成率(%)', value: buildDialogValue(row, 7) },
          { label: '毛利(元)', value: buildDialogValue(row, 8) },
          { label: '毛利目标完成率(%)', value: buildDialogValue(row, 9) },
          { label: '更新日期', value: buildDialogValue(row, 10) },
          { label: '更新人', value: buildDialogValue(row, 11) },
          { label: '月度经营摘要', value: row.meta?.note ?? '--' },
        ],
      }]
    }

    if (mode === 'action' && /重置账号密码/.test(normalizedActionLabel)) {
      return [{
        heading: '重置账号密码',
        fields: [
          { label: '账号', value: row?.meta?.organizationCode ? buildDialogValue(row, 0) : buildDialogValue(row, 0) },
          { label: '姓名', value: buildDialogValue(row, 1) },
          { label: '所属组织', value: row?.meta?.organizationName ?? buildDialogValue(row, 3) },
          { label: '角色', value: buildDialogValue(row, 4) },
          { label: '状态', value: row?.meta?.orderStatus ?? buildDialogValue(row, 5) },
          { label: '最近活跃', value: row?.meta?.note ?? '--' },
        ],
      }]
    }

    if (!row && mode === 'action') {
      return [{
        heading: '账号动作',
        fields: [
          { label: '动作', value: normalizedActionLabel || '账号操作' },
          { label: '所属组织', value: leadRow?.meta?.organizationName ?? resolveActiveSelectScope('全部') },
          { label: '账号', value: leadRow ? buildDialogValue(leadRow, 0) : '--' },
          { label: '角色', value: leadRow ? buildDialogValue(leadRow, 4) : '--' },
          { label: '最近活跃', value: leadRow?.meta?.note ?? '--' },
        ],
      }]
    }
    if (!row) return []
    return [{
      heading: '员工账号',
      fields: [
        { label: '账号', value: buildDialogValue(row, 0) },
        { label: '姓名', value: buildDialogValue(row, 1) },
        { label: '手机号', value: buildDialogValue(row, 2) },
        { label: '所属组织', value: row.meta?.organizationName ?? buildDialogValue(row, 3) },
        { label: '角色', value: buildDialogValue(row, 4) },
        { label: '状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 5) },
        { label: '标签', value: buildDialogValue(row, 6) },
        { label: '最近活跃', value: row.meta?.note ?? '--' },
        { label: '所属组织编码', value: row.meta?.organizationCode ?? '--' },
      ],
    }]
  }

  function buildDeviceDialogSections(row?: RenderRow, mode: ZdtDialogMode = 'view', actionLabel?: string) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    const leadRow = row ?? dialogRowContextBySubmenu[activeSubmenu.key] ?? filteredRows[0]
    if (!row && mode === 'action') {
      return [{
        heading: /添加POS终端/.test(normalizedActionLabel) ? '新增终端' : '设备动作',
        fields: [
          { label: '新增类型', value: normalizedActionLabel || '设备操作' },
          { label: '所属组织', value: leadRow?.meta?.organizationName ?? (leadRow ? buildDialogValue(leadRow, 3) : resolveActiveSelectScope('全部')) },
          { label: '终端编号', value: leadRow ? buildDialogValue(leadRow, 0) : '--' },
          { label: '激活状态', value: leadRow ? buildDialogValue(leadRow, 4) : '--' },
          { label: '最近激活时间', value: leadRow ? buildDialogValue(leadRow, 5) : '--' },
          { label: '当前状态', value: leadRow?.meta?.orderStatus ?? (leadRow ? buildDialogValue(leadRow, 6) : '--') },
        ],
      }]
    }
    if (!row) return []
    return [{
      heading: 'POS终端',
      fields: [
        { label: 'POS终端编号', value: buildDialogValue(row, 0) },
        { label: '设备ID', value: buildDialogValue(row, 1) },
        { label: 'MAC', value: buildDialogValue(row, 2) },
        { label: '所属组织', value: row.meta?.organizationName ?? buildDialogValue(row, 3) },
        { label: '激活状态', value: buildDialogValue(row, 4) },
        { label: '激活时间', value: buildDialogValue(row, 5) },
        { label: '使用状态', value: row.meta?.orderStatus ?? buildDialogValue(row, 6) },
        { label: '创建时间', value: buildDialogValue(row, 7) },
        { label: '备注', value: row.meta?.note ?? '--' },
        { label: '所属组织编码', value: row.meta?.organizationCode ?? '--' },
      ],
    }]
  }

  function buildReportDialogSections(row?: RenderRow, mode: ZdtDialogMode = 'view', actionLabel?: string) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    const leadRow = row ?? filteredRows[0]
    if (mode === 'action' && /导出/.test(normalizedActionLabel)) {
      if (activeSubmenu.key === 'report-product') {
        return [{
          heading: '导出范围',
          fields: [
            { label: '组织架构', value: resolveActiveSelectScope('全部') },
            { label: '日期范围', value: [dateStart || '--', dateEnd || '--'].join(' ~ ') },
            { label: '商品分类', value: leadRow ? buildDialogValue(leadRow, 0) : '--' },
            { label: '商品信息', value: leadRow ? buildDialogValue(leadRow, 1) : '--' },
            { label: 'PN/MTM', value: leadRow ? buildDialogValue(leadRow, 2) : '--' },
            { label: '净销量', value: leadRow ? buildDialogValue(leadRow, 5) : '--' },
            { label: '销售额', value: leadRow ? buildDialogValue(leadRow, 12) : '--' },
            { label: '实收金额', value: leadRow ? buildDialogValue(leadRow, 22) : '--' },
          ],
        }]
      }
      if (activeSubmenu.key === 'report-sales-analysis') {
        return [{
          heading: '导出范围',
          fields: [
            { label: '组织架构', value: resolveActiveSelectScope('全部') },
            { label: '日期范围', value: [dateStart || '--', dateEnd || '--'].join(' ~ ') },
            { label: '订单号', value: leadRow ? buildDialogValue(leadRow, 0) : '--' },
            { label: '门店', value: leadRow ? buildDialogValue(leadRow, 3) : '--' },
            { label: 'PN/MTM', value: leadRow ? buildDialogValue(leadRow, 4) : '--' },
            { label: '商品信息', value: leadRow ? buildDialogValue(leadRow, 5) : '--' },
            { label: '实收金额', value: leadRow ? buildDialogValue(leadRow, 12) : '--' },
            { label: '毛利额', value: leadRow ? buildDialogValue(leadRow, 15) : '--' },
          ],
        }]
      }
      if (activeSubmenu.key === 'report-sales-daily') {
        return [{
          heading: '导出范围',
          fields: [
            { label: '组织架构', value: resolveActiveSelectScope('全部') },
            { label: '日期范围', value: [dateStart || '--', dateEnd || '--'].join(' ~ ') },
            { label: '业务日期', value: leadRow ? buildDialogValue(leadRow, 0) : '--' },
            { label: '门店', value: leadRow ? buildDialogValue(leadRow, 1) : '--' },
            { label: '订单数', value: leadRow ? buildDialogValue(leadRow, 2) : '--' },
            { label: '销售数量', value: leadRow ? buildDialogValue(leadRow, 5) : '--' },
            { label: '实收金额', value: leadRow ? buildDialogValue(leadRow, 8) : '--' },
            { label: '毛利额', value: leadRow ? buildDialogValue(leadRow, 10) : '--' },
          ],
        }]
      }
      if (activeSubmenu.key === 'report-sn-valid') {
        return [{
          heading: '导出范围',
          fields: [
            { label: '组织架构', value: resolveActiveSelectScope('全部') },
            { label: '日期范围', value: [dateStart || '--', dateEnd || '--'].join(' ~ ') },
            { label: 'SN', value: leadRow ? buildDialogValue(leadRow, 4) : '--' },
            { label: '订单号', value: leadRow ? buildDialogValue(leadRow, 13) : '--' },
            { label: '门店编码', value: leadRow ? buildDialogValue(leadRow, 15) : '--' },
            { label: '门店', value: leadRow ? buildDialogValue(leadRow, 16) : '--' },
            { label: '有效销量判断', value: leadRow ? buildDialogValue(leadRow, 0) : '--' },
          ],
        }]
      }
    }
    if (!row) return []
    if (activeSubmenu.key === 'report-payment') {
      return [{
        heading: '支付统计',
        fields: [
          { label: '门店名称', value: buildDialogValue(row, 0) },
          { label: '支付渠道', value: buildDialogValue(row, 1) },
          { label: '收款金额', value: buildDialogValue(row, 2) },
          { label: '成功支付笔数', value: buildDialogValue(row, 3) },
          { label: '退款金额', value: buildDialogValue(row, 4) },
          { label: '退款笔数', value: buildDialogValue(row, 5) },
          { label: '贴息金额', value: buildDialogValue(row, 6) },
          { label: '渠道净额', value: buildDialogValue(row, 7) },
          { label: '整单支付订单数', value: buildDialogValue(row, 8) },
          { label: '退款订单数', value: buildDialogValue(row, 9) },
        ],
      }]
    }
    return [{
      heading: activeSubmenu.label,
      fields: listHeaders
        .slice(0, Math.min(listHeaders.length, row.cells.length))
        .map((label, index) => ({ label, value: buildDialogValue(row, index) })),
    }]
  }

  function buildDialogSections(row?: RenderRow, mode: ZdtDialogMode = 'view', actionLabel?: string) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel ?? '')
    if (mode === 'view' && normalizedActionLabel === '查看序列号') {
      if (!row) return buildInventoryContextRequiredSections(normalizedActionLabel)
      return buildInventorySerialDialogSections(row)
    }
    if (mode === 'view' && normalizedActionLabel === '销售成本记录') {
      if (!row) return buildInventoryContextRequiredSections(normalizedActionLabel)
      return buildInventoryCostDialogSections(row)
    }
    if (mode === 'view' && normalizedActionLabel === '库存流水') {
      if (!row) return buildInventoryContextRequiredSections(normalizedActionLabel)
      return buildInventoryMovementDialogSections(row)
    }
    if (activeSubmenu.key === 'inventory-location') {
      return buildInventoryLocationDialogSections(row, mode, normalizedActionLabel)
    }
    if (activeSubmenu.key === 'inventory-location-move') {
      return buildInventoryLocationMoveDialogSections(row, mode, normalizedActionLabel)
    }
    if (activeTopMenuKey === 'product') {
      return buildProductDialogSections(row, mode, normalizedActionLabel)
    }
    if (mode === 'view' && activeTopMenuKey === 'organization') {
      return buildOrganizationDialogSections(row)
    }
    if (activeTopMenuKey === 'finance') {
      return buildFinanceDialogSections(row, mode, normalizedActionLabel)
    }
    if (activeTopMenuKey === 'account') {
      return buildAccountDialogSections(row, mode, normalizedActionLabel)
    }
    if (activeTopMenuKey === 'device') {
      return buildDeviceDialogSections(row, mode, normalizedActionLabel)
    }
    if (activeTopMenuKey === 'report') {
      return buildReportDialogSections(row, mode, normalizedActionLabel)
    }
    if (mode === 'view' && activeSubmenu.key === 'order-offline-refund' && /查看|详情/.test(normalizedActionLabel)) {
      return buildOfflineRefundDialogSections(row)
    }
    if (mode === 'view' && activeSubmenu.key === 'order-online' && /查看|详情/.test(normalizedActionLabel)) {
      return buildOnlineOrderDialogSections(row)
    }
    if (mode === 'view' && activeSubmenu.key === 'order-online-refund' && /查看|详情/.test(normalizedActionLabel)) {
      return buildOnlineRefundDialogSections(row)
    }
    if (mode === 'view' && activeTopMenuKey === 'order' && /查看|详情/.test(normalizedActionLabel)) {
      return buildOrderDetailDialogSections(row)
    }
    if (row && mode === 'view') {
      const rowFieldLabels = listHeaders.filter((header) => !header.includes('操作'))
      const rowFields = rowFieldLabels.map((label, index) => ({
        label,
        value: buildDialogValue(row, index),
      }))
      return rowFields.length
        ? [{
            heading: activeReplicaSpec?.detail.headings?.[0] || undefined,
            fields: rowFields,
          }]
        : []
    }
    const fieldPairs = activeReplicaSpec?.detail.fieldPairs.length
      ? activeReplicaSpec.detail.fieldPairs
      : detailFieldLabels.map((label, index) => ({
        index,
        labels: [label] as [string, string?],
        mergedLabel: label,
      }))
    const headings = activeReplicaSpec?.detail.headings ?? []
    const sectionSize = headings.length > 0 ? Math.max(1, Math.ceil(fieldPairs.length / headings.length)) : 8
    const sections: Array<{ heading?: string; fields: Array<{ label: string; value: string }> }> = []
    for (let index = 0; index < fieldPairs.length; index += sectionSize) {
      const slice = fieldPairs.slice(index, index + sectionSize)
      sections.push({
        heading: headings[sections.length] || undefined,
        fields: slice.map((pair, offset) => ({
          label: pair.mergedLabel,
          value: buildDialogValue(row, index + offset),
        })),
      })
    }
    return sections.filter((section) => section.fields.length)
  }

  function openActionDialog(actionLabel: string, row?: RenderRow) {
    const normalizedActionLabel = normalizeDialogActionLabel(actionLabel)
    const isInventoryDetailAction = ['查看序列号', '销售成本记录', '库存流水'].includes(normalizedActionLabel)
    const rememberedRow = dialogRowContextBySubmenu[activeSubmenu.key]
    const effectiveRow = row ?? (isInventoryDetailAction ? rememberedRow : undefined)
    if (row) {
      setDialogRowContextBySubmenu((current) => ({ ...current, [activeSubmenu.key]: row }))
    }
    const mode: ZdtDialogMode = /配置税率/.test(normalizedActionLabel)
      ? 'action'
      : /编辑|备注|配置|维护/.test(normalizedActionLabel)
      ? 'edit'
      : /新建|发布|上架|下架|选择|导出|导入|同步|入库|申请|添加|签署|变更|删除|重置|禁用|置顶|上移|下移|库存查看/.test(normalizedActionLabel)
        ? 'action'
        : 'view'
    const isProductViewAction = activeTopMenuKey === 'product' && mode === 'view'
    const isProductEditAction = activeTopMenuKey === 'product' && mode === 'edit'
    const isProductWorkflowAction = activeTopMenuKey === 'product' && mode === 'action'
    const isOrderViewAction = activeTopMenuKey === 'order' && mode === 'view' && /查看|详情/.test(normalizedActionLabel)
    const isRefundViewAction = activeSubmenu.key === 'order-offline-refund' && isOrderViewAction
    const isOnlineViewAction = activeSubmenu.key === 'order-online' && isOrderViewAction
    const isOnlineRefundViewAction = activeSubmenu.key === 'order-online-refund' && isOrderViewAction
    const dialogTitle = isInventoryDetailAction
      ? `${normalizedActionLabel} - ${activeReplicaSpec?.submenu.pageTitle || activeSubmenu.label}`
      : activeSubmenu.key === 'product-city' && /配置税率/.test(normalizedActionLabel)
      ? '配置税率 - 智慧零售云平台'
      : activeSubmenu.key === 'product-hot-sale' && /选择商品/.test(normalizedActionLabel)
      ? '选择商品 - 智慧零售云平台'
      : activeSubmenu.key === 'product-hot-sale' && /删除/.test(normalizedActionLabel)
      ? '删除热卖商品 - 智慧零售云平台'
      : activeSubmenu.key === 'product-hot-sale' && /置顶|上移|下移/.test(normalizedActionLabel)
      ? `${normalizedActionLabel}热卖商品 - 智慧零售云平台`
      : activeSubmenu.key === 'product-supplier' && /新建/.test(normalizedActionLabel)
      ? '新建供应商 - 智慧零售云平台'
      : activeSubmenu.key === 'product-supplier' && /编辑/.test(normalizedActionLabel)
      ? '编辑供应商 - 智慧零售云平台'
      : activeSubmenu.key === 'product-supplier' && /禁用/.test(normalizedActionLabel)
      ? '禁用供应商 - 智慧零售云平台'
      : activeSubmenu.key === 'product-supplier' && /删除/.test(normalizedActionLabel)
      ? '删除供应商 - 智慧零售云平台'
      : activeSubmenu.key === 'inventory-location' && /商品入库/.test(normalizedActionLabel)
      ? '商品入库 - 智慧零售云平台'
      : activeSubmenu.key === 'inventory-location' && /库存查看/.test(normalizedActionLabel)
      ? '库存查看 - 智慧零售云平台'
      : activeSubmenu.key === 'inventory-location' && /查看/.test(normalizedActionLabel)
      ? '库位库存 - 智慧零售云平台'
      : activeSubmenu.key === 'inventory-location-move' && /商品入库/.test(normalizedActionLabel)
      ? '商品入库 - 智慧零售云平台'
      : activeSubmenu.key === 'inventory-location-move' && /出入库|商品入库/.test(normalizedActionLabel)
      ? '同店换库位 - 智慧零售云平台'
      : isProductEditAction
      ? '编辑商品 - 智慧零售云平台'
      : isProductWorkflowAction && /发布/.test(normalizedActionLabel)
      ? '发布商品 - 智慧零售云平台'
      : isProductWorkflowAction && /上架/.test(normalizedActionLabel)
      ? '商品上架 - 智慧零售云平台'
      : isProductWorkflowAction && /下架/.test(normalizedActionLabel)
      ? '商品下架 - 智慧零售云平台'
      : isProductWorkflowAction && /同步/.test(normalizedActionLabel)
      ? '同步至OMS - 智慧零售云平台'
      : isProductWorkflowAction && /导出/.test(normalizedActionLabel)
      ? '导出商品 - 智慧零售云平台'
      : isRefundViewAction
      ? '退款订单 - 智慧零售云平台'
      : isOnlineViewAction
      ? '线上订单 - 智慧零售云平台'
      : isOnlineRefundViewAction
      ? '线上退单 - 智慧零售云平台'
      : isOrderViewAction
      ? `订单详情 - 智慧零售云平台`
      : activeTopMenuKey === 'finance' && /签署新协议/.test(normalizedActionLabel)
      ? '签署新协议 - 智慧零售云平台'
      : activeTopMenuKey === 'finance' && /线下已签转线上变更|变更协议/.test(normalizedActionLabel)
      ? '变更协议 - 智慧零售云平台'
      : activeTopMenuKey === 'account' && /重置账号密码/.test(normalizedActionLabel)
      ? '重置账号密码 - 智慧零售云平台'
      : activeTopMenuKey === 'account' && /导入目标/.test(normalizedActionLabel)
      ? '导入目标 - 智慧零售云平台'
      : activeTopMenuKey === 'account' && /导出目标/.test(normalizedActionLabel)
      ? '导出目标 - 智慧零售云平台'
      : activeTopMenuKey === 'device' && /添加POS终端/.test(normalizedActionLabel)
      ? '添加POS终端 - 智慧零售云平台'
      : activeTopMenuKey === 'finance' && /查看|详情|变更/.test(normalizedActionLabel)
      ? `${activeSubmenu.label} - 智慧零售云平台`
      : activeTopMenuKey === 'account' && /查看|详情|重置|导入|导出/.test(normalizedActionLabel)
      ? `${activeSubmenu.label} - 智慧零售云平台`
      : activeTopMenuKey === 'device' && /详情|编辑|重置|删除|添加/.test(normalizedActionLabel)
      ? `${activeSubmenu.label} - 智慧零售云平台`
      : isProductViewAction
      ? `${activeSubmenu.label} - 智慧零售云平台`
      : /查看|详情/.test(normalizedActionLabel)
      ? (activeReplicaSpec?.detail.title || `${normalizedActionLabel} - ${activeReplicaSpec?.submenu.pageTitle || activeSubmenu.label}`)
      : `${normalizedActionLabel} - ${activeReplicaSpec?.submenu.pageTitle || activeSubmenu.label}`
    const sections = buildDialogSections(effectiveRow, mode, normalizedActionLabel)
    const draft = Object.fromEntries(
      sections.flatMap((section) =>
        section.fields.map((field) => [field.label, field.value === '--' ? '' : field.value]),
      ),
    )
    const supportsWorkflowSubmission = shouldUseWorkflowSubmission(mode, normalizedActionLabel)
    setActiveDialog({
      title: dialogTitle,
      mode,
      actionLabel: normalizedActionLabel,
      hasRowContext: Boolean(effectiveRow),
      buttons: isInventoryDetailAction ? [] : dialogButtons,
      submitLabel: supportsWorkflowSubmission ? resolveWorkflowSubmitLabel(normalizedActionLabel) : undefined,
      confirmLabel: supportsWorkflowSubmission ? '确认执行后将记录当前动作模拟结果' : undefined,
      successMessage: supportsWorkflowSubmission ? `${normalizedActionLabel} 已记录为同构页动作结果` : undefined,
      sections,
    })
    setDialogDraft(draft)
    setDialogPhase('editing')
  }

  function closeActiveDialog() {
    setActiveDialog(null)
    setDialogDraft({})
    setDialogPhase('editing')
    setDialogReceipt(null)
  }

  function buildDialogReceipt(actionLabel: string, draft: Record<string, string>, row?: RenderRow): ZdtDialogReceipt {
    const now = new Date()
    const executedAt = now.toLocaleString('zh-CN', { hour12: false })
    const receiptId = `ZDT-CLONE-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    const filledFields = Object.entries(draft)
      .filter(([, value]) => value && value.trim())
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }))
    const targetName = row?.meta?.organizationName
      ?? row?.meta?.productName
      ?? row?.meta?.orderNo
      ?? row?.cells?.[0]
      ?? activeSubmenu.label
    const summary = filledFields.length
      ? filledFields.map((field) => `${field.label}=${field.value}`).join('；')
      : '无额外填写字段，按当前页默认上下文提交。'
    return {
      receiptId,
      actionLabel,
      topMenuLabel: zdtTopMenus.find((item) => item.key === activeTopMenuKey)?.label ?? activeTopMenuKey,
      submenuLabel: activeSubmenu.label,
      operator: 'Codex',
      executedAt,
      targetName,
      summary,
      fields: filledFields,
      logs: [
        `${executedAt} 进入 ${activeSubmenu.label} 动作确认态`,
        `${executedAt} 执行人 Codex 提交 ${actionLabel}`,
        `${executedAt} 生成同构页本地回执 ${receiptId}`,
      ],
    }
  }

  function shouldUseWorkflowSubmission(mode: ZdtDialogMode, actionLabel: string) {
    if (mode !== 'action') return false
    if (['finance', 'account', 'device'].includes(activeTopMenuKey)) return true
    if (activeSubmenu.key === 'product-city' && /配置税率|批量发布/.test(actionLabel)) return true
    if (activeSubmenu.key === 'product-hot-sale' && /选择商品|删除|置顶|上移|下移/.test(actionLabel)) return true
    if (activeSubmenu.key === 'product-supplier' && /新建|禁用|删除/.test(actionLabel)) return true
    if (['inventory-location', 'inventory-location-move'].includes(activeSubmenu.key) && /商品入库|出入库|库存查看/.test(actionLabel)) return true
    return false
  }

  function resolveWorkflowSubmitLabel(actionLabel: string) {
    if (/配置税率/.test(actionLabel)) return '保存税率'
    if (/批量发布|发布/.test(actionLabel)) return '提交发布'
    if (/选择商品/.test(actionLabel)) return '确认选择'
    if (/删除/.test(actionLabel)) return '确认删除'
    if (/禁用/.test(actionLabel)) return '确认禁用'
    if (/置顶/.test(actionLabel)) return '确认置顶'
    if (/上移/.test(actionLabel)) return '确认上移'
    if (/下移/.test(actionLabel)) return '确认下移'
    if (/库存查看/.test(actionLabel)) return '查看库存'
    if (/商品入库/.test(actionLabel)) return '确认入库'
    if (/出入库/.test(actionLabel)) return '确认操作'
    if (/导出/.test(actionLabel)) return '确认导出'
    if (/导入/.test(actionLabel)) return '确认导入'
    if (/删除/.test(actionLabel)) return '确认删除'
    if (/重置/.test(actionLabel)) return '确认重置'
    if (/变更/.test(actionLabel)) return '提交变更'
    if (/签署/.test(actionLabel)) return '提交签约'
    if (/添加/.test(actionLabel)) return '创建终端'
    return '提交'
  }

  return (
    <div
      className="zdt-clone-shell"
      data-active-submenu={activeSubmenu.key}
      data-sql-sales-orders-count={sqlSalesOrders?.items?.length ?? 0}
      data-direct-sales-orders-count={directSalesOrders?.items?.length ?? 0}
      data-sql-inventory-count={sqlInventory?.skus?.length ?? 0}
      data-direct-inventory-count={directInventory?.skus?.length ?? 0}
      data-sql-projection-count={publishedProjection?.items?.length ?? 0}
      data-direct-projection-count={directProjection?.items?.length ?? 0}
      data-product-library-count={productItems?.items?.length ?? 0}
      data-direct-product-library-count={directProductItems?.items?.length ?? 0}
      data-retail-core-movement-count={retailCoreMovements?.items?.length ?? 0}
      data-direct-retail-core-movement-count={directRetailCoreMovements?.items?.length ?? 0}
      data-submenu-override-count={submenuRowOverrides[activeSubmenu.key]?.length ?? 0}
      data-submenu-loading={activeSubmenuLoading ? '1' : '0'}
      data-normalized-rows-count={normalizedRows.length}
      data-filtered-rows-count={filteredRows.length}
    >
      <div className="zdt-clone-layout">
        <aside className="zdt-clone-sidebar" aria-label="智店通左侧菜单">
          <div className="zdt-clone-sidebar-brand">
            <div className="zdt-clone-brand-badge">Lenovo</div>
            <div className="zdt-clone-brand-copy">
              <strong>智慧零售云平台</strong>
            </div>
          </div>

          <div className="zdt-clone-top-nav" aria-label="智店通顶级菜单">
            {zdtTopMenus.map((menu) => {
              const Icon = topMenuIcons[menu.key]
              const isActive = menu.key === activeTopMenuKey
              return (
                <button
                  key={menu.key}
                  type="button"
                  className={`zdt-clone-top-nav-button ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTopMenuKey(menu.key)
                    setActiveSubmenuKey(getFirstSubmenu(menu).key)
                  }}
                >
                  <Icon size={16} />
                  <span>{menu.label}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="zdt-clone-main">
          <section className="zdt-clone-subnav" aria-label="智店通子菜单">
            {subnavItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`zdt-clone-subnav-item ${activeSubmenu.key === item.key ? 'active' : ''}`}
                onClick={() => {
                  setActiveSubmenuKey(item.key)
                  void prefetchSubmenuData(item.key)
                }}
              >
                <strong>{item.label}</strong>
              </button>
            ))}
          </section>

          {!!toolbarButtons.length && (
            <section className="zdt-clone-toolbar" aria-label="原页操作栏">
              <div className="zdt-clone-toolbar-buttons">
                {toolbarButtons.map((buttonLabel, index) => (
                  <button
                    key={`toolbar-${buttonLabel}`}
                    type="button"
                    className={`zdt-clone-toolbar-button ${index === 0 ? 'is-primary' : ''}`}
                    onClick={() => openActionDialog(buttonLabel)}
                  >
                    {buttonLabel}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="zdt-clone-filter-panel" aria-label="原页查询区">
            <div className="zdt-clone-filter-main">
              {!!tabs.length && (
                <div className="zdt-clone-status-row">
                  {tabs.map((item) => (
                    <button
                      key={`tab-${item}`}
                      type="button"
                      className={`zdt-clone-status-pill ${activeStatusTab === item ? 'active' : ''}`}
                      onClick={() => {
                        setActiveStatusTab(item)
                        setPageIndex(1)
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}

              <div className="zdt-clone-filter-grid">
                {filterControls.map((control) => {
                  if (control.kind === 'select') {
                    return (
                      <label key={control.key} className="zdt-clone-filter-field">
                        <span>{control.label}</span>
                        <span className="zdt-clone-select-shell">
                          <select
                            className="zdt-clone-select-native"
                            value={filterSelectValues[control.key] ?? '全部'}
                            onChange={(event) =>
                              setFilterSelectValues((current) => ({
                                ...current,
                                [control.key]: event.target.value,
                              }))
                            }
                          >
                            {(selectOptions[control.key] ?? ['全部']).map((option) => (
                              <option key={`${control.key}-${option}`} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={14} />
                        </span>
                      </label>
                    )
                  }

                  if (control.kind === 'date') {
                    const dateFieldIndex = dateFieldLabels.indexOf(control.label)
                    return (
                      <label key={control.key} className="zdt-clone-filter-field">
                        <span>{control.label}</span>
                        <input
                          type="date"
                          value={dateFieldIndex === 0 ? dateStart : dateEnd}
                          onChange={(event) => (dateFieldIndex === 0 ? setDateStart(event.target.value) : setDateEnd(event.target.value))}
                        />
                      </label>
                    )
                  }

                  const value = control.prominent ? searchKeyword : (filterInputValues[control.key] ?? '')
                  return (
                    <label
                      key={control.key}
                      className={`${control.prominent ? 'zdt-clone-filter-search zdt-clone-filter-grid-span' : 'zdt-clone-filter-field'}`}
                    >
                      <span>{control.label}</span>
                      <input
                        value={value}
                        onChange={(event) => {
                          if (control.prominent) {
                            setSearchKeyword(event.target.value)
                            return
                          }
                          setFilterInputValues((current) => ({ ...current, [control.key]: event.target.value }))
                        }}
                        placeholder={control.label}
                      />
                    </label>
                  )
                })}
              </div>

              {!!dateFieldLabels.length && (
                <div className="zdt-clone-filter-date-presets">
                  {DATE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`zdt-clone-filter-preset ${datePreset === preset ? 'active' : ''}`}
                      onClick={() => applyDatePreset(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="zdt-clone-table-shell zdt-clone-table-shell-single" aria-label="列表层">
            <div className="zdt-clone-table-panel">
              <div className="zdt-clone-page-head">
                <div className="zdt-clone-page-head-copy">
                  <strong>{activeReplicaSpec?.submenu.pageTitle || activeSubmenu.label}</strong>
                </div>
                {!!detailEntranceButtons.length && (
                  <div className="zdt-clone-page-head-actions">
                    {detailEntranceButtons.map((buttonLabel) => (
                      <button
                        key={`entrance-${buttonLabel}`}
                        type="button"
                        className="zdt-clone-toolbar-button"
                        onClick={() => openActionDialog(buttonLabel)}
                      >
                        {buttonLabel}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!!reportPaymentSummary.length && (
                <div className="zdt-clone-summary-band" aria-label="支付统计摘要">
                  {reportPaymentSummary.map((item) => (
                    <div key={`${activeSubmenu.key}-${item.label}`} className="zdt-clone-summary-card">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              )}
              <div className="zdt-clone-table-headline">
                <strong>{activeSubmenu.label}</strong>
                <span>当前展示 {pageRows.length} / {filteredRows.length}</span>
              </div>

              <div className="zdt-clone-table-scroll">
                <table className="zdt-clone-table">
                  <thead>
                    <tr>
                      {listHeaders.map((header, index) => (
                        <th key={`header-${index}-${header}`}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length ? pageRows.map((row) => {
                      let cellCursor = 0
                      return (
                        <tr key={row.id}>
                          {listHeaders.map((header, headerIndex) => {
                            if (header.includes('操作')) {
                              const currentOperationIndex = operationColumnIndexes.indexOf(headerIndex)
                              const actionsPerColumn = Math.max(1, Math.ceil(row.actionLabels.length / Math.max(1, operationColumnIndexes.length)))
                              const visibleActions = row.actionLabels.slice(
                                currentOperationIndex * actionsPerColumn,
                                (currentOperationIndex + 1) * actionsPerColumn,
                              )
                              return (
                                <td key={`${row.id}-action-${headerIndex}`} className="is-actions">
                                  <div className="zdt-clone-table-actions">
                                    {visibleActions.map((action) => (
                                      <button
                                        key={`${row.id}-${action}`}
                                        type="button"
                                        className="zdt-clone-table-action"
                                        onClick={() => openActionDialog(action, row)}
                                      >
                                        {action}
                                      </button>
                                    ))}
                                  </div>
                                </td>
                              )
                            }
                            const value = row.cells[cellCursor] ?? '--'
                            const isPrimaryColumn = cellCursor === 0
                            cellCursor += 1
                            return (
                              <td key={`${row.id}-cell-${headerIndex}`}>
                                {isPrimaryColumn ? (
                                  <div className="zdt-clone-primary-cell">
                                    <strong>{value}</strong>
                                  </div>
                                ) : (
                                  value
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    }) : (
                      <tr>
                        <td className="zdt-clone-empty-cell" colSpan={listHeaders.length}>
                          {activeSubmenuLoading
                            ? '数据加载中...'
                            : (searchKeyword || dateStart || dateEnd ? '当前筛选条件下没有命中数据。' : livePanel.emptyText)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="zdt-clone-pagination">
                <span>共 {filteredRows.length} 条记录，第 {safePageIndex} / {totalPages} 页</span>
                <div className="zdt-clone-pagination-controls">
                  <button type="button" onClick={() => setPageIndex(1)} disabled={safePageIndex === 1}>首页</button>
                  <button type="button" onClick={() => setPageIndex((current) => Math.max(1, current - 1))}>上一页</button>
                  {paginationWindow[0] && paginationWindow[0] > 1 ? <span className="zdt-clone-pagination-ellipsis">...</span> : null}
                  {paginationWindow.map((targetPage) => (
                    <button
                      key={`page-${targetPage}`}
                      type="button"
                      className={safePageIndex === targetPage ? 'active' : ''}
                      onClick={() => setPageIndex(targetPage)}
                    >
                      {targetPage}
                    </button>
                  ))}
                  {paginationWindow[paginationWindow.length - 1] && paginationWindow[paginationWindow.length - 1] < totalPages ? (
                    <span className="zdt-clone-pagination-ellipsis">...</span>
                  ) : null}
                  <button type="button" onClick={() => setPageIndex((current) => Math.min(totalPages, current + 1))}>下一页</button>
                  <button type="button" onClick={() => setPageIndex(totalPages)} disabled={safePageIndex === totalPages}>末页</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {activeDialog && (
        <div className="zdt-clone-dialog-backdrop" role="presentation" onClick={closeActiveDialog}>
          <section
            className="zdt-clone-dialog"
            role="dialog"
            aria-modal="true"
            data-dialog-action={activeDialog.actionLabel}
            data-dialog-mode={activeDialog.mode}
            data-dialog-has-row={activeDialog.hasRowContext ? '1' : '0'}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="zdt-clone-dialog-header">
              <div className="zdt-clone-dialog-title">
                {activeDialog.mode === 'view' ? <ExternalLink size={16} /> : activeDialog.mode === 'edit' ? <Pencil size={16} /> : <FileDown size={16} />}
                <strong>{activeDialog.title}</strong>
              </div>
              <button type="button" className="zdt-clone-dialog-close" onClick={closeActiveDialog} aria-label="关闭">
                <X size={16} />
              </button>
            </header>

            {!!activeDialog.buttons.length && (
              <div className="zdt-clone-dialog-toolbar">
                {activeDialog.buttons.map((buttonLabel) => (
                  <button
                    key={`${activeDialog.actionLabel}-dialog-button-${buttonLabel}`}
                    type="button"
                    className="zdt-clone-toolbar-button"
                  >
                    {buttonLabel}
                  </button>
                ))}
              </div>
            )}

            <div className="zdt-clone-dialog-sections">
              {activeDialog.sections.map((section, sectionIndex) => (
                <section key={`${activeDialog.actionLabel}-section-${sectionIndex}`} className="zdt-clone-dialog-section">
                  {section.heading ? <strong className="zdt-clone-dialog-section-title">{section.heading}</strong> : null}
                  <div className="zdt-clone-dialog-grid">
                    {section.fields.map((field) => (
                      <label key={`${activeDialog.actionLabel}-${sectionIndex}-${field.label}`} className="zdt-clone-dialog-field">
                        <span>{field.label}</span>
                        {activeDialog.mode === 'view' ? (
                          <div className="zdt-clone-dialog-value">{field.value}</div>
                        ) : (
                          <input
                            value={dialogDraft[field.label] ?? ''}
                            onChange={(event) =>
                              setDialogDraft((current) => ({
                                ...current,
                                [field.label]: event.target.value,
                              }))
                            }
                            readOnly={dialogPhase !== 'editing'}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {dialogReceipt && dialogPhase === 'submitted' ? (
              <section className="zdt-clone-dialog-receipt">
                <strong className="zdt-clone-dialog-section-title">执行回执</strong>
                <div className="zdt-clone-dialog-grid">
                  <label className="zdt-clone-dialog-field">
                    <span>回执号</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.receiptId}</div>
                  </label>
                  <label className="zdt-clone-dialog-field">
                    <span>动作</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.actionLabel}</div>
                  </label>
                  <label className="zdt-clone-dialog-field">
                    <span>顶级菜单</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.topMenuLabel}</div>
                  </label>
                  <label className="zdt-clone-dialog-field">
                    <span>子菜单</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.submenuLabel}</div>
                  </label>
                  <label className="zdt-clone-dialog-field">
                    <span>执行人</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.operator}</div>
                  </label>
                  <label className="zdt-clone-dialog-field">
                    <span>执行时间</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.executedAt}</div>
                  </label>
                  <label className="zdt-clone-dialog-field">
                    <span>目标对象</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.targetName}</div>
                  </label>
                  <label className="zdt-clone-dialog-field">
                    <span>动作摘要</span>
                    <div className="zdt-clone-dialog-value">{dialogReceipt.summary}</div>
                  </label>
                </div>
                {!!dialogReceipt.logs.length && (
                  <div className="zdt-clone-dialog-log">
                    <strong className="zdt-clone-dialog-log-title">执行日志</strong>
                    <ul>
                      {dialogReceipt.logs.map((logLine) => (
                        <li key={`${dialogReceipt.receiptId}-${logLine}`}>{logLine}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            ) : null}

            <footer className="zdt-clone-dialog-actions">
              {activeDialog.confirmLabel && dialogPhase === 'editing' ? (
                <button
                  type="button"
                  className="zdt-clone-toolbar-button is-primary"
                  onClick={() => setDialogPhase('confirming')}
                >
                  {activeDialog.submitLabel ?? '提交'}
                </button>
              ) : null}
              {activeDialog.confirmLabel && dialogPhase === 'confirming' ? (
                <button
                  type="button"
                  className="zdt-clone-toolbar-button is-primary"
                  onClick={() => {
                    setDialogReceipt(buildDialogReceipt(activeDialog.actionLabel, dialogDraft))
                    setDialogPhase('submitted')
                  }}
                >
                  {activeDialog.confirmLabel}
                </button>
              ) : null}
              {activeDialog.successMessage && dialogPhase === 'submitted' ? (
                <div className="zdt-clone-dialog-result">{activeDialog.successMessage}</div>
              ) : null}
              <button type="button" className="zdt-clone-toolbar-button" onClick={closeActiveDialog}>
                关闭
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}
