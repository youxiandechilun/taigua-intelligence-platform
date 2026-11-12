"""本地真实 HTTP 验证模型、计费与线索通知，不访问第三方账号。"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading

from flask import Flask
import pytest

from blueprints.overseas_bp import overseas_bp
from social_billing import SocialBilling
from taigua_platform import PlatformClient, PlatformError


@pytest.fixture()
def automation(tmp_path, monkeypatch):
    state = {"holds": [], "settles": [], "releases": [], "models": 0, "webhooks": 0,
             "model_enabled": True, "webhook_mode": "ok", "insufficient": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def send_json(self, data, status=200):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            assert self.headers["X-Internal-Key"] == "fixture-key"
            self.send_json({"ok": True, "data": {"model": {
                "enabled": state["model_enabled"], "base_url": address + "/v1",
                "api_key": "fixture-model-key", "model": "fixture-model", "timeout_seconds": 3,
            }, "notifications": {"webhook_url": address + "/webhook"}}})

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            if self.path == "/v1/chat/completions":
                assert self.headers["Authorization"] == "Bearer fixture-model-key"
                state["models"] += 1
                self.send_json({"choices": [{"message": {"content": "已根据资料生成的测试草稿"}}]})
            elif self.path == "/webhook":
                state["webhooks"] += 1
                assert self.headers["Idempotency-Key"]
                self.send_json({"ok": True, "receipt_id": "received-1"} if state["webhook_mode"] == "ok" else {"accepted": True})
            elif self.path.endswith("/reserve"):
                if state["insufficient"]:
                    self.send_json({"ok": False, "code": "INSUFFICIENT_POINTS", "msg": "余额不足"}, 402)
                    return
                state["holds"].append(payload)
                self.send_json({"ok": True, "data": {"hold_id": "hold-" + payload["request_id"], "held": payload["quantity"], "balance": 99}})
            elif self.path.endswith("/settle"):
                state["settles"].append(payload)
                self.send_json({"ok": True, "data": {"balance": 99}})
            elif self.path.endswith("/release"):
                state["releases"].append(payload)
                self.send_json({"ok": True, "data": {"balance": 100}})
            else:
                self.send_json({"ok": False}, 404)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    address = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("TAIGUA_PLATFORM_URL", address)
    monkeypatch.setenv("INTERNAL_API_KEY", "fixture-key")
    monkeypatch.setenv("TAIGUA_AGENT_SLUG", "ztgj")
    monkeypatch.setenv("SAU_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SAU_WORKSPACE_ID", "automation-test")
    app = Flask(__name__)
    app.register_blueprint(overseas_bp)
    yield app.test_client(), state, PlatformClient(address, "fixture-key")
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def test_content_generation_reuses_completed_result_and_settles_once(automation):
    client, state, _platform = automation
    identifier = client.post("/api/overseas/content/jobs", json={
        "topic": "包装设备产品介绍", "script": "仅使用已批准产品资料", "target_platforms": ["tiktok"],
    }).json["data"]["id"]
    response = client.post(f"/api/overseas/content/jobs/{identifier}/queue", headers={"X-Taigua-Merchant": "A"})
    assert response.status_code == 200
    assert response.json["data"]["source"] == "model"
    assert "测试草稿" in response.json["data"]["script"]
    assert client.post(f"/api/overseas/content/jobs/{identifier}/queue").status_code == 200
    assert state["models"] == len(state["holds"]) == len(state["settles"]) == 1
    state["model_enabled"] = False
    second = client.post("/api/overseas/content/jobs", json={"topic": "待补充资料", "target_platforms": ["tiktok"]}).json["data"]["id"]
    fallback = client.post(f"/api/overseas/content/jobs/{second}/queue")
    assert fallback.json["data"]["source"] == "rules"
    assert state["models"] == 1


def test_reply_requires_review_and_records_manual_contact(automation):
    client, state, _platform = automation
    identifier = client.post("/api/overseas/conversations", json={"platform_key": "instagram", "last_message": "请提供报价"}).json["data"]["id"]
    assert client.post(f"/api/overseas/conversations/{identifier}/reply/confirm", json={"receipt": "实际联系回执"}).status_code == 400
    generated = client.post(f"/api/overseas/conversations/{identifier}/reply/generate", headers={"X-Taigua-Merchant": "A"})
    assert generated.status_code == 200
    assert client.patch(f"/api/overseas/conversations/{identifier}", json={"reply_review_status": "approved"}).status_code == 200
    confirmed = client.post(f"/api/overseas/conversations/{identifier}/reply/confirm", json={"receipt": "已在平台联系，客户要求产品资料"})
    assert confirmed.json["data"]["delivery_status"] == "manual_sent"
    assert state["models"] == 1


def test_webhook_receipt_and_unknown_delivery_require_reconciliation(automation):
    client, state, _platform = automation
    first = client.post("/api/overseas/leads", json={"platform_key": "linkedin", "contact_name": "测试客户"}).json["data"]["id"]
    url = f"/api/overseas/leads/{first}/push"
    response = client.post(url, json={"phase": "send", "channel": "crm"})
    assert response.status_code == 200
    assert response.json["data"]["outreach_status"] == "sent"
    assert client.post(url, json={"phase": "send", "channel": "crm"}).status_code == 200
    assert state["webhooks"] == 1
    second = client.post("/api/overseas/leads", json={"platform_key": "linkedin", "contact_name": "待核对客户"}).json["data"]["id"]
    url = f"/api/overseas/leads/{second}/push"
    state["webhook_mode"] = "pending"
    assert client.post(url, json={"phase": "send"}).status_code == 409
    assert client.post(url, json={"phase": "prepare"}).status_code == 409
    assert client.post(url, json={"phase": "send"}).status_code == 409
    assert state["webhooks"] == 2
    response = client.post(url + "/confirm", json={"received": False, "receipt": "已人工核对接收方，没有该记录"})
    assert response.json["data"]["outreach_status"] == "prepared"


def test_publish_freeze_restart_partial_success_and_insufficient_balance(tmp_path, automation):
    _client, state, platform = automation
    billing = SocialBilling(tmp_path, platform)
    job = {"id": "publish-1", "workspace": "worker-A", "path": "/postVideo", "state": "running",
           "payload": {"__platform": {"mid": "A", "quantity": 2}}, "result": None}
    billing.prepare(job)
    restarted = SocialBilling(tmp_path, platform)
    restarted.prepare(job)
    assert len(state["holds"]) == 1
    job["state"] = "failed"
    job["result"] = {"data": {"success_count": 1}}
    restarted.finish(job)
    restarted.finish(job)
    assert len(state["settles"]) == 1
    assert state["settles"][0]["actual_quantity"] == 1
    state["insufficient"] = True
    job["id"] = "publish-2"
    with pytest.raises(PlatformError) as error:
        restarted.prepare(job)
    assert error.value.status == 402
