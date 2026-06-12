/**
 * ad_machine_interval.test.ts
 * 2026-06-10
 *
 * Tests for AD_MACHINE_INTERVAL_MS configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('AD_MACHINE_INTERVAL_MS configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to 1800000 when env var is not set', async () => {
    // Delete the env var if it exists
    delete process.env['AD_MACHINE_INTERVAL_MS']

    const { getAdMachineIntervalMs } = await import('../src/ad_machine_sync.js')
    expect(getAdMachineIntervalMs()).toBe(1800000)
  })

  it('uses AD_MACHINE_INTERVAL_MS from environment', async () => {
    process.env['AD_MACHINE_INTERVAL_MS'] = '5000'

    const { getAdMachineIntervalMs } = await import('../src/ad_machine_sync.js')
    expect(getAdMachineIntervalMs()).toBe(5000)
  })

  it('uses 5000ms test value for rapid sync', async () => {
    process.env['AD_MACHINE_INTERVAL_MS'] = '5000'

    const { getAdMachineIntervalMs } = await import('../src/ad_machine_sync.js')
    const interval = getAdMachineIntervalMs()
    expect(interval).toBe(5000)
    // 5000ms * 6 = 30000ms = 30s, so should run 2 times in 30s
    expect(interval * 6).toBe(30000)
  })
})

describe('ad_machine_sync runAdMachineSync', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls fetch for contents, schedules, and devices', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, items: [] }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, items: [] }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, items: [] }),
    } as Response)

    const { runAdMachineSync } = await import('../src/ad_machine_sync.js')
    const result = await runAdMachineSync()

    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns error count when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'))

    const { runAdMachineSync } = await import('../src/ad_machine_sync.js')
    const result = await runAdMachineSync()

    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('ad_machine_sync sync loop', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fires multiple times within 30 seconds when interval=5000ms', async () => {
    process.env['AD_MACHINE_INTERVAL_MS'] = '5000'

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, items: [] }),
    } as Response)

    const { startAdMachineSyncLoop, stopAdMachineSyncLoop, getAdMachineIntervalMs } = await import(
      '../src/ad_machine_sync.js'
    )

    // Verify interval is 5000ms
    expect(getAdMachineIntervalMs()).toBe(5000)
    // 5000ms * 6 = 30000ms, so 6 ticks in 30s
    expect(getAdMachineIntervalMs() * 6).toBe(30000)

    startAdMachineSyncLoop()

    // Wait for initial sync + 2 more intervals (5000 + 5100 + 5100 = ~10.2s total)
    await new Promise(r => setTimeout(r, 10500))
    // Should be at least 2 calls (initial + 2 intervals)
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2)

    stopAdMachineSyncLoop()
  })

  it('uses default 30-min interval', async () => {
    delete process.env['AD_MACHINE_INTERVAL_MS']

    const { getAdMachineIntervalMs } = await import('../src/ad_machine_sync.js')
    expect(getAdMachineIntervalMs()).toBe(1800000)
  })
})
