"""仅向开发主站创建合成商户，输出受忽略的本机联调资料。"""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import secrets
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from manage import ROOT, environment


@dataclass(frozen=True)
class Client:
    base_url: str
    token: str = ""

    def call(self, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(self.base_url + path, headers=headers,
                          data=json.dumps(payload).encode() if payload is not None else None)
        try:
            with build_opener(ProxyHandler({})).open(request, timeout=15) as response:
                result = json.load(response)
        except HTTPError as error:
            raise RuntimeError(f"开发初始化请求失败：{path} HTTP {error.code}") from error
        if not isinstance(result, dict) or result.get("code") != 0:
            raise RuntimeError(f"开发初始化响应异常：{path}")
        return result


def main() -> int:
    values = environment()
    if values.get("TAIGUA_ENV") != "development":
        raise RuntimeError("合成账号只允许在 development 模式创建")
    base_url = values.get("TAIGUA_PLATFORM_URL", "http://127.0.0.1:18000")
    if not base_url.startswith(("http://127.0.0.1:", "http://localhost:")):
        raise RuntimeError("开发初始化只允许连接本机主站")
    path = ROOT / "data" / "temporary" / "development-identities.json"
    if path.exists():
        print(f"本机合成身份已存在：{path}")
        return 0
    anonymous = Client(base_url)
    login = anonymous.call("/api/auth/login", {
        "phone": values["TAIGUA_ADMIN_STAFF"], "password": values["TAIGUA_ADMIN_PASSWORD"], "scope": "admin",
    })["data"]
    administrator = Client(base_url, login["token"])
    products = administrator.call("/api/agents")["data"]
    accounts = []
    for index in range(2):
        password = secrets.token_urlsafe(20)
        phone = "199" + str(secrets.randbelow(100_000_000)).zfill(8)
        merchant = administrator.call("/api/admin/merchants", {
            "phone": phone, "password": password, "company": f"合成验收企业{index + 1}",
            "contact": "合成联系人", "email": f"acceptance{index + 1}@example.invalid", "token_balance": 10000,
        })["data"]
        for product in products:
            if product.get("slug"):
                administrator.call("/api/admin/agent-grant", {
                    "merchant_id": merchant["id"], "agent_id": product["id"], "days": 365,
                })
        session = anonymous.call("/api/auth/login", {"phone": phone, "password": password})["data"]
        accounts.append({"mid": merchant["id"], "phone": phone, "password": password,
                         "company": merchant["company"], "token": session["token"]})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"base_url": base_url, "accounts": accounts}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已创建两个合成商户及产品授权。联调资料：{path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
