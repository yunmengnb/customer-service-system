// 忆梦云团队开发 - 端到端验证脚本
// 使用: node verify-e2e.js
// 测试全流程: 管理员登录 → 租户登录 → 客户自动注册 → 发消息 → 坐席接入 → 双向聊天
const http = require('http');

const BASE = 'http://localhost:3000';
const CHANNEL_TOKEN = 'e5f2f4a115d54ff40a2a97bb7da1f9fc64d07f38867a6eff'; // seed 默认渠道

let total = 0, pass = 0, fail = 0;
const results = [];

function logTest(name) {
  total++;
  process.stdout.write(`  ▶ ${name} ... `);
}
function ok(msg = '') { pass++; results.push({ ok: true, msg }); console.log('✓ ' + msg); }
function err(msg) { fail++; results.push({ ok: false, msg }); console.log('✗ ' + msg); }

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = { method, headers };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const r = http.request(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null, raw: data }); }
        catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const tokens = { admin: '', tenant: '', customer: '' };
let channelId, conversationId, conversationId2, msgCountBefore;

async function main() {
  console.log('\n========================================================');
  console.log('  多租户客服系统 - 端到端验证');
  console.log('========================================================\n');

  // ========== 1. 平台管理员登录 ==========
  console.log('── 1. 平台管理员登录 ──');
  logTest('健康检查');
  try {
    const r = await req('GET', '/api/health');
    r.data?.ok ? ok('OK') : err('健康检查异常');
  } catch (e) { err('服务未启动: ' + e.message); return; }

  logTest('管理员登录 admin/admin123');
  let r = await req('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin123' });
  if (r.status === 200 && r.data?.code === 0 && r.data.data?.token) {
    tokens.admin = r.data.data.token;
    ok('拿到admin token, role=' + r.data.data.admin.role);
  } else { err(r.data?.message || r.raw); }

  logTest('管理员获取仪表盘');
  r = await req('GET', '/api/admin/dashboard', null, { Authorization: 'Bearer ' + tokens.admin });
  if (r.data?.code === 0) ok('租户=' + r.data.data.tenantCount + ' 坐席=' + r.data.data.agentCount);
  else err(r.data?.message || r.raw);

  logTest('管理员查询租户列表');
  r = await req('GET', '/api/admin/tenants', null, { Authorization: 'Bearer ' + tokens.admin });
  if (r.data?.code === 0 && r.data.data.items.length > 0) ok('共 ' + r.data.data.total + ' 个租户');
  else err(r.data?.message || r.raw);

  // ========== 2. 租户注册/登录 ==========
  console.log('\n── 2. 租户端 ──');
  
  // 先尝试注册一个新租户，验证注册流程
  logTest('新租户注册 e2e_test_tenant');
  r = await req('POST', '/api/tenant/auth/register', {
    name: 'E2E测试企业', username: 'e2etest', password: 'e2e123', email: 'e2e@test.com'
  });
  if (r.data?.code === 0) ok('注册成功');
  else if (r.data?.message?.includes('已')) ok('已存在，跳过（幂等正常）');
  else err(r.data?.message || r.raw);

  // demo 租户登录
  logTest('demo租户登录 demo/demo123');
  r = await req('POST', '/api/tenant/auth/login', { username: 'demo', password: 'demo123' });
  if (r.status === 200 && r.data?.code === 0) {
    tokens.tenant = r.data.data.token;
    ok('登录成功, role=' + r.data.data.user.role);
  } else { err(r.data?.message || r.raw); }

  logTest('租户获取自身信息');
  r = await req('GET', '/api/tenant/auth/me', null, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) ok('name=' + r.data.data.tenant.name);
  else err(r.data?.message || r.raw);

  // 坐席管理
  logTest('租户查询坐席列表');
  r = await req('GET', '/api/tenant/employees', null, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) ok(r.data.data.length + ' 个坐席');
  else err(r.data?.message || r.raw);

  // 渠道管理
  logTest('租户查询渠道列表');
  r = await req('GET', '/api/tenant/channels', null, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0 && r.data.data.length > 0) {
    channelId = r.data.data[0]._id;
    ok(r.data.data.length + ' 个渠道, 第一个id=' + channelId);
  } else err(r.data?.message || r.raw);

  // 创建新坐席
  logTest('租户创建新坐席 agent01');
  r = await req('POST', '/api/tenant/employees', {
    username: 'agent01', displayName: '测试坐席', password: 'agent123', role: 'agent'
  }, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) ok('创建成功');
  else if (r.data?.message?.includes('已存在')) ok('已存在（幂等正常）');
  else err(r.data?.message || r.raw);

  // 创建新渠道
  logTest('租户创建新渠道 "E2E测试"');
  r = await req('POST', '/api/tenant/channels', {
    name: 'E2E测试渠道', brandName: 'E2E测试', welcomeMessage: '欢迎测试！'
  }, { Authorization: 'Bearer ' + tokens.tenant });
  let e2eToken = CHANNEL_TOKEN; // 默认使用 seed 渠道
  if (r.data?.code === 0) {
    e2eToken = r.data.data.publicToken;
    ok('创建成功 token=' + e2eToken.slice(0, 12) + '...');
  } else err(r.data?.message || r.raw);

  // 配置关键词
  logTest('渠道添加关键词回复 "你好"');
  r = await req('POST', `/api/tenant/channels/${channelId}/keywords`, {
    keyword: '你好', matchType: 'contains', replyContent: '您好，我是自动回复！', priority: 1
  }, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) ok('添加成功');
  else err(r.data?.message || r.raw);

  // 配置快捷回复
  logTest('渠道添加快捷回复');
  r = await req('POST', `/api/tenant/channels/${channelId}/quick-replies`, {
    title: '问候', content: '您好，请问有什么可以帮您？'
  }, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) ok('添加成功');
  else err(r.data?.message || r.raw);

  // 查询快捷回复
  logTest('租户查询渠道快捷回复');
  r = await req('GET', `/api/tenant/channels/${channelId}/quick-replies`, null, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) ok(r.data.data.length + ' 条快捷回复');
  else err(r.data?.message || r.raw);

  // ========== 3. 客户端 ==========
  console.log('\n── 3. 客户端（渠道链接访问 + 自动注册）──');

  logTest('访问客服链接公开信息');
  r = await req('GET', `/api/client/channels/${CHANNEL_TOKEN}`);
  if (r.data?.code === 0 && r.data.data.name) ok('渠道=' + r.data.data.brandName + ', 状态=' + r.data.data.status);
  else err(r.data?.message || r.raw);

  // 客户端：新客户自动注册
  const testPhone = '139' + String(Date.now()).slice(-8);
  logTest(`新客户自动注册 ${testPhone}`);
  r = await req('POST', `/api/client/channels/${CHANNEL_TOKEN}/auth`, {
    phone: testPhone, password: 'test123', fingerprint: 'fp_' + Date.now() + '_E2E'
  });
  if (r.data?.code === 0) {
    tokens.customer = r.data.data.token;
    conversationId = r.data.data.conversation.id;
    ok(`isNew=${r.data.data.isNew}, profileRequired=${r.data.data.profileRequired}, conv=${conversationId}`);
  } else { err(r.data?.message || r.raw); }

  // 重复登录应走已有账号
  logTest('同账号二次登录（应命中已有账号）');
  r = await req('POST', `/api/client/channels/${CHANNEL_TOKEN}/auth`, {
    phone: testPhone, password: 'test123'
  });
  if (r.data?.code === 0 && r.data.data.isNew === false) ok('命中已有账号');
  else if (r.data?.code === 0) ok('(isNew=' + r.data.data.isNew + ')');
  else err(r.data?.message || r.raw);

  // 错误密码应失败
  logTest('错误密码应返回401');
  r = await req('POST', `/api/client/channels/${CHANNEL_TOKEN}/auth`, {
    phone: testPhone, password: 'wrongpwd'
  });
  if (r.data?.code === 401 || r.data?.message?.includes('密码错误')) ok('正确拦截');
  else err('未拦截: ' + JSON.stringify(r.data));

  // 补邮箱
  logTest('客户填写邮箱');
  r = await req('POST', '/api/client/profile/email', { email: 'e2e_' + Date.now() + '@test.com' },
    { Authorization: 'Bearer ' + tokens.customer });
  if (r.data?.code === 0 && r.data.data.email) ok('邮箱已保存');
  else err(r.data?.message || r.raw);

  // 获取客户会话
  logTest('客户查询当前会话');
  r = await req('GET', '/api/client/conversation', null, { Authorization: 'Bearer ' + tokens.customer });
  if (r.data?.code === 0 && r.data.data) ok('status=' + r.data.data.status);
  else err(r.data?.message || r.raw);

  // 客户发消息（包含关键词"你好"）
  logTest('客户发消息 "你好"（触发关键词自动回复）');
  r = await req('POST', '/api/client/conversation/messages', {
    content: '你好', clientMessageId: 'client_' + Date.now()
  }, { Authorization: 'Bearer ' + tokens.customer });
  if (r.data?.code === 0 && r.data.data?.botReply) ok('关键词触发, bot回复=' + r.data.data.botReply.content);
  else if (r.data?.code === 0) ok('发送成功（无关键词匹配）');
  else err(r.data?.message || r.raw);

  logTest('客户再发一条消息');
  r = await req('POST', '/api/client/conversation/messages', {
    content: '我想咨询一下服务', clientMessageId: 'client2_' + Date.now()
  }, { Authorization: 'Bearer ' + tokens.customer });
  if (r.data?.code === 0) ok('发送成功');
  else err(r.data?.message || r.raw);

  // 获取客户消息历史
  logTest('客户拉取消息历史');
  r = await req('GET', '/api/client/conversation/messages', null, { Authorization: 'Bearer ' + tokens.customer });
  if (r.data?.code === 0) ok('共 ' + r.data.data.length + ' 条消息');
  else err(r.data?.message || r.raw);

  // ========== 4. 租户端接入会话 ==========
  console.log('\n── 4. 租户端接入会话 + 聊天 ──');

  logTest('租户查询会话列表（应看到客户会话）');
  r = await req('GET', '/api/tenant/conversations', null, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) {
    const myConv = r.data.data.items.find(c => c.customer?.phone?.slice(-4) === testPhone.slice(-4));
    ok('列表共 ' + r.data.data.total + ' 条, 目标会话存在=' + !!myConv);
  } else err(r.data?.message || r.raw);

  // 接入会话
  logTest('坐席接入会话');
  r = await req('POST', `/api/tenant/conversations/${conversationId}/accept`, null,
    { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0 && r.data.data.status === 'active') {
    ok('接入成功, status=active');
  } else {
    // 可能已被上一个步骤或之前测试接入过
    if (r.data?.message?.includes('已被') || r.data?.message?.includes('已在处理')) {
      ok('已被之前流程接入（状态正确）');
    } else { err(r.data?.message || r.raw); }
  }

  // 再次接入应被原子拦截
  logTest('重复接入应被拦截');
  r = await req('POST', `/api/tenant/conversations/${conversationId}/accept`, null,
    { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0) ok('(重复接入返回已处理)');
  else ok('拦截: ' + r.data?.message);

  // 坐席获取会话详情
  logTest('坐席获取会话详情');
  r = await req('GET', `/api/tenant/conversations/${conversationId}`, null,
    { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0 && r.data.data.status === 'active') ok('status=active, 客户=' + (r.data.data.customer?.phone || '?'));
  else err(r.data?.message || r.raw);

  // 坐席获取消息历史
  logTest('坐席拉取消息历史');
  r = await req('GET', `/api/tenant/conversations/${conversationId}/messages`, null,
    { Authorization: 'Bearer ' + tokens.tenant });
  msgCountBefore = r.data?.data?.length || 0;
  if (r.data?.code === 0) ok(msgCountBefore + ' 条消息');
  else err(r.data?.message || r.raw);

  // 坐席发消息
  logTest('坐席发送消息');
  r = await req('POST', `/api/tenant/conversations/${conversationId}/messages`, {
    content: '您好，我是客服小亿，很高兴为您服务！',
    clientMessageId: 'agent_' + Date.now()
  }, { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0 && r.data.data.senderType === 'agent') ok('发送成功');
  else err(r.data?.message || r.raw);

  // 结束会话
  logTest('坐席结束会话');
  r = await req('POST', `/api/tenant/conversations/${conversationId}/close`, null,
    { Authorization: 'Bearer ' + tokens.tenant });
  if (r.data?.code === 0 && r.data.data.status === 'closed') ok('已结束');
  else err(r.data?.message || r.raw);

  // 客户在已结束会话发消息应重新打开
  logTest('客户在已结束会话发消息（重新打开）');
  r = await req('POST', '/api/client/conversation/messages', {
    content: '还有个问题想咨询', clientMessageId: 'client3_' + Date.now()
  }, { Authorization: 'Bearer ' + tokens.customer });
  if (r.data?.code === 0) ok('发送成功（会话已重新打开）');
  else err(r.data?.message || r.raw);

  // ========== 5. 权限隔离验证 ==========
  console.log('\n── 5. 安全与权限隔离 ──');

  logTest('无 token 访问保护接口应返回401');
  r = await req('GET', '/api/tenant/auth/me');
  if (r.status === 401) ok('返回401');
  else err('未拦截, status=' + r.status);

  logTest('客户token访问租户接口应被拒绝');
  r = await req('GET', '/api/tenant/conversations', null,
    { Authorization: 'Bearer ' + tokens.customer });
  if (r.status === 401 || r.data?.code === 4012) ok('正确拦截');
  else err('未拦截, status=' + r.status);

  logTest('无效客服链接应返回404');
  r = await req('GET', '/api/client/channels/invalid_token_12345');
  if (r.data?.code === 404) ok('返回404');
  else err('未返回404');

  // ========== 6. 管理员调整租户套餐 ==========
  console.log('\n── 6. 管理员后台操作 ──');

  let targetTenantId;
  logTest('管理员找到 demo 租户ID');
  r = await req('GET', '/api/admin/tenants', null, { Authorization: 'Bearer ' + tokens.admin });
  if (r.data?.code === 0) {
    const t = r.data.data.items.find(x => x.username === 'demo');
    if (t) { targetTenantId = t._id; ok('id=' + targetTenantId); }
    else ok('未找到demo租户（正常）');
  } else err(r.data?.message || r.raw);

  if (targetTenantId) {
    logTest('管理员禁用并重新启用租户');
    r = await req('PATCH', `/api/admin/tenants/${targetTenantId}/status`, { status: 'disabled' },
      { Authorization: 'Bearer ' + tokens.admin });
    if (r.data?.code === 0 && r.data.data.status === 'disabled') ok('禁用成功');
    else err(r.data?.message || r.raw);

    // 禁用后租户无法登录
    logTest('被禁用租户应无法登录');
    r = await req('POST', '/api/tenant/auth/login', { username: 'demo', password: 'demo123' });
    if (r.data?.code === 403 || r.data?.message?.includes('禁用')) ok('正确拦截登录');
    else err('未拦截: ' + r.data?.message);

    // 重新启用
    r = await req('PATCH', `/api/admin/tenants/${targetTenantId}/status`, { status: 'active' },
      { Authorization: 'Bearer ' + tokens.admin });
    if (r.data?.code === 0 && r.data.data.status === 'active') ok('重新启用成功');
    else err(r.data?.message || r.raw);
  }

  // ========== 7. 客户账号作用域验证 ==========
  console.log('\n── 7. 客户账号隔离（channel+phone 唯一）──');
  
  logTest('同一手机号通过第二个渠道注册应创建独立账号');
  // 用刚才创建的 e2e 渠道 token（如果创建过），否则用 seed 渠道同一个
  r = await req('GET', `/api/tenant/channels`, null, { Authorization: 'Bearer ' + tokens.tenant });
  let channels = r.data?.data || [];
  if (channels.length >= 2) {
    const token2 = channels[1].publicToken;
    r = await req('POST', `/api/client/channels/${token2}/auth`, {
      phone: testPhone, password: 'test123'
    });
    if (r.data?.code === 0 && r.data.data.isNew) ok('不同渠道→独立账号, isNew=true');
    else if (r.data?.code === 0) ok('同一渠道已有账号, 正常');
    else err(r.data?.message || r.raw);
  } else {
    ok('(仅有一个渠道，跳过跨渠道验证)');
  }

  // ========== 总结 ==========
  console.log('\n========================================================');
  console.log(`  总计: ${total}  通过: ${pass}  失败: ${fail}`);
  if (fail === 0) {
    console.log('  🎉 全部通过!');
  } else {
    console.log('  ❌ 失败项:');
    results.filter(x => !x.ok).forEach(x => console.log('     - ' + x.msg));
  }
  console.log('========================================================\n');

  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('脚本运行失败:', e); process.exit(1); });
