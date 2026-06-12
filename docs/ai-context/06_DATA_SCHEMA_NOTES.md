# 06 Data Schema Notes

更新时间：2026-05-14

## 主要 JSON 快照

位置：

- `apps/web-cockpit/public/data`
- `apps/inventory-sync/artifacts`

关键文件：

- `latest-standard-inventory-snapshot.json`
- `latest-adjusted-inventory-snapshot.json`
- `latest-inventory-adjustments.json`
- `latest-inventory-movements.json`
- `latest-inventory-master-snapshot.json`
- `latest-serial-overrides.json`
- `latest-product-url-locks.json`
- `latest-marketplace-price-snapshot.json`
- `latest-standard-price-master.json`
- `latest-standard-price-master-frontend-snapshot.json`
- `latest-retail-zone-snapshot.json`
- `latest-price-protection-snapshot.json`
- `latest-collection-operation-plan.json`
- `latest-warranty-check-queue.json`
- `latest-retail-price-audit.json`
- `latest-lenovo-warranty-snapshot.json`
- `latest-scheduled-task-reports.json`
- `latest-scheduled-task-dashboard.json`

## 主要语义

### standard inventory snapshot

- 来自智店通库存数量和 SN 导出
- 代表原始库存基线

关键字段：

- `storeName`
- `organizationCode`
- `totals`
- `categories`
- `skus`
- `dataQuality`

### adjusted inventory snapshot

- 在标准库存基础上叠加：
  - 库存流水净变动
  - 后台库存校准
  - SN 覆盖
- 当前前端库存展示应以此为主要事实层

### inventory movements

记录出入库流水。

关键字段：

- `id`
- `skuKey`
- `serialNumber`
- `movementType`
- `quantity`
- `businessDate`
- `note`

常见 `movementType`：

- `sales_outbound`
- `purchase_inbound`
- `other_outbound`
- `transfer`
- `adjustment`

### inventory master snapshot

- 目标：
  - 把 `商品库存统计`、`商品库存SN统计`、`库存流水`、`SN库存订单`、`库存订单` 合并成“每 SN 一行”的标准化主表。
- 事实边界：
  - 当前主表只承载“当前在库 SN”。
  - `商品库存统计 + 商品库存SN统计` 是当前库存真值层。
  - `库存流水 / SN库存订单 / 库存订单` 是追溯和补证层。
  - 历史已售 / 已调出但不在当前库存 SN 导出中的 SN，不进入 `rows`，只进入 `exceptions`。

顶层字段：

- `source`
- `generatedAt`
- `files.stockQuantityFile`
- `files.stockSnFile`
- `files.stockStreamFile`
- `files.snStockOrderFile`
- `files.stockOrderFile`
- `totals`
- `coverage`
- `warnings`
- `rows`
- `exceptions`

`rows[]` 关键字段：

- 身份字段：
  - `serialNumber`
  - `skuKey`
  - `skuCode`
  - `productCode`
  - `pnMtm`
  - `productName`
  - `spec`
  - `category`
- 当前库存字段：
  - `organizationName`
  - `organizationCode`
  - `stockType`
  - `currentStock`
  - `sellableStock`
  - `occupiedStock`
  - `unsellableStock`
  - `pendingInboundStock`
  - `serialCountWithinSku`
  - `inStock`
  - `lifecycleStatus`
  - `locationName`
- SN 时效字段：
  - `stockAgeDays`
  - `warrantyStart`
  - `warrantyEnd`
- 入库追溯字段：
  - `inboundDate`
  - `inboundDocumentNumber`
  - `inboundDocumentType`
  - `inboundOperatorName`
  - `supplierName`
- 最近流水字段：
  - `latestBusinessDate`
  - `latestDocumentNumber`
  - `latestDocumentType`
  - `latestMovementType`
  - `latestOperatorName`
  - `latestStoreName`
  - `latestLocationName`
  - `latestNote`
- 证据字段：
  - `evidencePriority`
  - `sourceRefs[]`
- 数据质量字段：
  - `dataQuality.hasSnapshotSerial`
  - `dataQuality.hasInboundEvidence`
  - `dataQuality.hasDocumentEvidence`
  - `dataQuality.hasMovementEvidence`
  - `dataQuality.warnings[]`

`exceptions[]` 用于承接无法直接落成每 SN 一行的残留：

- `sku_without_serials`
- `unmatched_sn_stock_order`
- `unmatched_stock_order`
- `movement_serial_not_in_snapshot`
- `override_serial_not_in_snapshot`

证据优先级：

1. `SN库存订单`
   - 补 `inboundDate / inboundDocumentNumber / inboundOperatorName / locationName`
2. `serial overrides`
   - 承接已经人工确认并写回的 SN 级补证结果
3. `inventory movements`
   - 补最近一次库存动作和可见入库流水
4. `stock order`
   - 在缺少 SN 级单据证据时，做数量级、单据级兜底
5. `stock_sn_export`
   - 仅作为当前在库 SN 基线，不视为充分单据证据

### serial overrides

用于补齐或更正 SN 级字段：

- `inboundDate`
- `costAmount`
- `inboundDocumentNo`
- `operatorName`
- `supplierName`
- `locationName`
- `documentNumber`
- `note`

