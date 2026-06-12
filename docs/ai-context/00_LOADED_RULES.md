# 本对话常驻规则集 — 产品零售价 / 促销价 / 主标题

> 用户要求：以后在这个对话里面执行产品零售价 / 促销价 / 主标题相关操作时，必须加载并遵守本文件。
> 加载时间：2026-06-08 11:50 (Asia/Shanghai)
> 来源（按主题排序）：`02_DECISIONS.md` / `12_EXECUTION_CORE.md` / `19_RETAIL_UI_RESTYLE_PLAYBOOK.md` / `01_CURRENT_STATE.md` / `priceEngine.ts` 实际实现

---

## A. 主标题规则

### A.1 客户可见主标题统一来源
- 收银端 / 广告机 / 零售英雄卡 / 彩页等所有客户可见端，**只允许**显示 `latest-published-product-projection.json` 下发的 `displayTitle / productName`。
- 智店通 SKU 名、PN/MTM、平台采集标题、标准价格主档旧 `productName` 只能作为**证据**或 `sourceProductName` 保留，**不允许**直接覆盖客户可见主标题。
- 自动化采价、智店通导入、库存导入**不得**直接改写 `product_master.canonical_name`；如发现主标题缺型号/配置，必须进入产品库主档修正链。

### A.2 主标题保护规则（拒绝模式）
拒绝以下内部标题进入客户可见端：
- `PHN MOTO ...`
- `Legion ... IRX/IAX/...`
- `Lecoo N...`
- `GeekPro-...`
- `R98945HX16G1T` 等紧凑配置串

### A.3 主力商品主标题强制要求：主标题 · 配置详参
- 主力商品范围：游戏笔记本 / 轻薄笔记本 / 平板电脑 / 手机 / 台式/一体机 / 显示器
- 配置详参信号：CPU / 内存 / 硬盘 / 显卡 / 屏幕尺寸+分辨率+刷新率 / 容量 / 颜色 / Wi-Fi / 版本
- 配件不强制 CPU/内存/硬盘，但必须归到正确配件类
- 不允许把配置参数直接糊在主标题里
- 不保留 `国家补贴 / 张凌赫同款 / 主流游戏 / 新品热卖 / 官方旗舰店 / 年会礼品` 等促销脏词

### A.4 标题生成优先级（缺主标题时）
1. 标准价主档 `displayTitle/productName`（广告机 `主标题 · 配置详参` 格式）
2. 已存在且非内部码的 `product_master.canonical_name`
3. 旧发布投影 / retail-zone 标题
4. 京东 / 联想官旗 / 天猫 `matchTitle`（仅缺失或内部码兜底）
5. 智店通原始 `sku.name`（仅最后兜底）

### A.5 主标题门禁
- 修改后必须跑 `python3 scripts/audit_terminal_title_consistency.py`（或 `cd apps/inventory-sync && npm run audit:terminal-titles`）
- `issueCount = 0` 才能写"所有终端标题一致"
- 同步到 4 个文件：`latest-retail-zone-snapshot.json` / `latest-standard-price-master.json` / `latest-standard-price-master-frontend-snapshot.json` / `latest-published-product-channel-audit.json`
- 标题三端 channelViews：`retailHero / cashier / adMachine` 必须一致

### A.6 平板 / 手机英雄卡标题额外约束
- 京东 / 官旗标题已含容量和颜色时，不再追加智店通短配置
- 京东 / 官旗标题缺少容量时，只允许追加一个最完整的配置片段
- 禁止把群报价标题、智店通名称、规格码全部串联到首页标题

### A.7 主标题系列名 / 主型号丢失保护
- 不再让 `联想酷睿Ultra笔记本电脑` / `联想笔记本电脑` 这类泛标题压过系列名更完整的候选
- 平板/手机主标题如果丢失主系列名，标记 `displayTitleDetail` 不通过审计

---

## B. 价格规则（统一发布主链）

### B.1 价格平台优先级（采集时）
1. 联想官网商城
2. 天猫联想官方旗舰店
3. 天猫来酷智生活旗舰店
4. 京东已锁定详情页
5. 京东店内搜索 / 全站搜索（仅作补链补价兜底，不进 confirmed）

