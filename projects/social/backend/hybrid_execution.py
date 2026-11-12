"""混合执行持久队列：普通任务在员工电脑执行，已准备的定时任务在服务器执行。"""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import time
import uuid


TERMINAL = {"success", "failed", "cancelled", "review", "missed"}


class ExecutionError(ValueError):
    """只把可读业务错误返回网页，凭证和底层异常不进入响应。"""


class ExecutionConflict(ExecutionError):
    """领取已结束或失配时明确拒收旧回执，设备留档后可继续处理后续任务。"""


def fingerprint(value):
    """设备和激活凭证只存摘要，数据库副本不能直接作为设备使用。"""
    return hashlib.sha256(value.encode()).hexdigest()


def schedule_timestamp(payload):
    """沿用页面的定时字段，无时区的日期明确按北京时间解释。"""
    config = payload.get("account_configs") or payload
    value = config.get("scheduleTime") or config.get("scheduled_at")
    if not value:
        if config.get("enableTimer") in (True, 1, "1", "true"):
            raise ExecutionError("请设置具体定时发布时间")
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone(timedelta(hours=8)))
        return parsed.timestamp()
    except (TypeError, ValueError, OverflowError) as exc:
        raise ExecutionError("定时发布时间格式无效") from exc


def immediate_payload(payload):
    """服务器到点才执行，不再次向平台提交一个过期的原生定时时间。"""
    result = json.loads(json.dumps(payload))
    for config in (result, result.get("account_configs")):
        if isinstance(config, dict):
            config.update(enableTimer=0, scheduleTime="", scheduled_at="")
    if result.get("_plan"):
        # 批量视频的已适配参数也要清除原生定时，避免到点后被平台拒绝。
        result["_plan"]["kwargs"].update(enableTimer=0, schedule_time_str="", schedule_time="")
    return result


