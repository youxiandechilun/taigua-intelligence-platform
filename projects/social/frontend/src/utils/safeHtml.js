// 泰卦部署改造：员工草稿在管理员查看时仍是外部输入，保留正文排版并移除脚本和表单。
import DOMPurify from 'dompurify'

export function sanitizeRichHtml(value) {
  return DOMPurify.sanitize(String(value || ''), {
    FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'button'],
  })
}
