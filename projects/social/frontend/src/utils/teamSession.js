// 泰卦部署改造：会话只存在 HttpOnly Cookie 中，前端不保存账号密码或登录令牌。
import { shallowRef } from 'vue'

export const teamIdentity = shallowRef(null)
let loading = null

export async function teamRequest(path, options = {}) {
  // 文件上传由浏览器生成 multipart 边界，不能强制设置 JSON 类型。
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers }
  if (teamIdentity.value?.csrf) headers['X-CSRF-Token'] = teamIdentity.value.csrf
  // 下载和设备更换必须绑定发起操作时的工作区，避免管理员旧标签页绑错员工。
  if (teamIdentity.value?.workspace.id) headers['X-Workspace-ID'] = teamIdentity.value.workspace.id
  const response = await fetch(`/api/team/${path}`, { credentials: 'same-origin', ...options, headers })
  const result = await response.json()
  if (!response.ok) throw new Error(result.msg || '操作失败，请稍后重试')
  return result.data ?? result
}

export async function loadIdentity(force = false) {
  if (!force && teamIdentity.value) return teamIdentity.value
  if (!loading) {
    loading = teamRequest('me').then((data) => {
      teamIdentity.value = data
      return data
    }).catch(() => {
      teamIdentity.value = null
      return null
    }).finally(() => { loading = null })
  }
  return loading
}

export function clearWorkspaceCache() {
  // 切换员工或退出时清空草稿缓存，仅保留当前主题，防止共用浏览器串数据。
  let theme = 'dark'
  try { theme = JSON.parse(localStorage.getItem('app_settings') || '{}').theme || 'dark' } catch { /* 缓存损坏时使用默认主题 */ }
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('app_settings', JSON.stringify({ theme }))
  localStorage.setItem('team_context_epoch', String(Date.now()))
}

// 同一浏览器的其他标签页也刷新工作区，避免切换后继续展示旧员工数据。
window.addEventListener('storage', (event) => {
  if (event.key === 'team_context_epoch') window.location.reload()
})

export async function logout() {
  await teamRequest('logout', { method: 'POST' })
  clearWorkspaceCache()
  window.location.replace('/#/login')
  window.location.reload()
}

export function createTeamEventSource(url) {
  // 扫码是 GET 长连接，携带当前工作区以拒绝其他标签页切换后的旧请求。
  const target = new URL(url, window.location.origin)
  if (teamIdentity.value?.workspace.id) target.searchParams.set('__workspace', teamIdentity.value.workspace.id)
  return new EventSource(target.toString())
}
