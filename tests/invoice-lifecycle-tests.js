'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(root+'/public/index.html','utf8'),Lifecycle=require('../lib/invoice-lifecycle'),results=[],databases=[];
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.stack);}}
function dialogHarness(src=source){
 const a=src.indexOf('window.askRemoval = function('),b=src.indexOf("document.addEventListener('click'",a),events={};let active=null,restored=0;
 const opener={focus(){restored++;}},document={activeElement:opener,body:{appendChild(d){active=d;}},createElement(){const fields={textarea:{value:'',focus(){document.activeElement=this;}},error:{textContent:''},cancel:{}};const form={querySelector(){return null;},querySelectorAll(){return [];}};return {fields,form,remove(){if(active===this)active=null;},addEventListener(k,fn){events[k]=fn;},querySelector(s){return s==='form'?form:s==='#rmReason'?fields.textarea:s==='#rmErr'?fields.error:s==='[data-rm-cancel]'?fields.cancel:null;}};}};
 const ctx={document,$:()=>active,esc:x=>String(x),Promise};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(src.slice(a,b),ctx);
 return {ctx,get active(){return active;},opener,get restored(){return restored;},events,open:()=>ctx.askRemoval({title:'Withdraw invoice INV-TEST',text:'Withdraw the selected invoice.',button:'Withdraw invoice'})};
}
function fixture(provider=async p=>({id:p.split('/')[4],status:'expired'})){
 const db=new DatabaseSync(':memory:');databases.push(db);db.exec(`CREATE TABLE bookings(id INTEGER PRIMARY KEY,invoice_no TEXT,claim_status TEXT,claim_ref TEXT,claimed_at TEXT,paid_at TEXT,pay_url TEXT,stripe_session TEXT,claim_hold INTEGER,hold_reason TEXT);
 CREATE TABLE invoice_snapshots(invoice_no TEXT PRIMARY KEY,data TEXT,created_at TEXT);CREATE TABLE invoice_payment_evidence(invoice_no TEXT,reference TEXT,amount REAL,state TEXT);
 CREATE TABLE erasures(kind TEXT,label TEXT);CREATE TABLE delivery_outbox(event_key TEXT PRIMARY KEY,recipient TEXT,payload TEXT,status TEXT,error TEXT,lease_until TEXT);
 CREATE TABLE finance_provider_events(event_id TEXT PRIMARY KEY,event_type TEXT,object_id TEXT,payment_intent TEXT,invoice_no TEXT,amount_cents INTEGER,currency TEXT,status TEXT DEFAULT 'needs-review',created_at TEXT,note TEXT);
 INSERT INTO bookings VALUES(1,'INV-TEST','claimed',NULL,NULL,NULL,'https://checkout.example.test/old','cs_fixture',0,'');`);
 const inv={invoice_no:'INV-TEST',participant:{id:7,name:'Example',email:'participant@example.test'},bill_to:['Original payer','payer@example.test'],payer_email:'payer@example.test',self:false,funding:'plan',booking_ids:[1],total:100,paid:0,balance:100,lines:[]};
 db.prepare('INSERT INTO delivery_outbox VALUES(?,?,?,?,?,NULL)').run('invoice:INV-TEST','payer@example.test','[]','queued','');
 const calls=[],c={db,now:()=>new Date().toISOString(),appUrl:'https://example.test',escHtml:x=>String(x),invoiceFor:no=>db.prepare('SELECT 1 FROM bookings WHERE invoice_no=?').get(no)?inv:null,recordErasure:(_kind,_id,label)=>db.prepare('INSERT INTO erasures VALUES(?,?)').run('invoice',label),stripeEnabled:()=>true,stripeRequest:async(...args)=>{calls.push(args);return provider(...args);},sendMail:(to,_s,_h,_b,_cta,_url,_r,_a,m)=>db.prepare('INSERT INTO delivery_outbox VALUES(?,?,?,?,?,NULL)').run(m.event_key,to,'[]','queued','')};
 const w={storeInvoice:i=>db.prepare('INSERT OR IGNORE INTO invoice_snapshots VALUES(?,?,?)').run(i.invoice_no,JSON.stringify(i),c.now()),drain:async()=>{}};
 const flow=Lifecycle(c,w);return {db,c,w,flow,calls,inv};
}
(async()=>{
 await test('The previous confirmation bug is reproducible: a missing focus variable prevents resolution',()=>{
  const old=process.env.INVOICE_BASELINE?fs.readFileSync(process.env.INVOICE_BASELINE,'utf8'):source.replace('  const previousFocus=document.activeElement;\n','').replace('let settled=false;\n    const close = v => { if(settled)return;settled=true;d.remove();resolve(v);try{previousFocus?.focus?.();}catch{} };','const close = v => { d.remove(); previousFocus?.focus?.(); resolve(v); };');
  const h=dialogHarness(old);h.open();h.active.fields.textarea.value='Synthetic reason long enough for withdrawal.';assert.throws(()=>h.active.form.onsubmit({preventDefault(){}}),/previousFocus/);
 });
 await test('The actual withdrawal dialog resolves with its reason and restores the invoking button',async()=>{
  const h=dialogHarness(),pending=h.open();h.active.fields.textarea.value='Synthetic test invoice should be withdrawn.';h.active.form.onsubmit({preventDefault(){}});const answer=await pending;assert.match(answer.reason,/Synthetic/);assert.equal(h.restored,1);assert.equal(h.active,null);
 });
 await test('Cancel and Escape settle cleanly without an invoice mutation',async()=>{
  for(const escape of [false,true]){const h=dialogHarness(),pending=h.open();if(escape)h.events.keydown({key:'Escape'});else h.active.fields.cancel.onclick();assert.equal(await pending,null);assert.equal(h.active,null);}
 });
 await test('Validation stays in the dialog; failed focus restoration cannot prevent submission',async()=>{
  const h=dialogHarness(),pending=h.open();h.active.fields.textarea.value='short';h.active.form.onsubmit({preventDefault(){}});assert.ok(h.active);assert.match(h.active.fields.error.textContent,/20/);h.opener.focus=()=>{throw Error('Detached element');};h.active.fields.textarea.value='Synthetic complete reason for withdrawal.';h.active.form.onsubmit({preventDefault(){}});assert.ok((await pending).reason);
 });
 await test('Opening another removal dialog settles the earlier promise',async()=>{
  const h=dialogHarness(),first=h.open(),second=h.open();assert.equal(await first,null);h.active.fields.cancel.onclick();assert.equal(await second,null);
 });
 await test('The actual invoice click handler waits for confirmation, submits once and reports the API outcome',async()=>{
  const h=dialogHarness(),handlers=[],calls=[],toasts=[];let renders=0;
  Object.assign(h.ctx,{API:{call:async(...args)=>{calls.push(args);return {lines:1,notice:'queued'};}},toast:s=>toasts.push(s),renderAdminPage:async()=>renders++});h.ctx.document.addEventListener=(_k,fn)=>handlers.push(fn);
  const a=source.lastIndexOf("document.addEventListener('click'",source.indexOf("const iw = e.target.closest('[data-inv-withdraw]')")),b=source.indexOf("document.addEventListener('change'",a);vm.runInContext(source.slice(a,b),h.ctx);
  const button={dataset:{invWithdraw:'INV-TEST'},disabled:false,setAttribute(){},removeAttribute(){}},event={target:{closest:s=>s==='[data-inv-withdraw]'?button:null}};
  const pending=handlers[0](event);assert.equal(calls.length,0);assert.equal(button.disabled,true);await handlers[0](event);h.active.fields.textarea.value='Synthetic withdrawal from the rendered control.';h.active.form.onsubmit({preventDefault(){}});await pending;assert.equal(calls.length,1);assert.equal(calls[0][0],'/admin/invoices/INV-TEST/withdraw');assert.equal(renders,1);assert.equal(button.disabled,false);assert.match(toasts[0],/Invoice withdrawn/);
 });
 await test('Withdrawal stores the original invoice, cancels queued demand and creates one original-payer notice',()=>{
  const x=fixture();x.flow.withdraw('INV-TEST',{name:'Synthetic admin'},'Synthetic withdrawal after inspecting the invoice.');assert.ok(x.flow.archived('INV-TEST').withdrawn);assert.equal(x.flow.archived('INV-TEST').balance,0);assert.equal(x.flow.unused('INV-TEST'),false);assert.equal(x.db.prepare('SELECT status FROM delivery_outbox WHERE event_key=?').get('invoice:INV-TEST').status,'cancelled');assert.equal(x.db.prepare('SELECT recipient FROM delivery_outbox WHERE event_key=?').get('invoice-withdrawal:INV-TEST').recipient,'payer@example.test');
 });
 await test('Notification queue failure rolls back withdrawal and holds together',()=>{
  const x=fixture();x.c.sendMail=()=>{throw Error('Synthetic queue failure');};assert.throws(()=>x.flow.withdraw('INV-TEST',{name:'Admin'},'A complete synthetic withdrawal reason.'),/queue failure/);assert.equal(x.flow.row('INV-TEST'),undefined);assert.equal(x.db.prepare('SELECT invoice_no FROM bookings WHERE id=1').get().invoice_no,'INV-TEST');assert.equal(x.db.prepare('SELECT status FROM delivery_outbox WHERE event_key=?').get('invoice:INV-TEST').status,'queued');
 });
 await test('Checkout expiration is requested and an already-expired session is confirmed by retrieval',async()=>{
  const x=fixture(async(p,_b,o)=>{if(!o)throw Error('Already expired');return {id:'cs_fixture',status:'expired'};});x.flow.withdraw('INV-TEST',{name:'Admin'},'A complete synthetic withdrawal reason.');await x.flow.drain();assert.equal(x.calls[0][0],'/v1/checkout/sessions/cs_fixture/expire');assert.equal(x.calls[1][2].method,'GET');assert.equal(x.db.prepare('SELECT state FROM checkout_cleanup').get().state,'closed');
 });
 await test('Provider failures retain a durable retry without undoing withdrawal',async()=>{
  const x=fixture(async()=>{throw Error('Synthetic outage');});x.flow.withdraw('INV-TEST',{name:'Admin'},'A complete synthetic withdrawal reason.');await x.flow.drain();const job=x.db.prepare('SELECT * FROM checkout_cleanup').get();assert.equal(job.state,'retry');assert.equal(job.attempts,1);assert.ok(x.flow.archived('INV-TEST'));assert.equal(x.db.prepare('SELECT claim_hold FROM bookings').get().claim_hold,1);
 });
 await test('Checkout completion racing withdrawal becomes reconciliation, not a new invoice payment',async()=>{
  const x=fixture(async()=>({id:'cs_fixture',status:'complete',amount_total:10000,currency:'aud'}));x.flow.withdraw('INV-TEST',{name:'Admin'},'A complete synthetic withdrawal reason.');await x.flow.drain();assert.equal(x.db.prepare('SELECT state FROM checkout_cleanup').get().state,'needs-review');assert.equal(x.db.prepare('SELECT status FROM finance_provider_events').get().status,'needs-review');assert.equal(x.db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,0);
 });
 await test('A late-created checkout after withdrawal is retired and never attached to a replacement invoice',async()=>{
  const x=fixture(async p=>({id:p.split('/')[4],status:'expired'}));x.flow.withdraw('INV-TEST',{name:'Admin'},'A complete synthetic withdrawal reason.');assert.equal(x.flow.attachCheckout('INV-TEST',{id:'cs_late',url:'https://checkout.example.test/late'}),false);await x.flow.drain();assert.equal(x.db.prepare("SELECT pay_url FROM bookings WHERE id=1").get().pay_url,null);assert.equal(x.db.prepare('SELECT state FROM checkout_cleanup WHERE session_id=?').get('cs_late').state,'closed');
 });
 await test('Partial-payment hooks remove stale full-value links and queue their closure',async()=>{
  const x=fixture();x.inv.paid=20;x.inv.balance=80;x.w.onInvoicePayment('INV-TEST');assert.equal(x.db.prepare('SELECT pay_url FROM bookings WHERE id=1').get().pay_url,'');assert.equal(x.flow.attachCheckout('INV-TEST',{id:'cs_new',url:'https://checkout.example.test/new'}),false);await x.flow.drain();assert.equal(x.db.prepare('SELECT count(*) n FROM checkout_cleanup').get().n,2);
 });
 await test('Late Stripe payment and refund events retain the withdrawn invoice reference for reconciliation',()=>{
  const x=fixture();x.db.exec('CREATE TABLE payroll_lines(id INTEGER PRIMARY KEY);');Object.assign(x.w,{now:x.c.now,parse:JSON.parse,hash:()=>''});require('../lib/process-finance')(x.c,x.w,{add(){},fail(){},tx:fn=>fn(),clean:(v,n)=>String(v||'').slice(0,n)});
  x.flow.withdraw('INV-TEST',{name:'Admin'},'A complete synthetic withdrawal reason.');
  x.w.recordStripePayment({id:'evt_late',type:'checkout.session.completed',data:{object:{id:'cs_fixture',metadata:{invoice_no:'INV-TEST'},payment_intent:'pi_late',payment_status:'paid',amount_total:10000,currency:'aud'}}});
  assert.equal(x.db.prepare("SELECT status FROM finance_provider_events WHERE event_id='evt_late'").get().status,'needs-review');assert.equal(x.db.prepare("SELECT invoice_no FROM stripe_payment_links WHERE payment_intent='pi_late'").get().invoice_no,'INV-TEST');assert.equal(x.db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,0);
  x.w.recordStripePayment({id:'evt_refund',type:'refund.created',data:{object:{id:'re_late',payment_intent:'pi_late',amount:10000,currency:'aud'}}});assert.equal(x.db.prepare("SELECT invoice_no FROM finance_provider_events WHERE event_id='evt_refund'").get().invoice_no,'INV-TEST');
 });
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));for(const db of databases)db.close();
 if(process.env.INVOICE_RESULTS)fs.writeFileSync(process.env.INVOICE_RESULTS,JSON.stringify({runtime:process.version,results},null,2));console.log(`invoice lifecycle: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
})();
