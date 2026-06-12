# 18 Collection Prompt Audit 2026-05-28

## 结论

- 本轮不是继续叠加红线，而是把所有当前会执行的定时任务 prompt 做了一次规则瘦身和入口纠偏。
- 30 个 `~/.codex/automations/*/automation.toml` 已统一继承新的流程型全局固化提示词。
- 灰渠公众号午前/午后任务已统一为文件传输助手聊天记录区固定公众号入口，不再使用收藏夹采集流程。
- 旧灰渠收藏夹动作语句已从当前生效 prompt 和当前规则入口中清除。

## 审计范围

- `~/.codex/automations/*/automation.toml`
- `docs/ai-context/16_SCHEDULED_COLLECTION_RULE_PROMPT.md`
- `docs/ai-context/02_DECISIONS.md`
- `docs/ai-context/07_BROWSER_WORKFLOW.md`
- `docs/ai-context/13_SCHEDULED_TASK_SOPS.md`
- `docs/ai-context/01_CURRENT_STATE.md`
- `docs/ai-context/03_TASK_LOG.md`
- `docs/ai-context/09_CODEX_HANDOFF.md`
- `apps/inventory-sync/src/storage/grayChannelCollector.ts`

## 已清理的旧口径

- 灰渠公众号从收藏夹、收藏/方块入口、全部收藏进入。
- 用收藏夹旧卡片判断当天无原文。
- 午后灰渠任务继续使用收藏夹路径。
- 全局固化 prompt 过长、重复、以堆禁止项代替流程执行。

## 当前统一流程

1. 先读 `AGENTS.md / 07_BROWSER_WORKFLOW / 12_EXECUTION_CORE / 13_SCHEDULED_TASK_SOPS`。
2. 外部采集只使用当前已登录 Chrome 可见会话。
3. 先扫描页面状态，再执行一个手工单步动作，再扫描状态。
4. 按任务类型进入固定来源入口：
   - 智店通：`https://retail-pos.lenovo.com/`
   - 网页微信：`https://localhost:3001/`
   - 灰渠公众号：文件传输助手聊天记录区下面固定公众号入口
   - 分销报价：目标群聊或 Selkies 已落地当天文件
   - 京东/联想/天猫/保修：当前已登录 Chrome 低频可见页面
5. 采集结果必须走 `证据/原始记录 -> SQL 或受控 SQL 快照 -> API/快照刷新 -> 前端 UI 可见验收`。
6. 缺当天原始输入、缺 SQL/API、缺前端 UI 验收、SN/代扫未闭环时，不能写 `real_completed`。

## 验证

- 30 个 automation TOML 全部可被 `tomllib` 解析。
- 30 个 automation prompt 全部包含新的全局固化提示词。
- 当前 automation prompt 中没有 `单步点击收藏/方块入口`、`只打开收藏夹`、`是否进入收藏夹` 等旧动作语句。
- `cd apps/inventory-sync && npm run build` 通过。

## 公众号流程复审补充

- 当前公众号采集是两段式入口：
  1. Chrome 已登录 `https://localhost:3001/` 网页微信。
  2. `文件传输助手` 聊天记录区下面固定公众号入口。
  3. 进入公众号后再点公众号底部菜单日期报价按钮或当天原文入口。
- `automation-5` 午前和 `automation-6` 午后均已确认包含文件传输助手入口、固定公众号入口、`daily-gray-channel-check` 同步和前端可见审计。
- `apps/inventory-sync/src/storage/grayChannelCollector.ts` 已把 `entryPoint` 从单独的“公众号底部日期报价按钮”补成“文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部日期报价按钮”，避免后续误解为可跳过文件传输助手。
