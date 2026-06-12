# OpenClaw ZDT 采集整改执行清单

更新时间：2026-05-31  
执行对象：OpenClaw 智店通采集 CLI / 定时任务 / PostgreSQL 数据层  
配套审计文档：`docs/openclaw-tasks/ZDT商品订单库存全量采集审计与对接方案_2026-05-31.md`

---

## 1. 任务目标

本次整改的目标不是“再多采一点数据”，而是一次性把 OpenClaw 的智店通采集链改成可被智慧零售系统稳定消费的 SQL 主链。

必须同时满足：

1. 按 `商品 / 订单 / 库存` 三大类完整采集智店通数据。
2. 所有采集结果先落 PostgreSQL 结构化表，不再依赖 JSON 主链。
3. 字段命名、实体命名、时间字段、单头单行关系，全部兼容智慧零售系统当前进销存消费链。
4. 采集后能被零售系统自动同步：
   - `ZDT PostgreSQL`
   - `retail-core.sqlite3`
   - `API`
   - `前端`

---

## 2. 硬规则与边界

## 2.1 必须遵守

1. 所有真实数据先落 SQL，不允许以 JSON 快照作为事实主链。
2. 所有页面采集必须保留 `raw_payload` 或等价原始回执留痕。
3. 所有实体必须有稳定主键或去重键。
4. 所有时间字段必须保留到秒，禁止只留日期。
5. 订单、库存、SN、退单、调拨、入库、其他出入库必须拆成结构化实体。
6. `sync_state` 与 `sync_job` 必须能真实表达每个实体的采集状态。
7. 采集完成不等于对接完成；只有 SQL 可被零售系统消费，才算收口。

## 2.2 禁止事项

1. 禁止把多个业务实体继续混塞进现有几张 `fact_*` 表里。
2. 禁止把退单、发布态、库位库存、热卖排序这类页面信息只放进 `raw_payload` 不出结构化字段。
3. 禁止继续混用 `order / orders / stock_order / stock_orders / zhidiantong_sn` 这类不统一命名。
4. 禁止只做“桥接摘要”而不补实体表。
5. 禁止把旧 JSON 或旧缓存重放伪装成当天实时采集。

---

## 3. 当前必须整改的核心问题

## 3.1 商品类问题

当前缺失：

1. 门店商品发布态
2. 仓库商品发布态
3. 收银热卖商品
4. 供应商主数据
5. `69码`
6. `PN/MTM`
7. 税率分类 / 税率

## 3.2 订单类问题

当前缺失：

1. 线下退单头表 / 明细表
2. 线上退单头表 / 明细表
3. OMS 订单号
4. 渠道订单号
5. OMS 订单状态
6. 退款单号 / 退款单类型 / 申请退款金额 / 是否退货 / 申请人 / 申请数量

## 3.3 库存类问题

当前缺失：

1. 库位库存快照
2. 库存总览快照
3. 销售成本价结构化事实
4. 调拨出库单头 / 单行
5. 调拨入库单头 / 单行
6. 其他出入库单头 / 单行
7. 同店换库位单头 / 单行
8. `fact_stock_order_items` 行级明细

---

## 4. 统一实体命名

后续 OpenClaw 与零售系统对接统一使用下列实体名：

- `products_master`
- `products_store_publish`
- `products_depot_publish`
- `products_hot_sale`
- `suppliers`
- `orders_offline`
- `order_items_offline`
- `orders_online`
- `order_items_online`
- `order_refunds_offline`
- `order_refund_items_offline`
- `order_refunds_online`
- `order_refund_items_online`
- `inventory_snapshot`
- `inventory_location_snapshot`
- `inventory_overview_snapshot`
- `stock_stream`
- `stock_orders`
- `stock_order_items`
- `sn_records`
- `sales_cost_price`
- `transfer_out_documents`
- `transfer_out_lines`
- `transfer_in_documents`
- `transfer_in_lines`
- `purchase_orders`
- `purchase_order_details`
- `other_inout_documents`
- `other_inout_lines`
- `same_store_location_change`
- `same_store_location_change_lines`

