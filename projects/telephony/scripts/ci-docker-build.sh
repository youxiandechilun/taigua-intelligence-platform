#!/usr/bin/env bash
# 中文导读：维护与构建工具：ci-docker-build.sh。按文件内参数执行对应操作，运行前先核对目标环境。
set -euo pipefail

docker buildx build \
  --file apps/server/Dockerfile \
  --target build \
  --tag quickvoice-server:ci \
  --load \
  .

docker buildx build \
  --file apps/ai/Dockerfile \
  --build-arg PREINSTALL_CPU_TORCH=true \
  --build-arg SKIP_MODEL_DOWNLOAD=true \
  --tag quickvoice-ai:ci \
  --load \
  apps/ai
