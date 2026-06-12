# 入库出库后库存与 SN 前端同步教程

更新时间：2026-05-17

## 目标

解决“智店通销售出库 / 采购入库 / 其他出库已经同步，但前端库存和 SN 仍停留在旧状态”的问题。

本教程固定口径为：

1. 先同步当天入库、出库、零售销售和其他出库。
2. 再手动导出当天完整 `商品库存统计` 和 `商品库存SN统计`。
3. 最后只用这对成对总表统一重建前端库存与 SN。

本教程不允许回到“一个商品一个商品去单采”的旧路子。

## 这条链为什么会断

之前的 `rebuildDerivedSnapshots()` 只重建了：

1. `latest-adjusted-inventory-snapshot.json`
2. `latest-collection-operation-plan.json`
3. `latest-warranty-check-queue.json`
4. `latest-retail-price-audit.json`
5. `latest-retail-zone-snapshot.json`

但没有统一刷新下面三类前端静态文件：

1. `latest-inventory-movements.json`
2. `latest-serial-overrides.json`
3. `latest-inventory-master-snapshot.json`

另外，`adjusted inventory` 之前没有把 `latest-inventory-movements.json` 的净变动真正叠加进去，导致即使导入成功，前端库存和 SN 也可能仍显示旧值。

## 当前正确规则

智店通同步完成后，前端库存和 SN 刷新链必须按下面顺序收口：

1. 手动导出当天完整 `商品库存统计_YYYY-MM-DD.xlsx`
2. 手动导出当天完整 `商品库存SN统计_YYYY-MM-DD.xlsx`
3. 刷新 `latest-inventory-movements.json`
4. 刷新 `latest-serial-overrides.json`
5. 重新生成 `latest-standard-inventory-snapshot.json`
6. 重新生成 `latest-inventory-master-snapshot.json`
7. `latest-adjusted-inventory-snapshot.json` 只作为降级兜底，不再作为库存主真值
8. 再重建：
   - `latest-collection-operation-plan.json`
   - `latest-retail-price-audit.json`
   - `latest-retail-zone-snapshot.json`

### 库存待补信息并入同轮同步

库存待补信息不再单独挂旧快照。以后跟库存与 SN 同轮刷新，统一以：

1. `latest-inventory-master-snapshot.json` 的 `exceptions`
2. `latest-inventory-master-snapshot.json` 的入库时间覆盖缺口

为准。

也就是：

- 当天库存数量
- 当天库存 SN
- 当天库存待补缺口

必须来自同一轮重建结果，不允许一边是今天总表，一边还是 5 月 14 日的旧待补快照。

## 实操命令

### 场景 1：刚完成智店通同步

先做智店通当天入库 / 出库同步，然后立刻补做当天全量导出：

1. `商品库存统计`
2. `商品库存SN统计`

两张表必须是同一天导出的成对总表。没有这对总表，只能写“已执行但未收口”，不能写“库存同步已完成”。

先完成手动可见采集：

1. 打开 Chrome 当前已登录网页微信 `https://localhost:3001/`，从当前会话列表或右侧信息栏入口直接点击进入 `智店通入库群`，禁止使用搜索栏搜索群名。
2. 手动查看当天教育补代扫图片/箱码；必须从上次成功扫描时间、上次阻塞时间或上次未扫描时间节点开始滚动补扫历史图片，再回到最新消息，覆盖到本轮执行时间。
3. 箱码图片被消息遮挡、缩略图不完整、只露一部分或外箱码看不清时，必须打开图片或继续滚动定位；不能因为当前屏幕看不到外箱码就判断无箱码。
4. 必须形成图片清单并逐张确认所有图片、缩略图、上传状态卡、箱码截图；至少完成历史方向扫描、最新方向复扫、可疑区域二次回扫。
5. 一直扫到最后一次更新箱码代扫教育补的箱子，且清单无未确认图片，才算群采集完成。
6. 有记录先落盘手动证据；只有完整覆盖上次未扫描节点到本轮时间且确认无新增时，才允许落盘同日无新增确认。
7. 手动进入智店通销售/零售出库、商品入库、其他出入库、库存流水、SN库存订单，每页都选择当天开始日期和结束日期后点击查询。
8. 页面支持导出时，手动导出当天文件；只可查看时，保存页面证据和筛选条件。
9. 重建后必须逐项复核前端公开数据文件：销售单流水、出入库流水、教育补代扫服务费、库存数量、可售数量、SN 扣减、入库 SN。只要 `latest-retail-core-sales-orders.json`、`latest-retail-core-inventory-movements.json`、`latest-education-subsidy-agent-scan-summary.json`、`latest-standard-inventory-snapshot.json`、`latest-inventory-master-snapshot.json` 或 `latest-retail-core-serial-items.json` 仍缺当天数据，就不能写已完成。
10. 文件复核之后还必须打开前端页面做可见审计：进入 `产品价保 -> 教育补代扫汇总`、`出库流水`、`库存详情` 等对应子书签，确认页面上真实显示本轮单号、SN、服务费、库存数量和出入库流水。页面不显示就不能写已完成。

