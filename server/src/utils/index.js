// 忆梦云团队开发
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

/**
 * 生成密码哈希
 */
function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

/**
 * 验证密码
 */
function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

/**
 * 生成 JWT Token
 */
function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

/**
 * 验证 JWT Token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return null;
  }
}

/**
 * 生成不可枚举的随机 Token（用于客服链接等）
 */
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * 标准化手机号（简单处理：去掉空格和横杠）
 */
function normalizePhone(phone) {
  return String(phone).replace(/[\s\-]/g, '').trim();
}

/**
 * 生成 HMAC 指纹哈希
 */
function hashFingerprint(fpString) {
  return crypto.createHmac('sha256', config.jwt.secret)
    .update(fpString || '')
    .digest('hex');
}

/**
 * 获取客户端真实 IP（考虑反向代理）
 */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * 统一响应工具
 */
function ok(res, data = null, message = 'success') {
  return res.json({ code: 0, message, data, requestId: res.locals.requestId });
}

function error(res, message = 'error', code = 1, status = 400, data = null) {
  return res.status(status).json({ code, message, data, requestId: res.locals.requestId });
}

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  generateToken,
  normalizePhone,
  hashFingerprint,
  getClientIp,
  ok,
  error,
};
