# 智店通采集器 · 部署指南

> 适用系统：零售后台 `retail-pos.lenovo.com`

---

## 快速启动流程

### 第 1 步：安装依赖

```bash
cd zdt-sync
pip install -e '.[dev]'
playwright install chromium
```

### 第 2 步：启动 PostgreSQL

```bash
docker compose up -d postgres redis
```

### 第 3 步：初始化数据库

```bash
zdt-sync db init
```

### 第 4 步：启动 Chrome 调试模式（二选一）

#### 方案 A：启动独立 Chrome（推荐，最稳定）

```bash
bash scripts/start-chrome-debug.sh
```

脚本会自动用 `Profile 1` 启动一个带调试端口的 Chrome 实例。
在新窗口中访问 `https://retail-pos.lenovo.com` 完成登录。

#### 方案 B：使用你当前已有的登录 Chrome

需要重新启动 Chrome 带调试端口（**会新建窗口，现有窗口不受影响**）：

```bash
# 先完全退出当前 Chrome（Cmd+Q）
# 然后运行：
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --profile-directory='Profile 1'
```

登录后，验证端口：

```bash
curl http://127.0.0.1:9222/json/version
```

### 第 5 步：验证连接

```bash
# 设置 CDP URL
export ZDT_CDP_URL=ws://127.0.0.1:9222

# 验证登录态
zdt-sync auth check --cdp-url $ZDT_CDP_URL
```

### 第 6 步：采集数据

```bash
# 查看同步状态
zdt-sync status

# 采集订单（所有门店）
zdt-sync collect orders --store all

# 采集库存
zdt-sync collect inventory --store all

# 有界面模式（调试用）
zdt-sync collect orders --store all --headful
```

---

## 定时任务（crontab）

```cron
# 每 5 分钟采集订单
*/5 * * * * cd /path/to/zdt-sync && ZDT_CDP_URL=ws://127.0.0.1:9222 zdt-sync collect orders --store all >> logs/orders.log 2>&1

# 每 10 分钟采集库存
*/10 * * * * cd /path/to/zdt-sync && ZDT_CDP_URL=ws://127.0.0.1:9222 zdt-sync collect inventory --store all >> logs/inventory.log 2>&1

# 每天凌晨 2 点日报对账
0 2 * * * cd /path/to/zdt-sync && ZDT_CDP_URL=ws://127.0.0.1:9222 zdt-sync reconcile >> logs/reconcile.log 2>&1
```

---

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| `CDP connection failed` | Chrome 未启动调试端口 | 执行 scripts/start-chrome-debug.sh |
| `登录态过期` | Chrome 重新登录了 | 重新执行登录流程 |
| `采集到 0 行` | 选择器不对 | 用 --headful 模式检查页面结构 |
| `数据库连接失败` | PostgreSQL 未启动 | docker compose up -d postgres |
