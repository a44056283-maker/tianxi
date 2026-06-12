import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { SemiAutoExecutionPlan, SemiAutoExecutionTask, SemiAutoExecutionTarget } from './types.js'

type LatestTaskReportIndex = Record<string, {
  taskName?: string
  executedAt?: string
  finishedAt?: string
  status?: string
  executionOutcome?: 'real_completed' | 'executed_not_closed' | 'blocked_missing_input' | 'blocked_page_risk'
  manualActionRequired?: boolean
  blockingReason?: string
  warnings?: string[]
  metrics?: Record<string, unknown>
}>

type CollectionPlanItem = {
  skuKey?: string
  pnMtm?: string
  productName?: string
  category?: string
  currentStock?: number
  retailUrlLocks?: Record<string, {
    status?: string
    url?: string
    price?: number
    matchTitle?: string
    evidenceNote?: string
  }>
}

type CollectionPlanRetailLock = NonNullable<CollectionPlanItem['retailUrlLocks']>[string]

type CollectionPlanSnapshot = {
  items?: CollectionPlanItem[]
}

type RetailPriceAuditItem = {
  skuKey?: string
  pnMtm?: string
  productName?: string
  category?: string
  currentStock?: number
  auditStatus?: string
  manualReviewRequired?: boolean
}

type RetailPriceAuditSnapshot = {
  priorityManualCaptureItems?: RetailPriceAuditItem[]
}

type RetailZoneDecisionItem = {
  skuKey?: string
  productName?: string
  category?: string
  currentStock?: number
  jdPrice?: number
  lenovoOfficialPrice?: number
  taobaoPrice?: number
}

type RetailZoneSnapshot = {
  decisions?: {
    items?: RetailZoneDecisionItem[]
  }
}

type InventoryMasterSnapshot = {
  rows?: Array<{
    skuKey?: string | number
    productName?: string
    category?: string
    currentStock?: number
    inStock?: boolean
    lifecycleStatus?: string
    stockAgeDays?: number
    inboundDate?: string
  }>
}

type NewStockMeta = {
  stockAgeDays?: number
  inboundDate?: string
}

type ActiveSkuSet = Set<string>

type GrayWholesaleSnapshot = {
  quoteDate?: string
  isCarriedForward?: boolean
}

type WarrantyQueueSnapshot = {
  total?: number
}

type ZhidiantongCaptureRecord = {
  documentNumber?: string
  items?: Array<{
    skuKey?: string | number
    pnMtm?: string
    productName?: string
    category?: string
    outboundQuantity?: number
    serialNumbers?: string[]
  }>
}

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webDataPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  return fs.readFile(filePath, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined)
}

async function writeFileAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, filePath)
}

function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isToday(value?: string) {
  return Boolean(value?.startsWith(todayDateString()))
}

function getRetailTargetPriority(target: SemiAutoExecutionTarget) {
  if (target.status === 'new_stock_first_capture' || target.status === 'new_stock_link_backfill' || target.status === 'new_stock_daily_scan') return 0
  if (target.displayBlocked) return 1
  if (target.status === 'pending_lock') return 2
  return 3
}

function sortTargetsByStock(targets: SemiAutoExecutionTarget[]) {
  return [...targets].sort((a, b) => (
    getRetailTargetPriority(a) - getRetailTargetPriority(b)
  ) || (Number(b.currentStock ?? 0) - Number(a.currentStock ?? 0)) || String(a.skuKey ?? '').localeCompare(String(b.skuKey ?? '')))
}

function hasDisplayPrice(item?: RetailZoneDecisionItem) {
  if (!item) return false
  return [item.jdPrice, item.lenovoOfficialPrice, item.taobaoPrice].some((value) => typeof value === 'number')
}

function isRetailDetailUrl(url?: string) {
  const value = String(url ?? '')
  return /^https?:\/\/item\.jd\.com\/\d+\.html/i.test(value)
    || /^https?:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(value)
    || /^https?:\/\/detail\.tmall\.com\/item\.htm/i.test(value)
    || /^https?:\/\/item\.taobao\.com\/item\.htm/i.test(value)
}

function hasAnyLockedRetailUrl(item?: CollectionPlanItem) {
  return Object.values(item?.retailUrlLocks ?? {}).some((lock) => lock?.status === 'locked' && isRetailDetailUrl(lock.url))
}

function hasAnyUsableRetailEvidence(item?: CollectionPlanItem) {
  return Object.values(item?.retailUrlLocks ?? {}).some((lock) => (
    (lock?.status === 'locked' || lock?.status === 'candidate')
    && isRetailDetailUrl(lock.url)
    && (lock.status === 'locked' || typeof lock.price === 'number')
  ))
}

function hasCandidateRetailEvidence(item?: CollectionPlanItem) {
  return Object.values(item?.retailUrlLocks ?? {}).some((lock) => (
    lock?.status === 'candidate'
    && isRetailDetailUrl(lock.url)
    && typeof lock.price === 'number'
  ))
}

function isTask1ComputerScope(item?: { category?: string; productName?: string }) {
  const text = `${item?.category ?? ''} ${item?.productName ?? ''}`
  if (/(配件|手机|平板|保护膜|钢化膜|保护夹|键盘|鼠标|耳机|音箱|显示器|打印机|智能生活)/.test(text)) return false
  return /(轻薄笔记本|游戏笔记本|商务台式|游戏主机|一体机|台式|主机|笔记本|GeekPro|天逸510S|Legion|Lecoo|小新)/i.test(text)
}

function isPrimaryDeviceRetailScope(item?: { category?: string; productName?: string }) {
  const text = `${item?.category ?? ''} ${item?.productName ?? ''}`
  if (/(配件|保护膜|钢化膜|保护夹|键盘|鼠标|耳机|音箱|显示器|打印机|智能生活|服务)/.test(text)) return false
  return isTask1ComputerScope(item)
    || /(平板电脑|小新平板|拯救者平板|平板|Pad|TAB|TB\d+|手机|moto|MOTO|Motorola|折叠屏)/i.test(text)
}

function needsReadableHeroTitle(item?: { category?: string; productName?: string }) {
  const text = `${item?.category ?? ''} ${item?.productName ?? ''}`.trim()
  if (!text) return true
  if (isTask1ComputerScope(item)) {
    return !/(Ultra|U\d|i[3579]|I[3579]|R[3579]|锐龙|酷睿|HX|H|G|GB|TB|RTX|50\d0|4060|4070|5060|5070|OLED|K|英寸|\d{2,})/i.test(text)
  }
  if (/(平板|Pad|TAB|TB\d+)/i.test(text)) {
    return !/(\d+\s*\+|\d+G|\d+GB|\d{3,4}G|TB\d+|Z[A-Z0-9]+|\d+\.\d|英寸|Pro|Plus)/i.test(text)
  }
  if (/(手机|moto|MOTO|Motorola|折叠屏)/i.test(text)) {
    return !/(moto|MOTO|Motorola|Razr|Edge|G\d+|\d+\s*\+|\d+G|\d+GB|折叠|Pro|Ultra)/i.test(text)
  }
  return false
}

