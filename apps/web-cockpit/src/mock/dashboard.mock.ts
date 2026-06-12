import type { LucideIcon } from 'lucide-react'
import {
  Banknote,
  Boxes,
  CircleDollarSign,
  Laptop,
  ScanLine,
  TrendingUp,
  Users,
} from 'lucide-react'

export type KpiItem = {
  label: string
  value: string
  delta: string
  trend: 'up' | 'down'
  Icon: LucideIcon
}

export const kpis: KpiItem[] = [
  { label: '今日客流', value: '1,284', delta: '+12.6%', trend: 'up', Icon: Users },
  { label: '有效客户', value: '428', delta: '+11.3%', trend: 'up', Icon: ScanLine },
  { label: '成交台数', value: '86', delta: '+8.4%', trend: 'up', Icon: Laptop },
  { label: '成交率', value: '20.1%', delta: '-2.1%', trend: 'down', Icon: TrendingUp },
  { label: '客单价', value: '¥6,289', delta: '+5.7%', trend: 'up', Icon: CircleDollarSign },
  { label: '毛利额', value: '¥53,982', delta: '+9.2%', trend: 'up', Icon: Banknote },
]

export const trafficHourly = [
  { hour: '09:00', today: 58, yesterday: 46 },
  { hour: '10:00', today: 92, yesterday: 73 },
  { hour: '11:00', today: 184, yesterday: 146 },
  { hour: '12:00', today: 188, yesterday: 171 },
  { hour: '13:00', today: 201, yesterday: 164 },
  { hour: '14:00', today: 278, yesterday: 196 },
  { hour: '15:00', today: 246, yesterday: 218 },
  { hour: '16:00', today: 328, yesterday: 242 },
  { hour: '17:00', today: 236, yesterday: 136 },
  { hour: '18:00', today: 302, yesterday: 188 },
  { hour: '19:00', today: 205, yesterday: 142 },
  { hour: '20:00', today: 226, yesterday: 121 },
  { hour: '21:00', today: 92, yesterday: 74 },
]

export const inventory = [
  { name: '正常库存', value: 862, color: '#25d37b' },
  { name: '偏低库存', value: 198, color: '#ffcf33' },
  { name: '积压库存', value: 138, color: '#ff9a3d' },
  { name: '缺货预警', value: 70, color: '#ff4d5b' },
]

export const productHeat = [
  { rank: 1, name: '拯救者 Y9000P 2024', category: '游戏本', visits: 128, conversion: 28 },
  { rank: 2, name: '拯救者 R9000P 2024', category: '游戏本', visits: 96, conversion: 25 },
  { rank: 3, name: '拯救者 Y7000P 2024', category: '游戏本', visits: 78, conversion: 21 },
  { rank: 4, name: '小新 Pro16 2024', category: '轻薄本', visits: 72, conversion: 18 },
  { rank: 5, name: 'ThinkBook 14+', category: '商务本', visits: 61, conversion: 17 },
]

export const priceRows = [
  { product: '拯救者 Y9000P 2024', store: '¥12,999', official: '¥12,999', jd: '¥12,599', diff: '+¥400' },
  { product: '小新 Pro16 2024', store: '¥6,999', official: '¥6,999', jd: '¥6,799', diff: '+¥200' },
  { product: 'ThinkPad X1 Carbon AI', store: '¥14,999', official: '¥14,999', jd: '¥14,499', diff: '+¥500' },
  { product: '小新 14 2024', store: '¥4,299', official: '¥4,299', jd: '¥4,199', diff: '+¥100' },
  { product: '联想台式机 GeekPro 2024', store: '¥5,999', official: '¥5,999', jd: '¥5,799', diff: '+¥200' },
]

export const inventoryQuoteMetrics = [
  { label: '门店可售', value: '862', note: '较昨 +46 台', tone: 'good' },
  { label: '在途库存', value: '128', note: '预计 18:30 到店', tone: 'info' },
  { label: '报价待确认', value: '24', note: '均价 ¥7,842', tone: 'warn' },
  { label: '价格异常', value: '7', note: '需 15 分钟内处理', tone: 'danger' },
]

