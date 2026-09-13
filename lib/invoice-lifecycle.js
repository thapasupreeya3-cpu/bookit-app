'use strict';
// Withdrawal is a recorded invoice state. It never erases the issued snapshot.
module.exports=function(c,w){
 const {db,now}=c;
 db.exec(`CREATE TABLE IF NOT EXISTS invoice_withdrawals(invoice_no TEXT PRIMARY KEY,participant_id INTEGER NOT NULL,snapshot TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,withdrawn_at TEXT NOT NULL,notification_to TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS checkout_cleanup(session_id TEXT PRIMARY KEY,invoice_no TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);`);
 const row=no=>db.prepare('SELECT * FROM invoice_withdrawals WHERE invoice_no=?').get(no);
 function archived(no){const r=row(no);if(!r)return null;return {...JSON.parse(r.snapshot),withdrawn:true,withdrawn_at:r.withdrawn_at,withdrawn_reason:r.reason,paid:0,balance:0,pay_url:''};}
 function unused(no){return !db.prepare("SELECT 1 FROM bookings WHERE invoice_no=? UNION ALL SELECT 1 FROM invoice_snapshots WHERE invoice_no=? UNION ALL SELECT 1 FROM invoice_withdrawals WHERE invoice_no=? UNION ALL SELECT 1 FROM erasures WHERE kind='invoice' AND (label=? OR label LIKE ?) LIMIT 1").get(no,no,no,no,no+' %');}
 function queueCheckout(no,session){if(!session)return;db.prepare("INSERT OR IGNORE INTO checkout_cleanup(session_id,invoice_no,next_at,updated_at) VALUES(?,?,?,?)").run(session,no,now(),now());}
 function cancelLinks(no){for(const r of db.prepare("SELECT DISTINCT stripe_session FROM bookings WHERE invoice_no=? AND COALESCE(stripe_session,'')<>''").all(no))queueCheckout(no,r.stripe_session);db.prepare("UPDATE bookings SET pay_url='' WHERE invoice_no=?").run(no);}
 function noticeTarget(inv){const original=db.prepare('SELECT recipient FROM delivery_outbox WHERE event_key=?').get('invoice:'+inv.invoice_no)?.recipient;return original||inv.payer_email||(inv.self?inv.participant.email:inv.bill_to.find(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))||'';}
 function withdraw(no,user,reason){
   const existing=row(no);if(existing)return {ok:true,duplicate:true,lines:JSON.parse(existing.snapshot).booking_ids.length,held:true,notice:'queued or already sent'};
   const inv=c.invoiceFor(no);if(!inv){const e=Error('No such active invoice.');e.status=404;throw e;}
   if(db.prepare("SELECT 1 FROM bookings WHERE invoice_no=? AND claim_status='paid'").get(no)&&inv.paid<=0)throw Error('This invoice has a shift marked paid. Review its recorded payment before withdrawal.');
   if(inv.paid>0)throw Error(`This invoice has a recorded payment of $${inv.paid.toFixed(2)}. Open payment review to correct or reverse that payment before withdrawing the invoice.`);
   if(db.prepare("SELECT 1 FROM invoice_payment_evidence WHERE invoice_no=? AND state='exception'").get(no))throw Error('This invoice has an unmatched payment. Resolve it in payment review before withdrawal.');
   const to=noticeTarget(inv),rows=db.prepare('SELECT id,stripe_session FROM bookings WHERE invoice_no=?').all(no);
   db.exec('BEGIN IMMEDIATE');try{
     w.storeInvoice(inv);
     db.prepare('INSERT INTO invoice_withdrawals(invoice_no,participant_id,snapshot,reason,actor,withdrawn_at,notification_to) VALUES(?,?,?,?,?,?,?)').run(no,inv.participant.id,JSON.stringify(inv),reason,user.name,now(),to);
     c.recordErasure('invoice',inv.participant.id,`${no} ${inv.participant.name} $${inv.total.toFixed(2)}`,{invoice_no:no,booking_ids:rows.map(r=>r.id)},reason,user.name);
     // A message already with the provider cannot be recalled. Its withdrawal notice follows it.
     db.prepare("UPDATE delivery_outbox SET status='cancelled',payload='[]',error='Invoice withdrawn before delivery',lease_until=NULL WHERE event_key=? AND status IN ('queued','retry','failed')").run('invoice:'+no);
     for(const r of rows)queueCheckout(no,r.stripe_session);
     db.prepare("UPDATE bookings SET invoice_no='',claim_status='',claim_ref=NULL,claimed_at=NULL,paid_at=NULL,pay_url=NULL,stripe_session=NULL,claim_hold=1,hold_reason=? WHERE invoice_no=?").run(('Withdrawn '+no+': '+reason).slice(0,200),no);
     if(to)c.sendMail(to,`Invoice ${no} has been withdrawn — The Care Web`,'Invoice withdrawn — do not pay',`<p>Invoice <b>${no}</b> has been withdrawn and should not be paid. Reason: ${c.escHtml(reason)}</p><p>If a corrected invoice is issued, it will have a new number and arrive separately.</p>`,'View invoice history',c.appUrl+'/#/statements',undefined,[],{kind:'invoice',event_key:'invoice-withdrawal:'+no,transactional:true,invoice_no:no,withdrawal_notice:true});
     db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   wake();w.drain().catch(e=>console.error('[withdrawal-notice]',e.message));
   return {ok:true,lines:rows.length,held:true,notice:to?'queued':'missing recipient',card_link:rows.some(r=>r.stripe_session)?'closing':'none'};
 }
 let running;
 async function drain(){if(running)return running;running=(async()=>{
   // Catch up after a restart between payment recording and link retirement.
   for(const r of db.prepare("SELECT DISTINCT b.invoice_no FROM bookings b WHERE COALESCE(b.pay_url,'')<>'' AND (b.claim_status='paid' OR EXISTS(SELECT 1 FROM invoice_payment_evidence e WHERE e.invoice_no=b.invoice_no AND e.state IN ('recorded','reversed','opening')))").all())cancelLinks(r.invoice_no);
   for(const r of db.prepare("SELECT * FROM checkout_cleanup WHERE state IN ('queued','retry') AND next_at<=? ORDER BY next_at LIMIT 25").all(now())){
     try{
       if(!c.stripeEnabled())throw Error('Card payment provider is not configured.');
       let s;try{s=await c.stripeRequest('/v1/checkout/sessions/'+encodeURIComponent(r.session_id)+'/expire',{});}catch(e){s=await c.stripeRequest('/v1/checkout/sessions/'+encodeURIComponent(r.session_id),{}, {method:'GET'});}
       if(s.id!==r.session_id)throw Error('The provider returned a different checkout.');
       if(s.status==='expired')db.prepare("UPDATE checkout_cleanup SET state='closed',error='',attempts=attempts+1,updated_at=? WHERE session_id=?").run(now(),r.session_id);
       else if(s.status==='complete'){
         const known=db.prepare('SELECT 1 FROM invoice_payment_evidence WHERE reference=?').get('stripe:checkout:'+r.session_id);
         db.prepare("UPDATE checkout_cleanup SET state=?,error=?,attempts=attempts+1,updated_at=? WHERE session_id=?").run(known?'closed':'needs-review',known?'':'Checkout completed before it could be closed. Reconcile the provider payment.',now(),r.session_id);
         if(!known)db.prepare("INSERT OR IGNORE INTO finance_provider_events(event_id,event_type,object_id,payment_intent,invoice_no,amount_cents,currency,status,created_at,note) VALUES(?,?,?,?,?,?,?,'needs-review',?,?)").run('checkout-cleanup:'+r.session_id,'checkout.completed-during-retirement',r.session_id,typeof s.payment_intent==='string'?s.payment_intent:'',r.invoice_no,s.amount_total??null,s.currency||'',now(),'Checkout completed while its invoice was withdrawn or changed. Reconcile the actual funds.');
       }else throw Error('Checkout is still open. Closing it will retry automatically.');
     }catch(e){db.prepare("UPDATE checkout_cleanup SET state='retry',attempts=attempts+1,next_at=?,error=?,updated_at=? WHERE session_id=?").run(new Date(Date.now()+Math.min(3600000,15000*2**Math.min(r.attempts,8))).toISOString(),String(e.message).slice(0,400),now(),r.session_id);}
   }
 })().finally(()=>{running=null;});return running;}
 function wake(){setImmediate(()=>drain().catch(e=>console.error('[checkout-cleanup]',e.message)));}
 function attachCheckout(no,session){const inv=c.invoiceFor(no);if(row(no)||!inv||inv.paid>0||inv.balance<=0){queueCheckout(no,session.id);wake();return false;}db.prepare('UPDATE bookings SET stripe_session=?,pay_url=? WHERE invoice_no=?').run(session.id,session.url||'',no);return true;}
 w.onInvoicePayment=no=>{cancelLinks(no);wake();};
 w.invoiceDeliveryInvalid=no=>!!row(no)||!db.prepare('SELECT 1 FROM bookings WHERE invoice_no=?').get(no);
 function summaries(){return db.prepare('SELECT invoice_no,participant_id,reason,withdrawn_at,notification_to FROM invoice_withdrawals ORDER BY withdrawn_at DESC LIMIT 100').all().map(r=>({...r,participant:JSON.parse(row(r.invoice_no).snapshot).participant.name,notice_status:db.prepare('SELECT status FROM delivery_outbox WHERE event_key=?').get('invoice-withdrawal:'+r.invoice_no)?.status||(r.notification_to?'history':'missing recipient'),card_links:db.prepare('SELECT state,error FROM checkout_cleanup WHERE invoice_no=?').all(r.invoice_no)}));}
 return {withdraw,archived,unused,attachCheckout,cancelLinks,drain,wake,summaries,row};
};
