import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { config } from '../config.js'
import type { StandardInventorySnapshot, StandardInventorySku } from '../types.js'
import { buildConfigFingerprint } from '../inventoryQuote/priceEngine.js'
import {
  saveMarketplacePriceSnapshot,
  type MarketplacePriceRecord,
  type MarketplaceSource,
} from './marketplacePriceCollector.js'

type BrowserCandidate = {
  source: MarketplaceSource
  discoveryMethod?: 'locked_product_url' | 'brand_category_browse' | 'search'
  title: string
  detail?: string
  price?: number
  couponAdjustedPrice?: number
  platformCouponAmount?: number
  educationDiscountAmount?: number
  governmentSubsidyAmount?: number
  discountNotes?: string[]
  platformCouponNotes?: string[]
  educationDiscountNotes?: string[]
  governmentSubsidyNotes?: string[]
  priceType: MarketplacePriceRecord['priceType']
  url: string
  platform?: string
  publishedAt?: string
  matchScore: number
  rawText: string
}

type ProductUrlLockSnapshot = {
  locks?: Array<{
    skuKey: string
    source: 'jd_self' | 'jd_supermarket' | 'jd_authorized' | 'lenovo_official' | 'manmanbuy_hint'
    url: string
    matchStatus: 'locked' | 'candidate' | 'unavailable'
    confidence: 'confirmed' | 'manual_review_required'
  }>
}

const sourceLabels: Record<MarketplaceSource, string> = {
  jd: '京东',
  lenovo_official: '联想官网',
  taobao_subsidy: '淘宝百亿补贴',
}

