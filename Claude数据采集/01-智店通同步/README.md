# 智店通同步

中文任务名：智店通同步  
taskName：`zhidiantong-sync-cycle`

## 任务定位

目标：同步当天销售出库、采购入库、其他出库，并以当天成对总表统一刷新库存与 SN。

这是真实同步任务，不是只读检查任务。

## 原始输入

当天必须具备：

- 销售导出
- 采购网页导入结果
- 其他出库导入结果
- `商品库存统计_YYYY-MM-DD.xlsx`
- `商品库存SN统计_YYYY-MM-DD.xlsx`

原始输入放到：

- `原始输入/`

## 固定执行顺序

1. 确认智店通已登录且页面稳定
2. 先打开 Chrome 当前已登录网页微信 `https://localhost:3001/`，从当前会话列表或右侧信息栏入口直接点击进入 `智店通入库群`，禁止使用搜索栏搜索群名
3. 手动查看当天教育补代扫图片/箱码；必须从上次成功扫描时间、上次阻塞时间或上次未扫描时间节点开始，向上滚动补扫历史图片，再向下回到最新消息，覆盖到本轮执行时间
4. 箱码图片被消息遮挡、只露缩略图、只露一部分、外箱码不完整或看不清时，必须打开图片或继续滚动定位；不能因为当前屏幕看不到外箱码就判断无箱码
5. 必须形成图片清单，逐张确认每张图片、缩略图、上传状态卡、箱码截图；记录时间、发送人、图片序号、是否箱码、是否教育补代扫、可见 SKU/PN/SN/型号
6. 至少完成三段扫描：历史方向扫描、最新方向复扫、可疑区域二次回扫；左侧历史记录或半截露出的图片仍有可疑箱码时必须继续采集
7. 一直扫到最后一次更新箱码代扫教育补的箱子，且图片清单无未确认项，才算群采集任务完成
8. 有记录先落盘手动证据；只有完整覆盖上次未扫描节点到本轮时间、逐张图片确认完成且确认无新增时，才允许落盘同日无新增确认
9. 手动进入智店通销售/零售出库、商品入库、其他出入库、库存流水、SN库存订单，每页都选择当天开始日期和结束日期后点击查询
10. 本地导入和快照重建后必须复核前端公开数据，不允许只看脚本完成：
    - 销售单流水：`latest-retail-core-sales-orders.json`
    - 出库/入库流水：`latest-retail-core-inventory-movements.json` 和 `latest-inventory-movements.json`
    - 教育补代扫服务费：`latest-education-subsidy-agent-scan-summary.json`
    - 库存数量 / 可售数量 / SN 扣减 / 入库 SN：`latest-standard-inventory-snapshot.json`、`latest-inventory-master-snapshot.json`、`latest-retail-core-serial-items.json`
11. 以上任一前端数据没更新，本轮只能写 `executed_not_closed`，不能写 `real_completed`。
12. 必须打开前端页面做可见审计：进入 `产品价保 -> 教育补代扫汇总`、`出库流水`、`库存详情` 等对应子书签，亲眼确认本轮单号、SN、服务费、库存数量和出入库流水已显示。只看 JSON 或报告不算完成。
10. 页面支持导出时，手动导出当天文件；只可查看时，保存页面证据和筛选条件
11. 只有在取得可见页面证据或导出文件后，才允许执行：
   - `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`
12. 读取：
   - `apps/inventory-sync/artifacts/latest-scheduled-task-reports.json`
13. 核查是否为 `real_completed`

禁止项：

- 禁止用脚本、无头浏览器、新浏览器 Profile、DOM 自动扫描或旧文件重跑冒充当天采集。
- 禁止调用、恢复或新增旧任务名 `zhidiantong-sync-12` / `zhidiantong-sync-15` / `zhidiantong-sync-19`。
- 没有同日网页微信群证据，或没有从上次未扫描节点追溯补扫得出的合格同日无新增确认时，只能写 `executed_not_closed`，不能写 `real_completed`。

## 成功标准

- 当天新记录已写入
- 当天库存数量表与库存 SN 表已成对导出
- 报告状态不是旧文件重跑
- 库存链路未误写成单商品补采

## 回执

回执写到：

- `运行回执/YYYY-MM-DD-智店通同步.md`

阻塞写到：

- `阻塞记录/YYYY-MM-DD-智店通同步.md`
