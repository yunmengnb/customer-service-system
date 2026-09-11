// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

test('chat events reject foreign/uninitialized/stale identity before merge, sound and cursor', () => {
  const source = fs.readFileSync(path.join(__dirname, '../client-web/src/views/ChatPage.vue'), 'utf8');
  const context = vm.createContext({ deletedMessageIds: new Set(), sessionActive: true, mountedToken: 'a', token: { value: 'a' }, conversation: { value: null }, customer: { value: { tenantId: 't' } }, messages: { value: [] }, sounds: 0, playNotificationSound() { context.sounds++; }, scheduleScroll() {} });
  for (const name of ['isCurrentSession', 'belongsToConversation', 'mergeMessage', 'handleNewMessage']) {
    const start = source.indexOf('function ' + name + '(');
    const end = name === 'isCurrentSession' ? source.indexOf('\n', start) : source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  const msg = { _id: 'm1', conversationId: 'c', tenantId: 't', senderType: 'agent' };
  context.handleNewMessage(msg);
  assert.equal(context.messages.value.length, 0);
  context.conversation.value = { _id: 'c' };
  context.handleNewMessage(msg);
  context.handleNewMessage(msg);
  const cursor = () => context.messages.value.at(-1)?._id;
  for (const foreign of [{ ...msg, _id: 'foreign', conversationId: 'other' }, { ...msg, _id: 'foreign', channelToken: 'b' }, { ...msg, _id: 'foreign', tenantId: 'other' }]) context.handleNewMessage(foreign);
  assert.equal(cursor(), 'm1');
  assert.equal(context.sounds, 1);
  context.token.value = 'b';
  context.handleNewMessage({ ...msg, _id: 'stale' });
  assert.equal(cursor(), 'm1');
  context.token.value = 'a'; context.sessionActive = false;
  context.handleNewMessage({ ...msg, _id: 'unmounted' });
  assert.equal(cursor(), 'm1');
});

test('read and summary interleavings never overwrite message-derived unread facts', async () => {
  let rows = [{ tenantId: 't', conversationId: 'c', senderType: 'customer', readByAgent: false }];
  let afterRead = () => {}, afterAggregate = () => {};
  const model = {
    find: filter => ({ cast: () => filter }),
    aggregate: async pipeline => {
      const scope = pipeline[0].$match;
      const evaluate = (expr, row) => {
        if (typeof expr === 'string' && expr.startsWith('$')) return row[expr.slice(1)];
        if (Array.isArray(expr)) return expr.map(x => evaluate(x, row));
        if (!expr || typeof expr !== 'object') return expr;
        const [op, args] = Object.entries(expr)[0]; const values = evaluate(args, row);
        if (op === '$eq') return values[0] === values[1];
        if (op === '$in') return values[1].includes(values[0]);
        if (op === '$and') return values.every(Boolean);
        if (op === '$ifNull') return values[0] ?? values[1];
        if (op === '$cond') return values[0] ? values[1] : values[2];
        throw Error(op);
      };
      const counts = {};
      for (const key of ['agentUnreadCount', 'customerUnreadCount']) counts[key] = rows.filter(r => Object.entries(scope).every(([k,v]) => r[k] === v)).reduce((n,r) => n + evaluate(pipeline[1].$group[key].$sum, r), 0);
      await afterAggregate(); return [counts];
    },
    findOne: () => ({ sort: async () => null }),
    updateMany: async filter => { rows.filter(r => Object.entries(filter).every(([k,v]) => r[k] === v)).forEach(r => { r.readByAgent = true; }); await afterRead(); },
  };
  const service = loadModule('src/services/conversationUnreadService.js', { '../models/Message': model }).module.exports;
  const controller = loadModule('src/controllers/ChatController.js', { '../models/Message': model, '../services/conversationUnreadService': service });
  const conv = { _id: 'c', tenantId: 't', save: () => { throw Error('snapshot write'); } };
  const incoming = () => rows.push({ tenantId: 't', conversationId: 'c', senderType: 'customer', readByAgent: false });
  afterRead = async () => { incoming(); afterRead = () => {}; };
  await controller.markAgentConversationRead({ user: { role: 'owner' }, tenantId: 't' }, conv);
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 1);
  afterAggregate = async () => { incoming(); afterAggregate = () => {}; };
  await controller.refreshConversationSummary(conv);
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 2);
  for (let i = 0; i < 2; i++) await controller.markAgentConversationRead({ user: { role: 'owner' }, tenantId: 't' }, conv);
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 0);
  rows.push({ tenantId: 'other', conversationId: 'c', senderType: 'customer', readByAgent: false });
  rows.push({ tenantId: 't', conversationId: 'c', senderType: 'customer', readByAgent: false, deletedForAgentAt: new Date() });
  rows.push({ tenantId: 't', conversationId: 'c', senderType: 'bot', readByCustomer: false, recalledAt: new Date(), attachmentStatus: 'expired' });
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 0);
  assert.equal((await service.conversationUnread(conv)).customerUnreadCount, 1);
});
const Message = require('./src/models/Message');
const Tenant = require('./src/models/Tenant');
const cache = require('./src/utils/cache');
const { error } = require('./src/utils');
const validators = require('./src/middleware/validators');
const { validationResult } = require('express-validator');

