# 日终审计与快照重建

中文任务名：日终审计与快照重建  
taskName：`daily-audit-and-snapshot-rebuild`

## 任务定位

只做当天已确认数据的统一收口。

不允许把上游阻塞任务包装成完成。

## 原始输入

放到：

- `原始输入/`

上游证据来自当天已确认的：

- 报价快照
- 库存快照
- SN 快照
- 任务报告

## 固定执行顺序

1. 执行：
   - `bash scripts/run_scheduled_task.sh daily-audit-and-snapshot-rebuild`
2. 读取报告
3. 核查：
   - `frontendRefreshed`
   - `updatedRecordCount`
   - 相关快照是否已刷新

## 成功标准

- 只收口当天已确认数据
- 不把上游阻塞伪装成完成
- 能说明哪些快照已刷新

## 回执

回执写到：

- `运行回执/YYYY-MM-DD-日终审计与快照重建.md`

阻塞写到：

- `阻塞记录/YYYY-MM-DD-日终审计与快照重建.md`

