'use strict';
// Real HTTP lifecycle tests against an isolated synthetic database. No email transport is configured.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..'),DIR=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'careweb-worker-readiness-'));
const source=fs.readFileSync(path.join(ROOT,'server.js'),'utf8'),stamp=new Date().toISOString(),results=[];
let child,db,base,admin,log='',serial=0;
function ins(table,values){return Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values)).lastInsertRowid);}
async function req(method,url,cookie,body){const r=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,text,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify(r.data)||r.text.slice(0,200));return r.data;}
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.stack);}}
async function worker(label){const email=`readiness.${++serial}.${label}@example.test`,r=await req('POST','/api/register',null,{role:'worker',email,name:'Readiness '+label,password:'Copper-Rainstorm!82',suburb:'Ryde NSW',services:['daily-tasks'],terms_accepted:true,terms_version:/const CURRENT_TERMS_VERSION = '([^']+)'/.exec(source)[1]});ok(r);return {id:r.data.user.id,cookie:r.cookie,email};}
const detail=async who=>ok(await req('GET','/api/admin/verification/'+who.id,admin));
const alerts=async()=>ok(await req('GET','/api/me/action-alerts',admin));
const office=async who=>(await alerts()).tasks.filter(t=>t.user_id===who.id);
const key=(who,suffix)=>who.id+':'+suffix;
const png=fs.readFileSync(path.join(ROOT,'public/assets/careweb/favicon-32.png')).toString('base64');
async function upload(who,type){return ok(await req('POST','/api/me/documents',who.cookie,{doc_type:type,expiry_date:'2027-01-20',file:{name:type+'.png',mime:'image/png',data:png}})).id;}
async function review(who,check,status='complete'){return ok(await req('POST','/api/admin/recruitment/checks',admin,{worker_id:who.id,check_key:check,status,evidence:'Synthetic recorded review evidence for this isolated regression.'}));}
async function verify(who,id){const d=await detail(who);return ok(await req('POST','/api/admin/verification/'+who.id+'/action',admin,{action:'verify-document',review_token:d.review_token,values:{document_id:id,method:'sighted-copy',note:'Synthetic supplied evidence checked in the isolated regression.',confirm:true}}));}
async function main(){
  const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['--no-warnings','server.js'],{cwd:ROOT,env:{PATH:process.env.PATH,PORT:String(port),BIND_HOST:'127.0.0.1',APP_URL:base,DB_PATH:path.join(DIR,'test.db'),DOCS_DIR:path.join(DIR,'docs'),PHOTOS_DIR:path.join(DIR,'photos'),SECRET_FILE:path.join(DIR,'secret'),SEED_DEMO:'on',AUTO_REPLY:'off',TZ:'Australia/Sydney',ADMIN_MFA_REQUIRED:'off'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/version')).ok)break;}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
  db=new DatabaseSync(path.join(DIR,'test.db'));db.exec('PRAGMA busy_timeout=5000');db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  const signed=await req('POST','/api/login',null,{email:db.prepare('SELECT email FROM users WHERE id=1').get().email,password:'demo1234'});ok(signed);admin=signed.cookie;
  let blank;
  await test('New blank worker has zero office actions and remains waiting on worker',async()=>{
    const before=(await alerts()).count;blank=await worker('blank');const a=await alerts(),d=await detail(blank);
    assert.equal(a.count,before);assert.deepEqual(a.tasks.filter(t=>t.user_id===blank.id),[]);assert.equal(d.state,'waiting');assert.equal(d.state_label,'Waiting on worker');assert.equal(d.office_action_count,0);assert.equal(d.ready,false);
    const mine=ok(await req('GET','/api/journey',blank.cookie));assert.ok(mine.tasks.some(t=>t.owner_kind==='person'&&t.task_key===key(blank,'setup:identity')));assert.ok(mine.tasks.some(t=>t.task_key===key(blank,'setup:upload-ndis-screening')));
    assert.equal(d.tasks.filter(t=>t.yours===false&&t.actionable===false).length,8);ok(await req('POST','/api/admin/workers/'+blank.id+'/approve',admin,{}),409);
  });
  await test('Register health warning excludes new empty applications and appears for reviewable identity',async()=>{
    const check=async()=>ok(await req('GET','/api/admin/self-test',admin)).checks.find(c=>c.name==='Banning registers checked');
    const before=await check(),who=await worker('register-warning');assert.deepEqual(await check(),before);
    await upload(who,'passport-au');assert.deepEqual(await check(),before);await upload(who,'driver-licence');const ready=await check();assert.equal(ready.state,'warn');assert.notEqual(ready.detail,before.detail);
    db.prepare('UPDATE users SET closed_at=? WHERE id=?').run(stamp,who.id);assert.deepEqual(await check(),before);
  });
  await test('Existing eight office placeholders reconcile without deleting history or passing checks',async()=>{
    const suffixes=['recruit:interview','recruit:references','recruit:employment','setup:screening-status','setup:register-ndis','setup:register-aged','setup:register-acqsc','setup:activation'];
    for(const suffix of suffixes)ins('journey_tasks',{task_key:key(blank,suffix),user_id:blank.id,kind:suffix.startsWith('recruit')?'recruitment':'setup',label:'Legacy future check',destination:'#/journey',owner_kind:'office',owner_id:1,created_at:stamp,ready_at:stamp,updated_at:stamp});
    const old=await detail(blank);old.state='review';old.state_label='Office review';old.office_action_count=8;
    db.prepare('UPDATE verification_queue SET dirty=0,date_key=?,state=?,data=? WHERE user_id=?').run('evidence-v2:'+stamp.slice(0,10)+':'+Math.floor(Date.now()/300000),'review',JSON.stringify(old),blank.id);
    const q=ok(await req('GET','/api/admin/journey-queue?view=office&q=Readiness%20blank',admin));assert.equal(q.total,0);
    for(const suffix of suffixes){const row=db.prepare('SELECT * FROM journey_tasks WHERE task_key=?').get(key(blank,suffix));assert.equal(row.state,'completed');assert.ok(row.completed_at);assert.equal(row.owner_id,1);}
    const cache=ok(await req('GET','/api/admin/verification?role=worker&q='+encodeURIComponent(blank.email),admin));assert.equal(cache.rows[0].state,'waiting');assert.equal(cache.rows[0].office_action_count,0);
    assert.equal(db.prepare('SELECT count(*) n FROM recruitment_checks WHERE worker_id=?').get(blank.id).n,0);assert.equal(db.prepare('SELECT visible FROM worker_profiles WHERE user_id=?').get(blank.id).visible,0);
  });
  await test('First certificate creates exactly one review with matching badge and queue counts',async()=>{
    const id=await upload(blank,'cpr'),tasks=await office(blank);assert.deepEqual(tasks.map(t=>t.task_key),[key(blank,'doc-review:'+id)]);
    const d=await detail(blank);assert.equal(d.pending_count,1);assert.equal(d.office_action_count,1);assert.equal(d.state,'review');
    const q=ok(await req('GET','/api/admin/journey-queue?view=office&q=Readiness%20blank',admin));assert.equal(q.total,1);assert.equal(q.rows[0].task_key,tasks[0].task_key);
    const a=await alerts();assert.equal(a.count,new Set(a.tasks.map(t=>t.task_key)).size);
  });
  await test('Returning evidence clears its review and shows worker replacement without future office tasks',async()=>{
    const d=await detail(blank),id=d.documents[0].id;
    ok(await req('POST','/api/admin/verification/'+blank.id+'/action',admin,{action:'return-document',review_token:d.review_token,values:{document_id:id,reason:'Please upload a clear copy showing the complete certificate.',confirm:true}}));
    assert.deepEqual(await office(blank),[]);assert.equal((await detail(blank)).state,'waiting');
    const mine=ok(await req('GET','/api/journey',blank.cookie));assert.ok(mine.tasks.some(t=>t.owner_kind==='person'&&t.task_key===key(blank,'setup:upload-cpr')));assert.equal(db.prepare('SELECT review_state FROM worker_docs WHERE id=?').get(id).review_state,'rejected');
  });
  await test('Removing an unreviewed replacement clears the office task while retaining its task history',async()=>{
    const id=await upload(blank,'first-aid');assert.equal((await office(blank)).length,1);ok(await req('POST','/api/me/documents/'+id+'/delete',blank.cookie,{}));assert.deepEqual(await office(blank),[]);assert.equal((await detail(blank)).state,'waiting');assert.equal(db.prepare('SELECT state FROM journey_tasks WHERE task_key=?').get(key(blank,'doc-review:'+id)).state,'completed');
  });
  await test('Resume starts interview review; references and employment appear at the relevant stage',async()=>{
    const who=await worker('recruitment'),id=await upload(who,'resume');
    assert.deepEqual((await office(who)).map(t=>t.task_key).sort(),[key(who,'doc-review:'+id),key(who,'recruit:interview')].sort());
    await verify(who,id);assert.deepEqual((await office(who)).map(t=>t.task_key),[key(who,'recruit:interview')]);
    await review(who,'interview');assert.deepEqual((await office(who)).map(t=>t.task_key),[key(who,'recruit:references')]);
    await review(who,'references');assert.deepEqual((await office(who)).map(t=>t.task_key),[key(who,'recruit:employment')]);
    await review(who,'employment');assert.deepEqual(await office(who),[]);assert.equal((await detail(who)).state,'waiting');ok(await req('POST','/api/admin/workers/'+who.id+'/approve',admin,{}),409);
  });
  await test('Booked interview creates an office action without making optional resume mandatory',async()=>{
    const who=await worker('interview-booked'),start=new Date(Date.now()+14*864e5),end=new Date(+start+30*60000);
    const queue=async()=>ok(await req('GET','/api/admin/verification?role=worker&q='+encodeURIComponent(who.email),admin)).rows[0];assert.equal((await queue()).state,'waiting');
    const slot=ok(await req('POST','/api/admin/interview-slots',admin,{starts_at:start.toISOString(),ends_at:end.toISOString()}));ok(await req('POST','/api/journey/interview',who.cookie,{slot_id:slot.id,revision:1}));
    assert.ok((await office(who)).some(t=>t.task_key===key(who,'recruit:interview')));assert.ok(!(await office(who)).some(t=>t.task_key===key(who,'setup:activation')));
    assert.equal((await queue()).state,'review');
    ok(await req('POST','/api/journey/interview',who.cookie,{cancel:true}));assert.equal((await queue()).state,'waiting');assert.deepEqual(await office(who),[]);
  });
  await test('Screening reference and identity evidence trigger only their applicable office checks',async()=>{
    const who=await worker('identity');db.prepare('UPDATE worker_profiles SET screening_app_number=? WHERE user_id=?').run('SYNTHETIC-APPLICATION',who.id);
    assert.deepEqual((await office(who)).map(t=>t.task_key),[key(who,'setup:screening-status')]);
    await upload(who,'passport-au');let tasks=await office(who);assert.ok(!tasks.some(t=>t.task_key.includes('setup:register-')));
    await upload(who,'driver-licence');tasks=await office(who);assert.equal(tasks.filter(t=>t.task_key.includes('setup:register-')).length,3);assert.ok(tasks.some(t=>t.task_key===key(who,'recruit:interview')));assert.ok(!tasks.some(t=>t.task_key===key(who,'setup:activation')));
  });
  await test('Automatically withdrawn worker retains outstanding register reviews without current identity or booking history',async()=>{
    const who=await worker('auto-hidden');
    // Existing visibility reconciliation records auto_hidden when a previously
    // visible worker loses eligibility; this fixture has no current documents.
    db.prepare('UPDATE worker_profiles SET auto_hidden=1,visible=0 WHERE user_id=?').run(who.id);
    ok(await req('POST','/api/admin/workers/'+who.id+'/banning',admin,{all:'clear',note:'Synthetic previous register results.'}));
    ok(await req('POST','/api/admin/workers/'+who.id+'/banning',admin,{result:'unchecked',note:'Synthetic register result requires a fresh check.'}));
    const p=db.prepare('SELECT * FROM worker_profiles WHERE user_id=?').get(who.id);assert.equal(p.auto_hidden,1);assert.equal(p.banning_checked_at,'');assert.equal(db.prepare('SELECT count(*) n FROM bookings WHERE worker_id=?').get(who.id).n,0);assert.equal(db.prepare('SELECT count(*) n FROM worker_docs WHERE worker_id=?').get(who.id).n,0);
    const tasks=await office(who);assert.ok(tasks.some(t=>t.task_key===key(who,'setup:register-ndis')));assert.ok(tasks.some(t=>t.task_key===key(who,'setup:screening-status')));assert.ok(!tasks.some(t=>t.task_key===key(who,'setup:activation')));assert.equal((await detail(who)).state,'review');
  });
  await test('Manual safety stop stays actionable without documents and clears only when lifted',async()=>{
    const who=await worker('safety');ok(await req('POST','/api/admin/workers/'+who.id+'/platform-block',admin,{block:true,reason:'Synthetic safety concern requiring office attention.'}));
    assert.equal((await detail(who)).state,'blocked');assert.ok((await office(who)).some(t=>t.kind==='safeguarding'||/safety|platform-block/.test(t.task_key)));assert.equal(db.prepare('SELECT visible FROM worker_profiles WHERE user_id=?').get(who.id).visible,0);
    ok(await req('POST','/api/admin/workers/'+who.id+'/platform-block',admin,{block:false}));assert.deepEqual(await office(who),[]);assert.equal((await detail(who)).state,'waiting');
  });
  await test('Suspended clearance and banned register remain actionable even for an empty application',async()=>{
    const who=await worker('restricted');ok(await req('POST','/api/admin/workers/'+who.id+'/screening',admin,{status:'suspended',source:'Synthetic screening test'}));ok(await req('POST','/api/admin/workers/'+who.id+'/banning',admin,{aged_result:'banned',note:'Synthetic register match requiring office review.'}));
    const tasks=await office(who);assert.ok(tasks.some(t=>t.task_key===key(who,'setup:screening-status')));assert.ok(tasks.some(t=>t.task_key===key(who,'setup:register-aged')));assert.equal((await detail(who)).state,'blocked');assert.ok(!tasks.some(t=>t.task_key===key(who,'setup:activation')));
  });
  await test('An escalated requested checklist remains genuine office work before documents arrive',async()=>{
    const who=await worker('help');const d=await detail(who),result=ok(await req('POST','/api/admin/verification/'+who.id+'/action',admin,{action:'request-checklist',review_token:d.review_token,values:{keys:['task:photo'],note:'Please add your profile photo to your account.',interval_days:3,max_reminders:1,confirm:true}}));
    db.prepare("UPDATE verification_followups SET status='needs-office' WHERE id=?").run(result.id);
    assert.equal((await detail(who)).state,'review');assert.ok((await detail(who)).office_action_count>0);const all=(await alerts()).tasks;assert.ok(all.some(t=>t.task_key.includes('verification')&&t.task_key.includes(String(result.id))));
  });
  await test('Activation appears after evidence and reviews are actually complete and clears after approval',async()=>{
    const who=await worker('activation');for(const check of ['interview','references','employment'])await review(who,check);assert.ok(!(await office(who)).some(t=>t.task_key===key(who,'setup:activation')));
    for(const type of ['passport-au','driver-licence','ndis-screening','ndis-orientation','first-aid'])await verify(who,await upload(who,type));const cpr=await upload(who,'cpr');
    db.prepare("UPDATE users SET verified=1 WHERE id=?").run(who.id);db.prepare("UPDATE worker_profiles SET photo='synthetic-profile.png' WHERE user_id=?").run(who.id);
    for(const module of db.prepare('SELECT * FROM modules WHERE active=1').all())ok(await req('POST','/api/modules/'+module.key+'/submit',who.cookie,{answers:JSON.parse(module.quiz).map(q=>q.correct)}));
    ok(await req('POST','/api/admin/workers/'+who.id+'/screening',admin,{status:'cleared',source:'Synthetic test-only screening record'}));ok(await req('POST','/api/admin/workers/'+who.id+'/banning',admin,{all:'clear',note:'Synthetic test-only register checks.'}));
    assert.equal((await detail(who)).ready,false);assert.deepEqual((await office(who)).map(t=>t.task_key),[key(who,'doc-review:'+cpr)]);await verify(who,cpr);
    const d=await detail(who);assert.equal(d.ready,true);assert.equal(d.state,'ready');assert.deepEqual((await office(who)).map(t=>t.task_key),[key(who,'setup:activation')]);
    ok(await req('POST','/api/admin/workers/'+who.id+'/approve',admin,{}));assert.ok(!(await office(who)).some(t=>t.task_key===key(who,'setup:activation')));assert.equal(db.prepare('SELECT visible FROM worker_profiles WHERE user_id=?').get(who.id).visible,1);
  });
  await test('Waiting applications do not consume automatic reviewer capacity or become overdue office reviews',async()=>{
    const who=await worker('unassigned');const c=ok(await req('GET','/api/admin/verification/settings',admin));ok(await req('POST','/api/admin/verification/settings',admin,{...c,enabled:true,confirm:true,reviewers:[{id:1,available:true,roles:['worker'],capacity:200}]}));
    const d=await detail(who);assert.equal(d.state,'waiting');assert.equal(d.case.owner_id,null);const q=ok(await req('GET','/api/admin/verification?status=overdue&q='+encodeURIComponent(who.email),admin));assert.equal(q.total,0);
    const c2=ok(await req('GET','/api/admin/verification/settings',admin));ok(await req('POST','/api/admin/verification/settings',admin,{...c2,enabled:false,confirm:true}));
  });
}
(async()=>{try{await main();}catch(e){results.push({name:'Harness',result:'FAIL',error:e.stack});console.error(e);}finally{if(db)db.close();if(child&&child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped;}if(process.env.WORKER_READINESS_RESULTS_PATH)fs.writeFileSync(process.env.WORKER_READINESS_RESULTS_PATH,JSON.stringify({runtime:process.version,results,serverLog:log},null,2));fs.rmSync(DIR,{recursive:true,force:true});console.log(`worker readiness: ${results.filter(t=>t.result==='PASS').length}/${results.length} passed`);process.exitCode=results.some(t=>t.result==='FAIL')?1:0;}})();
