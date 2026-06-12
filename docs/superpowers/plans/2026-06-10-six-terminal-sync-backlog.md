# 6 终端同步 backlog 收口实施计划

> **Date:** 2026-06-10
> **Agent:** dev-agent (batch 2, S5)
> **Goal:** 补完 6/8 已完成 6 终端同步 dashboard + 手动校准的遗留 backlog

---

## 前置状态

- 计划文档：`docs/superpowers/plans/2026-06-08-six-terminal-sync-dashboard.md` ✅
- 验证报告：`docs/superpowers/plans/2026-06-08-six-terminal-sync-dashboard-verify.md` ✅
- 6 终端同步看板已上线，显示后端事实层，但所有终端状态为 "unknown"（无心跳）

---

## Backlog 1：6 终端心跳上报端点

### 需求
- 新增 `POST /api/local-sync/heartbeat`
- Request: `{terminalId, terminalName, lastFetchedAt, clientDataSignature, status}`
- Response: `{ok: true, terminalId, recordedAt}`
- 存储：`fact_terminal_heartbeat` 表（新建于 `retail-core.sqlite3`）
- 前端 `SixTerminalSyncDashboard` 组件加心跳显示：unknown → live/stale/dead
- 状态判定：lastFetchedAt < 60s = live, < 5min = stale, > 5min = dead

### TDD 用例

```python
# test_heartbeat_endpoint.py

def test_heartbeat_insert():
    # POST /api/local-sync/heartbeat → 200, ok=true, recordedAt 存在
    pass

def test_heartbeat_update_existing():
    # 同一 terminalId 发两次 → 第二次更新 recordedAt，ok=true
    pass

def test_heartbeat_terminal_status_live():
    # lastFetchedAt = now() → status = "live"
    pass

def test_heartbeat_terminal_status_stale():
    # lastFetchedAt = now() - 120s → status = "stale"
    pass

def test_heartbeat_terminal_status_dead():
    # lastFetchedAt = now() - 400s → status = "dead"
    pass

def test_heartbeat_missing_fields():
    # 缺 terminalId → 422
    pass
```

### 实现步骤

- [ ] **Step 1: 建 fact_terminal_heartbeat 表**
  ```sql
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
  ```
  文件：`apps/api-server/app/migrations/001_fact_terminal_heartbeat.sql`

- [ ] **Step 2: 实现 heartbeat 写入函数**

  在 `local_sync.py` 新增 `record_terminal_heartbeat()`:
  - UPSERT `fact_terminal_heartbeat`
  - 从 `lastFetchedAt` 计算 `raw_status`（live/stale/dead/unknown）
  - 返回 `{ok, terminalId, recordedAt}`

- [ ] **Step 3: 新增 POST /api/local-sync/heartbeat 路由**

  在 `main.py` 新增端点，调用 `local_sync.record_terminal_heartbeat()`

- [ ] **Step 4: 修改 `compute_six_terminal_status()` 读心跳表**

  从 SQLite 读取每个终端最新心跳，更新 `terminals[].lastFetchedAt / clientDataSignature / lag`

- [ ] **Step 5: 单元测试**

  `apps/api-server/tests/test_heartbeat.py`（创建 tests 目录如不存在）

- [ ] **Step 6: API 验证**

  ```bash
  curl -s -X POST http://127.0.0.1:8000/api/local-sync/heartbeat \
    -H "Content-Type: application/json" \
    -d '{"terminalId":"retailHome","terminalName":"零售卡前端","lastFetchedAt":"2026-06-10T12:00:00Z","clientDataSignature":"abc123","status":"live"}'
  # → {"ok":true,"terminalId":"retailHome","recordedAt":"..."}
  ```

---

## Backlog 2：inventory-master-sync 非零退出处理

### 需求
- Codex 记忆里有 `allowNonZeroExit` 稳定盾牌
- 子进程退出码 1，但 stdout 含有效 JSON（`lastInventoryMaster` signature 存在）时
- 返回 `status: executed_not_closed` 而不是 `failed`

### TDD 用例

```python
# test_non_zero_exit.py

def test_non_zero_exit_with_valid_json():
    # exitCode=1, stdout=有效JSON → status="executed_not_closed", ok=true
    pass

def test_zero_exit_with_valid_json():
    # exitCode=0, stdout=有效JSON → status="completed", ok=true
    pass

def test_non_zero_exit_with_invalid_json():
    # exitCode=1, stdout=无效 → status="failed", ok=false
    pass
```

### 实现步骤

- [ ] **Step 1: 修改 `ensure_inventory_master_sync` 状态判定逻辑**

  文件：`apps/api-server/app/local_sync.py`，约 line 607

  原逻辑：
  ```python
  report_status = str(report.get("status") or "").strip() or \
      ("completed" if report.get("exitCode", 0) == 0 else "failed")
  ```

  新逻辑：
  ```python
  exit_code = report.get("exitCode", 0)
  json_valid = isinstance(report.get("lastInventoryMaster"), dict)
  if exit_code != 0 and json_valid:
      report_status = "executed_not_closed"
  else:
      report_status = str(report.get("status") or "").strip() or \
          ("completed" if exit_code == 0 else "failed")
  ```

- [ ] **Step 2: 单元测试**

  `apps/api-server/tests/test_non_zero_exit.py`

- [ ] **Step 3: 验证**

  ```bash
  # 手动触发 inventory-master-sync，观察 status
  ```

---

## Backlog 3：ad-machine interval 可配置

### 需求
- `AD_MACHINE_INTERVAL_MS` 环境变量控制刷新间隔
- 默认 1800000ms（30 分钟）
- 设置 `AD_MACHINE_INTERVAL_MS=5000` 立即 refresh 测试

### TDD 用例

```python
# test_ad_machine_interval.py

def test_default_interval():
    # 无环境变量 → 1800000
    pass

def test_custom_interval():
    # AD_MACHINE_INTERVAL_MS=5000 → 5000
    pass

def test_interval_bounds():
    # < 5000 → clamp to 5000
    # > 86400000 → clamp to 86400000
    pass
```

### 实现步骤

- [ ] **Step 1: 读取环境变量**

  在 `main.py` 中约 line 47 附近，从 `os.environ.get("AD_MACHINE_INTERVAL_MS")` 读取

  ```python
  AD_MACHINE_INTERVAL_MS: int = int(os.environ.get("AD_MACHINE_INTERVAL_MS", "1800000"))
  AD_MACHINE_INTERVAL_MS = max(5000, min(AD_MACHINE_INTERVAL_MS, 86400000))
  ```

- [ ] **Step 2: API 返回当前 interval**

  在 `GET /api/ad-machine/admin-config` 响应中加入 `autoRefreshIntervalMs`（已有字段）

- [ ] **Step 3: 验证**

  ```bash
  AD_MACHINE_INTERVAL_MS=5000 uv run fastapi dev app/main.py &
  curl -s http://127.0.0.1:8000/api/ad-machine/admin-config | python3 -m json.tool | grep autoRefreshIntervalMs
  # → 5000
  ```

---

## 实施顺序

1. Backlog 1（心跳端点）+ SQL 表
2. Backlog 2（非零退出处理）
3. Backlog 3（ad-machine interval）

---

## 验收条件

- [ ] `pnpm build` 退出码 0
- [ ] backend API 测试 200 OK
- [ ] 单元测试通过
- [ ] receipt JSON 归档
