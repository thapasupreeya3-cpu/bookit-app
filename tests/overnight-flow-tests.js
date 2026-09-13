'use strict';
// Actual routes, a disposable database and synthetic identities. A preload
// blocks all external traffic, including payment, email and calendar services.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-overnight-http-'));
const stamp = new Date().toISOString(), password = 'Copper-Rainstorm!82', results = [];
const home = { street: '41 Synthetic Private Lane', suburb: 'Ryde', state: 'NSW', postcode: '2112', arrival_notes: 'Synthetic private door instruction.' };
const note = 'Delivered the agreed overnight personal support, assisted with the planned activities and recorded the participant outcome.';
let child, db, base, log = '', owner, other, helper, worker, admin, linkId, sundayInvoice;
const ins = (table, values) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
const booking = (values = {}) => ins('bookings', { participant_id: owner.id, worker_id: worker.id, service: 'personal-care', date: '2026-08-24', start: '22:00', hours: 8, sleepover: 1, status: 'accepted', created: stamp, ...values });
const row = id => db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
const period = (start, end) => ({ start, end });
async function req(method, url, person, body, forId) {
  const r = await fetch(base + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(person?.cookie ? { Cookie: person.cookie } : {}), ...(forId ? { 'X-Bookit-For': String(forId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
function ok(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.data) || r.text.slice(0, 200)); return r.data; }
async function test(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }); console.log('PASS ' + name); } catch (error) { results.push({ name, result: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ' ' + error.stack); } }
async function register(label) {
  const email = 'overnight-' + label + '@example.test';
  const r = await req('POST', '/api/register', null, { role: 'participant', email, name: 'Synthetic overnight ' + label, password, suburb: 'Ryde NSW', plan: 'private', terms_accepted: true, terms_version: /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT + '/server.js', 'utf8'))[1] });
  return { id: ok(r).user.id, cookie: r.cookie, email };
}
async function login(id) { const r = await req('POST', '/api/login', null, { email: db.prepare('SELECT email FROM users WHERE id=?').get(id).email, password: 'demo1234' }); ok(r); return { id, cookie: r.cookie }; }
const quoteInput = values => ({ date: '2026-08-24', start: '22:00', hours: 8, service: 'personal-care', sleepover: '1', ...values });
const quote = values => req('GET', '/api/pricing/quote?' + new URLSearchParams(quoteInput(values))).then(ok);
const complete = (id, values = {}) => req('PATCH', '/api/bookings/' + id, worker, { status: 'completed', note, active_hours: 0, ...values });
async function waitFor(fn) { for (let n = 0; n < 120; n++) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Expected automatic invoice/claim did not finish.'); }
async function issued(id) { return waitFor(() => row(id).invoice_no); }
const snapshot = no => JSON.parse(db.prepare('SELECT data FROM invoice_snapshots WHERE invoice_no=?').get(no).data);
function assertPrivateAbsent(value) { for (const secret of [home.street, home.arrival_notes]) assert.ok(!JSON.stringify(value).includes(secret), 'Exact address escaped into the price response'); }

async function main() {
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); base = 'http://127.0.0.1:' + port;
  const guard = path.join(DIR, 'loopback-only.js');
  fs.writeFileSync(guard, `'use strict';
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic overnight test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
`);
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', TZ: 'Australia/Sydney' };
  child = spawn(process.execPath, ['--no-warnings', '--require', guard, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error(log); try { if ((await fetch(base + '/api/version')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  db = new DatabaseSync(env.DB_PATH); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); other = await register('other'); helper = await register('helper');
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id); db.prepare('UPDATE users SET verified=1 WHERE id=?').run(owner.id); db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  linkId = ins('account_links', { participant_id: owner.id, coordinator_id: helper.id, invite_email: helper.email, invite_token: 'synthetic-overnight-link', scopes: '["bookings"]', status: 'active', invited_at: stamp });
  admin = await login(1); worker = await login(10);
  db.exec(`UPDATE users SET suburb='Ryde NSW' WHERE id=10;UPDATE worker_profiles SET visible=1,self_paused=0,days='[1,1,1,1,1,1,1]',service_areas='["Ryde NSW"]',availability_windows=NULL,leave_dates='[]',services='["daily-tasks","personal-care"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id=10`);
  ok(await req('PUT', '/api/me/service-address', owner, { revision: 0, address: home }));

  await test('The public quote makes 8-hour and 10-hour sleepovers flat, while active nights remain hourly', async () => {
    for (const hours of [8, 10]) {
      const q = await quote({ hours }); assert.equal(q.support_type, 'sleepover'); assert.equal(q.total, 311.79); assert.equal(q.lines.length, 1); assert.equal(q.lines[0].qty, 1); assert.equal(q.lines[0].unit, 'night'); assert.equal(q.lines[0].item, '01_010_0107_1_1'); assert.equal(q.included_active_hours, 2); assert.equal(q.end_date, '2026-08-25');
      const active = await quote({ hours, sleepover: '0' }); assert.equal(active.support_type, 'hourly'); assert.equal(active.total, Math.round(hours * 82.57 * 100) / 100); assert.equal(active.lines.reduce((n, l) => n + l.qty, 0), hours);
    }
  });
  await test('Both quote routes reject invalid sleepover shapes and retain valid earlier evening starts', async () => {
    for (const values of [{ hours: 7.75 }, { start: '01:00' }, { start: '16:00' }, { service: 'household' }]) {
      ok(await req('GET', '/api/pricing/quote?' + new URLSearchParams(quoteInput(values))), 400);
      ok(await req('POST', '/api/pricing/quote', owner, quoteInput(values)), 400);
    }
    assert.equal((await quote({ start: '19:00' })).total, 311.79);
  });
  await test('Private location quotes require the participant or an active bookings helper and disclose no address', async () => {
    const input = quoteInput({ service_location: { mode: 'saved', source_revision: 1 } });
    ok(await req('POST', '/api/pricing/quote', null, input), 401); ok(await req('POST', '/api/pricing/quote', worker, input), 403);
    assertPrivateAbsent(ok(await req('POST', '/api/pricing/quote', owner, input)));
    assertPrivateAbsent(ok(await req('POST', '/api/pricing/quote', helper, input, owner.id)));
    db.prepare("UPDATE account_links SET status='revoked' WHERE id=?").run(linkId);
    ok(await req('POST', '/api/pricing/quote', helper, input, owner.id), 403);
    db.prepare("UPDATE account_links SET status='active' WHERE id=?").run(linkId);
    ok(await req('POST', '/api/pricing/quote', owner, quoteInput({ service_location: { mode: 'saved', source_revision: 0 } })), 409);
  });
  await test('The private quote uses the selected destination for holidays rather than the supplied profile suburb', async () => {
    const input = quoteInput({ date: '2026-11-05', start: '16:00', hours: 10, suburb: 'Ryde NSW', service_location: { mode: 'other', street: '9 Synthetic Event Road', suburb: 'Grafton', state: 'NSW', postcode: '2460' } });
    const q = ok(await req('POST', '/api/pricing/quote', owner, input));
    assert.equal(q.total, 311.79); assert.deepEqual(q.extra_active_rates.map(r => r.category), ['public-holiday', 'saturday']);
    assert.deepEqual((await quote({ date: input.date, suburb: 'Ryde NSW' })).extra_active_rates.map(r => r.category), ['saturday']);
    assert.ok(!JSON.stringify(q).includes(input.service_location.street));
  });
  await test('A real booking request saves its displayed rate and returns it privately to both booking parties', async () => {
    for (const form_key of ['p-agreement', 'p-consent-privacy']) ins('participant_docs', { participant_id: owner.id, form_key, uploaded_at: stamp });
    ins('support_plans', { participant_id: owner.id, version: 1, current: 1, status: 'confirmed', created: stamp, updated: stamp, confirmed_at: stamp, reviewed_at: stamp, reviewed_by: 'Synthetic test reviewer', review_due: '2031-12-31' });
    const proposed = { worker_id: worker.id, date: '2030-09-13', start: '22:00', hours: 8, service: 'personal-care', sleepover: true, service_location: { mode: 'saved', source_revision: 1 } };
    const shown = ok(await req('POST', '/api/pricing/quote', owner, proposed)); assert.match(shown.quote_key, /^[a-f0-9]{64}$/);
    const requested = ok(await req('POST', '/api/bookings', owner, { ...proposed, quote_keys: [shown.quote_key] }));
    const saved = JSON.parse(row(requested.id).booking_quote); assert.equal(saved.total, 311.79); assert.equal(saved.support_type, 'sleepover'); assert.equal(saved.end_date, '2030-09-14'); assert.equal(saved.quote_key, shown.quote_key); assert.equal(saved.display_label, 'Price shown at booking');
    for (const person of [owner, worker]) { const b = ok(await req('GET', '/api/bookings?booking=' + requested.id, person)).bookings[0]; assert.deepEqual(b.booking_quote, saved); assertPrivateAbsent(b); }
    ok(await req('GET', '/api/bookings?booking=' + requested.id, other), 404);
  });
  await test('Invalid inactive-night booking requests save no booking or displayed-rate snapshot', async () => {
    const count = db.prepare('SELECT count(*) n FROM bookings WHERE participant_id=?').get(owner.id).n;
    for (const values of [{ start: '01:00' }, { start: '16:00' }, { hours: 7.75 }]) ok(await req('POST', '/api/bookings', owner, { worker_id: worker.id, date: '2030-09-16', start: '22:00', hours: 8, service: 'personal-care', sleepover: true, ...values }), 400);
    assert.equal(db.prepare('SELECT count(*) n FROM bookings WHERE participant_id=?').get(owner.id).n, count);
  });
  await test('Wrong or stale displayed-price keys refuse the request before any booking is written', async () => {
    const proposed = { worker_id: worker.id, date: '2030-09-16', start: '22:00', hours: 8, service: 'personal-care', sleepover: true, service_location: { mode: 'saved', source_revision: 1 } };
    const shown = ok(await req('POST', '/api/pricing/quote', owner, proposed)), count = db.prepare('SELECT count(*) n FROM bookings WHERE participant_id=?').get(owner.id).n;
    for (const body of [{ ...proposed, quote_keys: ['0'.repeat(64)] }, { ...proposed, hours: 10, quote_keys: [shown.quote_key] }]) {
      const refused = ok(await req('POST', '/api/bookings', owner, body), 409); assert.equal(refused.code, 'booking_quote_changed');
      assert.equal(db.prepare('SELECT count(*) n FROM bookings WHERE participant_id=?').get(owner.id).n, count);
    }
  });
  await test('One stale price in a repeating request creates neither a series nor any of its bookings', async () => {
    const proposed = { worker_id: worker.id, date: '2030-09-16', start: '22:00', hours: 8, service: 'personal-care', sleepover: true, service_location: { mode: 'saved', source_revision: 1 } };
    const first = ok(await req('POST', '/api/pricing/quote', owner, proposed)), second = ok(await req('POST', '/api/pricing/quote', owner, { ...proposed, date: '2030-09-23' }));
    assert.notEqual(first.quote_key, second.quote_key);
    const bookingsBefore = db.prepare('SELECT count(*) n FROM bookings WHERE participant_id=?').get(owner.id).n, seriesBefore = db.prepare('SELECT count(*) n FROM booking_series WHERE participant_id=?').get(owner.id).n;
    const result = ok(await req('POST', '/api/bookings', owner, { ...proposed, repeat: 'weekly', repeat_count: 2, quote_keys: [first.quote_key, first.quote_key] }), 409);
    assert.equal(result.code, 'booking_quote_changed'); assert.equal(db.prepare('SELECT count(*) n FROM bookings WHERE participant_id=?').get(owner.id).n, bookingsBefore); assert.equal(db.prepare('SELECT count(*) n FROM booking_series WHERE participant_id=?').get(owner.id).n, seriesBefore);
  });
  await test('Partial support-period draft rows round-trip exactly and stay private to the assigned worker', async () => {
    const id = booking({ date: '2026-08-22' }), payload = { note: 'Synthetic unfinished draft', active_hours: '2.1', active_note: 'Still recording the support times', active_periods: [period('2026-08-22T22:00:00+10:00', ''), period('', '')] };
    ok(await req('PUT', '/api/bookings/' + id + '/note-draft', worker, { revision: 0, payload }));
    const saved = ok(await req('GET', '/api/bookings/' + id + '/note-draft', worker)).draft;
    assert.deepEqual(saved.payload.active_periods, payload.active_periods); assert.equal(saved.payload.active_hours, '2.1'); assert.equal(row(id).active_hours, 0);
    ok(await req('GET', '/api/bookings/' + id + '/note-draft', owner), 403); ok(await req('GET', '/api/bookings/' + id + '/note-draft', other), 403);
  });
  await test('Missing mixed-rate periods and invalid increments refuse completion atomically without rounding', async () => {
    const id = booking({ date: '2026-08-22' });
    const before = row(id), fields = ['status', 'total', 'unit_price', 'active_hours', 'active_extra_hours', 'active_extra_total', 'active_periods', 'active_extra_lines', 'invoice_no'];
    for (const [values, code] of [[{ active_hours: 3, active_note: note }, 'active_periods_required'], [{ active_hours: 2.1 }, 'active_hours_increment'], [{ active_hours: 3, active_note: note, active_periods: [period('2026-08-22T22:00+10:00', '2026-08-23T00:00+10:00'), period('2026-08-22T23:30+10:00', '2026-08-23T00:30+10:00')] }, 'active_periods_overlap']]) {
      assert.equal(ok(await complete(id, values), 400).code, code);
      for (const field of fields) assert.equal(row(id)[field], before[field], field);
      assert.equal(db.prepare('SELECT count(*) n FROM shift_notes WHERE booking_id=?').get(id).n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM billing_jobs WHERE booking_id=?').get(id).n, 0);
    }
  });
  await test('Zero and two active hours complete mixed-rate nights at the flat price without required periods', async () => {
    for (const active_hours of [0, 2]) { const id = booking({ date: '2026-08-22' }); ok(await complete(id, { active_hours })); const no = await issued(id), b = row(id); assert.equal(b.active_hours, active_hours); assert.equal(b.active_extra_total, 0); assert.deepEqual(JSON.parse(b.active_extra_lines), []); assert.equal(snapshot(no).total, 311.79); }
  });
  await test('A legacy after-midnight sleepover saves completed work and clearly holds the uncertain charge', async () => {
    const id = booking({ date: '2026-08-24', start: '00:30', hours: 8 }), invoiceCount = db.prepare('SELECT count(*) n FROM invoice_snapshots').get().n;
    const result = ok(await complete(id, { active_hours: 0 })); assert.equal(result.ok, true); assert.ok(!result.invoice_no); assert.equal(result.billing_status,'needs-charge-review'); assert.match(result.billing_notice,/work saved/);
    const b = row(id); assert.equal(b.status, 'completed'); assert.equal(b.hours, 8); assert.equal(b.active_hours, 0); assert.equal(b.claim_hold, 1); assert.match(b.hold_reason, /Review legacy overnight booking/); assert.match(b.hold_reason, /completed work is saved/i); assert.ok(!b.invoice_no);
    const notes = db.prepare('SELECT body FROM shift_notes WHERE booking_id=?').all(id); assert.equal(notes.length, 1); assert.equal(notes[0].body, note);
    ok(await req('POST', '/api/admin/billing/retry', admin, {})); await waitFor(() => db.prepare('SELECT status FROM billing_jobs WHERE booking_id=?').get(id)?.status === 'waiting');
    assert.ok(!row(id).invoice_no); assert.equal(db.prepare('SELECT count(*) n FROM invoice_snapshots').get().n, invoiceCount);
    const visible = ok(await req('GET', '/api/bookings?booking=' + id, worker)).bookings[0]; assert.match(visible.sleepover_pricing.legacy_review_required, /midnight/i); assert.equal(visible.claim_hold, 1);
  });
  await test('A same-rate weekday sleepover completes with total active hours and the Saturday extra rate', async () => {
    const id = booking(); ok(await complete(id, { active_hours: 2.25, active_note: note }));
    const no = await issued(id), b = row(id); assert.equal(b.active_extra_rate, 103.54); assert.equal(b.active_extra_hours, 0.25); assert.equal(b.active_extra_total, 25.89); assert.equal(snapshot(no).total, 337.68);
    const extra = snapshot(no).lines.find(l => l.unit === 'hours'); assert.equal(extra.item, '01_013_0107_1_1'); assert.equal(extra.qty, 0.25);
  });
  await test('Saturday-to-Sunday completion produces a Sunday extra line and one queued invoice email', async () => {
    const id = booking({ date: '2026-08-22' }); ok(await complete(id, { active_hours: 3, active_note: note, active_periods: [period('2026-08-22T22:00+10:00', '2026-08-23T00:00+10:00'), period('2026-08-23T03:00+10:00', '2026-08-23T04:00+10:00')] }));
    const no = await issued(id), b = row(id); sundayInvoice = { id, no };
    assert.equal(b.active_extra_total, 133.5); assert.equal(b.active_extra_category, 'sunday'); assert.equal(snapshot(no).total, 445.29);
    const line = snapshot(no).lines.find(l => l.unit === 'hours'); assert.equal(line.item, '01_014_0107_1_1'); assert.equal(line.date, '2026-08-23'); assert.equal(line.when, '03:00–04:00');
    const mail = db.prepare('SELECT * FROM delivery_outbox WHERE event_key=?').get('invoice:' + no); assert.equal(mail.status, 'queued'); assert.equal(mail.recipient, owner.email); assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox WHERE event_key=?').get('invoice:' + no).n, 1);
  });
  await test('Sunday-to-Monday additional work retains separate Sunday and weekday invoice lines', async () => {
    const id = booking({ date: '2026-08-23', start: '19:00', hours: 10 });
    ok(await complete(id, { active_hours: 4, active_note: note, active_periods: [period('2026-08-23T19:00+10:00', '2026-08-23T22:00+10:00'), period('2026-08-24T01:00+10:00', '2026-08-24T02:00+10:00')] }));
    const no = await issued(id), b = row(id); assert.equal(b.active_extra_category, 'mixed'); assert.equal(b.active_extra_rate, 0); assert.equal(b.active_extra_total, 237.04); assert.equal(snapshot(no).total, 548.83);
    const extras = snapshot(no).lines.filter(l => l.unit === 'hours'); assert.deepEqual(extras.map(l => l.rate), [133.5, 103.54]); assert.deepEqual(extras.map(l => l.date), ['2026-08-23', '2026-08-24']);
  });
  await test('A holiday reached after midnight uses the holiday item and actual date in the NDIA export', async () => {
    db.prepare("UPDATE users SET plan='ndia',ndis_number='123456789' WHERE id=?").run(owner.id);
    try {
      const id = booking({ date: '2026-04-02' }); ok(await complete(id, { active_hours: 3, active_note: note, active_periods: [period('2026-04-02T22:00+11:00', '2026-04-03T01:00+11:00')] }));
      assert.equal(row(id).active_extra_total, 163.46); ok(await req('PATCH', '/api/bookings/' + id, owner, { status: 'approved' }));
      await waitFor(() => row(id).claim_status === 'claimed');
      const csv = await req('GET', '/api/admin/claims/pace.csv', admin); ok(csv);
      const lines = csv.text.split(/\r?\n/).filter(l => l.includes('BK' + id)); assert.equal(lines.length, 2); assert.ok(lines.some(l => l.includes('01_010_0107_1_1') && l.includes('311.79'))); const extra = lines.find(l => l.includes('01_012_0107_1_1')); assert.ok(extra); assert.match(extra, /03\/04\/2026/); assert.match(extra, /163\.46/);
    } finally { db.prepare("UPDATE users SET plan='private' WHERE id=?").run(owner.id); }
  });
  await test('An issued invoice keeps its signed snapshot and total after source changes and repeated completion', async () => {
    assert.ok(sundayInvoice); const { id, no } = sundayInvoice, before = db.prepare('SELECT * FROM invoice_snapshots WHERE invoice_no=?').get(no);
    db.prepare('UPDATE bookings SET active_extra_rate=999,active_extra_total=999,active_extra_lines=? WHERE id=?').run(JSON.stringify([{ date: '2026-08-23', category: 'public-holiday', item: 'SYNTHETIC-CHANGED', qty: 1, rate: 999, amount: 999, unit: 'hours' }]), id);
    const repeat = ok(await complete(id, { active_hours: 0 })); assert.equal(repeat.duplicate, true);
    const current = db.prepare('SELECT * FROM invoice_snapshots WHERE invoice_no=?').get(no); assert.deepEqual(current, before);
    const invoice = ok(await req('GET', '/api/me/invoices', owner)).invoices.find(i => i.invoice_no === no); assert.equal(invoice.total, 445.29); assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox WHERE event_key=?').get('invoice:' + no).n, 1);
  });
  await test('Previously recorded sleepover extras remain unchanged when legacy invoice history is read', async () => {
    const no = 'INV-SYNTHETIC-LEGACY-SLEEPOVER', id = booking({ date: '2026-08-17', status: 'completed', approval_state: 'approved', claim_status: 'claimed', invoice_no: no, claimed_at: stamp, total: 311.79, unit_price: 311.79, rate_category: 'sleepover', support_item: '01_010_0107_1_1', active_hours: 3, active_extra_hours: 1, active_extra_category: 'weekday-night', active_extra_item: '01_002_0107_1_1', active_extra_rate: 80, active_extra_total: 80 });
    const before = row(id); const invoices = ok(await req('GET', '/api/me/invoices', owner)).invoices; assert.equal(invoices.find(i => i.invoice_no === no).total, 391.79);
    ok(await req('GET', '/api/admin/claims', admin)); ok(await req('GET', '/api/bookings?booking=' + id, owner));
    for (const field of ['active_hours', 'active_extra_hours', 'active_extra_category', 'active_extra_item', 'active_extra_rate', 'active_extra_total', 'active_periods', 'active_extra_lines']) assert.equal(row(id)[field], before[field], field);
    assert.equal(row(id).active_extra_lines, null); assert.equal(row(id).active_periods, null);
  });
}
main().catch(error => { console.error(error); results.push({ name: 'HTTP fixture', result: 'FAIL', error: error.stack }); }).finally(async () => {
  if (db) db.close(); if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  if (process.env.OVERNIGHT_RESULTS) fs.writeFileSync(process.env.OVERNIGHT_RESULTS, JSON.stringify({ runtime: process.version, scope: 'Disposable synthetic accounts; external network blocked', results, serverLog: log }, null, 2));
  fs.rmSync(DIR, { recursive: true, force: true }); console.log(`overnight flow: ${results.filter(r => r.result === 'PASS').length}/${results.length} passed`); if (results.some(r => r.result === 'FAIL')) process.exitCode = 1;
});
