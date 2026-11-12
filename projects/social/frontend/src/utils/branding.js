// 品牌状态独立于员工工作区，更换后同步当前页面和同浏览器的其他标签页。
import { shallowRef } from 'vue'
import { teamRequest } from './teamSession'

export const branding = shallowRef({ logo_url: '/api/team/branding/logo', icon_url: '/api/team/branding/icon', is_custom: false })
export async function loadBranding() {
  branding.value = await teamRequest('branding')
  return branding.value
}
export function updateBranding(value) {
  branding.value = value
  localStorage.setItem('team_brand_epoch', String(Date.now()))
}
window.addEventListener('storage', (event) => {
  if (event.key === 'team_brand_epoch') loadBranding().catch(() => {})
})