### marketplace price snapshot

每个 SKU 可有多来源记录。

常见字段：

- `source`
- `productId`
- `skuKey`
- `configuredUrl`
- `evidenceUrl`
- `price`
- `preSubsidyPrice`
- `couponAdjustedPrice`
- `postSubsidyPrice`
- `priceType`
- `confidence`
- `collectionStatus`
- `notes`

注意：

- 并非所有记录都是真实采信价
- 需要区分 `captured / configured_only / manual_review_required / provisional`
- 京东直接可见满减/平台券时：
  - `priceType = coupon_adjusted_price`
  - `price` 与 `couponAdjustedPrice` 写券后国补前价
  - `raw.displayPrice` 保存页面原价
  - `raw.platformCouponAmount` 或 `raw.couponAmount` 保存券额/满减额

### standard price master

- 作用：把京东 / 联想官旗原始采集记录按 `SKU x 来源` 归集成“标准报价总表”。
- 范围：当前只覆盖 `jd` 与 `lenovo_official` 两个主零售来源。
- 粒度：一行对应一个有库存 SKU。

关键字段：

- `skuKey`
- `productName`
- `currentStock`
- `sources.jd`
- `sources.lenovo_official`
- `comparison.status`
- `comparison.jdComparablePrice`
- `comparison.lenovoOfficialComparablePrice`
- `comparison.absoluteGap`
- `syncDecision.status`
- `syncDecision.suggestedUnifiedPrice`

`sources.<source>` 子结构语义：

- `recordCount`: 该来源原始记录数
- `lockStatus`: `locked / candidate / pending_lock / unavailable`
- `lockedUrl`: 已锁定的商品详情页 URL
- `selectedRecord`: 当前总表选中的主记录
- `evidenceAudit.status`: `complete_for_sync / missing_required_fields / non_detail_url / placeholder_only / unavailable / missing_record`
- `evidenceAudit.syncEligible`: 是否允许进入统一同步候选

主比较状态：

- `ready_for_compare`: 两端都已锁详情页、主报价字段可比、证据完整
- `missing_source`: 至少一端没有有效来源记录
- `manual_review_required`: 有记录，但仍处于人工复核或非正式采信状态
- `evidence_incomplete`: 详情页或证据字段不完整
- `unavailable`: 两端页面都不可销售

统一同步状态：

- `ready_for_unified_sync`
- `hold_missing_source`
- `hold_manual_review`
- `hold_evidence_incomplete`
- `hold_large_gap_review`

### standard price master frontend snapshot

- 作用：给前端或计划面板使用的轻量快照。
- 来源：从 `latest-standard-price-master.json` 派生，不直接读取零散原始采集记录。

关键字段：

- `skuKey`
- `productName`
- `jdPrice`
- `lenovoOfficialPrice`
- `priceGap`
- `comparisonStatus`
- `syncStatus`
- `suggestedUnifiedPrice`
- `lastCapturedAt`
- `evidenceSummary`

### 人工采集证据字段

对 `manual / browser_rpa / user_supplied_visible_price / user_supplied_url` 这类人工或类人工记录，进入标准报价总表后要检查以下字段：

- `evidence.evidenceUrl`: 必须是精确商品详情页 URL
- `evidence.screenshotPath`: 本地截图或落盘截图路径
- `evidence.capturedAt`: ISO 时间
- `evidence.capturedBy`: 采集方式 / 采集器标识
- `evidence.note`: 价格口径、页面状态、是否可销售、是否含券后/国补后说明

边界：

- 搜索页、店铺页、活动页链接只能当找链接线索，不能冒充商品详情页报价。
- `url_configured_only` 只能保留在原始层和总表占位层，不能直接进入前端统一同步。
- 下架、无货、待发布页面只保留证据，不作为正式主报价。

### scheduled task reports

- 位置：
  - `apps/inventory-sync/artifacts/latest-scheduled-task-reports.json`
  - `apps/inventory-sync/artifacts/latest-scheduled-task-dashboard.json`
  - `apps/web-cockpit/public/data/latest-scheduled-task-dashboard.json`
- 关键字段：
  - `taskName`
  - `executedAt`
  - `finishedAt`
  - `status`
  - `executionOutcome`
  - `manualActionRequired`
  - `blockingReason`
  - `warnings`
  - `steps`
  - `metrics.newRecordCount`
  - `metrics.updatedRecordCount`
  - `metrics.unmatchedProductCount`
  - `metrics.missingLinkCount`
  - `metrics.missingPriceCount`
  - `metrics.missingWarrantyCount`
  - `metrics.frontendRefreshed`
  - `artifacts.evidencePaths`

## SQLite 本地核心

位置：

- `apps/api-server/data/retail-core.sqlite3`

核心表见：

- `apps/api-server/app/retail_core.py`

主要表：

- `product`
- `sku`
- `serial_item`
- `inventory_movement`
- `sales_order`
- `sales_order_line`
- `purchase_order`
- `purchase_order_line`
- `sync_task`
- `price_tag_update_task`
- `product_category_node`
- `sku_category_mapping`
