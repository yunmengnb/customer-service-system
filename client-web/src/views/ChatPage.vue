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
  <div
    v-else
    class="chat-page"
    :style="{ position: 'fixed', insetInline: 0, height: viewportHeight, top: viewportTop }"
  >
    <div class="chat-header">
      <img v-if="channel.avatarUrl" class="chat-avatar" :src="channel.avatarUrl" alt="渠道头像" />
      <div v-else class="chat-avatar">{{ channel.brandName?.[0] || '客' }}</div>
      <div class="chat-header-info">
        <div class="chat-header-name">
          <span>{{ channel.brandName || '在线客服' }}</span>
          <span class="agent-presence" :class="agentOnline ? 'is-online' : 'is-offline'">
            <span class="agent-presence-dot"></span>
            {{ agentOnline ? '在线' : '离线' }}
          </span>
        </div>
        <div class="chat-header-status">
          <span v-if="conversationStatus === 'active'">客服已接入</span>
          <span v-else-if="conversationStatus === 'closed'">会话已结束，再次发送消息可重新咨询</span>
          <span v-else>等待客服接入...</span>
        </div>
      </div>
      <button class="profile-trigger" v-if="customer" @click="openDashboard">
        控制面板
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
            <div class="msg-main">
              <span v-if="msg.sendFailed" class="message-send-error" title="消息发送失败">!</span>
            <div
              class="msg-bubble"
              :class="{ 'media-message-bubble': ['image', 'video', 'file'].includes(msg.messageType) && msg.attachmentUrl, 'message-menu-active': contextMenu?.msg === msg }"
              @contextmenu="showContextMenu($event, msg)"
              @touchstart="startLongPress($event, msg)"
              @touchend="finishLongPress"
              @touchcancel="cancelLongPress"
              @touchmove="moveLongPress"
              @click.capture="handleBubbleClick"
            >
              <span v-if="msg.recalledAt" class="message-recalled">消息已撤回</span>
              <template v-else-if="msg.messageType === 'image' && msg.attachmentUrl"><img class="message-image" :src="msg.attachmentUrl" :alt="msg.attachmentName || '图片'" loading="lazy" decoding="async" @load="scheduleScroll(false)" @click="openPreview(msg)" /><div v-if="imageCaption(msg)" class="message-caption">{{ imageCaption(msg) }}</div></template>
              <template v-else-if="msg.messageType === 'video' && msg.attachmentUrl">
                <button type="button" class="message-video-wrap" :aria-label="`播放${msg.attachmentName || '视频'}`" @click="openPreview(msg)">
                  <span class="video-thumbnail-placeholder">视频</span>
                  <img class="message-image message-video" :src="videoPosterUrl(msg)" :alt="msg.attachmentName || '视频封面'" loading="lazy" decoding="async" @load="handleVideoThumbnailLoad" @error="handleVideoThumbnailError" />
                  <span class="video-play-icon" aria-hidden="true">▶</span>
                </button>
              </template>
              <button v-else-if="msg.messageType === 'file' && msg.attachmentUrl" type="button" class="message-file" @click="downloadFile(msg.attachmentUrl, msg.attachmentName)">
                <span class="message-file-icon">▤</span>
                <span>{{ msg.attachmentName || '下载文件' }}</span>
              </button>
              <template v-else>
                <template v-for="(part, index) in parseMessageContent(msg.content)" :key="index">
                  <a
                    v-if="part.type === 'link'"
                    class="message-link"
                    :href="part.href"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click.stop
                  >{{ part.text }}</a>
                  <span v-else>{{ part.text }}</span>
                </template>
              </template>
            </div>
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
          <button type="button" class="attachment-action" :disabled="uploading" @click="videoInput?.click()">
            <span class="attachment-icon attachment-video-icon">▷</span>
            <span>上传视频</span>
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
          @focus="handleComposerFocus"
          @keydown.enter.exact="handleMessageEnter"
          rows="1"
        ></textarea>
        <button class="send-button" @click="sendMessage" :disabled="!customer || !inputText.trim() || sending || uploading">
          发送
        </button>
      </div>

      <input ref="imageInput" class="hidden-file-input" type="file" accept="image/*" @change="handleAttachment($event, 'image')" />
      <input ref="videoInput" class="hidden-file-input" type="file" accept="video/*" @change="handleAttachment($event, 'video')" />
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

    <!-- 客户控制面板 -->
    <div v-if="showDashboard" class="modal-overlay dashboard-overlay" @click.self="closeDashboard">
      <section class="dashboard-panel" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
        <header class="dashboard-header">
          <div>
            <div class="dashboard-eyebrow">客户中心</div>
            <h2 id="dashboard-title">控制面板</h2>
          </div>
          <button type="button" class="dashboard-close" aria-label="关闭控制面板" @click="closeDashboard">×</button>
        </header>

        <div class="dashboard-profile">
          <img v-if="customer?.avatarUrl" :src="customer.avatarUrl" alt="客户头像" />
          <div v-else class="dashboard-avatar">{{ customer?.nickname?.[0] || '我' }}</div>
          <div>
            <strong>{{ customer?.nickname || '访客' }}</strong>
            <span>{{ customer?.phone }}</span>
          </div>
        </div>

        <nav class="dashboard-tabs" aria-label="控制面板导航">
          <button type="button" :class="{ active: dashboardTab === 'profile' }" @click="dashboardTab = 'profile'">账号资料</button>
          <button type="button" :class="{ active: dashboardTab === 'security' }" @click="dashboardTab = 'security'">安全设置</button>
        </nav>

        <div v-if="dashboardTab === 'profile'" class="dashboard-content">
          <div class="dashboard-info-grid">
            <div><span>手机号</span><strong>{{ customer?.phone || '-' }}</strong></div>
            <div><span>QQ号</span><strong>{{ customer?.qq || '未完善' }}</strong></div>
            <div><span>邮箱</span><strong>{{ customer?.email || '未完善' }}</strong></div>
            <div><span>注册时间</span><strong>{{ formatDate(customer?.createdAt) }}</strong></div>
          </div>
          <button type="button" class="dashboard-primary" @click="goToAccount">进入客户后台</button>
        </div>

        <form v-else class="dashboard-content password-form" @submit.prevent="submitPassword">
          <div class="form-item">
            <label for="current-password">当前密码</label>
            <input id="current-password" v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" placeholder="请输入当前密码" />
          </div>
          <div class="form-item">
            <label for="new-password">新密码</label>
            <input id="new-password" v-model="passwordForm.newPassword" type="password" autocomplete="new-password" placeholder="请输入6-72位新密码" />
          </div>
          <div class="form-item">
            <label for="confirm-password">确认新密码</label>
            <input id="confirm-password" v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" />
          </div>
          <div v-if="passwordMessage" :class="['password-feedback', passwordSuccess ? 'success' : 'error']">{{ passwordMessage }}</div>
          <button type="submit" class="dashboard-primary" :disabled="passwordLoading">{{ passwordLoading ? '修改中...' : '确认修改密码' }}</button>
        </form>
      </section>
    </div>

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
        <div v-if="captcha.enabled && captcha.provider === 'image'" class="form-item">
          <label>图形验证码</label>
          <div class="captcha-row">
            <input
              v-model.trim="captchaCode"
              autocomplete="off"
              maxlength="8"
              placeholder="请输入验证码"
              @keyup.enter="doLogin"
            />
            <button type="button" class="captcha-image-button" :disabled="captchaLoading" @click="loadCaptcha">
              <img v-if="captcha.image" :src="captcha.image" alt="图形验证码" />
              <span v-else>{{ captchaLoading ? '加载中...' : '点击刷新' }}</span>
            </button>
          </div>
        </div>
        <div v-else-if="captcha.enabled && captcha.provider === 'geetest'" class="captcha-tip">
          {{ geetestReady ? '点击进入聊天后完成安全验证' : (captchaLoading ? '正在加载安全验证...' : '安全验证加载失败，请重试') }}
        </div>
        <div class="err" v-if="loginErr">{{ loginErr }}</div>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="doLogin" :disabled="loginLoading || captchaLoading">
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
import { useRoute, useRouter } from 'vue-router'
import { api, getSocket } from '../api'