function parseInboundDate(value?: string) {
  if (!value) return undefined
  const timestamp = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function buildNewStockPriorityMap(master?: InventoryMasterSnapshot) {
  const map = new Map<string, NewStockMeta>()
  const now = Date.now()
  for (const row of master?.rows ?? []) {
    const skuKey = String(row.skuKey ?? '')
    if (!skuKey) continue
    if (row.inStock === false || row.lifecycleStatus === 'sold') continue
    if (!isTask1ComputerScope(row)) continue

    const explicitAge = typeof row.stockAgeDays === 'number' ? row.stockAgeDays : undefined
    const inboundTimestamp = parseInboundDate(row.inboundDate)
    const inferredAge = inboundTimestamp ? Math.floor((now - inboundTimestamp) / 86_400_000) : undefined
    const stockAgeDays = explicitAge ?? inferredAge
    if (stockAgeDays === undefined || stockAgeDays < 0 || stockAgeDays > 30) continue

    const previous = map.get(skuKey)
    if (!previous || stockAgeDays < Number(previous.stockAgeDays ?? Number.POSITIVE_INFINITY)) {
      map.set(skuKey, {
        stockAgeDays,
        inboundDate: row.inboundDate,
      })
    }
  }
  return map
}

function formatNewStockReason(meta?: NewStockMeta) {
  if (!meta) return undefined
  return `新入库电脑 SKU，库龄 ${meta.stockAgeDays ?? '未知'} 天，30 天内每日优先扫描`
}

function buildActiveSkuSet(master?: InventoryMasterSnapshot): ActiveSkuSet {
  const set: ActiveSkuSet = new Set()
  for (const row of master?.rows ?? []) {
    const skuKey = String(row.skuKey ?? '')
    if (!skuKey) continue
    if (row.inStock === false || row.lifecycleStatus === 'sold') continue
    if (Number(row.currentStock ?? 0) <= 0) continue
    set.add(skuKey)
  }
  return set
}

function isSkuActiveInMaster(skuKey: string, activeSkuSet?: ActiveSkuSet) {
  if (!activeSkuSet || activeSkuSet.size === 0) return true
  return activeSkuSet.has(skuKey)
}

const PAGE_RISK_STOP_INSTRUCTIONS = [
  '只要出现登录失效、白页、持续转圈、403、验证码、滑块、安全验证或跳回登录页，必须先按对应站点恢复链执行，禁止盲点、高频刷新或直接跳过后续本地同步。',
  '完成规定恢复链后仍无法进入目标页，任务状态必须写 blocked_page_risk，并通过飞书群提醒用户在当前默认 Chrome 会话恢复登录或验证；禁止新开浏览器/Profile，不能什么也不干。',
]

const VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS = [
  '打开页面不等于完成采集；任何页面任务都必须先复核页面内容，再允许写入批次、SQL 或前端。',
  '页面内容复核最少包含：页面身份、标题或群名、目标规格/配置/颜色/版本、价格或金额区、活动或状态文案。',
  '只打开了链接、只看到了列表页、只看到了默认规格、没点到目标颜色/版本、或没有看到价格区，都不能判定完成。',
  '只要页面下方、规格区或切换区存在目标配置，必须点击切到目标配置后再读数据；不能把默认款或错配款写成目标结果。',
  '复核后必须留下结构化证据：标题/副标题、已选规格、商品编号/单号/SN、价格口径、截图或当轮原始文件路径。',
  '没有页面内容证据，只能写 executed_not_closed；错页、空页、跳页、风控页、安全页只能写 blocked_page_risk。',
]

const SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS = [
  '任务结束前必须完成三段闭环：写入 SQL 或受控快照 -> API/业务镜像返回新值 -> 前端对应页面可见最新值。',
  '只写本地文件、只写 SQL、只刷新快照、只看日志、或只看 API，都不能写 real_completed。',
  '前端可见复核必须记录访问 URL、进入的子书签，以及亲眼看到的关键字段（SKU/SN/单号/金额/价格/数量/状态）。',
]

const ZHIDIANTONG_RECOVERY_INSTRUCTIONS = [
  '智店通任一目标页持续转圈、白页或卡死时，不得直接结束：先等待最短必要时间确认不是瞬时加载，再刷新当前页一次。',
  '刷新后仍转圈或白页时，必须返回上一级功能入口重新进入该页面；重新进入后必须再次选择当天开始日期、当天结束日期，并重新点击查询。',
  '完成“等待确认 -> 刷新一次 -> 返回上一级重进 -> 重新筛当天日期查询”后仍无法进入业务页，才允许进入登录恢复链。',
  '登录恢复链固定为：关闭异常目标页 -> 回到首页重新点登录 -> 如要求手机号只输入 15637798222 -> 下一步 -> 点一次密码输入区域 -> 只选择浏览器已保存密码候选 -> 确认登录。',
  '如果智店通出现短信验证码、二次认证、滑块或安全验证，立即停止并通过飞书群提醒用户手动登录。',
  '智店通同步不能只导库存流水或 SN：当天销售出库还必须进入 订单 -> 线下门店订单，状态切已完成，下单时间设当天 00:00-23:59:59，搜索后读取总条数/页数，多页逐页核对，并每页同时导出 orderData 与 orderProductData；调拨出库/调拨入库也必须进入当天采集链，但只进入库存、SN 和出入库流水闭环，不计入营销 PO、教育补贴或价保申请范围。',
  'orderData/orderProductData 文件存在不等于订单采集完成；必须用当天库存流水和 SN库存订单里的销售单号反查覆盖率。缺销售金额源时允许同步库存/SN，但只能写 executed_not_closed，禁止把实付金额写 0 或写成已收口。',
]

const WEB_WECHAT_RECOVERY_INSTRUCTIONS = [
  '网页微信若出现登录失效、二维码、白页、文件入口异常或安全验证，立即 blocked_page_risk，并通过飞书群提醒用户在当前默认 Chrome 会话恢复登录或验证；禁止新开浏览器/Profile。',
]

function buildRetailFullCaptureNextAction(input: {
  jdStatus?: string
  lenovoStatus?: string
  taobaoStatus?: string
  manualReviewRequired?: boolean
  displayBlocked: boolean
  hasCandidateEvidence?: boolean
}) {
  if (input.hasCandidateEvidence) return '打开候选详情页并点击目标规格，固化同配链接和价格证据'
  if (input.jdStatus !== 'locked') return '先进入京东预设自营店/指定店店内检索，确无目标后再转京东全站'
  if (input.manualReviewRequired) return '先复核已锁定京东/官旗详情页当日价'
  if (input.lenovoStatus !== 'locked') return '补联想官旗详情页'
  if (input.taobaoStatus !== 'locked') return '补天猫/淘宝替代详情页'
  if (input.displayBlocked) return '价格已采到但前端未显示，先收显示链'
  return '继续按固定顺序复核'
}

function hasTerminalNoExactMatchEvidence(lock: CollectionPlanRetailLock | undefined) {
  const text = `${lock?.matchTitle ?? ''} ${lock?.evidenceNote ?? ''}`
  return /no_exact_match_after_spec_check|确无同配|无目标同配/i.test(text)
}

function hasHardUnavailableEvidence(lock: CollectionPlanRetailLock | undefined) {
  const text = `${lock?.matchTitle ?? ''} ${lock?.evidenceNote ?? ''}`
    .replace(/下架\/待发布\/无货价格不进入报价引擎。?/g, '')
    .replace(/商品不可销售，不作为报价参考。?/g, '')
  return /已下架|页面为已下架状态|商品已下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知|不可购买|停止销售|商品不存在/i.test(text)
}

function hasOriginalLinkSpecRecheckSignal(lock: CollectionPlanRetailLock | undefined) {
  if (!lock?.url) return false
  const text = `${lock.matchTitle ?? ''} ${lock.evidenceNote ?? ''}`
    .replace(/不能再?把?[^。；;]*无同配[^。；;]*/g, '')
    .replace(/禁止[^。；;]*无同配[^。；;]*/g, '')
    .replace(/不得[^。；;]*无同配[^。；;]*/g, '')
    .replace(/不能判定无同配/g, '')
  if (hasTerminalNoExactMatchEvidence(lock) || hasHardUnavailableEvidence(lock)) return false
  return lock.status === 'unavailable' || /无同配|未找到|错配|不写错配|不作为报价参考|待同配复核/i.test(text)
}

function buildRetailOriginalLinkSpecRecheckTask(
  collectionPlan?: CollectionPlanSnapshot,
  activeSkuSet?: ActiveSkuSet,
  report?: LatestTaskReportIndex[string],
): SemiAutoExecutionTask | undefined {
  const targets = sortTargetsByStock((collectionPlan?.items ?? []).flatMap((item) => {
    const skuKey = String(item.skuKey ?? '')
    const currentStock = Number(item.currentStock ?? 0)
    if (!skuKey || currentStock <= 0) return []
    if (!isSkuActiveInMaster(skuKey, activeSkuSet)) return []
    return Object.entries(item.retailUrlLocks ?? {})
      .filter(([, lock]) => hasOriginalLinkSpecRecheckSignal(lock))
      .map(([source, lock]) => ({
        skuKey,
        pnMtm: item.pnMtm,
        productName: item.productName,
        category: item.category,
        currentStock,
        source,
        url: lock.url,
        status: 'original_link_spec_recheck',
        note: [
          '旧记录曾被标为无同配/错配/不可用，但缺少目标规格点击选中态证据',
          lock.matchTitle || lock.evidenceNote,
        ].filter(Boolean).join('；'),
        nextAction: '先打开原链接，检查规格/颜色/套餐/参数/页面下方同系列配置；必须点击或切换到目标 SKU 规格并记录选中态和价格。只有反复确认原链接确无目标配置后，才允许转下一来源补替代链接。',
        sourceOrder: [source, 'jd_self', 'jd_all', 'lenovo_official', 'taobao_100b'],
        priorityReason: '纠正旧无同配死判，原链接复核优先于重新搜索',
      }))
  }))

  if (!targets.length) return undefined
  return {
    id: 'retail-original-link-spec-recheck',
    title: '原链接规格复核队列',
    category: 'retail_original_link_spec_recheck',
    requiresComputerUse: true,
    status: 'pending',
    executionOutcome: report?.executionOutcome ?? 'executed_not_closed',
    lastExecutedAt: report?.finishedAt,
    manualActionRequired: true,
    blockingReason: report?.blockingReason,
    reason: '旧记录不能因为写过无同配/错配就跳过；必须回原链接确认规格区、参数区和同系列配置是否存在目标配置与价格。',
    timeWindow: '价格复核任务前置；未清空本队列不得把相关 SKU 判定为无同配或重新搜索替代链接',
    inputs: [
      artifactPath('latest-collection-operation-plan.json'),
      artifactPath('latest-product-url-locks.json'),
    ],
    evidencePaths: targets.map((item) => item.url!).filter(Boolean),
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      ...VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS,
      '本队列优先级高于重新搜索补链。先打开原链接，不允许直接跳到搜索结果页。',
      '必须检查规格、颜色、套餐、版本、配置区、商品参数、详情页下方同系列配置入口。',
      '发现目标配置和价格时，写入手工批次并固化为 locked/captured；不得继续保留无同配。',
      '如果原链接只有错配默认款，但规格区可切到目标 SKU，也按目标 SKU 价格写回，并记录选中态证据。',
      '只有原链接反复确认没有目标配置，且记录了检查位置和失败原因，才允许转京东店内/京东全站/联想官旗/天猫淘宝寻找替代链接。',
      '未完成原链接复核的 SKU 只能是 executed_not_closed，不能写 real_completed。',
      ...SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS,
    ],
    targets,
  }
}

