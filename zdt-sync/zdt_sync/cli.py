from __future__ import annotations

from typing import Optional

import typer
from rich.console import Console
from rich.table import Table
from sqlalchemy import desc, select

import hashlib
from zdt_sync.api_collector import collect_orders, flatten_order
from zdt_sync.browser import check_auth, login_interactive, save_auth_state
from zdt_sync.collectors.table_collector import TableCollector
from zdt_sync.db.models import RawRecord, SyncJob, SyncState
from zdt_sync.db.session import get_session, init_database
from zdt_sync.settings import load_selectors, load_settings

console = Console()
app = typer.Typer(help="智店通/零售后台白名单 CLI 采集器")
auth_app = typer.Typer(help="登录态管理")
collect_app = typer.Typer(help="采集任务")
db_app = typer.Typer(help="数据库管理")
app.add_typer(auth_app, name="auth")
app.add_typer(collect_app, name="collect")
app.add_typer(db_app, name="db")


@auth_app.command("login")
def auth_login() -> None:
    """人工登录并保存 Playwright storage_state。"""
    settings = load_settings()
    login_interactive(settings)


@auth_app.command("check")
def auth_check(
    headful: bool = typer.Option(False, help="使用有界面浏览器检查"),
    cdp_url: str = typer.Option(None, help="CDP WebSocket URL，例如 ws://127.0.0.1:9222"),
) -> None:
    """检查登录态是否可用（CDP 模式或 Playwright storage_state 模式）。"""
    ok = check_auth(headless=not headful, cdp_url=cdp_url)
    raise typer.Exit(code=0 if ok else 1)


@auth_app.command("save")
def auth_save() -> None:
    """从 Chrome 已有页面保存认证状态（token/cookies）到 .auth/session.json。"""
    save_auth_state()


@db_app.command("init")
def db_init() -> None:
    """初始化数据库表。"""
    settings = load_settings()
    init_database(settings)
    console.print("[green]数据库表已初始化。[/green]")


@app.command("status")
def status(failed: bool = typer.Option(False, help="只显示失败任务")) -> None:
    """查看同步状态和最近任务。"""
    settings = load_settings()
    with get_session(settings) as session:
        states = session.execute(select(SyncState).order_by(SyncState.entity_name)).scalars().all()
        t = Table(title="Sync State")
        for col in ["entity", "status", "last_success_time", "last_error"]:
            t.add_column(col)
        for s in states:
            t.add_row(
                s.entity_name,
                s.status or "",
                str(s.last_success_time or ""),
                (s.last_error or "")[:80],
            )
        console.print(t)

        stmt = select(SyncJob).order_by(desc(SyncJob.id)).limit(20)
        if failed:
            stmt = select(SyncJob).where(SyncJob.status == "error").order_by(desc(SyncJob.id)).limit(20)
        jobs = session.execute(stmt).scalars().all()
        jt = Table(title="Recent Jobs")
        for col in ["id", "entity", "status", "rows", "started", "error"]:
            jt.add_column(col)
        for j in jobs:
            jt.add_row(str(j.id), j.entity_name, j.status, str(j.row_count), str(j.started_at), (j.error_message or "")[:80])
        console.print(jt)


@app.command("replay")
def replay(
    job_id: int = typer.Option(..., help="要重跑的 job id"),
    headful: bool = typer.Option(False, help="有界面运行"),
) -> None:
    """根据历史 job 参数重跑任务。"""
    settings = load_settings()
    with get_session(settings) as session:
        job = session.get(SyncJob, job_id)
        if not job:
            console.print(f"[red]未找到 job：{job_id}[/red]")
            raise typer.Exit(1)
        params = job.parameters or {}
        entity = job.entity_name
    _run_entity(entity, headful=headful, **params)


def _run_entity(
    entity: str,
    *,
    mode: str = "table",
    since: Optional[str] = None,
    until: Optional[str] = "now",
    store: Optional[str] = "all",
    incremental: bool = False,
    headful: bool = False,
) -> None:
    settings = load_settings()
    selectors = load_selectors(settings)
    entity_config = (selectors.get("entities") or {}).get(entity)
    if not entity_config or not entity_config.get("enabled", True):
        console.print(f"[red]实体未启用或不存在：{entity}[/red]")
        raise typer.Exit(1)
    collector = TableCollector(settings, entity, entity_config)
    result = collector.run(
        mode=mode,
        since=since,
        until=until,
        store=store,
        incremental=incremental,
        headless=not headful,
    )
    console.print(f"[green]{entity} 采集完成：job_id={result.job_id}, rows={result.row_count}[/green]")


