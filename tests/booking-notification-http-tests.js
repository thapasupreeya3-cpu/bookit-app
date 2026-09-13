'use strict';
// Actual routes, a disposable database and synthetic identities. A preload
// blocks all external traffic, including payment, email and calendar services.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-booking-mail-http-'));
const stamp = new Date().toISOString(), password = 'Copper-Rainstorm!82', results = [];
const home = { street: '41 Synthetic Private Lane', suburb: 'Ryde', state: 'NSW', postcode: '2112', arrival_notes: 'Synthetic private door instruction.' };
let child, db, base, log = '', owner, helper, worker;
const ins = (table, values) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
async function req(method, url, person, body, forId) {
  const r = await fetch(base + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(person?.cookie ? { Cookie: person.cookie } : {}), ...(forId ? { 'X-Bookit-For': String(forId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
function ok(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.data) || r.text.slice(0, 200)); return r.data; }
async function test(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }); console.log('PASS ' + name); } catch (error) { results.push({ name, result: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ' ' + error.stack); } }
async function register(label) {
  const email = 'booking-mail-' + label + '@example.test';
  const r = await req('POST', '/api/register', null, { role: 'participant', email, name: 'Synthetic booking email ' + label, password, suburb: 'Ryde NSW', plan: 'private', terms_accepted: true, terms_version: /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT + '/server.js', 'utf8'))[1] });
  return { id: ok(r).user.id, cookie: r.cookie, email };
}
async function login(id) { const r = await req('POST', '/api/login', null, { email: db.prepare('SELECT email FROM users WHERE id=?').get(id).email, password: 'demo1234' }); ok(r); return { id, cookie: r.cookie }; }
function assertPrivateAbsent(value) { for (const secret of [home.street, home.arrival_notes]) assert.ok(!JSON.stringify(value).includes(secret), 'Exact address escaped into a booking email'); }

