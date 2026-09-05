<!-- 忆梦云团队开发 -->
<template>
  <div class="account-page">
    <header class="account-header">
      <div class="account-header-inner">
        <router-link class="account-brand" :to="currentChannelPath">客户中心</router-link>
        <button type="button" class="account-logout" @click="logout">退出登录</button>
      </div>
    </header>

    <main class="account-main">
      <section class="account-hero">
        <img v-if="customer?.avatarUrl" :src="customer.avatarUrl" alt="客户头像" />
        <div v-else class="account-avatar">{{ customer?.nickname?.[0] || '我' }}</div>
        <div>
          <span>个人中心</span>
          <h1>{{ customer?.nickname || '访客' }}</h1>
          <p>{{ customer?.phone || '' }}</p>
        </div>
      </section>

      <div v-if="loading" class="account-state">正在加载...</div>
      <div v-else-if="errorMessage" class="account-state account-error">
        <p>{{ errorMessage }}</p>
        <button type="button" @click="loadAccount">重新加载</button>
      </div>

      <template v-else>
        <nav class="account-tabs" aria-label="个人中心导航">
          <button type="button" :class="{ active: activeTab === 'channels' }" @click="activeTab = 'channels'">历史渠道</button>
          <button type="button" :class="{ active: activeTab === 'profile' }" @click="activeTab = 'profile'">账号资料</button>
        </nav>

        <section v-if="activeTab === 'channels'" class="account-card">
          <div class="account-section-title">
            <div>
              <h2>历史渠道</h2>
              <p>你使用此账号访问过的客服渠道</p>
            </div>
            <span>{{ channels.length }} 个</span>
          </div>

          <div v-if="channels.length" class="channel-history-list">
            <button
              v-for="item in channels"
              :key="item.bindingId || item._id"
              type="button"
              class="channel-history-item"
              :disabled="item.status !== 'online'"
              @click="openChannel(item)"
            >
              <img v-if="item.avatarUrl" :src="item.avatarUrl" :alt="item.brandName || item.name" />
              <div v-else class="channel-history-avatar" :style="{ background: item.brandColor || '#2563eb' }">
                {{ (item.brandName || item.name || '客')[0] }}
              </div>
              <div class="channel-history-info">
                <div>
                  <strong>{{ item.brandName || item.name || '在线客服' }}</strong>
                  <span v-if="item.current" class="channel-current">当前</span>
                </div>
                <p>{{ item.name || '客服渠道' }} · 最近访问 {{ formatDateTime(item.lastVisitedAt) }}</p>
              </div>
              <span :class="['channel-status', item.status === 'online' ? 'online' : 'offline']">
                {{ item.status === 'online' ? '进入咨询' : '暂时离线' }}
              </span>
            </button>
          </div>
          <div v-else class="channel-history-empty">暂无访问过的客服渠道</div>
        </section>

        <section v-else class="account-card">
          <div class="account-section-title">
            <div>
              <h2>账号资料</h2>
              <p>资料在所有客服渠道中保持一致</p>
            </div>
          </div>
          <div class="account-info-grid">
            <div><span>手机号</span><strong>{{ customer?.phone || '-' }}</strong></div>
            <div><span>QQ号</span><strong>{{ customer?.qq || '未完善' }}</strong></div>
            <div><span>邮箱</span><strong>{{ customer?.email || '未完善' }}</strong></div>
            <div><span>注册时间</span><strong>{{ formatDate(customer?.createdAt) }}</strong></div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const customer = ref(null)
const channels = ref([])
const activeTab = ref('channels')
const loading = ref(true)
const errorMessage = ref('')

const currentChannelPath = computed(() => {
  const current = channels.value.find(item => item.current) || channels.value[0]
  return current?.publicToken ? `/c/${current.publicToken}` : '/'
})

async function loadAccount() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [meRes, historyRes] = await Promise.all([
      api.get('/client/me'),
      api.get('/client/channels/history'),
    ])
    if (meRes.code !== 0 || historyRes.code !== 0) throw new Error('客户资料加载失败')
    customer.value = meRes.data
    channels.value = historyRes.data || []
  } catch (error) {
    if (!localStorage.getItem('client_token')) {
      router.replace('/')
      return
    }
    errorMessage.value = error?.message || '客户资料加载失败'
  } finally {
    loading.value = false
  }
}

function openChannel(item) {
  if (!item.publicToken) return
  router.push(`/c/${item.publicToken}`)
}

function logout() {
  localStorage.removeItem('client_token')
  router.replace(currentChannelPath.value)
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

onMounted(() => {
  document.title = '客户后台'
  loadAccount()
})
</script>
