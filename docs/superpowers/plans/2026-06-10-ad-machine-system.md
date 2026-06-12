# Plan: 智慧零售广告机系统
**Date:** 2026-06-10
**Agent:** ad-machine-agent (S7, batch 2)
**Status:** TDD-first

---

## Context

联想智慧零售广告机内容同步系统：定期从云端拉取广告素材 → 推送到店内广告机 → 监控播放状态。

- 项目目录：`/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`
- 后端：`apps/api-server/` (FastAPI, port 8000)
- 前端：`apps/web-cockpit/` (React + Vite, port 5174)
- 数据库：`apps/api-server/data/retail-core.sqlite3`

---

## Goal 1: 广告内容管理 API

### New file: `apps/api-server/app/ad_machine_api.py`

**Database Tables:**

```sql
-- ad_machine_content
CREATE TABLE ad_machine_content (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image',  -- image | video
  duration_sec INTEGER NOT NULL DEFAULT 30,
  priority INTEGER NOT NULL DEFAULT 50,
  valid_from TEXT,
  valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | inactive | archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ad_machine_schedule
CREATE TABLE ad_machine_schedule (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  repeat_rule TEXT NOT NULL DEFAULT '',  -- e.g. "daily", "weekdays", "2026-06-10"
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (content_id) REFERENCES ad_machine_content(id)
);

-- ad_machine_device
CREATE TABLE ad_machine_device (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  shop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',  -- online | offline
  current_content_id TEXT,
  screen_status TEXT NOT NULL DEFAULT 'on',  -- on | off | error
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ad_machine_playback_log
CREATE TABLE ad_machine_playback_log (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_sec INTEGER,
  completed BOOLEAN NOT NULL DEFAULT 0,
  interrupt_reason TEXT
);
```

**API Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ad-machine/contents` | 列出所有广告素材 |
| POST | `/api/ad-machine/contents` | 新增广告 |
| PUT | `/api/ad-machine/contents/{id}` | 更新广告 |
| DELETE | `/api/ad-machine/contents/{id}` | 软删除（status=archived）|
| POST | `/api/ad-machine/contents/{id}/schedule` | 排期（按门店+时段）|
| GET | `/api/ad-machine/schedules` | 列出所有排期 |
| GET | `/api/ad-machine/devices` | 列出所有广告机 |
| GET | `/api/ad-machine/devices/{deviceId}/status` | 单台状态 |
| POST | `/api/ad-machine/devices/{deviceId}/heartbeat` | 心跳上报 |
| GET | `/api/ad-machine/devices/{deviceId}/playback-log` | 播放日志 |
| GET | `/api/ad-machine/stats` | 播放统计 |

**Request/Response Models (Pydantic):**

```python
class ContentCreate(BaseModel):
    title: str
    media_url: str
    media_type: str = "image"
    duration_sec: int = 30
    priority: int = 50
    valid_from: str = ""
    valid_to: str = ""

class ContentUpdate(BaseModel):
    title: Optional[str] = None
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    duration_sec: Optional[int] = None
    priority: Optional[int] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    status: Optional[str] = None

class ScheduleCreate(BaseModel):
    content_id: str
    shop_id: str
    start_time: str  # HH:MM
    end_time: str    # HH:MM
    repeat_rule: str = ""

class DeviceHeartbeat(BaseModel):
    current_content_id: Optional[str] = None
    remaining_sec: int = 0
    screen_status: str = "on"
```

---

## Goal 2: 广告机状态上报

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ad-machine/devices/{deviceId}/heartbeat` | 心跳 |
| GET | `/api/ad-machine/devices` | 设备列表 |
| GET | `/api/ad-machine/devices/{deviceId}/status` | 单台状态 |
| GET | `/api/ad-machine/devices/{deviceId}/playback-log` | 播放日志 |

Heartbeat updates: `last_heartbeat_at`, `current_content_id`, `screen_status` on device record.

---

## Goal 3: 前端 AdMachineManager 组件

**New file:** `apps/web-cockpit/src/components/AdMachineManager.tsx`

Sections:
1. **内容列表** - 表格：标题、类型、有效期、状态、操作（编辑/删除/排期）
2. **排期日历** - 按门店 + 日期 + 时段可视化
3. **设备监控网格** - 每台设备一张卡片：在线/离线 + 当前内容 + 播放进度
4. **播放统计** - 总播放次数、平均时长、异常中断率

---

## Goal 4: 同步 interval 可配置

**File:** `apps/inventory-sync/src/ad_machine_sync.ts` (new)

```typescript
const AD_MACHINE_INTERVAL_MS = parseInt(
  process.env['AD_MACHINE_INTERVAL_MS'] ?? '1800000', // 30 min default
)
```

- Default: 1800000ms (30 minutes)
- Test value: 5000ms (for immediate refresh testing)

---

## File Manifest

| File | Action |
|------|--------|
| `apps/api-server/app/ad_machine_api.py` | CREATE |
| `apps/api-server/app/main.py` | EDIT (register router) |
| `apps/api-server/migrations/2026-06-10-ad-machine.sql` | CREATE |
| `apps/web-cockpit/src/components/AdMachineManager.tsx` | CREATE |
| `apps/inventory-sync/src/ad_machine_sync.ts` | CREATE |
| `apps/inventory-sync/test/ad_machine_interval.test.ts` | CREATE |
| `docs/superpowers/plans/2026-06-10-ad-machine-system.md` | CREATE |
| `apps/inventory-sync/artifacts/manual/openclaw/receipts/ad-machine-agent-2026-06-10-1224.json` | CREATE |

---

## Verification

1. **Backend API:** `curl http://127.0.0.1:8000/api/ad-machine/contents` → 200 OK
2. **Frontend build:** `cd apps/web-cockpit && pnpm run build` → exit 0
3. **Interval test:** Set `AD_MACHINE_INTERVAL_MS=5000`, confirm 2 runs within 30s
4. **Screenshot:** AdMachineManager renders without console errors

---

## TDD Test Cases

### Backend (pytest)
- `test_ad_machine_content_crud` - create/read/update/delete content
- `test_ad_machine_schedule_crud` - create/read/delete schedule
- `test_ad_machine_device_heartbeat` - heartbeat updates device record
- `test_ad_machine_playback_log` - log entries created
- `test_ad_machine_stats` - stats aggregation correct

### Frontend (vitest)
- `AdMachineManager renders content table`
- `AdMachineManager renders device grid`
- `AdMachineManager handles heartbeat submission`

### Sync (vitest)
- `ad_machine_interval uses env var`
- `ad_machine_interval defaults to 1800000`
- `ad_machine_interval test mode fires twice in 30s`

---

## Constraints

- NO `latest-*.json` writes
- NO Chrome automation
- NO real collection runs
- Use existing `retail-core.sqlite3` via `retail_core.connect()`
- Reuse logged-in Chrome session on `127.0.0.1:9222` if needed (profile: `user`)
