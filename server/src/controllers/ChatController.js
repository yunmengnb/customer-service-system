// 忆梦云团队开发
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const KeywordReply = require('../models/KeywordReply');
const Customer = require('../models/Customer');
const CustomerAccount = require('../models/CustomerAccount');
const TenantUser = require('../models/TenantUser');
const Channel = require('../models/Channel');
const mongoose = require('mongoose');
const config = require('../config');
const cache = require('../utils/cache');
const { getSystemSettings } = require('../utils/systemSettings');
const { ok, error, generateToken, customerAvatarUrl } = require('../utils');
const {
  validatePendingAttachment,
  createMessageWithAttachment,
  discardUnpublishedMessage,
  recallAttachment,
} = require('../services/conversationAttachmentService');

// 关联 socket.io（在 app.js 中注入）
let io = null;
function setIO(_io) { io = _io; }

const RECALL_WINDOW_MS = 2 * 60 * 1000;

function customerJson(binding, account = null) {
  const data = binding.toJSON ? binding.toJSON() : { ...binding };
  // 会话详情无需向客服暴露客户 IP、设备信息与指纹等隐私字段
  delete data.password;
  delete data.registerFingerprintHash;
  delete data.registerIp;
  delete data.registerUserAgent;
  delete data.lastLoginIp;
  delete data.lastLoginAt;
  if (!data.accountId || data.identityType === 'guest' || !account) {
    data.avatarUrl = '';
    return data;
  }
  data.qq = account.qq || '';
  data.nickname = account.nickname || data.nickname;
  data.avatarUrl = customerAvatarUrl(account);
  return data;
}

async function customerAccounts(customers) {
  const accountIds = [...new Set(customers.filter(customer => customer.accountId).map(customer => String(customer.accountId)))];
  if (!accountIds.length) return {};
  const accounts = await CustomerAccount.find({ _id: { $in: accountIds } }).select('_id qq nickname avatarUrl').lean();
  return Object.fromEntries(accounts.map(account => [String(account._id), account]));
}

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

function tenantConversationRoom(conv) {
  let room = io.to(`tenant-${conv.tenantId}`);
  if (conv.status === 'waiting') {
    room = room.to(`channel-staff-${conv.channelId}`);
  } else if (conv.assignedAgentId) {
    room = room.to(`agent-${conv.assignedAgentId}`);
  }
  return room;
}

async function broadcastCustomerChannelSummary(conv, summary) {
  if (!io) return;
  const [customer, channel] = await Promise.all([
    Customer.findOne({ _id: conv.customerId, tenantId: conv.tenantId, channelId: conv.channelId })
      .select('accountId')
      .lean(),
    Channel.findOne({ _id: conv.channelId, tenantId: conv.tenantId })
      .select('publicToken name brandName brandColor avatarUrl status')
      .lean(),
  ]);
  if (!customer?.accountId || !channel) return;
  const update = {
    _id: channel._id,
    bindingId: conv.customerId,
    publicToken: channel.publicToken,
    name: channel.name,
    brandName: channel.brandName,
    brandColor: channel.brandColor,
    avatarUrl: channel.avatarUrl,
    status: channel.status,
    conversationId: conv._id,
    lastMessage: summary.lastMessage || null,
    lastMessageAt: summary.lastMessageAt || conv.createdAt,
    unreadCount: summary.customerUnreadCount || 0,
  };
  const accountRoom = io.to(`customer-account-${customer.accountId}`);
  accountRoom.emit('channel-history.updated', update);
  if (update.lastMessage && ['agent', 'bot'].includes(update.lastMessage.senderType)) {
    accountRoom.emit('message.new', {
      ...update.lastMessage,
      publicToken: channel.publicToken,
      channelToken: channel.publicToken,
    });
  }
}

