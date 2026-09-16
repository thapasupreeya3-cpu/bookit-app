'use strict';
// Execute the shipped route and navigation coordinator with measured-layout DOM doubles.
// These checks cover event order and viewport decisions, not visual browser rendering.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8'),source=fs.readFileSync(path.join(ROOT,'public/assets/navigation-position.js'),'utf8');
const start=html.indexOf('\nfunction route(){'),route=html.slice(start,html.indexOf('\n}',start)+2),mapping=/const ROUTES = \{[\s\S]*?\n\};/.exec(html)[0];
function harness(){
 const nodes=new Map(),selectors=new Map(),listeners={},frames=[],moves=[],focuses=[];
 const ctx={URLSearchParams,Promise,Map,Set,WeakMap,Date,API:{online:true,me:{id:1,role:'worker',admin:true}},location:{hash:'#/admin/verification?role=worker&person=18',pathname:'/',search:''},history:{state:null,scrollRestoration:'auto',replaceState(state){this.state=state;}},scrollX:0,scrollY:0,innerHeight:800,document:{title:'',activeElement:null},loadBlockers(){},closeMobileNav(){},closeModals(){},stopSpeech(){},setTimeout(fn){frames.push(fn);},requestAnimationFrame(fn){frames.push(fn);},addEventListener(name,fn){(listeners[name]||=[]).push(fn);}};
 ctx.window=ctx;ctx.scrollTo=p=>{ctx.scrollX=p.left;ctx.scrollY=p.top;moves.push({...p});};
 function node(id,top=0,height=4000){if(nodes.has(id))return nodes.get(id);const classes=new Set(),attrs={};const n={id,top,height,style:{minHeight:''},dataset:{title:id},scrollTop:0,innerHTML:'',classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},getBoundingClientRect(){return {top:this.top-ctx.scrollY,bottom:this.top-ctx.scrollY+this.height,height:Math.max(this.height,parseFloat(this.style.minHeight)||0)};},get offsetHeight(){return this.getBoundingClientRect().height;},hasAttribute:k=>Object.hasOwn(attrs,k),setAttribute(k,v){attrs[k]=v;},getAttribute:k=>attrs[k],removeAttribute(k){delete attrs[k];},matches:()=>false,focus(options){focuses.push({id,options});},querySelector:selector=>selectors.get(selector)||null};nodes.set(id,n);return n;}
 for(const m of html.matchAll(/<section class="page" id="([^"]+)"/g))node(m[1]);
 node('main');const header=node('site',0,60);header.getBoundingClientRect=()=>({top:0,bottom:60,height:60});selectors.set('header.site',header);
 ctx.document.getElementById=node;ctx.document.querySelector=selector=>{if(selector==='.page.active')return [...nodes.values()].find(n=>n.classList.contains('active'))||null;return selector.split(',').map(s=>selectors.get(s.trim())).find(Boolean)||null;};ctx.$=s=>node(s.replace(/^#/,''));ctx.$$=s=>s==='.page'?[...nodes.values()].filter(n=>n.id.startsWith('page-')):[];
 ctx.CareFlow={render(){}};ctx.CarePayments={renderOffice(){}};ctx.renderAdminPage=()=>{};
 vm.createContext(ctx);vm.runInContext(source+'\n'+mapping+'\nlet ROUTE_LAST=null;'+route,ctx);
 const event=(name,data={})=>(listeners[name]||[]).forEach(fn=>fn(data));
 async function flush(){for(let i=0;i<5;i++){await Promise.resolve();while(frames.length)frames.shift()();}}
 async function open(hash){ctx.location.hash=hash;ctx.route();await flush();}
 function scroll(y){ctx.scrollY=y;event('scroll');}
 function target(selector,top,height=100){const n=node(selector,top,height);selectors.set(selector,n);return n;}
 return {ctx,node,target,event,flush,open,scroll,moves,focuses,selectors};
}
const results=[];async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(err){results.push({name,result:'FAIL',error:err.stack});console.error('FAIL '+name+' '+err.stack);}}
(async()=>{
 await test('Actual router waits for the selected file and preserves page height during its request',async()=>{
  const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);h.scroll(750);let finish;h.ctx.renderAdminPage=()=>new Promise(r=>finish=r);
  h.ctx.location.hash='#/admin/verification?role=worker&person=19';h.ctx.route();assert.equal(h.ctx.scrollY,750);assert.equal(h.node('page-admin').style.minHeight,'4000px');
  await h.flush();assert.equal(h.ctx.scrollY,750);finish();await h.flush();assert.equal(h.ctx.scrollY,750);assert.equal(h.node('page-admin').style.minHeight,'');assert.equal(h.focuses.at(-1).id,'#vfDetail');assert.equal(h.focuses.at(-1).options.preventScroll,true);
 });
 await test('Selecting a different person from a deep file reveals their header rather than page top',async()=>{
  const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);h.scroll(2600);await h.open('#/admin/verification?role=worker&person=19');assert.equal(h.ctx.scrollY,928);assert.notEqual(h.ctx.scrollY,0);
 });
 await test('A stacked mobile file below the people list is brought into the viewport',async()=>{
  const h=harness();h.target('#vfDetail',2200);await h.open(h.ctx.location.hash);h.scroll(650);await h.open('#/admin/verification?role=worker&person=19');assert.equal(h.ctx.scrollY,2128);
 });
 await test('Verification filters and page changes reveal the result queue',async()=>{
  const h=harness();h.target('#vfDetail',1000);h.target('#vfQueue',1050);await h.open(h.ctx.location.hash);h.scroll(2600);await h.open('#/admin/verification?role=worker&offset=30');assert.equal(h.ctx.scrollY,978);assert.equal(h.focuses.at(-1).id,'#vfQueue');
 });
 await test('Next actions person changes reveal the selected panel and category pages stay at their tabs',async()=>{
  const h=harness();h.target('#na-person-panel',1200);h.target('.na-category-tabs',1450);await h.open('#/journey?panel=tasks&person=worker%3A19');h.scroll(400);await h.open('#/journey?panel=tasks&person=participant%3A18');assert.equal(h.ctx.scrollY,1128);
  h.scroll(2000);await h.open('#/journey?panel=tasks&person=participant%3A18&category=training&task_page=2');assert.equal(h.ctx.scrollY,1378);
 });
 await test('Worker Next actions opens the visit and shift-note workspace below the fixed header',async()=>{
  const h=harness();h.ctx.API.me.admin=false;h.target('#flowShiftWork',460);await h.open('#/journey');h.scroll(1700);await h.open('#/journey?panel=shift&booking=42');assert.equal(h.ctx.scrollY,388);assert.equal(h.focuses.at(-1).id,'#flowShiftWork');assert.equal(h.focuses.at(-1).options.preventScroll,true);
 });
 await test('Opening a different shift from deep reference details reveals its work on small screens',async()=>{
  const h=harness();h.ctx.API.me.admin=false;h.ctx.innerHeight=640;h.target('#flowShiftWork',370);await h.open('#/journey?panel=shift&booking=42');h.scroll(3000);await h.open('#/journey?panel=shift&booking=43');assert.equal(h.ctx.scrollY,298);assert.equal(h.focuses.at(-1).id,'#flowShiftWork');
 });
 await test('Shift navigation waits for note drafts and respects input while they load',async()=>{
  const h=harness();h.ctx.API.me.admin=false;h.target('#flowShiftWork',460);await h.open('#/journey');let finish;h.ctx.CareFlow.render=()=>new Promise(r=>finish=r);h.ctx.location.hash='#/journey?panel=shift&booking=42';h.ctx.route();await h.flush();assert.equal(h.ctx.scrollY,0);finish();await h.flush();assert.equal(h.ctx.scrollY,388);
  h.ctx.location.hash='#/journey?panel=shift&booking=43';h.ctx.route();const focusCount=h.focuses.length;h.event('touchstart');h.scroll(900);finish();await h.flush();assert.equal(h.ctx.scrollY,900);assert.equal(h.focuses.length,focusCount);
 });
 await test('Completing a long shift note brings the saved visit back into view without a hash change',async()=>{
  const h=harness();h.ctx.API.me.admin=false;h.target('#flowShiftWork',460);await h.open('#/journey?panel=shift&booking=42');h.scroll(1700);const done=h.ctx.CareNavigation.update(()=>{h.node('page-journey').height=2400;},{target:'#flowShiftWork',focus:'#flowShiftWork'});await h.flush();await done;assert.equal(h.ctx.scrollY,388);assert.equal(h.focuses.at(-1).id,'#flowShiftWork');assert.equal(h.ctx.location.hash,'#/journey?panel=shift&booking=42');
 });
 await test('Cross-route Money sections open at the local tab bar',async()=>{
  const h=harness();h.target('.page.active .ca-money-sections',450);await h.open('#/payment-tracking?tab=invoices');h.scroll(1800);await h.open('#/admin/money?section=history');assert.equal(h.ctx.scrollY,378);assert.equal(h.focuses.at(-1).id,'.page.active .ca-money-sections');
 });
 await test('New office workspaces open their content; public pages still start at the top',async()=>{
  const h=harness();h.target('.page.active .ca-content',450);await h.open('#/admin/people');assert.equal(h.ctx.scrollY,378);h.scroll(1600);await h.open('#/pricing');assert.equal(h.ctx.scrollY,0);assert.equal(h.focuses.at(-1).id,'main');
 });
 await test('Back and Forward restore each history entry’s viewport after asynchronous rendering',async()=>{
  const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);const first={...h.ctx.history.state};h.scroll(1450);
  await h.open('#/admin/verification?role=worker&person=19');const second={...h.ctx.history.state};h.scroll(1750);
  h.ctx.history.state=first;h.event('popstate');await h.open('#/admin/verification?role=worker&person=18');assert.equal(h.ctx.scrollY,1450);
  h.ctx.history.state=second;h.event('popstate');await h.open('#/admin/verification?role=worker&person=19');assert.equal(h.ctx.scrollY,1750);
 });
 await test('Wheel or touch input while loading cancels the pending automatic scroll and focus',async()=>{
  for(const event of ['wheel','touchstart']){const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);let finish;h.ctx.renderAdminPage=()=>new Promise(r=>finish=r);h.ctx.location.hash='#/admin/verification?role=worker&person=19';h.ctx.route();const count=h.focuses.length;h.event(event);h.scroll(1600);finish();await h.flush();assert.equal(h.ctx.scrollY,1600,event);assert.equal(h.focuses.length,count);assert.equal(h.node('page-admin').style.minHeight,'');}
 });
 await test('Keyboard or pointer interaction while loading is not overridden by delayed focus',async()=>{
  for(const [name,event] of [['keydown',{key:'Tab'}],['pointerdown',{}]]){const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);let finish;h.ctx.renderAdminPage=()=>new Promise(r=>finish=r);h.ctx.location.hash='#/admin/verification?person=19';h.ctx.route();h.event(name,event);const count=h.focuses.length;finish();await h.flush();assert.equal(h.focuses.length,count);}
 });
 await test('A stale page response or queued animation frame cannot move the newer page',async()=>{
  const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);let finish;h.ctx.renderAdminPage=()=>new Promise(r=>finish=r);h.ctx.location.hash='#/admin/verification?person=19';h.ctx.route();await h.open('#/pricing');h.scroll(325);finish();await h.flush();assert.equal(h.ctx.scrollY,325);assert.equal(h.node('page-admin').style.minHeight,'');
  h.ctx.renderAdminPage=()=>{};h.ctx.location.hash='#/admin/verification?person=20';h.ctx.route();await Promise.resolve();h.ctx.location.hash='#/pricing';h.ctx.route();await h.flush();assert.equal(h.ctx.scrollY,0);assert.equal(h.focuses.at(-1).id,'main');
 });
 await test('Sign-out during loading cancels movement and releases height even before another route runs',async()=>{
  const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);let finish;h.ctx.renderAdminPage=()=>new Promise(r=>finish=r);h.ctx.location.hash='#/admin/verification?person=19';h.ctx.route();h.ctx.API.me=null;h.scroll(600);finish();await h.flush();assert.equal(h.ctx.scrollY,600);assert.equal(h.node('page-admin').style.minHeight,'');
 });
 await test('Request failure releases loading height and still shows the selected error region',async()=>{
  const h=harness();h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);h.scroll(2200);h.ctx.renderAdminPage=()=>Promise.reject(Error('Synthetic failure'));await h.open('#/admin/verification?person=19');assert.equal(h.ctx.scrollY,928);assert.equal(h.node('page-admin').style.minHeight,'');
 });
 await test('Local file tabs restore focus without scroll and nested replacements release all height holds',async()=>{
  const h=harness();h.target('#vfDetail',1000);h.target('.vf-section-tabs',1450);h.target('[data-v-section="documents"]',1450);await h.open(h.ctx.location.hash);h.scroll(1300);
  let renders=0;const first=h.ctx.CareNavigation.update(()=>renders++,{target:'.vf-section-tabs',focus:'[data-v-section="documents"]'});const second=h.ctx.CareNavigation.update(()=>renders++,{target:'.vf-section-tabs',focus:'[data-v-section="documents"]'});await h.flush();await Promise.all([first,second]);assert.equal(renders,2);assert.equal(h.ctx.scrollY,1300);assert.equal(h.node('page-admin').style.minHeight,'');assert.equal(h.focuses.at(-1).options.preventScroll,true);
 });
 await test('A late local tab callback cannot reposition another page',async()=>{
  const h=harness();h.target('#vfDetail',1000);h.target('.vf-section-tabs',1450);await h.open(h.ctx.location.hash);h.ctx.CareNavigation.update(()=>{},{target:'.vf-section-tabs'});await h.open('#/pricing');assert.equal(h.ctx.scrollY,0);assert.equal(h.node('page-admin').style.minHeight,'');
 });
 await test('The admin menu keeps its own scroll position across a local person selection',async()=>{
  const h=harness();const sidebar=h.target('.page.active .ca-sidebar',80,700);h.target('#vfDetail',1000);await h.open(h.ctx.location.hash);sidebar.scrollTop=310;h.ctx.renderAdminPage=()=>{sidebar.scrollTop=0;};await h.open('#/admin/verification?role=worker&person=19');assert.equal(sidebar.scrollTop,310);
 });
 await test('Actual login navigation keeps focus inside the dialog opened after route dispatch',async()=>{
  const h=harness();h.ctx.API.me=null;h.ctx.openModal=id=>{h.target('.modal-overlay.open',0,400);h.node(id).focus({preventScroll:true});};h.scroll(350);await h.open('#/login');assert.equal(h.focuses.at(-1).id,'#loginModal');assert.equal(h.ctx.scrollY,350);assert.equal(h.node('page-login').style.minHeight,'');
 });
 console.log('navigation position: '+results.filter(r=>r.result==='PASS').length+'/'+results.length+' passed');if(process.env.NAVIGATION_POSITION_RESULTS_PATH)fs.writeFileSync(process.env.NAVIGATION_POSITION_RESULTS_PATH,JSON.stringify({runtime:process.version,results},null,2)+'\n');process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
