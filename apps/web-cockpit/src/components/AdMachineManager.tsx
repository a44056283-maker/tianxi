import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  CheckCircle,
  Clock,
  Edit2,
  Eye,
  Monitor,
  MonitorOff,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react'

// ==================== Types ====================

type MediaType = 'image' | 'video'
type ContentStatus = 'active' | 'inactive' | 'archived'
type DeviceStatus = 'online' | 'offline'
type ScreenStatus = 'on' | 'off' | 'error'

interface AdContent {
  id: string
  title: string
  media_url: string
  media_type: MediaType
  duration_sec: number
  priority: number
  valid_from: string
  valid_to: string
  status: ContentStatus
  created_at: string
  updated_at: string
}

interface AdSchedule {
  id: string
  content_id: string
  shop_id: string
  start_time: string
  end_time: string
  repeat_rule: string
  status: string
  created_at: string
  updated_at: string
}

interface AdDevice {
  id: string
  device_id: string
  shop_id: string
  name: string
  status: DeviceStatus
  current_content_id: string | null
  screen_status: ScreenStatus
  last_heartbeat_at: string | null
  created_at: string
  updated_at: string
}

interface DeviceStatusResponse {
  ok: boolean
  device: AdDevice
  is_online: boolean
  current_content: AdContent | null
}

interface AdStats {
  ok: boolean
  total_plays: number
  completed_plays: number
  avg_duration_sec: number
  interrupted_plays: number
  interrupt_rate_percent: number
  active_devices: number
  total_active_content: number
}

// ==================== API helpers ====================

const API_BASE = '/api/ad-machine'

async function apiListContents(status?: string): Promise<AdContent[]> {
  const url = status ? `${API_BASE}/contents?status=${status}` : `${API_BASE}/contents`
  const res = await fetch(url)
  const data = await res.json()
  return data.items ?? []
}

async function apiCreateContent(payload: Partial<AdContent>): Promise<AdContent> {
  const res = await fetch(`${API_BASE}/contents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  return data.item
}

async function apiUpdateContent(id: string, payload: Partial<AdContent>): Promise<AdContent> {
  const res = await fetch(`${API_BASE}/contents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  return data.item
}

async function apiDeleteContent(id: string): Promise<void> {
  await fetch(`${API_BASE}/contents/${id}`, { method: 'DELETE' })
}

async function apiListSchedules(contentId?: string): Promise<AdSchedule[]> {
  const url = contentId
    ? `${API_BASE}/schedules?content_id=${contentId}`
    : `${API_BASE}/schedules`
  const res = await fetch(url)
  const data = await res.json()
  return data.items ?? []
}

async function apiCreateSchedule(payload: Partial<AdSchedule>): Promise<AdSchedule> {
  const res = await fetch(`${API_BASE}/contents/${payload.content_id}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  return data.item
}

async function apiDeleteSchedule(id: string): Promise<void> {
  await fetch(`${API_BASE}/schedules/${id}`, { method: 'DELETE' })
}

async function apiListDevices(): Promise<AdDevice[]> {
  const res = await fetch(`${API_BASE}/devices`)
  const data = await res.json()
  return data.items ?? []
}

async function apiGetDeviceStatus(deviceId: string): Promise<DeviceStatusResponse> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/status`)
  return res.json()
}

async function apiGetStats(): Promise<AdStats> {
  const res = await fetch(`${API_BASE}/stats`)
  return res.json()
}

// ==================== Sub-components ====================

function StatusBadge({ status }: { status: ContentStatus | DeviceStatus }) {
  const map: Record<string, { color: string; icon: typeof CheckCircle }> = {
    active: { color: '#16a34a', icon: CheckCircle },
    inactive: { color: '#d97706', icon: Pause },
    archived: { color: '#9ca3af', icon: Trash2 },
    online: { color: '#16a34a', icon: Wifi },
    offline: { color: '#dc2626', icon: WifiOff },
  }
  const cfg = map[status] ?? { color: '#6b7280', icon: Eye }
  const Icon = cfg.icon
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: cfg.color, fontSize: 13 }}>
      <Icon size={13} />
      {status}
    </span>
  )
}

function ScreenBadge({ status }: { status: ScreenStatus }) {
  const color = status === 'on' ? '#16a34a' : status === 'error' ? '#dc2626' : '#d97706'
  const icon = status === 'on' ? Monitor : status === 'error' ? XCircle : MonitorOff
  const Icon = icon
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color, fontSize: 12 }}>
      <Icon size={12} />
      {status}
    </span>
  )
}

