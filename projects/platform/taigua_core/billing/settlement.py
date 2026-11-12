import sqlite3

from ..errors import PlatformError
from ..runtime import Core
from . import mapper
from .service import balance_payload, expire, insufficient


def required_hold(connection: sqlite3.Connection, identifier: str) -> sqlite3.Row:
    row = mapper.hold(connection, identifier)
    if not row:
        raise PlatformError("HOLD_NOT_FOUND", "额度预留记录不存在", 404)
    return row


def result(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, str | int]:
    return {
        "hold_id": row["hold_id"],
        "charged": row["charged"],
        "refunded": max(0, row["held"] - row["charged"]),
        "released": row["held"] if row["status"] in ("released", "expired") else 0,
        "status": row["status"],
        "balance": balance_payload(connection, row["merchant_id"])["available"],
    }


def settle(core: Core, identifier: str, quantity: int) -> dict[str, str | int]:
    with core.connection(write=True) as connection:
        expire(connection, core.now())
        row = required_hold(connection, identifier)
        if row["status"] == "settled":
            if row["actual_quantity"] != quantity:
                raise PlatformError("SETTLEMENT_CONFLICT", "本次结算数量与已完成结算不一致", 409)
            return result(connection, row)
        if row["status"] != "reserved":
            raise PlatformError("HOLD_CLOSED", "该额度预留已释放或过期", 409)
        charged = row["unit_price"] * quantity
        if charged > 9_000_000_000_000_000:
            raise PlatformError("QUANTITY_TOO_LARGE", "本次结算数量过大")
        price = mapper.price(connection, row["agent_id"], row["action"])
        used = mapper.quota(connection, row["merchant_id"], row["agent_id"], row["action"], row["usage_day"])
        if price and price["daily_cap"] and used - row["quantity"] + quantity > price["daily_cap"]:
            raise PlatformError("DAILY_LIMIT", "结算数量超过当日额度", 429)
        if not mapper.settle_balance(connection, row["merchant_id"], row["held"], charged):
            raise insufficient(connection, row["merchant_id"], charged)
        mapper.add_consumption(connection, row["request_id"], row["fingerprint"], row["merchant_id"], row["agent_id"], row["action"], quantity, charged, "任务结算", core.now())
        mapper.change_usage(connection, row["merchant_id"], row["agent_id"], row["action"], row["usage_day"], quantity, -row["quantity"], charged)
        mapper.finish_hold(connection, identifier, "settled", quantity, charged, "", core.now())
        return result(connection, mapper.hold(connection, identifier))


def release(core: Core, identifier: str, reason: str) -> dict[str, str | int]:
    with core.connection(write=True) as connection:
        expire(connection, core.now())
        row = required_hold(connection, identifier)
        if row["status"] in ("released", "expired"):
            return result(connection, row)
        if row["status"] == "settled":
            raise PlatformError("HOLD_SETTLED", "该任务已结算", 409)
        mapper.release_balance(connection, row["merchant_id"], row["held"])
        mapper.change_usage(connection, row["merchant_id"], row["agent_id"], row["action"], row["usage_day"], 0, -row["quantity"], 0)
        mapper.finish_hold(connection, identifier, "released", 0, 0, reason, core.now())
        return result(connection, mapper.hold(connection, identifier))
