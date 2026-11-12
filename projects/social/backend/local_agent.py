"""泰卦员工执行插件：自动激活、主动领取任务、本机素材服务和结果补报。"""

import atexit
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

import requests
from flask import Flask, Response, jsonify, request, send_file
from waitress import create_server

from hybrid_execution import ExecutionError, ExecutionConflict
from hybrid_workspace import (browser_operation, connect, dependencies, file_hash,
                              delete_local_materials, result_changes, rows, safe_relative, seed_local, snapshot)


# 与 deployment/executor-manifest.json 保持一致，升级提示和心跳版本不能漂移。
VERSION = "2026.11.11.3"
FILE_OPERATIONS = ("/api/materials/upload", "/api/materials/covers/", "/api/uploads/",
                   "/api/extract-frames", "/api/frames", "/api/frame-image", "/importAccount")


def login_response_result(response):
    """兼容登录长连接与启动前的 JSON 错误，避免丢失平台不支持等真实原因。"""
    with response:
        if "text/event-stream" not in response.headers.get("Content-Type", "").lower():
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            message = payload.get("msg") if isinstance(payload, dict) else None
            if message == "不支持的平台类型":
                message = "当前电脑插件尚未包含该平台，请到系统设置重新下载并打开最新版插件"
            return {"code": 500, "msg": message or "平台登录响应异常，请更新插件后重试"}
        for line in response.iter_lines():
            # SSE 的 data 冒号后空格可省略；心跳与其他事件字段不属于登录结果。
            if not line.startswith(b"data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
            except (ValueError, UnicodeDecodeError):
                continue
            status = str(event.get("status", "")) if isinstance(event, dict) else str(event)
            if status == "200":
                return {"code": 200, "msg": "本机平台登录成功"}
            if status in {"error", "failed", "500", "0", "timeout", "cancelled"}:
                # LinkedIn/Pinterest 旧适配器使用 message，其余平台使用 msg。
                message = (event.get("msg") or event.get("message")) if isinstance(event, dict) else None
                return {"code": 500, "msg": message or "平台登录未完成，请重试"}
        return {"code": 500, "msg": "平台登录连接已结束，尚未确认授权，请保持插件开启后重新登录"}


def save_json(path, value):
    """先写临时文件再替换，断电不会把设备凭证或结果日志写成半份。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".next")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def data_root(config):
    """设备数据按系统地址和员工分别保存，换域名不会串用别的系统凭证。"""
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "TaiguaExecutor"
    else:
        root = Path.home() / "Library/Application Support/TaiguaExecutor"
    key = hashlib.sha256(config["server"].encode()).hexdigest()[:16]
    return root / key / config["workspace"]


class LocalAgent:
    """本机不开放公网端口；网页只能用本员工的短期本机访问能力访问素材接口。"""

    def __init__(self, config, root=None, config_path=None):
        parsed = urlsplit(config["server"])
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}):
            raise ExecutionError("执行插件仅连接当前系统的 HTTPS 地址")
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ExecutionError("系统地址格式无效")
        self.server, self.config = config["server"].rstrip("/"), dict(config)
        self.config_path = Path(config_path) if config_path else None
        self.root = Path(root) if root else data_root(config)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.base = self.root / "workspace"
        self.base.mkdir(exist_ok=True, mode=0o700)
        self.session = requests.Session()
        self.session.trust_env = False
        self.stop = threading.Event()
        self.operation = threading.RLock()
        self.worker_lock = threading.RLock()
        self.capability, self.worker_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self.worker, self.http_server, self.http_thread = None, None, None
        self.cancelled = set()
        self.current = None
        self.binding = self.root / "device.json"
        self.import_contexts = {}

    def status(self, state, message):
        """向可见窗口写入真实状态，不包含激活信息、设备令牌或平台授权。"""
        save_json(self.root / "status.json", {"state": state, "message": message,
                                             "updated_at": time.time(), "pid": os.getpid(), "version": VERSION})

    def api(self, path, data=None, method="POST", **options):
        """设备令牌只发给固定系统源，下载重定向也不能携带到其他网站。"""
        headers = {"Authorization": "Bearer " + self.device["token"]} if hasattr(self, "device") else {}
        headers.update(options.pop("headers", {}))
        raw = options.pop("raw", None)
        response = self.session.request(method, self.server + "/api/agent" + path, json=data if raw is None else None, data=raw,
                                        headers=headers, timeout=options.pop("timeout", 120),
                                        allow_redirects=False, **options)
        if response.status_code == 401:
            self.stop.set()
            raise ExecutionError("设备已撤销或员工已停用，请重新从网页登录后下载")
        if options.get("stream"):
            response.raise_for_status()
            return response
        try:
            content = response.json()
        finally:
            response.close()
        if content.get("code") != 200:
            if response.status_code == 409 and content.get("terminal_receipt"):
                raise ExecutionConflict(content.get("msg") or "旧任务回执已拒收")
            raise ExecutionError(content.get("msg") or "系统暂时不可用")
        return content.get("data")

    def activate(self):
        """首次打开即自动关联；重启复用设备凭证，不要求填写连接地址或账号密码。"""
        if self.binding.is_file():
            self.device = json.loads(self.binding.read_text())
            try:
                self.api("/heartbeat")
            except ExecutionError:
                if not self.stop.is_set() or not self.config.get("activation"):
                    raise
                # 旧设备已撤销时允许新下载安装包自动激活，不要求手动删本地配置。
                self.stop.clear()
                del self.device
        if not hasattr(self, "device"):
            self.device = self.api("/activate", {"activation": self.config.get("activation", ""),
                                                "name": platform.node() or "员工电脑", "platform": platform.system()})
            save_json(self.binding, self.device)
        self.config.pop("activation", None)
        if self.config_path:
            # 一次性信息用完即删除，已安装副本只留下当前系统与员工编号。
            save_json(self.config_path, self.config)

    def start_worker(self):
        """素材请求和取消心跳共用进程锁，防止并发启动或回收同一工作进程。"""
        with self.worker_lock:
            self._start_worker()

    def _start_worker(self):
        """取消导致工作进程退出后，下一个任务会启动新的干净执行进程。"""
        if self.worker and self.worker.poll() is None:
            return
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.worker_url = f"http://127.0.0.1:{port}"
        env = {**os.environ, "SAU_DATA_DIR": str(self.base), "SAU_PORT": str(port),
               "SAU_SERVER_MODE": "0", "SAU_LOCAL_AGENT": "1", "SAU_WORKER_TOKEN": self.worker_token,
               "SAU_BROWSER_ENGINE": "local-playwright", "SAU_PARENT_PID": str(os.getpid()),
               "PLAYWRIGHT_BROWSERS_PATH": str(self.root / "browsers")}
        # 本机工作进程不使用服务器调度数据库和服务器专有的 HOME 目录。
        env.pop("SAU_BROWSER_POOL", None)
        env.pop("SAU_EXECUTION_DB", None)
        log = (self.root / "worker.log").open("a")
        self.worker = subprocess.Popen([sys.executable, "-u", str(Path(__file__).with_name("local_worker.py"))],
                                       env=env, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=sys.platform != "win32")
        log.close()
        for _ in range(240):
            if self.worker.poll() is not None:
                raise ExecutionError("本机执行环境启动失败，请查看插件运行日志")
            try:
                with self.worker_request("GET", "/api/health", timeout=1) as response:
                    if response.status_code == 200:
                        return
            except requests.RequestException:
                pass
            time.sleep(0.25)
        raise ExecutionError("本机执行环境启动超时")

    def stop_worker(self):
        """关闭和取消可以并发触发，但实际回收只执行一次。"""
        with self.worker_lock:
            self._stop_worker()

    def _stop_worker(self):
        """关闭完整进程树，避免取消后遗留浏览器继续占用员工电脑。"""
        if not self.worker or self.worker.poll() is not None:
            return
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(self.worker.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
        else:
            import signal
            # 正式进程通过 start_new_session 创建；测试注入进程不属于独立进程组。
            if os.getpgid(self.worker.pid) == self.worker.pid:
                os.killpg(self.worker.pid, signal.SIGTERM)
            else:
                self.worker.terminate()
        try:
            self.worker.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.worker.kill()
            self.worker.wait(timeout=3)

    def worker_request(self, method, path, **options):
        headers = {"X-Workspace-Token": self.worker_token}
        headers.update(options.pop("headers", {}))
        return self.session.request(method, self.worker_url + path, headers=headers, timeout=options.pop("timeout", 3600), **options)

    def cache_material(self, material):
        """原有云端素材按需自动缓存；只在内容校验相符时复用已下载文件。"""
        target = self.base / safe_relative(material["stored_path"])
        expected = material.get("sha256")
        if target.is_file() and (not expected or file_hash(target) == expected):
            return
        if target.exists() and expected and material.get("device_id") == self.device["id"]:
            raise ExecutionError("本机素材已变化，请重新选择后发布")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = target.with_suffix(target.suffix + ".download")
        try:
            response = self.api("/materials/" + material["id"], method="GET", stream=True)
            with response, temporary.open("wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    output.write(chunk)
                expected = expected or response.headers.get("X-Material-Sha256")
            if expected and file_hash(temporary) != expected:
                raise ExecutionError("云端素材下载校验失败，请重试")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)

    def sync_materials(self):
        """网页文件直接写本机，服务器只接收文件索引和内容摘要。"""
        with connect(self.base) as conn:
            for directory in (self.base / "covers", self.base / "materials/thumbs"):
                for file in directory.rglob("*") if directory.is_dir() else []:
                    if not file.is_file() or file.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                        continue
                    # 索引统一使用网页相对路径，Windows 不能把反斜杠带到服务器素材地址。
                    relative = file.relative_to(self.base).as_posix()
                    if not conn.execute("SELECT 1 FROM materials WHERE stored_path=?", (relative,)).fetchone():
                        # 封面保留原编号，缩略图单独编号避免和原视频的素材编号冲突。
                        identifier = file.stem if directory.name == "covers" else "thumb-" + file.stem
                        conn.execute("INSERT OR IGNORE INTO materials(id,original_filename,stored_path,file_type,mime_type,file_size,auxiliary) "
                                     "VALUES (?,?,?,'image','image/jpeg',?,1)", (identifier, file.name, relative, file.stat().st_size))
            records, available = rows(conn, "materials"), []
            for row in records:
                # 更换电脑后旧设备素材只保留索引，不能把来源电脑静默改成当前设备。
                if row.get("device_id") not in ("", self.device["id"]):
                    continue
                target = self.base / safe_relative(row["stored_path"])
                if not target.is_file():
                    continue
                if not row.get("sha256"):
                    row["sha256"] = file_hash(target)
                    conn.execute("UPDATE materials SET sha256=? WHERE id=?", (row["sha256"], row["id"]))
                if row.get("storage_type") == "local" and not row.get("device_id"):
                    # 新上传素材由本机独立生成 UUID；原有云端索引会保留 source_server 标记。
                    source = self.cloud_materials.get(row["id"])
                    if not source:
                        row.update(storage_type="device", device_id=self.device["id"])
                        conn.execute("UPDATE materials SET storage_type='device',device_id=? WHERE id=?", (self.device["id"], row["id"]))
                available.append(row)
        self.api("/metadata", {"materials": available})

    def local_http(self):
        """仅素材、封面和处理接口可从网页访问，本机服务不是任意 HTTP 转发器。"""
        app = Flask("taigua-local-executor")
        origin = self.server
        self.cloud_materials = {}

        @app.before_request
        def authorize():
            if request.host.split(":")[0] != "127.0.0.1":
                return jsonify(code=403, msg="本机访问来源无效"), 403
            if request.headers.get("Origin") not in (None, origin):
                return jsonify(code=403, msg="不允许该网站访问本机素材"), 403
            if request.method == "OPTIONS":
                return Response(status=204)
            token = request.headers.get("Authorization", "").removeprefix("Bearer ")
            if request.method in {"GET", "HEAD"}:
                token = token or request.args.get("cap", "")
            if not secrets.compare_digest(token, self.capability):
                return jsonify(code=401, msg="本机访问校验已失效，请刷新网页"), 401
            if self.stop.is_set():
                return jsonify(code=503, msg="执行插件已停止"), 503

        @app.after_request
        def cors(response):
            response.headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin",
                "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": "Authorization,Content-Type,X-CSRF-Token,X-Workspace-ID,X-Request-ID,Range",
                "Access-Control-Allow-Private-Network": "true", "Cache-Control": "no-store"})
            return response

        @app.route("/<path:path>", methods=["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"])
        def proxy(path):
            path = "/" + path
            if not path.startswith(FILE_OPERATIONS) and not path.startswith("/api/materials/file/"):
                return jsonify(code=404, msg="本机接口不存在"), 404
            with self.operation:
                self.start_worker()
                # 从服务器刷新本人索引；不把设备目录交给网页自行指定。
                if not path.startswith(("/api/materials/file/", "/api/uploads/chunk", "/api/uploads/merge", "/importAccount/stream")):
                    context = self.api("/context", method="GET")
                    self.cloud_materials = {row["id"]: row for row in context["materials"]}
                    seed_local(self.base, context)
                    needed, _ = dependencies(self.base, request.get_json(silent=True) or request.args.to_dict())
                    for material in needed:
                        self.cache_material(material)
                headers = {key: value for key, value in request.headers if key.lower() in {"content-type", "range", "if-range"}}
                with tempfile.SpooledTemporaryFile(max_size=2 * 1024 * 1024, dir=self.root) as body:
                    shutil.copyfileobj(request.stream, body, 1024 * 1024)
                    size = body.tell()
                    body.seek(0)
                    headers["Content-Length"] = str(size)
                    upstream = self.worker_request(request.method, path, params={k: v for k, v in request.args.items() if k != "cap"},
                                                   data=body if size else None, headers=headers, stream=True)
                content_type = upstream.headers.get("Content-Type", "")
                if "application/json" in content_type:
                    content = upstream.json()
                    if path == "/importAccount" and content.get("code") == 200:
                        self.import_contexts[(content.get("data") or {})["task_id"]] = context
                    if request.method not in {"GET", "HEAD"} and content.get("code") == 200:
                        self.sync_materials()
                    upstream.close()
                    return jsonify(content), upstream.status_code
                if path == "/importAccount/stream":
                    task_id = request.args.get("task_id", "")
                    def import_events():
                        """导入结束后先同步公开资料，再通知网页刷新账号列表。"""
                        with self.operation, upstream:
                            for line in upstream.iter_lines():
                                if line.startswith(b"data: "):
                                    event = json.loads(line[6:])
                                    if event.get("status") == "done":
                                        changes = result_changes(self.base, self.import_contexts.get(task_id, {}))
                                        self.api("/accounts", {"user_info": changes.get("user_info", [])})
                                    yield line + b"\n\n"
                                    if event.get("status") in {"done", "error"}:
                                        break
                        self.import_contexts.pop(task_id, None)
                    return Response(import_events(), mimetype="text/event-stream")
                def chunks():
                    try:
                        yield from upstream.iter_content(1024 * 1024)
                    finally:
                        upstream.close()
                allowed = {"content-type", "content-length", "content-range", "accept-ranges", "content-disposition"}
                return Response(chunks(), status=upstream.status_code,
                                headers={k: v for k, v in upstream.headers.items() if k.lower() in allowed})

        # 每个服务持有独立 socket 映射，关闭本机插件不会误关同进程中的测试网关。
        self.http_server = create_server(app, host="127.0.0.1", port=0, threads=6, map={})
        self.port = int(self.http_server.effective_port)
        def serve_local():
            """服务停止时 socket 已关闭属于正常退出，运行中的异常仍写入日志。"""
            try:
                self.http_server.run()
            except OSError:
                if not self.stop.is_set():
                    raise
        self.http_thread = threading.Thread(target=serve_local, daemon=True)
        self.http_thread.start()

    def heartbeat(self):
        """网络中断不重复领取；服务端撤销设备后停止本机工作进程。"""
        while not self.stop.is_set():
            try:
                result = self.api("/heartbeat", {"port": self.port, "capability": self.capability, "version": VERSION,
                                                "active_job": self.current}, timeout=15)
                self.cancelled = set(result["cancelled"])
                self.status("online", "插件已在后台运行，可以回到网页操作。")
                if self.current and self.current in self.cancelled and self.worker and self.worker.poll() is None:
                    self.stop_worker()
            except requests.RequestException:
                self.status("offline", "网络暂时不可用，正在自动重连；请保持电脑联网。")
            except ExecutionError:
                self.status("error", "设备关联已失效，请从系统设置重新下载并打开插件。")
                self.stop.set()
            self.stop.wait(5)

    def execute(self, job):
        """任务只接受固定操作；开始前写本机日志，补报结果不会再执行一次。"""
        if not browser_operation(job["path"], job["method"]):
            raise ExecutionError("插件拒绝未知操作，请更新插件")
        seed_local(self.base, job["context"])
        self.cloud_materials = {row["id"]: row for row in job["context"]["materials"]}
        if job["path"] == "/api/materials/batch-delete":
            # 删除走同员工持久队列，完成回执可补报；不会为删除操作启动浏览器或下载素材。
            return delete_local_materials(self.base, job["payload"]["ids"], self.device["id"]), {}
        self.start_worker()
        for material in job["materials"]:
            self.cache_material(material)
        if job["phase"] == "prepare":
            # 只有员工明确创建的服务器定时任务才上传其引用的素材与授权。
            for kind, records in (("material", job["materials"]), ("account", job["accounts"])):
                for row in records:
                    path = self.base / safe_relative(row["stored_path"]) if kind == "material" else self.base / "cookiesFile" / row["filePath"]
                    if not path.is_file():
                        raise ExecutionError("本机平台尚未授权或素材不存在，请先完成登录和素材准备")
                    with path.open("rb") as content:
                        self.api(f"/jobs/{job['id']}/prepare/{kind}/{row['id']}", method="PUT", raw=content,
                                 headers={"X-Task-Lease": job["lease"]}, timeout=3600)
            return {"code": 200, "msg": "定时任务文件已同步，服务器正在核验授权"}, {}
        if job["path"] != "/login":
            for row in job["accounts"]:
                if not (self.base / "cookiesFile" / row["filePath"]).is_file():
                    raise ExecutionError("该平台账号尚未在本机登录，请先在账号管理中重新登录")
        response = self.worker_request(job["method"], job["path"], json=job["payload"] if job["method"] != "GET" else None,
                                       params=job["query"], stream=job["path"] == "/login")
        if job["path"] == "/login":
            result = login_response_result(response)
        else:
            result = response.json()
            response.close()
            task = (result.get("data") or {}).get("taskId")
            while task:
                current = self.worker_request("GET", "/postVideo/status/" + task).json()
                state = (current.get("data") or {}).get("status")
                if state in {"success", "failed"}:
                    result = {"code": 200 if state == "success" else 500, "msg": (current.get("data") or {}).get("msg", ""),
                              "data": current.get("data") or {}}
                    break
                if self.stop.wait(1):
                    raise ExecutionError("执行插件已停止，发布结果待核对")
        # 普通操作只回传公开账号资料及发布历史，Cookie 始终留在本机。
        changes = result_changes(self.base, job["context"])
        changes["materials"] = []
        return result, changes

    def report_pending(self):
        """已经执行完成但断网的结果先补报，绝不再次调用平台发布。"""
        for journal in (self.root / "results").glob("*.json"):
            data = json.loads(journal.read_text())
            try:
                self.api("/jobs/" + data["id"] + "/finish", {key: data[key] for key in ("lease", "result", "changes")})
                journal.unlink()
            except ExecutionConflict as exc:
                # 仅服务端明确终结的旧领取回执可归档；断网等错误仍继续补报，不重新发布。
                data["review_note"] = str(exc)
                save_json(self.root / "results/review" / journal.name, data)
                journal.unlink()

    def run(self):
        self.status("connecting", "正在自动关联当前员工，无需填写账号或地址。")
        self.activate()
        from local_browser import prepare_browser
        self.status("browser", "正在检查本机浏览器；首次准备可能需要几分钟，请保持联网。")
        prepare_browser(self.root)
        self.status("worker", "正在启动本机运行环境，请稍候……")
        self.start_worker()
        self.local_http()
        threading.Thread(target=self.heartbeat, daemon=True).start()
        while not self.stop.is_set():
            try:
                self.report_pending()
                job = self.api("/claim")
                if not job:
                    self.stop.wait(2)
                    continue
                with self.operation:
                    self.current = job["id"]
                    journal = self.root / "results" / (job["id"] + ".json")
                    try:
                        result, changes = self.execute(job)
                    except ExecutionError as exc:
                        result, changes = {"code": 400, "msg": str(exc)}, {}
                    except Exception:
                        # 请求中断可能发生在平台已提交之后，停止旧进程并交给服务端标记待核对。
                        self.stop_worker()
                        raise
                    finally:
                        self.current = None
                    save_json(journal, {"id": job["id"], "lease": job["lease"], "result": result, "changes": changes})
                    self.report_pending()
            except requests.RequestException:
                self.stop.wait(5)
            except ExecutionError:
                self.stop.wait(5)
            except Exception:
                # 未知执行中断由服务器标记结果待核对；不会在循环中重新执行该任务。
                self.current = None
                self.stop.wait(5)
        self.close()

    def close(self):
        self.stop.set()
        self.stop_worker()
        if self.http_server:
            self.http_server.close()
            self.http_server.task_dispatcher.shutdown()
            if self.http_thread and self.http_thread is not threading.current_thread():
                self.http_thread.join(timeout=3)
            self.http_server = None


def main():
    """安装包自带 Python，员工只需解压并首次打开启动器。"""
    config_path = Path(__file__).resolve().parent.parent / "activation.json"
    config = json.loads(config_path.read_text())
    agent = LocalAgent(config, config_path=config_path)
    lock = (agent.root / "agent.lock").open("a+b")
    try:
        # 与安装器使用同一把用户文件锁，系统启动与双击启动也只能保留一个实例。
        if sys.platform == "win32":
            import msvcrt
            lock.seek(0)
            if not lock.read(1):
                lock.write(b"0"); lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        return
    atexit.register(agent.close)
    try:
        agent.run()
    except requests.RequestException:
        # 激活或首次环境准备失败也要有可见原因，不让启动器悄悄退出。
        agent.status("error", "连接系统失败，请检查网络后重新打开插件。")
        raise
    except ExecutionError as exc:
        agent.status("error", str(exc))
        raise
    except Exception:
        agent.status("error", "运行环境准备失败，请查看日志后重新打开；首次准备浏览器需要联网。")
        raise
    finally:
        agent.close()
        lock.close()


if __name__ == "__main__":
    main()
