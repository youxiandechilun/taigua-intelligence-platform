"""员工进程内的混合任务适配：把现有发布配置拆成可持久化、逐账号执行的任务。"""

import asyncio
from datetime import datetime
import inspect
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import uuid

from flask import Blueprint, current_app, jsonify, request
from conf import BASE_DIR
from hybrid_workspace import safe_relative


hybrid_worker = Blueprint("hybrid_worker", __name__, url_prefix="/api/internal/hybrid")


def _relative(value):
    """旧服务生成的工作区绝对路径转换成素材编号对应的相对路径。"""
    if not value:
        return value
    path = Path(value)
    if path.is_absolute():
        value = str(path.resolve().relative_to(BASE_DIR.resolve()))
    return safe_relative(value)


def _accounts():
    """只从当前工作进程的独立数据库取账号。"""
    with sqlite3.connect(BASE_DIR / "db/database.db") as conn:
        conn.row_factory = sqlite3.Row
        return {str(row["id"]): dict(row) for row in conn.execute("SELECT * FROM user_info")}


def _content_plans(kind, selected, accounts):
    """图集和文章按草稿及账号拆分，保留各账号的定时和个性化配置。"""
    from app import PLATFORM_ID_TO_KEY
    from services.draft_merge import validate_image_draft_for_publish
    plans, failed = [], []
    for index, row in enumerate(selected):
        draft = json.loads(row["draft_data"] or "{}")
        common, batch = draft.get("commonConfig") or {}, str(uuid.uuid4())
        account_ids = draft.get("publishAccountIds") or []
        if not account_ids:
            failed.append({"draft_id": row["id"], "reason": "草稿未选择发布账号"})
        for account_id in account_ids:
            try:
                account = accounts.get(str(account_id))
                if not account:
                    raise ValueError("发布账号不存在或不属于当前员工")
                key = PLATFORM_ID_TO_KEY.get(account["type"], "")
                config = dict(common)
                # 合并顺序与图集编辑页一致，False、空字符串和空列表也是显式覆写。
                layers = [(draft.get("platformConfigs") or {}).get(key),
                          (draft.get("platformOverrides") or {}).get(key),
                          (draft.get("panelAccountOverrides") or {}).get(str(account_id)),
                          (draft.get("accountOverrides") or {}).get(str(account_id))]
                for layer in layers:
                    config.update({field: value for field, value in (layer or {}).items() if value is not None})
                config.update(account_id=account["id"], account_name=account["userName"], filePath=account["filePath"], platform=key)
                payload = {"__detail_id": str(uuid.uuid4()), "batchId": batch, "account_configs": config}
                if kind == "image":
                    images = config.get("images") or []
                    payload["image_ids"] = [image["id"] if isinstance(image, dict) else image for image in images]
                    errors = validate_image_draft_for_publish({"image_ids": payload["image_ids"], "account_configs": config})
                    if errors:
                        raise ValueError("; ".join(errors))
                    cover = config.get("coverImage") or {}
                    if cover.get("stored_path"):
                        config["cover_path"] = _relative(cover["stored_path"])
                else:
                    if not str(config.get("articleTitle") or "").strip() or not str(config.get("articleHtml") or "").strip():
                        raise ValueError("文章标题和正文不能为空")
                    # 草稿箱的批量推送沿用原来的平台草稿箱语义，不擅自切换直接发表。
                    config.update(dryRun=False, isDraft=True)
                payload["title"] = config.get("articleTitle" if kind == "article" else "title", "")
                payload["_plan"] = {"kind": kind, "account": account, "merged": config, "kwargs": {}}
                plans.append({"path": "/api/internal/hybrid/run", "payload": payload, "video": index})
            except (ValueError, TypeError, KeyError) as exc:
                failed.append({"draft_id": row["id"], "reason": str(exc)})
    return plans, failed


@hybrid_worker.post("/plan")
def plan():
    """规划阶段不启动浏览器、不发布；不同账号的定时设置分别路由。"""
    from app import PLATFORM_ID_TO_KEY
    from services.draft_merge import merge_config, build_platform_kwargs, limit_platform_tags, validate_draft_for_publish
    path = "/" + request.json["operation"].lstrip("/")
    payload = request.json["payload"]
    videos = payload.get("videos", [])
    if path.endswith("/drafts/batch-publish"):
        ids = payload.get("draft_ids") or []
        if not ids or len(ids) > 100:
            return jsonify(code=400, msg="请选择 1–100 份草稿"), 400
        with sqlite3.connect(BASE_DIR / "db/database.db") as conn:
            conn.row_factory = sqlite3.Row
            selected = [conn.execute("SELECT * FROM drafts WHERE id=?", (identifier,)).fetchone() for identifier in ids]
        if any(row is None for row in selected):
            return jsonify(code=404, msg="草稿不存在或不属于当前员工"), 404
        kind = "image" if path.startswith("/api/image-publish/") else "article" if path.startswith("/api/article-publish/") else "video"
        if any(row["type"] != kind for row in selected):
            return jsonify(code=400, msg="草稿类型与当前发布入口不一致"), 400
        if kind != "video":
            plans, failed = _content_plans(kind, selected, _accounts())
            return jsonify(code=200, data={"plans": plans, "failed": failed})
        videos = [json.loads(row["draft_data"]) for row in selected]
    if not isinstance(videos, list) or not videos:
        return jsonify(code=400, msg="视频列表不能为空"), 400
    accounts = _accounts()
    plans, failed = [], []
    for index, video in enumerate(videos):
        errors = validate_draft_for_publish({"type": "video", "draft_data": video})
        if errors:
            failed.append({"video": index, "reason": "; ".join(errors)})
            continue
        common, batch = video.get("commonConfig") or {}, str(uuid.uuid4())
        for account_id in video.get("publishAccountIds") or []:
            account = accounts.get(str(account_id))
            if not account:
                failed.append({"video": index, "reason": "发布账号不存在或不属于当前员工"})
                continue
            try:
                key = PLATFORM_ID_TO_KEY.get(account["type"], "")
                merged = merge_config(common, (video.get("platformConfigs") or {}).get(key),
                                      (video.get("platformOverrides") or {}).get(key),
                                      (video.get("accountOverrides") or {}).get(str(account_id)))
                merged["tags"] = limit_platform_tags(key, merged)
                from ext_api import _validate_batch_account
                errors = _validate_batch_account(key, merged)
                if errors:
                    raise ValueError("; ".join(errors))
                kwargs = build_platform_kwargs(merged, common, SimpleNamespace(
                    id=account["id"], platform=key, file_path=account["filePath"]))
                kwargs["files"] = [_relative(value) for value in kwargs.get("files", [])]
                for field in list(kwargs):
                    if field.endswith("_path") and kwargs[field]:
                        kwargs[field] = _relative(kwargs[field])
                if not kwargs["files"]:
                    raise ValueError("缺少视频素材")
                plans.append({"path": "/api/internal/hybrid/run", "payload": {
                    "__detail_id": str(uuid.uuid4()), "batchId": batch, "type": account["type"],
                    "accountList": [account["filePath"]], "fileList": kwargs["files"],
                    "scheduleTime": merged.get("scheduleTime") or "", "title": kwargs.get("title", ""),
                    "_plan": {"account": account, "kwargs": kwargs, "merged": merged},
                }, "video": index})
            except (ValueError, TypeError, KeyError) as exc:
                failed.append({"video": index, "reason": str(exc)})
    return jsonify(code=200, data={"plans": plans, "failed": failed})


