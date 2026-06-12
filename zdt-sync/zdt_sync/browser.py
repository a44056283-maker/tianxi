"""
Browser session manager for zdt-sync.

核心设计：优先使用已有页面的 CDP 连接，避免开新页被风控。
用户 Chrome 已在零售后台 → 直接在那个页面操作。
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.request
import os
import websocket
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright
from rich.console import Console

from zdt_sync.settings import Settings, load_settings
from zdt_sync.utils import ensure_dir

console = Console()


def _get_cdp_ws_url(port: int = 9222) -> str | None:
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3)
        return json.loads(resp.read())["webSocketDebuggerUrl"]
    except Exception:
        return None


def _get_retail_page_info() -> tuple[str, str, str] | None:
    """
    找到零售后台已有页面的 CDP WebSocket URL。
    Returns: (ws_url, url, title) or None
    """
    try:
        resp = urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5)
        targets = json.loads(resp.read())
        for t in targets:
            if t["type"] == "page":
                url = t.get("url", "")
                title = t.get("title", "")
                if "retail-pos" in url or "智慧零售" in title:
                    return t["webSocketDebuggerUrl"], url, title
        # 回退：选第一个有效页面
        for t in targets:
            if t["type"] == "page" and "newtab" not in t.get("url", "").lower():
                return t["webSocketDebuggerUrl"], t.get("url", ""), t.get("title", "")
        return None
    except Exception:
        return None


class CDPPage:
    """
    直接封装已有页面的 CDP 操作。
    不开新页面，不触发风控。
    """

    def __init__(self, ws_url: str):
        self._ws_url = ws_url
        self._ws: websocket.WebSocket | None = None
        self._cid = 1
        self._connected = False

    def _ensure_connected(self):
        if self._ws is None or not self._connected:
            self._ws = websocket.create_connection(self._ws_url, timeout=15)
            # 启用 Runtime 域
            self._send({"id": self._cid, "method": "Runtime.enable"}, expect_response=False)
            self._cid += 1
            time.sleep(0.3)
            self._connected = True

    def _send(self, msg: dict, expect_response: bool = True) -> dict | None:
        self._ws.send(json.dumps(msg))
        if not expect_response:
            return None
        start = time.time()
        while time.time() - start < 15:
            self._ws.settimeout(3)
            try:
                resp = json.loads(self._ws.recv())
                if resp.get("id") == msg.get("id"):
                    return resp
            except Exception:
                pass
        return None

    def evaluate(self, script: str) -> str:
        """执行 JS，返回字符串结果"""
        self._ensure_connected()
        resp = self._send({
            "id": self._cid, "method": "Runtime.evaluate",
            "params": {"expression": script, "returnByValue": True}
        })
        self._cid += 1
        if resp:
            return resp.get("result", {}).get("result", {}).get("value", "")
        return ""

    def goto(self, url: str, timeout: int = 20) -> None:
        """导航到 URL"""
        self._ensure_connected()
        # 等待页面加载事件
        self._send({
            "id": self._cid, "method": "Page.enable"
        }, expect_response=False)
        self._cid += 1
        self._send({
            "id": self._cid, "method": "Page.navigate",
            "params": {"url": url}
        })
        self._cid += 1
        time.sleep(timeout)

    @property
    def url(self) -> str:
        return self.evaluate("window.location.href")

    @property
    def title(self) -> str:
        return self.evaluate("document.title")

    def close(self):
        if self._ws:
            self._ws.close()
            self._ws = None
            self._connected = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class ExistingPageSession:
    """
    直接使用 Chrome 已有页面的 CDP 连接。
    不创建新页面，不触发风控。
    """

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or load_settings()
        self._page: CDPPage | None = None
        self._browser: Browser | None = None
        self._pw: Any = None

    def __enter__(self) -> CDPPage:
        info = _get_retail_page_info()
        if not info:
            raise RuntimeError("未找到零售后台页面，请先在 Chrome 中打开智店通")
        ws_url, url, title = info
        console.print(f"[green]使用已有页面: {title}[/green] @ {url}")
        self._page = CDPPage(ws_url)
        return self._page

    def __exit__(self, *args):
        if self._page:
            self._page.close()


def _save_session_state(ws_url: str, auth_dir: Path = Path(".auth")) -> None:
    """从已有页面保存认证状态"""
    import datetime

    page = CDPPage(ws_url)

    # 提取 localStorage
    ls_raw = page.evaluate("""