### B.2 价格生成主链（已固化为发布商品投影）
`SQL事实层 -> published product projection -> 各前端渠道视图`
- 客户可见价格主源：`latest-published-product-projection.json` / `latest-published-product-projection-live.json`
- 覆盖范围：零售英雄卡 / 广告机 / 收银端 / 进销存销售端 / 零售区静态快照 / retail-zone API
- `latest-retail-zone-snapshot.json` 只作为展示承载和旧端 fallback，**不允许**再独立计算或保留旧平均价

### B.3 零售区主价生成顺序
1. 手工门店价（`product_price_adjustment` 路径）
2. 京东/官旗/天猫有效销售参考价
3. 分销进货价 / 库存进货价 / 灰渠参考价 / 订货平台价生成的锁定待复核价
4. 类目保底锁定待复核价
> 锁定待复核价必须标注风险，**不得**冒充当天平台采集价；审批级别保持老板审批

### B.4 价格字段统一规范
- 门店零售价：`storeRetailPrice -> recommendedPreSubsidyPrice`
- 活动后补前价：`adjustedPreSubsidyPrice`
- 最终到手价：`finalPrice -> fullServiceSubsidyPrice / regularChannelSubsidyPrice`
- 子项：`marketingPoAmount / educationDiscountAmount / storeManualPromotionAmount`
- 采集价字段必须结构化拆为 `preSubsidyPrice / couponAdjustedPrice / postSubsidyPrice`

### B.5 平台主价取国补前展示价
- 京东采集若直接可见满减 / 平台券 / 优惠券金额，则主价采信"页面价 - 平台券/满减"的券后国补前价
- 页面若直接展示已扣减后到手价，同时可见 `PLUS专享立减` 等文案，则主价直接采信该可见展示价
- 已按 `coupon_adjusted_price` 写成券后国补前价后，前端不再重复展示 `平台券 -xxx`
- 页面红字价 `3909.15` + 国补前价 `4599` + 国补减 `689.85` → 最终主价 `4599`
- 教育补、国补单独记录，**不直接覆盖主价**

### B.6 第三方店规则
- 无国补第三方店：采优惠前价作为采集价，最终匹配价统一按 `99` 元收尾（如 `6985 → 6999`）
- 有国补第三方店：主价采该国补前整数价，**不**套用 `99` 元收尾

### B.7 电脑门店基准价（2026-05-22 起）
- 电脑门店基准价优先取 `京东自营价 / 联想官旗价` 中的最低有效价
- 电脑缺一方平台价时用已有有效平台价
- 官旗缺失且已采到天猫/淘宝补充价时，可用天猫/淘宝价兜底
- 电脑门店售价 = 平台最低有效零售价 + 电脑加价逻辑 + 收尾为 `99`

### B.8 游戏笔记本门店零售价基准（2026-06-05 起）
- 联想官旗存在可用国补前主价时 → 强制以**联想官旗**为基准
- 联想官旗缺价/无货/不可用 → 京东国补前主价
- 京东也缺 → 淘宝/天猫补充或门店锁定待复核链
- 限游戏笔记本；轻薄本/小新/YOGA/Pro14/Pro16 等不得因标题出现"游戏/国家补贴"被误判
- 券后价 / 国补后价 / PO 后价**不得**写入主价或门店零售价基准

### B.9 配件门店零售价（2026-05-18 起）
- 配件加价口径：`0-99 +10 / 100-199 +20 / 200-299 +30 / 300-399 +40 / ...`
- `>1000` 配件零售价统一按 `99` 结尾；`<1000` 配件按 `9` 结尾
- 配件不允许套用电脑 / 平板主价规则

### B.10 国补商品门店价生成口径
- 当前以 `2026-05-22 门店售价基准价规则更新` 为准
- 标准国补公式：
  - 电脑类 `售价 < 10000`：`售价 * 0.85`
  - 电脑类 `售价 >= 10000`：`售价 - 1500`
  - 手机 / 平板：按标准国补比例与封顶规则
