from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app import product_library


APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parents[1]
ARTIFACT_DIR = PROJECT_ROOT / "apps" / "inventory-sync" / "artifacts"
GLOBAL_COLLECTION_RULE_PROMPT_PATH = PROJECT_ROOT / "docs" / "ai-context" / "16_SCHEDULED_COLLECTION_RULE_PROMPT.md"

SQL_PRIMARY_BOUNDARY_ITEMS = [
    "所有采集结果必须先写入 SQL 主链，再映射刷新前端；禁止绕过 SQL 直接改前端静态展示值",
    "自动化默认只允许刷新前端和快照，不允许自动改 product_master.canonical_name",
    "自动化默认不允许自动改门店零售价；门店零售价只能走显式 SQL 治理路径",
    "定时任务只允许更新自己负责的原始数据、证据链和派生快照；禁止改写 latest-manual-price-overrides.json、product_price_adjustment 或任何手动门店零售价规则",
    "OpenClaw API 仅作为实时触发和轻字段先到层：只可信订单号、型号、出库时间；SN、金额、活动、教育补必须由 Codex 采集链补全后再收口",
    "严禁把 OpenClaw 单源结果直接判定为业务闭环完成；必须通过 order_sync_registry / sync_gap_queue 审计",
]


def _extract_global_collection_rule_prompt() -> str:
    try:
        text = GLOBAL_COLLECTION_RULE_PROMPT_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
    start_marker = "```text"
    end_marker = "```"
    start = text.find(start_marker)
    if start < 0:
        return ""
    start += len(start_marker)
    end = text.find(end_marker, start)
    if end < 0:
        return ""
    prompt = text[start:end].strip()
    prompt = prompt.replace("【全定时任务采集固化提示词 BEGIN】", "").replace(
        "【全定时任务采集固化提示词 END】",
        "",
    )
    return prompt.strip()


def _compose_task_prompt(task_prompt: str) -> str:
    global_prompt = _extract_global_collection_rule_prompt()
    if not global_prompt:
        return task_prompt
    return (
        "【全定时任务采集固化提示词 BEGIN】\n"
        f"{global_prompt}\n"
        "【全定时任务采集固化提示词 END】\n\n"
        "【本任务追加规则】\n"
        f"{task_prompt}"
    )


