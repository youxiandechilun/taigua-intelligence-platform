from datetime import datetime, timezone
import sqlite3

from ..catalog import PRODUCTS


def provision_catalog(connection: sqlite3.Connection, now: int) -> None:
    created_at = datetime.fromtimestamp(now, timezone.utc).isoformat()
    for product in PRODUCTS:
        existing = connection.execute("SELECT id FROM agents WHERE slug=?", (product.slug,)).fetchone()
        if existing:
            agent_id = existing[0]
        else:
            candidate = connection.execute(
                "SELECT id FROM agents WHERE slug='' AND (name=? OR link LIKE ?) ORDER BY id LIMIT 1",
                (product.name, f"%{product.slug}.taikua.cn%"),
            ).fetchone()
            if candidate:
                agent_id = candidate[0]
                connection.execute("UPDATE agents SET slug=? WHERE id=?", (product.slug, agent_id))
            else:
                tag = connection.execute("SELECT id FROM tags WHERE name=?", (product.category,)).fetchone()
                if not tag:
                    cursor = connection.execute(
                        "INSERT INTO tags(name,sort,created_at) VALUES(?,?,?)", (product.category, 10, created_at)
                    )
                    tag_id = cursor.lastrowid
                else:
                    tag_id = tag[0]
                available_id = connection.execute("SELECT id FROM agents WHERE id=?", (product.identifier,)).fetchone()
                identifier = None if available_id else product.identifier
                cursor = connection.execute(
                    "INSERT INTO agents(id,tag_id,name,region,status,link,slug,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (identifier, tag_id, product.name, product.region, "running", product.entry, product.slug, created_at),
                )
                agent_id = cursor.lastrowid
        for action in product.actions:
            connection.execute(
                "INSERT OR IGNORE INTO agent_prices(agent_id,action,points,daily_cap) VALUES(?,?,1,0)",
                (agent_id, action),
            )


def merchant(connection: sqlite3.Connection, merchant_id: int) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM merchants WHERE id=?", (merchant_id,)).fetchone()


def parent_session(connection: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT m.*,s.created_at AS _session_created,s.expire_at AS _session_expiry,"
        "s.revoked AS _session_revoked,s.scope AS _session_scope "
        "FROM sessions s JOIN merchants m ON m.id=s.merchant_id WHERE s.token=?", (token,)
    ).fetchone()


def product(connection: sqlite3.Connection, slug: str) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM agents WHERE slug=?", (slug,)).fetchone()


def entitlement(connection: sqlite3.Connection, merchant_id: int, agent_id: int) -> str | None:
    row = connection.execute(
        "SELECT expire_at FROM agent_purchases WHERE merchant_id=? AND agent_id=?", (merchant_id, agent_id)
    ).fetchone()
    return row[0] if row else None


def complete_login(connection: sqlite3.Connection, token: str, expiry: int, scope: str, ip: str, ua: str) -> None:
    connection.execute(
        "UPDATE sessions SET expire_at=?,scope=?,ip=?,ua=?,revoked=0 WHERE token=?", (expiry, scope, ip, ua, token)
    )


def revoke_parent(connection: sqlite3.Connection, token: str) -> None:
    connection.execute("UPDATE sessions SET revoked=1 WHERE token=?", (token,))
    connection.execute("UPDATE agent_sessions SET revoked=1 WHERE parent_token=?", (token,))


def add_ticket(connection: sqlite3.Connection, digest: str, mid: int, slug: str, token: str, expires: int, now: int) -> None:
    connection.execute(
        "INSERT INTO sso_tickets(ticket_hash,merchant_id,agent_slug,parent_token,expire_at,created_at) VALUES(?,?,?,?,?,?)",
        (digest, mid, slug, token, expires, now),
    )


def take_ticket(connection: sqlite3.Connection, digest: str, slug: str, now: int) -> sqlite3.Row | None:
    row = connection.execute("SELECT * FROM sso_tickets WHERE ticket_hash=?", (digest,)).fetchone()
    if not row or row["agent_slug"] != slug or row["used"] or row["expire_at"] <= now:
        return None
    cursor = connection.execute(
        "UPDATE sso_tickets SET used=1 WHERE ticket_hash=? AND used=0 AND expire_at>?", (digest, now)
    )
    return row if cursor.rowcount == 1 else None


def add_child(connection: sqlite3.Connection, digest: str, mid: int, slug: str, parent: str, expiry: int, now: int) -> None:
    connection.execute(
        "INSERT INTO agent_sessions(token_hash,merchant_id,agent_slug,parent_token,expire_at,created_at) VALUES(?,?,?,?,?,?)",
        (digest, mid, slug, parent, expiry, now),
    )
    connection.execute(
        "INSERT OR IGNORE INTO agent_identities(merchant_id,agent_slug,external_user_id,created_at) VALUES(?,?,?,?)",
        (mid, slug, f"tk-{mid}", now),
    )


def child_session(connection: sqlite3.Connection, digest: str, slug: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM agent_sessions WHERE token_hash=? AND agent_slug=?", (digest, slug)
    ).fetchone()


def provision_admin(connection: sqlite3.Connection, staff: str, hashed_password: str, now: int) -> None:
    existing = connection.execute("SELECT id FROM merchants WHERE role='admin' LIMIT 1").fetchone()
    if existing:
        return
    created = datetime.fromtimestamp(now, timezone.utc).isoformat()
    connection.execute(
        "INSERT INTO merchants(phone,password,company,contact,role,status,staff_no,created_at) "
        "VALUES(?,?,'平台管理员','平台管理员','admin','已认证',?,?)",
        (f"admin-{staff}", hashed_password, staff, created),
    )
