// 忆梦云团队开发
const crypto = require('crypto');
const PushDevice = require('../models/PushDevice');
const Channel = require('../models/Channel');
const { getSystemSettings, resolveGetuiSettings } = require('./systemSettings');

let cachedToken = '';
let cachedCredentialKey = '';
let tokenExpiresAt = 0;

function isConfigured(getui) {
  return Boolean(getui.enabled && getui.appId && getui.appKey && getui.masterSecret);
}

async function request(getui, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getui.timeoutMs);
  try {
    const response = await fetch(`${getui.baseUrl}/${getui.appId}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json;charset=utf-8', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.code !== 0) {
      throw new Error(`HTTP ${response.status}, code ${body.code ?? 'unknown'}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function getToken(getui) {
  const credentialKey = crypto.createHash('sha256')
    .update(`${getui.baseUrl}\0${getui.appId}\0${getui.appKey}\0${getui.masterSecret}`)
    .digest('hex');
  if (cachedToken && cachedCredentialKey === credentialKey && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  const timestamp = Date.now().toString();
  const sign = crypto.createHash('sha256')
    .update(`${getui.appKey}${timestamp}${getui.masterSecret}`)
    .digest('hex');
  const result = await request(getui, '/auth', {
    method: 'POST',
    body: JSON.stringify({ sign, timestamp, appkey: getui.appKey }),
  });
  cachedToken = result.data.token;
  cachedCredentialKey = credentialKey;
  tokenExpiresAt = Number(result.data.expire_time) || Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken;
}

function messageSummary(message) {
  if (message.messageType === 'image') return '[图片]';
  if (message.messageType === 'video') return '[视频]';
  if (message.messageType === 'file') return `[文件]${message.attachmentName ? ` ${message.attachmentName}` : ''}`;
  const compact = String(message.content || '').replace(/\s+/g, ' ').trim();
  return compact.length > 80 ? `${compact.slice(0, 80)}…` : compact || '您有一条新的客户消息';
}

async function pushCustomerMessage({ conversation, message }) {
  const getui = resolveGetuiSettings(await getSystemSettings());
  if (!isConfigured(getui)) return { skipped: true };

  const channel = await Channel.findOne({
    _id: conversation.channelId,
    tenantId: conversation.tenantId,
  }).select('brandName name agentIds').lean();
  if (!channel) return { skipped: true };

  const recipientIds = conversation.status === 'active' && conversation.assignedAgentId
    ? [conversation.assignedAgentId]
    : channel.agentIds;
  if (!recipientIds.length) return { skipped: true };

  const devices = await PushDevice.find({
    tenantId: conversation.tenantId,
    userId: { $in: recipientIds },
    platform: 'android',
    enabled: true,
  }).select('clientId').lean();
  if (!devices.length) return { skipped: true };

  const token = await getToken(getui);
  const payload = JSON.stringify({
    type: 'message',
    messageId: message._id.toString(),
    conversationId: conversation._id.toString(),
    channelId: conversation.channelId.toString(),
  });
  const title = `忆梦云客服 · ${channel.brandName || channel.name || '新消息'}`;
  const body = getui.hideMessageContent ? '您有一条新的客户消息' : messageSummary(message);

  const results = await Promise.allSettled(devices.map(device => request(getui, '/push/single/cid', {
    method: 'POST',
    headers: { token },
    body: JSON.stringify({
      request_id: crypto.randomBytes(16).toString('hex'),
      settings: { ttl: getui.ttlMs },
      audience: { cid: [device.clientId] },
      push_message: { transmission: payload },
      push_channel: {
        android: {
          ups: {
            notification: { title, body, click_type: 'startapp', payload },
          },
        },
      },
    }),
  })));

  const failed = results.filter(result => result.status === 'rejected').length;
  if (failed) console.warn(`[Getui] 消息 ${message._id} 推送失败设备数: ${failed}`);
  return { sent: devices.length - failed, failed };
}

module.exports = { isConfigured, pushCustomerMessage };
