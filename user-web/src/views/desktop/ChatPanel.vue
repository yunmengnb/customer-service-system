<!-- 忆梦云团队开发 - 桌面端聊天展示组件独立实现 -->
<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { io } from 'socket.io-client'
import api from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

const props = defineProps({
  conversationId: { type: String, default: null },
  targetMessageId: { type: String, default: null },
})
const emit = defineEmits(['back', 'conversation-read', 'message-located'])

const conversation = ref(null)
const messages = ref([])
const quickReplies = ref([])
const input = ref('')
const sending = ref(false)
const accepted = ref(false)
const loading = ref(false)
const customerOnline = ref(false)
const msgContainer = ref(null)
const loadingHistory = ref(false)
const hasMoreMessages = ref(true)
let socket = null
let messageSyncTimer = null
let messageSyncInFlight = false

const uploading = ref(false)
const showInfo = ref(false)
const showMore = ref(false)
const showQuickReplies = ref(false)
const sendingQuickReplyId = ref(null)
const showCloseConfirm = ref(false)
const closing = ref(false)
const confirmAction = ref(null)
const actionSubmitting = ref(false)
const preview = ref(null)
const contextMenu = ref(null)
const downloadProgress = ref(null)
const toast = ref('')
let toastTimer = null
let longPressTimer = null
let longPressStart = null
let suppressBubbleClickUntil = 0

const currentUserId = JSON.parse(sessionStorage.getItem('tenant_user') || localStorage.getItem('tenant_user') || 'null')?._id
const canDeleteMessage = (msg) => msg.senderType !== 'system' && msg._id
const canRecallMessage = (msg) => (
  msg.senderType === 'agent' &&
  String(msg.senderId?._id || msg.senderId) === String(currentUserId) &&
  !msg.recalledAt &&
  Date.now() - new Date(msg.createdAt).getTime() <= 2 * 60 * 1000
)

async function loadConversation() {
  if (!props.conversationId) { conversation.value = null; return }
  try {
    const res = await api.get(`/tenant/conversations/${props.conversationId}`)
    if (res.code === 0) {
      conversation.value = res.data
      accepted.value = res.data.status !== 'waiting'
    } else { conversation.value = null }
  } catch { conversation.value = null }
}

async function loadMessages() {
  if (!props.conversationId) return
  try {
    const params = props.targetMessageId
      ? { limit: 100, around: props.targetMessageId }
      : { limit: 50 }
    const res = await api.get(`/tenant/conversations/${props.conversationId}/messages`, { params })
    if (res.code === 0) {
      messages.value = res.data || []
      hasMoreMessages.value = props.targetMessageId ? true : messages.value.length >= 50
      emit('conversation-read', props.conversationId)
      if (props.targetMessageId) await locateMessage(props.targetMessageId)
      else await scrollToLatest()
    }
  } catch {}
}

async function locateMessage(messageId) {
  await nextTick()
  const element = msgContainer.value?.querySelector(`[data-message-id="${messageId}"]`)
  if (!element) return
  element.scrollIntoView({ block: 'center' })
  element.classList.add('cp-message-highlight')
  setTimeout(() => element.classList.remove('cp-message-highlight'), 2200)
  emit('message-located', messageId)
}

async function loadPreviousMessages() {
  if (loadingHistory.value || !hasMoreMessages.value || !messages.value.length) return
  const firstMessage = messages.value.find(message => message._id)
  if (!firstMessage) return
  loadingHistory.value = true
  const container = msgContainer.value
  const previousHeight = container?.scrollHeight || 0
  try {
    const res = await api.get(`/tenant/conversations/${props.conversationId}/messages`, {
      params: { limit: 50, before: firstMessage._id },
    })
    if (res.code === 0) {
      const olderMessages = res.data || []
      const existingIds = new Set(messages.value.map(message => String(message._id)))
      messages.value = [...olderMessages.filter(message => !existingIds.has(String(message._id))), ...messages.value]
      hasMoreMessages.value = olderMessages.length === 50
      await nextTick()
      if (container) container.scrollTop = container.scrollHeight - previousHeight
    }
  } finally {
    loadingHistory.value = false
  }
}

function handleMessageScroll() {
  cancelLongPress()
  if ((msgContainer.value?.scrollTop || 0) <= 24) loadPreviousMessages()
}

async function loadQuickReplies() {
  if (!conversation.value) return
  try {
    const res = await api.get(`/tenant/channels/${conversation.value.channelId}/quick-replies`)
    if (res.code === 0) quickReplies.value = res.data.filter(q => q.status === 'active')
  } catch {}
}

async function accept() {
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/accept`)
    if (res.code === 0) {
      accepted.value = true
      conversation.value.status = 'active'
    } else alert(res.message)
  } catch (e) { alert(e?.message || '接入失败') }
}

function mergeMessage(message) {
  if (!message) return
  const index = messages.value.findIndex(item =>
    String(item._id) === String(message._id) ||
    (item.clientMessageId && item.clientMessageId === message.clientMessageId)
  )
  if (index >= 0) messages.value[index] = message
  else messages.value.push(message)
}

async function syncLatestMessages() {
  const conversationId = props.conversationId
  if (!conversationId || messageSyncInFlight) return
  messageSyncInFlight = true
  try {
    const res = await api.get(`/tenant/conversations/${conversationId}/messages`, { params: { limit: 50 } })
    if (res.code === 0 && String(conversationId) === String(props.conversationId)) {
      ;(res.data || []).forEach(mergeMessage)
      emit('conversation-read', conversationId)
    }
  } catch {}
  finally { messageSyncInFlight = false }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') syncLatestMessages()
}

async function sendMsg() {
  if (!input.value.trim() || sending.value) return
  if (!accepted.value) { alert('请先接入会话'); return }
  sending.value = true
  const text = input.value.trim(); input.value = ''
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/messages`, {
      content: text, clientMessageId: 'a_' + Date.now(),
    })
    if (res.code === 0) { mergeMessage(res.data); await scrollToLatest() }
  } catch (e) { input.value = text; alert(e?.message || '发送失败') }
  finally { sending.value = false }
}