// ==================== Content List Section ====================

interface ContentSectionProps {
  contents: AdContent[]
  loading: boolean
  onRefresh: () => void
  onEdit: (c: AdContent) => void
  onDelete: (id: string) => void
  onSchedule: (c: AdContent) => void
}

function ContentSection({ contents, loading, onRefresh, onEdit, onDelete, onSchedule }: ContentSectionProps) {
  const [filter, setFilter] = useState<ContentStatus | 'all'>('all')

  const filtered = filter === 'all' ? contents : contents.filter(c => c.status === filter)

  return (
    <div className="ad-machine-section">
      <div className="section-header">
        <h3>📺 广告素材管理</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={filter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value as ContentStatus | 'all')}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            <option value="all">全部状态</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="archived">archived</option>
          </select>
          <button type="button" onClick={onRefresh} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <div className="section-loading">加载中...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ad-machine-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>类型</th>
                <th>时长(秒)</th>
                <th>优先级</th>
                <th>有效期</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af' }}>暂无数据</td></tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>{c.media_type}</td>
                    <td>{c.duration_sec}s</td>
                    <td>{c.priority}</td>
                    <td>{c.valid_from || '—'} ~ {c.valid_to || '—'}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" onClick={() => onEdit(c)} title="编辑" style={{ padding: '2px 6px' }}>
                          <Edit2 size={12} />
                        </button>
                        <button type="button" onClick={() => onSchedule(c)} title="排期" style={{ padding: '2px 6px' }}>
                          <Clock size={12} />
                        </button>
                        <button type="button" onClick={() => onDelete(c.id)} title="删除" style={{ padding: '2px 6px', color: '#dc2626' }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ==================== Content Form Modal ====================

interface ContentFormProps {
  content?: AdContent | null
  onSave: (payload: Partial<AdContent>) => void
  onCancel: () => void
}

function ContentForm({ content, onSave, onCancel }: ContentFormProps) {
  const [title, setTitle] = useState(content?.title ?? '')
  const [mediaUrl, setMediaUrl] = useState(content?.media_url ?? '')
  const [mediaType, setMediaType] = useState<MediaType>(content?.media_type ?? 'image')
  const [durationSec, setDurationSec] = useState(content?.duration_sec ?? 30)
  const [priority, setPriority] = useState(content?.priority ?? 50)
  const [validFrom, setValidFrom] = useState(content?.valid_from ?? '')
  const [validTo, setValidTo] = useState(content?.valid_to ?? '')
  const [status, setStatus] = useState<ContentStatus>(content?.status ?? 'active')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      title,
      media_url: mediaUrl,
      media_type: mediaType,
      duration_sec: durationSec,
      priority,
      valid_from: validFrom,
      valid_to: validTo,
      status,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>{content ? '✏️ 编辑广告素材' : '➕ 新增广告素材'}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>标题 *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
          </div>
          <div className="form-group">
            <label>媒体URL *</label>
            <input type="url" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>类型</label>
              <select value={mediaType} onChange={e => setMediaType(e.target.value as MediaType)}>
                <option value="image">图片</option>
                <option value="video">视频</option>
              </select>
            </div>
            <div className="form-group">
              <label>播放时长(秒)</label>
              <input type="number" value={durationSec} min={1} max={86400}
                onChange={e => setDurationSec(parseInt(e.target.value) || 30)} />
            </div>
            <div className="form-group">
              <label>优先级(1-100)</label>
              <input type="number" value={priority} min={1} max={100}
                onChange={e => setPriority(parseInt(e.target.value) || 50)} />
            </div>
            <div className="form-group">
              <label>状态</label>
              <select value={status} onChange={e => setStatus(e.target.value as ContentStatus)}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="archived">archived</option>
              </select>
            </div>
            <div className="form-group">
              <label>生效开始</label>
              <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label>生效结束</label>
              <input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={onCancel}>取消</button>
            <button type="submit" style={{ background: '#16a34a', color: '#fff' }}>
              {content ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ==================== Schedule Section ====================

interface ScheduleSectionProps {
  schedules: AdSchedule[]
  contents: AdContent[]
  loading: boolean
  onRefresh: () => void
  onDelete: (id: string) => void
}

function ScheduleSection({ schedules, contents, loading, onRefresh, onDelete }: ScheduleSectionProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const contentMap = new Map(contents.map(c => [c.id, c]))

  const filteredSchedules = schedules.filter(s => {
    if (!s.repeat_rule) return true
    if (s.repeat_rule === 'daily') return true
    if (s.repeat_rule === 'weekdays') {
      const dow = new Date(selectedDate).getDay()
      return dow >= 1 && dow <= 5
    }
    return s.repeat_rule === selectedDate
  })

  return (
    <div className="ad-machine-section">
      <div className="section-header">
        <h3>📅 广告排期管理</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }} />
          <button type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <div className="section-loading">加载中...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ad-machine-table">
            <thead>
              <tr>
                <th>广告标题</th>
                <th>门店</th>
                <th>时段</th>
                <th>重复规则</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchedules.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af' }}>暂无排期</td></tr>
              ) : (
                filteredSchedules.map(s => {
                  const content = contentMap.get(s.content_id)
                  return (
                    <tr key={s.id}>
                      <td>{content?.title ?? s.content_id}</td>
                      <td>{s.shop_id}</td>
                      <td>{s.start_time} ~ {s.end_time}</td>
                      <td>{s.repeat_rule || '一次性'}</td>
                      <td><StatusBadge status={s.status as ContentStatus} /></td>
                      <td>
                        <button type="button" onClick={() => onDelete(s.id)} style={{ padding: '2px 6px', color: '#dc2626' }}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ==================== Schedule Form Modal ====================

interface ScheduleFormProps {
  content: AdContent
  onSave: (payload: Partial<AdSchedule>) => void
  onCancel: () => void
}

function ScheduleForm({ content, onSave, onCancel }: ScheduleFormProps) {
  const [shopId, setShopId] = useState('LENOVO-SR-001')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('21:00')
  const [repeatRule, setRepeatRule] = useState('daily')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      content_id: content.id,
      shop_id: shopId,
      start_time: startTime,
      end_time: endTime,
      repeat_rule: repeatRule,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>🗓️ 为「{content.title}」创建排期</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>门店ID</label>
            <input type="text" value={shopId} onChange={e => setShopId(e.target.value)} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>开始时间</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>结束时间</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label>重复规则</label>
            <select value={repeatRule} onChange={e => setRepeatRule(e.target.value)}>
              <option value="">一次性</option>
              <option value="daily">每天</option>
              <option value="weekdays">工作日</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={onCancel}>取消</button>
            <button type="submit" style={{ background: '#16a34a', color: '#fff' }}>创建排期</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ==================== Device Monitor Grid ====================

interface DeviceGridProps {
  devices: AdDevice[]
  loading: boolean
  onRefresh: () => void
}

function DeviceGrid({ devices, loading, onRefresh }: DeviceGridProps) {
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, DeviceStatusResponse>>({})
  const [loadingStatuses, setLoadingStatuses] = useState<Set<string>>(new Set())

  const loadStatus = useCallback(async (deviceId: string) => {
    setLoadingStatuses(prev => new Set(prev).add(deviceId))
    try {
      const status = await apiGetDeviceStatus(deviceId)
      setDeviceStatuses(prev => ({ ...prev, [deviceId]: status }))
    } finally {
      setLoadingStatuses(prev => {
        const next = new Set(prev)
        next.delete(deviceId)
        return next
      })
    }
  }, [])

  useEffect(() => {
    devices.forEach(d => {
      if (!deviceStatuses[d.device_id]) {
        loadStatus(d.device_id)
      }
    })
  }, [devices, deviceStatuses, loadStatus])

  return (
    <div className="ad-machine-section">
      <div className="section-header">
        <h3>🖥️ 广告机设备监控</h3>
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          刷新
        </button>
      </div>

      {loading ? (
        <div className="section-loading">加载中...</div>
      ) : devices.length === 0 ? (
        <div style={{ color: '#9ca3af', textAlign: 'center', padding: 24 }}>暂无注册设备</div>
      ) : (
        <div className="device-grid">
          {devices.map(d => {
            const statusInfo = deviceStatuses[d.device_id]
            const isLoading = loadingStatuses.has(d.device_id)
            const isOnline = statusInfo?.is_online ?? false
            const currentContent = statusInfo?.current_content

            return (
              <div key={d.id} className={`device-card ${isOnline ? 'device-online' : 'device-offline'}`}>
                <div className="device-card-header">
                  <span className="device-name">{d.name}</span>
                  <StatusBadge status={isOnline ? 'online' : 'offline'} />
                </div>
                <div className="device-card-body">
                  <div className="device-meta">
                    <span>设备ID: {d.device_id.slice(0, 12)}...</span>
                    <span>门店: {d.shop_id}</span>
                  </div>
                  <div className="device-content">
                    {currentContent ? (
                      <>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>正在播放:</span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{currentContent.title}</span>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>
                          {currentContent.media_type} · {currentContent.duration_sec}s
                        </span>
                      </>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 13 }}>暂无播放内容</span>
                    )}
                  </div>
                  <div className="device-footer">
                    <ScreenBadge status={d.screen_status as ScreenStatus} />
                    {isLoading ? (
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>加载中...</span>
                    ) : statusInfo ? (
                      <button
                        type="button"
                        onClick={() => loadStatus(d.device_id)}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                      >
                        <RefreshCw size={10} /> 刷新
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ==================== Stats Section ====================

interface StatsSectionProps {
  stats: AdStats | null
  loading: boolean
  onRefresh: () => void
}

function StatsSection({ stats, loading, onRefresh }: StatsSectionProps) {
  if (!stats && !loading) {
    return (
      <div className="ad-machine-section">
        <div className="section-header">
          <h3>📊 播放统计</h3>
          <button type="button" onClick={onRefresh}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
        <div style={{ color: '#9ca3af', textAlign: 'center', padding: 24 }}>暂无统计数据</div>
      </div>
    )
  }

  const s = stats!

  const cards = [
    { label: '总播放次数', value: s.total_plays, icon: Play, color: '#3b82f6' },
    { label: '完成播放', value: s.completed_plays, icon: CheckCircle, color: '#16a34a' },
    { label: '平均时长', value: s.avg_duration_sec ? `${s.avg_duration_sec}s` : '—', icon: Clock, color: '#8b5cf6' },
    { label: '异常中断', value: s.interrupted_plays, icon: Pause, color: '#d97706' },
    { label: '中断率', value: `${s.interrupt_rate_percent}%`, icon: XCircle, color: s.interrupt_rate_percent > 10 ? '#dc2626' : '#16a34a' },
    { label: '在线设备', value: s.active_devices, icon: Wifi, color: '#3b82f6' },
    { label: '活跃素材', value: s.total_active_content, icon: Eye, color: '#8b5cf6' },
  ]

  return (
    <div className="ad-machine-section">
      <div className="section-header">
        <h3>📊 播放统计</h3>
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          刷新
        </button>
      </div>
      <div className="stats-grid">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="stat-card" style={{ borderTopColor: card.color }}>
              <Icon size={20} style={{ color: card.color }} />
              <div className="stat-value" style={{ color: card.color }}>{loading ? '...' : card.value}</div>
              <div className="stat-label">{card.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ==================== Main Component ====================

export function AdMachineManager() {
  const [contents, setContents] = useState<AdContent[]>([])
  const [schedules, setSchedules] = useState<AdSchedule[]>([])
  const [devices, setDevices] = useState<AdDevice[]>([])
  const [stats, setStats] = useState<AdStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)

  // Modal state
  const [showContentForm, setShowContentForm] = useState(false)
  const [editingContent, setEditingContent] = useState<AdContent | null>(null)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [schedulingContent, setSchedulingContent] = useState<AdContent | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [c, s, d] = await Promise.all([
        apiListContents(),
        apiListSchedules(),
        apiListDevices(),
      ])
      setContents(c)
      setSchedules(s)
      setDevices(d)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStats = useCallback(async () => {
    setLoadingStats(true)
    try {
      const s = await apiGetStats()
      setStats(s)
    } finally {
      setLoadingStats(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
    loadStats()
  }, [loadAll, loadStats])

  const handleSaveContent = async (payload: Partial<AdContent>) => {
    if (editingContent) {
      await apiUpdateContent(editingContent.id, payload)
    } else {
      await apiCreateContent(payload)
    }
    setShowContentForm(false)
    setEditingContent(null)
    await loadAll()
  }

  const handleDeleteContent = async (id: string) => {
    if (!confirm('确认删除此广告素材？')) return
    await apiDeleteContent(id)
    await loadAll()
  }

  const handleSaveSchedule = async (payload: Partial<AdSchedule>) => {
    await apiCreateSchedule(payload)
    setShowScheduleForm(false)
    setSchedulingContent(null)
    await loadAll()
  }

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('确认删除此排期？')) return
    await apiDeleteSchedule(id)
    await loadAll()
  }

  const handleEdit = (c: AdContent) => {
    setEditingContent(c)
    setShowContentForm(true)
  }

  const handleSchedule = (c: AdContent) => {
    setSchedulingContent(c)
    setShowScheduleForm(true)
  }

  return (
    <div className="ad-machine-manager">
      {/* Stats always visible at top */}
      <StatsSection stats={stats} loading={loadingStats} onRefresh={loadStats} />

      {/* Content list */}
      <ContentSection
        contents={contents}
        loading={loading}
        onRefresh={loadAll}
        onEdit={handleEdit}
        onDelete={handleDeleteContent}
        onSchedule={handleSchedule}
      />

      {/* Schedule list */}
      <ScheduleSection
        schedules={schedules}
        contents={contents}
        loading={loading}
        onRefresh={loadAll}
        onDelete={handleDeleteSchedule}
      />

      {/* Device grid */}
      <DeviceGrid devices={devices} loading={loading} onRefresh={loadAll} />

      {/* Floating add button */}
      <button
        type="button"
        className="fab-add"
        onClick={() => { setEditingContent(null); setShowContentForm(true) }}
        title="新增广告素材"
      >
        <Plus size={24} />
      </button>

      {/* Content form modal */}
      {showContentForm && (
        <ContentForm
          content={editingContent}
          onSave={handleSaveContent}
          onCancel={() => { setShowContentForm(false); setEditingContent(null) }}
        />
      )}

      {/* Schedule form modal */}
      {showScheduleForm && schedulingContent && (
        <ScheduleForm
          content={schedulingContent}
          onSave={handleSaveSchedule}
          onCancel={() => { setShowScheduleForm(false); setSchedulingContent(null) }}
        />
      )}

      <style>{`
        .ad-machine-manager {
          padding: 16px;
          position: relative;
        }
        .ad-machine-section {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 16px;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .section-header h3 {
          margin: 0;
          font-size: 15px;
        }
        .section-loading {
          text-align: center;
          color: #9ca3af;
          padding: 24px;
        }
        .ad-machine-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .ad-machine-table th {
          text-align: left;
          padding: 8px 12px;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
          font-weight: 600;
          color: #374151;
          white-space: nowrap;
        }
        .ad-machine-table td {
          padding: 8px 12px;
          border-bottom: 1px solid #f3f4f6;
          color: #374151;
        }
        .ad-machine-table tr:last-child td {
          border-bottom: none;
        }
        .ad-machine-table tr:hover td {
          background: #f9fafb;
        }
        .ad-machine-table button {
          background: none;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          cursor: pointer;
          padding: 3px 8px;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          color: #374151;
          font-size: 12px;
        }
        .ad-machine-table button:hover {
          background: #f3f4f6;
        }
        .device-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 12px;
        }
        .device-card {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 12px;
          border-top: 3px solid #9ca3af;
        }
        .device-card.device-online {
          border-top-color: #16a34a;
        }
        .device-card.device-offline {
          border-top-color: #dc2626;
        }
        .device-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .device-name {
          font-weight: 600;
          font-size: 14px;
        }
        .device-meta {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 11px;
          color: #6b7280;
          margin-bottom: 8px;
        }
        .device-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 8px;
          padding: 8px;
          background: #f9fafb;
          border-radius: 6px;
        }
        .device-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .device-footer button {
          background: none;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 12px;
        }
        .stat-card {
          border-top: 3px solid #3b82f6;
          border-radius: 8px;
          padding: 12px;
          text-align: center;
          background: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .stat-value {
          font-size: 24px;
          font-weight: 700;
        }
        .stat-label {
          font-size: 12px;
          color: #6b7280;
        }
        .fab-add {
          position: fixed;
          bottom: 32px;
          right: 32px;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: #3b82f6;
          color: #fff;
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(59,130,246,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }
        .fab-add:hover {
          background: #2563eb;
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-content {
          background: #fff;
          border-radius: 12px;
          padding: 20px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 12px;
        }
        .form-group label {
          font-size: 12px;
          font-weight: 600;
          color: #374151;
        }
        .form-group input, .form-group select {
          padding: 6px 10px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 13px;
        }
        form button[type="submit"] {
          padding: 6px 16px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        form button[type="button"] {
          padding: 6px 16px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          cursor: pointer;
          background: #fff;
          font-size: 13px;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
