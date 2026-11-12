"""维护补丁：隔离构建、测试后切换，清理替代代码和旧构建并保留必要回滚版本。"""

from datetime import datetime
import fcntl
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
import tarfile
import urllib.request
import zipfile


def main():
    archive, expected = Path(sys.argv[1]), sys.argv[2]
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise RuntimeError("补丁校验失败，未修改线上版本")
    root = Path("/opt/taigua-publish")
    current = root / "current"
    previous = current.resolve(strict=True)
    if not current.is_symlink() or not previous.is_relative_to(root / "releases"):
        raise RuntimeError("当前版本目录不符合预期")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    release = root / "releases" / (stamp + "-hybrid-execution")

    def ignore(directory, names):
        # 新版本不复制旧哈希构建文件和开发缓存，保留业务源码及许可证。
        skipped = {"__pycache__", ".DS_Store", ".git", "node_modules", ".venv"}
        if Path(directory) == previous / "frontend":
            skipped.add("dist")
        return [name for name in names if name in skipped]

    shutil.copytree(previous, release, symlinks=True, ignore=ignore)
    # 上一次专用部署器已由本通用脚本替代，不将无用补丁脚本带入新版本。
    for obsolete in ("deployment/deploy_platform_login.py", "deployment/ztwt.asalegent.com.conf",
                     "frontend/src/components/BrowserPoolSettings.vue"):
        (release / obsolete).unlink(missing_ok=True)
    with zipfile.ZipFile(archive) as patch:
        for member in patch.infolist():
            target = (release / member.filename).resolve()
            if not target.is_relative_to(release) or member.is_dir():
                raise RuntimeError("补丁包含不支持的路径")
            target.parent.mkdir(parents=True, exist_ok=True)
            with patch.open(member) as source, target.open("wb") as destination:
                shutil.copyfileobj(source, destination)
    account = pwd.getpwnam("taigua-publish")
    for target in [release, *release.rglob("*")]:
        os.chown(target, account.pw_uid, account.pw_gid, follow_symlinks=False)

    # 服务用户在新版本上运行测试；测试数据库均为临时目录，不使用正式员工数据。
    browsers = root / "browsers"
    candidates = sorted(p for p in browsers.rglob("*") if p.name in {"chrome", "headless_shell", "chrome-headless-shell"} and p.is_file())
    if not candidates:
        raise RuntimeError("服务器缺少已安装的 Chromium，未切换版本")
    test_log = root / "incoming" / ("hybrid-tests-" + stamp + ".log")
    with test_log.open("w") as output:
        result = subprocess.run(["runuser", "-u", "taigua-publish", "--", "env",
                                 "PLAYWRIGHT_BROWSERS_PATH=" + str(browsers),
                                 "TAIGUA_TEST_CHROMIUM=" + str(candidates[0]),
                                 str(root / "venv/bin/python"), "-m", "unittest", "discover", "-s", "tests_team", "-v"],
                                cwd=release / "backend", stdout=output, stderr=subprocess.STDOUT, timeout=300)
    if result.returncode:
        print(test_log.read_text()[-6000:])
        raise RuntimeError("服务器验证未通过，线上版本未切换")
    print("SERVER_TESTS_OK " + str(test_log), flush=True)

    # 安装包单独上传，先校验三种系统的完整包，网页不会提供半成品下载。
    manifest = json.loads((release / "deployment/executor-manifest.json").read_text())
    rebuilt = root / "incoming/executor-packages/manifest.json"
    if rebuilt.exists():
        # 服务器复用已有运行环境重新封装，避免重复上传三个大运行包。
        actual = json.loads(rebuilt.read_text())
        if actual["version"] != manifest["version"] or set(actual["packages"]) != set(manifest["packages"]):
            raise RuntimeError("服务器重新封装的版本不符，未切换")
        for name, expected_package in manifest["packages"].items():
            for key in ("source_sha256", "runtime_sha256", "layout", "entry"):
                if actual["packages"][name].get(key) != expected_package.get(key):
                    raise RuntimeError("重新封装的源码或运行环境不符：" + name)
        manifest = actual
        (release / "deployment/executor-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    if set(manifest["packages"]) != {"windows-x64", "macos-x64", "macos-arm64"}:
        raise RuntimeError("安装包尚未齐备，未切换线上版本")
    package_folder = root / "shared/executor-packages" / manifest["version"]
    package_folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, package_info in manifest["packages"].items():
        source = root / "incoming/executor-packages" / (name + ".zip")
        if not source.exists():
            source = root / "incoming" / (name + ".zip")
        if not source.exists():
            source = package_folder / (name + ".zip")
        digest = hashlib.sha256()
        with source.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        if source.stat().st_size != package_info["bytes"] or digest.hexdigest() != package_info["sha256"]:
            raise RuntimeError("安装包校验失败：" + name)
        # 同一磁盘原子搬运已核验包，避免长期留下两份大安装包。
        if source.parent != package_folder:
            source.replace(package_folder / source.name)
        os.chown(package_folder / source.name, account.pw_uid, account.pw_gid)
    os.chown(package_folder, account.pw_uid, account.pw_gid)
    shutil.copyfile(release / "deployment/executor-manifest.json", package_folder / "manifest.json")

    # 旧版尚在执行浏览器任务时不切换，避免更新打断员工正在进行的平台操作。
    legacy_lock = root / "shared/browser.lock"
    if legacy_lock.exists():
        with legacy_lock.open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("当前仍有浏览器任务运行，请待任务结束后再执行更新")
    for filename, table, states in (("browser-pool.sqlite3", "browser_requests", ("running", "queued")),
                                    ("execution.sqlite3", "execution_jobs", ("running", "preparing_run"))):
        path = root / "shared" / filename
        if path.is_file():
            with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
                if conn.execute(f"SELECT COUNT(*) FROM {table} WHERE state IN ({','.join('?' for _ in states)})", states).fetchone()[0]:
                    raise RuntimeError("仍有任务运行或等待浏览器，未切换版本")

    def switch(destination):
        # 同一文件系统原子替换符号链接，正式数据一直保存在共享状态目录。
        next_link = root / ("current.next-" + stamp)
        next_link.symlink_to(destination)
        next_link.replace(current)
        subprocess.run(["systemctl", "restart", "taigua-publish"], check=True, timeout=45)

    try:
        switch(release)
    except Exception:
        switch(previous)
        raise
    healthy = False
    for _ in range(40):
        try:
            response = urllib.request.urlopen("http://127.0.0.1:18870/", timeout=2)
            healthy = response.status == 200
            response.close()
            if healthy:
                break
        except OSError:
            pass
        time.sleep(0.25)
    if not healthy:
        switch(previous)
        raise RuntimeError("新版本健康检查未通过，已恢复原版本")

    # 只保留本次更新前的在线版本作为回滚依据，不把旧构建复制进活动版本。
    old_files = {str(p.relative_to(previous / "frontend/dist")) for p in (previous / "frontend/dist").rglob("*") if p.is_file()}
    new_files = {str(p.relative_to(release / "frontend/dist")) for p in (release / "frontend/dist").rglob("*") if p.is_file()}
    test_summary = [line for line in test_log.read_text().splitlines() if line.startswith("Ran ") or line == "OK"]
    # 老版本源码以一份压缩归档保留可恢复依据，活动目录只保留当前及上一版本。
    retired = [path for path in (root / "releases").iterdir() if path.is_dir() and path not in {release, previous}]
    retired_bytes = sum(path.stat().st_size for folder in retired for path in folder.rglob("*") if path.is_file())
    retired_archive = root / "retired-releases.tar.gz"
    if retired:
        archive_next = retired_archive.with_suffix(".next.tar.gz")
        with tarfile.open(archive_next, "w:gz") as backup:
            if retired_archive.exists():
                # 旧归档作为一个成员继承，更新不会让仍可恢复的旧源码无故消失。
                backup.add(retired_archive, arcname="previous-retired.tar.gz")
            for folder in retired:
                backup.add(folder, arcname=folder.name)
        archive_next.replace(retired_archive)
        for folder in retired:
            shutil.rmtree(folder)
    receipt = {"time": stamp, "sha256": expected, "release": str(release), "rollback_release": str(previous),
               "retired_frontend_files": len(old_files - new_files), "server_tests_passed": True,
               "server_test_summary": test_summary, "mode": "local-ordinary_server-scheduled",
               "server_global_concurrency_limit": None, "employee_serial": True,
               "packages": manifest, "retired_release_bytes": retired_bytes,
               "retired_source_archive": str(retired_archive) if retired else None,
               "real_platform_publications_tested": False}
    result_path = root / "deployment-result.json"
    original = json.loads(result_path.read_text()) if result_path.exists() else {}
    original["hybrid_execution_update"] = receipt
    result_path.write_text(json.dumps(original, ensure_ascii=False, indent=2))
    print("DEPLOYMENT_OK " + json.dumps(receipt, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
