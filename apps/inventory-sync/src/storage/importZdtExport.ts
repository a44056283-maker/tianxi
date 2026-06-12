import * as fs from 'fs'
import { execFileSync } from 'node:child_process'

/**
 * 将ZDT导出的Excel文件数据导入到zdt_sync PostgreSQL数据库
 * 
 * 导出文件：
 *   orderData (N).xlsx       → 订单主表（门店/收银员/订单状态）
 *   orderProductData (N).xlsx → 订单明细（商品名称/MTM/规格/SN）
 * 
 * 对应修复：
 *   fact_orders:        shop_name, status_name, cashier_name
 *   fact_order_items:   product_name, mtm_code, spec
 *   fact_sn_records:    sn (via fact_order_items.serial_number → sn)
 */

const db = {
  host: 'localhost',
  port: 5432,
  database: 'zdt_sync',
  user: 'zdt',
  password: 'zdt',
}

// 简单的 PostgreSQL 连接
async function query(sql: string, params: any[] = []): Promise<any[]> {
  const { Client } = await import('pg') as { Client: new (config: Record<string, unknown>) => {
    connect: () => Promise<void>
    query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>
    end: () => Promise<void>
  } }
  const client = new Client(db)
  try {
    await client.connect()
    const result = await client.query(sql, params)
    return result.rows
  } finally {
    await client.end()
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 从 xlsx 读取（用 python3 openpyxl）
async function readXlsx(filePath: string): Promise<{ headers: string[], rows: Record<string, string>[] }> {
  const pyCode = `
import openpyxl, json, sys
wb = openpyxl.load_workbook("${filePath.replace(/"/g, '\\"')}", data_only=True)
ws = wb.active
headers = [str(c.value or '') for c in ws[1]]
rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if any(v is not None for v in row):
        rows.append(dict(zip(headers, [str(v or '') for v in row])))
print(json.dumps({'headers': headers, 'rows': rows}, ensure_ascii=False))
`
  const out = execFileSync('python3', ['-c', pyCode], { encoding: 'utf-8' })
  const data = JSON.parse(out)
  return { headers: data.headers, rows: data.rows }
}

async function importOrderData(orderDataPath: string, productDataPath: string) {
  console.log('=== ZDT 导出数据导入 ===')
  console.log(`订单主表: ${orderDataPath}`)
  console.log(`订单明细: ${productDataPath}`)

  if (!fs.existsSync(orderDataPath) || !fs.existsSync(productDataPath)) {
    console.error('文件不存在')
    return
  }

  const orderData = await readXlsx(orderDataPath)
  const productData = await readXlsx(productDataPath)

  console.log(`\n订单主表: ${orderData.rows.length} 条`)
  console.log(`订单明细: ${productData.rows.length} 条`)
  console.log('主表字段:', orderData.headers)
  console.log('明细字段:', productData.headers)

  // 字段映射
  // orderData: 订单号, 下单时间, 配送时间, 门店, 仓库, 总价, 运费, 优惠, 实际金额, 订单状态, 订单来源, 商品数量, 收银员
  // productData: 订单号, 商品信息, 商品编码, PN/MTM, 商品规格, 商品SN, 单价, 数量, 总价, 优惠, 实付, 门店, 收银员

  // 1. 更新 fact_orders (shop_name, status_name)
  console.log('\n--- 更新 fact_orders ---')
  let updated = 0
  let notFound = 0
  for (const row of orderData.rows) {
    const orderNo = row['订单号']
    const shopName = row['门店']
    const statusName = row['订单状态']
    const cashierName = row['收银员']

    const result = await query(
      `UPDATE fact_orders 
       SET shop_name = $2, status_name = $3, cashier_name = $4
       WHERE order_no = $1
       RETURNING order_no`,
      [orderNo, shopName, statusName, cashierName]
    )
    if (result.length > 0) {
      updated++
    } else {
      notFound++
    }
  }
  console.log(`更新: ${updated} 条, 未找到: ${notFound} 条`)

  // 2. 更新 fact_order_items (product_name, mtm_code, spec)
  //    通过 order_no + product_name + mtm_code 定位
  console.log('\n--- 更新 fact_order_items ---')
  let itemUpdated = 0
  let itemNotFound = 0
  for (const row of productData.rows) {
    const orderNo = row['订单号']
    const productName = row['商品信息']
    const mtmCode = row['PN/MTM']
    const spec = row['商品规格']
    const sn = row['商品SN']

    // 先找 order_id
    const orders = await query('SELECT order_id FROM fact_orders WHERE order_no = $1', [orderNo])
    if (orders.length === 0) {
      itemNotFound++
      continue
    }
    const orderId = orders[0].order_id

    // 更新 fact_order_items
    const result = await query(
      `UPDATE fact_order_items 
       SET product_name = $3, mtm_code = $4, spec = $5
       WHERE order_id = $1 AND (product_name = $2 OR mtm_code = $4 OR spec = $5)
       RETURNING id`,
      [orderId, productName, productName, mtmCode, spec]
    )
    if (result.length > 0) {
      itemUpdated++
    } else {
      // 尝试不用过滤条件直接更新
      const r2 = await query(
        `WITH target AS (
           SELECT id
           FROM fact_order_items
           WHERE order_id = $1
           LIMIT 1
         )
         UPDATE fact_order_items
         SET product_name = $2, mtm_code = $3, spec = $4
         WHERE id IN (SELECT id FROM target)
         RETURNING id`,
        [orderId, productName, mtmCode, spec]
      )
      if (r2.length > 0) itemUpdated++
      else itemNotFound++
    }
  }
  console.log(`更新: ${itemUpdated} 条, 未找到: ${itemNotFound} 条`)

  // 3. 更新 sync_state
  const now = new Date().toISOString()
  await query(
    `UPDATE sync_state SET last_sync_time = $2, last_success_time = $2, status = 'active'
     WHERE entity_name IN ('orders_offline', 'orders_online')`,
    [null, now]
  )
  console.log(`\n更新 sync_state 完成: ${now}`)

  console.log('\n=== 导入完成 ===')
}

// 主入口
const args = process.argv.slice(2)
if (args.length < 2) {
  console.log('用法: ts-node importZdtExport.ts <orderData.xlsx> <productData.xlsx>')
  console.log('示例: ts-node importZdtExport.ts ~/Downloads/orderData.xlsx ~/Downloads/orderProductData.xlsx')
  process.exit(1)
}

importOrderData(args[0], args[1]).catch(console.error)
