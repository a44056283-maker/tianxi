## 下一步（2026-06-12 06:12 `automation-8` 默认 Chrome 已可读，但刚发生窗口外误复核；下一步严格等到 10:00 之后再产正式批次）

### 已落地
1. ✅ 已确认默认 Chrome 当前会话已可读
   - 已能列出 open tabs
   - 已能认领京东 / 联想官旗 / 前端标签
2. ✅ 已对 `20004481 / ZAE70012CN` 做到真实双源页面 + 前端可见取证
   - 京东锁定页：`主价 1999`、`国补后 1299.75`
   - 联想官旗：`主价 1999`、`预估到手 1569.1`
   - 前端：`商品零售 -> 实时零售报价 -> 20004481` 可见 `执行价 1999`
3. ✅ 已撤回窗口外误生成的正式批次命名
   - 已删除 `manual-price-supplements-20260612-automation-8-visible-chrome-batch-1.json`
   - 已改留痕到：
     - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-12-0612-window-violation/out-of-window-visible-review-20004481.json`

### 仍待推进
1. **北京时间 `2026-06-12 10:00` 之后重新开始正式手工复核**
   - 当前 `06:12 CST` 仍在窗口外
   - 窗口外不要再产生 `manual-price-supplements-20260612*.json`
2. **白天窗口内先从下一个高库存已锁定 SKU 继续**
   - `20006381`
   - `20007936`
   - `20006372`
3. **正式批次只记录窗口内新证据**
   - 可以重新采 `20004481` 作为窗口内正式 batch-1
   - 也可以保留本次窗口外摘要仅作对照，不得直接让 runner 吃入

## 下一步（2026-06-12 04:02 `automation-2` 本轮已清理空锁并重进正式入口，但 authoritative 仍停在旧 runner；下一步先补手工批次或恢复前端可见验收条件）

### 已落地
1. ✅ 已再次触发：
   - `bash scripts/run_scheduled_task.sh daily-jd-lenovo-price-sync`
2. ✅ 已确认这次不是活跃任务长时间占锁，而是空锁：
   - `.scheduled-task.lock` 为空目录
   - `lsof +D .scheduled-task.lock` 无占用
   - 已受控执行 `rmdir .scheduled-task.lock`
3. ✅ 已确认当前 authoritative 最新正式报告仍是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-11T20-04-28-489Z.json`
   - `executionOutcome = executed_not_closed`
4. ✅ 已新增本轮阻塞证据：
   - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-12-0402-empty-lock-and-frontend-blocked/blocking-summary.md`
   - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-12-0402-empty-lock-and-frontend-blocked/visible-preflight-summary.json`

### 仍待推进
1. **白天窗口内继续真实 Chrome 手工复核并生成新批次**
   - 当前仍缺 `2026-06-12` 当天新的 `manual-price-supplements` 批次
   - 没有新批次前，编排层只会继续 `skipped`
2. **补新的前端可见验收证据**
   - 当前 `http://127.0.0.1:5174/` 不可连接
   - 当前 `http://192.168.13.104:5174/` 也不可连接
   - 没有新的页面可见证据前，终态继续保持 `executed_not_closed`
3. **下次若再次排队，先查是否又出现空锁**
   - 当前已有一次空锁样本
   - 不要把“空锁排队”误写成“活跃 runner 正常执行中”

## 下一步（2026-06-12 02:08 `automation-8` 本轮超出手工复核窗口且默认 Chrome 接管失败；下一步只在白天窗口内继续可见复核）

### 已落地
1. ✅ 已确认当前时间：
   - `2026-06-12 02:08 CST`
   - 超出 `10:00-22:00 CST` 手工复核窗口
2. ✅ 已确认当前主阻塞不是“没有待复核队列”
   - `latest-semi-auto-execution-plan.json`
   - `retailPriceVerificationCount = 50`
   - `frontendBlankPriceCount = 0`
3. ✅ 已新增本轮阻塞证据
   - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-12-0208-window-and-access-blocked/blocking-summary.md`
   - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-12-0208-window-and-access-blocked/visible-preflight-summary.json`

### 仍待推进
1. **下一轮只在北京时间 `2026-06-12 10:00` 之后继续 `automation-8`**
   - 窗口外不要再尝试新的京东 / 联想 / 天猫可见复核
2. **白天窗口内先恢复当前线程对默认 Chrome 的可见接管能力**
   - 当前 `mcp__computer_use.get_app_state(app="Google Chrome")` 仍被拒绝
   - 当前 `osascript` 也拿不到 `Google Chrome` 对象
   - 恢复前不能声称做了新的京东/联想手工复核
3. **接管恢复后再继续高库存已锁定 SKU**
   - 仍按已锁定详情页优先、先点规格后读价格
   - 优先白色款、规格未确认款、高库存款

## 下一步（2026-06-12 02:04 `automation-2` 已重跑编排入口但没有当天手工批次；下一步先补真实 Chrome 手工复核或新的本地前端可见证据，不要把 runner 重跑误当收口）

### 已落地
1. ✅ 已再次触发：
   - `bash scripts/run_scheduled_task.sh daily-jd-lenovo-price-sync`
2. ✅ 已确认当前最新 authoritative 正式报告仍是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-11T17-06-03-528Z.json`
   - `executionOutcome = executed_not_closed`
3. ✅ 已确认本轮并没有新的当天手工价格批次文件
4. ✅ 已确认标题 / 价格一致性审计仍通过
   - `latest-terminal-title-consistency-audit.json -> issueCount = 0`
   - `latest-terminal-price-consistency-audit.json -> mismatchCount = 0`

### 仍待推进
1. **继续按 `latest-semi-auto-execution-plan.json` 做真实 Chrome 复核**
   - 当前正式待复核量仍是：
     - `retailPriceVerificationCount = 50`
   - 仍优先高库存、白色款、规格未确认 SKU
2. **补本线程新的前端可见验收证据**
   - 当前 `mcp__computer_use.get_app_state(app="Google Chrome")` 仍被拒绝
   - 当前本地 `pnpm dev --host 127.0.0.1 --port 5174` 触发 `listen EPERM`
   - 没有新的肉眼可见证据前，终态继续保持 `executed_not_closed`
3. **如需再次重跑编排入口，先确认是否已有新的手工批次或新的前端验收条件**
   - 当前报告里 `ingest_manual_marketplace_batch = skipped`
   - 不要在没有新证据输入时重复把 runner 重跑写成推进

## 下一步（2026-06-11 22:18 教育补正式列表显示口径已收口；下一步转到“补 SN / 补正式代扫证据 / SQL 固化”）

### 已落地
1. ✅ 教育补贴群与智店通入库群正式列表已去掉缺单号且缺 SN 的占位记录
2. ✅ 管理端与两个代扫群页面已统一成同一套前端过滤 / 去重口径
3. ✅ `127.0.0.1:5174` 与 `192.168.13.104:5174` 当前都可访问

### 仍待推进
1. **补齐真实缺 SN / 缺正式代扫图的 backlog**
   - 当前只是“前端不再显示占位壳”
   - 还没有把缺口都补成真实正式记录
2. **继续把 CLI 主链实采结果固化回 SQL**
   - 让管理端不只靠静态 summary
   - 要把新口径进一步固化到正式 SQL 输出链
3. **人工复核两个群的边界样本**
   - 优先看：
     - 同手机号跨日补成多件套
     - 明示 `智店通入库群` 水印却曾落到教育补贴群的样本

## 下一步（2026-06-11 22:03 `automation-2` 本轮真实执行只到串行排队；下一步先等活跃锁释放，再继续真实 Chrome 复核与新前端验收）

### 已落地
1. ✅ 已再次触发：
   - `bash scripts/run_scheduled_task.sh daily-jd-lenovo-price-sync`
2. ✅ 已确认当前最新 authoritative 正式报告仍是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-11T13-11-45-355Z.json`
   - `executionOutcome = executed_not_closed`
3. ✅ 已确认当前标题 / 价格一致性审计仍通过
   - `latest-terminal-title-consistency-audit.json -> issueCount = 0`
   - `latest-terminal-price-consistency-audit.json -> mismatchCount = 0`

### 仍待推进
1. **先等当前活跃 `.scheduled-task.lock` 持有实例结束**
   - 本轮只有真实排队，没有新的 runner 完成输出
   - 不要把“排队等锁”误写成正式重跑已完成
2. **继续按 `latest-semi-auto-execution-plan.json` 做真实 Chrome 复核**
   - 当前正式待复核量仍是：
     - `retailPriceVerificationCount = 50`
   - 仍应优先高库存、白色款、规格未确认 SKU
3. **补本线程新的本地前端可见验收证据**
   - 当前 `mcp__computer_use.get_app_state(app="Google Chrome")` 仍被拒绝
   - 没有新的肉眼可见证据前，终态继续保持 `executed_not_closed`

## 下一步（2026-06-11 21:45 `zhidiantong-sync-cycle` 当前时间窗已重跑正式入口；下一步先恢复网页微信业务页并补当天导出，不要把旧 OpenAPI 决策和旧 prompt 冲突混成完成）

### 已落地
1. ✅ 当前 21:45 槽位已真实运行正式入口
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T13-48-27-428Z.json`
   - `executionOutcome = executed_not_closed`
2. ✅ 当前 Chrome 会话里的真实页面状态已重新取证
   - 网页微信：`WeChat Selkies` 黑屏远程画面
   - 智店通：当天 `6` 条已完成门店收银订单可见
   - 前端：`入库出库` 仍在加载中
3. ✅ latest-scheduled-task 报告与看板指针已补到本轮新正式报告

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信业务页**
   - 当前 `https://localhost:3001/` 不满足“目标页稳定可操作”门禁
   - 恢复前不能假装已扫 `智店通入库群 / 教育补贴群`
2. **补齐 2026-06-11 当天成对导出**
   - `商品库存统计_2026-06-11.xlsx`
   - `商品库存SN统计_2026-06-11.xlsx`
   - 成对 `orderData*.xlsx / orderProductData*.xlsx`
3. **对齐规则冲突**
   - 当前 `02_DECISIONS.md` 已切到 `今日相机 OpenAPI`
   - 但本 automation prompt 仍强制网页微信群前置扫描
   - 下一手要么恢复微信群业务页继续旧 prompt，要么正式改 prompt 与长期决策一致

## 下一步（2026-06-11 21:09 `automation-2` 已把 `daily-jd-lenovo-price-sync` 正式报告拉回 `executed_not_closed`，下一步只补真实复核与前端 gate）

