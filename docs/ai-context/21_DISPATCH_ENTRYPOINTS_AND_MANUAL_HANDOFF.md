# 21 Dispatch Entrypoints And Manual Handoff

更新时间：2026-06-11

## 目标

把“任务分解规则”继续下沉成“当前真实可用的分发入口与手动交接动作”。

本文件只回答 4 件事：

1. 现在仓库里哪些分发入口真实存在
2. 哪些入口当前能用
3. 哪些入口只能归档或只读
4. `Codex` 以后如何把任务手动下发给 `GPT` 和 `OpenClaw`

本文件默认遵守：

- `docs/ai-context/20_TASK_DECOMPOSITION_AND_MODEL_ROUTING.md`
- `docs/ai-context/05_OPERATION_BOUNDARY.md`
- `docs/ai-context/17_OPENCLAW_AND_SCHEDULED_TASK_AUDIT_20260527.md`
- `docs/ai-context/22_STANDARD_TASK_CARDS_AND_DISPATCH_TABLE.md`

## 一、结论先行

当前项目内分发入口分成两类：

### 1. GPT

当前没有仓库内自动投递接口。

现阶段只能使用：

- `Codex` 先写好 `GPT 执行单`
- 再由人工把执行单投递到对应 GPT 入口
- GPT 返回结果后，再回到 `Codex` 做正式收口

也就是说：

- `GPT` 当前是“人工投递型入口”
- 不是“仓库内自动派发型入口”

### 2. OpenClaw

当前存在真实可调用的本地派发入口：

- API 派发
- command 文件链
- receipt 汇总链
- chat board 可视看板链

但仍必须遵守保守型边界：

- `OpenClaw` 只接窄任务
- `OpenClaw` 不接正式定时任务主链
- `OpenClaw` 不直接写正式业务完成状态

## 二、当前真实存在的入口

### A. OpenClaw API 入口

后端定义位置：

- `apps/api-server/app/main.py`

当前可见接口：

- `GET /api/openclaw/chat-board`
- `POST /api/openclaw/chat-board/send`
- `POST /api/openclaw/chat-board/feedback`

其中真正的派发入口是：

- `POST /api/openclaw/chat-board/send`

输入结构由 `OpenClawChatSendInput` 定义：

```text
message
title
taskName
presetKey
commandMode
sourceScope
targetDate
dateFrom
dateTo
collectionNote
```

当前语义：

- `Codex` 或前端把一条窄任务写成 command
- 后端调用 `openclaw_chat_board.dispatch_command_to_openclaw(command)`
- 成功则把 command 状态改成 `steered`
- 失败则改成 `blocked`

### B. OpenClaw command 文件链

相关代码：

- `apps/api-server/app/openclaw_chat_board.py`
- `apps/inventory-sync/src/storage/openclawCommandBoard.ts`

固定目录：

- `apps/inventory-sync/artifacts/manual/openclaw/commands/`

固定聚合快照：

- `apps/inventory-sync/artifacts/latest-openclaw-command-board.json`
- `apps/web-cockpit/public/data/latest-openclaw-command-board.json`

当前用途：

- 记录已经下发给 `OpenClaw` 的任务
- 跟踪状态：`drafted / queued / steered / acknowledged / executing / completed / blocked / cancelled`

### C. OpenClaw receipt 文件链

相关代码：

- `apps/inventory-sync/src/storage/openclawReceipts.ts`
- `docs/OpenClaw与Codex通信协议.md`

固定目录：

- `apps/inventory-sync/artifacts/manual/openclaw/receipts/`

固定聚合快照：

- `apps/inventory-sync/artifacts/latest-openclaw-collection-receipts.json`
- `apps/web-cockpit/public/data/latest-openclaw-collection-receipts.json`

当前用途：

- 收集 `OpenClaw` 回传的 receipt
- 给 `Codex` 判断：
  - 有没有新证据
  - 有没有阻塞
  - 有没有需要继续导入的结构化产物

### D. OpenClaw chat board 看板

相关代码：

- `apps/api-server/app/openclaw_chat_board.py`
- `apps/web-cockpit/src/domain/inventoryQuote/service.ts`

固定快照：

- `latest-openclaw-chat-board.json`

当前用途：

- 显示指令、反馈、回执与 session 片段
- 方便人看，不等于正式业务真值

## 三、当前已实测可用的入口

### OpenClaw 本机入口

本轮已实测：

- `bash scripts/check-openclaw.sh`

结果：

- `LaunchAgent` 已加载
- `gateway` 健康检查通过
- `OpenClaw` 当前模型配置可读

说明：

- 当前本机 `OpenClaw` 不是假入口
- 至少“状态检查、gateway、配置读取”这条本地链是真能工作的

### 包装脚本入口

脚本：

- `scripts/openclaw_env.sh`
- `scripts/check-openclaw.sh`

作用：

