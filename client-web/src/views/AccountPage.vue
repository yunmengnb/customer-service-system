<!-- 忆梦云团队开发 -->
<template>
  <div class="account-page">
    <header class="account-header">
      <div class="account-header-inner">
        <router-link class="account-brand" :to="currentChannelPath">客户中心</router-link>
        <button v-if="!isCustomerAndroidApp" type="button" class="account-install" @click="showDownloadModal = true">下载安卓客户端</button>
      </div>
    </header>

    <main class="account-main">
      <div v-if="loading && !customer" class="account-loading">正在进入客户中心...</div>
      <section v-else-if="!customer" class="account-auth-card">
        <div class="account-section-title">
          <div><h1>客户账号</h1><p>登录或注册后管理你的客服渠道</p></div>
        </div>
        <nav class="auth-tabs account-auth-tabs">
          <button type="button" :class="{ active: authTab === 'login' }" @click="switchAuthTab('login')">登录</button>
          <button type="button" :class="{ active: authTab === 'register' }" @click="switchAuthTab('register')">注册</button>
        </nav>
        <template v-if="authTab === 'login'">
          <div class="form-item"><label>手机号或邮箱</label><input v-model.trim="loginForm.identifier" autocomplete="username" placeholder="请输入手机号或邮箱" /></div>
          <div class="form-item"><label>密码</label><input v-model="loginForm.password" type="password" autocomplete="current-password" placeholder="请输入密码" @keyup.enter="submitLogin" /></div>
        </template>
        <template v-else>
          <div class="auth-form-grid">
            <div class="form-item"><label>手机号</label><input v-model.trim="registerForm.phone" inputmode="tel" placeholder="请输入手机号" /></div>
            <div class="form-item"><label>QQ号</label><input v-model.trim="registerForm.qq" inputmode="numeric" maxlength="12" placeholder="请输入5-12位QQ号" /></div>
          </div>
          <div class="form-item"><label>邮箱</label><input v-model.trim="registerForm.email" type="email" autocomplete="email" placeholder="请输入邮箱" /></div>
          <div class="form-item"><label>邮箱验证码</label><div class="email-code-row"><input v-model.trim="registerForm.emailCode" inputmode="numeric" maxlength="6" placeholder="请输入6位验证码" /><button type="button" :disabled="codeLoading || codeCountdown > 0" @click="sendCode">{{ codeCountdown ? `${codeCountdown}秒后重发` : (codeLoading ? '发送中...' : '发送验证码') }}</button></div></div>
          <div class="auth-form-grid">
            <div class="form-item"><label>密码</label><input v-model="registerForm.password" type="password" autocomplete="new-password" placeholder="请输入6-72位密码" /></div>
            <div class="form-item"><label>确认密码</label><input v-model="registerForm.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入密码" @keyup.enter="submitRegister" /></div>
          </div>
        </template>
        <div v-if="captcha.enabled && captcha.provider === 'image'" class="form-item"><label>图形验证码</label><div class="captcha-row"><input v-model.trim="captchaCode" maxlength="8" placeholder="请输入验证码" /><button type="button" class="captcha-image-button" :disabled="captchaLoading" @click="loadCaptcha"><img v-if="captcha.image" :src="captcha.image" alt="图形验证码" /><span v-else>点击刷新</span></button></div></div>
        <div v-else-if="captcha.enabled && captcha.provider === 'geetest'" class="captcha-tip">{{ geetestReady ? '提交后完成安全验证' : '正在加载安全验证...' }}</div>
        <div v-if="authMessage" class="password-feedback error">{{ authMessage }}</div>
        <button type="button" class="dashboard-primary" :disabled="authLoading || captchaLoading" @click="authTab === 'login' ? submitLogin() : submitRegister()">{{ authLoading ? '处理中...' : (authTab === 'login' ? '登录' : '注册') }}</button>
      </section>

      <template v-else>
        <section class="account-hero">
          <img v-if="customer.avatarUrl" :src="customer.avatarUrl" alt="客户头像" />
          <div v-else class="account-avatar">{{ customer.nickname?.[0] || '我' }}</div>
          <div><span>个人中心</span><h1>{{ customer.nickname || '访客' }}</h1><p>{{ customer.phone || '' }}</p></div>
        </section>
        <nav class="account-tabs" aria-label="个人中心导航">
          <button type="button" :class="{ active: activeTab === 'channels' }" @click="activeTab = 'channels'">历史渠道</button>
          <button type="button" :class="{ active: activeTab === 'profile' }" @click="activeTab = 'profile'">账号资料</button>
          <button type="button" :class="{ active: activeTab === 'security' }" @click="activeTab = 'security'">修改密码</button>
        </nav>
        <div v-if="loading" class="account-state">正在加载...</div>
        <div v-else-if="errorMessage" class="account-state account-error"><p>{{ errorMessage }}</p><button type="button" @click="loadAccount">重新加载</button></div>
        <section v-else-if="activeTab === 'channels'" class="account-card">
          <div class="account-section-title"><div><h2>历史渠道</h2><p>你使用此账号访问过的客服渠道</p></div><span>{{ channels.length }} 个</span></div>
          <div v-if="channels.length" class="channel-history-list">
            <button v-for="item in channels" :key="item.bindingId || item._id" type="button" class="channel-history-item" :disabled="item.status !== 'online'" @click="openChannel(item)">
              <img v-if="item.avatarUrl" :src="item.avatarUrl" alt="渠道头像" />
              <div v-else class="channel-history-avatar" :style="{ background: item.brandColor || '#2563eb' }">客</div>
              <div class="channel-history-info">
                <div>
                  <strong>{{ item.brandName || item.name || '客服渠道' }}</strong>
                  <span v-if="item.current" class="channel-current">当前</span>
                </div>
                <p>{{ messageSummary(item.lastMessage) }}</p>
              </div>
              <span v-if="item.unreadCount" class="channel-unread">{{ item.unreadCount > 99 ? '99+' : item.unreadCount }}</span>
              <span :class="['channel-status', item.status === 'online' ? 'online' : 'offline']">{{ item.status === 'online' ? '进入咨询' : '暂时离线' }}</span>
            </button>
          </div>
          <div v-else class="channel-history-empty">暂无访问过的客服渠道</div>
        </section>
        <section v-else-if="activeTab === 'profile'" class="account-card">
          <div class="account-section-title"><div><h2>账号资料</h2><p>资料在所有客服渠道中保持一致</p></div></div>
          <div class="account-info-grid"><div><span>手机号</span><strong>{{ customer.phone || '-' }}</strong></div><div><span>QQ号</span><strong>{{ customer.qq || '未完善' }}</strong></div><div><span>邮箱</span><strong>{{ customer.email || '未完善' }}</strong></div><div><span>注册时间</span><strong>{{ formatDate(customer.createdAt) }}</strong></div></div>
        </section>
        <form v-else class="account-card account-password-form" @submit.prevent="changePassword">
          <div class="account-section-title"><div><h2>修改密码</h2><p>修改成功后需使用新密码重新登录</p></div></div>
          <div class="form-item"><label>当前密码</label><input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" placeholder="请输入当前密码" /></div>
          <div class="form-item"><label>新密码</label><input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" placeholder="请输入6-72位新密码" /></div>
          <div class="form-item"><label>确认新密码</label><input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" /></div>
          <div v-if="passwordMessage" :class="['password-feedback', passwordSuccess ? 'success' : 'error']">{{ passwordMessage }}</div>
          <button type="submit" class="dashboard-primary" :disabled="passwordLoading">{{ passwordLoading ? '修改中...' : '确认修改密码' }}</button>
        </form>
      </template>
    </main>

    <div v-if="showDownloadModal && !isCustomerAndroidApp" class="modal-overlay install-guide-overlay" @click.self="showDownloadModal = false">
      <section class="modal-content install-guide-modal" role="dialog" aria-modal="true" aria-labelledby="account-download-title">
        <div class="install-guide-icon">客</div>
        <div id="account-download-title" class="modal-title">下载客户安卓客户端</div>
        <div class="modal-desc">此安装包仅用于客户中心，可管理历史客服渠道；客服坐席请勿下载此版本。</div>
        <div v-if="appDownloadError" class="password-feedback error">{{ appDownloadError }}</div>
        <div class="modal-actions install-guide-actions">
          <button type="button" class="btn btn-ghost" :disabled="appDownloadLoading" @click="showDownloadModal = false">取消</button>
          <button type="button" class="btn btn-primary" :disabled="appDownloadLoading" @click="downloadAndroidApp">{{ appDownloadLoading ? '获取中...' : '确认下载' }}</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api, { getSocket } from '../api'

