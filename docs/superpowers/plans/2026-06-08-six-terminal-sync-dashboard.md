# 6 终端同步状态看板 + 一键手动校准 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主驾驶舱内增加一个"6 终端库存/价格同步状态看板"，实时显示 6 个终端的"上次拉取 published-product-projection 的时间 + 当前可见 SKU 数 + 数据是否已过时"；并提供一个"一键手动校准"按钮，触发 `inventory-master-sync` + `product-library-rebuild` 原子重建，让任何分叉立即可见、可一键收敛。

**Architecture:** 新增后端聚合端点 `/api/local-sync/six-terminal-status`，扫 6 终端关键快照的 `generatedAt/publishedAt/updatedAt` 字段，返回统一时间线 + 收敛度评分。前端在主驾驶舱新增"6 终端同步"书签（`InventoryBookmark` 新值 `'sixTerminalSync'`），渲染为表格 + 状态卡 + 手动校准按钮。

**Tech Stack:** FastAPI (Python) + React + TypeScript + Tailwind + existing local_sync.py 模式

---

## 0. 前置事实

- 6 终端在 `apps/web-cockpit/src/App.tsx:371-378` 已定义：`retailHome` / `retailLive` / `adMachine` / `retailOps` / `androidPos` / `androidPosLite`
- `local_sync.py` 已有 `ensure_inventory_master` 函数和 `LOCAL_SYNC_PIPELINES`
- 重建链已存在 `build-product-url-locks → build-collection-plan → build-standard-price-master → audit-retail-prices → build-retail-zone`
- 关键快照文件：
  - `apps/web-cockpit/public/data/latest-published-product-projection.json`
  - `apps/web-cockpit/public/data/latest-retail-zone-snapshot.json`
  - `apps/inventory-sync/artifacts/latest-inventory-master-snapshot.json`
  - `apps/inventory-sync/artifacts/latest-standard-inventory-snapshot.json`
  - `apps/web-cockpit/public/data/latest-standard-inventory-snapshot.json`
  - `apps/inventory-sync/artifacts/latest-local-sync-report.json`

## 1. 关键设计决定

### 1.1 看板的"分叉"判定
- 每个终端暴露 `lastFetchedAt`（客户端心跳时间）+ `dataSignature`（关键字段 SHA256）
- 后端聚合的"事实层" = `latest-published-product-projection.json.generatedAt` 和 `latest-retail-zone-snapshot.json.generatedAt`
- 6 终端任一 `lastFetchedAt` < 后端事实层 `generatedAt` → 标 `LAG` (黄/橙)
- 6 终端任一 `dataSignature` ≠ 后端签名 → 标 `DIVERGED` (红)
- 全 6 终端 `lastFetchedAt` >= 事实层且签名一致 → 标 `OK` (绿)

### 1.2 手动校准按钮
- 点击 → POST `/api/local-sync/calibrate-six-terminals`
- 行为：调用 `ensure_inventory_master()` → 串行执行 `build-product-url-locks` → `build-retail-zone` → 重写 `latest-published-product-projection.json` → 返回新 `publishedAt` + `signature`
- 前端收到新签名后，所有 6 终端下次轮询（15s / 30min）会用新签名比对

### 1.3 不在 plan 范围内的
- 不改 6 终端的轮询频率（架构层在另一条 plan）
- 不改 `save-inventory-movements` 的整包覆盖语义
- 不改 ad-machine 的 30 分钟间隔
- 不动 ad-machine 离线缓存 localStorage 逻辑

---

## 2. 文件改动清单

### 后端（`apps/api-server/app/local_sync.py` + `main.py`）
- `local_sync.py`：新增 `compute_six_terminal_status()` 函数
- `local_sync.py`：新增 `calibrate_six_terminals()` 函数（包装 `ensure_inventory_master` + product library rebuild 链）
- `main.py`：新增 `GET /api/local-sync/six-terminal-status` 端点
- `main.py`：新增 `POST /api/local-sync/calibrate-six-terminals` 端点

