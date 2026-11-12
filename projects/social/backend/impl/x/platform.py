"""X 平台的浏览器登录、账号同步和视频发布适配器。

X 没有使用 API；所有动作都通过保存的浏览器登录态在网页中完成。
平台页面经常调整 DOM，因此这里集中维护多个候选选择器，并在失败时保留清晰日志。
"""

from __future__ import annotations

import asyncio
import os
import threading
import time
from pathlib import Path
from queue import Queue

from conf import BASE_DIR
from util._logger import get_channel_logger

from .._browser import create_browser_sync, create_context_sync
from .._utils import (
    clear_and_type,
    save_login_result,
)
from ..base_platform import BasePlatform
from .._overseas_auth import check_platform_cookie, wait_for_platform_auth, open_login_page

logger = get_channel_logger("x")
X_HOME_URL = "https://x.com/home"
X_LOGIN_URL = "https://x.com/i/flow/login"
X_COMPOSE_URL = "https://x.com/compose/post"


def _cookie_path(cookie_file: str) -> str:
    """把数据库里的 cookie 文件名转换为绝对路径。"""
    path = Path(cookie_file)
    return str(path if path.is_absolute() else BASE_DIR / "cookiesFile" / path)


async def _scrape_x_profile(page):
    """从 X 首页提取显示名称和头像；找不到时返回空值。"""
    try:
        result = await page.evaluate(
            """() => {
              const avatar = document.querySelector(
                'img[src*="pbs.twimg.com/profile_images"], img[alt*="avatar" i]'
              );
              const user = document.querySelector('[data-testid="UserName"]');
              const profileLink = document.querySelector('a[href^="/"][href*="/photo"]');
              const text = (user?.innerText || profileLink?.innerText || '').split('\\n').map(x => x.trim()).filter(Boolean);
              const name = text.find(x => !x.startsWith('@')) || '';
              return { name, avatar: avatar?.src || '' };
            }"""
        )
        return (result.get("name", ""), result.get("avatar", ""))
    except Exception as exc:
        logger.info("X 资料解析失败: %s", exc)
        return "", ""


