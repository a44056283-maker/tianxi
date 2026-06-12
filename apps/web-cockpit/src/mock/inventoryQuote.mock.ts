export type InventoryStatus = 'normal' | 'tight' | 'low' | 'overstock' | 'warrantyRisk'

export type ProductMaster = {
  id: string
  lenovoModel: string
  mtm: string
  name: string
  category: string
  config: string
  cpu: string
  gpu: string
  memory: string
  storage: string
  screen: string
  color: string
  subsidyEligible: boolean
  prioritySku: boolean
  grayChannelAllowed: boolean
}

export type SerialInventoryItem = {
  sn: string
  productId: string
  productName: string
  inboundDate: string
  source: '厂家正规渠道' | '分销商现货' | '灰渠批发' | '门店调拨'
  cost: number
  location: '中关村店' | '海淀仓' | '在途'
  stockAgeDays: number
  status: InventoryStatus
  warrantyStart: string
  warrantyEnd: string
  servicePlan: string
  warrantyCheck: '已校验' | '待校验' | '异常'
  action: string
}

export type PriceSourceItem = {
  productId: string
  productName: string
  source: '联想订货平台' | '分销商日报价' | '灰渠公众号' | '联想官网' | '京东' | '淘宝百亿补贴'
  sourceType: '进货参考' | '销售参考' | '国补参考'
  price: number
  taxIncluded: boolean
  serviceIncluded: boolean
  publishedAt: string
  capturedAt: string
  confidence: '高' | '中' | '低'
  evidence: string
}

export type SubsidyRule = {
  region: string
  ratio: number
  cap: number
  categoryCaps?: {
    computer: number
    tablet: number
    phone: number
  }
  eligibilityNote?: string
  categories: string[]
  regularApprovalRequired: boolean
  defensiveApprovalRequired: boolean
  serviceRiskRequired: boolean
}

export type QuoteDecision = {
  productId: string
  productName: string
  regularCostBasis: number
  grayCostBasis: number
  lenovoOfficialPrice: number
  jdPrice: number
  taobaoPrice: number
  regularSubsidyPrice: number
  defensiveSubsidyPrice: number
  recommendedPrice: number
  floorPrice: number
  expectedMargin: number
  approval: '销售可用' | '店长审批' | '老板审批'
  salesNote: string
  riskNote: string
}

export type CompetitorRankItem = {
  rank: number
  productName: string
  series: 'ThinkBook'
  jdPrice?: number
  jdSubsidyPrice?: number
  jdUrl?: string
  rankSource: '京东销量排行'
  capturedAt?: string
  stockStatus: '不备货监控' | '可临时调货' | '建议备货'
  salesNote: string
}

export const productMasters: ProductMaster[] = [
  {
    id: 'SKU-Y9000P-2024-I9-4060',
    lenovoModel: '拯救者 Y9000P 2024',
    mtm: '83DF000XCD',
    name: '拯救者 Y9000P 2024 i9 RTX4060',
    category: '游戏本',
    config: 'i9-14900HX / RTX4060 / 16G / 1T / 16英寸',
    cpu: 'i9-14900HX',
    gpu: 'RTX4060',
    memory: '16G',
    storage: '1T SSD',
    screen: '16英寸 2.5K 240Hz',
    color: '钛晶灰',
    subsidyEligible: true,
    prioritySku: true,
    grayChannelAllowed: true,
  },
  {
    id: 'SKU-XIAOXIN-PRO16-2024',
    lenovoModel: '小新 Pro16 2024',
    mtm: '83D40012CD',
    name: '小新 Pro16 2024 Ultra5 核显',
    category: '轻薄本',
    config: 'Ultra5 / 32G / 1T / 16英寸',
    cpu: 'Core Ultra 5',
    gpu: 'Intel Arc 核显',
    memory: '32G',
    storage: '1T SSD',
    screen: '16英寸 2.5K 120Hz',
    color: '云灰',
    subsidyEligible: true,
    prioritySku: true,
    grayChannelAllowed: true,
  },
  {
    id: 'SKU-X1-CARBON-AI-2024',
    lenovoModel: 'ThinkPad X1 Carbon AI',
    mtm: '21KC001BCD',
    name: 'ThinkPad X1 Carbon AI 2024',
    category: '商务本',
    config: 'Ultra7 / 32G / 1T / 14英寸 OLED',
    cpu: 'Core Ultra 7',
    gpu: 'Intel Arc 核显',
    memory: '32G',
    storage: '1T SSD',
    screen: '14英寸 OLED',
    color: '黑色',
    subsidyEligible: true,
    prioritySku: false,
    grayChannelAllowed: false,
  },
  {
    id: 'SKU-XIAOXIN-AIR14-2023',
    lenovoModel: '小新 Air14 2023',
    mtm: '82YN003ACD',
    name: '小新 Air14 2023 锐龙版',
    category: '轻薄本',
    config: 'R7 / 16G / 512G / 14英寸',
    cpu: 'R7-7840U',
    gpu: 'Radeon 780M',
    memory: '16G',
    storage: '512G SSD',
    screen: '14英寸 2.8K',
    color: '深空灰',
    subsidyEligible: true,
    prioritySku: false,
    grayChannelAllowed: true,
  },
]

