from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import time
from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Any

from app import retail_core

APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parents[1]
PRODUCT_LIBRARY_SNAPSHOT_FILES = [
    "latest-product-library-overview.json",
    "latest-product-library-categories.json",
    "latest-product-library-products.json",
    "latest-product-library-details.json",
    "latest-product-library-replays.json",
    "latest-published-product-projection.json",
    "latest-published-product-channel-audit.json",
]


def now_iso() -> str:
    return retail_core.now_iso()


def stable_id(*parts: str) -> str:
    basis = "::".join(parts)
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:24]


def _apply_activity_display_fields(payload: dict[str, Any]) -> dict[str, Any]:
    valid_from = str(payload.get("validFrom") or "")
    valid_to = str(payload.get("validTo") or "")
    countdown_days = payload.get("countdownDays")
    payload["validFromShort"] = retail_core.format_short_date(valid_from) if valid_from else ""
    payload["validToShort"] = retail_core.format_short_date(valid_to) if valid_to else ""
    payload["countdownLabel"] = retail_core.format_countdown_label(countdown_days) if countdown_days is not None else ""
    return payload


def connect():
    return retail_core.connect()


def _execute_with_retry(conn, sql: str, params: tuple[Any, ...] = (), *, retries: int = 5, sleep_seconds: float = 1.5):
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            return conn.execute(sql, params)
        except Exception as exc:
            last_error = exc
            if "database is locked" not in str(exc).lower() or attempt == retries - 1:
                raise
            time.sleep(sleep_seconds)
    if last_error is not None:
        raise last_error


