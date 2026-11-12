"""跨员工进程共享的浏览器调度：只保持员工串行，不设置全站并发上限。"""

from contextlib import contextmanager
from file_lease import lock_file
import os
from pathlib import Path
import sqlite3
import threading
import time
import uuid


class BrowserScheduler:
    """配置和排队记录放在共享目录，业务 Cookie 仍只留在员工目录。"""

    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.leases = self.path.with_suffix(".leases")
        self.leases.mkdir(exist_ok=True, mode=0o700)
        with self._db() as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS browser_requests (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    token TEXT UNIQUE NOT NULL, workspace TEXT NOT NULL,
                    state TEXT NOT NULL CHECK(state IN ('queued','running')),
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS browser_workspace ON browser_requests(workspace, sequence);
            """)

    @contextmanager
    def _db(self):
        conn = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def _transaction(self):
        # 员工串行检查与认领在同一事务中完成，同一员工不能被重复抢占。
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    def _dispatch(self, conn):
        # 租约使用操作系统文件锁，进程崩溃后自动失效，不用误杀长时间上传的正常任务。
        rows = conn.execute("SELECT * FROM browser_requests ORDER BY sequence").fetchall()
        live = []
        for row in rows:
            lease_path = self.leases / (row["token"] + ".lock")
            alive = False
            try:
                with lease_path.open("r+b") as handle:
                    try:
                        lock_file(handle)
                    except BlockingIOError:
                        alive = True
            except FileNotFoundError:
                pass
            if alive:
                live.append(row)
            else:
                conn.execute("DELETE FROM browser_requests WHERE token=?", (row["token"],))
                lease_path.unlink(missing_ok=True)
        busy = {row["workspace"] for row in live if row["state"] == "running"}
        for row in live:
            # 只跳过正在执行的同员工；不同员工同时放行，不读取旧名额配置。
            if row["state"] == "queued" and row["workspace"] not in busy:
                conn.execute("UPDATE browser_requests SET state='running' WHERE token=?", (row["token"],))
                busy.add(row["workspace"])

    def enqueue(self, workspace):
        if not isinstance(workspace, str) or not workspace:
            raise ValueError("浏览器任务缺少员工工作区")
        token, handle = uuid.uuid4().hex, None
        try:
            with self._transaction() as conn:
                # 先持有租约再登记，避免另一个进程把刚创建的请求当成已崩溃任务。
                handle = (self.leases / (token + ".lock")).open("x+b")
                handle.write(b"\0")
                handle.flush()
                lock_file(handle)
                conn.execute("INSERT INTO browser_requests(token,workspace,state,created_at) VALUES (?,?,'queued',?)",
                             (token, workspace, time.time()))
                self._dispatch(conn)
            return BrowserTicket(self, token, handle)
        except BaseException:
            if handle:
                handle.close()
            (self.leases / (token + ".lock")).unlink(missing_ok=True)
            raise

    def status(self, workspace, include_global=False):
        with self._transaction() as conn:
            self._dispatch(conn)
            rows = conn.execute("SELECT workspace,state FROM browser_requests").fetchall()
        def counts(selected):
            return {"running": sum(row["state"] == "running" for row in selected),
                    "queued": sum(row["state"] == "queued" for row in selected)}
        # 保留旧状态接口的键名，空上限表示已取消全站数量限制，不能伪装成一个大整数。
        result = {"max_concurrent": None, "mode": "unlimited", "workspace": counts([row for row in rows if row["workspace"] == workspace])}
        if include_global:
            result["global"] = counts(rows)
        return result


class BrowserTicket:
    """请求者持有员工执行状态的租约，取消或关闭时可以重复安全释放。"""

    def __init__(self, scheduler, token, handle):
        self.scheduler, self.token, self.handle = scheduler, token, handle
        self.lock = threading.Lock()
        self.closed = False

    def try_acquire(self):
        with self.lock:
            if self.closed:
                raise RuntimeError("浏览器请求已取消")
            with self.scheduler._transaction() as conn:
                self.scheduler._dispatch(conn)
                row = conn.execute("SELECT state FROM browser_requests WHERE token=?", (self.token,)).fetchone()
                if row is None:
                    raise RuntimeError("浏览器请求已失效，请重试")
                return row["state"] == "running"

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            try:
                with self.scheduler._transaction() as conn:
                    conn.execute("DELETE FROM browser_requests WHERE token=?", (self.token,))
                    self.scheduler._dispatch(conn)
            finally:
                # 即使数据库暂时不可写，其他进程也能通过已释放的文件锁回收残留记录。
                self.handle.close()
                (self.scheduler.leases / (self.token + ".lock")).unlink(missing_ok=True)


def worker_scheduler():
    """工作区和共享调度库路径仅由已认证网关传入，不能来自网页请求。"""
    return BrowserScheduler(os.environ["SAU_BROWSER_POOL"]), os.environ["SAU_WORKSPACE_ID"]
