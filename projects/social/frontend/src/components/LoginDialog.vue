<template>
  <el-dialog
    :model-value="modelValue"
    :width="activeFrame ? 'min(1120px, 96vw)' : (mode === 'relogin' ? 'min(420px, 96vw)' : 'min(680px, 96vw)')"
    :top="activeFrame ? '4vh' : '15vh'"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @open="onDialogOpen"
    @opened="onOpened"
    @close="handleClose"
  >
    <template #header>
      <div class="login-dialog-header">
        <span class="login-dialog-title">{{ dialogTitle }}</span>
        <button
          v-if="mode === 'add'"
          class="login-guide-btn"
          type="button"
          @click="startGuide"
        >
          <el-icon><Guide /></el-icon>
          新手引导
        </button>
      </div>
    </template>
    <!-- 普通授权留在本机；服务器定时授权由员工明确选择，保留真实页面扫码桥接。 -->
    <el-radio-group v-model="executionLocation" data-tour="login-execution" size="small" :disabled="eventSources.size > 0">
      <el-radio-button value="local">员工电脑登录</el-radio-button>
      <el-radio-button value="server">服务器定时授权</el-radio-button>
    </el-radio-group>
    <!-- add 模式: 平台卡片网格(扁平横向) -->
    <div v-if="mode === 'add'" class="login-dialog-body">
      <p class="dialog-hint">{{ executionLocation === 'local' ? '选择平台后，在员工电脑弹出的独立浏览器中完成登录。请先下载并打开执行插件。' : '用于服务器定时发布，请在下方显示的真实平台页面中完成授权。' }}</p>
      <div v-if="cardList.length === 0" class="empty-state">
        所有渠道都已加入黑名单,请先在系统设置中移除后再来登录
      </div>
      <div v-else class="platform-grid" :class="{ 'has-login-page': activeFrame }" data-tour="ld-grid">
        <div
          v-for="p in visibleCards"
          :key="p.key"
          :class="[
            'platform-card',
            `platform-${p.cssClass}`,
            `is-${p.status}`
          ]"
          @click="onCardClick(p)"
          role="button" tabindex="0" :aria-label="`登录${p.name}`" @keydown.enter="onCardClick(p)" @keydown.space.prevent="onCardClick(p)"
        >
          <!-- logo/letter -->
          <div class="platform-logo-wrap" :style="{ background: p.bgColor }">
            <img v-if="p.logo" :src="p.logo" :alt="p.name" class="platform-logo" />
            <span v-else class="platform-letter" :style="{ color: p.color }">{{ p.letter }}</span>
          </div>

          <!-- 名称 + 状态 -->
          <div class="platform-text">
            <div class="platform-name">{{ p.name }}</div>
            <div v-if="p.status !== 'idle'" class="platform-status" :class="`is-${p.status}`">
              <template v-if="p.status === 'logging'">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>登录中...</span>
              </template>
              <template v-else-if="p.status === 'success'">
                <el-icon><Select /></el-icon>
                <span>登录成功</span>
              </template>
              <template v-else-if="p.status === 'fail'">
                <el-icon><CloseBold /></el-icon>
                <span>登录失败</span>
              </template>
            </div>
            <div v-if="p.errMsg" class="platform-error" role="alert">{{ p.errMsg }}</div>
          </div>

          <!-- 右侧操作 -->
          <div class="platform-action">
            <button v-if="p.status === 'logging'" class="mini-btn" type="button" @click.stop="cancelLogin(p.key)">取消</button>
            <button v-else-if="p.status === 'fail'" class="mini-btn mini-btn-retry" type="button" @click.stop="retryLogin(p.key)">重试</button>
            <el-icon v-else-if="p.status === 'success'" class="success-mark"><Select /></el-icon>
          </div>
        </div>
      </div>
    </div>

    <!-- relogin 模式: 单卡片 -->
    <div v-else class="login-dialog-body relogin-body">
      <div v-if="reloginPlatform" class="relogin-card" :class="`platform-${reloginPlatform.cssClass}`">
        <div class="platform-logo-wrap">
          <img v-if="reloginPlatform.logo" :src="reloginPlatform.logo" :alt="reloginPlatform.name" class="platform-logo" />
          <span v-else class="platform-letter">{{ reloginPlatform.letter }}</span>
        </div>
        <div class="platform-name">{{ reloginPlatform.name }}</div>
        <template v-if="reloginStatus === 'logging'">
          <el-icon class="loading-icon is-loading"><Loading /></el-icon>
          <div class="status-text">登录中...</div>
        </template>
        <template v-else-if="reloginStatus === 'success'">
          <el-icon class="success-icon"><Select /></el-icon>
          <div class="status-text">登录成功</div>
        </template>
        <template v-else-if="reloginStatus === 'fail'">
          <el-icon class="fail-icon"><CloseBold /></el-icon>
          <div class="status-text fail-text">{{ reloginErrMsg || '登录失败' }}</div>
          <button class="retry-btn" type="button" @click="startRelogin">重试</button>
        </template>
        <p class="relogin-hint">{{ executionLocation === 'local' ? '请在员工电脑弹出的浏览器中完成验证' : '请在下方登录页面中完成服务器授权' }}</p>
      </div>
      <div v-else class="empty-state">账号信息异常</div>
    </div>

    <p v-if="loginMessage" class="dialog-hint" role="status">{{ loginMessage }}</p>
    <PlatformLoginView v-if="activeFrame" :frame="activeFrame" :platform="activePlatformName" />

    <template #footer>
      <el-button v-if="mode === 'relogin' && reloginStatus === 'logging'"
                 @click="cancelRelogin">取消登录</el-button>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>

  <!-- 弹窗新手引导（仅 add 模式自动播放，teleport 到 body） -->
  <GuideTour
    ref="loginTourRef"
    :steps="loginGuideSteps"
    @finish="onGuideDone"
    @skip="onGuideDone"
  />
