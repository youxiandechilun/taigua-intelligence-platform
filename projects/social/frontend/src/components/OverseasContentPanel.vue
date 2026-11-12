<template>
  <div class="overseas-two-column">
    <section class="overseas-card" data-tour="overseas-content" aria-labelledby="content-create-title">
      <div class="overseas-panel-head">
        <div>
          <h2 id="content-create-title" class="overseas-panel-title">内容工厂</h2>
          <p class="overseas-panel-subtitle">填写主题和资料，生成可审核的标题、正文和标签。</p>
        </div>
      </div>
      <el-form label-position="top" @submit.prevent="saveJob">
        <div class="overseas-form-grid">
          <el-form-item label="内容主题" class="span-2" required>
            <el-input v-model="form.topic" placeholder="例如：海外客户如何判断电销系统是否适合团队" maxlength="120" show-word-limit />
          </el-form-item>
          <el-form-item label="任务名称">
            <el-input v-model="form.title" placeholder="不填则使用主题" maxlength="80" />
          </el-form-item>
          <el-form-item label="语言">
            <el-select v-model="form.language" style="width: 100%">
              <el-option label="中文（简体）" value="zh-CN" />
              <el-option label="English" value="en-US" />
              <el-option label="中英双语" value="zh-CN/en-US" />
            </el-select>
          </el-form-item>
          <el-form-item label="脚本/口播文案" class="span-2">
            <el-input v-model="form.script" type="textarea" :rows="5" placeholder="填写已确认的产品事实、案例和内容要求。" maxlength="2000" show-word-limit />
          </el-form-item>
          <el-form-item label="内容风格">
            <el-select v-model="form.style" style="width: 100%">
              <el-option label="电销口播" value="电销口播" />
              <el-option label="案例拆解" value="案例拆解" />
              <el-option label="产品演示" value="产品演示" />
              <el-option label="客户问答" value="客户问答" />
            </el-select>
          </el-form-item>
          <el-form-item label="投放平台" required>
            <el-checkbox-group v-model="form.target_platforms" class="overseas-checks">
              <el-checkbox v-for="platform in readyPlatforms" :key="platform.key" :value="platform.key">
                {{ platform.name }}
                <el-tag size="small" type="warning" effect="plain">待真实账号验收</el-tag>
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </div>
        <div class="overseas-form-actions">
          <el-button native-type="submit" type="primary" :loading="saving">保存草稿</el-button>
        </div>
      </el-form>
      <p class="overseas-muted">模型和密钥由主页后台统一配置。生成后审核草稿，再进入发布中心选择素材发布。</p>
    </section>

    <section class="overseas-card" aria-labelledby="content-job-title">
      <div class="overseas-panel-head">
        <div>
          <h2 id="content-job-title" class="overseas-panel-title">内容任务</h2>
          <p class="overseas-panel-subtitle">当前员工工作区的数据，其他员工不可见。</p>
        </div>
        <el-button size="small" @click="$emit('refresh')">刷新</el-button>
      </div>
      <div v-if="jobs.length" class="overseas-table-wrap">
        <el-table :data="jobs" size="small" stripe>
          <el-table-column prop="title" label="任务" min-width="190" show-overflow-tooltip />
          <el-table-column label="平台" min-width="130">
            <template #default="scope">
              <span>{{ platformNames(scope.row.target_platforms) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="115">
            <template #default="scope">
              <el-tag :type="jobTagType(scope.row.status)" size="small">{{ jobStatus(scope.row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="scope">
              <el-button v-if="['draft', 'failed'].includes(scope.row.status)" link type="primary" :loading="queueing === scope.row.id" @click="queueJob(scope.row)">生成草稿</el-button>
              <el-button v-else-if="scope.row.status === 'success'" link type="primary" @click="previewText = scope.row.script; previewVisible = true">查看草稿</el-button>
              <span v-else class="overseas-muted">生成中</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-else class="overseas-empty">还没有内容任务，先在左侧保存一条脚本。</div>
    </section>
  </div>
  <el-dialog v-model="previewVisible" title="内容草稿" width="640px">
    <el-input v-model="previewText" type="textarea" :rows="16" readonly />
    <template #footer><el-button @click="previewVisible = false">关闭</el-button></template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { overseasApi } from '@/api/overseas'

const props = defineProps({
  platforms: { type: Array, default: () => [] },
  jobs: { type: Array, default: () => [] },
})
const emit = defineEmits(['refresh'])

const form = reactive({
  title: '',
  topic: '',
  script: '',
  language: 'zh-CN',
  style: '电销口播',
  target_platforms: [],
})
const saving = ref(false)
const queueing = ref('')
const previewVisible = ref(false)
const previewText = ref('')
// 只显示明确声明支持视频的平台；code_ready_unverified 代表代码已接入，
// 并不代表真实账号已经验收通过。
const readyPlatforms = computed(() => props.platforms.filter((platform) => {
  const video = platform.capabilities?.video
  return video?.supported === true && ['ready', 'code_ready_unverified'].includes(video.status)
}))
watch(readyPlatforms, (platforms) => {
  if (!form.target_platforms.length && platforms.length) form.target_platforms = [platforms[0].key]
}, { immediate: true })

function resetForm() {
  form.title = ''
  form.topic = ''
  form.script = ''
  form.language = 'zh-CN'
  form.style = '电销口播'
  form.target_platforms = readyPlatforms.value[0] ? [readyPlatforms.value[0].key] : []
}

async function saveJob() {
  if (!form.topic.trim()) return ElMessage.warning('请先填写内容主题')
  if (!form.target_platforms.length) return ElMessage.warning('至少选择一个投放平台')
  saving.value = true
  try {
    await overseasApi.createContentJob({ ...form })
    ElMessage.success('内容草稿已保存')
    resetForm()
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function queueJob(job) {
  queueing.value = job.id
  try {
    const result = await overseasApi.queueContentJob(job.id)
    previewText.value = result.data?.script || ''
    previewVisible.value = true
    ElMessage.success(result.msg || '内容草稿已生成')
    emit('refresh')
  } finally {
    queueing.value = ''
  }
}

function platformNames(keys) {
  const names = (keys || []).map((key) => props.platforms.find((item) => item.key === key)?.name || key)
  return names.join('、') || '未选择'
}

function jobStatus(status) {
  return { draft: '草稿', queued: '待生成', running: '生成中', success: '草稿已生成', failed: '失败' }[status] || status
}

function jobTagType(status) {
  return { draft: 'info', queued: 'warning', running: '', success: 'success', failed: 'danger' }[status] || 'info'
}
</script>

<style scoped>
.overseas-checks { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.overseas-checks :deep(.el-checkbox) { margin-right: 0; }
.overseas-muted { margin-top: 12px; }
</style>
