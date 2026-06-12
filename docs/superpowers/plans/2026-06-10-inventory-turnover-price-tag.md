# Plan: 进销存含电子价签 (Inventory Turnover + Price Tag Sync)

**Date:** 2026-06-10
**Agent:** inventory2-agent (S6)
**Status:** Planned

## Goals

### Goal 1: 进销存闭环报表 — `GET /api/inventory/turnover-report`

**Query params:** `startDate` (YYYY-MM-DD), `endDate` (YYYY-MM-DD), `category?` (optional filter)

**Response schema:**
```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-06-10",
  "openingStock": 150,
  "purchases": 320,
  "sales": 280,
  "adjustments": -10,
  "closingStock": 180,
  "turnoverRate": 1.87,
  "daysOfSupply": 19.6,
  "byCategory": [
    { "category": "游戏笔记本", "openingStock": 50, "purchases": 80, "sales": 70, "adjustments": -5, "closingStock": 55 }
  ]
}
```

**Implementation:**
- New file: `apps/api-server/app/inventory_turnover_api.py`
- Query `inventory_movement` table grouped by movement_type:
  - `purchase_inbound` → purchases
  - `sales_outbound` → sales (negative)
  - `manual_adjustment` → adjustments
  - `transfer_inbound` / `transfer_outbound` → net transfer
- Compute `openingStock` = sum of movements before `startDate`
- `closingStock` = `openingStock + purchases + sales + adjustments`
- `turnoverRate` = `sales / ((openingStock + closingStock) / 2)` (or avg stock)
- `daysOfSupply` = `avgStock / (sales / daysInPeriod)`

**TDD approach:**
- Write test in `apps/api-server/tests/` first
- Test via `pytest apps/api-server/tests/test_inventory_turnover_api.py -v`

---

### Goal 2: 电子价签同步队列

**Table:** `price_tag_update_task` (already exists)

**Worker:** `apps/inventory-sync/src/price-tag-worker.ts`
- Runs every 30 seconds
- Polls `SELECT * FROM price_tag_update_task WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`
- For each task:
  1. Update status to `sending`
  2. POST to mock gateway: `http://127.0.0.1:8080/api/price-tag/sync` (timeout 5s)
  3. On success → status = `confirmed`
  4. On failure → retry_count++, status = `pending` (if retry < 3) or `failed`
- Mock gateway endpoint: simple Express server on 8080 or in-process mock

**Auto-create tasks:**
- When retail price updates in `retail-zone` snapshot → create task
- `apps/api-server/app/price_tag_sync.py` — exposes:
  - `POST /api/price-tag/tasks` — manual trigger
  - `GET /api/price-tag/tasks` — list tasks with filter
  - `GET /api/price-tag/tasks/{id}` — task detail
  - Worker loop in background thread

---

### Goal 3: 价签-库存关联视图 — `GET /api/inventory/store-display`

**Response schema:**
```json
{
  "storeCode": "LENOVO-SR-001",
  "asOf": "2026-06-10T12:00:00+08:00",
  "items": [
    {
      "skuKey": "20006725",
      "productName": "联想拯救者Y7000...",
      "category": "游戏笔记本",
      "currentStock": 26,
      "storeRetailPrice": 11599.0,
      "priceTagStatus": "confirmed",
      "lastPriceTagUpdate": "2026-06-09T10:00:00+08:00",
      "lastSaleAt": "2026-06-09T15:30:00+08:00"
    }
  ],
  "summary": {
    "totalSkus": 120,
    "pendingPriceTags": 3,
    "failedPriceTags": 1,
    "lowStockSkus": 5
  }
}
```

**Implementation:**
- New file: `apps/api-server/app/store_display_api.py`
- Data sources:
  - Stock: `sku` table (current_stock, sellable_stock)
  - Retail price: `latest-published-product-projection-live.json` snapshot
  - Price tag status: `price_tag_update_task` latest record per sku
  - Last sale: `sales_order` + `sales_order_line` MAX(pay_time)

---

## File Structure

```
apps/api-server/app/
  inventory_turnover_api.py    # NEW
  price_tag_sync.py            # NEW
  store_display_api.py         # NEW
  main.py                      # MODIFY: register routers

apps/api-server/migrations/
  2026-06-10-price-tag-task.sql   # NEW (table already exists, ensure indexes)

apps/api-server/tests/
  test_inventory_turnover_api.py  # NEW
  test_price_tag_sync.py           # NEW
  test_store_display_api.py        # NEW

apps/inventory-sync/src/
  price-tag-worker.ts           # NEW

apps/web-cockpit/src/components/
  TurnoverReport.tsx           # NEW
  PriceTagManager.tsx          # NEW
  StoreDisplay.tsx             # NEW

docs/superpowers/plans/
  2026-06-10-inventory-turnover-price-tag.md  # THIS FILE
```

---

## Test Strategy

- **Backend:** pytest (FastAPI TestClient)
- **Frontend:** vitest (project uses vitest)
- **Integration:** curl against running API server

---

## Acceptance Criteria

1. `GET /api/inventory/turnover-report?startDate=2026-01-01&endDate=2026-06-10` returns 200 with valid JSON
2. `GET /api/inventory/store-display` returns 200 with items array
3. `GET /api/price-tag/tasks` returns list of tasks
4. Price tag worker logs processing activity
5. Frontend builds without error (`pnpm --filter web-cockpit build`)
6. Screenshots show all three new UI components