def init_product_library() -> None:
    retail_core.init_db()
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS product_master (
              id TEXT PRIMARY KEY,
              product_id TEXT NOT NULL,
              canonical_name TEXT NOT NULL,
              brand TEXT NOT NULL DEFAULT 'Lenovo',
              product_line TEXT NOT NULL DEFAULT '',
              model_family TEXT NOT NULL DEFAULT '',
              default_category TEXT NOT NULL DEFAULT '',
              primary_sku_key TEXT NOT NULL DEFAULT '',
              configuration_summary TEXT NOT NULL DEFAULT '',
              configuration_fingerprint TEXT NOT NULL DEFAULT '',
              review_status TEXT NOT NULL DEFAULT 'seeded',
              source_confidence TEXT NOT NULL DEFAULT 'snapshot',
              created_source TEXT NOT NULL DEFAULT 'snapshot_seed',
              last_source_system TEXT NOT NULL DEFAULT '',
              last_synced_at TEXT NOT NULL DEFAULT '',
              updated_by TEXT NOT NULL DEFAULT 'system',
              notes TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_source_link (
              id TEXT PRIMARY KEY,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              source_system TEXT NOT NULL,
              source_type TEXT NOT NULL,
              source_key TEXT NOT NULL,
              source_value TEXT NOT NULL DEFAULT '',
              snapshot_file TEXT NOT NULL DEFAULT '',
              payload_json TEXT NOT NULL DEFAULT '{}',
              first_seen_at TEXT NOT NULL,
              last_seen_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_evidence (
              id TEXT PRIMARY KEY,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              source_system TEXT NOT NULL,
              evidence_type TEXT NOT NULL,
              title TEXT NOT NULL DEFAULT '',
              file_path TEXT NOT NULL DEFAULT '',
              source_url TEXT NOT NULL DEFAULT '',
              captured_at TEXT NOT NULL DEFAULT '',
              captured_by TEXT NOT NULL DEFAULT '',
              checksum TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_sync_replay (
              id TEXT PRIMARY KEY,
              replay_type TEXT NOT NULL,
              source_system TEXT NOT NULL,
              source_ref TEXT NOT NULL DEFAULT '',
              scope_json TEXT NOT NULL DEFAULT '{}',
              status TEXT NOT NULL,
              result_json TEXT NOT NULL DEFAULT '{}',
              error_message TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL DEFAULT 'system',
              started_at TEXT NOT NULL,
              finished_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS product_price_adjustment (
              id TEXT PRIMARY KEY,
              sku_key TEXT NOT NULL,
              adjusted_field TEXT NOT NULL,
              adjusted_value REAL NOT NULL,
              reason TEXT NOT NULL DEFAULT '',
              source_system TEXT NOT NULL DEFAULT 'manual_override',
              applied_to_frontend INTEGER NOT NULL DEFAULT 0,
              effective_from TEXT NOT NULL DEFAULT '',
              effective_to TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL DEFAULT 'system',
              payload_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_change_log (
              id TEXT PRIMARY KEY,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              field_name TEXT NOT NULL,
              before_value TEXT NOT NULL DEFAULT '',
              after_value TEXT NOT NULL DEFAULT '',
              change_reason TEXT NOT NULL DEFAULT '',
              changed_by TEXT NOT NULL DEFAULT 'system',
              source_system TEXT NOT NULL DEFAULT 'manual',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_business_rule (
              product_id TEXT PRIMARY KEY,
              store_price_rule_text TEXT NOT NULL DEFAULT '',
              subsidy_rule_text TEXT NOT NULL DEFAULT '',
              collection_rule_text TEXT NOT NULL DEFAULT '',
              inbound_rule_text TEXT NOT NULL DEFAULT '',
              outbound_rule_text TEXT NOT NULL DEFAULT '',
              protection_rule_text TEXT NOT NULL DEFAULT '',
              notes TEXT NOT NULL DEFAULT '',
              updated_by TEXT NOT NULL DEFAULT 'system',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_collection_override (
              sku_key TEXT PRIMARY KEY,
              jd_url TEXT NOT NULL DEFAULT '',
              lenovo_url TEXT NOT NULL DEFAULT '',
              tmall_url TEXT NOT NULL DEFAULT '',
              distributor_quote_note TEXT NOT NULL DEFAULT '',
              gray_quote_note TEXT NOT NULL DEFAULT '',
              capture_note TEXT NOT NULL DEFAULT '',
              updated_by TEXT NOT NULL DEFAULT 'system',
              updated_at TEXT NOT NULL
            );
            """
        )


def _load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default
    if isinstance(raw, dict):
        return raw
    return default


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_snapshot_payload(conn, data_dir: Path, snapshot_name: str, default: dict[str, Any]) -> dict[str, Any]:
    cached = _load_snapshot_cache_payload(conn, snapshot_name)
    if isinstance(cached, dict):
        return cached
    return _load_json(data_dir / snapshot_name, default)


def _to_price(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return round(number, 2)


INTERNAL_TITLE_PATTERNS = [
    # 只过滤“型号代码为主且本项目已不用”的短标题/严格内部代码
    re.compile(r"^TB\d+[A-Z]*\s+TAB\b", re.IGNORECASE),
    re.compile(r"\bTAB\s+\d+G\+\d+G", re.IGNORECASE),
    re.compile(r"^[A-Z]{2,4}\d+[A-Z]{0,3}\d*[A-Z]?$", re.IGNORECASE),  # 纯型号代码如 AHP9GRFR
    # IRX/IAX/ADR/IPH/ILL/AHP/IRH/IRL 仅在标题短且为纯型号时过滤
    re.compile(r"^(IRX|IAX|ADR|IPH|ILL|AHP|IRH|IRL)\d+$", re.IGNORECASE),
]

DETAIL_REQUIRED_CATEGORIES = {
    "游戏笔记本",
    "轻薄笔记本",
    "平板电脑",
    "手机",
    "台式机",
    "一体机",
    "台式/一体机",
    "显示器",
}

TITLE_PROMO_PATTERNS = [
    re.compile(r"^【[^】]+】\s*"),
    re.compile(r"\d{4}年补贴15%|国家补贴(?:15%)?|补贴15%|教育优惠|张凌赫同款|主流游戏|新品热卖|社群专属|性价比首选", re.IGNORECASE),
    re.compile(r"官方旗舰店?|年会礼品|P图设计|旗舰标压|高刷高色域电竞屏|逆势前行\s*内存不涨", re.IGNORECASE),
]

TITLE_CONFIG_PATTERN = re.compile(
    r"\b\d+\s*(?:G|GB|T|TB)\b|\d+\+\d+|RTX\s*\d{3,4}|GTX\s*\d{3,4}|"
    r"Ultra\s*(?:\d|X)|i[3579][-\s]?\d{3,5}|R[3579][-\s]?\d{3,5}|"
    r"骁龙|天玑|Dimensity|OLED|\d(?:\.\d)?K|\d{2,3}\s*Hz|WIFI|Wi-?Fi|英寸|"
    r"酷睿|锐龙|内存|固态|SSD|U\d{3,4}[A-Z]?|HX|H\b|集成显卡|独显版|黑色|白色|灰色|"
    r"深灰色|云影色|碳晶黑|冰魄白|钛晶灰|钛晶黑|谜香甘草|松烟蓝|即墨|青巧|韵绿",
    re.IGNORECASE,
)

TITLE_DEVICE_PATTERN = re.compile(
    r"电竞游戏本笔记本电脑|轻薄笔记本电脑|笔记本电脑|游戏本|平板电脑|一体台式电脑|"
    r"一体机|台式电脑|台式机|显示器|智能手机|手机|多功能一体机|打印机",
    re.IGNORECASE,
)

CPU_CONFIG_PATTERN = re.compile(
    r"酷睿\d代Ultra\s*X?\d+\-?\d{2,4}[A-Z]*|酷睿Ultra\s*X?\d+\-?\d{2,4}[A-Z]*|"
    r"Ultra\s*X?\d+\s*\d{2,4}[A-Z]*|UltraX\d+\s*\d{2,4}[A-Z]*|Ultra\d+\s*\d{2,4}[A-Z]*|"
    r"锐龙\s*\d+\s*[A-Z]?\-?\s*H?\d{2,4}|i[3579][-\s]?\d{3,5}|R[3579][-\s]?\d{3,5}|锐龙|酷睿|骁龙|天玑|Dimensity",
    re.IGNORECASE,
)
MEMORY_STORAGE_CONFIG_PATTERN = re.compile(r"\b\d+\s*(?:G|GB|T|TB)\b|\d+\+\d+|SSD|内存|固态", re.IGNORECASE)
GPU_CONFIG_PATTERN = re.compile(r"RTX\s*\d{3,4}|GTX\s*\d{3,4}|集成显卡|独显版|集显", re.IGNORECASE)


def _clean_title(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _category_requires_title_detail(category: Any) -> bool:
    return _clean_title(category) in DETAIL_REQUIRED_CATEGORIES


def _strip_title_promo_noise(value: Any) -> str:
    text = _clean_title(value)
    if not text:
        return ""
    for pattern in TITLE_PROMO_PATTERNS:
        while True:
            next_text = pattern.sub("", text).strip()
            if next_text == text:
                break
            text = next_text
    text = re.sub(r"【\s*】", "", text)
    return _clean_title(text.strip(" -_/|｜丨，,"))


def _normalize_title_detail_text(value: Any) -> str:
    text = _strip_title_promo_noise(value)
    if not text:
        return ""
    text = re.sub(r"联想（Lenovo）|联想\(Lenovo\)", "联想", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*(?:/|｜|丨|\|)\s*", " / ", text)
    text = re.sub(r"\b(\d+)\s*G\b", r"\1GB", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(\d+)\s*T\b", r"\1TB", text, flags=re.IGNORECASE)
    text = re.sub(r"\bRTX\s*(\d{3,4})\b", r"RTX\1", text, flags=re.IGNORECASE)
    text = re.sub(r"\bGTX\s*(\d{3,4})\b", r"GTX\1", text, flags=re.IGNORECASE)
    text = re.sub(r"全新英特尔|全新|商务办公大学生设计游戏手提|AI学习办公影音|学习办公影音|高刷全面屏|超清护眼大屏", "", text, flags=re.IGNORECASE)
    text = re.sub(r"官方标配|官方标配银色|官方标配灰色|官方标配黑色", "", text, flags=re.IGNORECASE)
    text = re.sub(r"集显", "集成显卡", text, flags=re.IGNORECASE)
    text = re.sub(r"满血", "", text)
    text = re.sub(r"\s{2,}", " ", text)
    return _clean_title(text.strip(" -_/|｜丨，,"))


def _normalize_title_main_text(value: Any) -> str:
    text = _normalize_title_detail_text(value)
    if not text:
        return ""
    text = re.sub(r"^摩托罗拉\s*", "", text, flags=re.IGNORECASE)
    if re.search(r"\bmoto\b", text, re.IGNORECASE) and not text.lower().startswith("联想moto"):
        text = re.sub(r"^\bmoto\b", "联想moto", text, flags=re.IGNORECASE)
    text = re.sub(r"笔记本电脑r\b", "笔记本电脑", text, flags=re.IGNORECASE)
    return _clean_title(text)


def _title_has_config_detail(value: Any) -> bool:
    return bool(TITLE_CONFIG_PATTERN.search(_clean_title(value)))


def _count_config_signals(value: Any) -> int:
    text = _clean_title(value)
    if not text:
        return 0
    count = 0
    for pattern in (CPU_CONFIG_PATTERN, MEMORY_STORAGE_CONFIG_PATTERN, GPU_CONFIG_PATTERN):
        if pattern.search(text):
            count += 1
    if re.search(r"\d+(?:\.\d+)?英寸", text, re.IGNORECASE):
        count += 1
    if re.search(r"\d{2,3}\s*Hz|\d(?:\.\d)?K|OLED", text, re.IGNORECASE):
        count += 1
    return count


def _has_memory_detail(value: Any) -> bool:
    return bool(re.search(r"\d+\s*GB(?:\s*\(\d+\s*GB\s*x\s*\d+\))?|\d+\+\d+\s*GB?", _clean_title(value), re.IGNORECASE))


def _has_storage_detail(value: Any) -> bool:
    text = _clean_title(value)
    if re.search(r"\d+\s*TB(?:\s*SSD)?", text, re.IGNORECASE):
        return True
    if re.search(r"\d+\+\d+\s*GB?", text, re.IGNORECASE):
        return True
    for match in re.finditer(r"(\d+)\s*GB(?:\s*(?:SSD|闪存|存储))?", text, re.IGNORECASE):
        if int(match.group(1)) >= 128:
            return True
    return False


def _title_has_strong_primary_device_detail(value: Any, category: Any) -> bool:
    text = _clean_title(value)
    category_text = _clean_title(category)
    if category_text in {"游戏笔记本", "轻薄笔记本", "台式机", "一体机", "台式/一体机"}:
        return bool(CPU_CONFIG_PATTERN.search(text) and _has_memory_detail(text) and _has_storage_detail(text))
    if category_text in {"平板电脑", "手机"}:
        return bool(_has_memory_detail(text) and _has_storage_detail(text))
    if category_text == "显示器":
        return bool(re.search(r"\d+(?:\.\d+)?英寸", text, re.IGNORECASE) and re.search(r"\d{2,3}\s*Hz|\d(?:\.\d)?K|OLED", text, re.IGNORECASE))
    return _title_has_config_detail(text)


def _extract_note_quoted_value(note: str, marker: str) -> str:
    match = re.search(rf"{re.escape(marker)}[“\"]([^”\"]+)[”\"]", note)
    return _clean_title(match.group(1)) if match else ""


def _extract_note_clause(note: str, marker: str, end_markers: tuple[str, ...]) -> str:
    if marker not in note:
        return ""
    tail = note.split(marker, 1)[1]
    end_index = len(tail)
    for end_marker in end_markers:
        idx = tail.find(end_marker)
        if idx != -1 and idx < end_index:
            end_index = idx
    return _clean_title(tail[:end_index].strip(" ：:，,。"))


def _extract_color_signal(text: str) -> str:
    match = re.search(
        r"深灰色|深空灰|云影色|碳晶黑|冰魄白|钛晶灰|钛晶黑|谜香甘草|松烟蓝|即墨|青巧|韵绿|"
        r"浅海贝|凌灰|海蓝|月光灰|鸽子灰|赛道灰|月慕白|暮霭灰|蓝色|黑色|白色|灰色|银色",
        text,
        re.IGNORECASE,
    )
    return _clean_title(match.group(0)) if match else ""


def _extract_storage_token(text: str, *, exclude: str = "") -> str:
    candidates = [
        r"\d+\s*TB\s*SSD",
        r"\d+\s*GB\s*SSD",
        r"\d+\s*TB",
        r"\d+\s*GB\s*(?:闪存|存储)",
        r"\d+\s*GB",
    ]
    exclude_compact = re.sub(r"\s+", "", _clean_title(exclude).upper())
    for pattern in candidates:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in reversed(matches):
            storage = _clean_title(match.group(0))
            compact_storage = re.sub(r"\s+", "", storage.upper())
            if exclude_compact and compact_storage == exclude_compact:
                continue
            if re.search(r"TB|SSD|闪存|存储", storage, re.IGNORECASE) or re.search(r"\d+\s*GB", storage, re.IGNORECASE):
                if re.search(r"TB|GB", storage, re.IGNORECASE) and "SSD" not in storage and "闪存" not in storage and "存储" not in storage:
                    size_match = re.search(r"(\d+)\s*GB", storage, re.IGNORECASE)
                    if size_match and int(size_match.group(1)) >= 128:
                        return storage
                    storage = f"{storage} SSD"
                return storage
    return ""


def _normalize_serial_spec_token(token: str) -> str:
    value = _clean_title(token)
    if not value:
        return ""
    compact = value.upper().replace(" ", "")
    if re.fullmatch(r"\d+G", compact):
        return f"{compact[:-1]}GB"
    if re.fullmatch(r"\d+T", compact):
        return f"{compact[:-1]}TB SSD"
    return value


def _serial_spec_detail(serial_rows: list[dict[str, Any]]) -> str:
    spec_counts: dict[str, int] = {}
    for row in serial_rows:
        spec = _clean_title(row.get("spec"))
        if not spec:
            continue
        spec_counts[spec] = spec_counts.get(spec, 0) + 1
    if not spec_counts:
        return ""
    dominant_spec = max(spec_counts.items(), key=lambda item: (item[1], len(item[0])))[0]
    cpu_match = CPU_CONFIG_PATTERN.search(dominant_spec) or re.search(r"Ultra\d+\-?\d{2,4}[A-Z]*", dominant_spec, re.IGNORECASE)
    memory_match = re.search(r"\d+\s*G(?:B)?", dominant_spec, re.IGNORECASE)
    storage_match = re.search(r"\d+\s*T(?:B)?|\d+\s*G(?:B)?\s*(?:SSD|闪存|存储)?", dominant_spec, re.IGNORECASE)
    detail_tokens: list[str] = []
    for raw in (
        cpu_match.group(0) if cpu_match else "",
        memory_match.group(0) if memory_match else "",
        storage_match.group(0) if storage_match else "",
    ):
        normalized = _normalize_serial_spec_token(raw)
        if normalized and normalized not in detail_tokens:
            detail_tokens.append(normalized)
    return " / ".join(detail_tokens)


def _enrich_title_with_serial_spec(title: str, category: Any, serial_rows: list[dict[str, Any]]) -> str:
    normalized_title = _clean_title(title)
    if not normalized_title or _title_has_strong_primary_device_detail(normalized_title, category):
        return normalized_title
    category_text = _clean_title(category)
    if category_text not in {"游戏笔记本", "轻薄笔记本", "台式机", "一体机", "台式/一体机"}:
        return normalized_title
    serial_detail = _serial_spec_detail(serial_rows)
    if not serial_detail:
        return normalized_title
    if "·" in normalized_title:
        main_title, detail_title = [
            _clean_title(part) for part in normalized_title.split("·", 1)
        ]
        existing_detail = detail_title
        cpu_match = CPU_CONFIG_PATTERN.search(existing_detail)
        if cpu_match:
            return normalized_title
        merged_detail = f"{serial_detail} / {existing_detail}" if existing_detail else serial_detail
        return f"{main_title} · {merged_detail}"
    return f"{normalized_title} · {serial_detail}"


def _canonicalize_detail_token(token: str) -> tuple[str, str]:
    text = _normalize_title_detail_text(token)
    if not text:
        return "", ""
    if "Windows 11" in text:
        return "os:win11", "Windows 11"
    cpu_match = re.search(
        r"酷睿\d代Ultra\s*X?\d+\-?\d{2,4}[A-Z]*|酷睿Ultra\s*X?\d+\-?\d{2,4}[A-Z]*|"
        r"Ultra\s*X?\d+\s*\d{2,4}[A-Z]*|UltraX\d+\s*\d{2,4}[A-Z]*|Ultra\d+\s*\d{2,4}[A-Z]*|"
        r"i[3579][-\s]?\d{3,5}[A-Z]*|R[3579][-\s]?\d{3,5}[A-Z]*|R9\s*\d{4,5}[A-Z]*|"
        r"AMD\s*Ryzen\s*\d+\s*\d{3,5}[A-Z]*|Ryzen\s*\d+\s*\d{3,5}[A-Z]*|"
        r"AMD\s*锐龙\s*\d+\s*[A-Z]?\s*\d{3,5}[A-Z]*|锐龙\s*\d+\s*[A-Z]?\-?\s*H?\d{2,4}[A-Z]*|"
        r"骁龙\s*(?:8至尊版|8s?|7s?|6s?|[A-Z0-9+\-]+)|天玑\s*\d+|Dimensity\s*\d+",
        text,
        re.IGNORECASE,
    )
    if cpu_match:
        cpu = _clean_title(cpu_match.group(0))
        cpu = re.sub(r"\s+", " ", cpu)
        return "cpu", cpu
    memory_match = re.search(r"\d+\s*GB(?:\s*\(\d+\s*GB\s*x\s*\d+\))?|\d+\s*[Gg][Bb]?\s*\+\s*\d+\s*[Gg][Bb]?", text, re.IGNORECASE)
    if memory_match:
        return "memory", _clean_title(memory_match.group(0))
    storage = _extract_storage_token(text)
    if storage:
        return "storage", storage
    gpu_match = re.search(r"RTX\s*\d{3,4}|GTX\s*\d{3,4}|集成显卡|独显版", text, re.IGNORECASE)
    if gpu_match:
        return "gpu", _clean_title(gpu_match.group(0))
    size_match = re.search(r"\d+(?:\.\d+)?英寸", text, re.IGNORECASE)
    if size_match:
        size = _clean_title(size_match.group(0)).replace(".0英寸", "英寸")
        return "size", size
    refresh_match = re.search(r"\d(?:\.\d)?K|\d{2,3}\s*Hz|OLED", text, re.IGNORECASE)
    if refresh_match:
        return "display", _clean_title(refresh_match.group(0))
    color = _extract_color_signal(text)
    if color:
        return "color", color
    compact_text = re.sub(r"\s+", "", text.lower())
    return f"misc:{compact_text}", text


def _dedupe_detail_tokens(main_title: str, detail_text: str) -> str:
    main_text = _normalize_title_detail_text(main_title)
    detail = _normalize_title_detail_text(detail_text)
    main_color = _extract_color_signal(main_text)
    if not detail:
        return ""

    combined = f"{main_text} / {detail}"
    components: dict[str, str] = {}

    cpu_patterns = [
        r"酷睿\d代Ultra\s*X?\d+\-?\d{2,4}[A-Z]*",
        r"酷睿Ultra\s*X?\d+\-?\d{2,4}[A-Z]*",
        r"Ultra\s*X?\d+\s*\d{2,4}[A-Z]*",
        r"UltraX\d+\s*\d{2,4}[A-Z]*",
        r"Ultra\d+\s*\d{2,4}[A-Z]*",
        r"i[3579][-\s]?\d{3,5}[A-Z]*",
        r"锐龙\s*\d+\s*[A-Z]?\-?\s*H?\d{2,4}[A-Z]*",
        r"R[3579][-\s]?\d{3,5}[A-Z]*",
        r"R9\s*\d{4,5}[A-Z]*",
        r"AMD\s*Ryzen\s*\d+\s*\d{3,5}[A-Z]*",
        r"Ryzen\s*\d+\s*\d{3,5}[A-Z]*",
        r"AMD\s*锐龙\s*\d+\s*[A-Z]?\s*\d{3,5}[A-Z]*",
        r"锐龙\s*\d+\s*[A-Z]?\s*\d{3,5}[A-Z]*",
        r"骁龙\s*(?:8至尊版|8s?|7s?|6s?|[A-Z0-9+\-]+)",
        r"天玑\s*\d+",
        r"Dimensity\s*\d+",
    ]
    for pattern in cpu_patterns:
        match = re.search(pattern, detail, re.IGNORECASE)
        if match:
            components["cpu"] = _clean_title(match.group(0))
            break

    if "Windows 11" in detail:
        components["os"] = "Windows 11"

    combo_match = re.search(r"(\d+)(?:\s*[Gg][Bb]?)?\s*\+\s*(\d+)(?:\s*[Gg][Bb]?)?", detail, re.IGNORECASE)
    compact_combo_match = re.search(r"(?<!\d)(\d{1,2})G(?:B)?\s*(\d{3,4})G(?:B)?(?!\d)", detail, re.IGNORECASE)
    if combo_match:
        components["memory"] = f"{combo_match.group(1)}GB"
        components["storage"] = f"{combo_match.group(2)}GB"
    elif compact_combo_match:
        components["memory"] = f"{compact_combo_match.group(1)}GB"
        components["storage"] = f"{compact_combo_match.group(2)}GB"
    else:
        memory_match = re.search(r"\d+\s*GB(?:\s*\(\d+\s*GB\s*x\s*\d+\))?", detail, re.IGNORECASE)
        if memory_match:
            components["memory"] = _clean_title(memory_match.group(0))
        storage = _extract_storage_token(detail, exclude=components.get("memory", ""))
        if storage:
            components["storage"] = storage

    gpu_match = re.search(r"RTX\s*\d{3,4}|GTX\s*\d{3,4}|集成显卡|独显版", detail, re.IGNORECASE)
    if gpu_match:
        components["gpu"] = _clean_title(gpu_match.group(0))

    size_match = re.search(r"\d+(?:\.\d+)?英寸", detail, re.IGNORECASE)
    if size_match:
        size_value = _clean_title(size_match.group(0)).replace(".0英寸", "英寸")
        if size_value not in main_text:
            components["size"] = size_value

    display_tokens: list[str] = []
    for pattern in (r"\d(?:\.\d)?K", r"\d{2,3}\s*Hz", r"OLED", r"4K"):
        for match in re.finditer(pattern, detail, re.IGNORECASE):
            token = _clean_title(match.group(0))
            if token and token not in display_tokens:
                display_tokens.append(token)
    if display_tokens:
        components["display"] = " ".join(display_tokens)

    wifi_match = re.search(r"Wi-?Fi|WIFI", detail, re.IGNORECASE)
    if wifi_match:
        components["wireless"] = "WiFi"

    color = _extract_color_signal(detail)
    if color and color != main_color:
        components["color"] = color

    model_match = re.search(r"\b[A-Z]{1,4}\d{2,5}(?:-[A-Z0-9]+)?\b", detail, re.IGNORECASE)
    if model_match:
        model = _clean_title(model_match.group(0))
        if model and model not in main_text:
            components["model"] = model

    order = ["cpu", "os", "memory", "storage", "gpu", "display", "wireless", "size", "color", "model"]
    ordered_tokens = [components[key] for key in order if components.get(key)]
    if ordered_tokens:
        return " / ".join(ordered_tokens)

    parts = [
        _clean_title(part)
        for chunk in re.split(r"\s*/\s*", detail)
        for part in re.split(r"[、，,]", chunk)
        if _clean_title(part)
    ]
    fallback_tokens: list[str] = []
    for part in parts:
        _, normalized = _canonicalize_detail_token(part)
        if normalized and normalized not in fallback_tokens:
            fallback_tokens.append(normalized)
    return " / ".join(fallback_tokens)


def _normalize_customer_title_candidate(value: Any, category: Any) -> str:
    text = _clean_title(value)
    if not text:
        return ""
    if _looks_like_internal_title(text):
        return ""
    raw_text = text
    if "·" in text:
        main_part, detail_part = text.split("·", 1)
    else:
        main_part, detail_part = text, ""
        parenthetical = re.match(r"^(.*?)[(（]([^()（）]+)[)）]\s*([^\s()（）]+)?$", text)
        if parenthetical:
            main_part = parenthetical.group(1)
            detail_part = " ".join(part for part in (parenthetical.group(2), parenthetical.group(3)) if part)
        else:
            generic_notebook_match = None
            if category in {"游戏笔记本", "轻薄笔记本"}:
                generic_notebook_match = re.match(r"^联想笔记本电脑(.+)$", text)
            if generic_notebook_match:
                suffix = _clean_title(generic_notebook_match.group(1))
                suffix_config_match = TITLE_CONFIG_PATTERN.search(suffix)
                if suffix_config_match and suffix_config_match.start() > 0:
                    model_segment = _clean_title(suffix[:suffix_config_match.start()])
                    model_segment = re.sub(
                        r"(轻薄本|超能本|电竞本|游戏本|便携轻薄办公本|商务办公本|学习办公本|"
                        r"英特尔|英特尔酷睿3代|英特尔酷睿2代|英特尔酷睿|国家补贴|教育优惠)+$",
                        "",
                        model_segment,
                        flags=re.IGNORECASE,
                    ).strip()
                    model_segment = _clean_title(model_segment)
                    if model_segment:
                        main_part = f"联想{model_segment}笔记本电脑"
                        detail_part = suffix[suffix_config_match.start():]
            config_match = TITLE_CONFIG_PATTERN.search(text)
            device_matches = list(TITLE_DEVICE_PATTERN.finditer(text))
            device_match = device_matches[-1] if device_matches else None
            if category in {"平板电脑", "手机"} and device_match:
                main_part = text[:device_match.end()]
                detail_part = text[device_match.end():]
            elif category in {"一体机", "台式机", "台式/一体机"}:
                desktop_match = re.search(
                    r"^(.*?)(酷睿|锐龙|Ultra\s*\d|i[3579]|R[3579])(.+?)(\d{2}(?:\.\d)?英寸.*?(?:一体台式电脑|一体机|台式电脑|台式机))(.*)$",
                    text,
                    re.IGNORECASE,
                )
                if desktop_match:
                    main_part = f"{desktop_match.group(1).strip()} {desktop_match.group(4).strip()}".strip()
                    detail_part = " ".join(
                        part.strip()
                        for part in (
                            f"{desktop_match.group(2)}{desktop_match.group(3)}".strip(),
                            desktop_match.group(5).strip(),
                        )
                        if part and part.strip()
                    )
            if not detail_part and config_match and config_match.start() >= 6:
                main_end = config_match.start()
                all_device_matches = list(TITLE_DEVICE_PATTERN.finditer(text))
                if all_device_matches:
                    if main_end < all_device_matches[0].end():
                        main_end = all_device_matches[0].end()
                    covering_device_match = next(
                        (match for match in all_device_matches if match.start() <= config_match.start() < match.end()),
                        None,
                    )
                    if covering_device_match:
                        main_end = covering_device_match.end()
                    else:
                        earlier_device_matches = [match for match in all_device_matches if match.end() <= config_match.start()]
                        if earlier_device_matches:
                            main_end = earlier_device_matches[-1].end()
                main_part = text[:main_end]
                detail_part = text[main_end:]
    main_title = _normalize_title_main_text(main_part)
    detail_title = _normalize_title_detail_text(detail_part)
    if _category_requires_title_detail(category) and not detail_title and _title_has_config_detail(raw_text):
        compact_main = _clean_title(main_title).replace(" ", "")
        compact_raw = _clean_title(raw_text)
        if compact_main and compact_raw.startswith(compact_main):
            detail_title = _normalize_title_detail_text(compact_raw[len(compact_main):])
    if detail_title and main_title and detail_title.startswith(main_title):
        detail_title = _normalize_title_detail_text(detail_title[len(main_title):])
    if detail_title:
        detail_title = _dedupe_detail_tokens(main_title, detail_title)
    if detail_title:
        return f"{main_title} · {detail_title}"
    return main_title


def _score_customer_title_candidate(title: str, category: Any) -> int:
    if not title:
        return -1
    score = 100
    if _category_requires_title_detail(category):
        detail_parts = [part for part in re.split(r"\s*/\s*", title.split("·", 1)[1]) if _clean_title(part)] if "·" in title else []
        if "·" in title:
            score += 20
        if _title_has_config_detail(title):
            score += 20
        else:
            score -= 40
        score += min(_count_config_signals(title) * 6, 30)
        score += min(len(detail_parts) * 4, 24) if "·" in title else 0
        if _title_has_strong_primary_device_detail(title, category):
            score += 25
        else:
            score -= 20
        category_text = _clean_title(category)
        if re.search(r"^(联想(?:moto)?笔记本电脑|联想(?:moto)?显示器|联想(?:moto)?手机|联想(?:moto)?平板电脑)\b", title, re.IGNORECASE):
            score -= 28
        if category_text in {"游戏笔记本", "轻薄笔记本", "台式机", "一体机", "台式/一体机"}:
            if not CPU_CONFIG_PATTERN.search(title):
                score -= 26
            if not _has_storage_detail(title):
                score -= 18
            if not _has_memory_detail(title):
                score -= 18
            if len(detail_parts) < 4:
                score -= 12
        if category_text in {"平板电脑", "手机"}:
            if not _has_memory_detail(title):
                score -= 18
            if not _has_storage_detail(title):
                score -= 28
            else:
                score += 10
            if len(detail_parts) < 3:
                score -= 12
        if category_text == "显示器" and not re.search(r"\d{2,3}\s*Hz|\d(?:\.\d)?K|OLED|[A-Z]{1,4}\d{2,5}", title, re.IGNORECASE):
            score -= 18
    if any(pattern.search(title) for pattern in TITLE_PROMO_PATTERNS):
        score -= 30
    if _looks_like_internal_title(title):
        score -= 100
    return score


def _series_identity_score(title: Any, category: Any) -> int:
    text = _clean_title(title)
    category_text = _clean_title(category)
    if not text:
        return 0
    patterns: list[str] = []
    if category_text == "游戏笔记本":
        patterns = [
            r"拯救者|LEGION",
            r"Y7000P|Y7000X|Y9000P|R7000P|R9000P|Y7000|Y9000|R7000|R9000",
        ]
    elif category_text == "轻薄笔记本":
        patterns = [
            r"小新|YOGA|IDEAPAD|ThinkBook|ThinkPad|来酷",
            r"Pro14|Pro16|Air 14|Air14|14\s?Aura|16\s?Aura",
        ]
    elif category_text in {"台式机", "一体机", "台式/一体机"}:
        patterns = [
            r"小新|ThinkCentre|ThinkStation|AIO|YOGA",
        ]
    score = 0
    for pattern in patterns:
        if re.search(pattern, text, re.IGNORECASE):
            score += 1
    return score


def _main_title_specificity_score(title: Any) -> int:
    main_text = _clean_title(str(title or "").split("·", 1)[0])
    if not main_text:
        return 0
    score = 0
    if re.search(r"Y7000P|Y7000X|Y9000P|R7000P|R9000P|Y7000|Y9000|R7000|R9000|Pro14|Pro16|Air\s?14|Air14|Aura|ThinkBook|ThinkPad|YOGA|小新", main_text, re.IGNORECASE):
        score += 2
    if re.search(r"202[4-9]", main_text, re.IGNORECASE):
        score += 1
    if re.search(r"\d+(?:\.\d+)?英寸", main_text, re.IGNORECASE):
        score += 1
    if re.search(r"碳晶黑|冰魄白|深灰色|灰色|黑色|白色|蓝色|浅海贝|云影色|钛晶灰|钛晶黑|青巧|松烟蓝", main_text, re.IGNORECASE):
        score += 1
    return score


def _is_generic_series_lost_title(title: Any) -> bool:
    text = _clean_title(title)
    if not text:
        return False
    return bool(
        re.search(
            r"^联想(?:moto)?(?:酷睿|锐龙|骁龙|Ultra|英特尔)?[A-Za-z0-9\-\s]*笔记本电脑\b",
            text,
            re.IGNORECASE,
        )
    )


def _looks_like_internal_title(value: Any) -> bool:
    title = _clean_title(value)
    if not title:
        return False
    # Chinese characters indicate a customer-facing title, never internal
    if re.search(r'[\u4e00-\u9fff]', title):
        return False
    return any(pattern.search(title) for pattern in INTERNAL_TITLE_PATTERNS)


def _first_customer_title(*values: Any) -> str:
    for value in values:
        title = _clean_title(value)
        if title and not _looks_like_internal_title(title):
            return title
    return ""


def _title_main_and_detail(value: Any, category: Any) -> tuple[str, str]:
    normalized = _normalize_customer_title_candidate(value, category)
    if "·" in normalized:
        main, detail = normalized.split("·", 1)
        return _clean_title(main), _clean_title(detail)
    return _clean_title(normalized), ""


def _standard_source_match_titles(standard: dict[str, Any]) -> list[str]:
    sources = standard.get("sources") if isinstance(standard.get("sources"), dict) else {}
    titles: list[str] = []
    for source_key in ("jd", "lenovo_official", "taobao_subsidy"):
        source = sources.get(source_key)
        if not isinstance(source, dict):
            continue
        selected = source.get("selectedRecord")
        selected_status = _clean_title((selected or {}).get("collectionStatus")) if isinstance(selected, dict) else ""
        audit = source.get("evidenceAudit") if isinstance(source.get("evidenceAudit"), dict) else {}
        audit_status = _clean_title(audit.get("status"))
        if selected_status == "unavailable" or audit_status == "unavailable":
            continue
        if isinstance(selected, dict):
            titles.append(_clean_title(selected.get("matchTitle")))
        titles.append(_clean_title(source.get("matchTitle")))
    return [title for title in titles if title]


def _standard_source_detailed_titles(standard: dict[str, Any]) -> list[str]:
    sources = standard.get("sources") if isinstance(standard.get("sources"), dict) else {}
    titles: list[str] = []
    for source_key in ("lenovo_official", "jd", "taobao_subsidy"):
        source = sources.get(source_key)
        if not isinstance(source, dict):
            continue
        selected = source.get("selectedRecord") if isinstance(source.get("selectedRecord"), dict) else {}
        selected_status = _clean_title(selected.get("collectionStatus"))
        audit = source.get("evidenceAudit") if isinstance(source.get("evidenceAudit"), dict) else {}
        audit_status = _clean_title(audit.get("status"))
        if selected_status == "unavailable" or audit_status == "unavailable":
            continue
        match_title = _clean_title(selected.get("matchTitle") or source.get("matchTitle"))
        evidence = selected.get("evidence") if isinstance(selected.get("evidence"), dict) else {}
        note = _clean_title(evidence.get("note"))
        details = [
            _extract_note_quoted_value(note, "副标题"),
            _extract_note_quoted_value(note, "配置"),
            _extract_note_quoted_value(note, "已选规格为"),
            _extract_note_clause(note, "规格区当前停在", ("，价格区", "。价格区", "，主价", "。主价")),
        ]
        normalized_details: list[str] = []
        for detail in details:
            normalized = _normalize_title_detail_text(detail)
            if normalized and normalized not in normalized_details:
                normalized_details.append(normalized)
        if match_title and normalized_details:
            titles.append(f"{match_title} · {' / '.join(normalized_details)}")
    return titles


def _select_customer_display_title(
    *,
    sku_key: str,
    row: dict[str, Any],
    retail: dict[str, Any],
    standard: dict[str, Any],
    previous_item: dict[str, Any],
) -> str:
    category = (
        row.get("default_category")
        or row.get("sku_category")
        or standard.get("category")
        or retail.get("category")
    )
    hybrid_candidates: list[str] = []
    official_source = (standard.get("sources") or {}).get("lenovo_official") if isinstance(standard.get("sources"), dict) else {}
    jd_source = (standard.get("sources") or {}).get("jd") if isinstance(standard.get("sources"), dict) else {}
    official_title = ""
    if isinstance(official_source, dict):
        selected = official_source.get("selectedRecord") if isinstance(official_source.get("selectedRecord"), dict) else {}
        official_title = selected.get("matchTitle") or official_source.get("matchTitle") or ""
    official_main, official_detail = _title_main_and_detail(official_title, category)
    if official_main and not official_detail:
        jd_title = ""
        if isinstance(jd_source, dict):
            selected = jd_source.get("selectedRecord") if isinstance(jd_source.get("selectedRecord"), dict) else {}
            jd_title = selected.get("matchTitle") or jd_source.get("matchTitle") or ""
        _, jd_detail = _title_main_and_detail(jd_title, category)
        if jd_detail:
            hybrid_candidates.append(f"{official_main} · {jd_detail}")
    candidates = [
        *hybrid_candidates,
        *_standard_source_detailed_titles(standard),
        *_standard_source_match_titles(standard),
        standard.get("displayTitle"),
        standard.get("productName"),
        row.get("canonical_name"),
        previous_item.get("displayTitle"),
        previous_item.get("productName"),
        retail.get("displayTitle"),
        retail.get("productName"),
        row.get("sku_name"),
    ]
    best_title = ""
    best_score = -1
    normalized_candidates: list[tuple[str, int]] = []
    for index, candidate in enumerate(candidates):
        normalized_title = _normalize_customer_title_candidate(candidate, category)
        if not normalized_title:
            continue
        score = _score_customer_title_candidate(normalized_title, category) - index
        normalized_candidates.append((normalized_title, score))
        if score > best_score:
            best_title = normalized_title
            best_score = score
    category_text = _clean_title(category)
    if category_text in {"平板电脑", "手机"} and best_title and not _has_storage_detail(best_title):
        richer_candidates = [
            (title, score)
            for title, score in normalized_candidates
            if _has_storage_detail(title)
        ]
        if richer_candidates:
            richer_title, richer_score = max(richer_candidates, key=lambda item: item[1])
            if richer_score >= best_score - 12:
                best_title = richer_title
                best_score = richer_score
    canonical_candidate = _normalize_customer_title_candidate(row.get("canonical_name"), category)
    if best_title and _looks_like_internal_title(best_title) and canonical_candidate:
        best_title = canonical_candidate
        best_score = max(best_score, _score_customer_title_candidate(canonical_candidate, category))
    if canonical_candidate and best_title:
        canonical_series_score = _series_identity_score(canonical_candidate, category)
        best_series_score = _series_identity_score(best_title, category)
        canonical_specificity_score = _main_title_specificity_score(canonical_candidate)
        best_specificity_score = _main_title_specificity_score(best_title)
        if (
            canonical_series_score > best_series_score
            and (_is_generic_series_lost_title(best_title) or canonical_series_score >= 2)
        ) or (
            canonical_series_score == best_series_score
            and canonical_series_score > 0
            and canonical_specificity_score > best_specificity_score
        ):
            best_title = canonical_candidate
            best_score = max(best_score, _score_customer_title_candidate(canonical_candidate, category))
    if best_title:
        return best_title
    return _normalize_customer_title_candidate(
        row.get("canonical_name")
        or standard.get("displayTitle")
        or standard.get("productName")
        or previous_item.get("displayTitle")
        or retail.get("displayTitle")
        or retail.get("productName")
        or (_standard_source_match_titles(standard)[0] if _standard_source_match_titles(standard) else "")
        or row.get("sku_name")
        or sku_key,
        category,
    ) or _clean_title(sku_key)


def _pick_first_price(*values: Any) -> float | None:
    for value in values:
        price = _to_price(value)
        if price is not None:
            return price
    return None


def _safe_float(value: Any) -> float:
    return float(_to_price(value) or 0)


def _today_local_text() -> str:
    return datetime.now().astimezone().date().isoformat()


def _days_remaining(date_text: str) -> int | None:
    text = str(date_text or "").strip()
    if not text:
        return None
    try:
        target = datetime.fromisoformat(f"{text}T00:00:00").date()
    except ValueError:
        return None
    today = datetime.now().astimezone().date()
    return (target - today).days


def _activity_kind(item: dict[str, Any]) -> str | None:
    activity_category = str(item.get("activityCategory") or "").lower()
    activity_label = str(item.get("activityLabel") or "")
    source_type = str(item.get("sourceType") or "").lower()
    if "education" in activity_category or "教育" in activity_label or "education" in source_type:
        return "education"
    if "po" in activity_category or "营销" in activity_label or "po" in activity_label.lower():
        return "marketing_po"
    if _to_price(item.get("educationDiscountAmount")) is not None:
        return "education"
    if _to_price(item.get("boostAmount")) is not None or _to_price(item.get("estimatedMarketingSupportAmount")) is not None:
        return "marketing_po"
    return None


def _activity_amount(item: dict[str, Any], kind: str) -> float:
    if kind == "education":
        return _safe_float(item.get("educationDiscountAmount"))
    return _safe_float(item.get("boostAmount")) or _safe_float(item.get("estimatedMarketingSupportAmount"))


def _should_replace_current_activity(
    existing_activity: dict[str, Any] | None,
    existing_amount: float,
    candidate_activity: dict[str, Any],
    candidate_amount: float,
) -> bool:
    if not existing_activity:
        return True
    existing_valid_from = str(existing_activity.get("validFrom") or "").strip()
    candidate_valid_from = str(candidate_activity.get("validFrom") or "").strip()
    if candidate_valid_from and candidate_valid_from != existing_valid_from:
        return candidate_valid_from > existing_valid_from
    existing_valid_to = str(existing_activity.get("validTo") or "").strip()
    candidate_valid_to = str(candidate_activity.get("validTo") or "").strip()
    if candidate_valid_to and candidate_valid_to != existing_valid_to:
        if not existing_valid_to:
            return True
        return candidate_valid_to < existing_valid_to
    if candidate_amount != existing_amount:
        return candidate_amount > existing_amount
    candidate_id = str(candidate_activity.get("id") or "").strip()
    existing_id = str(existing_activity.get("id") or "").strip()
    return candidate_id > existing_id


def _build_marketing_activity_map(marketing_snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    sources = []
    today = _today_local_text()
    for key in ("eligibleInventory", "activities", "activityHistory"):
        value = marketing_snapshot.get(key, [])
        if isinstance(value, list):
            sources.extend(item for item in value if isinstance(item, dict))
    for item in sources:
        sku_key = str(item.get("skuKey") or "").strip()
        if not sku_key:
            continue
        valid_from = str(item.get("validFrom") or "").strip()
        valid_to = str(item.get("validTo") or "").strip()
        if valid_from and today < valid_from:
            continue
        if valid_to and today > valid_to:
            continue
        kind = _activity_kind(item)
        if not kind:
            continue
        amount = _activity_amount(item, kind)
        if amount <= 0:
            continue
        current = grouped.setdefault(sku_key, {
            "marketingPoAmount": 0.0,
            "educationDiscountAmount": 0.0,
            "marketingPoActivity": None,
            "educationActivity": None,
            "activityLabels": [],
        })
        label = str(item.get("activityLabel") or item.get("groupName") or item.get("activityCategory") or "活动").strip()
        if label and label not in current["activityLabels"]:
            current["activityLabels"].append(label)
        serialized = _apply_activity_display_fields({
            "id": str(item.get("id") or ""),
            "kind": kind,
            "label": label,
            "amount": round(amount, 2),
            "validFrom": str(item.get("validFrom") or ""),
            "validTo": str(item.get("validTo") or ""),
            "countdownDays": _days_remaining(str(item.get("validTo") or "").strip()) if str(item.get("validTo") or "").strip() else None,
            "ruleText": str(item.get("ruleText") or item.get("rawText") or ""),
            "sourceFile": str(item.get("sourceFile") or ""),
            "sourceType": str(item.get("sourceType") or ""),
        })
        if kind == "education":
            if _should_replace_current_activity(
                current.get("educationActivity"),
                _safe_float(current.get("educationDiscountAmount")),
                serialized,
                amount,
            ):
                current["educationDiscountAmount"] = round(amount, 2)
                current["educationActivity"] = serialized
        else:
            if _should_replace_current_activity(
                current.get("marketingPoActivity"),
                _safe_float(current.get("marketingPoAmount")),
                serialized,
                amount,
            ):
                current["marketingPoAmount"] = round(amount, 2)
                current["marketingPoActivity"] = serialized
    return grouped


def _sync_product_activity_current(conn, marketing_snapshot: dict[str, Any], timestamp: str) -> None:
    grouped = _build_marketing_activity_map(marketing_snapshot)
    _execute_with_retry(conn, "DELETE FROM product_activity_current")
    for sku_key, item in grouped.items():
        for kind, amount_key, activity_key in (
            ("marketing_po", "marketingPoAmount", "marketingPoActivity"),
            ("education", "educationDiscountAmount", "educationActivity"),
        ):
            amount = _safe_float(item.get(amount_key))
            activity = item.get(activity_key) if isinstance(item.get(activity_key), dict) else None
            if amount <= 0 or not activity:
                continue
            activity_label = str(activity.get("label") or activity.get("ruleName") or kind).strip()
            valid_to = str(activity.get("validTo") or "").strip()
            countdown_days = _days_remaining(valid_to) if valid_to else None
            payload_json = json.dumps(activity, ensure_ascii=False)
            _execute_with_retry(
                conn,
                """
                INSERT INTO product_activity_current
                (id, sku_key, activity_kind, activity_label, amount,
                 valid_from, valid_to, countdown_days, rule_text,
                 source_file, source_type, source_activity_id, payload_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    stable_id(sku_key, kind, str(activity.get("id") or activity_label or timestamp)),
                    sku_key,
                    kind,
                    activity_label,
                    round(amount, 2),
                    str(activity.get("validFrom") or ""),
                    valid_to,
                    countdown_days,
                    str(activity.get("ruleText") or ""),
                    str(activity.get("sourceFile") or ""),
                    str(activity.get("sourceType") or ""),
                    str(activity.get("id") or ""),
                    payload_json,
                    timestamp,
                ),
            )


def _load_marketing_activity_map_from_sql(conn) -> dict[str, dict[str, Any]]:
    rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT sku_key, activity_kind, activity_label, amount,
                   valid_from, valid_to, countdown_days, rule_text,
                   source_file, source_type, source_activity_id, payload_json
            FROM product_activity_current
            ORDER BY sku_key ASC, updated_at DESC, amount DESC
            """
        ).fetchall()
    ]
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        sku_key = str(row.get("sku_key") or "").strip()
        kind = str(row.get("activity_kind") or "").strip()
        if not sku_key or kind not in {"marketing_po", "education"}:
            continue
        current = grouped.setdefault(
            sku_key,
            {
                "marketingPoAmount": 0.0,
                "educationDiscountAmount": 0.0,
                "marketingPoActivity": None,
                "educationActivity": None,
                "activityLabels": [],
            },
        )
        payload_text = str(row.get("payload_json") or "").strip()
        try:
            payload = json.loads(payload_text) if payload_text else {}
        except json.JSONDecodeError:
            payload = {}
        serialized = _apply_activity_display_fields({
            "id": str(row.get("source_activity_id") or ""),
            "kind": kind,
            "label": str(row.get("activity_label") or ""),
            "amount": round(float(row.get("amount") or 0), 2),
            "validFrom": str(row.get("valid_from") or ""),
            "validTo": str(row.get("valid_to") or ""),
            "countdownDays": row.get("countdown_days"),
            "ruleText": str(row.get("rule_text") or ""),
            "sourceFile": str(row.get("source_file") or ""),
            "sourceType": str(row.get("source_type") or ""),
        })
        if isinstance(payload, dict):
            serialized.update({key: value for key, value in payload.items() if key not in serialized and value not in (None, "")})
        label = serialized["label"]
        if label and label not in current["activityLabels"]:
            current["activityLabels"].append(label)
        if kind == "education":
            if _should_replace_current_activity(
                current.get("educationActivity"),
                _safe_float(current.get("educationDiscountAmount")),
                serialized,
                _safe_float(serialized.get("amount")),
            ):
                current["educationDiscountAmount"] = serialized["amount"]
                current["educationActivity"] = serialized
        else:
            if _should_replace_current_activity(
                current.get("marketingPoActivity"),
                _safe_float(current.get("marketingPoAmount")),
                serialized,
                _safe_float(serialized.get("amount")),
            ):
                current["marketingPoAmount"] = serialized["amount"]
                current["marketingPoActivity"] = serialized
    return grouped


def _build_store_manual_promotion_map(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    today = _today_local_text()
    grouped: dict[str, dict[str, Any]] = {}
    for item in rows:
        sku_key = str(item.get("sku_key") or "").strip()
        if not sku_key or not int(item.get("enabled") or 0):
            continue
        valid_from = str(item.get("valid_from") or "")
        valid_to = str(item.get("valid_to") or "")
        if valid_from and today < valid_from:
            continue
        if valid_to and today > valid_to:
            continue
        current = grouped.get(sku_key)
        updated_at = str(item.get("updated_at") or "")
        if current and updated_at < str(current.get("updatedAt") or ""):
            continue
        grouped[sku_key] = {
            "id": str(item.get("id") or ""),
            "mode": str(item.get("mode") or "minus_amount"),
            "value": round(float(item.get("value") or 0), 2),
            "validFrom": valid_from,
            "validTo": valid_to,
            "note": str(item.get("note") or ""),
            "enabled": True,
            "updatedAt": updated_at,
        }
    return grouped


def _build_manufacturer_manual_promotion_map(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    today = _today_local_text()
    grouped: dict[str, dict[str, Any]] = {}
    for item in rows:
        sku_key = str(item.get("sku_key") or "").strip()
        if not sku_key or not int(item.get("enabled") or 0):
            continue
        valid_from = str(item.get("valid_from") or "").strip()
        valid_to = str(item.get("valid_to") or "").strip()
        if valid_from and today < valid_from:
            continue
        if valid_to and today > valid_to:
            continue
        current = grouped.setdefault(
            sku_key,
            {
                "marketingPoAmount": 0.0,
                "educationDiscountAmount": 0.0,
                "marketingPoActivity": None,
                "educationActivity": None,
                "activityLabels": [],
            },
        )
        source_labels = [
            segment.strip()
            for segment in str(item.get("source_labels") or "").split(" / ")
            if segment.strip()
        ]
        source_activity_ids = [
            segment.strip()
            for segment in str(item.get("source_activity_ids") or "").split(",")
            if segment.strip()
        ]
        marketing_label = source_labels[0] if source_labels else "厂家产品营销库 营销PO"
        education_label = source_labels[1] if len(source_labels) > 1 else (source_labels[0] if source_labels else "厂家产品营销库 教育补")
        common_payload = {
            "validFrom": valid_from,
            "validTo": valid_to,
            "countdownDays": _days_remaining(valid_to) if valid_to else None,
            "ruleText": str(item.get("note") or "").strip(),
            "sourceFile": "manufacturer_manual_promotion",
            "sourceType": "manufacturer_manual",
        }
        if int(item.get("marketing_po_enabled") or 0):
            amount = round(float(item.get("boost_amount") or 0), 2)
            if amount > 0 and amount >= current["marketingPoAmount"]:
                activity_id = source_activity_ids[0] if source_activity_ids else f"manufacturer-manual:{item.get('id')}:{sku_key}:marketing"
                serialized = _apply_activity_display_fields({
                    "id": activity_id,
                    "kind": "marketing_po",
                    "label": marketing_label if "营销" in marketing_label or "PO" in marketing_label.upper() else f"{marketing_label} 营销PO",
                    "amount": amount,
                    **common_payload,
                })
                current["marketingPoAmount"] = amount
                current["marketingPoActivity"] = serialized
                if serialized["label"] not in current["activityLabels"]:
                    current["activityLabels"].append(serialized["label"])
        if int(item.get("education_enabled") or 0):
            amount = round(float(item.get("education_amount") or 0), 2)
            if amount > 0 and amount >= current["educationDiscountAmount"]:
                activity_id = source_activity_ids[1] if len(source_activity_ids) > 1 else f"manufacturer-manual:{item.get('id')}:{sku_key}:education"
                serialized = _apply_activity_display_fields({
                    "id": activity_id,
                    "kind": "education",
                    "label": education_label if "教育" in education_label else f"{education_label} 教育补",
                    "amount": amount,
                    **common_payload,
                })
                current["educationDiscountAmount"] = amount
                current["educationActivity"] = serialized
                if serialized["label"] not in current["activityLabels"]:
                    current["activityLabels"].append(serialized["label"])
    return grouped


def _merge_marketing_activity_maps(
    base_map: dict[str, dict[str, Any]],
    override_map: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    merged = json.loads(json.dumps(base_map, ensure_ascii=False))
    for sku_key, override in override_map.items():
        current = merged.setdefault(
            sku_key,
            {
                "marketingPoAmount": 0.0,
                "educationDiscountAmount": 0.0,
                "marketingPoActivity": None,
                "educationActivity": None,
                "activityLabels": [],
            },
        )
        marketing_amount = _safe_float(override.get("marketingPoAmount"))
        education_amount = _safe_float(override.get("educationDiscountAmount"))
        if marketing_amount > 0:
            current["marketingPoAmount"] = round(marketing_amount, 2)
            current["marketingPoActivity"] = override.get("marketingPoActivity")
        if education_amount > 0:
            current["educationDiscountAmount"] = round(education_amount, 2)
            override_activity = override.get("educationActivity")
            current_activity = current.get("educationActivity")
            override_has_retail_price = _education_activity_retail_price(override_activity) is not None
            current_has_retail_price = _education_activity_retail_price(current_activity) is not None
            if override_activity and (override_has_retail_price or not current_has_retail_price):
                current["educationActivity"] = override_activity
        for label in override.get("activityLabels", []):
            if label and label not in current["activityLabels"]:
                current["activityLabels"].append(label)
    return merged


def _store_manual_promotion_amount(promotion: dict[str, Any] | None, subsidy_price: float | None) -> float:
    if not promotion or subsidy_price is None or subsidy_price <= 0:
        return 0.0
    value = _safe_float(promotion.get("value"))
    if value <= 0:
        return 0.0
    if str(promotion.get("mode") or "") == "fixed_price":
        return round(max(subsidy_price - value, 0), 2)
    return round(value, 2)


def _store_manual_promotion_pre_subsidy_price(
    promotion: dict[str, Any] | None,
    store_retail_price: float | None,
) -> float | None:
    if store_retail_price is None:
        return None
    if not promotion:
        return store_retail_price
    value = _safe_float(promotion.get("value"))
    if value <= 0:
        return store_retail_price
    if str(promotion.get("mode") or "") == "fixed_price":
        return round(max(value, 0), 2)
    return round(max(store_retail_price - value, 0), 2)


def _subsidy_category(category: str, source_category: str, jd_subcategory: str, title: str, spec: str) -> str | None:
    text = f"{category} {source_category} {jd_subcategory} {title} {spec}"
    normalized_category = str(category or "").strip()
    if normalized_category in {"电脑配件", "耳机音箱", "显示器", "打印机"}:
        return None
    if any(token in text for token in ("电脑配件", "耳机音箱", "显示器", "打印机", "喷墨", "墨仓", "打印", "复印", "扫描", "CM408", "键盘", "鼠标", "适配器", "支架", "保护夹", "钢化膜", "背包", "耗材", "手写笔", "散热", "贴膜")):
        return None
    upper_text = text.upper()
    if "平板" in upper_text or re.search(r"(?<![0-9A-Z])TAB\b|(?<![0-9A-Z])PAD\b|(?<![0-9A-Z])TB\d+|(?:拯救者\s*)?Y700(?!0)", upper_text, re.IGNORECASE):
        return "tablet"
    if any(token in upper_text for token in ("手机", "MOTO", "RAZR", "EDGE", "PHN", "XT", "折叠机", "直板机")):
        return "phone"
    if any(token in upper_text for token in ("游戏笔记本", "轻薄笔记本", "一体机", "商务台式", "游戏主机", "笔记本", "电脑", "主机", "台式", "拯救者", "LEGION", "小新", "YOGA", "来酷", "LECOO", "斗战者", "THINKPAD", "THINKBOOK", "GEEKPRO", "天逸")):
        return "computer"
    return None


def _standard_subsidy_price_from_pre_subsidy(
    pre_subsidy_price: float | None,
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
) -> float | None:
    if pre_subsidy_price is None or pre_subsidy_price <= 0:
        return None
    subsidy_category = _subsidy_category(category, source_category, jd_subcategory, title, spec)
    if not subsidy_category:
        return None
    if subsidy_category in {"tablet", "phone"} and pre_subsidy_price >= 6000:
        return None
    if subsidy_category == "computer":
        subsidy_amount = 1500 if pre_subsidy_price >= 10000 else pre_subsidy_price * 0.15
    else:
        subsidy_amount = min(pre_subsidy_price * 0.15, 500)
    return round(max(pre_subsidy_price - subsidy_amount, 0), 2)


def _normalize_99_ending_price(value: float | None) -> float | None:
    if value is None or value <= 0:
        return None
    return float(math.ceil(value / 100) * 100 - 1)


def _normalize_9_ending_price(value: float | None) -> float | None:
    if value is None or value <= 0:
        return None
    return float(math.ceil(value / 10) * 10 - 1)


def _product_price_text(
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
) -> str:
    return f"{category} {source_category} {jd_subcategory} {title} {spec} {pn_mtm}".upper()


def _is_accessory_price_sku(
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
) -> bool:
    text = _product_price_text(category, source_category, jd_subcategory, title, spec, pn_mtm)
    return bool(re.search(r"电脑配件|耳机音箱|打印机|喷墨|墨仓|打印|复印|扫描|CM408|键盘|鼠标|适配器|电源|充电器|支架|保护夹|钢化膜|背包|配件|耗材|手写笔|散热|贴膜", text, re.IGNORECASE))


def _is_same_price_category(
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
) -> bool:
    text = _product_price_text(category, source_category, jd_subcategory, title, spec, pn_mtm)
    return bool(re.search(r"一体机|台式|平板|手机|显示器|游戏主机|主机", text, re.IGNORECASE))


def _is_gaming_notebook(
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
) -> bool:
    category_text = f"{category} {source_category} {jd_subcategory}"
    if re.search(r"轻薄|平板|手机|配件|显示器|打印|一体机|台式", category_text, re.IGNORECASE):
        return False
    if re.search(r"游戏笔记本|游戏本", category_text, re.IGNORECASE):
        return True
    text = _product_price_text(category, source_category, jd_subcategory, title, spec, pn_mtm)
    return bool(re.search(r"拯救者|LEGION|斗战者|[RY]\d{4}P?", text, re.IGNORECASE))


def _is_white_gaming_notebook(
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
) -> bool:
    text = _product_price_text(category, source_category, jd_subcategory, title, spec, pn_mtm)
    return _is_gaming_notebook(category, source_category, jd_subcategory, title, spec, pn_mtm) and bool(re.search(r"冰魄白|月幕白|白色|(?<![A-Z])白(?![A-Z])|WHE", text, re.IGNORECASE))


def _is_thin_notebook(
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
) -> bool:
    text = _product_price_text(category, source_category, jd_subcategory, title, spec, pn_mtm)
    return bool(re.search(r"轻薄|小新|YOGA|AIR|PRO14|PRO16|来酷|LECOO", text, re.IGNORECASE))


def _is_notebook_price_sku(
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
) -> bool:
    text = _product_price_text(category, source_category, jd_subcategory, title, spec, pn_mtm)
    if re.search(r"台式|一体机|显示器|平板|手机|配件|打印|耳机|路由|摄像头|保护夹|保护壳|钢化膜|贴膜|手写笔", text, re.IGNORECASE):
        return False
    return bool(re.search(r"笔记本|游戏本|轻薄本|拯救者|LEGION|小新|YOGA|来酷|LECOO|斗战者|THINKPAD|THINKBOOK|PRO14|PRO16|Y7000|Y9000|R7000|R9000", text, re.IGNORECASE))


def _standard_price_source_price(source: Any) -> float | None:
    if not isinstance(source, dict):
        return None
    selected = source.get("selectedRecord")
    if not isinstance(selected, dict):
        return None
    return _pick_first_price(
        selected.get("comparablePrice"),
        selected.get("preSubsidyPrice"),
        selected.get("price"),
    )


def _education_activity_retail_price(activity: Any) -> float | None:
    if not isinstance(activity, dict):
        return None
    direct_price = _pick_first_price(
        activity.get("retailPrice"),
        activity.get("preSubsidyPrice"),
        activity.get("storeRetailPrice"),
    )
    if direct_price is not None:
        return direct_price
    text = " ".join(
        str(activity.get(key) or "")
        for key in ("ruleText", "note", "title", "label", "sourceText")
    )
    match = re.search(r"零售价\s*[：:]?\s*(?:￥|¥)?\s*([0-9]+(?:\.[0-9]+)?)", text)
    if not match:
        return None
    return _to_price(match.group(1))


def _store_price_base_from_sources(
    standard: dict[str, Any],
    retail: dict[str, Any],
    *,
    category: str = "",
    source_category: str = "",
    jd_subcategory: str = "",
    title: str = "",
    spec: str = "",
    pn_mtm: str = "",
) -> tuple[float | None, str]:
    sources = standard.get("sources") if isinstance(standard.get("sources"), dict) else {}
    jd_price = _pick_first_price(
        _standard_price_source_price(sources.get("jd")),
        retail.get("jdPrice"),
    )
    lenovo_price = _pick_first_price(
        _standard_price_source_price(sources.get("lenovo_official")),
        retail.get("lenovoOfficialPrice"),
    )
    tmall_price = _pick_first_price(
        _standard_price_source_price(sources.get("taobao_subsidy")),
        retail.get("taobaoPrice"),
    )
    jd_lenovo_candidates = [
        (label, price)
        for label, price in (("jd", jd_price), ("lenovo_official", lenovo_price))
        if price is not None and price > 0
    ]
    if _is_gaming_notebook(category, source_category, jd_subcategory, title, spec, pn_mtm):
        if lenovo_price is not None and lenovo_price > 0:
            return lenovo_price, "lenovo_official"
        if jd_price is not None and jd_price > 0:
            return jd_price, "jd_fallback_no_lenovo_official"
        if tmall_price is not None and tmall_price > 0:
            return tmall_price, "taobao_subsidy_fallback"
        return None, ""
    if jd_lenovo_candidates:
        label, price = min(jd_lenovo_candidates, key=lambda item: item[1])
        return price, label
    if tmall_price is not None and tmall_price > 0:
        return tmall_price, "taobao_subsidy_fallback"
    return None, ""


def _calculate_store_retail_price_by_policy(
    *,
    standard: dict[str, Any],
    retail: dict[str, Any],
    category: str,
    source_category: str,
    jd_subcategory: str,
    title: str,
    spec: str,
    pn_mtm: str,
    education_discount_amount: float,
    education_activity: dict[str, Any] | None = None,
) -> tuple[float | None, dict[str, Any]]:
    base_price, base_source = _store_price_base_from_sources(
        standard,
        retail,
        category=category,
        source_category=source_category,
        jd_subcategory=jd_subcategory,
        title=title,
        spec=spec,
        pn_mtm=pn_mtm,
    )
    education_activity_retail_price = _education_activity_retail_price(education_activity)
    if (
        base_price is None
        and education_activity_retail_price is not None
        and _is_notebook_price_sku(category, source_category, jd_subcategory, title, spec, pn_mtm)
    ):
        base_price = education_activity_retail_price
        base_source = "education_activity_retail_price"
    if base_price is None:
        return None, {
            "status": "no_platform_price",
            "rule": "缺少京东/官旗/教育活动零售价；未使用旧平均价规则",
        }
    education_add_back = min(education_discount_amount, 500.0) if _is_notebook_price_sku(category, source_category, jd_subcategory, title, spec, pn_mtm) else 0.0
    if base_source == "education_activity_retail_price":
        base_label = "教育活动零售价"
    elif base_source == "lenovo_official":
        base_label = "联想官旗价"
    elif base_source == "jd_fallback_no_lenovo_official":
        base_label = "联想官旗缺价后京东备用价"
    else:
        base_label = "京东/官旗最低价"
    if _is_accessory_price_sku(category, source_category, jd_subcategory, title, spec, pn_mtm):
        raw_price = base_price * 1.1
        return _normalize_9_ending_price(raw_price), {
            "status": "active",
            "basePrice": base_price,
            "baseSource": base_source,
            "markup": round(raw_price - base_price, 2),
            "educationAddBack": 0,
            "rule": f"{base_label}；配件按采集价 ×1.1 取9尾",
        }
    if _is_same_price_category(category, source_category, jd_subcategory, title, spec, pn_mtm):
        raw_price = base_price + education_add_back
        return _normalize_99_ending_price(raw_price), {
            "status": "same_price",
            "basePrice": base_price,
            "baseSource": base_source,
            "markup": 0,
            "educationAddBack": education_add_back,
            "rule": f"同价类按{base_label}；笔记本教育补封顶加回500；最终99尾",
        }
    if _is_gaming_notebook(category, source_category, jd_subcategory, title, spec, pn_mtm):
        base_markup = 400.0 if base_price >= 10000 else 300.0
        white_markup = 500.0 if _is_white_gaming_notebook(category, source_category, jd_subcategory, title, spec, pn_mtm) else 0.0
        raw_price = base_price + base_markup + white_markup + education_add_back
        return _normalize_99_ending_price(raw_price), {
            "status": "active",
            "basePrice": base_price,
            "baseSource": base_source,
            "markup": base_markup + white_markup,
            "baseMarkup": base_markup,
            "whiteGamingMarkup": white_markup,
            "educationAddBack": education_add_back,
            "rule": f"{base_label} + 游戏本加价 + 白色游戏本加价 + 笔记本教育补封顶加回；全部叠加，最终99尾",
        }
    if _is_thin_notebook(category, source_category, jd_subcategory, title, spec, pn_mtm):
        markup = 300.0 if base_price >= 5000 else 200.0
        raw_price = base_price + markup + education_add_back
        return _normalize_99_ending_price(raw_price), {
            "status": "active",
            "basePrice": base_price,
            "baseSource": base_source,
            "markup": markup,
            "educationAddBack": education_add_back,
            "rule": f"{base_label} + 轻薄本加价 + 笔记本教育补封顶加回；全部叠加，最终99尾",
        }
    return None, {
        "status": "unmatched_category",
        "basePrice": base_price,
        "baseSource": base_source,
        "rule": "未命中昨天确认的门店价类目规则；不回退旧平均价规则",
    }


def build_published_product_projection(data_dir: Path) -> dict[str, Any]:
    init_product_library()
    with connect() as conn:
        retail_zone_snapshot = _load_snapshot_payload(conn, data_dir, "latest-retail-zone-snapshot.json", {"decisions": {"items": []}})
        standard_inventory_snapshot = _load_snapshot_payload(conn, data_dir, "latest-standard-inventory-snapshot.json", {"skus": []})
        standard_price_master = _load_snapshot_payload(conn, data_dir, "latest-standard-price-master.json", {"rows": []})
        marketing_snapshot = _load_snapshot_payload(conn, data_dir, "latest-marketing-boost-snapshot.json", {"activities": []})
        previous_projection = _load_snapshot_payload(conn, data_dir, "latest-published-product-projection.json", {"items": []})
        manual_override_snapshot = _load_json(data_dir / "latest-manual-price-overrides.json", {"overrides": {}})
        current_manual_overrides = manual_override_snapshot.get("overrides", {}) if isinstance(manual_override_snapshot, dict) else {}
        retail_zone_items = {
            str(item.get("skuKey") or ""): item
            for item in retail_zone_snapshot.get("decisions", {}).get("items", [])
            if isinstance(item, dict) and str(item.get("skuKey") or "").strip()
        }
        previous_projection_items = {
            str(item.get("skuKey") or ""): item
            for item in previous_projection.get("items", [])
            if isinstance(item, dict) and str(item.get("skuKey") or "").strip()
        }
        standard_inventory_rows = {
            str(item.get("skuKey") or ""): item
            for item in standard_inventory_snapshot.get("skus", [])
            if isinstance(item, dict) and str(item.get("skuKey") or "").strip()
        }
        standard_price_rows = {
            str(item.get("skuKey") or ""): item
            for item in standard_price_master.get("rows", [])
            if isinstance(item, dict) and str(item.get("skuKey") or "").strip()
        }
        _sync_product_activity_current(conn, marketing_snapshot, now_iso())
        marketing_map = _load_marketing_activity_map_from_sql(conn)
        manufacturer_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, sku_key, boost_amount, education_amount,
                       valid_from, valid_to, note, enabled,
                       marketing_po_enabled, education_enabled,
                       source_activity_ids, source_labels, updated_at
                FROM manufacturer_manual_promotion
                ORDER BY updated_at DESC, valid_to DESC, id DESC
                """
            ).fetchall()
        ]
        manufacturer_map = _build_manufacturer_manual_promotion_map(manufacturer_rows)
        marketing_map = _merge_marketing_activity_maps(marketing_map, manufacturer_map)
        manual_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, sku_key, mode, value, valid_from, valid_to, note, enabled, updated_at
                FROM store_manual_promotion
                ORDER BY updated_at DESC, valid_to DESC
                """
            ).fetchall()
        ]
        manual_map = _build_store_manual_promotion_map(manual_rows)
        adjustment_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT sku_key, adjusted_field, adjusted_value, created_at, reason, source_system, created_by
                FROM product_price_adjustment
                ORDER BY created_at DESC, id DESC
                """
            ).fetchall()
        ]
        price_adjustment_map: dict[str, dict[str, float]] = {}
        for row in adjustment_rows:
            sku_key = str(row.get("sku_key") or "").strip()
            field_name = str(row.get("adjusted_field") or "").strip()
            if not sku_key or not field_name:
                continue
            reason = str(row.get("reason") or "")
            source_system = str(row.get("source_system") or "")
            created_by = str(row.get("created_by") or "")
            if created_by == "codex_probe" or "probe" in reason.lower():
                continue
            if source_system == "manual_override" and created_by == "system" and "seeded from latest-manual-price-overrides.json" in reason:
                override = current_manual_overrides.get(sku_key)
                if not isinstance(override, dict) or not isinstance(override.get(field_name), (int, float)):
                    continue
            bucket = price_adjustment_map.setdefault(sku_key, {})
            if field_name in bucket:
                continue
            bucket[field_name] = _safe_float(row.get("adjusted_value"))
        inventory_snapshot_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT source_key, payload_json, last_seen_at
                FROM product_source_link
                WHERE source_system = 'inventory_snapshot'
                  AND source_type = 'sku_snapshot'
                ORDER BY last_seen_at DESC
                """
            ).fetchall()
        ]
        inventory_snapshot_price_map: dict[str, dict[str, float]] = {}
        for row in inventory_snapshot_rows:
            sku_key = str(row.get("source_key") or "").strip()
            payload_text = str(row.get("payload_json") or "").strip()
            if not sku_key or not payload_text or sku_key in inventory_snapshot_price_map:
                continue
            try:
                payload = json.loads(payload_text)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            inventory_snapshot_price_map[sku_key] = {
                "agentPrice": _safe_float(payload.get("agentPrice")),
                "salesCostPrice": _safe_float(payload.get("salesCostPrice")),
            }
        serial_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT sku_key, serial_number, product_name, pn_mtm, spec, updated_at
                FROM serial_item
                WHERE status = 'in_stock'
                ORDER BY updated_at DESC, serial_number
                """
            ).fetchall()
        ]
        serial_map: dict[str, list[dict[str, Any]]] = {}
        for row in serial_rows:
            serial_map.setdefault(str(row["sku_key"]), []).append(row)
        raw_sku_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT
                  master.id AS product_id,
                  master.product_id AS source_product_id,
                  master.canonical_name,
                  master.configuration_summary,
                  master.default_category,
                  master.updated_at AS product_updated_at,
                  sku.sku_key,
                  sku.name AS sku_name,
                  sku.pn_mtm,
                  sku.category AS sku_category,
                  sku.source_category,
                  sku.jd_subcategory,
                  sku.catalog_source,
                  sku.current_stock,
                  sku.sellable_stock,
                  sku.updated_at AS sku_updated_at
                FROM product_master AS master
                LEFT JOIN sku ON sku.sku_key = master.primary_sku_key
                ORDER BY COALESCE(sku.sellable_stock, 0) DESC, master.updated_at DESC, sku.sku_key
                """
            ).fetchall()
        ]
        sku_rows_by_key = {
            str(row.get("sku_key") or "").strip(): row
            for row in raw_sku_rows
            if str(row.get("sku_key") or "").strip()
        }
        all_sku_keys = set(sku_rows_by_key.keys())
        all_sku_keys.update(standard_inventory_rows.keys())
        all_sku_keys.update(retail_zone_items.keys())
        all_sku_keys.update(standard_price_rows.keys())
        all_sku_keys.update(previous_projection_items.keys())
        all_sku_keys.update(marketing_map.keys())
        all_sku_keys.update(serial_map.keys())
        sku_rows: list[dict[str, Any]] = []
        for sku_key in all_sku_keys:
            row = dict(sku_rows_by_key.get(sku_key, {}))
            inventory_row = standard_inventory_rows.get(sku_key, {})
            previous_item = previous_projection_items.get(sku_key, {})
            retail_item = retail_zone_items.get(sku_key, {})
            standard_row = standard_price_rows.get(sku_key, {})
            sku_rows.append({
                "product_id": row.get("product_id") or previous_item.get("productId") or f"PROD-{sku_key}",
                "source_product_id": row.get("source_product_id") or previous_item.get("productId") or f"PROD-{sku_key}",
                "canonical_name": row.get("canonical_name") or inventory_row.get("productName") or previous_item.get("displayTitle") or previous_item.get("productName") or retail_item.get("productName") or standard_row.get("displayTitle") or sku_key,
                "configuration_summary": row.get("configuration_summary") or inventory_row.get("spec") or previous_item.get("spec") or standard_row.get("spec") or retail_item.get("spec") or "",
                "default_category": row.get("default_category") or inventory_row.get("category") or previous_item.get("category") or retail_item.get("category") or "",
                "product_updated_at": row.get("product_updated_at") or previous_item.get("updatedAt") or now_iso(),
                "sku_key": sku_key,
                "sku_name": row.get("sku_name") or inventory_row.get("productName") or previous_item.get("displayTitle") or previous_item.get("productName") or retail_item.get("productName") or sku_key,
                "pn_mtm": row.get("pn_mtm") or inventory_row.get("pnMtm") or previous_item.get("pnMtm") or retail_item.get("pnMtm") or "",
                "sku_category": row.get("sku_category") or inventory_row.get("category") or previous_item.get("category") or retail_item.get("category") or "",
                "source_category": row.get("source_category") or inventory_row.get("sourceCategory") or previous_item.get("sourceCategory") or retail_item.get("sourceCategory") or "",
                "jd_subcategory": row.get("jd_subcategory") or inventory_row.get("jdSubcategory") or previous_item.get("jdSubcategory") or retail_item.get("jdSubcategory") or "",
                "catalog_source": row.get("catalog_source") or inventory_row.get("catalogSource") or previous_item.get("catalogSource") or retail_item.get("catalogSource") or "",
                "current_stock": row.get("current_stock") or 0,
                "sellable_stock": row.get("sellable_stock") or 0,
                "sku_updated_at": row.get("sku_updated_at") or previous_item.get("updatedAt") or now_iso(),
            })
        sku_rows.sort(
            key=lambda row: (
                -max(
                    int(row.get("current_stock") or 0) + int((standard_inventory_rows.get(str(row.get("sku_key") or "").strip(), {}) or {}).get("physicalHoldStock") or 0),
                    int((standard_inventory_rows.get(str(row.get("sku_key") or "").strip(), {}) or {}).get("sellableStock") or 0),
                ),
                str(row.get("product_updated_at") or ""),
                str(row.get("sku_key") or ""),
            )
        )
    items: list[dict[str, Any]] = []
    now_text = now_iso()
    for row in sku_rows:
        sku_key = str(row.get("sku_key") or "").strip()
        if not sku_key:
            continue
        retail = retail_zone_items.get(sku_key, {})
        inventory_snapshot_row = standard_inventory_rows.get(sku_key, {})
        standard = standard_price_rows.get(sku_key, {})
        marketing = marketing_map.get(sku_key, {
            "marketingPoAmount": 0.0,
            "educationDiscountAmount": 0.0,
            "marketingPoActivity": None,
            "educationActivity": None,
            "activityLabels": [],
        })
        previous_item = previous_projection_items.get(sku_key, {})
        previous_pricing = previous_item.get("pricing", {}) if isinstance(previous_item.get("pricing"), dict) else {}
        price_adjustments = price_adjustment_map.get(sku_key, {})
        inventory_snapshot_price = inventory_snapshot_price_map.get(sku_key, {})
        store_promotion = manual_map.get(sku_key)
        raw_serial_list = serial_map.get(sku_key, [])
        inventory_snapshot_current_stock = int(inventory_snapshot_row.get("currentStock") or 0)
        inventory_snapshot_sellable_stock = int(inventory_snapshot_row.get("sellableStock") or 0)
        inventory_snapshot_serial_count = int(inventory_snapshot_row.get("serialCount") or 0)
        inventory_snapshot_hold_stock = int(inventory_snapshot_row.get("physicalHoldStock") or 0)
        retail_current_stock = int(retail.get("currentStock") or 0)
        retail_sellable_stock = int(retail.get("sellableStock") or 0)
        retail_serial_count = int(retail.get("serialCount") or 0)
        store_current_stock = max(int(row.get("current_stock") or 0), retail_current_stock, inventory_snapshot_current_stock)
        store_sellable_stock = max(int(row.get("sellable_stock") or 0), retail_sellable_stock, inventory_snapshot_sellable_stock, store_current_stock if store_current_stock > 0 else 0)
        physical_hold_stock = max(int(retail.get("physicalHoldStock") or 0), inventory_snapshot_hold_stock)
        total_stock = max(store_current_stock + physical_hold_stock, 0)
        display_sellable_stock = max(store_sellable_stock + physical_hold_stock, total_stock)
        visible_serial_limit = total_stock
        serial_list = raw_serial_list[:visible_serial_limit] if visible_serial_limit else []
        raw_serial_count = len(raw_serial_list)
        visible_serial_count = max(len(serial_list), retail_serial_count, inventory_snapshot_serial_count)
        display_title = _select_customer_display_title(
            sku_key=sku_key,
            row=row,
            retail=retail,
            standard=standard,
            previous_item=previous_item,
        )
        spec = str(
            row.get("configuration_summary")
            or standard.get("spec")
            or retail.get("productSubtitle")
            or retail.get("spec")
            or ""
        ).strip()
        # Append spec to displayTitle if not already included (main title rule)
        if spec and spec not in display_title:
            display_title = f"{display_title} · {spec}"
        normalized_category = retail_core.normalize_product_category_fields(
            row.get("default_category") or row.get("sku_category"),
            row.get("source_category"),
            row.get("jd_subcategory"),
            display_title,
            spec,
            row.get("pn_mtm"),
            row.get("catalog_source"),
        )
        category = normalized_category["category"]
        display_title = _enrich_title_with_serial_spec(display_title, category, raw_serial_list)
        marketing_po_amount = _safe_float(marketing.get("marketingPoAmount"))
        education_discount_amount = _safe_float(marketing.get("educationDiscountAmount"))
        education_activity_for_pricing = marketing.get("educationActivity")
        if not isinstance(education_activity_for_pricing, dict):
            education_activity_for_pricing = previous_item.get("educationActivity")
        if not isinstance(education_activity_for_pricing, dict):
            previous_channel_views = previous_item.get("channelViews") if isinstance(previous_item.get("channelViews"), dict) else {}
            previous_cashier_view = previous_channel_views.get("cashier") if isinstance(previous_channel_views.get("cashier"), dict) else {}
            education_activity_for_pricing = previous_cashier_view.get("educationActivity")
        if not isinstance(education_activity_for_pricing, dict):
            education_activity_for_pricing = None
        policy_store_retail_price, store_price_policy = _calculate_store_retail_price_by_policy(
            standard=standard,
            retail=retail,
            category=category,
            source_category=normalized_category["sourceCategory"],
            jd_subcategory=normalized_category["jdSubcategory"],
            title=display_title,
            spec=spec,
            pn_mtm=str(row.get("pn_mtm") or retail.get("pnMtm") or standard.get("pnMtm") or ""),
            education_discount_amount=education_discount_amount,
            education_activity=education_activity_for_pricing,
        )
        manual_store_retail_price = _pick_first_price(price_adjustments.get("storeRetailPrice"))
        fallback_store_retail_price = _pick_first_price(
            retail.get("recommendedPreSubsidyPrice"),
            standard.get("storeRetailPrice"),
            retail.get("lenovoOfficialPrice"),
            retail.get("jdPrice"),
            inventory_snapshot_price.get("agentPrice"),
            inventory_snapshot_price.get("salesCostPrice"),
        )
        store_retail_price = _pick_first_price(
            manual_store_retail_price,
            policy_store_retail_price,
            fallback_store_retail_price,
        )
        store_price_source = "manual_store_retail_price" if manual_store_retail_price is not None else (
            "locked_store_price_policy" if policy_store_retail_price is not None else "fallback_no_platform_policy"
        )
        national_subsidy_price = _standard_subsidy_price_from_pre_subsidy(
            store_retail_price,
            category,
            normalized_category["sourceCategory"],
            normalized_category["jdSubcategory"],
            display_title,
            spec,
        )
        if price_adjustments.get("defensivePostSubsidyPrice") is not None:
            national_subsidy_price = price_adjustments.get("defensivePostSubsidyPrice")
        store_manual_amount = _store_manual_promotion_amount(store_promotion, national_subsidy_price)
        pre_subsidy_after_store_manual = _store_manual_promotion_pre_subsidy_price(store_promotion, store_retail_price)
        calculated_adjusted_pre_subsidy_price = None
        if pre_subsidy_after_store_manual is not None:
            calculated_adjusted_pre_subsidy_price = round(
                max(pre_subsidy_after_store_manual - marketing_po_amount - education_discount_amount, 0),
                2,
            )
        active_price_activity = bool(
            marketing_po_amount > 0
            or education_discount_amount > 0
            or store_manual_amount > 0
            or store_promotion
        )
        manual_adjusted_pre_subsidy_price = _pick_first_price(
            price_adjustments.get("retailPreSubsidyPrice"),
        )
        snapshot_adjusted_pre_subsidy_price = _pick_first_price(
            standard.get("adjustedPreSubsidyPrice"),
            retail.get("adjustedPreSubsidyPrice"),
        )
        if manual_adjusted_pre_subsidy_price is not None:
            adjusted_pre_subsidy_price = manual_adjusted_pre_subsidy_price
        elif active_price_activity and calculated_adjusted_pre_subsidy_price is not None:
            if (
                snapshot_adjusted_pre_subsidy_price is not None
                and abs(snapshot_adjusted_pre_subsidy_price - calculated_adjusted_pre_subsidy_price) < 0.01
            ):
                adjusted_pre_subsidy_price = snapshot_adjusted_pre_subsidy_price
            else:
                adjusted_pre_subsidy_price = calculated_adjusted_pre_subsidy_price
        elif snapshot_adjusted_pre_subsidy_price is not None:
            adjusted_pre_subsidy_price = snapshot_adjusted_pre_subsidy_price
        elif active_price_activity and calculated_adjusted_pre_subsidy_price is not None:
            adjusted_pre_subsidy_price = calculated_adjusted_pre_subsidy_price
        else:
            adjusted_pre_subsidy_price = _pick_first_price(
                calculated_adjusted_pre_subsidy_price,
                previous_pricing.get("adjustedPreSubsidyPrice"),
            )
        calculated_final_price = _standard_subsidy_price_from_pre_subsidy(
            adjusted_pre_subsidy_price,
            category,
            normalized_category["sourceCategory"],
            normalized_category["jdSubcategory"],
            display_title,
            spec,
        )
        if calculated_final_price is None and adjusted_pre_subsidy_price is not None:
            calculated_final_price = adjusted_pre_subsidy_price
        final_price = calculated_final_price if calculated_final_price is not None else _pick_first_price(
            standard.get("finalPrice"),
            retail.get("finalDisplayPrice"),
            previous_pricing.get("finalPrice"),
        )
        if final_price is None:
            if national_subsidy_price is not None:
                final_price = round(
                    max((national_subsidy_price or 0) - marketing_po_amount - education_discount_amount - store_manual_amount, 0),
                    2,
                )
            elif adjusted_pre_subsidy_price is not None:
                final_price = round(max((adjusted_pre_subsidy_price or 0) - store_manual_amount, 0), 2)
            elif store_retail_price is not None:
                final_price = round(max((store_retail_price or 0) - marketing_po_amount - education_discount_amount - store_manual_amount, 0), 2)
        effective_to_candidates = [
            str((marketing.get("marketingPoActivity") or {}).get("validTo") or ""),
            str((marketing.get("educationActivity") or {}).get("validTo") or ""),
            str((store_promotion or {}).get("validTo") or ""),
        ]
        effective_to_candidates = [value for value in effective_to_candidates if value]
        effective_from_candidates = [
            str((marketing.get("marketingPoActivity") or {}).get("validFrom") or ""),
            str((marketing.get("educationActivity") or {}).get("validFrom") or ""),
            str((store_promotion or {}).get("validFrom") or ""),
        ]
        effective_from_candidates = [value for value in effective_from_candidates if value]
        effective_from = min(effective_from_candidates) if effective_from_candidates else ""
        effective_to = max(effective_to_candidates) if effective_to_candidates else ""
        countdown_days = _days_remaining(effective_to) if effective_to else None
        activity_labels = [
            str(label).strip()
            for label in (marketing.get("activityLabels") or [])
            if str(label).strip()
        ]
        if store_promotion and store_manual_amount > 0:
            store_label = "店面活动"
            if store_label not in activity_labels:
                activity_labels.append(store_label)
        published_subsidy_price = final_price
        version_basis = [
            sku_key,
            display_title,
            str(row.get("pn_mtm") or ""),
            spec,
            str(store_retail_price or ""),
            str(published_subsidy_price or ""),
            str(final_price or ""),
            str(marketing_po_amount),
            str(education_discount_amount),
            str(store_manual_amount),
            str(total_stock),
            str(display_sellable_stock),
            str(visible_serial_count),
            str(raw_serial_count),
            str(physical_hold_stock),
            str(row.get("product_updated_at") or ""),
            str(row.get("sku_updated_at") or ""),
            str((marketing.get("marketingPoActivity") or {}).get("id") or ""),
            str((marketing.get("educationActivity") or {}).get("id") or ""),
            str((store_promotion or {}).get("id") or ""),
            str((store_promotion or {}).get("updatedAt") or ""),
        ]
        version_hash = stable_id(*version_basis)
        items.append({
            "productId": str(row.get("product_id") or ""),
            "skuKey": sku_key,
            "displayTitle": display_title,
            "productName": display_title,
            "pnMtm": str(row.get("pn_mtm") or retail.get("pnMtm") or standard.get("pnMtm") or ""),
            "spec": spec,
            "category": category,
            "sourceCategory": normalized_category["sourceCategory"],
            "jdSubcategory": normalized_category["jdSubcategory"],
            "catalogSource": normalized_category["catalogSource"],
            "currentStock": total_stock,
            "sellableStock": display_sellable_stock,
            "storeCurrentStock": store_current_stock,
            "storeSellableStock": store_sellable_stock,
            "totalStock": total_stock,
            "serialCount": visible_serial_count,
            "physicalHoldStock": physical_hold_stock,
            "availableSerialCount": visible_serial_count,
            "rawSerialCount": raw_serial_count,
            "stockSyncStatus": "matched" if raw_serial_count == total_stock else "serial_raw_mismatch",
            "stockSyncAudit": {
                "sqlCurrentStock": store_current_stock,
                "sqlSellableStock": store_sellable_stock,
                "displayCurrentStock": total_stock,
                "displaySellableStock": display_sellable_stock,
                "physicalHoldStock": physical_hold_stock,
                "visibleSerialCount": visible_serial_count,
                "rawInStockSerialCount": raw_serial_count,
                "cappedBySqlStock": raw_serial_count > visible_serial_count,
            },
            "serialPreview": [
                {
                    "serialNumber": str(item.get("serial_number") or ""),
                    "spec": str(item.get("spec") or ""),
                    "updatedAt": str(item.get("updated_at") or ""),
                }
                for item in serial_list[:6]
            ],
            "riskLevel": str(retail.get("riskLevel") or ""),
            "salesNote": str(retail.get("salesNote") or ""),
            "riskNote": str(retail.get("riskNote") or ""),
            "pricing": {
                "storeRetailPrice": store_retail_price,
                "adjustedPreSubsidyPrice": adjusted_pre_subsidy_price,
                "nationalSubsidyPrice": published_subsidy_price,
                "finalPrice": final_price,
                "marketingPoAmount": round(marketing_po_amount, 2),
                "educationDiscountAmount": round(education_discount_amount, 2),
                "storeManualPromotionAmount": round(store_manual_amount, 2),
                "baseNationalSubsidyPrice": national_subsidy_price,
                "storePriceSource": store_price_source,
                "storePricePolicy": store_price_policy,
                "effectiveFrom": effective_from,
                "effectiveTo": effective_to,
                "countdownDays": countdown_days,
                "priceVersion": version_hash,
            },
            "marketingPoActivity": marketing.get("marketingPoActivity"),
            "educationActivity": marketing.get("educationActivity"),
            "storeManualPromotion": store_promotion,
            "activityLabels": activity_labels,
            "channelViews": {
                "retailHero": {
                    "displayTitle": display_title,
                    "currentStock": total_stock,
                    "sellableStock": display_sellable_stock,
                    "storeCurrentStock": store_current_stock,
                    "storeSellableStock": store_sellable_stock,
                    "totalStock": total_stock,
                    "serialCount": visible_serial_count,
                    "physicalHoldStock": physical_hold_stock,
                    "availableSerialCount": visible_serial_count,
                    "stockSyncStatus": "matched" if raw_serial_count == total_stock else "serial_raw_mismatch",
                    "storeRetailPrice": store_retail_price,
                    "adjustedPreSubsidyPrice": adjusted_pre_subsidy_price,
                    "nationalSubsidyPrice": published_subsidy_price,
                    "finalPrice": final_price,
                    "marketingPoAmount": round(marketing_po_amount, 2),
                    "educationDiscountAmount": round(education_discount_amount, 2),
                    "storeManualPromotionAmount": round(store_manual_amount, 2),
                    "baseNationalSubsidyPrice": national_subsidy_price,
                    "storePriceSource": store_price_source,
                    "storePricePolicy": store_price_policy,
                    "marketingPoActivity": marketing.get("marketingPoActivity"),
                    "educationActivity": marketing.get("educationActivity"),
                    "storeManualPromotion": store_promotion,
                    "activityLabels": activity_labels,
                    "priceVersion": version_hash,
                },
                "cashier": {
                    "displayTitle": display_title,
                    "currentStock": total_stock,
                    "sellableStock": display_sellable_stock,
                    "storeCurrentStock": store_current_stock,
                    "storeSellableStock": store_sellable_stock,
                    "totalStock": total_stock,
                    "serialCount": visible_serial_count,
                    "physicalHoldStock": physical_hold_stock,
                    "availableSerialCount": visible_serial_count,
                    "stockSyncStatus": "matched" if raw_serial_count == total_stock else "serial_raw_mismatch",
                    "storeRetailPrice": store_retail_price,
                    "adjustedPreSubsidyPrice": adjusted_pre_subsidy_price,
                    "nationalSubsidyPrice": published_subsidy_price,
                    "finalPrice": final_price,
                    "marketingPoAmount": round(marketing_po_amount, 2),
                    "educationDiscountAmount": round(education_discount_amount, 2),
                    "storeManualPromotionAmount": round(store_manual_amount, 2),
                    "baseNationalSubsidyPrice": national_subsidy_price,
                    "storePriceSource": store_price_source,
                    "storePricePolicy": store_price_policy,
                    "marketingPoActivity": marketing.get("marketingPoActivity"),
                    "educationActivity": marketing.get("educationActivity"),
                    "storeManualPromotion": store_promotion,
                    "activityLabels": activity_labels,
                    "priceVersion": version_hash,
                },
                "adMachine": {
                    "displayTitle": display_title,
                    "currentStock": total_stock,
                    "sellableStock": display_sellable_stock,
                    "storeCurrentStock": store_current_stock,
                    "storeSellableStock": store_sellable_stock,
                    "totalStock": total_stock,
                    "serialCount": visible_serial_count,
                    "physicalHoldStock": physical_hold_stock,
                    "availableSerialCount": visible_serial_count,
                    "stockSyncStatus": "matched" if raw_serial_count == total_stock else "serial_raw_mismatch",
                    "storeRetailPrice": store_retail_price,
                    "adjustedPreSubsidyPrice": adjusted_pre_subsidy_price,
                    "nationalSubsidyPrice": published_subsidy_price,
                    "finalPrice": final_price,
                    "marketingPoAmount": round(marketing_po_amount, 2),
                    "educationDiscountAmount": round(education_discount_amount, 2),
                    "storeManualPromotionAmount": round(store_manual_amount, 2),
                    "baseNationalSubsidyPrice": national_subsidy_price,
                    "storePriceSource": store_price_source,
                    "storePricePolicy": store_price_policy,
                    "marketingPoActivity": marketing.get("marketingPoActivity"),
                    "educationActivity": marketing.get("educationActivity"),
                    "storeManualPromotion": store_promotion,
                    "activityLabels": activity_labels,
                    "priceVersion": version_hash,
                },
            },
            "sourceSnapshots": [
                "product_price_adjustment",
                "latest-published-product-projection.json",
                "latest-standard-price-master.json",
                "latest-marketing-boost-snapshot.json",
                "store_manual_promotion",
                "serial_item",
            ],
            "updatedAt": now_text,
        })
    return {
        "generatedAt": now_text,
        "source": "sql_published_projection",
        "version": stable_id(now_text, str(len(items))),
        "summary": {
            "itemCount": len(items),
            "pricedCount": sum(1 for item in items if item["pricing"]["storeRetailPrice"]),
            "subsidyCount": sum(1 for item in items if item["pricing"]["nationalSubsidyPrice"]),
            "finalPriceCount": sum(1 for item in items if item["pricing"]["finalPrice"]),
            "marketingActivityCount": sum(1 for item in items if item["pricing"]["marketingPoAmount"] or item["pricing"]["educationDiscountAmount"]),
            "storePromotionCount": sum(1 for item in items if item["pricing"]["storeManualPromotionAmount"]),
        },
        "items": items,
    }


def build_published_product_channel_audit(data_dir: Path) -> dict[str, Any]:
    projection = build_published_product_projection(data_dir)
    return build_published_product_channel_audit_from_projection(projection)


def build_published_product_channel_audit_from_projection(projection: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    mismatch_count = 0
    for item in projection.get("items", []):
        if not isinstance(item, dict):
            continue
        retail = item.get("channelViews", {}).get("retailHero", {})
        cashier = item.get("channelViews", {}).get("cashier", {})
        ad_machine = item.get("channelViews", {}).get("adMachine", {})
        fields = (
            "displayTitle",
            "currentStock",
            "sellableStock",
            "serialCount",
            "physicalHoldStock",
            "storeRetailPrice",
            "nationalSubsidyPrice",
            "finalPrice",
        )
        mismatches = [
            field for field in fields
            if retail.get(field) != cashier.get(field) or retail.get(field) != ad_machine.get(field)
        ]
        if mismatches:
            mismatch_count += 1
        rows.append({
            "skuKey": item.get("skuKey"),
            "displayTitle": item.get("displayTitle"),
            "priceVersion": item.get("pricing", {}).get("priceVersion"),
            "serialCount": item.get("serialCount"),
            "mismatchFields": mismatches,
            "retailHero": retail,
            "cashier": cashier,
            "adMachine": ad_machine,
        })
    return {
        "generatedAt": now_iso(),
        "source": "published_product_projection",
        "summary": {
            "itemCount": len(rows),
            "mismatchCount": mismatch_count,
            "alignedCount": len(rows) - mismatch_count,
        },
        "items": rows,
    }


def build_live_published_product_projection(projection: dict[str, Any]) -> dict[str, Any]:
    live_items = [
        item for item in projection.get("items", [])
        if isinstance(item, dict)
        and (
            int(item.get("currentStock") or 0) > 0
            or int(item.get("sellableStock") or 0) > 0
            or int(item.get("serialCount") or 0) > 0
        )
    ]
    summary = dict(projection.get("summary") or {})
    summary.update({
        "itemCount": len(live_items),
        "pricedCount": sum(1 for item in live_items if item.get("pricing", {}).get("storeRetailPrice")),
        "subsidyCount": sum(1 for item in live_items if item.get("pricing", {}).get("nationalSubsidyPrice")),
        "finalPriceCount": sum(1 for item in live_items if item.get("pricing", {}).get("finalPrice")),
        "marketingActivityCount": sum(
            1 for item in live_items
            if item.get("pricing", {}).get("marketingPoAmount") or item.get("pricing", {}).get("educationDiscountAmount")
        ),
        "storePromotionCount": sum(1 for item in live_items if item.get("pricing", {}).get("storeManualPromotionAmount")),
        "scope": "live",
        "sourceItemCount": len(projection.get("items", [])),
    })
    return {
        **projection,
        "source": f"{projection.get('source') or 'sql_published_projection'}:live",
        "summary": summary,
        "itemCount": len(live_items),
        "items": live_items,
    }


def _sync_retail_zone_prices_from_projection(data_dir: Path, projection: dict[str, Any]) -> dict[str, str]:
    projection_items = {
        str(item.get("skuKey") or ""): item
        for item in projection.get("items", [])
        if isinstance(item, dict) and item.get("skuKey")
    }
    if not projection_items:
        return {}
    artifact_dir = data_dir.parents[2] / "inventory-sync" / "artifacts"
    touched: dict[str, str] = {}
    for path in (data_dir / "latest-retail-zone-snapshot.json", artifact_dir / "latest-retail-zone-snapshot.json"):
        payload = _load_json(path, {})
        decisions = payload.get("decisions", {})
        items = decisions.get("items", []) if isinstance(decisions, dict) else []
        if not isinstance(items, list):
            continue
        changed = False
        for item in items:
            if not isinstance(item, dict):
                continue
            projection_item = projection_items.get(str(item.get("skuKey") or ""))
            if not projection_item:
                continue
            pricing = projection_item.get("pricing") if isinstance(projection_item.get("pricing"), dict) else {}
            channel_views = projection_item.get("channelViews") if isinstance(projection_item.get("channelViews"), dict) else {}
            cashier_pricing = channel_views.get("cashier") if isinstance(channel_views.get("cashier"), dict) else {}
            channel_pricing = {**pricing, **cashier_pricing}
            store_price = pricing.get("storeRetailPrice")
            adjusted_pre_subsidy_price = channel_pricing.get("adjustedPreSubsidyPrice")
            final_price = pricing.get("finalPrice")
            if isinstance(store_price, (int, float)) and store_price > 0:
                item["recommendedPreSubsidyPrice"] = store_price
                item["floorPreSubsidyPrice"] = store_price
                changed = True
            if isinstance(adjusted_pre_subsidy_price, (int, float)) and adjusted_pre_subsidy_price > 0:
                item["adjustedPreSubsidyPrice"] = adjusted_pre_subsidy_price
                changed = True
            if isinstance(final_price, (int, float)) and final_price > 0:
                item["fullServiceSubsidyPrice"] = final_price
                item["regularChannelSubsidyPrice"] = final_price
                changed = True
            for source_key, target_key in (
                ("jdPrice", "jdPrice"),
                ("lenovoOfficialPrice", "lenovoOfficialPrice"),
                ("taobaoPrice", "taobaoPrice"),
                ("marketingPoAmount", "marketingPoAmount"),
                ("educationDiscountAmount", "educationDiscountAmount"),
                ("storeManualPromotionAmount", "storeManualPromotionAmount"),
                ("storePriceSource", "storePriceSource"),
                ("storePricePolicy", "storePricePolicy"),
                ("marketingPoActivity", "marketingPoActivity"),
                ("educationActivity", "educationActivity"),
                ("storeManualPromotion", "storeManualPromotion"),
                ("activityLabels", "activityLabels"),
                ("priceVersion", "priceVersion"),
            ):
                value = channel_pricing.get(source_key)
                if value not in (None, ""):
                    item[target_key] = value
                    changed = True
            for source_key, target_key in (
                ("displayTitle", "productName"),
                ("pnMtm", "pnMtm"),
                ("category", "category"),
                ("displayCategory", "displayCategory"),
                ("posCategory", "posCategory"),
                ("sourceCategory", "sourceCategory"),
            ):
                value = projection_item.get(source_key)
                if value not in (None, ""):
                    item[target_key] = value
                    changed = True
            item["priceOverlaySource"] = "latest-published-product-projection.json"
            item["priceOverlayUpdatedAt"] = projection.get("generatedAt") or now_iso()
            changed = True
        if changed:
            payload["generatedAt"] = now_iso()
            _save_json(path, payload)
            touched[f"latest-retail-zone-snapshot.json:{'web' if 'web-cockpit' in str(path) else 'artifact'}"] = str(path)
    if touched:
        retail_core.sync_snapshot_cache(data_dir, ["latest-retail-zone-snapshot.json"])
    return touched


def _sync_standard_price_titles_from_projection(data_dir: Path, projection: dict[str, Any]) -> dict[str, str]:
    projection_items = {
        str(item.get("skuKey") or ""): item
        for item in projection.get("items", [])
        if isinstance(item, dict) and item.get("skuKey") and int(item.get("currentStock") or 0) > 0
    }
    if not projection_items:
        return {}
    artifact_dir = data_dir.parents[2] / "inventory-sync" / "artifacts"
    touched: dict[str, str] = {}
    for file_name in ("latest-standard-price-master.json", "latest-standard-price-master-frontend-snapshot.json"):
        for path in (data_dir / file_name, artifact_dir / file_name):
            payload = _load_json(path, {})
            rows = payload.get("rows", [])
            if not isinstance(rows, list):
                continue
            changed = False
            for row in rows:
                if not isinstance(row, dict):
                    continue
                projection_item = projection_items.get(str(row.get("skuKey") or ""))
                if not projection_item:
                    continue
                display_title = _clean_title(projection_item.get("displayTitle") or projection_item.get("productName"))
                if not display_title:
                    continue
                existing_title = _clean_title(row.get("productName"))
                if existing_title and existing_title != display_title and not row.get("sourceProductName"):
                    row["sourceProductName"] = existing_title
                row["productName"] = display_title
                row["displayTitle"] = display_title
                row["titleOverlaySource"] = "latest-published-product-projection.json"
                row["titleOverlayUpdatedAt"] = projection.get("generatedAt") or now_iso()
                changed = True
            if changed:
                payload["generatedAt"] = now_iso()
                _save_json(path, payload)
                touched[f"{file_name}:{'web' if 'web-cockpit' in str(path) else 'artifact'}"] = str(path)
    if touched:
        retail_core.sync_snapshot_cache(data_dir, ["latest-standard-price-master.json", "latest-standard-price-master-frontend-snapshot.json"])
    return touched


def write_published_product_projection_snapshots(data_dir: Path) -> dict[str, str]:
    projection = build_published_product_projection(data_dir)
    live_projection = build_live_published_product_projection(projection)
    audit = build_published_product_channel_audit_from_projection(projection)
    payloads = {
        "latest-published-product-projection.json": projection,
        "latest-published-product-projection-live.json": live_projection,
        "latest-published-product-channel-audit.json": audit,
    }
    artifact_dir = data_dir.parents[2] / "inventory-sync" / "artifacts"
    api_data_dir = APP_DIR / "data"
    written: dict[str, str] = {}
    for file_name, payload in payloads.items():
        for path in (data_dir / file_name, artifact_dir / file_name, api_data_dir / file_name):
            _save_json(path, payload)
            location = "web" if "web-cockpit" in str(path) else "artifact" if "inventory-sync" in str(path) else "api"
            written[f"{file_name}:{location}"] = str(path)
    retail_core.sync_snapshot_cache(data_dir, list(payloads.keys()))
    written.update(_sync_retail_zone_prices_from_projection(data_dir, projection))
    written.update(_sync_standard_price_titles_from_projection(data_dir, projection))
    return written


def _load_snapshot_cache_payload(conn, snapshot_name: str) -> Any:
    row = conn.execute(
        """
        SELECT payload_json
        FROM snapshot_cache
        WHERE snapshot_name = ?
        """,
        (snapshot_name,),
    ).fetchone()
    if not row:
        return None
    try:
        return json.loads(str(row["payload_json"] or "null"))
    except json.JSONDecodeError:
        return None


def _collection_snapshot_paths(data_dir: Path) -> dict[str, Path]:
    artifact_dir = data_dir.parents[2] / "inventory-sync" / "artifacts"
    return {
        "webLocks": data_dir / "latest-product-url-locks.json",
        "artifactLocks": artifact_dir / "latest-product-url-locks.json",
        "webMarketplace": data_dir / "latest-marketplace-price-snapshot.json",
        "artifactMarketplace": artifact_dir / "latest-marketplace-price-snapshot.json",
    }


def _pick_best_collection_url(locks: list[dict[str, Any]], records: list[dict[str, Any]], source: str) -> str:
    for lock in locks:
        if str(lock.get("source") or "") == source and str(lock.get("url") or "").strip():
            return str(lock.get("url")).strip()
    for record in records:
        if str(record.get("source") or "") != source:
            continue
        for key in ("configuredUrl",):
            value = str(record.get(key) or "").strip()
            if value:
                return value
        evidence = record.get("evidence") if isinstance(record.get("evidence"), dict) else {}
        value = str(evidence.get("evidenceUrl") or "").strip()
        if value:
            return value
    return ""


def _build_collection_override_from_snapshots(sku_key: str, data_dir: Path) -> dict[str, Any]:
    locks_snapshot = _load_json(data_dir / "latest-product-url-locks.json", {"locks": []})
    marketplace_snapshot = _load_json(data_dir / "latest-marketplace-price-snapshot.json", {"records": []})
    locks = [
        item for item in locks_snapshot.get("locks", [])
        if isinstance(item, dict) and str(item.get("skuKey") or "").strip() == sku_key
    ]
    records = [
        item for item in marketplace_snapshot.get("records", [])
        if isinstance(item, dict) and str(item.get("productId") or "").strip() == sku_key
    ]
    jd_url = _pick_best_collection_url(locks, records, "jd_self") or _pick_best_collection_url([], records, "jd")
    lenovo_url = _pick_best_collection_url(locks, records, "lenovo_official")
    tmall_url = _pick_best_collection_url([], records, "taobao_subsidy")
    capture_notes: list[str] = []
    for lock in locks[:3]:
        note = str(lock.get("evidenceNote") or "").strip()
        if note:
            capture_notes.append(note)
    for record in records[:3]:
        evidence = record.get("evidence") if isinstance(record.get("evidence"), dict) else {}
        note = str(evidence.get("note") or "").strip()
        if note:
            capture_notes.append(note)
    return {
        "sku_key": sku_key,
        "jd_url": jd_url,
        "lenovo_url": lenovo_url,
        "tmall_url": tmall_url,
        "distributor_quote_note": "",
        "gray_quote_note": "",
        "capture_note": "；".join(dict.fromkeys(capture_notes))[:1000],
        "updated_by": "snapshot_seed",
        "updated_at": str(locks_snapshot.get("generatedAt") or marketplace_snapshot.get("generatedAt") or ""),
    }


def _merge_collection_override_with_snapshot(existing_row: dict[str, Any], sku_key: str, data_dir: Path) -> dict[str, Any]:
    fallback = _build_collection_override_from_snapshots(sku_key, data_dir)
    return {
        **fallback,
        **{key: value for key, value in existing_row.items() if value not in (None, "")},
    }


def _upsert_lock_record(
    locks: list[dict[str, Any]],
    *,
    sku_key: str,
    product_name: str,
    pn_mtm: str,
    category: str,
    source: str,
    url: str,
    timestamp: str,
    note: str,
) -> None:
    if not url:
        return
    for item in locks:
        if str(item.get("skuKey") or "") == sku_key and str(item.get("source") or "") == source:
            item["url"] = url
            item["capturedAt"] = timestamp
            item["confidence"] = "manual_review_required"
            item["matchStatus"] = "locked"
            item["evidenceNote"] = note
            if pn_mtm:
                item["pnMtm"] = pn_mtm
            if product_name:
                item["productName"] = product_name
            if category:
                item["category"] = category
            return
    locks.append({
        "skuKey": sku_key,
        "pnMtm": pn_mtm,
        "productName": product_name,
        "category": category,
        "source": source,
        "url": url,
        "platformSkuId": "",
        "matchTitle": product_name,
        "matchStatus": "locked",
        "confidence": "manual_review_required",
        "priority": 9,
        "capturedAt": timestamp,
        "evidenceNote": note,
        "raw": {
            "discoveryMethod": "manual_product_library_override",
            "pnMtm": pn_mtm,
        },
    })


def _upsert_marketplace_record(
    records: list[dict[str, Any]],
    *,
    sku_key: str,
    product_name: str,
    source: str,
    url: str,
    note: str,
) -> None:
    if not url:
        return
    source_label_map = {
        "jd": "京东",
        "lenovo_official": "联想官网",
        "taobao_subsidy": "天猫/淘宝",
    }
    price_basis_map = {
        "jd": "京东自营/平台展示价格；人工维护链接后等待真实价格复核",
        "lenovo_official": "联想官网公开展示价格；人工维护链接后等待真实价格复核",
        "taobao_subsidy": "天猫/淘宝备用价格入口；人工维护链接后等待真实价格复核",
    }
    for item in records:
        if str(item.get("productId") or "") == sku_key and str(item.get("source") or "") == source:
            item["configuredUrl"] = url
            item["query"] = product_name
            item["collectionStatus"] = "url_configured_only"
            item["confidence"] = "url_configured_only"
            item["priceType"] = "url_configured_only"
            item["priceBasis"] = price_basis_map[source]
            item["evidence"] = {
                "evidenceUrl": url,
                "capturedBy": "manual_product_library_override",
                "note": note,
            }
            return
    records.append({
        "source": source,
        "sourceLabel": source_label_map[source],
        "sourceType": "manual_collection_override",
        "productId": sku_key,
        "query": product_name,
        "configuredUrl": url,
        "priceType": "url_configured_only",
        "priceBasis": price_basis_map[source],
        "confidence": "url_configured_only",
        "collectionStatus": "url_configured_only",
        "evidence": {
            "evidenceUrl": url,
            "capturedBy": "manual_product_library_override",
            "note": note,
        },
    })


def _write_collection_override_to_frontend(
    data_dir: Path,
    *,
    sku_key: str,
    product_name: str,
    pn_mtm: str,
    category: str,
    override_row: dict[str, Any],
    changed_by: str,
    reason: str,
) -> dict[str, str]:
    timestamp = now_iso()
    paths = _collection_snapshot_paths(data_dir)
    locks_payload = _load_json(paths["webLocks"], {"locks": [], "generatedAt": timestamp, "source": "product_url_lock_store"})
    marketplace_payload = _load_json(paths["webMarketplace"], {"records": [], "generatedAt": timestamp})
    locks = locks_payload.get("locks", [])
    records = marketplace_payload.get("records", [])
    if not isinstance(locks, list):
        locks = []
    if not isinstance(records, list):
        records = []
    note = f"产品库手工采集信息修改：{reason} · {changed_by}"
    _upsert_lock_record(
        locks,
        sku_key=sku_key,
        product_name=product_name,
        pn_mtm=pn_mtm,
        category=category,
        source="jd_self",
        url=str(override_row.get("jd_url") or ""),
        timestamp=timestamp,
        note=note,
    )
    _upsert_lock_record(
        locks,
        sku_key=sku_key,
        product_name=product_name,
        pn_mtm=pn_mtm,
        category=category,
        source="lenovo_official",
        url=str(override_row.get("lenovo_url") or ""),
        timestamp=timestamp,
        note=note,
    )
    _upsert_marketplace_record(
        records,
        sku_key=sku_key,
        product_name=product_name,
        source="jd",
        url=str(override_row.get("jd_url") or ""),
        note=note,
    )
    _upsert_marketplace_record(
        records,
        sku_key=sku_key,
        product_name=product_name,
        source="lenovo_official",
        url=str(override_row.get("lenovo_url") or ""),
        note=note,
    )
    _upsert_marketplace_record(
        records,
        sku_key=sku_key,
        product_name=product_name,
        source="taobao_subsidy",
        url=str(override_row.get("tmall_url") or ""),
        note=note,
    )
    locks_payload["locks"] = locks
    locks_payload["generatedAt"] = timestamp
    marketplace_payload["records"] = records
    marketplace_payload["generatedAt"] = timestamp
    _save_json(paths["webLocks"], locks_payload)
    _save_json(paths["artifactLocks"], locks_payload)
    _save_json(paths["webMarketplace"], marketplace_payload)
    _save_json(paths["artifactMarketplace"], marketplace_payload)
    return {key: str(value) for key, value in paths.items()}


def _iter_snapshot_paths(data_dir: Path, file_name: str) -> list[Path]:
    artifact_dir = data_dir.parents[2] / "inventory-sync" / "artifacts"
    return [
        data_dir / file_name,
        artifact_dir / file_name,
    ]


def _update_inventory_snapshot_file(
    path: Path,
    *,
    sku_key: str,
    updates: dict[str, Any],
) -> bool:
    payload = _load_json(path, {})
    skus = payload.get("skus", [])
    if not isinstance(skus, list):
        return False
    touched = False
    for sku in skus:
        if not isinstance(sku, dict) or str(sku.get("skuKey") or "") != sku_key:
            continue
        for key, value in updates.items():
            if value is None or value == "":
                continue
            sku[key] = value
        serials = sku.get("serials", [])
        if isinstance(serials, list):
            for serial in serials:
                if not isinstance(serial, dict):
                    continue
                if "productName" in updates and updates["productName"]:
                    serial["productName"] = updates["productName"]
                if "pnMtm" in updates and updates["pnMtm"]:
                    serial["pnMtm"] = updates["pnMtm"]
                if "spec" in updates and updates["spec"]:
                    serial["spec"] = updates["spec"]
        touched = True
    if touched:
        payload["generatedAt"] = now_iso()
        _save_json(path, payload)
    return touched


def _update_inventory_master_snapshot_file(
    path: Path,
    *,
    sku_key: str,
    updates: dict[str, Any],
) -> bool:
    payload = _load_json(path, {})
    rows = payload.get("rows", [])
    if not isinstance(rows, list):
        return False
    touched = False
    for row in rows:
        if not isinstance(row, dict) or str(row.get("skuKey") or "") != sku_key:
            continue
        for key, value in updates.items():
            if value is None or value == "":
                continue
            row[key] = value
        touched = True
    if touched:
        payload["generatedAt"] = now_iso()
        _save_json(path, payload)
    return touched


def _update_retail_zone_snapshot_file(
    path: Path,
    *,
    sku_key: str,
    updates: dict[str, Any],
) -> bool:
    payload = _load_json(path, {})
    decisions = payload.get("decisions", {})
    items = decisions.get("items", []) if isinstance(decisions, dict) else []
    if not isinstance(items, list):
        return False
    touched = False
    for item in items:
        if not isinstance(item, dict) or str(item.get("skuKey") or "") != sku_key:
            continue
        for source_key, target_key in (
            ("productName", "productName"),
            ("pnMtm", "pnMtm"),
            ("spec", "spec"),
            ("category", "category"),
        ):
            value = updates.get(source_key)
            if value not in (None, ""):
                item[target_key] = value
        touched = True
    if touched:
        payload["generatedAt"] = now_iso()
        _save_json(path, payload)
    return touched


def _update_standard_price_master_file(
    path: Path,
    *,
    sku_key: str,
    updates: dict[str, Any],
) -> bool:
    payload = _load_json(path, {})
    rows = payload.get("rows", [])
    if not isinstance(rows, list):
        return False
    touched = False
    for row in rows:
        if not isinstance(row, dict) or str(row.get("skuKey") or "") != sku_key:
            continue
        for key in ("productName", "pnMtm", "spec", "category"):
            value = updates.get(key)
            if value not in (None, ""):
                row[key] = value
        touched = True
    if touched:
        payload["generatedAt"] = now_iso()
        _save_json(path, payload)
    return touched


def _write_product_profile_to_frontend(
    data_dir: Path,
    *,
    sku_key: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    touched_files: list[str] = []
    for path in _iter_snapshot_paths(data_dir, "latest-adjusted-inventory-snapshot.json"):
        if _update_inventory_snapshot_file(path, sku_key=sku_key, updates=updates):
            touched_files.append(str(path))
    for path in _iter_snapshot_paths(data_dir, "latest-standard-inventory-snapshot.json"):
        if _update_inventory_snapshot_file(path, sku_key=sku_key, updates=updates):
            touched_files.append(str(path))
    for path in _iter_snapshot_paths(data_dir, "latest-inventory-master-snapshot.json"):
        if _update_inventory_master_snapshot_file(path, sku_key=sku_key, updates=updates):
            touched_files.append(str(path))
    for path in _iter_snapshot_paths(data_dir, "latest-retail-zone-snapshot.json"):
        if _update_retail_zone_snapshot_file(path, sku_key=sku_key, updates=updates):
            touched_files.append(str(path))
    for path in _iter_snapshot_paths(data_dir, "latest-standard-price-master.json"):
        if _update_standard_price_master_file(path, sku_key=sku_key, updates=updates):
            touched_files.append(str(path))
    return {
        "touchedFiles": touched_files,
        "appliedToFrontend": bool(touched_files),
    }


def write_product_library_static_snapshots(data_dir: Path) -> dict[str, str]:
    overview = product_library_overview()
    categories = list_category_summary()
    products = list_products(limit=5000)
    replays = list_sync_replays(limit=1000)
    published_projection = build_published_product_projection(data_dir)
    published_audit = build_published_product_channel_audit_from_projection(published_projection)
    details = {
        "generatedAt": now_iso(),
        "items": [
            detail
            for product in products.get("items", [])
            if isinstance(product, dict)
            for detail in [get_product(str(product.get("id") or ""))]
            if detail
        ],
    }
    artifact_dir = data_dir.parents[2] / "inventory-sync" / "artifacts"
    payloads = {
        "latest-product-library-overview.json": overview,
        "latest-product-library-categories.json": categories,
        "latest-product-library-products.json": products,
        "latest-product-library-details.json": details,
        "latest-product-library-replays.json": replays,
        "latest-published-product-projection.json": published_projection,
        "latest-published-product-channel-audit.json": published_audit,
    }
    written: dict[str, str] = {}
    for file_name, payload in payloads.items():
        for path in (data_dir / file_name, artifact_dir / file_name):
            _save_json(path, payload if isinstance(payload, dict) else {})
            written[f"{file_name}:{'web' if 'web-cockpit' in str(path) else 'artifact'}"] = str(path)
    retail_core.sync_snapshot_cache(data_dir, PRODUCT_LIBRARY_SNAPSHOT_FILES)
    return written


def _upsert_source_link(
    conn,
    *,
    entity_type: str,
    entity_id: str,
    source_system: str,
    source_type: str,
    source_key: str,
    source_value: str,
    snapshot_file: str,
    payload: dict[str, Any],
    timestamp: str,
) -> None:
    link_id = stable_id(entity_type, entity_id, source_system, source_type, source_key)
    conn.execute(
        """
        INSERT INTO product_source_link
        (id, entity_type, entity_id, source_system, source_type, source_key, source_value,
         snapshot_file, payload_json, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_value = excluded.source_value,
          snapshot_file = excluded.snapshot_file,
          payload_json = excluded.payload_json,
          last_seen_at = excluded.last_seen_at
        """,
        (
            link_id,
            entity_type,
            entity_id,
            source_system,
            source_type,
            source_key,
            source_value,
            snapshot_file,
            json.dumps(payload, ensure_ascii=False),
            timestamp,
            timestamp,
        ),
    )


def _upsert_evidence(
    conn,
    *,
    entity_type: str,
    entity_id: str,
    source_system: str,
    evidence_type: str,
    title: str,
    file_path: str,
    note: str,
    payload: dict[str, Any],
    timestamp: str,
) -> None:
    checksum = stable_id(file_path, title, source_system)
    evidence_id = stable_id(entity_type, entity_id, evidence_type, file_path or title)
    conn.execute(
        """
        INSERT INTO product_evidence
        (id, entity_type, entity_id, source_system, evidence_type, title, file_path,
         source_url, captured_at, captured_by, checksum, note, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'system', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          file_path = excluded.file_path,
          captured_at = excluded.captured_at,
          checksum = excluded.checksum,
          note = excluded.note,
          payload_json = excluded.payload_json
        """,
        (
            evidence_id,
            entity_type,
            entity_id,
            source_system,
            evidence_type,
            title,
            file_path,
            timestamp,
            checksum,
            note,
            json.dumps(payload, ensure_ascii=False),
            timestamp,
        ),
    )


def seed_from_snapshots(data_dir: Path) -> dict[str, Any]:
    seed_result = retail_core.seed_reference_data(data_dir)
    init_product_library()
    timestamp = now_iso()
    adjusted = _load_json(data_dir / "latest-adjusted-inventory-snapshot.json", {})
    retail_zone = _load_json(data_dir / "latest-retail-zone-snapshot.json", {})
    standard_price_master = _load_json(data_dir / "latest-standard-price-master.json", {"rows": []})
    previous_product_library_products = _load_json(data_dir / "latest-product-library-products.json", {"items": []})
    serial_overrides = _load_json(data_dir / "latest-serial-overrides.json", {"overrides": {}})
    movements = _load_json(data_dir / "latest-inventory-movements.json", {"records": []})
    manual_overrides = _load_json(data_dir / "latest-manual-price-overrides.json", {"overrides": {}})
    retail_zone_by_sku = {
        str(row.get("skuKey") or ""): row
        for row in retail_zone.get("decisions", {}).get("items", [])
        if isinstance(row, dict) and str(row.get("skuKey") or "").strip()
    }
    standard_price_by_sku = {
        str(row.get("skuKey") or ""): row
        for row in standard_price_master.get("rows", [])
        if isinstance(row, dict) and str(row.get("skuKey") or "").strip()
    }
    previous_product_library_by_sku = {
        str(item.get("primary_sku_key") or ""): item
        for item in previous_product_library_products.get("items", [])
        if isinstance(item, dict) and str(item.get("primary_sku_key") or "").strip()
    }
    product_count = 0
    evidence_count = 0
    source_count = 0

    with connect() as conn:
        for item in adjusted.get("skus", []):
            if not isinstance(item, dict):
                continue
            sku_key = str(item.get("skuKey", "")).strip()
            if not sku_key:
                continue
            normalized_category = retail_core.normalize_product_category_fields(
                item.get("category"),
                item.get("sourceCategory"),
                item.get("jdSubcategory"),
                item.get("productName"),
                item.get("spec"),
                item.get("pnMtm"),
                item.get("catalogSource"),
            )
            product_id = f"PROD-{sku_key}"
            existing_master = conn.execute(
                "SELECT canonical_name, last_source_system FROM product_master WHERE id = ?",
                (product_id,),
            ).fetchone()
            snapshot_name = str(item.get("productName") or sku_key)
            existing_canonical = str(existing_master["canonical_name"]).strip() if existing_master else ""
            previous_catalog_canonical = _clean_title(
                previous_product_library_by_sku.get(sku_key, {}).get("canonical_name")
            )
            retail_title_candidate = retail_zone_by_sku.get(sku_key, {})
            protected_snapshot_name = _select_customer_display_title(
                sku_key=sku_key,
                row={
                    "canonical_name": _first_customer_title(previous_catalog_canonical, existing_canonical, snapshot_name),
                    "default_category": normalized_category["category"],
                    "sku_category": normalized_category["category"],
                    "sku_name": snapshot_name,
                },
                retail=retail_title_candidate,
                standard=standard_price_by_sku.get(sku_key, {}),
                previous_item={
                    "displayTitle": previous_catalog_canonical,
                    "productName": existing_canonical,
                },
            )
            if protected_snapshot_name:
                canonical_name = protected_snapshot_name
            else:
                canonical_name = existing_canonical or snapshot_name
            config_summary = str(item.get("spec") or item.get("pnMtm") or "")
            title_source = (
                "product_library_snapshot_protected_title"
                if previous_catalog_canonical
                and _clean_title(canonical_name)
                == _normalize_customer_title_candidate(previous_catalog_canonical, normalized_category["category"])
                else (
                "retail_zone_protected_title"
                if existing_canonical and _looks_like_internal_title(existing_canonical) and protected_snapshot_name
                else (
                    str(existing_master["last_source_system"]).strip()
                    if existing_master and str(existing_master["canonical_name"]).strip()
                    else "inventory_snapshot"
                )
                )
            )
            title_note = (
                "主标题按 SQL 产品主档锁定，零售区标题仅作展示和证据输入，不再反向覆盖。"
                if existing_master and str(existing_master["canonical_name"]).strip()
                else "主标题按库存快照名称初始化；零售区标题仅作展示和证据输入，不再反向覆盖。"
            )
            conn.execute(
                """
                INSERT INTO product_master
                (id, product_id, canonical_name, brand, default_category, primary_sku_key,
                 configuration_summary, configuration_fingerprint, review_status,
                 source_confidence, created_source, last_source_system, last_synced_at,
                 updated_by, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seeded', ?,
                        'inventory_snapshot', ?, ?, 'system', ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  canonical_name = CASE
                    WHEN length(TRIM(COALESCE(product_master.canonical_name, ''))) > 0
                      AND product_master.canonical_name != excluded.canonical_name
                      AND product_master.source_confidence IN ('sql_locked_title', 'product_library_snapshot_protected_title', 'retail_zone_protected_title')
                    THEN product_master.canonical_name
                    ELSE excluded.canonical_name
                  END,
                  default_category = excluded.default_category,
                  primary_sku_key = excluded.primary_sku_key,
                  configuration_summary = excluded.configuration_summary,
                  configuration_fingerprint = excluded.configuration_fingerprint,
                  source_confidence = excluded.source_confidence,
                  last_source_system = excluded.last_source_system,
                  last_synced_at = excluded.last_synced_at,
                  notes = excluded.notes,
                  updated_at = excluded.updated_at
                """,
                (
                    product_id,
                    product_id,
                    canonical_name,
                    str(item.get("brand") or "Lenovo"),
                    normalized_category["category"],
                    sku_key,
                    config_summary,
                    stable_id(str(item.get("pnMtm") or ""), config_summary),
                    "sql_locked_title" if existing_master and str(existing_master["canonical_name"]).strip() else "snapshot",
                    title_source,
                    adjusted.get("generatedAt") or timestamp,
                    title_note,
                    timestamp,
                    timestamp,
                ),
            )
            product_count += 1
            _upsert_source_link(
                conn,
                entity_type="product_master",
                entity_id=product_id,
                source_system="inventory_snapshot",
                source_type="sku_snapshot",
                source_key=sku_key,
                source_value=str(item.get("pnMtm") or ""),
                snapshot_file=str(data_dir / "latest-adjusted-inventory-snapshot.json"),
                payload=item,
                timestamp=timestamp,
            )
            _upsert_source_link(
                conn,
                entity_type="sku",
                entity_id=sku_key,
                source_system="inventory_snapshot",
                source_type="sku_snapshot",
                source_key=sku_key,
                source_value=normalized_category["sourceCategory"],
                snapshot_file=str(data_dir / "latest-adjusted-inventory-snapshot.json"),
                payload={**item, **normalized_category},
                timestamp=timestamp,
            )
            source_count += 2
            _upsert_evidence(
                conn,
                entity_type="product_master",
                entity_id=product_id,
                source_system="inventory_snapshot",
                evidence_type="snapshot_json",
                title=f"{canonical_name} inventory snapshot",
                file_path=str(data_dir / "latest-adjusted-inventory-snapshot.json"),
                note="当前产品主档来自最新 adjusted inventory snapshot。",
                payload={"skuKey": sku_key},
                timestamp=timestamp,
            )
            evidence_count += 1

        for serial_number, override in serial_overrides.get("overrides", {}).items():
            if not isinstance(override, dict):
                continue
            sku_key = str(override.get("skuKey") or "").strip()
            if not sku_key:
                continue
            _upsert_source_link(
                conn,
                entity_type="serial_item",
                entity_id=str(serial_number),
                source_system="serial_override",
                source_type="serial_override",
                source_key=str(serial_number),
                source_value=sku_key,
                snapshot_file=str(data_dir / "latest-serial-overrides.json"),
                payload=override,
                timestamp=timestamp,
            )
            source_count += 1

        for record in movements.get("records", []):
            if not isinstance(record, dict):
                continue
            movement_id = str(record.get("id") or "").strip()
            sku_key = str(record.get("skuKey") or "").strip()
            if not movement_id or not sku_key:
                continue
            _upsert_source_link(
                conn,
                entity_type="inventory_movement",
                entity_id=movement_id,
                source_system=str(movements.get("source") or "inventory_movements"),
                source_type=str(record.get("movementType") or "movement"),
                source_key=sku_key,
                source_value=str(record.get("documentNumber") or ""),
                snapshot_file=str(data_dir / "latest-inventory-movements.json"),
                payload=record,
                timestamp=timestamp,
            )
            source_count += 1

        for sku_key, override in manual_overrides.get("overrides", {}).items():
            if not isinstance(override, dict):
                continue
            for field_name, raw_value in override.items():
                if field_name == "updatedAt" or not isinstance(raw_value, (int, float)):
                    continue
                adjustment_id = stable_id("price_adjustment", str(sku_key), field_name)
                conn.execute(
                    """
                    INSERT OR REPLACE INTO product_price_adjustment
                    (id, sku_key, adjusted_field, adjusted_value, reason, source_system,
                     applied_to_frontend, effective_from, effective_to, created_by,
                     payload_json, created_at)
                    VALUES (?, ?, ?, ?, 'seeded from latest-manual-price-overrides.json',
                            'manual_override', 1, '', '', 'system', ?, ?)
                    """,
                    (
                        adjustment_id,
                        str(sku_key),
                        field_name,
                        float(raw_value),
                        json.dumps(override, ensure_ascii=False),
                        override.get("updatedAt") or timestamp,
                    ),
                )

    return {
        "retailCoreSeed": seed_result,
        "productCount": product_count,
        "evidenceCount": evidence_count,
        "sourceLinkCount": source_count,
    }


def product_library_overview() -> dict[str, Any]:
    init_product_library()
    with connect() as conn:
        counts = {
            "productMasterCount": int(conn.execute("SELECT COUNT(*) AS count FROM product_master").fetchone()["count"]),
            "skuCount": int(conn.execute("SELECT COUNT(*) AS count FROM sku").fetchone()["count"]),
            "serialCount": int(conn.execute("SELECT COUNT(*) AS count FROM serial_item WHERE status = 'in_stock'").fetchone()["count"]),
            "sourceLinkCount": int(conn.execute("SELECT COUNT(*) AS count FROM product_source_link").fetchone()["count"]),
            "evidenceCount": int(conn.execute("SELECT COUNT(*) AS count FROM product_evidence").fetchone()["count"]),
            "replayCount": int(conn.execute("SELECT COUNT(*) AS count FROM product_sync_replay").fetchone()["count"]),
            "priceAdjustmentCount": int(conn.execute("SELECT COUNT(*) AS count FROM product_price_adjustment").fetchone()["count"]),
            "businessRuleCount": int(conn.execute("SELECT COUNT(*) AS count FROM product_business_rule").fetchone()["count"]),
            "collectionOverrideCount": int(conn.execute("SELECT COUNT(*) AS count FROM product_collection_override").fetchone()["count"]),
        }
    return counts


def list_category_summary() -> dict[str, Any]:
    init_product_library()
    query = """
        WITH movement_agg AS (
          SELECT sku_key,
                 COUNT(*) AS movement_count,
                 TOTAL(CASE WHEN quantity > 0 THEN quantity ELSE 0 END) AS inbound_units,
                 TOTAL(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END) AS outbound_units
          FROM inventory_movement
          WHERE id NOT LIKE 'PURCHASEQ-%'
            AND ABS(COALESCE(quantity, 0)) <= 1000
          GROUP BY sku_key
        ),
        protection_agg AS (
          SELECT sku_key,
                 COUNT(*) AS protection_count,
                 TOTAL(CASE WHEN status = 'pending' AND COALESCE(estimated_protection_amount, 0) > 0 THEN 1 ELSE 0 END) AS pending_protection_count,
                 TOTAL(CASE WHEN status = 'pending' THEN COALESCE(estimated_protection_amount, 0) ELSE 0 END) AS pending_protection_amount
          FROM sales_price_protection_history
          GROUP BY sku_key
        ),
        serial_agg AS (
          SELECT sku_key, COUNT(*) AS serial_count
          FROM serial_item
          WHERE status = 'in_stock'
          GROUP BY sku_key
        ),
        sku_rollup AS (
          SELECT
            COALESCE(NULLIF(master.default_category, ''), NULLIF(sku.category, ''), NULLIF(sku.source_category, ''), '未分类') AS category,
            master.id AS master_id,
            sku.sku_key AS sku_key,
            COALESCE(sku.current_stock, 0) AS current_stock,
            COALESCE(sku.sellable_stock, 0) AS sellable_stock,
            COALESCE(serial_agg.serial_count, 0) AS serial_count,
            COALESCE(movement_agg.inbound_units, 0) AS inbound_units,
            COALESCE(movement_agg.outbound_units, 0) AS outbound_units,
            COALESCE(protection_agg.protection_count, 0) AS protection_count,
            COALESCE(protection_agg.pending_protection_count, 0) AS pending_protection_count,
            COALESCE(protection_agg.pending_protection_amount, 0) AS pending_protection_amount
          FROM product_master AS master
          LEFT JOIN sku ON sku.product_id = master.product_id OR sku.sku_key = master.primary_sku_key
          LEFT JOIN movement_agg ON movement_agg.sku_key = sku.sku_key
          LEFT JOIN protection_agg ON protection_agg.sku_key = sku.sku_key
          LEFT JOIN serial_agg ON serial_agg.sku_key = sku.sku_key
        )
        SELECT
          category,
          COUNT(DISTINCT master_id) AS product_count,
          COUNT(DISTINCT sku_key) AS sku_count,
          TOTAL(current_stock) AS current_stock,
          TOTAL(sellable_stock) AS sellable_stock,
          TOTAL(serial_count) AS serial_count,
          TOTAL(inbound_units) AS inbound_units,
          TOTAL(outbound_units) AS outbound_units,
          TOTAL(protection_count) AS protection_count,
          TOTAL(pending_protection_count) AS pending_protection_count,
          TOTAL(pending_protection_amount) AS pending_protection_amount
        FROM sku_rollup
        GROUP BY category
        ORDER BY sellable_stock DESC, current_stock DESC, category
    """
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(query).fetchall()]
    return {"items": rows, "count": len(rows)}


def list_products(limit: int = 50, search: str = "", category: str = "") -> dict[str, Any]:
    init_product_library()
    params: list[Any] = []
    where_parts: list[str] = []
    if search.strip():
        pattern = f"%{search.strip()}%"
        where_parts.append("""
        (master.canonical_name LIKE ? OR master.primary_sku_key LIKE ?
           OR sku.pn_mtm LIKE ? OR sku.name LIKE ?)
        """)
        params.extend([pattern, pattern, pattern, pattern])
    if category.strip() and category.strip() != "全部":
        where_parts.append("""
        COALESCE(NULLIF(master.default_category, ''), NULLIF(sku.category, ''), NULLIF(sku.source_category, ''), '未分类') = ?
        """)
        params.append(category.strip())
    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    query = f"""
        WITH protection_agg AS (
          SELECT sku_key,
                 SUM(CASE WHEN status = 'pending' AND COALESCE(estimated_protection_amount, 0) > 0 THEN 1 ELSE 0 END) AS pending_protection_count,
                 SUM(CASE WHEN status = 'pending' THEN COALESCE(estimated_protection_amount, 0) ELSE 0 END) AS pending_protection_amount
          FROM sales_price_protection_history
          GROUP BY sku_key
        )
        SELECT master.id, master.canonical_name, master.default_category, master.primary_sku_key,
               master.configuration_summary, master.review_status, master.source_confidence,
               master.last_source_system, master.last_synced_at, master.updated_at,
               sku.pn_mtm, sku.sellable_stock, sku.current_stock, sku.source_category,
               sku.jd_subcategory, sku.catalog_source,
               COALESCE(protection_agg.pending_protection_count, 0) AS pending_protection_count,
               COALESCE(protection_agg.pending_protection_amount, 0) AS pending_protection_amount
        FROM product_master AS master
        LEFT JOIN sku ON sku.sku_key = master.primary_sku_key
        LEFT JOIN protection_agg ON protection_agg.sku_key = sku.sku_key
        {where}
        ORDER BY COALESCE(sku.sellable_stock, 0) DESC, master.updated_at DESC
        LIMIT ?
    """
    params.append(limit)
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(query, params).fetchall()]
    return {"items": rows, "count": len(rows)}


def get_product(product_id: str) -> dict[str, Any] | None:
    init_product_library()
    data_dir = PROJECT_ROOT / "apps" / "web-cockpit" / "public" / "data"
    with connect() as conn:
        product_row = conn.execute(
            """
            SELECT *
            FROM product_master
            WHERE id = ?
            """,
            (product_id,),
        ).fetchone()
        if not product_row:
            return None
        primary_sku = str(product_row["primary_sku_key"] or "")
        sku_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM sku
                WHERE product_id = ? OR sku_key = ?
                ORDER BY updated_at DESC, sku_key
                """,
                (product_row["product_id"], primary_sku),
            ).fetchall()
        ]
        serial_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM serial_item
                WHERE sku_key IN (
                  SELECT sku_key FROM sku WHERE product_id = ? OR sku_key = ?
                )
                AND status = 'in_stock'
                ORDER BY updated_at DESC, serial_number
                LIMIT 200
                """,
                (product_row["product_id"], primary_sku),
            ).fetchall()
        ]
        source_rows = list_source_links(entity_id=product_id, entity_type="product_master", limit=200)["items"]
        evidence_rows = list_evidence(entity_id=product_id, entity_type="product_master", limit=200)["items"]
        price_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM product_price_adjustment
                WHERE sku_key = ?
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (primary_sku,),
            ).fetchall()
        ]
        business_rule_row = conn.execute(
            """
            SELECT *
            FROM product_business_rule
            WHERE product_id = ?
            """,
            (product_id,),
        ).fetchone()
        collection_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM product_collection_override
                WHERE sku_key IN (
                  SELECT sku_key FROM sku WHERE product_id = ? OR sku_key = ?
                )
                ORDER BY updated_at DESC, sku_key
                """,
                (product_row["product_id"], primary_sku),
            ).fetchall()
        ]
        movement_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT movement.*, sku.name AS sku_name, sku.pn_mtm AS sku_pn_mtm
                FROM inventory_movement AS movement
                LEFT JOIN sku ON sku.sku_key = movement.sku_key
                WHERE movement.sku_key IN (
                  SELECT sku_key FROM sku WHERE product_id = ? OR sku_key = ?
                )
                ORDER BY movement.business_date DESC, movement.created_at DESC
                LIMIT 120
                """,
                (product_row["product_id"], primary_sku),
            ).fetchall()
        ]
        protection_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM sales_price_protection_history
                WHERE sku_key IN (
                  SELECT sku_key FROM sku WHERE product_id = ? OR sku_key = ?
                )
                ORDER BY outbound_date DESC, updated_at DESC
                LIMIT 80
                """,
                (product_row["product_id"], primary_sku),
            ).fetchall()
        ]
        retail_zone_snapshot = _load_snapshot_cache_payload(conn, "latest-retail-zone-snapshot.json") or {}
        marketplace_snapshot = _load_snapshot_cache_payload(conn, "latest-marketplace-price-snapshot.json") or {}
        marketing_snapshot = _load_snapshot_cache_payload(conn, "latest-marketing-boost-snapshot.json") or {}
        price_signal_snapshot = _load_snapshot_cache_payload(conn, "latest-retail-core-price-signals.json") or {}
        store_manual_promotions = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, sku_key, mode, value, valid_from, valid_to, note, enabled, updated_at
                FROM store_manual_promotion
                WHERE sku_key IN (
                  SELECT sku_key FROM sku WHERE product_id = ? OR sku_key = ?
                )
                ORDER BY updated_at DESC, valid_to DESC
                """,
                (product_row["product_id"], primary_sku),
            ).fetchall()
        ]
    result = dict(product_row)
    result["skus"] = sku_rows
    result["serials"] = serial_rows
    result["sourceLinks"] = source_rows
    result["evidence"] = evidence_rows
    result["priceAdjustments"] = price_rows
    result["businessRule"] = dict(business_rule_row) if business_rule_row else {
        "product_id": product_id,
        "store_price_rule_text": "",
        "subsidy_rule_text": "",
        "collection_rule_text": "",
        "inbound_rule_text": "",
        "outbound_rule_text": "",
        "protection_rule_text": "",
        "notes": "",
        "updated_by": "system",
        "updated_at": "",
    }
    collection_seed = _merge_collection_override_with_snapshot(collection_rows[0] if collection_rows else {}, primary_sku, data_dir)
    result["collectionOverrides"] = [collection_seed]
    result["recentMovements"] = movement_rows
    result["priceProtectionHistory"] = protection_rows
    result["movementSummary"] = {
        "inboundUnits": sum(max(int(item.get("quantity") or 0), 0) for item in movement_rows),
        "outboundUnits": sum(abs(min(int(item.get("quantity") or 0), 0)) for item in movement_rows),
        "movementCount": len(movement_rows),
    }
    result["protectionSummary"] = {
        "historyCount": len(protection_rows),
        "pendingCount": sum(1 for item in protection_rows if item.get("status") == "pending" and float(item.get("estimated_protection_amount") or 0) > 0),
        "pendingAmount": sum(float(item.get("estimated_protection_amount") or 0) for item in protection_rows if item.get("status") == "pending"),
    }
    sku_keys = {str(item.get("sku_key") or "") for item in sku_rows if str(item.get("sku_key") or "").strip()}
    sku_keys.add(primary_sku)
    result["sqlPriceContext"] = {
        "retailDecisions": [
            item for item in retail_zone_snapshot.get("decisions", {}).get("items", [])
            if isinstance(item, dict) and str(item.get("skuKey") or "") in sku_keys
        ][:8],
        "priceSignals": [
            item for item in price_signal_snapshot.get("items", [])
            if isinstance(item, dict) and str(item.get("skuKey") or "") in sku_keys
        ][:8],
        "marketplaceRecords": [
            item for item in marketplace_snapshot.get("records", [])
            if isinstance(item, dict) and str(item.get("productId") or "") in sku_keys
        ][:24],
        "marketingActivities": [
            item for item in marketing_snapshot.get("activities", [])
            if isinstance(item, dict) and str(item.get("skuKey") or "") in sku_keys
        ][:24],
        "storeManualPromotions": store_manual_promotions,
        "snapshotSources": [
            "latest-retail-zone-snapshot.json",
            "latest-retail-core-price-signals.json",
            "latest-marketplace-price-snapshot.json",
            "latest-marketing-boost-snapshot.json",
            "store_manual_promotion",
        ],
    }
    return result


def _log_changes(
    conn,
    *,
    entity_type: str,
    entity_id: str,
    before: dict[str, Any],
    after: dict[str, Any],
    changed_by: str,
    reason: str,
    source_system: str,
) -> int:
    count = 0
    timestamp = now_iso()
    for field_name, new_value in after.items():
        old_value = before.get(field_name)
        if old_value == new_value:
            continue
        conn.execute(
            """
            INSERT INTO product_change_log
            (id, entity_type, entity_id, field_name, before_value, after_value,
             change_reason, changed_by, source_system, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                stable_id(entity_type, entity_id, field_name, timestamp),
                entity_type,
                entity_id,
                field_name,
                "" if old_value is None else str(old_value),
                "" if new_value is None else str(new_value),
                reason,
                changed_by,
                source_system,
                timestamp,
            ),
        )
        count += 1
    return count


