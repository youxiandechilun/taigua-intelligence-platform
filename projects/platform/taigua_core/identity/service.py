from datetime import datetime, timedelta, timezone
from hashlib import sha256
import os
import secrets
import sqlite3
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from flask import Response

from ..catalog import PRODUCT_BY_SLUG
from ..errors import PlatformError
from ..runtime import Core
from . import mapper


def digest(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def active_merchant(row: sqlite3.Row | None) -> bool:
    return bool(row and not row["disabled"] and row["status"] not in ("待审核", "已驳回", "已过期", "已停用"))


def parent(core: Core, token: str) -> sqlite3.Row | None:
    if not token:
        return None
    with core.connection() as connection:
        row = mapper.parent_session(connection, token)
    if not active_merchant(row):
        return None
    if row["_session_revoked"] or row["_session_expiry"] <= core.now():
        return None
    return row


def require_product(connection: sqlite3.Connection, mid: int, slug: str, now: int) -> sqlite3.Row:
    if slug not in PRODUCT_BY_SLUG:
        raise PlatformError("AGENT_NOT_FOUND", "产品不存在", 404)
    merchant = mapper.merchant(connection, mid)
    if not active_merchant(merchant) or merchant["role"] != "merchant":
        raise PlatformError("MERCHANT_DISABLED", "商户账号当前不可用", 403)
    product = mapper.product(connection, slug)
    if not product or product["status"] != "running":
        raise PlatformError("AGENT_DISABLED", "该产品当前不可用", 403)
    expiry = mapper.entitlement(connection, mid, product["id"])
    try:
        parsed = datetime.fromisoformat((expiry or "").replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone(timedelta(hours=8)))
        available = parsed.timestamp() > now
    except ValueError:
        available = False
    if not available:
        raise PlatformError("AGENT_DISABLED", "当前商户尚未开通该产品或已到期", 403)
    return product


def finish_login(core: Core, response: Response, token: str, scope: str, ip: str, ua: str) -> Response:
    with core.connection(write=True) as connection:
        mapper.complete_login(connection, token, core.now() + core.session_ttl, scope, ip[:64], ua[:512])
    secure = os.environ.get("TAIGUA_ENV", "development") != "development"
    domain = os.environ.get("TAIGUA_COOKIE_DOMAIN", ".taikua.cn") if secure else None
    response.set_cookie("tk_token", token, max_age=core.session_ttl, httponly=True, secure=secure, samesite="Lax", domain=domain)
    return response


def logout(core: Core, token: str, response: Response) -> Response:
    with core.connection(write=True) as connection:
        mapper.revoke_parent(connection, token)
    secure = os.environ.get("TAIGUA_ENV", "development") != "development"
    domain = os.environ.get("TAIGUA_COOKIE_DOMAIN", ".taikua.cn") if secure else None
    response.delete_cookie("tk_token", domain=domain, httponly=True, secure=secure, samesite="Lax")
    return response


def enter(core: Core, token: str, slug: str) -> tuple[str, str]:
    identity = parent(core, token)
    if not identity:
        raise PlatformError("SESSION_EXPIRED", "请重新登录", 401)
    ticket = secrets.token_urlsafe(32)
    with core.connection(write=True) as connection:
        require_product(connection, identity["id"], slug, core.now())
        mapper.add_ticket(connection, digest(ticket), identity["id"], slug, token, core.now() + core.ticket_ttl, core.now())
    override = os.environ.get(f"TAIGUA_ENTRY_{slug.upper()}", "")
    entry = override or PRODUCT_BY_SLUG[slug].entry
    parsed = urlsplit(entry)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PlatformError("ENTRY_UNCONFIGURED", "产品入口尚未配置", 503)
    query = dict(parse_qsl(parsed.query))
    query.update(ticket=ticket, agent_slug=slug)
    return ticket, urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def redeem(core: Core, token: str, slug: str) -> dict[str, str | int]:
    now = core.now()
    with core.connection(write=True) as connection:
        ticket = mapper.take_ticket(connection, digest(token), slug, now)
        parent_token = ticket["parent_token"] if ticket else token
        identity = mapper.parent_session(connection, parent_token)
        if not active_merchant(identity) or identity["_session_revoked"] or identity["_session_expiry"] <= now:
            raise PlatformError("TICKET_INVALID", "登录凭证无效或已过期", 401)
        product = require_product(connection, identity["id"], slug, now)
        child_token = secrets.token_urlsafe(32)
        expires = min(identity["_session_expiry"], now + core.session_ttl)
        mapper.add_child(connection, digest(child_token), identity["id"], slug, parent_token, expires, now)
        return identity_payload(identity, product["id"], slug, expires, child_token)


def validate(core: Core, token: str, slug: str) -> dict[str, str | int]:
    with core.connection() as connection:
        child = mapper.child_session(connection, digest(token), slug)
        if not child or child["revoked"] or child["expire_at"] <= core.now():
            raise PlatformError("SESSION_EXPIRED", "登录已过期，请从主页重新进入", 401)
        identity = mapper.parent_session(connection, child["parent_token"])
        if not active_merchant(identity) or identity["_session_revoked"] or identity["_session_expiry"] <= core.now():
            raise PlatformError("SESSION_EXPIRED", "登录已失效，请从主页重新进入", 401)
        product = require_product(connection, identity["id"], slug, core.now())
        return identity_payload(identity, product["id"], slug, child["expire_at"], token)


def identity_payload(identity: sqlite3.Row, agent_id: int, slug: str, expires: int, token: str) -> dict[str, str | int]:
    return {
        "mid": str(identity["id"]),
        "merchant_name": identity["company"] or identity["contact"],
        "agent_id": agent_id,
        "slug": slug,
        "balance": identity["token_balance"],
        "expire_at": expires,
        "external_user_id": f"tk-{identity['id']}",
        "session_token": token,
    }
