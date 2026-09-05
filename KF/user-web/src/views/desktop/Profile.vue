<!-- 忆梦云团队开发 - 电脑端用户资料管理 -->
<script setup>
import { onMounted, reactive, ref } from 'vue'
import api from '../../api'

const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const notice = ref(null)
const form = reactive({ displayName: '', avatarUrl: '', username: '', role: '' })

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => { if (notice.value?.message === message) notice.value = null }, 2800)
}

async function loadProfile() {
  loading.value = true
  try {
    const res = await api.get('/tenant/auth/me')
    if (res.code !== 0 || !res.data?.user) throw new Error(res.message || '资料加载失败')
    Object.assign(form, res.data.user)
  } catch (error) {
    showNotice('error', error?.message || '资料加载失败')
  } finally {
    loading.value = false
  }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) return showNotice('error', '请选择图片文件')
  if (file.size > 5 * 1024 * 1024) return showNotice('error', '图片不能超过 5MB')
  uploading.value = true
  try {
    const data = new FormData()
    data.append('file', file)
    const res = await api.upload('/upload/tenant', data)
    if (res.code !== 0 || !res.data?.url) throw new Error(res.message || '上传失败')
    form.avatarUrl = res.data.url
    showNotice('success', '头像上传成功，保存后生效')
  } catch (error) {
    showNotice('error', error?.message || '头像上传失败')
  } finally {
    uploading.value = false
  }
}

async function saveProfile() {
  const displayName = form.displayName.trim()
  if (!displayName) return showNotice('error', '昵称不能为空')
  if (displayName.length > 50) return showNotice('error', '昵称最多 50 字')
  saving.value = true
  try {
    const res = await api.patch('/tenant/auth/profile', { displayName, avatarUrl: form.avatarUrl.trim() })
    if (res.code !== 0) throw new Error(res.message || '保存失败')
    const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
    if (res.data?.token) storage.setItem('tenant_token', res.data.token)
    if (res.data?.user) {
      storage.setItem('tenant_user', JSON.stringify(res.data.user))
      Object.assign(form, res.data.user)
      window.dispatchEvent(new CustomEvent('tenant-profile-updated', { detail: res.data.user }))
    }
    showNotice('success', '资料已保存')
  } catch (error) {
    showNotice('error', error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadProfile)
</script>

<template>
  <section class="profile-page">
    <header class="profile-heading"><div><span>账号设置</span><h1>个人资料</h1><p>修改工作台内展示的头像和昵称。</p></div></header>
    <div v-if="notice" class="profile-notice" :class="notice.type" role="status">{{ notice.message }}</div>
    <div v-if="loading" class="profile-state">正在加载...</div>
    <form v-else class="profile-card" @submit.prevent="saveProfile">
      <div class="avatar-section">
        <div class="avatar-preview"><img v-if="form.avatarUrl" :src="form.avatarUrl" alt="用户头像" /><span v-else>{{ (form.displayName || form.username || '?').slice(0, 1).toUpperCase() }}</span></div>
        <div><h2>个人头像</h2><p>支持 JPG、PNG、GIF、WebP，建议不超过 5MB。</p><div class="avatar-actions"><label class="secondary-btn">{{ uploading ? '上传中...' : '选择图片' }}<input type="file" accept="image/*" :disabled="uploading" hidden @change="uploadAvatar" /></label><button v-if="form.avatarUrl" type="button" class="link-danger" @click="form.avatarUrl = ''">移除头像</button></div></div>
      </div>
      <div class="form-grid">
        <label><span>登录账号</span><input :value="form.username" disabled /><small>登录账号不可在此修改</small></label>
        <label><span>账号角色</span><input :value="({ owner: '所有者', admin: '管理员', agent: '员工' })[form.role] || form.role" disabled /></label>
        <label class="wide"><span>显示昵称</span><input v-model="form.displayName" maxlength="50" required placeholder="请输入昵称" /><small>{{ form.displayName.length }}/50</small></label>
      </div>
      <footer><button type="submit" :disabled="saving || uploading">{{ saving ? '保存中...' : '保存修改' }}</button></footer>
    </form>
  </section>
</template>

<style scoped>
.profile-page { width:min(900px,100%); margin:0 auto; }
.profile-heading { margin-bottom:20px; padding:28px 30px; overflow:hidden; border-radius:20px; background:linear-gradient(135deg,#172554,#2563eb); color:#fff; box-shadow:0 16px 40px rgba(37,99,235,.2); }.profile-heading span { font-size:12px; font-weight:700; opacity:.75; }.profile-heading h1 { margin:5px 0; font-size:27px; }.profile-heading p { margin:0; opacity:.82; }
.profile-card { overflow:hidden; border:1px solid #e2e8f0; border-radius:16px; background:#fff; box-shadow:0 4px 16px rgba(15,23,42,.05); }.avatar-section { display:flex; align-items:center; gap:20px; padding:26px; border-bottom:1px solid #e2e8f0; }.avatar-preview { display:grid; width:84px; height:84px; flex:0 0 84px; overflow:hidden; border-radius:50%; background:linear-gradient(135deg,#6366f1,#2563eb); color:#fff; font-size:30px; font-weight:800; place-items:center; }.avatar-preview img { width:100%; height:100%; object-fit:cover; }.avatar-section h2 { margin:0 0 4px; font-size:17px; }.avatar-section p { margin:0 0 12px; color:#64748b; font-size:13px; }.avatar-actions { display:flex; align-items:center; gap:12px; }.secondary-btn { padding:8px 14px; border:1px solid #bfdbfe; border-radius:9px; background:#eff6ff; color:#2563eb; font-size:13px; font-weight:600; cursor:pointer; }.link-danger { color:#dc2626; font-size:13px; }
.form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; padding:26px; }.form-grid label { display:flex; flex-direction:column; gap:7px; color:#475569; font-size:13px; font-weight:600; }.form-grid label.wide { grid-column:1/-1; }.form-grid input { width:100%; padding:11px 13px; border:1px solid #e2e8f0; border-radius:9px; outline:none; color:#0f172a; font-size:14px; }.form-grid input:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.12); }.form-grid input:disabled { background:#f8fafc; color:#64748b; }.form-grid small { color:#94a3b8; font-weight:400; }
.profile-card footer { display:flex; justify-content:flex-end; padding:18px 26px; border-top:1px solid #e2e8f0; background:#f8fafc; }.profile-card footer button { min-width:120px; padding:10px 20px; border:0; border-radius:9px; background:#2563eb; color:#fff; font-weight:600; cursor:pointer; }.profile-card footer button:disabled { opacity:.55; cursor:not-allowed; }
.profile-notice { margin-bottom:16px; padding:12px 14px; border:1px solid #bbf7d0; border-radius:10px; background:#f0fdf4; color:#166534; }.profile-notice.error { border-color:#fecaca; background:#fef2f2; color:#991b1b; }.profile-state { padding:50px; text-align:center; color:#64748b; }
@media (max-width:768px) { .profile-heading { padding:22px; }.form-grid { grid-template-columns:1fr; padding:20px; }.form-grid label.wide { grid-column:auto; }.avatar-section { padding:20px; }.profile-card footer button { width:100%; } }
</style>
