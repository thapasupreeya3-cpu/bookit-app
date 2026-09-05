/* The Care Web v86.13 source-review regressions. Synthetic data only, isolated DB.
   No credentials, network providers, production files or third-party dependencies.
   Run: node --no-warnings tests/review-regression.js */
'use strict';
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bookit-review-tests-')),DB=path.join(tmp,'bookit.db');
let B,child,db,serverLog='',checks=0,failures=0,pc,wc,w12,ac;
const NOW=new Date().toISOString(),FUTURE='2030-02-20',PASSWORD='Review-Only-Password!42';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function test(name,fn){try{await fn();checks++;console.log('PASS  '+name);}catch(e){checks++;failures++;console.error('FAIL  '+name+' — '+e.message);}}
function ins(table,fields){return Number(db.prepare(`INSERT INTO ${table} (${Object.keys(fields).join(',')}) VALUES (${Object.keys(fields).map(()=>'?').join(',')})`).run(...Object.values(fields)).lastInsertRowid);}
function booking(overrides={}){return ins('bookings',{participant_id:13,worker_id:10,service:'daily-tasks',date:FUTURE,start:'10:00',hours:2,status:'requested',created:NOW,...overrides});}
function cover(overrides={}){const bid=booking({worker_id:2,status:'accepted',cover_state:'finding',...overrides});const cid=ins('cover',{booking_id:bid,from_worker_id:2,reason:'Synthetic regression case',opened_at:NOW,lead_minutes:100000,window_minutes:720,tier:'pool',status:'open'});return {bid,cid};}
function offer(cid,wid=10){return ins('cover_offers',{cover_id:cid,tier:'pool',worker_id:wid,rank:1,sent_at:NOW,expires_at:new Date(Date.now()+3600000).toISOString()});}
function plan(version=1){db.prepare('UPDATE support_plans SET current=0 WHERE participant_id=13').run();return ins('support_plans',{participant_id:13,version,current:1,status:'confirmed',created:NOW,updated:NOW,review_due:'2031-01-01',communication:'Synthetic current care instruction '+version});}
function reset(){
  for(const t of ['shift_note_drafts','shift_notes','messages','conversations','cover_offers','cover','bookings','booking_series','plan_acks','support_plans','participant_workers','referrals','standby'])db.exec('DELETE FROM '+t);
  db.exec("UPDATE users SET suburb='Ryde NSW',closed_at=NULL,verified=1 WHERE id IN (2,10,11,12,13); UPDATE users SET plan='self' WHERE id=13");
  db.exec(`UPDATE worker_profiles SET visible=1,services='["daily-tasks","personal-care","community"]',days='[1,1,1,1,1,1,1]',service_areas='["Ryde NSW"]',availability_windows=NULL,leave_dates='[]',travel_buffer_minutes=0 WHERE user_id IN (2,10,11,12)`);
  db.exec("UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id IN (2,10,11,12)");
}
async function req(method,p,cookie,body,extra={}){
  const headers={'Content-Type':'application/json',Origin:B,...extra.headers,...(cookie?{Cookie:cookie}:{})};
  const r=await fetch(B+p,{method,headers,body:body===undefined?undefined:extra.raw?body:JSON.stringify(body),redirect:'manual'});
  const text=await r.text();let json;try{json=JSON.parse(text);}catch{}
  return {status:r.status,text,json,headers:r.headers};
}
function expect(r,status){assert.equal(r.status,status,`${r.status} ${JSON.stringify(r.json)||r.text.slice(0,200)}`);return r.json;}
async function login(email,password='demo1234'){const r=await req('POST','/api/login',null,{email,password});expect(r,200);return r.headers.get('set-cookie').split(';')[0];}
async function start(){
  const env={...process.env};for(const k of Object.keys(env))if(/^(SMTP_|RESEND_|STRIPE_|AI_|SCOPE_PARTNER_|BOOKIT_SECRET|BOOKIT_SESSION_SECRET)/.test(k)||['SECRET','SESSION_SECRET','ADMIN_EMAILS','SITE_PASSWORD','STRICT_PROD'].includes(k))delete env[k];
  Object.assign(env,{PORT:new URL(B).port,BIND_HOST:'127.0.0.1',APP_URL:B,DB_PATH:DB,DOCS_DIR:path.join(tmp,'docs'),PHOTOS_DIR:path.join(tmp,'photos'),SECRET_FILE:path.join(tmp,'.secret'),SEED_DEMO:fs.existsSync(DB)?'off':'on',AUTO_REPLY:'off',TZ:'Australia/Sydney',NODE_ENV:'',ADMIN_MFA_REQUIRED:'off'});
  child=spawn(process.execPath,['--no-warnings','server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>serverLog+=d);child.stderr.on('data',d=>serverLog+=d);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Server failed: '+serverLog.slice(-2000));try{if((await fetch(B+'/api/version')).ok)return;}catch{}await delay(100);}throw Error('Server did not boot');
}
async function stop(){if(!child||child.exitCode!==null)return;const p=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await p;}
async function main(){
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});B='http://127.0.0.1:'+port;
  await start();db=new DatabaseSync(DB);db.exec('PRAGMA busy_timeout=5000');
  db.exec("UPDATE users SET name='Synthetic Participant',email='review.participant@example.test' WHERE id=13; UPDATE users SET name='Synthetic Worker',email='review.worker@example.test' WHERE id=10; UPDATE users SET name='Synthetic Worker Two',email='review.worker2@example.test' WHERE id=12");
  // Seed accounts normally complete all induction modules. Assert this fixture rather than bypass training in tests.
  assert.ok(db.prepare('SELECT count(*) n FROM module_completions WHERE worker_id=10').get().n>0);
  const terms=/const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT,'server.js'),'utf8'))[1];
  expect(await req('POST','/api/register',null,{name:'Synthetic Admin',email:'review.admin@example.test',password:PASSWORD,role:'participant',suburb:'Ryde NSW',plan:'self',terms_accepted:true,terms_version:terms}),200);
  db.exec("UPDATE users SET is_admin=1,verified=1 WHERE email='review.admin@example.test'");
  [pc,wc,w12,ac]=await Promise.all([login('review.participant@example.test'),login('review.worker@example.test'),login('review.worker2@example.test'),login('review.admin@example.test',PASSWORD)]);
  reset();
  await test('invalid booking calendar/time values are rejected and never stored',async()=>{
    for(const [date,start]of[['2030-02-31','10:00'],['2030-13-32','10:00'],['2030-02-20','99:99'],['2030-02-20oops','10:00'],['2030-02-20','10:00oops']])expect(await req('POST','/api/bookings',pc,{worker_id:10,service:'daily-tasks',date,start,hours:2,intro:true}),400);
    assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,0);
  });
  await test('valid meet-and-greet still creates a request, not an accepted shift',async()=>{
    const r=expect(await req('POST','/api/bookings',pc,{worker_id:10,service:'daily-tasks',date:FUTURE,start:'10:00',intro:true}),200);const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(r.id);assert.equal(b.status,'requested');assert.equal(b.kind,'intro');assert.equal(b.hours,.25);
  });
  reset();
  await test('participant block is enforced through creation, acceptance, feed, preview, claim and office paths',async()=>{
    ins('participant_workers',{participant_id:13,worker_id:10,relation:'blocked',added:NOW,updated:NOW});
    expect(await req('POST','/api/bookings',pc,{worker_id:10,service:'daily-tasks',date:FUTURE,start:'10:00',intro:true}),400);
    const own=booking({date:'2030-02-21'});expect(await req('PATCH','/api/bookings/'+own,wc,{status:'accepted'}),400);
    const {bid,cid}=cover(),oid=offer(cid);
    const feed=expect(await req('GET','/api/me/open-shifts',wc),200);assert.ok(!feed.shifts.some(s=>s.cover_id===cid));
    expect(await req('POST',`/api/cover/${cid}/review`,wc,{}),409);
    expect(await req('POST',`/api/cover/${cid}/claim`,wc,{}),409);
    expect(await req('POST',`/api/me/offers/${oid}/accept`,wc,{}),400);
    expect(await req('POST',`/api/admin/cover/${cid}/assign`,ac,{worker_id:10}),400);
    expect(await req('POST',`/api/admin/cover/${cid}/assign`,ac,{worker_id:10,office_confirmed:true,worker_agreed:true,consent_note:'Synthetic worker agreed by telephone for this test.'}),400);
    assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id,2);
  });
  reset();
  await test('hard-locked training is enforced through ordinary acceptance and all cover assignment paths',async()=>{
    db.exec("UPDATE module_completions SET expires_at='2020-01-01' WHERE worker_id=10");
    const bid=booking({date:'2030-02-21'});const r=await req('PATCH','/api/bookings/'+bid,wc,{status:'accepted'});expect(r,400);assert.equal(r.json.training_lock,'hard');
    const {cid}=cover(),oid=offer(cid);
    expect(await req('POST',`/api/cover/${cid}/claim`,wc,{}),409);
    expect(await req('POST',`/api/me/offers/${oid}/accept`,wc,{}),400);
    expect(await req('POST',`/api/admin/cover/${cid}/assign`,ac,{worker_id:10}),400);
    assert.ok(!expect(await req('GET','/api/me/open-shifts',wc),200).shifts.some(x=>x.cover_id===cid));
  });
  reset();
  await test('ordinary acceptance requires the confirmed plan identity and version, not a checkbox alone',async()=>{
    const pid=plan(),bid=booking();
    expect(await req('PATCH','/api/bookings/'+bid,wc,{status:'accepted',plan_ack:true}),400);
    expect(await req('PATCH','/api/bookings/'+bid,wc,{status:'accepted',plan_ack:true,plan_id:pid,plan_version:999}),400);
    expect(await req('PATCH','/api/bookings/'+bid,wc,{status:'accepted',plan_ack:true,plan_id:pid,plan_version:1}),200);
    const a=db.prepare('SELECT * FROM plan_acks WHERE worker_id=10').get();assert.equal(a.plan_id,pid);assert.equal(a.ack_source,'worker');
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(bid).status,'accepted');
  });
  reset();
  await test('unpublished drafts do not replace the confirmed worker plan',async()=>{
    const pid=plan(),bid=booking();db.prepare('UPDATE support_plans SET current=0 WHERE id=?').run(pid);
    ins('support_plans',{participant_id:13,version:2,current:1,status:'draft',created:NOW,updated:NOW,communication:'Unpublished draft private text'});
    const r=expect(await req('GET','/api/support-plan/13/brief',wc),200);assert.equal(r.plan_id,pid);assert.ok(!JSON.stringify(r).includes('Unpublished draft private text'));
    expect(await req('PATCH','/api/bookings/'+bid,wc,{status:'accepted',plan_ack:true,plan_id:pid,plan_version:1}),200);
  });
  reset();
  await test('cover preview grants limited current-plan access; stale versions and double claims cannot assign',async()=>{
    const pid=plan(),{bid,cid}=cover();
    expect(await req('POST',`/api/cover/${cid}/claim`,wc,{}),400);
    const review=expect(await req('POST',`/api/cover/${cid}/review`,wc,{}),200);assert.equal(review.plan_id,pid);
    const pid2=plan(2);expect(await req('POST',`/api/cover/${cid}/claim`,wc,{plan_ack:true,plan_id:pid,plan_version:1}),400);
    assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id,2);
    expect(await req('POST',`/api/cover/${cid}/review`,wc,{}),200);
    expect(await req('POST',`/api/cover/${cid}/claim`,wc,{plan_ack:true,plan_id:pid2,plan_version:2}),200);
    assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id,10);
    assert.equal(db.prepare('SELECT plan_id FROM plan_acks WHERE worker_id=10').get().plan_id,pid2);
    expect(await req('POST',`/api/cover/${cid}/claim`,wc,{plan_ack:true,plan_id:pid2,plan_version:2}),409);
  });
  reset();
  await test('competing cover claims commit exactly one new assignment',async()=>{
    const {bid,cid}=cover();const results=await Promise.all([req('POST',`/api/cover/${cid}/claim`,wc,{}),req('POST',`/api/cover/${cid}/claim`,w12,{})]);
    assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
    assert.ok([10,12].includes(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id));
  });
  reset();
  await test('historical work alone and participant blocks do not reveal the current plan',async()=>{
    plan();const old=booking({worker_id:12,date:'2026-08-20',status:'completed'});
    ins('shift_notes',{booking_id:old,worker_id:12,participant_id:13,body:'Synthetic historical delivered record',created:NOW});
    expect(await req('GET','/api/support-plan/13/brief',w12),403);
    ins('participant_workers',{participant_id:13,worker_id:12,relation:'blocked',added:NOW,updated:NOW});booking({worker_id:12,date:'2030-02-24'});
    expect(await req('GET','/api/support-plan/13/brief',w12),403);
    expect(await req('POST','/api/plan/13/ack',w12,{read:true}),403);
    const r=expect(await req('GET',`/api/bookings/${old}/notes`,w12),200);assert.ok(JSON.stringify(r).includes('Synthetic historical delivered record'));
  });
  reset();
  await test('recurring worker changes invalidate inherited acceptance; blocked replacement fails atomically',async()=>{
    const sid=ins('booking_series',{participant_id:13,worker_id:2,service:'daily-tasks',start:'10:00',hours:2,freq:'weekly',dow:2,first_date:FUTURE,occurrences:2,created_by:13,created:NOW});
    const b1=booking({worker_id:2,status:'accepted',accepted_at:NOW,series_id:sid,series_index:0});const b2=booking({worker_id:2,status:'accepted',accepted_at:NOW,series_id:sid,series_index:1,date:'2030-02-27'});
    expect(await req('PATCH','/api/series/'+sid,pc,{worker_id:12}),200);
    for(const id of[b1,b2]){const b=db.prepare('SELECT worker_id,status,accepted_at FROM bookings WHERE id=?').get(id);assert.equal(b.worker_id,12);assert.equal(b.status,'requested');assert.equal(b.accepted_at,null);}
    ins('participant_workers',{participant_id:13,worker_id:10,relation:'blocked',added:NOW,updated:NOW});
    const r=await req('PATCH','/api/series/'+sid,pc,{worker_id:10});assert.ok([400,409].includes(r.status));assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(b1).worker_id,12);
  });
  reset();
  await test('ordinary office assignment offers the shift rather than impersonating worker acceptance',async()=>{
    const {bid,cid}=cover();const r=expect(await req('POST',`/api/admin/cover/${cid}/assign`,ac,{worker_id:10}),200);
    assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id,2);
    assert.ok(db.prepare('SELECT id FROM cover_offers WHERE cover_id=? AND worker_id=10 AND response IS NULL').get(cid));assert.ok(r.pending_acceptance);
  });
  reset();
  await test('office-recorded acceptance requires consent evidence and records plan provenance',async()=>{
    const pid=plan(),{bid,cid}=cover();db.prepare("UPDATE bookings SET cover_state='office' WHERE id=?").run(bid);
    expect(await req('POST',`/api/admin/bookings/${bid}/office-assign`,ac,{worker_id:10}),400);
    const r=await req('POST',`/api/admin/bookings/${bid}/office-assign`,ac,{worker_id:10,worker_agreed:true,consent_note:'Synthetic telephone confirmation: worker reviewed this version and agreed.',plan_read_confirmed:true,plan_id:pid,plan_version:1});expect(r,200);
    assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id,10);
    const ack=db.prepare('SELECT * FROM plan_acks WHERE worker_id=10').get();assert.equal(ack.ack_source,'office-recorded');assert.ok(ack.recorded_by);
  });
  reset();
  await test('signed worker GET links never accept or decline a visit',async()=>{
    const {bid,cid}=cover(),oid=offer(cid),secret=fs.readFileSync(path.join(tmp,'.secret'),'utf8').trim(),token=crypto.createHmac('sha256',secret).update('cover.'+oid).digest('hex').slice(0,32);
    for(const k of['accept','decline'])expect(await req('GET',`/cover?o=${oid}&t=${token}&k=${k}`),200);
    assert.equal(db.prepare('SELECT response FROM cover_offers WHERE id=?').get(oid).response,null);assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id,2);
  });
  await test('standby GET is read-only; protected POST needs nonce, signature and same origin',async()=>{
    const sid=ins('standby',{worker_id:10,date:FUTURE,band:'weekday',allowance:23.5,status:'offered',offered_at:NOW});
    const secret=fs.readFileSync(path.join(tmp,'.secret'),'utf8').trim(),token=crypto.createHmac('sha256',secret).update('standby.'+sid).digest('hex').slice(0,32),url=`/cover?s=${sid}&t=${token}&k=standby-yes`;
    const r=await req('GET',url);expect(r,200);assert.equal(db.prepare('SELECT status FROM standby WHERE id=?').get(sid).status,'offered');
    const exp=/name="expires" value="([^"]+)"/.exec(r.text)[1],sig=/name="confirmation" value="([^"]+)"/.exec(r.text)[1],cookie=r.headers.get('set-cookie').split(';')[0];
    const body=new URLSearchParams({expires:exp,confirmation:sig}).toString(),extra={raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded'}};
    expect(await req('POST',url,null,body,extra),403);
    expect(await req('POST',url,cookie,body,{...extra,headers:{...extra.headers,Origin:'https://other.example.test'}}),403);
    expect(await req('POST',url,cookie,body,extra),200);assert.equal(db.prepare('SELECT status FROM standby WHERE id=?').get(sid).status,'accepted');
  });
  reset();
  await test('501-message latest page, older pagination and explicit receipts preserve all messages',async()=>{
    const cid=ins('conversations',{participant_id:13,worker_id:10,created:NOW});for(let i=1;i<=501;i++)ins('messages',{convo_id:cid,sender_id:13,body:'Synthetic message '+i,created:NOW});
    let r=expect(await req('GET',`/api/conversations/${cid}/messages`,wc),200);assert.equal(r.messages.length,100);assert.equal(r.messages.at(-1).body,'Synthetic message 501');assert.equal(db.prepare('SELECT count(*) n FROM messages WHERE read_at IS NOT NULL').get().n,0);
    expect(await req('POST',`/api/conversations/${cid}/read`,wc,{message_ids:r.messages.map(m=>m.id)}),200);assert.equal(db.prepare('SELECT count(*) n FROM messages WHERE read_at IS NOT NULL').get().n,100);
    const all=[...r.messages];while(r.has_more){r=expect(await req('GET',`/api/conversations/${cid}/messages?before=${r.older_cursor}`,wc),200);all.push(...r.messages);}assert.equal(new Set(all.map(m=>m.id)).size,501);assert.equal(all.length,501);
    expect(await req('GET',`/api/conversations/${cid}/messages`,w12),404);expect(await req('POST',`/api/conversations/${cid}/read`,w12,{message_ids:[all[0].id]}),404);
    const newest=Math.max(...all.map(x=>x.id));for(let i=502;i<=752;i++)ins('messages',{convo_id:cid,sender_id:13,body:'Synthetic message '+i,created:NOW});
    let after=newest,seen=[];do{r=expect(await req('GET',`/api/conversations/${cid}/messages?after=${after}`,wc),200);seen.push(...r.messages);after=r.newer_cursor;}while(r.has_newer);assert.equal(seen.length,251);assert.equal(seen.at(-1).body,'Synthetic message 752');
    expect(await req('GET',`/api/conversations/${cid}/messages?before=1&after=1`,wc),400);
  });
  reset();
  await test('drafts are private, revision-checked, survive restart and are removed on final completion',async()=>{
    const bid=booking({status:'accepted',date:'2026-08-20',accepted_at:NOW});
    assert.equal(expect(await req('GET',`/api/bookings/${bid}/note-draft`,wc),200).draft,null);
    const payload={note:'Synthetic completed support description saved securely.',scope:false};
    expect(await req('PUT',`/api/bookings/${bid}/note-draft`,wc,{revision:0,payload}),200);
    expect(await req('PUT',`/api/bookings/${bid}/note-draft`,wc,{revision:0,payload:{...payload,note:'stale overwrite'}}),409);
    expect(await req('GET',`/api/bookings/${bid}/note-draft`,w12),403);
    await stop();await start();const saved=expect(await req('GET',`/api/bookings/${bid}/note-draft`,wc),200).draft;assert.equal(saved.revision,1);assert.equal(saved.payload.note,payload.note);
    expect(await req('PATCH',`/api/bookings/${bid}`,wc,{status:'completed',...payload}),200);
    assert.equal(db.prepare('SELECT count(*) n FROM shift_note_drafts WHERE booking_id=?').get(bid).n,0);
    expect(await req('PUT',`/api/bookings/${bid}/note-draft`,wc,{revision:1,payload}),403);
    assert.ok(db.prepare('SELECT id FROM shift_notes WHERE booking_id=?').get(bid));
  });
  reset();
  await test('referrals exclude sleepovers/intros, hold corrected unpaid awards, and retain paid evidence',async()=>{
    const ref=ins('referrals',{referrer_id:10,referee_id:11,code:'SYNTHETIC',created:NOW});
    for(let i=1;i<=7;i++)booking({worker_id:11,date:`2026-08-0${i}`,hours:8,start:'22:00',status:'completed',sleepover:1});booking({worker_id:11,date:'2026-08-08',kind:'intro',hours:.25,status:'completed'});
    expect(await req('GET','/api/admin/referrals',ac),200);assert.equal(db.prepare('SELECT qualified_at FROM referrals WHERE id=?').get(ref).qualified_at,null);
    const ordinary=[];for(let i=10;i<15;i++)ordinary.push(booking({worker_id:11,date:`2026-08-${i}`,hours:10,status:'completed'}));
    expect(await req('GET','/api/admin/referrals',ac),200);let row=db.prepare('SELECT * FROM referrals WHERE id=?').get(ref);assert.equal(row.hours_at_qualify,50);assert.equal(row.amount,150);
    db.prepare('UPDATE bookings SET voided=1 WHERE id=?').run(ordinary[0]);expect(await req('GET','/api/admin/referrals',ac),200);assert.equal(db.prepare('SELECT review_required FROM referrals WHERE id=?').get(ref).review_required,1);
    expect(await req('POST',`/api/admin/referrals/${ref}/paid`,ac,{}),400);
    db.prepare('UPDATE bookings SET voided=0 WHERE id=?').run(ordinary[0]);expect(await req('GET','/api/admin/referrals',ac),200);expect(await req('POST',`/api/admin/referrals/${ref}/paid`,ac,{}),200);
    const paid=db.prepare('SELECT paid_at FROM referrals WHERE id=?').get(ref).paid_at;db.prepare('UPDATE bookings SET voided=1 WHERE id=?').run(ordinary[0]);expect(await req('GET','/api/admin/referrals',ac),200);row=db.prepare('SELECT * FROM referrals WHERE id=?').get(ref);assert.equal(row.paid_at,paid);assert.equal(row.review_required,1);
  });
  reset();
  await test('service area and whole-visit windows are applied consistently to directory and cover',async()=>{
    expect(await req('POST','/api/me/profile',wc,{service_areas:['Melbourne VIC']}),200);
    let r=expect(await req('GET',`/api/workers?date=${FUTURE}&start=10:00&hours=3&place=Ryde%20NSW`,pc),200);assert.ok(!r.workers.some(w=>w.id===10));
    const {cid}=cover({hours:3});expect(await req('POST',`/api/cover/${cid}/claim`,wc,{}),409);
    const windows=Array.from({length:7},()=>[{start:'09:00',end:'12:00'},{start:'13:00',end:'17:00'}]);
    expect(await req('POST','/api/me/profile',wc,{service_areas:['Ryde NSW'],availability_windows:windows}),200);
    r=expect(await req('GET',`/api/workers?date=${FUTURE}&start=10:00&hours=3&place=Ryde%20NSW`,pc),200);assert.ok(!r.workers.some(w=>w.id===10));
    r=expect(await req('GET',`/api/workers?date=${FUTURE}&start=10:00&hours=2&place=Ryde%20NSW`,pc),200);assert.ok(r.workers.some(w=>w.id===10));
    expect(await req('POST','/api/me/profile',wc,{leave_dates:[{from:FUTURE,to:FUTURE}]}),200);r=expect(await req('GET',`/api/workers?date=${FUTURE}&start=10:00&hours=2&place=Ryde%20NSW`,pc),200);assert.ok(!r.workers.some(w=>w.id===10));
    expect(await req('POST','/api/me/profile',wc,{leave_dates:[{from:'2030-02-31',to:'2030-03-01'}]}),400);
  });
  reset();
  await test('travel buffer blocks back-to-back different-participant visits but allows sufficient gap',async()=>{
    const other=db.prepare("SELECT id FROM users WHERE email='review.admin@example.test'").get().id;
    booking({participant_id:other,start:'08:00',hours:2,status:'accepted'});expect(await req('POST','/api/me/profile',wc,{travel_buffer_minutes:30}),200);
    let r=expect(await req('GET',`/api/workers?date=${FUTURE}&start=10:00&hours=2&place=Ryde%20NSW`,pc),200);assert.ok(!r.workers.some(w=>w.id===10));
    r=expect(await req('GET',`/api/workers?date=${FUTURE}&start=10:30&hours=2&place=Ryde%20NSW`,pc),200);assert.ok(r.workers.some(w=>w.id===10));
  });

  reset();
  await test('allied cover GET is read-only and signed POST revalidates the addressed provider',async()=>{
    const {bid,cid}=cover();const aid=ins('allied_providers',{name:'Synthetic partner',email:'partner@example.test',reg_groups:'["0115"]',suburbs:'["Ryde NSW"]',agreement_ref:'SYNTHETIC-AGREEMENT',insurance_expiry:'2032-01-01',active:1,created:NOW});
    const oid=ins('cover_offers',{cover_id:cid,tier:'allied',allied_id:aid,rank:1,sent_at:NOW,expires_at:new Date(Date.now()+3600000).toISOString()});
    const secret=fs.readFileSync(path.join(tmp,'.secret'),'utf8').trim(),token=crypto.createHmac('sha256',secret).update('cover.'+oid).digest('hex').slice(0,32),url=`/cover?o=${oid}&t=${token}&k=allied`;
    const r=await req('GET',url);expect(r,200);assert.equal(db.prepare('SELECT status FROM cover WHERE id=?').get(cid).status,'open');
    const body=new URLSearchParams({expires:/name="expires" value="([^"]+)"/.exec(r.text)[1],confirmation:/name="confirmation" value="([^"]+)"/.exec(r.text)[1]}).toString();
    const cookie=r.headers.get('set-cookie').split(';')[0],extra={raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded'}};
    db.prepare('UPDATE allied_providers SET active=0 WHERE id=?').run(aid);expect(await req('POST',url,cookie,body,extra),409);assert.equal(db.prepare('SELECT response FROM cover_offers WHERE id=?').get(oid).response,null);
    db.prepare('UPDATE allied_providers SET active=1 WHERE id=?').run(aid);expect(await req('POST',url,cookie,body,extra),200);assert.equal(db.prepare('SELECT status FROM cover WHERE id=?').get(cid).status,'referred');
  });
  reset();
  await test('SIL rejects malformed templates and produces requests requiring acceptance',async()=>{
    const house=expect(await req('POST','/api/admin/sil/houses',ac,{name:'Synthetic house'}),200).id;
    const args={house_id:house,day:0,start:'10:00',hours:2,service:'daily-tasks',worker_id:10,participant_id:13};
    expect(await req('POST','/api/admin/sil/slots',ac,{...args,start:'99:99'}),400);
    expect(await req('POST','/api/admin/sil/slots',ac,{...args,day:1.5}),400);
    expect(await req('POST','/api/admin/sil/generate',ac,{week_start:'2030-02-31'}),400);
    const slot=expect(await req('POST','/api/admin/sil/slots',ac,args),200).id;
    expect(await req('POST','/api/admin/sil/generate',ac,{week_start:'2030-02-18'}),200);
    const row=db.prepare('SELECT status,accepted_at FROM bookings WHERE sil_slot_id=?').get(slot);assert.equal(row.status,'requested');assert.equal(row.accepted_at,null);
    expect(await req('POST','/api/admin/sil/generate',ac,{week_start:'2030-02-18'}),200);assert.equal(db.prepare('SELECT count(*) n FROM bookings WHERE sil_slot_id=?').get(slot).n,1);
  });
  reset();
  await test('office series approval clears previous-worker acceptance metadata',async()=>{
    const sid=ins('booking_series',{participant_id:13,worker_id:2,service:'daily-tasks',start:'10:00',hours:2,freq:'weekly',dow:2,first_date:FUTURE,occurrences:1,created_by:13,created:NOW,review_required:1,proposed_worker_id:12});
    const bid=booking({worker_id:2,status:'accepted',accepted_at:NOW,office_ok:1,series_id:sid,series_index:0});
    expect(await req('POST',`/api/admin/series/${sid}/approve`,ac,{approved_by:'Synthetic participant by phone'}),200);
    const b=db.prepare('SELECT worker_id,status,accepted_at,office_ok FROM bookings WHERE id=?').get(bid);assert.equal(b.worker_id,12);assert.equal(b.status,'requested');assert.equal(b.accepted_at,null);assert.equal(b.office_ok,0);
  });
  reset();
  await test('current clinical access works and is revoked for historical-only or blocked workers',async()=>{
    booking({worker_id:12,status:'completed',date:'2026-08-20'});plan();
    db.exec('UPDATE users SET share_plans=1 WHERE id=13');
    const file=path.join(tmp,'clinical.txt');fs.writeFileSync(file,'Synthetic clinical plan');
    const doc=ins('participant_docs',{participant_id:13,form_key:'p-mealtime',label:'Synthetic mealtime plan',file_path:file,file_name:'clinical.txt',file_mime:'text/plain',review_state:'approved',uploaded_at:NOW});
    const upcoming=booking({worker_id:12});
    expect(await req('GET',`/api/participant-documents/${doc}/file`,w12),200);
    db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(upcoming);
    expect(await req('GET',`/api/participant-documents/${doc}/file`,w12),403);
    db.prepare("UPDATE bookings SET status='requested' WHERE id=?").run(upcoming);
    ins('participant_workers',{participant_id:13,worker_id:12,relation:'blocked',added:NOW,updated:NOW});
    expect(await req('GET',`/api/participant-documents/${doc}/file`,w12),403);expect(await req('GET','/api/plan/13/versions',w12),403);
    expect(await req('GET',`/api/participant-documents/${doc}/file`,pc),200);
  });
  await test('new draft and Today routes enforce role boundaries',async()=>{
    expect(await req('GET','/api/admin/today-actions',pc),403);expect(await req('GET','/api/admin/today-actions',wc),403);expect(await req('GET','/api/admin/today-actions',ac),200);expect(await req('GET','/api/bookings/1/note-draft',pc),403);
  });
  await test('running server logged no uncaught runtime or database errors',async()=>{assert.ok(!/SQLITE_ERROR|TypeError:|ReferenceError:|SyntaxError:|UnhandledPromiseRejection|ERR_SQLITE_ERROR/.test(serverLog),serverLog.slice(-1500));});
  console.log(`review integration: ${checks-failures}/${checks} passed`);
}
main().catch(e=>{failures++;console.error(e.stack);}).finally(async()=>{db?.close();await stop();if(process.env.BOOKIT_KEEP_TEST_DATA==='1'){fs.writeFileSync(path.join(tmp,'server.log'),serverLog);console.log('Synthetic fixtures retained at '+tmp);}else fs.rmSync(tmp,{recursive:true,force:true});process.exitCode=failures?1:0;});
