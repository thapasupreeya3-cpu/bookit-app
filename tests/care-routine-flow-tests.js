'use strict';
// Actual routes, a disposable database and synthetic identities. A preload
// blocks all external traffic, including payment, email and calendar services.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-care-routine-http-'));
const stamp = new Date().toISOString(), password = 'Copper-Rainstorm!82', results = [];
const home = { street: '41 Synthetic Private Lane', suburb: 'Ryde', state: 'NSW', postcode: '2112', arrival_notes: 'Synthetic private door instruction.' };
const note = 'Delivered the agreed overnight personal support, assisted with the planned activities and recorded the participant outcome.';
let child, db, base, log = '', owner, other, helper, worker, admin, linkId, legacyInvoice;
const ins = (table, values) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
const booking = (values = {}) => ins('bookings', { participant_id: owner.id, worker_id: worker.id, service: 'personal-care', date: '2026-08-26', start: '19:20', hours: 3, sleepover: 0, status: 'accepted', created: stamp, ...values });
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
  const email = 'care-routine-' + label + '@example.test';
  const r = await req('POST', '/api/register', null, { role: 'participant', email, name: 'Synthetic care routine ' + label, password, suburb: 'Ryde NSW', plan: 'private', terms_accepted: true, terms_version: /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT + '/server.js', 'utf8'))[1] });
  return { id: ok(r).user.id, cookie: r.cookie, email };
}
async function login(id) { const r = await req('POST', '/api/login', null, { email: db.prepare('SELECT email FROM users WHERE id=?').get(id).email, password: 'demo1234' }); ok(r); return { id, cookie: r.cookie }; }
const quoteInput = values => ({ date: '2026-08-26', start: '19:20', hours: 3, service: 'personal-care', sleepover: '0', ...values });
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
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic care routine test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
`);
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', SESSION_SECRET: 'synthetic-care-routine-price-key-with-more-than-32-characters', TZ: 'Australia/Sydney' };
  child = spawn(process.execPath, ['--no-warnings', '--require', guard, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error(log); try { if ((await fetch(base + '/api/version')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  db = new DatabaseSync(env.DB_PATH); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); other = await register('other'); helper = await register('helper');
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id); db.prepare('UPDATE users SET verified=1 WHERE id=?').run(owner.id); db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  linkId = ins('account_links', { participant_id: owner.id, coordinator_id: helper.id, invite_email: helper.email, invite_token: 'synthetic-care-routine-link', scopes: '["bookings"]', status: 'active', invited_at: stamp });
  admin = await login(1); worker = await login(10);
  db.exec(`UPDATE users SET suburb='Ryde NSW' WHERE id=10;UPDATE worker_profiles SET visible=1,self_paused=0,days='[1,1,1,1,1,1,1]',service_areas='["Ryde NSW"]',availability_windows=NULL,leave_dates='[]',services='["daily-tasks","personal-care"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id=10`);
  ok(await req('PUT', '/api/me/service-address', owner, { revision: 0, address: home }));

  for(const form_key of ['p-agreement','p-consent-privacy'])ins('participant_docs',{participant_id:owner.id,form_key,uploaded_at:stamp});
  ins('support_plans',{participant_id:owner.id,version:1,current:1,status:'confirmed',created:stamp,updated:stamp,confirmed_at:stamp,reviewed_at:stamp,reviewed_by:'Synthetic reviewer',review_due:'2031-12-31'});
  const input=(date,extra={})=>({worker_id:worker.id,service:'personal-care',date,start:'19:20',hours:3,repeat:'weekly',repeat_count:3,...extra});
  const preview=(body,person=owner,forId)=>req('POST','/api/bookings/preview',person,body,forId);
  const create=(body,person=owner,forId)=>req('POST','/api/bookings',person,body,forId);
  const count=table=>db.prepare('SELECT count(*) n FROM '+table).get().n;
  let routine;
  await test('Preview requires participant booking authority, including current helper scopes',async()=>{
    ok(await preview(input('2030-10-07'),null),401);ok(await preview(input('2030-10-07'),worker),403);
    ok(await preview(input('2030-10-07'),helper,owner.id));
    db.prepare("UPDATE account_links SET scopes='[\"workers\"]' WHERE id=?").run(linkId);
    ok(await preview(input('2030-10-07'),helper,owner.id),403);
    db.prepare("UPDATE account_links SET scopes='[\"bookings\"]' WHERE id=?").run(linkId);
  });
  await test('Per-date preview uses real quotes and leaves bookings, series, receipts and message outbox untouched',async()=>{
    const tables=['bookings','booking_series','booking_request_receipts','delivery_outbox'],before=tables.map(count);
    const p=ok(await preview(input('2030-10-07')));assert.equal(p.selected_count,3);assert.equal(p.ready,true);assert.equal(p.total,976.8);
    assert.deepEqual(p.dates.map(e=>e.date),['2030-10-07','2030-10-14','2030-10-21']);assert.equal(p.quote_keys.length,3);
    for(const e of p.dates){assert.equal(e.available,true);assert.equal(e.quote.total,e.date==='2030-10-07'?490.38:243.21);assertPrivateAbsent(e);assert.equal('fit' in e,false);}
    assert.deepEqual(tables.map(count),before);
  });
  await test('One unavailable date has a safe individual explanation and prevents partial creation',async()=>{
    const id=booking({participant_id:other.id,date:'2030-10-14',start:'20:00',hours:2});
    const p=ok(await preview(input('2030-10-07')));assert.deepEqual(p.dates.map(e=>e.available),[true,false,true]);assert.equal(p.ready,false);
    assert.match(p.dates[1].problem,/overlap/);for(const hidden of ['participant_name','clash_booking_id','profile','training'])assert.equal(JSON.stringify(p).includes(hidden),false);
    const before=count('bookings');ok(await create(input('2030-10-07')),409);assert.equal(count('bookings'),before);assert.equal(row(id).status,'accepted');
  });
  await test('Skipping the clashing date creates only the reviewed dates with their original pricing policy',async()=>{
    const body=input('2030-10-07',{repeat_skip_dates:['2030-10-14'],request_id:'routine-test-request-001'}),p=ok(await preview(body));
    assert.equal(p.ready,true);assert.equal(p.selected_count,2);assert.equal(p.skipped_count,1);assert.equal(p.total,733.59);assert.equal(p.dates[1].selected,false);assert.equal(p.dates[1].quote.total,243.21);
    routine={body:{...body,quote_keys:p.quote_keys},result:ok(await create({...body,quote_keys:p.quote_keys}))};assert.equal(routine.result.count,2);
    const visits=routine.result.ids.map(row);assert.deepEqual(visits.map(v=>v.date),['2030-10-07','2030-10-21']);assert.ok(visits.every(v=>v.status==='requested'&&v.pricing_policy==='continuous-weekday-v2'));
    assert.deepEqual(visits.map(v=>JSON.parse(v.booking_quote).quote_key),p.quote_keys);assert.equal(db.prepare('SELECT occurrences FROM booking_series WHERE id=?').get(routine.result.series_id).occurrences,2);
  });
  await test('An unchanged retry returns the same receipt and never adds duplicate visits or notifications',async()=>{
    const before=['bookings','booking_series','delivery_outbox','booking_request_receipts'].map(count);
    const repeated=ok(await create(routine.body));assert.equal(repeated.duplicate,true);assert.deepEqual(repeated.ids,routine.result.ids);
    assert.deepEqual(['bookings','booking_series','delivery_outbox','booking_request_receipts'].map(count),before);
    ok(await create({...routine.body,notes:'Different request intent'}),409);
    ok(await create({...routine.body,request_id:'bad'}),400);
  });
  await test('Skip selections must be unique, real, inside the generated recurrence, and retain one visit',async()=>{
    const before=count('bookings');
    for(const repeat_skip_dates of ['2030-11-04',['2030-11-05'],['2030-11-04','2030-11-04'],['2030-02-31'],['2030-11-04','2030-11-11','2030-11-18']]){
      ok(await preview(input('2030-11-04',{repeat_skip_dates})),400);ok(await create(input('2030-11-04',{repeat_skip_dates})),400);
    }
    ok(await preview(input('2030-11-04',{repeat:'',repeat_skip_dates:['2030-11-04']})),400);
    for(const repeat_count of [27,0,-1,2.5])ok(await preview(input('2030-11-04',{repeat_count})),400);
    assert.equal(count('bookings'),before);
  });
  await test('A skipped first date leaves the first actual visit and series boundary consistent',async()=>{
    const body=input('2030-11-04',{repeat_skip_dates:['2030-11-04']}),p=ok(await preview(body));
    const r=ok(await create({...body,quote_keys:p.quote_keys}));assert.equal(row(r.id).date,'2030-11-11');assert.equal(db.prepare('SELECT first_date FROM booking_series WHERE id=?').get(r.series_id).first_date,'2030-11-11');
  });
  await test('Fortnightly dates survive daylight saving and every recurrence is capped at 26',async()=>{
    const p=ok(await preview(input('2030-09-23',{repeat:'fortnightly',repeat_count:4,start:'10:00'})));assert.deepEqual(p.dates.map(e=>e.date),['2030-09-23','2030-10-07','2030-10-21','2030-11-04']);
    ok(await preview(input('2030-12-02',{repeat_count:undefined,repeat_until:'2032-01-01',start:'10:00'})),400);const limit=ok(await preview(input('2030-12-02',{repeat_count:26,start:'10:00'})));assert.equal(limit.dates.length,26);assert.equal(limit.limit,26);
  });
  await test('A nonexistent daylight-saving time is isolated to that date and can be skipped before booking',async()=>{
    const body=input('2030-09-29',{start:'02:30',hours:2,repeat_count:2});const p=ok(await preview(body));
    assert.equal(p.dates[0].quote!==null,true);assert.equal(p.dates[1].quote,null);assert.equal(p.dates[1].available,false);assert.match(p.dates[1].problem,/daylight saving/);assert.equal(p.total,null);
    ok(await create(body),400);const skip={...body,repeat_skip_dates:['2030-10-06']},shown=ok(await preview(skip));assert.equal(shown.ready,true);assert.equal(ok(await create({...skip,quote_keys:shown.quote_keys})).count,1);
  });
  await test('Sleepovers retain the flat per-night quote and series metadata',async()=>{
    const body=input('2030-12-03',{start:'22:00',hours:8,sleepover:true,repeat_count:2}),p=ok(await preview(body));assert.equal(p.dates[0].quote.support_type,'sleepover');assert.equal(p.dates[0].quote.total,311.79);assert.equal(p.total,623.58);
    const r=ok(await create({...body,quote_keys:p.quote_keys})),sr=ok(await req('GET','/api/series',owner)).series.find(s=>s.id===r.series_id);assert.equal(sr.sleepover,true);assert.equal(sr.requested,2);assert.equal(sr.accepted,0);
  });
  await test('Changed quote keys reject the whole request before any booking is committed',async()=>{
    const before=count('bookings');ok(await create(input('2031-01-06',{quote_keys:['bad','bad','bad']})),409);assert.equal(count('bookings'),before);
  });
  await test('Out-of-area preview is a confirmation requirement and never grants permission by itself',async()=>{
    const body=input('2031-01-07',{repeat_count:2,service_location:{mode:'other',street:'42 Other Synthetic Lane',suburb:'Wollongong',state:'NSW',postcode:'2500'}});
    const p=ok(await preview(body));assert.equal(p.ready,false);assert.equal(p.needs_confirmation,true);assert.equal(p.dates[0].needs_confirmation,true);assert.equal('out_of_area_token' in p.dates[0],false);
    const first=ok(await create({...body,quote_keys:p.quote_keys}),409);assert.equal(first.confirm,true);assert.ok(first.out_of_area_token);
    const changed={...body,repeat_skip_dates:['2031-01-14'],quote_keys:[p.quote_keys[0]],out_of_area_ok:true,out_of_area_token:first.out_of_area_token};ok(await create(changed),409);
    const final=ok(await create({...body,quote_keys:p.quote_keys,out_of_area_ok:true,out_of_area_token:first.out_of_area_token}));assert.equal(final.count,2);assert.ok(final.ids.every(id=>row(id).out_of_area));
  });
  await test('Revoked helper access cannot replay another participant’s successful request',async()=>{
    ok(await create(routine.body,helper,owner.id));db.prepare("UPDATE account_links SET status='revoked' WHERE id=?").run(linkId);
    ok(await create(routine.body,helper,owner.id),403);ok(await req('GET','/api/series',helper,undefined,owner.id),403);
    db.prepare("UPDATE account_links SET status='active' WHERE id=?").run(linkId);
    assert.equal(ok(await req('GET','/api/series',other)).series.some(s=>s.id===routine.result.series_id),false);
  });
  await test('Routine counts and calendar distinguish accepted, requested and independently moved visits',async()=>{
    db.prepare("UPDATE bookings SET status='accepted' WHERE id=?").run(routine.result.ids[0]);
    const sr=ok(await req('GET','/api/series',owner)).series.find(s=>s.id===routine.result.series_id);assert.equal(sr.accepted,1);assert.equal(sr.requested,1);assert.equal(sr.remaining,2);assert.equal(sr.next_date,'2030-10-07');assert.equal(sr.last_date,'2030-10-21');
    db.prepare('UPDATE bookings SET detached=1 WHERE id=?').run(routine.result.ids[1]);
    const after=ok(await req('GET','/api/series',owner)).series.find(s=>s.id===sr.id);assert.equal(after.remaining,1);assert.equal(after.upcoming.length,1);
    const calendar=ok(await req('GET','/api/bookings/calendar?view=week&date=2030-10-21',owner));assert.equal(calendar.bookings.find(b=>b.id===routine.result.ids[1]).detached,true);
  });
  await test('Unresolved cover is not reported as a confirmed routine visit',async()=>{
    db.prepare("UPDATE bookings SET status='accepted',cover_state='finding' WHERE id=?").run(routine.result.ids[0]);
    const sr=ok(await req('GET','/api/series',owner)).series.find(s=>s.id===routine.result.series_id);assert.equal(sr.accepted,0);assert.equal(sr.requested,0);assert.equal(sr.cover,1);assert.equal(sr.remaining,1);assert.equal(sr.upcoming[0].cover_state,'finding');
    db.prepare("UPDATE bookings SET cover_state='' WHERE id=?").run(routine.result.ids[0]);
  });
  await test('A transaction failure rolls back the complete series, all notices and retry receipt',async()=>{
    const before=['bookings','booking_series','delivery_outbox','booking_request_receipts'].map(count);
    db.exec("CREATE TRIGGER synthetic_routine_abort BEFORE INSERT ON bookings WHEN NEW.date='2031-02-17' BEGIN SELECT RAISE(ABORT,'synthetic routine transaction failure'); END");
    ok(await create(input('2031-02-03',{request_id:'routine-atomic-failure'})),500);
    assert.deepEqual(['bookings','booking_series','delivery_outbox','booking_request_receipts'].map(count),before);db.exec('DROP TRIGGER synthetic_routine_abort');
    assert.equal(ok(await create(input('2031-02-03',{request_id:'routine-atomic-failure'}))).count,3);
  });
  await test('Existing one-off and recurring callers work without skip or request identity fields',async()=>{
    assert.equal(ok(await create(input('2031-03-03',{repeat:''}))).count,1);assert.equal(ok(await create(input('2031-03-04',{repeat_count:2}))).count,2);
  });
}
main().catch(error=>{console.error(error);results.push({name:'HTTP fixture',result:'FAIL',error:error.stack});}).finally(async()=>{
  if(db)db.close();if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  if(process.env.CARE_ROUTINE_RESULTS)fs.writeFileSync(process.env.CARE_ROUTINE_RESULTS,JSON.stringify({runtime:process.version,scope:'Disposable synthetic accounts; external network blocked',results,serverLog:log},null,2));
  fs.rmSync(DIR,{recursive:true,force:true});console.log(`care routine flow: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
});
