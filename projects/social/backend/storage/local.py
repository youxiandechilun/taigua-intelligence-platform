from __future__ import annotations

from flask import abort, send_from_directory
from pathlib import Path
import mimetypes

from storage.base import StorageBackend


class LocalStorage(StorageBackend):
    type = "local"

    def __init__(self, base_dir):
        self.base_dir = Path(base_dir)

    def _resolve(self, relative_path):
        """泰卦部署改造：所有本地读写都必须位于当前员工目录，禁止路径跳转。"""
        target = (self.base_dir / relative_path).resolve()
        if not target.is_relative_to(self.base_dir.resolve()):
            raise ValueError("文件路径超出当前工作区")
        return target

    def save(self, file_data: bytes, relative_path: str) -> str:
        full_path = self._resolve(relative_path)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(file_data)
        return relative_path

    def save_stream(self, stream_iter, relative_path: str) -> str:
        full_path = self._resolve(relative_path)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        with open(full_path, 'wb') as f:
            for chunk in stream_iter:
                if chunk:
                    f.write(chunk)
        return relative_path

    def get(self, relative_path: str) -> bytes:
        full_path = self._resolve(relative_path)
        return full_path.read_bytes()

    def get_url(self, relative_path: str) -> str:
        return f"/api/materials/file/{relative_path}"

    def delete(self, relative_path: str) -> bool:
        full_path = self._resolve(relative_path)
        if full_path.exists():
            full_path.unlink()
            return True
        return False

    def exists(self, relative_path: str) -> bool:
        return self._resolve(relative_path).exists()

    def serve(self, relative_path: str):
        # 泰卦部署改造：素材接口只提供媒体目录，数据库、日志和 Cookie 不能作为素材下载。
        if Path(relative_path).parts[:1] not in [("materials",), ("covers",), ("thumbnails",)]:
            abort(404)
        full_path = self._resolve(relative_path)
        directory = str(full_path.parent)
        filename = full_path.name
        # 泰卦部署改造：网页、SVG、脚本等附件只能下载，防止以系统域名执行上传内容。
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        inline_media = mime.startswith(("video/", "audio/")) or mime in {"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"}
        return send_from_directory(directory, filename, as_attachment=not inline_media)

    def get_local_path(self, relative_path: str) -> str | None:
        full_path = self._resolve(relative_path)
        if full_path.exists():
            return str(full_path)
        return None
