"""Meta 登录回归：只使用合成页面和 Cookie，不连接真实平台账号。"""

import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from impl.facebook.platform import FacebookPlatform
from impl.linkedin.platform import LinkedinPlatform
from impl.pinterest.platform import PinterestPlatform
from impl.registry import get_platform
from impl._overseas_auth import AccountCheckUnavailable, check_platform_cookie, has_auth_cookies, inspect_auth_state


# 合成凭据仅用于验证规则组合，不代表任何真实平台登录。
FIXTURES = {
    "facebook": (102, "https://www.facebook.com/", ".facebook.com", ("c_user", "xs"), "[aria-label*='Your profile' i]"),
    "instagram": (101, "https://www.instagram.com/", ".instagram.com", ("sessionid", "ds_user_id"), "a[href*='/accounts/edit']"),
    "x": (103, "https://x.com/home", ".x.com", ("auth_token",), "[data-testid='SideNav_AccountSwitcher_Button']"),
    "linkedin": (104, "https://www.linkedin.com/feed/", ".linkedin.com", ("li_at",), ".global-nav__me"),
    "pinterest": (106, "https://www.pinterest.com/", ".pinterest.com", ("_pinterest_sess",), "[data-test-id='header-profile']"),
    "threads": (105, "https://www.threads.com/", ".threads.com", ("sessionid",), "a[aria-label*='Profile' i]"),
    "tiktok": (7, "https://www.tiktok.com/tiktokstudio/upload", ".tiktok.com", ("sessionid",), "[data-e2e='profile-icon']"),
    "youtube": (8, "https://studio.youtube.com/channel/synthetic", ".youtube.com", ("SID",), "ytcp-avatar"),
}


def authenticated_page(key, *, cookies=None, visible=True, url=None):
    """用浏览器边界对象提供公开页面和隔离 Cookie，不替换被测状态判断函数。"""
    _, landing, domain, names, marker = FIXTURES[key]
    cookies = cookies if cookies is not None else [
        {"name": name, "value": "synthetic-only", "domain": domain, "expires": -1} for name in names]

    def locator(selector):
        node = SimpleNamespace(is_visible=AsyncMock(return_value=visible and selector == marker))
        node.first = node
        return node

    return SimpleNamespace(url=url or landing, locator=locator, is_closed=lambda: False,
                           context=SimpleNamespace(cookies=AsyncMock(return_value=cookies)))


class MetaAuthenticationTests(unittest.IsolatedAsyncioTestCase):
    """访客页面不能触发登录完成并保存空授权。"""

    async def test_facebook_guest_page_is_not_authenticated(self):
        """即使主页没有登录框且有头像样式元素，也必须拒绝访客 Cookie。"""
        locator = SimpleNamespace(count=AsyncMock(return_value=1), is_visible=AsyncMock(return_value=True))
        locator.first = locator
        page = SimpleNamespace(
            url="https://www.facebook.com/",
            is_closed=lambda: False,
            context=SimpleNamespace(cookies=AsyncMock(return_value=[
                {"name": "datr", "value": "synthetic-visitor", "domain": ".facebook.com", "expires": -1},
            ])),
            locator=lambda selector: locator,
        )
        with patch("impl.meta.platform.asyncio.sleep", new=AsyncMock()):
            self.assertFalse(await FacebookPlatform()._wait_authenticated(page, timeout_s=0.02))

    async def test_public_profile_links_do_not_authenticate_other_platforms(self):
        """公开资料中的个人链接和头像不能证明访问者已经登录。"""
        locator = SimpleNamespace(count=AsyncMock(return_value=1), is_visible=AsyncMock(return_value=True))
        locator.first = locator
        for platform, url in ((LinkedinPlatform(), "https://www.linkedin.com/in/public-person/"),
                              (PinterestPlatform(), "https://www.pinterest.com/public-person/")):
            page = SimpleNamespace(url=url, context=SimpleNamespace(cookies=AsyncMock(return_value=[])),
                                   locator=lambda selector: locator)
            with self.subTest(platform=platform.platform_key):
                self.assertFalse(await platform._is_logged_in(page))

    async def test_all_eight_platforms_require_both_session_and_visible_account(self):
        """凭据与界面缺少任何一项都不能通知登录成功。"""
        for key in FIXTURES:
            with self.subTest(platform=key):
                self.assertEqual(await inspect_auth_state(authenticated_page(key), key), "authenticated")
                self.assertNotEqual(await inspect_auth_state(authenticated_page(key, cookies=[]), key), "authenticated")
                self.assertEqual(await inspect_auth_state(authenticated_page(key, visible=False), key), "unverified")
                self.assertEqual(await inspect_auth_state(authenticated_page(key, url="https://unrelated.invalid/"), key), "unverified")

    async def test_verification_pages_never_complete_login_with_old_cookies(self):
        """账号仍有 Cookie 但停在安全验证页时，必须等本人完成验证。"""
        for key, (_, url, *_rest) in FIXTURES.items():
            with self.subTest(platform=key):
                host = url.split('/')[2]
                self.assertEqual(await inspect_auth_state(authenticated_page(key, url=f"https://{host}/checkpoint/"), key), "challenge")
                self.assertEqual(await inspect_auth_state(authenticated_page(key, url=f"https://{host}/login/"), key), "signed_out")

    async def test_empty_saved_sessions_fail_without_starting_a_browser(self):
        """八个适配器都要拒绝空授权，不能靠主页能打开判有效。"""
        with tempfile.TemporaryDirectory() as directory:
            cookie = Path(directory) / "synthetic.json"
            cookie.write_text('{"cookies": [], "origins": []}')
            for key, (identifier, *_rest) in FIXTURES.items():
                with self.subTest(platform=key):
                    platform = get_platform(identifier)
                    platform.create_browser = AsyncMock()
                    self.assertFalse(await platform.check_cookie(str(cookie)))
                    platform.create_browser.assert_not_awaited()

    async def test_connection_failure_is_unconfirmed_and_releases_browser(self):
        """网络异常不能变成 False，且必须回收本次浏览器。"""
        page = authenticated_page("facebook")
        page.goto = AsyncMock(side_effect=TimeoutError("synthetic network timeout"))
        context = SimpleNamespace(new_page=AsyncMock(return_value=page), close=AsyncMock())
        platform = FacebookPlatform()
        platform.create_browser = AsyncMock(return_value=SimpleNamespace())
        platform.create_context = AsyncMock(return_value=context)
        platform.close_browser = AsyncMock()
        with tempfile.TemporaryDirectory() as directory:
            cookie = Path(directory) / "synthetic.json"
            cookie.write_text(json.dumps({"cookies": await page.context.cookies()}))
            with self.assertRaises(AccountCheckUnavailable):
                await check_platform_cookie(platform, cookie)
        context.close.assert_awaited_once()
        platform.close_browser.assert_awaited_once()

    def test_expired_or_foreign_cookies_are_not_credentials(self):
        """其他网站同名 Cookie、空值和已过期值均不能组成平台登录凭据。"""
        for domain, expiry, value in [(".unrelated.invalid", -1, "synthetic"),
                                      (".facebook.com", time.time()-10, "synthetic"),
                                      (".facebook.com", -1, "")]:
            cookies = [{"name": name, "value": value, "domain": domain, "expires": expiry} for name in ("c_user", "xs")]
            self.assertFalse(has_auth_cookies(cookies, "facebook"))


if __name__ == "__main__":
    unittest.main()
