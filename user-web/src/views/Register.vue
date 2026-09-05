<!-- 忆梦云团队开发 -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import AuthCaptcha from '../components/AuthCaptcha.vue'

const router = useRouter()
const form = ref({ name: '', username: '', email: '', password: '' })
const captcha = ref(null)
const err = ref('')
const loading = ref(false)

async function doRegister() {
  if (loading.value) return
  err.value = ''
  const f = form.value
  if (!f.name || !f.username || !f.email || !f.password) {
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
      <input v-model="form.name" autocomplete="organization" placeholder="企业名称" />
      <input v-model="form.username" autocomplete="username" placeholder="登录用户名" />
      <input v-model="form.email" type="email" autocomplete="email" placeholder="邮箱" />
      <input v-model="form.password" type="password" autocomplete="new-password" placeholder="密码（至少6位）" />
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
