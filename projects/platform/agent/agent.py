# -*- coding: utf-8 -*-
"""
泰卦智能 · 智能体框架服务（独立进程）

与主站 app.py 完全分离，单独端口运行，不共享数据库与登录态。
当前版本只提供页面骨架 + 接口占位，业务逻辑后续按模块接入。

启动：
    python agent.py                       # 默认 0.0.0.0:8001
    AGENT_PORT=8010 python agent.py       # 指定端口

页面（无登录页、无独立首页，打开即为功能页）：
    /                                     直接跳转 /agent/social-cn
    /agent/social-cn                      社媒矩阵（国内）
    /agent/social-global                  社媒矩阵（海外）
    /agent/sales-cn                       电销（国内）
    /agent/sales-global                   电销（海外）
    /agent/dm-cn                          私信拓客（国内）
    /agent/dm-global                      私信拓客（海外）
    /agent/site                           独立站

接口（全部为占位，返回 501 + 统一响应体）：
    GET  /api/health
    GET  /api/frameworks
    ANY  /api/<framework>/<module>/<action>
"""

import json
import os

from flask import Flask, Response, abort, redirect, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_DIR = os.path.join(BASE_DIR, "image")
COMMON_DIR = os.path.join(BASE_DIR, "common")

HOST = os.environ.get("AGENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("AGENT_PORT", "8001"))
SERVICE = "taikua-agent"
VERSION = "0.1.0"

# ---------------------------------------------------------------- 框架注册表
# file  : 对应页面文件
# env   : dom 国内 / glb 海外 / site 独立站
# 这里只登记"页面级"信息，具体功能位在前端页面内的 AGENT_PAGE 配置中声明。
PAGES = {
    "social-cn": {
        "file": "social-cn.html",
        "name": "社媒矩阵智能体",
        "env": "dom",
        "env_text": "国内版",
        "cover": "/image/cover-social-cn.svg",
        "modules": ["数据管理", "账号管理", "任务中心", "执行中心", "留资中心"],
    },
    "social-global": {
        "file": "social-global.html",
        "name": "社媒矩阵智能体",
        "env": "glb",
        "env_text": "海外版",
        "cover": "/image/cover-social-global.svg",
        "modules": ["数据管理", "账号管理", "任务中心", "执行中心", "留资中心"],
    },
    "sales-cn": {
        "file": "https://dx.toseaglobal.com/dashboard",
        "name": "泰卦外贸 · 数字员工",
        "env": "dom",
        "env_text": "数字员工",
        "cover": "/image/cover-sales-cn.svg",
        "modules": [
            "数据看板", "数字员工", "行业拓客员工", "录音学习", "声音库",
            "外呼中心", "通话记录", "意向客户库", "知识库", "企业微信", "设置中心",
        ],
    },
    "sales-global": {
        "file": "sales-global.html",
        "name": "电销智能体",
        "env": "glb",
        "env_text": "海外版",
        "cover": "/image/cover-sales-global.svg",
        "modules": [
            "数据看板", "数字员工", "行业拓客员工", "录音学习", "声音库",
            "外呼中心", "通话记录", "意向客户库", "知识库", "企业微信", "设置中心",
        ],
    },
    "dm-cn": {
        "file": "dm-cn.html",
        "name": "私信拓客智能体",
        "env": "dom",
        "env_text": "国内版",
        "cover": "/image/cover-dm-cn.svg",
        "modules": ["数据看板", "账号管理", "任务中心", "留资中心", "知识库"],
    },
    "dm-global": {
        "file": "dm-global.html",
        "name": "私信拓客智能体",
        "env": "glb",
        "env_text": "海外版",
        "cover": "/image/cover-dm-global.svg",
        "modules": ["数据看板", "账号管理", "任务中心", "留资中心", "知识库"],
    },
    "site": {
        "file": "site.html",
        "name": "独立站智能体",
        "env": "site",
        "env_text": "独立站",
        "cover": "/image/cover-site.svg",
        "modules": [
            "网站生成", "数据看板", "网站管理", "产品管理",
            "SEO引擎", "GEO引擎", "留资中心", "知识库",
        ],
    },
}

app = Flask(__name__, static_folder=None)


# ---------------------------------------------------------------- 统一响应
def _json(payload, status=200):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return Response(body, status=status, mimetype="application/json; charset=utf-8")


def ok(data=None, msg="ok"):
    return _json({"code": 0, "msg": msg, "data": data})


def fail(code, msg, status=200, data=None):
    return _json({"code": code, "msg": msg, "data": data}, status)


# ---------------------------------------------------------------- 跨域
@app.after_request
def _cors(resp):
    # 主站与本站不同端口，前端联调时需要放开；生产环境可收紧为具体域名
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    resp.headers["X-Agent-Service"] = SERVICE
    return resp


# ---------------------------------------------------------------- 独立域名 → 页面映射
# 在宝塔把多个子域名都绑定到本项目后，访问根路径时按域名自动进入对应页面：
#   ztgh.taikua.cn -> 电销国内   ztwh.taikua.cn -> 电销海外
#   ztgj.taikua.cn -> 社媒国内   ztwj.taikua.cn -> 社媒海外
#   ztgt.taikua.cn -> 拓客转私域国内   ztwt.taikua.cn -> 拓客转私域海外
#   dlz.taikua.cn  -> 独立站
HOST_MAP = {
    "ztgh.taikua.cn": "sales-cn",
    "ztwh.taikua.cn": "sales-global",
    "ztgj.taikua.cn": "social-cn",
    "ztwj.taikua.cn": "social-global",
    "ztgt.taikua.cn": "dm-cn",
    "ztwt.taikua.cn": "dm-global",
    "dlz.taikua.cn": "site",
}


@app.before_request
def _host_dispatch():
    """绑定独立域名的项目，访问 / 或 /agent 时按 Host 跳到对应功能页。"""
    if request.path not in ("/", "/agent"):
        return None
    host = (request.host or "").split(":")[0].strip().lower()
    slug = HOST_MAP.get(host)
    if slug:
        return redirect("/agent/" + slug, code=302)
    return None


# ---------------------------------------------------------------- 页面路由
@app.get("/")
def index():
    # 不放首页/登录页：根路径直接进入默认框架的功能页
    return redirect("/agent/social-cn", code=302)


@app.get("/agent")
def agent_root():
    return redirect("/agent/social-cn", code=302)


@app.get("/agent/<slug>")
def agent_page(slug):
    meta = PAGES.get(slug)
    if not meta:
        abort(404)
    return send_from_directory(BASE_DIR, meta["file"])


@app.get("/image/<path:filename>")
def image(filename):
    return send_from_directory(IMAGE_DIR, filename, max_age=86400)


@app.get("/common/<path:filename>")
def common(filename):
    return send_from_directory(COMMON_DIR, filename, max_age=0)


# ---------------------------------------------------------------- 接口占位
@app.get("/api/health")
def api_health():
    return ok({
        "service": SERVICE,
        "version": VERSION,
        "port": PORT,
        "frameworks": len(PAGES),
    })


@app.get("/api/frameworks")
def api_frameworks():
    items = []
    for slug, meta in PAGES.items():
        items.append({
            "slug": slug,
            "name": meta["name"],
            "env": meta["env"],
            "envText": meta["env_text"],
            "cover": meta["cover"],
            "url": "/agent/" + slug,
            "modules": meta["modules"],
        })
    return ok({"list": items, "total": len(items)})


@app.route("/api/<slug>/<path:rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_placeholder(slug, rest):
    """业务接口占位：模块接入时用真实实现替换本函数的分发逻辑。"""
    if slug not in PAGES:
        return fail(4004, "框架不存在: " + slug, 404)
    return fail(5001, "接口尚未接入", 501, {
        "framework": slug,
        "action": rest,
        "method": request.method,
    })


# ---------------------------------------------------------------- 错误处理
@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/"):
        return fail(4004, "接口不存在", 404)
    return _json({
        "code": 4004,
        "msg": "页面不存在",
        "data": {"path": request.path, "index": "/"},
    }, 404)


@app.errorhandler(500)
def server_error(_e):
    return fail(5000, "服务端异常", 500)


# ---------------------------------------------------------------- 入口
if __name__ == "__main__":
    total_modules = sum(len(m["modules"]) for m in PAGES.values())
    print("=" * 58)
    print(" 泰卦智能 · 智能体框架服务 %s" % VERSION)
    print(" 监听: http://%s:%s" % ("127.0.0.1" if HOST == "0.0.0.0" else HOST, PORT))
    print(" 页面: %d 个 / 能力域: %d 个" % (len(PAGES), total_modules))
    for _slug in PAGES:
        print("   - /agent/%-14s %s %s" % (_slug, PAGES[_slug]["name"], PAGES[_slug]["env_text"]))
    print(" 健康检查: /api/health")
    print("=" * 58)
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