const route = useRoute()
const router = useRouter()
const token = computed(() => route.params.token)

const loading = ref(true)
const channel = ref(null)
const customer = ref(null)
const conversationStatus = ref('waiting')
const assignedAgentId = ref('')
const agentOnline = ref(false)
const messages = ref([])
const inputText = ref('')
const sending = ref(false)
const uploading = ref(false)
const showAttachments = ref(false)
const imageInput = ref(null)
const videoInput = ref(null)
const fileInput = ref(null)
const msgContainer = ref(null)
const loadingHistory = ref(false)
const hasMoreMessages = ref(true)
const preview = ref(null)
const contextMenu = ref(null)
const downloadProgress = ref(null)
const toast = ref('')
const viewportHeight = ref('100dvh')
const viewportTop = ref('0px')

const showLogin = ref(false)
const loginForm = ref({ phone: '', password: '' })
const loginLoading = ref(false)
const loginErr = ref('')
const captcha = ref({ enabled: false, provider: '', captchaId: '', image: '' })
const captchaCode = ref('')
const captchaLoading = ref(false)
const geetestReady = ref(false)

const showQQModal = ref(false)
const qqForm = ref({ qq: '' })
const qqLoading = ref(false)
const qqErr = ref('')

const showDashboard = ref(false)
const dashboardTab = ref('profile')
const passwordForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })
const passwordLoading = ref(false)
const passwordMessage = ref('')
const passwordSuccess = ref(false)

