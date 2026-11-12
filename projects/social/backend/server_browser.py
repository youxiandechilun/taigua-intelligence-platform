"""泰卦服务器浏览器：所有入口共用员工串行队列，不设置全站并发上限。"""

import asyncio
import os
import time

from browser_scheduler import worker_scheduler


async def launch_async(user_data_dir=None):
    from playwright.async_api import async_playwright
    from server_login import current_login
    login_session = current_login.get()
    scheduler, workspace = worker_scheduler()
    ticket = scheduler.enqueue(workspace)
    runtime = None
    try:
        # 同员工排队不提前启动浏览器，也不会阻塞其他员工。
        while not ticket.try_acquire():
            if login_session:
                login_session.waiting_for_browser = True
            await asyncio.sleep(0.2)
        if login_session:
            login_session.waiting_for_browser = False
        runtime = await async_playwright().start()
        window = "1280,900" if login_session else "1920,1080"
        options = {"headless": True, "args": ["--disable-dev-shm-usage", "--window-size=" + window]}
        if executable := os.environ.get("SAU_CHROMIUM_PATH"):
            options["executable_path"] = executable
        if user_data_dir:
            browser = await runtime.chromium.launch_persistent_context(user_data_dir, no_viewport=True, **options)
        else:
            browser = await runtime.chromium.launch(**options)
        original_close = browser.close
        closed = False

        async def close(*args, **kwargs):
            nonlocal closed
            if closed:
                return
            closed = True
            try:
                await original_close(*args, **kwargs)
            finally:
                try:
                    await runtime.stop()
                finally:
                    ticket.close()

        browser.close = close
        # 异常断开同样停止驱动并释放名额；正常关闭时重复回调不会重复释放。
        def disconnected(*args):
            if not closed:
                asyncio.create_task(close())
        browser.on("close" if user_data_dir else "disconnected", disconnected)
        # 仅登录任务向本人的工作区传送页面，发布浏览器不加入页面桥接。
        if login_session:
            login_session.attach_browser(browser)
        return browser
    except BaseException:
        try:
            if runtime:
                await runtime.stop()
        finally:
            ticket.close()
            if login_session:
                login_session.waiting_for_browser = False
        raise


def launch_sync():
    from playwright.sync_api import sync_playwright
    scheduler, workspace = worker_scheduler()
    ticket = scheduler.enqueue(workspace)
    runtime = None
    try:
        # 同步发布与异步登录使用同一队列，不能绕过员工自己的浏览器名额。
        while not ticket.try_acquire():
            time.sleep(0.2)
        runtime = sync_playwright().start()
        options = {"headless": True, "args": ["--disable-dev-shm-usage"]}
        if executable := os.environ.get("SAU_CHROMIUM_PATH"):
            options["executable_path"] = executable
        browser = runtime.chromium.launch(**options)
        original_close = browser.close
        closed = False
        browser.on("disconnected", lambda *args: None if closed else ticket.close())

        def close(*args, **kwargs):
            nonlocal closed
            if closed:
                return
            closed = True
            try:
                original_close(*args, **kwargs)
            finally:
                try:
                    runtime.stop()
                finally:
                    ticket.close()

        browser.close = close
        return browser
    except BaseException:
        try:
            if runtime:
                runtime.stop()
        finally:
            ticket.close()
        raise