async function runCustomerAction() {
  if (!confirmAction.value || actionSubmitting.value) return
  actionSubmitting.value = true
  try {
    const type = confirmAction.value
    if (type === 'clear') {
      const res = await api.delete(`/tenant/conversations/${props.conversationId}/messages`)
      if (res.code === 0) messages.value = []
    } else {
      const field = type === 'block' ? 'blocked' : 'messageReceivingDisabled'
      const current = Boolean(conversation.value.customer?.[field])
      const res = await api.patch(`/tenant/conversations/${props.conversationId}/customer-settings`, { [field]: !current })
      if (res.code === 0) Object.assign(conversation.value.customer, res.data)
    }
    showToast('操作成功')
    confirmAction.value = null
  } catch (e) { showToast(e?.message || '操作失败') }
  finally { actionSubmitting.value = false }
}

async function close() {
  if (closing.value) return
  closing.value = true
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/close`)
    if (res.code === 0) {
      conversation.value.status = 'closed'
      showCloseConfirm.value = false
    }
  } catch {}
  finally { closing.value = false }
}

async function handleUpload(ev) {
  const file = ev.target.files?.[0]
  if (!file) return
  if (!accepted.value) { alert('请先接入会话'); return }
  uploading.value = true
  const fd = new FormData(); fd.append('file', file)
  try {
    const res = await api.upload('/upload/tenant', fd)
    if (res.code === 0) {
      const fi = res.data
      const mediaType = fi.isImage ? 'image' : (fi.mimetype?.startsWith('video/') ? 'video' : 'file')
      const body = {
        messageType: mediaType,
        content: mediaType === 'image' ? '' : (mediaType === 'video' ? fi.url : ''),
        attachmentUrl: fi.url, attachmentName: fi.name,
        thumbnailUrl: fi.thumbnailUrl || '',
        clientMessageId: 'up_' + Date.now(),
      }
      const sr = await api.post(`/tenant/conversations/${props.conversationId}/messages`, body)
      if (sr.code === 0) { mergeMessage(sr.data); await scrollToLatest() }
    } else alert(res.message || '上传失败')
  } catch (e) { alert(e?.message || '上传失败') }
  finally { uploading.value = false; ev.target.value = '' }
}

function setupSocket() {
  socket?.disconnect()
  const token = sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token')
  if (!token) return
  socket = io({ auth: { token, type: 'tenant_user' }, transports: ['polling', 'websocket'] })
  socket.on('connect', () => {
    syncLatestMessages()
    const customerId = conversation.value?.customer?._id
    if (customerId) socket.emit('presence:query', { type: 'customer', userId: customerId }, ({ online } = {}) => { customerOnline.value = Boolean(online) })
  })
  socket.on('presence:changed', (data) => {
    if (data.type === 'customer' && String(data.userId) === String(conversation.value?.customer?._id)) customerOnline.value = Boolean(data.online)
  })
  socket.on('message.new', (msg) => {
    if (String(msg.conversationId) === String(props.conversationId)) {
      mergeMessage(msg)
      nextTick(scrollToBottom)
      syncLatestMessages()
    }
  })
  socket.on('message.recalled', applyRecall)
  socket.on('message.deleted', applyDelete)
  socket.on('conversation.updated', (data) => {
    if (String(data.conversationId) === String(props.conversationId)) {
      if (data.assignedAgentId) conversation.value.assignedAgentId = data.assignedAgentId
      if (data.status) conversation.value.status = data.status
      accepted.value = data.status !== 'waiting'
    }
  })
  socket.on('conversation.accepted', () => { loadConversation(); loadMessages() })
}

async function init() {
  if (!props.conversationId) { conversation.value = null; messages.value = []; return }
  loading.value = true
  try {
    await Promise.all([loadConversation(), loadMessages()])
    if (conversation.value) {
      await loadQuickReplies(); setupSocket()
      clearInterval(messageSyncTimer)
      messageSyncTimer = setInterval(syncLatestMessages, 30000)
    }
  } catch {} finally {
    loading.value = false
  }
}

watch(
  () => [props.conversationId, props.targetMessageId],
  ([id, targetId], [previousId, previousTargetId] = []) => {
    if (id === previousId) {
      if (targetId && targetId !== previousTargetId) loadMessages()
      return
    }
    socket?.disconnect(); socket = null
    customerOnline.value = false
    clearInterval(messageSyncTimer); messageSyncTimer = null
    showMore.value = false
    showQuickReplies.value = false
    quickReplies.value = []
    if (id) init()
    else { conversation.value = null; messages.value = [] }
  },
  { immediate: true },
)

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  socket?.disconnect()
  clearInterval(messageSyncTimer)
  clearTimeout(toastTimer)
  clearTimeout(longPressTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

function scrollToBottom() {
  if (!msgContainer.value) return
  msgContainer.value.scrollTo({ top: msgContainer.value.scrollHeight, behavior: 'auto' })
}
async function scrollToLatest() {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  scrollToBottom()
  const images = msgContainer.value?.querySelectorAll('img') || []
  images.forEach((image) => {
    if (!image.complete) image.addEventListener('load', scrollToBottom, { once: true })
  })
}
function showToast(message) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
}
function openPreview(msg) { preview.value = { url: msg.attachmentUrl, type: msg.messageType, name: msg.attachmentName } }
function closePreview() { preview.value = null }
async function downloadFile(url, name = '下载文件') {
  contextMenu.value = null
  downloadProgress.value = 0
  try {
    const blob = await api.get(url, {
      baseURL: '',
      responseType: 'blob',
      onDownloadProgress: (event) => {
        downloadProgress.value = event.total ? Math.round(event.loaded * 100 / event.total) : 0
      },
    })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl; link.download = name || '下载文件'; link.click()
    URL.revokeObjectURL(objectUrl)
    downloadProgress.value = 100
    showToast('文件已保存')
  } catch { showToast('下载失败') }
  finally { setTimeout(() => { downloadProgress.value = null }, 500) }
}
function showContextMenu(event, msg) {
  event.preventDefault()
  const x = Math.max(8, Math.min(event.clientX || innerWidth / 2, innerWidth - 150))
  const y = Math.max(8, Math.min(event.clientY || innerHeight / 2, innerHeight - 160))
  contextMenu.value = { msg, x, y }
}
function closeContextMenu() {
  contextMenu.value = null
}
function startLongPress(event, msg) {
  clearTimeout(longPressTimer)
  const point = event.touches?.[0]
  if (!point) return
  longPressStart = { x: point.clientX, y: point.clientY }
  const bubble = event.currentTarget
  const position = { preventDefault() {}, clientX: point.clientX, clientY: point.clientY }
  longPressTimer = setTimeout(() => {
    suppressBubbleClickUntil = Date.now() + 700
    showContextMenu(position, msg, bubble)
  }, 550)
}
function moveLongPress(event) {
  const point = event.touches?.[0]
  if (!point || !longPressStart) return
  if (Math.hypot(point.clientX - longPressStart.x, point.clientY - longPressStart.y) > 10) cancelLongPress()
}
function finishLongPress() {
  cancelLongPress()
}
function cancelLongPress() {
  clearTimeout(longPressTimer)
  longPressStart = null
}
function handleBubbleClick(event) {
  if (Date.now() >= suppressBubbleClickUntil) return
  event.preventDefault()
  event.stopPropagation()
}
function showVideoFirstFrame(event) {
  const video = event.currentTarget
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return

  const captureFrame = () => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      video.poster = canvas.toDataURL('image/jpeg', 0.82)
    } catch {}
  }

  video.addEventListener('seeked', captureFrame, { once: true })
  video.currentTime = Math.min(0.2, video.duration / 2)
}
function fallbackCopyText(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}
async function copyMessage(msg) {
  const text = String(msg.content || '')
  try {
    if (!text) throw new Error('没有可复制的内容')
    let copied = false
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {}
    }
    if (!copied) copied = fallbackCopyText(text)
    if (!copied) throw new Error('复制失败')
    showToast('已复制')
  } catch { showToast('复制失败') }
  contextMenu.value = null
}
async function recallMessage(msg) {
  try {
    await api.post(`/tenant/conversations/${props.conversationId}/messages/${msg._id}/recall`)
    Object.assign(msg, { recalledAt: new Date().toISOString(), content: '', attachmentUrl: '', attachmentName: '', thumbnailUrl: '' })
    showToast('消息已撤回')
  } catch (e) { showToast(e?.message || '撤回失败') }
  contextMenu.value = null
}
async function deleteMessage(msg) {
  try {
    await api.delete(`/tenant/conversations/${props.conversationId}/messages/${msg._id}`)
    messages.value = messages.value.filter(item => String(item._id) !== String(msg._id))
    showToast('消息已删除')
  } catch (e) { showToast(e?.message || '删除失败') }
  contextMenu.value = null
}
function applyRecall(data) {
  if (String(data.conversationId) !== String(props.conversationId)) return
  const msg = messages.value.find(item => String(item._id) === String(data.messageId))
  if (msg) Object.assign(msg, { recalledAt: data.recalledAt, content: '', attachmentUrl: '', attachmentName: '', thumbnailUrl: '' })
}
function applyDelete(data) {
  if (String(data.conversationId) === String(props.conversationId)) messages.value = messages.value.filter(item => String(item._id) !== String(data.messageId))
}
async function sendQuickReply(qr) {
  if (!accepted.value || conversation.value?.status !== 'active' || sendingQuickReplyId.value) return
  sendingQuickReplyId.value = qr._id
  try {
    const payload = { content: String(qr.content || '').trim(), clientMessageId: 'qr_' + Date.now() }
    if (qr.imageUrl) Object.assign(payload, { messageType: 'image', attachmentUrl: qr.imageUrl, attachmentName: qr.imageName || '' })
    const res = await api.post(`/tenant/conversations/${props.conversationId}/messages`, payload)
    if (res.code !== 0) throw new Error(res.message || '发送失败')
    mergeMessage(res.data)
    showQuickReplies.value = false
    await scrollToLatest()
  } catch (e) { showToast(e?.message || '快捷回复发送失败') }
  finally { sendingQuickReplyId.value = null }
}
function imageCaption(msg) {
  const content = String(msg.content || '').trim()
  if (!content || content === '[图片]' || content === String(msg.attachmentUrl || '').trim()) return ''
  return content
}
function parseMessageContent(content = '') {
  const urlPattern = /((?:https?:\/\/|www\.)[^\s<]+)/gi
  const parts = []
  let lastIndex = 0
  for (const match of String(content).matchAll(urlPattern)) {
    if (match.index > lastIndex) parts.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    const trailing = match[0].match(/[，。！？；：、,.!?;:]+$/)?.[0] || ''
    const text = trailing ? match[0].slice(0, -trailing.length) : match[0]
    parts.push({ type: 'link', text, href: text.toLowerCase().startsWith('www.') ? `https://${text}` : text })
    if (trailing) parts.push({ type: 'text', text: trailing })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) parts.push({ type: 'text', text: content.slice(lastIndex) })
  return parts.length ? parts : [{ type: 'text', text: content }]
}
function formatTime(iso) { return iso ? new Date(iso).toTimeString().slice(0, 5) : '' }
function formatDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso); return d.toLocaleString('zh-CN', { hour12: false })
}
function avatarChar() {
  return conversation.value?.customer?.qq?.slice(-1) || conversation.value?.customer?.phone?.slice(-1) || '客'
}

