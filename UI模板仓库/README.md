# 联想智慧零售 UI 模板仓库

建立日期：2026-06-05

## 定位

本仓库用于沉淀“联想智慧零售系统”后续 UI 改造的参考模板、组件规范和业务布局方案。

这里不保存第三方网站源码、图片素材、商品数据或可复制的商业页面，只保存公开可观察的设计模式、信息架构、交互结构和自研模板。

## 本轮参考源

- Apple 中国购买页：学习极简层级、横向产品选择、服务权益卡片和购买流程分段。
- 京东联想自营店：学习电商店铺聚合、商品比较、列表筛选、价格/活动/服务标签的高密度表达。
- 联想商城商品详情：学习商品详情页的标题、规格、价格、增值服务、配送、详情/参数/评价页签结构。
- 华为笔记本页：学习产品族落地页的首屏节奏、价格提示、了解更多/购买双按钮、页脚服务结构。
- 管家婆 iShop / 分销 ERP：学习 ERP/POS 的进销存财闭环、多端使用、角色功能、收银挂单退货、交班对账、可视化导航。

## 目录

```text
UI模板仓库/
  README.md
  research/
    source-index.json
    design-pattern-study.md
    erp-pos-study.md
  templates/
    lenovo-retail-template.html
    component-manifest.json
    assets/
      retail-ui-kit.css
      retail-ui-kit.js
  docs/
    ui-refactor-roadmap.md
```

## 使用规则

1. 后续 UI 改造优先从 `templates/component-manifest.json` 选组件，不临时发明风格。
2. 每次改 UI 前必须先加载两个项目内技能：
   - `skills/01-brand-commerce-ui-skill.md`
   - `skills/02-erp-pos-ui-skill.md`
3. 收银端、平板端、手机端使用同一套组件和断点，不做多个割裂版本。
4. 在线业务数据仍必须走 `SQL -> API -> 前端映射`，模板只定义外观和交互结构。
5. 外部网站只作为模式研究来源，不允许复制其源码、图片、品牌素材或商品数据。

## 当前可打开预览

直接打开：

```text
UI模板仓库/templates/lenovo-retail-template.html
```

该页面是自研样式预览，使用虚拟数据展示：

- 商品零售英雄卡
- 库存 / SN / 价保 / 报价来源 / 出入库 / 收银端
- ERP 左侧导航 + 顶部子流程菜单
- 收银台固定画面与翻页式布局
- 手机和平板响应式布局