class XPlatform(BasePlatform):
    """X 网页版适配器。"""

    platform_id = 103
    platform_key = "x"
    platform_name = "X"
    supports_cookie_import = True
    platform_cookie_domain = ".x.com"

    def _parse_cookie_to_storage_state(self, cookie_str):
        """解析浏览器导出的 cookie，供 X 登录态导入。"""
        cookies = []
        expires = time.time() + BasePlatform._IMPORT_COOKIE_EXPIRES_SECONDS
        for pair in cookie_str.split(";"):
            pair = pair.strip()
            if not pair or "=" not in pair:
                continue
            name, _, value = pair.partition("=")
            cookies.append({
                "name": name.strip(), "value": value.strip(),
                "domain": self.platform_cookie_domain, "path": "/",
                "expires": expires, "httpOnly": True, "secure": True, "sameSite": "Lax",
            })
        return cookies, []

    async def login(self, id: str, status_queue: Queue, account_id=None) -> None:
        """打开 X 登录页，等待用户完成登录后保存浏览器状态。"""
        browser = await self.create_browser(headless=False, login_mode=True)
        context = None
        try:
            context = await self.create_context(browser)
            page = context.pages[0] if context.pages else await context.new_page()
            await open_login_page(page, self.platform_key, X_LOGIN_URL)
            await self._wait_until_logged_in(page)
            await save_login_result(
                context, page, self.platform_id, self.platform_name, status_queue,
                scrape_fn=_scrape_x_profile, account_id=account_id,
            )
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
            # 成功、超时和用户取消都统一回收浏览器，避免登录失败留下孤儿进程。
            await self.close_browser(browser, is_close_by_code=True)

    async def _wait_until_logged_in(self, page, timeout_seconds: int = 900):
        """通用可点击元素和公开主页不能触发登录完成。"""
        await wait_for_platform_auth(page, self.platform_key, timeout_s=timeout_seconds)

    async def check_cookie(self, cookie_file: str) -> bool:
        """确认实际会话，连接失败或安全验证不会改写账号状态。"""
        return await check_platform_cookie(self, _cookie_path(cookie_file))

    async def open_creator_center(self, cookie_file: str) -> None:
        """打开 X 发帖页，供用户查看和手动操作。"""
        cookie_path = _cookie_path(cookie_file)

        def _launch():
            browser = create_browser_sync(headless=False)
            try:
                context = create_context_sync(browser, storage_state=cookie_path)
                page = context.new_page()
                page.goto(X_COMPOSE_URL)
                try:
                    page.wait_for_event("close", timeout=0)
                except Exception:
                    pass
            finally:
                try:
                    browser.close()
                except Exception:
                    pass

        threading.Thread(target=_launch, daemon=True).start()

    async def sync_profile(self, cookie_file: str):
        """同步 X 的显示名称和头像。"""
        browser = await self.create_browser(headless=True)
        try:
            context = await self.create_context(browser, storage_state=_cookie_path(cookie_file))
            page = await context.new_page()
            await page.goto(X_HOME_URL, wait_until="domcontentloaded", timeout=30_000)
            name, avatar = await _scrape_x_profile(page)
            return {"name": name, "avatar": avatar, "stats": []}
        except Exception as exc:
            logger.info("X 同步资料失败: %s", exc)
            return {"name": "", "avatar": "", "stats": []}
        finally:
            await self.close_browser(browser, is_close_by_code=True)

    async def publish_video(self, **kwargs) -> bool:
        """通过 X 网页发一条视频帖子。

        X 的定时帖子入口与账号权限相关，当前先拒绝定时参数，避免把定时任务误当成即时发布。
        """
        title = (kwargs.get("title") or "").strip()
        desc = (kwargs.get("desc") or kwargs.get("description") or "").strip()
        tags = kwargs.get("tags") or []
        files = [str(x) for x in (kwargs.get("files") or []) if x]
        accounts = kwargs.get("account_file") or []
        # X 网页端目前没有稳定的定时控件；显式失败，避免立即发布被误记为定时成功。
        if kwargs.get("enableTimer") or kwargs.get("schedule_time_str"):
            raise RuntimeError("X 暂不支持浏览器定时发布，请先使用立即发布")
        if not files or not accounts:
            raise ValueError("X 发布需要视频文件和账号登录态")
        missing = [path for path in files if not os.path.exists(path)]
        if missing:
            raise FileNotFoundError(f"X 视频文件不存在: {missing[0]}")
        text = " ".join(x for x in [title, desc, " ".join(f"#{str(t).lstrip('#')}" for t in tags)] if x).strip()
        for video_file in files:
            for account_file in accounts:
                await self._publish_one(video_file, text, _cookie_path(str(account_file)))
        return True

    async def _publish_one(self, video_file: str, text: str, cookie_path: str):
        browser = await self.create_browser(headless=False, humanize=True)
        try:
            context = await self.create_context(browser, storage_state=cookie_path)
            page = await context.new_page()
            await page.goto(X_COMPOSE_URL, wait_until="domcontentloaded", timeout=30_000)
            if "/i/flow/login" in (page.url or ""):
                raise RuntimeError("X 登录态已失效")
            file_input = page.locator('input[type="file"]').first
            await file_input.wait_for(state="attached", timeout=20_000)
            await file_input.set_input_files(video_file)
            composer = page.locator('[data-testid="tweetTextarea_0"], div[role="textbox"][contenteditable="true"]').first
            await composer.wait_for(state="visible", timeout=20_000)
            if text:
                await clear_and_type(page, text, element=composer)
            post_button = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first
            await post_button.wait_for(state="visible", timeout=20_000)
            await post_button.click()
            await asyncio.sleep(3)
            await context.storage_state(path=cookie_path)
        finally:
            await self.close_browser(browser, is_close_by_code=True)
