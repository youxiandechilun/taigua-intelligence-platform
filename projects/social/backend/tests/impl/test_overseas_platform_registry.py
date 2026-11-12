"""海外平台浏览器适配器的无浏览器回归检查。"""

import inspect

from impl.registry import get_platform, iter_platforms


OVERSEAS_PLATFORMS = {
    7: ("tiktok", "TikTok"),
    8: ("youtube", "YouTube"),
    101: ("instagram", "Instagram"),
    102: ("facebook", "Facebook"),
    103: ("x", "X"),
    104: ("linkedin", "LinkedIn"),
    105: ("threads", "Threads"),
    106: ("pinterest", "Pinterest"),
}


def test_overseas_platforms_are_registered():
    """八个平台必须注册到统一执行器，避免登录后落到官方跳转页。"""
    registered = {
        item["platform_id"]: (item["platform_key"], item["platform_name"])
        for item in iter_platforms()
        if item["platform_id"] in OVERSEAS_PLATFORMS
    }
    assert registered == OVERSEAS_PLATFORMS

    for platform_id, (platform_key, platform_name) in OVERSEAS_PLATFORMS.items():
        adapter = get_platform(platform_id)
        assert adapter is not None
        assert adapter.platform_key == platform_key
        assert adapter.platform_name == platform_name
        assert adapter.supports_cookie_import is True
        # /openCreatorCenter 路由统一用 asyncio.run 调用，所有海外平台必须提供异步入口。
        assert inspect.iscoroutinefunction(adapter.open_creator_center)
