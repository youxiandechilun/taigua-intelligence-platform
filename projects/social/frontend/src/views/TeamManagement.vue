<template>
  <section class="team-page">
    <div class="team-heading"><div><h1>员工管理</h1><p>员工独立使用平台账号、素材、草稿和发布记录。</p></div><el-button type="primary" @click="openCreate">新增员工</el-button></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-table :data="users" v-loading="loading" empty-text="暂无员工账号">
      <el-table-column prop="display_name" label="姓名" min-width="120" />
      <el-table-column prop="username" label="账号" min-width="150" />
      <el-table-column label="权限" width="110"><template #default="{ row }">{{ row.role === 'admin' ? '管理员' : '员工' }}</template></el-table-column>
      <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="row.active ? 'success' : 'info'">{{ row.active ? '已启用' : '已停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" min-width="260"><template #default="{ row }">
        <template v-if="row.role === 'employee'">
          <el-button link type="primary" @click="openWorkspace(row)" :disabled="!row.active || saving">进入工作区</el-button>
          <el-button link @click="openEdit(row)" :disabled="saving">编辑 / 重置密码</el-button>
          <el-button link :type="row.active ? 'danger' : 'success'" @click="toggleActive(row)" :disabled="saving">{{ row.active ? '停用' : '启用' }}</el-button>
        </template><span v-else>当前管理员</span>
      </template></el-table-column>
    </el-table>
    <el-dialog v-model="visible" :title="editing ? '编辑员工' : '新增员工'" width="min(480px, 94vw)" :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="员工姓名"><el-input v-model="form.display_name" maxlength="40" autocomplete="off" /></el-form-item>
        <el-form-item label="登录账号"><el-input v-model="form.username" :disabled="Boolean(editing)" maxlength="64" autocomplete="off" placeholder="3–64 位字母、数字或 . _ @ -" /></el-form-item>
        <el-form-item :label="editing ? '新密码（留空保持原密码）' : '登录密码'"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" maxlength="128" placeholder="8–128 位" /></el-form-item>
        <p class="team-note">权限：员工。只能访问自己的工作区。</p>
        <p v-if="formError" role="alert" class="team-error">{{ formError }}</p>
      </el-form>
      <template #footer><el-button @click="visible = false" :disabled="saving">取消</el-button><el-button type="primary" @click="save" :loading="saving">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup>
// 泰卦部署改造：前端展示管理入口，权限由后端再次校验，不能靠隐藏菜单实现隔离。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { teamRequest, clearWorkspaceCache } from '@/utils/teamSession'

const users = ref([]), loading = ref(false), saving = ref(false), error = ref('')
const visible = ref(false), editing = ref(null), formError = ref('')
const form = reactive({ username: '', display_name: '', password: '' })
async function refresh() {
  loading.value = true
  error.value = ''
  try { users.value = await teamRequest('users') } catch (err) { error.value = err.message } finally { loading.value = false }
}
function openCreate() {
  editing.value = null
  Object.assign(form, { username: '', display_name: '', password: '' })
  formError.value = ''
  visible.value = true
}
function openEdit(row) {
  editing.value = row.id
  Object.assign(form, { username: row.username, display_name: row.display_name, password: '' })
  formError.value = ''
  visible.value = true
}
async function save() {
  saving.value = true
  formError.value = ''
  try {
    await teamRequest(editing.value ? `users/${editing.value}` : 'users', { method: editing.value ? 'PATCH' : 'POST', body: JSON.stringify(form) })
    form.password = ''
    visible.value = false
    ElMessage.success('员工账号已保存')
    await refresh()
  } catch (err) { formError.value = err.message } finally { saving.value = false }
}
async function toggleActive(row) {
  if (row.active) {
    try { await ElMessageBox.confirm(`停用 ${row.display_name} 后，该员工会退出登录，正在进行的发布任务也会停止。`, '停用员工', { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }) } catch { return }
  }
  saving.value = true
  try {
    await teamRequest(`users/${row.id}`, { method: 'PATCH', body: JSON.stringify({ active: row.active ? 0 : 1 }) })
    await refresh()
  } catch (err) { ElMessage.error(err.message) } finally { saving.value = false }
}
async function openWorkspace(row) {
  try {
    await teamRequest('workspace', { method: 'POST', body: JSON.stringify({ user_id: row.id }) })
    clearWorkspaceCache()
    window.location.replace('/#/')
    window.location.reload()
  } catch (err) { ElMessage.error(err.message) }
}
onMounted(refresh)
</script>

<style scoped>
/* 泰卦部署改造：新增管理页使用现有控件和主题颜色，不调整原业务页面布局。 */
.team-page { padding: 28px; }
.team-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
h1 { font-size: 24px; margin-bottom: 8px; }
p, .team-note { color: var(--text-secondary); font-size: 14px; }
.team-error { color: var(--el-color-danger); margin-top: 12px; }
.el-alert { margin-bottom: 16px; }
</style>
