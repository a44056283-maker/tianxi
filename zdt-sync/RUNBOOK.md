# zdt-sync 运维手册

## 1. 查看状态

```bash
zdt-sync status
```

## 2. 人工刷新登录态

```bash
zdt-sync auth login
zdt-sync auth check
```

## 3. 单门店手动采集

```bash
zdt-sync collect orders --store STORE001 --since "2026-05-28 00:00:00" --until now --headful
zdt-sync collect inventory --store STORE001 --headful
```

## 4. 增量采集

```bash
zdt-sync collect orders --incremental
zdt-sync collect refunds --incremental
zdt-sync collect transfers --incremental
```

## 5. 查看失败 job

```bash
zdt-sync status --failed
```

## 6. 重跑任务

```bash
zdt-sync replay --job-id 123 --headful
```

## 7. 查看 trace

```bash
playwright show-trace artifacts/traces/<trace-file>.zip
```

## 8. 常见故障

### 登录态失效

表现：页面跳回登录页、采集结果为空、auth check 失败。

处理：

```bash
zdt-sync auth login
```

### 页面选择器失效

表现：等待 selector 超时。

处理：

```text
1. 打开 artifacts/screenshots。
2. 打开 trace。
3. 用 playwright codegen 重新录制。
4. 更新 config/selectors.yaml。
```

### 表格字段错位

表现：字段值进错列。

处理：

```text
1. 检查 columns 顺序。
2. 检查是否有隐藏列。
3. 检查是否有合并单元格。
4. 必要时改成导出 Excel 模式。
```

### 数据重复

表现：raw_records 重复增加。

处理：

```text
1. 检查 record_id_fields。
2. 确认订单行是否有 line_no。
3. 没有稳定主键时使用 hash。
```

### 数据漏采

表现：订单对账缺失。

处理：

```text
1. 增量窗口加 5-30 分钟回看。
2. 日终跑全量/半全量校验。
3. 检查分页是否完整。
4. 检查状态字段过滤条件。
```
