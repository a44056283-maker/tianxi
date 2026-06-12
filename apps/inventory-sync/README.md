# Inventory Sync

This service connects the Lenovo Smart Store / retail POS web system by browser automation.

The vendor currently provides only a web login page and no API key, so the first integration stage is:

1. Open the Lenovo retail login page in a controlled browser.
2. Let an operator finish login manually if SMS, QR code, slider, or other verification appears.
3. Save the authenticated browser session locally.
4. Probe inventory pages and save screenshots/HTML snapshots.
5. Add page-specific parsers after real page samples are confirmed.

## Setup

```bash
cd apps/inventory-sync
npm install
cp .env.example .env
```

Do not commit `.env` or saved storage state files.

## Commands

Manual login and save session:

```bash
npm run login:lenovo
```

Probe the logged-in system and save a page snapshot:

```bash
npm run probe:lenovo
```

Capture the current Zhidiantong API session from the logged-in page and save it locally:

```bash
npm run capture:zhidiantong-session
```

After the session is saved, run seeded incremental sync for sales outbound, purchase inbound, and other outbound:

```bash
npm run sync:zhidiantong-seeded
```

When third-party page automation is not allowed, import a manually exported Zhidiantong sales order detail file instead:

```bash
npm run import-zhidiantong-sales-export
npm run import-zhidiantong-sales-export -- /absolute/path/to/export.xlsx
```

Expected export content:

- line-item level sales order details
- completed orders only
- columns should include order number, completion/pay time, SKU or product code, and SN/serial number

The import command merges into `latest-inventory-movements.json` and automatically rebuilds the adjusted inventory snapshot and retail zone data used by the website.

When Zhidiantong `库存 -> 库存流水` can be exported directly, use that as the preferred unified import entry:

```bash
npm run import-zhidiantong-stock-stream
npm run import-zhidiantong-stock-stream -- /absolute/path/to/库存流水.xlsx
```

Expected export content:

- one row per stock movement
- columns should include business type, document number, business time, product identity, quantity
- SN column is optional but strongly preferred

This unified import can merge:

- sales outbound
- purchase inbound
- other outbound
- transfer inbound
- SN-level inbound metadata

The split imports below remain as fallback only when the stock-stream export is unavailable or incomplete.

When the current Chrome tab is already on `库存 -> 出入库 -> 商品入库`, and we read one day's inbound details directly from the page, import the captured JSON instead:

```bash
npm run import-zhidiantong-purchase-web
npm run import-zhidiantong-purchase-web -- /absolute/path/to/2026-05-12-zhidiantong-purchase-inbound-import.json
```

Expected JSON content:

- one or more purchase inbound business records
- each record includes `documentNumber`, `businessDate`, `operatorName`, `supplierName`, `storeName`, `locationName`
- each line item includes `skuKey`, `pnMtm`, `spec`, and `serialNumbers`

This import also writes inbound metadata such as operator, inbound document number, supplier, and location into the website's serial-level display.

Seed files are configured in `.env`:

```text
ZHIDIANTONG_SALES_ORDER_IDS_FILE=./artifacts/zhidiantong-sales-order-ids.txt
ZHIDIANTONG_PURCHASE_RECORD_IDS_FILE=./artifacts/zhidiantong-purchase-record-ids.txt
ZHIDIANTONG_OTHER_OUTBOUND_IDS_FILE=./artifacts/zhidiantong-other-outbound-ids.txt
```

The sync command merges into existing:

```text
artifacts/latest-inventory-movements.json
artifacts/latest-serial-overrides.json
artifacts/latest-zhidiantong-sync-state.json
```

Important:

- Current implementation already supports direct detail sync for:
  - 线下门店订单销售出库: `/trade/backend/omsOrder/getById?orderId=...`
  - 采购入库: `/prd/backend/storeStockPurchaseRecord/getDetailById`
  - 其他出库: `/prd/backend/storeStockModifyRecord/getDetailById`
- The historical issue where retail sales outbound only landed `7/18` records came from extracting only the visible order IDs from the current page. That temporary path is now explicitly separated from the seeded incremental sync.
- The seeded sync is safe to rerun. It merges by movement `id` and serial number, and it records processed IDs in `latest-zhidiantong-sync-state.json`.

Run inventory sync. At this stage it returns a structured placeholder until real page selectors are confirmed:

```bash
npm run sync:lenovo
```

Parse the latest downloaded stock Excel files from the system download directory:

```bash
npm run parse:exports
```

Build the standard inventory snapshot used by our own system:

```bash
npm run build:snapshot
```

Build the lock-first collection operation plan. This is the calibration entry before any retail price refresh:

```bash
npm run build:collection-plan
```

Policy:

- Inventory and SN data are the SKU truth source.
- Cost trust starts from Smart Store inventory/cost exports; group and WeChat public-account wholesale quotes are reference sources only until their source text/screenshot and parsing rule are locked.
- JD, Lenovo official, and Taobao 100B must lock a real target URL before price collection writes into the pricing engine.
- No third-party paid API is used for retail prices. JustOneAPI commands are intentionally disabled.
- When captcha, slider, login, or risk-control verification appears, collection stops and waits for manual handling in Chrome.

