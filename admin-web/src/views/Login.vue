<!-- 忆梦云团队开发 - 管理员登录 -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function login() {
  errorMsg.value = ''
  if (!username.value.trim() || !password.value.trim()) {
    errorMsg.value = '请输入账号和密码'
    return
  }
  loading.value = true
  try {
    const res = await api.post('/admin/auth/login', {
      username: username.value.trim(),
      password: password.value,
    })
    if (res.code === 0) {
      localStorage.setItem('admin_token', res.data.token)
      localStorage.setItem('admin_info', JSON.stringify(res.data.admin))
      router.replace('/dashboard')
    } else {
      errorMsg.value = res.message || '登录失败'
    }
  } catch (e) {
    errorMsg.value = e?.message || '网络错误'
  } finally {
    loading.value = false
  }
}
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
          @keydown.enter.prevent="login"
        />
      </div>

      <div v-if="errorMsg" class="toast error" style="position:static;margin-bottom:14px;animation:none;">
        <div class="toast-title">登录失败</div>
        <div class="toast-msg">{{ errorMsg }}</div>
      </div>

      <button
        class="btn btn-primary btn-lg"
        style="width:100%"
        :disabled="loading"
        @click="login"
      >
        {{ loading ? '登录中...' : '登 录' }}
      </button>

      <p style="text-align:center;margin-top:18px;font-size:12px;color:#94a3b8;">
        默认账号 admin / admin123
      </p>
    </div>
  </div>
</template>
