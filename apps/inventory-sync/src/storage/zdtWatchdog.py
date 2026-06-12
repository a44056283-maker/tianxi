#!/usr/bin/env python3
"""
zdtWatchdog.py
看门狗：每5分钟检查 ZDT 同步是否正常。
- 检查 fact_stock_orders 最近采集时间
- 检查 zdtSqliteSync 状态文件更新时间
- 超时则写警告日志并输出醒目提示

运行：python3 zdtWatchdog.py
"""

import os
import json
import datetime
import subprocess

PG_CONN = "postgresql://zdt:zdt@localhost:5432/zdt_sync"
STATE_FILE = "/tmp/zdt_sqlite_sync_state.json"
LOG_FILE  = "/tmp/zdt_watchdog.log"
ALERT_LOG = "/tmp/zdt_watchdog_alert.log"
SQLITE_DB = "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server/data/retail-core.sqlite3"
SYNC_LOG  = "/Users/luxiangnan/Desktop/联想智慧零售项目/智店通采集CLI软件/zdt_sync_openclaw_starter/.sync_log.txt"

WARN_MINUTES = 30  # 超过30分钟未更新则告警


def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def check_pg_freshness():
    """检查 PostgreSQL fact_stock_orders 最近采集时间"""
    try:
        import psycopg
        conn = psycopg.connect(PG_CONN)
        cur = conn.cursor()
        cur.execute("SELECT MAX(collected_at) FROM fact_stock_orders WHERE source_name = 'zhidiantong'")
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[0]:
            last = row[0]
            if hasattr(last, 'timestamp'):
                age_minutes = (datetime.datetime.now(datetime.timezone.utc) - last).total_seconds() / 60
            else:
                age_minutes = (datetime.datetime.now() - last).total_seconds() / 60
            return age_minutes, last
        return None, None
    except Exception as e:
        log(f"PG检查失败: {e}")
        return None, None


def check_sqlite_freshness():
    """检查工程软件 SQLite ZDT 数据最后更新时间"""
    try:
        import sqlite3
        conn = sqlite3.connect(SQLITE_DB, timeout=5)
        cur = conn.cursor()
        cur.execute("SELECT MAX(created_at) FROM inventory_movement WHERE source_system = 'zhidiantong'")
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            try:
                # 处理 ISO 格式 with timezone: 2026-05-29T10:07:08.988587+00:00
                s = row[0].replace(" ", "T").split("+")[0].split(".")[0]
                last = datetime.datetime.fromisoformat(s)
                age_minutes = (datetime.datetime.now() - last).total_seconds() / 60
                return age_minutes, last
            except Exception as ex:
                return None, None
        return None, None
    except Exception as e:
        log(f"SQLite检查失败: {e}")
        return None, None


def check_sync_log_freshness():
    """检查同步日志最后更新时间"""
    try:
        mtime = os.path.getmtime(SYNC_LOG)
        last_update = datetime.datetime.fromtimestamp(mtime)
        age_minutes = (datetime.datetime.now() - last_update).total_seconds() / 60
        return age_minutes, last_update
    except:
        return None, None


def check_state_file():
    """检查 zdtSqliteSync 状态文件"""
    try:
        mtime = os.path.getmtime(STATE_FILE)
        last_update = datetime.datetime.fromtimestamp(mtime)
        age_minutes = (datetime.datetime.now() - last_update).total_seconds() / 60
        with open(STATE_FILE) as f:
            state = json.load(f)
        return age_minutes, last_update, state.get("max_pay_time", "unknown")
    except:
        return None, None, "unknown"


def main():
    now = datetime.datetime.now()
    hour = now.hour
    
    # 工作时间检查（09:00-21:00）
    if hour < 9 or hour >= 21:
        log(f"非工作时间（{hour}:00），跳过检查")
        return

    log("=== ZDT 看门狗检查 ===")

    # 1. PG fact_stock_orders 新鲜度
    pg_age, pg_last = check_pg_freshness()
    if pg_age is not None:
        log(f"PG fact_stock_orders: {pg_age:.1f}分钟前 ({pg_last})")
    else:
        log("PG fact_stock_orders: 无法获取")

    # 2. SQLite ZDT 数据新鲜度
    sq_age, sq_last = check_sqlite_freshness()
    if sq_age is not None:
        log(f"SQLite ZDT数据: {sq_age:.1f}分钟前 ({sq_last})")
    else:
        log("SQLite ZDT数据: 无法获取")

    # 3. 同步日志新鲜度
    log_age, log_last = check_sync_log_freshness()
    if log_age is not None:
        log(f"同步日志: {log_age:.1f}分钟前 ({log_last})")
    else:
        log("同步日志: 无")

    # 4. 状态文件
    sf_age, sf_last, sf_max = check_state_file()
    if sf_age is not None:
        log(f"SQLite同步状态: {sf_age:.1f}分钟前, max_pay_time={sf_max}")
    else:
        log("SQLite同步状态: 无状态文件")

    # 判断是否告警
    alert = False
    reasons = []

    # 只有同步日志超时才告警（cron漏跑）
    # PG 数据超时只记录，不告警（可能只是 ZDT 今天没新数据）
    if log_age is not None and log_age > WARN_MINUTES:
        alert = True
        reasons.append(f"同步日志超过{WARN_MINUTES}分钟未更新(cron可能漏跑)")

    if alert:
        alert_msg = f"🚨 ZDT同步告警: {'; '.join(reasons)}"
        log(alert_msg)
        with open(ALERT_LOG, "a") as f:
            f.write(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] {alert_msg}\n")
    else:
        log("✅ ZDT同步正常，无告警")


if __name__ == "__main__":
    main()