export const serialInventory: SerialInventoryItem[] = [
  {
    sn: 'PF4X24A80091',
    productId: 'SKU-Y9000P-2024-I9-4060',
    productName: '拯救者 Y9000P 2024',
    inboundDate: '2026-04-28',
    source: '厂家正规渠道',
    cost: 10880,
    location: '中关村店',
    stockAgeDays: 12,
    status: 'tight',
    warrantyStart: '2026-04-30',
    warrantyEnd: '2028-04-29',
    servicePlan: '2年整机保修 / 官方上门',
    warrantyCheck: '已校验',
    action: '保留黄金位，优先正规国补',
  },
  {
    sn: 'PF5N91C30028',
    productId: 'SKU-XIAOXIN-PRO16-2024',
    productName: '小新 Pro16 2024',
    inboundDate: '2026-04-18',
    source: '分销商现货',
    cost: 5840,
    location: '中关村店',
    stockAgeDays: 22,
    status: 'normal',
    warrantyStart: '2026-04-20',
    warrantyEnd: '2028-04-19',
    servicePlan: '2年整机保修',
    warrantyCheck: '已校验',
    action: '维持主推，跟进京东价',
  },
  {
    sn: 'PF6T81X70056',
    productId: 'SKU-X1-CARBON-AI-2024',
    productName: 'ThinkPad X1 Carbon AI',
    inboundDate: '2026-05-04',
    source: '厂家正规渠道',
    cost: 12650,
    location: '海淀仓',
    stockAgeDays: 6,
    status: 'low',
    warrantyStart: '2026-05-06',
    warrantyEnd: '2029-05-05',
    servicePlan: '3年 Premier Support',
    warrantyCheck: '已校验',
    action: '补到门店 3 台，禁止灰渠替代',
  },
  {
    sn: 'PF2A73L90013',
    productId: 'SKU-XIAOXIN-AIR14-2023',
    productName: '小新 Air14 2023',
    inboundDate: '2026-02-21',
    source: '灰渠批发',
    cost: 3560,
    location: '中关村店',
    stockAgeDays: 79,
    status: 'warrantyRisk',
    warrantyStart: '2026-01-12',
    warrantyEnd: '2028-01-11',
    servicePlan: '2年整机保修',
    warrantyCheck: '异常',
    action: '仅用于防流失价，成交前店长确认',
  },
]

export const priceSources: PriceSourceItem[] = [
  {
    productId: 'SKU-Y9000P-2024-I9-4060',
    productName: '拯救者 Y9000P 2024',
    source: '联想订货平台',
    sourceType: '进货参考',
    price: 10980,
    taxIncluded: true,
    serviceIncluded: true,
    publishedAt: '2026-05-10 09:20',
    capturedAt: '2026-05-10 22:16',
    confidence: '中',
    evidence: '订货平台报价页',
  },
  {
    productId: 'SKU-Y9000P-2024-I9-4060',
    productName: '拯救者 Y9000P 2024',
    source: '分销商日报价',
    sourceType: '进货参考',
    price: 10760,
    taxIncluded: true,
    serviceIncluded: true,
    publishedAt: '2026-05-10 11:42',
    capturedAt: '2026-05-10 12:03',
    confidence: '高',
    evidence: '固定群日报价',
  },
  {
    productId: 'SKU-Y9000P-2024-I9-4060',
    productName: '拯救者 Y9000P 2024',
    source: '灰渠公众号',
    sourceType: '进货参考',
    price: 10180,
    taxIncluded: false,
    serviceIncluded: false,
    publishedAt: '2026-05-10 17:35',
    capturedAt: '2026-05-10 17:48',
    confidence: '中',
    evidence: '公众号报价图',
  },
  {
    productId: 'SKU-Y9000P-2024-I9-4060',
    productName: '拯救者 Y9000P 2024',
    source: '京东',
    sourceType: '销售参考',
    price: 12599,
    taxIncluded: true,
    serviceIncluded: true,
    publishedAt: '2026-05-10 22:00',
    capturedAt: '2026-05-10 22:17',
    confidence: '高',
    evidence: '京东商品页',
  },
  {
    productId: 'SKU-XIAOXIN-PRO16-2024',
    productName: '小新 Pro16 2024',
    source: '淘宝百亿补贴',
    sourceType: '国补参考',
    price: 6499,
    taxIncluded: true,
    serviceIncluded: false,
    publishedAt: '2026-05-10 21:30',
    capturedAt: '2026-05-10 22:15',
    confidence: '中',
    evidence: '淘宝百亿补贴页',
  },
]

