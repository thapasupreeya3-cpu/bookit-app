'use strict';
// Actual routes, a disposable database and synthetic identities. A preload
// blocks all external traffic, including payment, email and calendar services.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-ongoing-review-http-'));
const stamp = new Date().toISOString(), password = 'Copper-Rainstorm!82', results = [];
const home = { street: '41 Synthetic Private Lane', suburb: 'Ryde', state: 'NSW', postcode: '2112', arrival_notes: 'Synthetic private door instruction.' };
const note = 'Delivered the agreed overnight personal support, assisted with the planned activities and recorded the participant outcome.';
const clockFile=path.join(DIR,'clock.txt'); fs.writeFileSync(clockFile,'2030-09-16T01:00:00.000Z');
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
  const email = 'ongoing-review-' + label + '@example.test';
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
const fs=require('node:fs'),NativeDate=Date,clockPath=${JSON.stringify(clockFile)};
global.Date=class extends NativeDate { constructor(...args){ super(...(args.length?args:[fs.readFileSync(clockPath,'utf8').trim()])); } static now(){return NativeDate.parse(fs.readFileSync(clockPath,'utf8').trim());} };

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

  // Let the real initial startup reconciliation finish before advancing the clock.
  await new Promise(resolve=>setTimeout(resolve,2300));
  const input=(date,extra={})=>({worker_id:worker.id,service:'personal-care',date,start:'19:20',hours:3,repeat:'weekly',repeat_end_mode:'ongoing',...extra});
  const preview=body=>req('POST','/api/bookings/preview',owner,body);
  const create=async(body,person=owner,forId)=>{const p=ok(await req('POST','/api/bookings/preview',person,body,forId));return ok(await req('POST','/api/bookings',person,{...body,quote_keys:p.quote_keys},forId));};
  const visits=id=>db.prepare('SELECT * FROM bookings WHERE series_id=? ORDER BY series_index,id').all(id);
  const series=id=>db.prepare('SELECT * FROM booking_series WHERE id=?').get(id);
  const retry=(id,person=owner,forId)=>req('POST','/api/series/'+id+'/retry',person,{},forId);
  async function refresh(person,pass=password){const r=await req('POST','/api/login',null,{email:person.email||db.prepare('SELECT email FROM users WHERE id=?').get(person.id).email,password:pass});ok(r);person.cookie=r.cookie;}
  async function clock(at){fs.writeFileSync(clockFile+'.next',at);fs.renameSync(clockFile+'.next',clockFile);await refresh(owner);await refresh(helper);await refresh(admin,'demo1234');}
  let mainRoutine,helperRoutine,sleepRoutine,withdrawnRoutine,finiteRoutine,boundedRoutine;
  const quotes=new Map();
  await test('Initial ongoing preview remains read-only; skipped date is retained and no total recurrence cap is reported',async()=>{
    const n=db.prepare('SELECT count(*) n FROM bookings').get().n;
    const body=input('2030-09-23',{repeat_skip_dates:['2030-11-04'],request_id:'ongoing-independent-001'}),p=ok(await preview(body));
    assert.equal(p.limit,undefined);assert.equal(p.horizon_weeks,8);assert.equal(p.selected_count,7);assert.equal(p.repeat_end_mode,'ongoing');assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,n);
    mainRoutine=await create(body);assert.equal(visits(mainRoutine.series_id).length,7);
    assert.equal(db.prepare("SELECT state FROM care_routine_dates WHERE series_id=? AND date='2030-11-04'").get(mainRoutine.series_id).state,'skipped');
    for(const b of visits(mainRoutine.series_id))quotes.set(b.id,b.booking_quote);
  });
  await test('Persisted routine snapshots retain inactive sleepover and original visit location',async()=>{
    sleepRoutine=await create(input('2030-09-24',{start:'22:00',hours:8,sleepover:true}));
    const config=JSON.parse(db.prepare('SELECT config FROM care_routine_rules WHERE series_id=?').get(sleepRoutine.series_id).config);
    assert.equal(config.sleepover,true);assert.equal(config.service_location.street,home.street);assert.notEqual(config.service_location.mode,'saved');
    ok(await req('PUT','/api/me/service-address',owner,{revision:1,address:{...home,street:'99 New Synthetic Home Lane',arrival_notes:'New house'}}));
    assert.equal(JSON.parse(db.prepare('SELECT data FROM booking_locations WHERE booking_id=?').get(sleepRoutine.id).data).street,home.street);
  });
  await test('New helper-created and date-ended routines coexist with legacy finite series',async()=>{
    helperRoutine=await create(input('2030-09-25',{start:'09:00'}),helper,owner.id);
    withdrawnRoutine=await create(input('2030-09-26',{start:'09:00'}));
    finiteRoutine=await create(input('2030-09-27',{start:'09:00',repeat_end_mode:undefined,repeat_count:2}));
    boundedRoutine=await create(input('2030-09-28',{start:'09:00',repeat_end_mode:'date',repeat_until:'2030-12-07'}));
    assert.equal(series(finiteRoutine.series_id).auto_extend,0);assert.equal(series(helperRoutine.series_id).created_by,helper.id);
    assert.equal(series(boundedRoutine.series_id).until_date,'2030-12-07');
  });
  await test('Retry endpoint enforces the current participant and helper scope',async()=>{
    ok(await retry(mainRoutine.series_id,other),403);ok(await retry(mainRoutine.series_id,worker),403);ok(await retry(mainRoutine.series_id,null),401);
    db.prepare("UPDATE account_links SET status='revoked' WHERE id=?").run(linkId);
    ok(await retry(helperRoutine.series_id,helper,owner.id),403);
  });
  await test('Rolling generation never recreates skipped, cancelled or independently moved visits',async()=>{
    const rows=visits(mainRoutine.series_id),cancel=rows.find(b=>b.date==='2030-10-28'),detach=rows.find(b=>b.date==='2030-11-11');
    db.prepare("UPDATE bookings SET status='cancelled',cancelled_at=? WHERE id=?").run(stamp,cancel.id);
    db.prepare("UPDATE bookings SET detached=1,date='2030-11-13',start='13:00' WHERE id=?").run(detach.id);
    await clock('2030-10-26T01:00:00.000Z');
    const r=ok(await retry(mainRoutine.series_id));assert.ok(r.created>0);
    assert.equal(row(cancel.id).status,'cancelled');assert.equal(row(detach.id).date,'2030-11-13');
    const current=visits(mainRoutine.series_id);assert.equal(current.filter(b=>b.date==='2030-11-04').length,0);assert.equal(current.filter(b=>b.date==='2030-11-11').length,0);assert.equal(current.filter(b=>b.id===detach.id).length,1);
    for(const [id,value]of quotes)assert.equal(row(id).booking_quote,value,'An existing agreed quote was overwritten');
    assert.ok(current.filter(b=>!quotes.has(b.id)).every(b=>b.status==='requested'&&b.pricing_policy==='continuous-weekday-v2'));
    const before=current.length,outbox=db.prepare('SELECT count(*) n FROM delivery_outbox').get().n;
    assert.equal(ok(await retry(mainRoutine.series_id)).created,0);assert.equal(visits(mainRoutine.series_id).length,before);assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox').get().n,outbox);
  });
  await test('Revoking the original helper stops new requests and leaves confirmed records intact',async()=>{
    const before=visits(helperRoutine.series_id).length,r=ok(await retry(helperRoutine.series_id));
    assert.equal(r.created,0);assert.ok(r.issues>0);assert.equal(visits(helperRoutine.series_id).length,before);
    const sr=ok(await req('GET','/api/series',owner)).series.find(s=>s.id===helperRoutine.series_id);assert.ok(sr.generation_issues.some(i=>/booking access/.test(i.message)));
    assertPrivateAbsent(sr);
    const alert=ok(await req('GET','/api/me/action-alerts',owner)).tasks.find(t=>t.destination==='#/bookings?view=routine&routine='+helperRoutine.series_id);
    assert.ok(alert,'Future request failure is missing from Next actions');assert.equal(alert.scope,'bookings');assert.equal(alert.owner_kind,'person');
    ok(await req('PATCH','/api/series/'+helperRoutine.series_id,owner,{notes:'Participant reviewed and adopted the unchanged routine.'}));
    assert.equal(series(helperRoutine.series_id).created_by,owner.id);assert.ok(visits(helperRoutine.series_id).length>before);
  });
  await test('A withdrawal review holds future generation until its recorded resolution',async()=>{
    db.prepare("UPDATE booking_series SET review_required=1 WHERE id=?").run(withdrawnRoutine.series_id);
    const before=visits(withdrawnRoutine.series_id).length,r=ok(await retry(withdrawnRoutine.series_id));assert.equal(r.created,0);assert.ok(r.issues>0);assert.equal(visits(withdrawnRoutine.series_id).length,before);
    db.prepare('UPDATE booking_series SET review_required=0 WHERE id=?').run(withdrawnRoutine.series_id);assert.ok(ok(await retry(withdrawnRoutine.series_id)).created>0);
  });
  await test('Automatic inactive nights keep the agreed flat-night basis and original private location',async()=>{
    const initial=new Set(visits(sleepRoutine.series_id).map(b=>b.id));assert.ok(ok(await retry(sleepRoutine.series_id)).created>0);
    for(const b of visits(sleepRoutine.series_id).filter(b=>!initial.has(b.id))){assert.equal(b.sleepover,1);const q=JSON.parse(b.booking_quote);assert.equal(q.support_type,'sleepover');assert.equal(q.total,311.79);assert.equal(q.lines[0].unit,'night');assert.equal(JSON.parse(db.prepare('SELECT data FROM booking_locations WHERE booking_id=?').get(b.id).data).street,home.street);}
  });
  await test('Legacy finite series never become ongoing when explicitly retried',async()=>{
    assert.equal(ok(await retry(finiteRoutine.series_id)).created,0);assert.equal(visits(finiteRoutine.series_id).length,2);assert.equal(series(finiteRoutine.series_id).auto_extend,0);
  });
  await test('Participant block stops future requests and retry recovers after the block is removed',async()=>{
    await clock('2030-11-04T01:00:00.000Z');
    ins('participant_workers',{participant_id:owner.id,worker_id:worker.id,relation:'blocked',note:'Synthetic block',added:stamp,updated:stamp});
    const before=visits(mainRoutine.series_id).length,r=ok(await retry(mainRoutine.series_id));assert.equal(r.created,0);assert.ok(r.issues>0);assert.equal(visits(mainRoutine.series_id).length,before);
    db.prepare('DELETE FROM participant_workers WHERE participant_id=? AND worker_id=?').run(owner.id,worker.id);assert.ok(ok(await retry(mainRoutine.series_id)).created>0);
  });
  await test('Ending an ongoing routine cancels attached future visits and prevents further generation',async()=>{
    const p=ok(await req('GET','/api/journey/series/'+withdrawnRoutine.series_id+'/end-preview',owner));
    ok(await req('POST','/api/series/'+withdrawnRoutine.series_id+'/end',owner,{confirm:true,expires:p.expires,token:p.token}));
    const before=visits(withdrawnRoutine.series_id).length;ok(await retry(withdrawnRoutine.series_id),409);assert.equal(visits(withdrawnRoutine.series_id).length,before);
    assert.equal(ok(await req('GET','/api/series',owner)).series.find(s=>s.id===withdrawnRoutine.series_id).continues_automatically,false);
  });
  await test('Date-ended generation includes the end date and stops after it',async()=>{
    ok(await retry(boundedRoutine.series_id));assert.equal(visits(boundedRoutine.series_id).at(-1).date,'2030-12-07');
    await clock('2030-12-09T01:00:00.000Z');assert.equal(ok(await retry(boundedRoutine.series_id)).created,0);assert.equal(visits(boundedRoutine.series_id).at(-1).date,'2030-12-07');
    assert.equal(ok(await req('GET','/api/series',owner)).series.find(s=>s.id===boundedRoutine.series_id).continues_automatically,false);
  });
  await test('One failing background routine is rolled back while the other routines still advance',async()=>{
    const before=visits(mainRoutine.series_id).length,otherBefore=visits(helperRoutine.series_id).length;
    db.exec(`CREATE TRIGGER review_abort_generation BEFORE INSERT ON bookings WHEN NEW.series_id=${mainRoutine.series_id} AND NEW.date='2030-12-30' BEGIN SELECT RAISE(ABORT,'Synthetic generator regression'); END`);
    await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
    child=spawn(process.execPath,['--no-warnings','--require',guard,'server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
    for(let n=0;n<120;n++){const job=db.prepare("SELECT * FROM job_runs WHERE job='care-routines'").get();if(job?.last_error)break;if(child.exitCode!==null)throw Error(log);await new Promise(resolve=>setTimeout(resolve,50));}
    const job=db.prepare("SELECT * FROM job_runs WHERE job='care-routines'").get();assert.match(job.last_error,/generation failed/);assert.equal(visits(mainRoutine.series_id).length,before);assert.ok(visits(helperRoutine.series_id).length>otherBefore,'A bad routine prevented a healthy routine from advancing');
    const issues=db.prepare("SELECT message FROM care_routine_dates WHERE series_id=? AND state='issue'").all(mainRoutine.series_id);assert.ok(issues.length);assert.ok(issues.every(i=>!i.message.includes('Synthetic generator regression')));
  });
  await test('A saved routine edit returns success plus visible retry guidance when subsequent generation fails',async()=>{
    await refresh(owner);const before=visits(mainRoutine.series_id).length;
    const result=ok(await req('PATCH','/api/series/'+mainRoutine.series_id,owner,{notes:'Committed note edit retained despite later generator failure.'}));
    assert.match(result.generation_warning,/changes were saved/i);assert.equal(series(mainRoutine.series_id).notes,'Committed note edit retained despite later generator failure.');assert.equal(visits(mainRoutine.series_id).length,before);
    assert.ok(db.prepare("SELECT count(*) n FROM care_routine_dates WHERE series_id=? AND state='issue'").get(mainRoutine.series_id).n>0);
    const notices=db.prepare("SELECT payload FROM delivery_outbox WHERE payload LIKE '%booking_event%' AND payload LIKE '%changed%'").all();assert.ok(notices.length,'Committed routine edits did not queue change notices');
    db.exec('DROP TRIGGER review_abort_generation');
  });
  await test('A cold restart catches up the routine horizon once without duplicating requests',async()=>{
    const initial=visits(mainRoutine.series_id).length;
    await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
    child=spawn(process.execPath,['--no-warnings','--require',guard,'server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
    for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/version')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    for(let n=0;n<120;n++){if(visits(mainRoutine.series_id).length>initial)break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.ok(visits(mainRoutine.series_id).length>initial,'Startup did not reconcile the overdue horizon: '+JSON.stringify({job:db.prepare("SELECT * FROM job_runs WHERE job='care-routines'").get(),issues:db.prepare("SELECT * FROM care_routine_dates WHERE series_id=? AND state='issue'").all(mainRoutine.series_id)}));
    await refresh(owner);const before=visits(mainRoutine.series_id).length;assert.equal(ok(await retry(mainRoutine.series_id)).created,0);assert.equal(visits(mainRoutine.series_id).length,before);
    assert.equal(new Set(visits(mainRoutine.series_id).map(b=>b.series_index)).size,before);
  });
  await test('Out-of-area routines require fresh consent for only the outstanding dates and preserve ordinary assignment checks',async()=>{
    const previousAreas=db.prepare('SELECT service_areas FROM worker_profiles WHERE user_id=?').get(worker.id).service_areas;
    try{
      db.prepare('UPDATE worker_profiles SET service_areas=? WHERE user_id=?').run('["Blacktown NSW"]',worker.id);
      const body=input('2031-01-06',{start:'13:00'}),p=ok(await preview(body));
      const requested={...body,quote_keys:p.quote_keys};
      const first=ok(await req('POST','/api/bookings',owner,requested),409);
      const made=ok(await req('POST','/api/bookings',owner,{...requested,out_of_area_ok:true,out_of_area_token:first.out_of_area_token}));
      assert.equal(made.count,8);
      await clock('2031-02-10T01:00:00.000Z');
      const initial=visits(made.series_id).length;
      await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
      child=spawn(process.execPath,['--no-warnings','--require',guard,'server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
      for(let n=0;n<120;n++){if(db.prepare("SELECT count(*) n FROM care_routine_dates WHERE series_id=? AND state='issue'").get(made.series_id).n)break;if(child.exitCode!==null)throw Error(log);await new Promise(resolve=>setTimeout(resolve,50));}
      assert.equal(visits(made.series_id).length,initial,'Background generation reused initial travel consent');
      assert.ok(db.prepare("SELECT count(*) n FROM care_routine_dates WHERE series_id=? AND state='issue'").get(made.series_id).n);
      await refresh(owner);
      const challenge=ok(await retry(made.series_id),409);
      assert.ok(challenge.travel.routine_dates.length>0);assert.ok(challenge.travel.routine_dates.every(date=>date>'2031-02-24'));
      const confirmed={out_of_area_ok:true,out_of_area_token:challenge.out_of_area_token};
      // Even another address on the same street/locality needs fresh consent.
      const saved=JSON.parse(db.prepare('SELECT config FROM care_routine_rules WHERE series_id=?').get(made.series_id).config);
      db.prepare('UPDATE care_routine_rules SET config=? WHERE series_id=?').run(JSON.stringify({...saved,service_location:{...saved.service_location,unit:'Unit 9'}}),made.series_id);
      const changedPlace=ok(await req('POST','/api/series/'+made.series_id+'/retry',owner,confirmed),409);
      assert.ok(changedPlace.out_of_area_token);assert.equal(visits(made.series_id).length,initial);
      const fresh={out_of_area_ok:true,out_of_area_token:changedPlace.out_of_area_token};
      // A valid travel proof does not override a diary conflict.
      const blockedDate=changedPlace.travel.routine_dates[0];
      const clash=booking({date:blockedDate,start:'13:00',hours:3,status:'accepted'});
      const added=ok(await req('POST','/api/series/'+made.series_id+'/retry',owner,fresh));
      assert.equal(added.created,changedPlace.travel.routine_dates.length-1);assert.equal(added.issues,1);
      assert.ok(!visits(made.series_id).some(b=>b.date===blockedDate));
      for(const b of visits(made.series_id).filter(b=>changedPlace.travel.routine_dates.includes(b.date))){const travel=JSON.parse(b.out_of_area);assert.equal(travel.actor_id,owner.id);assert.deepEqual(travel.routine_dates,changedPlace.travel.routine_dates);assert.equal(b.status,'requested');}
      db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(clash);
      // The outstanding date set changed; the old group token cannot apply.
      const oneDate=ok(await req('POST','/api/series/'+made.series_id+'/retry',owner,fresh),409);
      assert.deepEqual(oneDate.travel.routine_dates,[blockedDate]);
      assert.equal(ok(await req('POST','/api/series/'+made.series_id+'/retry',owner,{out_of_area_ok:true,out_of_area_token:oneDate.out_of_area_token})).created,1);
      assert.equal(ok(await retry(made.series_id)).created,0);
      await clock('2031-02-17T01:00:00.000Z');
      const later=ok(await retry(made.series_id),409);assert.ok(later.travel.routine_dates.every(date=>!changedPlace.travel.routine_dates.includes(date)));
      assert.equal(visits(made.series_id).length,initial+changedPlace.travel.routine_dates.length,'Later dates reused an earlier approval');
    }finally{db.prepare('UPDATE worker_profiles SET service_areas=? WHERE user_id=?').run(previousAreas,worker.id);}
  });
  await test('Participant de-identification clears the new private routine address and disables generation',async()=>{
    // A historical completed visit selects the retention/de-identification path.
    booking({date:'2030-08-01',status:'completed'});await refresh(admin,'demo1234');
    ok(await req('DELETE','/api/admin/users/'+owner.id,admin,{reason:'Synthetic privacy regression account closure.',acknowledge:true}));
    assert.equal(db.prepare('SELECT count(*) n FROM care_routine_rules WHERE series_id IN (SELECT id FROM booking_series WHERE participant_id=?)').get(owner.id).n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM booking_series WHERE participant_id=? AND auto_extend=1').get(owner.id).n,0);
    assert.ok(db.prepare('SELECT closed_at FROM users WHERE id=?').get(owner.id).closed_at);
  });
}
main().catch(error=>{console.error(error);results.push({name:'Independent HTTP fixture',result:'FAIL',error:error.stack});}).finally(async()=>{
  if(db)db.close();if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  if(process.env.ONGOING_REVIEW_RESULTS)fs.writeFileSync(process.env.ONGOING_REVIEW_RESULTS,JSON.stringify({runtime:process.version,scope:'Disposable synthetic accounts; external network blocked; controllable test clock',results,serverLog:log},null,2));
  fs.rmSync(DIR,{recursive:true,force:true});console.log(`ongoing independent review: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
});
