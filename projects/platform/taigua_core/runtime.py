from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
import os
import sqlite3
import time

from flask import current_app

from .errors import PlatformError


@dataclass(frozen=True)
class Core:
    database: Callable[[], sqlite3.Connection]
    internal_key: str
    clock: Callable[[], float] = time.time
    ticket_ttl: int = 60
    session_ttl: int = 604800
    hold_ttl: int = 1800

    @contextmanager
    def connection(self, write: bool = False) -> Iterator[sqlite3.Connection]:
        connection = self.database()
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            if write:
                connection.commit()
        except Exception:
            if write:
                connection.rollback()
            raise
        finally:
            connection.close()

    def now(self) -> int:
        return int(self.clock())


def get_core() -> Core:
    return current_app.extensions["taigua_core"]


def request_token() -> str:
    from flask import request

    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer ") and authorization[7:].strip():
        return authorization[7:].strip()
    return request.cookies.get("tk_token", "") or request.args.get("token", "")


def internal_key() -> str:
    value = os.environ.get("INTERNAL_API_KEY", "").strip()
    if len(value) < 24:
        raise PlatformError("CONFIGURATION_REQUIRED", "请配置平台内部访问密钥", 503)
    return value
