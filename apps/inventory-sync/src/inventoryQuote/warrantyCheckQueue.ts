import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { StandardInventorySnapshot } from '../types.js'
import { getLenovoWarrantyLookupUrl } from './lenovoWarrantyUrl.js'
import type { LenovoWarrantySnapshot } from './lenovoWarrantyCollector.js'

export type WarrantyCheckQueueItem = {
  serialNumber: string
  skuKey: string
  productName: string
  pnMtm?: string
  status: 'pending'
  riskHint: string
  officialLookupUrl: string
  priority: 'core_device' | 'phone_tablet' | 'accessory' | 'other'
  priorityScore: number
}

export type WarrantyCheckQueueSnapshot = {
  generatedAt: string
  source: 'lenovo-official-warranty-placeholder'
  limitation: string
  nextStep: string
  total: number
  items: WarrantyCheckQueueItem[]
}

type InventoryMasterWarrantySnapshot = {
  rows?: Array<{
    serialNumber?: string
    warrantyStart?: string
    warrantyEnd?: string
  }>
}

function hasFrozenWarranty(record: {
  status?: string
  officialWarrantyStart?: string
  officialWarrantyEnd?: string
}) {
  return record.status === 'success'
    || record.status === 'not_found'
    || Boolean(record.officialWarrantyStart || record.officialWarrantyEnd)
}

function getWarrantyPriority(input: { productName?: string; category?: string }) {
  const text = `${input.category ?? ''} ${input.productName ?? ''}`
  if (/手机|moto|razr|edge|平板|\bTAB\b|\bPAD\b/i.test(text)) return { priority: 'phone_tablet' as const, priorityScore: 1 }
  if (/(笔记本|一体机|台式|主机|小新|拯救者|Legion|Lecoo|斗战者|ThinkPad|ThinkBook|GeekPro|天逸)/i.test(text)
    && !/(打印机|显示器|适配器|支架|背包|耳机|鼠标|键盘|保护|钢化|贴膜|配件|耗材)/i.test(text)) {
    return { priority: 'core_device' as const, priorityScore: 0 }
  }
  if (/(适配器|支架|背包|耳机|鼠标|键盘|保护|钢化|贴膜|配件|耗材|音箱)/i.test(text)) return { priority: 'accessory' as const, priorityScore: 8 }
  return { priority: 'other' as const, priorityScore: 5 }
}

export async function buildWarrantyCheckQueue(): Promise<WarrantyCheckQueueSnapshot> {
  const inventoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf-8')) as StandardInventorySnapshot
  const masterPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-inventory-master-snapshot.json')
  const masterSnapshot = await fs.readFile(masterPath, 'utf-8')
    .then((content) => JSON.parse(content) as InventoryMasterWarrantySnapshot)
    .catch(() => null)
  const warrantyPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-lenovo-warranty-snapshot.json')
  const warrantySnapshot = await fs.readFile(warrantyPath, 'utf-8')
    .then((content) => JSON.parse(content) as LenovoWarrantySnapshot)
    .catch(() => null)
  const collectedSerials = new Set(
    (warrantySnapshot?.records ?? [])
      .filter((item) => hasFrozenWarranty(item))
      .map((item) => String(item.serialNumber ?? '').trim().toUpperCase())
      .filter(Boolean),
  )
  for (const row of masterSnapshot?.rows ?? []) {
    const serialNumber = String(row.serialNumber ?? '').trim().toUpperCase()
    if (serialNumber && (row.warrantyStart || row.warrantyEnd)) collectedSerials.add(serialNumber)
  }
  const items = inventory.skus.flatMap((sku) => sku.serials.map((serial) => {
    const priority = getWarrantyPriority(sku)
    return {
      serialNumber: serial.serialNumber,
      skuKey: sku.skuKey,
      productName: sku.productName,
      pnMtm: sku.pnMtm,
      status: 'pending' as const,
      riskHint: sku.dataQuality.warnings.length ? sku.dataQuality.warnings.join('；') : '等待联想官网保修页查询。',
      officialLookupUrl: getLenovoWarrantyLookupUrl(serial.serialNumber),
      ...priority,
    }
  }))
    .filter((item) => !collectedSerials.has(String(item.serialNumber ?? '').trim().toUpperCase()))
    .sort((left, right) => left.priorityScore - right.priorityScore || String(left.skuKey).localeCompare(String(right.skuKey)) || left.serialNumber.localeCompare(right.serialNumber))

  return {
    generatedAt: new Date().toISOString(),
    source: 'lenovo-official-warranty-placeholder',
    limitation: '该队列只包含未固化质保结论的 SN；已有成功质保日期或官网明确未命中的 SN 不再进入每日采集。',
    nextStep: '先用 Chrome 现有可见会话逐条打开 officialLookupUrl 手工查询并保存当天截图/文本证据；只有证据已落盘后，才允许运行本地固化与快照重建命令。',
    total: items.length,
    items,
  }
}

export async function saveWarrantyCheckQueue() {
  const snapshot = await buildWarrantyCheckQueue()
  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })

  const content = JSON.stringify(snapshot, null, 2)
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-warranty-check-queue.json')
  const webPath = path.resolve(webPublicDataDir, 'latest-warranty-check-queue.json')
  await fs.writeFile(artifactPath, content, 'utf-8')
  await fs.writeFile(webPath, content, 'utf-8')

  return { artifactPath, webPath, snapshot }
}
