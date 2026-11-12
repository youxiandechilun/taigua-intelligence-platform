"""将本机真实状态转换为启动窗口文案，过期心跳不冒充已连接。"""

import time


def display_status(status, now=None):
    """只接收可展示状态，不接触员工令牌、激活码或平台 Cookie。"""
    now = time.time() if now is None else now
    state = status.get("state", "starting")
    if state == "online" and now - status.get("updated_at", 0) > 30:
        return "连接已中断", "请检查网络；插件正在后台尝试恢复连接。", False
    titles = {"starting": "正在启动", "connecting": "正在关联员工", "browser": "正在准备浏览器",
              "worker": "正在准备运行环境", "online": "已连接，可以使用", "offline": "暂时无法连接",
              "error": "启动失败", "stopped": "插件已停止"}
    return titles.get(state, "正在启动"), status.get("message", "请稍候，首次启动需要准备运行环境。"), state == "online"
