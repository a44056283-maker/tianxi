# 智店通 CLI 采集器开发流程

本文档给 OpenClaw / Codex 使用，用于把智店通网页后台采集能力做成可上线的 CLI 软件。

## 0. 项目目标

把人工操作后台的流程变成命令：

```bash
zdt-sync collect orders --incremental
zdt-sync collect inventory --store all
zdt-sync collect refunds --since "2026-05-28 00:00:00"
zdt-sync status
```

系统要做到：

```text
可登录复用
可定时执行
可断点续采
可失败重试
可截图留痕
可 trace 调试
可 staging 入库
可幂等去重
可人工对账
```

## 1. 边界确认

在开发前必须确认：

```text
1. 使用的是公司授权账号。
2. 采集的数据是账号本来可以看到的数据。
3. 不绕过验证码、短信验证、扫码验证、MFA、风控、权限限制。
4. 不扫描隐藏接口，不猜测参数，不越权访问其他门店或其他租户数据。
5. 不使用代理池，不高并发请求，不影响智店通服务稳定性。
6. 所有自动化行为只读，不点击审核/提交/删除/付款/退款/作废等危险按钮。
```

## 2. 环境准备

### 2.1 安装基础依赖

Ubuntu / Debian：

```bash
bash scripts/install_ubuntu.sh
```

macOS：

```bash
bash scripts/install_macos.sh
```

