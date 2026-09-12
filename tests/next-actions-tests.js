'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),script=fs.readFileSync(path.join(ROOT,'public/assets/next-actions.js'),'utf8');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx={esc,fmtAU:x=>x,Date};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(script,ctx);
const task=(key,kind,label,destination,extra={})=>({task_key:'20:'+key,kind,label,destination,owner_kind:'person',state:'ready',...extra});
const render=(tasks,extra={})=>ctx.CareNextActions.render({role:'worker',tasks,next:[],today:'2026-09-12',as_of:'2026-09-12T02:00:00Z',...extra});
const count=(s,text)=>s.split(text).length-1,results=[];
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.stack);}}
(async()=>{
await test('Related documents and modules become two actions without discarding their individual steps',()=>{
 const tasks=[task('setup:identity','setup','Complete identity','#/account/credentials'),task('setup:right-to-work','setup','Work rights','#/account/credentials'),task('setup:cpr','setup','CPR','#/account/credentials?type=cpr'),task('training:a','setup','Safety module','#/account/training'),task('training:b','setup','Privacy module','#/account/training')];const out=render(tasks);assert.match(out,/2 actions need your attention/);assert.equal((out.match(/<li class="na-task(?: na-first)?"/g)||[]).length,2);
 for(const t of tasks)assert.ok(out.includes(t.label));assert.equal(count(out,'Complete your document checklist'),1);assert.equal(count(out,'Complete your training'),1);assert.ok(!out.includes('flow-grid'));assert.ok(!out.includes('>Continue<'));assert.ok(!out.includes('type="checkbox"'));
});
await test('Missing, renewal and office-request tasks for the same document collapse to one item while retaining notes',()=>{
 const href='#/account/credentials?type=cpr';const out=render([task('setup:cpr','setup','Add current CPR',href),task('renew:1','renewal','Renew CPR',href,{due_at:'2026-09-10T23:59:59Z',detail:'Expires 10 September'}),task('request:2','document','CPR certificate',href,{detail:'Please include both pages'})]);assert.match(out,/1 action needs your attention/);assert.match(out,/Overdue/);assert.match(out,/Please include both pages/);assert.match(out,/Expires 10 September/);assert.equal(count(out,'<li><div><strong>'),1);
});
await test('Overdue and today items come first and no urgent group is hidden in More',()=>{
 const tasks=[task('future','renewal','Later renewal','#/form/later',{due_at:'2026-10-10T23:59:59Z'}),...Array.from({length:4},(_,i)=>task('due:'+i,'setup','Due task '+i,'#/form/due-'+i,{due_at:'2026-09-12T23:59:59Z'})),task('past','setup','Overdue item','#/form/past',{due_at:'2026-09-10T23:59:59Z'})];const out=render(tasks);assert.ok(out.indexOf('Overdue item')<out.indexOf('Due task 0'));const more=out.indexOf('<details class="na-more">');assert.ok(more>out.indexOf('Due task 3'));assert.ok(more<out.indexOf('Later renewal'));assert.match(out,/Show 1 more action/);
});
await test('Document day deadlines use the supplied site date, not midnight UTC or the browser clock',()=>{
 const out=render([task('renew:1','renewal','CPR','#/account/credentials?type=cpr',{due_at:'2026-09-12T23:59:59Z'})],{today:'2026-09-13',as_of:'2026-09-12T14:30:00Z'});assert.match(out,/Overdue/);
 const current=render([task('renew:1','renewal','CPR','#/account/credentials?type=cpr',{due_at:'2026-09-12T23:59:59Z'})]);assert.match(current,/Due today/);
});
await test('Office checks are collapsed, deduplicated and never lead a worker into admin or back to the list',()=>{
 const out=render([task('setup:verify-cpr','setup','Office review: CPR','#/journey',{owner_kind:'office',detail:'Awaiting verification'}),task('doc-review:1','document','Review received CPR','#/admin/compliance',{owner_kind:'office',detail:'Received yesterday'}),task('recruit:interview','recruitment','Interview review','#/journey?panel=recruitment',{owner_kind:'office'})]);assert.match(out,/Nothing you need to do right now/);assert.match(out,/<details class="na-waiting">/);assert.match(out,/2 reviews/);assert.match(out,/1 item being reviewed/);assert.match(out,/href="#\/account\/credentials"/);assert.ok(!out.includes('href="#/admin'));assert.ok(!out.includes('View progress'));assert.match(out,/Received yesterday/);
});
await test('Urgent office cover stays visible before the collapsed office section',()=>{
 const out=render([task('cover:3','cover','Cover for today’s visit','#/journey?panel=shift&booking=3',{owner_kind:'office',due_at:'2026-09-12T01:00:00Z'})]);assert.ok(out.indexOf('class="na-cover"')<out.indexOf('<details class="na-waiting"'));assert.match(out,/The office is handling this staffing issue/);assert.match(out,/View visit/);
});
await test('Only one upcoming visit is shown and a visit already needing action is not repeated',()=>{
 const out=render([task('accept:3','booking','Review the 3pm visit','#/journey?panel=shift&booking=3')],{next:[{id:3,date:'2026-09-12',start:'15:00',hours:2,status:'requested'},{id:4,date:'2026-09-13',start:'10:00',hours:2,status:'accepted',other_name:'Example person'},{id:5,date:'2026-09-14',start:'12:00',hours:2,status:'accepted'}]});assert.equal(count(out,'class="na-next-visit"'),1);assert.ok(!out.includes('booking=5'));assert.match(out,/Example person/);assert.match(out,/Confirmed/);
});
await test('Completed tasks disappear and the empty state does not claim that office reviews are finished',()=>{
 const out=render([task('old','setup','Old task','#/account',{state:'completed'})]);assert.match(out,/You are up to date/);assert.ok(!out.includes('Old task'));assert.ok(!out.includes('No upcoming visits'));assert.ok(!out.includes('With the office'));
});
await test('Email verification has a direct user action; coordinators are never offered resend for their own account',()=>{
 const t=task('setup:verify-email','setup','Confirm email','#/account');assert.match(render([t]),/data-flow-action="resend-email"/);const out=render([t],{role:'coordinator'});assert.ok(!out.includes('data-flow-action="resend-email"'));assert.match(out,/href="#\/clients"/);
});
await test('Distinct visit requests stay distinct; task and person text are escaped',()=>{
 const t=task('accept:1','booking','<img src=x onerror=alert(1)>','#/journey?panel=shift&booking=1',{detail:'<script>unsafe</script>'});const out=render([t,task('accept:2','booking','Second visit','#/journey?panel=shift&booking=2')]);assert.match(out,/2 actions need your attention/);assert.ok(!out.includes('<script>'));assert.ok(!out.includes('<img'));assert.match(out,/&lt;img/);assert.match(out,/booking=1/);assert.match(out,/booking=2/);
});

function flow(role='worker'){
 const nodes=new Map(),events={},calls=[],person={id:20,role,admin:role==='office'};if(role==='office')person.role='worker';
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',querySelector:()=>null});return nodes.get(id);};
 const context={esc,fmtAU:x=>x,URLSearchParams,Date,crypto:require('node:crypto'),setInterval(){},location:{hash:'#/journey'},document:{getElementById:node,addEventListener:(name,fn)=>{events[name]=fn;}},API:{me:person,call:async(url,options={})=>{calls.push({url,...options});if(url==='/journey')return {role,subject:{id:20,name:'Example'},today:'2026-09-12',as_of:'2026-09-12T02:00:00Z',tasks:[],next:[]};if(url.startsWith('/admin/journey-queue'))return {rows:[{task_key:'21:doc-review:1',person:'Example participant',person_role:'participant',user_id:21,label:'Review plan',kind:'document',ready_at:'2026-09-10T00:00:00Z',destination:'#/admin/compliance',owner_id:null}],total:1,offset:0,staff:[],today:'2026-09-12'};return {};}}};context.window=context;vm.createContext(context);vm.runInContext(script,context);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/assets/process-workflows.js'),'utf8'),context);
 return {ctx:context,node,calls,events};
}
await test('Office list fetches its paginated queue once and keeps assignment forms collapsed',async()=>{
 const v=flow('office');await v.ctx.CareFlow.render();assert.equal(v.calls.filter(c=>c.url==='/journey').length,0);assert.equal(v.calls.filter(c=>c.url.startsWith('/admin/journey-queue')).length,1);const out=v.node('flowContent').innerHTML;assert.match(out,/class="na-office-row"/);assert.match(out,/<details><summary>Details &amp; assignment|<details><summary>Details & assignment/);assert.match(out,/data-flow-form="task-owner"/);assert.match(out,/#\/admin\/verification\?role=participant&amp;person=21/);assert.match(v.node('flowTabs').innerHTML,/<details class="na-tools">/);
});
await test('Secondary workflow tools remain accessible inside one collapsed menu',async()=>{
 const v=flow();await v.ctx.CareFlow.render();const out=v.node('flowTabs').innerHTML;assert.match(out,/<details class="na-tools">/);assert.match(out,/More tools/);assert.match(out,/panel=recruitment/);assert.match(out,/panel=payroll/);assert.match(out,/panel=renewals/);assert.ok(!out.includes('panel=intake'));
});
await test('Resend requests use the existing endpoint and show requested rather than unconfirmed delivery',async()=>{
 const v=flow();await v.ctx.CareFlow.render();const b={dataset:{flowAction:'resend-email'},isConnected:true,closest:()=>null};await v.events.click({target:{closest:s=>s==='[data-flow-action]'?b:null},preventDefault(){}});assert.equal(v.calls.filter(c=>c.url==='/resend-verification').length,1);assert.match(v.node('naStatus').textContent,/email requested/);assert.ok(!v.node('naStatus').textContent.includes('sent'));
});
console.log('next actions: '+results.filter(r=>r.result==='PASS').length+'/'+results.length+' passed');if(process.env.NEXT_ACTIONS_RESULTS_PATH)fs.writeFileSync(process.env.NEXT_ACTIONS_RESULTS_PATH,JSON.stringify({runtime:process.version,results},null,2)+'\n');process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