def record(payload, state, message=""):
    """发布历史与持久队列共用明细编号，结果回传后可安全重复更新。"""
    from ext_api.task_queue import _refresh_batch_status
    from app import PLATFORM_MAP
    plan = payload["_plan"]
    account, merged = plan["account"], plan["merged"]
    detail, batch = payload["__detail_id"], payload["batchId"]
    kind = plan.get("kind", "video")
    now = datetime.now().isoformat()
    with sqlite3.connect(BASE_DIR / "db/database.db", timeout=15) as conn:
        conn.execute("INSERT OR IGNORE INTO publish_batches(id,type,title,description,status,created_at,updated_at,source) "
                     "VALUES (?,?,?,?,'pending',?,?,'batch')", (batch, kind, payload.get("title", ""),
                     plan["kwargs"].get("desc", ""), now, now))
        conn.execute("INSERT OR IGNORE INTO publish_details(id,batch_id,account_id,account_name,platform,account_configs,status,created_at) "
                     "VALUES (?,?,?,?,?,?,?,?)", (detail, batch, account["id"], account["userName"],
                     PLATFORM_MAP.get(account["type"], str(account["type"])), json.dumps(merged, ensure_ascii=False), state, now))
        conn.execute("UPDATE publish_details SET status=?,error_message=?,started_at=COALESCE(started_at,?) WHERE id=?",
                     (state, message, now if state == "running" else None, detail))
        if state in {"success", "failed", "cancelled"}:
            conn.execute("UPDATE publish_details SET finished_at=? WHERE id=?", (now, detail))
        _refresh_batch_status(conn, batch)


@hybrid_worker.post("/record")
def record_pending():
    """供已认证网关登记和更新任务历史，不执行平台操作。"""
    data = request.json
    record(data["payload"], data["state"], data.get("message", ""))
    return jsonify(code=200)


@hybrid_worker.post("/run")
def run():
    """单个视频、单个账号执行；调用平台公共实现，不再进入旧内存批量队列。"""
    from impl.registry import get_platform
    from storage import resolve_material_path
    payload = request.json
    record(payload, "running")
    try:
        kind = payload["_plan"].get("kind", "video")
        if kind in {"image", "article"}:
            from blueprints.image_publish_bp import publish_images
            from blueprints.article_publish_bp import publish_article
            # 单次调用已有公共发布实现，明细编号固定，避免排队记录和执行记录重复。
            operation = f"/api/{kind}-publish/publish"
            with current_app.test_request_context(operation, method="POST", json=payload):
                response = publish_images() if kind == "image" else publish_article()
                response = response[0] if isinstance(response, tuple) else response
                result = response.get_json()
            record(payload, "success" if result.get("code") == 200 else "failed", result.get("msg", ""))
            return jsonify(result)
        platform = get_platform(payload["type"])
        if not platform:
            raise ValueError("当前插件不支持该平台，请更新插件")
        kwargs = dict(payload["_plan"]["kwargs"])
        kwargs["files"] = [resolve_material_path(_relative(value)) for value in kwargs["files"]]
        for value in kwargs["files"]:
            if not Path(value).is_file():
                raise ValueError("视频素材在执行设备上不可用")
        for field in list(kwargs):
            if field.endswith("_path") and kwargs[field]:
                kwargs[field] = resolve_material_path(_relative(kwargs[field]))
        method = platform.publish_video
        success = asyncio.run(method(**kwargs)) if inspect.iscoroutinefunction(method) else method(**kwargs)
        if not success:
            raise ValueError("平台未确认发布结果，请核对平台提示")
        record(payload, "success")
        return jsonify(code=200, msg="平台操作完成", data={"batch_id": payload["batchId"]})
    except (Exception, asyncio.CancelledError) as exc:
        # 只把业务提示写入任务结果，平台凭证与堆栈不回传网页。
        message = str(exc)[:1000] or "平台操作已中断"
        record(payload, "failed", message)
        return jsonify(code=500, msg=message), 500
