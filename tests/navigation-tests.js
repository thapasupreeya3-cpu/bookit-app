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
await test('Worker account menu has eight useful actions, with no repeated bookings or marketing links',()=>{
 const {ctx,get}=baseContext();ctx.ACCT_ICONS=new Proxy({},{get:()=>'<svg></svg>'});vm.runInContext(fn('renderAcctMenu'),ctx);
 for(const [role,person]of Object.entries(roles)){if(!person)continue;ctx.API.me=person;ctx.renderAcctMenu();const out=get('acctMenu').innerHTML,count=(out.match(/role="menuitem"/g)||[]).length;assert.ok(count<=8,role);assert.match(out,/Help & contact/);assert.match(out,/Log out/);assert.match(out,/#\/account/);assert.ok(!out.includes('Open shifts')&&!out.includes('Refer a worker')&&!out.includes('data-hash="#/messages"'));if(role==='worker'){assert.equal(count,8);assert.match(out,/#\/account\/credentials/);assert.match(out,/#\/account\/earnings/);assert.match(out,/Refer a friend/);assert.match(out,/#\/refer-a-worker/);assert.match(out,/data-sec="cardIncident"/);}}
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
await test('Menu keyboard open, tab boundary, Escape and close return focus correctly',()=>{
 const {ctx,get}=baseContext(),main=get('mainNav'),first=get('navClose'),last=get('lastLink');main.children=[first,last];ctx.closeAcctMenu=()=>{};ctx.setA11yPanel=()=>{};ctx.addEventListener=()=>{};get('acctWrap').contains=()=>true;
 const block=html.slice(html.indexOf("const mainNav = $('#mainNav');"),html.indexOf('\n/* ============ Modals'));
 vm.runInContext(block,ctx);ctx.openMobileNav();assert.equal(first.focused,true);assert.equal(get('burger').attrs['aria-expanded'],'true');ctx.document.activeElement=last;let prevented=false;main.listeners.keydown({key:'Tab',preventDefault(){prevented=true;}});assert.ok(prevented&&first.focused);main.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(get('burger').attrs['aria-expanded'],'false');assert.equal(get('burger').focused,true);assert.equal(main.classList.contains('open'),false);
});
await test('Bookings API failures show an escaped explanation and retry instead of silently returning',async()=>{
 const {ctx}=baseContext();ctx.wrap={innerHTML:''};ctx.current=()=>true;ctx.bookingPath='/bookings';ctx.API.call=async()=>{throw Error('<offline>');};const block=/try \{ d = await API.call\(bookingPath\); \} catch\(e\)\{[^\n]+\}/.exec(html);assert.ok(block);await vm.runInContext('(async()=>{let d;'+block[0]+'})()',ctx);assert.match(ctx.wrap.innerHTML,/data-retry-bookings/);assert.match(ctx.wrap.innerHTML,/&lt;offline&gt;/);
});
await test('All literal internal navigation destinations resolve and required local assets exist',()=>{
 const routes=Object.keys(vm.runInNewContext(/const ROUTES = \{[\s\S]*?\n\};/.exec(html)[0]+'\nROUTES'));
 for(const file of ['public/index.html',...fs.readdirSync(path.join(ROOT,'public/assets')).filter(n=>n.endsWith('.js')).map(n=>'public/assets/'+n)])for(const match of fs.readFileSync(path.join(ROOT,file),'utf8').matchAll(/(?:href=["']|destination:\s*["'])(#\/[^"'<>` ]+)/g)){const route=match[1].split('?')[0].slice(1);assert.ok(routes.includes(route)||/^\/(account|admin|worker|jobs|form)\//.test(route)||route.includes('${'),file+': '+route);}
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"$?]+)(?:\?[^"$]*)?"/g))assert.ok(fs.existsSync(path.join(ROOT,'public',match[1])),match[1]);
});

await test('Legacy document, profile, funding and notification links go to canonical Settings',async()=>{
 for(const [panel,expected] of [['uploads&type=cpr','#/account/credentials?type=cpr'],['intake','#/account/profile'],['billing','#/account/billing'],['preferences','#/account/notifications']]){
  const {ctx,get}=baseContext();ctx.location.hash='#/journey?panel='+panel;ctx.API.me=roles.worker;ctx.API.call=async()=>({role:'worker',subject:{name:'Worker'}});ctx.document.addEventListener=()=>{};ctx.setInterval=()=>{};ctx.fmtAU=x=>x;
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/next-actions.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/process-workflows.js'),'utf8'),ctx);await ctx.CareFlow.render();assert.equal(ctx.location.hash,expected);assert.ok(!get('flowContent').innerHTML.includes('<form'));
 }
});
await test('Next actions has no duplicated details, documents, funding or notification editors',async()=>{
 for(const role of ['worker','participant']){const {ctx,get}=baseContext();ctx.location.hash='#/journey';ctx.API.me=roles[role];ctx.API.call=async()=>({role,subject:{name:'Person'},tasks:[],next:[]});ctx.document.addEventListener=()=>{};ctx.setInterval=()=>{};ctx.fmtAU=x=>x;
 vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/next-actions.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/process-workflows.js'),'utf8'),ctx);await ctx.CareFlow.render();for(const panel of ['intake','uploads','billing','preferences'])assert.ok(!get('flowTabs').innerHTML.includes('panel='+panel));assert.match(get('flowContent').innerHTML,/You are up to date/);}
});
await test('Late Next actions fetch cannot redirect after leaving the page',async()=>{
 const {ctx}=baseContext();ctx.location.hash='#/journey?panel=uploads';ctx.API.me=roles.worker;let finish;ctx.API.call=()=>new Promise(r=>finish=r);ctx.document.addEventListener=()=>{};ctx.setInterval=()=>{};ctx.fmtAU=x=>x;vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/next-actions.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/process-workflows.js'),'utf8'),ctx);const pending=ctx.CareFlow.render();ctx.location.hash='#/bookings';finish({role:'worker',subject:{name:'Worker'}});await pending;assert.equal(ctx.location.hash,'#/bookings');
});
await test('Missing-navigation-module fallback opens pages at top; stale section callbacks cannot scroll another page',()=>{
 const {ctx,get}=baseContext();ctx.history.scrollRestoration='auto';const scrolls=[];ctx.scrollTo=opts=>scrolls.push(opts);ctx.matchMedia=()=>({matches:true});
 for(const name of new Set([...fn('route').matchAll(/\b((?:render|paint|apply)[A-Z]\w*)\(/g)].map(m=>m[1])))ctx[name]=()=>{};
 ctx.showPath=()=>{};ctx.CareFlow={render(){}};vm.runInContext(/const ROUTES = \{[\s\S]*?\n\};/.exec(html)[0]+'\n'+fn('route')+'\nlet ROUTE_LAST=null;',ctx);
 for(const hash of ['#/account/profile','#/account/credentials','#/account/notifications','#/admin/verification','#/admin/compliance']){ctx.location.hash=hash;ctx.route();assert.equal(scrolls.at(-1).top,0);assert.equal(scrolls.at(-1).behavior,'instant');}assert.equal(ctx.history.scrollRestoration,'manual');
 const callbacks=[];ctx.setTimeout=f=>callbacks.push(f);const target=get('cardIncident');let moved=0;target.querySelector=()=>null;target.closest=()=>true;target.scrollIntoView=()=>moved++;
 vm.runInContext('let PENDING_SECTION=null;let PENDING_AT=0;'+fn('revealPendingSection'),ctx);ctx.location.hash='#/bookings';vm.runInContext('PENDING_SECTION="cardIncident";PENDING_AT=Date.now();revealPendingSection();',ctx);ctx.location.hash='#/account';callbacks[0]();assert.equal(moved,0);
});
console.log('navigation: '+results.filter(x=>x.result==='PASS').length+'/'+results.length+' passed');if(process.env.NAVIGATION_RESULTS_PATH)fs.writeFileSync(process.env.NAVIGATION_RESULTS_PATH,JSON.stringify({runtime:process.version,results},null,2)+'\n');process.exitCode=results.some(x=>x.result==='FAIL')?1:0;
})();
