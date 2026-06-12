# 智店通页面选择器录制指南

本项目是否能稳定运行，关键在 `config/selectors.yaml`。

## 1. 使用 Playwright codegen

```bash
source .venv/bin/activate
playwright codegen "$ZDT_BASE_URL"
```

然后人工操作：

```text
登录
打开订单页面
选择日期
选择门店
点击查询
点击下一页
打开库存页面
点击导出
```

Playwright 会生成代码，把其中稳定的 locator 整理到 YAML。

## 2. 选择器优先级

优先级从高到低：

```text
1. data-testid / data-test / data-cy
2. get_by_role，例如 button name=查询
3. get_by_label，例如 开始日期
4. get_by_placeholder，例如 请输入SKU
5. 文本，例如 text=销售订单
6. 稳定 CSS，例如 table.orders-table tbody tr
7. XPath，仅作为最后手段
```

## 3. selectors.yaml 格式

```yaml
entities:
  orders:
    enabled: true
    start_url: "/orders"
    menu_selector: "text=销售订单"
    wait_selector: "table tbody tr"
    filters:
      start_date: "input[name='startDate']"
      end_date: "input[name='endDate']"
      store: "select[name='store']"
      search_button: "button:has-text('查询')"
    table:
      rows: "table tbody tr"
      cells: "td"
      next_page: "button:has-text('下一页')"
      next_page_disabled_attr: "disabled"
      columns:
        - order_no
        - order_time
        - store_code
        - sku
        - product_name
        - qty
        - amount
        - status
      record_id_fields:
        - order_no
        - sku
```

## 4. 如何处理 iframe

如果页面在 iframe 中，配置：

```yaml
frame_selector: "iframe[name='main']"
```

采集器会在该 frame 内查找表格。

## 5. 如何处理导出

```yaml
export:
  button: "button:has-text('导出')"
  download_timeout_ms: 120000
  file_type: "xlsx"
```

命令：

```bash
zdt-sync collect inventory --mode export --headful
```

## 6. 如何处理网络 JSON

如果页面表格由 XHR JSON 加载，可以配置：

```yaml
network:
  capture_url_contains: "/api/order/list"
  json_path: "data.records"
```

命令：

```bash
zdt-sync collect orders --mode network --headful
```

注意：必须由正常页面操作触发，不要高频直接请求隐藏接口。

## 7. 选择器变更处理

页面改版时：

```text
1. 先运行 headful 模式复现失败。
2. 查看 artifacts/screenshots 和 artifacts/traces。
3. 用 codegen 重新录制失败页面的选择器。
4. 只更新 selectors.yaml。
5. 单门店试跑。
6. 通过后恢复定时任务。
```