### 已落地
1. ✅ 空的 `.scheduled-task.lock` 已清理，正式入口已重新执行
2. ✅ 最新正式报告已更新为：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-11T12-28-43-229Z.json`
   - `executionOutcome = executed_not_closed`
3. ✅ 标题/价格一致性审计当前都通过
   - `latest-terminal-title-consistency-audit.json -> issueCount = 0`
   - `latest-terminal-price-consistency-audit.json -> mismatchCount = 0`

### 仍待推进
1. **继续按 `latest-semi-auto-execution-plan.json` 做真实 Chrome 复核**
   - 当前正式待复核量：
     - `retailPriceVerificationCount = 50`
   - 仍应优先高库存、已锁定链接 SKU
2. **补本线程新的前端可见验收证据**
   - 当前 `Google Chrome` 电脑操控仍返回 `approval denied`
   - 没有新的前端肉眼证据前，不要把本轮升级成 `real_completed`
3. **评估是否让 runner 读取人工前端验收文件**
   - 当前 `verify_frontend_visible_sync_gate` 仍不会自动吃到人工证据
   - 这会持续把正式报告停在 `executed_not_closed`

## 下一步（2026-06-11 21:07 `daily-jd-lenovo-price-sync` 本轮被默认 Chrome 可见接管门禁拦下；下一步先恢复当前线程对默认 Chrome 的可见控制，再继续高库存已锁定 SKU 复核）

### 已落地
1. ✅ 已确认本轮不属于窗口外
   - 当前时间：`2026-06-11 21:07 CST`
   - 仍在 `10:00-22:00 CST` 任务窗口内
2. ✅ 已确认当前主阻塞不是“没有待复核队列”
   - `latest-semi-auto-execution-plan.json`
   - `retailPriceVerificationCount = 50`
3. ✅ 已新增本轮阻塞证据
   - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-11-2107-access-blocked/blocking-summary.md`
   - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-11-2107-access-blocked/visible-preflight-summary.json`

### 仍待推进
1. **先恢复当前线程对默认 Chrome 的可见接管能力**
   - 当前 `mcp__computer_use.get_app_state(app="Google Chrome")` 直接被 MCP 门禁拒绝
   - 恢复前不能声称做了新的京东/联想手工复核
2. **可见接管恢复后，再继续下一个高库存已锁定 SKU**
   - 按当前文档优先级继续真实页面复核
   - 仍保持“已锁定详情页优先、先点规格后读价格”的硬规则
3. **恢复前不要重跑正式入口**
   - 当前没有新的手工批次、没有新的 SQL/API 写入、没有新的前端验收
   - 此时重跑 `bash scripts/run_scheduled_task.sh daily-jd-lenovo-price-sync` 只会制造假进度

## 下一步（2026-06-11 21:01 开发计划已刷新；下一步回到三条真实主阻塞，不要把文档打包误当成业务收口）

### 已落地
1. ✅ 已把今日 authoritative 进展重新整理进：
   - `01_CURRENT_STATE.md`
   - `03_TASK_LOG.md`
   - `04_NEXT_ACTIONS.md`
   - `09_CODEX_HANDOFF.md`
   - `10_TEST_LOG.md`
2. ✅ 已明确本轮只是计划日更
   - 未执行手工采集
   - 未执行新的 SQL/API 写入
   - 未执行新的前端可见验收
3. ✅ 已重新锁定当前三条主线真实状态
   - `daily-jd-lenovo-price-sync`：最新正式终态仍是 `executed_not_closed`
   - 教育补工作台：当前主口径已切到 `education_scan_record_v2`
   - `zhidiantong-sync-cycle`：网页微信仍卡在 `Selkies` 黑屏页

### 仍待推进
1. **继续 `daily-jd-lenovo-price-sync` 高库存已锁定 SKU 真实复核**
   - 当前不要再把 `20006289` 标题门禁当主阻塞
   - 现在真正要么继续补下一个 SKU，要么把人工前端验收文件接入 `verify_frontend_visible_sync_gate`
2. **继续教育补 `智店通入库群` 真实缺口补图**
   - 当前 authoritative 口径是：
     - `projectionTotalCount = 67`
     - `gapCountSinceDate = 88`
   - 继续围绕 `gapBacklog.samples` 定向补，不再回退旧 summary 主口径
3. **先恢复网页微信业务页，再重走 `zhidiantong-sync-cycle`**
   - 默认 Chrome 已可接管
   - 但 `https://localhost:3001/` 仍不是可操作群聊页
   - 恢复前不要重跑正式入口

## 下一步（2026-06-11 21:02 `zhidiantong-sync-cycle` 21:00 槽位已重新接管默认 Chrome，但网页微信仍卡在 Selkies 控制壳 + 黑屏远程画面；下一步先恢复网页微信业务页，不要重跑正式入口）

### 已落地
1. ✅ 已重新通过默认 Chrome 当前会话读取并 claim 两个关键标签
   - `https://localhost:3001/`
   - `https://retail-pos.lenovo.com/lenovo/web/order/order-list`
2. ✅ 已新增 `21:02` 当前轮次真实证据
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-2102-check/blocking-summary.md`
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-2102-check/visible-page-facts.json`
3. ✅ 已确认网页微信当前 authoritative 状态不是二维码页，也不是群聊页，而是：
   - `WeChat Selkies`
   - `Selkies` 控制壳
   - 黑屏远程画面
4. ✅ 已确认智店通订单页当前仍稳定可见
   - 页面日期：`2026-06-11 ~ 2026-06-11`
   - 当前可见当天 `6` 条订单
5. ✅ 已确认当天导出输入仍未到位
   - 缺 `商品库存统计_2026-06-11.xlsx`
   - 缺 `商品库存SN统计_2026-06-11.xlsx`
   - 缺当日 `orderData/orderProductData` 成对导出

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信业务页**
   - 当前 `https://localhost:3001/` 仍不满足“目标页稳定可操作”门禁
   - 恢复前不能盲点群聊路径，也不能假装已扫过 `智店通入库群 / 教育补贴群`
2. **网页微信恢复后，再按本轮追加规则重走固定顺序**
   - 先扫 `智店通入库群`
   - 再扫 `教育补贴群`
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **恢复前不要重跑正式入口**
   - 当前没有新的群证据、没有新的 SQL/API 写入、没有新的前端验收
   - 此时执行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 只会制造假进度

## 下一步（2026-06-11 20:16 `zhidiantong-sync-cycle` 已重新接管默认 Chrome，但网页微信仍卡在 Selkies 控制壳 + 黑屏远程画面；下一步先恢复网页微信业务页，不要重跑正式入口）

### 已落地
1. ✅ 已重新通过默认 Chrome 当前会话读取打开标签列表
   - 当前 `tabPrecheckBefore = 11`
2. ✅ 已新增 `20:16` 当前轮次真实可见证据
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-2016-check/blocking-summary.md`
3. ✅ 已确认网页微信当前 authoritative 状态不是二维码页，也不是群聊页，而是：
   - `WeChat Selkies`
   - `Selkies` 控制壳
   - 黑屏远程画面
4. ✅ 已确认智店通订单页当前仍稳定可见
   - 页面日期：`2026-06-11 ~ 2026-06-11`
   - 当前可见当天 `6` 条订单

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信业务页**
   - 当前 `https://localhost:3001/` 仍不满足“目标页稳定可操作”门禁
   - 恢复前不能盲点群聊路径，也不能假装已扫过 `智店通入库群 / 教育补贴群`
2. **网页微信恢复后，再按本轮追加规则重走固定顺序**
   - 先扫 `智店通入库群`
   - 再扫 `教育补贴群`
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **恢复前不要重跑正式入口**
   - 当前没有新的群证据、没有新的 SQL/API 写入、没有新的前端验收
   - 此时执行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 只会制造假进度

## 下一步（2026-06-11 19:40 `daily-audit-and-snapshot-rebuild` 已跑出新报告但被标题一致性门禁拦截，下一步先清标题问题与前端可见验收阻塞）

### 已落地
1. ✅ 已执行正式入口：
   - `bash scripts/run_scheduled_task.sh daily-audit-and-snapshot-rebuild`
2. ✅ 已产生新的正式报告：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-audit-and-snapshot-rebuild/2026-06-11T11-38-35-005Z.json`
3. ✅ 已确认本轮确实刷新了：
   - `latest-product-url-locks.json`
   - `latest-collection-operation-plan.json`
   - `latest-standard-price-master.json`
   - `latest-retail-price-audit.json`
   - `latest-retail-zone-snapshot.json`
   - `latest-scheduled-task-dashboard.json`
4. ✅ 已把本地预览层 `dist/data` 手工追平到 `public/data`

### 仍待推进
1. **先清 `audit_terminal_title_consistency.py` 当前唯一 issue**
   - 当前阻塞 SKU：
     - `20006289`
   - 当前字段：
     - `displayTitleStrongDetail`
   - 不先清掉它，`daily-audit-and-snapshot-rebuild`、`daily-jd-lenovo-price-sync`、`zhidiantong-sync-cycle` 都会继续被同一门禁压成未收口
2. **补查为什么本轮没有刷新 `latest-scheduled-sql-auto-sync-audit.json`**
   - 当前文件仍停在 `sn-warranty-backfill / 19:20:55`
   - 需确认是 runner 在标题审计前提前退出，还是 daily audit 本身没有走到 SQL auto sync audit
3. **恢复“肉眼可见前端验收”能力后再补一次真实页面验收**
   - 当前 shell 直连 `127.0.0.1:5174` 被环境拦截
   - 当前 `Computer Use` 接管 Chrome 也被权限门禁拒绝
   - 现阶段只能确认 `dist/data` 已同步最新失败态，不能把它写成已完成前端可见验收

## 下一步（2026-06-11 19:30 `zhidiantong-sync-cycle` 本轮未取得新的可见 Chrome 页面证据，下一步仍是先恢复当前线程对默认 Chrome 的可见接管能力）

### 已落地
1. ✅ 已确认 `Google Chrome` 当前仍在运行：
   - `mcp__computer_use.list_apps`
2. ✅ 已确认本线程当前仍无法重新接管默认 Chrome：
   - `mcp__computer_use.get_app_state(app="Google Chrome")`
   - 返回 `Computer Use approval denied via MCP elicitation for app 'com.google.Chrome'.`
3. ✅ 已补 19:30 当前轮次阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1930-access-blocked/blocking-summary.md`
4. ✅ 已核对当前仓库里最新正式报告仍是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T11-31-39-641Z.json`
   - `executionOutcome = blocked_page_risk`

### 仍待推进
1. **先恢复当前线程对默认 Chrome 的可见接管能力**
   - 只有重新拿到当前可见页面，才允许判断网页微信是否仍是黑屏远程画面或已恢复业务页
   - 恢复前不能把 `18:45` 旧可见状态冒充成 `19:30` 新证据
2. **可见接管能力恢复后，仍按本轮追加规则重走固定顺序**
   - 先扫 `智店通入库群`
   - 再扫 `教育补贴群`
   - 再复用智店通当前业务页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **恢复前不要重跑正式入口**
   - 当前没有新的群证据、没有新的 SQL/API 写入、没有新的前端验收
   - 此时执行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 只会制造假进度

## 下一步（2026-06-11 19:10 `daily-jd-lenovo-price-sync` 已新增 `20006372` 真实手工批次并前端可见，下一步先清 `audit_terminal_title_consistency.py` 阻塞，再继续下一个高库存 SKU）

### 已落地
1. ✅ 已在默认 Chrome 当前会话真实复核：
   - `20006372 / 83QH0007CD`
   - 京东 `100322176814`
   - 联想官旗 `1054482`
2. ✅ 已新增本轮证据与批次：
   - `apps/inventory-sync/artifacts/manual/daily-jd-lenovo-price-sync-2026-06-11-1908/`
   - `apps/inventory-sync/artifacts/manual-price-supplements-20260611-automation-8-visible-chrome-batch-2.json`
3. ✅ 前端 `商品零售 -> 实时零售报价` 搜索 `20006372` 已可见：
   - `京东满减：采集到补贴/优惠后价 ￥5,063.08`
   - `执行价 ￥6,299`
   - `国补 ￥5,354.15`

### 仍待推进
1. **先处理 `audit_terminal_title_consistency.py` 当前对本地 API 的阻塞**
   - 当前正式 runner 已吃入批次，但仍因该审计失败停在 `blocked_page_risk`
   - 不先清掉这个门禁，后续手工批次都会继续被正式报告压成未收口
2. **清完审计阻塞后，继续下一个高库存已锁定 SKU**
   - 优先：`20002811 / 83ND0000CD`
   - 其次：`20003216 / 83NN0001CD`
   - 再次：`20006725 / 83LY00TRCD`
3. **保持默认 Chrome 5 页稳定工作态**
   - `WeChat Selkies`
   - `智店通`
   - `联想智慧零售系统`
   - `联想官网`
   - `京东`

## 下一步（2026-06-11 19:20 教育补 SQL -> 管理端 -> 产品价保教育补汇总 已接通，下一步该继续补实采 backlog 与总览口径统一）

### 已落地
1. ✅ 教育补代扫汇总接口已切到 SQL 主口径：
   - `/api/inventory-quote/education-agent-scan`
2. ✅ 管理端已真实显示：
   - `累计教育补贴 ¥31,050`
   - `累计智享金 ¥25,000`
3. ✅ 产品价保 -> `智店通入库群代扫` 子页已真实显示：
   - `智享金汇总 ¥25,000`

### 仍待推进
1. **继续用 CLI 主链补 `2026-06-06` 以来 backlog**
   - 当前教育补实采缺口主问题仍不是展示，而是缺失原始截图批次
2. **把“零售销售价保专区”第一页总览卡的智享金口径单独统一**
   - 当前用户明确要的教育补汇总页已接通
   - 但第一页总览卡仍受当前活动聚合口径影响，可后续单独统一成和教育补汇总页一致
3. **继续盯同手机号套数候选**
   - `15531851050`
   - `16711030562`

## 下一步（2026-06-11 18:45 `zhidiantong-sync-cycle` 当前轮次已确认“网页微信黑屏远程画面 / 智店通订单页可见”，下一步仍是先恢复网页微信业务页）

### 已落地
1. ✅ 已重新通过默认 Chrome 当前会话扫描到：
   - `https://localhost:3001/`
   - `https://retail-pos.lenovo.com/lenovo/web/order/order-list`
