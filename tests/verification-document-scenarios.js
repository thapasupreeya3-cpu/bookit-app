'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=async function ({db,req,ok,test,register,ins,detail,act,a,p,stamp,imagePath,ROOT}) {
  let worker,empty,issued,metadata;const uploads=[];
  const types=['passport-au','driver-licence','medicare','visa','ndis-screening','wwcc','ndis-orientation','first-aid','cpr','cert3-support','resume','other'];
  const module=db.prepare('SELECT * FROM modules WHERE active=1 ORDER BY id LIMIT 1').get();
  const pass=async who=>ok(await req('POST','/api/modules/'+module.key+'/submit',who.cookie,{answers:JSON.parse(module.quiz).map(q=>q.correct)}));
  async function ui(d){
    const listeners={},nodes={};for(const id of ['adminContent','page-admin','vfStats','vfQueue','vfDetail','vfChips','vfSection'])nodes[id]={innerHTML:'',classList:{toggle(){}},querySelectorAll:()=>[],querySelector:()=>null};
    const context={document:{getElementById:id=>nodes[id],addEventListener:(type,fn)=>listeners[type]=fn},location:{hash:'#/admin/verification?role=worker&person='+d.id},URLSearchParams,Date,Map,Object,Number,String,Math,Promise,API:{me:{id:1,admin:true},call:async(path,o={})=>ok(await req(o.method||'GET','/api'+path,a,o.body))},toast(){}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/admin-verification.js'),'utf8'),context);await context.CareVerify.render(nodes.adminContent);
    return {view:context.CareVerify.view,nodes,listeners};
  }
  await test('Worker uploads in all evidence categories reach the selected admin file with protected originals',async()=>{
    worker=await register('worker','document.regression@example.test');empty=await register('worker','modules.only@example.test');
    for(const type of types){const r=ok(await req('POST','/api/me/documents',worker.cookie,{doc_type:type,label:type==='other'?'Signed engagement agreement':'',expiry_date:'2027-01-20',file:{name:type+'.png',mime:'image/png',data:fs.readFileSync(imagePath).toString('base64')}}));uploads.push(r.id);}
    const mine=ok(await req('GET','/api/me/documents',worker.cookie)),d=await detail(worker.id);
    assert.deepEqual(d.documents.map(x=>x.id).sort((a,b)=>a-b),mine.documents.map(x=>x.id).sort((a,b)=>a-b));assert.equal(d.document_count,types.length);assert.equal(d.pending_count,types.length);
    for(const row of d.documents){assert.equal(row.evidence_origin,'uploaded-file');assert.equal(ok(await req('GET',row.source_url,a)),undefined);ok(await req('GET',row.source_url,empty.cookie),403);}
    assert.equal((await detail(empty.id)).documents.length,0);
  });
  await test('A real module pass moves its completion record to Training without hiding uploaded certificates',async()=>{
    issued=(await pass(worker)).doc_id;assert.ok(issued);const d=await detail(worker.id);
    assert.equal(d.document_count,types.length);assert.equal(d.pending_count,types.length);assert.deepEqual(d.training_certificates.map(x=>x.id),[issued]);assert.ok(d.training.modules.find(x=>x.key===module.key).done);
    for(const key of ['first-aid','cpr','ndis-orientation'])assert.ok(d.documents.some(x=>x.doc_type===key&&x.has_file));
    assert.ok(db.prepare('SELECT 1 FROM worker_docs WHERE id=?').get(issued));
    ok(await act(worker.id,'return-document',{document_id:issued,reason:'This system record must not create a document request.',confirm:true}),403);
    const q=ok(await req('GET','/api/admin/verification?role=worker&q=document.regression',a));assert.equal(q.rows[0].document_count,types.length);
  });
  await test('Legacy records, misleading titles and uploaded copies survive module classification',async()=>{
    const legacy=ins('worker_docs',{worker_id:worker.id,doc_type:'legacy-file',label:'Legacy worker evidence',file_name:'old.png',file_mime:'image/png',file_path:imagePath,uploaded_at:stamp});
    metadata=ins('worker_docs',{worker_id:worker.id,doc_type:'birth-cert',label:'Details without a copy (The Care Web module)',uploaded_at:stamp,verified_at:stamp,review_state:'approved'});
    // A corrupt cross-person link must not turn this person's evidence into training.
    ins('module_completions',{module_id:module.id,module_key:module.key,worker_id:empty.id,passed:1,completed_at:stamp,doc_id:metadata});
    const d=await detail(worker.id);assert.ok(d.documents.some(x=>x.id===legacy));assert.equal(d.documents.find(x=>x.id===metadata).evidence_origin,'details-only');
    // An uploaded original stays reviewable even if an older module row points at it.
    ins('module_completions',{module_id:module.id,module_key:module.key,worker_id:worker.id,passed:1,completed_at:stamp,doc_id:uploads[0]});
    assert.ok((await detail(worker.id)).documents.some(x=>x.id===uploads[0]&&x.source_url));
    ok(await act(worker.id,'verify-document',{document_id:metadata,method:'sighted-copy',note:'There is no actual evidence attached.',confirm:true}),409);
  });
  await test('Worker document panels group actual files, disclose missing copies and preselect requests',async()=>{
    const u=await ui(await detail(worker.id)),html=u.view.documents();
    for(const label of ['Identity','Right to work','Checks and clearances','Qualifications and resume','Other worker documents','Uploaded training certificates'])assert.ok(html.includes(label),label);
    assert.ok(!html.includes('data-v-doc="'+issued+'"'));assert.ok(html.includes('data-v-doc="'+uploads[0]+'"'));assert.ok(html.includes('Details only · file not uploaded'));assert.ok(html.includes('No documents recorded in this category.')===false);assert.ok(html.includes('Not on file'));assert.ok(html.includes('Signed engagement agreement'));assert.ok(u.view.training().includes('Platform-issued completion records'));
    const b={dataset:{vAction:'request',docKey:'police-check'}};await u.listeners.click({target:{closest:s=>s==='[data-v-action]'?b:null},preventDefault(){}});
    assert.ok(u.nodes.vfSection.innerHTML.includes('<option value="police-check" selected>'));
    // A saved metadata record cannot show a green verification panel without a copy.
    const selected={dataset:{vDoc:String(metadata)}};await u.listeners.click({target:{closest:s=>s==='[data-v-doc]'?selected:null},preventDefault(){}});
    assert.ok(u.nodes.vfDetail.innerHTML.includes('Evidence not attached'));assert.ok(!u.nodes.vfDetail.innerHTML.includes('data-v-form="verify-document"'));assert.ok(!u.nodes.vfDetail.innerHTML.includes('Verification recorded</b>'));
  });
  await test('Training-only accounts explicitly show zero uploaded files and the missing document catalogue',async()=>{
    await pass(empty);const d=await detail(empty.id);assert.equal(d.document_count,0);assert.ok(d.training_certificates.length);const u=await ui(d),html=u.view.documents();
    assert.ok(html.includes('No worker files have been uploaded to this account.'));assert.ok(html.includes('Australian Passport'));assert.ok(html.includes('NDIS Worker Screening Check'));assert.ok(html.includes('No documents recorded in this category.'));assert.ok(!html.includes('data-v-doc='));assert.ok(u.view.training().includes('Platform-issued completion records'));
  });
  await test('Old queue projections refresh immediately to the separated worker document count',async()=>{
    const before=db.prepare('SELECT * FROM verification_queue WHERE user_id=?').get(worker.id),data=JSON.parse(before.data);data.document_count=999;
    db.prepare('UPDATE verification_queue SET dirty=0,date_key=?,data=? WHERE user_id=?').run(stamp.slice(0,10)+':'+Math.floor(Date.now()/300000),JSON.stringify(data),worker.id);
    const q=ok(await req('GET','/api/admin/verification?role=worker&q=document.regression',a));assert.equal(q.rows[0].document_count,(await detail(worker.id)).document_count);assert.notEqual(q.rows[0].document_count,999);
    const participant=await detail(p.id);assert.equal(participant.training_certificates.length,0);assert.ok(participant.documents.every(x=>x.source_url?.startsWith('/api/participant-documents/')||!x.has_file));
  });
};
