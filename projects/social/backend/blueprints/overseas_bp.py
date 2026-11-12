"""海外矩阵工作台 API。

本模块只负责海外版本地预览需要的工作台数据：平台能力、内容工厂任务、
互动记录、线索、客户和留资推送记录。真实平台操作仍由浏览器执行器完成，
因此这里不会伪造发布成功或替用户发送私信。
"""

from __future__ import annotations

import json
from contextlib import contextmanager
import hashlib
import os
import sqlite3
import time
import uuid

import requests
from urllib.parse import urlsplit
from pathlib import Path

from flask import Blueprint, jsonify, request

from conf import BASE_DIR
from impl.platform_meta import overseas_capabilities
from taigua_platform import PlatformClient, PlatformError
from social_ai_service import SocialAI, classify_intent, rules_reply
import social_content_mapper as content_mapper
from social_product import domestic_platforms, is_domestic


overseas_bp = Blueprint("overseas", __name__, url_prefix="/api/overseas")


# 互动与外发状态必须使用固定枚举，避免页面把“已入队”误显示成“已发送”。
REPLY_REVIEW_STATUSES = {"none", "draft", "pending_review", "approved", "rejected"}
OUTREACH_STATUSES = {"not_started", "prepared", "channel_unconfigured", "sent", "failed", "review"}


# 海外平台使用浏览器登录入口。状态字段只表示代码接入情况，不能替代真实账号
# 验收；内容类型能力由同一份元数据生成，避免前端把未实现能力显示成可用。
def _browser_video_status() -> dict:
    """返回海外平台共用的视频浏览器能力和真实验收提示。"""
    return {
        "content_types": ["video"],
        "capabilities": overseas_capabilities(),
        "status": "code_ready_unverified",
        "status_text": "浏览器适配代码已接入，尚未用真实账号验收",
    }


OVERSEAS_PLATFORMS = [
    {
        "key": "tiktok",
        "name": "TikTok",
        "initial": "T",
        "color": "#fe2c55",
        "creator_url": "https://www.tiktok.com/upload?lang=zh-Hans",
        **_browser_video_status(),
    },
    {
        "key": "youtube",
        "name": "YouTube",
        "initial": "Y",
        "color": "#ff0000",
        "creator_url": "https://studio.youtube.com/",
        **_browser_video_status(),
    },
    {
        "key": "instagram",
        "name": "Instagram",
        "initial": "I",
        "color": "#d946ef",
        "creator_url": "https://www.instagram.com/",
        **_browser_video_status(),
    },
    {
        "key": "facebook",
        "name": "Facebook",
        "initial": "F",
        "color": "#1877f2",
        "creator_url": "https://business.facebook.com/",
        **_browser_video_status(),
    },
    {
        "key": "x",
        "name": "X",
        "initial": "X",
        "color": "#111827",
        "creator_url": "https://x.com/",
        **_browser_video_status(),
    },
    {
        "key": "linkedin",
        "name": "LinkedIn",
        "initial": "in",
        "color": "#0a66c2",
        "creator_url": "https://www.linkedin.com/",
        **_browser_video_status(),
    },
    {
        "key": "threads",
        "name": "Threads",
        "initial": "@",
        "color": "#111827",
        "creator_url": "https://www.threads.com/",
        **_browser_video_status(),
    },
    {
        "key": "pinterest",
        "name": "Pinterest",
        "initial": "P",
        "color": "#e60023",
        "creator_url": "https://www.pinterest.com/",
        **_browser_video_status(),
    },
]


