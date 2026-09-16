'use strict';
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const createStore=require('../lib/process-store');
const invoiceLinkMail=require('../lib/invoice-link-mail');
let tests=0;
async function test(name,fn){await fn();tests++;console.log('PASS '+name);}

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,closed_at TEXT,email TEXT,pm_email TEXT);
    CREATE TABLE support_plans(id INTEGER PRIMARY KEY);CREATE TABLE incidents(id INTEGER PRIMARY KEY);
    CREATE TABLE bookings(id INTEGER PRIMARY KEY,invoice_no TEXT,claim_status TEXT,paid_at TEXT,pay_url TEXT,total REAL,active_extra_total REAL,km_total REAL,status TEXT);
    INSERT INTO users VALUES(1,'participant',NULL,'participant@example.test','original-manager@example.test');
    INSERT INTO bookings VALUES(1,'INV-100','claimed',NULL,NULL,147.16,0,0,'completed');`);
  const sent=[],state={transportError:false,withdrawn:false,pdfError:false,missingInvoice:false,link:'https://example.test/pay/'+ 'a'.repeat(64),pdfCalls:0};
  const store=createStore({db,emailOn:()=>true,mailPrefs:()=>({}),baseUrl:()=> 'https://example.test',sendMailDirect:async(...args)=>{sent.push(args);if(state.transportError)throw Error('Synthetic transport outage');}});
  const original={invoice_no:'INV-100',payer_email:'original-manager@example.test',funding:'plan',participant:{id:1,name:'Original participant'},bill_to:['Original plan manager','original-manager@example.test'],lines:[{description:'Original approved support',qty:2,rate:73.58,amount:147.16}],total:147.16,paid:0,balance:147.16,due:'2026-10-01',due_date:'01/10/2026'};
  store.storeInvoice(original);
  const sourceSnapshot=db.prepare('SELECT data FROM invoice_snapshots').get().data;
  store.invoiceDeliveryInvalid=()=>state.withdrawn;
  store.paymentDeliveryInvalid=()=>state.withdrawn;
  const context={invoiceFor:no=>state.missingInvoice?null:store.invoiceSnapshot(no),paymentPageURL:()=>state.link,makeInvoicePdf:async inv=>{state.pdfCalls++;if(state.pdfError)throw Error('Synthetic PDF failure');return Buffer.from('%PDF-1.4\n'+JSON.stringify(inv));}};
  store.deliveryHooks.prepare=invoiceLinkMail(context);
  const row=key=>db.prepare('SELECT * FROM delivery_outbox WHERE event_key=?').get(key);
  const queue=(key='invoice:INV-100',metadata={},recipient='original-manager@example.test')=>store.enqueueMail([recipient,'Old invoice','Old heading','Pay by transfer: BSB 123-456 account 123456789','Old bank instructions','https://example.test/old', 'office@example.test',[{filename:'old.pdf',mime:'application/pdf',buffer:Buffer.from('%PDF-1.4\nBSB 123-456 account 123456789')}],{kind:'invoice',transactional:true,event_key:key,...metadata}]);
  const due=()=>db.exec("UPDATE delivery_outbox SET next_at='2000-01-01' WHERE status IN ('queued','retry')");
  return {db,store,state,context,sent,original,sourceSnapshot,row,queue,due};
}

(async()=>{
  await test('Old queued invoice body and PDF are replaced, retaining original payer and financial snapshot',async()=>{
    const x=fixture();await x.queue();
    const queued=x.row('invoice:INV-100');
    x.db.exec("UPDATE users SET pm_email='replacement-manager@example.test' WHERE id=1");
    assert.deepEqual(await x.store.drain(),{sent:1,failed:0});
    const mail=x.sent[0],pdf=mail[7][0].buffer.toString();
    assert.equal(mail[0],'original-manager@example.test');assert.equal(mail[6],'office@example.test');
    assert.equal(mail[5],x.state.link);assert.match(mail[3],/secure invoice link/);assert.doesNotMatch(mail[3],/123-456|123456789/);
    assert.doesNotMatch(pdf,/123-456|123456789|replacement-manager/);assert.match(pdf,/Original approved support/);assert.match(pdf,/147.16/);assert.match(pdf,/original-manager@example.test/);
    assert.equal(JSON.parse(pdf.slice(pdf.indexOf('\n')+1)).view_url,x.state.link);
    assert.equal(mail[7][0].filename,'INV-100.pdf');assert.equal(mail[8].event_key,queued.event_key+':invoice-link-v1');assert.equal(mail[8].invoice_link_source_event_key,queued.event_key);
    assert.equal(x.db.prepare('SELECT data FROM invoice_snapshots').get().data,x.sourceSnapshot);
    assert.equal(x.row('invoice:INV-100').id,queued.id);assert.equal(x.row('invoice:INV-100').status,'sent');
    await x.queue();await x.store.drain();assert.equal(x.sent.length,1);assert.equal(x.db.prepare('SELECT count(*) n FROM delivery_outbox').get().n,1);x.db.close();
  });
  await test('Transport retries keep identical prepared bytes and event identity after a balance change',async()=>{
    const x=fixture();await x.queue();x.state.transportError=true;
    assert.deepEqual(await x.store.drain(),{sent:0,failed:1});
    const retry=x.row('invoice:INV-100');assert.equal(retry.status,'retry');assert.doesNotMatch(retry.payload,/123-456|123456789/);
    const prepared=JSON.parse(retry.payload);assert.equal(prepared[8].invoice_link_mail_policy,'link-only-v1');
    x.db.exec("UPDATE bookings SET claim_status='paid',paid_at='2026-09-13' WHERE id=1");
    x.state.link='https://example.test/pay/'+ 'b'.repeat(64);x.state.transportError=false;x.due();
    assert.deepEqual(await x.store.drain(),{sent:1,failed:0});
    assert.deepEqual(x.sent[1],x.sent[0]);assert.equal(x.state.pdfCalls,1);assert.equal(x.row('invoice:INV-100').attempts,2);x.db.close();
  });
  await test('Previously attempted emails use one corrected-instructions transport key without replacing the logical invoice event',async()=>{
    const x=fixture();await x.queue();
    x.db.exec("UPDATE delivery_outbox SET status='retry',attempts=3,next_at='2000-01-01' WHERE event_key='invoice:INV-100'");
    const before=x.row('invoice:INV-100'),oldTransportKey=JSON.parse(before.payload)[8].event_key;
    x.state.transportError=true;await x.store.drain();
    const corrected=x.sent[0];assert.notEqual(corrected[8].event_key,oldTransportKey);assert.equal(corrected[8].event_key,oldTransportKey+':invoice-link-v1');
    assert.equal(corrected[8].invoice_link_source_event_key,before.event_key);assert.match(corrected[1],/Updated payment instructions/);assert.match(corrected[3],/invoice number and charges are unchanged/);
    assert.equal(x.row(before.event_key).id,before.id);assert.equal(x.row(before.event_key).event_key,before.event_key);
    x.state.transportError=false;x.due();await x.store.drain();assert.deepEqual(x.sent[1],corrected);
    assert.equal(x.db.prepare('SELECT count(*) n FROM delivery_outbox').get().n,1);assert.equal(x.db.prepare('SELECT count(*) n FROM invoice_snapshots').get().n,1);
    assert.equal(x.db.prepare('SELECT data FROM invoice_snapshots').get().data,x.sourceSnapshot);assert.equal(x.state.pdfCalls,1);x.db.close();
  });
  await test('A missing original invoice retries without sending the old payment instructions',async()=>{
    const x=fixture();await x.queue();x.state.missingInvoice=true;
    for(let attempt=0;attempt<6;attempt++){x.due();assert.deepEqual(await x.store.drain(),{sent:0,failed:1});assert.equal(x.row('invoice:INV-100').status,'retry');}
    assert.equal(x.sent.length,0);assert.match(x.row('invoice:INV-100').error,/original invoice snapshot/);
    x.state.missingInvoice=false;x.due();assert.deepEqual(await x.store.drain(),{sent:1,failed:0});assert.equal(x.sent.length,1);x.db.close();
  });
  await test('Unavailable or insecure invoice links retry without stale PDF delivery',async()=>{
    for(const link of ['',undefined,'javascript:alert(1)','http://example.test/pay/test','https://user:password@example.test/pay/test']){
      const x=fixture();await x.queue();x.state.link=link;assert.deepEqual(await x.store.drain(),{sent:0,failed:1});assert.equal(x.sent.length,0);assert.equal(x.state.pdfCalls,0);assert.match(x.row('invoice:INV-100').error,/secure invoice link/);x.db.close();
    }
  });
  await test('PDF preparation failure retains a retryable invoice and cannot send its old attachment',async()=>{
    const x=fixture();await x.queue();x.state.pdfError=true;assert.deepEqual(await x.store.drain(),{sent:0,failed:1});assert.equal(x.sent.length,0);assert.equal(x.row('invoice:INV-100').status,'retry');
    x.state.pdfError=false;x.due();await x.store.drain();assert.equal(x.sent.length,1);assert.doesNotMatch(x.sent[0][7][0].buffer.toString(),/123-456/);x.db.close();
  });
  await test('Already sent and cancelled emails remain unchanged and are never resent',async()=>{
    const x=fixture();await x.queue();await x.queue('invoice:INV-200');
    x.db.exec("UPDATE delivery_outbox SET status='sent',sent_at='2026-09-12' WHERE event_key='invoice:INV-100';UPDATE delivery_outbox SET status='cancelled' WHERE event_key='invoice:INV-200'");
    const before=x.db.prepare('SELECT * FROM delivery_outbox ORDER BY id').all();await x.store.drain();assert.deepEqual(x.db.prepare('SELECT * FROM delivery_outbox ORDER BY id').all(),before);assert.equal(x.sent.length,0);assert.equal(x.state.pdfCalls,0);x.db.close();
  });
  await test('Withdrawal cancels old invoice demands and retains the unchanged withdrawal notice',async()=>{
    const x=fixture();await x.queue();await x.queue('invoice-withdrawal:INV-100',{invoice_no:'INV-100',withdrawal_notice:true});x.state.withdrawn=true;
    await x.store.drain();assert.equal(x.row('invoice:INV-100').status,'cancelled');assert.equal(x.sent.length,1);assert.equal(x.sent[0][8].withdrawal_notice,true);assert.equal(x.sent[0][4],'Old bank instructions');assert.equal(x.state.pdfCalls,0);x.db.close();
  });
  await test('Withdrawal while PDF preparation runs still prevents the invoice from sending',async()=>{
    const x=fixture();x.context.makeInvoicePdf=async()=>{x.state.withdrawn=true;return Buffer.from('%PDF-1.4 safe');};await x.queue();await x.store.drain();assert.equal(x.sent.length,0);assert.equal(x.row('invoice:INV-100').status,'cancelled');x.db.close();
  });
  await test('An explicitly cancelled row cannot be resurrected by a preparation failure',async()=>{
    const x=fixture();x.context.makeInvoicePdf=async()=>{x.db.exec("UPDATE delivery_outbox SET status='cancelled',payload='[]' WHERE event_key='invoice:INV-100'");throw Error('Synthetic concurrent withdrawal');};await x.queue();await x.store.drain();assert.equal(x.sent.length,0);assert.equal(x.row('invoice:INV-100').status,'cancelled');x.db.close();
  });
  await test('Existing access-stamp protections still cancel revoked personal deliveries',async()=>{
    const x=fixture();await x.queue('invoice:INV-100',{},'participant@example.test');x.db.exec("UPDATE users SET email='changed@example.test' WHERE id=1");await x.store.drain();assert.equal(x.row('invoice:INV-100').status,'cancelled');assert.equal(x.sent.length,0);assert.equal(x.state.pdfCalls,0);x.db.close();
  });
  await test('Failed-payment reminders get the invoice link without stale bank instructions',async()=>{
    const x=fixture();await x.queue('payment-failed:evt_test',{payment_reminder:true,invoice_no:'INV-100'});await x.store.drain();assert.equal(x.sent.length,1);assert.equal(x.sent[0][5],x.state.link);assert.doesNotMatch(x.sent[0][3],/123-456|123456789/);assert.match(x.sent[0][1],/Payment needs attention/);assert.equal(x.sent[0][2],'Payment not completed');assert.match(x.sent[0][3],/was not completed/);assert.equal(x.sent[0][7].length,0);assert.equal(x.sent[0][8].event_key,'payment-failed:evt_test:invoice-link-v1');assert.equal(x.state.pdfCalls,0);x.db.close();
  });
  await test('Overdue reminders preserve their purpose and point to the current invoice balance',async()=>{
    const x=fixture();await x.queue('payment-reminder:INV-100:2026-10-02',{payment_reminder:true,invoice_no:'INV-100'});await x.store.drain();
    assert.equal(x.sent[0][2],'Invoice payment is due');assert.match(x.sent[0][3],/outstanding balance/);assert.match(x.sent[0][3],/current balance and due date/);assert.equal(x.sent[0][5],x.state.link);x.db.close();
  });
  await test('Receipt and unrelated notices retain their original content and attachments',async()=>{
    const x=fixture();await x.queue('payment-receipt:1',{payment_receipt:true,invoice_no:'INV-100'});await x.queue('booking:123');await x.store.drain();assert.equal(x.sent.length,2);for(const args of x.sent){assert.equal(args[4],'Old bank instructions');assert.match(args[7][0].buffer.toString(),/123-456/);assert.equal(args[8].invoice_link_mail_policy,undefined);}assert.equal(x.state.pdfCalls,0);x.db.close();
  });
  console.log('Invoice link mail: '+tests+' passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