const sourceTypes: Record<MarketplaceSource, MarketplacePriceRecord['sourceType']> = {
  jd: 'subsidy_reference_price',
  lenovo_official: 'sales_reference_price',
  taobao_subsidy: 'subsidy_reference_price',
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

const jdLenovoSelfMallUrl = 'https://lenovo1.jd.com/'
const jdLenovoAuthorizedMallUrl = 'https://mall.jd.com/index-580799.html?from=pc'
const jdSupermarketLenovoUrl = 'https://pro.jd.com/mall/active/CMBvmA8Dbsich2QrjFxMbNzpdRB/index.html'
const lenovoShopHomeUrl = 'https://shop.lenovo.com.cn/'
const lenovoShopSearchBaseUrl = 'https://s.lenovo.com.cn/search/'

const jdLenovoCategoryUrls = {
  home: 'https://lenovo1.jd.com/',
  gamingNotebook: 'https://pro.jd.com/mall/active/RFp7sYBB36qaPj26DnCJMaN7UM2/index.html',
  thinNotebook: 'https://pro.jd.com/mall/active/CMBvmA8Dbsich2QrjFxMbNzpdRB/index.html',
  businessNotebook: 'https://pro.jd.com/mall/active/7PZQX8zSnkUBVCCt9SRsWxUCYHD/index.html',
  tablet: 'https://pro.jd.com/mall/active/2qLZdAFYban3VK1nfkDtt3CFvSsr/index.html',
  desktop: 'https://pro.jd.com/mall/active/w889k3hhzzydLHou1Xhw3TGVBZF/index.html',
  aioDesktop: 'https://lenovo1.jd.com/view_search-401995-16782420-5-1-24-1.html',
  monitor: 'https://pro.jd.com/mall/active/3XH5Tj56fnENX3boEA5WJPrqd4JG/index.html',
  accessory: 'https://pro.jd.com/mall/active/46XB9PozpJStGQJaofwcr7jdxA5C/index.html',
  smartLife: 'https://pro.jd.com/mall/active/2A9xiyaY1WbQ3b35F9kzrLknNNgw/index.html',
} as const

const jdLenovoSeriesMenuUrls = {
  y9000p: 'https://lenovo1.jd.com/view_search-401995-21658899-5-1-24-1.html',
  y7000p: 'https://lenovo1.jd.com/view_search-401995-21658897-5-1-24-1.html',
  y7000: 'https://lenovo1.jd.com/view_search-401995-28317336-5-1-24-1.html',
  r9000p: 'https://lenovo1.jd.com/view_search-401995-21658900-5-1-24-1.html',
  r7000p: 'https://lenovo1.jd.com/view_search-401995-21658898-5-1-24-1.html',
  r7000: 'https://lenovo1.jd.com/view_search-401995-22772326-5-1-24-1.html',
  y9000x: 'https://lenovo1.jd.com/view_search-401995-21658901-5-1-24-1.html',
  legionY700: 'https://lenovo1.jd.com/view_search-401995-18950960-5-1-24-1.html',
  legionBlade7000: 'https://lenovo1.jd.com/view_search-401995-26046959-5-1-24-1.html',
  legionBlade9000: 'https://lenovo1.jd.com/view_search-401995-22274075-5-1-24-1.html',
  lecooZhan7000: 'https://lenovo1.jd.com/view_search-401995-59416617-5-1-24-1.html',
  xiaoxin14: 'https://lenovo1.jd.com/view_search-401995-20951877-5-1-24-1.html',
  xiaoxin16: 'https://lenovo1.jd.com/view_search-401995-20951878-5-1-24-1.html',
  xiaoxinPro14: 'https://lenovo1.jd.com/view_search-401995-20951879-5-1-24-1.html',
  xiaoxinPro16: 'https://lenovo1.jd.com/view_search-401995-20951880-5-1-24-1.html',
  xiaoxinPro14Gt: 'https://lenovo1.jd.com/view_search-401995-58623974-5-1-24-1.html',
  xiaoxinPro16Gt: 'https://lenovo1.jd.com/view_search-401995-58623975-5-1-24-1.html',
  motoS50: 'https://lenovo1.jd.com/view_search-401995-56558059-5-1-24-1.html',
} as const

const jdSupplementCategoryUrls = {
  supermarket: jdSupermarketLenovoUrl,
  authorized: jdLenovoAuthorizedMallUrl,
} as const

const lenovoCategoryUrls = {
  gamingNotebook: 'https://shop.lenovo.com.cn/landingpage/legion.html',
  thinNotebook: 'https://shop.lenovo.com.cn/landingpage/xiaoxin.html',
  yoga: 'https://shop.lenovo.com.cn/landingpage/yoga.html',
  tablet: 'https://shop.lenovo.com.cn/landingpage/tablet.html',
  desktop: 'https://shop.lenovo.com.cn/landingpage/desktop.html',
  monitor: 'https://shop.lenovo.com.cn/landingpage/monitor.html',
  accessory: 'https://shop.lenovo.com.cn/landingpage/accessory.html',
} as const

function isJdProductUrl(url: string) {
  return /^https:\/\/item\.jd\.com\/\d+\.html(?:[?#].*)?$/i.test(url)
}

function isLenovoProductUrl(url: string) {
  return /^https:\/\/item\.lenovo\.com\.cn\/product\/\d+\.html/i.test(url)
}

function isDirectOfficialProductUrl(source: MarketplaceSource, url: string) {
  if (source === 'jd') return isJdProductUrl(url)
  if (source === 'lenovo_official') return isLenovoProductUrl(url)
  return false
}

function artifactPath(name: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.resolve(config.lenovoRetail.artifactDir, `${stamp}-${name}`)
}

function randomInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

async function humanPause(page: Page, minMs = 900, maxMs = 2200) {
  await page.waitForTimeout(randomInt(minMs, maxMs))
}

async function humanMove(page: Page) {
  await page.mouse.move(randomInt(180, 980), randomInt(120, 720), { steps: randomInt(12, 28) }).catch(() => undefined)
}

async function humanScroll(page: Page, steps = 2) {
  for (let index = 0; index < steps; index += 1) {
    await humanMove(page)
    await page.mouse.wheel(0, randomInt(360, 780)).catch(() => undefined)
    await humanPause(page, 700, 1500)
  }
}

async function gotoHuman(page: Page, url: string, timeout = 30000) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
  await humanPause(page, 1600, 3200)
  await humanMove(page)
}

function cleanSearchTerm(value?: string) {
  return String(value ?? '')
    .replace(/\*/g, '')
    .replace(/\bWIN(?:DOWS)?\s*11\b/gi, '')
    .replace(/\b11C\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchKeyword(row: StandardInventorySku) {
  const text = cleanSearchTerm(`${row.productName} ${row.spec ?? ''}`)
  const model = text.match(/(ThinkPad|YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|战7000|GEEKPRO|[RY]\d{4}P?|Y\d{4}P?|N\d{3}[A-Z]?|PRO\s?\d{2}(?:GT)?|AIR\s?\d{2}|TAB|Y700|天逸\d+[A-Z]?)/i)?.[0]
  const cpu = text.match(/(?:ULTRA\s?[579][-\s]?\d{3}[A-Z]*|I[3579][-\s]?\d{4,5}[A-Z]*|R[3579][-\s]?[A-Z]?\d{3,5}[A-Z]*|R7[-\s]?H255|I[3579]\d{4,5}[A-Z]*|骁龙\s?8\s?GEN\s?3)/i)?.[0]
  const memory = text.match(/\b(?:8|12|16|24|32|64)G(?:B)?\b/i)?.[0]
  const storage = text.match(/\b(?:128G|256G|512G|1T|2T)(?:SSD|固态)?\b/i)?.[0]
  const gpu = text.match(/RTX\s?(?:3050|4050|4060|4070|5050|5060|5070|5070TI|5080|5090)(?:-\dG)?/i)?.[0]
  const color = text.match(/(钛晶黑|碳晶黑|冰魄白|月幕白|深空灰|曜石金|灰色|白色|黑色|黑|白)/)?.[0]
  const tokens = [model, cpu, memory, storage, gpu, color].filter(Boolean) as string[]
  return tokens.length >= 2 ? cleanSearchTerm(tokens.join(' ')) : cleanSearchTerm(row.productName).slice(0, 48)
}

function buildSearchKeywords(row: StandardInventorySku) {
  const text = cleanSearchTerm(`${row.productName} ${row.spec ?? ''}`)
  const model = text.match(/(ThinkPad|YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|战7000|GEEKPRO|[RY]\d{4}P?|Y\d{4}P?|N\d{3}[A-Z]?|PRO\s?\d{2}(?:GT)?|AIR\s?\d{2}|TAB|Y700|moto|razr|edge|天逸\d+[A-Z]?)/i)?.[0]
  const cpu = text.match(/(?:ULTRA\s?[579][-\s]?\d{3}[A-Z]*|I[3579][-\s]?\d{4,5}[A-Z]*|R[3579][-\s]?[A-Z]?\d{3,5}[A-Z]*|R7[-\s]?H255|I[3579]\d{4,5}[A-Z]*|骁龙\s?8\s?GEN\s?3)/i)?.[0]
  const memory = text.match(/\b(?:8|12|16|24|32|64)G(?:B)?\b/i)?.[0]
  const storage = text.match(/\b(?:128G|256G|512G|1T|2T)(?:SSD|固态)?\b/i)?.[0]
  const gpu = text.match(/RTX\s?(?:3050|4050|4060|4070|5050|5060|5070|5070TI|5080|5090)(?:-\dG)?/i)?.[0]
  const color = text.match(/(钛晶黑|碳晶黑|冰魄白|月幕白|深空灰|曜石金|灰色|白色|黑色|黑|白|银色|卷云灰)/i)?.[0]
  const candidates = [
    cleanSearchTerm([model].filter(Boolean).join(' ')),
    cleanSearchTerm([model, cpu, memory, storage, gpu].filter(Boolean).join(' ')),
    cleanSearchTerm([model, cpu, memory, storage, gpu, color].filter(Boolean).join(' ')),
    cleanSearchTerm(row.productName).slice(0, 52),
  ].filter((value) => value.length >= 3)

  return Array.from(new Set(candidates)).slice(0, 3)
}

function getCategorySearchPrefix(row: StandardInventorySku) {
  const text = `${row.category ?? ''} ${row.jdSubcategory ?? ''} ${row.sourceCategory ?? ''} ${row.productName}`.toUpperCase()
  if (/游戏笔记本|拯救者|LEGION|Y7000|Y9000|R7000|R9000/.test(text)) return '拯救者'
  if (/轻薄笔记本|小新|YOGA|AIR|PRO/.test(text)) return /YOGA/.test(text) ? 'YOGA笔记本' : '小新笔记本'
  if (/来酷|LECOO|斗战者|战7000|N\d{3}/.test(text)) return '来酷笔记本'
  if (/平板|TAB|PAD|Y700/.test(text)) return /拯救者|Y700/.test(text) ? '拯救者平板' : '小新平板'
  if (/手机|MOTO|RAZR|EDGE|PHN/.test(text)) return 'moto手机'
  if (/显示器|MONITOR|L\d{4}/.test(text)) return '显示器'
  if (/打印机|喷墨|激光|PANDA/.test(text)) return '打印机'
  if (/鼠标/.test(text)) return '鼠标'
  if (/键盘|键鼠/.test(text)) return '键盘'
  if (/耳机|耳麦|音箱/.test(text)) return '耳机'
  if (/适配器|充电器|氮化镓/.test(text)) return '适配器'
  if (/支架|散热/.test(text)) return '支架'
  return row.category ?? row.jdSubcategory ?? '联想'
}

function getCategoryBrowseTargets(row: StandardInventorySku) {
  const text = `${row.category ?? ''} ${row.jdSubcategory ?? ''} ${row.sourceCategory ?? ''} ${row.productName}`.toUpperCase()
  if (/游戏笔记本|拯救者|LEGION|Y7000|Y9000|R7000|R9000|斗战者|战7000/.test(text)) {
    return { lenovoUrl: lenovoCategoryUrls.gamingNotebook, jdUrl: jdLenovoCategoryUrls.gamingNotebook }
  }
  if (/YOGA/.test(text)) return { lenovoUrl: lenovoCategoryUrls.yoga, jdUrl: jdLenovoCategoryUrls.thinNotebook }
  if (/轻薄笔记本|小新|AIR|PRO|来酷|LECOO/.test(text)) {
    return { lenovoUrl: lenovoCategoryUrls.thinNotebook, jdUrl: jdLenovoCategoryUrls.thinNotebook }
  }
  if (/平板|TAB|PAD|Y700/.test(text)) return { lenovoUrl: lenovoCategoryUrls.tablet, jdUrl: jdLenovoCategoryUrls.tablet }
  if (/一体机/.test(text)) return { lenovoUrl: lenovoCategoryUrls.desktop, jdUrl: jdLenovoCategoryUrls.aioDesktop }
  if (/商务台式|游戏主机|台式|GEEKPRO|天逸/.test(text)) return { lenovoUrl: lenovoCategoryUrls.desktop, jdUrl: jdLenovoCategoryUrls.desktop }
  if (/显示器/.test(text)) return { lenovoUrl: lenovoCategoryUrls.monitor, jdUrl: jdLenovoCategoryUrls.monitor }
  if (/电脑配件|耳机|鼠标|键盘|适配器|支架|背包|手写笔|SSD/.test(text)) return { lenovoUrl: lenovoCategoryUrls.accessory, jdUrl: jdLenovoCategoryUrls.accessory }
  if (/手机|MOTO|RAZR|EDGE|PHN/.test(text)) return { lenovoUrl: lenovoShopHomeUrl, jdUrl: jdLenovoCategoryUrls.smartLife }
  return { lenovoUrl: lenovoShopHomeUrl, jdUrl: jdLenovoCategoryUrls.home }
}

function getJdSeriesBrowseUrls(row: StandardInventorySku) {
  const text = `${row.category ?? ''} ${row.jdSubcategory ?? ''} ${row.sourceCategory ?? ''} ${row.productName} ${row.spec ?? ''}`.toUpperCase()
  const urls: string[] = []
  const add = (url: string) => {
    if (!urls.includes(url)) urls.push(url)
  }

  if (/R9000P/.test(text)) add(jdLenovoSeriesMenuUrls.r9000p)
  if (/R7000P/.test(text)) add(jdLenovoSeriesMenuUrls.r7000p)
  if (/R7000(?!P)/.test(text)) add(jdLenovoSeriesMenuUrls.r7000)
  if (/Y9000P|ULTRA\s?9/.test(text)) add(jdLenovoSeriesMenuUrls.y9000p)
  if (/Y9000X/.test(text)) add(jdLenovoSeriesMenuUrls.y9000x)
  if (/Y7000P/.test(text)) add(jdLenovoSeriesMenuUrls.y7000p)
  if (/Y7000(?!P)/.test(text)) add(jdLenovoSeriesMenuUrls.y7000)
  if (/刃\s?9000|BLADE\s?9000/.test(text)) add(jdLenovoSeriesMenuUrls.legionBlade9000)
  if (/刃\s?7000|BLADE\s?7000/.test(text)) add(jdLenovoSeriesMenuUrls.legionBlade7000)
  if (/来酷|LECOO|斗战者|战7000/.test(text)) add(jdLenovoSeriesMenuUrls.lecooZhan7000)
  if (/平板|TAB|PAD|Y700(?!0)/.test(text)) add(jdLenovoSeriesMenuUrls.legionY700)
  if (/小新PRO\s?16|PRO16|PRO 16/.test(text)) add(jdLenovoSeriesMenuUrls.xiaoxinPro16)
  if (/小新PRO\s?14|PRO14|PRO 14/.test(text)) add(jdLenovoSeriesMenuUrls.xiaoxinPro14)
  if (/PRO16GT|PRO 16GT/.test(text)) add(jdLenovoSeriesMenuUrls.xiaoxinPro16Gt)
  if (/PRO14GT|PRO 14GT/.test(text)) add(jdLenovoSeriesMenuUrls.xiaoxinPro14Gt)
  if (/小新\s?16|AIR\s?16/.test(text)) add(jdLenovoSeriesMenuUrls.xiaoxin16)
  if (/小新\s?14|AIR\s?14/.test(text)) add(jdLenovoSeriesMenuUrls.xiaoxin14)
  if (/MOTO|PHN|S50/.test(text)) add(jdLenovoSeriesMenuUrls.motoS50)

  if (!urls.length && /游戏笔记本|拯救者|LEGION/.test(text)) {
    add(jdLenovoSeriesMenuUrls.y7000p)
    add(jdLenovoSeriesMenuUrls.r7000p)
    add(jdLenovoSeriesMenuUrls.y9000p)
    add(jdLenovoSeriesMenuUrls.r9000p)
  }

  return urls.slice(0, 4)
}

function buildCategorySearchKeywords(row: StandardInventorySku) {
  const categoryPrefix = getCategorySearchPrefix(row)
  const configKeywords = buildSearchKeywords(row)
  return Array.from(new Set([
    ...configKeywords.map((keyword) => cleanSearchTerm(`${categoryPrefix} ${keyword}`)),
    ...configKeywords,
    cleanSearchTerm(`${categoryPrefix} ${row.productName}`).slice(0, 64),
  ].filter((value) => value.length >= 3))).slice(0, 5)
}

function parsePrice(value: string) {
  const match = value.match(/(?:价格[:：]\s*)?(?:¥|￥)?\s*([1-9]\d{2,5}(?:\.\d{1,2})?)\s*元?/)
  if (!match) return undefined
  const price = Number(match[1])
  return Number.isFinite(price) ? price : undefined
}

function extractDiscountNotes(...values: Array<string | undefined>) {
  const text = values.filter(Boolean).join('\n')
  const notes = Array.from(new Set(text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /教育|学生|校园|平台券|优惠券|领券|券|补贴|国补|政府|预减|已减|满减|红包/.test(line))
    .map((line) => line.replace(/\s+/g, ' ').slice(0, 80))))
  const platformCouponNotes = notes.filter((note) => /平台券|优惠券|领券|券|满减|红包/.test(note))
  const educationDiscountNotes = notes.filter((note) => /教育|学生|校园/.test(note))
  const governmentSubsidyNotes = notes.filter((note) => /补贴|国补|政府|预减|已减/.test(note))
  return { discountNotes: notes, platformCouponNotes, educationDiscountNotes, governmentSubsidyNotes }
}

function extractDiscountAmount(notes: string[], pattern: RegExp) {
  for (const note of notes) {
    if (!pattern.test(note)) continue
    const amount = note.match(/([1-9]\d{0,5}(?:\.\d{1,2})?)\s*元/)?.[1]
    if (!amount) continue
    const value = Number(amount)
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function applyVisiblePlatformCoupon(source: MarketplaceSource, price: number | undefined, platformCouponAmount: number | undefined) {
  if (source !== 'jd' || price === undefined || platformCouponAmount === undefined || platformCouponAmount <= 0 || platformCouponAmount >= price) {
    return { acceptedPrice: price, couponAdjustedPrice: undefined, priceType: undefined as MarketplacePriceRecord['priceType'] | undefined }
  }
  const couponAdjustedPrice = Number((price - platformCouponAmount).toFixed(2))
  return {
    acceptedPrice: couponAdjustedPrice,
    couponAdjustedPrice,
    priceType: 'coupon_adjusted_price' as MarketplacePriceRecord['priceType'],
  }
}

function normalizeLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function collectFromListingPage(
  page: Page,
  sku: StandardInventorySku,
  url: string,
  source: MarketplaceSource,
  discoveryMethod: BrowserCandidate['discoveryMethod'],
): Promise<BrowserCandidate[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 })
  await page.waitForTimeout(1200)
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  if (/验证码|滑块|安全验证|访问受限|Access Denied/i.test(text)) return []

  const lines = normalizeLines(text)
  const candidates: BrowserCandidate[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index]
    if (!/联想|Lenovo|拯救者|小新|YOGA|ThinkPad|来酷|moto|TAB|Legion|GeekPro|天逸/i.test(title)) continue
    if (/已下架|下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知/.test(title)) continue
    const windowLines = lines.slice(index, index + 10)
    const detail = windowLines.slice(1, 5).join(' ')
    if (/已下架|下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知/.test(detail)) continue
    const priceLine = windowLines.find((value) => /价格[:：]|(?:¥|￥)\s*\d/.test(value ?? ''))
    const price = priceLine ? parsePrice(priceLine) : undefined
    if (!price) continue
    const matchScore = getMatchScore(sku, title, detail)
    if (matchScore < 0.65 || !hasModelSignal(sku, title, detail) || hasHardConflict(sku, title, detail)) continue
    const discounts = extractDiscountNotes(...windowLines)
    candidates.push({
      source,
      discoveryMethod,
      title,
      detail,
      price,
      couponAdjustedPrice: /券|补贴|国补|政府|预减|已减/.test(priceLine ?? '') ? price : undefined,
      discountNotes: discounts.discountNotes,
      platformCouponNotes: discounts.platformCouponNotes,
      educationDiscountNotes: discounts.educationDiscountNotes,
      governmentSubsidyNotes: discounts.governmentSubsidyNotes,
      priceType: /含国补|补贴后|国补后/.test(priceLine ?? '') ? 'post_subsidy_price' : 'display_price',
      url,
      platform: source === 'jd' ? '京东联想自营官方店分类页' : '联想商城品牌分类页',
      matchScore,
      rawText: [title, detail, priceLine, ...discounts.discountNotes].filter(Boolean).join('\n'),
    })
  }
  return candidates.sort((a, b) => b.matchScore - a.matchScore || (a.price ?? 0) - (b.price ?? 0)).slice(0, 2)
}

function tokenSet(value: string) {
  return new Set(value.split('|').filter(Boolean))
}

function getMatchScore(sku: StandardInventorySku, title: string, detail?: string) {
  const skuFingerprint = tokenSet(buildConfigFingerprint(sku.productName, sku.spec))
  const candidateFingerprint = tokenSet(buildConfigFingerprint(title, detail))
  if (!skuFingerprint.size || !candidateFingerprint.size) return 0

  let matched = 0
  for (const token of skuFingerprint) {
    if (candidateFingerprint.has(token)) matched += 1
  }
  return matched / skuFingerprint.size
}

function extractGpu(value: string) {
  return value.toUpperCase().match(/RTX\s?(3050|4050|4060|4070|5050|5060|5070|5070TI|5080|5090)/)?.[1]
}

function extractMemory(value: string) {
  return value.toUpperCase().replace(/GB/g, 'G').match(/(?:^|[^0-9])((?:8|12|16|24|32|64)G)(?:[^0-9]|$)/)?.[1]
}

function extractStorage(value: string) {
  return value.toUpperCase().replace(/固态|SSD/g, '').replace(/TB/g, 'T').replace(/GB/g, 'G').match(/(?:^|[^0-9])((?:128|256|512)G|[12]T)(?:[^0-9]|$)/)?.[1]
}

function getModelSignal(value: string) {
  const text = value.toUpperCase().replace(/\s+/g, '')
  return text.match(/(THINKPAD|YOGA|小新|拯救者|LEGION|来酷|LECOO|斗战者|[RY]\d{4}P?|Y\d{4}P?|战\d{4}|N\d{3}[A-Z]?|PRO\d{2}(?:C|GT)?|AIR\d{2}C?|TAB|Y700|MOTO|RAZR|EDGE)/)?.[1]
}

function hasModelSignal(sku: StandardInventorySku, title: string, detail?: string) {
  const skuModel = getModelSignal(`${sku.productName} ${sku.spec ?? ''}`)
  const candidateModel = getModelSignal(`${title} ${detail ?? ''}`)
  return !skuModel || !candidateModel || skuModel === candidateModel
}

function hasHardConflict(sku: StandardInventorySku, title: string, detail?: string) {
  const skuText = `${sku.productName} ${sku.spec ?? ''}`
  const candidateText = `${title} ${detail ?? ''}`
  const skuGpu = extractGpu(skuText)
  const candidateGpu = extractGpu(candidateText)
  if (skuGpu && candidateGpu && skuGpu !== candidateGpu) return true

  const skuCpu = skuText.toUpperCase().match(/(?:I[3579]-?\d{4,5}[A-Z]*|R[3579]-?[A-Z]?\d{3,5}[A-Z]*|ULTRA\s?[579]-?\d{3}[A-Z]*)/)?.[0]?.replace(/\s+/g, '')
  const candidateCpu = candidateText.toUpperCase().match(/(?:I[3579]-?\d{4,5}[A-Z]*|R[3579]-?[A-Z]?\d{3,5}[A-Z]*|ULTRA\s?[579]-?\d{3}[A-Z]*)/)?.[0]?.replace(/\s+/g, '')
  if (skuCpu && candidateCpu && skuCpu !== candidateCpu) return true

  const skuMemory = extractMemory(skuText)
  const candidateMemory = extractMemory(candidateText)
  if (skuMemory && candidateMemory && skuMemory !== candidateMemory) return true

  const skuStorage = extractStorage(skuText)
  const candidateStorage = extractStorage(candidateText)
  if (skuStorage && candidateStorage && skuStorage !== candidateStorage) return true

  return false
}

function isSubsidyCatalogSku(sku: StandardInventorySku) {
  const text = `${sku.category ?? ''} ${sku.jdSubcategory ?? ''} ${sku.sourceCategory ?? ''} ${sku.productName} ${sku.spec ?? ''}`.toUpperCase()
  if (/电脑配件|耳机音箱|显示器|打印机|键盘|鼠标|适配器|支架|保护夹|钢化膜|背包|耗材|手写笔|散热|贴膜/.test(text)) return false
  return /游戏笔记本|轻薄笔记本|平板电脑|一体机|商务台式|游戏主机|手机|平板|TAB|PAD|Y700|MOTO|RAZR|EDGE|PHN|[RY]\d{4}|Y\d{4}|THINKPAD|YOGA|小新|拯救者/.test(text)
}

function priceBasisFor(candidate: BrowserCandidate) {
  if (candidate.discoveryMethod === 'locked_product_url') {
    return candidate.source === 'jd'
      ? '京东商品详情页锁定 URL 展示价格；由本地 Chrome 浏览器 RPA 直接打开采集。'
      : '联想商城商品详情页锁定 URL 展示价格；由本地 Chrome 浏览器 RPA 直接打开采集。'
  }
  if (candidate.source === 'lenovo_official') return '联想商城搜索结果公开展示价格；由本地浏览器 RPA 采集。'
  if (candidate.source === 'jd') return '京东联想自营官方店展示价格；由本地 Chrome 浏览器 RPA 从固定店铺入口采集。'
  return candidate.priceType === 'post_subsidy_price'
    ? '慢慢买收录的淘宝/天猫含国补展示价；仅作防流失比价参考。'
    : '慢慢买收录的淘宝/天猫展示价；仅作防流失比价参考。'
}

async function savePageArtifacts(page: Page, prefix: string) {
  const screenshotPath = artifactPath(`${prefix}.png`)
  const textPath = artifactPath(`${prefix}.txt`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  await fs.writeFile(textPath, await page.locator('body').innerText().catch(() => ''), 'utf-8')
  return { screenshotPath, textPath }
}

async function loadProductUrlLocks() {
  const lockPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-product-url-locks.json')
  const snapshot = await fs.readFile(lockPath, 'utf-8')
    .then((content) => JSON.parse(content) as ProductUrlLockSnapshot)
    .catch(() => undefined)
  const bySku = new Map<string, NonNullable<ProductUrlLockSnapshot['locks']>>()
  for (const lock of snapshot?.locks ?? []) {
    if (lock.matchStatus === 'unavailable') continue
    bySku.set(lock.skuKey, [...(bySku.get(lock.skuKey) ?? []), lock])
  }
  return bySku
}

function getLockedUrlsForSource(
  locks: Map<string, NonNullable<ProductUrlLockSnapshot['locks']>>,
  sku: StandardInventorySku,
  source: MarketplaceSource,
) {
  return (locks.get(sku.skuKey) ?? [])
    .filter((lock) => {
      if (source === 'lenovo_official') return lock.source === 'lenovo_official' && isLenovoProductUrl(lock.url)
      if (source === 'jd') return /^jd_/.test(lock.source) && isJdProductUrl(lock.url)
      return false
    })
    .map((lock) => lock.url)
}

async function collectLockedProductUrl(
  page: Page,
  sku: StandardInventorySku,
  source: MarketplaceSource,
  url: string,
  options: { trustedLock?: boolean } = {},
): Promise<BrowserCandidate[]> {
  await gotoHuman(page, url)
  if (source === 'jd') await humanScroll(page, 1)
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  if (/验证码|滑块|安全验证|访问受限|Access Denied/i.test(text)) return []
  if (/已下架|下架|待发布|待公布|暂不销售|无货|缺货|售罄|已抢光|到货通知|商品不存在|停止销售/i.test(text)) return []

  const title = await page.title().catch(() => '')
  const lines = normalizeLines(text)
  const titleLine = lines.find((line) => /联想|Lenovo|拯救者|小新|YOGA|ThinkPad|来酷|moto|TAB|Legion/i.test(line)) ?? title
  const detail = lines.slice(0, 80).filter((line) => /型号|编号|配置|处理器|内存|硬盘|显卡|屏|RTX|Ultra|i[3579]|R[3579]|[0-9]{2,}G|[12]T/i.test(line)).slice(0, 8).join(' ')
  if (hasHardConflict(sku, titleLine, detail)) return []

  const detectedMatchScore = getMatchScore(sku, titleLine, detail)
  if (!options.trustedLock && (detectedMatchScore < 0.65 || !hasModelSignal(sku, titleLine, detail))) return []
  const matchScore = options.trustedLock ? Math.max(detectedMatchScore, 0.9) : detectedMatchScore
  const priceLine = lines.find((line) => /商城价|京东价|秒杀价|到手价|售价|价格[:：]|(?:¥|￥)\s*\d/.test(line))
  const price = priceLine ? parsePrice(priceLine) : undefined
  const discounts = extractDiscountNotes(...lines.slice(0, 140))
  const platformCouponAmount = extractDiscountAmount(discounts.platformCouponNotes, /券|领券|优惠券|平台券|满减|红包/)
  const couponPricing = applyVisiblePlatformCoupon(source, price, platformCouponAmount)
  return [{
    source,
    discoveryMethod: 'locked_product_url',
    title: titleLine,
    detail,
    price: couponPricing.acceptedPrice,
    couponAdjustedPrice: couponPricing.couponAdjustedPrice ?? (/券|补贴|国补|政府|预减|已减/.test(priceLine ?? '') ? price : undefined),
    platformCouponAmount,
    educationDiscountAmount: extractDiscountAmount(discounts.educationDiscountNotes, /教育|学生|校园/),
    governmentSubsidyAmount: extractDiscountAmount(discounts.governmentSubsidyNotes, /补贴|国补|政府/),
    discountNotes: discounts.discountNotes,
    platformCouponNotes: discounts.platformCouponNotes,
    educationDiscountNotes: discounts.educationDiscountNotes,
    governmentSubsidyNotes: discounts.governmentSubsidyNotes,
    priceType: couponPricing.priceType ?? (/含国补|补贴后|国补后/.test(priceLine ?? '') ? 'post_subsidy_price' : 'display_price'),
    url,
    platform: source === 'jd' ? '锁定京东商品详情页' : '锁定联想商城商品详情页',
    matchScore,
    rawText: [titleLine, detail, priceLine ?? '详情页价格节点暂未展开，先锁定 URL，后续用目标网址刷新实时价。', couponPricing.couponAdjustedPrice !== undefined ? `京东平台券后采信价 ${couponPricing.couponAdjustedPrice}` : undefined, ...discounts.discountNotes].filter(Boolean).join('\n'),
  }]
}

async function collectLenovoOfficial(page: Page, sku: StandardInventorySku, keyword: string): Promise<BrowserCandidate[]> {
  await page.goto(lenovoShopHomeUrl, { waitUntil: 'domcontentloaded', timeout: 12000 })
  await page.waitForTimeout(900)
  await page.locator('input.searc').first().fill(keyword, { timeout: 5000 })
  await page.keyboard.press('Enter')
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => undefined)
  await page.waitForTimeout(1200)
  const url = page.url()
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  if (/验证码|滑块|安全验证|访问受限|Access Denied/i.test(text)) return []

  const lines = normalizeLines(text)
  const candidates: BrowserCandidate[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!/联想|Lenovo|拯救者|小新|YOGA|ThinkPad|来酷|moto|TAB/i.test(line)) continue
    const detail = lines[index + 1] ?? ''
    const windowLines = lines.slice(index, index + 8)
    const priceLine = windowLines.find((value) => /价格[:：]|(?:¥|￥)\s*\d/.test(value ?? ''))
    const price = priceLine ? parsePrice(priceLine) : undefined
    if (!price) continue
    const matchScore = getMatchScore(sku, line, detail)
    if (matchScore < 0.65 || !hasModelSignal(sku, line, detail) || hasHardConflict(sku, line, detail)) continue
    const discounts = extractDiscountNotes(...windowLines)
    const platformCouponAmount = extractDiscountAmount(discounts.platformCouponNotes, /券|领券|优惠券|平台券/)
    const educationDiscountAmount = extractDiscountAmount(discounts.educationDiscountNotes, /教育|学生|校园/)
    const governmentSubsidyAmount = extractDiscountAmount(discounts.governmentSubsidyNotes, /补贴|国补|政府/)
    candidates.push({
      source: 'lenovo_official',
      discoveryMethod: 'search',
      title: line,
      detail,
      price,
      platformCouponAmount,
      educationDiscountAmount,
      governmentSubsidyAmount,
      discountNotes: discounts.discountNotes,
      platformCouponNotes: discounts.platformCouponNotes,
      educationDiscountNotes: discounts.educationDiscountNotes,
      governmentSubsidyNotes: discounts.governmentSubsidyNotes,
      priceType: 'display_price',
      url,
      matchScore,
      rawText: [line, detail, priceLine, ...discounts.discountNotes].filter(Boolean).join('\n'),
    })
  }
  return candidates.sort((a, b) => b.matchScore - a.matchScore || (a.price ?? 0) - (b.price ?? 0)).slice(0, 2)
}

async function collectJdStoreOfficial(page: Page, sku: StandardInventorySku, keyword: string, mallUrl: string, platformName: string): Promise<BrowserCandidate[]> {
  const separator = mallUrl.includes('?') ? '&' : '?'
  const url = `${mallUrl}${separator}keyword=${encodeURIComponent(keyword)}`
  await gotoHuman(page, url)
  await humanScroll(page, 2)
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  if (/验证码|滑块|安全验证|访问受限|Access Denied/i.test(text)) return []

  const itemCards = await extractJdItemCards(page)
  const directCandidates: BrowserCandidate[] = []
  for (const card of itemCards) {
    if (directCandidates.length >= 2) break
    if (!/联想|Lenovo|拯救者|小新|YOGA|ThinkPad|来酷|moto|TAB|Legion|斗战者/i.test(card.text)) continue
    const matchScore = getMatchScore(sku, card.title || card.text, card.text)
    if (matchScore < 0.65 || !hasModelSignal(sku, card.title, card.text) || hasHardConflict(sku, card.title, card.text)) continue
    const detailCandidates = await collectLockedProductUrl(page, sku, 'jd', card.url)
    directCandidates.push(...detailCandidates.map((candidate) => ({
      ...candidate,
      platform: platformName,
      rawText: [card.text, candidate.rawText].filter(Boolean).join('\n'),
    })))
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => undefined)
    await page.waitForTimeout(600)
  }
  if (directCandidates.length) return directCandidates

  const lines = normalizeLines(text)
  const candidates: BrowserCandidate[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!/联想|Lenovo|拯救者|小新|YOGA|ThinkPad|来酷|moto|TAB|Legion/i.test(line)) continue
    const windowLines = lines.slice(index, index + 10)
    const detail = windowLines.slice(1, 4).join(' ')
    const priceLine = windowLines.find((value) => /(?:¥|￥)\s*\d|价格[:：]/.test(value ?? ''))
    const price = priceLine ? parsePrice(priceLine) : undefined
    if (!price) continue
    const matchScore = getMatchScore(sku, line, detail)
    if (matchScore < 0.65 || !hasModelSignal(sku, line, detail) || hasHardConflict(sku, line, detail)) continue
    const discounts = extractDiscountNotes(...windowLines)
    candidates.push({
      source: 'jd',
      discoveryMethod: 'search',
      title: line,
      detail,
      price,
      couponAdjustedPrice: /券|补贴|国补|政府|预减|已减/.test(priceLine ?? '') ? price : undefined,
      discountNotes: discounts.discountNotes,
      platformCouponNotes: discounts.platformCouponNotes,
      educationDiscountNotes: discounts.educationDiscountNotes,
      governmentSubsidyNotes: discounts.governmentSubsidyNotes,
      priceType: /含国补|补贴后|国补后/.test(priceLine ?? '') ? 'post_subsidy_price' : 'display_price',
      url,
      platform: platformName,
      matchScore,
      rawText: [line, detail, priceLine, ...discounts.discountNotes].filter(Boolean).join('\n'),
    })
  }
  return candidates.sort((a, b) => b.matchScore - a.matchScore || (a.price ?? 0) - (b.price ?? 0)).slice(0, 2)
}

