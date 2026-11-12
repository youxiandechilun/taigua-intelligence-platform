"""在服务器复用已校验运行环境封装应用；仅操作构建目录，不改变线上员工数据。"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    """补丁源码和小型启动程序已上传后，三种运行环境无需再次跨网传输。"""
    root = Path("/opt/taigua-publish")
    source = Path(__file__).resolve().parents[1]
    current_manifest = json.loads((root / "current/deployment/executor-manifest.json").read_text())
    previous = root / "shared/executor-packages" / current_manifest["version"]
    if not previous.exists():
        # 首次从旧版文件夹包升级时，原包保留在原目录供旧版本回滚使用。
        previous = root / "shared/executor-packages"
    output = root / "incoming/executor-packages"
    marker = output / ".taigua-package-build"
    if output.exists():
        if not marker.exists():
            raise RuntimeError("构建目录含未知内容，未清理或覆盖")
        shutil.rmtree(output)
    output.mkdir(mode=0o700)
    marker.touch()
    shutil.copyfile(previous / "manifest.json", output / "manifest.json")
    for name in current_manifest["packages"]:
        # 同盘硬链接复用输入，重新封装使用临时文件原子替换，不修改原包。
        original, target = previous / (name + ".zip"), output / (name + ".zip")
        try:
            os.link(original, target)
        except OSError:
            shutil.copyfile(original, target)
    subprocess.run([sys.executable, "-u", str(source / "deployment/build_executor_packages.py"), "--refresh"],
                   env={**os.environ, "TAIGUA_EXECUTOR_OUTPUT": str(output)}, check=True)
    manifest = json.loads((output / "manifest.json").read_text())
    print("PACKAGES_READY " + json.dumps({"version": manifest["version"],
          "packages": {name: {key: item[key] for key in ("bytes", "sha256", "entry")} for name, item in manifest["packages"].items()}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