禁止再使用：

- `order`
- `orders`
- `stock_order`
- `zhidiantong_sn`

---

## 5. 目标表整改清单

## 5.1 商品类

必须新增或重构：

1. `products_master`
2. `products_store_publish`
3. `products_depot_publish`
4. `products_hot_sale`
5. `suppliers`

最低结构化字段要求：

- 商品主数据：
  - `product_no`
  - `product_name`
  - `category_id`
  - `category_name`
  - `product_source`
  - `product_type`
  - `status`
  - `status_name`
  - `pn_mtm`
  - `ean_69_code`
  - `tax_category`
  - `tax_rate`
  - `image_url`
  - `created_time`
  - `updated_time`
  - `source_name`
  - `raw_payload`

- 发布态：
  - `shop_id / shop_no / shop_name`
  - `warehouse_location_id / warehouse_location_name`
  - `product_no`
  - `sku_no`
  - `pn_mtm`
  - `status`
  - `status_name`
  - `sale_channel`
  - `updated_time`
  - `raw_payload`

- 热卖商品：
  - `shop_id`
  - `product_no`
  - `sku_no`
  - `pn_mtm`
  - `sort_index`
  - `is_combo`
  - `is_on_shelf`
  - `collected_at`
  - `raw_payload`

- 供应商：
  - `supplier_id`
  - `supplier_name`
  - `status`
  - `status_name`
  - `company_id`
  - `company_name`
  - `created_time`
  - `updated_time`
  - `raw_payload`

## 5.2 订单类

必须新增或重构：

1. `orders_offline`
2. `order_items_offline`
3. `orders_online`
4. `order_items_online`
5. `order_refunds_offline`
6. `order_refund_items_offline`
7. `order_refunds_online`
8. `order_refund_items_online`

最低结构化字段要求：

- 订单头：
  - `order_id`
  - `order_no`
  - `outer_order_no`
  - `oms_order_no`
  - `channel_order_no`
  - `status`
  - `status_name`
  - `oms_status`
  - `order_type`
  - `order_type_name`
  - `channel_type_name`
  - `delivery_type_name`
  - `pay_way_name`
  - `total_amount`
  - `pay_amount`
  - `actual_refund_amount`
  - `total_quantity`
  - `buyer_phone`
  - `receiver_name`
  - `receiver_phone`
  - `receiver_address`
  - `shop_id`
  - `shop_name`
  - `cashier_id`
  - `cashier_name`
  - `created_time`
  - `pay_time`
  - `delivery_time`
  - `collected_at`
  - `raw_payload`

- 订单行：
  - `id`
  - `order_id`
  - `order_no`
  - `product_no`
  - `product_name`
  - `sku_no`
  - `barcode`
  - `mtm_code`
  - `spec`
  - `quantity`
  - `unit`
  - `unit_price`
  - `total_amount`
  - `pay_amount`
  - `discount_amount`
  - `serial_number`
  - `serial_numbers_json`
  - `ean_69_code`
  - `raw_payload`

- 退单头：
  - `refund_id`
  - `refund_no`
  - `order_no`
  - `refund_type`
  - `refund_type_name`
  - `status`
  - `status_name`
  - `apply_user_name`
  - `apply_time`
  - `refund_amount`
  - `refund_quantity`
  - `is_return_goods`
  - `channel_type_name`
  - `shop_id`
  - `shop_name`
  - `raw_payload`

- 退单行：
  - `id`
  - `refund_id`
  - `refund_no`
  - `order_no`
  - `product_no`
  - `product_name`
  - `sku_no`
  - `mtm_code`
  - `spec`
  - `quantity`
  - `refund_amount`
  - `serial_number`
  - `serial_numbers_json`
  - `raw_payload`

## 5.3 库存类

必须新增或重构：

1. `inventory_snapshot`
2. `inventory_location_snapshot`
3. `inventory_overview_snapshot`
4. `stock_stream`
5. `stock_orders`
6. `stock_order_items`
7. `sn_records`
8. `sales_cost_price`
9. `transfer_out_documents`
10. `transfer_out_lines`
11. `transfer_in_documents`
12. `transfer_in_lines`
13. `purchase_orders`
14. `purchase_order_details`
15. `other_inout_documents`
16. `other_inout_lines`
17. `same_store_location_change`
18. `same_store_location_change_lines`