function buildRetailFullCaptureTask(
  collectionPlan?: CollectionPlanSnapshot,
  audit?: RetailPriceAuditSnapshot,
  retailZone?: RetailZoneSnapshot,
  newStockMap?: Map<string, NewStockMeta>,
  activeSkuSet?: ActiveSkuSet,
  report?: LatestTaskReportIndex[string],
): SemiAutoExecutionTask | undefined {
  const auditBySku = new Map((audit?.priorityManualCaptureItems ?? []).map((item) => [String(item.skuKey ?? ''), item]))
  const retailDecisionBySku = new Map((retailZone?.decisions?.items ?? []).map((item) => [String(item.skuKey ?? ''), item]))

  const targets = sortTargetsByStock((collectionPlan?.items ?? []).flatMap((item) => {
    const skuKey = String(item.skuKey ?? '')
    const currentStock = Number(item.currentStock ?? 0)
    if (!skuKey || currentStock <= 0) return []
    if (!isSkuActiveInMaster(skuKey, activeSkuSet)) return []
    if (!isTask1ComputerScope(item)) return []
    const jd = item.retailUrlLocks?.jd_self
    const lenovo = item.retailUrlLocks?.lenovo_official
    const taobao = item.retailUrlLocks?.taobao_100b
    const auditItem = auditBySku.get(skuKey)
    const retailDecision = retailDecisionBySku.get(skuKey)
    const displayBlocked = !hasDisplayPrice(retailDecision)
    const hasLockedLink = hasAnyLockedRetailUrl(item)
    const hasCandidateEvidence = hasCandidateRetailEvidence(item)
    const hasUsableEvidence = hasAnyUsableRetailEvidence(item)
    const newStockMeta = newStockMap?.get(skuKey)
    const isNewStockCapture = Boolean(newStockMeta) || displayBlocked || !hasUsableEvidence
    const reasons: string[] = []

    const newStockReason = formatNewStockReason(newStockMeta)
    if (newStockReason) reasons.push(newStockReason)
    if (!hasUsableEvidence) reasons.push('缺少可核价固定链接')
    else if (!hasLockedLink && hasCandidateEvidence) reasons.push('已有候选详情页和价格，待点击规格固化为同配链接')
    if (jd?.status === 'locked' && auditItem?.manualReviewRequired) reasons.push('复核已锁定京东页当日价')
    if (displayBlocked) reasons.push('前端仍空白')
    if (isNewStockCapture && !newStockReason) reasons.unshift('新品/新入库优先补价')

    if (!reasons.length) return []
    return [{
      skuKey,
      pnMtm: item.pnMtm,
      productName: item.productName,
      category: item.category,
      currentStock,
      source: [
        jd?.status === 'locked' ? 'jd_self' : undefined,
        lenovo?.status === 'locked' ? 'lenovo_official' : undefined,
        taobao?.status === 'locked' ? 'taobao_100b' : undefined,
      ].filter(Boolean).join('+') || (hasCandidateEvidence ? 'candidate_fixed_link' : 'missing_fixed_link'),
      status: isNewStockCapture ? 'new_stock_first_capture' : 'pending_full_capture',
      note: reasons.join('；'),
      nextAction: buildRetailFullCaptureNextAction({
        jdStatus: jd?.status,
        lenovoStatus: lenovo?.status,
        taobaoStatus: taobao?.status,
        manualReviewRequired: auditItem?.manualReviewRequired,
        displayBlocked,
        hasCandidateEvidence,
      }),
      sourceOrder: ['jd_lenovo_self', 'jd_tablet_self', 'jd_moto_self', 'jd_all', 'lenovo_official', 'taobao_100b'],
      displayBlocked,
      priorityReason: isNewStockCapture ? (newStockReason ?? '新品或新入库电脑 SKU 缺固定链接/前端价格，当日优先补齐') : undefined,
    }]
  }))

  if (!targets.length) return undefined
  return {
    id: 'retail-full-capture',
    title: '任务1电脑类轮抽实时采集主队列',
    category: 'retail_full_capture',
    requiresComputerUse: true,
    status: 'pending',
    executionOutcome: report?.executionOutcome ?? 'executed_not_closed',
    lastExecutedAt: report?.finishedAt,
    manualActionRequired: true,
    blockingReason: report?.blockingReason,
    reason: '任务1只轮抽主卖电脑 SKU；新品/新入库电脑 SKU 上市后 30 天内进入高频优先扫描池，超过 30 天后降级为普通轮抽。',
    timeWindow: '新品上市后 30 天内每日优先扫描；超过 30 天进入普通轮抽；常规每日至少 8 个电脑 SKU，48 小时完成电脑类全量更新时间闭环',
    inputs: [
      artifactPath('latest-collection-operation-plan.json'),
      artifactPath('latest-retail-price-audit.json'),
      artifactPath('latest-retail-zone-snapshot.json'),
    ],
    evidencePaths: [],
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      ...VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS,
      '这是任务1正式主队列，范围只包括库存大于0的笔记本、一体机、台式电脑、游戏台式机。',
      '新品上市或新入库电脑 SKU 一旦进入库存，上市后至少 30 天内每天进入优先扫描池；若前端缺价格或缺固定链接，必须当天优先补齐，不能等普通轮抽。',
      '入库同步一旦发现新增电脑 SKU，必须立即补京东和联想官旗真实详情页链接与实时零售价；没有固定详情页、没有可见零售价或前端仍空白，都不得标记完成。',
      '新品上市/入库超过 30 天后，自动降级为普通电脑类轮抽 SKU。',
      '配件、手机、平板、保护膜、保护夹等非电脑类商品不进入每日自动轮抽。',
      '已有固定链接时直接打开核价；只有链接失效、商品不匹配或价格口径明显失效时，才补新链接。',
      '采集过程中打开的京东、联想官旗、天猫/淘宝临时标签页，写入批次并截图/记录证据后必须关闭；只保留稳定入口页，避免 Chrome 缓存和内存堆积。',
      '补链顺序固定：京东预设自营店/指定店店内检索 -> 京东全站 -> 联想官旗商城首页店内检索 -> 天猫/淘宝。',
      '京东补链第一步必须进入预设自营店或用户指定店铺的店内搜索/分类页，不允许直接从京东全站搜索开始；只有店内无目标商品或配置不匹配并记录原因后，才允许转京东全站。',
      '新入库 2026 新品搜索词严禁带 2025 年份；除非商品标题或用户证据明确写有 2025，否则搜索词只用系列型号和核心配置，不主动添加年份。',
      '如果当前 Chrome 已停在错误的全站搜索结果页，必须先回到预设店铺入口或联想商城首页重新执行，不得把错误路径上的结果写入批次。',
      '每个命中商品必须逐项核对系列、CPU、内存、硬盘、显卡、尺寸/屏幕、颜色，不一致就作废继续采下一来源。',
      '当日必须至少复核 8 个电脑 SKU，全部电脑 SKU 必须每 48 小时完成一轮完整更新时间。',
      '不得拿旧价、旧链、旧快照冒充当天复核完成。',
      ...SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS,
    ],
    targets,
  }
}

