// 忆梦云团队开发
const PlatformAdmin = require('../models/PlatformAdmin');
const { ok, error, comparePassword, signToken, getClientIp } = require('../utils');

class AdminAuthController {
  // POST /api/admin/auth/login
  async login(req, res) {
    const { username, password } = req.body;
    
    const admin = await PlatformAdmin.findOne({ username });
    if (!admin) {
      return error(res, '账号或密码错误', 401);
    }
    if (admin.status !== 'active') {
      return error(res, '账号已被禁用', 403);
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      return error(res, '账号已被锁定，请稍后再试', 423);
    }
    
    const matched = comparePassword(password, admin.password);
    if (!matched) {
      // 失败累加
      admin.loginAttempts = (admin.loginAttempts || 0) + 1;
      if (admin.loginAttempts >= 5) {
        admin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        admin.loginAttempts = 0;
      }
      await admin.save();
      return error(res, '账号或密码错误', 401);
    }
    
    // 登录成功
    admin.loginAttempts = 0;
    admin.lockedUntil = null;
    admin.lastLoginAt = new Date();
    await admin.save();
    
    const token = signToken({
      type: 'admin',
      id: admin._id.toString(),
      username: admin.username,
      role: admin.role,
    });
    
    return ok(res, {
      token,
      admin: admin.toJSON(),
    });
  }
  
  // POST /api/admin/auth/logout
  async logout(req, res) {
    // 无状态 JWT，前端自行清除 token 即可
    return ok(res, null, '已退出');
  }
  
  // GET /api/admin/auth/me
  async me(req, res) {
    const admin = await PlatformAdmin.findById(req.admin.id);
    if (!admin || admin.status !== 'active') {
      return error(res, '账号不存在或已禁用', 404);
    }
    return ok(res, admin.toJSON());
  }
}

module.exports = new AdminAuthController();
