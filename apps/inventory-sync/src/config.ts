import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { z } from 'zod'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

dotenv.config({ path: path.resolve(appDir, '.env') })

const envSchema = z.object({
  LENOVO_RETAIL_LOGIN_URL: z.string().url().default('https://retail-pos.lenovo.com/web/login'),
  LENOVO_RETAIL_API_BASE_URL: z.string().url().default('https://retail-pos.lenovo.com/apis'),
  LENOVO_RETAIL_STORAGE_STATE: z.string().default('./storage/lenovo-retail.storage-state.json'),
  LENOVO_RETAIL_SESSION_FILE: z.string().default('./artifacts/zhidiantong-session.json'),
  LENOVO_RETAIL_ARTIFACT_DIR: z.string().default('./artifacts'),
  LENOVO_RETAIL_DOWNLOAD_DIR: z.string().optional(),
  LENOVO_RETAIL_USERNAME: z.string().optional(),
  LENOVO_RETAIL_PASSWORD: z.string().optional(),
  LENOVO_RETAIL_DEFAULT_STORE: z.string().default('联想体验店（新野县书院路）'),
  LENOVO_RETAIL_MAX_PAGES: z.coerce.number().int().positive().default(20),
  LENOVO_RETAIL_TOKEN: z.string().optional(),
  LENOVO_RETAIL_TENANT_ID: z.string().optional(),
  LENOVO_RETAIL_CHANNEL_ID: z.string().default('601'),
  LENOVO_RETAIL_LANG: z.string().default('zh-CN'),
  ZHIDIANTONG_SYNC_STATE_FILE: z.string().default('./artifacts/latest-zhidiantong-sync-state.json'),
  ZHIDIANTONG_SALES_ORDER_IDS_FILE: z.string().optional(),
  ZHIDIANTONG_PURCHASE_RECORD_IDS_FILE: z.string().optional(),
  ZHIDIANTONG_OTHER_OUTBOUND_IDS_FILE: z.string().optional(),
  ZDT_SYNC_DATABASE_URL: z.string().default('postgresql://zdt:zdt@localhost:5432/zdt_sync'),
  ZDT_SYNC_BRIDGE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : /^(1|true|yes|on)$/i.test(value.trim())),
  JUSTONEAPI_BASE_URL: z.string().url().default('https://api.justoneapi.com'),
  JUSTONEAPI_TOKEN: z.string().optional(),
  JUSTONEAPI_MAX_SKUS: z.coerce.number().int().positive().default(20),
  JUSTONEAPI_PLATFORMS: z.string().default('jd,taobao'),
  MARKETPLACE_BROWSER_MAX_SKUS: z.coerce.number().int().positive().default(10),
  MARKETPLACE_BROWSER_SKU_KEYS: z.string().optional(),
  MARKETPLACE_BROWSER_SOURCES: z.string().default('lenovo_official'),
  MARKETPLACE_BROWSER_HEADLESS: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : /^(1|true|yes|on)$/i.test(value.trim())),
  MARKETPLACE_BROWSER_CHANNEL: z.string().default('chrome'),
  MARKETPLACE_BROWSER_SLOW_MO_MS: z.coerce.number().int().nonnegative().default(250),
  CHROME_CDP_URL: z.string().url().default('http://127.0.0.1:9222'),
  CHROME_JD_MAX_URLS: z.coerce.number().int().positive().default(120),
  CHROME_JD_SOURCE_URLS: z.string().optional(),
  CHROME_JD_URL_FILE: z.string().optional(),
  CHROME_JD_ITEM_DWELL_MS: z.coerce.number().int().positive().default(15000),
  CHROME_JD_SOURCE_DWELL_MS: z.coerce.number().int().positive().default(12000),
  CHROME_JD_COLLECT_ALL_STORE_ITEMS: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : /^(1|true|yes|on)$/i.test(value.trim())),
  LENOVO_WARRANTY_MAX_SERIALS: z.coerce.number().int().positive().default(20),
  LENOVO_WARRANTY_HEADLESS: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : /^(1|true|yes|on)$/i.test(value.trim())),
  FEISHU_TASK_FEEDBACK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : /^(1|true|yes|on)$/i.test(value.trim())),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_WEBHOOK_URL: z.string().optional(),
  FEISHU_BOT_SECRET: z.string().optional(),
  FEISHU_TASK_FEEDBACK_GROUP_NAME: z.string().default('联想智慧零售定时任务播报群'),
})

const env = envSchema.parse(process.env)
const defaultDownloadDir = path.resolve(process.env.HOME ?? '', 'Downloads')

