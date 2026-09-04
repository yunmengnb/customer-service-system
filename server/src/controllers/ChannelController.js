// 忆梦云团队开发
const Channel = require('../models/Channel');
const KeywordReply = require('../models/KeywordReply');
const QuickReply = require('../models/QuickReply');
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const { ok, error, generateToken } = require('../utils');

function channelScope(req, id) {
  const where = { _id: id, tenantId: req.tenantId };
  if (req.user.role === 'agent') where.agentIds = req.user.id;
  return where;
}

class ChannelController {
  // GET /api/tenant/channels
  async list(req, res) {
    const where = { tenantId: req.tenantId };
    if (req.user.role === 'agent') where.agentIds = req.user.id;
    const channels = await Channel.find(where).sort({ createdAt: -1 });
    return ok(res, channels.map(c => {
      const obj = c.toJSON();
      // 给链接
      obj.link = `/c/${c.publicToken}`;
      return obj;
    }));
  }
  
  // POST /api/tenant/channels
  async create(req, res) {
    const { tenantId, user } = req;
    const tenant = await Tenant.findById(tenantId);
    
    // 数量限制
    const currentCount = await Channel.countDocuments({ tenantId });
    if (currentCount >= tenant.plan.channelLimit) {
      return error(res, '已达到渠道数量上限');
    }
    
    const { name, brandName, brandColor, welcomeMessage } = req.body;
    const publicToken = generateToken(24);
    
    const channel = await Channel.create({
      tenantId,
      name,
      publicToken,
      brandName: brandName || '在线客服',
      brandColor: brandColor || '#2563eb',
      welcomeMessage: welcomeMessage || '您好，欢迎咨询，请问有什么可以帮助您？',
      agentIds: user.role === 'owner' ? [] : [user.id],
      createdBy: user.id,
    });
    
    return ok(res, channel.toJSON());
  }
  
  // GET /api/tenant/channels/:id
  async detail(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.id));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    const obj = channel.toJSON();
    obj.link = `/c/${channel.publicToken}`;
    const employees = await TenantUser.find({ _id: { $in: channel.agentIds }, tenantId: req.tenantId });
    obj.employees = employees.map(employee => ({
      id: employee._id,
      username: employee.username,
      displayName: employee.displayName,
    }));
    return ok(res, obj);
  }
  
  // PATCH /api/tenant/channels/:id
  async update(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.id));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    
    const allowed = req.user.role === 'agent'
      ? ['brandName', 'brandColor', 'avatarUrl', 'welcomeMessage', 'offlineMessage']
      : ['name', 'brandName', 'brandColor', 'avatarUrl', 'welcomeMessage', 'offlineMessage', 'assignmentMode', 'status'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) channel[k] = req.body[k];
    }
    await channel.save();
    return ok(res, channel.toJSON());
  }
  
  // POST /api/tenant/channels/:id/rotate-token
  async rotateToken(req, res) {
    const channel = await Channel.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!channel) return error(res, '渠道不存在', 404);
    
    channel.publicToken = generateToken(24);
    await channel.save();
    
    const obj = channel.toJSON();
    obj.link = `/c/${channel.publicToken}`;
    return ok(res, obj);
  }
  
  // DELETE /api/tenant/channels/:id
  async delete(req, res) {
    const channel = await Channel.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!channel) return error(res, '渠道不存在', 404);
    
    await Channel.deleteOne({ _id: channel._id });
    // 清理关联数据
    await KeywordReply.deleteMany({ channelId: channel._id });
    await QuickReply.deleteMany({ channelId: channel._id });
    
    return ok(res, null, '已删除');
  }
  
  // PUT /api/tenant/channels/:id/employees
  async setAgents(req, res) {
    const channel = await Channel.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!channel) return error(res, '渠道不存在', 404);
    
    const { employeeIds } = req.body;
    if (!Array.isArray(employeeIds)) return error(res, 'employeeIds 必须是数组');
    
    // 验证员工归属当前租户
    const validAgents = await TenantUser.find({
      _id: { $in: employeeIds },
      tenantId: req.tenantId,
      role: { $in: ['owner', 'admin', 'agent'] },
      status: 'active',
    }).select('_id');
    
    channel.agentIds = validAgents.map(a => a._id);
    await channel.save();
    return ok(res, channel.toJSON());
  }
  
  // ============ 关键词回复 ============
  
  async listKeywordReplies(req, res) {
    const { channelId } = req.params;
    const channel = await Channel.findOne(channelScope(req, channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    
    const items = await KeywordReply.find({ channelId }).sort({ priority: -1, createdAt: -1 });
    return ok(res, items);
  }
  
  async createKeywordReply(req, res) {
    const { channelId } = req.params;
    const channel = await Channel.findOne(channelScope(req, channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    
    const { keyword, matchType, replyContent, priority, status } = req.body;
    const item = await KeywordReply.create({
      keyword,
      matchType,
      replyContent,
      priority,
      status,
      tenantId: req.tenantId,
      channelId,
    });
    return ok(res, item);
  }
  
  async updateKeywordReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    const item = await KeywordReply.findOne({ _id: req.params.krId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (!item) return error(res, '配置不存在', 404);
    
    const { keyword, matchType, replyContent, priority, status } = req.body;
    if (keyword !== undefined) item.keyword = keyword;
    if (matchType !== undefined) item.matchType = matchType;
    if (replyContent !== undefined) item.replyContent = replyContent;
    if (priority !== undefined) item.priority = priority;
    if (status !== undefined) item.status = status;
    await item.save();
    return ok(res, item);
  }
  
  async deleteKeywordReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    const result = await KeywordReply.deleteOne({ _id: req.params.krId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (result.deletedCount === 0) return error(res, '配置不存在', 404);
    return ok(res, null, '已删除');
  }
  
  // ============ 快捷回复 ============
  
  async listQuickReplies(req, res) {
    const { channelId } = req.params;
    const channelWhere = { _id: channelId, tenantId: req.tenantId };
    if (req.user.role === 'agent') channelWhere.agentIds = req.user.id;
    const channel = await Channel.findOne(channelWhere);
    if (!channel) return error(res, '渠道不存在或无权访问', 404);

    // 返回该渠道专属 + 租户通用（channelId=null）
    const items = await QuickReply.find({
      tenantId: req.tenantId,
      $or: [{ channelId }, { channelId: null }],
    }).sort({ sortOrder: 1, createdAt: -1 });
    return ok(res, items);
  }
  
  async createQuickReply(req, res) {
    const { channelId } = req.params;
    const channel = await Channel.findOne(channelScope(req, channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    
    const item = await QuickReply.create({
      tenantId: req.tenantId,
      channelId,
      ...req.body,
    });
    return ok(res, item);
  }
  
  async updateQuickReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    const item = await QuickReply.findOne({ _id: req.params.qrId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (!item) return error(res, '配置不存在', 404);
    
    const { title, content, sortOrder, status } = req.body;
    if (title !== undefined) item.title = title;
    if (content !== undefined) item.content = content;
    if (sortOrder !== undefined) item.sortOrder = sortOrder;
    if (status !== undefined) item.status = status;
    await item.save();
    return ok(res, item);
  }
  
  async deleteQuickReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404);
    const result = await QuickReply.deleteOne({ _id: req.params.qrId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (result.deletedCount === 0) return error(res, '配置不存在', 404);
    return ok(res, null, '已删除');
  }
}

module.exports = new ChannelController();
