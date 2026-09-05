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
  publicSettings,
  publicWebsiteSettings,
  buildCustomerServiceLink,
};
