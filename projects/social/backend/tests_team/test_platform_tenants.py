"""使用本地 HTTP 平台验证商户隔离、换票和退出失效。"""

from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
import threading
import time

import pytest

from team_gateway import COOKIE_NAME, create_app
from taigua_platform import PlatformClient


@pytest.fixture()
def platform_server():
    state = {"revoked": set(), "used": set()}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            if self.headers.get("X-Internal-Key") != "local-test-key":
                self.send_result(403, {"ok": False, "code": "FORBIDDEN"})
                return
            token = payload.get("token", "")
            if token in state["revoked"]:
                self.send_result(401, {"ok": False, "code": "SESSION_REVOKED", "msg": "会话已退出"})
                return
            if self.path.endswith("/redeem"):
                if token in state["used"]:
                    self.send_result(401, {"ok": False, "code": "TICKET_USED"})
                    return
                state["used"].add(token)
                token = token.replace("ticket-", "session-")
            merchant = token.removeprefix("session-")
            self.send_result(200, {"ok": True, "data": {
                "mid": merchant, "merchant_name": "商户" + merchant, "agent_id": 11,
                "slug": "ztgj", "balance": 100, "expire_at": time.time() + 3600,
                "external_user_id": "owner-" + merchant, "session_token": token,
            }})

        def send_result(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield PlatformClient(f"http://127.0.0.1:{server.server_port}", "local-test-key"), state
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def test_platform_tenants_are_isolated_and_revocation_is_immediate(tmp_path, platform_server):
    platform, state = platform_server
    app = create_app(tmp_path, secure_cookie=False, platform_client=platform)
    app.testing = True
    first, second = app.test_client(), app.test_client()
    assert first.post("/api/auth/sso", json={"token": "ticket-A"}).status_code == 200
    assert second.get("/api/auth/sso?ticket=ticket-B").status_code == 303
    assert second.post("/api/auth/sso", json={"token": "ticket-B"}).status_code == 401
    first_identity = first.get("/api/team/me").json["data"]
    second_identity = second.get("/api/team/me").json["data"]
    assert first_identity["user"]["id"] != second_identity["user"]["id"]
    assert len(first_identity["workspaces"]) == len(second_identity["workspaces"]) == 1
    assert len(first.get("/api/team/users").json["data"]) == 1
    headers = {"X-CSRF-Token": first_identity["csrf"],
               "X-Workspace-ID": first_identity["workspace"]["id"]}
    assert first.post("/api/team/workspace", headers=headers,
                      json={"user_id": second_identity["user"]["id"]}).status_code == 404
    assert first.patch("/api/team/users/" + second_identity["user"]["id"], headers=headers,
                       json={"active": 0}).status_code == 400
    assert first.post("/api/team/login", json={"username": "x", "password": "x"}).status_code == 401
    assert "global" not in first.get("/api/team/browser-pool").json["data"]
    state["revoked"].add("session-A")
    assert first.get("/api/team/me").status_code == 401
    assert second.get("/api/team/me").status_code == 200
    with closing(sqlite3.connect(tmp_path / "team.sqlite3")) as conn:
        assert conn.execute("SELECT COUNT(*) FROM team_sessions WHERE tenant_id='A'").fetchone()[0] == 0
        assert "session-B" not in repr(conn.execute("SELECT * FROM team_sessions").fetchall())
    app.extensions["workers"].close()


def test_legacy_schema_migrates_without_losing_user(tmp_path, platform_server):
    platform, _state = platform_server
    with closing(sqlite3.connect(tmp_path / "team.sqlite3")) as conn, conn:
        conn.executescript("CREATE TABLE team_users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,"
                           "display_name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,"
                           "active INTEGER NOT NULL DEFAULT 1,created_at REAL NOT NULL);"
                           "CREATE TABLE team_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,"
                           "workspace_id TEXT NOT NULL,csrf TEXT NOT NULL,expires_at REAL NOT NULL);")
        conn.execute("INSERT INTO team_users VALUES('old','old_user','旧员工','hash','employee',1,0)")
    app = create_app(tmp_path, secure_cookie=False, platform_client=platform)
    with closing(sqlite3.connect(tmp_path / "team.sqlite3")) as conn:
        assert conn.execute("SELECT tenant_id FROM team_users WHERE id='old'").fetchone()[0] == "legacy"
    app.extensions["workers"].close()
