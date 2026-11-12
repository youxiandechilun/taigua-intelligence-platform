"""Instagram/Facebook 的共用浏览器执行逻辑。

两个平台都没有使用官方 API；登录、资料读取和发布动作全部通过保存的
Playwright 浏览器会话完成。平台页面会变更，因此选择器集中在本文件维护，
失败时保留明确日志，避免把“打开页面”误记成“发布成功”。
"""

from __future__ import annotations

import asyncio
import os
import re
import threading
import time
from pathlib import Path
from queue import Queue

from conf import BASE_DIR
from util._logger import bind_account_name, get_channel_logger

from .._utils import (
    get_account_name_by_cookie_file,
    save_login_result,
    scrape_user_profile,
)
from ..base_platform import BasePlatform
from .._overseas_auth import check_platform_cookie, wait_for_platform_auth, open_login_page


class MetaPlatformBase(BasePlatform):
    """Instagram/Facebook 复用的登录、检查、同步和发布流程。"""

    # 子类覆盖以下平台属性和 URL。
    login_url = ""
    creator_url = ""
    upload_url = ""
    logger_name = "meta"
    cookie_domain = ""
    profile_selectors: tuple[str, ...] = ()
    create_buttons: tuple[str, ...] = ()

    supports_cookie_import = True

    def __init_subclass__(cls, **kwargs):
        """为每个平台建立独立日志器，避免日志都落到 meta 通道。"""
        super().__init_subclass__(**kwargs)
        cls.logger = get_channel_logger(getattr(cls, "logger_name", "meta"))

    @staticmethod
    def _cookie_path(cookie_file: str) -> str:
        """把账号记录里的文件名或绝对路径统一解析为 cookie 文件路径。"""
        path = Path(str(cookie_file or ""))
        return str(path if path.is_absolute() else BASE_DIR / "cookiesFile" / path)

    def _parse_cookie_to_storage_state(self, cookie_str):
        """把浏览器导出的 cookie 字符串转换为 Playwright 状态。"""
        cookies = []
        expires = time.time() + BasePlatform._IMPORT_COOKIE_EXPIRES_SECONDS
        for pair in (cookie_str or "").split(";"):
            pair = pair.strip()
            if not pair or "=" not in pair:
                continue
            name, _, value = pair.partition("=")
            cookies.append({
                "name": name.strip(),
                "value": value.strip(),
                "domain": self.cookie_domain,
                "path": "/",
                "expires": expires,
                "httpOnly": True,
                "secure": True,
                "sameSite": "Lax",
            })
        return cookies, []

    async def _wait_authenticated(self, page, timeout_s: float = 600) -> bool:
        """登录必须有真实会话和可见账号入口，访客页面不能触发保存。"""
        try:
            await wait_for_platform_auth(page, self.platform_key, timeout_s=timeout_s)
            return True
        except TimeoutError:
            return False

    async def _scrape_profile(self, page):
        """优先使用通用资料抓取，失败时从平台个人入口兜底。"""
        try:
            name, avatar = await scrape_user_profile(page, wait_for_ready=False)
        except Exception as exc:
            self.logger.info("通用资料抓取失败: %s", exc)
            name, avatar = "", ""

        if not name:
            for selector in self.profile_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.count():
                        name = (await element.get_attribute("aria-label") or "").strip()
                        if not name:
                            name = (await element.get_attribute("title") or "").strip()
                        if not name:
                            name = (await element.text_content() or "").strip()
                        if name:
                            break
                except Exception:
                    continue

        if not avatar:
            try:
                # ``img`` 没有子元素，不能用 locator.filter(has=...) 查找头像；
                # 直接按图片自身的 alt 属性匹配，兼容中英文页面。
                image = page.locator("img[alt*='profile' i], img[alt*='头像' i]").first
                if await image.count():
                    avatar = (await image.get_attribute("src") or "").strip()
            except Exception:
                pass
        return name, avatar

    async def login(self, id: str, status_queue: Queue, account_id=None) -> None:
        """打开官方登录页，等待用户完成登录后保存浏览器状态。"""
        browser = await self.create_browser(login_mode=True)
        try:
            context = await self.create_context(browser)
            try:
                page = await context.new_page()
                await open_login_page(page, self.platform_key, self.login_url)
                if not await self._wait_authenticated(page):
                    status_queue.put('{"status":"timeout","msg":"登录超时，请重试"}')
                    return
                await save_login_result(
                    context,
                    page,
                    platform_id=self.platform_id,
                    platform_name=self.platform_name,
                    status_queue=status_queue,
                    scrape_fn=self._scrape_profile,
                    account_id=account_id,
                )
            finally:
                await context.close()
        finally:
            # 登录超时或用户取消时也要回收可见浏览器，避免后台遗留进程。
            await self.close_browser(browser)

    async def check_cookie(self, cookie_file: str) -> bool:
        """在平台个人主页检测授权，不要求 Facebook 商业后台权限。"""
        return await check_platform_cookie(self, self._cookie_path(cookie_file))

    async def sync_profile(self, cookie_file: str) -> dict:
        """同步昵称和头像，失败时返回空数据而不伪造资料。"""
        cookie_path = self._cookie_path(cookie_file)
        browser = await self.create_browser(headless=True)
        try:
            context = await self.create_context(browser, storage_state=cookie_path)
            try:
                page = await context.new_page()
                await page.goto(self.creator_url, wait_until="domcontentloaded", timeout=30000)
                name, avatar = await self._scrape_profile(page)
                return {"name": name, "avatar": avatar, "stats": []}
            finally:
                await context.close()
        except Exception as exc:
            self.logger.info("资料同步失败: %s", exc)
            return {"name": "", "avatar": "", "stats": []}
        finally:
            await self.close_browser(browser)

    async def _open_creator_center_async(self, cookie_file: str) -> None:
        """使用保存的登录态打开创作中心，供同步线程调用。"""
        cookie_path = self._cookie_path(cookie_file)
        browser = await self.create_browser(headless=False)
        try:
            context = await self.create_context(browser, storage_state=cookie_path)
            page = await context.new_page()
            await page.goto(self.creator_url, wait_until="domcontentloaded")
            # 创作中心由用户继续操作，不能在页面打开后立即关闭。
            await page.wait_for_event("close", timeout=0)
        finally:
            await self.close_browser(browser)

    async def open_creator_center(self, cookie_file: str) -> None:
        """在独立可见浏览器中打开平台创作中心。

        路由层统一使用 ``asyncio.run(platform.open_creator_center(...))``，
        因此这里必须保持异步接口；实际浏览器继续放在独立线程中运行。
        """
        thread = threading.Thread(
            target=lambda: asyncio.run(self._open_creator_center_async(cookie_file)),
            daemon=True,
        )
        thread.start()

    async def _click_first(self, page, selectors: tuple[str, ...], label: str) -> bool:
        """按候选选择器点击第一个可见控件。"""
        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if await locator.count() and await locator.is_visible():
                    await locator.click(timeout=10000)
                    self.logger.info("已点击 %s: %s", label, selector)
                    return True
            except Exception:
                continue
        return False

    async def _set_caption(self, page, text: str) -> None:
        """填写标题/说明；Instagram 和 Facebook 均以 contenteditable 为主。"""
        if not text:
            return
        candidates = (
            "textarea[aria-label*='caption' i]",
            "textarea[aria-label*='description' i]",
            "div[contenteditable='true'][role='textbox']",
            "div[contenteditable='true']",
            "textarea",
        )
        for selector in candidates:
            try:
                field = page.locator(selector).first
                if await field.count() and await field.is_visible():
                    await field.fill(text)
                    return
            except Exception:
                continue
        raise RuntimeError(f"{self.platform_name} 未找到说明输入框")

    async def _publish_one(self, file_path: str, account_file: str, title: str, desc: str, tags) -> None:
        """使用一个账号上传一个视频并点击发布。"""
        if not file_path or not os.path.exists(file_path):
            raise FileNotFoundError(f"视频文件不存在: {file_path}")
        browser = await self.create_browser(headless=False, humanize=True)
        try:
            context = await self.create_context(browser, storage_state=account_file)
            page = await context.new_page()
            await page.goto(self.upload_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            await self._click_first(page, self.create_buttons, "创建/发布入口")

            file_input = page.locator("input[type='file']").first
            await file_input.wait_for(state="attached", timeout=15000)
            await file_input.set_input_files(file_path)
            await asyncio.sleep(3)

            caption = title or ""
            if desc:
                caption = f"{caption}\n{desc}" if caption else desc
            if tags:
                parsed = tags if isinstance(tags, list) else re.split(r"[,，#]", str(tags))
                hashtags = " ".join(f"#{str(tag).strip().lstrip('#')}" for tag in parsed if str(tag).strip())
                if hashtags:
                    caption = f"{caption}\n{hashtags}" if caption else hashtags
            await self._set_caption(page, caption)

            published = await self._click_first(
                page,
                (
                    "button:has-text('Share')",
                    "button:has-text('Publish')",
                    "button:has-text('Post')",
                    "button:has-text('分享')",
                    "button:has-text('发布')",
                    "[role='button']:has-text('Share')",
                    "[role='button']:has-text('Publish')",
                ),
                "发布按钮",
            )
            if not published:
                raise RuntimeError(f"{self.platform_name} 未找到发布按钮，已停止提交")
            await asyncio.sleep(4)
        finally:
            await self.close_browser(browser)

    async def _upload_all(self, **kwargs) -> None:
        """按视频和账号串行执行，避免一个员工打开多个平台浏览器。"""
        files = [str(item) for item in (kwargs.get("files") or [])]
        account_files = [str(item) for item in (kwargs.get("account_file") or [])]
        if not files or not account_files:
            raise ValueError(f"{self.platform_name} 发布需要视频文件和账号登录态")
        schedule_time = kwargs.get("schedule_time_str") or ""
        # 浏览器执行器目前没有稳定的 Meta 定时控件；开启定时或传入时间都必须
        # 明确失败，避免任务中心把立即发布误记成服务器定时成功。
        if kwargs.get("enableTimer") or schedule_time:
            # 目前没有针对 Meta 的稳定定时 UI，不能把立即发布伪装成定时成功。
            raise RuntimeError(f"{self.platform_name} 暂不支持浏览器定时发布，请先使用立即发布")
        for file_path in files:
            for cookie_name in account_files:
                cookie_path = self._cookie_path(cookie_name)
                nick = get_account_name_by_cookie_file(Path(cookie_path).name)
                with bind_account_name(nick or "-"):
                    await self._publish_one(
                        file_path=file_path,
                        account_file=cookie_path,
                        title=kwargs.get("title", ""),
                        desc=kwargs.get("desc", ""),
                        tags=kwargs.get("tags", []),
                    )

    def publish_video(self, **kwargs) -> bool:
        """同步入口：提交到现有后台浏览器任务队列。"""
        asyncio.run(self._upload_all(**kwargs))
        return True
