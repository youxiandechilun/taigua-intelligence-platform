from datetime import datetime, timezone
import sqlite3


def configurations(connection: sqlite3.Connection, slug: str) -> list[sqlite3.Row]:
    return connection.execute(
        "SELECT agent_slug,section,payload FROM integration_configs WHERE agent_slug IN ('global',?) "
        "ORDER BY CASE WHEN agent_slug='global' THEN 0 ELSE 1 END", (slug,)
    ).fetchall()


def save(connection: sqlite3.Connection, slug: str, section: str, payload: str, now: int) -> None:
    connection.execute(
        "INSERT INTO integration_configs(agent_slug,section,payload,updated_at) VALUES(?,?,?,?) "
        "ON CONFLICT(agent_slug,section) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
        (slug, section, payload, now),
    )


def audit(connection: sqlite3.Connection, admin_id: int, name: str, action: str, target: str, fields: str, now: int) -> None:
    connection.execute(
        "INSERT INTO logs(admin_id,admin_name,action,target,detail,ip,created_at) VALUES(?,?,?,?,?,'internal',?)",
        (admin_id, name, action, target, fields, datetime.fromtimestamp(now, timezone.utc).isoformat()),
    )


def legacy_model(connection: sqlite3.Connection) -> dict[str, str]:
    rows = connection.execute(
        "SELECT key,value FROM settings WHERE key IN ('ai_enabled','ai_base_url','ai_api_key','ai_model')"
    ).fetchall()
    return {row[0]: row[1] or "" for row in rows}
