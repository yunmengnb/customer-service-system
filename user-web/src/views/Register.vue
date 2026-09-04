<!-- 忆梦云团队开发 -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const form = ref({ name: '', username: '', email: '', password: '' })
const err = ref('')
const loading = ref(false)

async function doRegister() {
  err.value = ''
  const f = form.value
  if (!f.name || !f.username || !f.email || !f.password) {
    err.value = '请填写完整信息'
    return
  }
  if (f.password.length < 6) { err.value = '密码至少6位'; return }
  loading.value = true
  try {
    const res = await api.post('/tenant/auth/register', f)
    if (res.code === 0) {
      // 自动登录
      const login = await api.post('/tenant/auth/login', { username: f.username, password: f.password })
      if (login.code === 0) {
        localStorage.setItem('tenant_token', login.data.token)
        localStorage.setItem('tenant_user', JSON.stringify(login.data.user))
        localStorage.setItem('tenant_info', JSON.stringify(login.data.tenant))
        const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/messages'
        router.replace(target)
      } else {
        router.push('/login')
      }
    } else {
      err.value = res.message || '注册失败'
    }
  } catch (e) {
    err.value = e?.message || '网络错误'
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
      <input v-model="form.name" placeholder="企业名称" />
      <input v-model="form.username" placeholder="登录用户名" />
      <input v-model="form.email" placeholder="邮箱" />
      <input v-model="form.password" type="password" placeholder="密码（至少6位）" />
      <div v-if="err" class="err">{{ err }}</div>
      <button @click="doRegister" :disabled="loading">
        {{ loading ? '注册中...' : '注册并登录' }}
      </button>
      <div class="link-row">
        已有账号？<router-link to="/login">返回登录</router-link>
      </div>
    </div>
  </div>
</template>