function buildRetailPrimaryDeviceFullClosureTask(
  collectionPlan?: CollectionPlanSnapshot,
  retailZone?: RetailZoneSnapshot,
  activeSkuSet?: ActiveSkuSet,
  report?: LatestTaskReportIndex[string],
): SemiAutoExecutionTask | undefined {
  const retailDecisionBySku = new Map((retailZone?.decisions?.items ?? []).map((item) => [String(item.skuKey ?? ''), item]))
  const targets = sortTargetsByStock((collectionPlan?.items ?? []).flatMap((item) => {
    const skuKey = String(item.skuKey ?? '')
    const currentStock = Number(item.currentStock ?? 0)
    if (!skuKey || currentStock <= 0) return []
    if (!isSkuActiveInMaster(skuKey, activeSkuSet)) return []
    if (!isPrimaryDeviceRetailScope(item)) return []

    const retailDecision = retailDecisionBySku.get(skuKey)
    const lockedLinkReady = hasAnyLockedRetailUrl(item)
    const usableEvidenceReady = hasAnyUsableRetailEvidence(item)
    const candidateEvidenceReady = hasCandidateRetailEvidence(item)
    const displayPriceReady = hasDisplayPrice(retailDecision)
    const heroTitleReviewRequired = needsReadableHeroTitle({
      category: item.category ?? retailDecision?.category,
      productName: item.productName ?? retailDecision?.productName,
    })
    const status = !usableEvidenceReady || !displayPriceReady
      ? 'missing_link_or_price'
      : (!lockedLinkReady && candidateEvidenceReady ? 'candidate_link_spec_review' : (heroTitleReviewRequired ? 'hero_title_review_required' : 'verify_existing_link_price_title'))

    return [{
      skuKey,
      pnMtm: item.pnMtm,
      productName: item.productName,
      category: item.category,
      currentStock,
      source: 'jd_self+lenovo_official+taobao_100b',
      status,
      note: [
        !usableEvidenceReady ? '缺少可用详情页链接' : undefined,
        usableEvidenceReady && !lockedLinkReady && candidateEvidenceReady ? '已有候选详情页和价格，待点击规格固化' : undefined,
        !displayPriceReady ? '前端实时零售价仍缺失或空白' : undefined,
        heroTitleReviewRequired ? '英雄卡首位商品名称不够清楚，需用已核验详情页标题替换' : undefined,
        lockedLinkReady && displayPriceReady && !heroTitleReviewRequired ? '已有数据仍需今晚复核链接、配置和价格口径' : undefined,
      ].filter(Boolean).join('；'),
      nextAction: !usableEvidenceReady
        ? '按固定来源顺序补真实详情页链接和价格'
        : (!lockedLinkReady && candidateEvidenceReady
          ? '打开候选详情页并点击目标规格，固化同配链接和价格证据'
          : (!displayPriceReady ? '先核对已有详情页价格并修复前端显示链' : '复核标题、配置、价格是否与库存 SKU 一致')),
      sourceOrder: ['jd_self', 'jd_all', 'lenovo_official', 'taobao_100b'],
      displayBlocked: !displayPriceReady,
      priorityReason: !lockedLinkReady || !displayPriceReady || heroTitleReviewRequired
        ? '今晚全库存主设备补链补价收口'
        : undefined,
    }]
  }))

  if (!targets.length) return undefined
  return {
    id: 'retail-primary-device-full-closure',
    title: '今晚全库存笔记本平板手机补链补价收口',
    category: 'retail_primary_device_full_closure',
    requiresComputerUse: true,
    status: 'pending',
    executionOutcome: report?.executionOutcome ?? 'executed_not_closed',
    lastExecutedAt: report?.finishedAt,
    manualActionRequired: true,
    blockingReason: report?.blockingReason,
    reason: '用户要求今晚一次性核清所有库存笔记本、平板、手机的详情页链接、配置、价格和前端英雄卡首位标题。',
    timeWindow: '2026-05-21 夜间全量收口；未完成前不得写 real_completed',
    inputs: [
      artifactPath('latest-collection-operation-plan.json'),
      artifactPath('latest-retail-zone-snapshot.json'),
      artifactPath('latest-product-url-locks.json'),
    ],
    evidencePaths: [],
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      ...VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS,
      '今晚任务范围升级为所有库存大于0的主设备：笔记本、一体机、台式电脑、游戏台式机、平板、手机、MOTO；配件、保护膜、保护夹、键鼠、耳机、音箱、打印机、服务类不进入本轮。',
      '每个 SKU 必须核清三件事：真实详情页链接、与库存型号/配置一致的主零售价、前端英雄卡首位可读商品名称。',
      '京东/联想官旗/天猫淘宝页面的主标题、小字副标题/配置副标题、已选规格文案和商品编号都必须采集，但这些字段只作为标题证据和人工补采输入，不得在采集任务里直接改写 SQL canonical_name。',
      '前端英雄卡与零售区正式主标题只能由 SQL 产品主档同步；采价任务只能补证据、补链接、补价格，不能把平台主标题或副标题自动覆盖回主标题。',
      '如果发现当前 SQL 主标题缺少型号或核心配置，必须进入产品库人工修正队列，由后台主档显式修改；不要在定时任务或半自动提示词里临时拼接、覆盖或回写主标题。',
      '补链顺序固定：京东预设自营店/指定店店内检索（电脑优先联想京东自营；平板可扩展到京东平板自营/联想平板自营；手机/MOTO 可扩展到 MOTO 京东自营/官方自营） -> 京东全站 -> 联想官旗商城首页店内检索 -> 天猫/淘宝。联想官旗无商品、下架或失效时，必须继续补天猫/淘宝备用详情页。',
      '平板、手机、MOTO 缺口不得只停在 lenovo1.jd.com；联想京东自营无 exact match 时，必须继续进入京东平板自营、MOTO 手机自营或官方自营店铺做店内检索，仍无 exact match 再转京东全站。',
      '店铺目标只允许已登录可见 Chrome 手动进入、低频点击、逐项核对；禁止脚本、无头浏览器、批量扫描或高速点击。',
      '搜索必须先型号、再型号+少量核心配置、最后才型号+核心配置+颜色；禁止一开始把整串智店通名称硬搜到底。',
      '京东、联想、天猫、淘宝都要逐项核对系列、CPU/平台、内存、硬盘、显卡/容量、颜色和类目；配置不一致不得写回。',
      '价格口径固定为营销PO前、教育补前、国补前的正常零售价；页面只显示到手价时，必须按页面明示的国补/营销/教育补金额反推，依据不足就写阻塞，不得猜价。',
      '采集后必须统一写入批次文件，再统一重建 product-url-locks、collection-plan、retail-price-audit、retail-zone，并确认前端不再显示 -、待采集、待匹配或待审批。',
      '确实采不到链接或价格的 SKU，必须生成待人工补采表，表格至少包含 SKU、PN/MTM、智店通名称、品类、库存、已尝试来源、失败原因、建议人工搜索词、需要用户补的链接/价格字段。',
      '每核完一个临时商品详情页并记录证据后必须关闭该临时页，只保留稳定入口页，避免 Chrome 标签和缓存堆积。',
      '未完成全部库存笔记本/平板/手机核对、未生成待人工补采表、或前端仍有空白时，本任务只能写 executed_not_closed 或 blocked_page_risk，不能写 real_completed。',
      ...SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS,
    ],
    targets,
  }
}