TABLE_SQL = """
CREATE TABLE IF NOT EXISTS overseas_content_jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    script TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'zh-CN',
    style TEXT NOT NULL DEFAULT '电销口播',
    target_platforms TEXT NOT NULL DEFAULT '[]',
    execution_mode TEXT NOT NULL DEFAULT 'browser',
    status TEXT NOT NULL DEFAULT 'draft',
    output_path TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overseas_content_workspace
    ON overseas_content_jobs(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS overseas_conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    platform_key TEXT NOT NULL,
    account_name TEXT NOT NULL DEFAULT '',
    external_name TEXT NOT NULL DEFAULT '',
    external_handle TEXT NOT NULL DEFAULT '',
    channel_type TEXT NOT NULL DEFAULT 'comment',
    last_message TEXT NOT NULL DEFAULT '',
    intent_level TEXT NOT NULL DEFAULT '待判断',
    status TEXT NOT NULL DEFAULT '待处理',
    assigned_to TEXT NOT NULL DEFAULT '',
    source_mode TEXT NOT NULL DEFAULT 'manual_record',
    source_external_id TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT NOT NULL DEFAULT '',
    reply_draft TEXT NOT NULL DEFAULT '',
    reply_review_status TEXT NOT NULL DEFAULT 'none',
    reply_delivery_status TEXT NOT NULL DEFAULT 'not_started',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overseas_conversation_workspace
    ON overseas_conversations(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS overseas_leads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual',
    platform_key TEXT NOT NULL DEFAULT '',
    account_name TEXT NOT NULL DEFAULT '',
    external_handle TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    contact_value TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    consent_status TEXT NOT NULL DEFAULT 'unknown',
    intent_level TEXT NOT NULL DEFAULT '待判断',
    stage TEXT NOT NULL DEFAULT '新线索',
    owner TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT NOT NULL DEFAULT '',
    outreach_status TEXT NOT NULL DEFAULT 'not_started',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overseas_lead_workspace
    ON overseas_leads(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS overseas_customers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    lead_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT '待跟进',
    owner TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'manual',
    dedupe_key TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overseas_customer_workspace
    ON overseas_customers(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS overseas_push_logs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    lead_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared',
    message TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overseas_push_workspace
    ON overseas_push_logs(workspace_id, created_at DESC);
"""


def _db_path() -> Path:
    """每个员工工作进程使用自己的数据目录，避免海外工作台串工作区。"""
    data_root = Path(os.environ.get("SAU_DATA_DIR", str(BASE_DIR)))
    return data_root / "db" / "database.db"


def _workspace_id() -> str:
    """工作区编号由服务端环境提供，直接运行本地版时使用 local。"""
    return os.environ.get("SAU_WORKSPACE_ID", "local")


@contextmanager
def _connect():
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=15)
    try:
        conn.row_factory = sqlite3.Row
        conn.executescript(TABLE_SQL)
        _ensure_status_columns(conn)
        with conn:
            yield conn
    finally:
        conn.close()


def _ensure_status_columns(conn: sqlite3.Connection) -> None:
    """为已经存在的本地数据库补齐互动、线索和客户状态列。

    海外工作台在上一版已经可能创建过旧表结构，不能要求员工删除数据库；
    这里采用幂等增量迁移，保证旧数据仍可读取且默认落在安全状态。
    """
    additions = {
        "overseas_conversations": {
            "source_mode": "TEXT NOT NULL DEFAULT 'manual_record'",
            "source_external_id": "TEXT NOT NULL DEFAULT ''",
            "dedupe_key": "TEXT NOT NULL DEFAULT ''",
            "reply_draft": "TEXT NOT NULL DEFAULT ''",
            "reply_review_status": "TEXT NOT NULL DEFAULT 'none'",
            "reply_delivery_status": "TEXT NOT NULL DEFAULT 'not_started'",
        },
        "overseas_leads": {
            "dedupe_key": "TEXT NOT NULL DEFAULT ''",
            "outreach_status": "TEXT NOT NULL DEFAULT 'not_started'",
        },
        "overseas_customers": {
            "source_type": "TEXT NOT NULL DEFAULT 'manual'",
            "dedupe_key": "TEXT NOT NULL DEFAULT ''",
        },
    }
    for table, columns in additions.items():
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for column, definition in columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_overseas_conversation_dedupe "
        "ON overseas_conversations(workspace_id, dedupe_key)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_overseas_lead_dedupe "
        "ON overseas_leads(workspace_id, dedupe_key)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_overseas_customer_dedupe "
        "ON overseas_customers(workspace_id, dedupe_key)"
    )
    conn.commit()


def _now() -> float:
    return time.time()


def _json_list(value):
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (TypeError, ValueError):
        return []


def _row(row):
    item = dict(row)
    if "target_platforms" in item:
        item["target_platforms"] = _json_list(item["target_platforms"])
    return item


def _payload():
    return request.get_json(silent=True) or {}


def _error(message, status=400):
    return jsonify(code=status, msg=message), status


def _normalise_text(value) -> str:
    """生成稳定去重输入：忽略首尾空格、大小写和连续空白。"""
    return " ".join(str(value or "").strip().lower().split())


