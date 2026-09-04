// 忆梦云团队开发
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const { ok, error, hashPassword, comparePassword, signToken, getClientIp } = require('../utils');

class TenantAuthController {
  // POST /api/tenant/auth/register
  async register(req, res) {
    const { name, username, password, email } = req.body;
    
    // 检查用户名
    if (await Tenant.findOne({ username })) {
      return error(res, '用户名已被注册');
    }
    // 检查邮箱
    if (await Tenant.findOne({ email })) {
      return error(res, '邮箱已被注册');
    }
    
    // 创建租户
    const tenant = await Tenant.create({
      name,
      username,
      password: hashPassword(password),
      email,
      status: 'active',
    });
    
    // 创建租户所有者（关联到 tenantId，用于登录后角色）
    const owner = await TenantUser.create({
      tenantId: tenant._id,
      username,
      password: hashPassword(password),
      displayName: name,
      role: 'owner',
      status: 'active',
    });
    
    return ok(res, { tenant: tenant.toJSON(), owner: owner.toJSON() });
  }
  
  // POST /api/tenant/auth/login
  async login(req, res) {
    const { username, password } = req.body;
    
    // 先尝试用 Tenant 主账号登录
    const tenant = await Tenant.findOne({ username });
    if (tenant && tenant.status !== 'active') {
      return error(res, '账号已被禁用', 403);
    }
    
    if (tenant && comparePassword(password, tenant.password)) {
      tenant.lastLoginAt = new Date();
      await tenant.save();
      
      // 确保有对应的 owner TenantUser 记录
      let owner = await TenantUser.findOne({ tenantId: tenant._id, role: 'owner' });
      if (!owner) {
        owner = await TenantUser.create({
          tenantId: tenant._id,
          username: tenant.username,
          password: tenant.password, // 已是 hash
          displayName: tenant.name,
          role: 'owner',
          status: 'active',
        });
      }
      owner.lastLoginAt = new Date();
      await owner.save();
      
      const token = signToken({
        type: 'tenant_user',
        id: owner._id.toString(),
        tenantId: tenant._id.toString(),
        username: owner.username,
        displayName: owner.displayName,
        role: owner.role,
      });
      
      return ok(res, {
        token,
        tenant: tenant.toJSON(),
        user: owner.toJSON(),
      });
    }
    
    // 再尝试用 TenantUser 坐席账号登录
    const user = await TenantUser.findOne({ username });
    if (!user) {
      return error(res, '账号或密码错误', 401);
    }
    if (user.status !== 'active') {
      return error(res, '账号已被禁用', 403);
    }
    
    // 检查租户状态
    const tenantObj = await Tenant.findById(user.tenantId);
    if (!tenantObj || tenantObj.status !== 'active') {
      return error(res, '所属租户已被禁用', 403);
    }
    
    if (!comparePassword(password, user.password)) {
      return error(res, '账号或密码错误', 401);
    }
    
    user.lastLoginAt = new Date();
    await user.save();
    
    const token = signToken({
      type: 'tenant_user',
      id: user._id.toString(),
      tenantId: user.tenantId.toString(),
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    });
    
    return ok(res, {
      token,
      tenant: tenantObj.toJSON(),
      user: user.toJSON(),
    });
  }
  
  // GET /api/tenant/auth/me
  async me(req, res) {
    const user = await TenantUser.findById(req.user.id);
    if (!user) {
      return error(res, '账号不存在', 404);
    }
    const tenant = await Tenant.findById(user.tenantId);
    return ok(res, {
      user: user.toJSON(),
      tenant: tenant ? tenant.toJSON() : null,
    });
  }
  
  // POST /api/tenant/auth/logout
  async logout(req, res) {
    return ok(res, null, '已退出');
  }
}

module.exports = new TenantAuthController();