async function main() {
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); base = 'http://127.0.0.1:' + port;
  const guard = path.join(DIR, 'loopback-only.js');
  fs.writeFileSync(guard, `'use strict';
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic booking email test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
`);
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', TZ: 'Australia/Sydney' };
  child = spawn(process.execPath, ['--no-warnings', '--require', guard, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error(log); try { if ((await fetch(base + '/api/version')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  db = new DatabaseSync(env.DB_PATH); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); helper = await register('helper');
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id); db.prepare('UPDATE users SET verified=1 WHERE id=?').run(owner.id); db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  ins('account_links', { participant_id: owner.id, coordinator_id: helper.id, invite_email: helper.email, invite_token: 'synthetic-booking-email-link', scopes: '["bookings"]', status: 'active', invited_at: stamp });
  worker = await login(10);
  db.exec(`UPDATE users SET suburb='Ryde NSW' WHERE id=10;UPDATE worker_profiles SET visible=1,self_paused=0,days='[1,1,1,1,1,1,1]',service_areas='["Ryde NSW"]',availability_windows=NULL,leave_dates='[]',services='["daily-tasks","personal-care"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id=10`);
  ok(await req('PUT', '/api/me/service-address', owner, { revision: 0, address: home }));


  db.prepare("UPDATE users SET email='booking-mail-worker@example.test' WHERE id=?").run(worker.id);
  for(const form_key of ['p-agreement','p-consent-privacy'])ins('participant_docs',{participant_id:owner.id,form_key,uploaded_at:stamp});
  const planId=ins('support_plans',{participant_id:owner.id,version:1,current:1,status:'confirmed',created:stamp,updated:stamp,confirmed_at:stamp,reviewed_at:stamp,reviewed_by:'Synthetic reviewer',review_due:'2031-12-31'});
  const noticeRows=(id,event)=>db.prepare("SELECT * FROM delivery_outbox WHERE event_key LIKE 'booking-notice:%' ORDER BY id").all().filter(r=>{const m=JSON.parse(r.payload)[8];return m?.booking_ids.includes(id)&&(!event||m.booking_event===event);});
  const proposed=date=>({worker_id:worker.id,date,start:'10:00',hours:2,service:'personal-care',service_location:{mode:'saved',source_revision:1}});
  let one,series,declined;
  await test('A real request queues an acknowledgement to participant and helper plus a worker request',async()=>{
    one=ok(await req('POST','/api/bookings',owner,proposed('2030-09-13'))).id;
    const rows=noticeRows(one,'requested');assert.deepEqual(rows.map(r=>r.user_id),[owner.id,helper.id,worker.id]);assert.ok(rows.every(r=>r.status==='queued'&&r.urgent===1));
    for(const r of rows)assertPrivateAbsent(JSON.parse(r.payload));
  });
  await test('Real worker acceptance queues participant-side confirmations only',async()=>{
    ok(await req('PATCH','/api/bookings/'+one,worker,{status:'accepted',plan_ack:true,plan_id:planId,plan_version:1}));
    assert.deepEqual(noticeRows(one,'accepted').map(r=>r.user_id),[owner.id,helper.id]);
  });
  await test('Moving an occurrence queues clear changed details and a fresh worker request',async()=>{
    ok(await req('PATCH','/api/bookings/'+one+'/occurrence',owner,{date:'2030-09-14',start:'11:00'}));
    const rows=noticeRows(one,'changed');assert.equal(rows.length,3);assert.equal(JSON.parse(rows.find(r=>r.user_id===worker.id).payload)[8].event_kind,'booking-request');assert.ok(rows.every(r=>r.urgent===1));
  });
  await test('Real participant cancellation creates both participant and worker notices',async()=>{
    ok(await req('PATCH','/api/bookings/'+one,owner,{status:'cancelled',reason:'Synthetic changed plans'}));assert.deepEqual(noticeRows(one,'cancelled').map(r=>r.user_id),[owner.id,helper.id,worker.id]);
  });
  await test('Real worker decline sends participant-side updates',async()=>{
    declined=ok(await req('POST','/api/bookings',owner,proposed('2030-09-16'))).id;ok(await req('PATCH','/api/bookings/'+declined,worker,{status:'declined'}));assert.deepEqual(noticeRows(declined,'declined').map(r=>r.user_id),[owner.id,helper.id]);
  });
  await test('A repeating request and batch acceptance each send one grouped email per appropriate recipient',async()=>{
    series=ok(await req('POST','/api/bookings',owner,{...proposed('2030-09-20'),repeat:'weekly',repeat_count:2}));assert.equal(noticeRows(series.id,'requested').length,3);
    const review=ok(await req('GET','/api/journey/series/'+series.series_id,worker));ok(await req('POST','/api/journey/series/'+series.series_id+'/accept',worker,{ids:series.ids,revisions:Object.fromEntries(review.visits.map(v=>[v.id,v.revision])),plan_ack:true,plan_id:planId,plan_version:1}));assert.deepEqual(noticeRows(series.id,'accepted').map(r=>r.user_id),[owner.id,helper.id]);
  });
  await test('Changing a repeating booking sends an urgent update to each side',async()=>{
    ok(await req('PATCH','/api/series/'+series.series_id,owner,{start:'12:00'}));const rows=noticeRows(series.id,'changed');assert.equal(rows.length,3);assert.ok(rows.every(r=>r.urgent===1));
  });
  await test('Ending the series queues cancellation summaries for both sides',async()=>{
    const preview=ok(await req('GET','/api/journey/series/'+series.series_id+'/end-preview',owner));ok(await req('POST','/api/series/'+series.series_id+'/end',owner,{confirm:true,token:preview.token,expires:preview.expires}));const rows=noticeRows(series.id,'ended');assert.equal(rows.length,3);assert.ok(rows.every(r=>JSON.parse(r.payload)[8].booking_ids.length===2));
  });
}
main().catch(error => { console.error(error); results.push({ name: 'HTTP fixture', result: 'FAIL', error: error.stack }); }).finally(async () => {
  if (db) db.close(); if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  if (process.env.BOOKING_NOTIFICATION_HTTP_RESULTS) fs.writeFileSync(process.env.BOOKING_NOTIFICATION_HTTP_RESULTS, JSON.stringify({ runtime: process.version, scope: 'Disposable synthetic accounts; external network blocked', results, serverLog: log }, null, 2));
  fs.rmSync(DIR, { recursive: true, force: true }); console.log(`booking notification HTTP: ${results.filter(r => r.result === 'PASS').length}/${results.length} passed`); if (results.some(r => r.result === 'FAIL')) process.exitCode = 1;
});
