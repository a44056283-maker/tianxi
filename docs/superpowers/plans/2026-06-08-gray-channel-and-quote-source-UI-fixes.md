# 灰渠真实采集 + 报价来源 UI 全面同步 ERP/JD 主题 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"查看公众号"和"完成灰渠采集"在系统里成为两件可区分的事，并把 `报价来源` 子书签 6 个 tab 的视觉壳统一到 2026-06-05 ERP/POS 京东蓝灰高密度主题。

**Architecture:**
- 灰渠侧：把"采集计划 + 入口访问证据 + 落盘原文"三步固定为强制流，缺任一步都对应明确终态；前端 5174 可见一张"采集状态卡"。
- UI 侧：纯 CSS 覆盖 `apps/web-cockpit/src/App.css` 中所有报价来源子区块；不动 React 组件树、不动 zustand store、不动业务数据。

**Tech Stack:** TypeScript（strict）, Node.js, React, Vite, vitest（新增最小测试框架）, Playwright（视觉验证）。

**约束：** 不动智店通 / 群报价 / 京东 / 联想 / 竞品 / 出入库 / SN / 保修逻辑；不引新依赖；不动 retail-ops-terminal / backend-console / prompt-workspace-standalone 的深色主题。

---

## Task 0：加 vitest 最小配置 + 回归测试基线

**Files:**
- Create: `apps/inventory-sync/vitest.config.ts`
- Create: `apps/inventory-sync/src/storage/__tests__/grayChannelFixtures.ts`
- Modify: `apps/inventory-sync/package.json`（加 `test` 脚本）

- [ ] Step 1: 写 vitest 配置 `apps/inventory-sync/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
  },
})
```

- [ ] Step 2: 写 fixtures `apps/inventory-sync/src/storage/__tests__/grayChannelFixtures.ts`

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function makeTmpArtifactDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gray-channel-fixtures-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function fakeVisitEvidence(articleDate: string) {
  return [
    '# 灰渠公众号入口访问证据',
    `# 访问时间: ${new Date().toISOString()}`,
    `# 可见文章日期: ${articleDate}`,
    '# 入口: 文件传输助手聊天记录区下方固定公众号入口 -> 公众号底部日期报价按钮',
    '',
  ].join('\n')
}

