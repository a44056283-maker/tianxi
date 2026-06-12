import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.js'

const execFileAsync = promisify(execFile)

type BridgeEntitySummary = {
  entityName: string
  status: string
  cursor?: string
  lastSuccessTime?: string
  lastError?: string
  totalRecords: number
  todayRecords: number
  latestCollectedAt?: string
}

export type ZdtOpenclawBridgeSnapshot = {
  generatedAt: string
  source: 'zdt_sync_openclaw_starter'
  databaseUrl: string
  connected: boolean
  staleThresholdMinutes: number
  freshestCollectedAt?: string
  isFresh: boolean
  entitySummaries: BridgeEntitySummary[]
  totals: {
    totalRecords: number
    todayRecords: number
  }
  warnings: string[]
  error?: string
}

type SaveBridgeResult = {
  snapshot: ZdtOpenclawBridgeSnapshot
  artifactPath: string
  webPath: string
}

const STALE_THRESHOLD_MINUTES = 90

function artifactPath(fileName: string) {
  return path.resolve(config.lenovoRetail.artifactDir, fileName)
}

function webPath(fileName: string) {
  return path.resolve(config.appDir, '../web-cockpit/public/data', fileName)
}

async function writeFileAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, filePath)
}

function toIso(value: unknown) {
  const text = String(value ?? '').trim()
  return text || undefined
}

function computeFreshness(freshestCollectedAt?: string) {
  if (!freshestCollectedAt) return false
  const millis = new Date(freshestCollectedAt).getTime()
  if (!Number.isFinite(millis)) return false
  const deltaMinutes = (Date.now() - millis) / 60000
  return deltaMinutes <= STALE_THRESHOLD_MINUTES
}

// entity → PG table mapping for the ZDT CLI fact_* schema
type EntityConfig = {
  entity: string
  table: string
  collectedAtCol: string
  dateCol: string
  sqlTotal: string
  sqlToday: string
}