2. ✅ 已确认 `https://localhost:3001/` 当前不是二维码页，但也不是可操作群聊页，而是黑屏远程画面
3. ✅ 已确认智店通订单页当前仍稳定可见，日期框仍是 `2026-06-11`
4. ✅ 已补本轮阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1845-check/`
5. ✅ 已把“`02_DECISIONS` 新主链 vs 本轮自动化提示词”冲突写入本轮阻塞说明

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信业务页**
   - 当前 `https://localhost:3001/` 黑屏远程画面不满足“目标页稳定可操作”门禁
   - 恢复前不能盲点群聊路径，也不能假装已扫过 `智店通入库群`
2. **网页微信恢复后，再按本轮追加规则重走固定顺序**
   - 先扫 `智店通入库群`
   - 再扫 `教育补贴群`
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **恢复前不要重跑正式入口**
   - 当前执行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 只会制造假进度
   - 本轮没有新的群证据、没有新的 SQL/API 写入、没有新的前端验收，不能冒充同步已执行

## 下一步（2026-06-11 18:45 教育补贴采集工作台已完成“CLI 主链 + 服务类过滤 + 手机号累计套数规则 + 套数复核面板”，下一步该补真实 backlog）

### 已落地
1. ✅ 教育补贴采集工作台首页已改为 `CLI 主链 / API 待恢复链`
2. ✅ 智惠/延保/Lenovo Care 服务类商品已从正式教育补机器汇总中剔除
3. ✅ 当前 workbench 接口已显示 `sqlServiceFilteredCountSinceDate = 4`
4. ✅ 当前缺口 backlog 已从 `94` 条收缩到 `80` 条，且样例不再混入 `Lenovo Care 智惠`

### 仍待推进
1. **继续用 CLI 实采批次补 `2026-06-06` 以来 backlog**
   - 当前工作台真实缺口仍是 `80` 条
   - 需要继续按员工文件夹和群名证据补齐
2. **优先盯住工作台里的手机号累计套数候选**
   - 当前先盯：
     - `15531851050`
     - `16711030562`
   - 一旦后续 CLI 批次补进第三个不同设备单元，要立即整组升级成 `three_piece`
3. **等今日相机 API 真正能返回图片列表后，再恢复 API 主链**
   - 在那之前不能把 API 说成已接管主采

## 下一步（2026-06-11 18:00 `zhidiantong-sync-cycle` 当前轮次未能接管默认 Chrome，下一步仍是先恢复可见会话能力再重走网页微信门禁）

### 已落地
1. ✅ 已确认本会话当前无法接管默认 Chrome：
   - `mcp__computer_use.get_app_state(app="Google Chrome")`
   - 返回 `Computer Use approval denied via MCP elicitation for app 'com.google.Chrome'.`
2. ✅ 已补 `18:00` 当前轮次阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1800-check/`
3. ✅ 已确认当前仓库里本轮最新正式报告是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T10-01-18-217Z.json`
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T10-00-50-536Z.json`
   - 但两份报告仍写有 `原微信群前置门禁已退役`，与本轮自动化硬规则冲突
4. ✅ 已确认 `2026-06-11T10-01-18-217Z.json` 还新增技术阻塞：
   - `audit_terminal_title_consistency.py` 失败
   - `zdtSalesOrderSync.py` / `zdtSalesDedupeAndFill.py` 的 `127.0.0.1:5432 connection refused`
   - 当天销售出库 / 入库 / 其他出库 / 调拨 / 库存总表导出仍缺

### 仍待推进
1. **先恢复当前线程对默认 Chrome 的可见接管能力**
   - 恢复前不能假装重新扫过网页微信，也不能把 `17:15` 旧可见状态写成 `18:00` 新证据
   - 只有重新拿到当前可见页面证据，才允许继续判断网页微信是否仍是二维码登录页
2. **可见会话能力恢复后，仍按当前追加规则执行固定顺序**
   - 先扫 `智店通入库群`
   - 再扫 `教育补贴群`
   - 再复用智店通当前业务页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **不要沿用 `18:00` 正式报告冒充当前线程收口**
   - 当前两份正式报告仍把网页微信群前置门禁写成已退役
   - 下轮如需让自动化正式报告重新符合本任务提示词，仍需单独修正代码/规则

## 下一步（2026-06-11 17:15 `zhidiantong-sync-cycle` 当前轮次再次确认“网页微信二维码阻塞 / 智店通订单页可见”，下一步仍是先恢复网页微信）

### 已落地
1. ✅ 已确认 `https://localhost:3001/` 当前真实可见主体仍是微信二维码登录页
2. ✅ 已确认智店通当前仍在 `订单 -> 线下门店订单` 页面，页面日期可见 `2026-06-11`
3. ✅ 已补 17:15 当前轮次阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1715-check/`

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信会话**
   - 必须从二维码登录阻塞恢复到可见 `WeChat Selkies` 业务页
   - 恢复前不能盲点群聊路径，也不能假装执行 `zhidiantong-sync-cycle`
2. **网页微信恢复后，按本轮追加规则重新执行固定顺序**
   - 先扫 `智店通入库群`
   - 再扫 `教育补贴群`
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **恢复前不要重跑正式入口**
   - 当前没有新的手工群证据
   - 此时执行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle` 只会制造假进度，不会形成真实收口

## 下一步（2026-06-11 16:30 `zhidiantong-sync-cycle` 当前轮次已确认“微信二维码阻塞 / 智店通订单页可见 / 同轮正式报告仍与当前硬规则冲突”，下一步仍是先恢复网页微信）

### 已落地
1. ✅ 已确认 `https://localhost:3001/` 当前真实可见主体仍是微信二维码登录页
2. ✅ 已确认智店通当前已恢复到 `订单 -> 线下门店订单` 页面，页面日期可见 `2026-06-11`
3. ✅ 已补 16:30 当前轮次阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1630-check/`
4. ✅ 已确认当前仓库里本轮最新正式报告是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T08-31-38-941Z.json`
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T08-31-13-276Z.json`
   - 但两份报告仍写有“网页微信群逐图回扫前置门禁已退役”，与本轮自动化硬规则冲突

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信会话**
   - 必须从二维码登录阻塞恢复到可见 `WeChat Selkies` 业务页
   - 恢复前不能盲点群聊路径，也不能把 16:30 正式报告当作当前线程已收口
2. **网页微信恢复后，按本轮追加规则重新执行固定顺序**
   - 先扫 `智店通入库群`
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **后续需要单独修正规则冲突**
   - `zhidiantong-sync-cycle` 当前正式报告逻辑仍不把网页微信群门禁视为本任务硬前置
   - 下轮如需让自动化报告重新符合本任务提示词，必须单独修正代码/规则，不要继续默认沿用这两份冲突报告

## 下一步（2026-06-11 15:45 `zhidiantong-sync-cycle` 当前轮次已确认“微信二维码阻塞 / 智店通订单页可见”，下一步仍是先恢复网页微信）

### 已落地
1. ✅ 已确认 `https://localhost:3001/` 当前真实可见主体仍是微信二维码登录页
2. ✅ 已确认智店通当前已恢复到 `订单 -> 线下门店订单` 页面，页面日期可见 `2026-06-11`
3. ✅ 已补 15:45 当前轮次阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1545-check/`
4. ✅ 已确认当前仓库里本轮最新正式报告是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T07-46-03-965Z.json`
   - 但该报告仍写有“网页微信群逐图回扫前置门禁已退役”，与本轮自动化硬规则冲突

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信会话**
   - 必须从二维码登录阻塞恢复到可见 `WeChat Selkies` 业务页
   - 恢复前不能盲点群聊路径，也不能把 15:45 正式报告当作当前线程已收口
2. **网页微信恢复后，按本轮追加规则重新执行固定顺序**
   - 先扫 `智店通入库群`
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **后续需要单独修正规则冲突**
   - `zhidiantong-sync-cycle` 当前正式报告逻辑仍不把网页微信群门禁视为本任务硬前置
   - 下轮如需让自动化报告重新符合本任务提示词，必须单独修正代码/规则，不要继续默认沿用这份冲突报告

## 下一步（2026-06-11 15:00 `zhidiantong-sync-cycle` 当前轮次已确认“正式报告口径与自动化硬规则冲突”，下一步仍是先恢复网页微信）

### 已落地
1. ✅ 已确认 `https://localhost:3001/` 当前真实可见主体仍是微信二维码登录页
2. ✅ 已确认智店通当前已恢复到 `订单 -> 线下门店订单` 页面，页面日期可见 `2026-06-11`
3. ✅ 已补 15:00 当前轮次阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1500-check/`
4. ✅ 已确认当前仓库里最新正式报告是：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-11T07-02-09-059Z.json`
   - 但该报告写有“网页微信群逐图回扫前置门禁已退役”，与本轮自动化硬规则冲突

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信会话**
   - 必须从二维码登录阻塞恢复到可见 `WeChat Selkies` 业务页
   - 恢复前不能盲点群聊路径，也不能把 15:00 正式报告当作当前线程已收口
2. **网页微信恢复后，按本轮追加规则重新执行固定顺序**
   - 先扫 `智店通入库群`
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **后续需要单独修正规则冲突**
   - `zhidiantong-sync-cycle` 当前正式报告逻辑已不再把微信群门禁作为硬前置
   - 下轮如需让自动化报告重新符合本任务提示词，必须单独修正代码/规则，不要继续默认沿用这份冲突报告

## 下一步（2026-06-11 14:15 `zhidiantong-sync-cycle` 已确认“微信阻塞 / 智店通订单页可见”，下一步先恢复网页微信）

### 已落地
1. ✅ 已确认 `https://localhost:3001/` 当前真实可见主体仍是微信二维码登录页
2. ✅ 已确认智店通当前已恢复到 `订单 -> 线下门店订单` 页面，而不是 Lenovo SSO 密码页
3. ✅ 已补 14:15 真实阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1415-wechat-qr-blocked/`

### 仍待推进
1. **先恢复默认 Chrome 里的网页微信会话**
   - 必须从二维码登录阻塞恢复到可见 `WeChat Selkies` 业务页
   - 恢复前不能盲点群聊路径，也不能重跑正式入口
2. **网页微信恢复后，按固定顺序先扫 `智店通入库群`**
   - 先完成本轮图片回扫/无新增确认门禁
   - 再复用当前已打开的智店通订单页继续销售、采购、其他出库、调拨、库存和 SN 证据链
3. **不要把早上 05:31 的正式报告沿用成 14:15 已执行**
   - `2026-06-11T05-31-38-864Z.json` 只代表早上那次 `executed_not_closed`
   - 当前 14:15 线程没有新的微信群证据、没有新的 SQL/API/前端验收，只能继续保持 `blocked_page_risk`

## 下一步（2026-06-11 13:54 `daily-price-channel-check` 中午补查已收口为 `executed_not_closed`，下一步仍是等当天原始分销文件出现）

### 已落地
1. ✅ 已确认网页微信 `https://localhost:3001/` 当前仍是二维码登录页，不能进入目标分销群聊
2. ✅ 已确认 Selkies 落地目录最新分销文件仍是 `2026年6月9日分销库存(1).xlsx`
3. ✅ 已执行 `bash scripts/run_scheduled_task.sh daily-price-channel-check`，新增正式报告 `2026-06-11T05-53-28-903Z.json`
4. ✅ 已确认前端 `报价来源 -> 群报价库` 当前显示：
   - `报价日期 2026-06-09`
   - `刷新 06/11 13:52`
   - `当前条目 136`
   - `覆盖 SKU 133`

### 仍待推进
1. **等 `圣之航-河南政策沟通群` 或 Selkies 落地目录出现 2026-06-10 / 2026-06-11 当天分销原始文件**
   - 出现前只能继续沿用 `2026-06-09` 有效值
   - 不要把当前沿用值冒充成今日新采
2. **网页微信会话恢复后再补可见群聊证据**
   - 当前二维码登录页只能作为阻塞证据
   - 不能在未恢复登录前盲重试页面路径
3. **下一轮补查继续先看 Selkies 落地目录，再决定是否重跑正式入口**
   - 若仍无当天文件，终态继续保持 `executed_not_closed` 或 `blocked_missing_input`

## 下一步（2026-06-11 13:30 `zhidiantong-sync-cycle` 13:30 线程已补同轮阻塞证据，下一步仍是先恢复默认 Chrome 会话）

### 已落地
1. ✅ 已确认 `https://localhost:3001/` 当前仍是微信二维码登录页
2. ✅ 已确认智店通当前仍停在 Lenovo SSO 密码页，且本轮单步点击后仍未出现浏览器已保存密码候选
3. ✅ 已补 13:30 真实阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1330-login-blocked/`

### 仍待推进
1. **先恢复默认 Chrome 会话**
   - 网页微信恢复到已登录 `WeChat Selkies` 业务页
   - 智店通恢复到已登录业务页或出现可用的浏览器已保存密码候选
2. **会话恢复后再执行当前时间窗业务动作**
   - 先扫 `智店通入库群 / 教育补贴群`
   - 再进智店通补当天销售、采购、其他出库、调拨、库存和 SN 证据
3. **会话未恢复前不要重跑正式入口**
   - 不要执行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`
   - 当前重跑只会制造重复阻塞报告，不会新增主链证据

