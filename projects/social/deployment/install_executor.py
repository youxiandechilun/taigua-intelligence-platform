"""插件首次打开安装器：内置运行环境，安装后自动关联员工并在登录电脑时启动。"""

import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time


def install(source=None, notify=lambda message: None):
    """安装和启动均在后台完成，前台窗口只消费进度，不让员工寻找依赖目录。"""
    source = Path(source) if source else Path(__file__).resolve().parent
    config = json.loads((source / "activation.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(config["server"].encode()).hexdigest()[:16]
    root = (Path(os.environ.get("LOCALAPPDATA", Path.home())) / "TaiguaExecutor" if sys.platform == "win32"
            else Path.home() / "Library/Application Support/TaiguaExecutor") / digest / config["workspace"]
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (root / "agent.lock").open("a+b")
    try:
        # 已经运行时不覆盖正在使用的程序文件，也不要求员工重新连接。
        if sys.platform == "win32":
            import msvcrt
            lock.seek(0)
            if not lock.read(1):
                lock.write(b"0"); lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        return root, root / "program"
    notify("正在准备本机程序，首次启动请稍候……")
    destination = root / "program"
    staging = root / "program.installing"
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(source, staging, symlinks=True, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
    # 安装程序目录不保存激活信息副本；激活后只保留固定系统地址和员工编号。
    previous = root / "program.previous"
    if previous.exists():
        shutil.rmtree(previous)
    if destination.exists():
        destination.rename(previous)
    staging.rename(destination)
    python = destination / "runtime" / ("pythonw.exe" if sys.platform == "win32" else "bin/python3")
    script = destination / "backend/local_agent.py"
    args = [str(python), str(script)]
    if sys.platform == "win32":
        # 系统启动目录只安装本员工的启动项，不修改其他员工或机器全局配置。
        startup = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup"
        startup.mkdir(parents=True, exist_ok=True)
        command = subprocess.list2cmdline(args).replace('"', '""')
        (startup / f"TaiguaExecutor-{digest}-{config['workspace'][:8]}.vbs").write_text(
            "' 泰卦执行插件：登录员工电脑后自动启动\r\n" +
            'CreateObject("WScript.Shell").Run "' + command + '", 0, False\r\n', encoding="utf-16")
    else:
        agents = Path.home() / "Library/LaunchAgents"
        agents.mkdir(exist_ok=True)
        label = f"cn.zezejun.taigua.executor.{digest}.{config['workspace'][:8]}"
        target = agents / (label + ".plist")
        with target.open("wb") as stream:
            plistlib.dump({"Label": label, "ProgramArguments": args, "RunAtLoad": True,
                          "StandardOutPath": str(root / "executor.log"), "StandardErrorPath": str(root / "executor.log")}, stream)
    lock.close()
    # 状态只包含可展示信息；一次性关联码和设备令牌不写进状态窗口。
    (root / "status.json").write_text(json.dumps({"state": "starting", "message": "程序已准备好，正在连接系统。",
                                                  "updated_at": time.time(), "pid": None}, ensure_ascii=False), encoding="utf-8")
    # 已安装程序由独立后台进程启动，关闭下载目录和安装窗口不影响任务。
    with (root / "executor.log").open("a") as log:
        subprocess.Popen(args, cwd=destination, stdout=log, stderr=subprocess.STDOUT,
                         start_new_session=sys.platform != "win32")
    if previous.exists():
        shutil.rmtree(previous)
    return root, destination


def main():
    """双击应用后立即显示启动窗口，随后自动安装并关联当前员工。"""
    from installer_ui import main as show_launcher
    show_launcher()


if __name__ == "__main__":
    main()
