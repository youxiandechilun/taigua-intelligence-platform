"""用合成 Mach-O 证明系统版本与芯片校验有效，不运行真实安装器。"""

import io
from pathlib import Path
import plistlib
import struct
import tempfile
import unittest
import zipfile

from verify_macos_package import APP_ROOT, PackageCompatibilityError, inspect_macho, verify_package


X64, ARM64 = 0x01000007, 0x0100000C


def thin(cpu=X64, minimum=13 << 16, old=False, endian="<"):
    """构造最小合法头部，覆盖老系统版本指令与新版本指令。"""
    command = (struct.pack(endian + "IIII", 0x24, 16, minimum, minimum) if old else
               struct.pack(endian + "IIIIII", 0x32, 24, 1, minimum, minimum, 0))
    return struct.pack(endian + "IIIIIIII", 0xFEEDFACF, cpu, 0, 6, 1, len(command), 0, 0) + command


def fat(values, wide=False, endian=">"):
    """合成 32/64 位架构表，并让各切片使用自己的原生字节序。"""
    record_size = 32 if wide else 20
    offset, records, slices = 8 + len(values) * record_size, [], []
    for cpu, value in values:
        if wide:
            records.append(struct.pack(endian + "IIQQII", cpu, 0, offset, len(value), 0, 0))
        else:
            records.append(struct.pack(endian + "IIIII", cpu, 0, offset, len(value), 0))
        offset += len(value)
        slices.append(value)
    return struct.pack(endian + "II", 0xCAFEBABF if wide else 0xCAFEBABE, len(values)) + b"".join(records + slices)


class MachOTests(unittest.TestCase):
    """边界用例覆盖越界、损坏指令以及不受本机架构影响的通用文件扫描。"""

    def scan(self, value):
        """使用内存流模拟 ZIP 成员，不向磁盘解压任何可执行文件。"""
        return inspect_macho(io.BytesIO(value), len(value))

    def test_thin_new_and_old_commands_handle_both_byte_orders(self):
        """同一版本在两种端序以及两种版本指令中都应得到一致结果。"""
        for endian in ("<", ">"):
            for old in (False, True):
                with self.subTest(endian=endian, old=old):
                    self.assertEqual(self.scan(thin(old=old, endian=endian)),
                                     [{"architecture": "x86_64", "minimum": (13, 0, 0)}])

    def test_fat_32_and_64_scan_every_slice(self):
        """即使当前机器是 Intel，也必须读出 Apple 芯片切片中的更高系统要求。"""
        for wide in (False, True):
            for endian in ("<", ">"):
                value = fat([(X64, thin()), (ARM64, thin(ARM64, 14 << 16))], wide, endian)
                self.assertEqual(self.scan(value)[1], {"architecture": "arm64", "minimum": (14, 0, 0)})

    def test_truncated_header_or_load_command_is_rejected(self):
        """截断文件不能被默认为兼容或忽略版本。"""
        for value in (thin()[:16], thin()[:-1], b"\xca\xfe\xba\xbe" + struct.pack(">I", 1)):
            with self.subTest(length=len(value)), self.assertRaises(PackageCompatibilityError):
                self.scan(value)

    def test_fat_overlap_out_of_bounds_and_cpu_mismatch_are_rejected(self):
        """恶意架构表不能读取相邻数据或冒充所需的 CPU。"""
        original = fat([(X64, thin()), (ARM64, thin(ARM64))])
        bad_offset = bytearray(original)
        struct.pack_into(">I", bad_offset, 8 + 20 + 8, 48)
        out_of_bounds = bytearray(original)
        struct.pack_into(">I", out_of_bounds, 8 + 8, len(original) + 100)
        mismatch = fat([(X64, thin(ARM64))])
        for value in (bad_offset, out_of_bounds, mismatch):
            with self.assertRaises(PackageCompatibilityError):
                self.scan(value)

    def test_invalid_load_command_length_and_missing_version_are_rejected(self):
        """无效长度和未知最低版本都不能通过发布检查。"""
        malformed = bytearray(thin())
        struct.pack_into("<I", malformed, 36, 0)
        no_version = bytearray(thin())
        struct.pack_into("<I", no_version, 32, 0x1)
        for value in (malformed, no_version):
            with self.assertRaises(PackageCompatibilityError):
                self.scan(value)
        self.assertEqual(self.scan(b"ordinary Python source"), [])


class PackageTests(unittest.TestCase):
    """验证 plist、依赖二进制、唯一入口三者同时满足承诺。"""

    def package(self, root, binary=None, declared="13.0", extra=None):
        """只生成合成 ZIP，测试内容不包含员工凭据或真实业务文件。"""
        target = Path(root) / "synthetic.zip"
        with zipfile.ZipFile(target, "w") as archive:
            archive.writestr(APP_ROOT + "/Contents/Info.plist", plistlib.dumps({
                "LSMinimumSystemVersion": declared, "CFBundleExecutable": "TaiguaExecutor"}))
            archive.writestr(APP_ROOT + "/Contents/MacOS/TaiguaExecutor", b"#!/bin/sh\n")
            archive.writestr(APP_ROOT + "/Contents/Resources/program/runtime/bin/python3.12",
                             binary if binary is not None else thin())
            if extra:
                archive.writestr(extra, b"synthetic")
        return target

    def test_compatible_package_generates_small_report(self):
        """报告只包含兼容性摘要，不把安装包文件内容泄露到日志。"""
        with tempfile.TemporaryDirectory() as directory:
            result = verify_package(self.package(directory), "macos-x64")
            self.assertTrue(result["ok"])
            self.assertEqual(result["minimum_macos"], "13.0.0")
            self.assertEqual(result["maximum_binary_macos"], "13.0.0")
            self.assertEqual(result["macho_files"], 1)

    def test_newer_dependency_is_rejected_even_with_compatible_plist(self):
        """回归本次真实故障：plist 写 13，但 NumPy 切片要求 14，必须拒绝。"""
        with tempfile.TemporaryDirectory() as directory:
            package = self.package(directory, thin(minimum=14 << 16))
            with self.assertRaisesRegex(PackageCompatibilityError, "高于应用声明"):
                verify_package(package, "macos-x64")

    def test_wrong_chip_and_stricter_plist_are_rejected(self):
        """错误芯片与错误最低系统都会导致员工无法打开，均不能通过。"""
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(PackageCompatibilityError, "芯片架构"):
                verify_package(self.package(directory, thin(ARM64)), "macos-x64")
            with self.assertRaisesRegex(PackageCompatibilityError, "声明"):
                verify_package(self.package(directory, declared="14.0"), "macos-x64")

    def test_fat_newer_other_slice_is_rejected(self):
        """通用依赖的另一架构要求更高系统时，也不能作为兼容包发布。"""
        with tempfile.TemporaryDirectory() as directory:
            binary = fat([(X64, thin()), (ARM64, thin(ARM64, 14 << 16))])
            with self.assertRaisesRegex(PackageCompatibilityError, "高于应用声明"):
                verify_package(self.package(directory, binary), "macos-x64")

    def test_exposed_or_traversal_file_is_rejected(self):
        """外露文件破坏单应用约定，越界路径则会危及用户解压目录。"""
        with tempfile.TemporaryDirectory() as directory:
            for extra in ("README.txt", APP_ROOT + "/../outside", "/" + APP_ROOT + "/bad"):
                with self.subTest(extra=extra), self.assertRaises(PackageCompatibilityError):
                    verify_package(self.package(directory, extra=extra), "macos-x64")


if __name__ == "__main__":
    unittest.main()
