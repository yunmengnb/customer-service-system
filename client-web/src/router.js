import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/c/:token',
    name: 'chat',
    component: () => import('./views/ChatPage.vue'),
  },
  {
    path: '/',
    redirect: '/c/default',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
