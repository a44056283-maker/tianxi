# 00 Project Brief

更新时间：2026-05-12

## 项目目标

把联想线下电脑体验店升级成以本地库存、SN、价格、出入库和经营分析为核心的数据化门店系统。第一阶段先做好三个闭环：

1. 真实库存和 SN 台账
2. 销售出库 / 采购入库 / 其他出库同步
3. 门店零售价格展示与多平台价格补齐

## 当前产品形态

- 一个前端驾驶舱：`apps/web-cockpit`
- 一个本地 API：`apps/api-server`
- 一组同步/采集/快照 CLI：`apps/inventory-sync`

前端既承担经营看板，也承担库存零售专区、报价来源、出入库历史、价格监控等业务展示。

## 业务主线

- 智店通是库存与出入库事实来源
- 本地系统是展示、审计、二次建模和未来自建收银/门店系统的中台
- 京东 / 联想官网 / 天猫是门店零售价参考来源
- SN 入库时间、成本、流转状态是价保和陈旧库存管理基础

## 当前架构

- 前端：React + TypeScript + Vite
- 后端：FastAPI
- 本地数据：JSON 快照 + SQLite
- 同步工具：Node.js CLI + 当前已登录 Chrome 可见会话人工辅助流程
  - 外部登录态采集只能复用老 Chrome 会话，禁止新浏览器、空白浏览器、新 Profile、清缓存、重登
  - Playwright / browser-use / Browser / in-app browser / Puppeteer / Chromium launch 只允许用于本地前端验证或历史参考，不允许打开智店通、网页微信、京东、联想官旗、天猫等外部采集页

## 当前优先级

1. 保证库存与 SN 展示和真实库存一致
2. 保证销售、采购、其他出库都能正确进入库存流水
3. 只对有库存 SKU 做零售价补齐
4. 为每日定时任务准备稳定规则和上下文打包能力

## 文档来源

结构化记忆提炼自以下文件：

- `README.md`
- `../README_联想智慧零售驾驶舱_Codex实施总纲.md`
- `../联想智慧零售_开发计划_每日更新.md`
- `docs/会话上下文记忆.md`
- `docs/工作边界与问卷先行规范.md`
- `docs/库存及报价实时管理模块实施计划.md`
- `docs/智店通库存对接扫描记录.md`
- `docs/京东采集问卷答案与校准规范.md`
- `apps/inventory-sync/README.md`
- `apps/web-cockpit/README.md`
- `apps/api-server/README.md`
