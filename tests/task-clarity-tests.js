'use strict';
process.env.TZ='Australia/Sydney';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const Q=require('../lib/task-queue'),Monitor=require('../lib/certificate-monitor');
const context={today:'2026-09-13',as_of:'2026-09-12T14:30:00Z'};
const row=(x={})=>({task_key:'9:doc-review:2',user_id:9,kind:'document',label:'Review CPR evidence',person:'Example Worker',person_role:'worker',owner_kind:'office',destination:'#/admin/compliance',state:'ready',ready_at:'2026-09-01T00:00:00Z',...x});
const results=[];
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.stack);}}
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx={esc:escape,fmtAU:v=>v,Date};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/assets/next-actions.js'),'utf8'),ctx);
const render=(tasks,view='office',extra={})=>ctx.CareNextActions.renderOffice({rows:tasks.map(t=>({...t,ui:Q.describe(t,context)})),view,total:tasks.length,offset:0,counts:{office:2,people:1,website:1},staff:[],...context,...extra},{search:'',assignment:()=>'<form>Assign office owner</form>'});
(async()=>{
 await test('Office, participant follow-up and website maintenance have distinct responsibility and destinations',()=>{
  assert.equal(Q.describe(row(),context).action,'Review documents');
  const person=Q.describe(row({kind:'followup',owner_kind:'person',person_role:'participant'}),context);assert.equal(person.bucket,'people');assert.equal(person.status,'Waiting on participant');assert.match(person.destination,/role=participant/);assert.match(person.next,/share feedback/);
  const site=Q.describe(row({task_key:'office:office:ops:certificate',kind:'operations'}),context);assert.equal(site.bucket,'website');assert.equal(site.subject,'The Care Web website');assert.equal(site.action,'Check website security');
 });
 await test('Time deadlines use Sydney midnight while document dates retain calendar-day meaning',()=>{
  const timed=Q.describe(row({kind:'cover',due_at:'2026-09-12T15:00:00Z'}),context);assert.equal(timed.due_date,'2026-09-13');assert.equal(timed.status,'Due today');
  assert.equal(Q.describe(row({kind:'cover',due_at:'2026-09-12T14:00:00Z'}),context).status,'Overdue');
  assert.equal(Q.describe(row({due_at:'2026-09-13T00:00:00Z'}),context).status,'Due today');
  assert.equal(Q.describe(row({due_at:'2026-09-12T23:59:59Z'}),context).status,'Overdue');
 });
 await test('Person reminders stay blue; missing due dates do not invent urgency',()=>{
  assert.equal(Q.describe(row({owner_kind:'person',due_at:'2020-01-01'}),context).tone,'waiting');assert.equal(Q.describe(row(),context).tone,'action');
  assert.equal(Q.describe(row({task_key:'office:office:ops:certificate',label:'Website certificate invalid or expired'}),context).tone,'urgent');
 });
 await test('Specific actions lead to messages, payroll, recruitment, support and incidents',()=>{
  for(const [kind,action]of [['delivery','Check delivery'],['payroll','Review pay batch'],['recruitment','Review application'],['transition','Review support request'],['incident','Review incident']])assert.equal(Q.describe(row({kind}),context).action,action);
  assert.equal(Q.describe(row({task_key:'office:office:ops:mail:10',kind:'operations'}),context).destination,'#/journey?panel=deliveries');
 });
 await test('The queue filters responsibility before pagination, sorts urgency and searches displayed subject',()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER,name TEXT,role TEXT); CREATE TABLE journey_tasks(task_key TEXT,user_id INTEGER,kind TEXT,label TEXT,detail TEXT,destination TEXT,owner_kind TEXT,state TEXT,ready_at TEXT,due_at TEXT); INSERT INTO users VALUES(9,\'Example\',\'worker\');');
  const insert=db.prepare('INSERT INTO journey_tasks VALUES(?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<105;i++)insert.run('9:'+i,9,'document','Review '+i,'','',i===0?'person':'office','ready','2026-09-01',i===104?'2026-08-01':null);
  insert.run('office:office:ops:certificate',9,'operations','Security','','','office','ready','2026-09-01',null);
  const first=Q.queue(db,{...context,view:'office'});assert.equal(first.total,104);assert.equal(first.rows.length,100);assert.equal(first.rows[0].label,'Review 104');assert.deepEqual(first.counts,{office:104,people:1,website:1});
  const last=Q.queue(db,{...context,view:'office',offset:999});assert.equal(last.offset,100);assert.equal(last.rows.length,4);
  assert.equal(Q.queue(db,{...context,view:'website',search:'The Care Web website'}).total,1);assert.equal(Q.queue(db,{...context,view:'website',search:'Example'}).total,0);db.close();
 });
 await test('Task rows expose next step and status without requiring details to be opened',()=>{
  const html=render([row()]);assert.match(html,/→ Action required/);assert.match(html,/<b>Next step:<\/b>/);assert.match(html,/>Review documents<\/a>/);assert.match(html,/Any office reviewer can start/);assert.ok(!html.includes('Open record'));assert.ok(!html.includes('Unassigned'));
 });
 await test('Participant follow-ups have no office assignment form or admin implication',()=>{
  const html=render([row({kind:'followup',owner_kind:'person',person_role:'participant'})],'people');assert.match(html,/Waiting on participant/);assert.match(html,/>View participant<\/a>/);assert.ok(!html.includes('<form>'));assert.ok(!html.includes('Details & assignment'));
 });
 await test('Website tasks show the website rather than the admin name; all supplied content is escaped',()=>{
  const html=render([row({task_key:'office:office:ops:certificate',kind:'operations',label:'<img onerror=bad>',detail:'<script>bad</script>'})],'website');assert.ok(!html.includes('Example Worker'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/The Care Web website/);
 });
 await test('Empty office view keeps the other counts visible and makes no claim that their work is complete',()=>{
  const html=render([]);assert.match(html,/No office action is currently required/);assert.match(html,/Waiting on people/);assert.match(html,/Website checks/);assert.match(html,/aria-current="page"/);
 });
 await test('Pagination retains the active responsibility view',()=>{
  const html=render([row({owner_kind:'person'})],'people',{offset:100,total:201});assert.match(html,/view=people&amp;offset=0/);assert.match(html,/view=people&amp;offset=200/);
 });
 await test('Personal first-visit feedback is explicitly optional rather than a missing requirement',()=>{
  const html=ctx.CareNextActions.render({role:'participant',tasks:[row({owner_kind:'person',kind:'followup',destination:'#/journey?panel=followup&booking=5'})],next:[],...context});assert.match(html,/Optional follow-up/);assert.match(html,/Optional feedback/);assert.ok(!html.includes('Action required'));assert.ok(!html.includes('needs your attention'));
 });
 await test('Text on all task status colours meets 4.5:1 contrast',()=>{
  const lum=h=>{const rgb=h.match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const [fg,bg]of [['8e2028','ffebee'],['704200','fff4d6'],['174575','e9f2ff'],['205736','e8f6ed']])assert.ok((lum(bg)+.05)/(lum(fg)+.05)>=4.5);
 });
 const make=(fn,url='https://example.com')=>{let time=Date.parse('2026-09-12T00:00:00Z'),data='{}';const c={appUrl:url,setting:()=>data,setSetting:(_k,v)=>{data=v;}};return {monitor:Monitor(c,{clock:()=>time,probe:fn}),advance:ms=>time+=ms,raw:()=>JSON.parse(data)};};
 await test('Missing hostname requests hosting setup; no handshake is attempted for a local or unsafe origin',async()=>{
  for(const u of ['', 'http://localhost:3000','https://user:pass@example.com','https://127.0.0.1','https://example.com:444']){const x=make(()=>{throw Error('Must not run');},u);await x.monitor.tick();assert.equal(x.monitor.status().state,'setup');assert.match(x.monitor.alert().detail,/APP_URL/);}
  assert.equal(Monitor.target('https://example.com/path'),'example.com');
 });
 await test('A healthy certificate clears the alert and cached checks do not repeat before their next due time',async()=>{
  let calls=0;const x=make(async()=>{calls++;return {expires_at:'2026-12-01T00:00:00Z'};});assert.equal(x.monitor.alert(),null);await Promise.all([x.monitor.tick(),x.monitor.tick()]);await x.monitor.tick();assert.equal(calls,1);assert.equal(x.monitor.status().state,'healthy');assert.equal(x.monitor.alert(),null);
 });
 await test('Certificate expiry produces a dated renewal task and renewal clears it automatically',async()=>{
  let expiry='2026-09-20T00:00:00Z';const x=make(async()=>({expires_at:expiry}));await x.monitor.tick();assert.equal(x.monitor.status().state,'expiring');assert.equal(x.monitor.alert().due_at,expiry);expiry='2026-12-20T00:00:00Z';x.advance(86400001);await x.monitor.tick();assert.equal(x.monitor.alert(),null);
 });
 await test('Transient failures retry automatically; repeated failures become one clear technical alert',async()=>{
  const x=make(async()=>{throw Error('temporary connection failure');});await x.monitor.tick();assert.equal(x.monitor.status().state,'retry');assert.equal(x.monitor.alert(),null);x.advance(3600001);await x.monitor.tick();assert.equal(x.monitor.alert(),null);x.advance(3600001);await x.monitor.tick();assert.equal(x.monitor.status().state,'unavailable');assert.match(x.monitor.alert().detail,/keeps retrying/);
 });
 await test('Certificate trust failures alert immediately and successful recovery clears them',async()=>{
  let failed=true;const x=make(async()=>{if(failed){const e=Error('fixture');e.code='ERR_TLS_CERT_ALTNAME_INVALID';throw e;}return {expires_at:'2026-12-20T00:00:00Z'};});await x.monitor.tick();assert.equal(x.monitor.status().state,'invalid');assert.equal(x.monitor.status().tone,'urgent');failed=false;x.advance(3600001);await x.monitor.tick();assert.equal(x.monitor.alert(),null);
 });
 await test('A stopped scheduler cannot leave a healthy badge indefinitely',async()=>{
  const x=make(async()=>({expires_at:'2026-12-01T00:00:00Z'}));await x.monitor.tick();x.advance(3*86400000);assert.equal(x.monitor.status().state,'stale');assert.ok(x.monitor.alert());
 });
 await test('Probe rejects private DNS answers and validates hostname with TLS trust enabled',async()=>{
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','::1','::ffff:127.0.0.1'])await assert.rejects(Monitor.probe('example.com',{lookup:async()=>[{address}],connect:()=>{throw Error('Must not connect');}}),/safely resolved/);
  let options,destroyed=false;const x=await Monitor.probe('example.com',{lookup:async()=>[{address:'93.184.216.34'}],connect:(o,cb)=>{options=o;const s={once(){},destroy(){destroyed=true;},authorized:true,getPeerCertificate:()=>({valid_to:'Dec 1 00:00:00 2026 GMT'})};queueMicrotask(cb);return s;}});assert.equal(options.servername,'example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.host,'93.184.216.34');assert.equal(typeof options.checkServerIdentity,'function');assert.equal(destroyed,true);assert.match(x.expires_at,/2026-12-01/);
 });
 await test('DNS and TLS stalls time out; a late DNS result cannot open a connection',async()=>{
  let resolve,connected=false;await assert.rejects(Monitor.probe('example.com',{timeout:5,lookup:()=>new Promise(r=>resolve=r),connect:()=>{connected=true;}}),/timed out/);resolve([{address:'93.184.216.34'}]);await new Promise(r=>setImmediate(r));assert.equal(connected,false);
 });
 if(process.env.TASK_RESULTS)fs.writeFileSync(process.env.TASK_RESULTS,JSON.stringify({runtime:process.version,results},null,2));console.log(`task clarity: ${results.filter(x=>x.result==='PASS').length}/${results.length} passed`);if(results.some(x=>x.result==='FAIL'))process.exitCode=1;
})();