let socket = null
let notificationAudioContext = null
let messageSyncTimer = null
let messageSyncInFlight = false
let toastTimer = null
let longPressTimer = null
let longPressStart = null
let suppressBubbleClickUntil = 0
let initialScrollTimers = []
let scrollFrame = null
let pendingScrollForce = false
let geetestInstance = null
let geetestScriptPromise = null

function loadGeetestScript() {
  if (window.initGeetest) return Promise.resolve()
  if (geetestScriptPromise) return geetestScriptPromise
  geetestScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://static.geetest.com/static/tools/gt.js'
    script.async = true
    script.onload = () => window.initGeetest ? resolve() : reject(new Error('极验组件初始化失败'))
    script.onerror = () => reject(new Error('极验组件加载失败'))
    document.head.appendChild(script)
  }).catch(error => {
    geetestScriptPromise = null
    throw error
  })
  return geetestScriptPromise
}

async function initializeGeetest(captchaConfig) {
  const gt = captchaConfig.gt
  const challenge = captchaConfig.challenge
  if (!gt || !challenge) throw new Error('极验 V3 初始化参数不完整')

  geetestReady.value = false
  geetestInstance?.destroy?.()
  geetestInstance = null
  await loadGeetestScript()
  await new Promise((resolve, reject) => {
    window.initGeetest({
      gt,
      challenge,
      offline: captchaConfig.success === false || captchaConfig.success === 0,
      new_captcha: captchaConfig.new_captcha ?? captchaConfig.newCaptcha ?? true,
      product: 'bind',
      width: '100%',
    }, instance => {
      geetestInstance = instance
      instance.onReady(() => {
        geetestReady.value = true
        resolve()
      })
      instance.onError(error => reject(new Error(error?.msg || '极验组件初始化失败')))
    })
  })
}

async function loadCaptcha() {
  captchaLoading.value = true
  captchaCode.value = ''
  geetestReady.value = false
  try {
    const res = await api.get(`/client/channels/${token.value}/captcha`)
    if (res.code !== 0) throw new Error(res.message || '验证码加载失败')
    captcha.value = { enabled: false, provider: '', captchaId: '', image: '', ...res.data }
    if (captcha.value.enabled && captcha.value.provider === 'geetest') {
      await initializeGeetest(captcha.value)
    }
  } catch (error) {
    captcha.value = { enabled: true, provider: '', captchaId: '', image: '' }
    loginErr.value = error?.message || '验证码加载失败，请刷新重试'
  } finally {
    captchaLoading.value = false
  }
}

