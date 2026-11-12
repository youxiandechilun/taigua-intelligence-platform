from dataclasses import asdict
import json
import os
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken

from ..catalog import PRODUCT_BY_SLUG
from ..errors import PlatformError
from ..runtime import Core
from . import mapper
from .models import Integrations

ConfigValue = str | bool | int
Section = dict[str, ConfigValue]
Configuration = dict[str, Section]
SECRET_FIELDS = frozenset(("api_key", "asr_api_key", "sip_password", "password", "bridge_token", "verify_token",
                          "app_secret", "corp_secret", "token", "encoding_aes_key", "aliyun_access_key_secret",
                          "aliyun_gateway_token", "aliyun_receipt_token"))


def cipher() -> Fernet:
    key = os.environ.get("TAIGUA_CONFIG_KEY", "")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeError) as error:
        raise PlatformError("CONFIGURATION_REQUIRED", "请配置服务密钥加密参数", 503) from error


def validate_slug(slug: str) -> None:
    if slug != "global" and slug not in PRODUCT_BY_SLUG:
        raise PlatformError("AGENT_NOT_FOUND", "产品不存在", 404)


def default_configuration() -> Configuration:
    return asdict(Integrations())


def validate_url(value: str, name: str) -> None:
    if not value:
        return
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise PlatformError("INVALID_CONFIGURATION", f"{name}需要有效的HTTP或HTTPS地址")


def parse_section(name: str, payload: object, previous: Section, keep_blank_secrets: bool = True) -> Section:
    if not isinstance(payload, dict):
        raise PlatformError("INVALID_CONFIGURATION", "服务配置格式错误")
    values = dict(previous)
    for key, value in payload.items():
        if key.startswith("clear_") and key[6:] in SECRET_FIELDS:
            if not isinstance(value, bool):
                raise PlatformError("INVALID_CONFIGURATION", "清除密钥选项格式错误")
            if value:
                values[key[6:]] = ""
            continue
        if key not in values:
            raise PlatformError("INVALID_CONFIGURATION", "包含不支持的配置字段")
        expected = previous[key]
        if isinstance(expected, bool):
            if not isinstance(value, bool):
                raise PlatformError("INVALID_CONFIGURATION", "启用选项需要布尔值")
        elif isinstance(expected, int):
            maximum = 65535 if key in ("port", "imap_port") else (1000 if key in ("concurrency", "calls_per_second") else 120)
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
                raise PlatformError("INVALID_CONFIGURATION", f"{key}需要1至{maximum}之间的整数")
        elif not isinstance(value, str) or len(value) > 8192:
            raise PlatformError("INVALID_CONFIGURATION", "服务配置文本格式错误")
        if keep_blank_secrets and key in SECRET_FIELDS and value in ("", "********"):
            continue
        values[key] = value.strip() if isinstance(value, str) else value
    for key in ("base_url", "asr_base_url", "bridge_url", "webhook_url"):
        value = values.get(key)
        if isinstance(value, str):
            validate_url(value, name)
    if name == "model" and values["enabled"] and (not values["base_url"] or not values["model"]):
        raise PlatformError("INVALID_CONFIGURATION", "启用大模型需要填写接口地址和模型名称")
    return values


def load(core: Core, slug: str, masked: bool = False) -> Configuration:
    validate_slug(slug)
    values = default_configuration()
    with core.connection() as connection:
        rows = mapper.configurations(connection, slug)
        legacy = mapper.legacy_model(connection)
    if legacy.get("ai_api_key"):
        values["model"].update({
            "enabled": legacy.get("ai_enabled") == "1",
            "base_url": legacy.get("ai_base_url", ""),
            "api_key": legacy["ai_api_key"],
            "model": legacy.get("ai_model", ""),
        })
    for row in rows:
        try:
            decoded: object = json.loads(cipher().decrypt(row["payload"].encode("ascii")))
        except (InvalidToken, ValueError, UnicodeError) as error:
            raise PlatformError("CONFIGURATION_UNREADABLE", "服务配置无法读取，请检查加密参数", 503) from error
        if row["section"] in values:
            values[row["section"]] = parse_section(row["section"], decoded, values[row["section"]], keep_blank_secrets=False)
    if masked:
        for section in values.values():
            for key in SECRET_FIELDS:
                if key in section:
                    configured = bool(section[key])
                    section[key] = ""
                    section[f"{key}_set"] = configured
    return values


def update(core: Core, slug: str, payload: object, admin_id: int, admin_name: str) -> Configuration:
    validate_slug(slug)
    if not isinstance(payload, dict) or not payload:
        raise PlatformError("INVALID_CONFIGURATION", "请提交需要保存的服务配置")
    previous = load(core, slug)
    changed: dict[str, Section] = {}
    for section, value in payload.items():
        if section not in previous:
            raise PlatformError("INVALID_CONFIGURATION", "包含不支持的服务类型")
        changed[section] = parse_section(section, value, previous[section])
    encryption = cipher()
    with core.connection(write=True) as connection:
        for section, value in changed.items():
            encrypted = encryption.encrypt(json.dumps(value, ensure_ascii=False).encode("utf-8")).decode("ascii")
            mapper.save(connection, slug, section, encrypted, core.now())
        mapper.audit(connection, admin_id, admin_name, "更新集中服务配置", slug, ",".join(sorted(changed)), core.now())
    return load(core, slug, masked=True)
