"""海外平台状态元数据回归测试。"""

import sys
import unittest
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from blueprints.overseas_bp import OVERSEAS_PLATFORMS  # noqa: E402


class OverseasPlatformStatusTests(unittest.TestCase):
    """确认接口不会把仅完成代码接入的平台误报为已验收。"""

    def test_all_platforms_use_unverified_status_until_real_acceptance(self):
        """所有海外平台都应明确显示待真实账号验收。"""
        self.assertEqual(len(OVERSEAS_PLATFORMS), 8)
        for platform in OVERSEAS_PLATFORMS:
            self.assertEqual(platform["status"], "code_ready_unverified")
            self.assertIn("尚未用真实账号验收", platform["status_text"])


if __name__ == "__main__":
    unittest.main()
