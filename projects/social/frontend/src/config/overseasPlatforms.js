// 海外账号复用统一平台配置，原 TikTok/YouTube 的发布设置和编号不再重复维护。
import { PLATFORMS } from './platforms'
// 海外平台使用本地 SVG 品牌图标，避免登录弹窗出现字母占位。
import logoInstagram from '@/assets/logos/instagram.svg'
import logoFacebook from '@/assets/logos/facebook.svg'
import logoX from '@/assets/logos/x.svg'
import logoLinkedin from '@/assets/logos/linkedin.svg'
import logoThreads from '@/assets/logos/threads.svg'
import logoPinterest from '@/assets/logos/pinterest.svg'

// 海外浏览器执行器当前只接入视频；图片、轮播和文章仍未实现。
// verificationStatus 只反映代码状态，真实账号验收完成后再由后端/前端更新。
export const overseasVideoCapabilities = {
  video: {
    supported: true,
    status: 'code_ready_unverified',
    execution: 'browser',
    label: '视频：浏览器执行，待真实账号验收',
  },
  image: { supported: false, status: 'not_implemented', execution: 'none', label: '图片：未接入' },
  carousel: { supported: false, status: 'not_implemented', execution: 'none', label: '轮播：未接入' },
  article: { supported: false, status: 'not_implemented', execution: 'none', label: '文章：未接入' },
}

const overseasVideoStatus = {
  contentTypes: ['video'],
  capabilities: overseasVideoCapabilities,
  verificationStatus: 'code_ready_unverified',
  verificationText: '浏览器适配代码已接入，尚未用真实账号验收',
}

// loginType 有值的平台直接复用后端现有 /login 浏览器引擎；其余平台先打开官方登录页。
export const overseasPlatformList = [
  {
    ...PLATFORMS.TIKTOK,
    loginType: PLATFORMS.TIKTOK.id,
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
  },
  {
    ...PLATFORMS.YOUTUBE,
    loginType: PLATFORMS.YOUTUBE.id,
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
  },
  {
    id: 101,
    key: 'instagram',
    name: 'Instagram',
    shortName: 'IG',
    letter: 'I',
    logo: logoInstagram,
    color: '#d946ef',
    bgColor: 'rgba(217, 70, 239, 0.15)',
    cssClass: 'instagram',
    creatorUrl: 'https://www.instagram.com/accounts/login/',
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
    settingsFields: [
      { key: 'scheduleTime', label: '定时发布', type: 'datetime', placeholder: '选择时间' },
      { key: 'videoFormat', label: '视频格式', type: 'radio', options: [{ label: '横版', value: 'landscape' }, { label: '竖版', value: 'portrait' }] },
    ],
    defaultSettings: { title: '', description: '', scheduleTime: '', tags: [], videoFormat: '' },
    loginType: 101,
  },
  {
    id: 102,
    key: 'facebook',
    name: 'Facebook',
    shortName: 'FB',
    letter: 'F',
    logo: logoFacebook,
    color: '#1877f2',
    bgColor: 'rgba(24, 119, 242, 0.15)',
    cssClass: 'facebook',
    creatorUrl: 'https://www.facebook.com/login/',
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
    settingsFields: [
      { key: 'scheduleTime', label: '定时发布', type: 'datetime', placeholder: '选择时间' },
      { key: 'videoFormat', label: '视频格式', type: 'radio', options: [{ label: '横版', value: 'landscape' }, { label: '竖版', value: 'portrait' }] },
    ],
    defaultSettings: { title: '', description: '', scheduleTime: '', tags: [], videoFormat: '' },
    loginType: 102,
  },
  {
    id: 103,
    key: 'x',
    name: 'X',
    shortName: 'X',
    letter: 'X',
    logo: logoX,
    color: '#111827',
    bgColor: 'rgba(17, 24, 39, 0.15)',
    cssClass: 'x',
    creatorUrl: 'https://x.com/i/flow/login',
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
    settingsFields: [
      { key: 'scheduleTime', label: '定时发布', type: 'datetime', placeholder: '选择时间' },
      { key: 'videoFormat', label: '视频格式', type: 'radio', options: [{ label: '横版', value: 'landscape' }, { label: '竖版', value: 'portrait' }] },
    ],
    defaultSettings: { title: '', description: '', scheduleTime: '', tags: [], videoFormat: '' },
    loginType: 103,
  },
  {
    id: 104,
    key: 'linkedin',
    name: 'LinkedIn',
    shortName: 'in',
    letter: 'in',
    logo: logoLinkedin,
    color: '#0a66c2',
    bgColor: 'rgba(10, 102, 194, 0.15)',
    cssClass: 'linkedin',
    creatorUrl: 'https://www.linkedin.com/login',
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
    settingsFields: [
      { key: 'scheduleTime', label: '定时发布', type: 'datetime', placeholder: '选择时间' },
      { key: 'videoFormat', label: '视频格式', type: 'radio', options: [{ label: '横版', value: 'landscape' }, { label: '竖版', value: 'portrait' }] },
    ],
    defaultSettings: { title: '', description: '', scheduleTime: '', tags: [], videoFormat: '' },
    loginType: 104,
  },
  {
    id: 105,
    key: 'threads',
    name: 'Threads',
    shortName: '@',
    letter: '@',
    logo: logoThreads,
    color: '#111827',
    bgColor: 'rgba(17, 24, 39, 0.15)',
    cssClass: 'threads',
    creatorUrl: 'https://www.threads.com/login',
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
    settingsFields: [
      { key: 'scheduleTime', label: '定时发布', type: 'datetime', placeholder: '选择时间' },
      { key: 'videoFormat', label: '视频格式', type: 'radio', options: [{ label: '横版', value: 'landscape' }, { label: '竖版', value: 'portrait' }] },
    ],
    defaultSettings: { title: '', description: '', scheduleTime: '', tags: [], videoFormat: '' },
    loginType: 105,
  },
  {
    id: 106,
    key: 'pinterest',
    name: 'Pinterest',
    shortName: 'P',
    letter: 'P',
    logo: logoPinterest,
    color: '#e60023',
    bgColor: 'rgba(230, 0, 35, 0.15)',
    cssClass: 'pinterest',
    creatorUrl: 'https://www.pinterest.com/login/',
    loginMode: '统一浏览器登录',
    publishable: true,
    ...overseasVideoStatus,
    settingsFields: [
      { key: 'scheduleTime', label: '定时发布', type: 'datetime', placeholder: '选择时间' },
      { key: 'videoFormat', label: '视频格式', type: 'radio', options: [{ label: '横版', value: 'landscape' }, { label: '竖版', value: 'portrait' }] },
    ],
    defaultSettings: { title: '', description: '', scheduleTime: '', tags: [], videoFormat: '' },
    loginType: 106,
  },
]

