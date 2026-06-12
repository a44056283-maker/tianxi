import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTmpArtifactDir, fakeVisitEvidence } from './__tests__/grayChannelFixtures.js'

let TMP_ROOT: string
let ARTIFACT_DIR: string
let APP_DIR: string
let cleanup: () => void

beforeEach(() => {
  const tmp = makeTmpArtifactDir()
  TMP_ROOT = tmp.dir
  cleanup = tmp.cleanup
  ARTIFACT_DIR = join(TMP_ROOT, 'artifacts')
  APP_DIR = join(TMP_ROOT, 'apps', 'inventory-sync')
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  mkdirSync(join(APP_DIR, '..', '..', 'web-cockpit', 'public', 'data'), { recursive: true })

  process.env.LENOVO_RETAIL_ARTIFACT_DIR = ARTIFACT_DIR
  process.env.LENOVO_RETAIL_STORAGE_STATE = join(ARTIFACT_DIR, 'storage-state.json')
  process.env.LENOVO_RETAIL_SESSION_FILE = join(ARTIFACT_DIR, 'zhidiantong-session.json')
  process.env.ZHIDIANTONG_SYNC_STATE_FILE = join(ARTIFACT_DIR, 'zdt-sync-state.json')

  vi.resetModules()
})

afterEach(() => cleanup())

async function loadCollector() {
  return await import('./grayChannelCollector.js')
}

describe('prepareGrayChannelCapturePlan', () => {
  it('writes capture plan with entry point, button text, and required step list', async () => {
    const { prepareGrayChannelCapturePlan } = await loadCollector()
    const result = await prepareGrayChannelCapturePlan('daily-gray-channel-check')
    expect(existsSync(result.capturePlanPath)).toBe(true)
    const plan = JSON.parse(readFileSync(result.capturePlanPath, 'utf-8'))
    expect(plan.entryPoint).toContain('文件传输助手')
    expect(plan.entryPoint).toContain('公众号页最下面带日期的报价快捷入口')
    expect(plan.steps.length).toBeGreaterThanOrEqual(4)
    const allSteps = plan.steps.join('\n')
    expect(allSteps).toMatch(/访问/)
    expect(allSteps).toMatch(/可见文章日期/)
    expect(allSteps).toMatch(/落盘/)
  })

  it('exposes the 4 file names the operator must land on disk', async () => {
    const { prepareGrayChannelCapturePlan } = await loadCollector()
    const result = await prepareGrayChannelCapturePlan()
    expect(result.rawTextName).toMatch(/^gray-wholesale-/)
    expect(result.screenshotName).toMatch(/^gray-channel-screenshot-/)
    expect(result.visibleArticleName).toMatch(/^gray-channel-visible-article-/)
    expect(result.capturePlanPath).toContain(ARTIFACT_DIR)
  })
})

describe('recordGrayChannelVisitEvidence', () => {
  it('persists visit evidence file with the article date', async () => {
    const { recordGrayChannelVisitEvidence } = await loadCollector()
    const result = await recordGrayChannelVisitEvidence({ latestVisibleArticleDate: '2026-06-08' })
    expect(existsSync(result.evidencePath)).toBe(true)
    const content = readFileSync(result.evidencePath, 'utf-8')
    expect(content).toContain('2026-06-08')
    expect(result.latestVisibleArticleDate).toBe('2026-06-08')
  })

  it('rejects malformed article date strings', async () => {
    const { recordGrayChannelVisitEvidence } = await loadCollector()
    await expect(recordGrayChannelVisitEvidence({ latestVisibleArticleDate: '昨天' }))
      .rejects.toThrow(/article date/)
    await expect(recordGrayChannelVisitEvidence({ latestVisibleArticleDate: '2026/06/08' }))
      .rejects.toThrow(/article date/)
  })
})