function getGeetestValidation() {
  return new Promise((resolve, reject) => {
    if (!geetestInstance || !geetestReady.value) {
      reject(new Error('安全验证尚未加载完成'))
      return
    }
    geetestInstance.onSuccess(() => {
      const result = geetestInstance.getValidate()
      if (result) resolve(result)
      else reject(new Error('请完成安全验证'))
    })
    geetestInstance.onError(error => reject(new Error(error?.msg || '安全验证失败')))
    geetestInstance.onClose(() => reject(new Error('请完成安全验证')))
    geetestInstance.verify()
  })
}

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
    document.title = channelRes.data.brandName || '在线客服'
    if (!assignedAgentId.value) agentOnline.value = Boolean(channelRes.data.agentOnline)

    let meRes = meResult.status === 'fulfilled' ? meResult.value : null
    if (meRes?.code === 0 && String(meRes.data.channelId) !== String(channelRes.data.id)) {
      try {
        const switchRes = await api.post(`/client/channels/${token.value}/switch`)
        if (switchRes.code === 0) {
          localStorage.setItem('client_token', switchRes.data.token)
          meRes = await api.get('/client/me')
        } else {
          meRes = null
        }
      } catch {
        meRes = null
      }
    }
    if (meRes?.code === 0) {
      customer.value = meRes.data
      setupSocket()
      await Promise.all([loadConversation(), loadMessages()])
      if (!customer.value.qq) showQQModal.value = true
    } else {
      showLogin.value = true
      await loadCaptcha()
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
  if (captcha.value.enabled && captcha.value.provider === 'image' && !captchaCode.value) {
    loginErr.value = '请输入图形验证码'
    return
  }
  if (captcha.value.enabled && !['image', 'geetest'].includes(captcha.value.provider)) {
    loginErr.value = '安全验证加载失败，请刷新页面重试'
    return
  }
  loginLoading.value = true
  try {
    let captchaPayload = {}
    if (captcha.value.enabled && captcha.value.provider === 'image') {
      captchaPayload = { captchaId: captcha.value.captchaId, captchaCode: captchaCode.value }
    } else if (captcha.value.enabled && captcha.value.provider === 'geetest') {
      captchaPayload = await getGeetestValidation()
    }
    const res = await api.post(`/client/channels/${token.value}/auth`, {
      phone: loginForm.value.phone,
      password: loginForm.value.password,
      fingerprint: generateFingerprint(),
      ...captchaPayload,
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
    if (captcha.value.enabled && captcha.value.provider === 'image') await loadCaptcha()
    geetestInstance?.reset?.()
  } finally {
    loginLoading.value = false
  }
}

function openQQModal() {
  qqForm.value.qq = customer.value?.qq || ''
  qqErr.value = ''
  showQQModal.value = true
}

function openDashboard() {
  dashboardTab.value = 'profile'
  passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  passwordMessage.value = ''
  passwordSuccess.value = false
  showDashboard.value = true
}

function closeDashboard() {
  showDashboard.value = false
  passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  passwordMessage.value = ''
}

function goToAccount() {
  showDashboard.value = false
  router.push('/account')
}

function editQQFromDashboard() {
  showDashboard.value = false
  openQQModal()
}

async function submitPassword() {
  passwordMessage.value = ''
  passwordSuccess.value = false
  const { currentPassword, newPassword, confirmPassword } = passwordForm.value
  if (!currentPassword || !newPassword || !confirmPassword) {
    passwordMessage.value = '请填写完整密码信息'
    return
  }
  if (newPassword.length < 6 || newPassword.length > 72) {
    passwordMessage.value = '新密码须为6-72位'
    return
  }
  if (newPassword !== confirmPassword) {
    passwordMessage.value = '两次输入的新密码不一致'
    return
  }

  passwordLoading.value = true
  try {
    const res = await api.post('/client/profile/password', passwordForm.value)
    if (res.code !== 0) throw new Error(res.message || '密码修改失败')
    passwordSuccess.value = true
    passwordMessage.value = res.message || '密码修改成功'
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    localStorage.removeItem('client_token')
    setTimeout(() => {
      showDashboard.value = false
      showLogin.value = true
    }, 1200)
  } catch (error) {
    passwordMessage.value = error?.message || '密码修改失败'
  } finally {
    passwordLoading.value = false
  }
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
      assignedAgentId.value = String(res.data.agent?.id || res.data.assignedAgentId || '')
      queryAgentPresence()
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

async function syncLatestMessages() {
  if (!customer.value || messageSyncInFlight) return
  messageSyncInFlight = true
  try {
    const res = await api.get('/client/conversation/messages', { params: { limit: 50 } })
    if (res.code === 0) {
      const previousLength = messages.value.length
      ;(res.data || []).forEach(mergeMessage)
      if (messages.value.length > previousLength) scheduleScroll(false)
    }
  } catch {}
  finally { messageSyncInFlight = false }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') syncLatestMessages()
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
  cancelLongPress()
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

function markMessageFailed(message) {
  const index = messages.value.findIndex(item => String(item._id) === String(message?._id))
  if (index < 0) return
  messages.value.splice(index, 1, { ...messages.value[index], sendFailed: true })
}

function showToast(message) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
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
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }

    const trailing = match[0].match(/[，。！？；：、,.!?;:]+$/)?.[0] || ''
    const text = trailing ? match[0].slice(0, -trailing.length) : match[0]
    parts.push({
      type: 'link',
      text,
      href: text.toLowerCase().startsWith('www.') ? `https://${text}` : text,
    })
    if (trailing) parts.push({ type: 'text', text: trailing })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) parts.push({ type: 'text', text: content.slice(lastIndex) })
  return parts.length ? parts : [{ type: 'text', text: content }]
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

function closeContextMenu() {
  contextMenu.value = null
}

function startLongPress(event, msg) {
  clearTimeout(longPressTimer)
  const point = event.touches?.[0]
  if (!point) return
  longPressStart = { x: point.clientX, y: point.clientY }
  const position = { preventDefault() {}, clientX: point.clientX, clientY: point.clientY }
  longPressTimer = setTimeout(() => {
    suppressBubbleClickUntil = Date.now() + 700
    showContextMenu(position, msg)
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

function canDeleteMessage(msg) {
  return msg.senderType !== 'system' && msg._id && !String(msg._id).startsWith('temp_')
}

function canRecallMessage(msg) {
  return msg.senderType === 'customer' && canDeleteMessage(msg) && !msg.recalledAt &&
    Date.now() - new Date(msg.createdAt).getTime() <= 2 * 60 * 1000
}

function videoPosterUrl(msg) {
  if (msg.thumbnailUrl) return msg.thumbnailUrl
  if (!msg.attachmentUrl) return ''
  return msg.attachmentUrl.replace(/\.[^./?#]+(?:[?#].*)?$/, '.thumbnail.jpg')
}

function handleVideoThumbnailLoad(event) {
  event.currentTarget.classList.add('is-loaded')
  event.currentTarget.closest('.message-video-wrap')?.classList.add('has-thumbnail')
  scheduleScroll(false)
}

function handleVideoThumbnailError(event) {
  event.currentTarget.hidden = true
  event.currentTarget.closest('.message-video-wrap')?.classList.add('has-thumbnail-error')
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
  if (msg) Object.assign(msg, data, { recalledAt: data.recalledAt || new Date().toISOString(), content: '', attachmentUrl: '', attachmentName: '', thumbnailUrl: '' })
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
  let localMsg = null
  try {
    const formData = new FormData()
    formData.append('file', file)
    const uploadRes = await api.post('/upload/client', formData)
    if (uploadRes.code !== 0) throw new Error(uploadRes.message || '上传失败')

    const effectiveType = uploadRes.data.mimetype?.startsWith('video/') ? 'video' : messageType
    const clientMessageId = 'c_' + Date.now()
    const payload = {
      content: effectiveType === 'image' ? '' : effectiveType === 'video' ? '[视频]' : `[文件] ${uploadRes.data.name || file.name}`,
      clientMessageId,
      messageType: effectiveType,
      attachmentUrl: uploadRes.data.url,
      attachmentName: uploadRes.data.name || file.name,
      thumbnailUrl: uploadRes.data.thumbnailUrl || '',
    }
    localMsg = {
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
    if (localMsg && error?.code === 4034) {
      markMessageFailed(localMsg)
      await nextTick()
      scrollToBottom()
    } else window.alert(error?.message || '附件发送失败')
  } finally {
    uploading.value = false
  }
}

function handleMessageEnter(event) {
  if (event.isComposing) return
  event.preventDefault()
  sendMessage()
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
    if (e?.code === 4034) {
      markMessageFailed(localMsg)
      await nextTick()
      scrollToBottom()
    } else {
      messages.value = messages.value.filter(m => m._id !== localMsg._id)
      if (e?.code === 4035) window.alert(e.message)
    }
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

function queryAgentPresence() {
  if (!socket?.connected) return
  const agentIds = assignedAgentId.value
    ? [assignedAgentId.value]
    : (channel.value?.agentIds || []).map(String)
  if (!agentIds.length) {
    agentOnline.value = false
    return
  }
  let pending = agentIds.length
  let anyOnline = false
  agentIds.forEach(userId => {
    socket.emit('presence:query', { type: 'tenant_user', userId }, ({ online } = {}) => {
      anyOnline = anyOnline || Boolean(online)
      pending -= 1
      if (!pending) agentOnline.value = anyOnline
    })
  })
}

function handlePresenceChanged(data) {
  if (data.type !== 'tenant_user') return
  const relevantIds = assignedAgentId.value
    ? [assignedAgentId.value]
    : (channel.value?.agentIds || []).map(String)
  if (relevantIds.includes(String(data.userId))) queryAgentPresence()
}

function handleConversationUpdated(data) {
  if (data.status) conversationStatus.value = data.status
  const agentId = data.agent?.id || data.assignedAgentId
  if (agentId) {
    assignedAgentId.value = String(agentId)
    queryAgentPresence()
  }
}

function handleConversationClosed(data) {
  conversationStatus.value = data.status || 'closed'
  scheduleScroll(false)
}

function setupSocket() {
  const savedToken = localStorage.getItem('client_token')
  if (!savedToken) return

  socket = getSocket(savedToken)
  socket.off('connect', syncLatestMessages)
  socket.off('message.new', handleNewMessage)
  socket.off('message.recalled', applyRecall)
  socket.off('message.deleted', applyDelete)
  socket.off('conversation.updated', handleConversationUpdated)
  socket.off('conversation.closed', handleConversationClosed)
  socket.off('presence:changed', handlePresenceChanged)
  socket.on('message.new', handleNewMessage)
  socket.on('connect', () => {
    syncLatestMessages()
    queryAgentPresence()
  })
  socket.on('message.recalled', applyRecall)
  socket.on('message.deleted', applyDelete)
  socket.on('conversation.updated', handleConversationUpdated)
  socket.on('conversation.closed', handleConversationClosed)
  socket.on('presence:changed', handlePresenceChanged)
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

function updateViewport() {
  const viewport = window.visualViewport
  viewportHeight.value = `${Math.round(viewport?.height || window.innerHeight)}px`
  viewportTop.value = `${Math.round(viewport?.offsetTop || 0)}px`
  scheduleScroll(false)
}

function handleComposerFocus() {
  showAttachments.value = false
  requestAnimationFrame(() => scheduleScroll(true))
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

function formatDate(iso) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
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
  updateViewport()
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  messageSyncTimer = setInterval(syncLatestMessages, 30000)
  loadChannel()
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', unlockNotificationSound)
  window.removeEventListener('keydown', unlockNotificationSound)
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  window.removeEventListener('resize', updateViewport)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  clearInterval(messageSyncTimer)
  clearTimeout(toastTimer)
  clearTimeout(longPressTimer)
  initialScrollTimers.forEach(clearTimeout)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  geetestInstance?.destroy?.()
  if (socket) {
    socket.off('message.new', handleNewMessage)
    socket.off('connect', syncLatestMessages)
    socket.off('message.recalled', applyRecall)
    socket.off('message.deleted', applyDelete)
    socket.off('conversation.updated', handleConversationUpdated)
    socket.off('conversation.closed', handleConversationClosed)
    socket.disconnect()
  }
  notificationAudioContext?.close().catch(() => {})
})
</script>
