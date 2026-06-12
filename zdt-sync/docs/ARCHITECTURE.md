# 架构说明

```text
智店通网页后台
    │
    ▼
Playwright 浏览器自动化
    │
    ▼
zdt-sync CLI
    ├── auth login/check
    ├── collect orders
    ├── collect inventory
    ├── collect products
    ├── collect refunds
    └── collect transfers
    │
    ▼
PostgreSQL
    ├── sync_state
    ├── sync_job
    └── raw_records
    │
    ▼
staging / 进销存正式表
```

## 为什么不用开放式深度爬虫

业务后台不是公开站点。开放式深度爬虫可能误点危险动作、扩大采集范围、影响对方服务，也难以审计。本项目采用白名单页面和固定动作。

## 三种采集模式

1. `table`：读取页面表格。
2. `export`：点击导出，解析 Excel/CSV。
3. `network`：通过正常页面操作触发 XHR/fetch，监听 JSON 响应。

生产推荐优先级：

```text
导出 > 表格 > 网络响应监听
```

具体取决于智店通页面稳定性和数据完整性。
