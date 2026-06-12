# 数据血缘规范

## 强制字段

每条业务数据必须记录：

- source_system
- source_page_or_file
- collected_at
- parsed_at
- written_at
- operator_or_agent
- evidence_path
- sync_status

## 禁止

- 禁止只保存前端展示值，不保存来源。
- 禁止把旧快照当作当天来源。
- 禁止把 OpenClaw、脚本或 AI 摘要当作唯一事实源。

## 标准链路

```text
raw_data -> parsed_data -> retail_db -> API -> frontend -> acceptance
```