def update_product_master(
    data_dir: Path,
    product_id: str,
    updates: dict[str, Any],
    *,
    changed_by: str,
    reason: str,
) -> dict[str, Any] | None:
    init_product_library()
    allowed_fields = {
        "canonical_name",
        "product_line",
        "model_family",
        "default_category",
        "configuration_summary",
        "review_status",
        "source_confidence",
        "notes",
    }
    payload = {key: value for key, value in updates.items() if key in allowed_fields and value is not None}
    if not payload:
        return get_product(product_id)
    with connect() as conn:
        row = conn.execute("SELECT * FROM product_master WHERE id = ?", (product_id,)).fetchone()
        if not row:
            return None
        before = dict(row)
        columns = ", ".join(f"{field} = ?" for field in payload)
        values = [payload[field] for field in payload]
        values.extend([changed_by, now_iso(), product_id])
        conn.execute(
            f"UPDATE product_master SET {columns}, updated_by = ?, updated_at = ? WHERE id = ?",
            values,
        )
        _log_changes(
            conn,
            entity_type="product_master",
            entity_id=product_id,
            before=before,
            after=payload,
            changed_by=changed_by,
            reason=reason,
            source_system="manual_product_library",
        )
        snapshot_updates = {
            "productName": payload.get("canonical_name", before.get("canonical_name")),
            "category": payload.get("default_category", before.get("default_category")),
            "spec": payload.get("configuration_summary", before.get("configuration_summary")),
        }
        _write_product_profile_to_frontend(
            data_dir,
            sku_key=str(before.get("primary_sku_key") or ""),
            updates=snapshot_updates,
        )
        write_product_library_static_snapshots(data_dir)
    return get_product(product_id)


