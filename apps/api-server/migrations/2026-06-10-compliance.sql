-- Migration: 2026-06-10-compliance
-- 合规校验预警系统：规则注册表、违规记录表、预警记录表

BEGIN;

-- ============================================================
-- 规则注册表
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance_rule (
    id              TEXT PRIMARY KEY,
    rule_id         TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    entity_type     TEXT NOT NULL DEFAULT '',
    enabled         INTEGER NOT NULL DEFAULT 1,
    config_json     TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compliance_rule_rule_id ON compliance_rule(rule_id);
CREATE INDEX IF NOT EXISTS idx_compliance_rule_enabled ON compliance_rule(enabled);
CREATE INDEX IF NOT EXISTS idx_compliance_rule_severity ON compliance_rule(severity);

-- ============================================================
-- 违规记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance_violation (
    id              TEXT PRIMARY KEY,
    rule_id         TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    detected_at     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'acknowledged', 'resolved')),
    assigned_to     TEXT NOT NULL DEFAULT '',
    resolved_at     TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    scan_run_id     TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (rule_id) REFERENCES compliance_rule(rule_id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_violation_rule_id  ON compliance_violation(rule_id);
CREATE INDEX IF NOT EXISTS idx_compliance_violation_severity ON compliance_violation(severity);
CREATE INDEX IF NOT EXISTS idx_compliance_violation_status  ON compliance_violation(status);
CREATE INDEX IF NOT EXISTS idx_compliance_violation_entity  ON compliance_violation(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_compliance_violation_detected ON compliance_violation(detected_at);
CREATE INDEX IF NOT EXISTS idx_compliance_violation_scan_run ON compliance_violation(scan_run_id);

-- ============================================================
-- 预警记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance_alert (
    id              TEXT PRIMARY KEY,
    violation_id    TEXT NOT NULL,
    channel         TEXT NOT NULL CHECK (channel IN ('wechat', 'sms', 'in_app', 'email')),
    recipient       TEXT NOT NULL,
    message         TEXT NOT NULL DEFAULT '',
    sent_at         TEXT NOT NULL,
    acknowledged_at TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'acknowledged', 'failed')),
    error_message   TEXT NOT NULL DEFAULT '',
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (violation_id) REFERENCES compliance_violation(id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_alert_violation  ON compliance_alert(violation_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alert_channel     ON compliance_alert(channel);
CREATE INDEX IF NOT EXISTS idx_compliance_alert_status      ON compliance_alert(status);
CREATE INDEX IF NOT EXISTS idx_compliance_alert_recipient   ON compliance_alert(recipient);
CREATE INDEX IF NOT EXISTS idx_compliance_alert_sent_at     ON compliance_alert(sent_at);

-- ============================================================
-- 预置规则种子数据（5个核心规则）
-- ============================================================
INSERT OR IGNORE INTO compliance_rule (id, rule_id, name, description, severity, entity_type, enabled, config_json, created_at, updated_at)
VALUES
(
    'rule-001',
    'sn_status_inconsistency',
    'SN状态一致性检测',
    'serial_item.status 与 sales_order_line.serial_number 关联状态不一致，例如 SN 已标记 sold 但流水未出库',
    'critical',
    'serial_item',
    1,
    '{}',
    (datetime('now')),
    (datetime('now'))
),
(
    'rule-002',
    'inventory_movement_mismatch',
    '库存数 vs 流水一致性检测',
    'inventory_movement 净变化与当前 SKU 库存数量不一致',
    'high',
    'sku',
    1,
    '{}',
    (datetime('now')),
    (datetime('now'))
),
(
    'rule-003',
    'retail_price_violation',
    '零售价规则违反检测',
    '价格不以99结尾、价格低于成本价、价格超过国补上限（待配置阈值）',
    'high',
    'sku',
    1,
    '{"price_suffix_required": true, "min_margin_bps": 0, "national_subsidy_ceiling": null}',
    (datetime('now')),
    (datetime('now'))
),
(
    'rule-004',
    'purchase_price_anomaly',
    '采购价异常检测',
    'purchase_order_line.unit_cost 偏离同类商品（相同 category/pn_mtm）均值超过 30%',
    'medium',
    'purchase_order_line',
    1,
    '{"deviation_threshold_pct": 30}',
    (datetime('now')),
    (datetime('now'))
),
(
    'rule-005',
    'education_subsidy_violation',
    '教育补/营销活动合规检测',
    'education_scan_record_v2 价格超出活动范围、SN 未匹配、或折扣超出允许范围',
    'high',
    'education_scan_record_v2',
    1,
    '{}',
    (datetime('now')),
    (datetime('now'))
);

COMMIT;
