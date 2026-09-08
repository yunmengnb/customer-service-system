<!-- 忆梦云团队开发 -->
<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import AuthCaptcha from '../components/AuthCaptcha.vue'

const router = useRouter()
const form = ref({ name: '', username: '', email: '', emailCode: '', password: '', confirmPassword: '' })
const captcha = ref(null)
const err = ref('')
const loading = ref(false)
const sendingCode = ref(false)
const toast = ref({ message: '', type: 'success' })
let toastTimer = null

function showToast(message, type = 'success') {
  toast.value = { message, type }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value.message = '' }, 3000)
}

async function sendCode() {
  if (sendingCode.value) return
  err.value = ''
  if (!/^\S+@\S+\.\S+$/.test(form.value.email)) {
    showToast('请输入正确的邮箱', 'error')
    return
  }
  sendingCode.value = true
  try {
    const res = await api.post('/tenant/auth/register-code', { email: form.value.email })
    if (res.code !== 0) throw new Error(res.message || '验证码发送失败')
    showToast(res.message || '验证码已发送')
  } catch (e) {
    showToast(e?.message || '验证码发送失败', 'error')
  } finally {
    sendingCode.value = false
  }
}

onBeforeUnmount(() => clearTimeout(toastTimer))

async function doRegister() {
  if (loading.value) return
  err.value = ''
  const f = form.value
  if (!f.name || !f.username || !f.email || !f.emailCode || !f.password || !f.confirmPassword) {
    err.value = '请填写完整信息'
    return
  }
  if (!/^\d{6}$/.test(f.emailCode)) { err.value = '请输入6位邮箱验证码'; return }
  if (f.password.length < 6 || f.password.length > 72) { err.value = '密码须为6-72位'; return }
  if (f.password !== f.confirmPassword) { err.value = '两次输入的密码不一致'; return }
  loading.value = true
  try {
    const captchaPayload = await captcha.value.verify()
    const res = await api.post('/tenant/auth/register', { ...f, ...captchaPayload })
    if (res.code === 0) {
      router.replace({ path: '/login', query: { registered: '1' } })
    } else {
      err.value = res.message || '注册失败'
    }
  } catch (e) {
    err.value = e?.message || '网络错误'
    await captcha.value?.reset()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="simple-page">
    <Transition name="toast">
      <div v-if="toast.message" class="top-toast" :class="toast.type" role="status">{{ toast.message }}</div>
    </Transition>
    <div class="simple-box">
      <h1>注册租户</h1>
      <div class="sub">加入客服系统，开始与客户沟通</div>
      <input v-model.trim="form.name" autocomplete="organization" placeholder="企业名称" />
      <input v-model.trim="form.username" autocomplete="username" placeholder="登录用户名" />
      <input v-model.trim="form.email" type="email" autocomplete="email" placeholder="邮箱" />
      <div class="code-row">
        <input v-model.trim="form.emailCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6位邮箱验证码" />
        <button type="button" :disabled="sendingCode" @click="sendCode">{{ sendingCode ? '发送中...' : '发送验证码' }}</button>
      </div>
      <input v-model="form.password" type="password" autocomplete="new-password" placeholder="密码（6-72位）" />
      <input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入密码" @keyup.enter="doRegister" />
      <AuthCaptcha ref="captcha" @submit="doRegister" />
      <div v-if="err" class="err">{{ err }}</div>
      <button type="button" @click="doRegister" :disabled="loading">
        {{ loading ? '注册中...' : '注册' }}
      </button>
      <div class="link-row">
        已有账号？<router-link to="/login">返回登录</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top-toast {
  position: fixed;
  top: calc(18px + env(safe-area-inset-top, 0px));
  left: 50%;
  z-index: 1000;
  max-width: calc(100vw - 32px);
  padding: 11px 18px;
  border-radius: 10px;
  color: #fff;
  background: #16a34a;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .22);
  font-size: 14px;
  line-height: 1.4;
  text-align: center;
  transform: translateX(-50%);
}
.top-toast.error { background: #dc2626; }
.toast-enter-active,.toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from,.toast-leave-to { opacity: 0; transform: translate(-50%, -10px); }
</style>
