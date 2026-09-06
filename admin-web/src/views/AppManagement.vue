<!-- 忆梦云团队开发 - APP 管理 -->
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api'

const activeTab = ref('announcements')
const announcements = ref([])
const versions = ref([])
const announcementLoading = ref(false)
const versionLoading = ref(false)
const submitting = ref(false)
const operatingId = ref('')
const notice = ref(null)
const showAnnouncementModal = ref(false)
const showVersionModal = ref(false)
const editingAnnouncement = ref(null)
const editingVersion = ref(null)
const announcementForm = reactive({ title: '', content: '', status: 'published' })
const versionForm = reactive({ versionName: '', versionCode: null, downloadUrl: '', releaseNotes: '', forceUpdate: false, status: 'published' })

let adminInfo = {}
try { adminInfo = JSON.parse(localStorage.getItem('admin_info') || '{}') } catch {}
const canWrite = computed(() => adminInfo.role === 'super')

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => { if (notice.value?.message === message) notice.value = null }, 3000)
}

async function loadAnnouncements() {
  announcementLoading.value = true
  try {
    const params = new URLSearchParams({ page: '1', limit: '100' })
    const res = await api.get(`/admin/app/announcements?${params.toString()}`)
    if (res.code !== 0) throw new Error(res.message || 'APP 公告加载失败')
    announcements.value = res.data?.items || []
  } catch (error) {
    showNotice('error', error?.message || 'APP 公告加载失败')
  } finally {
    announcementLoading.value = false
  }
}

async function loadVersions() {
  versionLoading.value = true
  try {
    const res = await api.get('/admin/app/android/versions?limit=100')
    if (res.code !== 0) throw new Error(res.message || 'APP 版本加载失败')
    versions.value = Array.isArray(res.data) ? res.data : (res.data?.items || [])
  } catch (error) {
    showNotice('error', error?.message || 'APP 版本加载失败')
  } finally {
    versionLoading.value = false
  }
}

function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'announcements' && !announcements.value.length) loadAnnouncements()
  if (tab === 'versions' && !versions.value.length) loadVersions()
}

function openAnnouncementModal(item = null) {
  editingAnnouncement.value = item
  Object.assign(announcementForm, item
    ? { title: item.title, content: item.content, status: item.status }
    : { title: '', content: '', status: 'published' })
  showAnnouncementModal.value = true
}

function openVersionModal(item = null) {
  editingVersion.value = item
  Object.assign(versionForm, item
    ? {
        versionName: item.versionName || item.version || '',
        versionCode: item.versionCode ?? null,
        downloadUrl: item.downloadUrl || '',
        releaseNotes: item.releaseNotes || item.changelog || '',
        forceUpdate: Boolean(item.forceUpdate),
        status: item.status || 'published',
      }
    : { versionName: '', versionCode: null, downloadUrl: '', releaseNotes: '', forceUpdate: false, status: 'published' })
  showVersionModal.value = true
}

async function saveAnnouncement() {
  submitting.value = true
  try {
    const payload = { ...announcementForm }
    const res = editingAnnouncement.value
      ? await api.put(`/admin/app/announcements/${editingAnnouncement.value._id}`, payload)
      : await api.post('/admin/app/announcements', payload)
    if (res.code !== 0) throw new Error(res.message || 'APP 公告保存失败')
    showAnnouncementModal.value = false
    showNotice('success', editingAnnouncement.value ? 'APP 公告已更新' : 'APP 公告已创建')
    editingAnnouncement.value = null
    await loadAnnouncements()
  } catch (error) {
    showNotice('error', error?.message || 'APP 公告保存失败')
  } finally {
    submitting.value = false
  }
}

async function saveVersion() {
  submitting.value = true
  try {
    const payload = { ...versionForm, versionCode: Number(versionForm.versionCode) }
    const res = editingVersion.value
      ? await api.put(`/admin/app/android/versions/${editingVersion.value._id}`, payload)
      : await api.post('/admin/app/android/versions', payload)
    if (res.code !== 0) throw new Error(res.message || 'APP 版本保存失败')
    showVersionModal.value = false
    showNotice('success', editingVersion.value ? 'APP 版本已更新' : 'APP 版本已创建')
    editingVersion.value = null
    await loadVersions()
  } catch (error) {
    showNotice('error', error?.message || 'APP 版本保存失败')
  } finally {
    submitting.value = false
  }
}

