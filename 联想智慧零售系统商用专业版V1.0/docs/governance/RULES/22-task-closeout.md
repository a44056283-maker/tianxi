# 任务收口规范

## 允许状态

- real_completed
- executed_not_closed
- blocked_missing_input
- blocked_page_risk
- execution_failed_noop

## real_completed 门槛

同时满足：

1. 真实证据存在。
2. SQL 或受控快照已写入。
3. API 返回正确。
4. 前端真实页面可见。
5. 验收报告写清结果。

缺任一项只能是 executed_not_closed 或 blocked。

