"""泰卦品牌配置：全员共用，图片规范化后原子保存到持久化目录。"""

import hashlib
import io
import os
from pathlib import Path
import tempfile

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_LOGO_BYTES = 5 * 1024 * 1024
DEFAULT_DIR = Path(__file__).resolve().parent / "branding"


class BrandAssets:
    def __init__(self, state):
        self.directory = Path(state) / "branding"
        self.directory.mkdir(exist_ok=True, mode=0o700)
        self.custom = self.directory / "logo.png"

    def path(self, icon=False):
        if self.custom.exists():
            return self.custom
        return DEFAULT_DIR / ("icon.png" if icon else "logo.png")

    def info(self):
        data, custom = self.read()
        version = hashlib.sha256(data).hexdigest()[:16]
        return {"is_custom": custom, "version": version,
                "logo_url": f"/api/team/branding/logo?v={version}",
                "icon_url": f"/api/team/branding/icon?v={version}"}

    def read(self, icon=False):
        # 恢复默认与其他员工读取可能同时发生，读取失败时安全回退内置图片。
        try:
            return self.custom.read_bytes(), True
        except FileNotFoundError:
            return (DEFAULT_DIR / ("icon.png" if icon else "logo.png")).read_bytes(), False

    def save(self, stream):
        # 不依赖扩展名或浏览器 MIME；实际解码并重新编码，拒绝 SVG、动画和超大图片。
        raw = stream.read(MAX_LOGO_BYTES + 1)
        if not raw or len(raw) > MAX_LOGO_BYTES:
            raise ValueError("请选择不超过 5 MB 的图片")
        try:
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError("仅支持 PNG、JPG 和 WebP 图片")
                if source.width * source.height > 20_000_000 or getattr(source, "n_frames", 1) != 1:
                    raise ValueError("请使用不超过 2000 万像素的静态图片")
                image = ImageOps.exif_transpose(source).convert("RGBA")
                bounds = image.getbbox()
                if not bounds:
                    raise ValueError("图片内容不能为空")
                image = image.crop(bounds)
                image.thumbnail((1600, 512), Image.Resampling.LANCZOS)
                normalized = io.BytesIO()
                image.save(normalized, format="PNG", optimize=True)
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise ValueError("图片无法读取，请重新选择有效图片") from exc
        # 同目录临时文件替换，避免员工读取到上传了一半的 Logo。
        descriptor, temporary = tempfile.mkstemp(dir=self.directory, suffix=".png")
        try:
            with os.fdopen(descriptor, "wb") as target:
                target.write(normalized.getvalue())
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, self.custom)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def reset(self):
        # 恢复默认只撤销自定义图片；内置原始品牌图始终保留。
        self.custom.unlink(missing_ok=True)
