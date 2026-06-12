"""
教育补贴采集 v2 数据迁移 + 升级脚本（2026-06-09）
- 创建 4 张新表（v2_record / calibration_log / performance / evidence）
- ALTER TABLE 旧表加列
- 升级 staff 表 EMP003/004/005/006
- 数据迁移：从 raw_payload_json 提取到新列
- 一次性脚本，运行后保留 v2 表
"""
import sqlite3
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).parent.parent / 'data' / 'retail-core.sqlite3'

MIGRATION_SQL = [
    # v2 主表
    """
    CREATE TABLE IF NOT EXISTS education_scan_record_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT UNIQUE NOT NULL,
      scan_date TEXT NOT NULL,
      scan_timestamp TEXT NOT NULL,
      source_group_name TEXT NOT NULL,
      scan_type TEXT NOT NULL,
      scan_type_label TEXT,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      customer_name TEXT,
      customer_phone TEXT,
      agent_phone TEXT,
      product_name TEXT,
      sku_key TEXT,
      pn_mtm TEXT,
      spec TEXT,
      category TEXT,
      quantity INTEGER DEFAULT 1,
      education_discount_amount REAL DEFAULT 0,
      total_education_discount_amount REAL DEFAULT 0,
      service_fee_per_unit REAL DEFAULT 0,
      total_service_fee REAL DEFAULT 0,
      zhixiangjin_amount REAL DEFAULT 0,
      service_rule_key TEXT,
      service_rule_label TEXT,
      bundle_charge_applied INTEGER DEFAULT 0,
      order_number TEXT,
      outbound_date TEXT,
      outbound_store_name TEXT,
      outbound_operator_name TEXT,
      serial_numbers_json TEXT,
      voucher_code TEXT,
      voucher_verified_at TEXT,
      status TEXT DEFAULT '未付',
      report_status TEXT DEFAULT '本地录入',
      evidence_images_json TEXT,
      ai_calibration_json TEXT,
      ai_calibration_status TEXT,
      ai_calibrated_at TEXT,
      ai_calibrated_by TEXT,
      review_status TEXT DEFAULT 'pending',
      reviewed_at TEXT,
      reviewed_by TEXT,
      sync_status TEXT DEFAULT 'local',
      synced_at TEXT,
      source_file TEXT,
      raw_payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_edu_scan_v2_staff ON education_scan_record_v2(staff_id)",
    "CREATE INDEX IF NOT EXISTS idx_edu_scan_v2_date ON education_scan_record_v2(scan_date)",
    "CREATE INDEX IF NOT EXISTS idx_edu_scan_v2_status ON education_scan_record_v2(status)",
    "CREATE INDEX IF NOT EXISTS idx_edu_scan_v2_group ON education_scan_record_v2(source_group_name)",
    "CREATE INDEX IF NOT EXISTS idx_edu_scan_v2_type ON education_scan_record_v2(scan_type)",
    "CREATE INDEX IF NOT EXISTS idx_edu_scan_v2_sync ON education_scan_record_v2(sync_status)",

    # 校准日志
    """
    CREATE TABLE IF NOT EXISTS education_scan_calibration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL,
      calibration_source TEXT NOT NULL,
      calibration_kind TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      diff_summary TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_edu_calib_log_record ON education_scan_calibration_log(record_id)",

    # 绩效归属
    """
    CREATE TABLE IF NOT EXISTS education_scan_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      scan_date TEXT NOT NULL,
      scan_type TEXT NOT NULL,
      service_fee_attribution REAL DEFAULT 0,
      zhixiangjin_attribution REAL DEFAULT 0,
      total_attribution REAL DEFAULT 0,
      attribution_rule TEXT,
      created_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_edu_perf_staff ON education_scan_performance(staff_id)",
    "CREATE INDEX IF NOT EXISTS idx_edu_perf_date ON education_scan_performance(scan_date)",

    # 证据
    """
    CREATE TABLE IF NOT EXISTS education_scan_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      image_name TEXT,
      image_mime_type TEXT,
      image_size_bytes INTEGER,
      ocr_text TEXT,
      ai_extracted_fields_json TEXT,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_edu_evidence_record ON education_scan_evidence(record_id)",
]

# 升级 staff 表（增加服务顾问和具体姓名）
STAFF_UPGRADES = [
    ('EMP003', '梁伟', 'manager'),
    ('EMP004', '郭楠', 'manager'),
    ('EMP005', '李建定', 'service_advisor'),
    ('EMP006', '郭晨臣', 'service_advisor'),
]