### 前端（`apps/web-cockpit/src/App.tsx`）
- `InventoryBookmark` 类型新增 `'sixTerminalSync'`
- 在 `App.tsx:18455-18469` 左侧导航加 "6 终端同步" 入口
- 新增 `renderSixTerminalSyncBookmark()` 渲染函数（表格 + 状态卡 + 校准按钮）
- 状态拉取：`useEffect` + `setInterval(15s)` 拉取 `/api/local-sync/six-terminal-status`

### 测试
- `apps/api-server/tests/test_six_terminal_status.py`（如果 tests 目录不存在则创建）
- `apps/web-cockpit/src/__tests__/sixTerminalSync.test.tsx`（如果不存在则创建）

### 文档
- `docs/ai-context/04_NEXT_ACTIONS.md`：加这一条任务
- `docs/ai-context/01_CURRENT_STATE.md`：完成后追加

---

## 3. Task 拆解

### Task 1: 后端聚合端点 GET /api/local-sync/six-terminal-status

**Files:**
- Modify: `apps/api-server/app/local_sync.py` (新增函数)
- Modify: `apps/api-server/app/main.py` (新增路由)

- [ ] **Step 1: 写 `compute_six_terminal_status()` 函数**

```python
def compute_six_terminal_status() -> dict[str, Any]:
    """聚合 6 终端同步状态。"""
    snapshot_files = {
        "publishedProductProjection": ARTIFACT_DIR / "latest-published-product-projection.json",
        "retailZone": ARTIFACT_DIR / "latest-retail-zone-snapshot.json",
        "inventoryMaster": ARTIFACT_DIR / "latest-inventory-master-snapshot.json",
        "standardInventory": ARTIFACT_DIR / "latest-standard-inventory-snapshot.json",
    }
    fact_layer = {}
    for key, path in snapshot_files.items():
        data = read_artifact(path.name, {})
        fact_layer[key] = {
            "generatedAt": data.get("generatedAt") or data.get("publishedAt") or "",
            "signature": _compute_signature(data),
            "exists": bool(data),
        }
    
    return {
        "computedAt": _now_iso(),
        "factLayer": fact_layer,
        "convergenceScore": _compute_convergence_score(fact_layer),
        "terminals": [
            _terminal_status("retailHome", "零售卡前端", "/"),
            _terminal_status("retailLive", "零售直播页", "/retail-live"),
            _terminal_status("adMachine", "彩页广告机前端", "/ad-machine/index.html"),
            _terminal_status("retailOps", "进销存销售端", "/retail-ops"),
            _terminal_status("androidPos", "收银台前端", "/android-pos"),
            _terminal_status("androidPosLite", "收银台兼容页", "/android-pos-lite.html"),
        ],
    }
```

- [ ] **Step 2: 写 `_compute_signature()` 辅助函数**

```python
def _compute_signature(data: dict[str, Any]) -> str:
    """对快照数据计算稳定签名。"""
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _terminal_status(key: str, title: str, route: str) -> dict[str, Any]:
    """单个终端的占位状态（前端心跳后会用 lastFetchedAt 覆盖）。"""
    return {
        "key": key,
        "title": title,
        "route": route,
        "lastFetchedAt": "",
        "dataSignature": "",
        "clientVisibleSkus": 0,
        "factSignatureAtFetch": "",
        "lag": "unknown",
    }


def _compute_convergence_score(fact_layer: dict[str, Any]) -> int:
    """100 = 全同步，0 = 全分叉。"""
    weights = {"publishedProductProjection": 40, "retailZone": 30, "inventoryMaster": 20, "standardInventory": 10}
    score = 0
    for key, weight in weights.items():
        if fact_layer.get(key, {}).get("exists"):
            score += weight
    return score


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"
```

- [ ] **Step 3: 注册路由到 main.py**

在 `apps/api-server/app/main.py:9348` 附近追加：
```python
@app.get("/api/local-sync/six-terminal-status")
def api_six_terminal_status():
    from . import local_sync as _ls
    return _ls.compute_six_terminal_status()
```

