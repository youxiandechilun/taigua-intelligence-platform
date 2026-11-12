"""在现有SQLite主站上执行可重复的结构升级。"""

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
import sqlite3
import time

DatabaseFactory = Callable[[], sqlite3.Connection]
SCHEMA_PATH = Path(__file__).parent / "schema" / "001_platform_extension.sql"
ADDED_COLUMNS = {
    "merchants": {
        "point_frozen": "INTEGER NOT NULL DEFAULT 0",
        "token_version": "INTEGER NOT NULL DEFAULT 0",
    },
    "sessions": {
        "expire_at": "INTEGER NOT NULL DEFAULT 0",
        "revoked": "INTEGER NOT NULL DEFAULT 0",
        "ip": "TEXT NOT NULL DEFAULT ''",
        "ua": "TEXT NOT NULL DEFAULT ''",
        "scope": "TEXT NOT NULL DEFAULT 'merchant'",
    },
    "agents": {"slug": "TEXT NOT NULL DEFAULT ''"},
}


def migrate(db_factory: DatabaseFactory) -> None:
    source = SCHEMA_PATH.read_text(encoding="utf-8")
    checksum = sha256(source.encode("utf-8")).hexdigest()
    connection = db_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        for statement in source.split(";"):
            if statement.strip():
                connection.execute(statement)
        previous = connection.execute(
            "SELECT checksum FROM schema_migrations WHERE version=?", ("001_platform_extension",)
        ).fetchone()
        if previous and previous[0] != checksum:
            raise RuntimeError("已执行的数据库升级文件发生变化，请使用新的升级版本")
        for table, columns in ADDED_COLUMNS.items():
            present = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
            for name, definition in columns.items():
                if name not in present:
                    connection.execute(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {definition}')
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_slug ON agents(slug) WHERE slug<>''"
        )
        legacy = connection.execute(
            "SELECT token,created_at,merchant_id FROM sessions WHERE expire_at=0"
        ).fetchall()
        for row in legacy:
            expires = legacy_expiry(row[1])
            connection.execute(
                "UPDATE sessions SET expire_at=?,scope=COALESCE("
                "(SELECT role FROM merchants WHERE id=?),'merchant') WHERE token=?",
                (expires, row[2], row[0]),
            )
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations(version,checksum,applied_at) VALUES(?,?,?)",
            ("001_platform_extension", checksum, int(time.time())),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def legacy_expiry(created_at: str | None) -> int:
    if not created_at:
        return 1
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return 1
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone(timedelta(hours=8)))
    return int((created + timedelta(days=7)).timestamp())
