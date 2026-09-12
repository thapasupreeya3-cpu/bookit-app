'use strict';
// Shipped component event handlers with a minimal DOM model. No browser claims.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'public/assets/worker-credentials.js'),'utf8');
const server=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
const cat=vm.runInNewContext(server.slice(server.indexOf('const DOC_CATEGORIES = ['),server.indexOf('const DOC_MAP = '))+';({categories:DOC_CATEGORIES,types:DOC_CATALOG})');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const results=[];
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(err){results.push({name,result:'FAIL',error:err.stack});console.error('FAIL '+name+' '+err.stack);}}
function ui(documents=[],requests=[]){
  let docs=structuredClone(documents),requestList=structuredClone(requests),answer=true,uploadError='',refreshError=false;
  const calls=[],nodes=new Map();
  function node(id){let html='';const children=new Map();const n={id,value:'',disabled:false,textContent:'',files:[],isConnected:true,closest:()=>wrap,focus(){n.focused=true;},scrollIntoView(){n.scrolled=true;},querySelector(selector){if(!children.has(selector))children.set(selector,node(id+selector));return children.get(selector);},querySelectorAll:()=>[],get innerHTML(){return html;},set innerHTML(v){html=v;children.clear();}};return n;}
  const wrap=node('miniCreds');nodes.set('miniCreds',wrap);
  const ctx={document:{getElementById:id=>nodes.get(id)},location:{hash:'#/account/credentials'},URLSearchParams,esc,fmtAU:x=>x,API:{me:{id:41,role:'worker',name:'Synthetic Worker',email:'test@example.test'},call:async(url,opts={})=>{calls.push({url,...opts});if(url==='/doc-catalog')return cat;if(url==='/me/documents'&&!opts.method){if(refreshError)throw Error('Refresh offline');return {documents:docs,requests:requestList};}if(url==='/me/documents'){if(uploadError)throw Error(uploadError);const id=100+docs.length;docs.push({id,...opts.body,file_name:opts.body.file.name,has_file:true,review:'submitted',status:'valid'});return {id};}if(/\/delete$/.test(url)){docs=docs.filter(d=>d.id!==Number(url.split('/')[3]));return {ok:true};}if(url==='/contact')return {ref:'M-test'};throw Error(url);}},CareFlow:{dialog:async()=>answer},fileToB64Shrunk:async input=>({name:input.files[0].name,mime:'application/pdf',data:'JVBERi0='})};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  const render=()=>ctx.WorkerCredentials.render(wrap);
  const choose=key=>{wrap.querySelector('#credType').value=key;wrap.onchange({target:{id:'credType',value:key}});};
  const action=async(action,id)=>{const b={dataset:{credAction:action,value:String(id)},disabled:false};await wrap.onclick({target:{closest:()=>b},preventDefault(){}});};
  function uploadForm(name='proof.pdf',expiry='2027-01-01'){
    const form=node('credUploadForm');form.elements={file:{files:[{name,size:100,type:'application/pdf'}],value:name},expiry_date:{value:expiry},label:{value:''},check_number:{value:'ABC123'}};form.querySelectorAll=()=>Object.values(form.elements);return form;
  }
  const submit=form=>wrap.onsubmit({target:form,preventDefault(){}});
  return {ctx,wrap,calls,render,choose,action,uploadForm,submit,docs:()=>docs,setAnswer(v){answer=v;},failUpload(v){uploadError=v;},failRefresh(v){refreshError=v;}};
}
(async()=>{
await test('All 25 types appear in the dropdown before selecting a file; missing essentials are named',async()=>{
 const v=ui();await v.render();const out=v.wrap.innerHTML;assert.equal(cat.types.length,25);for(const t of cat.types)assert.ok(out.includes('value="'+t.key+'"'),t.key);assert.match(out,/7 essential items need files/);assert.match(out,/100 points of identity/);assert.match(out,/Right to work in Australia/);assert.match(out,/Resume \/ CV/);assert.ok(!out.includes('flowFiles'));
});
await test('Each file has its own correct preview, replacement and permitted removal actions',async()=>{
 const v=ui([{id:1,doc_type:'cpr',file_name:'CPR.pdf',has_file:true,verified_at:'2026-09-01',review:'approved',status:'valid'},{id:2,doc_type:'driver-licence',file_name:'licence.JPG',has_file:true,review:'submitted',status:'valid'},{id:3,doc_type:'ndis-screening',has_file:false,review:'submitted',review_note:'Need both sides <script>'}]);await v.render();const out=v.wrap.innerHTML;assert.match(out,/scope=worker&id=1/);assert.match(out,/\/api\/documents\/2\/file/);assert.match(out,/data-cred-action="replace" data-value="1"/);assert.match(out,/data-cred-action="request-removal" data-value="1"/);assert.ok(!out.includes('data-cred-action="remove" data-value="1"'));assert.match(out,/data-cred-action="remove" data-value="2"/);assert.match(out,/Needs a file/);assert.match(out,/Need both sides &lt;script&gt;/);
});
await test('Identity counts unique uploaded types; details-only, expired and rejected files do not mark requirements received',async()=>{
 const v=ui([{id:1,doc_type:'passport-au',has_file:true,status:'valid'},{id:2,doc_type:'passport-au',has_file:true,status:'valid'},{id:3,doc_type:'driver-licence',has_file:false,status:'valid'},{id:4,doc_type:'cpr',has_file:true,status:'expired'},{id:5,doc_type:'first-aid',has_file:true,status:'valid',review:'rejected'}]);await v.render();assert.match(v.wrap.innerHTML,/70 points uploaded/);assert.match(v.wrap.innerHTML,/6 essential items need files/);assert.match(v.wrap.innerHTML,/Expired/);assert.match(v.wrap.innerHTML,/Replace requested/);
});
await test('Actual platform completions remain in Training while uploaded training certificates have file controls',async()=>{
 const v=ui([{id:1,doc_type:'ndis-orientation',has_file:false,verified_at:'2026-01-01',evidence_origin:'platform-module',status:'no-expiry'},{id:2,doc_type:'first-aid',file_name:'First aid.pdf',has_file:true,status:'valid'}]);await v.render();assert.ok(!v.wrap.innerHTML.includes('data-cred-action="replace" data-value="1"'));assert.match(v.wrap.innerHTML,/data-cred-action="replace" data-value="2"/);assert.match(v.wrap.innerHTML,/#\/account\/training/);assert.match(v.wrap.innerHTML,/5 essential items need files/);
});
await test('Office requests preselect the exact catalogue type and preserve their explanation',async()=>{
 const v=ui([],[{doc_key:'wwcc',label:'Working with Children Check',note:'Please include the number'}]);await v.render();assert.match(v.wrap.innerHTML,/data-cred-action="add" data-value="wwcc"/);assert.match(v.wrap.innerHTML,/Please include the number/);await v.action('add','wwcc');assert.equal(v.wrap.querySelector('#credType').value,'wwcc');assert.match(v.wrap.querySelector('#credFormArea').innerHTML,/Expiry date \(required\)/);
});
await test('Type-specific fields hide irrelevant expiry/number inputs and show required qualification names',async()=>{
 const v=ui();await v.render();v.choose('resume');let out=v.wrap.querySelector('#credFormArea').innerHTML;assert.ok(!out.includes('name="expiry_date"'));assert.ok(!out.includes('name="check_number"'));v.choose('qualification');out=v.wrap.querySelector('#credFormArea').innerHTML;assert.match(out,/name="label" required/);assert.match(out,/name="expiry_date"/);
});
await test('Large PDFs are rejected before sending; phone photos still pass through automatic resizing',async()=>{
 const v=ui();await v.render();v.choose('resume');const f=v.uploadForm();f.elements.file.files[0].size=6*1024*1024;await v.submit(f);assert.equal(v.docs().length,0);assert.match(f.querySelector('[data-cred-form-status]').textContent,/PDF files can be up to 4 MB/);
 f.elements.file.files[0].type='image/jpeg';f.elements.file.files[0].name='phone-photo.jpg';await v.submit(f);assert.equal(v.docs().length,1);assert.equal(v.calls.find(c=>c.method==='POST').body.file.name,'phone-photo.jpg');
});
await test('Replacement locks the original type and sends the selected file ID without deleting history',async()=>{
 const v=ui([{id:9,doc_type:'cpr',file_name:'Old CPR.pdf',has_file:true,verified_at:'2026-01-01',status:'valid'}]);await v.render();await v.action('replace',9);assert.equal(v.wrap.querySelector('#credType').disabled,true);assert.equal(v.wrap.querySelector('#credType').value,'cpr');assert.match(v.wrap.querySelector('#credFormArea').innerHTML,/Old CPR.pdf/);await v.submit(v.uploadForm('New CPR.pdf'));const req=v.calls.find(c=>c.method==='POST');assert.equal(req.body.doc_type,'cpr');assert.equal(req.body.replaces_id,9);assert.equal(req.body.file.name,'New CPR.pdf');assert.equal(v.docs().length,2);assert.match(v.wrap.innerHTML,/Old CPR.pdf/);assert.match(v.wrap.innerHTML,/New CPR.pdf/);
});
await test('Failed upload keeps the chosen file for retry; a successful retry is recorded once',async()=>{
 const v=ui();await v.render();v.choose('cpr');const f=v.uploadForm();v.failUpload('Synthetic network failure');await v.submit(f);assert.equal(v.docs().length,0);assert.equal(f.elements.file.files[0].name,'proof.pdf');assert.match(f.querySelector('[data-cred-form-status]').textContent,/Synthetic network failure/);v.failUpload('');await v.submit(f);assert.equal(v.docs().length,1);
});
await test('A successful upload with a failed refresh tells the user it was saved and clears the file input',async()=>{
 const v=ui();await v.render();v.choose('resume');const f=v.uploadForm();v.failRefresh(true);await v.submit(f);assert.equal(v.docs().length,1);assert.match(f.querySelector('[data-cred-form-status]').textContent,/File saved, but/);assert.equal(f.elements.file.value,'');
});
await test('Leaving Credentials or changing accounts while preparing a file prevents upload',async()=>{
 for(const kind of ['page','account']){const v=ui();await v.render();v.choose('cpr');let finish;v.ctx.fileToB64Shrunk=()=>new Promise(r=>finish=r);const pending=v.submit(v.uploadForm());if(kind==='page')v.ctx.location.hash='#/bookings';else v.ctx.API.me.id=999;finish({name:'proof.pdf',data:'test'});await pending;assert.equal(v.calls.filter(c=>c.method==='POST').length,0,kind);}
});
await test('Remove is confirmed and targets only the chosen file; verified removal requests identify the exact evidence',async()=>{
 const v=ui([{id:7,doc_type:'cpr',has_file:true},{id:8,doc_type:'first-aid',has_file:true,verified_at:'2026-01-01',file_name:'Verified.pdf'}]);await v.render();v.setAnswer(null);await v.action('remove',7);assert.equal(v.docs().length,2);v.setAnswer(true);await v.action('remove',7);assert.deepEqual(v.docs().map(d=>d.id),[8]);assert.ok(v.calls.some(c=>c.url==='/me/documents/7/delete'));v.setAnswer('Wrong version of my certificate');await v.action('request-removal',8);const request=v.calls.find(c=>c.url==='/contact');assert.match(request.body.body,/document #8/);assert.match(request.body.body,/Verified.pdf/);assert.match(v.wrap.querySelector('#credNotice').textContent,/M-test/);assert.equal(v.docs().length,1);
});
await test('Late document responses do not overwrite another page; failed reads offer retry',async()=>{
 const b=ui();b.ctx.API.call=async()=>{throw Error('<offline>');};await b.render();assert.match(b.wrap.innerHTML,/&lt;offline&gt;/);assert.match(b.wrap.innerHTML,/id="acctRetry"/);
 // Resolve a single shared deferred read for both requests.
 const c=ui();let done;const response=new Promise(r=>done=r);c.ctx.API.call=()=>response;const loading=c.render();c.ctx.location.hash='#/bookings';c.wrap.innerHTML='New page';done({types:[],documents:[]});await loading;assert.equal(c.wrap.innerHTML,'New page');
});
console.log('credentials: '+results.filter(r=>r.result==='PASS').length+'/'+results.length+' passed');if(process.env.CREDENTIALS_RESULTS_PATH)fs.writeFileSync(process.env.CREDENTIALS_RESULTS_PATH,JSON.stringify({runtime:process.version,results},null,2)+'\n');process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
