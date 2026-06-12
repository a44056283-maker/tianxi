const stepCopy = {
  analysis: {
    title: '01 任务分析',
    body: '先确认业务目标、证据来源、受保护字段、数据新鲜度和风险边界。缺证据时保持待补，不允许猜测补全。'
  },
  plan: {
    title: '02 实施计划',
    body: '明确本轮只做什么、不做什么、改哪些文件、写入哪些表、验证哪些 API 和前端页面。'
  },
  build: {
    title: '03 开发执行',
    body: '按 raw_data -> parsed_data -> retail_db -> API -> frontend 执行，所有 SN、价格、库存、活动变更必须保留审计链。'
  },
  review: {
    title: '04 自查复核',
    body: '核对功能、数据、业务、性能、商业化五层验收。脚本成功不等于业务完成，页面可见才进入验收。'
  },
  accept: {
    title: '05 验收交付',
    body: '输出完成状态、证据路径、SQL/API/前端检查结果和剩余缺口。未闭环只能标记 executed_not_closed 或 blocked。'
  }
}

const state = {
  modules: [],
  activeModuleId: 'dashboard',
  activeSubpageIdByModule: {},
  liveCache: new Map(),
  deferredInstallPrompt: null
}

const fallbackPayload = {
  generatedAt: '2026-06-02T14:24:00+08:00',
  dataMode: 'governance_sample_fallback',
  isSample: true,
  truthStatement: '当前使用本地兜底样例数据，未接真实门店采集。',
  protectedFields: ['storeRetailPrice', 'inventoryQuantity', 'serialStatus', 'salesAmount', 'purchaseCost'],
  modules: [
    {
      id: 'dashboard',
      name: '经营驾驶舱',
      status: 'fallback_sample',
      submenus: [{ id: 'fallback', name: '兜底页面', endpoint: '' }],
      metrics: [
        { label: '数据状态', value: '本地兜底样例' },
        { label: '证据状态', value: 'not_collected' },
        { label: '终态', value: 'executed_not_closed' }
      ]
    }
  ]
}

function formatGeneratedAt(value) {
  if (!value) return '更新时间待补'
  return `更新时间 ${value.replace('T', ' ').replace('+08:00', '')}`
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('system-state payload is not an object')
  }
  const modules = Array.isArray(payload.modules) ? payload.modules : []
  if (!modules.length) {
    throw new Error('system-state modules is empty')
  }
  const normalizedModules = modules.map((module, index) => ({
    id: String(module.id || `module-${index + 1}`),
    name: String(module.name || `未命名模块 ${index + 1}`),
    status: String(module.status || 'status_missing'),
    apiEndpoints: Array.isArray(module.apiEndpoints) ? module.apiEndpoints.map((item) => String(item)) : [],
    submenus: Array.isArray(module.submenus)
      ? module.submenus.map((item, submenuIndex) => ({
        id: String(item.id || `subpage-${submenuIndex + 1}`),
        name: String(item.name || `子页面 ${submenuIndex + 1}`),
        endpoint: String(item.endpoint || '')
      }))
      : [],
    metrics: Array.isArray(module.metrics)
      ? module.metrics.map((metric) => ({
        label: String(metric.label || '指标'),
        value: String(metric.value ?? '待补')
      }))
      : []
  }))
  return {
    generatedAt: String(payload.generatedAt || ''),
    dataMode: String(payload.dataMode || 'unknown'),
    isSample: Boolean(payload.isSample),
    truthStatement: String(payload.truthStatement || '证据 -> SQL/受控快照 -> API -> 前端可见 -> 五层验收'),
    protectedFields: Array.isArray(payload.protectedFields) ? payload.protectedFields.map((item) => String(item)) : [],
    modules: normalizedModules
  }
}

function resolveApiBase() {
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:8000'
  const host = window.location.hostname || '127.0.0.1'
  return `http://${host}:8000`
}

function apiUrl(endpoint) {
  if (!endpoint) return ''
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint
  return `${resolveApiBase()}${endpoint}`
}

function getCollectionCount(payload) {
  if (!payload || typeof payload !== 'object') return 0
  for (const key of ['items', 'records', 'rows', 'activities', 'heroCards', 'eligibleInventory', 'tasks', 'entries', 'knowledge', 'brands', 'overrides']) {
    if (Array.isArray(payload[key])) return payload[key].length
  }
  if (typeof payload.count === 'number') return payload.count
  if (typeof payload.total === 'number') return payload.total
  if (typeof payload.itemCount === 'number') return payload.itemCount
  return Object.keys(payload).length
}

