#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
export WA_HEADLESS="${WA_HEADLESS:-1}"
export WA_PORT="${WA_PORT:-8100}"
echo "WhatsApp 扫码控制台：http://127.0.0.1:${WA_PORT}"
exec node server.js
