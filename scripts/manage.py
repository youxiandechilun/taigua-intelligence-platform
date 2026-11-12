"""泰卦工程后台命令入口。"""

import argparse
import base64
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.request import getproxies

ROOT = Path(__file__).resolve().parents[1]
PLATFORM = ROOT / "projects" / "platform"


def environment() -> dict[str, str]:
    values = os.environ.copy()
    configuration = ROOT / ".env"
    if configuration.exists():
        for line in configuration.read_text(encoding="utf-8-sig").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    for protocol, address in getproxies().items():
        if protocol in ("http", "https"):
            values.setdefault(f"{protocol.upper()}_PROXY", address)
    values.setdefault("NO_PROXY", "localhost,127.0.0.1,::1")
    values["PYTHONUTF8"] = "1"
    values["PYTHONPATH"] = os.pathsep.join((str(ROOT), str(PLATFORM), values.get("PYTHONPATH", "")))
    return values


def initialize_local_configuration() -> None:
    configuration = ROOT / ".env"
    if configuration.exists():
        return
    lines = [
        "TAIGUA_ENV=development",
        "TAIGUA_PORT=18000",
        "TAIGUA_HOST=127.0.0.1",
        f"TAIGUA_DATABASE_PATH={ROOT / 'data/persistent/platform/data.db'}",
        "TAIGUA_PLATFORM_URL=http://127.0.0.1:18000",
        f"INTERNAL_API_KEY={secrets.token_urlsafe(36)}",
        f"TAIGUA_CONFIG_KEY={base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('ascii')}",
        "TAIGUA_ADMIN_STAFF=ADM001",
        f"TAIGUA_ADMIN_PASSWORD={secrets.token_urlsafe(24)}",
        "TAIGUA_ENTRY_ZTGT=http://127.0.0.1:18100/api/auth/sso",
        "TAIGUA_ENTRY_ZTWT=http://127.0.0.1:18100/api/auth/sso",
        "TAIGUA_ENTRY_ZTGJ=http://127.0.0.1:18870/api/auth/sso",
        "TAIGUA_ENTRY_ZTWJ=http://127.0.0.1:18870/api/auth/sso",
        "TAIGUA_ENTRY_ZTGH=http://127.0.0.1:18510/api/v1/platform/sso",
        "TAIGUA_ENTRY_ZTWH=http://127.0.0.1:18510/api/v1/platform/sso",
        "TAIGUA_ENTRY_SITE=http://127.0.0.1:18200/api/auth/sso",
    ]
    with configuration.open("x", encoding="utf-8", newline="\n") as output:
        output.write("\n".join(lines) + "\n")
    print(f"已生成本机配置 {configuration}", flush=True)


def python_executable() -> Path:
    directory = "Scripts" if os.name == "nt" else "bin"
    name = "python.exe" if os.name == "nt" else "python"
    return ROOT / ".venv" / directory / name


def execute(command: list[str], label: str, cwd: Path = PLATFORM) -> int:
    directory = ROOT / "logs"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{label}.log"
    print(f"运行日志 {path}", flush=True)
    with path.open("a", encoding="utf-8") as output:
        result = subprocess.run(command, cwd=cwd, env=environment(), stdout=output, stderr=subprocess.STDOUT)
    print(f"命令结束，退出码 {result.returncode}", flush=True)
    return result.returncode


def install() -> int:
    initialize_local_configuration()
    executable = python_executable()
    if not executable.exists():
        result = execute([sys.executable, "-m", "venv", str(ROOT / ".venv")], "platform-environment", ROOT)
        if result:
            return result
    return execute([str(executable), "-m", "pip", "install", "-r", str(PLATFORM / "requirements.txt")], "platform-install")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="泰卦工程后台命令")
    parser.add_argument("project", choices=("platform",))
    parser.add_argument("action", choices=("install", "run", "check", "migrate", "maintenance"))
    arguments = parser.parse_args()
    if arguments.action == "install":
        return install()
    executable = python_executable()
    if not executable.exists():
        parser.error("请先运行 python scripts/manage.py platform install")
    initialize_local_configuration()
    commands = {
        "run": [str(executable), "app.py"],
        "check": [str(executable), "-m", "unittest", "discover", "-s", "tests", "-v"],
        "migrate": [str(executable), "-m", "taigua_core.maintenance", "--once"],
        "maintenance": [str(executable), "-m", "taigua_core.maintenance"],
    }
    return execute(commands[arguments.action], f"platform-{arguments.action}")


if __name__ == "__main__":
    raise SystemExit(main())
