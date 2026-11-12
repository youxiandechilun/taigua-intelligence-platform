"""验证取消全站并发上限后的员工串行、跨员工并行和状态隔离。"""

from pathlib import Path
import asyncio
import os
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from werkzeug.security import generate_password_hash

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from team_gateway import create_app
from browser_scheduler import BrowserScheduler
from server_browser import launch_async, launch_sync


class SchedulingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.scheduler = BrowserScheduler(Path(self.directory.name) / "pool.sqlite3")
        self.tickets = []
        self.addCleanup(lambda: [ticket.close() for ticket in reversed(self.tickets)])

    def enqueue(self, workspace):
        ticket = self.scheduler.enqueue(workspace)
        self.tickets.append(ticket)
        return ticket

    def test_employee_fifo_without_global_limit_or_blocking_other_employees(self):
        first, second, third = (self.enqueue("employee-a") for _ in range(3))
        other, overflow = self.enqueue("employee-b"), self.enqueue("employee-c")
        self.assertTrue(first.try_acquire())
        self.assertFalse(second.try_acquire())
        self.assertFalse(third.try_acquire())
        self.assertTrue(other.try_acquire(), "同员工等待中的任务不能占用其他员工的名额")
        self.assertTrue(overflow.try_acquire(), "第三位员工不受旧全站名额限制")
        other.close()
        self.assertTrue(overflow.try_acquire())
        first.close()
        self.assertTrue(second.try_acquire())
        self.assertFalse(third.try_acquire())
        second.close()
        self.assertTrue(third.try_acquire())

    def test_many_employees_and_restart_have_no_global_cap(self):
        # 只创建轻量租约，不实际启动二十个浏览器消耗服务器资源。
        tickets = [self.enqueue(f"employee-{index}") for index in range(20)]
        self.assertTrue(all(ticket.try_acquire() for ticket in tickets))
        restarted = BrowserScheduler(self.scheduler.path)
        status = restarted.status("employee-0", True)
        self.assertIsNone(status["max_concurrent"])
        self.assertEqual(status["mode"], "unlimited")
        self.assertEqual(status["global"]["running"], 20)

    def test_process_crash_returns_slot_and_removes_stale_lease(self):
        # 子进程持有真实操作系统锁，强制退出后不能永久阻塞同员工后续任务。
        code = "from browser_scheduler import BrowserScheduler; import sys; s=BrowserScheduler(sys.argv[1]); t=s.enqueue('crashed'); print(t.try_acquire(),flush=True); sys.stdin.read()"
        child = subprocess.Popen([sys.executable, "-c", code, str(self.scheduler.path)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            lines, ready = [], threading.Event()
            def read_ready():
                lines.append(child.stdout.readline())
                ready.set()
            threading.Thread(target=read_ready, daemon=True).start()
            self.assertTrue(ready.wait(10), "子进程应及时完成入队")
            self.assertEqual(lines[0].strip(), b"True")
            waiting = self.enqueue("crashed")
            self.assertFalse(waiting.try_acquire())
            child.kill()
            child.wait(timeout=5)
            self.assertTrue(waiting.try_acquire())
            self.assertEqual(self.scheduler.status("crashed")["workspace"], {"running": 1, "queued": 0})
            self.assertEqual(len(list(self.scheduler.leases.glob("*.lock"))), 1)
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)


class BrowserFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_normal_and_persistent_launch_failures_release_slot(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "SAU_BROWSER_POOL": str(Path(directory) / "pool.sqlite3"), "SAU_WORKSPACE_ID": "employee-a",
        }):
            scheduler = BrowserScheduler(Path(directory) / "pool.sqlite3")
            for profile in (None, str(Path(directory) / "profile")):
                runtime = SimpleNamespace(stop=AsyncMock(), chromium=SimpleNamespace(
                    launch=AsyncMock(side_effect=RuntimeError("synthetic launch failure")),
                    launch_persistent_context=AsyncMock(side_effect=RuntimeError("synthetic launch failure")),
                ))
                with patch("playwright.async_api.async_playwright", return_value=SimpleNamespace(start=AsyncMock(return_value=runtime))):
                    with self.assertRaisesRegex(RuntimeError, "synthetic"):
                        await launch_async(profile)
                self.assertEqual(scheduler.status("employee-a")["workspace"], {"running": 0, "queued": 0})
                runtime.stop.assert_awaited_once()

    async def test_async_disconnect_stops_driver_and_releases_slot(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "SAU_BROWSER_POOL": str(Path(directory) / "pool.sqlite3"), "SAU_WORKSPACE_ID": "employee-a",
        }):
            callbacks = {}
            browser = SimpleNamespace(close=AsyncMock(), on=lambda name, callback: callbacks.update({name: callback}))
            runtime = SimpleNamespace(stop=AsyncMock(), chromium=SimpleNamespace(launch=AsyncMock(return_value=browser)))
            with patch("playwright.async_api.async_playwright", return_value=SimpleNamespace(start=AsyncMock(return_value=runtime))):
                await launch_async()
                callbacks["disconnected"]()
                await asyncio.sleep(0.03)
            self.assertEqual(BrowserScheduler(Path(directory) / "pool.sqlite3").status("employee-a")["workspace"]["running"], 0)
            runtime.stop.assert_awaited_once()

    async def test_sync_failure_also_returns_shared_slot(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "SAU_BROWSER_POOL": str(Path(directory) / "pool.sqlite3"), "SAU_WORKSPACE_ID": "employee-a",
        }):
            runtime = SimpleNamespace(stop=Mock(), chromium=SimpleNamespace(launch=Mock(side_effect=RuntimeError("synthetic"))))
            with patch("playwright.sync_api.sync_playwright", return_value=SimpleNamespace(start=Mock(return_value=runtime))):
                with self.assertRaisesRegex(RuntimeError, "synthetic"):
                    launch_sync()
            self.assertEqual(BrowserScheduler(Path(directory) / "pool.sqlite3").status("employee-a")["workspace"]["running"], 0)
            runtime.stop.assert_called_once()


