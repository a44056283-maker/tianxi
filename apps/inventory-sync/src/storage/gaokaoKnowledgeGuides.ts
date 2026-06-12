import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

type RetailZoneItem = Record<string, unknown>
type RetailCoreSalesLine = {
  sku_key?: string
  mtm_code?: string
  product_name?: string
  quantity?: number
}

type RetailCoreSalesOrder = {
  lines?: RetailCoreSalesLine[]
}

type RetailCoreSalesOrdersSnapshot = {
  items?: RetailCoreSalesOrder[]
}

type GaokaoDailyLearningSnapshot = {
  tracks?: Array<{
    routeLabel?: string
    relatedMajors?: string[]
    keyHighlights?: string[]
    marketingActivities?: string[]
    recommendationScript?: string
    inventoryLearning?: string
  }>
  dailyLearnings?: Array<{
    title?: string
    tags?: string[]
    content?: string
  }>
}

type ProductSalesSignal = {
  orderCount: number
  quantity: number
}

type ParsedGuideProductSpecs = {
  memoryLabel: string
  storageLabel: string
  gpuLabel: string
  screenLabel: string
  refreshLabel: string
  isOled: boolean
}

export type GaokaoMajorGuideItem = {
  id: string
  sortNo: number
  badge: string
  title: string
  subtitle: string
  summary: string
  majorLabel: string
  majorKeywords: string[]
  scene: string
  campusScenes: string[]
  recommendedCategories: string[]
  keyPoints: string[]
  avoidPoints: string[]
  usageTips: string[]
  commonQuestions: string[]
  dailyTopics: string[]
  dailyLearningHighlights: string[]
  marketingActivities: string[]
  presetQuestions: Array<{
    id: string
    label: string
    question: string
    budget: string
    portability: string
    performanceNeed: string
    aiFocus: string
  }>
  featuredProducts: Array<{
    skuKey: string
    productName: string
    category: string
    fitSummary?: string
    marketingActivities: string[]
  }>
  updatedAt: string
}

export type GaokaoMajorGuidesSnapshot = {
  generatedAt: string
  summary: {
    guideCount: number
    featuredProductCount: number
  }
  items: GaokaoMajorGuideItem[]
}

type GuideTemplate = {
  id: string
  sortNo: number
  badge: string
  title: string
  subtitle: string
  summary: string
  majorLabel: string
  majorKeywords: string[]
  scene: string
  campusScenes: string[]
  recommendedCategories: string[]
  keyPoints: string[]
  avoidPoints: string[]
  usageTips: string[]
  commonQuestions: string[]
  dailyTopics: string[]
  presetQuestions: Array<{
    id: string
    label: string
    question: string
    budget: string
    portability: string
    performanceNeed: string
    aiFocus: string
  }>
}

const webDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')

