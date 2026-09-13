'use strict';
// Actual payment module, disposable SQLite records and injected providers only.
// No network connection, customer email or financial action is made by this suite.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const Payments = require('../lib/payment-automation');
const { createZaiClient } = require('../lib/zai-payments');
const fixtures = [], results = [];
const TX = '10000000-0000-4000-8000-000000000001';
const WALLET = '20000000-0000-4000-8000-000000000001';
const VA = '30000000-0000-4000-8000-000000000001';
const KEY = 'synthetic-test-only-webhook-key-12345678';

function fixture(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,name TEXT,email TEXT,plan TEXT,closed_at TEXT);
    INSERT INTO users VALUES(1,'participant','Private Participant One','payer1@example.test','self',NULL),(2,'participant','Private Participant Two','payer2@example.test','self',NULL),(99,'admin','Office','office@example.test','',NULL);
    CREATE TABLE bookings(id INTEGER PRIMARY KEY,participant_id INTEGER,status TEXT,approval_state TEXT,approval_source TEXT DEFAULT 'participant',approval_from TEXT,approved_by INTEGER DEFAULT 1,approved_at TEXT,query_at TEXT,query_note TEXT,voided INTEGER DEFAULT 0,invoice_no TEXT,stripe_session TEXT,pay_url TEXT);
    CREATE TABLE invoice_snapshots(invoice_no TEXT PRIMARY KEY,created_at TEXT);
    CREATE TABLE invoice_payment_evidence(id INTEGER PRIMARY KEY,invoice_no TEXT,amount REAL,reference TEXT UNIQUE,recorded_at TEXT,state TEXT,recorded_by INTEGER);
    CREATE TABLE checkout_cleanup(session_id TEXT PRIMARY KEY,invoice_no TEXT,next_at TEXT,updated_at TEXT,state TEXT NOT NULL DEFAULT 'queued');
    CREATE TABLE stripe_payment_links(payment_intent TEXT PRIMARY KEY,invoice_no TEXT,checkout_id TEXT);
    CREATE TABLE finance_provider_events(event_id TEXT PRIMARY KEY,event_type TEXT,object_id TEXT,payment_intent TEXT,invoice_no TEXT,amount_cents INTEGER,currency TEXT,status TEXT,created_at TEXT);
    CREATE TABLE delivery_outbox(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE,status TEXT,recipient TEXT);
  `);
  const records = new Map(), settings = new Map(), routes = [], sent = [], stripeRequests = [], providerReads = [];
  let clock = Date.now(), environment = options.environment || 'sandbox', seq = 0;
  const now = () => new Date(clock).toISOString();
  const getInvoice = no => {
    const inv = records.get(no); if (!inv) return null;
    const paid = Number(db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM invoice_payment_evidence WHERE invoice_no=? AND state='recorded'").get(no).amount);
    return { ...inv, paid, balance: Math.max(0, Math.round((inv.total - paid) * 100) / 100) };
  };
  const defaultReceipt = () => ({ provider:'zai',environment,received:true,providerTransactionId:TX,providerState:'successful',walletAccountId:WALLET,providerUserId:'fixture-payer',amountCents:31062,currency:'AUD',reference:'INV-1',status:'received_at_provider',settlementStatus:'not_confirmed',supplementaryStatus:'available' });
  const mockZai = {
    getStatus: () => ({enabled:true,configured:true,environment,missing:[]}),
    verifyWebhook: (raw, header) => {
      const env = {ZAI_ENABLED:'true',ZAI_ENVIRONMENT:environment,ZAI_CLIENT_ID:'fixture',ZAI_CLIENT_SECRET:'fixture',ZAI_SCOPE:'fixture',ZAI_WEBHOOK_SECRET:KEY};
      return createZaiClient({ env, fetch: () => { throw Error('Network forbidden in test'); }, now: () => clock }).verifyWebhook(raw,header);
    },
    fetchReceivedTransaction: async id => { providerReads.push({id,environment}); return options.receipt ? options.receipt(id,environment) : defaultReceipt(); },
    verifyAccountMapping: async ids => ({...ids,provider:'zai',environment,providerUserId:ids.userId,status:'active',active:true,bsb:'123456',accountNumber:'100000017',accountName:'The Care Web test'})
  };
  const c = {
    db, now, setting:(key,def)=>settings.has(key)?settings.get(key):def, setSetting:(key,value)=>settings.set(key,value),
    sign:value=>crypto.createHmac('sha256','synthetic-fixture-site-secret').update(value).digest('hex'),
    appUrl:'https://care.example.test', invoiceFor:getInvoice,production:options.production===true,
    invoiceFlow:{archived:getInvoice,cancelLinks:()=>{},wake:()=>{},drain:async()=>{if(options.cleanupOutage)return {failed:1};db.exec("UPDATE checkout_cleanup SET state='closed'");return {closed:true};}},
    actFor:(req,user,scope)=>!user||user.revoked?null:user.role==='participant'?{id:user.id}:user.grants?.includes(scope)?{id:user.participantId}:null,
    bankDetails:()=>{throw Error('Retired bank details must not be requested');},
    stripeEnabled:()=>options.stripeEnabled!==false,paytoEnabled:()=>true,stripeEnvironment:()=>options.stripeEnvironment||'test',
    stripeRequest:async(path,params,extra)=>{
      stripeRequests.push({path,params,extra});
      if(options.stripeRequest)return options.stripeRequest(path,params,extra);
      seq++;return {id:'cs_fixture_'+seq,url:'https://checkout.stripe.com/c/pay/cs_fixture_'+seq,currency:'aud',amount_total:params['line_items[0][price_data][unit_amount]'],payment_intent:'pi_fixture_'+seq};
    },
    ymd:()=>now().slice(0,10),escHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    sendMail:(...args)=>{const key=args[8]?.event_key;const existing=db.prepare('SELECT 1 FROM delivery_outbox WHERE event_key=?').get(key);if(existing)return;db.prepare("INSERT INTO delivery_outbox(event_key,status,recipient) VALUES(?,'queued',?)").run(key,args[0]);sent.push(args);},
    json:(res,status,data)=>{res.statusCode=status;res.data=data;return data;},
    route:(method,pattern,handler)=>routes.push({method,pattern,handler}),publicAPI:[],zaiClient:mockZai,
    reviewInvoice:async(inv,user,req,body)=>{db.prepare('UPDATE bookings SET approval_state=? WHERE invoice_no=?').run(body.action==='query'?'queried':'approved',inv.invoice_no);}
  };
  const w = {
    drain:async()=>{},
    recordPayment:(inv,user,input)=>{
      const old=db.prepare('SELECT * FROM invoice_payment_evidence WHERE reference=?').get(input.reference);
      if(old)return {duplicate:true,matched:old.invoice_no===inv.invoice_no&&old.amount===input.amount};
      if(input.amount<=0||input.amount>getInvoice(inv.invoice_no).balance)return {matched:false};
      db.prepare("INSERT INTO invoice_payment_evidence(invoice_no,amount,reference,recorded_at,state,recorded_by) VALUES(?,?,?,?,'recorded',?)").run(inv.invoice_no,input.amount,input.reference,now(),user.id);
      if(options.afterRecordPayment)options.afterRecordPayment({db,inv,input});
      w.onInvoicePayment?.(inv.invoice_no);
      return {matched:true};
    }
  };
  const api=Payments(c,w);
  function seed(no='INV-1',total=310.62,participantId=1,approval='approved') {
    records.set(no,{invoice_no:no,total,withdrawn:false,funding:'self',participant:{id:participantId,name:'Private Participant '+participantId},payer_email:'payer'+participantId+'@example.test',due:'2099-01-01',due_date:'1 January 2099',issued:now(),bill_to:['Secret address'],lines:[{date:now().slice(0,10),description:'Private disability diagnosis and support details',worker:'Private worker name',qty:3,unit:'hour',rate:103.54,amount:total}]});
    db.prepare('INSERT INTO invoice_snapshots VALUES(?,?)').run(no,now());
    db.prepare("INSERT INTO bookings(participant_id,status,approval_state,approved_at,invoice_no) VALUES(?,'completed',?,?,?)").run(participantId,approval,approval==='approved'?now():null,no);
    api.invoiceCreated(getInvoice(no));return getInvoice(no);
  }
  async function call(method,path,user={id:1,role:'participant'},body={}) {
    const route=routes.find(r=>r.method===method&&r.pattern.test(path));
    assert.ok(route,'Route must exist '+path);
    const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=value;}};
    await route.handler({method,headers:{}},res,path.match(route.pattern),user,body);return res;
  }
  function account(participantId=1,env=environment) {
    db.prepare('INSERT INTO payment_accounts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(participantId,env,'fixture-payer',WALLET,VA,'123456','100000017','Fixture receiving account','',now(),99);
  }
  function attempt(no='INV-1',state='ready',id='attempt-1',checkoutId='cs_fixture',intent='pi_fixture') {
    db.prepare('INSERT INTO payment_attempts(id,invoice_no,method,amount_cents,state,checkout_id,payment_intent,checkout_url,created_at,updated_at,next_at,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,no,'payto',Math.round(getInvoice(no).balance*100),state,checkoutId,intent,'https://checkout.stripe.com/c/pay/'+checkoutId,now(),now(),now(),api.fingerprint(no));
    db.prepare('INSERT OR IGNORE INTO stripe_payment_links VALUES(?,?,?)').run(intent,no,checkoutId);
  }
  function stripe(type='checkout.session.completed',changes={},eventChanges={}) {
    const isIntent=type.startsWith('payment_intent.');
    return {id:'evt_'+crypto.randomUUID(),type,livemode:false,created:Math.floor(clock/1000),data:{object:isIntent?{id:'pi_fixture',amount_received:31062,currency:'aud',status:'succeeded',metadata:{invoice_no:'INV-1'},...changes}:{id:'cs_fixture',payment_intent:'pi_fixture',amount_total:31062,currency:'aud',payment_status:'paid',metadata:{invoice_no:'INV-1'},...changes}},...eventChanges};
  }
  async function bankWebhook(tx=TX) {
    const raw=Buffer.from(JSON.stringify({transactions:{id:tx,amount:999999999,state:'successful'}}));
    const time=Math.floor(clock/1000),sig=crypto.createHmac('sha256',KEY).update(time+'.').update(raw).digest('base64url');
    const res={};await api.zaiWebhook({headers:{'webhooks-signature':`t=${time},v=${sig}`}},res,raw);return res;
  }
  const f={db,c,w,api,seed,call,account,attempt,stripe,bankWebhook,getInvoice,records,sent,stripeRequests,providerReads,environment:value=>{environment=value;},now,advance:ms=>{clock+=ms;},mockZai};fixtures.push(f);return f;
}
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:error.stack});console.error('FAIL '+name+' '+error.stack);}}

(async()=>{
await test('Payment token only exposes one redacted invoice and cannot approve a shift',async()=>{
  const f=fixture();f.seed();f.seed('INV-2',100,2);const token=f.api.invoiceUrl('INV-1').split('/').pop();
  const result=await f.call('GET','/api/payments/public/'+token,null);assert.equal(result.statusCode,200);assert.equal(result.data.invoice_no,'INV-1');
  const encoded=JSON.stringify(result.data);assert.ok(!encoded.includes('Private Participant'));assert.ok(!encoded.includes('Private disability'));assert.ok(!encoded.includes('Secret address'));assert.ok(!encoded.includes('Private worker'));assert.equal(result.data.can_review,false);assert.equal(result.data.pdf_url,null);assert.equal(result.headers['referrer-policy'],'no-referrer');
  assert.equal((await f.call('GET','/api/payments/public/'+'0'.repeat(64),null)).statusCode,404);
});
await test('Revoked or unrelated helpers cannot read invoices; permissions split review from payment',async()=>{
  const f=fixture();f.seed();const path='/api/payments/invoices/INV-1';
  assert.equal((await f.call('GET',path,{id:2,role:'participant'})).statusCode,404);
  assert.equal((await f.call('GET',path,{id:10,participantId:1,grants:['invoices'],revoked:true})).statusCode,404);
  const bookingsOnly={id:10,participantId:1,grants:['bookings']},payOnly={id:11,participantId:1,grants:['invoices']};
  const review=await f.call('GET',path,bookingsOnly);assert.equal(review.data.can_review,true);assert.equal(review.data.can_pay,false);
  const pay=await f.call('GET',path,payOnly);assert.equal(pay.data.can_review,false);assert.equal(pay.data.can_pay,true);
  assert.equal((await f.call('POST',path+'/review',payOnly,{confirm:true,fingerprint:f.api.fingerprint('INV-1'),action:'approve'})).statusCode,403);
});
await test('Unapproved and queried invoices cannot open checkout or show bank instructions',async()=>{
  const f=fixture();f.seed('INV-1',310.62,1,'pending');const token=f.api.invoiceUrl('INV-1').split('/').pop();
  assert.equal((await f.call('GET','/api/payments/public/'+token,null)).data.bank,null);
  assert.equal((await f.call('POST','/api/payments/public/'+token+'/checkout',null)).statusCode,409);
  f.db.exec("UPDATE bookings SET approval_state='queried'");assert.equal((await f.call('POST','/api/payments/invoices/INV-1/checkout')).statusCode,409);assert.equal(f.stripeRequests.length,0);
});
await test('Repeated checkout clicks create a single correctly priced provider request',async()=>{
  const f=fixture();f.seed();const outcomes=await Promise.all([f.call('POST','/api/payments/invoices/INV-1/checkout'),f.call('POST','/api/payments/invoices/INV-1/checkout')]);
  assert.ok(outcomes.every(o=>[200,202].includes(o.statusCode)));assert.equal(f.stripeRequests.length,1);
  assert.equal(f.stripeRequests[0].params['line_items[0][price_data][unit_amount]'],31062);assert.ok(f.stripeRequests[0].extra.idempotencyKey);
});
await test('Duplicate checkout and intent confirmations produce one receipt and one email',async()=>{
  const f=fixture();f.seed();f.attempt();const event=f.stripe();f.api.recordStripePayment(event);f.api.recordStripePayment(event);f.api.recordStripePayment(f.stripe('payment_intent.succeeded'));await f.api.tick();
  assert.equal(f.getInvoice('INV-1').paid,310.62);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_transfers').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,1);assert.equal(f.sent.filter(x=>x[8].payment_receipt).length,1);
});
await test('Processing, failure and late success remain one payment and preserve approval',async()=>{
  const f=fixture();f.seed();f.attempt();f.api.recordStripePayment(f.stripe('checkout.session.completed',{payment_status:'unpaid'}));assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT state FROM payment_attempts').get().state,'processing');
  f.api.recordStripePayment(f.stripe('checkout.session.async_payment_failed'));assert.equal(f.db.prepare('SELECT state FROM payment_attempts').get().state,'failed');
  f.api.recordStripePayment(f.stripe('checkout.session.async_payment_succeeded'));f.api.recordStripePayment(f.stripe('checkout.session.async_payment_failed'));
  assert.equal(f.getInvoice('INV-1').paid,310.62);assert.equal(f.db.prepare('SELECT state FROM payment_attempts').get().state,'paid');assert.equal(f.api.state('INV-1').approved,true);
});
await test('Stale unpaid checkout snapshot cannot undo a later failed payment',async()=>{
  const f=fixture();f.seed();f.attempt();f.api.recordStripePayment(f.stripe('checkout.session.async_payment_failed',{}, {created:200}));f.api.recordStripePayment(f.stripe('checkout.session.completed',{payment_status:'unpaid'},{created:100}));
  assert.equal(f.db.prepare('SELECT state FROM payment_attempts').get().state,'failed');
});
await test('Wrong currency or checkout amount cannot credit an invoice',()=>{
  const f=fixture();f.seed();f.attempt();f.api.recordStripePayment(f.stripe('checkout.session.completed',{currency:'usd'}));f.api.recordStripePayment(f.stripe('checkout.session.completed',{amount_total:31063}));assert.equal(f.getInvoice('INV-1').paid,0);
});
await test('A live Stripe event cannot credit the configured test environment',()=>{
  const f=fixture({stripeEnvironment:'test'});f.seed();f.attempt();assert.throws(()=>f.api.recordStripePayment(f.stripe('checkout.session.completed',{}, {livemode:true})),/environment/);assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_transfers').get().n,0);
});
await test('A signed legacy deposit is provider-verified and retained for office reconciliation only',async()=>{
  const f=fixture();f.seed();f.account();assert.equal((await f.bankWebhook()).statusCode,200);await f.api.tick();assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT amount_cents FROM payment_transfers').get().amount_cents,31062);assert.equal(f.providerReads.length,1);
  const receipt=f.api.dashboard({}, {id:99,admin:true}).transfers[0];assert.equal(receipt.balance,310.62);assert.equal(receipt.status,'needs-matching');assert.equal(f.w.paymentOfficeTasks().length,1);assert.equal(f.sent.filter(x=>x[8].payment_receipt).length,0);
});
await test('Unsigned and non-deposit bank callbacks never credit the invoice',async()=>{
  const f=fixture({receipt:()=>({received:false,providerTransactionId:TX,providerState:'pending',reason:'not_a_confirmed_bank_deposit'})});f.seed();f.account();const res={};await f.api.zaiWebhook({headers:{}},res,Buffer.from(JSON.stringify({transactions:{id:TX}})));assert.equal(res.statusCode,400);await f.bankWebhook();await f.api.tick();assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_transfers').get().n,0);
});
await test('Legacy callback replay cannot duplicate money or overwrite its office allocation',async()=>{
  const f=fixture();f.seed();f.account();await f.bankWebhook();await f.api.tick();await f.bankWebhook();await f.api.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM payment_transfers').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_allocations').get().n,0);
  const receipt=f.db.prepare('SELECT * FROM payment_transfers').get();f.api.allocate(receipt,'INV-1',31062,99,'legacy-confirmation');await f.bankWebhook();await f.api.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM payment_transfers').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_allocations').get().n,1);assert.equal(f.sent.filter(x=>x[8].payment_receipt).length,1);assert.equal(f.getInvoice('INV-1').paid,310.62);
});
await test('Persisted sandbox jobs cannot be fetched after switching to live mode',async()=>{
  const f=fixture();f.seed();f.account();await f.bankWebhook();f.environment('live');await f.api.tick();assert.equal(f.providerReads.length,0);assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT state FROM payment_provider_jobs').get().state,'retry');
});
await test('An owner mismatch leaves the confirmed provider transaction unallocated',async()=>{
  const f=fixture();f.seed();f.account();f.db.exec("UPDATE payment_accounts SET provider_user_id='other-user'");await f.bankWebhook();await f.api.tick();assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT state FROM payment_provider_jobs').get().state,'retry');
});
await test('Same-value invoices and combined references are never matched by amount alone',()=>{
  const f=fixture();f.seed();f.seed('INV-2');
  for(const [id,reference] of [['unlabelled',''],['combined','INV-1 INV-2']]){const receipt=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:id,participantId:1,walletAccountId:WALLET,amountCents:31062,reference});f.api.autoAllocate(receipt);}
  assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.getInvoice('INV-2').paid,0);
});
await test('Partial transfers retain the exact balance and overpayments retain surplus money',()=>{
  const f=fixture();f.seed();const first=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'partial-1',participantId:1,walletAccountId:WALLET,amountCents:20000,reference:'INV-1'});f.api.autoAllocate(first);assert.equal(f.getInvoice('INV-1').balance,110.62);
  const second=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'overpay-1',participantId:1,walletAccountId:WALLET,amountCents:20000,reference:'INV-1'});f.api.autoAllocate(second);assert.equal(f.getInvoice('INV-1').balance,0);
  const total=f.db.prepare('SELECT sum(amount_cents) n FROM payment_allocations WHERE transfer_id=?').get(second.id).n;assert.equal(20000-total,8938);assert.equal(f.db.prepare('SELECT status FROM payment_transfers WHERE id=?').get(second.id).status,'part-matched');
});
await test('Duplicate transfer identity with changed amount cannot be recorded again',()=>{
  const f=fixture();f.seed();const input={provider:'zai',environment:'sandbox',providerTransactionId:'duplicate-1',participantId:1,walletAccountId:WALLET,amountCents:20000,reference:'INV-1'};f.api.receivedTransfer(input);assert.throws(()=>f.api.receivedTransfer({...input,amountCents:31062}));assert.equal(f.db.prepare('SELECT count(*) n FROM payment_transfers').get().n,1);
});
await test('Late payments on a withdrawn invoice remain unallocated and visible to office',()=>{
  const f=fixture();f.seed();f.records.get('INV-1').withdrawn=true;const receipt=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'late-1',participantId:1,walletAccountId:WALLET,amountCents:31062,reference:'INV-1'});f.api.autoAllocate(receipt);assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.w.paymentOfficeTasks().length,1);
});
await test('A failure during allocation rolls back evidence and retry records exactly one payment',async()=>{
  let crashed=false;const f=fixture({afterRecordPayment:()=>{if(!crashed){crashed=true;throw Error('Synthetic crash during payment allocation');}}});f.seed();const receipt=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'crash-1',participantId:1,walletAccountId:WALLET,amountCents:20000,reference:'INV-1'});assert.throws(()=>f.api.autoAllocate(receipt),/Synthetic crash/);assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_allocations').get().n,0);f.api.autoAllocate(receipt);await f.api.tick();assert.equal(f.getInvoice('INV-1').paid,200);assert.equal(f.db.prepare('SELECT sum(amount_cents) n FROM payment_allocations').get().n,20000);assert.equal(f.sent.filter(x=>x[8].payment_receipt).length,1);
});
await test('An existing payment evidence record repairs its missing allocation marker once',async()=>{
  const f=fixture();f.seed();const receipt=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'repair-1',participantId:1,walletAccountId:WALLET,amountCents:20000,reference:'INV-1'});f.db.prepare("INSERT INTO invoice_payment_evidence(invoice_no,amount,reference,recorded_at,state,recorded_by) VALUES('INV-1',200,?,?,'recorded',0)").run('transfer:'+receipt.id+':INV-1:0',f.now());await f.api.tick();f.api.autoAllocate(receipt);await f.api.tick();assert.equal(f.getInvoice('INV-1').paid,200);assert.equal(f.db.prepare('SELECT sum(amount_cents) n FROM payment_allocations').get().n,20000);assert.equal(f.sent.filter(x=>x[8].payment_receipt).length,1);
});
await test('A verified receipt with a later reference can recover automatic invoice matching',()=>{
  const f=fixture();f.seed();const input={provider:'zai',environment:'sandbox',providerTransactionId:'reference-retry',participantId:1,walletAccountId:WALLET,amountCents:31062,reference:''};f.api.autoAllocate(f.api.receivedTransfer(input));assert.equal(f.getInvoice('INV-1').paid,0);f.api.autoAllocate(f.api.receivedTransfer({...input,reference:'INV-1'}));assert.equal(f.getInvoice('INV-1').paid,310.62);
});
await test('Manual allocation cannot cross participants or exceed the unapplied receipt',async()=>{
  const f=fixture();f.seed();f.seed('INV-2',310.62,2);const receipt=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'manual-1',participantId:1,walletAccountId:WALLET,amountCents:10000,reference:''});assert.throws(()=>f.api.allocate(receipt,'INV-2',10000,99));assert.throws(()=>f.api.allocate(receipt,'INV-1',10001,99));assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.getInvoice('INV-2').paid,0);
});
await test('Retired account assignment requires admin authentication and never calls the provider',async()=>{
  const f=fixture();f.seed();let providerCalls=0;f.mockZai.verifyAccountMapping=async()=>{providerCalls++;throw Error('Retired provider write');};const path='/api/admin/payments/zai/accounts',body={participant_id:1,provider_user_id:'fixture-payer',wallet_account_id:WALLET,virtual_account_id:VA};
  assert.equal((await f.call('POST',path,null,body)).statusCode,403);assert.equal((await f.call('POST',path,{id:1,role:'participant'},body)).statusCode,403);
  const result=await f.call('POST',path,{id:99,admin:true},body);assert.equal(result.statusCode,410);assert.equal(result.data.payment_policy,'invoice-link-only');assert.match(result.data.error,/payment link/);assert.equal(providerCalls,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_accounts').get().n,0);
});
await test('Early intent confirmation is retried once its stored checkout mapping arrives',async()=>{
  const f=fixture();f.seed();const event=f.stripe('payment_intent.succeeded');assert.throws(()=>f.api.recordStripePayment(event),/stored payment request/);assert.equal(f.getInvoice('INV-1').paid,0);f.attempt();await f.api.tick();assert.equal(f.getInvoice('INV-1').paid,310.62);assert.equal(f.db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,1);assert.equal(f.db.prepare('SELECT state FROM payment_provider_jobs WHERE event_key=?').get('stripe:'+event.id).state,'complete');
});
await test('Repeated office allocation with one idempotency key records money only once',()=>{
  const f=fixture();f.seed();const transfer=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'manual-once',participantId:1,walletAccountId:WALLET,amountCents:20000,reference:''});f.api.allocate(transfer,'INV-1',5000,99,'same-request-123');assert.equal(f.api.allocate(transfer,'INV-1',5000,99,'same-request-123').duplicate,true);assert.equal(f.getInvoice('INV-1').paid,50);assert.throws(()=>f.api.allocate(transfer,'INV-1',6000,99,'same-request-123'));assert.equal(f.db.prepare('SELECT count(*) n FROM payment_allocations').get().n,1);
});
await test('Withdrawn payment links retain redacted history and disable every payment action',async()=>{
  const f=fixture();f.seed();const token=f.api.invoiceUrl('INV-1').split('/').pop();f.records.get('INV-1').withdrawn=true;
  const result=await f.call('GET','/api/payments/public/'+token,null);assert.equal(result.statusCode,200);assert.equal(result.data.status,'withdrawn');assert.equal(result.data.can_pay,false);assert.equal(result.data.bank,null);assert.equal(result.data.checkout_url,null);assert.equal((await f.call('POST','/api/payments/public/'+token+'/checkout',null)).statusCode,409);
});
await test('Revoked and expired bearer links cannot read invoice data',async()=>{
  const f=fixture();f.seed();const token=f.api.invoiceUrl('INV-1').split('/').pop();f.db.prepare('UPDATE payment_invoice_access SET revoked_at=?').run(f.now());assert.equal((await f.call('GET','/api/payments/public/'+token,null)).statusCode,404);f.db.prepare('UPDATE payment_invoice_access SET revoked_at=NULL,expires_at=?').run('2000-01-01T00:00:00Z');assert.equal((await f.call('GET','/api/payments/public/'+token,null)).statusCode,404);
});
await test('Review changes during checkout creation cancel the returned stale payment link',async()=>{
  let resolve;const gateway=new Promise(r=>{resolve=r;});const f=fixture({stripeRequest:()=>gateway});f.seed();
  const pending=f.call('POST','/api/payments/invoices/INV-1/checkout');await new Promise(r=>setImmediate(r));f.db.exec("UPDATE bookings SET approval_state='queried'");resolve({id:'cs_delayed',url:'https://checkout.stripe.com/c/pay/cs_delayed',currency:'aud',amount_total:31062,payment_intent:'pi_delayed'});const result=await pending;assert.equal(result.data.url,undefined);assert.equal(f.db.prepare('SELECT state FROM payment_attempts').get().state,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM checkout_cleanup WHERE session_id=?').get('cs_delayed').n,1);
});
await test('A sandbox transfer cannot be manually allocated after switching the provider to live',()=>{
  const f=fixture();f.seed();const transfer=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'inactive-env',participantId:1,walletAccountId:WALLET,amountCents:10000,reference:''});f.environment('live');assert.throws(()=>f.api.allocate(transfer,'INV-1',10000,99,'sandbox-transfer'));assert.equal(f.getInvoice('INV-1').paid,0);
});
await test('Partial provider refund creates a clear finance task with its refunded amount and no automatic reversal',()=>{
  const f=fixture();f.seed();f.attempt();f.api.recordStripePayment(f.stripe());
  const refund={id:'evt_partial_refund',type:'charge.refunded',livemode:false,data:{object:{id:'ch_fixture',payment_intent:'pi_fixture',amount:31062,amount_refunded:5000,currency:'aud'}}};
  f.api.recordStripePayment(refund);f.api.recordStripePayment(refund);
  assert.equal(f.getInvoice('INV-1').paid,310.62);assert.equal(f.db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,1);
  const row=f.db.prepare('SELECT * FROM finance_provider_events WHERE event_id=?').get(refund.id);assert.equal(row.amount_cents,5000);assert.equal(row.status,'needs-review');
  const tasks=f.w.paymentOfficeTasks().filter(t=>t.id===refund.id);assert.equal(tasks.length,1);assert.match(tasks[0].label,/refund/);assert.match(tasks[0].detail,/cumulative refunded 50.00 AUD/);assert.equal(tasks[0].dest,'#/journey?panel=finance');
  assert.ok(f.api.dashboard({}, {id:99,admin:true}).exceptions.some(t=>t.id===refund.id));
});
await test('Failed refunds and disputes appear in office actions until finance records its review',()=>{
  const f=fixture();f.seed();f.attempt();f.api.recordStripePayment(f.stripe());
  const failure={id:'evt_failed_refund',type:'refund.failed',livemode:false,data:{object:{id:'re_fixture',payment_intent:'pi_fixture',amount:5000,currency:'aud',status:'failed'}}};
  const dispute={id:'evt_dispute',type:'charge.dispute.created',livemode:false,data:{object:{id:'dp_fixture',payment_intent:'pi_fixture',amount:31062,currency:'aud',status:'needs_response'}}};
  f.api.recordStripePayment(failure);f.api.recordStripePayment(dispute);assert.match(f.w.paymentOfficeTasks().find(t=>t.id===failure.id).label,/failed refund/);assert.match(f.w.paymentOfficeTasks().find(t=>t.id===dispute.id).label,/dispute/);
  assert.equal(f.getInvoice('INV-1').paid,310.62);f.db.prepare("UPDATE finance_provider_events SET status='reviewed' WHERE event_id=?").run(dispute.id);f.api.recordStripePayment(dispute);assert.ok(!f.w.paymentOfficeTasks().some(t=>t.id===dispute.id));assert.ok(f.w.paymentOfficeTasks().some(t=>t.id===failure.id));
});
await test('Refund arriving before checkout mapping stays visible and later links to the right invoice',()=>{
  const f=fixture();f.seed();const refund={id:'evt_early_refund',type:'refund.created',livemode:false,data:{object:{id:'re_early',payment_intent:'pi_fixture',amount:5000,currency:'aud',status:'pending'}}};f.api.recordStripePayment(refund);assert.ok(f.w.paymentOfficeTasks().find(t=>t.id===refund.id).label.includes('invoice needs matching'));
  f.attempt();f.api.recordStripePayment(f.stripe());const review=f.w.paymentOfficeTasks().find(t=>t.id===refund.id);assert.equal(review.invoice_no,'INV-1');assert.ok(review.label.includes('INV-1'));assert.equal(f.getInvoice('INV-1').paid,310.62);
});
await test('Retired assignment cannot change any existing receiving-account history',async()=>{
  const f=fixture();f.seed();f.account();const before=f.db.prepare('SELECT * FROM payment_accounts').get();const other='30000000-0000-4000-8000-000000000002';const result=await f.call('POST','/api/admin/payments/zai/accounts',{id:99,admin:true},{participant_id:1,provider_user_id:'fixture-payer',wallet_account_id:WALLET,virtual_account_id:other});assert.equal(result.statusCode,410);assert.deepEqual(f.db.prepare('SELECT * FROM payment_accounts').get(),before);
});
await test('Switching payment method closes the old checkout before offering the replacement',async()=>{
  const f=fixture();f.seed();const first=await f.call('POST','/api/payments/invoices/INV-1/checkout',{id:1,role:'participant'},{method:'card'});assert.equal(first.statusCode,200);
  const second=await f.call('POST','/api/payments/invoices/INV-1/checkout',{id:1,role:'participant'},{method:'payto'});assert.equal(second.statusCode,200);assert.notEqual(first.data.url,second.data.url);assert.equal(f.stripeRequests.length,2);assert.equal(f.stripeRequests[1].params['payment_method_types[0]'],'payto');assert.equal(f.db.prepare('SELECT state FROM checkout_cleanup WHERE session_id=?').get('cs_fixture_1').state,'closed');assert.equal(f.db.prepare("SELECT count(*) n FROM payment_attempts WHERE state='ready'").get().n,1);
});
await test('A provider closure outage prevents a second payable checkout',async()=>{
  const f=fixture({cleanupOutage:true});f.seed();assert.equal((await f.call('POST','/api/payments/invoices/INV-1/checkout',{id:1,role:'participant'},{method:'card'})).statusCode,200);
  const second=await f.call('POST','/api/payments/invoices/INV-1/checkout',{id:1,role:'participant'},{method:'payto'});assert.equal(second.statusCode,202);assert.equal(second.data.url,undefined);assert.equal(f.stripeRequests.length,1);assert.equal(f.db.prepare('SELECT state FROM checkout_cleanup').get().state,'queued');
});
await test('Every payer invoice API and PDF bank adapter suppress stored accounts and fallback bank details',async()=>{
  for(const environment of ['sandbox','live'])for(const stripeEnabled of [true,false]){
    const f=fixture({production:true,environment,stripeEnabled});f.seed();f.account();f.db.exec("UPDATE payment_accounts SET payid='old-payid@example.test'");
    for(const funding of ['self','private','plan']){
      f.records.get('INV-1').funding=funding;const token=f.api.invoiceUrl('INV-1').split('/').pop();
      assert.equal(f.api.bankForInvoice(f.getInvoice('INV-1')),null);
      for(const path of ['/api/payments/invoices/INV-1','/api/payments/public/'+token]){
        const result=await f.call('GET',path);assert.equal(result.statusCode,200);assert.equal(result.data.bank,null);assert.equal(result.data.payment_policy,'invoice-link-only');
        assert.doesNotMatch(JSON.stringify(result.data),/123456|100000017|old-payid@example\.test|automatically_tracked/);
      }
    }
  }
});
await test('Old unpaid invoices and unallocated money remain visible beyond 250 newer closed records',()=>{
  const f=fixture();f.seed('INV-OLD-DUE',50);f.db.prepare('UPDATE invoice_snapshots SET created_at=? WHERE invoice_no=?').run('2000-01-01T00:00:00Z','INV-OLD-DUE');
  const oldReceipt=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'old-unallocated',participantId:1,walletAccountId:WALLET,amountCents:5000,reference:''});
  for(let i=0;i<260;i++){
    const no='INV-HISTORY-'+String(i).padStart(3,'0');f.seed(no,1);
    const transfer=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'history-'+i,participantId:1,walletAccountId:WALLET,amountCents:100,reference:no});
    const ref='transfer:'+transfer.id+':'+no+':0';
    f.db.prepare("INSERT INTO invoice_payment_evidence(invoice_no,amount,reference,recorded_at,state,recorded_by) VALUES(?,1,?,?,'recorded',0)").run(no,ref,f.now());
    f.db.prepare('INSERT INTO payment_allocations(transfer_id,invoice_no,amount_cents,reference,actor_id,created_at) VALUES(?,?,100,?,0,?)').run(transfer.id,no,ref,f.now());
    f.db.prepare("UPDATE payment_transfers SET status='matched' WHERE id=?").run(transfer.id);
  }
  const dashboard=f.api.dashboard({}, {id:99,admin:true});assert.equal(dashboard.invoices.length,251);assert.equal(dashboard.transfers.length,251);
  assert.equal(dashboard.invoices.find(i=>i.invoice_no==='INV-OLD-DUE').balance,50);assert.equal(dashboard.transfers.find(t=>t.id===oldReceipt.id).balance,50);
  const closedInvoiceCount=dashboard.invoices.filter(i=>i.balance===0).length;assert.equal(closedInvoiceCount,250);assert.equal(dashboard.transfers.filter(t=>t.status==='matched').length,250);
});
await test('Every unresolved provider event stays visible beyond 100 newer exceptions',()=>{
  const f=fixture();f.seed();f.db.prepare("INSERT INTO finance_provider_events(event_id,event_type,invoice_no,amount_cents,currency,status,created_at) VALUES('evt_old_open','charge.dispute.created','INV-1',31062,'aud','needs-review','2000-01-01T00:00:00Z')").run();
  for(let i=0;i<120;i++)f.db.prepare("INSERT INTO finance_provider_events(event_id,event_type,invoice_no,amount_cents,currency,status,created_at) VALUES(?,'refund.failed','INV-1',100,'aud','needs-review',?)").run('evt_new_open_'+i,f.now());
  const tasks=f.w.paymentOfficeTasks(),dashboard=f.api.dashboard({}, {id:99,admin:true});assert.equal(tasks.filter(t=>t.status==='needs-review').length,121);assert.equal(dashboard.exceptions.filter(t=>t.status==='needs-review').length,121);assert.ok(tasks.some(t=>t.id==='evt_old_open'));assert.ok(dashboard.exceptions.some(t=>t.id==='evt_old_open'));
});
await test('Unavailable Stripe and failed payment emails never offer bank-transfer fallback',async()=>{
  const offline=fixture({stripeEnabled:false});offline.seed();offline.account();
  const token=offline.api.invoiceUrl('INV-1').split('/').pop();
  for(const path of ['/api/payments/invoices/INV-1/checkout','/api/payments/public/'+token+'/checkout']){
    const result=await offline.call('POST',path);assert.equal(result.statusCode,409);assert.match(result.data.error,/invoice link/);assert.doesNotMatch(result.data.error,/bank details|transfer|PayID/i);
  }
  assert.equal(offline.stripeRequests.length,0);assert.equal(offline.providerReads.length,0);
  const connected=fixture();connected.seed();connected.attempt();connected.api.recordStripePayment(connected.stripe('checkout.session.async_payment_failed'));
  const mail=connected.sent.find(x=>x[8].event_key.startsWith('payment-failed:'));assert.ok(mail);assert.match(mail[3],/invoice link/);assert.doesNotMatch(mail[3],/bank details|transfer|PayID/i);assert.equal(mail[5],connected.api.invoiceUrl('INV-1'));
  assert.equal((await connected.call('POST','/api/payments/invoices/INV-1/checkout',{id:1,role:'participant'},{method:'bank_transfer'})).statusCode,400);
});
await test('Stale Zai configuration alone cannot accept callbacks, queue jobs or fetch deposits',async()=>{
  const f=fixture();f.seed();assert.equal((await f.bankWebhook()).statusCode,410);
  const probe={};await f.api.zaiWebhook({headers:{}},probe,Buffer.from(JSON.stringify({message:'Zai callback test'})));assert.equal(probe.statusCode,410);
  await f.api.tick();assert.equal(f.providerReads.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_provider_jobs').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_transfers').get().n,0);
});
await test('An already queued legacy confirmation is preserved without inventing an account assignment',async()=>{
  const f=fixture();f.seed();f.db.prepare("INSERT INTO payment_provider_jobs(event_key,provider,payload,next_at,created_at) VALUES(?,'zai',?,?,?)").run('pre-retirement-job',JSON.stringify({environment:'sandbox',transactionId:TX}),f.now(),f.now());
  await f.api.tick();assert.equal(f.providerReads.length,1);assert.equal(f.db.prepare('SELECT state FROM payment_provider_jobs').get().state,'complete');const receipt=f.db.prepare('SELECT * FROM payment_transfers').get();assert.equal(receipt.participant_id,null);assert.equal(receipt.amount_cents,31062);assert.equal(receipt.status,'needs-matching');assert.equal(f.getInvoice('INV-1').paid,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_accounts').get().n,0);
  assert.equal((await f.bankWebhook('10000000-0000-4000-8000-000000000002')).statusCode,410);await f.api.tick();assert.equal(f.providerReads.length,1);
});
await test('Disabling old provider credentials preserves pending confirmations as visible exceptions',async()=>{
  const f=fixture();f.seed();f.account();await f.bankWebhook();f.mockZai.getStatus=()=>({enabled:false,configured:false,environment:'sandbox',missing:['ZAI_CLIENT_SECRET']});await f.api.tick();assert.equal(f.providerReads.length,0);const job=f.db.prepare('SELECT * FROM payment_provider_jobs').get();assert.equal(job.state,'retry');assert.match(job.error,/Historical bank payment/);assert.ok(f.api.dashboard({}, {id:99,admin:true}).exceptions.some(e=>e.id===job.event_key));assert.equal(f.db.prepare('SELECT count(*) n FROM payment_accounts').get().n,1);
});
await test('Dashboard exposes only Stripe setup while retaining historical receipts and allocations exactly',async()=>{
  const f=fixture();f.seed();f.account();const receipt=f.api.receivedTransfer({provider:'zai',environment:'sandbox',providerTransactionId:'retained-history',participantId:1,walletAccountId:WALLET,amountCents:10000,reference:'INV-1'});f.api.allocate(receipt,'INV-1',5000,99,'historic-allocation');
  const before={accounts:f.db.prepare('SELECT * FROM payment_accounts').all(),transfers:f.db.prepare('SELECT * FROM payment_transfers').all(),allocations:f.db.prepare('SELECT * FROM payment_allocations').all(),evidence:f.db.prepare('SELECT * FROM invoice_payment_evidence').all()};
  await f.api.tick();const data=f.api.dashboard({}, {id:99,admin:true});assert.deepEqual(Object.keys(data.providers),['stripe']);assert.equal(data.accounts,undefined);assert.equal(data.payment_policy,'invoice-link-only');assert.equal(data.transfers[0].allocated,50);assert.equal(data.transfers[0].balance,50);assert.equal(data.invoices[0].paid,50);assert.equal(data.invoices[0].bank,null);
  assert.deepEqual({accounts:f.db.prepare('SELECT * FROM payment_accounts').all(),transfers:f.db.prepare('SELECT * FROM payment_transfers').all(),allocations:f.db.prepare('SELECT * FROM payment_allocations').all(),evidence:f.db.prepare('SELECT * FROM invoice_payment_evidence').all()},before);
});

// Flush scheduled wake callbacks while fixture databases remain open.
await new Promise(resolve=>setImmediate(resolve));
await Promise.all(fixtures.map(f=>f.api.tick()));
await new Promise(resolve=>setImmediate(resolve));
for(const f of fixtures)f.db.close();
if(process.env.PAYMENT_AUTOMATION_RESULTS)require('node:fs').writeFileSync(process.env.PAYMENT_AUTOMATION_RESULTS,JSON.stringify({runtime:process.version,results},null,2));
console.log(`payment automation: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);
if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
