<!-- 忆梦云团队开发 -->
<template>
  <!-- 加载中 -->
  <div v-if="loading" class="loading-page">加载中...</div>

  <!-- 链接无效 -->
  <div v-else-if="!channel" class="invalid-link">
    <h2>客服链接无效</h2>
    <p>请使用正确的客服链接访问</p>
  </div>

  <!-- 聊天页 -->
  <div v-else class="chat-page">
    <div class="chat-header">
      <img v-if="channel.avatarUrl" class="chat-avatar" :src="channel.avatarUrl" alt="渠道头像" />
      <div v-else class="chat-avatar">{{ channel.brandName?.[0] || '客' }}</div>
      <div class="chat-header-info">
        <div class="chat-header-name">{{ channel.brandName || '在线客服' }}</div>
        <div class="chat-header-status">
          <span v-if="conversationStatus === 'active'">客服已接入</span>
          <span v-else-if="conversationStatus === 'closed'">会话已结束，再次发送消息可重新咨询</span>
          <span v-else>等待客服接入...</span>
        </div>
      </div>
      <button class="profile-trigger" v-if="customer" @click="openQQModal">
        {{ customer.qq ? `QQ ${customer.qq}` : '完善QQ' }}
      </button>
    </div>

    <div class="chat-messages" ref="msgContainer" @scroll="handleMessageScroll">
      <div v-if="loadingHistory" class="history-loading">正在加载历史消息...</div>
      <div v-else-if="!hasMoreMessages && messages.length" class="history-end">没有更早的消息了</div>
      <div
        v-for="msg in messages"
        :key="msg._id || msg.clientMessageId"
        :class="['msg', msg.recalledAt ? 'system' : msg.senderType]"
      >
        <template v-if="msg.recalledAt">
          <div class="msg-bubble">
            {{ msg.senderType === 'customer' ? '客户撤回一条消息' : '客服撤回一条消息' }}
          </div>
        </template>
        <template v-else-if="msg.senderType === 'system'">
          <div class="msg-bubble">{{ msg.content }}</div>
        </template>
        <template v-else>
          <img
            v-if="msg.senderType === 'customer' && customer?.avatarUrl"
            class="msg-avatar"
            :src="customer.avatarUrl"
            alt="我的头像"
          />
          <img
            v-else-if="msg.senderType !== 'customer' && (msg.sender?.avatarUrl || channel.avatarUrl)"
            class="msg-avatar"
            :src="msg.sender?.avatarUrl || channel.avatarUrl"
            alt="客服头像"
          />
          <div v-else class="msg-avatar msg-avatar-fallback">
            {{ msg.senderType === 'customer' ? (customer?.qq?.slice(-1) || '我') : (msg.senderType === 'bot' ? 'AI' : (channel.brandName?.[0] || '客')) }}
          </div>
          <div class="msg-content">
            <div
              class="msg-bubble"
              :class="{ 'image-message-bubble': msg.messageType === 'image' && msg.attachmentUrl }"
              @contextmenu="showContextMenu($event, msg)"
              @touchstart="startLongPress($event, msg)"
              @touchend="cancelLongPress"
              @touchcancel="cancelLongPress"
              @touchmove="cancelLongPress"
            >
              <span v-if="msg.recalledAt" class="message-recalled">消息已撤回</span>
              <img v-else-if="msg.messageType === 'image' && msg.attachmentUrl" class="message-image" :src="msg.attachmentUrl" :alt="msg.attachmentName || '图片'" loading="lazy" decoding="async" @load="scheduleScroll(false)" @click="openPreview(msg)" />
              <video v-else-if="msg.messageType === 'video' && msg.attachmentUrl" class="message-image message-video" :src="msg.attachmentUrl" preload="none" @click.prevent="openPreview(msg)"></video>
              <button v-else-if="msg.messageType === 'file' && msg.attachmentUrl" type="button" class="message-file" @click="downloadFile(msg.attachmentUrl, msg.attachmentName)">
                <span class="message-file-icon">▤</span>
                <span>{{ msg.attachmentName || '下载文件' }}</span>
              </button>
              <template v-else>{{ msg.content }}</template>
            </div>
            <div v-if="msg.autoReplyType === 'keyword'" class="keyword-reply-notice">关键词自动回复内容可作为参考</div>
            <div class="msg-time">{{ formatTime(msg.createdAt) }}</div>
          </div>
        </template>
      </div>
    </div>

    <div class="chat-composer">
      <Transition name="attachment-panel">
        <div v-if="showAttachments" class="attachment-panel">
          <button type="button" class="attachment-action" :disabled="uploading" @click="imageInput?.click()">
            <span class="attachment-icon attachment-image-icon">▧</span>
            <span>上传图片</span>
          </button>
          <button type="button" class="attachment-action" :disabled="uploading" @click="fileInput?.click()">
            <span class="attachment-icon attachment-file-icon">▤</span>
            <span>上传文件</span>
          </button>
        </div>
      </Transition>

      <div class="chat-input-area">
        <button
          type="button"
          class="attachment-toggle"
          :class="{ active: showAttachments }"
          :disabled="!customer || uploading"
          aria-label="打开附件菜单"
          @click="showAttachments = !showAttachments"
        >+</button>
        <textarea
          v-model="inputText"
          :disabled="!customer || uploading"
          :placeholder="uploading ? '正在上传...' : '请输入消息...'"
          @keydown.enter.exact.prevent="sendMessage"
          rows="1"
        ></textarea>
        <button class="send-button" @click="sendMessage" :disabled="!customer || !inputText.trim() || sending || uploading">
          发送
        </button>
      </div>

      <input ref="imageInput" class="hidden-file-input" type="file" accept="image/*" @change="handleAttachment($event, 'image')" />
      <input ref="fileInput" class="hidden-file-input" type="file" @change="handleAttachment($event, 'file')" />
    </div>

    <div v-if="preview" class="media-preview" @click.self="closePreview" @dblclick="closePreview">
      <div class="media-preview-actions">
        <button type="button" @click.stop="downloadFile(preview.url, preview.name || (preview.type === 'video' ? '视频' : '图片'))">保存</button>
        <button type="button" class="media-preview-close" aria-label="关闭预览" @click.stop="closePreview">×</button>
      </div>
      <img v-if="preview.type === 'image'" :src="preview.url" :alt="preview.name || '图片预览'" />
      <video v-else :src="preview.url" controls autoplay @dblclick.stop="closePreview"></video>
    </div>

    <div v-if="contextMenu" class="message-menu-mask" @pointerdown="contextMenu = null">
      <div class="message-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop>
        <button v-if="contextMenu.msg.messageType !== 'image'" type="button" @click="copyMessage(contextMenu.msg)">复制</button>
        <button v-if="canRecallMessage(contextMenu.msg)" type="button" @click="recallMessage(contextMenu.msg)">撤回</button>
        <button v-if="canDeleteMessage(contextMenu.msg)" type="button" class="danger" @click="deleteMessage(contextMenu.msg)">删除</button>
      </div>
    </div>

    <div v-if="downloadProgress !== null" class="download-progress">
      <div>正在下载 {{ downloadProgress }}%</div>
      <span><i :style="{ width: downloadProgress + '%' }"></i></span>
    </div>
    <div v-else-if="toast" class="bottom-toast">{{ toast }}</div>

    <!-- 登录弹窗 -->
    <div v-if="showLogin" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-title">{{ channel.brandName || '在线客服' }}</div>
        <div class="modal-desc">输入手机号开始咨询，未注册将自动创建账号</div>
        <div class="form-item">
          <label>手机号</label>
          <input v-model="loginForm.phone" placeholder="请输入手机号" @keyup.enter="doLogin" />
        </div>
        <div class="form-item">
          <label>密码</label>
          <input v-model="loginForm.password" type="password" placeholder="请输入密码" @keyup.enter="doLogin" />
        </div>
        <div class="err" v-if="loginErr">{{ loginErr }}</div>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="doLogin" :disabled="loginLoading">
            {{ loginLoading ? '处理中...' : '进入聊天' }}
          </button>
        </div>
      </div>
    </div>

    <!-- QQ 弹窗 -->
    <div v-if="showQQModal" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-title">{{ customer?.qq ? '修改QQ号' : '完善信息' }}</div>
        <div class="modal-desc">填写QQ号后，将自动生成QQ邮箱和头像</div>
        <div class="form-item">
          <label>QQ号</label>
          <input v-model.trim="qqForm.qq" inputmode="numeric" maxlength="12" placeholder="请输入5-12位QQ号" @keyup.enter="submitQQ" />
        </div>
        <div class="err" v-if="qqErr">{{ qqErr }}</div>
        <div class="modal-actions">
          <button v-if="customer?.qq" class="btn btn-ghost" @click="showQQModal = false">取消</button>
          <button class="btn btn-primary" @click="submitQQ" :disabled="qqLoading">
            {{ qqLoading ? '提交中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, getSocket } from '../api'

const route = useRoute()
const token = computed(() => route.params.token)

const loading = ref(true)
const channel = ref(null)
const customer = ref(null)
const conversationStatus = ref('waiting')
const messages = ref([])
const inputText = ref('')
const sending = ref(false)
const uploading = ref(false)
const showAttachments = ref(false)
const imageInput = ref(null)
const fileInput = ref(null)
const msgContainer = ref(null)
const loadingHistory = ref(false)
const hasMoreMessages = ref(true)
const preview = ref(null)
const contextMenu = ref(null)
const downloadProgress = ref(null)
const toast = ref('')

const showLogin = ref(false)
const loginForm = ref({ phone: '', password: '' })
const loginLoading = ref(false)
const loginErr = ref('')

const showQQModal = ref(false)
const qqForm = ref({ qq: '' })
const qqLoading = ref(false)
const qqErr = ref('')

let socket = null
let notificationAudioContext = null
let toastTimer = null
let longPressTimer = null
let initialScrollTimers = []
let scrollFrame = null
let pendingScrollForce = false

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

async function loadChannel() {
  try {
    const saved = localStorage.getItem('client_token')
    const [channelResult, meResult] = await Promise.allSettled([
      api.get(`/client/channels/${token.value}`),
      saved ? api.get('/client/me') : Promise.resolve(null),
    ])

    const channelRes = channelResult.status === 'fulfilled' ? channelResult.value : null
    if (channelRes?.code !== 0) {
      channel.value = null
      return
    }
    channel.value = channelRes.data

    const meRes = meResult.status === 'fulfilled' ? meResult.value : null
    if (meRes?.code === 0) {
      customer.value = meRes.data
      setupSocket()
      await Promise.all([loadConversation(), loadMessages()])
      if (!customer.value.qq) showQQModal.value = true
    } else {
      if (saved) localStorage.removeItem('client_token')
      showLogin.value = true
    }
  } finally {
    loading.value = false
    await scrollInitialMessagesToBottom()
  }
}

async function loadMe() {
  try {
    const res = await api.get('/client/me')
    if (res.code === 0) {
      customer.value = res.data
      await Promise.all([loadConversation(), loadMessages()])
      setupSocket()
      if (!customer.value.qq) showQQModal.value = true
    }
  } catch (e) {
    localStorage.removeItem('client_token')
  }
}

async function doLogin() {
  loginErr.value = ''
  if (!loginForm.value.phone || !loginForm.value.password) {
    loginErr.value = '请填写完整信息'
    return
  }
  loginLoading.value = true
  try {
    const res = await api.post(`/client/channels/${token.value}/auth`, {
      phone: loginForm.value.phone,
      password: loginForm.value.password,
      fingerprint: generateFingerprint(),
    })
    if (res.code === 0) {
      localStorage.setItem('client_token', res.data.token)
      customer.value = res.data.customer
      conversationStatus.value = res.data.conversation.status
      showLogin.value = false
      
      await loadMessages()
      setupSocket()
      
      if (res.data.profileRequired) {
        showQQModal.value = true
      }
    } else {
      loginErr.value = res.message || '登录失败'
    }
  } catch (e) {
    loginErr.value = e?.message || '网络错误'
  } finally {
    loginLoading.value = false
  }
}

function openQQModal() {
  qqForm.value.qq = customer.value?.qq || ''
  qqErr.value = ''
  showQQModal.value = true
}

async function submitQQ() {
  qqErr.value = ''
  if (!/^[1-9]\d{4,11}$/.test(qqForm.value.qq)) {
    qqErr.value = '请输入5-12位有效QQ号'
    return
  }
  qqLoading.value = true
  try {
    const res = await api.post('/client/profile/qq', qqForm.value)
    if (res.code === 0) {
      customer.value = res.data
      showQQModal.value = false
    } else {
      qqErr.value = res.message || '提交失败'
    }
  } catch (e) {
    qqErr.value = e?.message || '网络错误'
  } finally {
    qqLoading.value = false
  }
}

async function loadConversation() {
  try {
    const res = await api.get('/client/conversation')
    if (res.code === 0 && res.data) {
      conversationStatus.value = res.data.status
    }
  } catch {}
}

async function loadMessages() {
  try {
    const res = await api.get('/client/conversation/messages', { params: { limit: 50 } })
    if (res.code === 0) {
      messages.value = res.data || []
      hasMoreMessages.value = messages.value.length === 50
      await scrollToBottom()
    }
  } catch {}
}

async function loadPreviousMessages() {
  if (loadingHistory.value || !hasMoreMessages.value || !messages.value.length) return
  const firstMessage = messages.value.find(message => message._id && !String(message._id).startsWith('temp_'))
  if (!firstMessage) return
  loadingHistory.value = true
  const container = msgContainer.value
  const previousHeight = container?.scrollHeight || 0
  try {
    const res = await api.get('/client/conversation/messages', {
      params: { limit: 50, before: firstMessage._id },
    })
    if (res.code === 0) {
      const olderMessages = res.data || []
      const existingIds = new Set(messages.value.map(message => String(message._id)))
      messages.value = [
        ...olderMessages.filter(message => !existingIds.has(String(message._id))),
        ...messages.value,
      ]
      hasMoreMessages.value = olderMessages.length === 50
      await nextTick()
      if (container) container.scrollTop = container.scrollHeight - previousHeight
    }
  } catch {} finally {
    loadingHistory.value = false
  }
}

function handleMessageScroll() {
  const container = msgContainer.value
  if ((container?.scrollTop || 0) <= 24) loadPreviousMessages()
}

function mergeMessage(message) {
  if (!message) return false
  const index = messages.value.findIndex(item =>
    String(item._id) === String(message._id) ||
    (message.clientMessageId && item.clientMessageId === message.clientMessageId),
  )
  if (index >= 0) {
    messages.value.splice(index, 1, message)
    return false
  }

  messages.value.push(message)
  return true
}

function showToast(message) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
}

function openPreview(msg) {
  preview.value = { url: msg.attachmentUrl, type: msg.messageType, name: msg.attachmentName }
}

function closePreview() {
  preview.value = null
}

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
    link.href = objectUrl
    link.download = name || '下载文件'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
    downloadProgress.value = 100
    showToast('文件已保存')
  } catch {
    showToast('下载失败')
  } finally {
    setTimeout(() => { downloadProgress.value = null }, 500)
  }
}