function resolveFromAppDir(value: string) {
  if (path.isAbsolute(value)) return value
  return path.resolve(appDir, value)
}

function optionalPath(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  return resolveFromAppDir(trimmed || fallback)
}

export const config = {
  appDir,
  lenovoRetail: {
    loginUrl: env.LENOVO_RETAIL_LOGIN_URL,
    apiBaseUrl: env.LENOVO_RETAIL_API_BASE_URL.replace(/\/$/, ''),
    storageStatePath: resolveFromAppDir(env.LENOVO_RETAIL_STORAGE_STATE),
    sessionFilePath: resolveFromAppDir(env.LENOVO_RETAIL_SESSION_FILE),
    artifactDir: resolveFromAppDir(env.LENOVO_RETAIL_ARTIFACT_DIR),
    downloadDir: optionalPath(env.LENOVO_RETAIL_DOWNLOAD_DIR, defaultDownloadDir),
    username: env.LENOVO_RETAIL_USERNAME,
    password: env.LENOVO_RETAIL_PASSWORD,
    defaultStore: env.LENOVO_RETAIL_DEFAULT_STORE,
    maxPages: env.LENOVO_RETAIL_MAX_PAGES,
    token: env.LENOVO_RETAIL_TOKEN,
    tenantId: env.LENOVO_RETAIL_TENANT_ID,
    channelId: env.LENOVO_RETAIL_CHANNEL_ID,
    lang: env.LENOVO_RETAIL_LANG,
    syncStateFilePath: resolveFromAppDir(env.ZHIDIANTONG_SYNC_STATE_FILE),
    salesOrderIdsFile: env.ZHIDIANTONG_SALES_ORDER_IDS_FILE ? resolveFromAppDir(env.ZHIDIANTONG_SALES_ORDER_IDS_FILE) : undefined,
    purchaseRecordIdsFile: env.ZHIDIANTONG_PURCHASE_RECORD_IDS_FILE ? resolveFromAppDir(env.ZHIDIANTONG_PURCHASE_RECORD_IDS_FILE) : undefined,
    otherOutboundIdsFile: env.ZHIDIANTONG_OTHER_OUTBOUND_IDS_FILE ? resolveFromAppDir(env.ZHIDIANTONG_OTHER_OUTBOUND_IDS_FILE) : undefined,
    zdtSyncDatabaseUrl: env.ZDT_SYNC_DATABASE_URL,
    zdtSyncBridgeEnabled: env.ZDT_SYNC_BRIDGE_ENABLED,
  },
  justOneApi: {
    baseUrl: env.JUSTONEAPI_BASE_URL.replace(/\/$/, ''),
    token: env.JUSTONEAPI_TOKEN,
    maxSkus: env.JUSTONEAPI_MAX_SKUS,
    platforms: env.JUSTONEAPI_PLATFORMS.split(',').map((item) => item.trim()).filter(Boolean),
  },
  marketplaceBrowser: {
    maxSkus: env.MARKETPLACE_BROWSER_MAX_SKUS,
    skuKeys: env.MARKETPLACE_BROWSER_SKU_KEYS?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
    sources: env.MARKETPLACE_BROWSER_SOURCES.split(',').map((item) => item.trim()).filter(Boolean),
    headless: env.MARKETPLACE_BROWSER_HEADLESS,
    channel: env.MARKETPLACE_BROWSER_CHANNEL,
    slowMoMs: env.MARKETPLACE_BROWSER_SLOW_MO_MS,
  },
  chromeJd: {
    cdpUrl: env.CHROME_CDP_URL,
    maxUrls: env.CHROME_JD_MAX_URLS,
    sourceUrls: env.CHROME_JD_SOURCE_URLS?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
    urlFile: env.CHROME_JD_URL_FILE ? resolveFromAppDir(env.CHROME_JD_URL_FILE) : undefined,
    itemDwellMs: env.CHROME_JD_ITEM_DWELL_MS,
    sourceDwellMs: env.CHROME_JD_SOURCE_DWELL_MS,
    collectAllStoreItems: env.CHROME_JD_COLLECT_ALL_STORE_ITEMS,
  },
  lenovoWarranty: {
    maxSerials: env.LENOVO_WARRANTY_MAX_SERIALS,
    headless: env.LENOVO_WARRANTY_HEADLESS,
  },
  feishuTaskFeedback: {
    enabled: env.FEISHU_TASK_FEEDBACK_ENABLED,
    appId: env.FEISHU_APP_ID,
    webhookUrl: env.FEISHU_WEBHOOK_URL,
    botSecret: env.FEISHU_BOT_SECRET,
    groupName: env.FEISHU_TASK_FEEDBACK_GROUP_NAME,
  },
}
