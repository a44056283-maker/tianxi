from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from zdt_sync.db.models import SyncState
from zdt_sync.utils import now_utc

SOURCE_NAME = "zhidiantong"


def get_sync_state(session: Session, entity: str) -> SyncState | None:
    stmt = select(SyncState).where(
        SyncState.source_name == SOURCE_NAME,
        SyncState.entity_name == entity,
    )
    return session.execute(stmt).scalar_one_or_none()


def ensure_sync_state(session: Session, entity: str) -> SyncState:
    state = get_sync_state(session, entity)
    if state:
        return state
    state = SyncState(source_name=SOURCE_NAME, entity_name=entity, status="new", updated_at=now_utc())
    session.add(state)
    session.flush()
    return state


def mark_sync_success(
    session: Session,
    entity: str,
    cursor_value: str | None = None,
    last_sync_time: datetime | None = None,
) -> None:
    state = ensure_sync_state(session, entity)
    state.cursor_value = cursor_value or state.cursor_value
    state.last_sync_time = last_sync_time or now_utc()
    state.last_success_time = now_utc()
    state.last_error = None
    state.status = "success"
    state.updated_at = now_utc()


def mark_sync_error(session: Session, entity: str, error: str) -> None:
    state = ensure_sync_state(session, entity)
    state.last_error = error
    state.status = "error"
    state.updated_at = now_utc()