function showContextMenu(event, msg) {
  event.preventDefault()
  const menuWidth = 140
  const menuHeight = canDeleteMessage(msg) ? 136 : 52
  const x = Math.max(8, Math.min(event.clientX || innerWidth / 2, innerWidth - menuWidth - 8))
  const y = Math.max(8, Math.min(event.clientY || innerHeight / 2, innerHeight - menuHeight - 8))
  contextMenu.value = { msg, x, y }
}

function startLongPress(event, msg) {
  clearTimeout(longPressTimer)
  const point = event.touches?.[0]
  const position = { preventDefault() {}, clientX: point?.clientX, clientY: point?.clientY }
  longPressTimer = setTimeout(() => showContextMenu(position, msg), 550)
}

function cancelLongPress() {
  clearTimeout(longPressTimer)
}

function canDeleteMessage(msg) {
  return msg.senderType !== 'system' && msg._id && !String(msg._id).startsWith('temp_')
}

function canRecallMessage(msg) {
  return msg.senderType === 'customer' && canDeleteMessage(msg) && !msg.recalledAt &&
    Date.now() - new Date(msg.createdAt).getTime() <= 2 * 60 * 1000
}

async function copyMessage(msg) {
  try {
    await navigator.clipboard.writeText(msg.content || msg.attachmentUrl || '')
    showToast('已复制')
  } catch {
    showToast('复制失败')
  }
  contextMenu.value = null
}

