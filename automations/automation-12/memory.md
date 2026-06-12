# automation-12 / 高考电脑选购知识日更

## 任务定义
运行 gaokao-major-guide-refresh 定时任务，基于 latest-gaokao-daily-learning.json 重建 latest-gaokao-major-guides.json，验证 /api/marketing/gaokao-2026/knowledge-guides 返回当天条目、dailyLearningHighlights 已更新、前端 mobile.html 知识分享类目可读取到内容。

## 命令
cd apps/inventory-sync
node --import tsx/esm src/cli.ts run-scheduled-task gaokao-major-guide-refresh

任务注册在 apps/inventory-sync/src/automation/scheduledTasks.ts
任务名: gaokao-major-guide-refresh
入口: buildGaokaoKnowledgeGuides in src/storage/gaokaoKnowledgeGuides.ts
产物:
  apps/inventory-sync/artifacts/latest-gaokao-major-guides.json
  apps/web-cockpit/public/data/latest-gaokao-major-guides.json
依赖快照:
  latest-retail-zone-snapshot.json
  latest-retail-core-sales-orders.json
  latest-gaokao-daily-learning.json

## 验收口径
1. 任务 executionOutcome=real_completed 且 updatedRecordCount>=7。
2. 两个产物 JSON 的 generatedAt 为当天时间。
3. curl http://127.0.0.1:8000/api/marketing/gaokao-2026/knowledge-guides 返回 7 条 guide,每条 dailyLearningHighlights 与 featuredProducts 已写入。
4. curl /api/marketing/gaokao-2026/daily-learning 当天 generatedAt 且至少 4 条 tracks。
5. apps/web-cockpit/public/gaokao-2026/mobile.html 中 #guideList 区域使用 portalKnowledgeGuideApiUrl 读取 API 并由 renderKnowledgeGuides 渲染。

## 2026-06-08 运行结果
- 执行命令: node --import tsx/esm src/cli.ts run-scheduled-task gaokao-major-guide-refresh
- 退出码: 0
- executionOutcome: real_completed
- updatedRecordCount: 7
- 步骤 build_gaokao_major_guides: completed
- 产物 generatedAt: 2026-06-08T08:17:52.967Z
- 验证 API: 返回 7 条,generatedAt 同上
- 验证 daily-learning API: generatedAt 2026-06-08T08:08:29.796Z,4 tracks / 4 dailyLearnings
- 前端 mobile.html: #guideList 经 portalKnowledgeGuideApiUrl 拉取后由 renderKnowledgeGuides 渲染

## 阻塞
无。
