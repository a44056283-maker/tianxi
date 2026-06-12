# Automation 15 Memory

## 2026-05-23T15:28:47+0800

- 本轮为 `智店通同步-15:00`，项目目录 `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`。
- 已读取 `AGENTS.md`、`docs/ai-context/13_SCHEDULED_TASK_SOPS.md`、`docs/ai-context/07_BROWSER_WORKFLOW.md`、既有自动化记忆，并检查 `git status --short --branch`。
- 使用 Chrome 现有登录网页微信 `https://localhost:3001/` 从当前会话进入 `智店通入库群`，未使用搜索栏；已按“历史方向扫描 + 最新方向复扫 + 可疑区域二次回扫”完成 14:22:19 至 15:09 左右覆盖。
- 本轮发现 1 条教育补代扫记录并落盘 `apps/inventory-sync/artifacts/manual/education-agent-scan/education-agent-scan-2026-05-23-1500-manual-visible.json`：`TB323FU TAB 12G+256GBL-CN` / `20006802` / `ZAH20097CN` / SN `HA2HE9Q8`，教育补 200，代扫服务费 50。
- 已用 Chrome 现有登录会话进入智店通销售/零售出库、商品入库、其他出库、库存流水、SN库存订单页面；每页均选择当天 `2026-05-23 ~ 2026-05-23` 并查询。其他出库当天暂无数据。
- 新导出并复制同日固定入口文件：销售明细、销售订单列表、库存流水、SN库存订单、商品库存统计、商品库存SN统计；关键文件包括 `zhidiantong-sales-export-2026-05-23.xlsx`、`zhidiantong-stock-stream-2026-05-23.xlsx`、`zhidiantong-sn-stock-order-2026-05-23.xlsx`、`商品库存统计_2026-05-23.xlsx`、`商品库存SN统计_2026-05-23.xlsx`。
- 仅运行任务命令 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`。前两次暴露旧导出/总表不齐导致未收口，补齐同日库存总表与 SN 总表后第三次最终通过。
- 最终调度报告：`apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-05-23T07-24-12-514Z.json`；结果 `status=completed` / `executionOutcome=real_completed` / `warnings=[]` / `manualActionRequired=false`。
- 最终指标：库存流水导入 `importedCount=1`、合并流水 `mergedRecordCount=503`；SN库存订单导入 `importedCount=17`、`overrideCount=2`；同日库存总表与 SN 总表 `quantityIsToday=true`、`snIsToday=true`；库存/SN 一致性 `mismatchCount=0`。
- 前端桥接指标：`salesOrderCount=61`、`inventoryMovementCount=503`、`serialItemCount=327`、`salesOutboundMovementCount=68`。
- 营销/教育/代扫联动：`educationAgentScanTotalCount=4`、`educationAgentScanMatchedOutboundCount=4`、`educationAgentScanPendingOutboundCount=0`、`pendingAgentRowsWithSoldSnCount=0`；`HA2HE9Q8` 已自动匹配出库单 `XS26052364661818968`。
- 前端可见审计已打开 `http://127.0.0.1:5174/?audit=zhidiantong-sync-cycle-2026-05-23-1500`：`出库流水` 可筛到 `HA2HE9Q8 / XS26052364661818968`；`产品价保 > 教育补代扫汇总` 可见教育补 200、代扫服务费 50、未付；`库存详情 > 库存台账` 搜 `20006802` 可见当前库存 1、可售 1、SN `HA2HE9RD`、库存进货价 3649。
- 前端审计截图已保存到 `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-05-23-1500-frontend-*.png`。

## 2026-05-22T15:15:14+0800

- 本轮为 `智店通同步-15:00`，项目目录 `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`。
- 已读取 `AGENTS.md`、`docs/ai-context/13_SCHEDULED_TASK_SOPS.md`、`docs/ai-context/07_BROWSER_WORKFLOW.md`、既有自动化记忆，并检查 `git status --short --branch`。
- 使用 Chrome 现有登录会话和可见页面，未使用无头浏览器、新 Profile 或脚本式页面采集；已取得并释放 `zhidiantong-sync-15` 电脑操控槽位。
- 已逐页选择/确认当天 `2026-05-22 ~ 2026-05-22` 并点击查询：
  - 销售/零售出库：线下门店订单当天可见 4 条已完成门店收银订单；导出 `orderData (15).xlsx` 和 `orderProductData (23).xlsx`。
  - 商品入库：从默认多日范围改为当天范围，查询后暂无数据，页面无导出入口。
  - 其他出库：当天范围查询后暂无数据，页面无导出入口。
  - 库存流水：当天可见 4 条订单出库流水；导出 `stock_count2026-05-22 (3).xlsx`。
  - SN库存订单：当天可见 4 条 SN 订单出库记录；导出 `serialNumberData (31).xlsx`。
  - 商品库存总表与商品库存SN总表：同日成对导出 `商品库存统计_2026-05-22 (1).xlsx` 与 `商品库存SN统计_2026-05-22 (1).xlsx`。
