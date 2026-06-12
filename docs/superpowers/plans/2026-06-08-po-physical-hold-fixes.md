# PO / 教育补实物仓 三轮修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉当前 PO 实物仓的三个核心 bug：库存累加双计、6 个动作不联动 sku.current_stock、实物仓台账标题与终端不一致。修完前端 5174 实物仓台账的数字、标题、状态机全部对得上 SQL 真值。

**Architecture:**
- 数据真值锚定在 `apps/api-server/data/retail-core.sqlite3`，不在前端 JSON 快照
- 修复集中在 `apps/api-server/app/retail_core.py`
- 验证走 `scripts/audit_physical_hold_accumulation.py`（新增，对齐 `audit_terminal_*` 系列）
- 标题链统一用 `published_projection.displayTitle` 作主键

**Tech Stack:**
- Python 3.11+ / FastAPI / SQLite
- uv workspace
- 验证脚本：纯 stdlib + sqlite3（与现有 audit 脚本一致）

---

## 当前真值基线（写计划时实测）

```text
sku.current_stock 总和                                  = 392
serial_item.status='in_stock' 总和                       = 392   (已相等)
physical_stock_hold.active 总数                          = 19
build_standard_inventory_snapshot 的 effective_current  = 411   (虚高 19)
retail_core 6 个动作都不动 sku.current_stock             (transfer/release/finalize/revoke/reopen/rebind)
实物仓 active 中 stock_count_excess                      = 7
实物仓台账 productName = sku.name 旧代码串                (例: "Legion Y7000P IRX10I9-14900HX ...")
零售价区 / ad-machine productName = projection.displayTitle (例: "联想拯救者Y7000P 2025 ...")
```

---

## Round 1: 累加口径修复（治标 + 治本同步收口）

**Files:**
- Modify: `apps/api-server/app/retail_core.py:7317-7400`
- Modify: `apps/api-server/app/retail_core.py:9112-9550`（6 个动作函数）
- New: `scripts/audit_physical_hold_accumulation.py`

### Task 1.1: 写验证脚本

- [ ] **Step 1: 写 `scripts/audit_physical_hold_accumulation.py`**

验证 4 件事（每件都用 `uv run python` 跑得通）：
1. `effective_current_stock == sku.current_stock`（不再 + hold）
2. `transfer` 后 `sku.current_stock` 减 1
3. `release` 后 `sku.current_stock` 加 1
4. `active hold` 中无 `stock_count_excess`

- [ ] **Step 2: 跑脚本看 baseline FAIL**

```bash
cd apps/api-server && uv run python ../scripts/audit_physical_hold_accumulation.py
```

预期 baseline：
- `effective_current_stock = 411 vs sum(sku.current_stock) = 392 → MISMATCH (+19)`
- 7 条 `stock_count_excess in active hold`
- 4/4 FAIL

### Task 1.2: 修 `build_standard_inventory_snapshot_from_sql`

- [ ] **Step 3: 改累加公式**

`apps/api-server/app/retail_core.py:7332`：

```python
# 旧（双计）
effective_current_stock = current_stock + hold_stock
effective_sellable_stock = sellable_stock + hold_stock

# 新（保留物理仓单独维度，currentStock 不再双计）
effective_current_stock = current_stock
effective_sellable_stock = sellable_stock
# hold 仍走 physicalHoldStock 字段独立显示
```

- [ ] **Step 4: 跑验证脚本**

```bash
cd apps/api-server && uv run python ../scripts/audit_physical_hold_accumulation.py
```

预期：第 1 条 PASS（effective_current_stock = 392 不再虚高）

### Task 1.3: 修 6 个动作同步 sku.current_stock

- [ ] **Step 5: 改 `transfer_sales_order_serials_to_physical_hold`**

在 `conn.execute(INSERT ...)` 之后加：

```python
conn.execute(
    "UPDATE sku SET current_stock = MAX(0, current_stock - 1), sellable_stock = MAX(0, sellable_stock - 1), updated_at = ? WHERE sku_key = ?",
    (timestamp, item["sku_key"] or str(serial_row["sku_key"] or "").strip()),
)
```

- [ ] **Step 6: 改 `release_physical_hold_to_store`**

serial_item 改回 STORE 之后加：

```python
conn.execute(
    "UPDATE sku SET current_stock = current_stock + 1, sellable_stock = sellable_stock + 1, updated_at = ? WHERE sku_key = ?",
    (timestamp, str(serial_row["sku_key"] or "").strip()),
)
```

