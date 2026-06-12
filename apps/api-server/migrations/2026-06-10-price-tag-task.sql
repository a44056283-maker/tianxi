-- Migration: 2026-06-10-price-tag-task
-- Description: Ensure price_tag_update_task table and indexes exist for electronic price tag sync queue

-- The price_tag_update_task table may already exist (created by retail_core.py init_db).
-- This migration is idempotent — it uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.

-- Main table: stores electronic price tag update tasks
CREATE TABLE IF NOT EXISTS price_tag_update_task (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    sku_key TEXT NOT NULL,
    template_id TEXT NOT NULL,
    price_payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,          -- pending, sending, confirmed, failed
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Index for efficient worker polling (find pending tasks ordered by creation time)
CREATE INDEX IF NOT EXISTS idx_price_tag_task_status_created
ON price_tag_update_task(status, created_at);

-- Index for per-sku lookup (for store-display view)
CREATE INDEX IF NOT EXISTS idx_price_tag_task_sku_key
ON price_tag_update_task(sku_key, updated_at DESC);

-- Index for confirmed/failed status counts in summary
CREATE INDEX IF NOT EXISTS idx_price_tag_task_status
ON price_tag_update_task(status);
