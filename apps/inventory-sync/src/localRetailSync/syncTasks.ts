import {
  type InventoryMovement,
  type SalesOrder,
  type SalesOrderItem,
  type SerialLedger,
  type StaffUser,
  type SyncTask,
  syncTaskSchema,
} from './models.js'

type SyncAggregateType = SyncTask['aggregateType']
type SyncTaskType = SyncTask['taskType']

function nowIso() {
  return new Date().toISOString()
}

function buildSyncTask(input: {
  id: string
  taskType: SyncTaskType
  aggregateType: SyncAggregateType
  aggregateId: string
  idempotencyKey: string
  payload: Record<string, unknown>
  priority?: number
  availableAt?: string
}): SyncTask {
  const timestamp = nowIso()
  return syncTaskSchema.parse({
    id: input.id,
    sourceOfTruth: 'local_retail_system',
    targetSystem: 'zhidiantong',
    taskType: input.taskType,
    status: 'pending',
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    idempotencyKey: input.idempotencyKey,
    priority: input.priority ?? 50,
    attemptCount: 0,
    availableAt: input.availableAt ?? timestamp,
    payloadVersion: 1,
    payload: input.payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export function buildStaffUserSyncTask(staffUser: StaffUser) {
  return buildSyncTask({
    id: `sync-task-staff-${staffUser.id}`,
    taskType: 'staff_user_upsert',
    aggregateType: 'staff_user',
    aggregateId: staffUser.id,
    idempotencyKey: `staff_user:${staffUser.id}:${staffUser.updatedAt}`,
    priority: 20,
    payload: {
      staffUserId: staffUser.id,
      staffCode: staffUser.staffCode,
      storeCode: staffUser.storeCode,
      role: staffUser.role,
      status: staffUser.status,
      zhidiantongUserId: staffUser.zhidiantongUserId,
    },
  })
}

export function buildSalesOrderSyncTask(order: SalesOrder, items: SalesOrderItem[]) {
  return buildSyncTask({
    id: `sync-task-sales-order-${order.id}`,
    taskType: 'sales_order_push',
    aggregateType: 'sales_order',
    aggregateId: order.id,
    idempotencyKey: `sales_order:${order.id}:${order.updatedAt}`,
    priority: 10,
    payload: {
      salesOrderId: order.id,
      orderNo: order.orderNo,
      storeCode: order.storeCode,
      staffUserId: order.staffUserId,
      status: order.status,
      orderTotal: order.orderTotal,
      paidTotal: order.paidTotal,
      items: items.map((item) => ({
        id: item.id,
        skuKey: item.skuKey,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        serialNumbers: item.serialNumbers,
      })),
    },
  })
}

export function buildInventoryMovementSyncTask(movement: InventoryMovement) {
  return buildSyncTask({
    id: `sync-task-movement-${movement.id}`,
    taskType: 'inventory_movement_push',
    aggregateType: 'inventory_movement',
    aggregateId: movement.id,
    idempotencyKey: `inventory_movement:${movement.id}:${movement.updatedAt}`,
    priority: movement.movementType === 'sales_outbound' ? 10 : 30,
    payload: {
      inventoryMovementId: movement.id,
      movementNo: movement.movementNo,
      movementType: movement.movementType,
      skuKey: movement.skuKey,
      quantity: movement.quantity,
      serialNumber: movement.serialNumber,
      salesOrderId: movement.salesOrderId,
      storeCode: movement.storeCode,
      businessDate: movement.businessDate,
    },
  })
}

export function buildSerialLedgerSyncTask(ledger: SerialLedger) {
  return buildSyncTask({
    id: `sync-task-serial-${ledger.id}`,
    taskType: 'serial_ledger_reconcile',
    aggregateType: 'serial_ledger',
    aggregateId: ledger.id,
    idempotencyKey: `serial_ledger:${ledger.serialNumber}:${ledger.updatedAt}`,
    priority: 40,
    payload: {
      serialLedgerId: ledger.id,
      serialNumber: ledger.serialNumber,
      skuKey: ledger.skuKey,
      status: ledger.status,
      storeCode: ledger.storeCode,
      latestMovementId: ledger.latestMovementId,
      latestSalesOrderId: ledger.latestSalesOrderId,
      zhidiantongSerialRef: ledger.zhidiantongSerialRef,
    },
  })
}

export function markSyncTaskProcessing(task: SyncTask, attemptedAt = nowIso()): SyncTask {
  return syncTaskSchema.parse({
    ...task,
    status: 'processing',
    attemptCount: task.attemptCount + 1,
    lastAttemptAt: attemptedAt,
    updatedAt: attemptedAt,
  })
}

export function markSyncTaskSucceeded(task: SyncTask, finishedAt = nowIso()): SyncTask {
  return syncTaskSchema.parse({
    ...task,
    status: 'succeeded',
    lastError: undefined,
    updatedAt: finishedAt,
  })
}

export function markSyncTaskRetryableFailure(task: SyncTask, errorMessage: string, retryAt: string): SyncTask {
  return syncTaskSchema.parse({
    ...task,
    status: 'failed',
    availableAt: retryAt,
    lastError: errorMessage,
    updatedAt: nowIso(),
  })
}

export function markSyncTaskDeadLetter(task: SyncTask, errorMessage: string): SyncTask {
  return syncTaskSchema.parse({
    ...task,
    status: 'dead_letter',
    lastError: errorMessage,
    updatedAt: nowIso(),
  })
}
