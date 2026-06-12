# IMPLEMENT_PLAN

## 结构

```text
index.html
assets/app.css
assets/app.js
data/system-state.json
manifest.webmanifest
docs/governance/
docs/delivery/
```

## 模块

1. 经营驾驶舱
2. SN 资产
3. 智店通同步
4. 库存出入库
5. 报价治理
6. 价保活动
7. 提问工作台
8. 协作看板
9. 五层验收

## 数据闭环

```text
raw_data -> parsed_data -> retail_db -> API -> frontend -> acceptance
```

当前版本用 `data/system-state.json` 描述原版菜单、子页面和 API 端点，前端按 `same_hostname:8000` 读取现有 FastAPI/SQLite 真实数据。

## 原版菜单对接顺序

1. 零售专区
2. 单品详情
3. 真实库存
4. 实时进货价
5. 报价来源
6. 入库出库
7. 同步驾驶舱
8. 接入计划
9. 智店通
10. 提问工作台
11. 产品库
12. 会话看板
13. 管理后台

## 验证

- 检查文件是否完整。
- 检查 JSON 是否可解析。
- 启动本地静态服务打开页面。
- 确认页面无空白模块、无假按钮、无不可读文字。
- 验证 `8000` API 健康接口、零售区接口、库存流水接口返回 200。
