<!-- 忆梦云团队开发 -->
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import AuthCaptcha from '../components/AuthCaptcha.vue'

const router = useRouter()
const form = ref({ name: '', username: '', email: '', emailCode: '', password: '' })
const captcha = ref(null)
const err = ref('')
const notice = ref('')
const loading = ref(false)
const sendingCode = ref(false)
const emailVerificationEnabled = ref(false)

onMounted(async () => {
  try {
    const res = await api.get('/client/public-settings')
    emailVerificationEnabled.value = res.code === 0 && Boolean(res.data?.tenantRegisterEmailVerificationEnabled)
  } catch (_) {}
})

async function sendCode() {
  if (sendingCode.value) return
  err.value = ''
  notice.value = ''
  if (!/^\S+@\S+\.\S+$/.test(form.value.email)) return (err.value = '请输入正确的邮箱')
  sendingCode.value = true
  try {
    const res = await api.post('/tenant/auth/register-code', { email: form.value.email })
    if (res.code !== 0) throw new Error(res.message || '验证码发送失败')
    notice.value = res.message || '验证码已发送'
  } catch (e) {
    err.value = e?.message || '验证码发送失败'
  } finally {
    sendingCode.value = false
  }
}

async function doRegister() {
  if (loading.value) return
  err.value = ''
  notice.value = ''
  const f = form.value
  if (!f.name || !f.username || !f.email || !f.password || (emailVerificationEnabled.value && !f.emailCode)) {
    err.value = '请填写完整信息'
    return
  }
  if (f.password.length < 6) { err.value = '密码至少6位'; return }
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
    <div class="simple-box">
      <h1>注册租户</h1>
      <div class="sub">加入客服系统，开始与客户沟通</div>
      <input v-model.trim="form.name" autocomplete="organization" placeholder="企业名称" />
      <input v-model.trim="form.username" autocomplete="username" placeholder="登录用户名" />
      <input v-model.trim="form.email" type="email" autocomplete="email" placeholder="邮箱" />
      <div v-if="emailVerificationEnabled" class="code-row">
        <input v-model.trim="form.emailCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6位邮箱验证码" />
        <button type="button" :disabled="sendingCode" @click="sendCode">{{ sendingCode ? '发送中...' : '发送验证码' }}</button>
      </div>
      <input v-model="form.password" type="password" autocomplete="new-password" placeholder="密码（至少6位）" />
      <AuthCaptcha ref="captcha" @submit="doRegister" />
      <div v-if="notice && !err" class="success">{{ notice }}</div>
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
