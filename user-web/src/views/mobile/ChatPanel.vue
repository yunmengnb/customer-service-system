<!-- 忆梦云团队开发 - 手机端聊天展示组件独立实现 -->
<script setup>
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { io } from 'socket.io-client'
import api from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

const props = defineProps({ conversationId: { type: String, default: null } })
const emit = defineEmits(['back'])

const conversation = ref(null)
const messages = ref([])
const quickReplies = ref([])
const input = ref('')
const sending = ref(false)
const accepted = ref(false)
const loading = ref(false)
const msgContainer = ref(null)
const loadingHistory = ref(false)
const hasMoreMessages = ref(true)
let socket = null

const uploading = ref(false)
const showInfo = ref(false)
const showMore = ref(false)
const showCloseConfirm = ref(false)
const closing = ref(false)
const preview = ref(null)
const contextMenu = ref(null)
const downloadProgress = ref(null)
const toast = ref('')
let toastTimer = null
let longPressTimer = null

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
    const res = await api.get(`/tenant/conversations/${props.conversationId}/messages`, { params: { limit: 50 } })
    if (res.code === 0) {
      messages.value = res.data || []
      hasMoreMessages.value = messages.value.length === 50
      await scrollToLatest()
    }
  } catch {}
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

async function sendMsg() {
  if (!input.value.trim() || sending.value) return
  if (!accepted.value) { alert('请先接入会话'); return }
  sending.value = true
  const text = input.value.trim(); input.value = ''
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/messages`, {
      content: text, clientMessageId: 'a_' + Date.now(),
    })
    if (res.code === 0) { messages.value.push(res.data); await scrollToLatest() }
  } catch (e) { input.value = text; alert(e?.message || '发送失败') }
  finally { sending.value = false }
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
        content: mediaType !== 'file' ? fi.url : '',
        attachmentUrl: fi.url, attachmentName: fi.name,
        clientMessageId: 'up_' + Date.now(),
      }
      const sr = await api.post(`/tenant/conversations/${props.conversationId}/messages`, body)
      if (sr.code === 0) { messages.value.push(sr.data); await scrollToLatest() }
    } else alert(res.message || '上传失败')
  } catch (e) { alert(e?.message || '上传失败') }
  finally { uploading.value = false; ev.target.value = '' }
}

function setupSocket() {
  socket?.disconnect()
  const token = sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token')
  if (!token) return
  socket = io({ auth: { token, type: 'tenant_user' }, transports: ['websocket', 'polling'] })
  socket.on('message.new', (msg) => {
    if (String(msg.conversationId) === String(props.conversationId)) { messages.value.push(msg); nextTick(scrollToBottom) }
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
    if (conversation.value) { await loadQuickReplies(); setupSocket() }
  } catch {} finally {
    loading.value = false
    await scrollToLatest()
  }
}

watch(() => props.conversationId, (id) => {
  socket?.disconnect(); socket = null
  if (id) init()
  else { conversation.value = null; messages.value = [] }
}, { immediate: true })

onUnmounted(() => { socket?.disconnect(); clearTimeout(toastTimer); clearTimeout(longPressTimer) })

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
  const x = Math.min(event.clientX || innerWidth / 2, innerWidth - 150)
  const y = Math.min(event.clientY || innerHeight / 2, innerHeight - 160)
  contextMenu.value = { msg, x, y }
}
function startLongPress(event, msg) {
  clearTimeout(longPressTimer)
  const point = event.touches?.[0]
  const position = { preventDefault() {}, clientX: point?.clientX, clientY: point?.clientY }
  longPressTimer = setTimeout(() => showContextMenu(position, msg), 550)
}
function cancelLongPress() { clearTimeout(longPressTimer) }
async function copyMessage(msg) {
  await navigator.clipboard.writeText(msg.content || msg.attachmentUrl || '')
  contextMenu.value = null; showToast('已复制')
}
async function recallMessage(msg) {
  try {
    await api.post(`/tenant/conversations/${props.conversationId}/messages/${msg._id}/recall`)
    Object.assign(msg, { recalledAt: new Date().toISOString(), content: '', attachmentUrl: '', attachmentName: '' })
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
  if (msg) Object.assign(msg, { recalledAt: data.recalledAt, content: '', attachmentUrl: '', attachmentName: '' })
}
function applyDelete(data) {
  if (String(data.conversationId) === String(props.conversationId)) messages.value = messages.value.filter(item => String(item._id) !== String(data.messageId))
}
function useQuickReply(text) { input.value = text; showMore.value = false }
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
        <button class="cp-back" type="button" aria-label="返回消息列表" @click="emit('back')">←</button>
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
            <div class="cp-sub">
              {{ conversation.channel?.name || '—' }} · {{ conversation.customer?.email || '无邮箱' }}
            </div>
          </div>
        </div>
        <div class="cp-header-actions">
          <button v-if="!accepted && conversation.status !== 'closed'" class="cp-btn cp-btn-primary" @click="accept">接入</button>
          <button v-if="conversation.status === 'active'" class="cp-btn cp-btn-danger" @click="showCloseConfirm = true">结束</button>
        </div>
      </header>

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

          <div v-else-if="msg.senderType === 'system'" class="cp-system-msg">
            <span>{{ msg.content }}</span>
          </div>

          <div v-else class="cp-bubble-row" :class="msg.senderType === 'customer' ? 'is-left' : 'is-right'">
            <template v-if="msg.senderType === 'customer'">
              <img v-if="conversation.customer?.avatarUrl" class="cp-bubble-avatar" :src="conversation.customer.avatarUrl" alt="客户头像" />
              <div v-else class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#f59e0b,#d97706)` }">{{ avatarChar() }}</div>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble cp-bubble-customer" @contextmenu="showContextMenu($event, msg)" @touchstart="startLongPress($event, msg)" @touchend="cancelLongPress" @touchcancel="cancelLongPress" @touchmove="cancelLongPress">
                  <template v-if="msg.recalledAt"><span class="cp-recalled">消息已撤回</span></template>
                  <img v-else-if="msg.messageType === 'image' && msg.attachmentUrl" :src="msg.attachmentUrl" class="cp-bubble-img" @click="openPreview(msg)" />
                  <video v-else-if="msg.messageType === 'video' && msg.attachmentUrl" :src="msg.attachmentUrl" class="cp-bubble-img" @click.prevent="openPreview(msg)"></video>
                  <button v-else-if="msg.messageType === 'file' && msg.attachmentUrl" class="cp-bubble-file" @click="downloadFile(msg.attachmentUrl, msg.attachmentName)">
                    📎 {{ msg.attachmentName || '文件' }}
                  </button>
                  <template v-else>{{ msg.content }}</template>
                </div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
            </template>

            <template v-else>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble" @contextmenu="showContextMenu($event, msg)" @touchstart="startLongPress($event, msg)" @touchend="cancelLongPress" @touchcancel="cancelLongPress" @touchmove="cancelLongPress">
                  <template v-if="msg.recalledAt"><span class="cp-recalled">消息已撤回</span></template>
                  <img v-else-if="msg.messageType === 'image' && msg.attachmentUrl" :src="msg.attachmentUrl" class="cp-bubble-img" @click="openPreview(msg)" />
                  <video v-else-if="msg.messageType === 'video' && msg.attachmentUrl" :src="msg.attachmentUrl" class="cp-bubble-img" @click.prevent="openPreview(msg)"></video>
                  <button v-else-if="msg.messageType === 'file' && msg.attachmentUrl" class="cp-bubble-file" @click="downloadFile(msg.attachmentUrl, msg.attachmentName)">
                    📎 {{ msg.attachmentName || '文件' }}
                  </button>
                  <template v-else>{{ msg.content }}</template>
                </div>
                <div v-if="msg.autoReplyType === 'keyword'" class="cp-keyword-reply-notice">关键词自动回复内容可作为参考</div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
              <img v-if="msg.senderType === 'agent' && msg.sender?.avatarUrl" class="cp-bubble-avatar" :src="msg.sender.avatarUrl" alt="客服头像" />
              <div v-else class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#2563eb,#1d4ed8)` }">{{ msg.senderType === 'bot' ? 'AI' : (msg.sender?.displayName?.[0] || '我') }}</div>
            </template>
          </div>
        </template>
      </div>

      <!-- 快捷回复 -->
      <div v-if="quickReplies.length > 0 && accepted && conversation.status === 'active'" class="cp-quick">
        <button v-for="qr in quickReplies" :key="qr._id" class="cp-quick-btn" @click="useQuickReply(qr.content)">{{ qr.title }}</button>
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
            :disabled="!accepted || conversation.status === 'closed'"
          ></textarea>
          <button class="cp-send-btn" @click="sendMsg" :disabled="sending || !input.trim() || !accepted">发送</button>
        </div>

        <div v-if="showMore" class="cp-more-panel">
          <div class="cp-more-grid">
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept="image/*,video/*,.pdf,.zip,.doc,.docx" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">📎</span><span>发送文件</span>
            </label>
            <button class="cp-more-item" @click="showInfo = true">
              <span class="cp-more-icon">👤</span><span>客户资料</span>
            </button>
          </div>
        </div>
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

    <div v-if="contextMenu" class="cp-menu-mask" @pointerdown="contextMenu = null">
      <div class="cp-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop>
        <button v-if="contextMenu.msg.messageType !== 'image'" type="button" @click="copyMessage(contextMenu.msg)">复制</button>
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
          <div class="cp-info-row"><span>手机号</span><span>{{ conversation.customer?.phone || '-' }}</span></div>
          <div class="cp-info-row"><span>QQ号</span><span>{{ conversation.customer?.qq || '未填写' }}</span></div>
          <div class="cp-info-row"><span>邮箱</span><span>{{ conversation.customer?.email || '未填写' }}</span></div>
          <div class="cp-info-row"><span>昵称</span><span>{{ conversation.customer?.nickname || '访客' }}</span></div>
          <div class="cp-info-row"><span>所属渠道</span><span>{{ conversation.channel?.name || '-' }}</span></div>
          <div class="cp-info-row"><span>注册 IP</span><span>{{ conversation.customer?.registerIp || '-' }}</span></div>
          <div class="cp-info-row"><span>浏览器</span><span class="cp-info-ua">{{ conversation.customer?.registerUserAgent || '-' }}</span></div>
          <div class="cp-info-row"><span>注册时间</span><span>{{ formatDateTime(conversation.customer?.createdAt) }}</span></div>
          <div class="cp-info-row"><span>会话 ID</span><span class="cp-info-id">{{ conversation._id }}</span></div>
          <div class="cp-info-row"><span>接入时间</span><span>{{ formatDateTime(conversation.acceptedAt) }}</span></div>
          <div class="cp-info-row"><span>结束时间</span><span>{{ formatDateTime(conversation.closedAt) }}</span></div>
        </div>
      </div>
    </div>

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
.cp-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
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
.cp-bubble-time { font-size: 11px; color: #94a3b8; line-height: 1; padding: 0 2px; }

/* 客户气泡：左 */
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
  background: #2563eb; color: #fff;
  border-radius: 16px 4px 16px 16px;
  box-shadow: 0 1px 2px rgba(37,99,235,.25);
}
.cp-bubble-row.is-right .cp-bubble::before {
  content: ''; position: absolute; right: -6px; top: 12px;
  width: 0; height: 0; border-top: 6px solid transparent;
  border-bottom: 6px solid transparent; border-left: 6px solid #2563eb;
}

