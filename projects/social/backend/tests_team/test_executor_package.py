"""验证单入口应用的员工关联隔离和窗口状态，测试不安装真实员工插件。"""

import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

from executor_package import CONFIG_MAGIC, MAC_PROGRAM, WINDOWS_ENTRY, personalize_executor
from executor_status import display_status
from local_agent import LocalAgent


class ExecutorPackageTests(unittest.TestCase):
    def test_windows_single_entry_keeps_each_employees_activation_separate(self):
        """不同员工下载不得交叉复用一次性信息，运行载荷仍保持原样。"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "base.zip"
            payload = b"MZ-synthetic-launcher-and-payload"
            with zipfile.ZipFile(package, "w") as archive:
                archive.writestr(WINDOWS_ENTRY, payload)
            for workspace in ("a" * 32, "b" * 32):
                config = {"server": "https://example.invalid", "workspace": workspace, "activation": "synthetic-" + workspace}
                target = root / (workspace + ".zip")
                personalize_executor(package, target, config, "windows-x64")
                with zipfile.ZipFile(target) as archive:
                    self.assertEqual(archive.namelist(), [WINDOWS_ENTRY])
                    data = archive.read(WINDOWS_ENTRY)
                self.assertEqual(data[-16:], CONFIG_MAGIC)
                size = struct.unpack("<Q", data[-24:-16])[0]
                self.assertEqual(json.loads(data[-24-size:-24]), config)
                self.assertEqual(data[:-24-size], payload)
            with zipfile.ZipFile(package) as archive:
                self.assertEqual(archive.read(WINDOWS_ENTRY), payload)

    def test_mac_keeps_association_inside_the_only_visible_application(self):
        """解压外层只有应用，不额外散落配置文件、源码目录或启动脚本。"""
        with tempfile.TemporaryDirectory() as directory:
            package, target = Path(directory) / "base.zip", Path(directory) / "download.zip"
            with zipfile.ZipFile(package, "w") as archive:
                archive.writestr("泰卦插件.app/Contents/Info.plist", b"synthetic")
            config = {"workspace": "a" * 32, "server": "https://example.invalid", "activation": "synthetic-only"}
            personalize_executor(package, target, config, "macos-x64")
            with zipfile.ZipFile(target) as archive:
                self.assertEqual({name.split('/')[0] for name in archive.namelist()}, {"泰卦插件.app"})
                self.assertEqual(json.loads(archive.read(MAC_PROGRAM + "/activation.json")), config)

    def test_expired_online_status_is_not_shown_as_connected(self):
        """后台已退出或失去心跳时窗口不能继续显示可用。"""
        self.assertFalse(display_status({"state": "online", "updated_at": 10}, now=41)[2])
        self.assertTrue(display_status({"state": "online", "updated_at": 10}, now=20)[2])
        self.assertEqual(display_status({"state": "error", "message": "合成启动失败"})[0], "启动失败")

    def test_status_file_never_contains_activation_or_device_credentials(self):
        """前台状态文件只保存展示字段，避免日志按钮或截图暴露员工凭据。"""
        with tempfile.TemporaryDirectory() as directory:
            agent = LocalAgent({"server": "https://example.invalid", "workspace": "a" * 32,
                                "activation": "synthetic-private-value"}, root=directory)
            agent.status("online", "合成就绪")
            status = json.loads((Path(directory) / "status.json").read_text())
            self.assertEqual(set(status), {"state", "message", "updated_at", "pid", "version"})
            self.assertNotIn("synthetic-private-value", json.dumps(status))


if __name__ == "__main__":
    unittest.main()
