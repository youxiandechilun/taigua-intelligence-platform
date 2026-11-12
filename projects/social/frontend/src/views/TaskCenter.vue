<template>
  <!-- 任务页仅保留真实任务与结果，插件提示统一放在系统设置。 -->
  <div class="task-center-page">
    <div class="page-header">
      <div><h1>任务中心</h1><p>查看任务进度与执行结果</p></div>
      <el-button @click="restartGuide"><el-icon><Guide /></el-icon>新手引导</el-button>
    </div>
    <ExecutionSettings tasks-only />
    <GuideTour ref="tourRef" :steps="taskGuideSteps" @finish="guideDone" @skip="guideDone" />
  </div>
</template>

<script setup>
// 轮询和取消行为由共享组件负责，任务页只管理自己的引导生命周期。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Guide } from '@element-plus/icons-vue'
import ExecutionSettings from '@/components/ExecutionSettings.vue'
import GuideTour from '@/components/GuideTour.vue'
import { taskGuideSteps, GUIDE_KEYS, isGuideDone, markGuideDone } from '@/config/guides'

const tourRef = ref(null)
const restartGuide = () => tourRef.value?.start()
const guideDone = () => markGuideDone(GUIDE_KEYS.task)
let guideTimer = null
onMounted(() => {
  // 首次进入说明关机条件，离开页面及时撤销延迟提示。
  if (!isGuideDone(GUIDE_KEYS.task)) guideTimer = window.setTimeout(restartGuide, 800)
})
onBeforeUnmount(() => window.clearTimeout(guideTimer))
</script>

<style scoped>
/* 沿用红黑灰主题变量，窄屏允许标题与按钮自然换行。 */
.task-center-page { padding: 24px; min-width: 0; box-sizing: border-box; }
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
h1 { color: var(--text-primary); font-size: 26px; margin: 0; }
p { color: var(--text-secondary); font-size: 14px; margin: 8px 0 0; }
/* 和其他业务页保持相同边距，手机端避免标题和引导按钮被挤出画面。 */
@media (max-width: 600px) { .task-center-page { padding: 16px; } }
</style>
