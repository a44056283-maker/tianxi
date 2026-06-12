import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { config } from '../config.js'
import type { StandardInventorySku, StandardInventorySnapshot } from '../types.js'
import { saveRetailZoneSnapshot } from '../inventoryQuote/dataService.js'
import { saveMarketplacePriceSnapshot, type MarketplacePriceRecord } from './marketplacePriceCollector.js'
import { saveProductUrlLockSnapshot } from './productUrlLockStore.js'

type Candidate = {
  sku: StandardInventorySku
  tokens: Set<string>
  mustTokens: Set<string>
  familyTokens: Set<string>
}

type CapturedItem = {
  url: string
  platformSkuId?: string
  title: string
  text: string
}

type CandidateUrl = {
  url: string
  discoveryText?: string
  trusted: boolean
  sourceUrl?: string
}

const defaultSourceUrls = [
  'https://lenovo1.jd.com/',
  'https://mall.jd.com/index-11713475.html',
  'https://mall.jd.com/index-12894711.html',
  'https://mall.jd.com/index-935158.html',
]

const itemUrlPattern = /^https:\/\/item\.jd\.com\/\d+\.html(?:[?#].*)?$/i
const jdGenericTitlePattern = /京东\(JD\.COM\)-正品低价|京东首页|JD\.COM-正品低价/i
const jdItemDetailSignalPattern = /商品详情|规格参数|加入购物车|立即购买|选择版本|京东价|联想|LENOVO|来酷|LECOO|拯救者|小新|YOGA|LEGION/i
const verificationPattern = /验证码|滑块|安全验证|访问受限|快速验证|请完成验证|身份验证|登录后|请登录/i
const unavailablePattern = /已下架|商品不存在|暂不销售|无货|缺货|售罄|到货通知/i
const accessoryPattern = /鼠标|键盘|耳机|耳麦|支架|适配器|充电器|硬盘|背包|箱包|保护|钢化膜|手写笔|键鼠|电源/i

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function readJson<T>(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
}

function normalizeText(value: string) {
  return value
    .toUpperCase()
    .replace(/酷睿/g, 'I')
    .replace(/锐龙/g, 'R')
    .replace(/英特尔/g, 'INTEL')
    .replace(/联想/g, 'LENOVO')
    .replace(/来酷/g, 'LECOO')
    .replace(/\s+/g, ' ')
}

function addToken(tokens: Set<string>, value?: string) {
  const token = value?.trim().toUpperCase()
  if (token && token.length >= 2) tokens.add(token)
}

function extractTokens(input: string) {
  const text = normalizeText(input)
  const tokens = new Set<string>()
  for (const match of text.matchAll(/\b(?:Y|R)?(?:7000P|7000|9000P|9000|YOGA|AIR|PRO|N155|N175|N176|战7000|斗战者|GEEKPRO|510S|Y700)\b/gi)) addToken(tokens, match[0])
  for (const match of text.matchAll(/\b(?:I[3579]-?\d{4,5}[A-Z]*|ULTRA\s*[579]-?\d{3}[A-Z]*|R[3579]-?[A-Z]?\d{3,4}[A-Z]*|H255|8945HX|14900HX|13645HX|275HX?)\b/gi)) addToken(tokens, match[0].replace(/[-\s]+/g, ''))
  for (const match of text.matchAll(/\bRTX\s*(?:3050|4050|4060|4070|5060|5070|5080)\b/gi)) addToken(tokens, match[0].replace(/\s+/g, ''))
  for (const match of text.matchAll(/\b(?:3050|4050|4060|4070|5060|5070|5080)(?:TI)?\b/gi)) addToken(tokens, `RTX${match[0]}`)
  for (const match of text.matchAll(/\b(?:8|12|16|24|32|64)G(?:B)?\b/gi)) addToken(tokens, match[0].replace(/B$/i, ''))
  for (const match of text.matchAll(/\b(?:256|512)G(?:B)?\b|\b(?:1|2|4)T(?:B)?\b/gi)) addToken(tokens, match[0].replace(/B$/i, ''))
  for (const match of text.matchAll(/\b(?:14|15|16|17|18)(?:\.\d)?(?:英寸|寸)?\b/gi)) addToken(tokens, match[0].replace(/英寸|寸/gi, ''))
  if (/小新/i.test(text)) tokens.add('小新')
  if (/拯救者|LEGION/i.test(text)) tokens.add('拯救者')
  if (/LECOO|来酷/i.test(text)) tokens.add('LECOO')
  if (/斗战者/i.test(text)) tokens.add('斗战者')
  if (/战7000/i.test(text)) tokens.add('战7000')
  if (/OLED/i.test(text)) tokens.add('OLED')
  return tokens
}

function buildCandidate(sku: StandardInventorySku): Candidate {
  const text = `${sku.productName} ${sku.spec ?? ''}`
  const tokens = extractTokens(text)
  const mustTokens = new Set<string>()
  const familyTokens = new Set<string>()

  for (const token of tokens) {
    if (/^(?:I[3579]|ULTRA|R[3579]|H255|8945HX|14900HX|13645HX|275)/i.test(token)) mustTokens.add(token)
    if (/^(?:RTX|8G|12G|16G|24G|32G|64G|256G|512G|1T|2T|4T|OLED)$/i.test(token)) mustTokens.add(token)
    if (/^(?:Y7000P|Y7000|Y9000P|Y9000|R7000P|R7000|R9000P|R9000|小新|YOGA|AIR|PRO|LECOO|斗战者|战7000|GEEKPRO|510S|Y700)$/i.test(token)) familyTokens.add(token)
  }

  return { sku, tokens, mustTokens, familyTokens }
}

function scoreCandidate(candidate: Candidate, pageTokens: Set<string>, pageText: string) {
  const isAccessorySku = accessoryPattern.test(`${candidate.sku.productName} ${candidate.sku.category ?? ''} ${candidate.sku.jdSubcategory ?? ''}`)
  const isAccessoryPage = accessoryPattern.test(pageText)
  const isNotebookSku = /笔记本|游戏本|轻薄本/i.test(`${candidate.sku.category ?? ''} ${candidate.sku.jdSubcategory ?? ''} ${candidate.sku.productName}`)
  const isDesktopPage = /台式|主机|刃7000|刃9000|GEEKPRO|510S/i.test(pageText)
  const familyHits = Array.from(candidate.familyTokens).filter((token) => pageTokens.has(token))
  const mustHits = Array.from(candidate.mustTokens).filter((token) => pageTokens.has(token))
  const tokenHits = Array.from(candidate.tokens).filter((token) => pageTokens.has(token))
  const hasGpuNeed = Array.from(candidate.mustTokens).some((token) => token.startsWith('RTX'))
  const hasGpuHit = mustHits.some((token) => token.startsWith('RTX'))

  if (hasSkuPageConflict(candidate.sku, pageText)) return 0
  if (!isAccessorySku && isAccessoryPage && !/(笔记本|电脑|游戏本|轻薄本|RTX|酷睿|锐龙)/i.test(pageText)) return 0
  if (isNotebookSku && isDesktopPage) return 0
  if (isAccessorySku !== isAccessoryPage && familyHits.length === 0) return 0
  if (!isAccessorySku && familyHits.length === 0) return 0
  if (!isAccessorySku && hasGpuNeed && !hasGpuHit) return 0
  if (!isAccessorySku && mustHits.length < Math.min(3, candidate.mustTokens.size)) return 0

  return familyHits.length * 4 + mustHits.length * 3 + tokenHits.length
}

function hasSkuPageConflict(sku: StandardInventorySku, pageTextInput: string) {
  const skuText = normalizeText(`${sku.productName} ${sku.spec ?? ''}`).replace(/[-\s/]+/g, '')
  const pageText = normalizeText(pageTextInput).replace(/[-\s/]+/g, '')
  const skuCpu = skuText.match(/(?:I[3579]\d{4,5}[A-Z]*|R[3579]\d{3,4}[A-Z]*|ULTRA[579]\d{3}[A-Z]*|H255|8945HX|14900HX|13645HX)/i)?.[0]
  const pageCpu = pageText.match(/(?:I[3579]\d{4,5}[A-Z]*|R[3579]\d{3,4}[A-Z]*|ULTRA[579]\d{3}[A-Z]*|H255|8945HX|14900HX|13645HX|13650HX|14650HX)/i)?.[0]
  if (skuCpu && pageCpu && skuCpu !== pageCpu) return true
  if (/R9/i.test(skuText) && /I[3579]/i.test(pageText)) return true
  if (/I[3579]/i.test(skuText) && /R[3579]/i.test(pageText)) return true
  const skuStorage = skuText.match(/(?:256G|512G|1T|2T|4T)/i)?.[0]
  const pageStorage = pageText.match(/(?:256G|512G|1T|2T|4T)/i)?.[0]
  if (skuStorage && pageStorage && skuStorage !== pageStorage && !pageText.includes(skuStorage)) return true
  return false
}

function pickBestSku(candidates: Candidate[], item: CapturedItem) {
  return pickBestSkuFromText(candidates, item.title, item.text, 14)
}

function pickBestSkuFromText(candidates: Candidate[], title: string, text: string, minScore: number) {
  const pageText = normalizeText(`${title} ${text.slice(0, 12000)}`)
  const pageTokens = extractTokens(pageText)
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, pageTokens, pageText) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best || best.score < minScore) return undefined
  if (ranked[1] && best.score - ranked[1].score < 4) return undefined
  return best
}

