'use strict';
/* Executes the shipped navigation and router functions. DOM shims test routing,
   state and keyboard actions; they do not claim browser layout validation. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8');
const results=[],esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fn=name=>{const start=html.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n}',start)+2);};
async function test(name,run){try{await run();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.stack);}}
function node(id){const classes=new Set(),attrs={};return {id,hidden:false,innerHTML:'',dataset:{},textContent:'',children:[],attrs,listeners:{},classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},setAttribute(k,v){attrs[k]=v;},getAttribute:k=>attrs[k],removeAttribute(k){delete attrs[k];},focus(){this.focused=true;},addEventListener(k,f){this.listeners[k]=f;},querySelectorAll(){return this.children;},getClientRects(){return this.hidden?[]:[{}];}};}
function baseContext(){const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};const ctx={API:{online:true,me:null,unread:2},document:{title:'',body:{dataset:{},classList:node('body').classList},getElementById:get,querySelectorAll:()=>[]},location:{hash:'#/',pathname:'/',search:''},$:s=>get(s.replace(/^#/,'')),$$:()=>[],esc,Date,URLSearchParams,matchMedia:()=>({matches:false}),setTimeout(){},closeModals(){},closeMobileNav(){},stopSpeech(){},loadBlockers(){},openModal(id){ctx.opened=id;},scrollTo(){},history:{replaceState(){}},blockerCount:()=>0,acctInitials:()=> 'SW'};ctx.window=ctx;vm.createContext(ctx);return {ctx,get,nodes};}
const roles={guest:null,worker:{id:2,role:'worker',name:'Worker',email:'worker@example.test'},participant:{id:3,role:'participant',name:'Participant',email:'participant@example.test'},coordinator:{id:4,role:'coordinator',name:'Coordinator',email:'coordinator@example.test'},admin:{id:1,role:'worker',admin:true,name:'Admin',email:'admin@example.test'}};
(async()=>{
await test('Each role sees only its relevant primary navigation; desktop has at most four choices',()=>{
 const header=html.slice(html.indexOf('<header class="site">'),html.indexOf('<div class="nav-cta">'));
 const items=[...header.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].filter(m=>m[1].includes('data-nav-audience')).map(m=>Object.assign(node('li'),{dataset:{navAudience:/data-nav-audience="([^"]+)"/.exec(m[1])[1]},mobile:m[1].includes('nav-mobile-only'),label:m[2].replace(/<[^>]+>/g,' '),href:/href="([^"]+)"/.exec(m[2])?.[1]}));
 const expected={guest:['#/services','#/pricing','#/find-workers','#/how-it-works'],worker:['#/bookings','#/shifts','#/journey'],participant:['#/find-workers','#/bookings','#/support-plan','#/journey'],coordinator:['#/bookings','#/clients','#/journey'],admin:['#/admin','#/admin/verification','#/journey']};
 const {ctx,get}=baseContext();ctx.document.querySelectorAll=()=>items;vm.runInContext(fn('syncPrimaryNavigation'),ctx);
 for(const [role,person] of Object.entries(roles)){ctx.API.me=person;ctx.syncPrimaryNavigation();const shown=items.filter(x=>!x.hidden&&!x.mobile);assert.deepEqual(shown.map(x=>x.href),expected[role],role);assert.ok(shown.length<=4);assert.equal(get('btnMessages').hidden,role==='guest');assert.equal(ctx.document.body.dataset.navRole,role);}
 ctx.API.online=false;ctx.syncPrimaryNavigation();assert.equal(ctx.document.body.dataset.navRole,'guest');
});
await test('Worker account menu has seven useful actions, with no repeated bookings or marketing links',()=>{
 const {ctx,get}=baseContext();ctx.ACCT_ICONS=new Proxy({},{get:()=>'<svg></svg>'});vm.runInContext(fn('renderAcctMenu'),ctx);
 for(const [role,person]of Object.entries(roles)){if(!person)continue;ctx.API.me=person;ctx.renderAcctMenu();const out=get('acctMenu').innerHTML,count=(out.match(/role="menuitem"/g)||[]).length;assert.ok(count<=7,role);assert.match(out,/Help & contact/);assert.match(out,/Log out/);assert.match(out,/#\/account/);assert.ok(!out.includes('Open shifts')&&!out.includes('Refer a worker')&&!out.includes('data-hash="#/messages"'));if(role==='worker'){assert.equal(count,7);assert.match(out,/#\/account\/credentials/);assert.match(out,/#\/account\/earnings/);assert.match(out,/data-sec="cardIncident"/);}}
 ctx.API.me={...roles.worker,name:'<img src=x onerror=alert(1)>',email:'<script>'};ctx.renderAcctMenu();assert.ok(!get('acctMenu').innerHTML.includes('<img src=x'));
});
await test('Every registered page and dynamic route dispatches to an existing page',()=>{
 const {ctx,get,nodes}=baseContext();const pages=[...html.matchAll(/<section class="page" id="([^"]+)" data-title="([^"]*)"/g)].map(m=>{const n=get(m[1]);n.dataset.title=m[2];return n;});
 // Support plan uses an entity in its title, but retains the same page contract.
 const mapping=/const ROUTES = \{[\s\S]*?\n\};/.exec(html)[0];vm.runInContext(mapping+'\n'+fn('route')+'\nlet ROUTE_LAST=null;',ctx);const routes=vm.runInContext('ROUTES',ctx);
 const called=[];for(const name of new Set([...fn('route').matchAll(/\b((?:render|paint|apply)[A-Z]\w*)\(/g)].map(m=>m[1])))ctx[name]=(...args)=>called.push({name,args});ctx.showPath=()=>{};ctx.spExtras=()=>{};ctx.CareFlow={render:()=>called.push({name:'journey'})};
 ctx.$$=selector=>selector==='.page'?pages:[];
 for(const [route,id]of Object.entries(routes)){assert.ok(pages.some(x=>x.id===id),id);ctx.location.hash='#'+route;ctx.route();assert.equal(pages.filter(x=>x.classList.contains('active')).length,1);assert.ok(get(id).classList.contains('active'));assert.ok(ctx.document.title);}
 for(const [route,id,name]of [['/worker/12','page-worker','renderWorkerPage'],['/jobs/12','page-job','renderJobPage'],['/account/credentials?from=menu','page-account','renderAccountPage'],['/admin/verification','page-admin','renderAdminPage'],['/form/privacy?for=3','page-form-screen',null]]){ctx.location.hash='#'+route;ctx.route();assert.ok(get(id).classList.contains('active'));if(name)assert.equal(called.at(-1).name,name);}
 ctx.location.hash='#/this-page-does-not-exist';ctx.route();assert.ok(get('page-not-found').classList.contains('active'));ctx.location.hash='#/login';ctx.route();assert.equal(ctx.opened,'#loginModal');
});
await test('Credentials opens the dedicated uploader and previews both PDF and image evidence',async()=>{
 const {ctx,get}=baseContext(),wrap=get('miniCreds');wrap.closest=()=>true;ctx.fmtAU=x=>x;ctx.API.call=async()=>({documents:[{id:7,doc_type:'cpr',file_name:'CPR.pdf',has_file:true,review_label:'Awaiting review',review_note:'Please include the expiry date'},{id:8,doc_type:'screening',file_name:'Screening.JPG',has_file:true},{id:9,doc_type:'passport',has_file:false}],requests:[]});vm.runInContext(fn('renderCredsMini'),ctx);await ctx.renderCredsMini();assert.match(wrap.innerHTML,/href="#\/journey\?panel=uploads&from=credentials"/);assert.ok(!wrap.innerHTML.includes('href="#/bookings"'));assert.match(wrap.innerHTML,/scope=worker&id=7/);assert.match(wrap.innerHTML,/\/api\/documents\/8\/file/);assert.match(wrap.innerHTML,/Please include the expiry date/);assert.match(wrap.innerHTML,/Details only/);
 ctx.API.call=async()=>{throw Error('Offline');};await ctx.renderCredsMini();assert.match(wrap.innerHTML,/acctRetry/);
});
await test('Menu keyboard open, tab boundary, Escape and close return focus correctly',()=>{
 const {ctx,get}=baseContext(),main=get('mainNav'),first=get('navClose'),last=get('lastLink');main.children=[first,last];ctx.closeAcctMenu=()=>{};ctx.setA11yPanel=()=>{};ctx.addEventListener=()=>{};get('acctWrap').contains=()=>true;
 const block=html.slice(html.indexOf("const mainNav = $('#mainNav');"),html.indexOf('\n/* ============ Modals'));
 vm.runInContext(block,ctx);ctx.openMobileNav();assert.equal(first.focused,true);assert.equal(get('burger').attrs['aria-expanded'],'true');ctx.document.activeElement=last;let prevented=false;main.listeners.keydown({key:'Tab',preventDefault(){prevented=true;}});assert.ok(prevented&&first.focused);main.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(get('burger').attrs['aria-expanded'],'false');assert.equal(get('burger').focused,true);assert.equal(main.classList.contains('open'),false);
});
await test('Bookings API failures show an escaped explanation and retry instead of silently returning',async()=>{
 const {ctx}=baseContext();ctx.wrap={innerHTML:''};ctx.API.call=async()=>{throw Error('<offline>');};const block=/try \{ d = await API.call\('\/bookings'\); \} catch\(e\)\{[^\n]+\}/.exec(html);assert.ok(block);await vm.runInContext('(async()=>{let d;'+block[0]+'})()',ctx);assert.match(ctx.wrap.innerHTML,/data-retry-bookings/);assert.match(ctx.wrap.innerHTML,/&lt;offline&gt;/);
});
await test('All literal internal navigation destinations resolve and required local assets exist',()=>{
 const routes=Object.keys(vm.runInNewContext(/const ROUTES = \{[\s\S]*?\n\};/.exec(html)[0]+'\nROUTES'));
 for(const file of ['public/index.html',...fs.readdirSync(path.join(ROOT,'public/assets')).filter(n=>n.endsWith('.js')).map(n=>'public/assets/'+n)])for(const match of fs.readFileSync(path.join(ROOT,file),'utf8').matchAll(/(?:href=["']|destination:\s*["'])(#\/[^"'<>` ]+)/g)){const route=match[1].split('?')[0].slice(1);assert.ok(routes.includes(route)||/^\/(account|admin|worker|jobs|form)\//.test(route)||route.includes('${'),file+': '+route);}
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"$?]+)(?:\?[^"$]*)?"/g))assert.ok(fs.existsSync(path.join(ROOT,'public',match[1])),match[1]);
});

function uploadsUI(){
 const {ctx,get}=baseContext(),events={},saved=[],attempts=[];let failSecond=true;
 const tray=get('flowUploadTray'),upload=node('upload');upload.dataset={flowAction:'upload-all'};upload.isConnected=true;upload.closest=()=>null;upload.disabled=true;
 ctx.document.addEventListener=(type,fn)=>(events[type]||=[]).push(fn);ctx.document.querySelector=selector=>selector==='[data-flow-action=upload-all]'?upload:null;
 ctx.location.hash='#/journey?panel=uploads&from=credentials';ctx.API.me={...roles.worker};ctx.crypto=require('node:crypto');ctx.setInterval=()=>{};ctx.fmtAU=x=>x;ctx.toast=()=>{};
 ctx.fileToB64Shrunk=async input=>({name:input.files[0].name,data:'JVBERi0xLjQK',mime:'application/pdf'});
 tray.insertAdjacentHTML=(position,html)=>{const row=node('row'+tray.children.length),fields={doc_type:{value:'cpr'},expiry_date:{value:'2031-01-01'},label:{value:''},check_number:{value:''}},out=node('status');row.querySelector=selector=>selector==='[role=status]'?out:fields[/name=([^\]]+)/.exec(selector)[1]];row.querySelectorAll=()=>Object.values(fields);tray.children.push(row);};
 tray.querySelector=selector=>tray.children[Number(/index="(\d+)"/.exec(selector)[1])];
 ctx.API.call=async(url,options={})=>{
  if(url==='/journey')return {role:'worker',subject:{name:'Worker'}};
  if(url==='/doc-catalog')return {types:[{key:'cpr',label:'CPR'}]};
  if(url==='/journey/assistance')throw Error('Optional assistance is unavailable');
  if(url==='/me/documents'&&options.method==='POST'){attempts.push(options.body.file.name);if(failSecond&&options.body.file.name==='second.pdf')throw Error('Synthetic upload failure');saved.push({id:saved.length+1,file_name:options.body.file.name,has_file:true,type_label:'CPR',review_label:'Awaiting review'});return {};}
  if(url==='/me/documents')return {documents:saved};throw Error(url);
 };
 vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/process-workflows.js'),'utf8'),ctx);
 async function select(names){for(const f of events.change||[])await f({target:{id:'flowFiles',files:names.map(name=>({name})),value:'',closest:()=>null}});}
 async function click(){for(const f of events.click||[])await f({target:{closest:selector=>selector==='[data-flow-action]'?upload:null},preventDefault(){}});}
 return {ctx,get,tray,saved,attempts,upload,select,click,retry(){failSecond=false;}};
}
await test('Uploader opens when optional assistance is unavailable and returns directly to Credentials',async()=>{
 const v=uploadsUI();await v.ctx.CareFlow.render();assert.match(v.get('flowContent').innerHTML,/id="flowFiles"/);assert.match(v.get('flowContent').innerHTML,/href="#\/account\/credentials"/);assert.ok(!v.get('flowContent').innerHTML.includes('Could not load'));assert.equal(v.get('flowTitle').textContent,'Documents');assert.equal(v.upload.disabled,true);
});
await test('Mixed upload results preserve successful files; retry only sends the failed file and refreshes the list',async()=>{
 const v=uploadsUI();await v.ctx.CareFlow.render();await v.select(['first.pdf','second.pdf']);assert.equal(v.upload.disabled,false);await v.click();assert.deepEqual(v.attempts,['first.pdf','second.pdf']);assert.match(v.get('flowUploadStatus').textContent,/1 of 2 files saved/);assert.match(v.get('flowOnFile').innerHTML,/first.pdf/);v.retry();await v.click();assert.deepEqual(v.attempts,['first.pdf','second.pdf','second.pdf']);assert.match(v.get('flowUploadStatus').textContent,/2 of 2 files saved/);assert.match(v.get('flowOnFile').innerHTML,/second.pdf/);assert.equal(v.saved.length,2);
});
await test('Leaving uploads or changing the signed-in person stops prepared files being sent',async()=>{
 for(const change of ['route','person']){const v=uploadsUI();await v.ctx.CareFlow.render();await v.select(['first.pdf']);let finish;v.ctx.fileToB64Shrunk=()=>new Promise(r=>finish=r);const pending=v.click();await new Promise(r=>setImmediate(r));if(change==='route')v.ctx.location.hash='#/account';else v.ctx.API.me={...roles.participant};finish({name:'first.pdf'});await pending;assert.equal(v.attempts.length,0,change);}
});
console.log('navigation: '+results.filter(x=>x.result==='PASS').length+'/'+results.length+' passed');if(process.env.NAVIGATION_RESULTS_PATH)fs.writeFileSync(process.env.NAVIGATION_RESULTS_PATH,JSON.stringify({runtime:process.version,results},null,2)+'\n');process.exitCode=results.some(x=>x.result==='FAIL')?1:0;
})();