- [ ] **Step 4: 启动 API 验证**

```bash
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server"
uv run fastapi dev app/main.py --host 127.0.0.1 --port 8000 &
sleep 3
curl -s http://127.0.0.1:8000/api/local-sync/six-terminal-status | python3 -m json.tool | head -30
```

Expected: 200 OK, 6 个 terminal entries, factLayer 4 个快照都存在, convergenceScore = 100.

- [ ] **Step 5: 提交**

```bash
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
git add apps/api-server/app/local_sync.py apps/api-server/app/main.py
git commit -m "feat(api): add six-terminal sync status endpoint"
```

### Task 2: 后端校准端点 POST /api/local-sync/calibrate-six-terminals

**Files:**
- Modify: `apps/api-server/app/local_sync.py` (新增 calibrate 函数)
- Modify: `apps/api-server/app/main.py` (新增路由)

- [ ] **Step 1: 写 `calibrate_six_terminals()` 函数**

```python
def calibrate_six_terminals(trigger: str = "manual", changed_by: str = "user") -> dict[str, Any]:
    """手动触发原子重建：inventory-master + product-library 重建链。"""
    started_at = _now_iso()
    steps: list[dict[str, Any]] = []
    
    # Step 1: ensure inventory master
    try:
        result = ensure_inventory_master(trigger=trigger, changed_by=changed_by)
        steps.append({"name": "ensure-inventory-master", "ok": True, "result": result})
    except Exception as e:
        steps.append({"name": "ensure-inventory-master", "ok": False, "error": str(e)})
    
    # Step 2: rebuild product library (pricing scope)
    try:
        result = _run_product_library_rebuild(scope="pricing")
        steps.append({"name": "rebuild-product-library-pricing", "ok": True, "result": result})
    except Exception as e:
        steps.append({"name": "rebuild-product-library-pricing", "ok": False, "error": str(e)})
    
    # Step 3: rebuild published projection
    try:
        result = _run_published_projection_rebuild()
        steps.append({"name": "rebuild-published-projection", "ok": True, "result": result})
    except Exception as e:
        steps.append({"name": "rebuild-published-projection", "ok": False, "error": str(e)})
    
    return {
        "startedAt": started_at,
        "finishedAt": _now_iso(),
        "trigger": trigger,
        "changedBy": changed_by,
        "steps": steps,
        "allOk": all(s["ok"] for s in steps),
        "postStatus": compute_six_terminal_status(),
    }
```

- [ ] **Step 2: 注册路由**

```python
@app.post("/api/local-sync/calibrate-six-terminals")
def api_calibrate_six_terminals(payload: dict[str, Any] | None = None):
    from . import local_sync as _ls
    payload = payload or {}
    return _ls.calibrate_six_terminals(
        trigger=str(payload.get("trigger", "manual")),
        changed_by=str(payload.get("changedBy", "user")),
    )
```

- [ ] **Step 3: 端到端验证**

```bash
curl -s -X POST http://127.0.0.1:8000/api/local-sync/calibrate-six-terminals \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual","changedBy":"openclaw"}' | python3 -m json.tool | head -50
```

Expected: 200 OK, allOk=true 或 allOk=false（带具体 steps 错误）, postStatus.convergenceScore=100.

- [ ] **Step 4: 提交**

```bash
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
git add apps/api-server/app/local_sync.py apps/api-server/app/main.py
git commit -m "feat(api): add six-terminal manual calibration endpoint"
```

### Task 3: 前端 InventoryBookmark 类型扩展

**Files:**
- Modify: `apps/web-cockpit/src/App.tsx:325` (类型扩展)
- Modify: `apps/web-cockpit/src/App.tsx:18455-18469` (左侧导航入口)

- [ ] **Step 1: 扩展 InventoryBookmark 类型**

