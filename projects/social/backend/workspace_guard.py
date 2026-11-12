"""泰卦部署改造：工作区接口只接受网关调用，文件路径不能跨越工作区。"""

import hmac
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from flask import jsonify, request


def install_workspace_guard(app, base_dir):
    secret = os.environ.get("SAU_WORKER_TOKEN")
    if not secret:
        return
    base = Path(base_dir).resolve()

    def invalid_value(value):
        if isinstance(value, dict):
            return any(invalid_value(item) for item in value.values())
        if isinstance(value, (list, tuple)):
            return any(invalid_value(item) for item in value)
        if not isinstance(value, str):
            return False
        decoded = unquote(unquote(value)).replace("\\", "/")
        if decoded.startswith(("http://", "https://")):
            return False
        if decoded.startswith("file:") or ".." in decoded.split("/"):
            return True
        if decoded.startswith("/api/materials/file/"):
            # 素材对象携带的是网页相对地址，按工作区素材路径校验，不当作系统绝对路径。
            stored = decoded.removeprefix("/api/materials/file/").split("?", 1)[0]
            return not (base / stored).resolve().is_relative_to(base) or stored.split("/", 1)[0] not in {
                "materials", "covers", "videos", "thumbnails"}
        if decoded.startswith("/"):
            return not Path(decoded).resolve().is_relative_to(base)
        return False

    @app.before_request
    def require_gateway():
        if not hmac.compare_digest(request.headers.get("X-Workspace-Token", ""), secret):
            return jsonify(code=401, msg="请通过系统网关访问"), 401
        if invalid_value(request.args.to_dict(flat=False)) or invalid_value(request.get_json(silent=True)) or invalid_value(request.form.to_dict(flat=False)):
            return jsonify(code=403, msg="文件路径超出当前工作区"), 403
        # 文件服务的 URL 也必须满足相同边界，不能只检查请求正文。
        if ".." in unquote(unquote(request.path)).replace("\\", "/").split("/"):
            return jsonify(code=403, msg="文件路径超出当前工作区"), 403
        if request.path == "/api/image-proxy":
            parsed = urlsplit(request.args.get("url", ""))
            # 原头像代理仅用于微博图片，限制到官方图片 CDN，阻止请求内网服务。
            host = (parsed.hostname or "").lower()
            if parsed.scheme != "https" or parsed.port not in (None, 443) or not (host.endswith(".sinaimg.cn") or host == "sinaimg.cn"):
                return jsonify(code=400, msg="不支持该头像地址"), 400
