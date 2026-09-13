'use strict';
const T=require('./booking-time');
module.exports=function(c,w,h){
 const {db,json}=c,{add,fail,tx,clean}=h,{now,parse,hash}=w;
 const money=n=>Math.round(Number(n||0)*100)/100;
 for(const[col,type]of [['reviewed_by','INTEGER'],['components','TEXT']])if(!db.prepare('PRAGMA table_info(payroll_lines)').all().some(x=>x.name===col))db.exec(`ALTER TABLE payroll_lines ADD COLUMN ${col} ${type}`);
 function components(body){const x={gross_wages:Number(body.gross_wages),super:Number(body.super),allowances:Number(body.allowances),reference:clean(body.payroll_reference,200)};
   if(['gross_wages','super','allowances'].some(k=>body[k]===''||body[k]===undefined||!Number.isFinite(x[k])||Math.abs(x[k])>100000||money(x[k])!==x[k])||x.reference.length<5)throw Error('Record specialist-reviewed gross wages, super, allowances and the payroll calculation reference. Enter zero where applicable.');return x;}

 if(!db.prepare('PRAGMA table_info(invoice_payment_evidence)').all().some(x=>x.name==='state'))db.exec("ALTER TABLE invoice_payment_evidence ADD COLUMN state TEXT NOT NULL DEFAULT 'recorded'");
 db.exec("CREATE TABLE IF NOT EXISTS finance_provider_events(event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,object_id TEXT,payment_intent TEXT,invoice_no TEXT,amount_cents INTEGER,currency TEXT,status TEXT NOT NULL DEFAULT 'needs-review',created_at TEXT NOT NULL,reviewed_by INTEGER,reviewed_at TEXT,note TEXT); CREATE TABLE IF NOT EXISTS stripe_payment_links(payment_intent TEXT PRIMARY KEY,invoice_no TEXT NOT NULL,checkout_id TEXT NOT NULL)");
 w.paymentBalance=(no,total,legacyPaid=0)=>{const rows=db.prepare("SELECT amount,state FROM invoice_payment_evidence WHERE invoice_no=? AND state IN ('recorded','reversed','opening')").all(no);const paid=rows.length?money(rows.reduce((n,r)=>n+r.amount,0)):money(legacyPaid);return {paid,balance:money(total-paid)};};
 function receipt(invoice,user,b){
   const ref=clean(b.reference,150),note=clean(b.note||b.how,1000),amount=Number(b.amount),reverse=b.paid===false;
   if(b.confirm!==true||ref.length<5||note.length<10||!Number.isFinite(amount)||amount<=0||money(amount)!==amount)throw Error('Record the payment reference, amount in cents and evidence, then confirm.');
   const old=db.prepare('SELECT * FROM invoice_payment_evidence WHERE reference=?').get(ref);
   if(old){if(old.invoice_no!==invoice.invoice_no||old.amount!==(reverse?-amount:amount))throw Error('This reference already belongs to a different payment.');return {ok:true,duplicate:true,state:old.state};}
   if(reverse&&(!b.approval_id||!w.financeApproval?.(Number(b.approval_id),user.id,invoice.invoice_no,amount)))throw Error('Refunds and reversals need a separate reviewer’s approval of this invoice and amount.');
   const expected=reverse?invoice.paid:invoice.balance;if(expected<=0)throw Error(reverse?'No paid balance is available to reverse.':'The invoice is already settled.');
   const matches=amount<=money(expected),state=matches?(reverse?'reversed':'recorded'):'exception';
   tx(()=>{
     if(invoice.paid>0&&!db.prepare("SELECT 1 FROM invoice_payment_evidence WHERE invoice_no=? AND state IN ('recorded','reversed','opening')").get(invoice.invoice_no))db.prepare("INSERT INTO invoice_payment_evidence(invoice_no,reference,amount,recorded_by,recorded_at,note,state) VALUES(?,?,?,?,?,?,'opening')").run(invoice.invoice_no,'opening:'+invoice.invoice_no,invoice.paid,0,now(),'Opening balance retained from the existing paid invoice.');
     db.prepare('INSERT INTO invoice_payment_evidence(invoice_no,reference,amount,recorded_by,recorded_at,note,state) VALUES(?,?,?,?,?,?,?)').run(invoice.invoice_no,ref,reverse?-amount:amount,user.id,now(),note,state);
     if(matches){const balance=w.paymentBalance(invoice.invoice_no,invoice.total);db.prepare('UPDATE bookings SET claim_status=?,paid_at=? WHERE invoice_no=?').run(balance.balance===0?'paid':'claimed',balance.balance===0?now():null,invoice.invoice_no);}
     if(reverse&&matches)w.consumeFinanceApproval?.(Number(b.approval_id),ref);
     w.event(user.id,'invoice',state,'receipt:'+ref);
   });
   if(matches)w.onInvoicePayment?.(invoice.invoice_no);
   return {ok:true,state,matched:matches,...w.paymentBalance(invoice.invoice_no,invoice.total),message:matches?'Payment recorded; the outstanding balance has been updated.':'Amount exceeds the available balance. Held for reconciliation without changing the balance.'};
 }
 w.recordPayment=receipt;
 w.recordStripePayment=event=>{
   const s=event.data?.object||{},intent=typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id;
   let no=s.metadata?.invoice_no||db.prepare('SELECT invoice_no FROM stripe_payment_links WHERE payment_intent=?').get(intent||'')?.invoice_no||null;
   if(!event.id||!event.type||db.prepare('SELECT 1 FROM finance_provider_events WHERE event_id=?').get(event.id))return false;
   const cents=Number.isSafeInteger(s.amount_total)?s.amount_total:Number.isSafeInteger(s.amount)?s.amount:null;
   db.prepare('INSERT INTO finance_provider_events(event_id,event_type,object_id,payment_intent,invoice_no,amount_cents,currency,created_at) VALUES(?,?,?,?,?,?,?,?)').run(event.id,event.type,s.id||'',intent||'',no,cents,s.currency||'',now());
   if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return false;
   const retired=db.prepare('SELECT invoice_no FROM checkout_cleanup WHERE session_id=?').get(s.id||'');
   if(retired&&retired.invoice_no===no&&intent)db.prepare('INSERT OR IGNORE INTO stripe_payment_links(payment_intent,invoice_no,checkout_id) VALUES(?,?,?)').run(intent,no,s.id);
   const inv=no?c.invoiceFor(no):null;if(!inv)return false;
   const session=db.prepare('SELECT stripe_session FROM bookings WHERE invoice_no=? LIMIT 1').get(no)?.stripe_session;
   if(session!==s.id||s.currency!=='aud')return false;
   if(intent){db.prepare('INSERT OR IGNORE INTO stripe_payment_links(payment_intent,invoice_no,checkout_id) VALUES(?,?,?)').run(intent,no,s.id);db.prepare('UPDATE finance_provider_events SET invoice_no=? WHERE payment_intent=? AND invoice_no IS NULL').run(no,intent);}
   if(s.payment_status==='unpaid'){db.prepare("UPDATE finance_provider_events SET status='awaiting-payment' WHERE event_id=?").run(event.id);return false;}
   const ref='stripe:checkout:'+s.id,existing=db.prepare('SELECT * FROM invoice_payment_evidence WHERE reference=?').get(ref);
   if(existing){db.prepare("UPDATE finance_provider_events SET status='duplicate-payment' WHERE event_id=?").run(event.id);return true;}
   if(s.payment_status!=='paid'||!Number.isSafeInteger(cents)||cents<=0||cents>Math.round(inv.balance*100))return false;
   receipt(inv,{id:0},{reference:ref,amount:cents/100,note:'Signed Stripe payment matched stored checkout, currency and remaining balance.',confirm:true});
   db.prepare("UPDATE finance_provider_events SET status='recorded' WHERE event_id=?").run(event.id);return true;
 };
 add('POST',/^\/api\/admin\/finance\/receipt$/,(req,res,m,u,b)=>{const inv=c.invoiceFor(clean(b.invoice_no,60));if(!inv)return fail(res,'Invoice not found.',404);try{json(res,200,receipt(inv,u,b));}catch(e){fail(res,e.message,409);}});
 add('POST',/^\/api\/admin\/finance\/receipts\/(\d+)\/resolve$/,(req,res,m,u,b)=>{const row=db.prepare("SELECT * FROM invoice_payment_evidence WHERE id=? AND state='exception'").get(Number(m[1]));if(!row||b.confirm!==true||clean(b.note,1000).length<20)return fail(res,'Review an open receipt exception and record the reconciliation outcome.');db.prepare("UPDATE invoice_payment_evidence SET state='reviewed',note=note||? WHERE id=?").run('\nReconciled by '+u.name+': '+clean(b.note,1000),row.id);json(res,200,{ok:true,message:'Exception reviewed. This action does not mark an invoice paid.'});});
 function sources(from,to){
   const rows=db.prepare(`SELECT b.*,u.name AS worker_name FROM bookings b JOIN users u ON u.id=b.worker_id WHERE ${c.payable('b')} AND b.date BETWEEN ? AND ? AND COALESCE(b.voided,0)=0 ORDER BY b.id`).all(from,to).map(b=>({source_key:'booking:'+b.id,worker_id:b.worker_id,amount:money(b.worker_share)+money(b.active_extra_share),data:{date:b.date,start:b.start,hours:b.hours,worker:b.worker_name,type:b.status==='cancelled'?'Cancellation':b.kind==='intro'?'First meeting':'Shift',category:b.rate_category,booking_id:b.id,approval:b.approval_state,signature:hash([b.status,b.approval_state,b.worker_share,b.active_extra_share,b.voided])},exception:(!Number.isFinite(b.worker_share)||b.worker_share<=0?'Confirm the pay calculation. ': '')+(b.status==='completed'&&b.kind!=='intro'&&b.approval_state!=='approved'?'Timesheet '+(b.approval_state||'not reviewed')+'. Review pay obligations; participant approval is not a decision about wages.':'')}));
   for(const b of db.prepare("SELECT s.*,u.name FROM standby s JOIN users u ON u.id=s.worker_id WHERE s.status='accepted' AND s.date BETWEEN ? AND ? ORDER BY s.id").all(from,to))rows.push({source_key:'standby:'+b.id,worker_id:b.worker_id,amount:money(b.allowance),data:{date:b.date,worker:b.name,type:'Standby allowance',band:b.band},exception:b.date>=c.ymd()?'Period has not finished. Confirm the allowance before payment.':''});
   c.reviewReferrals();
   for(const b of db.prepare("SELECT r.*,u.name FROM referrals r JOIN users u ON u.id=r.referrer_id WHERE r.qualified_at IS NOT NULL AND r.paid_at IS NULL AND substr(r.qualified_at,1,10) BETWEEN ? AND ? ORDER BY r.id").all(from,to))rows.push({source_key:'referral:'+b.id,worker_id:b.referrer_id,amount:money(b.amount),data:{date:b.qualified_at.slice(0,10),worker:b.name,type:'Referral bonus'},exception:b.review_required?'Qualifying hours require review.':''});
   return rows;
 }
 function prepare(from,to,actor){
   if(!T.validDate(from)||!T.validDate(to)||from>to||to>c.ymd()||new Date(to)-new Date(from)>93*864e5)throw new Error('Choose a past pay period of up to 93 days.');
   const cutover=c.setting('payroll_cutover_date','');
   const candidates=sources(from,to).map(x=>(!cutover||x.data.date<cutover)?{...x,exception:x.exception+' Confirm this historical line was not already paid outside this batch ledger.'}:x).filter(s=>!db.prepare('SELECT 1 FROM payroll_lines WHERE source_key=?').get(s.source_key));
   if(!candidates.length)return {ok:true,empty:true,message:'No unbatched lines in this period.'};
   return tx(()=>{const id=Number(db.prepare('INSERT INTO payroll_batches(from_date,to_date,created_at,created_by) VALUES(?,?,?,?)').run(from,to,now(),actor).lastInsertRowid);
     for(const s of candidates)db.prepare('INSERT INTO payroll_lines(batch_id,source_key,worker_id,data,amount,status,exception) VALUES(?,?,?,?,?,?,?)').run(id,s.source_key,s.worker_id,JSON.stringify(s.data),s.amount,s.exception?'exception':'included',s.exception);
     w.event(actor,'payroll','prepared','payroll:'+id);return {ok:true,id};});
 }
 function batch(id){const b=db.prepare('SELECT * FROM payroll_batches WHERE id=?').get(Number(id));return b?{...b,lines:db.prepare('SELECT * FROM payroll_lines WHERE batch_id=? ORDER BY id').all(b.id).map(l=>({...l,data:parse(l.data),components:parse(l.components,null)}))}:null;}
 function stale(b){const latest=new Map(sources(b.from_date,b.to_date).map(s=>[s.source_key,s]));return b.lines.filter(l=>l.status==='included'&& !l.source_key.startsWith('adjustment:') && (!latest.has(l.source_key)||money(latest.get(l.source_key).amount)!==money(l.amount)||latest.get(l.source_key).data.signature!==l.data.signature));}
 add('GET',/^\/api\/admin\/payroll-batches$/,(req,res)=>json(res,200,{batches:db.prepare('SELECT b.*,COUNT(l.id) line_count,SUM(CASE WHEN l.status=? THEN 1 ELSE 0 END) exceptions FROM payroll_batches b LEFT JOIN payroll_lines l ON l.batch_id=b.id GROUP BY b.id ORDER BY b.id DESC LIMIT 100').all('exception')}));
 add('POST',/^\/api\/admin\/payroll-batches$/,(req,res,m,u,b)=>{try{json(res,200,prepare(clean(b.from,10),clean(b.to,10),u.id));}catch(e){fail(res,e.message);}});
 add('GET',/^\/api\/admin\/payroll-batches\/(\d+)$/,(req,res,m)=>{const b=batch(m[1]);return b?json(res,200,b):fail(res,'Batch not found.',404);});
 add('POST',/^\/api\/admin\/payroll-lines\/(\d+)\/review$/,(req,res,m,u,b)=>{
   const l=db.prepare('SELECT l.*,b.status AS batch_status FROM payroll_lines l JOIN payroll_batches b ON b.id=l.batch_id WHERE l.id=?').get(Number(m[1]));if(!l||l.batch_status!=='draft')return fail(res,'Only a draft batch can change.',409);
   if(!['included','excluded'].includes(b.status)||clean(b.reason,1000).length<15)return fail(res,'Record the decision and reason in at least 15 characters.');
   if(b.status==='included'&&!l.source_key.startsWith('adjustment:')){const parent=batch(l.batch_id),fresh=sources(parent.from_date,parent.to_date).find(x=>x.source_key===l.source_key);if(!fresh)return fail(res,'The source no longer belongs in this batch. Exclude it and record the reason.',409);db.prepare('UPDATE payroll_lines SET data=?,amount=?,exception=? WHERE id=?').run(JSON.stringify(fresh.data),fresh.amount,fresh.exception,l.id);}
   let comp=null;if(b.status==='included')try{comp=components(b);}catch(e){return fail(res,e.message);}
   db.prepare('UPDATE payroll_lines SET status=?,resolution=?,reviewed_by=?,components=? WHERE id=?').run(b.status,clean(b.reason,1000),u.id,comp?JSON.stringify(comp):null,l.id);w.event(u.id,'payroll','line-reviewed','pay-line:'+l.id+':'+now());json(res,200,{ok:true});
 });
 add('POST',/^\/api\/admin\/payroll-batches\/(\d+)\/adjustment$/,(req,res,m,u,b)=>{
   const p=batch(m[1]),amount=Number(b.amount),ref=clean(b.reference,80);if(!p||p.status!=='draft')return fail(res,'Choose a draft batch.',409);
   if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>100000||!ref||clean(b.reason,1000).length<15||!db.prepare("SELECT id FROM users WHERE id=? AND role='worker'").get(Number(b.worker_id)))return fail(res,'Enter a worker, amount, unique reference and reason.');
   if(db.prepare('SELECT 1 FROM payroll_lines WHERE source_key=?').get('adjustment:'+ref))return fail(res,'That adjustment reference already exists.',409);
   const name=db.prepare('SELECT name FROM users WHERE id=?').get(Number(b.worker_id)).name;db.prepare('INSERT INTO payroll_lines(batch_id,source_key,worker_id,data,amount,status,resolution) VALUES(?,?,?,?,?,?,?)').run(p.id,'adjustment:'+ref,Number(b.worker_id),JSON.stringify({date:p.to_date,worker:name,type:'Reviewed adjustment'}),money(amount),'included',clean(b.reason,1000));json(res,200,{ok:true});
 });
 add('POST',/^\/api\/admin\/payroll-batches\/(\d+)\/approve$/,(req,res,m,u,b)=>{
   const p=batch(m[1]);if(!p||p.status!=='draft')return fail(res,'Choose a draft batch.',409);if(b.confirm!==true||p.lines.some(l=>l.status==='exception'))return fail(res,'Review every exception and confirm the full batch.');if(stale(p).length)return fail(res,'A source changed. Review the affected lines again.',409);
   if(p.created_by===u.id||p.lines.some(l=>l.reviewed_by===u.id))return fail(res,'A different finance reviewer must approve this batch. Preparers and line reviewers cannot approve their own work.',409);
   if(p.lines.some(l=>l.status==='included'&&(!l.reviewed_by||!l.components)))return fail(res,'Every included line needs reviewed wages, super, allowances and a calculation reference. The booking allocation is only an estimate.',409);
   db.prepare("UPDATE payroll_batches SET status='approved',approved_at=?,approved_by=? WHERE id=?").run(now(),u.id,p.id);json(res,200,{ok:true});
 });
 add('GET',/^\/api\/admin\/payroll-batches\/(\d+)\.csv$/,(req,res,m,u)=>{
   const p=batch(m[1]);if(!p||!['approved','exported','acknowledged'].includes(p.status))return fail(res,'Review and approve the batch before export.',409);if(p.status==='approved'&&p.lines.some(l=>l.status==='included'&&!l.components))return fail(res,'Reopen this older batch and record the reviewed pay components before export.',409);if(p.status==='approved'&&stale(p).length)return fail(res,'A source changed after approval. Reopen and review the batch.',409);
   const q=c.csvCell,rows=[['Batch ID','Line ID','Source','Worker ID','Worker','Date','Type','Booking allocation estimate','Reviewed gross wages','Reviewed super','Reviewed allowances','Payroll reference','Review reason'].map(q).join(',')];for(const l of p.lines.filter(l=>l.status==='included'))rows.push([p.id,l.id,l.source_key,l.worker_id,l.data.worker,l.data.date,l.data.type,l.amount.toFixed(2),Number(l.components?.gross_wages||0).toFixed(2),Number(l.components?.super||0).toFixed(2),Number(l.components?.allowances||0).toFixed(2),l.components?.reference||'',l.resolution].map(q).join(','));
   if(p.status==='approved')db.prepare("UPDATE payroll_batches SET status='exported',exported_at=? WHERE id=?").run(now(),p.id);w.event(u.id,'payroll','exported','payroll:'+p.id+':export');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="careweb-payroll-batch-${p.id}.csv"`});res.end('\ufeff'+rows.join('\r\n'));
 });
 add('POST',/^\/api\/admin\/payroll-batches\/(\d+)\/reopen$/,(req,res,m,u,b)=>{const p=batch(m[1]);if(!p||p.status!=='approved'||clean(b.reason,1000).length<15)return fail(res,'Only an unexported approved batch can be reopened, with a reason.',409);db.prepare("UPDATE payroll_batches SET status='draft',approved_at=NULL,approved_by=NULL WHERE id=?").run(p.id);w.event(u.id,'payroll','reopened','payroll:'+p.id+':'+now());json(res,200,{ok:true});});
 add('POST',/^\/api\/admin\/payroll-batches\/(\d+)\/acknowledge$/,(req,res,m,u,b)=>{
   const p=batch(m[1]);if(!p||p.status!=='exported')return fail(res,'Export the approved batch first.',409);if(b.confirm!==true||clean(b.external_ref,200).length<5)return fail(res,'Record the external payroll/payment reference and confirm payment.');
   tx(()=>{db.prepare("UPDATE payroll_batches SET status='acknowledged',external_ref=?,acknowledged_at=?,acknowledged_by=? WHERE id=?").run(clean(b.external_ref,200),now(),u.id,p.id);for(const l of p.lines.filter(l=>l.status==='included')){db.prepare('UPDATE payroll_lines SET external_ref=? WHERE id=?').run(clean(b.external_ref,200),l.id);if(l.source_key.startsWith('referral:'))db.prepare('UPDATE referrals SET paid_at=?,paid_by=? WHERE id=? AND paid_at IS NULL').run(now(),u.name,Number(l.source_key.split(':')[1]));}w.event(u.id,'payroll','payment-recorded','payroll:'+p.id+':paid');});json(res,200,{ok:true});
 });
 add('GET',/^\/api\/journey\/payroll$/,(req,res,m,u)=>{if(u.role!=='worker')return fail(res,'Workers only.',403);json(res,200,{lines:db.prepare('SELECT l.id,l.source_key,l.amount,l.status,l.resolution,b.status AS batch_status,b.from_date,b.to_date,b.acknowledged_at FROM payroll_lines l JOIN payroll_batches b ON b.id=l.batch_id WHERE l.worker_id=? ORDER BY l.id DESC LIMIT 200').all(u.id)});});
 add('GET',/^\/api\/admin\/finance-exceptions$/,(req,res)=>json(res,200,{invoices:db.prepare("SELECT s.invoice_no,s.created_at,b.claim_status,b.paid_at,MAX(o.status) AS delivery_status FROM invoice_snapshots s JOIN bookings b ON b.invoice_no=s.invoice_no LEFT JOIN delivery_outbox o ON o.event_key='invoice:'||s.invoice_no GROUP BY s.invoice_no ORDER BY s.created_at DESC LIMIT 200").all().map(i=>({...i,total:c.invoiceFor(i.invoice_no)?.total,payer:c.invoiceFor(i.invoice_no)?.bill_to?.join(' · ')})),provider_events:db.prepare("SELECT * FROM finance_provider_events WHERE status='needs-review' ORDER BY created_at DESC LIMIT 100").all(),receipts:db.prepare('SELECT * FROM invoice_payment_evidence ORDER BY id DESC LIMIT 200').all(),unissued:db.prepare(`SELECT b.id,b.date,b.participant_id,b.approval_state,b.claim_status,b.claim_hold,b.hold_reason,b.rate_category,b.support_item,u.plan AS funding FROM bookings b JOIN users u ON u.id=b.participant_id WHERE ${c.billable('b')} AND COALESCE(b.invoice_no,'')='' ORDER BY date LIMIT 200`).all()}));
 w.preparePayroll=prepare;
 w.scheduledPayroll=()=>{if(c.setting('payroll_drafts_enabled','off')!=='on')return {disabled:true,reason:'Office confirms the payroll cutover before scheduled preparation.'};const cutover=c.setting('payroll_cutover_date','');if(!T.validDate(cutover))throw Error('A payroll cutover date is required.');const to=new Date();to.setDate(to.getDate()-1);const end=c.ymd(to),start=new Date(to);start.setDate(start.getDate()-13);const from=c.ymd(start)>cutover?c.ymd(start):cutover;return from>end?{empty:true}:prepare(from,end,0);};
};
