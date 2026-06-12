# Top Main Menu ERP + Lenovo Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有智慧零售系统顶部主菜单改为“ERP/POS 业务模块结构 + Lenovo 红底 Logo”方向。

**Architecture:** 只改一级主菜单和 Logo 区的结构/样式，不改业务数据、接口、价格、库存、SN、出入库快照。主菜单选择来源为 `UI模板仓库/top-menu-designs/SELECTED_TOP_MENU.md`。

**Tech Stack:** React 19 + TypeScript + Vite + CSS；验证使用 `pnpm build`、`curl 5174` 和真实 Safari 页面截图。

---

## File Map

- Modify: `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit/src/App.tsx`
  - 调整顶部主菜单 label 和顺序。
  - Logo 区保持 Lenovo 红底样式。
- Modify: `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit/src/App.css`
  - 增加/调整 ERP/POS 主菜单样式。
  - 主菜单保留编号和横向滚动。
- Optional Modify: `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit/src/index.css`
  - 仅在全局按钮/文字颜色影响主菜单时小范围调整。

## Selected Design

用户已确认：

```text
主菜单采用方案 E：管家婆 ERP/POS 式业务模块主菜单。
Logo 区采用方案 A：联想官旗式 Lenovo 红底品牌 Logo。
```

目标主菜单：

```text
01 今日经营
02 商品零售
03 库存台账
04 SN保修
05 产品价保
06 报价来源
07 入库出库
08 收银台
09 商品主档
10 系统管理
```

## Task 1: 对齐现有 activeBookmark 与目标菜单

**Files:**
- Modify: `apps/web-cockpit/src/App.tsx`

- [x] **Step 1: 建立目标菜单映射**

将现有书签映射到目标主菜单：

```text
retail -> 商品零售
serials -> 库存台账
prices -> 产品价保
sources -> 报价来源
movements -> 入库出库
promptWorkspace -> 提问工作台或后续移入系统管理
sessionBoard -> 会话看板或后续移入系统管理
syncCockpit -> 系统管理/同步状态
productLibrary -> 商品主档
adminCenter -> 系统管理
```

本轮最小实现：

```text
保留现有可用路由，不删除旧模块；只把主菜单显示层改成目标业务名称。
```

- [x] **Step 2: 增加今日经营和收银台入口处理**

如果当前没有独立 `today` 和 `pos` bookmark：

```text
今日经营可先映射到现有 summary/overview 类内容。
收银台可先作为入口按钮指向已有 retail-ops/android-pos/retail-ops-terminal 之一，但不得隐藏真实入口。
```

若实现风险较高，本轮先不新增行为，只在计划中标记为下一轮。

## Task 2: 实现主菜单视觉

**Files:**
- Modify: `apps/web-cockpit/src/App.css`

- [x] **Step 1: Logo 区采用 Lenovo 红底样式**

目标：

```text
红底 Lenovo 标识 + 联想智慧零售文字。
```

- [x] **Step 2: 主菜单采用 ERP/POS 业务模块样式**

目标：

```text
白底或浅蓝灰底，按钮带 01/02/03 编号，active 用 Lenovo 红强调。
```

- [x] **Step 3: 断点**

目标：

```text
桌面横向展示。
收银机宽屏不换行优先，可横向滚动。
手机/平板窄屏横向滚动，不压缩文字到看不清。
```

## Task 3: 构建验证

**Files:**
- No business data changes.

- [x] **Step 1: Run build**

Run:

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit
pnpm build
```

Expected:

```text
exit 0
```

## Task 4: gstack/真实页面 QA

**Files:**
- No code changes unless QA finds layout bugs.

- [x] **Step 1: Check 5174**

Run:

```bash
curl -I http://127.0.0.1:5174/
```

Expected:

```text
HTTP 200
```

- [x] **Step 2: Desktop screenshot**

Open:

```text
http://127.0.0.1:5174/?uiAudit=top-main-menu-erp-lenovo-logo
```

Check:

```text
Logo 是 Lenovo 红底。
主菜单使用 ERP/POS 业务模块。
菜单带清晰编号。
当前 active 清楚。
数据区不空白。
```

- [ ] **Step 3: Narrow/mobile screenshot**

Check:

```text
主菜单可横向滚动。
Logo 不压住菜单。
没有文字重叠。
```

## Task 5: Update design record

**Files:**
- Modify: `UI模板仓库/top-menu-designs/SELECTED_TOP_MENU.md`
- Modify: `UI模板仓库/docs/ui-refactor-roadmap.md`

- [x] **Step 1: Record implementation result**

Write:

```text
构建结果、真实页面 URL、截图路径、遗留问题。
```

## Self-Review

- 本计划只处理顶部主菜单。
- 不删除旧模块，不改业务数据。
- 用户已选定方案 E + 方案 A Logo。
- 没有真实页面截图前不得说“完成”。

## 2026-06-05 Implementation Result

已完成：

- 顶部主菜单改为 10 个 ERP/POS 业务模块：今日经营、商品零售、库存台账、SN保修、产品价保、报价来源、入库出库、收银台、商品主档、系统管理。
- 不确定或暂未独立成主菜单的旧模块汇总进 `系统管理 / 其它汇总`。
- 缺少正式页面的主菜单已先做占位：`今日经营`、`SN保修`、`收银台`。
- Logo 区保持 Lenovo 红底品牌样式。

验证：

- `cd apps/web-cockpit && pnpm build`：通过。
- `curl -I http://127.0.0.1:5174/`：HTTP 200。
- 桌面真实页面截图：
  - `/tmp/lenovo-top-main-menu-final-desktop.png`
  - `/tmp/lenovo-top-main-menu-system-2.png`
  - `/tmp/lenovo-top-main-menu-pos.png`
  - `/tmp/lenovo-top-main-menu-today-native.png`
  - `/tmp/lenovo-top-main-menu-warranty-native.png`

未收口：

- 窄屏/手机竖屏截图还未单独验收，下一轮需要用移动视口继续检查横向滚动和文字重叠。
