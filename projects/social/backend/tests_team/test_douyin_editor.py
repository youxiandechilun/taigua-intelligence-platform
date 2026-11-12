"""抖音编辑区兼容回归：真实浏览器加载合成页面，全程不访问或发布真实平台。"""

import os
import unittest

from playwright.async_api import async_playwright

from impl.douyin.editor import fill_publish_editor


@unittest.skipUnless(os.environ.get("TAIGUA_TEST_CHROMIUM"), "需要已安装的浏览器验证编辑区")
class DouyinEditorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.driver = await async_playwright().start()
        self.browser = await self.driver.chromium.launch(
            executable_path=os.environ["TAIGUA_TEST_CHROMIUM"], headless=True,
            args=["--no-sandbox"])
        self.page = await self.browser.new_page()

    async def asyncTearDown(self):
        await self.browser.close()
        await self.driver.stop()

    async def test_current_placeholder_layout_does_not_need_description_label_ancestry(self):
        """现代布局没有旧版标签层级，标题和正文仍应写到各自字段。"""
        await self.page.set_content('<input placeholder="搜索作品"><input placeholder="添加作品标题">'
                                    '<div class="zone-container" contenteditable="true">旧正文</div>')
        await fill_publish_editor(self.page, "新标题", "新正文", ["合成话题"], timeout_ms=500)
        self.assertEqual(await self.page.get_by_placeholder("添加作品标题").input_value(), "新标题")
        self.assertEqual(await self.page.get_by_placeholder("搜索作品").input_value(), "")
        self.assertIn("新正文", await self.page.locator(".zone-container").inner_text())
        self.assertIn("#合成话题", await self.page.locator(".zone-container").inner_text())
        self.assertNotIn("旧正文", await self.page.locator(".zone-container").inner_text())

    async def test_legacy_section_and_hidden_duplicates(self):
        """保留旧布局兼容，但隐藏模板不得抢占真实可见编辑框。"""
        await self.page.set_content('<div hidden><input placeholder="添加作品标题"></div>'
            '<section><header><div><span>作品描述</span></div></header>'
            '<main><input type="text"><div class="zone-container" contenteditable="true"></div></main></section>')
        await fill_publish_editor(self.page, "旧布局标题", "正文", timeout_ms=500)
        self.assertEqual(await self.page.locator("main input").input_value(), "旧布局标题")

    async def test_textarea_description_and_title_length(self):
        """文本域布局与图集标题长度限制共用相同的可编辑性校验。"""
        await self.page.set_content('<input aria-label="作品标题"><textarea placeholder="添加作品描述"></textarea>')
        await fill_publish_editor(self.page, "题" * 40, "正文", title_limit=20, timeout_ms=500)
        self.assertEqual(await self.page.get_by_label("作品标题").input_value(), "题" * 20)
        self.assertEqual((await self.page.locator("textarea").input_value()).strip(), "正文")

    async def test_delayed_editor_waits_for_both_fields(self):
        """跳转已完成但编辑区仍在渲染时，等到字段真实可见再填写。"""
        await self.page.set_content('<script>setTimeout(() => {document.body.innerHTML = '
            '\'<input placeholder="添加作品标题"><div data-zone-container="body" contenteditable="true"></div>\'}, 120)</script>')
        await fill_publish_editor(self.page, "延迟标题", "正文", timeout_ms=1500)
        self.assertEqual(await self.page.locator("input").input_value(), "延迟标题")

    async def test_ambiguous_fields_stop_before_writing(self):
        """多个可见编辑框不能随意取第一个，避免误填商品或其他表单。"""
        await self.page.set_content('<input placeholder="添加作品标题"><input placeholder="添加作品标题">'
                                    '<div class="zone-container" contenteditable="true"></div>')
        with self.assertRaisesRegex(RuntimeError, "多个.*标题"):
            await fill_publish_editor(self.page, "不能误填", "正文", timeout_ms=300)
        self.assertEqual(await self.page.locator("input").evaluate_all("nodes => nodes.map(n => n.value)"), ["", ""])

    async def test_missing_editor_reports_actionable_reason(self):
        """登录页或未就绪页面不应再把底层 XPath 超时堆栈直接交给员工。"""
        await self.page.set_content('<h1>扫码登录</h1><input placeholder="搜索作品">')
        with self.assertRaisesRegex(RuntimeError, "编辑区.*未就绪"):
            await fill_publish_editor(self.page, "标题", "正文", timeout_ms=100)