## 下一步（2026-06-11 15:10 工作台已落地，下一步该补真实缺失 backlog 而不是继续散着看页面）

### 已落地
1. ✅ 教育补贴采集首页已升级为正式工作台
2. ✅ 统一工作台 API 已可返回：
   - 正式汇总
   - 来源分布
   - 最近批次
   - 最近正式记录
   - `2026-06-06` 以来缺失 backlog
3. ✅ 正式汇总已能继续保留 `sourceType / collectionSource / photoId / mediaUrl / takenAt / watermark`

### 仍待推进
1. **按工作台 backlog 补 `2026-06-06` 以来缺失教育补代扫记录**
   - 当前工作台显示缺口 `93` 条
   - 先按日期和样例订单拆批处理
2. **把今日相机 API / CLI 新采记录真正写入正式汇总**
   - 让工作台来源分布里出现 `xhey_api_manual / watermark_camera_manual`
3. **补工作台上的人工复核闭环**
   - 当前已能看缺口和最近记录
   - 还需继续把补采/复核后的结果同步收口

## 下一步（2026-06-11 14:52 郭晨臣邻近样本已核查，下一步改为定向找“同手机号重复出现”的真实链）

### 已落地
1. ✅ 多件套规则已改成“同手机号下不同商品数”
2. ✅ 小票/订单图当前已允许用订单信号信任 OCR 提取手机号
3. ✅ `郭晨臣` 已命中候选图前后 `22` 张邻近图已完成核查
4. ✅ 当前已确认两个手机号：
   - `15321688211`
   - `14432899212`
   但都只对应 `1` 个商品，不是多件套

### 仍待推进
1. **继续定向核查 `梁伟` 已命中候选图邻近样本**
   - 看是否存在同手机号多商品链条
2. **若 `梁伟` 邻近样本仍无命中，再扩大到“同日/相近时间段”窗口**
   - 只扫可能属于同一单的连续拍摄段
3. **确认出现真实多件套手机号后，再做小批量非 dry-run 入库验证**

## 下一步（2026-06-11 14:36 套装规则已改对，下一步要在真实样本里把“同手机号多商品”找出来）

### 已落地
1. ✅ `xhey_web_folder_cli.py` 已按“同手机号下不同商品数”判定两件套/三件套
2. ✅ 合成样本已验证：
   - `2` 个不同商品 => `two_piece`
   - `3` 个不同商品 => `three_piece`
3. ✅ 重新抽样 `梁伟 / 郭晨臣` 各 `30` 张后，代码可正常执行

### 仍待推进
1. **在真实 ZIP 全量或更大样本里找出同手机号多商品命中**
   - 当前前 `30` 张还没撞到这类样本
   - 需要扩大抽样或做按手机号聚合扫描
2. **确认这些命中样本是否都应该归 `智店通入库群`**
   - 重点看两件套 / 三件套 / 订单图 / 箱码图是否能串上
3. **确认无误后，再做小批量非 dry-run 入库**

## 下一步（2026-06-11 14:25 梁伟/郭晨臣整包已验证，下一步该从 dry-run 走到“人工抽核后的小批量非 dry-run”）

### 已落地
1. ✅ `梁伟 / 郭晨臣` 整文件夹 ZIP 已通过真实网页导出并完成本地校验
2. ✅ 浏览器 `ERR_BLOCKED_BY_CLIENT` 已确认不等于 ZIP 失效，`curl` 可直接下载
3. ✅ `xhey_web_folder_cli.py` 已去掉 `SN-only` 误入和 `公安局/员工名` 这类脏姓名误判
4. ✅ 收紧后抽样结果已拿到：
   - `梁伟 4/30`
   - `郭晨臣 6/30`

### 仍待推进
1. **从两份 dry-run 报告里人工抽核这 10 条命中样本**
   - 重点确认是否真是教育补证件图 / 订单图
   - 不确认前不要切正式入库
2. **对确认无误的一小批样本做 1 次非 dry-run Bridge 入库验证**
   - 先小批量，不做整包导入
   - 验证 SQL 与前端汇总字段是否完整落地
3. **如果小批量非 dry-run 通过，再考虑补“浏览器导出 -> curl 下载 -> CLI 处理”的半自动封装**
   - 当前链路已经可用
   - 但还没收口为一键批处理脚本

## 下一步（2026-06-11 14:02 网页分类文件夹 CLI 已落地，下一步从目标员工文件夹里筛出真正教育补样本）

### 已落地
1. ✅ 已在真实网页登录态确认团队 `263050993`
2. ✅ 已确认 `李建定 / 梁伟 / 郭晨臣` 文件夹真实存在且有照片
3. ✅ 已拿到单图 ZIP 与整文件夹 ZIP 真实导出链
4. ✅ `xhey_web_folder_cli.py` 已能处理网页导出 ZIP / 目录 / 直链 URL

### 仍待推进
1. **继续导出 `梁伟 / 郭晨臣` 文件夹并抽样筛教育补凭证**
   - 当前 `李建定` 抽样前 10 张主要是设备照/标签照
   - 还没覆盖另外两位目标员工
2. **对命中教育补凭证的样本做非 dry-run Bridge 入库验证**
   - 前提：样本里真有教育补文字、客户电话、SN 或订单号
3. **如需整批自动收口，再补“浏览器导出 -> 直链抓取 -> CLI 自动处理”封装脚本**
   - 当前已能人工式低频导出并把 ZIP 交给 CLI
   - 还未把浏览器动作整体封成一键命令

## 下一步（2026-06-11 13:22 OCR 已恢复，今日相机主链当前剩余阻塞改为“API 可用但照片列表为空”）

### 已落地
1. ✅ OCR 服务 `127.0.0.1:8765` 已恢复，健康检查返回 `200`
2. ✅ `xhey_pull_worker.py` 已支持 `search -> list` 自动退回拉图
3. ✅ 今日相机 API `list-users` 当前仍能返回 `5` 个 `userId`
4. ✅ 已确认当前不是签名失败，也不是 OCR 宕机，而是照片接口返回 `0` 张

### 仍待推进
1. **先确认今日相机 OpenAPI 当前 group 是否真的绑定了目标团队相册**
   - 当前 `24h / 3d / 7d / 30d / 90d / 180d` 都返回 `0`
   - 更像是 `groupKey/groupSecret` 可用，但照片权限或团队范围不对
2. **并行补网页端 CLI 备用链**
   - API 当前拿不到照片时，备用链要能从已登录网页端分类文件夹下载并走同一份 Bridge 入库口径
   - 重点仍是 `梁伟 / 郭晨臣 / 李建定`
3. **等 API team/group 范围确认后，再做真实非 dry-run 入库验证**
   - 验证口径：新增 1 条真实记录 + 汇总快照刷新 + 前端表格可见

## 下一步（2026-06-11 13:10 教育补采集主链已切到今日相机，下一步先补 OCR 实跑能力与网页 CLI 备用脚本）

### 已落地
1. ✅ 今日相机 API key 当前有效，`healthcheck` 已返回 `userCount = 5`
2. ✅ Bridge 写库后已自动刷新教育补正式汇总快照
3. ✅ 首页 `教育补贴采集` 已升级为今日相机双轨采集页
4. ✅ `xhey_pull_worker.py` 已按真实图片 multipart 提交 Bridge

### 仍待推进
1. **先恢复本机 OCR 服务 `127.0.0.1:8765`**
   - 当前监控页仍显示 `OCR unreachable`
   - 不恢复 OCR，就只能依赖今日相机水印文本和上游提取字段，真图 OCR 补提取不完整
2. **补网页端 CLI 备用链**
   - 当前只完成了页面结构逆向和下载按钮确认
   - 还没把 `梁伟 / 郭晨臣 / 李建定` 分类文件夹批量归图脚本正式落盘
3. **做一次真实非 dry-run 今日相机入库验证**
   - 前提：OCR 服务可用
   - 验证口径：Bridge 成功写入 1 条记录 + 汇总快照刷新 + 前端记录表可见

## 下一步（2026-06-11 12:45 `zhidiantong-sync-cycle` 12:45 线程已确认双入口仍未恢复，下一步继续先恢复会话）

### 已落地
1. ✅ 已确认 `https://localhost:3001/` 当前仍是微信二维码登录页
2. ✅ 已确认智店通当前仍停在 Lenovo SSO 密码页，且未出现浏览器已保存密码候选
3. ✅ 已补 12:45 真实阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1245-login-blocked/`

### 仍待推进
1. **先恢复默认 Chrome 会话**
   - 网页微信恢复到已登录 `WeChat Selkies` 业务页
   - 智店通恢复到已登录业务页或出现可用的浏览器已保存密码候选
2. **会话恢复后再执行当前时间窗业务动作**
   - 先扫 `智店通入库群 / 教育补贴群`
   - 再进智店通补当天销售、采购、其他出库、调拨、库存和 SN 证据
3. **会话未恢复前不要重跑正式入口**
   - 不要执行 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`
   - 当前重跑只会制造重复阻塞报告，不会新增主链证据

## 下一步（2026-06-11 12:04 `zhidiantong-sync-cycle` 已补到真实登录阻塞证据，下一步是先恢复会话而不是重跑任务）