TASK_DEFAULTS: dict[str, dict[str, Any]] = {
    "daily-price-channel-check": {
        "label": "分销商群报价同步",
        "category": "报价采集",
        "priority": 90,
        "requires_computer_use": True,
        "related_pipeline": "quote-master-sync",
        "default_prompt": "只采当天群内真实分销报价文件或当天有效截图；优先文件，其次截图；只处理库存大于0商品；两轮都没有当天文件时保持前一日有效值并标记未完成。所有采集结果只允许先写入 SQL 报价主链并刷新前端，不得直接改主标题、门店零售价或其它销售最终价。微信掉线、登录失效、白屏或文件下载入口异常时，立即记录 blocked_page_risk 并提醒用户在当前默认 Chrome 会话恢复登录或验证，禁止新开浏览器/Profile。",
        "workflow_summary": "11:30 首轮检查微信群文件/截图，13:45 补查；先落原始证据，再解析入 SQL 报价批次，再统一重建前端快照，不逐条直写前端。所有微信动作只允许在可见界面内手工完成。",
        "step_items": [
            "检查今天是否已有当日分销报价文件或截图",
            "优先下载原始 Excel；没有文件时保存原始截图",
            "只提取有库存商品的型号、配置、报价、日期、来源路径",
            "未匹配商品进入待人工复核，不强配 SKU",
            "批量写入分销报价快照并等待统一重建",
        ],
        "source_items": [
            "微信群当日报价文件",
            "微信群当日报价截图",
            "latest-distributor-quotes.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止脚本抓微信",
            "禁止把昨天文件写成今天已采",
            "禁止无证据写报价",
            "微信掉线或登录失效必须立即 blocked_page_risk",
        ],
        "time_windows": [
            {"label": "首轮", "window": "11:30-11:40"},
            {"label": "补查轮", "window": "13:45-13:55"},
        ],
    },
    "daily-gray-channel-check": {
        "label": "灰渠公众号报价同步",
        "category": "报价采集",
        "priority": 80,
        "requires_computer_use": True,
        "related_pipeline": "quote-master-sync",
        "default_prompt": "只采当天灰渠公众号原文、截图或已确认有效整理文本；固定从 Chrome 已登录 https://localhost:3001/ 网页微信 -> 文件传输助手聊天记录区 -> 聊天记录下面用户固定放置的公众号入口进入。进入公众号页只算入口到达，不算采集完成；必须点击公众号页面最下面带日期的报价快捷入口，日期必须为当天或当前最新有效报价日期；只认可该快捷入口打开后的报价页、当天截图或 OCR 证据，再写入 SQL 报价主链并刷新前端。文件传输助手点击后如果中央内容区空白、加载态、白屏、回到登录页、公众号正文没出现、或根本没看到最下面带日期的报价快捷入口，必须先在当前会话内刷新一次并返回上一级重进一次；仍未到达该日期入口时，直接记录 blocked_page_risk，禁止把这种失败写成“只缺当天原文”。没有当天原文时只能 carry forward，不得写成今日新采完成。不得直接改主标题、门店零售价或其它销售最终价。微信掉线、公众号页回到登录页、白屏或文章打不开时，立即记录 blocked_page_risk 并提醒用户在当前默认 Chrome 会话处理，禁止新开浏览器/Profile。",
        "workflow_summary": "11:50 查一次，13:50 补查一次；先从文件传输助手固定公众号入口进入，再点公众号页最下面带日期的报价快捷入口并保存当天原文证据，再解析结构化报价并入 SQL；如无新原文，沿用旧值但任务状态保持 blocked_missing_input。若入口空白、公众号正文未出现、或未能到达底部日期快捷入口，则按 blocked_page_risk 收口，不允许只写“缺原文”。公众号动作只允许在微信可见界面内手工完成。",
        "step_items": [
            "打开 Chrome 已登录 https://localhost:3001/ 网页微信",
            "进入文件传输助手聊天记录区下面用户固定放置的公众号入口",
            "如果文件传输助手点击后中央内容区空白/加载态，必须在当前会话刷新一次并返回上一级重进一次，仍失败则 blocked_page_risk",
            "进入公众号后点击页面最下面带日期的报价快捷入口，核对日期为当天或当前最新有效报价日期",
            "保存原文/截图路径到证据层",
            "解析有效报价并映射到库存商品",
            "没有当天原文则仅沿用上次有效值",
            "重建报价快照并保留 blocked 原因",
        ],
        "source_items": [
            "灰渠公众号当天原文",
            "gray-wholesale-YYYY-MM-DD.txt / .md",
            "latest-gray-wholesale-quotes.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止把旧灰渠价写成今日新价",
            "禁止缺原文时标记 real_completed",
            "禁止无证据补灰渠报价",
            "进入公众号页不等于完成采集，未点击最下面带日期报价快捷入口并保存当天原文/截图/OCR证据不得写 real_completed",
            "文件传输助手入口空白、公众号正文未出现、底部日期快捷入口未到达时，必须 blocked_page_risk，禁止降级成普通 missing_input",
            "禁止收藏夹/文章列表旧流程、公众号名称搜索、桌面微信或旧原文重跑冒充当天公众号采集",
            "微信掉线或公众号页失效必须立即 blocked_page_risk",
        ],
        "time_windows": [
            {"label": "首轮", "window": "11:50-12:05"},
            {"label": "补查轮", "window": "13:50-14:10"},
        ],
    },
    "daily-competitor-monitor-check": {
        "label": "竞品监控排行更新",
        "category": "竞品监控",
        "priority": 65,
        "requires_computer_use": True,
        "related_pipeline": "competitor-monitor-sync",
        "default_prompt": "每天 4:00 以后必须人工点击京东自营对应店铺页面逐条采集 THINK、华硕、惠普、华为四品牌笔记本竞品；禁止用全站排行页或旧 JSON 冒充当天更新。竞品采集结果只允许进入 SQL/快照证据链并刷新前端，不得自动改本店主标题或门店零售价。京东账号掉线、详情页要求重新登录、验证码、403 或商品已下架时，必须按真实状态记录 blocked 或失效，不得硬写价格。",
        "workflow_summary": "先用可见浏览器人工进入对应京东自营店铺页面，逐条点开商品详情核配置、活动、教育补贴、国补前后价，再落当天 JSON/SQL 证据链并重建竞品监控快照。",
        "step_items": [
            "人工打开 THINK、华硕、惠普、华为对应京东自营店铺页面",
            "逐条点击候选商品详情页，核配置、活动、教育补贴、国补前后价和详情链接",
            "当天整理 competitor-monitor-YYYY-MM-DD.json 或 competitor-jd-top10-YYYY-MM-DD.json",
            "只接收京东自营对应店铺来源条目，拒绝全站排行页条目",
            "THINK 额外计算灰渠批发价和留客国补价",
            "写出 latest-competitor-monitor.json 并刷新前端快照",
        ],
        "source_items": [
            "京东自营对应店铺可见详情页",
            "competitor-monitor-YYYY-MM-DD.json",
            "competitor-jd-top10-YYYY-MM-DD.json",
            "latest-competitor-monitor.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止全站排行页直接入库",
            "禁止不点详情页就写配置和价格",
            "禁止无原始排行文件时伪造今日更新",
            "禁止把评论量写成真实销量，除非页面明确给出销量",
            "禁止用旧快照覆盖当天真实手工排行结果",
            "登录失效、403、验证码、商品下架必须按 blocked 或失效处理",
        ],
        "time_windows": [{"label": "固定轮次", "window": "04:00 后首轮，后续沿链接仓库补采"}],
    },
    "daily-jd-lenovo-price-sync": {
        "label": "京东联想零售价复核",
        "category": "零售价复核",
        "priority": 70,
        "requires_computer_use": True,
        "related_pipeline": "quote-master-sync",
        "default_prompt": "只能使用 Chrome 现有稳定会话，对库存大于0且仍需展示的 SKU 做真实人工复核。优先沿已锁定详情页更新；京东指定链接失效时转京东全站补新的真实详情页；联想官旗下架或失效时，旧官旗链接和旧价立即失效，再转天猫或淘宝在售页补替换链接和价格。搜索只允许 型号 -> 型号+配置 -> 型号+配置+颜色。采集得到的平台标题、副标题、配置、价格、活动只允许作为 SQL 证据和价格信号写入，再刷新前端；不得由自动化直接改 product_master.canonical_name 或门店零售价。Chrome 登录失效、403、验证码或安全验证时，必须立即 blocked_page_risk 并提醒用户在当前默认 Chrome 会话恢复登录或验证，禁止新开浏览器/Profile。",
        "workflow_summary": "北京时间 10:00-22:00 轮扫已锁定详情页；先复核已锁定链接，再处理失效链接补链；所有结果先批量归集到 SQL 证据链，再统一重建链接锁、标准价主表和零售区，不做单条即时同步。",
        "step_items": [
            "读取 latest-semi-auto-execution-plan.json",
            "优先复核 retailPriceVerification 队列，再处理 retailLinkBackfill 队列",
            "先打开已锁定详情页，核对标题、配置、主价、优惠说明",
            "京东指定详情页失效时，转京东全站补新的真实详情页",
            "联想官旗下架或失效时，转天猫联想官方旗舰店、来酷智生活旗舰店，再不行转淘宝",
            "找到新的有效在售详情页后，再更新链接锁和价格",
            "批量写入 manual-price-supplements 批次并统一重建",
        ],
        "source_items": [
            "latest-product-url-locks.json",
            "latest-semi-auto-execution-plan.json",
            "manual-price-supplements-YYYYMMDD-*.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止脚本、无头浏览器、新开独立浏览器",
            "禁止 PN/MTM/物料号硬搜",
            "禁止官旗下架后继续沿用旧官旗价格",
            "禁止京东指定店失效后只留搜索入口不补详情页",
            "禁止自动把平台完整标题回写成 SQL 主标题",
            "禁止自动把平台采集价写成门店零售价",
            "遇到 403 / 验证码 / 登录异常立即 blocked_page_risk",
        ],
        "time_windows": [
            {"label": "主轮扫", "window": "10:00-22:00"},
            {"label": "补采", "window": "10:00-22:00 内按缺口继续"},
        ],
    },
    "sync-health-spot-check": {
        "label": "同步动作不定时抽检",
        "category": "同步抽检",
        "priority": 75,
        "requires_computer_use": False,
        "related_pipeline": "inventory-sync-health",
        "default_prompt": "本任务只做不定时同步动作抽检与必要的自动补同步，不做新的外部页面采集。执行时必须先同步 SQL 镜像与快照，再执行 scripts/sync_inventory_terminal_state.py，把 SQLite 主库、标准库存快照、零售英雄卡、广告机、收银端库存数量、可售数量和 SN 状态重新对齐。随后必须审计：1）SQL open gap；2）库存/SN 五层一致性；3）采购入库同日进货成本价、采购SN、分/元单位、金额异常；4）手动门店零售价规则文件是否被改写。抽检任务只允许修同步链与快照，不允许新建业务事实，不允许改 latest-manual-price-overrides.json、product_price_adjustment 或任何手动门店零售价规则。",
        "workflow_summary": "营业时段内不定时抽检同步链健康度；抽检本身允许触发自动补同步，但只要 SQL gap、库存/SN 不一致、采购入库待补或门店价规则被改写任一存在，本轮只能 executed_not_closed。",
        "step_items": [
            "同步 SQL 镜像与前端快照缓存",
            "执行 scripts/sync_inventory_terminal_state.py 重对齐库存终端状态",
            "审计 SQL open gap 与关键快照刷新结果",
            "审计库存数量、可售数量、SN 在主库与终端投影是否一致",
            "审计采购入库同日记录是否仍有进货成本价待补、采购SN待补、分/元单位异常或金额异常",
            "审计 latest-manual-price-overrides.json 是否被本轮改写",
        ],
        "source_items": [
            "latest-scheduled-sql-auto-sync-audit.json",
            "latest-purchase-inbound-gap-audit.json",
            "latest-standard-inventory-snapshot.json",
            "latest-retail-core-inventory-movements.json",
            "latest-retail-core-serial-items.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止把抽检任务写成真实外部采集完成",
            "禁止抽检任务改写门店手动零售价规则",
            "禁止绕过 SQL 主链直接修前端静态值",
            "库存/SN、采购成本价、采购SN 任一仍待补时只能 executed_not_closed",
        ],
        "time_windows": [{"label": "营业时段不定时抽检", "window": "10:00-22:00 约 35-75 分钟一次"}],
    },
    "zhidiantong-sync-cycle": {
        "label": "智店通统一同步轮次",
        "category": "智店通同步",
        "priority": 95,
        "requires_computer_use": True,
        "related_pipeline": "inventory-master-sync",
        "default_prompt": "唯一任务命令是 `bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle`。本任务先跑 CLI 主链：实时采集并同步入库/出库订单骨架字段（单号、型号/SKU主键、数量、方向、业务时间、操作员、渠道、门店、基础状态）；随后必须继续执行销售/采购明细补链，把销售实付金额、orderData/orderProductData 金额快照、订单行 SN、采购入库单号、供应商、进货价、采购 SN、serial_item 成本状态写回 SQLite / SQL 主链，再刷新前端。CLI 主链和明细补链之后，必须执行 `python3 scripts/sync_inventory_terminal_state.py`，强制把 SQLite 主库、标准库存快照、零售英雄卡、广告机、收银端的库存数量、可售数量和 SN 状态同步对齐，并输出终端审计结果。采购入库的进货成本价、金额、数量单位属于必采字段：如果上游写的是“分”，必须先归一成“元”；如果金额被异常数量放大，必须按修正后的数量与进货价重算后再写库；不得以“待补”“下一轮补”“只同步数量和SN”视为完成。采购入库主视图只允许保留正常 `CGR*` 采购单；`T* / TDR* / PURCHASEQ-* / openclaw.full_db.purchase_inbound / 库存流水导出导入 / 重复占位采购行` 这类历史镜像、占位导入或隔离数据，禁止再归入正常采购入库，必须落到其它订单或隔离层，不能污染正常进货单据流水。OpenClaw 仅用于实时触发与轻字段先到层。页面转圈/白页必须执行“等待确认 -> 刷新一次 -> 返回上一级重进 -> 重新筛当天日期查询”；智店通被动退出时在同一默认 Chrome 会话按既定登录恢复链处理。每轮完成后必须验证 SQL -> API/快照 -> 前端 UI 三段同步闭环；任一明细字段仍缺、sync_gap_queue 仍 open、同日采购入库仍显示待补、仍有分/元单位异常、仍有异常金额、库存/SN 终端同步脚本仍报 mismatch、或 `CGR/待商确认` 采购单仍落在 manual_adjustment，都只能 executed_not_closed。",
        "workflow_summary": "营业时段高频轮次：CLI 先把入库/出库主链打通到前端，随后必须把同日待补明细压到 0；不允许让前端长期保留同日待补。",
        "step_items": [
            "先检查 OpenClaw 自动对接是否 isFresh=true 且当日有销售订单记录，满足后才进入实时触发轮次",
            "将 OpenClaw 数据按字段分层合并：只允许订单号、型号、出库时间、数量进入触发层；SN、金额、活动、教育补进入补链队列",
            "进入智店通可见页面，同步当天采购入库、销售出库、其他出库、调拨出库、调拨入库主链字段",
            "任一智店通页面转圈/白页时，执行等待确认、刷新一次、返回上一级重进、重新选择当天日期并查询",
            "销售订单进入 订单 -> 线下门店订单，切到已完成，按当天 00:00-23:59:59 搜索，读取总条数/页数并同步主链",
            "运行 bash scripts/run_scheduled_task.sh zhidiantong-sync-cycle",
            "CLI 主链后必须继续执行销售/采购明细补链：销售实付金额/orderData/orderProductData/订单行 SN，采购入库供应商/进货价/状态/入库单号/采购SN/serial_item成本；其中进货成本价、金额、数量单位属于采购入库必采字段，必须逐单补齐并归一到元单位",
            "销售/采购明细补链后必须执行 python3 scripts/sync_inventory_terminal_state.py，把 SQLite 主库、标准库存快照、零售英雄卡、广告机、收银端库存/SN 统一同步并校验",
            "同步后必须读取 order_sync_registry / sync_gap_queue，把缺SN/缺金额/缺供应商/缺进货价订单写入待补明细队列，并确认 open 缺口是否下降",
            "复核销售单流水、出入库流水、库存数量、可售数量是否前端可见；采购入库任一行仍显示进货价待补、库存进货价待补、成本待补、SN待补、分/元单位异常或异常金额时不得收口",
            "凡是 source_ref / service_no 以 CGR 开头的采购单，即使 operate_type_name=待商确认，也必须按采购入库链处理，禁止继续停在 manual_adjustment；反过来，T* / TDR* / PURCHASEQ-* / openclaw.full_db.purchase_inbound / 库存流水导出导入 / 重复占位采购行 这类历史镜像和占位导入禁止继续归到正常采购入库主视图",
            "同日采购入库如果上游只给到 SN 没给到成本，必须单独写入采购成本源缺口清单并发出未收口提示；如果上游给的是分单位成本或异常金额，必须先纠正再同步前端，不得混成普通待补后静默通过",
        ],
        "source_items": [
            "智店通入库群当天图片证据",
            "教育补贴群当天图片证据",
            "当天 商品库存统计.xlsx",
            "当天 商品库存SN统计.xlsx",
            "销售/采购/其他出库/调拨出库/调拨入库导出或页面证据",
            "latest-scheduled-task-dashboard.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "只能使用用户当前已登录的默认 Chrome user 会话处理智店通和网页微信",
            "禁止打开新的浏览器、空白浏览器、新 Chrome Profile，禁止清理登录缓存或主动退出账号",
            "禁止使用 Browser/in-app browser/browser-use/Playwright/Puppeteer/Chromium launch 打开或推进智店通、网页微信采集页面",
            "禁止使用 browser/CDP/脚本推进智店通页内流程",
            "禁止只同步数量不同步 SN",
            "允许本任务仅同步主链数量与单据，不得伪造 SN/实付金额/进货价补齐结果",
            "禁止跳过调拨出库/调拨入库；调拨单据只进入库存、SN 和出入库流水闭环，不计入营销 PO、教育补贴或价保申请范围",
            "禁止把库位=销售库当作销售出库判定依据",
            "禁止只打开线下门店订单第一页就判断订单已采完",
            "禁止只点导出不点导出明细；orderData 与 orderProductData 必须成对",
            "禁止只看订单文件存在；必须用库存流水/SN库存订单销售单号反查覆盖率",
            "禁止把 OpenClaw 单源订单直接写成完整出库事实；字段缺失必须进入 sync_gap_queue 并等待 Codex 补全",
            "禁止 CLI 主链结束后不跑销售/采购明细补链就宣称销售实付金额、采购供应商、进货价、采购SN 已同步完整",
            "禁止沿用旧总表冒充当前轮次实时同步",
            "禁止页面转圈后直接判阻塞；必须先刷新一次、返回上一级重进、重新筛当天日期查询",
            "进入智店通入库群和教育补贴群后必须打开看到的第一张相关照片，用图片查看器左箭头或键盘左键逐张向历史图片方向查看",
            "禁止靠大滚动猜图，禁止随意左右来回试；必须查到目标图、对应箱码图、上传完成卡、核销成功卡和最后一次已采集代扫教育补照片边界",
            "禁止任一群未到最后一次已采集代扫照片边界就写 confirmedNoNewRecords；未到边界只能 executed_not_closed",
            "禁止代扫记录缺 sourceGroupName 或 collectionSource；教育补贴群单机代扫服务费固定 30 元/台。",
            "禁止同一天同时存在正式代扫记录和 no-new-confirmed/无新增确认；一旦并存，视为提前收口失败，必须继续扫到历史边界并补齐正式记录。",
            "智店通入库群从现在起只承担二件套/三件套/双屏套装采集与归类，不再计入单个产品教育补代扫；同销售订单多商品必须优先自动识别套装活动并把记录写入“二件套/三件套汇总”。",
            "禁止只看到代扫文字、上传完成卡或核销成功卡但没按左键历史方向找到对应箱码时写已收口",
            "禁止采集后不写 SQL 主链、不刷新前端、不检查教育补代扫汇总/出入库流水前端可见就写 real_completed",
            "禁止只用同日 education-agent-scan-*.json 是否存在判断代扫完成；必须同时检查 latest-education-agent-scan-sync-gap.json，昨天/今天只要仍有真实销售出库单挂在代扫缺口队列，就只能 executed_not_closed。",
            "教育补贴群代扫前端必须显式展示“已完成记录”和“待补缺口记录”；如果昨天有 6 个真实代扫但只正式落库 2 个，必须把剩余 4 个缺口单号/SN 挂在前端可见区，禁止静默吞掉后仍写 real_completed。",
            "禁止缺 orderData/orderProductData 时把销售实付金额写 0 或写成已收口",
            "智店通被动退出或跳回登录页时必须先在同一默认 Chrome 会话中按固定登录恢复链尝试一次",
            "短信验证码、二次认证、滑块、安全验证、403 或登录恢复失败才允许 blocked_page_risk",
        ],
        "time_windows": [{"label": "营业时段轮次", "window": "11:15-21:45 按 45 分钟节奏轮次触发"}],
    },
    "daily-stale-inventory-check": {
        "label": "陈旧库存审计",
        "category": "库存审计",
        "priority": 60,
        "requires_computer_use": False,
        "related_pipeline": "inventory-aging-audit",
        "default_prompt": "只读取 SQL、库存主快照和标准库存快照生成陈旧库存报告；不触发外部采集，不改前端标题和价格。若库存主快照缺失或当天入出库未收口，只能写 executed_not_closed。报告结果只允许回写 SQL/快照并刷新前端。",
        "workflow_summary": "按库存年龄、可售状态和 SN 完整性生成陈旧库存报告，作为经营提醒而不是实时采集任务。",
        "step_items": [
            "读取 latest-inventory-master-snapshot.json 和标准库存快照",
            "按库存年龄、在库 SN、可售数量生成陈旧库存结果",
            "输出 latest-stale-inventory-report.json 并同步前端看板",
        ],
        "source_items": [
            "latest-inventory-master-snapshot.json",
            "latest-standard-inventory-snapshot.json",
            "latest-retail-core-serial-items.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止采集外部网页",
            "禁止改门店零售价",
            "禁止把缺快照写成 real_completed",
        ],
        "time_windows": [{"label": "固定轮次", "window": "每日 01:00"}],
    },
    "gaokao-ai-knowledge-refresh": {
        "label": "高考 AI 知识库刷新",
        "category": "营销知识库",
        "priority": 58,
        "requires_computer_use": False,
        "related_pipeline": "gaokao-ai-knowledge",
        "default_prompt": "只读取本地高考活动知识种子、门店当前现货快照、营销活动快照和库存推荐话术日更快照，重建给高考活动客户 AI 顾问使用的客户安全知识库 JSON，同时输出后台完整知识库；禁止直接改门店零售价、主标题或客户留言数据。该任务目标是让高考活动客户 AI 每天自动吃到更新后的联想产品、售后、Win11 电脑使用技巧、专业选机知识和库存推荐话术。",
        "workflow_summary": "按固定轮次重建 latest-gaokao-ai-knowledge-base.json 与 admin 知识库，把门店活动、售后服务规则、Win11 电脑使用技巧、专业选机知识和库存推荐话术日更快照统一压成 AI 可直接引用的知识库。",
        "step_items": [
            "读取高考活动知识种子文件",
            "读取 latest-retail-zone-snapshot.json 当前现货快照",
            "读取 latest-gaokao-daily-learning.json 每日学习与库存推荐话术快照",
            "输出 latest-gaokao-ai-knowledge-base.json 到 artifacts 与前端 public/data，并输出 admin 完整知识库到 artifacts",
        ],
        "source_items": [
            "docs/marketing/gaokao-ai-knowledge-seed.json",
            "latest-retail-zone-snapshot.json",
            "latest-gaokao-daily-learning.json",
            "latest-gaokao-ai-knowledge-base.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止采集客户隐私数据入知识库",
            "禁止把 AI 建议写成真实售后承诺",
            "禁止改门店零售价和主标题",
        ],
        "time_windows": [{"label": "固定轮次", "window": "每日 08:05 / 14:05 / 20:05"}],
    },
    "gaokao-daily-learning-refresh": {
        "label": "高考库存话术与每日学习刷新",
        "category": "营销知识库",
        "priority": 57,
        "requires_computer_use": False,
        "related_pipeline": "gaokao-daily-learning",
        "default_prompt": "只读取当前门店现货快照、近期销售快照和厂家重点路线规则，生成高考活动的库存推荐话术、电脑知识分享日更学习点和公开可讲的路线提示；禁止写客户隐私、禁止输出内部价格、禁止改门店零售价和主标题。",
        "workflow_summary": "每日生成 latest-gaokao-daily-learning.json，把 YOGA / 小新 / 拯救者 / AI PC 等路线的客户安全推荐话术、库存学习点和知识分享增量统一输出到 artifacts 与前端 public/data。",
        "step_items": [
            "读取 latest-retail-zone-snapshot.json 当前现货快照",
            "读取 latest-retail-core-sales-orders.json 近期销售快照",
            "生成库存推荐话术、每日学习条目和知识分享增量快照",
            "输出 latest-gaokao-daily-learning.json 到 artifacts 与前端 public/data",
        ],
        "source_items": [
            "latest-retail-zone-snapshot.json",
            "latest-retail-core-sales-orders.json",
            "latest-gaokao-daily-learning.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止把库存数量、内部价格、成本、毛利写进客户口径",
            "禁止写客户隐私数据",
            "禁止改门店零售价和主标题",
        ],
        "time_windows": [{"label": "固定轮次", "window": "每日 08:10"}],
    },
    "gaokao-major-guide-refresh": {
        "label": "高考电脑选购知识刷新",
        "category": "营销知识库",
        "priority": 56,
        "requires_computer_use": False,
        "related_pipeline": "gaokao-major-guides",
        "default_prompt": "只读取当前门店现货快照、既定专业选机规则和库存推荐话术日更快照，重建高考活动手机页“电脑选购知识分享”内容包；禁止写客户隐私，禁止生成价格承诺，禁止改门店零售价和主标题。目标是让客户每天看到按专业整理后的选机建议、Win11 电脑使用技巧、常见问题、库存推荐学习点和活动权益说明。",
        "workflow_summary": "每日生成 latest-gaokao-major-guides.json，把专业方向、宿舍场景、配置重点、Win11 电脑使用技巧、常见问题、库存推荐话术日更学习点、避坑点和可参加活动同步到手机页知识分享类目。",
        "step_items": [
            "读取 latest-retail-zone-snapshot.json 当前现货快照",
            "读取 latest-gaokao-daily-learning.json 每日学习与库存推荐话术快照",
            "按专业方向、场景、Win11 电脑使用技巧、库存推荐话术和现货品类生成知识分享条目",
            "输出 latest-gaokao-major-guides.json 到 artifacts 与前端 public/data",
        ],
        "source_items": [
            "latest-retail-zone-snapshot.json",
            "latest-gaokao-daily-learning.json",
            "latest-gaokao-major-guides.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止把价格写进客户知识分享正文",
            "禁止写客户隐私数据",
            "禁止改门店零售价和主标题",
        ],
        "time_windows": [{"label": "固定轮次", "window": "每日 08:15"}],
    },
    "daily-development-plan-update": {
        "label": "开发计划日更",
        "category": "项目计划",
        "priority": 55,
        "requires_computer_use": False,
        "related_pipeline": "development-plan-update",
        "default_prompt": "读取项目开发计划文档、代码目录和 git 状态，只记录当天真实发生的进展、风险和下一步；禁止虚构开发成果，禁止把计划写成已完成。该任务只更新文档和快照，不得改主标题和门店零售价。",
        "workflow_summary": "每天基于项目文档、代码变更和 git 状态更新开发计划，刷新更新时间、任务状态、风险与下一步。",
        "step_items": [
            "读取开发计划文档和当天代码变更",
            "核对 git status 与项目实际进展",
            "更新每日进展、风险和下一步，不虚构未发生内容",
        ],
        "source_items": [
            "联想智慧零售_开发计划_每日更新.md",
            "git status --short --branch",
            "docs/ai-context/01_CURRENT_STATE.md",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止虚构开发进展",
            "禁止把计划项直接写成已完成",
            "禁止忽略当天真实阻塞",
        ],
        "time_windows": [{"label": "固定轮次", "window": "每日 13:00"}],
    },
    "sn-warranty-backfill": {
        "label": "SN 保修补录",
        "category": "保修补齐",
        "priority": 30,
        "requires_computer_use": True,
        "related_pipeline": "full-daily-sync",
        "default_prompt": "只补前端当前仍不显示质保时间的 SN，以及当天新入库首次进入队列的 SN。已采成功或已确认 not_found 的 SN 视为已固化结果，不允许再次回退成待补，不允许用失败、验证码或空结果覆盖已存在的质保起止时间。优先后台低优先级运行，不阻塞库存、价格和出入库主链；遇验证码保持未收口。保修结果只允许写入 SQL/SN 主链再刷新前端，禁止借机改主标题和门店零售价。联想保修页登录失效、页面白屏或安全验证时，必须立即 blocked_page_risk 并提醒用户在当前默认 Chrome 会话恢复登录或验证，禁止新开浏览器/Profile。",
        "workflow_summary": "按待补队列只补“前端不显示质保时间”的缺口和新入库 SN；已采成功结果写入 SQLite 与本地快照双持久层，后续任务只扫缺口，不全量重采，不允许回退已有质保时间。",
        "step_items": [
            "读取 latest-warranty-check-queue.json",
            "只处理新入库且未采过的 SN，以及前端当前不显示质保时间的待补 SN",
            "采集官网保修结果并回写 SQLite/快照，已存在质保时间时只允许补强，不允许回退",
            "验证码/失败项保留队列，不伪造成功，也不覆盖已有成功质保时间",
            "更新前端保修展示摘要",
        ],
        "source_items": [
            "latest-warranty-check-queue.json",
            "latest-lenovo-warranty-snapshot.json",
            "retail-core.sqlite3.serial_item",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "保修补齐不阻塞库存主线",
            "禁止把验证码阻塞写成已完成",
            "禁止覆盖已确认保修字段",
            "登录失效、白屏或安全验证必须立即 blocked_page_risk",
        ],
        "time_windows": [{"label": "后台低优先", "window": "空闲时滚动执行"}],
    },
    "daily-audit-and-snapshot-rebuild": {
        "label": "明细补链与快照重建",
        "category": "明细补链",
        "priority": 60,
        "requires_computer_use": True,
        "related_pipeline": "full-daily-sync",
        "default_prompt": "本任务是 Codex 子智能体明细补链任务：专门补 CLI 无法实时完整采集的字段（商品名称、SKU编号、PN/MTM、规格、SN、销售实付金额、orderData/orderProductData 金额快照、入库单号、供应商、进货价、采购SN、serial_item成本、库位、状态）。补链来源仅限可见网页、PG/SQL 主链与可追溯证据；补齐后必须写 SQL 明细链、刷新前端、再回读 sync_gap_queue 是否下降。凡是同日仍显示待补的销售/采购行，都必须逐条说明来源缺失在哪一层，不允许以“下一轮再补”代替本轮结论。统一重建链接锁、采集计划、标准价格主表、零售价审计和零售区快照；把真实完成、未收口、阻塞状态写入报告，不用文案掩盖事实。不得自动改主标题和门店零售价。",
        "workflow_summary": "在 CLI 主链轮次后执行：先消费待补明细队列，再做 SQL/快照重建和前端刷新，实现“主链快、明细准”的双轨闭环；目标不是生成待补，而是清空同日待补。",
        "step_items": [
            "读取待补明细队列（缺SN/缺实付金额/缺进货价/缺供应商/缺采购SN/缺库位/缺状态）",
            "单独读取采购成本源缺口清单，把“有SN但无成本源”的采购单单列，禁止与普通缺SN混淆",
            "在已登录默认 Chrome 会话中手动采集明细证据并补齐 SQL",
            "将补齐结果回写 order_sync_registry / sync_gap_queue",
            "重建 product-url-locks",
            "重建 collection plan",
            "重建 standard price master",
            "重建 retail price audit",
            "重建 retail zone 并写出报告",
        ],
        "source_items": [
            "待补明细队列（sync_gap_queue / order_sync_registry）",
            "orderData / orderProductData 金额证据",
            "网页微信教育补代扫证据",
            "latest-scheduled-task-dashboard.json",
            "latest-retail-price-audit.json",
            "latest-retail-zone-snapshot.json",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止把脚本成功等同于业务成功",
            "只能重建现有证据，不补造数据",
            "禁止新开浏览器或新 profile，必须复用当前已登录会话",
        ],
        "time_windows": [{"label": "补链收口轮", "window": "12:25 / 15:25 / 19:25 / 21:30"}],
    },
    "daily-sn-sales-compliance-refresh": {
        "label": "SN有效销量合规预警日更",
        "category": "合规校验",
        "priority": 58,
        "requires_computer_use": False,
        "related_pipeline": "full-daily-sync",
        "default_prompt": "本任务只刷新 SQL 已落库的 SN 有效销量合规快照：按销售订单、serial_item、inventory_movement、sync_gap_queue、活动 SQL 和价保历史生成 `latest-sn-sales-compliance-snapshot.json`，并同步到前端 `产品价保 -> 合规校验预警`。不得把外部有效销量页面、PO 激活、机码上报、csdc 实时状态伪装成 CLI 已采集；这些外部资格页当前只能保留 Codex 手动补证据提示。",
        "workflow_summary": "每天固定刷新一次 SQL 合规判断，把可自动判定的 SN 有效销量资格、链路缺口和待申领金额汇总到前端；外部页面实时资格仍走 Codex 手动任务。",
        "step_items": [
            "运行 bash scripts/run_scheduled_task.sh daily-sn-sales-compliance-refresh",
            "读取 sales_order / serial_item / inventory_movement / product_activity_current / manufacturer_manual_promotion / sales_price_protection_history",
            "生成 latest-sn-sales-compliance-snapshot.json 并同步 web/data",
            "在报告里明确区分 SQL 自动判断结果与需要 Codex 手动补的外部资格证据",
        ],
        "source_items": [
            "retail-core.sqlite3.sales_order",
            "retail-core.sqlite3.serial_item",
            "retail-core.sqlite3.inventory_movement",
            "retail-core.sqlite3.product_activity_current",
            "retail-core.sqlite3.manufacturer_manual_promotion",
            "retail-core.sqlite3.sales_price_protection_history",
        ],
        "boundary_items": SQL_PRIMARY_BOUNDARY_ITEMS + [
            "禁止把智店通有效销量页面实时判断伪装成 CLI 自动采集",
            "禁止把 PO激活 / 机码上报 / csdc 状态写成已实时接通",
            "允许自动刷新 SQL 已落库链路，但外部资格页缺口必须保留 Codex 手动复核提示",
        ],
        "time_windows": [{"label": "固定轮次", "window": "每日 09:15"}],
    },
}


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(text: str, default: Any) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return default


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def _dashboard_path() -> Path:
    return ARTIFACT_DIR / "latest-scheduled-task-dashboard.json"


