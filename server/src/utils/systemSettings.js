// 忆梦云团队开发
const SystemSetting = require('../models/SystemSetting');

let cached = null;
let expiresAt = 0;

async function getSystemSettings() {
  if (cached && expiresAt > Date.now()) return cached;
  cached = await SystemSetting.getSingleton();
  expiresAt = Date.now() + 5000;
  return cached;
}

function clearSystemSettingsCache() {
  cached = null;
  expiresAt = 0;
}

function resolveGetuiSettings(setting) {
  const stored = setting?.getui || {};
  return {
    enabled: stored.enabled !== false,
    appId: String(stored.appId || process.env.GETUI_APP_ID || '').trim(),
    appKey: String(stored.appKey || process.env.GETUI_APP_KEY || '').trim(),
    masterSecret: String(stored.masterSecret || process.env.GETUI_MASTER_SECRET || ''),
    baseUrl: String(stored.baseUrl || process.env.GETUI_BASE_URL || 'https://restapi.getui.com/v2').trim().replace(/\/$/, ''),
    timeoutMs: Number(stored.timeoutMs || process.env.GETUI_TIMEOUT_MS) || 8000,
    ttlMs: Number(stored.ttlMs || process.env.GETUI_TTL_MS) || 2 * 60 * 60 * 1000,
    hideMessageContent: typeof stored.hideMessageContent === 'boolean'
      ? stored.hideMessageContent
      : process.env.GETUI_HIDE_MESSAGE_CONTENT === 'true',
  };
}

function publicSettings(setting) {
  const data = setting.toObject ? setting.toObject() : { ...setting };
  if (data.captcha) {
    data.captcha.geetestKeyConfigured = Boolean(data.captcha.geetestKey);
    delete data.captcha.geetestKey;
  }
  if (data.smtp) {
    data.smtp.passwordConfigured = Boolean(data.smtp.password);
    delete data.smtp.password;
  }
  const effectiveGetui = resolveGetuiSettings(setting);
  const storedGetui = data.getui || {};
  data.getui = {
    enabled: effectiveGetui.enabled,
    appId: effectiveGetui.appId,
    baseUrl: effectiveGetui.baseUrl,
    timeoutMs: effectiveGetui.timeoutMs,
    ttlMs: effectiveGetui.ttlMs,
    hideMessageContent: effectiveGetui.hideMessageContent,
    appKeyConfigured: Boolean(effectiveGetui.appKey),
    masterSecretConfigured: Boolean(effectiveGetui.masterSecret),
    appIdFromEnvironment: !storedGetui.appId && Boolean(process.env.GETUI_APP_ID),
    appKeyFromEnvironment: !storedGetui.appKey && Boolean(process.env.GETUI_APP_KEY),
    masterSecretFromEnvironment: !storedGetui.masterSecret && Boolean(process.env.GETUI_MASTER_SECRET),
  };
  delete data.singletonKey;
  return data;
}

function publicWebsiteSettings(setting) {
  return {
    siteTitle: setting.siteTitle || '忆梦云客服',
    siteKeywords: setting.siteKeywords || '',
    siteDescription: setting.siteDescription || '',
  };
}

function buildCustomerServiceLink(setting, publicToken) {
  const path = `/c/${publicToken}`;
  return setting.customerServiceDomain ? `${setting.customerServiceDomain}${path}` : path;
}

module.exports = {
  getSystemSettings,
  clearSystemSettingsCache,
  resolveGetuiSettings,
  publicSettings,
  publicWebsiteSettings,
  buildCustomerServiceLink,
};
