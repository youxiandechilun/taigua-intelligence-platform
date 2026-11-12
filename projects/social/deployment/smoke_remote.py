"""泰卦部署改造：上线前离线核对服务器浏览器、视频工具和员工权限。"""

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def main():
    # 字库属于服务器浏览器依赖，安装成功后还需核对中文字体匹配结果。
    family = subprocess.check_output(['fc-match', '-f', '%{family}', 'sans-serif:lang=zh-cn']).decode()
    assert 'CJK' in family, '服务器未匹配到中文字体'
    # 只创建临时测试数据，不初始化正式管理员，不操作真实平台账号。
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s',
                    str(ROOT / 'backend/tests_team'), '-v'], check=True)
    from server_browser import launch_sync, launch_async
    with tempfile.TemporaryDirectory(prefix='taigua-smoke-') as temporary:
        directory = Path(temporary)
        # 冒烟检查只使用临时工作区及独立调度库，不占用正式员工的浏览器名额。
        os.environ['SAU_BROWSER_POOL'] = str(directory / 'browser-pool.sqlite3')
        os.environ['SAU_WORKSPACE_ID'] = 'smoke-test'
        browser = launch_sync()
        page = browser.new_page()
        page.goto('data:text/html,<title>TAIGUA_SMOKE</title><h1>OK</h1>')
        assert page.title() == 'TAIGUA_SMOKE'
        page.screenshot(path=str(directory / 'browser.png'))
        browser.close()

        async def check_async():
            # 扫码与发布分别覆盖普通浏览器和持久化上下文的生命周期。
            browser = await launch_async()
            page = await browser.new_page()
            await page.goto('data:text/html,<title>ASYNC_OK</title>')
            assert await page.title() == 'ASYNC_OK'
            await browser.close()
            context = await launch_async(str(directory / 'profile'))
            page = await context.new_page()
            await page.goto('data:text/html,<title>PROFILE_OK</title>')
            assert await page.title() == 'PROFILE_OK'
            await context.close()

        asyncio.run(check_async())
        video = directory / 'test.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
                        '-i', 'color=c=black:s=64x64:d=0.2', '-c:v', 'libx264',
                        '-y', str(video)], check=True)
        info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error',
                          '-show_format', '-of', 'json', str(video)]))
        assert float(info['format']['duration']) > 0
    print('SMOKE_OK：员工隔离、三种浏览器启动和视频处理均通过。', flush=True)


if __name__ == '__main__':
    main()
