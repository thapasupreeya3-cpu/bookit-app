'use strict';
// Exercise the mounted HTTP routes with isolated SQLite records. No external service calls.
process.env.TZ='Australia/Sydney';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:'),routes=[],results=[];
const today='2026-09-14',asOf='2026-09-14T02:00:00Z';
db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,is_admin INTEGER DEFAULT 0,closed_at TEXT);
 CREATE TABLE payroll_lines(id INTEGER PRIMARY KEY);
 CREATE TABLE invoice_payment_evidence(id INTEGER PRIMARY KEY);
 CREATE TABLE journey_tasks(task_key TEXT PRIMARY KEY,user_id INTEGER,kind TEXT,label TEXT,detail TEXT,destination TEXT,owner_kind TEXT,state TEXT,ready_at TEXT,due_at TEXT,owner_id INTEGER,due_override INTEGER DEFAULT 0,updated_at TEXT);`);
let syncs=0;
const c={db,publicAPI:[],route:(method,rx,fn)=>routes.push({method,rx,fn}),ymd:()=>today,json:(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}};
require('../lib/process-routes')(c,{parse:JSON.parse,hash:v=>JSON.stringify(v),now:()=>asOf,syncAll:()=>syncs++,event(){}});
const accounts={admin:{id:90,role:'worker',admin:true},worker:{id:19,role:'worker',admin:false},participant:{id:18,role:'participant',admin:false},helper:{id:20,role:'coordinator',admin:false}};
const server=http.createServer(async(req,res)=>{
 try{
  let body='';for await(const part of req)body+=part;
  const path=new URL(req.url,'http://localhost').pathname,match=routes.map(r=>({...r,m:path.match(r.rx)})).find(r=>r.method===req.method&&r.m);
  if(!match){res.writeHead(404);return res.end();}
  await match.fn(req,res,match.m,accounts[req.headers['x-test-actor']],body?JSON.parse(body):{});
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.stack}));}
});
let base='';
async function request(params='',actor='admin',method='GET',body){
 const route=method==='PATCH'?'/api/admin/journey-tasks':'/api/admin/journey-queue'+params;
 const response=await fetch(base+route,{method,headers:{...(actor?{'x-test-actor':actor}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json()};
}
function person(id,role='worker',name='Person '+id,admin=false){db.prepare('INSERT INTO users(id,name,role,is_admin) VALUES(?,?,?,?)').run(id,name,role,Number(admin));}
function task(key,uid,extra={}){
 const t={kind:'document',label:'Document '+key,detail:'Complete this requirement',destination:'#/account/credentials',owner_kind:'person',state:'ready',ready_at:'2026-09-01T00:00:00Z',due_at:null,...extra};
 db.prepare('INSERT INTO journey_tasks(task_key,user_id,kind,label,detail,destination,owner_kind,state,ready_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,uid,t.kind,t.label,t.detail,t.destination,t.owner_kind,t.state,t.ready_at,t.due_at);
}
function reset(){db.exec('DELETE FROM journey_tasks; DELETE FROM users;');person(90,'worker','Office account private name',true);syncs=0;}
async function test(name,fn){reset();try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.stack);}}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 try{
 await test('Queue and assignment routes reject unauthorised roles before reading or syncing tasks',async()=>{
  person(19);task('19:private',19,{owner_kind:'office'});
  for(const actor of ['', 'worker','participant','helper']){
   const get=await request('?group=person&view=office',actor);assert.equal(get.status,actor?403:401);assert.equal(syncs,0);assert.ok(!JSON.stringify(get.data).includes('19:private'));
   const patch=await request('',actor,'PATCH',{task_key:'19:private',owner_id:90});assert.equal(patch.status,actor?403:401);
  }
  assert.equal(db.prepare('SELECT owner_id FROM journey_tasks').get().owner_id,null);
  assert.equal((await request('?group=person&view=office')).status,200);assert.equal(syncs,1);
 });
 await test('One selected person includes their entire checklist beyond the old 100-task limit',async()=>{
  person(19);for(let i=0;i<135;i++)task('19:'+String(i).padStart(3,'0'),19);
  const {status,data:d}=await request('?group=person&view=people');assert.equal(status,200);assert.equal(d.pagination,'people');assert.equal(d.page_size,12);assert.equal(d.person_total,1);assert.equal(d.task_total,135);assert.equal(d.rows.length,135);assert.equal(d.people[0].total,135);assert.equal(d.people[0].matched,135);assert.equal(d.selected_person,'worker:19');assert.equal(d.selection_changed,false);assert.equal(d.today,today);assert.equal(d.as_of,asOf);
 });
 await test('Identical display names remain separate worker and participant groups',async()=>{
  person(19,'worker','Same Person');person(18,'participant','Same Person');task('19:training',19);task('18:invoice',18,{kind:'invoice'});
  const {data:d}=await request('?group=person&view=people');assert.equal(d.person_total,2);assert.deepEqual(new Set(d.people.map(p=>p.key)),new Set(['worker:19','participant:18']));assert.equal(d.rows.length,1);
  const {data:p}=await request('?group=person&view=people&person=participant%3A18');assert.equal(p.selected_person,'participant:18');assert.equal(p.rows[0].user_id,18);
 });
 await test('Website checks and office operations use named system groups instead of the admin account',async()=>{
  task('office:office:ops:certificate',90,{owner_kind:'office',kind:'operations',label:'Check website certificate'});task('office:payroll:4',90,{owner_kind:'office',kind:'payroll'});
  const {data:web}=await request('?group=person&view=website');assert.equal(web.people[0].key,'system:website');assert.equal(web.people[0].name,'The Care Web website');assert.equal(web.people[0].role,'system');assert.equal(web.people[0].user_id,null);
  const {data:office}=await request('?group=person&view=office');assert.equal(office.people[0].key,'system:office');assert.equal(office.people[0].name,'Office operations');assert.deepEqual(office.counts,{office:1,people:0,website:1});
  assert.equal((await request('?group=person&view=website&q=Office%20account%20private%20name')).data.person_total,0);
 });
 await test('A task search returns all tasks for matching people and reports how many tasks matched',async()=>{
  person(19,'worker','Alex Worker');person(18,'participant','Alex Participant');for(let i=0;i<130;i++)task('19:'+i,19,{label:i===129?'Needle renewal':'Unrelated requirement '+i});task('18:invoice',18,{label:'Pay invoice'});
  const {data:d}=await request('?group=person&view=people&q=needle');assert.equal(d.person_total,1);assert.equal(d.selected_person,'worker:19');assert.equal(d.rows.length,130);assert.equal(d.people[0].matched,1);assert.equal(d.task_total,130);assert.equal(d.counts.people,131);
  const {data:role}=await request('?group=person&view=people&q=participant');assert.equal(role.person_total,1);assert.equal(role.selected_person,'participant:18');
  const {data:name}=await request('?group=person&view=people&q=alex');assert.equal(name.person_total,2);assert.equal(name.task_total,131);
 });
 await test('Person pagination has 12 summaries and direct selection moves to the correct page',async()=>{
  for(let i=1;i<=26;i++){person(i);task(String(i).padStart(3,'0')+':doc',i);}
  const {data:first}=await request('?group=person&view=people');assert.equal(first.people.length,12);assert.equal(first.person_total,26);assert.equal(first.rows.length,1);
  const {data:second}=await request('?group=person&view=people&offset=12');assert.equal(second.offset,12);assert.equal(second.people.length,12);assert.equal(second.selected_person,'worker:13');
  const {data:selected}=await request('?group=person&view=people&offset=0&person=worker%3A26');assert.equal(selected.offset,24);assert.equal(selected.people.length,2);assert.equal(selected.selected_person,'worker:26');assert.equal(selected.selection_changed,false);assert.equal(selected.rows[0].user_id,26);
 });
 await test('Stale links clamp to a current page and explicitly report changed person selection',async()=>{
  for(let i=1;i<=26;i++){person(i);task(String(i).padStart(3,'0')+':doc',i);}
  const {data:stale}=await request('?group=person&view=people&offset=999&person=worker%3A999');assert.equal(stale.offset,24);assert.equal(stale.selected_person,'worker:25');assert.equal(stale.selection_changed,true);
  db.prepare('UPDATE journey_tasks SET state=\'completed\' WHERE user_id>=13').run();
  const {data:shrunk}=await request('?group=person&view=people&offset=24&person=worker%3A25');assert.equal(shrunk.offset,0);assert.equal(shrunk.person_total,12);assert.equal(shrunk.selected_person,'worker:1');assert.equal(shrunk.selection_changed,true);
 });
 await test('A search excludes stale selected people and empty results have no selected person',async()=>{
  person(19,'worker','Worker');person(18,'participant','Participant');task('19:training',19,{label:'Training'});task('18:invoice',18,{label:'Invoice'});
  const {data:filtered}=await request('?group=person&view=people&q=invoice&person=worker%3A19');assert.equal(filtered.selected_person,'participant:18');assert.equal(filtered.selection_changed,true);assert.equal(filtered.rows.length,1);
  const {data:empty}=await request('?group=person&view=people&q=no-such-task&person=worker%3A19&offset=48');assert.equal(empty.selected_person,null);assert.equal(empty.selection_changed,true);assert.equal(empty.person_total,0);assert.equal(empty.task_total,0);assert.equal(empty.offset,0);assert.deepEqual(empty.rows,[]);assert.deepEqual(empty.people,[]);assert.equal(empty.counts.people,2);
 });
 await test('A person group includes only the active responsibility view and omits completed tasks',async()=>{
  person(19);task('19:training',19);task('19:office',19,{owner_kind:'office'});task('19:done',19,{state:'completed'});
  const {data:d}=await request('?group=person&view=people&person=worker%3A19');assert.equal(d.rows.length,1);assert.equal(d.rows[0].task_key,'19:training');assert.deepEqual(d.counts,{office:1,people:1,website:0});
  const {data:office}=await request('?group=person&view=office&person=worker%3A19');assert.equal(office.rows.length,1);assert.equal(office.rows[0].task_key,'19:office');
 });
 await test('Urgent counts and earliest dates are derived from all current tasks for each person',async()=>{
  person(19);person(18,'participant');task('19:later',19,{due_at:'2026-09-20'});task('19:overdue',19,{due_at:'2026-09-01'});task('18:today',18,{due_at:today});
  const {data:d}=await request('?group=person&view=people');assert.equal(d.selected_person,'worker:19');assert.equal(d.people[0].urgent,1);assert.equal(d.people[0].earliest_due,'2026-09-01');assert.equal(d.rows[0].task_key,'19:overdue');assert.equal(d.rows[0].ui.tone,'waiting');
 });
 await test('The existing flat queue retains task pagination for other consumers',async()=>{
  person(19);for(let i=0;i<105;i++)task('19:'+i,19,{owner_kind:'office',kind:'recruitment'});
  const {data:d}=await request('?view=office');assert.equal(d.total,105);assert.equal(d.rows.length,100);assert.equal(d.people,undefined);assert.equal(d.pagination,undefined);
  const {data:last}=await request('?view=office&offset=100');assert.equal(last.rows.length,5);assert.equal(last.offset,100);
 });
 await test('Invalid grouped offsets and views safely use the first supported page',async()=>{
  person(19);task('19:office',19,{owner_kind:'office'});
  for(const offset of ['-1','NaN','Infinity','1.7']){const {data:d}=await request('?group=person&view=invalid&offset='+offset);assert.equal(d.view,'office');assert.equal(d.offset,0);assert.equal(d.selected_person,'worker:19');}
 });
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
 if(process.env.NEXT_ACTIONS_PEOPLE_RESULTS)fs.writeFileSync(process.env.NEXT_ACTIONS_PEOPLE_RESULTS,JSON.stringify({runtime:process.version,results},null,2));
 console.log(`next-actions people API: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
