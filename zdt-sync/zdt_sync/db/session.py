from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from zdt_sync.settings import Settings, load_settings
from zdt_sync.db.models import Base


def get_engine(settings: Settings | None = None):
    settings = settings or load_settings()
    return create_engine(settings.database_url, pool_pre_ping=True, future=True)


def init_database(settings: Settings | None = None) -> None:
    engine = get_engine(settings)
    Base.metadata.create_all(engine)


@contextmanager
def get_session(settings: Settings | None = None) -> Iterator[Session]:
    engine = get_engine(settings)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
