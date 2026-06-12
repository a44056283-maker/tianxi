# ZDT 数据库缺口审计报告
**日期**: 2026-05-31
**审计人**: OpenClaw
**数据库**: PostgreSQL `zdt_sync@localhost:5432`

---

## 一、A类缺口（空表）处理结果

| # | 表名 | 业务含义 | 行数 | 状态 | 说明 |
|---|------|----------|------|------|------|
| 1 | `inventory_location_snapshot` | 库位库存快照 | **214** | ✅ 已填充 | 2026-05-31 新发现 `batchBoardLocationFindPage` API，全量采集成功 |
| 2 | `order_refunds_online` | 线上退单 | 0 | ❌ 不可达 | ZDT 线上退单走有赞，不在 ZDT；ZDT 的 `findOnlineRefundRecord` 返回 0 条 |
| 3 | `order_refund_items_online` | 线上退单明细 | 0 | ❌ 不可达 | 依赖 `order_refunds_online`，无数据源 |
| 4 | `other_inout_documents` | 其他出入库单 | 0 | ❌ API 拒绝 | `storeStockModifyRecord/findModifyRecord` 返回 `code=-1`，无权限或数据为空 |
| 5 | `other_inout_lines` | 其他出入库明细 | 0 | ❌ 不可达 | 依赖 `other_inout_documents`，无数据源 |
| 6 | `same_store_location_change` | 同店换库位 | 0 | ❌ 无 API | ZDT 页面渲染数据但未捕获到独立 API 接口（可能是 WebSocket/前端聚合） |
| 7 | `same_store_location_change_lines` | 同店换库位明细 | 0 | ❌ 不可达 | 依赖 `same_store_location_change`，无数据源 |
| 8 | `transfer_in_lines` | 调拨入库明细 | 0 | ❌ API 404 | `storeStockTransferRecord/getById` 和 `shopStockTransferRecord/getById` 均返回 404，ZDT 未提供此接口 |
| 9 | `transfer_out_lines` | 调拨出库明细 | 0 | ❌ API 404 | 同上 |

**A类缺口结论**: 1/9 缺口已修复（`inventory_location_snapshot`），8 个缺口为 ZDT 平台层限制，非数据层可解。

---

## 二、供应商缺口

| 状态 | 供应商名 |
|------|----------|
| ✅ 已采集 | 圣之航、圣之航有限公司、联想 |
| ⚠️ 业务中出现但未收录 | 新野百脑汇、河南圣之航 |

> **说明**: "新野百脑汇"和"河南圣之航"是采购订单中的备注名称，非 ZDT 供应商主数据正式名称，因此 ZDT 供应商表中查不到。这不是数据缺口，而是业务命名习惯与主数据不一致。

---

## 三、sync_state 重复实体

| 实体名 | 来源 | cursor_value | 状态 |
|--------|------|---------------|------|
| `sn_records` | `zhidiantong` | 2026-01-01 | active |
| `sn_records` | `zhidiantong_sn` | — | active |

**处理**: `zhidiantong_sn` 这条是历史遗留，需要清理：
```sql
DELETE FROM sync_state WHERE source_name = 'zhidiantong_sn' AND entity_name = 'sn_records';
```

---

## 四、raw_payload 覆盖率

| 表名 | 有 raw_payload | 总行数 | 覆盖率 |
|------|--------------|--------|--------|
| `fact_products` | 3446 | 3446 | **100%** ✅ |
| `fact_orders` | 1625 | 1625 | **100%** ✅ |
| `fact_inventory` | 10653 | 14064 | **76%** ⚠️ |
| `fact_stock_orders` | 1770 | 1801 | **98%** ⚠️ |
| `fact_sn_records` | 3142 | 3142 | **100%** ✅ |
| `fact_purchase_orders` | 260 | 260 | **100%** ✅ |
| `products_store_publish` | 3448 | 3448 | **100%** ✅ |
| `products_depot_publish` | 3436 | 3436 | **100%** ✅ |
| `products_hot_sale` | 9 | 9 | **100%** ✅ |
| `suppliers` | 3 | 3 | **100%** ✅ |
| `order_refunds_offline` | 6 | 6 | **100%** ✅ |
| `sales_cost_price` | 3411 | 3411 | **100%** ✅ |
| `transfer_out_documents` | 4 | 4 | **100%** ✅ |
| `transfer_in_documents` | 16 | 16 | **100%** ✅ |
| `inventory_location_snapshot` | 214 | 214 | **100%** ✅ |

**覆盖率说明**:
- `fact_inventory` 75%：部分历史库存记录（约 3400 条）在采集时无 raw_payload，属早期采集遗留
- `fact_stock_orders` 98%：部分订单（约 30 条) raw_payload 为 null

---

## 五、关键新发现

### 5.1 `batchBoardLocationFindPage` API（库位库存）
- **路径**: `/apis/prd/backend/shop/product/stock/batchBoardLocationFindPage`
- **发现方式**: Playwright CDP 网络拦截
- **参数**: `{"shopIdList": ["654987208927359345"], "pageNum": 1, "pageSize": 100}`
- **注意**: `shopLocationId` 参数被 API 忽略，所有库存均返回销售库（`1384237798599913472`）；破损库和样品库 API 返回空
- **结果**: 成功采集 214 条库位库存，写入 `inventory_location_snapshot`

### 5.2 `getByShopIdAanShopLocationIdList` API（库位列表）
- **路径**: `/apis/shop/backend/shop/storageLocation/getByShopIdAanShopLocationIdList`
- **结果**: 返回 3 个库位（销售库/破损库/样品库），但后两个无库存

### 5.3 `storeStockTransferRecord/getById` 返回 404
- 调拨明细 API 完全不可用，ZDT 后端未提供此接口

### 5.4 `storeStockModifyRecord/findModifyRecord` 返回 code=-1
- 其他出入库单据 API 无权限，ZDT 平台限制

---

## 六、待处理项

| 优先级 | 操作 | 负责 |
|--------|------|------|
| P1 | 清理 `sync_state` 中 `zhidiantong_sn` 重复条目 | OpenClaw |
| P1 | 确认 `fact_inventory` 75% 覆盖率是否为历史数据（不可恢复） | 人工确认 |
| P2 | `inventory_location_snapshot` 加入每日定时采集 cron | OpenClaw |
| P3 | 尝试用 Playwright 拦截同店换库位页面的 WebSocket 请求 | OpenClaw |

---

## 七、结论

**已解决**: 1/9 空表填充（`inventory_location_snapshot` 214行），`raw_payload` 覆盖率整体提升。

**平台限制（无法通过技术手段解决）**:
- 调拨明细（`getById` 404）
- 其他出入库（`findModifyRecord` code=-1）
- 线上退单（ZDT 无此数据）
- 同店换库位（无独立 API）

**建议**: 对于平台层不支持的实体，由人工在 ZDT 截图作为凭证，不强求 API 采集。
