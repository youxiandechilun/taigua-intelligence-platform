"""构建内置 Python 的员工插件；不把开发虚拟环境、业务数据或服务器凭证打包。"""

import hashlib
import csv
from email import message_from_string
import io
import json
import os
from pathlib import Path
import shutil
import stat
import plistlib
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile

import requests


# 兼容补丁可在临时构建目录运行，源码与品牌资源仍从明确指定的现有版本读取。
ROOT = Path(os.environ.get("TAIGUA_EXECUTOR_SOURCE_ROOT", Path(__file__).resolve().parents[1]))
OUTPUT = Path(os.environ.get("TAIGUA_EXECUTOR_OUTPUT", ROOT.parent / "deployment/executor-packages"))
# Mac 插件以 Ventura 为兼容下限，依赖选择和应用声明必须使用相同版本。
MACOS_MINIMUM = "13.0"
# 本次海外登录修复使用独立版本目录，保留上一版安装包以便回滚。
PACKAGE_VERSION = "2026.11.11.3"
TARGETS = {"macos-x64": ("x86_64-apple-darwin", "macosx_13_0_x86_64"),
           "macos-arm64": ("aarch64-apple-darwin", "macosx_13_0_arm64"),
           "windows-x64": ("x86_64-pc-windows-msvc", "win_amd64")}


def package_sources():
    """使用源码白名单，开发数据库、环境凭证与测试数据不会进入安装包。"""
    excluded = {"team_gateway.py", "hybrid_gateway.py", "browser_scheduler.py", "server_browser.py", "executor_package.py"}
    sources = {}
    for file in (ROOT / "backend").rglob("*"):
        relative = file.relative_to(ROOT)
        if not file.is_file() or any(part.startswith((".", "tests")) or part in {"logs", "bin", "team-data"} for part in relative.parts):
            continue
        # 平台模块启动时会读取静态分类配置；它属于源码依赖，不是员工业务数据。
        if (file.suffix == ".py" and file.name not in excluded or
                relative.parts[1] == "branding" and file.suffix in {".png", ".json"} or
                relative.parts[1] == "impl" and file.suffix == ".json"):
            sources["TaiguaExecutor/" + str(relative)] = file
    sources["TaiguaExecutor/install_executor.py"] = ROOT / "deployment/install_executor.py"
    sources["TaiguaExecutor/installer_ui.py"] = ROOT / "deployment/installer_ui.py"
    return sources


def write_tree(archive, folder, prefix):
    """保留 Mac 解释器的符号链接和可执行位，标准解压工具可直接打开应用。"""
    for file in sorted(folder.rglob("*")):
        if not file.is_file() and not file.is_symlink():
            continue
        relative = prefix + str(file.relative_to(folder))
        if file.is_symlink():
            item = zipfile.ZipInfo(relative)
            item.create_system = 3
            item.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(item, os.readlink(file))
        else:
            archive.write(file, relative)


