<!-- 忆梦云团队开发 - 管理员登录 -->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const GEETEST_SCRIPT = 'https://static.geetest.com/static/js/gt.0.5.0.js'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')
const captchaLoading = ref(true)
const captcha = ref({ enabled: false, provider: '' })
const captchaCode = ref('')
const geetestReady = ref(false)
let geetestInstance = null
let disposed = false

const formDisabled = computed(() => (
  loading.value
  || captchaLoading.value
  || (captcha.value.enabled && !['image', 'geetest'].includes(captcha.value.provider))
))

function loadGeetestScript() {
  if (window.initGeetest) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GEETEST_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', () => reject(new Error('极验组件加载失败')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = GEETEST_SCRIPT
    script.async = true
    script.onload = resolve
    script.onerror = () => reject(new Error('极验组件加载失败'))
    document.head.appendChild(script)
  })
}

async function setupGeetest(config) {
  geetestReady.value = false
  await loadGeetestScript()
  if (disposed) return
  await new Promise((resolve, reject) => {
    window.initGeetest({
      gt: config.gt,
      challenge: config.challenge,
      offline: !config.success,
      new_captcha: config.newCaptcha ?? config.new_captcha ?? true,
      product: 'bind',
      lang: 'zh-cn',
      https: true,
    }, instance => {
      if (disposed) {
        instance.destroy?.()
        resolve()
        return
      }
      geetestInstance?.destroy?.()
      geetestInstance = instance
      instance.onReady(() => {
        geetestReady.value = true
        resolve()
      })
      instance.onSuccess(() => {
        const result = instance.getValidate()
        if (!result) {
          errorMsg.value = '极验验证结果无效，请重试'
          return
        }
        submitLogin(result)
      })
      instance.onError(() => {
        errorMsg.value = '极验服务暂不可用，请稍后重试'
        reject(new Error('极验服务暂不可用'))
      })
    })
  })
}

async function loadCaptcha() {
  captchaLoading.value = true
  errorMsg.value = ''
  captchaCode.value = ''
  geetestReady.value = false
  geetestInstance?.destroy?.()
  geetestInstance = null
  try {
    const res = await api.get('/admin/auth/captcha')
    if (res.code !== 0) throw new Error(res.message || '验证码加载失败')
    captcha.value = res.data || { enabled: false, provider: '' }
    if (captcha.value.enabled && captcha.value.provider === 'geetest') {
      await setupGeetest(captcha.value)
    }
  } catch (error) {
    captcha.value = { enabled: true, provider: '' }
    errorMsg.value = error?.message || '验证码加载失败，请刷新重试'
  } finally {
    captchaLoading.value = false
  }
}

function validateCredentials() {
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请输入账号和密码'
    return false
  }
  return true
}

async function submitLogin(geetestResult = null) {
  if (loading.value) return
  loading.value = true
  errorMsg.value = ''
  const payload = {
    username: username.value.trim(),
    password: password.value,
  }
  if (captcha.value.enabled && captcha.value.provider === 'image') {
    payload.captchaId = captcha.value.captchaId
    payload.captchaCode = captchaCode.value.trim()
  } else if (captcha.value.enabled && captcha.value.provider === 'geetest') {
    Object.assign(payload, geetestResult)
  }

  try {
    const res = await api.post('/admin/auth/login', payload)
    if (res.code !== 0) throw new Error(res.message || '登录失败')
    localStorage.setItem('admin_token', res.data.token)
    localStorage.setItem('admin_info', JSON.stringify(res.data.admin))
    router.replace('/dashboard')
  } catch (error) {
    errorMsg.value = error?.message || '网络错误'
    if (captcha.value.provider === 'image') {
      const loginError = errorMsg.value
      await loadCaptcha()
      errorMsg.value = loginError
    }
    if (captcha.value.provider === 'geetest') geetestInstance?.reset?.()
  } finally {
    loading.value = false
  }
}

