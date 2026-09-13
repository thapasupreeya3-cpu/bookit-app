'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const Payroll=require('../lib/payroll-notifications');
const results=[];
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,email TEXT,closed_at TEXT);
    CREATE TABLE payroll_batches(id INTEGER PRIMARY KEY,from_date TEXT,to_date TEXT,status TEXT,created_at TEXT,created_by INTEGER,exported_at TEXT,external_ref TEXT,acknowledged_at TEXT);
    CREATE TABLE payroll_lines(id INTEGER PRIMARY KEY,batch_id INTEGER,worker_id INTEGER,source_key TEXT,amount REAL,status TEXT,resolution TEXT,components TEXT);
    INSERT INTO users VALUES(1,'worker','worker1@example.test',NULL),(2,'worker','worker2@example.test',NULL),(3,'participant','participant@example.test',NULL),(4,'worker','closed@example.test','2026-09-01');
    INSERT INTO payroll_batches VALUES(10,'2026-09-01','2026-09-12','draft','2026-09-13T00:00:00Z',99,NULL,'',NULL);
    INSERT INTO payroll_lines VALUES(101,10,1,'booking:101',310.62,'included','','{"gross_wages":240,"super":28.8,"allowances":0,"reference":"PAYROLL-CALC-101"}'),
      (102,10,2,'booking:102',150,'included','Worker two private resolution',NULL),
      (103,10,1,'booking:103',50,'excluded','Excluded duplicate entry',NULL),
      (104,10,4,'booking:104',50,'included','Closed account',NULL);`);
  let clock=Date.parse('2026-09-13T00:00:00Z'),fail=false;
  const queued=new Map(),hooks={};
  const context={db,baseUrl:()=> 'https://care.example.test'};
  const workflow={now:()=>new Date(clock).toISOString(),deliveryHooks:hooks,enqueueMail:async args=>{if(fail)throw Error('Temporary local queue unavailable');queued.set(args[8].event_key,args);return 'queued';}};
  const api=Payroll(context,workflow);
  return {db,api,queued,hooks,context,workflow,advance:ms=>{clock+=ms;},fail:value=>{fail=value;},stage:value=>db.prepare('UPDATE payroll_batches SET status=? WHERE id=10').run(value)};
}
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:error.stack});console.error('FAIL '+name+' '+error.stack);}}
(async()=>{
  await test('Additive setup preserves payroll records and creates no historical notification flood',()=>{
    const f=fixture();assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payroll_lines').get().n,4);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payroll_notification_events').get().n,0);Payroll(f.context,f.workflow);assert.equal(f.api.workerData(1).lines.length,2);f.db.close();
  });
  await test('Draft notices are per active worker and duplicate hooks do not duplicate messages',async()=>{
    const f=fixture();assert.equal(f.api.prepared(10).queued,2);assert.equal(f.api.prepared(10).queued,0);await Promise.all([f.api.tick(),f.api.tick()]);assert.equal(f.queued.size,2);assert.equal(f.api.workerData(4).lines.length,0);assert.ok([...f.queued.values()].every(args=>args[5]==='https://care.example.test/#/journey?panel=payroll'));f.db.close();
  });
  await test('Export creates a waiting status and never represents wages as paid',async()=>{
    const f=fixture();f.stage('exported');assert.equal(f.api.exported(10).queued,2);await f.api.tick();const line=f.api.workerData(1).lines.find(x=>x.id===101);assert.equal(line.status_label,'Export file created');assert.equal(line.payment_recorded,false);assert.equal(line.provider_confirmed,false);assert.match(line.status_detail,/Payment has not been confirmed/);const email=[...f.queued.values()][0];assert.match(email[3],/Payment has not been confirmed/);assert.ok(!email[1].includes('paid'));f.db.close();
  });
  await test('Office acknowledgement requires stored evidence and clearly names its source',async()=>{
    const f=fixture();f.stage('acknowledged');assert.equal(f.api.acknowledged(10).queued,0);assert.equal(f.api.workerData(1).lines.find(x=>x.id===101).payment_recorded,false);
    f.db.prepare('UPDATE payroll_batches SET external_ref=?,acknowledged_at=? WHERE id=10').run('BANK-RESULT-001','2026-09-13T02:00:00Z');assert.equal(f.api.acknowledged(10).queued,2);await f.api.tick();const line=f.api.workerData(1).lines.find(x=>x.id===101);assert.equal(line.status_label,'Payment recorded by office');assert.equal(line.confirmation_source,'office_recorded');assert.equal(line.provider_confirmed,false);assert.equal(line.payment_recorded_at,'2026-09-13T02:00:00Z');assert.match([...f.queued.values()][0][3],/bank has not confirmed receipt/);f.db.close();
  });
  await test('Excluded lines remain excluded when the rest of the batch is acknowledged',()=>{
    const f=fixture();f.db.prepare("UPDATE payroll_batches SET status='acknowledged',external_ref='BANK-RESULT-001',acknowledged_at='2026-09-13T02:00:00Z'").run();const line=f.api.workerData(1).lines.find(x=>x.id===103);assert.equal(line.status_label,'Not included in this batch');assert.equal(line.payment_recorded,false);assert.equal(line.confirmation_source,null);f.db.close();
  });
  await test('Expected pay dates are optional, validated and never inferred from period or record date',()=>{
    const f=fixture();assert.equal(f.api.workerData(1).lines[0].expected_pay_date,null);assert.equal(f.api.recordExpectedDate(10,'2026-02-30').ok,false);assert.equal(f.api.recordExpectedDate(10,'2026-09-15').ok,true);const rows=f.api.workerData(1).lines;assert.equal(rows.find(x=>x.id===101).expected_pay_date,'2026-09-15');assert.equal(rows.find(x=>x.id===103).expected_pay_date,null);f.api.recordExpectedDate(10,'');assert.equal(f.api.workerData(1).lines.find(x=>x.id===101).expected_pay_date,null);f.db.close();
  });
  await test('Stale draft and export messages are cancelled when payroll advances',async()=>{
    const f=fixture();f.api.prepared(10);f.stage('exported');f.api.exported(10);const result=await f.api.tick();assert.equal(result.cancelled,2);assert.equal(result.queued,2);const email=[...f.queued.values()][0];assert.equal(f.hooks.payroll({},email),'');f.db.prepare("UPDATE payroll_batches SET status='acknowledged',external_ref='BANK-RESULT-001',acknowledged_at='2026-09-13T02:00:00Z'").run();assert.match(f.hooks.payroll({},email),/status changed/);assert.equal(f.api.exported(10).queued,0);f.db.close();
  });
  await test('Local enqueue failures retry after restart without rolling back payroll',async()=>{
    const f=fixture();f.stage('exported');f.fail(true);assert.equal(f.api.exported(10).ok,true);assert.equal((await f.api.tick()).retry,2);assert.equal(f.db.prepare('SELECT status FROM payroll_batches').get().status,'exported');f.fail(false);f.advance(15001);const restarted=Payroll(f.context,f.workflow);assert.equal((await restarted.tick()).queued,2);assert.equal((await restarted.tick()).queued,0);assert.equal(f.queued.size,2);f.db.close();
  });
  await test('Worker records contain only that worker and distinguish allocation from take-home pay',()=>{
    const f=fixture(),data=f.api.workerData(1);assert.deepEqual(data.lines.map(x=>x.id),[103,101]);assert.ok(!JSON.stringify(data).includes('Worker two private'));const line=data.lines.find(x=>x.id===101);assert.equal(line.allocation_amount,310.62);assert.match(line.allocation_label,/not take-home pay/);assert.equal(line.reviewed_components.gross_wages,240);assert.equal(data.provider_connected,false);assert.equal(data.payslips_connected,false);assert.deepEqual(f.api.workerData(3).lines,[]);f.db.close();
  });
  await test('Closed accounts and removed workers cannot receive queued payroll updates',async()=>{
    const f=fixture();f.api.prepared(10);await f.api.tick();const mail=f.queued.get('payroll:10:prepared:1');f.db.prepare("UPDATE users SET closed_at='2026-09-13' WHERE id=1").run();assert.match(f.hooks.payroll({},mail),/worker access ended/);f.db.prepare("DELETE FROM payroll_lines WHERE worker_id=2").run();assert.match(f.hooks.payroll({},f.queued.get('payroll:10:prepared:2')),/status changed/);f.db.close();
  });
  await test('Payroll email templates escape stored period values and omit financial details',async()=>{
    const f=fixture();f.db.prepare('UPDATE payroll_batches SET from_date=?').run('<img src=x onerror=bad>');f.api.prepared(10);await f.api.tick();const body=[...f.queued.values()][0][3];assert.ok(!body.includes('<img'));assert.match(body,/&lt;img/);assert.ok(!body.includes('310.62'));assert.ok(!body.includes('PAYROLL-CALC-101'));f.db.close();
  });
  console.log(`payroll notifications: ${results.filter(x=>x.result==='PASS').length}/${results.length} passed`);
  if(process.env.PAYROLL_NOTICE_RESULTS)require('node:fs').writeFileSync(process.env.PAYROLL_NOTICE_RESULTS,JSON.stringify({runtime:process.version,results},null,2));
  if(results.some(x=>x.result==='FAIL'))process.exitCode=1;
})();