@unittest.skipUnless(os.environ.get("TAIGUA_TEST_CHROMIUM"), "按需使用真实浏览器验证并行与登录状态隔离")
class BrowserIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_employees_use_separate_persistent_profiles_and_reopen_saved_state(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "SAU_BROWSER_POOL": str(Path(directory) / "pool.sqlite3"), "SAU_WORKSPACE_ID": "employee-a",
            "SAU_CHROMIUM_PATH": os.environ["TAIGUA_TEST_CHROMIUM"],
        }):
            scheduler = BrowserScheduler(Path(directory) / "pool.sqlite3")
            browsers = []
            async def page_for(context):
                page = await context.new_page()
                # 在浏览器内拦截合成站点，无外网请求、不读取任何真实账号。
                await page.route("**/*", lambda route: route.fulfill(body="<title>员工隔离验证</title>"))
                await page.goto("https://browser-pool.test/")
                return page
            try:
                first = await launch_async(str(Path(directory) / "employee-a-profile"))
                browsers.append(first)
                page_a = await page_for(first)
                await page_a.evaluate("localStorage.setItem('employee','员工甲'); document.cookie='employee=a; SameSite=Lax; Max-Age=86400'")
                os.environ["SAU_WORKSPACE_ID"] = "employee-b"
                second = await asyncio.wait_for(launch_async(str(Path(directory) / "employee-b-profile")), 15)
                browsers.append(second)
                page_b = await page_for(second)
                self.assertEqual(scheduler.status("employee-a", True)["global"]["running"], 2)
                self.assertIsNone(await page_b.evaluate("localStorage.getItem('employee')"))
                self.assertEqual(await page_b.evaluate("document.cookie"), "")
                await page_b.evaluate("localStorage.setItem('employee','员工乙'); document.cookie='employee=b; SameSite=Lax; Max-Age=86400'")
                self.assertEqual(await page_a.evaluate("localStorage.getItem('employee')"), "员工甲")
                self.assertEqual(await page_a.evaluate("document.cookie"), "employee=a")
                await first.close()
                os.environ["SAU_WORKSPACE_ID"] = "employee-a"
                restored = await launch_async(str(Path(directory) / "employee-a-profile"))
                browsers.append(restored)
                restored_page = await page_for(restored)
                self.assertEqual(await restored_page.evaluate("localStorage.getItem('employee')"), "员工甲")
                self.assertEqual(await restored_page.evaluate("document.cookie"), "employee=a")
            finally:
                for browser in reversed(browsers):
                    await browser.close()
            self.assertEqual(scheduler.status("employee-a", True)["global"], {"running": 0, "queued": 0})

    async def test_sync_and_async_browsers_share_employee_queue(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "SAU_BROWSER_POOL": str(Path(directory) / "pool.sqlite3"), "SAU_WORKSPACE_ID": "employee-a",
            "SAU_CHROMIUM_PATH": os.environ["TAIGUA_TEST_CHROMIUM"],
        }):
            opened, release, errors = threading.Event(), threading.Event(), []
            def sync_job():
                try:
                    browser = launch_sync()
                    try:
                        opened.set()
                        release.wait(20)
                    finally:
                        browser.close()
                except BaseException as exc:
                    errors.append(exc)
                    opened.set()
            thread = threading.Thread(target=sync_job)
            thread.start()
            pending = None
            try:
                self.assertTrue(await asyncio.to_thread(opened.wait, 15))
                self.assertEqual(errors, [])
                pending = asyncio.create_task(launch_async())
                await asyncio.sleep(0.1)
                self.assertFalse(pending.done(), "同步入口持有名额时异步入口必须等待")
                self.assertEqual(BrowserScheduler(Path(directory) / "pool.sqlite3").status("employee-a")["workspace"]["queued"], 1)
                release.set()
                browser = await asyncio.wait_for(pending, 15)
                await browser.close()
            finally:
                release.set()
                await asyncio.to_thread(thread.join, 10)
                if pending and not pending.done():
                    pending.cancel()
                    await asyncio.gather(pending, return_exceptions=True)
            self.assertEqual(errors, [])