- 初次运行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 时，脚本只识别固定名旧文件，漏掉 15:00 新导出的带序号文件；已将本轮导出覆盖到固定手工入口：
  - `apps/inventory-sync/artifacts/manual/zhidiantong-sales-export-2026-05-22.xlsx`
  - `apps/inventory-sync/artifacts/manual/zhidiantong-sales-order-list-2026-05-22.xlsx`
  - `apps/inventory-sync/artifacts/manual/zhidiantong-stock-stream-2026-05-22.xlsx`
  - `apps/inventory-sync/artifacts/manual/zhidiantong-sn-stock-order-2026-05-22.xlsx`
- 第二次运行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 为最终结果：`status=completed` / `executionOutcome=real_completed` / `manualActionRequired=false` / `warnings=[]`。
- 调度报告：`apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-05-22T07-13-43-758Z.json`。
- 导入指标：库存流水 `importedCount=4`、`mergedRecordCount=484`；SN库存订单 `importedCount=4`、`mergedRecordCount=484`；`newRecordCount=8`、`updatedRecordCount=968`。
- 可见 4 条当天销售出库均已进入 `latest-inventory-movements.json`：`XS26052233511922868`、`XS26052254249612968`、`XS26052298831652868`、`XS26052234432692968`。
- 库存/SN 核查：同日库存总表与 SN 总表 `quantityIsToday=true`、`snIsToday=true`；`verify_inventory_serial_consistency.mismatchCount=0`；`frontendRefreshed=true`。
- 营销/教育/代扫联动：`salesOutboundCount=51`、`salesHeroCardCount=19`、`salesHeroCardWithAmountCount=19`、`educationAgentScanMatchedOutboundCount=1`、`educationAgentScanPendingOutboundCount=0`、`pendingAgentRowsWithSoldSnCount=0`。

## 2026-05-21T15:13:00+0800

- 本轮为 `智店通同步-15:00`，项目目录 `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`。
- 已按要求先读取 `AGENTS.md`、`docs/ai-context/13_SCHEDULED_TASK_SOPS.md`、`docs/ai-context/07_BROWSER_WORKFLOW.md` 和既有自动化记忆，并检查 `git status --short --branch`。
- 使用 Chrome 现有登录会话打开 `https://retail-pos.lenovo.com/`；入口落到登录页后按项目边界点击一次快捷登录，成功进入门店 `D0186124`，未遇到验证码/滑块/403/白屏。
- 已逐页选择/确认当天 `2026-05-21 ~ 2026-05-21` 并查询：
  - 销售/零售出库：线下门店订单当天可见 4 条已完成门店收银订单；导出 `orderData (9).xlsx` 和 `orderProductData (15).xlsx`。
  - 商品入库：当天可见 6 条已完成 CGR 入库单，页面无导出入口。
  - 其他出入库：当天暂无数据。
  - 库存流水：当天可见 10 条，包含 4 条订单出库和 6 条采购入库；导出 `stock_count2026-05-21 (4).xlsx`。
  - SN库存订单：当天可见 35 条 SN 流水；导出 `serialNumberData (22).xlsx`。
  - 商品库存总表与商品库存SN总表：同日成对导出 `商品库存统计_2026-05-21 (1).xlsx` 与 `商品库存SN统计_2026-05-21 (1).xlsx`。
