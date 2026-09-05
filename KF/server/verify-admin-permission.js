// 忆梦云团队开发 - 权限专项验证 v2
const http = require('http');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const BASE = 'http://localhost:3000';
const pass = [], fail = [];

async function test(name, fn) {
  process.stdout.write('▶ ' + name + ' ... ');
  try {
    const r = await fn();
    if (r.ok) { pass.push(name); console.log('✓ ' + r.msg); }
    else { fail.push(name); console.log('✗ ' + r.msg); }
  } catch (e) { fail.push(name); console.log('✗ ' + e.message); }
}

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = { method, headers };
    if (body) opts.headers['Content-Type'] = 'application/json';
    const r = http.request(url, opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service');
  const Admin = require('./src/models/PlatformAdmin');
  const Tenant = require('./src/models/Tenant');

  console.log('\n=========== 管理员权限专项验证 ===========\n');

  // 清理 + 准备 operator
  const OPERATOR_USER = 'op_test_e2e';
  const OPERATOR_PWD = 'op123456';
  await Admin.deleteOne({ username: OPERATOR_USER });
  await Admin.create({
    username: OPERATOR_USER,
    password: bcrypt.hashSync(OPERATOR_PWD, 10),
    email: `${OPERATOR_USER}@test.com`,
    role: 'operator',
    status: 'active',
  });

  let superToken, opToken, tenantId;
  const adminDb = await Admin.findOne({ username: 'admin' });
  const tenant = await Tenant.findOne();
  tenantId = tenant._id;

  // ===== super 权限 =====
  console.log('--- super 权限 ---');
  
  await test('super 登录 admin/admin123', async () => {
    const r = await req('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin123' });
    if (r.status === 200 && r.body?.code === 0 && r.body.data?.token && r.body.data.admin.role === 'super') {
      superToken = r.body.data.token;
      return { ok: true, msg: 'OK' };
    }
    return { ok: false, msg: r.body?.message || r.raw };
  });

  await test('super 可访问 dashboard', async () => {
    const r = await req('GET', '/api/admin/dashboard', null, { Authorization: 'Bearer ' + superToken });
    return { ok: r.body?.code === 0, msg: r.body?.message || r.status };
  });

  await test('super 可改租户状态（敏感）', async () => {
    const r = await req('PATCH', `/api/admin/tenants/${tenantId}/status`, { status: 'active' },
      { Authorization: 'Bearer ' + superToken });
    return { ok: r.body?.code === 0, msg: r.body?.message || r.status };
  });

  await test('super 可改租户套餐（敏感）', async () => {
    const r = await req('PATCH', `/api/admin/tenants/${tenantId}/plan`, { agentLimit: 50 },
      { Authorization: 'Bearer ' + superToken });
    return { ok: r.body?.code === 0, msg: r.body?.message || r.status };
  });

  // ===== operator 权限 =====
  console.log('\n--- operator 权限 ---');

  await test('operator 登录', async () => {
    const r = await req('POST', '/api/admin/auth/login', { username: OPERATOR_USER, password: OPERATOR_PWD });
    if (r.status === 200 && r.body?.code === 0 && r.body.data?.admin.role === 'operator') {
      opToken = r.body.data.token;
      return { ok: true, msg: 'OK role=' + r.body.data.admin.role };
    }
    return { ok: false, msg: r.body?.message || r.raw };
  });

  await test('operator 可访问 dashboard（只读）', async () => {
    const r = await req('GET', '/api/admin/dashboard', null, { Authorization: 'Bearer ' + opToken });
    return { ok: r.body?.code === 0, msg: r.body?.message || r.status };
  });

  await test('operator 可列出租户（只读）', async () => {
    const r = await req('GET', '/api/admin/tenants', null, { Authorization: 'Bearer ' + opToken });
    return { ok: r.body?.code === 0, msg: r.body?.message || r.status };
  });

  await test('operator 改租户状态应被拒 (403)', async () => {
    const r = await req('PATCH', `/api/admin/tenants/${tenantId}/status`, { status: 'disabled' },
      { Authorization: 'Bearer ' + opToken });
    if (r.status === 403 && r.body?.code === 4033) return { ok: true, msg: '4033 正确拦截' };
    return { ok: false, msg: '未拦截! status=' + r.status + ' msg=' + r.body?.message };
  });

  await test('operator 改租户套餐应被拒 (403)', async () => {
    const r = await req('PATCH', `/api/admin/tenants/${tenantId}/plan`, { agentLimit: 5 },
      { Authorization: 'Bearer ' + opToken });
    if (r.status === 403 && r.body?.code === 4033) return { ok: true, msg: '4033 正确拦截' };
    return { ok: false, msg: '未拦截! status=' + r.status + ' msg=' + r.body?.message };
  });

  // ===== 禁用态拦截 =====
  console.log('\n--- 禁用态拦截 ---');

  // super 禁用 → 旧 token 失效 → 重新启用
  const superLogin2 = await req('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin123' });
  let disabledSuperToken = superLogin2.body.data.token;
  await Admin.updateOne({ _id: adminDb._id }, { status: 'disabled' });

  await test('禁用 super 后旧 token 访问 /auth/me 应被拒 (403)', async () => {
    const r = await req('GET', '/api/admin/auth/me', null, { Authorization: 'Bearer ' + disabledSuperToken });
    // 立刻还原
    await Admin.updateOne({ _id: adminDb._id }, { status: 'active' });
    if (r.status === 403 && r.body?.code === 4032) return { ok: true, msg: '4032 正确拦截' };
    return { ok: false, msg: '未拦截! status=' + r.status + ' msg=' + r.body?.message };
  });

  // operator 禁用 → 旧 token 失效 → 清理
  const opLogin2 = await req('POST', '/api/admin/auth/login', { username: OPERATOR_USER, password: OPERATOR_PWD });
  const disabledOpToken = opLogin2.body.data.token;
  await Admin.updateOne({ username: OPERATOR_USER }, { status: 'disabled' });

  await test('禁用 operator 后旧 token 访问 dashboard 应被拒 (403)', async () => {
    const r = await req('GET', '/api/admin/dashboard', null, { Authorization: 'Bearer ' + disabledOpToken });
    if (r.status === 403 && r.body?.code === 4032) {
      await Admin.deleteOne({ username: OPERATOR_USER });
      return { ok: true, msg: '4032 正确拦截' };
    }
    await Admin.deleteOne({ username: OPERATOR_USER });
    return { ok: false, msg: '未拦截! status=' + r.status + ' msg=' + r.body?.message };
  });

  console.log('\n=========== 结果 ===========');
  console.log('通过:', pass.length, '失败:', fail.length);
  fail.forEach(x => console.log('  ✗ ' + x));
  await mongoose.disconnect();
  process.exit(fail.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
