from datetime import datetime, timezone
import sqlite3


def balance(connection: sqlite3.Connection, merchant_id: int) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT token_balance AS balance,point_frozen AS frozen FROM merchants WHERE id=?", (merchant_id,)
    ).fetchone()


def price(connection: sqlite3.Connection, agent_id: int, action: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT points,daily_cap FROM agent_prices WHERE agent_id=? AND action=?", (agent_id, action)
    ).fetchone()


def consumption(connection: sqlite3.Connection, request_id: str) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM point_consumptions WHERE request_id=?", (request_id,)).fetchone()


def hold_by_request(connection: sqlite3.Connection, request_id: str) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM point_holds WHERE request_id=?", (request_id,)).fetchone()


def hold(connection: sqlite3.Connection, identifier: str) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM point_holds WHERE hold_id=?", (identifier,)).fetchone()


def quota(connection: sqlite3.Connection, mid: int, agent: int, action: str, day: str) -> int:
    row = connection.execute(
        "SELECT quantity+reserved_quantity FROM agent_usage_daily WHERE merchant_id=? AND agent_id=? AND action=? AND day=?",
        (mid, agent, action, day),
    ).fetchone()
    return row[0] if row else 0


def change_usage(connection: sqlite3.Connection, mid: int, agent: int, action: str, day: str, quantity: int, reserved: int, points: int) -> None:
    connection.execute(
        "INSERT INTO agent_usage_daily(merchant_id,agent_id,action,day,quantity,reserved_quantity,points) "
        "VALUES(?,?,?,?,?,?,?) ON CONFLICT(merchant_id,agent_id,action,day) DO UPDATE SET "
        "quantity=quantity+excluded.quantity,reserved_quantity=reserved_quantity+excluded.reserved_quantity,points=points+excluded.points",
        (mid, agent, action, day, quantity, reserved, points),
    )


def debit(connection: sqlite3.Connection, mid: int, points: int) -> bool:
    cursor = connection.execute(
        "UPDATE merchants SET token_balance=token_balance-?,token_version=token_version+1 "
        "WHERE id=? AND token_balance-point_frozen>=?", (points, mid, points)
    )
    return cursor.rowcount == 1


def freeze(connection: sqlite3.Connection, mid: int, points: int) -> bool:
    cursor = connection.execute(
        "UPDATE merchants SET point_frozen=point_frozen+?,token_version=token_version+1 "
        "WHERE id=? AND token_balance-point_frozen>=?", (points, mid, points)
    )
    return cursor.rowcount == 1


def settle_balance(connection: sqlite3.Connection, mid: int, held: int, charged: int) -> bool:
    cursor = connection.execute(
        "UPDATE merchants SET token_balance=token_balance-?,point_frozen=point_frozen-?,token_version=token_version+1 "
        "WHERE id=? AND point_frozen>=? AND token_balance-point_frozen+?>=?",
        (charged, held, mid, held, held, charged),
    )
    return cursor.rowcount == 1


def release_balance(connection: sqlite3.Connection, mid: int, points: int) -> None:
    connection.execute(
        "UPDATE merchants SET point_frozen=point_frozen-?,token_version=token_version+1 WHERE id=? AND point_frozen>=?",
        (points, mid, points),
    )


def add_consumption(connection: sqlite3.Connection, request_id: str, fingerprint: str, mid: int, agent: int, action: str, quantity: int, points: int, note: str, now: int) -> None:
    connection.execute(
        "INSERT INTO point_consumptions(request_id,fingerprint,merchant_id,agent_id,action,quantity,points,status,note,created_at) "
        "VALUES(?,?,?,?,?,?,?,'settled',?,?)", (request_id, fingerprint, mid, agent, action, quantity, points, note, now)
    )
    connection.execute(
        "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) VALUES(?,'consume',?,0,?,?)",
        (mid, -points, note or action, datetime.fromtimestamp(now, timezone.utc).isoformat()),
    )


def add_hold(connection: sqlite3.Connection, identifier: str, request_id: str, fingerprint: str, mid: int, agent: int, action: str, quantity: int, unit_price: int, day: str, expiry: int, now: int) -> None:
    connection.execute(
        "INSERT INTO point_holds(hold_id,request_id,fingerprint,merchant_id,agent_id,action,quantity,unit_price,held,usage_day,expire_at,created_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (identifier, request_id, fingerprint, mid, agent, action, quantity, unit_price, quantity * unit_price, day, expiry, now, now),
    )


def finish_hold(connection: sqlite3.Connection, identifier: str, status: str, quantity: int, charged: int, reason: str, now: int) -> None:
    connection.execute(
        "UPDATE point_holds SET status=?,actual_quantity=?,charged=?,reason=?,updated_at=? WHERE hold_id=? AND status='reserved'",
        (status, quantity, charged, reason, now, identifier),
    )


def expired_holds(connection: sqlite3.Connection, now: int) -> list[sqlite3.Row]:
    return connection.execute(
        "SELECT * FROM point_holds WHERE status='reserved' AND expire_at<=?", (now,)
    ).fetchall()


def list_consumptions(connection: sqlite3.Connection, mid: int | None, page: int, size: int) -> tuple[list[sqlite3.Row], int]:
    condition = "WHERE p.merchant_id=?" if mid is not None else ""
    parameters = [mid] if mid is not None else []
    total = connection.execute(f"SELECT COUNT(*) FROM point_consumptions p {condition}", parameters).fetchone()[0]
    rows = connection.execute(
        "SELECT p.*,a.name AS agent_name,m.company AS merchant_name FROM point_consumptions p "
        f"JOIN agents a ON a.id=p.agent_id JOIN merchants m ON m.id=p.merchant_id {condition} "
        "ORDER BY p.id DESC LIMIT ? OFFSET ?", [*parameters, size, (page - 1) * size]
    ).fetchall()
    return rows, total


def list_prices(connection: sqlite3.Connection, slug: str | None = None) -> list[sqlite3.Row]:
    condition = " WHERE a.slug=?" if slug else " WHERE a.slug<>''"
    parameters = (slug,) if slug else ()
    return connection.execute(
        "SELECT a.slug,a.name,p.action,p.points,p.daily_cap FROM agent_prices p JOIN agents a ON a.id=p.agent_id"
        + condition + " ORDER BY a.id,p.action", parameters
    ).fetchall()


def save_price(connection: sqlite3.Connection, agent_id: int, action: str, points: int, cap: int) -> None:
    connection.execute(
        "INSERT INTO agent_prices(agent_id,action,points,daily_cap) VALUES(?,?,?,?) "
        "ON CONFLICT(agent_id,action) DO UPDATE SET points=excluded.points,daily_cap=excluded.daily_cap",
        (agent_id, action, points, cap),
    )


def adjust_balance(connection: sqlite3.Connection, mid: int, points: int, note: str, now: int) -> int | None:
    cursor = connection.execute(
        "UPDATE merchants SET token_balance=token_balance+?,token_version=token_version+1 "
        "WHERE id=? AND role='merchant' AND token_balance+?>=point_frozen", (points, mid, points)
    )
    if cursor.rowcount != 1:
        return None
    connection.execute(
        "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) VALUES(?,?,?,0,?,?)",
        (mid, "recharge" if points > 0 else "consume", points, note, datetime.fromtimestamp(now, timezone.utc).isoformat()),
    )
    return balance(connection, mid)["balance"]
