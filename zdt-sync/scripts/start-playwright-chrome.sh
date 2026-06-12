#!/usr/bin/env python3
"""
启动 Playwright Chromium 并开启 CDP 调试端口。
与用户日常 Chrome 完全独立，不触发单例冲突。
"""
from playwright.sync_api import sync_playwright
from zdt_sync.settings import load_settings
import sys, os, time, json

def main():
    settings = load_settings()
    cdp_port = int(os.environ.get("ZDT_CDP_PORT", "9222"))

    print(f"启动 Playwright Chromium (CDP 端口: {cdp_port})...")
    pw = sync_playwright().start()
    browser = pw.chromium.launch(
        headless=False,
        channel="chromium",
        args=[
            f"--remote-debugging-port={cdp_port}",
            "--remote-debugging-address=127.0.0.1",
        ]
    )
    page = browser.new_page()
    page.goto(settings.base_url, timeout=30000)
    print(f"浏览器已打开: {page.url}")
    print(f"Title: {page.title()}")
    print("")
    print("=" * 60)
    print("请在浏览器窗口中完成登录（手机号+验证码）")
    print("登录成功后回到终端按 Enter 保存登录态并退出")
    print("=" * 60)
    input("按 Enter 保存登录态...")

    # 保存登录态
    os.makedirs(".auth", exist_ok=True)
    context = page.context
    path = str(settings.storage_state)
    context.storage_state(path=path)
    os.chmod(path, 0o600)
    print(f"登录态已保存: {path}")

    # 同时把 CDP URL 写入文件供后续使用
    cdp_url = f"ws://127.0.0.1:{cdp_port}"
    with open(".auth/cdp_url.txt", "w") as f:
        f.write(cdp_url)
    print(f"CDP URL 已保存: {cdp_url}")

    browser.close()
    pw.stop()
    print("浏览器已关闭。")

if __name__ == "__main__":
    main()