async function recallMessage(msg) {
  contextMenu.value = null
  try {
    const res = await api.post(`/client/conversation/messages/${msg._id}/recall`)
    if (res.code !== 0) throw new Error(res.message || '撤回失败')
    applyRecall(res.data || { messageId: msg._id, recalledAt: new Date().toISOString() })
    showToast('消息已撤回')
  } catch (error) {
    showToast(error?.message || '撤回失败')
  }
}

async function deleteMessage(msg) {
  contextMenu.value = null
  try {
    const res = await api.delete(`/client/conversation/messages/${msg._id}`)
    if (res.code !== 0) throw new Error(res.message || '删除失败')
    applyDelete(res.data || { messageId: msg._id })
    showToast('消息已删除')
  } catch (error) {
    showToast(error?.message || '删除失败')
  }
}

function applyRecall(data) {
  const messageId = data.messageId || data._id
  const msg = messages.value.find(item => String(item._id) === String(messageId))
  if (msg) Object.assign(msg, data, { recalledAt: data.recalledAt || new Date().toISOString(), content: '', attachmentUrl: '', attachmentName: '' })
}

function applyDelete(data) {
  messages.value = messages.value.filter(item => String(item._id) !== String(data.messageId || data._id))
}

async function handleAttachment(event, messageType) {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value || !customer.value) return

  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    const uploadRes = await api.post('/upload/client', formData)
    if (uploadRes.code !== 0) throw new Error(uploadRes.message || '上传失败')

    const effectiveType = uploadRes.data.mimetype?.startsWith('video/') ? 'video' : messageType
    const clientMessageId = 'c_' + Date.now()
    const payload = {
      content: effectiveType === 'image' ? '[图片]' : effectiveType === 'video' ? '[视频]' : `[文件] ${uploadRes.data.name || file.name}`,
      clientMessageId,
      messageType: effectiveType,
      attachmentUrl: uploadRes.data.url,
      attachmentName: uploadRes.data.name || file.name,
    }
    const localMsg = {
      _id: 'temp_' + Date.now(),
      senderType: 'customer',
      createdAt: new Date().toISOString(),
      ...payload,
    }
    mergeMessage(localMsg)
    showAttachments.value = false
    scrollToBottom()

    const res = await api.post('/client/conversation/messages', payload)
    if (res.code !== 0) throw new Error(res.message || '发送失败')
    mergeMessage(res.data?.message)
    mergeMessage(res.data?.botReply)
    scrollToBottom()
  } catch (error) {
    window.alert(error?.message || '附件发送失败')
  } finally {
    uploading.value = false
  }
}