async function toggleAnnouncement(item) {
  const status = item.status === 'published' ? 'draft' : 'published'
  if (!window.confirm(`确认${status === 'published' ? '上架' : '下架'}公告「${item.title}」？`)) return
  operatingId.value = item._id
  try {
    const res = await api.patch(`/admin/app/announcements/${item._id}/status`, { status })
    if (res.code !== 0) throw new Error(res.message || '状态更新失败')
    await loadAnnouncements()
  } catch (error) {
    showNotice('error', error?.message || '状态更新失败')
  } finally {
    operatingId.value = ''
  }
}

async function toggleVersion(item) {
  const status = item.status === 'published' ? 'draft' : 'published'
  if (!window.confirm(`确认${status === 'published' ? '发布' : '下架'} Android 版本「${versionLabel(item)}」？`)) return
  operatingId.value = item._id
  try {
    const res = await api.patch(`/admin/app/android/versions/${item._id}/status`, { status })
    if (res.code !== 0) throw new Error(res.message || '状态更新失败')
    showNotice('success', status === 'published' ? 'Android 版本已发布' : 'Android 版本已下架')
    await loadVersions()
  } catch (error) {
    showNotice('error', error?.message || '状态更新失败')
  } finally {
    operatingId.value = ''
  }
}

async function removeItem(type, item) {
  const label = type === 'announcement' ? `公告「${item.title}」` : `版本「${versionLabel(item)}」`
  if (!window.confirm(`删除后无法恢复，确认删除${label}？`)) return
  operatingId.value = item._id
  try {
    const url = type === 'announcement' ? `/admin/app/announcements/${item._id}` : `/admin/app/android/versions/${item._id}`
    const res = await api.delete(url)
    if (res.code !== 0) throw new Error(res.message || '删除失败')
    showNotice('success', '删除成功')
    await (type === 'announcement' ? loadAnnouncements() : loadVersions())
  } catch (error) {
    showNotice('error', error?.message || '删除失败')
  } finally {
    operatingId.value = ''
  }
}

function versionLabel(item) { return item.versionName || item.version || '-' }
function formatDate(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }

onMounted(loadAnnouncements)
</script>

