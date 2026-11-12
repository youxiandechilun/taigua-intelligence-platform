#!/usr/bin/env bash
# 中文导读：维护与构建工具：ci-python.sh。按文件内参数执行对应操作，运行前先核对目标环境。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AI_DIR="${ROOT_DIR}/apps/ai"

if [[ -x "${AI_DIR}/.venv/bin/python" ]]; then
  PYTHON="${AI_DIR}/.venv/bin/python"
else
  PYTHON="${PYTHON:-python3}"
fi

cd "${AI_DIR}"
"${PYTHON}" -m pip_audit --local
"${PYTHON}" -m pytest tests -W error
