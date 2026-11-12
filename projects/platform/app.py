# -*- coding: utf-8 -*-
"""
泰卦智能 · 商家服务平台 后端服务（商家端 + 管理后台）
启动方式：python app.py
访问地址：http://127.0.0.1:8000

目录约定：
  app.py        启动文件（本文件，最外层）
  html/         前端页面（商家端 + 管理后台）
  assets/       图片素材（logo.jpg 等）
  icons/        网页图标（favicon）
  data.db       SQLite 数据库（自动生成）
"""
import csv
import io
import json
import os
import random
import re
import sqlite3
import threading
import time
import traceback
import urllib.error
import urllib.request
import hashlib
import os
import uuid

from flask import Flask, Response, jsonify, request, send_from_directory

from taigua_core.bootstrap import configure, configure_logging, initialize as initialize_platform
from taigua_core.catalog import PRODUCTS
from taigua_core.identity import service as platform_identity
from taigua_core.identity import management as identity_management
from taigua_core.billing import service as platform_billing
from taigua_core.runtime import get_core, request_token
from taigua_core.api.validation import integer, text

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("TAIGUA_DATABASE_PATH", os.path.join(BASE_DIR, "data.db"))

app = Flask(__name__, static_folder=None)


# ----------------------------------------------------------------------
# 数据库
# ----------------------------------------------------------------------
def get_db():
    # timeout 不要太大：并发写冲突时快速失败(由前端重试)，避免请求堆积把连接池占满
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def ensure_column(conn, table, column, ddl):
    """为已有数据库补齐新增字段（幂等）"""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(%s)" % table).fetchall()]
    if column not in cols:
        conn.execute("ALTER TABLE %s ADD COLUMN %s" % (table, ddl))


