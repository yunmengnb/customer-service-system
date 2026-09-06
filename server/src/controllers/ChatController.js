// 忆梦云团队开发
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const KeywordReply = require('../models/KeywordReply');
const Customer = require('../models/Customer');
const TenantUser = require('../models/TenantUser');
const Channel = require('../models/Channel');
const mongoose = require('mongoose');
const config = require('../config');
const cache = require('../utils/cache');
const { getSystemSettings } = require('../utils/systemSettings');
const { ok, error, generateToken } = require('../utils');

// 关联 socket.io（在 app.js 中注入）
let io = null;
function setIO(_io) { io = _io; }

const RECALL_WINDOW_MS = 2 * 60 * 1000;

async function refreshConversationSummary(conv) {
  const messageScope = { tenantId: conv.tenantId, conversationId: conv._id };
  const [agentLastMessage, customerLastMessage, agentUnreadCount, customerUnreadCount] = await Promise.all([
    Message.findOne({ ...messageScope, deletedForAgentAt: null }).sort({ createdAt: -1 }),
    Message.findOne({ ...messageScope, deletedForCustomerAt: null }).sort({ createdAt: -1 }),
    Message.countDocuments({ ...messageScope, deletedForAgentAt: null, senderType: 'customer', readByAgent: false }),
    Message.countDocuments({ ...messageScope, deletedForCustomerAt: null, senderType: { $in: ['agent', 'bot'] }, readByCustomer: false }),
  ]);

  conv.agentUnreadCount = agentUnreadCount;
  conv.customerUnreadCount = customerUnreadCount;
  await conv.save();

  return {
    agent: {
      conversationId: conv._id,
      lastMessage: agentLastMessage ? agentLastMessage.toJSON() : null,
      lastMessageAt: agentLastMessage ? agentLastMessage.createdAt : conv.createdAt,
      agentUnreadCount,
      customerUnreadCount,
    },
    customer: {
      conversationId: conv._id,
      lastMessage: customerLastMessage ? customerLastMessage.toJSON() : null,
      lastMessageAt: customerLastMessage ? customerLastMessage.createdAt : conv.createdAt,
      agentUnreadCount,
      customerUnreadCount,
    },
  };
}

function tenantChannelRoom(conv) {
  return io.to(`tenant-${conv.tenantId}`).to(`channel-staff-${conv.channelId}`);
}

function broadcastMessageChange(conv, event, data, summaries) {
  if (!io) return;
  tenantChannelRoom(conv).emit(event, data);
  io.to(`customer-${conv.customerId}`).emit(event, data);
  tenantChannelRoom(conv).emit('conversation.updated', summaries.agent);
  io.to(`customer-${conv.customerId}`).emit('conversation.updated', summaries.customer);
}

function broadcastSideDelete(conv, side, data, summaries) {
  if (!io) return;
  const room = side === 'agent'
    ? tenantChannelRoom(conv)
    : io.to(`customer-${conv.customerId}`);
  room.emit('message.deleted', data);
  room.emit('conversation.updated', summaries[side]);
}

async function canAccessConversation(req, conv) {
  if (req.user.role !== 'agent') return true;
  return Boolean(await Channel.exists({
    _id: conv.channelId,
    tenantId: req.tenantId,
    agentIds: req.user.id,
  }));
}

class ChatController {
  // ============ 租户端 ============
  
