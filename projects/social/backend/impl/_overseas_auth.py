"""海外授权确认：同时验证平台域名、登录凭据和可见账号入口，拒绝访客页面。"""

import asyncio
import json
from pathlib import Path
import time
from urllib.parse import urlsplit

from playwright.async_api import Error as BrowserError
from util._logger import get_channel_logger

logger = get_channel_logger("overseas-auth")


class AccountCheckUnavailable(RuntimeError):
    """检测未完成时保留原状态，不能把网络或安全验证问题当成 Cookie 失效。"""


# Cookie 只在员工工作区内检查；这里仅配置名称，绝不输出或上传凭据内容。
AUTH_RULES = {
    "facebook": {
        "hosts": ("facebook.com",), "url": "https://www.facebook.com/",
        "cookies": (("c_user", "xs"),),
        "markers": ("[aria-label*='Your profile' i]", "[aria-label*='你的个人主页']",
                    "[aria-label*='你的头像']", "[aria-label='Account']", "[aria-label='账户']"),
        "forms": ("input[name='email']", "input[name='pass']", "button[name='login']"),
    },
    "instagram": {
        "hosts": ("instagram.com",), "url": "https://www.instagram.com/",
        "cookies": (("sessionid", "ds_user_id"),),
        "markers": ("a[href*='/accounts/edit']", "svg[aria-label*='Profile' i]",
                    "[aria-label*='个人主页']", "a:has-text('Profile')", "a:has-text('个人主页')"),
        "forms": ("input[name='username']", "input[name='password']"),
    },
    "x": {
        "hosts": ("x.com", "twitter.com"), "url": "https://x.com/home",
        "cookies": (("auth_token",),),
        "markers": ("[data-testid='SideNav_AccountSwitcher_Button']", "[data-testid='AppTabBar_Profile_Link']"),
        "forms": ("input[autocomplete='current-password']", "input[name='password']"),
    },
    "linkedin": {
        "hosts": ("linkedin.com",), "url": "https://www.linkedin.com/feed/",
        "cookies": (("li_at",),),
        "markers": (".global-nav__me", "button[aria-label*='Me']", "button[aria-label*='我的']",
                    "[data-control-name='identity_welcome_message']"),
        "forms": ("input[name='session_key']", "input[name='session_password']"),
    },
    "pinterest": {
        "hosts": ("pinterest.com",), "url": "https://www.pinterest.com/",
        "cookies": (("_pinterest_sess",),),
        "markers": ("[data-test-id='header-profile']", "a[href*='/settings']", "a[href*='/pin-builder']"),
        "forms": ("input[name='id']", "input[name='password']"),
    },
    "threads": {
        "hosts": ("threads.com", "threads.net"), "url": "https://www.threads.com/",
        "cookies": (("sessionid",),),
        "markers": ("a[aria-label*='Profile' i]", "a[aria-label*='个人主页']",
                    "[role='button'][aria-label*='Create' i]", "button[aria-label*='新建']",
                    "a[href='/settings']"),
        "forms": ("input[name='username']", "input[name='password']"),
    },
    "tiktok": {
        "hosts": ("tiktok.com",), "url": "https://www.tiktok.com/tiktokstudio/upload?lang=en",
        "cookies": (("sessionid",), ("sessionid_ss",), ("sid_tt",)),
        "markers": ("[data-tt='NewHome_UserInfo_Hover']", "[data-e2e='profile-icon']",
                    "[data-e2e='top-avatar']", "[data-tt='components_Avatar_AvatarImg']",
                    "[data-e2e='upload-input']"),
        "forms": ("input[type='password']",),
    },
    "youtube": {
        "hosts": ("studio.youtube.com",), "cookie_hosts": ("youtube.com", "google.com"),
        "url": "https://studio.youtube.com/",
        "cookies": (("SID",), ("__Secure-1PSID",), ("__Secure-3PSID",), ("LOGIN_INFO",)),
        "markers": ("ytcp-avatar", "#avatar-btn", "ytcp-entity-page", "ytcp-app #account-menu-button"),
        "forms": ("input[type='email']", "input[type='password']"),
    },
}


def _matches_host(host, allowed):
    """按完整域名边界匹配，不能将带平台名称的外部页面当作登录成功。"""
    return any(host == item or host.endswith("." + item) for item in allowed)


