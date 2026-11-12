from datetime import datetime, timezone
import secrets
import sqlite3

from ..errors import PlatformError
from ..identity.service import require_product
from ..runtime import Core
from . import mapper
from .models import Charge


def balance_payload(connection: sqlite3.Connection, mid: int) -> dict[str, int]:
    row = mapper.balance(connection, mid)
    if not row:
        raise PlatformError("MERCHANT_NOT_FOUND", "商户不存在", 404)
    return {"balance": row["balance"], "frozen": row["frozen"], "available": row["balance"] - row["frozen"]}


def expire(connection: sqlite3.Connection, now: int) -> int:
    rows = mapper.expired_holds(connection, now)
    for row in rows:
        mapper.release_balance(connection, row["merchant_id"], row["held"])
        mapper.change_usage(connection, row["merchant_id"], row["agent_id"], row["action"], row["usage_day"], 0, -row["quantity"], 0)
        mapper.finish_hold(connection, row["hold_id"], "expired", 0, 0, "额度预留超时", now)
    return len(rows)


def release_expired(core: Core) -> int:
    with core.connection(write=True) as connection:
        return expire(connection, core.now())


def get_balance(core: Core, mid: int) -> dict[str, int]:
    with core.connection(write=True) as connection:
        expire(connection, core.now())
        return balance_payload(connection, mid)


def check_replay(row: sqlite3.Row, fingerprint: str) -> None:
    if row["fingerprint"] != fingerprint:
        raise PlatformError("IDEMPOTENCY_CONFLICT", "业务单号已用于其他请求", 409)


def priced_request(connection: sqlite3.Connection, charge: Charge, now: int) -> tuple[int, int, int, str]:
    product = require_product(connection, charge.merchant_id, charge.slug, now)
    price = mapper.price(connection, product["id"], charge.action)
    if not price:
        raise PlatformError("ACTION_UNCONFIGURED", "该操作尚未设置收费规则", 400)
    total = price["points"] * charge.quantity
    if total > 9_000_000_000_000_000:
        raise PlatformError("QUANTITY_TOO_LARGE", "本次请求数量过大")
    day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
    used = mapper.quota(connection, charge.merchant_id, product["id"], charge.action, day)
    if price["daily_cap"] and used + charge.quantity > price["daily_cap"]:
        raise PlatformError("DAILY_LIMIT", "已达到当日操作额度", 429)
    return product["id"], price["points"], total, day


def insufficient(connection: sqlite3.Connection, mid: int, need: int) -> PlatformError:
    available = balance_payload(connection, mid)["available"]
    return PlatformError("INSUFFICIENT_POINTS", "点数不足，请到平台充值", 402, need=need, balance=available)


def consume(core: Core, charge: Charge) -> dict[str, str | int]:
    fingerprint = charge.fingerprint("consume")
    with core.connection(write=True) as connection:
        expire(connection, core.now())
        previous = mapper.consumption(connection, charge.request_id)
        if previous:
            check_replay(previous, fingerprint)
            return {"request_id": charge.request_id, "charged": previous["points"], "balance": balance_payload(connection, charge.merchant_id)["balance"]}
        if mapper.hold_by_request(connection, charge.request_id):
            raise PlatformError("IDEMPOTENCY_CONFLICT", "业务单号已用于额度预留", 409)
        agent, _, points, day = priced_request(connection, charge, core.now())
        if not mapper.debit(connection, charge.merchant_id, points):
            raise insufficient(connection, charge.merchant_id, points)
        mapper.add_consumption(connection, charge.request_id, fingerprint, charge.merchant_id, agent, charge.action, charge.quantity, points, charge.note, core.now())
        mapper.change_usage(connection, charge.merchant_id, agent, charge.action, day, charge.quantity, 0, points)
        return {"request_id": charge.request_id, "charged": points, "balance": balance_payload(connection, charge.merchant_id)["balance"]}


def reserve(core: Core, charge: Charge) -> dict[str, str | int]:
    fingerprint = charge.fingerprint("reserve")
    with core.connection(write=True) as connection:
        expire(connection, core.now())
        previous = mapper.hold_by_request(connection, charge.request_id)
        if previous:
            check_replay(previous, fingerprint)
            return hold_payload(connection, previous)
        if mapper.consumption(connection, charge.request_id):
            raise PlatformError("IDEMPOTENCY_CONFLICT", "业务单号已用于直接扣费", 409)
        agent, unit, points, day = priced_request(connection, charge, core.now())
        if not mapper.freeze(connection, charge.merchant_id, points):
            raise insufficient(connection, charge.merchant_id, points)
        identifier = secrets.token_urlsafe(24)
        mapper.add_hold(connection, identifier, charge.request_id, fingerprint, charge.merchant_id, agent, charge.action, charge.quantity, unit, day, core.now() + core.hold_ttl, core.now())
        mapper.change_usage(connection, charge.merchant_id, agent, charge.action, day, 0, charge.quantity, 0)
        return hold_payload(connection, mapper.hold(connection, identifier))


def hold_payload(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, str | int]:
    return {
        "hold_id": row["hold_id"],
        "held": row["held"],
        "charged": row["charged"],
        "status": row["status"],
        "balance": balance_payload(connection, row["merchant_id"])["available"],
    }


def adjust(core: Core, mid: int, points: int, note: str) -> int:
    with core.connection(write=True) as connection:
        expire(connection, core.now())
        balance_payload(connection, mid)
        result = mapper.adjust_balance(connection, mid, points, note, core.now())
        if result is None:
            raise PlatformError("BALANCE_RESERVED", "扣减额度超过当前可用点数", 409)
        return result
