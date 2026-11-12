"""为单入口应用写入当前员工的一次性关联信息，不混入其他员工凭证。"""

import json
import copy
import shutil
import struct
import zipfile


MAC_PROGRAM = "泰卦插件.app/Contents/Resources/program"
WINDOWS_ENTRY = "泰卦插件.exe"
CONFIG_MAGIC = b"TAIGUA-CONFIG-01"


def personalize_executor(package, target, config, platform):
    """Mac 关联信息留在应用内部；Windows 随启动程序封装，外层仅有一个图标。"""
    encoded = json.dumps(config, ensure_ascii=False).encode("utf-8")
    if len(encoded) > 65536:
        raise ValueError("插件关联信息长度异常")
    if platform.startswith("macos-"):
        shutil.copyfile(package, target)
        with zipfile.ZipFile(target, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(MAC_PROGRAM + "/activation.json", encoded)
        return
    # 流式追加关联信息，服务器不会同时解压或把整个 Windows 运行环境读入内存。
    with zipfile.ZipFile(package) as source, zipfile.ZipFile(target, "w") as output:
        if source.namelist() != [WINDOWS_ENTRY]:
            raise ValueError("Windows 插件包缺少唯一启动入口")
        info = copy.copy(source.getinfo(WINDOWS_ENTRY))
        info.file_size += len(encoded) + 24
        with source.open(WINDOWS_ENTRY) as executable, output.open(info, "w", force_zip64=True) as result:
            shutil.copyfileobj(executable, result, 1024 * 1024)
            result.write(encoded)
            result.write(struct.pack("<Q", len(encoded)) + CONFIG_MAGIC)
