# 价格促销满减后国补前零售价 BUG 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `latest-published-product-projection.json` 中 26+ 个 SKU 因"促销满减叠加后国补前零售价计算错误"导致的 4 终端 drift / 国补后价公式不符 / 教补超 500 上限 等 BUG。

**Architecture:**
- 数据层：直接修 `apps/web-cockpit/public/data/latest-published-product-projection.json` 和镜像 `apps/inventory-sync/artifacts/latest-published-product-projection.json`（数据源是 `priceEngine.ts` 写盘前的 promoBoost 数据，源头是 `marketingBoostStore.ts` 的源数据）
- 审计层：扩 `apps/inventory-sync/src/inventoryQuote/retailPriceAudit.ts` 加入新检查项：`educationDiscountAmount` 笔记本 500 cap / 非笔记本 必须 0
- 触发层：`sync_inventory_terminal_state.py` 末尾自动 `npm run build:sn-reconciliation-snapshot` 仍跟随，无新加
- 验收层：`python3 scripts/audit_terminal_price_consistency.py` mismatchCount=0 + 新增 `audit_education_caps` 0 violations

**Tech Stack:** TypeScript / Python / JSON / SQLite (retail-core)

---

## Task 1: 修复 5 个笔记本 SKU 教补 > 500 cap 违规

**Files:**
- Modify: `apps/web-cockpit/public/data/latest-published-product-projection.json`
- Modify: `apps/inventory-sync/artifacts/latest-published-product-projection.json`
- Read evidence: `apps/inventory-sync/src/inventoryQuote/priceEngine.ts:591-596`（已确认 `getNotebookEducationAddBackAmount` 写明 `Math.min(amount, 500)` cap）
- Read rule: `docs/ai-context/00_LOADED_RULES.md` C 节 + `02_DECISIONS.md` 笔记本教补封顶 500

### Bug 列表（5 SKU）
| SKU | 类别 | 教补（当前） | 教补（应 cap） | adjustedPreSubsidy（修后） | finalPrice（修后） |
|---|---|---|---|---|---|
| 20007961 YOGA Air 14 Aura | 轻薄笔记本 | 1000 | 500 | 10299 | 8749.15 |
| 20007939 Y9000P | 游戏笔记本 | 2000 | 500 | 15899 | 14399 |
| 20007953 YOGA Air 14 Ultra | 轻薄笔记本 | 1000 | 500 | 15339 | 13839 |
| 20007957 YOGA Air 14 Ultra | 轻薄笔记本 | 1000 | 500 | 10699 | 9094.15 |
| 20007941 Y9000P | 游戏笔记本 | 2000 | 500 | 17899 | 16399 |

- [ ] **Step 1.1: 写失败测试** — 扩 `retailPriceAudit.ts` 加 `audit_education_caps` 函数，对 5 个 SKU 跑出 violations
- [ ] **Step 1.2: 跑测试确认失败** — `cd apps/inventory-sync && npm run build:retail-zone` 触发的下游审计应报 5 个 violations
- [ ] **Step 1.3: 写最小修复** — 直接 patch JSON 把 5 个 SKU 的 `educationDiscountAmount` 改 500，同步 recalc `adjustedPreSubsidyPrice` / `finalPrice` / `nationalSubsidyPrice` / `baseNationalSubsidyPrice`
- [ ] **Step 1.4: 跑测试确认通过** — violations 应为 0；`audit_terminal_price_consistency.py` 仍 0 mismatch
- [ ] **Step 1.5: commit** — `git add` 2 个 JSON + retailPriceAudit.ts

## Task 2: 修复 2 个平板电脑 SKU 教补错误应用 (20007794 / 20007795)

**Files:**
- Modify: 同 Task 1

### Bug 列表（2 SKU）
| SKU | 类别 | sourceCategory | 教补（当前） | 教补（应） | adjustedPreSubsidy（修后） | finalPrice（修后） |
|---|---|---|---|---|---|---|
| 20007794 拯救者 Y900 13 AI平板 | 平板电脑 | 拯救者平板 | 200 | 0 | 3799 | 3229.15 |
| 20007795 拯救者 Y900 13 AI平板 | 平板电脑 | 拯救者平板 | 200 | 0 | 4199 | 3569.15 |

