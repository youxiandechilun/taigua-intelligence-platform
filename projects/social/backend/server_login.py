"""泰卦服务器登录桥接：展示真实平台页面，限定输入，并回收取消的浏览器。"""

import asyncio
import base64
from contextvars import ContextVar
import io
import json
import logging
import math
from queue import Queue
import threading
from urllib.parse import urlsplit
import uuid

from PIL import Image

current_login = ContextVar("taigua_platform_login", default=None)
TERMINAL = {"200", "500", "0", "error", "failed", "cancelled", "timeout"}
logger = logging.getLogger(__name__)


def terminal_status(message):
    try:
        payload = json.loads(message)
        status = str(payload.get("status", "")) if isinstance(payload, dict) else str(payload)
    except (TypeError, ValueError):
        status = str(message)
    return status if status in TERMINAL else None


class LoginMessages(Queue):
    def __init__(self):
        super().__init__()
        self.terminal = None

    def put(self, item, *args, **kwargs):
        status = terminal_status(item)
        if status:
            self.terminal = status
        # 只保留少量尚未发出的画面；结果和错误永不因画面积压丢失。
        if not status and self.qsize() > 4:
            return
        super().put(item, *args, **kwargs)


class LoginSession:
    def __init__(self, identifier, platform, account_id=None, timeout=600):
        self.identifier, self.platform, self.account_id = identifier, platform, account_id
        self.timeout = timeout
        self.messages = LoginMessages()
        self.browsers = []
        self.loop = self.task = self.page = None
        self.frame_id = None
        self.page_url = None
        self.width = self.height = 0
        self.cancelled = False
        self.waiting_for_browser = False
        self.done = threading.Event()
        self.lock = None

    def emit(self, status, msg="", **data):
        self.messages.put(json.dumps({"status": status, "msg": msg, "session_id": self.identifier, **data}))

    def attach_browser(self, browser):
        self.browsers.append(browser)

    def progress(self, message):
        self.emit("waiting", message)

    def cancel(self):
        if self.done.is_set() or self.messages.terminal:
            return
        self.cancelled = True
        if self.loop and self.task:
            try:
                self.loop.call_soon_threadsafe(self.task.cancel)
            except RuntimeError:
                pass

    def run(self):
        try:
            asyncio.run(self._run())
        finally:
            self.done.set()

    async def _run(self):
        self.loop, self.task = asyncio.get_running_loop(), asyncio.current_task()
        self.lock = asyncio.Lock()
        token = current_login.set(self)
        monitor = asyncio.create_task(self._monitor())
        try:
            if self.cancelled:
                raise asyncio.CancelledError()
            self.progress("正在打开平台登录页，请稍候")
            await asyncio.wait_for(self.platform.login(self.identifier, self.messages, account_id=self.account_id), self.timeout)
            if not self.messages.terminal:
                self.emit("error", "平台登录流程已结束，未取得登录结果，请重试")
        except asyncio.TimeoutError:
            if not self.messages.terminal:
                self.emit("timeout", "登录等待已超时，请重新打开登录页面")
        except asyncio.CancelledError:
            if not self.messages.terminal:
                self.emit("cancelled", "已取消平台登录")
        except Exception as exc:
            logger.warning("平台 %s 登录异常：%s", self.platform.platform_key, type(exc).__name__)
            if not self.messages.terminal:
                self.emit("error", "平台登录页加载失败，请重试（" + type(exc).__name__ + "）")
        finally:
            monitor.cancel()
            await asyncio.gather(monitor, return_exceptions=True)
            # 无论成功、失败、超时还是关闭弹窗，都释放员工和全站浏览器名额。
            for browser in reversed(self.browsers):
                try:
                    browser._is_close_by_code = True
                    await asyncio.wait_for(browser.close(), timeout=10)
                except (Exception, asyncio.CancelledError):
                    pass
            self.page = None
            current_login.reset(token)

    async def _monitor(self):
        while True:
            if self.messages.terminal:
                return
            pages = []
            for browser in self.browsers:
                contexts = getattr(browser, "contexts", [browser])
                for context in contexts:
                    pages.extend(p for p in context.pages if not p.is_closed())
            if pages:
                page = pages[-1]
                # 页面跳转后旧画面上的点击失效，防止操作落在另一个页面。
                if page != self.page or page.url != self.page_url:
                    self.page, self.frame_id = page, uuid.uuid4().hex
                    self.page_url = page.url
                try:
                    async with self.lock:
                        frame = await page.screenshot(type="jpeg", quality=85, timeout=4000)
                        with Image.open(io.BytesIO(frame)) as image:
                            self.width, self.height = image.size
                    if not self.messages.terminal:
                        self.emit("page", "使用对应平台手机 App 扫码；可直接点击下方页面切换登录方式", frame_id=self.frame_id,
                                  image="data:image/jpeg;base64," + base64.b64encode(frame).decode(),
                                  width=self.width, height=self.height, host=urlsplit(page.url).hostname or "")
                except Exception:
                    self.progress("平台页面正在加载或跳转，请稍候")
            else:
                self.progress("任务已排队，等待当前员工任务结束或全站名额空闲" if self.waiting_for_browser
                              else "正在打开当前员工的平台登录页面")
            await asyncio.sleep(1.5)

    def send_input(self, payload):
        if not self.loop or not self.page or self.done.is_set() or self.messages.terminal:
            raise ValueError("登录页面尚未就绪或已结束")
        action = self._validate_input(payload)
        coroutine = self._input(action)
        try:
            future = asyncio.run_coroutine_threadsafe(coroutine, self.loop)
        except RuntimeError:
            coroutine.close()
            raise ValueError("登录页面已结束") from None
        try:
            future.result(timeout=7)
        except Exception:
            future.cancel()
            raise ValueError("页面已变化或操作未完成，请等待新画面后重试") from None

    def _validate_input(self, payload):
        # 输入只作用于当前登录页面，绝不接受脚本、任意 URL 或文件路径。
        if not isinstance(payload, dict) or payload.get("frame_id") != self.frame_id:
            raise ValueError("页面已变化，请等待新画面后重试")
        kind = payload.get("kind")
        if kind in {"click", "drag"}:
            names = ("x", "y", "end_x", "end_y") if kind == "drag" else ("x", "y")
            for name in names:
                value = payload.get(name)
                bound = self.width if name.endswith("x") else self.height
                if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value < bound:
                    raise ValueError("点击位置无效")
            return {name: payload[name] for name in names} | {"kind": kind, "frame_id": self.frame_id}
        if kind == "text" and isinstance(payload.get("text"), str) and 0 < len(payload["text"]) <= 512:
            return {"kind": kind, "text": payload["text"], "frame_id": self.frame_id}
        if kind == "key" and payload.get("key") in {"Tab", "Shift+Tab", "Enter", "Backspace", "Escape", "Control+A"}:
            return {"kind": kind, "key": payload["key"], "frame_id": self.frame_id}
        if kind == "scroll" and payload.get("direction") in {"up", "down"}:
            return {"kind": kind, "direction": payload["direction"], "frame_id": self.frame_id}
        raise ValueError("不支持的页面操作")

    async def _input(self, action):
        async with self.lock:
            if (action["frame_id"] != self.frame_id or self.messages.terminal
                    or not self.page or self.page.is_closed() or self.page.url != self.page_url):
                raise ValueError("页面已变化")
            page, kind = self.page, action["kind"]
            if kind == "click":
                await page.mouse.click(action["x"], action["y"])
            elif kind == "drag":
                await page.mouse.move(action["x"], action["y"])
                await page.mouse.down()
                try:
                    await page.mouse.move(action["end_x"], action["end_y"], steps=20)
                finally:
                    await page.mouse.up()
            elif kind == "text":
                await page.keyboard.insert_text(action["text"])
            elif kind == "key":
                await page.keyboard.press(action["key"])
            elif kind == "scroll":
                await page.mouse.wheel(0, 500 if action["direction"] == "down" else -500)