</template>

<script setup>
// 泰卦部署改造：扫码与任务状态长连接绑定当前员工工作区。
import { createTeamEventSource } from '@/utils/teamSession'
// 泰卦部署改造：文件与实时状态使用当前域名，统一经过登录网关。
import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, Select, CloseBold, Guide } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import { domesticPlatformList, getPlatformByName, getPlatformByKey } from '@/config/platforms'
import GuideTour from '@/components/GuideTour.vue'
import { loginGuideSteps, GUIDE_KEYS, isGuideDone, markGuideDone } from '@/config/guides'
import { http } from '@/utils/request'
import PlatformLoginView from '@/components/PlatformLoginView.vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  mode: { type: String, default: 'add' },  // 'add' | 'relogin'
  account: { type: Object, default: null },
  // 国内和海外分别传入所属平台，重登仍按原平台编号找到同一实现。
  platforms: { type: Array, default: null },
})

const emit = defineEmits(['update:modelValue', 'success', 'fail'])

const appStore = useAppStore()

// add 模式: 多卡片状态
const cardStates = reactive({})  // key -> { status, errMsg }
const eventSources = new Map()   // key -> EventSource(非响应式)
const sessionIds = new Map()
const executionLocation = ref('local')
const activeFrame = ref(null), activePlatformName = ref(''), loginMessage = ref('')

// 统一登录弹窗的实际平台来源，保证国内和海外页面使用同一套交互。
const loginPlatformList = computed(() => props.platforms?.length ? props.platforms : domesticPlatformList)
const getLoginPlatform = (key) => loginPlatformList.value.find((item) => item.key === key) || getPlatformByKey(key)

// relogin 模式: 单卡片状态
const reloginStatus = ref('idle')
const reloginErrMsg = ref('')
const reloginPlatform = computed(() => {
  if (props.mode !== 'relogin' || !props.account) return null
  return loginPlatformList.value.find((item) => item.name === props.account.platform) || getPlatformByName(props.account.platform)
})
const reloginKey = computed(() => reloginPlatform.value?.key)

const dialogTitle = computed(() => {
  if (props.mode === 'relogin' && reloginPlatform.value) {
    return `重新登录:${reloginPlatform.value.name}`
  }
  return '添加账号'
})

// 卡片列表(响应式:平台状态变化时自动更新)
const cardList = computed(() =>
  loginPlatformList.value
    .filter(p => !appStore.isPlatformDisabled(p.key))
    .map(p => ({
      ...p,
      status: cardStates[p.key]?.status || 'idle',
      errMsg: cardStates[p.key]?.errMsg || ''
    }))
)
// 登录页展开后收起其他平台，保证二维码和操作区在同一个窗口内可见。
const visibleCards = computed(() => activeFrame.value ? cardList.value.filter(p => p.status === 'logging') : cardList.value)

function setCardStatus(key, status, errMsg = '') {
  cardStates[key] = { status, errMsg }
}

function onDialogOpen() {
  if (props.mode === 'add') {
    initCardStates()
  } else if (props.mode === 'relogin') {
    startRelogin()
  }
}

// ========== 弹窗新手引导（仅 add 模式） ==========
const loginTourRef = ref(null)

const startGuide = () => loginTourRef.value?.start()

const onGuideDone = () => markGuideDone(GUIDE_KEYS.login)

// @opened：动画结束后再启动，且仅 add 模式（relogin 是单卡片修复流程，不打扰）
function onOpened() {
  if (props.mode === 'add' && !isGuideDone(GUIDE_KEYS.login)) {
    setTimeout(() => loginTourRef.value?.start(), 150)
  }
}