- `openclaw_env.sh` 负责寻找 OpenClaw 可执行文件并加载项目 `.env`
- `check-openclaw.sh` 负责做 daemon / gateway / models 最小探活

## 四、当前只能保留为人工投递的入口

### GPT 入口

当前仓库内没有以下能力：

- 没有 `POST /api/gpt/dispatch`
- 没有 `gpt command board`
- 没有 `gpt receipt snapshot`
- 没有自动回收 GPT 结果的项目内协议

所以当前 `GPT` 只能采用：

1. `Codex` 生成 `GPT 执行单`
2. 人工复制到 GPT 对话入口
3. GPT 返回结果
4. 人工把结果贴回或整理回仓库
5. `Codex` 审核与收口

这条链现在是可执行的，但不是自动化链。

## 五、当前不建议作为正式主链的入口

虽然以下入口存在，但不能误认为“正式任务已经交给 OpenClaw 接管”：

- 前端里的 `OpenClaw 对话式协作台`
- `发送到 OpenClaw`
- `发送历史采集`
- `latest-openclaw-chat-board.json`
- `latest-openclaw-command-board.json`
- `latest-openclaw-collection-receipts.json`

原因：

1. 这些入口当前更适合“副驾驶任务派发和回执”
2. 不代表正式 SQL / 快照 / 前端同步已经交给 `OpenClaw`
3. 仍必须遵守 `17_OPENCLAW_AND_SCHEDULED_TASK_AUDIT_20260527.md` 的保守边界

## 六、推荐的手动分发动作

### 场景 1：派给 GPT

适用：

- 公开资料补料
- 文本归纳
- 规则草稿
- 候选对比整理

固定动作：

1. `Codex` 先写一级拆解卡片
2. 生成 `GPT 执行单`
3. 人工投递到 GPT
4. 收回结果
5. `Codex` 审核是否可用
6. 可用则并入正式任务链

禁止：

- 不允许让 GPT 直接宣称本地系统已同步完成
- 不允许让 GPT 直接代替真实页面核验

### 场景 2：派给 OpenClaw

适用：

- receipt 级证据采集
- 状态巡检
- 阻塞上报
- command/receipt 看板协作

固定动作：

1. `Codex` 先写一级拆解卡片
2. 生成 `OpenClaw 执行单`
3. 通过 `POST /api/openclaw/chat-board/send` 派发
4. 等待 `command` 状态变化
5. 回读 `receipt` 汇总
6. `Codex` 决定是否继续导入或判阻塞

禁止：

- 不允许直接把正式定时任务整包交给 `OpenClaw`
- 不允许把 command 已发出写成“业务已完成”

## 七、OpenClaw 手动派发最小模板

当后端 `8000` 可用时，推荐用下面这类 payload：

```json
{
  "message": "这里填写 OpenClaw 执行单正文",
  "title": "OpenClaw 窄任务标题",
  "taskName": "manual-openclaw-task",
  "commandMode": "manual-dispatch",
  "sourceScope": "codex",
  "collectionNote": "由 Codex 按保守型规则手动下发"
}
```

推荐 `curl` 形式：

```bash
curl -sS \
  -X POST http://127.0.0.1:8000/api/openclaw/chat-board/send \
  -H 'content-type: application/json' \
  -d '{
    "message": "这里填写 OpenClaw 执行单正文",
    "title": "OpenClaw 窄任务标题",
    "taskName": "manual-openclaw-task",
    "commandMode": "manual-dispatch",
    "sourceScope": "codex",
    "collectionNote": "由 Codex 按保守型规则手动下发"
  }'
```

注意：

- 只有在 `api-server` 正常运行时才使用这条命令
- 派发前必须先确认任务符合 `OpenClaw` 边界

## 八、Codex 回收 OpenClaw 结果的固定动作

推荐固定顺序：

1. 看 command 状态
2. 看 receipt 是否落盘
3. 看 receipt 聚合快照
4. 判断是否需要继续导入或阻塞上报

常用文件：

- `apps/inventory-sync/artifacts/latest-openclaw-command-board.json`
- `apps/inventory-sync/artifacts/latest-openclaw-collection-receipts.json`

必要时重建：

```bash
cd apps/inventory-sync
node --import tsx/esm src/cli.ts build-openclaw-command-board
node --import tsx/esm src/cli.ts build-openclaw-receipts
```

## 九、当前推荐执行姿势

以后真实工作默认按下面顺序：

1. `Codex` 做一级拆解
2. 判断子任务是否属于：
   - `GPT 补料`
   - `OpenClaw 副驾驶`
   - `Codex 自己做`
3. 生成执行单
4. 派发或自行执行
5. 回收产物
6. 统一由 `Codex` 收口

## 十、下一步最适合做什么

下一轮最适合做的是：

1. 选一个真实任务
2. 当场填一张一级拆解卡片
3. 当场生成：
   - `GPT 执行单`
   - 或 `OpenClaw 执行单`
4. 跑第一轮真实分发演示

不要下一轮又退回抽象讨论。
