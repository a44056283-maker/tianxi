import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTmpArtifactDir, fakeRawText, fakeVisitEvidence } from '../storage/__tests__/grayChannelFixtures.js'
import { getShanghaiDateString } from '../automation/dateUtils.js'

let TMP_ROOT: string
let ARTIFACT_DIR: string
let WEB_DATA_DIR: string
let cleanup: () => void
let todayShanghai: string

beforeEach(() => {
  const tmp = makeTmpArtifactDir()
  TMP_ROOT = tmp.dir
  cleanup = tmp.cleanup
  ARTIFACT_DIR = join(TMP_ROOT, 'artifacts')
  WEB_DATA_DIR = join(TMP_ROOT, 'apps', 'inventory-sync', '..', '..', 'web-cockpit', 'public', 'data')
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  mkdirSync(WEB_DATA_DIR, { recursive: true })
  mkdirSync(join(ARTIFACT_DIR, 'manual'), { recursive: true })

  process.env.LENOVO_RETAIL_ARTIFACT_DIR = ARTIFACT_DIR
  process.env.LENOVO_RETAIL_STORAGE_STATE = join(ARTIFACT_DIR, 'storage-state.json')
  process.env.LENOVO_RETAIL_SESSION_FILE = join(ARTIFACT_DIR, 'zhidiantong-session.json')
  process.env.ZHIDIANTONG_SYNC_STATE_FILE = join(ARTIFACT_DIR, 'zdt-sync-state.json')

  todayShanghai = getShanghaiDateString()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function loadTasksModule() {
  vi.resetModules()
  return await import('../automation/scheduledTasks.js')
}

function writeVisit(articleDate: string) {
  const filePath = join(ARTIFACT_DIR, 'manual', `gray-channel-visible-article-${todayShanghai}.txt`)
  writeFileSync(filePath, fakeVisitEvidence(articleDate), 'utf-8')
  return filePath
}

function writeRaw(quoteDate: string) {
  const filePath = join(ARTIFACT_DIR, 'manual', `gray-wholesale-${todayShanghai}.txt`)
  writeFileSync(filePath, fakeRawText(quoteDate), 'utf-8')
  return filePath
}

function makeBase() {
  return {
    taskName: 'daily-gray-channel-check' as const,
    executedAt: new Date().toISOString(),
    warnings: [] as string[],
    steps: [] as any[],
    frontendRefreshed: false,
    newRecordCount: 0,
    updatedRecordCount: 0,
    unmatchedProductCount: 0,
    executionOutcome: undefined as any,
    manualActionRequired: false,
    blockingReason: undefined as string | undefined,
  }
}

describe('executeGrayChannelCheck 5-branch state machine', () => {
  it('branch 1: visit=today + raw=today -> real_completed', async () => {
    writeVisit(todayShanghai)
    writeRaw(todayShanghai)
    const { executeGrayChannelCheck } = await loadTasksModule()
    const base = makeBase()
    await executeGrayChannelCheck(base, 'daily-gray-channel-check')
    expect(base.executionOutcome).toBe('real_completed')
    expect(base.steps.some((s: any) => s.step === 'prepare_gray_channel_capture_plan')).toBe(true)
    expect(base.steps.some((s: any) => s.step === 'record_gray_channel_visit_evidence')).toBe(true)
    expect(base.steps.some((s: any) => s.step === 'parse_gray_wholesale' && s.status === 'completed')).toBe(true)
  })

  it('branch 2: visit=today + raw<today -> blocked_missing_input', async () => {
    writeVisit(todayShanghai)
    writeRaw('2026-05-01')
    const { executeGrayChannelCheck } = await loadTasksModule()
    const base = makeBase()
    await executeGrayChannelCheck(base, 'daily-gray-channel-check')
    expect(base.executionOutcome).toBe('blocked_missing_input')
    expect(base.manualActionRequired).toBe(true)
  })

  it('branch 3: visit<today + no raw -> executed_not_closed', async () => {
    writeVisit('2026-05-01')
    const { executeGrayChannelCheck } = await loadTasksModule()
    const base = makeBase()
    await executeGrayChannelCheck(base, 'daily-gray-channel-check')
    expect(base.executionOutcome).toBe('executed_not_closed')
  })

  it('branch 4: visit=today + no raw -> blocked_missing_input', async () => {
    writeVisit(todayShanghai)
    const { executeGrayChannelCheck } = await loadTasksModule()
    const base = makeBase()
    await executeGrayChannelCheck(base, 'daily-gray-channel-check')
    expect(base.executionOutcome).toBe('blocked_missing_input')
    expect(base.manualActionRequired).toBe(true)
  })

  it('branch 5: no visit, no raw -> blocked_page_risk', async () => {
    const { executeGrayChannelCheck } = await loadTasksModule()
    const base = makeBase()
    await executeGrayChannelCheck(base, 'daily-gray-channel-check')
    expect(base.executionOutcome).toBe('blocked_page_risk')
    expect(String(base.blockingReason || '')).toContain('入口')
  })
})
