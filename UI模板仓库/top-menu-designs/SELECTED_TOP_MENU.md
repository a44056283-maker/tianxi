# 已选顶部主菜单方案

确认时间：2026-06-05

## 用户选择

主菜单采用：

- **方案 E：管家婆 ERP/POS 式业务模块主菜单**

Logo 区采用：

- **方案 A：联想官旗式 Lenovo 红底品牌 Logo**

## 固化方向

最终主菜单方向为：

```text
Lenovo 红底 Logo + 联想智慧零售
业务模块横向主导航：
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

## 设计理由

- 方案 E 符合智慧零售系统的长期业务形态：进销存、收银、库存、SN、价保、报价和后台治理。
- 方案 A 的 Logo 区更贴近联想官旗和 Lenovo 品牌识别，适合门店商业软件首屏。
- 后续商品零售模块内部可以继续融合京东自营高密度商品卡和联想官旗商品详情页签，但主导航不再改变方向。

## 实现约束

1. 左侧或顶部主菜单不得删除核心业务模块。
2. 主菜单必须显示序号，提高路径识别度。
3. Logo 区必须保持 Lenovo 红底品牌块。
4. 主菜单要支持桌面、收银机、平板横屏、手机竖屏。
5. 顶部主菜单只负责一级业务模块，二级流程用当前模块内的子书签展示。
6. 不在主菜单堆数据说明；数据状态放到模块内容区或角标。

## 下一步

进入正式系统前，先按 `superpowers/gstack` 写实现计划，再改：

- `apps/web-cockpit/src/App.tsx`
- `apps/web-cockpit/src/App.css`
- 必要时抽出 `RetailMainNav` 组件

## 2026-06-05 实现结果

已落地到正式系统：

- `apps/web-cockpit/src/App.tsx`
- `apps/web-cockpit/src/App.css`

当前顶部主菜单：

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

实现口径：

- 旧模块不删除。
- 不确定的旧模块统一放入 `系统管理 / 其它汇总`。
- 缺少正式内容的主菜单先提供占位入口。
- 本轮不改业务数据、价格、库存、SN、活动和 SQL 映射。

验证记录：

- 构建：`cd apps/web-cockpit && pnpm build` 通过。
- 本地服务：`curl -I http://127.0.0.1:5174/` 返回 HTTP 200。
- 真实页面截图：
  - `/tmp/lenovo-top-main-menu-final-desktop.png`
  - `/tmp/lenovo-top-main-menu-system-2.png`
  - `/tmp/lenovo-top-main-menu-pos.png`
  - `/tmp/lenovo-top-main-menu-today-native.png`
  - `/tmp/lenovo-top-main-menu-warranty-native.png`

待补验收：

- 手机竖屏和平板横屏的单独截图验收。

## 2026-06-05 样式纠偏

用户指出：正式系统必须完全对标第 5 套菜单和图形 UI 样式，不允许重新发挥一套新样式。

已修正：

- 一级菜单条改回 `方案 E / erp-style selected` 的视觉口径：
  - 浅蓝菜单底色 `#eef5ff`
  - 红色选中外框和轻量红色光晕
  - 菜单条左侧内嵌 `Lenovo + 联想智慧零售`
  - 按钮为紧凑白底业务按钮
  - active 状态使用左侧红色竖线
- Logo 样式保持方案 A 的 Lenovo 红底品牌块。
- 不再使用上一版“普通白色卡片式顶部按钮”作为主菜单样式。

验证截图：

- `/tmp/lenovo-top-menu-variant5-exact-2.png`