<template>
  <div class="page-header app-heading">
    <div>
      <h1>APP 管理</h1>
      <p class="desc">维护 APP 专属公告与客户端版本</p>
    </div>
    <span v-if="!canWrite" class="readonly-tip">运营管理员仅可查看</span>
  </div>

  <div v-if="notice" class="app-notice" :class="notice.type" role="status">{{ notice.message }}</div>

  <div class="app-tabs" role="tablist">
    <button type="button" :class="{ active: activeTab === 'announcements' }" @click="switchTab('announcements')">APP 公告</button>
    <button type="button" :class="{ active: activeTab === 'versions' }" @click="switchTab('versions')">版本管理</button>
  </div>

  <section v-if="activeTab === 'announcements'">
    <div class="section-toolbar">
      <div><h2>APP 公告</h2><p>仅管理 audience=app 的公告</p></div>
      <button v-if="canWrite" class="btn btn-primary" type="button" @click="openAnnouncementModal()">新增公告</button>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>标题</th><th>内容摘要</th><th>状态</th><th>发布时间</th><th v-if="canWrite" class="actions">操作</th></tr></thead>
        <tbody>
          <tr v-for="item in announcements" :key="item._id">
            <td data-label="标题"><strong>{{ item.title }}</strong></td>
            <td data-label="内容摘要" class="summary-cell">{{ item.content }}</td>
            <td data-label="状态"><span class="tag" :class="item.status === 'published' ? 'tag-green' : 'tag-gray'">{{ item.status === 'published' ? '已上架' : '已下架' }}</span></td>
            <td data-label="发布时间">{{ formatDate(item.publishedAt) }}</td>
            <td v-if="canWrite" data-label="操作" class="actions"><div class="action-list"><button class="btn-link" type="button" :disabled="Boolean(operatingId)" @click="openAnnouncementModal(item)">编辑</button><button class="btn-link" type="button" :disabled="Boolean(operatingId)" @click="toggleAnnouncement(item)">{{ item.status === 'published' ? '下架' : '上架' }}</button><button class="btn-link danger" type="button" :disabled="Boolean(operatingId) || Boolean(item.key)" @click="removeItem('announcement', item)">删除</button></div></td>
          </tr>
          <tr v-if="announcementLoading"><td :colspan="canWrite ? 5 : 4" class="empty-cell">正在加载...</td></tr>
          <tr v-else-if="!announcements.length"><td :colspan="canWrite ? 5 : 4" class="empty-cell">暂无 APP 公告</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-else>
    <div class="section-toolbar">
      <div><h2>Android 版本管理</h2><p>管理 Android 安装包版本和更新策略</p></div>
      <button v-if="canWrite" class="btn btn-primary" type="button" @click="openVersionModal()">新增版本</button>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>版本</th><th>版本号</th><th>平台</th><th>更新策略</th><th>状态</th><th>创建时间</th><th v-if="canWrite" class="actions">操作</th></tr></thead>
        <tbody>
          <tr v-for="item in versions" :key="item._id">
            <td data-label="版本"><strong>{{ versionLabel(item) }}</strong></td>
            <td data-label="版本号">{{ item.versionCode ?? '-' }}</td>
            <td data-label="平台">{{ item.platform || '-' }}</td>
            <td data-label="更新策略"><span class="tag" :class="item.forceUpdate ? 'tag-red' : 'tag-blue'">{{ item.forceUpdate ? '强制更新' : '可选更新' }}</span></td>
            <td data-label="状态"><span class="tag" :class="item.status === 'published' ? 'tag-green' : 'tag-gray'">{{ item.status === 'published' ? '已发布' : '草稿' }}</span></td>
            <td data-label="创建时间">{{ formatDate(item.createdAt) }}</td>
            <td v-if="canWrite" data-label="操作" class="actions"><div class="action-list"><button class="btn-link" type="button" :disabled="Boolean(operatingId)" @click="openVersionModal(item)">编辑</button><button class="btn-link" type="button" :disabled="Boolean(operatingId)" @click="toggleVersion(item)">{{ item.status === 'published' ? '下架' : '发布' }}</button><button class="btn-link danger" type="button" :disabled="Boolean(operatingId)" @click="removeItem('version', item)">删除</button></div></td>
          </tr>
          <tr v-if="versionLoading"><td :colspan="canWrite ? 7 : 6" class="empty-cell">正在加载...</td></tr>
          <tr v-else-if="!versions.length"><td :colspan="canWrite ? 7 : 6" class="empty-cell">暂无 APP 版本</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="showAnnouncementModal && canWrite" class="modal-overlay" @click.self="showAnnouncementModal = false">
    <form class="modal" @submit.prevent="saveAnnouncement">
      <div class="modal-header"><h3>{{ editingAnnouncement ? '编辑 APP 公告' : '新增 APP 公告' }}</h3><button class="modal-close" type="button" @click="showAnnouncementModal = false">×</button></div>
      <div class="modal-body">
        <div class="input-group"><label for="app-announcement-title">公告标题</label><input id="app-announcement-title" v-model.trim="announcementForm.title" class="input" maxlength="200" required /></div>
        <div class="input-group"><label for="app-announcement-content">公告内容</label><textarea id="app-announcement-content" v-model.trim="announcementForm.content" class="textarea" rows="7" required></textarea></div>
        <div v-if="!editingAnnouncement" class="input-group"><label for="app-announcement-status">发布状态</label><select id="app-announcement-status" v-model="announcementForm.status" class="select"><option value="published">立即上架</option><option value="draft">暂不上架</option></select></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" type="button" :disabled="submitting" @click="showAnnouncementModal = false">取消</button><button class="btn btn-primary" type="submit" :disabled="submitting">{{ submitting ? '保存中...' : '保存' }}</button></div>
    </form>
  </div>

  <div v-if="showVersionModal && canWrite" class="modal-overlay" @click.self="showVersionModal = false">
    <form class="modal" @submit.prevent="saveVersion">
      <div class="modal-header"><h3>{{ editingVersion ? '编辑 APP 版本' : '新增 APP 版本' }}</h3><button class="modal-close" type="button" @click="showVersionModal = false">×</button></div>
      <div class="modal-body">
        <div class="form-grid"><div class="input-group"><label for="version-name">版本名称</label><input id="version-name" v-model.trim="versionForm.versionName" class="input" placeholder="如 1.2.0" required /></div><div class="input-group"><label for="version-code">版本号</label><input id="version-code" v-model.number="versionForm.versionCode" class="input" type="number" min="1" required /></div></div>
        <div class="input-group"><label>平台</label><input class="input" value="Android" disabled /></div>
        <div class="input-group"><label for="download-url">下载地址</label><input id="download-url" v-model.trim="versionForm.downloadUrl" class="input" type="url" placeholder="https://..." required /></div>
        <div class="input-group"><label for="release-notes">更新说明</label><textarea id="release-notes" v-model.trim="versionForm.releaseNotes" class="textarea" rows="5" required></textarea></div>
        <div class="form-grid"><div class="input-group"><label for="version-status">发布状态</label><select id="version-status" v-model="versionForm.status" class="select"><option value="published">发布</option><option value="draft">草稿</option></select></div><label class="check-field"><input v-model="versionForm.forceUpdate" type="checkbox" /> 强制用户更新</label></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" type="button" :disabled="submitting" @click="showVersionModal = false">取消</button><button class="btn btn-primary" type="submit" :disabled="submitting">{{ submitting ? '保存中...' : '保存' }}</button></div>
    </form>
  </div>