  // GET /api/tenant/conversations
  async listConversations(req, res) {
    const { tenantId, user } = req;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const where = { tenantId };
    
    // 坐席只能看自己有权限的渠道
    if (user.role === 'agent') {
      const channels = await Channel.find({ tenantId, agentIds: user.id }).select('_id');
      const channelIds = channels.map(c => c._id);
      if (channelIds.length === 0) {
        return ok(res, { items: [], total: 0, page, limit });
      }
      where.channelId = { $in: channelIds };
    }
    
    if (req.query.status) where.status = req.query.status;
    if (req.query.channelId) {
      if (user.role === 'agent') {
        const authorized = await Channel.exists({
          _id: req.query.channelId,
          tenantId,
          agentIds: user.id,
        });
        if (!authorized) return ok(res, { items: [], total: 0, page, limit });
      }
      where.channelId = req.query.channelId;
    }

    const keyword = String(req.query.keyword || '').trim().slice(0, 100);
    let searchMessageMap = {};
    if (keyword) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keywordRegex = new RegExp(escapedKeyword, 'i');
      const [matchingCustomers, matchingChannels, matchingMessages] = await Promise.all([
        Customer.find({
          tenantId,
          $or: [
            { phone: keywordRegex },
            { qq: keywordRegex },
            { nickname: keywordRegex },
          ],
        }).distinct('_id'),
        Channel.find({ tenantId, name: keywordRegex }).distinct('_id'),
        Message.aggregate([
          {
            $match: {
              tenantId: new mongoose.Types.ObjectId(tenantId),
              deletedForAgentAt: null,
              recalledAt: null,
              $or: [
                { content: keywordRegex },
                { attachmentName: keywordRegex },
              ],
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$conversationId',
              count: { $sum: 1 },
              message: { $first: '$$ROOT' },
            },
          },
        ]),
      ]);

      searchMessageMap = Object.fromEntries(
        matchingMessages.map(item => [item._id.toString(), {
          count: item.count,
          message: item.message,
        }]),
      );
      where.$or = [
        { customerId: { $in: matchingCustomers } },
        { channelId: { $in: matchingChannels } },
        { _id: { $in: matchingMessages.map(item => item._id) } },
      ];
    }
    
    const sort = req.query.unread === '1' 
      ? { agentUnreadCount: -1, lastMessageAt: -1 }
      : { lastMessageAt: -1 };
    
    const [items, total] = await Promise.all([
      Conversation.find(where).sort(sort).skip(skip).limit(limit),
      Conversation.countDocuments(where),
    ]);
    
    // 附带客户简要信息和最后一条消息
    const customerIds = [...new Set(items.map(c => c.customerId))];
    const customers = customerIds.length
      ? await Customer.find({ _id: { $in: customerIds } }).select('_id phone qq email nickname avatarUrl')
      : [];
    const customerMap = Object.fromEntries(customers.map(c => [c._id.toString(), c]));
    