- 本轮 15:00 导出已复制到 `apps/inventory-sync/artifacts/manual/*-2026-05-21-1500.xlsx`，并覆盖同日通用手工证据文件，避免脚本误用 14:15 导出。
- 已运行两次 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`；最终以覆盖 15:00 通用证据后的第二次报告为准。
- 调度报告：`apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-05-21T07-12-14-307Z.json`。
- 结果：`status=completed` / `executionOutcome=real_completed` / `manualActionRequired=false` / `warnings=[]`。
- 导入指标：库存流水 `importedCount=10`；SN库存订单 `importedCount=35`、`overrideCount=31`；`newRecordCount=45`、`updatedRecordCount=960`。
- 库存/SN 核查：同日库存总表与 SN 总表 `quantityIsToday=true`、`snIsToday=true`；`verify_inventory_serial_consistency.mismatchCount=0`；`frontendRefreshed=true`。
- 已更新 `docs/ai-context/01_CURRENT_STATE.md`、`03_TASK_LOG.md`、`04_NEXT_ACTIONS.md`、`09_CODEX_HANDOFF.md`、`10_TEST_LOG.md`。

## 2026-05-20T15:11:00+0800

- 本轮为 `智店通同步-15:00`，项目目录 `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`。
- 已按要求先读取 `AGENTS.md`、`docs/ai-context/13_SCHEDULED_TASK_SOPS.md`、`docs/ai-context/07_BROWSER_WORKFLOW.md`，并检查 `git status --short --branch`。
- 使用 Chrome 现有登录会话逐页进入并查询当天 `2026-05-20 ~ 2026-05-20`：
  - 销售/零售出库：暂无数据，导出按钮禁用。
  - 商品入库：可见 14 条，页面无导出入口；保留页面证据，不编造导出文件。
  - 其他出入库：暂无数据，页面无导出入口。
  - 库存流水：导出 `/Users/luxiangnan/Downloads/stock_count2026-05-20 (6).xlsx`，复制为 `apps/inventory-sync/artifacts/manual/zhidiantong-stock-stream-2026-05-20.xlsx` 和 `apps/inventory-sync/artifacts/manual/zhidiantong-stock-stream-2026-05-20-1500.xlsx`。
  - SN库存订单：导出 `/Users/luxiangnan/Downloads/serialNumberData (13).xlsx`，复制为 `apps/inventory-sync/artifacts/manual/zhidiantong-sn-stock-order-2026-05-20.xlsx` 和 `apps/inventory-sync/artifacts/manual/zhidiantong-sn-stock-order-2026-05-20-1500.xlsx`。
- 页面证据与筛选条件已落盘：`apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-05-20-1500-browser-evidence.json`。
- 已运行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`。
- 调度报告：`apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-05-20T07-09-45-945Z.json`。
- 结果：`status=completed` / `executionOutcome=real_completed` / `manualActionRequired=false`。
- 导入指标：库存流水 `importedCount=16`、`mergedRecordCount=437`；SN库存订单 `importedCount=38`、`overrideCount=38`、`mergedOverrideCount=58`；同日库存总表与 SN 总表校验通过。
- 库存/SN 核查：`currentStock=319`、`sellableStock=319`、`serialCount=319`、`mismatchCount=0`。
- 已更新 `docs/ai-context/01_CURRENT_STATE.md`、`03_TASK_LOG.md`、`04_NEXT_ACTIONS.md`、`09_CODEX_HANDOFF.md`、`10_TEST_LOG.md`，并生成 `docs/ai-context/packages/smart-retail-context-20260520-1511.zip` 与 `docs/ai-context/snapshots/snapshot-20260520-1511.md`。

## 2026-05-19T15:08:19+0800

- 本轮为 `智店通同步-15:00`，项目目录 `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`。
- 已用 Chrome 现有登录会话逐页进入并查询当天 `2026-05-19 ~ 2026-05-19`：
  - 线下门店订单/销售出库：1 条已完成订单，导出 `/Users/luxiangnan/Downloads/orderProductData (4).xlsx`，并复制为 `apps/inventory-sync/artifacts/manual/zhidiantong-sales-export-2026-05-19.xlsx`。
  - 商品入库：3 条记录，其中 `CGR260519393211` 为 `待商确认`，页面无导出按钮，仅保留页面可见证据。
  - 其他出入库：查询后暂无数据，页面无导出按钮。
  - 库存流水：4 条记录，导出 `/Users/luxiangnan/Downloads/stock_count2026-05-19.xlsx`。
  - SN库存订单：15 条记录，导出 `/Users/luxiangnan/Downloads/serialNumberData (2).xlsx`，并复制为 `apps/inventory-sync/artifacts/manual/zhidiantong-sn-stock-order-2026-05-19.xlsx`。
  - 商品库存总表与商品库存SN总表：同日成对导出 `/Users/luxiangnan/Downloads/商品库存统计_2026-05-19.xlsx` 与 `/Users/luxiangnan/Downloads/商品库存SN统计_2026-05-19.xlsx`。
- 已运行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`。
- 页面证据与筛选条件已落盘：`apps/inventory-sync/artifacts/manual/zhidiantong-sync-evidence-2026-05-19-1500.json`。
- 调度报告：`apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-05-19T07-07-47-284Z.json`。
- 结果：`completed_with_warnings` / `executionOutcome=executed_not_closed` / `manualActionRequired=true`。
- 导入指标：库存流水 `importedCount=4`；SN库存订单 `importedCount=5`、`overrideCount=4`、`skippedCount=10`；总表同日成对校验通过。
- 阻塞：`verify_inventory_serial_consistency` 失败，1 个需 SN 管理 SKU 数量与 SN 不一致：`20004481 PadPro12.7银色 TB375FC TAB 8G+256GCL-CN`，`currentStock=3`，`serialCount=13`。原因线索是当天 SN库存订单含 `CGR260519393211` 的 10 台 `待商确认` 入库 SN，不能把本轮写成 `real_completed`。
