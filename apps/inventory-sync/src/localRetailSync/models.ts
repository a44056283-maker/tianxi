import { z } from 'zod'

export const businessSourceSchema = z.literal('local_retail_system')
export const syncTargetSchema = z.literal('zhidiantong')

export const staffUserStatusSchema = z.enum(['active', 'disabled', 'pending_activation'])
export const staffUserRoleSchema = z.enum(['store_manager', 'cashier', 'inventory_clerk', 'finance_auditor', 'admin'])

export const staffUserSchema = z.object({
  id: z.string().min(1),
  sourceOfTruth: businessSourceSchema,
  storeCode: z.string().min(1),
  staffCode: z.string().min(1),
  displayName: z.string().min(1),
  mobile: z.string().trim().optional(),
  role: staffUserRoleSchema,
  status: staffUserStatusSchema,
  zhidiantongUserId: z.string().trim().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const salesOrderStatusSchema = z.enum(['draft', 'submitted', 'paid', 'fulfilled', 'cancelled', 'refunded'])
export const salesOrderChannelSchema = z.enum(['store_pos', 'mobile_pos', 'manual_backoffice'])

export const salesOrderItemSchema = z.object({
  id: z.string().min(1),
  salesOrderId: z.string().min(1),
  lineNo: z.number().int().positive(),
  skuKey: z.string().min(1),
  productName: z.string().min(1),
  pnMtm: z.string().trim().optional(),
  spec: z.string().trim().optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  serialNumbers: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const salesOrderSchema = z.object({
  id: z.string().min(1),
  sourceOfTruth: businessSourceSchema,
  orderNo: z.string().min(1),
  storeCode: z.string().min(1),
  channel: salesOrderChannelSchema,
  status: salesOrderStatusSchema,
  staffUserId: z.string().min(1),
  customerName: z.string().trim().optional(),
  customerMobile: z.string().trim().optional(),
  zhidiantongOrderId: z.string().trim().optional(),
  orderTotal: z.number().nonnegative(),
  paidTotal: z.number().nonnegative().default(0),
  notes: z.string().trim().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  submittedAt: z.string().datetime().optional(),
  paidAt: z.string().datetime().optional(),
  fulfilledAt: z.string().datetime().optional(),
})

export const inventoryMovementTypeSchema = z.enum([
  'purchase_inbound',
  'sales_outbound',
  'refund_inbound',
  'transfer_inbound',
  'transfer_outbound',
  'stock_adjustment',
])

export const inventoryMovementSchema = z.object({
  id: z.string().min(1),
  sourceOfTruth: businessSourceSchema,
  movementNo: z.string().min(1),
  movementType: inventoryMovementTypeSchema,
  businessDate: z.string().date(),
  skuKey: z.string().min(1),
  quantity: z.number(),
  serialNumber: z.string().trim().optional(),
  storeCode: z.string().min(1),
  locationCode: z.string().trim().optional(),
  salesOrderId: z.string().trim().optional(),
  operatorStaffUserId: z.string().trim().optional(),
  zhidiantongDocumentId: z.string().trim().optional(),
  note: z.string().trim().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const serialLedgerStatusSchema = z.enum(['in_stock', 'reserved', 'sold', 'returned', 'scrapped'])

export const serialLedgerSchema = z.object({
  id: z.string().min(1),
  sourceOfTruth: businessSourceSchema,
  serialNumber: z.string().min(1),
  skuKey: z.string().min(1),
  productName: z.string().min(1),
  pnMtm: z.string().trim().optional(),
  spec: z.string().trim().optional(),
  storeCode: z.string().min(1),
  locationCode: z.string().trim().optional(),
  latestMovementId: z.string().trim().optional(),
  latestSalesOrderId: z.string().trim().optional(),
  status: serialLedgerStatusSchema,
  purchaseCost: z.number().nonnegative().optional(),
  inboundDate: z.string().date().optional(),
  warrantyStart: z.string().date().optional(),
  warrantyEnd: z.string().date().optional(),
  zhidiantongSerialRef: z.string().trim().optional(),
  updatedAt: z.string().datetime(),
})

export const syncTaskTypeSchema = z.enum([
  'staff_user_upsert',
  'sales_order_push',
  'inventory_movement_push',
  'serial_ledger_reconcile',
  'daily_reconciliation',
])

export const syncTaskStatusSchema = z.enum(['pending', 'processing', 'succeeded', 'failed', 'dead_letter'])

export const syncTaskSchema = z.object({
  id: z.string().min(1),
  sourceOfTruth: businessSourceSchema,
  targetSystem: syncTargetSchema,
  taskType: syncTaskTypeSchema,
  status: syncTaskStatusSchema,
  aggregateType: z.enum(['staff_user', 'sales_order', 'inventory_movement', 'serial_ledger']),
  aggregateId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  priority: z.number().int().min(1).max(100).default(50),
  attemptCount: z.number().int().nonnegative().default(0),
  availableAt: z.string().datetime(),
  lastAttemptAt: z.string().datetime().optional(),
  lastError: z.string().trim().optional(),
  payloadVersion: z.number().int().positive().default(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type StaffUser = z.infer<typeof staffUserSchema>
export type SalesOrder = z.infer<typeof salesOrderSchema>
export type SalesOrderItem = z.infer<typeof salesOrderItemSchema>
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>
export type SerialLedger = z.infer<typeof serialLedgerSchema>
export type SyncTask = z.infer<typeof syncTaskSchema>
