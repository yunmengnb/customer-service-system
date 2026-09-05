// 忆梦云团队开发 - 平台客户管理
const CustomerAccount = require('../models/CustomerAccount');
const { ok, error } = require('../utils');

class AdminCustomerController {
  // GET /api/admin/customers
  async list(req, res) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const where = {};

    if (req.query.status) {
      if (!['active', 'disabled'].includes(req.query.status)) {
        return error(res, '状态值无效');
      }
      where.status = req.query.status;
    }

    const keyword = String(req.query.keyword || '').trim();
    if (keyword) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matcher = { $regex: escapedKeyword, $options: 'i' };
      where.$or = [
        { phone: matcher },
        { nickname: matcher },
        { qq: matcher },
        { email: matcher },
      ];
    }

    const [items, total] = await Promise.all([
      CustomerAccount.find(where)
        .select('-password -registerFingerprintHash -registerUserAgent')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CustomerAccount.countDocuments(where),
    ]);

    return ok(res, { items, total, page, limit });
  }
}

module.exports = new AdminCustomerController();