最低结构化字段要求：

- 商品库存快照：
  - `snapshot_date`
  - `shop_id / shop_no / shop_name`
  - `spu_no`
  - `sku_no`
  - `sku_name`
  - `mtm_code`
  - `category_id / category_name`
  - `current_stock`
  - `available_sale_stock`
  - `booked_stock`
  - `current_wait_stock`
  - `transfer_stock`
  - `pending_stock`
  - `unsellable_stock`
  - `remainder_stock`
  - `alarm_stock`
  - `cost_price`
  - `agency_price`
  - `sales_cost_price`
  - `manage_sn`
  - `stock_type`
  - `raw_payload`

- 库位库存：
  - `snapshot_date`
  - `shop_id / shop_no / shop_name`
  - `warehouse_location_id / warehouse_location_name`
  - `product_no`
  - `product_name`
  - `sku_no`
  - `pn_mtm`
  - `spec`
  - `sales_property`
  - `total_stock`
  - `current_stock`
  - `booked_stock`
  - `wait_stock`
  - `raw_payload`

- 库存流水：
  - `stream_id`
  - `business_no`
  - `document_type`
  - `document_type_name`
  - `operate_type_name`
  - `business_date`
  - `business_time`
  - `company_id / company_name`
  - `shop_no / shop_name`
  - `warehouse_location_id / warehouse_location_name`
  - `product_no`
  - `product_name`
  - `sku_no`
  - `pn_mtm`
  - `spec`
  - `sales_property`
  - `quantity`
  - `after_stock`
  - `operator_name`
  - `pay_remark`
  - `raw_payload`

- 库存订单头：
  - `service_no`
  - `service_type_name`
  - `operate_type_name`
  - `company_id / company_name`
  - `shop_no / shop_name`
  - `warehouse_location_id / warehouse_location_name`
  - `user_name`
  - `pay_date`
  - `pay_time`
  - `pay_remark`
  - `supplier_name`
  - `raw_payload`

- 库存订单行：
  - `id`
  - `service_no`
  - `service_type_name`
  - `spu_no`
  - `product_name`
  - `sku_no`
  - `pn_mtm`
  - `spec`
  - `property_name`
  - `property_value`
  - `unit`
  - `quantity`
  - `operate_type_name`
  - `user_name`
  - `pay_date`
  - `pay_time`
  - `pay_remark`
  - `supplier_name`
  - `raw_payload`

- SN 订单：
  - `serial_number`
  - `service_no`
  - `service_type_name`
  - `operate_type_name`
  - `product_name`
  - `spu_no`
  - `sku_no`
  - `pn_mtm`
  - `spec`
  - `sales_property`
  - `shop_no / shop_name`
  - `warehouse_location_id / warehouse_location_name`
  - `user_name`
  - `pay_time`
  - `pay_remark`
  - `raw_payload`

- 出入库单据头：
  - `document_no`
  - `document_type`
  - `document_type_name`
  - `status`
  - `status_name`
  - `company_id / company_name`
  - `shop_no / shop_name`
  - `from_shop_no / from_shop_name`
  - `to_shop_no / to_shop_name`
  - `warehouse_location_id / warehouse_location_name`
  - `supplier_name`
  - `operator_name`
  - `created_time`
  - `business_time`
  - `remark`
  - `raw_payload`

- 出入库单据行：
  - `line_id`
  - `document_no`
  - `product_no`
  - `product_name`
  - `sku_no`
  - `pn_mtm`
  - `spec`
  - `sales_property`
  - `quantity`
  - `unit`
  - `cost_price`
  - `batch_cost_price`
  - `serial_numbers_json`
  - `raw_payload`

---

## 6. 按页面的采集整改步骤

## 6.1 商品链

### 步骤 1：经销商商品

目标：

- 作为 `products_master` 主数据来源

