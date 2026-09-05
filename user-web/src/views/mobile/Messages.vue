<!-- 忆梦云团队开发 - 手机端消息列表 -->
<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { io } from 'socket.io-client'
import api from '../../api'

const router = useRouter()
const conversations = ref([])
const loading = ref(true)
const filter = ref('all')
const search = ref('')
const searching = ref(false)
const searchDialog = ref(null)
const searchResults = ref([])
const searchResultsLoading = ref(false)
let searchTimer = null
let requestSequence = 0
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
  return list
})

async function loadConversations() {
  const sequence = ++requestSequence
  const keyword = search.value.trim()
  if (keyword) searching.value = true
  try {
    const res = await api.get('/tenant/conversations', {
      params: { limit: 100, keyword: keyword || undefined },
    })
    if (sequence === requestSequence && res.code === 0) conversations.value = res.data.items
  } catch (error) {
    console.error(error)
  } finally {
    if (sequence === requestSequence) {
      loading.value = false
      searching.value = false
    }
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadConversations, 300)
})

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

function openConversation(conversation) {
  if (search.value.trim() && conversation.searchMatch) {
    openSearchMatches(conversation)
    return
  }
  router.push(`/m/messages/${conversation._id}`)
}

async function openSearchMatches(conversation) {
  searchDialog.value = conversation
  searchResults.value = []
  searchResultsLoading.value = true
  try {
    const res = await api.get(`/tenant/conversations/${conversation._id}/messages/search`, {
      params: { keyword: search.value.trim() },
    })
    if (res.code === 0 && searchDialog.value?._id === conversation._id) {
      searchResults.value = res.data.items || []
    }
  } catch (error) {
    console.error(error)
  } finally {
    searchResultsLoading.value = false
  }
}

function locateSearchMessage(message) {
  router.push({
    path: `/m/messages/${searchDialog.value._id}`,
    query: { message: message._id },
  })
}

function senderName(message) {
  if (message.senderType === 'customer') return '客户'
  if (message.senderType === 'bot') return '机器人'
  if (message.senderType === 'system') return '系统'
  return '客服'
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
  clearTimeout(searchTimer)
  socket?.disconnect()
  notificationAudioContext?.close().catch(() => {})
})
</script>

<template>
  <section class="mobile-messages">
    <div class="mobile-tools">
      <input v-model="search" type="search" placeholder="搜索客户、渠道或聊天内容" aria-label="搜索会话和聊天内容" />
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
        @click="openConversation(conversation)"
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
            <span class="mobile-last">{{ conversation.searchMatch ? latestMessageText(conversation.searchMatch.message) : latestMessageText(conversation.lastMessage) }}</span>
            <span v-if="conversation.searchMatch" class="mobile-match-count">{{ conversation.searchMatch.count }}条相关</span>
            <span v-else-if="conversation.agentUnreadCount > 0" class="mobile-unread">{{ conversation.agentUnreadCount }}</span>
          </span>
          <span v-if="conversation.channel?.name" class="mobile-channel">
            {{ conversation.channel.name }}
          </span>
        </span>
      </button>
    </div>
    <div v-else class="mobile-state">{{ searching ? '正在搜索...' : (search.trim() ? '没有找到相关聊天记录' : '暂无会话') }}</div>

    <div v-if="searchDialog" class="mobile-search-mask">
      <section class="mobile-search-dialog" role="dialog" aria-modal="true" aria-label="相关聊天内容">
        <header>
          <button type="button" aria-label="返回" @click="searchDialog = null">‹</button>
          <div><strong>相关聊天内容</strong><span>{{ searchDialog.searchMatch?.count || 0 }} 条结果</span></div>
          <i></i>
        </header>
        <div class="mobile-search-keyword">搜索“{{ search }}”</div>
        <div v-if="searchResultsLoading" class="mobile-state">正在加载...</div>
        <div v-else-if="searchResults.length" class="mobile-search-results">
          <button v-for="message in searchResults" :key="message._id" @click="locateSearchMessage(message)">
            <span class="mobile-search-meta"><b>{{ senderName(message) }}</b><time>{{ formatTime(message.createdAt) }}</time></span>
            <span class="mobile-search-content">{{ latestMessageText(message) }}</span>
            <span class="mobile-search-locate">定位到聊天位置 →</span>
          </button>
        </div>
        <div v-else class="mobile-state">没有找到相关内容</div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.mobile-messages { min-height: 100%; background: #fff; }
.mobile-tools { padding: 12px 16px 10px; background: rgba(255,255,255,.96); border-bottom: 1px solid #f1f5f9; backdrop-filter: blur(12px); }
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
.mobile-match-count { flex: 0 0 auto; color: #2563eb; font-size: 11px; font-weight: 600; }
.mobile-channel { margin-top: 5px; }
.mobile-state { padding: 64px 20px; color: #94a3b8; text-align: center; }
.mobile-search-mask { position: fixed; inset: 0; z-index: 1200; background: #fff; }
.mobile-search-dialog { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.mobile-search-dialog header { min-height: 58px; display: grid; grid-template-columns: 42px 1fr 42px; align-items: center; padding: env(safe-area-inset-top) 10px 0; border-bottom: 1px solid #e2e8f0; }
.mobile-search-dialog header button { border: 0; background: transparent; color: #2563eb; font-size: 32px; }
.mobile-search-dialog header div { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mobile-search-dialog header strong { color: #0f172a; font-size: 16px; }
.mobile-search-dialog header span, .mobile-search-keyword { color: #64748b; font-size: 11px; }
.mobile-search-keyword { padding: 10px 16px; background: #f8fafc; }
.mobile-search-results { flex: 1; overflow-y: auto; padding-bottom: env(safe-area-inset-bottom); }
.mobile-search-results > button { display: flex; width: 100%; flex-direction: column; gap: 8px; padding: 15px 16px; border: 0; border-bottom: 1px solid #f1f5f9; background: #fff; text-align: left; }
.mobile-search-results > button:active { background: #f8fafc; }
.mobile-search-meta { display: flex; justify-content: space-between; color: #94a3b8; font-size: 11px; }
.mobile-search-meta b { color: #475569; }
.mobile-search-content { color: #0f172a; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.mobile-search-locate { align-self: flex-end; color: #2563eb; font-size: 11px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
