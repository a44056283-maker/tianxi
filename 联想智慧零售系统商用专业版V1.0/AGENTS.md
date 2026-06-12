# 联想智慧零售系统商用专业版 V1.0 执行规则

本目录是独立商用专业版软件包。所有开发和验收必须先遵守：

```text
docs/governance/AGENTS.md
docs/governance/RULES/*.md
```

## 强制流程

每个开发任务必须按顺序落文档：

```text
TASK_ANALYSIS.md -> IMPLEMENT_PLAN.md -> 开发 -> SELF_REVIEW.md -> docs/delivery/ACCEPTANCE_REPORT.md
```

## 硬规则

- 真实数据优先于功能展示。
- 证据优先于结论。
- SN 优先级最高。
- 缺证据就是待补证据。
- 禁止伪造、猜测、补全不存在的数据。
- 所有业务必须可审计、可追溯。

## 受保护业务字段

门店零售价、库存数量、可售数量、SN 状态、销售金额、实付金额、进货价、供应商、营销 PO、教育补贴、质保时间、产品主标题，必须有来源证据才允许写入。

