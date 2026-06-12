/**
 * TurnoverReport — 进销存闭环报表
 * Shows turnover metrics + bar chart of inventory changes by category.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { RefreshCw } from 'lucide-react'

// ==================== Types ====================

interface TurnoverReport {
  startDate: string
  endDate: string
  openingStock: number
  purchases: number
  sales: number
  adjustments: number
  closingStock: number
  turnoverRate: number
  daysOfSupply: number
  avgStock: number
  daysInPeriod: number
  byCategory: CategoryItem[]
}

interface CategoryItem {
  category: string
  openingStock: number
  purchases: number
  sales: number
  adjustments: number
  closingStock: number
}

// ==================== API ====================

const API = '/api/inventory/turnover-report'

async function fetchTurnoverReport(
  startDate: string,
  endDate: string,
  category?: string,
): Promise<TurnoverReport> {
  const params = new URLSearchParams({ startDate, endDate })
  if (category) params.set('category', category)
  const res = await fetch(`${API}?${params}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ==================== Component ====================

function today() {
  return new Date().toISOString().slice(0, 10)
}
function monthsAgo(n: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

export function TurnoverReport() {
  const [startDate, setStartDate] = useState(() => monthsAgo(6))
  const [endDate, setEndDate] = useState(() => today())
  const [category, setCategory] = useState('')
  const [report, setReport] = useState<TurnoverReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTurnoverReport(startDate, endDate, category || undefined)
      setReport(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, category])

  useEffect(() => {
    load()
  }, [load])

  // Build echarts option from byCategory
  const chartOption = useMemo(() => {
    if (!report || report.byCategory.length === 0) return null
    const sorted = [...report.byCategory]
      .sort((a, b) => b.closingStock - a.closingStock)
      .slice(0, 20)
    return {
      tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
      legend: { data: ['期初库存', '期末库存', '采购入库', '销售出库'] },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((c) => (c.category.length > 8 ? c.category.slice(0, 8) + '…' : c.category)),
        axisLabel: { fontSize: 10, rotate: 30 },
      },
      yAxis: { type: 'value' as const, axisLabel: { fontSize: 10 } },
      series: [
        { name: '期初库存', type: 'bar' as const, data: sorted.map((c) => c.openingStock), itemStyle: { color: '#93c5fd' } },
        { name: '期末库存', type: 'bar' as const, data: sorted.map((c) => c.closingStock), itemStyle: { color: '#3b82f6' } },
        { name: '采购入库', type: 'bar' as const, data: sorted.map((c) => c.purchases), itemStyle: { color: '#86efac' } },
        { name: '销售出库', type: 'bar' as const, data: sorted.map((c) => c.sales), itemStyle: { color: '#fca5a5' } },
      ],
    }
  }, [report])

  const kpiCards = useMemo(() => {
    if (!report) return []
    return [
      { label: '期初库存', value: report.openingStock.toLocaleString(), color: 'text-gray-500' },
      { label: '本期采购', value: report.purchases.toLocaleString(), color: 'text-blue-600' },
      { label: '本期销售', value: report.sales.toLocaleString(), color: 'text-orange-600' },
      { label: '期末库存', value: report.closingStock.toLocaleString(), color: 'text-green-600' },
      { label: '周转率', value: report.turnoverRate.toFixed(4), color: 'text-purple-600' },
      { label: '库存天数', value: `${report.daysOfSupply.toFixed(1)}天`, color: 'text-teal-600' },
    ]
  }, [report])

  if (!report && !loading) {
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
        <h2 className="text-lg font-semibold">📊 进销存闭环报表</h2>
        <button className="btn btn-sm btn-ghost flex items-center gap-1" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-gray-50 p-3 rounded-lg">
        <div>
          <label className="text-xs text-gray-500 block mb-1">开始日期</label>
          <input type="date" className="input input-sm input-bordered" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">结束日期</label>
          <input type="date" className="input input-sm input-bordered" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">商品分类</label>
          <input type="text" className="input input-sm input-bordered w-40" placeholder="全部" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <button className="btn btn-sm btn-primary" onClick={load} disabled={loading}>{loading ? '查询中…' : '查询'}</button>
      </div>

      {report && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpiCards.map((card) => (
              <div key={card.label} className="bg-white rounded-lg border p-3 shadow-sm">
                <div className={`text-xs font-medium ${card.color}`}>{card.label}</div>
                <div className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="bg-white rounded-lg border p-4 shadow-sm text-sm space-y-1">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <span className="text-gray-500">平均库存：<b>{report.avgStock.toLocaleString()}</b></span>
              <span className="text-gray-500">周转率：<b>{report.turnoverRate.toFixed(4)}</b></span>
              <span className="text-gray-500">库存天数：<b>{report.daysOfSupply.toFixed(1)}天</b></span>
              <span className="text-gray-500">周期天数：<b>{report.daysInPeriod}天</b></span>
            </div>
          </div>

          {/* Bar Chart */}
          {chartOption && (
            <div className="bg-white rounded-lg border p-4 shadow-sm">
              <h3 className="text-sm font-semibold mb-3">📦 分类库存变化（Top 20，按期末库存降序）</h3>
              <ReactECharts option={chartOption} style={{ height: 320 }} />
            </div>
          )}

          {/* Category Table */}
          {report.byCategory.length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm overflow-auto">
              <h3 className="text-sm font-semibold p-3 border-b">📋 分类明细</h3>
              <table className="table table-xs w-full">
                <thead>
                  <tr className="text-xs text-gray-500">
                    <th>分类</th>
                    <th className="text-right">期初库存</th>
                    <th className="text-right">采购入库</th>
                    <th className="text-right">销售出库</th>
                    <th className="text-right">调整</th>
                    <th className="text-right">期末库存</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byCategory.map((cat) => (
                    <tr key={cat.category} className="hover:bg-gray-50">
                      <td className="font-medium">{cat.category}</td>
                      <td className="text-right text-blue-600">{cat.openingStock.toLocaleString()}</td>
                      <td className="text-right text-green-600">+{cat.purchases.toLocaleString()}</td>
                      <td className="text-right text-orange-600">-{cat.sales.toLocaleString()}</td>
                      <td className={`text-right ${cat.adjustments >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {cat.adjustments >= 0 ? '+' : ''}{cat.adjustments.toLocaleString()}
                      </td>
                      <td className="text-right font-semibold">{cat.closingStock.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