const route = useRoute()
const router = useRouter()
const customer = ref(null)
const channels = ref([])
const activeTab = ref('channels')
const loading = ref(Boolean(localStorage.getItem('client_token')))
const errorMessage = ref('')
const channelToken = ref(String(route.query.channel || localStorage.getItem('client_channel_token') || ''))
const authTab = ref('login')
const loginForm = ref({ identifier: '', password: '' })
const registerForm = ref({ phone: '', qq: '', email: '', emailCode: '', password: '', confirmPassword: '' })
const authLoading = ref(false)
const authMessage = ref('')
const codeLoading = ref(false)
const codeCountdown = ref(0)
const captcha = ref({ enabled: false, provider: '', captchaId: '', image: '' })
const captchaCode = ref('')
const captchaLoading = ref(false)
const geetestReady = ref(false)
const passwordForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })
const passwordLoading = ref(false)
const passwordMessage = ref('')
const passwordSuccess = ref(false)
const userAgent = navigator.userAgent || ''
const isIOS = /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
const isCustomerAndroidApp = /YiMengCustomerAndroid\/[\w.-]+/i.test(userAgent)
const showDownloadModal = ref(false)
const appDownloadLoading = ref(false)
const appDownloadError = ref('')
let codeTimer = null
let socket = null
let notificationAudioContext = null
let geetestInstance = null
let geetestScriptPromise = null
const notifiedMessageIds = new Set()

