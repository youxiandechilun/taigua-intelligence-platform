"""本机插件内部工作进程：复用平台实现，关闭服务器保活和启动时自动浏览器任务。"""

import os
import sys
import threading
import time
from waitress import serve
from init_db import init_database, migrate_database


if __name__ == "__main__":
    def watch_parent():
        """插件主进程崩溃后及时退出内部服务，不留下失去管理的本机后台进程。"""
        parent = int(os.environ.get("SAU_PARENT_PID", "0"))
        if parent and sys.platform == "win32":
            import ctypes
            # Windows 的 os.kill(pid, 0) 不是可靠的存活探测，改为等待父进程句柄。
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = kernel.OpenProcess(0x00100000, False, parent)
            if handle:
                kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
                kernel.CloseHandle(handle)
            os._exit(0)
        while parent:
            time.sleep(3)
            if os.getppid() != parent:
                # 正式工作进程拥有独立进程组，父插件消失时一并关闭所属浏览器。
                import signal
                if os.getpgrp() == os.getpid():
                    os.killpg(os.getpgrp(), signal.SIGTERM)
                os._exit(0)
    threading.Thread(target=watch_parent, daemon=True).start()
    # 先初始化再导入应用，保证独立安装首次启动时也有完整的数据表。
    init_database()
    migrate_database()
    from app import app
    serve(app, host="127.0.0.1", port=int(os.environ["SAU_PORT"]), threads=8)
