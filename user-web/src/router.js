// 忆梦云团队开发 - 桌面端与手机端独立路由及旧 URL 兼容跳转
import { createRouter, createWebHistory } from 'vue-router'

const MOBILE_BREAKPOINT = 768
const desktopPrefix = '/desktop'
const mobilePrefix = '/m'
const publicPaths = new Set(['/login', '/register'])

const devicePrefix = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ? mobilePrefix : desktopPrefix

function normalizeLegacyPath(path) {
  if (path === '/') return '/messages'
  return path
}

function mapPathToDevice(path, prefix = devicePrefix()) {
  const normalized = normalizeLegacyPath(path)
  if (normalized === desktopPrefix || normalized === mobilePrefix) return `${prefix}/messages`
  if (normalized.startsWith(`${desktopPrefix}/`)) return `${prefix}${normalized.slice(desktopPrefix.length)}`
  if (normalized.startsWith(`${mobilePrefix}/`)) return `${prefix}${normalized.slice(mobilePrefix.length)}`
  return `${prefix}${normalized}`
}

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/register', component: () => import('./views/Register.vue'), meta: { public: true } },
  {
    path: '/employee-login',
    component: { template: '<div></div>' },
    beforeEnter: (to) => {
      const key = String(to.query.key || '')
      const raw = key ? localStorage.getItem(key) : null
      if (!raw) return '/login'

      localStorage.removeItem(key)
      const data = JSON.parse(raw)
      sessionStorage.setItem('tenant_token', data.token)
      sessionStorage.setItem('tenant_user', JSON.stringify(data.user))
      sessionStorage.setItem('tenant_info', JSON.stringify(data.tenant))
      return `${devicePrefix()}/messages`
    },
  },

  {
    path: desktopPrefix,
    component: () => import('./views/Layout.vue'),
    meta: { device: 'desktop' },
    children: [
      { path: '', redirect: `${desktopPrefix}/messages` },
      { path: 'messages', component: () => import('./views/desktop/Messages.vue') },
      { path: 'channels', component: () => import('./views/desktop/Channels.vue') },
      { path: 'announcements', component: () => import('./views/desktop/Announcements.vue') },
      { path: 'announcements/:id', component: () => import('./views/AnnouncementDetail.vue') },
      { path: 'employees', component: () => import('./views/desktop/Agents.vue'), meta: { adminOnly: true } },
      { path: 'profile', component: () => import('./views/desktop/Profile.vue') },
    ],
  },
  { path: `${desktopPrefix}/messages/:id`, component: () => import('./views/desktop/ChatRoom.vue'), meta: { device: 'desktop', standalone: true } },
  { path: `${desktopPrefix}/channels/:id`, component: () => import('./views/desktop/ChannelDetail.vue'), meta: { device: 'desktop', standalone: true } },

  {
    path: mobilePrefix,
    component: () => import('./views/MobileLayout.vue'),
    meta: { device: 'mobile' },
    children: [
      { path: '', redirect: `${mobilePrefix}/messages` },
      { path: 'messages', component: () => import('./views/mobile/Messages.vue') },
      { path: 'channels', component: () => import('./views/mobile/Channels.vue') },
      { path: 'announcements', component: () => import('./views/mobile/Announcements.vue') },
      { path: 'announcements/:id', component: () => import('./views/AnnouncementDetail.vue') },
      { path: 'profile', component: () => import('./views/mobile/Profile.vue') },
      { path: 'profile/about', component: () => import('./views/mobile/About.vue') },
      { path: 'employees', component: () => import('./views/mobile/Agents.vue'), meta: { adminOnly: true } },
    ],
  },
  { path: `${mobilePrefix}/messages/:id`, component: () => import('./views/mobile/ChatRoom.vue'), meta: { device: 'mobile', standalone: true } },
  { path: `${mobilePrefix}/channels/:id`, component: () => import('./views/mobile/ChannelDetail.vue'), meta: { device: 'mobile', standalone: true } },
  { path: `${mobilePrefix}/profile/edit`, component: () => import('./views/mobile/ProfileEdit.vue'), meta: { device: 'mobile', standalone: true } },

  // 原 URL 保持可访问，并按当前设备跳转到新的独立页面文件。
  ...['/messages', '/messages/:id', '/channels', '/channels/:id', '/announcements', '/announcements/:id', '/employees', '/profile'].map((path) => ({
    path,
    redirect: (to) => ({
      path: mapPathToDevice(to.path),
      query: to.query,
      hash: to.hash,
    }),
  })),
  {
    path: '/:pathMatch(.*)*',
    redirect: () => `${devicePrefix()}/messages`,
  },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const isPublic = publicPaths.has(to.path)
  const token = sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token')
  if (!isPublic && !token) return { path: '/login', query: { redirect: to.fullPath } }
  if (isPublic) return true

  const user = JSON.parse(sessionStorage.getItem('tenant_user') || localStorage.getItem('tenant_user') || 'null')
  if (to.matched.some((record) => record.meta.adminOnly) && !['owner', 'admin'].includes(user?.role)) {
    return { path: `${devicePrefix()}/messages`, replace: true }
  }

  const expectedDevice = devicePrefix() === mobilePrefix ? 'mobile' : 'desktop'
  const routeDevice = to.matched.find((record) => record.meta.device)?.meta.device
  if (routeDevice && routeDevice !== expectedDevice) {
    return { path: mapPathToDevice(to.path), query: to.query, hash: to.hash, replace: true }
  }
  return true
})

export { mapPathToDevice }
export default router