function buildRetailPriceVerificationTask(
  collectionPlan?: CollectionPlanSnapshot,
  audit?: RetailPriceAuditSnapshot,
  newStockMap?: Map<string, NewStockMeta>,
  activeSkuSet?: ActiveSkuSet,
  report?: LatestTaskReportIndex[string],
): SemiAutoExecutionTask | undefined {
  const auditBySku = new Map((audit?.priorityManualCaptureItems ?? []).map((item) => [String(item.skuKey ?? ''), item]))
  const targets = sortTargetsByStock((collectionPlan?.items ?? []).flatMap((item) => {
    const skuKey = String(item.skuKey ?? '')
    if (!skuKey || Number(item.currentStock ?? 0) <= 0) return []
    if (!isSkuActiveInMaster(skuKey, activeSkuSet)) return []
    if (!isTask1ComputerScope(item)) return []
    const auditItem = auditBySku.get(skuKey)
    const newStockMeta = newStockMap?.get(skuKey)
    const newStockReason = formatNewStockReason(newStockMeta)
    return Object.entries(item.retailUrlLocks ?? {})
      .filter(([, lock]) => lock?.status === 'locked' && lock.url)
      .map(([source, lock]) => ({
        skuKey,
        pnMtm: item.pnMtm,
        productName: item.productName,
        category: item.category,
        currentStock: Number(item.currentStock ?? 0),
        source,
        url: lock.url,
        status: newStockMeta ? 'new_stock_daily_scan' : (auditItem?.auditStatus ?? 'unknown'),
        note: [
          newStockReason,
          lock.price !== undefined ? `现有快照价 ${lock.price}` : (lock.matchTitle || lock.evidenceNote || ''),
        ].filter(Boolean).join('；'),
        priorityReason: newStockReason,
      }))
  })).slice(0, 80)

  if (!targets.length) return undefined
  return {
    id: 'retail-price-verification',
    title: '已锁定零售链接实时价格复核',
    category: 'retail_price_verification',
    requiresComputerUse: true,
    status: 'pending',
    executionOutcome: report?.executionOutcome ?? 'executed_not_closed',
    lastExecutedAt: report?.finishedAt,
    manualActionRequired: true,
    blockingReason: report?.blockingReason,
    reason: '已有详情页链接的电脑 SKU 不应重新搜索，应直接打开固定链接核对今天实时价格、满减和平台券。',
    timeWindow: '00:00-23:00 电脑类轮抽；每日至少 8 个，48 小时全量闭环',
    inputs: [
      artifactPath('latest-collection-operation-plan.json'),
      artifactPath('latest-retail-price-audit.json'),
      artifactPath('latest-product-url-locks.json'),
    ],
    evidencePaths: targets.map((item) => item.url!).filter(Boolean),
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      '这是电脑类库存 SKU 的正式日采复核队列；配件、手机、平板不进入本队列。',
      '每天至少复核 8 个电脑 SKU，全部电脑 SKU 至少每 48 小时完成一轮完整更新时间。',
      '只能使用用户当前已经登录的默认 Chrome 稳定会话进行电脑操控手工采集；禁止重新打开新的浏览器、禁止新建 Chrome Profile、禁止清理登录缓存、禁止主动退出账号、禁止用无登录态的新窗口替代已有会话。',
      '只打开已锁定详情页，不重新搜索同型号。',
      '每个详情页核价完成并写入手工批次后，必须关闭本轮新开的商品详情标签页；不得把几十个临时标签留在 Chrome 里。',
      '京东和联想官旗页面只读取可见主价、平台券、满减、教育补、国家补贴说明。',
      '若页面主价本身已是正常零售价，则 PLUS/返豆只记说明，不继续扣减；页面已明确“已满减”时不再二次扣减。',
      '若价格变化，先归集到当轮手工批次文件，再统一重建锁库、collection plan、retail audit、retail zone；不要采一条同步一条。',
      '只要电脑类轮抽清单未完成，或有电脑 SKU 超过 48 小时未复核，就不得把任务1记为 real_completed。',
    ],
    targets,
  }
}