必须采集：

- 商品基础字段
- `69码`
- `PN/MTM`
- 税率分类 / 税率
- 状态
- 更新时间

### 步骤 2：门店商品

目标：

- 生成 `products_store_publish`

必须采集：

- 门店作用域
- 商品发布状态
- 销售渠道
- 更新时间

### 步骤 3：仓库商品

目标：

- 生成 `products_depot_publish`

### 步骤 4：收银热卖商品

目标：

- 生成 `products_hot_sale`

必须采集：

- 排序
- 是否组合商品
- 是否上架

### 步骤 5：供应商管理

目标：

- 生成 `suppliers`

---

## 6.2 订单链

### 步骤 1：线下门店订单

目标：

- 生成 `orders_offline + order_items_offline`

### 步骤 2：线下门店退单

目标：

- 生成 `order_refunds_offline + order_refund_items_offline`

### 步骤 3：线上订单

目标：

- 生成 `orders_online + order_items_online`

### 步骤 4：线上退单

目标：

- 生成 `order_refunds_online + order_refund_items_online`

规则：

1. 先采列表单头
2. 再补明细
3. 再补支付/退款扩展字段
4. 最后写 `sync_state` 和 `sync_job`

---

## 6.3 库存链

### 步骤 1：商品库存

目标：

- 生成 `inventory_snapshot`

### 步骤 2：库位库存

目标：

- 生成 `inventory_location_snapshot`

### 步骤 3：库存总览

目标：

- 生成 `inventory_overview_snapshot`

### 步骤 4：库存流水

目标：

- 生成 `stock_stream`

### 步骤 5：库存订单

目标：

- 生成 `stock_orders + stock_order_items`

### 步骤 6：SN 库存订单

目标：

- 生成 `sn_records`

### 步骤 7：销售成本价维护

目标：

- 生成 `sales_cost_price`

### 步骤 8：商品入库

目标：

- 生成 `purchase_orders + purchase_order_details`

### 步骤 9：调拨出库 / 调拨入库

目标：

- 生成 `transfer_out_documents / transfer_out_lines`
- 生成 `transfer_in_documents / transfer_in_lines`

### 步骤 10：其他出入库

目标：

- 生成 `other_inout_documents / other_inout_lines`

### 步骤 11：同店换库位

目标：

- 生成 `same_store_location_change / same_store_location_change_lines`

---

## 7. 定时任务执行顺序

## 7.1 每 30 分钟执行

### 商品轻量更新

1. 门店商品
2. 仓库商品
3. 收银热卖商品
4. 供应商管理

### 订单更新

1. 线下门店订单
2. 线下门店退单
3. 线上订单
4. 线上退单

### 库存更新

1. 商品库存
2. 库位库存
3. 库存流水
4. 库存订单
5. SN库存订单
6. 商品入库
7. 其他出入库
8. 调拨出库
9. 调拨入库
10. 同店换库位

## 7.2 每天 2 次执行

1. 经销商商品全量
2. 库存总览
3. 销售成本价维护

---

## 8. SQL 同步状态规则

每个实体采集任务必须同步维护：

## 8.1 `sync_state`

至少包含：

- `entity_name`
- `status`
- `cursor`
- `last_success_time`
- `last_error`
- `total_records`
- `today_records`
- `latest_collected_at`

## 8.2 `sync_job`

每次任务必须写：

- `job_name`
- `entity_name`
- `started_at`
- `finished_at`
- `status`
- `inserted_count`
- `updated_count`
- `skipped_count`
- `error_count`
- `error_summary`

状态口径统一：

- `success`
- `partial_success`
- `failed`
- `blocked_missing_input`
- `blocked_page_risk`

---

## 9. 与智慧零售系统的对接要求

OpenClaw 改完之后，不是只停在自身数据库层，还必须保证能被我们系统自动消费。

## 9.1 商品同步

ZDT SQL -> 零售系统：

- `products_master`
- `products_store_publish`
- `products_depot_publish`
- `products_hot_sale`
- `suppliers`

零售系统落点：

