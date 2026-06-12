# 智店通零售后台 · 数据库设计说明

## 设计原则

1. **ODS → Staging → 正式表**：所有原始数据先进 `raw_records`，再 ETL 到正式表
2. **维度建模**：以订单为事实表核心，商品/门店/日期为维度
3. **幂等 upsert**：基于 `record_id` 做 `ON CONFLICT DO UPDATE`
4. **增量同步**：靠 `sync_state.cursor_value` 记录分页游标或最大时间戳

---

## 表关系

```
dim_store ─────────┐
dim_product ────────┼── fact_orders ── fact_order_items
dim_date ──────────┤              └─ fact_order_payments
dim_payment_channel┘

fact_inventory ──────────────── dim_product
                              └─ dim_store

fact_stock_orders ───────────── dim_store
fact_stock_order_items ────────┤
                              └─ dim_product

fact_products ───────────────── dim_store
                             └─ dim_product
```

---

## 各实体说明

### 1. 订单 (fact_orders + fact_order_items + fact_order_payments)

**主数据源**：`POST /apis/trade/backend/order/findPage`

**流向**：
```
API → raw_records(entity=orders) 
     → ETL: flatten orderNo + orderItemList + orderPayList
     → fact_orders + fact_order_items + fact_order_payments
```

**字段映射**：
- `totalAmount/payAmount/paidAmount`：金额单位是**分**，ETL 时 ÷100 转为元
- `orderItemList`：嵌套 JSON，ETL 时展开到 `fact_order_items`
- `orderPayList`：嵌套 JSON，ETL 时展开到 `fact_order_payments`
- `status`：60=已完成，40=进行中，10/20=待支付

---

### 2. 商品档案 (fact_products)

**主数据源**：门店商品列表页 `/product/list-store`

**流向**：
```
页面 DOM / API → raw_records(entity=products)
              → ETL → fact_products
```

**关键字段**：
- `spuId`：商品SPU ID（主键）
- `skuId`：具体SKU ID
- `productNo`：商品货号/编码
- `barCode`：条码
- `mtmCode`：MTM/PN
- `retailPrice`：零售价（含分，需 ÷100）
- `costPrice`：成本价（含分）

---

### 3. 库存 (fact_inventory)

**主数据源**：库存面板 `/stock/stock/stock-panel`

**流向**：
```
页面 DOM / API → raw_records(entity=inventory)
              → ETL → fact_inventory (snapshot_date=当天)
```

**库存类型**：
- `available_qty`：可用库存
- `locked_qty`：锁定库存
- `in_transit_qty`：在途库存

---

### 4. 库存单据 (fact_stock_orders + fact_stock_order_items)

**主数据源**：SN库存订单页 `/stock/stock/sn-stock-order`

**出入库类型**（`business_type`）：
- `采购入库`：CGR+日期+序号，如 `CGR260520398187`
- `订单出库`：XS+日期+序号，如 `XS26052060983634958`（关联订单）
- `其他出库`：无关联订单的出库

**流向**：
```
页面 DOM / API → raw_records(entity=stock_orders)
              → ETL → fact_stock_orders + fact_stock_order_items
```

---

### 5. 支付统计 (fact_payments)

**主数据源**：支付统计报表 `/report/payment`

**聚合粒度**：按日期+门店+支付渠道聚合

---

## Sync State 管理

```sql
-- 每次采集前查 cursor
SELECT cursor_value, last_success_time 
FROM sync_state 
WHERE source_name='zhidiantong' AND entity_name='orders';

-- 采集完成后更新
UPDATE sync_state 
SET cursor_value = :new_cursor,
    last_success_time = now(),
    last_sync_time = now(),
    status = 'success',
    last_error = NULL
WHERE source_name='zhidiantong' AND entity_name='orders';
```

**cursor_value 策略**：
- 订单：最大 `createdTime` 时间戳
- 库存单据：最大 `createdTime`
- 库存快照：`snapshot_date = today`

---

## ETL 脚本命名规范

```
scripts/etl/
  etl_orders.py        # raw_records → fact_orders + items + payments
  etl_products.py      # raw_records → fact_products
  etl_inventory.py     # raw_records → fact_inventory
  etl_stock_orders.py  # raw_records → fact_stock_orders + items
  etl_payments.py      # raw_records → fact_payments
```

每个 ETL 脚本：
1. 从 `raw_records` 读取 `entity_name=` 对应类型的未处理记录
2. 做字段清洗/单位转换
3. `INSERT ... ON CONFLICT (record_id) DO UPDATE` 幂等写入
4. 更新 `sync_state.cursor_value`

---

## API 认证（当前验证通过）

```
Header: token=<localStorage['user.token']>
        tenant-id=<localStorage['user.tenantId']>
        channel-id: 601
        tenancyCode: 25
        Content-Type: application/json;charset=UTF-8
```

### 各实体 API 路径（待验证）

| 实体 | API | 方法 |
|------|-----|------|
| 订单 | /apis/trade/backend/order/findPage | POST |
| 线上订单 | /apis/trade/backend/order/findPage (type=2?) | POST |
| 门店商品 | /apis/product/backend/product/item/list | POST |
| 库存 | /apis/stock/backend/stock/list | POST |
| 库存单据 | /apis/stock/backend/order/findPage | POST |
| 支付报表 | /apis/report/backend/payment/list | POST |