- `全量服务国补价` 简称固定为 `全量服务国补价`
- `防流失补贴价` 口径：
  - 平台防流失线 = `京东` 或 `天猫/淘宝` 较低的有效零售价 → `99` 结尾 → 国补
  - 批发防流失线 = `批发价 × 1.13` → `99` 结尾 → 国补
  - 两者取更低的可执行参考价

### B.11 价格主链固定公式（来自 `01_CURRENT_STATE.md` 18:00 节）
`storeRetailPrice - marketingPoAmount - educationDiscountAmount - storeManualPromotionAmount == adjustedPreSubsidyPrice`
- 数学审计 `mismatchCount = 0` 才能写"全终端价格一致"
- `audit_terminal_price_consistency.py` 必须 `mismatchCount = 0`

### B.12 价格显示口径
- 零售区卡片：京东/联想国补后价 / 全量服务国补价 / 防流失补贴价 → 两位小数
- 前端不展示 `5372.01` / `5071.54` 这类采集小数，统一按整数元显示
- 不直接使用京东/联想页面上混合了平台券 / 教育补 / 返豆后的"到手价"作为零售区国补后价

### B.13 价格门禁
- 修改后必须跑 `python3 scripts/audit_terminal_price_consistency.py`
- `mismatchCount = 0` 才能说"所有终端价格一致"
- 渠道一致性审计文件：`latest-published-product-channel-audit.json`

---

## C. 促销价 / 营销活动 / 教育补 / 价保规则

### C.1 三大主链统一口径
- 销售出库当天证据冻结：销售价保 / 营销 PO / 教育补 三类历史凭证**全部**按"出库当天证据"执行
- 只允许使用"销售出库当天"的实时快照或当天原始证据
- 一旦该销售记录已生成历史凭证，后续每日报价、营销活动、教育补活动更新，**不得**回刷这张历史卡片的金额 / 日期 / 来源文件 / 证据说明

### C.2 历史凭证显示规则
- 前端零售区可以"不显示"或"默认折叠"过期/历史数据
- 底层必须保存在 SQL 或 SQL 快照缓存里，保证后续可追溯、可审计、可回放
- 历史汇总页面展示的也是销售当天锁定结果，不是"今天重算后的结果"

### C.3 教育补代扫采集标准
- 主采集证据：智店通上报产品信息图 + 教育优惠券核销码图
- 不再以箱码图作为主采集门槛（2026-05-27 起降级为辅助规则）
- 套装命中后不得再回落单品代扫
- 归并规则：客户电话一致 / SN 一致 / 姓名一致 任一命中即同一订单
- 最小采集闭环：
  - 普通单扫：1 个产品信息 + 1 个核销码
  - 二件套：2 + 3
  - 三件套：3 + 4

### C.4 营销 / 教育补前端展示开关
- `frontend_activity_display_override` 主键口径改为 `activity_id + sku_key`（不再按 SKU 共用）
- 展示规则：某张卡两类活动内容都被关闭后，移到 `营销 / 教育补活动产品库 -> 关闭展示` 子书签
- 旧 SKU 级覆盖记录保留为 fallback，仅用于历史兼容

### C.5 营销 PO 价保 / 教育补 / 价保 跨表口径
- `产品价保 -> 交叉出库校验` 的 `priceDiff` 模式只表达进货成本补助
- 前端文案统一写成 `进货成本价 - 结算价`
- 销售出库后的营销 PO / 教育补贴 / 教育补代扫对账：必须逐日审计文件

### C.6 防呆补（出库当天 营销PO）
- 例：`Y900-13` 销售 PO 政策：有效期 `2026-05-18` 至 `2026-06-21`
- 规则源文件：`apps/inventory-sync/artifacts/manual/marketing-boost/sales-po-policy-y900-13-2026-05-18.json`
- 不进入 `实时零售报价` 英雄卡，不参与客户可见门店价 / 国补价 / 营销后价计算
- 只进入 `产品价保 -> 零售销售价保专区 / 历史营销教育活动出库记录`
- `latest-marketing-boost-snapshot.json.salesPoSettlementValidations` 作为结算价执行校验清单
- 历史凭证仍遵守"销售出库当天证据冻结"规则

