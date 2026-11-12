"""发布任务与平台冻结单的持久对应关系。"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import sqlite3
import time


@dataclass(frozen=True)
class ChargeRecord:
    job_id: str
    workspace: str
    hold_id: str
    state: str


class ChargeMapper:
    def __init__(self, path: Path):
        self.path = path
        with self.connection() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS social_charges(job_id TEXT PRIMARY KEY,"
                         "workspace TEXT NOT NULL,hold_id TEXT NOT NULL DEFAULT '',"
                         "state TEXT NOT NULL DEFAULT 'pending',updated_at REAL NOT NULL)")

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def get(self, job_id: str) -> ChargeRecord | None:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM social_charges WHERE job_id=?", (job_id,)).fetchone()
        return ChargeRecord(row["job_id"], row["workspace"], row["hold_id"], row["state"]) if row else None

    def remember(self, job_id: str, workspace: str, hold_id: str, state: str) -> None:
        with self.connection() as conn:
            conn.execute("INSERT INTO social_charges(job_id,workspace,hold_id,state,updated_at) VALUES(?,?,?,?,?) "
                         "ON CONFLICT(job_id) DO UPDATE SET hold_id=excluded.hold_id,state=excluded.state,"
                         "updated_at=excluded.updated_at", (job_id, workspace, hold_id, state, time.time()))

    def pending(self) -> list[ChargeRecord]:
        with self.connection() as conn:
            rows = conn.execute("SELECT * FROM social_charges WHERE state IN ('pending','reserved','settlement_pending')").fetchall()
        return [ChargeRecord(row["job_id"], row["workspace"], row["hold_id"], row["state"]) for row in rows]