class BrowserPoolApiTests(unittest.TestCase):
    def test_status_is_isolated_and_legacy_settings_cannot_restore_global_cap(self):
        # 兼容旧状态查询，但旧页面不能把全站并发上限重新设回去。
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(directory, secure_cookie=False, bootstrap={
                "username": "pool_admin", "password_hash": generate_password_hash("Pool-test-2026"),
            })
            self.addCleanup(app.extensions["workers"].close)
            admin, employee, anonymous = (app.test_client() for _ in range(3))
            admin.post("/api/team/login", json={"username": "pool_admin", "password": "Pool-test-2026"})
            identity = admin.get("/api/team/me").json["data"]
            headers = {"X-CSRF-Token": identity["csrf"]}
            response = admin.get("/api/team/browser-pool")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(anonymous.get("/api/team/browser-pool").status_code, 401)
            self.assertEqual(admin.put("/api/team/browser-pool", json={"max_concurrent": 3}).status_code, 403)
            for invalid in (0, -1, True, 1.5, "4", None):
                self.assertEqual(admin.put("/api/team/browser-pool", headers=headers,
                    json={"max_concurrent": invalid}).status_code, 400)
            self.assertEqual(admin.put("/api/team/browser-pool", headers=headers,
                json={"max_concurrent": 3}).status_code, 400)
            self.assertEqual(admin.put("/api/team/browser-pool", headers=headers,
                json={"mode": "auto"}).status_code, 400)
            admin.post("/api/team/users", headers=headers, json={
                "username": "pool_employee", "display_name": "测试员工", "password": "Pool-test-2026",
            })
            employee.post("/api/team/login", json={"username": "pool_employee", "password": "Pool-test-2026"})
            employee_identity = employee.get("/api/team/me").json["data"]
            self.assertEqual(employee.put("/api/team/browser-pool", headers={
                "X-CSRF-Token": employee_identity["csrf"],
            }, json={"max_concurrent": 9}).status_code, 403)
            own = employee.get("/api/team/browser-pool").json["data"]
            self.assertIsNone(own["max_concurrent"])
            self.assertEqual(own["workspace"], {"running": 0, "queued": 0})
            for private in ("resources", "global", identity["workspace"]["id"], directory):
                self.assertNotIn(private, str(own))
            # 重新建立网关也不能被旧环境变量或历史配置恢复为有限名额。
            restarted = create_app(directory, secure_cookie=False)
            self.addCleanup(restarted.extensions["workers"].close)
            client = restarted.test_client()
            client.post("/api/team/login", json={"username": "pool_admin", "password": "Pool-test-2026"})
            self.assertIsNone(client.get("/api/team/browser-pool").json["data"]["max_concurrent"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
