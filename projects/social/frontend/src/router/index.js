import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import AccountManagement from '../views/AccountManagement.vue'
import MaterialManagement from '../views/MaterialManagement.vue'
import PublishCenter from '../views/PublishCenter.vue'
import PublishHistory from '../views/PublishHistory.vue'
import Settings from '../views/Settings.vue'
// 泰卦部署改造：新增员工登录与管理员权限路由。
import { loadIdentity } from '../utils/teamSession'

const routes = [
  { path: '/login', name: 'TeamLogin', component: () => import('../views/TeamLogin.vue'), meta: { public: true } },
  { path: '/team', name: 'TeamManagement', component: () => import('../views/TeamManagement.vue'), meta: { title: '员工管理', admin: true } },
  // 旧版海外矩阵地址保留跳转，避免收藏链接失效；新结构按独立菜单拆分。
  { path: '/overseas', redirect: '/account-management/overseas' },
  { path: '/', name: 'Dashboard', component: Dashboard, meta: { icon: 'HomeFilled', title: '仪表盘' } },
  { path: '/account-management', name: 'AccountManagement', component: AccountManagement, meta: { icon: 'User', title: '账号管理' } },
  { path: '/account-management/overseas', name: 'OverseasAccounts', component: () => import('../views/OverseasAccounts.vue'), meta: { icon: 'User', title: '海外账号' } },
  { path: '/material-management', name: 'MaterialManagement', component: MaterialManagement, meta: { icon: 'Picture', title: '素材管理' } },
  { path: '/drafts', name: 'DraftBox', component: () => import('../views/DraftBox.vue'), meta: { icon: 'Document', title: '草稿箱' } },
  { path: '/publish-center', name: 'PublishCenter', component: PublishCenter, meta: { icon: 'Upload', title: '视频发布' } },
  { path: '/image-publish', name: 'ImagePublish', component: () => import('../views/ImagePublish.vue'), meta: { icon: 'Picture', title: '图集发布' } },
  { path: '/article-publish', name: 'ArticlePublish', component: () => import('../views/ArticlePublish.vue'), meta: { icon: 'EditPen', title: '文章发布' } },
  // 海外 SOP 的四个模块分别作为一级业务菜单，页面之间不再依赖工作台内标签切换。
  { path: '/overseas/content', name: 'OverseasContent', component: () => import('../views/OverseasContent.vue'), meta: { icon: 'VideoCamera', title: '内容工厂' } },
  { path: '/overseas/inbox', name: 'OverseasInbox', component: () => import('../views/OverseasInbox.vue'), meta: { icon: 'ChatDotRound', title: '互动中心' } },
  { path: '/overseas/leads', name: 'OverseasLeads', component: () => import('../views/OverseasLeads.vue'), meta: { icon: 'Aim', title: '线索中心' } },
  { path: '/overseas/customers', name: 'OverseasCustomers', component: () => import('../views/OverseasCustomers.vue'), meta: { icon: 'UserFilled', title: '客户管理' } },
  { path: '/publish-history', name: 'PublishHistory', component: PublishHistory, meta: { icon: 'Clock', title: '发布历史' } },
  // 混合任务需要可直接进入的状态页，和设置页共用真实持久队列。
  { path: '/task-center', name: 'TaskCenter', component: () => import('../views/TaskCenter.vue'), meta: { icon: 'List', title: '任务中心' } },
  { path: '/publish-calendar', name: 'PublishCalendar', component: () => import('../views/PublishCalendar.vue'), meta: { icon: 'Calendar', title: '发布日历' } },
  { path: '/publish-history/:batchId', name: 'PublishHistoryDetail', component: () => import('../views/PublishHistoryDetail.vue') },
  { path: '/settings', name: 'Settings', component: Settings, meta: { icon: 'Setting', title: '系统设置', isBottom: true } },
]

routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 直接输入员工管理网址也要校验身份，后端会执行独立的权限检查。
router.beforeEach(async (to) => {
  const identity = await loadIdentity()
  if (to.meta.public) return identity ? '/' : true
  if (!identity) return '/login'
  if (to.meta.admin && identity.user.role !== 'admin') return '/'
  return true
})

export default router