function normalizeJdItemUrl(url: string) {
  const match = url.match(/^https:\/\/item\.jd\.com\/(\d+)\.html/i)
  return match ? `https://item.jd.com/${match[1]}.html` : url
}

function getPlatformSkuId(url: string) {
  return url.match(/item\.jd\.com\/(\d+)\.html/i)?.[1]
}

function hasValidJdItemDetail(item: CapturedItem) {
  const text = `${item.title}\n${item.text}`
  if (!itemUrlPattern.test(item.url)) return false
  if (jdGenericTitlePattern.test(item.title)) return false
  if (!jdItemDetailSignalPattern.test(text)) return false
  if (!/[¥￥]\s*[0-9]{2,6}(?:\.[0-9]{1,2})?/.test(text) && !unavailablePattern.test(text)) return false
  return true
}

function extractPrices(text: string) {
  const prices = Array.from(text.matchAll(/[¥￥]\s*([0-9]{2,6}(?:\.[0-9]{1,2})?)/g))
    .map((match) => Number(match[1]))
    .filter((price) => Number.isFinite(price) && price >= 20 && price <= 100000)
  return Array.from(new Set(prices)).sort((a, b) => b - a)
}

function extractPreSubsidyDisplayPrices(text: string) {
  const prices = Array.from(text.matchAll(/[¥￥]\s*([0-9]{3,6})(?!\.)/g))
    .map((match) => Number(match[1]))
    .filter((price) => Number.isFinite(price) && price >= 1000 && price <= 100000)
  return Array.from(new Set(prices)).sort((a, b) => b - a)
}

