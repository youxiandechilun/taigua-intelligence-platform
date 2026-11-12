"""员工电脑使用官方 Playwright 和独立浏览器上下文，不占服务器浏览器名额。"""

import asyncio
import os
from pathlib import Path
import socket
import subprocess
import sys
import time


def prepare_browser(root):
    """员工没有 Chrome/Edge 时自动准备官方 Chromium，安装目录只属于当前员工。"""
    if executable():
        return
    folder = Path(root) / "browsers"
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(folder)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as driver:
        if Path(driver.chromium.executable_path).is_file():
            return
    with (Path(root) / "browser-setup.log").open("a") as log:
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"],
                       env=os.environ.copy(), stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1200)


def executable():
    """优先使用已安装的 Chrome/Edge；没有时使用插件安装的官方 Chromium。"""
    candidates = [os.environ.get("TAIGUA_CHROME", ""),
                  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    for root in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
        if root:
            candidates.extend(str(Path(root) / relative) for relative in (
                "Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"))
    return next((value for value in candidates if value and Path(value).is_file()), None)


def _free_debug_port():
    """申请本机临时调试端口；浏览器只监听回环地址，不暴露到局域网。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


async def launch_external_persistent_context(user_data_dir):
    """用员工电脑的正常 Chrome/Edge 登录 Google，再通过 CDP 读取登录态。

    Playwright 直接启动浏览器会附加自动化启动参数，Google 可能显示“浏览器或
    应用可能不安全”。这里由系统进程直接启动 Chrome，不传入 Playwright 的
    `--enable-automation` 等参数，随后只用本机回环 CDP 接管页面。该目录按员工
    和账号隔离，Cookie 仍只保存在员工电脑，不会上传服务器。
    """
    from playwright.async_api import async_playwright

    browser_executable = executable()
    if not browser_executable:
        raise RuntimeError("YouTube 登录需要员工电脑安装 Chrome 或 Edge，请先安装后重试")

    profile_dir = Path(user_data_dir).expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    port = _free_debug_port()
    # 直接调用系统浏览器，不经过 Playwright launch，避免 Google 拒绝自动化浏览器。
    args = [
        browser_executable,
        f"--user-data-dir={profile_dir}",
        "--profile-directory=Default",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    process = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=sys.platform != "win32",
    )
    driver = await async_playwright().start()
    browser = None
    deadline = time.monotonic() + 20
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("系统浏览器启动失败，请关闭占用该账号目录的 Chrome 后重试")
            try:
                browser = await driver.chromium.connect_over_cdp(
                    f"http://127.0.0.1:{port}"
                )
                break
            except Exception:
                await asyncio.sleep(0.2)
        if browser is None:
            raise RuntimeError("无法连接员工电脑的 Chrome，请检查浏览器是否被安全软件拦截")
        contexts = browser.contexts
        if not contexts:
            raise RuntimeError("系统浏览器没有可用的默认窗口")
        context = contexts[0]
    except BaseException:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        await driver.stop()
        if process.poll() is None:
            process.terminate()
        raise

    original_close = context.close
    closed = False

    async def release(*args, **kwargs):
        """关闭 CDP、驱动和本次启动的浏览器，避免留下孤儿进程。"""
        nonlocal closed
        if closed:
            return
        closed = True
        try:
            await original_close(*args, **kwargs)
        finally:
            try:
                await browser.close()
            except Exception:
                pass
            await driver.stop()
            if process.poll() is None:
                process.terminate()

    context.close = release
    return context


async def launch_async(headless=False, user_data_dir=None):
    """生命周期随返回对象关闭，避免长期开着多个 Playwright 驱动进程。"""
    from playwright.async_api import async_playwright
    playwright = await async_playwright().start()
    options = {"headless": headless, "args": ["--start-maximized"]}
    if executable():
        options["executable_path"] = executable()
    try:
        if user_data_dir:
            browser = await playwright.chromium.launch_persistent_context(user_data_dir, no_viewport=True, **options)
        else:
            browser = await playwright.chromium.launch(**options)
    except BaseException:
        await playwright.stop()
        raise
    close = browser.close
    closed = False

    async def release(*args, **kwargs):
        """平台正常关闭与取消任务都会回收驱动，重复关闭也安全。"""
        nonlocal closed
        if not closed:
            closed = True
            try:
                return await close(*args, **kwargs)
            finally:
                await playwright.stop()
    browser.close = release
    return browser


def launch_sync(headless=False):
    """同步平台与异步平台同样使用本机官方浏览器。"""
    from playwright.sync_api import sync_playwright
    playwright = sync_playwright().start()
    try:
        browser = playwright.chromium.launch(headless=headless, executable_path=executable())
    except BaseException:
        playwright.stop()
        raise
    close = browser.close

    def release(*args, **kwargs):
        try:
            return close(*args, **kwargs)
        finally:
            playwright.stop()
    browser.close = release
    return browser