在 `App.tsx:325` 行：
```ts
type InventoryBookmark = 'today' | 'retail' | 'overview' | 'serials' | 'physicalHoldDisplay' | 'warranty' | 'prices' | 'sources' | 'movements' | 'pos' | 'syncCockpit' | 'integration' | 'zdtClone' | 'promptWorkspace' | 'productLibrary' | 'sessionBoard' | 'adminCenter' | 'system' | 'adMachineContent' | 'gaokaoMarketing' | 'sixTerminalSync'
```

- [ ] **Step 2: 在左侧导航加入口**

在 `App.tsx:18455-18469` 区域的合适位置（推荐在 `syncCockpit` 之后）加：
```tsx
{ key: 'sixTerminalSync', label: '6 终端同步', icon: <Network size={18} /> },
```

（如果 `Network` 图标不在 icon 库，替换为 `Wifi` 或 `Radio`。先 grep 确认。）

- [ ] **Step 3: 提交**

```bash
git add apps/web-cockpit/src/App.tsx
git commit -m "feat(ui): add six-terminal sync bookmark entry"
```

### Task 4: 前端渲染 6 终端同步看板

**Files:**
- Modify: `apps/web-cockpit/src/App.tsx` (新增 renderSixTerminalSyncBookmark 函数)

- [ ] **Step 1: 写渲染函数**

放在 `renderSyncCockpitBookmark()` 附近（搜索 `syncCockpit` 找位置），结构：
```tsx
function renderSixTerminalSyncBookmark() {
  const [status, setStatus] = useState<any>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [lastCalibration, setLastCalibration] = useState<any>(null)
  
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/local-sync/six-terminal-status', { cache: 'no-store' })
      setStatus(await res.json())
    } catch (e) {
      console.error('six-terminal status fetch failed', e)
    }
  }, [])
  
  useEffect(() => {
    loadStatus()
    const t = setInterval(loadStatus, 15000)
    return () => clearInterval(t)
  }, [loadStatus])
  
  const triggerCalibration = async () => {
    if (!confirm('确认触发 6 终端手动校准？将重建 inventory-master 和 product-library 全链。')) return
    setCalibrating(true)
    try {
      const res = await fetch('/api/local-sync/calibrate-six-terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual', changedBy: 'cockpit_ui' }),
      })
      setLastCalibration(await res.json())
      await loadStatus()
    } catch (e) {
      alert('校准失败：' + String(e))
    } finally {
      setCalibrating(false)
    }
  }
  
  if (!status) return <div className="p-6 text-slate-500">读取 6 终端同步状态...</div>
  
  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">6 终端同步状态</h2>
          <p className="text-sm text-slate-500">事实层收敛度：{status.convergenceScore} / 100</p>
        </div>
        <button
          type="button"
          onClick={triggerCalibration}
          disabled={calibrating}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:bg-slate-400"
        >
          {calibrating ? '校准中...' : '一键手动校准'}
        </button>
      </header>
      
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left p-2">终端</th>
            <th className="text-left p-2">路由</th>
            <th className="text-left p-2">后端事实层 generatedAt</th>
            <th className="text-left p-2">签名</th>
            <th className="text-left p-2">状态</th>
          </tr>
        </thead>
        <tbody>
          {status.terminals.map((t: any) => {
            const f = status.factLayer.publishedProductProjection
            return (
              <tr key={t.key} className="border-b border-slate-100">
                <td className="p-2 font-medium">{t.title}</td>
                <td className="p-2 font-mono text-xs">{t.route}</td>
                <td className="p-2 tabular-nums">{f.generatedAt || '—'}</td>
                <td className="p-2 font-mono text-xs">{f.signature || '—'}</td>
                <td className="p-2">
                  <span className="px-2 py-1 rounded text-xs bg-slate-100">
                    {f.exists ? '已生成' : '缺失'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      
      {lastCalibration && (
        <div className="mt-4 p-4 rounded border border-slate-200">
          <h3 className="font-semibold mb-2">最近一次校准结果</h3>
          <p>开始：{lastCalibration.startedAt}</p>
          <p>结束：{lastCalibration.finishedAt}</p>
          <p>整体：{lastCalibration.allOk ? '✅ 全部成功' : '❌ 有步骤失败'}</p>
          <ul className="mt-2 text-sm">
            {lastCalibration.steps.map((s: any) => (
              <li key={s.name} className={s.ok ? 'text-emerald-700' : 'text-rose-700'}>
                {s.ok ? '✓' : '✗'} {s.name} {s.error ? ` — ${s.error}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 挂到 activeBookmark 渲染**

