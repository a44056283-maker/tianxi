# 17 OpenClaw And Scheduled Task Audit 20260527

更新时间：2026-05-27

## 结论

1. 当前 30 个 Codex 自动化定义已全部加载到 `~/.codex/automations/*/automation.toml`，且每个任务提示词都包含全局采集固化规则。
2. 当前 30 个自动化提示词里没有 `OpenClaw` 字样，不存在“自动化提示词直接把正式定时任务派给 OpenClaw”的问题。
3. 仓库、API、前端和本机进程里仍存在 OpenClaw 历史接入残留。这些残留不应再参与正式定时任务，但会造成误导或被人工/智能体误点后重新派发。
4. 当前定时任务执行状态并非全部真实闭环：价格复核、智店通订单闭环、保修补齐仍有 `executed_not_closed` 或 `completed_with_warnings` 缺口。
5. 触发可靠性方面存在一个明确风险：`.automation-runtime/scheduled-task-runner.lock` 仍存在；历史触发记录里出现过 exit code `75`，原因是 `.scheduled-task.lock` 抢占。

## 30 个自动化定义审计

检查范围：

- `../automation_payloads.json`
- `~/.codex/automations/*/automation.toml`

检查项：

- 是否包含全局固化提示词。
- 是否强制使用当前已登录默认 Chrome。
- 是否禁止新浏览器、空白浏览器、新 Profile、清理登录缓存。
- 是否禁止 Browser/in-app browser/browser-use/Playwright/Puppeteer/Chromium launch 用于外部采集。
- 是否包含网页微信图片左箭头/键盘左键逐张核验规则。
- 是否包含 SQL 主链写入和前端 UI 可见验收。
- 是否混入 OpenClaw。

结果：

- `automation_payloads.json`：30 条任务定义。
- `~/.codex/automations/*/automation.toml`：30 个有效任务定义。
- 缺规则任务数：0。
- 混入 OpenClaw 的任务提示词数：0。

当前 30 个任务：

1. `11-15` 同步智店通进销存与库存SN（11:15）
2. `12` 同步智店通进销存与库存SN（12:00）
3. `12-45` 同步智店通进销存与库存SN（12:45）
4. `13-30` 同步智店通进销存与库存SN（13:30）
5. `14-15` 同步智店通进销存与库存SN（14:15）
6. `15` 同步智店通进销存与库存SN（15:00）
7. `15-45` 同步智店通进销存与库存SN（15:45）
8. `16-30` 同步智店通进销存与库存SN（16:30）
9. `17-15` 同步智店通进销存与库存SN（17:15）
10. `18-00` 同步智店通进销存与库存SN（18:00）
11. `180` 巡检180天陈旧库存预警
12. `19` 同步智店通进销存与库存SN（18:45）
13. `19-30` 同步智店通进销存与库存SN（19:30）
14. `20-15` 同步智店通进销存与库存SN（20:15）
15. `21-00` 同步智店通进销存与库存SN（21:00）
16. `21-45` 同步智店通进销存与库存SN（21:45）
17. `4` 采集京东自营竞品TOP排行
18. `automation` 更新联想智慧零售开发计划
19. `automation-10` 发送竞品排行飞书播报
20. `automation-2` 编排京东联想零售价同步
21. `automation-3` 采集分销商群报价（上午）
22. `automation-4` 补查分销商群报价（中午）
23. `automation-5` 采集灰渠公众号报价（午前）
24. `automation-6` 补查灰渠公众号报价（午后）
25. `automation-7` 执行每日审计与快照重建
26. `automation-8` 手工复核京东联想零售价
27. `automation-9` 发送库存零售价国补价播报
28. `sn` 补齐SN保修信息（12:20）
29. `sn-15` 补齐SN保修信息（15:20）
30. `sn-19` 补齐SN保修信息（19:20）

## OpenClaw 残留入口

这些入口必须视为历史/隔离层，不能再作为正式定时任务执行器。

### 本机进程与 LaunchAgent

- `launchctl list` 仍显示 `ai.openclaw.gateway` 正在运行。
- `ps aux` 仍显示 `~/.local/opt/node-v24.15.0/bin/node ... openclaw/dist/index.js gateway --port 18789`。

风险：

- 只要前端或 API 仍能向 OpenClaw gateway 派发指令，就可能重新造成“定时任务被误认为交给 OpenClaw 执行”的混乱。

### API 派发入口