def _watchdog_path() -> Path:
    return ARTIFACT_DIR / "latest-scheduled-task-watchdog.json"


def init_scheduled_task_console() -> None:
    product_library.init_product_library()
    with product_library.connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS scheduled_task_profile (
              task_name TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT '',
              priority INTEGER NOT NULL DEFAULT 0,
              requires_computer_use INTEGER NOT NULL DEFAULT 0,
              related_pipeline TEXT NOT NULL DEFAULT '',
              default_prompt TEXT NOT NULL DEFAULT '',
              current_prompt TEXT NOT NULL DEFAULT '',
              workflow_summary TEXT NOT NULL DEFAULT '',
              step_items_json TEXT NOT NULL DEFAULT '[]',
              source_items_json TEXT NOT NULL DEFAULT '[]',
              boundary_items_json TEXT NOT NULL DEFAULT '[]',
              time_windows_json TEXT NOT NULL DEFAULT '[]',
              operator_notes TEXT NOT NULL DEFAULT '',
              enabled INTEGER NOT NULL DEFAULT 1,
              updated_by TEXT NOT NULL DEFAULT 'system',
              updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS scheduled_task_change_log (
              id TEXT PRIMARY KEY,
              task_name TEXT NOT NULL,
              field_name TEXT NOT NULL,
              before_value TEXT NOT NULL DEFAULT '',
              after_value TEXT NOT NULL DEFAULT '',
              change_reason TEXT NOT NULL DEFAULT '',
              changed_by TEXT NOT NULL DEFAULT 'system',
              created_at TEXT NOT NULL
            );
            """
        )
    seed_default_task_profiles()


def seed_default_task_profiles() -> None:
    timestamp = product_library.now_iso()
    with product_library.connect() as conn:
        stale_names = [
            row["task_name"]
            for row in conn.execute("SELECT task_name FROM scheduled_task_profile").fetchall()
            if str(row["task_name"] or "") not in TASK_DEFAULTS
        ]
        if stale_names:
            conn.executemany(
                "DELETE FROM scheduled_task_profile WHERE task_name = ?",
                [(task_name,) for task_name in stale_names],
            )
        for task_name, item in TASK_DEFAULTS.items():
            effective_prompt = _compose_task_prompt(str(item["default_prompt"]))
            conn.execute(
                """
                INSERT INTO scheduled_task_profile
                (task_name, label, category, priority, requires_computer_use, related_pipeline,
                 default_prompt, current_prompt, workflow_summary, step_items_json,
                 source_items_json, boundary_items_json, time_windows_json, operator_notes,
                 enabled, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, 'system', ?)
                ON CONFLICT(task_name) DO UPDATE SET
                  label = excluded.label,
                  category = excluded.category,
                  priority = excluded.priority,
                  requires_computer_use = excluded.requires_computer_use,
                  related_pipeline = excluded.related_pipeline,
                  default_prompt = excluded.default_prompt,
                  current_prompt = excluded.default_prompt,
                  workflow_summary = excluded.workflow_summary,
                  step_items_json = excluded.step_items_json,
                  source_items_json = excluded.source_items_json,
                  boundary_items_json = excluded.boundary_items_json,
                  time_windows_json = excluded.time_windows_json
                """,
                (
                    task_name,
                    item["label"],
                    item["category"],
                    int(item["priority"]),
                    1 if item["requires_computer_use"] else 0,
                    item["related_pipeline"],
                    effective_prompt,
                    effective_prompt,
                    item["workflow_summary"],
                    _json_dumps(item["step_items"]),
                    _json_dumps(item["source_items"]),
                    _json_dumps(item["boundary_items"]),
                    _json_dumps(item["time_windows"]),
                    timestamp,
                ),
            )


def _load_dashboard_latest() -> dict[str, Any]:
    snapshot = _read_json(_dashboard_path(), {})
    latest = snapshot.get("latestByTask", {})
    return latest if isinstance(latest, dict) else {}


def _load_watchdog_checks() -> list[dict[str, Any]]:
    snapshot = _read_json(_watchdog_path(), {})
    checks = snapshot.get("checks", [])
    return [item for item in checks if isinstance(item, dict)]


def _watchdog_map() -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for item in _load_watchdog_checks():
        task_name = str(item.get("taskName") or "").strip()
        if not task_name:
            continue
        result.setdefault(task_name, []).append(item)
    return result


def _row_to_task_payload(row: dict[str, Any], latest_report: dict[str, Any] | None, watchdog_items: list[dict[str, Any]]) -> dict[str, Any]:
    current_prompt = row.get("current_prompt") or row.get("default_prompt") or ""
    return {
        "taskName": row["task_name"],
        "label": row["label"],
        "category": row["category"],
        "priority": int(row.get("priority") or 0),
        "requiresComputerUse": bool(row.get("requires_computer_use")),
        "relatedPipeline": row.get("related_pipeline") or "",
        "defaultPrompt": row.get("default_prompt") or "",
        "currentPrompt": current_prompt,
        "workflowSummary": row.get("workflow_summary") or "",
        "stepItems": _json_loads(row.get("step_items_json") or "[]", []),
        "sourceItems": _json_loads(row.get("source_items_json") or "[]", []),
        "boundaryItems": _json_loads(row.get("boundary_items_json") or "[]", []),
        "timeWindows": _json_loads(row.get("time_windows_json") or "[]", []),
        "operatorNotes": row.get("operator_notes") or "",
        "enabled": bool(row.get("enabled")),
        "updatedBy": row.get("updated_by") or "",
        "updatedAt": row.get("updated_at") or "",
        "latestReport": latest_report or {},
        "watchdogChecks": watchdog_items,
    }


def scheduled_task_console_overview() -> dict[str, Any]:
    init_scheduled_task_console()
    watchdog = _read_json(_watchdog_path(), {})
    summary = watchdog.get("summary", {}) if isinstance(watchdog, dict) else {}
    with product_library.connect() as conn:
        total = int(conn.execute("SELECT COUNT(*) AS count FROM scheduled_task_profile").fetchone()["count"])
        enabled = int(conn.execute("SELECT COUNT(*) AS count FROM scheduled_task_profile WHERE enabled = 1").fetchone()["count"])
        computer_use = int(conn.execute("SELECT COUNT(*) AS count FROM scheduled_task_profile WHERE requires_computer_use = 1").fetchone()["count"])
    return {
        "taskCount": total,
        "enabledTaskCount": enabled,
        "computerUseTaskCount": computer_use,
        "watchdogSummary": summary,
        "generatedAt": product_library.now_iso(),
    }


def list_scheduled_task_profiles() -> dict[str, Any]:
    init_scheduled_task_console()
    latest_by_task = _load_dashboard_latest()
    watchdog_by_task = _watchdog_map()
    with product_library.connect() as conn:
        rows = [dict(row) for row in conn.execute(
            """
            SELECT *
            FROM scheduled_task_profile
            ORDER BY priority DESC, task_name
            """
        ).fetchall()]
    items = [
        _row_to_task_payload(
            row,
            latest_by_task.get(row["task_name"]) if isinstance(latest_by_task.get(row["task_name"]), dict) else None,
            watchdog_by_task.get(row["task_name"], []),
        )
        for row in rows
    ]
    return {"items": items, "count": len(items)}


def get_scheduled_task_profile(task_name: str) -> dict[str, Any] | None:
    init_scheduled_task_console()
    latest_by_task = _load_dashboard_latest()
    watchdog_by_task = _watchdog_map()
    with product_library.connect() as conn:
        row = conn.execute(
            "SELECT * FROM scheduled_task_profile WHERE task_name = ?",
            (task_name,),
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    return _row_to_task_payload(
        item,
        latest_by_task.get(task_name) if isinstance(latest_by_task.get(task_name), dict) else None,
        watchdog_by_task.get(task_name, []),
    )


def update_scheduled_task_profile(
    task_name: str,
    updates: dict[str, Any],
    *,
    changed_by: str = "system",
    reason: str = "manual scheduled task console update",
) -> dict[str, Any] | None:
    init_scheduled_task_console()
    allowed_fields = {
        "label": "label",
        "category": "category",
        "priority": "priority",
        "requiresComputerUse": "requires_computer_use",
        "relatedPipeline": "related_pipeline",
        "defaultPrompt": "default_prompt",
        "currentPrompt": "current_prompt",
        "workflowSummary": "workflow_summary",
        "stepItems": "step_items_json",
        "sourceItems": "source_items_json",
        "boundaryItems": "boundary_items_json",
        "timeWindows": "time_windows_json",
        "operatorNotes": "operator_notes",
        "enabled": "enabled",
    }
    with product_library.connect() as conn:
        current = conn.execute(
            "SELECT * FROM scheduled_task_profile WHERE task_name = ?",
            (task_name,),
        ).fetchone()
        if not current:
            return None
        current_dict = dict(current)
        set_parts: list[str] = []
        params: list[Any] = []
        timestamp = product_library.now_iso()
        for input_key, column in allowed_fields.items():
            if input_key not in updates:
                continue
            value = updates[input_key]
            stored_value: Any
            if column.endswith("_json"):
                stored_value = _json_dumps(value if isinstance(value, list) else [])
            elif column in {"requires_computer_use", "enabled"}:
                stored_value = 1 if value else 0
            elif column == "priority":
                stored_value = int(value or 0)
            else:
                stored_value = str(value or "")
            before_value = current_dict.get(column)
            if before_value == stored_value:
                continue
            set_parts.append(f"{column} = ?")
            params.append(stored_value)
            log_id = product_library.stable_id("scheduled_task_change", task_name, column, timestamp)
            conn.execute(
                """
                INSERT OR REPLACE INTO scheduled_task_change_log
                (id, task_name, field_name, before_value, after_value, change_reason, changed_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    log_id,
                    task_name,
                    column,
                    "" if before_value is None else str(before_value),
                    str(stored_value),
                    reason,
                    changed_by,
                    timestamp,
                ),
            )
        if set_parts:
            set_parts.extend(["updated_by = ?", "updated_at = ?"])
            params.extend([changed_by, timestamp, task_name])
            conn.execute(
                f"UPDATE scheduled_task_profile SET {', '.join(set_parts)} WHERE task_name = ?",
                params,
            )
    return get_scheduled_task_profile(task_name)
