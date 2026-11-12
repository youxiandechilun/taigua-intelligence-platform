"""泰卦部署改造：验证认证、员工权限、会话撤销和真实工作区数据隔离。"""

import io
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from flask import Flask, jsonify
from werkzeug.security import generate_password_hash

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from team_gateway import COOKIE_NAME, create_app, digest
from workspace_guard import install_workspace_guard


class HttpsProxyTests(unittest.TestCase):
    def test_waitress_accepts_https_origin_from_loopback_nginx(self):
        """真实 Waitress 入口必须保留回环 Nginx 传递的 HTTPS 协议信息。"""
        import requests
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'bootstrap.json').write_text(json.dumps({
                'username': 'proxy_admin', 'password_hash': generate_password_hash('Proxy-test-2026'),
            }))
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            with tempfile.TemporaryFile() as log:
                process = subprocess.Popen([sys.executable, str(Path(__file__).resolve().parents[1] / 'team_gateway.py')],
                    env={**os.environ, 'TEAM_STATE_DIR': directory, 'TEAM_PORT': str(port), 'TEAM_INSECURE_LOCAL': '0'},
                    stdout=log, stderr=subprocess.STDOUT)
                try:
                    url = f'http://127.0.0.1:{port}'
                    for _ in range(100):
                        try:
                            if requests.get(url + '/api/team/me', timeout=1).status_code == 401:
                                break
                        except requests.RequestException:
                            pass
                        time.sleep(0.05)
                    response = requests.post(url + '/api/team/login', headers={
                        'Host': 'publish.example', 'Origin': 'https://publish.example',
                        'X-Forwarded-Host': 'publish.example', 'X-Forwarded-Proto': 'https',
                        'X-Forwarded-For': '198.51.100.25',
                    }, json={'username': 'proxy_admin', 'password': 'Proxy-test-2026'}, timeout=5)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertIn('Secure', response.headers['Set-Cookie'])
                finally:
                    process.terminate()
                    process.wait(timeout=10)


class TeamAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.app = create_app(cls.tmp.name, secure_cookie=False, bootstrap={
            "username": "test_admin", "password_hash": generate_password_hash("Admin-test-2026"),
        })
        cls.app.testing = True
        cls.admin = cls.app.test_client()
        response = cls.admin.post('/api/team/login', json={"username": "test_admin", "password": "Admin-test-2026"})
        assert response.status_code == 200
        cls.admin_me = cls.admin.get('/api/team/me').json['data']
        cls.admin_headers = {"X-CSRF-Token": cls.admin_me['csrf'], "X-Workspace-ID": cls.admin_me['workspace']['id']}
        for number in (1, 2):
            response = cls.admin.post('/api/team/users', headers=cls.admin_headers, json={
                "username": f"employee{number}", "display_name": f"测试员工{number}", "password": "Employee-test-2026", "role": "admin",
            })
            assert response.status_code == 200
            client = cls.app.test_client()
            assert client.post('/api/team/login', json={"username": f"employee{number}", "password": "Employee-test-2026"}).status_code == 200
            identity = client.get('/api/team/me').json['data']
            setattr(cls, f'employee{number}', client)
            setattr(cls, f'identity{number}', identity)
            setattr(cls, f'headers{number}', {"X-CSRF-Token": identity['csrf'], "X-Workspace-ID": identity['workspace']['id']})

    @classmethod
    def tearDownClass(cls):
        cls.app.extensions['workers'].close()
        cls.tmp.cleanup()

    def test_01_anonymous_cannot_read_private_routes(self):
        client = self.app.test_client()
        for route in ['/getAccounts', '/api/materials/list', '/api/v2/drafts', '/downloadCookie?filePath=x', '/api/v2/tasks/stream', '/api/team/users']:
            with self.subTest(route=route):
                self.assertEqual(client.get(route).status_code, 401)

    def test_02_password_and_session_storage(self):
        client = self.app.test_client()
        self.assertEqual(client.post('/api/team/login', json={"username": "employee1", "password": "wrong"}).status_code, 401)
        response = client.post('/api/team/login', json={"username": "employee1", "password": "Employee-test-2026"})
        self.assertIn('HttpOnly', response.headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', response.headers['Set-Cookie'])
        with closing(sqlite3.connect(Path(self.tmp.name) / 'team.sqlite3')) as conn, conn:
            self.assertNotEqual(conn.execute("SELECT password_hash FROM team_users WHERE username='employee1'").fetchone()[0], 'Employee-test-2026')
            self.assertFalse(any(client.get_cookie(COOKIE_NAME).value == row[0] for row in conn.execute('SELECT token_hash FROM team_sessions')))

    def test_03_employees_cannot_manage_people_or_change_workspace(self):
        self.assertEqual(self.identity1['user']['role'], 'employee')
        self.assertEqual(len(self.identity1['workspaces']), 1)
        self.assertEqual(self.employee1.get('/api/team/users').status_code, 403)
        self.assertEqual(self.employee1.post('/api/team/users', headers=self.headers1, json={}).status_code, 403)
        self.assertEqual(self.employee1.patch('/api/team/users/' + self.identity2['user']['id'], headers=self.headers1, json={"active": 0}).status_code, 403)
        self.assertEqual(self.employee1.post('/api/team/workspace', headers=self.headers1, json={"user_id": self.identity2['user']['id']}).status_code, 403)

    def test_04_csrf_and_wrong_origin(self):
        self.assertEqual(self.admin.post('/api/team/users', json={}).status_code, 403)
        self.assertEqual(self.admin.post('/api/team/users', headers={"X-CSRF-Token": "wrong"}, json={}).status_code, 403)
        self.assertEqual(self.admin.post('/api/team/users', headers={**self.admin_headers, "Origin": "https://untrusted.example"}, json={}).status_code, 403)
        self.assertEqual(self.admin.get('/deleteAccount?id=1', headers={"Sec-Fetch-Site": "cross-site"}).status_code, 403)

    def test_05_bad_or_duplicate_user(self):
        for username, password in [('../outside', 'testpassword'), ('short', '123'), ('a', 'testpassword')]:
            self.assertEqual(self.admin.post('/api/team/users', headers=self.admin_headers, json={"username": username, "password": password, "display_name": "测试"}).status_code, 400)
        self.assertEqual(self.admin.post('/api/team/users', headers=self.admin_headers, json={"username": "employee1", "password": "testpassword", "display_name": "重复"}).status_code, 409)

    def test_06_repeated_failed_login_is_limited(self):
        client = self.app.test_client()
        for _ in range(10):
            self.assertEqual(client.post('/api/team/login', json={"username": "unknown-user", "password": "bad"}).status_code, 401)
        self.assertEqual(client.post('/api/team/login', json={"username": "unknown-user", "password": "bad"}).status_code, 429)

    def test_07_real_workspaces_isolate_drafts(self):
        created = self.employee1.post('/api/v2/drafts', headers=self.headers1, json={"draft_data": {"title": "仅员工一可见", "description": "隔离验证"}})
        self.assertEqual(created.status_code, 200, created.get_data(as_text=True))
        draft_id = created.json['data']['id']
        own = self.employee1.get('/api/v2/drafts').json['data']
        other = self.employee2.get('/api/v2/drafts').json['data']
        self.assertTrue(any(str(row['id']) == str(draft_id) for row in own))
        self.assertEqual(other, [])
        self.assertEqual(self.employee2.get(f'/api/v2/drafts/{draft_id}').status_code, 404)

    def test_08_real_workspaces_isolate_material_files(self):
        # 真实图片上传，检查列表、文件下载及同名编号都不会越过工作区。
        from PIL import Image
        stream = io.BytesIO()
        Image.new('RGB', (8, 8), '#b83240').save(stream, 'PNG')
        stream.seek(0)
        response = self.employee1.post('/api/materials/upload', headers=self.headers1, data={"file": (stream, 'isolation.png')}, content_type='multipart/form-data')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        own = self.employee1.get('/api/materials/list').json['data']['items']
        self.assertEqual(len(own), 1)
        self.assertEqual(self.employee2.get('/api/materials/list').json['data']['items'], [])
        file_path = own[0]['stored_path']
        self.assertEqual(self.employee1.get('/api/materials/file/' + file_path).status_code, 200)
        self.assertEqual(self.employee2.get('/api/materials/file/' + file_path).status_code, 404)
        # 上游删除接口用 JSON code 表达不存在；同时确认员工一的原素材未被删除。
        self.assertEqual(self.employee2.delete('/api/materials/' + own[0]['id'], headers=self.headers2).json['code'], 404)
        self.assertEqual(self.employee1.get('/api/materials/file/' + file_path).status_code, 200)
        self.assertEqual(self.employee1.get('/api/materials/file/db/database.db').status_code, 404)
        self.assertEqual(self.employee1.get('/api/materials/file/cookiesFile/private.json').status_code, 404)

    def test_09_worker_token_and_path_guard(self):
        guard_app = Flask(__name__)
        with patch.dict(os.environ, {"SAU_WORKER_TOKEN": "test-workspace-token"}):
            install_workspace_guard(guard_app, Path(self.tmp.name) / 'one')
        guard_app.add_url_rule('/inspect', view_func=lambda: jsonify(code=200), methods=['GET', 'POST'])
        client = guard_app.test_client()
        self.assertEqual(client.get('/inspect').status_code, 401)
        self.assertEqual(client.get('/inspect', headers={"X-Workspace-Token": "wrong"}).status_code, 401)
        headers = {"X-Workspace-Token": "test-workspace-token"}
        for path in ['../../two/private.json', '/etc/passwd', '%252e%252e/two', 'file:///etc/passwd', '..\\two\\private']:
            with self.subTest(path=path):
                self.assertEqual(client.post('/inspect', headers=headers, json={"nested": [{"path": path}]}).status_code, 403)
        self.assertEqual(client.post('/inspect', headers=headers, json={"path": 'materials/test.png'}).status_code, 200)

    def test_10_admin_accesses_employee_workspace_and_rejects_stale_writes(self):
        response = self.admin.post('/api/team/workspace', headers=self.admin_headers, json={"user_id": self.identity1['user']['id']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.admin.get('/api/v2/drafts').json['data']), 1)
        self.assertEqual(self.admin.post('/api/v2/drafts', headers=self.admin_headers, json={"draft_data": {"title": "旧标签页"}}).status_code, 409)
        self.assertEqual(self.admin.post('/api/team/workspace', headers=self.admin_headers, json={"user_id": self.admin_me['user']['id']}).status_code, 200)

    def test_11_server_browser_settings(self):
        settings = self.employee1.get('/api/v2/settings').json['data']
        # 兼容旧字段，但服务器不再返回或写入固定的全站并发数量。
        self.assertIsNone(settings['maxConcurrent'])
        self.assertEqual(str(settings['manualReview']).lower(), 'false')
        self.assertEqual(self.employee1.put('/api/v2/settings', headers=self.headers1, json={"manualReview": True}).status_code, 400)
        self.assertEqual(self.employee1.put('/api/v2/settings', headers=self.headers1, json={"maxConcurrent": 1}).status_code, 400)
        self.assertEqual(self.employee1.put('/api/v2/settings', headers=self.headers1, json={"maxConcurrent": 9}).status_code, 400)
        self.assertEqual(self.employee1.get('/api/feedback/list').status_code, 404)

    def test_11a_workers_and_avatar_proxy_cannot_bypass_gateway(self):
        import requests
        worker = self.app.extensions['workers'].workers[self.identity1['user']['id']]
        self.assertEqual(requests.get(worker['url'] + '/getAccounts', timeout=5).status_code, 401)
        self.assertEqual(self.employee1.get('/api/image-proxy?url=http://127.0.0.1:18870/api/team/me').status_code, 400)
        self.assertEqual(self.employee1.get('/api/image-proxy?url=https://untrusted.example/image.png').status_code, 400)

    def test_11b_expired_and_forged_sessions_are_rejected(self):
        client = self.app.test_client()
        client.set_cookie(COOKIE_NAME, 'forged-session')
        self.assertEqual(client.get('/api/team/me').status_code, 401)
        client.post('/api/team/login', json={"username": "test_admin", "password": "Admin-test-2026"})
        token_hash = digest(client.get_cookie(COOKIE_NAME).value)
        with closing(sqlite3.connect(Path(self.tmp.name) / 'team.sqlite3')) as conn, conn:
            conn.execute('UPDATE team_sessions SET expires_at=0 WHERE token_hash=?', (token_hash,))
        self.assertEqual(client.get('/api/team/me').status_code, 401)

    def test_11c_platform_login_controls_require_current_employee_and_csrf(self):
        route = '/api/platform-login/other-workspace-session/input'
        self.assertEqual(self.app.test_client().post(route, json={}).status_code, 401)
        self.assertEqual(self.employee1.post(route, json={}).status_code, 403)
        self.assertEqual(self.employee1.post(route, headers={**self.headers1, 'X-Workspace-ID': self.identity2['user']['id']}, json={}).status_code, 409)
        self.assertEqual(self.employee1.post(route, headers=self.headers1, json={}).status_code, 404)
        self.assertEqual(self.employee2.post(route, headers=self.headers2, json={}).status_code, 404)

    def test_12_reset_password_revokes_previous_sessions(self):
        employee_id = self.identity2['user']['id']
        response = self.admin.patch('/api/team/users/' + employee_id, headers=self.admin_headers, json={"password": "Employee-new-2026"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.employee2.get('/api/team/me').status_code, 401)
        client = self.app.test_client()
        self.assertEqual(client.post('/api/team/login', json={"username": "employee2", "password": "Employee-test-2026"}).status_code, 401)
        self.assertEqual(client.post('/api/team/login', json={"username": "employee2", "password": "Employee-new-2026"}).status_code, 200)

    def test_13_disable_employee_revokes_and_stops(self):
        response = self.admin.patch('/api/team/users/' + self.identity1['user']['id'], headers=self.admin_headers, json={"active": 0})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.employee1.get('/getAccounts').status_code, 401)
        self.assertNotIn(self.identity1['user']['id'], self.app.extensions['workers'].workers)

    def test_14_admin_cannot_be_disabled_by_employee_api(self):
        self.assertEqual(self.admin.patch('/api/team/users/' + self.admin_me['user']['id'], headers=self.admin_headers, json={"active": 0}).status_code, 400)
        serialized = json.dumps(self.admin.get('/api/team/users').json)
        self.assertNotIn('password_hash', serialized)

    def test_15_logout_removes_session(self):
        client = self.app.test_client()
        client.post('/api/team/login', json={"username": "test_admin", "password": "Admin-test-2026"})
        identity = client.get('/api/team/me').json['data']
        self.assertEqual(client.post('/api/team/logout', headers={"X-CSRF-Token": identity['csrf']}).status_code, 200)
        self.assertEqual(client.get('/api/team/me').status_code, 401)


if __name__ == '__main__':
    unittest.main(verbosity=2)