async function collectJdCategoryOfficial(page: Page, sku: StandardInventorySku, url: string, platformName: string): Promise<BrowserCandidate[]> {
  await gotoJdCategoryLikeHuman(page, url)
  const firstText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  if (/验证码|滑块|安全验证|访问受限|Access Denied|快速验证/i.test(firstText)) return []

  const directCandidates: BrowserCandidate[] = []
  const seen = new Set<string>()
  for (let step = 0; step < 2; step += 1) {
    const cards = (await extractJdItemCards(page)).slice(0, 10)
    for (const card of cards) {
      if (directCandidates.length >= 1) break
      if (seen.has(card.url)) continue
      seen.add(card.url)
      const cardText = `${card.title} ${card.text}`.trim()
      const hasReadableCardText = cardText.length >= 6
      if (hasReadableCardText && !/联想|Lenovo|拯救者|小新|YOGA|ThinkPad|来酷|moto|TAB|Legion|斗战者|GeekPro|天逸/i.test(cardText)) continue
      if (hasReadableCardText) {
        const matchScore = getMatchScore(sku, card.title || card.text, card.text)
        if (hasHardConflict(sku, card.title, card.text)) continue
        if (matchScore < 0.45 && !hasModelSignal(sku, card.title, card.text)) continue
      }
      const detailCandidates = await collectLockedProductUrl(page, sku, 'jd', card.url)
      directCandidates.push(...detailCandidates.map((candidate) => ({
        ...candidate,
        platform: platformName,
        discoveryMethod: 'brand_category_browse' as const,
        rawText: [card.text, candidate.rawText].filter(Boolean).join('\n'),
      })))
      await gotoJdCategoryLikeHuman(page, url).catch(() => undefined)
    }
    if (directCandidates.length) break
    await humanScroll(page, 1)
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    if (/验证码|滑块|安全验证|访问受限|Access Denied|快速验证/i.test(text)) break
  }
  return directCandidates.sort((a, b) => b.matchScore - a.matchScore || (a.price ?? 0) - (b.price ?? 0)).slice(0, 1)
}