- `apps/api-server/app/main.py`
  - `GET /api/openclaw/chat-board`
  - `POST /api/openclaw/chat-board/send`
  - `POST /api/openclaw/chat-board/feedback`
- `apps/api-server/app/openclaw_chat_board.py`
  - 仍会读取 `.openclaw` 会话注册表。
  - 仍可通过 `scripts/openclaw_env.sh` 调用 OpenClaw gateway。
  - 仍维护 `pendingForOpenClaw`、`pendingForCodex`、回执、指令和聊天记录。

风险：

- API 层仍具备向 OpenClaw 派发命令的能力；这不是定时任务主链，但会干扰操作边界。

### 前端 UI 派发入口

- `apps/web-cockpit/src/App.tsx`
  - 仍有 `OpenClaw 对话式协作台`。
  - 仍有 `发送到 OpenClaw`、`发送历史采集` 等按钮。
  - 仍展示 `待 OpenClaw`、`OpenClaw 回推给我的待办`。
- `apps/web-cockpit/src/domain/inventoryQuote/service.ts`
  - 仍有 OpenClaw 类型、快照读取和 `/api/openclaw/chat-board/send` 调用。

风险：

- 前端会给使用者和智能体造成误解，以为 OpenClaw 仍是采集链路的一部分。

### CLI 和快照入口

- `apps/inventory-sync/src/cli.ts`
  - `build-openclaw-receipts`
  - `build-openclaw-command-board`
- `apps/inventory-sync/src/storage/openclawReceipts.ts`
- `apps/inventory-sync/src/storage/openclawCommandBoard.ts`
- `apps/web-cockpit/public/data/latest-openclaw-*.json`
- `apps/inventory-sync/artifacts/latest-openclaw-*.json`

风险：

- 这些入口当前主要是历史回执/指令看板构建，不会自动采集，但名称和产物会误导任务归属。

### 脚本和文档入口

- `scripts/openclaw_env.sh`
- `scripts/openclaw_healthcheck.sh`
- `scripts/start-openclaw.sh`
- `scripts/check-openclaw.sh`
- `docs/OpenClaw*.md`
- `docs/openclaw-tasks/`
- `docs/ai-context/05_OPERATION_BOUNDARY.md`
- `docs/ai-context/13_SCHEDULED_TASK_SOPS.md` 仍有 2026-05-17 OpenClaw 练习门槛旧段落。

风险：

- 文档层同时存在“OpenClaw 练习/证据层”和“正式任务不依赖 OpenClaw”两套历史口径；需要收敛成“仅历史归档，不参与正式定时任务”。

## 第三方/插件/子代理干预风险

### 已被提示词禁止的采集路径

`apps/inventory-sync/src/cli.ts` 已将以下外部网页采集命令封禁为 `blocked_page_risk`：

- `login`
- `probe`
- `capture-zhidiantong-session`
- `collect-browser-marketplace-prices`
- `collect-lenovo-official-prices`
- `collect-chrome-jd-retail`
- `collect-retail-sites`
- `collect-lenovo-warranty`
- `repair-lenovo-browser-cache --clear-login`

这些命令当前不会直接打开外部页面做采集，符合“外部采集只能使用已登录 Chrome 可见会话”的边界。

### 仍需警惕的工具

- Codex Chrome Extension 当前存在并运行。
- Computer Use MCP 进程较多，可能来自多轮会话残留。
- OpenClaw gateway 当前仍运行。
- WeChat Selkies LaunchAgent 当前存在。
- Codex automation runner 当前存在。

要求：

- 外部采集只能通过当前已登录默认 Chrome 的可见页面操作。
- Browser/in-app browser/browser-use 只能用于本地前端 UI 验证。
- Playwright/Puppeteer/Chromium launch/CDP 不得用于智店通、网页微信、京东、联想官网、天猫、淘宝、保修页采集。
- 子代理只能审计、归纳、整理或执行明确工位，不得私自接管外部网页采集。

## 当前任务收口缺口

`apps/inventory-sync/artifacts/latest-scheduled-task-reports.json` 当前只记录 12 类业务任务状态，不是 30 个自动化槽位逐条验收表。

仍未真实闭环的关键项：

- `daily-jd-lenovo-price-sync`：`completed_with_warnings`，仍有已锁定链接待真实手工复核。
- `zhidiantong-sync-cycle`：`completed_with_warnings`，订单闭环仍缺 1 笔。
- `sn-warranty-backfill`：`completed_with_warnings`，保修队列剩余 64 条，缺当天手工保修证据。
- `daily-gray-channel-check`：`completed_with_warnings`，缺当天有效灰渠原文，沿用最后一次有效原文。
- `daily-competitor-monitor-check`：最近业务报告时间仍是 2026-05-26，不足以证明 2026-05-27 当天真实闭环。

