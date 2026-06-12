# OpenClaw 副驾驶接入方案

更新时间：2026-05-16

## 目标定位

OpenClaw 在本项目内只作为“采集副驾驶”使用：

1. 调度固定任务
2. 打开网页型固定链接
3. 运行浏览器自动化可支持的页面流程
4. 写原始证据和回执
5. 发现掉线、403、验证码、白屏后立刻停下并汇报

Codex 继续负责：

1. 规则判定
2. 物料匹配
3. 快照重建
4. 前端同步
5. 阻塞审计

## 第一阶段允许接入的链路

### 已确认可执行

1. 竞品监控
   - 京东自营店铺收藏库轮扫
   - 产品链接仓库轮扫
   - 英雄卡所需原始价格、配置、活动证据采集
2. 实时零售价补链
   - 京东指定详情页失效后转京东全站补链
   - 联想官旗下架后转天猫/淘宝补链
3. 报价证据层辅助
   - 对已落地文件做归档
   - 对网页型证据做截图或文本摘取
   - 对 Codex 已生成 OCR 文件做汇总
   - 原始文本落盘

### 当前不能承诺稳定执行

1. 微信桌面端深度操控
   - 原因：OpenClaw 当前 `peekaboo` 技能缺少本机 `peekaboo` CLI。
   - 当前报价采集固定改为 Chrome `https://localhost:3001/` 网页微信可见操作，不再把桌面微信作为入口。
2. 智店通桌面 UI 深度操控
   - 原因：OpenClaw 当前可用能力以 Gateway、cron、browser、taskflow 为主，不等同于稳定 macOS UI 控制。
   - 当前只允许处理网页型链接、已下载文件和原始证据回执，不直接替代人工导出。

## 明确禁止

OpenClaw 不允许直接写以下正式产物：

- `apps/web-cockpit/public/data/latest-retail-zone-snapshot.json`
- `apps/web-cockpit/public/data/latest-standard-price-master.json`
- `apps/web-cockpit/public/data/latest-inventory-master-snapshot.json`
- 任意 `latest-*.json` 正式快照

OpenClaw 只允许写入：

- `apps/inventory-sync/artifacts/manual/*.json`
- `apps/inventory-sync/artifacts/manual/*.txt`
- `apps/inventory-sync/artifacts/manual/*.md`
- `apps/inventory-sync/artifacts/manual/*.png`

## 登录与风控边界

出现以下任一情况，OpenClaw 必须停止并把结果交回 Codex：

1. 微信掉线
2. 京东要求重新登录
3. 联想官旗要求重新登录
4. 智店通跳回登录页
5. 页面白屏
6. 403
7. 验证码
8. 安全验证

统一状态：

- `executionOutcome = blocked_page_risk`
- `manualActionRequired = true`

由用户手动重新登录后再继续。

## 本机安装状态

当前已完成：

1. OpenClaw CLI 安装
2. 本地 Gateway LaunchAgent 安装
3. 项目环境封装脚本
4. 已审计可用能力：
   - `cron`
   - `agent`
   - `browser` 插件
   - `taskflow`
   - `healthcheck`
5. 当前未满足依赖的关键桌面能力：
   - `peekaboo`

## 浏览器归属与可见窗口规则

2026-05-16 已实测确认：

- OpenClaw `browser` 插件控制的是专用 `Chrome/Chromium` 类浏览器，不是 Safari。
- 本机实际检测到的默认可执行文件：
  - `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- OpenClaw 专用浏览器配置：
  - profile：`openclaw`
  - CDP：`http://127.0.0.1:18800`
  - 用户目录：`/Users/luxiangnan/.openclaw/browser/openclaw/user-data`
  - `headless = false`
- Safari 已安装，但 OpenClaw 当前 `browser` 插件不支持把 Safari 作为可控 CDP 浏览器。不能把“系统默认浏览器设成 Safari”写成 OpenClaw 可控方案。
- 为了和用户日常 Chrome / Codex Chrome 操作互不干扰，OpenClaw 必须只使用上述独立 profile 和独立用户目录。若后续要完全避开 Chrome 品牌窗口，应改装 Chromium / Brave / Edge 这类 Chromium 系浏览器，再把 `browser.executablePath` 指向新浏览器。
- 已允许 OpenClaw 浏览器访问本地驾驶舱：
  - `browser.ssrfPolicy.allowedHostnames = ["127.0.0.1", "localhost"]`

可见验证命令：

```bash
bash scripts/openclaw_env.sh browser status
bash scripts/openclaw_env.sh browser open http://127.0.0.1:5174/
bash scripts/openclaw_env.sh browser tabs
```

当前已实测打开：

```text
http://127.0.0.1:5174/
页面标题：联想智慧零售系统
```

本地入口：

```bash
bash scripts/openclaw_healthcheck.sh
bash scripts/openclaw_env.sh daemon status
bash scripts/openclaw_env.sh gateway health
```

## 项目内调用原则

1. OpenClaw 负责采
2. Codex 负责判
3. 原始证据先落 `manual`
4. 再由 Codex 统一重建正式快照
5. 不允许 OpenClaw 越过证据层直接写前端

## 能力审计命令

```bash
bash scripts/openclaw_env.sh plugins list --json
bash scripts/openclaw_env.sh skills list --json
bash scripts/openclaw_env.sh channels status --json
```
