"""泰卦部署改造：准备独立运行环境；此步骤不启动服务、不切换公网域名。"""

import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tarfile
import urllib.request

BASE = Path('/opt/taigua-publish')
RELEASE = Path(__file__).resolve().parents[1]
STATE = BASE / 'shared'


def run(*args, **kwargs):
    print('运行：', ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True, **kwargs)


def download(url, path):
    print('下载：', url, flush=True)
    with urllib.request.urlopen(url, timeout=120) as response, Path(path).open('wb') as target:
        shutil.copyfileobj(response, target)


def main():
    BASE.mkdir(exist_ok=True)
    STATE.mkdir(exist_ok=True, mode=0o700)
    # 安装来自系统发行版仓库的浏览器共享库，不升级或重启已有业务。
    run('dnf', '-y', 'install', 'libX11', 'libXcomposite', 'libXdamage', 'libXext',
        'libXfixes', 'libXrandr', 'libxcb', 'libxkbcommon', 'nss', 'nspr', 'atk',
        'at-spi2-atk', 'at-spi2-core', 'cups-libs', 'libdrm', 'mesa-libgbm',
        'alsa-lib', 'pango', 'cairo', 'libXScrnSaver', 'dejavu-sans-fonts',
        # 真实平台登录页包含中文，缺少中文字库会导致按钮及说明显示成方框。
        'google-noto-sans-cjk-ttc-fonts')
    venv = BASE / 'venv'
    if not (venv / 'bin/python').exists():
        run('/usr/bin/python3.11', '-m', 'venv', '--without-pip', venv)
    python = venv / 'bin/python'
    if subprocess.run([str(python), '-m', 'pip', '--version'], capture_output=True).returncode:
        script = BASE / 'get-pip.py'
        download('https://bootstrap.pypa.io/get-pip.py', script)
        run(python, script)
    run(python, '-m', 'pip', 'install', '--no-cache-dir', '--only-binary=:all:', '-r', RELEASE / 'backend/requirements-server.txt')
    browsers = BASE / 'browsers'
    env = {**os.environ, 'PLAYWRIGHT_BROWSERS_PATH': str(browsers)}
    run(python, '-m', 'playwright', 'install', 'chromium', '--only-shell', env=env)
    bin_dir = BASE / 'bin'
    bin_dir.mkdir(exist_ok=True)
    if not (bin_dir / 'ffprobe').exists():
        # 下载 FFmpeg 官网列出的 BtbN Linux 发行包，同时提供 ffmpeg 和 ffprobe。
        release_base = 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/latest/'
        archive = BASE / 'ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz'
        checksums = BASE / 'ffmpeg-checksums.sha256'
        download(release_base + 'checksums.sha256', checksums)
        download(release_base + archive.name, archive)
        line = next(line for line in checksums.read_text().splitlines() if line.endswith(archive.name))
        expected = line.split()[0]
        with archive.open('rb') as downloaded:
            actual = hashlib.file_digest(downloaded, 'sha256').hexdigest()
        assert actual == expected, 'FFmpeg 下载校验失败'
        # 保留发行包供许可证与对应构建信息核对，只提取可执行文件，不运行包内脚本。
        with tarfile.open(archive) as tar:
            for binary in ('ffmpeg', 'ffprobe'):
                member = next(m for m in tar.getmembers() if m.name.endswith('/bin/' + binary) and m.isfile())
                with tar.extractfile(member) as source, (bin_dir / binary).open('wb') as target:
                    shutil.copyfileobj(source, target)
                (bin_dir / binary).chmod(0o755)
        run(bin_dir / 'ffmpeg', '-version')
        run(bin_dir / 'ffprobe', '-version')
    # 使用不可登录的专用系统用户，应用不能修改其他站点、Nginx 或自身源文件。
    try:
        account = pwd.getpwnam('taigua-publish')
    except KeyError:
        run('useradd', '--system', '--home-dir', STATE, '--shell', '/sbin/nologin', 'taigua-publish')
        account = pwd.getpwnam('taigua-publish')
    if not (STATE / 'team.sqlite3').exists():
        shutil.copy2(RELEASE / 'deployment/bootstrap.json', STATE / 'bootstrap.json')
    (RELEASE / 'deployment/bootstrap.json').chmod(0o600)
    runtime_env = STATE / 'runtime.env'
    runtime_env.write_text(f'TEAM_STATE_DIR={STATE}\nTEAM_PORT=18870\nPLAYWRIGHT_BROWSERS_PATH={browsers}\nPATH={bin_dir}:{venv}/bin:/usr/local/bin:/usr/bin:/bin\n')
    runtime_env.chmod(0o600)
    for item in [STATE, *STATE.rglob('*')]:
        os.chown(item, account.pw_uid, account.pw_gid)
    (STATE / 'bootstrap.json').chmod(0o600) if (STATE / 'bootstrap.json').exists() else None
    for root, dirs, files in os.walk(browsers):
        os.chmod(root, 0o755)
        for name in files:
            path = Path(root) / name
            path.chmod(path.stat().st_mode | 0o444)
    # 准备启动配置，但保留启用动作供上线步骤执行。
    (RELEASE / 'deployment/prepared.json').write_text(json.dumps({'release': str(RELEASE), 'status': 'prepared'}, ensure_ascii=False))
    print('PREPARED：运行依赖已就绪，尚未启动服务或切换域名。', flush=True)


if __name__ == '__main__':
    main()
