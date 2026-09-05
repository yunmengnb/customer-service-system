<!-- 忆梦云团队开发 - 全局客户管理 -->
<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const limit = 20
const keyword = ref('')
const statusFilter = ref('')
const loading = ref(false)
const errorMessage = ref('')

const totalPages = computed(() => Math.max(Math.ceil(total.value / limit), 1))
const rangeStart = computed(() => total.value ? (page.value - 1) * limit + 1 : 0)
const rangeEnd = computed(() => Math.min(page.value * limit, total.value))

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit) })
    const trimmedKeyword = keyword.value.trim()
    if (trimmedKeyword) params.set('keyword', trimmedKeyword)
    if (statusFilter.value) params.set('status', statusFilter.value)
    const res = await api.get(`/admin/customers?${params.toString()}`)
    if (res.code === 0) {
      list.value = res.data.items || []
      total.value = res.data.total || 0
    } else {
      errorMessage.value = res.message || '客户数据加载失败'
    }
  } catch (error) {
    errorMessage.value = error?.message || '客户数据加载失败'
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  load()
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
</script>

<template>
  <div class="page-header">
    <h1>客户管理</h1>
    <p class="desc">查看平台注册客户账号，列表信息仅供查询</p>
  </div>

  <div class="toolbar">
    <div class="search">
      <span class="icon">🔍</span>
      <input
        v-model="keyword"
        class="input"
        placeholder="搜索手机号 / 昵称 / QQ / 邮箱"
        @keydown.enter="search"
      />
    </div>
    <select v-model="statusFilter" class="select status-select" @change="search">
      <option value="">全部状态</option>
      <option value="active">正常</option>
      <option value="disabled">已禁用</option>
    </select>
    <button class="btn btn-primary btn-sm" :disabled="loading" @click="search">查询</button>
  </div>

  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>客户</th>
          <th>手机号</th>
          <th>QQ</th>
          <th>邮箱</th>
          <th>状态</th>
          <th>最近登录</th>
          <th>注册时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="customer in list" :key="customer._id">
          <td data-label="客户">
            <div class="customer-cell">
              <img v-if="customer.avatarUrl" :src="customer.avatarUrl" alt="" class="customer-avatar" />
              <div v-else class="customer-avatar fallback">{{ (customer.nickname || '?').slice(0, 1) }}</div>
              <div>
                <div class="customer-name">{{ customer.nickname || '访客' }}</div>
                <div class="customer-id">ID: {{ customer._id.slice(-8) }}</div>
              </div>
            </div>
          </td>
          <td data-label="手机号">{{ customer.phone || '-' }}</td>
          <td data-label="QQ">{{ customer.qq || '-' }}</td>
          <td data-label="邮箱">{{ customer.email || '-' }}</td>
          <td data-label="状态">
            <span class="tag" :class="customer.status === 'active' ? 'tag-green' : 'tag-red'">
              <span class="dot" :class="customer.status === 'active' ? 'green' : 'red'"></span>
              {{ customer.status === 'active' ? '正常' : '已禁用' }}
            </span>
          </td>
          <td data-label="最近登录" class="date-cell">{{ formatDate(customer.lastLoginAt) }}</td>
          <td data-label="注册时间" class="date-cell">{{ formatDate(customer.createdAt) }}</td>
        </tr>
        <tr v-if="loading">
          <td colspan="7" class="empty-cell">正在加载...</td>
        </tr>
        <tr v-else-if="errorMessage">
          <td colspan="7" class="empty-cell error-text">{{ errorMessage }}</td>
        </tr>
        <tr v-else-if="!list.length">
          <td colspan="7" class="empty-cell">暂无客户数据</td>
        </tr>
      </tbody>
    </table>

    <div v-if="total > 0" class="pagination">
      <div class="pagination-info">共 {{ total }} 条，当前显示 {{ rangeStart }}-{{ rangeEnd }} 条</div>
      <div class="pagination-actions">
        <button class="btn btn-ghost btn-sm" :disabled="page === 1 || loading" @click="changePage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ totalPages }} 页</span>
        <button class="btn btn-ghost btn-sm" :disabled="page === totalPages || loading" @click="changePage(page + 1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-select { max-width: 140px; }
.customer-cell { display: flex; align-items: center; gap: 10px; }
.customer-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.customer-avatar.fallback { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #6366f1, #2563eb); color: #fff; font-weight: 700; }
.customer-name { font-weight: 600; }
.customer-id { margin-top: 2px; color: var(--text-muted); font-size: 11px; }
.date-cell { color: var(--text-sec); font-size: 12px; white-space: nowrap; }
.empty-cell { padding: 48px !important; text-align: center; color: var(--text-muted) !important; }
.error-text { color: var(--danger) !important; }
.pagination { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-top: 1px solid var(--border); color: var(--text-sec); font-size: 13px; }
.pagination-actions { display: flex; align-items: center; gap: 12px; }
@media (max-width: 768px) {
  .pagination { align-items: stretch; flex-direction: column; }
  .pagination-actions { justify-content: space-between; }
  .empty-cell { display: block !important; }
  .empty-cell::before { display: none; }
}
</style>