function extractPromotions(text: string) {
  return Array.from(new Set([
    ...Array.from(text.matchAll(/PLUS(?:专享)?立减\s*[0-9.]+/g)).map((match) => match[0]),
    ...Array.from(text.matchAll(/满\s*\d+\s*减\s*\d+/g)).map((match) => match[0].replace(/\s+/g, '')),
    ...Array.from(text.matchAll(/(?:国家补贴|政府补贴|教育(?:优惠|补贴)|企业会员\d+元补贴|最高返\d+京豆)/g)).map((match) => match[0]),
  ])).slice(0, 12)
}

function extractPlatformCouponAmount(promotions: string[]) {
  for (const promotion of promotions) {
    const match = promotion.match(/满\s*\d+(?:\.\d+)?\s*减\s*([1-9]\d{0,5}(?:\.\d{1,2})?)/)
      ?? promotion.match(/(?:平台券|优惠券|领券|券|红包)[^\d]*([1-9]\d{0,5}(?:\.\d{1,2})?)\s*元?/)
    if (!match) continue
    const amount = Number(match[1])
    if (Number.isFinite(amount) && amount > 0) return amount
  }
  return undefined
}

async function humanPause(minMs = 450, maxMs = 1400) {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1))
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function humanBrowsePage(page: Page, dwellMs: number) {
  const slices = Math.max(2, Math.floor(dwellMs / 5000))
  for (let index = 0; index < slices; index += 1) {
    await humanPause(1200, 2200)
    await page.mouse.move(120 + Math.random() * 700, 160 + Math.random() * 420, { steps: 12 })
    await page.mouse.wheel(0, 260 + Math.random() * 520)
    await humanPause(900, 1800)
    if (Math.random() > 0.45) await page.mouse.wheel(0, -(120 + Math.random() * 260))
  }
  await humanPause(Math.max(900, Math.floor(dwellMs * 0.15)), Math.max(1400, Math.floor(dwellMs * 0.25)))
}