def update_sku_profile(
    data_dir: Path,
    sku_key: str,
    updates: dict[str, Any],
    *,
    changed_by: str,
    reason: str,
) -> dict[str, Any] | None:
    init_product_library()
    allowed_fields = {
        "pn_mtm",
        "name",
        "category",
        "source_category",
        "jd_subcategory",
        "catalog_source",
    }
    payload = {key: value for key, value in updates.items() if key in allowed_fields and value is not None}
    if not payload:
        return None
    with connect() as conn:
        row = conn.execute("SELECT * FROM sku WHERE sku_key = ?", (sku_key,)).fetchone()
        if not row:
            return None
        before = dict(row)
        columns = ", ".join(f"{field} = ?" for field in payload)
        values = [payload[field] for field in payload]
        values.extend([now_iso(), sku_key])
        conn.execute(
            f"UPDATE sku SET {columns}, updated_at = ? WHERE sku_key = ?",
            values,
        )
        _log_changes(
            conn,
            entity_type="sku",
            entity_id=sku_key,
            before=before,
            after=payload,
            changed_by=changed_by,
            reason=reason,
            source_system="manual_product_library",
        )
        updated = conn.execute("SELECT * FROM sku WHERE sku_key = ?", (sku_key,)).fetchone()
        snapshot_updates = {
            "productName": payload.get("name", before.get("name")),
            "pnMtm": payload.get("pn_mtm", before.get("pn_mtm")),
            "category": payload.get("category", before.get("category") or before.get("source_category")),
            "sourceCategory": payload.get("source_category", before.get("source_category")),
            "jdSubcategory": payload.get("jd_subcategory", before.get("jd_subcategory")),
            "catalogSource": payload.get("catalog_source", before.get("catalog_source")),
        }
        _write_product_profile_to_frontend(
            data_dir,
            sku_key=sku_key,
            updates=snapshot_updates,
        )
        write_product_library_static_snapshots(data_dir)
    return dict(updated) if updated else None


