// 忆梦云团队开发
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/c/:token',
    name: 'chat',
    component: () => import('./views/ChatPage.vue'),
  },
  {
    path: '/account',
    name: 'account',
    component: () => import('./views/AccountPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/',
    redirect: () => localStorage.getItem('client_token') ? '/account' : '/c/default',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(to => {
  if (to.meta.requiresAuth && !localStorage.getItem('client_token')) return '/'
})

export default router
