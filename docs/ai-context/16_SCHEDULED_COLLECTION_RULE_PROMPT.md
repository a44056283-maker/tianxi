# 16 Scheduled Collection Rule Prompt

更新时间：2026-05-28

本文件是所有定时任务智能体必须继承的采集固化提示词。任何单项任务提示词都只能在本规则之上追加任务细节，不得删减这些门禁。

## 统一固化提示词

```text
【全定时任务采集固化提示词 BEGIN】
你执行的是联想智慧零售真实门店系统定时任务，不是演示、审计占位或脚本触发任务。目标只有一个：取得本轮真实证据 -> 写入 SQL/API 或受控快照 -> 刷新前端 -> 打开前端可见验收。只要缺任一环节，就不能写 real_completed。

每轮开始进入 /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit，读取 AGENTS.md、docs/ai-context/07_BROWSER_WORKFLOW.md、docs/ai-context/12_EXECUTION_CORE.md、docs/ai-context/13_SCHEDULED_TASK_SOPS.md；涉及子智能体时再读 docs/ai-context/15_SUBAGENT_EXECUTION_PLAYBOOK.md。若发现本任务提示词与这些规则冲突，先按本文件和 AGENTS.md 执行，并把冲突写入报告。

CLI 与 Codex 定时任务分工固定：CLI/OpenClaw 只作为智店通实时触发和轻字段先到层，只可信订单号、商品粗字段、业务时间、数量、方向、操作员、渠道、门店和基础状态；SN、实付金额、进货价、供应商、库位、订单明细、教育补代扫、营销 PO/教育补证据、报价证据必须继续由原来的 30 个 Codex 定时采集任务按可见页面规则补链。任何任务不得因为 CLI 已发现订单就跳过 30 个任务中的补链、证据、SQL 写入和前端验收。

外部网页和登录态页面只使用用户当前已登录的默认 Chrome 可见会话。不得新开浏览器/Profile，不得打开空白浏览器，不得清理登录缓存，不得主动退出账号，不得用 Browser/in-app browser/browser-use/Playwright/Puppeteer/Chromium launch 打开外部采集页；这些工具只用于本地前端验证。

外部网页动作必须按状态机执行：扫描当前窗口和登录/加载/控件状态 -> 执行一个手工单步动作 -> 再扫描状态 -> 记录结果 -> 决定下一步。禁止连点、盲点、高频刷新、批量开详情页、DOM 自动扫描、旧 JSON/旧下载文件冒充本轮采集。只“打开了页面”“进入了公众号”“看到了列表”“脚本跑了”都不是完成。

来源入口固定：智店通只用 https://retail-pos.lenovo.com/ 当前会话；网页微信只用 https://localhost:3001/ 当前会话；灰渠公众号只从文件传输助手聊天记录区下面的固定公众号入口进入，进入公众号后必须点击页面最下面带日期的报价快捷入口，日期必须为当天或当前最新有效报价日期；分销报价从目标群聊或 Selkies 已落地的当天文件进入；京东/联想/天猫/保修页只从已登录 Chrome 当前会话低频打开。禁止旧入口、收藏夹入口、文章列表旧流程、公众号名称搜索、桌面微信或任何第三方执行器替代正式采集。

页面异常处理固定：登录失效、二维码、白屏、持续转圈、403、安全验证、滑块、验证码、错误弹层、非目标页或控件不稳定时，停止当前路径并保存阻塞证据。智店通转圈/白页必须先执行“等待确认 -> 刷新一次 -> 返回上一级重进 -> 重选当天日期查询”；若被动退出或跳回登录页，再按“打开登录页 -> 输入手机号 15637798222 -> 下一步 -> 点一次密码输入区域 -> 选择浏览器已保存密码候选 -> 确认登录”在同一 Chrome 会话恢复一次；遇短信验证码、二次认证、滑块或安全验证才 blocked_page_risk 并飞书提醒。

智店通出入库闭环固定：销售出库、采购入库、其他出库、调拨出库、调拨入库、库存流水、SN库存订单每页都选当天日期查询。教育补代扫改为独立手工窗口，每天两次（建议 12:00、19:00）分别扫描网页微信“智店通入库群”和“教育补贴群”并按群到达上次已采边界；非教育补代扫窗口的 45 分钟智店通轮次不再强制重复扫描两群。调拨出库/调拨入库必须采集进入库存、SN 和出入库流水闭环，但不计入营销 PO、教育补贴或价保申请范围。销售订单必须进入 订单 -> 线下门店订单，切到已完成，按当天 00:00-23:59:59 查询；读取总条数/页数，多页逐页核对，每页同时点“导出”和“导出明细”，形成成对 orderData/orderProductData。还必须导出当天库存流水、SN库存订单、商品库存统计、商品库存SN统计；同步前用库存流水/SN库存订单销售单号反查 orderData/orderProductData 覆盖率。缺销售金额源文件或调拨源文件时可同步已确认库存和 SN，但只能写 executed_not_closed。

教育补代扫图片固定：每天两次窗口内两个群都必须进入；每次点击前先确认页面状态可操作，且每个群至少执行两次“上翻到边界 -> 回到最新 -> 再上翻到边界”回扫。进入每个群后打开第一张相关图片，按左箭头或键盘左键逐张向历史方向核对，直到找到目标图片、箱码图、上传完成/核销成功卡以及上次已采照片边界。采到记录先落 education-agent-scan-YYYY-MM-DD-*.json，逐条写明 sourceGroupName、collectionSource；服务费规则为智店通入库群 50 元/台、教育补贴群 30 元/台，再写 SQL、刷新前端并检查教育补代扫汇总和出入库流水可见。任一群未到上次已采边界、只看到核销卡/上传卡/代扫文字但未找到对应箱码，不得收口。页面转圈超过 5 秒必须返回上一级重进，不得原地空转。同一群同一天只要已经有正式代扫记录，就绝不能再生成同日 `confirmedNoNewRecords`；同一群同一天只要还存在 `visible_not_closed / voucher_visible_not_closed / executed_not_closed / blocked_partial_visible_followup` 半成品文件，也绝不能再用 `confirmedNoNewRecords` 覆盖本轮窗口。正式记录、半成品文件、同日无新增确认三者只允许出现一种；若并存必须直接判 `executed_not_closed` 或 `blocked_page_risk`，继续补采，不能写 real_completed。

价格、链接、竞品和标题采集固定：必须点到目标规格、颜色、版本或配置后再判定同配；记录平台主标题、副标题/配置副标题、已选规格、商品编号、国补/券/活动拆分。主价取营销/教育/PO/国补前正常价；白色款单独复采。外部价格和标题只作为证据/价格信号写入 SQL，不直接改门店零售价或主标题。

所有采集结果统一走：证据/原始记录 -> SQL 持久化或受控 SQL 快照缓存 -> API/受控快照刷新 -> 前端 UI 可见验收。完成前必须打开真实前端 http://127.0.0.1:5174/ 或当前实际域名，进入对应子书签，确认本轮关键字段已经显示。

定时任务只允许更新自己负责的原始数据、证据链和派生快照。禁止借机改写 `latest-manual-price-overrides.json`、`product_price_adjustment`、`门店手动满减活动库` 或任何手动门店零售价规则；外部采价、群报价、公众号报价、竞品报价、智店通出入库同步都只能更新价格信号/证据，不得直接改门店零售价规则。

终态只允许 real_completed、executed_not_closed、blocked_missing_input、blocked_page_risk。缺当天原始输入、缺 SQL/API、缺前端 UI 验收、金额为 0/待补且源文件缺失、SN/代扫未闭环、或只动了页面没有采到证据时不能写 real_completed。每轮必须产出新增证据文件、同步报告或阻塞证据；没有新增产物必须写 execution_failed_noop。自动化恢复或重启后只处理当前时间窗任务，不批量补跑历史阻塞轮次。任务结束前恢复固定 5 页：WeChat Selkies、智店通、联想智慧零售系统、联想官网、京东；无法恢复也要写明原因。
公众号灰渠链路新增硬规则：如果已经到达公众号可见文章页，但正文没有可写入联想正式快照的条目，必须同时保存“最新可见文章日期”和“最后一次有效联想报价日期”；不得再把两者混成一个 quoteDate，也不得继续沿用旧的 missing-evidence 文件把最新可见文章覆盖掉。
【全定时任务采集固化提示词 END】
```

## 下发范围

- Codex 自动化定义：`../automation_payloads.json` 与 `~/.codex/automations/*/automation.toml`
- 定时任务控制台：`apps/api-server/app/scheduled_task_console.py`
- 半自动任务计划：`apps/inventory-sync/src/semiAuto/taskPlanner.ts`
- 长期规则文档：`docs/ai-context/07_BROWSER_WORKFLOW.md`、`docs/ai-context/12_EXECUTION_CORE.md`、`docs/ai-context/13_SCHEDULED_TASK_SOPS.md`
