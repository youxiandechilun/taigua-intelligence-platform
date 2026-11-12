"""验证平台页面桥接、取消回收、输入约束和员工工作区隔离。"""

import asyncio
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from flask import Flask
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server_login import LoginMessages, LoginSession, current_login, install_server_login
from server_browser import launch_async
from browser_scheduler import BrowserScheduler
from workspace_guard import install_workspace_guard
from impl._login_state import is_creator_landing, wait_for_creator_login


class LoginLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_exception_and_timeout_emit_result_and_close_browser(self):
        for exception, expected in [(RuntimeError("private diagnostic"), "error"), (None, "timeout")]:
            browser = SimpleNamespace(close=AsyncMock())

            async def login(*args, **kwargs):
                current_login.get().attach_browser(browser)
                if exception:
                    raise exception
                await asyncio.Event().wait()

            session = LoginSession("test", SimpleNamespace(login=login, platform_key="test"), timeout=0.03)
            await session._run()
            self.assertEqual(session.messages.terminal, expected)
            browser.close.assert_awaited_once()
            self.assertIsNone(current_login.get())
            self.assertNotIn("private diagnostic", str(list(session.messages.queue)))

    async def test_parallel_login_tasks_keep_their_own_context(self):
        seen = {}

        async def login(identifier, messages, **kwargs):
            await asyncio.sleep(0)
            seen[identifier] = current_login.get().identifier
            messages.put(json.dumps({"status": "200"}))

        platform = SimpleNamespace(login=login, platform_key="test")
        await asyncio.gather(LoginSession("employee-a", platform)._run(), LoginSession("employee-b", platform)._run())
        self.assertEqual(seen, {"employee-a": "employee-a", "employee-b": "employee-b"})

    async def test_cancellation_while_waiting_for_browser_removes_queue_entry(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "SAU_BROWSER_POOL": str(Path(directory) / "pool.sqlite3"), "SAU_WORKSPACE_ID": "employee-a",
        }):
            scheduler = BrowserScheduler(Path(directory) / "pool.sqlite3")
            owner = scheduler.enqueue("employee-a")
            task = asyncio.create_task(launch_async())
            try:
                await asyncio.sleep(0.05)
                self.assertFalse(task.done(), "第二个浏览器应排队等待，不能绕过员工自己的名额")
                self.assertEqual(scheduler.status("employee-a")["workspace"]["queued"], 1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertEqual(scheduler.status("employee-a")["workspace"], {"running": 1, "queued": 0})
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                owner.close()

    async def test_creator_login_does_not_accept_help_or_login_redirect(self):
        host, prefixes = "creator.douyin.com", ("/creator-micro/",)
        for url in ["https://creator.douyin.com/", "https://creator.douyin.com/help", "https://creator.douyin.com/creator-micro/login", "https://creator.douyin.com.evil.example/creator-micro/home"]:
            self.assertFalse(is_creator_landing(url, host, prefixes))
        self.assertTrue(is_creator_landing("https://creator.douyin.com/creator-micro/home", host, prefixes))
        page = SimpleNamespace(url="https://creator.xiaohongshu.com/login?redirect=/new/home", is_closed=lambda: False)
        with self.assertRaises(asyncio.TimeoutError):
            await wait_for_creator_login(page, "creator.xiaohongshu.com", ("/new/",), timeout_s=0.01)


class LoginInputTests(unittest.TestCase):
    def setUp(self):
        self.session = LoginSession("test", None)
        self.session.frame_id = "current"
        self.session.width, self.session.height = 1280, 900

    def test_rejects_stale_frames_invalid_coordinates_and_arbitrary_commands(self):
        invalid = [{"kind": "click", "frame_id": "old", "x": 1, "y": 2},
                   {"kind": "click", "x": float("nan"), "y": 2},
                   {"kind": "click", "x": -1, "y": 2},
                   {"kind": "click", "x": 1280, "y": 2},
                   {"kind": "drag", "x": 1, "y": 2, "end_x": 9, "end_y": 900},
                   {"kind": "text", "text": "x" * 513},
                   {"kind": "key", "key": "Control+L"},
                   {"kind": "navigate", "url": "http://127.0.0.1/"},
                   {"kind": "evaluate", "script": "alert(1)"}]
        for action in invalid:
            action.setdefault("frame_id", "current")
            with self.subTest(kind=action["kind"]), self.assertRaises(ValueError):
                self.session._validate_input(action)

    def test_terminal_result_is_not_dropped_by_frame_backlog(self):
        queue = LoginMessages()
        for _ in range(20):
            queue.put('{"status":"page"}')
        queue.put('{"status":200}')
        self.assertEqual(queue.terminal, "200")
        self.assertEqual(json.loads(list(queue.queue)[-1])["status"], 200)
        self.assertLessEqual(queue.qsize(), 6)

    def test_cancel_stops_underlying_task_and_closes_browser(self):
        attached = threading.Event()
        browser = SimpleNamespace(close=AsyncMock())

        async def login(*args, **kwargs):
            current_login.get().attach_browser(browser)
            attached.set()
            await asyncio.Event().wait()

        session = LoginSession("test", SimpleNamespace(login=login, platform_key="test"))
        thread = threading.Thread(target=session.run, daemon=True)
        thread.start()
        self.assertTrue(attached.wait(3))
        session.cancel()
        self.assertTrue(session.done.wait(3))
        thread.join(1)
        self.assertEqual(session.messages.terminal, "cancelled")
        browser.close.assert_awaited_once()

    def test_workspace_sessions_cannot_be_read_controlled_or_cancelled_by_other_employee(self):
        apps, managers = [], []
        for name in ("employee-a", "employee-b"):
            app = Flask(name)
            with patch.dict(os.environ, {"SAU_WORKER_TOKEN": name}):
                install_workspace_guard(app, Path("/tmp") / name)
            managers.append(install_server_login(app))
            apps.append(app.test_client())
        own = SimpleNamespace(send_input=lambda payload: None, cancel=unittest.mock.Mock())
        managers[0].sessions["private-session"] = own
        route = "/api/platform-login/private-session/"
        self.assertEqual(apps[0].post(route + "input", headers={"X-Workspace-Token": "employee-a"}, json={}).status_code, 200)
        self.assertEqual(apps[1].post(route + "input", headers={"X-Workspace-Token": "employee-b"}, json={}).status_code, 404)
        apps[1].post(route + "cancel", headers={"X-Workspace-Token": "employee-b"})
        own.cancel.assert_not_called()
        self.assertEqual(apps[0].post(route + "input", headers={"X-Workspace-Token": "employee-b"}, json={}).status_code, 401)


@unittest.skipUnless(os.environ.get("TAIGUA_TEST_CHROMIUM"), "按需使用已安装浏览器验证页面与输入往返")
class BrowserRoundTripTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_browser_frame_input_cancel_and_next_session(self):
        import base64
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "SAU_BROWSER_POOL": str(Path(directory) / "pool.sqlite3"), "SAU_WORKSPACE_ID": "employee-a",
            "SAU_CHROMIUM_PATH": os.environ["TAIGUA_TEST_CHROMIUM"],
        }):
            async def login(*args, **kwargs):
                browser = await launch_async()
                context = await browser.new_context(viewport={"width": 1280, "height": 900})
                page = await context.new_page()
                # 合成页面仅验证桥接，不连接或代替真实平台授权。
                await page.set_content('<input id="value" style="position:absolute;left:20px;top:20px;width:200px;height:30px">')
                await asyncio.Event().wait()

            session = LoginSession("round-trip", SimpleNamespace(login=login, platform_key="test"))
            task = asyncio.create_task(session._run())
            try:
                frame = None
                async with asyncio.timeout(20):
                    while frame is None:
                        while not session.messages.empty():
                            item = json.loads(session.messages.get_nowait())
                            if item["status"] == "page":
                                frame = item
                        await asyncio.sleep(0.05)
                with Image.open(io.BytesIO(base64.b64decode(frame["image"].split(",")[1]))) as image:
                    self.assertEqual(image.size, (1280, 900))
                for action in [{"kind": "click", "x": 60, "y": 35}, {"kind": "text", "text": "桥接验证"}]:
                    await asyncio.to_thread(session.send_input, {**action, "frame_id": frame["frame_id"]})
                self.assertEqual(await session.page.locator("#value").input_value(), "桥接验证")
            finally:
                session.cancel()
                await task
            self.assertEqual(session.messages.terminal, "cancelled")
            # 取消后立即再开浏览器，证明员工及全站名额均已归还。
            browser = await asyncio.wait_for(launch_async(), 10)
            await browser.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
