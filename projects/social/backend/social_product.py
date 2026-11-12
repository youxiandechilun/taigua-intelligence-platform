"""国内与海外社媒工作台共用的产品和平台元数据。"""

from __future__ import annotations

from impl.platform_meta import PLATFORM_META
from taigua_platform import PlatformClient


DOMESTIC_KEYS = ("douyin", "xiaohongshu", "channels", "kuaishou", "bilibili", "weibo", "weixin_gzh")


def domestic_platforms() -> list[dict[str, object]]:
    return [{"key": key, "name": PLATFORM_META[key]["name"],
             "creator_url": PLATFORM_META[key].get("creator_url", ""),
             "content_types": ["video"], "status": "code_ready_unverified",
             "status_text": "浏览器发布已接入，账号状态以最近核验为准",
             "capabilities": {"video": {"supported": True, "status": "code_ready_unverified"}}}
            for key in DOMESTIC_KEYS if key in PLATFORM_META]


def is_domestic() -> bool:
    return PlatformClient.from_request().slug == "ztgj"