### 已落地
1. ✅ 已确认网页微信当前是二维码登录页，不是已登录业务页
2. ✅ 已确认智店通当前能走到 Lenovo SSO 密码页，但未出现可直接选用的浏览器已保存密码候选
3. ✅ 已补一份本轮手工阻塞证据：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-11-1200-login-blocked/blocking-summary.md`

### 仍待推进
1. **先让用户在当前默认 Chrome 会话恢复两个入口**
   - 网页微信恢复到已登录 `WeChat Selkies`
   - 智店通恢复到已登录业务页
2. **会话恢复后再重新执行今天的 12:00 业务动作**
   - 先扫 `智店通入库群 / 教育补贴群`
   - 再进智店通补当天订单、调拨、库存和 SN 证据
3. **不要在会话未恢复前重跑 `zhidiantong-sync-cycle`**
   - 当前只会重复 `blocked_page_risk`
   - 不会新增主链证据

## 下一步（2026-06-11 11:09 Codex 对话报错守护已升级，下一步先盯稳定性与跨天切换）

### 已落地
1. ✅ 已确认 `notify` wrapper 在真实桌面 `turn-ended` 中生效
2. ✅ 已新增 `launchd` 常驻守护：
   - `com.lenovo-smart-retail.codex-session-format-watch`
3. ✅ 当前报错线程 `019eb480-0a4c-7860-9a4c-410788bc3633` dry-run 已回到 `changedLineCount = 0`

### 仍待推进
1. **继续观察本轮连续对话是否还会复发同类报错**
   - 优先检查：
     - `scripts/codex_session_format_watchdog.sh status`
     - `python3 scripts/fix_codex_pinned_thread_content.py --thread-id 019eb480-0a4c-7860-9a4c-410788bc3633 --compact`
2. **保持诚实口径**
   - 当前完成的是本地自动止血
   - 还不是 Codex Desktop 上游写入层根因修复

## 下一步（2026-06-11 12:15 `zhidiantong-sync-cycle` 已少一层门禁，下一步只剩两组阻塞可选）

### 已落地
1. ✅ `zhidiantong-sync-cycle` 的标题一致性审计门禁已清零
2. ✅ 发布投影标题链已对 `20004635 / 20006289` 收口
3. ✅ 当前 `zhidiantong-sync-cycle` 剩余阻塞已收敛成两组

### 仍待推进
1. **下一组优先建议：教育补代扫群缺口**
   - 当前 `2026-06-09 / 2026-06-10` 仍有 `26` 条真实销售出库缺正式代扫记录
   - 这是更接近业务真值的剩余阻塞
2. **另一组剩余阻塞：`2026-06-10` 库存成对总表缺口**
   - 仍缺：
     - `商品库存统计_2026-06-10.xlsx`
     - `商品库存SN统计_2026-06-10.xlsx`
3. **`daily-jd-lenovo-price-sync` 继续保持第二优先**
   - 当前仍是 `executed_not_closed`
   - 但先于它的 `zhidiantong-sync-cycle` 已经只剩两组更窄阻塞

## 下一步（2026-06-11 11:02 首个真实模板任务已跑通，下一步直接围绕 `zhidiantong-sync-cycle` 开始）

### 已落地
1. ✅ 已完成首个按模板完整跑通的真实任务：
   - `scheduled-task-status-readonly-audit-20260611`
2. ✅ 已确认今日 4 条关键定时任务的优先顺序
3. ✅ 已把 `zhidiantong-sync-cycle` 识别为当前最该先盯的核心阻塞项

### 仍待推进
1. **下一条真实执行任务直接围绕 `zhidiantong-sync-cycle`**
   - 当前更细拆解已明确为 3 组问题：
     - 教育补代扫群缺口
     - 库存成对总表缺口
     - 标题一致性审计失败
   - 先不要整任务盲重跑
   - 先决定这 3 组问题今天先收哪一组
2. **`daily-jd-lenovo-price-sync` 暂不误判成失败**
   - 它当前是 `executed_not_closed`
   - 后续重点是 `50` 条已锁定链接的人工复核收口
3. **`daily-sn-sales-compliance-refresh` 不重跑**
   - 只在后续围绕 `manualReviewCount` 做外部资格证据补链

## 下一步（2026-06-11 11:05 标准卡片与派发表已就位，下一步该选第一条按模板完整跑通的新任务）

### 已落地
1. ✅ 已新增标准模板文档：
   - `docs/ai-context/22_STANDARD_TASK_CARDS_AND_DISPATCH_TABLE.md`
2. ✅ 已具备：
   - `一级拆解卡`
   - `CLI / Codex / GPT / OpenClaw` 四类执行单
   - 三模型派发表
3. ✅ 现有分解规则、分发入口、子代理规则都已挂接到同一模板口径

### 仍待推进
1. **选 1 条真实新任务，按模板完整跑一遍**
   - 先填 `一级拆解卡`
   - 再产出对应执行单
   - 再执行或派发
2. **优先选低风险任务验证 GPT 或 OpenClaw 模板**
   - GPT：公开资料补料或文档归纳
   - OpenClaw：receipt 审计、状态核查、证据存在性确认
3. **等首轮模板跑通后，再考虑是否要做“任务台账页”或“自动生成执行单”**
   - 当前先不要跳到自动化主链

## 下一步（2026-06-11 10:58 OpenClaw 首个只读副驾驶任务已派发，下一步该收口 board 状态而不是重复追问）

### 已落地
1. ✅ 已完成首个真实低风险副驾驶任务派发：
   - `openclaw-command-20260611-105246-1354ba`
2. ✅ 已基于现有 receipt 和 board 事实完成两条历史待办的 Codex 侧判断
3. ✅ 已确认当前真正应保留的不是“模糊 pending”，而是明确阻塞类型

### 仍待推进
1. **把 `pendingCodexTasks` 的历史状态整理为新的收口口径**
   - `xhey-camera-integration`：
     - 从“queued”改认知为“dry-run 完成，实跑被外部凭证阻塞”
   - `chrome-9222-restore`：
     - 继续保持阻塞，但明确是“Chrome 9222 GUI 启动链阻塞”
2. **下一个 OpenClaw 真实副驾驶任务继续只选低风险只读项**
   - 优先：receipt 审计、计划表核查、证据存在性确认
   - 暂不派发任何依赖智店通/京东/联想官网真实页面的任务
3. **如果用户后续要推进 `xhey` 或 `9222`**
   - `xhey` 先解决 key/secret 有效性
   - `9222` 先解决本机可持续 Chrome 主进程

## 下一步（2026-06-11 10:46 当前报错线程已能真实续接，剩余是桌面写入层根因追踪）

### 已落地
1. ✅ 当前报错线程 `019eb480-0a4c-7860-9a4c-410788bc3633` 已真实 `codex exec resume` 成功并返回 `OK`
2. ✅ 已确认问题不再是“历史坏数据没清完”，而是“当前活跃桌面线程每新增一轮消息还会继续写旧格式文本数组”
3. ✅ 当天会话目录二次收口后，当前只有这条活跃线程会继续反复长回可清理残留

### 仍待推进
1. **如果用户还在 Desktop UI 里复现同类报错，优先改查写入层而不是继续怀疑 provider**
   - 当前 `mode=original`
   - 当前 `model=gpt-5.4`
   - 真实 `resume` 已通过
2. **如需继续降低复发概率，可在结束当前线程后再跑一次当天会话目录清理**
   - `python3 scripts/fix_codex_pinned_thread_content.py --write --session-dir ~/.codex/sessions/$(date +%Y/%m/%d)`
3. **当前最稳的守护式止血方案是直接用 watch 模式**
   - `python3 scripts/fix_codex_pinned_thread_content.py --write --session-dir ~/.codex/sessions/$(date +%Y/%m/%d) --watch`
4. **当前更贴近真实使用链的自动止血方案已经接到 notify wrapper**
   - `~/.codex/config.toml -> scripts/codex_turn_ended_notify.sh`
   - 当前 wrapper 已优先按 `thread_id` 定点清理，而不是默认整天目录全扫
   - 当前 wrapper 已采用两段式补修，进一步缩短 turn-ended 后的残留窗口
5. **如果要追根因，下一步该看 Codex Desktop 当前线程写入链为何持续落 `input_text/output_text` 单元素数组**
   - 当前这不是业务仓库数据问题
   - 当前也不是 pinned thread 历史残留问题

## 下一步（2026-06-11 12:40 OpenClaw 最小派发演示已基本跑通，下一步是选第一条真实副驾驶任务）

### 已落地
1. ✅ 已完成第一次真实 `OpenClaw` 最小派发演示
2. ✅ 当前 command 已成功进入网关：
   - `openclaw-command-20260611-104016-1c7b9c`
3. ✅ command 文件、chat board、command board 都已可见该任务
4. ✅ 已收到控制会话真实反馈
5. ✅ 已隔离落盘 demo receipt：
   - `apps/inventory-sync/artifacts/manual/openclaw/receipts/_demo/openclaw-minimal-dispatch-demo-2026-06-11-1050.json`

### 仍待推进
1. **选 1 条真实但低风险的副驾驶任务**
   - 优先：巡检、状态核查、证据存在性确认
   - 继续避免碰正式业务主链
2. **把这次 demo 经验收口成固定模板**
   - 哪种情况下只要 chat feedback
   - 哪种情况下需要正式 receipt
3. **如后续需要让 demo receipt 进入正式聚合**
   - 先单独定义一套兼容正式聚合器的 demo schema
   - 当前不要直接污染正式 `receipts/` 主链

## 下一步（2026-06-11 12:05 分发入口已盘点，下一步该做第一次真实派发演示）

### 已落地
1. ✅ 已新增分发入口操作文档：
   - `docs/ai-context/21_DISPATCH_ENTRYPOINTS_AND_MANUAL_HANDOFF.md`
2. ✅ 已确认当前可用链路：
   - `GPT`：执行单 + 人工投递
   - `OpenClaw`：本地 API / command / receipt / chat board
3. ✅ 已最小实测 `OpenClaw` 本机入口：
   - `bash scripts/check-openclaw.sh` 通过

### 仍待推进
1. **选 1 个真实新任务，做第一次一级拆解卡片**
   - 不再停留在抽象规则层
2. **从拆解结果里选 1 个最窄子任务，做第一次真实派发**
   - 优先选 `OpenClaw` 副驾驶型任务
   - 避免一上来就碰正式主链
3. **回收一次真实产物**
   - command 状态
   - receipt 状态
   - Codex 收口结论

## 下一步（2026-06-11 11:35 任务分解与模型路由规则已落地，下一步是把真实任务与分发入口接上）

### 已落地
1. ✅ 新增项目级规则文档：
   - `docs/ai-context/20_TASK_DECOMPOSITION_AND_MODEL_ROUTING.md`
2. ✅ 已明确采用 `保守型` 模型分工：
   - `Codex` 一级拆解与正式收口
   - `GPT` 云端补料/归纳
   - `OpenClaw` 副驾驶级 receipt / 巡检 / 阻塞上报
3. ✅ 已把规则接入长期记忆链：
   - `02_DECISIONS`
   - `12_EXECUTION_CORE`
   - `15_SUBAGENT_EXECUTION_PLAYBOOK`

### 仍待推进
1. **选 1 个真实新任务，按新规则跑第一轮完整拆解**
   - 先写一级拆解卡片
   - 再决定哪些子任务给 `GPT` 或 `OpenClaw`
2. **盘点当前可复用的分发入口**
   - `GPT` 的人工投递格式
   - `OpenClaw` 的 command / receipt / chat board 入口
   - 明确哪些入口还能用、哪些只能归档
3. **如用户确认继续接入**
   - 再补一份“真实分发演示任务”的执行记录
   - 验证 `执行单 -> 投递 -> 回收 -> Codex 收口` 是否顺畅

## 下一步（2026-06-11 10:30 Codex 置顶线程 ArrayParam 报错已收口，剩余只是保守巡检与多模态兼容观察）

### 已落地
1. ✅ 当前 Codex 路由已确认是原生模式：`mode=original`、`model=gpt-5.4`
2. ✅ 当前 `11` 条 pinned thread 的三类旧格式残留已修复：
   - `user` 纯文本数组 `78` 行
   - `assistant/developer` 纯文本数组 `384` 行
   - `reasoning_text` 历史数组 `598` 行
3. ✅ 已完成 `11 / 11` 条 pinned thread 的真实 `codex exec resume` 验证

### 仍待推进
1. **如后续仍再现同类报错，先看是否命中了仅剩的 2 行多模态输入**
   - 当前仅 `019ea606` 留有 `text + image` 混排数组 2 行
   - 这两行本轮按安全边界未自动改写
2. **把此脚本保留为后续 pinned thread 巡检工具**
   - 使用：`python3 scripts/fix_codex_pinned_thread_content.py`
   - 写回：`python3 scripts/fix_codex_pinned_thread_content.py --write`
3. **如 Codex Desktop UI 里仍有个别置顶线程显示异常，再做桌面端手工点击巡检**
   - 当前 CLI 续接已全部通过
   - 尚未逐条在 App 侧做可视交互验收

## 下一步（2026-06-11 09:17 SN 有效销量合规预警日更已刷新，剩余是人工补外部资格证据）

### 已落地
1. ✅ `daily-sn-sales-compliance-refresh` 已生成 `2026-06-11T01-17-32-179Z.json` 任务报告
2. ✅ SQL 已落库合规链路与 `latest-sn-sales-compliance-snapshot.json` 已刷新
3. ✅ 前端 `apps/web-cockpit/public/data/latest-sn-sales-compliance-snapshot.json` 已与 artifacts 同步一致

### 仍待推进
1. **按合规预警队列补外部有效销量/厂家资格证据**
   - 当前 `manualReviewCount = 1144`
   - 这些记录仍需 Codex 手动补外部页面或厂家资格页证据
2. **优先抽查高待申领金额记录**
   - 当前 `claimableAmount = 258406`
   - 优先处理高金额、已具备内部链路但缺外部资格页证明的记录
3. **前端 `产品价保 -> 合规校验预警` 做一轮肉眼验收**
   - 当前仅确认同名数据文件已同步
   - 尚未补真实 `5174` 页面可见验收

## 下一步（2026-06-09 01:00 PO 6.9 新政策已写入发布投影，待补真页验收与活动库后续清理）

### 已落地
1. ✅ 已确认 `6.9-6.21` 新 PO 加磅政策源文件已存在并已被系统读取
2. ✅ 发布投影当前活动选择器已修复，不再按旧高额规则误取当前 PO
3. ✅ `20006725 / 20007934` 当前发布投影已分别落到 `PO 600 / PO 1000`

### 仍待推进
1. **在真实 `5174` 页面补一轮肉眼验收**
   - 重点看用户此前看到的 `PO加磅-￥2,200` 文案是否已经切成 `6.9` 新政策
2. **后续如继续治理营销活动库本身**
   - 再单独处理 `latest-marketing-boost-snapshot.json` 中同 SKU 新旧规则并存的问题
   - 当前主问题已由发布投影修复，不影响零售展示口径
3. **如用户继续点名其它 SKU**
   - 继续按 `pnMtm -> product_activity_current -> published projection` 这条链逐条抽查

## 下一步（2026-06-09 00:20 SKU 20006289 已完成所有终端数据链同步，待补真实页面验收）

### 已落地
1. ✅ 主前端 / 广告机 / Android POS Lite / 零售终端 已统一具备“纯 SKU 标题回退到真实 YOGA 标题”的兜底链
2. ✅ `latest-published-product-projection*.json` 顶层与 `channelViews` 已统一到 YOGA 标题、YOGA 分类
3. ✅ SQLite `product_master.PROD-20006289.default_category` 已写回 `YOGA`

### 仍待推进
1. **在真实页面补一轮终端肉眼验收**
   - `http://127.0.0.1:5174/`
   - `http://127.0.0.1:5174/ad-machine/index.html`
   - `http://127.0.0.1:5174/android-pos-lite.html`
   - `http://127.0.0.1:5174/retail-ops-terminal.html`
