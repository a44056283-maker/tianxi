/**
 * Education subsidy cap audit.
 * Per docs/ai-context/00_LOADED_RULES.md C.1 + 02_DECISIONS.md 笔记本教补封顶 500:
 *   - 笔记本 (游戏本/轻薄本/台式/一体机) SKUs: educationDiscountAmount 必须 <= 500
 *   - 非笔记本 (平板/手机/配件/显示器等) SKUs: educationDiscountAmount 必须 == 0
 *
 * Returns violations list. Empty = pass.
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

type Violation = {
  skuKey: string
  category: string
  sourceCategory: string
  productName: string
  field: 'educationDiscountAmount'
  rule: 'notebook_cap_500' | 'non_notebook_must_be_zero' | 'active_source_missing_in_projection' | 'projection_has_ed_but_source_expired'
  amount: number
  cap?: number
  sourceValidFrom?: string
  sourceValidTo?: string
  sourceActivityId?: string
}

function todayIsoDate(): string {
  const d = new Date()
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tz).toISOString().slice(0, 10)
}

function isWithinWindow(validFrom: string | undefined, validTo: string | undefined, today: string): boolean {
  if (!validFrom || !validTo) return false
  return validFrom.slice(0, 10) <= today && today <= validTo.slice(0, 10)
}

const NOTEBOOK_CATEGORIES = new Set([
  '游戏笔记本',
  '轻薄笔记本',
  '一体机',
  '商务台式',
  '游戏主机',
])

function readProjection(): { items: any[] } {
  const webPath = path.resolve(config.appDir, '../web-cockpit/public/data/latest-published-product-projection.json')
  const artPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-published-product-projection.json')
  const web = JSON.parse(fs.readFileSync(webPath, 'utf-8'))
  const art = JSON.parse(fs.readFileSync(artPath, 'utf-8'))
  return { items: web.items ?? art.items ?? [] }
}

function readBoost(): { activities: any[]; salesPoSettlementValidations: any[] } {
  const candidates = [
    path.resolve(config.appDir, '../web-cockpit/public/data/latest-marketing-boost-snapshot.json'),
    path.resolve(config.lenovoRetail.artifactDir, 'latest-marketing-boost-snapshot.json'),
  ]
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return {
        activities: Array.isArray(j.activities) ? j.activities : [],
        salesPoSettlementValidations: Array.isArray(j.salesPoSettlementValidations) ? j.salesPoSettlementValidations : [],
      }
    } catch { continue }
  }
  return { activities: [], salesPoSettlementValidations: [] }
}

export function auditEducationCaps(): {
  total: number
  violations: Violation[]
  notebookCapViolations: number
  nonNotebookMustBeZeroViolations: number
  activeSourceMissingInProjection: number
  projectionHasEdButSourceExpired: number
} {
  const { items } = readProjection()
  const { activities, salesPoSettlementValidations } = readBoost()
  const today = todayIsoDate()
  const violations: Violation[] = []
  let notebookCapViolations = 0
  let nonNotebookMustBeZeroViolations = 0
  let activeSourceMissingInProjection = 0
  let projectionHasEdButSourceExpired = 0
  // index all education_discount source cards by skuKey
  const sourceBySku = new Map<string, any[]>()
  const allSourceCards: any[] = []
  for (const c of [...activities, ...salesPoSettlementValidations]) {
    if (!c || c.activityCategory !== 'education_discount') continue
    if (!c.skuKey) continue
    if (!sourceBySku.has(c.skuKey)) sourceBySku.set(c.skuKey, [])
    sourceBySku.get(c.skuKey)!.push(c)
    allSourceCards.push(c)
  }
  for (const it of items) {
    if ((it.currentStock ?? 0) <= 0) continue
    const ed = Number(it.pricing?.educationDiscountAmount ?? 0)
    const category = it.category ?? ''
    const sourceCategory = it.sourceCategory ?? ''
    const productName = it.displayTitle ?? it.productName ?? ''
    const skuKey = it.skuKey
    // existing cap checks
    if (ed) {
      if (NOTEBOOK_CATEGORIES.has(category)) {
        if (ed > 500) {
          violations.push({ skuKey, category, sourceCategory, productName, field: 'educationDiscountAmount', rule: 'notebook_cap_500', amount: ed, cap: 500 })
          notebookCapViolations++
        }
      } else {
        violations.push({ skuKey, category, sourceCategory, productName, field: 'educationDiscountAmount', rule: 'non_notebook_must_be_zero', amount: ed })
        nonNotebookMustBeZeroViolations++
      }
    }
    // cross-check projection ed vs source activity window
    const sourceCards = sourceBySku.get(skuKey) ?? []
    const activeCards = sourceCards.filter((c) => isWithinWindow(c.validFrom, c.validTo, today))
    if (ed === 0 && activeCards.length > 0) {
      for (const ac of activeCards) {
        violations.push({
          skuKey, category, sourceCategory, productName, field: 'educationDiscountAmount',
          rule: 'active_source_missing_in_projection', amount: ac.educationDiscountAmount || ac.boostAmount || 0,
          sourceValidFrom: ac.validFrom, sourceValidTo: ac.validTo, sourceActivityId: ac.id,
        })
        activeSourceMissingInProjection++
      }
    } else if (ed > 0 && sourceCards.length > 0 && activeCards.length === 0) {
      // projection 仍有 ed 但源所有卡都过期
      for (const sc of sourceCards) {
        violations.push({
          skuKey, category, sourceCategory, productName, field: 'educationDiscountAmount',
          rule: 'projection_has_ed_but_source_expired', amount: ed,
          sourceValidFrom: sc.validFrom, sourceValidTo: sc.validTo, sourceActivityId: sc.id,
        })
        projectionHasEdButSourceExpired++
      }
    }
  }
  return {
    total: items.filter((it: any) => (it.currentStock ?? 0) > 0).length,
    violations,
    notebookCapViolations,
    nonNotebookMustBeZeroViolations,
    activeSourceMissingInProjection,
    projectionHasEdButSourceExpired,
  }
}

// CLI entry: dump JSON
if (process.argv[1] && process.argv[1].endsWith('educationCapsAudit.ts')) {
  const r = auditEducationCaps()
  console.log(JSON.stringify({
    total: r.total,
    notebookCapViolations: r.notebookCapViolations,
    nonNotebookMustBeZeroViolations: r.nonNotebookMustBeZeroViolations,
    activeSourceMissingInProjection: r.activeSourceMissingInProjection,
    projectionHasEdButSourceExpired: r.projectionHasEdButSourceExpired,
    violations: r.violations,
  }, null, 2))
  process.exit(r.violations.length > 0 ? 1 : 0)
}
