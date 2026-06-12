import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { config } from '../config.js'
import type { LenovoRetailStockSummaryItem, LenovoRetailSyncResult } from '../types.js'

const LENOVO_RETAIL_PATHS = {
  stockPanel: '/lenovo/web/stock/stock/stock-panel',
  stockStorage: '/lenovo/web/stock/stock/stock-storage',
  stockOverview: '/lenovo/web/stock/stock/stock-panel-overflow',
  stockStream: '/lenovo/web/stock/stock/stock-stream',
  stockOrder: '/lenovo/web/stock/stock/stock-order',
  snStockOrder: '/lenovo/web/stock/stock/sn-stock-order',
  salesCostPrice: '/lenovo/web/stock/stock/stock-sales-cost-price',
}

const STOCK_PANEL_COLUMNS = [
  '商品名称',
  'PN/MTM',
  '规格',
  '现有库存',
  '可售库存',
  '占用库存',
  '不可售库存',
  '待入库库存',
  '库存水位预警额',
  '分类',
  '商品编码',
  'SKU编码',
  '组织名称',
  '组织编码',
  '库存类型',
  '代理价',
  '销售成本价',
]

type RawStockRow = {
  cells: string[]
}

function parseNumber(value: string | undefined) {
  const normalized = (value ?? '').replace(/[^\d.-]/g, '')
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseOptionalCurrency(value: string | undefined) {
  const normalized = (value ?? '').trim()
  if (!normalized || normalized === '-') return undefined
  return parseNumber(normalized)
}

function parseStockRow(row: RawStockRow): LenovoRetailStockSummaryItem | null {
  const cells = row.cells.map((cell) => cell.trim()).filter(Boolean)
  if (cells.length < 17) return null

  const [
    productName,
    pnMtm,
    spec,
    currentStock,
    sellableStock,
    occupiedStock,
    unsellableStock,
    pendingInboundStock,
    _stockWarning,
    category,
    productCode,
    skuCode,
    organizationName,
    organizationCode,
    stockType,
    agentPrice,
    salesCostPrice,
  ] = cells

  if (!productName || productName === '商品名称') return null

  return {
    source: 'lenovo-retail-web',
    productName,
    pnMtm,
    spec,
    currentStock: parseNumber(currentStock),
    sellableStock: parseNumber(sellableStock),
    occupiedStock: parseNumber(occupiedStock),
    unsellableStock: parseNumber(unsellableStock),
    pendingInboundStock: parseNumber(pendingInboundStock),
    category,
    productCode,
    skuCode,
    organizationName,
    organizationCode,
    stockType,
    agentPrice: parseOptionalCurrency(agentPrice),
    salesCostPrice: parseOptionalCurrency(salesCostPrice),
    raw: { cells },
  }
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function artifactPath(name: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.resolve(config.lenovoRetail.artifactDir, `${stamp}-${name}`)
}

async function createContext(options: { headless: boolean; useStorageState: boolean }) {
  await ensureDir(path.dirname(config.lenovoRetail.storageStatePath))
  await ensureDir(config.lenovoRetail.artifactDir)

  const browser = await chromium.launch({ headless: options.headless })
  const storageStateExists = await fileExists(config.lenovoRetail.storageStatePath)
  const context = await browser.newContext({
    storageState: options.useStorageState && storageStateExists ? config.lenovoRetail.storageStatePath : undefined,
    viewport: { width: 1440, height: 980 },
  })

  return { browser, context }
}

async function saveProbeArtifacts(page: Page, prefix: string) {
  const screenshotPath = artifactPath(`${prefix}.png`)
  const htmlPath = artifactPath(`${prefix}.html`)
  const textPath = artifactPath(`${prefix}.txt`)

  await page.screenshot({ path: screenshotPath, fullPage: true })
  await fs.writeFile(htmlPath, await page.content(), 'utf-8')
  await fs.writeFile(textPath, await page.locator('body').innerText().catch(() => ''), 'utf-8')

  return [screenshotPath, htmlPath, textPath]
}

async function saveJsonArtifact(prefix: string, data: unknown) {
  const jsonPath = artifactPath(`${prefix}.json`)
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8')
  return jsonPath
}

async function tryFillCredentials(page: Page) {
  const { username, password } = config.lenovoRetail
  if (!username || !password) return

  const usernameCandidates = [
    'input[name="username"]',
    'input[name="account"]',
    'input[type="text"]',
    'input[placeholder*="账号"]',
    'input[placeholder*="手机"]',
  ]
  const passwordCandidates = [
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="密码"]',
  ]

  for (const selector of usernameCandidates) {
    const field = page.locator(selector).first()
    if (await field.isVisible().catch(() => false)) {
      await field.fill(username)
      break
    }
  }

  for (const selector of passwordCandidates) {
    const field = page.locator(selector).first()
    if (await field.isVisible().catch(() => false)) {
      await field.fill(password)
      break
    }
  }
}

export class LenovoRetailConnector {
  async loginAndSaveSession() {
    const { browser, context } = await createContext({ headless: false, useStorageState: false })
    const page = await context.newPage()

    await page.goto(config.lenovoRetail.loginUrl, { waitUntil: 'domcontentloaded' })
    await tryFillCredentials(page)

    console.log('Login page opened.')
    console.log('Finish login manually in the browser window, then return here and press Enter.')
    await new Promise<void>((resolve) => {
      process.stdin.resume()
      process.stdin.once('data', () => resolve())
    })

    await context.storageState({ path: config.lenovoRetail.storageStatePath })
    const artifacts = await saveProbeArtifacts(page, 'login-finished')
    await browser.close()

    return {
      storageStatePath: config.lenovoRetail.storageStatePath,
      artifacts,
    }
  }

  async probe() {
    const { browser, context } = await createContext({ headless: false, useStorageState: true })
    const page = await context.newPage()

    await page.goto(config.lenovoRetail.loginUrl, { waitUntil: 'networkidle' })
    const artifacts = await saveProbeArtifacts(page, 'probe')
    const title = await page.title()
    const url = page.url()

    await browser.close()

    return { title, url, artifacts }
  }

  private async waitForStockPanel(page: Page) {
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.getByText('商品库存', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  }

  private async ensureStoreSelected(page: Page) {
    const storeName = config.lenovoRetail.defaultStore
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (bodyText.includes(storeName)) return

    const organizationSelect = page.locator('.ant-select').first()
    await organizationSelect.click()
    await page.getByText(storeName).first().click()
    await page.getByText('搜索', { exact: true }).click()
    await this.waitForStockPanel(page)
  }

  private async parseCurrentStockRows(page: Page) {
    const rawRows = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'))
      return rows
        .map((row) => ({
          cells: Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
        }))
        .filter((row) => row.cells.length >= 17)
    }) as RawStockRow[]

    const parsed = rawRows.map(parseStockRow).filter((item): item is LenovoRetailStockSummaryItem => Boolean(item))
    const seen = new Set<string>()
    return parsed.filter((item) => {
      const key = `${item.productCode}-${item.skuCode}-${item.organizationCode}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private async goToNextStockPage(page: Page) {
    const next = page.locator('.ant-pagination-next').first()
    const className = await next.getAttribute('class').catch(() => '')
    if (className?.includes('ant-pagination-disabled')) return false
    await next.click()
    await this.waitForStockPanel(page)
    return true
  }

  private async parseStockPanel(page: Page) {
    const allItems: LenovoRetailStockSummaryItem[] = []
    const maxPages = config.lenovoRetail.maxPages

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      allItems.push(...await this.parseCurrentStockRows(page))
      const moved = await this.goToNextStockPage(page).catch(() => false)
      if (!moved) break
    }

    const seen = new Set<string>()
    return allItems.filter((item) => {
      const key = `${item.productCode}-${item.skuCode}-${item.organizationCode}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async syncInventory(): Promise<LenovoRetailSyncResult> {
    const { browser, context } = await createContext({ headless: true, useStorageState: true })
    const page = await context.newPage()

    await page.goto(new URL(LENOVO_RETAIL_PATHS.stockPanel, config.lenovoRetail.loginUrl).toString(), { waitUntil: 'networkidle' })
    await this.waitForStockPanel(page)
    await this.ensureStoreSelected(page)

    const stockSummaryItems = await this.parseStockPanel(page)
    const artifacts = await saveProbeArtifacts(page, 'sync-stock-panel')
    artifacts.push(await saveJsonArtifact('sync-stock-summary', stockSummaryItems))

    await browser.close()

    return {
      source: 'lenovo-retail-web',
      status: stockSummaryItems.length > 0 ? 'partial' : 'failed',
      syncedAt: new Date().toISOString(),
      stockSummaryItems,
      inventoryItems: [],
      artifacts,
      warnings: [
        `Parsed ${stockSummaryItems.length} stock summary rows from stock panel.`,
        `Stock panel path: ${LENOVO_RETAIL_PATHS.stockPanel}`,
        `Stock panel columns: ${STOCK_PANEL_COLUMNS.join(', ')}`,
        'SN item parsing is not connected yet. Next step: parse 查看序列号 or SN库存订单.',
      ],
    }
  }
}
