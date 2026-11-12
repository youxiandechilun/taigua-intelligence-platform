"""本机海外登录回归：仅模拟内部响应，不连接或登录真实平台。"""

import json
from queue import Queue
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from flask import Flask, g
import requests

from hybrid_gateway import HybridGateway, overseas_login_needs_update
from local_agent import login_response_result
from impl.registry import get_platform
from tests_team.test_meta_authentication import authenticated_page


class LocalLoginTests(unittest.TestCase):
    """验证不支持平台、失败状态及断流都能明确结束登录。"""

    def response(self, content_type, content, status=200):
        """构造真实 requests 响应，覆盖字节流解析和连接关闭行为。"""
        response = requests.Response()
        response.status_code = status
        response.headers["Content-Type"] = content_type
        response._content = content
        response._content_consumed = True
        return response

    def test_unsupported_platform_json_explains_plugin_update(self):
        """旧插件的 JSON 错误不能变成笼统的未授权提示。"""
        response = self.response("application/json", json.dumps({"code": 400, "msg": "不支持的平台类型"}).encode(), 400)
        result = login_response_result(response)
        self.assertEqual(result["code"], 500)
        self.assertIn("重新下载", result["msg"])

    def test_failed_status_keeps_legacy_message(self):
        """LinkedIn/Pinterest 使用 failed 和 message 时仍返回具体失败原因。"""
        content = 'data: {"status":"waiting"}\n\ndata:{"status":"failed","message":"登录等待超时"}\n\n'
        result = login_response_result(self.response("text/event-stream; charset=utf-8", content.encode()))
        self.assertEqual(result, {"code": 500, "msg": "登录等待超时"})

    def test_success_requires_explicit_terminal_event(self):
        """心跳、损坏事件与断流均不能冒充授权成功。"""
        prefix = b': heartbeat\n\ndata: invalid\n\ndata: {"status":"waiting"}\n\n'
        result = login_response_result(self.response("text/event-stream", prefix))
        self.assertEqual(result["code"], 500)
        success = login_response_result(self.response("text/event-stream", prefix + b'data: 200\n\n'))
        self.assertEqual(success["code"], 200)
        malformed = login_response_result(self.response("text/html", b"unavailable", 502))
        self.assertEqual(malformed["code"], 500)

    def test_gateway_blocks_unsupported_local_plugin_before_queueing(self):
        """六个平台使用旧插件时均返回可显示的 SSE，且不会创建注定失败的任务。"""
        app = Flask(__name__)
        gateway = HybridGateway.__new__(HybridGateway)
        gateway.store = SimpleNamespace(status=Mock(return_value={"device": {"version": "2026.11.09.2"}}))
        gateway.enqueue = Mock(side_effect=AssertionError("旧插件不应领取不支持的平台"))
        for platform_type in range(101, 107):
            with self.subTest(platform=platform_type), app.test_request_context(f"/login?type={platform_type}&execution=local"):
                g.session = {"workspace_id": "synthetic-employee"}
                response = gateway.intercept("login")
                self.assertEqual(response.mimetype, "text/event-stream")
                event = json.loads(response.get_data(as_text=True).removeprefix("data: "))
                self.assertEqual(event["status"], "error")
                self.assertIn("系统设置", event["msg"])
        gateway.enqueue.assert_not_called()

    def test_version_gate_keeps_current_local_and_server_paths(self):
        """数字版本比较不阻挡新插件；服务器授权不依赖员工插件版本。"""
        self.assertFalse(overseas_login_needs_update("101", "2026.11.11.3"))
        self.assertTrue(overseas_login_needs_update("101", "2026.11.11.2"))
        self.assertFalse(overseas_login_needs_update("101", "2026.11.11.10"))
        self.assertTrue(overseas_login_needs_update("101", ""))
        self.assertTrue(overseas_login_needs_update("8", "2026.11.11.2"))
        self.assertFalse(overseas_login_needs_update("3", "2026.11.09.2"))
        app = Flask(__name__)
        gateway = HybridGateway.__new__(HybridGateway)
        gateway.store = SimpleNamespace(status=Mock(side_effect=AssertionError("服务器授权不检查本机设备")))
        with app.test_request_context("/login?type=101&execution=server"):
            g.session = {"workspace_id": "synthetic-employee"}
            self.assertIsNone(gateway.intercept("login"))


class OverseasLoginCompletionTests(unittest.IsolatedAsyncioTestCase):
    """模拟用户完成授权，检查六个平台均通知系统并回收登录浏览器。"""

    async def test_every_adapter_reports_saved_login_and_closes_its_browser(self):
        """仅替换平台网页和授权保存，不进行真实账号验证或对外操作。"""
        for platform_id in range(101, 107):
            with self.subTest(platform=platform_id):
                platform = get_platform(platform_id)
                self.assertIsNotNone(platform, "安装包必须包含海外平台注册模块")
                page = authenticated_page(platform.platform_key)
                page.goto = AsyncMock()
                context = SimpleNamespace(pages=[], new_page=AsyncMock(return_value=page), close=AsyncMock(), cookies=page.context.cookies)
                page.context = context
                browser = SimpleNamespace()
                platform.create_browser = AsyncMock(return_value=browser)
                platform.create_context = AsyncMock(return_value=context)
                platform.close_browser = AsyncMock()
                messages = Queue()

                async def saved(*args, **kwargs):
                    # 保存器发送成功信号后，适配器仍需关闭本次会话，让用户回到系统。
                    messages.put(json.dumps({"status": "200"}))

                module = "impl.meta.platform" if platform_id in {101, 102} else type(platform).__module__
                with patch(module + ".save_login_result", new=AsyncMock(side_effect=saved)) as save, \
                        patch("impl._overseas_auth.asyncio.sleep", new=AsyncMock()):
                    await platform.login("synthetic-login", messages)
                    save.assert_awaited_once()
                self.assertEqual(json.loads(messages.get_nowait())["status"], "200")
                context.close.assert_awaited_once()
                platform.close_browser.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
