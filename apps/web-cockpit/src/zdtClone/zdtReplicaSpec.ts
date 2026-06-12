import { zdtTopMenus, type ZdtSubmenuItem } from './zdtMenuConfig'
import { zdtSubmenuSchemas } from './zdtSubmenuSchemas'
import { zdtSubmenuActions } from './zdtSubmenuActions'
import { zdtDetailScans } from './zdtDetailScans'

export type ZdtLabelPair = {
  index: number
  labels: [string, string?]
  mergedLabel: string
}

export type ZdtReplicaSpec = {
  submenu: {
    key: string
    label: string
    pageTitle: string
    topMenu: string
    group: string
    url: string
    summary: string
    targetDomain: string
  }
  subnav: Array<{
    key: string
    label: string
    url: string
    summary: string
    targetDomain: string
  }>
  toolbarButtons: string[]
  detailEntrances: string[]
  tabs: string[]
  filters: {
    labelsRaw: string[]
    labelPairs: ZdtLabelPair[]
    inputPlaceholders: string[]
    dateFields: string[]
  }
  tableHeaders: string[]
  rowActions: Array<{ rowIndex: number; actions: string[] }>
  detail: {
    trigger: string | null
    closeMethod: string | null
    title: string
    buttons: string[]
    fieldsRaw: string[]
    fieldPairs: ZdtLabelPair[]
    headings: string[]
  }
  errors: {
    schema: string | null
    actions: string | null
    detail: string | null
  }
}

function toLabelPairs(labels: string[]): ZdtLabelPair[] {
  const pairs: ZdtLabelPair[] = []
  for (let i = 0; i < labels.length; i += 2) {
    const left = labels[i]
    const right = labels[i + 1]
    pairs.push({
      index: i / 2,
      labels: [left, right],
      mergedLabel: right === undefined || left === right ? left : `${left} / ${right}`,
    })
  }
  return pairs
}

function extractDateFields(inputs: string[], labels: string[]): string[] {
  const datePattern = /(时间|日期|起始|开始|结束|范围|time|date)/i
  return [...labels, ...inputs].filter((value) => datePattern.test(value))
}

function getSubmenuByLabel(label: string): {
  item: ZdtSubmenuItem
  topMenuLabel: string
  groupLabel: string
  groupItems: ZdtSubmenuItem[]
} | null {
  for (const topMenu of zdtTopMenus) {
    for (const group of topMenu.groups) {
      const item = group.items.find((candidate) => candidate.label === label)
      if (item) {
        return {
          item,
          topMenuLabel: topMenu.label,
          groupLabel: group.label,
          groupItems: group.items,
        }
      }
    }
  }
  return null
}

function buildReplicaSpec(submenuLabel: string): ZdtReplicaSpec | null {
  const menuMatch = getSubmenuByLabel(submenuLabel)
  if (!menuMatch) {
    return null
  }

  const schema = zdtSubmenuSchemas[submenuLabel]
  const actionScan = zdtSubmenuActions[submenuLabel]
  const detailScan = zdtDetailScans[submenuLabel]
  const labelsRaw = schema?.selectLabels ?? []
  const fieldsRaw = detailScan?.labels ?? []

  return {
    submenu: {
      key: menuMatch.item.key,
      label: menuMatch.item.label,
      pageTitle: schema?.pageTitle ?? menuMatch.item.label,
      topMenu: menuMatch.topMenuLabel,
      group: menuMatch.groupLabel,
      url: menuMatch.item.url,
      summary: menuMatch.item.summary,
      targetDomain: menuMatch.item.targetDomain,
    },
    subnav: menuMatch.groupItems.map((item) => ({
      key: item.key,
      label: item.label,
      url: item.url,
      summary: item.summary,
      targetDomain: item.targetDomain,
    })),
    toolbarButtons: schema?.buttons ?? [],
    detailEntrances: actionScan?.detailEntrances ?? [],
    tabs: schema?.tabs ?? [],
    filters: {
      labelsRaw,
      labelPairs: toLabelPairs(labelsRaw),
      inputPlaceholders: schema?.placeholders ?? [],
      dateFields: extractDateFields(schema?.placeholders ?? [], labelsRaw),
    },
    tableHeaders: schema?.tableHeaders ?? [],
    rowActions: actionScan?.rowActions ?? [],
    detail: {
      trigger: detailScan?.usedTrigger ?? null,
      closeMethod: detailScan?.closeMethod ?? null,
      title: detailScan?.title ?? '',
      buttons: detailScan?.buttons ?? [],
      fieldsRaw,
      fieldPairs: toLabelPairs(fieldsRaw),
      headings: detailScan?.headings ?? [],
    },
    errors: {
      schema: schema?.error ?? null,
      actions: actionScan?.error ?? null,
      detail: detailScan?.error ?? null,
    },
  }
}

function collectSubmenuLabelsInOrder(): string[] {
  const labels: string[] = []
  for (const topMenu of zdtTopMenus) {
    for (const group of topMenu.groups) {
      for (const item of group.items) {
        labels.push(item.label)
      }
    }
  }
  return labels
}

const zdtSubmenuReplicaSpecs = collectSubmenuLabelsInOrder()
  .map((submenuLabel) => buildReplicaSpec(submenuLabel))
  .filter((spec): spec is ZdtReplicaSpec => spec !== null)

const zdtSubmenuReplicaSpecByLabel: Record<string, ZdtReplicaSpec> = Object.fromEntries(
  zdtSubmenuReplicaSpecs.map((spec) => [spec.submenu.label, spec]),
)

export { zdtSubmenuReplicaSpecs, zdtSubmenuReplicaSpecByLabel, buildReplicaSpec, toLabelPairs }
