"""混合链路端到端验证：真实 HTTP、独立员工进程和本机素材，平台使用无外发合成实现。"""

import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile

from PIL import Image
import requests
from waitress import create_server
from werkzeug.security import generate_password_hash

from hybrid_workspace import snapshot
from local_agent import LocalAgent, save_json
from team_gateway import create_app


# 测试子进程只注册合成平台，不访问抖音等真实网站，也没有测试专用生产接口。
FIXTURE = '''
import asyncio, json, os, sqlite3, uuid
from pathlib import Path
from init_db import init_database, migrate_database
init_database(); migrate_database()
from conf import BASE_DIR
from app import app
from impl.registry import register
class Platform:
    platform_key = "douyin"
    platform_name = "合成平台"
    async def login(self, identifier, messages, account_id=None):
        filename = identifier + ".json"
        with sqlite3.connect(BASE_DIR / "db/database.db") as conn:
            if account_id:
                filename = conn.execute("SELECT filePath FROM user_info WHERE id=?", (account_id,)).fetchone()[0]
            else:
                conn.execute("INSERT INTO user_info(type,filePath,userName,status) VALUES (3,?,'合成员工账号',1)", (filename,))
        (BASE_DIR / "cookiesFile" / filename).write_text(json.dumps({"cookies": [], "origins": []}))
        messages.put(json.dumps({"status": "200"}))
    async def check_cookie(self, filename):
        return (BASE_DIR / "cookiesFile" / filename).is_file()
    async def publish_video(self, files, **kwargs):
        assert all(Path(value).is_file() for value in files)
        target = BASE_DIR / "synthetic-publications.txt"
        with target.open("a") as stream:
            stream.write("synthetic-only\\n")
        return True
    async def publish_image(self, files, **kwargs):
        assert files and all(Path(value).is_file() for value in files)
        return True
    async def publish_article(self, html, **kwargs):
        assert html.strip()
        from services.article_html import extract_img_srcs
        from impl.weixin_gzh.platform import WeixinGzhPlatform
        for src in extract_img_srcs(html):
            content, _, _ = WeixinGzhPlatform._resolve_image_bytes(src)
            assert content
        return True
register(3, Platform)
register(17, Platform)
from waitress import serve
serve(app, host="127.0.0.1", port=int(os.environ["SAU_PORT"]), threads=8)
'''


class FixturePool:
    """每个工作区仍启动独立真实应用进程，只替换外部平台实现。"""

    def __init__(self, directory):
        self.directory, self.workers = Path(directory), {}

    def launch(self, base, engine="playwright"):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base.mkdir(parents=True, exist_ok=True)
        token = secrets.token_urlsafe(32)
        log = (base / "fixture.log").open("a")
        process = subprocess.Popen([sys.executable, "-c", FIXTURE], cwd=os.environ.get("TAIGUA_FIXTURE_BACKEND") or Path(__file__).resolve().parents[1],
            env={**os.environ, "SAU_DATA_DIR": str(base), "SAU_PORT": str(port), "SAU_WORKER_TOKEN": token,
                 "SAU_BROWSER_ENGINE": engine, "SAU_SERVER_MODE": "0"}, stdout=log, stderr=subprocess.STDOUT)
        log.close()
        result = {"process": process, "url": f"http://127.0.0.1:{port}", "token": token}
        for _ in range(160):
            if process.poll() is not None:
                raise RuntimeError((base / "fixture.log").read_text()[-2000:])
            try:
                if requests.get(result["url"] + "/api/health", headers={"X-Workspace-Token": token}, timeout=1).status_code == 200:
                    return result
            except requests.RequestException:
                pass
            time.sleep(0.05)
        raise RuntimeError("合成员工进程启动超时")

    def get(self, workspace):
        if workspace not in self.workers:
            self.workers[workspace] = self.launch(self.directory / "workspaces" / workspace)
        return self.workers[workspace]

    def stop(self, workspace):
        worker = self.workers.pop(workspace, None)
        if worker and worker["process"].poll() is None:
            worker["process"].terminate()
            worker["process"].wait(timeout=10)

    def close(self):
        for workspace in list(self.workers):
            self.stop(workspace)


