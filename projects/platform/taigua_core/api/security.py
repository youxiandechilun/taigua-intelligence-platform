"""Cookie写入请求的来源校验；Bearer与内部服务保留各自鉴权。"""
import os
from urllib.parse import urlsplit

from flask import Response, request

from ..errors import PlatformError


def origin(value: str) -> str:
    parsed = urlsplit(value)
    return f"{parsed.scheme}://{parsed.netloc}".lower()


def protect_cookie_write() -> None:
    if request.method in ("GET", "HEAD", "OPTIONS") or not request.path.startswith("/api/"):
        return
    if request.path.startswith("/api/internal/") or request.headers.get("Authorization", "").startswith("Bearer "):
        return
    # 登录同样限制外站浏览器提交；无Origin的后台客户端允许使用账号密码。
    supplied = request.headers.get("Origin", "")
    permitted = {origin(request.host_url)}
    permitted.update(origin(value.strip()) for value in os.environ.get("TAIGUA_TRUSTED_ORIGINS", "").split(",") if value.strip())
    if supplied and origin(supplied) not in permitted:
        raise PlatformError("UNTRUSTED_ORIGIN", "请求来源不受信任，请从平台页面重试", 403)
    if request.headers.get("Sec-Fetch-Site") == "cross-site" and not supplied:
        raise PlatformError("UNTRUSTED_ORIGIN", "请求来源不受信任，请从平台页面重试", 403)


def response_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response
