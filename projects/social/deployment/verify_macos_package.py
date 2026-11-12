"""静态检查 Mac 插件的实际系统要求，避免仅修改 plist 后仍打入不兼容二进制。"""

import argparse
import json
from pathlib import PurePosixPath
import plistlib
import stat
import struct
import sys
import zipfile


APP_ROOT = "泰卦插件.app"
TARGET_ARCHITECTURES = {"macos-x64": "x86_64", "macos-arm64": "arm64"}
CPU_ARCHITECTURES = {0x01000007: "x86_64", 0x0100000C: "arm64", 7: "i386", 12: "arm"}
THIN_MAGICS = {b"\xcf\xfa\xed\xfe": ("<", 32), b"\xfe\xed\xfa\xcf": (">", 32),
               b"\xce\xfa\xed\xfe": ("<", 28), b"\xfe\xed\xfa\xce": (">", 28)}
FAT_MAGICS = {b"\xca\xfe\xba\xbe": (">", 20), b"\xbe\xba\xfe\xca": ("<", 20),
              b"\xca\xfe\xba\xbf": (">", 32), b"\xbf\xba\xfe\xca": ("<", 32)}
# 只读取头部、架构表与加载指令，限制损坏文件伪造的超大长度。
MAX_LOAD_COMMAND_BYTES = 16 * 1024 * 1024
MAX_FAT_ARCHITECTURES = 64


class PackageCompatibilityError(ValueError):
    """安装包不满足承诺的系统或架构兼容性时，阻止发布。"""


def version_tuple(value):
    """把系统版本规范为三段，比较时不把 13.10 错当成 13.1。"""
    try:
        parts = tuple(int(part) for part in str(value).split("."))
    except ValueError as exc:
        raise PackageCompatibilityError("系统版本格式无效") from exc
    if not 1 <= len(parts) <= 3 or any(part < 0 or part > 65535 for part in parts):
        raise PackageCompatibilityError("系统版本格式无效")
    return parts + (0,) * (3 - len(parts))


def version_string(value):
    """报告统一使用三段版本，便于构建回执自动比较。"""
    return ".".join(str(part) for part in value)


def _read_at(stream, position, size, limit):
    """所有读取均核对当前切片边界，不让畸形头部越界读取其他切片。"""
    if position < 0 or size < 0 or position + size > limit:
        raise PackageCompatibilityError("Mach-O 头部或加载指令越界")
    stream.seek(position)
    data = stream.read(size)
    if len(data) != size:
        raise PackageCompatibilityError("Mach-O 文件被截断")
    return data


def _decode_version(value):
    """Mach-O 将主版本、次版本、补丁版本压缩在一个无符号整数中。"""
    return value >> 16, (value >> 8) & 255, value & 255


def _thin_slice(stream, start, length, expected_cpu=None):
    """读取单架构加载指令；同时支持新旧两种最低 macOS 版本指令。"""
    limit = start + length
    magic = _read_at(stream, start, 4, limit)
    if magic not in THIN_MAGICS:
        raise PackageCompatibilityError("通用二进制切片不是有效 Mach-O")
    endian, header_size = THIN_MAGICS[magic]
    header = _read_at(stream, start, header_size, limit)
    cpu = struct.unpack_from(endian + "I", header, 4)[0]
    if expected_cpu is not None and cpu != expected_cpu:
        raise PackageCompatibilityError("通用二进制架构表与切片头不一致")
    count, command_bytes = struct.unpack_from(endian + "II", header, 16)
    if command_bytes > MAX_LOAD_COMMAND_BYTES or count > command_bytes // 8:
        raise PackageCompatibilityError("Mach-O 加载指令数量或长度无效")
    commands = _read_at(stream, start + header_size, command_bytes, limit)
    offset, minimums = 0, []
    for _ in range(count):
        if offset + 8 > len(commands):
            raise PackageCompatibilityError("Mach-O 加载指令被截断")
        command, size = struct.unpack_from(endian + "II", commands, offset)
        if size < 8 or size % 4 or offset + size > len(commands):
            raise PackageCompatibilityError("Mach-O 加载指令长度无效")
        if command == 0x32:
            if size < 24:
                raise PackageCompatibilityError("Mach-O 系统版本指令被截断")
            platform, minimum, _, tools = struct.unpack_from(endian + "IIII", commands, offset + 8)
            if platform != 1 or size < 24 + tools * 8:
                raise PackageCompatibilityError("Mach-O 不是有效的 macOS 平台二进制")
            minimums.append(_decode_version(minimum))
        elif command == 0x24:
            if size < 16:
                raise PackageCompatibilityError("Mach-O 旧版系统版本指令被截断")
            minimums.append(_decode_version(struct.unpack_from(endian + "I", commands, offset + 8)[0]))
        offset += size
    if offset != len(commands) or not minimums or any(value == (0, 0, 0) for value in minimums):
        raise PackageCompatibilityError("Mach-O 缺少有效最低 macOS 版本")
    return {"architecture": CPU_ARCHITECTURES.get(cpu, "cpu-" + hex(cpu)), "minimum": max(minimums)}


