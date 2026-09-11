// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { messageBody, messageHistory } = require('./src/middleware/messageParameters');
const id = '0123456789abcdef01234567';
function invoke(middleware, req) {
  let passed = false;
  const res = { locals: { requestId: 'test-request' }, status(code) { this.http = code; return this; }, json(body) { this.body = body; return this; } };
  middleware(req, res, () => { passed = true; });
  return { passed, res };
}
test('message body rejects malformed types without throwing or forwarding', () => {
  for (const body of [null, [], { clientMessageId: 123 }, { clientMessageId: '' }, { clientMessageId: 'a'.repeat(129) }, ...['content', 'messageType', 'attachmentUrl', 'attachmentName', 'thumbnailUrl'].flatMap(field => [null, [], {}, 42, false].map(value => ({ clientMessageId: 'a', [field]: value }))), { clientMessageId: 'a', attachmentId: 'bad' }]) {
    const result = invoke(messageBody, { body });
    assert.equal(result.passed, false);
    assert.equal(result.res.http, 400);
    assert.equal(result.res.body.code, 4001);
    assert.equal(result.res.body.requestId, 'test-request');
  }
});
test('message body preserves valid media, unknown fields and legacy type fallback', () => {
  for (const body of [{ clientMessageId: 'a', content: 'hello', extra: true }, { clientMessageId: 'a'.repeat(128), content: '', messageType: 'image', attachmentId: id }, { clientMessageId: 'a', content: 'hello', messageType: 'legacy' }]) {
    const before = JSON.stringify(body);
    assert.equal(invoke(messageBody, { body }).passed, true);
    assert.equal(JSON.stringify(body), before);
  }
});
for (const modes of [['before', 'around'], ['before', 'after'], ['before', 'after', 'around']]) {
  test('history validates modes and positive safe limit: ' + modes.join(','), () => {
    const middleware = messageHistory(modes);
    for (const query of [{}, { limit: '1' }, { limit: '500' }, ...modes.map(mode => ({ [mode]: id, limit: '50' }))]) assert.equal(invoke(middleware, { query }).passed, true);
    for (const query of [{ before: id, after: id }, { before: id, around: id }, { before: '' }, { before: [id] }, { before: 'bad' }, ...['0', '-1', '1.5', '1abc', '', '9007199254740992'].map(limit => ({ limit })), { limit: ['50'] }, ...['before', 'after', 'around'].filter(mode => !modes.includes(mode)).map(mode => ({ [mode]: id }))]) {
      const result = invoke(middleware, { query });
      assert.equal(result.passed, false);
      assert.equal(result.res.http, 400);
    }
  });
}
test('all five message routes install validation after authentication', () => {
  for (const [file, expected] of [['admin', 1], ['tenant', 2], ['client', 2]]) {
    const source = fs.readFileSync(path.join(__dirname, 'src/routes', file + '.js'), 'utf8');
    const installed = source.split('\n').filter(line => /^router\.(get|post)\(/.test(line) && /auth\w+, message(?:Body|History)/.test(line));
    assert.equal(installed.length, expected);
  }
});
test('document method/path inventory matches every mounted HTTP route', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const mounts = { admin: '/api/admin', tenant: '/api/tenant', client: '/api/client', app: '/api/app', upload: '/api/upload', complaintUpload: '/api/upload/complaint', files: '/api/files' };
  const routes = new Set(['GET /api/health']);
  for (const [file, prefix] of Object.entries(mounts)) {
    assert.ok(app.includes("app.use('" + prefix + "'"));
    const source = fs.readFileSync(path.join(__dirname, 'src/routes', file + '.js'), 'utf8');
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) routes.add(match[1].toUpperCase() + ' ' + prefix + (match[2] === '/' ? '' : match[2]));
  }
  const document = fs.readFileSync(path.join(root, 'API_PARAMETER_SPEC.md'), 'utf8');
  const documented = new Set([...document.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) (\/api\/[^ |]+) \|/gm)].map(match => match[1] + ' ' + match[2]));
  assert.deepEqual([...documented].sort(), [...routes].sort());
});