手动安装：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e '.[dev]'
playwright install chromium
cp .env.example .env
cp config/selectors.example.yaml config/selectors.yaml
cp config/stores.example.yaml config/stores.yaml
```

### 2.2 启动数据库

```bash
docker compose up -d postgres redis
zdt-sync db init
```

## 3. 页面调研

对每个数据域建立页面调研表。

| 数据域 | 页面入口 | 筛选条件 | 表格字段 | 分页方式 | 是否可导出 | 是否有详情页 |
|---|---|---|---|---|---|---|
| orders | 销售订单 | 日期、门店、状态 | 订单号、SKU、数量、金额、状态 | 下一页 | 是/否 | 是/否 |
| inventory | 库存查询 | 门店、仓库、SKU | SKU、可售库存、锁定库存 | 下一页 | 是/否 | 是/否 |
| products | 商品档案 | 状态、品牌、SKU | SKU、商品名、型号、条码 | 下一页 | 是/否 | 是/否 |
| refunds | 退货退款 | 日期、门店、状态 | 退款单号、原订单号、金额 | 下一页 | 是/否 | 是/否 |
| transfers | 调拨/入库 | 日期、门店、状态 | 单据号、来源、目标、状态 | 下一页 | 是/否 | 是/否 |

## 4. 录制选择器

使用：

```bash
playwright codegen "$ZDT_BASE_URL"
```

人工完成：

```text
登录 → 进入订单页面 → 设置日期 → 查询 → 翻页 → 导出或进入详情
```

把选择器填到：

```text
config/selectors.yaml
```

优先选择稳定 locator：

```text
1. data-testid / aria role / label
2. name / placeholder
3. 按钮文字
4. 结构化 CSS
5. XPath 仅作为最后手段
```

## 5. 登录态实现

执行：

```bash
zdt-sync auth login
```

流程：

```text
打开有界面浏览器
人工登录智店通
确认登录成功
保存 Playwright storage_state
后续采集复用登录态
```

如果遇到短信验证码/扫码/MFA，只允许人工完成，不写绕过逻辑。

## 6. 采集模式选择

每个数据域按优先级选择：

### 6.1 导出 Excel/CSV 模式

适合库存、商品、订单报表。

优点：字段完整、业务可核对。

命令示例：

```bash
zdt-sync collect inventory --mode export
```

### 6.2 页面表格模式

适合列表页字段够用、数据量不大的场景。

命令示例：

```bash
zdt-sync collect orders --mode table --since "2026-05-28 00:00:00"
```

### 6.3 页面内 XHR 响应监听模式

适合页面由 JSON 接口渲染的场景，但必须通过正常页面操作触发，不允许高频直接打隐藏接口。

命令示例：

```bash
zdt-sync collect orders --mode network --since "2026-05-28 00:00:00"
```

## 7. 数据库表

基础表：

```text
sync_state      每个实体的 cursor / last_sync_time
sync_job        每次任务的状态、耗时、错误、截图、trace
raw_records     原始采集数据，按 entity 存 JSON
```

上线到正式进销存前，至少要补充：

```text
staging_orders
staging_order_lines
staging_inventory
staging_products
staging_refunds
staging_transfers
sku_mapping
store_mapping
```

## 8. 幂等设计

建议业务主键：

| 实体 | 幂等键 |
|---|---|
| orders | order_no + sku + line_no |
| inventory | store_code + warehouse_code + sku |
| products | sku 或 barcode |
| refunds | refund_no + sku + line_no |
| transfers | transfer_no + sku + line_no |

没有稳定主键时，使用字段 hash：

```text
record_hash = sha256(entity + sorted_json(record))
```

## 9. 增量策略

### 9.1 有更新时间字段

```text
where updated_at > last_success_time - 5 minutes
```

保留 5 分钟回看窗口，避免漏采。

### 9.2 没有更新时间字段

```text
订单/退款：按创建时间回看 1-2 小时
库存：按门店/SKU 扫描并 hash 比对
商品：每 10-30 分钟增量，每天一次全量校验
```

### 9.3 成功后才推进状态

只有数据完整写入 staging 后，才能更新 `sync_state`。

## 10. 测试流程

### 10.1 本地测试

```bash
pytest -q
zdt-sync db init
zdt-sync auth check
```

### 10.2 单门店小流量试跑

```bash
zdt-sync collect orders --store STORE001 --since "2026-05-28 00:00:00" --headful
zdt-sync status
```

检查：

```text
是否采到数据
字段是否错位
分页是否完整
重复数据是否被去重
失败时是否有截图和 trace
```

### 10.3 多门店试跑

```bash
zdt-sync collect orders --store all --incremental
zdt-sync collect inventory --store all
```

## 11. 部署流程

```text
1. 服务器安装 Docker、Python、Playwright 浏览器依赖。
2. 配置 .env、selectors.yaml、stores.yaml。
3. 运行 docker compose up -d postgres redis。
4. 运行 zdt-sync db init。
5. 运行 zdt-sync auth login 人工保存登录态。
6. 配置 cron 或 systemd timer。
7. 配置日志保留和告警。
```

## 12. 调度建议

```text
订单：每 1-2 分钟
库存：每 3-5 分钟
退货：每 2-5 分钟
商品：每 10-30 分钟
调拨/入库：每 5-10 分钟
每日对账：每天 02:00
```

## 13. 监控指标

```text
last_success_time
last_error
row_count
job_duration_seconds
failed_jobs_count
login_state_valid
records_duplicate_count
records_changed_count
库存差异数量
订单缺失数量
```

## 14. OpenClaw 制作任务拆分

让 OpenClaw 按以下顺序制作：

```text
任务 1：安装依赖并跑通 zdt-sync --help。
任务 2：配置 .env、启动 PostgreSQL、执行 zdt-sync db init。
任务 3：用 zdt-sync auth login 保存登录态。
任务 4：录制 orders 页面选择器并更新 selectors.yaml。
任务 5：完成 orders 表格模式采集，单门店试跑。
任务 6：完成 inventory 表格/导出模式采集。
任务 7：完成 products/refunds/transfers。
任务 8：添加 staging 表和字段映射。
任务 9：添加 cron/systemd 定时任务。
任务 10：添加失败告警、日报、库存/订单对账。
```

## 15. 验收标准

```text
1. zdt-sync collect orders --incremental 可连续运行 24 小时。
2. 任务失败时不会推进 cursor。
3. 失败任务有 screenshot/trace。
4. 重复执行不会重复入库。
5. 登录态过期会报错并提示人工刷新。
6. 库存和订单有日报对账结果。
7. 页面改版后只需要改 selectors.yaml 或少量 collector 代码。
```
