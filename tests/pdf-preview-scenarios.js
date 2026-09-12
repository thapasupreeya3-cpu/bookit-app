'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=async h=>{
  const {db,req,ok,test,register,ins,detail,a,p,w,stamp,imagePath,ROOT}=h;let pdfId,participantId;const bytes=require('./pdf-preview-fixture')();
  await test('PDF uploads retain exact bytes and original protections; download is an attachment',async()=>{
    pdfId=ok(await req('POST','/api/me/documents',w.cookie,{doc_type:'cpr',expiry_date:'2027-01-20',file:{name:'Synthetic certificate.pdf',mime:'application/pdf',data:bytes.toString('base64')}})).id;
    const stored=db.prepare('SELECT * FROM worker_docs WHERE id=?').get(pdfId);assert.deepEqual(fs.readFileSync(stored.file_path),bytes);
    const r=await req('GET','/api/documents/'+pdfId+'/file',a);ok(r);assert.equal(r.headers.get('content-security-policy'),'sandbox');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.text,bytes.toString());
    const download=await req('GET','/api/documents/'+pdfId+'/file?download=1',a);ok(download);assert.match(download.headers.get('content-disposition'),/^attachment;/);ok(await req('GET','/api/documents/'+pdfId+'/file?download=1',p.cookie),403);
    participantId=ins('participant_docs',{participant_id:p.id,form_key:'p-ndis-plan',file_name:'Synthetic plan.pdf',file_mime:'application/pdf',file_path:stored.file_path,uploaded_at:stamp,review_state:'submitted'});
    const pr=await req('GET','/api/participant-documents/'+participantId+'/file?download=1',p.cookie);ok(pr);assert.match(pr.headers.get('content-disposition'),/^attachment;/);ok(await req('GET','/api/participant-documents/'+participantId+'/file',w.cookie),403);
  });
  await test('Only the authenticated trusted viewer shell permits same-origin framing',async()=>{
    ok(await req('GET','/api/document-viewer?scope=worker&id='+pdfId),401);
    for(const query of ['scope=evil&id=1','scope=worker&id=0','scope=worker&id=1/../../server.js','scope=worker&id=9007199254740992'])ok(await req('GET','/api/document-viewer?'+query,a),400);
    for(const scope of ['worker','participant']){const r=await req('GET','/api/document-viewer?scope='+scope+'&id='+pdfId,a);ok(r);assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.match(r.headers.get('content-security-policy'),/object-src 'none'/);assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(r.text.includes('document-viewer.js?v=88.2.5'));}
    const app=await req('GET','/',a);assert.equal(app.headers.get('x-frame-options'),'DENY');
  });
  await test('All PDF rendering resources are local and served with usable content types',async()=>{
    const files=['pdf.min.mjs','pdf.worker.min.mjs','cmaps.json','standard_fonts/FoxitSerif.pfb','standard_fonts/LiberationSans-Regular.ttf','wasm/openjpeg.wasm','wasm/jbig2.wasm'];
    for(const f of files){const r=await req('GET','/vendor/pdfjs/'+f,a);assert.equal(r.status,200,f);assert.ok(!r.headers.get('content-type').startsWith('text/html'),f);if(f.endsWith('.wasm'))assert.equal(r.headers.get('content-type'),'application/wasm');if(f.endsWith('.mjs'))assert.match(r.headers.get('content-type'),/javascript/);}
    const maps=ok(await req('GET','/vendor/pdfjs/cmaps.json',a));assert.ok(Object.keys(maps).length>100);
  });
  function viewer({status=200,body=bytes,error=null,delay=null,mime='application/pdf',search='?scope=worker&id='+pdfId,embedded=false,pages=2,textError=false}={}){
    const nodes={},events={},calls=[];for(const id of ['pdfStatus','pdfCanvas','pdfSurface','pdfText','previousPage','nextPage','pageNumber','pageTotal','zoomOut','zoomIn','zoomLabel','fitPage','rotatePage','retryPdf','downloadPdf','viewerFeedback','viewerToolbar','pdfControls','htmlDocument','viewerMore','showText','textPanel','closeText','moreToggle'])nodes[id]={id,hidden:false,disabled:false,textContent:'',value:'',style:{},classList:{toggle(k,v){this[k]=v;}},clientWidth:620,removeAttribute(k){delete this[k];},focus(){this.focused=true;},contains(){return false;},setAttribute(k,v){this[k]=v;},getContext:()=>({}),addEventListener(type,fn){this[type]=fn;}};
    const document={getElementById:id=>nodes[id],addEventListener(type,fn){this[type]=fn;}},sdk={GlobalWorkerOptions:{},getDocument(options){calls.push(options);return {destroy:async()=>{},promise:error?Promise.reject(error):Promise.resolve({numPages:pages,destroy:async()=>{},getPage:async number=>({getViewport:({scale,rotation})=>({width:(rotation%180?842:595)*scale,height:(rotation%180?595:842)*scale}),render(args){calls.push({page:number,...args});return {cancel(){},promise:delay?delay():Promise.resolve()};},getTextContent:async()=>{if(textError)throw Error('No text');return {items:[{str:'Safe page '+number}]};}})})};}};
    const context={document,location:{search,origin:'https://care.example'},URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push({fetchUrl:url,options});return {headers:{get:k=>k==='content-type'?mime:null},ok:status===200,status,arrayBuffer:async()=>Uint8Array.from(body).buffer};},PDF_TEST_LIB:sdk,devicePixelRatio:2,addEventListener:(event,fn)=>events[event]=fn};context.window=context;context.self=context;context.top=embedded?{}:context;vm.createContext(context);
    const script=fs.readFileSync(path.join(ROOT,'public/assets/document-viewer.js'),'utf8').replace("await import('/vendor/pdfjs/pdf.min.mjs')","await Promise.resolve(window.PDF_TEST_LIB)").replace('window.CareDocumentViewer.mount();','');vm.runInContext(script,context);
    return {context,nodes,calls,events,api:context.CareDocumentViewer};
  }
  await test('Viewer navigates PDF pages, zooms, rotates and exposes safe text without PDF scripting',async()=>{
    const v=viewer();await v.api.mount();assert.equal(v.nodes.pdfStatus.textContent,'Page 1 of 2');assert.ok(v.nodes.previousPage.disabled);assert.equal(v.nodes.pdfText.textContent,'Safe page 1');assert.ok(v.nodes.retryPdf.hidden);assert.ok(v.nodes.viewerFeedback.classList['is-quiet']);assert.equal(v.calls.find(x=>x.data).enableXfa,false);assert.equal(v.calls.find(x=>x.data).isEvalSupported,false);assert.equal(v.calls.find(x=>x.data).disableFontFace,true);assert.equal(v.nodes.downloadPdf.href,'/api/documents/'+pdfId+'/file?download=1');
    await v.api.change('next');assert.equal(v.nodes.pdfStatus.textContent,'Page 2 of 2');assert.ok(v.nodes.nextPage.disabled);assert.equal(v.nodes.pdfText.textContent,'Safe page 2');await v.api.change('in');assert.equal(v.nodes.zoomLabel.textContent,'125%');await v.api.change('rotate');assert.ok(v.nodes.pdfCanvas.width>v.nodes.pdfCanvas.height);await v.api.change('fit');assert.equal(v.nodes.zoomLabel.textContent,'100%');await v.api.change('previous');assert.equal(v.nodes.pdfStatus.textContent,'Page 1 of 2');
    v.events.pagehide();
  });
  await test('Missing, denied, expired-session, invalid and password-protected PDFs show actionable errors',async()=>{
    for(const [options,text] of [[{status:404},'could not be found'],[{status:403},'do not have access'],[{status:401},'session has expired'],[{body:Buffer.from('<html>login</html>')},'not a readable PDF'],[{error:{name:'PasswordException'}},'password-protected'],[{error:{name:'InvalidPDFException'}},'damaged or unreadable']]){const v=viewer(options);await v.api.mount();assert.ok(v.nodes.pdfStatus.textContent.includes(text),v.nodes.pdfStatus.textContent);assert.equal(v.nodes.pdfStatus.role,'alert');assert.ok(v.nodes.pdfCanvas.hidden);assert.ok(!v.nodes.retryPdf.hidden);assert.ok(v.nodes.nextPage.disabled);}
  });
  await test('Worker and participant PDF panels embed the trusted viewer; images retain direct preview',async()=>{
    const context={document:{getElementById:()=>null,addEventListener(){}},location:{hash:'#/admin/verification'},URLSearchParams,Date,Map,Object,Number,String,Math,Promise};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/admin-verification.js'),'utf8'),context);
    for(const [id,kind,doc] of [[w.id,'worker',pdfId],[p.id,'participant',participantId]]){const d=await detail(id);d.documents.sort((a,b)=>(b.id===doc)-(a.id===doc));context.CareVerify.setPreview(d,{});const html=context.CareVerify.view.documents();assert.ok(html.includes('/api/document-viewer?scope='+kind+'&amp;id='+doc));assert.ok(html.includes('allow-scripts allow-same-origin allow-downloads'));assert.ok(html.includes('Download original'));assert.ok(!html.includes('src="/api/'+(kind==='worker'?'documents':'participant-documents')+'/'+doc+'/file"'));}
    const d=await detail(w.id);d.documents=d.documents.filter(x=>x.file_mime==='image/png');context.CareVerify.setPreview(d,{});assert.ok(context.CareVerify.view.documents().includes('<img data-v-evidence-image'));assert.ok(context.CareVerify.view.documents().includes('vf-image-error'));
  });
  await test('Accepted HTML copies keep the accepted version and permissions; plan viewer is admin-only',async()=>{
    for(const key of ['p-agreement','p-consent-privacy','p-consent-medication']){
      ok(await req('POST','/api/me/participant-documents/'+key+'/accept',p.cookie,{agree:true}));
      const saved=db.prepare('SELECT * FROM participant_docs WHERE participant_id=? AND form_key=? ORDER BY id DESC LIMIT 1').get(p.id,key);
      const response=await req('GET','/api/participant-documents/'+saved.id+'/file',a);ok(response);
      const check=viewer({mime:response.headers.get('content-type'),body:Buffer.from(response.text),search:'?scope=participant&id='+saved.id});await check.api.mount();check.nodes.htmlDocument.onload();assert.equal(check.nodes.pdfStatus.textContent,'Document ready');assert.ok(check.nodes.htmlDocument.srcdoc.endsWith(response.text));assert.ok(response.text.includes('<html'));
    }
    const doc=db.prepare("SELECT * FROM participant_docs WHERE participant_id=? AND file_mime LIKE 'text/html%' ORDER BY id DESC LIMIT 1").get(p.id);
    assert.ok(doc,'Acceptance must keep a readable HTML snapshot');
    const original=fs.readFileSync(doc.file_path,'utf8'),before=JSON.stringify(doc);
    for(const cookie of [a,p.cookie]){const r=await req('GET','/api/participant-documents/'+doc.id+'/file',cookie);ok(r);assert.equal(r.text,original);assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('content-type'),/^text\/html/);}
    ok(await req('GET','/api/participant-documents/'+doc.id+'/file',w.cookie),403);
    ok(await req('GET','/api/participant-documents/'+doc.id+'/file'),401);
    const downloaded=await req('GET','/api/participant-documents/'+doc.id+'/file?download=1',a);ok(downloaded);assert.match(downloaded.headers.get('content-disposition'),/^attachment;/);assert.equal(downloaded.text,original);
    const v=viewer({mime:doc.file_mime,body:Buffer.from(original),search:'?scope=participant&id='+doc.id,embedded:true});await v.api.mount();v.nodes.htmlDocument.onload();assert.ok(v.nodes.htmlDocument.srcdoc.endsWith(original));assert.equal(v.nodes.pdfStatus.textContent,'Document ready');assert.equal(v.calls[0].fetchUrl,'/api/participant-documents/'+doc.id+'/file');assert.equal(JSON.stringify(db.prepare('SELECT * FROM participant_docs WHERE id=?').get(doc.id)),before);
    for(const cookie of [p.cookie,w.cookie]){ok(await req('GET','/api/document-viewer?scope=plan&id='+p.id,cookie),403);ok(await req('GET','/api/admin/participants/'+p.id+'/plan',cookie),403);}
    const shell=await req('GET','/api/document-viewer?scope=plan&id='+p.id,a);ok(shell);assert.match(shell.headers.get('content-security-policy'),/frame-src 'none'/);
    const plan=await req('GET','/api/admin/participants/'+p.id+'/plan',a);ok(plan);const pv=viewer({mime:plan.headers.get('content-type'),body:Buffer.from(plan.text),search:'?scope=plan&id='+p.id});await pv.api.mount();assert.equal(pv.calls[0].fetchUrl,'/api/admin/participants/'+p.id+'/plan');assert.ok(pv.nodes.htmlDocument.srcdoc.endsWith(plan.text));
  });
  await test('HTML uses an opaque sandbox with a leading restrictive policy and no PDF controls',async()=>{
    const html='<html><head><style>p{color:red}</style></head><body><p>Recorded terms &amp; conditions</p><script>parent.exposed=true</script><iframe src="https://outside.example"></iframe></body></html>';
    const v=viewer({mime:'text/html; charset=utf-8',body:Buffer.from(html),embedded:true});await v.api.mount();v.nodes.htmlDocument.onload();
    assert.equal(v.nodes.htmlDocument.sandbox,'');assert.ok(v.nodes.htmlDocument.srcdoc.endsWith(html));assert.ok(v.nodes.htmlDocument.srcdoc.indexOf("script-src 'none'")<v.nodes.htmlDocument.srcdoc.indexOf('<script>'));
    for(const rule of ["default-src 'none'","frame-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'"])assert.ok(v.nodes.htmlDocument.srcdoc.includes(rule),rule);
    assert.ok(!v.nodes.htmlDocument.srcdoc.slice(0,v.nodes.htmlDocument.srcdoc.indexOf(html)).includes('allow-scripts'));
    assert.ok(v.nodes.pdfControls.hidden);assert.ok(v.nodes.viewerToolbar.hidden);assert.ok(v.nodes.downloadPdf.hidden);assert.ok(v.nodes.retryPdf.hidden);assert.ok(v.nodes.pdfSurface.hidden);assert.ok(!v.nodes.htmlDocument.hidden);assert.equal(v.calls.filter(x=>x.data).length,0);assert.equal(v.calls[0].options.credentials,'same-origin');assert.equal(v.calls[0].options.redirect,'error');
    const standalone=viewer({mime:'text/html',body:Buffer.from(html)});await standalone.api.mount();assert.ok(!standalone.nodes.downloadPdf.hidden);assert.ok(!standalone.nodes.viewerToolbar.hidden);
    const shell=fs.readFileSync(path.join(ROOT,'public/document-viewer.html'),'utf8');assert.match(shell,/<iframe[^>]+id="htmlDocument"[^>]+sandbox=""/);
  });
  await test('Compact PDF controls keep useful actions and show Retry only on failure',async()=>{
    const v=viewer({embedded:true,pages:1,textError:true});await v.api.mount();assert.ok(!v.nodes.pdfCanvas.hidden);assert.ok(v.nodes.previousPage.hidden&&v.nodes.nextPage.hidden);assert.equal(v.nodes.pageTotal.textContent,'/ 1');assert.ok(v.nodes.downloadPdf.hidden);assert.ok(v.nodes.retryPdf.hidden);assert.ok(v.nodes.pdfText.textContent.includes('Text is unavailable'));assert.ok(v.nodes.viewerFeedback.classList['is-quiet']);
    v.nodes.showText.click();assert.ok(!v.nodes.textPanel.hidden);assert.equal(v.nodes.showText['aria-expanded'],'true');v.nodes.closeText.click();assert.ok(v.nodes.textPanel.hidden);assert.equal(v.nodes.showText['aria-expanded'],'false');assert.ok(v.nodes.moreToggle.focused);
    for(let n=0;n<12;n++)await v.api.change('in');assert.equal(v.nodes.zoomLabel.textContent,'300%');assert.ok(v.nodes.zoomIn.disabled);await v.api.change('fit');assert.equal(v.nodes.zoomLabel.textContent,'100%');assert.ok(!v.nodes.zoomIn.disabled);
    const failed=viewer({delay:()=>Promise.reject(Error('Render failed'))});await failed.api.mount();assert.ok(!failed.nodes.retryPdf.hidden);assert.ok(failed.nodes.pdfCanvas.hidden);assert.equal(failed.nodes.pdfStatus.role,'alert');assert.ok(!failed.nodes.viewerFeedback.classList['is-quiet']);
  });
  await test('HTML documents and support plans open in the viewer without PDF instructions',async()=>{
    const context={document:{getElementById:()=>null,addEventListener(){}},location:{hash:'#/admin/verification'},URLSearchParams,Date,Map,Object,Number,String,Math,Promise};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/admin-verification.js'),'utf8'),context);
    const d=await detail(p.id);d.documents=d.documents.filter(x=>x.file_mime?.startsWith('text/html'));assert.ok(d.documents.length);context.CareVerify.setPreview(d,{});
    const html=context.CareVerify.view.documents();assert.ok(html.includes('/api/document-viewer?scope=participant&amp;id='+d.documents[0].id));assert.ok(!html.includes('read the PDF'));assert.ok(!html.includes('src="'+d.documents[0].source_url+'"'));assert.ok(html.includes('Open document full size'));
    const plan=context.CareVerify.view.plan();assert.ok(plan.includes('src="/api/document-viewer?scope=plan&amp;id='+p.id+'"'));assert.ok(plan.includes('allow-scripts allow-same-origin allow-downloads'));
  });

};
