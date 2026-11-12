from functools import wraps

from flask import Blueprint, jsonify, request

from ..billing import admin as billing_admin
from ..billing import service as billing
from ..config import service as configuration
from ..errors import PlatformError
from ..identity import service as identity
from ..runtime import get_core, request_token
from .validation import body, integer, text

blueprint = Blueprint("platform_public", __name__)


def authenticated(admin: bool = False):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            merchant = identity.parent(get_core(), request_token())
            if not merchant:
                raise PlatformError("SESSION_EXPIRED", "请重新登录", 401)
            if admin and merchant["role"] != "admin":
                raise PlatformError("FORBIDDEN", "需要管理员权限", 403)
            return function(merchant, *args, **kwargs)
        return wrapped
    return decorate


@blueprint.post("/api/agents/enter")
@authenticated()
def enter(merchant):
    payload = body()
    slug = text(payload, "agent_slug", 32)
    _, url = identity.enter(get_core(), request_token(), slug)
    return jsonify(code=0, data={"url": url, "agent_slug": slug})


@blueprint.get("/api/merchant/points")
@authenticated()
def merchant_points(merchant):
    return jsonify(code=0, data=billing.get_balance(get_core(), merchant["id"]))


@blueprint.get("/api/merchant/consumptions")
@authenticated()
def merchant_consumptions(merchant):
    page, size = pagination()
    return jsonify(code=0, data=billing_admin.consumptions(get_core(), merchant["id"], page, size))


@blueprint.get("/api/admin/point-consumptions")
@authenticated(admin=True)
def admin_consumptions(merchant):
    page, size = pagination()
    query = request.args.get("mid")
    mid = integer({"mid": query}, "mid") if query else None
    return jsonify(code=0, data=billing_admin.consumptions(get_core(), mid, page, size))


@blueprint.get("/api/admin/integrations")
@authenticated(admin=True)
def integrations(merchant):
    slug = request.args.get("slug", "global")
    return jsonify(code=0, data=configuration.load(get_core(), slug, masked=True))


@blueprint.put("/api/admin/integrations")
@authenticated(admin=True)
def save_integrations(merchant):
    payload = body()
    slug = text(payload, "slug", 32)
    result = configuration.update(get_core(), slug, payload.get("config"), merchant["id"], merchant["company"])
    return jsonify(code=0, msg="服务配置已保存", data=result)


@blueprint.get("/api/admin/agent-prices")
@authenticated(admin=True)
def prices(merchant):
    return jsonify(code=0, data=billing_admin.prices(get_core()))


@blueprint.put("/api/admin/agent-prices")
@authenticated(admin=True)
def save_price(merchant):
    payload = body()
    billing_admin.update_price(
        get_core(), text(payload, "slug", 32), text(payload, "action", 64),
        integer(payload, "points", minimum=0, maximum=1_000_000),
        integer(payload, "daily_cap", minimum=0), merchant["id"], merchant["company"],
    )
    return jsonify(code=0, msg="收费规则已保存")


def pagination() -> tuple[int, int]:
    page = integer({"page": request.args.get("page", "1")}, "page", maximum=1_000_000)
    size = integer({"pageSize": request.args.get("pageSize", "20")}, "pageSize", maximum=100)
    return page, size