function buildRetailLinkBackfillTask(
  collectionPlan?: CollectionPlanSnapshot,
  retailZone?: RetailZoneSnapshot,
  newStockMap?: Map<string, NewStockMeta>,
  activeSkuSet?: ActiveSkuSet,
  report?: LatestTaskReportIndex[string],
): SemiAutoExecutionTask | undefined {
  const retailDecisionBySku = new Map((retailZone?.decisions?.items ?? []).map((item) => [String(item.skuKey ?? ''), item]))
  const targets = sortTargetsByStock((collectionPlan?.items ?? []).flatMap((item) => {
    const skuKey = String(item.skuKey ?? '')
    if (!skuKey || Number(item.currentStock ?? 0) <= 0) return []
    if (!isSkuActiveInMaster(skuKey, activeSkuSet)) return []
    if (!isTask1ComputerScope(item)) return []
    const locks = item.retailUrlLocks ?? {}
    const retailDecision = retailDecisionBySku.get(skuKey)
    const hasLockedLink = hasAnyLockedRetailUrl(item)
    const hasUsableEvidence = hasAnyUsableRetailEvidence(item)
    const displayBlocked = !hasDisplayPrice(retailDecision)
    const newStockMeta = newStockMap?.get(skuKey)
    if (hasUsableEvidence && !displayBlocked) return []
    const isNewStockBackfill = Boolean(newStockMeta) || !hasUsableEvidence || displayBlocked
    const newStockReason = formatNewStockReason(newStockMeta)
    const needsJd = locks.jd_self?.status !== 'locked' && !hasUsableEvidence
    const needsTmallFallback = !hasUsableEvidence && locks.lenovo_official?.status !== 'locked' && locks.taobao_100b?.status !== 'locked'
    const source = [
      needsJd ? 'jd_self' : undefined,
      needsTmallFallback ? 'taobao_100b' : undefined,
      displayBlocked ? 'display_price_closure' : undefined,
    ]
      .filter(Boolean)
      .join('+')
    return [{
      skuKey,
      pnMtm: item.pnMtm,
      productName: item.productName,
      category: item.category,
      currentStock: Number(item.currentStock ?? 0),
        source,
        status: isNewStockBackfill ? 'new_stock_link_backfill' : 'pending_lock',
        note: [
        newStockReason ?? (isNewStockBackfill ? '新品/新入库优先补链补价' : undefined),
        needsJd ? '缺少可核价固定链接，先补京东直达页' : undefined,
        needsTmallFallback ? '京东/官旗均无可用固定链接时，补天猫/淘宝兜底链路' : undefined,
        displayBlocked ? '已有采集链路但前端价格仍空白，先收显示链' : undefined,
      ].filter(Boolean).join('；'),
      priorityReason: newStockReason,
    }]
  })).slice(0, 60)

  if (!targets.length) return undefined
  return {
    id: 'retail-link-backfill',
    title: '缺失零售链接补链队列',
    category: 'retail_link_backfill',
    requiresComputerUse: true,
    status: 'pending',
    executionOutcome: report?.executionOutcome ?? 'executed_not_closed',
    lastExecutedAt: report?.finishedAt,
    manualActionRequired: true,
    blockingReason: report?.blockingReason,
    reason: '新品/新入库电脑 SKU 上市后 30 天内需要优先补可用详情页和实时价格，超过 30 天后降级为普通轮抽。',
    timeWindow: '新品上市后 30 天内每日优先；超过 30 天进入普通轮抽；常规价格核价完成后',
    inputs: [artifactPath('latest-collection-operation-plan.json')],
    evidencePaths: [],
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      ...VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS,
      '这是电脑类库存 SKU 的正式补链队列；配件、手机、平板不进入每日自动补链。',
      '新品上市或新入库电脑 SKU 上市后至少 30 天内每天进入优先补链补价池；只要缺固定链接或前端价格，必须排在普通轮抽前面补齐。',
      '入库同步后首次出现的电脑 SKU 必须第一时间补京东和联想官旗真实详情页链接与零售价；官旗无商品时必须继续补天猫/淘宝，不允许只给搜索页兜底。',
      '新品上市/入库超过 30 天后，自动降级为普通电脑类轮抽 SKU。',
      '禁止用 PN / MTM / 物料号搜索。',
      '按 型号 -> 型号+核心配置 -> 型号+核心配置+颜色 的顺序搜索；新入库 2026 新品严禁主动加入 2025 关键词。',
      '已有固定链接不得乱删；只有链接失效、商品不匹配或价格口径明显失效时才补新链接。',
      '先进入京东预设自营店/指定店做店内检索和分类筛选，再京东全站；电脑优先联想京东自营，平板可扩展到京东平板自营/联想平板自营，手机/MOTO 可扩展到 MOTO 京东自营/官方自营；禁止跳过店内检索直接全站搜。',
      '如果已经误进京东全站搜索结果，必须废弃该轮候选并返回预设自营店/指定店店内检索重来；不能把错误路径上的候选当作有效采集。',
      '联想官旗必须从 https://shop.lenovo.com.cn/ 首页进入商城搜索/系列配置选择；官旗无商品、下架或失效后，必须继续补天猫/淘宝。',
      '联想官旗无商品、下架或失效时，必须继续补天猫/淘宝在售详情页，不得在官旗断链后直接停掉。',
      '优先用户已给备址；已有有效详情页后再写锁库，不拿搜索页冒充详情页。',
      '补链时每核完一个商品详情页都要关闭临时商品页，只保留原来的已登录入口页和必要任务页。',
      ...SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS,
    ],
    targets,
  }
}

function buildGrayChannelTask(gray?: GrayWholesaleSnapshot, report?: LatestTaskReportIndex[string]): SemiAutoExecutionTask | undefined {
  if (gray?.quoteDate === todayDateString() && !gray.isCarriedForward) return undefined
  return {
    id: 'gray-channel-capture',
    title: '灰渠公众号当天原文采集',
    category: 'gray_channel_capture',
    requiresComputerUse: true,
    status: 'blocked',
    executionOutcome: report?.executionOutcome ?? 'blocked_missing_input',
    lastExecutedAt: report?.finishedAt,
    manualActionRequired: true,
    blockingReason: report?.blockingReason ?? `当前仅沿用 ${gray?.quoteDate ?? '旧日期'} 报价，今天没有新的公众号原文。`,
    reason: gray?.isCarriedForward ? `当前仅沿用 ${gray.quoteDate ?? '旧日期'} 报价，今天没有新的公众号原文。` : '未发现今天的灰渠公众号原文文件。',
    timeWindow: '11:50-13:50',
    inputs: [path.resolve(config.lenovoRetail.artifactDir, 'manual')],
    evidencePaths: [],
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      ...WEB_WECHAT_RECOVERY_INSTRUCTIONS,
      ...VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS,
      '固定使用 Chrome https://localhost:3001/ 网页微信，不打开微信桌面版，不搜索公众号。',
      '先进入网页微信文件传输助手聊天记录区，再定位到文件传输助手聊天记录下面用户固定放置的公众号入口。',
      '进入公众号页只算入口到达，不算采集完成；必须点击页面最下面带日期的报价快捷入口，日期必须为当天或当前最新有效报价日期。',
      '只认可该快捷入口打开后的报价页、当天截图或 OCR 证据；保存 raw 文本、截图或 OCR 证据后再运行同步任务。',
      '不得用桌面微信、公众号名称搜索、收藏夹/文章列表旧流程、本地旧原文重跑或后台脚本扫描来冒充当天公众号采集。',
      '有新原文则保存为 manual 文本文件并重跑 parse-gray-wholesale。',
      '没有新原文时允许沿用旧值，但日报必须写明 carry forward 原因。',
      ...SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS,
    ],
    targets: [],
  }
}

