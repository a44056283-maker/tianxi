# 2026-05-27 定时任务自治审计

审计时间：2026-05-27 07:49 CST

## 结论

今天剩余定时任务可以独立按点启动并写出诚实状态，但不能保证全部无人值守达到 `real_completed`。

可独立完成的任务主要是本地重建、审计、开发计划、竞品播报和已具备当天源文件的解析类任务。依赖网页微信、智店通、京东、联想官网、天猫、淘宝或联想保修页面的任务，只能独立启动、读取已有文件、刷新本地快照和生成阻塞报告；如果当天原始输入不存在、登录态失效、页面转圈、验证码、403、安全验证或需要手工下载，它们必须写 `blocked_missing_input / blocked_page_risk / executed_not_closed`，不能假完成。

## 当前执行层状态

- Codex 自动化定义：`~/.codex/automations` 下 `30` 条 `automation.toml`，当前 `30/30 ACTIVE`。
- 本地 runner：`scripts/scheduled_task_runner.py` 正在运行。
- runner 模式：`full-schedule-managed`。
- 补跑策略：`same_day_latest_slot_if_no_run`。
- 重试策略：`one_attempt_per_slot`。
- 看门狗：已停用。`latest-scheduled-task-runner-status.json` 为 `watchdogEnabled=false`。
- 已修复隐藏矛盾：`scripts/run_scheduled_task.sh` 已移除任务结束后的 `run-scheduled-task-watchdog` 调用，避免看门狗被任务入口间接执行。

## 今天已发生的任务状态

| 任务 | 今日状态 | 结论 |
| --- | --- | --- |
| `daily-jd-lenovo-price-sync` | 已按小时启动到 07:00 | 只完成编排和计划重建，仍有 `62` 条已锁定链接待真实手工复核，不能算无人值守真实采价完成。 |
| `daily-competitor-monitor-check` | 04:00 已启动，07:40 人工补齐后重跑 | 当前 `real_completed`，`expectedCompetitorCount=80`、`acceptedItemCount=80`、缺失和不完整均为 0。 |
| `daily-stale-inventory-check` | 01:00 已启动 | 当前 `real_completed`。 |
| `daily-price-channel-check` | 昨晚补跑报告仍为 `executed_not_closed` | 今天 11:30 / 13:45 还未到点；若没有当天群报价文件，只能继续写未收口或缺输入。 |
| `daily-gray-channel-check` | 昨晚补跑报告为 `blocked_missing_input` | 今天 11:50 / 13:50 还未到点；若没有当天公众号原文，只能继续阻塞，不能用 05-15 报价写成今日新采。 |
| `zhidiantong-sync-cycle` | 昨晚 23:20 收口过 2026-05-26 | 今天第一轮 11:15 还未到点；无人值守可启动，但是否 `real_completed` 取决于今天智店通导出、网页微信门禁和页面登录态。 |
| `sn-warranty-backfill` | 昨晚补跑为 `executed_not_closed` | 今天 12:20 / 15:20 / 19:20 会启动队列检查；当前规则禁止后台硬采官网保修，没手工证据就不会真实完成。 |
| `daily-development-plan-update` | 今天 13:00 未到点 | 本地文档/报告任务，可独立完成。 |
| `daily-audit-and-snapshot-rebuild` | 今天 21:30 未到点 | 本地重建任务，可独立完成，但外部采集缺口不会被它自动补齐。 |

## 今天剩余任务自治分级

### A. 可无人值守独立完成

- `daily-development-plan-update`：读取当前任务报告并更新开发计划摘要。
- `daily-audit-and-snapshot-rebuild`：重建本地快照、审计报告、前端静态数据。
- `daily-stale-inventory-check`：今天已完成，明天同类可独立跑。
- 飞书库存价播报 / 竞品播报：如果源快照存在且飞书配置可用，可以独立发送；但播报成功只代表通知发送，不代表源采集已真实完成。

### B. 可独立启动，但不能保证无人值守真实完成

- `zhidiantong-sync-cycle`：能按 11:15 到 21:45 的轮次启动；如果今天没有最新导出、网页微信门禁未覆盖、智店通登录态异常或页面转圈，只能写阻塞。
- `daily-price-channel-check`：能按 11:30 / 13:45 启动；如果没有当天群报价原始文件，只能写 `blocked_missing_input` 或 `executed_not_closed`。
- `daily-gray-channel-check`：能按 11:50 / 13:50 启动；如果没有当天公众号有效原文，只能写 `blocked_missing_input`。
- `daily-jd-lenovo-price-sync`：能每小时编排和重建计划；真实京东/联想页面复核仍依赖可见 Chrome 会话和页面状态。
- `automation-8 / 京东联想手工复核轮扫`：定义为 ACTIVE，但真实复核遇到登录、验证码、403、安全验证、白屏时必须停止并报告。
- `sn-warranty-backfill`：能构建队列和检查手工证据；当前不允许后台自动打开官网保修硬采，所以不能独立清完 64 条待补。

### C. 今天已经无需再等的任务

- `daily-competitor-monitor-check`：今天 04:00 任务已收口为 `real_completed`，今天无后续计划槽位。明天 04:00 会按新 80 条门禁继续执行。

## 主要风险

1. 外部页面任务不是纯脚本任务。无人值守时，遇到网页登录失效、验证码、403、白屏、智店通转圈、网页微信无法读取，当轮必须阻塞。
2. 分销群报价和灰渠公众号报价如果没有当天文件或原文，不会也不能伪装成今天新采。
3. `daily-jd-lenovo-price-sync` 当前小时任务能持续跑，但只是编排层；真实页面价复核仍有 62 条待处理。
4. CPU 保护仍在，超过阈值会返回 `69` 并顺延，避免 Codex 长时间高占用拖死机器。
5. Codex UI 能否显示全部自动化任务是应用界面层问题；本次审计确认的是文件定义、runner 进程、任务报告和本地执行入口。

## 本轮修复

- 修改 `scripts/run_scheduled_task.sh`：
  - 删除 `refresh_watchdog_snapshot()`。
  - 删除任务结束后的 `refresh_watchdog_snapshot` 调用。
  - 结果：后续定时任务不会再通过统一入口间接运行看门狗。

## 验证

- `find ~/.codex/automations -maxdepth 2 -name automation.toml`：30 条。
- TOML 解析：30 条均为 `ACTIVE`。
- `ps aux | rg scheduled_task_runner`：本地 runner 进程存在。
- 读取 `latest-scheduled-task-runner-status.json`：`runnerMode=full-schedule-managed`、`watchdogEnabled=false`。
- `bash -n scripts/run_scheduled_task.sh`：通过。

