// 忆梦云团队开发
const Customer = require('../models/Customer');
const Channel = require('../models/Channel');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { ok, error, hashPassword, comparePassword, signToken, generateToken, normalizePhone, hashFingerprint, getClientIp } = require('../utils');

class CustomerAuthController {
  /**
   * POST /api/client/channels/:token/auth
   * 客户登录 / 自动注册
   */
  async auth(req, res) {
    const { token: publicToken } = req.params;
    const { phone, password, fingerprint } = req.body;
    
    // 1. 查找渠道
    const channel = await Channel.findOne({ publicToken });
    if (!channel) {
      return error(res, '客服链接无效或已过期', 404);
    }
    if (channel.status !== 'online') {
      return error(res, '当前客服暂不在线', 503);
    }
    
    const tenantId = channel.tenantId;
    const normalized = normalizePhone(phone);
    const ip = getClientIp(req);
    const fpHash = hashFingerprint(fingerprint);
    
    // 2. 在该 channel 下查找手机号
    let customer = await Customer.findOne({ channelId: channel._id, phone: normalized });
    
    let isNew = false;
    
    if (customer) {
      // 已存在：验证密码
      if (!comparePassword(password, customer.password)) {
        return error(res, '密码错误', 401);
      }
      if (customer.status !== 'active') {
        return error(res, '账号已被禁用', 403);
      }
      customer.lastLoginIp = ip;
      customer.lastLoginAt = new Date();
      await customer.save();
    } else {
      // 不存在：自动注册
      isNew = true;
      customer = await Customer.create({
        tenantId,
        channelId: channel._id,
        phone: normalized,
        password: hashPassword(password),
        registerIp: ip,
        registerUserAgent: req.headers['user-agent'] || '',
        registerFingerprintHash: fpHash,
        lastLoginIp: ip,
        lastLoginAt: new Date(),
      });
    }
    
    // 3. 检查是否需要完善 QQ
    const profileRequired = !customer.qq;
    
    // 4. 确保有一个活跃会话
    let conversation = await Conversation.findOne({
      tenantId,
      channelId: channel._id,
      customerId: customer._id,
      status: { $in: ['waiting', 'active'] },
    }).sort({ lastMessageAt: -1 });
    
    if (!conversation) {
      conversation = await Conversation.create({
        tenantId,
        channelId: channel._id,
        customerId: customer._id,
        status: 'waiting',
      });

      if (channel.welcomeMessage?.trim()) {
        const welcomeMsg = await Message.create({
          tenantId,
          conversationId: conversation._id,
          senderType: 'bot',
          messageType: 'text',
          autoReplyType: 'welcome',
          content: channel.welcomeMessage.trim(),
        });
        conversation.lastMessageAt = welcomeMsg.createdAt;
        await conversation.save();
      }
    }
    
    // 5. 签发客户 token
    const jwt = signToken({
      type: 'customer',
      id: customer._id.toString(),
      tenantId: tenantId.toString(),
      channelId: channel._id.toString(),
      conversationId: conversation._id.toString(),
    });
    
    return ok(res, {
      token: jwt,
      isNew,
      profileRequired,
      customer: customer.toJSON(),
      channel: {
        id: channel._id,
        name: channel.name,
        brandName: channel.brandName,
        brandColor: channel.brandColor,
        avatarUrl: channel.avatarUrl,
        welcomeMessage: channel.welcomeMessage,
      },
      conversation: {
        id: conversation._id,
        status: conversation.status,
      },
    });
  }
  
  // GET /api/client/channels/:token
  async getChannelInfo(req, res) {
    const { token: publicToken } = req.params;
    const channel = await Channel.findOne({ publicToken });
    if (!channel) {
      return error(res, '客服链接无效或已过期', 404);
    }
    return ok(res, {
      id: channel._id,
      name: channel.name,
      brandName: channel.brandName,
      brandColor: channel.brandColor,
      avatarUrl: channel.avatarUrl,
      welcomeMessage: channel.welcomeMessage,
      offlineMessage: channel.offlineMessage,
      status: channel.status,
    });
  }
  
  // POST /api/client/profile/qq
  async updateQQ(req, res) {
    const { qq } = req.body;
    const customer = await Customer.findById(req.customer.id);
    if (!customer) {
      return error(res, '账号不存在', 404);
    }
    customer.qq = qq;
    customer.email = `${qq}@qq.com`;
    customer.avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`;
    await customer.save();
    return ok(res, customer.toJSON());
  }
  
  // GET /api/client/me
  async me(req, res) {
    const customer = await Customer.findById(req.customer.id);
    if (!customer) {
      return error(res, '账号不存在', 404);
    }
    return ok(res, customer.toJSON());
  }
}

module.exports = new CustomerAuthController();
