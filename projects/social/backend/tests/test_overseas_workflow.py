"""海外互动、线索和客户闭环的本地状态测试。

测试只验证数据库状态和外部通道边界，不启动浏览器，也不向第三方平台发送内容。
"""

import pytest
from flask import Flask

from blueprints.overseas_bp import overseas_bp


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """每个测试使用独立员工工作区，避免污染开发数据库。"""
    monkeypatch.setenv("SAU_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SAU_WORKSPACE_ID", "workflow-test")
    app = Flask(__name__)
    app.register_blueprint(overseas_bp)
    return app.test_client()


def test_conversation_draft_review_and_unconfigured_send(client):
    """互动记录应支持去重、草稿、审核和明确的通道未配置状态。"""
    payload = {
        "platform_key": "instagram",
        "account_name": "Taigua Global",
        "external_handle": "@alex",
        "last_message": "Please send a brochure",
    }
    created = client.post("/api/overseas/conversations", json=payload)
    assert created.status_code == 200
    conversation_id = created.get_json()["data"]["id"]

    duplicate = client.post("/api/overseas/conversations", json=payload)
    assert duplicate.status_code == 200
    assert duplicate.get_json()["data"]["duplicate"] is True

    draft = client.patch(
        f"/api/overseas/conversations/{conversation_id}",
        json={"reply_draft": "Thanks, I will send the details."},
    )
    assert draft.status_code == 200
    row = client.get("/api/overseas/conversations").get_json()["data"][0]
    assert row["reply_review_status"] == "draft"
    assert row["reply_delivery_status"] == "not_started"

    approved = client.patch(
        f"/api/overseas/conversations/{conversation_id}",
        json={"reply_review_status": "approved"},
    )
    assert approved.status_code == 200
    row = client.get("/api/overseas/conversations").get_json()["data"][0]
    assert row["reply_delivery_status"] == "prepared"

    send_attempt = client.post(f"/api/overseas/conversations/{conversation_id}/reply/send")
    assert send_attempt.status_code == 409
    assert send_attempt.get_json()["data"]["delivery_status"] == "channel_unconfigured"


def test_lead_push_and_customer_conversion_are_idempotent(client):
    """线索外发分阶段留痕，重复线索和重复客户都不应新增记录。"""
    payload = {
        "platform_key": "linkedin",
        "external_handle": "https://linkedin.example/alex",
        "contact_name": "Alex",
        "contact_value": "alex@example.com",
    }
    created = client.post("/api/overseas/leads", json=payload)
    assert created.status_code == 200
    lead_id = created.get_json()["data"]["id"]

    duplicate = client.post("/api/overseas/leads", json=payload)
    assert duplicate.status_code == 200
    assert duplicate.get_json()["data"]["duplicate"] is True

    prepared = client.post(f"/api/overseas/leads/{lead_id}/push", json={"channel": "crm"})
    assert prepared.status_code == 200
    assert prepared.get_json()["data"]["outreach_status"] == "prepared"

    blocked = client.post(
        f"/api/overseas/leads/{lead_id}/push",
        json={"channel": "crm", "phase": "send"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json()["data"]["outreach_status"] == "channel_unconfigured"

    customer_payload = {
        "lead_id": lead_id,
        "name": "Alex",
        "email": "alex@example.com",
        "source_type": "lead_conversion",
    }
    customer = client.post("/api/overseas/customers", json=customer_payload)
    assert customer.status_code == 200
    customer_duplicate = client.post("/api/overseas/customers", json=customer_payload)
    assert customer_duplicate.status_code == 200
    assert customer_duplicate.get_json()["data"]["duplicate"] is True

