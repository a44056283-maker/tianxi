# 置顶 Codex 线程摘要快照

生成时间：2026-06-07 22:00 (Asia/Shanghai)
数据来源：`/Users/luxiangnan/.codex/.codex-global-state.json` 的 `pinned-thread-ids`（10 条）+ `/Users/luxiangnan/.codex/session_index.jsonl` 的 `thread_name` / `updated_at` + `/Users/luxiangnan/.codex/memories/MEMORY.md` 的相关锚点 + `/Users/luxiangnan/.codex/memories/rollout_summaries/` 里命中 thread_id 的 2 份预生成摘要。

边界声明：只写元数据 + 关键决策 + 当前状态摘要，不抄线程正文、不附 JSONL 原文、不写入 Cookie / Session / Token 之类的会话敏感字段。Codex Desktop 的 `pinned-thread-ids` 与 `archived_sessions/*.jsonl` 的 session id 不在同一命名空间，所以本快照不试图还原逐条 user/assistant 消息。

---

## 1. 商业化进度执行
- pinned id：`019e372b-79bf-7711-99bb-615e74eb12d3`
- 最后活跃：`2026-05-24T14:42:40Z`
- 当前快照定位：商业化 KPI、直播位 / 活动位 / 高考 / 培训等推进主线。
- 关键产物（建议优先翻）：`apps/inventory-sync/src/storage/marketingBoostStore.ts`、`apps/web-cockpit/src/App.tsx` 内的"营销/教育补英雄卡 / 活动库 / 历史活动 / 教育补代扫汇总"段落、`scripts/build_commercialization_progress.py`。
- 现状摘要：商业化进度日更以 `latest-marketing-boost-snapshot.json` / `latest-marketing-boost-history.json` 为事实源；新合规场景须走 `cross_outbound_audit` 风格的 UI 密度，不允许独立另起一套卡片化。
- 下一步候选：在 `产品价保` 下的"合规校验预警"对齐"交叉出库校验"格式（详见第 9 项 thread 摘要）。

## 2. 联想智慧零售软件开发
- pinned id：`019e1228-cb95-74c2-9fc7-433ef91b9e08`
- 最后活跃：`2026-05-24T14:43:08Z`
- 当前快照定位：项目主线程 / 总览 / `AGENTS.md` 收口，长期记忆与开发计划主线。
- 关键产物：`AGENTS.md`、`docs/ai-context/00_PROJECT_BRIEF.md` 至 `15_SUBAGENT_EXECUTION_PLAYBOOK.md`、`README.md`、`README_联想智慧零售驾驶舱_Codex实施总纲.md`。
- 现状摘要：本项目所有非 trivial 任务默认走 superpowers + gstack：plan → TDD/明确 proving check → UI 真实页面 QA → fresh verification；零售价/库存量/SN/销售金额/采购成本/营销 PO/教育补代扫费/保修日期/主标题属于受保护业务字段，没有证据不要自动改写。
- 下一步候选：跑 `bash scripts/context_pack.sh && python3 scripts/context_snapshot.py` 把今天的写盘打包成 `docs/ai-context/packages/smart-retail-context-YYYYMMDD-HHMM.zip`。

## 3. 库存对接出入库
- pinned id：`019e1ae2-ac2d-7d83-b4f4-0cbe9029198a`
- 最后活跃：`2026-05-25T05:12:35Z`
- 当前快照定位：智店通商品入库 / 出入库 / SN 主链。
- 关键产物：`apps/inventory-sync/src/storage/zhidiantongPurchaseWebImporter.ts` / `zhidiantongSalesExportImporter.ts` / `zhidiantongOtherOutboundImporter.ts` / `zhidiantongStockStreamImporter.ts`、`apps/inventory-sync/src/storage/inventorySnapshotBuilder.ts`、`docs/智店通库存对接扫描记录.md`。
- 现状摘要：智店通是库存与出入库事实来源；本地是展示、审计、二次建模和未来自建收银/门店系统中台；销售出库 / 采购入库 / 其他出库必须进入库存流水；SN 入库时间、成本、流转状态是价保与陈旧库存管理基础。
- 当前主阻塞：今天 `zhidiantong-sync-cycle` 多轮 `executed_not_closed`，主因是"标准库存快照 2-17 个 SKU 不一致 + 终端同步脚本额外发现 2-18 处主库/投影不一致"，必须重新导出同轮商品库存统计和商品库存 SN 统计再重跑 `scripts/sync_inventory_terminal_state.py`。
- 下一步候选：先把今天累积的 18 处主库/投影不一致按 SKU 拆到子代理 Hilbert（A 档），让它只产出"待修复清单"，不直接改主快照。

