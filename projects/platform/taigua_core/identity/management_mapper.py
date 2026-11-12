import sqlite3


def has_financial_records(connection: sqlite3.Connection, mid: int) -> bool:
    for table in ("transactions", "point_consumptions", "point_holds", "pay_orders", "agent_orders"):
        if connection.execute(f"SELECT 1 FROM {table} WHERE merchant_id=? LIMIT 1", (mid,)).fetchone():
            return True
    return False


def remove_unbilled_merchant(connection: sqlite3.Connection, mid: int) -> None:
    connection.execute("DELETE FROM cs_messages WHERE session_id IN (SELECT id FROM cs_sessions WHERE merchant_id=?)", (mid,))
    for table in ("cs_sessions", "tickets", "sso_tickets", "agent_sessions", "agent_identities",
                  "agent_usage_daily", "agent_purchases", "sessions"):
        connection.execute(f"DELETE FROM {table} WHERE merchant_id=?", (mid,))
    connection.execute("DELETE FROM merchants WHERE id=?", (mid,))
