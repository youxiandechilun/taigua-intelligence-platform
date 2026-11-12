import sqlite3
from pathlib import Path
import sys
import json

sys.path.insert(0, str(Path(__file__).parent))
from conf import BASE_DIR
from util._logger import get_channel_logger

logger = get_channel_logger("init_db")

DB_DIR = BASE_DIR / "db"
DB_PATH = DB_DIR / "database.db"


def init_database():
    # 确保 data/ 下的所有必要子目录存在
    for subdir in ["db", "logs", "cookies", "cookiesFile", "uploads", "thumbnails", "upload_chunks"]:
        (BASE_DIR / subdir).mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # 原始表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type INTEGER NOT NULL,
        filePath TEXT NOT NULL,
        userName TEXT NOT NULL,
        status INTEGER DEFAULT 0,
        avatar TEXT DEFAULT ''
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS file_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        filesize REAL,
        upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        file_path TEXT
    )
    """)

    # 阶段二：系统设置表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 草稿箱表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT DEFAULT 'video',
        title TEXT DEFAULT '',
        cover_path TEXT DEFAULT '',
        draft_data TEXT DEFAULT '{}',
        channels_summary TEXT DEFAULT '[]',
        video_duration REAL DEFAULT 0,
        video_file_size INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 图文草稿表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS image_drafts (
        id TEXT PRIMARY KEY,
        image_ids TEXT NOT NULL,
        account_configs TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 图片上传记录表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS image_records (
        id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        filesize REAL DEFAULT 0,
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        upload_time DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 阶段二：发布主记录表（每次"发布"=1 行）
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS publish_batches (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        video_material_id TEXT DEFAULT '',
        image_material_ids TEXT DEFAULT '[]',
        landscape_cover_material_id TEXT DEFAULT '',
        portrait_cover_material_id TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        account_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        schedule_time TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        scheduled_at TEXT DEFAULT '',
        interval_minutes REAL DEFAULT 0,
        next_batch_id TEXT DEFAULT ''
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_publish_batches_created ON publish_batches(created_at DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_publish_batches_status ON publish_batches(status)")

    # 阶段二：发布明细表（每个账号 1 行）
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS publish_details (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        account_id INTEGER,
        account_name TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        account_configs TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        error_message TEXT NOT NULL DEFAULT '',
        publish_url TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        FOREIGN KEY (batch_id) REFERENCES publish_batches(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_publish_details_batch ON publish_details(batch_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_publish_details_status ON publish_details(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_publish_details_platform ON publish_details(platform)")

    # 素材库表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER DEFAULT 0,
        storage_type TEXT NOT NULL DEFAULT 'local',
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        duration REAL DEFAULT 0,
        thumbnail_path TEXT DEFAULT '',
        orientation TEXT DEFAULT '',
        upload_time DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 分片上传会话表（用于大文件分片上传 + 断点续传）
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upload_sessions (
        upload_id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT,
        file_type TEXT,
        chunk_size INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        uploaded_chunks INTEGER DEFAULT 0,
        status TEXT DEFAULT 'uploading',
        material_id TEXT,
        error_message TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS upload_chunks (
        upload_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (upload_id, chunk_index),
        FOREIGN KEY (upload_id) REFERENCES upload_sessions(upload_id) ON DELETE CASCADE
    )
    """)
    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_upload_sessions_status
    ON upload_sessions(status, updated_at)
    """)

    # 标签表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#8b5cf6',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 账号-标签关联表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS account_tags (
        account_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (account_id, tag_id),
        FOREIGN KEY (account_id) REFERENCES user_info(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
    """)

    # 海外矩阵本地版：内容工厂、互动、线索、客户和留资推送记录。
    # workspace_id 由员工工作进程注入，避免不同员工工作区共享业务数据。
    cursor.executescript("""
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
    """)

    conn.commit()
    conn.close()
    logger.info(f"Database initialized at {DB_PATH}")


