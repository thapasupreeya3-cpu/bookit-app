'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=async function scenarios(h) {
  const {db,req,ok,test,register,ins,detail,act,a,p,w,stamp,imagePath,ROOT}=h;
  const config=async()=>ok(await req('GET','/api/admin/verification/settings',a));
  const run=async()=>ok(await req('POST','/api/admin/verification/run',a,{}));
  const oldDate=new Date(Date.now()-8*864e5).toISOString();
  let subject,followupId;
  await test('Automation settings are office-only, validate all reviewers and reject stale settings',async()=>{
    ok(await req('GET','/api/admin/verification/settings',w.cookie),403);
    ok(await req('POST','/api/admin/verification/run',w.cookie,{}),403);
    const c=await config();ok(await req('POST','/api/admin/verification/settings',a,{...c,enabled:true,confirm:true,reviewers:[{id:p.id,available:true,roles:['worker'],capacity:4}]}),400);
    ok(await req('POST','/api/admin/verification/settings',a,{...c,confirm:true,revision:'stale'}),409);
    assert.equal((await config()).enabled,false);
  });
  await test('Automatic assignment respects availability, role, capacity and manual ownership',async()=>{
    const second=await register('worker','reviewer.two@example.test');db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(second.id);
    const workers=[];for(let i=0;i<5;i++){const person=await register('worker','assignment.'+i+'@example.test');workers.push(person);ins('worker_docs',{worker_id:person.id,doc_type:'cpr',file_name:'review-image.png',file_mime:'image/png',file_path:imagePath,uploaded_at:stamp,review_state:'submitted'});} 
    const before=(await detail(w.id)).case.owner_id,c=await config();
    ok(await req('GET','/api/admin/verification?role=worker',a));
    const load=db.prepare("SELECT count(*) n FROM verification_queue WHERE owner_id=1 AND state IN ('review','ready','blocked')").get().n;
    ok(await req('POST','/api/admin/verification/settings',a,{...c,enabled:true,confirm:true,review_days:2,reviewers:[{id:1,available:true,roles:['worker'],capacity:load+2},{id:second.id,available:true,roles:['worker'],capacity:2}]}));
    const assigned=workers.map(x=>db.prepare('SELECT * FROM verification_cases WHERE user_id=?').get(x.id)).filter(Boolean);
    assert.equal(assigned.length,4);assert.equal(assigned.filter(x=>x.owner_id===1).length,2);assert.equal(assigned.filter(x=>x.owner_id===second.id).length,2);
    assert.ok(assigned.every(x=>![0,6].includes(new Date(x.due_date+'T12:00:00').getDay())));
    assert.equal((await detail(w.id)).case.owner_id,before);assert.equal((await detail(p.id)).case.owner_id,null);
    await run();assert.equal(workers.filter(x=>db.prepare('SELECT 1 FROM verification_cases WHERE user_id=?').get(x.id)).length,4);
    const updated=await config();ok(await req('POST','/api/admin/verification/settings',a,{...updated,enabled:false,confirm:true}));
  });
  await test('Recruitment remains office work and cannot be included in a person follow-up',async()=>{
    subject=await register('worker','combined.request@example.test');const d=await detail(subject.id);
    assert.equal(d.state,'waiting');assert.equal(d.office_action_count,0);assert.ok(d.tasks.some(x=>x.key==='recruit-interview'&&x.yours===false&&x.actionable===false));
    assert.ok(!d.automation.candidates.some(x=>/recruit|screening-status|register-/.test(x.key)));
    ok(await act(subject.id,'request-checklist',{keys:['task:recruit-interview'],note:'Please complete this synthetic request.',interval_days:3,max_reminders:2,confirm:true}),400);
  });
  await test('Combined request needs approval, creates one message and rejects duplicate submissions',async()=>{
    const values={keys:['task:photo','task:verify-email'],note:'Please complete the selected account setup items.',interval_days:3,max_reminders:1,confirm:true};
    ok(await act(subject.id,'request-checklist',{...values,confirm:false}),400);
    const d=await detail(subject.id),r=ok(await act(subject.id,'request-checklist',values,d.review_token));followupId=r.id;
    ok(await act(subject.id,'request-checklist',values,d.review_token),409);ok(await act(subject.id,'request-checklist',values),409);
    assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox WHERE event_key LIKE ?').get(`verification-followup:${followupId}:%`).n,1);
  });
  await test('Follow-ups wait for delivery, remove completed items and escalate after the limit',async()=>{
    await run();await run();assert.equal(db.prepare('SELECT reminders_sent FROM verification_followups WHERE id=?').get(followupId).reminders_sent,0);
    db.prepare("UPDATE delivery_outbox SET status='sent',sent_at=? WHERE event_key=?").run(oldDate,`verification-followup:${followupId}:0`);
    db.prepare('UPDATE users SET verified=1 WHERE id=?').run(subject.id);await run();await run();
    let f=db.prepare('SELECT * FROM verification_followups WHERE id=?').get(followupId);assert.equal(f.reminders_sent,1);
    const row=db.prepare('SELECT * FROM delivery_outbox WHERE event_key=?').get(`verification-followup:${followupId}:1`),body=JSON.parse(row.payload)[3];assert.ok(body.includes('profile photo'));assert.ok(!body.includes('Confirm your email'));
    db.prepare("UPDATE delivery_outbox SET status='sent',sent_at=? WHERE id=?").run(oldDate,row.id);await run();assert.equal(db.prepare('SELECT status FROM verification_followups WHERE id=?').get(followupId).status,'needs-office');
    db.prepare('UPDATE worker_profiles SET photo=? WHERE user_id=?').run('/synthetic/photo.png',subject.id);await run();assert.equal(db.prepare('SELECT status FROM verification_followups WHERE id=?').get(followupId).status,'completed');
  });
  await test('Claiming a file is attributed, rejects another owner and overdue files are filterable',async()=>{
    ok(await act(subject.id,'claim',{}));const d=await detail(subject.id);assert.equal(d.case.owner_id,1);assert.ok(d.history.some(x=>x.action==='Review claimed'));
    const c=await register('worker','claimed.by.other@example.test');const other=db.prepare("SELECT id FROM users WHERE email='reviewer.two@example.test'").get().id;
    ins('worker_docs',{worker_id:c.id,doc_type:'cpr',file_name:'review-image.png',file_mime:'image/png',file_path:imagePath,uploaded_at:stamp,review_state:'submitted'});
    ok(await act(c.id,'assign',{owner_id:other,due_date:'2025-01-01'}));ok(await act(c.id,'claim',{}),409);
    const q=ok(await req('GET','/api/admin/verification?status=overdue',a));assert.ok(q.rows.some(x=>x.id===c.id));assert.ok(q.counts.overdue>0);
  });
  await test('Stopping approved follow-ups cancels unsent messages and account closure prevents new reminders',async()=>{
    const who=await register('worker','stop.followup@example.test');let r=ok(await act(who.id,'request-checklist',{keys:['task:photo'],note:'Please add your profile photo in your account.',interval_days:7,max_reminders:2,confirm:true}));
    ok(await act(who.id,'stop-followups',{id:r.id,confirm:true}));assert.equal(db.prepare('SELECT status FROM delivery_outbox WHERE event_key=?').get(`verification-followup:${r.id}:0`).status,'cancelled');
    r=ok(await act(who.id,'request-checklist',{keys:['task:photo'],note:'Please add your profile photo in your account.',interval_days:7,max_reminders:2,confirm:true}));db.prepare('UPDATE users SET closed_at=? WHERE id=?').run(stamp,who.id);await run();assert.equal(db.prepare('SELECT status FROM verification_followups WHERE id=?').get(r.id).status,'completed');
  });
  await test('Plan comparisons retain reviewed answers and show exact changes in a newer version',async()=>{
    const old=db.prepare('SELECT * FROM support_plans WHERE participant_id=? AND current=1').get(p.id);
    db.prepare('UPDATE support_plans SET goals=? WHERE id=?').run('Original synthetic goal',old.id);ok(await act(p.id,'review-plan',{plan_id:old.id,confirm:true}));
    assert.equal(JSON.parse(db.prepare('SELECT data FROM verification_plan_snapshots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(p.id).data).goals,'Original synthetic goal');
    db.prepare('UPDATE support_plans SET current=0 WHERE id=?').run(old.id);const newer={...old,version:old.version+1,current:1,goals:'Updated synthetic goal',reviewed_at:'',reviewed_by:''};delete newer.id;const id=ins('support_plans',newer);
    const d=await detail(p.id);assert.ok(d.plan_review);assert.deepEqual(d.plan_changes.changes.find(x=>x.key==='goals'),{key:'goals',label:d.plan_changes.changes.find(x=>x.key==='goals').label,before:'Original synthetic goal',after:'Updated synthetic goal'});
    ok(await act(p.id,'review-plan',{plan_id:id,confirm:true}));assert.equal((await detail(p.id)).plan_changes.changes.length,0);
  });
  await test('Legacy current reviewed plans do not acquire a false extra review requirement',async()=>{
    const who=await register('participant','legacy.reviewed@example.test');
    ins('support_plans',{participant_id:who.id,version:1,status:'confirmed',current:0,goals:'Previous goal',confirmed_at:stamp,reviewed_at:stamp,reviewed_by:'Synthetic prior reviewer',updated:stamp,created:stamp});
    ins('support_plans',{participant_id:who.id,version:2,status:'confirmed',current:1,goals:'Current reviewed goal',confirmed_at:stamp,reviewed_at:stamp,reviewed_by:'Synthetic prior reviewer',updated:stamp,created:stamp});
    const d=await detail(who.id);assert.equal(d.plan_review,false);assert.equal(d.plan_changes.baseline,null);assert.equal(d.plan_changes.changes.length,0);
  });
  await test('Changes to a previously snapshotted plan are flagged even if its version was not incremented',async()=>{
    const plan=db.prepare('SELECT id FROM support_plans WHERE participant_id=? AND current=1').get(p.id);
    db.prepare('UPDATE support_plans SET communication=? WHERE id=?').run('Changed after office review',plan.id);const d=await detail(p.id);assert.ok(d.plan_review);assert.ok(d.plan_changes.changes.some(x=>x.key==='communication'));ok(await act(p.id,'review-plan',{plan_id:plan.id,confirm:true}));assert.equal((await detail(p.id)).plan_changes.changes.length,0);
  });
  await test('Consented document suggestions remain separate from verification and detect changed evidence',async()=>{
    const doc=ins('worker_docs',{worker_id:subject.id,doc_type:'cpr',file_name:'source.png',file_mime:'image/png',file_path:imagePath,uploaded_at:stamp,review_state:'submitted'});
    const hash=require('node:crypto').createHash('sha256').update(JSON.stringify(fs.readFileSync(imagePath))).digest('hex');
    const id=ins('document_assistance',{user_id:subject.id,doc_id:doc,result:JSON.stringify({source_hash:hash,expiry_date:'2030-01-01',check_number:'SYNTHETIC-CPR',issuer:'Synthetic issuer',confidence:.72,source_text:'Synthetic evidence text'}),created_at:stamp});
    const d=await detail(subject.id);assert.ok(d.assistance.suggestions.some(x=>x.id===id));
    const values={document_id:doc,suggestion_id:id,expiry_date:'2030-02-02',check_number:'REVIEWED-CPR',decision:'modified',confirm:true};
    ok(await act(subject.id,'review-suggestions',{...values,confirm:false}),400);ok(await act(p.id,'review-suggestions',values),409);
    ok(await act(subject.id,'review-suggestions',values));const saved=db.prepare('SELECT * FROM worker_docs WHERE id=?').get(doc);assert.equal(saved.check_number,'REVIEWED-CPR');assert.ok(!saved.verified_at);
    const changed=path.join(path.dirname(imagePath),'changed-source.png');fs.writeFileSync(changed,'changed synthetic bytes');db.prepare('UPDATE worker_docs SET file_path=? WHERE id=?').run(changed,doc);assert.equal((await detail(subject.id)).assistance.suggestions.length,0);ok(await act(subject.id,'review-suggestions',values),409);
  });
  await test('Live queue refresh reports a changed file without replacing the review or draft',async()=>{
    const nodes={};for(const id of ['adminContent','page-admin','vfStats','vfQueue','vfDetail','vfChips','vfLiveStatus'])nodes[id]={innerHTML:'',textContent:'',classList:{toggle(){}},querySelectorAll:()=>[]};
    const context={document:{hidden:false,getElementById:id=>nodes[id],addEventListener(){}},location:{hash:'#/admin/verification?role=worker&person='+subject.id},URLSearchParams,Date,Map,Object,Number,String,Math,Promise,API:{me:{id:1,admin:true},call:async(path,o={})=>ok(await req(o.method||'GET','/api'+path,a,o.body))},toast(){}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/admin-verification.js'),'utf8'),context);await context.CareVerify.render(nodes.adminContent);
    const before=nodes.vfDetail.innerHTML;db.prepare('UPDATE users SET suburb=? WHERE id=?').run('Changed suburb',subject.id);await context.CareVerify.pollQueue();assert.equal(nodes.vfDetail.innerHTML,before);assert.ok(nodes.vfLiveStatus.innerHTML.includes('file has changed'));assert.ok(nodes.vfQueue.innerHTML.includes('Changed suburb'));
    assert.ok(context.CareVerify.view.combinedRequest().includes('One checklist'));context.CareVerify.setPreview(await detail(p.id),{});assert.ok(context.CareVerify.view.planChangesPanel().includes('saved office review'));
  });
  await test('Cached queue rebuilds only changed people and invalidates on policy and day changes',async()=>{
    const automation=require('../lib/verification-automation'),original=db.prepare('SELECT id,name,role,email FROM users WHERE id=?').get(subject.id);let count=0;
    const c={db,ymd:()=>new Date().toISOString().slice(0,10)},fake={deliveryHooks:{}},review={staff:()=>[],activity(){},getPerson:id=>db.prepare("SELECT * FROM users WHERE id=? AND is_admin=0 AND COALESCE(closed_at,'')=''").get(id),summary:p=>{count++;return {id:p.id,name:p.name,role:p.role,email:p.email,suburb:p.suburb,state:'review',state_label:'Office review',case:{},documents:[],tasks:[]};}};
    const tool=automation(c,fake,review);db.exec('UPDATE verification_queue SET dirty=1');tool.refreshQueue();assert.ok(count>30);count=0;tool.refreshQueue();assert.equal(count,0);
    db.prepare('UPDATE users SET name=? WHERE id=?').run(original.name+' changed',subject.id);tool.refreshQueue();assert.equal(count,1);
    count=0;db.prepare("INSERT INTO settings(key,value) VALUES('synthetic-policy','one') ON CONFLICT(key) DO UPDATE SET value='two'").run();tool.refreshQueue();assert.ok(count>30);
    count=0;db.exec("UPDATE verification_queue SET date_key='2020-01-01'");tool.refreshQueue();assert.ok(count>30);db.exec('UPDATE verification_queue SET dirty=1');
  });
  await test('Outbox rechecks remaining items immediately before transport and respects preferences',async()=>{
    // Exercise the real outbox and hook with a capturing transport: no network messages are sent.
    db.prepare("UPDATE delivery_outbox SET next_at='2099-01-01T00:00:00Z' WHERE status IN ('queued','retry')").run();
    const who=await register('worker','transport.guard@example.test');const f=ok(await act(who.id,'request-checklist',{keys:['task:photo'],note:'Please add your photo to your profile.',interval_days:3,max_reminders:2,confirm:true}));
    const captured=[],c={db,ymd:()=>new Date().toISOString().slice(0,10),baseUrl:()=> 'http://synthetic.test',emailOn:()=>true,mailPrefs:()=>({messages:true}),sendMailDirect:async(...args)=>captured.push(args),isDemoWorker:()=>false,escHtml:x=>String(x).replace(/</g,'&lt;'),openRequests:()=>[]};
    const store=require('../lib/process-store')(c);require('../lib/verification-automation')(c,store,{staff:()=>[],activity(){},getPerson:id=>db.prepare("SELECT * FROM users WHERE id=? AND COALESCE(closed_at,'')=''").get(id),summary:p=>({tasks:db.prepare('SELECT photo FROM worker_profiles WHERE user_id=?').get(p.id)?.photo?[]:[{key:'photo',label:'Add your profile photo',yours:true,where:'#/account'}]})});
    db.prepare("UPDATE worker_profiles SET photo='received.png' WHERE user_id=?").run(who.id);await store.drain();assert.ok(!captured.some(x=>x[8]?.verification_followup===f.id));assert.equal(db.prepare('SELECT status FROM delivery_outbox WHERE event_key=?').get(`verification-followup:${f.id}:0`).status,'cancelled');
    db.prepare("UPDATE worker_profiles SET photo='' WHERE user_id=?").run(who.id);const next=ok(await act(who.id,'request-checklist',{keys:['task:photo'],note:'Please add your photo to your profile.',interval_days:3,max_reminders:2,confirm:true}));c.mailPrefs=()=>({messages:false});await store.drain();assert.equal(db.prepare('SELECT status FROM delivery_outbox WHERE event_key=?').get(`verification-followup:${next.id}:0`).status,'cancelled');
  });
};
