# 2026-05-14 销售同步审计

审计范围：`2026-05-01` 至 `2026-05-14`

## 当前销售导入链路实际使用的原始文件/快照

1. 销售拆分导入：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sales-export-2026-05-13.xlsx`
2. 库存流水统一导入：
   - `/Users/luxiangnan/Downloads/stock_count2026-05-14.xlsx`
   - `/Users/luxiangnan/Downloads/stock_count2026-05-14 (1).xlsx`
3. 历史对照快照：
   - `apps/inventory-sync/artifacts/2026-05-12-zhidiantong-sales-outbound-import.json`
4. 当前本地/前端使用中的销售流水：
   - `apps/inventory-sync/artifacts/latest-inventory-movements.json`
   - `apps/web-cockpit/public/data/latest-inventory-movements.json`
5. 本轮新增的审计报告：
   - `apps/inventory-sync/artifacts/latest-sales-sync-audit.json`
   - `apps/web-cockpit/public/data/latest-sales-sync-audit.json`

## 审计结论

- 现存原始文件不足以证明 `2026-05-01` 至 `2026-05-14` 全时段销售与智店通一致。
- 当前本地销售流水仅有：
  - `2026-05-12`: 18 条
  - `2026-05-13`: 1 条
- 当前唯一的销售导出文件 `zhidiantong-sales-export-2026-05-13.xlsx` 只覆盖 `2026-05-13` 1 个订单，且文件没有显式日期列。
- 当前库存流水导出 `stock_count2026-05-14*.xlsx` 在目标时段内没有销售出库行，只有 1 条 `2026-05-14` 入库。
- 历史导入快照 `2026-05-12-zhidiantong-sales-outbound-import.json` 中有 7 条 `2026-05-11` 销售；这些相同订单在当前 `latest-inventory-movements.json` 中被记成了 `2026-05-12`，说明本地最新销售流水存在日期漂移。

## 逐日一致性差异摘要

| 日期 | 本地销售 | 历史销售快照 | 原始证据 | 状态 |
| --- | ---: | ---: | --- | --- |
| 2026-05-01 | 0 | 0 | 无 | 缺证据 |
| 2026-05-02 | 0 | 0 | 无 | 缺证据 |
| 2026-05-03 | 0 | 0 | 无 | 缺证据 |
| 2026-05-04 | 0 | 0 | 无 | 缺证据 |
| 2026-05-05 | 0 | 0 | 无 | 缺证据 |
| 2026-05-06 | 0 | 0 | 无 | 缺证据 |
| 2026-05-07 | 0 | 0 | 无 | 缺证据 |
| 2026-05-08 | 0 | 0 | 无 | 缺证据 |
| 2026-05-09 | 0 | 0 | 无 | 缺证据 |
| 2026-05-10 | 0 | 0 | 无 | 缺证据 |
| 2026-05-11 | 0 | 7 | 无 | 缺证据，且历史快照显示有销售 |
| 2026-05-12 | 18 | 0 | 无 | 仅本地有销售，缺第三方原始证据 |
| 2026-05-13 | 1 | 0 | `zhidiantong-sales-export-2026-05-13.xlsx` 2 行 | 已覆盖 |
| 2026-05-14 | 0 | 0 | `stock_count2026-05-14*.xlsx` 只有入库，无销售 | 缺证据 |

明确缺证据日期：

- `2026-05-01`
- `2026-05-02`
- `2026-05-03`
- `2026-05-04`
- `2026-05-05`
- `2026-05-06`
- `2026-05-07`
- `2026-05-08`
- `2026-05-09`
- `2026-05-10`
- `2026-05-11`
- `2026-05-12`
- `2026-05-14`

## 已做的最小补齐

1. `zhidiantongSalesExportImporter.ts`
   - 销售导出缺少日期列时，按以下顺序推断业务日期：
     - 文件内日期列
     - 订单号 `XSYYMMDD...`
     - 文件名 `YYYY-MM-DD`
2. `zhidiantongSalesSyncAudit.ts`
   - 新增可重复执行的销售同步审计命令，直接输出：
     - 发现了哪些原始文件
     - 各文件覆盖了哪些日期
     - 当前本地销售流水日期分布
     - 历史快照与当前流水的日期漂移
     - `2026-05-01` 到 `2026-05-14` 的逐日证据状态
     - 可重跑命令与缺口
   - 审计结果会同时写入 artifacts 和 web public data
3. `inventoryMasterMerge.ts`
   - `latest-inventory-master-snapshot.json` 新增 `salesAuditSummary`
   - 让 inventory master 直接暴露：
     - 销售一致性状态
     - 缺证据日期
     - 本地/历史销售按天分布
     - 逐日状态摘要

## 可重跑命令

```bash
cd apps/inventory-sync
node --import tsx/esm src/cli.ts audit-zhidiantong-sales-sync 2026-05-01 2026-05-14
node --import tsx/esm src/cli.ts import-zhidiantong-sales-export "./artifacts/manual/zhidiantong-sales-export-2026-05-13.xlsx"
node --import tsx/esm src/cli.ts import-zhidiantong-stock-stream "/Users/luxiangnan/Downloads/stock_count2026-05-14.xlsx"
```

## 仍然缺的原始证据

- 缺少能覆盖 `2026-05-01` 至 `2026-05-14` 全区间的智店通销售原始导出。
- 如果继续采用拆分导入，至少要补齐对应日期的销售导出文件。
- 如果采用统一库存流水导入，需要补齐包含销售出库行的库存流水总表，而不是只有单条入库的 `stock_count2026-05-14*.xlsx`。
