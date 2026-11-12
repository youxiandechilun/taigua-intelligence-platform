#!/usr/bin/env bash
# 中文导读：维护与构建工具：install.sh。按文件内参数执行对应操作，运行前先核对目标环境。
set -euo pipefail
umask 027
TASK_ROOT=/opt/taigua-sales
TASK_APP=$TASK_ROOT/QuickVoice
export PATH=$TASK_ROOT/node/bin:$TASK_ROOT/tools/node_modules/.bin:$PATH
export npm_config_manage_package_manager_versions=false
export npm_config_package_manager_strict=false
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS=--max-old-space-size=1024
trap 'echo DEPLOY_FAILED_AT_LINE_$LINENO' ERR
id taigua-sales >/dev/null 2>&1 || useradd --system --home-dir "$TASK_ROOT" --shell /sbin/nologin taigua-sales
mkdir -p "$TASK_ROOT/shared" "$TASK_ROOT/postgres-data" /var/lib/taigua-sales-redis
chmod 755 "$TASK_ROOT"
chown postgres:postgres "$TASK_ROOT/postgres-data"
chown redis:redis /var/lib/taigua-sales-redis
if [ ! -f "$TASK_ROOT/postgres-data/PG_VERSION" ]; then
  runuser -u postgres -- /usr/bin/initdb -D "$TASK_ROOT/postgres-data" -E UTF8 --auth-local=peer --auth-host=scram-sha-256
  cat >> "$TASK_ROOT/postgres-data/postgresql.conf" <<'PG'
port = 55432
listen_addresses = '127.0.0.1'
unix_socket_directories = '/tmp'
shared_buffers = '64MB'
max_connections = 40
password_encryption = 'scram-sha-256'
timezone = 'UTC'
PG
fi
cat > /etc/systemd/system/taigua-postgres.service <<'UNIT'
[Unit]
Description=Taigua sales PostgreSQL
After=network.target
[Service]
User=postgres
Group=postgres
ExecStart=/usr/bin/postgres -D /opt/taigua-sales/postgres-data
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now taigua-postgres
for i in $(seq 1 20); do /usr/bin/pg_isready -h /tmp -p 55432 && break; sleep 1; done
python3 "$TASK_APP/deploy/taigua/init-env.py"
chmod 640 "$TASK_ROOT/shared/server.env"
chown root:taigua-sales "$TASK_ROOT/shared/server.env"
chmod 750 "$TASK_ROOT/shared"
chown root:taigua-sales "$TASK_ROOT/shared"
chmod 640 "$TASK_ROOT/redis.conf"
chown root:redis "$TASK_ROOT/redis.conf"
cat > /etc/systemd/system/taigua-redis.service <<'UNIT'
[Unit]
Description=Taigua sales Redis
After=network.target
[Service]
User=redis
Group=redis
ExecStart=/usr/bin/redis-server /opt/taigua-sales/redis.conf
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now taigua-redis
cd "$TASK_APP"
echo INSTALLING_NODE_DEPENDENCIES
pnpm install --frozen-lockfile --filter server... --filter console... --registry=https://registry.npmmirror.com --network-concurrency=6
set -a
source "$TASK_ROOT/shared/server.env"
set +a
cd "$TASK_APP/apps/server"
echo GENERATING_AND_MIGRATING_DATABASE
pnpm exec prisma generate
pnpm exec prisma migrate deploy
echo BUILDING_API
pnpm run build
cd "$TASK_APP"
pnpm --filter server exec tsx ../../deploy/taigua/bootstrap.ts
cd "$TASK_APP/apps/console"
echo BUILDING_CHINESE_CONSOLE
NODE_ENV=production pnpm exec next build --webpack
CONSOLE_ENTRY=$(find "$TASK_APP/apps/console/.next/standalone" -path '*/apps/console/server.js' -print -quit)
[ -n "$CONSOLE_ENTRY" ] || CONSOLE_ENTRY="$TASK_APP/apps/console/.next/standalone/server.js"
[ -f "$CONSOLE_ENTRY" ]
cp -a "$TASK_APP/apps/console/.next/static" "$(dirname "$CONSOLE_ENTRY")/.next/static"
if [ -d "$TASK_APP/apps/console/public" ]; then cp -a "$TASK_APP/apps/console/public" "$(dirname "$CONSOLE_ENTRY")/public"; fi
chown -R taigua-sales:taigua-sales "$TASK_APP"
cat > /etc/systemd/system/taigua-api.service <<'UNIT'
[Unit]
Description=Taigua sales API
After=network.target taigua-postgres.service taigua-redis.service
Requires=taigua-postgres.service taigua-redis.service
[Service]
User=taigua-sales
Group=taigua-sales
WorkingDirectory=/opt/taigua-sales/QuickVoice/apps/server
EnvironmentFile=/opt/taigua-sales/shared/server.env
Environment=NODE_OPTIONS=--max-old-space-size=512
ExecStart=/opt/taigua-sales/node/bin/node dist/src/index.js
Restart=on-failure
RestartSec=5
UMask=0027
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/taigua-console.service <<UNIT
[Unit]
Description=Taigua Chinese sales console
After=network.target taigua-api.service
[Service]
User=taigua-sales
Group=taigua-sales
WorkingDirectory=$(dirname "$CONSOLE_ENTRY")
Environment=NODE_ENV=production
Environment=PORT=8300
Environment=HOSTNAME=127.0.0.1
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=$TASK_ROOT/node/bin/node $CONSOLE_ENTRY
Restart=on-failure
RestartSec=5
UMask=0027
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now taigua-api taigua-console
systemctl restart taigua-api taigua-console
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8510/api/v1/health >/dev/null && curl -fsS http://127.0.0.1:8300/login >/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:8510/api/v1/health
curl -fsS http://127.0.0.1:8300/login >/dev/null
python3 "$TASK_APP/deploy/taigua/configure-nginx.py"
if /www/server/nginx/sbin/nginx -t; then
  /www/server/nginx/sbin/nginx -s reload
else
  cp "$TASK_ROOT/backups/nginx-before.conf" /www/server/panel/vhost/nginx/dx.zezejun.cn.conf
  exit 1
fi
systemctl is-active taigua-api taigua-console taigua-postgres taigua-redis
echo DEPLOY_COMPLETE
