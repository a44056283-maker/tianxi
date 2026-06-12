# 11 Memory System

更新时间：2026-05-13

## 目标

把 Codex 自动压缩无法关闭的问题，转化为项目内可恢复的长期记忆流程。长期记忆只保存项目规则、业务决策、任务状态、代码结构、测试记录和交接说明，不保存账号会话、Cookie、Token、验证码、密码或第三方登录态。

## 固定入口

每次新会话、上下文压缩后恢复、或子代理接手时，按以下顺序读取：

1. `AGENTS.md`
2. `docs/ai-context/00_PROJECT_BRIEF.md`
3. `docs/ai-context/01_CURRENT_STATE.md`
4. `docs/ai-context/02_DECISIONS.md`
5. `docs/ai-context/04_NEXT_ACTIONS.md`
6. `docs/ai-context/05_OPERATION_BOUNDARY.md`
7. `docs/ai-context/07_BROWSER_WORKFLOW.md`
8. `docs/ai-context/09_CODEX_HANDOFF.md`
9. `docs/ai-context/10_TEST_LOG.md`
10. `docs/ai-context/12_EXECUTION_CORE.md`
11. `docs/ai-context/latest-snapshot.md`

快捷命令：

```bash
bash scripts/context_bootstrap.sh
```

## 每轮开始

1. 执行 `bash scripts/context_bootstrap.sh` 或手工读取固定入口。
2. 执行 `git status --short`。
3. 明确本轮只做什么、不做什么、预计会改哪些文件。
4. 如果任务涉及第三方网页，重新确认 `05_OPERATION_BOUNDARY.md` 与 `07_BROWSER_WORKFLOW.md`。
5. 本轮执行方式必须同时遵守 `12_EXECUTION_CORE.md`，尤其是：
   - 不虚报实时状态
   - 修改前先列文件
   - 结束后更新记忆与交接

## 每轮结束

1. 更新 `01_CURRENT_STATE.md`。
2. 更新 `03_TASK_LOG.md`。
3. 更新 `04_NEXT_ACTIONS.md`。
4. 更新 `09_CODEX_HANDOFF.md`。
5. 更新 `10_TEST_LOG.md`。
6. 如有新决策，更新 `02_DECISIONS.md`。
7. 运行：

```bash
bash scripts/context_pack.sh
python3 scripts/context_snapshot.py
```

## 固定产物

- `docs/ai-context/latest-snapshot.md`：最近一次轻量文本快照。
- `docs/ai-context/latest-package-path.txt`：最近一次上下文包路径。
- `docs/ai-context/packages/smart-retail-context-YYYYMMDD-HHMM.zip`：可交接上下文包。
- `docs/ai-context/snapshots/snapshot-YYYYMMDD-HHMM.md`：历史轻量快照。

## GitHub / MCP 方案原则

可以后续评估本地优先的 MCP 记忆项目，例如 `memento-mcp`。在正式接入前必须满足：

- 本地存储优先。
- 不需要外部 API Key。
- 不保存账号会话或第三方登录态。
- 能明确排除 Cookie、Token、Session、Authorization、密码、验证码。
- 记忆内容可审计，可纳入 Git 或本地备份。

当前默认方案仍是仓库内 Markdown + JSON 快照 + 上下文 zip，不依赖外部服务。
