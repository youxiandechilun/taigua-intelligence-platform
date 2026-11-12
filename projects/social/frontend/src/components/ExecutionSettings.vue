<template>
  <!-- 任务中心只展示任务；插件下载、设备和执行方式说明仅在系统设置展示。 -->
  <section class="execution-card" data-tour="execution-overview" :aria-label="tasksOnly ? '任务列表' : '员工插件下载'" :aria-busy="loading">
    <!-- 按要求删除设置页的执行方式标题与说明，保留必要的下载和在线状态。 -->
    <div class="execution-heading" :class="{ 'download-toolbar': !tasksOnly }">
      <h3 v-if="tasksOnly">任务列表</h3>
      <el-button size="small" :loading="loading" @click="refresh">刷新状态</el-button>
    </div>
    <template v-if="state">
      <div v-if="!tasksOnly" class="device-line" data-tour="executor-device" role="status">
        <span class="status-dot" :class="{ online: state.device?.online }" />
        <strong>{{ state.device?.online ? '员工电脑在线' : state.device ? '员工电脑离线' : '尚未安装执行插件' }}</strong>
        <span v-if="state.device">{{ state.device.name }} · {{ state.device.platform }}</span>
        <span v-if="state.device?.last_seen">最后连接：{{ date(state.device.last_seen) }}</span>
      </div>
      <div v-if="!tasksOnly" class="download-row" data-tour="executor-download">
        <el-button v-for="system in systems" :key="system.id" :loading="downloading === system.id"
          :disabled="!state.packages.includes(system.id) || !!downloading" @click="download(system.id)">
          下载 {{ system.name }} 插件
        </el-button>
        <el-button v-if="state.device" text type="danger" :disabled="saving" @click="replaceDevice">更换执行设备</el-button>
        <!-- 下载和队列查看相邻，员工可以直接核对是否已就绪。 -->
        <router-link to="/task-center">查看任务中心</router-link>
      </div>
      <div v-if="!tasksOnly" class="package-status-list" aria-label="插件验收状态">
        <span v-for="system in systems" :key="`${system.id}-status`" class="package-status">
          {{ system.name }}：{{ state.package_status?.[system.id]?.native_install_verified ? '已验收' : '待真机验收' }}
        </span>
      </div>
      <p v-if="!tasksOnly" class="note">解压后双击「泰卦插件」，看到「已连接，可以使用」即可。</p>
      <div v-if="state.jobs.length" class="jobs-wrap" data-tour="execution-jobs">
        <el-table :data="tasksOnly ? state.jobs : state.jobs.slice(0, 10)" size="small" max-height="440">
          <el-table-column label="任务" min-width="160"><template #default="{ row }">{{ row.title || kind(row.path) }}<small v-if="row.account_name"> · {{ row.account_name }}</small></template></el-table-column>
          <el-table-column label="执行位置" min-width="120"><template #default="{ row }">{{ row.target === 'server' ? '服务器定时' : '员工电脑' }}</template></el-table-column>
          <el-table-column label="状态" min-width="190"><template #default="{ row }"><span :class="{ 'error-text': ['failed','review','missed'].includes(row.state) }">{{ label(row) }}</span></template></el-table-column>
          <el-table-column label="计划时间" min-width="175"><template #default="{ row }">{{ row.due_at ? date(row.due_at) : '立即 / 排队执行' }}</template></el-table-column>
          <el-table-column label="说明" min-width="230"><template #default="{ row }">{{ row.message || '任务结果会自动回传' }}</template></el-table-column>
          <el-table-column label="操作" width="100"><template #default="{ row }"><el-button v-if="!terminal.includes(row.state)" text type="danger" @click="cancel(row.id)">取消</el-button><el-button v-if="row.state === 'review'" text type="primary" @click="openResolution(row)">核对结果</el-button></template></el-table-column>
        </el-table>
      </div>
      <el-empty v-else-if="tasksOnly" description="暂无任务" :image-size="80" />
      <p v-else class="note">尚无混合执行任务。原来的发布记录继续保留在发布历史中。</p>
    </template>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <el-dialog v-model="resolutionVisible" title="登记平台核对结果" width="480px">
      <el-form label-position="top">
        <el-form-item label="已确认成功的发布数量"><el-input-number v-model="resolvedCount" :min="0" :precision="0" /></el-form-item>
        <el-form-item label="平台回执或作品链接"><el-input v-model="resolutionReceipt" type="textarea" :rows="3" maxlength="1000" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="resolutionVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="resolveResult">保存核对结果</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup>
// 设置页与任务中心共用一份状态组件，离开页面即停止轮询。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { teamIdentity, teamRequest } from '@/utils/teamSession'