async function gotoJdCategoryLikeHuman(page: Page, url: string) {
  const isSeriesMenuUrl = /lenovo1\.jd\.com\/view_search-/i.test(url)
  if (!isSeriesMenuUrl) {
    await gotoHuman(page, url)
    await humanScroll(page, 2)
    return
  }

  await gotoHuman(page, jdLenovoCategoryUrls.home)
  await humanScroll(page, 1)
  const categoryId = url.match(/view_search-\d+-(\d+)-/)?.[1]
  const menuLink = categoryId
    ? page.locator(`a[href*="${categoryId}"]`).filter({ hasText: /.+/ }).first()
    : page.locator(`a[href="${url}"]`).first()
  const count = await menuLink.count().catch(() => 0)
  if (count) {
    await menuLink.hover({ timeout: 5000 }).catch(() => undefined)
    await humanPause(page, 700, 1600)
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined),
      menuLink.click({ timeout: 5000 }).catch(async () => {
        await gotoHuman(page, url)
      }),
    ])
  } else {
    await gotoHuman(page, url)
  }
  await humanPause(page, 2500, 5000)
  await humanScroll(page, 2)
}

async function extractJdItemCards(page: Page) {
  return page.$$eval('a[href*="item.jd.com"]', (anchors) => {
    const normalizeUrl = (href: string | null) => {
      if (!href) return ''
      if (href.startsWith('//')) return `https:${href}`
      if (href.startsWith('/')) return `https://item.jd.com${href}`
      return href
    }
    const seen = new Set<string>()
    const cards: Array<{ url: string; title: string; text: string }> = []
    for (const anchor of anchors) {
      const url = normalizeUrl(anchor.getAttribute('href')).replace(/^http:/, 'https:')
      if (!/^https:\/\/item\.jd\.com\/\d+\.html(?:[?#].*)?$/i.test(url)) continue
      const container = anchor.closest('li, .jItem, .gl-item, .item, .mc, .jSubObject, .jGoodsInfo') ?? anchor.parentElement
      const text = (container?.textContent ?? anchor.textContent ?? '').replace(/\s+/g, ' ').trim()
      const title = (anchor.textContent ?? anchor.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim()
      if (seen.has(url)) continue
      seen.add(url)
      cards.push({ url, title, text })
    }
    return cards.slice(0, 20)
  }).catch(() => [])
}

async function collectJdLenovoSelfOfficial(page: Page, sku: StandardInventorySku, keyword: string): Promise<BrowserCandidate[]> {
  return collectJdStoreOfficial(page, sku, keyword, jdLenovoSelfMallUrl, '京东联想自营官方店')
}

async function collectJdLenovoAuthorizedOfficial(page: Page, sku: StandardInventorySku, keyword: string): Promise<BrowserCandidate[]> {
  return collectJdStoreOfficial(page, sku, keyword, jdLenovoAuthorizedMallUrl, '京东联想官方授权店')
}

async function collectManmanbuy(page: Page, sku: StandardInventorySku, keyword: string): Promise<BrowserCandidate[]> {
  const url = `https://s.manmanbuy.com/pc/search/result?keyword=${encodeURIComponent(keyword)}&btnSearch=%E6%90%9C%E7%B4%A2`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 })
  await page.waitForTimeout(900)
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  if (/验证码|滑块|安全验证|访问受限|Access Denied/i.test(text)) return []

  const lines = normalizeLines(text)
  const candidates: BrowserCandidate[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index]
    if (!/联想|Lenovo|拯救者|小新|YOGA|ThinkPad|来酷|moto|TAB/i.test(title)) continue
    if (/已结束|已过期|售罄|下架/.test(title)) continue
    const priceLineIndex = [index + 1, index + 2, index + 3].find((lineIndex) => /\d{3,6}(?:\.\d{1,2})?元/.test(lines[lineIndex] ?? ''))
    if (!priceLineIndex) continue
    const priceLine = lines[priceLineIndex]
    const price = parsePrice(priceLine)
    if (!price) continue
    const metaLine = [lines[priceLineIndex + 1], lines[priceLineIndex + 2]].find((line) => /京东|天猫|淘宝/.test(line ?? '')) ?? ''
    const platform = metaLine.match(/(京东商城|天猫商城|淘宝|天猫|京东)/)?.[1]
    if (!platform) continue
    const source: MarketplaceSource = platform.includes('京东') ? 'jd' : 'taobao_subsidy'
    const matchScore = getMatchScore(sku, title)
    if (matchScore < 0.65 || !hasModelSignal(sku, title) || hasHardConflict(sku, title)) continue
    const windowLines = lines.slice(index, priceLineIndex + 5)
    const discounts = extractDiscountNotes(...windowLines)
    const platformCouponAmount = extractDiscountAmount(discounts.platformCouponNotes, /券|领券|优惠券|平台券|满减|红包/)
    const couponPricing = applyVisiblePlatformCoupon(source, price, platformCouponAmount)
    candidates.push({
      source,
      discoveryMethod: 'search',
      title,
      price: couponPricing.acceptedPrice,
      couponAdjustedPrice: couponPricing.couponAdjustedPrice ?? (/券|补贴|国补|政府|预减|已减/.test(priceLine) ? price : undefined),
      platformCouponAmount,
      discountNotes: discounts.discountNotes,
      platformCouponNotes: discounts.platformCouponNotes,
      educationDiscountNotes: discounts.educationDiscountNotes,
      governmentSubsidyNotes: discounts.governmentSubsidyNotes,
      priceType: couponPricing.priceType ?? (/含国补|补贴后|国补后/.test(priceLine) ? 'post_subsidy_price' : 'display_price'),
      url,
      platform,
      publishedAt: metaLine.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})/)?.[1],
      matchScore,
      rawText: [title, priceLine, metaLine, ...discounts.discountNotes].filter(Boolean).join('\n'),
    })
  }
  return candidates.sort((a, b) => b.matchScore - a.matchScore || (a.price ?? 0) - (b.price ?? 0)).slice(0, 4)
}

