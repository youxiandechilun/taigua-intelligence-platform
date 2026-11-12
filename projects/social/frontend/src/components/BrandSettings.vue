<template>
  <!-- 品牌设置锚点供管理员的新手引导定位。 -->
  <section class="brand-card" data-tour="brand-settings" aria-labelledby="brand-title">
    <h3 id="brand-title">系统 Logo</h3>
    <p>所有员工共用此 Logo，保存后立即生效，其他页面刷新后更新。</p>
    <div class="brand-preview"><img :src="preview || branding.logo_url" alt="系统 Logo 预览" /></div>
    <div class="brand-actions">
      <el-button :disabled="busy" @click="fileInput.click()">选择图片</el-button>
      <el-button type="primary" :disabled="!selected" :loading="busy" @click="save">保存 Logo</el-button>
      <el-button :disabled="busy || !branding.is_custom" @click="reset">恢复默认</el-button>
      <input ref="fileInput" class="file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择系统 Logo 图片" @change="choose" />
    </div>
    <p class="brand-hint">支持 PNG、JPG、WebP，最大 5 MB；建议使用透明背景的横版图片，按原比例显示。</p>
    <p v-if="selected" class="brand-hint">待保存：{{ selected.name }}</p>
    <p v-if="error" role="alert" class="brand-error">{{ error }}</p>
    <p v-if="success" role="status" class="brand-status">{{ success }}</p>
  </section>
</template>
<script setup>
// 泰卦品牌设置：仅管理员页面展示入口，服务端独立验证权限和图片内容。
import { ref, onBeforeUnmount } from 'vue'
import { branding, updateBranding } from '@/utils/branding'
import { teamRequest } from '@/utils/teamSession'
const fileInput = ref(null), selected = ref(null), preview = ref(''), busy = ref(false), error = ref(''), success = ref('')
function clearSelection() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''; selected.value = null
  if (fileInput.value) fileInput.value.value = ''
}
function choose(event) {
  const file = event.target.files[0]
  error.value = ''; success.value = ''; clearSelection()
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { error.value = '请选择不超过 5 MB 的图片'; return }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { error.value = '仅支持 PNG、JPG 和 WebP 图片'; return }
  selected.value = file; preview.value = URL.createObjectURL(file)
}
async function persist(reset = false) {
  busy.value = true; error.value = ''; success.value = ''
  try {
    const body = new FormData()
    if (!reset) body.append('logo', selected.value)
    updateBranding(await teamRequest('branding', { method: reset ? 'DELETE' : 'POST', ...(reset ? {} : { body }) }))
    clearSelection(); success.value = reset ? '已恢复默认 Logo' : 'Logo 已保存，全部员工共用'
  } catch (err) { error.value = err.message } finally { busy.value = false }
}
const save = () => persist(false)
const reset = () => persist(true)
onBeforeUnmount(clearSelection)
</script>
<style scoped>
.brand-card { padding: 24px; margin-bottom: 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-elevated); }
h3 { margin: 0 0 12px; color: var(--text-primary); font-size: 16px; }
p { color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
/* 浅色底保留用户原图颜色，也让深色主题中的灰色文字清晰可见。 */
.brand-preview { display: flex; align-items: center; justify-content: center; width: min(420px, 100%); height: 88px; padding: 12px; box-sizing: border-box; background: #fff; border: 1px solid var(--border); border-radius: 8px; margin: 18px 0; }
.brand-preview img { width: 100%; height: 100%; object-fit: contain; }
.brand-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.brand-actions :deep(.el-button) { margin-left: 0; }
.file-input { display: none; }
.brand-hint { margin-bottom: 0; }
.brand-error { color: var(--el-color-danger); }
.brand-status { color: var(--text-primary); }
</style>