def update_product_business_rule(
    data_dir: Path,
    product_id: str,
    updates: dict[str, Any],
    *,
    changed_by: str,
    reason: str,
) -> dict[str, Any]:
    init_product_library()
    allowed_fields = {
        "store_price_rule_text",
        "subsidy_rule_text",
        "collection_rule_text",
        "inbound_rule_text",
        "outbound_rule_text",
        "protection_rule_text",
        "notes",
    }
    payload = {key: value for key, value in updates.items() if key in allowed_fields and value is not None}
    timestamp = now_iso()
    with connect() as conn:
        existing = conn.execute("SELECT * FROM product_business_rule WHERE product_id = ?", (product_id,)).fetchone()
        before = dict(existing) if existing else {}
        next_row = {
            "product_id": product_id,
            "store_price_rule_text": payload.get("store_price_rule_text", before.get("store_price_rule_text", "")),
            "subsidy_rule_text": payload.get("subsidy_rule_text", before.get("subsidy_rule_text", "")),
            "collection_rule_text": payload.get("collection_rule_text", before.get("collection_rule_text", "")),
            "inbound_rule_text": payload.get("inbound_rule_text", before.get("inbound_rule_text", "")),
            "outbound_rule_text": payload.get("outbound_rule_text", before.get("outbound_rule_text", "")),
            "protection_rule_text": payload.get("protection_rule_text", before.get("protection_rule_text", "")),
            "notes": payload.get("notes", before.get("notes", "")),
            "updated_by": changed_by,
            "updated_at": timestamp,
        }
        conn.execute(
            """
            INSERT INTO product_business_rule
            (product_id, store_price_rule_text, subsidy_rule_text, collection_rule_text,
             inbound_rule_text, outbound_rule_text, protection_rule_text, notes, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET
              store_price_rule_text = excluded.store_price_rule_text,
              subsidy_rule_text = excluded.subsidy_rule_text,
              collection_rule_text = excluded.collection_rule_text,
              inbound_rule_text = excluded.inbound_rule_text,
              outbound_rule_text = excluded.outbound_rule_text,
              protection_rule_text = excluded.protection_rule_text,
              notes = excluded.notes,
              updated_by = excluded.updated_by,
              updated_at = excluded.updated_at
            """,
            (
                product_id,
                next_row["store_price_rule_text"],
                next_row["subsidy_rule_text"],
                next_row["collection_rule_text"],
                next_row["inbound_rule_text"],
                next_row["outbound_rule_text"],
                next_row["protection_rule_text"],
                next_row["notes"],
                changed_by,
                timestamp,
            ),
        )
        _log_changes(
            conn,
            entity_type="product_business_rule",
            entity_id=product_id,
            before=before,
            after=next_row,
            changed_by=changed_by,
            reason=reason,
            source_system="manual_product_library",
        )
    write_product_library_static_snapshots(data_dir)
    return next_row


