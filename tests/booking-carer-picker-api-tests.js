'use strict';
// Exercise the actual authenticated picker route with disposable SQLite data.
// A fixed clock and loopback-only preload prevent real integrations or messages.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-picker-http-'));
const NOW = '2030-01-01T00:00:00.000Z', DATE = '2030-01-07', password = 'Copper-Rainstorm!82', results = [];
const home = { street: '41 Synthetic Private Lane', suburb: 'Ryde', state: 'NSW', postcode: '2112', arrival_notes: 'Synthetic private entrance instruction.' };
let child, db, base, serverEnv, log = '', owner, other, helper, demoWorker, linkId;
const workers = {};
const ins = (table, values) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
const update = (table, key, id, values) => db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(k => k + '=?').join(',')} WHERE ${key}=?`).run(...Object.values(values), id);
async function request(method, url, person, body, forId) {
  const r = await fetch(base + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(person?.cookie ? { Cookie: person.cookie } : {}), ...(forId ? { 'X-Bookit-For': String(forId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
function ok(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.data) || r.text.slice(0, 200)); return r.data; }
const picker = (query = {}, person = owner, forId) => request('GET', '/api/bookings/carers?' + new URLSearchParams({ date: DATE, ...query }), person, undefined, forId);
const ids = data => data.workers.map(w => w.id);
async function test(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }); console.log('PASS ' + name); } catch (error) { results.push({ name, result: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ' ' + error.stack); } }
async function register(label, suburb = 'Ryde NSW') {
  const email = 'picker-' + label + '@example.test';
  const r = await request('POST', '/api/register', null, { role: 'participant', email, name: 'Synthetic picker ' + label, password, suburb, plan: 'private', terms_accepted: true, terms_version: /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'))[1] });
  return { id: ok(r).user.id, cookie: r.cookie, email };
}
function makeWorker(label, suburb = 'Ryde NSW', areas = ['Ryde NSW']) {
  const source = db.prepare('SELECT * FROM users WHERE id=10').get();
  const id = ins('users', { role: 'worker', name: 'Synthetic ' + label, email: 'picker-worker-' + label + '@example.test', pass: source.pass, suburb, phone: 'PRIVATE-WORKER-PHONE-' + label, created: NOW, verified: 1 });
  ins('worker_profiles', { user_id: id, visible: 1, services: '["daily-tasks","personal-care"]', days: '[1,1,1,1,1,1,1]', service_areas: JSON.stringify(areas), leave_dates: '[]', availability_windows: null,
    screening_status: 'clear', screening_status_at: NOW, screening_ref: 'PRIVATE-SCREENING-' + label, screening_source: 'Synthetic evidence',
    banning_result: 'clear', banning_checked_at: NOW, banning_aged_result: 'clear', banning_aged_at: NOW, banning_acqsc_result: 'clear', banning_acqsc_at: NOW,
    banning_note: 'PRIVATE-BANNING-NOTE-' + label, gender: 'female', interests: '["Music"]', langs: 'English, Nepali' });
  for (const type of ['ndis-screening', 'cpr']) ins('worker_docs', { worker_id: id, doc_type: type, expiry_date: '2031-01-01', uploaded_at: NOW, verified_at: NOW, verified_by: 'Synthetic reviewer', review_state: 'approved', check_number: 'PRIVATE-CHECK-' + label, file_path: '/private/synthetic-' + label });
  for (const module of db.prepare('SELECT * FROM modules WHERE active=1 AND required=1').all()) ins('module_completions', { module_id: module.id, module_key: module.key, worker_id: id, score: 100, passed: 1, attempts: 1, completed_at: NOW, expires_at: '2031-01-01' });
  workers[label] = id;
  return id;
}
function booking(workerId, values = {}) { return ins('bookings', { participant_id: owner.id, worker_id: workerId, service: 'daily-tasks', date: '2029-12-20', start: '10:00', hours: 2, status: 'completed', created: '2029-10-01T00:00:00Z', ...values }); }
function privateAbsent(data) {
  const value = JSON.stringify(data);
  for (const secret of [home.street, home.arrival_notes, 'PRIVATE-', '/private/synthetic-', owner.email, other.email]) assert.ok(!value.includes(secret), 'Private data appeared: ' + secret);
  for (const worker of data.workers) for (const field of ['email', 'phone', 'pass', 'screening_ref', 'check_number', 'file_path', 'leave_dates', 'availability_windows', 'platform_block_reason', 'banning_note', 'note', 'notes']) assert.equal(Object.hasOwn(worker, field), false, 'Private field appeared: ' + field);
}
async function main() {
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); base = 'http://127.0.0.1:' + port;
  const guard = path.join(DIR, 'loopback-only.js');
  fs.writeFileSync(guard, `'use strict';
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic picker test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
const NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['${NOW}']));}static now(){return NativeDate.parse('${NOW}');}};
`);
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', TZ: 'Australia/Sydney' };
  serverEnv = env;
  child = spawn(process.execPath, ['--no-warnings', '--require', guard, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error(log); try { if ((await fetch(base + '/api/version')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  db = new DatabaseSync(env.DB_PATH); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); other = await register('other'); helper = await register('helper');
  update('users', 'id', helper.id, { role: 'coordinator', verified: 1 });
  linkId = ins('account_links', { participant_id: owner.id, coordinator_id: helper.id, invite_email: helper.email, invite_token: 'synthetic-picker-link', scopes: '["bookings"]', status: 'active', invited_at: NOW });
  const demoLogin = await request('POST', '/api/login', null, { email: db.prepare('SELECT email FROM users WHERE id=10').get().email, password: 'demo1234' }); ok(demoLogin); demoWorker = { id: 10, cookie: demoLogin.cookie };
  makeWorker('recentNew', 'Parramatta NSW', ['Parramatta NSW']); makeWorker('recentOld'); makeWorker('historyLatest'); makeWorker('historyOlder'); makeWorker('areaLocal'); makeWorker('areaOther', 'Parramatta NSW', ['Parramatta NSW']); makeWorker('otherOnly', 'Wollongong NSW', ['Wollongong NSW']); makeWorker('profileFallback', 'Ryde NSW', []); makeWorker('stateMismatch', 'Ryde VIC', ['Ryde VIC']); makeWorker('postcodeOnly', 'Sydney NSW', ['2112']); makeWorker('postcodeMismatch', 'Ryde NSW', ['Ryde NSW 2113']);
  ins('participant_workers', { participant_id: owner.id, worker_id: workers.recentOld, relation: 'saved', added: '2029-11-01T00:00:00Z', note: 'PRIVATE-RELATIONSHIP-NOTE' });
  ins('care_web', { participant_id: owner.id, worker_id: workers.recentNew, rank: 1, role: 'regular', added_at: '2029-12-30T00:00:00Z', note: 'PRIVATE-WEB-NOTE' });
  ins('participant_workers', { participant_id: other.id, worker_id: workers.otherOnly, relation: 'saved', added: '2029-12-31T00:00:00Z' });
  booking(workers.historyLatest, { date: '2029-12-25' }); booking(workers.historyOlder, { date: '2029-12-01' });
  await test('Bookings-only delegates can open the picker and other roles or unlinked accounts cannot', async () => {
    ok(await picker({}, null), 401); ok(await picker({}, demoWorker), 403); ok(await picker({}, helper), 403); ok(await picker({}, helper, other.id), 403);
    const delegated = ok(await picker({}, helper, owner.id)); assert.equal(delegated.subject.id, owner.id); assert.deepEqual(ids(delegated), ids(ok(await picker())));
    update('account_links', 'id', linkId, { scopes: '["workers"]' }); ok(await picker({}, helper, owner.id), 403);
    update('account_links', 'id', linkId, { scopes: '["bookings"]', status: 'revoked' }); ok(await picker({}, helper, owner.id), 403);
    update('account_links', 'id', linkId, { status: 'active' });
  });
  await test('Newest connections come before previous carers and area results without cross-account history', async () => {
    const data = ok(await picker()), recent = data.workers.filter(w => w.group === 'recent');
    assert.deepEqual(recent.map(w => w.id), [workers.recentNew, workers.recentOld, workers.historyLatest, workers.historyOlder]);
    assert.equal(recent[0].connected_at, '2029-12-30T00:00:00Z'); assert.match(recent[2].last_shift, /^2029-12-25/);
    assert.ok(data.workers.slice(recent.length).every(w => w.group === 'area')); assert.equal(new Set(ids(data)).size, ids(data).length);
    assert.ok(ids(data).includes(workers.recentNew), 'Date-only browsing retains a known carer outside the home area');
    assert.ok(!ids(data).includes(workers.otherOnly)); assert.ok(!ids(data).includes(workers.areaOther));
    const foreignHeader = ok(await picker({}, owner, other.id)); assert.equal(foreignHeader.subject.id, owner.id); assert.deepEqual(ids(foreignHeader), ids(data));
    const otherData = ok(await picker({}, other)); assert.equal(otherData.workers.find(w => w.id === workers.otherOnly).group, 'recent'); assert.equal(otherData.workers.find(w => w.id === workers.recentOld).group, 'area');
  });
  await test('Saved home locality is used before the profile suburb and only exact area matches become nearby carers', async () => {
    update('users', 'id', owner.id, { suburb: 'Parramatta NSW' });
    ok(await request('PUT', '/api/me/service-address', owner, { revision: 0, address: home }));
    const data = ok(await picker()); assert.match(data.location.label, /Ryde/); assert.equal(data.location_checked, true); assert.equal(data.interval_checked, false);
    for (const key of ['areaLocal', 'profileFallback', 'postcodeOnly']) assert.ok(ids(data).includes(workers[key]), key + ' should match the saved home');
    for (const key of ['areaOther', 'stateMismatch', 'postcodeMismatch']) assert.ok(!ids(data).includes(workers[key]), key + ' must not be presented as local');
    privateAbsent(data); update('users', 'id', owner.id, { suburb: 'Ryde NSW' });
  });
  await test('Explicit destination changes nearby matches and missing locality never invents a nearby group', async () => {
    const destination = ok(await picker({ place: 'Parramatta NSW' })); assert.ok(ids(destination).includes(workers.areaOther)); assert.ok(!ids(destination).includes(workers.areaLocal)); assert.match(destination.location.label, /Parramatta/);
    update('users', 'id', other.id, { suburb: '' });
    const noLocation = ok(await picker({}, other)); assert.equal(noLocation.location_checked, false); assert.ok(noLocation.workers.every(w => w.group === 'recent')); assert.deepEqual(ids(noLocation), [workers.otherOnly]);
    update('users', 'id', other.id, { suburb: 'Ryde NSW' });
  });
  await test('Selected services, whole-day leave, weekday patterns and declared day windows filter date-only results', async () => {
    const id = workers.areaLocal;
    update('worker_profiles', 'user_id', id, { services: '["personal-care"]' }); assert.ok(!ids(ok(await picker({ service: 'daily-tasks' }))).includes(id)); assert.ok(ids(ok(await picker({ service: 'personal-care' }))).includes(id));
    update('worker_profiles', 'user_id', id, { services: '["daily-tasks","personal-care"]', leave_dates: JSON.stringify([{ from: DATE, to: DATE }]) }); assert.ok(!ids(ok(await picker())).includes(id));
    update('worker_profiles', 'user_id', id, { leave_dates: '[]', days: '[0,1,1,1,1,1,1]' }); assert.ok(!ids(ok(await picker())).includes(id));
    const windows = Array.from({ length: 7 }, () => [{ start: '09:00', end: '17:00' }]); windows[0] = [];
    update('worker_profiles', 'user_id', id, { days: '[1,1,1,1,1,1,1]', availability_windows: JSON.stringify(windows) }); assert.ok(!ids(ok(await picker())).includes(id));
    windows[0] = [{ start: '10:00', end: '11:00' }]; update('worker_profiles', 'user_id', id, { availability_windows: JSON.stringify(windows) }); assert.ok(ids(ok(await picker())).includes(id), 'Day-only browsing must not invent an unrequested duration');
    update('worker_profiles', 'user_id', id, { availability_windows: null });
  });
  await test('A full interval checks the entire visit, service area, worker conflicts and travel buffer', async () => {
    const query = { start: '10:00', hours: '2', service: 'daily-tasks' }, id = workers.areaLocal;
    const initial = ok(await picker(query)); assert.equal(initial.interval_checked, true); assert.ok(ids(initial).includes(id)); assert.ok(!ids(initial).includes(workers.recentNew), 'A known out-of-area worker must still pass the full visit check');
    const clash = booking(id, { participant_id: other.id, date: DATE, start: '11:00', hours: 2, status: 'accepted' }); assert.ok(!ids(ok(await picker(query))).includes(id));
    update('bookings', 'id', clash, { status: 'cancelled' }); assert.ok(ids(ok(await picker(query))).includes(id));
    update('bookings', 'id', clash, { start: '12:15', status: 'accepted' }); update('worker_profiles', 'user_id', id, { travel_buffer_minutes: 30 }); assert.ok(!ids(ok(await picker(query))).includes(id));
    update('bookings', 'id', clash, { status: 'cancelled' });
    const windows = Array.from({ length: 7 }, () => [{ start: '10:00', end: '11:00' }]); update('worker_profiles', 'user_id', id, { travel_buffer_minutes: 0, availability_windows: JSON.stringify(windows) }); assert.ok(!ids(ok(await picker(query))).includes(id));
    update('worker_profiles', 'user_id', id, { availability_windows: null });
  });
  await test('Demo, blocked, hidden, closed, platform-blocked and training-locked profiles never appear', async () => {
    assert.ok(!ids(ok(await picker())).includes(10), 'Seeded demo workers must not appear in the booking picker');
    const id = workers.areaLocal, relation = ins('participant_workers', { participant_id: owner.id, worker_id: id, relation: 'blocked', added: NOW }); assert.ok(!ids(ok(await picker())).includes(id)); db.prepare('DELETE FROM participant_workers WHERE id=?').run(relation);
    for (const values of [{ visible: 0 }, { platform_block: 1, platform_block_reason: 'PRIVATE-BLOCK-REASON' }]) {
      update('worker_profiles', 'user_id', id, values); assert.ok(!ids(ok(await picker())).includes(id)); update('worker_profiles', 'user_id', id, { visible: 1, platform_block: 0, platform_block_reason: '' });
    }
    update('users', 'id', id, { closed_at: NOW }); assert.ok(!ids(ok(await picker())).includes(id)); update('users', 'id', id, { closed_at: null });
    db.prepare('UPDATE module_completions SET expires_at=? WHERE worker_id=?').run('2029-01-01', id); assert.ok(!ids(ok(await picker())).includes(id)); db.prepare('UPDATE module_completions SET expires_at=? WHERE worker_id=?').run('2031-01-01', id);
    assert.ok(ids(ok(await picker())).includes(id));
  });
  await test('Malformed date, service, partial interval and invalid place inputs fail before producing results', async () => {
    ok(await request('GET', '/api/bookings/carers', owner), 400);
    for (const query of [{ date: '' }, { date: '2029-12-31' }, { date: '2030-02-30' }, { date: '2030-1-7' }, { service: 'invented-service' }, { start: '10:00' }, { hours: '2' }, { start: '25:00', hours: '2' }, { start: '10:00', hours: '1' }, { start: '10:00', hours: '11' }, { start: '10:00', hours: 'NaN' }, { place: 'X' }, { place: '*Ryde*' }, { place: 'Ryde\nNSW' }, { place: 'R'.repeat(161) }]) ok(await picker(query), 400);
    ok(await picker({ date: '2030-01-01' })); ok(await picker({ start: '10:00', hours: '10' }));
  });
  await test('Public filter fields are retained while private evidence and address details remain absent', async () => {
    const data = ok(await picker()), worker = data.workers.find(w => w.id === workers.areaLocal); privateAbsent(data);
    assert.deepEqual(worker.services, ['daily-tasks', 'personal-care']); assert.equal(worker.langs, 'English, Nepali'); assert.equal(worker.gender, 'female'); assert.deepEqual(worker.interests, ['Music']); assert.deepEqual(worker.service_areas, ['Ryde NSW']); assert.ok(Array.isArray(worker.checks));
    assert.equal(worker.connected_at, null); assert.equal(worker.last_shift, null); assert.equal(worker.group, 'area');
  });
}
(async () => { try { await main(); } catch (error) { results.push({ name: 'Harness', result: 'FAIL', error: error.stack }); console.error(error); } finally {
  const keep = process.env.KEEP_BOOKING_CARER_FIXTURE === '1' && db && child?.exitCode === null;
  if (keep) {
    update('account_links', 'id', linkId, { scopes: '["bookings"]', status: 'active' });
    update('users', 'id', owner.id, { suburb: 'Ryde NSW', verified: 1 });
    const fixture = process.env.BOOKING_CARER_FIXTURE_PATH || path.join(DIR, 'fixture.json');
    fs.writeFileSync(fixture, JSON.stringify({ base, owner, other, helper, workers, now: NOW, date: DATE, DIR, env: serverEnv, pid: child.pid }, null, 2));
    console.log('Browser fixture ready: ' + fixture);
  }
  db?.close(); if (!keep && child && child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await ended; }
  if (process.env.BOOKING_CARER_PICKER_RESULTS) fs.writeFileSync(process.env.BOOKING_CARER_PICKER_RESULTS, JSON.stringify({ runtime: process.version, scope: 'Real HTTP routes; disposable records; fixed clock; loopback-only network', results, serverLog: log }, null, 2) + '\n');
  if (!keep) fs.rmSync(DIR, { recursive: true, force: true }); console.log(`booking carer picker HTTP: ${results.filter(r => r.result === 'PASS').length}/${results.length} passed`); process.exitCode = results.some(r => r.result === 'FAIL') ? 1 : 0;
} })();
