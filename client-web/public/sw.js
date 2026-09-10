// 忆梦云团队开发
const CACHE_NAME = 'client-web-shell-v3'
const APP_SHELL = ['/account', '/', '/favicon.svg', '/pwa-192.png', '/pwa-512.png', '/manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => !PRESERVED_CACHES.has(key)).map(key => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(response => response || caches.match('/account'))))
})