defineExpose({ reload: init })
</script>

<template>
  <div class="cp-panel" :class="{ loading }">
    <div v-if="loading" class="cp-loading">加载中...</div>
    <div v-else-if="!conversation" class="cp-empty">
      <div class="cp-empty-emoji">💬</div>
      <div class="cp-empty-title">选择一个会话开始接待</div>
    </div>

    <template v-else>
      <!-- 顶部栏 -->
      <header class="cp-header">
        <button v-if="$slots.back" class="cp-back" @click="emit('back')">←</button>
        <div class="cp-title-wrap" @click="showInfo = !showInfo">
          <img v-if="conversation.customer?.avatarUrl" class="cp-avatar cp-avatar-image" :src="conversation.customer.avatarUrl" alt="客户QQ头像" />
          <div v-else class="cp-avatar">{{ avatarChar() }}</div>
          <div>
            <div class="cp-title">
              {{ conversation.customer?.qq ? `QQ ${conversation.customer.qq}` : (conversation.customer?.phone ? '*' + conversation.customer.phone.slice(-4) : '访客') }}
              <span class="cp-status-tag" :class="conversation.status">
                {{ conversation.status === 'active' ? '处理中' : conversation.status === 'waiting' ? '待接入' : '已结束' }}
              </span>
            </div>
            <div class="cp-sub" :class="customerOnline ? 'is-online' : 'is-offline'">
              <span class="cp-presence-dot"></span>{{ customerOnline ? '客户在线' : '客户离线' }}
            </div>
          </div>
        </div>
        <div class="cp-header-actions">
          <button v-if="!accepted && conversation.status !== 'closed'" class="cp-btn cp-btn-primary" @click="accept">接入</button>
          <button v-if="conversation.status === 'active'" class="cp-btn cp-btn-danger" @click="showCloseConfirm = true">结束</button>
        </div>
      </header>

      <div class="cp-workspace">
        <div class="cp-chat-main">
      <!-- 消息区 -->
      <div class="cp-body" ref="msgContainer" @scroll="handleMessageScroll">
        <div v-if="loadingHistory" class="cp-history-status">正在加载历史消息...</div>
        <div v-else-if="!hasMoreMessages && messages.length" class="cp-history-status">没有更早的消息了</div>
        <div v-if="!accepted && conversation.status !== 'closed'" class="cp-notice">
          <div class="cp-notice-inner">
            <div class="cp-notice-title">新会话待接入</div>
            <div class="cp-notice-desc">点击顶部「接入」开始与客户沟通</div>
            <button class="cp-btn cp-btn-primary" @click="accept" style="margin-top:10px;">立即接入</button>
          </div>
        </div>

        <template v-for="(msg, idx) in messages" :key="msg._id">
          <div v-if="msg.recalledAt" class="cp-system-msg">
            <span>{{ msg.senderType === 'customer' ? '客户撤回一条消息' : '客服撤回一条消息' }}</span>
          </div>

          <div v-else-if="msg.senderType === 'system'" class="cp-system-msg" :data-message-id="msg._id">
            <span>{{ msg.content }}</span>
          </div>

          <div v-else class="cp-bubble-row" :data-message-id="msg._id" :class="msg.senderType === 'customer' ? 'is-left' : 'is-right'">
            <template v-if="msg.senderType === 'customer'">
              <img v-if="conversation.customer?.avatarUrl" class="cp-bubble-avatar" :src="conversation.customer.avatarUrl" alt="客户头像" />
              <div v-else class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#f59e0b,#d97706)` }">{{ avatarChar() }}</div>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble cp-bubble-customer" :class="{ 'cp-media-message-bubble': ['image', 'video', 'file'].includes(msg.messageType) && msg.attachmentUrl, 'cp-menu-active': contextMenu?.msg === msg }" @contextmenu="showContextMenu($event, msg)" @touchstart="startLongPress($event, msg)" @touchend="finishLongPress" @touchcancel="cancelLongPress" @touchmove="moveLongPress" @click.capture="handleBubbleClick">
                  <template v-if="msg.recalledAt"><span class="cp-recalled">消息已撤回</span></template>
                  <template v-else-if="msg.messageType === 'image' && msg.attachmentUrl"><img :src="msg.attachmentUrl" class="cp-bubble-img" @click="openPreview(msg)" /></template>
                  <template v-else-if="msg.messageType === 'video' && msg.attachmentUrl">
                    <div class="cp-video-wrap">
                      <img v-if="msg.thumbnailUrl" :src="msg.thumbnailUrl" :alt="msg.attachmentName || '视频封面'" class="cp-bubble-img cp-bubble-video" loading="lazy" @load="scrollToBottom" @click.prevent="openPreview(msg)" />
                      <video v-else :src="msg.attachmentUrl" class="cp-bubble-img cp-bubble-video" preload="metadata" playsinline muted @loadeddata="showVideoFirstFrame($event); scrollToBottom()" @click.prevent="openPreview(msg)"></video>
                      <span class="cp-video-play-icon" @click.prevent="openPreview(msg)">▶</span>
                    </div>
                  </template>
                  <button v-else-if="msg.messageType === 'file' && msg.attachmentUrl" class="cp-bubble-file" @click="downloadFile(msg.attachmentUrl, msg.attachmentName)">
                    📎 {{ msg.attachmentName || '文件' }}
                  </button>
                  <template v-else>
                    <template v-for="(part, index) in parseMessageContent(msg.content)" :key="index">
                      <a v-if="part.type === 'link'" class="cp-message-link" :href="part.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ part.text }}</a>
                      <span v-else>{{ part.text }}</span>
                    </template>
                  </template>
                </div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
            </template>

            <template v-else>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble" :class="{ 'cp-media-message-bubble': ['image', 'video', 'file'].includes(msg.messageType) && msg.attachmentUrl, 'cp-menu-active': contextMenu?.msg === msg }" @contextmenu="showContextMenu($event, msg)" @touchstart="startLongPress($event, msg)" @touchend="finishLongPress" @touchcancel="cancelLongPress" @touchmove="moveLongPress" @click.capture="handleBubbleClick">
                  <template v-if="msg.recalledAt"><span class="cp-recalled">消息已撤回</span></template>
                  <template v-else-if="msg.messageType === 'image' && msg.attachmentUrl"><img :src="msg.attachmentUrl" class="cp-bubble-img" @click="openPreview(msg)" /><div v-if="imageCaption(msg)" class="cp-image-caption">{{ imageCaption(msg) }}</div></template>
                  <template v-else-if="msg.messageType === 'video' && msg.attachmentUrl">
                    <div class="cp-video-wrap">
                      <img v-if="msg.thumbnailUrl" :src="msg.thumbnailUrl" :alt="msg.attachmentName || '视频封面'" class="cp-bubble-img cp-bubble-video" loading="lazy" @load="scrollToBottom" @click.prevent="openPreview(msg)" />
                      <video v-else :src="msg.attachmentUrl" class="cp-bubble-img cp-bubble-video" preload="metadata" playsinline muted @loadeddata="showVideoFirstFrame($event); scrollToBottom()" @click.prevent="openPreview(msg)"></video>
                      <span class="cp-video-play-icon" @click.prevent="openPreview(msg)">▶</span>
                    </div>
                  </template>
                  <button v-else-if="msg.messageType === 'file' && msg.attachmentUrl" class="cp-bubble-file" @click="downloadFile(msg.attachmentUrl, msg.attachmentName)">
                    📎 {{ msg.attachmentName || '文件' }}
                  </button>
                  <template v-else>
                    <template v-for="(part, index) in parseMessageContent(msg.content)" :key="index">
                      <a v-if="part.type === 'link'" class="cp-message-link" :href="part.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ part.text }}</a>
                      <span v-else>{{ part.text }}</span>
                    </template>
                  </template>
                </div>
                <div v-if="msg.autoReplyType === 'keyword'" class="cp-keyword-reply-notice">关键词自动回复内容可作为参考</div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
              <img v-if="msg.senderType === 'agent' && (msg.sender?.avatarUrl || conversation.channel?.avatarUrl)" class="cp-bubble-avatar" :src="msg.sender?.avatarUrl || conversation.channel.avatarUrl" alt="客服头像" />
              <div v-else class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#2563eb,#1d4ed8)` }">{{ msg.senderType === 'bot' ? 'AI' : (msg.sender?.displayName?.[0] || '我') }}</div>
            </template>
          </div>
        </template>
      </div>

      <!-- 输入区 -->
      <div class="cp-input-area">
        <div class="cp-input-row">
          <button class="cp-more-btn" @click="showMore = !showMore">+</button>
          <textarea
            v-model="input"
            class="cp-input"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows="2"
            @keydown.enter.exact.prevent="sendMsg"
            @focus="showQuickReplies = false; showMore = false"
            :disabled="!accepted || conversation.status === 'closed'"
          ></textarea>
          <button class="cp-send-btn" @click="sendMsg" :disabled="sending || !input.trim() || !accepted">发送</button>
        </div>

        <div v-if="showMore" class="cp-more-panel">
          <div class="cp-more-grid">
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept="image/*" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">▧</span><span>发送图片</span>
            </label>
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept="video/*" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">▷</span><span>发送视频</span>
            </label>
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept=".pdf,.zip,.txt,.doc,.docx" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">▤</span><span>发送文件</span>
            </label>
            <button class="cp-more-item" @click="showMore = false; showQuickReplies = true">
              <span class="cp-more-icon">💬</span><span>快捷回复</span>
            </button>
            <button class="cp-more-item" @click="showInfo = true">
              <span class="cp-more-icon">👤</span><span>客户资料</span>
            </button>
          </div>
        </div>
      </div>
        </div>

        <aside v-if="showQuickReplies" class="cp-quick-sidebar" aria-label="快捷回复列表">
          <div class="cp-quick-sidebar-header">
            <div><strong>快捷回复</strong><small>点击条目直接发送</small></div>
            <button type="button" aria-label="关闭快捷回复" @click="showQuickReplies = false">×</button>
          </div>
          <nav class="cp-quick-list">
            <div v-if="!quickReplies.length" class="cp-quick-empty">暂无快捷回复</div>
            <button v-for="qr in quickReplies" :key="qr._id" class="cp-quick-item" :disabled="Boolean(sendingQuickReplyId)" @click="sendQuickReply(qr)">
              <span><strong>{{ qr.title }}</strong><small>{{ qr.content || '图片回复' }}</small></span>
              <img v-if="qr.imageUrl" :src="qr.imageUrl" alt="快捷回复图片" />
            </button>
          </nav>
        </aside>
      </div>
    </template>

    <div v-if="preview" class="cp-preview" @click.self="closePreview">
      <div class="cp-preview-actions">
        <button type="button" @click="downloadFile(preview.url, preview.name)">下载</button>
        <button type="button" class="cp-preview-close" @click="closePreview">×</button>
      </div>
      <img v-if="preview.type === 'image'" :src="preview.url" :alt="preview.name || '图片预览'" />
      <video v-else :src="preview.url" controls autoplay></video>
    </div>

    <div v-if="contextMenu" class="cp-menu-mask" @pointerdown="closeContextMenu">
      <div class="cp-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop>
        <button v-if="contextMenu.msg.messageType !== 'image' && String(contextMenu.msg.content || '')" type="button" @click="copyMessage(contextMenu.msg)">复制</button>
        <button v-if="canRecallMessage(contextMenu.msg)" type="button" @click="recallMessage(contextMenu.msg)">撤回</button>
        <button v-if="canDeleteMessage(contextMenu.msg)" type="button" class="danger" @click="deleteMessage(contextMenu.msg)">删除</button>
      </div>
    </div>

    <div v-if="downloadProgress !== null" class="cp-download">
      <div>正在下载 {{ downloadProgress }}%</div>
      <span><i :style="{ width: downloadProgress + '%' }"></i></span>
    </div>
    <div v-else-if="toast" class="cp-toast">{{ toast }}</div>

    <!-- 客户资料侧栏 -->
    <div v-if="showInfo && conversation" class="cp-info-drawer" @click.self="showInfo = false">
      <div class="cp-info-content">
        <div class="cp-info-title">客户资料<button class="cp-info-close" @click="showInfo = false">×</button></div>
        <div class="cp-info-body">
          <div class="cp-info-row"><span>会话 ID</span><span class="cp-info-id">{{ conversation._id }}</span></div>
          <div class="cp-info-row"><span>接入时间</span><span>{{ formatDateTime(conversation.acceptedAt) }}</span></div>
          <div class="cp-info-row"><span>结束时间</span><span>{{ formatDateTime(conversation.closedAt) }}</span></div>
        </div>
        <div class="cp-info-actions">
          <button @click="confirmAction = 'receive'">{{ conversation.customer?.messageReceivingDisabled ? '恢复接收客户消息' : '不接收该客户信息' }}</button>
          <button class="danger" @click="confirmAction = 'block'">{{ conversation.customer?.blocked ? '解除拉黑客户' : '拉黑该客户' }}</button>
          <button class="danger" @click="confirmAction = 'clear'">清理对话内容</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="Boolean(confirmAction)"
      :title="confirmAction === 'clear' ? '清理对话内容' : (confirmAction === 'block' ? (conversation?.customer?.blocked ? '解除拉黑客户' : '拉黑该客户') : (conversation?.customer?.messageReceivingDisabled ? '恢复接收客户消息' : '不接收该客户信息'))"
      :message="confirmAction === 'clear' ? '只会清理当前客服界面中的全部消息，客户界面的消息不会删除。' : (confirmAction === 'block' ? '拉黑后客服不会收到该客户消息，客户发送时会显示失败感叹号。' : '关闭接收后，该客户将无法向客服发送消息。')"
      confirm-text="确认"
      :danger="confirmAction === 'clear' || confirmAction === 'block'"
      :loading="actionSubmitting"
      @confirm="runCustomerAction"
      @cancel="confirmAction = null"
    />

    <ConfirmDialog
      :open="showCloseConfirm"
      title="结束会话"
      message="确认结束该会话吗？结束后将无法继续发送消息。"
      confirm-text="确认结束"
      danger
      :loading="closing"
      @confirm="close"
      @cancel="showCloseConfirm = false"
    />
  </div>
