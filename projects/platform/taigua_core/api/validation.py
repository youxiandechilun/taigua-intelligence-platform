from flask import request

from ..billing.models import Charge
from ..errors import PlatformError


def body() -> dict[str, object]:
    value: object = request.get_json(silent=True)
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise PlatformError("INVALID_REQUEST", "请求需要JSON对象")
    return value


def text(payload: dict[str, object], name: str, maximum: int = 180, required: bool = True) -> str:
    value = payload.get(name, "")
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise PlatformError("INVALID_REQUEST", f"{name}格式错误")
    return value.strip()


def integer(payload: dict[str, object], name: str, minimum: int = 1, maximum: int = 1_000_000_000) -> int:
    value = payload.get(name)
    if isinstance(value, str) and value.isascii() and value.isdecimal():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise PlatformError("INVALID_REQUEST", f"{name}需要有效整数")
    return value


def charge(payload: dict[str, object]) -> Charge:
    return Charge(
        merchant_id=integer(payload, "mid"),
        slug=text(payload, "agent_slug", 32),
        action=text(payload, "action", 64),
        quantity=integer(payload, "quantity"),
        request_id=text(payload, "request_id", 180),
        note=text(payload, "note", 500, required=False),
    )
