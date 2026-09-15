'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=async function verificationReadinessUI(h){
  const {db,req,ok,test,register,ins,detail,a,stamp,imagePath,ROOT}=h;
  // This suite tests office rendering against real API responses. Signup itself
  // is covered separately; use a database fixture to stay within its rate limit.
  const person={id:ins('users',{role:'worker',name:'Synthetic readiness worker',email:'readiness.ui@example.test',pass:'not-a-login-credential',created:stamp})};
  ins('worker_profiles',{user_id:person.id,visible:0});
  const nodes={},listeners={};for(const id of ['adminContent','page-admin','vfStats','vfQueue','vfDetail','vfChips'])nodes[id]={innerHTML:'',classList:{toggle(){}},querySelectorAll:()=>[]};
  const context={document:{getElementById:id=>nodes[id],addEventListener:(name,fn)=>listeners[name]=fn},location:{hash:'#/admin/verification?role=worker&person='+person.id+'&q=readiness.ui'},URLSearchParams,Date,Map,Object,Number,String,Math,Promise,API:{me:{id:1,admin:true},call:async(p,o={})=>ok(await req(o.method||'GET','/api'+p,a,o.body))},toast(){}};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/admin-verification.js'),'utf8'),context);
  const render=()=>context.CareVerify.render(nodes.adminContent);
  const guide=()=>listeners.click({target:{closest:selector=>selector==='[data-v-action]'?{dataset:{vAction:'guide'}}:null},preventDefault(){}});
  await test('New worker file explains waiting and offers no premature review or claim action',async()=>{
    await render();const d=await detail(person.id),html=nodes.vfDetail.innerHTML;
    assert.equal(d.office_action_count,0);assert.equal(d.state,'waiting');assert.match(html,/No office action needed/);assert.match(html,/worker needs to upload/);
    assert.ok(!html.includes('Start next check'));assert.ok(!html.includes('Claim this file'));assert.ok(!html.includes('Activate worker'));
    assert.match(html,/<details class="vf-optional vf-later-checks"><summary>Later office checks · 8/);
    assert.match(nodes.vfQueue.innerHTML,/No office review needed/);assert.ok(!nodes.vfQueue.innerHTML.includes('Unassigned'));
    assert.ok(context.CareVerify.view.screening().includes('data-v-form="screening"'));
    assert.ok(context.CareVerify.view.recruitment().includes('data-v-form="recruitment"'));
  });
  let certificate;
  await test('A received certificate exposes one review action and opens the document',async()=>{
    certificate=ins('worker_docs',{worker_id:person.id,doc_type:'cpr',file_name:'review-image.png',file_mime:'image/png',file_path:imagePath,uploaded_at:stamp,review_state:'submitted'});
    await render();assert.equal((await detail(person.id)).office_action_count,1);
    assert.match(nodes.vfDetail.innerHTML,/1 office action/);assert.match(nodes.vfDetail.innerHTML,/Start next check/);assert.match(nodes.vfDetail.innerHTML,/Claim this file/);
    await guide();assert.match(nodes.vfDetail.innerHTML,/data-v-section="documents" aria-current="page"/);
  });
  await test('Returning the only evidence removes review prompts without concealing requirements',async()=>{
    db.prepare("UPDATE worker_docs SET review_state='rejected' WHERE id=?").run(certificate);
    await render();await guide();const html=context.CareVerify.view.checklist();
    assert.equal((await detail(person.id)).office_action_count,0);assert.ok(!html.includes('Start next check'));assert.match(html,/Later office checks/);
    assert.match(nodes.vfDetail.innerHTML,/data-v-section="overview" aria-current="page"/);
  });
  await test('Guided recruitment skips future screening checks when only the interview is ready',async()=>{
    ins('worker_docs',{worker_id:person.id,doc_type:'resume',file_name:'review-image.png',file_mime:'image/png',file_path:imagePath,uploaded_at:stamp,review_state:'approved',verified_at:stamp});
    await render();const d=await detail(person.id);assert.equal(d.office_action_count,1);assert.equal(d.tasks.find(x=>x.key==='screening-status').actionable,false);
    await guide();assert.match(nodes.vfDetail.innerHTML,/data-v-section="recruitment" aria-current="page"/);
    assert.match(context.CareVerify.view.checklist(),/Later office checks · 7/);
  });
  await test('Safety restrictions still expose an immediate office action without worker uploads',async()=>{
    db.prepare('DELETE FROM worker_docs WHERE worker_id=?').run(person.id);
    db.prepare("UPDATE worker_profiles SET platform_block=1,platform_block_reason='Synthetic safety review' WHERE user_id=?").run(person.id);
    await render();const d=await detail(person.id);assert.equal(d.state,'blocked');assert.ok(d.office_action_count>0);assert.match(context.CareVerify.view.checklist(),/Start next check/);
    await guide();assert.match(nodes.vfDetail.innerHTML,/data-v-section="screening" aria-current="page"/);
    db.prepare('UPDATE worker_profiles SET platform_block=0 WHERE user_id=?').run(person.id);
  });
};
