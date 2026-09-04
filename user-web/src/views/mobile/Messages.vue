<!-- 忆梦云团队开发 - 手机端消息列表 -->
<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { io } from 'socket.io-client'
import api from '../../api'

const router = useRouter()
const conversations = ref([])
const loading = ref(true)
const filter = ref('all')
const search = ref('')
let socket = null
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

const filteredConversations = computed(() => {
  let list = conversations.value
  if (filter.value !== 'all') list = list.filter((conversation) => conversation.status === filter.value)
  if (search.value.trim()) {
    const keyword = search.value.trim()
    list = list.filter((conversation) =>
      conversation.customer?.phone?.includes(keyword) ||
      conversation.customer?.qq?.includes(keyword) ||
      conversation.channel?.name?.includes(keyword),
    )
  }
  return list
})

async function loadConversations() {
  try {
    const res = await api.get('/tenant/conversations')
    if (res.code === 0) conversations.value = res.data.items
  } catch (error) {
    console.error(error)
  } finally {
    loading.value = false
  }
}

function setupSocket() {
  const token = sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token')
  if (!token) return
  socket = io({ auth: { token, type: 'tenant_user' }, transports: ['websocket', 'polling'] })
  ;['conversation.created', 'conversation.accepted', 'conversation.updated']
    .forEach((event) => socket.on(event, loadConversations))
  socket.on('message.new', handleNewMessage)
}

function handleNewMessage(message) {
  if (message.senderType === 'customer') playNotificationSound()
  const conversationId = String(message.conversationId?._id || message.conversationId || '')
  const index = conversations.value.findIndex((conversation) => String(conversation._id) === conversationId)
  if (index !== -1) {
    const [conversation] = conversations.value.splice(index, 1)
    conversations.value.unshift({
      ...conversation,
      lastMessage: message,
      lastMessageAt: message.createdAt || new Date().toISOString(),
    })
  }
  loadConversations()
}

function openConversation(id) {
  router.push(`/m/messages/${id}`)
}

function formatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  return date.toDateString() === now.toDateString()
    ? date.toTimeString().slice(0, 5)
    : `${date.getMonth() + 1}/${date.getDate()}`
}

function statusTag(status) {
  if (status === 'active') return { text: '处理中', cls: 'active' }
  if (status === 'waiting') return { text: '待接入', cls: 'waiting' }
  return { text: '已结束', cls: 'closed' }
}

function latestMessageText(message) {
  if (!message) return '暂无消息'
  if (message.messageType === 'image') return '[图片]'
  if (message.messageType === 'file') return `[文件]${message.attachmentName ? ` ${message.attachmentName}` : ''}`
  if (message.messageType === 'system' || message.senderType === 'system') return message.content || '系统消息'
  return message.content || '暂无消息'
}

function avatarColor(id) {
  const first = id?.charCodeAt(0) || 0
  const second = id?.charCodeAt(1) || 0
  const hue = (first * 7 + second * 11) % 360
  return `linear-gradient(135deg, hsl(${hue},65%,58%), hsl(${(hue + 30) % 360},60%,42%))`
}

onMounted(() => {
  window.addEventListener('pointerdown', unlockNotificationSound, { once: true })
  window.addEventListener('keydown', unlockNotificationSound, { once: true })
  loadConversations()
  setupSocket()
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', unlockNotificationSound)
  window.removeEventListener('keydown', unlockNotificationSound)
  socket?.disconnect()
  notificationAudioContext?.close().catch(() => {})
})
</script>

