"""跨平台非阻塞文件租约，进程退出后由操作系统释放。"""

from __future__ import annotations

import os
from typing import BinaryIO

if os.name == "nt":
    import msvcrt
else:
    import fcntl


def lock_file(handle: BinaryIO) -> None:
    if os.name == "nt":
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            raise BlockingIOError("租约已被其他进程持有") from exc
    else:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
