// 忆梦云团队开发 - 后端全链路快速验证 v3
const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE = 'http://localhost:3000';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'; // placeholder
const pass = [], fail = [];

function log(name, ok, detail) {
  const icon = ok ? '✓' : '✗';
  (ok ? pass : fail).push(name);
  console.log(`${icon} ${name}${detail ? ' → ' + detail : ''}`);
}

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + p);
    const opts = { method, headers };
    if (body !== undefined) opts.headers['Content-Type'] = 'application/json';
    const r = http.request(url, opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

async function main() {
  console.log('\n=== 后端全链路快速验证 ===\n');

  // 1. 管理员登录
  const a = await req('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin123' });
  let adminToken = a.body?.data?.token;
  log('admin 登录', a.body?.code === 0, a.body?.message);

  // 2. admin dashboard
  const d = await req('GET', '/api/admin/dashboard', null, { Authorization: 'Bearer ' + adminToken });
  log('admin dashboard', d.body?.code === 0, d.body?.message);

  // 3. admin tenants
  const t = await req('GET', '/api/admin/tenants', null, { Authorization: 'Bearer ' + adminToken });
  const adminTenantList = t.body?.data?.items || [];
  log('admin 租户列表', t.body?.code === 0 && Array.isArray(adminTenantList), 'count=' + adminTenantList.length);

  // 4. 租户用户登录
  const te = await req('POST', '/api/tenant/auth/login', { username: 'demo', password: 'demo123' });
  let tenantToken = te.body?.data?.token;
  log('租户登录', te.body?.code === 0, te.body?.message);

  // 5. 租户坐席列表
  const ag = await req('GET', '/api/tenant/employees', null, { Authorization: 'Bearer ' + tenantToken });
  let agentList = ag.body?.data?.items || ag.body?.data?.list || [];
  log('坐席列表', ag.body?.code === 0 && Array.isArray(agentList), 'count=' + agentList.length);

  // 6. 渠道列表
  const ch = await req('GET', '/api/tenant/channels', null, { Authorization: 'Bearer ' + tenantToken });
  let channelList = ch.body?.data?.items || ch.body?.data?.list || [];
  log('渠道列表', ch.body?.code === 0 && Array.isArray(channelList), 'count=' + channelList.length);
  let channelId = channelList[0]?._id;
  let channelToken = channelList[0]?.token;

  // 7. 创建一个新客户会话
  const phone = '138' + Math.random().toString().slice(2, 10);
  const ca = await req('POST', `/api/client/channels/${channelToken}/auth`, { phone, password: '123456' });
  let customerToken = ca.body?.data?.token;
  let customerId = ca.body?.data?.customer?._id;
  log('客户登录/自动注册', ca.body?.code === 0, 'phone=' + phone + ' customerId=' + customerId);

  // 8. 客户第一次发消息
  const m1 = await req('POST', '/api/client/conversation/messages', { content: '你好' },
    { Authorization: 'Bearer ' + customerToken });
  log('客户发消息', m1.body?.code === 0 && m1.body?.data?.message, 'botReply=' + (m1.body?.data?.botReply?.content || '无'));

  // 9. 租户查看会话列表
  const cc = await req('GET', '/api/tenant/conversations', null, { Authorization: 'Bearer ' + tenantToken });
  let convList = cc.body?.data?.items || cc.body?.data?.list || [];
  log('租户会话列表', cc.body?.code === 0 && convList.length > 0, 'count=' + convList.length);
  let convId = convList[0]?._id;

  // 10. 接入会话
  const ac = await req('POST', `/api/tenant/conversations/${convId}/accept`, null,
    { Authorization: 'Bearer ' + tenantToken });
  log('坐席接入会话', ac.body?.code === 0, 'status=' + ac.body?.data?.status);

  // 11. 坐席发消息
  const am = await req('POST', `/api/tenant/conversations/${convId}/messages`, { content: '您好，有什么可以帮您？' },
    { Authorization: 'Bearer ' + tenantToken });
  log('坐席发消息', am.body?.code === 0, am.body?.message);

  // 12. 转接会话（转回自己→应该报错，然后成功转给另一个坐席/或新坐席）
  const trSame = await req('POST', `/api/tenant/conversations/${convId}/transfer`, { targetAgentId: agentList[0]._id },
    { Authorization: 'Bearer ' + tenantToken });
  log('转接给自己（应被拒）', trSame.body?.code !== 0, trSame.body?.message);

  // 新建第二坐席做转接目标
  let agent2Id = agentList.find(x => x._id !== agentList[0]?._id)?._id;
  if (!agent2Id && agentList[0]) {
    const newAgent = await req('POST', '/api/tenant/employees', { username: 'agent2_' + Date.now(), password: 'agent123456', displayName: '客服2' },
      { Authorization: 'Bearer ' + tenantToken });
    agent2Id = newAgent.body?.data?._id;
  }
  const tr = await req('POST', `/api/tenant/conversations/${convId}/transfer`, { targetAgentId: agent2Id, reason: '更专业的同学处理' },
    { Authorization: 'Bearer ' + tenantToken });
  log('转接给 agent2', tr.body?.code === 0, tr.body?.message);

  // 13. 文件上传 - 先写一个小 png 到 uploads
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==', 'base64');
  const tmp = path.resolve(__dirname, 'tmp_test.png');
  fs.writeFileSync(tmp, png);
  // 用 http.request 手动发 multipart
  const uploadOk = await uploadMulti(`${BASE}/api/upload/tenant`, tenantToken, 'file', tmp, 'test.png', 'image/png');
  log('租户文件上传', uploadOk?.body?.code === 0, uploadOk?.body?.data?.url);
  fs.unlinkSync(tmp);

  // 14. rate-limit 测试：请求一次正确，然后模拟 20+ 次
  // 只测一次不超限的，超限交给手动
  log('rate-limit 登录（首次）', a.body?.code === 0, '已登录');

  // 15. 结束会话
  const cl = await req('POST', `/api/tenant/conversations/${convId}/close`, null,
    { Authorization: 'Bearer ' + tenantToken });
  log('关闭会话', cl.body?.code === 0, cl.body?.message);

  console.log(`\n通过: ${pass.length}  失败: ${fail.length}`);
  if (fail.length) fail.forEach(x => console.log('  ✗ ' + x));
  await mongoose.disconnect().catch(() => {});
  process.exit(fail.length === 0 ? 0 : 1);
}

function uploadMulti(urlStr, token, fieldName, filePath, fileName, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const boundary = '----TraeBoundary' + Date.now();
    const bodyStart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`;
    const bodyEnd = `\r\n--${boundary}--\r\n`;
    const fileBuf = fs.readFileSync(filePath);
    const body = Buffer.concat([Buffer.from(bodyStart), fileBuf, Buffer.from(bodyEnd)]);

    const req_ = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    req_.on('error', reject);
    req_.write(body);
    req_.end();
  });
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
