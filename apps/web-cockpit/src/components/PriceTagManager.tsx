/**
 * PriceTagManager — 电子价签同步队列管理
 * Lists, creates, retries price tag update tasks.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle,
  Clock,
  Filter,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react'

// ==================== Types ====================

interface PriceTagTask {
  id: string
  deviceId: string
  skuKey: string
  templateId: string
  pricePayload: Record<string, unknown>
  status: 'pending' | 'sending' | 'confirmed' | 'failed'
  retryCount: number
  lastError: string
  createdAt: string
  updatedAt: string
}

interface CreateTaskInput {
  skuKey: string
  storeCode?: string
  templateId?: string
  deviceId?: string
  pricePayload?: Record<string, unknown>
}

// ==================== API ====================

const API = '/api/price-tag/tasks'

async function listTasks(params: {
  status?: string
  skuKey?: string
  limit?: number
  offset?: number
}): Promise<PriceTagTask[]> {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.skuKey) sp.set('skuKey', params.skuKey)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset ?? 0))
  const res = await fetch(`${API}?${sp}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

async function createTask(body: CreateTaskInput): Promise<PriceTagTask> {
  const res = await fetch(`${API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skuKey: body.skuKey,
      storeCode: body.storeCode ?? 'LENOVO-SR-001',
      templateId: body.templateId ?? 'default-store-price',
      deviceId: body.deviceId ?? null,
      pricePayload: body.pricePayload ?? {},
      source: 'web_cockpit_manual',
    }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

async function retryTask(taskId: string): Promise<PriceTagTask> {
  const res = await fetch(`${API}/${taskId}/retry`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ==================== Component ====================

const STATUS_CONFIG = {
  pending: { label: '待处理', icon: <Clock size={12} />, color: 'text-yellow-600 bg-yellow-50' },
  sending: { label: '发送中', icon: <Send size={12} />, color: 'text-blue-600 bg-blue-50' },
  confirmed: { label: '已确认', icon: <CheckCircle size={12} />, color: 'text-green-600 bg-green-50' },
  failed: { label: '失败', icon: <XCircle size={12} />, color: 'text-red-600 bg-red-50' },
} as const

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  } catch {
    return iso
  }
}

export function PriceTagManager() {
  const [tasks, setTasks] = useState<PriceTagTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [skuFilter, setSkuFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createSku, setCreateSku] = useState('')
  const [createPrice, setCreatePrice] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listTasks({
        status: statusFilter || undefined,
        skuKey: skuFilter || undefined,
        limit: 100,
      })
      setTasks(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, skuFilter])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async () => {
    if (!createSku.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      await createTask({
        skuKey: createSku.trim(),
        pricePayload: createPrice
          ? { storeRetailPrice: parseFloat(createPrice), skuKey: createSku.trim() }
          : {},
      })
      setShowCreate(false)
      setCreateSku('')
      setCreatePrice('')
      await load()
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const handleRetry = async (taskId: string) => {
    setRetryingId(taskId)
    try {
      await retryTask(taskId)
      await load()
    } catch (e: unknown) {
      alert(`重试失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRetryingId(null)
    }
  }

  const counts = tasks.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">🏷️ 电子价签同步队列</h2>
        <div className="flex gap-2">
          <button className="btn btn-sm btn-ghost flex items-center gap-1" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button className="btn btn-sm btn-primary flex items-center gap-1" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> 新建任务
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-gray-50 p-3 rounded-lg">
        <div>
          <label className="text-xs text-gray-500 block mb-1">状态筛选</label>
          <select
            className="select select-sm select-bordered"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">全部</option>
            <option value="pending">待处理</option>
            <option value="sending">发送中</option>
            <option value="confirmed">已确认</option>
            <option value="failed">失败</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">SKU 筛选</label>
          <input
            type="text"
            className="input input-sm input-bordered w-40"
            placeholder="SKU key…"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
          />
        </div>
        <button className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
          <Filter size={14} /> 应用
        </button>
      </div>

      {/* Status summary */}
      <div className="flex gap-3 flex-wrap">
        {(Object.entries(STATUS_CONFIG) as [keyof typeof STATUS_CONFIG, typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(([status, cfg]) => (
          <div key={status} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${cfg.color}`}>
            {cfg.icon}
            <span className="text-xs font-medium">{cfg.label}：{counts[status] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="bg-white border rounded-lg p-4 shadow-md space-y-3">
          <h3 className="font-semibold text-sm">新建价签更新任务</h3>
          {createError && <div className="text-red-500 text-sm">{createError}</div>}
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="text-xs text-gray-500 block mb-1">SKU Key *</label>
              <input
                type="text"
                className="input input-sm input-bordered w-48"
                placeholder="如 20006725"
                value={createSku}
                onChange={(e) => setCreateSku(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">零售价（元）</label>
              <input
                type="number"
                className="input input-sm input-bordered w-32"
                placeholder="11599"
                value={createPrice}
                onChange={(e) => setCreatePrice(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary" onClick={handleCreate} disabled={creating || !createSku.trim()}>
              {creating ? '创建中…' : '确认创建'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setShowCreate(false); setCreateError(null) }}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="text-red-500 text-sm p-3 bg-red-50 rounded">{error}</div>}

      {/* Table */}
      {tasks.length > 0 ? (
        <div className="bg-white border rounded-lg shadow-sm overflow-auto">
          <table className="table table-xs w-full">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50">
                <th>任务ID</th>
                <th>SKU</th>
                <th>模板</th>
                <th>状态</th>
                <th>重试次数</th>
                <th>错误信息</th>
                <th>创建时间</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending
                return (
                  <tr key={task.id} className="hover:bg-gray-50">
                    <td className="font-mono text-xs max-w-[120px] truncate" title={task.id}>{task.id}</td>
                    <td className="font-medium">{task.skuKey}</td>
                    <td className="text-gray-500">{task.templateId}</td>
                    <td>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </td>
                    <td className="text-center">{task.retryCount}</td>
                    <td className="max-w-[150px] truncate text-red-500 text-xs" title={task.lastError}>
                      {task.lastError || '—'}
                    </td>
                    <td className="text-gray-500 whitespace-nowrap">{formatTime(task.createdAt)}</td>
                    <td className="text-gray-500 whitespace-nowrap">{formatTime(task.updatedAt)}</td>
                    <td>
                      {(task.status === 'failed' || task.status === 'pending') && (
                        <button
                          className="btn btn-xs btn-ghost flex items-center gap-1"
                          onClick={() => handleRetry(task.id)}
                          disabled={retryingId === task.id}
                        >
                          <RotateCcw size={12} className={retryingId === task.id ? 'animate-spin' : ''} />
                          {retryingId === task.id ? '重试中…' : '重试'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : !loading && (
        <div className="text-gray-400 text-sm text-center py-8">暂无任务数据</div>
      )}
    </div>
  )
}
