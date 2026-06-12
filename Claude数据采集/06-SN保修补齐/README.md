# SN保修补齐

中文任务名：SN保修补齐  
taskName：`sn-warranty-backfill`

## 任务定位

这是缺口补齐任务，不是全量重采任务。

本任务只处理两类 SN：

1. 当天新入库、首次进入质保队列的 SN
2. 前端当前仍不显示质保时间的待补 SN

## 原始输入

放到：

- `原始输入/`

固定查看：

- `apps/inventory-sync/artifacts/latest-warranty-check-queue.json`
- `apps/inventory-sync/artifacts/latest-lenovo-warranty-snapshot.json`

## 固定执行顺序

1. 确认联想保修查询页已登录、可操作
2. 读取待补队列
3. 判断待补原因
4. 执行：
   - `bash scripts/run_scheduled_task.sh sn-warranty-backfill`
5. 核查：
   - 已采成功 SN 是否被排除出待补队列
   - 已有质保时间是否保留下来
   - 失败或验证码记录是否只保留为待补

## 成功标准

- 能区分全量重采和缺口补齐
- 能解释为什么某个 SN 仍在队列里
- 已采成功 SN 不再回到队列
- 已有质保起止时间不会被空结果覆盖

## 回执

回执写到：

- `运行回执/YYYY-MM-DD-SN保修补齐.md`

阻塞写到：

- `阻塞记录/YYYY-MM-DD-SN保修补齐.md`

