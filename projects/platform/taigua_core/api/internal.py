from hmac import compare_digest

from flask import Blueprint, jsonify, request

from ..billing import mapper as billing_mapper
from ..billing import service as billing
from ..billing import settlement
from ..config import service as configuration
from ..errors import PlatformError
from ..identity import service as identity
from ..runtime import get_core
from .validation import body, charge, integer, text

blueprint = Blueprint("platform_internal", __name__, url_prefix="/api/internal")


@blueprint.before_request
def authorize() -> None:
    core = get_core()
    if len(core.internal_key) < 24:
        raise PlatformError("CONFIGURATION_REQUIRED", "平台内部访问密钥尚未配置", 503)
    supplied = request.headers.get("X-Internal-Key", "")
    if not compare_digest(supplied, core.internal_key):
        raise PlatformError("INTERNAL_UNAUTHORIZED", "内部接口认证失败", 401)


@blueprint.post("/sso/redeem")
def redeem():
    payload = body()
    result = identity.redeem(get_core(), text(payload, "token", 256), text(payload, "agent_slug", 32))
    return jsonify(ok=True, data=result)


@blueprint.post("/sso/validate")
def validate():
    payload = body()
    result = identity.validate(get_core(), text(payload, "token", 256), text(payload, "agent_slug", 32))
    return jsonify(ok=True, data=result)


@blueprint.post("/points/consume")
def consume():
    return jsonify(ok=True, data=billing.consume(get_core(), charge(body())))


@blueprint.post("/points/reserve")
def reserve():
    return jsonify(ok=True, data=billing.reserve(get_core(), charge(body())))


@blueprint.post("/points/settle")
def settle():
    payload = body()
    result = settlement.settle(get_core(), text(payload, "hold_id", 128), integer(payload, "actual_quantity", minimum=0))
    return jsonify(ok=True, data=result)


@blueprint.post("/points/release")
def release():
    payload = body()
    result = settlement.release(get_core(), text(payload, "hold_id", 128), text(payload, "reason", 500, required=False))
    return jsonify(ok=True, data=result)


@blueprint.get("/merchant/balance")
def balance():
    mid = integer({"mid": request.args.get("mid")}, "mid")
    return jsonify(ok=True, data=billing.get_balance(get_core(), mid))


@blueprint.get("/agents/prices")
def prices():
    slug = text({"slug": request.args.get("slug")}, "slug", 32)
    configuration.validate_slug(slug)
    with get_core().connection() as connection:
        rows = billing_mapper.list_prices(connection, slug)
    return jsonify(ok=True, data=[dict(row) for row in rows])


@blueprint.get("/config")
def config():
    slug = text({"slug": request.args.get("slug")}, "slug", 32)
    return jsonify(ok=True, data=configuration.load(get_core(), slug))