function login() {
  errorMsg.value = ''
  if (!validateCredentials() || captchaLoading.value) return
  if (captcha.value.enabled && captcha.value.provider === 'image') {
    if (!captchaCode.value.trim()) {
      errorMsg.value = '请输入图形验证码'
      return
    }
    submitLogin()
    return
  }
  if (captcha.value.enabled && captcha.value.provider === 'geetest') {
    if (!geetestReady.value || !geetestInstance) {
      errorMsg.value = '极验组件正在加载，请稍候'
      return
    }
    geetestInstance.verify()
    return
  }
  submitLogin()
}

onMounted(loadCaptcha)
onBeforeUnmount(() => {
  disposed = true
  geetestInstance?.destroy?.()
})
</script>

<template>
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-brand">
        <div class="logo">Y</div>
        <h1>忆梦云客服</h1>
        <p class="sub">平台管理后台 · 请登录</p>
      </div>

      <div class="input-group">
        <label for="u">管理员账号</label>
        <input
          id="u"
          v-model="username"
          class="input"
          type="text"
          placeholder="请输入账号"
          autocomplete="username"
          :disabled="loading"
          @keydown.enter.prevent="login"
        />
      </div>

      <div class="input-group">
        <label for="p">登录密码</label>
        <input
          id="p"
          v-model="password"
          class="input"
          :class="{ error: errorMsg }"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
          :disabled="loading"
          @keydown.enter.prevent="login"
        />
      </div>

      <div v-if="captcha.enabled && captcha.provider === 'image'" class="input-group">
        <label for="captcha-code">图形验证码</label>
        <div class="captcha-row">
          <input
            id="captcha-code"
            v-model="captchaCode"
            class="input"
            type="text"
            inputmode="text"
            maxlength="8"
            autocomplete="off"
            placeholder="请输入验证码"
            :disabled="loading || captchaLoading"
            @keydown.enter.prevent="login"
          />
          <button
            class="captcha-image"
            type="button"
            :disabled="loading || captchaLoading"
            aria-label="刷新图形验证码"
            title="点击刷新验证码"
            @click="loadCaptcha"
          >
            <img v-if="captcha.image" :src="captcha.image" alt="图形验证码，点击刷新" />
            <span v-else>加载中...</span>
          </button>
        </div>
        <span class="hint">看不清？点击图片换一张</span>
      </div>

      <div v-else-if="captcha.enabled && captcha.provider === 'geetest'" class="captcha-status" aria-live="polite">
        <span class="captcha-status-icon" :class="{ ready: geetestReady }"></span>
        {{ geetestReady ? '登录时将进行极验安全验证' : '正在加载极验安全验证...' }}
      </div>

      <div v-if="errorMsg" class="toast error login-error" role="alert">
        <div class="toast-title">登录失败</div>
        <div class="toast-msg">{{ errorMsg }}</div>
      </div>

      <button
        class="btn btn-primary btn-lg login-submit"
        :disabled="formDisabled"
        @click="login"
      >
        {{ loading ? '登录中...' : captchaLoading ? '验证加载中...' : '登 录' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.captcha-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 120px;
  gap: 10px;
}

.captcha-image {
  width: 120px;
  height: 42px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: #f1f5f9;
  color: var(--text-muted);
  font-size: 12px;
  transition: border-color .18s ease, box-shadow .18s ease;
}

.captcha-image:hover:not(:disabled),
.captcha-image:focus-visible {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 3px var(--primary-ring);
}

.captcha-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.captcha-status {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: #f8fafc;
  color: var(--text-sec);
  font-size: 13px;
}

.captcha-status-icon {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.captcha-status-icon.ready {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.login-error {
  position: static;
  margin-bottom: 14px;
  animation: none;
}

.login-submit { width: 100%; }
.login-tip { margin-top: 18px; color: #94a3b8; font-size: 12px; text-align: center; }

@media (max-width: 390px) {
  .captcha-row { grid-template-columns: minmax(0, 1fr) 108px; }
  .captcha-image { width: 108px; }
}
</style>
