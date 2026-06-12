import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeTmpArtifactDir, fakeRawText, fakeVisitEvidence } from './__tests__/grayChannelFixtures.js'

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

async function loadParser() {
  return await import('./grayWholesaleQuoteParser.js')
}

describe('saveGrayWholesaleSnapshotFromText visit-evidence guard', () => {
  it('refuses to write snapshot when visit evidence path is provided but does not exist', async () => {
    const { saveGrayWholesaleSnapshotFromText } = await loadParser()
    await expect(
      saveGrayWholesaleSnapshotFromText(fakeRawText('2026-06-08'), {
        visitEvidencePath: '/nonexistent/gray-channel-visible-article-2026-06-08.txt',
        sourceFile: 'gray-wholesale-2026-06-08.txt',
      })
    ).rejects.toThrow(/visit evidence/i)
  })

  it('accepts visit evidence when it exists and writes evidenceChain to snapshot', async () => {
    const evidencePath = join(ARTIFACT_DIR, 'gray-channel-visible-article-2026-06-08.txt')
    writeFileSync(evidencePath, fakeVisitEvidence('2026-06-08'), 'utf-8')
    const { saveGrayWholesaleSnapshotFromText } = await loadParser()
    const result = await saveGrayWholesaleSnapshotFromText(fakeRawText('2026-06-08'), {
      visitEvidencePath: evidencePath,
      sourceFile: 'gray-wholesale-2026-06-08.txt',
    })
    expect(existsSync(result.artifactPath)).toBe(true)
    const snap = JSON.parse(readFileSync(result.artifactPath, 'utf-8'))
    expect(snap.evidenceChain).toBeDefined()
    expect(snap.evidenceChain.visitEvidencePath).toBe(evidencePath)
    expect(snap.isCarriedForward).toBe(false)
  })
})
