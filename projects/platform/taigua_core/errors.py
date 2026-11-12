from dataclasses import dataclass


@dataclass
class PlatformError(Exception):
    code: str
    message: str
    status: int = 400
    need: int | None = None
    balance: int | None = None

    def __str__(self) -> str:
        return self.message