- [ ] **Step 2.1: 写失败测试** — `audit_education_caps` 扩到检查"非笔记本 SKU 教补必须 0"
- [ ] **Step 2.2: 跑测试确认失败** — 应报 2 个 violations
- [ ] **Step 2.3: 写最小修复** — 把 2 个 SKU 的 `educationDiscountAmount` 改 0，recalc 4 字段
- [ ] **Step 2.4: 跑测试确认通过** — 0 violations
- [ ] **Step 2.5: commit**

## Task 3: 修复 19 个 SKU `baseNationalSubsidyPrice` drift

### Bug 列表（19 SKU）
baseNationalSubsidyPrice vs nationalSubsidyPrice 不一致，需要 audit 决定是否要 reset 到一致
（这通常是"门店已手动校准防流失补贴后价"或"营销价冲销"造成的——按 AGENTS.md 决策应 freeze 当前值，仅 audit 报告，不自动改写）

- [ ] **Step 3.1: 写失败测试** — `audit_education_caps` 扩 `audit_base_nat_drift` 报告 19 个 SKU，但**不**自动改写（按"销售出库当天证据冻结"原则）
- [ ] **Step 3.2: 跑测试确认失败** — 应报 19 个 drift（warning 级别）
- [ ] **Step 3.3: 仅 audit 报告，不修** — 在审计报告中归类为 `known_manual_override_drift`，不强行改
- [ ] **Step 3.4: 跑测试确认 audit 通过** — 0 hard violations，19 warnings 列入
- [ ] **Step 3.5: commit**

## Task 4: 增强 `retailPriceAudit.ts` 与 `audit_terminal_price_consistency.py` 检查面

**Files:**
- Modify: `apps/inventory-sync/src/inventoryQuote/retailPriceAudit.ts`
- Modify: `scripts/audit_terminal_price_consistency.py`

- [ ] **Step 4.1: TypeScript 端加 `audit_education_caps`** — 笔记本 ≤ 500 / 非笔记本 = 0；输出 violations list
- [ ] **Step 4.2: Python 端加同款检查** — 同步到 `audit_terminal_price_consistency.py`，合并入 `mismatchCount`
- [ ] **Step 4.3: 跑两个 audit** — 0 hard violations，19 warnings
- [ ] **Step 4.4: 重新写 `latest-terminal-price-consistency-audit.json`** — 报告固化
- [ ] **Step 4.5: commit**

## Task 5: 全量 4 终端一致性 + 端到端验证

**Files:**
- Modify: 同 Task 1-2
- Run: `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 验证整条链路

- [ ] **Step 5.1: 跑 `npm run build:retail-zone`** — 重建 retail-zone snapshot
- [ ] **Step 5.2: 跑 `npm run build:standard-price-master`** — 重建标准价主档
- [ ] **Step 5.3: 跑 `python3 scripts/sync_inventory_terminal_state.py`** — 写盘 60 个 snapshot 文件
- [ ] **Step 5.4: 跑 `python3 scripts/audit_terminal_price_consistency.py`** — `mismatchCount=0`
- [ ] **Step 5.5: 跑 `cd apps/inventory-sync && npm run audit:terminal-titles`** — 标题 audit 仍 0 issue
- [ ] **Step 5.6: 跑 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`** — outcome 应维持 `executed_not_closed`，无新增 violations
- [ ] **Step 5.7: commit** + 更新长期记忆

## Task 6: taste-skill UI 收口（最后一步）

- [ ] **Step 6.1: 打开 5174 真实页面看 5 个修后 SKU 的零售卡片** — 用 `browser` 技能或 `playwright` 打开 `http://127.0.0.1:5174/retail-live` 检查视觉密度、表格感、状态语义、字号、对齐、激活态
- [ ] **Step 6.2: 视觉核对** — design read: 联想官网式信息表达 + 京东/智店通式业务台账，遵循 19_RETAIL_UI_RESTYLE_PLAYBOOK.md
- [ ] **Step 6.3: design-critic 自查** — Accessibility / Typography / Layout / Usability
- [ ] **Step 6.4: 截图存档** — 写到 `apps/inventory-sync/artifacts/frontend-visible-verifications/2026-06-08-price-bug-fix/`
- [ ] **Step 6.5: 更新 long-term memory** — `01_CURRENT_STATE.md` / `09_CODEX_HANDOFF.md` / `03_TASK_LOG.md` / `04_NEXT_ACTIONS.md` 全部更新
- [ ] **Step 6.6: 重打包 context** — `bash scripts/context_pack.sh && python3 scripts/context_snapshot.py`