Build the marketplace price placeholder snapshot from configured URLs, the existing JD monitor JSON, and optional manual records:

```bash
npm run collect:marketplace-prices
npm run collect:marketplace-prices -- /path/to/manual-marketplace-prices.json
```

Collect marketplace prices with local browser RPA. Run this only after URL/matching calibration. It reads the standard inventory snapshot, visits Lenovo official locked/search pages, keeps only high-confidence SKU matches, and writes into the same marketplace snapshot:

```bash
npm run collect:browser-marketplace-prices
```

Useful environment controls:

```text
MARKETPLACE_BROWSER_MAX_SKUS=10
MARKETPLACE_BROWSER_HEADLESS=true
```

The browser collector intentionally rejects expired promotions, visible security checks, and hard configuration conflicts such as RTX 4060 results for an RTX 5060 SKU. Rejected candidates are not written into the pricing engine.

Collect JD retail prices through the user's Chrome session. This uses Chrome DevTools Protocol, so Chrome must be launched with a local debug port first:

```bash
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.lenovo-retail-chrome"
```

After that Chrome window opens, log in to JD once, then run:

```bash
npm run collect:chrome-jd-retail
```

This CLI reads JD self-operated store/category pages, extracts `item.jd.com` detail URLs, captures title, price, full reduction, PLUS, national subsidy, education/enterprise subsidy text, and writes the result through the normal pipeline:

```text
artifacts/latest-marketplace-price-snapshot.json
artifacts/latest-product-url-locks.json
artifacts/latest-retail-zone-snapshot.json
../web-cockpit/public/data/latest-*.json
```

If JD shows a verification page, the CLI saves the partial records it already captured, reports `verificationRequiredUrl`, and stops. Complete the verification manually in Chrome, then run the same command again.

Retail collection CLI entries:

```bash
# 联想官网公开零售价和联想商品详情 URL
npm run collect:lenovo-official-prices

# 淘宝百亿补贴：第三方 API 已停用；当前命令只提示先做 URL 锁定和类人采集校准
npm run collect:taobao-subsidy-prices

# 总入口：默认不采集；通过 RETAIL_SITE_COLLECTORS 显式选择校准通过的平台
npm run collect:retail-sites
```

The combined entry is controlled by:

```text
RETAIL_SITE_COLLECTORS=jd_chrome,lenovo_official,taobao_browser
```

Keep `RETAIL_SITE_COLLECTORS` empty while calibrating. After a source is confirmed, enable it explicitly for that run.
`collect:retail-sites` also requires `RETAIL_COLLECTION_CONFIRMED=true`; otherwise it only reports skipped steps and rebuilds derived snapshots without refreshing prices.

## 已退役：MiniMax / browser-use 页面采集

`MiniMax + browser-use` 不再作为本项目采集链路使用，相关 npm 入口、CLI 路由、Python runner、任务包和公开数据快照已移除。

原因：

- 它会打开新浏览器或自动化页面链路，容易触发京东、联想商城、天猫/淘宝、网页微信等平台风控。
- 它无法替代当前已登录 Chrome 可见窗口中的人工低频操作证据。
- 它可能让后续智能体误把“脚本执行”当成“真实采集完成”。

当前允许的方式：

1. 外部页面只使用用户当前已登录 Chrome 可见窗口。
2. 低频、类人、可见地打开列表、搜索、详情页和公众号/群报价页面。
3. 保存原始截图、文本、Excel 或手工证据。
4. 本地脚本只做解析、写入、快照重建、审计和播报。

Useful JD CLI controls:

```text
CHROME_CDP_URL=http://127.0.0.1:9222
CHROME_JD_MAX_URLS=120
CHROME_JD_SOURCE_URLS=https://lenovo1.jd.com/,https://mall.jd.com/index-11713475.html,https://mall.jd.com/index-12894711.html,https://mall.jd.com/index-935158.html
CHROME_JD_URL_FILE=./artifacts/jd-item-urls.txt
```

The snapshot is written to:

```text
artifacts/latest-standard-inventory-snapshot.json
artifacts/latest-marketplace-price-snapshot.json
```

## Download Directory

Lenovo raw Excel exports stay in the default system download directory:

```text
~/Downloads
```

Do not move raw exports into the project. The project only stores parsed JSON snapshots under `artifacts`.

Expected files:

```text
商品库存统计_YYYY-MM-DD.xlsx
商品库存SN统计_YYYY-MM-DD.xlsx
```

Important: export both files with the same store and filter state. For example, if `有库存商品` is checked for SN export, it should also be checked for stock quantity export. Otherwise the snapshot will mark the data as mismatched.

## What We Need Next

- Login flow notes: password, SMS, QR code, slider, or other verification.
- Screenshots of the inventory list, serial number detail, inbound records, outbound/sales records.
- Whether the system supports Excel export.
- Example exported Excel files with sensitive data removed.
- URL path after opening inventory and serial number pages.
