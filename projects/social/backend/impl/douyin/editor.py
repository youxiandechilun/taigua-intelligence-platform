"""抖音视频与图集共用编辑区适配，不依赖“作品描述”的固定父级和兄弟层级。"""

import asyncio
import time


TITLE_SELECTOR = ','.join(
    f'{tag}{attribute}:visible' for tag in ('input', 'textarea')
    for attribute in ('[placeholder*="标题"]', '[aria-label*="标题"]'))
DESCRIPTION_SELECTOR = ','.join([
    '[contenteditable="true"].zone-container:visible',
    '[contenteditable="true"][data-zone-container]:visible',
    *[f'{tag}[{attribute}*="{word}"]:visible'
      for tag in ('textarea', '[contenteditable="true"]')
      for attribute in ('placeholder', 'data-placeholder', 'aria-label')
      for word in ('描述', '简介', '介绍')],
])


async def find_publish_fields(page, timeout_ms=30000):
    """仅选择唯一可见且可编辑的标题、正文；渲染延迟可等待，歧义必须停止。"""
    deadline = time.monotonic() + timeout_ms / 1000
    while not page.is_closed():
        title = page.locator(TITLE_SELECTOR)
        description = page.locator(DESCRIPTION_SELECTOR)
        if await title.count() == 0:
            # 老版无占位文字时，只在同时含正文编辑器的最近作品描述区寻找标题。
            section = page.get_by_text('作品描述', exact=True).locator(
                'xpath=ancestor::*[self::div or self::section]'
                '[.//input and .//*[@contenteditable="true"]][1]')
            title = section.locator('input[type="text"]:visible:not([placeholder]), input:not([type]):visible:not([placeholder])')
        title_count, description_count = await title.count(), await description.count()
        if title_count > 1:
            raise RuntimeError('抖音页面出现多个可见标题输入框，请打开创作中心核对编辑页后重试')
        if description_count > 1:
            raise RuntimeError('抖音页面出现多个可见正文编辑框，请关闭额外弹窗后重试')
        if title_count == description_count == 1 and await title.is_editable() and await description.is_editable():
            return title, description
        if time.monotonic() >= deadline:
            break
        await asyncio.sleep(min(0.2, max(0, deadline - time.monotonic())))
    raise RuntimeError('抖音发布编辑区尚未就绪：未找到可编辑的作品标题或描述；请确认账号已登录、上传已完成，并在创作中心检查是否有验证提示')


async def fill_publish_editor(page, title, description, tags=None, *, title_limit=30, timeout_ms=30000, pause=None):
    """先确认两个字段，再填写并校验；不点击发布按钮，也不在失败时自动重复发布。"""
    title_input, editor = await find_publish_fields(page, timeout_ms)
    expected_title = str(title or '')[:title_limit]
    await title_input.fill(expected_title)
    if await title_input.input_value() != expected_title:
        raise RuntimeError('抖音作品标题填写后未保留，请检查页面提示后重试')
    if pause:
        await pause()
    # Playwright 的 fill 同时支持文本域和富文本，避免 Mac 全选快捷键误选整个网页。
    text = str(description or '').rstrip()
    await editor.fill(text)
    actual = await editor.evaluate('el => el.value === undefined ? el.innerText : el.value')
    if actual.replace('\r\n', '\n').strip() != text.replace('\r\n', '\n').strip():
        raise RuntimeError('抖音作品描述填写后未保留，请检查页面提示后重试')
    if pause:
        await pause()
    # 显式移到全文末尾，避免多段正文中把话题插进鼠标点击位置所在的行。
    await editor.press('ControlOrMeta+End')
    for tag in tags or []:
        value = str(tag or '').strip().lstrip('#')
        if value:
            await page.keyboard.insert_text(' #' + value)
            await page.keyboard.press('Space')
            await page.keyboard.press('End')
    if pause:
        await pause()
