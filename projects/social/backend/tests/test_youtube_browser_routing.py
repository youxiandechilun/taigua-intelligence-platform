"""YouTube 登录浏览器路由测试：Google 登录不能走服务器 headless 浏览器。"""

import json
import os
import sys
import unittest
from pathlib import Path
from queue import Queue
from unittest.mock import AsyncMock, patch


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from impl._browser import create_persistent_context  # noqa: E402
from impl.youtube.platform import YoutubePlatform  # noqa: E402


class YoutubeBrowserRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_plugin_uses_normal_system_browser_context(self):
        context = object()
        with patch.dict(os.environ, {"SAU_BROWSER_ENGINE": "local-playwright"}, clear=False), \
                patch("local_browser.launch_external_persistent_context",
                      new=AsyncMock(return_value=context)) as launch:
            result = await create_persistent_context("/tmp/yt-profile", headless=False)
        self.assertIs(result, context)
        launch.assert_awaited_once_with("/tmp/yt-profile")

    async def test_server_browser_returns_actionable_google_login_message(self):
        messages = []
        with patch.dict(os.environ, {"SAU_BROWSER_ENGINE": "playwright"}, clear=False):
            queue = Queue()
            await YoutubePlatform().login("test-id", queue)
        self.assertEqual(queue.qsize(), 1)
        payload = json.loads(queue.get())
        self.assertEqual(payload["status"], "500")
        self.assertIn("员工电脑", payload["msg"])
        self.assertIn("Google", payload["msg"])


if __name__ == "__main__":
    unittest.main()
