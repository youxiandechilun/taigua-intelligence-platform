"""混合执行回归：验证员工隔离、持久队列和关机后的服务器定时任务。"""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from hybrid_execution import ExecutionStore, ExecutionError, schedule_timestamp


class HybridExecutionTests(unittest.TestCase):
    """使用合成任务检查领取和恢复，不连接任何真实发布平台。"""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.now = 1800000000.0
        self.path = Path(self.directory.name) / "execution.sqlite3"
        self.store = ExecutionStore(self.path, clock=lambda: self.now)
        self.alice, self.bob = "a" * 32, "b" * 32
        self.a = self.activate(self.alice)
        self.b = self.activate(self.bob)

    def tearDown(self):
        self.directory.cleanup()

    def activate(self, workspace):
        """一次性下载信息只能换取所属员工自己的设备凭证。"""
        token = self.store.issue_activation(workspace)
        return self.store.activate(token, "合成执行端", "test")

    def enqueue(self, workspace, **values):
        return self.store.enqueue(workspace, "POST", "/postVideo", {"title": "合成内容"}, **values)

    def test_activation_cannot_be_replayed_or_used_after_expiry(self):
        token = self.store.issue_activation("c" * 32, lifetime=10)
        result = self.store.activate(token, "测试", "test")
        self.assertEqual(self.store.authenticate(result["token"])["workspace"], "c" * 32)
        with self.assertRaises(ExecutionError):
            self.store.activate(token, "重复", "test")
        expired = self.store.issue_activation("d" * 32, lifetime=10)
        self.now += 11
        with self.assertRaises(ExecutionError):
            self.store.activate(expired, "过期", "test")

    def test_claim_is_atomic_and_same_employee_serial(self):
        first, second = self.enqueue(self.alice), self.enqueue(self.alice)
        other = self.enqueue(self.bob)
        with ThreadPoolExecutor(max_workers=6) as executor:
            claims = list(executor.map(lambda _: self.store.claim_local(self.a["id"]), range(6)))
        claimed = [row for row in claims if row]
        self.assertEqual([row["id"] for row in claimed], [first["id"]])
        self.assertEqual(self.store.claim_local(self.b["id"])["id"], other["id"])
        self.assertIsNone(self.store.claim_local(self.a["id"]))
        self.store.finish(first["id"], claimed[0]["lease"], {"code": 200, "data": {}}, self.a["id"])
        self.assertEqual(self.store.claim_local(self.a["id"])["id"], second["id"])

    def test_device_cannot_read_or_finish_another_employee_task(self):
        job = self.enqueue(self.alice)
        claim = self.store.claim_local(self.a["id"])
        self.assertIsNone(self.store.get(job["id"], self.bob))
        with self.assertRaises(ExecutionError):
            self.store.finish(job["id"], claim["lease"], {"code": 200}, self.b["id"])

    def test_pending_work_survives_restart_but_unknown_result_is_not_republished(self):
        job = self.enqueue(self.alice)
        restarted = ExecutionStore(self.path, clock=lambda: self.now)
        claim = restarted.claim_local(self.a["id"])
        self.assertEqual(claim["id"], job["id"])
        self.now += 181
        self.assertEqual(restarted.get(job["id"], self.alice)["state"], "review")
        self.assertIsNone(restarted.claim_local(self.a["id"]))
        # 原设备补报同一领取结果仍可核对入库，不再自动重发。
        restarted.finish(job["id"], claim["lease"], {"code": 200}, self.a["id"])
        self.assertEqual(restarted.get(job["id"], self.alice)["state"], "success")
        restarted.finish(job["id"], claim["lease"], {"code": 200}, self.a["id"])

    def test_scheduled_job_runs_on_server_while_employee_device_is_offline(self):
        job = self.enqueue(self.alice, due_at=self.now + 600, prepared=True)
        self.assertEqual(job["target"], "server")
        self.assertIsNone(self.store.claim_local(self.a["id"]))
        self.assertIsNone(self.store.claim_server())
        self.now += 601
        claim = self.store.claim_server()
        self.assertEqual(claim["id"], job["id"])
        self.assertEqual(claim["phase"], "execute")

    def test_schedule_is_not_ready_until_artifacts_are_prepared(self):
        job = self.enqueue(self.alice, due_at=self.now + 600, prepared=False)
        claim = self.store.claim_local(self.a["id"])
        self.assertEqual(claim["phase"], "prepare")
        self.store.mark_prepared(job["id"], claim["lease"], self.a["id"])
        self.assertEqual(self.store.get(job["id"], self.alice)["state"], "ready")
        self.assertIsNone(self.store.claim_server())

    def test_missed_preparation_is_reported_instead_of_silent_late_publish(self):
        job = self.enqueue(self.alice, due_at=self.now + 600, prepared=False)
        self.now += 601
        self.assertIsNone(self.store.claim_local(self.a["id"]))
        self.assertEqual(self.store.get(job["id"], self.alice)["state"], "missed")

    def test_cancellation_and_revocation_stop_new_claims(self):
        job = self.enqueue(self.alice)
        self.store.cancel(job["id"], self.alice)
        self.assertIsNone(self.store.claim_local(self.a["id"]))
        self.enqueue(self.alice)
        self.store.revoke(self.alice)
        with self.assertRaises(ExecutionError):
            self.store.authenticate(self.a["token"])

    def test_request_id_makes_double_click_idempotent(self):
        first = self.enqueue(self.alice, request_id="same-click")
        second = self.enqueue(self.alice, request_id="same-click")
        self.assertEqual(first["id"], second["id"])

    def test_schedule_time_uses_beijing_timezone_and_rejects_invalid_dates(self):
        self.assertEqual(schedule_timestamp({"scheduleTime": "2026-11-10 08:00:00"}),
                         schedule_timestamp({"scheduleTime": "2026-11-10T00:00:00Z"}))
        self.assertIsNone(schedule_timestamp({"enableTimer": 0}))
        with self.assertRaises(ExecutionError):
            schedule_timestamp({"scheduleTime": "随便的时间"})

    def test_restarted_device_does_not_renew_an_old_unknown_job(self):
        """新进程心跳不等于旧任务还活着，必须只续租当前实际执行的任务。"""
        job = self.enqueue(self.alice)
        self.store.claim_local(self.a["id"])
        self.now += 181
        self.store.heartbeat(self.a["id"])
        self.assertEqual(self.store.get(job["id"], self.alice)["state"], "review")

    def test_preparation_receipt_survives_switch_to_server(self):
        """准备完成的确认丢包后，补报不会把同一任务重新准备或发布。"""
        job = self.enqueue(self.alice, due_at=self.now + 600)
        claim = self.store.claim_local(self.a["id"])
        self.store.mark_prepared(job["id"], claim["lease"], self.a["id"])
        self.assertTrue(self.store.reported(job["id"], claim["lease"], self.a["id"]))

    def test_server_due_jobs_keep_employee_order_without_global_cap(self):
        """多员工定时任务同时到点均可领取，同一员工后续任务仍需等待。"""
        first = self.enqueue(self.alice, due_at=self.now + 120, prepared=True)
        second = self.enqueue(self.alice, due_at=self.now + 120, prepared=True)
        others = [self.enqueue(f"server-employee-{index}", due_at=self.now + 120, prepared=True) for index in range(20)]
        self.now += 121
        claims = [self.store.claim_server() for _ in range(21)]
        self.assertEqual({row["id"] for row in claims}, {first["id"], *[row["id"] for row in others]})
        self.assertIsNone(self.store.claim_server())
        claim = next(row for row in claims if row["id"] == first["id"])
        self.store.finish(first["id"], claim["lease"], {"code": 200})
        self.assertEqual(self.store.claim_server()["id"], second["id"])

    def test_dispatch_starts_all_due_employees_in_same_round(self):
        """服务器分发器不能在持久队列之外再暗中设置一个全站运行数量门槛。"""
        from hybrid_gateway import HybridGateway
        gateway = HybridGateway.__new__(HybridGateway)
        gateway.stopping = SimpleNamespace(wait=Mock(side_effect=[False, True]), is_set=lambda: False)
        gateway.running = {}
        gateway.billing = SimpleNamespace(reconcile=Mock())
        jobs = [{"id": str(index), "workspace": "employee-" + str(index)} for index in range(20)]
        gateway.store = SimpleNamespace(claim_server=Mock(side_effect=[*jobs, None]))
        gateway.active_employee = lambda _: True
        gateway.execute_server = Mock()
        # 测试只统计分发，不启动真实线程、浏览器或平台发布。
        with patch("hybrid_gateway.threading.Thread") as thread:
            gateway.dispatch()
            self.assertEqual(thread.call_count, 20)
            self.assertEqual(thread.return_value.start.call_count, 20)
        self.assertEqual(set(gateway.running), {job["id"] for job in jobs})

    def test_worker_restart_keeps_broker_managed_history(self):
        """真实工作进程的启动清理只取消旧内存任务，不误伤持久化定时任务。"""
        job = self.enqueue(self.alice, due_at=self.now + 600, prepared=True)
        source = '''
import json,sqlite3
from init_db import init_database,migrate_database
init_database();migrate_database()
from conf import BASE_DIR
with sqlite3.connect(BASE_DIR/'db/database.db') as c:
 c.execute("INSERT INTO publish_batches(id,type) VALUES ('synthetic-batch','video')")
 c.execute("INSERT INTO publish_details(id,batch_id,status) VALUES (?,'synthetic-batch','queued')", (JOB,))
 c.execute("INSERT INTO publish_details(id,batch_id,status) VALUES ('legacy-orphan','synthetic-batch','running')")
import ext_api.task_queue
with sqlite3.connect(BASE_DIR/'db/database.db') as c:
 print(json.dumps(dict(c.execute('SELECT id,status FROM publish_details'))))
'''
        result = subprocess.run([sys.executable, "-c", "JOB=" + repr(job["id"]) + "\n" + source],
            cwd=Path(__file__).resolve().parents[1], env={**os.environ,
                "SAU_DATA_DIR": str(Path(self.directory.name) / "workspace"),
                "SAU_EXECUTION_DB": str(self.path), "SAU_WORKSPACE_ID": self.alice},
            capture_output=True, text=True, check=True, timeout=30)
        states = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(states[job["id"]], "queued")
        self.assertEqual(states["legacy-orphan"], "cancelled")


if __name__ == "__main__":
    unittest.main()
