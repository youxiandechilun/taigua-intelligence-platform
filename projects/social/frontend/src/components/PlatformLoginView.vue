<template>
  <section class="platform-login-view" :aria-label="`${platform}登录页面`">
    <div class="page-heading"><strong>{{ platform }} · 登录页面</strong><span>{{ frame.host }}</span></div>
    <p>使用对应平台 App 扫码。需要切换登录方式、刷新二维码或完成验证时，可直接点击或拖动页面。</p>
    <img ref="screen" class="login-screen" :style="{ '--screen-ratio': frame.width / frame.height }" :src="frame.image" :alt="`${platform}实时登录页面`" draggable="false"
         tabindex="0" @pointerdown.prevent="beginPointer" @pointerup.prevent="endPointer" @pointercancel="pointer = null"
         @keydown.tab.prevent="send({ kind: 'key', key: $event.shiftKey ? 'Shift+Tab' : 'Tab' })"
         @keydown.enter.prevent="send({ kind: 'key', key: 'Enter' })" />
    <div class="page-tools">
      <el-button size="small" :disabled="busy" @click="send({ kind: 'scroll', direction: 'up' })">向上滚动</el-button>
      <el-button size="small" :disabled="busy" @click="send({ kind: 'scroll', direction: 'down' })">向下滚动</el-button>
      <el-button size="small" :disabled="busy" @click="send({ kind: 'key', key: 'Tab' })">下一个输入框</el-button>
      <el-button size="small" :disabled="busy" @click="send({ kind: 'key', key: 'Control+A' })">全选框内内容</el-button>
      <el-button size="small" :disabled="busy" @click="send({ kind: 'key', key: 'Backspace' })">退格</el-button>
      <el-button size="small" :disabled="busy" @click="send({ kind: 'key', key: 'Enter' })">回车</el-button>
    </div>
    <form class="remote-input" @submit.prevent="typeText">
      <el-input v-model="text" type="password" show-password autocomplete="off" maxlength="512" aria-label="发送到平台登录输入框的内容" placeholder="先点击页面中的输入框，再在此输入手机号、验证码或密码" />
      <el-button :disabled="!text || busy" native-type="submit">输入到选中框</el-button>
    </form>
    <p class="input-hint">输入内容发送后即清空，不保存在浏览器中。画面会自动更新，请等待平台显示登录成功。</p>
    <p v-if="error" role="alert" class="page-error">{{ error }}</p>
  </section>
</template>
<script setup>
// 泰卦服务器登录：只发送用户在画面中的明确操作，页面输入不写入缓存或日志。
import { ref } from 'vue'
import { http } from '@/utils/request'
const props = defineProps({ frame: { type: Object, required: true }, platform: { type: String, default: '平台' } })
const screen = ref(null), text = ref(''), busy = ref(false), error = ref('')
let pointer = null
function position(event) {
  const bounds = screen.value.getBoundingClientRect()
  return { x: Math.max(0, Math.min(props.frame.width - 1, (event.clientX - bounds.left) * props.frame.width / bounds.width)),
    y: Math.max(0, Math.min(props.frame.height - 1, (event.clientY - bounds.top) * props.frame.height / bounds.height)) }
}
function beginPointer(event) {
  pointer = position(event)
  screen.value.setPointerCapture(event.pointerId)
}
function endPointer(event) {
  if (!pointer) return
  const end = position(event), start = pointer
  pointer = null
  send(Math.hypot(end.x - start.x, end.y - start.y) > 8 ? { kind: 'drag', ...start, end_x: end.x, end_y: end.y } : { kind: 'click', ...end })
}
async function send(action) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await http.post(`/api/platform-login/${encodeURIComponent(props.frame.session_id)}/input`, { ...action, frame_id: props.frame.frame_id }) }
  catch (err) { error.value = err.response?.data?.msg || '页面操作未完成，请等待新画面后重试' }
  finally { busy.value = false }
}
function typeText() {
  if (!text.value || busy.value) return
  const value = text.value
  text.value = ''
  send({ kind: 'text', text: value })
}
</script>
<style scoped>
.platform-login-view { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 10px; padding: 14px; margin: 16px 0; }
.page-heading { display: flex; justify-content: space-between; gap: 12px; color: var(--text-primary); font-size: 14px; }
.page-heading span, p { color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.login-screen { display: block; width: 100%; max-width: calc(55vh * var(--screen-ratio)); height: auto; margin: 0 auto; border: 1px solid var(--border); background: #fff; cursor: pointer; touch-action: none; }
.login-screen:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.page-tools { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.page-tools :deep(.el-button) { margin-left: 0; }
.remote-input { display: flex; gap: 8px; margin-top: 12px; }
.input-hint { margin-bottom: 0; }
.page-error { color: var(--el-color-danger); }
@media (max-width: 640px) { .remote-input { flex-wrap: wrap; } }
</style>
