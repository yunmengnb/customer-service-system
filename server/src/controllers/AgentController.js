// 忆梦云团队开发
const TenantUser = require('../models/TenantUser');
const Tenant = require('../models/Tenant');
const { ok, error, hashPassword, signToken } = require('../utils');

class AgentController {
  // GET /api/tenant/employees
  async list(req, res) {
    const { tenantId } = req;
    const users = await TenantUser.find({ tenantId }).sort({ createdAt: -1 });
    return ok(res, users.map(u => u.toJSON()));
  }
  
  // POST /api/tenant/employees
  async create(req, res) {
    const { tenantId } = req;
    const { username, displayName, password, role = 'agent' } = req.body;
    
    // 数量限制
    const tenant = await Tenant.findById(tenantId);
    const currentCount = await TenantUser.countDocuments({
      tenantId,
      role: { $ne: 'owner' },
    });
    if (currentCount >= tenant.plan.agentLimit) {
      return error(res, '已达到员工数量上限');
    }
    
    // 唯一用户名
    if (await TenantUser.findOne({ tenantId, username })) {
      return error(res, '用户名已存在');
    }
    
    const user = await TenantUser.create({
      tenantId,
      username,
      password: hashPassword(password),
      displayName,
      role,
      status: 'active',
    });
    
    return ok(res, user.toJSON());
  }
  
  // PATCH /api/tenant/employees/:id
  async update(req, res) {
    const { tenantId } = req;
    const { id } = req.params;
    const user = await TenantUser.findOne({ _id: id, tenantId });
    if (!user) return error(res, '员工不存在', 404);
    if (user.role === 'owner') return error(res, '不能修改所有者账号');

    if (req.body.username !== undefined && req.body.username !== user.username) {
      const username = String(req.body.username).trim();
      if (username.length < 3) return error(res, '用户名至少3位');
      if (await TenantUser.findOne({ tenantId, username, _id: { $ne: user._id } })) {
        return error(res, '用户名已存在');
      }
      user.username = username;
    }
    if (req.body.displayName !== undefined) user.displayName = req.body.displayName;
    if (req.body.role !== undefined && ['admin', 'agent'].includes(req.body.role)) user.role = req.body.role;
    if (req.body.status !== undefined && ['active', 'disabled'].includes(req.body.status)) user.status = req.body.status;
    if (req.body.avatarUrl !== undefined) user.avatarUrl = req.body.avatarUrl;
    
    await user.save();
    return ok(res, user.toJSON());
  }
  
  // DELETE /api/tenant/employees/:id
  async delete(req, res) {
    const { tenantId } = req;
    const { id } = req.params;
    const user = await TenantUser.findOne({ _id: id, tenantId });
    if (!user) return error(res, '员工不存在', 404);
    
    if (user.role === 'owner') {
      return error(res, '不能删除所有者账号');
    }
    if (String(user._id) === String(req.user.id)) {
      return error(res, '不能删除当前登录账号');
    }
    
    await TenantUser.deleteOne({ _id: id });
    return ok(res, null, '已删除');
  }
  
  // POST /api/tenant/employees/:id/reset-password
  async resetPassword(req, res) {
    const { tenantId } = req;
    const { id } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 6) {
      return error(res, '密码至少6位');
    }
    
    const user = await TenantUser.findOne({ _id: id, tenantId });
    if (!user) return error(res, '员工不存在', 404);
    if (user.role === 'owner') return error(res, '不能重置所有者密码');
    
    user.password = hashPassword(password);
    await user.save();
    return ok(res, null, '已重置');
  }

  // POST /api/tenant/employees/:id/login
  async loginAsEmployee(req, res) {
    const employee = await TenantUser.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      role: 'agent',
    });

    if (!employee) return error(res, '员工不存在', 4041, 404);
    if (employee.status !== 'active') return error(res, '员工账号已被禁用', 4032, 403);

    employee.lastLoginAt = new Date();
    await employee.save();

    const tenant = await Tenant.findById(req.tenantId);
    const token = signToken({
      type: 'tenant_user',
      id: employee._id.toString(),
      tenantId: employee.tenantId.toString(),
      username: employee.username,
      displayName: employee.displayName,
      role: employee.role,
    });

    return ok(res, {
      token,
      user: employee.toJSON(),
      tenant: tenant ? tenant.toJSON() : null,
    });
  }
}

module.exports = new AgentController();
