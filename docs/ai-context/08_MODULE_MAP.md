# 08 Module Map

更新时间：2026-05-13

## 顶层目录

- `README.md`：项目总说明
- `apps/`：前端、后端、同步工具
- `docs/`：业务规则、扫描记录、计划、历史记忆
- `scripts/`：上下文打包与快照脚本

## apps/web-cockpit

- 作用：门店前端驾驶舱与库存零售展示
- 关键目录：
  - `src/App.tsx`：当前主页面入口，仍偏大
  - `src/App.css`：主样式
  - `src/domain/inventoryQuote/service.ts`：库存报价数据服务
  - `public/data/`：前端直接读取的最新快照

## apps/api-server

- 作用：本地 API 与 SQLite 零售核心
- 关键文件：
  - `app/main.py`：FastAPI 入口与接口
  - `app/retail_core.py`：SQLite 核心表与查询/写入辅助
  - `data/retail-core.sqlite3`：本地核心数据库

## apps/inventory-sync

- 作用：CLI、快照生成、解析导入、价格采集规则实现
- 关键文件：
  - `src/cli.ts`：CLI 总入口
  - `src/automation/scheduledTasks.ts`：每日定时任务编排、结果报告、快照落盘
  - `src/inventoryQuote/priceEngine.ts`：报价和零售区决策
  - `src/inventoryQuote/dataService.ts`：报价模块数据读取
  - `src/storage/inventorySnapshotBuilder.ts`：库存快照构建
  - `src/storage/zhidiantongPurchaseWebImporter.ts`：商品入库网页导入
  - `src/storage/zhidiantongSalesExportImporter.ts`：销售导出导入
  - `src/localRetailSync/`：本地门店同步相关骨架

## docs

- `docs/会话上下文记忆.md`：历史会话记忆源，保留不删
- `docs/工作边界与问卷先行规范.md`：高层边界
- `docs/库存及报价实时管理模块实施计划.md`：库存与价格产品规划
- `docs/智店通库存对接扫描记录.md`：智店通页面结构扫描
- `docs/京东采集问卷答案与校准规范.md`：京东规则源
- `docs/ai-context/`：新的长期结构化记忆

## scripts

- `scripts/context_bootstrap.sh`：长记忆恢复入口
- `scripts/context_pack.sh`：上下文打包
- `scripts/context_snapshot.py`：轻量快照
- `scripts/run_scheduled_task.sh`：定时任务统一执行包装
