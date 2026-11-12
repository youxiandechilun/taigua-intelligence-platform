"""Instagram 浏览器执行适配器。"""

from ..meta.platform import MetaPlatformBase


class InstagramPlatform(MetaPlatformBase):
    """通过 Instagram 官方网页执行登录、同步和视频发布。"""

    platform_id = 101
    platform_key = "instagram"
    platform_name = "Instagram"
    logger_name = "instagram"
    cookie_domain = ".instagram.com"
    login_url = "https://www.instagram.com/accounts/login/"
    creator_url = "https://www.instagram.com/"
    upload_url = "https://www.instagram.com/"
    profile_selectors = (
        "header a[href*='/accounts/edit']",
        "header [aria-label*='Profile' i]",
        "svg[aria-label*='Profile' i]",
        "a[href*='/accounts/edit']",
    )
    create_buttons = (
        "button:has-text('Create')",
        "a:has-text('Create')",
        "svg[aria-label='New post']",
        "[aria-label='New post']",
    )