- `product`
- `sku`
- `supplier`
- 商品发布态投影
- 收银商品投影

## 9.2 订单同步

ZDT SQL -> 零售系统：

- `orders_offline / order_items_offline`
- `orders_online / order_items_online`
- `order_refunds_offline / order_refund_items_offline`
- `order_refunds_online / order_refund_items_online`

零售系统落点：

- `sales_order`
- `sales_order_line`
- `customer`
- `order_sync_registry`
- `sync_gap_queue`

## 9.3 库存同步

ZDT SQL -> 零售系统：

- `inventory_snapshot`
- `inventory_location_snapshot`
- `stock_stream`
- `stock_orders`
- `stock_order_items`
- `sn_records`
- `purchase_orders`
- `purchase_order_details`
- `sales_cost_price`
- `transfer_*`
- `other_inout_*`
- `same_store_location_change_*`

零售系统落点：

- `inventory_movement`
- `serial_item`
- `inventory_snapshot`
- `inventory_location_snapshot`
- 供应商关联
- 前端出入库详情

---

## 10. 自动同步闭环要求

必须实现：

1. OpenClaw 写入 ZDT PostgreSQL
2. 零售系统检测到新 `collected_at`
3. 自动执行本地同步
4. 自动更新 SQLite
5. API 立即可读
6. 前端自动刷新

闭环标准：

- 商品更新后，商品库与收银投影同步变化
- 订单更新后，销售出库/退单页同步变化
- 库存更新后，库存、可售、SN、供应商、单据详情同步变化

---

## 11. 验收标准

必须全部满足，才算 OpenClaw 整改完成：

## 11.1 数据层

1. 文档中列出的 P0 / P1 目标实体全部存在
2. 每张表有结构化字段，不只剩 `raw_payload`
3. `fact_stock_order_items` 不再为空
4. `sync_state.entity_name` 全部按统一命名
5. `sync_job` 可审计

## 11.2 业务层

1. 销售订单、退单、库存、SN、采购入库、调拨、其他出入库、同店换库位都能在 SQL 查到
2. 供应商能通过入库单和 SN 反推
3. 已出库 SN 不再错误停留在在库
4. 订单按业务时间排序，不按同步时间排序

## 11.3 对接层

1. 零售系统能自动消费新增实体
2. 前端不再依赖旧 JSON 主链
3. ZDT SQL 有新数据后，前端可自动更新

---

## 12. 推荐执行顺序

## P0

1. 统一 `entity_name`
2. 补 `products_store_publish`
3. 补 `products_depot_publish`
4. 补 `products_hot_sale`
5. 补 `suppliers`
6. 补 `order_refunds_offline`
7. 补 `order_refunds_online`
8. 补 `stock_order_items`

## P1

1. 补 `inventory_location_snapshot`
2. 补 `inventory_overview_snapshot`
3. 补 `sales_cost_price`
4. 补 `transfer_out_*`
5. 补 `transfer_in_*`
6. 补 `other_inout_*`
7. 补 `same_store_location_change_*`

## P2

1. 提供给零售系统稳定的查询视图或接口
2. 联调本地 SQLite 同步
3. 联调前端自动刷新

---

## 13. 交付物要求

OpenClaw 完成整改后，必须同步给出：

1. 新增/修改的表结构说明
2. 新增/修改的采集脚本清单
3. 每个实体的去重键
4. 每个实体的游标推进规则
5. 一次全量采集结果截图或 SQL 统计
6. 一次增量采集结果截图或 SQL 统计
7. 与零售系统联调所需的查询口径说明

---

## 14. 最终要求

这次整改不是补几个字段，而是把 OpenClaw 从“能采一点智店通数据”升级成“智慧零售系统可用的 ZDT SQL 主链”。

最终必须达到：

- 智店通真实数据 -> OpenClaw SQL
- OpenClaw SQL -> 零售系统 SQLite
- SQLite -> API
- API -> 前端自动同步

如果只完成前两步，不算完成。  
如果还依赖 JSON 主链，不算完成。  
如果实体不齐、字段不齐、退单和库位还缺，不算完成。
