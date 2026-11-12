#!/usr/bin/env bash
# 中文导读：维护与构建工具：dev-node-deps.sh。按文件内参数执行对应操作，运行前先核对目标环境。
set -euo pipefail

PNPM_VERSION="${PNPM_VERSION:-9.0.0}"
INSTALL_ARGS=("--frozen-lockfile")

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required to activate pnpm@${PNPM_VERSION}." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if corepack enable >/dev/null 2>&1; then
    echo "enabled corepack shims"
  elif command -v sudo >/dev/null 2>&1; then
    echo "corepack enable needs elevated permissions; retrying with sudo"
    sudo corepack enable
  else
    echo "corepack enable failed and sudo is not available." >&2
    exit 1
  fi
fi

corepack prepare "pnpm@${PNPM_VERSION}" --activate
pnpm install "${INSTALL_ARGS[@]}"
