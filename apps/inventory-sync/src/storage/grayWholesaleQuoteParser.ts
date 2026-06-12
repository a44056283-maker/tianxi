import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

export type GrayWholesaleQuote = {
  source: 'wechat-official-account'
  accountName: string
  entryPoint: string
  quoteDate: string
  capturedAt: string
  productText: string
  marketWholesalePrice?: number
  maskedPriceText?: string
  taxIncluded: false
  serviceIncluded: false
  matchFingerprint: string
  evidenceText?: string
}

export type GrayWholesaleSnapshot = {
  generatedAt: string
  accountName: string
  entryPoint: string
  quoteDate?: string
  latestVisibleArticleDate?: string
  effectiveQuoteDate?: string
  hasSupportedLenovoQuotes?: boolean
  isCarriedForward: boolean
  carryForwardFrom?: string
  sourceFile?: string
  quoteCount: number
  quotes: GrayWholesaleQuote[]
  evidenceChain?: {
    visitEvidencePath?: string
    capturePlanPath?: string
  }
}

type SaveGrayWholesaleSnapshotOptions = {
  expectedFreshQuoteDate?: string
  sourceFile?: string
  visitEvidencePath?: string
  capturePlanPath?: string
}

type PriceMatch = {
  raw: string
  value?: number
  masked?: string
}

function normalizeConfigText(value?: string) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/酷睿|英特尔|INTEL/g, '')
    .replace(/锐龙|AMD/g, '')
    .replace(/集成显卡|集显|集\//g, '集')
    .replace(/固态|SSD/g, '')
    .replace(/RTX\s*/g, 'RTX')
    .replace(/GB/g, 'G')
    .replace(/1TB/g, '1T')
    .replace(/2TB/g, '2T')
}

function buildConfigFingerprint(value?: string) {
  const text = normalizeConfigText(value)
  const tokens = new Set<string>()

  const addAll = (pattern: RegExp, mapper = (value: string) => value) => {
    for (const match of text.matchAll(pattern)) tokens.add(mapper(match[1] ?? match[0]))
  }
  const addGroup = (pattern: RegExp, groupIndex: number, mapper = (value: string) => value) => {
    for (const match of text.matchAll(pattern)) {
      const token = match[groupIndex]
      if (token) tokens.add(mapper(token))
    }
  }

  addAll(/(YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|GEEKPRO|MATEBOOK|HUAWEI|THINKSTATION|THINKCENTRE|开天|超翔|CE\d{3}[A-Z]?)/g, (value) => value === 'LECOO' ? '来酷' : value === 'LEGION' ? '拯救者' : value)
  addAll(/([RY]\d{4}P?|战\d{4}|N\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|1[46]C|D1[46]|14|16|K-C4|CE\d{3}[A-Z]?|M630Z|E50Z|M75Z|M70H|TZ830-V3|H880-T1|F870-F05|L860-T6)/g)
  addAll(/(ULTRA[579][-]?\d{3}[A-Z]*|CORE[3579][-]?\d{3}[A-Z]*|U[3579][-]?\d{3,4}[A-Z]*|I[3579][-]?\d{4,5}[A-Z]*)/g, (value) => value.replace(/^ULTRA/, 'U').replace(/^CORE/, 'U'))
  addAll(/(ULTRA[579]|CORE[3579]|U[3579]|I[3579]|R[3579])/g, (value) => value.replace(/^ULTRA/, 'U').replace(/^CORE/, 'U'))
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{5})(?:HX|H|U|V|P)/g, (value) => `CPU${value}`)
  addAll(/(?:ULTRA|CORE|U|I)[3579][-]?([0-9]{3,4})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/R[3579]-[A-Z]?([0-9]{3,5})(?:HX|H|U|V|P|(?=(?:8|12|16|24|32|64)G))/g, (value) => `CPU${value}`)
  addAll(/(?:RTX)?(3050|4060|4070|5060|5070|5070TI|5080|5090)/g)
  addAll(/(?:^|[^0-9])((?:8|12|16|24|32|64)G)/g)
  addGroup(/(?:ULTRA[579][-]?\d{0,4}[A-Z]*|CORE[3579][-]?\d{0,4}[A-Z]*|U[3579][-]?\d{0,4}[A-Z]*|I[3579][-]?\d{0,5}[A-Z]*|R[3579]-[A-Z]?\d{0,5}[A-Z]*)((?:8|12|16|24|32|64)G)/g, 1)
  addAll(/(?:^|[^0-9])((?:128|256|512)G?|[12]T)/g, (value) => /G$|T$/.test(value) ? value : `${value}G`)
  addAll(/(\d{2}(?:\.\d)?寸)/g)

  return Array.from(tokens).sort().join('|')
}

