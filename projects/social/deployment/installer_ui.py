"""插件可见启动窗口：显示真实准备进度和连接状态，关闭窗口不停止后台任务。"""

import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import ttk
import webbrowser


# 状态转换保持为纯 Python 模块，服务器测试不需要安装桌面图形库。
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
from executor_status import display_status


class LauncherWindow:
    """窗口只展示启动和连接信息，员工不需要设置地址或点击连接。"""

    def __init__(self, root=None, server=None):
        self.root = Path(root) if root else None
        self.server = server
        self.events = queue.Queue()
        self.window = tk.Tk(className="TaiguaExecutor")
        self.window.title("泰卦插件")
        self.window.geometry("520x370")
        self.window.minsize(500, 360)
        self.window.configure(bg="#f7f8fa")
        self.window.option_add("*Font", ("Microsoft YaHei" if sys.platform == "win32" else "PingFang SC", 12))
        panel = tk.Frame(self.window, bg="#f7f8fa", padx=30, pady=24)
        panel.pack(fill="both", expand=True)
        tk.Label(panel, text="泰卦插件", bg="#f7f8fa", fg="#bb3346", font=("", 22, "bold")).pack(anchor="w")
        self.title = tk.Label(panel, text="正在启动", bg="#f7f8fa", fg="#263241", font=("", 16, "bold"))
        self.title.pack(anchor="w", pady=(18, 8))
        self.detail = tk.Label(panel, text="正在准备，请稍候……", bg="#f7f8fa", fg="#637185", wraplength=435, justify="left", height=3)
        self.detail.pack(anchor="w", fill="x")
        self.progress = ttk.Progressbar(panel, mode="indeterminate")
        self.progress.pack(fill="x", pady=(4, 16))
        self.progress.start(15)
        actions = tk.Frame(panel, bg="#f7f8fa")
        actions.pack(fill="x")
        ttk.Button(actions, text="打开系统", command=self.open_system).pack(side="left")
        ttk.Button(actions, text="查看日志", command=self.open_log).pack(side="left", padx=8)
        ttk.Button(actions, text="关闭窗口", command=self.window.destroy).pack(side="right")
        tk.Label(panel, text="关闭窗口后，插件继续在后台运行。", bg="#f7f8fa", fg="#7b8797", font=("", 10)).pack(anchor="w", pady=(14, 0))

    def open_system(self):
        """只打开安装包固定的系统地址，不在 URL 中附带任何关联凭证。"""
        if self.server:
            webbrowser.open(self.server.rstrip("/") + "/#/settings")

    def open_log(self):
        """日志按钮打开当前员工日志文件，首次复制尚未完成时不误报错误。"""
        if self.root and (self.root / "executor.log").exists():
            target = str(self.root / "executor.log")
            if sys.platform == "win32":
                os.startfile(target)
            else:
                subprocess.Popen(["open", target])

    def poll(self):
        """所有控件更新在主线程执行，安装复制与网络准备不冻结界面。"""
        try:
            while True:
                state, message = self.events.get_nowait()
                if state == "__handoff__":
                    self.window.destroy()
                    return
                self.title.configure(text=state)
                self.detail.configure(text=message)
                if state == "启动失败":
                    self.progress.stop()
        except queue.Empty:
            pass
        if self.root:
            try:
                status = json.loads((self.root / "status.json").read_text(encoding="utf-8"))
                title, detail, online = display_status(status)
                self.title.configure(text=title)
                self.detail.configure(text=detail)
                if online or status.get("state") in {"error", "stopped"}:
                    self.progress.stop()
                else:
                    self.progress.start(15)
            except (OSError, ValueError):
                pass
        self.window.after(1000, self.poll)

    def install(self):
        """安装副本准备好后由已安装程序接管窗口，临时解压目录随后即可清理。"""
        from install_executor import install
        try:
            root, program = install(notify=lambda text: self.events.put(("正在准备", text)))
            if not (program / "installer_ui.py").exists():
                # 旧进程持有员工运行锁时不覆盖它，也不误启动不存在的新版窗口。
                self.events.put(("启动失败", "检测到旧版插件仍在后台运行，请先退出旧版插件，再打开新版；素材和账号数据会保留。"))
                return
            python = program / "runtime" / ("pythonw.exe" if sys.platform == "win32" else "bin/python3")
            subprocess.Popen([str(python), str(program / "installer_ui.py"), "--monitor", str(root)],
                             start_new_session=sys.platform != "win32", close_fds=True)
            # 让事件队列驱动主线程结束窗口，不从工作线程调用 Tk API。
            self.events.put(("__handoff__", ""))
        except FileNotFoundError:
            self.events.put(("启动失败", "下载包不完整或员工关联信息缺失，请从系统设置重新下载并解压。"))
        except PermissionError:
            self.events.put(("启动失败", "没有写入当前用户程序目录的权限，请检查目录权限或磁盘状态。"))
        except OSError:
            self.events.put(("启动失败", "程序复制或启动失败，请检查磁盘可用空间，并重新解压下载包。"))
        except Exception:
            self.events.put(("启动失败", "未能完成启动，请从系统设置重新下载当前员工的插件。"))

    def run(self, installing=False):
        """安装阶段与状态监视共用同一外观，入口始终只有一个应用。"""
        if installing:
            threading.Thread(target=self.install, daemon=False).start()
        self.poll()
        self.window.mainloop()


def main():
    """监视模式不创建账号、不安装启动项，可用于独立检查真实状态窗口。"""
    if len(sys.argv) >= 3 and sys.argv[1] == "--monitor":
        root = Path(sys.argv[2])
        config = json.loads((root / "program/activation.json").read_text(encoding="utf-8"))
        LauncherWindow(root, config["server"]).run()
    else:
        LauncherWindow().run(installing=True)


if __name__ == "__main__":
    main()
