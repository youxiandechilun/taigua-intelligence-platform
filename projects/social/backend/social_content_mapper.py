"""社媒生成和外发的工作区持久化操作。"""

from __future__ import annotations

import sqlite3
import time


def claim_content(conn: sqlite3.Connection, job_id: str, workspace: str):
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute("SELECT * FROM overseas_content_jobs WHERE id=? AND workspace_id=?",
                       (job_id, workspace)).fetchone()
    if row is None or row["status"] == "success":
        conn.commit()
        return row
    if row["status"] == "running" and row["updated_at"] > time.time() - 300:
        conn.commit()
        raise ValueError("内容正在生成，请稍后刷新")
    conn.execute("UPDATE overseas_content_jobs SET status='running',updated_at=? WHERE id=? AND workspace_id=?",
                 (time.time(), job_id, workspace))
    conn.commit()
    return row


def complete_content(conn: sqlite3.Connection, job_id: str, workspace: str, script: str,
                     success: bool) -> None:
    conn.execute("UPDATE overseas_content_jobs SET status=?,script=?,updated_at=? WHERE id=? AND workspace_id=?",
                 ("success" if success else "failed", script, time.time(), job_id, workspace))
    conn.commit()


def conversation(conn: sqlite3.Connection, identifier: str, workspace: str):
    return conn.execute("SELECT * FROM overseas_conversations WHERE id=? AND workspace_id=?",
                        (identifier, workspace)).fetchone()


def save_reply(conn: sqlite3.Connection, identifier: str, workspace: str,
               draft: str, intent: str) -> None:
    conn.execute("UPDATE overseas_conversations SET reply_draft=?,reply_review_status='draft',"
                 "reply_delivery_status='not_started',intent_level=?,updated_at=? WHERE id=? AND workspace_id=?",
                 (draft, intent, time.time(), identifier, workspace))
    conn.commit()


def lead(conn: sqlite3.Connection, identifier: str, workspace: str):
    return conn.execute("SELECT * FROM overseas_leads WHERE id=? AND workspace_id=?",
                        (identifier, workspace)).fetchone()


def delivery_status(conn: sqlite3.Connection, identifier: str, workspace: str,
                    status: str, message: str, channel: str, log_id: str) -> None:
    conn.execute("UPDATE overseas_leads SET outreach_status=?,updated_at=? WHERE id=? AND workspace_id=?",
                 (status, time.time(), identifier, workspace))
    conn.execute("INSERT INTO overseas_push_logs(id,workspace_id,lead_id,channel,status,message,created_at) "
                 "VALUES(?,?,?,?,?,?,?)", (log_id, workspace, identifier, channel, status, message, time.time()))
    conn.commit()


def claim_delivery(conn: sqlite3.Connection, identifier: str, workspace: str) -> bool:
    cursor = conn.execute("UPDATE overseas_leads SET outreach_status='review',updated_at=? "
                          "WHERE id=? AND workspace_id=? AND outreach_status NOT IN ('sent','review')",
                          (time.time(), identifier, workspace))
    conn.commit()
    return cursor.rowcount == 1


def confirm_reply(conn: sqlite3.Connection, identifier: str, workspace: str, receipt: str) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS social_manual_receipts("
                 "id INTEGER PRIMARY KEY,workspace_id TEXT NOT NULL,conversation_id TEXT NOT NULL,"
                 "receipt TEXT NOT NULL,created_at REAL NOT NULL,UNIQUE(workspace_id,conversation_id,receipt))")
    conn.execute("UPDATE overseas_conversations SET reply_delivery_status='manual_sent',"
                 "status='已处理',updated_at=? WHERE id=? AND workspace_id=?",
                 (time.time(), identifier, workspace))
    conn.execute("INSERT OR IGNORE INTO social_manual_receipts(workspace_id,conversation_id,receipt,created_at) VALUES(?,?,?,?)",
                 (workspace, identifier, receipt, time.time()))
    conn.commit()