def _digest_key(*parts: str) -> str:
    """对去重字段做不可逆摘要，避免把联系人原始信息写进索引或日志。"""
    raw = "|".join(_normalise_text(part) for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest() if raw.strip("|") else ""


def _conversation_dedupe_key(data: dict) -> str:
    """仅在有外部消息编号或账号标识时去重，避免同一联系人后续新消息被吞掉。"""
    external_id = data.get("source_external_id") or data.get("external_handle")
    if not external_id:
        return ""
    return _digest_key(
        data.get("platform_key", ""),
        data.get("account_name", ""),
        data.get("channel_type", "comment"),
        external_id,
        data.get("last_message", "") if not data.get("source_external_id") else "",
    )


def _lead_dedupe_key(data: dict) -> str:
    """优先使用平台账号，其次使用 WhatsApp/邮箱/电话做线索去重。"""
    identity = data.get("external_handle") or data.get("whatsapp") or data.get("contact_value")
    if not identity:
        return ""
    return _digest_key(data.get("platform_key", ""), identity)


def _customer_dedupe_key(data: dict) -> str:
    """客户去重以 WhatsApp、邮箱、电话或公司+姓名为基础。"""
    identity = data.get("whatsapp") or data.get("email") or data.get("phone")
    if not identity:
        identity = f"{data.get('company', '')}|{data.get('name', '')}"
    return _digest_key(identity)


@overseas_bp.get("/platforms")
def platforms():
    """返回海外平台能力矩阵，前端据此展示浏览器登录入口。"""
    return jsonify(code=200, data=domestic_platforms() if is_domestic() else OVERSEAS_PLATFORMS)


@overseas_bp.get("/content/jobs")
def content_jobs():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM overseas_content_jobs WHERE workspace_id=? ORDER BY updated_at DESC",
            (_workspace_id(),),
        ).fetchall()
    return jsonify(code=200, data=[_row(row) for row in rows])