// 复用持久队列与取消逻辑，不把插件设置混入任务中心。
defineProps({ tasksOnly: { type: Boolean, default: false } })
const state = ref(null), loading = ref(false), saving = ref(false), downloading = ref(''), error = ref('')
const terminal = ['success', 'failed', 'review', 'cancelled', 'missed']
const resolutionVisible = ref(false), resolutionJob = ref(''), resolvedCount = ref(0), resolutionReceipt = ref('')
const systems = [{ id: 'windows-x64', name: 'Windows' }, { id: 'macos-x64', name: 'Mac Intel' }, { id: 'macos-arm64', name: 'Mac Apple 芯片' }]
const date = value => new Date(value * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
// 素材删除也沿用员工队列，列表明确显示操作类型。
const kind = path => path === '/login' ? '平台登录' : path.includes('materials/batch-delete') ? '素材删除' : path.includes('hybrid/run') || path.includes('postVideo') ? '视频发布' : path.includes('image-publish') ? '图集发布' : path.includes('article-publish') ? '文章发布' : '平台操作'
function label(job) {
  const names = { queued: state.value?.device?.online ? '本机排队中' : '等待员工电脑上线', preparing: '等待本机准备定时素材 / 授权', preparing_run: '正在准备服务器定时任务', ready: '已就绪，等待服务器到点执行', running: '执行中', success: '平台操作完成', failed: '失败', review: '结果待核对，未自动重发', cancelled: '已取消', missed: '已错过，请重新安排' }
  return names[job.state] || job.state
}
let timer = null, disposed = false
async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    const execution = await teamRequest('execution')
    if (!disposed) { state.value = execution; error.value = '' }
  } catch (err) { if (!disposed) error.value = err.message }
  finally { loading.value = false }
}
async function download(platform) {
  downloading.value = platform; error.value = ''
  try {
    const identity = teamIdentity.value
    const response = await fetch('/api/team/execution/download', { method: 'POST', credentials: 'same-origin', headers: {
      'Content-Type': 'application/json', 'X-CSRF-Token': identity.csrf, 'X-Workspace-ID': identity.workspace.id,
    }, body: JSON.stringify({ platform }) })
    if (!response.ok) throw new Error((await response.json()).msg || '下载失败')
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url; link.download = `泰卦执行插件-${platform}.zip`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    // 下载包只展示应用入口，员工无需进入内部运行目录。
    ElMessage.success('解压后双击「泰卦插件」，启动窗口会显示连接状态')
  } catch (err) { error.value = err.message }
  finally { downloading.value = '' }
}
async function replaceDevice() {
  try {
    await ElMessageBox.confirm('更换后原设备停止领取任务，未确认的执行结果会保留为待核对。新设备需按平台要求重新登录。', '更换执行设备', { type: 'warning' })
    saving.value = true
    await teamRequest('execution/revoke', { method: 'POST' }); await refresh()
  } catch (err) { if (err?.message) error.value = err.message }
  finally { saving.value = false }
}
async function cancel(id) {
  try { await teamRequest(`execution/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); await refresh() }
  catch (err) { error.value = err.message }
}
function openResolution(job) {
  resolutionJob.value = job.id
  resolvedCount.value = 0
  resolutionReceipt.value = ''
  resolutionVisible.value = true
}
async function resolveResult() {
  if (resolutionReceipt.value.trim().length < 2) return ElMessage.warning('请填写核对结果')
  saving.value = true
  try {
    await teamRequest(`execution/jobs/${encodeURIComponent(resolutionJob.value)}/resolve`, { method: 'POST', body: JSON.stringify({
      success_count: resolvedCount.value, receipt: resolutionReceipt.value.trim(),
    }) })
    resolutionVisible.value = false
    await refresh()
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}
onMounted(() => { refresh(); timer = window.setInterval(() => { if (!document.hidden) refresh() }, 5000) })
onBeforeUnmount(() => { disposed = true; window.clearInterval(timer) })
</script>

<style scoped>
/* 沿用电销系统的主题变量，不引入另一套配色。 */
.execution-card { padding: 24px; margin-bottom: 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-elevated); }
.execution-heading, .device-line, .download-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.execution-heading { justify-content: space-between; }
.package-status-list { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 10px; color: var(--text-secondary); font-size: 12px; }
.package-status { white-space: nowrap; }
.execution-heading.download-toolbar { justify-content: flex-end; }
h3 { margin: 0; font-size: 16px; color: var(--text-primary); }
p { color: var(--text-secondary); font-size: 13px; line-height: 1.8; }
.device-line { margin: 18px 0; font-size: 13px; color: var(--text-secondary); }
strong { color: var(--text-primary); font-weight: 500; }
.status-dot { width: 8px; height: 8px; background: var(--text-secondary); border-radius: 50%; }
.status-dot.online { background: var(--el-color-success); }
.note { font-size: 12px; }
.jobs-wrap { margin-top: 20px; }
.error-text { color: var(--el-color-danger); }
@media(max-width:600px) { .execution-card { padding: 16px; } }
</style>
