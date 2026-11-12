"""员工及平台商户的身份映射和增量结构迁移。"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import time

from werkzeug.security import generate_password_hash
from taigua_platform import PlatformIdentity


def migrate_tenants(conn: sqlite3.Connection) -> None:
    additions = {
        "team_users": {"tenant_id": "TEXT NOT NULL DEFAULT 'legacy'",
                       "external_user_id": "TEXT NOT NULL DEFAULT ''",
                       "agent_slug": "TEXT NOT NULL DEFAULT 'ztgj'"},
        "team_sessions": {"tenant_id": "TEXT NOT NULL DEFAULT 'legacy'",
                          "platform_session": "INTEGER NOT NULL DEFAULT 0",
                          "agent_slug": "TEXT NOT NULL DEFAULT 'ztgj'"},
    }
    for table, columns in additions.items():
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for column, definition in columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    conn.execute("CREATE INDEX IF NOT EXISTS team_users_tenant ON team_users(tenant_id,active)")
    conn.execute("CREATE INDEX IF NOT EXISTS team_sessions_tenant ON team_sessions(tenant_id,expires_at)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS team_external_identity ON "
                 "team_users(tenant_id,external_user_id) WHERE external_user_id<>''")


def tenant_users(conn: sqlite3.Connection, tenant_id: str, active_only: bool = False, slug: str = "ztgj"):
    condition = " AND active=1" if active_only else ""
    return conn.execute("SELECT * FROM team_users WHERE tenant_id=? AND agent_slug=?" + condition +
                        " ORDER BY role,created_at", (tenant_id, slug)).fetchall()


def tenant_user(conn: sqlite3.Connection, user_id: str, tenant_id: str, slug: str = "ztgj"):
    return conn.execute("SELECT * FROM team_users WHERE id=? AND tenant_id=? AND agent_slug=?",
                        (user_id, tenant_id, slug)).fetchone()


def create_platform_session(conn: sqlite3.Connection, identity: PlatformIdentity):
    now = time.time()
    tenant = identity["mid"]
    external = identity["slug"] + ":" + identity["external_user_id"]
    conn.execute("UPDATE team_users SET external_user_id=? WHERE tenant_id=? AND external_user_id=? AND agent_slug=?",
                 (external, tenant, identity["external_user_id"], identity["slug"]))
    user = conn.execute("SELECT * FROM team_users WHERE tenant_id=? AND external_user_id=?",
                        (tenant, external)).fetchone()
    if user is None:
        user_id = secrets.token_hex(16)
        username = "tk-" + hashlib.sha256((tenant + ":" + external).encode()).hexdigest()[:24]
        conn.execute("INSERT INTO team_users(id,username,display_name,password_hash,role,active,created_at,"
                     "tenant_id,external_user_id,agent_slug) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (user_id, username, identity["merchant_name"][:40],
                      generate_password_hash(secrets.token_urlsafe(48)), "admin", 1, now, tenant, external, identity["slug"]))
        user = tenant_user(conn, user_id, tenant, identity["slug"])
    if not user["active"]:
        return None
    token = identity["session_token"]
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    csrf = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO team_sessions(token_hash,user_id,workspace_id,csrf,expires_at,tenant_id,"
                 "platform_session,agent_slug) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(token_hash) DO UPDATE SET "
                 "csrf=excluded.csrf,expires_at=excluded.expires_at,agent_slug=excluded.agent_slug",
                 (token_hash, user["id"], user["id"], csrf, identity["expire_at"], tenant, identity["slug"]))
    return user, csrf
