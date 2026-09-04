// 忆梦云团队开发
// 数据库初始化脚本：创建默认管理员 + 默认租户（仅首次运行）
require('dotenv').config();
const connectDB = require('./src/config/db');
const config = require('./src/config');
const { hashPassword } = require('./src/utils');
const PlatformAdmin = require('./src/models/PlatformAdmin');
const Tenant = require('./src/models/Tenant');
const TenantUser = require('./src/models/TenantUser');
const Channel = require('./src/models/Channel');

async function seed() {
  await connectDB();
  
  // ===== 默认管理员 =====
  let admin = await PlatformAdmin.findOne({ username: config.defaults.admin.username });
  if (!admin) {
    admin = await PlatformAdmin.create({
      username: config.defaults.admin.username,
      password: hashPassword(config.defaults.admin.password),
      email: config.defaults.admin.email,
      role: 'super',
      status: 'active',
    });
    console.log(`[Seed] 创建默认管理员: ${config.defaults.admin.username} / ${config.defaults.admin.password}`);
  } else {
    console.log(`[Seed] 管理员已存在: ${admin.username}`);
  }
  
  // ===== 默认租户 =====
  let tenant = await Tenant.findOne({ username: config.defaults.tenant.username });
  if (!tenant) {
    tenant = await Tenant.create({
      name: config.defaults.tenant.name,
      username: config.defaults.tenant.username,
      password: hashPassword(config.defaults.tenant.password),
      email: `${config.defaults.tenant.username}@example.com`,
      status: 'active',
    });
    console.log(`[Seed] 创建默认租户: ${config.defaults.tenant.username} / ${config.defaults.tenant.password}`);
  } else {
    console.log(`[Seed] 租户已存在: ${tenant.username}`);
  }
  
  // ===== 默认租户所有者 =====
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
    console.log(`[Seed] 创建租户所有者: ${owner.username}`);
  } else {
    console.log(`[Seed] 租户所有者已存在: ${owner.username}`);
  }
  
  // ===== 默认渠道 =====
  const Channel = require('./src/models/Channel');
  const defaultChannelName = '官方客服';
  let channel = await Channel.findOne({ tenantId: tenant._id, name: defaultChannelName });
  if (!channel) {
    const { generateToken } = require('./src/utils');
    channel = await Channel.create({
      tenantId: tenant._id,
      name: defaultChannelName,
      publicToken: generateToken(24),
      brandName: tenant.name,
      brandColor: '#2563eb',
      welcomeMessage: '您好，欢迎咨询，请问有什么可以帮助您？',
      agentIds: [owner._id],
      createdBy: owner._id,
    });
    console.log(`[Seed] 创建默认渠道: ${channel.name}`);
    console.log(`[Seed] 客服链接: http://localhost:5176/c/${channel.publicToken}`);
  } else {
    console.log(`[Seed] 默认渠道已存在: ${channel.name}`);
  }
  
  console.log('\n[Seed] 完成');
  process.exit(0);
}

seed().catch(err => {
  console.error('[Seed] 失败:', err);
  process.exit(1);
});
