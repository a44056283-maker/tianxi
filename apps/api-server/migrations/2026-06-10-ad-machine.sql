-- 智慧零售广告机系统 Migration
-- 2026-06-10
-- Tables: ad_machine_content, ad_machine_schedule, ad_machine_device, ad_machine_playback_log

BEGIN;

-- 广告素材内容表
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

-- 广告排期表
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

-- 广告机设备表
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

-- 广告播放日志表
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

-- 索引
CREATE INDEX IF NOT EXISTS idx_ad_machine_content_status ON ad_machine_content(status);
CREATE INDEX IF NOT EXISTS idx_ad_machine_content_priority ON ad_machine_content(priority);
CREATE INDEX IF NOT EXISTS idx_ad_machine_schedule_content_id ON ad_machine_schedule(content_id);
CREATE INDEX IF NOT EXISTS idx_ad_machine_schedule_shop_id ON ad_machine_schedule(shop_id);
CREATE INDEX IF NOT EXISTS idx_ad_machine_device_device_id ON ad_machine_device(device_id);
CREATE INDEX IF NOT EXISTS idx_ad_machine_device_shop_id ON ad_machine_device(shop_id);
CREATE INDEX IF NOT EXISTS idx_ad_machine_playback_log_device_id ON ad_machine_playback_log(device_id);
CREATE INDEX IF NOT EXISTS idx_ad_machine_playback_log_content_id ON ad_machine_playback_log(content_id);
CREATE INDEX IF NOT EXISTS idx_ad_machine_playback_log_started_at ON ad_machine_playback_log(started_at);

COMMIT;
