<template>
  <div class="overseas-two-column" data-tour="overseas-inbox">
    <section class="overseas-card" aria-labelledby="inbox-create-title">
      <div class="overseas-panel-head">
        <div>
          <h2 id="inbox-create-title" class="overseas-panel-title">互动中心</h2>
          <p class="overseas-panel-subtitle">把评论和私信先归档、判断意向，再生成回复草稿。</p>
        </div>
        <el-tag type="info" effect="plain">评论 / 私信</el-tag>
      </div>
      <el-form label-position="top" @submit.prevent="saveConversation">
        <div class="overseas-form-grid">
          <el-form-item label="平台">
            <el-select v-model="form.platform_key" style="width: 100%">
              <el-option v-for="platform in platforms" :key="platform.key" :label="platform.name" :value="platform.key" />
            </el-select>
          </el-form-item>
          <el-form-item label="渠道类型">
            <el-select v-model="form.channel_type" style="width: 100%">
              <el-option label="评论" value="comment" />
              <el-option label="私信" value="direct_message" />
            </el-select>
          </el-form-item>
          <el-form-item label="我方账号">
            <el-input v-model="form.account_name" placeholder="例如：Taigua Global" maxlength="80" />
          </el-form-item>
          <el-form-item label="对方名称 / 账号">
            <el-input v-model="form.external_name" placeholder="例如：Alex / @alex" maxlength="120" />
          </el-form-item>
          <el-form-item label="平台账号标识">
            <el-input v-model="form.external_handle" placeholder="可填公开主页或用户名" maxlength="160" />
          </el-form-item>
          <el-form-item label="初步意向">
            <el-select v-model="form.intent_level" style="width: 100%">
              <el-option label="待判断" value="待判断" />
              <el-option label="高意向" value="高意向" />
              <el-option label="中意向" value="中意向" />
              <el-option label="低意向" value="低意向" />
            </el-select>
          </el-form-item>
          <el-form-item label="原始评论 / 私信" class="span-2" required>
            <el-input v-model="form.last_message" type="textarea" :rows="5" placeholder="粘贴原始内容，系统只保存到当前员工工作区。" maxlength="2000" show-word-limit />
          </el-form-item>
        </div>
        <div class="overseas-form-actions">
          <el-button native-type="submit" type="primary" :loading="saving">保存互动</el-button>
        </div>
      </el-form>
      <p class="overseas-muted">生成草稿后审核，复制到对应平台联系客户，并登记实际联系结果。</p>
    </section>

    <section class="overseas-card" aria-labelledby="inbox-list-title">
      <div class="overseas-panel-head">
        <div>
          <h2 id="inbox-list-title" class="overseas-panel-title">待处理互动</h2>
          <p class="overseas-panel-subtitle">先判断意向，再转成线索；状态更新会写入当前员工工作区。</p>
        </div>
        <el-button size="small" @click="$emit('refresh')">刷新</el-button>
      </div>
      <div v-if="conversations.length" class="overseas-table-wrap">
        <el-table :data="conversations" size="small" stripe>
          <el-table-column label="来源" width="120">
            <template #default="scope">
              <div>{{ platformName(scope.row.platform_key) }}</div>
              <span class="overseas-muted">{{ scope.row.channel_type === 'direct_message' ? '私信' : '评论' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="联系人" min-width="150">
            <template #default="scope">
              <div>{{ scope.row.external_name || '未命名联系人' }}</div>
              <span class="overseas-muted">{{ scope.row.external_handle || '未填写账号' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="last_message" label="内容" min-width="220" show-overflow-tooltip />
          <el-table-column label="意向" width="115">
            <template #default="scope">
              <el-select :model-value="scope.row.intent_level" size="small" @change="updateConversation(scope.row, { intent_level: $event })">
                <el-option v-for="item in intentOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="审核状态" width="110">
            <template #default="scope">
              <el-tag size="small" :type="reviewTagType(scope.row.reply_review_status)">
                {{ reviewStatus(scope.row.reply_review_status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="发送状态" width="120">
            <template #default="scope">
              <el-tag size="small" :type="deliveryTagType(scope.row.reply_delivery_status)">
                {{ deliveryStatus(scope.row.reply_delivery_status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openReply(scope.row)">回复草稿</el-button>
              <el-button link type="success" @click="updateConversation(scope.row, { status: '已处理' })">已处理</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-else class="overseas-empty">还没有评论或私信记录。</div>
    </section>
  </div>

  <el-dialog v-model="replyVisible" title="回复草稿" width="520px">
    <p class="overseas-dialog-context">{{ replyContext }}</p>
    <el-input v-model="replyText" type="textarea" :rows="7" maxlength="1000" show-word-limit />
    <template #footer>
      <el-button @click="replyVisible = false">关闭</el-button>
      <el-button :loading="generating" @click="generateReply">生成草稿</el-button>
      <el-button @click="saveReplyDraft">保存草稿</el-button>
      <el-button type="success" @click="approveReply">审核通过</el-button>
      <el-button type="primary" @click="copyReply">复制草稿</el-button>
      <el-button v-if="replyRow?.reply_review_status === 'approved'" @click="confirmContact">登记联系结果</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { overseasApi } from '@/api/overseas'

const props = defineProps({
  platforms: { type: Array, default: () => [] },
  conversations: { type: Array, default: () => [] },
})
const emit = defineEmits(['refresh'])

const intentOptions = ['待判断', '高意向', '中意向', '低意向']
const form = reactive({
  platform_key: 'tiktok',
  account_name: '',
  external_name: '',
  external_handle: '',
  channel_type: 'comment',
  last_message: '',
  intent_level: '待判断',
})
const saving = ref(false)
const replyVisible = ref(false)
const replyText = ref('')
const replyContext = ref('')
const replyRow = ref(null)
const generating = ref(false)

function resetForm() {
  form.account_name = ''
  form.external_name = ''
  form.external_handle = ''
  form.last_message = ''
  form.intent_level = '待判断'
}

async function saveConversation() {
  if (!form.last_message.trim()) return ElMessage.warning('请先填写原始评论或私信内容')
  saving.value = true
  try {
    await overseasApi.createConversation({ ...form })
    ElMessage.success('互动记录已保存')
    resetForm()
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function updateConversation(row, payload) {
  await overseasApi.updateConversation(row.id, payload)
  Object.assign(row, payload)
  ElMessage.success('互动状态已更新')
  emit('refresh')
}

function platformName(key) {
  return props.platforms.find((item) => item.key === key)?.name || key
}

function openReply(row) {
  replyRow.value = row
  replyContext.value = `${row.external_name || row.external_handle || '联系人'}：${row.last_message}`
  replyText.value = row.reply_draft || (row.intent_level === '高意向'
    ? '你好，感谢你的留言。我们可以根据你的团队规模和目标市场，先帮你梳理一版适合的方案。方便留下 WhatsApp 或邮箱吗？'
    : '你好，感谢你的留言。想先了解一下你目前主要运营哪些平台，以及希望解决哪一类问题？')
  replyVisible.value = true
}

async function generateReply() {
  if (!replyRow.value) return
  generating.value = true
  try {
    const result = await overseasApi.generateReply(replyRow.value.id)
    replyText.value = result.data.reply_draft
    emit('refresh')
    ElMessage.success('回复草稿已生成')
  } finally {
    generating.value = false
  }
}

async function confirmContact() {
  if (!replyRow.value) return
  try {
    const { value } = await ElMessageBox.prompt('填写实际联系结果或消息回执', '登记联系结果', {
      inputPlaceholder: '例如已在平台回复，并记录对方需求',
      inputValidator: (value) => value?.trim().length >= 2 || '请填写联系结果',
      confirmButtonText: '保存', cancelButtonText: '取消',
    })
    await overseasApi.confirmManualReply(replyRow.value.id, value.trim())
    replyVisible.value = false
    emit('refresh')
    ElMessage.success('联系结果已登记')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('联系结果保存失败，请重试')
  }
}

async function saveReplyDraft() {
  if (!replyRow.value || !replyText.value.trim()) return ElMessage.warning('请先填写回复内容')
  await updateConversation(replyRow.value, { reply_draft: replyText.value, reply_review_status: 'draft' })
  ElMessage.success('回复草稿已保存到当前员工工作区')
}

async function approveReply() {
  if (!replyRow.value || !replyText.value.trim()) return ElMessage.warning('请先填写回复内容')
  await updateConversation(replyRow.value, { reply_draft: replyText.value, reply_review_status: 'approved' })
  ElMessage.success('已审核通过，可复制联系并登记结果')
}

async function copyReply() {
  try {
    await navigator.clipboard.writeText(replyText.value)
    ElMessage.success('回复草稿已复制')
  } catch {
    ElMessage.warning('浏览器未授权剪贴板，请手动复制')
  }
}

function reviewStatus(value) {
  return { none: '未生成', draft: '草稿', pending_review: '待审核', approved: '已通过', rejected: '已退回' }[value] || '未生成'
}

function reviewTagType(value) {
  return { approved: 'success', draft: 'warning', pending_review: 'warning', rejected: 'danger' }[value] || 'info'
}

function deliveryStatus(value) {
  return {
    not_started: '未准备',
    prepared: '准备发送',
    channel_unconfigured: '通道未配置',
    sent: '已发送',
    manual_sent: '人工已联系',
    failed: '发送失败',
  }[value] || '未准备'
}

function deliveryTagType(value) {
  return { prepared: 'success', channel_unconfigured: 'warning', sent: 'success', manual_sent: 'success', failed: 'danger' }[value] || 'info'
}
</script>

<style scoped>
.overseas-dialog-context { margin: 0 0 12px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.overseas-muted { display: block; margin-top: 3px; }
</style>
