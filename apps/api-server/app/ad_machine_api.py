"""
智慧零售广告机系统 API
2026-06-10

Routes:
  /api/ad-machine/contents          - 广告素材 CRUD
  /api/ad-machine/schedules       - 排期 CRUD
  /api/ad-machine/devices          - 设备列表
  /api/ad-machine/devices/{id}/status    - 单台状态
  /api/ad-machine/devices/{id}/heartbeat - 心跳上报
  /api/ad-machine/devices/{id}/playback-log - 播放日志
  /api/ad-machine/stats            - 播放统计
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/ad-machine", tags=["ad-machine"])

APP_DIR = Path(__file__).parent.parent
DB_PATH = APP_DIR / "data" / "retail-core.sqlite3"

# Ensure DB path is absolute
DB_PATH = DB_PATH.resolve()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_tables(conn: sqlite3.Connection) -> None:
    """Run CREATE TABLE IF NOT EXISTS for all ad_machine tables."""
    sql = """
    CREATE TABLE IF NOT EXISTS ad_machine_content (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        media_url TEXT NOT NULL,
        media_type TEXT NOT NULL DEFAULT 'image',
        duration_sec INTEGER NOT NULL DEFAULT 30,
        priority INTEGER NOT NULL DEFAULT 50,
        valid_from TEXT NOT NULL DEFAULT '',
        valid_to TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ad_machine_schedule (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        repeat_rule TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (content_id) REFERENCES ad_machine_content(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ad_machine_device (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE,
        shop_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        current_content_id TEXT,
        screen_status TEXT NOT NULL DEFAULT 'on',
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (current_content_id) REFERENCES ad_machine_content(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ad_machine_playback_log (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        content_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_sec INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        interrupt_reason TEXT
    );
    """
    conn.executescript(sql)
    conn.commit()


# ==================== Pydantic Models ====================


class ContentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    media_url: str = Field(min_length=1, max_length=500)
    media_type: str = Field(default="image", pattern="^(image|video)$")
    duration_sec: int = Field(default=30, ge=1, le=86400)
    priority: int = Field(default=50, ge=1, le=100)
    valid_from: str = Field(default="")
    valid_to: str = Field(default="")


class ContentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    media_url: Optional[str] = Field(default=None, max_length=500)
    media_type: Optional[str] = Field(default=None, pattern="^(image|video)$")
    duration_sec: Optional[int] = Field(default=None, ge=1, le=86400)
    priority: Optional[int] = Field(default=None, ge=1, le=100)
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(active|inactive|archived)$")


class ScheduleCreate(BaseModel):
    content_id: str = Field(min_length=1)
    shop_id: str = Field(min_length=1, max_length=50)
    start_time: str = Field(min_length=1, max_length=5)  # HH:MM
    end_time: str = Field(min_length=1, max_length=5)   # HH:MM
    repeat_rule: str = Field(default="")  # daily | weekdays | YYYY-MM-DD


class DeviceHeartbeat(BaseModel):
    current_content_id: Optional[str] = None
    remaining_sec: int = Field(default=0, ge=0)
    screen_status: str = Field(default="on", pattern="^(on|off|error)$")


class DeviceUpsert(BaseModel):
    device_id: str = Field(min_length=1)
    shop_id: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    status: str = Field(default="offline", pattern="^(online|offline)$")
    current_content_id: Optional[str] = None
    screen_status: str = Field(default="on")


class PlaybackLogQuery(BaseModel):
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


# ==================== Content Routes ====================


@router.get("/contents")
def list_contents(
    status: Optional[str] = Query(default=None, pattern="^(active|inactive|archived)$"),
    shop_id: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """列出所有广告素材，可按 status 过滤。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        sql = "SELECT * FROM ad_machine_content"
        params: list[str] = []
        if status:
            sql += " WHERE status = ?"
            params.append(status)
        sql += " ORDER BY priority DESC, created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        return {
            "ok": True,
            "count": len(rows),
            "items": [dict(r) for r in rows],
        }
    finally:
        conn.close()


@router.post("/contents")
def create_content(payload: ContentCreate) -> dict[str, Any]:
    """新增广告素材。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        now = _now_iso()
        content_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO ad_machine_content
              (id, title, media_url, media_type, duration_sec, priority,
               valid_from, valid_to, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            """,
            (
                content_id,
                payload.title,
                payload.media_url,
                payload.media_type,
                payload.duration_sec,
                payload.priority,
                payload.valid_from,
                payload.valid_to,
                now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ad_machine_content WHERE id = ?", (content_id,)
        ).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        conn.close()


@router.put("/contents/{content_id}")
def update_content(content_id: str, payload: ContentUpdate) -> dict[str, Any]:
    """更新广告素材。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        existing = conn.execute(
            "SELECT * FROM ad_machine_content WHERE id = ?", (content_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Content not found")

        updates: list[str] = []
        params: list[Any] = []
        for field, value in payload.model_dump(exclude_unset=True).items():
            if value is not None:
                updates.append(f"{field} = ?")
                params.append(value)
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        params.append(_now_iso())
        params.append(content_id)
        conn.execute(
            f"UPDATE ad_machine_content SET {', '.join(updates)}, updated_at = ? WHERE id = ?",
            params,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ad_machine_content WHERE id = ?", (content_id,)
        ).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        conn.close()


@router.delete("/contents/{content_id}")
def delete_content(content_id: str) -> dict[str, Any]:
    """软删除广告素材（status=archived）。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        existing = conn.execute(
            "SELECT * FROM ad_machine_content WHERE id = ?", (content_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Content not found")
        conn.execute(
            "UPDATE ad_machine_content SET status = 'archived', updated_at = ? WHERE id = ?",
            (_now_iso(), content_id),
        )
        conn.commit()
        return {"ok": True, "deleted": content_id}
    finally:
        conn.close()


# ==================== Schedule Routes ====================


@router.post("/contents/{content_id}/schedule")
def schedule_content(content_id: str, payload: ScheduleCreate) -> dict[str, Any]:
    """为广告素材创建排期。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        existing = conn.execute(
            "SELECT * FROM ad_machine_content WHERE id = ?", (content_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Content not found")

        now = _now_iso()
        schedule_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO ad_machine_schedule
              (id, content_id, shop_id, start_time, end_time, repeat_rule, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
            """,
            (
                schedule_id,
                content_id,
                payload.shop_id,
                payload.start_time,
                payload.end_time,
                payload.repeat_rule,
                now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ad_machine_schedule WHERE id = ?", (schedule_id,)
        ).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        conn.close()


@router.get("/schedules")
def list_schedules(
    content_id: Optional[str] = Query(default=None),
    shop_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """列出所有排期记录。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        sql = "SELECT * FROM ad_machine_schedule WHERE 1=1"
        params: list[str] = []
        if content_id:
            sql += " AND content_id = ?"
            params.append(content_id)
        if shop_id:
            sql += " AND shop_id = ?"
            params.append(shop_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        return {
            "ok": True,
            "count": len(rows),
            "items": [dict(r) for r in rows],
        }
    finally:
        conn.close()


@router.delete("/schedules/{schedule_id}")
def delete_schedule(schedule_id: str) -> dict[str, Any]:
    """删除排期记录。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        existing = conn.execute(
            "SELECT * FROM ad_machine_schedule WHERE id = ?", (schedule_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Schedule not found")
        conn.execute("DELETE FROM ad_machine_schedule WHERE id = ?", (schedule_id,))
        conn.commit()
        return {"ok": True, "deleted": schedule_id}
    finally:
        conn.close()


# ==================== Device Routes ====================


@router.get("/devices")
def list_devices(
    shop_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """列出所有广告机设备。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        sql = "SELECT * FROM ad_machine_device WHERE 1=1"
        params: list[str] = []
        if shop_id:
            sql += " AND shop_id = ?"
            params.append(shop_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY name"
        rows = conn.execute(sql, params).fetchall()
        return {
            "ok": True,
            "count": len(rows),
            "items": [dict(r) for r in rows],
        }
    finally:
        conn.close()


@router.post("/devices")
def upsert_device(payload: DeviceUpsert) -> dict[str, Any]:
    """注册或更新广告机设备。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        now = _now_iso()
        device_uuid = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO ad_machine_device
              (id, device_id, shop_id, name, status, current_content_id, screen_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
              shop_id = excluded.shop_id,
              name = excluded.name,
              status = excluded.status,
              current_content_id = excluded.current_content_id,
              screen_status = excluded.screen_status,
              updated_at = excluded.updated_at
            """,
            (
                device_uuid,
                payload.device_id,
                payload.shop_id,
                payload.name,
                payload.status,
                payload.current_content_id,
                payload.screen_status,
                now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ad_machine_device WHERE device_id = ?",
            (payload.device_id,),
        ).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        conn.close()


@router.get("/devices/{device_id}/status")
def get_device_status(device_id: str) -> dict[str, Any]:
    """获取单台广告机状态。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        row = conn.execute(
            "SELECT * FROM ad_machine_device WHERE device_id = ?", (device_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")

        # Determine online/offline based on last heartbeat
        last_heartbeat = row["last_heartbeat_at"]
        is_online = False
        if last_heartbeat:
            try:
                hb_time = datetime.fromisoformat(last_heartbeat.replace("Z", "+00:00"))
                age_sec = (datetime.now(timezone.utc) - hb_time).total_seconds()
                is_online = age_sec < 120  # offline if no heartbeat in 2 min
            except Exception:
                is_online = False

        # Get current content
        current_content = None
        if row["current_content_id"]:
            content_row = conn.execute(
                "SELECT * FROM ad_machine_content WHERE id = ?",
                (row["current_content_id"],),
            ).fetchone()
            if content_row:
                current_content = dict(content_row)

        return {
            "ok": True,
            "device": dict(row),
            "is_online": is_online,
            "current_content": current_content,
        }
    finally:
        conn.close()


@router.post("/devices/{device_id}/heartbeat")
def device_heartbeat(device_id: str, payload: DeviceHeartbeat) -> dict[str, Any]:
    """广告机心跳上报。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        now = _now_iso()
        row = conn.execute(
            "SELECT * FROM ad_machine_device WHERE device_id = ?", (device_id,)
        ).fetchone()
        if not row:
            # Auto-register new device
            device_uuid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO ad_machine_device
                  (id, device_id, shop_id, name, status, current_content_id, screen_status, last_heartbeat_at, created_at, updated_at)
                VALUES (?, ?, 'UNKNOWN', ?, 'online', ?, ?, ?, ?, ?)
                """,
                (
                    device_uuid,
                    device_id,
                    f"Device-{device_id[:8]}",
                    payload.current_content_id,
                    payload.screen_status,
                    now,
                    now,
                    now,
                ),
            )
        else:
            # Update existing device
            conn.execute(
                """
                UPDATE ad_machine_device SET
                  status = 'online',
                  current_content_id = ?,
                  screen_status = ?,
                  last_heartbeat_at = ?,
                  updated_at = ?
                WHERE device_id = ?
                """,
                (
                    payload.current_content_id,
                    payload.screen_status,
                    now,
                    now,
                    device_id,
                ),
            )
        conn.commit()

        # Log playback (if content was playing)
        if payload.current_content_id:
            log_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO ad_machine_playback_log
                  (id, device_id, content_id, started_at, completed, interrupt_reason)
                VALUES (?, ?, ?, ?, 0, '')
                """,
                (log_id, device_id, payload.current_content_id, now),
            )
            conn.commit()

        return {"ok": True, "received_at": now}
    finally:
        conn.close()


@router.get("/devices/{device_id}/playback-log")
def get_playback_log(
    device_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """获取设备播放日志。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        rows = conn.execute(
            """
            SELECT * FROM ad_machine_playback_log
            WHERE device_id = ?
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
            """,
            (device_id, limit, offset),
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) as cnt FROM ad_machine_playback_log WHERE device_id = ?",
            (device_id,),
        ).fetchone()["cnt"]
        return {
            "ok": True,
            "count": len(rows),
            "total": total,
            "items": [dict(r) for r in rows],
        }
    finally:
        conn.close()


# ==================== Stats Route ====================


@router.get("/stats")
def get_stats() -> dict[str, Any]:
    """获取播放统计数据：总播放次数、平均时长、异常中断率。"""
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        total_plays = conn.execute(
            "SELECT COUNT(*) as cnt FROM ad_machine_playback_log"
        ).fetchone()["cnt"]

        completed_plays = conn.execute(
            "SELECT COUNT(*) as cnt FROM ad_machine_playback_log WHERE completed = 1"
        ).fetchone()["cnt"]

        total_duration = conn.execute(
            "SELECT SUM(duration_sec) as total FROM ad_machine_playback_log WHERE duration_sec IS NOT NULL"
        ).fetchone()["total"] or 0

        avg_duration = (
            int(total_duration / completed_plays) if completed_plays > 0 else 0
        )

        interrupted_plays = conn.execute(
            "SELECT COUNT(*) as cnt FROM ad_machine_playback_log WHERE completed = 0 AND finished_at IS NOT NULL"
        ).fetchone()["cnt"]

        interrupt_rate = (
            round(interrupted_plays / total_plays * 100, 2) if total_plays > 0 else 0.0
        )

        # Active devices count
        active_devices = conn.execute(
            "SELECT COUNT(*) as cnt FROM ad_machine_device WHERE status = 'online'"
        ).fetchone()["cnt"]

        total_content = conn.execute(
            "SELECT COUNT(*) as cnt FROM ad_machine_content WHERE status = 'active'"
        ).fetchone()["cnt"]

        return {
            "ok": True,
            "total_plays": total_plays,
            "completed_plays": completed_plays,
            "avg_duration_sec": avg_duration,
            "interrupted_plays": interrupted_plays,
            "interrupt_rate_percent": interrupt_rate,
            "active_devices": active_devices,
            "total_active_content": total_content,
        }
    finally:
        conn.close()
