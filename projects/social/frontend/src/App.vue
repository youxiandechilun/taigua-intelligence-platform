<template>
  <!-- 泰卦部署改造：登录页不加载业务菜单和工作区组件。 -->
  <router-view v-if="route.meta.public" />
  <div v-else class="layout">
    <!-- Sidebar -->
    <div class="sidebar" :class="{ expanded: !sidebarCollapsed }">
      <div class="sidebar-top">
        <div class="logo" title="泰卦智能发布">
          <img :src="sidebarCollapsed ? branding.icon_url : branding.logo_url" alt="泰卦智能发布" class="brand-logo" />
        </div>
        <button class="toggle-btn" :aria-label="sidebarCollapsed ? '展开菜单' : '收起菜单'" @click="sidebarCollapsed = !sidebarCollapsed">
          <el-icon :size="16"><component :is="sidebarCollapsed ? Expand : Fold" /></el-icon>
        </button>
      </div>

      <div class="sidebar-nav">
        <template v-for="item in navItems" :key="item.title">
          <el-tooltip v-if="sidebarCollapsed" :content="item.title" effect="dark" placement="right">
            <div
              class="nav-item"
              :class="{ active: isNavItemActive(item) }"
              @click="router.push(item.path)"
            >
              <el-icon :size="20"><component :is="item.icon" /></el-icon>
            </div>
          </el-tooltip>
          <div v-else class="nav-group">
            <div
              class="nav-item expanded-item"
              :class="{ active: isNavItemActive(item) }"
              @click="router.push(item.path)"
            >
              <el-icon :size="20"><component :is="item.icon" /></el-icon>
              <span class="nav-label">{{ item.title }}</span>
              <el-icon v-if="item.children?.length" class="nav-group-arrow" :size="14"><ArrowDown /></el-icon>
            </div>
            <div v-if="item.children?.length" class="nav-subitems">
              <div
                v-for="child in item.children"
                :key="child.path"
                class="nav-subitem"
                :class="{ active: route.path === child.path }"
                @click.stop="router.push(child.path)"
              >
                <span class="nav-subdot"></span>
                <span>{{ child.title }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="sidebar-separator"></div>

      <div class="sidebar-bottom">
        <!-- 主题切换：放在 sidebar 底部，明显位置;折叠态只显图标,展开态显「图标 + 当前模式」 -->
        <button
          class="theme-toggle"
          :class="{ expanded: !sidebarCollapsed }"
          @click="appStore.toggleTheme"
        >
          <el-icon :size="16">
            <component :is="appStore.theme === 'dark' ? Sunny : Moon" />
          </el-icon>
          <span v-if="!sidebarCollapsed" class="theme-label">
            {{ appStore.theme === 'dark' ? '暗色' : '亮色' }}
          </span>
          <span v-if="!sidebarCollapsed" class="theme-hint">点击切换</span>
        </button>
        <button class="nav-item" :class="{ 'expanded-item': !sidebarCollapsed }" title="系统设置" @click="router.push('/settings')">
          <el-icon :size="20"><Setting /></el-icon><span v-if="!sidebarCollapsed" class="nav-label">系统设置</span>
        </button>
      </div>
    </div>

    <!-- Right area -->
    <div class="main-area">
      <!-- Header -->
      <header class="header">
        <div class="breadcrumb">{{ pageTitle }}</div>
        <!-- 泰卦部署改造：管理员可切换员工工作区，员工只显示自己的工作区。 -->
        <div class="team-toolbar">
          <el-select v-if="teamIdentity?.user.role === 'admin'" :model-value="teamIdentity.workspace.id" aria-label="当前工作区" @change="switchWorkspace" style="width: 160px">
            <el-option v-for="item in teamIdentity.workspaces" :key="item.id" :value="item.id" :label="item.id === teamIdentity.user.id ? '我的工作区' : item.display_name + '的工作区'" />
          </el-select>
          <span class="team-user">{{ teamIdentity?.user.display_name }} · {{ teamIdentity?.user.role === 'admin' ? '管理员' : '员工' }}</span>
          <el-button text @click="passwordVisible = true">修改密码</el-button>
          <el-button text @click="handleLogout">退出</el-button>
        </div>
      </header>

      <!-- Content -->
      <main class="content">
        <router-view v-slot="{ Component }">
            <component :is="Component" :key="$route.path" />
          </router-view>
      </main>
    </div>
    <TeamPasswordDialog v-model="passwordVisible" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { branding, loadBranding } from '@/utils/branding'
import { useRoute, useRouter } from 'vue-router'
import {
  HomeFilled, User, Picture, Upload,
  Clock, Setting, Expand, Fold, UserFilled, Document, List, VideoCamera, ChatDotRound, Aim, ArrowDown,
  Sunny, Moon, EditPen
} from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
// 泰卦部署改造：菜单权限和工作区切换使用经过服务端校验的身份。
import { teamIdentity, teamRequest, clearWorkspaceCache, logout } from '@/utils/teamSession'
import TeamPasswordDialog from '@/components/TeamPasswordDialog.vue'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()

const sidebarCollapsed = ref(false)
// 首次打开读取全局品牌，保持员工和管理员界面的标识一致。
onMounted(() => { loadBranding().catch(() => {}) })

// 菜单项数据
const navItems = computed(() => [
  { path: '/', icon: HomeFilled, title: '仪表盘' },
  {
    path: '/account-management', icon: User, title: '账号管理',
    children: [
      { path: '/account-management', title: '国内账号' },
      { path: '/account-management/overseas', title: '海外账号' },
    ],
  },
  { path: '/material-management', icon: Picture, title: '素材管理' },
  { path: '/publish-center', icon: Upload, title: '视频发布' },
  { path: '/image-publish', icon: Picture, title: '图集发布' },
  { path: '/article-publish', icon: EditPen, title: '文章发布' },
  { path: '/overseas/content', icon: VideoCamera, title: '内容工厂' },
  { path: '/overseas/inbox', icon: ChatDotRound, title: '互动中心' },
  { path: '/overseas/leads', icon: Aim, title: '线索中心' },
  { path: '/overseas/customers', icon: UserFilled, title: '客户管理' },
  { path: '/drafts', icon: Document, title: '草稿箱' },
  // 定时任务的就绪状态从这里核对，避免引导提到的页面没有导航入口。
  { path: '/task-center', icon: List, title: '任务中心' },
  { path: '/publish-history', icon: Clock, title: '发布历史' },
  ...(teamIdentity.value?.user.role === 'admin' ? [{ path: '/team', icon: UserFilled, title: '员工管理' }] : [])
])

const passwordVisible = ref(false)
async function switchWorkspace(userId) {
  try {
    await teamRequest('workspace', { method: 'POST', body: JSON.stringify({ user_id: userId }) })
    clearWorkspaceCache()
    window.location.replace('/#/')
    window.location.reload()
  } catch (err) { ElMessage.error(err.message) }
}
async function handleLogout() {
  try { await logout() } catch (err) { ElMessage.error(err.message) }
}

const activeMenu = computed(() => route.path)

// 子菜单页面打开时保持父级高亮，折叠侧栏也能看出当前所在业务模块。
function isNavItemActive(item) {
  if (item.path === '/') return route.path === '/'
  return route.path === item.path || route.path.startsWith(`${item.path}/`) || item.children?.some((child) => child.path === route.path)
}

const pageTitle = computed(() => route.meta?.title || '')
</script>

<style lang="scss" scoped>
@use '@/styles/variables.scss' as *;

/* 泰卦部署改造：账号工具栏只增加必要控件，原页面布局保持原样。 */
.team-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.team-user { color: var(--text-secondary); font-size: 12px; }
@media (max-width: 768px) { .team-user { display: none; } .header { height: auto !important; min-height: 64px; flex-wrap: wrap; gap: 8px; padding-block: 8px !important; } }
.layout {
  display: flex;
  height: 100vh;
}

// ---- Sidebar ----
.sidebar {
  width: 64px;
  background: rgba($overlay-rgb, 0.03);
  border-right: 1px solid $border;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  flex-shrink: 0;
  transition: width $transition-slow;
  overflow: hidden;

  // 收起时将品牌和展开按钮放进 64px 侧栏，避免图形被边缘裁切。
  &:not(.expanded) .sidebar-top {
    width: 64px;
    padding-right: 0;
    justify-content: center;
    .logo { width: 28px; height: 36px; padding: 4px; }
    .toggle-btn { width: 20px; }
  }

  &.expanded {
    width: 200px;
    align-items: stretch;
    padding: 12px 12px;

    .sidebar-top {
      justify-content: space-between;
      padding-right: 0;

      .logo {
        // 展开态完整展示横版品牌图，沿用原侧栏宽度。
        width: 144px;
        height: 36px;
        padding: 6px;
        border-radius: 10px;
        gap: 8px;
        justify-content: flex-start;
        font-weight: 600;
        font-size: 14px;
        letter-spacing: 0.02em;

        .logo-text { display: inline; white-space: nowrap; }
      }
    }

    .sidebar-nav {
      align-items: stretch;
    }

    .nav-item.expanded-item {
      width: 100%;
      justify-content: flex-start;
      padding: 0 12px;

      .nav-label {
        display: inline;
        margin-left: 12px;
      }
    }

    .sidebar-bottom {
      align-items: stretch;
    }

    .sidebar-separator {
      margin: 8px 0;
      width: 100%;
    }
  }

  .sidebar-top {
    display: flex;
    align-items: center;
    margin-bottom: 16px;
    padding-right: 12px;
    gap: 4px;

    .logo {
      // 折叠态：圆形 36x36 图标
      width: 36px;
      height: 36px;
      border-radius: 8px;
      padding: 6px;
      box-sizing: border-box;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0;
      color: #fff;
      flex-shrink: 0;
      overflow: hidden;
      transition: $transition-base;

      .logo-icon { font-size: 18px; }
      .logo-text { display: none; }
      .brand-logo { width: 100%; height: 100%; object-fit: contain; }
    }
  }

  .toggle-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: $radius-sm;
    background: transparent;
    color: $text-muted;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: $transition-base;
    flex-shrink: 0;

    &:hover {
      background: rgba($overlay-rgb, 0.06);
      color: $text-secondary;
    }
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  // 展开态账号管理显示二级菜单，其他功能保持一级独立入口。
  .nav-group {
    width: 100%;
  }

  .nav-group-arrow {
    margin-left: auto;
    color: currentColor;
    opacity: 0.7;
  }

  .nav-subitems {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 0 4px 20px;
    padding-left: 18px;
    border-left: 1px solid rgba($overlay-rgb, 0.12);
  }

  .nav-subitem {
    min-height: 30px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-radius: 7px;
    color: $text-muted;
    font-size: 12px;
    cursor: pointer;
    transition: $transition-fast;

    &:hover { color: $text-secondary; background: rgba($overlay-rgb, 0.06); }
    &.active { color: $brand-start; background: rgba($brand-start, 0.1); }
  }

  .nav-subdot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .sidebar-separator {
    height: 1px;
    background: $border;
    margin: 8px 12px;
    width: calc(100% - 24px);
  }

  .sidebar-bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .nav-item {
    width: 40px;
    height: 40px;
    border-radius: $radius-base;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: $transition-base;
    color: $text-muted;
    white-space: nowrap;
    position: relative;

    &:hover {
      background: rgba($overlay-rgb, 0.06);
      color: $text-secondary;
    }

    &.active {
      background: $gradient-brand;
      color: #fff;
    }

    .nav-label {
      display: none;
      font-size: 13px;
      font-weight: 500;
    }
  }


}

@keyframes sponsor-pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 0 2px var(--sidebar-bg, transparent), 0 0 0 0 rgba(244, 63, 94, 0.6);
  }
  50% {
    transform: scale(1.15);
    box-shadow: 0 0 0 2px var(--sidebar-bg, transparent), 0 0 0 6px rgba(244, 63, 94, 0);
  }
}