def assemble_application(folder, name, target):
    """外层只提供一个应用图标；运行文件、许可证和关联信息全部留在内部。"""
    if name.startswith("windows"):
        launcher = folder.parent / "windows-launcher.exe"
        prebuilt = ROOT / "deployment/windows-bootstrap.exe"
        receipt = ROOT / "deployment/windows-bootstrap.json"
        source_digest = hashlib.sha256((ROOT / "deployment/windows_launcher.c").read_bytes()).hexdigest()
        if prebuilt.exists():
            # 服务器可复用本次构建的同一启动程序，无需额外安装交叉编译器。
            recorded = json.loads(receipt.read_text())
            if recorded["source_sha256"] != source_digest or recorded["sha256"] != hashlib.sha256(prebuilt.read_bytes()).hexdigest():
                raise RuntimeError("Windows 启动程序与源码或构建回执不符，请重新构建")
            shutil.copyfile(prebuilt, launcher)
        else:
            zig = os.environ.get("TAIGUA_ZIG")
            if not zig:
                raise RuntimeError("构建 Windows 单入口需要设置 TAIGUA_ZIG 编译器路径")
            run([zig, "cc", "-target", "x86_64-windows-gnu", "-municode", "-mwindows", "-Os", "-s",
                 str(ROOT / "deployment/windows_launcher.c"), "-o", str(launcher), "-lcomctl32", "-lshell32", "-luser32", "-lgdi32"])
            shutil.copyfile(launcher, prebuilt)
            receipt.write_text(json.dumps({"source_sha256": source_digest,
                               "sha256": hashlib.sha256(prebuilt.read_bytes()).hexdigest()}, indent=2))
        payload = folder.parent / "windows-payload.zip"
        with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
            write_tree(archive, folder, "program/")
        executable = folder.parent / "泰卦插件.exe"
        with executable.open("wb") as output:
            output.write(launcher.read_bytes())
            with payload.open("rb") as source:
                shutil.copyfileobj(source, output, 1024 * 1024)
            output.write(struct.pack("<Q", payload.stat().st_size) + b"TAIGUA-PAYLOAD01")
        # 运行环境已经压缩，外层使用存储模式，避免每位员工下载时重复消耗服务器 CPU。
        with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED) as archive:
            archive.write(executable, "泰卦插件.exe")
        return
    app = folder.parent / "泰卦插件.app"
    contents = app / "Contents"
    program = contents / "Resources/program"
    program.parent.mkdir(parents=True)
    folder.rename(program)
    binary = contents / "MacOS/TaiguaExecutor"
    binary.parent.mkdir()
    binary.write_text('#!/bin/sh\n# 泰卦插件：从应用内部启动内置环境，前台窗口显示真实连接状态。\nunset PYTHONHOME PYTHONPATH\nTAIGUA_RESOURCES="$(CDPATH= cd -- "$(dirname -- "$0")/../Resources" && pwd)"\nexec "$TAIGUA_RESOURCES/program/runtime/bin/python3" "$TAIGUA_RESOURCES/program/install_executor.py" "$@"\n')
    binary.chmod(0o755)
    from PIL import Image
    Image.open(ROOT / "backend/branding/icon.png").save(contents / "Resources/TaiguaIcon.icns", format="ICNS")
    with (contents / "Info.plist").open("wb") as output:
        plistlib.dump({"CFBundleName": "泰卦插件", "CFBundleDisplayName": "泰卦插件", "CFBundleExecutable": "TaiguaExecutor",
                      "CFBundleIdentifier": "cn.zezejun.taigua.executor", "CFBundlePackageType": "APPL",
                      "CFBundleVersion": PACKAGE_VERSION, "CFBundleShortVersionString": "1.1.1",
                      "CFBundleIconFile": "TaiguaIcon.icns", "LSMinimumSystemVersion": MACOS_MINIMUM,
                      "NSHighResolutionCapable": True}, output)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        write_tree(archive, app, "泰卦插件.app/")
    # 同时检查所有原生依赖，防止只降低应用声明却仍夹带高版本系统二进制。
    from verify_macos_package import verify_package
    verify_package(target, name, MACOS_MINIMUM)


