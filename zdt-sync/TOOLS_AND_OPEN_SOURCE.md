# 工具与开源项目清单

本项目不直接打包第三方开源项目源码，只提供依赖声明、安装脚本和使用说明。这样可以避免许可证、版本、供应链安全和二次分发问题。

## 核心工具

| 工具 | 用途 | 必需程度 |
|---|---|---|
| Python 3.11+ | CLI 与采集器运行环境 | 必需 |
| Playwright for Python | 浏览器自动化、登录态复用、页面采集、下载文件、trace | 必需 |
| Typer | 构建 `zdt-sync` 命令行 | 必需 |
| SQLAlchemy | 数据库 ORM / Core | 必需 |
| PostgreSQL | sync_state、sync_job、raw_records、staging 表 | 必需 |
| Docker Compose | 本地/服务器快速启动 PostgreSQL、Redis | 推荐 |
| Redis | 分布式锁、轻量队列、任务状态 | 可选 |
| PyYAML | selectors.yaml、stores.yaml 配置 | 必需 |
| openpyxl | 解析 Excel 导出文件 | 推荐 |
| pytest | 单元测试 | 推荐 |

## 可选工具

| 工具 | 用途 | 什么时候用 |
|---|---|---|
| Crawlee for Python | 多页面队列、复杂分页、详情页任务 | 页面很多、列表+详情复杂时 |
| Airflow / Dagster | 正式生产调度与编排 | 多任务、多依赖、多系统同步时 |
| n8n | 低代码告警、日报、异常流程 | 需要业务人员参与时 |
| Prometheus + Grafana | 指标监控和可视化 | 进入生产稳定运行后 |
| Robot Framework Browser | RPA 式流程验证 | 团队更偏测试/RPA 时 |

## 安装命令

### Python 依赖

```bash
pip install -e '.[dev]'
playwright install chromium
```

### Docker 服务

```bash
docker compose up -d postgres redis
```

### 可选 Crawlee

```bash
pip install 'crawlee[playwright]'
```

## 本项目默认不使用的技术

| 技术 | 原因 |
|---|---|
| 开放式深度爬虫 | 后台系统风险高，容易误点危险按钮 |
| 代理池 | 不适合授权业务后台采集，容易触碰合规红线 |
| 反验证码/绕过 MFA | 不允许 |
| 高并发扫描隐藏接口 | 不允许 |
| AI agent 自由浏览后台 | 容易受提示注入和页面内容影响 |

## 推荐组合

### MVP

```text
Python + Playwright + Typer + PostgreSQL + Docker Compose + cron
```

### 生产增强

```text
Python + Playwright + PostgreSQL + Redis + systemd timer/Airflow + Grafana
```

### 复杂页面增强

```text
Crawlee PlaywrightCrawler + PostgreSQL + 任务队列
```