@collect_app.command("entity")
def collect_entity(
    entity: str = typer.Argument(..., help="实体名，例如 orders/inventory/products/refunds/transfers"),
    mode: str = typer.Option("table", help="table/export/network"),
    since: Optional[str] = typer.Option(None, help="开始时间"),
    until: Optional[str] = typer.Option("now", help="结束时间"),
    store: Optional[str] = typer.Option("all", help="门店编码或 all"),
    incremental: bool = typer.Option(False, help="按 sync_state 增量，具体逻辑需按页面完善"),
    headful: bool = typer.Option(False, help="有界面运行"),
) -> None:
    _run_entity(entity, mode=mode, since=since, until=until, store=store, incremental=incremental, headful=headful)


@collect_app.command("orders")
def collect_orders_cmd(
    mode: str = typer.Option("api", help="api/table/export/network"),
    since: Optional[str] = typer.Option(None),
    until: Optional[str] = typer.Option("now"),
    store: Optional[str] = typer.Option("all"),
    incremental: bool = typer.Option(False),
    headful: bool = typer.Option(False),
) -> None:
    if mode == "api":
        console.print(f"[cyan]API 模式采集订单（从 {since or '7天前'} 到 {until or '今天'}）...[/cyan]")
        try:
            records = collect_orders(start_date=since, end_date=until if until != "now" else None)
            console.print(f"[green]✅ 采集到 {len(records)} 条订单[/green]")
            # 保存到数据库
            from zdt_sync.db.session import get_session
            from zdt_sync.db.models import RawRecord
            from datetime import datetime
            settings = load_settings()
            with get_session(settings) as session:
                for raw in records:
                    flat = flatten_order(raw)
                    order_no = flat.get("orderNo", flat.get("id", ""))
                    rec = RawRecord(
                        source_name="zhidiantong",
                        entity_name="orders",
                        record_id=order_no,
                        record_hash=hashlib.md5(str(raw).encode()).hexdigest(),
                        payload=raw,
                        collected_at=datetime.now(),
                    )
                    session.add(rec)
                session.commit()
                console.print(f"[green]已写入 {len(records)} 条到数据库[/green]")
        except Exception as e:
            console.print(f"[red]❌ 采集失败：{e}[/red]")
            raise typer.Exit(1)
    else:
        _run_entity("orders", mode=mode, since=since, until=until, store=store, incremental=incremental, headful=headful)


@collect_app.command("inventory")
def collect_inventory(
    mode: str = typer.Option("table", help="table/export/network"),
    store: Optional[str] = typer.Option("all"),
    headful: bool = typer.Option(False),
) -> None:
    _run_entity("inventory", mode=mode, since=None, until="now", store=store, incremental=False, headful=headful)


@collect_app.command("products")
def collect_products(
    mode: str = typer.Option("table", help="table/export/network"),
    headful: bool = typer.Option(False),
) -> None:
    _run_entity("products", mode=mode, since=None, until="now", store="all", incremental=False, headful=headful)


@collect_app.command("refunds")
def collect_refunds(
    mode: str = typer.Option("table", help="table/export/network"),
    since: Optional[str] = typer.Option(None),
    until: Optional[str] = typer.Option("now"),
    store: Optional[str] = typer.Option("all"),
    incremental: bool = typer.Option(False),
    headful: bool = typer.Option(False),
) -> None:
    _run_entity("refunds", mode=mode, since=since, until=until, store=store, incremental=incremental, headful=headful)


@collect_app.command("transfers")
def collect_transfers(
    mode: str = typer.Option("table", help="table/export/network"),
    since: Optional[str] = typer.Option(None),
    until: Optional[str] = typer.Option("now"),
    store: Optional[str] = typer.Option("all"),
    incremental: bool = typer.Option(False),
    headful: bool = typer.Option(False),
) -> None:
    _run_entity("transfers", mode=mode, since=since, until=until, store=store, incremental=incremental, headful=headful)


@app.command("count")
def count_records(entity: Optional[str] = typer.Option(None)) -> None:
    """统计 raw_records。"""
    settings = load_settings()
    with get_session(settings) as session:
        if entity:
            count = session.query(RawRecord).filter(RawRecord.entity_name == entity).count()
            console.print(f"{entity}: {count}")
        else:
            rows = session.query(RawRecord.entity_name).distinct().all()
            for (name,) in rows:
                count = session.query(RawRecord).filter(RawRecord.entity_name == name).count()
                console.print(f"{name}: {count}")


if __name__ == "__main__":
    app()
