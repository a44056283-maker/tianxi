from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from playwright.sync_api import Page
from sqlalchemy import select
from sqlalchemy.orm import Session

from zdt_sync.db.models import RawRecord, SyncJob
from zdt_sync.db.state import SOURCE_NAME, mark_sync_error, mark_sync_success
from zdt_sync.settings import Settings
from zdt_sync.utils import build_record_id, ensure_dir, now_utc, record_hash


@dataclass
class CollectResult:
    entity: str
    row_count: int
    job_id: int
    trace_path: str | None = None
    screenshot_path: str | None = None


class BaseCollector:
    def __init__(self, settings: Settings, entity: str, entity_config: dict[str, Any]):
        self.settings = settings
        self.entity = entity
        self.entity_config = entity_config
        self.artifacts_dir = ensure_dir(settings.artifacts_dir)

    def start_job(self, session: Session, parameters: dict[str, Any]) -> SyncJob:
        job = SyncJob(
            source_name=SOURCE_NAME,
            entity_name=self.entity,
            job_type="collect",
            parameters=parameters,
            status="running",
            started_at=now_utc(),
        )
        session.add(job)
        session.flush()
        return job

    def finish_job(
        self,
        session: Session,
        job: SyncJob,
        status: str,
        row_count: int = 0,
        error_message: str | None = None,
        trace_path: str | None = None,
        screenshot_path: str | None = None,
    ) -> None:
        job.status = status
        job.row_count = row_count
        job.error_message = error_message
        job.trace_path = trace_path
        job.screenshot_path = screenshot_path
        job.finished_at = now_utc()
        if status == "success":
            mark_sync_success(session, self.entity)
        else:
            mark_sync_error(session, self.entity, error_message or "unknown error")

    def save_raw_records(
        self,
        session: Session,
        records: list[dict[str, Any]],
        job_id: int,
        store_code: str | None = None,
    ) -> int:
        table_cfg = self.entity_config.get("table") or {}
        id_fields = table_cfg.get("record_id_fields") or []
        count = 0
        for record in records:
            rid = build_record_id(self.entity, record, id_fields)
            rhash = record_hash(self.entity, record)
            existing = session.execute(
                select(RawRecord).where(
                    RawRecord.source_name == SOURCE_NAME,
                    RawRecord.entity_name == self.entity,
                    RawRecord.record_id == rid,
                )
            ).scalar_one_or_none()
            if existing:
                existing.record_hash = rhash
                existing.payload = record
                existing.collected_at = now_utc()
                existing.job_id = job_id
                existing.store_code = store_code or record.get("store_code") or existing.store_code
            else:
                session.add(
                    RawRecord(
                        source_name=SOURCE_NAME,
                        entity_name=self.entity,
                        record_id=rid,
                        record_hash=rhash,
                        payload=record,
                        store_code=store_code or record.get("store_code"),
                        job_id=job_id,
                    )
                )
            count += 1
        session.flush()
        return count

    def screenshot_path(self, job_id: int) -> Path:
        return ensure_dir(self.artifacts_dir / "screenshots") / f"{self.entity}_job_{job_id}.png"

    def trace_path(self, job_id: int) -> Path:
        return ensure_dir(self.artifacts_dir / "traces") / f"{self.entity}_job_{job_id}.zip"

    def save_failure_screenshot(self, page: Page | None, job_id: int) -> str | None:
        if page is None:
            return None
        path = self.screenshot_path(job_id)
        try:
            page.screenshot(path=str(path), full_page=True)
            return str(path)
        except Exception:  # noqa: BLE001
            return None