const ENTITY_CONFIGS: EntityConfig[] = [
  {
    entity: 'inventory',
    table: 'fact_inventory',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'snapshot_date',
    sqlTotal: 'COUNT(*)',
    sqlToday: `COUNT(*) FILTER (WHERE (snapshot_date AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
  {
    entity: 'orders_online',
    table: 'fact_orders',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'pay_time',
    sqlTotal: "COUNT(*) FILTER (WHERE order_type = 1)",
    sqlToday: `COUNT(*) FILTER (WHERE order_type = 1 AND (pay_time AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
  {
    entity: 'orders_offline',
    table: 'fact_orders',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'pay_time',
    // fact_orders currently only has online orders (order_type=1 有赞); offline will be 0 until data exists
    sqlTotal: "COUNT(*) FILTER (WHERE order_type != 1 OR order_type IS NULL)",
    sqlToday: `COUNT(*) FILTER (WHERE (order_type != 1 OR order_type IS NULL) AND (pay_time AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
  {
    entity: 'products',
    table: 'fact_products',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'updated_time',
    sqlTotal: 'COUNT(*)',
    sqlToday: `COUNT(*) FILTER (WHERE (updated_time AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
  {
    entity: 'sn_records',
    table: 'fact_sn_records',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'collected_at',
    sqlTotal: 'COUNT(*)',
    sqlToday: `COUNT(*) FILTER (WHERE (collected_at AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
  {
    entity: 'stock_orders',
    table: 'fact_stock_orders',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'collected_at',
    sqlTotal: 'COUNT(*)',
    sqlToday: `COUNT(*) FILTER (WHERE (collected_at AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
  {
    entity: 'purchase_orders',
    table: 'fact_purchase_orders',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'stock_in_time',
    sqlTotal: 'COUNT(*)',
    sqlToday: `COUNT(*) FILTER (WHERE (stock_in_time AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
  {
    entity: 'purchase_order_details',
    table: 'fact_purchase_order_details',
    collectedAtCol: 'MAX(collected_at)',
    dateCol: 'collected_at',
    sqlTotal: 'COUNT(*)',
    sqlToday: `COUNT(*) FILTER (WHERE (collected_at AT TIME ZONE 'Asia/Shanghai')::date = CURRENT_DATE)`,
  },
]

async function fetchBridgeSnapshot(): Promise<ZdtOpenclawBridgeSnapshot> {
  const generatedAt = new Date().toISOString()
  if (!config.lenovoRetail.zdtSyncBridgeEnabled) {
    return {
      generatedAt,
      source: 'zdt_sync_openclaw_starter',
      databaseUrl: config.lenovoRetail.zdtSyncDatabaseUrl,
      connected: false,
      staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
      isFresh: false,
      entitySummaries: [],
      totals: { totalRecords: 0, todayRecords: 0 },
      warnings: ['ZDT_SYNC_BRIDGE_ENABLED=false，已跳过 zdt_sync SQL 桥接。'],
    }
  }

  // Build Python script as a temp file (avoids shell-quoting issues with embedded strings)
  const scriptContent = buildPythonBridgeScript()
  const scriptPath = path.resolve(config.lenovoRetail.artifactDir, '.zdt_bridge_query.py')
  await writeFileAtomic(scriptPath, scriptContent)

  try {
    const { stdout } = await execFileAsync('python3', [scriptPath], {
      cwd: path.resolve(config.appDir),
      env: {
        ...process.env,
        ZDT_SYNC_DATABASE_URL: config.lenovoRetail.zdtSyncDatabaseUrl,
      },
      maxBuffer: 1024 * 1024 * 8,
    })

    // Remove any print statements before JSON
    const jsonLine = stdout.trim().split('\n').at(-1) || '{}'
    const parsed = JSON.parse(jsonLine) as {
      entitySummaries?: Array<Record<string, unknown>>
      totals?: { totalRecords?: number; todayRecords?: number }
      warnings?: string[]
      freshestCollectedAt?: string
    }

    const entitySummaries: BridgeEntitySummary[] = (parsed.entitySummaries ?? []).map((item) => ({
      entityName: String(item.entityName ?? ''),
      status: String(item.status ?? ''),
      cursor: toIso(item.cursor),
      lastSuccessTime: toIso(item.lastSuccessTime),
      lastError: toIso(item.lastError),
      totalRecords: Number(item.totalRecords ?? 0),
      todayRecords: Number(item.todayRecords ?? 0),
      latestCollectedAt: toIso(item.latestCollectedAt),
    }))

    const freshestCollectedAt = entitySummaries
      .map((item) => item.latestCollectedAt)
      .filter((item): item is string => Boolean(item))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

    const isFresh = computeFreshness(freshestCollectedAt)
    const warnings = [...(parsed.warnings ?? [])]

    if (!entitySummaries.length) {
      warnings.push('zdt_sync 数据库可连接，但未读取到任何实体数据。请确认 ZDT CLI 是否已完成首次采集。')
    }
    if (!isFresh && freshestCollectedAt) {
      warnings.push(
        `zdt_sync 最新采集时间 ${freshestCollectedAt} 距离现在超过 ${STALE_THRESHOLD_MINUTES} 分钟，桥接视为未新鲜。`,
      )
    }

    return {
      generatedAt,
      source: 'zdt_sync_openclaw_starter',
      databaseUrl: config.lenovoRetail.zdtSyncDatabaseUrl,
      connected: true,
      staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
      freshestCollectedAt,
      isFresh,
      entitySummaries,
      totals: {
        totalRecords: Number(parsed.totals?.totalRecords ?? 0),
        todayRecords: Number(parsed.totals?.todayRecords ?? 0),
      },
      warnings,
    }
  } catch (error) {
    return {
      generatedAt,
      source: 'zdt_sync_openclaw_starter',
      databaseUrl: config.lenovoRetail.zdtSyncDatabaseUrl,
      connected: false,
      staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
      isFresh: false,
      entitySummaries: [],
      totals: { totalRecords: 0, todayRecords: 0 },
      warnings: ['zdt_sync SQL 桥接执行失败。'],
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    // Clean up temp script
    await fs.unlink(scriptPath).catch(() => {
      /* ignore */
    })
  }
}

function buildPythonBridgeScript(): string {
  // Build entity configs as Python dict
  const entityConfigsPy = ENTITY_CONFIGS.map(
    (e) =>
      `    {"entity": ${JSON.stringify(e.entity)}, "table": ${JSON.stringify(e.table)}, ` +
      `"collected_at_col": ${JSON.stringify(e.collectedAtCol)}, "date_col": ${JSON.stringify(e.dateCol)}, ` +
      `"sql_total": ${JSON.stringify(e.sqlTotal)}, "sql_today": ${JSON.stringify(e.sqlToday)}}`,
  ).join(',\n')

  return `\
from datetime import datetime, timezone
import json
import os
import sys
import psycopg

db_url = os.environ.get("ZDT_SYNC_DATABASE_URL", "")
if not db_url:
    print(json.dumps({"error": "ZDT_SYNC_DATABASE_URL not set"}))
    sys.exit(1)

ENTITIES = [
${entityConfigsPy}
]

result = {
    "entitySummaries": [],
    "totals": {"totalRecords": 0, "todayRecords": 0},
    "warnings": [],
    "freshestCollectedAt": "",
}

try:
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            # Load sync_state cursor/status for each entity
            sync_meta = {}
            cur.execute(
                "SELECT entity_name, cursor_value, status FROM sync_state WHERE source_name = %s",
                ("zhidiantong",),
            )
            for row in cur.fetchall():
                sync_meta[row[0]] = {"cursor": row[1] or "", "status": row[2] or ""}

            # Query each fact table
            for eq in ENTITIES:
                entity_name = eq["entity"]
                table_name = eq["table"]
                collected_at_col = eq["collected_at_col"]
                date_col = eq["date_col"]
                sql_total = eq["sql_total"]
                sql_today = eq["sql_today"]

                try:
                    # Build query using the entity-specific SQL
                    query = f"""
                        SELECT
                            %(entity)s AS entity_name,
                            COALESCE({collected_at_col}, %(epoch)s::timestamptz) AS latest_collected_at,
                            ({sql_total}) AS total_records,
                            ({sql_today}) AS today_records
                        FROM {table_name}
                    """

                    cur.execute(
                        query,
                        {"entity": entity_name, "epoch": "1970-01-01"},
                    )
                    row = cur.fetchone()
                    if row:
                        _, latest_collected_at, total_records, today_records = row
                        meta = sync_meta.get(entity_name, {"cursor": "", "status": ""})
                        latest_str = (
                            latest_collected_at.isoformat()
                            if latest_collected_at and hasattr(latest_collected_at, "isoformat")
                            else ""
                        )
                        result["entitySummaries"].append({
                            "entityName": entity_name,
                            "status": meta.get("status", ""),
                            "cursor": meta.get("cursor", ""),
                            "latestCollectedAt": latest_str,
                            "totalRecords": int(total_records or 0),
                            "todayRecords": int(today_records or 0),
                            "lastSuccessTime": "",
                            "lastError": "",
                        })
                        result["totals"]["totalRecords"] += int(total_records or 0)
                        result["totals"]["todayRecords"] += int(today_records or 0)
                        if latest_str and (
                            not result["freshestCollectedAt"]
                            or latest_str > result["freshestCollectedAt"]
                        ):
                            result["freshestCollectedAt"] = latest_str
                except Exception as e:
                    result["warnings"].append(f"Query {entity_name} failed: {str(e)}")

except Exception as e:
    result["warnings"].append(f"Connection error: {str(e)}")

print(json.dumps(result, ensure_ascii=False))
`
}

export async function saveZdtOpenclawBridgeSnapshot(): Promise<SaveBridgeResult> {
  const snapshot = await fetchBridgeSnapshot()
  const targetFile = 'latest-zdt-openclaw-bridge.json'
  const artifact = artifactPath(targetFile)
  const web = webPath(targetFile)
  const content = `${JSON.stringify(snapshot, null, 2)}\n`
  await Promise.all([
    writeFileAtomic(artifact, content),
    writeFileAtomic(web, content),
  ])
  return {
    snapshot,
    artifactPath: artifact,
    webPath: web,
  }
}