function isManmanbuyCandidate(candidate: BrowserCandidate) {
  return /manmanbuy\.com/i.test(candidate.url)
}

function toRecord(sku: StandardInventorySku, keyword: string, candidate: BrowserCandidate, screenshotPath?: string): MarketplacePriceRecord {
  const capturedAt = new Date().toISOString()
  const directOfficialUrl = isDirectOfficialProductUrl(candidate.source, candidate.url)
  const officialButNotDirect = !isManmanbuyCandidate(candidate) && !directOfficialUrl
  return {
    source: candidate.source,
    sourceLabel: sourceLabels[candidate.source],
    sourceType: sourceTypes[candidate.source],
    productId: sku.skuKey,
    query: keyword,
    configuredUrl: candidate.url,
    productName: sku.productName,
    matchTitle: candidate.title,
    price: candidate.price,
    couponAdjustedPrice: candidate.couponAdjustedPrice,
    preSubsidyPrice: candidate.priceType === 'pre_subsidy_price' ? candidate.price : undefined,
    postSubsidyPrice: candidate.priceType === 'post_subsidy_price' ? candidate.price : undefined,
    priceType: candidate.priceType,
    priceBasis: isManmanbuyCandidate(candidate)
      ? '慢慢买浏览器页面兜底线索；只作为官方价缺口辅助参考，需回到京东自营或联想商城详情页确认后才能作为正式门店零售价。'
      : priceBasisFor(candidate),
    taxIncluded: candidate.source === 'jd' || candidate.source === 'lenovo_official',
    serviceIncluded: candidate.source === 'jd' || candidate.source === 'lenovo_official',
    confidence: isManmanbuyCandidate(candidate) || officialButNotDirect ? 'manual' : candidate.matchScore >= 0.85 ? 'confirmed' : 'manual',
    collectionStatus: isManmanbuyCandidate(candidate) || officialButNotDirect ? 'manual_review_required' : 'captured',
    evidence: {
      evidenceUrl: candidate.url,
      screenshotPath,
      capturedAt,
      capturedBy: 'browser_rpa',
      note: `本地 Chrome 浏览器 RPA 采集；${isManmanbuyCandidate(candidate) ? '慢慢买兜底线索' : candidate.discoveryMethod === 'locked_product_url' ? '锁定商品详情页直达采集' : candidate.discoveryMethod === 'brand_category_browse' ? '品牌首页/分类页定位线索，未锁定详情页前不作为正式官方价' : '关键词搜索定位线索，未锁定详情页前不作为正式官方价'}；匹配分 ${candidate.matchScore.toFixed(2)}。${candidate.discountNotes?.length ? ' 优惠只作备注，不覆盖主零售价。' : ''}`,
    },
    raw: {
      platform: candidate.platform,
      publishedAt: candidate.publishedAt,
      detail: candidate.detail,
      discountNotes: candidate.discountNotes,
      platformCouponNotes: candidate.platformCouponNotes,
      educationDiscountNotes: candidate.educationDiscountNotes,
      governmentSubsidyNotes: candidate.governmentSubsidyNotes,
      platformCouponAmount: candidate.platformCouponAmount ?? null,
      educationDiscountAmount: candidate.educationDiscountAmount ?? null,
      governmentSubsidyAmount: candidate.governmentSubsidyAmount ?? null,
      couponAmountCaptureStatus: candidate.platformCouponAmount || candidate.educationDiscountAmount || candidate.governmentSubsidyAmount ? 'amount_captured' : 'amount_not_expanded',
      rawText: candidate.rawText,
      matchScore: candidate.matchScore,
      discoveryMethod: candidate.discoveryMethod ?? 'search',
    },
  }
}

