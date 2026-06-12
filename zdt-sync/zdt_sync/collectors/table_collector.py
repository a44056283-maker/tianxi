from __future__ import annotations

import time
from typing import Any

from playwright.sync_api import Locator, Page
from rich.console import Console

from zdt_sync.browser import BrowserSession
from zdt_sync.collectors.base import BaseCollector, CollectResult
from zdt_sync.db.session import get_session
from zdt_sync.parsers.excel import parse_excel_records
from zdt_sync.parsers.json_path import extract_json_path
from zdt_sync.utils import is_dangerous_action_text, normalize_text, parse_since_until

console = Console()


class TableCollector(BaseCollector):
    """Generic white-listed collector driven by config/selectors.yaml."""

    def run(
        self,
        *,
        mode: str = "table",
        since: str | None = None,
        until: str | None = None,
        store: str | None = None,
        incremental: bool = False,
        headless: bool | None = None,
    ) -> CollectResult:
        parameters = {
            "mode": mode,
            "since": since,
            "until": until,
            "store": store,
            "incremental": incremental,
        }
        with get_session(self.settings) as session:
            job = self.start_job(session, parameters)
            session.commit()
            row_count = 0
            trace_file = self.trace_path(job.id)
            screenshot_file: str | None = None
            page: Page | None = None
            try:
                with BrowserSession(settings=self.settings, headless=headless) as page:
                    if self.settings.enable_trace and page.context:
                        page.context.tracing.start(screenshots=True, snapshots=True, sources=True)
                    self._navigate(page)
                    self._apply_filters(page, since=since, until=until, store=store)
                    if mode == "export":
                        records = self._collect_export(page)
                    elif mode == "network":
                        records = self._collect_network(page)
                    else:
                        records = self._collect_table(page)
                    row_count = self.save_raw_records(session, records, job.id, store_code=store)
                    if self.settings.enable_trace and page.context:
                        page.context.tracing.stop(path=str(trace_file))
                self.finish_job(
                    session,
                    job,
                    status="success",
                    row_count=row_count,
                    trace_path=str(trace_file) if trace_file.exists() else None,
                )
                return CollectResult(self.entity, row_count, job.id, str(trace_file), None)
            except Exception as e:  # noqa: BLE001
                screenshot_file = self.save_failure_screenshot(page, job.id)
                try:
                    if page and page.context and self.settings.enable_trace:
                        page.context.tracing.stop(path=str(trace_file))
                except Exception:  # noqa: BLE001
                    pass
                self.finish_job(
                    session,
                    job,
                    status="error",
                    row_count=row_count,
                    error_message=str(e),
                    trace_path=str(trace_file) if trace_file.exists() else None,
                    screenshot_path=screenshot_file,
                )
                raise

    def _navigate(self, page: Page) -> None:
        start_url = self.entity_config.get("start_url") or "/"
        if start_url.startswith("http"):
            target = start_url
        else:
            target = self.settings.base_url.rstrip("/") + "/" + start_url.lstrip("/")
        page.goto(target)
        page.wait_for_load_state("domcontentloaded")
        self._sleep()
        menu = self.entity_config.get("menu_selector")
        if menu:
            self._safe_click(page, menu)
            self._sleep()
        wait_selector = self.entity_config.get("wait_selector")
        if wait_selector:
            self._scope(page).locator(wait_selector).first.wait_for(timeout=self.settings.default_timeout_ms)

    def _scope(self, page: Page):
        frame_selector = self.entity_config.get("frame_selector")
        if frame_selector:
            return page.frame_locator(frame_selector)
        return page

    def _apply_filters(
        self,
        page: Page,
        *,
        since: str | None,
        until: str | None,
        store: str | None,
    ) -> None:
        scope = self._scope(page)
        filters = self.entity_config.get("filters") or {}
        start_date = filters.get("start_date")
        end_date = filters.get("end_date")
        store_selector = filters.get("store")
        search_button = filters.get("search_button")
        since_value = parse_since_until(since)
        until_value = parse_since_until(until)
        if start_date and since_value:
            loc = scope.locator(start_date).first
            loc.fill(since_value)
            self._sleep()
        if end_date and until_value:
            loc = scope.locator(end_date).first
            loc.fill(until_value)
            self._sleep()
        if store_selector and store and store.lower() != "all":
            loc = scope.locator(store_selector).first
            try:
                loc.select_option(store)
            except Exception:  # noqa: BLE001
                loc.fill(store)
            self._sleep()
        if search_button:
            self._safe_click(page, search_button)
            page.wait_for_load_state("networkidle")
            self._sleep()

    def _collect_table(self, page: Page) -> list[dict[str, Any]]:
        scope = self._scope(page)
        table = self.entity_config.get("table") or {}
        rows_selector = table.get("rows")
        cells_selector = table.get("cells") or "td"
        columns = table.get("columns") or []
        next_page_selector = table.get("next_page")
        max_pages = int(table.get("max_pages") or 100)
        if not rows_selector:
            raise ValueError(f"{self.entity} 未配置 table.rows")
        records: list[dict[str, Any]] = []
        page_no = 1
        while True:
            rows = scope.locator(rows_selector)
            row_count = rows.count()
            for i in range(row_count):
                row = rows.nth(i)
                record = self._parse_row(row, cells_selector, columns)
                if record:
                    record["_page_no"] = page_no
                    records.append(record)
            if not next_page_selector or page_no >= max_pages:
                break
            next_btn = scope.locator(next_page_selector).first
            if not self._can_click_next(next_btn):
                break
            self._safe_click(page, next_page_selector)
            page.wait_for_load_state("networkidle")
            self._sleep()
            page_no += 1
        console.print(f"[green]{self.entity} 表格采集完成：{len(records)} 行[/green]")
        return records

    def _collect_export(self, page: Page) -> list[dict[str, Any]]:
        export_cfg = self.entity_config.get("export") or {}
        button = export_cfg.get("button")
        if not button:
            raise ValueError(f"{self.entity} 未配置 export.button")
        timeout = int(export_cfg.get("download_timeout_ms") or 120000)
        scope = self._scope(page)
        dangerous = self.entity_config.get("dangerous_texts") or []
        text = normalize_text(scope.locator(button).first.inner_text())
        if is_dangerous_action_text(text, dangerous):
            raise RuntimeError(f"拒绝点击危险按钮：{text}")
        with page.expect_download(timeout=timeout) as download_info:
            scope.locator(button).first.click()
        download = download_info.value
        suggested = download.suggested_filename or f"{self.entity}_export.xlsx"
        path = self.artifacts_dir / "downloads" / suggested
        path.parent.mkdir(parents=True, exist_ok=True)
        download.save_as(str(path))
        columns = (self.entity_config.get("table") or {}).get("columns") or []
        records = parse_excel_records(path, columns=columns)
        console.print(f"[green]{self.entity} 导出采集完成：{len(records)} 行，文件：{path}[/green]")
        return records

    def _collect_network(self, page: Page) -> list[dict[str, Any]]:
        network = self.entity_config.get("network") or {}
        contains = network.get("capture_url_contains")
        json_path = network.get("json_path")
        if not contains:
            raise ValueError(f"{self.entity} 未配置 network.capture_url_contains")
        captured: list[dict[str, Any]] = []

        def on_response(response):
            if contains not in response.url:
                return
            try:
                payload = response.json()
            except Exception:  # noqa: BLE001
                return
            data = extract_json_path(payload, json_path)
            if isinstance(data, list):
                captured.extend([item for item in data if isinstance(item, dict)])
            elif isinstance(data, dict):
                captured.append(data)

        page.on("response", on_response)
        search_button = (self.entity_config.get("filters") or {}).get("search_button")
        if search_button:
            self._safe_click(page, search_button)
        page.wait_for_load_state("networkidle")
        self._sleep(seconds=2)
        console.print(f"[green]{self.entity} 网络响应采集完成：{len(captured)} 行[/green]")
        return captured

    def _parse_row(self, row: Locator, cells_selector: str, columns: list[str]) -> dict[str, Any]:
        cells = row.locator(cells_selector)
        values = [normalize_text(cells.nth(i).inner_text()) for i in range(cells.count())]
        if not any(values):
            return {}
        record: dict[str, Any] = {}
        for idx, value in enumerate(values):
            key = columns[idx] if idx < len(columns) else f"col_{idx}"
            record[key] = value
        return record

    def _can_click_next(self, next_btn: Locator) -> bool:
        try:
            if next_btn.count() == 0:
                return False
            if not next_btn.is_visible():
                return False
            if not next_btn.is_enabled():
                return False
            return True
        except Exception:  # noqa: BLE001
            return False

    def _safe_click(self, page: Page, selector: str) -> None:
        scope = self._scope(page)
        locator = scope.locator(selector).first
        text = ""
        try:
            text = normalize_text(locator.inner_text(timeout=2000))
        except Exception:  # noqa: BLE001
            pass
        dangerous = self.entity_config.get("dangerous_texts") or []
        if text and is_dangerous_action_text(text, dangerous):
            raise RuntimeError(f"拒绝点击危险动作：{text}")
        locator.click()
        self._sleep()

    def _sleep(self, seconds: float | None = None) -> None:
        if seconds is None:
            seconds = self.settings.action_delay_ms / 1000
        time.sleep(seconds)
