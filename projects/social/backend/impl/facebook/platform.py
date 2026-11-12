"""Facebook 浏览器执行适配器。"""

from ..meta.platform import MetaPlatformBase


class FacebookPlatform(MetaPlatformBase):
    """通过 Facebook/Meta Business 官方网页执行登录、同步和视频发布。"""

    platform_id = 102
    platform_key = "facebook"
    platform_name = "Facebook"
    logger_name = "facebook"
    cookie_domain = ".facebook.com"
    login_url = "https://www.facebook.com/login/"
    creator_url = "https://business.facebook.com/"
    upload_url = "https://www.facebook.com/reel/"
    profile_selectors = (
        "[aria-label*='Your profile' i]",
        "[aria-label*='Profile' i]",
        "div[role='banner'] img",
        "a[href*='/profile.php']",
    )
    create_buttons = (
        "button:has-text('Create reel')",
        "a:has-text('Create reel')",
        "button:has-text('Create')",
        "[aria-label*='Create reel' i]",
    )
