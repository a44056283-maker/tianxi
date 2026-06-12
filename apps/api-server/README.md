# API Server

FastAPI backend for the Lenovo smart retail cockpit.

## Run

```bash
cd apps/api-server
uv sync
uv run fastapi dev app/main.py --host 0.0.0.0 --port 8000
```

For local-only debugging, `127.0.0.1` is acceptable. For LAN, mobile, or domain
access, the API must listen on `0.0.0.0`, and the frontend/domain gateway should
proxy same-origin `/api` requests to this service instead of exposing
`domain:8000` directly.

Useful endpoints:

```text
GET /health
GET /api/dashboard/summary
GET /api/inventory-quote/summary
GET /api/inventory-quote/inventory
GET /api/inventory-quote/retail-zone
GET /api/sales/staff
GET /api/sales/orders
POST /api/sales/orders
DELETE /api/sales/orders/{order_id}
GET /api/sales/sync-tasks
GET /api/retail-core/status
GET /api/retail-core/category-tree
GET /api/retail-core/serial-items
GET /api/retail-core/inventory-movements
GET /api/retail-core/sales-orders
GET /api/sync/tasks
POST /api/price-tags/update-tasks
GET /api/prompt-workspace/template
GET /api/prompt-workspace/entries
POST /api/prompt-workspace/entries
GET /api/prompt-workspace/entries/{entry_id}
POST /api/prompt-workspace/entries/{entry_id}/optimize
GET /api/prompt-workspace/search
GET /api/prompt-workspace/knowledge
POST /api/prompt-workspace/knowledge
```

The first version reads existing JSON snapshots from `apps/web-cockpit/public/data`.
This keeps the API contract runnable before SQLite import tables are introduced.

Sales skeleton notes:

- Local sales ledger file: `apps/api-server/data/local-sales-ledger.json`
- Local retail core database: `apps/api-server/data/retail-core.sqlite3`
- Creating a sales order will:
  - append order record into local ledger
  - append `sales_outbound` records into `apps/web-cockpit/public/data/latest-inventory-movements.json`
  - enqueue a pending sync task (`push_sale_to_zhidiantong`) for later worker execution
  - write the order, order lines, inventory movement, and sync task into SQLite retail core tables

Retail core notes:

- The first SQLite schema absorbs useful patterns from InvenTree, ERPNext, POS systems, and ESL systems.
- The current core tables cover product, SKU, serial inventory, inventory movement, staff, customers, suppliers, sales orders, purchase orders, external sync tasks, and electronic shelf label update tasks.
- `GET /api/retail-core/status` initializes the schema and seeds SKU reference data from the latest local inventory snapshot.
- `GET /api/retail-core/category-tree` returns category nodes and SKU mappings across Lenovo smart retail display categories, original Zhidiantong subcategories, and JD/Lenovo catalog subcategories.
- `GET /api/retail-core/serial-items` returns the local SN ledger for the retail ops UI.
- `GET /api/retail-core/inventory-movements` returns purchase, sales, transfer, and adjustment movements for both smart retail display and retail ops modules.
- `GET /api/retail-core/sales-orders` returns local sales orders.
- `GET /api/sync/tasks` returns synchronization tasks for Zhidiantong and price tag gateway processing.
- `POST /api/price-tags/update-tasks` creates an electronic shelf label update task and a pending `price_tag_gateway` sync task.

Prompt workspace notes:

- `GET /api/prompt-workspace/template` returns the fixed 5-section high-precision question template.
- `POST /api/prompt-workspace/entries` accepts structured background/problem/goal/rules/acceptance data and generates a full template, blueprint, audit, and keyword index.
- `GET /api/prompt-workspace/entries` and `GET /api/prompt-workspace/search` support history traceability and keyword retrieval.
- `POST /api/prompt-workspace/entries/{entry_id}/optimize` uses the configured MiniMax key for wording optimization, first-principles review, and logic-risk suggestions.
- `POST /api/prompt-workspace/knowledge` stores reusable keyword knowledge entries for later retrieval.
