// 本机访问凭证仅用于回环素材接口；员工长期设备令牌不会进入网页。
import { teamIdentity, teamRequest } from './teamSession'

let cached = null, refreshed = 0, workspace = ''

export async function localDevice() {
  const current = teamIdentity.value?.workspace.id
  if (!cached || workspace !== current || Date.now() - refreshed > 5000) {
    const result = await teamRequest('execution')
    cached = result.device
    workspace = current
    refreshed = Date.now()
  }
  if (!cached?.online || !cached.endpoint) throw new Error('请先在当前员工电脑下载并打开执行插件，入口在系统设置')
  return cached
}

export function localMediaUrl(path) {
  // 抽帧完成后使用已连接设备的地址，图片不再从服务器请求不存在的本机文件。
  if (!cached?.online || workspace !== teamIdentity.value?.workspace.id) return path
  const target = new URL(path, cached.endpoint)
  target.searchParams.set('cap', cached.capability)
  return target.toString()
}

export function localFileOperation(url = '') {
  return url.startsWith('/api/uploads/') || url === '/importAccount' || ['/api/materials/upload', '/api/materials/covers/',
    '/api/extract-frames', '/api/frames', '/api/frame-image'].some(prefix => url.startsWith(prefix))
}

export async function waitExecution(id, signal) {
  // 辅助查询等待真实本机结果；发布任务单独显示排队状态，不能把入队当作发布成功。
  for (;;) {
    if (signal?.aborted) throw new Error('操作已取消')
    const job = await teamRequest(`execution/jobs/${encodeURIComponent(id)}`)
    if (job.state === 'success') return job.result
    if (['failed', 'review', 'cancelled', 'missed'].includes(job.state)) throw new Error(job.message || '本机操作未完成')
    if (Date.now() / 1000 - job.created > 900) throw new Error('任务仍保留在队列，请到任务中心查看，勿重复提交')
    await new Promise(resolve => window.setTimeout(resolve, 1000))
  }
}
