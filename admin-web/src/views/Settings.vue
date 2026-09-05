<!-- 忆梦云团队开发 - 系统设置 -->
<script setup>
import { computed, onMounted, reactive, ref, toRaw } from 'vue'
import api from '../api'

const tabs = [
  { key: 'upload', label: '上传' },
  { key: 'captcha', label: '验证码' },
  { key: 'smtp', label: '发信邮箱' },
  { key: 'auth', label: '注册登录' },
  { key: 'forbiddenWords', label: '违禁词' },
  { key: 'other', label: '其他' },
]

const defaults = {
  registerEnabled: true,
  loginEnabled: true,
  customerServiceDomain: '',
  siteTitle: '忆梦云客服',
  siteKeywords: '',
  siteDescription: '',
  forbiddenWords: '',
  upload: {
    maxFileSizeMB: 10,
    allowedTypes: 'jpg,jpeg,png,gif,webp,pdf,docx,xlsx,zip,txt,mp3,wav,mp4,webm',
  },
  captcha: {
    enabled: false,
    provider: 'image',
    imageLength: 4,
    expireSeconds: 300,
    geetestId: '',
    geetestKey: '',
  },
  smtp: {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    username: '',
    password: '',
    fromName: '',
    fromEmail: '',
  },
}

const activeTab = ref('upload')
const loading = ref(true)
const saving = ref(false)
const testingEmail = ref(false)
const testEmailTo = ref('')
const notice = ref(null)
const form = reactive(structuredClone(defaults))
const currentTab = computed(() => tabs.find(tab => tab.key === activeTab.value))

function applySettings(data) {
  const source = data?.settings || data || {}
  if (typeof source.registerEnabled === 'boolean') form.registerEnabled = source.registerEnabled
  if (typeof source.loginEnabled === 'boolean') form.loginEnabled = source.loginEnabled
  if (Array.isArray(source.forbiddenWords)) form.forbiddenWords = source.forbiddenWords.join('\n')
  for (const key of ['customerServiceDomain', 'siteTitle', 'siteKeywords', 'siteDescription']) {
    if (source[key] !== undefined) form[key] = source[key]
  }
  if (source.upload) {
    Object.assign(form.upload, source.upload)
    if (Array.isArray(source.upload.allowedTypes)) {
      form.upload.allowedTypes = source.upload.allowedTypes.join(',')
    }
  }
  if (source.captcha) Object.assign(form.captcha, source.captcha, { geetestKey: '' })
  if (source.smtp) Object.assign(form.smtp, source.smtp, { password: '' })
  if (source.getui) Object.assign(form.getui, source.getui, { appKey: '', masterSecret: '' })
}

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => {
    if (notice.value?.message === message) notice.value = null
  }, 3000)
}

