/**
 * ComplianceCenter.tsx — 合规校验预警中心
 * =============================
 * Phase 1: 前端骨架（静态展示 + 真实 API 数据）
 * Phase 2: 完善交互（实时刷新、趋势图）
 * Phase 3: 端到端截图
 *
 * API 依赖:
 *   GET  /api/compliance/stats        - 统计摘要
 *   GET  /api/compliance/violations   - 违规列表
 *   GET  /api/compliance/rules        - 规则列表
 *   POST /api/compliance/check/run    - 立即扫描
 *   POST /api/compliance/violations/:id/acknowledge
 *   POST /api/compliance/violations/:id/resolve
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Filter,
  Play,
  RefreshCw,
  Shield,
  XCircle,
  AlertCircle,
  Settings,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'critical' | 'high' | 'medium' | 'low'
type ViolationStatus = 'open' | 'acknowledged' | 'resolved'

interface ComplianceStats {
  today_critical: number
  today_high: number
  total_open: number
  total_acknowledged: number
  total_resolved: number
  avg_resolution_hours: number | null
}

interface ComplianceViolation {
  id: string
  rule_id: string
  severity: Severity
  entity_type: string
  entity_id: string
  description: string
  detected_at: string
  status: ViolationStatus
  assigned_to: string
  resolved_at: string
  notes: string
  metadata?: Record<string, unknown>
  metadata_json?: string
}

interface ComplianceRule {
  id: string
  rule_id: string
  name: string
  description: string
  severity: Severity
  entity_type: string
  enabled: boolean
  config: Record<string, unknown>
  config_json?: string
  created_at: string
  updated_at: string
}

interface ViolationListResponse {
  total: number
  items: ComplianceViolation[]
  limit: number
  offset: number
}

interface ScanRunResponse {
  ok: boolean
  scan_run_id: string
  rules_run: number
  violations_found: number
  violations: ComplianceViolation[]
  duration_ms: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/compliance'

async function apiGetStats(): Promise<ComplianceStats> {
  const res = await fetch(`${API_BASE}/stats`)
  if (!res.ok) throw new Error(`stats API error: ${res.status}`)
  return res.json()
}

async function apiListViolations(params: {
  severity?: Severity | ''
  status?: ViolationStatus | ''
  rule_id?: string
  limit?: number
  offset?: number
}): Promise<ViolationListResponse> {
  const sp = new URLSearchParams()
  if (params.severity) sp.set('severity', params.severity)
  if (params.status) sp.set('status', params.status)
  if (params.rule_id) sp.set('rule_id', params.rule_id)
  sp.set('limit', String(params.limit ?? 100))
  sp.set('offset', String(params.offset ?? 0))
  const res = await fetch(`${API_BASE}/violations?${sp}`)
  if (!res.ok) throw new Error(`violations API error: ${res.status}`)
  return res.json()
}

async function apiListRules(): Promise<ComplianceRule[]> {
  const res = await fetch(`${API_BASE}/rules`)
  if (!res.ok) throw new Error(`rules API error: ${res.status}`)
  const data = await res.json()
  return data.rules ?? []
}

async function apiRunScan(ruleId?: string): Promise<ScanRunResponse> {
  const sp = ruleId ? `?rule_id=${ruleId}` : ''
  const res = await fetch(`${API_BASE}/check/run${sp}`, { method: 'POST' })
  if (!res.ok) throw new Error(`scan API error: ${res.status}`)
  return res.json()
}

async function apiAcknowledgeViolation(violationId: string, assignedTo?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/violations/${violationId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assigned_to: assignedTo ?? '' }),
  })
  if (!res.ok) throw new Error(`acknowledge API error: ${res.status}`)
}

async function apiResolveViolation(violationId: string, notes?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/violations/${violationId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: notes ?? '' }),
  })
  if (!res.ok) throw new Error(`resolve API error: ${res.status}`)
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function severityColor(severity: Severity): string {
  return {
    critical: '#dc2626',
    high: '#ea580c',
    medium: '#ca8a04',
    low: '#16a34a',
  }[severity]
}

function severityLabel(severity: Severity): string {
  return {
    critical: '严重',
    high: '高',
    medium: '中',
    low: '低',
  }[severity]
}

function statusColor(status: ViolationStatus): string {
  return {
    open: '#dc2626',
    acknowledged: '#ea580c',
    resolved: '#16a34a',
  }[status]
}

function statusLabel(status: ViolationStatus): string {
  return {
    open: '待处理',
    acknowledged: '已确认',
    resolved: '已解决',
  }[status]
}

function formatDatetime(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  } catch {
    return iso
  }
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    return `${Math.floor(hours / 24)}天前`
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  title: string
  value: number
  icon: React.ReactNode
  color: string
  sub?: string
}

function KpiCard({ title, value, icon, color, sub }: KpiCardProps) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      padding: '20px 24px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      minWidth: 180,
    }}>
      <div style={{ color, fontSize: 28 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#1f2937', lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Severity Badge
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: Severity }) {
  const color = severityColor(severity)
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      color: '#fff',
      background: color,
    }}>
      {severity === 'critical' && <XCircle size={12} />}
      {severity === 'high' && <AlertTriangle size={12} />}
      {severity === 'medium' && <AlertCircle size={12} />}
      {severity === 'low' && <CheckCircle size={12} />}
      {severityLabel(severity)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ComplianceCenter() {
  const [activeTab, setActiveTab] = useState<'violations' | 'rules'>('violations')
  const [stats, setStats] = useState<ComplianceStats | null>(null)
  const [violations, setViolations] = useState<ComplianceViolation[]>([])
  const [rules, setRules] = useState<ComplianceRule[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)

  // 过滤状态
  const [filterSeverity, setFilterSeverity] = useState<Severity | ''>('')
  const [filterStatus, setFilterStatus] = useState<ViolationStatus | ''>('')
  const [filterRuleId, setFilterRuleId] = useState('')

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiGetStats()
      setStats(data)
    } catch (e) {
      console.error('[ComplianceCenter] fetchStats error:', e)
    }
  }, [])

  const fetchViolations = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiListViolations({
        severity: filterSeverity || undefined,
        status: filterStatus || undefined,
        rule_id: filterRuleId || undefined,
        limit: 100,
        offset: 0,
      })
      setViolations(data.items)
      setTotal(data.total)
    } catch (e) {
      console.error('[ComplianceCenter] fetchViolations error:', e)
    } finally {
      setLoading(false)
    }
  }, [filterSeverity, filterStatus, filterRuleId])

  const fetchRules = useCallback(async () => {
    try {
      const data = await apiListRules()
      setRules(data)
    } catch (e) {
      console.error('[ComplianceCenter] fetchRules error:', e)
    }
  }, [])

  const handleRunScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await apiRunScan()
      setLastScan(new Date().toLocaleTimeString('zh-CN'))
      await fetchStats()
      await fetchViolations()
      console.log('[ComplianceCenter] scan result:', result)
    } catch (e) {
      console.error('[ComplianceCenter] scan error:', e)
    } finally {
      setScanning(false)
    }
  }, [fetchStats, fetchViolations])

  const handleAcknowledge = useCallback(async (id: string) => {
    try {
      await apiAcknowledgeViolation(id)
      await fetchViolations()
      await fetchStats()
    } catch (e) {
      console.error('[ComplianceCenter] acknowledge error:', e)
    }
  }, [fetchViolations, fetchStats])

  const handleResolve = useCallback(async (id: string) => {
    try {
      await apiResolveViolation(id)
      await fetchViolations()
      await fetchStats()
    } catch (e) {
      console.error('[ComplianceCenter] resolve error:', e)
    }
  }, [fetchViolations, fetchStats])

  // 初始化加载
  useEffect(() => {
    fetchStats()
    fetchViolations()
    fetchRules()
  }, [fetchStats, fetchViolations, fetchRules])

  // 过滤变化时重新加载
  useEffect(() => {
    fetchViolations()
  }, [fetchViolations])

  // ---------------------------------------------------------------------------
  // Render: KPI Row
  // ---------------------------------------------------------------------------

  const kpiRow = stats ? (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      <KpiCard
        title="今日新增严重"
        value={stats.today_critical}
        icon={<XCircle size={28} />}
        color="#dc2626"
        sub="critical"
      />
      <KpiCard
        title="今日新增高"
        value={stats.today_high}
        icon={<AlertTriangle size={28} />}
        color="#ea580c"
        sub="high"
      />
      <KpiCard
        title="待处理总数"
        value={stats.total_open}
        icon={<Clock size={28} />}
        color="#d97706"
        sub="open"
      />
      <KpiCard
        title="已确认"
        value={stats.total_acknowledged}
        icon={<AlertCircle size={28} />}
        color="#2563eb"
        sub="acknowledged"
      />
      <KpiCard
        title="已解决"
        value={stats.total_resolved}
        icon={<CheckCircle size={28} />}
        color="#16a34a"
        sub={stats.avg_resolution_hours != null ? `平均${stats.avg_resolution_hours.toFixed(1)}h` : ''}
      />
    </div>
  ) : (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{
          background: '#f3f4f6',
          borderRadius: 12,
          padding: '20px 24px',
          minWidth: 180,
          height: 80,
        }} />
      ))}
    </div>
  )

  // ---------------------------------------------------------------------------
  // Render: Violations Table
  // ---------------------------------------------------------------------------

  const violationsTab = (
    <div>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}>
        <button
          onClick={handleRunScan}
          disabled={scanning}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: scanning ? '#9ca3af' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: scanning ? 'not-allowed' : 'pointer',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {scanning ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
          {scanning ? '扫描中…' : '立即扫描'}
        </button>
        {lastScan && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            上次扫描: {lastScan}
          </span>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <Filter size={14} color="#6b7280" />
          <select
            value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value as Severity | '')}
            style={selectStyle}
          >
            <option value="">全部严重等级</option>
            <option value="critical">严重</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as ViolationStatus | '')}
            style={selectStyle}
          >
            <option value="">全部状态</option>
            <option value="open">待处理</option>
            <option value="acknowledged">已确认</option>
            <option value="resolved">已解决</option>
          </select>
          <select
            value={filterRuleId}
            onChange={e => setFilterRuleId(e.target.value)}
            style={selectStyle}
          >
            <option value="">全部规则</option>
            {rules.map(r => (
              <option key={r.rule_id} value={r.rule_id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              {['严重', '规则', '实体类型', '实体ID', '描述', '检测时间', '状态', '操作'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                  加载中…
                </td>
              </tr>
            ) : violations.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                  <Shield size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                  <div>暂无违规记录</div>
                </td>
              </tr>
            ) : (
              violations.map((v, idx) => (
                <tr
                  key={v.id}
                  style={{ borderBottom: idx < violations.length - 1 ? '1px solid #f3f4f6' : 'none' }}
                >
                  <td style={{ padding: '10px 12px' }}>
                    <SeverityBadge severity={v.severity} />
                  </td>
                  <td style={{ padding: '10px 12px', color: '#374151', maxWidth: 160 }}>
                    {rules.find(r => r.rule_id === v.rule_id)?.name ?? v.rule_id}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#6b7280' }}>{v.entity_type}</td>
                  <td style={{ padding: '10px 12px', color: '#2563eb', fontFamily: 'monospace', fontSize: 12 }}>
                    {v.entity_id.length > 20 ? v.entity_id.slice(0, 20) + '…' : v.entity_id}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#374151', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={v.description}>
                    {v.description}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {timeAgo(v.detected_at)}
                    <div style={{ fontSize: 11, color: '#d1d5db' }}>{formatDatetime(v.detected_at).split(' ')[1] ?? ''}</div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#fff',
                      background: statusColor(v.status),
                    }}>
                      {statusLabel(v.status)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                    {v.status === 'open' && (
                      <button
                        onClick={() => handleAcknowledge(v.id)}
                        style={actionBtnStyle('#2563eb')}
                      >
                        确认
                      </button>
                    )}
                    {v.status !== 'resolved' && (
                      <button
                        onClick={() => handleResolve(v.id)}
                        style={{ ...actionBtnStyle('#16a34a'), marginLeft: 6 }}
                      >
                        解决
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination hint */}
        {total > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
            共 {total} 条记录
          </div>
        )}
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Render: Rules Management
  // ---------------------------------------------------------------------------

  const rulesTab = (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            {['规则ID', '规则名', '严重等级', '实体类型', '启用状态', '描述'].map(h => (
              <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                暂无规则数据
              </td>
            </tr>
          ) : (
            rules.map((r, idx) => (
              <tr
                key={r.id}
                style={{ borderBottom: idx < rules.length - 1 ? '1px solid #f3f4f6' : 'none' }}
              >
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                  {r.rule_id}
                </td>
                <td style={{ padding: '10px 12px', color: '#1f2937', fontWeight: 500 }}>{r.name}</td>
                <td style={{ padding: '10px 12px' }}>
                  <SeverityBadge severity={r.severity} />
                </td>
                <td style={{ padding: '10px 12px', color: '#6b7280' }}>{r.entity_type}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 12,
                    color: '#fff',
                    background: r.enabled ? '#16a34a' : '#9ca3af',
                  }}>
                    {r.enabled ? '启用' : '禁用'}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: '#6b7280', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={r.description}>
                  {r.description}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Render: Main
  // ---------------------------------------------------------------------------

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Shield size={28} color="#2563eb" />
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1f2937' }}>
            合规校验预警中心
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            联想智慧零售 · 库存/价格/SN/采购合规检测
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      {kpiRow}

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 20,
        borderBottom: '2px solid #e5e7eb',
      }}>
        {[
          { key: 'violations' as const, label: '违规记录', icon: <AlertTriangle size={14} /> },
          { key: 'rules' as const, label: '规则管理', icon: <Settings size={14} /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              color: activeTab === tab.key ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -2,
              transition: 'all 0.2s',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'violations' ? violationsTab : rulesTab}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  color: '#374151',
  background: '#fff',
  cursor: 'pointer',
}

const actionBtnStyle = (color: string): React.CSSProperties => ({
  padding: '3px 10px',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  color: '#fff',
  background: color,
  cursor: 'pointer',
})

// Needed for TypeScript
import type React from 'react'