---

## D. 渠道同步规则

### D.1 渠道一致性强约束
- 改完前端后必须打开真实页面看实际布局
- 每次价格规则 / 活动展示开关 / 采集写回 / 门店零售价更新后，必须跑 `audit_terminal_price_consistency.py`
- 改完主标题后必须跑 `audit_terminal_title_consistency.py`

### D.2 价格来源状态显示
- 零售区卡片顶部的京东/联想来源胶囊要能直接打开对应商品详情页
- 已有直达详情页 URL：京东来源显示 `已确认`，不再是 `待复核`
- 联想官网 `仅入口` 保留，但同样需要可点击直达详情页
- 搜索页/入口页没有锁定到 `item.lenovo.com.cn/product/...`：保持 `仅入口`，不得误写 `已确认`

### D.3 价格采集 URL 锁定
- 同一 SKU 同一来源只保留一个最优 URL 锁
- 用户直接给出的真实商品详情页链接允许作为优先锁定证据写回 URL 锁库
- 多型号混挂链接跳过
- 已采过且已确认的详情页不重复打开

---

## E. 实际执行门禁（项目内命令清单）

| 用途 | 命令 |
|---|---|
| 终端标题审计 | `cd apps/inventory-sync && npm run audit:terminal-titles` 或 `cd ../.. && python3 scripts/audit_terminal_title_consistency.py` |
| 终端价格审计 | `python3 scripts/audit_terminal_price_consistency.py` |
| 标题同步 | `cd apps/inventory-sync && npm run build:standard-price-master && npm run build:retail-zone` |
| 价格同步 | `cd apps/inventory-sync && npm run build:retail-zone` |
| 端到端自检 | `cd apps/inventory-sync && npm run build:snapshot && npm run build:retail-zone` |

---

## F. 本对话后续执行约束

1. **任何价格 / 标题修改后必须跑 E.1 / E.2 审计且 `mismatchCount = 0`** 才算完成
2. **修改门店零售价必须走 `product_price_adjustment` 等显式 SQL 治理路径**，不允许定时任务 / 半自动任务直接覆盖
3. **修改主标题必须走人工产品库治理路径**，不允许自动化覆盖 `product_master.canonical_name`
4. **采集标题 / 价格只允许作为证据或 `sourceProductName` 保留**，不允许直接覆盖客户可见端
5. **历史凭证按"销售出库当天"冻结**，新营销活动不得回刷历史卡片
6. **标题门禁**：拒绝 `PHN MOTO` / `Legion IRX/IAX` / `Lecoo N` / `GeekPro-` / `R98945HX16G1T` 等内部码
7. **价格门禁**：拒绝券后中间价 / 国补后红字价 / 平台券二次扣减冒充主价
8. **配件加价 + 99 结尾**：`0-99 +10`、`100-199 +20`...、`>1000` 按 `99` 结尾、`<1000` 按 `9` 结尾
9. **电脑国补公式**：`售价 < 10000` × 0.85 / `售价 >= 10000` - 1500
10. **游戏本基准**：联想官旗优先 → 京东 → 天猫/淘宝

---

## G. 入口文件清单（已加载且权威）

- `docs/ai-context/02_DECISIONS.md` — 价格/标题/促销/价保/营销全部决策源头
- `docs/ai-context/12_EXECUTION_CORE.md` — 颜色/规格/白色复采/36h 过期等采集细节
- `docs/ai-context/19_RETAIL_UI_RESTYLE_PLAYBOOK.md` — 零售 UI 整改风格（视觉/版式）
- `apps/inventory-sync/src/inventoryQuote/priceEngine.ts` — 价格计算实际实现
- `apps/inventory-sync/src/inventoryQuote/retailPriceAudit.ts` — 价格审计实际实现
- `scripts/audit_terminal_title_consistency.py` — 标题审计实际实现
- `scripts/audit_terminal_price_consistency.py` — 价格审计实际实现