def has_auth_cookies(cookies, key):
    """至少存在一组未过期的真实会话 Cookie，访客和跟踪 Cookie 不计入。"""
    rule = AUTH_RULES[key]
    names = set()
    for cookie in cookies:
        try:
            expiry = float(cookie.get("expires", -1))
            domain = str(cookie.get("domain", "")).lstrip(".").lower()
            if (cookie.get("value") and (expiry < 0 or expiry > time.time())
                    and _matches_host(domain, rule.get("cookie_hosts", rule["hosts"]))):
                names.add(cookie.get("name"))
        except (TypeError, ValueError):
            continue
    return any(set(group).issubset(names) for group in rule["cookies"])


async def _visible(page, selectors):
    """忽略隐藏模板；单纯匹配到 DOM 节点不能证明当前登录状态。"""
    for selector in selectors:
        if await page.locator(selector).first.is_visible():
            return True
    return False


async def inspect_auth_state(page, key):
    """返回已登录、未登录、需验证或未确认，不把空白页当作成功。"""
    rule = AUTH_RULES[key]
    url = urlsplit(page.url or "")
    host, path = (url.hostname or "").lower(), url.path.lower()
    trusted = url.scheme == "https" and _matches_host(host, rule["hosts"])
    google_login = key == "youtube" and host == "accounts.google.com"
    if not trusted and not google_login:
        return "unverified"
    if any(part in path for part in ("/checkpoint", "/challenge", "/captcha", "/two_factor", "/two-step")):
        return "challenge"
    if google_login or any(part in path for part in ("/login", "/signin", "/signup", "/authwall")):
        return "signed_out"
    if await _visible(page, rule["forms"]):
        return "signed_out"
    if not has_auth_cookies(await page.context.cookies(), key):
        return "signed_out"
    if await _visible(page, rule["markers"]):
        return "authenticated"
    return "unverified"


async def wait_for_platform_auth(page, key, timeout_s=600):
    """等待用户完成真实验证，连续确认后才允许保存账号和自动返回。"""
    deadline = asyncio.get_running_loop().time() + timeout_s
    stable = 0
    while asyncio.get_running_loop().time() < deadline:
        if page.is_closed():
            raise RuntimeError("平台登录页面已关闭，登录未完成")
        try:
            state = await inspect_auth_state(page, key)
        except BrowserError:
            # 登录重定向会暂时销毁页面上下文，下一轮继续确认，不能立即保存或报失效。
            state = "unverified"
        stable = stable + 1 if state == "authenticated" else 0
        if stable >= 3:
            return
        await asyncio.sleep(0.5)
    raise TimeoutError("尚未确认平台登录完成，请完成登录和安全验证后重试")


async def open_login_page(page, key, url):
    """页面开始响应即交给用户，后续渲染由授权确认器等待，避免重复等整页脚本。"""
    started = time.monotonic()
    await page.goto(url, wait_until="commit", timeout=30000)
    logger.info("平台登录页开始响应：%s，耗时 %.2f 秒", key, time.monotonic() - started)


async def check_platform_cookie(platform, cookie_file):
    """检测已保存会话；加载失败与安全验证保留原状态，明确退出才判为失效。"""
    path = Path(cookie_file)
    if not path.is_file():
        return False
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(state, dict) or not has_auth_cookies(state.get("cookies", []), platform.platform_key):
            return False
    except (OSError, ValueError, TypeError):
        return False
    browser = None
    try:
        browser = await platform.create_browser(headless=True)
        context = await platform.create_context(browser, storage_state=str(path))
        try:
            page = await context.new_page()
            await page.goto(AUTH_RULES[platform.platform_key]["url"], wait_until="domcontentloaded", timeout=30000)
            deadline = asyncio.get_running_loop().time() + 15
            previous, stable = "", 0
            while asyncio.get_running_loop().time() < deadline:
                result = await inspect_auth_state(page, platform.platform_key)
                if result == "challenge":
                    raise AccountCheckUnavailable("平台要求安全验证，暂未确认登录状态；请在登录窗口完成验证。")
                stable = stable + 1 if result == previous else 1
                previous = result
                if stable >= 3 and result in {"authenticated", "signed_out"}:
                    return result == "authenticated"
                await asyncio.sleep(0.5)
            raise AccountCheckUnavailable("平台页面尚未就绪，暂未确认登录状态，请稍后重新检查。")
        finally:
            await context.close()
    except AccountCheckUnavailable:
        raise
    except Exception as exc:
        # 底层错误可能带 URL 或请求详情，用户提示仅展示错误类型，不泄露凭据。
        raise AccountCheckUnavailable("平台连接或浏览器检测失败，暂未确认登录状态，请检查网络后重试。") from exc
    finally:
        if browser:
            await platform.close_browser(browser)
