# 中文导读：维护与构建工具：init-env.py。按文件内参数执行对应操作，运行前先核对目标环境。
from pathlib import Path
import secrets, subprocess
from urllib.parse import urlparse
root=Path('/opt/taigua-sales')
env=root/'shared/server.env'
if not env.exists():
    password=secrets.token_hex(24)
    cachepass=secrets.token_hex(24)
    values={
      'NODE_ENV':'production','VOICE_BACKEND':'aliyun','API_VERSION':'v1','PORT':'8510','LISTEN_HOST':'127.0.0.1',
      'SERVER_URL':'https://dx.zezejun.cn','BETTER_AUTH_URL':'https://dx.zezejun.cn','CONSOLE_URL':'https://dx.zezejun.cn','WEB_URL':'https://dx.zezejun.cn','DOCS_URL':'https://dx.zezejun.cn',
      'DATABASE_URL':f'postgresql://taigua_sales:{password}@127.0.0.1:55432/taigua_sales?connection_limit=5',
      'REDIS_URL':f'redis://:{cachepass}@127.0.0.1:56379', 'RATE_LIMIT_STORE':'redis','TRUSTED_PROXY_CIDRS':'127.0.0.1/32',
      'BETTER_AUTH_SECRET':secrets.token_hex(32),'INTERNAL_API_KEY':secrets.token_hex(32),'SECRET_ENCRYPTION_KEY':secrets.token_hex(32),
      'QUICKVOICE_BILLING_MODE':'self_hosted','NUMBER_QUOTE_SIGNING_SECRET':secrets.token_hex(32),'PROMOTIONAL_IDENTITY_SECRET':secrets.token_hex(32),
      'LIVEKIT_URL':'http://127.0.0.1:65535','LIVEKIT_API_KEY':'not-configured','LIVEKIT_API_SECRET':'not-configured',
      'TELNYX_API_KEY':'not-configured','TWILIO_ACCOUNT_SID':'AC00000000000000000000000000000000','TWILIO_AUTH_TOKEN':'not-configured',
      'WIDGET_ALLOW_LOCALHOST_ORIGINS':'false','PROVIDER_SPEND_ALERTS_ENABLED':'false','READINESS_REQUIRED_INTEGRATIONS':'','INNGEST_SERVE_ORIGIN':'https://dx.zezejun.cn'
    }
    env.write_text('\n'.join(k+'='+v for k,v in values.items())+'\n')
    env.chmod(0o640)
else:
    values=dict(line.split('=',1) for line in env.read_text().splitlines() if '=' in line)
    password=urlparse(values['DATABASE_URL']).password
    cachepass=urlparse(values['REDIS_URL']).password
psql=['runuser','-u','postgres','--','psql','-X','-h','/tmp','-p','55432','-d','postgres','-v','ON_ERROR_STOP=1']
role=subprocess.check_output(psql+['-Atc',"SELECT 1 FROM pg_roles WHERE rolname='taigua_sales'"],universal_newlines=True).strip()
if not role: subprocess.run(psql+['-c',f"CREATE ROLE taigua_sales WITH LOGIN PASSWORD '{password}'"],check=True,stdout=subprocess.DEVNULL)
db=subprocess.check_output(psql+['-Atc',"SELECT 1 FROM pg_database WHERE datname='taigua_sales'"],universal_newlines=True).strip()
if not db: subprocess.run(psql+['-c','CREATE DATABASE taigua_sales OWNER taigua_sales'],check=True,stdout=subprocess.DEVNULL)
(root/'redis.conf').write_text(f'bind 127.0.0.1\nport 56379\nprotected-mode yes\nrequirepass {cachepass}\ndir /var/lib/taigua-sales-redis\nappendonly yes\nmaxmemory 64mb\nmaxmemory-policy noeviction\n')
(root/'QuickVoice/apps/console/.env.production.local').write_text('NEXT_PUBLIC_SERVER_URL=https://dx.zezejun.cn\nNEXT_PUBLIC_CONSOLE_URL=https://dx.zezejun.cn\nNEXT_PUBLIC_LANDING_URL=https://dx.zezejun.cn\nNEXT_PUBLIC_API_VERSION=v1\n')
print('Private database, cache and HTTPS configuration prepared.')