def update_product_collection_override(
    data_dir: Path,
    sku_key: str,
    updates: dict[str, Any],
    *,
    changed_by: str,
    reason: str,
) -> dict[str, Any]:
    init_product_library()
    allowed_fields = {
        "jd_url",
        "lenovo_url",
        "tmall_url",
        "distributor_quote_note",
        "gray_quote_note",
        "capture_note",
    }
    payload = {key: value for key, value in updates.items() if key in allowed_fields and value is not None}
    timestamp = now_iso()
    with connect() as conn:
        existing = conn.execute("SELECT * FROM product_collection_override WHERE sku_key = ?", (sku_key,)).fetchone()
        before = dict(existing) if existing else {}
        next_row = {
            "sku_key": sku_key,
            "jd_url": payload.get("jd_url", before.get("jd_url", "")),
            "lenovo_url": payload.get("lenovo_url", before.get("lenovo_url", "")),
            "tmall_url": payload.get("tmall_url", before.get("tmall_url", "")),
            "distributor_quote_note": payload.get("distributor_quote_note", before.get("distributor_quote_note", "")),
            "gray_quote_note": payload.get("gray_quote_note", before.get("gray_quote_note", "")),
            "capture_note": payload.get("capture_note", before.get("capture_note", "")),
            "updated_by": changed_by,
            "updated_at": timestamp,
        }
        conn.execute(
            """
            INSERT INTO product_collection_override
            (sku_key, jd_url, lenovo_url, tmall_url, distributor_quote_note, gray_quote_note,
             capture_note, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(sku_key) DO UPDATE SET
              jd_url = excluded.jd_url,
              lenovo_url = excluded.lenovo_url,
              tmall_url = excluded.tmall_url,
              distributor_quote_note = excluded.distributor_quote_note,
              gray_quote_note = excluded.gray_quote_note,
              capture_note = excluded.capture_note,
              updated_by = excluded.updated_by,
              updated_at = excluded.updated_at
            """,
            (
                sku_key,
                next_row["jd_url"],
                next_row["lenovo_url"],
                next_row["tmall_url"],
                next_row["distributor_quote_note"],
                next_row["gray_quote_note"],
                next_row["capture_note"],
                changed_by,
                timestamp,
            ),
        )
        _log_changes(
            conn,
            entity_type="product_collection_override",
            entity_id=sku_key,
            before=before,
            after=next_row,
            changed_by=changed_by,
            reason=reason,
            source_system="manual_product_library",
        )
        sku_row = conn.execute(
            "SELECT sku_key, name, pn_mtm, category, source_category FROM sku WHERE sku_key = ?",
            (sku_key,),
        ).fetchone()
        product_name = str((dict(sku_row).get("name") if sku_row else "") or sku_key)
        pn_mtm = str((dict(sku_row).get("pn_mtm") if sku_row else "") or "")
        category = str((dict(sku_row).get("category") if sku_row else "") or (dict(sku_row).get("source_category") if sku_row else "") or "")
        written_files = _write_collection_override_to_frontend(
            data_dir,
            sku_key=sku_key,
            product_name=product_name,
            pn_mtm=pn_mtm,
            category=category,
            override_row=next_row,
            changed_by=changed_by,
            reason=reason,
        )
        _upsert_source_link(
            conn,
            entity_type="product_collection_override",
            entity_id=sku_key,
            source_system="manual_product_library",
            source_type="collection_override",
            source_key=sku_key,
            source_value=reason,
            snapshot_file=written_files["webLocks"],
            payload=next_row,
            timestamp=timestamp,
        )
        _upsert_evidence(
            conn,
            entity_type="product_collection_override",
            entity_id=sku_key,
            source_system="manual_product_library",
            evidence_type="collection_override_sync",
            title=f"{sku_key} collection override sync",
            file_path=written_files["webMarketplace"],
            note=reason,
            payload=next_row,
            timestamp=timestamp,
        )
        write_product_library_static_snapshots(data_dir)
    return next_row


