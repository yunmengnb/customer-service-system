// 忆梦云团队开发
const CustomerAccount = require('../models/CustomerAccount');
const Customer = require('../models/Customer');
const Channel = require('../models/Channel');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const config = require('../config');
const cache = require('../utils/cache');
const presence = require('../utils/presence');
const { getSystemSettings } = require('../utils/systemSettings');
const { ok, error, hashPassword, comparePassword, signToken, normalizePhone, hashFingerprint, getClientIp } = require('../utils');

async function getChannelByToken(publicToken) {
  const key = `config:channel:token:${publicToken}`;
  const cached = await cache.getJson(key);
  if (cached) return cached;
  const channel = await Channel.findOne({ publicToken }).lean();
  if (channel) await cache.setJson(key, channel, config.redis.cacheTtlSeconds);
  return channel;
}

function accountJson(account, binding) {
  const data = account.toJSON();
  data.accountId = data._id;
  data._id = binding._id;
  data.bindingId = binding._id;
  data.tenantId = binding.tenantId;
  data.channelId = binding.channelId;
  data.messageReceivingDisabled = binding.messageReceivingDisabled;
  data.blocked = binding.blocked;
  return data;
}

async function resolveAccount(payload) {
  if (payload.accountId) {
    const account = await CustomerAccount.findById(payload.accountId);
    if (account) return account;
  }
  const binding = await Customer.findById(payload.id);
  if (!binding) return null;
  if (binding.accountId) return CustomerAccount.findById(binding.accountId);

  // 兼容迁移前签发的 JWT：沿用原 Customer ID，并按旧资料补建账户。
  let account = await CustomerAccount.findOne({ phone: binding.phone });
  if (!account) {
    try {
      account = await CustomerAccount.create({
        phone: binding.phone,
        password: binding.password,
        qq: binding.qq,
        email: binding.email,
        nickname: binding.nickname,
        avatarUrl: binding.avatarUrl,
        registerIp: binding.registerIp,
        registerUserAgent: binding.registerUserAgent,
        registerFingerprintHash: binding.registerFingerprintHash,
        lastLoginIp: binding.lastLoginIp,
        lastLoginAt: binding.lastLoginAt,
        status: binding.status,
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      account = await CustomerAccount.findOne({ phone: binding.phone });
    }
  }
  binding.accountId = account._id;
  await binding.save();
  return account;
}

class CustomerAuthController {
  // POST /api/client/channels/:token/auth
  async auth(req, res) {
    const { token: publicToken } = req.params;
    const { phone, password, fingerprint } = req.body;
    const channel = await getChannelByToken(publicToken);
    if (!channel) return error(res, '客服链接无效或已过期', 404);
    if (channel.status !== 'online') return error(res, '当前客服暂不在线', 503);
    const settings = await getSystemSettings();
    if (!settings.loginEnabled) return error(res, '系统暂时关闭登录', 4034, 403);

    const tenantId = channel.tenantId;
    const normalized = normalizePhone(phone);
    const ip = getClientIp(req);
    const fpHash = hashFingerprint(fingerprint);
    let account = await CustomerAccount.findOne({ phone: normalized });
    let binding = await Customer.findOne({ channelId: channel._id, phone: normalized });
    let isNew = false;

    // 兼容尚未执行迁移的旧数据：首次登录时就地建立全局账户。
    if (!account && binding) {
      if (!comparePassword(password, binding.password)) return error(res, '密码错误', 401);
      account = await CustomerAccount.create({
        phone: normalized,
        password: binding.password,
        qq: binding.qq,
        email: binding.email,
        nickname: binding.nickname,
        avatarUrl: binding.avatarUrl,
        registerIp: binding.registerIp,
        registerUserAgent: binding.registerUserAgent,
        registerFingerprintHash: binding.registerFingerprintHash,
        lastLoginIp: ip,
        lastLoginAt: new Date(),
        status: binding.status,
      });
    } else if (account) {
      if (!comparePassword(password, account.password)) return error(res, '密码错误', 401);
      if (account.status !== 'active') return error(res, '账号已被禁用', 403);
      account.lastLoginIp = ip;
      account.lastLoginAt = new Date();
      await account.save();
    } else {
      if (!settings.registerEnabled) return error(res, '系统暂未开放注册', 4034, 403);
      isNew = true;
      try {
        account = await CustomerAccount.create({
          phone: normalized,
          password: hashPassword(password),
          registerIp: ip,
          registerUserAgent: req.headers['user-agent'] || '',
          registerFingerprintHash: fpHash,
          lastLoginIp: ip,
          lastLoginAt: new Date(),
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        account = await CustomerAccount.findOne({ phone: normalized });
        isNew = false;
        if (!account || !comparePassword(password, account.password)) return error(res, '密码错误', 401);
      }
    }

    if (!binding) {
      binding = await Customer.create({
        accountId: account._id,
        tenantId,
        channelId: channel._id,
        phone: account.phone,
        password: account.password,
        qq: account.qq,
        email: account.email,
        nickname: account.nickname,
        avatarUrl: account.avatarUrl,
        registerIp: ip,
        registerUserAgent: req.headers['user-agent'] || '',
        registerFingerprintHash: fpHash,
        lastLoginIp: ip,
        lastLoginAt: new Date(),
      });
    } else {
      binding.accountId = account._id;
      binding.lastLoginIp = ip;
      binding.lastLoginAt = new Date();
      await binding.save();
    }

    const profileRequired = !account.qq;
    let conversation = await Conversation.findOne({
      tenantId,
      channelId: channel._id,
      customerId: binding._id,
      status: { $in: ['waiting', 'active'] },
    }).sort({ lastMessageAt: -1 });

    if (!conversation) {
      conversation = await Conversation.create({ tenantId, channelId: channel._id, customerId: binding._id, status: 'waiting' });
      const welcomeContent = String(channel.welcomeMessage || '').trim();
      const welcomeImageUrl = String(channel.welcomeImageUrl || '').trim();
      if (welcomeContent || welcomeImageUrl) {
        const welcomeMsg = await Message.create({
          tenantId,
          conversationId: conversation._id,
          senderType: 'bot',
          messageType: welcomeImageUrl ? 'image' : 'text',
          autoReplyType: 'welcome',
          content: welcomeContent,
          attachmentUrl: welcomeImageUrl,
          attachmentName: channel.welcomeImageName || '',
        });
        conversation.lastMessageAt = welcomeMsg.createdAt;
        await conversation.save();
      }
    }

    const jwt = signToken({
      type: 'customer',
      id: binding._id.toString(),
      accountId: account._id.toString(),
      tenantId: tenantId.toString(),
      channelId: channel._id.toString(),
      conversationId: conversation._id.toString(),
    });

    return ok(res, {
      token: jwt,
      isNew,
      profileRequired,
      customer: accountJson(account, binding),
      channel: {
        id: channel._id,
        name: channel.name,
        brandName: channel.brandName,
        brandColor: channel.brandColor,
        avatarUrl: channel.avatarUrl,
        welcomeMessage: channel.welcomeMessage,
        welcomeImageUrl: channel.welcomeImageUrl || '',
        welcomeImageName: channel.welcomeImageName || '',
      },
      conversation: { id: conversation._id, status: conversation.status },
    });
  }

  // POST /api/client/channels/:token/switch
  async switchChannel(req, res) {
    const account = await resolveAccount(req.customer);
    if (!account) return error(res, '账号不存在', 404);
    const channel = await getChannelByToken(req.params.token);
    if (!channel) return error(res, '客服链接无效或已过期', 404);
    if (channel.status !== 'online') return error(res, '当前客服暂不在线', 503);

    const ip = getClientIp(req);
    let binding = await Customer.findOne({ accountId: account._id, channelId: channel._id });
    if (!binding) {
      binding = await Customer.create({
        accountId: account._id,
        tenantId: channel.tenantId,
        channelId: channel._id,
        phone: account.phone,
        password: account.password,
        qq: account.qq,
        email: account.email,
        nickname: account.nickname,
        avatarUrl: account.avatarUrl,
        registerIp: ip,
        registerUserAgent: req.headers['user-agent'] || '',
        registerFingerprintHash: account.registerFingerprintHash,
        lastLoginIp: ip,
        lastLoginAt: new Date(),
      });
    } else {
      if (binding.blocked) return error(res, '当前账号已被限制访问', 4035, 403);
      binding.lastLoginIp = ip;
      binding.lastLoginAt = new Date();
      await binding.save();
    }

    let conversation = await Conversation.findOne({
      tenantId: channel.tenantId,
      channelId: channel._id,
      customerId: binding._id,
      status: { $in: ['waiting', 'active'] },
    }).sort({ lastMessageAt: -1 });
    if (!conversation) {
      conversation = await Conversation.create({
        tenantId: channel.tenantId,
        channelId: channel._id,
        customerId: binding._id,
        status: 'waiting',
      });
      const welcomeContent = String(channel.welcomeMessage || '').trim();
      const welcomeImageUrl = String(channel.welcomeImageUrl || '').trim();
      if (welcomeContent || welcomeImageUrl) {
        const welcomeMsg = await Message.create({
          tenantId: channel.tenantId,
          conversationId: conversation._id,
          senderType: 'bot',
          messageType: welcomeImageUrl ? 'image' : 'text',
          autoReplyType: 'welcome',
          content: welcomeContent,
          attachmentUrl: welcomeImageUrl,
          attachmentName: channel.welcomeImageName || '',
        });
        conversation.lastMessageAt = welcomeMsg.createdAt;
        await conversation.save();
      }
    }

    const jwt = signToken({
      type: 'customer',
      id: binding._id.toString(),
      accountId: account._id.toString(),
      tenantId: channel.tenantId.toString(),
      channelId: channel._id.toString(),
      conversationId: conversation._id.toString(),
    });
    return ok(res, { token: jwt });
  }

  // GET /api/client/channels/:token
  async getChannelInfo(req, res) {
    const { token: publicToken } = req.params;
    const channel = await getChannelByToken(publicToken);
    if (!channel) return error(res, '客服链接无效或已过期', 404);
    const agentIds = (channel.agentIds || []).map(id => String(id));
    const onlineStates = await Promise.all(agentIds.map(id => presence.isOnline('tenant_user', id)));
    return ok(res, {
      id: channel._id,
      name: channel.name,
      brandName: channel.brandName,
      brandColor: channel.brandColor,
      avatarUrl: channel.avatarUrl,
      welcomeMessage: channel.welcomeMessage,
      offlineMessage: channel.offlineMessage,
      status: channel.status,
      agentIds,
      agentOnline: onlineStates.some(Boolean),
    });
  }

  // POST /api/client/profile/qq
  async updateQQ(req, res) {
    const account = await resolveAccount(req.customer);
    const binding = await Customer.findById(req.customer.id);
    if (!account || !binding) return error(res, '账号不存在', 404);
    const { qq } = req.body;
    account.qq = qq;
    account.email = `${qq}@qq.com`;
    account.avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`;
    await account.save();
    await Customer.updateMany(
      { accountId: account._id },
      { $set: { qq: account.qq, email: account.email, avatarUrl: account.avatarUrl } },
    );
    return ok(res, accountJson(account, binding));
  }

  // GET /api/client/me
  async me(req, res) {
    const account = await resolveAccount(req.customer);
    const binding = await Customer.findById(req.customer.id);
    if (!account || !binding) return error(res, '账号不存在', 404);
    return ok(res, accountJson(account, binding));
  }

  // GET /api/client/channels/history
  async channelHistory(req, res) {
    const account = await resolveAccount(req.customer);
    if (!account) return error(res, '账号不存在', 404);
    const bindings = await Customer.find({ accountId: account._id }).sort({ lastLoginAt: -1, createdAt: -1 }).lean();
    const channelIds = bindings.map(item => item.channelId);
    const channels = await Channel.find({ _id: { $in: channelIds } })
      .select('_id tenantId name publicToken brandName brandColor avatarUrl status')
      .lean();
    const channelMap = Object.fromEntries(channels.map(item => [String(item._id), item]));
    return ok(res, bindings.flatMap(binding => {
      const channel = channelMap[String(binding.channelId)];
      if (!channel) return [];
      return [{
        ...channel,
        bindingId: binding._id,
        lastVisitedAt: binding.lastLoginAt || binding.createdAt,
        current: String(binding.channelId) === String(req.customer.channelId),
      }];
    }));
  }

  // POST /api/client/profile/password
  async updatePassword(req, res) {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      if (newPassword !== confirmPassword) return error(res, '两次输入的新密码不一致', 4003, 400);
      const account = await resolveAccount(req.customer);
      if (!account) return error(res, '账号不存在', 4041, 404);
      if (!comparePassword(currentPassword, account.password)) return error(res, '当前密码错误', 4001, 400);
      if (comparePassword(newPassword, account.password)) return error(res, '新密码不能与当前密码相同', 4002, 400);
      account.password = hashPassword(newPassword);
      await account.save();
      // 旧 Customer.password 暂时同步，保证迁移期间旧版本服务仍可验证。
      await Customer.updateMany({ accountId: account._id }, { $set: { password: account.password } });
      return ok(res, null, '密码修改成功，请使用新密码登录');
    } catch (err) {
      return error(res, '密码修改失败，请稍后重试', 5001, 500);
    }
  }
}

module.exports = new CustomerAuthController();
