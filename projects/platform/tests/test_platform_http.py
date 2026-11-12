"""真实回环HTTP及独立SQLite验证，全部使用合成商户。"""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import importlib
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from cryptography.fernet import Fernet
from werkzeug.serving import WSGIRequestHandler, make_server


class QuietHandler(WSGIRequestHandler):
    def log(self, log_type: str, message: str, *args: object) -> None:
        pass


class PlatformHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.directory = tempfile.TemporaryDirectory(prefix="taigua-http-")
        cls.password = secrets.token_urlsafe(20)
        cls.key = secrets.token_urlsafe(32)
        os.environ.update(TAIGUA_DATABASE_PATH=str(Path(cls.directory.name) / "data.db"),
                          TAIGUA_ENV="development", TAIGUA_SEED_DEMO="0", INTERNAL_API_KEY=cls.key,
                          TAIGUA_ADMIN_STAFF="ADM001", TAIGUA_ADMIN_PASSWORD=cls.password,
                          TAIGUA_CONFIG_KEY=Fernet.generate_key().decode())
        cls.module = importlib.import_module("app")
        cls.app = cls.module.create_app()
        cls.server = make_server("127.0.0.1", 0, cls.app, threaded=True, request_handler=QuietHandler)
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        status, result, _ = cls.call("/api/auth/login", {
            "phone": "ADM001", "password": cls.password, "scope": "admin",
        })
        assert status == 200, result
        cls.administrator = result["data"]["token"]
        _, products, _ = cls.call("/api/agents", token=cls.administrator)
        cls.products = {p["slug"]: p["id"] for p in products["data"] if p.get("slug")}

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.directory.cleanup()

    @classmethod
    def call(cls, path: str, payload: dict[str, object] | None = None, token: str = "",
             method: str | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict, object]:
        request_headers = {"Content-Type": "application/json"}
        if token:
            request_headers["Authorization"] = f"Bearer {token}"
        if path.startswith("/api/internal/"):
            request_headers["X-Internal-Key"] = cls.key
        request_headers.update(headers or {})
        query = Request(cls.url + path, headers=request_headers, method=method,
                        data=json.dumps(payload).encode() if payload is not None else None)
        try:
            response = build_opener(ProxyHandler({})).open(query, timeout=20)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response), response.headers

    def setUp(self) -> None:
        self.identifier = secrets.token_hex(10)
        self.mid, self.token = self.merchant(100)

    def merchant(self, points: int, grant: bool = True) -> tuple[int, str]:
        phone = "199" + str(secrets.randbelow(100_000_000)).zfill(8)
        status, result, _ = self.call("/api/admin/merchants", {
            "phone": phone, "password": self.password, "company": "合成HTTP测试", "token_balance": points,
        }, self.administrator)
        self.assertEqual(status, 200, result)
        mid = result["data"]["id"]
        if grant:
            for slug in ("ztgt", "ztwt"):
                status, result, _ = self.call("/api/admin/agent-grant", {
                    "merchant_id": mid, "agent_id": self.products[slug], "days": 365,
                }, self.administrator)
                self.assertEqual(status, 200, result)
        status, result, _ = self.call("/api/auth/login", {"phone": phone, "password": self.password})
        self.assertEqual(status, 200, result)
        return mid, result["data"]["token"]

    def charge(self, quantity: int = 1, suffix: str = "", mid: int | None = None) -> dict[str, object]:
        return {"mid": mid or self.mid, "agent_slug": "ztgt", "action": "lead_search",
                "quantity": quantity, "request_id": self.identifier + suffix}

    def data(self, path: str, payload: dict[str, object] | None = None, token: str = "", **kwargs) -> dict:
        status, result, _ = self.call(path, payload, token, **kwargs)
        self.assertEqual(status, 200, result)
        return result["data"]

    def ticket(self) -> str:
        result = self.data("/api/agents/enter", {"agent_slug": "ztgt"}, self.token)
        return parse_qs(urlsplit(result["url"]).query)["ticket"][0]

    def test_cookie_login_and_origin(self) -> None:
        status, result, _ = self.call("/api/auth/me", headers={"Cookie": f"tk_token={self.token}"})
        self.assertEqual((status, result["data"]["id"]), (200, self.mid))
        status, _, _ = self.call("/api/agents/enter", {"agent_slug": "ztgt"}, headers={
            "Cookie": f"tk_token={self.token}", "Origin": "https://untrusted.example",
        })
        self.assertEqual(status, 403)

    def test_single_use_ticket_wrong_product_and_logout(self) -> None:
        ticket = self.ticket()
        status, _, _ = self.call("/api/internal/sso/redeem", {"token": ticket, "agent_slug": "ztwt"})
        self.assertEqual(status, 401)
        child = self.data("/api/internal/sso/redeem", {"token": ticket, "agent_slug": "ztgt"})
        status, _, _ = self.call("/api/internal/sso/redeem", {"token": ticket, "agent_slug": "ztgt"})
        self.assertEqual(status, 401)
        self.data("/api/internal/sso/validate", {"token": child["session_token"], "agent_slug": "ztgt"})
        self.call("/api/auth/logout", {}, self.token)
        status, _, _ = self.call("/api/internal/sso/validate", {"token": child["session_token"], "agent_slug": "ztgt"})
        self.assertEqual(status, 401)

    def test_disabled_merchant_invalidates_child(self) -> None:
        child = self.data("/api/internal/sso/redeem", {"token": self.ticket(), "agent_slug": "ztgt"})
        self.call(f"/api/admin/merchants/{self.mid}/toggle", {}, self.administrator)
        status, _, _ = self.call("/api/internal/sso/validate", {"token": child["session_token"], "agent_slug": "ztgt"})
        self.assertEqual(status, 401)
        status, _, _ = self.call("/api/auth/me", token=self.token)
        self.assertEqual(status, 401)

    def test_unpurchased_product_denied(self) -> None:
        _, token = self.merchant(20, grant=False)
        status, _, _ = self.call("/api/agents/enter", {"agent_slug": "ztgt"}, token)
        self.assertEqual(status, 403)

    def test_concurrent_same_request_once(self) -> None:
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda _: self.call("/api/internal/points/consume", self.charge(7)), range(20)))
        self.assertEqual([r[0] for r in results], [200] * 20)
        balance = self.data("/api/internal/merchant/balance?mid=" + str(self.mid))
        self.assertEqual(balance["balance"], 93)
        records = self.data("/api/merchant/consumptions", token=self.token)
        self.assertEqual(records["total"], 1)

    def test_concurrent_distinct_requests_cannot_overspend(self) -> None:
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda i: self.call("/api/internal/points/consume", self.charge(10, str(i))), range(20)))
        self.assertEqual(sum(r[0] == 200 for r in results), 10)
        self.assertEqual(sum(r[0] == 402 for r in results), 10)
        self.assertEqual(self.data("/api/internal/merchant/balance?mid=" + str(self.mid))["balance"], 0)

    def test_idempotency_conflict(self) -> None:
        self.data("/api/internal/points/consume", self.charge(3))
        status, _, _ = self.call("/api/internal/points/consume", self.charge(4))
        self.assertEqual(status, 409)
        status, _, _ = self.call("/api/internal/points/reserve", self.charge(3))
        self.assertEqual(status, 409)

    def test_partial_settlement_and_replay(self) -> None:
        hold = self.data("/api/internal/points/reserve", self.charge(60))
        status, _, _ = self.call("/api/internal/points/consume", self.charge(41, "extra"))
        self.assertEqual(status, 402)
        result = self.data("/api/internal/points/settle", {"hold_id": hold["hold_id"], "actual_quantity": 20})
        self.assertEqual((result["charged"], result["refunded"], result["balance"]), (20, 40, 80))
        replay = self.data("/api/internal/points/settle", {"hold_id": hold["hold_id"], "actual_quantity": 20})
        self.assertEqual(replay, result)
        status, _, _ = self.call("/api/internal/points/settle", {"hold_id": hold["hold_id"], "actual_quantity": 21})
        self.assertEqual(status, 409)

    def test_cancel_release_and_replay(self) -> None:
        hold = self.data("/api/internal/points/reserve", self.charge(60))
        result = self.data("/api/internal/points/release", {"hold_id": hold["hold_id"], "reason": "取消"})
        self.assertEqual((result["released"], result["balance"]), (60, 100))
        replay = self.data("/api/internal/points/release", {"hold_id": hold["hold_id"], "reason": "重试"})
        self.assertEqual(replay, result)

    def test_expiry_releases_quota(self) -> None:
        core = self.app.extensions["taigua_core"]
        self.app.extensions["taigua_core"] = replace(core, hold_ttl=1)
        try:
            hold = self.data("/api/internal/points/reserve", self.charge(60))
            self.app.extensions["taigua_core"] = replace(core, clock=lambda: core.clock() + 5)
            balance = self.data("/api/internal/merchant/balance?mid=" + str(self.mid))
            self.assertEqual(balance["frozen"], 0)
            result = self.data("/api/internal/points/release", {"hold_id": hold["hold_id"]})
            self.assertEqual(result["status"], "expired")
        finally:
            self.app.extensions["taigua_core"] = core

    def test_tenant_consumptions_and_admin_permission(self) -> None:
        self.data("/api/internal/points/consume", self.charge(2))
        _, other = self.merchant(50)
        records = self.data("/api/merchant/consumptions?mid=" + str(self.mid), token=other)
        self.assertEqual(records["total"], 0)
        status, _, _ = self.call("/api/admin/integrations", token=other)
        self.assertEqual(status, 403)

    def test_daily_quota_includes_reserved(self) -> None:
        price = {"slug": "ztgt", "action": "lead_search", "points": 1, "daily_cap": 10}
        self.call("/api/admin/agent-prices", price, self.administrator, method="PUT")
        try:
            hold = self.data("/api/internal/points/reserve", self.charge(8))
            status, _, _ = self.call("/api/internal/points/consume", self.charge(3, "next"))
            self.assertEqual(status, 429)
            self.data("/api/internal/points/release", {"hold_id": hold["hold_id"]})
            self.data("/api/internal/points/consume", self.charge(3, "next"))
        finally:
            self.call("/api/admin/agent-prices", {**price, "daily_cap": 0}, self.administrator, method="PUT")

    def test_secrets_encrypted_masked_and_clearable(self) -> None:
        secret = secrets.token_hex(20)
        config = {"slug": "ztwt", "config": {"model": {"base_url": "http://127.0.0.1:19999/v1", "model": "local-test", "api_key": secret}}}
        result = self.data("/api/admin/integrations", config, self.administrator, method="PUT")
        self.assertEqual(result["model"]["api_key"], "")
        self.assertTrue(result["model"]["api_key_set"])
        self.assertEqual(self.data("/api/internal/config?slug=ztwt")["model"]["api_key"], secret)
        self.assertNotIn(secret.encode(), Path(self.module.DB_PATH).read_bytes())
        config["config"]["model"] = {"api_key": ""}
        self.data("/api/admin/integrations", config, self.administrator, method="PUT")
        self.assertEqual(self.data("/api/internal/config?slug=ztwt")["model"]["api_key"], secret)
        config["config"]["model"] = {"clear_api_key": True}
        self.data("/api/admin/integrations", config, self.administrator, method="PUT")
        self.assertEqual(self.data("/api/internal/config?slug=ztwt")["model"]["api_key"], "")

    def test_internal_key_and_quantity_validation(self) -> None:
        status, _, _ = self.call("/api/internal/points/consume", self.charge(), headers={"X-Internal-Key": "wrong"})
        self.assertEqual(status, 401)
        for quantity in (0, -1, True, 1.5):
            status, _, _ = self.call("/api/internal/points/consume", {**self.charge(), "quantity": quantity})
            self.assertEqual(status, 400)

    def test_migration_idempotent(self) -> None:
        self.module.create_app()
        self.assertEqual(self.data("/api/merchant/points", token=self.token)["balance"], 100)


if __name__ == "__main__":
    unittest.main()