function extractQuoteDate(text: string) {
  const match = text.match(/(20\d{2})[-年.\/](\d{1,2})[-月.\/](\d{1,2})/)
  if (!match) return new Date().toISOString().slice(0, 10)
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function extractMarketWholesalePrice(line: string): PriceMatch | undefined {
  const maskedMatch = line.match(/(\d+\*+\d*)\s*创业?/)
  if (maskedMatch) return { raw: maskedMatch[0], masked: maskedMatch[1] }

  const directMatches = Array.from(line.matchAll(/(?:¥|￥)?\s*(\d{3,5})(?:\s*元)?(?=\s|$)/g))
  const direct = directMatches.at(-1)
  if (direct) {
    const value = Number(direct[1])
    if (Number.isFinite(value)) return { raw: direct[0], value }
  }

  return undefined
}

function isSupportedGrayWholesaleSeries(productText: string) {
  if (/MATEBOOK|MATEPAD|HUAWEI|华为/i.test(productText)) return false
  return /小新|拯救者|来酷|斗战者|YOGA|LEGION|THINKPAD|THINKBOOK|THINKSTATION|THINKCENTRE|THINK|扬天|昭阳|瑞天|开天|超翔|异能者|擎天|GEEKPRO|天逸|MOTO|RAZR|摩托|CE\d{3}[A-Z]?|K-C4|M630Z|E50Z|M75Z|M70H|TZ830|H880|F870|L860|[RY]\d{4}P?|战\d{4}/i.test(productText)
}

function isSectionHeading(productText: string) {
  return /系列|笔记本|平板|商用|商务/.test(productText) && !/\d/.test(productText)
}

export function parseGrayWholesaleText(rawText: string): GrayWholesaleQuote[] {
  const quoteDate = extractQuoteDate(rawText)
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const quotes: GrayWholesaleQuote[] = []
  let pendingPrice: PriceMatch | undefined
  for (const line of lines) {
    if (/冻晓永|价格以当时报价为准|郑州创业科技|电脑报价|^\d{4}[-年]/.test(line)) continue
    if (/^赞\d*推荐写留言|^阅读\d+|^留言$|^写留言$|^郑州市创业$|^总结由元宝提供|^Q$|^×$/.test(line)) continue

    const priceMatch = extractMarketWholesalePrice(line)
    if (priceMatch) {
      const inlineProductText = line
        .replace(priceMatch.raw, '')
        .replace(/\s*创业\s*$/, '')
        .trim()
      if (inlineProductText.length >= 4 && isSupportedGrayWholesaleSeries(inlineProductText)) {
        const price = priceMatch.value
        const maskedPriceText = priceMatch.masked
        if ((price !== undefined && price >= 300) || maskedPriceText) {
          quotes.push({
            source: 'wechat-official-account',
            accountName: '郑州市创业',
            entryPoint: '公众号底部日期报价按钮',
            quoteDate,
            capturedAt: new Date().toISOString(),
            productText: inlineProductText,
            marketWholesalePrice: price,
            maskedPriceText,
            taxIncluded: false,
            serviceIncluded: false,
            matchFingerprint: buildConfigFingerprint(inlineProductText),
            evidenceText: line,
          })
          pendingPrice = undefined
          continue
        }
      }
      pendingPrice = priceMatch
      continue
    }

    const productText = line
      .replace(/\s*创业\s*$/, '')
      .trim()
    if (productText.length < 4) continue
    if (!isSupportedGrayWholesaleSeries(productText)) continue
    if (!pendingPrice && isSectionHeading(productText)) continue

    quotes.push({
      source: 'wechat-official-account',
      accountName: '郑州市创业',
      entryPoint: '公众号底部日期报价按钮',
      quoteDate,
      capturedAt: new Date().toISOString(),
      productText,
      marketWholesalePrice: pendingPrice?.value,
      maskedPriceText: pendingPrice?.masked,
      taxIncluded: false,
      serviceIncluded: false,
      matchFingerprint: buildConfigFingerprint(productText),
      evidenceText: pendingPrice ? `${pendingPrice.raw} ${line}`.trim() : line,
    })
    pendingPrice = undefined
  }

  const deduped = new Map<string, GrayWholesaleQuote>()
  for (const quote of quotes) {
    const key = `${quote.quoteDate}::${quote.matchFingerprint || quote.productText}::${quote.maskedPriceText || quote.marketWholesalePrice || ''}`
    if (!deduped.has(key)) deduped.set(key, quote)
  }
  return [...deduped.values()]
}

export async function saveGrayWholesaleSnapshotFromText(rawText?: string, options?: SaveGrayWholesaleSnapshotOptions) {
  if (options?.visitEvidencePath) {
    const evidenceExists = await fs.stat(options.visitEvidencePath).then(() => true).catch(() => false)
    if (!evidenceExists) {
      throw new Error(
        `Missing gray channel visit evidence at ${options.visitEvidencePath}; ` +
        `visit evidence must be recorded (gray-channel-visible-article-YYYY-MM-DD.txt) before parsing the raw text.`
      )
    }
  }
  const evidenceChain = options?.visitEvidencePath
    ? { visitEvidencePath: options.visitEvidencePath, capturePlanPath: options.capturePlanPath }
    : undefined
  const previousPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-gray-wholesale-quotes.json')
  const previous = await fs.readFile(previousPath, 'utf-8')
    .then((content) => JSON.parse(content) as GrayWholesaleSnapshot)
    .catch(() => null)

  const quotes = rawText ? parseGrayWholesaleText(rawText) : []
  const visibleArticleDate = rawText ? extractQuoteDate(rawText) : undefined
  const parsedQuoteDate = quotes[0]?.quoteDate
  const isFreshExpectedDate = options?.expectedFreshQuoteDate
    ? parsedQuoteDate === options.expectedFreshQuoteDate
    : true
  const previousEffectiveQuoteDate = previous?.effectiveQuoteDate ?? previous?.quoteDate
  const snapshot: GrayWholesaleSnapshot = quotes.length
    ? {
        generatedAt: new Date().toISOString(),
        accountName: '郑州市创业',
        entryPoint: '公众号底部日期报价按钮',
        quoteDate: parsedQuoteDate,
        latestVisibleArticleDate: visibleArticleDate ?? parsedQuoteDate,
        effectiveQuoteDate: parsedQuoteDate,
        hasSupportedLenovoQuotes: true,
        isCarriedForward: !isFreshExpectedDate,
        carryForwardFrom: !isFreshExpectedDate ? parsedQuoteDate : undefined,
        sourceFile: options?.sourceFile,
        quoteCount: quotes.length,
        quotes,
        evidenceChain,
      }
    : {
        generatedAt: new Date().toISOString(),
        accountName: '郑州市创业',
        entryPoint: '公众号底部日期报价按钮',
        quoteDate: visibleArticleDate ?? previous?.quoteDate,
        latestVisibleArticleDate: visibleArticleDate ?? previous?.latestVisibleArticleDate ?? previous?.quoteDate,
        effectiveQuoteDate: previousEffectiveQuoteDate,
        hasSupportedLenovoQuotes: false,
        isCarriedForward: Boolean(previous),
        carryForwardFrom: previousEffectiveQuoteDate,
        sourceFile: options?.sourceFile ?? previous?.sourceFile,
        quoteCount: previous?.quoteCount ?? 0,
        quotes: previous?.quotes ?? [],
        evidenceChain: evidenceChain ?? previous?.evidenceChain,
      }

  const webPublicDataDir = path.resolve(config.appDir, '../web-cockpit/public/data')
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  await fs.mkdir(webPublicDataDir, { recursive: true })

  const content = JSON.stringify(snapshot, null, 2)
  const artifactPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-gray-wholesale-quotes.json')
  const webPath = path.resolve(webPublicDataDir, 'latest-gray-wholesale-quotes.json')
  await fs.writeFile(artifactPath, content)
  await fs.writeFile(webPath, content)

  return { artifactPath, webPath, snapshot }
}