function buildDistributorTask(reports?: LatestTaskReportIndex): SemiAutoExecutionTask | undefined {
  const report = reports?.['daily-price-channel-check']
  if (report?.executionOutcome === 'real_completed' && isToday(report.finishedAt)) return undefined
  return {
    id: 'distributor-quote-capture',
    title: '分销商群报价当天文件核查',
    category: 'distributor_quote_capture',
    requiresComputerUse: true,
    status: 'blocked',
    executionOutcome: report?.executionOutcome ?? 'blocked_missing_input',
    lastExecutedAt: report?.finishedAt,
    manualActionRequired: true,
    blockingReason: report?.blockingReason ?? '当天分销报价文件未找到或日期不符合规则。',
    reason: '当天分销报价文件未在首次时段到位，需在 Chrome https://localhost:3001/ 网页微信群聊/文件入口或 Selkies 映射目录继续核查。',
    timeWindow: '11:55 / 13:45',
    inputs: [
      path.resolve(config.lenovoRetail.artifactDir, 'manual/wechat-quote-collection/current'),
      path.resolve(process.env.HOME ?? '', '.local/share/wechat-selkies/config/xwechat_files'),
      path.resolve(process.env.HOME ?? '', 'Downloads/codex-installs/wechat-selkies/config/xwechat_files'),
      config.lenovoRetail.downloadDir,
    ],
    evidencePaths: [],
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      ...WEB_WECHAT_RECOVERY_INSTRUCTIONS,
      ...VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS,
      '只接受当天日期的原始 Excel 文件；历史日期报价不采纳。',
      '必须通过 Chrome https://localhost:3001/ 网页微信手工进入群聊、文件入口、聊天记录或消费 Selkies 映射目录当天文件；不允许打开桌面版微信，不允许脚本抓取微信数据。',
      '如果有其它可见浏览器/电脑操控任务尚未结束，当前报价任务必须排队顺延，不能因为抢不到操作窗口就跳过当天扫描。',
      '文件到位后立即重跑 daily-price-channel-check。',
      ...SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS,
    ],
    targets: [],
  }
}

function buildZhidiantongSerialTask(capture?: { records?: ZhidiantongCaptureRecord[] }): SemiAutoExecutionTask | undefined {
  const record = (capture?.records ?? []).find((item) => item.documentNumber === 'KCM26051307728')
  if (!record) return undefined
  const targets = (record.items ?? [])
    .filter((item) => Number(item.outboundQuantity ?? 0) > 0 && (!item.serialNumbers || item.serialNumbers.length < Number(item.outboundQuantity ?? 0)))
    .map((item) => ({
      skuKey: String(item.skuKey ?? ''),
      pnMtm: item.pnMtm,
      productName: item.productName,
      category: item.category,
      quantity: Number(item.outboundQuantity ?? 0),
      status: 'serial_gap',
      note: `已补 ${item.serialNumbers?.length ?? 0}/${item.outboundQuantity ?? 0} 台序列号`,
    }))
  if (!targets.length) return undefined
  return {
    id: 'zhidiantong-other-outbound-serial-backfill',
    title: '智店通其它出库 SN 明细补齐',
    category: 'zhidiantong_serial_backfill',
    requiresComputerUse: true,
    status: 'pending',
    manualActionRequired: true,
    reason: 'KCM26051307728 仍有商品只同步了数量，未补齐 SN 明细。',
    timeWindow: '12:00 / 15:00 / 19:00 同步前后',
    inputs: [path.resolve(config.lenovoRetail.artifactDir, 'manual/zhidiantong-other-outbound-capture-2026-05-13.partial.json')],
    evidencePaths: [],
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      ...ZHIDIANTONG_RECOVERY_INSTRUCTIONS,
      ...VISIBLE_PAGE_CONTENT_REVIEW_INSTRUCTIONS,
      '旧的微信群逐图回扫流程已退役，不再把 https://localhost:3001/ 网页微信作为教育补代扫的前置门禁。',
      '教育补代扫改为以今日相机/水印相机上传照片为主采集源：当天有新增时，先生成 apps/inventory-sync/artifacts/manual/education-agent-scan/education-agent-scan-YYYY-MM-DD-*.json；每条记录必须写明 sourceType、sourceGroupName(当前仅作费率归类)、collectionSource、产品信息、SN、客户姓名、客户电话、代扫电话、券码、图片时间证据，以及 photoId / mediaUrl / takenAt 等原始来源字段。',
      '单个订单的归并规则固定为：只要“客户电话一致”或“SN一致”或“姓名一致”三者任一成立，即可认定为同一订单代扫。普通单扫至少要有 1 张产品信息图 + 1 张教育优惠券核销码图；二件套要有 2 个产品信息 + 3 个核销码；三件套要有 3 个产品信息 + 4 个核销码。普通单扫费率暂仍沿用“智店通口径 50 元/台、教育补口径 30 元/台”；两件套、三件套、拯救者双屏畅玩两件套必须额外通过“营销库 MTM 物料号 + 同一销售出库单号”匹配后才能归类，且套装代扫费只能按整单计算一次，不得与单品代扫费重复计算。只要命中三件套、二件套或双屏两件套，就绝不能再回落到单品代扫。',
      '当天确实无新增时，可生成同日 confirmedNoNewRecords，但 collectionSource 必须明确标记今日相机来源。教育补代扫记录写入后仍要同步 SQL 主链、刷新前端，并检查前端教育补代扫汇总/出入库流水同步可见。缺少当天记录本身不再阻断主销售同步；真正阻断条件保留为 SQL 缺口、前端缺口或已出库 SN 仍挂在代扫缺口队列。',
      '在智店通 其他出入库 打开 KCM26051307728。',
      '进入智店通销售出库、采购入库、其他出库、调拨出库、调拨入库或库存流水前，必须先把日期筛选设置为当天日期范围；不选日期不得判断当天无单。',
      '销售出库订单必须走 订单 -> 线下门店订单，状态切已完成，按当天 00:00-23:59:59 查询；读取总条数/页数，多页逐页核对，每页同时点“导出”和“导出明细”，形成成对 orderData/orderProductData。',
      '线下门店订单（orderData/orderProductData）是销售事实主证据；库存流水、SN库存订单、其他出库、调拨出入库只作为辅助校验与补齐，不得反向否决已成立的线下门店订单销售事实。',
      '采集后必须记录：页面总订单数、导出订单数、导出明细数、orderData 文件名、orderProductData 文件名、库存流水销售单号覆盖数、缺口单号。',
      '逐项点击 查看序列号，按数量补齐 serialNumbers。',
      '补齐后再重跑 zhidiantong-sync-cycle 和 daily-audit-and-snapshot-rebuild；完成后必须复核前端公开数据里的销售单流水、出入库流水、调拨出库/调拨入库、教育补代扫服务费、PO/教育补计算、库存数量、可售数量、SN 扣减和入库 SN；其中调拨单据只校验出入库/库存/SN，不进入 PO/教育补/价保计算，任一应更新项未更新只能写 executed_not_closed。',
      '若线下门店订单覆盖完整，必须先把主销售链写入 SQL 并刷新前端；辅助链仍有缺口时仅标注 executed_not_closed 持续补齐，不得阻断主销售同步。',
      ...SQL_AND_FRONTEND_CLOSURE_INSTRUCTIONS,
    ],
    targets,
  }
}

