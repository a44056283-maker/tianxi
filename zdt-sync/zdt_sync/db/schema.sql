-- 可选：如果不用 SQLAlchemy create_all，也可以参考这个 SQL 手工建表。
CREATE TABLE IF NOT EXISTS sync_state (
  id BIGSERIAL PRIMARY KEY,
  source_name VARCHAR(64) NOT NULL,
  entity_name VARCHAR(64) NOT NULL,
  cursor_value TEXT,
  last_sync_time TIMESTAMPTZ,
  last_success_time TIMESTAMPTZ,
  last_error TEXT,
  status VARCHAR(32),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_name, entity_name)
);

CREATE TABLE IF NOT EXISTS sync_job (
  id BIGSERIAL PRIMARY KEY,
  source_name VARCHAR(64) NOT NULL DEFAULT 'zhidiantong',
  entity_name VARCHAR(64) NOT NULL,
  job_type VARCHAR(64) NOT NULL DEFAULT 'collect',
  parameters JSONB,
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(32) DEFAULT 'running',
  row_count INTEGER DEFAULT 0,
  error_message TEXT,
  trace_path TEXT,
  screenshot_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_records (
  id BIGSERIAL PRIMARY KEY,
  source_name VARCHAR(64) NOT NULL DEFAULT 'zhidiantong',
  entity_name VARCHAR(64) NOT NULL,
  record_id VARCHAR(128) NOT NULL,
  record_hash VARCHAR(128) NOT NULL,
  store_code VARCHAR(64),
  payload JSONB NOT NULL,
  collected_at TIMESTAMPTZ DEFAULT now(),
  job_id BIGINT,
  is_deleted BOOLEAN DEFAULT false,
  UNIQUE (source_name, entity_name, record_id)
);