function initCardStates() {
  // 清掉旧状态
  for (const k of Object.keys(cardStates)) delete cardStates[k]
}

function handleClose() {
  // 清理所有 SSE 连接(el-dialog 关闭时已经会通过 @update:model-value 通知父组件)
  for (const key of eventSources.keys()) closeSSE(key)
  // 保险：弹窗关闭时结束可能还开着的引导
  loginTourRef.value?.stop()
  activeFrame.value = null
  loginMessage.value = ''
}
onBeforeUnmount(handleClose)

// ===== SSE 逻辑 =====
function startLogin(platformKey, accountId = null) {
  const platform = getLoginPlatform(platformKey)
  if (!platform) return
  // 同一员工的浏览器任务串行；切换平台先结束旧登录，避免隐藏任务继续排队。
  for (const key of eventSources.keys()) { closeSSE(key); setCardStatus(key, 'idle') }
  activeFrame.value = null
  activePlatformName.value = platform.name
  loginMessage.value = '正在打开平台登录页，请稍候'

  // 尚未接入统一浏览器执行器的平台仍使用同一套账号弹窗，但登录动作在官方页完成。
  // 这里不把打开网页误记为“登录成功”，避免本地预览产生虚假账号状态。
  if (!platform.loginType && platform.creatorUrl) {
    setCardStatus(platformKey, 'logging')
    window.open(platform.creatorUrl, '_blank', 'noopener,noreferrer')
    setCardStatus(platformKey, 'idle')
    loginMessage.value = `${platform.name} 登录页已打开，请在新标签页完成登录；当前本地版暂不保存该平台授权`
    ElMessage.info(`${platform.name} 已打开官方登录页`)
    return
  }

  const type = platform.loginType ?? platform.id
  const tempId = crypto.randomUUID()
  const baseUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin
  let url = `${baseUrl}/login?type=${type}&id=${encodeURIComponent(tempId)}`
  // 下载插件自动关联员工；此处只选择平台授权保存在本机还是定时服务器。
  url += `&execution=${executionLocation.value}`
  if (accountId) {
    url += `&account_id=${encodeURIComponent(accountId)}`
  }

  setCardStatus(platformKey, 'logging')
  // 若是 relogin 模式,由 startRelogin 单独处理 reloginStatus
  if (props.mode === 'relogin' && reloginKey.value === platformKey) {
    reloginStatus.value = 'logging'
  }

  const es = createTeamEventSource(url)
  eventSources.set(platformKey, es)
  sessionIds.set(platformKey, tempId)

  es.onmessage = (event) => {
    if (eventSources.get(platformKey) !== es) return
    let result
    try {
      result = JSON.parse(event.data)
    } catch (e) {
      return
    }
    if (!result || typeof result !== 'object') result = { status: String(result) }
    result.status = String(result.status)
    if (result.status === 'page') {
      activeFrame.value = result
      loginMessage.value = '登录页面已打开，请扫码或在下方页面操作'
      return
    }
    if (result.status === 'waiting') { loginMessage.value = result.msg; return }

    if (result.status === '200') {
      setCardStatus(platformKey, 'success')
      closeSSE(platformKey)
      if (props.mode === 'relogin' && reloginKey.value === platformKey) {
        reloginStatus.value = 'success'
      }
      emit('success', { platform: platformKey, accountId: accountId || undefined })
      ElMessage.success(`${platform.name} 登录成功`)
      // 国内、海外的添加和重新登录统一返回账号列表；只有后端确认保存成功才关闭。
      emit('update:modelValue', false)
      return
    }

    if (['500', '0', 'error', 'failed', 'timeout', 'cancelled'].includes(result.status)) {
      const errMsg = result.msg || result.message || result.error || '登录失败'
      setCardStatus(platformKey, 'fail', errMsg)
      closeSSE(platformKey)
      if (props.mode === 'relogin' && reloginKey.value === platformKey) {
        reloginStatus.value = 'fail'
        reloginErrMsg.value = errMsg
      }
      emit('fail', { platform: platformKey, errMsg })
      return
    }

    // status === '1' 或其他: 等待中,保持 logging
  }

  es.onerror = () => {
    if (eventSources.get(platformKey) !== es) return
    // 成功后 closeSSE 也会触发 onerror,需检查状态防误判
    if (cardStates[platformKey]?.status === 'success') return
    if (props.mode === 'relogin' && reloginStatus.value === 'success') return

    const errMsg = '连接断开,请检查后端服务'
    setCardStatus(platformKey, 'fail', errMsg)
    closeSSE(platformKey)
    if (props.mode === 'relogin' && reloginKey.value === platformKey) {
      reloginStatus.value = 'fail'
      reloginErrMsg.value = errMsg
    }
    emit('fail', { platform: platformKey, errMsg })
  }
}