2. **确认后台定时链不会再次把 `20006289` 刷回纯 SKU 标题**
   - 重点观察 `latest-published-product-projection.json`
   - 重点观察 `latest-published-product-projection-live.json`
3. **如果后续继续修其它同类机型**
   - 复用这一轮“主前端 + 终端兜底 + SQLite 主档”三层修正链

## 下一步（2026-06-09 00:00 店面手动活动 SQL 保存反馈已修，待补真实失败态/成功态可见验收）

### 已落地
1. ✅ `店面手动满减活动库（SQL）` 已补可见状态提示
2. ✅ SQL 保存失败时已改成前端回滚，不再把脏本地态留在页面里
3. ✅ 当前 SQL 表已恢复为原始 `6` 条活动记录，未遗留调试数据

### 仍待推进
1. **在真实 `5174 -> 产品价保 -> 营销/教育补活动库 -> 店面手动活动` 补一轮失败态可见验收**
   - 重点确认未选 SKU、金额为空、日期非法时页面会立即显示提示
2. **补一轮成功态可见验收**
   - 重点确认新增/编辑后页面出现 `已保存到 SQL` 类提示，刷新后数据仍在
3. **如后续继续做此页面后端联调，优先评估是否要把“全量覆盖写回”改成增量接口**
   - 当前接口可用，但批量覆盖语义对并发和误操作都更脆弱

## 下一步（2026-06-09 00:00 库存台账 SN 明细 bug 已修，待做同链路抽查）

### 已落地
1. ✅ 库存台账里“SN 1 但展开明细（0）”的问题已修复
2. ✅ 真实 `5174 -> 库存台账` 已确认 9 个实物仓-only SKU 恢复显示 SN 明细
3. ✅ 前端构建已通过

### 仍待推进
1. **继续抽查 3-5 个混合库存 SKU 的 SN 明细**
   - 重点确认“门店 SN + 实物仓 SN 并存”时不会重复或漏并
2. **如果用户继续反馈 SN 保修页异常，优先复用这条序列号合并链排查**
   - 重点看库存台账展开区、SN 保修筛选区是否共用同一批 `serials`
3. **如其它终端复用库存台账 SN 展开逻辑，再补一轮终端侧可见抽查**
   - 当前已验证的是主前端 `5174`

## 下一步（2026-06-09 00:12 终端已补 YOGA 兜底链，待做真页验收与主档分类写回）

### 已落地
1. ✅ 广告机 / POS 终端已不再硬信 `published projection` 里的纯 SKU 标题
2. ✅ `20006289` 的终端显示分类已优先走 `YOGA`
3. ✅ 前端构建已通过

### 仍待推进
1. **必须在真实终端页面补一轮肉眼验收**
   - `http://127.0.0.1:5174/`
   - 广告机页
   - `android-pos-lite.html`
   - 重点确认：
     - 标题显示 `YOGA Air 14 ILL10（YOGA Air 14 Aura AI元启版）`
     - 分类标签显示 `YOGA`
     - 规格显示 `Ultra5-228V 32G 1T`
2. **该项已在 2026-06-09 00:20 收口**
   - `product_master.default_category = YOGA`
   - 当前剩余的是页面验收，不再是主档写回
3. **若后续还有其它机型被投影刷回纯 SKU 标题**
   - 复用本轮终端兜底逻辑，不再单 SKU 特判

## 下一步（2026-06-08 23:55 SKU 20006289 标题与详细配置已同步，待补真实页面可见验收）

### 已落地
1. ✅ `20006289 / 83JX000ACD` 已从纯 SKU 标题改回：
   - `YOGA Air 14 ILL10（YOGA Air 14 Aura AI元启版）`
2. ✅ 详细配置已补齐并同步：
   - `Ultra5-228V 32G 1T`
   - `83JX000ACD · Ultra5-228V 32G 1T`
3. ✅ 前端 `public/data`、API 数据副本、`inventory-sync artifacts` 与 SQL `snapshot_cache` 已统一到新标题/配置

### 仍待推进
1. **必须在真实 `5174` 页面肉眼复看该 SKU**
   - 重点看 `实时零售报价 / 库存台账`
   - 确认商品卡标题和详细配置已不再显示 `20006289`
2. **继续排查是谁触发了自动 `inventory-master-sync` 占锁链**
   - 本轮曾出现 `run-local-sync inventory-master-sync` 与 `uvicorn` 并发占 SQLite
   - 后续若继续改主档，优先避免自动同步链反复抢锁
3. **如果用户继续逐台修正标题，优先按同一链路处理**
   - 先核产品库详情真值
   - 再同步 `published projection / channel audit / snapshot_cache`

## 下一步（2026-06-09 00:05 广告机/POS 纯转存手机已补显，剩余是基础审计清理）

### 已落地
1. ✅ 广告机手机彩页已补入 `20007812`
2. ✅ POS 商品池稳定回到 `109`，`20007812` 分类已改成 `智能生活`
3. ✅ 主零售页、广告机、POS 都已完成纯转存手机样例回归

### 仍待推进
1. **处理基础库存/SN 冲突 `coreStockSnMismatchCount = 3`**
   - 当前样例：
     - `20006725`
     - `20003216`
     - `20007931`
2. **升级 `scripts/audit_terminal_stock_sn_sync.py`**
   - 让脚本改按“总库存口径”审计
   - 去掉当前 `projectionVsStandardMismatchCount = 27` 的假阳性
3. **继续抽查广告机漏显的非电脑类商品是否需要纳入彩页**
   - 当前 `55` 个广告机未展示 SKU 里，大头仍是配件/打印机/显示器
   - 需要按业务口径确认是“应显示未补页”还是“本就不该上彩页”

## 下一步（2026-06-08 23:45 紧凑库存快照已补回实物仓字段，待补终端真页回归）

### 已落地
1. ✅ `inventory?compact=1` 已补回 `physicalHoldStock / physicalHoldSerialCount`
2. ✅ 真实 `5174 -> 实时零售报价` 已确认混合库存与纯转存 SKU 按总库存显示
3. ✅ `20006725 / 20007934 / 20006289` 已完成真实页面样例回归

### 仍待推进
1. **必须在真实广告机 / POS 页面补一轮可见验收**
   - 重点确认商品卡库存仍按 `总库存`
   - 重点确认 `未PO = 0 / 转存 > 0` 的 SKU 继续可见
2. **继续抽查 3-5 个高实物仓 SKU**
   - 优先抽查 `physicalHoldStock` 高、同时有门店库存的机型
   - 避免只修复了 `20006725 / 20007934` 这种样例
3. **如用户继续反馈漏 SKU，按 SKU 追到对应终端渲染链**
   - 优先看是否仍有页面走旧缓存或旧离线包

## 下一步（2026-06-08 23:35 纯转存 SKU 兜底补位已补，待做真实页面可见回归）

### 已落地
1. ✅ 零售兜底链已不再漏掉 `storeCurrentStock = 0 && physicalHoldStock > 0` 的 SKU
2. ✅ 商品级库存文案已统一为 `库存 X 台`
3. ✅ 前端构建已通过

### 仍待推进
1. **必须在真实 `5174 -> 实时零售报价 / 实时库存成本` 补一轮可见验收**
   - 重点确认 `门店 0 / 转存 > 0` 的 SKU 实际能出现
2. **必须在真实广告机 / POS 页面补一轮可见验收**
   - 重点确认终端卡片只显示 `库存 X 台`，且纯转存 SKU 不消失
3. **如仍有漏 SKU，继续按具体 SKU 追展示链**
   - 优先追 `published projection` 已有、但页面仍不可见的型号

## 下一步（2026-06-08 23:20 转存库存终端补位已落地，待做真实页面可见回归）

### 已落地
1. ✅ 发布投影已带入转存库存：
   - `holdVisibleCount = 27`
   - `holdOnlyCount = 13`
2. ✅ 实时零售/广告机/POS 已改成按总库存展示：
   - `总可见库存 = 门店库存 + 转存实物仓库存`
3. ✅ 纯转存 SKU 已具备补位条件：
   - `retail-zone 96 + published supplement 13 = merged 109`
   - 已确认包含 `20006289 / 20007935 / 20002909`

### 仍待推进
1. **必须在真实 `5174` 页面补一轮可见验收**
   - 重点看：
     - `实时零售报价`
     - `库存台账`
     - `系统管理 -> PO / 教育补实物仓`
   - 验证纯转存 SKU 是否实际出现、数量是否按总库存显示
2. **必须在真实广告机 / POS 页面补一轮可见验收**
   - 重点看广告机和平板/手机终端是否出现纯转存 SKU
   - 确认活动营销 / 教育补贴文案没有因为转存而丢失
3. **如还有具体漏 SKU，继续按 SKU 追溯**
   - 优先追 `physicalHoldStock > 0 && retail-zone 无此 SKU` 的型号

## 下一步（2026-06-08 23:06 `zhidiantong-sync-cycle` 15:00 报告已生成但仍未收口）

### 已落地
1. ✅ 新正式报告已生成：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-08T15-05-02-687Z.json`
   - `executionOutcome = executed_not_closed`
2. ✅ 本地前端可见验收已补到 `5174 -> 入库出库`：
   - `销售出库（1055）`
   - `采购入库（412）`
   - `其他出库（1201）`
   - `调拨出库（0）`
   - `调拨入库（31）`
   - 首条采购入库 `CGR260608441588 / ￥2,659 / 入库 4 台 · SN 4`
3. ✅ 新前端可见摘要已落盘：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-08-1500/frontend-visible-summary.md`

### 仍待推进
1. **必须在默认 Chrome 现有会话补当天网页微信两群边界回扫**
   - 当前 `sameDayRecordCount = 0`
   - 当前 `sameDayNoNewConfirmationFileCount = 0`
   - 当前 `openRecentGapCount = 48`
   - 没有 `education-agent-scan-2026-06-08-*.json` 或同日 `confirmedNoNewRecords` 前，不能升级为 `real_completed`
2. **必须补当天智店通总表导出**
   - `商品库存统计_2026-06-08.xlsx`
   - `商品库存SN统计_2026-06-08.xlsx`
   - 如继续做金额核验，还需当天 `orderData / orderProductData / 调拨导出`
3. **补齐主链输入后再重跑唯一正式入口**
   - 只允许 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`
   - 重跑后重点看：
     - `sameDayMissingCostCount` 是否从 `1` 清零
     - `mismatchCount` 是否从 `16` 下降
     - `latest-education-agent-scan-sync-gap.json` 是否不再挂当天销售单

## 下一步（2026-06-08 23:05 `daily-jd-lenovo-price-sync` 续跑后仍未收口）

### 已落地
1. ✅ 新正式报告已生成：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-08T15-04-28-189Z.json`
   - `executionOutcome = executed_not_closed`
2. ✅ 当天手工批次仍已被编排层吃入：
   - `apps/inventory-sync/artifacts/manual-price-supplements-20260608-automation-8-visible-chrome-batch-1.json`
   - `updatedRecordCount = 20`
3. ✅ 快照与 SQL 镜像仍已重建：
   - `latest-marketplace-price-snapshot`
   - `latest-retail-price-audit`
   - `latest-retail-zone-snapshot`
   - `latest-semi-auto-execution-plan`
   - `latest-scheduled-sql-auto-sync-audit`

### 仍待推进
1. **继续在 Chrome 现有稳定会话完成 50 条已锁定链接复核**
   - 当前 `retailPriceVerificationCount = 50`
   - 没有新的真实页面标题/规格/价格证据前，任务1不能升级为 `real_completed`
2. **继续优先处理 23 条新品优先项**
   - 当前 `newStockPriorityCount = 23`
   - 白色款未复采、规格未确认或页面证据不全的 SKU 继续保留待复核
3. **补真实前端可见验收**
   - 新报告仍判定缺 `verify_frontend_visible_sync_gate`
   - 当前沙箱不能绑定 `127.0.0.1:5174`，需在已有可用前端会话或非受限环境下完成 `实时零售报价` 可见复核

## 下一步（2026-06-08 23:05 OpenClaw 本机入口已修通）

### 已落地
1. ✅ 当前电脑终端已可直接执行 `openclaw`
2. ✅ OpenClaw gateway 仍健康：
   - `127.0.0.1:18789`
   - `ai.openclaw.gateway`
