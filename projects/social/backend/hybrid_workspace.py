"""工作区兼容层：只同步业务索引，普通任务不把本机 Cookie 上传服务器。"""

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3
from urllib.parse import unquote

from hybrid_execution import ExecutionError


CONTEXT_TABLES = ("user_info", "materials", "tags", "account_tags", "drafts", "image_drafts", "settings")
RESULT_TABLES = ("user_info", "materials", "publish_batches", "publish_details")
PUBLISH_PATHS = {"/postVideo", "/api/image-publish/publish", "/api/article-publish/publish"}
LOCAL_PATHS = {"/getValidAccounts", "/checkAccount", "/syncProfile", "/login", "/openCreatorCenter"}
PLATFORM_PREFIXES = ("/api/douyin-image/", "/api/kuaishou-image/", "/api/xiaohongshu/",
                     "/api/bilibili/", "/api/channels/", "/api/weibo/", "/api/alipay/",
                     "/api/toutiao/", "/api/csdn/", "/api/vivo/", "/api/weixin-gzh/",
                     "/api/taobao_guanghe/", "/api/jd/", "/api/weixin_gzh/", "/api/jd-picker/")
BATCH_PATHS = {"/postVideoBatch", "/api/v2/videos/batch-publish", "/api/v2/drafts/batch-publish",
               "/api/image-publish/drafts/batch-publish", "/api/article-publish/drafts/batch-publish"}


def browser_operation(path, method="GET"):
    """共享白名单用于网关和插件，禁止把设备接口变成任意 HTTP/命令代理。"""
    if path == "/api/materials/batch-delete":
        return method == "POST"
    if path in {"/login", "/getValidAccounts", "/checkAccount"}:
        return method == "GET"
    if path in LOCAL_PATHS or path in PUBLISH_PATHS or path in BATCH_PATHS or path == "/api/internal/hybrid/run":
        return method == "POST"
    if path.startswith("/api/v2/tasks/") and path.endswith(("/cancel", "/retry")):
        return method == "POST"
    return method in {"GET", "POST"} and path.startswith(PLATFORM_PREFIXES) and not path.endswith(("/drafts", "/config"))


def safe_relative(value, roots=("materials", "covers", "videos", "thumbnails")):
    """只接受系统素材相对路径；本机绝对路径不由服务器下发。"""
    value = unquote(str(value)).replace("\\", "/")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in roots:
        raise ExecutionError("素材路径超出工作区")
    return str(path)


