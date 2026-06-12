# OpenClaw 任务编排与交接规范

更新时间：2026-05-16

## 总原则

OpenClaw 负责其当前能力范围内的采集和调度，Codex 负责判定和写正式快照。

OpenClaw 采集完成后必须写回执文件。Codex 只读回执和原始证据，再决定是否导入、去重、重建快照。

## 固定任务

| 任务 | 时间 | 任务文件 | 输出目录 |
|---|---:|---|---|
| 智店通证据巡检 | 10:00-20:00 每 30 分钟 | `docs/openclaw-tasks/zhidiantong-realtime-scan.md` | `artifacts/manual/openclaw/zhidiantong/YYYY-MM-DD/` |
| 竞品监控店铺轮扫 | 04:00 | `docs/openclaw-tasks/competitor-monitor-scan.md` | `artifacts/manual/openclaw/competitor/YYYY-MM-DD/` |
| 零售价补链证据采集 | 06:30 | `docs/openclaw-tasks/retail-link-backfill-scan.md` | `artifacts/manual/openclaw/retail-link-backfill/YYYY-MM-DD/` |
| 报价证据采集 | 11:30 / 11:50 / 13:45 / 13:50 | `docs/openclaw-tasks/quote-evidence-scan.md` | `artifacts/manual/openclaw/quotes/YYYY-MM-DD/` |

## OpenClaw 当前能力边界

本机已确认可用：

- `cron`
- `agent`
- `browser` plugin
- `taskflow`
- `healthcheck`
- `peekaboo`
- `Screenshot`
- `ocr-local`

本机当前不可作为稳定依赖：

- 报价采集固定走 Chrome `https://localhost:3001/` 网页微信；微信桌面端不再作为报价采集入口
- 智店通复杂桌面 UI 深度操控，必须先从已打开页面和已下载文件开始
- 系统级 `tesseract` CLI，当前未安装；生产 OCR 先用 `ocr-local`

所以当前任务必须按“网页和文件证据优先”执行，不能假设 OpenClaw 已能稳定点微信或点智店通复杂界面。

## OpenClaw 浏览器执行口径

OpenClaw 采集任务统一使用它自己的可见浏览器窗口，不使用 Codex 正在操作的 Chrome 会话，也不使用用户日常 Chrome 资料目录。

当前实测配置：

- browser 类型：`Chrome/Chromium`，不是 Safari。
- 默认可执行文件：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- OpenClaw profile：`openclaw`
- CDP 端口：`18800`
- 用户目录：`/Users/luxiangnan/.openclaw/browser/openclaw/user-data`
- `headless = false`
- 已允许本地驾驶舱域名：`127.0.0.1`、`localhost`

执行边界：

1. 不能把 Safari 当作 OpenClaw 的可控浏览器目标；当前插件依赖 Chrome/Chromium CDP。
2. OpenClaw 浏览器必须保持可见，除非用户明确要求后台运行。
3. OpenClaw 需要采集京东、联想官旗、智店通等页面时，必须先复用 `127.0.0.1:9222` 上已登录的 Chrome `user` 会话；会话不存在或未登录就写 `blocked_page_risk`，不得新建空白窗口或新 profile。
4. 如果用户希望完全避免 Chrome 窗口混淆，后续应安装 Chromium / Brave / Edge，并把 `browser.executablePath` 指向该浏览器。

### 已登录窗口复用规则

给 OpenClaw 的网页采集任务必须包含以下提示词：

```text
你只能使用 `127.0.0.1:9222` 上已经登录过的 Chrome `user` 会话。先检查 `openclaw browser status` 和 `openclaw browser tabs`；如果已有目标站点标签页，复用该标签页。不要新建空白未登录用户窗口，不要启动新的 Chrome profile。若当前 `user@9222` 会话未登录、出现登录页/二维码/验证码/403/安全验证或空白页，立即停止并写 `blocked_page_risk` receipt，`manualActionRequired=true`，说明需要用户手动在现有 Chrome 窗口里恢复登录态。
```

落地规则：

1. 先查已开标签页，再决定是否打开 URL。
2. 打开 URL 也必须在 OpenClaw 当前 `openclaw` profile 会话中打开。
3. 任何新建 profile、guest、incognito、系统默认 Chrome 个人资料都禁止使用。
4. 未确认登录态前，不允许开始采集字段。