export const subsidyRule: SubsidyRule = {
  region: '北京',
  ratio: 0.15,
  cap: 1500,
  categoryCaps: {
    computer: 1500,
    tablet: 500,
    phone: 500,
  },
  eligibilityNote: '电脑类封顶 1500 元，手机和平板封顶 500 元；只补一级能耗，非国补目录只展示零售价。',
  categories: ['游戏本', '轻薄本', '商务本', '台式机', '平板', '手机'],
  regularApprovalRequired: false,
  defensiveApprovalRequired: true,
  serviceRiskRequired: true,
}

export const quoteDecisions: QuoteDecision[] = [
  {
    productId: 'SKU-Y9000P-2024-I9-4060',
    productName: '拯救者 Y9000P 2024',
    regularCostBasis: 10760,
    grayCostBasis: 10180,
    lenovoOfficialPrice: 12999,
    jdPrice: 12599,
    taobaoPrice: 12399,
    regularSubsidyPrice: 11049,
    defensiveSubsidyPrice: 10399,
    recommendedPrice: 12699,
    floorPrice: 12199,
    expectedMargin: 1939,
    approval: '店长审批',
    salesNote: '先报正规国补，强调现货交付和官方服务；强比价客户可申请防流失价。',
    riskNote: '灰渠价不含税且服务承诺弱，使用防流失价前需确认 SN 保修。',
  },
  {
    productId: 'SKU-XIAOXIN-PRO16-2024',
    productName: '小新 Pro16 2024',
    regularCostBasis: 5840,
    grayCostBasis: 5480,
    lenovoOfficialPrice: 6999,
    jdPrice: 6799,
    taobaoPrice: 6499,
    regularSubsidyPrice: 5949,
    defensiveSubsidyPrice: 5599,
    recommendedPrice: 6799,
    floorPrice: 6399,
    expectedMargin: 959,
    approval: '销售可用',
    salesNote: '主推教育和办公场景，报价跟京东，赠服务包提升成交。',
    riskNote: '淘宝百亿价格低，注意解释门店现货和售后差异。',
  },
  {
    productId: 'SKU-X1-CARBON-AI-2024',
    productName: 'ThinkPad X1 Carbon AI',
    regularCostBasis: 12650,
    grayCostBasis: 0,
    lenovoOfficialPrice: 14999,
    jdPrice: 14499,
    taobaoPrice: 14399,
    regularSubsidyPrice: 12749,
    defensiveSubsidyPrice: 0,
    recommendedPrice: 14699,
    floorPrice: 13999,
    expectedMargin: 2049,
    approval: '老板审批',
    salesNote: '商务服务价值高，优先突出 Premier Support，低价需审批。',
    riskNote: '该型号不允许灰渠覆盖，禁止使用防流失国补价。',
  },
]

export const sourceSyncStatus = [
  { source: '智店通库存', mode: '网页RPA', status: '待接入', lastSync: '需要账号与页面样例' },
  { source: '联想订货平台', mode: '网页采集', status: '待接入', lastSync: '需要平台网址' },
  { source: '分销商日报价', mode: '群报价导入', status: '可先做半自动', lastSync: '等待样例' },
  { source: '灰渠公众号', mode: '公众号采集', status: '待评估', lastSync: '需要公众号样例' },
  { source: 'ThinkBook竞品排行', mode: '京东销量TOP10采集', status: '待接入', lastSync: '独立展示，不计入库存' },
  { source: '电商销售价', mode: '网页采集', status: '待接入', lastSync: '先锁定20个核心SKU' },
]

export const competitorRankItems: CompetitorRankItem[] = [
  {
    rank: 1,
    productName: 'ThinkBook 京东销量第1名',
    series: 'ThinkBook',
    rankSource: '京东销量排行',
    stockStatus: '不备货监控',
    salesNote: '等待京东采集器接入后，展示实时价格、国补价和商品链接。',
  },
  {
    rank: 2,
    productName: 'ThinkBook 京东销量第2名',
    series: 'ThinkBook',
    rankSource: '京东销量排行',
    stockStatus: '不备货监控',
    salesNote: '用于销售端识别客户点名机型，不与真实库存混算。',
  },
  {
    rank: 3,
    productName: 'ThinkBook 京东销量第3名',
    series: 'ThinkBook',
    rankSource: '京东销量排行',
    stockStatus: '不备货监控',
    salesNote: '接入后按销量排行每天更新前10名。',
  },
]
