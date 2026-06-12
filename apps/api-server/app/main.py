from __future__ import annotations

import hashlib
import csv
import json
import math
import os
import re
import random
import ssl
import sqlite3
import subprocess
import threading
import time
import uuid
from base64 import b64decode
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib.parse import urlparse
from urllib import request as urllib_request

import qrcode
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import PlainTextResponse, Response
from PIL import Image as PILImage
from PIL import ImageEnhance, ImageFilter, ImageOps
from pydantic import BaseModel, Field

from app import local_sync
from app import openclaw_chat_board
from app import prompt_workspace
from app import product_library
from app import retail_core
from app import scheduled_task_console


APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parents[1]
DATA_DIR = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "data"
LOCAL_LEDGER_FILE = APP_DIR / "data" / "local-sales-ledger.json"
AD_MACHINE_FILE = APP_DIR / "data" / "ad-machine-runtime.json"
AD_MACHINE_LOTTERY_DB = APP_DIR / "data" / "ad-machine-lottery.sqlite3"
AD_MACHINE_CONFIG_FILE = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "ad-machine" / "config.local.js"
AD_MACHINE_ADMIN_CONFIG_FILE = APP_DIR / "data" / "ad-machine-admin-config.json"
MINIMAX_SSL_CONTEXT = ssl._create_unverified_context()
WECHAT_JSSDK_CACHE: dict[str, Any] = {
    "access_token": "",
    "access_token_expires_at": 0.0,
    "jsapi_ticket": "",
    "jsapi_ticket_expires_at": 0.0,
}
RETAIL_CORE_STATUS_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "payload": None,
}
INVENTORY_SNAPSHOT_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "payload": None,
}
BRIDGE_SYNC_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "payload": None,
}
BRIDGE_SYNC_LOCK = threading.Lock()
STARTUP_BOOTSTRAP_LOCK = threading.Lock()
STARTUP_BOOTSTRAP_STARTED = False
STARTUP_BOOTSTRAP_FINISHED = False
STARTUP_BOOTSTRAP_ERROR: str | None = None
PRODUCT_LIBRARY_SEED_LOCK = threading.Lock()
GAOKAO_COUPON_ISSUE_LOCK = threading.RLock()
GAOKAO_2026_TABLES_LOCK = threading.Lock()
GAOKAO_2026_TABLES_READY = False
GAOKAO_2026_WRITE_CONCURRENCY_LIMIT = 8
GAOKAO_2026_WRITE_SEMAPHORE = threading.BoundedSemaphore(GAOKAO_2026_WRITE_CONCURRENCY_LIMIT)
PRODUCT_LIBRARY_SEED_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "last_error": None,
    "last_seed_result": {},
}
LOTTERY_POOL_LAYOUT = [
    {"displayIndex": 1, "sectorIndex": 0, "tier": "legendary", "tierName": "智惠五年", "label": "智惠五年"},
    {"displayIndex": 2, "sectorIndex": 1, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 3, "sectorIndex": 2, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 4, "sectorIndex": 3, "tier": "epic", "tierName": "智惠四年", "label": "智惠四年"},
    {"displayIndex": 5, "sectorIndex": 4, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 6, "sectorIndex": 5, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 7, "sectorIndex": 6, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 8, "sectorIndex": 7, "tier": "epic", "tierName": "智惠四年", "label": "智惠四年"},
    {"displayIndex": 9, "sectorIndex": 8, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 10, "sectorIndex": 9, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 11, "sectorIndex": 10, "tier": "legendary", "tierName": "智惠五年", "label": "智惠五年"},
    {"displayIndex": 12, "sectorIndex": 11, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 13, "sectorIndex": 12, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 14, "sectorIndex": 13, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 15, "sectorIndex": 14, "tier": "epic", "tierName": "智惠四年", "label": "智惠四年"},
    {"displayIndex": 16, "sectorIndex": 15, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 17, "sectorIndex": 16, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 18, "sectorIndex": 17, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 19, "sectorIndex": 18, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
    {"displayIndex": 20, "sectorIndex": 19, "tier": "rare", "tierName": "智惠三年", "label": "智惠三年"},
]
LOTTERY_LAYOUT_BY_TIER: dict[str, list[dict[str, Any]]] = {
    "rare": [item for item in LOTTERY_POOL_LAYOUT if item["tier"] == "rare"],
    "epic": [item for item in LOTTERY_POOL_LAYOUT if item["tier"] == "epic"],
    "legendary": [item for item in LOTTERY_POOL_LAYOUT if item["tier"] == "legendary"],
}
SQL_MIRRORED_SNAPSHOT_FILES = [
    "latest-standard-inventory-snapshot.json",
    "latest-adjusted-inventory-snapshot.json",
    "latest-retail-zone-snapshot.json",
    "latest-price-protection-snapshot.json",
    "latest-marketing-boost-snapshot.json",
    "latest-marketing-boost-hero-snapshot.json",
    "latest-education-subsidy-agent-scan-summary.json",
    "latest-manual-price-overrides.json",
    "latest-inventory-adjustments.json",
    "latest-serial-overrides.json",
    "latest-marketplace-price-snapshot.json",
    "latest-inventory-master-snapshot.json",
    "latest-distributor-quotes.json",
    "latest-retail-core-price-signals.json",
    "latest-gray-wholesale-quotes.json",
    "latest-competitor-monitor.json",
    "latest-product-url-locks.json",
    "latest-lenovo-warranty-snapshot.json",
    "latest-warranty-check-queue.json",
    "latest-openclaw-purchase-inbound-projection.json",
    "latest-local-sync-pipelines.json",
    "latest-local-sync-report.json",
    "latest-local-sync-failure-queue.json",
    "latest-openclaw-chat-board.json",
    "latest-published-product-projection.json",
    "latest-published-product-projection-live.json",
    "latest-published-product-channel-audit.json",
]
AD_MACHINE_API_LABEL = "com.lenovo-smart-retail.api-server"
AD_MACHINE_WEB_LABEL = "com.lenovo-smart-retail.web-cockpit"
AD_MACHINE_GUARD_LABEL = "com.lenovo-smart-retail.ad-machine-guard"
AD_MACHINE_BOOT_SCRIPT = PROJECT_ROOT / "scripts" / "install_ad_machine_boot_services.sh"
AD_MACHINE_API_SCRIPT = PROJECT_ROOT / "scripts" / "install_api_server_launchagent.sh"
AD_MACHINE_WEB_SCRIPT = PROJECT_ROOT / "scripts" / "install_web_cockpit_launchagent.sh"
AD_MACHINE_GUARD_SCRIPT = PROJECT_ROOT / "scripts" / "install_ad_machine_guard_launchagent.sh"
AD_MACHINE_GUARD_STATE_FILE = Path.home() / ".cache" / "lenovo-smart-retail" / "ad-machine-guard-state.json"
AD_MACHINE_GUARD_LOG_FILE = Path.home() / "Library" / "Logs" / "lenovo-smart-retail" / "ad-machine-guard.log"
INVENTORY_SYNC_DIR = PROJECT_ROOT / "apps" / "inventory-sync"
AD_MACHINE_STATUS_SNAPSHOT_FILES = {
    "retailZone": "latest-retail-zone-snapshot.json",
    "publishedProjection": "latest-published-product-projection.json",
    "marketingBoost": "latest-marketing-boost-snapshot.json",
}
AD_MACHINE_STATUS_LABEL_MAP = {
    "retailZone": "广告商品零售区数据",
    "publishedProjection": "商品映射投影数据",
    "marketingBoost": "营销/教育补数据",
}


def safe_seed_reference_data(force: bool = False) -> dict[str, Any]:
    try:
        if force:
            return ensure_live_sql_bridge_sync(force=True)
        table_counts = retail_core.table_counts()
        return {
            "database": str(retail_core.DB_FILE),
            "seeded": {
                "skus": int(table_counts.get("sku", 0)),
                "serials": int(table_counts.get("serial_item", 0)),
                "movements": int(table_counts.get("inventory_movement", 0)),
                "salesOrders": int(table_counts.get("sales_order", 0)),
                "orderRegistry": int(table_counts.get("order_sync_registry", 0)),
                "warrantyRecords": int(table_counts.get("warranty_record", 0)),
            },
            "seedError": None,
            "tableCounts": table_counts,
            "source": "sqlite.table_counts",
        }
    except Exception as error:
        return {
            "database": str(retail_core.DB_FILE),
            "seedError": f"{type(error).__name__}: {error}",
        }


def safe_seed_product_library() -> dict[str, Any]:
    try:
        return ensure_product_library_seeded()
    except Exception as error:
        return {
            "seedError": f"{type(error).__name__}: {error}",
        }


def ensure_live_sql_bridge_sync(force: bool = False) -> dict[str, Any]:
    now = time.time()
    cached_payload = BRIDGE_SYNC_CACHE.get("payload")
    expires_at = float(BRIDGE_SYNC_CACHE.get("expires_at") or 0.0)
    if not force and isinstance(cached_payload, dict) and expires_at > now:
        return cached_payload
    with BRIDGE_SYNC_LOCK:
        now = time.time()
        cached_payload = BRIDGE_SYNC_CACHE.get("payload")
        expires_at = float(BRIDGE_SYNC_CACHE.get("expires_at") or 0.0)
        if not force and isinstance(cached_payload, dict) and expires_at > now:
            return cached_payload
        result = local_sync.ensure_openclaw_sql_bridge(DATA_DIR, force=force)
        if result.get("status") == "synced":
            RETAIL_CORE_STATUS_CACHE["expires_at"] = 0.0
            RETAIL_CORE_STATUS_CACHE["payload"] = None
            INVENTORY_SNAPSHOT_CACHE["expires_at"] = 0.0
            INVENTORY_SNAPSHOT_CACHE["payload"] = None
        BRIDGE_SYNC_CACHE["payload"] = result
        BRIDGE_SYNC_CACHE["expires_at"] = now + 12.0
        return result


def ensure_product_library_seeded(force: bool = False, ttl_seconds: float = 60.0) -> dict[str, Any]:
    now = time.time()
    expires_at = float(PRODUCT_LIBRARY_SEED_CACHE.get("expires_at") or 0.0)
    if not force and expires_at > now:
        cached_seed = PRODUCT_LIBRARY_SEED_CACHE.get("last_seed_result") or {}
        return {
            "ok": True,
            "cached": True,
            "expiresAt": expires_at,
            "lastError": PRODUCT_LIBRARY_SEED_CACHE.get("last_error"),
            **cached_seed,
        }
    with PRODUCT_LIBRARY_SEED_LOCK:
        now = time.time()
        expires_at = float(PRODUCT_LIBRARY_SEED_CACHE.get("expires_at") or 0.0)
        if not force and expires_at > now:
            cached_seed = PRODUCT_LIBRARY_SEED_CACHE.get("last_seed_result") or {}
            return {
                "ok": True,
                "cached": True,
                "expiresAt": expires_at,
                "lastError": PRODUCT_LIBRARY_SEED_CACHE.get("last_error"),
                **cached_seed,
            }
        try:
            seed_result = product_library.seed_from_snapshots(DATA_DIR)
            PRODUCT_LIBRARY_SEED_CACHE["expires_at"] = now + ttl_seconds
            PRODUCT_LIBRARY_SEED_CACHE["last_error"] = None
            PRODUCT_LIBRARY_SEED_CACHE["last_seed_result"] = seed_result if isinstance(seed_result, dict) else {}
            return {
                "ok": True,
                "cached": False,
                "expiresAt": PRODUCT_LIBRARY_SEED_CACHE["expires_at"],
                **(seed_result if isinstance(seed_result, dict) else {}),
            }
        except Exception as error:
            PRODUCT_LIBRARY_SEED_CACHE["last_error"] = f"{type(error).__name__}: {error}"
            raise


def ad_machine_run_command(command: list[str], timeout_seconds: float = 12.0) -> dict[str, Any]:
    try:
        started_at = time.perf_counter()
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
            "latencyMs": latency_ms,
            "command": command,
        }
    except subprocess.TimeoutExpired as error:
        return {
            "ok": False,
            "returncode": None,
            "stdout": (error.stdout or "").strip() if isinstance(error.stdout, str) else "",
            "stderr": (error.stderr or "").strip() if isinstance(error.stderr, str) else "",
            "latencyMs": int(timeout_seconds * 1000),
            "command": command,
            "error": f"timeout>{timeout_seconds}s",
        }
    except Exception as error:
        return {
            "ok": False,
            "returncode": None,
            "stdout": "",
            "stderr": "",
            "latencyMs": 0,
            "command": command,
            "error": f"{type(error).__name__}: {error}",
        }


def ad_machine_check_http(url: str, timeout_seconds: float = 4.0) -> dict[str, Any]:
    started_at = time.perf_counter()
    try:
        request = urllib_request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib_request.urlopen(request, timeout=timeout_seconds, context=MINIMAX_SSL_CONTEXT) as response:
            payload = response.read()
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            status_code = getattr(response, "status", 200)
            return {
                "ok": 200 <= status_code < 300,
                "statusCode": status_code,
                "latencyMs": latency_ms,
                "bodyPreview": payload[:240].decode("utf-8", errors="ignore"),
            }
    except urllib_error.HTTPError as error:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "ok": False,
            "statusCode": error.code,
            "latencyMs": latency_ms,
            "error": f"http_{error.code}",
        }
    except Exception as error:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "ok": False,
            "statusCode": None,
            "latencyMs": latency_ms,
            "error": f"{type(error).__name__}: {error}",
        }


def ad_machine_service_entry(
    key: str,
    title: str,
    ok: bool,
    detail: str,
    *,
    issue_type: str = "service_runtime",
    status_code: int | None = None,
    latency_ms: int | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "title": title,
        "status": "healthy" if ok else "unhealthy",
        "ok": ok,
        "detail": detail,
        "issueType": issue_type,
        "statusCode": status_code,
        "latencyMs": latency_ms,
        "meta": meta or {},
    }


def ad_machine_launchctl_status(label: str, title: str) -> dict[str, Any]:
    uid = str(os.getuid())
    result = ad_machine_run_command(
        ["launchctl", "print", f"gui/{uid}/{label}"],
        timeout_seconds=6.0,
    )
    output = f"{result.get('stdout', '')}\n{result.get('stderr', '')}".strip()
    pid_match = re.search(r"\bpid = (\d+)", output)
    state_match = re.search(r"\bstate = ([^\n]+)", output)
    pid = pid_match.group(1) if pid_match else ""
    state = state_match.group(1).strip() if state_match else ""
    ok = result.get("ok", False) and state == "running"
    detail_parts = []
    if state:
        detail_parts.append(f"状态 {state}")
    if pid:
        detail_parts.append(f"PID {pid}")
    if not detail_parts:
        detail_parts.append(result.get("error") or "launchctl 未返回运行状态")
    return ad_machine_service_entry(
        label,
        title,
        ok,
        " · ".join(detail_parts),
        latency_ms=result.get("latencyMs"),
        meta={
            "pid": pid or None,
            "launchctlState": state or None,
            "rawCommandOk": result.get("ok", False),
        },
    )


def ad_machine_snapshot_status(key: str, title: str, filename: str) -> dict[str, Any]:
    path = DATA_DIR / filename
    if not path.exists():
        return ad_machine_service_entry(
            key,
            title,
            False,
            "快照文件缺失",
            issue_type="snapshot_stale",
            meta={"filename": filename, "path": str(path), "cause": "missing_file"},
        )
    stat = path.stat()
    age_seconds = max(0, int(time.time() - stat.st_mtime))
    ok = age_seconds <= 900 and stat.st_size > 16
    cause = "ok"
    if stat.st_size <= 16:
        cause = "empty_file"
    elif age_seconds > 900:
        cause = "stale_snapshot"
    return ad_machine_service_entry(
        key,
        title,
        ok,
        f"最近更新 {age_seconds}s 前 · {stat.st_size // 1024}KB",
        issue_type="snapshot_stale",
        meta={
            "filename": filename,
            "path": str(path),
            "ageSeconds": age_seconds,
            "sizeBytes": stat.st_size,
            "cause": cause,
        },
    )


def ad_machine_guard_status() -> dict[str, Any]:
    launchctl_entry = ad_machine_launchctl_status(AD_MACHINE_GUARD_LABEL, "广告机自动守护")
    now_epoch = int(time.time())
    state_payload: dict[str, Any] = {}
    last_action = 0
    last_action_age = None
    last_action_text = "未读取到守护动作"
    if AD_MACHINE_GUARD_STATE_FILE.exists():
        try:
            state_payload = json.loads(AD_MACHINE_GUARD_STATE_FILE.read_text(encoding="utf-8"))
            last_action = int(state_payload.get("last_action") or 0)
        except Exception:
            last_action = 0
    if last_action > 0:
        last_action_age = max(0, now_epoch - last_action)
        action = str(state_payload.get("action") or "unknown")
        unhealthy = int(state_payload.get("unhealthy") or 0)
        last_action_text = f"{last_action_age}s 前执行 {action}（当时异常 {unhealthy}）"
    last_log = ""
    guard_log_age = None
    if AD_MACHINE_GUARD_LOG_FILE.exists():
        try:
            with AD_MACHINE_GUARD_LOG_FILE.open("r", encoding="utf-8", errors="ignore") as fp:
                lines = fp.readlines()
            if lines:
                last_log = lines[-1].strip()
            guard_log_age = max(0, now_epoch - int(AD_MACHINE_GUARD_LOG_FILE.stat().st_mtime))
        except Exception:
            last_log = ""
            guard_log_age = None
    if last_action_age is None and guard_log_age is not None:
        last_action_age = guard_log_age
        last_action_text = f"最近日志 {guard_log_age}s 前"
    launch_state = str((launchctl_entry.get("meta") or {}).get("launchctlState") or "")
    launch_ok = bool(launchctl_entry.get("ok")) or (
        bool((launchctl_entry.get("meta") or {}).get("rawCommandOk"))
        and (
            launch_state in {"running", "xpcproxy"}
            or launch_state.startswith("not ")
        )
    )
    ok = launch_ok and (last_action_age is None or last_action_age <= 7200)
    detail_parts = [
        launchctl_entry.get("detail") or "守护进程状态未知",
        last_action_text,
    ]
    if last_log:
        detail_parts.append(last_log[:120])
    return ad_machine_service_entry(
        "adMachineGuard",
        "广告机自动守护",
        ok,
        " · ".join(detail_parts),
        issue_type="service_runtime",
        meta={
            "stateFile": str(AD_MACHINE_GUARD_STATE_FILE),
            "logFile": str(AD_MACHINE_GUARD_LOG_FILE),
            "lastActionEpoch": last_action or None,
            "lastActionAgeSeconds": last_action_age,
            "lastLog": last_log[:300] if last_log else "",
            "scriptExists": AD_MACHINE_GUARD_SCRIPT.exists(),
        },
    )


def build_ad_machine_service_status() -> dict[str, Any]:
    services: list[dict[str, Any]] = []
    api_launchctl_entry = ad_machine_launchctl_status(AD_MACHINE_API_LABEL, "API 服务端")
    web_launchctl_entry = ad_machine_launchctl_status(AD_MACHINE_WEB_LABEL, "广告机前端")
    services.append(api_launchctl_entry)
    services.append(web_launchctl_entry)
    services.append(ad_machine_guard_status())
    api_health = ad_machine_check_http("http://127.0.0.1:8000/health")
    api_health_entry = ad_machine_service_entry(
        "apiHealth",
        "8000 健康探针",
        api_health.get("ok", False),
        "HTTP 正常" if api_health.get("ok", False) else f"探针失败：{api_health.get('error') or api_health.get('statusCode')}",
        status_code=api_health.get("statusCode"),
        latency_ms=api_health.get("latencyMs"),
    )
    services.append(api_health_entry)
    web_health = ad_machine_check_http("http://127.0.0.1:5174/ad-machine/index.html")
    web_health_entry = ad_machine_service_entry(
        "webHealth",
        "5174 广告机主页",
        web_health.get("ok", False),
        "页面可访问" if web_health.get("ok", False) else f"页面失败：{web_health.get('error') or web_health.get('statusCode')}",
        status_code=web_health.get("statusCode"),
        latency_ms=web_health.get("latencyMs"),
    )
    services.append(web_health_entry)
    if not api_launchctl_entry.get("ok") and api_health_entry.get("ok"):
        api_launchctl_entry["ok"] = True
        api_launchctl_entry["status"] = "healthy"
        api_launchctl_entry["detail"] = f"{api_launchctl_entry.get('detail') or 'launchctl 查询异常'} · 但 8000 已在线"
    if not web_launchctl_entry.get("ok") and web_health_entry.get("ok"):
        web_launchctl_entry["ok"] = True
        web_launchctl_entry["status"] = "healthy"
        web_launchctl_entry["detail"] = f"{web_launchctl_entry.get('detail') or 'launchctl 查询异常'} · 但 5174 已在线"
    for snapshot_key, filename in AD_MACHINE_STATUS_SNAPSHOT_FILES.items():
        services.append(ad_machine_snapshot_status(snapshot_key, AD_MACHINE_STATUS_LABEL_MAP[snapshot_key], filename))
    runtime_health = ad_machine_check_http("http://127.0.0.1:8000/api/ad-machine/runtime")
    services.append(
        ad_machine_service_entry(
            "runtime",
            "广告机运行时数据",
            runtime_health.get("ok", False),
            "运行时接口可访问" if runtime_health.get("ok", False) else f"运行时失败：{runtime_health.get('error') or runtime_health.get('statusCode')}",
            status_code=runtime_health.get("statusCode"),
            latency_ms=runtime_health.get("latencyMs"),
        )
    )
    unhealthy_count = sum(1 for item in services if not item.get("ok"))
    return {
        "updatedAt": now_iso(),
        "overallStatus": "healthy" if unhealthy_count == 0 else "degraded",
        "healthyCount": len(services) - unhealthy_count,
        "unhealthyCount": unhealthy_count,
        "services": services,
        "actions": {
            "bootScriptExists": AD_MACHINE_BOOT_SCRIPT.exists(),
            "apiScriptExists": AD_MACHINE_API_SCRIPT.exists(),
            "webScriptExists": AD_MACHINE_WEB_SCRIPT.exists(),
            "guardScriptExists": AD_MACHINE_GUARD_SCRIPT.exists(),
            "autoRepairCapable": AD_MACHINE_BOOT_SCRIPT.exists(),
        },
    }


def refresh_ad_machine_data_flow() -> dict[str, Any]:
    started_at = now_iso()
    command_results = {
        "retailZone": ad_machine_run_command(
            ["/bin/zsh", "-lc", f"cd '{INVENTORY_SYNC_DIR}' && npm run build:retail-zone"],
            timeout_seconds=120.0,
        ),
        "marketingBoost": ad_machine_run_command(
            ["/bin/zsh", "-lc", f"cd '{INVENTORY_SYNC_DIR}' && npm run build:marketing-boost"],
            timeout_seconds=120.0,
        ),
    }
    written = local_sync.write_static_snapshots(DATA_DIR)
    retail_core.sync_snapshot_cache(
        DATA_DIR,
        [
            "latest-retail-zone-snapshot.json",
            "latest-published-product-projection.json",
            "latest-marketing-boost-snapshot.json",
            "latest-marketing-boost-hero-snapshot.json",
            "latest-standard-inventory-snapshot.json",
        ],
    )
    finished_at = now_iso()
    snapshot_status = build_ad_machine_service_status()
    action_ok = all(result.get("ok", False) for result in command_results.values())
    return {
        "ok": action_ok,
        "action": "refresh-data",
        "startedAt": started_at,
        "updatedAt": finished_at,
        "commandResults": command_results,
        "written": written,
        "serviceStatus": snapshot_status,
    }


def refresh_ad_machine_data_module(module_key: str) -> dict[str, Any]:
    if module_key not in {"retailZone", "marketingBoost"}:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_module_key", "moduleKey": module_key},
        )
    command_map = {
        "retailZone": ["/bin/zsh", "-lc", f"cd '{INVENTORY_SYNC_DIR}' && npm run build:retail-zone"],
        "marketingBoost": ["/bin/zsh", "-lc", f"cd '{INVENTORY_SYNC_DIR}' && npm run build:marketing-boost"],
    }
    sync_map = {
        "retailZone": [
            "latest-retail-zone-snapshot.json",
            "latest-published-product-projection.json",
            "latest-standard-inventory-snapshot.json",
        ],
        "marketingBoost": [
            "latest-marketing-boost-snapshot.json",
            "latest-marketing-boost-hero-snapshot.json",
            "latest-retail-zone-snapshot.json",
            "latest-published-product-projection.json",
        ],
    }
    filename = AD_MACHINE_STATUS_SNAPSHOT_FILES[module_key]
    label = AD_MACHINE_STATUS_LABEL_MAP[module_key]
    before_status = ad_machine_snapshot_status(module_key, label, filename)
    command_result = ad_machine_run_command(command_map[module_key], timeout_seconds=120.0)
    written = local_sync.write_static_snapshots(DATA_DIR)
    retail_core.sync_snapshot_cache(DATA_DIR, sync_map[module_key])
    after_status = ad_machine_snapshot_status(module_key, label, filename)
    status_snapshot = build_ad_machine_service_status()
    return {
        "ok": bool(command_result.get("ok", False) and after_status.get("ok", False)),
        "action": "repair-module",
        "moduleKey": module_key,
        "moduleTitle": label,
        "before": before_status,
        "after": after_status,
        "cause": before_status.get("meta", {}).get("cause"),
        "commandResult": command_result,
        "written": written,
        "serviceStatus": status_snapshot,
        "updatedAt": now_iso(),
    }


def run_ad_machine_action(script_path: Path, action_name: str) -> dict[str, Any]:
    if not script_path.exists():
        raise HTTPException(
            status_code=404,
            detail={"error": "script_not_found", "path": str(script_path), "action": action_name},
        )
    result = ad_machine_run_command(["/bin/zsh", str(script_path)], timeout_seconds=60.0)
    status_snapshot = build_ad_machine_service_status()
    for _ in range(8):
        api_entry = next((item for item in status_snapshot.get("services", []) if item.get("key") == "apiHealth"), {})
        web_entry = next((item for item in status_snapshot.get("services", []) if item.get("key") == "webHealth"), {})
        if api_entry.get("ok") and web_entry.get("ok"):
            break
        time.sleep(1.5)
        status_snapshot = build_ad_machine_service_status()
    recovered = all(
        next((item for item in status_snapshot.get("services", []) if item.get("key") == key), {}).get("ok")
        for key in ("apiHealth", "webHealth")
    )
    action_ok = bool(result.get("ok", False) or recovered)
    return {
        "ok": action_ok,
        "action": action_name,
        "scriptPath": str(script_path),
        "command": result.get("command"),
        "stdout": result.get("stdout"),
        "stderr": result.get("stderr"),
        "returncode": result.get("returncode"),
        "latencyMs": result.get("latencyMs"),
        "recoveredAfterRestart": recovered,
        "serviceStatus": status_snapshot,
        "updatedAt": now_iso(),
    }


def restart_ad_machine_runtime_services(action_name: str) -> dict[str, Any]:
    precheck_status = build_ad_machine_service_status()
    api_precheck = next((item for item in precheck_status.get("services", []) if item.get("key") == "apiHealth"), {})
    web_precheck = next((item for item in precheck_status.get("services", []) if item.get("key") == "webHealth"), {})
    precheck_healthy = bool(api_precheck.get("ok") and web_precheck.get("ok"))
    if precheck_healthy:
        return {
            "ok": True,
            "effective": True,
            "action": action_name,
            "mode": "precheck-skip",
            "retryTriggered": False,
            "retryResults": {},
            "stderr": "",
            "stdout": "services already healthy, kickstart skipped",
            "returncode": 0,
            "commandResults": {
                "apiServer": {
                    "ok": True,
                    "returncode": 0,
                    "stdout": "skip: api already healthy",
                    "stderr": "",
                    "latencyMs": 0,
                    "command": ["launchctl", "kickstart", "-k", f"gui/{os.getuid()}/{AD_MACHINE_API_LABEL}"],
                },
                "webCockpit": {
                    "ok": True,
                    "returncode": 0,
                    "stdout": "skip: web already healthy",
                    "stderr": "",
                    "latencyMs": 0,
                    "command": ["launchctl", "kickstart", "-k", f"gui/{os.getuid()}/{AD_MACHINE_WEB_LABEL}"],
                },
            },
            "serviceStatus": precheck_status,
            "updatedAt": now_iso(),
        }

    uid = str(os.getuid())
    api_cmd = ["launchctl", "kickstart", "-k", f"gui/{uid}/{AD_MACHINE_API_LABEL}"]
    web_cmd = ["launchctl", "kickstart", "-k", f"gui/{uid}/{AD_MACHINE_WEB_LABEL}"]
    api_result = ad_machine_run_command(api_cmd, timeout_seconds=8.0)
    web_result = ad_machine_run_command(web_cmd, timeout_seconds=8.0)
    retry_results: dict[str, dict[str, Any]] = {}
    retry_triggered = False
    if not api_result.get("ok", False) or not web_result.get("ok", False):
        retry_triggered = True
        time.sleep(1.2)
        if not api_result.get("ok", False):
            api_retry = ad_machine_run_command(api_cmd, timeout_seconds=8.0)
            retry_results["apiServer"] = api_retry
            if api_retry.get("ok", False):
                api_result = api_retry
        if not web_result.get("ok", False):
            web_retry = ad_machine_run_command(web_cmd, timeout_seconds=8.0)
            retry_results["webCockpit"] = web_retry
            if web_retry.get("ok", False):
                web_result = web_retry
    status_snapshot = build_ad_machine_service_status()
    for _ in range(8):
        api_entry = next((item for item in status_snapshot.get("services", []) if item.get("key") == "apiHealth"), {})
        web_entry = next((item for item in status_snapshot.get("services", []) if item.get("key") == "webHealth"), {})
        if api_entry.get("ok") and web_entry.get("ok"):
            break
        time.sleep(1.5)
        status_snapshot = build_ad_machine_service_status()
    recovered = all(
        next((item for item in status_snapshot.get("services", []) if item.get("key") == key), {}).get("ok")
        for key in ("apiHealth", "webHealth")
    )
    both_commands_ok = bool(api_result.get("ok", False) and web_result.get("ok", False))
    stderr_parts = [item for item in [api_result.get("stderr"), web_result.get("stderr")] if item]
    stdout_parts = [item for item in [api_result.get("stdout"), web_result.get("stdout")] if item]
    return {
        "ok": bool(recovered and both_commands_ok),
        "effective": bool(recovered),
        "action": action_name,
        "mode": "kickstart",
        "retryTriggered": retry_triggered,
        "retryResults": retry_results,
        "stderr": "\n".join(stderr_parts),
        "stdout": "\n".join(stdout_parts),
        "returncode": 0 if both_commands_ok else 1,
        "commandResults": {
            "apiServer": api_result,
            "webCockpit": web_result,
        },
        "serviceStatus": status_snapshot,
        "updatedAt": now_iso(),
    }

app = FastAPI(title="Lenovo Smart Retail API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# 教育补贴采集 v2 路由
from app.edu_scan_v2_api import router as edu_scan_v2_router
app.include_router(edu_scan_v2_router)

# 采集对接端路由（另一台电脑调用，2026-06-09）
from app.collection_bridge_api import router as collection_bridge_router
app.include_router(collection_bridge_router)

# 教育补贴采集工作台路由
from app.education_collection_workbench_api import router as education_collection_workbench_router
app.include_router(education_collection_workbench_router)

# 进销存报表路由
from app.inventory_turnover_api import router as inventory_turnover_router
app.include_router(inventory_turnover_router)

# 电子价签同步路由
from app.price_tag_sync import router as price_tag_router
app.include_router(price_tag_router)

# 价签-库存关联视图路由
from app.store_display_api import router as store_display_router
app.include_router(store_display_router)

# 广告机内容管理 API（2026-06-10）
from app.ad_machine_api import router as ad_machine_router
app.include_router(ad_machine_router)

# 合规校验预警 API（2026-06-10）
from app.compliance_api import router as compliance_router
app.include_router(compliance_router)


@app.middleware("http")
async def no_store_realtime_api_cache(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if (
        path.startswith("/api/inventory-quote/")
        or path.startswith("/api/retail-core/")
        or path.startswith("/api/sales/")
        or path.startswith("/api/sync/")
        or path.startswith("/api/product-library/")
        or path.startswith("/api/ad-machine/")
        or path.startswith("/api/marketing/")
        or path.startswith("/api/education-scan/")
    ):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


class SalesOrderLineInput(BaseModel):
    skuKey: str = Field(min_length=1)
    quantity: int = Field(default=1, ge=1)
    serialNumbers: list[str] = Field(default_factory=list)
    dealPrice: float = Field(ge=0)


class SalesOrderCreateInput(BaseModel):
    storeCode: str = Field(min_length=1)
    operatorId: str = Field(min_length=1)
    customerName: str = ""
    status: str = "completed"
    note: str = ""
    lines: list[SalesOrderLineInput] = Field(min_length=1)


class PurchaseOrderLineInput(BaseModel):
    skuKey: str = Field(min_length=1)
    productName: str = ""
    pnMtm: str = ""
    spec: str = ""
    category: str = ""
    sourceCategory: str = ""
    jdSubcategory: str = ""
    catalogSource: str = "local_purchase"
    quantity: int = Field(default=1, ge=1)
    serialNumbers: list[str] = Field(default_factory=list)
    costPrice: float | None = Field(default=None, ge=0)


class PurchaseOrderCreateInput(BaseModel):
    supplierId: str = Field(default="联想厂家", min_length=1)
    operatorId: str = Field(default="EMP001", min_length=1)
    locationCode: str = "SALES_FLOOR"
    note: str = ""
    lines: list[PurchaseOrderLineInput] = Field(min_length=1)


class PriceTagUpdateInput(BaseModel):
    skuKey: str = Field(min_length=1)
    templateId: str = "default-store-price"
    deviceId: str | None = None
    storeCode: str = "LENOVO-SR-001"
    pricePayload: dict[str, Any] = Field(default_factory=dict)


class PriceTagDeviceInput(BaseModel):
    id: str = Field(min_length=1)
    vendor: str = Field(min_length=1)
    model: str = ""
    storeCode: str = "LENOVO-SR-001"
    status: str = "planned"
    batteryLevel: int | None = None
    signalLevel: int | None = None
    lastSeenAt: str | None = None


class PriceTagTemplateInput(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    templateType: str = "store_price"
    payload: dict[str, Any] = Field(default_factory=dict)


class PriceTagBindingInput(BaseModel):
    id: str = Field(min_length=1)
    deviceId: str = Field(min_length=1)
    skuKey: str = Field(min_length=1)
    storeCode: str = "LENOVO-SR-001"
    status: str = "active"


class LocalSyncRunInput(BaseModel):
    pipeline: str = Field(min_length=1)
    dryRun: bool = False
    trigger: str = "api"
    operator: str | None = None


class InventoryMasterAutoSyncInput(BaseModel):
    trigger: str = "inventory_ledger_auto"
    operator: str | None = None
    source: str = ""
    force: bool = False
    waitForCompletion: bool = True
    minIntervalSeconds: float = 20.0
    maxWaitSeconds: float = 45.0


class AdMachineTtsInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voiceId: str | None = None


class AdMachineMiniMaxImageRecognitionInput(BaseModel):
    imageBase64: str = Field(min_length=1)
    mode: str = "reference"


class AdMachineBarcodeRecognitionInput(BaseModel):
    imageBase64: str = Field(min_length=1)
    mode: str = "reference"


class ProductMasterUpdateInput(BaseModel):
    canonicalName: str | None = None
    productLine: str | None = None
    modelFamily: str | None = None
    defaultCategory: str | None = None
    configurationSummary: str | None = None
    reviewStatus: str | None = None
    sourceConfidence: str | None = None
    notes: str | None = None
    changedBy: str = "system"
    reason: str = "manual product library update"


class ProductSkuUpdateInput(BaseModel):
    pnMtm: str | None = None
    name: str | None = None
    category: str | None = None
    sourceCategory: str | None = None
    jdSubcategory: str | None = None
    catalogSource: str | None = None
    changedBy: str = "system"
    reason: str = "manual sku profile update"


class ProductSyncReplayInput(BaseModel):
    replayType: str = Field(min_length=1)
    sourceSystem: str = Field(min_length=1)
    sourceRef: str = ""
    scope: dict[str, Any] = Field(default_factory=dict)
    createdBy: str = "system"


class ProductPriceAdjustmentInput(BaseModel):
    skuKey: str = Field(min_length=1)
    storeRetailPrice: float | None = Field(default=None, ge=0)
    realtimePurchasePrice: float | None = Field(default=None, ge=0)
    marketWholesalePrice: float | None = Field(default=None, ge=0)
    retailPreSubsidyPrice: float | None = Field(default=None, ge=0)
    defensivePostSubsidyPrice: float | None = Field(default=None, ge=0)
    reason: str = "manual price calibration"
    changedBy: str = "system"
    syncPriceTag: bool = False
    priceTagTemplateId: str = "default-store-price"


class ProductBusinessRuleUpdateInput(BaseModel):
    storePriceRuleText: str | None = None
    subsidyRuleText: str | None = None
    collectionRuleText: str | None = None
    inboundRuleText: str | None = None
    outboundRuleText: str | None = None
    protectionRuleText: str | None = None
    notes: str | None = None
    changedBy: str = "system"
    reason: str = "manual product rule update"


class ProductCollectionOverrideInput(BaseModel):
    jdUrl: str | None = None
    lenovoUrl: str | None = None
    tmallUrl: str | None = None
    distributorQuoteNote: str | None = None
    grayQuoteNote: str | None = None
    captureNote: str | None = None
    changedBy: str = "system"
    reason: str = "manual collection info update"


class ScheduledTaskProfileUpdateInput(BaseModel):
    label: str | None = None
    category: str | None = None
    priority: int | None = None
    requiresComputerUse: bool | None = None
    relatedPipeline: str | None = None
    defaultPrompt: str | None = None
    currentPrompt: str | None = None
    workflowSummary: str | None = None
    stepItems: list[str] | None = None
    sourceItems: list[str] | None = None
    boundaryItems: list[str] | None = None
    timeWindows: list[dict[str, Any]] | None = None
    operatorNotes: str | None = None
    enabled: bool | None = None
    changedBy: str = "system"
    reason: str = "manual scheduled task console update"


class ProductLibraryRebuildInput(BaseModel):
    scope: str = "full"


class StoreManualPromotionItemInput(BaseModel):
    id: str = ""
    skuKey: str = Field(min_length=1)
    productName: str = ""
    pnMtm: str = ""
    category: str = ""
    mode: str = "minus_amount"
    value: float = Field(ge=0)
    validFrom: str = Field(min_length=1)
    validTo: str = Field(min_length=1)
    note: str = ""
    enabled: bool = True
    updatedAt: str = ""


class StoreManualPromotionsInput(BaseModel):
    items: list[StoreManualPromotionItemInput] = Field(default_factory=list)


class ManufacturerManualPromotionItemInput(BaseModel):
    id: str = ""
    sourceKey: str = Field(min_length=1)
    outboundDate: str = Field(min_length=1)
    orderNumber: str = ""
    outboundDocumentNumber: str = ""
    skuKey: str = Field(min_length=1)
    productName: str = Field(min_length=1)
    pnMtm: str = ""
    spec: str = ""
    category: str = ""
    boostAmount: float = Field(ge=0)
    educationAmount: float = Field(ge=0)
    note: str = ""
    enabled: bool = True
    createdAt: str = ""
    updatedAt: str = ""


class ManufacturerManualPromotionsInput(BaseModel):
    items: list[ManufacturerManualPromotionItemInput] = Field(default_factory=list)


class CrossOutboundCheckRuleItemInput(BaseModel):
    id: str = ""
    matchMode: str = "sku"
    sourceKey: str = Field(min_length=1)
    sourceLabel: str = ""
    skuKey: str = ""
    pnMtm: str = ""
    productName: str = ""
    spec: str = ""
    category: str = ""
    counterparty: str = "联想"
    settlementMode: str = "priceDiff"
    calculationBasis: str = "purchaseCost"
    settlementPrice: float | None = Field(default=None, ge=0)
    perUnitAmount: float | None = Field(default=None, ge=0)
    validFrom: str = Field(min_length=1)
    validTo: str = Field(min_length=1)
    note: str = ""
    enabled: bool = True
    createdAt: str = ""
    updatedAt: str = ""


class CrossOutboundCheckRulesInput(BaseModel):
    items: list[CrossOutboundCheckRuleItemInput] = Field(default_factory=list)


class CrossOutboundCheckHistoryItemInput(BaseModel):
    id: str = ""
    ruleId: str = ""
    sourceKey: str = ""
    orderNumber: str = Field(min_length=1)
    outboundDate: str = Field(min_length=1)
    businessDate: str = ""
    skuKey: str = Field(min_length=1)
    pnMtm: str = ""
    productName: str = Field(min_length=1)
    spec: str = ""
    category: str = ""
    productLine: str = "computer"
    quantity: int = Field(default=1, ge=1)
    costUnitPrice: float | None = None
    costTotalAmount: float | None = None
    costSource: str = ""
    serialCosts: list[float] = Field(default_factory=list)
    salesUnitPrice: float | None = None
    salesTotalAmount: float | None = None
    settlementMode: str = "priceDiff"
    calculationBasis: str = "purchaseCost"
    settlementPrice: float | None = Field(default=None, ge=0)
    perUnitAmount: float | None = Field(default=None, ge=0)
    crossCheckAmount: float = Field(default=0, ge=0)
    counterparty: str = "联想"
    serialNumbers: list[str] = Field(default_factory=list)
    storeName: str = ""
    operatorName: str = ""
    note: str = ""
    ruleValidFrom: str = ""
    ruleValidTo: str = ""
    createdAt: str = ""
    updatedAt: str = ""


class CrossOutboundCheckHistoryInput(BaseModel):
    items: list[CrossOutboundCheckHistoryItemInput] = Field(default_factory=list)


class ManualPriceOverridesInput(BaseModel):
    overrides: dict[str, dict[str, Any]] = Field(default_factory=dict)


class InventoryAdjustmentsInput(BaseModel):
    adjustments: dict[str, dict[str, Any]] = Field(default_factory=dict)


class PhysicalStockHoldTransferInput(BaseModel):
    orderNumber: str = Field(min_length=1)
    serialNumbers: list[str] = Field(default_factory=list)
    holdReason: str = "po_education_preout"
    note: str = ""
    operatorName: str = "system"


class PhysicalStockHoldFinalizeInput(BaseModel):
    serviceOrderNo: str = ""
    serialNumbers: list[str] = Field(default_factory=list)
    note: str = ""
    operatorName: str = "system"


class PhysicalStockHoldReleaseInput(BaseModel):
    serialNumbers: list[str] = Field(default_factory=list, min_length=1)
    note: str = ""
    operatorName: str = "system"


class PhysicalStockHoldRevokeInput(BaseModel):
    serialNumbers: list[str] = Field(default_factory=list, min_length=1)
    note: str = ""
    operatorName: str = "system"


class PhysicalStockHoldReopenInput(BaseModel):
    serialNumbers: list[str] = Field(default_factory=list, min_length=1)
    note: str = ""
    operatorName: str = "system"


class PhysicalStockHoldRebindInput(BaseModel):
    serviceOrderNo: str = Field(min_length=1)
    serialNumbers: list[str] = Field(default_factory=list, min_length=1)
    note: str = ""
    operatorName: str = "system"


class FrontendDisplayControlsInput(BaseModel):
    showMarketingPo: bool = True
    showEducationSubsidy: bool = True


class FrontendActivityDisplayOverrideInput(BaseModel):
    activityId: str = ""
    skuKey: str
    marketingPoEnabled: bool = True
    marketingPoAmount: float | None = Field(default=None, ge=0)
    educationSubsidyEnabled: bool = True
    educationSubsidyAmount: float | None = Field(default=None, ge=0)
    note: str = ""


class OpenClawChatSendInput(BaseModel):
    message: str = Field(min_length=1)
    title: str | None = None
    taskName: str | None = None
    presetKey: str | None = None
    commandMode: str | None = None
    sourceScope: str | None = None
    targetDate: str | None = None
    dateFrom: str | None = None
    dateTo: str | None = None
    collectionNote: str | None = None


class OpenClawChatFeedbackInput(BaseModel):
    message: str = Field(min_length=1)
    taskName: str | None = None
    status: str = "completed"
    blockingReason: str | None = None
    relatedReceiptId: str | None = None


class PromptWorkspaceEntryInput(BaseModel):
    id: str | None = None
    title: str = "高精度任务提问"
    category: str = "通用任务"
    primaryCategory: str = "主提问内容"
    secondaryCategory: str = "默认流程"
    sequenceNo: int = 10
    isFavorite: bool = False
    projectName: str = ""
    systemPurpose: str = ""
    existingContext: str = ""
    currentProblem: str = ""
    problemDetails: list[str] = Field(default_factory=list)
    targetOutcome: str = ""
    targetChecklist: list[str] = Field(default_factory=list)
    rules: list[str] = Field(default_factory=list)
    deliverables: list[str] = Field(default_factory=list)
    acceptanceCriteria: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    rawNotes: str = ""
    autoOptimize: bool = False


class PromptWorkspaceOptimizeInput(BaseModel):
    force: bool = False


class PromptWorkspaceEntryMetaInput(BaseModel):
    category: str | None = None
    primaryCategory: str | None = None
    secondaryCategory: str | None = None
    sequenceNo: int | None = None
    isFavorite: bool | None = None


class PromptWorkspaceEntryUpdateInput(BaseModel):
    title: str | None = None
    category: str | None = None
    primaryCategory: str | None = None
    secondaryCategory: str | None = None
    sequenceNo: int | None = None
    isFavorite: bool | None = None
    projectName: str | None = None
    systemPurpose: str | None = None
    existingContext: str | None = None
    currentProblem: str | None = None
    problemDetails: list[str] = Field(default_factory=list)
    targetOutcome: str | None = None
    targetChecklist: list[str] = Field(default_factory=list)
    rules: list[str] = Field(default_factory=list)
    deliverables: list[str] = Field(default_factory=list)
    acceptanceCriteria: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    rawNotes: str | None = None
    autoOptimize: bool = False


class PromptWorkspaceKnowledgeInput(BaseModel):
    id: str | None = None
    title: str = Field(min_length=1)
    keyword: str = ""
    content: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    knowledgeType: str = "general"
    placementKey: str = "knowledge"
    sceneKey: str = ""
    sceneLabel: str = ""
    sourceEntryId: str | None = None


class PromptWorkspaceKnowledgeRecommendInput(BaseModel):
    title: str = ""
    primaryCategory: str = ""
    secondaryCategory: str = ""
    projectName: str = ""
    systemPurpose: str = ""
    existingContext: str = ""
    currentProblem: str = ""
    problemDetails: list[str] = Field(default_factory=list)
    targetOutcome: str = ""
    targetChecklist: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    knowledgeType: str = "rule_prompt"
    placementKey: str = "rules"
    limit: int = 6


class AdminLoginInput(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AdminPasswordChangeInput(BaseModel):
    username: str = Field(min_length=1)
    currentPassword: str = Field(min_length=1)
    newPassword: str = Field(min_length=4)


class AdminUserCreateInput(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=4)
    displayName: str = ""


class AdminUserStatusInput(BaseModel):
    username: str = Field(min_length=1)
    active: bool


class AdMachineLotteryDrawInput(BaseModel):
    customerName: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    productModel: str = Field(min_length=1)
    orderNumber: str = ""


class AdMachineLotteryParticipantInput(BaseModel):
    customerName: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    productModel: str = ""
    skuKey: str = ""
    serialNumber: str = Field(min_length=1)
    note: str = ""


class AdMachineLotteryFormalDrawInput(BaseModel):
    participantId: str = Field(min_length=1)


class AdMachineLotteryLocalConfigInput(BaseModel):
    lotteryLanBaseUrl: str = Field(min_length=1)


class AdMachineAdminConfigUpdateInput(BaseModel):
    defaultTabId: str = Field(default="", max_length=40)
    autoRefreshIntervalMs: int = Field(default=1800000, ge=5000, le=86400000)
    lotteryLanBaseUrl: str = Field(default="", max_length=200)
    modules: list[dict[str, Any]] = Field(default_factory=list)
    layout: dict[str, Any] = Field(default_factory=dict)
    lottery: dict[str, Any] = Field(default_factory=dict)
    serviceQueue: dict[str, Any] = Field(default_factory=dict)


class AdMachineLotteryMockDrawInput(BaseModel):
    nickname: str = ""
    productModel: str = ""


class AdMachineLotteryAdminRoundOpenInput(BaseModel):
    force: bool = False


class AdMachineLeadSubmitInput(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    orderNumber: str = ""
    storeName: str = ""
    productModel: str = ""
    lotteryCode: str = ""
    note: str = ""


class Gaokao2026LeadSubmitInput(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    phone: str = Field(min_length=1, max_length=20)
    major: str = Field(default="", max_length=80)
    budget: str = Field(default="", max_length=40)
    purchaseTime: str = Field(default="", max_length=40)
    interest: str = Field(default="", max_length=80)
    message: str = Field(default="", max_length=500)
    campaign: str = Field(default="gaokao2026", max_length=40)
    source: str = Field(default="mobile", max_length=40)
    action: str = Field(default="lead", max_length=40)


class Gaokao2026CouponRedeemInput(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    phoneLast6: str = Field(default="", max_length=6)
    operator: str = Field(default="ad-machine", max_length=40)
    deviceId: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=200)


class Gaokao2026CouponConfigUpdateInput(BaseModel):
    totalCount: int = Field(default=999, ge=1, le=50000)
    validFrom: str = Field(default="", max_length=20)
    validTo: str = Field(default="", max_length=20)
    offerValue: str = Field(default="699", max_length=20)
    offerSecondary: str = Field(default="三人同行升 899", max_length=80)
    offerTitle: str = Field(default="高考生电子优惠券", max_length=80)
    offerText: str = Field(default="凭券购联想笔记本升级智惠四年服务；三人同行可升级智惠五年服务。", max_length=300)
    redeemText: str = Field(default="到店出示券码，门店核验后生效。", max_length=200)
    storeName: str = Field(default="联想体验店（新野书院路店）", max_length=80)
    storePhone: str = Field(default="15637798222", max_length=30)


class Gaokao2026PortalLoginInput(BaseModel):
    phone: str = Field(min_length=1, max_length=20)
    name: str = Field(default="", max_length=40)


class Gaokao2026PortalViewerInput(BaseModel):
    phone: str = Field(min_length=1, max_length=20)
    token: str = Field(min_length=1, max_length=80)


class Gaokao2026PortalMessageCreateInput(BaseModel):
    phone: str = Field(min_length=1, max_length=20)
    token: str = Field(min_length=1, max_length=80)
    name: str = Field(default="", max_length=40)
    channel: str = Field(default="wish", max_length=20)
    topic: str = Field(default="", max_length=80)
    wishTag: str = Field(default="", max_length=40)
    message: str = Field(min_length=1, max_length=1000)
    major: str = Field(default="", max_length=80)
    budget: str = Field(default="", max_length=40)
    purchaseTime: str = Field(default="", max_length=40)
    replyToMessageId: str = Field(default="", max_length=80)
    replyToTopic: str = Field(default="", max_length=120)
    replyToChannel: str = Field(default="", max_length=20)
    replySource: str = Field(default="", max_length=40)
    imageBase64: str = ""
    imageMimeType: str = Field(default="", max_length=80)
    imageName: str = Field(default="", max_length=120)


class Gaokao2026PortalReplyInput(BaseModel):
    replyMessage: str = Field(default="", max_length=2000)
    followUpReplyMessage: str = Field(default="", max_length=2000)
    responder: str = Field(default="门店顾问", max_length=40)
    status: str = Field(default="replied", max_length=20)
    replyImageBase64: str = ""
    replyImageMimeType: str = Field(default="", max_length=80)
    replyImageName: str = Field(default="", max_length=120)
    followUpAction: str = Field(default="", max_length=120)
    internalNote: str = Field(default="", max_length=500)
    suggestedSkuKeys: list[str] = Field(default_factory=list)
    publicApproved: bool | None = None


class Gaokao2026CustomerOpsUpdateInput(BaseModel):
    followUpStage: str = Field(default="new_lead", max_length=40)
    intentLevel: str = Field(default="A", max_length=20)
    assignedTo: str = Field(default="", max_length=40)
    nextFollowUpAt: str = Field(default="", max_length=40)
    visitStatus: str = Field(default="not_arrived", max_length=30)
    conversionStatus: str = Field(default="active", max_length=30)
    soldProductModel: str = Field(default="", max_length=120)
    convertedAt: str = Field(default="", max_length=40)
    lostReason: str = Field(default="", max_length=200)
    preferredCategories: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    latestNote: str = Field(default="", max_length=500)


class Gaokao2026CustomerFollowUpLogInput(BaseModel):
    actor: str = Field(default="", max_length=40)
    logType: str = Field(default="follow_up", max_length=40)
    content: str = Field(default="", max_length=1000)
    resultStatus: str = Field(default="", max_length=40)
    scheduledAt: str = Field(default="", max_length=40)


class Gaokao2026CustomerQuickActionInput(BaseModel):
    action: str = Field(min_length=1, max_length=40)
    actor: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=200)


class Gaokao2026RecommendationInput(BaseModel):
    phone: str = Field(default="", max_length=20)
    token: str = Field(default="", max_length=80)
    major: str = Field(default="", max_length=80)
    budget: str = Field(default="", max_length=40)
    usageFocus: str = Field(default="", max_length=80)
    portability: str = Field(default="", max_length=40)
    performanceNeed: str = Field(default="", max_length=40)
    aiFocus: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=300)


class Gaokao2026AiChatInput(BaseModel):
    phone: str = Field(min_length=1, max_length=20)
    token: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=1200)
    major: str = Field(default="", max_length=80)
    budget: str = Field(default="", max_length=40)
    recommendationSkuKeys: list[str] = Field(default_factory=list)


class AdMachineServiceTicketCreateInput(BaseModel):
    category: str = Field(min_length=1)
    customerName: str = ""
    phone: str = ""


class AdMachineServiceTicketStatusInput(BaseModel):
    status: str = Field(min_length=1)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_gaokao_text(value: Any, limit: int = 120) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:limit]


def normalize_mainland_phone(value: Any) -> str:
    return re.sub(r"\D", "", str(value or "").strip())


GAOKAO_AI_BOUNDARY_RULES = {
    "illegal": {
        "keywords": [
            "炸药", "爆炸", "枪", "刀", "暴力", "毒品", "赌博", "洗钱", "诈骗", "破解", "翻墙",
            "黑客", "攻击", "盗号", "色情网", "黄色", "约炮", "辱骂", "仇恨", "极端", "恐怖", "政治敏感",
        ],
        "reply": "这个问题不在门店 AI 顾问的服务范围内。我只能协助高考选机、学习办公场景建议、门店活动说明和到店咨询，不提供违法违规或不当内容。",
        "reason": "policy_violation",
    },
    "secret": {
        "keywords": [
            "底价", "最低价", "进货价", "渠道价", "内部价", "拿货价", "毛利", "利润", "成本价", "保密价格", "商业秘密",
        ],
        "reply": "涉及门店内部价格、成本和渠道策略的信息不能对外提供。我可以继续说明公开活动权益、适合的机型方向和到店核验方式。",
        "reason": "trade_secret",
    },
}

GAOKAO_KNOWLEDGE_INTENT_RULES = {
    "win11": ["win11", "系统", "驱动", "软件", "兼容", "安装", "office", "浏览器", "资料盘", "同步"],
    "service": ["售后", "保修", "延保", "维修", "sn", "服务", "核销", "电子券"],
    "activity": ["活动", "教育补", "国补", "三件套", "二件套", "优惠券", "权益"],
    "computer_ai": ["计算机", "人工智能", "代码", "编程", "开发", "容器", "本地ai", "数据"],
    "design": ["设计", "传媒", "剪辑", "建模", "渲染", "cad", "adobe"],
    "portable": ["轻薄", "便携", "图书馆", "课堂", "通勤", "续航"],
    "gaming": ["游戏", "显卡", "高刷", "性能", "散热"],
}


def mask_gaokao_name(value: Any) -> str:
    text = normalize_gaokao_text(value, 20)
    if not text:
        return "同学"
    return f"{text[0]}同学"


def mask_gaokao_phone(value: Any) -> str:
    phone = normalize_mainland_phone(value)
    if len(phone) != 11:
        return "手机号已脱敏"
    return f"{phone[:3]}****{phone[-4:]}"


def normalize_gaokao_date(value: Any, default: str) -> str:
    text = str(value or "").strip()
    if not text:
        return default
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise HTTPException(status_code=400, detail="日期格式必须为 YYYY-MM-DD")
    return text


GAOKAO_2026_COUPON_VALID_FROM = "2026-06-05"
GAOKAO_2026_COUPON_VALID_TO = "2026-06-21"
GAOKAO_2026_COUPON_START_SEQUENCE = 88
GAOKAO_2026_COUPON_TOTAL = 999
GAOKAO_2026_COUPON_END_SEQUENCE = GAOKAO_2026_COUPON_START_SEQUENCE + GAOKAO_2026_COUPON_TOTAL - 1
GAOKAO_2026_PORTAL_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
GAOKAO_2026_UPLOAD_DIR = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "gaokao-2026" / "uploads"
GAOKAO_2026_AI_KNOWLEDGE_FILE = "latest-gaokao-ai-knowledge-base.json"
GAOKAO_2026_AI_KNOWLEDGE_ADMIN_FILE = "latest-gaokao-ai-knowledge-admin-base.json"
GAOKAO_2026_DAILY_LEARNING_FILE = "latest-gaokao-daily-learning.json"
GAOKAO_2026_MAJOR_GUIDES_FILE = "latest-gaokao-major-guides.json"
GAOKAO_2026_RECOMMENDATION_RULES = [
    {
        "keyword": ("文科", "经管", "师范", "法学"),
        "categories": ("轻薄笔记本", "平板电脑"),
        "focus": "优先轻薄、续航和护眼屏，适合课表密集、经常进教室和图书馆的专业。",
    },
    {
        "keyword": ("计算机", "人工智能", "数据科学"),
        "categories": ("轻薄笔记本", "游戏笔记本"),
        "focus": "优先 CPU、内存和散热，建议 16GB 起步，重度编程和本地模型建议 32GB。",
    },
    {
        "keyword": ("设计", "传媒", "建筑", "工程"),
        "categories": ("游戏笔记本", "轻薄笔记本"),
        "focus": "重点看显卡、屏幕色域和稳定性，适合 Adobe、建模、渲染和多软件并行。",
    },
    {
        "keyword": ("医学", "考研", "日常学习"),
        "categories": ("轻薄笔记本", "平板电脑"),
        "focus": "优先静音、续航和资料整理体验，适合网课、题库、电子笔记和文献阅读。",
    },
    {
        "keyword": ("游戏", "剪辑", "建模", "直播"),
        "categories": ("游戏笔记本", "轻薄笔记本"),
        "focus": "优先显卡、散热和高刷屏，适合高性能软件、游戏和视频创作。",
    },
]


def default_gaokao_coupon_config() -> dict[str, Any]:
    return {
        "campaign": "gaokao2026",
        "startSequence": GAOKAO_2026_COUPON_START_SEQUENCE,
        "totalCount": GAOKAO_2026_COUPON_TOTAL,
        "validFrom": GAOKAO_2026_COUPON_VALID_FROM,
        "validTo": GAOKAO_2026_COUPON_VALID_TO,
        "offerTitle": "高考生电子优惠券",
        "offerValue": "699",
        "offerSecondary": "三人同行升 899",
        "offerText": "凭券购联想笔记本升级智惠四年服务；三人同行可升级智惠五年服务。",
        "redeemText": "到店出示券码，门店核验后生效。",
        "storeName": "联想体验店（新野书院路店）",
        "storePhone": "15637798222",
    }


def public_gaokao_lead_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": mask_gaokao_name(row["name"]),
        "phone": mask_gaokao_phone(row["phone"]),
        "major": str(row["major"] or ""),
        "budget": str(row["budget"] or ""),
        "purchaseTime": str(row["purchase_time"] or ""),
        "interest": str(row["interest"] or ""),
        "status": str(row["status"] or "已提交需求"),
        "campaign": str(row["campaign"] or "gaokao2026"),
        "source": str(row["source"] or "mobile"),
        "createdAt": str(row["created_at"] or ""),
        "updatedAt": str(row["updated_at"] or ""),
    }


def format_gaokao_coupon_code(sequence: int) -> str:
    return f"LNV-GK-{sequence:03d}"


def format_gaokao_service_code(sequence: int, phone_hash: str) -> str:
    digest = hashlib.sha256(f"gaokao2026:{sequence}:{phone_hash}".encode("utf-8")).hexdigest()
    value = (int(digest[:10], 16) % 900000) + 100000
    return str(value)


def build_unique_gaokao_service_code(
    conn: sqlite3.Connection,
    sequence: int,
    phone_hash: str,
    *,
    exclude_coupon_id: str = "",
) -> str:
    attempt = 0
    while attempt < 50:
        seed_hash = phone_hash if attempt == 0 else f"{phone_hash}:{attempt}"
        service_code = format_gaokao_service_code(sequence, seed_hash)
        existing = conn.execute(
            "SELECT id FROM gaokao_2026_coupon WHERE service_code = ?",
            (service_code,),
        ).fetchone()
        if not existing or str(existing["id"]) == exclude_coupon_id:
            return service_code
        attempt += 1
    raise HTTPException(status_code=409, detail="服务码生成失败，请稍后重试")


def public_gaokao_coupon_from_row(row: sqlite3.Row, config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or load_gaokao_coupon_config()
    service_code = str(row["service_code"] or "") if "service_code" in row.keys() else ""
    return {
        "id": str(row["id"]),
        "code": str(row["code"]),
        "serviceCode": service_code,
        "status": str(row["status"] or "issued"),
        "validFrom": str(row["valid_from"] or config["validFrom"]),
        "validTo": str(row["valid_to"] or config["validTo"]),
        "offerTitle": str(config["offerTitle"]),
        "offerValue": str(config["offerValue"]),
        "offerSecondary": str(config["offerSecondary"]),
        "offerText": str(config["offerText"]),
        "redeemText": str(config["redeemText"]),
        "storeName": str(config["storeName"]),
        "storePhone": str(config["storePhone"]),
        "issuedAt": str(row["issued_at"] or ""),
        "redeemedAt": str(row["redeemed_at"] or ""),
        "redeemedBy": str(row["redeemed_by"] or ""),
        "redeemDeviceId": str(row["redeem_device_id"] or ""),
        "verifyRule": "手机后六位 + 领取校验码",
    }


def _ensure_gaokao_2026_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS gaokao_2026_lead (
          id TEXT PRIMARY KEY,
          campaign TEXT NOT NULL DEFAULT 'gaokao2026',
          source TEXT NOT NULL DEFAULT 'mobile',
          action TEXT NOT NULL DEFAULT 'lead',
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          phone_hash TEXT NOT NULL,
          major TEXT NOT NULL DEFAULT '',
          budget TEXT NOT NULL DEFAULT '',
          purchase_time TEXT NOT NULL DEFAULT '',
          interest TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '已提交需求',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_gaokao_2026_lead_phone_hash ON gaokao_2026_lead(phone_hash)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_gaokao_2026_lead_created_at ON gaokao_2026_lead(created_at DESC)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS gaokao_2026_coupon (
          id TEXT PRIMARY KEY,
          lead_id TEXT NOT NULL,
          phone_hash TEXT NOT NULL,
          sequence_number INTEGER NOT NULL,
          code TEXT NOT NULL,
          service_code TEXT NOT NULL DEFAULT '',
          campaign TEXT NOT NULL DEFAULT 'gaokao2026',
          source TEXT NOT NULL DEFAULT 'mobile',
          status TEXT NOT NULL DEFAULT 'issued',
          valid_from TEXT NOT NULL,
          valid_to TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          redeemed_at TEXT NOT NULL DEFAULT '',
          redeemed_by TEXT NOT NULL DEFAULT '',
          redeem_device_id TEXT NOT NULL DEFAULT '',
          redeem_note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_gaokao_2026_coupon_phone_hash ON gaokao_2026_coupon(phone_hash)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_gaokao_2026_coupon_sequence ON gaokao_2026_coupon(sequence_number)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_gaokao_2026_coupon_code ON gaokao_2026_coupon(code)"
    )
    columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(gaokao_2026_coupon)").fetchall()}
    if "service_code" not in columns:
        conn.execute("ALTER TABLE gaokao_2026_coupon ADD COLUMN service_code TEXT NOT NULL DEFAULT ''")
    rows_missing_service_code = conn.execute(
        "SELECT id, sequence_number, phone_hash FROM gaokao_2026_coupon WHERE service_code = ''"
    ).fetchall()
    for coupon_row in rows_missing_service_code:
        service_code = build_unique_gaokao_service_code(
            conn,
            int(coupon_row["sequence_number"] or 0),
            str(coupon_row["phone_hash"] or ""),
            exclude_coupon_id=str(coupon_row["id"]),
        )
        conn.execute(
            "UPDATE gaokao_2026_coupon SET service_code = ? WHERE id = ?",
            (service_code, str(coupon_row["id"])),
        )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_gaokao_2026_coupon_service_code ON gaokao_2026_coupon(service_code)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS gaokao_2026_coupon_config (
          campaign TEXT PRIMARY KEY,
          start_sequence INTEGER NOT NULL,
          total_count INTEGER NOT NULL,
          valid_from TEXT NOT NULL,
          valid_to TEXT NOT NULL,
          offer_title TEXT NOT NULL DEFAULT '',
          offer_value TEXT NOT NULL DEFAULT '',
          offer_secondary TEXT NOT NULL DEFAULT '',
          offer_text TEXT NOT NULL DEFAULT '',
          redeem_text TEXT NOT NULL DEFAULT '',
          store_name TEXT NOT NULL DEFAULT '',
          store_phone TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        """
    )
    config_columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(gaokao_2026_coupon_config)").fetchall()}
    if "last_issued_sequence" not in config_columns:
        conn.execute(
            "ALTER TABLE gaokao_2026_coupon_config ADD COLUMN last_issued_sequence INTEGER NOT NULL DEFAULT 0"
        )
    defaults = default_gaokao_coupon_config()
    conn.execute(
        """
        INSERT INTO gaokao_2026_coupon_config (
          campaign, start_sequence, total_count, valid_from, valid_to,
          offer_title, offer_value, offer_secondary, offer_text, redeem_text,
          store_name, store_phone, updated_at, last_issued_sequence
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign) DO NOTHING
        """,
        (
            str(defaults["campaign"]),
            int(defaults["startSequence"]),
            int(defaults["totalCount"]),
            str(defaults["validFrom"]),
            str(defaults["validTo"]),
            str(defaults["offerTitle"]),
            str(defaults["offerValue"]),
            str(defaults["offerSecondary"]),
            str(defaults["offerText"]),
            str(defaults["redeemText"]),
            str(defaults["storeName"]),
            str(defaults["storePhone"]),
            now_iso(),
            0,
        ),
    )
    max_sequence_row = conn.execute(
        "SELECT MAX(sequence_number) AS value FROM gaokao_2026_coupon"
    ).fetchone()
    max_sequence = int(max_sequence_row["value"] or 0) if max_sequence_row else 0
    if max_sequence > 0:
        conn.execute(
            """
            UPDATE gaokao_2026_coupon_config
            SET last_issued_sequence = CASE
              WHEN COALESCE(last_issued_sequence, 0) < ? THEN ?
              ELSE last_issued_sequence
            END
            WHERE campaign = 'gaokao2026'
            """,
            (max_sequence, max_sequence),
        )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS gaokao_2026_customer_ops (
          lead_id TEXT PRIMARY KEY,
          follow_up_stage TEXT NOT NULL DEFAULT 'new_lead',
          intent_level TEXT NOT NULL DEFAULT 'A',
          assigned_to TEXT NOT NULL DEFAULT '',
          next_follow_up_at TEXT NOT NULL DEFAULT '',
          visit_status TEXT NOT NULL DEFAULT 'not_arrived',
          conversion_status TEXT NOT NULL DEFAULT 'active',
          sold_product_model TEXT NOT NULL DEFAULT '',
          converted_at TEXT NOT NULL DEFAULT '',
          lost_reason TEXT NOT NULL DEFAULT '',
          preferred_categories_json TEXT NOT NULL DEFAULT '[]',
          tags_json TEXT NOT NULL DEFAULT '[]',
          latest_note TEXT NOT NULL DEFAULT '',
          last_follow_up_at TEXT NOT NULL DEFAULT '',
          last_follow_up_result TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_gaokao_2026_customer_ops_next_follow_up ON gaokao_2026_customer_ops(next_follow_up_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_gaokao_2026_customer_ops_assigned_to ON gaokao_2026_customer_ops(assigned_to, conversion_status)"
    )
    for ddl in (
        "ALTER TABLE gaokao_2026_customer_ops ADD COLUMN sold_product_model TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE gaokao_2026_customer_ops ADD COLUMN converted_at TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE gaokao_2026_customer_ops ADD COLUMN lost_reason TEXT NOT NULL DEFAULT ''",
    ):
        try:
            conn.execute(ddl)
        except sqlite3.OperationalError:
            pass
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS gaokao_2026_follow_up_log (
          id TEXT PRIMARY KEY,
          lead_id TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          log_type TEXT NOT NULL DEFAULT 'follow_up',
          content TEXT NOT NULL DEFAULT '',
          result_status TEXT NOT NULL DEFAULT '',
          scheduled_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_gaokao_2026_follow_up_log_lead_id ON gaokao_2026_follow_up_log(lead_id, created_at DESC)"
    )


def init_gaokao_2026_lead_table(conn: sqlite3.Connection | None = None) -> None:
    global GAOKAO_2026_TABLES_READY
    if GAOKAO_2026_TABLES_READY:
        return
    with GAOKAO_2026_TABLES_LOCK:
        if GAOKAO_2026_TABLES_READY:
            return
        if conn is not None:
            _ensure_gaokao_2026_schema(conn)
        else:
            with retail_core.connect() as bootstrap_conn:
                _ensure_gaokao_2026_schema(bootstrap_conn)
        GAOKAO_2026_TABLES_READY = True

def load_gaokao_coupon_config(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    init_gaokao_2026_lead_table(conn=conn)
    defaults = default_gaokao_coupon_config()
    if conn is not None:
        row = conn.execute(
            "SELECT * FROM gaokao_2026_coupon_config WHERE campaign = 'gaokao2026' LIMIT 1"
        ).fetchone()
    else:
        with retail_core.connect() as config_conn:
            row = config_conn.execute(
                "SELECT * FROM gaokao_2026_coupon_config WHERE campaign = 'gaokao2026' LIMIT 1"
            ).fetchone()
    if not row:
        return defaults
    return {
        "campaign": "gaokao2026",
        "startSequence": int(row["start_sequence"] or defaults["startSequence"]),
        "totalCount": int(row["total_count"] or defaults["totalCount"]),
        "validFrom": str(row["valid_from"] or defaults["validFrom"]),
        "validTo": str(row["valid_to"] or defaults["validTo"]),
        "offerTitle": str(row["offer_title"] or defaults["offerTitle"]),
        "offerValue": str(row["offer_value"] or defaults["offerValue"]),
        "offerSecondary": str(row["offer_secondary"] or defaults["offerSecondary"]),
        "offerText": str(row["offer_text"] or defaults["offerText"]),
        "redeemText": str(row["redeem_text"] or defaults["redeemText"]),
        "storeName": str(row["store_name"] or defaults["storeName"]),
        "storePhone": str(row["store_phone"] or defaults["storePhone"]),
        "updatedAt": str(row["updated_at"] or ""),
        "lastIssuedSequence": int(row["last_issued_sequence"] or 0),
    }


@contextmanager
def gaokao_write_slot(timeout_seconds: float = 12.0):
    acquired = GAOKAO_2026_WRITE_SEMAPHORE.acquire(timeout=timeout_seconds)
    if not acquired:
        raise HTTPException(status_code=503, detail="高考活动访问繁忙，请稍后重试")
    try:
        yield
    finally:
        GAOKAO_2026_WRITE_SEMAPHORE.release()


def update_gaokao_coupon_config(payload: Gaokao2026CouponConfigUpdateInput) -> dict[str, Any]:
    init_gaokao_2026_lead_table()
    now = now_iso()
    valid_from = normalize_gaokao_date(payload.validFrom, GAOKAO_2026_COUPON_VALID_FROM)
    valid_to = normalize_gaokao_date(payload.validTo, GAOKAO_2026_COUPON_VALID_TO)
    if valid_from > valid_to:
        raise HTTPException(status_code=400, detail="优惠券开始日期不能晚于结束日期")
    with retail_core.connect() as conn:
        issued_count = int(conn.execute("SELECT COUNT(*) AS value FROM gaokao_2026_coupon").fetchone()["value"] or 0)
        if int(payload.totalCount) < issued_count:
            raise HTTPException(status_code=400, detail=f"当前已发出 {issued_count} 张电子券，总量不能小于已发放数量")
        conn.execute(
            """
            UPDATE gaokao_2026_coupon_config
            SET total_count = ?, valid_from = ?, valid_to = ?, offer_title = ?, offer_value = ?,
                offer_secondary = ?, offer_text = ?, redeem_text = ?, store_name = ?, store_phone = ?, updated_at = ?
            WHERE campaign = 'gaokao2026'
            """,
            (
                int(payload.totalCount),
                valid_from,
                valid_to,
                normalize_gaokao_text(payload.offerTitle, 80) or "高考生电子优惠券",
                normalize_gaokao_text(payload.offerValue, 20) or "699",
                normalize_gaokao_text(payload.offerSecondary, 80) or "三人同行升 899",
                normalize_gaokao_text(payload.offerText, 300) or default_gaokao_coupon_config()["offerText"],
                normalize_gaokao_text(payload.redeemText, 200) or default_gaokao_coupon_config()["redeemText"],
                normalize_gaokao_text(payload.storeName, 80) or default_gaokao_coupon_config()["storeName"],
                normalize_gaokao_text(payload.storePhone, 30) or default_gaokao_coupon_config()["storePhone"],
                now,
            ),
        )
        conn.execute(
            """
            UPDATE gaokao_2026_coupon
            SET valid_from = ?, valid_to = ?, updated_at = ?
            WHERE campaign = 'gaokao2026' AND status != 'redeemed'
            """,
            (valid_from, valid_to, now),
        )
    config = load_gaokao_coupon_config()
    config["updatedAt"] = now
    return {"ok": True, "config": config, "updatedAt": now}


def _normalize_gaokao_tag_list(values: list[Any], limit: int = 8) -> list[str]:
    items: list[str] = []
    for value in values or []:
        normalized = normalize_gaokao_text(value, 40)
        if normalized and normalized not in items:
            items.append(normalized)
        if len(items) >= limit:
            break
    return items


def _ensure_gaokao_customer_ops_row(conn: sqlite3.Connection, lead_id: str) -> sqlite3.Row:
    existing = conn.execute("SELECT * FROM gaokao_2026_customer_ops WHERE lead_id = ?", (lead_id,)).fetchone()
    if existing:
        return existing
    now = now_iso()
    conn.execute(
        """
        INSERT INTO gaokao_2026_customer_ops (
          lead_id, follow_up_stage, intent_level, assigned_to, next_follow_up_at, visit_status,
          conversion_status, sold_product_model, converted_at, lost_reason, preferred_categories_json,
          tags_json, latest_note, last_follow_up_at, last_follow_up_result, created_at, updated_at
        )
        VALUES (?, 'new_lead', 'A', '', '', 'not_arrived', 'active', '', '', '', '[]', '[]', '', '', '', ?, ?)
        """,
        (lead_id, now, now),
    )
    return conn.execute("SELECT * FROM gaokao_2026_customer_ops WHERE lead_id = ?", (lead_id,)).fetchone()


def _gaokao_customer_ops_from_row(row: sqlite3.Row | None) -> dict[str, Any]:
    if not row:
        return {
            "followUpStage": "new_lead",
            "intentLevel": "A",
            "assignedTo": "",
            "nextFollowUpAt": "",
            "visitStatus": "not_arrived",
            "conversionStatus": "active",
            "soldProductModel": "",
            "convertedAt": "",
            "lostReason": "",
            "preferredCategories": [],
            "tags": [],
            "latestNote": "",
            "lastFollowUpAt": "",
            "lastFollowUpResult": "",
            "createdAt": "",
            "updatedAt": "",
        }
    return {
        "followUpStage": str(row["follow_up_stage"] or "new_lead"),
        "intentLevel": str(row["intent_level"] or "A"),
        "assignedTo": str(row["assigned_to"] or ""),
        "nextFollowUpAt": str(row["next_follow_up_at"] or ""),
        "visitStatus": str(row["visit_status"] or "not_arrived"),
        "conversionStatus": str(row["conversion_status"] or "active"),
        "soldProductModel": str(row["sold_product_model"] or ""),
        "convertedAt": str(row["converted_at"] or ""),
        "lostReason": str(row["lost_reason"] or ""),
        "preferredCategories": _normalize_gaokao_tag_list(json.loads(str(row["preferred_categories_json"] or "[]") or "[]")),
        "tags": _normalize_gaokao_tag_list(json.loads(str(row["tags_json"] or "[]") or "[]")),
        "latestNote": str(row["latest_note"] or ""),
        "lastFollowUpAt": str(row["last_follow_up_at"] or ""),
        "lastFollowUpResult": str(row["last_follow_up_result"] or ""),
        "createdAt": str(row["ops_created_at"] if "ops_created_at" in row.keys() else row["created_at"] or ""),
        "updatedAt": str(row["ops_updated_at"] if "ops_updated_at" in row.keys() else row["updated_at"] or ""),
    }


def save_gaokao_2026_lead(
    payload: Gaokao2026LeadSubmitInput,
    *,
    conn: sqlite3.Connection | None = None,
) -> sqlite3.Row:
    phone = normalize_mainland_phone(payload.phone)
    if not re.fullmatch(r"1[3-9]\d{9}", phone):
        raise HTTPException(status_code=400, detail="手机号格式不正确")

    name = normalize_gaokao_text(payload.name, 40)
    if not name:
        raise HTTPException(status_code=400, detail="姓名不能为空")

    now = now_iso()
    lead_id = f"gaokao-2026-{uuid.uuid4().hex[:12]}"
    phone_hash = hashlib.sha256(phone.encode("utf-8")).hexdigest()
    source = normalize_gaokao_text(payload.source or "mobile", 40) or "mobile"
    action = normalize_gaokao_text(payload.action or "lead", 40) or "lead"
    status = "电子券已领取" if action == "e_coupon_claim" else ("优惠券扫码提交" if source == "coupon" else "已提交需求")
    init_gaokao_2026_lead_table(conn=conn)

    def _save(active_conn: sqlite3.Connection) -> sqlite3.Row:
        existing = active_conn.execute(
            "SELECT id, created_at FROM gaokao_2026_lead WHERE phone_hash = ?",
            (phone_hash,),
        ).fetchone()
        if existing:
            lead_id_local = str(existing["id"])
            created_at = str(existing["created_at"] or now)
        else:
            lead_id_local = lead_id
            created_at = now
        active_conn.execute(
            """
            INSERT INTO gaokao_2026_lead (
              id, campaign, source, action, name, phone, phone_hash, major, budget,
              purchase_time, interest, message, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(phone_hash) DO UPDATE SET
              campaign = excluded.campaign,
              source = excluded.source,
              action = excluded.action,
              name = excluded.name,
              phone = excluded.phone,
              major = excluded.major,
              budget = excluded.budget,
              purchase_time = excluded.purchase_time,
              interest = excluded.interest,
              message = excluded.message,
              status = excluded.status,
              updated_at = excluded.updated_at
            """,
            (
                lead_id_local,
                normalize_gaokao_text(payload.campaign or "gaokao2026", 40) or "gaokao2026",
                source,
                action,
                name,
                phone,
                phone_hash,
                normalize_gaokao_text(payload.major, 80),
                normalize_gaokao_text(payload.budget, 40),
                normalize_gaokao_text(payload.purchaseTime, 40),
                normalize_gaokao_text(payload.interest, 80),
                normalize_gaokao_text(payload.message, 500),
                status,
                created_at,
                now,
            ),
        )
        row = active_conn.execute("SELECT * FROM gaokao_2026_lead WHERE id = ?", (lead_id_local,)).fetchone()
        assert row is not None
        return row

    if conn is not None:
        return _save(conn)
    with retail_core.connect() as fresh_conn:
        return _save(fresh_conn)


def issue_gaokao_2026_coupon(
    lead_row: sqlite3.Row,
    *,
    conn: sqlite3.Connection | None = None,
    config: dict[str, Any] | None = None,
) -> sqlite3.Row:
    init_gaokao_2026_lead_table(conn=conn)
    now = now_iso()
    phone_hash = str(lead_row["phone_hash"])
    lead_id = str(lead_row["id"])
    last_error: Exception | None = None

    def _issue(active_conn: sqlite3.Connection) -> sqlite3.Row:
        config_local = config or load_gaokao_coupon_config(conn=active_conn)
        start_sequence = int(config_local["startSequence"])
        end_sequence = start_sequence + int(config_local["totalCount"]) - 1
        existing = active_conn.execute(
            "SELECT * FROM gaokao_2026_coupon WHERE phone_hash = ?",
            (phone_hash,),
        ).fetchone()
        if existing:
            return existing
        last_issued_sequence = int(config_local.get("lastIssuedSequence") or 0)
        if last_issued_sequence < start_sequence - 1:
            max_row = active_conn.execute(
                "SELECT MAX(sequence_number) AS value FROM gaokao_2026_coupon"
            ).fetchone()
            last_issued_sequence = max(start_sequence - 1, int(max_row["value"] or 0) if max_row else 0)
        next_sequence = last_issued_sequence + 1
        if next_sequence > end_sequence:
            raise HTTPException(status_code=409, detail="电子优惠券已发完")
        coupon_id = f"gaokao-coupon-{uuid.uuid4().hex[:12]}"
        code = format_gaokao_coupon_code(next_sequence)
        service_code = build_unique_gaokao_service_code(active_conn, next_sequence, phone_hash)
        active_conn.execute(
            """
            INSERT INTO gaokao_2026_coupon (
              id, lead_id, phone_hash, sequence_number, code, service_code, campaign, source, status,
              valid_from, valid_to, issued_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                coupon_id,
                lead_id,
                phone_hash,
                next_sequence,
                code,
                service_code,
                str(lead_row["campaign"] or "gaokao2026"),
                str(lead_row["source"] or "mobile"),
                "issued",
                str(config_local["validFrom"]),
                str(config_local["validTo"]),
                now,
                now,
                now,
            ),
        )
        active_conn.execute(
            """
            UPDATE gaokao_2026_coupon_config
            SET last_issued_sequence = CASE
              WHEN COALESCE(last_issued_sequence, 0) < ? THEN ?
              ELSE last_issued_sequence
            END
            WHERE campaign = 'gaokao2026'
            """,
            (next_sequence, next_sequence),
        )
        row = active_conn.execute("SELECT * FROM gaokao_2026_coupon WHERE id = ?", (coupon_id,)).fetchone()
        if row:
            return row
        raise HTTPException(status_code=500, detail="电子优惠券发放失败")

    if conn is not None:
        return _issue(conn)

    for _attempt in range(3):
        try:
            with retail_core.connect() as fresh_conn:
                return _issue(fresh_conn)
        except sqlite3.IntegrityError as error:
            last_error = error
            time.sleep(0.03)
            continue
        except sqlite3.OperationalError as error:
            last_error = error
            if "database is locked" in str(error).lower():
                time.sleep(0.05)
                continue
            raise
    if last_error is not None:
        raise HTTPException(status_code=503, detail="电子优惠券发放繁忙，请稍后再试") from last_error
    raise HTTPException(status_code=500, detail="电子优惠券发放失败")


def list_gaokao_2026_customer_profiles(
    limit: int = 80,
    query: str = "",
    status: str = "",
    assigned_to: str = "",
    tag: str = "",
    due_today: bool = False,
) -> list[dict[str, Any]]:
    init_gaokao_2026_portal_tables()
    safe_limit = max(1, min(int(limit or 80), 300))
    normalized_query = normalize_gaokao_text(query, 80)
    normalized_status = normalize_gaokao_text(status, 20).lower()
    normalized_assigned_to = normalize_gaokao_text(assigned_to, 40)
    normalized_tag = normalize_gaokao_text(tag, 40)
    today = datetime.now().strftime("%Y-%m-%d")
    sql = """
        SELECT
          l.*,
          c.code AS coupon_code,
          c.service_code,
          c.status AS coupon_status,
          c.issued_at,
          c.redeemed_at,
          c.valid_to,
          (
            SELECT COUNT(*) FROM gaokao_2026_portal_message m
            WHERE m.phone_hash = l.phone_hash
          ) AS message_count,
          (
            SELECT COUNT(*) FROM gaokao_2026_portal_message m
            WHERE m.phone_hash = l.phone_hash
              AND m.channel IN ('wish', 'consultation')
          ) AS consult_count,
          (
            SELECT COUNT(*) FROM gaokao_2026_portal_message m
            WHERE m.phone_hash = l.phone_hash
              AND m.channel = 'ai_chat'
          ) AS ai_chat_count,
          (
            SELECT MAX(m.updated_at) FROM gaokao_2026_portal_message m
            WHERE m.phone_hash = l.phone_hash
          ) AS last_interaction_at,
          (
            SELECT m.status FROM gaokao_2026_portal_message m
            WHERE m.phone_hash = l.phone_hash
            ORDER BY m.updated_at DESC
            LIMIT 1
          ) AS latest_message_status,
          ops.follow_up_stage,
          ops.intent_level,
          ops.assigned_to,
          ops.next_follow_up_at,
          ops.visit_status,
          ops.conversion_status,
          ops.sold_product_model,
          ops.converted_at,
          ops.lost_reason,
          ops.tags_json
        FROM gaokao_2026_lead l
        LEFT JOIN gaokao_2026_coupon c ON c.lead_id = l.id
        LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
    """
    conditions: list[str] = []
    params: list[Any] = []
    if normalized_query:
        like = f"%{normalized_query}%"
        conditions.append("(l.name LIKE ? OR l.phone LIKE ? OR l.major LIKE ? OR l.interest LIKE ? OR l.message LIKE ? OR c.code LIKE ? OR c.service_code LIKE ?)")
        params.extend([like, like, like, like, like, like, like])
    if normalized_status == "with_coupon":
        conditions.append("c.id IS NOT NULL")
    elif normalized_status == "without_coupon":
        conditions.append("c.id IS NULL")
    elif normalized_status == "redeemed":
        conditions.append("c.status = 'redeemed'")
    elif normalized_status == "pending_reply":
        conditions.append("EXISTS (SELECT 1 FROM gaokao_2026_portal_message m WHERE m.phone_hash = l.phone_hash AND m.status IN ('pending', 'processing'))")
    if normalized_assigned_to:
        conditions.append("ops.assigned_to LIKE ?")
        params.append(f"%{normalized_assigned_to}%")
    if normalized_tag:
        conditions.append("ops.tags_json LIKE ?")
        params.append(f"%{normalized_tag}%")
    if due_today:
        conditions.append("COALESCE(ops.next_follow_up_at, '') != '' AND substr(ops.next_follow_up_at, 1, 10) <= ? AND COALESCE(ops.conversion_status, 'active') NOT IN ('converted', 'lost', 'invalid')")
        params.append(today)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY l.updated_at DESC LIMIT ?"
    params.append(safe_limit)
    with retail_core.connect() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        customer_status = str(row["status"] or "已提交需求")
        if str(row["coupon_status"] or "") == "redeemed":
            customer_status = "电子券已核销"
        elif str(row["coupon_code"] or ""):
            customer_status = "电子券已领取"
        latest_message_status = str(row["latest_message_status"] or "")
        items.append(
            {
                "id": str(row["id"]),
                "name": str(row["name"] or ""),
                "phone": normalize_mainland_phone(row["phone"]),
                "rawPhoneTail": normalize_mainland_phone(row["phone"])[-4:],
                "major": str(row["major"] or ""),
                "budget": str(row["budget"] or ""),
                "purchaseTime": str(row["purchase_time"] or ""),
                "interest": str(row["interest"] or ""),
                "message": str(row["message"] or ""),
                "source": str(row["source"] or ""),
                "action": str(row["action"] or ""),
                "status": customer_status,
                "coupon": {
                    "code": str(row["coupon_code"] or ""),
                    "serviceCode": str(row["service_code"] or ""),
                    "status": str(row["coupon_status"] or ""),
                    "issuedAt": str(row["issued_at"] or ""),
                    "redeemedAt": str(row["redeemed_at"] or ""),
                    "validTo": str(row["valid_to"] or ""),
                },
                "interaction": {
                    "messageCount": int(row["message_count"] or 0),
                    "consultCount": int(row["consult_count"] or 0),
                    "aiChatCount": int(row["ai_chat_count"] or 0),
                    "latestStatus": latest_message_status,
                    "lastInteractionAt": str(row["last_interaction_at"] or ""),
                },
                "ops": {
                    "followUpStage": str(row["follow_up_stage"] or "new_lead"),
                    "intentLevel": str(row["intent_level"] or "A"),
                    "assignedTo": str(row["assigned_to"] or ""),
                    "nextFollowUpAt": str(row["next_follow_up_at"] or ""),
                    "visitStatus": str(row["visit_status"] or "not_arrived"),
                    "conversionStatus": str(row["conversion_status"] or "active"),
                    "soldProductModel": str(row["sold_product_model"] or ""),
                    "convertedAt": str(row["converted_at"] or ""),
                    "lostReason": str(row["lost_reason"] or ""),
                    "tags": _normalize_gaokao_tag_list(json.loads(str(row["tags_json"] or "[]") or "[]")),
                },
                "createdAt": str(row["created_at"] or ""),
                "updatedAt": str(row["updated_at"] or ""),
            }
        )
    return items


def get_gaokao_2026_customer_filter_counts(query: str = "", assigned_to: str = "", tag: str = "", due_today: bool = False) -> dict[str, int]:
    init_gaokao_2026_portal_tables()
    normalized_query = normalize_gaokao_text(query, 80)
    normalized_assigned_to = normalize_gaokao_text(assigned_to, 40)
    normalized_tag = normalize_gaokao_text(tag, 40)
    today = datetime.now().strftime("%Y-%m-%d")
    base_sql = """
        FROM gaokao_2026_lead l
        LEFT JOIN gaokao_2026_coupon c ON c.lead_id = l.id
        LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
    """
    conditions: list[str] = []
    params: list[Any] = []
    if normalized_query:
        like = f"%{normalized_query}%"
        conditions.append("(l.name LIKE ? OR l.phone LIKE ? OR l.major LIKE ? OR l.interest LIKE ? OR l.message LIKE ? OR c.code LIKE ? OR c.service_code LIKE ?)")
        params.extend([like, like, like, like, like, like, like])
    if normalized_assigned_to:
        conditions.append("ops.assigned_to LIKE ?")
        params.append(f"%{normalized_assigned_to}%")
    if normalized_tag:
        conditions.append("ops.tags_json LIKE ?")
        params.append(f"%{normalized_tag}%")
    if due_today:
        conditions.append("COALESCE(ops.next_follow_up_at, '') != '' AND substr(ops.next_follow_up_at, 1, 10) <= ? AND COALESCE(ops.conversion_status, 'active') NOT IN ('converted', 'lost', 'invalid')")
        params.append(today)
    where_sql = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    with retail_core.connect() as conn:
        total = int(conn.execute(f"SELECT COUNT(*) AS value {base_sql}{where_sql}", tuple(params)).fetchone()["value"] or 0)
        with_coupon = int(
            conn.execute(
                f"SELECT COUNT(*) AS value {base_sql}{where_sql}{' AND' if where_sql else ' WHERE'} c.id IS NOT NULL",
                tuple(params),
            ).fetchone()["value"]
            or 0
        )
        redeemed = int(
            conn.execute(
                f"SELECT COUNT(*) AS value {base_sql}{where_sql}{' AND' if where_sql else ' WHERE'} c.status = 'redeemed'",
                tuple(params),
            ).fetchone()["value"]
            or 0
        )
        pending_reply = int(
            conn.execute(
                f"""
                SELECT COUNT(*) AS value
                {base_sql}
                {where_sql}{' AND' if where_sql else ' WHERE'}
                EXISTS (
                  SELECT 1 FROM gaokao_2026_portal_message m
                  WHERE m.phone_hash = l.phone_hash AND m.status IN ('pending', 'processing')
                )
                """,
                tuple(params),
            ).fetchone()["value"]
            or 0
        )
        without_coupon = max(0, total - with_coupon)
    return {
        "all": total,
        "with_coupon": with_coupon,
        "redeemed": redeemed,
        "pending_reply": pending_reply,
        "without_coupon": without_coupon,
    }


def _gaokao_message_thread_title(item: dict[str, Any]) -> str:
    channel = normalize_gaokao_text(item.get("channel"), 40).lower()
    topic = normalize_gaokao_text(item.get("topic"), 80)
    wish_tag = normalize_gaokao_text(item.get("wishTag"), 40)
    if topic:
        return topic
    if wish_tag:
        return wish_tag
    if channel == "ai_chat":
        return "天禧AI助理对话"
    if channel in {"consultation", "consult"}:
        return "客户咨询"
    return "许愿互动"


def build_gaokao_customer_threads(timeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    ordered_keys: list[str] = []
    for item in timeline:
        channel = normalize_gaokao_text(item.get("channel"), 40).lower() or "wish"
        topic = normalize_gaokao_text(item.get("topic"), 80).lower()
        wish_tag = normalize_gaokao_text(item.get("wishTag"), 40).lower()
        thread_key = "|".join([channel, topic, wish_tag])
        if thread_key not in grouped:
            grouped[thread_key] = {
                "id": f"thread-{uuid.uuid5(uuid.NAMESPACE_URL, thread_key).hex[:12]}",
                "threadKey": thread_key,
                "title": _gaokao_message_thread_title(item),
                "channel": channel,
                "wishTag": normalize_gaokao_text(item.get("wishTag"), 40),
                "latestStatus": normalize_gaokao_text(item.get("status"), 40),
                "latestAt": normalize_gaokao_text(item.get("createdAt"), 80),
                "messageCount": 0,
                "repliedCount": 0,
                "items": [],
            }
            ordered_keys.append(thread_key)
        group = grouped[thread_key]
        group["items"].append(item)
        group["messageCount"] = int(group["messageCount"]) + 1
        if normalize_gaokao_text(item.get("replyMessage"), 2000) or str((item.get("replyPayload") or {}).get("replyImageUrl") or ""):
            group["repliedCount"] = int(group["repliedCount"]) + 1
        item_created_at = normalize_gaokao_text(item.get("createdAt"), 80)
        if item_created_at and item_created_at > str(group["latestAt"] or ""):
            group["latestAt"] = item_created_at
            group["latestStatus"] = normalize_gaokao_text(item.get("status"), 40)
    groups = [grouped[key] for key in ordered_keys]
    groups.sort(key=lambda item: str(item.get("latestAt") or ""), reverse=True)
    return groups


def get_gaokao_2026_customer_detail(customer_id: str) -> dict[str, Any]:
    init_gaokao_2026_portal_tables()
    normalized_customer_id = normalize_gaokao_text(customer_id, 80)
    if not normalized_customer_id:
        raise HTTPException(status_code=400, detail="客户ID不能为空")
    with retail_core.connect() as conn:
        lead_row = conn.execute(
            """
            SELECT
              l.*,
              c.id AS coupon_id,
              c.sequence_number,
              c.code AS coupon_code,
              c.service_code,
              c.status AS coupon_status,
              c.source AS coupon_source,
              c.valid_from,
              c.valid_to,
              c.issued_at,
              c.redeemed_at,
              c.redeemed_by,
              c.redeem_device_id,
              c.redeem_note,
              ops.follow_up_stage,
              ops.intent_level,
              ops.assigned_to,
              ops.next_follow_up_at,
              ops.visit_status,
              ops.conversion_status,
              ops.sold_product_model,
              ops.converted_at,
              ops.lost_reason,
              ops.preferred_categories_json,
              ops.tags_json,
              ops.latest_note,
              ops.last_follow_up_at,
              ops.last_follow_up_result,
              ops.created_at AS ops_created_at,
              ops.updated_at AS ops_updated_at
            FROM gaokao_2026_lead l
            LEFT JOIN gaokao_2026_coupon c ON c.lead_id = l.id
            LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
            WHERE l.id = ?
            LIMIT 1
            """,
            (normalized_customer_id,),
        ).fetchone()
        if not lead_row:
            raise HTTPException(status_code=404, detail="客户不存在")
        _ensure_gaokao_customer_ops_row(conn, normalized_customer_id)
        lead_row = conn.execute(
            """
            SELECT
              l.*,
              c.id AS coupon_id,
              c.sequence_number,
              c.code AS coupon_code,
              c.service_code,
              c.status AS coupon_status,
              c.source AS coupon_source,
              c.valid_from,
              c.valid_to,
              c.issued_at,
              c.redeemed_at,
              c.redeemed_by,
              c.redeem_device_id,
              c.redeem_note,
              ops.follow_up_stage,
              ops.intent_level,
              ops.assigned_to,
              ops.next_follow_up_at,
              ops.visit_status,
              ops.conversion_status,
              ops.sold_product_model,
              ops.converted_at,
              ops.lost_reason,
              ops.preferred_categories_json,
              ops.tags_json,
              ops.latest_note,
              ops.last_follow_up_at,
              ops.last_follow_up_result,
              ops.created_at AS ops_created_at,
              ops.updated_at AS ops_updated_at
            FROM gaokao_2026_lead l
            LEFT JOIN gaokao_2026_coupon c ON c.lead_id = l.id
            LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
            WHERE l.id = ?
            LIMIT 1
            """,
            (normalized_customer_id,),
        ).fetchone()
        phone_hash = str(lead_row["phone_hash"] or "")
        message_rows = conn.execute(
            """
            SELECT *
            FROM gaokao_2026_portal_message
            WHERE phone_hash = ?
            ORDER BY created_at DESC
            """,
            (phone_hash,),
        ).fetchall()
        follow_up_logs = conn.execute(
            """
            SELECT *
            FROM gaokao_2026_follow_up_log
            WHERE lead_id = ?
            ORDER BY created_at DESC
            """,
            (normalized_customer_id,),
        ).fetchall()
    customer_status = str(lead_row["status"] or "已提交需求")
    if str(lead_row["coupon_status"] or "") == "redeemed":
        customer_status = "电子券已核销"
    elif str(lead_row["coupon_code"] or ""):
        customer_status = "电子券已领取"
    timeline = [_admin_gaokao_portal_message(row) for row in message_rows]
    consult_count = sum(1 for item in timeline if str(item.get("channel") or "") in {"wish", "consultation", "consult"})
    ai_chat_count = sum(1 for item in timeline if str(item.get("channel") or "") == "ai_chat")
    pending_count = sum(1 for item in timeline if str(item.get("status") or "") in {"pending", "processing"})
    reply_image_count = sum(1 for item in timeline if str(((item.get("replyPayload") or {}).get("replyImageUrl")) or ""))
    latest_item = timeline[0] if timeline else {}
    grouped_threads = build_gaokao_customer_threads(timeline)
    ops = _gaokao_customer_ops_from_row(lead_row)
    return {
        "id": str(lead_row["id"]),
        "name": str(lead_row["name"] or ""),
        "phone": normalize_mainland_phone(lead_row["phone"]),
        "major": str(lead_row["major"] or ""),
        "budget": str(lead_row["budget"] or ""),
        "purchaseTime": str(lead_row["purchase_time"] or ""),
        "interest": str(lead_row["interest"] or ""),
        "message": str(lead_row["message"] or ""),
        "source": str(lead_row["source"] or ""),
        "action": str(lead_row["action"] or ""),
        "status": customer_status,
        "coupon": {
            "id": str(lead_row["coupon_id"] or ""),
            "sequenceNumber": int(lead_row["sequence_number"] or 0),
            "code": str(lead_row["coupon_code"] or ""),
            "serviceCode": str(lead_row["service_code"] or ""),
            "status": str(lead_row["coupon_status"] or ""),
            "source": str(lead_row["coupon_source"] or ""),
            "validFrom": str(lead_row["valid_from"] or ""),
            "validTo": str(lead_row["valid_to"] or ""),
            "issuedAt": str(lead_row["issued_at"] or ""),
            "redeemedAt": str(lead_row["redeemed_at"] or ""),
            "redeemedBy": str(lead_row["redeemed_by"] or ""),
            "redeemDeviceId": str(lead_row["redeem_device_id"] or ""),
            "redeemNote": str(lead_row["redeem_note"] or ""),
            "verifyRule": "手机后六位 + 领取校验码",
        },
        "interaction": {
            "messageCount": len(timeline),
            "consultCount": consult_count,
            "aiChatCount": ai_chat_count,
            "pendingCount": pending_count,
            "replyImageCount": reply_image_count,
            "threadCount": len(grouped_threads),
            "latestStatus": str(latest_item.get("status") or ""),
            "lastInteractionAt": str(latest_item.get("createdAt") or lead_row["updated_at"] or ""),
        },
        "ops": ops,
        "followUpLogs": [
            {
                "id": str(row["id"]),
                "actor": str(row["actor"] or ""),
                "logType": str(row["log_type"] or ""),
                "content": str(row["content"] or ""),
                "resultStatus": str(row["result_status"] or ""),
                "scheduledAt": str(row["scheduled_at"] or ""),
                "createdAt": str(row["created_at"] or ""),
            }
            for row in follow_up_logs
        ],
        "groupedThreads": grouped_threads,
        "timeline": timeline,
        "createdAt": str(lead_row["created_at"] or ""),
        "updatedAt": str(lead_row["updated_at"] or ""),
    }


def update_gaokao_2026_customer_ops(customer_id: str, payload: Gaokao2026CustomerOpsUpdateInput) -> dict[str, Any]:
    init_gaokao_2026_portal_tables()
    normalized_customer_id = normalize_gaokao_text(customer_id, 80)
    if not normalized_customer_id:
        raise HTTPException(status_code=400, detail="客户ID不能为空")
    now = now_iso()
    conversion_status = normalize_gaokao_text(payload.conversionStatus, 30) or "active"
    sold_product_model = normalize_gaokao_text(payload.soldProductModel, 120)
    converted_at = normalize_gaokao_text(payload.convertedAt, 40)
    lost_reason = normalize_gaokao_text(payload.lostReason, 200)
    if conversion_status == "converted" and not converted_at:
        converted_at = datetime.now().strftime("%Y-%m-%d")
    if conversion_status != "lost":
        lost_reason = ""
    with retail_core.connect() as conn:
        lead = conn.execute("SELECT id FROM gaokao_2026_lead WHERE id = ?", (normalized_customer_id,)).fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="客户不存在")
        _ensure_gaokao_customer_ops_row(conn, normalized_customer_id)
        conn.execute(
            """
            UPDATE gaokao_2026_customer_ops
            SET follow_up_stage = ?, intent_level = ?, assigned_to = ?, next_follow_up_at = ?,
                visit_status = ?, conversion_status = ?, sold_product_model = ?, converted_at = ?,
                lost_reason = ?, preferred_categories_json = ?, tags_json = ?, latest_note = ?, updated_at = ?
            WHERE lead_id = ?
            """,
            (
                normalize_gaokao_text(payload.followUpStage, 40) or "new_lead",
                normalize_gaokao_text(payload.intentLevel, 20) or "A",
                normalize_gaokao_text(payload.assignedTo, 40),
                normalize_gaokao_text(payload.nextFollowUpAt, 40),
                normalize_gaokao_text(payload.visitStatus, 30) or "not_arrived",
                conversion_status,
                sold_product_model,
                converted_at,
                lost_reason,
                json.dumps(_normalize_gaokao_tag_list(payload.preferredCategories), ensure_ascii=False),
                json.dumps(_normalize_gaokao_tag_list(payload.tags), ensure_ascii=False),
                normalize_gaokao_text(payload.latestNote, 500),
                now,
                normalized_customer_id,
            ),
        )
    return {"ok": True, "item": get_gaokao_2026_customer_detail(normalized_customer_id), "updatedAt": now}


def create_gaokao_2026_follow_up_log(customer_id: str, payload: Gaokao2026CustomerFollowUpLogInput) -> dict[str, Any]:
    init_gaokao_2026_portal_tables()
    normalized_customer_id = normalize_gaokao_text(customer_id, 80)
    if not normalized_customer_id:
        raise HTTPException(status_code=400, detail="客户ID不能为空")
    content = normalize_gaokao_text(payload.content, 1000)
    if not content:
        raise HTTPException(status_code=400, detail="回访内容不能为空")
    now = now_iso()
    log_id = f"gaokao-follow-up-{uuid.uuid4().hex[:12]}"
    with retail_core.connect() as conn:
        lead = conn.execute("SELECT id FROM gaokao_2026_lead WHERE id = ?", (normalized_customer_id,)).fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="客户不存在")
        _ensure_gaokao_customer_ops_row(conn, normalized_customer_id)
        conn.execute(
            """
            INSERT INTO gaokao_2026_follow_up_log (
              id, lead_id, actor, log_type, content, result_status, scheduled_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                log_id,
                normalized_customer_id,
                normalize_gaokao_text(payload.actor, 40) or "门店顾问",
                normalize_gaokao_text(payload.logType, 40) or "follow_up",
                content,
                normalize_gaokao_text(payload.resultStatus, 40),
                normalize_gaokao_text(payload.scheduledAt, 40),
                now,
            ),
        )
        conn.execute(
            """
            UPDATE gaokao_2026_customer_ops
            SET last_follow_up_at = ?, last_follow_up_result = ?, updated_at = ?
            WHERE lead_id = ?
            """,
            (
                now,
                normalize_gaokao_text(payload.resultStatus, 40),
                now,
                normalized_customer_id,
            ),
        )
    return {"ok": True, "item": get_gaokao_2026_customer_detail(normalized_customer_id), "updatedAt": now}


def _parse_gaokao_datetime(value: str) -> datetime | None:
    text = normalize_gaokao_text(value, 40)
    if not text:
        return None
    candidates = [
        text,
        text.replace("/", "-"),
        text.replace("T", " "),
    ]
    for candidate in candidates:
        try:
            normalized = candidate.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized)
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue
    return None


def _format_gaokao_datetime(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def quick_action_gaokao_2026_customer_ops(customer_id: str, payload: Gaokao2026CustomerQuickActionInput) -> dict[str, Any]:
    init_gaokao_2026_portal_tables()
    normalized_customer_id = normalize_gaokao_text(customer_id, 80)
    action = normalize_gaokao_text(payload.action, 40).lower()
    actor = normalize_gaokao_text(payload.actor, 40) or "高考活动顾问"
    note = normalize_gaokao_text(payload.note, 200)
    if action not in {"complete_follow_up", "postpone_follow_up", "mark_arrived"}:
        raise HTTPException(status_code=400, detail="不支持的快捷动作")
    now = now_iso()
    now_dt = datetime.now()
    with retail_core.connect() as conn:
        lead = conn.execute("SELECT id FROM gaokao_2026_lead WHERE id = ?", (normalized_customer_id,)).fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="客户不存在")
        ops_row = _ensure_gaokao_customer_ops_row(conn, normalized_customer_id)
        current_ops = _gaokao_customer_ops_from_row(ops_row)
        next_follow_up = str(current_ops.get("nextFollowUpAt") or "")
        follow_up_stage = str(current_ops.get("followUpStage") or "new_lead")
        visit_status = str(current_ops.get("visitStatus") or "not_arrived")
        conversion_status = str(current_ops.get("conversionStatus") or "active")
        last_follow_up_result = ""
        log_type = "follow_up"
        log_content = ""
        log_scheduled_at = ""
        if action == "complete_follow_up":
            if follow_up_stage == "new_lead":
                follow_up_stage = "contacted"
            if visit_status == "arrived_today":
                visit_status = "visited_left"
            next_follow_up = ""
            last_follow_up_result = "已完成回访"
            log_content = note or "已完成本轮回访，等待客户下一步反馈。"
        elif action == "postpone_follow_up":
            base_dt = _parse_gaokao_datetime(next_follow_up) or now_dt
            postponed = (base_dt + timedelta(days=1)).replace(hour=10, minute=30, second=0, microsecond=0)
            next_follow_up = _format_gaokao_datetime(postponed)
            last_follow_up_result = "已顺延跟进"
            log_scheduled_at = next_follow_up
            log_content = note or f"本轮未完成处理，已顺延至 {next_follow_up}。"
        elif action == "mark_arrived":
            follow_up_stage = "in_store"
            visit_status = "arrived_today"
            if conversion_status == "invalid":
                conversion_status = "active"
            last_follow_up_result = "客户已到店"
            log_type = "visit"
            log_content = note or "客户已到店，转入门店现场接待。"

        conn.execute(
            """
            UPDATE gaokao_2026_customer_ops
            SET follow_up_stage = ?, visit_status = ?, next_follow_up_at = ?, last_follow_up_at = ?,
                last_follow_up_result = ?, conversion_status = ?, assigned_to = ?, updated_at = ?
            WHERE lead_id = ?
            """,
            (
                follow_up_stage,
                visit_status,
                next_follow_up,
                now,
                last_follow_up_result,
                conversion_status,
                actor if not current_ops.get("assignedTo") else current_ops.get("assignedTo"),
                now,
                normalized_customer_id,
            ),
        )
        conn.execute(
            """
            INSERT INTO gaokao_2026_follow_up_log (
              id, lead_id, actor, log_type, content, result_status, scheduled_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"gaokao-follow-up-{uuid.uuid4().hex[:12]}",
                normalized_customer_id,
                actor,
                log_type,
                log_content,
                last_follow_up_result,
                log_scheduled_at,
                now,
            ),
        )
    return {"ok": True, "item": get_gaokao_2026_customer_detail(normalized_customer_id), "updatedAt": now}


def get_gaokao_2026_customer_ops_summary() -> dict[str, Any]:
    init_gaokao_2026_portal_tables()
    today = datetime.now().strftime("%Y-%m-%d")
    with retail_core.connect() as conn:
        total_active = int(
            conn.execute(
                """
                SELECT COUNT(*) AS value
                FROM gaokao_2026_lead l
                LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
                WHERE COALESCE(ops.conversion_status, 'active') NOT IN ('converted', 'lost', 'invalid')
                """
            ).fetchone()["value"]
            or 0
        )
        due_today = int(
            conn.execute(
                """
                SELECT COUNT(*) AS value
                FROM gaokao_2026_lead l
                LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
                WHERE COALESCE(ops.next_follow_up_at, '') != ''
                  AND substr(ops.next_follow_up_at, 1, 10) <= ?
                  AND COALESCE(ops.conversion_status, 'active') NOT IN ('converted', 'lost', 'invalid')
                """,
                (today,),
            ).fetchone()["value"]
            or 0
        )
        waiting_visit = int(
            conn.execute(
                """
                SELECT COUNT(*) AS value
                FROM gaokao_2026_lead l
                LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
                WHERE COALESCE(ops.visit_status, 'not_arrived') IN ('reserved', 'arrived_today', 'in_store')
                  AND COALESCE(ops.conversion_status, 'active') NOT IN ('converted', 'lost', 'invalid')
                """
            ).fetchone()["value"]
            or 0
        )
        converted = int(
            conn.execute(
                """
                SELECT COUNT(*) AS value
                FROM gaokao_2026_lead l
                LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
                WHERE COALESCE(ops.conversion_status, 'active') = 'converted'
                """
            ).fetchone()["value"]
            or 0
        )
        lost = int(
            conn.execute(
                """
                SELECT COUNT(*) AS value
                FROM gaokao_2026_lead l
                LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
                WHERE COALESCE(ops.conversion_status, 'active') IN ('lost', 'invalid')
                """
            ).fetchone()["value"]
            or 0
        )
    return {
        "activeCustomers": total_active,
        "dueToday": due_today,
        "waitingVisit": waiting_visit,
        "converted": converted,
        "lost": lost,
        "updatedAt": now_iso(),
    }


def list_gaokao_2026_admin_coupons(limit: int = 120, status: str = "", query: str = "") -> list[dict[str, Any]]:
    init_gaokao_2026_lead_table()
    safe_limit = max(1, min(int(limit or 120), 500))
    normalized_status = normalize_gaokao_text(status, 20).lower()
    normalized_query = normalize_gaokao_text(query, 80)
    sql = """
        SELECT c.*, l.name AS lead_name, l.phone AS lead_phone, l.major AS lead_major, l.budget AS lead_budget
        FROM gaokao_2026_coupon c
        LEFT JOIN gaokao_2026_lead l ON l.id = c.lead_id
    """
    conditions: list[str] = []
    params: list[Any] = []
    if normalized_status:
        conditions.append("c.status = ?")
        params.append(normalized_status)
    if normalized_query:
        like = f"%{normalized_query}%"
        conditions.append("(c.code LIKE ? OR c.service_code LIKE ? OR l.name LIKE ? OR l.phone LIKE ?)")
        params.extend([like, like, like, like])
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY c.sequence_number DESC LIMIT ?"
    params.append(safe_limit)
    with retail_core.connect() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [
        {
            **public_gaokao_coupon_from_row(row),
            "sequenceNumber": int(row["sequence_number"] or 0),
            "customerName": str(row["lead_name"] or ""),
            "customerPhone": normalize_mainland_phone(row["lead_phone"]),
            "major": str(row["lead_major"] or ""),
            "budget": str(row["lead_budget"] or ""),
        }
        for row in rows
    ]


def _csv_response(filename: str, rows: list[dict[str, Any]], fieldnames: list[str]) -> Response:
    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, "") for key in fieldnames})
    content = buffer.getvalue()
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=content, media_type="text/csv; charset=utf-8", headers=headers)


def normalize_gaokao_phone_last6(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) != 6:
        raise HTTPException(status_code=400, detail="请输入客户手机号后六位")
    return digits


def coupon_matches_phone_last6(conn: sqlite3.Connection, coupon: sqlite3.Row, phone_last6: str) -> bool:
    if not phone_last6:
        return True
    lead_row = conn.execute(
        "SELECT phone FROM gaokao_2026_lead WHERE id = ?",
        (str(coupon["lead_id"] or ""),),
    ).fetchone()
    if not lead_row:
        return False
    phone_digits = re.sub(r"\D", "", str(lead_row["phone"] or ""))
    return phone_digits.endswith(phone_last6)


def find_gaokao_2026_coupon(code: str, phone_last6: str = "") -> sqlite3.Row | None:
    normalized = normalize_gaokao_text(code, 40).upper()
    digits = re.sub(r"\D", "", normalized)
    normalized_phone_last6 = normalize_gaokao_phone_last6(phone_last6) if str(phone_last6 or "").strip() else ""
    init_gaokao_2026_lead_table()
    with retail_core.connect() as conn:
        row = None
        if re.fullmatch(r"\d{6}", digits):
            row = conn.execute("SELECT * FROM gaokao_2026_coupon WHERE service_code = ?", (digits,)).fetchone()
        if not row:
            row = conn.execute("SELECT * FROM gaokao_2026_coupon WHERE code = ?", (normalized,)).fetchone()
        if row and coupon_matches_phone_last6(conn, row, normalized_phone_last6):
            return row
        return None


def list_gaokao_2026_leads(limit: int = 20) -> list[dict[str, Any]]:
    init_gaokao_2026_lead_table()
    safe_limit = max(1, min(int(limit or 20), 100))
    with retail_core.connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM gaokao_2026_lead
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    return [public_gaokao_lead_from_row(row) for row in rows]


def init_gaokao_2026_portal_tables() -> None:
    init_gaokao_2026_lead_table()
    GAOKAO_2026_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with retail_core.connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS gaokao_2026_portal_session (
              id TEXT PRIMARY KEY,
              phone_hash TEXT NOT NULL,
              session_token TEXT NOT NULL,
              display_name TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_login_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_gaokao_2026_portal_session_token ON gaokao_2026_portal_session(session_token)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_gaokao_2026_portal_session_phone_hash ON gaokao_2026_portal_session(phone_hash)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS gaokao_2026_portal_message (
              id TEXT PRIMARY KEY,
              phone_hash TEXT NOT NULL,
              phone TEXT NOT NULL,
              display_name TEXT NOT NULL DEFAULT '',
              channel TEXT NOT NULL DEFAULT 'wish',
              topic TEXT NOT NULL DEFAULT '',
              wish_tag TEXT NOT NULL DEFAULT '',
              message TEXT NOT NULL DEFAULT '',
              image_path TEXT NOT NULL DEFAULT '',
              image_name TEXT NOT NULL DEFAULT '',
              image_mime_type TEXT NOT NULL DEFAULT '',
              metadata_json TEXT NOT NULL DEFAULT '{}',
              reply_message TEXT NOT NULL DEFAULT '',
              reply_payload_json TEXT NOT NULL DEFAULT '{}',
              status TEXT NOT NULL DEFAULT 'pending',
              reply_by TEXT NOT NULL DEFAULT '',
              replied_at TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_gaokao_2026_portal_message_phone_hash ON gaokao_2026_portal_message(phone_hash, created_at DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_gaokao_2026_portal_message_channel ON gaokao_2026_portal_message(channel, created_at DESC)"
        )


def _gaokao_phone_hash(phone: str) -> str:
    return hashlib.sha256(phone.encode("utf-8")).hexdigest()


def _parse_iso_timestamp(value: str) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _assert_gaokao_portal_session(phone: str, token: str) -> tuple[str, sqlite3.Row]:
    normalized_phone = normalize_mainland_phone(phone)
    if not re.fullmatch(r"1[3-9]\d{9}", normalized_phone):
        raise HTTPException(status_code=400, detail="手机号格式不正确")
    init_gaokao_2026_portal_tables()
    phone_hash = _gaokao_phone_hash(normalized_phone)
    with retail_core.connect() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM gaokao_2026_portal_session
            WHERE phone_hash = ? AND session_token = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (phone_hash, normalize_gaokao_text(token, 80)),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="登录状态已失效，请重新输入手机号登录")
    if _parse_iso_timestamp(str(row["expires_at"] or "")) < time.time():
        raise HTTPException(status_code=401, detail="登录状态已过期，请重新输入手机号登录")
    return normalized_phone, row


def create_gaokao_portal_session(payload: Gaokao2026PortalLoginInput) -> dict[str, Any]:
    normalized_phone = normalize_mainland_phone(payload.phone)
    if not re.fullmatch(r"1[3-9]\d{9}", normalized_phone):
        raise HTTPException(status_code=400, detail="手机号格式不正确")
    init_gaokao_2026_portal_tables()
    phone_hash = _gaokao_phone_hash(normalized_phone)
    now = now_iso()
    expires_at = datetime.fromtimestamp(time.time() + GAOKAO_2026_PORTAL_SESSION_TTL_SECONDS, timezone.utc).isoformat()
    session_id = f"gaokao-portal-session-{uuid.uuid4().hex[:12]}"
    token = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    display_name = normalize_gaokao_text(payload.name, 40)
    with gaokao_write_slot():
        with retail_core.connect() as conn:
            lead = conn.execute(
                "SELECT name FROM gaokao_2026_lead WHERE phone_hash = ? ORDER BY updated_at DESC LIMIT 1",
                (phone_hash,),
            ).fetchone()
            if not display_name and lead:
                display_name = normalize_gaokao_text(lead["name"], 40)
            conn.execute(
                """
                INSERT INTO gaokao_2026_portal_session (
                  id, phone_hash, session_token, display_name, created_at, updated_at, last_login_at, expires_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, phone_hash, token, display_name, now, now, now, expires_at),
            )
            recent_count = int(
                conn.execute(
                    "SELECT COUNT(*) AS value FROM gaokao_2026_portal_message WHERE phone_hash = ?",
                    (phone_hash,),
                ).fetchone()["value"]
                or 0
            )
    return {
        "ok": True,
        "campaign": "gaokao2026",
        "viewer": {
            "phone": mask_gaokao_phone(normalized_phone),
            "displayName": mask_gaokao_name(display_name or "同学"),
            "token": token,
            "messageCount": recent_count,
        },
        "updatedAt": now,
    }


def _guess_upload_extension(mime_type: str, image_name: str) -> str:
    normalized_mime = str(mime_type or "").lower().strip()
    lowered_name = str(image_name or "").lower()
    if normalized_mime.endswith("png") or lowered_name.endswith(".png"):
        return ".png"
    if normalized_mime.endswith("webp") or lowered_name.endswith(".webp"):
        return ".webp"
    return ".jpg"


def _save_gaokao_upload(image_base64: str, image_mime_type: str, image_name: str) -> tuple[str, str]:
    raw = str(image_base64 or "").strip()
    if not raw:
        return "", ""
    if "," in raw and raw.lower().startswith("data:"):
        header, raw = raw.split(",", 1)
        if not image_mime_type:
            matched = re.search(r"data:([^;]+);base64", header, re.I)
            if matched:
                image_mime_type = matched.group(1)
    try:
        binary = b64decode(raw, validate=False)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"上传图片解析失败：{error}") from error
    if not binary:
        return "", ""
    ext = _guess_upload_extension(image_mime_type, image_name)
    upload_id = f"gaokao-upload-{uuid.uuid4().hex[:16]}"
    filename = f"{upload_id}{ext}"
    path = GAOKAO_2026_UPLOAD_DIR / filename
    path.write_bytes(binary)
    return f"/gaokao-2026/uploads/{filename}", filename


def _normalize_gaokao_sku_keys(values: list[str] | tuple[str, ...] | None, limit: int = 8) -> list[str]:
    keys: list[str] = []
    for value in values or []:
        text = normalize_gaokao_text(value, 80)
        if text and text not in keys:
            keys.append(text)
        if len(keys) >= limit:
            break
    return keys


def load_gaokao_ai_knowledge_base() -> dict[str, Any]:
    return load_snapshot_from_sql_cache(
        GAOKAO_2026_AI_KNOWLEDGE_FILE,
        default={"generatedAt": "", "summary": {"seedItemCount": 0, "inventoryItemCount": 0, "adminItemCount": 0, "totalItemCount": 0}, "items": []},
        required=False,
    )


def load_gaokao_ai_knowledge_admin_base() -> dict[str, Any]:
    default_payload = {"generatedAt": "", "summary": {"seedItemCount": 0, "inventoryItemCount": 0, "adminItemCount": 0, "totalItemCount": 0}, "items": []}
    payload = load_snapshot_from_sql_cache(
        GAOKAO_2026_AI_KNOWLEDGE_ADMIN_FILE,
        default=default_payload,
        required=False,
    )
    if snapshot_items(payload, "items"):
        return payload
    artifact_path = INVENTORY_SYNC_DIR / "artifacts" / GAOKAO_2026_AI_KNOWLEDGE_ADMIN_FILE
    if artifact_path.exists():
        try:
            return json.loads(artifact_path.read_text("utf-8"))
        except Exception:
            return default_payload
    return default_payload


def load_gaokao_major_guides() -> dict[str, Any]:
    return load_snapshot_from_sql_cache(
        GAOKAO_2026_MAJOR_GUIDES_FILE,
        default={"generatedAt": "", "summary": {"guideCount": 0, "featuredProductCount": 0}, "items": []},
        required=False,
    )


def load_gaokao_daily_learning() -> dict[str, Any]:
    return load_snapshot_from_sql_cache(
        GAOKAO_2026_DAILY_LEARNING_FILE,
        default={"generatedAt": "", "summary": {"trackCount": 0, "learningNoteCount": 0, "featuredRouteCount": 0}, "tracks": [], "dailyLearnings": []},
        required=False,
    )


def list_gaokao_major_guides(query: str = "", major: str = "", limit: int = 8) -> dict[str, Any]:
    snapshot = load_gaokao_major_guides()
    items = snapshot_items(snapshot, "items")
    normalized_query = normalize_gaokao_text(query, 120).lower()
    normalized_major = normalize_gaokao_text(major, 80).lower()
    tokens = [token for token in re.split(r"[\s,，/|｜]+", f"{normalized_query} {normalized_major}") if token]
    scored: list[tuple[float, dict[str, Any]]] = []
    for item in items:
        haystack = " ".join(
            [
                normalize_gaokao_text(item.get("title"), 120).lower(),
                normalize_gaokao_text(item.get("subtitle"), 200).lower(),
                normalize_gaokao_text(item.get("summary"), 400).lower(),
                normalize_gaokao_text(item.get("majorLabel"), 120).lower(),
                normalize_gaokao_text(item.get("scene"), 200).lower(),
                " ".join(str(tag).lower() for tag in (item.get("majorKeywords") or [])),
            ]
        )
        score = 0.0
        for token in tokens:
            if token and token in haystack:
                score += 8
        scored.append((score, item))
    ranked = [item for _, item in sorted(scored, key=lambda pair: (pair[0], -int(pair[1].get("sortNo") or 999)), reverse=True)]
    if tokens:
        filtered = [
            item
            for item in ranked
            if any(
                token in " ".join(
                    [
                        normalize_gaokao_text(item.get("title"), 120).lower(),
                        normalize_gaokao_text(item.get("summary"), 400).lower(),
                        normalize_gaokao_text(item.get("majorLabel"), 120).lower(),
                    ]
                )
                for token in tokens
            )
        ]
        if filtered:
            ranked = filtered
    return {
        "ok": True,
        "generatedAt": snapshot.get("generatedAt", ""),
        "summary": snapshot.get("summary") or {},
        "items": ranked[: max(1, min(limit, 20))],
    }


def get_gaokao_major_guide(guide_id: str) -> dict[str, Any]:
    snapshot = load_gaokao_major_guides()
    items = snapshot_items(snapshot, "items")
    wanted = normalize_gaokao_text(guide_id, 80).lower()
    for item in items:
        if normalize_gaokao_text(item.get("id"), 80).lower() == wanted:
            return {"ok": True, "generatedAt": snapshot.get("generatedAt", ""), "guide": item}
    raise HTTPException(status_code=404, detail="知识分享内容不存在")


def _gaokao_inventory_map_by_skus(sku_keys: list[str] | tuple[str, ...] | None) -> list[dict[str, Any]]:
    wanted = set(_normalize_gaokao_sku_keys(list(sku_keys or []), limit=12))
    if not wanted:
        return []
    candidates = _gaokao_recommendation_candidates()
    matched: list[dict[str, Any]] = []
    for item in candidates:
        sku_key = normalize_gaokao_text(item.get("skuKey"), 80)
        if sku_key not in wanted:
            continue
        matched.append(
            {
                "skuKey": sku_key,
                "productName": str(item.get("productName") or ""),
                "category": str(item.get("category") or ""),
                "marketingActivities": _gaokao_marketing_activity_labels(item),
                "marketingSummary": "；".join(_gaokao_marketing_activity_labels(item)),
                "fitSummary": _gaokao_product_fit_summary(
                    item,
                    sales_signal=item.get("_salesSignal") if isinstance(item.get("_salesSignal"), dict) else None,
                ),
                "lenovoUrl": str(item.get("lenovoUrl") or ""),
                "jdUrl": str(item.get("jdUrl") or ""),
            }
        )
    return matched


def search_gaokao_ai_knowledge(query: str, *, major: str = "", budget: str = "", limit: int = 6) -> dict[str, Any]:
    snapshot = load_gaokao_ai_knowledge_base()
    items = snapshot_items(snapshot, "items")
    normalized_query = normalize_gaokao_text(query, 200).lower()
    normalized_major = normalize_gaokao_text(major, 80).lower()
    normalized_budget = normalize_gaokao_text(budget, 40).lower()
    tokens = [token for token in re.split(r"[\s,，/|｜]+", f"{normalized_query} {normalized_major} {normalized_budget}") if token]
    intent_hits = {
        intent: any(keyword in f"{normalized_query} {normalized_major}" for keyword in keywords)
        for intent, keywords in GAOKAO_KNOWLEDGE_INTENT_RULES.items()
    }
    scored: list[tuple[float, dict[str, Any]]] = []
    for item in items:
        title = normalize_gaokao_text(item.get("title"), 120).lower()
        content = normalize_gaokao_text(item.get("content"), 1000).lower()
        category = normalize_gaokao_text(item.get("category"), 40).lower()
        tags = " ".join(str(tag).lower() for tag in (item.get("tags") or []))
        haystack = " ".join(
            [
                title,
                content,
                category,
                tags,
            ]
        )
        score = 0.0
        for token in tokens:
            if token and token in haystack:
                score += 12
            if token and token in title:
                score += 6
            if token and token in tags:
                score += 4
        if category == "inventory":
            score += 2
        if category == "service" and (intent_hits["service"] or intent_hits["activity"] or intent_hits["win11"]):
            score += 12
        if "win11" in title and intent_hits["win11"]:
            score += 18
        if any(tag in tags for tag in ("计算机", "人工智能", "编程")) and intent_hits["computer_ai"]:
            score += 14
        if any(tag in tags for tag in ("设计", "传媒", "剪辑", "建模")) and intent_hits["design"]:
            score += 14
        if any(tag in tags for tag in ("轻薄", "便携", "通勤", "课堂")) and intent_hits["portable"]:
            score += 10
        if any(tag in tags for tag in ("游戏", "显卡", "高刷", "性能")) and intent_hits["gaming"]:
            score += 10
        if category == "activity" and intent_hits["activity"]:
            score += 10
        if normalized_major and normalized_major[:2] and normalized_major[:2] in haystack:
            score += 8
        if not tokens:
            score += 1
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    results = [item for _score, item in scored[: max(1, min(limit, 12))]]
    return {
        "ok": True,
        "generatedAt": str(snapshot.get("generatedAt") or ""),
        "summary": snapshot.get("summary") or {},
        "items": results,
    }


def sanitize_gaokao_customer_knowledge_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    secret_keywords = ("价", "毛利", "成本", "进货", "渠道", "防流失", "商业秘密")
    sanitized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        content = normalize_gaokao_text(item.get("content"), 400)
        safe_sentences: list[str] = []
        for sentence in re.split(r"[。；;!！?？]+", content):
            normalized = normalize_gaokao_text(sentence, 240)
            if not normalized:
                continue
            if any(keyword in normalized for keyword in secret_keywords):
                continue
            safe_sentences.append(normalized)
        sanitized.append(
            {
                "id": normalize_gaokao_text(item.get("id"), 80),
                "title": normalize_gaokao_text(item.get("title"), 120),
                "category": normalize_gaokao_text(item.get("category"), 40),
                "content": "。".join(safe_sentences[:3]),
                "updatedAt": normalize_gaokao_text(item.get("updatedAt"), 80),
            }
        )
    return sanitized


def sanitize_gaokao_customer_product_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sanitized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        sanitized.append(
            {
                "skuKey": normalize_gaokao_text(item.get("skuKey"), 80),
                "productName": normalize_gaokao_text(item.get("productName"), 160),
                "category": normalize_gaokao_text(item.get("category"), 40),
                "marketingActivities": [
                    normalize_gaokao_text(activity, 40)
                    for activity in (item.get("marketingActivities") or [])
                    if normalize_gaokao_text(activity, 40)
                ],
                "marketingSummary": normalize_gaokao_text(item.get("marketingSummary"), 240),
                "fitSummary": normalize_gaokao_text(item.get("fitSummary"), 240),
                "reasonHighlights": [
                    normalize_gaokao_text(reason, 80)
                    for reason in (item.get("reasonHighlights") or [])
                    if normalize_gaokao_text(reason, 80)
                ],
                "lenovoUrl": normalize_gaokao_text(item.get("lenovoUrl"), 240),
                "jdUrl": normalize_gaokao_text(item.get("jdUrl"), 240),
            }
        )
    return sanitized


def sanitize_gaokao_customer_text(value: Any) -> str:
    text = normalize_gaokao_text(value, 2000)
    if not text:
        return ""
    patterns = [
        (r"现?货\s*\d+\s*台", "到店可对比同类机型"),
        (r"建议价[^。；;!！?？]*", ""),
        (r"先报正规厂家渠道国补价[^。；;!！?？]*", ""),
        (r"防流失价差约\s*\d+(?:\.\d+)?\s*元", ""),
        (r"进货价[^。；;!！?？]*", ""),
        (r"毛利[^。；;!！?？]*", ""),
        (r"底价[^。；;!！?？]*", ""),
    ]
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    text = re.sub(r"[；;，,]\s*[；;，,]+", "；", text)
    text = re.sub(r"\s+", " ", text).strip(" ，,；;。")
    return text


def _is_gaokao_photo_request(*values: Any) -> bool:
    text = " ".join(normalize_gaokao_text(value, 400) for value in values if value)
    lowered = text.lower()
    return any(keyword in lowered for keyword in ("生图", "合影", "照片", "photo", "image", "同框", "ai照", "ai 照", "纪念图"))


def _gaokao_photo_request_flow_reply(
    *,
    major: str = "",
    budget: str = "",
    recommendation: dict[str, Any] | None = None,
) -> str:
    recommendation = recommendation or {}
    items = recommendation.get("items") or []
    product_hint = ""
    if items:
        top_item = items[0]
        product_hint = f" 如果你还想顺便问选机，可以把专业、预算、便携或性能偏好一起写上，我会再按门店方向继续帮你收窄到像 {normalize_gaokao_text(top_item.get('productName'), 40) or '当前活动机型'} 这类更合适的路线。"
    major_hint = f"你现在填的专业方向是 {normalize_gaokao_text(major, 40)}。" if major else "如果还没确定专业，也可以先按日常学习、设计剪辑、编程 AI 这类使用方向描述。"
    budget_hint = f"预算先按 {normalize_gaokao_text(budget, 24)} 这个范围说明就够了。" if budget else "预算先写大概区间就可以。"
    return (
        "这项服务可以做。你先按流程把需求写完整：第一步写清想生成什么照片，比如高考纪念图、明星同框或校园场景；"
        "第二步补充人物关系、人数、背景、服装或表情风格；第三步上传 1 到 2 张参考照片，尽量正脸、清晰、不要带证件信息；"
        f"第四步补充 {budget_hint}{major_hint} 门店会根据你的描述继续补充回复和图片结果。{product_hint}"
    )


def _gaokao_public_dialog_text(value: Any, limit: int = 240) -> str:
    return sanitize_gaokao_customer_text(normalize_gaokao_text(value, limit))


def _gaokao_public_topic_text(row: sqlite3.Row) -> str:
    topic = normalize_gaokao_text(row["topic"], 120)
    message = normalize_gaokao_text(row["message"], 240)
    return topic or message or "提交了新的互动需求"


def _gaokao_public_reply_payload(row: sqlite3.Row) -> dict[str, Any]:
    try:
        return json.loads(str(row["reply_payload_json"] or "{}") or "{}")
    except Exception:
        return {}


def _public_gaokao_portal_message(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": mask_gaokao_name(row["display_name"]),
        "phone": mask_gaokao_phone(row["phone"]),
        "channel": str(row["channel"] or "wish"),
        "topic": _gaokao_public_topic_text(row),
        "wishTag": str(row["wish_tag"] or ""),
        "message": _gaokao_public_dialog_text(row["message"], 240),
        "status": str(row["status"] or "pending"),
        "createdAt": str(row["created_at"] or ""),
    }


def _viewer_gaokao_portal_message(row: sqlite3.Row) -> dict[str, Any]:
    payload = _public_gaokao_portal_message(row)
    reply_payload = json.loads(str(row["reply_payload_json"] or "{}") or "{}")
    safe_products = sanitize_gaokao_customer_product_items(reply_payload.get("suggestedProducts") or [])
    payload.update(
        {
            "imageUrl": str(row["image_path"] or ""),
            "imageName": str(row["image_name"] or ""),
            "replyMessage": sanitize_gaokao_customer_text(row["reply_message"] or ""),
            "replyBy": str(row["reply_by"] or ""),
            "repliedAt": str(row["replied_at"] or ""),
            "metadata": json.loads(str(row["metadata_json"] or "{}") or "{}"),
            "replyPayload": {
                "replyImageUrl": str(reply_payload.get("replyImageUrl") or ""),
                "replyImageName": str(reply_payload.get("replyImageName") or ""),
                "followUpAction": str(reply_payload.get("followUpAction") or ""),
                "adminFollowUpMessage": sanitize_gaokao_customer_text(reply_payload.get("adminFollowUpMessage") or ""),
                "adminFollowUpBy": str(reply_payload.get("adminFollowUpBy") or ""),
                "adminFollowUpAt": str(reply_payload.get("adminFollowUpAt") or ""),
                "engine": str(reply_payload.get("engine") or ""),
                "suggestedSkuKeys": _normalize_gaokao_sku_keys(reply_payload.get("suggestedSkuKeys") or []),
                "suggestedProducts": safe_products,
                "knowledge": {
                    "items": [
                        {
                            "title": normalize_gaokao_text(item.get("title"), 80),
                            "category": normalize_gaokao_text(item.get("category"), 30),
                        }
                        for item in ((reply_payload.get("knowledge") or {}).get("items") or [])[:4]
                        if isinstance(item, dict)
                    ]
                },
            },
        }
    )
    return payload


def _admin_gaokao_portal_message(row: sqlite3.Row) -> dict[str, Any]:
    payload = _viewer_gaokao_portal_message(row)
    payload["name"] = str(row["display_name"] or "")
    payload["phone"] = normalize_mainland_phone(row["phone"])
    reply_payload = json.loads(str(row["reply_payload_json"] or "{}") or "{}")
    payload["replyPayload"] = reply_payload
    row_keys = set(row.keys()) if hasattr(row, "keys") else set()
    payload["customerId"] = str(row["customer_id"] or "") if "customer_id" in row_keys else ""
    payload["ops"] = {
        "assignedTo": str(row["assigned_to"] or "") if "assigned_to" in row_keys else "",
        "followUpStage": str(row["follow_up_stage"] or "new_lead") if "follow_up_stage" in row_keys else "new_lead",
        "visitStatus": str(row["visit_status"] or "not_arrived") if "visit_status" in row_keys else "not_arrived",
        "conversionStatus": str(row["conversion_status"] or "active") if "conversion_status" in row_keys else "active",
    }
    return payload


def list_gaokao_portal_feed(limit: int = 16) -> list[dict[str, Any]]:
    init_gaokao_2026_portal_tables()
    safe_limit = max(1, min(int(limit or 16), 50))
    with retail_core.connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM gaokao_2026_portal_message
            WHERE channel IN ('wish', 'consultation') AND message <> ''
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    return [_public_gaokao_portal_message(row) for row in rows]


def _public_gaokao_photo_feed_message(row: sqlite3.Row) -> dict[str, Any]:
    payload = _public_gaokao_portal_message(row)
    reply_payload = _gaokao_public_reply_payload(row)
    question = _gaokao_public_dialog_text(row["message"], 240)
    ai_reply = _gaokao_public_dialog_text(row["reply_message"], 260)
    admin_follow_up = _gaokao_public_dialog_text(reply_payload.get("adminFollowUpMessage") or "", 260)
    payload.update(
        {
            "question": question or payload["topic"],
            "publicReplyMessage": admin_follow_up or ai_reply,
            "replyBy": normalize_gaokao_text(reply_payload.get("adminFollowUpBy") or row["reply_by"], 40),
            "repliedAt": str(reply_payload.get("adminFollowUpAt") or row["replied_at"] or ""),
            "imageUrl": str(row["image_path"] or ""),
            "imageName": str(row["image_name"] or ""),
            "replyImageUrl": str(reply_payload.get("replyImageUrl") or ""),
            "hasCustomerImage": bool(row["image_path"]),
            "hasReplyImage": bool(reply_payload.get("replyImageUrl")),
            "imageTag": "照片互动",
            "publicApproved": _gaokao_photo_public_approved(row),
        }
    )
    return payload


def _gaokao_photo_public_approved(row: sqlite3.Row) -> bool:
    reply_payload = _gaokao_public_reply_payload(row)
    if "publicApproved" in reply_payload:
        return bool(reply_payload.get("publicApproved"))
    return bool(row["image_path"]) and bool(reply_payload.get("replyImageUrl"))


def list_gaokao_portal_photo_feed(limit: int = 10) -> list[dict[str, Any]]:
    init_gaokao_2026_portal_tables()
    safe_limit = max(1, min(int(limit or 10), 30))
    with retail_core.connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM gaokao_2026_portal_message
            WHERE (
              channel = 'wish'
              OR image_path <> ''
              OR topic LIKE '%照片%'
              OR topic LIKE '%合影%'
              OR topic LIKE '%生图%'
              OR message LIKE '%照片%'
              OR message LIKE '%合影%'
              OR message LIKE '%生图%'
            )
            AND message <> ''
            AND (
              reply_message <> ''
              OR json_extract(reply_payload_json, '$.adminFollowUpMessage') IS NOT NULL
              OR json_extract(reply_payload_json, '$.replyImageUrl') IS NOT NULL
            )
            ORDER BY COALESCE(replied_at, created_at) DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    approved_rows = [row for row in rows if _gaokao_photo_public_approved(row)]
    return [_public_gaokao_photo_feed_message(row) for row in approved_rows[:safe_limit]]


def list_gaokao_portal_messages(phone: str, token: str, limit: int = 60) -> list[dict[str, Any]]:
    normalized_phone, _session = _assert_gaokao_portal_session(phone, token)
    phone_hash = _gaokao_phone_hash(normalized_phone)
    safe_limit = max(1, min(int(limit or 60), 200))
    with retail_core.connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM gaokao_2026_portal_message
            WHERE phone_hash = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (phone_hash, safe_limit),
        ).fetchall()
    return [_viewer_gaokao_portal_message(row) for row in rows]


def create_gaokao_portal_message(payload: Gaokao2026PortalMessageCreateInput) -> dict[str, Any]:
    normalized_phone, session = _assert_gaokao_portal_session(payload.phone, payload.token)
    phone_hash = _gaokao_phone_hash(normalized_phone)
    now = now_iso()
    image_url, stored_name = _save_gaokao_upload(payload.imageBase64, payload.imageMimeType, payload.imageName)
    message_id = f"gaokao-portal-message-{uuid.uuid4().hex[:12]}"
    channel = normalize_gaokao_text(payload.channel, 20).lower() or "wish"
    if channel not in {"wish", "consultation"}:
        channel = "wish"
    display_name = normalize_gaokao_text(payload.name, 40) or str(session["display_name"] or "")
    metadata = {
        "major": normalize_gaokao_text(payload.major, 80),
        "budget": normalize_gaokao_text(payload.budget, 40),
        "purchaseTime": normalize_gaokao_text(payload.purchaseTime, 40),
        "replyToMessageId": normalize_gaokao_text(payload.replyToMessageId, 80),
        "replyToTopic": normalize_gaokao_text(payload.replyToTopic, 120),
        "replyToChannel": normalize_gaokao_text(payload.replyToChannel, 20),
        "replySource": normalize_gaokao_text(payload.replySource, 40),
    }
    with retail_core.connect() as conn:
        conn.execute(
            """
            INSERT INTO gaokao_2026_portal_message (
              id, phone_hash, phone, display_name, channel, topic, wish_tag, message,
              image_path, image_name, image_mime_type, metadata_json, reply_message, reply_payload_json,
              status, reply_by, replied_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}', 'pending', '', '', ?, ?)
            """,
            (
                message_id,
                phone_hash,
                normalized_phone,
                display_name,
                channel,
                normalize_gaokao_text(payload.topic, 80),
                normalize_gaokao_text(payload.wishTag, 40),
                normalize_gaokao_text(payload.message, 1000),
                image_url,
                stored_name or normalize_gaokao_text(payload.imageName, 120),
                normalize_gaokao_text(payload.imageMimeType, 80),
                json.dumps(metadata, ensure_ascii=False),
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM gaokao_2026_portal_message WHERE id = ?", (message_id,)).fetchone()
    return {"ok": True, "message": _viewer_gaokao_portal_message(row), "updatedAt": now}


def list_gaokao_admin_messages(limit: int = 80, status: str = "", assigned_to: str = "") -> list[dict[str, Any]]:
    init_gaokao_2026_portal_tables()
    safe_limit = max(1, min(int(limit or 80), 300))
    normalized_status = normalize_gaokao_text(status, 20).lower()
    normalized_assigned_to = normalize_gaokao_text(assigned_to, 40)
    sql = """
        SELECT
          m.*,
          l.id AS customer_id,
          ops.assigned_to,
          ops.follow_up_stage,
          ops.visit_status,
          ops.conversion_status
        FROM gaokao_2026_portal_message m
        LEFT JOIN gaokao_2026_lead l
          ON l.id = (
            SELECT l2.id
            FROM gaokao_2026_lead l2
            WHERE l2.phone_hash = m.phone_hash
            ORDER BY l2.updated_at DESC
            LIMIT 1
          )
        LEFT JOIN gaokao_2026_customer_ops ops ON ops.lead_id = l.id
    """
    params: list[Any] = []
    conditions: list[str] = []
    if normalized_status:
        conditions.append("m.status = ?")
        params.append(normalized_status)
    if normalized_assigned_to:
        conditions.append("ops.assigned_to LIKE ?")
        params.append(f"%{normalized_assigned_to}%")
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY m.created_at DESC LIMIT ?"
    params.append(safe_limit)
    with retail_core.connect() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_admin_gaokao_portal_message(row) for row in rows]


def list_gaokao_admin_photo_messages(limit: int = 80, status: str = "", assigned_to: str = "") -> list[dict[str, Any]]:
    rows = list_gaokao_admin_messages(limit=limit, status=status, assigned_to=assigned_to)
    explicit_photo_ids: set[str] = set()
    for item in rows:
        if _is_gaokao_photo_request(
            item.get("topic"),
            item.get("wishTag"),
            item.get("message"),
            item.get("replyMessage"),
        ) or item.get("imageUrl") or (item.get("replyPayload") or {}).get("replyImageUrl"):
            explicit_photo_ids.add(str(item.get("id") or ""))
    filtered: list[dict[str, Any]] = []
    for item in rows:
        metadata = item.get("metadata") or {}
        reply_to_id = str(metadata.get("replyToMessageId") or "")
        if (
            str(item.get("id") or "") in explicit_photo_ids
            or reply_to_id in explicit_photo_ids
            or _is_gaokao_photo_request(metadata.get("replyToTopic"))
        ):
            filtered.append(item)
    return filtered


def reply_gaokao_admin_message(message_id: str, payload: Gaokao2026PortalReplyInput) -> dict[str, Any]:
    init_gaokao_2026_portal_tables()
    now = now_iso()
    reply_text = normalize_gaokao_text(payload.replyMessage, 2000)
    follow_up_reply_text = normalize_gaokao_text(payload.followUpReplyMessage, 2000)
    reply_image_url, reply_image_name = _save_gaokao_upload(payload.replyImageBase64, payload.replyImageMimeType, payload.replyImageName)
    suggested_sku_keys = _normalize_gaokao_sku_keys(payload.suggestedSkuKeys)
    if not reply_text and not follow_up_reply_text and not reply_image_url and not suggested_sku_keys and not normalize_gaokao_text(payload.followUpAction, 120):
        raise HTTPException(status_code=400, detail="至少填写回复内容、回复图片、跟进动作或推荐机型之一")
    with retail_core.connect() as conn:
        row = conn.execute("SELECT * FROM gaokao_2026_portal_message WHERE id = ?", (message_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="互动记录不存在")
        existing_reply_payload = json.loads(str(row["reply_payload_json"] or "{}") or "{}")
        channel = normalize_gaokao_text(row["channel"], 20).lower() or "wish"
        normalized_responder = normalize_gaokao_text(payload.responder, 40) or "门店顾问"
        merged_reply_payload = dict(existing_reply_payload)
        if reply_image_url:
            merged_reply_payload["replyImageUrl"] = reply_image_url
        if reply_image_name or normalize_gaokao_text(payload.replyImageName, 120):
            merged_reply_payload["replyImageName"] = reply_image_name or normalize_gaokao_text(payload.replyImageName, 120)
        if normalize_gaokao_text(payload.replyImageMimeType, 80):
            merged_reply_payload["replyImageMimeType"] = normalize_gaokao_text(payload.replyImageMimeType, 80)
        if normalize_gaokao_text(payload.followUpAction, 120):
            merged_reply_payload["followUpAction"] = normalize_gaokao_text(payload.followUpAction, 120)
        if normalize_gaokao_text(payload.internalNote, 500):
            merged_reply_payload["internalNote"] = normalize_gaokao_text(payload.internalNote, 500)
        if suggested_sku_keys:
            merged_reply_payload["suggestedSkuKeys"] = suggested_sku_keys
            merged_reply_payload["suggestedProducts"] = _gaokao_inventory_map_by_skus(suggested_sku_keys)
        if payload.publicApproved is not None:
            merged_reply_payload["publicApproved"] = bool(payload.publicApproved)

        primary_reply_text = reply_text
        if channel == "ai_chat":
            if reply_text and not follow_up_reply_text:
                follow_up_reply_text = reply_text
            primary_reply_text = normalize_gaokao_text(row["reply_message"], 2000)
        if follow_up_reply_text:
            merged_reply_payload["adminFollowUpMessage"] = follow_up_reply_text
            merged_reply_payload["adminFollowUpBy"] = normalized_responder
            merged_reply_payload["adminFollowUpAt"] = now

        conn.execute(
            """
            UPDATE gaokao_2026_portal_message
            SET reply_message = ?, reply_payload_json = ?, status = ?, reply_by = ?, replied_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                primary_reply_text,
                json.dumps(merged_reply_payload, ensure_ascii=False),
                normalize_gaokao_text(payload.status, 20).lower() or "replied",
                normalized_responder,
                now,
                now,
                message_id,
            ),
        )
        updated = conn.execute("SELECT * FROM gaokao_2026_portal_message WHERE id = ?", (message_id,)).fetchone()
    return {"ok": True, "message": _admin_gaokao_portal_message(updated), "updatedAt": now}


def _parse_budget_range(text: str) -> tuple[float, float]:
    normalized = normalize_gaokao_text(text, 40)
    if "4000-5000" in normalized:
        return 3500, 5500
    if "5000-7000" in normalized:
        return 5000, 7200
    if "7000-9000" in normalized:
        return 6800, 9300
    if "9000" in normalized:
        return 8800, 20000
    return 0, 20000


def _major_rule_for_text(major: str) -> dict[str, Any]:
    text = normalize_gaokao_text(major, 80)
    for rule in GAOKAO_2026_RECOMMENDATION_RULES:
        if any(keyword in text for keyword in rule["keyword"]):
            return rule
    return {
        "categories": ("轻薄笔记本", "游戏笔记本", "平板电脑"),
        "focus": "默认优先推荐库存稳定、销量好的现货型号，再按预算和场景收窄。",
    }


def _gaokao_lookup_key(value: Any) -> str:
    return re.sub(r"\s+", "", normalize_gaokao_text(value, 200)).lower()


def _load_gaokao_sales_signal_map() -> dict[str, dict[str, Any]]:
    snapshot = load_snapshot_from_sql_cache("latest-retail-core-sales-orders.json", default={}, required=False)
    items = snapshot_items(snapshot, "items")
    signal_map: dict[str, dict[str, Any]] = {}
    for order in items:
        lines = order.get("lines") or []
        if not isinstance(lines, list):
            continue
        for line in lines:
            if not isinstance(line, dict):
                continue
            quantity = max(1.0, float(line.get("quantity") or 0) or 1.0)
            for key in (
                _gaokao_lookup_key(line.get("sku_key")),
                _gaokao_lookup_key(line.get("mtm_code")),
                _gaokao_lookup_key(line.get("product_name")),
            ):
                if not key:
                    continue
                current = signal_map.setdefault(
                    key,
                    {"orderCount": 0, "quantity": 0.0, "channels": []},
                )
                current["orderCount"] = int(current.get("orderCount") or 0) + 1
                current["quantity"] = float(current.get("quantity") or 0) + quantity
                channel = normalize_gaokao_text(order.get("channel_type_name"), 40)
                if channel and channel not in current["channels"]:
                    current["channels"].append(channel)
    return signal_map


def _gaokao_resolve_sales_signal(item: dict[str, Any], signal_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    best: dict[str, Any] = {}
    for key in (
        _gaokao_lookup_key(item.get("skuKey")),
        _gaokao_lookup_key(item.get("pnMtm")),
        _gaokao_lookup_key(item.get("productName")),
    ):
        if not key:
            continue
        candidate = signal_map.get(key) or {}
        if not candidate:
            continue
        if (
            float(candidate.get("quantity") or 0) > float(best.get("quantity") or 0)
            or (
                float(candidate.get("quantity") or 0) == float(best.get("quantity") or 0)
                and int(candidate.get("orderCount") or 0) > int(best.get("orderCount") or 0)
            )
        ):
            best = candidate
    return best


def _gaokao_product_reason_highlights(
    item: dict[str, Any],
    *,
    major: str = "",
    portability: str = "",
    performance_need: str = "",
    ai_focus: str = "",
) -> list[str]:
    name = normalize_gaokao_text(item.get("productName"), 160)
    category = normalize_gaokao_text(item.get("category"), 40)
    major_text = normalize_gaokao_text(major, 80)
    portability_text = normalize_gaokao_text(portability, 40)
    performance_text = normalize_gaokao_text(performance_need, 40)
    ai_text = normalize_gaokao_text(ai_focus, 40)
    reasons: list[str] = []
    if category == "轻薄笔记本":
        reasons.append("更适合课堂通勤、图书馆和长期随身携带")
    if category == "游戏笔记本":
        reasons.append("更适合建模、渲染、剪辑和高负载课程")
    if category == "平板电脑":
        reasons.append("更适合资料批注、网课辅助和轻量学习场景")
    if any(keyword in normalize_gaokao_text(item.get("salesNote"), 160) for keyword in ("YOGA",)):
        reasons.append("属于当前厂家重点路线")
    if "轻" in portability_text and category == "轻薄笔记本":
        reasons.append("你更在意便携，这类方向更容易兼顾重量和续航")
    if "性能" in performance_text and category == "游戏笔记本":
        reasons.append("你更偏性能需求，这类方向更适合持续高负载")
    if ai_text and ("AI" in name or "YOGA" in name or "32G" in name):
        reasons.append("更适合继续尝试资料总结、创作辅助和 AI 工具")
    if any(keyword in major_text for keyword in ("计算机", "人工智能", "数据")):
        reasons.append("更适合代码、多任务和长期开发环境使用")
    if any(keyword in major_text for keyword in ("设计", "传媒", "建筑", "工程")):
        reasons.append("更适合多软件并行、显卡需求和创作课程")
    if any(keyword in major_text for keyword in ("文科", "经管", "师范", "法学")):
        reasons.append("更适合课堂记录、文档资料和演示汇报场景")
    if name.startswith("YOGA") or "YOGA" in name:
        reasons.append("更偏轻创作和质感路线")
    if any(keyword in major_text for keyword in ("文科", "经管", "师范", "法学")) and ("YOGA" in name or "Yoga" in name):
        reasons.append("属于门店和厂家当前重点轻薄方向，更适合预算更高的文科路线")
    if ("同款" in ai_text or "张凌赫" in ai_text) and ("YOGA" in name or "Yoga" in name):
        reasons.append("可重点对比张凌赫同款路线和更长服务权益")
    if "拯救者" in name or "Legion" in name:
        reasons.append("更偏性能和显卡路线")
    if "小新" in name or "Pro16" in name:
        reasons.append("更偏学习、创作和通勤兼顾")
    deduped: list[str] = []
    for reason in reasons:
        if reason and reason not in deduped:
            deduped.append(reason)
    return deduped[:3]


def _gaokao_product_fit_summary(
    item: dict[str, Any],
    *,
    major: str = "",
    portability: str = "",
    performance_need: str = "",
    ai_focus: str = "",
    sales_signal: dict[str, Any] | None = None,
) -> str:
    reasons = _gaokao_product_reason_highlights(
        item,
        major=major,
        portability=portability,
        performance_need=performance_need,
        ai_focus=ai_focus,
    )
    if sales_signal and int(sales_signal.get("orderCount") or 0) >= 2:
        reasons.append("门店近期在同类需求里更常被选择")
    if not reasons:
        reasons.append("适合作为当前专业和预算下的到店对比方向")
    return "；".join(reasons[:3])


def _gaokao_recommendation_candidates() -> list[dict[str, Any]]:
    retail_zone = load_snapshot_from_sql_cache("latest-retail-zone-snapshot.json", default={}, required=False)
    items = snapshot_items(retail_zone.get("decisions", {}), "items")
    signal_map = _load_gaokao_sales_signal_map()
    candidates: list[dict[str, Any]] = []
    for item in items:
        if float(item.get("sellableStock") or 0) <= 0:
            continue
        next_item = dict(item)
        next_item["_salesSignal"] = _gaokao_resolve_sales_signal(next_item, signal_map)
        candidates.append(next_item)
    return candidates


def _gaokao_marketing_activity_labels(item: dict[str, Any]) -> list[str]:
    activities: list[str] = []

    def append_once(label: str) -> None:
        if label and label not in activities:
            activities.append(label)

    if float(item.get("platformSubsidyPrice") or 0) > 0 or float(item.get("lenovoOfficialPostSubsidyPrice") or 0) > 0:
        append_once("可参加国补活动")
    if float(item.get("fullServiceSubsidyPrice") or 0) > 0:
        append_once("可参加门店全服务活动")
    if float(item.get("regularChannelSubsidyPrice") or 0) > 0:
        append_once("可参加正规渠道服务活动")
    if float(item.get("defensiveLowSubsidyPrice") or 0) > 0:
        append_once("可到店核验专项活动方案")

    sales_note = normalize_gaokao_text(item.get("salesNote"), 160)
    if "教育补" in sales_note:
        append_once("可到店核验教育补活动")
    if "三件套" in sales_note:
        append_once("可叠加 AI 三件套活动")
    if "二件套" in sales_note:
        append_once("可叠加二件套活动")

    if not activities and sales_note:
        append_once(sales_note)
    return activities[:4]


def check_gaokao_ai_boundary(message: str) -> dict[str, Any] | None:
    text = normalize_gaokao_text(message, 1200).lower()
    for key, rule in GAOKAO_AI_BOUNDARY_RULES.items():
        if any(keyword.lower() in text for keyword in rule["keywords"]):
            return {
                "blocked": True,
                "reason": rule["reason"],
                "reply": rule["reply"],
                "ruleKey": key,
            }
    return None


def recommend_gaokao_products(payload: Gaokao2026RecommendationInput) -> dict[str, Any]:
    candidates = _gaokao_recommendation_candidates()
    rule = _major_rule_for_text(payload.major)
    budget_min, budget_max = _parse_budget_range(payload.budget)
    portability = normalize_gaokao_text(payload.portability, 40)
    performance_need = normalize_gaokao_text(payload.performanceNeed, 40)
    ai_focus = normalize_gaokao_text(payload.aiFocus, 40)
    scored: list[tuple[float, dict[str, Any]]] = []
    for item in candidates:
        category = str(item.get("category") or "")
        name = str(item.get("productName") or "")
        price = float(item.get("recommendedPreSubsidyPrice") or item.get("lenovoOfficialPrice") or 0)
        sales_signal = item.get("_salesSignal") if isinstance(item.get("_salesSignal"), dict) else {}
        score = 0.0
        if category in rule["categories"]:
            score += 40
        if budget_min <= price <= budget_max:
            score += 24
        elif price and price < budget_min:
            score += 10
        if "轻" in portability and category == "轻薄笔记本":
            score += 12
        if "性能" in performance_need and category == "游戏笔记本":
            score += 12
        if ai_focus and ("32G" in name or "AI" in name or "YOGA" in name):
            score += 8
        if any(keyword in normalize_gaokao_text(payload.major, 80) for keyword in ("文科", "经管", "师范", "法学")) and ("YOGA" in name or "Yoga" in name):
            score += 16
        if budget_min >= 8800 and ("YOGA" in name or "Yoga" in name):
            score += 12
        score += min(float(item.get("sellableStock") or 0), 20)
        if "YOGA" in name:
            score += 8
        if "拯救者" in name or "Legion" in name:
            score += 3
        if "Pro" in name:
            score += 2
        score += min(float(sales_signal.get("quantity") or 0) * 1.5, 12)
        score += min(float(sales_signal.get("orderCount") or 0) * 2, 10)
        scored.append((score, item))
    scored.sort(key=lambda pair: (pair[0], float(pair[1].get("sellableStock") or 0)), reverse=True)
    picks = []
    for _score, item in scored[:4]:
        marketing_activities = _gaokao_marketing_activity_labels(item)
        sales_signal = item.get("_salesSignal") if isinstance(item.get("_salesSignal"), dict) else {}
        reason_highlights = _gaokao_product_reason_highlights(
            item,
            major=payload.major,
            portability=payload.portability,
            performance_need=payload.performanceNeed,
            ai_focus=payload.aiFocus,
        )
        if int(sales_signal.get("orderCount") or 0) >= 2:
            reason_highlights.append("近期门店常被选择")
        fit_summary = _gaokao_product_fit_summary(
            item,
            major=payload.major,
            portability=payload.portability,
            performance_need=payload.performanceNeed,
            ai_focus=payload.aiFocus,
            sales_signal=sales_signal,
        )
        picks.append(
            {
                "skuKey": str(item.get("skuKey") or ""),
                "productName": str(item.get("productName") or ""),
                "pnMtm": str(item.get("pnMtm") or ""),
                "category": str(item.get("category") or ""),
                "marketingActivities": marketing_activities,
                "marketingSummary": "；".join(marketing_activities),
                "fitSummary": fit_summary,
                "reasonHighlights": reason_highlights[:3],
                "lenovoUrl": str(item.get("lenovoUrl") or ""),
                "jdUrl": str(item.get("jdUrl") or ""),
            }
        )
    return {
        "ok": True,
        "campaign": "gaokao2026",
        "ruleFocus": rule["focus"],
        "items": picks,
        "updatedAt": now_iso(),
    }


def _gaokao_chat_display_knowledge_titles(items: list[dict[str, Any]] | None) -> list[str]:
    rows = [item for item in (items or []) if isinstance(item, dict)]
    preferred = [
        item for item in rows
        if normalize_gaokao_text(item.get("category"), 20) in {"seed", "service"}
    ]
    non_inventory = [item for item in rows if normalize_gaokao_text(item.get("category"), 20) != "inventory"]
    source = preferred or non_inventory or rows
    titles: list[str] = []
    for item in source[:3]:
        title = normalize_gaokao_text(item.get("title"), 36)
        if title and title not in titles:
            titles.append(title)
    return titles


def _gaokao_chat_fallback_reply(
    message: str,
    recommendation: dict[str, Any],
    knowledge_items: list[dict[str, Any]] | None = None,
) -> str:
    items = recommendation.get("items") or []
    if items:
        first = items[0]
        second = items[1] if len(items) > 1 else None
        parts = [
            f"按你的专业和当前需求，先优先看 {first.get('productName', '当前现货机型')}。",
            normalize_gaokao_text(
                first.get("fitSummary"),
                240,
            )
            or "建议到店先核实配置、重量、屏幕和常用软件场景，再和同类机型现场对比。",
        ]
        if second:
            parts.append(
                f"如果你更想保留第二个对比方向，可以同时看看 {second.get('productName', '另一台现货机型')}，它更适合作为同预算下的现场对比。"
            )
        activities = first.get("marketingActivities") or []
        if isinstance(activities, list) and activities:
            parts.append(f"当前可重点核验：{'、'.join([normalize_gaokao_text(activity, 24) for activity in activities[:3] if normalize_gaokao_text(activity, 24)])}。")
        guide_titles = _gaokao_chat_display_knowledge_titles(knowledge_items)
        if guide_titles:
            parts.append(f"你也可以继续看 { ' / '.join(guide_titles) }，里面有更细的公开选机建议。")
        parts.append("如果你告诉我更看重便携、性能、屏幕还是本地 AI 使用，我可以继续帮你收窄到 1 到 2 台。")
        return " ".join([part for part in parts if part])
    return "我先按你的专业、预算和用途给你筛现货机型。你继续告诉我更在意便携、性能、屏幕还是使用场景，我再帮你收窄。"


def _gaokao_chat_fast_local_reply(
    message: str,
    *,
    major: str,
    budget: str,
    recommendation: dict[str, Any],
    knowledge_items: list[dict[str, Any]],
) -> str:
    items = recommendation.get("items") or []
    if not items:
        return "我先按你的专业、预算和用途给你缩小到更适合到店核验的现货方向。你继续告诉我更看重便携、性能、屏幕还是 AI 本地使用，我再帮你收窄。"
    first = items[0]
    second = items[1] if len(items) > 1 else None
    topics = _gaokao_chat_display_knowledge_titles(knowledge_items)
    major_text = normalize_gaokao_text(major, 80) or "你的专业方向"
    budget_text = normalize_gaokao_text(budget, 40) or "当前预算"
    question_text = normalize_gaokao_text(message, 120)

    reply_parts = [
        f"按 {major_text} 和 {budget_text}，先优先看 {normalize_gaokao_text(first.get('productName'), 120) or '当前现货机型'}。",
        normalize_gaokao_text(first.get("fitSummary"), 220)
        or "建议到店先核实配置、重量、屏幕和常用软件场景，再和同类机型现场对比。",
    ]
    if second:
        reply_parts.append(
            f"如果你想保留第二个对比方向，可以同时看看 {normalize_gaokao_text(second.get('productName'), 120)}，方便你在同预算里现场比较。"
        )
    if "便携" in question_text:
        reply_parts.append("你更在意通勤和课堂携带的话，优先比较重量、续航和屏幕舒适度。")
    elif "性能" in question_text or "游戏" in question_text or "建模" in question_text or "剪辑" in question_text:
        reply_parts.append("如果你更在意性能，优先比较散热、显卡档位、内存容量和长期高负载稳定性。")
    activities = first.get("marketingActivities") or []
    if isinstance(activities, list) and activities:
        reply_parts.append(f"当前可重点核验：{'、'.join([normalize_gaokao_text(activity, 24) for activity in activities[:3] if normalize_gaokao_text(activity, 24)])}。")
    if topics:
        reply_parts.append(f"你还可以继续看 { ' / '.join(topics) }，里面有更细的公开选机建议。")

    reply_parts.append("如果你告诉我更看重便携、性能、屏幕还是 AI 本地使用，我可以继续帮你收窄到 1 到 2 台。")
    return " ".join(reply_parts)


def _normalize_gaokao_ai_reply_text(value: Any, limit: int = 2000) -> str:
    text = str(value or "")
    text = re.sub(r"<think>[\s\S]*?</think>", " ", text, flags=re.IGNORECASE)
    fenced = re.search(r"```(?:text|markdown)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if fenced:
        text = fenced.group(1)
    return normalize_gaokao_text(text, limit)


def request_gaokao_minimax_chat(
    message: str,
    *,
    major: str,
    budget: str,
    recommendation: dict[str, Any],
    knowledge_items: list[dict[str, Any]],
) -> tuple[str | None, dict[str, Any]]:
    if os.environ.get("GAOKAO_AI_ENABLE_REMOTE_MODEL", "1") != "1":
        return None, {"status": "disabled", "message": "Remote model disabled for fast public traffic."}
    api_key = prompt_workspace.load_minimax_api_key(AD_MACHINE_CONFIG_FILE)
    if not api_key:
        return None, {"status": "missing_key", "message": "未配置 MiniMax API Key。"}
    items = recommendation.get("items") or []
    inventory_context = "\n".join(
        [
            f"- {item.get('productName')}｜{item.get('category')}｜推荐理由：{item.get('fitSummary') or '适合作为当前方向的到店对比机型'}｜活动：{item.get('marketingSummary') or '到店核验当前活动'}"
            for item in items[:4]
        ]
    ) or "- 当前未筛到现货推荐，请根据需求继续 уточ细化。"
    knowledge_context = "\n".join(
        [
            f"- {normalize_gaokao_text(item.get('title'), 80)}：{normalize_gaokao_text(item.get('content'), 240)}"
            for item in knowledge_items[:6]
        ]
    ) or "- 当前没有额外知识条目，优先按现货与专业建议回答。"
    special_note = ""
    major_text = normalize_gaokao_text(major, 80)
    budget_text = normalize_gaokao_text(budget, 40)
    if any(keyword in major_text for keyword in ("文科", "经管", "师范", "法学")) and "9000" in budget_text:
        special_note = "补充规则：高预算文科路线优先把 YOGA 作为厂家重点轻薄方向推荐之一，可公开提及张凌赫同款路线、课堂通勤体验，以及到店重点核验更长意外保和服务权益。"
    if _is_gaokao_photo_request(message):
        special_note = (
            f"{special_note} 补充规则：AI 照片许愿和合影需求属于本次活动服务范围，"
            "严禁回答“没有这项服务”“暂不支持图片生成”之类的否定话术。"
            "你必须先引导客户按流程补充：参考照片、人物关系、场景背景、风格、服装姿态，以及是否同时需要电脑推荐；"
            "然后说明门店会在后续补充回复里继续跟进结果图和说明。"
        ).strip()
    prompt = (
        "你是联想门店高考活动顾问，只能围绕门店当前有货商品、专业选机建议、服务权益、教育补、三件套活动和 AI 照片许愿服务回答。"
        "回答要像门店导购，简洁、具体，不夸张承诺，不编造没有库存的型号。"
        "只用简体中文输出，不要输出思维链，不要输出<think>标签，不要使用英文标题，不要使用 Markdown 标题或表格。"
        "严禁输出违法违规、暴力、色情、仇恨、政治敏感、不当引导内容；严禁泄漏门店内部价格、成本、进货价、毛利、渠道策略或任何商业秘密。"
        "如果用户追问这些边界内容，只能礼貌拒绝并把话题拉回公开活动、机型方向和到店核验。\n"
        f"用户专业：{major or '未填写'}\n"
        f"用户预算：{budget or '未填写'}\n"
        f"当前推荐现货：\n{inventory_context}\n"
        f"可引用知识库：\n{knowledge_context}\n"
        f"{special_note}\n"
        f"用户问题：{message}\n"
        "请直接给建议，并在结尾引导用户继续补充更具体的需求。答案尽量控制在 4 到 6 句。"
    )
    body = {
        "model": "MiniMax-M3",
        "messages": [
            {"role": "system", "content": "你是联想体验店高考活动顾问。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.5,
    }
    endpoints = [
        "https://api.minimaxi.com/v1/chat/completions",
    ]
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    last_error = {"status": "failed", "message": "MiniMax 未返回可用内容。"}
    for endpoint in endpoints:
        req = urllib_request.Request(
            endpoint,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=60, context=MINIMAX_SSL_CONTEXT) as resp:
                raw = json.loads(resp.read().decode("utf-8", "ignore") or "{}")
        except Exception as error:
            if isinstance(error, urllib_error.HTTPError):
                detail_text = ""
                try:
                    detail_text = error.read().decode("utf-8", "ignore")
                except Exception:
                    detail_text = ""
                detail_json = {}
                try:
                    detail_json = json.loads(detail_text or "{}")
                except Exception:
                    detail_json = {}
                error_type = normalize_gaokao_text(((detail_json.get("error") or {}).get("type") if isinstance(detail_json, dict) else ""), 80)
                error_message = normalize_gaokao_text(((detail_json.get("error") or {}).get("message") if isinstance(detail_json, dict) else detail_text), 240)
                if error.code == 402 or error_type == "insufficient_balance_error":
                    last_error = {"status": "insufficient_balance", "message": error_message or "MiniMax 余额不足。", "endpoint": endpoint}
                    break
                elif error.code == 401:
                    last_error = {"status": "invalid_key", "message": error_message or "MiniMax API Key 无效。", "endpoint": endpoint}
                    break
                else:
                    last_error = {"status": f"http_{error.code}", "message": error_message or f"HTTP {error.code}", "endpoint": endpoint}
            else:
                last_error = {"status": "network_error", "message": f"{type(error).__name__}: {error}", "endpoint": endpoint}
            continue
        choices = raw.get("choices")
        if not isinstance(choices, list) or not choices:
            last_error = {"status": "empty_choices", "message": "MiniMax 未返回 choices。", "endpoint": endpoint}
            continue
        content = choices[0].get("message", {}).get("content")
        text = _normalize_gaokao_ai_reply_text(content, 2000)
        if not text:
            last_error = {"status": "empty_content", "message": "MiniMax 未返回文本。", "endpoint": endpoint}
            continue
        return text, {"status": "ok", "endpoint": endpoint}
    return None, last_error


def create_gaokao_ai_chat_reply(payload: Gaokao2026AiChatInput) -> dict[str, Any]:
    normalized_phone, session = _assert_gaokao_portal_session(payload.phone, payload.token)
    phone_hash = _gaokao_phone_hash(normalized_phone)
    boundary = check_gaokao_ai_boundary(payload.message)
    recommendation = recommend_gaokao_products(
        Gaokao2026RecommendationInput(
            phone=payload.phone,
            token=payload.token,
            major=payload.major,
            budget=payload.budget,
        )
    )
    knowledge = search_gaokao_ai_knowledge(payload.message, major=payload.major, budget=payload.budget, limit=6)
    safe_knowledge_items = sanitize_gaokao_customer_knowledge_items(knowledge.get("items") or [])
    if boundary:
        ai_text = str(boundary["reply"])
        meta = {"status": "blocked", "reason": boundary["reason"], "ruleKey": boundary["ruleKey"]}
    else:
        is_photo_request = _is_gaokao_photo_request(payload.message)
        ai_text, meta = request_gaokao_minimax_chat(
            payload.message,
            major=payload.major,
            budget=payload.budget,
            recommendation=recommendation,
            knowledge_items=safe_knowledge_items,
        )
        if not ai_text:
            ai_text = _gaokao_chat_fast_local_reply(
                payload.message,
                major=payload.major,
                budget=payload.budget,
                recommendation=recommendation,
                knowledge_items=safe_knowledge_items,
            )
            meta = {
                "status": "fallback",
                "message": "Fast local recommendation reply.",
                "fallbackReason": meta,
            }
        if is_photo_request:
            lowered_reply = normalize_gaokao_text(ai_text, 400).lower()
            deny_keywords = ("没有这项服务", "暂不支持", "不能生成", "无法生成", "不提供图片", "不能做")
            flow_keywords = ("参考照", "参考照片", "人物关系", "场景", "风格", "上传", "服装", "姿态")
            if not ai_text or any(keyword in lowered_reply for keyword in deny_keywords) or not any(keyword in lowered_reply for keyword in flow_keywords):
                ai_text = _gaokao_photo_request_flow_reply(
                    major=payload.major,
                    budget=payload.budget,
                    recommendation=recommendation,
                )
                meta = {
                    "status": "photo_flow_override",
                    "message": "Photo wish flow override applied.",
                    "fallbackReason": meta,
                }
    now = now_iso()
    message_id = f"gaokao-portal-message-{uuid.uuid4().hex[:12]}"
    with retail_core.connect() as conn:
        conn.execute(
            """
            INSERT INTO gaokao_2026_portal_message (
              id, phone_hash, phone, display_name, channel, topic, wish_tag, message,
              image_path, image_name, image_mime_type, metadata_json, reply_message, reply_payload_json,
              status, reply_by, replied_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'ai_chat', '天禧AI助理对话', '', ?, '', '', '', ?, ?, ?, 'ai_replied', ?, ?, ?, ?)
            """,
            (
                message_id,
                phone_hash,
                normalized_phone,
                str(session["display_name"] or ""),
                normalize_gaokao_text(payload.message, 1200),
                json.dumps({"major": payload.major, "budget": payload.budget}, ensure_ascii=False),
                ai_text,
                json.dumps(
                    {
                        "engine": "guardrail" if meta.get("status") == "blocked" else ("minimax" if meta.get("status") == "ok" else "fallback"),
                        "recommendation": recommendation,
                        "knowledgeSummary": {
                            "total": len(safe_knowledge_items),
                            "titles": _gaokao_chat_display_knowledge_titles(safe_knowledge_items),
                        },
                        "minimaxMeta": meta,
                    },
                    ensure_ascii=False,
                ),
                "安全边界助手" if meta.get("status") == "blocked" else ("天禧AI助理" if meta.get("status") == "ok" else "门店推荐助手"),
                now,
                now,
                now,
            ),
        )
    return {
        "ok": True,
        "replyMessage": ai_text,
        "replyBy": "天禧AI助理" if meta.get("status") != "blocked" else "安全边界助手",
        "engine": "guardrail" if meta.get("status") == "blocked" else ("minimax" if meta.get("status") == "ok" else "fallback"),
        "recommendation": recommendation,
        "knowledgeSummary": {
            "total": len(safe_knowledge_items),
            "titles": _gaokao_chat_display_knowledge_titles(safe_knowledge_items),
        },
        "minimaxMeta": meta,
        "updatedAt": now,
    }


def default_sales_ledger() -> dict[str, Any]:
    return {
        "updatedAt": now_iso(),
        "staff": [
            {"id": "EMP001", "name": "店长A", "role": "manager", "active": True},
            {"id": "EMP002", "name": "销售B", "role": "sales", "active": True},
        ],
        "salesOrders": [],
        "syncTasks": [],
    }


def load_sales_ledger() -> dict[str, Any]:
    if not LOCAL_LEDGER_FILE.exists():
        LOCAL_LEDGER_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = default_sales_ledger()
        LOCAL_LEDGER_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return data
    try:
        raw = json.loads(LOCAL_LEDGER_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=500,
            detail={"error": "sales_ledger_invalid_json", "message": str(error)},
        ) from error
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=500, detail={"error": "sales_ledger_invalid_shape"}
        )
    raw.setdefault("staff", [])
    raw.setdefault("salesOrders", [])
    raw.setdefault("syncTasks", [])
    raw["updatedAt"] = raw.get("updatedAt") or now_iso()
    return raw


def save_sales_ledger(payload: dict[str, Any]) -> None:
    payload["updatedAt"] = now_iso()
    LOCAL_LEDGER_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_LEDGER_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def default_ad_machine_runtime() -> dict[str, Any]:
    return {
        "updatedAt": now_iso(),
        "lotteryRecords": [],
        "leadSubmissions": [],
        "serviceTickets": [],
    }


def default_ad_machine_module_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": "gaming",
            "row": "top",
            "order": 1,
            "enabled": True,
            "title": "游戏本彩页",
            "subtitle": "拯救者",
            "type": "flyer",
            "src": "/ad-machine/flyer-gaming.html",
            "tone": "gaming",
            "displayMode": "flyer",
            "detail": "游戏本高库存主设备彩页页签。",
        },
        {
            "id": "thin",
            "row": "top",
            "order": 2,
            "enabled": True,
            "title": "轻薄本彩页",
            "subtitle": "小新 / YOGA",
            "type": "flyer",
            "src": "/ad-machine/flyer-thin-light.html",
            "tone": "thin-light",
            "displayMode": "flyer",
            "detail": "轻薄本和 YOGA 彩页页签。",
        },
        {
            "id": "tablet",
            "row": "top",
            "order": 3,
            "enabled": True,
            "title": "平板彩页",
            "subtitle": "小新 / Y700",
            "type": "flyer",
            "src": "/ad-machine/flyer-tablet.html",
            "tone": "tablet",
            "displayMode": "flyer",
            "detail": "平板设备展示彩页页签。",
        },
        {
            "id": "phone",
            "row": "top",
            "order": 4,
            "enabled": True,
            "title": "手机彩页",
            "subtitle": "MOTO",
            "type": "flyer",
            "src": "/ad-machine/flyer-phone.html",
            "tone": "phone",
            "displayMode": "flyer",
            "detail": "手机彩页页签。",
        },
        {
            "id": "serviceIntro",
            "row": "bottom",
            "order": 1,
            "enabled": True,
            "title": "全量服务",
            "subtitle": "门店服务流程与权益总览",
            "type": "module",
            "src": "/ad-machine/full-service.html",
            "tone": "gaming",
            "displayMode": "module",
            "detail": "全量服务英雄卡与服务介绍模块。",
        },
        {
            "id": "lottery",
            "row": "bottom",
            "order": 2,
            "enabled": True,
            "title": "购机抽奖",
            "subtitle": "抽奖、结果码、客户留资",
            "type": "module",
            "src": "/ad-machine/lottery.html",
            "tone": "gaming",
            "displayMode": "module",
            "detail": "抽奖、报名二维码、延保卡核销模块。",
        },
        {
            "id": "accessories",
            "row": "bottom",
            "order": 3,
            "enabled": True,
            "title": "配件秒杀",
            "subtitle": "配件活动页，按页切换展示",
            "type": "module",
            "src": "/ad-machine/accessory-flash-sale.html",
            "tone": "gaming",
            "displayMode": "module",
            "detail": "配件活动独立模块。",
        },
        {
            "id": "serviceQueue",
            "row": "bottom",
            "order": 4,
            "enabled": True,
            "title": "售后服务",
            "subtitle": "现场取号、叫号、等待区",
            "type": "module",
            "src": "/ad-machine/after-sales-pure.html",
            "tone": "gaming",
            "displayMode": "module",
            "detail": "售后排号、等待区与纯净售后服务模块。",
        },
        {
            "id": "serviceMonitor",
            "row": "bottom",
            "order": 5,
            "enabled": True,
            "title": "营销服务页",
            "subtitle": "数据巡检、刷新、修复",
            "type": "module",
            "src": "/ad-machine/service-monitor.html",
            "tone": "gaming",
            "displayMode": "module",
            "detail": "广告机数据巡检、运行修复和服务状态模块。",
        },
    ]


def default_ad_machine_service_catalog() -> list[dict[str, Any]]:
    return [
        {"id": "maintenance", "title": "保养服务", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-01.jpg"},
        {"id": "parts", "title": "配件更换", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-02.jpg"},
        {"id": "inWarranty", "title": "保内服务", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-03.jpg"},
        {"id": "outWarranty", "title": "保外服务", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-04.jpg"},
        {"id": "dataService", "title": "数据服务", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-05.jpg"},
        {"id": "warrantyQuery", "title": "质保查询", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-06.jpg"},
        {"id": "extendedWarranty", "title": "延保服务", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-07.jpg"},
        {"id": "pickup", "title": "取机核销", "thumb": "/ad-machine/after-sales-pure-assets-20260528h/thumb-08.jpg"},
    ]


def default_ad_machine_admin_config() -> dict[str, Any]:
    return {
        "updatedAt": now_iso(),
        "defaultTabId": "gaming",
        "autoRefreshIntervalMs": 1800000,
        "layout": {
            "navMode": "dual-row",
            "topRowLabel": "彩页专区",
            "bottomRowLabel": "功能模块",
            "authPinEnabled": True,
        },
        "lottery": {
            "showGaokaoVerify": True,
            "allowMockDraw": True,
            "qrRefreshSeconds": 30,
            "roundCardCount": 20,
        },
        "serviceQueue": {
            "showWaitingScreen": True,
            "queueMode": "runtime",
        },
        "modules": default_ad_machine_module_catalog(),
        "serviceCatalog": default_ad_machine_service_catalog(),
    }


def normalize_ad_machine_admin_modules(values: Any) -> list[dict[str, Any]]:
    defaults = {item["id"]: item for item in default_ad_machine_module_catalog()}
    normalized: list[dict[str, Any]] = []
    for item in values or []:
        if not isinstance(item, dict):
            continue
        module_id = normalize_gaokao_text(item.get("id"), 40)
        if not module_id or module_id not in defaults:
            continue
        base = dict(defaults[module_id])
        base.update(
            {
                "row": "bottom" if str(item.get("row") or base["row"]).strip().lower() == "bottom" else "top",
                "order": max(1, min(int(item.get("order") or base["order"]), 20)),
                "enabled": bool(item.get("enabled", base["enabled"])),
                "title": normalize_gaokao_text(item.get("title"), 40) or base["title"],
                "subtitle": normalize_gaokao_text(item.get("subtitle"), 80) or base["subtitle"],
                "src": normalize_gaokao_text(item.get("src"), 160) or base["src"],
                "tone": normalize_gaokao_text(item.get("tone"), 40) or base["tone"],
                "displayMode": normalize_gaokao_text(item.get("displayMode"), 20) or base["displayMode"],
                "detail": normalize_gaokao_text(item.get("detail"), 200) or base["detail"],
            }
        )
        normalized.append(base)
    for module_id, base in defaults.items():
        if module_id not in {item["id"] for item in normalized}:
            normalized.append(dict(base))
    normalized.sort(key=lambda item: (0 if item["row"] == "top" else 1, int(item["order"]), str(item["id"])))
    return normalized


def load_ad_machine_admin_config() -> dict[str, Any]:
    defaults = default_ad_machine_admin_config()
    if not AD_MACHINE_ADMIN_CONFIG_FILE.exists():
        AD_MACHINE_ADMIN_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        AD_MACHINE_ADMIN_CONFIG_FILE.write_text(json.dumps(defaults, ensure_ascii=False, indent=2), encoding="utf-8")
        return defaults
    try:
        raw = json.loads(AD_MACHINE_ADMIN_CONFIG_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    config = dict(defaults)
    config["defaultTabId"] = normalize_gaokao_text(raw.get("defaultTabId"), 40) or defaults["defaultTabId"]
    # AD_MACHINE_INTERVAL_MS 环境变量：优先级高于配置文件
    env_interval = os.environ.get("AD_MACHINE_INTERVAL_MS", "").strip()
    if env_interval:
        config["autoRefreshIntervalMs"] = max(5000, min(int(env_interval), 86400000))
    else:
        config["autoRefreshIntervalMs"] = max(5000, min(int(raw.get("autoRefreshIntervalMs") or defaults["autoRefreshIntervalMs"]), 86400000))
    config["layout"] = {
        **defaults["layout"],
        **(raw.get("layout") if isinstance(raw.get("layout"), dict) else {}),
    }
    config["lottery"] = {
        **defaults["lottery"],
        **(raw.get("lottery") if isinstance(raw.get("lottery"), dict) else {}),
    }
    config["serviceQueue"] = {
        **defaults["serviceQueue"],
        **(raw.get("serviceQueue") if isinstance(raw.get("serviceQueue"), dict) else {}),
    }
    config["modules"] = normalize_ad_machine_admin_modules(raw.get("modules") or defaults["modules"])
    config["serviceCatalog"] = default_ad_machine_service_catalog()
    config["updatedAt"] = str(raw.get("updatedAt") or defaults["updatedAt"])
    return config


def save_ad_machine_admin_config(config: dict[str, Any]) -> dict[str, Any]:
    next_payload = load_ad_machine_admin_config()
    next_payload.update(
        {
            "defaultTabId": normalize_gaokao_text(config.get("defaultTabId"), 40) or next_payload["defaultTabId"],
            "autoRefreshIntervalMs": max(5000, min(int(config.get("autoRefreshIntervalMs") or next_payload["autoRefreshIntervalMs"]), 86400000)),
            "layout": config.get("layout") if isinstance(config.get("layout"), dict) else next_payload["layout"],
            "lottery": config.get("lottery") if isinstance(config.get("lottery"), dict) else next_payload["lottery"],
            "serviceQueue": config.get("serviceQueue") if isinstance(config.get("serviceQueue"), dict) else next_payload["serviceQueue"],
            "modules": normalize_ad_machine_admin_modules(config.get("modules") or next_payload["modules"]),
            "serviceCatalog": default_ad_machine_service_catalog(),
            "updatedAt": now_iso(),
        }
    )
    valid_ids = {item["id"] for item in next_payload["modules"] if item.get("enabled")}
    if next_payload["defaultTabId"] not in valid_ids:
        next_payload["defaultTabId"] = next(iter(valid_ids), "gaming")
    AD_MACHINE_ADMIN_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    AD_MACHINE_ADMIN_CONFIG_FILE.write_text(json.dumps(next_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return next_payload


def update_ad_machine_admin_config(payload: AdMachineAdminConfigUpdateInput) -> dict[str, Any]:
    current = load_ad_machine_admin_config()
    merged = {
        **current,
        "defaultTabId": payload.defaultTabId or current["defaultTabId"],
        "autoRefreshIntervalMs": int(payload.autoRefreshIntervalMs or current["autoRefreshIntervalMs"]),
        "layout": {**current["layout"], **payload.layout},
        "lottery": {**current["lottery"], **payload.lottery},
        "serviceQueue": {**current["serviceQueue"], **payload.serviceQueue},
        "modules": payload.modules or current["modules"],
    }
    if str(payload.lotteryLanBaseUrl or "").strip():
        save_lottery_lan_base_url(payload.lotteryLanBaseUrl)
    saved = save_ad_machine_admin_config(merged)
    return {"ok": True, "config": saved, "lotteryLanBaseUrl": str(load_ad_machine_local_config().get("lotteryLanBaseUrl") or ""), "updatedAt": saved["updatedAt"]}


def ad_machine_runtime_summary(runtime: dict[str, Any]) -> dict[str, Any]:
    tickets = runtime.get("serviceTickets", [])
    leads = runtime.get("leadSubmissions", [])
    return {
        "serviceTicketCount": len(tickets) if isinstance(tickets, list) else 0,
        "waitingTicketCount": len([item for item in tickets if isinstance(item, dict) and str(item.get("status") or "") == "waiting"]) if isinstance(tickets, list) else 0,
        "leadSubmissionCount": len(leads) if isinstance(leads, list) else 0,
        "updatedAt": str(runtime.get("updatedAt") or ""),
    }


def load_ad_machine_runtime() -> dict[str, Any]:
    if not AD_MACHINE_FILE.exists():
        AD_MACHINE_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = default_ad_machine_runtime()
        AD_MACHINE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload
    try:
        raw = json.loads(AD_MACHINE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=500, detail={"error": "ad_machine_runtime_invalid_json", "message": str(error)}) from error
    if not isinstance(raw, dict):
        raise HTTPException(status_code=500, detail={"error": "ad_machine_runtime_invalid_shape"})
    raw.setdefault("lotteryRecords", [])
    raw.setdefault("leadSubmissions", [])
    raw.setdefault("serviceTickets", [])
    raw["updatedAt"] = raw.get("updatedAt") or now_iso()
    return raw


def save_ad_machine_runtime(payload: dict[str, Any]) -> None:
    payload["updatedAt"] = now_iso()
    AD_MACHINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    AD_MACHINE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def lottery_connect() -> sqlite3.Connection:
    AD_MACHINE_LOTTERY_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(AD_MACHINE_LOTTERY_DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_lottery_db() -> None:
    with lottery_connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS lottery_campaign (
              id TEXT PRIMARY KEY,
              campaign_code TEXT NOT NULL UNIQUE,
              campaign_name TEXT NOT NULL,
              start_at TEXT NOT NULL,
              end_at TEXT NOT NULL,
              status TEXT NOT NULL,
              store_id TEXT NOT NULL DEFAULT 'LENOVO-SR-001',
              store_name TEXT NOT NULL DEFAULT '联想体验店（新野县书院路）',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lottery_pool_round (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              round_no INTEGER NOT NULL,
              total_count INTEGER NOT NULL,
              remaining_count INTEGER NOT NULL,
              status TEXT NOT NULL,
              high_value_draw_count INTEGER NOT NULL DEFAULT 0,
              opened_at TEXT NOT NULL,
              closed_at TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(campaign_id, round_no)
            );

            CREATE TABLE IF NOT EXISTS lottery_pool_item (
              id TEXT PRIMARY KEY,
              round_id TEXT NOT NULL,
              prize_code TEXT NOT NULL,
              prize_name TEXT NOT NULL,
              service_years INTEGER NOT NULL,
              face_value INTEGER NOT NULL,
              tier TEXT NOT NULL,
              status TEXT NOT NULL,
              draw_record_id TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lottery_participant (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              customer_name TEXT NOT NULL,
              masked_name TEXT NOT NULL,
              phone TEXT NOT NULL,
              product_model TEXT NOT NULL,
              sku_key TEXT NOT NULL DEFAULT '',
              serial_number TEXT NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              entry_type TEXT NOT NULL,
              status TEXT NOT NULL,
              inventory_match_status TEXT NOT NULL DEFAULT 'unmatched',
              order_match_status TEXT NOT NULL DEFAULT 'unmatched',
              order_no TEXT NOT NULL DEFAULT '',
              store_retail_price REAL NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_participant_serial_formal
              ON lottery_participant(serial_number, entry_type);

            CREATE TABLE IF NOT EXISTS lottery_draw_record (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              round_id TEXT NOT NULL DEFAULT '',
              participant_id TEXT NOT NULL DEFAULT '',
              entry_type TEXT NOT NULL,
              serial_number TEXT NOT NULL DEFAULT '',
              product_model TEXT NOT NULL DEFAULT '',
              sku_key TEXT NOT NULL DEFAULT '',
              price_band TEXT NOT NULL DEFAULT '',
              prize_code TEXT NOT NULL,
              prize_name TEXT NOT NULL,
              service_years INTEGER NOT NULL DEFAULT 0,
              face_value INTEGER NOT NULL DEFAULT 0,
              result_code TEXT NOT NULL,
              inventory_match_status TEXT NOT NULL DEFAULT 'unmatched',
              order_match_status TEXT NOT NULL DEFAULT 'unmatched',
              customer_name TEXT NOT NULL DEFAULT '',
              masked_name TEXT NOT NULL DEFAULT '',
              phone TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lottery_public_feed (
              id TEXT PRIMARY KEY,
              draw_record_id TEXT NOT NULL,
              campaign_id TEXT NOT NULL,
              masked_name TEXT NOT NULL,
              product_model TEXT NOT NULL,
              prize_name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lottery_event_log (
              id TEXT PRIMARY KEY,
              event_type TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """
        )
        ensure_default_lottery_campaign(conn)
        conn.commit()


def ensure_default_lottery_campaign(conn: sqlite3.Connection) -> None:
    now = now_iso()
    campaign = conn.execute(
        """
        SELECT id, campaign_code
        FROM lottery_campaign
        WHERE status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
        """
    ).fetchone()
    if campaign:
        total_rounds = conn.execute(
            "SELECT COUNT(*) AS total_count FROM lottery_pool_round WHERE campaign_id = ?",
            (str(campaign["id"]),),
        ).fetchone()
        if int(total_rounds["total_count"] or 0) <= 0:
            create_lottery_round(conn, str(campaign["id"]), 1)
        return
    campaign_id = "lottery-campaign-main"
    conn.execute(
        """
        INSERT OR REPLACE INTO lottery_campaign
        (id, campaign_code, campaign_name, start_at, end_at, status, store_id, store_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', 'LENOVO-SR-001', '联想体验店（新野县书院路）', ?, ?)
        """,
        (
            campaign_id,
            "AD-MACHINE-LOTTERY",
            "联想智惠幸运大转盘",
            "2026-05-27T00:00:00+08:00",
            "2026-12-31T23:59:59+08:00",
            now,
            now,
        ),
    )
    create_lottery_round(conn, campaign_id, 1)


def create_lottery_round(conn: sqlite3.Connection, campaign_id: str, round_no: int) -> str:
    now = now_iso()
    round_id = f"round-{campaign_id}-{round_no}"
    conn.execute(
        """
        INSERT INTO lottery_pool_round
        (id, campaign_id, round_no, total_count, remaining_count, status, high_value_draw_count, opened_at, closed_at, created_at, updated_at)
        VALUES (?, ?, ?, 20, 20, 'active', 0, ?, '', ?, ?)
        """,
        (round_id, campaign_id, round_no, now, now, now),
    )
    item_defs = [
        ("CARE-3Y", "Lenovo Care 智惠三年", 3, 399, "rare", 15),
        ("CARE-4Y", "Lenovo Care 智惠四年", 4, 599, "epic", 3),
        ("CARE-5Y", "Lenovo Care 智惠五年", 5, 869, "legendary", 2),
    ]
    for prize_code, prize_name, service_years, face_value, tier, count in item_defs:
        for index in range(count):
            item_id = f"{round_id}-{prize_code}-{index + 1:02d}"
            conn.execute(
                """
                INSERT INTO lottery_pool_item
                (id, round_id, prize_code, prize_name, service_years, face_value, tier, status, draw_record_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'available', '', ?, ?)
                """,
                (item_id, round_id, prize_code, prize_name, service_years, face_value, tier, now, now),
            )
    return round_id


def ensure_active_lottery_round(conn: sqlite3.Connection, campaign_id: str) -> str:
    active = conn.execute(
        """
        SELECT id
        FROM lottery_pool_round
        WHERE campaign_id = ? AND status = 'active'
        ORDER BY round_no DESC
        LIMIT 1
        """,
        (campaign_id,),
    ).fetchone()
    if active:
        return str(active["id"])
    latest = conn.execute(
        "SELECT COALESCE(MAX(round_no), 0) AS max_round FROM lottery_pool_round WHERE campaign_id = ?",
        (campaign_id,),
    ).fetchone()
    next_round = int(latest["max_round"] or 0) + 1 if latest else 1
    return create_lottery_round(conn, campaign_id, next_round)


def active_lottery_round_row(conn: sqlite3.Connection, campaign_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT *
        FROM lottery_pool_round
        WHERE campaign_id = ? AND status = 'active'
        ORDER BY round_no DESC
        LIMIT 1
        """,
        (campaign_id,),
    ).fetchone()


def latest_lottery_round_row(conn: sqlite3.Connection, campaign_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT *
        FROM lottery_pool_round
        WHERE campaign_id = ?
        ORDER BY round_no DESC
        LIMIT 1
        """,
        (campaign_id,),
    ).fetchone()


def current_lottery_campaign(conn: sqlite3.Connection) -> sqlite3.Row:
    campaign = conn.execute(
        """
        SELECT *
        FROM lottery_campaign
        WHERE status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
        """
    ).fetchone()
    if not campaign:
        ensure_default_lottery_campaign(conn)
        campaign = conn.execute(
            "SELECT * FROM lottery_campaign WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
    if not campaign:
        raise HTTPException(status_code=500, detail={"error": "lottery_campaign_missing"})
    return campaign


def mask_customer_name(name: str) -> str:
    normalized = str(name or "").strip()
    if not normalized:
        return "客*"
    return f"{normalized[:1]}*"


def is_lan_host(host: str) -> bool:
    normalized = str(host or "").split(":", 1)[0].strip().lower()
    if normalized in {"localhost", "127.0.0.1"}:
        return True
    if normalized.startswith("192.168.") or normalized.startswith("10."):
        return True
    if normalized.startswith("172."):
        parts = normalized.split(".")
        if len(parts) > 1:
            try:
                second = int(parts[1])
            except ValueError:
                second = -1
            if 16 <= second <= 31:
                return True
    return False


def is_allowed_lottery_host(host: str) -> bool:
    normalized = str(host or "").split(":", 1)[0].strip().lower()
    if not normalized:
        return False
    config = load_ad_machine_local_config()
    configured_base = str(config.get("lotteryLanBaseUrl") or "").strip()
    configured_host = urlparse(configured_base).hostname if configured_base else ""
    allowed_hosts = {
        "ad.tianlu2026.org",
        str(configured_host or "").strip().lower(),
    }
    return normalized in {item for item in allowed_hosts if item}


def assert_lan_request(request: Request) -> None:
    host = request.headers.get("host", "")
    if not is_lan_host(host) and not is_allowed_lottery_host(host):
        raise HTTPException(
            status_code=403,
            detail={"error": "lottery_host_not_allowed", "message": "该填写页面仅允许店内局域网或已配置广告机域名访问。"},
        )


def load_projection_items() -> list[dict[str, Any]]:
    payload = load_snapshot_from_sql_cache("latest-published-product-projection.json")
    items = payload.get("items", [])
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


PROJECTION_INDEX_CACHE: dict[str, Any] = {
    "signature": "",
    "items": [],
    "bySku": {},
}


def load_projection_index() -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    projection_path = DATA_DIR / "latest-published-product-projection.json"
    signature = _file_signature(projection_path)
    cached_signature = str(PROJECTION_INDEX_CACHE.get("signature") or "")
    cached_items = PROJECTION_INDEX_CACHE.get("items")
    cached_map = PROJECTION_INDEX_CACHE.get("bySku")
    if cached_signature == signature and isinstance(cached_items, list) and isinstance(cached_map, dict) and cached_map:
        return cached_items, cached_map
    items = load_projection_items()
    by_sku: dict[str, dict[str, Any]] = {}
    for item in items:
        sku_key = str(item.get("skuKey") or "").strip()
        if sku_key and sku_key not in by_sku:
            by_sku[sku_key] = item
    PROJECTION_INDEX_CACHE["signature"] = signature
    PROJECTION_INDEX_CACHE["items"] = items
    PROJECTION_INDEX_CACHE["bySku"] = by_sku
    return items, by_sku


def build_lottery_product_options(limit: int = 400) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    projection_items, _ = load_projection_index()
    for item in projection_items:
        try:
            current_stock = int(item.get("currentStock") or 0)
            sellable_stock = int(item.get("sellableStock") or 0)
        except (TypeError, ValueError):
            current_stock = 0
            sellable_stock = 0
        sku_key = str(item.get("skuKey") or "").strip()
        display_title = str(item.get("displayTitle") or item.get("productName") or "").strip()
        if not sku_key or not display_title:
            continue
        pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
        rows.append(
            {
                "skuKey": sku_key,
                "productModel": display_title,
                "category": str(item.get("category") or ""),
                "sourceCategory": str(item.get("sourceCategory") or ""),
                "pnMtm": str(item.get("pnMtm") or ""),
                "currentStock": current_stock,
                "sellableStock": sellable_stock,
                "storeRetailPrice": float(pricing.get("storeRetailPrice") or 0),
                "finalPrice": float(pricing.get("finalPrice") or 0),
            }
        )
    rows.sort(key=lambda row: (-int(row["sellableStock"]), -float(row["storeRetailPrice"]), row["productModel"]))
    return rows[:limit]


def public_lottery_product_option(item: dict[str, Any]) -> dict[str, str]:
    return {
        "skuKey": str(item.get("skuKey") or ""),
        "productModel": str(item.get("productModel") or ""),
        "pnMtm": str(item.get("pnMtm") or ""),
        "productCode": str(item.get("productCode") or ""),
    }


def build_lottery_entry_url() -> str:
    config = load_ad_machine_local_config()
    base = str(config.get("lotteryLanBaseUrl") or "http://192.168.13.104:5174").strip().rstrip("/")
    return f"{base}/ad-machine/lottery-entry.html"


def save_lottery_lan_base_url(base_url: str) -> dict[str, str]:
    normalized = str(base_url or "").strip().rstrip("/")
    if not re.match(r"^https?://[^/]+", normalized):
        raise HTTPException(status_code=400, detail={"error": "invalid_base_url", "message": "广告机域名必须以 http:// 或 https:// 开头。"})
    config = load_ad_machine_local_config()
    config["lotteryLanBaseUrl"] = normalized
    AD_MACHINE_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    ordered_keys = ("minimaxApiKey", "voiceProvider", "minimaxVoiceId", "lotteryLanBaseUrl")
    lines = ["window.__AD_MACHINE_LOCAL_CONFIG__ = {"]
    for index, key in enumerate(ordered_keys):
        value = str(config.get(key) or "")
        escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        comma = "," if index < len(ordered_keys) - 1 else ""
        lines.append(f"  {key}: '{escaped}'{comma}")
    lines.append("}")
    AD_MACHINE_CONFIG_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return config


def generate_qr_png_bytes(value: str) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=12,
        border=2,
    )
    qr.add_data(value)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#1a0708", back_color="white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def find_projection_by_sku(sku_key: str) -> dict[str, Any] | None:
    normalized = str(sku_key or "").strip()
    if not normalized:
        return None
    _, by_sku = load_projection_index()
    item = by_sku.get(normalized)
    return item if isinstance(item, dict) else None


def serial_snapshot_by_number(serial_number: str) -> dict[str, Any] | None:
    normalized = str(serial_number or "").strip().upper()
    if not normalized:
        return None
    payload = retail_core.list_serial_items(limit=5000)
    items = payload.get("items", []) if isinstance(payload, dict) else []
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict) and str(item.get("serial_number") or "").strip().upper() == normalized:
            return item
    return None


def detect_order_for_serial(serial_number: str, sku_key: str) -> str:
    normalized_serial = str(serial_number or "").strip().upper()
    normalized_sku = str(sku_key or "").strip()
    if not normalized_serial and not normalized_sku:
        return ""
    movement_payload = retail_core.list_inventory_movements(page_size=5000)
    items = movement_payload.get("items", []) if isinstance(movement_payload, dict) else []
    if not isinstance(items, list):
        return ""
    for item in items:
        if not isinstance(item, dict):
            continue
        source_ref = str(item.get("source_ref") or item.get("documentNumber") or "").strip()
        movement_type = str(item.get("movement_type") or item.get("movementType") or "").strip()
        movement_serial = str(item.get("serial_number") or item.get("serialNumber") or "").strip().upper()
        movement_sku = str(item.get("sku_key") or item.get("skuKey") or "").strip()
        if movement_type != "sales_outbound":
            continue
        if normalized_serial and movement_serial == normalized_serial:
            return source_ref
        if not normalized_serial and normalized_sku and movement_sku == normalized_sku:
            return source_ref
    return ""


def normalize_serial_number(serial_number: str) -> str:
    return re.sub(r"[^A-Za-z0-9-]", "", str(serial_number or "").upper())


def normalize_product_reference_code(reference_code: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(reference_code or "").upper())


def ensure_serial_number_format(serial_number: str) -> str:
    normalized = normalize_serial_number(serial_number)
    if len(normalized) < 6:
        raise HTTPException(status_code=400, detail={"error": "serial_invalid", "message": "SN 格式不正确。"})
    return normalized


def resolve_lottery_product_by_serial(serial_number: str, sku_key_hint: str = "", product_model_hint: str = "") -> dict[str, Any]:
    normalized_serial = ensure_serial_number_format(serial_number)
    serial_item = serial_snapshot_by_number(normalized_serial)
    resolved_sku_key = str(sku_key_hint or "").strip()
    resolved_product_model = str(product_model_hint or "").strip()
    projection = find_projection_by_sku(resolved_sku_key) if resolved_sku_key else None

    if serial_item:
        serial_sku_key = str(serial_item.get("sku_key") or serial_item.get("skuKey") or "").strip()
        if serial_sku_key:
            resolved_sku_key = serial_sku_key
            projection = find_projection_by_sku(serial_sku_key)
        if not resolved_product_model:
            resolved_product_model = (
                str((projection or {}).get("displayTitle") or "").strip()
                or str((projection or {}).get("productName") or "").strip()
                or str(serial_item.get("product_name") or serial_item.get("productName") or "").strip()
                or str(serial_item.get("spec") or "").strip()
            )

    if not projection and resolved_product_model:
        for item in build_lottery_product_options(limit=500):
            if str(item.get("productModel") or "").strip() == resolved_product_model:
                resolved_sku_key = str(item.get("skuKey") or "").strip()
                projection = find_projection_by_sku(resolved_sku_key)
                break

    if not resolved_product_model and projection:
        resolved_product_model = str(projection.get("displayTitle") or projection.get("productName") or "").strip()

    if not resolved_product_model:
        resolved_product_model = "SN未匹配机型，待店员复核"

    return {
        "serialNumber": normalized_serial,
        "serialItem": serial_item,
        "skuKey": resolved_sku_key,
        "productModel": resolved_product_model,
        "projection": projection,
        "inventoryMatchStatus": "matched" if serial_item else "unmatched",
    }


LOTTERY_REFERENCE_CACHE: dict[str, Any] = {
    "signature": "",
    "index": {},
}


def _file_signature(path: Path) -> str:
    if not path.exists():
        return "missing"
    stat = path.stat()
    return f"{int(stat.st_mtime_ns)}:{stat.st_size}"


def _extract_reference_values(node: Any, key_names: set[str]) -> list[str]:
    values: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                if key in key_names:
                    normalized = str(nested or "").strip()
                    if normalized:
                        values.append(normalized)
                walk(nested)
            return
        if isinstance(value, list):
            for nested in value:
                walk(nested)

    walk(node)
    return values


def _append_reference_value(bucket: list[str], value: Any) -> None:
    normalized = str(value or "").strip()
    if normalized:
        bucket.append(normalized)


def _select_lottery_reference_entry(index: dict[str, dict[str, Any]], code: str, candidate: dict[str, Any]) -> None:
    normalized_code = normalize_product_reference_code(code)
    if not normalized_code:
        return
    existing = index.get(normalized_code)
    if not existing:
        index[normalized_code] = candidate
        return
    existing_score = int(existing.get("_priority") or 0)
    candidate_score = int(candidate.get("_priority") or 0)
    if candidate_score > existing_score:
        index[normalized_code] = candidate


def build_lottery_reference_index() -> dict[str, dict[str, Any]]:
    inventory_path = DATA_DIR / "latest-inventory-master-snapshot.json"
    projection_path = DATA_DIR / "latest-published-product-projection.json"
    reference_index_path = DATA_DIR / "latest-lottery-product-reference-index.json"
    signature = "|".join(
        [
            _file_signature(inventory_path),
            _file_signature(projection_path),
            _file_signature(reference_index_path),
        ]
    )
    cached_signature = str(LOTTERY_REFERENCE_CACHE.get("signature") or "")
    cached_index = LOTTERY_REFERENCE_CACHE.get("index")
    if cached_signature == signature and isinstance(cached_index, dict) and cached_index:
        return cached_index

    index: dict[str, dict[str, Any]] = {}

    inventory_items = snapshot_items(load_snapshot_from_sql_cache("latest-inventory-master-snapshot.json"), "items")
    for item in inventory_items:
        sku_key = str(item.get("skuKey") or item.get("sku_key") or "").strip()
        projection = find_projection_by_sku(sku_key) if sku_key else None
        product_model = (
            str((projection or {}).get("displayTitle") or "").strip()
            or str(item.get("productName") or item.get("product_name") or "").strip()
            or str((projection or {}).get("productName") or "").strip()
        )
        candidate = {
            "skuKey": sku_key,
            "productModel": product_model,
            "pnMtm": str(item.get("pnMtm") or item.get("pn_mtm") or "").strip(),
            "productCode": str(item.get("productCode") or item.get("product_code") or "").strip(),
            "barcode": "",
            "projection": projection,
            "inventoryMatchStatus": "matched",
            "_priority": 30,
        }
        for code in (candidate["pnMtm"], candidate["productCode"]):
            _select_lottery_reference_entry(index, code, candidate)

    try:
        reference_snapshot = load_json_snapshot("latest-lottery-product-reference-index.json")
        reference_items = snapshot_items(reference_snapshot, "items")
    except HTTPException:
        reference_items = []
    for item in reference_items:
        sku_key = str(item.get("skuKey") or item.get("sku_key") or "").strip()
        projection = find_projection_by_sku(sku_key) if sku_key else None
        candidate = {
            "skuKey": sku_key,
            "productModel": (
                str((projection or {}).get("displayTitle") or "").strip()
                or str(item.get("productModel") or item.get("canonicalName") or "").strip()
            ),
            "pnMtm": str(item.get("pnMtm") or item.get("pn_mtm") or "").strip(),
            "productCode": str(item.get("productCode") or item.get("product_code") or "").strip(),
            "barcode": str(item.get("barcode") or "").strip(),
            "projection": projection,
            "inventoryMatchStatus": str(item.get("inventoryMatchStatus") or ("catalog_matched" if projection else "unmatched")),
            "_priority": 18 if projection else 8,
        }
        for code in (candidate["pnMtm"], candidate["productCode"], candidate["barcode"]):
            _select_lottery_reference_entry(index, code, candidate)

    LOTTERY_REFERENCE_CACHE["signature"] = signature
    LOTTERY_REFERENCE_CACHE["index"] = index
    return index


def resolve_lottery_product_by_reference(reference_code: str) -> dict[str, Any]:
    normalized_reference = normalize_product_reference_code(reference_code)
    if len(normalized_reference) < 4:
        raise HTTPException(status_code=400, detail={"error": "reference_invalid", "message": "MTM/PN 或 69 码格式不正确。"})
    candidate = build_lottery_reference_index().get(normalized_reference)
    if candidate:
        projection = candidate.get("projection") if isinstance(candidate.get("projection"), dict) else None
        return {
            "referenceCode": normalized_reference,
            "skuKey": str(candidate.get("skuKey") or ""),
            "productModel": str(candidate.get("productModel") or ""),
            "pnMtm": str(candidate.get("pnMtm") or ""),
            "productCode": str(candidate.get("productCode") or ""),
            "barcode": str(candidate.get("barcode") or ""),
            "projection": projection,
            "inventoryMatchStatus": str(candidate.get("inventoryMatchStatus") or "catalog_matched"),
        }

    options = build_lottery_product_options(limit=1200)
    for item in options:
        pn_mtm = normalize_product_reference_code(str(item.get("pnMtm") or ""))
        if pn_mtm and pn_mtm == normalized_reference:
            projection = find_projection_by_sku(str(item.get("skuKey") or "").strip())
            return {
                "referenceCode": normalized_reference,
                "skuKey": str(item.get("skuKey") or ""),
                "productModel": str(item.get("productModel") or ""),
                "pnMtm": str(item.get("pnMtm") or ""),
                "productCode": "",
                "barcode": "",
                "projection": projection,
                "inventoryMatchStatus": "projection_matched",
            }

    return {
        "referenceCode": normalized_reference,
        "skuKey": "",
        "productModel": "未匹配到产品型号，待店员复核",
        "pnMtm": "",
        "productCode": "",
        "barcode": "",
        "projection": None,
        "inventoryMatchStatus": "unmatched",
    }


def current_lottery_round_payload(conn: sqlite3.Connection, campaign_id: str) -> dict[str, Any]:
    round_row = active_lottery_round_row(conn, campaign_id)
    if not round_row:
        round_row = latest_lottery_round_row(conn, campaign_id)
    if not round_row:
        raise HTTPException(status_code=500, detail={"error": "lottery_round_missing"})
    counts = conn.execute(
        """
        SELECT prize_code, prize_name, service_years, face_value, tier, COUNT(*) AS count
        FROM lottery_pool_item
        WHERE round_id = ? AND status = 'available'
        GROUP BY prize_code, prize_name, service_years, face_value, tier
        ORDER BY service_years ASC
        """,
        (str(round_row["id"]),),
    ).fetchall()
    return {
        "id": str(round_row["id"]),
        "roundNo": int(round_row["round_no"]),
        "totalCount": int(round_row["total_count"]),
        "remainingCount": int(round_row["remaining_count"]),
        "status": str(round_row["status"]),
        "highValueDrawCount": int(round_row["high_value_draw_count"]),
        "openedAt": str(round_row["opened_at"]),
        "closedAt": str(round_row["closed_at"]),
        "canOpenNextRound": str(round_row["status"]) != "active" and int(round_row["remaining_count"]) <= 0,
        "cards": [
            {
                "prizeCode": str(row["prize_code"]),
                "prizeName": str(row["prize_name"]),
                "serviceYears": int(row["service_years"]),
                "faceValue": int(row["face_value"]),
                "tier": str(row["tier"]),
                "remainingCount": int(row["count"]),
            }
            for row in counts
        ],
    }


def lottery_asset_key(display_index: int) -> str:
    return f"pool-card-{int(display_index):02d}"


def lottery_layout_for_pool_item(conn: sqlite3.Connection, round_id: str, item_row: sqlite3.Row) -> dict[str, Any]:
    tier = str(item_row["tier"] or "rare")
    tier_rows = conn.execute(
        """
        SELECT id
        FROM lottery_pool_item
        WHERE round_id = ? AND tier = ?
        ORDER BY id ASC
        """,
        (round_id, tier),
    ).fetchall()
    tier_layout = LOTTERY_LAYOUT_BY_TIER.get(tier) or LOTTERY_LAYOUT_BY_TIER["rare"]
    for index, row in enumerate(tier_rows):
        if str(row["id"]) != str(item_row["id"]):
            continue
        slot = tier_layout[min(index, len(tier_layout) - 1)]
        return {
            "displayIndex": int(slot["displayIndex"]),
            "sectorIndex": int(slot["sectorIndex"]),
            "assetKey": lottery_asset_key(int(slot["displayIndex"])),
            "tierSerial": index + 1,
            "tierTotal": len(tier_layout),
            "tierName": str(slot["tierName"]),
            "label": str(slot["label"]),
        }
    fallback = tier_layout[0]
    return {
        "displayIndex": int(fallback["displayIndex"]),
        "sectorIndex": int(fallback["sectorIndex"]),
        "assetKey": lottery_asset_key(int(fallback["displayIndex"])),
        "tierSerial": 1,
        "tierTotal": len(tier_layout),
        "tierName": str(fallback["tierName"]),
        "label": str(fallback["label"]),
    }


def lottery_layout_for_mock_tier(tier: str) -> dict[str, Any]:
    tier_layout = LOTTERY_LAYOUT_BY_TIER.get(str(tier or "rare")) or LOTTERY_LAYOUT_BY_TIER["rare"]
    slot = random.choice(tier_layout)
    serial_in_tier = next(
        (index + 1 for index, item in enumerate(tier_layout) if int(item["displayIndex"]) == int(slot["displayIndex"])),
        1,
    )
    return {
        "displayIndex": int(slot["displayIndex"]),
        "sectorIndex": int(slot["sectorIndex"]),
        "assetKey": lottery_asset_key(int(slot["displayIndex"])),
        "tierSerial": serial_in_tier,
        "tierTotal": len(tier_layout),
        "tierName": str(slot["tierName"]),
        "label": str(slot["label"]),
    }


def choose_available_pool_item(conn: sqlite3.Connection, round_id: str, high_value: bool) -> sqlite3.Row:
    available = [
        row
        for row in conn.execute(
            """
            SELECT *
            FROM lottery_pool_item
            WHERE round_id = ? AND status = 'available'
            ORDER BY service_years DESC, face_value DESC, id ASC
            """,
            (round_id,),
        ).fetchall()
    ]
    if not available:
        raise HTTPException(status_code=409, detail={"error": "lottery_pool_empty", "message": "当前奖池已抽完。"})
    if not high_value:
        random.shuffle(available)
        available.sort(key=lambda row: (0 if int(row["service_years"]) == 3 else 1, row["id"]))
        return available[0]
    round_row = conn.execute("SELECT high_value_draw_count FROM lottery_pool_round WHERE id = ?", (round_id,)).fetchone()
    high_value_count = int(round_row["high_value_draw_count"] or 0) if round_row else 0
    preferred_years = [4, 3]
    if (high_value_count + 1) % 3 == 0:
        preferred_years = [5, 4, 3]
    for year in preferred_years:
        for row in available:
            if int(row["service_years"]) == year:
                return row
    return available[0]


def build_lottery_dashboard(conn: sqlite3.Connection) -> dict[str, Any]:
    campaign = current_lottery_campaign(conn)
    round_payload = current_lottery_round_payload(conn, str(campaign["id"]))
    pending = conn.execute(
        """
        SELECT *
        FROM lottery_participant
        WHERE campaign_id = ? AND entry_type = 'formal' AND status = 'eligible'
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (str(campaign["id"]),),
    ).fetchone()
    feed_rows = conn.execute(
        """
        SELECT masked_name, product_model, prize_name, created_at
        FROM lottery_public_feed
        WHERE campaign_id = ?
        ORDER BY created_at DESC
        LIMIT 20
        """,
        (str(campaign["id"]),),
    ).fetchall()
    participant_count_row = conn.execute(
        """
        SELECT
          SUM(CASE WHEN entry_type = 'formal' THEN 1 ELSE 0 END) AS formal_count,
          SUM(CASE WHEN entry_type = 'mock' THEN 1 ELSE 0 END) AS mock_count
        FROM lottery_participant
        WHERE campaign_id = ?
        """,
        (str(campaign["id"]),),
    ).fetchone()
    latest_draw = conn.execute(
        """
        SELECT masked_name, customer_name, product_model, prize_name, service_years, face_value, entry_type, created_at
        FROM lottery_draw_record
        WHERE campaign_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (str(campaign["id"]),),
    ).fetchone()
    public_feed = [
        {
            "maskedName": str(row["masked_name"]),
            "productModel": str(row["product_model"]),
            "prizeName": str(row["prize_name"]),
            "createdAt": str(row["created_at"]),
        }
        for row in feed_rows
    ]
    return {
        "campaign": {
            "id": str(campaign["id"]),
            "code": str(campaign["campaign_code"]),
            "name": str(campaign["campaign_name"]),
            "storeName": str(campaign["store_name"]),
            "startAt": str(campaign["start_at"]),
            "endAt": str(campaign["end_at"]),
        },
        "round": round_payload,
        "participantSummary": {
            "formalCount": int(participant_count_row["formal_count"] or 0) if participant_count_row else 0,
            "mockCount": int(participant_count_row["mock_count"] or 0) if participant_count_row else 0,
            "totalCount": int((participant_count_row["formal_count"] or 0) + (participant_count_row["mock_count"] or 0)) if participant_count_row else 0,
        },
        "pendingParticipant": (
            {
                "id": str(pending["id"]),
                "customerName": str(pending["customer_name"]),
                "maskedName": str(pending["masked_name"]),
                "phone": str(pending["phone"]),
                "productModel": str(pending["product_model"]),
                "skuKey": str(pending["sku_key"]),
                "serialNumber": str(pending["serial_number"]),
                "inventoryMatchStatus": str(pending["inventory_match_status"]),
                "orderMatchStatus": str(pending["order_match_status"]),
                "createdAt": str(pending["created_at"]),
            }
            if pending
            else None
        ),
        "publicFeed": public_feed,
        "recentFeed": public_feed,
        "latestDraw": (
            {
                "maskedName": str(latest_draw["masked_name"]),
                "customerName": str(latest_draw["customer_name"]),
                "productModel": str(latest_draw["product_model"]),
                "prize": str(latest_draw["prize_name"]),
                "serviceYears": int(latest_draw["service_years"] or 0),
                "faceValue": int(latest_draw["face_value"] or 0),
                "level": "正式抽奖" if str(latest_draw["entry_type"]) == "formal" else "模拟抽奖",
                "createdAt": str(latest_draw["created_at"]),
            }
            if latest_draw
            else None
        ),
    }


def build_lottery_record_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "entryType": str(row["entry_type"]),
        "serialNumber": str(row["serial_number"]),
        "productModel": str(row["product_model"]),
        "skuKey": str(row["sku_key"]),
        "priceBand": str(row["price_band"]),
        "prizeCode": str(row["prize_code"]),
        "prizeName": str(row["prize_name"]),
        "serviceYears": int(row["service_years"] or 0),
        "faceValue": int(row["face_value"] or 0),
        "resultCode": str(row["result_code"]),
        "inventoryMatchStatus": str(row["inventory_match_status"]),
        "orderMatchStatus": str(row["order_match_status"]),
        "customerName": str(row["customer_name"]),
        "maskedName": str(row["masked_name"]),
        "phone": str(row["phone"]),
        "orderNo": str(row["order_no"]) if "order_no" in row.keys() else "",
        "createdAt": str(row["created_at"]),
    }


def build_lottery_admin_dashboard(conn: sqlite3.Connection) -> dict[str, Any]:
    dashboard = build_lottery_dashboard(conn)
    campaign_id = str(dashboard["campaign"]["id"])
    round_rows = conn.execute(
        """
        SELECT *
        FROM lottery_pool_round
        WHERE campaign_id = ?
        ORDER BY round_no DESC
        LIMIT 12
        """,
        (campaign_id,),
    ).fetchall()
    formal_rows = conn.execute(
        """
        SELECT dr.*, COALESCE(lp.order_no, '') AS order_no
        FROM lottery_draw_record dr
        LEFT JOIN lottery_participant lp ON lp.id = dr.participant_id
        WHERE dr.campaign_id = ? AND dr.entry_type = 'formal'
        ORDER BY dr.created_at DESC
        LIMIT 60
        """,
        (campaign_id,),
    ).fetchall()
    mock_rows = conn.execute(
        """
        SELECT dr.*, '' AS order_no
        FROM lottery_draw_record dr
        WHERE dr.campaign_id = ? AND dr.entry_type = 'mock'
        ORDER BY dr.created_at DESC
        LIMIT 40
        """,
        (campaign_id,),
    ).fetchall()
    unmatched_rows = conn.execute(
        """
        SELECT *
        FROM lottery_participant
        WHERE campaign_id = ?
          AND entry_type = 'formal'
          AND (inventory_match_status != 'matched' OR order_match_status != 'matched')
        ORDER BY created_at DESC
        LIMIT 40
        """,
        (campaign_id,),
    ).fetchall()
    pending_rows = conn.execute(
        """
        SELECT *
        FROM lottery_participant
        WHERE campaign_id = ? AND entry_type = 'formal' AND status = 'eligible'
        ORDER BY created_at ASC
        LIMIT 20
        """,
        (campaign_id,),
    ).fetchall()
    active_round = active_lottery_round_row(conn, campaign_id)
    latest_round = latest_lottery_round_row(conn, campaign_id)
    can_open_next_round = False
    next_round_no = 1
    if latest_round:
        next_round_no = int(latest_round["round_no"] or 0) + 1
        can_open_next_round = active_round is None and int(latest_round["remaining_count"] or 0) <= 0
    return {
        "dashboard": dashboard,
        "controls": {
            "canOpenNextRound": can_open_next_round,
            "nextRoundNo": next_round_no,
            "activeRoundExists": active_round is not None,
        },
        "rounds": [
            {
                "id": str(row["id"]),
                "roundNo": int(row["round_no"]),
                "totalCount": int(row["total_count"]),
                "remainingCount": int(row["remaining_count"]),
                "status": str(row["status"]),
                "highValueDrawCount": int(row["high_value_draw_count"]),
                "openedAt": str(row["opened_at"]),
                "closedAt": str(row["closed_at"]),
                "canOpenNextRound": str(row["status"]) != "active" and int(row["remaining_count"] or 0) <= 0,
            }
            for row in round_rows
        ],
        "formalRecords": [build_lottery_record_payload(row) for row in formal_rows],
        "mockRecords": [build_lottery_record_payload(row) for row in mock_rows],
        "unmatchedParticipants": [
            {
                "id": str(row["id"]),
                "customerName": str(row["customer_name"]),
                "maskedName": str(row["masked_name"]),
                "phone": str(row["phone"]),
                "productModel": str(row["product_model"]),
                "skuKey": str(row["sku_key"]),
                "serialNumber": str(row["serial_number"]),
                "status": str(row["status"]),
                "inventoryMatchStatus": str(row["inventory_match_status"]),
                "orderMatchStatus": str(row["order_match_status"]),
                "orderNo": str(row["order_no"]),
                "createdAt": str(row["created_at"]),
            }
            for row in unmatched_rows
        ],
        "pendingParticipants": [
            {
                "id": str(row["id"]),
                "customerName": str(row["customer_name"]),
                "maskedName": str(row["masked_name"]),
                "phone": str(row["phone"]),
                "productModel": str(row["product_model"]),
                "skuKey": str(row["sku_key"]),
                "serialNumber": str(row["serial_number"]),
                "inventoryMatchStatus": str(row["inventory_match_status"]),
                "orderMatchStatus": str(row["order_match_status"]),
                "createdAt": str(row["created_at"]),
            }
            for row in pending_rows
        ],
    }


def count_sales_movements(lines: list[SalesOrderLineInput]) -> int:
    created = 0
    for line in lines:
        created += len(line.serialNumbers) if line.serialNumbers else 1
    return created


def refresh_inventory_movements_sql_mirror() -> dict[str, Any]:
    payload = build_inventory_movements_snapshot_from_sql()
    target = DATA_DIR / "latest-inventory-movements.json"
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-inventory-movements.json",
        payload,
        source_system="api.inventory_movements.sql_mirror",
    )
    return payload


def invalidate_retail_runtime_caches() -> None:
    RETAIL_CORE_STATUS_CACHE["expires_at"] = 0.0
    RETAIL_CORE_STATUS_CACHE["payload"] = None
    INVENTORY_SNAPSHOT_CACHE["expires_at"] = 0.0
    INVENTORY_SNAPSHOT_CACHE["payload"] = None
    BRIDGE_SYNC_CACHE["expires_at"] = 0.0
    BRIDGE_SYNC_CACHE["payload"] = None


def refresh_retail_core_runtime_mirrors() -> dict[str, Any]:
    invalidate_retail_runtime_caches()
    legacy_movements_snapshot = refresh_inventory_movements_sql_mirror()
    inventory_snapshots = retail_core.refresh_sql_inventory_snapshot_cache(DATA_DIR)
    projection_result: dict[str, Any] = {}
    try:
        projection_result = product_library.write_published_product_projection_snapshots(DATA_DIR)
    except Exception as error:
        projection_result = {
            "error": f"{type(error).__name__}: {error}",
        }
    snapshots: list[tuple[str, dict[str, Any], str]] = [
        ("latest-retail-core-status.json", retail_core_status(), "api.retail_core.status"),
        ("latest-retail-core-serial-items.json", retail_core.list_serial_items(limit=5000), "api.retail_core.serial_items"),
        ("latest-retail-core-inventory-movements.json", retail_core.list_inventory_movements(page_size=12000), "api.retail_core.inventory_movements"),
        ("latest-retail-core-sales-orders.json", retail_core.list_sales_orders(limit=4000), "api.retail_core.sales_orders"),
        ("latest-retail-core-customers.json", retail_core.list_customers(limit=5000), "api.retail_core.customers"),
        (
            "latest-retail-core-sync-tasks.json",
            {
                "generatedAt": now_iso(),
                "source": "api.retail_core.sync_tasks",
                "count": 0,
                "items": retail_core.list_sync_tasks(limit=4000),
            },
            "api.retail_core.sync_tasks",
        ),
        ("latest-retail-core-sync-gap-queue.json", retail_core.list_sync_gap_queue(limit=4000), "api.retail_core.sync_gap_queue"),
    ]
    snapshots[2][1]["count"] = len(snapshots[2][1]["items"])  # type: ignore[index]
    for filename, payload, source_system in snapshots:
        target = DATA_DIR / filename
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        retail_core.save_snapshot_cache(
            DATA_DIR,
            filename,
            payload,
            source_system=source_system,
        )
    invalidate_retail_runtime_caches()
    return {
        "inventorySnapshots": inventory_snapshots,
        "legacyMovements": {
            "records": len(legacy_movements_snapshot.get("records", [])),
            "generatedAt": legacy_movements_snapshot.get("generatedAt"),
        },
        "projection": projection_result,
        "snapshotCount": len(snapshots),
    }


def schedule_retail_core_runtime_refresh(background_tasks: BackgroundTasks | None = None) -> None:
    invalidate_retail_runtime_caches()
    if background_tasks is None:
        refresh_retail_core_runtime_mirrors()
        return
    background_tasks.add_task(refresh_retail_core_runtime_mirrors)


def schedule_inventory_master_auto_sync(
    background_tasks: BackgroundTasks | None = None,
    *,
    trigger: str,
    operator: str | None = None,
    source: str = "",
    force: bool = False,
) -> None:
    if background_tasks is None:
        local_sync.ensure_inventory_master_sync(
            DATA_DIR,
            trigger=trigger,
            operator=operator,
            source=source,
            force=force,
            wait_for_completion=False,
        )
        return
    background_tasks.add_task(
        local_sync.ensure_inventory_master_sync,
        DATA_DIR,
        trigger=trigger,
        operator=operator,
        source=source,
        force=force,
        wait_for_completion=False,
    )


def load_json_snapshot(filename: str) -> dict[str, Any]:
    path = DATA_DIR / filename
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail={"error": "snapshot_not_found", "filename": filename},
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "snapshot_invalid_json",
                "filename": filename,
                "message": str(error),
            },
        ) from error


def load_snapshot_from_sql_cache(
    filename: str,
    *,
    default: dict[str, Any] | None = None,
    required: bool = True,
) -> dict[str, Any]:
    try:
        ensure_live_sql_bridge_sync()
    except Exception:
        pass
    # 自动同步：每次读取前先将对应快照按 mtime 增量写入 SQL 缓存，
    # 以保证“文件更新 -> SQL 更新 -> 前端 API 读到最新”闭环稳定成立。
    try:
        retail_core.sync_snapshot_cache(DATA_DIR, [filename])
    except Exception:
        # 读取阶段不因同步异常直接中断；保留后续缓存/默认值回退路径。
        pass
    payload = retail_core.get_snapshot_cache(filename, default=default or {})
    if payload:
        return payload
    if required:
        raise HTTPException(
            status_code=404,
            detail={"error": "snapshot_not_found", "filename": filename},
        )
    return default or {}


def snapshot_items(snapshot: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = snapshot.get(key, [])
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict) and isinstance(value.get("items"), list):
        return [item for item in value["items"] if isinstance(item, dict)]
    return []


def _movement_source_document_type(movement_type: str, source_ref: str, note: str) -> str:
    normalized_type = str(movement_type or "").strip()
    normalized_ref = str(source_ref or "").strip().upper()
    normalized_note = str(note or "")
    if normalized_type == "sales_outbound_placeholder":
        return "sales_outbound_placeholder"
    if (
        normalized_type == "purchase_inbound"
        or normalized_ref.startswith("CGR")
        or normalized_ref.startswith("ZDT-CGR")
        or normalized_ref.startswith("PURCHASE-CGR")
        or normalized_ref.startswith("PURCHASEQ-CGR")
    ):
        return "purchase_inbound"
    if normalized_type == "sales_outbound" or normalized_ref.startswith("XS"):
        return "sales_outbound"
    if normalized_type == "transfer_outbound":
        return "transfer_outbound"
    if normalized_type == "transfer_inbound":
        return "transfer_inbound"
    if "入库" in normalized_note:
        return "purchase_inbound"
    if "出库" in normalized_note:
        return "sales_outbound"
    return normalized_type or "manual_adjustment"


def _canonical_movement_type(movement_type: str, source_document_type: str) -> str:
    normalized_type = str(movement_type or "").strip()
    normalized_source_document_type = str(source_document_type or "").strip()
    if normalized_source_document_type == "purchase_inbound":
        return "purchase_inbound"
    if normalized_source_document_type == "sales_outbound":
        return "sales_outbound"
    if normalized_source_document_type == "transfer_outbound":
        return "transfer_outbound"
    if normalized_source_document_type == "transfer_inbound":
        return "transfer_inbound"
    return normalized_type or "manual_adjustment"


def _load_openclaw_purchase_inbound_projection() -> list[dict[str, Any]]:
    projection = load_snapshot_from_sql_cache("latest-openclaw-purchase-inbound-projection.json")
    records = projection.get("records", []) if isinstance(projection, dict) else []
    return [item for item in records if isinstance(item, dict)]


def _normalize_movement_merge_key(record: dict[str, Any]) -> str:
    document_number = str(
        record.get("documentNumber")
        or record.get("sourceRef")
        or record.get("source_ref")
        or record.get("document_number")
        or ""
    ).strip()
    sku_key = str(record.get("skuKey") or record.get("sku_key") or "").strip()
    movement_type = str(record.get("movementType") or record.get("movement_type") or "").strip()
    return f"{movement_type}|{document_number}|{sku_key}"


def build_inventory_movements_snapshot_from_sql(limit: int = 12000) -> dict[str, Any]:
    movement_payload = retail_core.list_inventory_movements(page_size=limit)
    rows = movement_payload.get("items", []) if isinstance(movement_payload, dict) else []
    if not isinstance(rows, list):
        rows = []
    records: list[dict[str, Any]] = []
    latest_updated_at = ""
    for row in rows:
        if not isinstance(row, dict):
            continue
        source_ref = str(row.get("source_ref") or "").strip()
        note = str(row.get("note") or "")
        movement_type = str(row.get("movement_type") or "").strip()
        created_at = str(row.get("created_at") or "")
        if created_at and created_at > latest_updated_at:
            latest_updated_at = created_at
        normalized_quantity = retail_core.normalize_inventory_movement_quantity(
            row.get("quantity"),
            movement_type=movement_type,
            serial_number=row.get("serial_numbers_display") or row.get("serial_number"),
            amount=row.get("amount"),
            unit_cost=row.get("unit_cost"),
        )
        source_document_type = _movement_source_document_type(movement_type, source_ref, note)
        is_non_normal_purchase_inbound = retail_core._is_non_normal_purchase_inbound_row(  # type: ignore[attr-defined]
            movement_type,
            source_ref,
            note,
        )
        record = {
            "id": str(row.get("id") or ""),
            "skuKey": str(row.get("sku_key") or ""),
            "quantity": normalized_quantity,
            "movementType": _canonical_movement_type(movement_type, source_document_type),
            "businessDate": str(row.get("business_date") or ""),
            "serialNumber": str(row.get("serial_numbers_display") or row.get("serial_number") or "") or None,
            "serialNumbersDisplay": str(row.get("serial_numbers_display") or "") or None,
            "documentNumber": source_ref or None,
            "sourceRef": source_ref or None,
            "sourceDocumentType": source_document_type,
            "operatorName": str(row.get("operator_name") or "") or None,
            "supplierName": str(row.get("supplier_name") or "") or None,
            "storeName": "联想体验店（新野县书院路）",
            "locationName": str(row.get("location_name") or "") or None,
            "purchaseCost": row.get("unit_cost") if row.get("unit_cost") is not None else None,
            "amount": row.get("amount") if row.get("amount") is not None else None,
            "productName": str(row.get("product_name") or "") or None,
            "pnMtm": str(row.get("pn_mtm") or "") or None,
            "spec": str(row.get("spec") or "") or None,
            "note": note or None,
            "isNonNormalPurchaseInbound": is_non_normal_purchase_inbound,
            "updatedAt": created_at or latest_updated_at or now_iso(),
        }
        records.append(record)
    projection_records = _load_openclaw_purchase_inbound_projection()
    if projection_records:
        merged_by_key = {_normalize_movement_merge_key(item): item for item in records if _normalize_movement_merge_key(item)}
        for projection_record in projection_records:
            projection_copy = dict(projection_record)
            projection_copy["movementType"] = "purchase_inbound"
            key = _normalize_movement_merge_key(projection_copy)
            if not key:
                continue
            existing = merged_by_key.get(key)
            if existing:
                for field in (
                    "operatorName",
                    "supplierName",
                    "storeName",
                    "locationName",
                    "productName",
                    "pnMtm",
                    "spec",
                    "serialNumber",
                    "serialNumbersDisplay",
                    "sourceDocumentType",
                    "note",
                    "updatedAt",
                ):
                    value = projection_copy.get(field)
                    if value not in (None, ""):
                        existing[field] = value
                for field in ("purchaseCost", "amount"):
                    if existing.get(field) in (None, "", 0, 0.0):
                        value = projection_copy.get(field)
                        if value not in (None, "", 0, 0.0):
                            existing[field] = value
            else:
                merged_by_key[key] = projection_copy
                records.append(projection_copy)
    inventory_snapshot = load_snapshot_from_sql_cache("latest-standard-inventory-snapshot.json")
    retail_zone_snapshot = load_snapshot_from_sql_cache("latest-retail-zone-snapshot.json")
    return {
        "generatedAt": latest_updated_at or now_iso(),
        "source": "sql_inventory_movements",
        "records": records,
        "inventory": inventory_snapshot,
        "retailZone": retail_zone_snapshot,
    }


@app.on_event("startup")
def startup() -> None:
    global STARTUP_BOOTSTRAP_STARTED, STARTUP_BOOTSTRAP_FINISHED, STARTUP_BOOTSTRAP_ERROR
    with STARTUP_BOOTSTRAP_LOCK:
        if STARTUP_BOOTSTRAP_STARTED:
            return
        STARTUP_BOOTSTRAP_STARTED = True

    # 启动不阻塞：所有重初始化流程放到后台线程，避免 uvicorn 卡在 “Waiting for application startup”.
    def _background_bootstrap() -> None:
        global STARTUP_BOOTSTRAP_FINISHED, STARTUP_BOOTSTRAP_ERROR
        try:
            prompt_workspace.init_db()
            scheduled_task_console.init_scheduled_task_console()
            init_gaokao_2026_lead_table()
            # 启动电子价签同步 worker
            from app.price_tag_sync import start_price_tag_worker
            start_price_tag_worker()
            # 启动合规校验扫描 worker
            from app.compliance_worker import start_compliance_worker
            start_compliance_worker()
            STARTUP_BOOTSTRAP_FINISHED = True
            STARTUP_BOOTSTRAP_ERROR = None
        except Exception as exc:  # pragma: no cover - startup guard
            STARTUP_BOOTSTRAP_ERROR = str(exc)
            print(f"[startup] background bootstrap failed: {exc}")

    threading.Thread(
        target=_background_bootstrap,
        name="startup-bootstrap",
        daemon=True,
    ).start()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "lenovo-smart-retail-api",
        "dataDirExists": DATA_DIR.exists(),
        "salesLedgerFile": str(LOCAL_LEDGER_FILE),
        "retailCoreDatabase": str(retail_core.DB_FILE),
    }


@app.get("/api/dashboard/summary")
def dashboard_summary() -> dict[str, Any]:
    inventory = load_snapshot_from_sql_cache("latest-standard-inventory-snapshot.json")
    retail_zone = load_snapshot_from_sql_cache("latest-retail-zone-snapshot.json")
    price_protection = load_snapshot_from_sql_cache("latest-price-protection-snapshot.json")

    totals = inventory.get("totals", {})
    retail_zone_items = snapshot_items(retail_zone, "decisions")
    protection_candidates = snapshot_items(price_protection, "candidates")
    return {
        "source": "sqlite.snapshot_cache",
        "generatedAt": inventory.get("generatedAt"),
        "storeName": inventory.get("storeName"),
        "organizationCode": inventory.get("organizationCode"),
        "inventory": {
            "skuCount": totals.get("skuCount", 0),
            "currentStock": totals.get("currentStock", 0),
            "sellableStock": totals.get("sellableStock", 0),
            "unsellableStock": totals.get("unsellableStock", 0),
            "pendingInboundStock": totals.get("pendingInboundStock", 0),
            "serialCount": totals.get("serialCount", 0),
        },
        "retailZone": {
            "decisionCount": len(retail_zone_items),
            "highRiskCount": sum(
                1 for item in retail_zone_items if item.get("riskLevel") == "高"
            ),
        },
        "priceProtection": {
            "candidateCount": len(protection_candidates),
            "estimatedAmount": sum(
                item.get("estimatedProtectionAmount", 0)
                for item in protection_candidates
            ),
        },
    }


@app.get("/api/admin/users")
def admin_users() -> dict[str, Any]:
    return retail_core.list_admin_users()


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginInput) -> dict[str, Any]:
    ok = retail_core.verify_admin_user(payload.username, payload.password)
    if not ok:
        raise HTTPException(status_code=401, detail="管理员账号或密码不正确。")
    return {
        "ok": True,
        "username": payload.username.strip(),
        "displayName": "系统管理员" if payload.username.strip() == "admin" else payload.username.strip(),
    }


@app.post("/api/admin/change-password")
def admin_change_password(payload: AdminPasswordChangeInput) -> dict[str, Any]:
    ok = retail_core.update_admin_password(
        payload.username,
        payload.currentPassword,
        payload.newPassword,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="当前密码不正确，或新密码长度不足 4 位。")
    return {
        "ok": True,
        "username": payload.username.strip(),
    }


@app.post("/api/admin/users")
def admin_create_user(payload: AdminUserCreateInput) -> dict[str, Any]:
    ok = retail_core.create_admin_user(payload.username, payload.password, payload.displayName)
    if not ok:
        raise HTTPException(status_code=400, detail="管理员创建失败，可能是用户名重复或密码长度不足 4 位。")
    return {
        "ok": True,
        "username": payload.username.strip(),
    }


@app.post("/api/admin/users/status")
def admin_set_user_status(payload: AdminUserStatusInput) -> dict[str, Any]:
    ok = retail_core.set_admin_user_active(payload.username, payload.active)
    if not ok:
        raise HTTPException(status_code=400, detail="管理员状态更新失败，默认 admin 不允许停用。")
    return {
        "ok": True,
        "username": payload.username.strip(),
        "active": payload.active,
    }


@app.get("/api/ad-machine/runtime")
def get_ad_machine_runtime() -> dict[str, Any]:
    init_lottery_db()
    runtime = load_ad_machine_runtime()
    with lottery_connect() as conn:
        dashboard = build_lottery_dashboard(conn)
        recent_records = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, result_code AS code, customer_name AS customerName, phone,
                       product_model AS productModel, order_match_status, prize_name AS prize,
                       service_years, face_value, entry_type, created_at AS createdAt
                FROM lottery_draw_record
                ORDER BY created_at DESC
                LIMIT 200
                """
            ).fetchall()
        ]
        recent_leads = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, customer_name AS name, phone, product_model AS productModel,
                       serial_number AS serialNumber, note, created_at AS createdAt,
                       status AS syncStatus
                FROM lottery_participant
                ORDER BY created_at DESC
                LIMIT 500
                """
            ).fetchall()
        ]
    return {
        "updatedAt": runtime.get("updatedAt"),
        "lotteryRecords": recent_records,
        "leadSubmissions": recent_leads,
        "serviceTickets": runtime.get("serviceTickets", []),
        "lotteryDashboard": dashboard,
    }


@app.get("/api/ad-machine/service-status")
def get_ad_machine_service_status() -> dict[str, Any]:
    return build_ad_machine_service_status()


@app.get("/api/ad-machine/admin/public-config")
def get_ad_machine_admin_public_config() -> dict[str, Any]:
    config = load_ad_machine_admin_config()
    return {"ok": True, "config": config, "updatedAt": now_iso()}


@app.get("/api/ad-machine/admin/overview")
def get_ad_machine_admin_overview() -> dict[str, Any]:
    init_lottery_db()
    runtime = load_ad_machine_runtime()
    service_status = build_ad_machine_service_status()
    config = load_ad_machine_admin_config()
    local_config = load_ad_machine_local_config()
    with lottery_connect() as conn:
        lottery_admin = build_lottery_admin_dashboard(conn)
        lottery_dashboard = build_lottery_dashboard(conn)
    return {
        "ok": True,
        "config": config,
        "runtimeSummary": ad_machine_runtime_summary(runtime),
        "serviceStatus": service_status,
        "lottery": {
            "dashboard": lottery_dashboard,
            "admin": lottery_admin,
            "lotteryLanBaseUrl": str(local_config.get("lotteryLanBaseUrl") or ""),
            "lotteryEntryUrl": build_lottery_entry_url(),
        },
        "serviceCatalog": default_ad_machine_service_catalog(),
        "moduleCatalog": config.get("modules") or [],
        "updatedAt": now_iso(),
    }


@app.post("/api/ad-machine/admin/config")
def save_ad_machine_admin_overview_config(payload: AdMachineAdminConfigUpdateInput) -> dict[str, Any]:
    return update_ad_machine_admin_config(payload)


@app.post("/api/ad-machine/service-status/start")
def start_ad_machine_services() -> dict[str, Any]:
    return restart_ad_machine_runtime_services("start")


@app.post("/api/ad-machine/service-status/repair")
def repair_ad_machine_services() -> dict[str, Any]:
    return restart_ad_machine_runtime_services("repair")


@app.post("/api/ad-machine/service-status/refresh-data")
def refresh_ad_machine_service_data() -> dict[str, Any]:
    return refresh_ad_machine_data_flow()


@app.post("/api/ad-machine/service-status/repair-module/{module_key}")
def repair_ad_machine_service_module(module_key: str) -> dict[str, Any]:
    return refresh_ad_machine_data_module(module_key)


def load_ad_machine_local_config() -> dict[str, str]:
    try:
        content = AD_MACHINE_CONFIG_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    pairs = {}
    for key in ("minimaxApiKey", "minimaxVoiceId", "voiceProvider", "lotteryLanBaseUrl"):
        matched = re.search(rf"{key}\s*:\s*['\"]([^'\"]*)['\"]", content)
        if matched:
            pairs[key] = matched.group(1).strip()
    return pairs


def load_wechat_js_sdk_credentials() -> tuple[str, str]:
    app_id = str(os.environ.get("WECHAT_MP_APP_ID") or "").strip()
    app_secret = str(os.environ.get("WECHAT_MP_APP_SECRET") or "").strip()
    return app_id, app_secret


def _wechat_api_get_json(url: str) -> dict[str, Any]:
    req = urllib_request.Request(
        url,
        headers={
            "User-Agent": "LenovoSmartRetailApi/1.0",
            "Accept": "application/json,text/plain,*/*",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", "ignore")
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        raise HTTPException(
            status_code=502,
            detail={
                "error": "wechat_http_error",
                "message": "微信签名服务请求失败。",
                "upstreamStatus": exc.code,
                "upstreamBody": body[:400],
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": "wechat_network_error", "message": f"微信签名服务不可用：{exc}"},
        ) from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": "wechat_invalid_json", "message": "微信签名服务返回了不可解析数据。"},
        ) from exc
    errcode = int(payload.get("errcode") or 0)
    if errcode != 0:
        raise HTTPException(
            status_code=502,
            detail={
                "error": "wechat_api_error",
                "message": str(payload.get("errmsg") or "微信签名服务返回错误。"),
                "errcode": errcode,
            },
        )
    return payload


def get_wechat_access_token() -> str:
    now = time.time()
    cached_token = str(WECHAT_JSSDK_CACHE.get("access_token") or "")
    cached_expire = float(WECHAT_JSSDK_CACHE.get("access_token_expires_at") or 0)
    if cached_token and cached_expire - now > 120:
        return cached_token
    app_id, app_secret = load_wechat_js_sdk_credentials()
    if not app_id or not app_secret:
        raise HTTPException(
            status_code=503,
            detail={"error": "wechat_credentials_missing", "message": "微信扫码未配置公众号 AppID / AppSecret。"},
        )
    payload = _wechat_api_get_json(
        f"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid={app_id}&secret={app_secret}"
    )
    token = str(payload.get("access_token") or "").strip()
    expires_in = max(int(payload.get("expires_in") or 7200), 300)
    if not token:
        raise HTTPException(
            status_code=502,
            detail={"error": "wechat_access_token_missing", "message": "微信未返回 access_token。"},
        )
    WECHAT_JSSDK_CACHE["access_token"] = token
    WECHAT_JSSDK_CACHE["access_token_expires_at"] = now + expires_in
    return token


def get_wechat_jsapi_ticket() -> str:
    now = time.time()
    cached_ticket = str(WECHAT_JSSDK_CACHE.get("jsapi_ticket") or "")
    cached_expire = float(WECHAT_JSSDK_CACHE.get("jsapi_ticket_expires_at") or 0)
    if cached_ticket and cached_expire - now > 120:
        return cached_ticket
    access_token = get_wechat_access_token()
    payload = _wechat_api_get_json(
        f"https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token={access_token}&type=jsapi"
    )
    ticket = str(payload.get("ticket") or "").strip()
    expires_in = max(int(payload.get("expires_in") or 7200), 300)
    if not ticket:
        raise HTTPException(
            status_code=502,
            detail={"error": "wechat_jsapi_ticket_missing", "message": "微信未返回 jsapi_ticket。"},
        )
    WECHAT_JSSDK_CACHE["jsapi_ticket"] = ticket
    WECHAT_JSSDK_CACHE["jsapi_ticket_expires_at"] = now + expires_in
    return ticket


def build_wechat_js_sdk_signature(page_url: str) -> dict[str, Any]:
    normalized_url = str(page_url or "").strip()
    if not re.match(r"^https?://", normalized_url):
        raise HTTPException(
            status_code=400,
            detail={"error": "wechat_invalid_page_url", "message": "微信签名页面地址必须是完整的 http(s) URL。"},
        )
    normalized_url = normalized_url.split("#", 1)[0]
    app_id, _ = load_wechat_js_sdk_credentials()
    if not app_id:
        raise HTTPException(
            status_code=503,
            detail={"error": "wechat_credentials_missing", "message": "微信扫码未配置公众号 AppID / AppSecret。"},
        )
    ticket = get_wechat_jsapi_ticket()
    timestamp = str(int(time.time()))
    nonce_str = uuid.uuid4().hex[:16]
    signature_raw = f"jsapi_ticket={ticket}&noncestr={nonce_str}&timestamp={timestamp}&url={normalized_url}"
    signature = hashlib.sha1(signature_raw.encode("utf-8")).hexdigest()
    return {
        "appId": app_id,
        "timestamp": timestamp,
        "nonceStr": nonce_str,
        "signature": signature,
        "jsApiList": ["scanQRCode"],
        "url": normalized_url,
    }


def generate_audio_test_wav() -> bytes:
    sample_rate = 22050
    duration_seconds = 0.42
    frequency = 880.0
    total_frames = int(sample_rate * duration_seconds)
    pcm = bytearray()
    for frame in range(total_frames):
        ramp = min(frame / 1600, 1.0)
        fade = min((total_frames - frame) / 1600, 1.0)
        envelope = max(0.0, min(ramp, fade))
        sample = int(32767 * 0.28 * envelope * math.sin(2 * math.pi * frequency * frame / sample_rate))
        pcm.extend(sample.to_bytes(2, byteorder="little", signed=True))
    byte_rate = sample_rate * 2
    block_align = 2
    data_size = len(pcm)
    header = bytearray()
    header.extend(b"RIFF")
    header.extend((36 + data_size).to_bytes(4, "little"))
    header.extend(b"WAVEfmt ")
    header.extend((16).to_bytes(4, "little"))
    header.extend((1).to_bytes(2, "little"))
    header.extend((1).to_bytes(2, "little"))
    header.extend(sample_rate.to_bytes(4, "little"))
    header.extend(byte_rate.to_bytes(4, "little"))
    header.extend(block_align.to_bytes(2, "little"))
    header.extend((16).to_bytes(2, "little"))
    header.extend(b"data")
    header.extend(data_size.to_bytes(4, "little"))
    return bytes(header + pcm)


def request_ad_machine_tts(text: str, voice_id: str | None = None) -> tuple[bytes | None, dict[str, Any]]:
    config = load_ad_machine_local_config()
    api_key = (config.get("minimaxApiKey") or "").strip()
    if not api_key:
        return None, {"status": "missing_key", "message": "未配置 MiniMax API Key。"}
    selected_voice_id = (voice_id or config.get("minimaxVoiceId") or "female-tianmei").strip()
    payload = {
        "model": "speech-2.8-turbo",
        "text": text,
        "stream": False,
        "language_boost": "Chinese",
        "output_format": "hex",
        "voice_setting": {
            "voice_id": selected_voice_id,
            "speed": 1,
            "vol": 1,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }
    body = json.dumps(payload).encode("utf-8")
    endpoints = [
        "https://api.minimaxi.com/v1/t2a_v2",
        "https://api-bj.minimaxi.com/v1/t2a_v2",
    ]
    last_result: dict[str, Any] = {"status": "failed", "message": "未知错误", "voiceId": selected_voice_id}
    for endpoint in endpoints:
        req = urllib_request.Request(
            endpoint,
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=20, context=MINIMAX_SSL_CONTEXT) as resp:
                raw = resp.read()
        except urllib_error.HTTPError as exc:
            raw = exc.read()
        except Exception as exc:  # noqa: BLE001
            last_result = {"status": "network_error", "message": str(exc), "endpoint": endpoint, "voiceId": selected_voice_id}
            continue
        try:
            result = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            last_result = {"status": "invalid_response", "message": "语音接口返回不可解析内容。", "endpoint": endpoint, "voiceId": selected_voice_id}
            continue
        base_resp = result.get("base_resp") or {}
        status_code = int(base_resp.get("status_code", -1))
        status_msg = str(base_resp.get("status_msg") or result.get("message") or "接口失败")
        if status_code != 0:
            last_result = {
                "status": "provider_error",
                "message": status_msg,
                "code": status_code,
                "endpoint": endpoint,
                "voiceId": selected_voice_id,
            }
            continue
        data = result.get("data") or {}
        audio_hex = str(data.get("audio") or "").strip()
        audio_base64 = str(data.get("audio_base64") or data.get("audioBase64") or "").strip()
        if audio_hex:
            normalized = audio_hex[2:] if audio_hex.startswith("0x") else audio_hex
            return bytes.fromhex(normalized), {"status": "ok", "endpoint": endpoint, "voiceId": selected_voice_id}
        if audio_base64:
            return b64decode(audio_base64), {"status": "ok", "endpoint": endpoint, "voiceId": selected_voice_id}
        last_result = {"status": "empty_audio", "message": "接口成功但未返回音频数据。", "endpoint": endpoint, "voiceId": selected_voice_id}
    return None, last_result


def extract_json_object_block(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", raw)
    candidate = fenced.group(1) if fenced else raw
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        parsed = json.loads(candidate[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def request_ad_machine_minimax_image_recognition(image_base64: str, mode: str = "reference") -> tuple[dict[str, Any] | None, dict[str, Any]]:
    config = load_ad_machine_local_config()
    api_key = (config.get("minimaxApiKey") or "").strip()
    if not api_key:
        return None, {"status": "missing_key", "message": "未配置 MiniMax API Key。"}
    normalized_image = str(image_base64 or "").strip()
    if not normalized_image:
        return None, {"status": "missing_image", "message": "未提供图片。"}
    normalized_mode = "serial" if str(mode or "").strip().lower() == "serial" else "reference"
    prompt = (
        "你是联想门店抽奖报名页的编码识别助手。"
        "请只从图片里识别最可能的一个编码，并严格返回 JSON，不要输出任何解释。"
        "JSON 格式固定为："
        '{"recognizedCode":"","codeType":"","confidence":"high|medium|low","alternatives":[""],"reason":""}。'
        "recognizedCode 只保留大写英数字，不要空格，不要连字符。"
    )
    if normalized_mode == "serial":
        prompt += (
            "当前目标是识别购机 SN。优先寻找长度较长的英数字序列；"
            "如果没有把握，recognizedCode 返回空字符串。"
        )
    else:
        prompt += (
            "当前目标是识别 MTM、PN 或 69码。优先输出最像产品编码的一段；"
            "若是 69码，可保留纯数字；若是 MTM/PN，输出大写英数字。"
        )
    payload = {
        "model": "MiniMax-M3",
        "messages": [
            {"role": "system", "content": "你是严谨的图像编码识别器，只返回 JSON。"},
            {"role": "user", "content": f"{prompt}\n请识别这张图片中的目标编码：[Image base64:{normalized_image}]"},
        ],
        "temperature": 0.1,
    }
    body = json.dumps(payload).encode("utf-8")
    endpoints = [
        "https://api.minimaxi.com/v1/chat/completions",
    ]
    last_result: dict[str, Any] = {"status": "failed", "message": "未知错误"}
    for endpoint in endpoints:
        req = urllib_request.Request(
            endpoint,
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=60, context=MINIMAX_SSL_CONTEXT) as resp:
                raw = resp.read()
        except urllib_error.HTTPError as exc:
            raw = exc.read()
        except Exception as exc:  # noqa: BLE001
            last_result = {"status": "network_error", "message": str(exc), "endpoint": endpoint}
            continue
        try:
            result = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            last_result = {"status": "invalid_response", "message": "图片识别接口返回不可解析内容。", "endpoint": endpoint}
            continue
        message_content = ""
        choices = result.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") if isinstance(choices[0], dict) else {}
            message_content = str((message or {}).get("content") or "").strip()
        if not message_content:
            last_result = {"status": "empty_content", "message": "图片识别接口没有返回可用文本。", "endpoint": endpoint, "raw": result}
            continue
        parsed = extract_json_object_block(message_content)
        if not parsed:
            last_result = {"status": "invalid_json_payload", "message": "图片识别结果不是合法 JSON。", "endpoint": endpoint, "content": message_content[:400]}
            continue
        return parsed, {"status": "ok", "endpoint": endpoint}
    return None, last_result


def decode_image_base64_to_pil_image(image_base64: str) -> PILImage.Image:
    raw = str(image_base64 or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail={"error": "image_missing", "message": "未提供图片数据。"})
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        image_bytes = b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"error": "image_decode_failed", "message": "图片 base64 解析失败。"}) from exc
    try:
        image = PILImage.open(BytesIO(image_bytes))
        image.load()
        return image
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"error": "image_open_failed", "message": "图片内容无法读取。"}) from exc


def normalized_barcode_candidates(value: str) -> list[str]:
    raw = str(value or "").strip().upper()
    if not raw:
        return []
    candidates: list[str] = []

    def push(item: str) -> None:
        normalized = re.sub(r"[^A-Z0-9]", "", str(item or "").upper())
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    push(raw)
    if "," in raw:
        tail = raw.rsplit(",", 1)[-1]
        push(tail)
    if ":" in raw:
        tail = raw.rsplit(":", 1)[-1]
        push(tail)
    return candidates


def build_barcode_decode_variants(image: PILImage.Image) -> list[tuple[str, PILImage.Image]]:
    base = image.convert("RGB")
    variants: list[tuple[str, PILImage.Image]] = [("rgb", base)]
    grayscale = ImageOps.grayscale(base)
    variants.append(("gray", grayscale))
    variants.append(("autocontrast", ImageOps.autocontrast(grayscale)))
    variants.append(("contrast2", ImageEnhance.Contrast(grayscale).enhance(2.0)))
    variants.append(("contrast3", ImageEnhance.Contrast(grayscale).enhance(3.1)))
    variants.append(("sharpen", grayscale.filter(ImageFilter.SHARPEN)))
    variants.append(("binary160", grayscale.point(lambda value: 255 if value > 160 else 0, mode="1").convert("L")))
    variants.append(("binary190", grayscale.point(lambda value: 255 if value > 190 else 0, mode="1").convert("L")))
    variants.append(("invert", ImageOps.invert(grayscale)))
    upscaled = base.resize((max(1, base.width * 2), max(1, base.height * 2)), PILImage.Resampling.LANCZOS)
    variants.append(("up2x", upscaled))
    variants.append(("up2x_gray", ImageOps.grayscale(upscaled)))
    variants.append(("up2x_autocontrast", ImageOps.autocontrast(ImageOps.grayscale(upscaled))))
    variants.append(("up2x_binary160", ImageOps.grayscale(upscaled).point(lambda value: 255 if value > 160 else 0, mode="1").convert("L")))
    for angle in (90, 180, 270):
        rotated = base.rotate(angle, expand=True)
        variants.append((f"rotate{angle}", rotated))
        rotated_gray = ImageOps.grayscale(rotated)
        variants.append((f"rotate{angle}_gray", rotated_gray))
    unique: list[tuple[str, PILImage.Image]] = []
    seen = set()
    for label, variant in variants:
        key = (label, variant.mode, variant.size)
        if key in seen:
            continue
        seen.add(key)
        unique.append((label, variant))
    return unique


def request_opencv_barcode_recognition(variants: list[tuple[str, PILImage.Image]]) -> list[dict[str, Any]]:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return []
    detector = cv2.barcode_BarcodeDetector()
    matches: list[dict[str, Any]] = []

    def push(result_text: str, code_type: str, source_variant: str) -> None:
        for candidate in normalized_barcode_candidates(result_text):
            entry = {
                "recognizedCode": candidate,
                "codeType": code_type,
                "sourceVariant": source_variant,
                "valid": True,
            }
            if entry not in matches:
                matches.append(entry)

    for label, variant in variants:
        try:
            rgb = variant.convert("RGB")
            frame = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
            single_text, _, single_type = detector.detectAndDecode(frame)
            if single_text:
                push(str(single_text), str(single_type or "opencv_barcode"), f"{label}_opencv")
                break
            multi_ok, multi_texts, multi_types, _ = detector.detectAndDecodeMulti(frame)
            if not multi_ok:
                continue
            text_list = list(multi_texts or [])
            type_list = list(multi_types or []) if multi_types is not None else []
            for index, text in enumerate(text_list):
                push(str(text), str(type_list[index] if index < len(type_list) else "opencv_barcode"), f"{label}_opencv_multi")
            if matches:
                break
        except Exception:
            continue
    return matches


def request_service_barcode_recognition(image_base64: str, mode: str = "reference") -> dict[str, Any]:
    try:
        import zxingcpp  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail={"error": "barcode_runtime_missing", "message": f"服务端条码识别依赖未安装：{exc}"},
        ) from exc
    image = decode_image_base64_to_pil_image(image_base64)
    normalized_mode = "serial" if str(mode or "").strip().lower() == "serial" else "reference"
    formats = (
        zxingcpp.BarcodeFormats(zxingcpp.All)
        if normalized_mode == "serial"
        else zxingcpp.BarcodeFormats(zxingcpp.All)
    )
    tried_variants: list[str] = []
    matches: list[dict[str, Any]] = []
    for label, variant in build_barcode_decode_variants(image):
        tried_variants.append(label)
        try:
            results = zxingcpp.read_barcodes(
                variant,
                formats=formats,
                try_rotate=True,
                try_downscale=False,
                text_mode=zxingcpp.TextMode.Plain,
            )
        except TypeError:
            results = zxingcpp.read_barcodes(variant)
        except Exception:
            continue
        for item in results or []:
            raw_text = str(getattr(item, "text", "") or "").strip()
            for candidate in normalized_barcode_candidates(raw_text):
                format_name = str(getattr(item, "format", "") or getattr(item, "symbology", "") or "").strip()
                entry = {
                    "recognizedCode": candidate,
                    "codeType": format_name,
                    "sourceVariant": label,
                    "valid": bool(getattr(item, "valid", True)),
                }
                if entry not in matches:
                    matches.append(entry)
        if matches:
            break
    if not matches:
        matches = request_opencv_barcode_recognition(build_barcode_decode_variants(image))
    if not matches:
        return {
            "ok": False,
            "recognizedCode": "",
            "codeType": "",
            "confidence": "none",
            "candidates": [],
            "triedVariants": tried_variants,
            "message": "服务端未识别到有效一维码或二维码。",
        }
    primary = matches[0]
    candidates = [item["recognizedCode"] for item in matches[:5]]
    confidence = "high" if len(primary["recognizedCode"]) >= 8 else "medium"
    return {
        "ok": True,
        "recognizedCode": primary["recognizedCode"],
        "codeType": primary["codeType"],
        "confidence": confidence,
        "candidates": candidates,
        "triedVariants": tried_variants,
        "sourceVariant": primary["sourceVariant"],
        "message": "服务端识别成功。",
    }


@app.get("/api/ad-machine/audio-test")
def ad_machine_audio_test() -> Response:
    return Response(content=generate_audio_test_wav(), media_type="audio/wav")


@app.post("/api/ad-machine/tts")
def ad_machine_tts(payload: AdMachineTtsInput) -> Response:
    audio_bytes, meta = request_ad_machine_tts(payload.text.strip(), payload.voiceId)
    if not audio_bytes:
        detail = dict(meta)
        detail["ok"] = False
        raise HTTPException(status_code=502, detail=detail)
    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "X-Ad-Machine-Tts-Source": str(meta.get("endpoint") or ""),
            "X-Ad-Machine-Tts-Voice-Id": str(meta.get("voiceId") or ""),
        },
    )


@app.post("/api/ad-machine/minimax-image-recognition")
def ad_machine_minimax_image_recognition(payload: AdMachineMiniMaxImageRecognitionInput) -> dict[str, Any]:
    parsed, meta = request_ad_machine_minimax_image_recognition(payload.imageBase64, payload.mode)
    if not parsed:
        return {"ok": False, **meta}
    recognized_code = re.sub(r"[^A-Z0-9]", "", str(parsed.get("recognizedCode") or "").upper())
    alternatives_raw = parsed.get("alternatives")
    alternatives = []
    if isinstance(alternatives_raw, list):
        alternatives = [
            re.sub(r"[^A-Z0-9]", "", str(item or "").upper())
            for item in alternatives_raw
            if re.sub(r"[^A-Z0-9]", "", str(item or "").upper())
        ][:5]
    return {
        "ok": True,
        "recognizedCode": recognized_code,
        "codeType": str(parsed.get("codeType") or "").strip(),
        "confidence": str(parsed.get("confidence") or "").strip().lower(),
        "alternatives": alternatives,
        "reason": str(parsed.get("reason") or "").strip(),
        **meta,
    }


@app.post("/api/ad-machine/barcode-recognize")
def ad_machine_barcode_recognize(payload: AdMachineBarcodeRecognitionInput) -> dict[str, Any]:
    return request_service_barcode_recognition(payload.imageBase64, payload.mode)


@app.get("/api/ad-machine/lottery/dashboard")
def ad_machine_lottery_dashboard() -> dict[str, Any]:
    init_lottery_db()
    with lottery_connect() as conn:
        return {
            "ok": True,
            "dashboard": build_lottery_dashboard(conn),
            "lotteryLanBaseUrl": str(build_lottery_entry_url()).removesuffix("/ad-machine/lottery-entry.html"),
            "lotteryEntryUrl": build_lottery_entry_url(),
        }


@app.get("/api/ad-machine/lottery/product-options")
def ad_machine_lottery_product_options(request: Request, q: str = "", limit: int = 500) -> dict[str, Any]:
    assert_lan_request(request)
    keyword = str(q or "").strip().lower()
    max_limit = max(50, min(int(limit or 500), 1500))
    options = build_lottery_product_options(limit=max_limit)
    if keyword:
        options = [
            item
            for item in options
            if keyword in str(item.get("productModel") or "").lower()
            or keyword in str(item.get("skuKey") or "").lower()
            or keyword in str(item.get("pnMtm") or "").lower()
        ]
    public_items = [public_lottery_product_option(item) for item in options[:max_limit]]
    return {"ok": True, "items": public_items, "count": len(options)}


@app.post("/api/ad-machine/lottery/local-config")
def ad_machine_lottery_local_config(request: Request, payload: AdMachineLotteryLocalConfigInput) -> dict[str, Any]:
    assert_lan_request(request)
    config = save_lottery_lan_base_url(payload.lotteryLanBaseUrl)
    return {
        "ok": True,
        "lotteryLanBaseUrl": str(config.get("lotteryLanBaseUrl") or ""),
        "lotteryEntryUrl": build_lottery_entry_url(),
    }


@app.get("/api/ad-machine/lottery/entry-qr")
def ad_machine_lottery_entry_qr() -> Response:
    return Response(content=generate_qr_png_bytes(build_lottery_entry_url()), media_type="image/png")


@app.get("/api/ad-machine/lottery/serial-lookup")
def ad_machine_lottery_serial_lookup(serialNumber: str = "") -> dict[str, Any]:
    normalized_serial = ensure_serial_number_format(serialNumber)
    resolved = resolve_lottery_product_by_serial(normalized_serial)
    projection = resolved.get("projection") if isinstance(resolved.get("projection"), dict) else {}
    serial_item = resolved.get("serialItem") if isinstance(resolved.get("serialItem"), dict) else {}
    return {
        "ok": True,
        "serialNumber": normalized_serial,
        "inventoryMatchStatus": str(resolved.get("inventoryMatchStatus") or "unmatched"),
        "skuKey": str(resolved.get("skuKey") or ""),
        "productModel": str(resolved.get("productModel") or ""),
        "pnMtm": str((projection or {}).get("pnMtm") or serial_item.get("pn_mtm") or ""),
        "productName": str((projection or {}).get("productName") or serial_item.get("product_name") or ""),
    }


@app.get("/api/ad-machine/lottery/reference-lookup")
def ad_machine_lottery_reference_lookup(referenceCode: str = "") -> dict[str, Any]:
    resolved = resolve_lottery_product_by_reference(referenceCode)
    projection = resolved.get("projection") if isinstance(resolved.get("projection"), dict) else {}
    return {
        "ok": True,
        "referenceCode": str(resolved.get("referenceCode") or ""),
        "inventoryMatchStatus": str(resolved.get("inventoryMatchStatus") or "unmatched"),
        "skuKey": str(resolved.get("skuKey") or ""),
        "productModel": str(resolved.get("productModel") or ""),
        "pnMtm": str(resolved.get("pnMtm") or ""),
        "productCode": str(resolved.get("productCode") or ""),
        "barcode": str(resolved.get("barcode") or ""),
        "productName": str((projection or {}).get("productName") or ""),
    }


@app.get("/api/ad-machine/lottery/wechat-sdk-config")
def ad_machine_lottery_wechat_sdk_config(request: Request, url: str = "") -> dict[str, Any]:
    assert_lan_request(request)
    app_id, app_secret = load_wechat_js_sdk_credentials()
    if not app_id or not app_secret:
        return {
            "ok": True,
            "enabled": False,
            "message": "微信公众号签名未配置，当前将继续使用浏览器原生扫码或拍照识别。",
        }
    return {
        "ok": True,
        "enabled": True,
        **build_wechat_js_sdk_signature(url),
    }


@app.get("/api/ad-machine/lottery/admin/dashboard")
def ad_machine_lottery_admin_dashboard(request: Request) -> dict[str, Any]:
    assert_lan_request(request)
    init_lottery_db()
    with lottery_connect() as conn:
        return {"ok": True, **build_lottery_admin_dashboard(conn)}


@app.get("/api/ad-machine/lottery/admin/records")
def ad_machine_lottery_admin_records(request: Request, entryType: str = "formal", limit: int = 60) -> dict[str, Any]:
    assert_lan_request(request)
    init_lottery_db()
    normalized_type = "mock" if str(entryType or "").strip().lower() == "mock" else "formal"
    max_limit = max(10, min(int(limit or 60), 200))
    with lottery_connect() as conn:
        campaign = current_lottery_campaign(conn)
        if normalized_type == "formal":
            rows = conn.execute(
                """
                SELECT dr.*, COALESCE(lp.order_no, '') AS order_no
                FROM lottery_draw_record dr
                LEFT JOIN lottery_participant lp ON lp.id = dr.participant_id
                WHERE dr.campaign_id = ? AND dr.entry_type = 'formal'
                ORDER BY dr.created_at DESC
                LIMIT ?
                """,
                (str(campaign["id"]), max_limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT dr.*, '' AS order_no
                FROM lottery_draw_record dr
                WHERE dr.campaign_id = ? AND dr.entry_type = 'mock'
                ORDER BY dr.created_at DESC
                LIMIT ?
                """,
                (str(campaign["id"]), max_limit),
            ).fetchall()
        return {"ok": True, "items": [build_lottery_record_payload(row) for row in rows], "count": len(rows)}


@app.post("/api/ad-machine/lottery/participants")
def ad_machine_lottery_participants(request: Request, payload: AdMachineLotteryParticipantInput) -> dict[str, Any]:
    assert_lan_request(request)
    init_lottery_db()
    customer_name = payload.customerName.strip()
    phone = payload.phone.strip()
    product_model_hint = payload.productModel.strip()
    sku_key_hint = payload.skuKey.strip()
    note = payload.note.strip()
    serial_number = ensure_serial_number_format(payload.serialNumber)
    with lottery_connect() as conn:
        campaign = current_lottery_campaign(conn)
        duplicate = conn.execute(
            """
            SELECT id
            FROM lottery_participant
            WHERE serial_number = ? AND entry_type = 'formal'
            LIMIT 1
            """,
            (serial_number,),
        ).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail={"error": "serial_already_used", "message": "该 SN 已参与正式抽奖。"})
        resolved = resolve_lottery_product_by_serial(serial_number, sku_key_hint, product_model_hint)
        projection = resolved.get("projection") if isinstance(resolved.get("projection"), dict) else None
        serial_item = resolved.get("serialItem") if isinstance(resolved.get("serialItem"), dict) else None
        inventory_match_status = str(resolved.get("inventoryMatchStatus") or ("matched" if serial_item else "unmatched"))
        sku_key = str(resolved.get("skuKey") or "")
        product_model = str(resolved.get("productModel") or "")
        order_no = detect_order_for_serial(serial_number, sku_key)
        order_match_status = "matched" if order_no else "unmatched"
        pricing = projection.get("pricing") if isinstance(projection, dict) and isinstance(projection.get("pricing"), dict) else {}
        store_retail_price = float(pricing.get("storeRetailPrice") or 0)
        participant_id = f"participant-{uuid.uuid4().hex[:12]}"
        now = now_iso()
        conn.execute(
            """
            INSERT INTO lottery_participant
            (id, campaign_id, customer_name, masked_name, phone, product_model, sku_key, serial_number, note,
             entry_type, status, inventory_match_status, order_match_status, order_no, store_retail_price, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'formal', 'eligible', ?, ?, ?, ?, ?, ?)
            """,
            (
                participant_id,
                str(campaign["id"]),
                customer_name,
                mask_customer_name(customer_name),
                phone,
                product_model,
                sku_key,
                serial_number,
                note,
                inventory_match_status,
                order_match_status,
                order_no,
                store_retail_price,
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO lottery_event_log (id, event_type, payload_json, created_at)
            VALUES (?, 'participant_created', ?, ?)
            """,
            (
                f"log-{uuid.uuid4().hex[:12]}",
                json.dumps(
                    {
                        "participantId": participant_id,
                        "serialNumber": serial_number,
                        "skuKey": sku_key,
                        "inventoryMatchStatus": inventory_match_status,
                        "orderMatchStatus": order_match_status,
                    },
                    ensure_ascii=False,
                ),
                now,
            ),
        )
        conn.commit()
        return {
            "ok": True,
            "participant": {
                "id": participant_id,
                "customerName": customer_name,
                "maskedName": mask_customer_name(customer_name),
                "phone": phone,
                "productModel": product_model,
                "skuKey": sku_key,
                "serialNumber": serial_number,
                "inventoryMatchStatus": inventory_match_status,
                "orderMatchStatus": order_match_status,
                "orderNo": order_no,
                "createdAt": now,
            },
            "dashboard": build_lottery_dashboard(conn),
        }


@app.post("/api/ad-machine/lottery/formal-draw")
def ad_machine_lottery_formal_draw(payload: AdMachineLotteryFormalDrawInput) -> dict[str, Any]:
    init_lottery_db()
    with lottery_connect() as conn:
        campaign = current_lottery_campaign(conn)
        participant = conn.execute(
            """
            SELECT *
            FROM lottery_participant
            WHERE id = ? AND entry_type = 'formal'
            LIMIT 1
            """,
            (payload.participantId.strip(),),
        ).fetchone()
        if not participant:
            raise HTTPException(status_code=404, detail={"error": "participant_not_found", "message": "未找到待抽奖客户。"})
        if str(participant["status"]) != "eligible":
            raise HTTPException(status_code=409, detail={"error": "participant_not_eligible", "message": "该客户当前不可正式抽奖。"})
        round_payload = current_lottery_round_payload(conn, str(campaign["id"]))
        if str(round_payload["status"]) != "active":
            raise HTTPException(status_code=409, detail={"error": "lottery_round_not_active", "message": "当前奖池已抽完，请先在后台开启下一池。"})
        round_id = str(round_payload["id"])
        high_value = float(participant["store_retail_price"] or 0) >= 10000
        item = choose_available_pool_item(conn, round_id, high_value)
        layout = lottery_layout_for_pool_item(conn, round_id, item)
        now = now_iso()
        draw_id = f"draw-{uuid.uuid4().hex[:12]}"
        result_code = f"LJ-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        prize_name = str(item["prize_name"])
        conn.execute(
            """
            INSERT INTO lottery_draw_record
            (id, campaign_id, round_id, participant_id, entry_type, serial_number, product_model, sku_key,
             price_band, prize_code, prize_name, service_years, face_value, result_code,
             inventory_match_status, order_match_status, customer_name, masked_name, phone, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'formal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                draw_id,
                str(campaign["id"]),
                round_id,
                str(participant["id"]),
                str(participant["serial_number"]),
                str(participant["product_model"]),
                str(participant["sku_key"]),
                "high" if high_value else "normal",
                str(item["prize_code"]),
                prize_name,
                int(item["service_years"]),
                int(item["face_value"]),
                result_code,
                str(participant["inventory_match_status"]),
                str(participant["order_match_status"]),
                str(participant["customer_name"]),
                str(participant["masked_name"]),
                str(participant["phone"]),
                now,
                now,
            ),
        )
        conn.execute(
            "UPDATE lottery_pool_item SET status = 'drawn', draw_record_id = ?, updated_at = ? WHERE id = ?",
            (draw_id, now, str(item["id"])),
        )
        conn.execute(
            "UPDATE lottery_participant SET status = 'drawn', updated_at = ? WHERE id = ?",
            (now, str(participant["id"])),
        )
        remaining_count = max(int(round_payload["remainingCount"]) - 1, 0)
        round_status = "depleted" if remaining_count == 0 else "active"
        conn.execute(
            """
            UPDATE lottery_pool_round
            SET remaining_count = ?, status = ?, high_value_draw_count = high_value_draw_count + ?, closed_at = CASE WHEN ? = 'depleted' THEN ? ELSE closed_at END, updated_at = ?
            WHERE id = ?
            """,
            (remaining_count, round_status, 1 if high_value else 0, round_status, now, now, round_id),
        )
        conn.execute(
            """
            INSERT INTO lottery_public_feed (id, draw_record_id, campaign_id, masked_name, product_model, prize_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"feed-{uuid.uuid4().hex[:12]}",
                draw_id,
                str(campaign["id"]),
                str(participant["masked_name"]),
                str(participant["product_model"]),
                prize_name,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO lottery_event_log (id, event_type, payload_json, created_at)
            VALUES (?, 'formal_draw', ?, ?)
            """,
            (
                f"log-{uuid.uuid4().hex[:12]}",
                json.dumps({"drawId": draw_id, "participantId": str(participant["id"]), "roundId": round_id, "prizeName": prize_name}, ensure_ascii=False),
                now,
            ),
        )
        conn.commit()
        return {
            "ok": True,
            "result": {
                "id": draw_id,
                "code": result_code,
                "customerName": str(participant["customer_name"]),
                "maskedName": str(participant["masked_name"]),
                "phone": str(participant["phone"]),
                "productModel": str(participant["product_model"]),
                "serialNumber": str(participant["serial_number"]),
                "level": "正式抽奖",
                "prize": prize_name,
                "serviceYears": int(item["service_years"]),
                "faceValue": int(item["face_value"]),
                "tier": str(item["tier"]),
                "displayIndex": int(layout["displayIndex"]),
                "sectorIndex": int(layout["sectorIndex"]),
                "assetKey": str(layout["assetKey"]),
                "tierSerial": int(layout["tierSerial"]),
                "tierTotal": int(layout["tierTotal"]),
                "tierName": str(layout["tierName"]),
                "label": str(layout["label"]),
                "createdAt": now,
            },
            "dashboard": build_lottery_dashboard(conn),
        }


@app.post("/api/ad-machine/lottery/admin/open-next-round")
def ad_machine_lottery_admin_open_next_round(request: Request, payload: AdMachineLotteryAdminRoundOpenInput | None = None) -> dict[str, Any]:
    assert_lan_request(request)
    init_lottery_db()
    force = bool(payload.force) if payload else False
    with lottery_connect() as conn:
        campaign = current_lottery_campaign(conn)
        campaign_id = str(campaign["id"])
        active_round = active_lottery_round_row(conn, campaign_id)
        if active_round:
            raise HTTPException(
                status_code=409,
                detail={"error": "lottery_round_active_exists", "message": f"当前第 {int(active_round['round_no'])} 池仍在进行中，不能开启下一池。"},
            )
        latest_round = latest_lottery_round_row(conn, campaign_id)
        if latest_round and int(latest_round["remaining_count"] or 0) > 0 and not force:
            raise HTTPException(
                status_code=409,
                detail={"error": "lottery_round_not_depleted", "message": f"当前第 {int(latest_round['round_no'])} 池仍剩 {int(latest_round['remaining_count'])} 张奖卡，不能开启下一池。"},
            )
        next_round_no = int(latest_round["round_no"] or 0) + 1 if latest_round else 1
        round_id = create_lottery_round(conn, campaign_id, next_round_no)
        conn.execute(
            """
            INSERT INTO lottery_event_log (id, event_type, payload_json, created_at)
            VALUES (?, 'round_opened', ?, ?)
            """,
            (
                f"log-{uuid.uuid4().hex[:12]}",
                json.dumps({"campaignId": campaign_id, "roundId": round_id, "roundNo": next_round_no}, ensure_ascii=False),
                now_iso(),
            ),
        )
        conn.commit()
        return {
            "ok": True,
            "roundId": round_id,
            "roundNo": next_round_no,
            "dashboard": build_lottery_dashboard(conn),
            "admin": build_lottery_admin_dashboard(conn),
        }


@app.post("/api/ad-machine/lottery/mock-draw")
def ad_machine_lottery_mock_draw(payload: AdMachineLotteryMockDrawInput) -> dict[str, Any]:
    init_lottery_db()
    with lottery_connect() as conn:
        campaign = current_lottery_campaign(conn)
        result = random.choice(
            [
                {"prize": "Lenovo Care 智惠三年", "serviceYears": 3, "faceValue": 399, "tier": "rare"},
                {"prize": "Lenovo Care 智惠四年", "serviceYears": 4, "faceValue": 599, "tier": "epic"},
                {"prize": "Lenovo Care 智惠五年", "serviceYears": 5, "faceValue": 869, "tier": "legendary"},
            ]
        )
        layout = lottery_layout_for_mock_tier(str(result["tier"]))
        draw_id = f"mock-{uuid.uuid4().hex[:12]}"
        participant_id = f"participant-{uuid.uuid4().hex[:12]}"
        mock_serial = f"MOCK-SN-{uuid.uuid4().hex[:12].upper()}"
        now = now_iso()
        nickname = payload.nickname.strip() or "现场客户"
        masked_name = mask_customer_name(nickname)
        conn.execute(
            """
            INSERT INTO lottery_participant
            (id, campaign_id, customer_name, masked_name, phone, product_model, sku_key, serial_number, note,
             entry_type, status, inventory_match_status, order_match_status, order_no, store_retail_price, created_at, updated_at)
            VALUES (?, ?, ?, ?, '', ?, '', ?, '', 'mock', 'drawn', 'mock', 'mock', '', 0, ?, ?)
            """,
            (participant_id, str(campaign["id"]), nickname, masked_name, payload.productModel.strip(), mock_serial, now, now),
        )
        conn.execute(
            """
            INSERT INTO lottery_draw_record
            (id, campaign_id, round_id, participant_id, entry_type, serial_number, product_model, sku_key, price_band,
             prize_code, prize_name, service_years, face_value, result_code,
             inventory_match_status, order_match_status, customer_name, masked_name, phone, created_at, updated_at)
            VALUES (?, ?, '', ?, 'mock', ?, ?, '', 'mock', ?, ?, ?, ?, ?, 'mock', 'mock', ?, ?, '', ?, ?)
            """,
            (
                draw_id,
                str(campaign["id"]),
                participant_id,
                mock_serial,
                payload.productModel.strip(),
                f"MOCK-{result['serviceYears']}Y",
                str(result["prize"]),
                int(result["serviceYears"]),
                int(result["faceValue"]),
                f"MOCK-{datetime.now().strftime('%H%M%S')}",
                nickname,
                masked_name,
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO lottery_event_log (id, event_type, payload_json, created_at)
            VALUES (?, 'mock_draw', ?, ?)
            """,
            (
                f"log-{uuid.uuid4().hex[:12]}",
                json.dumps({"drawId": draw_id, "productModel": payload.productModel.strip(), "prizeName": result["prize"]}, ensure_ascii=False),
                now,
            ),
        )
        conn.commit()
        return {
            "ok": True,
            "result": {
                "id": draw_id,
                "code": f"MOCK-{datetime.now().strftime('%H%M%S')}",
                "customerName": nickname,
                "maskedName": masked_name,
                "productModel": payload.productModel.strip() or "模拟抽奖",
                "level": "模拟抽奖",
                "prize": str(result["prize"]),
                "serviceYears": int(result["serviceYears"]),
                "faceValue": int(result["faceValue"]),
                "tier": str(result["tier"]),
                "displayIndex": int(layout["displayIndex"]),
                "sectorIndex": int(layout["sectorIndex"]),
                "assetKey": str(layout["assetKey"]),
                "tierSerial": int(layout["tierSerial"]),
                "tierTotal": int(layout["tierTotal"]),
                "tierName": str(layout["tierName"]),
                "label": str(layout["label"]),
                "createdAt": now,
            },
            "dashboard": build_lottery_dashboard(conn),
        }


@app.post("/api/ad-machine/leads")
def ad_machine_submit_lead(payload: AdMachineLeadSubmitInput) -> dict[str, Any]:
    init_lottery_db()
    runtime = load_ad_machine_runtime()
    item = {
        "id": f"lead-{uuid.uuid4().hex[:12]}",
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "orderNumber": payload.orderNumber.strip(),
        "storeName": payload.storeName.strip(),
        "productModel": payload.productModel.strip(),
        "lotteryCode": payload.lotteryCode.strip(),
        "note": payload.note.strip(),
        "createdAt": now_iso(),
        "syncStatus": "queued",
    }
    leads = runtime.get("leadSubmissions", [])
    if not isinstance(leads, list):
        leads = []
    leads.insert(0, item)
    runtime["leadSubmissions"] = leads[:1000]
    save_ad_machine_runtime(runtime)
    return {"ok": True, "lead": item, "runtimeUpdatedAt": runtime.get("updatedAt")}


@app.get("/api/marketing/gaokao-2026/leads")
def gaokao_2026_list_leads(limit: int = 20) -> dict[str, Any]:
    leads = list_gaokao_2026_leads(limit)
    return {
        "ok": True,
        "campaign": "gaokao2026",
        "count": len(leads),
        "leads": leads,
        "updatedAt": now_iso(),
    }


@app.post("/api/marketing/gaokao-2026/leads")
def gaokao_2026_submit_lead(payload: Gaokao2026LeadSubmitInput) -> dict[str, Any]:
    now = now_iso()
    row = save_gaokao_2026_lead(payload)
    return {
        "ok": True,
        "lead": public_gaokao_lead_from_row(row),
        "leads": list_gaokao_2026_leads(8),
        "updatedAt": now,
    }


@app.post("/api/marketing/gaokao-2026/e-coupons/claim")
def gaokao_2026_claim_e_coupon(payload: Gaokao2026LeadSubmitInput) -> dict[str, Any]:
    lead_payload = payload.model_copy(update={"action": "e_coupon_claim"})
    with gaokao_write_slot():
        with GAOKAO_COUPON_ISSUE_LOCK:
            with retail_core.connect() as conn:
                init_gaokao_2026_lead_table(conn=conn)
                config = load_gaokao_coupon_config(conn=conn)
                lead_row = save_gaokao_2026_lead(lead_payload, conn=conn)
                coupon_row = issue_gaokao_2026_coupon(lead_row, conn=conn, config=config)
    return {
        "ok": True,
        "campaign": "gaokao2026",
        "lead": public_gaokao_lead_from_row(lead_row),
        "coupon": public_gaokao_coupon_from_row(coupon_row, config=config),
        "updatedAt": now_iso(),
    }


@app.get("/api/marketing/gaokao-2026/e-coupons/{code}")
def gaokao_2026_get_e_coupon(code: str, phoneLast6: str = "") -> dict[str, Any]:
    coupon = find_gaokao_2026_coupon(code, phoneLast6)
    if not coupon:
        raise HTTPException(status_code=404, detail="电子优惠券不存在，或手机号后六位与校验码不匹配")
    return {
        "ok": True,
        "campaign": "gaokao2026",
        "coupon": public_gaokao_coupon_from_row(coupon),
        "updatedAt": now_iso(),
    }


@app.post("/api/marketing/gaokao-2026/e-coupons/redeem")
def gaokao_2026_redeem_e_coupon(payload: Gaokao2026CouponRedeemInput) -> dict[str, Any]:
    coupon = find_gaokao_2026_coupon(payload.code, payload.phoneLast6)
    if not coupon:
        raise HTTPException(status_code=404, detail="电子优惠券不存在，或手机号后六位与校验码不匹配")
    if str(coupon["status"] or "") == "redeemed":
        return {
            "ok": True,
            "alreadyRedeemed": True,
            "coupon": public_gaokao_coupon_from_row(coupon),
            "updatedAt": now_iso(),
        }
    now = now_iso()
    with retail_core.connect() as conn:
        conn.execute(
            """
            UPDATE gaokao_2026_coupon
            SET status = 'redeemed',
                redeemed_at = ?,
                redeemed_by = ?,
                redeem_device_id = ?,
                redeem_note = ?,
                updated_at = ?
            WHERE code = ?
            """,
            (
                now,
                normalize_gaokao_text(payload.operator or "ad-machine", 40) or "ad-machine",
                normalize_gaokao_text(payload.deviceId, 80),
                normalize_gaokao_text(payload.note, 200),
                now,
                str(coupon["code"]),
            ),
        )
        row = conn.execute("SELECT * FROM gaokao_2026_coupon WHERE code = ?", (str(coupon["code"]),)).fetchone()
    return {
        "ok": True,
        "alreadyRedeemed": False,
        "coupon": public_gaokao_coupon_from_row(row),
        "updatedAt": now,
    }


@app.get("/api/marketing/gaokao-2026/summary")
def gaokao_2026_summary() -> dict[str, Any]:
    init_gaokao_2026_lead_table()
    config = load_gaokao_coupon_config()
    with retail_core.connect() as conn:
        total = int(conn.execute("SELECT COUNT(*) AS value FROM gaokao_2026_lead").fetchone()["value"] or 0)
        coupon = int(
            conn.execute(
                "SELECT COUNT(*) AS value FROM gaokao_2026_lead WHERE source = 'coupon'"
            ).fetchone()["value"]
            or 0
        )
        issued_coupons = int(conn.execute("SELECT COUNT(*) AS value FROM gaokao_2026_coupon").fetchone()["value"] or 0)
        redeemed_coupons = int(
            conn.execute("SELECT COUNT(*) AS value FROM gaokao_2026_coupon WHERE status = 'redeemed'").fetchone()["value"]
            or 0
        )
        rows = conn.execute(
            """
            SELECT source, COUNT(*) AS count
            FROM gaokao_2026_lead
            GROUP BY source
            ORDER BY count DESC, source ASC
            """
        ).fetchall()
    return {
        "ok": True,
        "campaign": "gaokao2026",
        "totalLeads": total,
        "couponLeads": coupon,
        "issuedElectronicCoupons": issued_coupons,
        "redeemedElectronicCoupons": redeemed_coupons,
        "remainingElectronicCoupons": max(0, int(config["totalCount"]) - issued_coupons),
        "electronicCouponStartSequence": int(config["startSequence"]),
        "electronicCouponEndSequence": int(config["startSequence"]) + int(config["totalCount"]) - 1,
        "electronicCouponValidFrom": str(config["validFrom"]),
        "electronicCouponValidTo": str(config["validTo"]),
        "couponConfig": config,
        "sourceBreakdown": [{"source": str(row["source"] or ""), "count": int(row["count"] or 0)} for row in rows],
        "updatedAt": now_iso(),
    }


@app.get("/api/marketing/gaokao-2026/admin/customers")
def gaokao_2026_admin_customers(
    limit: int = 80,
    query: str = "",
    status: str = "",
    assigned_to: str = "",
    tag: str = "",
    due_today: int = 0,
) -> dict[str, Any]:
    items = list_gaokao_2026_customer_profiles(
        limit=limit,
        query=query,
        status=status,
        assigned_to=assigned_to,
        tag=tag,
        due_today=bool(int(due_today or 0)),
    )
    return {"ok": True, "items": items, "count": len(items), "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/admin/customers/stats")
def gaokao_2026_admin_customer_stats(query: str = "", assigned_to: str = "", tag: str = "", due_today: int = 0) -> dict[str, Any]:
    counts = get_gaokao_2026_customer_filter_counts(
        query=query,
        assigned_to=assigned_to,
        tag=tag,
        due_today=bool(int(due_today or 0)),
    )
    return {"ok": True, "counts": counts, "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/admin/customer-ops/summary")
def gaokao_2026_admin_customer_ops_summary() -> dict[str, Any]:
    summary = get_gaokao_2026_customer_ops_summary()
    return {"ok": True, "summary": summary, "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/admin/customers/export.csv")
def gaokao_2026_admin_customers_export(
    query: str = "",
    status: str = "",
    assigned_to: str = "",
    tag: str = "",
    due_today: int = 0,
) -> Response:
    items = list_gaokao_2026_customer_profiles(
        limit=5000,
        query=query,
        status=status,
        assigned_to=assigned_to,
        tag=tag,
        due_today=bool(int(due_today or 0)),
    )
    rows = [
        {
            "客户ID": item.get("id", ""),
            "姓名": item.get("name", ""),
            "手机号": item.get("phone", ""),
            "专业": item.get("major", ""),
            "预算": item.get("budget", ""),
            "到店时间": item.get("purchaseTime", ""),
            "需求归类": item.get("interest", ""),
            "客户留言": item.get("message", ""),
            "电子券号": (item.get("coupon") or {}).get("code", ""),
            "服务码": (item.get("coupon") or {}).get("serviceCode", ""),
            "电子券状态": (item.get("coupon") or {}).get("status", ""),
            "互动总数": (item.get("interaction") or {}).get("messageCount", 0),
            "咨询数": (item.get("interaction") or {}).get("consultCount", 0),
            "天禧AI助理对话数": (item.get("interaction") or {}).get("aiChatCount", 0),
            "最近互动状态": (item.get("interaction") or {}).get("latestStatus", ""),
            "最近互动时间": (item.get("interaction") or {}).get("lastInteractionAt", ""),
            "客户状态": item.get("status", ""),
            "负责人": (item.get("ops") or {}).get("assignedTo", ""),
            "跟进阶段": (item.get("ops") or {}).get("followUpStage", ""),
            "到店状态": (item.get("ops") or {}).get("visitStatus", ""),
            "成交状态": (item.get("ops") or {}).get("conversionStatus", ""),
            "成交机型": (item.get("ops") or {}).get("soldProductModel", ""),
            "成交日期": (item.get("ops") or {}).get("convertedAt", ""),
            "流失原因": (item.get("ops") or {}).get("lostReason", ""),
            "下次跟进时间": (item.get("ops") or {}).get("nextFollowUpAt", ""),
            "内部标签": " / ".join((item.get("ops") or {}).get("tags") or []),
            "来源": item.get("source", ""),
            "动作": item.get("action", ""),
            "创建时间": item.get("createdAt", ""),
            "更新时间": item.get("updatedAt", ""),
        }
        for item in items
    ]
    return _csv_response(
        "gaokao-customers.csv",
        rows,
        ["客户ID", "姓名", "手机号", "专业", "预算", "到店时间", "需求归类", "客户留言", "电子券号", "服务码", "电子券状态", "互动总数", "咨询数", "天禧AI助理对话数", "最近互动状态", "最近互动时间", "客户状态", "负责人", "跟进阶段", "到店状态", "成交状态", "成交机型", "成交日期", "流失原因", "下次跟进时间", "内部标签", "来源", "动作", "创建时间", "更新时间"],
    )


@app.get("/api/marketing/gaokao-2026/admin/customers/{customer_id}")
def gaokao_2026_admin_customer_detail(customer_id: str) -> dict[str, Any]:
    item = get_gaokao_2026_customer_detail(customer_id)
    return {"ok": True, "item": item, "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/admin/customers/{customer_id}/export.csv")
def gaokao_2026_admin_customer_detail_export(customer_id: str) -> Response:
    item = get_gaokao_2026_customer_detail(customer_id)
    rows = [
        {
            "客户ID": item.get("id", ""),
            "姓名": item.get("name", ""),
            "手机号": item.get("phone", ""),
            "专业": item.get("major", ""),
            "预算": item.get("budget", ""),
            "到店时间": item.get("purchaseTime", ""),
            "需求归类": item.get("interest", ""),
            "客户留言": item.get("message", ""),
            "客户状态": item.get("status", ""),
            "负责人": (item.get("ops") or {}).get("assignedTo", ""),
            "跟进阶段": (item.get("ops") or {}).get("followUpStage", ""),
            "到店状态": (item.get("ops") or {}).get("visitStatus", ""),
            "成交状态": (item.get("ops") or {}).get("conversionStatus", ""),
            "成交机型": (item.get("ops") or {}).get("soldProductModel", ""),
            "成交日期": (item.get("ops") or {}).get("convertedAt", ""),
            "流失原因": (item.get("ops") or {}).get("lostReason", ""),
            "下次跟进时间": (item.get("ops") or {}).get("nextFollowUpAt", ""),
            "偏好类目": " / ".join((item.get("ops") or {}).get("preferredCategories") or []),
            "内部标签": " / ".join((item.get("ops") or {}).get("tags") or []),
            "最新内部备注": (item.get("ops") or {}).get("latestNote", ""),
            "电子券号": (item.get("coupon") or {}).get("code", ""),
            "服务码": (item.get("coupon") or {}).get("serviceCode", ""),
            "电子券状态": (item.get("coupon") or {}).get("status", ""),
            "核销设备": (item.get("coupon") or {}).get("redeemDeviceId", ""),
            "核销备注": (item.get("coupon") or {}).get("redeemNote", ""),
            "互动总数": (item.get("interaction") or {}).get("messageCount", 0),
            "线程数": (item.get("interaction") or {}).get("threadCount", 0),
            "回访日志数": len(item.get("followUpLogs") or []),
        }
    ]
    filename = f"gaokao-customer-{normalize_gaokao_text(customer_id, 40) or 'detail'}.csv"
    return _csv_response(
        filename,
        rows,
        ["客户ID", "姓名", "手机号", "专业", "预算", "到店时间", "需求归类", "客户留言", "客户状态", "负责人", "跟进阶段", "到店状态", "成交状态", "成交机型", "成交日期", "流失原因", "下次跟进时间", "偏好类目", "内部标签", "最新内部备注", "电子券号", "服务码", "电子券状态", "核销设备", "核销备注", "互动总数", "线程数", "回访日志数"],
    )


@app.post("/api/marketing/gaokao-2026/admin/customers/{customer_id}/ops")
def gaokao_2026_admin_customer_update_ops(customer_id: str, payload: Gaokao2026CustomerOpsUpdateInput) -> dict[str, Any]:
    return update_gaokao_2026_customer_ops(customer_id, payload)


@app.post("/api/marketing/gaokao-2026/admin/customers/{customer_id}/follow-ups")
def gaokao_2026_admin_customer_create_follow_up(customer_id: str, payload: Gaokao2026CustomerFollowUpLogInput) -> dict[str, Any]:
    return create_gaokao_2026_follow_up_log(customer_id, payload)


@app.post("/api/marketing/gaokao-2026/admin/customers/{customer_id}/ops/quick-action")
def gaokao_2026_admin_customer_quick_action(customer_id: str, payload: Gaokao2026CustomerQuickActionInput) -> dict[str, Any]:
    return quick_action_gaokao_2026_customer_ops(customer_id, payload)


@app.get("/api/marketing/gaokao-2026/admin/coupons")
def gaokao_2026_admin_coupons(limit: int = 120, status: str = "", query: str = "") -> dict[str, Any]:
    items = list_gaokao_2026_admin_coupons(limit=limit, status=status, query=query)
    return {"ok": True, "items": items, "count": len(items), "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/admin/coupons/export.csv")
def gaokao_2026_admin_coupons_export(query: str = "", status: str = "") -> Response:
    items = list_gaokao_2026_admin_coupons(limit=5000, status=status, query=query)
    rows = [
        {
            "券ID": item.get("id", ""),
            "券号": item.get("code", ""),
            "服务码": item.get("serviceCode", ""),
            "客户姓名": item.get("customerName", ""),
            "客户手机号": item.get("customerPhone", ""),
            "专业": item.get("major", ""),
            "预算": item.get("budget", ""),
            "券状态": item.get("status", ""),
            "权益主数字": item.get("offerValue", ""),
            "副权益": item.get("offerSecondary", ""),
            "门店": item.get("storeName", ""),
            "门店电话": item.get("storePhone", ""),
            "校验规则": item.get("verifyRule", ""),
            "发放时间": item.get("issuedAt", ""),
            "核销时间": item.get("redeemedAt", ""),
            "核销人": item.get("redeemedBy", ""),
            "核销设备": item.get("redeemDeviceId", ""),
            "有效期开始": item.get("validFrom", ""),
            "有效期结束": item.get("validTo", ""),
        }
        for item in items
    ]
    return _csv_response(
        "gaokao-coupons.csv",
        rows,
        ["券ID", "券号", "服务码", "客户姓名", "客户手机号", "专业", "预算", "券状态", "权益主数字", "副权益", "门店", "门店电话", "校验规则", "发放时间", "核销时间", "核销人", "核销设备", "有效期开始", "有效期结束"],
    )


@app.get("/api/marketing/gaokao-2026/admin/coupon-config")
def gaokao_2026_admin_coupon_config() -> dict[str, Any]:
    config = load_gaokao_coupon_config()
    return {"ok": True, "config": config, "updatedAt": now_iso()}


@app.post("/api/marketing/gaokao-2026/admin/coupon-config")
def gaokao_2026_admin_update_coupon_config(payload: Gaokao2026CouponConfigUpdateInput) -> dict[str, Any]:
    return update_gaokao_coupon_config(payload)


@app.post("/api/marketing/gaokao-2026/portal/login")
def gaokao_2026_portal_login(payload: Gaokao2026PortalLoginInput) -> dict[str, Any]:
    return create_gaokao_portal_session(payload)


@app.get("/api/marketing/gaokao-2026/portal/feed")
def gaokao_2026_portal_feed(limit: int = 16) -> dict[str, Any]:
    return {"ok": True, "items": list_gaokao_portal_feed(limit), "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/portal/photo-feed")
def gaokao_2026_portal_photo_feed(limit: int = 10) -> dict[str, Any]:
    return {"ok": True, "items": list_gaokao_portal_photo_feed(limit), "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/portal/messages")
def gaokao_2026_portal_messages(phone: str, token: str, limit: int = 60) -> dict[str, Any]:
    return {"ok": True, "items": list_gaokao_portal_messages(phone, token, limit), "updatedAt": now_iso()}


@app.post("/api/marketing/gaokao-2026/portal/messages")
def gaokao_2026_portal_create_message(payload: Gaokao2026PortalMessageCreateInput) -> dict[str, Any]:
    return create_gaokao_portal_message(payload)


@app.get("/api/marketing/gaokao-2026/portal/admin/messages")
def gaokao_2026_portal_admin_messages(limit: int = 80, status: str = "", assigned_to: str = "") -> dict[str, Any]:
    return {"ok": True, "items": list_gaokao_admin_messages(limit, status, assigned_to), "updatedAt": now_iso()}


@app.get("/api/marketing/gaokao-2026/portal/admin/photo-messages")
def gaokao_2026_portal_admin_photo_messages(limit: int = 80, status: str = "", assigned_to: str = "") -> dict[str, Any]:
    return {"ok": True, "items": list_gaokao_admin_photo_messages(limit, status, assigned_to), "updatedAt": now_iso()}


@app.post("/api/marketing/gaokao-2026/portal/admin/messages/{message_id}/reply")
def gaokao_2026_portal_admin_reply(message_id: str, payload: Gaokao2026PortalReplyInput) -> dict[str, Any]:
    return reply_gaokao_admin_message(message_id, payload)


@app.post("/api/marketing/gaokao-2026/recommend")
def gaokao_2026_recommend_products(payload: Gaokao2026RecommendationInput) -> dict[str, Any]:
    return recommend_gaokao_products(payload)


@app.get("/api/marketing/gaokao-2026/knowledge-base")
def gaokao_2026_knowledge_base(query: str = "", major: str = "", budget: str = "", limit: int = 8) -> dict[str, Any]:
    return search_gaokao_ai_knowledge(query, major=major, budget=budget, limit=limit)


@app.get("/api/marketing/gaokao-2026/admin/knowledge-base")
def gaokao_2026_admin_knowledge_base(limit: int = 80) -> dict[str, Any]:
    snapshot = load_gaokao_ai_knowledge_admin_base()
    items = snapshot_items(snapshot, "items")
    safe_limit = max(1, min(int(limit or 80), 300))
    return {
        "ok": True,
        "generatedAt": snapshot.get("generatedAt", ""),
        "summary": snapshot.get("summary") or {},
        "items": items[:safe_limit],
    }


@app.get("/api/marketing/gaokao-2026/daily-learning")
def gaokao_2026_daily_learning() -> dict[str, Any]:
    snapshot = load_gaokao_daily_learning()
    return {
        "ok": True,
        "generatedAt": snapshot.get("generatedAt", ""),
        "summary": snapshot.get("summary") or {},
        "tracks": snapshot_items(snapshot, "tracks"),
        "dailyLearnings": snapshot_items(snapshot, "dailyLearnings"),
    }


@app.get("/api/marketing/gaokao-2026/admin/daily-learning")
def gaokao_2026_admin_daily_learning() -> dict[str, Any]:
    snapshot = load_gaokao_daily_learning()
    return {
        "ok": True,
        "generatedAt": snapshot.get("generatedAt", ""),
        "summary": snapshot.get("summary") or {},
        "tracks": snapshot_items(snapshot, "tracks"),
        "dailyLearnings": snapshot_items(snapshot, "dailyLearnings"),
    }


@app.get("/api/marketing/gaokao-2026/knowledge-guides")
def gaokao_2026_knowledge_guides(query: str = "", major: str = "", limit: int = 8) -> dict[str, Any]:
    return list_gaokao_major_guides(query=query, major=major, limit=limit)


@app.get("/api/marketing/gaokao-2026/admin/knowledge-guides")
def gaokao_2026_admin_knowledge_guides() -> dict[str, Any]:
    snapshot = load_gaokao_major_guides()
    return {
        "ok": True,
        "generatedAt": snapshot.get("generatedAt", ""),
        "summary": snapshot.get("summary") or {},
        "items": snapshot_items(snapshot, "items"),
    }


@app.get("/api/marketing/gaokao-2026/knowledge-guides/{guide_id}")
def gaokao_2026_knowledge_guide_detail(guide_id: str) -> dict[str, Any]:
    return get_gaokao_major_guide(guide_id)


@app.post("/api/marketing/gaokao-2026/ai-chat")
def gaokao_2026_ai_chat(payload: Gaokao2026AiChatInput) -> dict[str, Any]:
    return create_gaokao_ai_chat_reply(payload)


@app.post("/api/ad-machine/service-tickets")
def ad_machine_create_service_ticket(payload: AdMachineServiceTicketCreateInput) -> dict[str, Any]:
    runtime = load_ad_machine_runtime()
    tickets = runtime.get("serviceTickets", [])
    if not isinstance(tickets, list):
        tickets = []
    next_number = len(tickets) + 1
    code = f"A{next_number:03d}"
    ticket = {
        "id": f"ticket-{uuid.uuid4().hex[:12]}",
        "code": code,
        "category": payload.category.strip(),
        "customerName": payload.customerName.strip() or "现场客户",
        "phone": payload.phone.strip() or "未留手机",
        "createdAt": now_iso(),
        "status": "waiting",
    }
    tickets.append(ticket)
    runtime["serviceTickets"] = tickets[:1000]
    save_ad_machine_runtime(runtime)
    return {"ok": True, "ticket": ticket, "runtimeUpdatedAt": runtime.get("updatedAt")}


@app.post("/api/ad-machine/service-tickets/call-next")
def ad_machine_call_next_ticket() -> dict[str, Any]:
    runtime = load_ad_machine_runtime()
    tickets = runtime.get("serviceTickets", [])
    if not isinstance(tickets, list):
        tickets = []
    serving_id = None
    waiting_id = None
    for item in tickets:
        if isinstance(item, dict) and item.get("status") == "serving" and serving_id is None:
            serving_id = str(item.get("id") or "")
        if isinstance(item, dict) and item.get("status") == "waiting" and waiting_id is None:
            waiting_id = str(item.get("id") or "")
    for item in tickets:
        if not isinstance(item, dict):
            continue
        if serving_id and str(item.get("id") or "") == serving_id:
            item["status"] = "done"
        if waiting_id and str(item.get("id") or "") == waiting_id:
            item["status"] = "serving"
    runtime["serviceTickets"] = tickets
    save_ad_machine_runtime(runtime)
    return {"ok": True, "serviceTickets": tickets, "runtimeUpdatedAt": runtime.get("updatedAt")}


@app.get("/api/inventory-quote/summary")
def inventory_quote_summary() -> dict[str, Any]:
    return {
        "inventory": load_snapshot_from_sql_cache("latest-standard-inventory-snapshot.json"),
        "retailZone": load_snapshot_from_sql_cache("latest-retail-zone-snapshot.json"),
        "priceProtection": load_snapshot_from_sql_cache("latest-price-protection-snapshot.json"),
        "marketplacePrices": load_snapshot_from_sql_cache("latest-marketplace-price-snapshot.json"),
    }


def _load_display_controls_map() -> dict[str, bool]:
    payload = retail_core.list_frontend_display_controls()
    controls = payload.get("controls") if isinstance(payload.get("controls"), dict) else {}
    return {
        "showMarketingPo": bool(controls.get("showMarketingPo", True)),
        "showEducationSubsidy": bool(controls.get("showEducationSubsidy", True)),
    }


def _load_display_override_map() -> dict[str, dict[str, Any]]:
    payload = retail_core.list_frontend_activity_display_overrides()
    rows = payload.get("items") if isinstance(payload.get("items"), list) else []
    result: dict[str, dict[str, Any]] = {}
    for item in rows:
        if not isinstance(item, dict):
            continue
        sku_key = str(item.get("skuKey") or "").strip()
        if not sku_key:
            continue
        activity_id = str(item.get("activityId") or "").strip()
        if activity_id:
            result[f"{activity_id}::{sku_key}"] = item
        else:
            result[sku_key] = item
    return result


def _resolve_display_override(overrides: dict[str, dict[str, Any]], activity_id: str, sku_key: str) -> dict[str, Any] | None:
    normalized_sku_key = str(sku_key or "").strip()
    normalized_activity_id = str(activity_id or "").strip()
    if normalized_activity_id:
        exact_key = f"{normalized_activity_id}::{normalized_sku_key}"
        if exact_key in overrides:
            return overrides[exact_key]
    return overrides.get(normalized_sku_key)


def _apply_activity_display_controls(snapshot: dict[str, Any]) -> dict[str, Any]:
    controls = _load_display_controls_map()
    overrides = _load_display_override_map()
    show_marketing_po = controls["showMarketingPo"]
    show_education_subsidy = controls["showEducationSubsidy"]
    hide_marketing = not show_marketing_po
    hide_education = not show_education_subsidy
    if not hide_marketing and not hide_education and not overrides:
        return snapshot
    next_snapshot = json.loads(json.dumps(snapshot, ensure_ascii=False))
    def _apply_row_activity_override(row: dict[str, Any]) -> tuple[float, float, bool, bool, bool]:
        sku_key = str(row.get("skuKey") or "")
        activity_id = str(row.get("activityId") or "")
        override = _resolve_display_override(overrides, activity_id, sku_key) if sku_key else None
        category = str(row.get("activityCategory") or "").strip()
        marketing_amount = float(
            row.get("marketingPoAmount")
            or row.get("boostAmount")
            or 0
        )
        education_amount = float(row.get("educationDiscountAmount") or 0)
        has_marketing_payload = category != "education_discount" and (
            row.get("marketingPoAmount") is not None
            or row.get("boostAmount") is not None
            or row.get("poSalesPrice") is not None
            or category in {"po_boost", "aipc_campaign", "designated_ai_campaign"}
        )
        has_education_payload = category == "education_discount" or row.get("educationDiscountAmount") is not None
        marketing_visible = not hide_marketing
        education_visible = not hide_education
        price_recalc_required = hide_marketing or hide_education or isinstance(override, dict)
        if isinstance(override, dict):
            if not bool(override.get("marketingPoEnabled", True)):
                marketing_visible = False
            elif override.get("marketingPoAmount") is not None:
                marketing_amount = float(override["marketingPoAmount"])
            if not bool(override.get("educationSubsidyEnabled", True)):
                education_visible = False
            elif override.get("educationSubsidyAmount") is not None:
                education_amount = float(override["educationSubsidyAmount"])
        if not marketing_visible:
            marketing_amount = 0.0
            if "marketingPoActivity" in row:
                row["marketingPoActivity"] = None
            if "boostAmount" in row:
                row["boostAmount"] = 0
            if "marketingPoAmount" in row:
                row["marketingPoAmount"] = 0
            if "poSalesPrice" in row:
                row["poSalesPrice"] = None
        else:
            if "boostAmount" in row:
                row["boostAmount"] = marketing_amount
            if "marketingPoAmount" in row:
                row["marketingPoAmount"] = marketing_amount
        if not education_visible:
            education_amount = 0.0
            if "educationActivity" in row:
                row["educationActivity"] = None
            if "educationDiscountAmount" in row:
                row["educationDiscountAmount"] = 0
        else:
            if "educationDiscountAmount" in row:
                row["educationDiscountAmount"] = education_amount
        marketing_active = marketing_visible and has_marketing_payload
        education_active = education_visible and has_education_payload
        return marketing_amount, education_amount, marketing_active, education_active, price_recalc_required

    decisions = next_snapshot.get("decisions") if isinstance(next_snapshot.get("decisions"), dict) else None
    items = decisions.get("items") if isinstance(decisions, dict) and isinstance(decisions.get("items"), list) else []
    for row in items:
        if not isinstance(row, dict):
            continue
        marketing_po_amount, education_amount, _, _, price_recalc_required = _apply_row_activity_override(row)
        if price_recalc_required and "recommendedPreSubsidyPrice" in row:
            base_price = float(row.get("recommendedPreSubsidyPrice") or 0)
            store_manual_amount = float(row.get("storeManualPromotionAmount") or 0)
            adjusted_price = max(base_price - marketing_po_amount - education_amount - store_manual_amount, 0)
            final_price = product_library._standard_subsidy_price_from_pre_subsidy(
                adjusted_price,
                str(row.get("category") or ""),
                str(row.get("sourceCategory") or ""),
                str(row.get("jdSubcategory") or ""),
                str(row.get("productName") or ""),
                str(row.get("spec") or row.get("pnMtm") or ""),
            )
            if final_price is None:
                final_price = adjusted_price
            row["adjustedPreSubsidyPrice"] = adjusted_price
            row["fullServiceSubsidyPrice"] = final_price
            row["regularChannelSubsidyPrice"] = final_price
    eligible_inventory = next_snapshot.get("eligibleInventory")
    if isinstance(eligible_inventory, list):
        next_snapshot["eligibleInventory"] = [
            row
            for row in eligible_inventory
            if isinstance(row, dict) and any(_apply_row_activity_override(row)[2:4])
        ]
    hero_cards = next_snapshot.get("heroCards")
    if isinstance(hero_cards, list):
        next_snapshot["heroCards"] = [
            row
            for row in hero_cards
            if isinstance(row, dict) and any(_apply_row_activity_override(row)[2:4])
        ]
    summary = next_snapshot.get("summary")
    if isinstance(summary, dict):
        eligible_rows = next_snapshot.get("eligibleInventory") if isinstance(next_snapshot.get("eligibleInventory"), list) else []
        hero_rows = next_snapshot.get("heroCards") if isinstance(next_snapshot.get("heroCards"), list) else []
        summary["eligibleInventoryCount"] = len(eligible_rows)
        summary["heroCardCount"] = len(hero_rows)
        summary["totalEstimatedMarketingSupportAmount"] = round(sum(float((row.get("estimatedMarketingSupportAmount") or 0)) for row in hero_rows if isinstance(row, dict)), 2)
        summary["totalEstimatedCostGapAmount"] = round(sum(float((row.get("estimatedCostGapAmount") or 0)) for row in hero_rows if isinstance(row, dict)), 2)
    next_snapshot["displayControls"] = controls
    return next_snapshot


def _apply_projection_display_controls(snapshot: dict[str, Any]) -> dict[str, Any]:
    controls = _load_display_controls_map()
    overrides = _load_display_override_map()
    show_marketing_po = controls["showMarketingPo"]
    show_education_subsidy = controls["showEducationSubsidy"]
    hide_marketing = not show_marketing_po
    hide_education = not show_education_subsidy
    if not hide_marketing and not hide_education and not overrides:
        return snapshot
    next_snapshot = json.loads(json.dumps(snapshot, ensure_ascii=False))
    items = next_snapshot.get("items") if isinstance(next_snapshot.get("items"), list) else []
    for row in items:
        if not isinstance(row, dict):
            continue
        sku_key = str(row.get("skuKey") or "")
        pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
        marketing_activity = row.get("marketingPoActivity") if isinstance(row.get("marketingPoActivity"), dict) else None
        education_activity = row.get("educationActivity") if isinstance(row.get("educationActivity"), dict) else None
        marketing_override = _resolve_display_override(overrides, str((marketing_activity or {}).get("id") or ""), sku_key) if sku_key else None
        education_override = _resolve_display_override(overrides, str((education_activity or {}).get("id") or ""), sku_key) if sku_key else None
        if (
            not hide_marketing
            and not hide_education
            and not isinstance(marketing_override, dict)
            and not isinstance(education_override, dict)
        ):
            continue
        marketing_po_amount = float(pricing.get("marketingPoAmount") or 0)
        education_amount = float(pricing.get("educationDiscountAmount") or 0)
        if hide_marketing:
            marketing_po_amount = 0
            row["marketingPoActivity"] = None
        if hide_education:
            education_amount = 0
            row["educationActivity"] = None
        if isinstance(marketing_override, dict):
            if not bool(marketing_override.get("marketingPoEnabled", True)):
                marketing_po_amount = 0
                row["marketingPoActivity"] = None
            elif marketing_override.get("marketingPoAmount") is not None:
                marketing_po_amount = float(marketing_override["marketingPoAmount"])
        if isinstance(education_override, dict):
            if not bool(education_override.get("educationSubsidyEnabled", True)):
                education_amount = 0
                row["educationActivity"] = None
            elif education_override.get("educationSubsidyAmount") is not None:
                education_amount = float(education_override["educationSubsidyAmount"])
        base_price = float(pricing.get("storeRetailPrice") or 0)
        store_promotion = float(pricing.get("storeManualPromotionAmount") or 0)
        if base_price > 0:
            adjusted_price = max(base_price - marketing_po_amount - education_amount - store_promotion, 0)
            final_price = product_library._standard_subsidy_price_from_pre_subsidy(
                adjusted_price,
                str(row.get("category") or ""),
                str(row.get("sourceCategory") or ""),
                str(row.get("jdSubcategory") or ""),
                str(row.get("displayTitle") or row.get("productName") or ""),
                str(row.get("spec") or row.get("pnMtm") or ""),
            )
            if final_price is None:
                final_price = adjusted_price
        else:
            # Some accessories have no platform main price but still carry a locked
            # fallback display price. Display-control recalculation must not zero it.
            adjusted_price = float(pricing.get("adjustedPreSubsidyPrice") or pricing.get("finalPrice") or 0)
            final_price = float(pricing.get("finalPrice") or pricing.get("nationalSubsidyPrice") or adjusted_price)
        pricing["marketingPoAmount"] = marketing_po_amount
        pricing["educationDiscountAmount"] = education_amount
        pricing["adjustedPreSubsidyPrice"] = adjusted_price
        pricing["nationalSubsidyPrice"] = final_price
        pricing["finalPrice"] = final_price
        row["pricing"] = pricing
        activity_labels = row.get("activityLabels") if isinstance(row.get("activityLabels"), list) else []
        if store_promotion > 0 and row.get("storeManualPromotion") and "店面活动" not in activity_labels:
            activity_labels = [*activity_labels, "店面活动"]
        row["activityLabels"] = activity_labels
        channel_views = row.get("channelViews") if isinstance(row.get("channelViews"), dict) else {}
        for view_key in ("retailHero", "cashier", "adMachine"):
            view = channel_views.get(view_key)
            if not isinstance(view, dict):
                continue
            view["adjustedPreSubsidyPrice"] = adjusted_price
            view["nationalSubsidyPrice"] = final_price
            view["finalPrice"] = final_price
            view["marketingPoAmount"] = marketing_po_amount
            view["educationDiscountAmount"] = education_amount
            view["storeManualPromotionAmount"] = store_promotion
            view["marketingPoActivity"] = row.get("marketingPoActivity")
            view["educationActivity"] = row.get("educationActivity")
            view["storeManualPromotion"] = row.get("storeManualPromotion")
            view["activityLabels"] = activity_labels
        row["channelViews"] = channel_views
    next_snapshot["displayControls"] = controls
    return next_snapshot


def _overlay_retail_zone_prices_from_projection(snapshot: dict[str, Any]) -> dict[str, Any]:
    decisions = snapshot.get("decisions") if isinstance(snapshot.get("decisions"), dict) else None
    items = decisions.get("items") if isinstance(decisions, dict) and isinstance(decisions.get("items"), list) else []
    if not items:
        return snapshot
    full_projection = _apply_projection_display_controls(load_snapshot_from_sql_cache("latest-published-product-projection.json", required=False, default={}))
    live_projection = _apply_projection_display_controls(load_snapshot_from_sql_cache("latest-published-product-projection-live.json", required=False, default={}))
    full_projection_items = full_projection.get("items") if isinstance(full_projection.get("items"), list) else []
    live_projection_items = live_projection.get("items") if isinstance(live_projection.get("items"), list) else []
    projection_by_sku = {
        str(item.get("skuKey") or ""): item
        for item in full_projection_items
        if isinstance(item, dict) and str(item.get("skuKey") or "").strip()
    }
    projection_by_sku.update({
        str(item.get("skuKey") or ""): item
        for item in live_projection_items
        if isinstance(item, dict) and str(item.get("skuKey") or "").strip()
    })
    if not projection_by_sku:
        return snapshot
    next_snapshot = json.loads(json.dumps(snapshot, ensure_ascii=False))
    next_decisions = next_snapshot.get("decisions") if isinstance(next_snapshot.get("decisions"), dict) else {}
    next_items = next_decisions.get("items") if isinstance(next_decisions.get("items"), list) else []
    for row in next_items:
        if not isinstance(row, dict):
            continue
        projection_item = projection_by_sku.get(str(row.get("skuKey") or ""))
        if not isinstance(projection_item, dict):
            continue
        pricing = projection_item.get("pricing") if isinstance(projection_item.get("pricing"), dict) else {}
        if not pricing:
            continue
        store_price = pricing.get("storeRetailPrice")
        adjusted_price = pricing.get("adjustedPreSubsidyPrice")
        final_price = pricing.get("finalPrice")
        if store_price is not None:
            row["recommendedPreSubsidyPrice"] = store_price
            row["floorPreSubsidyPrice"] = store_price
        if adjusted_price is not None:
            row["adjustedPreSubsidyPrice"] = adjusted_price
        if final_price is not None:
            row["fullServiceSubsidyPrice"] = final_price
            row["regularChannelSubsidyPrice"] = final_price
        for source_key, target_key in (
            ("jdPrice", "jdPrice"),
            ("lenovoOfficialPrice", "lenovoOfficialPrice"),
            ("taobaoPrice", "taobaoPrice"),
            ("marketingPoAmount", "marketingPoAmount"),
            ("educationDiscountAmount", "educationDiscountAmount"),
            ("storeManualPromotionAmount", "storeManualPromotionAmount"),
        ):
            if pricing.get(source_key) is not None:
                row[target_key] = pricing.get(source_key)
        row["storePriceSource"] = pricing.get("storePriceSource") or row.get("storePriceSource")
        row["storePricePolicy"] = pricing.get("storePricePolicy") or row.get("storePricePolicy")
        row["marketingPoActivity"] = projection_item.get("marketingPoActivity") or row.get("marketingPoActivity")
        row["educationActivity"] = projection_item.get("educationActivity") or row.get("educationActivity")
        row["storeManualPromotion"] = projection_item.get("storeManualPromotion") or row.get("storeManualPromotion")
    next_snapshot["source"] = f"{snapshot.get('source', 'inventory_quote.retail_zone')}:published_projection_price_overlay"
    return next_snapshot


@app.get("/api/inventory-quote/inventory")
def inventory_quote_inventory(compact: bool = False) -> dict[str, Any]:
    now = time.time()
    cached_payload = INVENTORY_SNAPSHOT_CACHE.get("payload")
    expires_at = float(INVENTORY_SNAPSHOT_CACHE.get("expires_at") or 0.0)
    if isinstance(cached_payload, dict) and expires_at > now:
        snapshot = cached_payload
    else:
        snapshot = load_snapshot_from_sql_cache("latest-adjusted-inventory-snapshot.json")
        INVENTORY_SNAPSHOT_CACHE["payload"] = snapshot
        INVENTORY_SNAPSHOT_CACHE["expires_at"] = now + 10.0
    if not compact:
        return snapshot
    compact_snapshot = dict(snapshot)
    compact_categories = []
    for category in snapshot.get("categories", []):
        if not isinstance(category, dict):
            continue
        compact_categories.append({
            "category": category.get("category"),
            "skuCount": category.get("skuCount"),
            "currentStock": category.get("currentStock"),
            "sellableStock": category.get("sellableStock"),
            "unsellableStock": category.get("unsellableStock"),
            "pendingInboundStock": category.get("pendingInboundStock"),
            "serialCount": category.get("serialCount"),
            "topSkus": [
                {
                    "skuKey": item.get("skuKey"),
                    "productName": item.get("productName"),
                    "pnMtm": item.get("pnMtm"),
                    "currentStock": item.get("currentStock"),
                    "sellableStock": item.get("sellableStock"),
                    "unsellableStock": item.get("unsellableStock"),
                    "physicalHoldStock": item.get("physicalHoldStock"),
                }
                for item in category.get("topSkus", [])
                if isinstance(item, dict)
            ],
        })
    compact_skus = []
    for sku in snapshot.get("skus", []):
        if not isinstance(sku, dict):
            continue
        compact_skus.append({
            "skuKey": sku.get("skuKey"),
            "productName": sku.get("productName"),
            "pnMtm": sku.get("pnMtm"),
            "spec": sku.get("spec"),
            "category": sku.get("category"),
            "sourceCategory": sku.get("sourceCategory"),
            "jdSubcategory": sku.get("jdSubcategory"),
            "currentStock": sku.get("currentStock"),
            "sellableStock": sku.get("sellableStock"),
            "occupiedStock": sku.get("occupiedStock"),
            "unsellableStock": sku.get("unsellableStock"),
            "pendingInboundStock": sku.get("pendingInboundStock"),
            "physicalHoldStock": sku.get("physicalHoldStock"),
            "physicalHoldSerialCount": sku.get("physicalHoldSerialCount"),
            "serialCount": sku.get("serialCount"),
            "serials": [],
            "dataQuality": sku.get("dataQuality"),
        })
    compact_snapshot["categories"] = compact_categories
    compact_snapshot["skus"] = compact_skus
    compact_snapshot["source"] = f"{snapshot.get('source', 'sqlite.retail_core_adjusted')}:compact"
    return compact_snapshot


@app.get("/api/inventory-quote/retail-zone")
def inventory_quote_retail_zone(compact: bool = False) -> dict[str, Any]:
    snapshot = _overlay_retail_zone_prices_from_projection(
        _apply_activity_display_controls(load_snapshot_from_sql_cache("latest-retail-zone-snapshot.json"))
    )
    if not compact:
        return snapshot
    decisions = snapshot.get("decisions") if isinstance(snapshot.get("decisions"), dict) else {}
    items = decisions.get("items") if isinstance(decisions.get("items"), list) else []
    compact_items: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        compact_item = dict(item)
        compact_item.pop("priceSources", None)
        match_info = compact_item.get("match")
        if isinstance(match_info, dict):
            compact_item["match"] = {
                "status": match_info.get("status"),
                "confidence": match_info.get("confidence"),
                "primarySkuKey": match_info.get("primarySkuKey"),
            }
        compact_items.append(compact_item)
    compact_snapshot = dict(snapshot)
    compact_snapshot["decisions"] = {
        **decisions,
        "items": compact_items,
    }
    compact_snapshot["source"] = f"{snapshot.get('source', 'inventory_quote.retail_zone')}:compact"
    return compact_snapshot


@app.get("/api/inventory-quote/published-product-projection")
def inventory_quote_published_product_projection(scope: str = "live", refresh: bool = False) -> dict[str, Any]:
    if refresh:
        ensure_product_library_seeded(force=True)
        product_library.write_published_product_projection_snapshots(DATA_DIR)
    full_payload = load_snapshot_from_sql_cache("latest-published-product-projection.json")
    if scope == "all":
        return _apply_projection_display_controls(full_payload)
    return _apply_projection_display_controls(product_library.build_live_published_product_projection(full_payload))


@app.get("/api/inventory-quote/published-product-channel-audit")
def inventory_quote_published_product_channel_audit() -> dict[str, Any]:
    ensure_product_library_seeded()
    product_library.write_published_product_projection_snapshots(DATA_DIR)
    return load_snapshot_from_sql_cache("latest-published-product-channel-audit.json")


@app.get("/api/inventory-quote/price-protection")
def inventory_quote_price_protection() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-price-protection-snapshot.json")


@app.get("/api/inventory-quote/marketing-boost")
def inventory_quote_marketing_boost() -> dict[str, Any]:
    return _apply_activity_display_controls(load_snapshot_from_sql_cache("latest-marketing-boost-snapshot.json"))


@app.get("/api/inventory-quote/marketing-boost-hero")
def inventory_quote_marketing_boost_hero() -> dict[str, Any]:
    try:
        return _apply_activity_display_controls(load_snapshot_from_sql_cache("latest-marketing-boost-hero-snapshot.json"))
    except HTTPException as error:
        if error.status_code != 404:
            raise
        return _apply_activity_display_controls(load_snapshot_from_sql_cache("latest-marketing-boost-snapshot.json"))


@app.get("/api/inventory-quote/frontend-display-controls")
def inventory_quote_frontend_display_controls() -> dict[str, Any]:
    return retail_core.list_frontend_display_controls()


@app.post("/api/inventory-quote/frontend-display-controls")
def save_inventory_quote_frontend_display_controls(payload: FrontendDisplayControlsInput) -> dict[str, Any]:
    return retail_core.save_frontend_display_controls(
        show_marketing_po=payload.showMarketingPo,
        show_education_subsidy=payload.showEducationSubsidy,
    )


@app.get("/api/inventory-quote/frontend-activity-display-catalog")
def inventory_quote_frontend_activity_display_catalog() -> dict[str, Any]:
    return retail_core.list_frontend_activity_display_catalog()


@app.get("/api/inventory-quote/frontend-activity-display-overrides")
def inventory_quote_frontend_activity_display_overrides() -> dict[str, Any]:
    return retail_core.list_frontend_activity_display_overrides()


@app.post("/api/inventory-quote/frontend-activity-display-overrides")
def save_inventory_quote_frontend_activity_display_overrides(payload: FrontendActivityDisplayOverrideInput) -> dict[str, Any]:
    try:
        return retail_core.save_frontend_activity_display_override(
            activity_id=payload.activityId,
            sku_key=payload.skuKey,
            marketing_po_enabled=payload.marketingPoEnabled,
            marketing_po_amount=payload.marketingPoAmount,
            education_subsidy_enabled=payload.educationSubsidyEnabled,
            education_subsidy_amount=payload.educationSubsidyAmount,
            note=payload.note,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/inventory-quote/education-agent-scan")
def inventory_quote_education_agent_scan() -> dict[str, Any]:
    local_sync.write_static_snapshots(DATA_DIR)
    payload = load_snapshot_from_sql_cache(
        "latest-education-subsidy-agent-scan-summary.json",
        default={"rows": [], "summary": {}},
        required=False,
    )
    return payload


@app.get("/api/inventory-quote/education-agent-scan-sync-gap")
def inventory_quote_education_agent_scan_sync_gap() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-education-agent-scan-sync-gap.json", default={"items": [], "count": 0}, required=False)


@app.get("/api/inventory-quote/manual-overrides")
def inventory_quote_manual_overrides() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-manual-price-overrides.json")


@app.post("/api/inventory-quote/manual-overrides")
def save_inventory_quote_manual_overrides(payload: ManualPriceOverridesInput) -> dict[str, Any]:
    result = retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-manual-price-overrides.json",
        {
            "overrides": payload.overrides,
        },
        source_system="api.inventory_quote.manual_overrides",
    )
    ensure_product_library_seeded(force=True)
    local_sync.rebuild_product_library_views(
        trigger="inventory_quote_manual_overrides",
        operator="codex",
        scope="pricing",
    )
    local_sync.write_static_snapshots(DATA_DIR)
    retail_core.sync_snapshot_cache(
        DATA_DIR,
        [
            "latest-manual-price-overrides.json",
            "latest-retail-zone-snapshot.json",
        ],
    )
    return {
        **result["snapshot"],
        "retailZone": load_snapshot_from_sql_cache("latest-retail-zone-snapshot.json"),
    }


@app.get("/api/inventory-quote/store-manual-promotions")
def inventory_quote_store_manual_promotions() -> dict[str, Any]:
    return retail_core.list_store_manual_promotions()


@app.get("/api/inventory-quote/manufacturer-manual-promotions")
def inventory_quote_manufacturer_manual_promotions() -> dict[str, Any]:
    return retail_core.list_manufacturer_manual_promotions()


@app.get("/api/inventory-quote/cross-outbound-check-rules")
def inventory_quote_cross_outbound_check_rules() -> dict[str, Any]:
    return retail_core.list_cross_outbound_check_rules()


@app.post("/api/inventory-quote/cross-outbound-check-rules")
def save_inventory_quote_cross_outbound_check_rules(payload: CrossOutboundCheckRulesInput) -> dict[str, Any]:
    return retail_core.save_cross_outbound_check_rules(
        [item.model_dump() for item in payload.items]
    )


@app.get("/api/inventory-quote/cross-outbound-check-history")
def inventory_quote_cross_outbound_check_history() -> dict[str, Any]:
    return retail_core.list_cross_outbound_check_history()


@app.post("/api/inventory-quote/cross-outbound-check-history")
def save_inventory_quote_cross_outbound_check_history(payload: CrossOutboundCheckHistoryInput) -> dict[str, Any]:
    return retail_core.save_cross_outbound_check_history(
        [item.model_dump() for item in payload.items]
    )


@app.get("/api/inventory-quote/product-activities")
def inventory_quote_product_activities() -> dict[str, Any]:
    return retail_core.list_product_activity_current()


@app.post("/api/inventory-quote/store-manual-promotions")
def save_inventory_quote_store_manual_promotions(payload: StoreManualPromotionsInput) -> dict[str, Any]:
    return retail_core.save_store_manual_promotions(
        [item.model_dump() for item in payload.items]
    )


@app.post("/api/inventory-quote/manufacturer-manual-promotions")
def save_inventory_quote_manufacturer_manual_promotions(payload: ManufacturerManualPromotionsInput) -> dict[str, Any]:
    return retail_core.save_manufacturer_manual_promotions(
        [item.model_dump() for item in payload.items]
    )


@app.get("/api/inventory-quote/inventory-adjustments")
def inventory_quote_inventory_adjustments() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-inventory-adjustments.json")


@app.post("/api/inventory-quote/inventory-adjustments")
def save_inventory_quote_inventory_adjustments(payload: InventoryAdjustmentsInput) -> dict[str, Any]:
    result = retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-inventory-adjustments.json",
        {
            "adjustments": payload.adjustments,
        },
        source_system="api.inventory_quote.inventory_adjustments",
    )
    retail_core.sync_snapshot_cache(
        DATA_DIR,
        [
            "latest-inventory-adjustments.json",
            "latest-adjusted-inventory-snapshot.json",
            "latest-retail-zone-snapshot.json",
        ],
    )
    return {
        **result["snapshot"],
        "inventory": load_snapshot_from_sql_cache("latest-adjusted-inventory-snapshot.json"),
        "retailZone": load_snapshot_from_sql_cache("latest-retail-zone-snapshot.json"),
    }


@app.get("/api/inventory-quote/inventory-movements")
def inventory_quote_inventory_movements() -> dict[str, Any]:
    payload = build_inventory_movements_snapshot_from_sql()
    retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-inventory-movements.json",
        payload,
        source_system="api.inventory_movements.sql_mirror",
    )
    return payload


@app.get("/api/inventory-quote/serial-overrides")
def inventory_quote_serial_overrides() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-serial-overrides.json")


@app.get("/api/inventory-quote/prices")
def inventory_quote_prices() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-marketplace-price-snapshot.json")


@app.get("/api/inventory-quote/inventory-master")
def inventory_quote_inventory_master() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-inventory-master-snapshot.json")


@app.get("/api/inventory-quote/distributor-quotes")
def inventory_quote_distributor_quotes() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-distributor-quotes.json")


@app.get("/api/inventory-quote/price-signals")
def inventory_quote_price_signals() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-retail-core-price-signals.json")


@app.get("/api/inventory-quote/gray-wholesale")
def inventory_quote_gray_wholesale() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-gray-wholesale-quotes.json")


@app.get("/api/inventory-quote/competitor-monitor")
def inventory_quote_competitor_monitor() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-competitor-monitor.json")


@app.get("/api/inventory-quote/product-url-locks")
def inventory_quote_product_url_locks() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-product-url-locks.json")


@app.get("/api/inventory-quote/warranty")
def inventory_quote_warranty() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-lenovo-warranty-snapshot.json")


@app.get("/api/inventory-quote/warranty-check-queue")
def inventory_quote_warranty_check_queue() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-warranty-check-queue.json")


@app.get("/api/sales/staff")
def sales_staff() -> dict[str, Any]:
    ledger = load_sales_ledger()
    return {"items": ledger.get("staff", [])}


@app.get("/api/sales/orders")
def sales_orders() -> dict[str, Any]:
    ledger = load_sales_ledger()
    items = ledger.get("salesOrders", [])
    return {"items": items, "count": len(items)}


@app.post("/api/sales/orders")
def create_sales_order(payload: SalesOrderCreateInput) -> dict[str, Any]:
    ledger = load_sales_ledger()
    staff = [item for item in ledger.get("staff", []) if isinstance(item, dict)]
    operator_exists = any(
        item.get("id") == payload.operatorId and item.get("active", True) for item in staff
    )
    if not operator_exists:
        raise HTTPException(
            status_code=400,
            detail={"error": "operator_not_found", "operatorId": payload.operatorId},
        )

    order_index = len(ledger.get("salesOrders", [])) + 1
    order_id = f"SO-{datetime.now().strftime('%Y%m%d')}-{order_index:04d}"
    business_date = datetime.now().strftime("%Y-%m-%d")
    normalized_status = payload.status.strip() or "completed"
    if normalized_status not in {"completed", "reserved"}:
        raise HTTPException(
            status_code=400,
            detail={"error": "unsupported_sales_order_status", "status": payload.status},
        )
    serial_count = sum(len(line.serialNumbers) for line in payload.lines)
    order = {
        "id": order_id,
        "storeCode": payload.storeCode,
        "operatorId": payload.operatorId,
        "customerName": payload.customerName,
        "note": payload.note,
        "businessDate": business_date,
        "status": normalized_status,
        "lineCount": len(payload.lines),
        "serialCount": serial_count,
        "totalAmount": round(sum(line.dealPrice * line.quantity for line in payload.lines), 2),
        "lines": [line.model_dump() for line in payload.lines],
        "createdAt": now_iso(),
    }
    validation_errors = retail_core.validate_sales_order(order)
    if validation_errors:
        raise HTTPException(
            status_code=400,
            detail={"error": "sales_order_validation_failed", "items": validation_errors},
        )

    sales_orders_list = ledger.get("salesOrders", [])
    if not isinstance(sales_orders_list, list):
        sales_orders_list = []
    sales_orders_list.append(order)
    ledger["salesOrders"] = sales_orders_list

    created_movements = 0 if normalized_status == "reserved" else count_sales_movements(payload.lines)
    sync_tasks = ledger.get("syncTasks", [])
    if not isinstance(sync_tasks, list):
        sync_tasks = []
    if normalized_status != "reserved":
        sync_tasks.append(
            {
                "id": f"SYNC-{order_id}",
                "taskType": "push_sale_to_zhidiantong",
                "orderId": order_id,
                "status": "pending",
                "retryCount": 0,
                "lastError": "",
                "createdAt": now_iso(),
            }
        )
    ledger["syncTasks"] = sync_tasks
    save_sales_ledger(ledger)
    retail_core.record_sales_order(order)
    refresh_inventory_movements_sql_mirror()
    refresh_result = refresh_retail_core_runtime_mirrors()
    pending_sync_task_id = ""
    if normalized_status != "reserved":
        pending_sync_task_id = f"SYNC-{order_id}"
        retail_core.enqueue_sync_task(
            task_id=pending_sync_task_id,
            external_system_id="zhidiantong",
            task_type="push_sale_to_zhidiantong",
            entity_type="sales_order",
            entity_id=order_id,
            payload=order,
        )

    return {
        "ok": True,
        "orderId": order_id,
        "status": normalized_status,
        "createdMovements": created_movements,
        "pendingSyncTaskId": pending_sync_task_id,
        "refreshed": refresh_result,
    }


@app.delete("/api/sales/orders/{order_id}")
def delete_sales_order(order_id: str) -> dict[str, Any]:
    ledger = load_sales_ledger()
    try:
        result = retail_core.delete_sales_order(order_id)
    except ValueError as error:
        message = str(error)
        if message == "sales_order_already_synced":
            raise HTTPException(
                status_code=409,
                detail={"error": "sales_order_already_synced", "orderId": order_id},
            ) from error
        if message == "sales_order_already_reconciled":
            raise HTTPException(
                status_code=409,
                detail={"error": "sales_order_already_reconciled", "orderId": order_id},
            ) from error
        raise

    if not result:
        raise HTTPException(
            status_code=404,
            detail={"error": "sales_order_not_found", "orderId": order_id},
        )

    sales_orders_list = [
        item
        for item in ledger.get("salesOrders", [])
        if isinstance(item, dict) and item.get("id") != order_id
    ]
    ledger["salesOrders"] = sales_orders_list
    sync_tasks = [
        item
        for item in ledger.get("syncTasks", [])
        if isinstance(item, dict)
        and item.get("orderId") != order_id
        and item.get("id") != f"SYNC-{order_id}"
    ]
    ledger["syncTasks"] = sync_tasks
    save_sales_ledger(ledger)
    refresh_inventory_movements_sql_mirror()
    refresh_result = refresh_retail_core_runtime_mirrors()
    result["refreshed"] = refresh_result
    return result


@app.post("/api/purchases/orders")
def create_purchase_order(payload: PurchaseOrderCreateInput) -> dict[str, Any]:
    order_id = f"PO-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    business_date = datetime.now().strftime("%Y-%m-%d")
    lines = []
    for line in payload.lines:
        serial_numbers = [
            serial.strip()
            for serial in line.serialNumbers
            if serial.strip()
        ]
        line_quantity = len(serial_numbers) if serial_numbers else line.quantity
        lines.append({
            **line.model_dump(),
            "quantity": line_quantity,
            "serialNumbers": serial_numbers,
        })
    order = {
        "id": order_id,
        "supplierId": payload.supplierId,
        "operatorId": payload.operatorId,
        "locationCode": payload.locationCode,
        "note": payload.note,
        "businessDate": business_date,
        "status": "completed",
        "lineCount": len(lines),
        "serialCount": sum(len(line["serialNumbers"]) for line in lines),
        "totalAmount": round(
            sum((line.get("costPrice") or 0) * line["quantity"] for line in lines),
            2,
        ),
        "lines": lines,
        "createdAt": now_iso(),
    }
    retail_core.record_purchase_order(order)
    retail_core.enqueue_sync_task(
        task_id=f"SYNC-{order_id}",
        external_system_id="zhidiantong",
        task_type="push_purchase_to_zhidiantong",
        entity_type="purchase_order",
        entity_id=order_id,
        payload=order,
    )
    refresh_inventory_movements_sql_mirror()
    refresh_result = refresh_retail_core_runtime_mirrors()
    return {
        "ok": True,
        "orderId": order_id,
        "serialCount": order["serialCount"],
        "pendingSyncTaskId": f"SYNC-{order_id}",
        "refreshed": refresh_result,
    }


@app.get("/api/sales/sync-tasks")
def sales_sync_tasks() -> dict[str, Any]:
    ledger = load_sales_ledger()
    items = ledger.get("syncTasks", [])
    return {
        "items": items,
        "count": len(items),
        "coreTasks": retail_core.list_sync_tasks(),
    }


@app.get("/api/retail-core/status")
def retail_core_status() -> dict[str, Any]:
    now = time.time()
    cached_payload = RETAIL_CORE_STATUS_CACHE.get("payload")
    expires_at = float(RETAIL_CORE_STATUS_CACHE.get("expires_at") or 0.0)
    if isinstance(cached_payload, dict) and expires_at > now:
        return cached_payload
    seed_result = safe_seed_reference_data()
    product_seed = safe_seed_product_library()
    seeded_summary = seed_result.get("seeded") if isinstance(seed_result.get("seeded"), dict) else {}
    payload = {
        "database": seed_result["database"],
        "seeded": {
            "skus": seeded_summary.get("skus", seed_result.get("seededSkus", 0)),
            "serials": seeded_summary.get("serials", seed_result.get("seededSerials", 0)),
            "movements": seeded_summary.get("movements", seed_result.get("seededMovements", 0)),
            "salesOrders": seeded_summary.get("salesOrders", seed_result.get("syncedSalesOrders", 0)),
            "orderRegistry": seeded_summary.get("orderRegistry", seed_result.get("syncedOrderRegistry", 0)),
            "warrantyRecords": seeded_summary.get("warrantyRecords", seed_result.get("syncedWarrantyRecords", 0)),
            "productLibraryProducts": product_seed.get("productCount", 0),
            "productLibraryEvidence": product_seed.get("evidenceCount", 0),
            "productLibrarySourceLinks": product_seed.get("sourceLinkCount", 0),
        },
        "seedError": seed_result.get("seedError") or product_seed.get("seedError"),
        "tableCounts": retail_core.table_counts(),
    }
    RETAIL_CORE_STATUS_CACHE["payload"] = payload
    RETAIL_CORE_STATUS_CACHE["expires_at"] = now + 15.0
    return payload


@app.post("/api/retail-core/resync-warranty")
def retail_core_resync_warranty() -> dict[str, Any]:
    seed_result = safe_seed_reference_data(force=True)
    return {
        "ok": True,
        "database": seed_result["database"],
        "syncedWarrantyRecords": seed_result.get("syncedWarrantyRecords", 0),
        "seedError": seed_result.get("seedError"),
        "tableCounts": retail_core.table_counts(),
    }


@app.get("/api/retail-core/category-tree")
def retail_core_category_tree() -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_category_tree()


@app.get("/api/retail-core/serial-items")
def retail_core_serial_items(limit: int = 80) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_serial_items(limit=limit)


@app.get("/api/retail-core/physical-stock-holds")
def retail_core_physical_stock_holds(limit: int = 5000, status: str = "") -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_physical_stock_holds(limit=limit, status=status)


@app.get("/api/retail-core/physical-stock-holds/sales-order-candidates")
def retail_core_physical_stock_hold_sales_order_candidates(
    limit: int = 120,
    keyword: str = "",
    transfer_status: str = "",
) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_physical_hold_sales_order_candidates(
        limit=limit,
        keyword=keyword,
        transfer_status=transfer_status,
    )


@app.post("/api/retail-core/physical-stock-holds/transfer-from-sales-order")
def retail_core_transfer_physical_stock_hold(
    payload: PhysicalStockHoldTransferInput,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    result = retail_core.transfer_sales_order_serials_to_physical_hold(
        payload.orderNumber,
        serial_numbers=payload.serialNumbers,
        hold_reason=payload.holdReason,
        note=payload.note,
        operator_name=payload.operatorName,
    )
    schedule_retail_core_runtime_refresh(background_tasks)
    if int(result.get("transferredCount", 0) or 0) > 0:
        schedule_inventory_master_auto_sync(
            background_tasks,
            trigger="physical_hold_transfer",
            operator=payload.operatorName,
            source=payload.orderNumber,
            force=True,
        )
    return {**result, "mirrorRefresh": "background"}


@app.post("/api/retail-core/physical-stock-holds/finalize-service-outbound")
def retail_core_finalize_physical_stock_hold(
    payload: PhysicalStockHoldFinalizeInput,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    result = retail_core.finalize_physical_hold_from_service_orders(
        service_order_no=payload.serviceOrderNo,
        serial_numbers=payload.serialNumbers,
        note=payload.note,
        operator_name=payload.operatorName,
    )
    schedule_retail_core_runtime_refresh(background_tasks)
    if int(result.get("finalizedCount", 0) or 0) > 0:
        schedule_inventory_master_auto_sync(
            background_tasks,
            trigger="physical_hold_finalize",
            operator=payload.operatorName,
            source=payload.serviceOrderNo,
            force=True,
        )
    return {**result, "mirrorRefresh": "background"}


@app.post("/api/retail-core/physical-stock-holds/release-to-store")
def retail_core_release_physical_stock_hold(
    payload: PhysicalStockHoldReleaseInput,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    result = retail_core.release_physical_hold_to_store(
        payload.serialNumbers,
        note=payload.note,
        operator_name=payload.operatorName,
    )
    schedule_retail_core_runtime_refresh(background_tasks)
    if int(result.get("releasedCount", 0) or 0) > 0:
        schedule_inventory_master_auto_sync(
            background_tasks,
            trigger="physical_hold_release",
            operator=payload.operatorName,
            source="release_to_store",
            force=True,
        )
    return {**result, "mirrorRefresh": "background"}


@app.post("/api/retail-core/physical-stock-holds/revoke-transfer")
def retail_core_revoke_physical_stock_hold(
    payload: PhysicalStockHoldRevokeInput,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    result = retail_core.revoke_physical_hold_transfer(
        payload.serialNumbers,
        note=payload.note,
        operator_name=payload.operatorName,
    )
    schedule_retail_core_runtime_refresh(background_tasks)
    if int(result.get("revokedCount", 0) or 0) > 0:
        schedule_inventory_master_auto_sync(
            background_tasks,
            trigger="physical_hold_revoke",
            operator=payload.operatorName,
            source="revoke_transfer",
            force=True,
        )
    return {**result, "mirrorRefresh": "background"}


@app.post("/api/retail-core/physical-stock-holds/reopen-consumed")
def retail_core_reopen_physical_stock_hold(
    payload: PhysicalStockHoldReopenInput,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    result = retail_core.reopen_consumed_physical_hold(
        payload.serialNumbers,
        note=payload.note,
        operator_name=payload.operatorName,
    )
    schedule_retail_core_runtime_refresh(background_tasks)
    if int(result.get("reopenedCount", 0) or 0) > 0:
        schedule_inventory_master_auto_sync(
            background_tasks,
            trigger="physical_hold_reopen",
            operator=payload.operatorName,
            source="reopen_consumed",
            force=True,
        )
    return {**result, "mirrorRefresh": "background"}


@app.post("/api/retail-core/physical-stock-holds/rebind-service-outbound")
def retail_core_rebind_physical_stock_hold(
    payload: PhysicalStockHoldRebindInput,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    result = retail_core.rebind_physical_hold_service_order(
        payload.serviceOrderNo,
        serial_numbers=payload.serialNumbers,
        note=payload.note,
        operator_name=payload.operatorName,
    )
    schedule_retail_core_runtime_refresh(background_tasks)
    if int(result.get("reopenedCount", 0) or 0) > 0 or int(result.get("finalizedCount", 0) or 0) > 0:
        schedule_inventory_master_auto_sync(
            background_tasks,
            trigger="physical_hold_rebind",
            operator=payload.operatorName,
            source=payload.serviceOrderNo,
            force=True,
        )
    return {**result, "mirrorRefresh": "background"}


@app.get("/api/retail-core/inventory-movements")
def retail_core_inventory_movements(limit: int = 120) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_inventory_movements(page_size=limit)


@app.get("/api/retail-core/sales-orders")
def retail_core_sales_orders(limit: int = 80) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_sales_orders(limit=limit)


@app.get("/api/retail-core/customers")
def retail_core_customers(limit: int = 500) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_customers(limit=limit)


@app.get("/api/retail-core/order-sync-registry")
def retail_core_order_sync_registry(limit: int = 120) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_order_sync_registry(limit=limit)


@app.get("/api/retail-core/sync-gap-queue")
def retail_core_sync_gap_queue(limit: int = 120) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_sync_gap_queue(limit=limit)


@app.get("/api/retail-core/sales-price-protection-history")
def retail_core_sales_price_protection_history(limit: int = 80) -> dict[str, Any]:
    safe_seed_reference_data()
    return retail_core.list_sales_price_protection_history(limit=limit)


@app.get("/api/retail-core/sn-sales-compliance")
def retail_core_sn_sales_compliance(limit: int = 400) -> dict[str, Any]:
    safe_seed_reference_data()
    payload = retail_core.list_sn_sales_compliance(limit=limit)
    retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-sn-sales-compliance-snapshot.json",
        payload,
        source_system="api.retail_core.sn_sales_compliance",
    )
    return payload


@app.get("/api/sync/tasks")
def sync_tasks() -> dict[str, Any]:
    safe_seed_reference_data()
    items = retail_core.list_sync_tasks(limit=100)
    return {"items": items, "count": len(items)}


@app.get("/api/local-sync/pipelines")
def local_sync_pipelines() -> dict[str, Any]:
    local_sync.write_static_snapshots(DATA_DIR)
    payload = {"items": local_sync.list_pipelines(), "count": len(local_sync.list_pipelines())}
    retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-local-sync-pipelines.json",
        payload,
        source_system="api.local_sync.pipelines",
    )
    return load_snapshot_from_sql_cache("latest-local-sync-pipelines.json")


@app.get("/api/local-sync/latest-report")
def local_sync_latest_report() -> dict[str, Any]:
    local_sync.write_static_snapshots(DATA_DIR)
    payload = local_sync.latest_report()
    retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-local-sync-report.json",
        payload,
        source_system="api.local_sync.latest_report",
    )
    return load_snapshot_from_sql_cache("latest-local-sync-report.json")


@app.get("/api/local-sync/failure-queue")
def local_sync_failure_queue() -> dict[str, Any]:
    local_sync.write_static_snapshots(DATA_DIR)
    payload = local_sync.failure_queue()
    retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-local-sync-failure-queue.json",
        payload,
        source_system="api.local_sync.failure_queue",
    )
    return load_snapshot_from_sql_cache("latest-local-sync-failure-queue.json")


@app.post("/api/local-sync/run")
def run_local_sync(payload: LocalSyncRunInput) -> dict[str, Any]:
    retail_core.seed_reference_data(DATA_DIR)
    ensure_product_library_seeded(force=True)
    if payload.pipeline not in local_sync.LOCAL_SYNC_PIPELINES:
        raise HTTPException(
            status_code=400,
            detail={"error": "unsupported_pipeline", "pipeline": payload.pipeline},
        )
    task_id = f"LOCAL-SYNC-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    retail_core.enqueue_sync_task(
        task_id=task_id,
        external_system_id="local_sync_port",
        task_type="run_local_sync_pipeline",
        entity_type="local_sync_pipeline",
        entity_id=payload.pipeline,
        payload=payload.model_dump(),
    )
    retail_core.update_sync_task_status(task_id, status="running", payload={"startedAt": now_iso()})
    result = local_sync.run_pipeline(
        payload.pipeline,
        dry_run=payload.dryRun,
        trigger=payload.trigger,
        operator=payload.operator,
    )
    local_sync.write_static_snapshots(DATA_DIR)
    task_status = "completed" if result.get("status") not in {"failed"} else "failed"
    retail_core.update_sync_task_status(
        task_id,
        status=task_status,
        last_error=result.get("stderr", "") if task_status == "failed" else "",
        payload={
            "finishedAt": now_iso(),
            "pipeline": payload.pipeline,
            "reportStatus": result.get("status"),
            "reportPath": result.get("artifacts", {}).get("reportPath"),
        },
    )
    return {"ok": task_status != "failed", "taskId": task_id, "report": result}


@app.post("/api/local-sync/ensure-inventory-master")
def ensure_inventory_master_sync(payload: InventoryMasterAutoSyncInput) -> dict[str, Any]:
    retail_core.seed_reference_data(DATA_DIR)
    ensure_product_library_seeded(force=True)
    return local_sync.ensure_inventory_master_sync(
        DATA_DIR,
        trigger=payload.trigger,
        operator=payload.operator,
        source=payload.source,
        force=payload.force,
        wait_for_completion=payload.waitForCompletion,
        min_interval_seconds=payload.minIntervalSeconds,
        max_wait_seconds=payload.maxWaitSeconds,
    )


@app.get("/api/local-sync/six-terminal-status")
def api_six_terminal_status() -> dict[str, Any]:
    """聚合 6 终端同步状态，看板前端轮询这个端点。"""
    ensure_product_library_seeded(force=True)
    return local_sync.compute_six_terminal_status()


@app.post("/api/local-sync/heartbeat")
def api_terminal_heartbeat(payload: dict[str, Any]) -> dict[str, Any]:
    """接收 6 终端心跳上报。

    Request body: {terminalId, terminalName?, lastFetchedAt, clientDataSignature?, status?}
    Response: {ok, terminalId, recordedAt, lag}
    """
    terminal_id = str(payload.get("terminalId", "")).strip()
    if not terminal_id:
        return {"ok": False, "error": "terminalId is required"}
    result = local_sync.record_terminal_heartbeat(
        terminal_id=terminal_id,
        terminal_name=str(payload.get("terminalName", "")),
        last_fetched_at=str(payload.get("lastFetchedAt", "")),
        client_data_signature=str(payload.get("clientDataSignature", "")),
        status=str(payload.get("status", "")),
    )
    return result


@app.post("/api/local-sync/calibrate-six-terminals")
def api_calibrate_six_terminals(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """手动一键校准 6 终端：inventory-master + published-projection（后台异步执行）。"""
    payload = payload or {}
    return local_sync.calibrate_six_terminals(
        DATA_DIR,
        trigger=str(payload.get("trigger", "manual")),
        changed_by=str(payload.get("changedBy", "user")),
        force=bool(payload.get("force", True)),
    )


@app.get("/api/local-sync/calibrate-six-terminals/status")
def api_calibrate_six_terminals_status() -> dict[str, Any]:
    """查看后台校准状态。"""
    return local_sync.get_calibrate_six_terminals_status()


@app.post("/api/product-library/rebuild-linked-views")
def rebuild_product_library_linked_views(payload: ProductLibraryRebuildInput | None = None) -> dict[str, Any]:
    retail_core.seed_reference_data(DATA_DIR)
    ensure_product_library_seeded(force=True)
    scope = payload.scope if payload else "full"
    result = local_sync.rebuild_product_library_views(
        trigger="product_library_console",
        operator="codex",
        scope=scope,
    )
    local_sync.write_static_snapshots(DATA_DIR)
    return {"ok": result.get("status") != "failed", "report": result}


@app.get("/api/scheduled-task-console/overview")
def scheduled_task_console_overview() -> dict[str, Any]:
    scheduled_task_console.init_scheduled_task_console()
    return scheduled_task_console.scheduled_task_console_overview()


@app.get("/api/scheduled-task-console/tasks")
def scheduled_task_console_tasks() -> dict[str, Any]:
    scheduled_task_console.init_scheduled_task_console()
    return scheduled_task_console.list_scheduled_task_profiles()


@app.get("/api/scheduled-task-console/tasks/{task_name}")
def scheduled_task_console_task_detail(task_name: str) -> dict[str, Any]:
    scheduled_task_console.init_scheduled_task_console()
    result = scheduled_task_console.get_scheduled_task_profile(task_name)
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"error": "scheduled_task_not_found", "taskName": task_name},
        )
    return result


@app.patch("/api/scheduled-task-console/tasks/{task_name}")
def scheduled_task_console_task_update(task_name: str, payload: ScheduledTaskProfileUpdateInput) -> dict[str, Any]:
    updates = {
        "label": payload.label,
        "category": payload.category,
        "priority": payload.priority,
        "requiresComputerUse": payload.requiresComputerUse,
        "relatedPipeline": payload.relatedPipeline,
        "defaultPrompt": payload.defaultPrompt,
        "currentPrompt": payload.currentPrompt,
        "workflowSummary": payload.workflowSummary,
        "stepItems": payload.stepItems,
        "sourceItems": payload.sourceItems,
        "boundaryItems": payload.boundaryItems,
        "timeWindows": payload.timeWindows,
        "operatorNotes": payload.operatorNotes,
        "enabled": payload.enabled,
    }
    result = scheduled_task_console.update_scheduled_task_profile(
        task_name,
        {key: value for key, value in updates.items() if value is not None},
        changed_by=payload.changedBy,
        reason=payload.reason,
    )
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"error": "scheduled_task_not_found", "taskName": task_name},
        )
    return {"ok": True, "task": result}


@app.get("/api/openclaw/chat-board")
def get_openclaw_chat_board() -> dict[str, Any]:
    scheduled_task_console.init_scheduled_task_console()
    task_snapshot = scheduled_task_console.list_scheduled_task_profiles()
    task_profiles = task_snapshot.get("items", []) if isinstance(task_snapshot, dict) else []
    payload = openclaw_chat_board.build_chat_board(task_profiles)
    retail_core.save_snapshot_cache(
        DATA_DIR,
        "latest-openclaw-chat-board.json",
        payload,
        source_system="api.openclaw.chat_board",
    )
    return load_snapshot_from_sql_cache("latest-openclaw-chat-board.json")


@app.get("/api/openclaw/collection-receipts")
def get_openclaw_collection_receipts() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-openclaw-collection-receipts.json", default={"items": [], "count": 0}, required=False)


@app.get("/api/openclaw/command-board")
def get_openclaw_command_board() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-openclaw-command-board.json", default={"items": [], "count": 0}, required=False)


@app.get("/api/openclaw/zdt-bridge")
def get_openclaw_zdt_bridge() -> dict[str, Any]:
    return load_snapshot_from_sql_cache("latest-zdt-openclaw-bridge.json", default={"items": [], "count": 0}, required=False)


@app.post("/api/openclaw/chat-board/send")
def send_openclaw_chat_message(payload: OpenClawChatSendInput) -> dict[str, Any]:
    task_name = (payload.taskName or payload.presetKey or "manual-openclaw-task").strip()
    title = (payload.title or task_name or "OpenClaw 协作指令").strip()
    command = openclaw_chat_board.create_command(
        instruction=payload.message,
        title=title,
        task_name=task_name,
        preset_key=payload.presetKey,
        operator="codex",
        source_system="codex",
        target_system="openclaw",
        status="queued",
        command_mode=payload.commandMode,
        source_scope=payload.sourceScope,
        target_date=payload.targetDate,
        date_from=payload.dateFrom,
        date_to=payload.dateTo,
        collection_note=payload.collectionNote,
    )
    dispatch = openclaw_chat_board.dispatch_command_to_openclaw(command)
    if dispatch.get("ok"):
        command = (
            openclaw_chat_board.update_command(
                command["commandId"],
                status="steered",
                result_summary=(
                    f"已通过 OpenClaw 网关投递到 Control 会话，"
                    f"runId={dispatch.get('runId')}，status={dispatch.get('status')}"
                ),
            )
            or command
        )
        message_status = "steered"
        message_tone = "info"
    else:
        command = (
            openclaw_chat_board.update_command(
                command["commandId"],
                status="blocked",
                result_summary=str(dispatch.get("error") or "OpenClaw 投递失败"),
                blocking_reason=str(dispatch.get("error") or "OpenClaw 投递失败"),
            )
            or command
        )
        message_status = "blocked"
        message_tone = "danger"

    message = openclaw_chat_board.append_thread_message(
        role="user",
        kind="command",
        text=payload.message,
        task_name=task_name,
        status=message_status,
        command_id=command["commandId"],
        tone=message_tone,
    )
    scheduled_task_console.init_scheduled_task_console()
    task_snapshot = scheduled_task_console.list_scheduled_task_profiles()
    task_profiles = task_snapshot.get("items", []) if isinstance(task_snapshot, dict) else []
    board = openclaw_chat_board.build_chat_board(task_profiles)
    return {
        "ok": bool(dispatch.get("ok")),
        "command": command,
        "message": message,
        "dispatch": dispatch,
        "board": board,
    }


@app.post("/api/openclaw/chat-board/feedback")
def append_openclaw_chat_feedback(payload: OpenClawChatFeedbackInput) -> dict[str, Any]:
    task_name = (payload.taskName or "manual-openclaw-feedback").strip()
    blocking_reason = (payload.blockingReason or "").strip() or None
    status = payload.status.strip() or "completed"
    tone = "good" if status == "completed" else ("warn" if status in {"completed_with_warnings", "executed_not_closed"} else "danger")
    message = openclaw_chat_board.append_thread_message(
        role="assistant",
        kind="feedback",
        text=payload.message,
        task_name=task_name,
        status=status,
        receipt_id=payload.relatedReceiptId,
        tone=tone,
    )
    command = None
    if status in {"blocked", "blocked_missing_input", "blocked_page_risk", "failed", "executed_not_closed"}:
        command = openclaw_chat_board.create_command(
            instruction=payload.message,
            title=f"{task_name} 反馈",
            task_name=task_name,
            operator="openclaw",
            source_system="openclaw",
            target_system="codex",
            status="blocked" if status.startswith("blocked") or status == "failed" else "executing",
            result_summary=payload.message,
            blocking_reason=blocking_reason,
            related_receipt_id=payload.relatedReceiptId,
        )
    scheduled_task_console.init_scheduled_task_console()
    task_snapshot = scheduled_task_console.list_scheduled_task_profiles()
    task_profiles = task_snapshot.get("items", []) if isinstance(task_snapshot, dict) else []
    board = openclaw_chat_board.build_chat_board(task_profiles)
    return {"ok": True, "message": message, "command": command, "board": board}


@app.get("/api/prompt-workspace/template")
def prompt_workspace_template() -> dict[str, Any]:
    prompt_workspace.init_db()
    return {"ok": True, "template": prompt_workspace.template_schema()}


@app.get("/api/prompt-workspace/entries")
def prompt_workspace_entries(query: str = "", limit: int = 30) -> dict[str, Any]:
    prompt_workspace.init_db()
    result = prompt_workspace.list_entries(query=query, limit=limit)
    return {"ok": True, **result}


@app.post("/api/prompt-workspace/entries")
def create_prompt_workspace_entry(payload: PromptWorkspaceEntryInput) -> dict[str, Any]:
    prompt_workspace.init_db()
    entry = prompt_workspace.create_entry(
        payload.model_dump(),
        auto_optimize=payload.autoOptimize,
        minimax_api_key=prompt_workspace.load_minimax_api_key(AD_MACHINE_CONFIG_FILE),
    )
    return {"ok": True, "entry": entry}


@app.get("/api/prompt-workspace/entries/{entry_id}")
def prompt_workspace_entry_detail(entry_id: str) -> dict[str, Any]:
    prompt_workspace.init_db()
    try:
        entry = prompt_workspace.get_entry(entry_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "prompt_workspace_entry_not_found", "entryId": entry_id}) from exc
    return {"ok": True, "entry": entry}


@app.patch("/api/prompt-workspace/entries/{entry_id}")
def update_prompt_workspace_entry(entry_id: str, payload: PromptWorkspaceEntryUpdateInput) -> dict[str, Any]:
    prompt_workspace.init_db()
    try:
        has_content_update = any(
            value is not None and value != []
            for value in (
                payload.title,
                payload.projectName,
                payload.systemPurpose,
                payload.existingContext,
                payload.currentProblem,
                payload.targetOutcome,
                payload.rawNotes,
            )
        ) or any(
            getattr(payload, field)
            for field in ("problemDetails", "targetChecklist", "rules", "deliverables", "acceptanceCriteria", "keywords")
        )
        if has_content_update:
            entry = prompt_workspace.update_entry_content(
                entry_id,
                payload.model_dump(exclude_none=True),
                auto_optimize=payload.autoOptimize,
                minimax_api_key=prompt_workspace.load_minimax_api_key(AD_MACHINE_CONFIG_FILE),
            )
        else:
            entry = prompt_workspace.update_entry_meta(
                entry_id,
                category=payload.category,
                primary_category=payload.primaryCategory,
                secondary_category=payload.secondaryCategory,
                sequence_no=payload.sequenceNo,
                is_favorite=payload.isFavorite,
            )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "prompt_workspace_entry_not_found", "entryId": entry_id}) from exc
    return {"ok": True, "entry": entry}


@app.post("/api/prompt-workspace/entries/{entry_id}/optimize")
def optimize_prompt_workspace_entry(entry_id: str, payload: PromptWorkspaceOptimizeInput) -> dict[str, Any]:
    del payload
    prompt_workspace.init_db()
    try:
        result = prompt_workspace.optimize_entry(
            entry_id,
            minimax_api_key=prompt_workspace.load_minimax_api_key(AD_MACHINE_CONFIG_FILE),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "prompt_workspace_entry_not_found", "entryId": entry_id}) from exc
    return result


@app.get("/api/prompt-workspace/search")
def prompt_workspace_search(query: str, limit: int = 12) -> dict[str, Any]:
    prompt_workspace.init_db()
    if not query.strip():
        raise HTTPException(status_code=400, detail={"error": "query_required"})
    return {"ok": True, **prompt_workspace.search_workspace(query=query, limit=limit)}


@app.get("/api/prompt-workspace/knowledge")
def prompt_workspace_knowledge(query: str = "", limit: int = 20) -> dict[str, Any]:
    prompt_workspace.init_db()
    if query.strip():
        result = prompt_workspace.search_knowledge(query=query, limit=limit)
    else:
        result = prompt_workspace.search_knowledge(query=" ", limit=limit)
    return {"ok": True, **result}


@app.post("/api/prompt-workspace/knowledge")
def upsert_prompt_workspace_knowledge(payload: PromptWorkspaceKnowledgeInput) -> dict[str, Any]:
    prompt_workspace.init_db()
    try:
        item = prompt_workspace.upsert_knowledge(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    return {"ok": True, "item": item}


@app.post("/api/prompt-workspace/knowledge/recommend")
def recommend_prompt_workspace_knowledge(payload: PromptWorkspaceKnowledgeRecommendInput) -> dict[str, Any]:
    prompt_workspace.init_db()
    result = prompt_workspace.recommend_knowledge(
        payload.model_dump(),
        limit=payload.limit,
        minimax_api_key=prompt_workspace.load_minimax_api_key(AD_MACHINE_CONFIG_FILE),
    )
    return {"ok": True, **result}


@app.get("/api/product-library/overview")
def product_library_overview() -> dict[str, Any]:
    ensure_product_library_seeded()
    return product_library.product_library_overview()


@app.get("/api/product-library/categories")
def product_library_categories() -> dict[str, Any]:
    ensure_product_library_seeded()
    return product_library.list_category_summary()


@app.get("/api/product-library/pricing-governance")
def product_library_pricing_governance() -> dict[str, Any]:
    ensure_product_library_seeded()
    return {
        "tableCounts": retail_core.table_counts(),
        "pricingGovernance": retail_core.list_pricing_policy_rules(),
        "frontendSyncTargets": retail_core.list_frontend_sync_targets(),
    }


@app.get("/api/product-library/published-projection")
def product_library_published_projection() -> dict[str, Any]:
    ensure_product_library_seeded()
    return load_snapshot_from_sql_cache("latest-published-product-projection.json")


@app.get("/api/product-library/published-projection/audit")
def product_library_published_projection_audit() -> dict[str, Any]:
    ensure_product_library_seeded()
    product_library.write_published_product_projection_snapshots(DATA_DIR)
    return load_snapshot_from_sql_cache("latest-published-product-channel-audit.json")


@app.get("/api/product-library/products")
def product_library_products(limit: int = 50, search: str = "", category: str = "") -> dict[str, Any]:
    ensure_product_library_seeded()
    return product_library.list_products(limit=limit, search=search, category=category)


@app.get("/api/product-library/products/{product_id}")
def product_library_product_detail(product_id: str) -> dict[str, Any]:
    ensure_product_library_seeded()
    result = product_library.get_product(product_id)
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"error": "product_not_found", "productId": product_id},
        )
    return result


@app.patch("/api/product-library/products/{product_id}")
def update_product_library_product(product_id: str, payload: ProductMasterUpdateInput) -> dict[str, Any]:
    updates = {
        "canonical_name": payload.canonicalName,
        "product_line": payload.productLine,
        "model_family": payload.modelFamily,
        "default_category": payload.defaultCategory,
        "configuration_summary": payload.configurationSummary,
        "review_status": payload.reviewStatus,
        "source_confidence": payload.sourceConfidence,
        "notes": payload.notes,
    }
    result = product_library.update_product_master(
        DATA_DIR,
        product_id,
        updates,
        changed_by=payload.changedBy,
        reason=payload.reason,
    )
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"error": "product_not_found", "productId": product_id},
        )
    return {"ok": True, "product": result, "frontendSyncScope": "detail"}


@app.patch("/api/product-library/skus/{sku_key}")
def update_product_library_sku(sku_key: str, payload: ProductSkuUpdateInput) -> dict[str, Any]:
    updates = {
        "pn_mtm": payload.pnMtm,
        "name": payload.name,
        "category": payload.category,
        "source_category": payload.sourceCategory,
        "jd_subcategory": payload.jdSubcategory,
        "catalog_source": payload.catalogSource,
    }
    result = product_library.update_sku_profile(
        DATA_DIR,
        sku_key,
        updates,
        changed_by=payload.changedBy,
        reason=payload.reason,
    )
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"error": "sku_not_found", "skuKey": sku_key},
    )
    return {"ok": True, "sku": result, "frontendSyncScope": "detail"}


@app.patch("/api/product-library/products/{product_id}/rules")
def update_product_library_product_rules(product_id: str, payload: ProductBusinessRuleUpdateInput) -> dict[str, Any]:
    updates = {
        "store_price_rule_text": payload.storePriceRuleText,
        "subsidy_rule_text": payload.subsidyRuleText,
        "collection_rule_text": payload.collectionRuleText,
        "inbound_rule_text": payload.inboundRuleText,
        "outbound_rule_text": payload.outboundRuleText,
        "protection_rule_text": payload.protectionRuleText,
        "notes": payload.notes,
    }
    result = product_library.update_product_business_rule(
        DATA_DIR,
        product_id,
        updates,
        changed_by=payload.changedBy,
        reason=payload.reason,
    )
    return {"ok": True, "rule": result, "frontendSyncScope": "detail"}


@app.patch("/api/product-library/skus/{sku_key}/collection-info")
def update_product_library_collection_info(sku_key: str, payload: ProductCollectionOverrideInput) -> dict[str, Any]:
    updates = {
        "jd_url": payload.jdUrl,
        "lenovo_url": payload.lenovoUrl,
        "tmall_url": payload.tmallUrl,
        "distributor_quote_note": payload.distributorQuoteNote,
        "gray_quote_note": payload.grayQuoteNote,
        "capture_note": payload.captureNote,
    }
    result = product_library.update_product_collection_override(
        DATA_DIR,
        sku_key,
        updates,
        changed_by=payload.changedBy,
        reason=payload.reason,
    )
    return {"ok": True, "collectionInfo": result, "frontendSyncScope": "pricing"}


@app.get("/api/product-library/source-links")
def product_library_source_links(
    entityId: str | None = None,
    entityType: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    ensure_product_library_seeded()
    return product_library.list_source_links(entity_id=entityId, entity_type=entityType, limit=limit)


@app.get("/api/product-library/evidence")
def product_library_evidence(
    entityId: str | None = None,
    entityType: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    ensure_product_library_seeded()
    return product_library.list_evidence(entity_id=entityId, entity_type=entityType, limit=limit)


@app.get("/api/product-library/replays")
def product_library_replays(limit: int = 50) -> dict[str, Any]:
    ensure_product_library_seeded()
    return product_library.list_sync_replays(limit=limit)


@app.get("/api/product-library/change-logs")
def product_library_change_logs(
    entityId: str | None = None,
    entityType: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    ensure_product_library_seeded()
    return product_library.list_change_logs(entity_id=entityId, entity_type=entityType, limit=limit)


@app.post("/api/product-library/replays")
def create_product_library_replay(payload: ProductSyncReplayInput) -> dict[str, Any]:
    ensure_product_library_seeded()
    result = product_library.create_sync_replay(
        DATA_DIR,
        replay_type=payload.replayType,
        source_system=payload.sourceSystem,
        source_ref=payload.sourceRef,
        scope=payload.scope,
        created_by=payload.createdBy,
    )
    retail_core.enqueue_sync_task(
        task_id=f"SYNC-{result['replayId']}",
        external_system_id="local_sync_port",
        task_type="replay_history_sync",
        entity_type="product_sync_replay",
        entity_id=result["replayId"],
        payload=result,
    )
    return {"ok": True, **result}


@app.post("/api/product-library/price-adjustments")
def create_product_library_price_adjustment(payload: ProductPriceAdjustmentInput) -> dict[str, Any]:
    store_retail_price = payload.storeRetailPrice
    override_payload = {
        key: value for key, value in {
            "retailPreSubsidyPrice": store_retail_price if store_retail_price is not None else payload.retailPreSubsidyPrice,
            "realtimePurchasePrice": payload.realtimePurchasePrice,
            "marketWholesalePrice": payload.marketWholesalePrice,
            "defensivePostSubsidyPrice": payload.defensivePostSubsidyPrice,
        }.items() if value is not None
    }
    if not override_payload:
        raise HTTPException(
            status_code=400,
            detail={"error": "empty_price_adjustment"},
        )
    result = product_library.apply_manual_price_adjustment(
        DATA_DIR,
        sku_key=payload.skuKey,
        override_payload=override_payload,
        reason=payload.reason,
        changed_by=payload.changedBy,
    )
    rebuild_report = local_sync.rebuild_product_library_views(
        trigger="product_library_price_adjustment",
        operator=payload.changedBy,
        scope="pricing",
    )
    local_sync.write_static_snapshots(DATA_DIR)
    retail_core.sync_snapshot_cache(
        DATA_DIR,
        [
            "latest-manual-price-overrides.json",
            "latest-retail-zone-snapshot.json",
            "latest-retail-core-price-signals.json",
            "latest-standard-price-master.json",
            "latest-standard-price-master-frontend-snapshot.json",
        ],
    )
    price_tag_task: dict[str, Any] | None = None
    if payload.syncPriceTag:
        price_payload = {
            "price": override_payload.get("retailPreSubsidyPrice"),
            "updatedBy": payload.changedBy,
            "reason": payload.reason,
            "source": "manual_store_retail_price_update",
            "skuKey": payload.skuKey,
        }
        price_tag_task = retail_core.create_price_tag_update_task(
            sku_key=payload.skuKey,
            template_id=payload.priceTagTemplateId,
            price_payload=price_payload,
            data_dir=DATA_DIR,
        )
        retail_core.enqueue_sync_task(
            task_id=f"SYNC-{price_tag_task['taskId']}",
            external_system_id="price_tag_gateway",
            task_type="push_price_tag_update",
            entity_type="price_tag_update_task",
            entity_id=price_tag_task["taskId"],
            payload={
                "skuKey": payload.skuKey,
                "templateId": payload.priceTagTemplateId,
                "deviceId": price_tag_task.get("deviceId"),
                "pricePayload": price_payload,
            },
        )
    return {
        "ok": True,
        **result,
        "frontendSyncScope": "pricing",
        "rebuildReport": rebuild_report,
        "priceTagTask": price_tag_task,
    }


@app.get("/api/product-library/export")
def export_product_library_dataset(
    kind: str,
    category: str = "",
    search: str = "",
    productId: str = "",
) -> PlainTextResponse:
    ensure_product_library_seeded()
    try:
        filename, csv_text = product_library.export_dataset(
            kind,
            category=category,
            search=search,
            product_id=productId,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail={"error": "invalid_export_request", "message": str(error)}) from error
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/sync/tasks/{task_id}/retry")
def retry_sync_task(task_id: str) -> dict[str, Any]:
    result = retail_core.retry_sync_task(task_id)
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"error": "sync_task_not_found", "taskId": task_id},
        )
    return {"ok": True, **result}


@app.post("/api/price-tags/update-tasks")
def create_price_tag_update_task(payload: PriceTagUpdateInput) -> dict[str, Any]:
    result = retail_core.create_price_tag_update_task(
        sku_key=payload.skuKey,
        template_id=payload.templateId,
        price_payload=payload.pricePayload,
        device_id=payload.deviceId,
        data_dir=DATA_DIR,
        store_code=payload.storeCode,
    )
    retail_core.enqueue_sync_task(
        task_id=f"SYNC-{result['taskId']}",
        external_system_id="price_tag_gateway",
        task_type="push_price_tag_update",
        entity_type="price_tag_update_task",
        entity_id=result["taskId"],
        payload={
            "skuKey": payload.skuKey,
            "templateId": payload.templateId,
            "deviceId": result.get("deviceId") or payload.deviceId,
            "pricePayload": result.get("pricePayload") or payload.pricePayload,
        },
    )
    return {"ok": True, **result}


@app.get("/api/price-tags/status")
def price_tag_status(storeCode: str = "LENOVO-SR-001") -> dict[str, Any]:
    return retail_core.get_price_tag_console_status(DATA_DIR, store_code=storeCode)


@app.post("/api/price-tags/devices")
def upsert_price_tag_device(payload: PriceTagDeviceInput) -> dict[str, Any]:
    result = retail_core.upsert_price_tag_device(
        device_id=payload.id,
        vendor=payload.vendor,
        model=payload.model,
        store_code=payload.storeCode,
        status=payload.status,
        battery_level=payload.batteryLevel,
        signal_level=payload.signalLevel,
        last_seen_at=payload.lastSeenAt,
    )
    local_sync.write_static_snapshots(DATA_DIR)
    retail_core.sync_snapshot_cache(DATA_DIR, ["latest-retail-core-status.json", "latest-retail-core-sync-tasks.json"])
    return {"ok": True, **result}


@app.post("/api/price-tags/templates")
def upsert_price_tag_template(payload: PriceTagTemplateInput) -> dict[str, Any]:
    result = retail_core.upsert_price_tag_template(
        template_id=payload.id,
        name=payload.name,
        template_type=payload.templateType,
        payload=payload.payload,
    )
    local_sync.write_static_snapshots(DATA_DIR)
    retail_core.sync_snapshot_cache(DATA_DIR, ["latest-retail-core-status.json"])
    return {"ok": True, **result}


@app.post("/api/price-tags/bindings")
def upsert_price_tag_binding(payload: PriceTagBindingInput) -> dict[str, Any]:
    result = retail_core.upsert_price_tag_binding(
        binding_id=payload.id,
        device_id=payload.deviceId,
        sku_key=payload.skuKey,
        store_code=payload.storeCode,
        status=payload.status,
    )
    local_sync.write_static_snapshots(DATA_DIR)
    retail_core.sync_snapshot_cache(DATA_DIR, ["latest-retail-core-status.json"])
    return {"ok": True, **result}
