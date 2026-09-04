<!-- 忆梦云团队开发 - 移动端：底部 4 Tab + 企业微信风格 -->
<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const user = JSON.parse(sessionStorage.getItem('tenant_user') || localStorage.getItem('tenant_user') || 'null')
const tenant = JSON.parse(sessionStorage.getItem('tenant_info') || localStorage.getItem('tenant_info') || 'null')
const showLogoutConfirm = ref(false)

const tabs = computed(() => [
  { path: '/m/messages', icon: '💬', activeIcon: '💬', label: '消息', badge: 0 },
  { path: '/m/channels', icon: '🔗', label: '授权渠道', badge: 0 },
  ...(['owner', 'admin'].includes(user?.role)
    ? [{ path: '/m/employees', icon: '👥', label: '员工', badge: 0 }]
    : []),
  { path: '/me', icon: '👤', label: '我的', badge: 0 },
])

const current = computed(() => tabs.value.find(t => route.path === t.path) || tabs.value[0])

function go(tab) {
  if (tab.path === '/me') {
    showLogoutConfirm.value = true
    return
  }
  if (route.path !== tab.path) {
    router.push(tab.path)
  }
}

function logout() {
  showLogoutConfirm.value = false
  const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
  storage.removeItem('tenant_token')
  storage.removeItem('tenant_user')
  storage.removeItem('tenant_info')
  router.push('/login')
}

function activeIcon(tab) {
  // 消息 Tab 可以区分图标
  return tab.icon
}
</script>

<template>
  <div class="mob-app">
    <!-- 顶部状态栏 -->
    <header class="mob-header">
      <div class="mob-header-title">{{ current.label }}</div>
      <div class="mob-header-right">
        <span class="mob-header-brand">{{ tenant?.name }}</span>
      </div>
    </header>

    <!-- 内容 slot -->
    <main class="mob-content">
      <router-view />
    </main>

    <!-- 底部 Tab 栏：安全区适配 -->
    <nav class="mob-tabbar">
      <div
        v-for="tab in tabs"
        :key="tab.path"
        class="mob-tab"
        :class="{ 'is-active': current.path === tab.path }"
        @click="go(tab)"
      >
        <div class="mob-tab-icon">{{ activeIcon(tab) }}</div>
        <div class="mob-tab-label">{{ tab.label }}</div>
        <div v-if="tab.badge > 0" class="mob-tab-badge">{{ tab.badge > 99 ? '99+' : tab.badge }}</div>
      </div>
    </nav>

    <ConfirmDialog
      :open="showLogoutConfirm"
      title="退出登录"
      message="确认退出当前账号吗？退出后需要重新登录。"
      confirm-text="确认退出"
      danger
      @confirm="logout"
      @cancel="showLogoutConfirm = false"
    />
  </div>
</template>

<style scoped>
.mob-app {
  display: flex; flex-direction: column; height: 100vh;
  background: #f5f6f8;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #0f172a; max-width: 480px; margin: 0 auto;
}

/* 顶部状态栏：仿企业微信 */
.mob-header {
  height: 52px; background: #fff;
  border-bottom: 1px solid #eceff1;
  display: flex; align-items: center; padding: 0 16px;
  flex-shrink: 0;
  padding-top: env(safe-area-inset-top, 0);
}
.mob-header-title {
  font-size: 17px; font-weight: 600; color: #0f172a; flex: 1; text-align: center;
}
.mob-header-right {
  position: absolute; right: 16px; top: calc(env(safe-area-inset-top, 0) + 16px);
}
.mob-header-brand { font-size: 12px; color: #64748b; }

/* 内容 */
.mob-content {
  flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding-bottom: calc(60px + env(safe-area-inset-bottom, 0));
}

/* 底部 Tab */
.mob-tabbar {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: 0; width: 100%; max-width: 480px;
  height: calc(60px + env(safe-area-inset-bottom, 0));
  background: #fff;
  border-top: 1px solid #eceff1;
  display: flex; padding-bottom: env(safe-area-inset-bottom, 0);
  z-index: 50;
  box-shadow: 0 -2px 12px rgba(0,0,0,.04);
}
.mob-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; cursor: pointer; position: relative;
  transition: color .15s;
  padding-top: 4px;
}
.mob-tab-icon { font-size: 22px; line-height: 1; transition: transform .15s; }
.mob-tab-label { font-size: 11px; color: #94a3b8; font-weight: 500; }
.mob-tab.is-active .mob-tab-icon { transform: scale(1.05); }
.mob-tab.is-active .mob-tab-label { color: #2563eb; font-weight: 600; }
.mob-tab.is-active { color: #2563eb; }

/* 未读红点 */
.mob-tab-badge {
  position: absolute; top: 4px; min-width: 18px; height: 18px;
  background: #ef4444; color: #fff; font-size: 10px; font-weight: 600;
  border-radius: 9px; padding: 0 5px; line-height: 18px; text-align: center;
  border: 2px solid #fff;
}
</style>
