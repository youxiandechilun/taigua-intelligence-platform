from dataclasses import dataclass
from hashlib import sha256
import json


@dataclass(frozen=True)
class Charge:
    merchant_id: int
    slug: str
    action: str
    quantity: int
    request_id: str
    note: str = ""

    def fingerprint(self, operation: str) -> str:
        value = (operation, self.merchant_id, self.slug, self.action, self.quantity, self.note)
        return sha256(json.dumps(value, ensure_ascii=False).encode("utf-8")).hexdigest()