test('all backend JavaScript parses', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
  for (const file of [path.join(__dirname, 'app.js'), ...walk(path.join(__dirname, 'src'))]) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test('attachment URLs work on aggregation objects and model JSON', () => {
  for (const type of ['image', 'video', 'file']) {
    const result = Message.applyAttachmentUrls({ attachmentId: 'abc', attachmentStatus: 'active', messageType: type });
    assert.equal(result.attachmentUrl, '/api/files/abc');
    assert.equal(result.thumbnailUrl, type === 'file' ? '' : '/api/files/abc/thumbnail');
  }
  const expired = Message.applyAttachmentUrls({ attachmentId: 'abc', attachmentStatus: 'active', attachmentExpiredAt: new Date(0) });
  assert.equal(expired.attachmentStatus, 'expired');
  assert.equal(expired.attachmentUrl, '');
  assert.equal(new Message({ attachmentId: '000000000000000000000001', attachmentStatus: 'recalled' }).toJSON().attachmentUrl, '');
});

test('HTTP status defaults preserve business codes and explicit overrides', () => {
  for (const [code, override, expected] of [[404, undefined, 404], [403, undefined, 403], [401, undefined, 401], [4004, undefined, 400], [1, undefined, 400], [403, 409, 409]]) {
    const res = { locals: {}, status(value) { this.http = value; return this; }, json(value) { this.body = value; return this; } };
    error(res, 'test', code, override);
    assert.equal(res.http, expected);
    assert.equal(res.body.code, code);
  }
});

test('matching consumption is single-use and wrong/expired hashes do not succeed', async () => {
  await cache.setJson('test:single', { codeHash: 'right' }, 10);
  assert.equal(await cache.consumeMatchingJson('test:single', 'wrong'), false);
  const results = await Promise.all(Array.from({ length: 30 }, () => cache.consumeMatchingJson('test:single', 'right')));
  assert.equal(results.filter(Boolean).length, 1);
  await cache.setJson('test:expired', { codeHash: 'right' }, -1);
  assert.equal(await cache.consumeMatchingJson('test:expired', 'right'), false);
});

test('plan model rejects fractions, negative and unsafe values while accepting zero', () => {
  for (const field of ['agentLimit', 'channelLimit', 'messageRetentionDays', 'attachmentLimitMB']) {
    for (const value of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const tenant = new Tenant({ plan: { [field]: value } });
      assert.ok(tenant.validateSync()?.errors['plan.' + field]);
    }
    assert.equal(new Tenant({ plan: { [field]: 0 } }).validateSync()?.errors['plan.' + field], undefined);
  }
});

async function valid(name, body) {
  const req = { body };
  for (const chain of validators[name].slice(0, -1)) await chain.run(req);
  return validationResult(req).isEmpty();
}
test('employee and reply PATCH validation rejects coerced types and invalid bounds', async () => {
  assert.equal(await valid('updateAgent', {}), true);
  for (const body of [{ username: [] }, { username: 'ab' }, { displayName: ' ' }, { role: 'owner' }, { status: 'trial' }]) assert.equal(await valid('updateAgent', body), false);
  assert.equal(await valid('createAgent', { username: 'agent', displayName: 'Agent', password: '123456' }), true);
  assert.equal(await valid('updateKeywordReply', { status: 'disabled' }), true);
  assert.equal(await valid('updateKeywordReply', { matchType: 'regex' }), false);
  assert.equal(await valid('updateQuickReply', { content: 'a'.repeat(501) }), false);
  assert.equal(await valid('updateQuickReply', { sortOrder: '1' }), false);
});

test('tenant cache tolerates malformed JSON and never falls back while isolated', () => {
  const source = fs.readFileSync(path.join(__dirname, '../user-web/src/api.js'), 'utf8');
  const helper = source.slice(source.indexOf('export function readTenantCache'), source.indexOf('export function clearTenantSession')).replace('export function', 'function');
  const session = new Map();
  const local = new Map([['tenant_user', JSON.stringify({ role: 'owner' })]]);
  const context = vm.createContext({ sessionStorage: { getItem: key => session.get(key) }, localStorage: { getItem: key => local.get(key) } });
  vm.runInContext(helper, context);
  assert.equal(context.readTenantCache('tenant_user').role, 'owner');
  session.set('tenant_user', '{broken');
  assert.equal(context.readTenantCache('tenant_user'), null);
  session.delete('tenant_user');
  session.set('tenant_impersonation', '1');
  assert.equal(context.readTenantCache('tenant_user'), null);
});

// 执行实际模块，仅替换数据库、网络等边界；内部函数只在测试 VM 中暴露。
function loadModule(relative, mocks, expose = '') {
  const filename = path.join(__dirname, relative);
  const nativeRequire = require('node:module').createRequire(filename);
  const context = vm.createContext({
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name),
    module: { exports: {} }, console, Buffer, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8') + '\n' + expose, context, { filename });
  return context;
}

function query(value) {
  return { select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

 test('summary refresh only emits message.new for explicitly new agent/bot messages', async () => {
  const events = [];
  const context = loadModule('src/controllers/ChatController.js', {
    '../services/conversationUnreadService': { conversationUnread: async () => ({ customerUnreadCount: 0 }) },
    '../models/Customer': { findOne: () => query({ accountId: 'account' }) },
    '../models/Channel': { findOne: () => query({ _id: 'channel', publicToken: 'public' }) },
  });
  context.setIO({ to: room => ({ emit: (event, data) => events.push({ room, event, data }) }) });
  const conv = { _id: 'conv', customerId: 'binding', channelId: 'channel', tenantId: 'tenant' };
  for (const senderType of ['agent', 'bot', 'customer', 'system']) {
    for (const notify of [undefined, false, true]) {
      events.length = 0;
      await context.broadcastCustomerChannelSummary(conv, { lastMessage: { _id: 'message', senderType } }, notify);
      assert.equal(events.filter(e => e.event === 'channel-history.updated').length, 1);
      assert.equal(events.filter(e => e.event === 'message.new').length, notify === true && ['agent', 'bot'].includes(senderType) ? 1 : 0);
      assert.ok(events.every(e => e.room === 'customer-account-account'));
    }
  }
  events.length = 0;
  await context.broadcastCustomerChannelSummary(conv, {}, true);
  assert.equal(events.filter(e => e.event === 'message.new').length, 0);
});

 test('impersonation 401 then each real logout preserves isolation and administrator storage', async () => {
  for (const [file, fn] of [['Layout.vue', 'logout'], ['MobileLayout.vue', 'logout'], ['mobile/Profile.vue', 'doLogout']]) {
    const local = new Map([['tenant_token', 'original-admin'], ['tenant_user', '{"role":"owner"}'], ['tenant_info', '{"id":"tenant"}']]);
    const before = [...local];
    const session = new Map([['tenant_impersonation', '1'], ['tenant_token', 'impersonated'], ['tenant_user', '{"role":"agent"}']]);
    const storage = map => ({ getItem: key => map.get(key) ?? null, removeItem: key => map.delete(key), setItem: (key, value) => map.set(key, value) });
    let request, rejectResponse;
    const context = vm.createContext({
      sessionStorage: storage(session), localStorage: storage(local), URL,
      window: { location: { origin: 'https://example.test' } },
      axios: { create: () => ({ interceptors: { request: { use: fn => { request = fn; } }, response: { use: (_, fn) => { rejectResponse = fn; } } } }) },
      showLogoutConfirm: { value: true }, tenantIdentityScope: () => 'isolated', clearIdentityCache: async () => {},
      router: { push() {}, replace() {} },
    });
    const source = fs.readFileSync(path.join(__dirname, '../user-web/src/api.js'), 'utf8')
      .replace("import axios from 'axios'", '').replaceAll('export function ', 'function ').replace('export default api', '');
    vm.runInContext(source, context);
    assert.equal(request({ url: '/tenant/auth/me', baseURL: '/api', headers: {} }).headers.Authorization, 'Bearer impersonated');
    await assert.rejects(rejectResponse({ response: { status: 401, data: { message: 'expired' } } }));
    const view = fs.readFileSync(path.join(__dirname, '../user-web/src/views', file), 'utf8');
    const logout = view.match(new RegExp('async function ' + fn + '\\(\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(logout, file);
    vm.runInContext(logout[0], context);
    await context[fn]();
    await context[fn]();
    assert.equal(context.readTenantCache('tenant_user'), null);
    assert.equal(context.readTenantCache('tenant_info'), null);
    assert.equal(request({ url: '/tenant/auth/me', baseURL: '/api', headers: {} }).headers.Authorization, undefined);
    assert.equal(session.get('tenant_impersonation'), '1');
    assert.deepEqual([...local], before);
  }
});

 test('legacy JWT and resolver reject guest and mismatched global credentials including duplicate-key races', async () => {
  for (const mode of ['guest', 'guest-binding', 'mismatch', 'race', 'match', 'create']) {
    for (const target of ['middleware', 'resolver']) {
      let saves = 0, creates = 0, lookups = 0, nextCalls = 0;
      const payload = { type: 'customer', id: 'binding', tenantId: 'tenant', channelId: 'channel', ...(mode === 'guest' ? { identity: 'guest' } : {}) };
      const binding = { _id: 'binding', tenantId: 'tenant', channelId: 'channel', identityType: mode === 'guest-binding' || mode === 'guest' ? 'guest' : 'customer', status: 'active', blocked: false, phone: 'test-phone', password: 'old-hash', save: async () => { saves++; } };
      const account = { _id: 'account', status: 'active', password: ['match', 'create'].includes(mode) ? 'old-hash' : 'other-hash' };
      const customerModel = {
        findById: async () => binding,
        findOne: filter => query(Object.entries(filter).every(([key, value]) => value === null ? binding[key] == null : binding[key] === value) ? binding : null),
      };
      const accountModel = {
        findOne: filter => {
          lookups++;
          if (filter.phone && (mode === 'create' || mode === 'race') && lookups === 1) return query(null);
          return query(account);
        },
        create: async data => { creates++; if (mode === 'race') throw Object.assign(new Error('duplicate'), { code: 11000 }); return { ...data, _id: 'account' }; },
      };
      const mocks = { '../models/Customer': customerModel, '../models/CustomerAccount': accountModel };
      if (target === 'middleware') mocks['../utils'] = { ...require('./src/utils'), verifyToken: () => payload };
      const context = loadModule(target === 'middleware' ? 'src/middleware/auth.js' : 'src/controllers/CustomerAuthController.js', mocks);
      if (target === 'middleware') {
        const res = { locals: {}, status(code) { this.http = code; return this; }, json(body) { this.body = body; return this; } };
        await context.authCustomer({ headers: { authorization: 'Bearer test' } }, res, () => { nextCalls++; });
        assert.equal(nextCalls, ['guest', 'match', 'create'].includes(mode) ? 1 : 0, `${target}/${mode}`);
        if (['mismatch', 'race'].includes(mode)) assert.equal(res.http, 401);
      } else {
        const result = await context.resolveAccount(payload);
        assert.equal(Boolean(result), ['match', 'create'].includes(mode), `${target}/${mode}`);
      }
      assert.equal(saves, ['match', 'create'].includes(mode) ? 1 : 0, `${target}/${mode} saves`);
      if (['guest', 'guest-binding'].includes(mode)) {
        assert.equal(lookups, target === 'middleware' && mode === 'guest-binding' ? 1 : 0);
        assert.equal(creates, 0);
      }
    }
  }
});
