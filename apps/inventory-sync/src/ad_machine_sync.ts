/**
 * 广告机内容同步模块
 * 2026-06-10
 *
 * 从云端/本地数据库拉取广告素材，推送到广告机。
 * interval 可通过环境变量 AD_MACHINE_INTERVAL_MS 配置。
 *
 * Default:  1800000 ms (30 minutes)
 * Test:    5000 ms (AD_MACHINE_INTERVAL_MS=5000)
 */

import type { AdContent, AdSchedule, AdDevice } from './ad_machine_types.js'

// ==================== Interval Config ====================

const AD_MACHINE_INTERVAL_MS = parseInt(
  process.env['AD_MACHINE_INTERVAL_MS'] ?? '1800000',
  10,
)

const AD_MACHINE_API_BASE =
  process.env['AD_MACHINE_API_BASE'] ?? 'http://127.0.0.1:8000/api/ad-machine'

// ==================== Types ====================

export interface SyncResult {
  ok: boolean
  timestamp: string
  contentsCount: number
  schedulesCount: number
  devicesCount: number
  errors: string[]
}

export interface AdMachineSyncState {
  lastSyncAt: string | null
  lastResult: SyncResult | null
  intervalMs: number
}

// ==================== State ====================

let _syncState: AdMachineSyncState = {
  lastSyncAt: null,
  lastResult: null,
  intervalMs: AD_MACHINE_INTERVAL_MS,
}

let _timerHandle: ReturnType<typeof setInterval> | null = null

// ==================== API calls ====================

async function fetchContents(): Promise<AdContent[]> {
  const res = await fetch(`${AD_MACHINE_API_BASE}/contents`)
  if (!res.ok) throw new Error(`fetchContents failed: ${res.status}`)
  const data = await res.json() as { items: AdContent[] }
  return data.items ?? []
}

async function fetchSchedules(): Promise<AdSchedule[]> {
  const res = await fetch(`${AD_MACHINE_API_BASE}/schedules`)
  if (!res.ok) throw new Error(`fetchSchedules failed: ${res.status}`)
  const data = await res.json() as { items: AdSchedule[] }
  return data.items ?? []
}

async function fetchDevices(): Promise<AdDevice[]> {
  const res = await fetch(`${AD_MACHINE_API_BASE}/devices`)
  if (!res.ok) throw new Error(`fetchDevices failed: ${res.status}`)
  const data = await res.json() as { items: AdDevice[] }
  return data.items ?? []
}

// ==================== Core sync logic ====================

export async function runAdMachineSync(): Promise<SyncResult> {
  const timestamp = new Date().toISOString()
  const errors: string[] = []

  let contentsCount = 0
  let schedulesCount = 0
  let devicesCount = 0

  try {
    const [contents, schedules, devices] = await Promise.all([
      fetchContents(),
      fetchSchedules(),
      fetchDevices(),
    ])

    contentsCount = contents.length
    schedulesCount = schedules.length
    devicesCount = devices.length

    // TODO: Push content to ad machines based on schedule
    // This is the integration point with the actual ad-machine push logic
    // For now we just collect and log

    console.log(
      `[ad_machine_sync] sync done at ${timestamp}` +
        ` | contents=${contentsCount}` +
        ` | schedules=${schedulesCount}` +
        ` | devices=${devicesCount}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(message)
    console.error(`[ad_machine_sync] sync error: ${message}`)
  }

  const result: SyncResult = {
    ok: errors.length === 0,
    timestamp,
    contentsCount,
    schedulesCount,
    devicesCount,
    errors,
  }

  _syncState = {
    ..._syncState,
    lastSyncAt: timestamp,
    lastResult: result,
  }

  return result
}

// ==================== Interval runner ====================

export function startAdMachineSyncLoop(): void {
  if (_timerHandle !== null) {
    console.warn('[ad_machine_sync] sync loop already running, skipping start')
    return
  }

  console.log(
    `[ad_machine_sync] Starting sync loop with interval=${AD_MACHINE_INTERVAL_MS}ms` +
      ` (env: AD_MACHINE_INTERVAL_MS=${process.env['AD_MACHINE_INTERVAL_MS'] ?? 'not set'})`,
  )

  // Run immediately on start
  runAdMachineSync().catch(err => {
    console.error('[ad_machine_sync] initial sync error:', err)
  })

  _timerHandle = setInterval(() => {
    runAdMachineSync().catch(err => {
      console.error('[ad_machine_sync] interval sync error:', err)
    })
  }, AD_MACHINE_INTERVAL_MS)
}

export function stopAdMachineSyncLoop(): void {
  if (_timerHandle !== null) {
    clearInterval(_timerHandle)
    _timerHandle = null
    console.log('[ad_machine_sync] Sync loop stopped')
  }
}

export function getAdMachineSyncState(): AdMachineSyncState {
  return { ..._syncState }
}

// ==================== Test helpers ====================

/**
 * Returns the configured interval in milliseconds.
 * Useful for test verification.
 */
export function getAdMachineIntervalMs(): number {
  return AD_MACHINE_INTERVAL_MS
}