async function sendMessage() {
  if (!inputText.value.trim() || sending.value || uploading.value) return
  sending.value = true
  
  const clientMessageId = 'c_' + Date.now()
  const localMsg = {
    _id: 'temp_' + Date.now(),
    clientMessageId,
    senderType: 'customer',
    content: inputText.value.trim(),
    createdAt: new Date().toISOString(),
  }
  messages.value.push(localMsg)
  const text = inputText.value.trim()
  inputText.value = ''
  await nextTick()
  scrollToBottom()
  
  try {
    const res = await api.post('/client/conversation/messages', {
      content: text,
      clientMessageId,
    })
    if (res.code === 0) {
      const result = res.data || {}
      const message = result.message
      const botReply = result.botReply
      mergeMessage(message)
      mergeMessage(botReply)
      await scrollOwnMessageToBottom()
    }
  } catch (e) {
    messages.value = messages.value.filter(m => m._id !== localMsg._id)
  } finally {
    sending.value = false
  }
}

function handleNewMessage(msg) {
  const isNewMessage = mergeMessage(msg)
  if (!isNewMessage) return
  if (['agent', 'bot'].includes(msg.senderType)) playNotificationSound()
  scheduleScroll(false)
}

function handleConversationUpdated(data) {
  if (data.status) conversationStatus.value = data.status
}

