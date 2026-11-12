"""海外平台内容类型能力与真实验收状态的回归检查。"""

from impl.platform_meta import PLATFORM_META, build_platform_entry


OVERSEAS_KEYS = {
    "tiktok", "youtube", "instagram", "facebook",
    "x", "linkedin", "threads", "pinterest",
}


def test_overseas_capabilities_are_video_only_and_unverified():
    """海外适配器只声明视频，且代码接入不能冒充真实账号验收完成。"""
    for key in OVERSEAS_KEYS:
        meta = PLATFORM_META[key]
        assert meta["content_types"] == ["video"]
        assert meta["verification_status"] == "code_ready_unverified"
        assert "真实账号" in meta["verification_text"]

        capabilities = meta["capabilities"]
        assert capabilities["video"]["supported"] is True
        assert capabilities["video"]["status"] == "code_ready_unverified"
        for content_type in ("image", "carousel", "article"):
            assert capabilities[content_type]["supported"] is False
            assert capabilities[content_type]["status"] == "not_implemented"


def test_platform_entry_exposes_capabilities_without_sharing_mutable_state():
    """/api/v2/platforms 输出能力元数据，调用方修改副本不能污染全局配置。"""
    first = build_platform_entry(101, "instagram", "Instagram")
    second = build_platform_entry(101, "instagram", "Instagram")
    assert first["content_types"] == ["video"]
    assert first["verification_status"] == "code_ready_unverified"
    assert first["capabilities"]["image"]["supported"] is False

    first["capabilities"]["video"]["label"] = "被测试修改"
    assert second["capabilities"]["video"]["label"] != "被测试修改"
    assert PLATFORM_META["instagram"]["capabilities"]["video"]["label"] != "被测试修改"
