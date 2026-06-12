# OpenClaw 与 Codex 通信协议

更新时间：2026-05-16

## 结论

OpenClaw 不直接“喊”Codex，也不直接写正式业务数据。双方通过本地文件通信：

```text
OpenClaw 采集证据 -> 写 receipt JSON -> Codex 汇总 receipt -> Codex 校对并导入 -> 前端展示
```

这条链路的核心是 receipt。没有 receipt，就等于 OpenClaw 没有向 Codex 交付。

## 通信通道

### 1. OpenClaw 写入

OpenClaw 每次任务结束必须写一个 receipt：

```text
apps/inventory-sync/artifacts/manual/openclaw/receipts/<task-name>-YYYY-MM-DD-HHmm.json
```

原始证据按任务写到：

```text
apps/inventory-sync/artifacts/manual/openclaw/<task-category>/YYYY-MM-DD/
```

### 2. Codex 收件

Codex 执行：

```bash
cd apps/inventory-sync
node --import tsx/esm src/cli.ts build-openclaw-receipts
```

生成统一收件箱：

```text
apps/inventory-sync/artifacts/latest-openclaw-collection-receipts.json
apps/web-cockpit/public/data/latest-openclaw-collection-receipts.json
```

Codex 只看这个统一收件箱判断：

1. OpenClaw 有没有采集。
2. OpenClaw 最新采集时间。
3. 哪些任务有新证据待导入。
4. 哪些任务阻塞需要用户处理。
5. 哪些任务只是看门狗巡检，不需要导入。

## Receipt 必填字段

```json
{
  "receiptId": "task-name-YYYY-MM-DD-HHmm",
  "taskName": "task-name",
  "taskCategory": "category",
  "status": "completed",
  "capturedAt": "ISO time",
  "sourceSystem": "source",
  "sourceWindow": "optional time window",
  "rawEvidencePaths": [],
  "structuredOutputPaths": [],
  "dedupeKeys": [],
  "recordCount": 0,
  "manualActionRequired": false,
  "blockingReason": null,
  "codexActionRequired": false,
  "codexAction": null,
  "notes": []
}
```

## 状态语义

| status | 含义 | Codex 动作 |
|---|---|---|
| `completed` | OpenClaw 已完成采集或巡检 | 如果 `codexActionRequired=true` 或 `recordCount>0`，进入 Codex 待处理 |
| `completed_with_warnings` | 有证据但存在小问题 | Codex 先审计再决定是否导入 |
| `blocked_missing_input` | 缺少当天原始输入 | 不导入，等待用户或下一轮 |
| `blocked_page_risk` | 登录、白屏、403、验证码、安全验证 | 立即提醒用户手动处理 |
| `executed_not_closed` | 执行过但未形成可用结果 | Codex 审计任务日志，不导入 |
| `failed` | 任务失败 | Codex 查看失败原因，必要时修复任务 |

## Codex 如何知道有新信息

Codex 不靠猜，按以下判断：

1. `latest-openclaw-collection-receipts.json.generatedAt` 更新了，说明收件箱刚汇总过。
2. `latestCapturedAt` 更新了，说明 OpenClaw 有新的 receipt。
3. `readyForCodex` 非空，说明有新证据需要 Codex 处理。
4. `unresolved` 非空，说明有阻塞或未收口。
5. `manualActionRequired` 非空，说明需要用户介入，比如登录、验证码、页面白屏。

## Codex 消费顺序

1. 运行 `build-openclaw-receipts`。
2. 读取 `readyForCodex`。
3. 按任务类型分派：
   - `zhidiantong` -> 智店通导入器
   - `quotes` -> 群报价/灰渠报价解析器
   - `competitor` -> 竞品监控解析器
   - `retail-link-backfill` -> 人工价格补充批次
4. 核对 `rawEvidencePaths` 与 `structuredOutputPaths` 文件是否真实存在。
5. 核对 `dedupeKeys`，避免重复导入。
6. 正式导入并重建快照。
7. 把处理结果写入项目日志。

## OpenClaw 不允许直接做的事

1. 不写正式 `latest-*.json`。
2. 不写 SQLite。
3. 不修改库存、SN、成本、价格主表。
4. 不直接告诉用户“系统已同步完成”。

OpenClaw 只能说：

```text
我已采集证据并写入 receipt。
```

正式同步完成只能由 Codex 在导入、重建、验证后确认。

