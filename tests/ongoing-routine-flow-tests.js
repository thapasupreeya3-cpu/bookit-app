'use strict';
// Actual routes, a disposable database and synthetic identities. A preload
// blocks all external traffic, including payment, email and calendar services.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-ongoing-routine-http-'));
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
  const clock=path.join(DIR,'clock.txt');fs.writeFileSync(clock,'2030-01-01T00:00:00.000Z');
  fs.appendFileSync(guard,`\nconst fs=require('node:fs'),NativeDate=Date,clock=${JSON.stringify(clock)};function clockNow(){return NativeDate.parse(fs.readFileSync(clock,'utf8'));}global.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[clockNow()]));}static now(){return clockNow();}};`);
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', SESSION_SECRET: 'synthetic-care-routine-price-key-with-more-than-32-characters', TZ: 'Australia/Sydney' };
  child = spawn(process.execPath, ['--no-warnings', '--require', guard, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error(log); try { if ((await fetch(base + '/api/version')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  db = new DatabaseSync(env.DB_PATH); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); other = await register('other'); helper = await register('helper');
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id); db.prepare('UPDATE users SET verified=1 WHERE id=?').run(owner.id); db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  linkId = ins('account_links', { participant_id: owner.id, coordinator_id: helper.id, invite_email: helper.email, invite_token: 'synthetic-care-routine-link', scopes: '["bookings"]', status: 'active', invited_at: stamp });
  admin = await login(1); worker = await login(10);
  db.exec(`UPDATE users SET suburb='Ryde NSW' WHERE id=10;UPDATE worker_profiles SET visible=1,self_paused=0,days='[1,1,1,1,1,1,1]',service_areas='["Ryde NSW"]',availability_windows=NULL,leave_dates='[]',services='["daily-tasks","personal-care"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2040-01-01' WHERE worker_id=10`);
  ok(await req('PUT', '/api/me/service-address', owner, { revision: 0, address: home }));

  for(const form_key of ['p-agreement','p-consent-privacy'])ins('participant_docs',{participant_id:owner.id,form_key,uploaded_at:stamp});
  ins('support_plans',{participant_id:owner.id,version:1,current:1,status:'confirmed',created:stamp,updated:stamp,confirmed_at:stamp,reviewed_at:stamp,reviewed_by:'Synthetic reviewer',review_due:'2040-12-31'});
  await new Promise(resolve=>setTimeout(resolve,2200)); // Let the startup reconciliation finish while there are no routines.
  const input=(date,extra={})=>({worker_id:worker.id,service:'personal-care',date,start:'10:00',hours:3,repeat:'weekly',repeat_end_mode:'ongoing',...extra});
  const preview=body=>req('POST','/api/bookings/preview',owner,body);
  const create=body=>req('POST','/api/bookings',owner,body);
  const visits=id=>db.prepare('SELECT * FROM bookings WHERE series_id=? ORDER BY date,id').all(id);
  const series=id=>req('GET','/api/series',owner).then(ok).then(r=>r.series.find(s=>s.id===id));
  const retry=id=>req('POST','/api/series/'+id+'/retry',owner,{}).then(ok);
  async function advance(value){fs.writeFileSync(clock+'.next',value+'T00:00:00.000Z');fs.renameSync(clock+'.next',clock);const r=await req('POST','/api/login',null,{email:owner.email,password});ok(r);owner.cookie=r.cookie;}
  let ongoing,dateEnded,skipped;
  await test('Ongoing preview requests eight weeks and discloses that its total is only a preview',async()=>{
    const p=ok(await preview(input('2030-01-07')));assert.equal(p.repeat_end_mode,'ongoing');assert.equal(p.dates.length,8);assert.equal(p.generated_through,'2030-02-25');assert.equal(p.horizon_weeks,8);assert.equal(p.continues_automatically,true);assert.equal('limit' in p,false);assert.equal(p.total,p.dates.reduce((n,e)=>n+e.quote.total,0));
    const r=ok(await create({...input('2030-01-07'),quote_keys:p.quote_keys,request_id:'ongoing-rule-request'}));ongoing=r.series_id;assert.equal(r.count,8);assert.ok(visits(ongoing).every(b=>b.status==='requested'&&!b.invoice_no));
  });
  await test('A specific end date years away is accepted without expanding years of bookings',async()=>{
    const body=input('2030-01-08',{repeat_end_mode:'date',repeat_until:'2032-02-10'}),p=ok(await preview(body));assert.equal(p.dates.length,8);assert.equal(p.until_date,'2032-02-10');assert.equal(p.continues_automatically,true);
    dateEnded=ok(await create({...body,quote_keys:p.quote_keys})).series_id;assert.equal(visits(dateEnded).length,8);
    ok(await preview(input('2030-01-09',{repeat_end_mode:'date'})),400);ok(await preview(input('2030-01-09',{repeat_end_mode:'date',repeat_until:'2030-01-01'})),400);ok(await preview(input('2030-01-09',{repeat_end_mode:'count'})),400);
  });
  await test('Date end is inclusive and never creates an occurrence after the chosen date',async()=>{
    const body=input('2030-01-09',{repeat_end_mode:'date',repeat_until:'2030-01-23'}),p=ok(await preview(body));assert.deepEqual(p.dates.map(e=>e.date),['2030-01-09','2030-01-16','2030-01-23']);
    const id=ok(await create({...body,quote_keys:p.quote_keys})).series_id;await retry(id);assert.equal(visits(id).length,3);await advance('2030-02-01');assert.equal((await series(id)).continues_automatically,false);assert.equal((await retry(id)).created,0);await advance('2030-01-01');
  });
  await test('Skipped first and middle dates remain gaps in the same calendar rule',async()=>{
    const body=input('2030-01-10',{repeat_skip_dates:['2030-01-10','2030-01-24']}),p=ok(await preview(body));skipped=ok(await create({...body,quote_keys:p.quote_keys})).series_id;
    assert.equal(visits(skipped).length,6);assert.deepEqual(visits(skipped).map(b=>b.series_index),[2,4,5,6,7,8]);assert.equal((await series(skipped)).first_date,'2030-01-10');await retry(skipped);assert.equal(visits(skipped).length,6);
  });
  await test('Fortnightly preview holds local dates and skips the Sydney DST gap individually',async()=>{
    const p=ok(await preview(input('2030-09-23',{repeat:'fortnightly'})));assert.deepEqual(p.dates.map(e=>e.date),['2030-09-23','2030-10-07','2030-10-21','2030-11-04']);
    const gap=ok(await preview(input('2030-09-29',{start:'02:30',hours:2})));assert.equal(gap.dates.find(e=>e.date==='2030-10-06').available,false);assert.match(gap.dates.find(e=>e.date==='2030-10-06').problem,/daylight saving/);
  });
  await test('Repeated expansion crosses 26 visits without a total cap and never duplicates requests',async()=>{
    for(const day of ['2030-02-18','2030-04-08','2030-05-27','2030-07-15']){await advance(day);await retry(ongoing);await retry(dateEnded);}
    assert.ok(visits(ongoing).length>26);assert.ok(visits(dateEnded).length>26);assert.equal(new Set(visits(ongoing).map(b=>b.date)).size,visits(ongoing).length);assert.ok(visits(ongoing).every(b=>b.status==='requested'&&!b.invoice_no));
    const before=[visits(ongoing).length,db.prepare('SELECT count(*) n FROM delivery_outbox').get().n];await retry(ongoing);await retry(ongoing);assert.deepEqual([visits(ongoing).length,db.prepare('SELECT count(*) n FROM delivery_outbox').get().n],before);
  });
  await test('A future conflict becomes one clear issue while other dates continue, then retries cleanly',async()=>{
    await advance('2030-09-02');const clash=booking({participant_id:other.id,date:'2030-09-16',start:'11:00',hours:2});
    const r=await retry(ongoing);assert.ok(r.created>0);assert.equal(r.issues,1);let sr=await series(ongoing);assert.equal(sr.generation_issues.length,1);assert.equal(sr.generation_issues[0].date,'2030-09-16');assert.match(sr.generation_issues[0].message,/overlap/);assert.equal(visits(ongoing).some(b=>b.date==='2030-09-16'),false);
    db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(clash);assert.equal((await retry(ongoing)).created,1);sr=await series(ongoing);assert.deepEqual(sr.generation_issues,[]);
  });
  await test('Generation is atomic with its ledger and outbox on a database failure',async()=>{
    await advance('2030-10-21');const before=[visits(ongoing).length,db.prepare('SELECT count(*) n FROM care_routine_dates WHERE series_id=?').get(ongoing).n,db.prepare('SELECT count(*) n FROM delivery_outbox').get().n];
    db.exec("CREATE TRIGGER synthetic_generation_failure BEFORE INSERT ON bookings WHEN NEW.series_id="+ongoing+" AND NEW.date='2030-11-04' BEGIN SELECT RAISE(ABORT,'synthetic generation failure'); END");
    ok(await req('POST','/api/series/'+ongoing+'/retry',owner,{}),500);assert.deepEqual([visits(ongoing).length,db.prepare('SELECT count(*) n FROM care_routine_dates WHERE series_id=?').get(ongoing).n,db.prepare('SELECT count(*) n FROM delivery_outbox').get().n],before);
    db.exec('DROP TRIGGER synthetic_generation_failure');assert.ok((await retry(ongoing)).created>0);
  });
  await test('Ending a routine stops expansion permanently and preserves existing booking history',async()=>{
    const review=ok(await req('GET','/api/journey/series/'+ongoing+'/end-preview',owner));ok(await req('POST','/api/series/'+ongoing+'/end',owner,{confirm:true,token:review.token,expires:review.expires}));const before=visits(ongoing).length;
    await advance('2031-02-01');ok(await req('POST','/api/series/'+ongoing+'/retry',owner,{}),409);assert.equal(visits(ongoing).length,before);assert.equal((await series(ongoing)).continues_automatically,false);
  });
  await test('A routine catches up after downtime without fabricating passed visits',async()=>{
    const before=new Set(visits(dateEnded).map(b=>b.id));await retry(dateEnded);const added=visits(dateEnded).filter(b=>!before.has(b.id));assert.ok(added.length>0);assert.ok(added.every(b=>b.date>='2031-02-01'));assert.ok(added.every(b=>b.date<='2032-02-10'));
  });
  await test('The final rolling window stops exactly on the specific end date',async()=>{
    await advance('2032-01-01');await retry(dateEnded);assert.equal(visits(dateEnded).at(-1).date,'2032-02-10');await advance('2032-02-11');assert.equal((await retry(dateEnded)).created,0);assert.equal((await series(dateEnded)).auto_extend,false);
  });
  await test('An ongoing rule still extends automatically five years later after a cold restart',async()=>{
    const original=visits(skipped),originalIds=new Set(original.map(b=>b.id));
    const closedCounts=[visits(ongoing).length,visits(dateEnded).length];
    await advance('2035-04-01');
    await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
    child=spawn(process.execPath,['--no-warnings','--require',guard,'server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
    for(let n=0;n<160;n++){
      if(child.exitCode!==null)throw Error(log);
      if(visits(skipped).length>original.length)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const added=visits(skipped).filter(b=>!originalIds.has(b.id));
    assert.equal(added.length,8,'Startup must extend the saved rule without a participant retry');
    assert.ok(added.every(b=>b.date>='2035-04-01'&&b.date<'2035-05-27'&&b.series_index>260));
    assert.ok(added.every(b=>b.status==='requested'&&!b.invoice_no));
    for(const b of original)assert.equal(row(b.id).booking_quote,b.booking_quote);
    assert.deepEqual([visits(ongoing).length,visits(dateEnded).length],closedCounts,'Ended routines must remain ended');
    await advance('2035-04-01');
    const sr=await series(skipped);assert.equal(sr.repeat_end_mode,'ongoing');assert.equal(sr.until_date,'');assert.equal(sr.continues_automatically,true);
    const before=visits(skipped).length;assert.equal((await retry(skipped)).created,0);assert.equal(visits(skipped).length,before);
  });
}
main().catch(error=>{console.error(error);results.push({name:'HTTP fixture',result:'FAIL',error:error.stack});}).finally(async()=>{
  if(db)db.close();if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  if(process.env.ONGOING_ROUTINE_RESULTS)fs.writeFileSync(process.env.ONGOING_ROUTINE_RESULTS,JSON.stringify({runtime:process.version,scope:'Disposable synthetic accounts; external network blocked',results,serverLog:log},null,2));
  fs.rmSync(DIR,{recursive:true,force:true});console.log(`ongoing routine flow: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
});
