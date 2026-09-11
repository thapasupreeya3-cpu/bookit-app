'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..'),RT=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'careweb-audit-'));let B;
let child,db,maps,log='';const results={runtime:process.version,checks:[]};
const now=new Date().toISOString(),future='2030-02-20';
function save(){if(process.env.AUDIT_RESULTS_PATH)fs.writeFileSync(process.env.AUDIT_RESULTS_PATH,JSON.stringify(results,null,2));}
async function test(name,fn){try{const detail=await fn();results.checks.push({name,result:'PASS',detail});console.log('PASS '+name);}catch(e){results.checks.push({name,result:'FAIL',detail:e.message});console.log('FAIL '+name+' '+e.message);}save();}
function ins(t,v){return Number(db.prepare(`INSERT INTO ${t} (${Object.keys(v).join(',')}) VALUES (${Object.keys(v).map(()=>'?').join(',')})`).run(...Object.values(v)).lastInsertRowid);}
function booking(v={}){return ins('bookings',{participant_id:13,worker_id:10,service:'daily-tasks',date:future,start:'10:00',hours:2,status:'requested',created:now,...v});}
function plan(){return ins('support_plans',{participant_id:13,version:1,current:1,status:'confirmed',created:now,updated:now,review_due:'2031-01-01',communication:'Synthetic plan instructions only.'});}
function reset(area='Ryde NSW') {for(const t of ['reviews','shift_notes','plan_acks','cover_offers','cover','bookings','booking_series','support_plans','participant_workers'])db.exec('DELETE FROM '+t);db.exec(`UPDATE users SET suburb='Ryde NSW',plan='self',verified=1 WHERE id IN (2,10,12,13);UPDATE worker_profiles SET visible=1,services='["daily-tasks","personal-care","community"]',days='[1,1,1,1,1,1,1]',availability_windows=NULL,leave_dates='[]',travel_buffer_minutes=0 WHERE user_id IN (2,10,12);UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id IN (2,10,12)`);db.prepare('UPDATE worker_profiles SET service_areas=? WHERE user_id=10').run(JSON.stringify([area]));}
async function req(method,p,cookie,body,handshake=true){const r=await fetch(B+p,{method,headers:{Origin:B,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});const text=await r.text();let json;try{json=JSON.parse(text)}catch{}if(handshake&&r.status===409&&json?.out_of_area_token&&body?.out_of_area_ok===true&&!body.out_of_area_token)return req(method,p,cookie,{...body,out_of_area_token:json.out_of_area_token});return {status:r.status,json,text,headers:r.headers};}
async function login(id){const u=db.prepare('SELECT email FROM users WHERE id=?').get(id),r=await req('POST','/api/login',null,{email:u.email,password:'demo1234'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
function cover(){const bid=booking({worker_id:2,status:'accepted',cover_state:'finding'});const cid=ins('cover',{booking_id:bid,from_worker_id:2,reason:'Synthetic cover',opened_at:now,tier:'pool',status:'open'});ins('cover_offers',{cover_id:cid,tier:'pool',worker_id:10,rank:1,sent_at:now,expires_at:new Date(Date.now()+3600000).toISOString()});return {bid,cid};}
async function main(){
 maps=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify([{originIndex:0,destinationIndex:0,duration:'4620s',staticDuration:'4260s',distanceMeters:87400,condition:'ROUTE_EXISTS'}]));});});await new Promise(r=>maps.listen(0,'127.0.0.1',r));
 const free=http.createServer();await new Promise(r=>free.listen(0,'127.0.0.1',r));const port=free.address().port;await new Promise(r=>free.close(r));B='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'server.js')],{cwd:ROOT,env:{PATH:process.env.PATH,PORT:String(port),BIND_HOST:'127.0.0.1',APP_URL:B,DB_PATH:path.join(RT,'test.db'),DOCS_DIR:path.join(RT,'docs'),PHOTOS_DIR:path.join(RT,'photos'),SECRET_FILE:path.join(RT,'secret'),SEED_DEMO:'on',AUTO_REPLY:'off',TZ:'Australia/Sydney',ADMIN_MFA_REQUIRED:'off',GOOGLE_MAPS_KEY:'synthetic-stub-key',GOOGLE_MAPS_ENDPOINT:'http://127.0.0.1:'+maps.address().port+'/matrix'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 for(let i=0;i<100;i++){try{if((await fetch(B+'/api/version')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 db=new DatabaseSync(path.join(RT,'test.db'));db.exec('PRAGMA busy_timeout=5000');reset();const wc=await login(10),pc=await login(13);
 await test('Initial boot snapshot exists before the delayed scheduled job',async()=>{const row=db.prepare('SELECT day,detail FROM audit_snapshots ORDER BY day DESC LIMIT 1').get();assert.ok(row);assert.equal(JSON.parse(row.detail).why,'boot');assert.ok(!/audit snapshot:/.test(log));return {day:row.day,reason:'boot',startupSnapshotErrors:false};});
 for(const area of ['Ryde NSW','Parramatta NSW'])await test('Full cover review and claim with a current plan: '+area,async()=>{reset(area);const pid=plan(),{bid,cid}=cover();const r=await req('POST',`/api/cover/${cid}/review`,wc,{out_of_area_ok:true});assert.equal(r.status,200,JSON.stringify(r.json));assert.equal(r.json.plan_id,pid);const claim=await req('POST',`/api/cover/${cid}/claim`,wc,{out_of_area_ok:true,plan_ack:true,plan_id:pid,plan_version:1});const state=db.prepare('SELECT worker_id,status,cover_state FROM bookings WHERE id=?').get(bid);assert.equal(claim.status,200,JSON.stringify({reviewStatus:r.status,claimStatus:claim.status,error:claim.json,state}));assert.equal(state.worker_id,10);assert.equal(state.cover_state,'covered');return {review:r.status,claim:claim.status,state};});
 await test('Out-of-area cover without a required plan reaches successful acceptance',async()=>{reset('Parramatta NSW');const {bid,cid}=cover();const r=await req('POST',`/api/cover/${cid}/review`,wc,{out_of_area_ok:true});assert.equal(r.status,200,JSON.stringify(r.json));const claim=await req('POST',`/api/cover/${cid}/claim`,wc,{out_of_area_ok:true});const state=db.prepare('SELECT worker_id,status,cover_state FROM bookings WHERE id=?').get(bid);assert.equal(claim.status,200,JSON.stringify({reviewStatus:r.status,claimStatus:claim.status,error:claim.json,state}));assert.equal(state.worker_id,10);return {review:r.status,claim:claim.status,state};});
 await test('A shown Google travel estimate is preserved with participant confirmation',async()=>{reset('Parramatta NSW');const body={worker_id:10,service:'daily-tasks',date:future,start:'10:00',intro:true};const warning=await req('POST','/api/bookings',pc,body);assert.equal(warning.status,409);assert.equal(warning.json.travel.source,'google');const ok=await req('POST','/api/bookings',pc,{...body,out_of_area_ok:true,out_of_area_token:warning.json.out_of_area_token});assert.equal(ok.status,200);const stored=JSON.parse(db.prepare('SELECT out_of_area FROM bookings WHERE id=?').get(ok.json.id).out_of_area);const shown=warning.json.travel;for(const k of ['source','minutes','km','from','to','checked_at'])assert.equal(stored[k],shown[k]);assert.equal(stored.actor_id,13);assert.equal(stored.visit.worker_id,10);assert.equal(stored.source,shown.source,JSON.stringify({shown:{source:shown.source,minutes:shown.minutes,km:shown.km,checked_at:shown.checked_at},stored:{source:stored.source,minutes:stored.minutes,km:stored.km,confirmed_by:stored.confirmed_by}}));});
 await test('Series edits record out-of-area confirmation for each changed visit',async()=>{reset('Parramatta NSW');const sid=ins('booking_series',{participant_id:13,worker_id:10,service:'daily-tasks',start:'10:00',hours:2,freq:'weekly',dow:3,first_date:future,occurrences:2,created:now});const a=booking({series_id:sid,series_index:1}),b=booking({date:'2030-02-27',series_id:sid,series_index:2});const r=await req('PATCH',`/api/series/${sid}`,pc,{start:'11:00',out_of_area_ok:true});assert.equal(r.status,200,JSON.stringify(r.json));for(const id of [a,b]){const row=db.prepare('SELECT status,out_of_area FROM bookings WHERE id=?').get(id);assert.equal(row.status,'requested');assert.equal(JSON.parse(row.out_of_area).confirmed_by,'participant');}return {changed:r.json.changed};});
 for(const value of [true,[],[3],'   '])await test('Sleepover completion rejects non-numeric JSON input '+JSON.stringify(value),async()=>{reset();const id=booking({date:'2026-09-01',start:'22:00',hours:8,sleepover:1,status:'accepted',accepted_at:'2026-08-31T01:00:00.000Z'});const r=await req('PATCH',`/api/bookings/${id}`,wc,{status:'completed',note:'Synthetic verification of strict active hours validation.',active_hours:value,active_note:'Synthetic active support.'});const stored=db.prepare('SELECT status,active_hours,total FROM bookings WHERE id=?').get(id);assert.equal(r.status,400,JSON.stringify({input:value,http:r.status,stored}));});
 await test('Non-quarter-hour activity is either refused or preserved exactly',async()=>{reset();const id=booking({date:'2026-09-01',start:'22:00',hours:8,sleepover:1,status:'accepted',accepted_at:'2026-08-31T01:00:00.000Z'});const r=await req('PATCH',`/api/bookings/${id}`,wc,{status:'completed',note:'Synthetic verification of exact active support durations.',active_hours:2.12,active_note:'Two hours and a small additional period.'});const stored=db.prepare('SELECT status,active_hours,active_extra_hours FROM bookings WHERE id=?').get(id);assert.ok(r.status===400||stored.active_hours===2.12,JSON.stringify({submitted:2.12,http:r.status,stored}));});
 await test('Travel proof refuses tampering, changed visits and a bare confirmation flag',async()=>{
  reset('Parramatta NSW');const b={worker_id:10,service:'daily-tasks',date:future,start:'10:00',intro:true};
  const warning=await req('POST','/api/bookings',pc,b);assert.equal(warning.status,409);const token=warning.json.out_of_area_token;assert.ok(token);
  const bare=await req('POST','/api/bookings',pc,{...b,out_of_area_ok:true},false);assert.equal(bare.status,409);assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,0);
  for(const changed of [{out_of_area_token:token+'x'},{out_of_area_token:token,start:'11:00'},{out_of_area_token:'invalid'}]){
   const r=await req('POST','/api/bookings',pc,{...b,out_of_area_ok:true,...changed});assert.equal(r.status,409);assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,0);
  }
 });
 for(const mutation of ['expired review','new plan version','changed visit','new leave','withdrawn eligibility','expired offer','voided visit'])await test('Cover revalidation refuses '+mutation,async()=>{
  reset('Parramatta NSW');const pid=plan(),{bid,cid}=cover();const review=await req('POST',`/api/cover/${cid}/review`,wc,{out_of_area_ok:true});assert.equal(review.status,200);
  if(mutation==='expired review')db.exec("UPDATE cover_reviews SET expires_at='2020-01-01'");
  if(mutation==='new plan version')db.prepare('UPDATE support_plans SET version=2 WHERE id=?').run(pid);
  if(mutation==='changed visit')db.prepare("UPDATE bookings SET start='11:00' WHERE id=?").run(bid);
  if(mutation==='new leave')db.prepare('UPDATE worker_profiles SET leave_dates=? WHERE user_id=10').run(JSON.stringify([{from:future,to:future}]));
  if(mutation==='withdrawn eligibility')db.exec('UPDATE worker_profiles SET visible=0 WHERE user_id=10');
  if(mutation==='expired offer')db.exec("UPDATE cover_offers SET expires_at='2020-01-01'");
  if(mutation==='voided visit')db.prepare('UPDATE bookings SET voided=1 WHERE id=?').run(bid);
  const r=await req('POST',`/api/cover/${cid}/claim`,wc,{out_of_area_ok:true,plan_ack:true,plan_id:pid,plan_version:1});assert.notEqual(r.status,200);
  assert.equal(db.prepare('SELECT worker_id FROM bookings WHERE id=?').get(bid).worker_id,2);
  assert.equal(db.prepare('SELECT count(*) n FROM plan_acks').get().n,0);
  assert.equal(db.prepare('SELECT out_of_area FROM bookings WHERE id=?').get(bid).out_of_area,'');
 });
 await test('An out-of-area plan review grants temporary clinical access and revokes it on changed context',async()=>{
  reset('Parramatta NSW');plan();const {bid,cid}=cover();
  assert.equal((await req('GET','/api/support-plan/13/brief',wc)).status,403);
  assert.equal((await req('POST',`/api/cover/${cid}/review`,wc,{out_of_area_ok:true})).status,200);
  assert.equal((await req('GET','/api/support-plan/13/brief',wc)).status,200);
  db.prepare("UPDATE bookings SET start='12:00' WHERE id=?").run(bid);
  assert.equal((await req('GET','/api/support-plan/13/brief',wc)).status,403);
 });
 await test('Register records and source files are private until explicitly granted; roles remain separate',async()=>{
  reset();db.exec("UPDATE users SET is_admin=1 WHERE id=1;DELETE FROM policy_register_access;DELETE FROM policy_register_settings;DELETE FROM policy_fills WHERE slug='medicine-register'");
  const ac=await login(1),other=await login(12),url='/api/policy-fill/medicine-register',acl='/api/admin/policy-register-access/medicine-register';
  const row={tables:{0:[['Synthetic participant A','Original record']]}};
  assert.equal((await req('POST',url,ac,{base_id:null,data:row})).status,200);
  for(const cookie of [wc,other]){
   assert.equal((await req('GET',url,cookie)).status,403);assert.equal((await req('POST',url,cookie,{data:row})).status,403);
   assert.equal((await req('GET','/policies/medicine-register',cookie)).status,403);assert.equal((await req('GET','/policies/medicine-register/file',cookie)).status,403);
   assert.equal((await req('POST',acl,cookie,{worker_id:10,permission:'edit'})).status,403);
  }
  const expires_at=new Date(Date.now()+864e5).toISOString();
  assert.equal((await req('POST',acl,ac,{worker_id:10,permission:'read',expires_at})).status,200);
  const cur=await req('GET',url,wc);assert.equal(cur.status,200);assert.equal(cur.json.can_write,false);
  assert.equal((await req('POST',url,wc,{base_id:cur.json.id,data:row})).status,403);
  const page=await req('GET','/policies/medicine-register',wc);assert.ok(page.text.includes('data-permission="read"'));assert.ok(page.text.includes('data-can-save="0"'));
  assert.equal((await req('GET',url,other)).status,403);
  assert.equal((await req('POST',acl,ac,{worker_id:10,permission:'append',expires_at})).status,200);
  assert.equal((await req('POST',url,wc,{base_id:cur.json.id,data:{tables:{0:[['Overwrite']]}}})).status,403);
  const appended={tables:{0:[...row.tables[0],['New observation']]}};
  assert.equal((await req('POST',url,wc,{base_id:cur.json.id,data:appended})).status,200);
  assert.equal((await req('POST',url,wc,{base_id:cur.json.id,data:appended})).status,409);
  assert.equal((await req('POST',acl,ac,{worker_id:10,permission:'none'})).status,200);
  assert.equal((await req('GET',url,wc)).status,403);
  await req('POST',acl,ac,{worker_id:10,permission:'read',expires_at});db.exec("UPDATE policy_register_access SET expires_at='2020-01-01'");
  assert.equal((await req('GET',url,wc)).status,403);
 });
 await test('Participant-scoped register grants also require current participant access and scope changes revoke grants',async()=>{
  reset();db.exec('UPDATE users SET is_admin=1 WHERE id=1');const ac=await login(1),other=await login(12),acl='/api/admin/policy-register-access/medicine-register',url='/api/policy-fill/medicine-register';
  assert.equal((await req('POST',acl,ac,{action:'scope',participant_id:13})).status,200);
  const expires_at=new Date(Date.now()+864e5).toISOString();for(const worker_id of [10,12])assert.equal((await req('POST',acl,ac,{worker_id,permission:'read',expires_at})).status,200);
  booking();assert.equal((await req('GET',url,wc)).status,200);assert.equal((await req('GET',url,other)).status,403);
  db.exec("UPDATE bookings SET status='cancelled'");assert.equal((await req('GET',url,wc)).status,403);
  assert.equal((await req('POST',acl,ac,{action:'scope',participant_id:null})).status,200);assert.equal(db.prepare("SELECT count(*) n FROM policy_register_access WHERE slug='medicine-register'").get().n,0);
 });
 await test('Rejected active hours leave every completion and invoice field unchanged',async()=>{
  reset();const id=booking({date:'2026-09-01',start:'22:00',hours:8,sleepover:1,status:'accepted',accepted_at:'2026-08-31T01:00:00.000Z'}),before=db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  for(const value of ['invalid',-1,20,true,[],[3],'   ',2.12]){
   const r=await req('PATCH',`/api/bookings/${id}`,wc,{status:'completed',note:'A complete valid note used to isolate hours validation.',active_hours:value,active_note:'Supporting during the night.'});
   assert.equal(r.status,400);assert.match(r.json.code,/^active_hours_/);assert.deepEqual(db.prepare('SELECT * FROM bookings WHERE id=?').get(id),before);assert.equal(db.prepare('SELECT count(*) n FROM shift_notes WHERE booking_id=?').get(id).n,0);
  }
 });
 results.startupErrors=log.split('\n').filter(x=>/audit snapshot:|TypeError|ReferenceError|SQLITE_ERROR/.test(x));save();console.log(JSON.stringify(results,null,2));if(results.checks.some(x=>x.result==='FAIL'))process.exitCode=1;
}
main().catch(e=>{results.fatal=e.stack;save();console.error(e);process.exitCode=1}).finally(async()=>{db?.close();if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}if(maps?.listening)await new Promise(r=>maps.close(r));fs.rmSync(RT,{recursive:true,force:true});});
