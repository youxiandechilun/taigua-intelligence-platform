"""在安装包自带解释器中验证运行环境；仅用临时工作区与合成平台，不安装启动项。"""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


def main():
    root = Path(__file__).resolve().parents[1]
    package = Path(sys.argv[1]).resolve()
    backend = package / "backend"
    sys.path[:0] = [str(backend), str(root / "backend")]
    os.environ["TAIGUA_FIXTURE_BACKEND"] = str(backend)
    suite = unittest.TestSuite()
    # 最终包同时验证混合链路与抖音编辑区，避免只校验开发环境中的兼容代码。
    for name in ("test_hybrid_integration", "test_douyin_editor"):
        spec = importlib.util.spec_from_file_location("native_" + name, root / "backend/tests_team" / (name + ".py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise RuntimeError("安装包合成链路验证失败")
    from local_browser import launch_async
    from local_agent import LocalAgent
    from services.ffmpeg_service import _find_ffmpeg

    async def verify_browser():
        """打开合成页面并恢复隔离 Cookie，验证官方浏览器和依赖可运行。"""
        browser = await launch_async(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        await page.set_content("<h1>泰卦插件运行环境验证</h1>")
        assert await page.locator("h1").inner_text() == "泰卦插件运行环境验证"
        await context.add_cookies([{"name": "synthetic", "value": "isolated", "domain": "example.invalid", "path": "/"}])
        state = await context.storage_state()
        await context.close()
        restored = await browser.new_context(storage_state=state)
        assert (await restored.cookies())[0]["value"] == "isolated"
        await restored.close()
        await browser.close()
    asyncio.run(verify_browser())
    subprocess.run([_find_ffmpeg(), "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    with tempfile.TemporaryDirectory(prefix="taigua-worker-native-") as directory:
        agent = LocalAgent({"server": "http://127.0.0.1:9", "workspace": "f" * 32}, root=directory)
        try:
            agent.start_worker()
            with agent.worker_request("GET", "/api/health", timeout=5) as response:
                assert response.status_code == 200
        finally:
            agent.close()
    print("NATIVE_RUNTIME_OK " + json.dumps({"python": sys.version.split()[0], "platform": sys.platform,
          "browser": "synthetic-only", "worker": "ok", "ffmpeg": "ok", "installed_startup_item": False}))


if __name__ == "__main__":
    main()