@overseas_bp.post("/content/jobs")
def create_content_job():
    data = _payload()
    topic = str(data.get("topic", "")).strip()
    if not topic:
        return _error("请先填写内容主题")
    target_platforms = data.get("target_platforms") or []
    if not isinstance(target_platforms, list) or not target_platforms:
        return _error("至少选择一个发布平台")
    now = _now()
    job_id = uuid.uuid4().hex
    record = (
        job_id,
        _workspace_id(),
        str(data.get("title", "")).strip() or topic[:80],
        topic,
        str(data.get("script", "")).strip(),
        str(data.get("language", "zh-CN")),
        str(data.get("style", "电销口播")),
        json.dumps(target_platforms, ensure_ascii=False),
        "browser",
        "draft",
        "",
        now,
        now,
    )
    with _connect() as conn:
        conn.execute(
            """INSERT INTO overseas_content_jobs
            (id,workspace_id,title,topic,script,language,style,target_platforms,
             execution_mode,status,output_path,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            record,
        )
    return jsonify(code=200, data={"id": job_id}, msg="内容任务已保存为草稿")


@overseas_bp.errorhandler(PlatformError)
def platform_error(exc):
    return jsonify(code=exc.status, msg=exc.message, error=exc.code), exc.status


@overseas_bp.post("/content/jobs/<job_id>/queue")
def queue_content_job(job_id):
    with _connect() as conn:
        try:
            job = content_mapper.claim_content(conn, job_id, _workspace_id())
        except ValueError as exc:
            return _error(str(exc), 409)
    if job is None:
        return _error("内容任务不存在", 404)
    if job["status"] == "success":
        return jsonify(code=200, data={"id": job_id, "script": job["script"], "status": "success"}, msg="已返回生成结果")
    prompt = f"主题 {job['topic']}\n语言 {job['language']}\n风格 {job['style']}\n已有资料 {job['script']}\n请生成标题、正文及标签，保留需要人工补充的事实。"
    fallback = f"标题 {job['title']}\n主题 {job['topic']}\n正文 {job['script'] or '请补充产品特点、适用场景及联系信息后审核发布。'}\n标签 请根据目标平台审核填写"
    try:
        draft = SocialAI().generate(prompt, fallback, request.headers.get("X-Taigua-Merchant", ""), "social:content:" + job_id)
    except PlatformError:
        with _connect() as conn:
            content_mapper.complete_content(conn, job_id, _workspace_id(), job["script"], False)
        raise
    with _connect() as conn:
        content_mapper.complete_content(conn, job_id, _workspace_id(), draft.text, True)
    return jsonify(code=200, data={"id": job_id, "script": draft.text, "status": "success", "source": draft.source},
                   msg="内容草稿已生成，请审核后使用")


@overseas_bp.post("/conversations/<conversation_id>/reply/generate")
def generate_reply(conversation_id):
    with _connect() as conn:
        row = content_mapper.conversation(conn, conversation_id, _workspace_id())
    if row is None:
        return _error("互动记录不存在", 404)
    request_key = request.headers.get("X-Request-ID") or f"{conversation_id}:{row['updated_at']}"
    draft = SocialAI().generate("请根据以下客户留言生成简洁的回复草稿，说明待确认事项。\n" + row["last_message"],
                               rules_reply(row["last_message"]), request.headers.get("X-Taigua-Merchant", ""),
                               "social:reply:" + request_key)
    with _connect() as conn:
        content_mapper.save_reply(conn, conversation_id, _workspace_id(), draft.text, classify_intent(row["last_message"]))
    return jsonify(code=200, data={"id": conversation_id, "reply_draft": draft.text, "source": draft.source},
                   msg="回复草稿已保存，等待审核")


@overseas_bp.post("/conversations/<conversation_id>/reply/confirm")
def confirm_manual_reply(conversation_id):
    receipt = str(_payload().get("receipt") or "").strip()
    if not 2 <= len(receipt) <= 1000:
        return _error("请填写人工联系结果或消息回执")
    with _connect() as conn:
        row = content_mapper.conversation(conn, conversation_id, _workspace_id())
        if row is None:
            return _error("互动记录不存在", 404)
        if row["reply_review_status"] != "approved":
            return _error("请先审核回复草稿")
        content_mapper.confirm_reply(conn, conversation_id, _workspace_id(), receipt)
    return jsonify(code=200, data={"id": conversation_id, "delivery_status": "manual_sent"}, msg="人工联系结果已登记")


@overseas_bp.get("/conversations")
def conversations():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM overseas_conversations WHERE workspace_id=? ORDER BY updated_at DESC",
            (_workspace_id(),),
        ).fetchall()
    return jsonify(code=200, data=[_row(row) for row in rows])


@overseas_bp.post("/conversations")
def create_conversation():
    data = _payload()
    if not str(data.get("last_message", "")).strip():
        return _error("请填写原始评论或私信内容")
    now = _now()
    conversation_id = uuid.uuid4().hex
    dedupe_key = _conversation_dedupe_key(data)
    with _connect() as conn:
        if dedupe_key:
            duplicate = conn.execute(
                "SELECT id FROM overseas_conversations WHERE workspace_id=? AND dedupe_key=? LIMIT 1",
                (_workspace_id(), dedupe_key),
            ).fetchone()
            if duplicate:
                # 重复记录直接返回原记录，避免人工重复粘贴导致多次跟进。
                return jsonify(
                    code=200,
                    data={"id": duplicate["id"], "duplicate": True},
                    msg="已存在相同互动记录，未重复保存",
                )
        conn.execute(
            """INSERT INTO overseas_conversations
            (id,workspace_id,platform_key,account_name,external_name,external_handle,
             channel_type,last_message,intent_level,status,assigned_to,source_mode,
             source_external_id,dedupe_key,reply_draft,reply_review_status,
             reply_delivery_status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                conversation_id,
                _workspace_id(),
                str(data.get("platform_key", "instagram")),
                str(data.get("account_name", "")),
                str(data.get("external_name", "")),
                str(data.get("external_handle", "")),
                str(data.get("channel_type", "comment")),
                str(data.get("last_message", "")).strip(),
                str(data.get("intent_level", "待判断")),
                "待处理",
                "",
                str(data.get("source_mode", "manual_record")),
                str(data.get("source_external_id", "")).strip(),
                dedupe_key,
                "",
                "none",
                "not_started",
                now,
                now,
            ),
        )
    return jsonify(code=200, data={"id": conversation_id}, msg="互动记录已保存")


