"""平台授权必须落到真实创作中心，切换登录方式或打开帮助页不算成功。"""

import asyncio
from urllib.parse import urlsplit


def is_creator_landing(url, host, prefixes):
    parsed = urlsplit(url)
    return (parsed.scheme == "https" and parsed.hostname == host
            and parsed.path.startswith(prefixes)
            and not any(word in parsed.path.lower() for word in ("login", "signin", "passport")))


async def wait_for_creator_login(page, host, prefixes, timeout_s=600):
    """连续确认三次创作中心地址，排除扫码后的临时重定向。"""
    deadline = asyncio.get_running_loop().time() + timeout_s
    stable, previous = 0, ""
    while asyncio.get_running_loop().time() < deadline:
        if page.is_closed():
            raise RuntimeError("平台登录页面已关闭")
        url = page.url or ""
        stable = stable + 1 if url == previous and is_creator_landing(url, host, prefixes) else 0
        if stable >= 3:
            return
        previous = url
        await asyncio.sleep(0.5)
    raise asyncio.TimeoutError("未确认平台授权完成")
