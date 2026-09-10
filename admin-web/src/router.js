// 忆梦云团队开发 - 管理端路由
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/login', component: () => import('./views/Login.vue') },
  {
    path: '/',
    component: () => import('./views/Layout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', component: () => import('./views/Dashboard.vue') },
      { path: 'tenants', component: () => import('./views/Tenants.vue') },
      { path: 'customers', component: () => import('./views/Customers.vue') },
      { path: 'conversations', component: () => import('./views/Conversations.vue') },
      { path: 'complaints', component: () => import('./views/Complaints.vue') },
      { path: 'announcements', component: () => import('./views/Announcements.vue') },
      { path: 'apps', component: () => import('./views/AppManagement.vue') },
      { path: 'settings', component: () => import('./views/Settings.vue') },
      { path: 'version', component: () => import('./views/Version.vue') },
      { path: 'profile', component: () => import('./views/Profile.vue') },
    ],
  },
]

const router = createRouter({ history: createWebHistory(), routes })

function isSuperAdmin() {
  try { return JSON.parse(localStorage.getItem('admin_info') || '{}').role === 'super' } catch { return false }
}

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('admin_token')
  if (to.path !== '/login' && !token) next('/login')
  else if (to.path === '/login' && token) next('/dashboard')
  else if (to.path === '/settings' && !isSuperAdmin()) next('/dashboard')
  else next()
})

export default router