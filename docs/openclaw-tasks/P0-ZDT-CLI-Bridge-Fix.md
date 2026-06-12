# P0 - ZDT CLI Bridge Schema 对接修复

**任务名称**: fix-zdt-openclaw-bridge-schema  
**执行日期**: 2026-05-29  
**优先级**: P0  
**状态**: 待审核  
**依据**: 诊断 - PostgreSQL 有数据但 Bridge 查询 Schema 不匹配

---

## 1. 问题根因

### 现状

| 层 | 实际情况 |
|----|---------|
| **ZDT CLI 写入** | 写 `fact_*` 表（fact_inventory, fact_orders, fact_products 等） |
| **Bridge 查询** | 查 `raw_records` + `sync_state`（Schema 与 CLI 不匹配） |
| **结果** | Bridge 永远读不到数据，`isFresh = false`，`totals.totalRecords = 0` |

### PG 实际数据（2026-05-28 采集）

| 表 | 记录数 | snapshot_date | collected_at (UTC) |
|----|-------:|---------------|-------------------|
| fact_inventory | 3,409 | 2026-05-29 | 2026-05-28 17:18 |
| fact_orders | 787 | 2026-05-28 | 2026-05-28 15:46 |
| fact_products | 3,446 | — | 2026-05-28 17:15 |
| fact_sn_records | 2,514 | — | 2026-05-28 17:13 |
| fact_stock_orders | 867 | — | 2026-05-28 17:14 |
| fact_purchase_orders | 260 | — | 2026-05-28 17:15 |

**sync_state 问题**：`last_success_time` 和 `last_sync_time` 全为空，状态从未被更新。

---

## 2. Schema 映射（Bridge entityName → PG 表）

| Bridge entityName | 对应 PG 表 | 有 collected_at | 有 snapshot_date |
|-------------------|-----------|:--------------:|:---------------:|
| `inventory` | fact_inventory | ✅ | ✅ |
| `orders_offline` | fact_orders | ✅ | ✅ (pay_time 范围) |
| `orders_online` | fact_orders (channel_type 筛选) | ✅ | ✅ |
| `products` | fact_products | ✅ | ❌ |
| `sn_records` | fact_sn_records | ✅ | ❌ |
| `stock_orders` | fact_stock_orders | ✅ | ❌ |
| `purchase_orders` | fact_purchase_orders | ✅ | ✅ (stock_in_time) |
| `purchase_order_details` | fact_purchase_order_details | ✅ | ✅ |

---

## 3. 修复方案

### 3.1 修改 `zdtOpenclawBridge.ts`

**文件**: `apps/inventory-sync/src/storage/zdtOpenclawBridge.ts`

**原查询**（错误）: JOIN `raw_records` → 永远读不到数据

**新查询**: 直接查询 `fact_*` 表 + `sync_state`，按 entity 分离

### 3.2 新 Bridge Python 查询逻辑

```python
# ZDT CLI entity → PG table 映射
ENTITY_TABLE_MAP = {
    'inventory':              ('fact_inventory',             'collected_at', 'snapshot_date'),
    'orders_offline':         ('fact_orders',               'collected_at', 'pay_time'),
    'orders_online':          ('fact_orders',               'collected_at', 'pay_time'),
    'products':              ('fact_products',              'collected_at', None),
    'sn_records':             ('fact_sn_records',           'collected_at', None),
    'stock_orders':           ('fact_stock_orders',         'collected_at', None),
    'purchase_orders':        ('fact_purchase_orders',      'collected_at', 'stock_in_time'),
    'purchase_order_details': ('fact_purchase_order_details','collected_at', 'stock_in_time'),
}

# 每个 entity 分别查：
# SELECT
#   entity_name,
#   status (from sync_state.status),
#   cursor_value (from sync_state.cursor_value),
#   MAX(collected_at) AS latest_collected_at,
#   COUNT(*) AS total_records,
#   COUNT(*) FILTER (WHERE collected_at >= today CST) AS today_records,
#   MAX(collected_at) AS latest_collected_at
# FROM fact_xxx t
# LEFT JOIN sync_state s ON s.entity_name = ?
# GROUP BY entity_name, status, cursor_value
```