class ExecutionStore:
    """SQLite 原子认领跨线程生效；结果不明的发布永远不会自动重新领取。"""

    def __init__(self, path, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.db() as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS activations (
                    digest TEXT PRIMARY KEY, workspace TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS devices (
                    id TEXT PRIMARY KEY, workspace TEXT NOT NULL, digest TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL, platform TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                    last_seen REAL NOT NULL, created REAL NOT NULL,
                    port INTEGER, capability TEXT, version TEXT NOT NULL DEFAULT ''
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_employee_device ON devices(workspace) WHERE active=1;
                CREATE TABLE IF NOT EXISTS execution_jobs (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                    workspace TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
                    payload TEXT NOT NULL, query TEXT NOT NULL, target TEXT NOT NULL,
                    state TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'execute',
                    due_at REAL, device_id TEXT, lease TEXT, heartbeat REAL,
                    result TEXT, message TEXT NOT NULL DEFAULT '',
                    created REAL NOT NULL, updated REAL NOT NULL, request_id TEXT
                );
                CREATE INDEX IF NOT EXISTS execution_workspace ON execution_jobs(workspace,sequence);
                CREATE UNIQUE INDEX IF NOT EXISTS execution_idempotency
                    ON execution_jobs(workspace,request_id) WHERE request_id IS NOT NULL;
                CREATE TABLE IF NOT EXISTS execution_receipts (
                    job TEXT NOT NULL, lease_hash TEXT NOT NULL, device TEXT NOT NULL,
                    created REAL NOT NULL, PRIMARY KEY(job,lease_hash,device)
                );
            """)

    @contextmanager
    def db(self):
        """读取与修改都使用短事务，不让网络请求占用数据库锁。"""
        conn = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def issue_activation(self, workspace, lifetime=3600):
        token, now = secrets.token_urlsafe(32), self.clock()
        with self.db() as conn:
            conn.execute("DELETE FROM activations WHERE expires<?", (now,))
            conn.execute("INSERT INTO activations VALUES (?,?,?)", (fingerprint(token), workspace, now + lifetime))
        return token

    def activation_workspace(self, token):
        """先校验员工仍启用，再消费激活信息，不接受客户端自报员工编号。"""
        with self.db() as conn:
            row = conn.execute("SELECT workspace FROM activations WHERE digest=? AND expires>?",
                               (fingerprint(token), self.clock())).fetchone()
        if not row:
            raise ExecutionError("下载激活信息已失效，请登录网页重新下载")
        return row["workspace"]

    def activate(self, token, name, platform):
        now, device, credential = self.clock(), uuid.uuid4().hex, secrets.token_urlsafe(40)
        with self.db() as conn:
            row = conn.execute("SELECT workspace FROM activations WHERE digest=? AND expires>?",
                               (fingerprint(token), now)).fetchone()
            if not row:
                raise ExecutionError("下载激活信息已失效，请登录网页重新下载")
            if conn.execute("SELECT 1 FROM devices WHERE workspace=? AND active=1", (row["workspace"],)).fetchone():
                raise ExecutionError("该员工已有执行设备，请先在设置中更换设备")
            conn.execute("INSERT INTO devices(id,workspace,digest,name,platform,last_seen,created) VALUES (?,?,?,?,?,?,?)",
                         (device, row["workspace"], fingerprint(credential), str(name)[:100], str(platform)[:40], now, now))
            conn.execute("DELETE FROM activations WHERE workspace=?", (row["workspace"],))
        return {"id": device, "workspace": row["workspace"], "token": credential}

    def authenticate(self, token):
        with self.db() as conn:
            row = conn.execute("SELECT * FROM devices WHERE digest=? AND active=1", (fingerprint(token),)).fetchone()
        if not row:
            raise ExecutionError("设备凭证已撤销，请从网页登录后重新下载")
        return dict(row)

    def revoke(self, workspace):
        with self.db() as conn:
            conn.execute("UPDATE devices SET active=0,capability=NULL WHERE workspace=?", (workspace,))
            conn.execute("DELETE FROM activations WHERE workspace=?", (workspace,))
            conn.execute("UPDATE execution_jobs SET state='review',message='设备已更换，原任务结果待核对',updated=? "
                         "WHERE workspace=? AND state IN ('running','preparing_run')", (self.clock(), workspace))

    def heartbeat(self, device, *, port=None, capability=None, version="", active_job=None):
        """设备每隔数秒续租，并获知被取消的任务；过期不会自动重发发布。"""
        now = self.clock()
        if port is not None and (type(port) is not int or not 1024 <= port <= 65535):
            raise ExecutionError("本机服务端口无效")
        if capability is not None and (not isinstance(capability, str) or not 32 <= len(capability) <= 128):
            raise ExecutionError("本机访问凭证格式无效")
        with self.db() as conn:
            row = conn.execute("SELECT 1 FROM devices WHERE id=? AND active=1", (device,)).fetchone()
            if not row:
                raise ExecutionError("设备已撤销")
            conn.execute("UPDATE devices SET last_seen=?,port=?,capability=?,version=? WHERE id=?",
                         (now, port, capability, str(version)[:40], device))
            # 只续租实际运行的任务，插件重启后不能替崩溃前的未知任务无限续租。
            conn.execute("UPDATE execution_jobs SET heartbeat=? WHERE device_id=? AND id=? AND state IN ('running','preparing_run')",
                         (now, device, active_job))
            return [row[0] for row in conn.execute("SELECT id FROM execution_jobs WHERE device_id=? AND state IN ('cancelled','review')", (device,))]

    def enqueue(self, workspace, method, path, payload, *, query=None, due_at=None,
                prepared=False, request_id=None):
        now, job = self.clock(), payload.get("__detail_id") or uuid.uuid4().hex
        if due_at is not None and due_at <= now:
            raise ExecutionError("定时时间已过去，请重新安排")
        target = "server" if due_at is not None else "local"
        state = ("ready" if prepared else "preparing") if target == "server" else "queued"
        with self.db() as conn:
            if request_id:
                existing = conn.execute("SELECT * FROM execution_jobs WHERE workspace=? AND request_id=?",
                                        (workspace, str(request_id)[:128])).fetchone()
                if existing:
                    return self.decode(existing)
            conn.execute("INSERT INTO execution_jobs(id,workspace,method,path,payload,query,target,state,due_at,created,updated,request_id) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (job, workspace, method, path, json.dumps(payload, ensure_ascii=False),
                         json.dumps(query or {}), target, state, due_at, now, now, str(request_id)[:128] if request_id else None))
            return self.decode(conn.execute("SELECT * FROM execution_jobs WHERE id=?", (job,)).fetchone())

    @staticmethod
    def decode(row):
        if row is None:
            return None
        result = dict(row)
        for key in ("payload", "query", "result"):
            result[key] = json.loads(result[key]) if result.get(key) else None
        return result

    def _expire(self, conn):
        now = self.clock()
        conn.execute("UPDATE execution_jobs SET state='review',message='执行端连接中断，发布结果待核对；不会自动重复发布',updated=? "
                     "WHERE state IN ('running','preparing_run') AND heartbeat<?", (now, now - 180))
        conn.execute("UPDATE execution_jobs SET state='missed',message='到点前素材或授权尚未准备好，请重新安排',updated=? "
                     "WHERE state='preparing' AND due_at<=?", (now, now))
        # 已准备的服务器任务容许短暂排队；长时间错过不能静默补发。
        conn.execute("UPDATE execution_jobs SET state='missed',message='服务器未能在允许的时间窗口内执行，请重新安排',updated=? "
                     "WHERE state='ready' AND due_at<?", (now, now - 900))

    def _claim(self, device=None, server=False):
        now = self.clock()
        with self.db() as conn:
            self._expire(conn)
            if server:
                candidates = conn.execute("SELECT * FROM execution_jobs WHERE state='ready' AND due_at<=? ORDER BY due_at,sequence", (now,)).fetchall()
            else:
                owner = conn.execute("SELECT workspace FROM devices WHERE id=? AND active=1", (device,)).fetchone()
                if not owner:
                    raise ExecutionError("设备已撤销")
                candidates = conn.execute("SELECT * FROM execution_jobs WHERE workspace=? AND state IN ('queued','preparing') ORDER BY sequence",
                                          (owner["workspace"],)).fetchall()
            busy = {row[0] for row in conn.execute("SELECT workspace FROM execution_jobs WHERE state IN ('running','preparing_run')")}
            for row in candidates:
                if row["workspace"] in busy:
                    continue
                payload = json.loads(row["payload"])
                predecessors = payload.get("__after_jobs", [])
                if predecessors and row["state"] == "queued":
                    previous = [conn.execute("SELECT state,updated FROM execution_jobs WHERE id=? AND workspace=?", (key, row["workspace"])).fetchone()
                                for key in predecessors]
                    # 视频间隔从前一个视频全部账号结束时计算；结果待核对时停住后续链。
                    if any(item is None or item["state"] not in {"success", "failed", "cancelled", "missed"} for item in previous):
                        continue
                    if now < max(item["updated"] for item in previous) + payload.get("__delay", 0):
                        continue
                phase = "prepare" if row["state"] == "preparing" else "execute"
                lease = secrets.token_urlsafe(32)
                conn.execute("UPDATE execution_jobs SET state=?,phase=?,device_id=?,lease=?,heartbeat=?,updated=? WHERE id=?",
                             ("preparing_run" if phase == "prepare" else "running", phase, device, lease, now, now, row["id"]))
                return self.decode(conn.execute("SELECT * FROM execution_jobs WHERE id=?", (row["id"],)).fetchone())
        return None

    def claim_local(self, device):
        return self._claim(device)

    def claim_server(self):
        return self._claim(server=True)

    def validate_lease(self, job, lease, device=None):
        with self.db() as conn:
            row = conn.execute("SELECT * FROM execution_jobs WHERE id=?", (job,)).fetchone()
            if not row or not row["lease"] or not secrets.compare_digest(row["lease"], lease or "") or row["device_id"] != device:
                raise ExecutionConflict("任务领取凭证不匹配，原结果已保留待核对")
            if row["state"] in {"cancelled", "missed"}:
                raise ExecutionConflict("任务已取消或错过时间，原结果已保留待核对")
            return self.decode(row)

    def mark_prepared(self, job, lease, device):
        current = self.validate_lease(job, lease, device)
        if current["phase"] != "prepare":
            raise ExecutionError("任务不处于准备阶段")
        with self.db() as conn:
            conn.execute("INSERT OR IGNORE INTO execution_receipts VALUES (?,?,?,?)", (job, fingerprint(lease), device, self.clock()))
            conn.execute("UPDATE execution_jobs SET state=?,message=?,device_id=NULL,lease=NULL,heartbeat=NULL,updated=? WHERE id=?",
                         ("ready" if current["due_at"] > self.clock() else "missed", "服务器素材和授权已准备", self.clock(), job))

    def finish(self, job, lease, result, device=None):
        current = self.validate_lease(job, lease, device)
        if current["state"] in {"success", "failed"}:
            # 补报幂等，旧结果不能覆盖已经确认的终态。
            return
        with self.db() as conn:
            conn.execute("UPDATE execution_jobs SET state=?,result=?,message=?,updated=? WHERE id=?",
                         ("success" if result.get("code") == 200 else "failed", json.dumps(result, ensure_ascii=False),
                          str(result.get("msg") or "")[:2000], self.clock(), job))
            conn.execute("INSERT OR IGNORE INTO execution_receipts VALUES (?,?,?,?)", (job, fingerprint(lease), device or "server", self.clock()))

    def reported(self, job, lease, device):
        """结果已经确认入库时直接确认补报，包括准备完成后已切换到服务器的任务。"""
        with self.db() as conn:
            return conn.execute("SELECT 1 FROM execution_receipts WHERE job=? AND lease_hash=? AND device=?",
                                (job, fingerprint(lease or ""), device)).fetchone() is not None

    def renew_server(self, job, lease):
        self.validate_lease(job, lease)
        with self.db() as conn:
            conn.execute("UPDATE execution_jobs SET heartbeat=? WHERE id=? AND state='running'", (self.clock(), job))

    def cancel(self, job, workspace):
        with self.db() as conn:
            conn.execute("UPDATE execution_jobs SET "
                         "state=CASE WHEN state='running' AND phase='execute' THEN 'review' ELSE 'cancelled' END,"
                         "message=CASE WHEN state='running' AND phase='execute' THEN '已请求停止，执行结果待核对' ELSE '用户已取消' END,updated=? "
                         "WHERE id=? AND workspace=? AND state NOT IN ('success','failed','missed','review')", (self.clock(), job, workspace))

    def resolve(self, job, workspace, quantity, receipt):
        with self.db() as conn:
            row = conn.execute("SELECT * FROM execution_jobs WHERE id=? AND workspace=?", (job, workspace)).fetchone()
            if row is None:
                raise ExecutionError("任务不存在")
            payload = json.loads(row["payload"])
            expected = (payload.get("__platform") or {}).get("quantity", 1)
            if type(quantity) is not int or not 0 <= quantity <= expected:
                raise ExecutionError("成功数量超出任务范围")
            result = {"code": 200 if quantity == expected else 500,
                      "msg": receipt, "data": {"success_count": quantity, "manual_confirmation": True}}
            if row["state"] != "review":
                previous = json.loads(row["result"] or "{}")
                if previous == result:
                    return
                raise ExecutionConflict("当前任务没有待核对结果")
            conn.execute("UPDATE execution_jobs SET state=?,result=?,message=?,lease=NULL,heartbeat=NULL,updated=? WHERE id=?",
                         ("success" if quantity == expected else "failed", json.dumps(result, ensure_ascii=False),
                          receipt, self.clock(), job))

    def get(self, job, workspace):
        with self.db() as conn:
            self._expire(conn)
            return self.decode(conn.execute("SELECT * FROM execution_jobs WHERE id=? AND workspace=?", (job, workspace)).fetchone())

    def status(self, workspace):
        with self.db() as conn:
            self._expire(conn)
            device = conn.execute("SELECT * FROM devices WHERE workspace=? AND active=1", (workspace,)).fetchone()
            jobs = [self.decode(row) for row in conn.execute("SELECT * FROM execution_jobs WHERE workspace=? ORDER BY sequence DESC LIMIT 100", (workspace,))]
        public = None
        if device:
            public = {key: device[key] for key in ("id", "name", "platform", "last_seen", "version")}
            public["online"] = self.clock() - device["last_seen"] < 30
            if public["online"] and device["port"] and device["capability"]:
                public["endpoint"] = f"http://127.0.0.1:{device['port']}"
                public["capability"] = device["capability"]
        # 网页可以看自己的任务与结果，永远看不到设备长期凭证或领取凭据。
        return {"mode": "hybrid", "device": public, "jobs": [self.public_job(job) for job in jobs]}

    @staticmethod
    def public_job(job):
        result = {key: job.get(key) for key in ("id", "path", "target", "state", "phase", "due_at", "message", "created", "updated", "result")}
        # 只公开可识别的标题与账号昵称，不把设备凭据、平台配置或 Cookie 发给网页。
        payload = job.get("payload") or {}
        config = payload.get("account_configs") or payload
        result["title"] = config.get("articleTitle") or config.get("title") or ""
        result["account_name"] = config.get("account_name") or (payload.get("_plan") or {}).get("account", {}).get("userName", "")
        return result
