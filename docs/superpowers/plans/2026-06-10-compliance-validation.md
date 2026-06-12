# 合规校验预警系统 — 实施计划

> 任务批次：联想智慧零售合规校验 + 预警系统
> 创建日期：2026-06-10
> 执行代理：compliance-agent (Subagent S8, Batch 2)
> 项目目录：`/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`

---

## 背景与目标

对联想零售业务的库存/价格/SN/采购等数据进行合规风险检测，主动推送预警到店长 + 服务顾问。

---

## 数据库现状评估

| 表名 | 行数估算 | 说明 |
|------|---------|------|
| `serial_item` | ~1700 | SN状态跟踪 |
| `sales_order_line` | ~1600+ | 含 serial_number 字段 |
| `inventory_movement` | 大量 | 流水记录 |
| `purchase_order_line` | 大量 | 采购价格 |
| `education_scan_record_v2` | 中等 | 教育补贴记录 |
| `sku` | 中等 | SKU主数据 |

**扫描策略**：
- SN一致性规则 → 基于 JOIN 全量比对，数据量 < 2000，**全量扫描**
- 库存流水一致性 → 全量 SUM/GROUP BY，数据量大但可增量，**全量扫描 + 缓存**
- 价格规则 → 全量扫描
- 采购价异常 → 全量 GROUP BY
- 教育补合规 → 全量扫描

---

## 规则清单

| # | 规则ID | 规则名 | 严重等级 | 描述 |
|---|--------|--------|---------|------|
| R1 | `sn_status_inconsistency` | SN状态一致性 | **critical** | `serial_item.status` ≠ `sales_order_line` 关联状态 |
| R2 | `inventory_movement_mismatch` | 库存数 vs 流水一致性 | **high** | 库存 SUM vs 流水净变化不一致 |
| R3 | `retail_price_violation` | 零售价规则违反 | **high** | 价格不以99结尾 / 低于成本价 / 超过国补上限 |
| R4 | `purchase_price_anomaly` | 采购价异常 | **medium** | 单价偏离同类均值 > 30% |
| R5 | `education_subsidy_violation` | 教育补/营销活动合规 | **high** | 教育补价格超出活动范围、SN未匹配 |

---

## 三阶段计划

### Phase 1 — 今天（2026-06-10）：架构 + 规则引擎 + SN一致性规则验证

**目标**：完成规则引擎框架 + R1 SN一致性 + 基础设施

#### 交付物

- [x] **Plan** `docs/superpowers/plans/2026-06-10-compliance-validation.md`
- [x] **数据库迁移** `migrations/2026-06-10-compliance.sql`
  - `compliance_rule` 表（规则注册）
  - `compliance_violation` 表（违规记录）
  - `compliance_alert` 表（预警记录）
- [x] **规则引擎** `app/compliance_rules.py`
  - `ComplianceRule` 数据类
  - `RuleEngine` 类：注册、运行、结果收集
  - R1 `sn_status_inconsistency` 规则实现
- [x] **API 路由** `app/compliance_api.py`
  - `POST /api/compliance/check/run` — 运行全量规则扫描
  - `GET /api/compliance/violations` — 列出违规（支持过滤）
  - `POST /api/compliance/violations/{id}/acknowledge`
  - `POST /api/compliance/violations/{id}/resolve`
  - `GET /api/compliance/alerts`
  - `GET /api/compliance/rules`
  - `POST /api/compliance/rules` — 动态注册规则
  - `GET /api/compliance/stats` — 统计摘要
- [x] **路由注册** `app/main.py` — 引入 compliance_router + worker 启动
- [x] **后台 Worker** `app/compliance_worker.py` (Phase1 stub)
  - 启动时立即运行一次全量扫描
  - Phase2 将添加60分钟定时循环
