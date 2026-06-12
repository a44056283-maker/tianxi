# 16 Bookmark SQL Audit

更新时间：2026-05-24 18:55

## 结论

- 当前主书签共 `9` 个：`retail / overview / serials / prices / sources / movements / integration / productLibrary / sessionBoard`
- 当前前端书签页默认运行模式仍是 `api_strict`。
- 本轮已把仍依赖 `latest-*.json` 的主要业务快照统一镜像到 SQLite `snapshot_cache`，再由 API 输出。
- 因此当前书签页的数据链路分成两类：
  1. 直接 SQL 表/API
  2. SQLite `snapshot_cache` 镜像 API
- 默认在线模式下，不再把 `public/data/*.json` 作为书签页的首选真实数据源。

## 书签审计结果

### `retail` 实时零售报价

- 数据源：
  - `retail-zone / marketplace-prices / product-url-locks / marketing-boost-hero` -> `snapshot_cache`
  - `distributor-quotes` -> `retail_core` SQL 表优先
  - `store-manual-promotions` -> `store_manual_promotion`
- 结论：已实现 API -> SQLite 对接。

### `serials` 库存详情

- 数据源：
  - `inventory-master / adjusted-inventory / warranty / warranty-check-queue / serial-overrides` -> `snapshot_cache`
  - `retail-core/serial-items` -> `serial_item`
  - `price-signals` -> `inventory_price_signal_current`
- 结论：已实现 API -> SQLite 对接。

### `prices` 产品价保

- 数据源：
  - `price-protection / marketing-boost / education-agent-scan / retail-zone / manual-overrides` -> `snapshot_cache`
  - `sales-price-protection-history` -> `sales_price_protection_history`
  - `store-manual-promotions` -> `store_manual_promotion`
- 结论：已实现 API -> SQLite 对接。

### `sources` 报价来源

- 数据源：
  - `distributor-quotes` -> `distributor_quote_current`，空表时回读 `snapshot_cache`
  - `gray-wholesale` -> `gray_wholesale_quote_current`，空表时回读 `snapshot_cache`
  - `price-signals` -> `inventory_price_signal_current`，空表时回读 `snapshot_cache`
  - `marketplace-prices / product-url-locks / competitor-monitor` -> `snapshot_cache`
- 结论：已实现 API -> SQLite 对接。

### `movements` 出入库流水

- 数据源：
  - `inventory-movements` -> `inventory_movement` SQL 聚合输出
  - `sales-orders` -> `sales_order / sales_order_line`
- 结论：已实现直接 SQL 对接。

### `integration` 系统集成

- 数据源：
  - `retail-core/status / category-tree / serial-items / inventory-movements / sales-orders / sync-tasks` -> `retail_core` SQL
- 结论：已实现直接 SQL 对接。

### `productLibrary` 产品库

- 数据源：
  - `overview / categories / products / detail / rules / sku / collection / evidence / replays / change-logs` -> `product_library` SQL
  - `local-sync pipelines / latest-report / failure-queue` -> `snapshot_cache`
  - `scheduled-task-console` -> `scheduled_task_profile` + `scheduled_task_change_log`，并叠加 watchdog/dashboard 快照
- 结论：已实现 API -> SQLite 对接。

### `sessionBoard` 会话看板

- 数据源：
  - `openclaw chat board` -> API 动态构建后写入 `snapshot_cache`
- 结论：已实现 API -> SQLite 对接。

## 本轮整改

1. 新增 SQLite `snapshot_cache`，用于承接原本只存在于 `public/data` / `artifacts` 的业务快照。
2. `main.py` 下列接口改为先同步到 `snapshot_cache` 再输出：
   - `inventory-quote/*` 下的主要快照接口
   - `dashboard/summary`
   - `local-sync/latest-report`
   - `local-sync/failure-queue`
   - `local-sync/pipelines`
   - `openclaw/chat-board`
3. 新增：
   - `POST /api/inventory-quote/manual-overrides`
   - `POST /api/inventory-quote/inventory-adjustments`
4. 前端 `service.ts` 已加固：
   - 默认 `api_strict` 下，产品库、定时任务控制、本地同步、OpenClaw 面板不再静默回落到静态快照。

## 保留说明

- `static fallback` 没有从代码彻底删除，只保留给显式 `api` / `static` 模式或离线排障使用。
- 当前默认页面运行口径是 `api_strict`，因此正常访问书签页时不会把静态快照当成首选真实源。
