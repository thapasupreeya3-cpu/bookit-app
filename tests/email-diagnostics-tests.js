'use strict';
// Real application routes and a disposable database. Every transport request
// goes to the local synthetic Resend server; external networking is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-email-diagnostics-'));
const results = [], requests = [], password = 'Copper-Rainstorm!82';
const resendKey = 're_synthetic_diagnostics_secret', smtpPassword = 'synthetic_smtp_password_37';
let child, db, base, transport, transportBase, rejectTransport = true, log = '', owner, other, admin, demo, testId;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function req(method, url, person, body) {
  const r = await fetch(base + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(person?.cookie ? { Cookie: person.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
function ok(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.data) || r.text.slice(0, 300)); return r.data; }
async function test(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }); console.log('PASS ' + name); } catch (error) { results.push({ name, result: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ': ' + error.stack); } }
async function waitFor(fn, milliseconds = 20000) {
  const until = Date.now() + milliseconds;
  do { const value = await fn(); if (value) return value; await delay(100); } while (Date.now() < until);
  throw Error('Synthetic message did not reach the expected state before the background-job deadline.');
}
async function freePort() { const s = http.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
const delivery = id => db.prepare('SELECT * FROM delivery_outbox WHERE id=?').get(id);
async function signIn(person, secret = password) { const r = await req('POST', '/api/login', null, { email: person.email, password: secret }); ok(r); person.cookie = r.cookie; return person; }
async function register(label) {
  const email = 'email-diagnostics-' + label + '@example.test';
  const terms = /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'))[1];
  const r = await req('POST', '/api/register', null, { role: 'participant', name: 'Synthetic mail ' + label, email, password, suburb: 'Ryde NSW', plan: 'private', terms_accepted: true, terms_version: terms });
  return { id: ok(r).user.id, email, cookie: r.cookie };
}
function assertSafe(value) {
  const encoded = JSON.stringify(value);
  for (const secret of [resendKey, smtpPassword, 'synthetic_smtp_username', 'PRIVATE-RESET-TOKEN-ONLY-IN-PAYLOAD', 'PRIVATE-BODY-ONLY-IN-PAYLOAD']) assert.ok(!encoded.includes(secret), 'A mail credential or private payload escaped into diagnostics');
  const visit = obj => { if (!obj || typeof obj !== 'object') return; for (const [key, entry] of Object.entries(obj)) { assert.ok(!['payload', 'access_stamp', 'smtp_password', 'smtp_pass', 'resend_api_key', 'auth_key', 'authorization'].includes(key.toLowerCase()), 'Private diagnostics field: ' + key); visit(entry); } };
  visit(value);
}
async function stop() { if (!child || child.exitCode !== null) return; const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
async function start(extra = {}) {
  await stop();
  const port = await freePort(); base = 'http://127.0.0.1:' + port;
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', MAIL_FROM: 'office@example.test', TZ: 'Australia/Sydney', ...extra };
  child = spawn(process.execPath, ['--no-warnings', '--require', path.join(DIR, 'loopback-only.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  await waitFor(async () => { if (child.exitCode !== null) throw Error(log.slice(-4000)); try { return (await fetch(base + '/api/version')).ok; } catch { return false; } }, 10000);
}
async function main() {
  fs.writeFileSync(path.join(DIR, 'loopback-only.js'), `'use strict';
const local = value => { const h = typeof value === 'string' || value instanceof URL ? new URL(value).hostname : (value.hostname || value.host || ''); if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h)) throw Error('Synthetic email diagnostics test blocks external network'); };
for (const name of ['node:http', 'node:https']) { const m = require(name), request = m.request, get = m.get; m.request = function(...args) { local(args[0]); return request.apply(this,args); }; m.get = function(...args) { local(args[0]); return get.apply(this,args); }; }
const tls = require('node:tls'), connect = tls.connect; tls.connect = function(...args) { local(typeof args[0] === 'object' ? args[0] : {host: args[1]}); return connect.apply(this,args); };
const request = global.fetch; global.fetch = function(input, ...args) { local(typeof input === 'string' || input instanceof URL ? input : input.url); return request.call(this,input,...args); };
`);
  transport = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    let payload; try { payload = JSON.parse(Buffer.concat(parts)); } catch {}
    requests.push({ method: req.method, url: req.url, headers: req.headers, payload, rejected: rejectTransport });
    res.writeHead(rejectTransport ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rejectTransport ? { message: 'Synthetic provider temporarily unavailable' } : { id: 'synthetic-provider-message-' + requests.length }));
  });
  await new Promise(resolve => transport.listen(0, '127.0.0.1', resolve)); transportBase = 'http://127.0.0.1:' + transport.address().port;
  await start(); db = new DatabaseSync(path.join(DIR, 'test.db')); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); other = await register('other');
  db.prepare('UPDATE users SET is_admin=1,verified=1 WHERE id=?').run(owner.id); admin = await signIn({ ...owner });
  db.prepare('UPDATE users SET verified=1 WHERE id=?').run(other.id);
  demo = { id: 10, email: db.prepare('SELECT email FROM users WHERE id=10').get().email }; await signIn(demo, 'demo1234');
  await test('Only office accounts can read delivery diagnostics, and email testing requires sign-in', async () => {
    ok(await req('GET', '/api/admin/deliveries'), 403);
    ok(await req('GET', '/api/admin/deliveries', other), 403);
    ok(await req('POST', '/api/email-test', null, {}), 401);
    ok(await req('GET', '/api/email-test/1'), 401);
  });
  await test('Disabled email shows missing configuration and cannot claim a test message was sent', async () => {
    const info = ok(await req('GET', '/api/admin/deliveries', admin));
    assert.equal(info.email_enabled, false); assert.equal(info.connection.configured, false);
    assert.equal(info.connection.from, 'office@example.test'); assert.equal(info.connection.account_email, owner.email);
    assertSafe(info);
    const before = db.prepare('SELECT count(*) n FROM delivery_outbox').get().n;
    const result = ok(await req('POST', '/api/email-test', owner, {}));
    assert.equal(result.ok, false); assert.match(JSON.stringify(result), /not.configured|configuration|configure/i);
    assert.equal(result.sent_to, undefined); assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox').get().n, before); assert.equal(requests.length, 0);
  });
  // Cancel registration mail so that the only transport requests below are the
  // explicit diagnostic tests, even though registration was performed offline.
  db.exec("UPDATE delivery_outbox SET status='cancelled',payload='[]' WHERE status IN ('queued','retry')");
  await start({ RESEND_API_KEY: resendKey, RESEND_BASE: transportBase, SMTP_USER: 'synthetic_smtp_username', SMTP_PASS: smtpPassword });
  await signIn(owner); await signIn(other); await signIn(admin); await signIn(demo, 'demo1234');
  await test('Configured diagnostics identify the sender and provider without exposing credentials', async () => {
    const info = ok(await req('GET', '/api/admin/deliveries', admin));
    assert.equal(info.email_enabled, true); assert.equal(info.connection.configured, true); assert.match(info.connection.provider, /resend/i);
    assert.equal(info.connection.from, 'office@example.test'); assert.equal(info.connection.account_email, owner.email);
    for (const key of ['reply_to', 'smtp_host', 'smtp_port', 'last_accepted_at']) assert.ok(Object.hasOwn(info.connection, key), 'Missing connection field ' + key);
    assert.ok(info.summary && typeof info.summary === 'object'); assertSafe(info);
  });
  await test('A diagnostic message queues to the signed-in account and ignores a supplied recipient', async () => {
    const result = ok(await req('POST', '/api/email-test', owner, { email: other.email, to: other.email, recipient: other.email }));
    assert.equal(result.ok, true); assert.equal(result.status, 'queued'); assert.equal(result.queued_to, owner.email); assert.ok(Number.isInteger(result.delivery_id));
    assert.match(result.via, /resend/i); assert.ok(result.message); assert.equal(result.sent_to, undefined); assertSafe(result);
    testId = result.delivery_id; const row = delivery(testId); assert.equal(row.recipient, owner.email); assert.equal(row.user_id, owner.id);
    assert.ok(row.subject); assert.ok(row.heading); assert.ok(row.expires_at);
    const own = ok(await req('GET', '/api/email-test/' + testId, owner)); assert.ok(['queued', 'sending', 'retry'].includes(own.state)); assertSafe(own);
  });
  await test('A test event cannot be read by another account or through a forged identifier', async () => {
    ok(await req('GET', '/api/email-test/' + testId, other), 404);
    ok(await req('GET', '/api/email-test/987654321', owner), 404);
    const unrelated = db.prepare("SELECT id FROM delivery_outbox WHERE id<>? LIMIT 1").get(testId); assert.ok(unrelated);
    ok(await req('GET', '/api/email-test/' + unrelated.id, owner), 404);
    ok(await req('POST', '/api/email-test', demo, {}), 400);
  });
  await test('Provider rejection becomes a visible retry with no acceptance or delivery claim', async () => {
    await waitFor(() => delivery(testId)?.status === 'retry');
    const state = ok(await req('GET', '/api/email-test/' + testId, owner)); assert.equal(state.state, 'retry'); assert.match(state.error, /temporarily unavailable/);
    const item = ok(await req('GET', '/api/admin/deliveries', admin)).rows.find(r => r.id === testId); assert.equal(item.status, 'retry'); assert.equal(item.sent_at, null); assert.notEqual(item.delivery_result, 'delivered'); assert.match(item.error, /temporarily unavailable/); assertSafe(item);
    assert.equal(requests.length, 1); assert.equal(requests[0].url, '/emails'); assert.deepEqual(requests[0].payload.to, [owner.email]); assert.equal(requests[0].rejected, true);
  });
  await test('The queued-message audit exposes safe labels and omits private body content and links', async () => {
    const row = delivery(testId), payload = JSON.parse(row.payload); payload[3] += '<p>PRIVATE-BODY-ONLY-IN-PAYLOAD</p>'; payload[5] = base + '/reset?token=PRIVATE-RESET-TOKEN-ONLY-IN-PAYLOAD';
    db.prepare('UPDATE delivery_outbox SET payload=? WHERE id=?').run(JSON.stringify(payload), testId);
    const info = ok(await req('GET', '/api/admin/deliveries', admin)), item = info.rows.find(r => r.id === testId);
    assert.equal(item.subject, row.subject); assert.equal(item.heading, row.heading); assert.equal(item.user_name, 'Synthetic mail owner');
    for (const key of ['booking_id', 'event_kind', 'delivery_result', 'delivery_evidence', 'delivery_checked_at']) assert.ok(Object.hasOwn(item, key), 'Missing safe audit field ' + key);
    assertSafe(info); assertSafe(ok(await req('GET', '/api/email-test/' + testId, owner)));
  });
  await test('Retry can recover through the real transport while acceptance stays distinct from inbox delivery', async () => {
    const before = delivery(testId); rejectTransport = false;
    ok(await req('POST', '/api/admin/deliveries/' + testId + '/retry', admin, {}));
    await waitFor(() => delivery(testId)?.status === 'sent');
    const row = delivery(testId); assert.equal(row.payload, '[]'); assert.equal(row.subject, before.subject); assert.equal(row.heading, before.heading); assert.ok(row.sent_at); assert.notEqual(row.delivery_result, 'delivered');
    const state = ok(await req('GET', '/api/email-test/' + testId, owner)); assert.equal(state.state, 'sent'); assertSafe(state);
    const info = ok(await req('GET', '/api/admin/deliveries', admin)), item = info.rows.find(r => r.id === testId);
    assert.equal(item.status, 'sent'); assert.equal(item.subject, before.subject); assert.equal(item.heading, before.heading); assert.equal(info.connection.last_accepted_at, row.sent_at); assert.notEqual(item.delivery_result, 'delivered'); assertSafe(info);
    assert.equal(requests.length, 2); assert.deepEqual(requests[1].payload.to, [owner.email]); assert.equal(requests[1].rejected, false);
    ok(await req('POST', '/api/admin/deliveries/' + testId + '/retry', admin, {}), 400);
  });
  await test('Recorded bounce evidence is visible to the office and overrides the own-account test state', async () => {
    const evidence = 'Synthetic provider event local-bounce-0001: mailbox refused the test.';
    ok(await req('POST', '/api/admin/assurance/mail-result', admin, { id: testId, status: 'bounced', evidence, confirm: true }));
    const state = ok(await req('GET', '/api/email-test/' + testId, owner)); assert.equal(state.state, 'bounced'); assertSafe(state);
    const info = ok(await req('GET', '/api/admin/deliveries', admin)), item = info.rows.find(r => r.id === testId);
    assert.equal(item.status, 'bounced'); assert.equal(item.delivery_result, 'bounced'); assert.equal(item.delivery_evidence, evidence); assert.ok(item.delivery_checked_at); assertSafe(info);
    ok(await req('GET', '/api/email-test/' + testId, other), 404);
  });
  await start({ SMTP_USER: 'synthetic_smtp_username', SMTP_PASS: smtpPassword, SMTP_HOST: '127.0.0.1', SMTP_PORT: '2465' }); await signIn(admin);
  await test('SMTP diagnostics retain useful host settings and never reveal SMTP credentials', async () => {
    const info = ok(await req('GET', '/api/admin/deliveries', admin));
    assert.equal(info.connection.configured, true); assert.match(info.connection.provider, /smtp/i); assert.equal(info.connection.smtp_host, '127.0.0.1'); assert.equal(info.connection.smtp_port, 2465); assertSafe(info); assert.equal(requests.length, 2);
    const item = info.rows.find(r => r.id === testId); assert.equal(item.delivery_result, 'bounced'); assert.ok(item.subject); assert.equal(delivery(testId).payload, '[]');
  });
}
main().catch(error => { console.error(error); results.push({ name: 'HTTP fixture', result: 'FAIL', error: error.stack }); }).finally(async () => {
  await stop(); if (db) db.close(); if (transport) await new Promise(resolve => transport.close(resolve));
  if (process.env.EMAIL_DIAGNOSTICS_RESULTS) fs.writeFileSync(process.env.EMAIL_DIAGNOSTICS_RESULTS, JSON.stringify({ runtime: process.version, scope: 'Disposable synthetic identities and local Resend transport; external network blocked', results, requests: requests.map(r => ({ method: r.method, url: r.url, recipient: r.payload?.to, rejected: r.rejected })), serverLog: log }, null, 2));
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`Email diagnostics: ${results.filter(r => r.result === 'PASS').length}/${results.length} passed`); if (results.some(r => r.result === 'FAIL')) process.exitCode = 1;
});