- [x] **前端骨架** `apps/web-cockpit/src/components/ComplianceCenter.tsx`
  - KPI 卡片（今日critical/high、待处理、已确认、已解决）
  - 违规列表表格（带过滤：严重等级/状态/规则）
  - 确认/解决操作按钮
  - 规则管理页
- [x] **测试** `tests/test_compliance.py`
  - 规则引擎基础测试
  - R1~R5 各规则测试
  - API 端点测试
  - 违规确认/解决状态测试

#### 验证标准 ✅
- `pytest apps/api-server/tests/test_compliance.py` → **10 passed, 5 skipped**
- `POST /api/compliance/check/run` → **200 OK, 5 rules, 0 errors, ~1200ms**
- `GET /api/compliance/rules` → **200 OK, 5 rules**
- `GET /api/compliance/stats` → **200 OK, 7383 critical today**
- `POST /api/compliance/violations/:id/acknowledge` → **200 OK**
- `POST /api/compliance/violations/:id/resolve` → **200 OK**
- 前端 `vite build` → **exit 0, built in 1.02s**
- 实时检测: **7383 critical + 4361 high = 11744 violations**
  - 主要是 R1 SN一致性（SN sold但无出库流水）

---

### Phase 2 — 明天至后天（2026-06-11 ~ 2026-06-12）：4个剩余规则 + 后台扫描 Worker

**目标**：完成所有5个规则 + 后台定时扫描

#### 待办
- [ ] R2 库存数 vs 流水一致性规则
- [ ] R3 零售价规则违反规则（价格99结尾、成本价、国补上限）
- [ ] R4 采购价异常规则（偏离均值 > 30%）
- [ ] R5 教育补/营销活动合规规则
- [ ] 后台 Worker：`app/compliance_worker.py`
  - `COMPLIANCE_SCAN_INTERVAL_MS` 环境变量（默认 60 分钟）
  - 启动时立即运行一次
  - `threading.Timer` 循环
  - critical 级别自动写 `compliance_alert`（不实际发 WeChat/SMS）
- [ ] `app/main.py` 启动时注册 worker

#### 验证标准
- 所有5个规则均能在数据库中检测到违规（或确认无违规）
- 后台 worker 进程存活
- 扫描日志可见

---

### Phase 3 — 本周内（2026-06-13 ~ 2026-06-14）：预警推送 + 前端完善

**目标**：预警推送逻辑完善 + 前端交互

#### 待办
- [ ] 前端 `ComplianceCenter.tsx` — 实时数据绑定（接 API）
- [ ] 趋势图（近7天违规数量，使用 recharts 或纯 CSS）
- [ ] 规则管理页（启用/禁用、严重等级调整）
- [ ] 预警列表页（预警状态、已读/未读）
- [ ] `assigned_to` 字段 — 根据违规类型自动分配店长/服务顾问
- [ ] `education_scan_record_v2` 数据规模确认（判断是否需要分页扫描）
- [ ] 端到端验证截图

#### 验证标准
- 前端页面截图清晰显示 KPI + 违规列表 + 趋势图
- 所有 API 200 OK
- `npm run build` 退出 0

---

## 技术架构

```
compliance_rules.py       规则引擎 + 5个规则实现
compliance_api.py          FastAPI 路由
compliance_worker.py       后台定时扫描（Phase2）
ComplianceCenter.tsx       React 前端组件
retail-core.sqlite3         ← compliance_violation / compliance_alert 表
```

## 风险与依赖

| 风险 | 影响 | 缓解 |
|------|------|------|
| `education_scan_record_v2` 表结构未知 | R5 规则开发受阻 | 先查表结构，再实现规则 |
| 预警推送需要真实员工数据 | 无法实际发送 | 开发阶段只写表，不发消息 |
| 大量数据扫描影响性能 | API 超时 | Phase2 实现增量扫描 + 缓存 |

## 输出回执路径

`apps/inventory-sync/artifacts/manual/openclaw/receipts/compliance-agent-2026-06-10-1224.json`
