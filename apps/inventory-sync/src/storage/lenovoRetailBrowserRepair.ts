import { chromium, type Page } from 'playwright'
import { config } from '../config.js'

type RepairOptions = {
  clearLogin?: boolean
}

type RepairResult = {
  status: 'repaired' | 'cdp_unavailable'
  mode: 'chrome_cdp'
  targetUrl: string
  clearLogin: boolean
  details?: {
    origin: string
    localStorageCleared: boolean
    sessionStorageCleared: boolean
    cacheStorageKeys: string[]
    cacheStorageDeleted: number
    serviceWorkerCount: number
    indexedDbNames: string[]
    indexedDbDeleted: number
    cookiesCleared: boolean
    reloadUrl: string
  }
  nextStep: string
}

const targetUrl = config.lenovoRetail.loginUrl

async function clearSiteState(page: Page, clearLogin: boolean) {
  return page.evaluate(async ({ clearLogin }) => {
    const clearCookieJar = () => {
      const cookiePairs = document.cookie.split(';').map((item) => item.trim()).filter(Boolean)
      for (const pair of cookiePairs) {
        const [name] = pair.split('=')
        document.cookie = `${name}=; expires=${new Date(0).toUTCString()}; path=/`
        document.cookie = `${name}=; expires=${new Date(0).toUTCString()}; path=/; domain=${location.hostname}`
      }
    }

    const cacheStorageKeys = 'caches' in window ? await caches.keys() : []
    for (const key of cacheStorageKeys) await caches.delete(key)

    const registrations = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : []
    for (const registration of registrations) await registration.unregister()

    const indexedDbNames = typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((item) => item.name).filter((name): name is string => Boolean(name))
      : []
    await Promise.all(indexedDbNames.map((name) => new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })))

    localStorage.clear()
    sessionStorage.clear()
    if (clearLogin) clearCookieJar()

    return {
      origin: location.origin,
      localStorageCleared: true,
      sessionStorageCleared: true,
      cacheStorageKeys,
      cacheStorageDeleted: cacheStorageKeys.length,
      serviceWorkerCount: registrations.length,
      indexedDbNames,
      indexedDbDeleted: indexedDbNames.length,
      cookiesCleared: clearLogin,
      reloadUrl: location.href,
    }
  }, { clearLogin })
}

export async function repairLenovoRetailBrowserCache(options: RepairOptions = {}): Promise<RepairResult> {
  const clearLogin = Boolean(options.clearLogin)

  try {
    const browser = await chromium.connectOverCDP(config.chromeJd.cdpUrl)
    const context = browser.contexts()[0] ?? await browser.newContext()
    const page = context.pages()[0] ?? await context.newPage()

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    const details = await clearSiteState(page, clearLogin)
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await browser.close()

    return {
      status: 'repaired',
      mode: 'chrome_cdp',
      targetUrl,
      clearLogin,
      details,
      nextStep: clearLogin
        ? '智店通站点缓存和登录态已清理；重新打开登录页并手工登录。'
        : '智店通站点缓存已清理，Cookie/登录态已保留；刷新或重新打开登录页继续使用。',
    }
  } catch {
    return {
      status: 'cdp_unavailable',
      mode: 'chrome_cdp',
      targetUrl,
      clearLogin,
      nextStep: '未连接到开启远程调试端口的 Chrome。先用带 --remote-debugging-port=9222 的 Chrome 启动后再执行此命令，或在已打开页面手工运行站点缓存清理。',
    }
  }
}