## 回执目录

所有任务必须写：

```text
apps/inventory-sync/artifacts/manual/openclaw/receipts/
```

Codex 汇总命令：

```bash
cd apps/inventory-sync
node --import tsx/esm src/cli.ts build-openclaw-receipts
```

汇总产物：

```text
apps/inventory-sync/artifacts/latest-openclaw-collection-receipts.json
apps/web-cockpit/public/data/latest-openclaw-collection-receipts.json
```

详细通信协议见：

```text
docs/OpenClaw与Codex通信协议.md
```

## Codex 消费顺序

1. 执行 `build-openclaw-receipts` 生成统一收件箱。
2. 读取 `latest-openclaw-collection-receipts.json`。
3. 只处理 `readyForCodex` 中的记录。
4. 对 `manualActionRequired` 和 `blocked_page_risk` 立即汇报用户登录或页面阻塞。
4. 按任务类别调用正式导入器：
   - 智店通：`import-zhidiantong-sales-export` / `import-zhidiantong-purchase-web` / `import-zhidiantong-other-outbound`
   - 竞品：`parse-competitor-monitor`
   - 报价：`parse-distributor-quotes` / `parse-gray-wholesale`
   - 补链：先进入人工价格补充批次，再统一重建
5. 统一重建正式快照

## 去重规则

智店通不按“页面看到一条就新增一条”处理，必须按稳定键去重：

- 销售出库有 SN：`sales|orderNo|skuKey|serialNumber`
- 销售出库无 SN：`sales|orderNo|lineIndex|skuKey|quantity`
- 采购入库有 SN：`purchase|documentNo|skuKey|serialNumber`
- 采购入库无 SN：`purchase|documentNo|lineIndex|skuKey|quantity`
- 其他出库有 SN：`otherOutbound|documentNo|skuKey|serialNumber`
- 其他出库无 SN：`otherOutbound|documentNo|lineIndex|skuKey|quantity`

## 阻塞规则

以下情况 OpenClaw 必须停止并写 `blocked_page_risk`：

- 微信掉线
- 京东要求重新登录
- 联想官旗要求重新登录
- 智店通跳回登录页
- 页面白屏
- 403
- 验证码
- 安全验证

## CPU 与并发规则

1. OpenClaw 任务不得与 Codex computer-use 任务并发做重页面操作。
2. 智店通实时扫描每 30 分钟一次，不低于 30 分钟。
3. 竞品、补链、报价任务按固定窗口运行，不额外高频轮询。
4. OpenClaw 写证据后必须结束，不允许长时间占用浏览器。

## 已加载技能与边界

当前 OpenClaw 可用于联想智慧零售采集链的技能：

- `browser-automation`：OpenClaw 独立 Chrome/Chromium 浏览器页面操作、标签检查、页面快照和浏览器截图。
- `peekaboo`：macOS 桌面/窗口/应用操控。入口为 `/Users/luxiangnan/.local/bin/peekaboo`，调用 `npx -y @steipete/peekaboo`。
- `Screenshot`：屏幕、窗口、网页、局部区域截图证据。
- `ocr-local`：本地 Tesseract.js OCR，默认用于中文简体+英文截图识别。
- `tesseract-ocr`：Tesseract CLI 规则参考；当前本机未安装 `tesseract` 命令，生产优先用 `ocr-local`。
- `taskflow`：长任务拆分和状态交接。
- `session-logs`：OpenClaw 自身历史日志审计。
- `healthcheck`：OpenClaw 主机和暴露面检查。
- `node-connect`：节点、浏览器和连接问题诊断。

暂不加载：

- 真实 Chrome 接管类技能，例如 `use-my-browser`。
- 云 OCR 类技能，例如 TencentCloud OCR、OCR.space、夸克 OCR。
- 泛化自动化套件、营销自动化模板。
- Windows/Telegram/Feishu 专用截图技能。

原因：当前项目要求 OpenClaw 与 Codex 浏览器隔离、证据保留本地、最小权限执行。任何会扩大权限面、上传证据图片或接管用户日常浏览器的技能，必须另行审计并明确批准后才能启用。