3. ✅ 仓库内检查脚本已加超时保护：
   - `scripts/check-openclaw.sh`
   - `scripts/openclaw_healthcheck.sh`

### 仍待推进
1. **如后续继续收敛 OpenClaw 历史残留，再按归档口径处理**
   - 重点参考 `docs/ai-context/17_OPENCLAW_AND_SCHEDULED_TASK_AUDIT_20260527.md`
   - 区分“本机工具可用”与“正式业务主链是否启用”
2. **若用户要继续做 OpenClaw 相关整改，优先审计以下残留入口**
   - `apps/api-server/app/openclaw_chat_board.py`
   - `apps/inventory-sync/src/storage/openclawCommandBoard.ts`
   - `apps/inventory-sync/src/storage/openclawReceipts.ts`

## 下一步（2026-06-08 22:06 `daily-jd-lenovo-price-sync` 已吃入手工批次但仍未收口）

### 已落地
1. ✅ 新正式报告已生成：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-08T14-00-44-131Z.json`
   - `executionOutcome = executed_not_closed`
2. ✅ 当天 `automation-8` 可见 Chrome 手工批次已被编排层吃入：
   - `apps/inventory-sync/artifacts/manual-price-supplements-20260608-automation-8-visible-chrome-batch-1.json`
3. ✅ 快照与 SQL 镜像已重建：
   - `latest-marketplace-price-snapshot`
   - `latest-retail-price-audit`
   - `latest-retail-zone-snapshot`
   - `latest-semi-auto-execution-plan`
   - `latest-scheduled-sql-auto-sync-audit`

### 仍待推进
1. **继续在 Chrome 现有稳定会话完成 51 条已锁定链接复核**
   - 当前 `retailPriceVerificationCount = 51`
   - 没有新的真实页面标题/规格/价格证据前，任务1不能升级为 `real_completed`
2. **继续优先处理 19 条新品优先项**
   - 当前 `newStockPriorityCount = 19`
   - 白色款未复采、规格未确认或页面证据不全的 SKU 继续保留待复核
3. **补真实前端可见验收**
   - 本轮调度报告仍判定缺 `verify_frontend_visible_sync_gate`
   - 当前沙箱里 `5174` 无法新绑本地端口，需在已有可用前端会话或非受限环境下完成 `实时零售报价` 可见复核

## 下一步（2026-06-08 21:58 `daily-gray-channel-check` 午后轮次已到当天文章但仍未收口）

### 已落地
1. ✅ 默认 Chrome 现有会话已真实进入灰渠公众号当天文章 `2026-06-08 郑州创业 联想 华为 报价`
2. ✅ `daily-gray-channel-check` 已新增正式报告：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-gray-channel-check/2026-06-08T13-57-56-137Z.json`
   - `executionOutcome = blocked_missing_input`
3. ✅ 已补当天入口与前端证据：
   - `apps/inventory-sync/artifacts/manual/gray-channel-visible-article-2026-06-08.txt`
   - `apps/inventory-sync/artifacts/manual/daily-gray-channel-check-2026-06-08-pm/*.png`

### 仍待推进
1. **修正灰渠访问证据到 5174 的映射**
   - 当前 `报价来源 -> 公众号报价库` 仍显示 `入口访问证据 未记录`
   - 仍显示 `最新可见文章 2026-06-07`
   - 需要查清 `latest-gray-channel-visible-article.json` / 前端读取链为什么没吃到 `manual/gray-channel-visible-article-2026-06-08.txt`
2. **决定“当天文章已到达但无有效联想整机报价”是否需要独立终态**
   - 当前实现只能在 `blocked_missing_input` 和 `executed_not_closed` 间兜底
   - 且“当天 rawText 落盘”会直接走 `real_completed` 分支，存在误报风险
3. **在不误报的前提下补充灰渠正文结构化证据**
   - 若后续需要 OCR/正文文本，必须避免命中 `gray-wholesale-YYYY-MM-DD.*` 的自动完成分支

## 下一步（2026-06-08 21:36 `zhidiantong-sync-cycle` 13:30 线程仍未收口）

### 已落地
1. ✅ 补到默认 Chrome 现有会话的新可见状态：
   - 网页微信当前可进入 `教育补贴群` / `智店通入库群`
   - 智店通当前仍是已登录稳定页
   - 5174 `入库出库` 当前能加载出 `销售出库 1055 / 采购入库 415 / 其他出库 1198 / 调拨入库 31`
2. ✅ 补到新的人工证据摘要：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-08-2130/visible-evidence-summary.md`
3. ✅ 真实尝试了一次正式入口：
   - `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`
   - `tsx` 失败后自动切 fallback，但未产出新正式报告

### 仍待推进
1. **清掉本轮锁/挂起问题后再重跑唯一正式入口**
   - 先确认 `.scheduled-task.lock` 是否被其它任务占用还是 fallback 中断后残留
   - 只在锁明确释放后，再跑一次 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`
2. **网页微信两群必须真正进入图片查看器并扫到当天边界**
   - 当前只到群聊正文区和可见图片，未形成 `education-agent-scan-2026-06-08-*.json`
   - 没到边界前，不能写“无新增”
3. **智店通当天总表导出仍缺**
   - 仍需真实拿到 `商品库存统计_2026-06-08.xlsx` 与 `商品库存SN统计_2026-06-08.xlsx`
   - 仍需继续补当天 `线下门店订单 / 采购入库 / 其他出库 / 调拨出入库 / 库存流水 / SN库存订单`
4. **authoritative 终态暂时不变**
   - 继续沿用 `2026-06-08T13-07-48-796Z.json`
   - `executionOutcome = executed_not_closed`
## 下一步（2026-06-08 22:07 `automation-8` 窗口外门禁）

### 已落地
1. ✅ 新窗口外阻塞证据已生成：
   - `apps/inventory-sync/artifacts/manual/automation-8-2026-06-08-2207-window-gate/`
2. ✅ authoritative 状态已重确认：
   - 最新正式报告仍是 `2026-06-08T14-03-13-519Z.json`
   - `executionOutcome = executed_not_closed`
   - `blockingReason = 仍有 51 条已锁定链接待真实手工复核`

### 仍待推进
1. **等待下一有效窗口 `2026-06-09 10:00-22:00 CST`**
   - 当前窗口已关闭，不能再开新的真实页面核价
2. **下一窗继续处理 51 条已锁定链接复核**
   - 重点先看老化锁链和官旗缺位项
3. **下一窗必须补齐真实页面门禁**
   - 页面标题/规格/价格证据
   - SQL/API 写入证据
   - 前端 URL/子书签/关键字段可见验收证据

## 下一步（2026-06-08 22:18 `zhidiantong-sync-cycle` 本轮未重跑，先补主链输入）

### 已落地
1. ✅ 新阻塞证据已生成：
   - `apps/inventory-sync/artifacts/manual/zhidiantong-sync-cycle-2026-06-08-2218-run-gate/blocking-summary.md`
2. ✅ authoritative 状态已重确认：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/zhidiantong-sync-cycle/2026-06-08T13-54-46-299Z.json`
   - `executionOutcome = executed_not_closed`
3. ✅ 本轮已确认不是锁阻塞，而是输入阻塞：
   - 无当天 `education-agent-scan-2026-06-08-*.json`
   - 无当天 `商品库存统计 / 商品库存SN统计 / orderData / orderProductData / 采购入库 / 其它出库 / 调拨` 导出

### 仍待推进
1. **先在默认 Chrome 现有会话补齐两类当天主链输入**
   - 网页微信两群历史回扫到边界，形成 `education-agent-scan-2026-06-08-*.json` 或同日 `confirmedNoNewRecords`
   - 智店通当天导出 `商品库存统计 / 商品库存SN统计 / 线下门店订单导出 + 导出明细 / 采购入库 / 其他出库 / 调拨出入库`
2. **输入补齐后再重跑唯一正式入口**
   - 只允许 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`
   - 重跑前先复核 `.scheduled-task.lock` 为空
3. **重跑后重点盯三类未收口指标**
   - `sameDayMissingCostCount` 是否从 `1` 清零
   - `mismatchCount` 是否从 `9` 下降
   - `latest-education-agent-scan-sync-gap.json` 是否不再挂当天销售单缺口

## 下一步（2026-06-08 23:02 库存自动同步已接入动作与页面入口）

### 已落地
1. ✅ 库存相关实物仓动作已自动触发 `inventory-master-sync`
2. ✅ `库存台账 / 实物仓` 页面入口已自动请求一次 `ensure-inventory-master`
3. ✅ `8000` API 已切到新代码进程，自动同步门禁路由已挂载

### 仍待推进
1. **做一轮真实 5174 页面可见验收**
   - 验证 `转仓 / 转回 / 撤销` 后，库存台账数字是否无须手动刷新即可对齐
2. **决定是否把同样门禁扩到其它库存写入入口**
   - 如后续本地销售单、采购单、导入台账也需要动作后秒级同步，再按同一门禁扩接
3. **关注 `inventory-master-sync` 实际耗时**
   - 如果页面入口等待时间过长，再评估是否拆成“后台触发 + 前端轮询完成态”

## 下一步（2026-06-08 23:31 `sn-15` 已补 1 条官网保修，先补前端显示链）

### 已落地
1. ✅ `BH020S9X` 官网保修已查到：
   - `2026-02-09 -> 2028-03-10`
2. ✅ 当天证据已落盘：
   - `apps/inventory-sync/artifacts/manual/warranty/2026-06-08/BH020S9X-success.{png,txt}`
3. ✅ 快照与 SQL 已同步：
   - `latest-lenovo-warranty-snapshot.json -> successCount 259`
   - `latest-warranty-check-queue.json -> 165`
   - `serial_item.BH020S9X = success`

### 仍待推进
1. **先查前端 `SN保修 / 库存台账` 的保修字段显示链**
   - 当前能筛到 `BH020S9X`，但未直接显示 `2028-03-10`
   - 要先确认是子书签路径问题，还是 `official_warranty_end` 没被渲染到当前表格
2. **在同一 Chrome 会话继续补 `20003216 / 83NN0001CD` 同批高优先级 SN**
   - `BH020SCE`
   - `BH02299R`
   - `BH0229BN`
   - `BH0229BS`
   - `BH022PTC`
3. **遇验证码/白屏/安全验证立即停手并写 `blocked_page_risk`**
   - 保修补录不能拖住库存、价格和出入库主链

## 下一步（2026-06-09 00:02 `daily-jd-lenovo-price-sync` 续跑后仍未收口）

### 已落地
1. ✅ 新正式报告已生成：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-08T16-02-54-229Z.json`
   - `executionOutcome = executed_not_closed`
2. ✅ 编排层已重建当轮计划与快照：
   - `latest-product-url-locks.json`
   - `latest-collection-operation-plan.json`
   - `latest-retail-price-audit.json`
   - `latest-semi-auto-execution-plan.json`
   - `latest-retail-zone-snapshot.json`
   - `latest-scheduled-sql-auto-sync-audit.json`
3. ✅ SQL 缺口当前为 `0`
   - `openSyncGapCount = 0`

### 仍待推进
1. **必须在默认 Chrome 现有稳定会话补 2026-06-09 当天真实手工价格批次**
   - 当前未发现 `manual-price-supplements-20260609*.json`
   - 没有当天手工批次前，任务1只能继续维持 `executed_not_closed`
2. **继续优先消化 50 条已锁定链接复核和 23 条新品优先项**
   - `retailPriceVerificationCount = 50`
   - `newStockPriorityCount = 23`
3. **补真实前端可见验收并恢复 8000/5174 可访问链**
   - 当前 `8000` 未监听
   - 当前 `vite preview` 绑定本地端口仍 `EPERM`
   - 缺 `verify_frontend_visible_sync_gate` 前不能升级终态

## 下一步（2026-06-11 UI 收口规则已固化）

### 已落地
1. ✅ 后台 UI 固定工作流已写入：
   - `AGENTS.md`
   - `docs/ai-context/02_DECISIONS.md`
   - `docs/ai-context/12_EXECUTION_CORE.md`
   - `docs/ai-context/19_RETAIL_UI_RESTYLE_PLAYBOOK.md`
2. ✅ 固定短提示词已定：
   - `按固定UI工作流收口这个页面`

### 仍待推进
1. **下次进入真实 UI 整改任务时，直接按固定短提示词启动**
   - 不再每轮重新讨论方法
2. **优先拿一个真实后台页走完整链路**
   - `design-consultation -> design-review -> 修改 -> taste-skill -> qa/browser`
3. **如本轮涉及页面改动，再补构建与真实页面验收记录**
   - 文档规则已到位，但还未执行新的页面级落地整改

## 下一步（2026-06-11 教育补 CLI 主链已落地首批真实入库）

### 已落地
1. ✅ `今日相机网页分类文件夹 -> CLI -> Bridge -> SQL -> 工作台` 首批真实链路已跑通
2. ✅ `scan_date` 已改为按图片真实拍摄时间写入，不再一律写当天
3. ✅ 工作台接口已能显示 `watermark_camera_manual / xhey_web_folder_cli`

### 仍待推进
1. **继续批量导出梁伟 / 郭晨臣 / 李建定 6 月 6 日之后的分类文件夹真实图片**
   - 梁伟 / 郭晨臣 / 李建定 首批已跑，下一步转向剩余员工或新增导出批次
2. **补齐 CLI 归类批次，不再只做首批样本**
   - 目标是持续压缩 `since_date=2026-06-06` 后的 `gapCount`
3. **继续保留 API 为待恢复主链**
   - 只有 `list/search` 真能返回图片时，才允许把主链从 CLI 切回 API

## 下一步（2026-06-11 京东联想价格编排续办）

### 已落地
1. ✅ 新编排报告已生成：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-11T10-02-18-601Z.json`
2. ✅ 编排层已刷新：
   - `latest-semi-auto-execution-plan.json`
   - `latest-scheduled-sql-auto-sync-audit.json`