function pickSkus(inventory: StandardInventorySnapshot, missingOfficialPriceSkuKeys = new Set<string>()) {
  const targetSkuKeys = new Set(config.marketplaceBrowser.skuKeys)
  return inventory.skus
    .filter((sku) => sku.currentStock > 0 && (
      targetSkuKeys.size
        ? targetSkuKeys.has(sku.skuKey)
        : missingOfficialPriceSkuKeys.has(sku.skuKey) || isSubsidyCatalogSku(sku)
    ))
    .sort((a, b) => {
      const missingDelta = Number(missingOfficialPriceSkuKeys.has(b.skuKey)) - Number(missingOfficialPriceSkuKeys.has(a.skuKey))
      if (missingDelta) return missingDelta
      const important = (sku: StandardInventorySku) => /游戏笔记本|轻薄笔记本|平板电脑|手机|游戏主机|一体机|商务台式/.test(`${sku.category ?? ''}${sku.productName}`)
      return Number(important(b)) - Number(important(a)) || b.currentStock - a.currentStock
    })
    .slice(0, config.marketplaceBrowser.maxSkus)
}

async function loadMissingOfficialPriceSkuKeys() {
  const retailZonePath = path.resolve(config.lenovoRetail.artifactDir, 'latest-retail-zone-snapshot.json')
  const snapshot = await fs.readFile(retailZonePath, 'utf-8')
    .then((content) => JSON.parse(content) as { decisions?: { items?: Array<{ skuKey?: string; jdPrice?: number; lenovoOfficialPrice?: number }> } })
    .catch(() => undefined)
  return new Set((snapshot?.decisions?.items ?? [])
    .filter((item) => item.skuKey && !item.jdPrice && !item.lenovoOfficialPrice)
    .map((item) => item.skuKey as string))
}

