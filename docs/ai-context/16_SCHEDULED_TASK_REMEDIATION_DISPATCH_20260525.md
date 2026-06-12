# 2026-05-25 定时任务执行力整改派工单

## 本轮结论

- 本轮不是只审计，已把整改规则写入 31 个 ACTIVE 自动化提示词，并同步写入项目执行文档。
- `daily-jd-lenovo-price-sync` 已补跑正式任务报告，当前不再是漏跑，而是明确的 `executed_not_closed`。
- 当前 watchdog：`missedCount = 0`，`attentionCount = 1`，唯一关注项是价格同步仍需真实 Chrome 可见复核。

## 已下发的子智能体任务

- Dewey：只读复核所有 ACTIVE 自动化是否包含 `execution_failed_noop`、可见 Chrome 执行、规格点击门禁。
- Rawls：只读复核 `latest-scheduled-task-reports.json`、`latest-scheduled-task-watchdog.json`、`latest-scheduled-task-dashboard.json`，列出未同步/漏跑/空转任务。
- Wegener：从 `latest-semi-auto-execution-plan.json` 和 `latest-product-url-locks.json` 中挑出最应立即复核的 8 个 SKU，输出需要点击/切换的规格点。
- Bernoulli：检查 2026-05-25 分销群报价、灰渠公众号窗口准备和 Selkies 当天输入状态。
- Fermat：审计 `latest-scheduled-task-dashboard.json` 为什么任务列表为空，给出最小修复建议。
- Nash：复核 `12_EXECUTION_CORE.md`、`13_SCHEDULED_TASK_SOPS.md`、`15_SUBAGENT_EXECUTION_PLAYBOOK.md` 的规则覆盖率。

## 已落地规则

- 所有 ACTIVE 自动化都已包含执行产物门禁：没有新正式报告、新手工批次/证据、新阻塞证据三者之一时，必须写 `execution_failed_noop`。
- 所有 ACTIVE 自动化都已包含可见执行门禁：外部网页证据必须复用当前 Chrome 登录态低频手工执行。
- 价格、报价、竞品、国补相关自动化已包含规格点击门禁：未点击/切换规格并记录选中态时，禁止判定“无同配”。

## 已补跑任务

- 命令：`bash scripts/run_scheduled_task.sh daily-jd-lenovo-price-sync`
- 结果：通过，业务状态为 `executed_not_closed`。
- 当前缺口：
  - `retailPriceVerificationCount = 57`
  - `retailLinkBackfillCount = 1`
  - `newStockImmediateClosureCount = 1`
  - 阻塞原因：`任务1未收口：1 个新入库SKU缺详情页或零售价，1 条缺链`

## 已同步状态

- 命令：`bash scripts/run_scheduled_task_watchdog.sh`
- 结果：通过。
- 当前 watchdog：
  - `missedCount = 0`
  - `attentionCount = 1`
  - `pendingCount = 10`
  - `notify = false`

## 下一步执行顺序

1. 按 Wegener 输出的前 8 个 SKU，在当前 Chrome 登录态中真实打开链接、点击/切换规格、记录选中态证据。
2. 形成新的手工价格批次文件。
3. 再运行 `bash scripts/run_scheduled_task.sh daily-jd-lenovo-price-sync`。
4. 再运行 `bash scripts/run_scheduled_task_watchdog.sh`。
5. 前端 `http://127.0.0.1:5174/` 对应报价/库存子书签做可见审计。