async function loadSettings() {
  loading.value = true
  notice.value = null
  try {
    const res = await api.get('/admin/settings')
    if (res.code !== 0) throw new Error(res.message || '系统设置加载失败')
    applySettings(res.data)
  } catch (error) {
    showNotice('error', error?.message || '系统设置加载失败')
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  saving.value = true
  notice.value = null
  try {
    const payload = structuredClone(toRaw(form))
    payload.upload.allowedTypes = payload.upload.allowedTypes
      .split(',')
      .map(type => type.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean)
    payload.forbiddenWords = payload.forbiddenWords
      .split(/[\n,，]+/)
      .map(word => word.trim())
      .filter(Boolean)
    const res = await api.put('/admin/settings', payload)
    if (res.code !== 0) throw new Error(res.message || '系统设置保存失败')
    applySettings(res.data)
    showNotice('success', '系统设置已保存')
  } catch (error) {
    showNotice('error', error?.message || '系统设置保存失败')
  } finally {
    saving.value = false
  }
}

async function testEmail() {
  if (!/^\S+@\S+\.\S+$/.test(testEmailTo.value.trim())) {
    showNotice('error', '请输入正确的收件邮箱')
    return
  }
  testingEmail.value = true
  notice.value = null
  try {
    const res = await api.post('/admin/settings/test-email', { to: testEmailTo.value.trim() })
    if (res.code !== 0) throw new Error(res.message || '测试邮件发送失败')
    showNotice('success', res.message || '测试邮件已发送')
  } catch (error) {
    showNotice('error', error?.message || '测试邮件发送失败')
  } finally {
    testingEmail.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="page-header settings-heading">
    <div>
      <h1>系统设置</h1>
      <p class="desc">配置平台上传、验证码、发信邮箱、个推、注册登录、网站信息以及违禁词规则</p>
    </div>
    <button class="btn btn-primary" :disabled="loading || saving" @click="saveSettings">
      {{ saving ? '保存中...' : '保存设置' }}
    </button>
  </div>

  <div v-if="notice" class="settings-notice" :class="notice.type" role="status">
    {{ notice.message }}
  </div>

  <div class="settings-shell">
    <div class="settings-tabs" role="tablist" aria-label="系统设置分类">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="settings-panel">
      <div v-if="loading" class="settings-state">正在加载系统设置...</div>

      <template v-else>
        <div class="panel-title">
          <h2>{{ currentTab.label }}设置</h2>
          <p v-if="activeTab === 'upload'">限制平台附件上传方式、大小和文件类型。</p>
          <p v-else-if="activeTab === 'captcha'">配置人机验证服务及验证码有效期。</p>
          <p v-else-if="activeTab === 'smtp'">配置用于通知和验证邮件的 SMTP 服务。</p>
          <p v-else-if="activeTab === 'getui'">动态配置客服 Android 应用的个推通知，数据库配置优先于环境变量。</p>
          <p v-else-if="activeTab === 'auth'">控制账号注册和登录功能。</p>
          <p v-else-if="activeTab === 'forbiddenWords'">配置消息内容中不允许出现的词语。</p>
          <p v-else>配置客服访问域名与网站搜索展示信息。</p>
        </div>

        <div v-if="activeTab === 'upload'" class="settings-grid">
          <div class="input-group">
            <label for="upload-limit">单文件大小上限（MB）</label>
            <input id="upload-limit" v-model.number="form.upload.maxFileSizeMB" class="input" type="number" min="1" max="1024" />
          </div>
          <div class="input-group full-width">
            <label for="upload-types">允许的文件扩展名</label>
            <input id="upload-types" v-model.trim="form.upload.allowedTypes" class="input" placeholder="jpg,png,pdf,zip" />
            <span class="hint">多个扩展名请使用英文逗号分隔，不要包含点号。</span>
          </div>
        </div>

        <div v-else-if="activeTab === 'captcha'" class="settings-grid">
          <div class="setting-switch full-width">
            <div><strong>启用验证码服务</strong><span>关闭后所有验证码场景将停止校验。</span></div>
            <label class="switch"><input v-model="form.captcha.enabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="input-group">
            <label for="captcha-provider">验证码类型</label>
            <select id="captcha-provider" v-model="form.captcha.provider" class="select">
              <option value="image">图片验证码</option>
              <option value="geetest">极验 V3 验证码</option>
            </select>
          </div>
          <div class="input-group">
            <label for="captcha-expire">有效期（秒）</label>
            <input id="captcha-expire" v-model.number="form.captcha.expireSeconds" class="input" type="number" min="60" max="1800" />
          </div>
          <div v-if="form.captcha.provider === 'image'" class="input-group">
            <label for="captcha-image-length">图片验证码长度</label>
            <input id="captcha-image-length" v-model.number="form.captcha.imageLength" class="input" type="number" min="4" max="8" />
          </div>
          <template v-else>
            <div class="input-group">
              <label for="captcha-geetest-id">极验 V3 验证 ID</label>
              <input id="captcha-geetest-id" v-model.trim="form.captcha.geetestId" class="input" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="captcha-geetest-key">极验 V3 验证 Key</label>
              <input id="captcha-geetest-key" v-model="form.captcha.geetestKey" class="input" type="password" autocomplete="new-password" placeholder="留空则不修改" />
              <span v-if="form.captcha.geetestKeyConfigured" class="hint">已配置验证 Key。</span>
            </div>
          </template>
        </div>

        <div v-else-if="activeTab === 'smtp'" class="settings-grid">
          <div class="setting-switch full-width">
            <div><strong>启用 SMTP 发信</strong><span>启用后系统将使用以下配置发送通知和验证邮件。</span></div>
            <label class="switch"><input v-model="form.smtp.enabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="input-group">
            <label for="mail-host">SMTP 服务器</label>
            <input id="mail-host" v-model.trim="form.smtp.host" class="input" placeholder="smtp.example.com" />
          </div>
          <div class="input-group">
            <label for="mail-port">SMTP 端口</label>
            <input id="mail-port" v-model.number="form.smtp.port" class="input" type="number" min="1" max="65535" />
          </div>
          <div class="input-group">
            <label for="mail-username">登录账号</label>
            <input id="mail-username" v-model.trim="form.smtp.username" class="input" autocomplete="off" />
          </div>
          <div class="input-group">
            <label for="mail-password">登录密码 / 授权码</label>
            <input id="mail-password" v-model="form.smtp.password" class="input" type="password" autocomplete="new-password" placeholder="留空则不修改" />
            <span v-if="form.smtp.passwordConfigured" class="hint">已配置登录密码。</span>
          </div>
          <div class="input-group">
            <label for="mail-from-name">发件人名称</label>
            <input id="mail-from-name" v-model.trim="form.smtp.fromName" class="input" placeholder="忆梦云客服" />
          </div>
          <div class="input-group">
            <label for="mail-from-email">发件邮箱</label>
            <input id="mail-from-email" v-model.trim="form.smtp.fromEmail" class="input" type="email" placeholder="service@example.com" />
          </div>
          <div class="setting-switch full-width">
            <div><strong>SSL/TLS 加密</strong><span>通常 465 端口开启，587 端口关闭并使用 STARTTLS。</span></div>
            <label class="switch"><input v-model="form.smtp.secure" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="email-test full-width">
            <div class="input-group">
              <label for="test-email-to">测试收件邮箱</label>
              <input id="test-email-to" v-model.trim="testEmailTo" class="input" type="email" placeholder="recipient@example.com" @keyup.enter="testEmail" />
            </div>
            <button class="btn" type="button" :disabled="saving || testingEmail" @click="testEmail">
              {{ testingEmail ? '发送中...' : '发送测试邮件' }}
            </button>
          </div>
        </div>

        <div v-else-if="activeTab === 'getui'" class="settings-grid">
          <div class="setting-switch full-width">
            <div><strong>启用个推通知</strong><span>关闭后停止向客服 Android 应用发送通知。</span></div>
            <label class="switch"><input v-model="form.getui.enabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="input-group">
            <label for="getui-app-id">AppId</label>
            <input id="getui-app-id" v-model.trim="form.getui.appId" class="input" autocomplete="off" @input="form.getui.appIdFromEnvironment = false" />
            <span v-if="form.getui.appIdFromEnvironment" class="hint">当前值回退自环境变量；保存非空值后改用数据库配置。</span>
          </div>
          <div class="input-group">
            <label for="getui-base-url">API 地址</label>
            <input id="getui-base-url" v-model.trim="form.getui.baseUrl" class="input" placeholder="https://restapi.getui.com/v2" />
          </div>
          <div class="input-group">
            <label for="getui-app-key">AppKey</label>
            <input id="getui-app-key" v-model="form.getui.appKey" class="input" type="password" autocomplete="new-password" placeholder="留空则不修改" />
            <span v-if="form.getui.appKeyConfigured" class="hint">AppKey 已配置<span v-if="form.getui.appKeyFromEnvironment">（环境变量回退）</span>。</span>
          </div>
          <div class="input-group">
            <label for="getui-master-secret">MasterSecret</label>
            <input id="getui-master-secret" v-model="form.getui.masterSecret" class="input" type="password" autocomplete="new-password" placeholder="留空则不修改" />
            <span v-if="form.getui.masterSecretConfigured" class="hint">MasterSecret 已配置<span v-if="form.getui.masterSecretFromEnvironment">（环境变量回退）</span>。</span>
          </div>
          <div class="input-group">
            <label for="getui-timeout">请求超时（毫秒）</label>
            <input id="getui-timeout" v-model.number="form.getui.timeoutMs" class="input" type="number" min="1000" max="60000" />
          </div>
          <div class="input-group">
            <label for="getui-ttl">通知有效期（毫秒）</label>
            <input id="getui-ttl" v-model.number="form.getui.ttlMs" class="input" type="number" min="60000" max="604800000" />
          </div>
          <div class="setting-switch full-width">
            <div><strong>隐藏消息内容</strong><span>通知栏仅显示“您有一条新的客户消息”，避免暴露客户消息正文。</span></div>
            <label class="switch"><input v-model="form.getui.hideMessageContent" type="checkbox" /><span class="slider"></span></label>
          </div>
        </div>

        <div v-else-if="activeTab === 'auth'" class="settings-grid">
          <div class="setting-switch full-width">
            <div><strong>开放用户注册</strong><span>关闭后新用户无法创建账号，已有账号不受影响。</span></div>
            <label class="switch"><input v-model="form.registerEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="setting-switch full-width">
            <div><strong>允许用户登录</strong><span>关闭后用户将无法登录平台。</span></div>
            <label class="switch"><input v-model="form.loginEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
        </div>

        <div v-else-if="activeTab === 'forbiddenWords'" class="settings-grid">
          <div class="input-group full-width">
            <label for="forbidden-words">违禁词列表</label>
            <textarea id="forbidden-words" v-model="form.forbiddenWords" class="textarea forbidden-words-input" rows="10" placeholder="违禁词一&#10;违禁词二,违禁词三"></textarea>
            <span class="hint">多个违禁词支持每行一个，或使用中英文逗号分隔。</span>
          </div>
        </div>

        <div v-else class="settings-grid">
          <div class="input-group full-width">
            <label for="customer-service-domain">客服专属域名</label>
            <input id="customer-service-domain" v-model.trim="form.customerServiceDomain" class="input" placeholder="https://chat.example.com" />
            <span class="hint">用于用户后台生成渠道客服链接；不填写时继续使用 /c/ 开头的相对链接。</span>
          </div>
          <div class="input-group full-width">
            <label for="site-title">网站标题</label>
            <input id="site-title" v-model.trim="form.siteTitle" class="input" maxlength="120" placeholder="忆梦云客服" />
          </div>
          <div class="input-group full-width">
            <label for="site-keywords">网站关键词</label>
            <input id="site-keywords" v-model.trim="form.siteKeywords" class="input" maxlength="500" placeholder="在线客服,客户服务" />
          </div>
          <div class="input-group full-width">
            <label for="site-description">网站描述</label>
            <textarea id="site-description" v-model.trim="form.siteDescription" class="textarea" rows="4" maxlength="500" placeholder="请输入网站描述"></textarea>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.settings-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.settings-shell { overflow: hidden; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.settings-tabs { display: flex; gap: 6px; padding: 10px 18px 0; overflow-x: auto; border-bottom: 1px solid var(--border); }
.settings-tab { position: relative; flex: 0 0 auto; padding: 12px 18px; color: var(--text-sec); font-size: 14px; font-weight: 600; }
.settings-tab:hover { color: var(--primary); }
.settings-tab.active { color: var(--primary); }
.settings-tab.active::after { position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; border-radius: 2px 2px 0 0; background: var(--primary); content: ''; }
.settings-panel { min-height: 390px; padding: 28px; }
.panel-title { margin-bottom: 24px; }
.panel-title h2 { font-size: 18px; }
.panel-title p { margin: 6px 0 0; color: var(--text-muted); font-size: 13px; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; max-width: 820px; }
.settings-grid .full-width { grid-column: 1 / -1; }
.forbidden-words-input { min-height: 220px; line-height: 1.6; resize: vertical; }
.email-test { display: flex; align-items: flex-end; gap: 16px; }
.email-test .input-group { flex: 1; margin-bottom: 0; }
.email-test .btn { flex: 0 0 auto; margin-bottom: 16px; }
.setting-switch { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 68px; margin-bottom: 12px; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: #f8fafc; }
.setting-switch strong, .setting-switch span { display: block; }
.setting-switch strong { margin-bottom: 2px; color: var(--text-main); font-size: 13px; }
.setting-switch div > span { color: var(--text-muted); font-size: 12px; }
.setting-switch .switch { flex: 0 0 42px; }
.settings-state { display: flex; min-height: 330px; align-items: center; justify-content: center; color: var(--text-muted); }
.settings-notice { margin-bottom: 16px; padding: 11px 14px; border: 1px solid; border-radius: var(--radius-md); font-size: 13px; }
.settings-notice.success { border-color: rgba(16, 185, 129, .3); background: var(--success-soft); color: #047857; }
.settings-notice.error { border-color: rgba(239, 68, 68, .3); background: var(--danger-soft); color: #b91c1c; }
@media (max-width: 768px) {
  .settings-heading { align-items: stretch; flex-direction: column; }
  .settings-heading .btn { width: 100%; }
  .settings-tabs { padding-right: 10px; padding-left: 10px; }
  .settings-tab { padding-right: 14px; padding-left: 14px; }
  .settings-panel { padding: 22px 16px; }
  .settings-grid { grid-template-columns: 1fr; }
  .settings-grid .full-width { grid-column: auto; }
  .email-test { align-items: stretch; flex-direction: column; }
  .email-test .btn { margin-bottom: 12px; }
  .setting-switch { gap: 16px; }
}
</style>
