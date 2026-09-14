'use strict';
// A query reply is append-only evidence, never participant approval or a payment.
const crypto=require('node:crypto');
module.exports=function invoiceQueries(c,w){
 const {db,now}=c;
 const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const clean=(x,n=4000)=>String(x??'').trim().slice(0,n);
 const fail=(message,code='query_unavailable',status=409)=>{const e=Error(message);e.status=status;e.code=code;throw e;};
 const user=id=>db.prepare('SELECT id,name,email,role,closed_at FROM users WHERE id=?').get(id);
 const getInvoice=no=>c.invoiceFor(no)||c.invoiceFlow.archived(no);
 function record(no){
  const inv=getInvoice(no);if(!inv)return null;
  const archivedIds=inv.withdrawn&&Array.isArray(inv.booking_ids)?inv.booking_ids.filter(Number.isSafeInteger):[];
  const rows=archivedIds.length?db.prepare(`SELECT b.*,u.name AS worker_name FROM bookings b LEFT JOIN users u ON u.id=b.worker_id WHERE b.id IN (${archivedIds.map(()=>'?').join(',')}) ORDER BY b.id`).all(...archivedIds):db.prepare('SELECT b.*,u.name AS worker_name FROM bookings b LEFT JOIN users u ON u.id=b.worker_id WHERE b.invoice_no=? ORDER BY b.id').all(no);
  const ids=rows.map(b=>b.id);
  const history=ids.length?db.prepare(`SELECT n.*,u.name AS author,u.role AS author_role FROM shift_notes n LEFT JOIN users u ON u.id=COALESCE(n.author_id,n.worker_id) WHERE n.booking_id IN (${ids.map(()=>'?').join(',')}) ORDER BY n.created,n.id`).all(...ids).map(n=>({id:n.id,booking_id:n.booking_id,kind:n.kind==='question'?'question':n.kind==='office-reply'?'office-reply':n.addendum?'worker-reply':'note',author:n.author||(n.kind==='office-reply'?'Office':'Worker'),author_role:n.kind==='office-reply'?'office':n.author_role||'worker',body:n.body,created:n.created})):[];
  if(inv.withdrawn&&inv.withdrawn_at)for(let i=history.length-1;i>=0;i--)if(history[i].created>inv.withdrawn_at)history.splice(i,1);
  for(const b of rows)if(b.query_note&&(!inv.withdrawn||!b.query_at||b.query_at<=inv.withdrawn_at)&&!history.some(n=>n.booking_id===b.id&&n.kind==='question'&&n.body===b.query_note))history.push({id:'legacy-'+b.id,booking_id:b.id,kind:'question',author:user(b.query_by)?.name||'Participant',author_role:user(b.query_by)?.role||'participant',body:b.query_note,created:b.query_at||b.completed_at||''});
  history.sort((a,b)=>String(a.created).localeCompare(String(b.created))||String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
  const access=db.prepare('SELECT paused_at,pause_reason FROM payment_invoice_access WHERE invoice_no=?').get(no);
  const queried=rows.filter(b=>b.approval_state==='queried');
  const hasQuery=!!(access?.paused_at||history.some(n=>n.kind==='question'));
  const explicitlyApproved=rows.length>0&&rows.every(b=>(b.approval_state==='approved'&&b.approval_source!=='deemed')||b.status==='cancelled');
  const state=inv.withdrawn?'withdrawn':hasQuery&&(queried.length||access?.paused_at||!explicitlyApproved)?queried.length?'needs-reply':'awaiting-participant':'resolved';
  const open=!inv.withdrawn&&Number(inv.balance)>0&&rows.length>0&&rows.every(b=>b.status==='completed'&&!b.voided&&b.participant_id===inv.participant.id);
  const fingerprint=hash({invoice:no,total:inv.total,paid:inv.paid,balance:inv.balance,withdrawn:!!inv.withdrawn,access,rows:rows.map(b=>[b.id,b.participant_id,b.worker_id,b.status,b.approval_state,b.approval_source,b.approval_from,b.approved_at,b.query_at,b.query_note,b.voided]),history});
  return {inv,rows,queried,history,state,hasQuery,fingerprint,open};
 }
 function workerRequestKey(no,r){return 'invoice-query-worker:'+hash([no,r.queried.map(x=>[x.id,x.worker_id,x.query_at,x.query_note]),r.history.filter(n=>n.kind==='question').map(n=>n.id)]);}
 function summary(no){
  const r=record(no);if(!r)return null;
  const requested=r.queried.length?db.prepare('SELECT created_at FROM payment_events WHERE event_key=?').get(workerRequestKey(no,r)):null;
  return {worker_requested_at:requested?.created_at||null,state:r.state,label:r.state==='needs-reply'?'Answer invoice query':r.state==='awaiting-participant'?'Waiting for participant review':r.state==='withdrawn'?'Invoice withdrawn':'Query resolved',has_history:r.hasQuery,booking_ids:r.rows.map(b=>b.id),can_reply:r.open&&r.state==='needs-reply',can_request_worker:r.open&&r.state==='needs-reply',can_withdraw:r.open&&Number(r.inv.paid)===0};
 }
 function view(no){
  const r=record(no);if(!r)return null;
  const reviewDue=b=>b.approval_from&&Number.isFinite(Date.parse(b.approval_from))?new Date(Date.parse(b.approval_from)+(c.approvalDays||7)*864e5).toISOString():null;
  return {...summary(no),invoice_no:no,participant:r.inv.participant.name,participant_id:r.inv.participant.id,total:r.inv.total,paid:r.inv.paid,balance:r.inv.balance,withdrawn:!!r.inv.withdrawn,fingerprint:r.fingerprint,history:r.history,bookings:r.rows.map(b=>({id:b.id,date:b.date,start:b.start,hours:b.hours,worker_name:b.worker_name||'Worker',approval_state:b.approval_state,query_note:b.query_note||'',query_at:b.query_at,review_due:reviewDue(b)})),correction_url:'#/admin/money?section=history&invoice='+encodeURIComponent(no)};
 }
 function readCurrent(no,body){const r=record(no);if(!r)fail('Invoice not found.','query_missing',404);if(!r.open)fail(r.inv.withdrawn?'This invoice is withdrawn. Open its retained history.':'This invoice is already paid or unavailable for a query reply. Open payment review if the received payment needs attention.');if(body.confirm!==true||body.fingerprint!==r.fingerprint)fail('The invoice or its question changed. Refresh and read the latest record before replying.','query_changed');if(r.state!=='needs-reply')fail('The question has already been answered. The participant needs to review the response.');return r;}
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
 function queue(u,no,ids,eventKey,worker=false){
  if(!u||u.closed_at||!u.email)return false;
  const pid=record(no)?.inv.participant.id;
  const href=c.appUrl+(worker?'/#/journey?panel=shift&booking='+ids[0]:'/#/invoice?invoice='+encodeURIComponent(no)+(u.id!==pid?'&for='+pid:''));
  const subject=worker?'Please answer a shift question':'An answer to your invoice question is ready';
  const html=worker?'<p>The office has requested your response to a question about a completed shift. Sign in to read the question and add your answer to the shift record.</p>':'<p>The office has responded to your invoice question. Sign in to read the answer and review the shift details. Payment remains paused until the authorised participant or helper explicitly approves.</p>';
  w.enqueueMail([u.email,subject+' — The Care Web',subject,html,worker?'Read question and answer':'Read answer and review',href,undefined,[],{event_key:eventKey,user_id:u.id,kind:'timesheets',transactional:true,invoice_query_notice:true,query_notice_role:worker?'worker':'reviewer',invoice_no:no,booking_ids:ids,participant_id:pid}]);
  return true;
 }
 function reply(no,u,b){
  const text=clean(b.reply??b.message);
  if(text.length<10||text.split(/\s+/).length<3)fail('Write a clear answer in at least one sentence.','query_reply_invalid',400);
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(b.idempotency_key||''))fail('Reload the reply form before sending.','query_request_invalid',400);
  const key='invoice-query-reply:'+b.idempotency_key,signature=hash({no,actor:u.id,text,fingerprint:b.fingerprint,confirm:b.confirm});
  let queued=0;
  const duplicate=transaction(()=>{
   const old=db.prepare('SELECT detail FROM payment_events WHERE event_key=?').get(key);
   if(old){let saved;try{saved=JSON.parse(old.detail);}catch{}if(saved?.signature!==signature)fail('This reply request was already used for different details. Refresh before sending.','query_request_conflict');return true;}
   const r=readCurrent(no,b),at=now(),ids=r.queried.map(x=>x.id);
   c.paymentFlow.pauseInvoice(no,'Invoice query awaiting participant review.',{user_id:u.id});
   // The existing participant question and original worker note are retained.
   for(const row of r.queried){
    db.prepare("INSERT INTO shift_notes(booking_id,worker_id,participant_id,body,scope_flag,scope_detail,addendum,kind,author_id,created) VALUES(?,?,?,?,0,'',1,'office-reply',?,?)").run(row.id,row.worker_id,row.participant_id,text,u.id,at);
    db.prepare("UPDATE bookings SET approval_state='pending',approval_from=?,nudged_at=NULL WHERE id=? AND approval_state='queried'").run(at,row.id);
   }
   // Do not clear payment_invoice_access.paused_at and do not call resumeInvoice.
   db.prepare("INSERT INTO payment_events(invoice_no,event_key,kind,detail,created_at) VALUES(?,?,'invoice-query-replied',?,?)").run(no,key,JSON.stringify({signature,actor_id:u.id,booking_ids:ids}),at);
   const recipients=new Map();for(const v of [user(r.inv.participant.id),...c.coordsFor(r.inv.participant.id,'bookings').map(x=>user(x.id))])if(v)recipients.set(v.id,v);
   for(const recipient of recipients.values())if(queue(recipient,no,ids,key+':reviewer:'+recipient.id))queued++;
   return false;
  });
  return {ok:true,duplicate,query_case:view(no),notice:duplicate?'already-queued':queued?'queued':'missing-recipient'};
 }
 function requestWorker(no,u,b){let queued=0;const duplicate=transaction(()=>{
  const r=readCurrent(no,b),ids=r.queried.map(x=>x.id),querySignature=hash(r.queried.map(x=>[x.id,x.worker_id,x.query_at,x.query_note]));
  const key=workerRequestKey(no,r);
  if(db.prepare('SELECT 1 FROM payment_events WHERE event_key=?').get(key))return true;
  for(const wid of new Set(r.queried.map(x=>x.worker_id))){const bookings=r.queried.filter(x=>x.worker_id===wid);if(queue(user(wid),no,bookings.map(x=>x.id),key+':worker:'+wid,true))queued++;}
  if(!queued)fail('The worker has no active email address. Open the people directory to confirm their details.','query_recipient_missing');
  db.prepare("INSERT INTO payment_events(invoice_no,event_key,kind,detail,created_at) VALUES(?,?,'invoice-query-worker-requested',?,?)").run(no,key,JSON.stringify({actor_id:u.id,booking_ids:ids,query_signature:querySignature}),now());
  return false;
 });return {ok:true,duplicate,query_case:view(no),notice:duplicate?'already-queued':'queued'};}
 function adminRoute(method,rx,fn){c.route(method,rx,(req,res,m,u,b={})=>{if(!u?.admin)return c.json(res,u?403:401,{error:'Office access is required.'});try{return c.json(res,200,fn(m[1],u,b));}catch(e){return c.json(res,e.status||409,{error:clean(e.message,600),code:e.code||'query_unavailable'});}});}
 adminRoute('GET',/^\/api\/admin\/invoices\/([A-Z0-9-]+)\/query$/,(no)=>{const out=view(no);if(!out)fail('Invoice not found.','query_missing',404);return out;});
 adminRoute('POST',/^\/api\/admin\/invoices\/([A-Z0-9-]+)\/query\/reply$/,reply);
 adminRoute('POST',/^\/api\/admin\/invoices\/([A-Z0-9-]+)\/query\/request-worker$/,requestWorker);
 function officeTasks(){return db.prepare("SELECT DISTINCT invoice_no FROM bookings WHERE approval_state='queried' AND COALESCE(invoice_no,'')<>''").all().map(x=>{const s=summary(x.invoice_no);return s?.can_reply?{key:'invoice-query:'+x.invoice_no,kind:'invoice',label:'Answer invoice query — '+x.invoice_no,dest:'#/invoice?invoice='+encodeURIComponent(x.invoice_no),detail:'Read the question, answer it or request the worker’s response. Payment stays paused.',due:null}:null;}).filter(Boolean);}
 function suppress(row,args){const m=args[8]||{};if(!m.invoice_query_notice)return '';const r=record(m.invoice_no);if(!r||!r.open)return 'Invoice query no longer open';const person=user(r.inv.participant.id),recipient=user(row.user_id);if(!person||person.closed_at||!recipient||recipient.closed_at)return 'Invoice query account access ended';if(m.query_notice_role==='reviewer'&&recipient.id!==person.id&&!c.coordsFor(person.id,'bookings').some(x=>x.id===recipient.id))return 'Invoice query helper access ended';if(m.query_notice_role==='worker'&&!(m.booking_ids||[]).some(id=>r.queried.some(x=>x.id===id&&x.worker_id===row.user_id)))return 'Shift question answered or worker changed';if(m.query_notice_role==='reviewer'&&r.state!=='awaiting-participant')return 'Invoice review state changed';return '';}
 return {summary,view,officeTasks,suppress};
};
