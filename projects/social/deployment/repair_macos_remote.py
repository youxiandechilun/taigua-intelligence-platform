"""只修复 Mac 插件兼容性，复用线上业务源码与 Windows 包，不更改域名映射。"""

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request

from verify_macos_package import verify_package


ROOT = Path('/opt/taigua-publish')
BUILD = ROOT / 'incoming/macos-compatibility-20261111'
PACKAGES = BUILD / 'packages'
VERSION = '2026.11.11.1'


def digest(path):
    """流式校验大安装包，避免服务器因读入多份完整文件而额外占用内存。"""
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def prepare():
    """原包以硬链接复制到隔离目录，重打包只原子替换临时副本。"""
    if PACKAGES.exists():
        raise RuntimeError('本次构建目录已存在，请先核对构建状态')
    manifest = json.loads((ROOT / 'current/deployment/executor-manifest.json').read_text())
    if manifest['version'] == VERSION:
        raise RuntimeError('兼容版本已经上线，无需再次构建')
    original = ROOT / 'shared/executor-packages' / manifest['version']
    PACKAGES.mkdir(mode=0o700)
    for name, meta in manifest['packages'].items():
        source = original / (name + '.zip')
        if digest(source) != meta['sha256']:
            raise RuntimeError('线上原包校验失败：' + name)
        os.link(source, PACKAGES / source.name)
    (PACKAGES / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    env = {**os.environ, 'TAIGUA_EXECUTOR_SOURCE_ROOT': str(ROOT / 'current'),
           'TAIGUA_EXECUTOR_OUTPUT': str(PACKAGES)}
    subprocess.run([str(ROOT / 'venv/bin/python'), '-u', str(BUILD / 'build_executor_packages.py'),
                    '--repair-macos'], env=env, check=True)
    prepared = json.loads((PACKAGES / 'manifest.json').read_text())
    checks = {name: verify_package(PACKAGES / (name + '.zip'), name)
              for name in ('macos-x64', 'macos-arm64')}
    if prepared['packages']['windows-x64']['sha256'] != manifest['packages']['windows-x64']['sha256']:
        raise RuntimeError('兼容补丁不应修改 Windows 安装包')
    for name in manifest['packages']:
        if manifest['packages'][name].get('source_sha256') != prepared['packages'][name].get('source_sha256'):
            raise RuntimeError('兼容补丁不应修改业务源码：' + name)
    (BUILD / 'prepared.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2))
    print('MACOS_PACKAGES_READY ' + json.dumps(checks, ensure_ascii=False), flush=True)


def activate():
    """校验完成且没有运行中任务时切换下载清单，失败恢复原清单和服务。"""
    if not (BUILD / 'prepared.json').exists():
        raise RuntimeError('未完成兼容包构建与检查')
    manifest_path = ROOT / 'current/deployment/executor-manifest.json'
    old_manifest = json.loads(manifest_path.read_text())
    manifest = json.loads((PACKAGES / 'manifest.json').read_text())
    if manifest['version'] != VERSION or old_manifest['version'] == VERSION:
        raise RuntimeError('待发布或线上版本不符合本次补丁预期')
    for name, meta in manifest['packages'].items():
        if digest(PACKAGES / (name + '.zip')) != meta['sha256']:
            raise RuntimeError('待发布安装包摘要不符：' + name)
        if name.startswith('macos-'):
            verify_package(PACKAGES / (name + '.zip'), name)
    # 正在执行员工任务时不重启网关，避免浏览器操作中断。
    for filename, table, states in (
        ('execution.sqlite3', 'execution_jobs', ('running', 'preparing_run')),
        ('browser-pool.sqlite3', 'browser_requests', ('running', 'queued')),
    ):
        path = ROOT / 'shared' / filename
        if path.exists():
            with sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True) as conn:
                query = 'SELECT COUNT(*) FROM ' + table + ' WHERE state IN (' + ','.join('?' for _ in states) + ')'
                if conn.execute(query, states).fetchone()[0]:
                    raise RuntimeError('当前有运行中的员工任务，尚未切换下载包')
    backup = ROOT / 'backups' / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-macos-compatibility')
    backup.mkdir(mode=0o700)
    shutil.copy2(manifest_path, backup / 'executor-manifest.json')
    account = pwd.getpwnam('taigua-publish')
    destination = ROOT / 'shared/executor-packages' / VERSION
    if destination.exists():
        raise RuntimeError('目标版本目录已存在，未覆盖')
    PACKAGES.rename(destination)
    for path in [destination, *destination.iterdir()]:
        os.chown(path, account.pw_uid, account.pw_gid)
    # 更新可复用构建脚本，旧版脚本仅在本次回滚副本中保存。
    for filename in ('build_executor_packages.py', 'verify_macos_package.py'):
        target = manifest_path.parent / filename
        if target.exists():
            shutil.copy2(target, backup / filename)
        shutil.copy2(BUILD / filename, target)
        os.chown(target, account.pw_uid, account.pw_gid)
    next_manifest = manifest_path.with_suffix('.next.json')
    shutil.copy2(destination / 'manifest.json', next_manifest)
    os.chown(next_manifest, account.pw_uid, account.pw_gid)
    next_manifest.replace(manifest_path)
    try:
        subprocess.run(['systemctl', 'restart', 'taigua-publish'], check=True, timeout=45)
        for attempt in range(40):
            try:
                with urllib.request.urlopen('http://127.0.0.1:18870/', timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.25)
        else:
            raise RuntimeError('新下载版本健康检查未通过')
    except Exception:
        # 包更新失败时，业务目录和员工数据库始终不作任何回退或覆盖。
        shutil.copy2(backup / 'executor-manifest.json', manifest_path)
        for filename in ('build_executor_packages.py', 'verify_macos_package.py'):
            target = manifest_path.parent / filename
            if (backup / filename).exists():
                shutil.copy2(backup / filename, target)
            elif target.exists():
                target.rename(backup / ('failed-' + filename))
        subprocess.run(['systemctl', 'restart', 'taigua-publish'], check=True, timeout=45)
        raise
    receipt = {'version': VERSION, 'rollback_version': old_manifest['version'], 'backup': str(backup),
               'packages': {name: {'sha256': meta['sha256'], 'bytes': meta['bytes']} for name, meta in manifest['packages'].items()},
               'compatibility': json.loads((BUILD / 'prepared.json').read_text()), 'service': 'active'}
    (backup / 'deployment-result.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    print('MACOS_FIX_ACTIVE ' + json.dumps(receipt, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    {'prepare': prepare, 'activate': activate}[sys.argv[1]]()
