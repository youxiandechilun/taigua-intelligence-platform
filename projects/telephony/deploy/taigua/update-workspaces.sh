#!/usr/bin/env bash
# 中文导读：维护与构建工具：update-workspaces.sh。按文件内参数执行对应操作，运行前先核对目标环境。
set -euo pipefail
umask 027
TASK_ROOT=/opt/taigua-sales
TASK_APP=$TASK_ROOT/QuickVoice
export PATH=$TASK_ROOT/node/bin:$TASK_ROOT/tools/node_modules/.bin:$PATH
export NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048
trap 'echo WORKSPACES_UPDATE_FAILED_AT_LINE_$LINENO' ERR
TASK_BACKUP=$TASK_ROOT/backups/workspaces-$(date +%Y%m%d-%H%M%S)
mkdir -p "$TASK_BACKUP"
runuser -u postgres -- pg_dump -h /tmp -p 55432 -Fc taigua_sales > "$TASK_BACKUP/database.dump"
tar -czf "$TASK_BACKUP/source.tar.gz" --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git -C "$TASK_APP" apps/server/src apps/server/prisma apps/console/src apps/console/public
sha256sum "$TASK_ROOT/workspaces-update.tar.gz"
tar -xzf "$TASK_ROOT/workspaces-update.tar.gz" -C "$TASK_APP"
set -a
source "$TASK_ROOT/shared/server.env"
set +a
cd "$TASK_APP/apps/server"
pnpm exec prisma generate
pnpm run build
cd "$TASK_APP/apps/console"
NODE_ENV=production pnpm exec next build --webpack
CONSOLE_ENTRY=$(find "$TASK_APP/apps/console/.next/standalone" -path '*/apps/console/server.js' -print -quit)
[ -n "$CONSOLE_ENTRY" ] || CONSOLE_ENTRY="$TASK_APP/apps/console/.next/standalone/server.js"
[ -f "$CONSOLE_ENTRY" ]
mkdir -p "$(dirname "$CONSOLE_ENTRY")/.next/static" "$(dirname "$CONSOLE_ENTRY")/public"
cp -a .next/static/. "$(dirname "$CONSOLE_ENTRY")/.next/static/"
cp -a public/. "$(dirname "$CONSOLE_ENTRY")/public/"
cd "$TASK_APP/apps/server"
pnpm exec prisma migrate deploy
chown -R taigua-sales:taigua-sales "$TASK_APP"
systemctl restart taigua-api taigua-console
for i in $(seq 1 45); do curl -fsS http://127.0.0.1:8510/api/v1/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:8300/login >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:8510/api/v1/health
curl -fsS http://127.0.0.1:8300/login >/dev/null
systemctl is-active taigua-api taigua-console
printf '\nWORKSPACES_UPDATE_COMPLETE\n'
