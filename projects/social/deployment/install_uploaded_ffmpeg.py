"""泰卦部署改造：网络较慢时，校验并安装通过面板上传的官方视频工具。"""

import hashlib
from pathlib import Path
import shutil
import subprocess
import tarfile

BASE = Path('/opt/taigua-publish')
ARCHIVE_NAME = 'ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz'


def main():
    archive = BASE / 'incoming/ffmpeg-linux.tar.xz'
    # 校验值来自准备阶段直接从官方发行页下载的校验文件。
    lines = (BASE / 'ffmpeg-checksums.sha256').read_text().splitlines()
    expected = next(line.split()[0] for line in lines if line.endswith(ARCHIVE_NAME))
    with archive.open('rb') as source:
        assert hashlib.file_digest(source, 'sha256').hexdigest() == expected, '上传文件与官方校验值不一致'
    binaries = BASE / 'bin'
    licenses = BASE / 'licenses/ffmpeg'
    binaries.mkdir(exist_ok=True)
    licenses.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as distribution:
        for name in ('ffmpeg', 'ffprobe'):
            member = next(m for m in distribution.getmembers() if m.name.endswith('/bin/' + name) and m.isfile())
            with distribution.extractfile(member) as source, (binaries / name).open('wb') as target:
                shutil.copyfileobj(source, target)
            (binaries / name).chmod(0o755)
        member = next(m for m in distribution.getmembers() if m.name.endswith('/LICENSE.txt') and m.isfile())
        with distribution.extractfile(member) as source, (licenses / 'LICENSE.txt').open('wb') as target:
            shutil.copyfileobj(source, target)
    # 保留官方发行包和校验记录，便于日后核对构建来源和许可证。
    (licenses / 'SOURCE.txt').write_text('https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/latest/' + ARCHIVE_NAME + '\nSHA256: ' + expected + '\n')
    for name in ('ffmpeg', 'ffprobe'):
        subprocess.run([str(binaries / name), '-version'], check=True)
    print('FFMPEG_OFFLINE_OK：官方校验、许可证保存和程序启动均通过。')


if __name__ == '__main__':
    main()