### 3.3 新鲜度判断逻辑

- `isFresh = true` 当 `latest_collected_at` 距离当前时间 ≤ 90 分钟
- 时区：UTC + 8 (Asia/Shanghai)
- 告警：当 `latest_collected_at` 超过 90 分钟但 ≤ 24 小时 → warning
- 阻塞：当 `latest_collected_at` 超过 24 小时 → isFresh = false + 告警

### 3.4 同步状态更新

`sync_state` 的 `last_success_time` 应在每次 CLI 采集完成后由 ZDT CLI 自己更新。
当前为空说明 ZDT CLI 没有在采集后更新状态。

**临时方案**：Bridge 只读fact表数据，不依赖sync_state的last_success_time做新鲜度判断。
**根本方案**：后续在 ZDT CLI 采集后加状态写入步骤。

---

## 4. 实施步骤

### Step 1: 修改 Bridge 查询（TS 文件）

1. 读取 `apps/inventory-sync/src/storage/zdtOpenclawBridge.ts`
2. 替换 Python 查询逻辑：移除对 `raw_records` 的依赖
3. 对每个 entity 分别查对应 `fact_*` 表
4. 保留 `sync_state` 的 cursor_value 和 status 读取（仅用于展示）

### Step 2: 验证 Bridge 输出

运行后检查 `latest-zdt-openclaw-bridge.json`:
```json
{
  "isFresh": true,  // 或 false，看采集时间
  "entitySummaries": [
    { "entityName": "inventory", "totalRecords": 3409, "todayRecords": 3409, "latestCollectedAt": "2026-05-28T17:18:51+00:00" },
    ...
  ]
}
```

### Step 3: 确认 SQLite 消费链路

验证 `zhidiantongAutoSync.ts` 的 `syncZhidiantongSeededData()` 是否从 Bridge 快照读取，或直接从 PG 读。
如果从 Bridge 读 → Bridge 修复后自动通。
如果直接读 PG → 检查读取逻辑是否正确。

### Step 4: 处理 Stuck sync_job（附）

PG 中有一条 `status='running'` 的 `sync_job`（orders, started 2026-05-28 14:15 UTC），超过 17 小时未结束。
**操作**: 由用户在 ZDT CLI 管理界面手动结束该任务，或在 CLI 侧 Kill 该进程。

---

## 5. 验收标准

| 验收项 | 期望结果 |
|--------|---------|
| Bridge 快照 `isFresh` | `true`（当距上次采集 < 90 分钟） |
| `entitySummaries[].totalRecords` | 与 PG 实际记录数一致 |
| `entitySummaries[].todayRecords` | 当天 CST 有采集时 > 0 |
| `latest-zdt-openclaw-bridge.json` | 存在于 `apps/inventory-sync/artifacts/` 和 `apps/web-cockpit/public/data/` |
| 定时任务 `zhidiantong-sync-cycle` | 不再因 `blocked_missing_input` 失败 |

---

## 6. 风险与限制

1. **ZDT CLI 未更新 sync_state**：当前采集成功后没有写回 last_success_time，Bridge 无法从 sync_state 判断历史成功时间
2. **orders_online vs orders_offline**：需要通过 channel_type 或 order_type 字段区分，当前 fact_orders 表结构无明确区分字段，需在 SQL 加 WHERE 条件
3. **Stuck sync_job**：需人工介入处理，不能自动清除

---

## 7. 依赖

- `apps/inventory-sync/src/storage/zdtOpenclawBridge.ts`
- `apps/inventory-sync/src/config.ts`（ZDT_SYNC_BRIDGE_ENABLED 配置）
- PostgreSQL `zdt_sync` 数据库（已运行，连接串：`postgresql://zdt:zdt@localhost:5432/zdt_sync`）