const guideTemplates: GuideTemplate[] = [
  {
    id: 'computer-ai',
    sortNo: 1,
    badge: '计',
    title: '计算机 / 人工智能专业怎么选电脑',
    subtitle: '代码、多任务、本地 AI、四年使用周期一起看',
    summary: '重点看 CPU、内存、硬盘和接口，优先保证开发环境、多任务和长期扩展余量。',
    majorLabel: '计算机 / 人工智能 / 数据科学',
    majorKeywords: ['计算机', '人工智能', '数据', '代码', '开发'],
    scene: '宿舍写代码、课程实验、多标签资料整理、轻度本地 AI 工具',
    campusScenes: ['课程实验与开发环境并行', '宿舍长时间写代码', '图书馆查资料与做笔记'],
    recommendedCategories: ['轻薄笔记本', '游戏笔记本'],
    keyPoints: ['内存 16GB 起步，长期更建议 32GB', '硬盘优先 1TB，课程资料和开发环境更从容', '接口、散热、键盘手感比一时跑分更重要'],
    avoidPoints: ['只看短期低价忽略四年使用周期', '8GB 内存且不可扩展的机器', '接口太少、长时间编译容易发热掉频的机器'],
    usageTips: ['Win11 开启开发者模式前先确认系统更新和驱动完整', '课程常见工具尽量装在系统盘以外的资料盘', '本地 AI、容器和虚拟机并行时优先确认内存余量'],
    commonQuestions: ['大一写代码要不要直接 32GB 内存？', '轻薄本能不能兼顾 Python、Java 和轻度 AI 工具？', '课程里会不会很快遇到硬盘不够用的问题？'],
    dailyTopics: ['高考后第一台开发电脑怎么选', '16GB 和 32GB 到底差在哪', '本地 AI 入门电脑先看什么'],
    presetQuestions: [
      { id: 'code-portable', label: '上课通勤写代码', question: '我平时要带去教室和图书馆写代码，应该优先看什么配置？', budget: '7000-9000', portability: '轻一点，方便背着走', performanceNeed: '要兼顾编程 / 多任务', aiFocus: '先能稳定学习办公' },
      { id: 'ai-local', label: '想试本地 AI', question: '我想试试本地 AI 工具和开发环境，现货里哪类更合适？', budget: '9000 以上', portability: '均衡就行', performanceNeed: '性能优先 / 建模剪辑', aiFocus: '想试本地 AI / 代码工具' },
    ],
  },
  {
    id: 'design-media',
    sortNo: 2,
    badge: '设',
    title: '设计 / 传媒 / 建筑 / 工程专业配置建议',
    subtitle: '显卡、屏幕、内存和硬盘别配偏了',
    summary: '重点关注屏幕素质、显卡能力、内存容量和素材盘空间，避免只看 CPU。',
    majorLabel: '设计 / 传媒 / 建筑 / 工程',
    majorKeywords: ['设计', '传媒', '建筑', '工程', '剪辑', '建模'],
    scene: '修图、剪辑、建模、渲染、作品集整理和课堂演示',
    campusScenes: ['宿舍渲染与导出', '课堂演示和作品集整理', '外拍素材整理与多软件并行'],
    recommendedCategories: ['游戏笔记本', '轻薄笔记本'],
    keyPoints: ['优先确认屏幕分辨率、色域和亮度', '建模剪辑建议更看重显卡和散热', '素材量大时 1TB SSD 基本是下限'],
    avoidPoints: ['为了轻薄牺牲过多性能', '只看显卡型号忽略散热与功耗释放', '低色域屏幕做设计类课程'],
    usageTips: ['Win11 下创作类软件第一次安装后先校对色彩模式和缩放设置', '大型素材文件优先分项目管理，避免系统盘被缓存挤满', '剪辑、建模类软件更新前先确认插件兼容'],
    commonQuestions: ['设计专业先看屏幕还是先看显卡？', '剪辑和建模要不要直接上性能本？', '轻薄创作本能不能撑住四年课程？'],
    dailyTopics: ['设计专业电脑别只盯显卡', '建筑工程类学生买电脑先避这三个坑', '剪辑本和建模本到底差在哪'],
    presetQuestions: [
      { id: 'screen-color', label: '先看屏幕和稳定性', question: '我做设计和视频，应该先看屏幕还是显卡？', budget: '7000-9000', portability: '均衡就行', performanceNeed: '性能优先 / 建模剪辑', aiFocus: '想兼顾图片视频创作' },
      { id: 'render-power', label: '建模渲染方向', question: '我会做建模和渲染，门店现货里哪类更稳？', budget: '9000 以上', portability: '重量不是重点', performanceNeed: '性能优先 / 建模剪辑', aiFocus: '想兼顾图片视频创作' },
    ],
  },
  {
    id: 'ai-pc-study',
    sortNo: 3,
    badge: 'AI',
    title: 'AI PC 到底适合谁',
    subtitle: '学习、创作、整理资料和代码辅助的真实场景',
    summary: '如果日常会用到会议总结、资料整理、图片生成、代码辅助或本地 AI 工具，AI PC 的体验会更明显。',
    majorLabel: '学习 / 创作 / AI 工具使用者',
    majorKeywords: ['AI', '创作', '总结', '资料', '办公'],
    scene: '课堂记录、论文资料整理、图文创作、AI 工具体验',
    campusScenes: ['课堂资料整理和总结', '社团内容创作', '平时做图文和轻量视频'],
    recommendedCategories: ['轻薄笔记本', '平板电脑'],
    keyPoints: ['先看自己是否真的会长期用 AI 工具', '内存和硬盘会直接影响 AI 工具体验', '轻薄本更适合长期背着走，AI 能力不等于一定要最重的机器'],
    avoidPoints: ['把 AI PC 当成单一噱头购买', '只盯宣传词不看自己的真实使用频率', '忽略日常便携和课堂使用场景'],
    usageTips: ['AI 总结、检索和资料整理更依赖日常使用习惯，不是只看宣传词', 'Win11 Copilot 与本地工具并行时先分清在线和本地场景', '日常创作建议同步建立资料目录和云端备份习惯'],
    commonQuestions: ['AI PC 到底适合学习党还是创作党？', '只做资料整理有必要上性能很重的机器吗？', '本地 AI 和普通办公的差距主要体现在哪？'],
    dailyTopics: ['AI PC 到底适合谁', '资料整理党为什么也要看内存和硬盘', '学生买 AI PC 别被噱头带跑'],
    presetQuestions: [
      { id: 'ai-study', label: '学习整理资料', question: '我主要想用 AI 做资料整理和总结，适合什么方向？', budget: '5000-7000', portability: '轻一点，方便背着走', performanceNeed: '日常学习为主', aiFocus: '想试本地 AI / 代码工具' },
      { id: 'ai-create', label: '兼顾创作', question: '我还想用 AI 做图文创作，现货里哪类更均衡？', budget: '7000-9000', portability: '均衡就行', performanceNeed: '要兼顾编程 / 多任务', aiFocus: '想兼顾图片视频创作' },
    ],
  },
  {
    id: 'gaming-balance',
    sortNo: 4,
    badge: '玩',
    title: '游戏本和轻薄本怎么取舍',
    subtitle: '性能、重量、续航和专业软件要一起权衡',
    summary: '不是所有人都需要游戏本，也不是所有专业都只看轻薄；关键是看课程软件、宿舍移动频率和长期使用习惯。',
    majorLabel: '性能 / 便携取舍',
    majorKeywords: ['游戏', '轻薄', '性能', '续航', '宿舍'],
    scene: '宿舍娱乐、上课通勤、专业软件、多场景切换',
    campusScenes: ['宿舍游戏与作业两用', '上课通勤和宿舍来回切换', '剪辑建模和日常娱乐兼顾'],
    recommendedCategories: ['游戏笔记本', '轻薄笔记本'],
    keyPoints: ['常背着走就优先看重量和续航', '常做建模剪辑或打大型游戏就优先看显卡和散热', '真实场景比纸面参数更重要'],
    avoidPoints: ['只因别人推荐就盲目上游戏本', '只看重量忽略专业软件需求', '不去店里实际感受屏幕、重量和键盘'],
    usageTips: ['Win11 游戏本第一次到手先确认独显模式、散热模式和驱动状态', '如果主要是上课通勤，重量和充电器体积都要算进成本', '性能本建议单独规划资料盘，减少系统盘爆满风险'],
    commonQuestions: ['游戏本会不会太重，大学四年背不动？', '轻薄本能不能兼顾游戏和编程？', '建模、剪辑和游戏本到底是不是一类需求？'],
    dailyTopics: ['游戏本和轻薄本怎么取舍', '大学宿舍里最容易买错的电脑', '重量、续航、显卡哪个先排第一'],
    presetQuestions: [
      { id: 'gaming-budget', label: '按预算比较性能本', question: '我想玩游戏也要剪辑，门店现货里哪类性能本更适合？', budget: '7000-9000', portability: '重量不是重点', performanceNeed: '性能优先 / 建模剪辑', aiFocus: '先能稳定学习办公' },
      { id: 'balanced-campus', label: '兼顾课堂和娱乐', question: '我既要上课通勤也想打游戏，应该怎么平衡？', budget: '7000-9000', portability: '均衡就行', performanceNeed: '要兼顾编程 / 多任务', aiFocus: '先能稳定学习办公' },
    ],
  },
  {
    id: 'arts-business',
    sortNo: 5,
    badge: '文',
    title: '文科 / 经管 / 师范 / 法学电脑怎么选',
    subtitle: '稳定、轻便、续航和键盘体验优先',
    summary: '这类专业多数以文档、资料、表格、课堂演示和日常轻创作为主，优先看稳定、便携和续航。',
    majorLabel: '文科 / 经管 / 师范 / 法学',
    majorKeywords: ['文科', '经管', '师范', '法学', '日常学习'],
    scene: '课堂笔记、文档写作、表格处理、演示汇报',
    campusScenes: ['课堂记笔记和演示', '图书馆长时间查资料', '日常论文、表格和资料归档'],
    recommendedCategories: ['轻薄笔记本', '平板电脑'],
    keyPoints: ['轻薄和续航会比极致性能更重要', '键盘手感和屏幕观感直接影响日常体验', '如果要配平板，重点看跨设备资料同步'],
    avoidPoints: ['为了参数堆料买太重的机器', '忽略续航和充电便利性', '只看短期活动不看长期稳定性'],
    usageTips: ['Win11 新机先把 OneDrive、资料文件夹和常用办公软件整理好', '轻薄本更适合课堂和图书馆，但要同步确认键盘和屏幕舒适度', '如果要配平板，优先把资料同步和批注流程想清楚'],
    commonQuestions: ['文科专业真的需要高性能本吗？', '经管类学生更该看续航还是看屏幕？', '平板能不能直接替代笔记本？'],
    dailyTopics: ['文科经管专业电脑怎么选', '课堂通勤党买电脑别忽略这三点', '轻薄本更适合哪些大学场景'],
    presetQuestions: [
      { id: 'library-light', label: '经常带去课堂', question: '我经常带电脑去课堂和图书馆，优先看哪些点？', budget: '5000-7000', portability: '轻一点，方便背着走', performanceNeed: '日常学习为主', aiFocus: '先能稳定学习办公' },
      { id: 'paper-office', label: '资料管理和论文', question: '我平时主要写论文、做表格和看资料，什么方向更合适？', budget: '7000-9000', portability: '轻一点，方便背着走', performanceNeed: '日常学习为主', aiFocus: '先能稳定学习办公' },
    ],
  },
  {
    id: 'medical-exam',
    sortNo: 6,
    badge: '医',
    title: '医学 / 考研 / 日常学习场景怎么选',
    subtitle: '资料整理、长续航和安静稳定比花哨更重要',
    summary: '重点看稳定性、续航、屏幕舒适度和资料收纳能力，优先让长时间学习更轻松。',
    majorLabel: '医学 / 考研 / 日常学习',
    majorKeywords: ['医学', '考研', '学习', '资料', '背诵'],
    scene: '长时间看资料、网课、笔记、题库和论文整理',
    campusScenes: ['长时间刷网课和题库', '图书馆、宿舍切换学习', '资料文献和笔记长期整理'],
    recommendedCategories: ['轻薄笔记本', '平板电脑'],
    keyPoints: ['屏幕舒适度、续航和静音体验很重要', '大资料量建议 1TB SSD', '平板更适合做补充设备，不完全替代电脑'],
    avoidPoints: ['为了低价忽略屏幕和续航', '资料多却买过小硬盘', '只买平板不考虑论文和表格场景'],
    usageTips: ['Win11 长时间学习场景先把夜间模式、缩放和浏览器标签整理好', '资料量大时建议按课程、题库、论文建立固定目录', '平板更适合补充批注，不建议完全替代电脑端文档处理'],
    commonQuestions: ['考研党更应该看续航还是大硬盘？', '平板加轻薄本是不是更适合长期学习？', '医学、考研这类需求为什么不建议只看低价？'],
    dailyTopics: ['考研党选电脑先看什么', '大资料量学生最怕买错哪一步', '平板和电脑怎么搭配更省事'],
    presetQuestions: [
      { id: 'medical-reading', label: '长时间看资料', question: '我长期看网课和资料，应该重点看哪些体验？', budget: '5000-7000', portability: '轻一点，方便背着走', performanceNeed: '日常学习为主', aiFocus: '先能稳定学习办公' },
      { id: 'exam-storage', label: '资料很多怕不够用', question: '我考研和资料很多，现货里哪类更稳妥？', budget: '7000-9000', portability: '均衡就行', performanceNeed: '日常学习为主', aiFocus: '先能稳定学习办公' },
    ],
  },
  {
    id: 'win11-x86',
    sortNo: 7,
    badge: 'Win',
    title: 'Win11 电脑使用技巧和常见问题',
    subtitle: '大学新电脑到手后，先把系统基础体验和兼容性弄顺',
    summary: '这类内容更适合做开学前准备和抖音知识分享，重点是系统设置、软件兼容、驱动更新、资料管理和常见故障排查。',
    majorLabel: 'Win11 电脑日常使用',
    majorKeywords: ['Win11', '电脑使用', '系统', '驱动', '兼容'],
    scene: '新机到手设置、开学软件安装、日常办公学习和兼容性排查',
    campusScenes: ['开学前新机初始化', '课程软件安装和兼容确认', '系统更新、驱动和资料迁移'],
    recommendedCategories: ['轻薄笔记本', '游戏笔记本'],
    keyPoints: ['先完成系统更新、驱动更新和恢复盘规划', '常用办公、课程和创作软件要分层安装', '资料同步、浏览器书签和密码管理要一次规划好'],
    avoidPoints: ['新机到手就装一堆来源不明的软件', '不做系统更新就开始装课程环境', '只看跑分，不做真实课堂使用准备'],
    usageTips: ['Win11 第一次到手先跑系统更新，再装课程工具和常用软件', '常见桌面软件兼容度高，但仍要确认专业软件版本要求', '系统盘和资料盘最好从第一天开始分开管理'],
    commonQuestions: ['Win11 新机为什么第一次开机要先更新？', '课程软件和常见电脑兼容性怎么样？', '新机到手最容易忽略的设置有哪些？'],
    dailyTopics: ['Win11 新机到手先做哪几步', '大学生最常见的电脑兼容问题', '课程软件安装顺序怎么排'],
    presetQuestions: [
      { id: 'win11-first-day', label: '新机到手先做什么', question: '大学新电脑刚到手，Win11 应该先设置哪些内容？', budget: '先看配置再定预算', portability: '均衡就行', performanceNeed: '日常学习为主', aiFocus: '先能稳定学习办公' },
      { id: 'win11-software', label: '课程软件兼容', question: '我担心课程软件兼容问题，Win11 电脑该怎么提前确认？', budget: '7000-9000', portability: '均衡就行', performanceNeed: '要兼顾编程 / 多任务', aiFocus: '先能稳定学习办公' },
    ],
  },
]

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeText(value: unknown, limit = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function normalizeLookupKey(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseGuideProductSpecs(item: RetailZoneItem): ParsedGuideProductSpecs {
  const name = normalizeText(item.productName, 220)
  const tokens = name
    .replace(/[·()（）]/g, ' ')
    .split(/[\s/]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  const memoryLabel = tokens.find((token) => /^(8|12|16|24|32|48|64|96)G$/i.test(token)) || ''
  const storageLabel = tokens.find((token) => /^(256G|512G|1T|2T|4T)$/i.test(token)) || ''
  const gpuMatch = name.match(/(RTX\s?\d{4}|MX\d+|Arc|Radeon\s?\w*)/i)
  const screenMatch = name.match(/(2\.5K|2\.8K|3K|4K|FHD\+?|QHD\+?|OLED)/i)
  const refreshMatch = name.match(/(\d{2,3}Hz)/i)
  return {
    memoryLabel: normalizeText(memoryLabel, 20),
    storageLabel: normalizeText(storageLabel, 20),
    gpuLabel: normalizeText(gpuMatch?.[1] || '', 40),
    screenLabel: normalizeText(screenMatch?.[1] || '', 20),
    refreshLabel: normalizeText(refreshMatch?.[1] || '', 20),
    isOled: /OLED/i.test(name),
  }
}

function buildGuideProductFitSummary(item: RetailZoneItem, guide: GuideTemplate, salesSignal: ProductSalesSignal | null) {
  const specs = parseGuideProductSpecs(item)
  const hints: string[] = []
  if (guide.id === 'computer-ai' && ['24G', '32G', '48G', '64G', '96G'].includes(specs.memoryLabel.toUpperCase())) {
    hints.push('大内存更适合开发环境、多任务和长期学习使用')
  }
  if (guide.id === 'design-media' && specs.gpuLabel) {
    hints.push('带独显更适合剪辑、建模、渲染和重负载创作')
  }
  if (guide.id === 'gaming-balance' && specs.refreshLabel) {
    hints.push('高刷新率和性能路线更适合游戏与动态画面场景')
  }
  if (guide.id === 'arts-business' && (specs.isOled || /2\.5K|2\.8K|3K|4K/i.test(specs.screenLabel))) {
    hints.push('高素质屏幕更适合长时间看资料和课堂使用')
  }
  if (guide.id === 'medical-exam' && ['1T', '2T', '4T'].includes(specs.storageLabel.toUpperCase())) {
    hints.push('大硬盘更适合长期资料、网课和题库整理')
  }
  if (guide.id === 'win11-x86') {
    hints.push('更适合做开学前新机设置、课程软件安装和日常使用准备')
  }
  if (salesSignal?.orderCount) {
    hints.push('近期门店常被选择，可优先到店对比同类方向')
  }
  return hints.slice(0, 2).join('；')
}

function buildSalesSignalMap(snapshot: RetailCoreSalesOrdersSnapshot | null) {
  const signalMap = new Map<string, ProductSalesSignal>()
  const orders = Array.isArray(snapshot?.items) ? snapshot!.items! : []
  for (const order of orders) {
    const lines = Array.isArray(order.lines) ? order.lines : []
    for (const line of lines) {
      const quantity = Math.max(1, safeNumber(line.quantity))
      const keys = [
        normalizeLookupKey(line.sku_key),
        normalizeLookupKey(line.mtm_code),
        normalizeLookupKey(line.product_name),
      ].filter(Boolean)
      for (const key of keys) {
        const current = signalMap.get(key) || { orderCount: 0, quantity: 0 }
        current.orderCount += 1
        current.quantity += quantity
        signalMap.set(key, current)
      }
    }
  }
  return signalMap
}

function resolveSalesSignal(item: RetailZoneItem, signalMap: Map<string, ProductSalesSignal>) {
  const keys = [
    normalizeLookupKey(item.skuKey),
    normalizeLookupKey(item.pnMtm),
    normalizeLookupKey(item.productName),
  ].filter(Boolean)
  let best: ProductSalesSignal | null = null
  for (const key of keys) {
    const signal = signalMap.get(key)
    if (!signal) continue
    if (!best || signal.quantity > best.quantity || (signal.quantity === best.quantity && signal.orderCount > best.orderCount)) {
      best = signal
    }
  }
  return best
}

function buildMarketingActivities(item: RetailZoneItem) {
  const labels: string[] = []
  const appendOnce = (label: string) => {
    if (label && !labels.includes(label)) labels.push(label)
  }
  if (safeNumber(item.platformSubsidyPrice) > 0 || safeNumber(item.lenovoOfficialPostSubsidyPrice) > 0) {
    appendOnce('可参加国补活动')
  }
  if (safeNumber(item.fullServiceSubsidyPrice) > 0) {
    appendOnce('可参加门店全服务活动')
  }
  if (safeNumber(item.regularChannelSubsidyPrice) > 0) {
    appendOnce('可参加正规渠道服务活动')
  }
  if (safeNumber(item.defensiveLowSubsidyPrice) > 0) {
    appendOnce('可到店核验专项活动方案')
  }
  const salesNote = normalizeText(item.salesNote, 160)
  if (salesNote.includes('教育补')) appendOnce('到店可核验教育补活动')
  if (salesNote.includes('三件套')) appendOnce('可叠加 AI 三件套活动')
  if (salesNote.includes('二件套')) appendOnce('可叠加二件套活动')
  return labels
}

function matchGuideItems(items: RetailZoneItem[], guide: GuideTemplate, salesSignalMap: Map<string, ProductSalesSignal>) {
  return items
    .filter((item) => safeNumber(item.sellableStock) > 0)
    .filter((item) => {
      const category = normalizeText(item.category, 40)
      const name = normalizeText(item.productName, 120)
      return guide.recommendedCategories.includes(category) || guide.majorKeywords.some((keyword) => name.includes(keyword))
    })
    .sort((left, right) => {
      const rightSales = resolveSalesSignal(right, salesSignalMap)
      const leftSales = resolveSalesSignal(left, salesSignalMap)
      const salesDiff = safeNumber(rightSales?.quantity) - safeNumber(leftSales?.quantity)
      if (salesDiff !== 0) return salesDiff
      const stockDiff = safeNumber(right.sellableStock) - safeNumber(left.sellableStock)
      if (stockDiff !== 0) return stockDiff
      return safeNumber(right.recommendedPreSubsidyPrice) - safeNumber(left.recommendedPreSubsidyPrice)
    })
}

export async function buildGaokaoKnowledgeGuides() {
  const [retailZone, salesOrdersSnapshot, dailyLearningSnapshot] = await Promise.all([
    readJsonIfExists<{ decisions?: { items?: RetailZoneItem[] } }>(
      path.resolve(webDataDir, 'latest-retail-zone-snapshot.json'),
    ),
    readJsonIfExists<RetailCoreSalesOrdersSnapshot>(path.resolve(webDataDir, 'latest-retail-core-sales-orders.json')),
    readJsonIfExists<GaokaoDailyLearningSnapshot>(path.resolve(webDataDir, 'latest-gaokao-daily-learning.json')),
  ])
  const retailItems = Array.isArray(retailZone?.decisions?.items) ? retailZone!.decisions!.items! : []
  const salesSignalMap = buildSalesSignalMap(salesOrdersSnapshot)
  const generatedAt = nowIso()

  const items: GaokaoMajorGuideItem[] = guideTemplates.map((guide) => {
    const matched = matchGuideItems(retailItems, guide, salesSignalMap)
    const learningTracks = (Array.isArray(dailyLearningSnapshot?.tracks) ? dailyLearningSnapshot!.tracks! : []).filter((track) => {
      const majors = Array.isArray(track.relatedMajors) ? track.relatedMajors : []
      return majors.some((major) => guide.majorKeywords.some((keyword) => normalizeText(major, 40).includes(keyword)))
        || guide.title.includes(normalizeText(track.routeLabel, 20))
    })
    const learningNotes = (Array.isArray(dailyLearningSnapshot?.dailyLearnings) ? dailyLearningSnapshot!.dailyLearnings! : []).filter((note) => {
      const tags = Array.isArray(note.tags) ? note.tags : []
      return tags.some((tag) => guide.majorKeywords.some((keyword) => normalizeText(tag, 40).includes(keyword)))
        || normalizeText(note.content, 200).includes(normalizeText(guide.majorLabel, 40))
    })
    const featuredProducts = matched.slice(0, 3).map((item) => ({
      skuKey: normalizeText(item.skuKey, 80),
      productName: normalizeText(item.productName, 140),
      category: normalizeText(item.category, 40),
      fitSummary: buildGuideProductFitSummary(item, guide, resolveSalesSignal(item, salesSignalMap)),
      marketingActivities: [
        ...buildMarketingActivities(item),
        ...(resolveSalesSignal(item, salesSignalMap)?.orderCount ? ['近期门店常被选择'] : []),
      ].slice(0, 5),
    }))
    const marketingActivities = Array.from(new Set([
      ...matched.flatMap((item) => buildMarketingActivities(item)),
      ...learningTracks.flatMap((track) => Array.isArray(track.marketingActivities) ? track.marketingActivities.map((entry) => normalizeText(entry, 40)).filter(Boolean) : []),
    ])).slice(0, 5)
    const dailyLearningHighlights = Array.from(new Set([
      ...learningTracks.map((track) => normalizeText(track.recommendationScript, 180)).filter(Boolean),
      ...learningTracks.map((track) => normalizeText(track.inventoryLearning, 120)).filter(Boolean),
      ...learningNotes.map((note) => normalizeText(note.title, 80)).filter(Boolean),
    ])).slice(0, 4)
    return {
      id: guide.id,
      sortNo: guide.sortNo,
      badge: guide.badge,
      title: guide.title,
      subtitle: guide.subtitle,
      summary: guide.summary,
      majorLabel: guide.majorLabel,
      majorKeywords: guide.majorKeywords,
      scene: guide.scene,
      campusScenes: guide.campusScenes,
      recommendedCategories: guide.recommendedCategories,
      keyPoints: guide.keyPoints,
      avoidPoints: guide.avoidPoints,
      usageTips: guide.usageTips,
      commonQuestions: guide.commonQuestions,
      dailyTopics: Array.from(new Set([
        ...guide.dailyTopics,
        ...learningNotes.map((note) => normalizeText(note.title, 80)).filter(Boolean),
      ])).slice(0, 6),
      dailyLearningHighlights,
      marketingActivities,
      presetQuestions: guide.presetQuestions,
      featuredProducts,
      updatedAt: generatedAt,
    }
  })

  const snapshot: GaokaoMajorGuidesSnapshot = {
    generatedAt,
    summary: {
      guideCount: items.length,
      featuredProductCount: items.reduce((sum, item) => sum + item.featuredProducts.length, 0),
    },
    items,
  }

  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-gaokao-major-guides.json')
  const webPath = path.resolve(webDataDir, 'latest-gaokao-major-guides.json')
  const content = `${JSON.stringify(snapshot, null, 2)}\n`
  await Promise.all([
    fs.mkdir(path.dirname(artifactPath), { recursive: true }),
    fs.mkdir(path.dirname(webPath), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(artifactPath, content, 'utf-8'),
    fs.writeFile(webPath, content, 'utf-8'),
  ])
  return { snapshot, artifactPath, webPath }
}
