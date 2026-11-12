"""泰卦部署改造：备份原站点，启用新服务，失败时恢复域名配置。"""

import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request

BASE = Path('/opt/taigua-publish')
RELEASE = Path(__file__).resolve().parents[1]
# 本次上线目标为海外社媒矩阵站点 ztwj，避免误改同服务器上的其他站点。
TARGET_DOMAIN = 'ztwj.asalegent.com'
CONFIG = Path('/www/server/panel/vhost/nginx') / f'{TARGET_DOMAIN}.conf'
NGINX = '/www/server/nginx/sbin/nginx'


def run(*args):
    subprocess.run(args, check=True)


def main():
    assert (RELEASE / 'deployment/prepared.json').exists(), '请先完成运行环境准备'
    backup = BASE / 'backups' / time.strftime('%Y%m%d-%H%M%S')
    backup.mkdir(parents=True)
    # 宝塔可能只保留站点记录而尚未生成主 Nginx 配置；没有旧配置时仍保留目录备份并创建新配置。
    had_config = CONFIG.exists()
    if had_config:
        shutil.copy2(CONFIG, backup / CONFIG.name)
    shutil.make_archive(str(backup / 'site-root'), 'gztar', f'/www/wwwroot/{TARGET_DOMAIN}')
    current = BASE / 'current'
    old_release = current.resolve() if current.exists() else None
    temporary = BASE / 'current.next'
    temporary.symlink_to(RELEASE)
    temporary.replace(current)
    shutil.copy2(RELEASE / 'deployment/taigua-publish.service', '/etc/systemd/system/taigua-publish.service')
    run('systemctl', 'daemon-reload')
    try:
        run('systemctl', 'start', 'taigua-publish.service')
        # 匿名访问业务接口必须返回 401，确认网关已启用认证后才接入域名。
        for attempt in range(60):
            try:
                urllib.request.urlopen('http://127.0.0.1:18870/api/team/me', timeout=2)
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    break
                raise
            except urllib.error.URLError:
                if attempt == 59:
                    raise
                time.sleep(0.5)
            else:
                raise RuntimeError('匿名接口未被认证拦截，取消上线')
        shutil.copy2(RELEASE / f'deployment/{TARGET_DOMAIN}.conf', CONFIG)
        run(NGINX, '-t')
        run(NGINX, '-s', 'reload')
        # Nginx 重载后旧工作进程会短暂继续响应，等待新配置完成接管再验收。
        for attempt in range(40):
            try:
                with urllib.request.urlopen(f'https://{TARGET_DOMAIN}', timeout=5) as response:
                    if '泰卦智能发布' in response.read().decode():
                        break
            except (urllib.error.URLError, TimeoutError):
                pass
            if attempt == 39:
                raise RuntimeError('域名仍未返回新系统页面，取消上线')
            time.sleep(0.5)
        run('systemctl', 'enable', 'taigua-publish.service')
    except BaseException:
        if had_config:
            shutil.copy2(backup / CONFIG.name, CONFIG)
        else:
            CONFIG.unlink(missing_ok=True)
        run(NGINX, '-t')
        run(NGINX, '-s', 'reload')
        run('systemctl', 'stop', 'taigua-publish.service')
        if old_release:
            current.unlink()
            current.symlink_to(old_release)
        raise
    (BASE / 'deployment-result.json').write_text(json.dumps({'release': str(RELEASE), 'backup': str(backup), 'domain': f'https://{TARGET_DOMAIN}', 'status': 'active'}, ensure_ascii=False))
    print('ACTIVE：域名已启用，原配置备份位于', backup)


if __name__ == '__main__':
    main()
