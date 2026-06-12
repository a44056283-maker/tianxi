-- Migration: 001_fact_terminal_heartbeat
-- Description: Create fact_terminal_heartbeat table for 6-terminal heartbeat tracking
-- Created: 2026-06-10

CREATE TABLE IF NOT EXISTS fact_terminal_heartbeat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id TEXT NOT NULL UNIQUE,
    terminal_name TEXT NOT NULL DEFAULT '',
    last_fetched_at TEXT NOT NULL DEFAULT '',
    client_data_signature TEXT NOT NULL DEFAULT '',
    raw_status TEXT NOT NULL DEFAULT '',
    recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fact_hb_terminal ON fact_terminal_heartbeat(terminal_id);
CREATE INDEX IF NOT EXISTS idx_fact_hb_recorded ON fact_terminal_heartbeat(recorded_at DESC);