## 4. 智慧零售广告机系统
- pinned id：`019e30e0-2fb9-7723-bdc1-24e03c8b4717`
- 最后活跃：`2026-05-25T05:12:18Z`
- 当前快照定位：广告机渲染 / 彩页 / 15s 自动同步 / 远程 vs 本机 parity。
- 关键产物：`apps/web-cockpit/public/ad-machine/`、`apps/web-cockpit/src/App.tsx` 内的"广告机"/"游戏本彩页"/"轻薄本彩页"段、`scripts/check_ad_machine_data.sh`、`scripts/generate-lenovo-618-flyers.mjs`。
- 现状摘要：广告机页面必须基于真实浏览器复核（Playwright / Computer Use 截图都只算证据，不能替代），渲染要保留"右侧窄屏预览 + 4 列价格区 + 营销活动区"骨架；不得为了简化而删掉 15 秒自动同步或合并列。
- 下一步候选：补"local vs device parity"差异表（`check_ad_machine_data.sh` + `qrcode` 截图比对），把当前 `qrcode` 缓存版本固化到 LaunchAgent 启动失败恢复链。

## 5. 进销存含电子价签
- pinned id：`019e1c46-4d2d-7de3-b1b9-280e9cdadd9a`
- 最后活跃：`2026-05-25T05:13:12Z`
- 当前快照定位：含电子价签的进销存 / 价签生成 / 全服务价审计。
- 关键产物：`scripts/generate_store_price_tags.py`、`scripts/audit_terminal_price_consistency.py`、`scripts/audit_terminal_title_consistency.py`、`apps/api-server/app/product_library.py`。
- 现状摘要：价签主价链路已经在 `2026-05-31` 修过 `nationalSubsidyPrice` 算法（用当前门店零售价反推国补前价，排除"喷墨/墨仓/打印/复印/扫"等非国补品类）；电子价签 vs 终端 vs 主仓三处价格必须一致，否则按价签口径回算。
- 下一步候选：继续在 `audit_terminal_price_consistency.py` 加 PO + 教育补 + 店面活动的全组合抽检，不再单独跑 PO 单独跑教育补的近似算法。

## 6. Add 合规校验预警
- pinned id：`019e8caf-85c9-7b32-abe4-ee56639b4b2f`
- 最后活跃：`2026-06-03T09:05:11Z`（rollout_summary 更新到 `2026-06-03T09:57:23Z`）
- 预生成摘要：`/Users/luxiangnan/.codex/memories/rollout_summaries/2026-06-03T08-52-53-5R5Z-sn_sales_compliance_architecture_and_history_freeze.md`
- 当前快照定位：在"产品价保"下新增"合规校验预警"，UI 对齐"交叉出库校验"，按 SN 自动采集映射出入库/出库全链路信息。
- 关键发现：
  - 风险点不是前端页面能不能显示，而是 `product_activity_current` 只适合"当前有效活动"，历史页面若误读它，活动结束后历史资格会丢失。
  - 必须额外有一张受控的"活动历史冻结表"（独立 snapshot cache / 冻结层），前端读冻结表，不再读 current。
  - `apps/web-cockpit/src/zdtClone` 里的"门店 SN 有效销量报表"目前还是过渡视图/字段扫描层，字段"有效销量判断 / 是否是有效销量（实时判断）/ 是否有效销量且 PO 合规（实时判断）"等尚未真正承接到本地全链路。
- 下一步候选：先在 `apps/api-server/app/product_library.py` 加一张"活动历史冻结表"的最小 schema 和写入路径，再讨论页面，不要先出页面。

## 7. 清理本地磁盘释放 80G 空间
- pinned id：`019ea076-ef15-7440-a6af-874a3238ba78`
- 最后活跃：`2026-06-07T05:03:47Z`
- 当前快照定位：macOS 磁盘压力 / 缓存清理 / 旧 rollout 归档。
- 关键产物：`/Users/luxiangnan/.codex/archived_sessions/`、`/Users/luxiangnan/.codex/.tmp/`、`/Users/luxiangnan/.codex/cache/`、`receipts/`、`outputs/`、`apps/inventory-sync/.sync_log.txt`、`apps/inventory-sync/tmp-selkies-*.mjs`。
- 现状摘要：用户要求释放 80G，但明确区分"可迁移/可清理的历史日志/缓存"和"当前工程/数据库/活跃应用数据"。本任务属辅线，不应误报成业务链路收口。
- 下一步候选：先列每个目录当前大小（du -sh 排序），让用户挑可清理项；默认不动 `lenovo-smart-retail-cockpit/`、`apps/api-server/data/retail-core.sqlite3`、Chrome `Default/`、`Library/Application Support/codex/` 下的会话/书签/`Auth`/本地数据库等"当前工程数据"。