<template>
  <section class="mobile-messages">
    <div class="mobile-tools">
      <input v-model="search" type="search" placeholder="搜索手机号或渠道" aria-label="搜索会话" />
      <div class="mobile-filters" aria-label="会话筛选">
        <button
          v-for="item in [{ key: 'all', label: '全部' }, { key: 'waiting', label: '待接入' }, { key: 'active', label: '处理中' }, { key: 'closed', label: '已结束' }]"
          :key="item.key"
          :class="{ active: filter === item.key }"
          @click="filter = item.key"
        >{{ item.label }}</button>
      </div>
    </div>

    <div v-if="loading" class="mobile-state">加载中...</div>
    <div v-else-if="filteredConversations.length" class="mobile-list">
      <button
        v-for="conversation in filteredConversations"
        :key="conversation._id"
        class="mobile-item"
        @click="openConversation(conversation._id)"
      >
        <img v-if="conversation.customer?.avatarUrl" class="mobile-avatar" :src="conversation.customer.avatarUrl" alt="客户QQ头像" />
        <span v-else class="mobile-avatar" :style="{ background: avatarColor(conversation._id) }">
          {{ conversation.customer?.phone?.slice(-1) || '客' }}
        </span>
        <span class="mobile-body">
          <span class="mobile-row">
            <span class="mobile-name">
              {{ conversation.customer?.qq ? `QQ ${conversation.customer.qq}` : (conversation.customer?.phone ? `*${conversation.customer.phone.slice(-4)}` : '访客') }}
              <span class="mobile-status" :class="statusTag(conversation.status).cls">{{ statusTag(conversation.status).text }}</span>
            </span>
            <span class="mobile-time">{{ formatTime(conversation.lastMessageAt) }}</span>
          </span>
          <span class="mobile-row mobile-summary">
            <span class="mobile-last">{{ latestMessageText(conversation.lastMessage) }}</span>
            <span v-if="conversation.agentUnreadCount > 0" class="mobile-unread">{{ conversation.agentUnreadCount }}</span>
          </span>
          <span class="mobile-channel">
            <span v-if="conversation.customer?.email">{{ conversation.customer.email }}</span>
            <span v-if="conversation.customer?.email && conversation.channel?.name"> · </span>
            <span v-if="conversation.channel?.name">{{ conversation.channel.name }}</span>
          </span>
        </span>
      </button>
    </div>
    <div v-else class="mobile-state">暂无会话</div>
  </section>
</template>

<style scoped>
.mobile-messages { min-height: 100%; background: #fff; }
.mobile-tools { position: sticky; top: 0; z-index: 2; padding: 12px 16px 10px; background: rgba(255,255,255,.96); border-bottom: 1px solid #f1f5f9; backdrop-filter: blur(12px); }
.mobile-tools input { width: 100%; min-height: 42px; padding: 0 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; color: #0f172a; font-size: 14px; outline: none; }
.mobile-tools input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); background: #fff; }
.mobile-filters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
.mobile-filters button { min-height: 34px; border: 0; border-radius: 9px; background: #f1f5f9; color: #64748b; font-size: 12px; }
.mobile-filters button.active { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
.mobile-item { display: flex; width: 100%; gap: 12px; padding: 14px 16px; border: 0; border-bottom: 1px solid #f1f5f9; background: #fff; text-align: left; color: inherit; }
.mobile-item:active { background: #f8fafc; }
.mobile-avatar { width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto; display: grid; place-items: center; color: #fff; font-size: 18px; font-weight: 700; object-fit: cover; }
.mobile-body { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.mobile-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mobile-name { min-width: 0; display: flex; align-items: center; gap: 6px; color: #0f172a; font-size: 14px; font-weight: 700; }
.mobile-status { padding: 2px 6px; border-radius: 999px; font-size: 10px; white-space: nowrap; }
.mobile-status.waiting { background: #dbeafe; color: #2563eb; }
.mobile-status.active { background: #dcfce7; color: #15803d; }
.mobile-status.closed { background: #f1f5f9; color: #64748b; }
.mobile-time, .mobile-channel { color: #94a3b8; font-size: 11px; }
.mobile-summary { margin-top: 5px; }
.mobile-last { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; font-size: 13px; }
.mobile-unread { min-width: 20px; padding: 2px 6px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 10px; font-weight: 700; text-align: center; }
.mobile-channel { margin-top: 5px; }
.mobile-state { padding: 64px 20px; color: #94a3b8; text-align: center; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