function handleConversationClosed(data) {
  conversationStatus.value = data.status || 'closed'
  scheduleScroll(false)
}

function setupSocket() {
  const savedToken = localStorage.getItem('client_token')
  if (!savedToken) return

  socket = getSocket(savedToken)
  socket.off('message.new', handleNewMessage)
  socket.off('message.recalled', applyRecall)
  socket.off('message.deleted', applyDelete)
  socket.off('conversation.updated', handleConversationUpdated)
  socket.off('conversation.closed', handleConversationClosed)
  socket.on('message.new', handleNewMessage)
  socket.on('message.recalled', applyRecall)
  socket.on('message.deleted', applyDelete)
  socket.on('conversation.updated', handleConversationUpdated)
  socket.on('conversation.closed', handleConversationClosed)
}

async function scheduleScroll(force = true) {
  pendingScrollForce = pendingScrollForce || force
  await nextTick()
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    const shouldForce = pendingScrollForce
    pendingScrollForce = false
    scrollFrame = null
    const container = msgContainer.value
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120
    if (shouldForce || nearBottom) container.scrollTop = container.scrollHeight
  })
}

function scrollToBottom() {
  return scheduleScroll(true)
}

async function scrollInitialMessagesToBottom() {
  initialScrollTimers.forEach(clearTimeout)
  initialScrollTimers = []
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await scrollToBottom()
  const container = msgContainer.value
  if (!container) return
  container.querySelectorAll('.message-image').forEach(media => {
    const eventName = media.tagName === 'VIDEO' ? 'loadedmetadata' : 'load'
    if (media.tagName === 'IMG' && media.complete) return
    media.addEventListener(eventName, scrollToBottom, { once: true })
  })
  ;[100, 300, 800].forEach(delay => {
    initialScrollTimers.push(setTimeout(scrollToBottom, delay))
  })
}

