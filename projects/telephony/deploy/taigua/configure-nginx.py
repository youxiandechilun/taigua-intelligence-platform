# 中文导读：维护与构建工具：configure-nginx.py。按文件内参数执行对应操作，运行前先核对目标环境。
from pathlib import Path
import re
path=Path('/www/server/panel/vhost/nginx/dx.zezejun.cn.conf')
s=Path('/opt/taigua-sales/backups/nginx-before.conf').read_text()
# Keep the existing certificate and ACME challenge settings. Route Next assets
# before the panel's generic static-file regular expressions.
locations='''
    # TAIGUA-SALES-START
    if ($scheme = http) { return 301 https://$host$request_uri; }
    client_max_body_size 10m;
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8510;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 90s;
    }
    location ^~ /socket.io/ {
        proxy_pass http://127.0.0.1:8510;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 90s;
    }
    location ^~ /_next/ {
        proxy_pass http://127.0.0.1:8300;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:8300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 90s;
        proxy_buffering off;
    }
    # TAIGUA-SALES-END
'''
if 'location / {' in s or 'location /{' in s: raise RuntimeError('An existing root proxy needs manual review')
s=s.replace('include enable-php-74.conf;','# PHP disabled for the Node.js application')
s=re.sub(r'expires\s+(30d|12h);', lambda m: 'proxy_pass http://127.0.0.1:8300;\n        proxy_set_header Host $host;\n        expires '+m.group(1)+';', s)
pos=s.rfind('}')
path.write_text(s[:pos]+locations+s[pos:])
print('Target domain proxy prepared; certificate settings retained.')