</template>

<style scoped>
.app-heading, .section-toolbar { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.readonly-tip { padding:6px 12px; border-radius:999px; color:#475569; background:#e2e8f0; font-size:12px; }
.app-notice { margin-bottom:16px; padding:12px 14px; border:1px solid #bbf7d0; border-radius:10px; color:#166534; background:#f0fdf4; }
.app-notice.error { border-color:#fecaca; color:#991b1b; background:#fef2f2; }
.app-tabs { display:flex; gap:4px; margin-bottom:22px; padding:4px; width:max-content; border:1px solid var(--border); border-radius:12px; background:#fff; }
.app-tabs button { padding:8px 20px; border-radius:8px; color:#64748b; font-weight:600; }
.app-tabs button.active { color:#fff; background:var(--primary); }
.section-toolbar { align-items:center; margin-bottom:14px; }
.section-toolbar h2 { font-size:17px; }
.section-toolbar p { margin:3px 0 0; color:#94a3b8; font-size:12px; }
.summary-cell { max-width:360px; overflow:hidden; color:#64748b !important; text-overflow:ellipsis; white-space:nowrap; }
.actions { text-align:right !important; }
.action-list { display:flex; justify-content:flex-end; gap:2px; white-space:nowrap; }
.btn-link:disabled { opacity:.45; cursor:not-allowed; }
.empty-cell { padding:44px !important; text-align:center !important; color:#94a3b8 !important; }
.modal-close { color:#64748b; font-size:24px; }
.textarea { resize:vertical; }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.check-field { display:flex; align-items:center; gap:8px; min-height:42px; color:#475569; }
@media (max-width:768px) { .summary-cell { max-width:none; white-space:normal; overflow-wrap:anywhere; text-align:right; } .action-list { flex-wrap:wrap; } }
@media (max-width:576px) { .app-heading, .section-toolbar { align-items:stretch; flex-direction:column; } .section-toolbar .btn { width:100%; } .app-tabs { width:100%; } .app-tabs button { flex:1; padding-inline:10px; } .form-grid { grid-template-columns:1fr; gap:0; } .modal-overlay { align-items:flex-end; padding:10px; } .modal { max-height:calc(100vh - 20px); overflow-y:auto; } }
</style>
