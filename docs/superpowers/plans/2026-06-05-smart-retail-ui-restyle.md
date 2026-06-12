# Smart Retail UI Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有联想智慧零售系统第一轮改造成浅色商业 ERP / 电商品牌混合风格，同时保留真实 SQL/API/快照数据链。

**Architecture:** 本轮先做 UI 外壳和导航视觉覆盖，不改业务数据、不改价格/库存/SN/活动字段。设计来源固定为 `UI模板仓库/skills/01-brand-commerce-ui-skill.md` 和 `UI模板仓库/skills/02-erp-pos-ui-skill.md`，后续再逐模块抽组件。

**Tech Stack:** React 19 + TypeScript + Vite + CSS；验证使用 `pnpm build` 和真实浏览器打开 `http://127.0.0.1:5174/`。

---

## File Map

- Modify: `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit/src/index.css`
  - 负责全局背景、默认文字色、按钮默认色从深色切换到浅色商业系统基底。
- Modify: `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit/src/App.css`
  - 负责主驾驶舱壳、Header、Panel、主书签、子书签、输入框、表格数字的第一轮浅色覆盖。
- Already created: `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/UI模板仓库/skills/01-brand-commerce-ui-skill.md`
  - 品牌电商 UI 执行规则。
- Already created: `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/UI模板仓库/skills/02-erp-pos-ui-skill.md`
  - ERP/POS UI 执行规则。

## Task 1: 固化两个新 UI 技能

**Files:**
- Create: `UI模板仓库/skills/01-brand-commerce-ui-skill.md`
- Create: `UI模板仓库/skills/02-erp-pos-ui-skill.md`
- Modify: `UI模板仓库/README.md`

- [x] **Step 1: 写入品牌电商 UI 技能**

要求：

```text
Apple / 京东 / 联想官旗 / 华为商城用于商品展示、价格证据、活动权益、商品详情页签。
```

- [x] **Step 2: 写入 ERP/POS UI 技能**

要求：

```text
管家婆类 ERP/POS 用于收银、挂单、退货、交班对账、商品主档、库存台账、进销存财闭环。
```

- [x] **Step 3: README 挂载使用规则**

要求：

```text
每次改 UI 前必须先加载两个项目内技能。
```

## Task 2: 第一轮浅色商业外壳覆盖

**Files:**
- Modify: `apps/web-cockpit/src/index.css`
- Modify: `apps/web-cockpit/src/App.css`

- [x] **Step 1: 全局基底改为浅色**

实现：

```css
:root { color: #172033; background: #f3f4f8; }
html { background: #f3f4f8; }
body { background: #f3f4f8; }
button { border: 1px solid #e5e7eb; background: #ffffff; color: #172033; }
```

- [x] **Step 2: 主系统壳限定覆盖**

实现：

```css
.cockpit-shell:not(.retail-ops-page):not(.backend-console-page):not(.prompt-workspace-standalone-page) {
  max-width: none;
  min-height: 100vh;
  padding: 12px;
  color: #172033;
  background: #f3f4f8;
}
```

- [x] **Step 3: Header / Panel / Tabs 改为联想红 + 京东浅蓝灰风格**

要求：

```text
Header 白底、灰线、轻阴影；主强调用 #e2231a；子书签白底、浅蓝灰 hover、红色 active。
```

- [x] **Step 4: 主书签自动编号**

要求：

```text
顶部主书签显示 01/02/03...，保持用户要求的路径识别度。
```

## Task 3: 构建验证

**Files:**
- No code changes unless build fails.

- [x] **Step 1: 运行前端构建**

Run:

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit
pnpm build
```

Expected:

```text
exit 0
```

- [x] **Step 2: 如 TypeScript/CSS 构建失败，修复失败点**

要求：

```text
只修与本轮 UI 外壳相关的问题，不碰业务数据。
```

## Task 4: gstack/浏览器真实页面 QA

**Files:**
- No code changes unless visual QA finds blocking layout bugs.

- [x] **Step 1: 确认 5174 服务可访问**

Run:

```bash
curl -I http://127.0.0.1:5174/
```

Expected:

```text
HTTP 200 或前端服务明确运行中。
```

- [x] **Step 2: 打开真实页面检查**

Open:

```text
http://127.0.0.1:5174/
```

检查：

```text
主壳不是深色大背景。
Header 文字清晰。
顶部主书签有编号。
商品卡和右侧内容不明显横向错位。
数据区不是空白壳。
```

- [x] **Step 3: 手机/平板初步断点检查**

检查：

```text
窄屏主书签可横向滚动，文字不互相覆盖。
```

## Task 5: 记录验收与下一轮迁移范围

**Files:**
- Modify: `UI模板仓库/docs/ui-refactor-roadmap.md`

- [x] **Step 1: 写入第一轮实际结果**

要求：

```text
记录已完成的外壳覆盖、构建结果、真实页面缺口。
```

- [x] **Step 2: 下一轮只迁移一个模块**

建议：

```text
优先迁移 商品零售 -> 产品英雄卡，不先大面积重构所有模块。
```

## Self-Review

- 覆盖用户要求：已把两个新学习技能写成项目内规则，UI 改造按这些规则执行。
- 数据边界：本轮不修改价格、库存、SN、营销活动、出入库快照。
- 验收门槛：没有 `pnpm build` 和真实页面截图前，不得声称 UI 改造完成。