## 8. 执行教育补代扫规范
- pinned id：`019e8ce7-b8eb-7d70-9d4d-65bc83e2423e`
- 最后活跃：`2026-06-03T10:00:58Z`（rollout_summary 更新到 `2026-06-05T11:04:14Z`）
- 预生成摘要：`/Users/luxiangnan/.codex/memories/rollout_summaries/2026-06-03T09-54-16-K1CC-subagent_rules_sync_and_education_subsidy_field_fix.md`
- 当前快照定位：教育补代扫的新规范（产品信息图 + 核销码图为主采集标准）已下发到代码层提示词和文档层。
- 关键规则（已固化到 `apps/inventory-sync/src/semiAuto/taskPlanner.ts` 和 `scheduledTasks.ts`）：
  - 两个群同规则：必须从最新位置进入图片查看器，按历史方向自底向上完整回扫到最早目标边界，不下拉聊天。
  - 主证据是"产品信息图 + 核销码图"，箱码图只作辅助。
  - 单扫 ≥1 产品信息 + ≥1 核销码；二件套 ≥2 + ≥3；三件套 ≥3 + ≥4；双屏两件套同二件套口径。
  - 客户电话/SN/姓名三者任一成立即可认定同一订单。
  - 套装归类只允许命中"营销库 MTM + 同一真实销售出库单号"，费用按整单一次，不叠加单品代扫费。
  - 历史"箱码"文本只作历史参考，不能再作主采集标准。
- 当前主任务：今天 `2026-06-07 20:40 education-agent-zdt-name-phone-backfill-20260606-batch-02` 还有 5 条姓名/电话图证未补齐（`HA245NWD` / `HA244PS5` / `HA249WV7` / `HA2HG5EB` / `HA2HDBT4`），当前可见图片链只覆盖到 17:10，往前会跳到 06/04 旧图，下轮必须换可见图片入口再进。

## 9. 高考域名 tunnel 自愈巡检
- pinned id：`019ea0f2-67a0-7a33-9417-3dd811f5b851`
- 最后活跃：`2026-06-07T08:19:36Z`
- 当前快照定位：gaokao2026.tianlu2026.org 高公网 tunnel 的 connector 健康检查。
- 关键产物：`scripts/gaokao_tunnel_watchdog.sh`、`scripts/gaokao_gateway_server.mjs`、`apps/web-cockpit/public/gaokao-2026/`、`apps/web-cockpit/src/sw-prompt-workspace.js`。
- 现状摘要：watchdog 只能窄做"只读 + 显式列出 connector / 公网可达性"，不得擅自把高考域名写成"主备已收口"；备机 `192.168.13.48` 仍长期报 `failed to dial to edge with quic: timeout: no recent network activity`，在备机真正注册成第二个 active connector 之前，不允许把高考域名切到"主备已收口"状态。
- 下一步候选：等备机稳定后做一次真 failover 实测：下线主机高考 connector，确认公网首页和 `summary` 接口仍返回 200。

