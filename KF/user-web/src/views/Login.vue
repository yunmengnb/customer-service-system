<!-- 忆梦云团队开发 -->
<script setup>
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'
import AuthCaptcha from '../components/AuthCaptcha.vue'

const router = useRouter()
const route = useRoute()
const form = ref({ username: '', password: '' })
const captcha = ref(null)
const err = ref('')
const loading = ref(false)
const notice = computed(() => route.query.registered === '1' ? '注册成功，请登录' : '')

async function doLogin() {
  if (loading.value) return
  err.value = ''
  if (!form.value.username || !form.value.password) {
    err.value = '请填写完整'
    return
  }
  loading.value = true
  try {
    const captchaPayload = await captcha.value.verify()
    const res = await api.post('/tenant/auth/login', { ...form.value, ...captchaPayload })
    if (res.code === 0) {
      localStorage.setItem('tenant_token', res.data.token)
      localStorage.setItem('tenant_user', JSON.stringify(res.data.user))
      localStorage.setItem('tenant_info', JSON.stringify(res.data.tenant))
      const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/messages'
      router.replace(target)
    } else {
      err.value = res.message || '登录失败'
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
      <h1>租户后台</h1>
      <div class="sub">管理员与员工使用同一账号入口登录</div>
      <input v-model="form.username" autocomplete="username" placeholder="用户名" @keyup.enter="doLogin" />
      <input v-model="form.password" type="password" autocomplete="current-password" placeholder="密码" @keyup.enter="doLogin" />
      <AuthCaptcha ref="captcha" @submit="doLogin" />
      <div v-if="notice && !err" class="success">{{ notice }}</div>
      <div v-if="err" class="err">{{ err }}</div>
      <button type="button" @click="doLogin" :disabled="loading">
        {{ loading ? '登录中...' : '登录' }}
      </button>
      <div class="link-row">
        还没有账号？<router-link to="/register">立即注册</router-link>
      </div>
    </div>
  </div>
</template>