def file_hash(path):
    """分块校验大视频，避免为计算摘要把整份素材读进内存。"""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class WorkspaceConnection(sqlite3.Connection):
    """保留既有 execute/close 调用，with 退出后同时释放数据库句柄。"""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def connect(base):
    """兼容现有员工数据库，仅增加本机素材归属与内容校验字段。"""
    conn = sqlite3.connect(Path(base) / "db/database.db", timeout=15, factory=WorkspaceConnection)
    try:
        conn.row_factory = sqlite3.Row
        columns = {row[1] for row in conn.execute("PRAGMA table_info(materials)")}
        for name in ("device_id", "sha256"):
            if name not in columns:
                conn.execute(f"ALTER TABLE materials ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
        if "auxiliary" not in columns:
            conn.execute("ALTER TABLE materials ADD COLUMN auxiliary INTEGER NOT NULL DEFAULT 0")
        conn.commit()
        return conn
    except BaseException:
        conn.close()
        raise


def rows(conn, table):
    """表名只来自本模块固定集合，不能由请求构造 SQL 标识符。"""
    return [dict(row) for row in conn.execute(f'SELECT * FROM "{table}"')]


def snapshot(base):
    with connect(base) as conn:
        result = {table: rows(conn, table) for table in CONTEXT_TABLES}
        # 本机只继承发布偏好，原有云存储密钥和反馈联系方式不随任务下发。
        allowed = {"proxyUrl", "manualReview", "autoFillTitle", "autoSaveDraft", "batchTaskInterval", "cookieCheckMode", "disabledPlatforms"}
        result["settings"] = [row for row in result["settings"] if row["key"] in allowed]
        return result


def upsert(conn, table, records):
    """仅写已有列，兼容不同版本新增的统计字段。"""
    available = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
    for record in records:
        keys = [key for key in record if key in available]
        if not keys:
            continue
        names = ",".join('"' + key + '"' for key in keys)
        conn.execute(f'INSERT OR REPLACE INTO "{table}" ({names}) VALUES ({",".join("?" for _ in keys)})',
                     [record[key] for key in keys])


def seed_local(base, context):
    """同步索引时不删除任何本机文件和 Cookie，也不继承其他员工的数据库。"""
    with connect(base) as conn:
        for table in CONTEXT_TABLES:
            if table in context:
                conn.execute(f'DELETE FROM "{table}"')
                upsert(conn, table, context[table])
        # 每个执行任务只回传自己产生的历史；员工业务历史仍集中在服务器。
        for table in ("publish_details", "publish_batches"):
            conn.execute(f'DELETE FROM "{table}"')


def result_changes(base, before):
    """账号只回传变化的公开字段，登录文件内容不属于普通同步结果。"""
    with connect(base) as conn:
        result = {}
        for table in RESULT_TABLES:
            old = {str(row["id"]): row for row in before.get(table, [])}
            result[table] = [row for row in rows(conn, table) if old.get(str(row["id"])) != row]
        return result


def delete_local_materials(base, identifiers, device):
    """只删除员工已选择的素材及其缩略图；不下载云端原文件、不扫描业务目录。"""
    deleted, failed = [], []
    with connect(base) as conn:
        for identifier in dict.fromkeys(identifiers):
            try:
                row = conn.execute("SELECT * FROM materials WHERE id=?", (identifier,)).fetchone()
                if not row:
                    raise ExecutionError("素材不存在")
                if row["device_id"] not in ("", device):
                    raise ExecutionError("素材位于另一台员工电脑，请在原电脑删除")
                paths = [safe_relative(row[key]) for key in ("stored_path", "thumbnail_path") if row[key]]
                for relative in paths:
                    target = (Path(base) / relative).resolve()
                    if not target.is_relative_to(Path(base).resolve()):
                        raise ExecutionError("素材路径超出工作区")
                    target.unlink(missing_ok=True)
                    # 缩略图辅助索引一并清理，后续同步不能把已删除文件重新登记。
                    conn.execute("DELETE FROM materials WHERE auxiliary=1 AND stored_path=?", (relative,))
                conn.execute("DELETE FROM materials WHERE id=?", (identifier,))
                deleted.append(identifier)
            except (ExecutionError, OSError) as exc:
                failed.append({"id": identifier, "reason": str(exc)})
    return {"code": 200, "data": {"deleted": len(deleted), "deleted_ids": deleted, "failed": failed},
            "msg": f"本机已删除 {len(deleted)} 个素材"}


def apply_changes(base, changes, device):
    """落库前核对文件归属，设备不能把素材路径指向服务器的配置或凭证。"""
    with connect(base) as conn:
        for table in RESULT_TABLES:
            records = changes.get(table, [])
            if not isinstance(records, list) or len(records) > 5000:
                raise ExecutionError("索引数据格式或数量无效")
            for record in records:
                if not isinstance(record, dict):
                    raise ExecutionError("索引记录无效")
                if table == "materials":
                    existing = conn.execute("SELECT * FROM materials WHERE id=?", (record["id"],)).fetchone()
                    if existing and existing["device_id"] not in ("", device):
                        raise ExecutionError("不能修改另一台员工电脑的素材归属")
                    record["stored_path"] = safe_relative(record["stored_path"])
                    if record.get("thumbnail_path"):
                        record["thumbnail_path"] = safe_relative(record["thumbnail_path"])
                    # 云端旧素材下载缓存后仍保留云端来源，不能误标成只能从本机读取。
                    if existing and not existing["device_id"]:
                        record.update(storage_type=existing["storage_type"], device_id="")
                    else:
                        record.update(storage_type="device", device_id=device)
                    if not re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", "")):
                        raise ExecutionError("本机素材缺少内容校验值")
                if table == "user_info":
                    filename = str(record.get("filePath", ""))
                    if not re.fullmatch(r"[a-zA-Z0-9_-]+\.json", filename):
                        raise ExecutionError("平台账号登录文件编号无效")
                    existing = conn.execute("SELECT filePath FROM user_info WHERE id=?", (record["id"],)).fetchone()
                    if existing and existing[0] != filename:
                        raise ExecutionError("账号列表已变化，请刷新后重新登录")
            upsert(conn, table, records)
        # 本机只回传本次明细，全批次聚合必须以服务器保存的全部员工明细为准。
        for batch in {row["batch_id"] for row in changes.get("publish_details", [])}:
            counts = conn.execute("SELECT COUNT(*),SUM(status='success'),SUM(status='failed'),SUM(status IN ('queued','running','pending')) "
                                  "FROM publish_details WHERE batch_id=?", (batch,)).fetchone()
            total, success, failed, waiting = [value or 0 for value in counts]
            state = "pending" if waiting else ("success" if success == total else "failed" if failed == total else "partial")
            conn.execute("UPDATE publish_batches SET status=?,account_count=?,success_count=?,failed_count=? WHERE id=?",
                         (state, total, success, failed, batch))


def dependencies(base, payload):
    """从当前员工索引解析任务所需素材和账号，不能用另一员工的素材编号。"""
    text = json.dumps(payload, ensure_ascii=False)
    values = set()

    def visit(value):
        if isinstance(value, dict):
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)
        elif isinstance(value, (str, int)):
            values.add(str(value))
    visit(payload)
    with connect(base) as conn:
        for value in values:
            if value.startswith("covers/"):
                relative = safe_relative(value)
                target = Path(base) / relative
                if target.is_file() and not conn.execute("SELECT 1 FROM materials WHERE stored_path=?", (relative,)).fetchone():
                    conn.execute("INSERT OR IGNORE INTO materials(id,original_filename,stored_path,file_type,mime_type,file_size,sha256,auxiliary) "
                                 "VALUES (?,?,?,'image','image/jpeg',?,?,1)", (target.stem, target.name, relative, target.stat().st_size, file_hash(target)))
        materials = [row for row in rows(conn, "materials") if str(row["id"]) in values or row["stored_path"] in values
                     or f'/api/materials/file/{row["stored_path"]}' in unquote(text)]
        config = payload.get("account_configs") or {}
        account_files = set(payload.get("accountList") or [])
        if config.get("filePath"):
            account_files.add(config["filePath"])
        accounts = [row for row in rows(conn, "user_info") if row["filePath"] in account_files
                    or str(row["id"]) == str(config.get("account_id", ""))]
    if account_files - {row["filePath"] for row in accounts}:
        raise ExecutionError("任务引用的平台账号不属于当前员工")
    for value in payload.get("fileList", []):
        if value not in {row["stored_path"] for row in materials}:
            raise ExecutionError("任务引用的素材不存在或不属于当前员工")
    for value in payload.get("image_ids", []):
        if value not in {row["id"] for row in materials}:
            raise ExecutionError("任务引用的图片不存在或不属于当前员工")
    return materials, accounts


def server_prepared(base, payload):
    """就绪检查只能依据服务器实际文件，不能把已登记的本机索引当成已上传。"""
    materials, accounts = dependencies(base, payload)
    # 登记的摘要必须与服务器文件一致，损坏或被替换的文件不能进入定时执行。
    return bool(accounts) and all((Path(base) / safe_relative(row["stored_path"])).is_file() and (
        not row.get("sha256") or file_hash(Path(base) / safe_relative(row["stored_path"])) == row["sha256"])
        for row in materials) and all(
        (Path(base) / "cookiesFile" / row["filePath"]).is_file() for row in accounts)