function closeSSE(platformKey) {
  const sessionId = sessionIds.get(platformKey)
  if (sessionId) {
    sessionIds.delete(platformKey)
    http.post(`/api/platform-login/${encodeURIComponent(sessionId)}/cancel`).catch(() => {})
  }
  const es = eventSources.get(platformKey)
  if (es) {
    es.close()
    eventSources.delete(platformKey)
  }
  activeFrame.value = null
  loginMessage.value = ''
}

function onCardClick(p) {
  if (p.status === 'idle' || p.status === 'fail') {
    startLogin(p.key)
  }
}

function cancelLogin(platformKey) {
  closeSSE(platformKey)
  setCardStatus(platformKey, 'idle')
  ElMessage.info('已取消登录')
}

function retryLogin(platformKey) {
  closeSSE(platformKey)
  startLogin(platformKey)
}

function startRelogin() {
  if (!reloginKey.value || !props.account) return
  closeSSE(reloginKey.value)  // 清旧连接
  startLogin(reloginKey.value, props.account.id)
}

function cancelRelogin() {
  if (reloginKey.value) closeSSE(reloginKey.value)
  reloginStatus.value = 'idle'
  ElMessage.info('已取消登录')
}
</script>

<style lang="scss" scoped>
@use '@/styles/variables.scss' as *;
.platform-grid.has-login-page { grid-template-columns: 1fr; }

// 自定义 header（#header 插槽内容编译自本组件，scoped 顶层选择器直接命中）：
// 标题 + 新手引导入口，padding-right 给右上角关闭按钮留位
.login-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 32px;
}

.login-dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: $text-primary;
}

.login-guide-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px dashed rgba($overlay-rgb, 0.28);
  background: transparent;
  color: $text-muted;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    color: $brand-start;
    border-color: rgba($brand-start, 0.5);
    background: rgba($brand-start, 0.08);
  }
}

.login-dialog-body {
  padding: 0 4px;
}

.dialog-hint {
  color: $text-secondary;
  font-size: 13px;
  margin: 0 0 12px 0;
}

.platform-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

// ── 扁平横向卡片(参考 BatchTagDialog 账号卡风格) ──
.platform-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: $bg-surface;
  border: 1px solid $border;
  border-radius: $radius-sm;
  cursor: pointer;
  transition: all $transition-fast;
  position: relative;
  min-height: 52px;
}

.platform-card.is-idle:hover {
  background: rgba($brand-start, 0.06);
  border-color: $border-active;
}

.platform-card.is-logging {
  border-color: $brand-start;
  background: rgba($brand-start, 0.08);
  cursor: progress;
}

.platform-card.is-success {
  border-color: rgba($success-color, 0.4);
  background: rgba($success-color, 0.08);
  cursor: default;
}

.platform-card.is-fail {
  border-color: rgba($danger-color, 0.4);
  background: rgba($danger-color, 0.08);
}

.platform-logo-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.platform-logo {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: contain;
}

.platform-letter {
  font-size: 16px;
  font-weight: 700;
}

.platform-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.platform-error { font-size: 11px; color: var(--el-color-danger); line-height: 1.5; overflow-wrap: anywhere; }

.platform-name {
  font-size: 13px;
  font-weight: 500;
  color: $text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.platform-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: $text-muted;

  .el-icon { font-size: 11px; }

  &.is-logging { color: $brand-start; }
  &.is-success { color: $success-color; }
  &.is-fail { color: $danger-color; }
}

.platform-action {
  flex-shrink: 0;
  display: flex;
  align-items: center;

  .success-mark {
    color: $success-color;
    font-size: 18px;
  }
}

.mini-btn {
  padding: 3px 10px;
  border: 1px solid $border;
  background: transparent;
  border-radius: 4px;
  font-size: 11px;
  color: $text-secondary;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    background: rgba($overlay-rgb, 0.06);
    color: $text-primary;
  }

  &.mini-btn-retry {
    color: $danger-color;
    border-color: rgba($danger-color, 0.4);

    &:hover {
      background: rgba($danger-color, 0.12);
    }
  }
}

.empty-state {
  text-align: center;
  color: $text-secondary;
  font-size: 13px;
  padding: 40px 20px;
}

/* relogin 模式 */
.relogin-body {
  display: flex;
  justify-content: center;
}

.relogin-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px;
  border: 1px solid $border;
  border-radius: $radius-card;
  min-width: 280px;
}

.relogin-hint {
  margin-top: 16px;
  font-size: 12px;
  color: $text-secondary;
  text-align: center;
}

@media (max-width: 640px) {
  .platform-grid {
    grid-template-columns: 1fr;
  }
}
</style>