def repair_macos_numpy(folder, name):
    """用同版本的兼容轮子替换 NumPy 14 专用轮子，不降级或引入业务代码变更。"""
    if not name.startswith("macos-"):
        return
    site = folder / "runtime/lib/python3.12/site-packages"
    metadata = list(site.glob("numpy-*.dist-info"))
    if len(metadata) != 1:
        raise RuntimeError("插件的 NumPy 元数据不完整，未生成下载包")
    info = metadata[0]
    tags = [line.split(": ", 1)[1].rsplit("-", 1)[-1] for line in (info / "WHEEL").read_text().splitlines()
            if line.startswith("Tag: ")]
    floor = tuple(map(int, MACOS_MINIMUM.split(".")))
    if any(tag.startswith("macosx_") and tuple(map(int, tag.split("_")[1:3])) <= floor for tag in tags):
        return
    version = message_from_string((info / "METADATA").read_text())["Version"]
    with tempfile.TemporaryDirectory(prefix="taigua-macos-wheel-") as temporary:
        # 按 macOS 13 解析相同版本，pip 会选旧系统可用的 OpenBLAS 构建。
        run([sys.executable, "-m", "pip", "download", "--only-binary=:all:", "--no-deps",
             "--platform", TARGETS[name][1], "--python-version", "312", "--implementation", "cp",
             "--abi", "cp312", "numpy==" + version, "--dest", temporary])
        wheels = list(Path(temporary).glob("numpy-*.whl"))
        if len(wheels) != 1:
            raise RuntimeError("未获取唯一的兼容 NumPy 依赖")
        # 按原安装记录清理旧二进制，不在插件中留下两份 NumPy 或无用动态库。
        for row in csv.reader((info / "RECORD").read_text().splitlines()):
            target = site / row[0]
            if not target.resolve().is_relative_to(site.resolve()):
                raise RuntimeError("NumPy 安装记录含越界路径")
            target.unlink(missing_ok=True)
        for target in sorted(site.rglob("*"), reverse=True):
            if target.is_dir() and not target.is_symlink() and not any(target.iterdir()):
                target.rmdir()
        with zipfile.ZipFile(wheels[0]) as wheel:
            for member in wheel.infolist():
                if member.is_dir():
                    continue
                target = site / member.filename
                if not target.resolve().is_relative_to(site.resolve()):
                    raise RuntimeError("兼容依赖包含越界路径")
                target.parent.mkdir(parents=True, exist_ok=True)
                with wheel.open(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                target.chmod((member.external_attr >> 16) & 0o777 or 0o644)


def refresh_sources(compatibility_only=False):
    """复用运行环境；兼容补丁保留原包业务源码，避免夹带尚未发布的功能。"""
    manifest_path = OUTPUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    sources = {} if compatibility_only else package_sources()
    digest = hashlib.sha256()
    for name, file in sorted(sources.items()):
        digest.update(name.encode()); digest.update(file.read_bytes())
    for name, item in manifest["packages"].items():
        if compatibility_only and not name.startswith("macos-"):
            continue
        # 调整某个平台的启动程序时只重建该平台，其他已验证包无需重复压缩。
        if os.environ.get("TAIGUA_PACKAGE_TARGET") and name != os.environ["TAIGUA_PACKAGE_TARGET"]:
            continue
        package = OUTPUT / (name + ".zip")
        if hashlib.sha256(package.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError("原运行环境摘要不符，未覆盖安装包")
        temporary = package.with_suffix(".next.zip")
        with tempfile.TemporaryDirectory(prefix="taigua-app-repack-") as directory, zipfile.ZipFile(package) as old:
            folder = Path(directory) / "TaiguaExecutor"
            folder.mkdir()
            prefix = "TaiguaExecutor/"
            nested = None
            if name.startswith("windows") and old.namelist() == ["泰卦插件.exe"]:
                executable = old.read("泰卦插件.exe")
                if executable[-16:] != b"TAIGUA-PAYLOAD01":
                    raise RuntimeError("运行载荷尾标不正确")
                length = struct.unpack("<Q", executable[-24:-16])[0]
                nested = zipfile.ZipFile(io.BytesIO(executable[-24-length:-24]))
                source_archive, prefix = nested, "program/"
            else:
                source_archive = old
                if any(member.startswith("泰卦插件.app/") for member in old.namelist()):
                    prefix = "泰卦插件.app/Contents/Resources/program/"
            for member in source_archive.infolist():
                relative = member.filename.removeprefix(prefix)
                if relative == member.filename or member.is_dir():
                    continue
                if not compatibility_only and not (relative.startswith(("runtime/", "backend/bin/")) or relative.startswith("LICENSE")):
                    continue
                if "/imageio_ffmpeg/binaries/ffmpeg-" in relative or "/__pycache__/" in relative:
                    continue
                target = folder / relative
                if not target.resolve().is_relative_to(folder.resolve()):
                    raise RuntimeError("运行环境含越界路径")
                target.parent.mkdir(parents=True, exist_ok=True)
                if stat.S_ISLNK(member.external_attr >> 16):
                    target.symlink_to(source_archive.read(member).decode())
                else:
                    with source_archive.open(member) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
                    target.chmod((member.external_attr >> 16) & 0o777 or 0o644)
            if nested:
                nested.close()
            if not compatibility_only:
                for relative, file in sorted(sources.items()):
                    target = folder / relative.removeprefix("TaiguaExecutor/")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(file, target)
            repair_macos_numpy(folder, name)
            assemble_application(folder, name, temporary)
        temporary.replace(package)
        item.update(sha256=hashlib.sha256(package.read_bytes()).hexdigest(), bytes=package.stat().st_size,
                    native_install_verified=False, layout="single-application",
                    entry="泰卦插件.exe" if name.startswith("windows") else "泰卦插件.app")
        if not compatibility_only:
            item["source_sha256"] = digest.hexdigest()
        if name.startswith("macos-"):
            item.update(minimum_system_version=MACOS_MINIMUM, native_runtime_verified=False, native_gui_verified=False)
        manifest["version"] = PACKAGE_VERSION
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
        print("REFRESH_OK " + name + " " + str(item["bytes"]), flush=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))


def run(args, **options):
    """构建日志保存在产物目录，不向终端输出依赖下载的大段日志。"""
    with (OUTPUT / "build.log").open("a") as log:
        subprocess.run(args, stdout=log, stderr=subprocess.STDOUT, check=True, **options)


def download(url, target, expected=None):
    """下载官方运行时并验证发布摘要；失败时不生成可下载的半成品。"""
    digest = hashlib.sha256()
    with requests.get(url, stream=True, timeout=180) as response, target.open("wb") as output:
        response.raise_for_status()
        for block in response.iter_content(1024 * 1024):
            digest.update(block); output.write(block)
    actual = digest.hexdigest()
    if expected and actual != expected.removeprefix("sha256:"):
        raise RuntimeError("Python 运行时校验失败")
    return actual


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    response = requests.get("https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/20261026", timeout=60)
    response.raise_for_status()
    release = response.json()
    manifest = {"version": PACKAGE_VERSION, "python_release": release["tag_name"], "packages": {}}
    with tempfile.TemporaryDirectory(prefix="taigua-executor-build-") as scratch:
        scratch = Path(scratch)
        common = scratch / "common-wheels"
        common.mkdir()
        # 少数纯 Python 依赖只提供源码，先构建通用 wheel，再按各目标系统解析原生依赖。
        run([sys.executable, "-m", "pip", "wheel", "-r", str(ROOT / "backend/requirements-server.txt"),
             "imageio-ffmpeg==0.6.0", "--wheel-dir", str(common)])
        for name, (triple, wheel_platform) in TARGETS.items():
            print("BUILDING " + name, flush=True)
            folder = scratch / name / "TaiguaExecutor"
            folder.mkdir(parents=True)
            asset = next(item for item in release["assets"] if item["name"].startswith("cpython-3.12.16+") and
                         triple in item["name"] and item["name"].endswith("install_only_stripped.tar.gz"))
            archive = scratch / (name + ".tar.gz")
            runtime_hash = download(asset["browser_download_url"], archive, asset.get("digest"))
            with tarfile.open(archive) as source:
                source.extractall(folder, filter="data")
            (folder / "python").rename(folder / "runtime")
            wheels = scratch / (name + "-wheels")
            run([sys.executable, "-m", "pip", "download", "--only-binary=:all:", "--platform", wheel_platform,
                 "--python-version", "312", "--implementation", "cp", "--abi", "cp312", "--find-links", str(common),
                 "-r", str(ROOT / "backend/requirements-server.txt"), "imageio-ffmpeg==0.6.0", "--dest", str(wheels)])
            site = folder / "runtime" / ("Lib/site-packages" if name.startswith("windows") else "lib/python3.12/site-packages")
            site.mkdir(parents=True, exist_ok=True)
            for wheel in wheels.glob("*.whl"):
                with zipfile.ZipFile(wheel) as source:
                    for item in source.infolist():
                        if item.is_dir():
                            continue
                        parts = Path(item.filename).parts
                        if parts[0].endswith(".data"):
                            if len(parts) < 3 or parts[1] not in {"purelib", "platlib"}:
                                continue
                            parts = parts[2:]
                        target = site.joinpath(*parts)
                        if not target.resolve().is_relative_to(site.resolve()):
                            raise RuntimeError("依赖包含越界路径")
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with source.open(item) as content, target.open("wb") as output:
                            shutil.copyfileobj(content, output)
                        target.chmod((item.external_attr >> 16) & 0o777 or 0o644)
            for relative, file in package_sources().items():
                target = folder.parent / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, target)
            for license_file in ROOT.glob("LICENSE*"):
                shutil.copyfile(license_file, folder / license_file.name)
            binaries = list((site / "imageio_ffmpeg/binaries").glob("ffmpeg-*"))
            if not binaries:
                raise RuntimeError("插件缺少内置视频处理程序")
            (folder / "backend/bin").mkdir(exist_ok=True)
            ffmpeg = folder / "backend/bin" / ("ffmpeg.exe" if name.startswith("windows") else "ffmpeg")
            shutil.copyfile(binaries[0], ffmpeg); ffmpeg.chmod(0o755)
            for redundant in binaries:
                redundant.unlink()
            # 所有构建路径统一输出单入口应用，不再生成外露的脚本和运行目录。
            target = OUTPUT / (name + ".zip")
            assemble_application(folder, name, target)
            manifest["packages"][name] = {"sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                "bytes": target.stat().st_size, "runtime_sha256": runtime_hash, "runtime_url": asset["browser_download_url"],
                "native_install_verified": False, "layout": "single-application",
                "entry": "泰卦插件.exe" if name.startswith("windows") else "泰卦插件.app"}
            if name.startswith("macos-"):
                manifest["packages"][name]["minimum_system_version"] = MACOS_MINIMUM
            (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
            print("PACKAGE_OK " + name + " " + str(target.stat().st_size), flush=True)
    # 依赖轮子、解压运行时和中间构建目录均为临时文件；仅保留可下载安装包与构建依据。


if __name__ == "__main__":
    if "--repair-macos" in sys.argv:
        refresh_sources(compatibility_only=True)
    elif "--refresh" in sys.argv:
        refresh_sources()
    else:
        main()