@keyframes sponsor-breathe {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.9; }
}

// 打赏气泡：向上漂 + 淡入淡出（4s 循环）
@keyframes bubble-pop {
  0% { transform: translateY(8px) scale(0.6); opacity: 0; }
  15% { transform: translateY(0) scale(1); opacity: 1; }
  75% { transform: translateY(-4px) scale(1); opacity: 1; }
  100% { transform: translateY(-12px) scale(0.9); opacity: 0; }
}

// 气泡切换的过渡（备用，setInterval 已经触发 key 切换）
.bubble-enter-active,
.bubble-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.bubble-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.8);
}
.bubble-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.8);
}

// ---- Main Area ----
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .content {
    flex: 1;
    background: $bg-base;
    padding: 0;
    overflow-y: auto;
  }
}

.header {
  height: 48px;
  background: rgba($overlay-rgb, 0.02);
  border-bottom: 1px solid $border;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;

  .breadcrumb {
    color: $text-primary;
    font-size: 15px;
    font-weight: 600;
  }

  .header-right {
    // 主题切换已移至 sidebar-bottom（保留 flex 以备未来扩展）
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

// 主题切换按钮：sidebar 底部，胶囊形状，「图标 + 当前模式 + 提示」
.sidebar .sidebar-bottom .theme-toggle {
  width: 36px;
  height: 36px;
  margin: 0 auto 8px;
  border: 1px solid $border;
  border-radius: 18px;
  background: var(--sidebar-theme-toggle-bg, rgba($overlay-rgb, 0.05));
  color: $text-secondary;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: $transition-base;
  position: relative;
  overflow: hidden;

  &:hover {
    background: var(--sidebar-theme-toggle-hover-bg, rgba($brand-start, 0.12));
    color: $brand-start;
    border-color: rgba($brand-start, 0.3);
    transform: translateY(-1px);
  }

  .theme-label,
  .theme-hint { display: none; }

  // 展开态：胶囊变宽,显模式名 + 「点击切换」提示
  &.expanded {
    width: 100%;
    height: 40px;
    padding: 0 12px;
    justify-content: flex-start;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 10px;

    .theme-label {
      display: inline;
      flex: 1;
      text-align: left;
      letter-spacing: 0.02em;
    }
    .theme-hint {
      display: inline;
      font-size: 11px;
      color: $text-muted;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba($overlay-rgb, 0.06);
    }
    &:hover .theme-hint {
      background: rgba($brand-start, 0.15);
      color: $brand-start;
    }
  }
}
// 暗色模式下的微调
html.dark .sidebar .sidebar-bottom .theme-toggle {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);

  &:hover {
    background: rgba($brand-start, 0.18);
    border-color: rgba($brand-start, 0.4);
  }

  .theme-hint { background: rgba(255, 255, 255, 0.06); }
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