async function scrollOwnMessageToBottom() {
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const container = msgContainer.value
  if (!container) return
  container.scrollTop = container.scrollHeight
  const images = container.querySelectorAll('.msg.customer img:not(.msg-avatar)')
  images.forEach(image => {
    if (!image.complete) image.addEventListener('load', scrollToBottom, { once: true })
  })
}

watch(
  () => [loading.value, customer.value?._id],
  ([isLoading, customerId]) => {
    if (!isLoading && customerId) scheduleScroll(true)
  },
  { flush: 'post' },
)

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toTimeString().slice(0, 5)
  }
  return `${d.getMonth()+1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`
}

function generateFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
  ].join('|')
  return btoa(raw)
}

onMounted(() => {
  window.addEventListener('pointerdown', unlockNotificationSound, { once: true })
  window.addEventListener('keydown', unlockNotificationSound, { once: true })
  loadChannel()
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', unlockNotificationSound)
  window.removeEventListener('keydown', unlockNotificationSound)
  clearTimeout(toastTimer)
  clearTimeout(longPressTimer)
  initialScrollTimers.forEach(clearTimeout)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  if (socket) {
    socket.off('message.new', handleNewMessage)
    socket.off('message.recalled', applyRecall)
    socket.off('message.deleted', applyDelete)
    socket.off('conversation.updated', handleConversationUpdated)
    socket.off('conversation.closed', handleConversationClosed)
    socket.disconnect()
  }
  notificationAudioContext?.close().catch(() => {})
})
</script>
