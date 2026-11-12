"""平台内部接口客户端及明确的配置边界。"""

from __future__ import annotations

from dataclasses import dataclass
import os
from typing import TypedDict
from urllib.parse import urlsplit

import requests


class PlatformIdentity(TypedDict):
    mid: str
    merchant_name: str
    agent_id: int
    slug: str
    balance: int
    expire_at: float
    external_user_id: str
    session_token: str


class ModelConfig(TypedDict):
    enabled: bool
    base_url: str
    api_key: str
    model: str
    timeout_seconds: int


@dataclass
class PlatformError(Exception):
    message: str
    status: int = 503
    code: str = "PLATFORM_UNAVAILABLE"


class PlatformClient:
    def __init__(self, base_url: str = "", internal_key: str = "", slug: str = "ztgj"):
        self.base_url = base_url.rstrip("/")
        self.internal_key = internal_key
        self.slug = slug
        self.enabled = bool(self.base_url)
        if self.base_url and urlsplit(self.base_url).scheme not in {"http", "https"}:
            raise ValueError("平台地址必须使用 HTTP 或 HTTPS")
        if self.slug not in {"ztgj", "ztwj"}:
            raise ValueError("社媒产品编号无效")

    @classmethod
    def from_environment(cls) -> "PlatformClient":
        return cls(os.environ.get("TAIGUA_PLATFORM_URL", ""),
                   os.environ.get("INTERNAL_API_KEY", ""),
                   os.environ.get("TAIGUA_AGENT_SLUG", "ztgj"))

    def for_slug(self, slug: str) -> "PlatformClient":
        if slug not in {"ztgj", "ztwj"}:
            raise PlatformError("社媒产品编号无效", 400, "INVALID_AGENT")
        return PlatformClient(self.base_url, self.internal_key, slug)

    @classmethod
    def from_request(cls) -> "PlatformClient":
        from flask import has_request_context, request
        client = cls.from_environment()
        if has_request_context():
            return client.for_slug(request.headers.get("X-Taigua-Agent", client.slug))
        return client

    def call(self, method: str, path: str, payload: dict[str, str | int | float] | None = None):
        if not self.enabled or not self.internal_key:
            raise PlatformError("平台连接尚未配置", 503, "PLATFORM_UNCONFIGURED")
        try:
            response = requests.request(method, self.base_url + "/api/internal/" + path,
                headers={"X-Internal-Key": self.internal_key},
                json=payload if method != "GET" else None,
                params=payload if method == "GET" else None,
                timeout=(3, 15), allow_redirects=False)
        except requests.RequestException as exc:
            raise PlatformError("平台暂时不可用，请稍后重试") from exc
        try:
            result = response.json()
        except ValueError as exc:
            raise PlatformError("平台返回格式无效") from exc
        finally:
            response.close()
        if not isinstance(result, dict):
            raise PlatformError("平台返回格式无效")
        if not response.ok or result.get("ok") is not True:
            raise PlatformError(str(result.get("msg") or "平台请求失败"),
                                response.status_code if response.status_code >= 400 else 502,
                                str(result.get("code") or "PLATFORM_ERROR"))
        return result.get("data")

    def identity(self, token: str, redeem: bool = False) -> PlatformIdentity:
        data = self.call("POST", "sso/redeem" if redeem else "sso/validate",
                         {"token": token, "agent_slug": self.slug})
        if not isinstance(data, dict):
            raise PlatformError("平台身份格式无效")
        mid = data.get("mid")
        expiry = data.get("expire_at")
        if not isinstance(mid, (str, int)) or not str(mid) or not isinstance(expiry, (int, float)):
            raise PlatformError("平台身份字段不完整")
        agent_id = data.get("agent_id")
        if not isinstance(agent_id, int) or data.get("slug") != self.slug:
            raise PlatformError("平台产品身份不匹配", 403, "AGENT_MISMATCH")
        session_token = data.get("session_token", token)
        if not isinstance(session_token, str) or not session_token:
            raise PlatformError("平台会话无效", 401, "SESSION_INVALID")
        balance = data.get("balance", 0)
        if not isinstance(balance, int):
            raise PlatformError("平台余额格式无效")
        return {"mid": str(mid), "merchant_name": str(data.get("merchant_name") or mid),
                "agent_id": agent_id, "slug": self.slug, "balance": balance,
                "expire_at": float(expiry), "external_user_id": str(data.get("external_user_id") or mid),
                "session_token": session_token}

    def model_config(self) -> ModelConfig:
        data = self.call("GET", "config", {"slug": self.slug})
        config = data.get("model", {}) if isinstance(data, dict) else {}
        if not isinstance(config, dict):
            raise PlatformError("模型配置格式无效")
        timeout = config.get("timeout_seconds", 30)
        if not isinstance(timeout, int) or not 1 <= timeout <= 120:
            timeout = 30
        return {"enabled": config.get("enabled") is True,
                "base_url": str(config.get("base_url") or ""),
                "api_key": str(config.get("api_key") or ""),
                "model": str(config.get("model") or ""), "timeout_seconds": timeout}

    def notification_url(self) -> str:
        data = self.call("GET", "config", {"slug": self.slug})
        config = data.get("notifications", {}) if isinstance(data, dict) else {}
        return str(config.get("webhook_url") or "") if isinstance(config, dict) else ""
