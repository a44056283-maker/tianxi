# Submenu Page Theme Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成 5 组浅色子菜单和子页面布局主题，供用户选择后再同步到正式系统。

**Architecture:** 新增独立 UI 选型页面，不改真实业务数据和正式系统渲染。每组主题同时展示二级子菜单、筛选区、指标区、列表/卡片/台账区、右侧详情区或底部操作区。

**Tech Stack:** Static HTML + CSS, stored in `UI模板仓库/submenu-page-theme-designs/`; visual QA by opening the local HTML in Safari.

---

## File Map

- Create: `UI模板仓库/submenu-page-theme-designs/submenu-page-theme-options.html`
  - 五组主题的 HTML 结构。
- Create: `UI模板仓库/submenu-page-theme-designs/submenu-page-theme-options.css`
  - 五组浅色主题样式。
- Modify: `UI模板仓库/docs/ui-refactor-roadmap.md`
  - 记录本轮生成的主题选择页和选型口径。

## Tasks

- [x] **Step 1: Create static preview HTML**
  - 生成五组主题：
    - Lenovo 官方红白商务
    - JD 蓝灰高密度
    - Apple 极简留白
    - Huawei 服务分区
    - ERP/POS 台账长条

- [x] **Step 2: Create CSS**
  - 全部浅色底。
  - 禁止大面积深色内容块。
  - 子菜单和内容区都要可视化，不只展示菜单。

- [x] **Step 3: Visual QA**
  - 用 Safari 打开本地 HTML。
  - 截图确认五组主题都可见。

- [x] **Step 4: Record**

## Result

Created:

- `UI模板仓库/submenu-page-theme-designs/submenu-page-theme-options.html`
- `UI模板仓库/submenu-page-theme-designs/submenu-page-theme-options.css`

Five selectable light themes:

1. `联想官旗红白商务`
2. `京东蓝灰高密度`
3. `Apple 极简留白`
4. `华为服务分区`
5. `ERP/POS 台账长条`

Visual QA:

- Opened local preview page in browser.
- Screenshot: `/tmp/lenovo-submenu-page-theme-options.png`

Boundary:

- This generated only selectable UI themes.
- It did not change production submenu/page styles yet.
  - 更新 UI 路线图。