export function fakeRawText(quoteDate: string) {
  return [
    `报价日期 ${quoteDate}`,
    '拯救者 Y9000P 2024 9499',
    '小新 Pro 16 5699',
    '来酷 Pro 16 i5 4899',
  ].join('\n')
}
```

- [ ] Step 3: `apps/inventory-sync/package.json` 增 `test` 和 `test:watch` 脚本。

- [ ] Step 4: 跑 baseline `cd apps/inventory-sync && npm test`，Expected: exit 0, no test files found.

- [ ] Step 5: commit `git add vitest.config.ts package.json src/storage/__tests__/grayChannelFixtures.ts && git commit -m "test: add vitest baseline + gray channel fixtures"`

---

## Task 1：grayChannelCollector capture plan + visit evidence（TDD）

**Files:**
- Modify: `apps/inventory-sync/src/storage/grayChannelCollector.ts`
- Create: `apps/inventory-sync/src/storage/grayChannelCollector.test.ts`

- [ ] Step 1: 写测试 `apps/inventory-sync/src/storage/grayChannelCollector.test.ts`（capture-plan 写盘校验 / visit evidence 落盘 / 非法日期拒绝 三个 case）
- [ ] Step 2: 跑 `npm test`，Expected: 3 tests fail
- [ ] Step 3: 在 `grayChannelCollector.ts` 末尾追加 `prepareGrayChannelCapturePlan` + `recordGrayChannelVisitEvidence` + 类型 `GrayChannelCapturePlan` / `GrayChannelCapturePlanResult` / `GrayChannelVisitEvidenceResult`、日期正则 `VISIT_ARTICLE_DATE_PATTERN`、工具函数 `getTodayDateString` / `getTodayMenuButtonText`
- [ ] Step 4: 跑 `npm test`，Expected: 3 tests pass
- [ ] Step 5: `npm run build` exit 0
- [ ] Step 6: commit `feat(gray-channel): capture plan + visit evidence persistence`

---

## Task 2：grayWholesaleQuoteParser 入参守卫（TDD）

**Files:**
- Modify: `apps/inventory-sync/src/storage/grayWholesaleQuoteParser.ts`
- Create: `apps/inventory-sync/src/storage/grayWholesaleQuoteParser.test.ts`

- [ ] Step 1: 写测试（visit-evidence 拒绝 + evidenceChain 写入 两个 case）
- [ ] Step 2: 跑测试确认失败
- [ ] Step 3: 改 `SaveGrayWholesaleSnapshotOptions` 类型加 `visitEvidencePath` / `capturePlanPath`，在 `GrayWholesaleSnapshot` 加 `evidenceChain?` 字段；函数体在写盘前 `fs.stat(options.visitEvidencePath)` 检查，不存在则 throw `Missing gray channel visit evidence at ...`
- [ ] Step 4: 跑测试通过
- [ ] Step 5: `npm run build` exit 0
- [ ] Step 6: commit `feat(gray-channel): visit-evidence guard + evidence chain in snapshot`

---

## Task 3：scheduledTasks.ts 三步流程 + 5 分支终态映射（TDD）

**Files:**
- Modify: `apps/inventory-sync/src/automation/scheduledTasks.ts`
- Create: `apps/inventory-sync/src/automation/scheduledTasks.grayChannel.test.ts`

- [ ] Step 1: 写测试（5 分支 case：real_completed / blocked_missing_input-rawStale / executed_not_closed-visitStale / blocked_missing_input-noRaw / blocked_page_risk-noVisit）
- [ ] Step 2: 跑测试确认失败
- [ ] Step 3: 改 `scheduledTasks.ts`：新增 `loadGrayChannelVisitEvidence()`（从 `gray-channel-visible-article-YYYY-MM-DD.txt` 解析可见文章日期）；把 `daily-gray-channel-check` 块整体替换为三步流程：prepare_gray_channel_capture_plan → record_gray_channel_visit_evidence → parse_gray_wholesale，并把 `rebuildDerivedSnapshots` + `findLatestTaskVisibleEvidence` 保留在末尾；`rebuildDerivedSnapshots` 末尾同步生成 `latest-gray-channel-capture-plan.json` / `latest-gray-channel-visible-article.json` 两个快照别名供前端 fetch
- [ ] Step 4: 跑 `npm test`，Expected: 10/10 pass
- [ ] Step 5: `npm run build` exit 0
- [ ] Step 6: commit `feat(gray-channel): 5-branch state machine + visit evidence gate`

---

## Task 4：renderQuoteSourceBlock 新增"采集计划与可见文章证据"卡片

**Files:**
- Modify: `apps/web-cockpit/src/App.tsx`

- [ ] Step 1: 在 `renderQuoteSourceBlock` 函数 `renderUnifiedBlockHead` 之后、`bookmark-tabs` 之前插入 `<div className="gray-capture-status-card">` 块（含 head + 3 行 status row：采集计划 / 入口访问证据 / 当天原文，行 class 走 `ok` / `warn` / `idle`）
- [ ] Step 2: 在 App.tsx state 区加 `grayChannelCapturePlan` / `grayChannelVisitEvidence` 两个 useState
- [ ] Step 3: 在 useEffect 拉取快照列表里追加 fetch `latest-gray-channel-capture-plan.json` / `latest-gray-channel-visible-article.json`
- [ ] Step 4: `cd apps/web-cockpit && pnpm build` exit 0
- [ ] Step 5: commit `feat(ui): gray channel capture status card in quote source block`

---

## Task 5：App.css 报价来源子区块全量 ERP/JD 浅色主题

**Files:**
- Modify: `apps/web-cockpit/src/App.css`

- [ ] Step 1: 在 `.cockpit-shell:not(.retail-ops-page):not(.backend-console-page):not(.prompt-workspace-standalone-page)` 作用域下追加约 280 行 CSS，覆盖：
  - `.quote-source-block` / `.quote-library-panel` / `.quote-library-category-list` / `.quote-library-series-list` / `.quote-task-list` / `.competitor-rank-strip` → 浅色背景
  - `.quote-library-filter-tabs` / `.quote-library-filter-tabs.series-tabs` → `#f4f7ff` 浅蓝底
  - `.quote-library-filter-tabs button` → `#ffffff` 底 + `#172033` 文字 + 1px `#dfe4ec` 边
  - `.quote-library-filter-tabs button.active` → `#2f6fe4` 实色 + 白字
  - `.quote-library-filter-tabs button span` → `#174ea6` 主蓝数字 + `#edf4ff` 浅蓝胶囊
  - `.quote-library-category-card` / `.quote-library-series-card` / `.quote-task-card` → `#ffffff` + 1px `#dfe4ec` + 4px 阴影
  - `.quote-library-model-row` → 行间 `#edf0f5` 分隔
  - `.sales-history-summary-card` → 白底 22px 主标题 / `.sales-history-summary-card.emphasis` → `#f0fdf4` 浅绿 + `#16a34a` 边
  - `.competitor-monitor-notes` → 浅色 details
  - `.competitor-brand-tabs button` / `.active` → 与库筛选统一
  - `.competitor-rank-card` → 白底 + 京东红 `#e2231a` 顶部 3px / `.think` 蓝顶
  - 新增 `.gray-capture-status-card` / `.gray-capture-status-head` / `.gray-capture-status-rows` / `.gray-capture-status-row` 4 个新类，含 `.ok` / `.warn` / `.idle` 三种状态
