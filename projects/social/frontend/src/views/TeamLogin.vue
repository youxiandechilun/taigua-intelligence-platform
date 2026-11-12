<template>
  <main class="team-login">
    <section class="login-card" aria-labelledby="login-title">
      <div class="login-mark"><el-icon :size="26"><Promotion /></el-icon></div>
      <h1 id="login-title">泰卦智能发布</h1>
      <p>登录你的工作账号</p>
      <form @submit.prevent="submit">
        <label for="team-username">账号</label>
        <el-input id="team-username" v-model="username" autocomplete="username" placeholder="请输入账号" maxlength="64" :disabled="busy" />
        <label for="team-password">密码</label>
        <el-input id="team-password" v-model="password" type="password" autocomplete="current-password" show-password placeholder="请输入密码" maxlength="128" :disabled="busy" />
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
        <el-button native-type="submit" type="primary" :loading="busy" class="login-submit">登录</el-button>
      </form>
      <small>员工账号请联系管理员开通</small>
    </section>
  </main>
</template>

<script setup>
// 泰卦部署改造：账号密码仅提交到本系统，成功后使用服务端会话访问工作区。
import { ref } from 'vue'
import { clearWorkspaceCache, teamRequest } from '@/utils/teamSession'

const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
async function submit() {
  if (!username.value.trim() || !password.value) {
    error.value = '请填写账号和密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await teamRequest('login', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) })
    password.value = ''
    clearWorkspaceCache()
    window.location.replace('/#/')
    window.location.reload()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped lang="scss">
/* 泰卦部署改造：登录页固定使用白底，避免继承黑色全局主题造成登录入口难以辨识。 */
.team-login { min-height: 100svh; display: grid; place-items: center; padding: 24px; background: #ffffff; color: #1f2937; }
.login-card { width: min(100%, 400px); padding: 32px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08); }
.login-mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 10px; color: white; background: var(--el-color-primary); margin-bottom: 24px; }
h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; color: #111827; }
p, small { color: #6b7280; }
form { margin-top: 28px; }
label { display: block; margin: 20px 0 8px; font-size: 14px; color: #374151; }
.login-submit { width: 100%; margin: 24px 0; min-height: 40px; }
.login-error { color: var(--el-color-danger); margin-top: 12px; font-size: 13px; }
small { font-size: 12px; }

/* 登录页输入框保持浅色，确保浏览器自动填充和深色主题不会覆盖可读性。 */
:deep(.el-input__wrapper) { background: #ffffff; box-shadow: 0 0 0 1px #d1d5db inset; }
:deep(.el-input__inner) { color: #111827; }
</style>
