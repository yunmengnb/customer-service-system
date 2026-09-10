// 忆梦云团队开发 - 私有会话附件读取控制器
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ConversationAttachment = require('../models/ConversationAttachment');
const Message = require('../models/Message');
const { error, ok } = require('../utils');
const { absoluteStoragePath, canAccessAttachment } = require('../services/conversationAttachmentService');

function disposition(name) {
  const safe = path.basename(String(name || 'file')).replace(/[\r\n"]/g, '');
  return `inline; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function setPrivateHeaders(res) {
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
  });
}

function pipeFile(res, filePath, options) {
  const stream = fs.createReadStream(filePath, options);
  stream.on('error', () => {
    if (!res.headersSent) error(res, '附件文件读取失败', 5001, 500);
    else res.destroy();
  });
  stream.pipe(res);
  return stream;
}

async function resolve(req, res) {
  setPrivateHeaders(res);
  if (!mongoose.isValidObjectId(req.params.id)) {
    error(res, '附件不存在', 4041, 404);
    return null;
  }
  const attachment = await ConversationAttachment.findById(req.params.id);
  if (!attachment) {
    error(res, '附件不存在', 4041, 404);
    return null;
  }
  if (!await canAccessAttachment(req, attachment)) {
    error(res, '无权访问附件', 4031, 403);
    return null;
  }
  const expired = attachment.expiresAt && attachment.expiresAt <= new Date();
  if (attachment.status !== 'active' || expired) {
    error(res, '附件已失效', 4101, 410);
    return null;
  }
  const message = await Message.findOne({ _id: attachment.messageId, tenantId: attachment.tenantId });
  const hidden = message && ((req.customer && message.deletedForCustomerAt) || (req.user && message.deletedForAgentAt));
  if (!message || message.recalledAt || hidden) {
    error(res, '附件已失效', 4101, 410);
    return null;
  }
  if (String(message.attachmentId) !== String(attachment._id) || message.attachmentStatus !== 'active') {
    error(res, '附件已失效', 4101, 410);
    return null;
  }
  return attachment;
}

async function sendFile(req, res, thumbnail) {
  const attachment = await resolve(req, res);
  if (!attachment) return;
  const storageKey = thumbnail
    ? (attachment.thumbnailStorageKey || (attachment.category === 'image' ? attachment.storageKey : ''))
    : attachment.storageKey;
  if (!storageKey) return error(res, '缩略图不存在', 4041, 404);
  let filePath;
  let stat;
  try {
    filePath = absoluteStoragePath(storageKey);
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return error(res, '附件已失效', 4101, 410);
  } catch (_) {
    return error(res, '附件已失效', 4101, 410);
  }
  const mime = thumbnail && attachment.thumbnailStorageKey ? 'image/jpeg' : (attachment.mimeType || 'application/octet-stream');
  res.set({
    'Content-Type': mime,
    'Content-Disposition': disposition(thumbnail ? 'thumbnail.jpg' : attachment.originalName),
  });
  if (!thumbnail) res.set('Accept-Ranges', 'bytes');
  const range = !thumbnail ? req.headers.range : null;
  if (!range) {
    res.set('Content-Length', stat.size);
    return pipeFile(res, filePath);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
    }
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= stat.size) {
    return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
  }
  end = Math.min(end, stat.size - 1);
  res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
  return pipeFile(res, filePath, { start, end });
}

module.exports = {
  original(req, res) { return sendFile(req, res, false); },
  thumbnail(req, res) { return sendFile(req, res, true); },
  async status(req, res) {
    const attachment = await resolve(req, res);
    if (!attachment) return;
    return ok(res, { attachmentId: attachment._id, status: attachment.status, expiresAt: attachment.expiresAt });
  },
};
