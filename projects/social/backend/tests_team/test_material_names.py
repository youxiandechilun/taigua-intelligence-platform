"""素材名称验收：真实员工进程、设备同步及权限隔离，不更改原文件和任务引用。"""

import hashlib
from pathlib import Path
import tempfile
import time
import unittest

from werkzeug.security import generate_password_hash

from hybrid_workspace import connect, snapshot
from team_gateway import create_app
from test_hybrid_integration import FixturePool


class MaterialNameTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.state = Path(self.temporary.name)
        self.pool = FixturePool(self.state)
        self.app = create_app(self.state, pool=self.pool, secure_cookie=False, bootstrap={
            "username": "name_admin", "password_hash": generate_password_hash("Names-test-2026")})
        self.app.testing = True
        self.owner = self.app.test_client()
        self.owner.post("/api/team/login", json={"username": "name_admin", "password": "Names-test-2026"})
        identity = self.owner.get("/api/team/me").json["data"]
        self.workspace = identity["workspace"]["id"]
        self.headers = {"X-CSRF-Token": identity["csrf"], "X-Workspace-ID": self.workspace}
        self.owner.post("/api/team/users", headers=self.headers, json={
            "username": "name_other", "password": "Names-test-2026", "display_name": "其他员工"})
        self.other = self.app.test_client()
        self.other.post("/api/team/login", json={"username": "name_other", "password": "Names-test-2026"})
        identity = self.other.get("/api/team/me").json["data"]
        self.other_headers = {"X-CSRF-Token": identity["csrf"], "X-Workspace-ID": identity["workspace"]["id"]}
        self.pool.get(self.workspace)
        self.base = self.state / "workspaces" / self.workspace
        self.hybrid = self.app.extensions["hybrid"]
        activation = self.hybrid.store.issue_activation(self.workspace)
        self.device = self.hybrid.store.activate(activation, "合成员工电脑", "macos-x64")
        self.device_headers = {"Authorization": "Bearer " + self.device["token"]}
        self.original = b"synthetic-material-original-content"
        self.digest = hashlib.sha256(self.original).hexdigest()
        with connect(self.base) as conn:
            for identifier, device in (("server-video", ""), ("device-video", self.device["id"])):
                relative = f"materials/{identifier}.mp4"
                if not device:
                    (self.base / relative).parent.mkdir(exist_ok=True)
                    (self.base / relative).write_bytes(self.original)
                conn.execute("INSERT INTO materials(id,original_filename,stored_path,file_type,mime_type,file_size,storage_type,device_id,sha256) "
                             "VALUES (?,?,?,'video','video/mp4',?,?,?,?)",
                             (identifier, identifier + ".mp4", relative, len(self.original), "device" if device else "local", device, self.digest))

    def tearDown(self):
        self.pool.close()
        self.temporary.cleanup()

    def test_name_survives_sync_restart_and_keeps_file_and_task_references(self):
        """设备离线也能改显示名称；旧插件回传原名称时不能覆盖自定义名称。"""
        job = self.hybrid.store.enqueue(self.workspace, "POST", "/postVideo", {"fileList": ["materials/server-video.mp4"]},
                                        due_at=time.time() + 3600, prepared=True)
        before = {row["id"]: row for row in snapshot(self.base)["materials"]}
        for identifier, name in (("server-video", "产品介绍"), ("device-video", "员工素材")):
            response = self.owner.post(f"/api/materials/{identifier}/rename", headers=self.headers, json={"name": name})
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(response.json["data"]["original_filename"], name + ".mp4")
        # 使用修改前的真实设备索引模拟稍后回传，验证名字不会被旧快照冲掉。
        response = self.app.test_client().post("/api/agent/metadata", headers=self.device_headers,
                                                json={"materials": [before["device-video"]]})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.pool.stop(self.workspace)
        listed = self.owner.get("/api/materials/list?keyword=员工素材").json["data"]["items"]
        self.assertEqual([item["id"] for item in listed], ["device-video"])
        context = self.app.test_client().get("/api/agent/context", headers=self.device_headers).json["data"]
        current = {row["id"]: row for row in context["materials"]}
        for identifier in before:
            self.assertEqual(current[identifier]["stored_path"], before[identifier]["stored_path"])
            self.assertEqual(current[identifier]["device_id"], before[identifier]["device_id"])
            self.assertEqual(current[identifier]["sha256"], before[identifier]["sha256"])
        self.assertEqual(current["device-video"]["original_filename"], "员工素材.mp4")
        self.assertEqual((self.base / "materials/server-video.mp4").read_bytes(), self.original)
        self.assertEqual(self.hybrid.store.get(job["id"], self.workspace)["payload"]["fileList"], ["materials/server-video.mp4"])
        self.assertEqual(self.hybrid.store.get(job["id"], self.workspace)["state"], "ready")

    def test_name_requires_owner_session_csrf_and_valid_text(self):
        """跨员工、缺失认证及非法名称均被拒绝，不改素材记录。"""
        path = "/api/materials/server-video/rename"
        self.assertEqual(self.app.test_client().post(path, json={"name": "名称"}).status_code, 401)
        self.assertEqual(self.owner.post(path, json={"name": "名称"}).status_code, 403)
        self.assertEqual(self.owner.post(path, headers={**self.headers, "X-Workspace-ID": "old-workspace"},
                                         json={"name": "旧页面名称"}).status_code, 409)
        self.assertEqual(self.other.post(path, headers=self.other_headers, json={"name": "越权"}).status_code, 404)
        for name in ("", "   ", "../文件", "目录/文件", "目录\\文件", "换\n行", "a" * 201, None, ["非法"]):
            with self.subTest(name=name):
                self.assertEqual(self.owner.post(path, headers=self.headers, json={"name": name}).status_code, 400)
        self.assertEqual(snapshot(self.base)["materials"][0]["original_filename"], "server-video.mp4")


if __name__ == "__main__":
    unittest.main()
