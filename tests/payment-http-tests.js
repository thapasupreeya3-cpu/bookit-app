'use strict';
// Real HTTP routes, disposable accounts, and a loopback Stripe stand-in only.
// The child process has no live credentials and refuses non-loopback requests.
process.env.TZ='Australia/Sydney';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..'),DIR=fs.mkdtempSync(path.join(os.tmpdir(),'careweb-payment-http-'));
const results=[],requests=[],sessions=new Map(),byKey=new Map(),stamp=new Date().toISOString();
const password='Copper-Rainstorm!82',webhookSecret='whsec_synthetic_http_fixture_only',stripeKey='sk_test_synthetic_http_fixture_only';
let child,db,stub,base,log='',participant,other,helper,worker,admin,bookingId,invoiceNo,token,checkout,successfulEvent;
const ins=(table,values)=>Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
async function request(method,url,options={}){
  const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(options.origin===false?{}:{Origin:base}),...(options.cookie?{Cookie:options.cookie}:{}),...(options.forId?{'X-Bookit-For':String(options.forId)}:{}),...options.headers},body:options.raw??(options.body===undefined?undefined:JSON.stringify(options.body)),redirect:'manual'});
  const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(bytes);}catch{}
  return {status:response.status,data,bytes,text:bytes.toString(),cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
function ok(response,status=200){assert.equal(response.status,status,JSON.stringify(response.data)||response.text.slice(0,200));return response.data;}
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:error.stack});console.error('FAIL '+name+' '+error.stack);}}
async function register(label){
  const response=await request('POST','/api/register',{body:{role:'participant',name:'Synthetic Private '+label,email:label+'@example.test',password,suburb:'Ryde NSW',plan:'self',terms_accepted:true,terms_version:/const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT+'/server.js','utf8'))[1]}});
  const data=ok(response);return {id:data.user.id,cookie:response.cookie,email:label+'@example.test',name:'Synthetic Private '+label};
}
async function waitFor(fn){for(let n=0;n<100;n++){const value=fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('The expected automatic payment update did not finish.');}
function stripeEvent(type='checkout.session.completed'){
  const session=sessions.get(checkout.id),intent=type.startsWith('payment_intent.');
  return {id:'evt_http_'+crypto.randomUUID().replace(/-/g,''),type,livemode:false,created:Math.floor(Date.now()/1000),data:{object:intent?{id:session.payment_intent,status:'succeeded',amount_received:session.amount_total,currency:'aud',metadata:session.metadata}:{...session,payment_status:'paid',status:'complete'}}};
}
async function webhook(event,bad=false){
  const raw=JSON.stringify(event),time=Math.floor(Date.now()/1000),signature=crypto.createHmac('sha256',webhookSecret).update(time+'.'+raw).digest('hex');
  return request('POST','/api/stripe/webhook',{raw,origin:false,headers:{'Stripe-Signature':`t=${time},v1=${bad?'0'.repeat(64):signature}`}});
}
async function splitWebhook(event,bad=false){
  const bytes=Buffer.from(JSON.stringify(event)),marker=Buffer.from('é'),offset=bytes.indexOf(marker);
  assert.ok(offset>=0,'Fixture must contain a multibyte character');
  const split=offset+1;assert.equal(bytes[split-1],0xc3);assert.equal(bytes[split],0xa9);
  const time=Math.floor(Date.now()/1000),signature=crypto.createHmac('sha256',webhookSecret).update(time+'.').update(bytes).digest('hex');
  return new Promise((resolve,reject)=>{
    // Without Content-Length, these writes form distinct HTTP chunks. The first
    // ends between the two UTF-8 bytes of é, reproducing raw += chunk corruption.
    const req=http.request(base+'/api/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${time},v1=${bad?'0'.repeat(64):signature}`}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let data;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,data,text});});res.on('error',reject);
    });
    req.on('error',reject);req.write(bytes.subarray(0,split));setImmediate(()=>req.end(bytes.subarray(split)));
  });
}
(async()=>{try{
  stub=http.createServer((req,res)=>{
    let body='';req.on('data',part=>body+=part);req.on('end',()=>{
      try{
        const params=new URLSearchParams(body);requests.push({method:req.method,path:req.url,params:Object.fromEntries(params),idempotency:req.headers['idempotency-key']||''});
        assert.equal(req.headers.authorization,'Bearer '+stripeKey);
        let result;
        if(req.method==='POST'&&req.url==='/v1/checkout/sessions'){
          const key=req.headers['idempotency-key'];assert.ok(key);assert.equal(params.get('mode'),'payment');assert.equal(params.get('line_items[0][price_data][currency]'),'aud');
          result=byKey.get(key);
          if(!result){const id='cs_test_http_'+(sessions.size+1);result={id,url:'https://checkout.stripe.com/c/pay/'+id,currency:'aud',amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),payment_intent:'pi_test_http_'+(sessions.size+1),status:'open',payment_status:'unpaid',metadata:{invoice_no:params.get('metadata[invoice_no]'),careweb_attempt:params.get('metadata[careweb_attempt]')}};sessions.set(id,result);byKey.set(key,result);}
        }else{
          const match=/^\/v1\/checkout\/sessions\/(cs_test_http_\d+)(?:\/expire)?$/.exec(req.url);assert.ok(match,'Unexpected provider request '+req.method+' '+req.url);result=sessions.get(match[1]);assert.ok(result);
          if(req.url.endsWith('/expire')&&result.status!=='complete')result.status='expired';
        }
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
      }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}
    });
  });
  await new Promise(resolve=>stub.listen(0,'127.0.0.1',resolve));
  const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));base='http://127.0.0.1:'+port;
  const guard=path.join(DIR,'loopback-only.js');
  fs.writeFileSync(guard,`'use strict';
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic HTTP test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
`);
  child=spawn(process.execPath,['--no-warnings','--require',guard,'server.js'],{cwd:ROOT,env:{PATH:process.env.PATH,PORT:String(port),BIND_HOST:'127.0.0.1',APP_URL:base,DB_PATH:DIR+'/test.db',DOCS_DIR:DIR+'/docs',PHOTOS_DIR:DIR+'/photos',SECRET_FILE:DIR+'/secret',SEED_DEMO:'on',AUTO_REPLY:'off',TZ:'Australia/Sydney',ADMIN_MFA_REQUIRED:'off',STRIPE_API_URL:'http://127.0.0.1:'+stub.address().port,STRIPE_SECRET_KEY:stripeKey,STRIPE_WEBHOOK_SECRET:webhookSecret,STRIPE_PAYTO_ENABLED:'true',BANK_DETAILS:'Account name: Retired fixture bank; BSB: 654321; Account number: 76543210',ZAI_ENABLED:'true',ZAI_ENVIRONMENT:'sandbox',ZAI_CLIENT_ID:'retired-http-fixture',ZAI_CLIENT_SECRET:'retired-http-fixture',ZAI_SCOPE:'retired-http-fixture',ZAI_WEBHOOK_SECRET:'retired-http-fixture-signing-secret-12345678'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/version')).ok)break;}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(resolve=>setTimeout(resolve,100));}
  db=new DatabaseSync(DIR+'/test.db');db.exec('PRAGMA busy_timeout=5000');
  participant=await register('http-payment-owner');other=await register('http-payment-other');helper=await register('http-payment-helper');
  admin=await register('http-payment-admin');db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(admin.id);
  ins('payment_accounts',{participant_id:participant.id,environment:'sandbox',provider_user_id:'retired-fixture-user',wallet_account_id:'20000000-0000-4000-8000-000000000001',virtual_account_id:'30000000-0000-4000-8000-000000000001',bsb:'123456',account_number:'100000017',account_name:'Retired mapped account',payid:'retired-bank@example.test',verified_at:stamp,verified_by:admin.id});
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id);
  const linkId=ins('account_links',{participant_id:participant.id,coordinator_id:helper.id,invite_email:helper.email,invite_token:'synthetic-http-link',scopes:JSON.stringify(['bookings']),status:'active',invited_at:stamp});
  const workerLogin=await request('POST','/api/login',{body:{email:db.prepare('SELECT email FROM users WHERE id=10').get().email,password:'demo1234'}});ok(workerLogin);worker={id:10,cookie:workerLogin.cookie};
  db.exec("UPDATE worker_profiles SET visible=1,self_paused=0,services='[\"daily-tasks\",\"personal-care\"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id=10");
  await test('Real completion immediately issues one pending-review invoice and queues its PDF email',async()=>{
    bookingId=ins('bookings',{participant_id:participant.id,worker_id:worker.id,service:'personal-care',date:'2026-09-12',start:'10:00',hours:3,status:'accepted',rate_category:'saturday',created:stamp});
    const result=ok(await request('PATCH','/api/bookings/'+bookingId,{cookie:worker.cookie,body:{status:'completed',note:'Delivered the agreed personal support and recorded the participant outcome.'}}));
    assert.equal(result.billing_status,'issued');assert.equal(result.approval_state,'pending');assert.equal(result.invoice.total,310.62);invoiceNo=result.invoice_no;assert.ok(invoiceNo);
    const mail=db.prepare('SELECT * FROM delivery_outbox WHERE event_key=?').get('invoice:'+invoiceNo);assert.equal(mail.status,'queued');assert.equal(mail.recipient,participant.email);
    const payload=JSON.parse(mail.payload);assert.equal(payload[7][0].mime,'application/pdf');assert.match(payload[5],/#\/invoice\?invoice=/);
    const pdf=await request('GET','/api/me/invoices/'+invoiceNo+'.pdf',{cookie:participant.cookie});ok(pdf);token=/\/pay\/([a-f0-9]{64})/.exec(pdf.bytes.toString('latin1'))?.[1];assert.ok(token,'Invoice PDF includes the actual bearer payment link');
    const pending=ok(await request('GET','/api/payments/invoices/'+invoiceNo,{cookie:participant.cookie}));assert.equal(pending.status,'awaiting-review');assert.equal(pending.can_review,true);assert.equal(pending.can_pay,false);assert.equal(pending.bank,null);assert.equal(requests.length,0);
  });
  await test('A real bearer link is redacted, cannot review, and cannot collect before approval',async()=>{
    const response=await request('GET','/api/payments/public/'+token);const data=ok(response);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(data.can_review,false);assert.equal(data.pdf_url,null);assert.equal(data.review_fingerprint,null);assert.deepEqual(data.bill_to,[]);assert.equal(data.bank,null);
    assert.ok(data.lines.every(line=>line.description==='Delivered support'));assert.ok(!JSON.stringify(data).includes(participant.name));assert.ok(!JSON.stringify(data).includes(participant.email));
    ok(await request('POST','/api/payments/public/'+token+'/checkout',{body:{method:'card'}}),409);
    const review=await request('POST','/api/payments/public/'+token+'/review',{body:{action:'approve',confirm:true}});assert.ok([401,404,405].includes(review.status));assert.equal(db.prepare('SELECT approval_state FROM bookings WHERE id=?').get(bookingId).approval_state,'pending');
    ok(await request('GET','/api/payments/public/'+'0'.repeat(64)),404);
  });
  await test('Actual participant and helper routes enforce ownership, separate scopes and revoke access',async()=>{
    const url='/api/payments/invoices/'+invoiceNo;
    ok(await request('GET',url,{cookie:other.cookie}),404);ok(await request('GET',url,{cookie:worker.cookie}),404);
    const bookingAccess=ok(await request('GET',url,{cookie:helper.cookie,forId:participant.id}));assert.equal(bookingAccess.can_review,true);assert.equal(bookingAccess.can_pay,false);assert.equal(bookingAccess.pdf_url,null);
    db.prepare('UPDATE account_links SET scopes=? WHERE id=?').run(JSON.stringify(['invoices']),linkId);
    const invoiceAccess=ok(await request('GET',url,{cookie:helper.cookie,forId:participant.id}));assert.equal(invoiceAccess.can_review,false);
    ok(await request('POST',url+'/review',{cookie:helper.cookie,forId:participant.id,body:{action:'approve',confirm:true,fingerprint:invoiceAccess.review_fingerprint}}),403);
    db.prepare("UPDATE account_links SET status='revoked' WHERE id=?").run(linkId);ok(await request('GET',url,{cookie:helper.cookie,forId:participant.id}),404);
  });
  await test('A query changes the review fingerprint, rejects stale approval and resumes after explicit review',async()=>{
    const url='/api/payments/invoices/'+invoiceNo,before=ok(await request('GET',url,{cookie:participant.cookie}));
    const queried=ok(await request('POST',url+'/review',{cookie:participant.cookie,body:{action:'query',confirm:true,fingerprint:before.review_fingerprint,query_note:'Please confirm the recorded end time for this visit.'}}));assert.equal(queried.review_state,'queried');assert.equal(queried.can_pay,false);assert.notEqual(queried.review_fingerprint,before.review_fingerprint);
    ok(await request('POST',url+'/review',{cookie:participant.cookie,body:{action:'approve',confirm:true,fingerprint:before.review_fingerprint}}),409);
    const approved=ok(await request('POST',url+'/review',{cookie:participant.cookie,body:{action:'approve',confirm:true,fingerprint:queried.review_fingerprint}}));assert.equal(approved.review_state,'approved');assert.equal(approved.can_pay,true);assert.equal(approved.total,310.62);assert.equal(db.prepare('SELECT approved_by FROM bookings WHERE id=?').get(bookingId).approved_by,participant.id);
  });
  await test('Retired bank configuration cannot expose receiving details through any real payer route or PDF',async()=>{
    for(const url of ['/api/payments/invoices/'+invoiceNo,'/api/payments/public/'+token,'/api/me/invoices']){
      const data=ok(await request('GET',url,{cookie:participant.cookie}));assert.deepEqual(data.bank,url==='/api/me/invoices'?[]:null);assert.doesNotMatch(JSON.stringify(data),/76543210|100000017|retired-bank@example\.test|654321|123456/);
    }
    const pdf=await request('GET','/api/me/invoices/'+invoiceNo+'.pdf',{cookie:participant.cookie});ok(pdf);const contents=pdf.bytes.toString('latin1');assert.doesNotMatch(contents,/76543210|100000017|retired-bank@example\.test|654321|123456|BSB:/);assert.ok(contents.includes('/pay/'+token));
    const mail=JSON.stringify(JSON.parse(db.prepare('SELECT payload FROM delivery_outbox WHERE event_key=?').get('invoice:'+invoiceNo).payload).slice(0,7));assert.doesNotMatch(mail,/76543210|100000017|retired-bank@example\.test|654321|123456|bank transfer/i);
  });
  await test('Real admin authentication protects the retired assignment route and history remains unchanged',async()=>{
    const before=db.prepare('SELECT * FROM payment_accounts').all();const path='/api/admin/payments/zai/accounts',body={participant_id:participant.id,provider_user_id:'new-user',wallet_account_id:'new-wallet',virtual_account_id:'new-account'};
    ok(await request('POST',path,{body}),403);ok(await request('POST',path,{cookie:participant.cookie,body}),403);
    const result=ok(await request('POST',path,{cookie:admin.cookie,body}),410);assert.equal(result.payment_policy,'invoice-link-only');assert.match(result.error,/payment link/);assert.deepEqual(db.prepare('SELECT * FROM payment_accounts').all(),before);
    const dashboard=ok(await request('GET','/api/admin/payments/dashboard',{cookie:admin.cookie}));assert.deepEqual(Object.keys(dashboard.providers),['stripe']);assert.equal(dashboard.accounts,undefined);assert.equal(dashboard.payment_policy,'invoice-link-only');
  });
  await test('Repeated authenticated checkout uses one priced provider request and returning never marks paid',async()=>{
    const url='/api/payments/invoices/'+invoiceNo+'/checkout';
    const first=ok(await request('POST',url,{cookie:participant.cookie,body:{method:'payto'}}));assert.match(first.url,/^https:\/\/checkout\.stripe\.com\//);checkout=db.prepare('SELECT checkout_id AS id,amount_cents FROM payment_attempts WHERE invoice_no=?').get(invoiceNo);assert.equal(checkout.amount_cents,31062);
    const second=ok(await request('POST',url,{cookie:participant.cookie,body:{method:'payto'}}));assert.equal(second.url,first.url);
    const creates=requests.filter(r=>r.path==='/v1/checkout/sessions');assert.equal(creates.length,1);assert.equal(creates[0].params['payment_method_types[0]'],'payto');assert.equal(creates[0].params['line_items[0][price_data][unit_amount]'],'31062');assert.equal(creates[0].params['metadata[invoice_no]'],invoiceNo);assert.ok(creates[0].idempotency);
    const returned=await request('GET','/pay/'+token+'?checkout=returned');assert.equal(returned.status,200);assert.equal(ok(await request('GET','/api/payments/invoices/'+invoiceNo,{cookie:participant.cookie})).paid,0);
  });
  await test('Unsigned or incorrectly signed raw webhooks cannot alter the payment ledger',async()=>{
    const event=stripeEvent();ok(await webhook(event,true),400);ok(await request('POST','/api/stripe/webhook',{raw:JSON.stringify(event),origin:false}),400);assert.equal(db.prepare('SELECT count(*) n FROM payment_transfers').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,0);
  });
  await test('Signed checkout and intent confirmations update the invoice once and queue one receipt',async()=>{
    const event=stripeEvent();event.data.object.metadata={...event.data.object.metadata,test_note:'Synthetic receipt café'};successfulEvent=event;sessions.get(checkout.id).status='complete';sessions.get(checkout.id).payment_status='paid';
    ok(await webhook(event));ok(await webhook(event));ok(await webhook(stripeEvent('payment_intent.succeeded')));
    await waitFor(()=>db.prepare("SELECT count(*) n FROM delivery_outbox WHERE event_key LIKE 'payment-receipt:%'").get().n===1);
    const paid=ok(await request('GET','/api/payments/invoices/'+invoiceNo,{cookie:participant.cookie}));assert.equal(paid.status,'paid');assert.equal(paid.paid,310.62);assert.equal(paid.balance,0);assert.equal(paid.can_pay,false);assert.equal(paid.settlement_status,'not_confirmed');
    assert.equal(db.prepare('SELECT count(*) n FROM payment_transfers').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM payment_allocations').get().n,1);
    const receipt=db.prepare("SELECT * FROM delivery_outbox WHERE event_key LIKE 'payment-receipt:%'").get();assert.equal(receipt.status,'queued');assert.equal(receipt.recipient,participant.email);assert.equal(JSON.parse(receipt.payload)[8].payment_receipt,true);
    const publicPaid=ok(await request('GET','/api/payments/public/'+token));assert.equal(publicPaid.can_pay,false);assert.equal(publicPaid.balance,0);ok(await request('POST','/api/payments/public/'+token+'/checkout',{body:{method:'card'}}),409);
  });
  await test('Signed UTF-8 webhook bytes survive a multibyte character split across HTTP chunks',async()=>{
    assert.ok(successfulEvent,'The confirmed payment fixture must exist');
    ok(await splitWebhook(successfulEvent));ok(await splitWebhook(successfulEvent,true),400);
    assert.equal(db.prepare('SELECT count(*) n FROM payment_transfers').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM invoice_payment_evidence').get().n,1);assert.equal(db.prepare("SELECT count(*) n FROM delivery_outbox WHERE event_key LIKE 'payment-receipt:%'").get().n,1);
    assert.equal(ok(await request('GET','/api/payments/invoices/'+invoiceNo,{cookie:participant.cookie})).balance,0);
  });
  await test('Payment status and invoice email remain singular after completion is retried',async()=>{
    const result=ok(await request('PATCH','/api/bookings/'+bookingId,{cookie:worker.cookie,body:{status:'completed',note:'Delivered the agreed personal support and recorded the participant outcome.'}}));assert.equal(result.duplicate,true);assert.equal(result.invoice_no,invoiceNo);
    assert.equal(db.prepare('SELECT count(*) n FROM invoice_snapshots WHERE invoice_no=?').get(invoiceNo).n,1);assert.equal(db.prepare('SELECT count(*) n FROM delivery_outbox WHERE event_key=?').get('invoice:'+invoiceNo).n,1);
    assert.equal(db.prepare('SELECT claim_status FROM bookings WHERE id=?').get(bookingId).claim_status,'paid');
  });
}finally{
  if(db)db.close();
  if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}
  if(stub)await new Promise(resolve=>stub.close(resolve));
  if(process.env.PAYMENT_HTTP_RESULTS)fs.writeFileSync(process.env.PAYMENT_HTTP_RESULTS,JSON.stringify({runtime:process.version,scope:'Real HTTP routes with disposable records, no real payment or email, loopback-only provider stub',results,serverLog:log},null,2));
  fs.rmSync(DIR,{recursive:true,force:true});console.log(`payment HTTP: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}})().catch(error=>{console.error(error);process.exitCode=1;});
