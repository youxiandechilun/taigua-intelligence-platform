"""生成混合执行补丁：只收源码、许可证及最终前端，不打包凭证或员工数据。"""

import hashlib
import json
from pathlib import Path
import shutil
import zipfile


def main():
    root = Path(__file__).resolve().parents[1]
    output = root.parent / "deployment"
    manifest = output / "executor-packages/manifest.json"
    parsed = json.loads(manifest.read_text())
    if len(parsed["packages"]) != 3:
        raise RuntimeError("请先构建全部三种安装包")
    shutil.copyfile(manifest, root / "deployment/executor-manifest.json")
    selected = []
    # 隐藏目录、测试产物和运行数据库永远不进入发布补丁。
    for area in ("backend", "frontend/src", "frontend/public", "frontend/dist", "deployment"):
        for file in (root / area).rglob("*"):
            relative = file.relative_to(root)
            if not file.is_file() or any(part.startswith(".") or part in {"__pycache__", "node_modules", "logs", "bin"} for part in relative.parts):
                continue
            # 平台静态 JSON 配置也需要发布，否则员工插件的注册模块无法完整启动。
            if area == "backend" and not (file.suffix == ".py" or relative.parts[1] == "branding" or
                    relative.parts[1] == "impl" and file.suffix == ".json" or file.name == "requirements-server.txt"):
                continue
            selected.append(file)
    for name in ("frontend/index.html", "frontend/package.json", "frontend/package-lock.json", "CHANGES-TAIGUA.md",
                 "docs/服务器平台登录与员工隔离.md"):
        selected.append(root / name)
    selected.extend(root.glob("LICENSE*"))
    archive = output / "taigua-hybrid-execution-20261109.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for file in sorted(set(selected)):
            package.write(file, str(file.relative_to(root)))
    receipt = {"file": str(archive), "bytes": archive.stat().st_size,
               "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "file_count": len(set(selected))}
    (output / "hybrid-patch.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == "__main__":
    main()