.cp-bubble {
  position: relative; max-width: 100%; padding: 11px 15px;
  font-size: 15px; line-height: 1.55; word-break: break-word;
}
.cp-bubble-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 13px; object-fit: cover;
}
.cp-bubble.cp-image-message-bubble { padding: 0; background: transparent; border: 0; box-shadow: none; }
.cp-bubble.cp-image-message-bubble::before { display: none; }
.cp-bubble-img { max-width: 200px; border-radius: 8px; display: block; cursor: pointer; }
.cp-bubble-file {
  display: inline-flex; align-items: center; gap: 6px;
  background: #eff6ff; color: #2563eb; text-decoration: none;
  padding: 6px 12px; border-radius: 6px; font-size: 13px;
}
.cp-bubble-row.is-right .cp-bubble-file { background: rgba(255,255,255,.2); color: #fff; }

/* 快捷回复 */
.cp-quick {
  display: flex; gap: 6px; padding: 8px 16px; background: #fff;
  border-top: 1px solid #f1f5f9; overflow-x: auto; flex-shrink: 0;
}
.cp-quick-btn {
  flex-shrink: 0; padding: 5px 12px; border-radius: 14px;
  border: 1px solid #dbeafe; background: #eff6ff; color: #2563eb;
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.cp-quick-btn:hover { background: #dbeafe; }

/* 输入区 */
.cp-input-area { padding: 10px 16px; background: #fff; border-top: 1px solid #e2e8f0; flex-shrink: 0; }
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