function buildWarrantyTask(warrantyQueue?: WarrantyQueueSnapshot): SemiAutoExecutionTask | undefined {
  const count = Number(warrantyQueue?.total ?? 0)
  if (count <= 0) return undefined
  return {
    id: 'warranty-backfill-queue',
    title: '联想保修缺口补齐',
    category: 'warranty_backfill',
    requiresComputerUse: false,
    status: 'pending',
    manualActionRequired: count > 0,
    reason: `当前仍有 ${count} 条保修待补。`,
    timeWindow: '12:20 / 15:20 / 19:20',
    inputs: [artifactPath('latest-warranty-check-queue.json')],
    evidencePaths: [],
    instructions: [
      ...PAGE_RISK_STOP_INSTRUCTIONS,
      '自动批量优先，失败条目保留待人工复核。',
      '不伪造保修起止时间。',
    ],
    targets: [{
      status: 'queued',
      note: `待补数量 ${count}`,
    }],
  }
}

export async function buildSemiAutoExecutionPlan(triggerTaskName?: string) {
  const [reports, collectionPlan, audit, gray, capture, warrantyQueue, retailZone, inventoryMaster] = await Promise.all([
    readJsonIfExists<LatestTaskReportIndex>(artifactPath('latest-scheduled-task-reports.json')),
    readJsonIfExists<CollectionPlanSnapshot>(artifactPath('latest-collection-operation-plan.json')),
    readJsonIfExists<RetailPriceAuditSnapshot>(artifactPath('latest-retail-price-audit.json')),
    readJsonIfExists<GrayWholesaleSnapshot>(artifactPath('latest-gray-wholesale-quotes.json')),
    readJsonIfExists<{ records?: ZhidiantongCaptureRecord[] }>(path.resolve(config.lenovoRetail.artifactDir, 'manual/zhidiantong-other-outbound-capture-2026-05-13.partial.json')),
    readJsonIfExists<WarrantyQueueSnapshot>(artifactPath('latest-warranty-check-queue.json')),
    readJsonIfExists<RetailZoneSnapshot>(artifactPath('latest-retail-zone-snapshot.json')),
    readJsonIfExists<InventoryMasterSnapshot>(artifactPath('latest-inventory-master-snapshot.json')),
  ])
  const newStockMap = buildNewStockPriorityMap(inventoryMaster)
  const activeSkuSet = buildActiveSkuSet(inventoryMaster)
  const retailDecisionBySku = new Map((retailZone?.decisions?.items ?? []).map((item) => [String(item.skuKey ?? ''), item]))
  const newStockImmediateClosureCount = (collectionPlan?.items ?? [])
    .filter((item) => isSkuActiveInMaster(String(item.skuKey ?? ''), activeSkuSet))
    .filter((item) => newStockMap.has(String(item.skuKey ?? '')))
    .filter((item) => Number(item.currentStock ?? 0) > 0)
    .filter((item) => !hasAnyUsableRetailEvidence(item) || !hasDisplayPrice(retailDecisionBySku.get(String(item.skuKey ?? ''))))
    .length

  const tasks = [
    buildRetailPrimaryDeviceFullClosureTask(collectionPlan, retailZone, activeSkuSet, reports?.['daily-jd-lenovo-price-sync']),
    buildRetailOriginalLinkSpecRecheckTask(collectionPlan, activeSkuSet, reports?.['daily-jd-lenovo-price-sync']),
    buildRetailFullCaptureTask(collectionPlan, audit, retailZone, newStockMap, activeSkuSet, reports?.['daily-jd-lenovo-price-sync']),
    buildRetailPriceVerificationTask(collectionPlan, audit, newStockMap, activeSkuSet, reports?.['daily-jd-lenovo-price-sync']),
    buildRetailLinkBackfillTask(collectionPlan, retailZone, newStockMap, activeSkuSet, reports?.['daily-jd-lenovo-price-sync']),
    buildDistributorTask(reports),
    buildGrayChannelTask(gray, reports?.['daily-gray-channel-check']),
    buildZhidiantongSerialTask(capture),
    buildWarrantyTask(warrantyQueue),
  ].filter(Boolean) as SemiAutoExecutionTask[]

  const plan: SemiAutoExecutionPlan = {
    generatedAt: new Date().toISOString(),
    triggerTaskName,
    summary: {
      pendingTaskCount: tasks.length,
      retailPrimaryDeviceFullClosureCount: tasks.find((item) => item.category === 'retail_primary_device_full_closure')?.targets.length ?? 0,
      retailOriginalLinkSpecRecheckCount: tasks.find((item) => item.category === 'retail_original_link_spec_recheck')?.targets.length ?? 0,
      retailFullCaptureCount: tasks.find((item) => item.category === 'retail_full_capture')?.targets.length ?? 0,
      retailPriceVerificationCount: tasks.find((item) => item.category === 'retail_price_verification')?.targets.length ?? 0,
      retailLinkBackfillCount: tasks.find((item) => item.category === 'retail_link_backfill')?.targets.length ?? 0,
      newStockPriorityCount: newStockMap.size,
      newStockImmediateClosureCount,
      frontendBlankPriceCount: (retailZone?.decisions?.items ?? [])
        .filter((item) => isSkuActiveInMaster(String(item.skuKey ?? ''), activeSkuSet))
        .filter((item) => Number(item.currentStock ?? 0) > 0)
        .filter(isTask1ComputerScope)
        .filter((item) => !hasDisplayPrice(item))
        .length,
      zhidiantongSerialGapCount: tasks.find((item) => item.category === 'zhidiantong_serial_backfill')?.targets.length ?? 0,
      grayChannelBlockedCount: tasks.filter((item) => item.category === 'gray_channel_capture').length,
      distributorBlockedCount: tasks.filter((item) => item.category === 'distributor_quote_capture').length,
      warrantyGapCount: Number(warrantyQueue?.total ?? 0),
    },
    tasks,
  }

  const artifact = artifactPath('latest-semi-auto-execution-plan.json')
  const web = webDataPath('latest-semi-auto-execution-plan.json')
  await Promise.all([
    writeFileAtomic(artifact, `${JSON.stringify(plan, null, 2)}\n`),
    writeFileAtomic(web, `${JSON.stringify(plan, null, 2)}\n`),
  ])

  return {
    plan,
    artifactPath: artifact,
    webPath: web,
  }
}