function buildSourceSummaries(records: MarketplacePriceRecord[]) {
  return (['jd', 'lenovo_official'] as MarketplaceSource[]).map((source) => {
    const sourceRecords = records.filter((record) => record.source === source)
    return {
      source,
      label: sourceLabels[source],
      sourceType: sourceTypes[source],
      recordCount: sourceRecords.length,
      capturedCount: sourceRecords.length,
    }
  })
}

function shouldCollectSource(source: MarketplaceSource) {
  return config.marketplaceBrowser.sources.includes(source)
}

export async function collectBrowserMarketplacePrices() {
  throw new Error(
    'collectBrowserMarketplacePrices 已封禁：外部采集只允许在当前已登录默认 Chrome 可见会话手工执行，禁止 Playwright 新建浏览器/新上下文采集。',
  )
  const inventoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf-8')) as StandardInventorySnapshot
  const missingOfficialPriceSkuKeys = await loadMissingOfficialPriceSkuKeys()
  const productUrlLocks = await loadProductUrlLocks()
  const browser: Browser = await chromium.launch({
    channel: config.marketplaceBrowser.channel,
    headless: config.marketplaceBrowser.headless,
    slowMo: config.marketplaceBrowser.slowMoMs,
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  await page.goto(lenovoShopHomeUrl, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => undefined)
  const records: MarketplacePriceRecord[] = []
  const errors: Array<{ skuKey: string; source: string; message: string }> = []

  const targetSkus = pickSkus(inventory, missingOfficialPriceSkuKeys)
  for (const [index, sku] of targetSkus.entries()) {
    console.error(`[browser-marketplace] ${index + 1}/${targetSkus.length} ${sku.skuKey} ${sku.productName}`)
    const keywords = buildCategorySearchKeywords(sku)
    const keyword = keywords[0]
    if (shouldCollectSource('lenovo_official')) try {
      const candidates: BrowserCandidate[] = []
      for (const lockedUrl of getLockedUrlsForSource(productUrlLocks, sku, 'lenovo_official')) {
        candidates.push(...await collectLockedProductUrl(page, sku, 'lenovo_official', lockedUrl, { trustedLock: true }))
        if (candidates.length) break
      }
      const targets = getCategoryBrowseTargets(sku)
      if (!candidates.length) candidates.push(...await collectFromListingPage(page, sku, targets.lenovoUrl, 'lenovo_official', 'brand_category_browse'))
      for (const currentKeyword of keywords) {
        if (candidates.length) break
        candidates.push(...await collectLenovoOfficial(page, sku, currentKeyword))
        if (candidates.length) break
      }
      if (!candidates.length) {
        for (const currentKeyword of keywords) {
          candidates.push(...await collectManmanbuy(page, sku, currentKeyword))
          if (candidates.length) break
        }
      }
      const artifacts = candidates.length ? await savePageArtifacts(page, `lenovo-official-${sku.skuKey}`) : undefined
      records.push(...candidates.map((candidate) => toRecord(sku, keyword, candidate, artifacts?.screenshotPath)))
      console.error(`[browser-marketplace] lenovo_official ${sku.skuKey} matched=${candidates.length}`)
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      errors.push({ skuKey: sku.skuKey, source: 'lenovo_official', message })
      console.error(`[browser-marketplace] lenovo_official ${sku.skuKey} error=${message}`)
    }

    if (shouldCollectSource('jd')) try {
      const candidates: BrowserCandidate[] = []
      for (const lockedUrl of getLockedUrlsForSource(productUrlLocks, sku, 'jd')) {
        candidates.push(...await collectLockedProductUrl(page, sku, 'jd', lockedUrl, { trustedLock: true }))
        if (candidates.length) break
      }
      const targets = getCategoryBrowseTargets(sku)
      for (const seriesUrl of getJdSeriesBrowseUrls(sku)) {
        if (candidates.length) break
        candidates.push(...await collectJdCategoryOfficial(page, sku, seriesUrl, '京东联想自营旗舰店系列菜单页'))
      }
      if (!candidates.length) candidates.push(...await collectJdCategoryOfficial(page, sku, jdLenovoCategoryUrls.home, '京东联想自营旗舰店首页'))
      if (!candidates.length) candidates.push(...await collectJdCategoryOfficial(page, sku, targets.jdUrl, '京东联想自营旗舰店分类/系列页'))
      if (!candidates.length && targets.jdUrl !== jdLenovoCategoryUrls.thinNotebook) {
        candidates.push(...await collectJdCategoryOfficial(page, sku, jdSupplementCategoryUrls.supermarket, '京东超市联想自营入口'))
      }
      if (!candidates.length) candidates.push(...await collectJdCategoryOfficial(page, sku, jdSupplementCategoryUrls.authorized, '京东联想官方授权店'))
      for (const currentKeyword of keywords) {
        if (candidates.length) break
        candidates.push(...await collectJdLenovoSelfOfficial(page, sku, currentKeyword))
        if (candidates.length) break
      }
      for (const currentKeyword of keywords) {
        if (candidates.length) break
        candidates.push(...await collectJdLenovoAuthorizedOfficial(page, sku, currentKeyword))
        if (candidates.length) break
      }
      const artifacts = candidates.length ? await savePageArtifacts(page, `jd-lenovo-self-${sku.skuKey}`) : undefined
      records.push(...candidates.map((candidate) => toRecord(sku, keyword, candidate, artifacts?.screenshotPath)))
      console.error(`[browser-marketplace] jd ${sku.skuKey} matched=${candidates.length}`)
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      errors.push({ skuKey: sku.skuKey, source: 'jd_lenovo_self', message })
      console.error(`[browser-marketplace] jd ${sku.skuKey} error=${message}`)
    }
  }

  await browser.close()

  const manualInputPath = artifactPath('browser-marketplace-records.json')
  await fs.writeFile(manualInputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    collector: 'browser_marketplace_collector',
    sources: buildSourceSummaries(records),
    itemCount: records.length,
    records,
    errors,
  }, null, 2), 'utf-8')

  const result = await saveMarketplacePriceSnapshot(manualInputPath)
  return {
    ...result,
    manualInputPath,
    browserRecordCount: records.length,
    errors,
    browserRecords: records,
  }
}