def list_source_links(
    *,
    entity_id: str | None = None,
    entity_type: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    init_product_library()
    where_parts: list[str] = []
    params: list[Any] = []
    if entity_id:
        where_parts.append("entity_id = ?")
        params.append(entity_id)
    if entity_type:
        where_parts.append("entity_type = ?")
        params.append(entity_type)
    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    query = f"""
        SELECT id, entity_type, entity_id, source_system, source_type, source_key,
               source_value, snapshot_file, payload_json, first_seen_at, last_seen_at
        FROM product_source_link
        {where}
        ORDER BY last_seen_at DESC
        LIMIT ?
    """
    params.append(limit)
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(query, params).fetchall()]
    for row in rows:
        try:
            row["payload"] = json.loads(row.pop("payload_json", "{}"))
        except json.JSONDecodeError:
            row["payload"] = {}
    return {"items": rows, "count": len(rows)}


def list_evidence(
    *,
    entity_id: str | None = None,
    entity_type: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    init_product_library()
    where_parts: list[str] = []
    params: list[Any] = []
    if entity_id:
        where_parts.append("entity_id = ?")
        params.append(entity_id)
    if entity_type:
        where_parts.append("entity_type = ?")
        params.append(entity_type)
    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    query = f"""
        SELECT id, entity_type, entity_id, source_system, evidence_type, title,
               file_path, source_url, captured_at, captured_by, checksum, note, payload_json, created_at
        FROM product_evidence
        {where}
        ORDER BY captured_at DESC, created_at DESC
        LIMIT ?
    """
    params.append(limit)
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(query, params).fetchall()]
    for row in rows:
        try:
            row["payload"] = json.loads(row.pop("payload_json", "{}"))
        except json.JSONDecodeError:
            row["payload"] = {}
    return {"items": rows, "count": len(rows)}


