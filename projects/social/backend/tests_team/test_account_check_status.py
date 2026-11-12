"""在临时工作区验证检测失败不会清除有效账号状态。"""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class AccountCheckStatusTests(unittest.TestCase):
    """独立进程隔离模块配置和数据库，不读取正式员工账号。"""

    def test_uncertain_checks_preserve_status_and_real_logout_updates_it(self):
        """单个检查、批量检查均保留未确认状态，真实退出仍必须更新为异常。"""
        script = '''
import sqlite3
from types import SimpleNamespace
from unittest.mock import AsyncMock
from init_db import init_database, migrate_database
init_database(); migrate_database()
import app as module
from impl._overseas_auth import AccountCheckUnavailable
client=module.app.test_client()
with sqlite3.connect(module.DB_PATH) as conn:
    conn.execute("INSERT INTO user_info (id,type,filePath,userName,status) VALUES (1,102,'synthetic.json','合成账号',1)")
module.get_platform=lambda identifier: SimpleNamespace(check_cookie=AsyncMock(side_effect=AccountCheckUnavailable('检测未完成')))
response=client.get('/checkAccount?id=1')
assert response.status_code==200, response.status_code
result=response.get_json()
assert result['data']['valid'] is None and result['data']['checked'] is False, result
result=client.get('/getValidAccounts?ids=1').get_json()
assert result['data'][0][4]==1, result
with sqlite3.connect(module.DB_PATH) as conn:
    assert conn.execute('SELECT status FROM user_info WHERE id=1').fetchone()[0]==1
for valid in (False,True):
    module.get_platform=lambda identifier: SimpleNamespace(check_cookie=AsyncMock(return_value=valid))
    result=client.get('/checkAccount?id=1').get_json()
    assert result['data']['valid'] is valid and result['data']['checked'] is True, result
    with sqlite3.connect(module.DB_PATH) as conn:
        assert conn.execute('SELECT status FROM user_info WHERE id=1').fetchone()[0]==int(valid)
print('ACCOUNT_CHECK_STATUS_OK')
'''
        with tempfile.TemporaryDirectory(prefix="taigua-check-status-") as directory:
            environment = {**os.environ, "SAU_DATA_DIR": directory, "SAU_SERVER_MODE": "1"}
            environment.pop("SAU_WORKER_TOKEN", None)
            result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
                                    env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-3000:])
            self.assertIn("ACCOUNT_CHECK_STATUS_OK", result.stdout)
