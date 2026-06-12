from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    base_url: str
    database_url: str
    storage_state: Path
    headless: bool
    selectors_file: Path
    stores_file: Path
    artifacts_dir: Path
    action_delay_ms: int
    default_timeout_ms: int
    enable_trace: bool


def _bool(value: str | bool | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return value.lower() in {"1", "true", "yes", "y", "on"}


def load_settings() -> Settings:
    load_dotenv()
    return Settings(
        base_url=os.environ.get("ZDT_BASE_URL", "https://example.zhidiantong.local"),
        database_url=os.environ.get(
            "ZDT_DATABASE_URL", "postgresql+psycopg://zdt:zdt@localhost:5432/zdt_sync"
        ),
        storage_state=Path(os.environ.get("ZDT_STORAGE_STATE", ".auth/zhidiantong.storage.json")),
        headless=_bool(os.environ.get("ZDT_HEADLESS"), default=False),
        selectors_file=Path(os.environ.get("ZDT_SELECTORS_FILE", "config/selectors.yaml")),
        stores_file=Path(os.environ.get("ZDT_STORES_FILE", "config/stores.yaml")),
        artifacts_dir=Path(os.environ.get("ZDT_ARTIFACTS_DIR", "artifacts")),
        action_delay_ms=int(os.environ.get("ZDT_ACTION_DELAY_MS", "800")),
        default_timeout_ms=int(os.environ.get("ZDT_DEFAULT_TIMEOUT_MS", "30000")),
        enable_trace=_bool(os.environ.get("ZDT_ENABLE_TRACE"), default=True),
    )


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"配置文件不存在: {path}")
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"配置文件格式错误，根节点必须是对象: {path}")
    return data


def load_selectors(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or load_settings()
    return load_yaml(settings.selectors_file)


def load_stores(settings: Settings | None = None) -> list[dict[str, Any]]:
    settings = settings or load_settings()
    if not settings.stores_file.exists():
        return []
    data = load_yaml(settings.stores_file)
    stores = data.get("stores", [])
    if not isinstance(stores, list):
        raise ValueError("stores.yaml 的 stores 必须是列表")
    return [s for s in stores if isinstance(s, dict) and s.get("enabled", True)]
