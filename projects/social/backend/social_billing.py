"""在发布实际执行前冻结点数，按持久执行结果结算。"""

from __future__ import annotations

from pathlib import Path
from typing import TypedDict

from hybrid_execution import ExecutionStore
from hybrid_workspace import PUBLISH_PATHS

from social_billing_mapper import ChargeMapper
from taigua_platform import PlatformClient, PlatformError


class ChargeMetadata(TypedDict, total=False):
    mid: str
    quantity: int
    slug: str


class ChargePayload(TypedDict, total=False):
    __platform: ChargeMetadata


class PublishResultData(TypedDict, total=False):
    success_count: int


class PublishResult(TypedDict, total=False):
    data: PublishResultData


class PublishJob(TypedDict):
    id: str
    workspace: str
    path: str
    state: str
    payload: ChargePayload
    result: PublishResult | None


class SocialBilling:
    def __init__(self, state: Path, platform: PlatformClient):
        self.platform = platform
        self.mapper = ChargeMapper(state / "billing.sqlite3")

    def prepare(self, job: PublishJob) -> None:
        if job["path"] not in PUBLISH_PATHS and job["path"] != "/api/internal/hybrid/run":
            return
        context = job["payload"].get("__platform")
        if not self.platform.enabled:
            return
        if not isinstance(context, dict) or not isinstance(context.get("mid"), str) or context.get("mid") == "legacy":
            raise PlatformError("请从平台重新创建该发布任务", 403, "MERCHANT_REQUIRED")
        quantity = context.get("quantity")
        if type(quantity) is not int or not 1 <= quantity <= 1000:
            raise PlatformError("发布计费数量无效", 400, "INVALID_QUANTITY")
        previous = self.mapper.get(job["id"])
        if previous and previous.hold_id:
            return
        self.mapper.remember(job["id"], job["workspace"], "", "pending")
        client = self.platform.for_slug(context.get("slug", self.platform.slug))
        try:
            response = client.call("POST", "points/reserve", {
                "mid": context["mid"], "agent_slug": client.slug, "action": "social_publish",
                "quantity": context["quantity"], "request_id": "social:publish:" + job["id"],
            })
        except PlatformError as exc:
            if 400 <= exc.status < 500:
                self.mapper.remember(job["id"], job["workspace"], "", "closed")
            raise
        if not isinstance(response, dict) or not isinstance(response.get("hold_id"), str):
            raise PlatformError("平台冻结单格式无效")
        self.mapper.remember(job["id"], job["workspace"], response["hold_id"], "reserved")

    def finish(self, job: PublishJob) -> None:
        previous = self.mapper.get(job["id"])
        if not previous or previous.state == "closed" or not previous.hold_id:
            return
        state = job["state"]
        if state not in {"success", "failed", "cancelled", "missed"}:
            return
        self.mapper.remember(job["id"], job["workspace"], previous.hold_id, "settlement_pending")
        reserved_quantity = job["payload"]["__platform"]["quantity"]
        result = job.get("result") or {}
        data = result.get("data") if isinstance(result, dict) else None
        quantity = reserved_quantity if state == "success" else 0
        if isinstance(data, dict) and type(data.get("success_count")) is int:
            quantity = max(0, min(reserved_quantity, data["success_count"]))
        if quantity:
            self.platform.call("POST", "points/settle", {"hold_id": previous.hold_id, "actual_quantity": quantity})
        else:
            self.platform.call("POST", "points/release", {"hold_id": previous.hold_id, "reason": "publish_" + state})
        self.mapper.remember(job["id"], job["workspace"], previous.hold_id, "closed")

    def reconcile(self, store: ExecutionStore) -> None:
        for record in self.mapper.pending():
            job = store.get(record.job_id, record.workspace)
            if job:
                if not record.hold_id:
                    self.prepare(job)
                self.finish(job)
