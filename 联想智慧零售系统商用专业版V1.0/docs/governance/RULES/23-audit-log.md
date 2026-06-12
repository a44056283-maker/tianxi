# 审计留痕规范

## 必须留痕的动作

- SN 状态变化
- 库存数量变化
- 销售出库
- 采购入库
- 其他出库
- 门店零售价变化
- 营销 PO 和教育补贴变化
- 活动库新增、关闭、过期、恢复
- 质保时间写入

## 审计字段

```text
id, business_key, action_type, before_value, after_value, evidence_path, operator, operated_at, reason
```

## 禁止

- 禁止无审计日志修改受保护业务字段。
- 禁止删除历史活动或历史价格而不保留恢复路径。
