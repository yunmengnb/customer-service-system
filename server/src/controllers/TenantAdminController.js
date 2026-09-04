// 忆梦云团队开发
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const PlatformAdmin = require('../models/PlatformAdmin');
const { ok, error, hashPassword } = require('../utils');

class TenantAdminController {
  // GET /api/admin/tenants
  async list(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.keyword) {
      const kw = req.query.keyword;
      where.$or = [
        { name: { $regex: kw, $options: 'i' } },
        { username: { $regex: kw, $options: 'i' } },
        { email: { $regex: kw, $options: 'i' } },
      ];
    }
    
    const [items, total] = await Promise.all([
      Tenant.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Tenant.countDocuments(where),
    ]);
    
    return ok(res, { items: items.map(t => t.toJSON()), total, page, limit });
  }
  
  // GET /api/admin/tenants/:id
  async detail(req, res) {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return error(res, '租户不存在', 404);
    
    const agentCount = await TenantUser.countDocuments({ tenantId: tenant._id });
    return ok(res, { ...tenant.toJSON(), agentCount });
  }
  
  // PATCH /api/admin/tenants/:id/status
  async updateStatus(req, res) {
    const { status } = req.body;
    if (!['active', 'disabled', 'trial'].includes(status)) {
      return error(res, '状态值无效');
    }
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!tenant) return error(res, '租户不存在', 404);
    return ok(res, tenant.toJSON());
  }
  
  // PATCH /api/admin/tenants/:id/plan
  async updatePlan(req, res) {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return error(res, '租户不存在', 404);
    
    const newPlan = { ...tenant.plan };
    if (req.body.agentLimit !== undefined) newPlan.agentLimit = Number(req.body.agentLimit);
    if (req.body.channelLimit !== undefined) newPlan.channelLimit = Number(req.body.channelLimit);
    if (req.body.messageRetentionDays !== undefined) newPlan.messageRetentionDays = Number(req.body.messageRetentionDays);
    if (req.body.attachmentLimitMB !== undefined) newPlan.attachmentLimitMB = Number(req.body.attachmentLimitMB);
    
    // 用 updateOne 避免触发完整 schema 校验（email/password/username required）
    await Tenant.updateOne({ _id: tenant._id }, { plan: newPlan });
    
    // 重新获取最新数据返回
    const updated = await Tenant.findById(tenant._id);
    return ok(res, updated.toJSON());
  }
  
  // GET /api/admin/dashboard
  async dashboard(req, res) {
    const [tenantCount, activeTenants, agentCount, customerCount] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: 'active' }),
      TenantUser.countDocuments(),
      require('../models/Customer').countDocuments(),
    ]);
    
    return ok(res, {
      tenantCount,
      activeTenants,
      agentCount,
      customerCount,
    });
  }
}

module.exports = new TenantAdminController();
