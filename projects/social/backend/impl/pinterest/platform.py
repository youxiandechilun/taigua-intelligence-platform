"""Pinterest 浏览器执行适配器。

Pinterest 的创作者页面会按地区显示不同的按钮文案，因此实现使用语义候选
选择器，并在关键控件缺失时返回明确错误，避免把只打开网页误报成发布成功。
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from queue import Queue

from conf import BASE_DIR
from util._logger import bind_account_name, get_channel_logger

from .._browser import create_browser_sync, create_context_sync
from .._utils import (
    get_account_name_by_cookie_file,
    save_login_result,
)
from ..base_platform import BasePlatform
from .._overseas_auth import check_platform_cookie, inspect_auth_state, wait_for_platform_auth, open_login_page

logger = get_channel_logger("pinterest")

PINTEREST_HOME_URL = "https://www.pinterest.com/"
PINTEREST_LOGIN_URL = "https://www.pinterest.com/login/"
PINTEREST_CREATE_URL = "https://www.pinterest.com/pin-creation-tool/"


def _cookie_path(cookie_file: str) -> str:
    """把账号记录中的文件名或绝对路径统一解析为 cookie 路径。"""
    path = Path(str(cookie_file or ""))
    return str(path if path.is_absolute() else BASE_DIR / "cookiesFile" / path)


class PinterestPlatform(BasePlatform):
    """Pinterest 账号的统一浏览器适配器。"""

    platform_id = 106
    platform_key = "pinterest"
    platform_name = "Pinterest"
    supports_cookie_import = True
    platform_cookie_domain = ".pinterest.com"

    def _parse_cookie_to_storage_state(self, cookie_str):
        """把 cookie 字符串转换为 Pinterest 可用的 storage_state。"""
        cookies = []
        expires = time.time() + BasePlatform._IMPORT_COOKIE_EXPIRES_SECONDS
        for pair in cookie_str.split(";"):
            pair = pair.strip()
            if not pair or "=" not in pair:
                continue
            name, _, value = pair.partition("=")
            cookies.append({
                "name": name.strip(),
                "value": value.strip(),
                "domain": self.platform_cookie_domain,
                "path": "/",
                "expires": expires,
                "httpOnly": True,
                "secure": True,
                "sameSite": "Lax",
            })
        return cookies, []

    async def _is_logged_in(self, page) -> bool:
        """账号入口必须同时有本平台真实会话，公开资料页面不能算已登录。"""
        return await inspect_auth_state(page, self.platform_key) == "authenticated"

    async def _scrape_profile(self, page):
        """从 Pinterest 顶部个人入口抓取昵称和头像。"""
        try:
            return await page.evaluate(
                """() => {
                    const out = {name: '', avatar: ''};
                    const profile = document.querySelector("[data-test-id='header-profile']");
                    const image = profile?.querySelector('img') || document.querySelector("img[alt*='profile' i], img[alt*='头像' i]");
                    if (image) out.avatar = image.currentSrc || image.src || '';
                    const label = profile?.getAttribute('aria-label') || profile?.textContent || '';
                    out.name = label.trim();
                    if (!out.name) {
                      const meta = document.querySelector('meta[property="og:title"]');
                      out.name = (meta?.content || '').trim();
                    }
                    return [out.name, out.avatar];
                }"""
            )
        except Exception as exc:
            logger.info("[同步资料] Pinterest 资料抓取失败: %s", exc)
            return "", ""

    async def login(self, id: str, status_queue: Queue, account_id=None) -> None:
        """连续确认真实登录后才保存，安全验证和访客页面继续等待本人操作。"""
        browser = await self.create_browser(headless=False, login_mode=True)
        context = None
        try:
            context = await self.create_context(browser)
            page = await context.new_page()
            await open_login_page(page, self.platform_key, PINTEREST_LOGIN_URL)
            await wait_for_platform_auth(page, self.platform_key)
            await save_login_result(context, page, self.platform_id, self.platform_name, status_queue,
                                    scrape_fn=self._scrape_profile, account_id=account_id)
        except Exception as exc:
            logger.info("平台登录未完成，错误类型: %s", type(exc).__name__)
            status_queue.put(json.dumps({"status": "failed", "message": "登录尚未完成，请完成平台登录和安全验证后重试。"}))
        finally:
            if context is not None:
                await context.close()
            await self.close_browser(browser, is_close_by_code=True)

    async def check_cookie(self, cookie_file: str) -> bool:
        """网络失败保留原状态，只有确认未登录才判为失效。"""
        return await check_platform_cookie(self, _cookie_path(cookie_file))

    async def sync_profile(self, cookie_file: str) -> dict:
        """同步 Pinterest 昵称和头像。"""
        cookie_path = _cookie_path(cookie_file)
        browser = await self.create_browser(headless=True)
        try:
            context = await self.create_context(browser, storage_state=cookie_path)
            page = await context.new_page()
            await page.goto(PINTEREST_HOME_URL, wait_until="domcontentloaded", timeout=30000)
            name, avatar = await self._scrape_profile(page)
            return {"name": name, "avatar": avatar, "stats": []}
        except Exception as exc:
            logger.info("[同步资料] Pinterest 同步失败: %s", exc)
            return {"name": "", "avatar": "", "stats": []}
        finally:
            await self.close_browser(browser, is_close_by_code=True)

    async def open_creator_center(self, cookie_file: str) -> None:
        """在可见浏览器中打开 Pinterest 创建 Pin 页面。"""
        cookie_path = _cookie_path(cookie_file)

        def _launch():
            browser = create_browser_sync(headless=False)
            try:
                context = create_context_sync(browser, storage_state=cookie_path)
                page = context.new_page()
                page.goto(PINTEREST_CREATE_URL)
                page.wait_for_event("close", timeout=0)
            finally:
                # 用户关闭页面后回收上下文和浏览器，避免后台残留进程。
                try:
                    browser.close()
                except Exception:
                    pass

        import threading

        threading.Thread(target=_launch, daemon=True).start()

    def publish_video(self, **kwargs) -> bool:
        """使用 Pinterest Pin 创建页上传视频并发布。"""
        asyncio.run(self._publish_all(**kwargs))
        return True

    async def _publish_all(self, **kwargs):
        files = [str(item) for item in (kwargs.get("files") or [])]
        accounts = [_cookie_path(str(item)) for item in (kwargs.get("account_file") or [])]
        if not files or not accounts:
            raise ValueError("Pinterest 发布需要视频文件和账号登录态")
        missing = [path for path in files if not os.path.exists(path)]
        if missing:
            raise FileNotFoundError(f"Pinterest 视频文件不存在: {missing[0]}")
        title = (kwargs.get("title") or "").strip()
        desc = (kwargs.get("desc") or "").strip()
        tags = kwargs.get("tags") or []
        # Pinterest 创建 Pin 页当前没有稳定的定时控件，和其他海外平台保持
        # 一致：定时参数直接失败，避免任务状态与实际动作不一致。
        if kwargs.get("enableTimer") or kwargs.get("schedule_time_str"):
            raise RuntimeError("Pinterest 暂不支持浏览器定时发布，请先使用立即发布")
        for file_path in files:
            for cookie in accounts:
                name = get_account_name_by_cookie_file(Path(cookie).name)
                with bind_account_name(name or "-"):
                    await self._publish_one(file_path, cookie, title, desc, tags)

    async def _publish_one(self, file_path, cookie_path, title, desc, tags):
        browser = await self.create_browser(headless=False, humanize=True)
        context = None
        try:
            context = await self.create_context(browser, storage_state=cookie_path)
            page = await context.new_page()
            await page.goto(PINTEREST_CREATE_URL, wait_until="domcontentloaded", timeout=30000)
            if not await self._is_logged_in(page):
                raise RuntimeError("Pinterest Cookie 已失效，请重新登录")
            file_input = page.locator("input[type='file']").first
            if await file_input.count() == 0:
                raise RuntimeError("Pinterest 创建 Pin 页面未找到视频上传控件")
            await file_input.set_input_files(file_path)
            await page.wait_for_timeout(1000)
            title_input = page.locator(
                "input[placeholder*='title' i], input[placeholder*='标题'], [data-test-id='pin-draft-title']"
            ).first
            if await title_input.count() > 0 and title:
                await title_input.fill(title)
            description = "\n".join(filter(None, [desc, " ".join(f"#{tag}" for tag in tags)]))
            desc_input = page.locator(
                "textarea[placeholder*='description' i], textarea[placeholder*='描述'], [contenteditable='true']"
            ).first
            if await desc_input.count() > 0 and description:
                await desc_input.fill(description)
            submit = page.locator(
                "button:has-text('Publish'), button:has-text('发布'), [data-test-id='publish-button']"
            ).last
            if await submit.count() == 0:
                raise RuntimeError("Pinterest 创建 Pin 页面未找到发布按钮")
            await submit.click()
            await page.wait_for_timeout(1500)
            if await page.locator("[role='alert']:has-text('error'), [role='alert']:has-text('失败')").count() > 0:
                raise RuntimeError("Pinterest 页面返回发布失败提示")
        finally:
            if context is not None:
                await context.close()
            await self.close_browser(browser, is_close_by_code=True)

