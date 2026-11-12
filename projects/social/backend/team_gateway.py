"""泰卦部署改造（2026-11-09）：登录、员工管理与独立工作区网关。"""

from __future__ import annotations

import atexit
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import tempfile
from urllib.parse import urlsplit

import requests
from flask import Flask, Response, g, jsonify, redirect, request, send_file, send_from_directory, stream_with_context
from brand_assets import BrandAssets, MAX_LOGO_BYTES
from browser_scheduler import BrowserScheduler
from hybrid_gateway import HybridGateway
from taigua_platform import PlatformClient, PlatformError
from team_identity_mapper import migrate_tenants, tenant_users, tenant_user, create_platform_session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parent.parent
COOKIE_NAME = "taigua_session"
PUBLIC_FILES = {"favicon.ico", "favicon.svg"}


def digest(value):
    """数据库只保存会话摘要，数据库副本不能直接充当登录凭证。"""
    return hashlib.sha256(value.encode()).hexdigest()


class WorkerPool:
    """每位员工使用独立进程、数据库和文件目录，兼容上游全部发布接口。"""

    def __init__(self, state_dir):
        self.state_dir = Path(state_dir)
        self.workers = {}
        self.lock = threading.Lock()
        atexit.register(self.close)

    def get(self, workspace_id):
        # 工作区编号只来自服务端数据库，不接受客户端提交目录或端口。
        if not re.fullmatch(r"[a-f0-9]{32}", workspace_id):
            raise ValueError("工作区编号无效")
        with self.lock:
            existing = self.workers.get(workspace_id)
            if existing and existing["process"].poll() is None:
                return existing
            workdir = self.state_dir / "workspaces" / workspace_id
            workdir.mkdir(parents=True, exist_ok=True, mode=0o700)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            token = secrets.token_urlsafe(32)
            env = os.environ.copy()
            env.update({
                "SAU_DATA_DIR": str(workdir), "SAU_PORT": str(port),
                "SAU_BIND_HOST": "127.0.0.1", "SAU_WORKER_TOKEN": token,
                "SAU_SERVER_MODE": "1", "SAU_BROWSER_ENGINE": "playwright",
                # 浏览器跨员工共享调度队列，但登录状态始终保存在各自的数据目录中。
                "SAU_BROWSER_POOL": str(self.state_dir / "browser-pool.sqlite3"),
                "SAU_WORKSPACE_ID": workspace_id,
                # 持久混合队列是任务状态来源，工作进程重启不能把这些任务当作孤儿取消。
                "SAU_EXECUTION_DB": str(self.state_dir / "execution.sqlite3"),
                "HOME": str(workdir / "home"),
            })
            Path(env["HOME"]).mkdir(exist_ok=True, mode=0o700)
            with (workdir / "worker.log").open("a") as log:
                proc = subprocess.Popen(
                    [sys.executable, "-u", str(ROOT / "backend" / "app.py")],
                    cwd=workdir, env=env, stdout=log, stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            worker = {"process": proc, "url": f"http://127.0.0.1:{port}", "token": token}
            self.workers[workspace_id] = worker
            # 首次创建工作区等待初始化；进程异常时把具体日志留在服务器目录。
            for _ in range(240):
                if proc.poll() is not None:
                    raise RuntimeError("工作区启动失败，请联系管理员检查运行日志")
                try:
                    response = requests.get(worker["url"] + "/api/health",
                                            headers={"X-Workspace-Token": token}, timeout=1)
                    if response.status_code == 200:
                        return worker
                except requests.RequestException:
                    pass
                time.sleep(0.25)
            raise RuntimeError("工作区初始化超时，请稍后重试")

    def stop(self, workspace_id):
        """员工停用时同时停止其任务进程，避免停用后继续操作平台账号。"""
        with self.lock:
            worker = self.workers.pop(workspace_id, None)
            if worker and worker["process"].poll() is None:
                if os.name == "nt":
                    worker["process"].terminate()
                else:
                    os.killpg(worker["process"].pid, signal.SIGTERM)
                try:
                    worker["process"].wait(timeout=8)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        worker["process"].kill()
                    else:
                        os.killpg(worker["process"].pid, signal.SIGKILL)
                    worker["process"].wait(timeout=3)

    def close(self):
        for workspace_id in list(self.workers):
            self.stop(workspace_id)


def create_app(state_dir=None, pool=None, secure_cookie=True, bootstrap=None, platform_client=None):
    app = Flask(__name__, static_folder=None)
    state = Path(state_dir or os.environ.get("TEAM_STATE_DIR", ROOT / "team-data")).resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    db_path = state / "team.sqlite3"
    workers = pool or WorkerPool(state)
    branding = BrandAssets(state)
    platform = platform_client or PlatformClient.from_environment()
    app.extensions["platform"] = platform
    # 调度只保留同员工串行，不再读取初始全站并发数的环境变量。
    browser_pool = BrowserScheduler(state / "browser-pool.sqlite3")
    app.config.update(TEAM_STATE_DIR=state, MAX_CONTENT_LENGTH=512 * 1024 * 1024)
    app.extensions["workers"] = workers
    app.extensions["browser_pool"] = browser_pool
    # 生产服务仅允许 Nginx 从回环地址转发，信任这一层的协议和来源地址。
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    @contextmanager
    def db():
        conn = sqlite3.connect(db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    with db() as conn:
        conn.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS team_users (
                id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin','employee')),
                active INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS team_sessions (
                token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL, csrf TEXT NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_attempts (address TEXT NOT NULL, created_at REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS attempts_address ON login_attempts(address, created_at);
            CREATE TABLE IF NOT EXISTS team_audit (
                id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
                target_id TEXT NOT NULL, created_at REAL NOT NULL
            );
        """)
        migrate_tenants(conn)
        seed_path = state / "bootstrap.json"
        seed = bootstrap or (json.loads(seed_path.read_text()) if seed_path.exists() else None)
        if not conn.execute("SELECT 1 FROM team_users LIMIT 1").fetchone():
            if not seed and not platform.enabled:
                raise RuntimeError("首次启动需要管理员初始化文件 bootstrap.json")
            if seed:
                conn.execute("INSERT INTO team_users(id,username,display_name,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?,?)", (
                    secrets.token_hex(16), seed["username"], "管理员", seed["password_hash"],
                    "admin", 1, time.time(),
                ))

    def public_user(row):
        return {key: row[key] for key in ("id", "username", "display_name", "role", "active", "created_at")}

    def error(message, status):
        return jsonify(code=status, msg=message), status

    def audit(conn, action, target):
        conn.execute("INSERT INTO team_audit(actor_id,action,target_id,created_at) VALUES (?,?,?,?)",
                     (g.user["id"], action, target, time.time()))

    def identity():
        with db() as conn:
            workspace = tenant_user(conn, g.session["workspace_id"], g.user["tenant_id"], g.session["agent_slug"])
            workspaces = tenant_users(conn, g.user["tenant_id"], active_only=True, slug=g.session["agent_slug"]) if g.user["role"] == "admin" else [g.user]
        return {"user": public_user(g.user), "workspace": public_user(workspace),
                "workspaces": [public_user(item) for item in workspaces], "csrf": g.session["csrf"],
                "agent_slug": g.session["agent_slug"]}

    def is_public_file():
        path = request.path.lstrip("/")
        return request.method in {"GET", "HEAD"} and (
            path == "" or path in PUBLIC_FILES or path.startswith("assets/")
        )

    @app.before_request
    def authenticate():
        # 执行插件使用独立设备凭证，每次请求仍核对员工是否启用。
        if request.path.startswith("/api/agent/"):
            return app.extensions["hybrid"].device_auth()
        # 登录页静态文件可匿名访问，其余接口一律要求有效的服务端会话。
        public_brand = request.method in {"GET", "HEAD"} and request.path in {
            "/api/team/branding", "/api/team/branding/logo", "/api/team/branding/icon",
        }
        if is_public_file() or request.path in {"/api/team/login", "/api/auth/sso"} or public_brand:
            return None
        token = request.cookies.get(COOKIE_NAME, "")
        with db() as conn:
            session = conn.execute("SELECT * FROM team_sessions WHERE token_hash=? AND expires_at>?",
                                   (digest(token), time.time())).fetchone() if token else None
            user = conn.execute("SELECT * FROM team_users WHERE id=? AND active=1", (session["user_id"],)).fetchone() if session else None
            workspace = tenant_user(conn, session["workspace_id"], session["tenant_id"], session["agent_slug"]) if session else None
        if not user or not workspace or not workspace["active"] or user["tenant_id"] != session["tenant_id"] or user["agent_slug"] != session["agent_slug"]:
            return error("请先登录", 401)
        if session["platform_session"]:
            try:
                parent = platform.for_slug(session["agent_slug"]).identity(token)
                if parent["mid"] != user["tenant_id"]:
                    return error("商户身份不匹配", 403)
            except PlatformError as exc:
                if exc.status in {401, 403}:
                    with db() as conn:
                        conn.execute("DELETE FROM team_sessions WHERE token_hash=?", (session["token_hash"],))
                return jsonify(code=exc.status, msg=exc.message, error=exc.code), exc.status
        if user["role"] != "admin" and session["workspace_id"] != user["id"]:
            return error("无权访问其他员工工作区", 403)
        g.user, g.session = user, session
        if request.path.startswith("/api/team/execution") and request.method not in {"GET", "HEAD", "OPTIONS"}:
            # 插件下载、设备撤销也受旧标签页工作区保护，防止绑定错员工。
            if request.headers.get("X-Workspace-ID") != session["workspace_id"]:
                return error("工作区已切换，请刷新页面后重试", 409)
        # 老版接口存在 GET 删除/扫码操作，因此所有非静态请求都校验来源。
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") != request.host_url.rstrip("/"):
            return error("请求来源不匹配", 403)
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            return error("禁止跨站操作", 403)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), session["csrf"]):
                return error("登录校验已失效，请刷新页面", 403)

    @app.after_request
    def protect_response(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "same-origin"
        # 内联事件脚本与插件内容不可执行，富文本颜色和排版仍允许使用内联样式。
        # 仅额外允许固定回环地址的本机插件，不向任意 HTTP 站点开放连接。
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http://127.0.0.1:*; media-src 'self' blob: https: http://127.0.0.1:*; font-src 'self' data:; connect-src 'self' http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
        if not is_public_file():
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.route("/api/auth/sso", methods=["GET", "POST"])
    def platform_login():
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") != request.host_url.rstrip("/"):
            return error("请求来源不匹配", 403)
        payload = request.get_json(silent=True) or {} if request.method == "POST" else {}
        token = str(payload.get("token") or request.args.get("ticket") or request.cookies.get("tk_token") or "")
        if not token or len(token) > 4096:
            return error("请从平台登录后进入社媒工作台", 401)
        try:
            slug = str(payload.get("agent_slug") or request.args.get("agent_slug") or platform.slug)
            parent = platform.for_slug(slug).identity(token, redeem=True)
        except PlatformError as exc:
            return jsonify(code=exc.status, msg=exc.message, error=exc.code), exc.status
        with db() as conn:
            created = create_platform_session(conn, parent)
        if created is None:
            return error("当前员工已停用", 403)
        user, csrf = created
        response = redirect("/#/", code=303) if request.method == "GET" else jsonify(code=200, data={"user": public_user(user), "csrf": csrf})
        response.set_cookie(COOKIE_NAME, parent["session_token"], max_age=max(1, int(parent["expire_at"] - time.time())),
                            httponly=True, secure=secure_cookie, samesite="Lax", path="/")
        return response

    @app.post("/api/team/login")
    def login():
        if platform.enabled and os.environ.get("TAIGUA_ALLOW_LOCAL_LOGIN") != "1":
            return error("请通过平台统一登录进入", 401)
        if request.headers.get("Origin") and request.headers["Origin"].rstrip("/") != request.host_url.rstrip("/"):
            return error("请求来源不匹配", 403)
        payload = request.get_json(silent=True) or {}
        username, password = str(payload.get("username", "")).strip(), str(payload.get("password", ""))
        if len(username) > 64 or len(password) > 256:
            return error("账号或密码错误", 401)
        address = digest((request.remote_addr or "unknown") + ":" + username)
        now = time.time()
        with db() as conn:
            conn.execute("DELETE FROM login_attempts WHERE created_at<?", (now - 900,))
            conn.execute("DELETE FROM team_sessions WHERE expires_at<?", (now,))
            attempts = conn.execute("SELECT COUNT(*) FROM login_attempts WHERE address=?", (address,)).fetchone()[0]
            if attempts >= 10:
                return error("尝试次数过多，请 15 分钟后重试", 429)
            user = conn.execute("SELECT * FROM team_users WHERE username=? AND active=1", (username,)).fetchone()
            if not user or not check_password_hash(user["password_hash"], password):
                conn.execute("INSERT INTO login_attempts VALUES (?,?)", (address, now))
                return error("账号或密码错误", 401)
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            conn.execute("DELETE FROM login_attempts WHERE address=?", (address,))
            conn.execute("INSERT INTO team_sessions(token_hash,user_id,workspace_id,csrf,expires_at,tenant_id) VALUES (?,?,?,?,?,?)", (digest(token), user["id"], user["id"], csrf, now + 43200, user["tenant_id"]))
        response = jsonify(code=200, data={"user": public_user(user), "csrf": csrf})
        response.set_cookie(COOKIE_NAME, token, max_age=43200, httponly=True, secure=secure_cookie, samesite="Lax", path="/")
        return response

    @app.get("/api/team/me")
    def me():
        return jsonify(code=200, data=identity())

    @app.route("/api/team/branding", methods=["GET", "POST", "DELETE"])
    def brand_settings():
        # 品牌属于整个系统，不随管理员当前查看的员工工作区改变。
        if request.method == "GET":
            return jsonify(code=200, data=branding.info())
        if g.user["role"] != "admin" or g.user["tenant_id"] != "legacy":
            return error("系统品牌由平台管理员统一维护", 403)
        if request.method == "DELETE":
            branding.reset()
        else:
            if request.content_length and request.content_length > MAX_LOGO_BYTES + 64 * 1024:
                return error("请选择不超过 5 MB 的图片", 413)
            image = request.files.get("logo")
            if not image:
                return error("请选择 Logo 图片", 400)
            try:
                branding.save(image.stream)
            except ValueError as exc:
                return error(str(exc), 400)
        with db() as conn:
            audit(conn, "reset_brand_logo" if request.method == "DELETE" else "update_brand_logo", "system")
        return jsonify(code=200, data=branding.info())

    @app.get("/api/team/branding/logo")
    @app.get("/api/team/branding/icon")
    def brand_image():
        image, _ = branding.read(icon=request.path.endswith("/icon"))
        return send_file(io.BytesIO(image), mimetype="image/png", max_age=0)

    @app.post("/api/team/logout")
    def logout():
        with db() as conn:
            conn.execute("DELETE FROM team_sessions WHERE token_hash=?", (g.session["token_hash"],))
        response = jsonify(code=200, msg="已退出登录")
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    @app.route("/api/team/users", methods=["GET", "POST"])
    def users():
        if g.user["role"] != "admin":
            return error("仅管理员可以管理员工", 403)
        with db() as conn:
            if request.method == "GET":
                return jsonify(code=200, data=[public_user(row) for row in tenant_users(conn, g.user["tenant_id"], slug=g.session["agent_slug"])])
            payload = request.get_json(silent=True) or {}
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))
            display_name = str(payload.get("display_name", "")).strip()
            if not re.fullmatch(r"[A-Za-z0-9_.@-]{3,64}", username):
                return error("账号需为 3–64 位字母、数字或 . _ @ -", 400)
            if not 8 <= len(password) <= 128 or not 1 <= len(display_name) <= 40:
                return error("请填写员工姓名及 8–128 位密码", 400)
            user_id = secrets.token_hex(16)
            try:
                conn.execute("INSERT INTO team_users(id,username,display_name,password_hash,role,active,created_at,tenant_id,agent_slug) VALUES (?,?,?,?,?,?,?,?,?)", (
                    user_id, username, display_name, generate_password_hash(password), "employee", 1, time.time(), g.user["tenant_id"], g.session["agent_slug"],
                ))
            except sqlite3.IntegrityError:
                return error("该账号已存在", 409)
            audit(conn, "create_employee", user_id)
        return jsonify(code=200, msg="员工账号已创建")

    @app.patch("/api/team/users/<user_id>")
    def update_employee(user_id):
        if g.user["role"] != "admin":
            return error("仅管理员可以管理员工", 403)
        payload = request.get_json(silent=True) or {}
        with db() as conn:
            target = tenant_user(conn, user_id, g.user["tenant_id"], g.session["agent_slug"])
            if not target or target["role"] != "employee":
                return error("只能修改员工账号", 400)
            name = str(payload.get("display_name", target["display_name"])).strip()
            active = payload.get("active", target["active"])
            if not 1 <= len(name) <= 40 or active not in (0, 1, False, True):
                return error("姓名或账号状态无效", 400)
            password = str(payload.get("password", ""))
            if password and not 8 <= len(password) <= 128:
                return error("密码需为 8–128 位", 400)
            conn.execute("UPDATE team_users SET display_name=?,active=? WHERE id=?", (name, int(active), user_id))
            if password:
                conn.execute("UPDATE team_users SET password_hash=? WHERE id=?", (generate_password_hash(password), user_id))
            if password or not active:
                conn.execute("DELETE FROM team_sessions WHERE user_id=?", (user_id,))
            audit(conn, "update_employee", user_id)
        if not active:
            app.extensions["hybrid"].store.revoke(user_id)
            workers.stop(user_id)
        return jsonify(code=200, msg="员工账号已更新")

    @app.post("/api/team/workspace")
    def switch_workspace():
        if g.user["role"] != "admin":
            return error("仅管理员可以切换员工工作区", 403)
        target_id = (request.get_json(silent=True) or {}).get("user_id")
        with db() as conn:
            target = tenant_user(conn, target_id, g.user["tenant_id"], g.session["agent_slug"])
            if not target or not target["active"]:
                return error("工作区不存在或已停用", 404)
            conn.execute("UPDATE team_sessions SET workspace_id=? WHERE token_hash=?", (target_id, g.session["token_hash"]))
            audit(conn, "switch_workspace", target_id)
        return jsonify(code=200, msg="已切换工作区")

    @app.post("/api/team/password")
    def change_password():
        payload = request.get_json(silent=True) or {}
        old, new = str(payload.get("old_password", "")), str(payload.get("password", ""))
        if not check_password_hash(g.user["password_hash"], old):
            return error("原密码错误", 400)
        if not 8 <= len(new) <= 128:
            return error("新密码需为 8–128 位", 400)
        with db() as conn:
            conn.execute("UPDATE team_users SET password_hash=? WHERE id=?", (generate_password_hash(new), g.user["id"]))
            conn.execute("DELETE FROM team_sessions WHERE user_id=?", (g.user["id"],))
            audit(conn, "change_password", g.user["id"])
        response = jsonify(code=200, msg="密码已修改，请重新登录")
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    @app.get("/api/team/status")
    def status():
        return jsonify(code=200, data={"service": "泰卦智能发布", "workspace_isolated": True})

    @app.route("/api/team/browser-pool", methods=["GET", "PUT"])
    def browser_pool_settings():
        # 员工只能看自己，管理员可看汇总；兼容查询，不允许旧页面恢复已移除的上限。
        administrator = g.user["role"] == "admin" and g.user["tenant_id"] == "legacy"
        if request.method == "PUT":
            if not administrator:
                return error("仅管理员可以管理调度设置", 403)
            return error("已取消全站并发上限，无需设置运行数量", 400)
        data = browser_pool.status(g.session["workspace_id"], include_global=administrator)
        return jsonify(code=200, data=data)

    def active_employee(workspace):
        # 设备只能跟随数据库中的员工状态，不能靠旧设备令牌绕过停用。
        with db() as conn:
            return conn.execute("SELECT 1 FROM team_users WHERE id=? AND active=1", (workspace,)).fetchone() is not None

    hybrid = HybridGateway(app, state, workers, active_employee)
    app.extensions["hybrid"] = hybrid

    @app.route("/", defaults={"path": ""}, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    @app.route("/<path:path>", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    def proxy(path):
        if is_public_file():
            return send_from_directory(ROOT / "frontend" / "dist", path or "index.html")
        # 移除作者反馈、更新及桌面专用入口；避免上传工作内容到外部反馈服务。
        if path.startswith(("api/team/", "api/feedback", "changelog")) or path in {"api/v2/changelog", "api/health"}:
            return error("接口不存在", 404)
        # 管理员切换工作区后，其他旧页面的写入和扫码请求不得落到新员工名下。
        changes_state = request.method not in {"GET", "HEAD", "OPTIONS"} or path in {"login", "deleteAccount", "checkAccount"}
        if changes_state:
            expected = request.headers.get("X-Workspace-ID") or request.args.get("__workspace")
            if expected != g.session["workspace_id"]:
                return error("工作区已切换，请刷新页面后重试", 409)
        # 普通平台操作进入员工本机队列，定时操作进入准备/服务器执行队列。
        intercepted = hybrid.intercept(path)
        if intercepted is not None:
            return intercepted
        if path == "api/v2/settings" and request.method == "PUT":
            payload = request.get_json(silent=True) or {}
            if payload.get("manualReview") in (True, "true", "True"):
                return error("服务器版使用自动提交，不支持本机浏览器人工确认", 400)
            if "maxConcurrent" in payload:
                # 旧页面仍可能提交该字段；全站并发上限已移除，不能再写入固定数字。
                return error("已取消全站并发上限，无需设置运行数量", 400)
        try:
            worker = workers.get(g.session["workspace_id"])
            headers = {key: value for key, value in request.headers if key.lower() in {
                "content-type", "content-length", "range", "if-range", "accept",
            }}
            headers["X-Workspace-Token"] = worker["token"]
            headers["X-Taigua-Merchant"] = g.user["tenant_id"]
            headers["X-Taigua-Agent"] = g.session["agent_slug"]
            if g.session["platform_session"]:
                headers["X-Taigua-Session"] = request.cookies.get(COOKIE_NAME, "")
            # 地址由服务端工作区映射生成；不转发 Cookie 或用户自带的认证头。
            query = [(key, value) for key, value in request.args.items(multi=True) if key != "__workspace"]
            # 视频走临时文件转发，避免网关和工作进程同时保留整份大文件的内存副本。
            with tempfile.SpooledTemporaryFile(max_size=2 * 1024 * 1024, dir=state) as body:
                if request.is_json:
                    body.write(request.get_data())
                else:
                    shutil.copyfileobj(request.stream, body, length=1024 * 1024)
                body_size = body.tell()
                headers["Content-Length"] = str(body_size)
                body.seek(0)
                upstream = requests.request(request.method, worker["url"] + "/" + path,
                                            params=query, data=body if body_size else None, headers=headers,
                                            stream=True, allow_redirects=False, timeout=(5, 180))
        except (requests.RequestException, RuntimeError) as exc:
            app.logger.error("工作区请求失败：%s", type(exc).__name__)
            return error("工作区暂时不可用，请稍后重试", 503)

        def chunks():
            try:
                is_stream = "text/event-stream" in upstream.headers.get("Content-Type", "")
                for chunk in upstream.iter_content(chunk_size=None):
                    # 长连接不能绕过退出、过期或管理员切换工作区后的会话撤销。
                    if is_stream:
                        with db() as conn:
                            valid = conn.execute("SELECT 1 FROM team_sessions WHERE token_hash=? AND workspace_id=? AND expires_at>?",
                                                 (g.session["token_hash"], g.session["workspace_id"], time.time())).fetchone()
                        if not valid:
                            break
                    yield chunk
            finally:
                upstream.close()

        allowed = {"content-type", "content-length", "content-range", "accept-ranges", "content-disposition"}
        # S3 采用带签名的 HTTPS 下载地址，保留其重定向才能正常预览文件。
        location = upstream.headers.get("Location", "")
        if urlsplit(location).scheme == "https":
            allowed.add("location")
        response = Response(stream_with_context(chunks()), status=upstream.status_code,
                            headers={k: v for k, v in upstream.headers.items() if k.lower() in allowed})
        if "text/event-stream" in upstream.headers.get("Content-Type", ""):
            response.headers["X-Accel-Buffering"] = "no"
        return response

    return app


if __name__ == "__main__":
    from waitress import serve
    application = create_app(secure_cookie=os.environ.get("TEAM_INSECURE_LOCAL") != "1")
    application.extensions["hybrid"].start()

    def shutdown(signum, frame):
        application.extensions["workers"].close()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, shutdown)
    # 仅信任本机 Nginx 的代理头，保留 HTTPS 来源，同时继续清除其他不受信任的头。
    serve(application, host="127.0.0.1", port=int(os.environ.get("TEAM_PORT", "18870")), threads=24,
          trusted_proxy="127.0.0.1", trusted_proxy_count=1,
          trusted_proxy_headers={"x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"})