(function(){
    var r = {};
    for(var i=0; i<localStorage.length; i++){
        var k = localStorage.key(i);
        r[k] = localStorage.getItem(k);
    }
    return JSON.stringify(r);
})()
""")
    try:
        ls = json.loads(ls_raw)
    except Exception:
        ls = {}

    token = ls.get("user.token", "")
    tenant_id = ls.get("user.tenantId", "")
    tenancy_code = ls.get("tenancyCode", "")
    mch_code = ls.get("mchCode", "")
    tc_raw = ls.get("tenantCodeConfig", "{}")
    try:
        tenant_config = json.loads(tc_raw) if isinstance(tc_raw, str) else tc_raw
    except Exception:
        tenant_config = {}

    url = page.url
    title = page.title
    page.close()

    state = {
        "app": "retail-pos",
        "url": url,
        "title": title,
        "token": token,
        "tenantId": tenant_id,
        "tenancyCode": tenancy_code,
        "mchCode": mch_code,
        "tenantCodeConfig": tenant_config,
        "saved_at": datetime.datetime.now().isoformat(),
    }

    auth_dir.mkdir(exist_ok=True)
    (auth_dir / "session.json").write_text(json.dumps(state, indent=2, ensure_ascii=False))
    (auth_dir / "localStorage.json").write_text(json.dumps(ls, indent=2))
    console.print(f"[green]✅ 认证已保存: {title} | Token: {token[:20]}...[/green]")


def _test_api_token(token: str, tenant_id: str) -> bool:
    if not token:
        return False
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(
        "https://retail-pos.lenovo.com/lenovo/web/company/shop/api/list",
        headers={"Authorization": f"Bearer {token}", "Tenant-Id": tenant_id},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=8, context=ctx)
        return resp.status == 200
    except Exception:
        return False


class BrowserSession:
    """
    Playwright 封装（独立 Chromium 模式备用）。
    优先使用 ExistingPageSession（CDP 直接操作已有页面）。
    """

    def __init__(
        self,
        settings: Settings | None = None,
        headless: bool | None = None,
        cdp_url: str | None = None,
    ):
        self.settings = settings or load_settings()
        self.headless = self.settings.headless if headless is None else headless
        self.cdp_url = cdp_url or os.environ.get("ZDT_CDP_URL")
        self._pw: Any = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None

    def _connect_over_cdp(self) -> Browser:
        ws_url = self.cdp_url or _get_cdp_ws_url()
        if not ws_url:
            raise RuntimeError("Chrome CDP 不可用")
        self._pw = sync_playwright().start()
        return self._pw.chromium.connect_over_cdp(ws_url)

    def __enter__(self) -> Page:
        try:
            self.browser = self._connect_over_cdp()
        except Exception as e:
            console.print(f"[yellow]CDP 失败: {e}[/yellow]")
            self._pw = sync_playwright().start()
            self.browser = self._pw.chromium.launch(
                headless=self.headless,
                channel=os.environ.get("ZDT_BROWSER_CHANNEL", "chromium"),
            )
        context_kwargs: dict[str, Any] = {
            "accept_downloads": True,
            "viewport": {"width": 1440, "height": 1000},
        }
        if self.settings.storage_state.exists():
            context_kwargs["storage_state"] = str(self.settings.storage_state)
        self.context = self.browser.new_context(**context_kwargs)
        self.context.set_default_timeout(self.settings.default_timeout_ms)
        self.page = self.context.new_page()
        return self.page

    def __exit__(self, *args):
        if self.context:
            self.context.close()
        if self.browser:
            self.browser.close()
        if self._pw:
            self._pw.stop()


def login_interactive(settings: Settings | None = None) -> Path:
    settings = settings or load_settings()
    ensure_dir(settings.storage_state.parent)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
        context.set_default_timeout(settings.default_timeout_ms)
        page = context.new_page()
        page.goto(settings.base_url)
        console.print("[yellow]请在浏览器中完成智店通登录，进入后台后按 Enter。[/yellow]")
        input()
        context.storage_state(path=str(settings.storage_state))
        browser.close()
    settings.storage_state.chmod(0o600)
    console.print(f"[green]登录态已保存：{settings.storage_state}[/green]")
    return settings.storage_state


def check_auth() -> bool:
    """检查已有页面登录态"""
    info = _get_retail_page_info()
    if info:
        ws_url, url, title = info
        if "retail-pos" in url or "智慧零售" in title:
            console.print(f"[green]✅ Chrome 已登录: {title}[/green]")
            console.print(f"[green]   {url}[/green]")
            try:
                _save_session_state(ws_url)
            except Exception as e:
                console.print(f"[yellow]保存认证失败: {e}[/yellow]")
            return True

    session_file = Path(".auth/session.json")
    if session_file.exists():
        try:
            session = json.loads(session_file.read_text())
            if _test_api_token(session.get("token", ""), session.get("tenantId", "")):
                console.print(f"[green]✅ session token 有效[/green]")
                return True
            console.print("[yellow]session token 可能已过期[/yellow]")
        except Exception:
            pass

    console.print("[red]❌ 未检测到有效登录态[/red]")
    return False


def save_auth_state() -> None:
    """从已有页面保存认证状态"""
    info = _get_retail_page_info()
    if not info:
        console.print("[red]未找到零售后台页面[/red]")
        return
    ws_url, url, title = info
    console.print(f"使用已有页面: {title} @ {url}")
    _save_session_state(ws_url)