取得上述证据后，才允许执行本地导入校验：

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit
bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle
```

该命令只负责本地导入、重建、校验和报告，不允许被当成采集器。旧任务名 `zhidiantong-sync-12` / `zhidiantong-sync-15` / `zhidiantong-sync-19` 已废止，禁止再调用或恢复。

导入后会自动补刷：

1. `movements`
2. `serial overrides`
3. `standard inventory`
4. `inventory master`
5. `adjusted inventory` 兜底层

### 场景 2：只需要补刷新前端静态快照

执行：

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit
bash scripts/run_scheduled_task.sh daily-audit-and-snapshot-rebuild
```

## 验收方法

至少核对下面 10 个文件时间戳都已更新：

### artifacts

1. `apps/inventory-sync/artifacts/latest-adjusted-inventory-snapshot.json`
2. `apps/inventory-sync/artifacts/latest-inventory-movements.json`
3. `apps/inventory-sync/artifacts/latest-serial-overrides.json`
4. `apps/inventory-sync/artifacts/latest-standard-inventory-snapshot.json`
5. `apps/inventory-sync/artifacts/latest-inventory-master-snapshot.json`

### web public data

1. `apps/web-cockpit/public/data/latest-standard-inventory-snapshot.json`
2. `apps/web-cockpit/public/data/latest-inventory-movements.json`
3. `apps/web-cockpit/public/data/latest-serial-overrides.json`
4. `apps/web-cockpit/public/data/latest-inventory-master-snapshot.json`
5. `apps/web-cockpit/public/data/latest-adjusted-inventory-snapshot.json`

## 本次修复后的真实验证结果

执行：

```bash
bash scripts/run_scheduled_task.sh daily-audit-and-snapshot-rebuild
```

结果：

1. `executionOutcome = real_completed`
2. `movementRecordCount = 412`
3. `serialOverrideCount = 16`
4. `inventoryMasterRowCount = 270`
5. `standard inventory totals = 88 SKU / 270 库存 / 270 SN / 0 unmatched`
6. 前端静态文件时间戳已刷新到 `2026-05-17 12:04`

## 遇到问题时怎么判断

### 问题 1：导入完成，但前端库存不变

先看 `latest-adjusted-inventory-snapshot.json` 的 `generatedAt` 是否刷新。

若没刷新：

1. 直接跑：
   - `bash scripts/run_scheduled_task.sh daily-audit-and-snapshot-rebuild`
2. 再看报告里的 `rebuild_derived_snapshots`

### 问题 2：库存流水已更新，但 SN 仍显示旧序列号

先看：

1. `latest-serial-overrides.json`
2. `latest-inventory-master-snapshot.json`

若两者时间戳未更新，说明前端静态链没有补刷完整。

### 问题 3：报告写完成，但页面仍不对

先区分页面访问模式：

1. 本机 `127.0.0.1` 默认走 API 模式
2. 局域网 / 域名远程访问默认走静态快照模式

所以远程页更依赖 `apps/web-cockpit/public/data/` 下的静态文件是否真的刷新。

## 禁止事项

1. 不要只看 `latest-adjusted-inventory-snapshot.json` 就宣称前端已同步。
2. 不要忽略 `latest-standard-inventory-snapshot.json` 和 `latest-inventory-master-snapshot.json`。
3. 不要用单个商品页面补采代替当天全量 `商品库存统计 + 商品库存SN统计`。
4. 不要把旧的 `movements / serial overrides` 留在前端目录里。
5. 不要把脚本执行过写成“库存和 SN 已经完成前端同步”，必须看时间戳、报告文件和当天成对总表。
