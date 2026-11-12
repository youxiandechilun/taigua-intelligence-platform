<template>
  <el-dialog v-model="visible" title="修改登录密码" width="min(440px, 94vw)" :close-on-click-modal="false">
    <el-form label-position="top">
      <el-form-item label="原密码"><el-input v-model="oldPassword" type="password" show-password autocomplete="current-password" /></el-form-item>
      <el-form-item label="新密码"><el-input v-model="password" type="password" show-password autocomplete="new-password" placeholder="8–128 位" maxlength="128" /></el-form-item>
      <el-form-item label="确认新密码"><el-input v-model="confirmation" type="password" show-password autocomplete="new-password" maxlength="128" /></el-form-item>
      <p v-if="error" role="alert" class="password-error">{{ error }}</p>
    </el-form>
    <template #footer><el-button @click="visible = false" :disabled="busy">取消</el-button><el-button type="primary" @click="save" :loading="busy">保存并重新登录</el-button></template>
  </el-dialog>
</template>
<script setup>
// 泰卦部署改造：本人修改密码必须验证原密码，成功后撤销全部旧会话。
import { ref, watch } from 'vue'
import { clearWorkspaceCache, teamRequest } from '@/utils/teamSession'
const visible = defineModel({ type: Boolean })
const oldPassword = ref(''), password = ref(''), confirmation = ref(''), error = ref(''), busy = ref(false)
watch(visible, () => { oldPassword.value = ''; password.value = ''; confirmation.value = ''; error.value = '' })
async function save() {
  if (password.value !== confirmation.value) { error.value = '两次新密码不一致'; return }
  busy.value = true
  error.value = ''
  try {
    await teamRequest('password', { method: 'POST', body: JSON.stringify({ old_password: oldPassword.value, password: password.value }) })
    clearWorkspaceCache()
    window.location.replace('/#/login')
    window.location.reload()
  } catch (err) { error.value = err.message } finally { busy.value = false }
}
</script>
<style scoped>.password-error { color: var(--el-color-danger); }</style>