    const convIds = items.map(c => c._id);
    const lastMsgs = convIds.length
      ? await Message.aggregate([
          { $match: { conversationId: { $in: convIds }, tenantId: items[0].tenantId, deletedForAgentAt: null } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: '$conversationId', msg: { $first: '$$ROOT' } } },
        ])
      : [];
    const lastMsgMap = Object.fromEntries(lastMsgs.map(m => [m._id.toString(), m.msg]));
    
    const result = items.map(c => {
      const obj = c.toJSON();
      const cust = customerMap[c.customerId.toString()];
      obj.customer = cust ? cust.toJSON() : null;
      obj.lastMessage = lastMsgMap[c._id.toString()] || null;
      const searchMatch = searchMessageMap[c._id.toString()];
      obj.searchMatch = searchMatch || null;
      return obj;
    });
    
    return ok(res, { items: result, total, page, limit });
  }
  
  // GET /api/tenant/conversations/:id
  async conversationDetail(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 403);
    
    const customer = await Customer.findById(conv.customerId);
    const channel = await Channel.findById(conv.channelId);
    
    return ok(res, {
      ...conv.toJSON(),
      customer: customer ? customer.toJSON() : null,
      channel: channel ? { id: channel._id, name: channel.name, avatarUrl: channel.avatarUrl || '' } : null,
    });
  }
  
  // POST /api/tenant/conversations/:id/accept
  async acceptConversation(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权接入该会话', 403);
    
    if (conv.status === 'active') {
      return ok(res, conv.toJSON(), '已在处理中');
    }
    
    if (conv.status === 'closed') {
      return error(res, '会话已结束');
    }
    
    // 原子更新：只有 waiting 才能被接
    const updated = await Conversation.findOneAndUpdate(
      { _id: conv._id, tenantId: req.tenantId, status: 'waiting' },
      { status: 'active', assignedAgentId: req.user.id, acceptedAt: new Date(), agentUnreadCount: 0 },
      { new: true }
    );
    
    if (!updated) {
      // 可能被别人先接了
      const current = await Conversation.findById(conv._id);
      if (current && current.status === 'active') {
        const agent = await TenantUser.findById(current.assignedAgentId);
        return error(res, `会话已被 ${agent?.displayName || '其他员工'} 接入`);
      }
      return error(res, '会话状态已变化，请刷新');
    }
    
    // 发送系统消息
    const agent = await TenantUser.findById(req.user.id);
    const systemMsg = await Message.create({
      tenantId: req.tenantId,
      conversationId: conv._id,
      senderType: 'system',
      messageType: 'system',
      content: `${agent?.displayName || '客服'} 已接入`,
    });
    
    // Socket 推送
    if (io) {
      tenantChannelRoom(conv).emit('conversation.accepted', {
        conversationId: conv._id,
        agentId: req.user.id,
        agentName: agent?.displayName,
      });
      io.to(`customer-${conv.customerId}`).emit('message.new', {
        ...systemMsg.toJSON(),
      });
      io.to(`customer-${conv.customerId}`).emit('conversation.updated', {
        conversationId: conv._id,
        status: 'active',
        agent: { id: req.user.id, name: agent?.displayName },
      });
    }
    
    return ok(res, updated.toJSON());
  }
  
  // GET /api/tenant/conversations/:id/messages/search
  async searchConversationMessages(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 403);

    const keyword = String(req.query.keyword || '').trim().slice(0, 100);
    if (!keyword) return ok(res, { items: [], total: 0 });

    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keywordRegex = new RegExp(escapedKeyword, 'i');
    const query = {
      conversationId: conv._id,
      tenantId: req.tenantId,
      deletedForAgentAt: null,
      recalledAt: null,
      $or: [
        { content: keywordRegex },
        { attachmentName: keywordRegex },
      ],
    };
    const [items, total] = await Promise.all([
      Message.find(query).sort({ createdAt: -1 }).limit(200).lean(),
      Message.countDocuments(query),
    ]);
    return ok(res, { items, total });
  }

  // GET /api/tenant/conversations/:id/messages
  async getMessages(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 403);
    
    const beforeId = req.query.before;
    const aroundId = req.query.around;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    if (aroundId) {
      if (!mongoose.isValidObjectId(aroundId)) return error(res, '无效的消息定位参数', 4001, 400);
      const target = await Message.findOne({
        _id: aroundId,
        conversationId: conv._id,
        tenantId: req.tenantId,
        deletedForAgentAt: null,
      });
      if (!target) return error(res, '消息不存在或已被清理', 404);

      const half = Math.floor(limit / 2);
      const [older, newer] = await Promise.all([
        Message.find({
          conversationId: conv._id,
          tenantId: req.tenantId,
          deletedForAgentAt: null,
          _id: { $lt: target._id },
        }).populate({ path: 'senderId', select: 'displayName avatarUrl' }).sort({ _id: -1 }).limit(half),
        Message.find({
          conversationId: conv._id,
          tenantId: req.tenantId,
          deletedForAgentAt: null,
          _id: { $gt: target._id },
        }).populate({ path: 'senderId', select: 'displayName avatarUrl' }).sort({ _id: 1 }).limit(half),
      ]);
      await target.populate({ path: 'senderId', select: 'displayName avatarUrl' });
      const locatedMessages = [...older.reverse(), target, ...newer];
      return ok(res, locatedMessages.map(message => {
        const obj = message.toJSON();
        if (message.senderType === 'agent' && message.senderId) {
          obj.sender = {
            id: message.senderId._id,
            displayName: message.senderId.displayName,
            avatarUrl: message.senderId.avatarUrl || '',
          };
          obj.senderId = message.senderId._id;
        }
        return obj;
      }));
    }
    
    let query = { conversationId: conv._id, tenantId: req.tenantId, deletedForAgentAt: null };
    if (beforeId) {
      if (!mongoose.isValidObjectId(beforeId)) return error(res, '无效的分页参数', 4001, 400);
      query._id = { $lt: new mongoose.Types.ObjectId(beforeId) };
    }
    
    const messages = await Message.find(query)
      .populate({ path: 'senderId', select: 'displayName avatarUrl' })
      .sort({ createdAt: -1 })
      .limit(limit);
    
    // 标记已读
    await Message.updateMany(
      { conversationId: conv._id, tenantId: req.tenantId, readByAgent: false },
      { $set: { readByAgent: true } }
    );
    conv.agentUnreadCount = 0;
    await conv.save();
    
    return ok(res, messages.reverse().map(message => {
      const obj = message.toJSON();
      if (message.senderType === 'agent' && message.senderId) {
        obj.sender = {
          id: message.senderId._id,
          displayName: message.senderId.displayName,
          avatarUrl: message.senderId.avatarUrl || '',
        };
        obj.senderId = message.senderId._id;
      }
      return obj;
    }));
  }
  
  // POST /api/tenant/conversations/:id/messages
  async agentSendMessage(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 403);
    
    // 必须已接入
    if (conv.status !== 'active') {
      return error(res, '请先接入会话');
    }
    
    const agent = await TenantUser.findById(req.user.id);
    
    const { content, clientMessageId, messageType, attachmentUrl, attachmentName, thumbnailUrl } = req.body;
    const effectiveType = ['image', 'video', 'file'].includes(messageType) ? messageType : 'text';
    
    // text 类型必须有 content；附件类型 content 可选（显示用附件链接代替）
    if (effectiveType === 'text' && (!content || !content.trim())) {
      return error(res, '消息内容不能为空');
    }
    if (['image', 'video', 'file'].includes(effectiveType) && !attachmentUrl) {
      return error(res, '附件 URL 不能为空');
    }

    const normalizedContent = String(content || '').trim().toLowerCase();
    if (normalizedContent) {
      const settings = await getSystemSettings();
      if (settings.forbiddenWords.some(word => normalizedContent.includes(word.toLowerCase()))) {
        return error(res, '识别到违禁词，禁止发送');
      }
    }
    
    const msg = await Message.create({
      tenantId: req.tenantId,
      conversationId: conv._id,
      senderType: 'agent',
      senderId: agent._id,
      senderTypeModel: 'TenantUser',
      messageType: effectiveType,
      content: (content || '').trim(),
      attachmentUrl: attachmentUrl || '',
      attachmentName: attachmentName || '',
      thumbnailUrl: effectiveType === 'video' ? (thumbnailUrl || '') : '',
      clientMessageId: clientMessageId || undefined,
    });
    
    // 更新会话
    conv.lastMessageAt = new Date();
    conv.customerUnreadCount += 1;
    await conv.save();

    const messageData = {
      ...msg.toJSON(),
      sender: {
        id: agent._id,
        displayName: agent.displayName,
        avatarUrl: agent.avatarUrl || '',
      },
    };
    
    // Socket 推送
    if (io) {
      io.to(`customer-${conv.customerId}`).emit('message.new', messageData);
      io.to(`customer-${conv.customerId}`).emit('conversation.updated', {
        conversationId: conv._id,
        lastMessage: messageData,
        lastMessageAt: conv.lastMessageAt,
      });
      // 也推给租户管理员和渠道授权员工
      tenantChannelRoom(conv).emit('conversation.updated', {
        conversationId: conv._id,
        lastMessage: messageData,
        lastMessageAt: conv.lastMessageAt,
        agentUnreadCount: conv.agentUnreadCount,
        customerUnreadCount: conv.customerUnreadCount,
      });
    }
    
    return ok(res, messageData);
  }

  // PATCH /api/tenant/conversations/:id/customer-settings
  async updateCustomerSettings(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 4041, 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 4031, 403);

    const customer = await Customer.findOne({ _id: conv.customerId, tenantId: req.tenantId });
    if (!customer) return error(res, '客户不存在', 4042, 404);

    if (typeof req.body.messageReceivingDisabled === 'boolean') {
      customer.messageReceivingDisabled = req.body.messageReceivingDisabled;
    }
    if (typeof req.body.blocked === 'boolean') customer.blocked = req.body.blocked;
    await customer.save();

    return ok(res, {
      messageReceivingDisabled: customer.messageReceivingDisabled,
      blocked: customer.blocked,
    });
  }

  // DELETE /api/tenant/conversations/:id/messages
  async clearAgentMessages(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 4041, 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 4031, 403);

    await Message.updateMany(
      { conversationId: conv._id, tenantId: req.tenantId, deletedForAgentAt: null },
      { $set: { deletedForAgentAt: new Date() } }
    );
    const summaries = await refreshConversationSummary(conv);
    broadcastSideDelete(conv, 'agent', { conversationId: conv._id, clearAll: true, side: 'agent' }, summaries);
    return ok(res, { conversationId: conv._id });
  }

  // POST /api/tenant/conversations/:id/messages/:messageId/recall
  async recallMessage(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 4041, 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 4031, 403);

    const message = await Message.findOne({
      _id: req.params.messageId,
      conversationId: conv._id,
      tenantId: req.tenantId,
    });
    if (!message) return error(res, '消息不存在', 4042, 404);
    if (message.senderType === 'system' || message.senderType === 'bot') {
      return error(res, '系统或机器人消息不可操作', 4031, 403);
    }
    if (message.senderType !== 'agent' || String(message.senderId) !== String(req.user.id)) {
      return error(res, '只能撤回本人发送的消息', 4031, 403);
    }
    if (message.recalledAt) return ok(res, message.toJSON(), '消息已撤回');
    if (Date.now() - message.createdAt.getTime() > RECALL_WINDOW_MS) {
      return error(res, '消息发送超过2分钟，无法撤回', 4001, 400);
    }

    message.recalledAt = new Date();
    message.content = '';
    message.attachmentUrl = '';
    message.attachmentName = '';
    message.thumbnailUrl = '';
    await message.save();

    const messageData = { ...message.toJSON(), messageId: message._id };
    const summary = await refreshConversationSummary(conv);
    broadcastMessageChange(conv, 'message.recalled', messageData, summary);
    return ok(res, messageData);
  }

  // DELETE /api/tenant/conversations/:id/messages/:messageId
  async deleteMessage(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 4041, 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 4031, 403);

    const message = await Message.findOne({
      _id: req.params.messageId,
      conversationId: conv._id,
      tenantId: req.tenantId,
    });
    if (!message) return error(res, '消息不存在', 4042, 404);
    if (message.senderType === 'system' || message.senderType === 'bot') {
      return error(res, '系统或机器人消息不可操作', 4031, 403);
    }
    if (message.deletedForAgentAt) {
      return ok(res, { messageId: message._id, conversationId: conv._id }, '消息已删除');
    }

    message.deletedForAgentAt = new Date();
    await message.save();
    const data = { messageId: message._id, conversationId: conv._id, side: 'agent' };
    const summaries = await refreshConversationSummary(conv);
    broadcastSideDelete(conv, 'agent', data, summaries);
    return ok(res, data);
  }
  
  // POST /api/tenant/conversations/:id/close
  async closeConversation(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 403);
    if (conv.status === 'closed') return ok(res, conv.toJSON(), '已关闭');
    
    conv.status = 'closed';
    conv.closedAt = new Date();
    await conv.save();
    
    // 系统消息
    const closedMessage = await Message.create({
      tenantId: req.tenantId,
      conversationId: conv._id,
      senderType: 'system',
      messageType: 'system',
      content: '会话已结束',
    });
    conv.lastMessageAt = closedMessage.createdAt;
    await conv.save();

    if (io) {
      const closedData = {
        conversationId: conv._id,
        status: 'closed',
        lastMessage: closedMessage.toJSON(),
        lastMessageAt: conv.lastMessageAt,
      };
      io.to(`customer-${conv.customerId}`).emit('message.new', closedMessage.toJSON());
      io.to(`customer-${conv.customerId}`).emit('conversation.closed', closedData);
      io.to(`customer-${conv.customerId}`).emit('conversation.updated', closedData);
      tenantChannelRoom(conv).emit('message.new', closedMessage.toJSON());
      tenantChannelRoom(conv).emit('conversation.updated', closedData);
    }
    
    return ok(res, conv.toJSON());
  }
  
  // ============ 客户端 ============
  
  // GET /api/client/conversation
  async getClientConversation(req, res) {
    const { customer } = req;
    
    let conv = await Conversation.findOne({
      tenantId: customer.tenantId,
      channelId: customer.channelId,
      customerId: customer.id,
      status: { $in: ['waiting', 'active'] },
    }).sort({ lastMessageAt: -1 });
    
    if (!conv) return ok(res, null);

    const data = conv.toJSON();
    if (conv.assignedAgentId) {
      const agent = await TenantUser.findById(conv.assignedAgentId).select('_id displayName');
      data.agent = agent ? { id: agent._id, name: agent.displayName } : null;
    }

    return ok(res, data);
  }
  
  // GET /api/client/conversation/messages
  async getClientMessages(req, res) {
    const { customer } = req;
    
    let conv = await Conversation.findOne({
      tenantId: customer.tenantId,
      channelId: customer.channelId,
      customerId: customer.id,
    }).sort({ lastMessageAt: -1 });
    
    if (!conv) return ok(res, []);
    
    const beforeId = req.query.before;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 50);
    const query = {
      conversationId: conv._id,
      tenantId: customer.tenantId,
      deletedForCustomerAt: null,
    };
    if (beforeId) {
      if (!mongoose.isValidObjectId(beforeId)) return error(res, '无效的分页参数', 4001, 400);
      query._id = { $lt: new mongoose.Types.ObjectId(beforeId) };
    }
    const messages = await Message.find(query)
      .populate({ path: 'senderId', select: 'displayName avatarUrl' })
      .sort({ createdAt: -1 })
      .limit(limit);
    
    // 仅有未读消息时写入数据库，避免每次进入都执行无效更新。
    if (conv.customerUnreadCount > 0) {
      await Message.updateMany(
        { conversationId: conv._id, tenantId: customer.tenantId, readByCustomer: false },
        { $set: { readByCustomer: true } }
      );
      conv.customerUnreadCount = 0;
      await conv.save();
    }
    
    return ok(res, messages.reverse().map(message => {
      const obj = message.toJSON();
      if (message.senderType === 'agent' && message.senderId) {
        obj.sender = {
          id: message.senderId._id,
          displayName: message.senderId.displayName,
          avatarUrl: message.senderId.avatarUrl || '',
        };
        obj.senderId = message.senderId._id;
      }
      return obj;
    }));
  }

  // POST /api/client/conversation/messages/:messageId/recall
  async customerRecallMessage(req, res) {
    const { customer } = req;
    const conv = await Conversation.findOne({
      tenantId: customer.tenantId,
      channelId: customer.channelId,
      customerId: customer.id,
    }).sort({ lastMessageAt: -1 });
    if (!conv) return error(res, '会话不存在', 4041, 404);

    const message = await Message.findOne({
      _id: req.params.messageId,
      conversationId: conv._id,
      tenantId: customer.tenantId,
    });
    if (!message) return error(res, '消息不存在', 4042, 404);
    if (message.senderType === 'system' || message.senderType === 'bot') {
      return error(res, '系统或机器人消息不可操作', 4031, 403);
    }
    if (message.senderType !== 'customer' || String(message.senderId) !== String(customer.id)) {
      return error(res, '只能撤回本人发送的消息', 4031, 403);
    }
    if (message.recalledAt) return ok(res, message.toJSON(), '消息已撤回');
    if (Date.now() - message.createdAt.getTime() > RECALL_WINDOW_MS) {
      return error(res, '消息发送超过2分钟，无法撤回', 4001, 400);
    }

    message.recalledAt = new Date();
    message.content = '';
    message.attachmentUrl = '';
    message.attachmentName = '';
    message.thumbnailUrl = '';
    await message.save();

    const messageData = { ...message.toJSON(), messageId: message._id };
    const summary = await refreshConversationSummary(conv);
    broadcastMessageChange(conv, 'message.recalled', messageData, summary);
    return ok(res, messageData);
  }

  // DELETE /api/client/conversation/messages/:messageId
  async customerDeleteMessage(req, res) {
    const { customer } = req;
    const conv = await Conversation.findOne({
      tenantId: customer.tenantId,
      channelId: customer.channelId,
      customerId: customer.id,
    }).sort({ lastMessageAt: -1 });
    if (!conv) return error(res, '会话不存在', 4041, 404);

    const message = await Message.findOne({
      _id: req.params.messageId,
      conversationId: conv._id,
      tenantId: customer.tenantId,
    });
    if (!message) return error(res, '消息不存在', 4042, 404);
    if (message.senderType === 'system') {
      return error(res, '系统消息不可删除', 4031, 403);
    }
    if (message.deletedForCustomerAt) {
      return ok(res, { messageId: message._id, conversationId: conv._id }, '消息已删除');
    }

    message.deletedForCustomerAt = new Date();
    await message.save();
    const data = { messageId: message._id, conversationId: conv._id, side: 'customer' };
    const summaries = await refreshConversationSummary(conv);
    broadcastSideDelete(conv, 'customer', data, summaries);
    return ok(res, data);
  }
  
  // POST /api/client/conversation/messages
  async customerSendMessage(req, res) {
    const { customer } = req;
    const { content, clientMessageId, messageType, attachmentUrl, attachmentName, thumbnailUrl } = req.body;
    
    const currentCustomer = await Customer.findOne({
      _id: customer.id,
      tenantId: customer.tenantId,
      channelId: customer.channelId,
    }).select('messageReceivingDisabled blocked');
    if (!currentCustomer) return error(res, '客户不存在', 4042, 404);
    if (currentCustomer.blocked) return error(res, '消息发送失败', 4034, 403);
    if (currentCustomer.messageReceivingDisabled) {
      return error(res, '客服当前不接收您的消息', 4035, 403);
    }

    const effectiveType = ['image', 'video', 'file'].includes(messageType) ? messageType : 'text';
    if (effectiveType === 'text' && (!content || !content.trim())) {
      return error(res, '消息内容不能为空');
    }
    if (['image', 'video', 'file'].includes(effectiveType) && !attachmentUrl) {
      return error(res, '附件 URL 不能为空');
    }
    
    let conv = await Conversation.findOne({
      tenantId: customer.tenantId,
      channelId: customer.channelId,
      customerId: customer.id,
      status: { $in: ['waiting', 'active', 'closed'] },
    }).sort({ lastMessageAt: -1 });
    
    // 无会话时创建新会话
    if (!conv) {
      conv = await Conversation.create({
        tenantId: customer.tenantId,
        channelId: customer.channelId,
        customerId: customer.id,
        status: 'waiting',
      });
    } else if (conv.status === 'closed') {
      // 重新打开
      conv.status = 'waiting';
      conv.assignedAgentId = null;
      conv.acceptedAt = null;
      conv.closedAt = null;
    }
    
    // 记录消息
    const msg = await Message.create({
      tenantId: customer.tenantId,
      conversationId: conv._id,
      senderType: 'customer',
      senderId: customer.id,
      senderTypeModel: 'Customer',
      messageType: effectiveType,
      content: (content || '').trim(),
      attachmentUrl: attachmentUrl || '',
      attachmentName: attachmentName || '',
      thumbnailUrl: effectiveType === 'video' ? (thumbnailUrl || '') : '',
      clientMessageId: clientMessageId || undefined,
    });
    
    conv.lastMessageAt = new Date();
    conv.agentUnreadCount += 1;
    await conv.save();
    
    // 关键词自动回复：仅匹配文本，同优先级时精确匹配优先
    let replyMsg = null;
    if (effectiveType === 'text') {
      const key = `replies:keyword:runtime:${customer.tenantId}:${customer.channelId}`;
      let keywordReplies = await cache.getJson(key);
      if (!keywordReplies) {
        keywordReplies = await KeywordReply.find({
          tenantId: customer.tenantId,
          channelId: customer.channelId,
          status: 'active',
        }).sort({ priority: -1, createdAt: 1 }).lean();
        await cache.setJson(key, keywordReplies, config.redis.cacheTtlSeconds);
      }
      keywordReplies.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if (a.matchType === b.matchType) return 0;
        return a.matchType === 'exact' ? -1 : 1;
      });

      const lowerContent = String(content || '').trim().toLowerCase();
      for (const kr of keywordReplies) {
        const keyword = kr.keyword.trim().toLowerCase();
        const matched = kr.matchType === 'exact'
          ? lowerContent === keyword
          : lowerContent.includes(keyword);
        if (matched) {
          const imageUrl = String(kr.imageUrl || '').trim();
          replyMsg = await Message.create({
            tenantId: customer.tenantId,
            conversationId: conv._id,
            senderType: 'bot',
            messageType: imageUrl ? 'image' : 'text',
            autoReplyType: 'keyword',
            content: String(kr.replyContent || '').trim(),
            attachmentUrl: imageUrl,
            attachmentName: kr.imageName || '',
          });
          conv.lastMessageAt = replyMsg.createdAt;
          conv.customerUnreadCount += 1;
          await conv.save();
          break;
        }
      }
    }
    
    // Socket 推送
    if (io) {
      tenantChannelRoom(conv).emit('conversation.created', {
        conversationId: conv._id,
        status: conv.status,
        channelId: conv.channelId,
        customerId: customer.id,
      });
      tenantChannelRoom(conv).emit('message.new', {
        ...msg.toJSON(),
      });
      tenantChannelRoom(conv).emit('conversation.updated', {
        conversationId: conv._id,
        status: conv.status,
        assignedAgentId: conv.assignedAgentId,
        lastMessage: msg.toJSON(),
        lastMessageAt: conv.lastMessageAt,
        agentUnreadCount: conv.agentUnreadCount,
      });
      io.to(`customer-${customer.id}`).emit('conversation.updated', {
        conversationId: conv._id,
        status: conv.status,
      });
      
      // 给客户自己也推（包括机器人回复）
      io.to(`customer-${customer.id}`).emit('message.new', msg.toJSON());
      if (replyMsg) {
        const replyData = replyMsg.toJSON();
        io.to(`customer-${customer.id}`).emit('message.new', replyData);
        tenantChannelRoom(conv).emit('message.new', replyData);
        tenantChannelRoom(conv).emit('conversation.updated', {
          conversationId: conv._id,
          lastMessage: replyData,
          lastMessageAt: conv.lastMessageAt,
          agentUnreadCount: conv.agentUnreadCount,
          customerUnreadCount: conv.customerUnreadCount,
        });
      }
    }
    
    return ok(res, {
      message: msg.toJSON(),
      botReply: replyMsg ? replyMsg.toJSON() : null,
    });
  }
}

module.exports = new ChatController();
module.exports.setIO = setIO;
