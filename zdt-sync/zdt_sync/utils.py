from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DANGEROUS_ACTION_PATTERNS = [
    "新增",
    "删除",
    "提交",
    "确认",
    "审核",
    "付款",
    "退款",
    "作废",
    "取消订单",
    "调拨确认",
    "入库确认",
    "出库确认",
    "生成单据",
    "保存",
]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def record_hash(entity: str, record: dict[str, Any]) -> str:
    return sha256_text(f"{entity}:{stable_json(record)}")


def build_record_id(entity: str, record: dict[str, Any], fields: list[str] | None = None) -> str:
    fields = fields or []
    if fields:
        raw = "|".join(normalize_text(record.get(f)) for f in fields)
        if raw.replace("|", ""):
            return sha256_text(f"{entity}:id:{raw}")
    return record_hash(entity, record)


def parse_since_until(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value or value.lower() == "none":
        return None
    if value.lower() == "now":
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return value


def is_dangerous_action_text(text: str, extra: list[str] | None = None) -> bool:
    patterns = DANGEROUS_ACTION_PATTERNS + (extra or [])
    compact = normalize_text(text)
    return any(p and p in compact for p in patterns)