def init_db():
    conn = get_db()
    try:
        # WAL：读写不互斥，轮询期间读写并发不会互相卡住
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    except sqlite3.DatabaseError:
        pass
    c = conn.cursor()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS merchants(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            company TEXT DEFAULT '',
            contact TEXT DEFAULT '',
            email TEXT DEFAULT '',
            industry TEXT DEFAULT '',
            scale TEXT DEFAULT '',
            province TEXT DEFAULT '',
            city TEXT DEFAULT '',
            website TEXT DEFAULT '',
            intro TEXT DEFAULT '',
            logo TEXT DEFAULT '/assets/logo.jpg',
            role TEXT DEFAULT 'merchant',
            status TEXT DEFAULT '已认证',
            token_balance INTEGER DEFAULT 0,
            invite_code TEXT UNIQUE,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions(
            token TEXT PRIMARY KEY,
            merchant_id INTEGER NOT NULL,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tags(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sort INTEGER DEFAULT 0,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS agents(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            region TEXT DEFAULT '国内',
            description TEXT DEFAULT '',
            status TEXT DEFAULT 'running',
            link TEXT DEFAULT '',
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS transactions(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            points INTEGER DEFAULT 0,
            amount REAL DEFAULT 0,
            note TEXT DEFAULT '',
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tickets(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            category TEXT DEFAULT '其他',
            content TEXT DEFAULT '',
            status TEXT DEFAULT '处理中',
            reply TEXT DEFAULT '',
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS announcements(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT DEFAULT '',
            level TEXT DEFAULT '普通',
            status TEXT DEFAULT 'draft',
            published_at TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS settings(
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS logs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER,
            admin_name TEXT,
            action TEXT,
            target TEXT,
            detail TEXT,
            ip TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS redeem_codes(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            points INTEGER NOT NULL,
            price REAL DEFAULT 0,
            batch TEXT DEFAULT '',
            status TEXT DEFAULT 'unused',
            merchant_id INTEGER,
            used_at TEXT DEFAULT '',
            expire_at TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_by TEXT DEFAULT '',
            created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_redeem_code ON redeem_codes(code);
        CREATE INDEX IF NOT EXISTS idx_redeem_status ON redeem_codes(status);
        CREATE INDEX IF NOT EXISTS idx_redeem_batch ON redeem_codes(batch);
        CREATE INDEX IF NOT EXISTS idx_merchants_phone ON merchants(phone);
        CREATE INDEX IF NOT EXISTS idx_agents_tag ON agents(tag_id);
        CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_merchant ON tickets(merchant_id);
        """
    )
    # ---- 老库补字段 ----
    ensure_column(conn, "merchants", "disabled", "disabled INTEGER DEFAULT 0")
    ensure_column(conn, "merchants", "last_login", "last_login TEXT DEFAULT ''")
    ensure_column(conn, "merchants", "remark", "remark TEXT DEFAULT ''")
    ensure_column(conn, "merchants", "staff_no", "staff_no TEXT DEFAULT ''")
    ensure_column(conn, "tickets", "priority", "priority TEXT DEFAULT '普通'")
    ensure_column(conn, "tickets", "replied_at", "replied_at TEXT DEFAULT ''")
    ensure_column(conn, "tickets", "replied_by", "replied_by TEXT DEFAULT ''")
    ensure_column(conn, "tickets", "handler", "handler TEXT DEFAULT ''")
    ensure_column(conn, "merchants", "apply_remark", "apply_remark TEXT DEFAULT ''")
    ensure_column(conn, "merchants", "invited_by", "invited_by TEXT DEFAULT ''")
    ensure_column(conn, "agents", "updated_at", "updated_at TEXT DEFAULT ''")
    ensure_column(conn, "agents", "price", "price INTEGER DEFAULT 0")
    ensure_column(conn, "agents", "duration_days", "duration_days INTEGER DEFAULT 365")
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS agent_orders(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT UNIQUE NOT NULL,
            merchant_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            channel TEXT DEFAULT 'points',
            amount INTEGER DEFAULT 0,
            duration_days INTEGER DEFAULT 0,
            status TEXT DEFAULT 'paid',
            paid_at TEXT DEFAULT '',
            created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_orders_m ON agent_orders(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_agent_orders_a ON agent_orders(agent_id);
        CREATE TABLE IF NOT EXISTS agent_purchases(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            expire_at TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(merchant_id, agent_id)
        );
        CREATE TABLE IF NOT EXISTS pay_orders(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT UNIQUE NOT NULL,
            merchant_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            agent_id INTEGER DEFAULT 0,
            points INTEGER DEFAULT 0,
            amount REAL DEFAULT 0,
            duration_days INTEGER DEFAULT 0,
            channel TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            channel_trade_no TEXT DEFAULT '',
            paid_at TEXT DEFAULT '',
            created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pay_orders_m ON pay_orders(merchant_id);
        """
    )

    # ---- 管理员工号补齐（ADM001 起，按 id 顺序，幂等）----
    _conn2 = conn
    rows = _conn2.execute(
        "SELECT id FROM merchants WHERE role='admin' AND (staff_no='' OR staff_no IS NULL) ORDER BY id"
    ).fetchall()
    if rows:
        used = {r[0] for r in _conn2.execute(
            "SELECT staff_no FROM merchants WHERE role='admin' AND staff_no<>''").fetchall()}
        nxt = 1
        for r in rows:
            while ("ADM%03d" % nxt) in used:
                nxt += 1
            _conn2.execute("UPDATE merchants SET staff_no=? WHERE id=?",
                           ("ADM%03d" % nxt, r[0]))
            used.add("ADM%03d" % nxt)

    # ---- 种子数据 ----
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    if os.environ.get("TAIGUA_SEED_DEMO") == "1" and c.execute("SELECT COUNT(*) FROM merchants").fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO merchants(phone,password,company,contact,email,industry,scale,"
            "province,city,website,intro,role,status,token_balance,invite_code,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                ("13800000000", pw_hash("admin123"), "平台管理员", "平台管理员",
                 "admin@taikua.cn", "互联网", "200+", "广东省", "东莞市", "https://www.taikua.cn",
                 "泰卦智能平台管理账号", "admin", "已认证", 0, "TGADMIN", now),
                ("13800008888", pw_hash("123456"), "东莞市恒顺智能科技", "张先生",
                 "zhang@hengshun.com", "智能科技", "50-199", "广东省", "东莞市",
                 "https://www.hengshun.com", "专注智能硬件与销售自动化解决方案。", "merchant",
                 "已认证", 12000, "TG8K2M", now),
                ("13700001111", "123456", "深圳云启贸易", "李女士",
                 "li@yunqi.com", "跨境电商", "20-49", "广东省", "深圳市",
                 "", "主营跨境电商，需要海外社媒与邮件获客。", "merchant",
                 "待审核", 0, "TG9A1C", "2026-10-27 11:20:00"),
            ],
        )
    if c.execute("SELECT COUNT(*) FROM tags").fetchone()[0] == 0:
        for i, name in enumerate(["电话营销", "社媒矩阵", "拓客转私域"]):
            c.execute("INSERT INTO tags(name,sort,created_at) VALUES(?,?,?)", (name, i, now))
        for tag, ags in {
            "电话营销": [
                ("电话营销·国内", "国内", "合规外呼与真人式对话，自动识别客户意向并分级，同步 CRM 跟进。"),
                ("电话营销·海外", "海外", "多语种外呼与时区调度，适配本地号码资源与合规规则。"),
            ],
            "社媒矩阵": [
                ("社媒矩阵·国内", "国内", "覆盖主流内容平台，批量生产与发布，评论区自动互动沉淀线索。"),
                ("社媒矩阵·海外", "海外", "多平台多地区内容分发，多语言本地化输出，统一数据看板复盘。"),
            ],
            "拓客转私域": [
                ("拓客转私域·国内", "国内", "多渠道线索自动接入企微/微信私域，分层 SOP 与转化跟进自动化。"),
                ("拓客转私域·海外", "海外", "广告、邮件与社媒协同获客，沉淀到 CRM 与邮件列表持续培育。"),
            ],
        }.items():
            tag_id = c.execute("SELECT id FROM tags WHERE name=?", (tag,)).fetchone()[0]
            for name, region, desc in ags:
                identifier = next(product.identifier for product in PRODUCTS if product.category == tag and product.region == region)
                c.execute(
                    "INSERT INTO agents(id,tag_id,name,region,description,status,created_at) VALUES(?,?,?,?,?,?,?)",
                    (identifier, tag_id, name, region, desc, "running", now),
                )
    if os.environ.get("TAIGUA_SEED_DEMO") == "1" and c.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0:
        # 演示流水：找不到种子商家就跳过（真实部署库里可能没有 13800008888）
        _row = c.execute("SELECT id FROM merchants WHERE phone='13800008888'").fetchone()
        if _row:
            mid = _row[0]
            c.executemany(
                "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) "
                "VALUES(?,?,?,?,?,?)",
                [
                    (mid, "recharge", 10000, 100, "微信支付充值 ￥100", "2026-10-20 10:22:00"),
                    (mid, "recharge", 2000, 30, "卡密兑换 ￥30", "2026-10-25 14:05:00"),
                    (mid, "consume", -500, 0, "电话营销·国内 消耗", "2026-10-28 09:30:00"),
                ],
            )
    if os.environ.get("TAIGUA_SEED_DEMO") == "1" and c.execute("SELECT COUNT(*) FROM tickets").fetchone()[0] == 0:
        rows = c.execute("SELECT id FROM merchants WHERE role='merchant'").fetchall()
        if len(rows) >= 2:
            c.executemany(
                "INSERT INTO tickets(merchant_id,title,category,content,status,priority,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                [
                    (rows[0][0], "海外外呼号码资源如何配置？", "产品咨询",
                     "我们计划开通海外电话营销，请问号码资源是平台提供还是自备？", "处理中", "普通",
                     "2026-10-29 15:12:00"),
                    (rows[1][0], "账号一直显示待审核", "账号问题",
                     "提交资料两天了，状态还是待审核，麻烦帮忙看下。", "处理中", "高",
                     "2026-10-30 09:40:00"),
                ],
            )
    # ---- 演示数据补齐（老库同样补齐，便于后台看效果） ----
    if not c.execute("SELECT 1 FROM merchants WHERE phone='13700001111'").fetchone():
        c.execute(
            "INSERT INTO merchants(phone,password,company,contact,email,industry,scale,province,city,"
            "status,token_balance,invite_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("13700001111", pw_hash("123456"), "深圳云启贸易", "李女士", "li@yunqi.com", "跨境电商", "20-49",
             "广东省", "深圳市", "待审核", 0, "TG9A1C", "2026-10-27 11:20:00"),
        )
    if os.environ.get("TAIGUA_SEED_DEMO") == "1" and c.execute("SELECT COUNT(*) FROM tickets").fetchone()[0] == 0:
        mids = [r[0] for r in c.execute(
            "SELECT id FROM merchants WHERE role='merchant' ORDER BY id").fetchall()]
        if mids:
            c.execute(
                "INSERT INTO tickets(merchant_id,title,category,content,status,priority,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (mids[0], "海外外呼号码资源如何配置？", "产品咨询",
                 "我们计划开通海外电话营销，请问号码资源是平台提供还是自备？", "处理中", "普通",
                 "2026-10-29 15:12:00"),
            )
        if len(mids) > 1:
            c.execute(
                "INSERT INTO tickets(merchant_id,title,category,content,status,priority,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (mids[1], "账号一直显示待审核", "账号问题",
                 "提交资料两天了，状态还是待审核，麻烦帮忙看下。", "处理中", "高",
                 "2026-10-30 09:40:00"),
            )
    if os.environ.get("TAIGUA_SEED_DEMO") == "1" and c.execute("SELECT COUNT(*) FROM announcements").fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO announcements(title,content,level,status,published_at,created_at) "
            "VALUES(?,?,?,?,?,?)",
            [
                ("平台 V1.2 上线：海外外呼新增 6 个语种",
                 "本次更新新增英语、日语、韩语、西班牙语、德语、法语外呼能力，并优化时区调度策略。",
                 "重要", "published", now, now),
                ("关于充值通道升级的通知",
                 "在线充值通道正在升级，期间如需充值请联系客户经理 18925568615 人工处理。",
                 "普通", "published", now, now),
            ],
        )
    # ---------------- 在线客服：客服账号 / 会话 / 消息 / 知识库 ----------------
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS cs_agents(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            no TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            role TEXT DEFAULT 'agent',
            status TEXT DEFAULT 'offline',
            disabled INTEGER DEFAULT 0,
            created_at TEXT,
            last_active TEXT
        );
        CREATE TABLE IF NOT EXISTS cs_agent_tokens(
            token TEXT PRIMARY KEY,
            agent_id INTEGER NOT NULL,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS cs_sessions(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            agent_id INTEGER,
            status TEXT DEFAULT 'ai',
            mode TEXT DEFAULT 'ai',
            subject TEXT DEFAULT '',
            last_msg TEXT DEFAULT '',
            last_msg_at TEXT,
            unread_user INTEGER DEFAULT 0,
            unread_agent INTEGER DEFAULT 0,
            rating INTEGER DEFAULT 0,
            remark TEXT DEFAULT '',
            created_at TEXT,
            claimed_at TEXT,
            closed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS cs_messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            agent_id INTEGER,
            content TEXT DEFAULT '',
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS kb_entries(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT DEFAULT '通用',
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            keywords TEXT DEFAULT '',
            status INTEGER DEFAULT 1,
            hits INTEGER DEFAULT 0,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cs_msg_session ON cs_messages(session_id, id);
        CREATE INDEX IF NOT EXISTS idx_cs_sess_status ON cs_sessions(status, id);
        """
    )

    # 客服演示账号（工号 + 密码登录）
    if os.environ.get("TAIGUA_SEED_DEMO") == "1" and c.execute("SELECT COUNT(*) FROM cs_agents").fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO cs_agents(no,password,name,phone,email,role,status,created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            [
                ("CS001", pw_hash("cs123456"), "李晓萌", "18925560001", "li.xm@taikua.cn", "supervisor", "offline", now_str()),
                ("CS002", pw_hash("cs123456"), "王思远", "18925560002", "wang.sy@taikua.cn", "agent", "offline", now_str()),
            ],
        )

    # AI 客服默认配置与知识库种子
    ai_defaults = [
        ("ai_enabled", "1"),
        ("ai_base_url", "https://api.deepseek.com/v1"),
        ("ai_api_key", ""),
        ("ai_model", "deepseek-chat"),
        ("ai_temperature", "0.3"),
        ("ai_system_prompt",
         "你是「泰卦智能」的在线客服助手，服务对象是已开通平台账号的商家。"
         "回答要简洁、专业、口语化，中文作答，单次不超过 150 字。"
         "优先依据【知识库参考】作答；知识库没有覆盖的问题，坦诚说明并引导用户点击「转人工」。"
         "不要编造价格、政策、时间承诺。"),
        ("kb_enabled", "1"),
        ("kb_topk", "3"),
        ("cs_welcome", "您好，我是泰卦智能 AI 客服，可以帮您解答充值、智能体配置、发票等问题。需要人工服务请点击右上角「转人工」。"),
        ("cs_offline", "人工客服当前不在线（工作日 09:00–18:30），已收到您的留言，上线后会第一时间回复。"),
    ]
    for k, v in ai_defaults:
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))

    if os.environ.get("TAIGUA_SEED_DEMO") == "1" and c.execute("SELECT COUNT(*) FROM kb_entries").fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO kb_entries(category,question,answer,keywords,status,hits,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            [
                ("充值", "TOKEN 点数怎么充值？",
                 "路径：商家中心 → TOKEN 充值。支持微信、支付宝、卡密兑换三种方式。当前版本在线支付通道升级中，如需立即充值可联系客户经理 18925568615 人工处理。",
                 "充值,点数,TOKEN,买点数,加点数", 1, 0, now_str(), now_str()),
                ("充值", "怎么查账户余额？",
                 "登录后在「商家信息」页顶部可看到账户余额；也可以直接问我，我会帮您查询当前点数余额。",
                 "余额,查询余额,剩余点数,还有多少", 1, 0, now_str(), now_str()),
                ("充值", "发票怎么开？",
                 "在客服中心提交工单，分类选择「发票申请」，附上充值订单号与开票信息，1–3 个工作日内开具电子发票。",
                 "发票,开票,报销,专票,普票", 1, 0, now_str(), now_str()),
                ("智能体", "如何配置智能体？",
                 "路径：商家中心 → 智能体管理。按分类展开二级列表，点击「跳转」进入智能体详情，可查看状态、开关启用，并在弹窗内直接对话测试。",
                 "智能体,配置,设置,启用,停用,跳转", 1, 0, now_str(), now_str()),
                ("智能体", "智能体停用后会影响什么？",
                 "停用后该智能体不再执行任务，历史数据保留。重新打开开关即可恢复，不会重复计费。",
                 "停用,关闭,影响,恢复", 1, 0, now_str(), now_str()),
                ("账号", "账号一直显示待审核怎么办？",
                 "平台默认人工审核，通常 1 个工作日内完成。超过 1 个工作日仍未通过，请提交工单或联系客户经理催审。",
                 "审核,待审核,没通过,开通,认证", 1, 0, now_str(), now_str()),
                ("账号", "忘记密码怎么找回？",
                 "在登录页点击「忘记密码」可直接联系客户经理 18925568615 重置；已登录用户也可在「商家信息 → 修改密码」自助修改。",
                 "密码,忘记密码,找回,重置", 1, 0, now_str(), now_str()),
                ("产品", "泰卦智能主要能做什么？",
                 "泰卦智能是销售智能体平台，以 Asalegent 平台与泰卦智能硬件为核心，提供电话营销、客户跟进、触达与复盘等能力的软硬一体方案，让销售工作流更智能、更高效。",
                 "产品,能做什么,介绍,功能,方案", 1, 0, now_str(), now_str()),
                ("技术", "HTTP 接口调用返回 401 是什么原因？",
                 "401 表示未登录或登录已过期。请检查请求头是否带上 Bearer Token，或重新登录获取新 token 后重试。",
                 "401,未登录,token,过期,接口报错", 1, 0, now_str(), now_str()),
                ("技术", "接口 403 提示需要管理员权限？",
                 "403 表示当前账号权限不足。智能体新增/编辑/删除、分类管理、商家审核等操作仅管理员可执行；商家账号只能启用/停用自己的智能体。",
                 "403,权限,管理员,没权限,越权", 1, 0, now_str(), now_str()),
            ],
        )

    if c.execute("SELECT COUNT(*) FROM settings").fetchone()[0] == 0:
        c.executemany(
            "INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
            [
                ("platform_name", "泰卦智能"),
                ("slogan", "让销售工作流更智能、更高效"),
                ("service_phone", "18925568615"),
                ("address", "广东省东莞市南城街道莞太路南城段29号恒顺大厦8楼"),
                ("service_time", "工作日 09:00–18:30 · 智能客服 7×24"),
                ("register_open", "1"),
                ("default_points", "1000"),
                ("review_mode", "manual"),
            ],
        )
    conn.commit()
    conn.close()


# ----------------------------------------------------------------------
# 工具
# ----------------------------------------------------------------------
def now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


SESSION_TTL_DAYS = 7


def _parse_ts(s):
    """把 'YYYY-MM-DD HH:MM:SS' 解析为时间戳，失败返回 0"""
    try:
        return time.mktime(time.strptime(s[:19], "%Y-%m-%d %H:%M:%S"))
    except Exception:
        return 0


def current_merchant():
    """兼容Bearer并支持主站Cookie，实时检查会话与商户状态。"""
    return platform_identity.parent(get_core(), request_token())


# ----------------------------------------------------------------------
# 密码哈希（PBKDF2-SHA256 + 盐）。格式: pbkdf2$<iter>$<salt_hex>$<hash_hex>
# 兼容历史明文：校验通过且为明文存储时，由调用方写回哈希（自动升级）
# ----------------------------------------------------------------------
PW_ITERATIONS = 120000


def pw_hash(password):
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PW_ITERATIONS)
    return "pbkdf2$%d$%s$%s" % (PW_ITERATIONS, salt.hex(), digest.hex())


def pw_is_hashed(stored):
    return isinstance(stored, str) and stored.startswith("pbkdf2$")


def pw_verify(password, stored):
    """校验密码。返回 (ok, needs_upgrade)"""
    if pw_is_hashed(stored):
        try:
            _, iters, salt_hex, hash_hex = stored.split("$", 3)
            digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                         bytes.fromhex(salt_hex), int(iters))
            return digest.hex() == hash_hex, False
        except Exception:
            return False, False
    ok = bool(password) and password == stored
    return ok, ok  # 明文命中 → 建议升级为哈希


def login_required(fn):
    def wrapper(*args, **kwargs):
        m = current_merchant()
        if not m:
            return jsonify({"code": 401, "msg": "未登录或登录已过期"}), 401
        return fn(m, *args, **kwargs)

    wrapper.__name__ = fn.__name__
    return wrapper


def admin_required(fn):
    def wrapper(m, *args, **kwargs):
        if m["role"] != "admin":
            return jsonify({"code": 403, "msg": "需要管理员权限"}), 403
        return fn(m, *args, **kwargs)

    wrapper.__name__ = fn.__name__
    return wrapper


def merchant_dict(m):
    keys = m.keys()
    return {
        "id": m["id"], "phone": m["phone"], "company": m["company"],
        "contact": m["contact"], "email": m["email"], "industry": m["industry"],
        "scale": m["scale"], "province": m["province"], "city": m["city"],
        "website": m["website"], "intro": m["intro"], "logo": m["logo"],
        "role": m["role"], "status": m["status"],
        "staff_no": m["staff_no"] if "staff_no" in keys else "",
        "token_balance": m["token_balance"], "invite_code": m["invite_code"],
        "created_at": m["created_at"],
        "disabled": m["disabled"] if "disabled" in keys else 0,
    }


def page_args(default_size=10):
    try:
        page = int(request.args.get("page", 1))
    except (TypeError, ValueError):
        page = 1
    try:
        size = int(request.args.get("pageSize", default_size))
    except (TypeError, ValueError):
        size = default_size
    page = max(1, page)
    size = max(1, min(100, size))
    return page, size


def paged(conn, count_sql, count_args, row_sql, row_args, page, size):
    total = conn.execute(count_sql, count_args).fetchone()[0]
    rows = conn.execute(row_sql + " LIMIT ? OFFSET ?",
                        list(row_args) + [size, (page - 1) * size]).fetchall()
    return total, [dict(r) for r in rows]


def get_settings():
    conn = get_db()
    rows = conn.execute("SELECT key,value FROM settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}


def admin_log(m, action, target="", detail=""):
    """记录管理员操作日志"""
    conn = get_db()
    conn.execute(
        "INSERT INTO logs(admin_id,admin_name,action,target,detail,ip,created_at) VALUES(?,?,?,?,?,?,?)",
        (m["id"], m["company"] or m["phone"], action, target, detail,
         request.remote_addr or "-", now_str()),
    )
    conn.commit()
    conn.close()


# ----------------------------------------------------------------------
# 静态资源与页面
# ----------------------------------------------------------------------
@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/index.html")
def home_index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/favicon.ico")
def favicon_ico():
    return send_from_directory(os.path.join(BASE_DIR, "icons"), "favicon.ico")


# 管理后台固定入口（商家登录页不提供任何指向这里的链接）
@app.route("/admin-login")
@app.route("/manage")
def admin_login_entry():
    return send_from_directory(os.path.join(BASE_DIR, "html"), "admin-login.html")


@app.route("/admin-entry")
def admin_entry_alias():
    return send_from_directory(os.path.join(BASE_DIR, "html"), "admin-login.html")


# ---------- 短路由：/qt 登录 /zt 客户端 /ht 管理后台（不带 html 前缀与 .html 后缀） ----------
@app.route("/qt")
@app.route("/qt/<path:p>")
def page_qt(p=None):
    target = p or "login.html"
    if not os.path.splitext(target)[1]:
        target += ".html"
    return send_from_directory(os.path.join(BASE_DIR, "html"), target)


@app.route("/zt")
def page_zt():
    # 302 到 /zt/merchant：既符合“入口跳主页”的预期，
    # 也让 merchant.html 里的相对资源(common.css/js)落到 /zt/* 路由上正常加载
    from flask import redirect
    return redirect("/zt/merchant", code=302)


@app.route("/zt/<path:p>")
@app.route("/ht/<path:p>")
def page_prefixed(p):
    target = p
    if not os.path.splitext(p)[1]:
        target += ".html"
    return send_from_directory(os.path.join(BASE_DIR, "html"), target)


@app.route("/ht")
def page_ht():
    from flask import redirect
    return redirect("/ht/admin-login", code=302)


@app.route("/html/")
def html_root():
    return send_from_directory(os.path.join(BASE_DIR, "html"), "login.html")


@app.route("/html/<path:filename>")
def html_pages(filename):
    return send_from_directory(os.path.join(BASE_DIR, "html"), filename)


@app.route("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(os.path.join(BASE_DIR, "assets"), filename)


@app.route("/icons/<path:filename>")
def icons(filename):
    return send_from_directory(os.path.join(BASE_DIR, "icons"), filename)


# ----------------------------------------------------------------------
# 404 友好页
# ----------------------------------------------------------------------
@app.errorhandler(Exception)
def handle_unexpected_error(e):
    """兜底异常：统一返回 JSON，并把堆栈写进 error.log 方便排查"""
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    tb = traceback.format_exc()
    try:
        with io.open(os.path.join(BASE_DIR, "error.log"), "a", encoding="utf-8") as f:
            f.write("[%s] %s %s\n%s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"),
                                           request.method, request.path, tb))
    except OSError:
        pass
    app.logger.error(tb)
    return jsonify({"code": 500, "msg": "服务异常，请稍后重试"}), 500


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"code": 404, "msg": "接口不存在"}), 404
    return (
        """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
        <title>页面不存在 - 泰卦智能</title>
        <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
        <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;
        font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#18181b}
        .box{text-align:center;padding:40px}h1{font-size:64px;margin:0;color:#c0392b;font-family:ui-monospace,monospace}
        p{color:#71717a;margin:10px 0 26px}a{display:inline-block;padding:10px 20px;border-radius:10px;
        background:#18181b;color:#fff;text-decoration:none;font-size:14px;margin:0 6px}</style></head>
        <body><div class="box"><h1>404</h1><p>页面不存在或已被移动</p>
        <a href="/">返回首页</a><a href="/html/login.html">进入控制台</a></div></body></html>""",
        404,
    )


# ----------------------------------------------------------------------
# 认证
# ----------------------------------------------------------------------
@app.post("/api/auth/register")
def auth_register():
    data = request.get_json(silent=True) or {}
    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""
    company = (data.get("company") or "").strip()
    contact = (data.get("contact") or "").strip()
    apply_remark = (data.get("remark") or "").strip()          # 注册时填写的需求说明
    invited_by = (data.get("invite_code") or "").strip().upper()  # 注册时填写的邀请码
    if not phone or len(phone) != 11 or not phone.isdigit():
        return jsonify({"code": 400, "msg": "请输入 11 位手机号"}), 400
    if not password or len(password) < 6:
        return jsonify({"code": 400, "msg": "密码至少 6 位"}), 400
    conf = get_settings()
    if conf.get("register_open", "1") != "1":
        return jsonify({"code": 403, "msg": "平台已关闭自助注册，请联系客户经理开通"}), 403
    conn = get_db()
    if conn.execute("SELECT 1 FROM merchants WHERE phone=?", (phone,)).fetchone():
        conn.close()
        return jsonify({"code": 400, "msg": "该手机号已注册，请直接登录"}), 400

    # ---- 邀请码校验：必填模式下缺失/无效都拒绝；填写了则必须真实存在 ----
    inviter = None
    if invited_by:
        inviter = conn.execute(
            "SELECT * FROM merchants WHERE invite_code=? AND role='merchant'",
            (invited_by,)).fetchone()
        if not inviter:
            conn.close()
            return jsonify({"code": 400, "msg": "邀请码不存在，请核对后重试"}), 400
    elif conf.get("invite_required") == "1":
        conn.close()
        return jsonify({"code": 400, "msg": "当前需凭邀请码注册，请向邀请人索取"}), 400
    invite_code = "TG" + uuid.uuid4().hex[:6].upper()
    try:
        points = int(conf.get("default_points", "0") or 0)
    except ValueError:
        points = 0
    status = "已认证" if conf.get("review_mode") == "auto" else "待审核"
    c = conn.cursor()
    c.execute(
        "INSERT INTO merchants(phone,password,company,contact,status,token_balance,"
        "invite_code,apply_remark,invited_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (phone, pw_hash(password), company or "未命名企业", contact or "—", status, points, invite_code,
         apply_remark, invited_by, now_str()),
    )
    mid = c.lastrowid
    if points:
        # 注册赠送：注册成功即入账并写流水（赠送点数在管理后台「系统设置」配置）
        c.execute(
            "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) VALUES(?,?,?,?,?,?)",
            (mid, "recharge", points, 0, "注册赠送点数", now_str()),
        )
    # ---- 邀请奖励：被邀请人注册成功，给邀请人加点 ----
    if inviter is not None:
        try:
            reward = int(conf.get("invite_reward_points", "0") or 0)
        except ValueError:
            reward = 0
        if reward > 0:
            c.execute("UPDATE merchants SET token_balance=token_balance+?,token_version=token_version+1 WHERE id=?",
                      (reward, inviter["id"]))
            c.execute(
                "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) VALUES(?,?,?,?,?,?)",
                (inviter["id"], "recharge", reward, 0,
                 "邀请奖励：新商家「%s」注册成功" % (company or "未命名企业"), now_str()),
            )
    token = uuid.uuid4().hex
    c.execute("INSERT INTO sessions(token,merchant_id,created_at) VALUES(?,?,?)", (token, mid, now_str()))
    conn.commit()
    m = conn.execute("SELECT * FROM merchants WHERE id=?", (mid,)).fetchone()
    conn.close()
    return jsonify({"code": 0, "msg": "注册成功", "data": {"token": token, "merchant": merchant_dict(m)}})


@app.post("/api/auth/login")
def auth_login():
    """登录入口按 scope 隔离：
    - scope=admin：管理端专属入口，必须管理员账号 + 密码（不接受验证码，避免任意 6 位数字绕过）
    - 默认 merchant：商家入口，管理员账号一律拒绝，防止从商家登录页进入后台
    """
    data = request.get_json(silent=True) or {}
    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""
    code = (data.get("code") or "").strip()
    scope = (data.get("scope") or "merchant").strip().lower()
    is_admin_entry = scope == "admin"

    conn = get_db()
    if is_admin_entry:
        # 管理端入口只认工号（ADMxxx，忽略大小写与空白）
        staff_no = phone.upper().replace(" ", "")
        m = conn.execute(
            "SELECT * FROM merchants WHERE role='admin' AND staff_no=?", (staff_no,)).fetchone()
    else:
        m = conn.execute("SELECT * FROM merchants WHERE phone=?", (phone,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"code": 400,
                        "msg": "工号不存在，请核对后重试" if is_admin_entry
                        else "该手机号未开通，请联系客户经理"}), 400
    if m["disabled"]:
        conn.close()
        return jsonify({"code": 403, "msg": "账号已被停用，请联系平台管理员"}), 403

    if is_admin_entry:
        if m["role"] != "admin":
            conn.close()
            return jsonify({"code": 403, "msg": "该账号不是管理员，请从商家登录页进入"}), 403
        # 管理端强制密码校验，验证码登录对管理员不开放
        ok, up = pw_verify(password or "", m["password"])
        if not ok:
            conn.close()
            return jsonify({"code": 400, "msg": "管理员账号或密码错误"}), 400
        if up:
            conn.execute("UPDATE merchants SET password=? WHERE id=?", (pw_hash(password), m["id"]))
    else:
        if m["role"] == "admin":
            conn.close()
            return jsonify({"code": 403, "msg": "管理员请使用管理端专属登录入口"}), 403
        if code:
            conn.close()
            # 短信通道未接入，验证码登录已下线（公网不允许任意验证码绕过密码）
            return jsonify({"code": 400, "msg": "验证码登录暂未开放，请使用密码登录"}), 400
        ok, up = pw_verify(password or "", m["password"])
        if not ok:
            conn.close()
            return jsonify({"code": 400, "msg": "手机号或密码错误"}), 400
        if up:
            # 历史明文密码自动升级为哈希
            conn.execute("UPDATE merchants SET password=? WHERE id=?",
                         (pw_hash(password), m["id"]))

    # ---- 审核状态拦截：待审核 / 已驳回 / 已过期 一律不发 token ----
    if is_admin_entry is False and m["role"] != "admin":
        if m["status"] == "待审核":
            conn.close()
            return jsonify({"code": 403,
                            "msg": "账号正在审核中，请等待管理员审核通过后再登录（客服 18925568615）"}), 403
        if m["status"] == "已驳回":
            conn.close()
            return jsonify({"code": 403,
                            "msg": "账号未通过审核，请联系客服 18925568615 了解详情"}), 403
        if m["status"] == "已过期":
            conn.close()
            return jsonify({"code": 403,
                            "msg": "账号服务已过期，请联系客服续费"}), 403
    token = uuid.uuid4().hex
    conn.execute("INSERT INTO sessions(token,merchant_id,created_at) VALUES(?,?,?)", (token, m["id"], now_str()))
    conn.execute("UPDATE merchants SET last_login=? WHERE id=?", (now_str(), m["id"]))
    conn.commit()
    conn.close()
    response = jsonify({"code": 0, "msg": "登录成功", "data": {"token": token, "merchant": merchant_dict(m)}})
    return platform_identity.finish_login(
        get_core(), response, token, scope, request.remote_addr or "", request.user_agent.string
    )


@app.get("/api/auth/me")
@login_required
def auth_me(m):
    return jsonify({"code": 0, "data": merchant_dict(m)})


@app.post("/api/auth/logout")
def auth_logout():
    payload = request.get_json(silent=True) or {}
    token = request_token() or payload.get("token", "")
    response = jsonify({"code": 0, "msg": "已退出登录"})
    return platform_identity.logout(get_core(), token, response)


@app.post("/api/auth/password")
@login_required
def auth_change_password(m):
    data = request.get_json(silent=True) or {}
    old = data.get("old_password") or ""
    new = data.get("new_password") or ""
    if not old or not new:
        return jsonify({"code": 400, "msg": "请填写当前密码与新密码"}), 400
    ok, _up = pw_verify(old, m["password"])
    if not ok:
        return jsonify({"code": 400, "msg": "当前密码不正确"}), 400
    if len(new) < 6:
        return jsonify({"code": 400, "msg": "新密码至少 6 位"}), 400
    conn = get_db()
    conn.execute("UPDATE merchants SET password=? WHERE id=?", (pw_hash(new), m["id"]))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "密码修改成功，下次登录请使用新密码"})


# ----------------------------------------------------------------------
# 商家信息
# ----------------------------------------------------------------------
@app.get("/api/merchant/me")
@login_required
def merchant_me(m):
    return jsonify({"code": 0, "data": merchant_dict(m)})


@app.put("/api/merchant/me")
@login_required
def merchant_update(m):
    data = request.get_json(silent=True) or {}
    fields = ["company", "contact", "email", "industry", "scale", "province", "city", "website", "intro", "logo"]
    sets, vals = [], []
    for f in fields:
        if f in data:
            sets.append(f"{f}=?")
            vals.append(data[f])
    if sets:
        conn = get_db()
        vals.append(m["id"])
        conn.execute(f"UPDATE merchants SET {','.join(sets)} WHERE id=?", vals)
        conn.commit()
        m2 = conn.execute("SELECT * FROM merchants WHERE id=?", (m["id"],)).fetchone()
        conn.close()
        return jsonify({"code": 0, "msg": "保存成功", "data": merchant_dict(m2)})
    return jsonify({"code": 0, "data": merchant_dict(m)})


# ----------------------------------------------------------------------
# 智能体标签（一级分类）
# ----------------------------------------------------------------------
@app.get("/api/agent-tags")
@login_required
def tags_list(m):
    conn = get_db()
    rows = conn.execute("SELECT * FROM tags ORDER BY sort,id").fetchall()
    conn.close()
    return jsonify({"code": 0, "data": [dict(r) for r in rows]})


@app.post("/api/agent-tags")
@login_required
@admin_required
def tags_create(m):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"code": 400, "msg": "标签名称不能为空"}), 400
    conn = get_db()
    cur = conn.execute("INSERT INTO tags(name,sort,created_at) VALUES(?,?,?)",
                       (name, int(data.get("sort") or 0), now_str()))
    conn.commit()
    row = conn.execute("SELECT * FROM tags WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    admin_log(m, "新增分类", name)
    return jsonify({"code": 0, "msg": "创建成功", "data": dict(row)})


@app.put("/api/agent-tags/<int:tag_id>")
@login_required
@admin_required
def tags_update(m, tag_id):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"code": 400, "msg": "标签名称不能为空"}), 400
    conn = get_db()
    if not conn.execute("SELECT 1 FROM tags WHERE id=?", (tag_id,)).fetchone():
        conn.close()
        return jsonify({"code": 404, "msg": "标签不存在"}), 404
    conn.execute("UPDATE tags SET name=?, sort=? WHERE id=?",
                 (name, int(data.get("sort") or 0), tag_id))
    conn.commit()
    row = conn.execute("SELECT * FROM tags WHERE id=?", (tag_id,)).fetchone()
    conn.close()
    admin_log(m, "编辑分类", name)
    return jsonify({"code": 0, "msg": "保存成功", "data": dict(row)})


@app.delete("/api/agent-tags/<int:tag_id>")
@login_required
@admin_required
def tags_delete(m, tag_id):
    conn = get_db()
    if conn.execute("SELECT 1 FROM agents WHERE tag_id=?", (tag_id,)).fetchone():
        conn.close()
        return jsonify({"code": 400, "msg": "该标签下仍有智能体，请先删除或移动智能体"}), 400
    conn.execute("DELETE FROM tags WHERE id=?", (tag_id,))
    conn.commit()
    conn.close()
    admin_log(m, "删除分类", "ID %s" % tag_id)
    return jsonify({"code": 0, "msg": "删除成功"})


# ----------------------------------------------------------------------
# 智能体
# ----------------------------------------------------------------------
@app.get("/api/agents")
@login_required
def agents_list(m):
    """智能体列表：管理员返回全部；商家返回全部上架（running）智能体。
    开通/到期由管理员在后台授权（agent_purchases），商家端不再展示购买与到期信息。"""
    tag_id = request.args.get("tag_id")
    conn = get_db()
    sql = ("SELECT a.*, t.name AS tag_name, '' AS expire_at "
           "FROM agents a JOIN tags t ON t.id=a.tag_id")
    args = []
    if m["role"] == "admin":
        if tag_id:
            sql += " WHERE a.tag_id=?"
            args.append(tag_id)
    else:
        sql += " WHERE a.status='running'"
        if tag_id:
            sql += " AND a.tag_id=?"
            args.append(tag_id)
    sql += " ORDER BY a.id"
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    return jsonify({"code": 0, "data": [dict(r) for r in rows]})


@app.post("/api/agents")
@login_required
@admin_required
def agents_create(m):
    data = request.get_json(silent=True) or {}
    tag_id = data.get("tag_id")
    name = (data.get("name") or "").strip()
    if not tag_id or not name:
        return jsonify({"code": 400, "msg": "标签与智能体名称必填"}), 400
    conn = get_db()
    if not conn.execute("SELECT 1 FROM tags WHERE id=?", (tag_id,)).fetchone():
        conn.close()
        return jsonify({"code": 400, "msg": "标签不存在"}), 400
    cur = conn.execute(
        "INSERT INTO agents(tag_id,name,region,description,status,link,created_at) VALUES(?,?,?,?,?,?,?)",
        (tag_id, name, data.get("region") or "国内", data.get("description") or "",
         data.get("status") or "running", data.get("link") or "", now_str()),
    )
    conn.commit()
    row = conn.execute(
        "SELECT a.*, t.name AS tag_name FROM agents a JOIN tags t ON t.id=a.tag_id WHERE a.id=?",
        (cur.lastrowid,),
    ).fetchone()
    conn.close()
    admin_log(m, "新增智能体", name)
    return jsonify({"code": 0, "msg": "创建成功", "data": dict(row)})


@app.get("/api/agents/<int:agent_id>")
@login_required
def agents_detail(m, agent_id):
    conn = get_db()
    row = conn.execute(
        "SELECT a.*, t.name AS tag_name FROM agents a JOIN tags t ON t.id=a.tag_id WHERE a.id=?",
        (agent_id,),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"code": 404, "msg": "智能体不存在"}), 404
    return jsonify({"code": 0, "data": dict(row)})


@app.put("/api/agents/<int:agent_id>")
@login_required
def agents_update(m, agent_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    exists = conn.execute("SELECT 1 FROM agents WHERE id=?", (agent_id,)).fetchone()
    if not exists:
        conn.close()
        return jsonify({"code": 404, "msg": "智能体不存在"}), 404
    # 商家只允许启用/停用（改 status）；名称、描述、分类等编辑仅管理员
    if m["role"] != "admin":
        allowed = {k: v for k, v in data.items() if k == "status"}
        if not allowed:
            conn.close()
            return jsonify({"code": 403, "msg": "商家仅可启用/停用智能体，编辑信息需要管理员权限"}), 403
        conn.execute("UPDATE agents SET status=?, updated_at=? WHERE id=?",
                     (allowed["status"], now_str(), agent_id))
        conn.commit()
        conn.close()
        return jsonify({"code": 0, "msg": "操作成功"})
    fields = ["name", "region", "description", "status", "link", "tag_id",
              "price", "duration_days"]
    sets, vals = [], []
    for f in fields:
        if f in data:
            sets.append(f"{f}=?")
            vals.append(data[f])
    if sets:
        sets.append("updated_at=?")
        vals.append(now_str())
        vals.append(agent_id)
        conn.execute(f"UPDATE agents SET {','.join(sets)} WHERE id=?", vals)
        conn.commit()
    row = conn.execute(
        "SELECT a.*, t.name AS tag_name FROM agents a JOIN tags t ON t.id=a.tag_id WHERE a.id=?",
        (agent_id,),
    ).fetchone()
    conn.close()
    admin_log(m, "编辑智能体", row["name"] if row else "ID %s" % agent_id)
    return jsonify({"code": 0, "msg": "保存成功", "data": dict(row)})


@app.delete("/api/agents/<int:agent_id>")
@login_required
@admin_required
def agents_delete(m, agent_id):
    """删除智能体：同时清理授权记录与授权/购买历史，避免留下孤儿数据"""
    conn = get_db()
    row = conn.execute("SELECT name FROM agents WHERE id=?", (agent_id,)).fetchone()
    conn.execute("DELETE FROM agents WHERE id=?", (agent_id,))
    conn.execute("DELETE FROM agent_purchases WHERE agent_id=?", (agent_id,))
    conn.execute("DELETE FROM agent_orders WHERE agent_id=?", (agent_id,))
    conn.commit()
    conn.close()
    admin_log(m, "删除智能体", row["name"] if row else "ID %s" % agent_id)
    return jsonify({"code": 0, "msg": "删除成功"})


@app.post("/api/agents/<int:agent_id>/chat")
@login_required
def agents_chat(m, agent_id):
    """与智能体对话（测试）—— 演示环境返回模拟回复"""
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"code": 400, "msg": "消息不能为空"}), 400
    conn = get_db()
    a = conn.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
    conn.close()
    if not a:
        return jsonify({"code": 404, "msg": "智能体不存在"}), 404
    replies = [
        "收到，我是{name}。已记录您的需求，稍后为您安排执行计划。",
        "好的，该任务已加入 {name} 的执行队列，完成后会同步结果给您。",
        "我是{name}，根据当前配置，我可以帮您完成触达、跟进与复盘，请问需要先处理哪一项？",
    ]
    reply = random.choice(replies).format(name=a["name"])
    return jsonify({"code": 0, "data": {"agent_id": agent_id, "agent_name": a["name"],
                                        "reply": reply, "ts": now_str()}})


# ----------------------------------------------------------------------
# TOKEN（商家侧；充值走「TOKEN 充值」页的 /api/pay/order 或兑换码）
# ----------------------------------------------------------------------
@app.get("/api/token/balance")
@login_required
def token_balance(m):
    data = platform_billing.get_balance(get_core(), m["id"])
    data["unit"] = "点数"
    return jsonify({"code": 0, "data": data})


# ----------------------------------------------------------------------
# 点卡兑换码（管理端生成发放 / 商家端兑换）
# ----------------------------------------------------------------------
# 去掉容易看错的 0 O 1 I，卡密只由这些字符组成
REDEEM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

# 点卡面额预设（与充值页档位保持一致）
REDEEM_PRESETS = [
    {"price": 10, "points": 1000},
    {"price": 30, "points": 3200},
    {"price": 50, "points": 5500},
    {"price": 100, "points": 11500},
    {"price": 300, "points": 36000},
    {"price": 500, "points": 62000},
]


def redeem_norm(s):
    """把用户输入的卡密规整为入库格式：全部大写，只保留字母数字（自动忽略空格与短横线）"""
    return "".join(ch for ch in (s or "").upper() if ch.isalnum())


def redeem_fmt(code):
    """展示格式：每 4 位一组，如 TK3F-7A9C-2E5B-8D1F"""
    c = redeem_norm(code)
    return "-".join(c[i:i + 4] for i in range(0, len(c), 4))


def redeem_new_code():
    """TK + 14 位随机字符 = 16 位卡密"""
    return "TK" + "".join(random.choice(REDEEM_ALPHABET) for _ in range(14))


def redeem_state(row):
    """展示用状态：库里的 unused 若已过期则显示 expired"""
    if row["status"] == "unused" and row["expire_at"] and row["expire_at"] < now_str():
        return "expired"
    return row["status"]


@app.post("/api/token/redeem")
@login_required
def token_redeem(m):
    """商家用点卡兑换码充值点数。条件更新保证并发下同一张卡只能兑一次。"""
    data = request.get_json(silent=True) or {}
    code = redeem_norm(data.get("code"))
    if not code:
        return jsonify({"code": 400, "msg": "请输入兑换码"}), 400
    if len(code) != 16:
        return jsonify({"code": 400, "msg": "兑换码为 16 位，请核对后重试"}), 400

    conn = get_db()
    row = conn.execute("SELECT * FROM redeem_codes WHERE code=?", (code,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "兑换码不存在，请核对后重试"}), 404
    if row["status"] == "void":
        conn.close()
        return jsonify({"code": 400, "msg": "该兑换码已被平台作废"}), 400
    if row["status"] == "used":
        conn.close()
        return jsonify({"code": 400, "msg": "该兑换码已被使用"}), 400
    if row["expire_at"] and row["expire_at"] < now_str():
        conn.close()
        return jsonify({"code": 400, "msg": "该兑换码已过期（有效期至 %s）" % row["expire_at"][:10]}), 400

    cur = conn.execute(
        "UPDATE redeem_codes SET status='used', merchant_id=?, used_at=? "
        "WHERE id=? AND status='unused'", (m["id"], now_str(), row["id"]))
    if cur.rowcount != 1:
        conn.rollback()
        conn.close()
        return jsonify({"code": 400, "msg": "该兑换码已被使用"}), 400

    conn.execute("UPDATE merchants SET token_balance=token_balance+?,token_version=token_version+1 WHERE id=?",
                 (row["points"], m["id"]))
    bal = conn.execute("SELECT token_balance FROM merchants WHERE id=?", (m["id"],)).fetchone()[0]
    conn.execute(
        "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) VALUES(?,?,?,?,?,?)",
        (m["id"], "recharge", row["points"], row["price"] or 0,
         "兑换点卡 %s（%d 点）" % (redeem_fmt(code), row["points"]), now_str()))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "兑换成功，已到账 %s 点" % row["points"],
                    "data": {"balance": bal, "points": row["points"], "code": redeem_fmt(code)}})


# ----------------------------------------------------------------------
# 智能体购买（商家用点数购买 / 管理员定价与开通）
# ----------------------------------------------------------------------
def agent_order_no():
    return "AG" + time.strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:6].upper()


def pay_order_no():
    return "PAY" + time.strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:6].upper()


def purchase_renew(conn, merchant_id, agent_id, duration_days):
    """开通/续期：未到期则顺延，已到期或未购买从当前时间起算。返回新到期时间。"""
    from datetime import datetime, timedelta
    fmt = "%Y-%m-%d %H:%M:%S"
    now = datetime.now()
    row = conn.execute(
        "SELECT expire_at FROM agent_purchases WHERE merchant_id=? AND agent_id=?",
        (merchant_id, agent_id)).fetchone()
    base = now
    if row and row["expire_at"]:
        try:
            exp = datetime.strptime(row["expire_at"], fmt)
            if exp > now:
                base = exp
        except ValueError:
            pass
    days = int(duration_days or 0)
    if days <= 0:
        days = 365
    new_exp = (base + timedelta(days=days)).strftime(fmt)
    if row:
        conn.execute(
            "UPDATE agent_purchases SET expire_at=?, updated_at=? "
            "WHERE merchant_id=? AND agent_id=?",
            (new_exp, now_str(), merchant_id, agent_id))
    else:
        conn.execute(
            "INSERT INTO agent_purchases(merchant_id,agent_id,expire_at,created_at,updated_at) "
            "VALUES(?,?,?,?,?)", (merchant_id, agent_id, new_exp, now_str(), now_str()))
    return new_exp


@app.get("/api/admin/agent-orders")
@login_required
@admin_required
def admin_agent_orders(m):
    """购买/开通记录（管理员）"""
    page, size = page_args()
    status = (request.args.get("status") or "").strip()
    kw = (request.args.get("keyword") or "").strip()
    where, args = ["1=1"], []
    if status:
        where.append("o.status=?")
        args.append(status)
    if kw:
        where.append("(o.order_no LIKE ? OR c.company LIKE ? OR c.phone LIKE ? OR ag.name LIKE ?)")
        args += ["%%%s%%" % kw] * 4
    cond = " WHERE " + " AND ".join(where)
    base = (" FROM agent_orders o JOIN merchants c ON c.id=o.merchant_id "
            "JOIN agents ag ON ag.id=o.agent_id" + cond)
    conn = get_db()
    total, rows = paged(
        conn,
        "SELECT COUNT(*)" + base, args,
        "SELECT o.*, c.company, c.phone, ag.name AS agent_name" + base + " ORDER BY o.id DESC",
        args, page, size,
    )
    conn.close()
    return jsonify({"code": 0, "data": {"list": rows, "total": total, "page": page, "pageSize": size}})


@app.post("/api/admin/agent-grant")
@login_required
@admin_required
def admin_agent_grant(m):
    """管理员给商家开通/续期智能体（赠送，不扣点）"""
    data = request.get_json(silent=True) or {}
    merchant_id = int(data.get("merchant_id") or 0)
    agent_id = int(data.get("agent_id") or 0)
    days = int(data.get("days") or 365)
    if merchant_id <= 0 or agent_id <= 0 or days <= 0:
        return jsonify({"code": 400, "msg": "商家、智能体与天数均必填"}), 400
    conn = get_db()
    mc = conn.execute("SELECT company FROM merchants WHERE id=?", (merchant_id,)).fetchone()
    ag = conn.execute("SELECT name FROM agents WHERE id=?", (agent_id,)).fetchone()
    if not mc or not ag:
        conn.close()
        return jsonify({"code": 404, "msg": "商家或智能体不存在"}), 404
    new_exp = purchase_renew(conn, merchant_id, agent_id, days)
    conn.execute(
        "INSERT INTO agent_orders(order_no,merchant_id,agent_id,channel,amount,"
        "duration_days,status,paid_at,created_at) VALUES(?,?,?,?,?,?, 'paid', ?, ?)",
        (agent_order_no(), merchant_id, agent_id, "admin", 0, days, now_str(), now_str()))
    conn.commit()
    conn.close()
    admin_log(m, "开通/续期智能体", "「%s」→ %s（%d 天，至 %s）" % (ag["name"], mc["company"], days, new_exp[:10]))
    return jsonify({"code": 0, "msg": "已开通至 %s" % new_exp[:10], "data": {"expire_at": new_exp}})


@app.get("/api/admin/merchants/<int:merchant_id>/agents")
@login_required
@admin_required
def admin_merchant_agents(m, merchant_id):
    """单个商家的智能体授权情况：全部智能体 + 该商家的到期时间（供开通/续期/取消）"""
    conn = get_db()
    mc = conn.execute("SELECT id,company,phone FROM merchants WHERE id=?",
                      (merchant_id,)).fetchone()
    if not mc:
        conn.close()
        return jsonify({"code": 404, "msg": "商家不存在"}), 404
    rows = conn.execute(
        "SELECT a.id, a.name, a.status, a.price, a.duration_days, a.link, a.tag_id, "
        "       t.name AS tag_name, p.expire_at, p.updated_at AS granted_at "
        "FROM agents a JOIN tags t ON t.id=a.tag_id "
        "LEFT JOIN agent_purchases p ON p.agent_id=a.id AND p.merchant_id=? "
        "ORDER BY t.sort, a.id", (merchant_id,)).fetchall()
    conn.close()
    now = now_str()
    out = []
    for r in rows:
        d = dict(r)
        exp = d.get("expire_at") or ""
        d["active"] = bool(exp and exp > now)
        d["expired"] = bool(exp and exp <= now)
        out.append(d)
    return jsonify({"code": 0, "data": {"merchant": dict(mc), "list": out}})


@app.post("/api/admin/agent-revoke")
@login_required
@admin_required
def admin_agent_revoke(m):
    """取消商家某个智能体的授权（删除授权记录，商家端立即回到「未购买」状态）"""
    data = request.get_json(silent=True) or {}
    merchant_id = int(data.get("merchant_id") or 0)
    agent_id = int(data.get("agent_id") or 0)
    if merchant_id <= 0 or agent_id <= 0:
        return jsonify({"code": 400, "msg": "商家与智能体均必填"}), 400
    conn = get_db()
    row = conn.execute(
        "SELECT expire_at FROM agent_purchases WHERE merchant_id=? AND agent_id=?",
        (merchant_id, agent_id)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "该商家尚未开通此智能体"}), 404
    conn.execute("DELETE FROM agent_purchases WHERE merchant_id=? AND agent_id=?",
                 (merchant_id, agent_id))
    conn.commit()
    mc = conn.execute("SELECT company FROM merchants WHERE id=?", (merchant_id,)).fetchone()
    ag = conn.execute("SELECT name FROM agents WHERE id=?", (agent_id,)).fetchone()
    conn.close()
    admin_log(m, "取消智能体授权",
              "「%s」- %s" % (ag["name"] if ag else agent_id,
                            mc["company"] if mc else merchant_id))
    return jsonify({"code": 0, "msg": "已取消授权"})


# ----------------------------------------------------------------------
# 独立站入口（商家端侧栏「独立站创建」，跳转地址由管理后台配置）
# ----------------------------------------------------------------------
SITE_ENTRY_KEY = "standalone_site"
SITE_ENTRY_DEFAULT = {
    "enabled": 1,
    "name": "独立站创建",
    "url": "https://dlz.taikua.cn",
    "desc": "一键生成属于您品牌的企业独立站",
    "new_tab": 1,
}


def normalize_url(u):
    """补全协议并做基础合法性校验"""
    u = (u or "").strip()
    if not u:
        return ""
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def site_entry_get():
    """当前生效的独立站入口配置（settings 覆盖默认值）"""
    raw = get_settings().get(SITE_ENTRY_KEY, "")
    conf = dict(SITE_ENTRY_DEFAULT)
    if raw:
        try:
            saved = json.loads(raw)
            if isinstance(saved, dict):
                for k in list(conf.keys()):
                    if k in saved:
                        conf[k] = saved[k]
        except (ValueError, TypeError):
            pass
    conf["enabled"] = 1 if str(conf.get("enabled")) in ("1", "True", "true") else 0
    conf["new_tab"] = 1 if str(conf.get("new_tab")) in ("1", "True", "true") else 0
    conf["name"] = (conf.get("name") or "独立站创建").strip()[:20]
    conf["url"] = normalize_url(conf.get("url") or "")
    conf["desc"] = (conf.get("desc") or "").strip()[:80]
    return conf


@app.get("/api/site-entries")
@login_required
def site_entries(m):
    """商家端侧栏需要的跳转入口（已禁用则不返回可用项）"""
    return jsonify({"code": 0, "data": {"standalone": site_entry_get()}})


@app.put("/api/admin/site-entries")
@login_required
@admin_required
def admin_site_entries_put(m):
    data = request.get_json(silent=True) or {}
    cur = site_entry_get()
    name = (data.get("name") if data.get("name") is not None else cur["name"]) or ""
    name = name.strip()[:20] or "独立站创建"
    url = normalize_url(data.get("url") if data.get("url") is not None else cur["url"])
    desc = (data.get("desc") if data.get("desc") is not None else cur["desc"]) or ""
    desc = desc.strip()[:80]
    enabled = 1 if str(data.get("enabled", cur["enabled"])) in ("1", "True", "true") else 0
    new_tab = 1 if str(data.get("new_tab", cur["new_tab"])) in ("1", "True", "true") else 0
    if not url:
        return jsonify({"code": 400, "msg": "请填写跳转地址"}), 400
    if not re.match(r"^https?://[^\s]+$", url):
        return jsonify({"code": 400, "msg": "跳转地址格式不正确"}), 400
    conf = {"enabled": enabled, "name": name, "url": url, "desc": desc, "new_tab": new_tab}
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                 (SITE_ENTRY_KEY, json.dumps(conf, ensure_ascii=False)))
    conn.commit()
    conn.close()
    admin_log(m, "更新独立站入口", "%s → %s%s" % (name, url, "" if enabled else "（已隐藏）"))
    return jsonify({"code": 0, "msg": "已保存", "data": {"standalone": site_entry_get()}})


# ----------------------------------------------------------------------
# 支付平台对接（预留：微信支付 / 支付宝）
# 接入步骤：
#   1) pay_create(channel, order) 里调用对应 SDK 下单，返回拉起支付所需参数；
#   2) notify_wechat / notify_alipay 里替换验签函数为真实验签；
#   3) 验签通过后调用 pay_fulfill 完成履约（开通智能体 / 充点数）。
# 业务层（购买、充值、流水）无需再改动。
# ----------------------------------------------------------------------
PAY_CHANNELS = ("wechat", "alipay")

# 渠道字段定义：管理后台据此渲染表单、校验是否配置完整
# secret=True 的字段只写不读（接口一律脱敏返回）
PAY_DEFS = {
    "wechat": {
        "name": "微信支付",
        "notify_path": "/api/pay/notify/wechat",
        "fields": [
            {"key": "pay_wechat_mch_id", "label": "商户号 mch_id", "required": True,
             "secret": False, "placeholder": "如 1900000109"},
            {"key": "pay_wechat_app_id", "label": "APPID（网站应用 / 公众号）", "required": True,
             "secret": False, "placeholder": "wx 开头的 18 位"},
            {"key": "pay_wechat_apiv3_key", "label": "APIv3 密钥（32 位）", "required": True,
             "secret": True, "placeholder": "商户平台 → 账户中心 → API 安全"},
            {"key": "pay_wechat_cert_serial", "label": "API 证书序列号", "required": True,
             "secret": False, "placeholder": "商户证书的 40 位序列号"},
            {"key": "pay_wechat_key_path", "label": "商户私钥文件路径", "required": True,
             "secret": False, "placeholder": "/opt/pay/apiclient_key.pem"},
            {"key": "pay_wechat_cert_path", "label": "商户证书文件路径", "required": False,
             "secret": False, "placeholder": "/opt/pay/apiclient_cert.pem"},
            {"key": "pay_wechat_platform_cert", "label": "平台证书路径（回调验签）", "required": False,
             "secret": False, "placeholder": "/opt/pay/wechatpay_platform.pem"},
            {"key": "pay_wechat_notify_url", "label": "支付回调地址", "required": True,
             "secret": False, "placeholder": "留空自动使用当前域名"},
        ],
    },
    "alipay": {
        "name": "支付宝",
        "notify_path": "/api/pay/notify/alipay",
        "fields": [
            {"key": "pay_alipay_app_id", "label": "应用 APPID", "required": True,
             "secret": False, "placeholder": "开放平台应用的 16 位 APPID"},
            {"key": "pay_alipay_private_key", "label": "应用私钥（RSA2）", "required": True,
             "secret": True, "placeholder": "-----BEGIN RSA PRIVATE KEY-----"},
            {"key": "pay_alipay_public_key", "label": "支付宝公钥", "required": True,
             "secret": False, "placeholder": "-----BEGIN PUBLIC KEY-----"},
            {"key": "pay_alipay_gateway", "label": "网关地址", "required": False,
             "secret": False, "placeholder": "https://openapi.alipay.com/gateway.do"},
            {"key": "pay_alipay_notify_url", "label": "异步通知地址", "required": True,
             "secret": False, "placeholder": "留空自动使用当前域名"},
            {"key": "pay_alipay_sandbox", "label": "沙箱模式（1=开启，0=生产）", "required": False,
             "secret": False, "placeholder": "0"},
        ],
    },
}


def pay_env_key(key):
    """同名环境变量（TK_ 前缀）优先于数据库，便于生产用 .env 管理密钥"""
    return "TK_" + key.upper()


def pay_conf():
    """读取全部支付配置：环境变量优先，其次 settings 表"""
    s_ = get_settings()
    conf = {}
    for ch, meta in PAY_DEFS.items():
        for f in meta["fields"]:
            k = f["key"]
            env = os.environ.get(pay_env_key(k))
            if env not in (None, ""):
                conf[k] = {"value": env, "from_env": True}
            else:
                conf[k] = {"value": (s_.get(k) or ""), "from_env": False}
        ek = "pay_%s_enabled" % ch
        conf[ek] = {"value": (s_.get(ek) or "0"), "from_env": False}
    return conf


def pay_mask(v):
    if not v:
        return ""
    if len(v) <= 10:
        return "*" * len(v)
    return v[:3] + "*" * 6 + v[-4:]


def pay_channel_state(ch, conf=None):
    """单个渠道的完整状态：字段值（脱敏）、是否启用、是否配置完整、缺哪些项"""
    conf = conf or pay_conf()
    meta = PAY_DEFS[ch]
    enabled = (conf.get("pay_%s_enabled" % ch, {}).get("value") or "0") == "1"
    try:
        host = request.host_url.rstrip("/")
    except RuntimeError:
        host = "https://你的域名"
    default_notify = host + meta["notify_path"]
    fields, missing = [], []
    for f in meta["fields"]:
        c = conf.get(f["key"], {})
        raw = c.get("value") or ""
        # 回调地址留空时自动用当前域名兜底，视为已配置（不写库、不强制填写）
        auto = bool(not raw and f["key"].endswith("notify_url"))
        item = {
            "key": f["key"], "label": f["label"], "required": f["required"],
            "secret": f["secret"], "placeholder": f.get("placeholder", ""),
            "from_env": c.get("from_env", False),
            "configured": bool(raw) or auto, "auto": auto,
            "value": "" if (f["secret"] or auto) else raw,
            "masked": pay_mask(raw) if f["secret"] else "",
        }
        if auto:
            item["placeholder"] = "留空自动使用 " + default_notify
        if f["required"] and not raw and not auto:
            missing.append({"key": f["key"], "label": f["label"]})
        fields.append(item)
    notify = conf.get("pay_%s_notify_url" % ch, {}).get("value") or default_notify
    return {
        "channel": ch, "name": meta["name"], "enabled": enabled,
        "ready": bool(enabled and not missing), "missing": missing,
        "fields": fields, "notify_url": notify,
    }


def pay_guard(channel):
    """下单前校验渠道：未启用 / 配置不全直接拒绝，返回错误文案或 None"""
    if channel not in PAY_CHANNELS:
        return "不支持的支付渠道（wechat / alipay）"
    st = pay_channel_state(channel)
    if not st["enabled"]:
        return "「%s」已被管理员关闭，请换用其他支付方式" % st["name"]
    if st["missing"]:
        return "「%s」尚未完成配置（缺少：%s），请联系管理员" % (
            st["name"], "、".join(x["label"] for x in st["missing"]))
    return None


def pay_create(channel, order):
    """下单预留。接入示例：
    微信 Native 扫码（wepay SDK）:
        wxpay.payments.native.prepay(
            description=..., out_trade_no=order["order_no"],
            notify_url="https://你的域名/api/pay/notify/wechat",
            amount={"total": int(order["amount"] * 100), "currency": "CNY"})
    支付宝当面付（alipay-sdk-python）:
        alipay.api_alipay_trade_precreate(
            out_trade_no=order["order_no"], total_amount=str(order["amount"]),
            notify_url="https://你的域名/api/pay/notify/alipay")
    配置统一从 pay_conf() 读取（env 优先），例如：
        conf = pay_conf()
        mch_id = conf["pay_wechat_mch_id"]["value"]
        apiv3_key = conf["pay_wechat_apiv3_key"]["value"]
    接入前统一返回未开通。"""
    return False, None


def pay_fulfill(conn, order):
    """支付成功后的履约：points=点数充值。幂等：仅 pending 转 paid。
    （智能体线上购买已下线，开通/续期由管理员后台授权，不经过支付订单。）"""
    cur = conn.execute("UPDATE pay_orders SET status='paid', paid_at=? "
                       "WHERE order_no=? AND status='pending'", (now_str(), order["order_no"]))
    if cur.rowcount != 1:
        return False
    if order["kind"] == "points":
        conn.execute("UPDATE merchants SET token_balance=token_balance+?,token_version=token_version+1 WHERE id=?",
                     (order["points"], order["merchant_id"]))
        conn.execute(
            "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) VALUES(?,?,?,?,?,?)",
            (order["merchant_id"], "recharge", order["points"], order["amount"] or 0,
             "在线支付充值 %d 点（订单 %s）" % (order["points"], order["order_no"]), now_str()))
    return True


@app.post("/api/pay/order")
@login_required
def pay_order_create(m):
    """统一下单（预留，仅用于 TOKEN 充值）。channel 只支持 wechat/alipay。
    返回 501 + 订单号，接入支付平台后在此返回拉起参数；
    支付成功回调里走 pay_fulfill 完成点数入账。
    （智能体线上购买已下线，开通/续期由管理员后台授权。）"""
    data = request.get_json(silent=True) or {}
    kind = data.get("kind")
    channel = data.get("channel") or "wechat"
    if kind != "points":
        return jsonify({"code": 400, "msg": "kind 必须为 points"}), 400
    if channel not in PAY_CHANNELS:
        return jsonify({"code": 400, "msg": "不支持的支付渠道（wechat / alipay）"}), 400
    err = pay_guard(channel)
    if err:
        return jsonify({"code": 400, "msg": err}), 400
    conn = get_db()
    points = int(data.get("points") or 0)
    if points <= 0:
        conn.close()
        return jsonify({"code": 400, "msg": "充值点数必须大于 0"}), 400
    # 默认 1元=100点
    amount = float(data.get("amount") or (points / 100.0))
    if amount <= 0:
        conn.close()
        return jsonify({"code": 400, "msg": "支付金额必须大于 0"}), 400
    order_no = pay_order_no()
    conn.execute(
        "INSERT INTO pay_orders(order_no,merchant_id,kind,agent_id,points,amount,"
        "duration_days,channel,status,created_at) VALUES(?,?,?,?,?,?,?,?, 'pending', ?)",
        (order_no, m["id"], kind, agent_id, points, amount, days, channel, now_str()))
    order = dict(conn.execute("SELECT * FROM pay_orders WHERE order_no=?", (order_no,)).fetchone())
    ok, payload = pay_create(channel, order)
    conn.commit()
    conn.close()
    return jsonify({"code": 501, "data": {"order_no": order_no, "amount": amount,
                                          "channel": channel, "pay_params": payload},
                    "msg": "「%s」支付渠道尚未接入，订单已创建，接入后无需改动业务流程" % channel}), 501


@app.get("/api/pay/order/<order_no>")
@login_required
def pay_order_query(m, order_no):
    """支付订单状态查询（供前端轮询支付结果）"""
    conn = get_db()
    row = conn.execute("SELECT * FROM pay_orders WHERE order_no=? AND merchant_id=?",
                       (order_no, m["id"])).fetchone()
    conn.close()
    if not row:
        return jsonify({"code": 404, "msg": "订单不存在"}), 404
    return jsonify({"code": 0, "data": dict(row)})


@app.get("/api/admin/pay-settings")
@login_required
@admin_required
def admin_pay_settings_get(m):
    """支付渠道配置（密钥一律脱敏，只回是否已配置）"""
    conf = pay_conf()
    data = {ch: pay_channel_state(ch, conf) for ch in PAY_CHANNELS}
    return jsonify({"code": 0, "data": data})


@app.put("/api/admin/pay-settings")
@login_required
@admin_required
def admin_pay_settings_put(m):
    """保存支付配置。values 中空字符串=不修改；"__CLEAR__"=清空该字段。"""
    data = request.get_json(silent=True) or {}
    values = data.get("values") or {}
    enabled = data.get("enabled") or {}
    allowed = set()
    for ch, meta in PAY_DEFS.items():
        allowed.add("pay_%s_enabled" % ch)
        allowed.update(f["key"] for f in meta["fields"])
    conn = get_db()
    changed = []
    for ch in PAY_CHANNELS:
        if ch in enabled:
            k = "pay_%s_enabled" % ch
            conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                         (k, "1" if enabled[ch] else "0"))
            changed.append(k + "=" + ("1" if enabled[ch] else "0"))
    for k, v in values.items():
        if k not in allowed:
            continue
        v = "" if v is None else str(v).strip()
        if v == "":
            continue  # 空值不覆盖，避免密钥框留空把已有配置清掉
        if v == "__CLEAR__":
            conn.execute("DELETE FROM settings WHERE key=?", (k,))
            changed.append(k + "(清空)")
            continue
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (k, v))
        changed.append(k)
    conn.commit()
    conn.close()
    admin_log(m, "更新支付配置", ",".join(changed) or "无变化")
    conf = pay_conf()
    states = {ch: pay_channel_state(ch, conf) for ch in PAY_CHANNELS}
    warn = []
    for ch, st in states.items():
        if st["enabled"] and st["missing"]:
            warn.append("%s 缺少 %s" % (st["name"], "、".join(x["label"] for x in st["missing"])))
    msg = "支付配置已保存"
    if warn:
        msg += "；注意：" + "；".join(warn) + "，该渠道暂不可用"
    return jsonify({"code": 0, "msg": msg, "data": states})


@app.get("/api/pay/channels")
@login_required
def pay_channels_public(m):
    """商家端查询可用支付渠道（只暴露是否可用，不含任何密钥）"""
    conf = pay_conf()
    out = []
    for ch in PAY_CHANNELS:
        st = pay_channel_state(ch, conf)
        out.append({
            "channel": ch, "name": st["name"],
            "enabled": st["enabled"], "usable": st["ready"],
            "missing": [x["label"] for x in st["missing"]],
        })
    return jsonify({"code": 0, "data": out})


def _pay_notify_verify(channel):
    """回调验签（预留占位）。接入后替换为真实验签：
    微信：APIv3 平台证书验签（Wechatpay-Signature / Wechatpay-Timestamp / Wechatpay-Nonce 头）
    支付宝：用支付宝公钥对 notify 参数验签（RSA2）
    未接入前一律返回 False，避免伪造回调触发履约。"""
    return False


@app.post("/api/pay/notify/wechat")
def pay_notify_wechat():
    """微信支付回调（预留）。接入后流程：验签 → 解析 out_trade_no → 幂等转 paid → pay_fulfill"""
    if not _pay_notify_verify("wechat"):
        return jsonify({"code": "FAIL", "message": "签名验证失败（渠道未接入）"}), 400
    body = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM pay_orders WHERE order_no=?",
                       (body.get("out_trade_no") or "",)).fetchone()
    if row:
        pay_fulfill(conn, dict(row))
        conn.commit()
    conn.close()
    return jsonify({"code": "SUCCESS", "message": "OK"})


@app.post("/api/pay/notify/alipay")
def pay_notify_alipay():
    """支付宝异步通知（预留）。接入后流程同上，需返回纯文本 success"""
    if not _pay_notify_verify("alipay"):
        return "fail", 400
    order_no = request.form.get("out_trade_no") or ""
    conn = get_db()
    row = conn.execute("SELECT * FROM pay_orders WHERE order_no=?", (order_no,)).fetchone()
    if row:
        pay_fulfill(conn, dict(row))
        conn.commit()
    conn.close()
    return "success"


# ----------------------------------------------------------------------
# 客服中心 / 工单
# ----------------------------------------------------------------------
@app.get("/api/support/tickets")
@login_required
def tickets_list(m):
    conn = get_db()
    if m["role"] == "admin":
        rows = conn.execute("SELECT * FROM tickets ORDER BY id DESC").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM tickets WHERE merchant_id=? ORDER BY id DESC", (m["id"],)
        ).fetchall()
    conn.close()
    return jsonify({"code": 0, "data": [dict(r) for r in rows]})


@app.post("/api/support/tickets")
@login_required
def tickets_create(m):
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        return jsonify({"code": 400, "msg": "标题与问题描述必填"}), 400
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO tickets(merchant_id,title,category,content,status,priority,created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (m["id"], title, data.get("category") or "其他", content, "处理中",
         data.get("priority") or "普通", now_str()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tickets WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify({"code": 0, "msg": "工单已提交，我们会尽快处理", "data": dict(row)})


# ----------------------------------------------------------------------
# 公告（商家端读取已发布）
# ----------------------------------------------------------------------
@app.get("/api/admin/recharge-tiers")
@login_required
@admin_required
def admin_recharge_tiers_get(m):
    """充值档位配置（管理员）：返回当前生效档位与是否使用内置默认"""
    raw = get_settings().get("recharge_tiers", "")
    data = recharge_tiers_list()
    return jsonify({"code": 0, "data": {
        "tiers": data,
        "custom": bool(raw and json.loads(raw or "[]")),
    }})


@app.put("/api/admin/recharge-tiers")
@login_required
@admin_required
def admin_recharge_tiers_put(m):
    """保存充值档位。body: {"tiers": [{"price":10,"points":1000}, ...]}
    空数组 = 恢复内置默认档位。"""
    data = request.get_json(silent=True) or {}
    arr = data.get("tiers")
    if not isinstance(arr, list):
        return jsonify({"code": 400, "msg": "tiers 必须为数组"}), 400
    if len(arr) > 20:
        return jsonify({"code": 400, "msg": "档位最多 20 个"}), 400
    clean, seen = [], set()
    for i, t in enumerate(arr):
        try:
            price = int(t.get("price") or 0)
            points = int(t.get("points") or 0)
        except (ValueError, TypeError, AttributeError):
            return jsonify({"code": 400, "msg": "第 %d 行金额/点数格式有误" % (i + 1)}), 400
        if price <= 0 or points <= 0:
            return jsonify({"code": 400, "msg": "第 %d 行金额与点数必须大于 0" % (i + 1)}), 400
        if price in seen:
            return jsonify({"code": 400, "msg": "第 %d 行金额 %d 元重复" % (i + 1, price)}), 400
        seen.add(price)
        clean.append({"price": price, "points": points})
    conn = get_db()
    if clean:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('recharge_tiers',?)",
                     (json.dumps(clean, ensure_ascii=False),))
    else:
        conn.execute("DELETE FROM settings WHERE key='recharge_tiers'")
    conn.commit()
    conn.close()
    admin_log(m, "更新充值档位",
              "自定义 %d 档" % len(clean) if clean else "恢复内置默认档位")
    return jsonify({"code": 0,
                    "msg": ("档位已保存并生效（共 %d 档）" % len(clean)) if clean else "已恢复内置默认档位",
                    "data": {"tiers": recharge_tiers_list(), "custom": bool(clean)}})


def recharge_tiers_list():
    """当前生效的充值档位：settings.recharge_tiers 优先，未配置/非法时用内置默认 6 档"""
    default = [{"price": 10, "points": 1000}, {"price": 30, "points": 3200},
               {"price": 50, "points": 5500}, {"price": 100, "points": 11500},
               {"price": 300, "points": 36000}, {"price": 500, "points": 62000}]
    raw = get_settings().get("recharge_tiers", "")
    if not raw:
        return default
    try:
        arr = json.loads(raw)
        clean = []
        for t in arr:
            price = int(t.get("price") or 0)
            points = int(t.get("points") or 0)
            if price > 0 and points > 0:
                clean.append({"price": price, "points": points})
        return clean or default
    except (ValueError, TypeError, AttributeError):
        return default


@app.get("/api/recharge/tiers")
def recharge_tiers_public():
    """充值档位（商家端公开）：管理后台「充值档位」页可配置"""
    return jsonify({"code": 0, "data": recharge_tiers_list()})


@app.get("/api/merchant/invite-stats")
@login_required
def merchant_invite_stats(m):
    """邀请返利统计：我的邀请码 / 已邀请人数 / 累计奖励点数 / 被邀请列表"""
    conn = get_db()
    invited = conn.execute(
        "SELECT company,phone,status,created_at FROM merchants WHERE invited_by=? AND role='merchant' "
        "ORDER BY id DESC LIMIT 50", (m["invite_code"],)).fetchall()
    reward = conn.execute(
        "SELECT COALESCE(SUM(points),0) FROM transactions WHERE merchant_id=? AND note LIKE '邀请奖励%'",
        (m["id"],)).fetchone()[0]
    conf = get_settings()
    conn.close()
    return jsonify({"code": 0, "data": {
        "invite_code": m["invite_code"],
        "invited_count": len(invited),
        "reward_total": reward,
        "reward_points": int(conf.get("invite_reward_points", "0") or 0),
        "invite_required": conf.get("invite_required") == "1",
        "list": [dict(r) for r in invited],
    }})


@app.get("/api/announcements")
@login_required
def announcements_public(m):
    conn = get_db()
    rows = conn.execute(
        "SELECT id,title,content,level,published_at FROM announcements "
        "WHERE status='published' ORDER BY id DESC LIMIT 10"
    ).fetchall()
    conn.close()
    return jsonify({"code": 0, "data": [dict(r) for r in rows]})


# ======================================================================
# 管理后台 API（全部需要管理员权限）
# ======================================================================
@app.get("/api/admin/stats")
@login_required
@admin_required
def admin_stats(m):
    conn = get_db()

    def one(sql, *args):
        return conn.execute(sql, args).fetchone()[0]

    stats = {
        "merchants": one("SELECT COUNT(*) FROM merchants WHERE role='merchant'"),
        "pending": one("SELECT COUNT(*) FROM merchants WHERE role='merchant' AND status='待审核'"),
        "verified": one("SELECT COUNT(*) FROM merchants WHERE role='merchant' AND status='已认证'"),
        "disabled": one("SELECT COUNT(*) FROM merchants WHERE role='merchant' AND disabled=1"),
        "agents": one("SELECT COUNT(*) FROM agents"),
        "agents_running": one("SELECT COUNT(*) FROM agents WHERE status='running'"),
        "tags": one("SELECT COUNT(*) FROM tags"),
        "tokens": one("SELECT COALESCE(SUM(token_balance),0) FROM merchants WHERE role='merchant'"),
        "recharged": one("SELECT COALESCE(SUM(points),0) FROM transactions WHERE type='recharge'"),
        "consumed": one("SELECT COALESCE(SUM(-points),0) FROM transactions WHERE type='consume'"),
        "tickets_open": one("SELECT COUNT(*) FROM tickets WHERE status<>'已关闭'"),
        "admins": one("SELECT COUNT(*) FROM merchants WHERE role='admin'"),
        "announcements": one("SELECT COUNT(*) FROM announcements WHERE status='published'"),
    }
    # 近 7 日新增商家 / 新增工单
    trend = []
    now_ts = time.time()
    for i in range(6, -1, -1):
        day = time.strftime("%Y-%m-%d", time.localtime(now_ts - i * 86400))
        trend.append({
            "date": day[5:],
            "merchants": conn.execute(
                "SELECT COUNT(*) FROM merchants WHERE role='merchant' AND created_at LIKE ?",
                (day + "%",)).fetchone()[0],
            "tickets": conn.execute(
                "SELECT COUNT(*) FROM tickets WHERE created_at LIKE ?", (day + "%",)).fetchone()[0],
        })
    conn.close()
    stats["trend"] = trend
    return jsonify({"code": 0, "data": stats})


# ---------- 商家管理 ----------
@app.get("/api/admin/merchants")
@login_required
@admin_required
def admin_merchants(m):
    page, size = page_args()
    keyword = (request.args.get("keyword") or "").strip()
    status = (request.args.get("status") or "").strip()
    where, args = ["role='merchant'"], []
    if keyword:
        where.append("(company LIKE ? OR contact LIKE ? OR phone LIKE ? OR email LIKE ?)")
        args += ["%%%s%%" % keyword] * 4
    if status:
        where.append("status=?")
        args.append(status)
    cond = " WHERE " + " AND ".join(where)
    conn = get_db()
    total, rows = paged(
        conn,
        "SELECT COUNT(*) FROM merchants" + cond, args,
        "SELECT id,phone,company,contact,email,industry,scale,province,city,"
        "status,token_balance,disabled,last_login,remark,created_at FROM merchants" + cond + " ORDER BY id DESC",
        args, page, size,
    )
    conn.close()
    return jsonify({"code": 0, "data": {"list": rows, "total": total, "page": page, "pageSize": size}})


@app.get("/api/admin/merchants/<int:merchant_id>")
@login_required
@admin_required
def admin_merchant_detail(m, merchant_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM merchants WHERE id=? AND role='merchant'", (merchant_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "商家不存在"}), 404
    data = dict(row)
    data.pop("password", None)
    data["tx_count"] = conn.execute(
        "SELECT COUNT(*) FROM transactions WHERE merchant_id=?", (merchant_id,)).fetchone()[0]
    data["ticket_count"] = conn.execute(
        "SELECT COUNT(*) FROM tickets WHERE merchant_id=?", (merchant_id,)).fetchone()[0]
    data["recent_tx"] = [dict(r) for r in conn.execute(
        "SELECT * FROM transactions WHERE merchant_id=? ORDER BY id DESC LIMIT 5", (merchant_id,)).fetchall()]
    conn.close()
    return jsonify({"code": 0, "data": data})


@app.post("/api/admin/merchants")
@login_required
@admin_required
def admin_merchant_create(m):
    data = request.get_json(silent=True) or {}
    phone = (data.get("phone") or "").strip()
    password = (data.get("password") or "").strip() or "123456"
    company = (data.get("company") or "").strip()
    if not phone or len(phone) != 11 or not phone.isdigit():
        return jsonify({"code": 400, "msg": "请输入 11 位手机号"}), 400
    if not company:
        return jsonify({"code": 400, "msg": "企业名称必填"}), 400
    conn = get_db()
    if conn.execute("SELECT 1 FROM merchants WHERE phone=?", (phone,)).fetchone():
        conn.close()
        return jsonify({"code": 400, "msg": "该手机号已存在"}), 400
    try:
        points = int(data.get("token_balance") or 0)
    except (TypeError, ValueError):
        points = 0
    cur = conn.execute(
        "INSERT INTO merchants(phone,password,company,contact,email,industry,scale,province,city,"
        "status,token_balance,invite_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (phone, pw_hash(password), company, data.get("contact") or "", data.get("email") or "",
         data.get("industry") or "", data.get("scale") or "", data.get("province") or "",
         data.get("city") or "", data.get("status") or "已认证", points,
         "TG" + uuid.uuid4().hex[:6].upper(), now_str()),
    )
    mid = cur.lastrowid
    if points:
        conn.execute(
            "INSERT INTO transactions(merchant_id,type,points,amount,note,created_at) VALUES(?,?,?,?,?,?)",
            (mid, "recharge", points, 0, "开通时初始点数", now_str()),
        )
    conn.commit()
    row = conn.execute("SELECT * FROM merchants WHERE id=?", (mid,)).fetchone()
    conn.close()
    admin_log(m, "新增商家", company, "手机 %s" % phone)
    return jsonify({"code": 0, "msg": "商家已开通", "data": merchant_dict(row)})


@app.put("/api/admin/merchants/<int:merchant_id>")
@login_required
@admin_required
def admin_merchant_update(m, merchant_id):
    data = request.get_json(silent=True) or {}
    fields = ["company", "contact", "email", "industry", "scale", "province", "city",
              "website", "intro", "status", "remark"]
    sets, vals = [], []
    for f in fields:
        if f in data:
            sets.append("%s=?" % f)
            vals.append(data[f])
    if not sets:
        return jsonify({"code": 0, "msg": "无变更"})
    conn = get_db()
    if not conn.execute("SELECT 1 FROM merchants WHERE id=? AND role='merchant'", (merchant_id,)).fetchone():
        conn.close()
        return jsonify({"code": 404, "msg": "商家不存在"}), 404
    vals.append(merchant_id)
    conn.execute("UPDATE merchants SET %s WHERE id=?" % ",".join(sets), vals)
    conn.commit()
    row = conn.execute("SELECT * FROM merchants WHERE id=?", (merchant_id,)).fetchone()
    conn.close()
    admin_log(m, "编辑商家", row["company"])
    return jsonify({"code": 0, "msg": "保存成功", "data": merchant_dict(row)})


@app.post("/api/admin/merchants/<int:merchant_id>/review")
@login_required
@admin_required
def admin_review(m, merchant_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status") or ""
    if status not in ("已认证", "待审核", "已驳回", "已过期"):
        return jsonify({"code": 400, "msg": "状态不合法"}), 400
    conn = get_db()
    row = conn.execute("SELECT company FROM merchants WHERE id=? AND role='merchant'", (merchant_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "商家不存在"}), 404
    conn.execute("UPDATE merchants SET status=? WHERE id=?", (status, merchant_id))
    conn.commit()
    conn.close()
    admin_log(m, "商家审核", row["company"], "结果：%s" % status)
    return jsonify({"code": 0, "msg": "审核结果已更新", "data": {"id": merchant_id, "status": status}})


@app.post("/api/admin/merchants/<int:merchant_id>/toggle")
@login_required
@admin_required
def admin_merchant_toggle(m, merchant_id):
    conn = get_db()
    row = conn.execute("SELECT company,disabled FROM merchants WHERE id=? AND role='merchant'",
                       (merchant_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "商家不存在"}), 404
    new_val = 0 if row["disabled"] else 1
    conn.execute("UPDATE merchants SET disabled=? WHERE id=?", (new_val, merchant_id))
    if new_val:
        conn.execute("DELETE FROM sessions WHERE merchant_id=?", (merchant_id,))
    conn.commit()
    conn.close()
    admin_log(m, "启用商家" if not new_val else "停用商家", row["company"])
    return jsonify({"code": 0, "msg": "已停用" if new_val else "已启用", "data": {"disabled": new_val}})


@app.post("/api/admin/merchants/<int:merchant_id>/reset-password")
@login_required
@admin_required
def admin_merchant_reset_pwd(m, merchant_id):
    data = request.get_json(silent=True) or {}
    password = (data.get("password") or "").strip()
    if len(password) < 6:
        return jsonify({"code": 400, "msg": "新密码至少 6 位"}), 400
    conn = get_db()
    row = conn.execute("SELECT company FROM merchants WHERE id=? AND role='merchant'", (merchant_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "商家不存在"}), 404
    conn.execute("UPDATE merchants SET password=? WHERE id=?", (pw_hash(password), merchant_id))
    conn.execute("DELETE FROM sessions WHERE merchant_id=?", (merchant_id,))
    conn.commit()
    conn.close()
    admin_log(m, "重置商家密码", row["company"])
    return jsonify({"code": 0, "msg": "密码已重置，该商家需重新登录"})


@app.post("/api/admin/merchants/<int:merchant_id>/points")
@login_required
@admin_required
def admin_merchant_points(m, merchant_id):
    payload = request.get_json(silent=True) or {}
    points = integer(payload, "points", minimum=-1_000_000_000)
    if points == 0:
        return jsonify({"code": 400, "msg": "调整点数不能为0"}), 400
    note = text(payload, "note", maximum=500, required=False)
    balance = platform_billing.adjust(get_core(), merchant_id, points, note or "管理员调整点数")
    admin_log(m, "调整点数", str(merchant_id), "%+d 点（余额 %d）" % (points, balance))
    return jsonify({"code": 0, "msg": "点数已调整", "data": {"balance": balance}})


@app.delete("/api/admin/merchants/<int:merchant_id>")
@login_required
@admin_required
def admin_merchant_delete(m, merchant_id):
    company = identity_management.remove_merchant(get_core(), merchant_id)
    admin_log(m, "删除商家", company)
    return jsonify({"code": 0, "msg": "商家已删除"})


# ---------- 点数与流水 ----------
@app.get("/api/admin/transactions")
@login_required
@admin_required
def admin_transactions(m):
    page, size = page_args(15)
    merchant_id = (request.args.get("merchant_id") or "").strip()
    ttype = (request.args.get("type") or "").strip()
    where, args = ["1=1"], []
    if merchant_id:
        where.append("t.merchant_id=?")
        args.append(merchant_id)
    if ttype:
        where.append("t.type=?")
        args.append(ttype)
    cond = " WHERE " + " AND ".join(where)
    base_from = " FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id"
    conn = get_db()
    total, rows = paged(
        conn,
        "SELECT COUNT(*)" + base_from + cond, args,
        "SELECT t.*, m.company FROM " + base_from.replace(" FROM ", "", 1) + cond + " ORDER BY t.id DESC",
        args, page, size,
    )
    # 汇总
    sums = conn.execute(
        "SELECT COALESCE(SUM(CASE WHEN t.points>0 THEN t.points ELSE 0 END),0) AS inc,"
        "COALESCE(SUM(CASE WHEN t.points<0 THEN -t.points ELSE 0 END),0) AS out"
        + base_from + cond, args).fetchone()
    conn.close()
    return jsonify({"code": 0, "data": {"list": rows, "total": total, "page": page,
                                        "pageSize": size, "income": sums["inc"], "outcome": sums["out"]}})


# ---------- 工单管理 ----------
@app.get("/api/admin/tickets")
@login_required
@admin_required
def admin_tickets(m):
    page, size = page_args(15)
    status = (request.args.get("status") or "").strip()
    keyword = (request.args.get("keyword") or "").strip()
    where, args = ["1=1"], []
    if status:
        where.append("t.status=?")
        args.append(status)
    if keyword:
        where.append("(t.title LIKE ? OR t.content LIKE ? OR m.company LIKE ?)")
        args += ["%%%s%%" % keyword] * 3
    cond = " WHERE " + " AND ".join(where)
    base = " FROM tickets t LEFT JOIN merchants m ON m.id=t.merchant_id"
    conn = get_db()
    total, rows = paged(
        conn, "SELECT COUNT(*)" + base + cond, args,
        "SELECT t.*, m.company, m.phone" + base + cond + " ORDER BY t.id DESC",
        args, page, size,
    )
    counts = {
        "all": conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0],
        "open": conn.execute("SELECT COUNT(*) FROM tickets WHERE status='处理中'").fetchone()[0],
        "closed": conn.execute("SELECT COUNT(*) FROM tickets WHERE status='已关闭'").fetchone()[0],
    }
    conn.close()
    return jsonify({"code": 0, "data": {"list": rows, "total": total, "page": page,
                                        "pageSize": size, "counts": counts}})


@app.post("/api/admin/tickets/<int:ticket_id>/reply")
@login_required
@admin_required
def admin_ticket_reply(m, ticket_id):
    data = request.get_json(silent=True) or {}
    reply = (data.get("reply") or "").strip()
    status = data.get("status") or "已关闭"
    if not reply:
        return jsonify({"code": 400, "msg": "回复内容不能为空"}), 400
    if status not in ("处理中", "已关闭"):
        return jsonify({"code": 400, "msg": "状态不合法"}), 400
    conn = get_db()
    row = conn.execute("SELECT title FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "工单不存在"}), 404
    conn.execute("UPDATE tickets SET reply=?, status=?, replied_at=?, replied_by=? WHERE id=?",
                 (reply, status, now_str(), m["company"] or m["phone"], ticket_id))
    conn.commit()
    conn.close()
    admin_log(m, "回复工单", row["title"], "状态：%s" % status)
    return jsonify({"code": 0, "msg": "回复已提交"})


@app.put("/api/admin/tickets/<int:ticket_id>")
@login_required
@admin_required
def admin_ticket_update(m, ticket_id):
    data = request.get_json(silent=True) or {}
    sets, vals = [], []
    if "status" in data:
        if data["status"] not in ("处理中", "已关闭"):
            return jsonify({"code": 400, "msg": "状态不合法"}), 400
        sets.append("status=?")
        vals.append(data["status"])
    if "priority" in data:
        sets.append("priority=?")
        vals.append(data["priority"])
    if not sets:
        return jsonify({"code": 0, "msg": "无变更"})
    conn = get_db()
    row = conn.execute("SELECT title FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "工单不存在"}), 404
    vals.append(ticket_id)
    conn.execute("UPDATE tickets SET %s WHERE id=?" % ",".join(sets), vals)
    conn.commit()
    conn.close()
    admin_log(m, "更新工单", row["title"])
    return jsonify({"code": 0, "msg": "已更新"})


# ---------- 管理员账号 ----------
@app.get("/api/admin/admins")
@login_required
@admin_required
def admin_accounts(m):
    conn = get_db()
    rows = conn.execute(
        "SELECT id,staff_no,phone,company,contact,status,last_login,created_at FROM merchants "
        "WHERE role='admin' ORDER BY id"
    ).fetchall()
    conn.close()
    return jsonify({"code": 0, "data": [dict(r) for r in rows]})


@app.post("/api/admin/admins")
@login_required
@admin_required
def admin_accounts_create(m):
    data = request.get_json(silent=True) or {}
    phone = (data.get("phone") or "").strip()
    password = (data.get("password") or "").strip()
    name = (data.get("name") or "").strip()
    if not phone or len(phone) != 11 or not phone.isdigit():
        return jsonify({"code": 400, "msg": "请输入 11 位手机号"}), 400
    if len(password) < 6:
        return jsonify({"code": 400, "msg": "密码至少 6 位"}), 400
    if not name:
        return jsonify({"code": 400, "msg": "管理员名称必填"}), 400
    conn = get_db()
    if conn.execute("SELECT 1 FROM merchants WHERE phone=?", (phone,)).fetchone():
        conn.close()
        return jsonify({"code": 400, "msg": "该手机号已存在"}), 400
    # 分配工号：现有最大 ADM 序号 + 1
    mx = 0
    for r in conn.execute(
            "SELECT staff_no FROM merchants WHERE role='admin' AND staff_no LIKE 'ADM%'").fetchall():
        try:
            mx = max(mx, int(r["staff_no"][3:]))
        except ValueError:
            pass
    staff_no = "ADM%03d" % (mx + 1)
    cur = conn.execute(
        "INSERT INTO merchants(phone,password,company,contact,role,status,token_balance,"
        "invite_code,staff_no,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (phone, pw_hash(password), name, name, "admin", "已认证", 0,
         "TG" + uuid.uuid4().hex[:6].upper(), staff_no, now_str()),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id,phone,staff_no,company,contact,status,last_login,created_at FROM merchants WHERE id=?",
        (cur.lastrowid,)).fetchone()
    conn.close()
    admin_log(m, "新增管理员", name, "%s（%s）" % (phone, staff_no))
    return jsonify({"code": 0, "msg": "管理员已创建，工号 " + staff_no, "data": dict(row)})


@app.put("/api/admin/admins/<int:admin_id>")
@login_required
@admin_required
def admin_accounts_update(m, admin_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT company FROM merchants WHERE id=? AND role='admin'", (admin_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "管理员不存在"}), 404
    if "password" in data:
        if len((data["password"] or "").strip()) < 6:
            conn.close()
            return jsonify({"code": 400, "msg": "密码至少 6 位"}), 400
        conn.execute("UPDATE merchants SET password=? WHERE id=?", (pw_hash(data["password"].strip()), admin_id))
        conn.execute("DELETE FROM sessions WHERE merchant_id=?", (admin_id,))
    if data.get("name"):
        conn.execute("UPDATE merchants SET company=?, contact=? WHERE id=?",
                     (data["name"], data["name"], admin_id))
    conn.commit()
    conn.close()
    admin_log(m, "编辑管理员", row["company"])
    return jsonify({"code": 0, "msg": "已保存"})


@app.delete("/api/admin/admins/<int:admin_id>")
@login_required
@admin_required
def admin_accounts_delete(m, admin_id):
    if admin_id == m["id"]:
        return jsonify({"code": 400, "msg": "不能删除当前登录的管理员账号"}), 400
    conn = get_db()
    row = conn.execute("SELECT company FROM merchants WHERE id=? AND role='admin'", (admin_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "管理员不存在"}), 404
    total = conn.execute("SELECT COUNT(*) FROM merchants WHERE role='admin'").fetchone()[0]
    if total <= 1:
        conn.close()
        return jsonify({"code": 400, "msg": "至少保留一个管理员账号"}), 400
    conn.execute("DELETE FROM sessions WHERE merchant_id=?", (admin_id,))
    conn.execute("DELETE FROM merchants WHERE id=?", (admin_id,))
    conn.commit()
    conn.close()
    admin_log(m, "删除管理员", row["company"])
    return jsonify({"code": 0, "msg": "管理员已删除"})


# ---------- 公告管理 ----------
@app.get("/api/admin/announcements")
@login_required
@admin_required
def admin_announcements(m):
    conn = get_db()
    rows = conn.execute("SELECT * FROM announcements ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify({"code": 0, "data": [dict(r) for r in rows]})


@app.post("/api/admin/announcements")
@login_required
@admin_required
def admin_announcements_create(m):
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"code": 400, "msg": "公告标题不能为空"}), 400
    status = data.get("status") or "draft"
    if status not in ("draft", "published", "offline"):
        status = "draft"
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO announcements(title,content,level,status,published_at,created_at) "
        "VALUES(?,?,?,?,?,?)",
        (title, data.get("content") or "", data.get("level") or "普通", status,
         now_str() if status == "published" else "", now_str()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM announcements WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    admin_log(m, "发布公告" if status == "published" else "新建公告", title)
    return jsonify({"code": 0, "msg": "已保存", "data": dict(row)})


@app.put("/api/admin/announcements/<int:aid>")
@login_required
@admin_required
def admin_announcements_update(m, aid):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM announcements WHERE id=?", (aid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "公告不存在"}), 404
    title = (data.get("title") or row["title"]).strip()
    status = data.get("status") or row["status"]
    if status not in ("draft", "published", "offline"):
        return jsonify({"code": 400, "msg": "状态不合法"}), 400
    published_at = row["published_at"]
    if status == "published" and not published_at:
        published_at = now_str()
    conn.execute(
        "UPDATE announcements SET title=?, content=?, level=?, status=?, published_at=? WHERE id=?",
        (title, data.get("content", row["content"]), data.get("level") or row["level"],
         status, published_at, aid),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM announcements WHERE id=?", (aid,)).fetchone()
    conn.close()
    admin_log(m, "编辑公告", title)
    return jsonify({"code": 0, "msg": "已保存", "data": dict(row)})


@app.post("/api/admin/announcements/<int:aid>/toggle")
@login_required
@admin_required
def admin_announcements_toggle(m, aid):
    conn = get_db()
    row = conn.execute("SELECT * FROM announcements WHERE id=?", (aid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "公告不存在"}), 404
    if row["status"] == "published":
        conn.execute("UPDATE announcements SET status='offline' WHERE id=?", (aid,))
        msg = "已下线"
    else:
        conn.execute("UPDATE announcements SET status='published', published_at=? WHERE id=?",
                     (now_str(), aid))
        msg = "已发布"
    conn.commit()
    conn.close()
    admin_log(m, msg, row["title"])
    return jsonify({"code": 0, "msg": msg})


@app.delete("/api/admin/announcements/<int:aid>")
@login_required
@admin_required
def admin_announcements_delete(m, aid):
    conn = get_db()
    row = conn.execute("SELECT title FROM announcements WHERE id=?", (aid,)).fetchone()
    conn.execute("DELETE FROM announcements WHERE id=?", (aid,))
    conn.commit()
    conn.close()
    admin_log(m, "删除公告", row["title"] if row else "ID %s" % aid)
    return jsonify({"code": 0, "msg": "已删除"})


# ---------- 系统设置 ----------
@app.get("/api/admin/settings")
@login_required
@admin_required
def admin_settings_get(m):
    return jsonify({"code": 0, "data": safe_admin_settings()})


def safe_admin_settings():
    allowed = {"platform_name", "slogan", "service_phone", "address", "service_time",
               "register_open", "default_points", "review_mode", "invite_required", "invite_reward_points"}
    return {key: value for key, value in get_settings().items() if key in allowed}


@app.put("/api/admin/settings")
@login_required
@admin_required
def admin_settings_put(m):
    data = request.get_json(silent=True) or {}
    allowed = {"platform_name", "slogan", "service_phone", "address", "service_time",
               "register_open", "default_points", "review_mode",
               "invite_required", "invite_reward_points"}
    conn = get_db()
    changed = []
    for k, v in data.items():
        if k not in allowed:
            continue
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (k, str(v)))
        changed.append(k)
    conn.commit()
    conn.close()
    admin_log(m, "更新系统设置", ",".join(changed))
    return jsonify({"code": 0, "msg": "设置已保存", "data": safe_admin_settings()})


# ---------- 操作日志 ----------
@app.get("/api/admin/logs")
@login_required
@admin_required
def admin_logs(m):
    page, size = page_args(20)
    conn = get_db()
    total, rows = paged(
        conn, "SELECT COUNT(*) FROM logs", [],
        "SELECT * FROM logs ORDER BY id DESC", [], page, size,
    )
    conn.close()
    return jsonify({"code": 0, "data": {"list": rows, "total": total, "page": page, "pageSize": size}})


# ---------- 数据导出 ----------
@app.get("/api/admin/export/<kind>")
@login_required
@admin_required
def admin_export(m, kind):
    conn = get_db()
    if kind == "merchants":
        rows = conn.execute(
            "SELECT id,company,contact,phone,email,industry,status,token_balance,created_at "
            "FROM merchants WHERE role='merchant' ORDER BY id").fetchall()
        header = ["ID", "企业名称", "联系人", "手机", "邮箱", "行业", "认证状态", "点数", "注册时间"]
    elif kind == "transactions":
        rows = conn.execute(
            "SELECT t.id,m.company,t.type,t.points,t.amount,t.note,t.created_at "
            "FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id ORDER BY t.id DESC").fetchall()
        header = ["ID", "商家", "类型", "点数", "金额", "备注", "时间"]
    elif kind == "tickets":
        rows = conn.execute(
            "SELECT t.id,m.company,t.title,t.category,t.priority,t.status,t.created_at "
            "FROM tickets t LEFT JOIN merchants m ON m.id=t.merchant_id ORDER BY t.id DESC").fetchall()
        header = ["ID", "商家", "标题", "分类", "优先级", "状态", "提交时间"]
    else:
        conn.close()
        return jsonify({"code": 400, "msg": "不支持的导出类型"}), 400
    conn.close()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for r in rows:
        writer.writerow(["" if v is None else v for v in list(r)])
    data = "\ufeff" + buf.getvalue()
    admin_log(m, "导出数据", kind, "共 %d 条" % len(rows))
    return Response(
        data, content_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=taikua-%s.csv" % kind},
    )


# ----------------------------------------------------------------------
# 管理端：兑换码（点卡）管理
# ----------------------------------------------------------------------
@app.get("/api/admin/redeem-codes")
@login_required
@admin_required
def admin_redeem_list(m):
    page, size = page_args(15)
    status = (request.args.get("status") or "").strip()
    keyword = (request.args.get("keyword") or "").strip()
    batch = (request.args.get("batch") or "").strip()

    cond, args = [], []
    if status in ("unused", "used", "void"):
        cond.append("r.status=?")
        args.append(status)
    if batch:
        cond.append("r.batch=?")
        args.append(batch)
    if keyword:
        cond.append("(r.code LIKE ? OR m.company LIKE ? OR r.remark LIKE ? OR r.batch LIKE ?)")
        args += ["%" + redeem_norm(keyword) + "%", "%" + keyword + "%",
                 "%" + keyword + "%", "%" + keyword + "%"]
    where = (" WHERE " + " AND ".join(cond)) if cond else ""
    base = " FROM redeem_codes r LEFT JOIN merchants m ON m.id=r.merchant_id" + where

    conn = get_db()
    total, rows = paged(
        conn, "SELECT COUNT(*)" + base, args,
        "SELECT r.*, m.company AS merchant_name, m.phone AS merchant_phone" + base + " ORDER BY r.id DESC",
        args, page, size,
    )
    for r in rows:
        r["code_fmt"] = redeem_fmt(r["code"])
        r["state"] = redeem_state(r)

    st = conn.execute(
        "SELECT COUNT(*) AS total,"
        " COALESCE(SUM(CASE WHEN status='unused' THEN 1 ELSE 0 END),0) AS unused,"
        " COALESCE(SUM(CASE WHEN status='used' THEN 1 ELSE 0 END),0) AS used,"
        " COALESCE(SUM(CASE WHEN status='void' THEN 1 ELSE 0 END),0) AS void,"
        " COALESCE(SUM(CASE WHEN status='unused' THEN points ELSE 0 END),0) AS unused_points,"
        " COALESCE(SUM(CASE WHEN status='used' THEN points ELSE 0 END),0) AS used_points"
        " FROM redeem_codes").fetchone()
    batches = [x[0] for x in conn.execute(
        "SELECT batch FROM redeem_codes WHERE batch<>'' GROUP BY batch ORDER BY batch DESC LIMIT 40"
    ).fetchall()]
    conn.close()
    st = dict(st)
    st["used_amount"] = round(sum(
        (r["price"] or 0) for r in rows if r["status"] == "used"), 2)
    return jsonify({"code": 0, "data": {
        "list": rows, "total": total, "page": page, "pageSize": size,
        "stats": st, "batches": batches, "presets": REDEEM_PRESETS,
    }})


@app.post("/api/admin/redeem-codes/generate")
@login_required
@admin_required
def admin_redeem_generate(m):
    data = request.get_json(silent=True) or {}
    try:
        points = int(data.get("points") or 0)
        count = int(data.get("count") or 0)
        price = float(data.get("price") or 0)
    except (TypeError, ValueError):
        return jsonify({"code": 400, "msg": "面额、售价、数量必须是数字"}), 400
    if points <= 0:
        return jsonify({"code": 400, "msg": "点卡面额必须大于 0"}), 400
    if points > 1000000:
        return jsonify({"code": 400, "msg": "单张面额不能超过 1,000,000 点"}), 400
    if not (1 <= count <= 500):
        return jsonify({"code": 400, "msg": "单次生成数量需在 1 - 500 张之间"}), 400
    try:
        days = int(data.get("expire_days") or 0)
    except (TypeError, ValueError):
        days = 0
    expire_at = ""
    if days > 0:
        expire_at = time.strftime("%Y-%m-%d %H:%M:%S",
                                  time.localtime(time.time() + days * 86400))
    remark = (data.get("remark") or "").strip()[:100]
    batch = "PC" + time.strftime("%Y%m%d%H%M%S")

    conn = get_db()
    made = []
    for _ in range(count):
        for _try in range(8):
            code = redeem_new_code()
            cur = conn.execute(
                "INSERT OR IGNORE INTO redeem_codes"
                "(code,points,price,batch,status,expire_at,remark,created_by,created_at)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (code, points, price, batch, "unused", expire_at, remark,
                 m["company"] or m["phone"], now_str()))
            if cur.rowcount == 1:
                made.append(code)
                break
    conn.commit()
    conn.close()
    admin_log(m, "生成兑换码", batch, "%d 张 · %d 点/张" % (len(made), points))
    return jsonify({
        "code": 0,
        "msg": "已生成 %d 张点卡（%s 点/张）" % (len(made), points),
        "data": {"batch": batch, "points": points, "price": price,
                 "codes": [redeem_fmt(c) for c in made]},
    })


@app.post("/api/admin/redeem-codes/<int:rid>/void")
@login_required
@admin_required
def admin_redeem_void(m, rid):
    conn = get_db()
    row = conn.execute("SELECT * FROM redeem_codes WHERE id=?", (rid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "兑换码不存在"}), 404
    if row["status"] == "used":
        conn.close()
        return jsonify({"code": 400, "msg": "已兑换的卡密无法作废"}), 400
    conn.execute("UPDATE redeem_codes SET status='void' WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    admin_log(m, "作废兑换码", redeem_fmt(row["code"]), "%s 点" % row["points"])
    return jsonify({"code": 0, "msg": "已作废"})


@app.post("/api/admin/redeem-codes/<int:rid>/restore")
@login_required
@admin_required
def admin_redeem_restore(m, rid):
    conn = get_db()
    row = conn.execute("SELECT * FROM redeem_codes WHERE id=?", (rid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "兑换码不存在"}), 404
    if row["status"] == "used":
        conn.close()
        return jsonify({"code": 400, "msg": "已兑换的卡密无法恢复"}), 400
    conn.execute("UPDATE redeem_codes SET status='unused' WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    admin_log(m, "恢复兑换码", redeem_fmt(row["code"]), "%s 点" % row["points"])
    return jsonify({"code": 0, "msg": "已恢复为未使用"})


@app.delete("/api/admin/redeem-codes/<int:rid>")
@login_required
@admin_required
def admin_redeem_delete(m, rid):
    conn = get_db()
    row = conn.execute("SELECT * FROM redeem_codes WHERE id=?", (rid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "兑换码不存在"}), 404
    if row["status"] == "used":
        conn.close()
        return jsonify({"code": 400, "msg": "已兑换的卡密不能删除（保留资金流水追溯）"}), 400
    conn.execute("DELETE FROM redeem_codes WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    admin_log(m, "删除兑换码", redeem_fmt(row["code"]), "%s 点" % row["points"])
    return jsonify({"code": 0, "msg": "已删除"})


@app.post("/api/admin/redeem-codes/batch-delete")
@login_required
@admin_required
def admin_redeem_batch_delete(m):
    """批量删除兑换码：已兑换的自动跳过，返回删除/跳过数量"""
    data = request.get_json(silent=True) or {}
    ids = data.get("ids")
    if not isinstance(ids, list) or not ids:
        return jsonify({"code": 400, "msg": "请先勾选要删除的兑换码"}), 400
    clean = []
    for x in ids[:500]:
        try:
            v = int(x)
        except (TypeError, ValueError):
            continue
        if v > 0:
            clean.append(v)
    if not clean:
        return jsonify({"code": 400, "msg": "没有有效的兑换码"}), 400

    conn = get_db()
    marks = ",".join("?" * len(clean))
    rows = conn.execute(
        "SELECT id,code,points,status FROM redeem_codes WHERE id IN (%s)" % marks,
        clean).fetchall()
    del_ids = [r["id"] for r in rows if r["status"] != "used"]
    skipped = len(rows) - len(del_ids)
    deleted = 0
    if del_ids:
        mks = ",".join("?" * len(del_ids))
        cur = conn.execute("DELETE FROM redeem_codes WHERE id IN (%s)" % mks, del_ids)
        deleted = cur.rowcount
    conn.commit()
    conn.close()
    admin_log(m, "批量删除兑换码", "%d 张" % deleted, "跳过已兑换 %d 张" % skipped)
    msg = "已删除 %d 张" % deleted
    if skipped:
        msg += "，%d 张已兑换不可删除（已跳过）" % skipped
    return jsonify({"code": 0, "msg": msg, "data": {"deleted": deleted, "skipped": skipped}})


@app.get("/api/admin/redeem-codes/export")
@login_required
@admin_required
def admin_redeem_export(m):
    status = (request.args.get("status") or "").strip()
    batch = (request.args.get("batch") or "").strip()
    cond, args = [], []
    if status in ("unused", "used", "void"):
        cond.append("r.status=?")
        args.append(status)
    if batch:
        cond.append("r.batch=?")
        args.append(batch)
    where = (" WHERE " + " AND ".join(cond)) if cond else ""
    conn = get_db()
    rows = conn.execute(
        "SELECT r.code, r.points, r.price, r.batch, r.status, m.company,"
        " r.used_at, r.expire_at, r.remark, r.created_at"
        " FROM redeem_codes r LEFT JOIN merchants m ON m.id=r.merchant_id"
        + where + " ORDER BY r.id DESC", args).fetchall()
    conn.close()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["卡密", "点数", "售价(元)", "批次", "状态", "使用商家", "使用时间", "过期时间", "备注", "创建时间"])
    label = {"unused": "未使用", "used": "已使用", "void": "已作废"}
    for r in rows:
        writer.writerow([
            redeem_fmt(r["code"]), r["points"], r["price"] or 0, r["batch"],
            label.get(r["status"], r["status"]), r["company"] or "",
            r["used_at"] or "", r["expire_at"] or "", r["remark"] or "",
            r["created_at"] or "",
        ])
    data = "\ufeff" + buf.getvalue()
    admin_log(m, "导出兑换码", "redeem", "共 %d 条" % len(rows))
    return Response(
        data, content_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=taikua-redeem-codes.csv"},
    )


# ----------------------------------------------------------------------
# 健康检查 / 关于
# ----------------------------------------------------------------------
@app.get("/api/about")
def about():
    conf = get_settings()
    return jsonify({
        "code": 0,
        "data": {
            "name": conf.get("platform_name", "泰卦智能"),
            "slogan": conf.get("slogan", "让销售工作流更智能、更高效"),
            "intro": "泰卦智能是销售智能体平台。以 Asalegent 平台和泰卦智能硬件为核心，"
                     "通过软硬一体的智能体解决方案赋能企业销售，让销售工作流更智能、更高效。",
            "address": conf.get("address", ""),
            "phone": conf.get("service_phone", ""),
            "service_time": conf.get("service_time", ""),
        },
    })


@app.get("/api/health")
def health():
    conn = get_db()
    ok = conn.execute("SELECT 1").fetchone() is not None
    conn.close()
    return jsonify({"code": 0, "msg": "ok" if ok else "error", "service": "taikua-merchant-platform",
                    "time": now_str()})



# ======================================================================
# 在线客服子系统（用户会话 / 客服工作台 / AI 知识库）
# ======================================================================
CS_LOCK = threading.Lock()
CS_QUICK_REPLIES = [
    "您好，我是泰卦智能人工客服，很高兴为您服务，请描述一下遇到的问题～",
    "稍等，我帮您核实一下账户信息。",
    "已为您记录，我们会尽快处理，处理结果会同步到工单里。",
    "这个问题需要技术同事跟进，我已帮您创建工单，预计 1 个工作日内回复。",
    "感谢您的耐心等待，还有其他可以帮您的吗？",
    "如暂时无需其他帮助，我先为您结束本次会话，后续可随时在客服中心重新发起。",
]


def cs_agent_from_request():
    """解析客服身份（工号登录后签发的 CS Token）"""
    token = request.headers.get("X-CS-Token", "") or request.args.get("cs_token", "")
    if not token:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT a.*, t.created_at AS _token_created FROM cs_agent_tokens t "
        "JOIN cs_agents a ON a.id=t.agent_id WHERE t.token=?",
        (token,),
    ).fetchone()
    if row:
        created = _parse_ts(row["_token_created"])
        if created and time.time() - created > SESSION_TTL_DAYS * 86400:
            conn.execute("DELETE FROM cs_agent_tokens WHERE token=?", (token,))
            conn.commit()
            conn.close()
            return None
    conn.close()
    return row


def cs_login_required(fn):
    def wrapper(*args, **kwargs):
        a = cs_agent_from_request()
        if not a:
            return jsonify({"code": 401, "msg": "客服登录已失效，请重新登录"}), 401
        if a["disabled"]:
            return jsonify({"code": 403, "msg": "该客服账号已被停用"}), 403
        return fn(a, *args, **kwargs)

    wrapper.__name__ = fn.__name__
    return wrapper


def cs_agent_dict(a):
    return {
        "id": a["id"], "no": a["no"], "name": a["name"], "phone": a["phone"],
        "email": a["email"], "role": a["role"], "status": a["status"],
        "disabled": a["disabled"], "last_active": a["last_active"],
        "created_at": a["created_at"],
    }


def cs_add_message(conn, session_id, sender, content, agent_id=None):
    """写入一条会话消息，并同步会话的最后一条消息"""
    ts = now_str()
    cur = conn.execute(
        "INSERT INTO cs_messages(session_id,sender,agent_id,content,created_at) VALUES(?,?,?,?,?)",
        (session_id, sender, agent_id, content, ts),
    )
    conn.execute(
        "UPDATE cs_sessions SET last_msg=?, last_msg_at=? WHERE id=?",
        ((content or "")[:120], ts, session_id),
    )
    return cur.lastrowid


def cs_session_payload(conn, row, with_merchant=True):
    d = dict(row)
    if with_merchant:
        m = conn.execute(
            "SELECT id,phone,company,contact,email,status,token_balance,created_at "
            "FROM merchants WHERE id=?", (row["merchant_id"],)
        ).fetchone()
        d["merchant"] = dict(m) if m else None
    if row["agent_id"]:
        ag = conn.execute("SELECT id,no,name FROM cs_agents WHERE id=?", (row["agent_id"],)).fetchone()
        d["agent"] = dict(ag) if ag else None
    else:
        d["agent"] = None
    return d


def cs_open_session(conn, merchant_id, create=True):
    row = conn.execute(
        "SELECT * FROM cs_sessions WHERE merchant_id=? AND status<>'closed' ORDER BY id DESC LIMIT 1",
        (merchant_id,),
    ).fetchone()
    if row or not create:
        return row
    conf = get_settings()
    ts = now_str()
    cur = conn.execute(
        "INSERT INTO cs_sessions(merchant_id,status,mode,subject,created_at,last_msg_at) "
        "VALUES(?,?,?,?,?,?)",
        (merchant_id, "ai", "ai", "", ts, ts),
    )
    sid = cur.lastrowid
    cs_add_message(conn, sid, "ai", conf.get("cs_welcome") or "您好，请问有什么可以帮您？")
    conn.commit()
    return conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()


# ----------------------------------------------------------------------
# 知识库检索（轻量中文 2-gram 匹配，无需额外依赖）
# ----------------------------------------------------------------------
def kb_gram(text):
    t = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]+", "", text or "").lower()
    if not t:
        return set()
    if len(t) < 2:
        return {t}
    return {t[i:i + 2] for i in range(len(t) - 1)}


def kb_search(conn, query, topk=3):
    rows = conn.execute("SELECT * FROM kb_entries WHERE status=1").fetchall()
    q = (query or "").lower()
    qg = kb_gram(query)
    if not qg:
        return []
    scored = []
    for r in rows:
        d = dict(r)
        score = len(qg & kb_gram("%s%s%s" % (d["question"], d["answer"], d["keywords"])))
        for kw in re.split(r"[,，、;；\s]+", d["keywords"] or ""):
            kw = kw.strip().lower()
            if kw and kw in q:
                score += 6
        if d["question"] and len(d["question"]) >= 4 and d["question"].lower() in q:
            score += 10
        if score >= 4:
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:max(1, min(10, topk))]]


def kb_bump(conn, entry_id):
    conn.execute("UPDATE kb_entries SET hits=hits+1 WHERE id=?", (entry_id,))


# ----------------------------------------------------------------------
# AI 模型调用（OpenAI 兼容 /chat/completions，支持 DeepSeek / OpenAI / 通义等）
# ----------------------------------------------------------------------
def ai_chat(conf, messages, timeout=45):
    base = (conf.get("ai_base_url") or "https://api.deepseek.com/v1").strip().rstrip("/")
    key = (conf.get("ai_api_key") or "").strip()
    model = (conf.get("ai_model") or "deepseek-chat").strip()
    if not key:
        return None, "未配置 API 密钥"
    if not base.startswith("http"):
        return None, "API 地址格式不正确（需以 http:// 或 https:// 开头）"
    try:
        temperature = float(conf.get("ai_temperature") or 0.3)
    except (TypeError, ValueError):
        temperature = 0.3
    url = base + "/chat/completions"
    body = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": max(0.0, min(2.0, temperature)),
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        content = (content or "").strip()
        if not content:
            return None, "模型返回内容为空"
        return content, None
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "ignore")[:200]
        except Exception:
            pass
        return None, "AI 接口返回 HTTP %s %s" % (e.code, detail)
    except urllib.error.URLError as e:
        return None, "无法连接 AI 接口：%s" % (e.reason,)
    except Exception as e:  # noqa: BLE001
        return None, "AI 接口调用异常：%s" % (e,)


def cs_ai_answer(conn, conf, question, history):
    """返回 (回复内容, 来源 ai/kb/fallback, 错误信息)"""
    hits = []
    try:
        topk = int(conf.get("kb_topk") or 3)
    except (TypeError, ValueError):
        topk = 3
    if conf.get("kb_enabled", "1") == "1":
        hits = kb_search(conn, question, topk)

    ai_on = conf.get("ai_enabled", "1") == "1"
    has_key = bool((conf.get("ai_api_key") or "").strip())

    # 关闭 AI 或未配置密钥时：走知识库
    if not ai_on or not has_key:
        if hits:
            kb_bump(conn, hits[0]["id"])
            return hits[0]["answer"], "kb", "" if ai_on else "AI 已关闭，使用知识库"
        if not has_key:
            return ("您好，AI 客服尚未接入模型，暂时无法自动应答。"
                    "您可以点击「转人工」等待人工客服，或在客服中心提交工单。"), "fallback", "未配置 AI 密钥"
        return (conf.get("cs_offline") or "这个问题我暂时没有答案，建议您点击「转人工」。"), "fallback", ""

    kb_text = "\n".join(
        "【%d】Q: %s\nA: %s" % (i + 1, h["question"], h["answer"]) for i, h in enumerate(hits)
    ) or "（本次提问未命中知识库条目，请基于常识谨慎作答，不确定就引导用户转人工）"

    messages = [{
        "role": "system",
        "content": (conf.get("ai_system_prompt") or "你是泰卦智能的在线客服助手，用中文简洁作答。")
                   + "\n\n【知识库参考】\n" + kb_text,
    }]
    for h in (history or [])[-8:]:
        if h["sender"] == "user":
            messages.append({"role": "user", "content": h["content"]})
        elif h["sender"] in ("ai", "agent"):
            messages.append({"role": "assistant", "content": h["content"]})
    messages.append({"role": "user", "content": question})

    reply, err = ai_chat(conf, messages)
    if reply:
        if hits:
            kb_bump(conn, hits[0]["id"])
        return reply, "ai", ""
    if hits:
        kb_bump(conn, hits[0]["id"])
        return hits[0]["answer"], "kb", err or ""
    return ("AI 客服暂时不可用，您的问题已记录。点击右上角「转人工」可等待人工客服接入，"
            "也可以提交工单，我们会在 1 个工作日内跟进。"), "fallback", err or ""


# ----------------------------------------------------------------------
# 用户侧（商家登录态）
# ----------------------------------------------------------------------
@app.get("/api/cs/session")
@login_required
def cs_session_get(m):
    conn = get_db()
    row = cs_open_session(conn, m["id"])
    msgs = conn.execute(
        "SELECT * FROM cs_messages WHERE session_id=? ORDER BY id", (row["id"],)
    ).fetchall()
    conn.execute("UPDATE cs_sessions SET unread_user=0 WHERE id=?", (row["id"],))
    conn.commit()
    d = cs_session_payload(conn, row)
    d["unread_user"] = 0
    conn.close()
    conf = get_settings()
    return jsonify({"code": 0, "data": {
        "session": d,
        "messages": [dict(x) for x in msgs],
        "ai_enabled": conf.get("ai_enabled", "1") == "1" and bool((conf.get("ai_api_key") or "").strip()),
        "service_time": conf.get("service_time", ""),
    }})


@app.post("/api/cs/send")
@login_required
def cs_send(m):
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"code": 400, "msg": "消息不能为空"}), 400
    if len(content) > 2000:
        return jsonify({"code": 400, "msg": "单条消息不能超过 2000 字"}), 400

    conf = get_settings()
    conn = get_db()
    row = cs_open_session(conn, m["id"])
    sid = row["id"]

    history = [dict(x) for x in conn.execute(
        "SELECT * FROM cs_messages WHERE session_id=? ORDER BY id", (sid,)
    ).fetchall()]

    cs_add_message(conn, sid, "user", content)
    conn.execute(
        "UPDATE cs_sessions SET unread_agent=unread_agent+1, subject=?, last_msg_at=? WHERE id=?",
        (row["subject"] or content[:30], now_str(), sid),
    )
    conn.commit()

    source, ai_err = "", ""
    if row["status"] in ("ai", "pending") and row["mode"] == "ai":
        ai_text, source, ai_err = cs_ai_answer(conn, conf, content, history)
        cs_add_message(conn, sid, "ai", ai_text)
        conn.execute("UPDATE cs_sessions SET unread_user=unread_user+1 WHERE id=?", (sid,))
        conn.commit()
    elif row["status"] == "pending":
        # 已转人工但客服未接入：给一句安抚，避免用户觉得没人管
        last = conn.execute(
            "SELECT content FROM cs_messages WHERE session_id=? AND sender='system' ORDER BY id DESC LIMIT 1",
            (sid,),
        ).fetchone()
        if not last:
            cs_add_message(conn, sid, "system", "您已进入人工排队，客服接入后会立刻回复您。")
            conn.commit()

    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()
    msgs = conn.execute("SELECT * FROM cs_messages WHERE session_id=? ORDER BY id", (sid,)).fetchall()
    d = cs_session_payload(conn, row)
    conn.close()
    return jsonify({"code": 0, "data": {
        "session": d, "messages": [dict(x) for x in msgs],
        "source": source, "ai_error": ai_err,
    }})


@app.get("/api/cs/poll")
@login_required
def cs_poll(m):
    try:
        since = int(request.args.get("since", 0))
    except (TypeError, ValueError):
        since = 0
    conn = get_db()
    row = cs_open_session(conn, m["id"], create=False)
    if not row:
        # 会话已被客服结束：返回最后一条已结束会话，由前端提示「重新咨询」
        row = conn.execute(
            "SELECT * FROM cs_sessions WHERE merchant_id=? ORDER BY id DESC LIMIT 1",
            (m["id"],)).fetchone()
        if not row:
            conn.close()
            return jsonify({"code": 0, "data": {"session": None, "messages": []}})
        d = cs_session_payload(conn, row)
        if row["unread_user"]:
            conn.execute("UPDATE cs_sessions SET unread_user=0 WHERE id=?", (row["id"],))
            conn.commit()
        conn.close()
        return jsonify({"code": 0, "data": {"session": d, "messages": []}})
    msgs = conn.execute(
        "SELECT * FROM cs_messages WHERE session_id=? AND id>? ORDER BY id", (row["id"], since)
    ).fetchall()
    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (row["id"],)).fetchone()
    if row["unread_user"]:
        conn.execute("UPDATE cs_sessions SET unread_user=0 WHERE id=?", (row["id"],))
        conn.commit()
    d = cs_session_payload(conn, row)
    d["unread_user"] = 0
    conn.close()
    return jsonify({"code": 0, "data": {"session": d, "messages": [dict(x) for x in msgs]}})


@app.post("/api/cs/human")
@login_required
def cs_request_human(m):
    conn = get_db()
    row = cs_open_session(conn, m["id"])
    sid = row["id"]
    if row["status"] == "human" and row["agent_id"]:
        agent = conn.execute("SELECT name FROM cs_agents WHERE id=?", (row["agent_id"],)).fetchone()
        conn.close()
        return jsonify({"code": 0, "msg": "人工客服已在线", "data": {
            "status": "human", "agent": dict(agent) if agent else None}})
    if row["status"] == "human":
        conn.close()
        return jsonify({"code": 0, "msg": "人工客服接入中", "data": {"status": "human"}})
    conn.execute("UPDATE cs_sessions SET mode='human', status='pending' WHERE id=?", (sid,))
    cs_add_message(conn, sid, "system", "已为您转接人工客服，正在为您排队，请稍候…")
    conn.execute("UPDATE cs_sessions SET unread_agent=unread_agent+1 WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "已提交转人工请求", "data": {"status": "pending"}})


@app.post("/api/cs/close")
@login_required
def cs_close(m):
    conn = get_db()
    row = cs_open_session(conn, m["id"])
    if row["status"] != "closed":
        conn.execute("UPDATE cs_sessions SET status='closed', closed_at=? WHERE id=?",
                     (now_str(), row["id"]))
        cs_add_message(conn, row["id"], "system", "会话已结束，感谢您的咨询。")
        conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "会话已结束"})


@app.post("/api/cs/rate")
@login_required
def cs_rate(m):
    data = request.get_json(silent=True) or {}
    try:
        rating = int(data.get("rating", 0))
    except (TypeError, ValueError):
        rating = 0
    rating = max(0, min(5, rating))
    conn = get_db()
    row = cs_open_session(conn, m["id"])
    conn.execute("UPDATE cs_sessions SET rating=?, remark=? WHERE id=?",
                 (rating, (data.get("remark") or "")[:200], row["id"]))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "感谢您的评价"})


# ----------------------------------------------------------------------
# 客服侧（工号 + 密码登录）
# ----------------------------------------------------------------------
@app.post("/api/cs/login")
def cs_login():
    data = request.get_json(silent=True) or {}
    no = (data.get("no") or "").strip().upper()
    pwd = (data.get("password") or "").strip()
    if not no or not pwd:
        return jsonify({"code": 400, "msg": "请输入工号与密码"}), 400
    conn = get_db()
    a = conn.execute("SELECT * FROM cs_agents WHERE UPPER(no)=?", (no,)).fetchone()
    if not a:
        conn.close()
        return jsonify({"code": 404, "msg": "工号不存在，请联系主管开通"}), 404
    if a["disabled"]:
        conn.close()
        return jsonify({"code": 403, "msg": "该工号已停用，请联系主管"}), 403
    ok, up = pw_verify(pwd or "", a["password"])
    if not ok:
        conn.close()
        return jsonify({"code": 400, "msg": "工号或密码不正确"}), 400
    if up:
        conn.execute("UPDATE cs_agents SET password=? WHERE id=?", (pw_hash(pwd), a["id"]))
    token = uuid.uuid4().hex
    conn.execute("INSERT INTO cs_agent_tokens(token,agent_id,created_at) VALUES(?,?,?)",
                 (token, a["id"], now_str()))
    conn.execute("UPDATE cs_agents SET status='online', last_active=? WHERE id=?",
                 (now_str(), a["id"]))
    conn.commit()
    a = conn.execute("SELECT * FROM cs_agents WHERE id=?", (a["id"],)).fetchone()
    conn.close()
    return jsonify({"code": 0, "msg": "登录成功", "data": {
        "token": token, "agent": cs_agent_dict(a)}})


@app.get("/api/cs/agent/me")
@cs_login_required
def cs_agent_me(a):
    return jsonify({"code": 0, "data": cs_agent_dict(a)})


@app.post("/api/cs/agent/logout")
@cs_login_required
def cs_agent_logout(a):
    token = request.headers.get("X-CS-Token", "") or request.args.get("cs_token", "")
    conn = get_db()
    conn.execute("DELETE FROM cs_agent_tokens WHERE token=?", (token,))
    conn.execute("UPDATE cs_agents SET status='offline' WHERE id=?", (a["id"],))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "已退出"})


@app.post("/api/cs/agent/heartbeat")
@cs_login_required
def cs_agent_heartbeat(a):
    conn = get_db()
    conn.execute("UPDATE cs_agents SET status='online', last_active=? WHERE id=?",
                 (now_str(), a["id"]))
    conn.commit()
    conn.close()
    return jsonify({"code": 0})


@app.get("/api/cs/agent/poll")
@cs_login_required
def cs_agent_poll(a):
    """客服工作台一体化轮询：一次请求返回 会话列表 + 角标统计 + 我的统计 + 当前会话增量消息。
    前端每 2.5s 只发这一个请求，避免多请求堆积把连接池占满。"""
    try:
        since = int(request.args.get("since", 0) or 0)
    except (TypeError, ValueError):
        since = 0
    try:
        cur_id = int(request.args.get("session_id", 0) or 0)
    except (TypeError, ValueError):
        cur_id = 0

    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM cs_sessions WHERE status<>'closed' AND (agent_id IS NULL OR agent_id=?) "
        "ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'human' THEN 1 ELSE 2 END,"
        " last_msg_at DESC, id DESC",
        (a["id"],)).fetchall()

    # 批量取商家 / 客服，避免逐行查询（N+1）
    mids = sorted({r["merchant_id"] for r in rows if r["merchant_id"]})
    aids = sorted({r["agent_id"] for r in rows if r["agent_id"]})
    mers, ags = {}, {}
    if mids:
        q = ("SELECT id,phone,company,contact,email,status,token_balance,created_at "
             "FROM merchants WHERE id IN (%s)" % ",".join("?" * len(mids)))
        for x in conn.execute(q, mids).fetchall():
            mers[x["id"]] = dict(x)
    if aids:
        q = ("SELECT id,no,name FROM cs_agents WHERE id IN (%s)" % ",".join("?" * len(aids)))
        for x in conn.execute(q, aids).fetchall():
            ags[x["id"]] = dict(x)

    out = []
    for r in rows:
        d = dict(r)
        d["merchant"] = mers.get(r["merchant_id"])
        d["agent"] = ags.get(r["agent_id"]) if r["agent_id"] else None
        out.append(d)

    counts = {
        "pending": sum(1 for r in rows if r["status"] == "pending"),
        "human": sum(1 for r in rows if r["status"] == "human"),
        "ai": sum(1 for r in rows if r["status"] == "ai"),
        "mine": sum(1 for r in rows if r["agent_id"] == a["id"]),
        "unread": sum(r["unread_agent"] or 0 for r in rows),
    }
    tk = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN handler=? THEN 1 ELSE 0 END),0) AS mine"
        " FROM tickets WHERE status<>'已关闭'", (a["name"],)).fetchone()
    counts["tickets_pending"] = tk["n"]
    counts["tickets_mine"] = tk["mine"]

    today = time.strftime("%Y-%m-%d")
    stats = {
        "today_sessions": conn.execute(
            "SELECT COUNT(*) FROM cs_sessions WHERE agent_id=? AND created_at LIKE ?",
            (a["id"], today + "%")).fetchone()[0],
        "open_sessions": counts["human"],
        "waiting": counts["pending"],
        "today_messages": conn.execute(
            "SELECT COUNT(*) FROM cs_messages WHERE agent_id=? AND created_at LIKE ?",
            (a["id"], today + "%")).fetchone()[0],
    }

    # 在线状态：最多 20 秒回写一次
    cut = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() - 20))
    if not a["last_active"] or a["last_active"] < cut:
        conn.execute("UPDATE cs_agents SET status='online', last_active=? WHERE id=?",
                     (now_str(), a["id"]))
        conn.commit()

    data = {"list": out, "counts": counts, "stats": stats}
    if cur_id:
        row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (cur_id,)).fetchone()
        if row:
            msgs = conn.execute(
                "SELECT * FROM cs_messages WHERE session_id=? AND id>? ORDER BY id",
                (cur_id, since)).fetchall()
            if row["unread_agent"]:
                conn.execute("UPDATE cs_sessions SET unread_agent=0 WHERE id=?", (cur_id,))
                conn.commit()
            d = cs_session_payload(conn, row)
            d["unread_agent"] = 0
            data["session"] = d
            data["messages"] = [dict(x) for x in msgs]
    conn.close()
    return jsonify({"code": 0, "data": data})


@app.get("/api/cs/agent/sessions")
@cs_login_required
def cs_agent_sessions(a):
    status = (request.args.get("status") or "").strip()
    conn = get_db()
    sql = ("SELECT * FROM cs_sessions WHERE status<>'closed' "
           "AND (agent_id IS NULL OR agent_id=?)")
    args = [a["id"]]
    if status in ("pending", "human", "ai"):
        sql += " AND status=?"
        args.append(status)
    sql += (" ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'human' THEN 1 ELSE 2 END,"
            " last_msg_at DESC, id DESC")
    rows = conn.execute(sql, args).fetchall()
    out = []
    for r in rows:
        d = cs_session_payload(conn, r)
        out.append(d)
    counts = {
        "pending": sum(1 for r in rows if r["status"] == "pending"),
        "human": sum(1 for r in rows if r["status"] == "human"),
        "ai": sum(1 for r in rows if r["status"] == "ai"),
        "mine": sum(1 for r in rows if r["agent_id"] == a["id"]),
        "unread": sum(r["unread_agent"] or 0 for r in rows),
    }
    # 在线状态：最多 20 秒回写一次，避免每次轮询都抢写锁
    cut = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() - 20))
    if not a["last_active"] or a["last_active"] < cut:
        conn.execute("UPDATE cs_agents SET status='online', last_active=? WHERE id=?",
                     (now_str(), a["id"]))
        conn.commit()
    conn.close()
    return jsonify({"code": 0, "data": {"list": out, "counts": counts}})


@app.get("/api/cs/agent/session/<int:sid>")
@cs_login_required
def cs_agent_session_detail(a, sid):
    try:
        since = int(request.args.get("since", 0))
    except (TypeError, ValueError):
        since = 0
    conn = get_db()
    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "会话不存在"}), 404
    msgs = conn.execute(
        "SELECT * FROM cs_messages WHERE session_id=? AND id>? ORDER BY id", (sid, since)
    ).fetchall()
    if row["unread_agent"]:
        conn.execute("UPDATE cs_sessions SET unread_agent=0 WHERE id=?", (sid,))
        conn.commit()
    d = cs_session_payload(conn, row)
    d["unread_agent"] = 0
    conn.close()
    return jsonify({"code": 0, "data": {"session": d, "messages": [dict(x) for x in msgs]}})


@app.post("/api/cs/agent/claim")
@cs_login_required
def cs_agent_claim(a):
    data = request.get_json(silent=True) or {}
    sid = data.get("session_id")
    conn = get_db()
    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "会话不存在"}), 404
    if row["status"] == "closed":
        conn.close()
        return jsonify({"code": 400, "msg": "会话已结束"}), 400
    if row["agent_id"] and row["agent_id"] != a["id"]:
        other = conn.execute("SELECT name FROM cs_agents WHERE id=?", (row["agent_id"],)).fetchone()
        conn.close()
        return jsonify({"code": 409, "msg": "该会话已被 %s 接入" % (other["name"] if other else "其他客服")}), 409
    if row["agent_id"] == a["id"] and row["status"] == "human":
        conn.close()
        return jsonify({"code": 0, "msg": "已在您的会话列表中", "data": {"session_id": sid}})
    conn.execute(
        "UPDATE cs_sessions SET agent_id=?, status='human', mode='human', claimed_at=?, unread_agent=0 "
        "WHERE id=?", (a["id"], now_str(), sid))
    cs_add_message(conn, sid, "system", "客服 %s 已接入，正在为您服务。" % a["name"])
    conn.execute("UPDATE cs_sessions SET unread_user=unread_user+1 WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "已接入会话", "data": {"session_id": sid}})


@app.post("/api/cs/agent/reply")
@cs_login_required
def cs_agent_reply(a):
    data = request.get_json(silent=True) or {}
    sid = data.get("session_id")
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"code": 400, "msg": "回复内容不能为空"}), 400
    if len(content) > 2000:
        return jsonify({"code": 400, "msg": "单条回复不能超过 2000 字"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "会话不存在"}), 404
    if row["status"] == "closed":
        conn.close()
        return jsonify({"code": 400, "msg": "会话已结束，无法回复"}), 400
    if row["agent_id"] and row["agent_id"] != a["id"]:
        conn.close()
        return jsonify({"code": 409, "msg": "该会话属于其他客服"}), 409
    if not row["agent_id"]:
        conn.execute("UPDATE cs_sessions SET agent_id=?, claimed_at=? WHERE id=?",
                     (a["id"], now_str(), sid))
    conn.execute("UPDATE cs_sessions SET status='human', mode='human' WHERE id=?", (sid,))
    cs_add_message(conn, sid, "agent", content, a["id"])
    conn.execute("UPDATE cs_sessions SET unread_user=unread_user+1, unread_agent=0 WHERE id=?", (sid,))
    conn.commit()
    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()
    d = cs_session_payload(conn, row)
    conn.close()
    return jsonify({"code": 0, "msg": "已发送", "data": {"session": d}})


@app.post("/api/cs/agent/close")
@cs_login_required
def cs_agent_close(a):
    data = request.get_json(silent=True) or {}
    sid = data.get("session_id")
    conn = get_db()
    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "会话不存在"}), 404
    if row["status"] == "closed":
        conn.close()
        return jsonify({"code": 0, "msg": "会话已结束"})
    if row["agent_id"] and row["agent_id"] != a["id"] and a["role"] != "supervisor":
        conn.close()
        return jsonify({"code": 403, "msg": "只能结束自己接入的会话"}), 403
    conn.execute("UPDATE cs_sessions SET status='closed', closed_at=? WHERE id=?",
                 (now_str(), sid))
    cs_add_message(conn, sid, "system", "会话已结束，感谢您的咨询。")
    conn.execute("UPDATE cs_sessions SET unread_user=unread_user+1 WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "会话已结束"})


@app.get("/api/cs/agent/quick-replies")
@cs_login_required
def cs_quick_replies(a):
    return jsonify({"code": 0, "data": CS_QUICK_REPLIES})


@app.get("/api/cs/agent/stats")
@cs_login_required
def cs_agent_stats(a):
    conn = get_db()
    today = time.strftime("%Y-%m-%d")
    mine_today = conn.execute(
        "SELECT COUNT(*) FROM cs_sessions WHERE agent_id=? AND created_at LIKE ?",
        (a["id"], today + "%")).fetchone()[0]
    mine_open = conn.execute(
        "SELECT COUNT(*) FROM cs_sessions WHERE agent_id=? AND status<>'closed'",
        (a["id"],)).fetchone()[0]
    waiting = conn.execute("SELECT COUNT(*) FROM cs_sessions WHERE status='pending'").fetchone()[0]
    msgs = conn.execute(
        "SELECT COUNT(*) FROM cs_messages WHERE agent_id=? AND created_at LIKE ?",
        (a["id"], today + "%")).fetchone()[0]
    conn.close()
    return jsonify({"code": 0, "data": {
        "today_sessions": mine_today, "open_sessions": mine_open,
        "waiting": waiting, "today_messages": msgs}})


# ----------------------------------------------------------------------
# 管理侧：知识库 / AI 配置 / 客服账号 / 会话记录
# ----------------------------------------------------------------------
@app.get("/api/admin/kb")
@login_required
@admin_required
def admin_kb_list(m):
    kw = (request.args.get("keyword") or "").strip()
    cat = (request.args.get("category") or "").strip()
    conn = get_db()
    sql = "SELECT * FROM kb_entries WHERE 1=1"
    args = []
    if kw:
        sql += " AND (question LIKE ? OR answer LIKE ? OR keywords LIKE ?)"
        args += ["%" + kw + "%"] * 3
    if cat:
        sql += " AND category=?"
        args.append(cat)
    sql += " ORDER BY category, id DESC"
    rows = conn.execute(sql, args).fetchall()
    cats = [r[0] for r in conn.execute(
        "SELECT DISTINCT category FROM kb_entries WHERE category<>'' ORDER BY category").fetchall()]
    total = conn.execute("SELECT COUNT(*) FROM kb_entries").fetchone()[0]
    active = conn.execute("SELECT COUNT(*) FROM kb_entries WHERE status=1").fetchone()[0]
    conn.close()
    return jsonify({"code": 0, "data": {
        "list": [dict(r) for r in rows], "categories": cats,
        "stats": {"total": total, "active": active}}})


@app.post("/api/admin/kb")
@login_required
@admin_required
def admin_kb_create(m):
    data = request.get_json(silent=True) or {}
    q = (data.get("question") or "").strip()
    a_ = (data.get("answer") or "").strip()
    if not q or not a_:
        return jsonify({"code": 400, "msg": "问题与答案都不能为空"}), 400
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO kb_entries(category,question,answer,keywords,status,created_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?)",
        ((data.get("category") or "通用").strip(), q, a_, (data.get("keywords") or "").strip(),
         1 if data.get("status", 1) in (1, "1", True, "true") else 0, now_str(), now_str()))
    conn.commit()
    row = conn.execute("SELECT * FROM kb_entries WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    admin_log(m, "新增知识库", q[:40])
    return jsonify({"code": 0, "msg": "已添加", "data": dict(row)})


@app.put("/api/admin/kb/<int:kid>")
@login_required
@admin_required
def admin_kb_update(m, kid):
    data = request.get_json(silent=True) or {}
    fields, vals = [], []
    for f in ["category", "question", "answer", "keywords"]:
        if f in data:
            fields.append(f + "=?")
            vals.append((data[f] or "").strip())
    if "status" in data:
        fields.append("status=?")
        vals.append(1 if data["status"] in (1, "1", True, "true") else 0)
    if not fields:
        return jsonify({"code": 400, "msg": "没有需要更新的内容"}), 400
    fields.append("updated_at=?")
    vals.append(now_str())
    vals.append(kid)
    conn = get_db()
    conn.execute("UPDATE kb_entries SET %s WHERE id=?" % ",".join(fields), vals)
    conn.commit()
    row = conn.execute("SELECT * FROM kb_entries WHERE id=?", (kid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"code": 404, "msg": "条目不存在"}), 404
    admin_log(m, "编辑知识库", row["question"][:40])
    return jsonify({"code": 0, "msg": "已保存", "data": dict(row)})


@app.delete("/api/admin/kb/<int:kid>")
@login_required
@admin_required
def admin_kb_delete(m, kid):
    conn = get_db()
    row = conn.execute("SELECT question FROM kb_entries WHERE id=?", (kid,)).fetchone()
    conn.execute("DELETE FROM kb_entries WHERE id=?", (kid,))
    conn.commit()
    conn.close()
    admin_log(m, "删除知识库", (row["question"][:40] if row else str(kid)))
    return jsonify({"code": 0, "msg": "已删除"})


def mask_secret(v):
    v = (v or "").strip()
    if not v:
        return ""
    if len(v) <= 8:
        return "****"
    return v[:4] + "****" + v[-4:]


@app.get("/api/admin/ai-config")
@login_required
@admin_required
def admin_ai_config_get(m):
    conf = get_settings()
    key = conf.get("ai_api_key", "")
    return jsonify({"code": 0, "data": {
        "ai_enabled": conf.get("ai_enabled", "1"),
        "ai_base_url": conf.get("ai_base_url", ""),
        "ai_model": conf.get("ai_model", ""),
        "ai_temperature": conf.get("ai_temperature", "0.3"),
        "ai_system_prompt": conf.get("ai_system_prompt", ""),
        "kb_enabled": conf.get("kb_enabled", "1"),
        "kb_topk": conf.get("kb_topk", "3"),
        "cs_welcome": conf.get("cs_welcome", ""),
        "cs_offline": conf.get("cs_offline", ""),
        "api_key_set": bool(key.strip()),
        "api_key_mask": mask_secret(key),
    }})


@app.put("/api/admin/ai-config")
@login_required
@admin_required
def admin_ai_config_put(m):
    data = request.get_json(silent=True) or {}
    allow = ["ai_enabled", "ai_base_url", "ai_model", "ai_temperature",
             "ai_system_prompt", "kb_enabled", "kb_topk", "cs_welcome", "cs_offline"]
    conn = get_db()
    for k in allow:
        if k in data:
            conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                         (k, str(data[k])))
    # 密钥单独处理：只有传入了新值（非掩码、非空）才覆盖
    key = (data.get("ai_api_key") or "").strip()
    if key and "****" not in key:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('ai_api_key',?)", (key,))
    if data.get("clear_api_key"):
        conn.execute("UPDATE settings SET value='' WHERE key='ai_api_key'")
    conn.commit()
    conn.close()
    admin_log(m, "修改 AI 客服配置", (data.get("ai_model") or ""))
    return jsonify({"code": 0, "msg": "配置已保存"})


@app.post("/api/admin/ai-test")
@login_required
@admin_required
def admin_ai_test(m):
    data = request.get_json(silent=True) or {}
    conf = get_settings()
    base = (data.get("ai_base_url") or conf.get("ai_base_url") or "").strip()
    model = (data.get("ai_model") or conf.get("ai_model") or "").strip()
    key = (data.get("ai_api_key") or "").strip()
    if not key or "****" in key:
        key = (conf.get("ai_api_key") or "").strip()
    probe = dict(conf)
    probe.update({"ai_base_url": base, "ai_model": model, "ai_api_key": key})
    if not key:
        return jsonify({"code": 400, "msg": "请先填写 API 密钥再测试"}), 400
    reply, err = ai_chat(probe, [
        {"role": "system", "content": "你是连通性测试助手，只回复两个字：正常"},
        {"role": "user", "content": "测试"},
    ], timeout=25)
    if reply:
        return jsonify({"code": 0, "msg": "连接成功", "data": {
            "model": model, "reply": reply[:200]}})
    return jsonify({"code": 502, "msg": err or "连接失败"}), 502


@app.get("/api/admin/cs/agents")
@login_required
@admin_required
def admin_cs_agents(m):
    conn = get_db()
    rows = conn.execute("SELECT * FROM cs_agents ORDER BY id").fetchall()
    out = []
    for r in rows:
        d = cs_agent_dict(r)
        d["open_sessions"] = conn.execute(
            "SELECT COUNT(*) FROM cs_sessions WHERE agent_id=? AND status<>'closed'",
            (r["id"],)).fetchone()[0]
        out.append(d)
    conn.close()
    return jsonify({"code": 0, "data": out})


@app.post("/api/admin/cs/agents")
@login_required
@admin_required
def admin_cs_agent_create(m):
    data = request.get_json(silent=True) or {}
    no = (data.get("no") or "").strip().upper()
    name = (data.get("name") or "").strip()
    pwd = (data.get("password") or "").strip()
    if not no or not name:
        return jsonify({"code": 400, "msg": "工号与姓名必填"}), 400
    if len(pwd) < 6:
        return jsonify({"code": 400, "msg": "密码至少 6 位"}), 400
    conn = get_db()
    if conn.execute("SELECT 1 FROM cs_agents WHERE UPPER(no)=?", (no,)).fetchone():
        conn.close()
        return jsonify({"code": 409, "msg": "该工号已存在"}), 409
    cur = conn.execute(
        "INSERT INTO cs_agents(no,password,name,phone,email,role,status,created_at) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (no, pw_hash(pwd), name, (data.get("phone") or "").strip(), (data.get("email") or "").strip(),
         "supervisor" if data.get("role") == "supervisor" else "agent", "offline", now_str()))
    conn.commit()
    row = conn.execute("SELECT * FROM cs_agents WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    admin_log(m, "新增客服账号", "%s %s" % (no, name))
    return jsonify({"code": 0, "msg": "已创建", "data": cs_agent_dict(row)})


@app.put("/api/admin/cs/agents/<int:aid>")
@login_required
@admin_required
def admin_cs_agent_update(m, aid):
    data = request.get_json(silent=True) or {}
    fields, vals = [], []
    for f in ["name", "phone", "email"]:
        if f in data:
            fields.append(f + "=?")
            vals.append((data[f] or "").strip())
    if "role" in data:
        fields.append("role=?")
        vals.append("supervisor" if data["role"] == "supervisor" else "agent")
    if "disabled" in data:
        fields.append("disabled=?")
        vals.append(1 if data["disabled"] in (1, "1", True, "true") else 0)
    pwd = (data.get("password") or "").strip()
    if pwd:
        if len(pwd) < 6:
            return jsonify({"code": 400, "msg": "密码至少 6 位"}), 400
        fields.append("password=?")
        vals.append(pw_hash(pwd))
    if not fields:
        return jsonify({"code": 400, "msg": "没有需要更新的内容"}), 400
    vals.append(aid)
    conn = get_db()
    conn.execute("UPDATE cs_agents SET %s WHERE id=?" % ",".join(fields), vals)
    if data.get("disabled") in (1, "1", True, "true"):
        conn.execute("DELETE FROM cs_agent_tokens WHERE agent_id=?", (aid,))
        conn.execute("UPDATE cs_agents SET status='offline' WHERE id=?", (aid,))
    conn.commit()
    row = conn.execute("SELECT * FROM cs_agents WHERE id=?", (aid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"code": 404, "msg": "客服不存在"}), 404
    admin_log(m, "编辑客服账号", row["no"])
    return jsonify({"code": 0, "msg": "已保存", "data": cs_agent_dict(row)})


@app.delete("/api/admin/cs/agents/<int:aid>")
@login_required
@admin_required
def admin_cs_agent_delete(m, aid):
    conn = get_db()
    row = conn.execute("SELECT * FROM cs_agents WHERE id=?", (aid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "客服不存在"}), 404
    conn.execute("DELETE FROM cs_agent_tokens WHERE agent_id=?", (aid,))
    conn.execute("UPDATE cs_sessions SET agent_id=NULL WHERE agent_id=? AND status<>'closed'", (aid,))
    conn.execute("DELETE FROM cs_agents WHERE id=?", (aid,))
    conn.commit()
    conn.close()
    admin_log(m, "删除客服账号", row["no"])
    return jsonify({"code": 0, "msg": "已删除"})


@app.get("/api/admin/cs/sessions")
@login_required
@admin_required
def admin_cs_sessions(m):
    status = (request.args.get("status") or "").strip()
    kw = (request.args.get("keyword") or "").strip()
    page, size = page_args(15)
    conn = get_db()
    where = " WHERE 1=1"
    args = []
    if status in ("ai", "pending", "human", "closed"):
        where += " AND s.status=?"
        args.append(status)
    if kw:
        where += (" AND (m.company LIKE ? OR m.phone LIKE ? OR s.last_msg LIKE ? "
                  "OR s.id=?)")
        args += ["%" + kw + "%", "%" + kw + "%", "%" + kw + "%", kw if kw.isdigit() else -1]
    base = ("FROM cs_sessions s LEFT JOIN merchants m ON m.id=s.merchant_id "
            "LEFT JOIN cs_agents a ON a.id=s.agent_id" + where)
    total = conn.execute("SELECT COUNT(*) " + base, args).fetchone()[0]
    rows = conn.execute(
        "SELECT s.*, m.company, m.phone, a.name AS agent_name " + base +
        " ORDER BY s.id DESC LIMIT ? OFFSET ?", args + [size, (page - 1) * size]).fetchall()
    counts = {}
    for k in ("ai", "pending", "human", "closed"):
        counts[k] = conn.execute("SELECT COUNT(*) FROM cs_sessions WHERE status=?", (k,)).fetchone()[0]
    avg = conn.execute(
        "SELECT AVG((julianday(claimed_at)-julianday(created_at))*86400) FROM cs_sessions "
        "WHERE claimed_at IS NOT NULL AND claimed_at<>''").fetchone()[0]
    msg_total = conn.execute("SELECT COUNT(*) FROM cs_messages").fetchone()[0]
    conn.close()
    return jsonify({"code": 0, "data": {
        "list": [dict(r) for r in rows], "total": total,
        "counts": counts, "messages": msg_total,
        "avg_wait": int(avg) if avg else 0}})


@app.get("/api/admin/cs/sessions/<int:sid>")
@login_required
@admin_required
def admin_cs_session_detail(m, sid):
    conn = get_db()
    row = conn.execute("SELECT * FROM cs_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "会话不存在"}), 404
    d = cs_session_payload(conn, row)
    msgs = conn.execute("SELECT * FROM cs_messages WHERE session_id=? ORDER BY id", (sid,)).fetchall()
    conn.close()
    return jsonify({"code": 0, "data": {
        "session": d, "messages": [dict(x) for x in msgs]}})


# ----------------------------------------------------------------------
# 客服工单：客服可为工单回复（客服工作台/工单页使用）
# ----------------------------------------------------------------------
@app.get("/api/cs/agent/tickets")
@cs_login_required
def cs_agent_tickets(a):
    """客服工单队列：mid 看单个商家，status=open|closed|all 筛状态，附带角标统计"""
    mid = (request.args.get("merchant_id") or "").strip()
    status = (request.args.get("status") or "all").strip()
    keyword = (request.args.get("keyword") or "").strip()

    cond, args = [], []
    if mid:
        cond.append("t.merchant_id=?")
        args.append(mid)
    if status == "open":
        cond.append("t.status<>'已关闭'")
    elif status == "closed":
        cond.append("t.status='已关闭'")
    if keyword:
        cond.append("(t.title LIKE ? OR t.content LIKE ? OR m.company LIKE ?)")
        args += ["%" + keyword + "%"] * 3
    where = (" WHERE " + " AND ".join(cond)) if cond else ""

    conn = get_db()
    rows = conn.execute(
        "SELECT t.*, m.company, m.phone AS merchant_phone FROM tickets t"
        " LEFT JOIN merchants m ON m.id=t.merchant_id" + where +
        " ORDER BY CASE WHEN t.status='已关闭' THEN 1 ELSE 0 END,"
        " CASE WHEN t.handler='' OR t.handler IS NULL THEN 0 ELSE 1 END, t.id DESC LIMIT 200",
        args).fetchall()
    cnt = conn.execute(
        "SELECT COALESCE(SUM(CASE WHEN status<>'已关闭' THEN 1 ELSE 0 END),0) AS pending,"
        " COALESCE(SUM(CASE WHEN status='已关闭' THEN 1 ELSE 0 END),0) AS closed,"
        " COALESCE(SUM(CASE WHEN status<>'已关闭' AND handler=? THEN 1 ELSE 0 END),0) AS mine"
        " FROM tickets", (a["name"],)).fetchone()
    conn.close()
    return jsonify({"code": 0, "data": {
        "list": [dict(r) for r in rows], "counts": dict(cnt)}})


@app.post("/api/cs/agent/ticket-claim")
@cs_login_required
def cs_agent_ticket_claim(a):
    """客服接手工单：标记负责人，避免多客服重复回复"""
    data = request.get_json(silent=True) or {}
    try:
        tid = int(data.get("ticket_id") or 0)
    except (TypeError, ValueError):
        tid = 0
    if tid <= 0:
        return jsonify({"code": 400, "msg": "缺少工单号"}), 400
    conn = get_db()
    row = conn.execute("SELECT id,title,status,handler FROM tickets WHERE id=?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "工单不存在"}), 404
    if row["status"] == "已关闭":
        conn.close()
        return jsonify({"code": 400, "msg": "工单已关闭，无需接手"}), 400
    if row["handler"] and row["handler"] != a["name"]:
        conn.close()
        return jsonify({"code": 409, "msg": "该工单已由 %s 接手" % row["handler"]}), 409
    conn.execute("UPDATE tickets SET handler=? WHERE id=?", (a["name"], tid))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "已接手工单", "data": {"handler": a["name"]}})


@app.post("/api/cs/agent/ticket-reply")
@cs_login_required
def cs_agent_ticket_reply(a):
    data = request.get_json(silent=True) or {}
    tid = data.get("ticket_id")
    reply = (data.get("reply") or "").strip()
    status = (data.get("status") or "已关闭").strip()
    if status not in ("处理中", "已关闭"):
        return jsonify({"code": 400, "msg": "状态不合法"}), 400
    if not reply:
        return jsonify({"code": 400, "msg": "回复内容不能为空"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"code": 404, "msg": "工单不存在"}), 404
    if row["status"] == "已关闭" and status == "处理中":
        conn.close()
        return jsonify({"code": 400, "msg": "工单已关闭，不能再改回处理中"}), 400
    conn.execute(
        "UPDATE tickets SET reply=?, status=?, replied_at=?, replied_by=?, handler=? WHERE id=?",
        (reply, status, now_str(), "客服 " + a["name"], a["name"], tid))
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "已回复工单" if status == "已关闭" else "已回复，工单保持处理中"})


# ----------------------------------------------------------------------
# 并发写入重试
# Windows 下 SQLite(WAL) 在多个连接同时写入时，偶发 "attempt to write a
# readonly database" / "database is locked"，这属于瞬时冲突，重试即可成功。
# 这里在启动时给所有路由套一层重试，避免偶发 500 打到前端。
# ----------------------------------------------------------------------
def _wrap_views_with_retry():
    import functools
    transient = ("locked", "readonly", "busy")

    for rule in list(app.url_map.iter_rules()):
        fn = app.view_functions.get(rule.endpoint)
        if not fn or getattr(fn, "_db_retry", False):
            continue

        def make(fn):
            @functools.wraps(fn)
            def wrapper(*args, **kwargs):
                for attempt in range(3):
                    try:
                        return fn(*args, **kwargs)
                    except sqlite3.OperationalError as e:
                        msg = str(e).lower()
                        if attempt == 2 or not any(k in msg for k in transient):
                            raise
                        time.sleep(0.05 * (attempt + 1))
            wrapper._db_retry = True
            return wrapper

        app.view_functions[rule.endpoint] = make(fn)


configure(app, get_db)
_wrap_views_with_retry()


def create_app(initialize=True):
    if initialize:
        init_db()
        initialize_platform(app.extensions["taigua_core"], pw_hash)
        if not app.extensions.get("taigua_logging"):
            configure_logging(app)
            app.extensions["taigua_logging"] = True
    return app


if __name__ == "__main__":
    create_app()
    # print("=" * 56)
    # print("  泰卦智能 · 商家服务平台已启动")
    # print("  首页:       http://127.0.0.1:8000")
    # print("  登录页:     http://127.0.0.1:8000/html/login.html")
    # print("  商家控制台: http://127.0.0.1:8000/html/merchant.html")
    # print("  管理后台:   http://127.0.0.1:8000/html/admin.html")
    # print("  商家演示号: 13800008888 / 123456（验证码登录任意 6 位数字）")
    # print("  管理员账号: 13800000000 / admin123")
    # print("=" * 56)
    app.run(host=os.environ.get("TAIGUA_HOST", "127.0.0.1"), port=int(os.environ.get("TAIGUA_PORT", "8000")), debug=False, threaded=True)
