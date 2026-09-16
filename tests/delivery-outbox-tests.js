'use strict';
// Disposable SQLite state and injected transports only: no network or email.
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const createStore=require('../lib/process-store');
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name);}
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,email TEXT,closed_at TEXT);
    CREATE TABLE support_plans(id INTEGER PRIMARY KEY);CREATE TABLE incidents(id INTEGER PRIMARY KEY);
    CREATE TABLE account_links(id INTEGER PRIMARY KEY,participant_id INTEGER,coordinator_id INTEGER,scopes TEXT,status TEXT,revoked_at TEXT);
    CREATE TABLE bookings(id INTEGER PRIMARY KEY,approval_state TEXT);
    INSERT INTO users VALUES(1,'participant','participant@example.test',NULL);
    INSERT INTO bookings VALUES(11,'pending');`);
  const sent=[],state={enabled:true,fail:false,skip:false},prefs={};
  const context={db,emailOn:()=>state.enabled,mailPrefs:()=>prefs,baseUrl:()=> 'https://care.example.test',sendMailDirect:async(...args)=>{
    sent.push(args);if(state.fail)throw Error('Synthetic provider 429: please retry later');return state.skip?'skipped-off':true;
  }};
  const store=createStore(context),rows=()=>db.prepare('SELECT * FROM delivery_outbox ORDER BY id').all();
  const due=()=>db.exec("UPDATE delivery_outbox SET next_at='2000-01-01' WHERE status IN ('queued','retry')");
  const enqueue=(key,meta={})=>store.enqueueMail(['participant@example.test','Synthetic '+(key||'generated key'),'Update','Synthetic body','Open','https://care.example.test/#/journey',undefined,[],{kind:'timesheets',user_id:1,transactional:true,...(key?{event_key:key}:{}),...meta}]);
  return {db,store,context,sent,state,prefs,rows,due,enqueue,close:()=>db.close()};
}
(async()=>{
  await test('Generated outbox keys reach the provider unchanged after failure and store restart',async()=>{
    const f=fixture();await f.enqueue();await f.enqueue();assert.equal(f.rows().length,1);
    const key=f.rows()[0].event_key;assert.equal(JSON.parse(f.rows()[0].payload)[8].event_key,key);
    f.state.fail=true;await f.store.drain();assert.equal(f.rows()[0].status,'retry');
    f.state.fail=false;f.due();const restarted=createStore(f.context);await restarted.drain();
    assert.equal(f.sent.length,2);assert.ok(f.sent.every(a=>a[8].event_key===key));assert.equal(f.rows()[0].status,'sent');assert.equal(f.rows()[0].payload,'[]');f.close();
  });
  await test('Legacy queued messages obtain provider keys and preserve explicit corrected transport revisions',async()=>{
    const f=fixture();await f.enqueue('legacy');await f.enqueue('invoice:synthetic');
    for(const row of f.rows()){const args=JSON.parse(row.payload);if(row.event_key==='legacy')delete args[8].event_key;else args[8].event_key='invoice:synthetic:corrected-v1';f.db.prepare('UPDATE delivery_outbox SET payload=? WHERE id=?').run(JSON.stringify(args),row.id);}
    await f.store.drain();assert.deepEqual(f.sent.map(a=>a[8].event_key),['legacy','invoice:synthetic:corrected-v1']);f.close();
  });
  await test('Timesheet delivery keeps retrying beyond five provider failures and then recovers',async()=>{
    const f=fixture();await f.enqueue('completion');f.state.fail=true;
    for(let attempt=1;attempt<=7;attempt++){f.due();await f.store.drain();const row=f.rows()[0];assert.equal(row.attempts,attempt);assert.equal(row.status,'retry');assert.equal(row.sent_at,null);assert.notEqual(row.payload,'[]');assert.ok(Date.parse(row.next_at)>Date.now());}
    f.state.fail=false;f.due();await f.store.drain();assert.equal(f.rows()[0].attempts,8);assert.equal(f.rows()[0].status,'sent');assert.equal(f.sent.length,8);f.close();
  });
  await test('Previously failed timesheet bodies resume on restart and resolved review tasks are suppressed',async()=>{
    const f=fixture();await f.enqueue('legacy-completion',{requires_approval:true,booking_id:11});await f.enqueue('legacy-approved');
    f.db.exec("UPDATE delivery_outbox SET status='failed',attempts=5,error='Synthetic old transport failure';UPDATE bookings SET approval_state='approved'");
    const restarted=createStore(f.context);assert.ok(f.rows().every(r=>r.status==='retry'));await restarted.drain();
    assert.equal(f.rows()[0].status,'cancelled');assert.equal(f.rows()[0].payload,'[]');assert.equal(f.rows()[1].status,'sent');assert.equal(f.sent.length,1);f.close();
  });
  await test('Existing review notices are promoted out of digest while ordinary timesheet updates retain preferences',async()=>{
    const f=fixture();f.db.prepare('INSERT INTO journey_preferences VALUES(?,?,?)').run(1,JSON.stringify({digest:true}),new Date().toISOString());
    await f.enqueue('old-review',{transactional:false,requires_approval:true,booking_id:11});await f.enqueue('ordinary-update',{transactional:false});
    assert.ok(f.rows().every(r=>r.urgent===0&&Date.parse(r.next_at)>Date.now()));await createStore(f.context).drain();
    assert.equal(f.rows()[0].urgent,1);assert.equal(f.rows()[0].status,'sent');assert.equal(f.rows()[1].urgent,0);assert.equal(f.rows()[1].status,'queued');assert.equal(f.sent.length,1);assert.match(f.sent[0][1],/old-review/);f.close();
  });
  await test('Payroll notices retry past the old limit and recover without being hidden in a digest',async()=>{
    const f=fixture();f.db.prepare('INSERT INTO journey_preferences VALUES(?,?,?)').run(1,JSON.stringify({digest:true}),new Date().toISOString());
    await f.enqueue('payroll-update',{kind:'payroll',transactional:false,payroll_update:true});f.db.exec("UPDATE delivery_outbox SET status='failed',attempts=5");
    const restarted=createStore(f.context);assert.equal(f.rows()[0].urgent,1);assert.equal(f.rows()[0].status,'retry');f.state.fail=true;
    await restarted.drain();assert.equal(f.rows()[0].status,'retry');assert.equal(f.rows()[0].attempts,6);f.state.fail=false;f.due();await restarted.drain();assert.equal(f.rows()[0].status,'sent');assert.equal(f.sent.length,2);f.close();
  });
  await test('Payment failure suppression receives the attempt metadata before a message can be sent',async()=>{
    const f=fixture();await f.enqueue('stale-payment',{kind:'invoice',payment_reminder:true,invoice_no:'INV-TEST',payment_attempt_id:42});let seen;
    f.store.paymentDeliveryInvalid=(no,meta)=>{seen={no,attempt:meta.payment_attempt_id};return true;};await f.store.drain();assert.deepEqual(seen,{no:'INV-TEST',attempt:42});assert.equal(f.rows()[0].status,'cancelled');assert.equal(f.sent.length,0);f.close();
  });
  await test('Optional noncritical email retains its bounded failure policy',async()=>{
    const f=fixture();await f.enqueue('optional-news',{kind:'news',transactional:false});f.state.fail=true;
    for(let i=0;i<5;i++){f.due();await f.store.drain();}assert.equal(f.rows()[0].status,'failed');assert.equal(f.sent.length,5);f.close();
  });
  await test('Immediate and scheduled drains share one running delivery pass',async()=>{
    const f=fixture();await f.enqueue('first');await f.enqueue('second');let release;
    const gate=new Promise(resolve=>{release=resolve;});let calls=0;
    f.context.sendMailDirect=async()=>{calls++;if(calls===1)await gate;return true;};
    const first=f.store.drain();await Promise.resolve();const second=f.store.drain();assert.equal(first,second);assert.equal(calls,1);
    release();await Promise.all([first,second]);assert.equal(calls,2);assert.ok(f.rows().every(r=>r.status==='sent'));await f.store.drain();assert.equal(calls,2);f.close();
  });
  await test('A competing store cannot bypass the backoff selected by another delivery pass',async()=>{
    const f=fixture();await f.enqueue('first');await f.enqueue('second');let release;const gate=new Promise(resolve=>{release=resolve;});
    f.context.sendMailDirect=async(...args)=>{f.sent.push(args);if(args[8].event_key==='first')await gate;else throw Error('Synthetic provider outage');return true;};
    const secondStore=createStore(f.context),first=f.store.drain();await Promise.resolve();await secondStore.drain();
    assert.equal(f.rows()[1].status,'retry');assert.equal(f.rows()[1].attempts,1);release();await first;
    assert.equal(f.sent.length,2);assert.equal(f.rows()[1].attempts,1);assert.equal(f.rows()[1].status,'retry');f.close();
  });
  await test('A restart recovers an expired sending lease without changing transport identity',async()=>{
    const f=fixture();await f.enqueue('leased');f.db.exec("UPDATE delivery_outbox SET status='sending',attempts=1,lease_until='2000-01-01'");
    await createStore(f.context).drain();assert.equal(f.rows()[0].attempts,2);assert.equal(f.rows()[0].status,'sent');assert.equal(f.sent[0][8].event_key,'leased');f.close();
  });
  await test('Missing email configuration preserves the queue and never claims acceptance',async()=>{
    const f=fixture();await f.enqueue('disabled');f.state.enabled=false;const result=await f.store.drain();
    assert.equal(result.disabled,true);assert.equal(result.queued,1);assert.equal(f.rows()[0].attempts,0);assert.equal(f.rows()[0].status,'queued');assert.equal(f.rows()[0].sent_at,null);assert.equal(f.sent.length,0);
    f.state.enabled=true;await f.store.drain();assert.equal(f.rows()[0].status,'sent');f.close();
  });
  await test('Skipped transport is a retry, not a successful delivery',async()=>{
    const f=fixture();await f.enqueue('skipped');f.state.skip=true;await f.store.drain();assert.equal(f.rows()[0].status,'retry');assert.equal(f.rows()[0].sent_at,null);assert.match(f.rows()[0].error,/did not accept/);f.close();
  });
  await test('Transactional updates bypass digest and quiet hours while explicit category opt-outs still apply',async()=>{
    const f=fixture();f.db.prepare('INSERT INTO journey_preferences VALUES(?,?,?)').run(1,JSON.stringify({digest:true,quiet_from:'00:00',quiet_to:'23:59'}),new Date().toISOString());
    await f.enqueue('review-now');await f.store.drain();assert.equal(f.sent.length,1);assert.match(f.sent[0][1],/review-now/);
    await f.enqueue('opted-out');f.prefs.timesheets=false;await f.store.drain();assert.equal(f.sent.length,1);assert.equal(f.rows()[1].status,'cancelled');assert.equal(f.rows()[1].error,'notification preference');f.close();
  });
  await test('Closed accounts and changed recipient addresses cancel queued private messages',async()=>{
    for(const sql of ["UPDATE users SET closed_at='synthetic'","UPDATE users SET email='changed@example.test'"]){const f=fixture();await f.enqueue('access-changed');f.db.exec(sql);await f.store.drain();assert.equal(f.sent.length,0);assert.equal(f.rows()[0].status,'cancelled');assert.equal(f.rows()[0].payload,'[]');f.close();}
  });
  await test('Routine digest retries retain a deterministic provider identity for the same batch',async()=>{
    const f=fixture();f.db.prepare('INSERT INTO journey_preferences VALUES(?,?,?)').run(1,JSON.stringify({digest:true}),new Date().toISOString());
    await f.enqueue('routine-1',{kind:'news',transactional:false});await f.enqueue('routine-2',{kind:'news',transactional:false});f.due();f.state.fail=true;await f.store.drain();
    assert.equal(f.sent.length,1);assert.match(f.sent[0][8].event_key,/^daily-digest:/);f.state.fail=false;f.due();await f.store.drain();assert.equal(f.sent.length,2);assert.equal(f.sent[0][8].event_key,f.sent[1][8].event_key);assert.ok(f.rows().every(r=>r.status==='sent'));f.close();
  });
  console.log('delivery outbox: '+count+' passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