# 旧表加列（如果不存在）
OLD_TABLE_ALTER = [
    ("education_agent_scan_raw",
     "ALTER TABLE education_agent_scan_raw ADD COLUMN service_fee_per_unit REAL DEFAULT 0",
     "service_fee_per_unit"),
    ("education_agent_scan_raw",
     "ALTER TABLE education_agent_scan_raw ADD COLUMN zhixiangjin_amount REAL DEFAULT 0",
     "zhixiangjin_amount"),
]


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def run_migration():
    print(f"=== Education Scan v2 迁移开始 ===")
    print(f"DB: {DB_PATH}")

    if not DB_PATH.exists():
        print(f"❌ DB not found: {DB_PATH}")
        return False

    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row

    try:
        # 1. 创建新表
        for sql in MIGRATION_SQL:
            try:
                conn.execute(sql)
            except sqlite3.OperationalError as e:
                if 'already exists' in str(e):
                    continue
                raise
        print(f"✓ 创建/确认 {len(MIGRATION_SQL)} 个表/索引")

        # 2. 升级旧表加列
        for table, alter_sql, col in OLD_TABLE_ALTER:
            if column_exists(conn, table, col):
                print(f"  ⏭ {table}.{col} 已存在，跳过")
            else:
                conn.execute(alter_sql)
                print(f"  ✓ {table}.{col} 已添加")

        # 3. 数据迁移：从 raw_payload_json 提取金额到新列
        rows = conn.execute(
            "SELECT id, service_fee_per_unit, zhixiangjin_amount, raw_payload_json "
            "FROM education_agent_scan_raw WHERE raw_payload_json IS NOT NULL"
        ).fetchall()
        migrated = 0
        for r in rows:
            try:
                payload = json.loads(r['raw_payload_json'])
                fee = payload.get('serviceFeePerUnit') or payload.get('service_fee_per_unit') or 0
                zxj = payload.get('zhixiangjinAmount') or payload.get('zhixiangjin_amount') or 0
                qty = payload.get('quantity') or 1
                if r['service_fee_per_unit'] == 0 and fee:
                    conn.execute(
                        "UPDATE education_agent_scan_raw SET service_fee_per_unit = ? WHERE id = ?",
                        (fee, r['id'])
                    )
                    migrated += 1
                if r['zhixiangjin_amount'] == 0 and zxj:
                    conn.execute(
                        "UPDATE education_agent_scan_raw SET zhixiangjin_amount = ? WHERE id = ?",
                        (zxj, r['id'])
                    )
                    migrated += 1
            except (json.JSONDecodeError, TypeError):
                continue
        print(f"✓ 数据迁移：{migrated} 行金额字段从 raw_payload_json 提升到列")

        # 4. 升级 staff 表
        for emp_id, name, role in STAFF_UPGRADES:
            existing = conn.execute("SELECT id FROM staff WHERE id = ?", (emp_id,)).fetchone()
            if existing:
                # 更新名字和角色（保留 active）
                conn.execute(
                    "UPDATE staff SET name = ?, role = ? WHERE id = ?",
                    (name, role, emp_id)
                )
                print(f"  ⏭ staff.{emp_id} 已存在，已更新为 {name} ({role})")
            else:
                conn.execute(
                    "INSERT INTO staff (id, name, role, active, created_at) VALUES (?, ?, ?, 1, ?)",
                    (emp_id, name, role, datetime.now(timezone.utc).isoformat())
                )
                print(f"  ✓ staff.{emp_id} = {name} ({role}) 已添加")

        conn.commit()

        # 5. 验证
        v2_count = conn.execute("SELECT COUNT(*) FROM education_scan_record_v2").fetchone()[0]
        v1_count = conn.execute("SELECT COUNT(*) FROM education_agent_scan_raw").fetchone()[0]
        v1_with_fee = conn.execute(
            "SELECT COUNT(*) FROM education_agent_scan_raw WHERE service_fee_per_unit > 0"
        ).fetchone()[0]
        v1_with_zxj = conn.execute(
            "SELECT COUNT(*) FROM education_agent_scan_raw WHERE zhixiangjin_amount > 0"
        ).fetchone()[0]
        staff_count = conn.execute("SELECT COUNT(*) FROM staff").fetchone()[0]

        print(f"\n=== 验证 ===")
        print(f"  v1 education_agent_scan_raw: {v1_count} 行")
        print(f"  v1 with service_fee>0: {v1_with_fee} 行")
        print(f"  v1 with zhixiangjin>0: {v1_with_zxj} 行")
        print(f"  v2 education_scan_record_v2: {v2_count} 行 (待手机端录入)")
        print(f"  staff 总数: {staff_count}")

        return True
    except Exception as e:
        conn.rollback()
        print(f"❌ 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        conn.close()


if __name__ == '__main__':
    success = run_migration()
    sys.exit(0 if success else 1)