async function openHuman(page: Page, url: string, dwellMs = 2500) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
  await humanBrowsePage(page, dwellMs)
}

function isJdStoreHomePage(url: string) {
  return /^https:\/\/(?:lenovo1\.jd\.com\/?|mall\.jd\.com\/index-\d+\.html(?:[?#].*)?)$/i.test(url)
}

async function extractItemEntriesFromPage(page: Page) {
  const entries = await page.locator('a[href*="item.jd.com"]').evaluateAll((links) => (
    links
      .map((link) => {
        const href = link.getAttribute('href') ?? ''
        const container = link.closest('li, div, section, article')
        return {
          href,
          text: `${link.textContent ?? ''}\n${container?.textContent ?? ''}`.slice(0, 1600),
        }
      })
      .filter((entry) => entry.href)
  )).catch(() => [])
  return entries
    .map((entry) => ({
      url: entry.href.startsWith('//') ? `https:${entry.href}` : entry.href,
      discoveryText: entry.text,
    }))
    .filter((entry) => itemUrlPattern.test(entry.url))
    .map((entry) => ({ ...entry, url: normalizeJdItemUrl(entry.url) }))
}

async function loadUrlFile() {
  if (!config.chromeJd.urlFile) return []
  const content = await fs.readFile(config.chromeJd.urlFile, 'utf-8').catch(() => '')
  return content.split(/\r?\n|,/).map((item) => item.trim()).filter((item) => itemUrlPattern.test(item))
}

async function loadKnownJdItemUrls() {
  const files = [
    path.resolve(config.lenovoRetail.artifactDir, 'latest-product-url-locks.json'),
    path.resolve(config.lenovoRetail.artifactDir, 'latest-marketplace-price-snapshot.json'),
  ]
  const urls = new Set<string>()
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8').catch(() => '')
    if (!content) continue
    for (const match of content.matchAll(/https:\/\/item\.jd\.com\/\d+\.html(?:[?#][^"\s]*)?/gi)) {
      urls.add(normalizeJdItemUrl(match[0]))
    }
  }
  return Array.from(urls)
}

function addCandidateUrl(urls: Map<string, CandidateUrl>, item: CandidateUrl) {
  const previous = urls.get(item.url)
  if (!previous || item.trusted || !previous.discoveryText) urls.set(item.url, item)
}

async function collectCandidateUrls(context: BrowserContext, worker: Page, candidates: Candidate[]) {
  const urls = new Map<string, CandidateUrl>()
  let verificationRequiredUrl: string | undefined
  for (const page of context.pages()) {
    const currentUrl = page.url()
    if (itemUrlPattern.test(currentUrl)) addCandidateUrl(urls, { url: normalizeJdItemUrl(currentUrl), trusted: true })
    if (/mall\.jd\.com|pro\.jd\.com/i.test(currentUrl)) {
      for (const entry of await extractItemEntriesFromPage(page)) {
        if (config.chromeJd.collectAllStoreItems || pickBestSkuFromText(candidates, '', entry.discoveryText ?? '', 12)) {
          addCandidateUrl(urls, { ...entry, trusted: false, sourceUrl: currentUrl })
        }
      }
    }
  }
  for (const url of [...config.chromeJd.sourceUrls, ...(await loadUrlFile())]) {
    if (itemUrlPattern.test(url)) addCandidateUrl(urls, { url: normalizeJdItemUrl(url), trusted: true })
  }
  for (const url of await loadKnownJdItemUrls()) addCandidateUrl(urls, { url, trusted: true })
  for (const sourceUrl of [...defaultSourceUrls, ...config.chromeJd.sourceUrls].filter((url) => !itemUrlPattern.test(url))) {
    console.error(`[chrome-jd] open source ${sourceUrl}`)
    await openHuman(worker, sourceUrl, config.chromeJd.sourceDwellMs)
    const currentUrl = worker.url()
    const bodyText = await worker.locator('body').innerText({ timeout: 10000 }).catch(() => '')
    if (verificationPattern.test(bodyText)) {
      verificationRequiredUrl = sourceUrl
      break
    }
    if (isJdStoreHomePage(sourceUrl) && !isJdStoreHomePage(currentUrl)) {
      verificationRequiredUrl = currentUrl
      break
    }
    for (const entry of await extractItemEntriesFromPage(worker)) {
      if (config.chromeJd.collectAllStoreItems || pickBestSkuFromText(candidates, '', entry.discoveryText ?? '', 12)) {
        addCandidateUrl(urls, { ...entry, trusted: false, sourceUrl })
      }
    }
  }
  return {
    urls: Array.from(urls.values()).slice(0, config.chromeJd.maxUrls),
    verificationRequiredUrl,
  }
}

function toRecord(item: CapturedItem, sku: StandardInventorySku, price: number | undefined, promotions: string[]): MarketplacePriceRecord {
  const capturedAt = new Date().toISOString()
  const platformCouponAmount = extractPlatformCouponAmount(promotions)
  const couponAdjustedPrice = price !== undefined && platformCouponAmount !== undefined && platformCouponAmount < price
    ? Number((price - platformCouponAmount).toFixed(2))
    : undefined
  return {
    source: 'jd',
    sourceLabel: '京东',
    sourceType: 'subsidy_reference_price',
    productId: sku.skuKey,
    query: sku.productName,
    configuredUrl: item.url,
    productName: sku.productName,
    platformSkuId: item.platformSkuId,
    matchTitle: item.title,
    price,
    preSubsidyPrice: price,
    couponAdjustedPrice,
    priceType: price === undefined ? 'url_configured_only' : 'pre_subsidy_price',
    priceBasis: price === undefined
      ? 'Chrome CLI 已锁定京东商品详情页，但未读取到有效展示价。'
      : couponAdjustedPrice !== undefined
        ? `Chrome CLI 采集京东详情页正常展示价 ${price}；直接可见平台满减/券 ${platformCouponAmount}，券后价 ${couponAdjustedPrice} 仅写入 couponAdjustedPrice，不作为京东主零售价。活动信息：${promotions.join('；')}`
        : `Chrome CLI 采集京东详情页展示价；活动信息：${promotions.length ? promotions.join('；') : '未识别到满减/补贴文案'}`,
    taxIncluded: true,
    serviceIncluded: true,
    confidence: price === undefined ? 'url_configured_only' : 'confirmed',
    collectionStatus: price === undefined ? 'manual_review_required' : 'captured',
    evidence: {
      evidenceUrl: item.url,
      capturedAt,
      capturedBy: 'manual',
      note: '通过本机 Chrome/CDP 读取详情页，保留京东活动文案用于首页库存零售专区。',
    },
    raw: {
      platform: 'jd_self',
      promotions,
      displayPrice: price,
      platformCouponAmount: platformCouponAmount ?? null,
      couponAdjustedPrice: couponAdjustedPrice ?? null,
      prices: extractPrices(item.text).slice(0, 10),
      title: item.title,
    },
  }
}

async function writeManualInput(records: MarketplacePriceRecord[], suffix = 'chrome-jd-retail-records') {
  await fs.mkdir(config.lenovoRetail.artifactDir, { recursive: true })
  const manualInputPath = path.resolve(config.lenovoRetail.artifactDir, `${stamp()}-${suffix}.json`)
  await fs.writeFile(manualInputPath, JSON.stringify({ records }, null, 2), 'utf-8')
  return manualInputPath
}

export async function collectChromeJdRetailPrices() {
  const inventoryPath = path.resolve(config.lenovoRetail.artifactDir, 'latest-standard-inventory-snapshot.json')
  const inventory = await readJson<StandardInventorySnapshot>(inventoryPath)
  const candidates = inventory.skus
    .filter((sku) => sku.currentStock > 0)
    .map(buildCandidate)

  const browser = await chromium.connectOverCDP(config.chromeJd.cdpUrl).catch((error) => {
    throw new Error([
      `无法连接本机 Chrome CDP：${config.chromeJd.cdpUrl}`,
      '只能使用当前已登录的默认 Chrome 可见会话，禁止新开浏览器/Profile 或清理登录缓存。',
      '请在现有登录会话上确认已开启远程调试端口后再继续。',
      '该自动采集入口已禁用，不能再重跑 npm run collect:chrome-jd-retail。请改用当前已登录 Chrome 可见窗口低频手工核验，并把人工证据写入手工批次后重建快照。',
      `原始错误：${error instanceof Error ? error.message : String(error)}`,
    ].join('\n'))
  })
  const context = browser.contexts()[0]
  if (!context) throw new Error(`未找到 Chrome CDP 上下文，请先用 --remote-debugging-port 启动 Chrome：${config.chromeJd.cdpUrl}`)
  const worker = context.pages()[0] ?? await context.newPage()

  const records: MarketplacePriceRecord[] = []
  const errors: string[] = []
  const scannedUrls: string[] = []
  let verificationRequiredUrl: string | undefined

  try {
    const sourceResult = await collectCandidateUrls(context, worker, candidates)
    if (sourceResult.verificationRequiredUrl) verificationRequiredUrl = sourceResult.verificationRequiredUrl
    const urls = sourceResult.urls
    console.error(`[chrome-jd] candidate item urls: ${urls.length}${verificationRequiredUrl ? `; source verification: ${verificationRequiredUrl}` : ''}`)
    for (const [index, candidateUrl] of urls.entries()) {
      scannedUrls.push(candidateUrl.url)
      console.error(`[chrome-jd] ${index + 1}/${urls.length} ${candidateUrl.url}${candidateUrl.trusted ? ' locked' : ` store-item${candidateUrl.sourceUrl ? ` source=${candidateUrl.sourceUrl}` : ''}`}`)
      await openHuman(worker, candidateUrl.url, config.chromeJd.itemDwellMs)
      const finalUrl = worker.url()
      const normalizedFinalUrl = normalizeJdItemUrl(finalUrl)
      if (!itemUrlPattern.test(finalUrl) || normalizedFinalUrl !== candidateUrl.url) {
        verificationRequiredUrl = finalUrl
        console.error(`[chrome-jd] abnormal item redirect ${candidateUrl.url} -> ${finalUrl}`)
        break
      }
      const [title, text] = await Promise.all([
        worker.title().catch(() => ''),
        worker.locator('body').innerText({ timeout: 8000 }).catch(() => ''),
      ])
      if (verificationPattern.test(`${title}\n${text}`)) {
        verificationRequiredUrl = candidateUrl.url
        console.error(`[chrome-jd] verification required at ${candidateUrl.url}`)
        break
      }
      if (unavailablePattern.test(`${title}\n${text}`)) continue

      const item: CapturedItem = {
        url: normalizedFinalUrl,
        platformSkuId: getPlatformSkuId(normalizedFinalUrl),
        title,
        text,
      }
      if (!hasValidJdItemDetail(item)) {
        console.error(`[chrome-jd] skip invalid jd item detail ${candidateUrl.url} title=${title}`)
        continue
      }
      const match = pickBestSku(candidates, item)
      if (!match) continue
      const prices = extractPreSubsidyDisplayPrices(text)
      const price = prices[0]
      records.push(toRecord(item, match.candidate.sku, price, extractPromotions(text)))
      console.error(`[chrome-jd] matched ${match.candidate.sku.skuKey} price=${price ?? 'n/a'}`)
    }
  } finally {
    await browser.close({ reason: 'Chrome JD retail CLI finished.' }).catch(() => undefined)
  }

  const manualInputPath = await writeManualInput(records, verificationRequiredUrl ? 'chrome-jd-retail-partial-records' : 'chrome-jd-retail-records')
  const marketplace = await saveMarketplacePriceSnapshot(manualInputPath)
  const locks = await saveProductUrlLockSnapshot()
  const retailZone = await saveRetailZoneSnapshot()

  return {
    manualInputPath,
    marketplacePath: marketplace.artifactPath,
    productUrlLocksPath: locks.artifactPath,
    retailZonePath: retailZone.artifactPath,
    scannedUrlCount: scannedUrls.length,
    recordCount: records.length,
    verificationRequiredUrl,
    errors,
    sample: records.slice(0, 12),
  }
}
