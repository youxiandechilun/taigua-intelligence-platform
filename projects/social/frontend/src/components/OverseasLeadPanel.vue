<template>
  <div class="overseas-two-column" data-tour="overseas-leads">
    <section class="overseas-card" aria-labelledby="lead-create-title">
      <div class="overseas-panel-head">
        <div>
          <h2 id="lead-create-title" class="overseas-panel-title">线索中心</h2>
          <p class="overseas-panel-subtitle">记录自有账号、同行账号和客户账号中发现的意向联系人。</p>
        </div>
        <el-tag type="success" effect="plain">WhatsApp 留资</el-tag>
      </div>
      <el-form label-position="top" @submit.prevent="saveLead">
        <div class="overseas-form-grid">
          <el-form-item label="线索来源">
            <el-select v-model="form.source_type" style="width: 100%">
              <el-option label="自有账号" value="own_account" />
              <el-option label="同行账号" value="peer_account" />
              <el-option label="客户账号" value="customer_account" />
              <el-option label="手动录入" value="manual" />
            </el-select>
          </el-form-item>
          <el-form-item label="平台">
            <el-select v-model="form.platform_key" style="width: 100%">
              <el-option v-for="platform in platforms" :key="platform.key" :label="platform.name" :value="platform.key" />
            </el-select>
          </el-form-item>
          <el-form-item label="联系人姓名">
            <el-input v-model="form.contact_name" placeholder="联系人或负责人" maxlength="80" />
          </el-form-item>
          <el-form-item label="平台账号">
            <el-input v-model="form.external_handle" placeholder="@用户名或主页地址" maxlength="160" />
          </el-form-item>
          <el-form-item label="公司 / 店铺">
            <el-input v-model="form.company" placeholder="公司名称（可选）" maxlength="120" />
          </el-form-item>
          <el-form-item label="地区">
            <el-input v-model="form.region" placeholder="国家 / 城市" maxlength="80" />
          </el-form-item>
          <el-form-item label="邮箱 / 电话">
            <el-input v-model="form.contact_value" placeholder="用于后续联系" maxlength="160" />
          </el-form-item>
          <el-form-item label="WhatsApp">
            <el-input v-model="form.whatsapp" placeholder="国际区号 + 号码" maxlength="80" />
          </el-form-item>
          <el-form-item label="联系授权">
            <el-select v-model="form.consent_status" style="width: 100%">
              <el-option label="未确认" value="unknown" />
              <el-option label="已明确同意" value="consented" />
              <el-option label="拒绝联系" value="declined" />
            </el-select>
          </el-form-item>
          <el-form-item label="意向等级">
            <el-select v-model="form.intent_level" style="width: 100%">
              <el-option v-for="item in intentOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注" class="span-2">
            <el-input v-model="form.notes" type="textarea" :rows="3" placeholder="记录需求、预算、账号特征或下一步动作" maxlength="1000" show-word-limit />
          </el-form-item>
        </div>
        <div class="overseas-form-actions">
          <el-button native-type="submit" type="primary" :loading="saving">保存线索</el-button>
        </div>
      </el-form>
      <p class="overseas-muted">推送只记录请求和授权状态；未配置 CRM / WhatsApp 通道时不会向外部发送消息。</p>
    </section>

    <section class="overseas-card" aria-labelledby="lead-list-title">
      <div class="overseas-panel-head">
        <div>
          <h2 id="lead-list-title" class="overseas-panel-title">意向线索</h2>
          <p class="overseas-panel-subtitle">高意向线索可先推送到内部 CRM，再进入客户管理。</p>
        </div>
        <el-button size="small" @click="$emit('refresh')">刷新</el-button>
      </div>
      <div v-if="leads.length" class="overseas-table-wrap">
        <el-table :data="leads" size="small" stripe>
          <el-table-column label="联系人" min-width="160">
            <template #default="scope">
              <div>{{ scope.row.contact_name || scope.row.external_handle || '未命名联系人' }}</div>
              <span class="overseas-muted">{{ scope.row.company || scope.row.region || '未补充公司信息' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="120">
            <template #default="scope">{{ sourceName(scope.row.source_type) }}</template>
          </el-table-column>
          <el-table-column label="联系信息" min-width="150">
            <template #default="scope">
              <div>{{ scope.row.whatsapp || '未填 WhatsApp' }}</div>
              <span class="overseas-muted">{{ scope.row.contact_value || '未填邮箱 / 电话' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="意向" width="115">
            <template #default="scope">
              <el-select :model-value="scope.row.intent_level" size="small" @change="updateLead(scope.row, { intent_level: $event })">
                <el-option v-for="item in intentOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="阶段" width="115">
            <template #default="scope">
              <el-select :model-value="scope.row.stage || '新线索'" size="small" @change="updateLead(scope.row, { stage: $event })">
                <el-option v-for="item in stageOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="外发状态" width="125">
            <template #default="scope">
              <el-tag size="small" :type="outreachTagType(scope.row.outreach_status)">
                {{ outreachStatus(scope.row.outreach_status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="scope">
              <el-button link type="primary" :loading="pushing === scope.row.id" @click="pushLead(scope.row, 'crm')">
                {{ scope.row.outreach_status === 'prepared' ? '尝试推送' : '准备推送' }}
              </el-button>
              <el-button link type="success" @click="convertCustomer(scope.row)">转为客户</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-else class="overseas-empty">还没有线索，先从左侧录入一条意向联系人。</div>
    </section>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { overseasApi } from '@/api/overseas'

const props = defineProps({
  platforms: { type: Array, default: () => [] },
  leads: { type: Array, default: () => [] },
})
const emit = defineEmits(['refresh', 'customer-created'])

const intentOptions = ['待判断', '高意向', '中意向', '低意向']
const stageOptions = ['新线索', '已联系', '已加 WhatsApp', '已转客户', '暂不跟进']
const form = reactive({
  source_type: 'own_account',
  platform_key: 'tiktok',
  account_name: '',
  external_handle: '',
  contact_name: '',
  company: '',
  region: '',
  contact_value: '',
  whatsapp: '',
  consent_status: 'unknown',
  intent_level: '待判断',
  notes: '',
})
const saving = ref(false)
const pushing = ref('')

function resetForm() {
  form.account_name = ''
  form.external_handle = ''
  form.contact_name = ''
  form.company = ''
  form.region = ''
  form.contact_value = ''
  form.whatsapp = ''
  form.consent_status = 'unknown'
  form.intent_level = '待判断'
  form.notes = ''
}

async function saveLead() {
  if (!form.contact_name.trim() && !form.external_handle.trim()) return ElMessage.warning('请填写联系人姓名或平台账号')
  saving.value = true
  try {
    await overseasApi.createLead({ ...form })
    ElMessage.success('线索已保存')
    resetForm()
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function updateLead(row, payload) {
  await overseasApi.updateLead(row.id, payload)
  Object.assign(row, payload)
  ElMessage.success('线索已更新')
  emit('refresh')
}

async function pushLead(row, channel) {
  if (row.outreach_status === 'review') {
    try {
      await ElMessageBox.confirm('请核对接收通道中的实际记录，再登记是否收到。', '核对推送结果', {
        confirmButtonText: '确认已收到', cancelButtonText: '确认未收到', distinguishCancelAndClose: true,
      })
      await overseasApi.confirmPush(row.id, true, '操作员已核对接收端，确认收到')
      emit('refresh')
    } catch (action) {
      if (action === 'cancel') {
        await overseasApi.confirmPush(row.id, false, '操作员已核对接收端，确认未收到')
        emit('refresh')
      }
    }
    return
  }
  pushing.value = row.id
  const phase = row.outreach_status === 'prepared' ? 'send' : 'prepare'
  try {
    const result = await overseasApi.pushLead(row.id, channel, phase)
    row.outreach_status = result.data?.outreach_status || (phase === 'prepare' ? 'prepared' : row.outreach_status)
    ElMessage.success(phase === 'prepare' ? '已准备推送，等待外部通道审核' : '已提交推送请求')
  } catch (error) {
    // 当前外部通道未配置时，后端会返回 409；前端同步显示可追踪的阻断状态。
    if (phase === 'send') row.outreach_status = error.response?.data?.data?.outreach_status || row.outreach_status
    emit('refresh')
  } finally {
    pushing.value = ''
  }
}

async function convertCustomer(row) {
  await overseasApi.createCustomer({
    lead_id: row.id,
    name: row.contact_name || row.external_handle,
    company: row.company,
    email: row.contact_value?.includes('@') ? row.contact_value : '',
    phone: row.contact_value?.includes('@') ? '' : row.contact_value,
    whatsapp: row.whatsapp,
    stage: '待跟进',
    source_type: 'lead_conversion',
    notes: row.notes,
  })
  await overseasApi.updateLead(row.id, { stage: '已转客户' })
  row.stage = '已转客户'
  ElMessage.success('已转入客户管理')
  emit('customer-created')
  emit('refresh')
}

function sourceName(value) {
  return { own_account: '自有账号', peer_account: '同行账号', customer_account: '客户账号', manual: '手动录入' }[value] || value
}

function outreachStatus(value) {
  return {
    not_started: '未准备',
    prepared: '准备推送',
    channel_unconfigured: '通道未配置',
    sent: '已发送',
    failed: '推送失败',
    review: '结果待核对',
  }[value] || '未准备'
}

function outreachTagType(value) {
  return { prepared: 'success', channel_unconfigured: 'warning', sent: 'success', failed: 'danger', review: 'warning' }[value] || 'info'
}
</script>

<style scoped>
.overseas-muted { display: block; margin-top: 3px; }
</style>
