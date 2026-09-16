'use strict';
// Synthetic users and an in-memory outbox only. The transport below cannot
// make a network call or send an email to a real person.
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const createStore=require('../lib/process-store'),createNotices=require('../lib/booking-notifications');
let tests=0;
async function test(name,fn){await fn();tests++;console.log('PASS '+name);}
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,email TEXT,closed_at TEXT);
    CREATE TABLE support_plans(id INTEGER PRIMARY KEY);CREATE TABLE incidents(id INTEGER PRIMARY KEY);
    CREATE TABLE account_links(id INTEGER PRIMARY KEY,participant_id INTEGER,coordinator_id INTEGER,scopes TEXT,status TEXT,revoked_at TEXT);
    CREATE TABLE bookings(id INTEGER PRIMARY KEY,participant_id INTEGER,worker_id INTEGER,service TEXT,date TEXT,start TEXT,hours REAL,status TEXT,accepted_at TEXT,cancelled_at TEXT,voided INTEGER,notes TEXT);
    INSERT INTO users VALUES(1,'Synthetic participant','participant','participant@example.test',NULL),(2,'Synthetic worker','worker','worker@example.test',NULL),(3,'Synthetic helper','coordinator','helper@example.test',NULL),(4,'Other helper','coordinator','other-helper@example.test',NULL),(5,'Replacement worker','worker','replacement@example.test',NULL);
    INSERT INTO account_links VALUES(1,1,3,'["bookings"]','active',NULL),(2,1,4,'["invoices"]','active',NULL);
    INSERT INTO bookings VALUES(11,1,2,'personal-care','2099-08-01','10:00',2,'requested',NULL,NULL,0,'PRIVATE ARRIVAL NOTES'),(12,1,2,'personal-care','2099-08-08','10:00',2,'requested',NULL,NULL,0,'PRIVATE ARRIVAL NOTES');`);
  for(const name of ['completed_at','approval_state','approval_from','query_at','approved_at','invoice_no','kind'])db.exec('ALTER TABLE bookings ADD COLUMN '+name+' TEXT');
  const state={blocked:false,failure:false,enabled:true},sent=[],prefs={};
  const c={db,emailOn:()=>state.enabled,mailPrefs:id=>prefs[id]||{},baseUrl:()=> 'https://care.example.test',sendMailDirect:async(...args)=>{if(state.failure)throw Error('Synthetic temporary transport outage');sent.push(args);return {accepted:true};},
    ymd:d=>(d||new Date()).toISOString().slice(0,10),prettyDate:d=>d,serviceLabels:{'personal-care':'Personal care'},escHtml:s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),bookingStart:b=>new Date(b.date+'T'+b.start+':00Z'),blockedPair:()=>state.blocked,
    coordsFor:(pid,scope)=>db.prepare("SELECT u.* FROM account_links l JOIN users u ON u.id=l.coordinator_id WHERE l.participant_id=? AND l.status='active'").all(pid).filter(u=>db.prepare('SELECT scopes FROM account_links WHERE coordinator_id=?').all(u.id).some(l=>JSON.parse(l.scopes).includes(scope)))};
  const store=createStore(c);c.notify=(id,kind,to,...args)=>prefs[id]?.[kind]===false?Promise.resolve('opted-out'):store.enqueueMail([to,...args.slice(0,7),{...args[7],user_id:id,kind}]);
  c.approvalRecipients=(pid,people)=>store.approvalRecipients(pid,people);
  const notices=createNotices(c);store.deliveryHooks.booking=notices.suppress;
  const row=id=>db.prepare('SELECT * FROM bookings WHERE id=?').get(id),out=()=>db.prepare('SELECT * FROM delivery_outbox ORDER BY id').all(),due=()=>db.exec("UPDATE delivery_outbox SET next_at='2000-01-01' WHERE status IN ('queued','retry')");
  return {db,c,store,notices,state,sent,prefs,row,out,due,close:()=>db.close()};
}
(async()=>{
  await test('New requests acknowledge the participant and scoped helper and prompt the worker',async()=>{
    const f=fixture();await f.notices.queue({},'requested',[11]);const rows=f.out();assert.deepEqual(rows.map(r=>r.user_id),[1,3,2]);
    for(const r of rows){assert.equal(r.urgent,1);const a=JSON.parse(r.payload);assert.equal(a[8].booking_id,11);assert.doesNotMatch(r.payload,/PRIVATE ARRIVAL NOTES/);assert.match(a[5],/#\/journey\?panel=shift&booking=11/);}
    assert.match(JSON.parse(rows[0].payload)[3],/Waiting for the worker/);assert.match(JSON.parse(rows[2].payload)[1],/New booking request/);f.close();
  });
  await test('Series requests use one email per recipient and survive the first visit being accepted',async()=>{
    const f=fixture();await f.notices.queue({},'requested',[11,12]);assert.equal(f.out().length,3);f.db.exec("UPDATE bookings SET status='accepted',accepted_at='synthetic-1' WHERE id=11");await f.store.drain();assert.equal(f.sent.length,3);assert.match(f.sent.find(a=>a[0]==='worker@example.test')[3],/outstanding requests/);f.close();
  });
  await test('Resolved requests are cancelled before transport when no original request remains',async()=>{
    const f=fixture();await f.notices.queue({},'requested',[11,12]);f.db.exec("UPDATE bookings SET status='accepted'");await f.store.drain();assert.equal(f.sent.length,0);assert.ok(f.out().every(r=>r.status==='cancelled'));f.close();
  });
  await test('Accepted and declined updates reach participant helpers without emailing the acting worker',async()=>{
    const f=fixture();for(const event of ['accepted','declined']){f.db.prepare('UPDATE bookings SET status=? WHERE id=11').run(event);await f.notices.queue({},event,[11]);}assert.deepEqual(f.out().map(r=>r.user_id),[1,3,1,3]);await f.store.drain();assert.equal(f.sent.length,2);assert.ok(f.sent.every(a=>/declined/.test(a[1])));f.close();
  });
  await test('Repeated handling of the same lifecycle event creates no duplicate email',async()=>{
    const f=fixture();f.db.exec("UPDATE bookings SET status='accepted' WHERE id=11");await f.notices.queue({},'accepted',[11]);await f.notices.queue({},'accepted',[11]);assert.equal(f.out().length,2);await f.store.drain();await f.notices.queue({},'accepted',[11]);await f.store.drain();assert.equal(f.sent.length,2);f.close();
  });
  await test('A cancellation sends participant receipts and worker updates',async()=>{
    const f=fixture();f.db.exec("UPDATE bookings SET status='cancelled',cancelled_at='synthetic-cancel' WHERE id=11");await f.notices.queue({},'cancelled',[11]);await f.store.drain();assert.deepEqual(f.sent.map(a=>a[0]),['participant@example.test','helper@example.test','worker@example.test']);assert.ok(f.sent.every(a=>/cancelled/.test(a[1])));assert.ok(f.sent.every(a=>!a[3].includes('paid in full')));f.close();
  });
  await test('Ending a series emails affected worker and participant sides once',async()=>{
    const f=fixture();f.db.exec("UPDATE bookings SET status='cancelled',cancelled_at='synthetic-end'");await f.notices.queue({},'ended',[11,12]);assert.equal(f.out().length,3);await f.store.drain();assert.ok(f.sent.every(a=>/Repeating bookings ended/.test(a[1])));assert.ok(f.sent.every(a=>/2099-08-08/.test(a[3])));f.close();
  });
  await test('Worker reassignment gives the old worker a removal notice and new worker a request',async()=>{
    const f=fixture(),previous=f.row(11);f.db.exec('UPDATE bookings SET worker_id=5 WHERE id=11');await f.notices.queue({},'changed',[11],{previousRows:[previous]});await f.store.drain();assert.equal(f.sent.length,4);assert.match(f.sent.find(a=>a[0]==='worker@example.test')[3],/no longer assigned/);assert.match(f.sent.find(a=>a[0]==='worker@example.test')[5],/#\/bookings$/);const next=f.sent.find(a=>a[0]==='replacement@example.test');assert.equal(next[8].event_kind,'booking-request');assert.match(next[3],/fresh worker response/);f.close();
  });
  await test('Revoked helper scope prevents a queued booking update being sent',async()=>{
    const f=fixture();await f.notices.queue({},'requested',[11]);f.db.exec("UPDATE account_links SET scopes='[\"invoices\"]' WHERE coordinator_id=3");await f.store.drain();assert.ok(!f.sent.some(a=>a[0]==='helper@example.test'));assert.equal(f.out().find(r=>r.user_id===3).status,'cancelled');f.close();
  });
  await test('Closed accounts and ended worker relationships suppress outstanding updates',async()=>{
    const f=fixture();await f.notices.queue({},'requested',[11]);f.state.blocked=true;f.db.exec("UPDATE users SET closed_at='synthetic-closed' WHERE id=3");await f.store.drain();assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],'participant@example.test');f.close();
  });
  await test('Booking opt-outs remain respected without delaying enabled recipients',async()=>{
    const f=fixture();f.prefs[1]={bookings:false};await f.notices.queue({},'requested',[11]);assert.deepEqual(f.out().map(r=>r.user_id),[3,2]);f.prefs[3]={bookings:false};await f.store.drain();assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],'worker@example.test');f.close();
  });
  await test('Digest and quiet-hour preferences do not postpone booking lifecycle updates',async()=>{
    const f=fixture();for(const id of [1,2,3])f.db.prepare('INSERT INTO journey_preferences VALUES(?,?,?)').run(id,JSON.stringify({digest:true,quiet_from:'00:00',quiet_to:'23:59'}),'synthetic');f.db.exec("UPDATE bookings SET status='accepted' WHERE id=11");await f.notices.queue({},'accepted',[11]);await f.store.drain();assert.equal(f.sent.length,2);assert.ok(f.sent.every(a=>/Booking confirmed/.test(a[1])));f.close();
  });
  await test('Expired requests never reach transport',async()=>{
    const f=fixture();f.db.exec("UPDATE bookings SET date='2001-08-01' WHERE id=11");await f.notices.queue({},'requested',[11]);await f.store.drain();assert.equal(f.sent.length,0);assert.ok(f.out().every(r=>r.status==='cancelled'));f.close();
  });
  await test('Changed booking time supersedes the previous request email',async()=>{
    const f=fixture();await f.notices.queue({},'requested',[11]);const previous=f.row(11);f.db.exec("UPDATE bookings SET start='13:00' WHERE id=11");await f.notices.queue({},'changed',[11],{previousRows:[previous]});await f.store.drain();assert.equal(f.sent.length,3);assert.ok(f.sent.every(a=>a[3].includes('13:00')));assert.ok(f.out().slice(0,3).every(r=>r.status==='cancelled'));f.close();
  });
  await test('Email-disabled mode preserves booking messages for later transport',async()=>{
    const f=fixture();f.state.enabled=false;await f.notices.queue({},'requested',[11]);assert.equal((await f.store.drain()).disabled,true);assert.ok(f.out().every(r=>r.status==='queued'));f.state.enabled=true;await f.store.drain();assert.equal(f.sent.length,3);f.close();
  });
  await test('Helper receipts name the participant and explain the account selector',async()=>{
    const f=fixture();await f.notices.queue({},'requested',[11]);const mail=JSON.parse(f.out().find(r=>r.user_id===3).payload);assert.match(mail[3],/This booking update is for <b>Synthetic participant/);assert.match(mail[3],/select <b>Synthetic participant<\/b> as the participant/);f.close();
  });
  await test('A later repeated A to B edit has its own event, while an event retry remains deduplicated',async()=>{
    const f=fixture();for(const [n,time] of [[1,'11:00'],[2,'10:00'],[3,'11:00']]){const previous=f.row(11);f.db.prepare('UPDATE bookings SET start=? WHERE id=11').run(time);const options={previousRows:[previous],event_id:'synthetic-mutation-'+n};await f.notices.queue({},'changed',[11],options);await f.notices.queue({},'changed',[11],options);await f.store.drain();}assert.equal(f.out().length,9);assert.equal(f.sent.length,9);f.close();
  });
  await test('Accepted receipt survives normal completion before delivery, but not a changed worker',async()=>{
    const f=fixture();f.db.exec("UPDATE bookings SET status='accepted',accepted_at='synthetic-accepted' WHERE id=11");await f.notices.queue({},'accepted',[11]);f.db.exec("UPDATE bookings SET status='completed',completed_at='2026-09-16T01:00:00Z' WHERE id=11");await f.store.drain();assert.equal(f.sent.length,2);f.close();
    const g=fixture();g.db.exec("UPDATE bookings SET status='accepted' WHERE id=11");await g.notices.queue({},'accepted',[11]);g.db.exec("UPDATE bookings SET status='completed',worker_id=5 WHERE id=11");await g.store.drain();assert.equal(g.sent.length,0);g.close();
  });
  function completed(f){f.db.exec("UPDATE bookings SET status='completed',completed_at='2026-09-16T01:00:00Z',approval_state='pending',approval_from='2026-09-16T01:00:00Z',kind='shift' WHERE id=11");}
  await test('Completion and submission receipts are urgent, deduplicated, private and targeted',async()=>{
    const f=fixture();completed(f);for(const id of [1,2,3])f.db.prepare('INSERT INTO journey_preferences VALUES(?,?,?)').run(id,JSON.stringify({digest:true,quiet_from:'00:00',quiet_to:'23:59'}),'synthetic');
    await f.notices.queueShift({},'submitted',11);await f.notices.queueShift({},'review',11);await f.notices.queueShift({},'review',11);assert.deepEqual(f.out().map(r=>r.user_id),[2,1,3]);assert.ok(f.out().every(r=>r.urgent===1));
    for(const row of f.out()){const mail=JSON.parse(row.payload);assert.match(mail[5],/#\/journey\?panel=shift&booking=11/);assert.doesNotMatch(row.payload,/PRIVATE ARRIVAL NOTES/);if(row.user_id===3)assert.match(mail[5],/&for=1/);}
    await f.store.drain();assert.equal(f.sent.length,3);f.close();
  });
  await test('Plan and NDIA review notice exists independently of invoice creation',async()=>{
    const f=fixture();completed(f);await f.notices.queueShift({},'review',11);assert.equal(f.out().length,2);assert.ok(f.out().every(r=>r.event_kind==='shift-review'));f.db.exec("UPDATE bookings SET invoice_no='INV-SYNTHETIC' WHERE id=11");await f.notices.queueShift({},'review',11);assert.equal(f.out().length,2);await f.store.drain();assert.equal(f.sent.length,2);f.close();
  });
  await test('Nomination chooses the review recipient and changed nominations suppress old review mail',async()=>{
    const f=fixture();completed(f);f.db.prepare('INSERT INTO approval_owners VALUES(?,?,?)').run(1,3,'synthetic');await f.notices.queueShift({},'review',11);assert.deepEqual(f.out().map(r=>r.user_id),[3]);f.db.exec('UPDATE approval_owners SET user_id=1');await f.store.drain();assert.equal(f.sent.length,0);assert.match(f.out()[0].error,/owner changed/);f.close();
  });
  await test('Revoked booking helper never receives queued shift notes or answers',async()=>{
    const f=fixture();completed(f);await f.notices.queueShift({},'answered',11);f.db.exec("UPDATE account_links SET scopes='[\"invoices\"]' WHERE coordinator_id=3");await f.store.drain();assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],'participant@example.test');f.close();
  });
  await test('A query suppresses obsolete review mail while worker receipt and query remain deliverable',async()=>{
    const f=fixture();completed(f);await f.notices.queueShift({},'submitted',11);await f.notices.queueShift({},'review',11);f.db.exec("UPDATE bookings SET approval_state='queried',query_at='synthetic-query-1' WHERE id=11");await f.notices.queueShift({},'queried',11);await f.store.drain();assert.deepEqual(f.sent.map(a=>a[8].booking_shift_event),['submitted','queried']);f.close();
  });
  await test('Answered questions supersede unanswered prompts; later questions form distinct events',async()=>{
    const f=fixture();completed(f);f.db.exec("UPDATE bookings SET approval_state='queried',query_at='synthetic-query-1' WHERE id=11");await f.notices.queueShift({},'queried',11);f.db.exec("UPDATE bookings SET approval_state='pending',approval_from='2026-09-17T01:00:00Z' WHERE id=11");await f.notices.queueShift({},'answered',11,{note_id:91});await f.store.drain();assert.equal(f.sent.length,2);assert.ok(f.sent.every(a=>a[8].booking_shift_event==='answered'));f.db.exec("UPDATE bookings SET approval_state='queried',query_at='synthetic-query-2' WHERE id=11");await f.notices.queueShift({},'queried',11);await f.store.drain();assert.equal(f.sent.length,3);f.close();
  });
  await test('Timesheet opt-outs apply to new submissions and pending deliveries',async()=>{
    const f=fixture();completed(f);f.prefs[1]={timesheets:false};await f.notices.queueShift({},'review',11);assert.deepEqual(f.out().map(r=>r.user_id),[3]);f.prefs[3]={timesheets:false};await f.store.drain();assert.equal(f.sent.length,0);f.close();
  });
  await test('Automatic approval tells both sides and does not claim that money has been sent',async()=>{
    const f=fixture();completed(f);f.db.exec("UPDATE bookings SET approval_state='approved',approved_at='synthetic-approved' WHERE id=11");await f.notices.queueShift({},'deemed',11);await f.store.drain();assert.equal(f.sent.length,3);assert.ok(f.sent.some(a=>a[0]==='worker@example.test'&&a[3].includes('separate payroll status')));assert.ok(f.sent.some(a=>a[0]==='participant@example.test'&&a[3].includes('does not confirm that payment was taken')));f.close();
  });
  await test('Meet-and-greet completion records a receipt without asking to pay an invoice',async()=>{
    const f=fixture();completed(f);f.db.exec("UPDATE bookings SET kind='intro' WHERE id=11");await f.notices.queueShift({},'submitted',11);await f.notices.queueShift({},'completed',11);await f.store.drain();assert.equal(f.sent.length,3);assert.ok(f.sent.every(a=>!a[3].includes('pay invoice')));f.close();
  });
  await test('Unrelated helper account links cannot erase a valid queued booking confirmation',async()=>{
    const f=fixture();f.db.exec("UPDATE bookings SET status='accepted' WHERE id=11");await f.notices.queue({},'accepted',[11]);f.db.exec("INSERT INTO account_links VALUES(3,99,3,'[\"bookings\"]','active',NULL)");await f.store.drain();assert.equal(f.sent.length,2);assert.ok(f.sent.some(a=>a[0]==='helper@example.test'));f.close();
  });
  await test('An added helper scope preserves booking access while email and role changes remain blocked',async()=>{
    const f=fixture();f.db.exec("UPDATE bookings SET status='accepted' WHERE id=11");await f.notices.queue({},'accepted',[11]);f.db.exec("UPDATE account_links SET scopes='[\"bookings\",\"invoices\"]' WHERE coordinator_id=3");await f.store.drain();assert.equal(f.sent.length,2);f.close();
    for(const patch of ["email='changed@example.test'","role='worker'"]){const g=fixture();g.db.exec("UPDATE bookings SET status='accepted' WHERE id=11");await g.notices.queue({},'accepted',[11]);g.db.exec('UPDATE users SET '+patch+' WHERE id=3');await g.store.drain();assert.equal(g.sent.length,1);assert.equal(g.sent[0][0],'participant@example.test');g.close();}
  });
  await test('Partner-provider cover confirmation tells participant and scoped helper without naming a replaced worker',async()=>{
    const f=fixture();await f.notices.queue({},'covered',[11],{alliedName:'Synthetic partner provider'});assert.deepEqual(f.out().map(r=>r.user_id),[1,3]);await f.store.drain();assert.ok(f.sent.every(a=>a[3].includes('Synthetic partner provider')&&!a[3].includes('Synthetic worker')));f.close();
  });
  console.log('booking notifications: '+tests+' passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
