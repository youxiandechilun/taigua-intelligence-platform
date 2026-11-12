"""混合执行网关：网页会话、设备凭证与员工工作区保持独立且逐次校验。"""

import io
import json
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time

import requests
from flask import Response, g, has_request_context, jsonify, redirect, request, send_file, stream_with_context

from social_billing import SocialBilling
from taigua_platform import PlatformClient, PlatformError

from hybrid_execution import ExecutionStore, ExecutionError, ExecutionConflict, TERMINAL, schedule_timestamp, immediate_payload
from hybrid_workspace import (BATCH_PATHS, PUBLISH_PATHS, apply_changes, browser_operation,
                              connect, dependencies, file_hash, safe_relative, server_prepared, snapshot)


# 八个海外平台统一使用修复访客误判和检测误报后的员工插件。
OVERSEAS_LOGIN_MIN_VERSION = (2026, 11, 11, 3)


def overseas_login_needs_update(platform_type, version):
    """按数字比较插件版本，缺失版本也不能误判为支持新增平台。"""
    if str(platform_type) not in {"7", "8", "101", "102", "103", "104", "105", "106"}:
        return False
    if not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", str(version)):
        return True
    return tuple(map(int, version.split("."))) < OVERSEAS_LOGIN_MIN_VERSION


class HybridGateway:
    """普通任务只分配给本机设备，定时任务只有服务器准备完成后才能进入执行队列。"""

    def __init__(self, app, state, workers, active_employee):
        self.app, self.state, self.workers = app, Path(state), workers
        # 下载包按发布版本保存，切回旧代码时仍可使用对应旧包，不覆盖回滚依赖。
        # 下载页同时读取安装包验收标记，不能把“ZIP 已生成”误显示成“真机已验证”。
        self.manifest = json.loads((Path(__file__).resolve().parents[1] / "deployment/executor-manifest.json").read_text())
        self.package_root = self.state / "executor-packages" / self.manifest["version"]
        self.active_employee = active_employee
        self.store = ExecutionStore(self.state / "execution.sqlite3")
        self.billing = SocialBilling(self.state, app.extensions.get("platform") or PlatformClient.from_environment())
        self.stopping = threading.Event()
        self.running = {}
        self.history_states = {}
        # 旧自动容量开关已移除，清理无业务数据的旧标记，重启也不会恢复全站上限。
        (self.state / "hybrid-auto-resources").unlink(missing_ok=True)
        self.register()

    def workspace(self, workspace):
        # 初始化复用旧员工数据库；业务目录只来自认证后的服务器员工编号。
        self.workers.get(workspace)
        return self.state / "workspaces" / workspace

    def call(self, workspace, path, payload=None, query=None, method="POST", timeout=180):
        worker = self.workers.get(workspace)
        response = requests.request(method, worker["url"] + path, json=payload, params=query,
                                    headers={"X-Workspace-Token": worker["token"]}, timeout=timeout)
        try:
            return response.json()
        finally:
            response.close()

    def device_auth(self):
        """设备不能使用网页 Cookie，网页也不能自选设备所属员工。"""
        if request.path == "/api/agent/activate":
            return None
        token = request.headers.get("Authorization", "")
        try:
            if not token.startswith("Bearer "):
                raise ExecutionError("缺少设备凭证")
            device = self.store.authenticate(token[7:])
            if not self.active_employee(device["workspace"]):
                raise ExecutionError("员工账号已停用")
            g.device = device
        except ExecutionError as exc:
            return jsonify(code=401, msg=str(exc)), 401

    def enqueue(self, workspace, path, payload, method="POST", query=None, request_id=None):
        base = self.workspace(workspace)
        if self.billing.platform.enabled and (path in PUBLISH_PATHS or path == "/api/internal/hybrid/run"):
            user = getattr(g, "user", None) if has_request_context() else None
            if user is None or user["tenant_id"] == "legacy":
                raise PlatformError("请通过平台创建发布任务", 403, "MERCHANT_REQUIRED")
            accounts = payload.get("accountList")
            quantity = len(accounts) if isinstance(accounts, list) and accounts else 1
            payload = {**payload, "__platform": {"mid": user["tenant_id"], "quantity": quantity,
                                                   "slug": g.session["agent_slug"]}}
        due = schedule_timestamp(payload) if path in PUBLISH_PATHS or path.endswith("/hybrid/run") else None
        if due:
            if due - time.time() < 60:
                raise ExecutionError("请至少提前一分钟创建服务器定时任务")
            dependencies(base, payload)
        ready = bool(due and server_prepared(base, payload))
        # 已有服务器素材和授权也要检查平台是否仍接受授权，不能只凭文件存在宣称就绪。
        if ready:
            ready = self.verify_accounts(workspace, payload)
        job = self.store.enqueue(workspace, method, path, payload, query=query, due_at=due,
                                 prepared=ready, request_id=request_id)
        if payload.get("_plan"):
            self.history(job)
        return job

    def verify_accounts(self, workspace, payload):
        _, accounts = dependencies(self.workspace(workspace), payload)
        return bool(accounts) and all(self.call(workspace, "/checkAccount", query={"id": row["id"]}, method="GET").get(
            "data", {}).get("valid") is True for row in accounts)

    def cancel_job(self, identifier, workspace):
        """运行中的云端任务先停止独立工作进程，再释放该员工的队列占位。"""
        job = self.store.get(identifier, workspace)
        if not job:
            return False
        if job["target"] == "server" and job["state"] == "running":
            self.workers.stop(workspace)
        self.store.cancel(identifier, workspace)
        self.billing.finish(self.store.get(identifier, workspace))
        self.history(self.store.get(identifier, workspace))
        return True

    def history(self, job):
        """把持久状态映射给旧历史页面；待核对状态另在执行面板中明确展示。"""
        if not job["payload"].get("_plan"):
            return
        signature = (job["state"], job["message"])
        if self.history_states.get(job["id"]) == signature:
            return
        state = job["state"]
        mapped = state if state in {"success", "failed", "running", "cancelled"} else (
            "failed" if state in {"review", "missed"} else "queued")
        self.call(job["workspace"], "/api/internal/hybrid/record", {
            "payload": job["payload"], "state": mapped, "message": job["message"]})
        self.history_states[job["id"]] = signature

    def register(self):
        app = self.app

        @app.errorhandler(PlatformError)
        def platform_failure(exc):
            return jsonify(code=exc.status, msg=exc.message, error=exc.code), exc.status

        @app.errorhandler(ExecutionError)
        def business_error(exc):
            return jsonify(code=400, msg=str(exc)), 400

        @app.errorhandler(ExecutionConflict)
        def receipt_conflict(exc):
            # 设备收到明确拒收才能归档旧回执；临时网络失败仍需继续补报。
            return jsonify(code=409, msg=str(exc), terminal_receipt=True), 409

        @app.post("/api/agent/activate")
        def activate():
            data = request.get_json(silent=True) or {}
            token = str(data.get("activation", ""))
            workspace = self.store.activation_workspace(token)
            if not self.active_employee(workspace):
                raise ExecutionError("员工账号已停用")
            result = self.store.activate(token, data.get("name", "员工电脑"), data.get("platform", ""))
            return jsonify(code=200, data=result)

        @app.post("/api/agent/heartbeat")
        def heartbeat():
            data = request.get_json(silent=True) or {}
            cancelled = self.store.heartbeat(g.device["id"], port=data.get("port"),
                                             capability=data.get("capability"), version=data.get("version", ""), active_job=data.get("active_job"))
            return jsonify(code=200, data={"cancelled": cancelled})

        @app.get("/api/agent/context")
        def context():
            return jsonify(code=200, data=snapshot(self.workspace(g.device["workspace"])))

        @app.post("/api/agent/metadata")
        def metadata():
            data = request.get_json(silent=True) or {}
            # 素材上传只允许登记本机素材，不允许顺便伪造账号或发布结果。
            apply_changes(self.workspace(g.device["workspace"]), {"materials": data.get("materials", [])}, g.device["id"])
            return jsonify(code=200)

        @app.post("/api/agent/accounts")
        def imported_accounts():
            """本机导入仅回传公开账号资料，导入的 Cookie 不经过服务器队列。"""
            data = request.get_json(silent=True) or {}
            apply_changes(self.workspace(g.device["workspace"]), {"user_info": data.get("user_info", [])}, g.device["id"])
            return jsonify(code=200)

        @app.get("/api/agent/materials/<identifier>")
        def material(identifier):
            base = self.workspace(g.device["workspace"])
            with connect(base) as conn:
                row = conn.execute("SELECT * FROM materials WHERE id=?", (identifier,)).fetchone()
            if not row:
                raise ExecutionError("素材不存在或不属于当前员工")
            path = base / safe_relative(row["stored_path"])
            if not path.is_file():
                return jsonify(code=404, msg="素材只在原员工电脑上，请恢复原文件"), 404
            response = send_file(path, conditional=True, mimetype=row["mime_type"])
            # 老素材首次下载也提供内容摘要，插件可校验并复用缓存。
            response.headers["X-Material-Sha256"] = row["sha256"] or file_hash(path)
            return response

        @app.post("/api/agent/claim")
        def claim():
            job = self.store.claim_local(g.device["id"])
            if job:
                if job["phase"] == "execute":
                    try:
                        self.billing.prepare(job)
                    except PlatformError as exc:
                        self.store.finish(job["id"], job["lease"], {"code": exc.status, "msg": exc.message}, g.device["id"])
                        raise
                job["context"] = snapshot(self.workspace(g.device["workspace"]))
                materials, accounts = dependencies(self.workspace(g.device["workspace"]), job["payload"])
                job["materials"], job["accounts"] = materials, accounts
                self.history(job)
            return jsonify(code=200, data=job)

        @app.route("/api/agent/jobs/<identifier>/prepare/<kind>/<item>", methods=["PUT"])
        def prepare_file(identifier, kind, item):
            job = self.store.validate_lease(identifier, request.headers.get("X-Task-Lease"), g.device["id"])
            if job["phase"] != "prepare" or job["target"] != "server":
                raise ExecutionError("普通本机任务不接收平台登录状态")
            base = self.workspace(g.device["workspace"])
            materials, accounts = dependencies(base, job["payload"])
            expected_hash = None
            if kind == "material":
                record = next((row for row in materials if row["id"] == item), None)
                if not record or record["device_id"] not in ("", g.device["id"]):
                    raise ExecutionError("任务素材不属于该设备")
                target = base / safe_relative(record["stored_path"])
                expected_hash = record["sha256"]
            elif kind == "account":
                record = next((row for row in accounts if str(row["id"]) == item), None)
                if not record:
                    raise ExecutionError("平台账号不属于该任务")
                target = base / "cookiesFile" / record["filePath"]
            else:
                raise ExecutionError("不支持的准备文件类型")
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = target.with_name(target.name + ".preparing-" + identifier)
            try:
                with temporary.open("wb") as output:
                    shutil.copyfileobj(request.stream, output, 1024 * 1024)
                temporary.chmod(0o600)
                if kind == "account":
                    if temporary.stat().st_size > 5 * 1024 * 1024:
                        raise ExecutionError("平台授权文件过大")
                    content = json.loads(temporary.read_text())
                    if not isinstance(content, dict) or not isinstance(content.get("cookies"), list):
                        raise ExecutionError("平台授权状态无效")
                elif expected_hash and file_hash(temporary) != expected_hash:
                    raise ExecutionError("素材内容已变化，请重新选择后安排定时任务")
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
            return jsonify(code=200)

        @app.post("/api/agent/jobs/<identifier>/finish")
        def finish(identifier):
            data = request.get_json(silent=True) or {}
            if self.store.reported(identifier, data.get("lease"), g.device["id"]):
                self.billing.finish(self.store.get(identifier, g.device["workspace"]))
                return jsonify(code=200)
            job = self.store.validate_lease(identifier, data.get("lease"), g.device["id"])
            base = self.workspace(g.device["workspace"])
            result = data.get("result") or {"code": 500, "msg": "执行端未返回结果"}
            if job["path"] == "/api/materials/batch-delete" and result.get("code") == 200:
                # 仅接受本次明确选择的编号；本机确认删除后才清理云端索引和定时副本。
                deleted = (result.get("data") or {}).get("deleted_ids", [])
                if not isinstance(deleted, list) or not set(deleted).issubset(set(job["payload"]["ids"])):
                    raise ExecutionError("素材删除回执包含未授权编号")
                with connect(base) as conn:
                    remaining = [item for item in deleted if conn.execute("SELECT 1 FROM materials WHERE id=?", (item,)).fetchone()]
                if remaining:
                    confirmation = self.call(g.device["workspace"], "/api/materials/batch-delete", {"ids": remaining})
                    if confirmation.get("code") != 200:
                        raise ExecutionError("服务器素材清理尚未完成，执行插件将保留回执等待补报")
                    failures = (confirmation.get("data") or {}).get("failed", [])
                    result["data"]["failed"].extend(failures)
                    result["data"]["deleted"] -= len(failures)
                result["msg"] = f"已删除 {result['data']['deleted']} 个素材"
            if job["phase"] == "prepare" and result.get("code") == 200:
                if not server_prepared(base, job["payload"]) or not self.verify_accounts(g.device["workspace"], job["payload"]):
                    result = {"code": 409, "msg": "服务器平台授权未通过，请在账号登录中选择服务器定时授权，再重新安排"}
                    self.store.finish(identifier, data.get("lease"), result, g.device["id"])
                else:
                    self.store.mark_prepared(identifier, data.get("lease"), g.device["id"])
            else:
                apply_changes(base, data.get("changes") or {}, g.device["id"])
                self.store.finish(identifier, data.get("lease"), result, g.device["id"])
            self.billing.finish(self.store.get(identifier, g.device["workspace"]))
            self.history(self.store.get(identifier, g.device["workspace"]))
            return jsonify(code=200)

        @app.get("/api/team/execution")
        def hybrid_status():
            result = self.store.status(g.session["workspace_id"])
            result["packages"] = [name for name in ("windows-x64", "macos-x64", "macos-arm64")
                                  if (self.package_root / (name + ".zip")).is_file()]
            result["package_status"] = {
                name: {
                    "native_install_verified": bool(meta.get("native_install_verified")),
                    "native_runtime_verified": bool(meta.get("native_runtime_verified")),
                    "native_gui_verified": bool(meta.get("native_gui_verified")),
                    "entry": meta.get("entry", ""),
                }
                for name, meta in self.manifest.get("packages", {}).items()
            }
            for job in result["jobs"]:
                full = self.store.get(job["id"], g.session["workspace_id"])
                self.history(full)
            return jsonify(code=200, data=result)

        @app.get("/api/team/execution/jobs/<identifier>")
        def job_status(identifier):
            job = self.store.get(identifier, g.session["workspace_id"])
            if not job:
                return jsonify(code=404, msg="任务不存在"), 404
            self.billing.finish(job)
            self.history(job)
            return jsonify(code=200, data=self.store.public_job(job))

        @app.post("/api/team/execution/jobs/<identifier>/cancel")
        def cancel(identifier):
            job = self.store.get(identifier, g.session["workspace_id"])
            if not job:
                return jsonify(code=404, msg="任务不存在"), 404
            self.cancel_job(identifier, g.session["workspace_id"])
            return jsonify(code=200)

        @app.post("/api/team/execution/jobs/<identifier>/resolve")
        def resolve_result(identifier):
            data = request.get_json(silent=True) or {}
            receipt = data.get("receipt")
            if not isinstance(receipt, str) or not 2 <= len(receipt.strip()) <= 1000:
                raise ExecutionError("请填写平台核对结果或作品链接")
            workspace = g.session["workspace_id"]
            if not self.store.get(identifier, workspace):
                return jsonify(code=404, msg="任务不存在"), 404
            self.store.resolve(identifier, workspace, data.get("success_count"), receipt.strip())
            job = self.store.get(identifier, workspace)
            self.billing.finish(job)
            self.history(job)
            return jsonify(code=200, msg="核对结果已保存", data=self.store.public_job(job))

        @app.post("/api/team/execution/revoke")
        def revoke():
            self.store.revoke(g.session["workspace_id"])
            return jsonify(code=200, msg="原设备已撤销，请重新下载并打开插件")

        @app.post("/api/materials/<identifier>/rename")
        def rename_material(identifier):
            """只修改当前员工素材的显示名称，原文件、摘要和已有任务引用保持稳定。"""
            # 此接口直接注册在网关，仍须拒绝管理员切换工作区后的旧标签页写入。
            if request.headers.get("X-Workspace-ID") != g.session["workspace_id"]:
                return jsonify(code=409, msg="工作区已切换，请刷新页面后重试"), 409
            data = request.get_json(silent=True)
            name = data.get("name") if isinstance(data, dict) else None
            if not isinstance(name, str):
                raise ExecutionError("请输入素材名称")
            name = name.strip()
            if not name or len(name) > 200 or name in {".", ".."}:
                raise ExecutionError("素材名称需为 1–200 个字符")
            if any(character in "/\\" or ord(character) < 32 or ord(character) == 127 for character in name):
                raise ExecutionError("名称不能包含路径分隔符或换行等控制字符")
            base = self.workspace(g.session["workspace_id"])
            with connect(base) as conn:
                # 名称独立保存；旧版插件回传原始文件名时，由数据库统一保留自定义名称。
                # 规则只安装在服务器工作区，不要求员工重新下载或升级插件。
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS material_names (
                        material_id TEXT PRIMARY KEY, name TEXT NOT NULL
                    );
                    CREATE TRIGGER IF NOT EXISTS material_name_after_insert AFTER INSERT ON materials
                    WHEN EXISTS (SELECT 1 FROM material_names WHERE material_id=NEW.id)
                    BEGIN
                        UPDATE materials SET original_filename=(SELECT name FROM material_names WHERE material_id=NEW.id)
                        WHERE id=NEW.id;
                    END;
                    CREATE TRIGGER IF NOT EXISTS material_name_after_update AFTER UPDATE OF original_filename ON materials
                    WHEN EXISTS (SELECT 1 FROM material_names WHERE material_id=NEW.id AND name!=NEW.original_filename)
                    BEGIN
                        UPDATE materials SET original_filename=(SELECT name FROM material_names WHERE material_id=NEW.id)
                        WHERE id=NEW.id;
                    END;
                """)
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT stored_path FROM materials WHERE id=? AND auxiliary=0", (identifier,)).fetchone()
                if not row:
                    return jsonify(code=404, msg="素材不存在或不属于当前员工"), 404
                extension = Path(row["stored_path"]).suffix
                if extension and not name.lower().endswith(extension.lower()):
                    name += extension
                if len(name) > 200:
                    raise ExecutionError("素材名称连同后缀最多 200 个字符")
                # 清理已删除素材的名称记录，不留下无引用的历史配置。
                conn.execute("DELETE FROM material_names WHERE NOT EXISTS (SELECT 1 FROM materials WHERE id=material_id)")
                conn.execute("INSERT INTO material_names(material_id,name) VALUES (?,?) "
                             "ON CONFLICT(material_id) DO UPDATE SET name=excluded.name", (identifier, name))
                conn.execute("UPDATE materials SET original_filename=? WHERE id=?", (name, identifier))
            return jsonify(code=200, msg="名称已保存", data={"id": identifier, "original_filename": name})

        @app.post("/api/team/execution/download")
        def download():
            # 每次下载生成当前员工专属的单入口应用，不再暴露运行环境目录。
            from executor_package import personalize_executor
            platform = (request.get_json(silent=True) or {}).get("platform", "")
            if platform not in {"windows-x64", "macos-x64", "macos-arm64"}:
                raise ExecutionError("请选择适合员工电脑的安装包")
            package = self.package_root / (platform + ".zip")
            if not package.is_file():
                return jsonify(code=503, msg="该系统的安装包尚未准备好"), 503
            folder = self.state / "executor-downloads"
            folder.mkdir(exist_ok=True, mode=0o700)
            for old in folder.glob("*.zip"):
                if time.time() - old.stat().st_mtime > 3600:
                    old.unlink(missing_ok=True)
            token = self.store.issue_activation(g.session["workspace_id"])
            config = {"server": request.host_url.rstrip("/"), "activation": token,
                      "workspace": g.session["workspace_id"]}
            handle = tempfile.NamedTemporaryFile(suffix=".zip", dir=folder, delete=False)
            target = Path(handle.name)
            handle.close()
            personalize_executor(package, target, config, platform)
            response = send_file(target, as_attachment=True, download_name=f"泰卦执行插件-{platform}.zip", max_age=0)
            response.call_on_close(lambda: target.unlink(missing_ok=True))
            return response

    def intercept(self, path):
        """旧网页接口保持兼容，但浏览器操作不再悄悄在云端运行。"""
        path = "/" + path
        workspace = g.session["workspace_id"]
        if path.startswith("/api/internal/"):
            return jsonify(code=404, msg="接口不存在"), 404
        if path in {"/importAccount", "/importAccount/stream"}:
            raise ExecutionError("账号导入请通过员工电脑插件完成，请刷新页面并确认插件在线")
        if path == "/api/v2/tasks" and request.method == "POST":
            raise ExecutionError("请从发布中心提交任务，当前入口不支持混合执行")
        single_delete = request.method == "DELETE" and re.fullmatch(r"/api/materials/[^/]+", path)
        if single_delete or (path == "/api/materials/batch-delete" and request.method == "POST"):
            identifiers = [path.rsplit("/", 1)[-1]] if single_delete else (request.get_json(silent=True) or {}).get("ids")
            if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 1000 or any(not isinstance(item, str) for item in identifiers):
                raise ExecutionError("请选择 1–1000 个有效素材")
            with connect(self.workspace(workspace)) as conn:
                selected = [conn.execute("SELECT device_id FROM materials WHERE id=?", (item,)).fetchone() for item in identifiers]
            if any(row and row[0] for row in selected):
                device = self.store.status(workspace)["device"]
                if not device or not device["online"]:
                    raise ExecutionError("请先打开素材所在电脑的执行插件，再删除本机素材")
                job = self.enqueue(workspace, "/api/materials/batch-delete", {"ids": identifiers},
                                   request_id=request.headers.get("X-Request-ID"))
                return jsonify(code=200, execution_job=job["id"], data={"job_id": job["id"]})
            # 旧服务器素材仍允许直接清理，不要求为已有云端文件强制启动员工电脑。
            return None
        if path == "/api/v2/tasks/cancel-batch" and request.method == "POST":
            identifiers = (request.get_json(silent=True) or {}).get("task_ids") or []
            if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 1000:
                raise ExecutionError("请选择 1–1000 个任务")
            count = sum(self.cancel_job(str(identifier), workspace) for identifier in identifiers)
            return jsonify(code=200, data={"cancelled": count, "total": len(identifiers)}, msg=f"已请求取消 {count} 个任务")
        if path.startswith("/api/materials/file/"):
            stored = path[len("/api/materials/file/"):]
            with connect(self.workspace(workspace)) as conn:
                row = conn.execute("SELECT device_id FROM materials WHERE stored_path=? OR thumbnail_path=?", (stored, stored)).fetchone()
            if row and row[0]:
                device = self.store.status(workspace)["device"]
                if not device or not device.get("endpoint") or device["id"] != row[0]:
                    return jsonify(code=404, msg="本机素材所在电脑未上线"), 404
                from urllib.parse import quote
                return redirect(device["endpoint"] + path + "?cap=" + quote(device["capability"]), code=307)
        if path.startswith("/postVideo/status/"):
            job = self.store.get(path.rsplit("/", 1)[-1], workspace)
            if job:
                state = job["state"] if job["state"] in {"success", "failed", "running"} else (
                    "failed" if job["state"] in TERMINAL else "queued")
                return jsonify(code=200, data={"status": state, "msg": job["message"]})
        if not browser_operation(path, request.method):
            return None
        if path.startswith("/api/v2/tasks/") and path.endswith(("/cancel", "/retry")):
            identifier = path.split("/")[-2]
            job = self.store.get(identifier, workspace)
            if job:
                if path.endswith("/retry"):
                    raise ExecutionError("请核对原任务结果后，在发布页重新提交；系统不会自动重复发布")
                self.cancel_job(identifier, workspace)
                return jsonify(code=200, msg="已请求取消")
            raise ExecutionError("任务不存在或不属于当前员工，请刷新后重新选择")
        if path == "/login" and request.args.get("execution") == "server":
            # 员工主动选择服务器授权时沿用页面桥接，不能用本机登录冒充云端可用。
            return None
        if path == "/login":
            device = self.store.status(workspace)["device"]
            if device and overseas_login_needs_update(request.args.get("type"), device["version"]):
                # 旧插件只解析 SSE；在入队前直接告知更新原因，避免领取后又丢失 JSON 错误。
                message = {"status": "error", "msg": "当前电脑插件需要更新，海外登录状态检测已修复。请到系统设置重新下载最新版插件后重试。"}
                return Response("data: " + json.dumps(message, ensure_ascii=False) + "\n\n",
                                mimetype="text/event-stream",
                                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        # 内部领取和历史编号只能由网关规划，不能接受网页构造的内部字段。
        payload = {key: value for key, value in (request.get_json(silent=True) or {}).items() if not key.startswith("_")}
        if path in BATCH_PATHS:
            if path == "/postVideoBatch":
                raise ExecutionError("请使用发布中心的视频队列提交批量任务")
            plan = self.call(workspace, "/api/internal/hybrid/plan", {"operation": path.lstrip("/"), "payload": payload})
            if plan.get("code") != 200:
                return jsonify(plan), 400
            jobs, failures = [], plan["data"]["failed"]
            previous_video, current_video, video_jobs, previous_jobs = None, None, [], []
            try:
                delay = max(0, float(payload.get("interval_minutes") or 0)) * 60
            except (TypeError, ValueError):
                delay = 0
            for item in plan["data"]["plans"]:
                try:
                    if current_video != item["video"]:
                        previous_video, current_video = current_video, item["video"]
                        previous_jobs, video_jobs = video_jobs, []
                    if not schedule_timestamp(item["payload"]):
                        item["payload"].update(__after_jobs=previous_jobs, __delay=delay)
                    parent_request = request.headers.get("X-Request-ID")
                    request_key = f"{parent_request}:{item['video']}:{item['payload']['_plan']['account']['id']}" if parent_request else None
                    added = self.enqueue(workspace, item["path"], item["payload"], request_id=request_key)
                    jobs.append(added)
                    if added["target"] == "local":
                        video_jobs.append(added["id"])
                except ExecutionError as exc:
                    failures.append({"video": item["video"], "reason": str(exc)})
            return jsonify(code=200, data={"task_ids": [job["id"] for job in jobs],
                                          "batch_ids": list(dict.fromkeys(job["payload"]["batchId"] for job in jobs)),
                                          "failed": failures})
        query = {key: value for key, value in request.args.items() if key != "__workspace"}
        if path not in PUBLISH_PATHS and path != "/login":
            device = self.store.status(workspace)["device"]
            if not device or not device["online"]:
                raise ExecutionError("请先在当前员工电脑下载并打开执行插件，入口在系统设置")
        job = self.enqueue(workspace, path, payload, request.method, query, request.headers.get("X-Request-ID"))
        if path == "/login":
            def stream():
                try:
                    last = None
                    while True:
                        current = self.store.get(job["id"], workspace)
                        if current["state"] in TERMINAL:
                            result = current.get("result") or {}
                            message = {"status": "200" if current["state"] == "success" else "error",
                                       "msg": result.get("msg") or current["message"]}
                            yield "data: " + json.dumps(message, ensure_ascii=False) + "\n\n"
                            break
                        message = "请在员工电脑弹出的浏览器中完成登录" if current["state"] == "running" else "等待员工电脑执行插件上线并领取登录任务"
                        if last != message:
                            yield "data: " + json.dumps({"status": "waiting", "msg": message}, ensure_ascii=False) + "\n\n"
                            last = message
                        else:
                            yield ": heartbeat\n\n"
                        time.sleep(1)
                finally:
                    current = self.store.get(job["id"], workspace)
                    if current["state"] not in TERMINAL:
                        self.store.cancel(job["id"], workspace)
            return Response(stream_with_context(stream()), mimetype="text/event-stream", headers={"X-Accel-Buffering": "no"})
        if path == "/postVideo":
            return jsonify(code=200, msg="任务已进入持久队列", data={"taskId": job["id"], "execution": job["target"]})
        # 前端请求适配器等待真实结果；定时任务返回的是安排状态，不能显示为已发布。
        return jsonify(code=200, execution_job=job["id"], execution_target=job["target"],
                       data={"job_id": job["id"], "state": job["state"], "scheduled": job["target"] == "server"})

    def start(self):
        """仅正式网关启动调度线程，Flask 单元测试不会在后台执行任务。"""
        threading.Thread(target=self.dispatch, daemon=True, name="server-scheduled-dispatch").start()

    def dispatch(self):
        while not self.stopping.wait(1):
            self.running = {key: thread for key, thread in self.running.items() if thread.is_alive()}
            try:
                self.billing.reconcile(self.store)
            except PlatformError:
                self.app.logger.warning("发布计费结算暂未完成，将在下一轮重试")
            # 同一轮放行所有已到点且可领取的员工任务；员工自己的串行由持久队列保证。
            while not self.stopping.is_set():
                job = self.store.claim_server()
                if not job:
                    break
                if not self.active_employee(job["workspace"]):
                    self.store.finish(job["id"], job["lease"], {"code": 403, "msg": "员工账号已停用"})
                    continue
                thread = threading.Thread(target=self.execute_server, args=(job,), daemon=True)
                self.running[job["id"]] = thread
                thread.start()

    def execute_server(self, job):
        stop = threading.Event()
        def renew():
            while not stop.wait(5):
                try:
                    self.store.renew_server(job["id"], job["lease"])
                except ExecutionError:
                    return
        threading.Thread(target=renew, daemon=True).start()
        try:
            self.history(job)
            if not server_prepared(self.workspace(job["workspace"]), job["payload"]):
                self.store.finish(job["id"], job["lease"], {"code": 409, "msg": "定时素材或授权已变化，请重新准备并安排"})
                self.history(self.store.get(job["id"], job["workspace"]))
                return
            self.billing.prepare(job)
            result = self.call(job["workspace"], job["path"], immediate_payload(job["payload"]), job["query"], job["method"], timeout=3600)
            task_id = (result.get("data") or {}).get("taskId")
            while task_id and result.get("code") == 200:
                status = self.call(job["workspace"], "/postVideo/status/" + task_id, method="GET")
                state = (status.get("data") or {}).get("status")
                if state in {"success", "failed"}:
                    result = {"code": 200 if state == "success" else 500, "msg": (status.get("data") or {}).get("msg", ""),
                              "data": status.get("data") or {}}
                    break
                time.sleep(1)
            self.store.finish(job["id"], job["lease"], result)
            self.billing.finish(self.store.get(job["id"], job["workspace"]))
            self.history(self.store.get(job["id"], job["workspace"]))
        except PlatformError as exc:
            if not self.billing.mapper.get(job["id"]) or not self.billing.mapper.get(job["id"]).hold_id:
                self.store.finish(job["id"], job["lease"], {"code": exc.status, "msg": exc.message})
            self.app.logger.warning("发布平台计费暂不可用，任务编号=%s", job["id"])
        except Exception:
            # 网络中断可能发生在平台已提交之后，保留领取记录由租约超时标记待核对。
            self.app.logger.exception("服务器定时任务执行中断，任务编号=%s", job["id"])
        finally:
            stop.set()
