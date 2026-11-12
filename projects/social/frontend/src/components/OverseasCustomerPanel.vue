<template>
  <section class="overseas-card" data-tour="overseas-customers" aria-labelledby="customer-title">
    <div class="overseas-panel-head">
      <div>
        <h2 id="customer-title" class="overseas-panel-title">客户管理</h2>
        <p class="overseas-panel-subtitle">把已确认的海外联系人沉淀成客户，记录负责人、阶段和下一步动作。</p>
      </div>
      <el-button size="small" type="primary" plain @click="showCreate = !showCreate">{{ showCreate ? '收起录入' : '新增客户' }}</el-button>
    </div>

    <el-form v-if="showCreate" label-position="top" @submit.prevent="saveCustomer" class="customer-form">
      <div class="overseas-form-grid">
        <el-form-item label="客户名称" required>
          <el-input v-model="form.name" placeholder="联系人或客户名称" maxlength="120" />
        </el-form-item>
        <el-form-item label="公司 / 店铺">
          <el-input v-model="form.company" placeholder="公司名称" maxlength="120" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="name@example.com" maxlength="160" />
        </el-form-item>
        <el-form-item label="电话 / WhatsApp">
          <el-input v-model="form.whatsapp" placeholder="优先填 WhatsApp 国际区号" maxlength="100" />
        </el-form-item>
        <el-form-item label="阶段">
          <el-select v-model="form.stage" style="width: 100%">
            <el-option v-for="stage in stageOptions" :key="stage" :label="stage" :value="stage" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="form.owner" placeholder="当前员工或负责人" maxlength="80" />
        </el-form-item>
        <el-form-item label="标签" class="span-2">
          <el-input v-model="form.tags" placeholder="例如：高意向, SaaS, 美国" maxlength="200" />
        </el-form-item>
        <el-form-item label="备注" class="span-2">
          <el-input v-model="form.notes" type="textarea" :rows="3" placeholder="需求、预算、跟进记录" maxlength="1000" show-word-limit />
        </el-form-item>
      </div>
      <div class="overseas-form-actions">
        <el-button @click="resetForm">清空</el-button>
        <el-button native-type="submit" type="primary" :loading="saving">保存客户</el-button>
      </div>
    </el-form>

    <div v-if="customers.length" class="overseas-table-wrap">
      <el-table :data="customers" size="small" stripe>
        <el-table-column label="客户" min-width="180">
          <template #default="scope">
            <div>{{ scope.row.name }}</div>
            <span class="overseas-muted">{{ scope.row.company || '未填写公司' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="联系方式" min-width="190">
          <template #default="scope">
            <div>{{ scope.row.whatsapp || scope.row.phone || '未填写 WhatsApp / 电话' }}</div>
            <span class="overseas-muted">{{ scope.row.email || '未填写邮箱' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="阶段" width="140">
          <template #default="scope">
            <el-select :model-value="scope.row.stage" size="small" @change="updateCustomer(scope.row, { stage: $event })">
              <el-option v-for="stage in stageOptions" :key="stage" :label="stage" :value="stage" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="负责人" width="140">
          <template #default="scope">
            <el-input :model-value="scope.row.owner" size="small" placeholder="未分配" @change="updateCustomer(scope.row, { owner: $event })" />
          </template>
        </el-table-column>
        <el-table-column prop="tags" label="标签" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="editNotes(scope.row)">补充备注</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-else class="overseas-empty">还没有客户记录，在线索中心把高意向线索转入这里。</div>

    <el-dialog v-model="notesVisible" title="补充客户备注" width="520px">
      <el-input v-model="notesDraft" type="textarea" :rows="6" maxlength="1000" show-word-limit />
      <template #footer>
        <el-button @click="notesVisible = false">取消</el-button>
        <el-button type="primary" :loading="notesSaving" @click="saveNotes">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { overseasApi } from '@/api/overseas'

defineProps({ customers: { type: Array, default: () => [] } })
const emit = defineEmits(['refresh'])

const stageOptions = ['待跟进', '沟通中', '方案已发', '成交', '暂缓']
const showCreate = ref(false)
const saving = ref(false)
const notesSaving = ref(false)
const notesVisible = ref(false)
const notesDraft = ref('')
const notesRow = ref(null)
const form = reactive({ name: '', company: '', phone: '', email: '', whatsapp: '', stage: '待跟进', owner: '', tags: '', notes: '' })

function resetForm() {
  Object.assign(form, { name: '', company: '', phone: '', email: '', whatsapp: '', stage: '待跟进', owner: '', tags: '', notes: '' })
}

async function saveCustomer() {
  if (!form.name.trim()) return ElMessage.warning('请先填写客户名称')
  saving.value = true
  try {
    await overseasApi.createCustomer({ ...form })
    ElMessage.success('客户已保存')
    resetForm()
    showCreate.value = false
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function updateCustomer(row, payload) {
  await overseasApi.updateCustomer(row.id, payload)
  Object.assign(row, payload)
  ElMessage.success('客户信息已更新')
  emit('refresh')
}

function editNotes(row) {
  notesRow.value = row
  notesDraft.value = row.notes || ''
  notesVisible.value = true
}

async function saveNotes() {
  if (!notesRow.value) return
  notesSaving.value = true
  try {
    await updateCustomer(notesRow.value, { notes: notesDraft.value })
    notesVisible.value = false
  } finally {
    notesSaving.value = false
  }
}
</script>

<style scoped>
.customer-form { margin-bottom: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--border); }
.overseas-muted { display: block; margin-top: 3px; }
</style>
