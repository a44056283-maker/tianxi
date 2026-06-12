import type { InventoryMovement, SalesOrder, SalesOrderItem, SerialLedger, StaffUser, SyncTask } from './models.js'
import {
  buildInventoryMovementSyncTask,
  buildSalesOrderSyncTask,
  buildSerialLedgerSyncTask,
  buildStaffUserSyncTask,
} from './syncTasks.js'

export type ZhidiantongPushResult = {
  remoteId?: string
  acceptedAt: string
  warnings: string[]
}

export interface LocalRetailSyncRepository {
  listPendingStaffUsers(limit: number): Promise<StaffUser[]>
  listPendingSalesOrders(limit: number): Promise<Array<{ order: SalesOrder; items: SalesOrderItem[] }>>
  listPendingInventoryMovements(limit: number): Promise<InventoryMovement[]>
  listPendingSerialLedgers(limit: number): Promise<SerialLedger[]>
  saveSyncTasks(tasks: SyncTask[]): Promise<void>
}

export interface ZhidiantongSyncGateway {
  pushStaffUser(staffUser: StaffUser): Promise<ZhidiantongPushResult>
  pushSalesOrder(order: SalesOrder, items: SalesOrderItem[]): Promise<ZhidiantongPushResult>
  pushInventoryMovement(movement: InventoryMovement): Promise<ZhidiantongPushResult>
  reconcileSerialLedger(ledger: SerialLedger): Promise<ZhidiantongPushResult>
}

export type RetailSyncTaskBatch = {
  generatedAt: string
  counts: {
    staffUsers: number
    salesOrders: number
    inventoryMovements: number
    serialLedgers: number
  }
  tasks: SyncTask[]
}

export async function buildZhidiantongSyncTaskBatch(
  repository: LocalRetailSyncRepository,
  limitPerAggregate = 100,
): Promise<RetailSyncTaskBatch> {
  const [staffUsers, salesOrders, inventoryMovements, serialLedgers] = await Promise.all([
    repository.listPendingStaffUsers(limitPerAggregate),
    repository.listPendingSalesOrders(limitPerAggregate),
    repository.listPendingInventoryMovements(limitPerAggregate),
    repository.listPendingSerialLedgers(limitPerAggregate),
  ])

  const tasks = [
    ...staffUsers.map(buildStaffUserSyncTask),
    ...salesOrders.map(({ order, items }) => buildSalesOrderSyncTask(order, items)),
    ...inventoryMovements.map(buildInventoryMovementSyncTask),
    ...serialLedgers.map(buildSerialLedgerSyncTask),
  ]

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      staffUsers: staffUsers.length,
      salesOrders: salesOrders.length,
      inventoryMovements: inventoryMovements.length,
      serialLedgers: serialLedgers.length,
    },
    tasks,
  }
}

export const zhidiantongSyncExecutionNotes = {
  sourceOfTruth: 'Only local records create or mutate business facts. Zhidiantong receives synchronized projections.',
  ordering: [
    'sync staff_user before sales_order assignment checks',
    'sync sales_order before sales_outbound confirmation when both originate locally',
    'sync serial_ledger after inventory movement persistence so SN trace stays replayable',
  ],
  reconciliation: [
    'compare daily order totals between local sales_order and Zhidiantong order list',
    'compare serial_ledger sold status against Zhidiantong sales outbound serial rows',
    'treat Zhidiantong-only changes as exceptions that require local review, not automatic overwrite',
  ],
} as const
