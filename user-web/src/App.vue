<!-- 忆梦云团队开发 - 路由根组件，负责跨路由客户消息铃声 -->
<script setup>
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { io } from 'socket.io-client'

const route = useRoute()
let socket = null
let socketToken = null
let notificationAudioContext = null

function getNotificationAudioContext() {
  if (!notificationAudioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (AudioContext) notificationAudioContext = new AudioContext()
  }
  return notificationAudioContext
}

async function unlockNotificationSound() {
  const context = getNotificationAudioContext()
  if (context?.state === 'suspended') await context.resume().catch(() => {})
}

function playNotificationSound() {
  const context = getNotificationAudioContext()
  if (!context || context.state !== 'running') return
  const start = context.currentTime
  ;[
    { delay: 0, frequency: 1320 },
    { delay: 0.14, frequency: 1760 },
    { delay: 0.3, frequency: 1480 },
  ].forEach(({ delay, frequency }) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(frequency, start + delay)
    gain.gain.setValueAtTime(0.0001, start + delay)
    gain.gain.exponentialRampToValueAtTime(0.7, start + delay + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.13)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start + delay)
    oscillator.stop(start + delay + 0.14)
  })
}

function setupNotificationSocket() {
  const token = sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token')
  if (!token) {
    socket?.disconnect()
    socket = null
    socketToken = null
    return
  }
  if (socket && socketToken === token) return
  socket?.disconnect()
  socketToken = token
  socket = io({ auth: { token, type: 'tenant_user' }, transports: ['polling', 'websocket'] })
  socket.on('message.new', (message) => {
    if (message.senderType === 'customer') playNotificationSound()
  })
}

watch(() => route.fullPath, setupNotificationSocket)

onMounted(() => {
  window.addEventListener('pointerdown', unlockNotificationSound, { passive: true })
  window.addEventListener('keydown', unlockNotificationSound)
  setupNotificationSocket()
})

onUnmounted(() => {
  socket?.disconnect()
  notificationAudioContext?.close().catch(() => {})
  window.removeEventListener('pointerdown', unlockNotificationSound)
  window.removeEventListener('keydown', unlockNotificationSound)
})
</script>

<template>
  <router-view />
</template>