def migrate_database():
    """增量迁移 — 添加新列（幂等）"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # user_info 添加 avatar 列
    try:
        cursor.execute('ALTER TABLE user_info ADD COLUMN avatar TEXT DEFAULT ""')
        logger.info("已添加 avatar 列")
    except sqlite3.OperationalError:
        pass  # 列已存在

    # image_drafts 添加 draft_data 列（支持完整状态存储）
    try:
        cursor.execute('ALTER TABLE image_drafts ADD COLUMN draft_data TEXT DEFAULT "{}"')
        logger.info("已添加 image_drafts.draft_data 列")
    except sqlite3.OperationalError:
        pass  # 列已存在

    # materials 添加 thumbnail_path 列
    try:
        cursor.execute('ALTER TABLE materials ADD COLUMN thumbnail_path TEXT DEFAULT ""')
        logger.info("已添加 materials.thumbnail_path 列")
    except sqlite3.OperationalError:
        pass  # 列已存在

    # materials 添加 orientation 列（横竖版标识：horizontal/vertical/square）
    try:
        cursor.execute("ALTER TABLE materials ADD COLUMN orientation TEXT DEFAULT ''")
        logger.info("已添加 materials.orientation 列")
    except sqlite3.OperationalError:
        pass  # 列已存在

    # 草稿批量发布用：溯源到草稿
    try:
        cursor.execute("ALTER TABLE publish_batches ADD COLUMN source TEXT NOT NULL DEFAULT ''")
        logger.info("已添加 publish_batches.source 列")
    except sqlite3.OperationalError:
        pass  # 列已存在
    try:
        cursor.execute("ALTER TABLE publish_batches ADD COLUMN draft_id INTEGER NOT NULL DEFAULT 0")
        logger.info("已添加 publish_batches.draft_id 列")
    except sqlite3.OperationalError:
        pass  # 列已存在
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_publish_batches_draft ON publish_batches(source, draft_id)")
        logger.info("已创建 idx_publish_batches_draft 索引")
    except sqlite3.OperationalError:
        pass  # 索引已存在

    # 发布链调度：发布页批量发布时视频间隔用（DB 驱动的定时调度）
    # scheduled_at = 该视频预定开始发布的时间（ISO，空 = 不等待/立即）
    # interval_minutes = 本批次提交时的视频间隔（分钟）
    # next_batch_id = 链表：本视频全部完成后按间隔排程下一个视频
    for col_sql in (
        "ALTER TABLE publish_batches ADD COLUMN scheduled_at TEXT DEFAULT ''",
        "ALTER TABLE publish_batches ADD COLUMN interval_minutes REAL DEFAULT 0",
        "ALTER TABLE publish_batches ADD COLUMN next_batch_id TEXT DEFAULT ''",
    ):
        try:
            cursor.execute(col_sql)
            logger.info(f"已添加 publish_batches.{col_sql.split('ADD COLUMN ')[1].split()[0]} 列")
        except sqlite3.OperationalError:
            pass  # 列已存在

    # 确保 tags 表存在（幂等）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT DEFAULT '#8b5cf6',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS account_tags (
            account_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (account_id, tag_id),
            FOREIGN KEY (account_id) REFERENCES user_info(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
    """)

    # 海外工作台状态迁移：旧版本表已存在时只补列，不删除员工历史记录。
    overseas_columns = {
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
    for table, columns in overseas_columns.items():
        cursor.execute(f"PRAGMA table_info({table})")
        existing = {row[1] for row in cursor.fetchall()}
        for column, definition in columns.items():
            if column not in existing:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_overseas_conversation_dedupe "
        "ON overseas_conversations(workspace_id, dedupe_key)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_overseas_lead_dedupe "
        "ON overseas_leads(workspace_id, dedupe_key)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_overseas_customer_dedupe "
        "ON overseas_customers(workspace_id, dedupe_key)"
    )

    # user_info 扩展账号运营数据字段：粉丝数 / 获赞数 / 关注数
    # 存量平台暂不同步(保持默认 0),后续版本按平台逐步同步进来
    for col in ("fans", "likes", "follows"):
        try:
            cursor.execute(f'ALTER TABLE user_info ADD COLUMN {col} INTEGER DEFAULT 0')
            logger.info(f"已添加 user_info.{col} 列")
        except sqlite3.OperationalError:
            pass  # 列已存在

    # user_info 升级:新增 stats JSON 列(账号运营数据列表,每条 {ICON, COUNT, NAME, SORT})
    # 首次添加时,把 fans/likes/follows 非零的历史数据迁移进 stats
    cursor.execute("PRAGMA table_info(user_info)")
    user_info_cols = [row[1] for row in cursor.fetchall()]
    if 'stats' not in user_info_cols:
        cursor.execute('ALTER TABLE user_info ADD COLUMN stats TEXT DEFAULT "[]"')
        logger.info('已添加 user_info.stats 列')
        # 一次性数据迁移:把非零的 fans/likes/follows 写入 stats JSON
        try:
            cursor.execute('SELECT id, fans, likes, follows FROM user_info')
            for row in cursor.fetchall():
                acc_id, f, l, fo = row[0], row[1] or 0, row[2] or 0, row[3] or 0
                if f == 0 and l == 0 and fo == 0:
                    continue
                stats_json = json.dumps([
                    {"ICON": "user",   "COUNT": f,  "NAME": "粉丝", "SORT": 1},
                    {"ICON": "like",   "COUNT": l,  "NAME": "获赞", "SORT": 2},
                    {"ICON": "follow", "COUNT": fo, "NAME": "关注", "SORT": 3},
                ], ensure_ascii=False)
                cursor.execute('UPDATE user_info SET stats = ? WHERE id = ?', (stats_json, acc_id))
                logger.info(f'[migrate] 账号 {acc_id} 的 fans/likes/follows 已迁移至 stats')
        except Exception as e:
            logger.warning(f'[migrate] fans/likes/follows → stats 数据迁移失败(可忽略): {e}')

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_database()
    migrate_database()