function pickPreviewRows(payload) {
  if (!payload || typeof payload !== 'object') return []
  for (const key of ['items', 'records', 'rows', 'activities', 'heroCards', 'eligibleInventory', 'tasks', 'entries', 'knowledge', 'brands', 'overrides']) {
    if (Array.isArray(payload[key])) return payload[key].slice(0, 5)
  }
  return Object.entries(payload).slice(0, 5).map(([key, value]) => ({ key, value }))
}

function stringifyPreviewValue(value) {
  if (value === null || value === undefined || value === '') return '待补'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} 项`
  return JSON.stringify(value).slice(0, 80)
}

function pickRowTitle(row) {
  if (!row || typeof row !== 'object') return '记录'
  return stringifyPreviewValue(row.name || row.title || row.product_name || row.productName || row.taskName || row.label || row.id || row.key || row.sku_key || row.skuKey || '记录')
}

function pickRowMeta(row) {
  if (!row || typeof row !== 'object') return ''
  return stringifyPreviewValue(row.status || row.status_name || row.statusName || row.generatedAt || row.updatedAt || row.business_date || row.businessDate || row.endpoint || row.value || '')
}

function setPanelState(message, isError = false) {
  const panel = document.getElementById('liveDataPanel')
  panel.innerHTML = ''
  const text = document.createElement('strong')
  text.className = isError ? 'warn-text' : ''
  text.textContent = message
  panel.appendChild(text)
}

async function fetchLivePayload(endpoint) {
  if (!endpoint) return { ok: false, payload: null, error: '没有绑定 API 端点' }
  const url = apiUrl(endpoint)
  if (state.liveCache.has(url)) return state.liveCache.get(url)
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}commercialTs=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const result = { ok: true, payload, error: '' }
    state.liveCache.set(url, result)
    return result
  } catch (error) {
    return { ok: false, payload: null, error: error.message }
  }
}

async function renderLiveSubpage(module, subpage) {
  const panel = document.getElementById('liveDataPanel')
  setPanelState('正在读取真实 API 数据...')
  const result = await fetchLivePayload(subpage.endpoint)
  panel.innerHTML = ''

  const head = document.createElement('div')
  head.className = 'live-data-head'
  const titleBox = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = subpage.name
  const endpoint = document.createElement('span')
  endpoint.textContent = subpage.endpoint || '未绑定端点'
  titleBox.append(title, endpoint)
  const status = document.createElement('span')
  status.className = result.ok ? '' : 'warn-text'
  status.textContent = result.ok ? 'API 已读取' : `API 读取失败：${result.error}`
  head.append(titleBox, status)
  panel.appendChild(head)

  if (!result.ok) return

  const payload = result.payload
  const summaryGrid = document.createElement('div')
  summaryGrid.className = 'live-summary-grid'
  const summaryItems = [
    ['模块', module.name],
    ['记录数', getCollectionCount(payload)],
    ['数据时间', payload.generatedAt || payload.updatedAt || payload.quoteDate || payload.date || '待补'],
    ['来源', payload.source || payload.dataMode || payload.provenance || 'API']
  ]
  summaryItems.forEach(([labelText, valueText]) => {
    const item = document.createElement('div')
    item.className = 'live-summary'
    const label = document.createElement('span')
    label.textContent = labelText
    const value = document.createElement('strong')
    value.textContent = stringifyPreviewValue(valueText)
    item.append(label, value)
    summaryGrid.appendChild(item)
  })
  panel.appendChild(summaryGrid)

  const rows = pickPreviewRows(payload)
  const list = document.createElement('div')
  list.className = 'live-list'
  rows.forEach((row) => {
    const item = document.createElement('div')
    item.className = 'live-row'
    const title = document.createElement('strong')
    title.textContent = pickRowTitle(row)
    const meta = document.createElement('span')
    meta.textContent = pickRowMeta(row)
    item.append(title, meta)
    list.appendChild(item)
  })
  if (!rows.length) {
    const empty = document.createElement('span')
    empty.textContent = 'API 已返回，但当前没有可预览的列表记录。'
    list.appendChild(empty)
  }
  panel.appendChild(list)
}

function renderSubpages(module) {
  const tabs = document.getElementById('subpageTabs')
  tabs.innerHTML = ''
  const submenus = module.submenus.length ? module.submenus : [{ id: 'default', name: '默认页面', endpoint: module.apiEndpoints[0] || '' }]
  const activeSubpageId = state.activeSubpageIdByModule[module.id] || submenus[0].id
  const activeSubpage = submenus.find((item) => item.id === activeSubpageId) || submenus[0]
  state.activeSubpageIdByModule[module.id] = activeSubpage.id
  submenus.forEach((subpage, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = subpage.id === activeSubpage.id ? 'active' : ''
    button.textContent = `${String(index + 1).padStart(2, '0')} ${subpage.name}`
    button.addEventListener('click', () => {
      state.activeSubpageIdByModule[module.id] = subpage.id
      renderSubpages(module)
    })
    tabs.appendChild(button)
  })
  void renderLiveSubpage(module, activeSubpage)
}

function setActiveModule(moduleId) {
  state.activeModuleId = moduleId
  const active = state.modules.find((item) => item.id === moduleId) || state.modules[0]
  if (!active) return

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.moduleId === moduleId)
  })

  document.getElementById('pageTitle').textContent = active.name
  document.getElementById('activeName').textContent = active.name
  document.getElementById('activeStatus').textContent = active.status
  document.getElementById('activeIndex').textContent = String(state.modules.indexOf(active) + 1).padStart(2, '0')

  const metricGrid = document.getElementById('metricGrid')
  metricGrid.innerHTML = ''
  active.metrics.forEach((metric) => {
    const card = document.createElement('div')
    card.className = 'metric'
    const label = document.createElement('span')
    label.textContent = metric.label
    const value = document.createElement('strong')
    value.textContent = metric.value
    card.append(label, value)
    metricGrid.appendChild(card)
  })
  renderSubpages(active)
}

function renderModules() {
  const nav = document.getElementById('moduleNav')
  nav.innerHTML = ''
  state.modules.forEach((module, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'nav-item'
    button.dataset.moduleId = module.id
    const title = document.createElement('strong')
    title.textContent = `${String(index + 1).padStart(2, '0')} ${module.name}`
    const status = document.createElement('span')
    status.textContent = module.status
    button.append(title, status)
    button.addEventListener('click', () => setActiveModule(module.id))
    nav.appendChild(button)
  })
  setActiveModule(state.activeModuleId)
}

function renderProtectedFields(fields) {
  const target = document.getElementById('protectedFields')
  target.innerHTML = ''
  fields.forEach((field) => {
    const item = document.createElement('span')
    item.textContent = field
    target.appendChild(item)
  })
}

function setStep(stepKey) {
  const copy = stepCopy[stepKey] || stepCopy.analysis
  document.querySelectorAll('.step').forEach((button) => {
    button.classList.toggle('active', button.dataset.step === stepKey)
  })
  const detail = document.getElementById('stepDetail')
  detail.innerHTML = ''
  const title = document.createElement('strong')
  title.textContent = copy.title
  const body = document.createElement('p')
  body.textContent = copy.body
  detail.append(title, body)
}

async function loadState() {
  let payload
  try {
    const response = await fetch('./data/system-state.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`system-state fetch ${response.status}`)
    payload = normalizePayload(await response.json())
  } catch (error) {
    payload = normalizePayload(fallbackPayload)
    payload.truthStatement = `${payload.truthStatement} 原因：${error.message}`
  }
  state.modules = payload.modules
  document.getElementById('dataMode').textContent = payload.dataMode || '数据模式待补'
  document.getElementById('generatedAt').textContent = formatGeneratedAt(payload.generatedAt)
  document.getElementById('truthStatement').textContent = payload.isSample
    ? `示例数据 / 未接真实采集：${payload.truthStatement}`
    : '证据 -> SQL/受控快照 -> API -> 前端可见 -> 五层验收'
  renderModules()
  renderProtectedFields(payload.protectedFields || [])
  setStep('analysis')
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  state.deferredInstallPrompt = event
})

document.getElementById('installButton').addEventListener('click', async () => {
  if (!state.deferredInstallPrompt) {
    alert('当前浏览器未提供安装入口，可使用浏览器菜单添加到桌面。')
    return
  }
  state.deferredInstallPrompt.prompt()
  await state.deferredInstallPrompt.userChoice
  state.deferredInstallPrompt = null
})

document.querySelectorAll('.step').forEach((button) => {
  button.addEventListener('click', () => setStep(button.dataset.step))
})

loadState().catch((error) => {
  document.getElementById('pageTitle').textContent = '数据加载异常'
  const metricGrid = document.getElementById('metricGrid')
  metricGrid.innerHTML = ''
  const card = document.createElement('div')
  card.className = 'metric'
  const label = document.createElement('span')
  label.textContent = '错误'
  const value = document.createElement('strong')
  value.textContent = error.message
  card.append(label, value)
  metricGrid.appendChild(card)
})
