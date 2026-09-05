<!-- 忆梦云团队开发 - 移动端资料管理 -->
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'

const router = useRouter()
const form = ref({ displayName: '', avatarUrl: '' })
const loading = ref(false)
const saving = ref(false)
const notice = ref({ type: '', text: '' })

function showNotice(type, text) {
  notice.value = { type, text }
  setTimeout(() => (notice.value = { type: '', text: '' }), 2500)
}

async function loadProfile() {
  loading.value = true
  try {
    const res = await api.get('/tenant/auth/me')
    if (res.code === 0 && res.data?.user) {
      form.value.displayName = res.data.user.displayName || ''
      form.value.avatarUrl = res.data.user.avatarUrl || ''
    }
  } catch (error) {
    showNotice('error', '加载资料失败')
  } finally {
    loading.value = false
  }
}

async function onAvatarChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    showNotice('error', '请选择图片文件')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    showNotice('error', '图片不能超过 5MB')
    return
  }

  const fd = new FormData()
  fd.append('file', file)

  try {
    showNotice('success', '上传中...')
    const res = await api.post('/upload/tenant', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (res.code === 0 && res.data?.url) {
      form.value.avatarUrl = res.data.url
      showNotice('success', '头像上传成功')
    } else {
      showNotice('error', res.message || '上传失败')
    }
  } catch (error) {
    showNotice('error', '上传失败，请重试')
  } finally {
    event.target.value = ''
  }
}

async function save() {
  const name = form.value.displayName.trim()
  if (!name) {
    showNotice('error', '昵称不能为空')
    return
  }
  if (name.length > 50) {
    showNotice('error', '昵称最多 50 字')
    return
  }

  saving.value = true
  try {
    const res = await api.patch('/tenant/auth/profile', {
      displayName: name,
      avatarUrl: form.value.avatarUrl.trim(),
    })

    if (res.code !== 0) throw new Error(res.message || '保存失败')

    // 更新本地存储
    const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
    if (res.data?.token) storage.setItem('tenant_token', res.data.token)
    if (res.data?.user) storage.setItem('tenant_user', JSON.stringify(res.data.user))

    showNotice('success', '保存成功')
    setTimeout(() => router.back(), 800)
  } catch (error) {
    showNotice('error', error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="edit-page">
    <div v-if="notice.text" :class="['edit-notice', 'is-' + notice.type]">{{ notice.text }}</div>

    <div v-if="loading" class="edit-state">正在加载...</div>
    <template v-else>
      <!-- 头像 -->
      <div class="edit-card">
        <div class="edit-card-title">头像</div>
        <div class="edit-avatar-row">
          <div class="edit-avatar-preview">
            <img v-if="form.avatarUrl" :src="form.avatarUrl" alt="头像" />
            <span v-else>{{ (form.displayName || '?').slice(0, 1).toUpperCase() }}</span>
          </div>
          <label class="edit-avatar-btn">
            选择图片
            <input type="file" accept="image/*" hidden @change="onAvatarChange" />
          </label>
          <button
            v-if="form.avatarUrl"
            class="edit-avatar-remove"
            type="button"
            @click="form.avatarUrl = ''"
          >
            清除
          </button>
        </div>
      </div>

      <!-- 昵称 -->
      <div class="edit-card">
        <div class="edit-card-title">昵称</div>
        <input
          v-model="form.displayName"
          class="edit-input"
          type="text"
          maxlength="50"
          placeholder="请输入昵称"
        />
      </div>

      <!-- 保存按钮 -->
      <div class="edit-save-wrap">
        <button class="edit-save" :disabled="saving" @click="save">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.edit-page { min-height: 100%; padding: 14px; background: #f5f6f8; }

.edit-notice {
  position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
  padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
  z-index: 99; box-shadow: 0 4px 12px rgba(0,0,0,.1);
}
.edit-notice.is-success { background: #dcfce7; color: #15803d; }
.edit-notice.is-error { background: #fee2e2; color: #dc2626; }

.edit-state { padding: 48px 20px; text-align: center; color: #64748b; }

.edit-card {
  background: #fff; border-radius: 14px; padding: 16px; margin-bottom: 14px;
}
.edit-card-title { font-size: 13px; color: #94a3b8; margin-bottom: 12px; }

.edit-avatar-row { display: flex; align-items: center; gap: 14px; }
.edit-avatar-preview {
  width: 64px; height: 64px; border-radius: 50%;
  background: #e2e8f0;
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 600; color: #64748b;
  overflow: hidden; flex-shrink: 0;
}
.edit-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.edit-avatar-btn {
  padding: 8px 16px; border: 1px solid #bfdbfe; border-radius: 8px;
  background: #eff6ff; color: #2563eb; font-size: 14px; font-weight: 500;
  cursor: pointer;
}
.edit-avatar-remove {
  padding: 8px 14px; border: 1px solid #fecaca; border-radius: 8px;
  background: #fef2f2; color: #dc2626; font-size: 14px; font-weight: 500;
}

.edit-input {
  width: 100%; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
  font-size: 15px; color: #0f172a; background: #f8fafc; box-sizing: border-box;
}
.edit-input:focus { outline: none; border-color: #2563eb; background: #fff; }

.edit-save-wrap { margin-top: 24px; }
.edit-save {
  width: 100%; padding: 14px; border: none; border-radius: 14px;
  background: #2563eb; color: #fff; font-size: 16px; font-weight: 600;
}
.edit-save:active { background: #1d4ed8; }
.edit-save:disabled { background: #93c5fd; }
</style>