@overseas_bp.patch("/conversations/<conversation_id>")
def update_conversation(conversation_id):
    data = _payload()
    allowed = {"intent_level", "status", "assigned_to", "reply_draft", "reply_review_status"}
    updates = {key: str(data[key]).strip() for key in allowed if key in data}
    if not updates:
        return _error("没有可更新的字段")
    if "reply_review_status" in updates and updates["reply_review_status"] not in REPLY_REVIEW_STATUSES:
        return _error("回复审核状态无效")
    if "reply_draft" in updates:
        # 保存草稿只代表已写入工作区，不能变成已审核或已发送。
        updates.setdefault("reply_review_status", "draft" if updates["reply_draft"] else "none")
        updates["reply_delivery_status"] = "not_started"
    if updates.get("reply_review_status") == "approved":
        with _connect() as check_conn:
            existing = check_conn.execute(
                "SELECT reply_draft FROM overseas_conversations WHERE id=? AND workspace_id=?",
                (conversation_id, _workspace_id()),
            ).fetchone()
        has_draft = bool(existing and existing["reply_draft"])
        if not has_draft and not updates.get("reply_draft"):
            return _error("请先保存回复草稿")
        updates["reply_delivery_status"] = "prepared"
    updates["updated_at"] = _now()
    fields = ", ".join(f"{key}=?" for key in updates)
    values = list(updates.values()) + [conversation_id, _workspace_id()]
    with _connect() as conn:
        cursor = conn.execute(
            f"UPDATE overseas_conversations SET {fields} WHERE id=? AND workspace_id=?",
            values,
        )
        if cursor.rowcount != 1:
            return _error("互动记录不存在", 404)
    return jsonify(code=200, msg="互动记录已更新")


