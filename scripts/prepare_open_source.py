"""从当前工作树导出用于公开发布的源码快照，保留本机开发历史。"""
from collections import Counter
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "outputs" / "github" / "taigua-intelligence-platform"
EXCLUDED_PARTS = frozenset({
    "node_modules", ".venv", "__pycache__", ".next", "dist", "logs", "outputs",
    "runtime-reference", "交付校验", ".claude", ".pytest_cache", ".turbo", ".cache",
    ".wwebjs_auth", ".wwebjs_cache", "cookiesFile", "browser_profiles", "playwright-report",
})
EXCLUDED_NAMES = frozenset({"SOURCE-BUNDLE-MANIFEST.json", "SOURCE-BUNDLE-README.md"})
EXCLUDED_SUFFIXES = frozenset({".db", ".sqlite", ".sqlite3", ".log", ".pyc", ".zip", ".docx", ".pem", ".key"})


def publishable(path: Path) -> bool:
    parts = path.parts
    if not parts or parts[0] not in {"projects", "database", "scripts", "docs"}:
        return path.as_posix() in {".gitignore", "README.md", "LICENSE", "NOTICE", ".env.example"}
    if any(part in EXCLUDED_PARTS for part in parts):
        return False
    if path.name in EXCLUDED_NAMES or path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if path.name.startswith(".env") and not path.name.endswith(("example", "sample", "template")):
        return False
    if "data" in parts and not path.as_posix().startswith("projects/telephony/apps/server/data/"):
        return False
    if "prisma" in parts and "generated" in parts:
        return False
    return True


def main() -> int:
    if DESTINATION.exists():
        raise RuntimeError(f"目标目录已存在，请先核对已有公开快照再操作：{DESTINATION}")
    result = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                            cwd=ROOT, check=True, stdout=subprocess.PIPE)
    candidates = {Path(value.decode("utf-8")) for value in result.stdout.split(b"\0") if value}
    candidates.add(Path("projects/telephony/.env.dev.example"))
    counters: Counter[str] = Counter()
    files = []
    for relative in sorted(candidates):
        source = ROOT / relative
        if not publishable(relative) or not source.is_file():
            continue
        target = DESTINATION / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower() in {".md", ".py", ".sh", ".json"}:
            try:
                content = source.read_text(encoding="utf-8-sig")
            except UnicodeError:
                shutil.copy2(source, target)
            else:
                content = content.replace(str(ROOT), ".").replace(ROOT.as_posix(), ".")
                target.write_text(content, encoding="utf-8", newline="\n")
        else:
            shutil.copy2(source, target)
        files.append(relative.as_posix())
        counters[relative.parts[1] if relative.parts[0] == "projects" else relative.parts[0]] += 1
    report = ROOT / "data" / "temporary" / "open-source-export.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"directory": str(DESTINATION), "counts": dict(counters), "files": files},
                                 ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"源码快照已导出，文件总数 {len(files)}")
    print(DESTINATION)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