class HybridIntegrationTests(unittest.TestCase):
    def test_local_material_login_and_server_schedule_survive_employee_shutdown(self):
        """完整跑通下载激活、素材留本机、普通本机任务及关机后的服务器任务。"""
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "server"
            pool = FixturePool(state)
            app = create_app(state, pool=pool, secure_cookie=False, bootstrap={
                "username": "hybrid_test", "password_hash": generate_password_hash("Synthetic-test-2026")})
            server = create_server(app, host="127.0.0.1", port=0, threads=12, map={})
            server_stopping = threading.Event()
            def serve_test_gateway():
                """关闭测试网关的 socket 后只忽略预期的退出异常。"""
                try:
                    server.run()
                except OSError:
                    if not server_stopping.is_set():
                        raise
            server_thread = threading.Thread(target=serve_test_gateway, daemon=True)
            server_thread.start()
            url = f"http://127.0.0.1:{server.effective_port}"
            browser = requests.Session()
            agent = None
            try:
                self.assertEqual(browser.post(url + "/api/team/login", json={"username": "hybrid_test", "password": "Synthetic-test-2026"}).status_code, 200)
                identity = browser.get(url + "/api/team/me").json()["data"]
                headers = {"X-CSRF-Token": identity["csrf"], "X-Workspace-ID": identity["workspace"]["id"]}
                packages = app.extensions["hybrid"].package_root
                packages.mkdir(parents=True)
                with zipfile.ZipFile(packages / "macos-x64.zip", "w") as archive:
                    archive.writestr("泰卦插件.app/Contents/Resources/program/test-only.txt", "合成安装包，仅测试激活协议")
                response = browser.post(url + "/api/team/execution/download", headers=headers, json={"platform": "macos-x64"})
                self.assertEqual(response.status_code, 200, response.text[:200] if response.status_code != 200 else "")
                with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                    config = json.loads(archive.read("泰卦插件.app/Contents/Resources/program/activation.json"))
                agent = LocalAgent(config, root=Path(directory) / "employee-computer")
                agent.activate()
                local_worker = pool.launch(agent.base, "local-playwright")
                agent.worker, agent.worker_url, agent.worker_token = local_worker["process"], local_worker["url"], local_worker["token"]
                agent.local_http()
                agent.api("/heartbeat", {"port": agent.port, "capability": agent.capability, "version": "test"})
                image = io.BytesIO()
                Image.new("RGB", (16, 16), "#9e2535").save(image, "PNG")
                upload = requests.post(f"http://127.0.0.1:{agent.port}/api/materials/upload", headers={"Origin": url,
                    "Authorization": "Bearer " + agent.capability}, files={"file": ("synthetic.png", image.getvalue(), "image/png")})
                self.assertEqual(upload.status_code, 200, upload.text)
                material = browser.get(url + "/api/materials/list").json()["data"]["items"][0]
                base = state / "workspaces" / identity["workspace"]["id"]
                self.assertTrue((agent.base / material["stored_path"]).is_file())
                self.assertFalse((base / material["stored_path"]).exists(), "普通本机素材不能偷偷上传服务器")
                self.assertEqual(material["storage_type"], "device")
                # 非当前站点不能访问本机素材，即使拿到公开端口也没有访问资格。
                self.assertEqual(requests.get(f"http://127.0.0.1:{agent.port}/api/materials/file/" + material["stored_path"],
                    headers={"Origin": "https://unrelated.invalid", "Authorization": "Bearer " + agent.capability}).status_code, 403)
                # 通过真实持久队列执行平台登录，只有公开账号资料回传服务器。
                hybrid = app.extensions["hybrid"]
                job = hybrid.enqueue(identity["workspace"]["id"], "/login", {}, "GET", {"type": 3, "id": "01234567-89ab-cdef-0123-456789abcdef"})
                claimed = agent.api("/claim")
                result, changes = agent.execute(claimed)
                agent.api("/jobs/" + job["id"] + "/finish", {"lease": claimed["lease"], "result": result, "changes": changes})
                account = snapshot(base)["user_info"][0]
                self.assertFalse((base / "cookiesFile" / account["filePath"]).exists())
                # 草稿批量规划也必须走持久队列，不能回落旧服务器同步发布入口。
                from hybrid_workspace import connect
                image_draft = {"commonConfig": {"images": [material]}, "publishAccountIds": [account["id"]],
                               "platformConfigs": {"douyin": {"title": "合成图集", "aiContent": "自主创作", "dry_run": False}}}
                with connect(base) as conn:
                    identifier = conn.execute("INSERT INTO drafts(type,title,draft_data) VALUES ('image','合成图集',?)",
                                              (json.dumps(image_draft),)).lastrowid
                planned = browser.post(url + "/api/image-publish/drafts/batch-publish", headers=headers, json={"draft_ids": [identifier]})
                self.assertEqual(planned.status_code, 200, planned.text)
                self.assertEqual(len(planned.json()["data"]["task_ids"]), 1, planned.text)
                image_job = agent.api("/claim")
                result, changes = agent.execute(image_job)
                agent.api("/jobs/" + image_job["id"] + "/finish", {"lease": image_job["lease"], "result": result, "changes": changes})
                self.assertEqual(result["code"], 200, result)
                with connect(base) as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM publish_details WHERE batch_id=?", (image_job["payload"]["batchId"],)).fetchone()[0], 1)
                    article_account = conn.execute("INSERT INTO user_info(type,filePath,userName,status) VALUES (17,'synthetic-gzh.json','合成文章账号',1)").lastrowid
                    article_draft = {"commonConfig": {"articleTitle": "合成文章", "articleHtml": '<p>正文</p><img src="/api/materials/file/' + material["stored_path"] + '">'},
                                     "publishAccountIds": [article_account], "platformConfigs": {"weixin_gzh": {}}}
                    article_id = conn.execute("INSERT INTO drafts(type,title,draft_data) VALUES ('article','合成文章',?)", (json.dumps(article_draft),)).lastrowid
                (agent.base / "cookiesFile/synthetic-gzh.json").write_text('{"cookies":[],"origins":[]}')
                planned = browser.post(url + "/api/article-publish/drafts/batch-publish", headers=headers, json={"draft_ids": [article_id]})
                self.assertEqual(planned.status_code, 200, planned.text)
                article_job = agent.api("/claim")
                result, changes = agent.execute(article_job)
                agent.api("/jobs/" + article_job["id"] + "/finish", {"lease": article_job["lease"], "result": result, "changes": changes})
                self.assertEqual(result["code"], 200, result)
                # GET 不能取消任务；旧入口不能绕过混合队列在服务器执行普通任务。
                pending = hybrid.enqueue(identity["workspace"]["id"], "/checkAccount", {}, "GET", {"id": account["id"]})
                self.assertEqual(browser.get(url + "/api/v2/tasks/" + pending["id"] + "/cancel").status_code, 405)
                self.assertEqual(hybrid.store.get(pending["id"], identity["workspace"]["id"])["state"], "queued")
                self.assertEqual(browser.post(url + "/api/v2/tasks", headers=headers, json={"title": "禁止旁路"}).status_code, 400)
                old_claim = agent.api("/claim")
                hybrid.cancel_job(pending["id"], identity["workspace"]["id"])
                journal = agent.root / "results" / (pending["id"] + ".json")
                save_json(journal, {"id": pending["id"], "lease": old_claim["lease"], "result": {"code": 200}, "changes": {}})
                agent.report_pending()
                self.assertFalse(journal.exists())
                self.assertTrue((agent.root / "results/review" / journal.name).exists())
                # 生成真实六秒 MP4，通过应用原有时长校验，不绕过发布前检查。
                import cv2
                import numpy as np
                video = Path(directory) / "synthetic.mp4"
                writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 10, (32, 32))
                for _ in range(60):
                    writer.write(np.zeros((32, 32, 3), dtype=np.uint8))
                writer.release()
                with video.open("rb") as content:
                    response = requests.post(f"http://127.0.0.1:{agent.port}/api/materials/upload", headers={"Origin": url,
                        "Authorization": "Bearer " + agent.capability}, files={"file": ("synthetic.mp4", content, "video/mp4")})
                self.assertEqual(response.status_code, 200, response.text)
                material = response.json()["data"]
                with connect(agent.base) as conn:
                    conn.execute("UPDATE materials SET duration=6 WHERE id=?", (material["id"],))
                agent.sync_materials()
                # 视频批量规划复用平台校验，结果可持久化且不启动浏览器。
                video_draft = {"commonConfig": {"videoLandscape": material, "coverLandscape": {"stored_path": image_job["materials"][0]["stored_path"]}},
                    "publishAccountIds": [account["id"]], "platformConfigs": {"douyin": {"title": "合成视频", "aiContent": "自主创作"}}}
                planned = hybrid.call(identity["workspace"]["id"], "/api/internal/hybrid/plan", {"operation": "api/v2/videos/batch-publish", "payload": {"videos": [video_draft]}})
                self.assertEqual(len(planned["data"]["plans"]), 1, planned)
                payload = {"title": "合成验证", "type": 3, "fileList": [material["stored_path"]], "accountList": [account["filePath"]]}
                ordinary = hybrid.enqueue(identity["workspace"]["id"], "/postVideo", payload)
                claimed = agent.api("/claim")
                result, changes = agent.execute(claimed)
                agent.api("/jobs/" + ordinary["id"] + "/finish", {"lease": claimed["lease"], "result": result, "changes": changes})
                self.assertEqual(result["code"], 200, result)
                self.assertTrue((agent.base / "synthetic-publications.txt").is_file())
                self.assertFalse((base / "synthetic-publications.txt").exists())
                # 定时任务准备时才传该任务文件及授权，随后完全关闭员工执行进程。
                from datetime import datetime, timezone
                due = time.time() + 120
                payload["scheduleTime"] = datetime.fromtimestamp(due, timezone.utc).isoformat()
                scheduled = hybrid.enqueue(identity["workspace"]["id"], "/postVideo", payload)
                claimed = agent.api("/claim")
                result, changes = agent.execute(claimed)
                agent.api("/jobs/" + scheduled["id"] + "/finish", {"lease": claimed["lease"], "result": result, "changes": changes})
                self.assertEqual(hybrid.store.get(scheduled["id"], identity["workspace"]["id"])["state"], "ready")
                agent.close()
                hybrid.store.clock = lambda: due + 1
                server_job = hybrid.store.claim_server()
                self.assertEqual(server_job["id"], scheduled["id"])
                hybrid.execute_server(server_job)
                self.assertEqual(hybrid.store.get(scheduled["id"], identity["workspace"]["id"])["state"], "success")
                self.assertEqual((base / "synthetic-publications.txt").read_text().splitlines(), ["synthetic-only"])
                # 明确删除时先清理本机原文件，收到可补报回执后才删除服务器索引及定时副本。
                hybrid.store.clock = time.time
                agent.stop.clear()
                agent.api("/heartbeat")
                deletion = browser.delete(url + "/api/materials/" + material["id"], headers=headers).json()
                self.assertIn("execution_job", deletion, "本机素材不能只从服务器删除索引")
                claimed = agent.api("/claim")
                result, changes = agent.execute(claimed)
                receipt = {"lease": claimed["lease"], "result": result, "changes": changes}
                agent.api("/jobs/" + claimed["id"] + "/finish", receipt)
                agent.api("/jobs/" + claimed["id"] + "/finish", receipt)
                self.assertFalse((agent.base / material["stored_path"]).exists())
                self.assertFalse((base / material["stored_path"]).exists())
                self.assertNotIn(material["id"], {row["id"] for row in snapshot(base)["materials"]})
                agent.sync_materials()
                self.assertNotIn(material["id"], {row["id"] for row in snapshot(base)["materials"]}, "同步不能恢复已删除的素材")
                # 混合批量清理兼容旧云端素材，并保留其他设备的文件和明确失败明细。
                with connect(base) as conn:
                    for identifier, owner in (("legacy-delete", ""), ("other-device", "another-device")):
                        relative = "materials/" + identifier + ".png"
                        for folder in (base, agent.base):
                            (folder / "materials").mkdir(exist_ok=True)
                            (folder / relative).write_bytes(image.getvalue())
                        conn.execute("INSERT INTO materials(id,original_filename,stored_path,file_type,storage_type,device_id,sha256) "
                                     "VALUES (?,?,?,'image',?,?,?)", (identifier, identifier, relative,
                                     "device" if owner else "local", owner, hashlib.sha256(image.getvalue()).hexdigest()))
                image_material = image_job["materials"][0]
                ids = [image_material["id"], "legacy-delete", "other-device", "missing-material"]
                batch_delete = browser.post(url + "/api/materials/batch-delete", headers=headers, json={"ids": ids}).json()
                self.assertIn("execution_job", batch_delete)
                claimed = agent.api("/claim")
                result, changes = agent.execute(claimed)
                agent.api("/jobs/" + claimed["id"] + "/finish", {"lease": claimed["lease"], "result": result, "changes": changes})
                self.assertEqual(result["data"]["deleted"], 2)
                self.assertEqual({item["id"] for item in result["data"]["failed"]}, {"other-device", "missing-material"})
                for folder in (base, agent.base):
                    self.assertFalse((folder / "materials/legacy-delete.png").exists())
                    self.assertTrue((folder / "materials/other-device.png").exists())
                agent.sync_materials()
                self.assertEqual(next(row for row in snapshot(base)["materials"] if row["id"] == "other-device")["device_id"], "another-device")
                # 撤销后用新的下载信息可在同一台电脑重新激活，旧凭证不会困住员工。
                hybrid.store.revoke(identity["workspace"]["id"])
                new_config = {**config, "activation": hybrid.store.issue_activation(identity["workspace"]["id"])}
                config_path = agent.root / "activation-test.json"
                save_json(config_path, new_config)
                renewed = LocalAgent(new_config, root=agent.root, config_path=config_path)
                renewed.activate()
                self.assertNotEqual(renewed.device["id"], agent.device["id"])
                self.assertNotIn("activation", json.loads(config_path.read_text()))
                renewed.close()
            finally:
                if agent:
                    agent.close()
                pool.close()
                server_stopping.set()
                server.close()
                server.task_dispatcher.shutdown()
                server_thread.join(timeout=3)
                browser.close()
