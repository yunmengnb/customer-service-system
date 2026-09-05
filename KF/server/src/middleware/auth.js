// 忆梦云团队开发
const { verifyToken, error } = require('../utils');
const PlatformAdmin = require('../models/PlatformAdmin');
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const Customer = require('../models/Customer');
const Channel = require('../models/Channel');

/**
 * 平台管理员认证中间件
 * 同时检查 token 合法性 + admin 是否活跃
 */
async function authAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    return error(res, '未登录', 4011, 401);
  }
  
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'admin') {
    return error(res, '令牌无效或已过期', 4012, 401);
  }
  
  // 查数据库确认账号状态不被禁用
  try {
    const admin = await PlatformAdmin.findById(payload.id);
    if (!admin) {
      return error(res, '账号不存在', 4012, 401);
    }
    if (admin.status !== 'active') {
      return error(res, '账号已被禁用', 4032, 403);
    }
    // 用数据库最新数据覆盖 payload，防止 role 变更后 token 内信息过期
    req.admin = { ...payload, role: admin.role, status: admin.status };
  } catch (e) {
    return error(res, '服务异常', 5001, 500);
  }
  
  next();
}

/**
 * 必须超级管理员才能访问
 */
function requireSuperAdmin(req, res, next) {
  if (!req.admin) {
    return error(res, '未登录', 4011, 401);
  }
  if (req.admin.role !== 'super') {
    return error(res, '需要超级管理员权限', 4033, 403);
  }
  next();
}

/**
 * 租户用户认证中间件（包含所有者/管理员/员工）
 */
async function authTenantUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    return error(res, '未登录', 4011, 401);
  }
  
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'tenant_user') {
    return error(res, '令牌无效或已过期', 4012, 401);
  }

  try {
    const user = await TenantUser.findOne({ _id: payload.id, tenantId: payload.tenantId });
    if (!user) return error(res, '账号不存在', 4012, 401);
    if (user.status !== 'active') return error(res, '账号已被禁用', 4032, 403);

    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant || tenant.status !== 'active') {
      return error(res, '所属租户已被禁用', 4032, 403);
    }

    req.user = {
      ...payload,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    };
    req.tenantId = user.tenantId.toString();
    next();
  } catch (e) {
    return error(res, '服务异常', 5001, 500);
  }
}

/**
 * 仅管理员（所有者/角色为 admin）可访问
 */
function requireTenantAdmin(req, res, next) {
  if (!req.user) {
    return error(res, '未登录', 4011, 401);
  }
  if (req.user.role !== 'owner' && req.user.role !== 'admin') {
    return error(res, '权限不足', 4031, 403);
  }
  next();
}

/**
 * 客户认证中间件
 */
function authCustomer(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    return error(res, '未登录', 4011, 401);
  }
  
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'customer') {
    return error(res, '令牌无效或已过期', 4012, 401);
  }
  
  req.customer = payload;
  req.tenantId = payload.tenantId;
  next();
}

/**
 * 可选认证（未登录也可访问，但如果登录了会注入用户信息）
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      if (payload.type === 'admin') req.admin = payload;
      else if (payload.type === 'tenant_user') { req.user = payload; req.tenantId = payload.tenantId; }
      else if (payload.type === 'customer') { req.customer = payload; req.tenantId = payload.tenantId; }
    }
  }
  next();
}

/**
 * 请求 ID 生成
 */
function requestId(req, res, next) {
  res.locals.requestId = crypto.randomUUID();
  next();
}

const crypto = require('crypto');

module.exports = {
  authAdmin,
  requireSuperAdmin,
  authTenantUser,
  requireTenantAdmin,
  authCustomer,
  optionalAuth,
  requestId,
};
