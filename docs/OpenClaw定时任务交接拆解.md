# OpenClaw 定时任务交接拆解

更新时间：2026-05-16

## 交接原则

OpenClaw 只接管“可见采集、证据保存、receipt 回执、阻塞上报”。Codex 继续负责“证据审计、正式导入、去重、快照重建、前端同步”。

任何任务只要没有当天原始证据，就不能写 `completed`。

从 2026-05-16 起，交接方式改为“一个任务一个任务启用”：

1. Codex 是监督者和校对者。
2. OpenClaw 是采集助理。
3. 每次只启用一个新 cron。
4. 新 cron 必须先手动跑测一次。
5. Codex 校对 receipt、证据路径、状态口径和阻塞处理。
6. 当前任务连续跑通后，才启用下一个任务。
7. 不允许一次性把所有定时任务交给 OpenClaw。

## 当前启用状态

当前只启用：

```text
lenovo-watchdog-openclaw
```

已创建但保持禁用：

```text
lenovo-zhidiantong-evidence-scan
lenovo-zhidiantong-evidence-scan-2000
lenovo-quote-distributor-first
lenovo-quote-gray-first
lenovo-quote-distributor-fallback
lenovo-quote-gray-fallback
lenovo-retail-link-backfill-evidence
lenovo-competitor-monitor-evidence
```

这些禁用任务只是预制任务包和提示词，不算已交接。只有启用、跑测、校对通过后，才算完成交接。

## 交接顺序

| 优先级 | 任务 | 时间 | OpenClaw 负责 | Codex 负责 | 状态 |
|---:|---|---|---|---|---|
| 1 | 看门狗巡检 | 每 30 分钟 | 检查 OpenClaw cron、receipt 新鲜度、登录/阻塞状态并写巡检 receipt | 汇总到前端看门狗和向用户报告 | 已启用，已手动跑通 |
| 2 | 智店通证据巡检 | 10:00-20:00 每 30 分钟 | 检查已打开页面、已下载导出、截图和当天单据证据 | 12/15/19 点正式导入销售/采购/其他出库 | 待启用 |
| 3 | 报价证据采集 | 11:30/11:50/13:45/13:50 | 收集群报价、公众号报价的原始文件/截图/OCR/文本证据 | 解析分销报价和灰渠报价，写正式报价库 | 待启用 |
| 4 | 零售价补链证据 | 06:30 | 打开失效链接、备用搜索、保存候选页面证据 | 判断是否写入价格/链接主表 | 待启用 |
| 5 | 竞品监控证据 | 04:00 | 按 THINK/华硕/惠普/华为自营店铺保存前 10 证据 | 解析、计算国补价、更新英雄卡快照 | 待启用 |

## 第二批：跑测后交接

| 任务 | 原因 | 跑测标准 |
|---|---|---|
| 微信公众号全文采集 | 依赖 Chrome `https://localhost:3001/` 网页微信、公众号文章状态和 OCR 命中率 | 连续 5 次先看屏幕再点，能稳定打开目标文章并保存截图/OCR |
| 微信群文件采集 | 依赖 Chrome `https://localhost:3001/` 网页微信文件入口或 wechat-selkies 映射路径 | 连续 5 次能识别当天文件、保存路径、计算 hash |
| 智店通复杂页面点击 | 依赖登录态、页面加载和 SN 明细展开 | 连续 3 轮能保存销售/采购/其他出库证据，且不误点高风险动作 |

## 第三批：暂不交接

| 任务 | 原因 |
|---|---|
| 正式快照写入 | 必须由 Codex 调用项目 CLI 并验证 |
| SQLite 业务库写入 | 涉及库存、SN、销售、成本事实源 |
| 价格主表写入 | 需要人工/规则复核，不允许 OpenClaw 直接落库 |
| 前端 `public/data/latest-*.json` 更新 | 由 Codex 重建后统一同步 |

## Cron 命名

OpenClaw cron 固定使用以下名称：

```text
lenovo-watchdog-openclaw
lenovo-zhidiantong-evidence-scan
lenovo-quote-distributor-first
lenovo-quote-gray-first
lenovo-quote-distributor-fallback
lenovo-quote-gray-fallback
lenovo-retail-link-backfill-evidence
lenovo-competitor-monitor-evidence
```

## 回执要求

所有任务必须写：

```text
apps/inventory-sync/artifacts/manual/openclaw/receipts/
```

状态只能使用：

```text
completed
completed_with_warnings
blocked_page_risk
blocked_missing_input
executed_not_closed
failed
```

## 收口顺序

1. OpenClaw 到点执行并写 receipt。
2. Codex 执行：

   ```bash
   cd apps/inventory-sync
   node --import tsx/esm src/cli.ts build-openclaw-receipts
   ```

3. Codex 只消费 `completed / completed_with_warnings`。
4. Codex 对正式业务链执行导入、重建和验证。
5. 前端只读取 Codex 重建后的正式快照。