def inspect_macho(stream, size):
    """非二进制返回空列表；通用文件逐一检查全部切片，不只检查本机架构。"""
    if size < 4:
        return []
    magic = _read_at(stream, 0, 4, size)
    if magic in THIN_MAGICS:
        return [_thin_slice(stream, 0, size)]
    if magic not in FAT_MAGICS:
        return []
    endian, record_size = FAT_MAGICS[magic]
    count = struct.unpack(endian + "I", _read_at(stream, 4, 4, size))[0]
    if not 1 <= count <= MAX_FAT_ARCHITECTURES:
        raise PackageCompatibilityError("通用二进制架构数量无效")
    table_end = 8 + count * record_size
    table = _read_at(stream, 8, count * record_size, size)
    slices, ranges, architectures = [], [], set()
    for index in range(count):
        offset = index * record_size
        cpu = struct.unpack_from(endian + "I", table, offset)[0]
        if record_size == 20:
            position, length = struct.unpack_from(endian + "II", table, offset + 8)
        else:
            position, length = struct.unpack_from(endian + "QQ", table, offset + 8)
        if cpu in architectures or position < table_end or not length or position + length > size:
            raise PackageCompatibilityError("通用二进制架构重复或切片越界")
        if any(position < end and start < position + length for start, end in ranges):
            raise PackageCompatibilityError("通用二进制切片相互重叠")
        architectures.add(cpu)
        ranges.append((position, position + length))
        slices.append(_thin_slice(stream, position, length, expected_cpu=cpu))
    return slices


def verify_package(path, target, minimum_system="13.0"):
    """直接检查 ZIP，不解压、不运行其中程序，也不读取员工激活信息。"""
    if target not in TARGET_ARCHITECTURES:
        raise PackageCompatibilityError("仅支持 Mac Intel 和 Mac Apple 芯片安装包")
    promised = version_tuple(minimum_system)
    expected_architecture = TARGET_ARCHITECTURES[target]
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        if not entries or len(names) != len(set(names)):
            raise PackageCompatibilityError("安装包为空或含重复文件")
        for name in names:
            parts = PurePosixPath(name).parts
            if not parts or parts[0] != APP_ROOT or ".." in parts or "\\" in name:
                raise PackageCompatibilityError("安装包外层必须只有泰卦插件.app，且不得含越界路径")
        try:
            info = plistlib.loads(archive.read(APP_ROOT + "/Contents/Info.plist"))
            if not isinstance(info, dict):
                raise PackageCompatibilityError("应用属性表格式无效")
            declared = version_tuple(info["LSMinimumSystemVersion"])
        except (KeyError, ValueError, TypeError, plistlib.InvalidFileException) as exc:
            raise PackageCompatibilityError("应用缺少有效最低系统声明") from exc
        if declared != promised:
            raise PackageCompatibilityError("应用最低系统声明与构建承诺不一致")
        executable = info.get("CFBundleExecutable")
        if (not isinstance(executable, str) or not executable or "/" in executable or
                APP_ROOT + "/Contents/MacOS/" + executable not in names):
            raise PackageCompatibilityError("应用缺少有效启动入口")
        macho_files, all_slices = 0, []
        for item in entries:
            # 符号链接载荷只是链接目标文字，不能误当作目标可执行文件。
            if item.is_dir() or stat.S_ISLNK(item.external_attr >> 16):
                continue
            with archive.open(item) as stream:
                try:
                    slices = inspect_macho(stream, item.file_size)
                except PackageCompatibilityError as exc:
                    raise PackageCompatibilityError(item.filename + ": " + str(exc)) from exc
            if not slices:
                continue
            macho_files += 1
            if expected_architecture not in {value["architecture"] for value in slices}:
                raise PackageCompatibilityError(item.filename + ": 不包含安装包要求的芯片架构")
            for value in slices:
                if value["minimum"] > declared:
                    raise PackageCompatibilityError(item.filename + ": 二进制最低 macOS " +
                                                    version_string(value["minimum"]) + " 高于应用声明")
            all_slices.extend(slices)
    if not all_slices:
        raise PackageCompatibilityError("安装包没有可校验的内置运行环境")
    return {"ok": True, "target": target, "minimum_macos": version_string(declared),
            "macho_files": macho_files, "slices": len(all_slices),
            "maximum_binary_macos": version_string(max(value["minimum"] for value in all_slices)),
            "architectures": sorted({value["architecture"] for value in all_slices})}


def main():
    """命令行只输出简短 JSON，失败使用非零退出码以阻止后续发布。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package")
    parser.add_argument("--target", choices=sorted(TARGET_ARCHITECTURES), required=True)
    parser.add_argument("--minimum-system", default="13.0")
    args = parser.parse_args()
    try:
        result = verify_package(args.package, args.target, args.minimum_system)
    except (PackageCompatibilityError, OSError, zipfile.BadZipFile) as exc:
        print(json.dumps({"ok": False, "target": args.target, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
