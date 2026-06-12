/**
 * StoreDisplay — 价签-库存关联视图
 * 按门店 + 商品分类聚合：库存量、零售价、价签状态、最近销售时间。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  XCircle,
} from 'lucide-react'

// ==================== Types ====================

interface StoreDisplayItem {
  skuKey: string
  productName: string
  category: string
  currentStock: number
  sellableStock: number
  storeRetailPrice: number | null
  finalPrice: number | null
  priceTagStatus: string
  lastPriceTagUpdate: string
  lastSaleAt: string
  priceVersion: string | null
}

interface StoreDisplaySummary {
  totalSkus: number
  pendingPriceTags: number
  failedPriceTags: number
  confirmedPriceTags: number
  lowStockSkus: number
  outOfStockSkus: number
}

interface StoreDisplayResponse {
  storeCode: string
  asOf: string
  items: StoreDisplayItem[]
  summary: StoreDisplaySummary
}

// ==================== API ====================

const API = '/api/inventory/store-display'

async function fetchStoreDisplay(category?: string): Promise<StoreDisplayResponse> {
  const sp = new URLSearchParams()
  if (category) sp.set('category', category)
  const res = await fetch(`${API}?${sp}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ==================== Helpers ====================

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  } catch {
    return iso
  }
}

const TAG_STATUS_CONFIG = {
  pending: { label: '待更新', icon: <Clock size={11} />, color: 'text-yellow-600 bg-yellow-50' },
  sending: { label: '发送中', icon: <Clock size={11} />, color: 'text-blue-600 bg-blue-50' },
  confirmed: { label: '已更新', icon: <CheckCircle size={11} />, color: 'text-green-600 bg-green-50' },
  failed: { label: '失败', icon: <XCircle size={11} />, color: 'text-red-600 bg-red-50' },
  unknown: { label: '未知', icon: <AlertTriangle size={11} />, color: 'text-gray-400 bg-gray-100' },
} as const

// ==================== Component ====================

export function StoreDisplay() {
  const [data, setData] = useState<StoreDisplayResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'pending' | 'failed' | 'low-stock'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetchStoreDisplay(categoryFilter || undefined)
      setData(resp)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [categoryFilter])

  useEffect(() => {
    load()
  }, [load])

  // Filter items
  const filteredItems = useMemo(() => {
    if (!data) return []
    let items = data.items
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (i) =>
          i.skuKey.toLowerCase().includes(q) ||
          i.productName.toLowerCase().includes(q),
      )
    }
    switch (tab) {
      case 'pending':
        return items.filter((i) => i.priceTagStatus === 'pending')
      case 'failed':
        return items.filter((i) => i.priceTagStatus === 'failed')
      case 'low-stock':
        return items.filter((i) => i.currentStock < 5)
      default:
        return items
    }
  }, [data, search, tab])

  const summary = data?.summary

  if (!data && !loading) {
    return (
      <div className="p-4">
        <div className="text-red-500">加载失败: {error}</div>
        <button className="btn btn-sm btn-primary mt-2" onClick={load}>重试</button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">🏬 门店零售价+库存联动看板</h2>
        <button
          className="btn btn-sm btn-ghost flex items-center gap-1"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white border rounded-lg p-3 shadow-sm">
            <div className="text-xs text-gray-500">SKU 总数</div>
            <div className="text-xl font-bold text-gray-800">{summary.totalSkus.toLocaleString()}</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 shadow-sm">
            <div className="text-xs text-yellow-700">待更新价签</div>
            <div className="text-xl font-bold text-yellow-600">{summary.pendingPriceTags}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 shadow-sm">
            <div className="text-xs text-red-700">失败价签</div>
            <div className="text-xl font-bold text-red-600">{summary.failedPriceTags}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 shadow-sm">
            <div className="text-xs text-green-700">已更新</div>
            <div className="text-xl font-bold text-green-600">{summary.confirmedPriceTags}</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 shadow-sm">
            <div className="text-xs text-orange-700">低库存 SKU</div>
            <div className="text-xl font-bold text-orange-600">{summary.lowStockSkus}</div>
          </div>
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 shadow-sm">
            <div className="text-xs text-gray-600">缺货 SKU</div>
            <div className="text-xl font-bold text-gray-700">{summary.outOfStockSkus}</div>
          </div>
        </div>
      )}

      {/* Filters + Tabs */}
      <div className="flex flex-wrap gap-3 items-end bg-gray-50 p-3 rounded-lg">
        <div>
          <label className="text-xs text-gray-500 block mb-1">分类筛选</label>
          <input
            type="text"
            className="input input-sm input-bordered w-40"
            placeholder="如 游戏笔记本"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">搜索</label>
          <input
            type="text"
            className="input input-sm input-bordered w-48"
            placeholder="SKU / 商品名称…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-sm btn-primary" onClick={load} disabled={loading}>
          应用筛选
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          ['all', '全部', summary?.totalSkus ?? 0],
          ['pending', '待更新', summary?.pendingPriceTags ?? 0],
          ['failed', '失败', summary?.failedPriceTags ?? 0],
          ['low-stock', '低库存', summary?.lowStockSkus ?? 0],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab(key)}
          >
            {label} <span className="ml-1 text-xs">({count})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      {filteredItems.length > 0 ? (
        <div className="bg-white border rounded-lg shadow-sm overflow-auto">
          <table className="table table-xs w-full">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50">
                <th>SKU</th>
                <th>商品名称</th>
                <th>分类</th>
                <th className="text-right">库存</th>
                <th className="text-right">可售库存</th>
                <th className="text-right">零售价</th>
                <th className="text-right">成交价</th>
                <th>价签状态</th>
                <th>价签更新时间</th>
                <th>最近销售</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const tagCfg = TAG_STATUS_CONFIG[item.priceTagStatus as keyof typeof TAG_STATUS_CONFIG] ?? TAG_STATUS_CONFIG.unknown
                const isLowStock = item.currentStock < 5 && item.currentStock > 0
                const isOutOfStock = item.currentStock === 0
                return (
                  <tr
                    key={item.skuKey}
                    className={`hover:bg-gray-50 ${isOutOfStock ? 'bg-gray-100' : isLowStock ? 'bg-orange-50' : ''}`}
                  >
                    <td className="font-mono text-xs">{item.skuKey}</td>
                    <td className="max-w-[200px] truncate text-xs" title={item.productName}>
                      {item.productName}
                    </td>
                    <td className="text-xs text-gray-500">{item.category || '—'}</td>
                    <td className={`text-right font-medium ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-orange-500' : 'text-gray-800'}`}>
                      {item.currentStock}
                    </td>
                    <td className="text-right text-gray-500">{item.sellableStock}</td>
                    <td className="text-right text-blue-600 font-medium">
                      {item.storeRetailPrice != null ? `¥${item.storeRetailPrice.toLocaleString()}` : '—'}
                    </td>
                    <td className="text-right text-green-600">
                      {item.finalPrice != null ? `¥${item.finalPrice.toLocaleString()}` : '—'}
                    </td>
                    <td>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tagCfg.color}`}>
                        {tagCfg.icon}
                        {tagCfg.label}
                      </span>
                    </td>
                    <td className="text-gray-500 text-xs whitespace-nowrap">
                      {formatTime(item.lastPriceTagUpdate)}
                    </td>
                    <td className="text-gray-500 text-xs whitespace-nowrap">
                      {formatTime(item.lastSaleAt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="p-2 text-xs text-gray-400 text-right">
            共 {filteredItems.length} 条记录 · 数据时间：{data ? formatTime(data.asOf) : '—'}
          </div>
        </div>
      ) : !loading && (
        <div className="text-gray-400 text-sm text-center py-8">
          {tab === 'pending' ? '暂无待更新价签' : tab === 'failed' ? '暂无失败价签' : tab === 'low-stock' ? '暂无低库存商品' : '暂无数据'}
        </div>
      )}
    </div>
  )
}