- [ ] Step 2: `cd apps/web-cockpit && pnpm build` exit 0
- [ ] Step 3: commit `feat(ui): quote-source subtabs full ERP/JD light theme coverage`

---

## Task 6：semiAuto taskPlanner 加 capture/visit 缺口条目

**Files:**
- Modify: `apps/inventory-sync/src/semiAuto/taskPlanner.ts`

- [ ] Step 1: 定位 `daily-gray-channel-check` 半自动计划块
- [ ] Step 2: 末尾追加 `gray-channel-capture-plan` / `gray-channel-visit-evidence` 两条缺口
- [ ] Step 3: `cd apps/inventory-sync && npm run build` exit 0
- [ ] Step 4: commit `feat(semi-auto): gray channel capture/visit evidence gap items`

---

## Task 7：13_SCHEDULED_TASK_SOPS.md 灰渠章节扩写 + 长期记忆更新

**Files:**
- Modify: `docs/ai-context/13_SCHEDULED_TASK_SOPS.md`
- Modify: `docs/ai-context/01_CURRENT_STATE.md`
- Modify: `docs/ai-context/04_NEXT_ACTIONS.md`
- Modify: `docs/ai-context/09_CODEX_HANDOFF.md`
- Modify: `docs/ai-context/10_TEST_LOG.md`

- [ ] Step 1: 在 13_SCHEDULED_TASK_SOPS.md「灰渠公众号批发价继续每日执行」段后追加「灰渠公众号入口访问与采集计划固定流」章节（含三步流程、5 分支终态映射表、守卫规则）
- [ ] Step 2: 更新 01_CURRENT_STATE.md 顶部加 2026-06-08 灰渠真实采集 + 报价来源 UI 同步段（本轮真实动作、新增产物、authoritative 结果、诚实边界、接手注意）
- [ ] Step 3: 更新 04_NEXT_ACTIONS.md 顶部加 2026-06-08 灰渠真实采集 + UI 同步的下一步（含测试 10/10、build 双 0、5 分支跑过、视觉一致等验收点）
- [ ] Step 4: 更新 09_CODEX_HANDOFF.md 与 10_TEST_LOG.md 收口段
- [ ] Step 5: commit `docs(ai-context): gray channel 3-step flow + 5-branch state machine`

---

## Task 8：taste-skill UI 收口 + 视觉验证

**Files:**
- Create: `apps/inventory-sync/artifacts/manual/visual-2026-06-08-quote-source-{jdMonitor,tasks,distributorLibrary,grayLibrary,competitors,rawSources}.png` × 6
- (no production code change unless finding issues)

- [ ] Step 1: 启动 dev `cd apps/web-cockpit && pnpm dev --host 127.0.0.1`，等待 5174
- [ ] Step 2: Playwright 切到「报价来源」子书签，依次截 6 个 tab
- [ ] Step 3: taste-skill 6 维度评分：variance / motion / density / readability / hierarchy / consistency。如发现 < 0.7，回 Task 4 / Task 5 微调
- [ ] Step 4: 无需调整则 commit `chore(visual): quote-source 6-tab screenshots for UI review`

---

## Task 9：全量 build / audit / 收口

- [ ] Step 1: `cd apps/inventory-sync && npm run build` && `cd apps/web-cockpit && pnpm build`，Expected: both exit 0
- [ ] Step 2: `python3 scripts/audit_terminal_price_consistency.py` && `python3 scripts/audit_terminal_title_consistency.py`，Expected: 0 mismatch / 0 issue
- [ ] Step 3: `cd apps/inventory-sync && npm test`，Expected: 10/10 pass
- [ ] Step 4: `cd apps/inventory-sync && npm run build:semi-auto-plan`，Expected: `latest-semi-auto-execution-plan.json` 含两条新缺口
- [ ] Step 5: `bash scripts/context_pack.sh && python3 scripts/context_snapshot.py`
- [ ] Step 6: `git status --short` 视情况 add + commit

---

## 验收门禁

- 10/10 vitest 测试通过
- 前后端 build 都 exit 0
- 终端一致性审计 0 mismatch / 0 issue
- 5 分支终态映射跑过 e2e
- 6 个报价来源 tab 在 5174 主页面视觉一致
- 长期记忆更新完毕
- 没有动智店通 / 群报价 / 京东 / 联想 / 竞品 / 出入库 / SN / 保修逻辑
- 没有动 retail-ops-terminal / backend-console / prompt-workspace-standalone 的深色主题