只对 `hold_status='active'` 的 hold 释放。

- [ ] **Step 7: 改 `revoke_physical_hold_transfer`**

serial_item 改回 `sold` 时不动 sku.current_stock（已售本来就不在 current_stock 内）。

- [ ] **Step 8: 改 `reopen_consumed_physical_hold`**

serial_item 改回 `in_stock, PO_HOLD` 时：

```python
conn.execute(
    "UPDATE sku SET current_stock = MAX(0, current_stock - 1), updated_at = ? WHERE sku_key = ?",
    (timestamp, str(serial_row["sku_key"] or "").strip()),
)
```

- [ ] **Step 9: 跑验证脚本**

```bash
cd apps/api-server && uv run python ../scripts/audit_physical_hold_accumulation.py
```

预期：4/4 PASS

---

## Round 2: 重建 inventory snapshot 让 JSON 快照对得上 SQL 真值

- [ ] **Step 1: 写重建脚本（先 dry-run 看 diff）**

```bash
cd apps/api-server && uv run python ../scripts/rebuild_physical_hold_snapshots.py --dry-run
```

- [ ] **Step 2: 真实重建**

```bash
cd apps/api-server && uv run python ../scripts/rebuild_physical_hold_snapshots.py
```

- [ ] **Step 3: API 端验证**

```bash
cd apps/api-server && uv run fastapi dev app/main.py --host 127.0.0.1 --port 8000 &
sleep 3
curl -s http://127.0.0.1:8000/api/retail-core/inventory-snapshot | python3 -c "import json,sys; d=json.load(sys.stdin); print('totals.currentStock:', d['totals']['currentStock']); print('totals.physicalHoldStock:', d['totals']['physicalHoldStock']); print('期望 392 / 19')"
```

---

## Round 3: 标题链统一

- [ ] **Step 1: 写 `scripts/audit_physical_hold_title_chain.py`**

验证：实物仓 active hold 中所有 SKU 的 `serial_item.product_name` 与 `published_projection.displayTitle` 一致。

- [ ] **Step 2: 改 `list_physical_stock_holds`**

在 `serial_item.product_name` 计算时，优先用 `published_projection.displayTitle`。

- [ ] **Step 3: 改 `build_standard_inventory_snapshot_from_sql`**

SKU productName 字段也走 `displayTitle or sku.name or product.name`。

- [ ] **Step 4: 重建 + 验证**

```bash
cd apps/api-server && uv run python ../scripts/audit_physical_hold_title_chain.py
```

---

## Round 4: 重建 + 全量验证

- [ ] **Step 1: 跑 inventory-snapshot 重跑**

```bash
cd apps/inventory-sync && npm run build:snapshot
```

- [ ] **Step 2: 跑 priceEngine / retail zone 重建**

```bash
cd apps/inventory-sync && npm run build:retail-zone
```

- [ ] **Step 3: 前端 build**

```bash
cd apps/web-cockpit && pnpm build
```

- [ ] **Step 4: 启动 dev server 实地验证**

```bash
cd apps/api-server && uv run fastapi dev app/main.py --host 127.0.0.1 --port 8000 &
cd apps/web-cockpit && pnpm dev --host 127.0.0.1 &
```

---

## Round 5: 更新长期记忆

- [ ] **Step 1: 更新 `docs/ai-context/01_CURRENT_STATE.md`**

记录 effective_current_stock 公式已改、6 个动作同步 sku.current_stock、7 条 stock_count_excess 已清。

- [ ] **Step 2: 更新 `docs/ai-context/04_NEXT_ACTIONS.md`**

- [ ] **Step 3: 跑 context_pack**

```bash
bash scripts/context_pack.sh
python3 scripts/context_snapshot.py
```

---

## 验收标准

| 轮次 | 验收命令 | 期望 |
|---|---|---|
| Round 1 | `python3 scripts/audit_physical_hold_accumulation.py` | 4/4 PASS |
| Round 2 | `curl /api/retail-core/inventory-snapshot` | currentStock=392, physicalHoldStock=19 |
| Round 3 | `python3 scripts/audit_physical_hold_title_chain.py` | 4/4 SKU 标题对得上 |
| Round 4 | `pnpm build` | 通过 |
| Round 5 | context_pack 跑通 | 长期记忆更新 |