## 触发与锁风险

- `.automation-runtime/scheduled-task-runner-state.json` 显示 2026-05-27 已执行多轮定时槽位。
- `.automation-runtime/scheduled-task-runner.lock` 当前存在。
- 历史运行记录里出现：
  - `zhidiantong-sync-cycle@2026-05-27Tfile-1804`
  - `exitCode: 75`
  - 原因：`.scheduled-task.lock` 被其它任务占用。

判断：

- 自动化不是完全没触发。
- 但多个任务靠同一把 `.scheduled-task.lock` 串行，若手动文件触发和时间槽任务撞车，会出现跳过或延迟。
- “脚本 completed”不等于“业务 real_completed”，当前状态表仍把若干业务缺口保留为 warnings/executed_not_closed。

## 整改建议

### 必须立即收敛

1. 在规则文档中明确：OpenClaw 只保留历史证据归档，不再参与任何正式定时任务、采集、同步、前端验收。
2. 前端 `OpenClaw 对话式协作台` 应改为归档只读，隐藏或禁用 `发送到 OpenClaw`、`发送历史采集`、自定义派发按钮。
3. API `POST /api/openclaw/chat-board/send` 应默认返回 `disabled_archived`，除非后续用户明确重新启用。
4. `scripts/start-openclaw.sh`、`scripts/check-openclaw.sh`、`scripts/openclaw_healthcheck.sh` 加归档警告，禁止定时任务调用。
5. 增加自动化提示词审计脚本：每次 reload automations 后检查 30 个 TOML 是否都含固化规则、是否含 OpenClaw，失败则阻断 reload。

### 需要单独处理

1. `~/.codex/automations/automation-11` 是无 `automation.toml` 的遗留目录，应归档或删除，避免 UI/人脑误判为有效任务。
2. `.automation-runtime/scheduled-task-runner.lock` 需要核验持有进程；确认无活跃 runner 后才能清理，避免误杀正在运行任务。
3. 将 `latest-scheduled-task-reports.json` 扩展为 30 个自动化槽位和 12 类业务任务双视角，避免“30 个任务已挂回去”和“业务任务真实完成”混在一起。
4. 对 `zhidiantong-sync-cycle` 增加锁冲突后的延迟重试队列，而不是直接把 exit code 75 作为一次失败留给人工催。

## 本轮审计命令

```bash
python3 - <<'PY'
import pathlib, tomllib, json
root=pathlib.Path.home()/'.codex/automations'
tomls=sorted(root.glob('*/automation.toml'))
checks={
 'global_prompt':'【全定时任务采集固化提示词 BEGIN】',
 'old_chrome':'当前已经登录的默认 Chrome',
 'no_new_browser':'禁止打开空白浏览器',
 'no_browser_tools':'Browser/in-app browser/browser-use',
 'left_arrow':'左箭头',
 'keyboard_left':'键盘左键',
 'first_related_photo':'第一张相关照片',
 'sql_main':'SQL 主链',
 'frontend_audit':'前端',
 'openclaw':'OpenClaw',
}
bad=[]
for p in tomls:
    data=tomllib.loads(p.read_text(encoding='utf-8'))
    prompt=data.get('prompt','')
    vals={k:(v in prompt) for k,v in checks.items()}
    if not all(vals[k] for k in checks if k!='openclaw') or vals['openclaw']:
        bad.append({'file':str(p),'id':data.get('id'),'name':data.get('name'),'checks':vals})
print(json.dumps({'tomlCount':len(tomls),'badCount':len(bad),'bad':bad},ensure_ascii=False,indent=2))
PY
```

```bash
for d in ~/.codex/automations/*; do [ -d "$d" ] && [ ! -f "$d/automation.toml" ] && echo "$d"; done
```

```bash
rg -n "openclaw|OpenClaw|build-openclaw|/api/openclaw|OpenClaw 对话式|OPENCLAW" apps docs scripts
```

```bash
ps aux | egrep -i 'openclaw|selkies|wechat|codex|automation|chrome|playwright|puppeteer' | grep -v egrep
launchctl list | egrep -i 'openclaw|codex|selkies|wechat|lenovo|retail'
```
