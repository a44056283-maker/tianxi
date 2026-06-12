# 联想智慧零售驾驶舱

当前阶段：静态 UI Demo + 库存及报价实时管理模块业务原型。系统优先围绕智店通库存同步、SN 周转、保修校验、多来源报价和两套国补价落地，后续逐步接入 API、CSV/Excel 导入、网页采集和经营分析规则。

## 运行前端

```bash
cd apps/web-cockpit
pnpm install
pnpm dev --host 127.0.0.1
```

当前开发服务示例地址：

```text
http://127.0.0.1:5174/
```

如果 5174 被占用，Vite 会自动使用其他端口，以终端输出为准。

## 运行后端

```bash
cd apps/api-server
uv sync
uv run fastapi dev app/main.py --host 127.0.0.1 --port 8000
```

当前已提供：

```text
GET /health
GET /api/dashboard/summary
GET /api/inventory-quote/summary
```

后端第一版读取 `apps/web-cockpit/public/data` 下的现有 JSON 快照，后续再迁移到 SQLite 导入表。

前端库存报价数据源可通过环境变量切换：

```text
VITE_INVENTORY_QUOTE_API_BASE=http://127.0.0.1:8000
VITE_INVENTORY_QUOTE_DATA_MODE=api
```

如需完全使用本地 JSON/mock 回退：

```text
VITE_INVENTORY_QUOTE_DATA_MODE=mock
```

## 响应式说明

产品只保留一个主页面：

```text
http://127.0.0.1:5174/
```

该页面使用同一套 React 组件和 CSS 响应式断点自动适配桌面、平板和手机，不维护多套页面。

## 当前已实现

- 智慧零售驾驶舱首页
- 模拟经营数据
- KPI 总览
- 店铺客流分析
- 店内热区与动线分析
- 商品陈列热度
- 动态价格监控
- 库存预警
- 销售漏斗
- 员工接待分析
- 售后分析
- 广告机投放建议
- AI 销售建议
- 老板经营日报
- 库存及报价实时管理模块首版
  - 智店通、订货平台、分销商、灰渠、电商价格源接入状态
  - SN 单机库存周转与保修校验
  - 正规厂家渠道国补价
  - 防流失低价国补价
  - 报价来源可信度、含税和服务差异提示
- 桌面、平板、手机响应式布局
- FastAPI 后端最小骨架
- `/health`、`/api/dashboard/summary`、`/api/inventory-quote/summary` 占位接口

## 重点计划

库存及报价实时管理模块是当前第一优先开发模块，详细计划见：

```text
docs/库存及报价实时管理模块实施计划.md
```

所有软件框架、功能模块和采集流程在实现前，必须先按问卷确认边界和验收口径：

```text
docs/工作边界与问卷先行规范.md
```

京东零售价采集必须按已确认问卷和校准规范执行：

```text
docs/京东采集问卷答案与校准规范.md
```

## 下一步

1. 拆分 `apps/web-cockpit/src/App.tsx` 中的库存报价模块组件。
2. 增加智店通导出 Excel 的脱敏样例导入。
3. 接入分销商日报价半自动导入。
4. 规划 SQLite 表结构，承接库存、报价、价保和零售区决策数据。
5. 评估智店通、联想订货平台、灰渠公众号和电商平台的网页采集。

智店通前端卡在转圈时，可先执行：

```bash
cd apps/inventory-sync
npm run repair:lenovo-browser-cache
```

默认只清 `retail-pos.lenovo.com` 的 `localStorage`、`sessionStorage`、`CacheStorage`、`Service Worker`、`IndexedDB`，不清 Cookie/登录态。

如果确认需要强制重新登录，再执行：

```bash
cd apps/inventory-sync
npm run repair:lenovo-browser-cache -- --clear-login
```
