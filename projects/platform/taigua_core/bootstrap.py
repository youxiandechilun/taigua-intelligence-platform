from collections.abc import Callable
import importlib.util
import logging
import os
from pathlib import Path
import sqlite3
import uuid

from flask import Flask, jsonify, request

from .api.internal import blueprint as internal_api
from .api.public import blueprint as public_api
from .api.security import protect_cookie_write, response_headers
from .errors import PlatformError
from .identity import mapper
from .runtime import Core

ROOT = Path(__file__).resolve().parents[3]


def configure(app: Flask, database: Callable[[], sqlite3.Connection]) -> None:
    if "taigua_core" in app.extensions:
        return
    app.extensions["taigua_core"] = Core(database, os.environ.get("INTERNAL_API_KEY", ""))
    app.register_blueprint(internal_api)
    app.register_blueprint(public_api)
    app.register_error_handler(PlatformError, platform_error)
    app.before_request(protect_cookie_write)
    app.after_request(response_headers)
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024


def initialize(core: Core, password_hash: Callable[[str], str]) -> None:
    specification = importlib.util.spec_from_file_location("taigua_platform_migrations", ROOT / "database" / "platform_migrations.py")
    if specification is None or specification.loader is None:
        raise RuntimeError("数据库升级入口无法加载")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    module.migrate(core.database)
    with core.connection(write=True) as connection:
        mapper.provision_catalog(connection, core.now())
        staff = os.environ.get("TAIGUA_ADMIN_STAFF", "ADM001").strip().upper()
        password = os.environ.get("TAIGUA_ADMIN_PASSWORD", "")
        if password:
            if len(password) < 12:
                raise RuntimeError("初始管理员密码至少需要12个字符")
            mapper.provision_admin(connection, staff, password_hash(password), core.now())


def platform_error(error: PlatformError):
    trace = uuid.uuid4().hex
    if request.path.startswith("/api/internal/"):
        payload = {"ok": False, "code": error.code, "msg": error.message, "traceId": trace}
    else:
        payload = {"code": error.status, "error": error.code, "msg": error.message, "traceId": trace}
    if error.need is not None:
        payload["need"] = error.need
    if error.balance is not None:
        payload["balance"] = error.balance
    return jsonify(payload), error.status


def configure_logging(app: Flask) -> None:
    directory = ROOT / "logs"
    directory.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(directory / "platform.log", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)