@overseas_bp.post("/conversations/<conversation_id>/reply/send")
def attempt_send_reply(conversation_id):
    """记录一次发送尝试，但在真实平台通道未接入前绝不伪造发送成功。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT reply_draft, reply_review_status FROM overseas_conversations "
            "WHERE id=? AND workspace_id=?",
            (conversation_id, _workspace_id()),
        ).fetchone()
        if not row:
            return _error("互动记录不存在", 404)
        if row["reply_review_status"] != "approved" or not row["reply_draft"].strip():
            return _error("回复尚未审核通过，不能准备发送")
        conn.execute(
            "UPDATE overseas_conversations SET reply_delivery_status='channel_unconfigured', "
            "updated_at=? WHERE id=? AND workspace_id=?",
            (_now(), conversation_id, _workspace_id()),
        )
    return jsonify(
        code=409,
        data={"id": conversation_id, "delivery_status": "channel_unconfigured"},
        msg="外部平台发送通道尚未配置，已保留待发送记录",
    ), 409


@overseas_bp.get("/leads")
def leads():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM overseas_leads WHERE workspace_id=? ORDER BY updated_at DESC",
            (_workspace_id(),),
        ).fetchall()
    return jsonify(code=200, data=[_row(row) for row in rows])


@overseas_bp.post("/leads")
def create_lead():
    data = _payload()
    if not str(data.get("contact_name", "")).strip() and not str(data.get("external_handle", "")).strip():
        return _error("请填写联系人或平台账号")
    now = _now()
    lead_id = uuid.uuid4().hex
    dedupe_key = _lead_dedupe_key(data)
    fields = (
        "source_type", "platform_key", "account_name", "external_handle", "contact_name",
        "company", "region", "contact_value", "whatsapp", "consent_status", "intent_level",
        "stage", "owner", "notes",
    )
    defaults = {
        "source_type": "manual",
        "consent_status": "unknown",
        "intent_level": "待判断",
        "stage": "新线索",
    }
    values = [str(data.get(field, defaults.get(field, "")) or defaults.get(field, "")).strip() for field in fields]
    placeholders = ",".join("?" for _ in range(2 + len(fields) + 4))
    with _connect() as conn:
        if dedupe_key:
            duplicate = conn.execute(
                "SELECT id FROM overseas_leads WHERE workspace_id=? AND dedupe_key=? LIMIT 1",
                (_workspace_id(), dedupe_key),
            ).fetchone()
            if duplicate:
                # 线索重复时返回已存在编号，页面可以直接打开原记录继续跟进。
                return jsonify(
                    code=200,
                    data={"id": duplicate["id"], "duplicate": True},
                    msg="已存在相同线索，未重复保存",
                )
        conn.execute(
            # 占位符必须与字段一一对应，不能把问号拼成带引号的字符串。
            f"INSERT INTO overseas_leads (id,workspace_id,{','.join(fields)},dedupe_key,outreach_status,created_at,updated_at) "
            f"VALUES ({placeholders})",
            [lead_id, _workspace_id(), *values, dedupe_key, "not_started", now, now],
        )
    return jsonify(code=200, data={"id": lead_id}, msg="线索已保存")


@overseas_bp.patch("/leads/<lead_id>")
def update_lead(lead_id):
    data = _payload()
    allowed = {
        "contact_name", "company", "region", "contact_value", "whatsapp", "consent_status",
        "intent_level", "stage", "owner", "notes", "outreach_status",
    }
    updates = {key: str(data[key]).strip() for key in allowed if key in data}
    if not updates:
        return _error("没有可更新的字段")
    if "outreach_status" in updates and updates["outreach_status"] not in OUTREACH_STATUSES:
        return _error("线索外发状态无效")
    # “已发送”只能由真实外部通道回写，当前接口禁止客户端伪造。
    if updates.get("outreach_status") == "sent":
        return _error("当前未接入真实外部通道，不能标记为已发送")
    updates["updated_at"] = _now()
    fields = ", ".join(f"{key}=?" for key in updates)
    values = list(updates.values()) + [lead_id, _workspace_id()]
    with _connect() as conn:
        cursor = conn.execute(f"UPDATE overseas_leads SET {fields} WHERE id=? AND workspace_id=?", values)
        if cursor.rowcount != 1:
            return _error("线索不存在", 404)
    return jsonify(code=200, msg="线索已更新")


@overseas_bp.post("/leads/<lead_id>/push")
def push_lead(lead_id):
    data = _payload()
    channel = str(data.get("channel", "crm"))
    phase = str(data.get("phase", "prepare"))
    if phase not in {"prepare", "send"} or channel not in {"crm", "whatsapp", "wechat", "email", "webhook"}:
        return _error("推送参数无效")
    with _connect() as conn:
        row = content_mapper.lead(conn, lead_id, _workspace_id())
    if row is None:
        return _error("线索不存在", 404)
    if row["outreach_status"] == "sent":
        return jsonify(code=200, data={"lead_id": lead_id, "outreach_status": "sent"}, msg="已推送，请查看推送记录")
    if phase == "prepare":
        if row["outreach_status"] == "review":
            return _error("请先核对上次推送结果并登记回执", 409)
        status, message, http_status = "prepared", "线索已准备推送", 200
    else:
        platform = PlatformClient.from_request()
        url = platform.notification_url() if platform.enabled else ""
        if not url:
            status, message, http_status = "channel_unconfigured", "请在主页配置线索推送Webhook", 409
        elif urlsplit(url).scheme not in {"https", "http"}:
            return _error("推送地址配置无效", 409)
        elif row["outreach_status"] == "review":
            return _error("上次推送结果待核对，请核对接收端记录后处理", 409)
        else:
            # 网络超时保留待核对状态，避免接收方已收到后自动重复发送。
            with _connect() as conn:
                if not content_mapper.claim_delivery(conn, lead_id, _workspace_id()):
                    return _error("线索已推送或正在等待回执，请刷新后核对", 409)
            try:
                response = requests.post(url, json={"event": "social.lead", "channel": channel,
                    "merchant_id": request.headers.get("X-Taigua-Merchant", ""), "lead": dict(row)},
                    headers={"Idempotency-Key": f"social:lead:{_workspace_id()}:{lead_id}"},
                    timeout=(3, 10), allow_redirects=False)
                try:
                    receipt = response.json()
                except ValueError:
                    receipt = {}
                if response.ok and isinstance(receipt, dict) and receipt.get("ok") is True:
                    status, message, http_status = "sent", "接收通道已确认收到线索", 200
                elif response.status_code >= 400:
                    status, message, http_status = "failed", "接收通道拒绝了推送，请检查配置", 502
                else:
                    status, message, http_status = "review", "通道未返回确认回执，请核对接收端记录", 409
                response.close()
            except requests.RequestException:
                status, message, http_status = "review", "推送连接中断，结果待核对", 503
    with _connect() as conn:
        content_mapper.delivery_status(conn, lead_id, _workspace_id(), status, message, channel, uuid.uuid4().hex)
    return jsonify(code=http_status, data={"lead_id": lead_id, "outreach_status": status}, msg=message), http_status


@overseas_bp.post("/leads/<lead_id>/push/confirm")
def confirm_push_result(lead_id):
    data = _payload()
    received = data.get("received")
    receipt = str(data.get("receipt") or "").strip()
    if type(received) is not bool or not 2 <= len(receipt) <= 1000:
        return _error("请明确接收结果并填写人工核对记录")
    with _connect() as conn:
        row = content_mapper.lead(conn, lead_id, _workspace_id())
        if row is None:
            return _error("线索不存在", 404)
        if row["outreach_status"] == "sent" and received:
            return jsonify(code=200, data={"outreach_status": "sent"}, msg="已登记接收结果")
        if row["outreach_status"] != "review":
            return _error("当前线索没有待核对的推送", 409)
        status = "sent" if received else "prepared"
        content_mapper.delivery_status(conn, lead_id, _workspace_id(), status, receipt, "manual_confirmation", uuid.uuid4().hex)
    return jsonify(code=200, data={"outreach_status": status}, msg="推送核对结果已登记")


@overseas_bp.get("/push-logs")
def push_logs():
    """返回当前员工的留资推送记录，方便在本地预览中核对是否留痕。"""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM overseas_push_logs WHERE workspace_id=? ORDER BY created_at DESC",
            (_workspace_id(),),
        ).fetchall()
    return jsonify(code=200, data=[_row(row) for row in rows])


@overseas_bp.get("/customers")
def customers():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM overseas_customers WHERE workspace_id=? ORDER BY updated_at DESC",
            (_workspace_id(),),
        ).fetchall()
    return jsonify(code=200, data=[_row(row) for row in rows])


@overseas_bp.post("/customers")
def create_customer():
    data = _payload()
    if not str(data.get("name", "")).strip():
        return _error("请填写客户名称")
    now = _now()
    customer_id = uuid.uuid4().hex
    dedupe_key = _customer_dedupe_key(data)
    fields = ("lead_id", "name", "company", "phone", "email", "whatsapp", "stage", "owner", "tags", "notes")
    defaults = {"stage": "待跟进"}
    values = [str(data.get(field, defaults.get(field, "")) or defaults.get(field, "")).strip() for field in fields]
    placeholders = ",".join("?" for _ in range(2 + len(fields) + 4))
    with _connect() as conn:
        if dedupe_key:
            duplicate = conn.execute(
                "SELECT id FROM overseas_customers WHERE workspace_id=? AND dedupe_key=? LIMIT 1",
                (_workspace_id(), dedupe_key),
            ).fetchone()
            if duplicate:
                # 同一联系方式只保留一份客户档案，避免线索重复转客户。
                return jsonify(
                    code=200,
                    data={"id": duplicate["id"], "duplicate": True},
                    msg="已存在相同客户，未重复保存",
                )
        conn.execute(
            # 客户字段同样使用参数绑定，避免动态 SQL 生成错误或写入注入内容。
            f"INSERT INTO overseas_customers (id,workspace_id,{','.join(fields)},source_type,dedupe_key,created_at,updated_at) "
            f"VALUES ({placeholders})",
            [customer_id, _workspace_id(), *values, str(data.get("source_type", "manual")), dedupe_key, now, now],
        )
    return jsonify(code=200, data={"id": customer_id}, msg="客户已保存")


@overseas_bp.patch("/customers/<customer_id>")
def update_customer(customer_id):
    data = _payload()
    allowed = {"name", "company", "phone", "email", "whatsapp", "stage", "owner", "tags", "notes"}
    updates = {key: str(data[key]).strip() for key in allowed if key in data}
    if not updates:
        return _error("没有可更新的字段")
    updates["updated_at"] = _now()
    fields = ", ".join(f"{key}=?" for key in updates)
    values = list(updates.values()) + [customer_id, _workspace_id()]
    with _connect() as conn:
        cursor = conn.execute(f"UPDATE overseas_customers SET {fields} WHERE id=? AND workspace_id=?", values)
        if cursor.rowcount != 1:
            return _error("客户不存在", 404)
    return jsonify(code=200, msg="客户已更新")