export const realtimeInventoryRows = [
  { sku: '拯救者 Y9000P 2024', store: 18, warehouse: 42, transit: 6, turnover: '2.8天', status: '紧俏', action: '申请调拨 12 台' },
  { sku: '小新 Pro16 2024', store: 34, warehouse: 68, transit: 12, turnover: '5.1天', status: '正常', action: '维持陈列' },
  { sku: 'ThinkPad X1 Carbon AI', store: 5, warehouse: 18, transit: 3, turnover: '1.6天', status: '低库存', action: '优先补货 8 台' },
  { sku: '小新 Air14 2023', store: 72, warehouse: 96, transit: 0, turnover: '18.4天', status: '积压', action: '绑定促销报价' },
]

export const realtimeQuoteRows = [
  { product: '拯救者 Y9000P 2024', min: '¥12,399', store: '¥12,999', market: '¥12,599', margin: '13.8%', state: '可下调' },
  { product: '小新 Pro16 2024', min: '¥6,699', store: '¥6,999', market: '¥6,799', margin: '12.4%', state: '需跟价' },
  { product: 'ThinkPad X1 Carbon AI', min: '¥14,199', store: '¥14,999', market: '¥14,499', margin: '16.1%', state: '高价差' },
  { product: '小新 Air14 2023', min: '¥4,099', store: '¥4,599', market: '¥4,199', margin: '10.2%', state: '清仓价' },
]

export const realtimeSyncFeeds = [
  { source: 'ERP库存', status: '已同步', time: '22:17:42' },
  { source: '官网价格', status: '已同步', time: '22:16:58' },
  { source: '京东比价', status: '监控中', time: '22:17:10' },
]

export const funnel = [
  { label: '进店客流', value: 1284, rate: '100%' },
  { label: '有效客户', value: 428, rate: '33.4%' },
  { label: '咨询客户', value: 186, rate: '43.5%' },
  { label: '报价客户', value: 112, rate: '60.2%' },
  { label: '成交客户', value: 86, rate: '76.8%' },
]

export const staff = [
  { name: '张伟', served: 28, closed: 8, rate: '28.6%' },
  { name: '李娜', served: 24, closed: 7, rate: '29.2%' },
  { name: '王磊', served: 22, closed: 6, rate: '27.3%' },
  { name: '刘洋', served: 20, closed: 5, rate: '25.0%' },
  { name: '陈晨', served: 18, closed: 4, rate: '22.2%' },
]

export const afterSalesIssues = [
  { name: '系统卡顿', value: 26 },
  { name: '蓝屏死机', value: 18 },
  { name: '外观划痕', value: 15 },
  { name: '电池续航', value: 13 },
  { name: '驱动问题', value: 10 },
]

export const zoneStats = [
  { name: '游戏本体验区', value: 28 },
  { name: '学生本体验区', value: 23 },
  { name: '商务高阶区', value: 18 },
  { name: '轻薄本体验区', value: 15 },
  { name: 'AI体验区', value: 8 },
  { name: '配件周边区', value: 8 },
]

export const aiSuggestions = [
  '拯救者 Y9000P 热度高且转化稳定，建议放入口黄金位。',
  '小新 Air14 2023 库存偏高，建议广告机增加限时优惠展示。',
  '学生客户占比上升，销售话术优先突出教育优惠和售后保障。',
  '小新 Pro16 京东价低于门店价 200 元，需强化门店交付价值。',
]

export const dailyReport = [
  '今日客流较昨日增长 12.6%，14:00-16:00 为高峰时段。',
  '游戏本体验区热度最高，建议增加热门机型陈列和讲解引导。',
  '库存方面 70 个 SKU 缺货、138 个 SKU 积压，需优先处理。',
  '成交率低于目标 2.1%，建议复盘报价环节和线上比价话术。',
]

export const adCards = [
  { title: '暑季大促主推', subtitle: '小新 Pro16 至高优惠 1500 元', tag: '广告机当前播放' },
  { title: '游戏本专区', subtitle: '拯救者高性能系列', tag: '晚高峰推荐' },
  { title: '学生开学季', subtitle: '教育优惠与正版服务', tag: '明日素材' },
]

export const quickActions = [
  { label: '导入库存', Icon: Boxes },
  { label: '价格快照', Icon: CircleDollarSign },
  { label: '生成日报', Icon: TrendingUp },
]