class LoginSessions:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def start(self, identifier, platform, account_id=None):
        with self.lock:
            self.sessions = {key: value for key, value in self.sessions.items() if not value.done.is_set()}
            if identifier in self.sessions or len(self.sessions) >= 2:
                raise ValueError("已有登录任务，请先取消或完成当前任务")
            session = LoginSession(identifier, platform, account_id)
            self.sessions[identifier] = session
        threading.Thread(target=session.run, daemon=True).start()
        return session

    def get(self, identifier):
        with self.lock:
            return self.sessions.get(identifier)


def install_server_login(app):
    """路由仍处于员工工作区中，由网关与工作区令牌共同保护。"""
    from flask import jsonify, request
    manager = LoginSessions()
    app.extensions["platform_logins"] = manager

    @app.post("/api/platform-login/<identifier>/input")
    def platform_login_input(identifier):
        session = manager.get(identifier)
        if not session:
            return jsonify(code=404, msg="登录任务不存在或已结束"), 404
        try:
            session.send_input(request.get_json(silent=True))
        except ValueError as exc:
            return jsonify(code=400, msg=str(exc)), 400
        return jsonify(code=200, msg="已发送页面操作")

    @app.post("/api/platform-login/<identifier>/cancel")
    def platform_login_cancel(identifier):
        session = manager.get(identifier)
        if session:
            session.cancel()
        return jsonify(code=200, msg="已取消平台登录")

    return manager
