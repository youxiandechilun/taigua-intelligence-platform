import axios from 'axios'
import { ElMessage } from 'element-plus'
// 泰卦部署改造：写请求附带会话校验和工作区编号，防止跨站或旧标签页串工作区。
import { teamIdentity } from './teamSession'
import { localDevice, localFileOperation, waitExecution } from './localExecution'

// 创建axios实例
const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
request.interceptors.request.use(
  async (config) => {
    const identity = teamIdentity.value
    if (identity) {
      config.headers['X-CSRF-Token'] = identity.csrf
      config.headers['X-Workspace-ID'] = identity.workspace.id
    }
    if (localFileOperation(config.url)) {
      // 新素材直接从网页写入本机插件，原文件不会先上传服务器再转发。
      const device = await localDevice()
      config.url = device.endpoint + config.url
      config.baseURL = ''
      config.headers.Authorization = `Bearer ${device.capability}`
      config.withCredentials = false
    }
    if (config.method !== 'get') config.headers['X-Request-ID'] ||= crypto.randomUUID()
    return config
  },
  (error) => {
    console.error('请求错误:', error)
    return Promise.reject(error)
  }
)

/**
 * 从后端错误信息中提取用户可读的消息（去掉 Python 堆栈）
 * 规则：只取第一行；如果包含 "Error:" 或 "错误:" 则取其后面的部分
 */
function extractUserMessage(raw) {
  if (!raw) return ''
  const text = String(raw)
  // 取第一行
  const firstLine = text.split('\n')[0].trim()
  // 如果包含典型错误前缀，取冒号后面的内容
  const match = firstLine.match(/(?:Error|错误|失败|异常|Exception)[:：]\s*(.+)/)
  return match ? match[1].trim() : firstLine
}

// 响应拦截器
request.interceptors.response.use(
  async (response) => {
    let { data } = response
    if (data.execution_job) {
      // 发布返回持久队列的真实受理状态；账号检查、合集等辅助查询才等待执行结果。
      const publishing = ['/api/image-publish/publish', '/api/article-publish/publish'].includes(response.config.url)
      if (!publishing) data = await waitExecution(data.execution_job, response.config.signal)
      else data.data = { ...data.data, queued: true }
    }

    // 根据后端接口规范处理响应
    if (data.code === 200 || data.success) {
      return data
    } else {
      const msg = extractUserMessage(data.msg || data.message) || '请求失败'
      ElMessage.error(msg)
      return Promise.reject(new Error(msg))
    }
  },
  (error) => {
    console.error('响应错误:', error)

    // 处理HTTP错误状态码
    if (error.response) {
      const { status } = error.response
      const rawMsg = error.response?.data?.msg || error.response?.data?.message || ''
      const msg = extractUserMessage(rawMsg)

      switch (status) {
        case 400:
          ElMessage.error(msg || '请求参数错误')
          break
        case 401:
          ElMessage.error('未授权，请重新登录')
          window.location.assign('/#/login')
          break
        case 403:
          ElMessage.error('拒绝访问')
          break
        case 404:
          ElMessage.error(msg || '请求地址不存在')
          break
        case 500:
          ElMessage.error(msg || '服务器内部错误')
          break
        default:
          ElMessage.error(msg || '网络错误')
      }
    } else {
      ElMessage.error('网络连接失败')
    }

    return Promise.reject(error)
  }
)

// 封装常用的请求方法
export const http = {
  get(url, params) {
    return request.get(url, { params })
  },
  
  post(url, data, config = {}) {
    return request.post(url, data, config)
  },
  
  put(url, data, config = {}) {
    return request.put(url, data, config)
  },

  // 海外工作台的线索、互动和客户支持局部更新。
  patch(url, data, config = {}) {
    return request.patch(url, data, config)
  },
  
  delete(url, params) {
    return request.delete(url, { params })
  },
  
  upload(url, formData, onUploadProgress) {
    return request.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress
    })
  }
}

export default request