def create_sync_replay(
    data_dir: Path,
    replay_type: str,
    source_system: str,
    source_ref: str,
    scope: dict[str, Any],
    *,
    created_by: str,
) -> dict[str, Any]:
    init_product_library()
    timestamp = now_iso()
    replay_id = f"replay-{stable_id(replay_type, source_system, source_ref, timestamp)}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO product_sync_replay
            (id, replay_type, source_system, source_ref, scope_json, status, result_json,
             error_message, created_by, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, 'queued', '{}', '', ?, ?, '')
            """,
            (
                replay_id,
                replay_type,
                source_system,
                source_ref,
                json.dumps(scope, ensure_ascii=False),
                created_by,
                timestamp,
            ),
        )
    write_product_library_static_snapshots(data_dir)
    return {
        "replayId": replay_id,
        "status": "queued",
        "sourceSystem": source_system,
        "scope": scope,
    }


def list_sync_replays(limit: int = 50) -> dict[str, Any]:
    init_product_library()
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(
            """
            SELECT *
            FROM product_sync_replay
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()]
    for row in rows:
        try:
            row["scope"] = json.loads(row.pop("scope_json", "{}"))
        except json.JSONDecodeError:
            row["scope"] = {}
        try:
            row["result"] = json.loads(row.pop("result_json", "{}"))
        except json.JSONDecodeError:
            row["result"] = {}
    return {"items": rows, "count": len(rows)}


def list_change_logs(
    *,
    entity_id: str | None = None,
    entity_type: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    init_product_library()
    where_parts: list[str] = []
    params: list[Any] = []
    if entity_id:
        where_parts.append("entity_id = ?")
        params.append(entity_id)
    if entity_type:
        where_parts.append("entity_type = ?")
        params.append(entity_type)
    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    query = f"""
        SELECT *
        FROM product_change_log
        {where}
        ORDER BY created_at DESC
        LIMIT ?
    """
    params.append(limit)
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(query, params).fetchall()]
    return {"items": rows, "count": len(rows)}


def apply_manual_price_adjustment(
    data_dir: Path,
    *,
    sku_key: str,
    override_payload: dict[str, float],
    reason: str,
    changed_by: str,
) -> dict[str, Any]:
    init_product_library()
    timestamp = now_iso()
    manual_path = data_dir / "latest-manual-price-overrides.json"
    current = _load_json(manual_path, {
        "generatedAt": timestamp,
        "source": "system_manual_price_overrides",
        "overrides": {},
    })
    overrides = current.get("overrides", {})
    if not isinstance(overrides, dict):
        overrides = {}
    existing = overrides.get(sku_key, {})
    if not isinstance(existing, dict):
        existing = {}
    next_override = {**existing, **override_payload, "updatedAt": timestamp}
    overrides[sku_key] = next_override
    snapshot = {
        "generatedAt": timestamp,
        "source": "system_manual_price_overrides",
        "overrides": overrides,
    }
    inventory_sync_copy = data_dir.parents[2] / "inventory-sync" / "artifacts" / "latest-manual-price-overrides.json"
    manual_path.parent.mkdir(parents=True, exist_ok=True)
    inventory_sync_copy.parent.mkdir(parents=True, exist_ok=True)
    manual_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    inventory_sync_copy.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    with connect() as conn:
        for field_name, raw_value in override_payload.items():
            if not isinstance(raw_value, (int, float)):
                continue
            conn.execute(
                """
                INSERT INTO product_price_adjustment
                (id, sku_key, adjusted_field, adjusted_value, reason, source_system,
                 applied_to_frontend, effective_from, effective_to, created_by,
                 payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, 'manual_override', 1, ?, '', ?, ?, ?)
                """,
                (
                    stable_id("price_adjustment", sku_key, field_name, timestamp),
                    sku_key,
                    field_name,
                    float(raw_value),
                    reason,
                    timestamp,
                    changed_by,
                    json.dumps(next_override, ensure_ascii=False),
                    timestamp,
                ),
            )
        _upsert_evidence(
            conn,
            entity_type="sku",
            entity_id=sku_key,
            source_system="manual_override",
            evidence_type="manual_price_override_json",
            title=f"{sku_key} manual price override",
            file_path=str(manual_path),
            note=reason,
            payload=next_override,
            timestamp=timestamp,
        )
        _upsert_source_link(
            conn,
            entity_type="sku",
            entity_id=sku_key,
            source_system="manual_override",
            source_type="price_override",
            source_key=sku_key,
            source_value=reason,
            snapshot_file=str(manual_path),
            payload=next_override,
            timestamp=timestamp,
        )
    write_product_library_static_snapshots(data_dir)
    return {
        "skuKey": sku_key,
        "override": next_override,
        "files": {
            "webDataPath": str(manual_path),
            "inventorySyncArtifactPath": str(inventory_sync_copy),
        },
        "appliedToFrontend": True,
    }


def export_dataset(kind: str, *, category: str = "", search: str = "", product_id: str = "") -> tuple[str, str]:
    init_product_library()
    rows: list[dict[str, Any]]
    if kind == "category_summary":
        rows = list_category_summary()["items"]
    elif kind == "products":
        rows = list_products(limit=500, search=search, category=category)["items"]
    elif kind == "movements":
        if not product_id:
            raise ValueError("product_id is required for movements export")
        product = get_product(product_id)
        rows = product.get("recentMovements", []) if product else []
    elif kind == "protections":
        if not product_id:
            raise ValueError("product_id is required for protections export")
        product = get_product(product_id)
        rows = product.get("priceProtectionHistory", []) if product else []
    else:
        raise ValueError(f"unsupported export kind: {kind}")

    output = StringIO()
    if rows:
        writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    else:
        output.write("")
    filename = f"product-library-{kind}.csv"
    return filename, output.getvalue()
