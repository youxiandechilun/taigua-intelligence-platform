<template>
  <main class="overseas-page overseas-module-page" v-loading="loading">
    <header class="overseas-hero">
      <div>
        <div class="overseas-eyebrow"><el-icon><component :is="config.icon" /></el-icon> OVERSEAS SOP</div>
        <h1 class="overseas-title">{{ config.title }}</h1>
        <p class="overseas-subtitle">{{ config.description }}</p>
      </div>
      <div class="overseas-hero-actions">
        <el-button @click="refreshData"><el-icon><Refresh /></el-icon>刷新数据</el-button>
        <el-button @click="startGuide"><el-icon><Guide /></el-icon>新手引导</el-button>
      </div>
    </header>

    <div class="overseas-notice" role="status">
      <el-icon><InfoFilled /></el-icon>
      <span>数据按员工工作区隔离。海外视频发布已接入浏览器执行，但仍需真实账号逐平台验收；评论/私信回复、WhatsApp 外发和 CRM 同步会先保存、审核并留痕，配置真实通道后才允许发送。</span>
    </div>

    <section class="overseas-module-summary" aria-label="当前模块说明">
      <div><strong>{{ config.step }}</strong><span>{{ config.summary }}</span></div>
      <el-tag :type="config.tagType" effect="plain">独立菜单</el-tag>
    </section>

    <OverseasContentPanel v-if="module === 'content'" :platforms="platforms" :jobs="jobs" @refresh="refreshData" />
    <OverseasInboxPanel v-else-if="module === 'inbox'" :platforms="platforms" :conversations="conversations" @refresh="refreshData" />
    <OverseasLeadPanel v-else-if="module === 'leads'" :platforms="platforms" :leads="leads" @refresh="refreshData" @customer-created="refreshCustomers" />
    <OverseasCustomerPanel v-else :customers="customers" @refresh="refreshCustomers" />

    <p v-if="errorMessage" class="overseas-error" role="alert">{{ errorMessage }}</p>
    <GuideTour ref="guideRef" :steps="config.guide" @finish="guideDone" @skip="guideDone" />
  </main>
</template>

<script setup>
// 海外 SOP 四个一级菜单共用数据加载和引导壳，业务面板仍保持彼此独立。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Aim, ChatDotRound, Guide, InfoFilled, Refresh, VideoCamera, UserFilled } from '@element-plus/icons-vue'
import { overseasApi } from '@/api/overseas'
import OverseasContentPanel from '@/components/OverseasContentPanel.vue'
import OverseasInboxPanel from '@/components/OverseasInboxPanel.vue'
import OverseasLeadPanel from '@/components/OverseasLeadPanel.vue'
import OverseasCustomerPanel from '@/components/OverseasCustomerPanel.vue'
import GuideTour from '@/components/GuideTour.vue'
import {
  GUIDE_KEYS,
  isGuideDone,
  markGuideDone,
  overseasContentGuideSteps,
  overseasCustomersGuideSteps,
  overseasInboxGuideSteps,
  overseasLeadsGuideSteps,
} from '@/config/guides'

const props = defineProps({ module: { type: String, required: true } })
const module = props.module

const configs = {
  content: {
    title: '内容工厂',
    description: '把混剪视频、文本生成视频和海外投放平台整理成可审核的内容任务。',
    step: '01',
    summary: '主题 → 脚本 → 语言 → 风格 → 平台 → 生成队列',
    tagType: 'warning',
    icon: VideoCamera,
    guide: overseasContentGuideSteps,
    guideKey: GUIDE_KEYS.overseasContent,
  },
  inbox: {
    title: '互动中心',
    description: '集中处理海外平台评论和私信，先判断意向，再生成可审核回复草稿。',
    step: '02',
    summary: '评论 / 私信 → 意向判断 → 回复草稿 → 人工发送',
    tagType: 'info',
    icon: ChatDotRound,
    guide: overseasInboxGuideSteps,
    guideKey: GUIDE_KEYS.overseasInbox,
  },
  leads: {
    title: '线索中心',
    description: '从自有账号、同行账号和客户账号中沉淀海外意向联系人。',
    step: '03',
    summary: '发现线索 → WhatsApp / 邮箱 → 授权 → CRM 留资',
    tagType: 'success',
    icon: Aim,
    guide: overseasLeadsGuideSteps,
    guideKey: GUIDE_KEYS.overseasLeads,
  },
  customers: {
    title: '客户管理',
    description: '把高意向海外线索转成客户档案，记录阶段、负责人和下一步动作。',
    step: '04',
    summary: '线索 → 客户 → 跟进阶段 → 成交复盘',
    tagType: '',
    icon: UserFilled,
    guide: overseasCustomersGuideSteps,
    guideKey: GUIDE_KEYS.overseasCustomers,
  },
}

const config = computed(() => configs[module] || configs.content)
const loading = ref(false)
const errorMessage = ref('')
const platforms = ref([])
const jobs = ref([])
const conversations = ref([])
const leads = ref([])
const customers = ref([])
const guideRef = ref(null)
let guideTimer = null

async function refreshData() {
  loading.value = true
  errorMessage.value = ''
  const results = await Promise.allSettled([
    overseasApi.getPlatforms(),
    overseasApi.getContentJobs(),
    overseasApi.getConversations(),
    overseasApi.getLeads(),
    overseasApi.getCustomers(),
  ])
  const [platformResult, jobsResult, conversationsResult, leadsResult, customersResult] = results
  if (platformResult.status === 'fulfilled') platforms.value = platformResult.value.data || []
  if (jobsResult.status === 'fulfilled') jobs.value = jobsResult.value.data || []
  if (conversationsResult.status === 'fulfilled') conversations.value = conversationsResult.value.data || []
  if (leadsResult.status === 'fulfilled') leads.value = leadsResult.value.data || []
  if (customersResult.status === 'fulfilled') customers.value = customersResult.value.data || []
  if (results.some((result) => result.status === 'rejected')) {
    errorMessage.value = '部分数据读取失败，请检查本地服务是否已启动。'
    ElMessage.warning(errorMessage.value)
  }
  loading.value = false
}

async function refreshCustomers() {
  const result = await overseasApi.getCustomers()
  customers.value = result.data || []
}

function startGuide() { guideRef.value?.start() }
function guideDone() { markGuideDone(config.value.guideKey) }

onMounted(() => {
  refreshData()
  if (!isGuideDone(config.value.guideKey)) guideTimer = window.setTimeout(startGuide, 700)
})
onBeforeUnmount(() => window.clearTimeout(guideTimer))
</script>
