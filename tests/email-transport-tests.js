'use strict';
// Run the production transport functions with injected HTTPS/TLS boundaries.
// No server process or socket is allowed to contact a real mail provider.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const transportSource=source.slice(source.indexOf('function b64wrap('),source.indexOf('\nfunction baseUrl('));
assert.ok(transportSource.includes('function sendMailDirect('));
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name);}
function fixture(provider='resend'){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,email TEXT,closed_at TEXT);
    CREATE TABLE support_plans(id INTEGER PRIMARY KEY);CREATE TABLE incidents(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES(1,'participant','participant@example.test',NULL);`);
  const requests=[],logs=[],timers=new Map(),state={reject:false,timeout:false,smtpDataReject:false,smtpHang:false};let timer=0;
  const smtpResponses=['220 synthetic SMTP ready\r\n','250-synthetic\r\n250 AUTH LOGIN\r\n','334 username\r\n','334 password\r\n','235 authenticated\r\n','250 sender accepted\r\n','250 recipient accepted\r\n','354 send data\r\n','250 queued\r\n','221 bye\r\n'];
  const context=vm.createContext({Buffer,Date,Promise,crypto,APP_URL:'https://care.example.test',MAIL_FROM:'office@example.test',SMTP_HOST:'smtp.example.test',SMTP_PORT:465,SMTP_USER:'synthetic-user',SMTP_PASS:'synthetic-password',RESEND_KEY:provider==='resend'?'synthetic-key':'',RESEND_BASE:'https://provider.example.test',EMAIL_ON:true,WORKFLOW:null,
    console:{log:(...a)=>logs.push(a),info:(...a)=>logs.push(a),error:(...a)=>logs.push(a)},
    AbortSignal:{timeout:ms=>({timeoutMs:ms})},setTimeout:(fn,ms)=>{const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{requests.push({url,options});if(state.timeout)throw Error('Synthetic request timed out');return {ok:!state.reject,status:state.reject?429:200,json:async()=>state.reject?{message:'Synthetic provider rate limit'}:{id:'synthetic-message'}};},
    tls:{connect:options=>{const socket=new EventEmitter(),request={options,writes:[],destroyed:false,ended:false};requests.push(request);let i=0;
      const reply=()=>{if(state.smtpHang)return;const text=state.smtpDataReject&&i===8?'550 synthetic body rejected\r\n':smtpResponses[i];if(text)queueMicrotask(()=>{socket.emit('data',Buffer.from(text.slice(0,4)));socket.emit('data',Buffer.from(text.slice(4)));});};
      socket.write=data=>{request.writes.push(data);i++;reply();};socket.destroy=()=>{request.destroyed=true;};socket.end=()=>{request.ended=true;};reply();return socket;}}
  });
  vm.runInContext(transportSource,context);
  const store=require('../lib/process-store')({db,emailOn:()=>true,mailPrefs:()=>({}),baseUrl:()=> 'https://care.example.test',sendMailDirect:context.sendMailDirect});
  const enqueue=()=>store.enqueueMail(['participant@example.test','Synthetic booking accepted','Booking confirmed','<p>Open your booking.</p>','View booking','https://care.example.test/#/bookings?booking=11','office@example.test',[],{kind:'bookings',event_key:'synthetic-accepted:11',transactional:true}]);
  return {db,store,enqueue,requests,logs,state,timers,row:()=>db.prepare('SELECT * FROM delivery_outbox').get(),due:()=>db.exec("UPDATE delivery_outbox SET next_at='2000-01-01'"),close:()=>db.close()};
}
(async()=>{
  await test('Production Resend transport receives the final HTML, recipient and stable idempotency key',async()=>{
    const f=fixture();await f.enqueue();await f.store.drain();assert.equal(f.row().status,'sent');assert.ok(f.row().sent_at);assert.equal(f.row().payload,'[]');
    assert.equal(f.requests.length,1);const request=f.requests[0],body=JSON.parse(request.options.body);assert.equal(request.url,'https://provider.example.test/emails');assert.equal(request.options.method,'POST');assert.equal(request.options.headers.Authorization,'Bearer synthetic-key');assert.equal(request.options.headers['Idempotency-Key'],crypto.createHash('sha256').update('synthetic-accepted:11').digest('hex'));assert.deepEqual(body.to,['participant@example.test']);assert.equal(body.from,'The Care Web <office@example.test>');assert.equal(body.reply_to,'office@example.test');assert.match(body.html,/Booking confirmed/);assert.match(body.text,/View booking/);assert.equal(request.options.signal.timeoutMs,20000);f.close();
  });
  await test('Production Resend rejection leaves a retryable body and successful retry keeps the same provider key',async()=>{
    const f=fixture();await f.enqueue();f.state.reject=true;await f.store.drain();assert.equal(f.row().status,'retry');assert.equal(f.row().sent_at,null);assert.match(f.row().error,/Resend API 429.*rate limit/);assert.notEqual(f.row().payload,'[]');
    f.state.reject=false;f.due();await f.store.drain();assert.equal(f.row().status,'sent');assert.equal(f.requests.length,2);assert.equal(f.requests[0].options.headers['Idempotency-Key'],f.requests[1].options.headers['Idempotency-Key']);assert.equal(f.requests[0].options.body,f.requests[1].options.body);f.close();
  });
  await test('Production Resend timeout becomes a visible retry and never a sent result',async()=>{
    const f=fixture();await f.enqueue();f.state.timeout=true;await f.store.drain();assert.equal(f.row().status,'retry');assert.equal(f.row().sent_at,null);assert.match(f.row().error,/timed out/);f.close();
  });
  await test('Production SMTP parses split multiline responses and completes after DATA acceptance',async()=>{
    const f=fixture('smtp');await f.enqueue();await f.store.drain();assert.equal(f.row().status,'sent');assert.ok(f.row().sent_at);assert.equal(f.requests.length,1);
    const request=f.requests[0];assert.equal(request.options.port,465);assert.equal(request.options.servername,'smtp.example.test');assert.equal(request.writes[0],'EHLO thecareweb.com.au\r\n');assert.equal(request.writes[1],'AUTH LOGIN\r\n');assert.ok(request.writes.includes('RCPT TO:<participant@example.test>\r\n'));assert.ok(request.writes.includes('DATA\r\n'));const data=request.writes.find(s=>s.startsWith('From:'));assert.ok(data);assert.ok(data.includes('Message-ID: <'+crypto.createHash('sha256').update('synthetic-accepted:11').digest('hex')+'@thecareweb.com.au>'));assert.equal(request.writes.at(-1),'QUIT\r\n');assert.equal(request.ended,true);assert.equal(f.timers.size,0);f.close();
  });
  await test('SMTP DATA rejection cannot be recorded as accepted or delivered',async()=>{
    const f=fixture('smtp');await f.enqueue();f.state.smtpDataReject=true;await f.store.drain();assert.equal(f.row().status,'retry');assert.equal(f.row().sent_at,null);assert.match(f.row().error,/550.*rejected/);assert.equal(f.requests[0].destroyed,true);assert.equal(f.timers.size,0);f.close();
  });
  await test('SMTP timeout destroys the socket and leaves the email queued for retry',async()=>{
    const f=fixture('smtp');await f.enqueue();f.state.smtpHang=true;const sending=f.store.drain();await Promise.resolve();assert.equal(f.row().status,'sending');assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.ms,25000);timer.fn();await sending;assert.equal(f.row().status,'retry');assert.equal(f.row().sent_at,null);assert.match(f.row().error,/SMTP timeout/);assert.equal(f.requests[0].destroyed,true);f.close();
  });
  console.log('email transports: '+count+' passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