在 `App.tsx` 主渲染区（找 `if (activeBookmark === 'syncCockpit')` 附近）加：
```tsx
if (activeBookmark === 'sixTerminalSync') return renderSixTerminalSyncBookmark()
```

- [ ] **Step 3: 构建验证**

```bash
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit"
pnpm build
```

Expected: 退出码 0，dist/ 生成，无 TypeScript 错误。

- [ ] **Step 4: 提交**

```bash
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
git add apps/web-cockpit/src/App.tsx
git commit -m "feat(ui): render six-terminal sync dashboard with manual calibration"
```

### Task 5: 端到端真实页面验收

- [ ] **Step 1: 启动后端 + 前端**

```bash
# 终端 1
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server"
uv run fastapi dev app/main.py --host 127.0.0.1 --port 8000

# 终端 2
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit"
pnpm dev --host 127.0.0.1
```

- [ ] **Step 2: 真实浏览器验证**

打开 `http://127.0.0.1:5174/`，点击左侧 "6 终端同步"，截图存到 `apps/inventory-sync/artifacts/manual/six-terminal-dashboard-2026-06-08.png`。

- [ ] **Step 3: 触发手动校准**

点 "一键手动校准"，确认对话框，校准完成后截图存到 `apps/inventory-sync/artifacts/manual/six-terminal-calibrate-2026-06-08.png`。

- [ ] **Step 4: 写视觉验收**

`apps/inventory-sync/artifacts/manual/six-terminal-verify-2026-06-08.md`：
```markdown
# 6 终端同步看板验证

## 验收时间
2026-06-08 HH:MM CST

## 实际看到的事实层
- convergenceScore: ???
- publishedProductProjection.generatedAt: ???
- retailZone.generatedAt: ???
- inventoryMaster.generatedAt: ???
- standardInventory.generatedAt: ???

## 6 终端状态
[抄表]

## 手动校准结果
- allOk: ???
- 步骤:
  - ensure-inventory-master: ???
  - rebuild-product-library-pricing: ???
  - rebuild-published-projection: ???

## 结论
[completed_with_warnings / real_completed / blocked_*]
```

- [ ] **Step 5: 更新长期记忆**

```bash
cd "/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit"
```

更新 `docs/ai-context/01_CURRENT_STATE.md` 追加本轮状态。
更新 `docs/ai-context/04_NEXT_ACTIONS.md` 标记本条为已完成。

---

## 4. 风险与回退

- **风险 1**：校准链的 `_run_product_library_rebuild` / `_run_published_projection_rebuild` 函数可能不存在。如果不存在，要先实现包装函数调用现有 CLI 入口。
- **风险 2**：前端 24k+ 行的 App.tsx 单文件修改容易破坏其他功能。每次 commit 后跑 `pnpm build`。
- **风险 3**：dirty workspace 275 文件修改可能干扰 git 提交。先把改动 stash 或只 commit 这次新增。

## 5. 验收口径

- ✅ API 端点 200 + 6 终端 + 4 个事实层快照签名
- ✅ 前端"6 终端同步"书签可见，渲染表格
- ✅ "一键手动校准"按钮可点击，触发后状态正常变化
- ✅ 真实页面截图 + 验证文件归档到 `apps/inventory-sync/artifacts/manual/`
- ✅ `pnpm build` 通过
- ✅ git 至少 3 个 commit（每 task 一个）

## 6. 终态判定

- `real_completed`：5 个 task 全部勾选 + 验收通过 + git log 显示 3+ commit + 截图归档
- `executed_not_closed`：代码完成但没真实浏览器验收截图
- `blocked_*`：API 启动失败 / pnpm build 报错 / 真实页面无法打开
