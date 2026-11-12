import { http } from '@/utils/request'

// 海外矩阵工作台的接口集中在这里，页面组件只处理状态和展示。
export const overseasApi = {
  getPlatforms() {
    return http.get('/api/overseas/platforms')
  },
  getContentJobs() {
    return http.get('/api/overseas/content/jobs')
  },
  createContentJob(payload) {
    return http.post('/api/overseas/content/jobs', payload)
  },
  queueContentJob(jobId) {
    return http.post(`/api/overseas/content/jobs/${encodeURIComponent(jobId)}/queue`, {})
  },
  /** @param {string} id */
  generateReply(id) {
    return http.post(`/api/overseas/conversations/${encodeURIComponent(id)}/reply/generate`, {})
  },
  /** @param {string} id @param {string} receipt */
  confirmManualReply(id, receipt) {
    return http.post(`/api/overseas/conversations/${encodeURIComponent(id)}/reply/confirm`, { receipt })
  },
  getConversations() {
    return http.get('/api/overseas/conversations')
  },
  createConversation(payload) {
    return http.post('/api/overseas/conversations', payload)
  },
  updateConversation(id, payload) {
    return http.patch(`/api/overseas/conversations/${encodeURIComponent(id)}`, payload)
  },
  // 保存回复草稿只写入当前工作区，不代表已审核或已发送。
  saveReplyDraft(id, draft) {
    return http.patch(`/api/overseas/conversations/${encodeURIComponent(id)}`, {
      reply_draft: draft,
    })
  },
  // 审核通过后只进入“准备发送”，真实发送仍需外部平台通道。
  approveReply(id) {
    return http.patch(`/api/overseas/conversations/${encodeURIComponent(id)}`, {
      reply_review_status: 'approved',
    })
  },
  attemptSendReply(id) {
    return http.post(`/api/overseas/conversations/${encodeURIComponent(id)}/reply/send`, {})
  },
  getLeads() {
    return http.get('/api/overseas/leads')
  },
  createLead(payload) {
    return http.post('/api/overseas/leads', payload)
  },
  updateLead(id, payload) {
    return http.patch(`/api/overseas/leads/${encodeURIComponent(id)}`, payload)
  },
  pushLead(id, channel, phase = 'prepare') {
    return http.post(`/api/overseas/leads/${encodeURIComponent(id)}/push`, { channel, phase })
  },
  /** @param {string} id @param {boolean} received @param {string} receipt */
  confirmPush(id, received, receipt) {
    return http.post(`/api/overseas/leads/${encodeURIComponent(id)}/push/confirm`, { received, receipt })
  },
  getCustomers() {
    return http.get('/api/overseas/customers')
  },
  createCustomer(payload) {
    return http.post('/api/overseas/customers', payload)
  },
  updateCustomer(id, payload) {
    return http.patch(`/api/overseas/customers/${encodeURIComponent(id)}`, payload)
  },
  getPushLogs() {
    return http.get('/api/overseas/push-logs')
  },
}