</template>

<style scoped>
.cp-preview{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center}.cp-preview>img,.cp-preview>video{max-width:96vw;max-height:92vh;object-fit:contain}.cp-preview-actions{position:absolute;right:18px;top:18px;display:flex;gap:10px;z-index:1}.cp-preview-actions button{border:0;border-radius:8px;background:rgba(255,255,255,.18);color:#fff;padding:9px 14px;cursor:pointer}.cp-preview-actions .cp-preview-close{font-size:24px;line-height:20px}.cp-menu-mask{position:fixed;inset:0;z-index:250}.cp-menu{position:fixed;width:140px;padding:6px;background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(15,23,42,.25);display:flex;flex-direction:column}.cp-menu button{border:0;background:transparent;text-align:left;padding:10px 12px;border-radius:6px;cursor:pointer}.cp-menu button:hover{background:#f1f5f9}.cp-menu button.danger{color:#dc2626}.cp-download,.cp-toast{position:fixed;z-index:320;left:50%;bottom:24px;transform:translateX(-50%);background:#0f172a;color:#fff;border-radius:10px;padding:10px 16px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2)}.cp-download span{display:block;width:180px;height:3px;background:#475569;margin-top:7px}.cp-download i{display:block;height:100%;background:#60a5fa}.cp-recalled{font-style:italic;opacity:.75}.cp-bubble-file{border:0;cursor:pointer;font-family:inherit}
.cp-avatar-image { object-fit: cover; }
.cp-panel {
  display: flex; flex: 1 1 auto; flex-direction: column;
  width: 100%; height: 100%; min-width: 0; min-height: 0;
  overflow: hidden; background: #f8fafc;
}
.cp-loading, .cp-empty { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; color: #94a3b8; }
.cp-empty-emoji { font-size: 56px; margin-bottom: 12px; }
.cp-empty-title { font-size: 14px; }

/* 顶部栏 */
.cp-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; background: #fff; border-bottom: 1px solid #e2e8f0;
  position: relative; z-index: 1; flex-shrink: 0;
}
.cp-back {
  width: 36px; height: 36px; border: none; background: transparent;
  border-radius: 8px; cursor: pointer; font-size: 18px; color: #475569;
}
.cp-back:hover { background: #f1f5f9; }
.cp-title-wrap { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; cursor: pointer; }
.cp-avatar {
  width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 16px;
}
.cp-title { font-weight: 600; font-size: 15px; color: #0f172a; display: flex; align-items: center; gap: 8px; }
.cp-status-tag { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.cp-status-tag.active { background: #dcfce7; color: #16a34a; }
.cp-status-tag.waiting { background: #dbeafe; color: #2563eb; }
.cp-status-tag.closed { background: #f1f5f9; color: #94a3b8; }
.cp-sub { display: flex; align-items: center; gap: 5px; font-size: 12px; margin-top: 2px; }
.cp-sub.is-online { color: #16a34a; }
.cp-sub.is-offline { color: #94a3b8; }
.cp-presence-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.cp-header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.cp-btn { padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: all .15s; }
.cp-btn-primary { background: #2563eb; color: #fff; }
.cp-btn-primary:hover { background: #1d4ed8; }
.cp-btn-secondary { background: #f1f5f9; color: #475569; }
.cp-btn-danger { background: #ef4444; color: #fff; }
.cp-btn-danger:hover { background: #dc2626; }
.cp-btn:disabled { opacity: .5; cursor: not-allowed; }

/* 消息区 */
.cp-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
.cp-history-status { padding: 8px 0 12px; color: #94a3b8; font-size: 12px; text-align: center; }
.cp-notice { padding: 20px; text-align: center; }
.cp-notice-inner { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 20px; max-width: 320px; margin: 0 auto; }
.cp-notice-title { font-weight: 600; color: #c2410c; margin-bottom: 4px; font-size: 14px; }
.cp-notice-desc { color: #9a3412; font-size: 12px; }

/* 系统消息 */
.cp-system-msg {
  text-align: center; margin: 12px 0;
}
.cp-system-msg span {
  background: rgba(0,0,0,.06); color: #64748b; font-size: 12px;
  padding: 4px 12px; border-radius: 12px;
}

/* 气泡行 */
.cp-bubble-row {
  display: flex; align-items: flex-start; gap: 8px;
  margin-bottom: 12px;
}
.cp-bubble-wrap {
  display: flex; flex-direction: column; gap: 2px; max-width: 72%;
}
.cp-keyword-reply-notice { color: #94a3b8; font-size: 11px; line-height: 1.4; padding: 1px 2px 0; }
.cp-bubble-time { font-size: 11px; color: #94a3b8; line-height: 1; padding: 0 2px; -webkit-user-select: none; user-select: none; }

/* 客户气泡：左 */
.cp-message-highlight { animation: cp-message-highlight 2.2s ease; border-radius: 12px; }
@keyframes cp-message-highlight { 0%, 45% { background: rgba(250,204,21,.3); box-shadow: 0 0 0 8px rgba(250,204,21,.12); } 100% { background: transparent; box-shadow: none; } }
.cp-bubble-row.is-left { flex-direction: row; justify-content: flex-start; }
.cp-bubble-row.is-left .cp-bubble-wrap { align-items: flex-start; }
.cp-bubble-row.is-left .cp-bubble {
  background: #fff; color: #0f172a;
  border-radius: 4px 16px 16px 16px;
  box-shadow: 0 1px 2px rgba(15,23,42,.05);
}
.cp-bubble-row.is-left .cp-bubble::before {
  content: ''; position: absolute; left: -6px; top: 12px;
  width: 0; height: 0; border-top: 6px solid transparent;
  border-bottom: 6px solid transparent; border-right: 6px solid #fff;
}

/* 坐席气泡：右 */
.cp-bubble-row.is-right { flex-direction: row; justify-content: flex-end; }
.cp-bubble-row.is-right .cp-bubble-wrap { align-items: flex-end; }
.cp-bubble-row.is-right .cp-bubble {
  background: #cfe8ff; color: #1a1a1a;
  border-radius: 16px 4px 16px 16px;
  box-shadow: 0 1px 2px rgba(37,99,235,.14);
}
.cp-bubble-row.is-right .cp-bubble::before {
  content: ''; position: absolute; right: -6px; top: 12px;
  width: 0; height: 0; border-top: 6px solid transparent;
  border-bottom: 6px solid transparent; border-left: 6px solid #cfe8ff;
}

.cp-bubble {
  position: relative; max-width: 100%; padding: 11px 15px;
  font-size: 15px; line-height: 1.55; word-break: break-word; white-space: pre-wrap;
  -webkit-touch-callout: default; -webkit-user-select: text; user-select: text;
}
.cp-bubble.cp-menu-active { filter: brightness(.9); outline: 3px solid rgba(15,23,42,.18); box-shadow: inset 0 0 0 999px rgba(15,23,42,.08); }
.cp-bubble.cp-media-message-bubble { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
.cp-message-link { color: #2563eb; text-decoration: none; overflow-wrap: anywhere; }
.cp-bubble-row.is-right .cp-message-link { color: #2563eb; }
.cp-message-link:hover { opacity: .82; }
.cp-bubble-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 13px; object-fit: cover;
}
.cp-bubble.cp-image-message-bubble { padding: 0; background: transparent; border: 0; box-shadow: none; }
.cp-bubble.cp-image-message-bubble::before { display: none; }
.cp-bubble-img { max-width: 200px; max-height: 220px; border-radius: 8px; display: block; object-fit: contain; cursor: pointer; }
.cp-video-wrap { position: relative; display: inline-block; max-width: 200px; }
.cp-video-play-icon {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 44px; height: 44px;
  background: rgba(0,0,0,.55);
  border-radius: 50%;
  color: #fff; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; pointer-events: auto;
  transition: background .15s;
}
.cp-video-play-icon:hover { background: rgba(0,0,0,.75); }
.cp-image-caption { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: #fff; color: #0f172a; white-space: pre-wrap; }
.cp-bubble-row.is-right .cp-image-caption { background: #cfe8ff; color: #1a1a1a; }
.cp-bubble-file {
  display: inline-flex; align-items: center; gap: 6px;
  background: #eff6ff; color: #2563eb; text-decoration: none;
  padding: 6px 12px; border-radius: 6px; font-size: 13px;
}
.cp-bubble-row.is-right .cp-bubble-file { background: rgba(255,255,255,.2); color: #fff; }

/* 聊天与快捷回复侧栏 */
.cp-workspace { display: flex; flex: 1; min-width: 0; min-height: 0; }
.cp-chat-main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.cp-quick-sidebar { width: 300px; min-width: 260px; display: flex; flex-direction: column; background: #fff; border-left: 1px solid #e2e8f0; }
.cp-quick-sidebar-header { min-height: 64px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; }
.cp-quick-sidebar-header div { display: flex; flex-direction: column; gap: 3px; }
.cp-quick-sidebar-header strong { color: #0f172a; font-size: 14px; }
.cp-quick-sidebar-header small { color: #94a3b8; font-size: 11px; }
.cp-quick-sidebar-header button { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: #64748b; font-size: 22px; cursor: pointer; }
.cp-quick-sidebar-header button:hover { background: #f1f5f9; }
.cp-quick-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
.cp-quick-empty { padding: 28px 12px; color: #94a3b8; font-size: 13px; text-align: center; }

/* 输入区 */
.cp-quick-item { width: 100%; display: flex; align-items: center; gap: 9px; padding: 9px; border: 0; border-radius: 9px; background: transparent; text-align: left; cursor: pointer; }
.cp-quick-item:hover { background: #f8fafc; }
.cp-quick-item:disabled { opacity: .6; }
.cp-quick-item img { width: 44px; height: 44px; flex: 0 0 44px; object-fit: cover; border-radius: 7px; }
.cp-quick-item span { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.cp-quick-item strong { color: #0f172a; font-size: 13px; }
.cp-quick-item small { color: #64748b; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cp-input-area { position: relative; padding: 10px 16px; background: #fff; border-top: 1px solid #e2e8f0; flex-shrink: 0; }
.cp-input-row { display: flex; gap: 8px; align-items: flex-end; }
.cp-more-btn {
  width: 36px; height: 36px; border: 1px solid #e2e8f0; background: #fff;
  border-radius: 8px; cursor: pointer; font-size: 20px; color: #64748b;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cp-more-btn:hover { background: #f1f5f9; }
.cp-input {
  flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 12px;
  font-size: 14px; font-family: inherit; resize: none; line-height: 1.5;
  outline: none; transition: border-color .15s; min-height: 36px;
}
.cp-input:focus { border-color: #2563eb; }
.cp-input:disabled { background: #f8fafc; cursor: not-allowed; }
.cp-send-btn {
  padding: 0 18px; height: 36px; background: #2563eb; color: #fff;
  border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
  cursor: pointer; flex-shrink: 0; transition: background .15s;
}
.cp-send-btn:hover:not(:disabled) { background: #1d4ed8; }
.cp-send-btn:disabled { opacity: .5; cursor: not-allowed; }

.cp-more-panel { padding-top: 8px; }
.cp-more-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cp-more-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px; border: 1px solid #e2e8f0; border-radius: 10px;
  background: #f8fafc; cursor: pointer; font-size: 11px; color: #475569;
}
.cp-more-item:hover { background: #eff6ff; border-color: #2563eb; color: #2563eb; }
.cp-more-item.disabled { opacity: .4; pointer-events: none; }
.cp-more-icon { font-size: 20px; }

/* 侧栏/弹窗 */
.cp-info-drawer {
  position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 100;
  display: flex; justify-content: flex-end;
}
.cp-info-content {
  width: 360px; max-width: 90vw; background: #fff; height: 100%;
  box-shadow: -4px 0 20px rgba(0,0,0,.1); overflow-y: auto;
}
.cp-info-title {
  padding: 16px; font-size: 16px; font-weight: 600; border-bottom: 1px solid #e2e8f0;
  display: flex; justify-content: space-between; align-items: center;
}
.cp-info-close { border: none; background: transparent; font-size: 22px; cursor: pointer; color: #94a3b8; }
.cp-info-body { padding: 12px 16px; }
.cp-info-row {
  display: flex; justify-content: space-between; padding: 10px 0;
  border-bottom: 1px solid #f1f5f9; font-size: 13px;
}
.cp-info-row span:first-child { color: #64748b; }
.cp-info-row span:last-child { color: #0f172a; max-width: 55%; text-align: right; word-break: break-all; }
.cp-info-ua { font-size: 10px; color: #94a3b8 !important; max-width: 55%; }
.cp-info-id { font-family: monospace; font-size: 11px; }
.cp-info-actions { padding: 12px 16px 20px; display: grid; gap: 9px; border-top: 1px solid #e2e8f0; }
.cp-info-actions button { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155; cursor: pointer; }
.cp-info-actions button.danger { color: #dc2626; border-color: #fecaca; background: #fff7f7; }

/* 移动端 */
@media (max-width: 768px) {
  .cp-header { padding: 10px 12px; }
  .cp-avatar { width: 36px; height: 36px; font-size: 14px; }
  .cp-body { padding: 12px; }
  .cp-bubble-wrap { max-width: 80%; }
  .cp-bubble { padding: 9px 12px; font-size: 14px; }
  .cp-info-content { width: 100%; max-width: 100%; }
}
</style>
