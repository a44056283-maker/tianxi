# 联想智慧零售系统商用专业版 V1.0

这是一个独立的新软件包，按 `Lenovo_SmartRetail_Governance_V5_Enterprise.zip` 的最终操作规范生成。

## 运行方式

直接打开：

```text
index.html
```

或在本目录启动静态服务：

```bash
python3 -m http.server 9188
```

然后访问：

```text
http://127.0.0.1:9188/
```

## 当前交付范围

- 按原版零售系统菜单顺序生成 13 个主模块。
- 每个主模块生成对应子菜单和子页面数据面板。
- 子页面按 `same_hostname:8000` 读取原版 FastAPI/SQLite 真实数据接口。
- V5 Enterprise 与 V6 AI Workstation 治理规则已纳入 `docs/governance`。
- 五层验收与任务收口文档已建立。

## 数据原则

本版本已经从静态样例切换为真实 API 桥接模式，但仍不把“页面能读取 API”写成真实生产完成。生产接入必须按：

```text
raw_data -> parsed_data -> retail_db -> API -> frontend
```

完成证据、SQL/API、前端可见验收。

## 原版菜单顺序

```text
零售专区 -> 单品详情 -> 真实库存 -> 实时进货价 -> 报价来源 -> 入库出库 -> 同步驾驶舱 -> 接入计划 -> 智店通 -> 提问工作台 -> 产品库 -> 会话看板 -> 管理后台
```