function broadcastMessageChange(conv, event, data, summaries) {
  if (!io) return;
  tenantConversationRoom(conv).emit(event, data);
  io.to(`customer-${conv.customerId}`).emit(event, data);
  tenantConversationRoom(conv).emit('conversation.updated', summaries.agent);
  io.to(`customer-${conv.customerId}`).emit('conversation.updated', summaries.customer);
  broadcastCustomerChannelSummary(conv, summaries.customer).catch(() => {});
}

function broadcastSideDelete(conv, side, data, summaries) {
  if (!io) return;
  const room = side === 'agent'
    ? tenantConversationRoom(conv)
    : io.to(`customer-${conv.customerId}`);
  room.emit('message.deleted', data);
  room.emit('conversation.updated', summaries[side]);
  if (side === 'customer') {
    broadcastCustomerChannelSummary(conv, summaries.customer).catch(() => {});
  }
}

async function canAccessConversation(req, conv) {
  if (req.user.role !== 'agent') return true;
  const channelAuthorized = await Channel.exists({
    _id: conv.channelId,
    tenantId: req.tenantId,
    agentIds: req.user.id,
  });
  if (!channelAuthorized) return false;
  return conv.status === 'waiting' || String(conv.assignedAgentId) === String(req.user.id);
}

async function canModifyConversation(req, conv) {
  if (req.user.role !== 'agent') return true;
  if (String(conv.assignedAgentId) !== String(req.user.id)) return false;
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
      where.$and = [{
        $or: [
          { status: 'waiting' },
          { status: { $in: ['active', 'closed'] }, assignedAgentId: user.id },
        ],
      }];
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
          message: Message.applyAttachmentUrls(item.message),
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
      ? await Customer.find({ _id: { $in: customerIds }, tenantId }).select('_id accountId identityType phone qq email nickname avatarUrl')
      : [];
    const accountMap = await customerAccounts(customers);
    const customerMap = Object.fromEntries(customers.map(c => [c._id.toString(), customerJson(c, accountMap[String(c.accountId)] || null)]));
    
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
      obj.customer = cust || null;
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
    
    const customer = await Customer.findOne({
      _id: conv.customerId,
      tenantId: req.tenantId,
      channelId: conv.channelId,
    });
    const channel = await Channel.findOne({ _id: conv.channelId, tenantId: req.tenantId });
    const account = customer?.accountId
      ? await CustomerAccount.findById(customer.accountId).select('_id qq nickname avatarUrl').lean()
      : null;
    
    return ok(res, {
      ...conv.toJSON(),
      customer: customer ? customerJson(customer, account) : null,
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
    
    const waitingAudience = io ? tenantConversationRoom(conv) : null;

    // 原子更新：只有 waiting 才能被接
    const updated = await Conversation.findOneAndUpdate(
      { _id: conv._id, tenantId: req.tenantId, status: 'waiting' },
      { status: 'active', assignedAgentId: req.user.id, acceptedAt: new Date(), agentUnreadCount: 0 },
      { new: true }
    );
    
    if (!updated) {
      // 可能被别人先接了
      const current = await Conversation.findOne({ _id: conv._id, tenantId: req.tenantId });
      if (current && current.status === 'active') {
        const agent = await TenantUser.findOne({ _id: current.assignedAgentId, tenantId: req.tenantId });
        return error(res, `会话已被 ${agent?.displayName || '其他员工'} 接入`);
      }
      return error(res, '会话状态已变化，请刷新');
    }
    
    // 发送系统消息
    const agent = await TenantUser.findOne({ _id: req.user.id, tenantId: req.tenantId });
    const systemMsg = await Message.create({
      tenantId: req.tenantId,
      conversationId: conv._id,
      senderType: 'system',
      messageType: 'system',
      content: `${agent?.displayName || '客服'} 已接入`,
    });
    updated.lastMessageAt = systemMsg.createdAt;
    await updated.save();
    await broadcastCustomerChannelSummary(updated, {
      lastMessage: systemMsg.toJSON(),
      lastMessageAt: updated.lastMessageAt,
      customerUnreadCount: updated.customerUnreadCount,
    });
    
    // Socket 推送
    if (io) {
      const acceptedData = {
        conversationId: updated._id,
        status: 'active',
        agentId: req.user.id,
        agentName: agent?.displayName,
        assignedAgentId: req.user.id,
        lastMessage: systemMsg.toJSON(),
        lastMessageAt: updated.lastMessageAt,
      };
      waitingAudience.emit('conversation.accepted', acceptedData);
      waitingAudience.emit('conversation.updated', acceptedData);
      tenantConversationRoom(updated).emit('message.new', systemMsg.toJSON());
      io.to(`customer-${updated.customerId}`).emit('message.new', systemMsg.toJSON());
      io.to(`customer-${updated.customerId}`).emit('conversation.updated', {
        conversationId: updated._id,
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
    return ok(res, { items: items.map(Message.applyAttachmentUrls), total });
  }

  // GET /api/tenant/conversations/:id/messages
  async getMessages(req, res) {
    const conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 403);
    
    const beforeId = req.query.before;
    const afterId = req.query.after;
    const aroundId = req.query.around;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    if (afterId) {
      if (!mongoose.isValidObjectId(afterId)) return error(res, '无效的分页参数', 4001, 400);
      const cursor = await Message.findOne({ _id: afterId, conversationId: conv._id, tenantId: req.tenantId });
      if (!cursor) return error(res, '消息游标不属于当前会话', 4001, 400);
      const messages = await Message.find({
        conversationId: conv._id,
        tenantId: req.tenantId,
        deletedForAgentAt: null,
        $or: [
          { createdAt: { $gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $gt: cursor._id } },
        ],
      }).populate({ path: 'senderId', select: 'displayName avatarUrl' }).sort({ createdAt: 1, _id: 1 }).limit(limit);
      return ok(res, messages.map(message => {
        const obj = message.toJSON();
        if (message.senderType === 'agent' && message.senderId) {
          obj.sender = { id: message.senderId._id, displayName: message.senderId.displayName, avatarUrl: message.senderId.avatarUrl || '' };
          obj.senderId = message.senderId._id;
        }
        return obj;
      }));
    }

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
    
    // waiting 会话可供授权坐席预览，但仅管理员或实际接待坐席可改变已读状态。
    await markAgentConversationRead(req, conv);
    
    const orderedMessages = afterId ? messages : messages.reverse();
    return ok(res, orderedMessages.map(message => {
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
    let conv = await Conversation.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!conv) return error(res, '会话不存在', 404);
    if (!await canAccessConversation(req, conv)) return error(res, '无权访问', 403);
    
    // 必须已接入
    if (conv.status !== 'active') {
      return error(res, '请先接入会话');
    }
    
    const agent = await TenantUser.findById(req.user.id);
    
    const { content, messageType, attachmentId, attachmentUrl, attachmentName, thumbnailUrl } = req.body;
    const clientMessageId = String(req.body.clientMessageId || '').trim();
    const effectiveType = ['image', 'video', 'file'].includes(messageType) ? messageType : 'text';

    if (!clientMessageId || clientMessageId.length > 128) {
      return error(res, 'clientMessageId 必须为1到128个字符');
    }
    if (effectiveType === 'text' && (!content || !content.trim())) {
      return error(res, '消息内容不能为空');
    }
    if (['image', 'video', 'file'].includes(effectiveType) && !attachmentId) {
      return error(res, '附件 ID 不能为空');
    }
    if (clientMessageId) {
      const duplicate = await Message.findOne({
        tenantId: req.tenantId,
        conversationId: conv._id,
        clientMessageId,
        senderType: 'agent',
        senderId: req.user.id,
      });
      if (duplicate) return ok(res, duplicate.toJSON(), '消息已发送');
    }
    let attachment = null;
    if (attachmentId) {
      try {
        attachment = await validatePendingAttachment({
          attachmentId, tenantId: req.tenantId, channelId: conv.channelId, conversationId: conv._id,
          uploaderType: 'agent', uploaderId: req.user.id, messageType: effectiveType,
        });
      } catch (err) {
        return error(res, err.message);
      }
    }

    const normalizedContent = String(content || '').trim().toLowerCase();
    if (normalizedContent) {
      const settings = await getSystemSettings();
      if (settings.forbiddenWords.some(word => normalizedContent.includes(word.toLowerCase()))) {
        return error(res, '识别到违禁词，禁止发送');
      }
    }
    
    const messageAt = new Date();
    let msg;
    try {
      msg = await createMessageWithAttachment({
        tenantId: req.tenantId,
        conversationId: conv._id,
        senderType: 'agent',
        senderId: agent._id,
        senderTypeModel: 'TenantUser',
        messageType: effectiveType,
        content: attachment ? '' : (content || '').trim(),
        attachmentUrl: attachment ? '' : (attachmentUrl || ''),
        attachmentName: attachment ? attachment.originalName : (attachmentName || ''),
        thumbnailUrl: attachment ? '' : (effectiveType === 'video' ? (thumbnailUrl || '') : ''),
        clientMessageId: clientMessageId || undefined,
        createdAt: messageAt,
      }, attachment);
    } catch (err) {
      if (err?.code === 11000 && clientMessageId) {
        const duplicate = await Message.findOne({
          tenantId: req.tenantId,
          conversationId: conv._id,
          clientMessageId,
          senderType: 'agent',
          senderId: req.user.id,
        });
        if (duplicate) return ok(res, duplicate.toJSON(), '消息已发送');
      }
      throw err;
    }

    conv = await Conversation.findOneAndUpdate(
      {
        _id: conv._id,
        tenantId: req.tenantId,
        status: 'active',
        assignedAgentId: conv.assignedAgentId,
      },
      { $set: { lastMessageAt: msg.createdAt }, $inc: { customerUnreadCount: 1 } },
      { new: true }
    );
    if (!conv) {
      await discardUnpublishedMessage(msg, attachment);
      return error(res, '会话状态已变化，请刷新');
    }

    const messageData = {
      ...msg.toJSON(),
      sender: {
        id: agent._id,
        displayName: agent.displayName,
        avatarUrl: agent.avatarUrl || '',
      },
    };
    await broadcastCustomerChannelSummary(conv, {
      lastMessage: messageData,
      lastMessageAt: conv.lastMessageAt,
      customerUnreadCount: conv.customerUnreadCount,
    });
    
    // Socket 推送
    if (io) {
      io.to(`customer-${conv.customerId}`).emit('message.new', messageData);
      io.to(`customer-${conv.customerId}`).emit('conversation.updated', {
        conversationId: conv._id,
        lastMessage: messageData,
        lastMessageAt: conv.lastMessageAt,
      });
      // active 会话只推给租户管理员和接待坐席
      tenantConversationRoom(conv).emit('conversation.updated', {
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
    if (!await canModifyConversation(req, conv)) return error(res, '无权操作', 4031, 403);

    const customer = await Customer.findOne({
      _id: conv.customerId,
      tenantId: req.tenantId,
      channelId: conv.channelId,
    });
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
    if (!await canModifyConversation(req, conv)) return error(res, '无权操作', 4031, 403);

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
    if (!await canModifyConversation(req, conv)) return error(res, '无权操作', 4031, 403);

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
    await recallAttachment(message, message.recalledAt);
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
    if (!await canModifyConversation(req, conv)) return error(res, '无权操作', 4031, 403);

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
    if (!await canModifyConversation(req, conv)) return error(res, '无权操作', 403);
    if (conv.status === 'closed') return ok(res, conv.toJSON(), '已关闭');

    const previousAudience = io ? tenantConversationRoom(conv) : null;
    const closeWhere = {
      _id: conv._id,
      tenantId: req.tenantId,
      status: conv.status,
      assignedAgentId: conv.assignedAgentId,
      lastMessageAt: conv.lastMessageAt,
    };
    const closedAt = new Date();
    const closed = await Conversation.findOneAndUpdate(
      closeWhere,
      { $set: { status: 'closed', closedAt } },
      { new: true }
    );
    if (!closed) return error(res, '会话状态已变化，请刷新');

    // 系统消息
    const closedMessage = await Message.create({
      tenantId: req.tenantId,
      conversationId: closed._id,
      senderType: 'system',
      messageType: 'system',
      content: '会话已结束',
    });
    closed.lastMessageAt = closedMessage.createdAt;
    await closed.save();
    await broadcastCustomerChannelSummary(closed, {
      lastMessage: closedMessage.toJSON(),
      lastMessageAt: closed.lastMessageAt,
      customerUnreadCount: closed.customerUnreadCount,
    });

    if (io) {
      const closedData = {
        conversationId: closed._id,
        status: 'closed',
        lastMessage: closedMessage.toJSON(),
        lastMessageAt: closed.lastMessageAt,
      };
      io.to(`customer-${closed.customerId}`).emit('message.new', closedMessage.toJSON());
      io.to(`customer-${closed.customerId}`).emit('conversation.closed', closedData);
      io.to(`customer-${closed.customerId}`).emit('conversation.updated', closedData);
      previousAudience.emit('message.new', closedMessage.toJSON());
      previousAudience.emit('conversation.closed', closedData);
      previousAudience.emit('conversation.updated', closedData);
    }
    
    return ok(res, closed.toJSON());
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
    const afterId = req.query.after;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 50);
    const query = {
      conversationId: conv._id,
      tenantId: customer.tenantId,
      deletedForCustomerAt: null,
    };
    if (afterId) {
      if (!mongoose.isValidObjectId(afterId)) return error(res, '无效的分页参数', 4001, 400);
      const cursor = await Message.findOne({ _id: afterId, conversationId: conv._id, tenantId: customer.tenantId });
      if (!cursor) return error(res, '消息游标不属于当前会话', 4001, 400);
      query.$or = [
        { createdAt: { $gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $gt: cursor._id } },
      ];
    } else if (beforeId) {
      if (!mongoose.isValidObjectId(beforeId)) return error(res, '无效的分页参数', 4001, 400);
      query._id = { $lt: new mongoose.Types.ObjectId(beforeId) };
    }
    const messages = await Message.find(query)
      .populate({ path: 'senderId', select: 'displayName avatarUrl' })
      .sort(afterId ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 })
      .limit(limit);
    
    // 仅有未读消息时写入数据库，避免每次进入都执行无效更新。
    if (conv.customerUnreadCount > 0) {
      await Message.updateMany(
        { conversationId: conv._id, tenantId: customer.tenantId, readByCustomer: false },
        { $set: { readByCustomer: true } }
      );
      conv.customerUnreadCount = 0;
      await conv.save();
      const summaries = await refreshConversationSummary(conv);
      await broadcastCustomerChannelSummary(conv, summaries.customer);
    }
    
    const orderedMessages = afterId ? messages : messages.reverse();
    return ok(res, orderedMessages.map(message => {
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
    await recallAttachment(message, message.recalledAt);
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
    const { content, messageType, attachmentId, attachmentUrl, attachmentName, thumbnailUrl } = req.body;
    const clientMessageId = String(req.body.clientMessageId || '').trim();

    if (!clientMessageId || clientMessageId.length > 128) {
      return error(res, 'clientMessageId 必须为1到128个字符');
    }
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
    if (['image', 'video', 'file'].includes(effectiveType) && !attachmentId) {
      return error(res, '附件 ID 不能为空');
    }
    
    let conv = await Conversation.findOne({
      tenantId: customer.tenantId,
      channelId: customer.channelId,
      customerId: customer.id,
      status: { $in: ['waiting', 'active', 'closed'] },
    }).sort({ lastMessageAt: -1 });
    
    if (conv && clientMessageId) {
      const duplicate = await Message.findOne({
        tenantId: customer.tenantId,
        conversationId: conv._id,
        clientMessageId,
        senderType: 'customer',
        senderId: customer.id,
      });
      if (duplicate) return ok(res, { message: duplicate.toJSON(), botReply: null }, '消息已发送');
    }

    // 无会话时创建新会话
    if (!conv) {
      conv = await Conversation.create({
        tenantId: customer.tenantId,
        channelId: customer.channelId,
        customerId: customer.id,
        status: 'waiting',
      });
    }
    
    let attachment = null;
    if (attachmentId) {
      try {
        attachment = await validatePendingAttachment({
          attachmentId, tenantId: customer.tenantId, channelId: conv.channelId, conversationId: conv._id,
          uploaderType: 'customer', uploaderId: customer.id, messageType: effectiveType,
        });
      } catch (err) {
        return error(res, err.message);
      }
    }

    // 记录消息
    let msg;
    try {
      msg = await createMessageWithAttachment({
        tenantId: customer.tenantId,
        conversationId: conv._id,
        senderType: 'customer',
        senderId: customer.id,
        senderTypeModel: 'Customer',
        messageType: effectiveType,
        content: (content || '').trim(),
        attachmentUrl: attachment ? '' : (attachmentUrl || ''),
        attachmentName: attachment ? attachment.originalName : (attachmentName || ''),
        thumbnailUrl: attachment ? '' : (effectiveType === 'video' ? (thumbnailUrl || '') : ''),
        clientMessageId: clientMessageId || undefined,
      }, attachment);
    } catch (err) {
      if (err?.code === 11000 && clientMessageId) {
        const duplicate = await Message.findOne({
          tenantId: customer.tenantId,
          conversationId: conv._id,
          clientMessageId,
          senderType: 'customer',
          senderId: customer.id,
        });
        if (duplicate) return ok(res, { message: duplicate.toJSON(), botReply: null }, '消息已发送');
      }
      throw err;
    }
    
    // 将“消息到达”作为最终状态更新；若与关闭并发，客户消息原子重开会话。
    conv = await Conversation.findOneAndUpdate(
      {
        _id: conv._id,
        tenantId: customer.tenantId,
        channelId: customer.channelId,
        customerId: customer.id,
      },
      [
        {
          $set: {
            status: { $cond: [{ $eq: ['$status', 'closed'] }, 'waiting', '$status'] },
            assignedAgentId: { $cond: [{ $eq: ['$status', 'closed'] }, null, '$assignedAgentId'] },
            acceptedAt: { $cond: [{ $eq: ['$status', 'closed'] }, '$$REMOVE', '$acceptedAt'] },
            closedAt: { $cond: [{ $eq: ['$status', 'closed'] }, '$$REMOVE', '$closedAt'] },
            lastMessageAt: msg.createdAt,
            agentUnreadCount: { $add: [{ $ifNull: ['$agentUnreadCount', 0] }, 1] },
          },
        },
      ],
      { new: true, updatePipeline: true }
    );
    if (!conv) {
      await discardUnpublishedMessage(msg, attachment);
      return error(res, '会话状态已变化，请重试');
    }
    
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
          conv = await Conversation.findOneAndUpdate(
            { _id: conv._id, tenantId: customer.tenantId },
            { $set: { lastMessageAt: replyMsg.createdAt }, $inc: { customerUnreadCount: 1 } },
            { new: true }
          );
          break;
        }
      }
    }

    await broadcastCustomerChannelSummary(conv, {
      lastMessage: (replyMsg || msg).toJSON(),
      lastMessageAt: conv.lastMessageAt,
      customerUnreadCount: conv.customerUnreadCount,
    });
    
    // Socket 推送
    if (io) {
      tenantConversationRoom(conv).emit('conversation.created', {
        conversationId: conv._id,
        status: conv.status,
        channelId: conv.channelId,
        customerId: customer.id,
      });
      tenantConversationRoom(conv).emit('message.new', {
        ...msg.toJSON(),
      });
      tenantConversationRoom(conv).emit('conversation.updated', {
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
        tenantConversationRoom(conv).emit('message.new', replyData);
        tenantConversationRoom(conv).emit('conversation.updated', {
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