const currentChannelPath = computed(() => {
  const current = channels.value.find(item => item.current) || channels.value[0]
  const value = current?.publicToken || channelToken.value
  return value ? `/c/${value}` : '/account'
})

async function loadAccount() {
  if (!localStorage.getItem('client_token')) return
  loading.value = true
  errorMessage.value = ''
  try {
    const meRes = await api.get('/client/me')
    if (meRes.code !== 0) throw new Error(meRes.message || '客户资料加载失败')
    customer.value = meRes.data
    setupSocket()

    try {
      const historyRes = await api.get('/client/channels/history')
      channels.value = historyRes.code === 0 ? (historyRes.data || []) : []
      const current = channels.value.find(item => item.current)
      if (current?.publicToken) {
        channelToken.value = current.publicToken
        localStorage.setItem('client_channel_token', current.publicToken)
      }
    } catch {
      channels.value = []
    }
  } catch (error) {
    customer.value = null
    authMessage.value = error?.message || '登录已失效，请重新登录'
    await loadCaptcha()
  } finally { loading.value = false }
}

function switchAuthTab(tab) { authTab.value = tab; authMessage.value = ''; captchaCode.value = ''; geetestInstance?.reset?.() }
async function loadGeetestScript() {
  if (window.initGeetest) return
  if (!geetestScriptPromise) geetestScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://static.geetest.com/static/tools/gt.js'; script.async = true
    script.onload = () => window.initGeetest ? resolve() : reject(new Error('安全验证加载失败')); script.onerror = () => reject(new Error('安全验证加载失败')); document.head.appendChild(script)
  })
  return geetestScriptPromise
}
async function initializeGeetest(config) {
  geetestReady.value = false; geetestInstance?.destroy?.(); await loadGeetestScript()
  await new Promise((resolve, reject) => window.initGeetest({ gt: config.gt, challenge: config.challenge, offline: config.success === false || config.success === 0, new_captcha: config.new_captcha ?? config.newCaptcha ?? true, product: 'bind', width: '100%' }, instance => {
    geetestInstance = instance; instance.onReady(() => { geetestReady.value = true; resolve() }); instance.onError(() => reject(new Error('安全验证加载失败')))
  }))
}
async function loadCaptcha() {
  captchaLoading.value = true; captchaCode.value = ''
  try {
    const res = await api.get('/client/auth/captcha')
    if (res.code !== 0) throw new Error(res.message)
    captcha.value = { enabled: false, provider: '', captchaId: '', image: '', ...res.data }
    if (captcha.value.enabled && captcha.value.provider === 'geetest') await initializeGeetest(captcha.value)
  } catch (error) { authMessage.value = error?.message || '安全验证加载失败' } finally { captchaLoading.value = false }
}
function getCaptchaPayload() {
  if (!captcha.value.enabled) return Promise.resolve({})
  if (captcha.value.provider === 'image') return captchaCode.value ? Promise.resolve({ captchaId: captcha.value.captchaId, captchaCode: captchaCode.value }) : Promise.reject(new Error('请输入图形验证码'))
  return new Promise((resolve, reject) => {
    if (!geetestInstance || !geetestReady.value) return reject(new Error('安全验证尚未加载完成'))
    geetestInstance.onSuccess(() => resolve(geetestInstance.getValidate() || {})); geetestInstance.onClose(() => reject(new Error('请完成安全验证'))); geetestInstance.verify()
  })
}
async function finishAuth(res) {
  if (res.code !== 0) throw new Error(res.message || '认证失败')
  localStorage.setItem('client_token', res.data.token)
  await loadAccount()
}
async function submitLogin() {
  authMessage.value = ''
  if (!loginForm.value.identifier || !loginForm.value.password) return authMessage.value = '请填写完整登录信息'
  authLoading.value = true
  try { await finishAuth(await api.post('/client/auth/login', { ...loginForm.value, fingerprint: navigator.userAgent, ...await getCaptchaPayload() })) } catch (error) {
    authMessage.value = error?.message || '登录失败'
    await loadCaptcha()
    geetestInstance?.reset?.()
  } finally { authLoading.value = false }
}
async function sendCode() {
  authMessage.value = ''
  if (!/^\S+@\S+\.\S+$/.test(registerForm.value.email)) return authMessage.value = '请输入正确的邮箱地址'
  codeLoading.value = true
  try {
    const res = await api.post('/client/auth/register-code', { email: registerForm.value.email })
    if (res.code !== 0) throw new Error(res.message)
    codeCountdown.value = 60; clearInterval(codeTimer); codeTimer = setInterval(() => { if (--codeCountdown.value <= 0) clearInterval(codeTimer) }, 1000)
  } catch (error) { authMessage.value = error?.message || '验证码发送失败' } finally { codeLoading.value = false }
}
async function submitRegister() {
  authMessage.value = ''; const form = registerForm.value
  if (Object.values(form).some(value => !value)) return authMessage.value = '请填写完整注册信息'
  if (!/^[\d +\-]{6,20}$/.test(form.phone)) return authMessage.value = '请输入正确的手机号'
  if (!/^[1-9]\d{4,11}$/.test(form.qq)) return authMessage.value = '请输入5-12位QQ号'
  if (!/^\S+@\S+\.\S+$/.test(form.email)) return authMessage.value = '请输入正确的邮箱地址'
  if (!/^\d{6}$/.test(form.emailCode)) return authMessage.value = '请输入6位邮箱验证码'
  if (form.password.length < 6 || form.password.length > 72) return authMessage.value = '密码须为6-72位'
  if (form.password !== form.confirmPassword) return authMessage.value = '两次输入的密码不一致'
  authLoading.value = true
  try { await finishAuth(await api.post('/client/auth/register', { ...form, fingerprint: navigator.userAgent, ...await getCaptchaPayload() })) }
  catch (error) { authMessage.value = error?.message || '注册失败'; await loadCaptcha(); geetestInstance?.reset?.() } finally { authLoading.value = false }
}
async function changePassword() {
  passwordMessage.value = ''; passwordSuccess.value = false; const form = passwordForm.value
  if (!form.currentPassword || !form.newPassword || !form.confirmPassword) return passwordMessage.value = '请填写完整密码信息'
  if (form.newPassword.length < 6 || form.newPassword.length > 72) return passwordMessage.value = '新密码须为6-72位'
  if (form.newPassword !== form.confirmPassword) return passwordMessage.value = '两次输入的新密码不一致'
  passwordLoading.value = true
  try {
    const res = await api.post('/client/profile/password', form); if (res.code !== 0) throw new Error(res.message)
    passwordSuccess.value = true; passwordMessage.value = res.message || '密码修改成功'; passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    localStorage.removeItem('client_token'); setTimeout(() => { customer.value = null; authTab.value = 'login'; passwordMessage.value = ''; loadCaptcha() }, 1000)
  } catch (error) { passwordMessage.value = error?.message || '密码修改失败' } finally { passwordLoading.value = false }
}
function openChannel(item) { if (item.publicToken) router.push(`/c/${item.publicToken}`) }
function messageSummary(message) {
  if (!message) return '暂无消息'
  if (message.recalledAt) return '消息已撤回'
  if (message.messageType === 'image') return '[图片]'
  if (message.messageType === 'video') return '[视频]'
  if (message.messageType === 'file') return `[文件] ${message.attachmentName || ''}`.trim()
  return message.content || '暂无消息'
}
function handleChannelHistoryUpdate(update) {
  if (!update?.bindingId) return
  const index = channels.value.findIndex(item => String(item.bindingId) === String(update.bindingId))
  if (index >= 0) channels.value.splice(index, 1, { ...channels.value[index], ...update })
  else channels.value.push(update)
  channels.value.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
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
function handleNewMessage(message) {
  const messageId = String(message?._id || '')
  if (!messageId || notifiedMessageIds.has(messageId)) return
  notifiedMessageIds.add(messageId)
  const index = channels.value.findIndex(item => String(item.conversationId) === String(message.conversationId))
  if (index < 0) return
  const item = channels.value[index]
  const incoming = ['agent', 'bot'].includes(message.senderType)
  const summaryAlreadyUpdated = String(item.lastMessage?._id || '') === messageId
  if (!summaryAlreadyUpdated) {
    channels.value.splice(index, 1, {
      ...item,
      lastMessage: message,
      lastMessageAt: message.createdAt || new Date().toISOString(),
      unreadCount: incoming ? Number(item.unreadCount || 0) + 1 : Number(item.unreadCount || 0),
    })
    channels.value.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
  }
  if (!incoming) return
  playNotificationSound()
  if (!isCustomerAndroidApp && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(item.brandName || item.name || '客服新消息', {
      body: messageSummary(message),
      icon: item.avatarUrl || '/pwa-192.png',
      tag: `customer-channel-${item.bindingId}`,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
      if (item.publicToken) router.push(`/c/${item.publicToken}`)
    }
  }
}
function setupSocket() {
  const token = localStorage.getItem('client_token')
  if (!token) return
  socket = getSocket(token)
  socket.off('channel-history.updated', handleChannelHistoryUpdate)
  socket.off('message.new', handleNewMessage)
  socket.on('channel-history.updated', handleChannelHistoryUpdate)
  socket.on('message.new', handleNewMessage)
}
function formatDate(value) { return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '-' }
async function downloadAndroidApp() {
  appDownloadLoading.value = true
  appDownloadError.value = ''
  try {
    const res = await api.get('/app/customer-center/android/version')
    const downloadUrl = res.code === 0 ? res.data?.downloadUrl : ''
    if (!downloadUrl) throw new Error('暂无可下载的客户安卓客户端')
    window.location.assign(downloadUrl)
    showDownloadModal.value = false
  } catch (error) {
    appDownloadError.value = error?.message || '客户安卓客户端下载配置获取失败，请稍后重试。'
  } finally {
    appDownloadLoading.value = false
  }
}

onMounted(() => {
  document.title = '客户后台'
  window.addEventListener('pointerdown', unlockNotificationSound, { once: true })
  window.addEventListener('keydown', unlockNotificationSound, { once: true })
  if (localStorage.getItem('client_token')) loadAccount(); else loadCaptcha()
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', unlockNotificationSound)
  window.removeEventListener('keydown', unlockNotificationSound)
  clearInterval(codeTimer)
  geetestInstance?.destroy?.()
  socket?.off('channel-history.updated', handleChannelHistoryUpdate)
  socket?.off('message.new', handleNewMessage)
  socket?.disconnect()
  notificationAudioContext?.close().catch(() => {})
  notificationAudioContext = null
})
</script>
