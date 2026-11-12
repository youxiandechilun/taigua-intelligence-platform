"""模型配置、内容草稿生成和按实际生成结果结算。"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

import requests

from taigua_platform import PlatformClient, PlatformError


@dataclass(frozen=True)
class GeneratedDraft:
    text: str
    source: str


class SocialAI:
    def __init__(self, client: PlatformClient | None = None):
        self.platform = client or PlatformClient.from_request()

    def generate(self, prompt: str, fallback: str, merchant: str, request_id: str) -> GeneratedDraft:
        if not self.platform.enabled:
            return GeneratedDraft(fallback, "rules")
        config = self.platform.model_config()
        if not config["enabled"] or not config["api_key"]:
            return GeneratedDraft(fallback, "rules")
        if not merchant or merchant == "legacy":
            raise PlatformError("当前任务缺少平台商户身份", 403, "MERCHANT_REQUIRED")
        if urlsplit(config["base_url"]).scheme not in {"http", "https"} or not config["model"]:
            raise PlatformError("请在主页完善模型地址和模型名称", 409, "MODEL_UNCONFIGURED")
        hold = self.platform.call("POST", "points/reserve", {
            "mid": merchant, "agent_slug": self.platform.slug, "action": "ai_generate",
            "quantity": 1, "request_id": request_id,
        })
        if not isinstance(hold, dict) or not isinstance(hold.get("hold_id"), str):
            raise PlatformError("平台冻结结果无效")
        hold_id = hold["hold_id"]
        try:
            response = requests.post(config["base_url"].rstrip("/") + "/chat/completions",
                headers={"Authorization": "Bearer " + config["api_key"]},
                json={"model": config["model"], "messages": [
                    {"role": "system", "content": "依据用户提供的资料生成可审核的社媒草稿。价格、资质、认证和效果仅引用已提供事实。"},
                    {"role": "user", "content": prompt}], "temperature": 0.4},
                timeout=(3, config["timeout_seconds"]), allow_redirects=False)
            response.raise_for_status()
            data = response.json()
            choices = data.get("choices") if isinstance(data, dict) else None
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise ValueError("模型没有返回草稿")
            message = choices[0].get("message")
            text = message.get("content") if isinstance(message, dict) else None
            if not isinstance(text, str) or not text.strip():
                raise ValueError("模型草稿为空")
            result = text.strip()[:20000]
        except (requests.RequestException, ValueError, TypeError) as exc:
            self.platform.call("POST", "points/release", {"hold_id": hold_id, "reason": "model_failed"})
            raise PlatformError("模型生成失败，请稍后重试", 502, "MODEL_FAILED") from exc
        finally:
            if "response" in locals():
                response.close()
        self.platform.call("POST", "points/settle", {"hold_id": hold_id, "actual_quantity": 1})
        return GeneratedDraft(result, "model")


def classify_intent(message: str) -> str:
    lowered = message.lower()
    if any(word in lowered for word in ("报价", "采购", "价格", "询价", "price", "quote", "buy", "brochure")):
        return "高意向"
    if any(word in lowered for word in ("了解", "咨询", "合作", "details", "interested", "information")):
        return "中意向"
    return "待判断"


def rules_reply(message: str) -> str:
    if classify_intent(message) == "高意向":
        return "您好，感谢您的咨询。请告知具体产品、数量和使用场景，我们会安排负责人提供资料并确认报价。"
    return "您好，感谢您的留言。方便补充一下您关注的产品、用途和希望了解的问题吗？"