3. ✅ SQL 缺口当前为 `0`

### 仍待推进
1. **必须由默认 Chrome 稳定会话补 2026-06-11 当天真实手工价格批次**
   - 当前未发现 `manual-price-supplements-20260611*.json`
2. **继续优先消化 50 条已锁定链接复核和 18 条新品优先项**
   - 缺真实页面证据前，任务1只能维持 `executed_not_closed`
3. **恢复本地前端可见验收链**
   - `127.0.0.1:5174` 当前未监听
   - 需补 `verify_frontend_visible_sync_gate` 后才有机会升级终态

## 下一步（2026-06-11 automation-8 已补 1 条真实价格证据，但标题一致性审计仍阻塞）

### 已落地
1. ✅ 已新增当天真实手工批次：
   - `apps/inventory-sync/artifacts/manual-price-supplements-20260611-automation-8-visible-chrome-batch-1.json`
2. ✅ 正式入口已吃入本轮 2 条价格证据：
   - `updatedRecordCount = 2`
3. ✅ 前端 `商品零售 -> 实时零售报价` 已人工看见 `20006381` 对应字段

### 仍待推进
1. **先查通 `audit_terminal_title_consistency.py` 的本地 API 访问失败**
   - 当前报错：
     - `apiRetailZoneStatus = unavailable:<urlopen error [Errno 1] Operation not permitted>`
2. **继续用默认 Chrome 会话补下一条高优先已锁定 SKU**
   - 当前只补了 `20006381`
   - 队列仍有 `retailPriceVerificationCount = 50`
3. **补“联想官网商城稳定工作页”到固定 5 页恢复态**
   - 本轮进入任务前固定 5 页里缺标准联想商城工作页

## 下一步（2026-06-11 教育补 CLI 主链补录后续）

### 已落地
1. ✅ CLI 主链已切正式入库
   - `xhey_web_folder_cli.py` 不再把 `DRY-*` 误判为已处理
   - `run_education_subsidy_cli_sync.py` 已强制 `XHEY_DRY_RUN=false`
2. ✅ 自动化脚本已补齐
   - `scripts/run_education_subsidy_cli_sync.sh`
   - `scripts/install_education_subsidy_cli_sync.sh`
   - `infra/launchagents/com.lenovo-smart-retail.education-subsidy-cli-sync.plist`
3. ✅ 前端价格保护页首屏 `智享金` 汇总已统一

### 仍待推进
1. **重载本地 `8000` API 进程，让 workbench 总览吃到最新 84 条汇总**
   - 当前文件已更新，但接口仍返回旧的 `62`
2. **继续补 `智店通入库群` 79 条缺口**
   - 优先补带电话/订单证据的图
   - 只有商品/SN 图的记录继续保留人工复核
3. **继续推进同手机号多件套升级**
   - 当前候选重点：
     - `15531851050`
     - `16711030562`

- 教育补下一步：不要再盲扫全目录，改为围绕 `gapBacklog.samples` 的 `智店通入库群` 缺口样本定向补图。

## 下一步（2026-06-11 20:10 教育补服务误归类已修正，当前主目标改为继续压 `63` 条真实机器缺口）

### 已落地
1. ✅ bridge 已改成“同 SN 先匹配机器，再过滤服务类”
2. ✅ `2026-06-06` 以来 `5` 条服务误归类记录已修回机器单
3. ✅ workbench 当前接口已返回：
   - `sqlServiceFilteredCountSinceDate = 0`
   - `gapCountSinceDate = 63`
4. ✅ `17896857958` 已升级成：
   - `two_piece`
   - `智店通入库群`

### 仍待推进
1. **继续按 gap 样本定向补 `智店通入库群` 机器单**
   - 当前优先：
     - `XS260611357198264001 / YX0J3EBJ`
     - `XS260611891383245001 / 870017738BLDX63M3242`
     - `XS260611477486929001 / YX0J3A6E`
     - `XS260611721755629001 / 870017738BLDX63M3064`
2. **继续盯同手机号自动升级**
   - 当前正式候选：
     - `15531851050`
     - `16711030562`
     - `17896857958`
3. **把 `repair_education_service_filtered_records.py` 纳入教育补 CLI 自动同步链**
   - 现在脚本已可单独执行
   - 下一步应并到正式编排，避免后续再出现“服务单抢占机器 SN”后需要人工补修
## 下一步（2026-06-11 20:29 `daily-jd-lenovo-price-sync` 已拿下 `20004481`，下一步继续补下一个高库存已锁定 SKU，并评估是否把人工前端验收文件接入 runner gate）

### 已落地
1. ✅ `20004481 / ZAE70012CN` 已新增真实京东/联想官旗证据
2. ✅ 标题一致性门禁 `20006289` 已在发布投影源头补强，`python3 scripts/audit_terminal_title_consistency.py` 当前返回 `issueCount = 0`
3. ✅ 前端人工可见已通过
   - `http://127.0.0.1:5174/ -> 商品零售 -> 实时零售报价`
   - 搜索 `20004481`
   - 页面可见 `执行价 ￥1,999 / 国补 ￥1,656.65 / 京东+联想官旗链接`

### 仍待推进
1. **继续下一个高库存已锁定 SKU**
   - 优先仍按 `latest-semi-auto-execution-plan.json` 高库存顺序
   - 候选可回到 `20002811` 错链风险或继续 `20006381 / 20003216` 这类已锁定 SKU
2. **决定是否把人工前端验收文件接入 `verify_frontend_visible_sync_gate`**
   - 当前真实前端已核过
   - 但 runner 仍因“未自动读取人工前端证据”停在 `executed_not_closed`
3. **保持剩余待复核队列透明**
   - 当前正式报告仍写 `仍有 50 条已锁定链接待真实手工复核`

## 下一步（2026-06-11 20:35 教育补工作台已切到 v2 SQL 主链，下一步只补真实缺口，不再碰旧汇总口径）

### 已落地
1. ✅ `latest-education-subsidy-agent-scan-summary.json` 已改为 `education_scan_record_v2` 主口径
2. ✅ 工作台 `8000` 总览已与 SQL 一致：
   - `projectionTotalCount = 67`
   - `gapCountSinceDate = 88`
3. ✅ `13282003112` 与 `17896857958` 新实采已同步到 SQL 与前端工作台

### 仍待推进
1. **继续补 `智店通入库群` 前五条真实缺口**
   - `XS260611357198264001 / YX0J3EBJ`
   - `XS260611891383245001 / 870017738BLDX63M3242`
   - `XS26061016204358199 / 870017738BLDX63L0762`
   - `XS26061020838317399 / YX0K7PYB`
   - `XS26061024941124599 / 870017738BLDX63W6648`
2. **继续扫同手机号多件套升级**
   - 优先盯 `17896857958` 是否还能补到 `YX0J3A6E`
   - 继续保留 `15531851050 / 16711030562` 候选
3. **把 `latest-education-agent-scan-sync-gap.json` 的生成范围收紧到教育补相关订单**
   - 当前原始 gap 文件总量仍偏大
   - 工作台已过滤到 `88`，但底层文件还可以继续降噪

### 更新（2026-06-11 21:03）
1. ✅ 智店通群历史层已恢复
   - 当前工作台投影：
     - `总条数 = 82`
     - `智店通入库群 = 49`
     - `教育补贴群 = 33`
2. **继续压 gap**
   - 当前 workbench：
     - `gapCountSinceDate = 61`
   - 优先仍是：
     - `YX0J3EBJ`
     - `870017738BLDX63M3242`
     - `870017738BLDX63L0762`
     - `YX0K7PYB`
     - `870017738BLDX63W6648`
## 下一步（2026-06-12 04:07 `daily-jd-lenovo-price-sync` 已刷新正式 runner，但仍卡在手工复核窗口外和前端可见验收缺失）

### 已落地
1. ✅ `automation-2` 已重新执行正式编排入口，并新增 runner：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-11T21-03-24-965Z.json`
2. ✅ 最新 authoritative 终态已再次确认：
   - `executionOutcome = executed_not_closed`
   - `blockingReason = 仍有 50 条已锁定链接待真实手工复核`
3. ✅ 当前已确认不是缺价问题：
   - `missingPriceCount = 0`
   - `frontendBlankPriceCount = 0`

### 仍待推进
1. **等到北京时间 `2026-06-12 10:00` 后继续 `automation-8` 或主线程 Chrome 可见复核**
   - 只处理 `latest-semi-auto-execution-plan.json` 的 `retail-price-verification` 队列
   - 当前剩余量仍是 `50`
2. **补当天新的手工价格批次**
   - 只接收真实默认 Chrome 会话里的京东/联想页面复核结果
   - 没有 `manual-price-supplements-2026-06-12*.json` 前，不要再把编排 runner 误写成已收口
3. **恢复前端可见验收链**
   - 当前 `127.0.0.1:5174` 与 `192.168.13.104:5174` 都未监听
   - 下一手需要先恢复前端页面可见，再补 `verify_frontend_visible_sync_gate`

## 下一步（2026-06-12 05:06 `daily-jd-lenovo-price-sync` 已刷新到更晚 runner，但仍只有窗口外阻塞证据）

### 已落地
1. ✅ `automation-2` 已再次执行正式编排入口，并新增 runner：
   - `apps/inventory-sync/artifacts/scheduled-task-runs/daily-jd-lenovo-price-sync/2026-06-11T22-05-44-035Z.json`
2. ✅ 最新 authoritative 终态已再次确认：
   - `executionOutcome = executed_not_closed`
   - `blockingReason = 仍有 50 条已锁定链接待真实手工复核`
3. ✅ 当前已确认不是缺价问题：
   - `missingPriceCount = 0`
   - `frontendBlankPriceCount = 0`

### 仍待推进
1. **等到北京时间 `2026-06-12 10:00` 后继续 `automation-8` 或主线程 Chrome 可见复核**
   - 只处理 `latest-semi-auto-execution-plan.json` 的 `retail-price-verification` 队列
   - 当前剩余量仍是 `50`
2. **补当天新的手工价格批次**
   - 只接收真实默认 Chrome 会话里的京东/联想页面复核结果
   - 没有 `manual-price-supplements-2026-06-12*.json` 前，不要再把编排 runner 误写成已收口
3. **恢复前端可见验收链**
   - 当前 `127.0.0.1:5174` 与 `192.168.13.104:5174` 都未监听
   - 下一手需要先恢复前端页面可见，再补 `verify_frontend_visible_sync_gate`
## 下一步（2026-06-12 10:20 教育补代扫 V2 主链已接通）

### 已落地
1. ✅ CLI 主链已支持显式目录 / ZIP 入口。
2. ✅ SQL 正式记录已输出 V2 归类字段与金额口径。
3. ✅ 工作台和管理端已切到正式 API / SQL 主链。

### 仍待推进
1. **补跑 2026-06-06 以来 CLI backlog**
   - 用真实今日相册分类目录或 ZIP 批量重跑
   - 目标是把当前 `gapCountSinceDate = 61` 继续往下压
2. **在管理端逐批锁定 evidence_only / 套装候选**
   - 尤其是手机号已累计两件/三件但仍存在空产品占位的记录
3. **把 V2 规则同步到 React 主驾驶舱内嵌视图**
   - 当前已先收口静态页 `education-subsidy-2026/*.html`