## 10. 产品价保和营销活动管理
- pinned id：`019e8b66-46c5-7790-b305-cf657c84b963`
- 最后活跃：`2026-06-03T03:57:50Z`
- 当前快照定位：价保 / 营销活动主表 / PO 合规 / 教育补交叉。
- 关键产物：`apps/api-server/app/product_library.py`（`product_activity_current` / 后续冻结表）、`apps/web-cockpit/src/App.tsx` 内"零售销售价保专区 / 营销/教育补活动库 / 历史营销/教育活动 / 价保历史汇总"、相关 `latest-price-protection-snapshot.json` / `latest-marketing-boost-snapshot.json`。
- 现状摘要：价保字段受保护，不允许没有证据就改写；`product_activity_current` 必须叠加"活动历史冻结表"才能避免历史窗口切换后掉资格；新合规场景（合规校验预警 / SN 销量合规）优先复用"交叉出库校验"的 UI 密度。
- 下一步候选：把"价保预警 + 合规校验预警 + 教育补代扫"三条线收口到一张"价保/合规主表"，统一历史冻结入口。
- 2026-06-07 数据收口：thread `019e8b66-46c5-7790-b305-cf657c84b963` 的本地 rollout（`~/.codex/sessions/2026/06/03/rollout-2026-06-03T10-53-16-019e8b66-46c5-7790-b305-cf657c84b963.jsonl`）在 line 6094（timestamp `2026-06-07T15:12:52.832Z`）出现 `user` message 的 `content` 是单元素数组 `[{ "type":"input_text","text":"?\n" }]`，与同文件其它有效 `user` 数组 content（line 6082、6088、6092 等多元素 / 长文本）相比是这条 MiniMax 切换 / API-key 调试过程中残留的孤立空 turn（`task_complete` 时长 515 ms、`last_agent_message: null`），导致 Codex 客户端在重建 Responses API `input` 列表时把 `content` 数组整体当成一个 `input` 元素塞进请求，造成上游 `input is neither string nor array of items: Mismatch type string with value "at index 982046: mismatched type with value\n\n\te\":\"input_text\",\"text\":\"?\\n\"}]}]"`。本轮已把该 line 的 `content` 收敛为字符串 `"?\n"`，与紧跟其后的 `event_msg.user_message.message = "?\n"` 形态一致；备份在 `rollout-...019e8b66....jsonl.pre-2026-06-07-input-text-fix.bak`，差异 31 字节、6096 行 JSONL 全部可解析。本轮不动 line 6082 / 6088 / 6092 等正常数组 content。

---

## 维护说明

- 本快照只读自 `~/.codex/.codex-global-state.json` 的 `pinned-thread-ids`（10 条；`019e9566` 是第 11 条但本快照生成时未纳入，会在下一轮刷新时并入）、`~/.codex/session_index.jsonl` 的 `thread_name` / `updated_at`、`~/.codex/memories/MEMORY.md` 的相关锚点、2 份预生成的 `rollout_summaries/*.md`。
- 不抄任何线程正文 / 工具调用 / base_instructions / 任何敏感字段。
- 下次再做"加载置顶对话"时建议直接复用本文件 + `latest-package-path.txt` 对应的 zip 包，不需要再扫 pinned-thread-ids。
- 如果某个 thread 的 `pinned-thread-ids` 已经从全局状态里摘除，本文件就当作"已落档的置顶历史"使用，不要把这里的内容写回全局状态。

## 2026-06-07 收口｜置顶对话 JSON 解析错误全量

- 判据：`response_item.payload.type=message && role=user && content 是单元素 input_text 数组 && 对应 turn 的 task_complete.last_agent_message=null` 或 turn 无 task_complete（孤立 turn / 无 agent 响应）
- 修法：`content` 由 `[{ "type":"input_text","text":"X" }]` 收敛为字符串 `"X"`，与紧跟 `event_msg.user_message.message` 字面一致
- 本轮 11 行 patch 覆盖：
  - 第 1 项 商业化进度执行 `019e372b` / 第 2 项 联想智慧零售软件开发 `019e1228` / 第 3 项 库存对接出入库 `019e1ae2` / 第 4 项 智慧零售广告机系统 `019e30e0` / 第 5 项 进销存含电子价签 `019e1c46` / 第 7 项 清理本地磁盘释放 80G 空间 `019ea076`：本轮无本地 rollout 文件可改
  - 第 6 项 Add 合规校验预警 `019e8caf`：line 775
  - 第 7 项 高考域名 tunnel 自愈巡检 `019ea0f2`：line 38 / 43 / 126
  - 第 8 项 执行教育补代扫规范 `019e8ce7`：line 6 / 12807 / 12813
  - 第 10 项 产品价保和营销活动管理 `019e8b66`：line 6082 / 6088 / 6094（line 6094 在上一轮已修）
  - 额外第 11 项 `019e9566`（商业化进度执行 / 备）：line 3119
- 验证：6 个本地文件 0 个 JSONL 解析失败、0 个 `"type":"input_text","text":"?` 命中；每个修后 `content` 字符串与紧跟 `event_msg.user_message.message` 字面一致
- 5 个无本地文件线程：下一轮 Codex App 重启后需观察能否在切到 MiniMax M3 后正常加载
- 备份：每个文件 1 份 `.pre-2026-06-07-pinned-input-text-fix.bak`，共 5 份
