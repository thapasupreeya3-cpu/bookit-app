'use strict';
/* Invoice views use confirmed server records. A checkout return is never payment evidence. */
window.CarePayments = (() => {
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get=id=>document.getElementById(id),money=v=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(v)||0);
  const api=()=>window.API,identity=()=>api()?.online&&api()?.me?[api().me.id,api().me.role,!!api().me.admin,api().actingFor?.id||''].join(':'):'';
  const q=()=>new URLSearchParams(location.hash?.split('?')[1]||''),safeHref=v=>/^#\/(?!\/)/.test(String(v||''))?v:'#/journey';
  const invoiceHref=no=>'#/invoice?invoice='+encodeURIComponent(no);
  const date=v=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?new Date(String(v).slice(0,10)+'T12:00:00Z').toLocaleDateString('en-AU',{timeZone:'UTC'}):'Not set';
  const due=d=>d.due||d.due_date,amount=d=>d.balance??Math.max(0,Number(d.total)-Number(d.paid||0));
  let serial=0,active=null,alertSerial=0,alertKey='',alertFlight=null,alertRead=0,alertData=null;
  function state(d){
    if(d.status==='withdrawn')return {tone:'muted',label:'Withdrawn — do not pay',icon:'—'};
    if(d.status==='paid'||Number(amount(d))===0)return {tone:'success',label:'Paid',icon:'✓'};
    if(d.review_state==='queried'||d.status==='under-review')return {tone:'waiting',label:'Query open — payment paused',icon:'◷'};
    if(d.review_state&&d.review_state!=='approved')return {tone:'action',label:'Review completed shift',icon:'→'};
    if(d.status==='processing'||d.payment_state==='processing')return {tone:'waiting',label:'Payment processing',icon:'◷'};
    if(d.payment_pending)return {tone:'waiting',label:'Preparing secure checkout',icon:'◷'};
    if(['failed','payment_failed','payment-failed'].includes(d.status)||d.payment_state==='failed')return {tone:'urgent',label:'Payment unsuccessful — try again',icon:'!'};
    if(Number(d.paid)>0)return {tone:d.status==='overdue'?'urgent':'action',label:'Part-paid'+(d.status==='overdue'?' — balance overdue':''),icon:'→'};
    if(d.status==='overdue')return {tone:'urgent',label:'Overdue',icon:'!'};
    return {tone:'action',label:'Unpaid',icon:'→'};
  }
  const tag=s=>`<span class="cp-state" data-tone="${e(s.tone)}">${e(s.icon)} ${e(s.label)}</span>`;
  function methods(d){return (d.checkout_methods||['card']).map(x=>typeof x==='string'?x:x.id).filter(x=>['card','payto'].includes(x));}
  function controls(d,publicView=false){
    if(d.status==='withdrawn')return '<p>This invoice is withdrawn. Keep it for your records; no payment is due.</p>';
    if(Number(amount(d))===0||d.status==='paid')return '<p>Payment is recorded. Your remaining balance is '+money(0)+'.</p>';
    const funding=d.funding||d.plan,managed=funding==='ndia'||(funding==='plan'&&!publicView),payAfterReview=d.can_pay_after_review===true,reviewAllowed=!publicView&&d.can_review,canReview=reviewAllowed&&(d.review_state!=='approved'||d.status==='under-review'),pending=d.payment_pending||d.status==='processing'||d.payment_state==='processing';
    let out=managed?`<p class="cp-notice" data-tone="waiting">◷ ${d.funding==='ndia'||d.plan==='ndia'?'NDIA-managed support — the office uses the claim process.':'Sent to your plan manager — they arrange payment. You do not need to pay personally.'}</p>`:'';
    if(d.review_state==='queried'||d.status==='under-review')out+='<p class="cp-notice" data-tone="waiting">Your question is open. Payment remains paused while the shift is reviewed.</p>'+(d.query_note?'<blockquote class="cp-note">'+e(d.query_note)+'</blockquote>':'');
    if(canReview&&d.review_state!=='queried'){
      out+=`<form data-cp-form="review" class="cp-review"><h2>Check your completed shift</h2><p>Review the dates, hours and charges below before you approve.</p><label class="cp-confirm"><input type="checkbox" name="confirm" required> I have checked the completed shift and its charges.</label><div class="cp-buttons">${!managed&&payAfterReview&&d.checkout_enabled?'<button type="submit" class="cp-primary" name="decision" value="pay">Approve & pay</button>':''}<button type="submit" name="decision" value="later">${managed||!payAfterReview?'Approve shift':'Approve — pay by due date'}</button></div><p class="cp-small">Approving confirms the shift. Payment and its due date are shown separately.</p></form>`;
    }else if(d.review_state!=='approved'&&d.review_state!=='queried'){out+='<p>The authorised participant or helper needs to review this shift before payment is available.</p>';if(publicView&&d.review_url){try{const review=new URL(d.review_url,location.origin);if(review.origin===location.origin&&/^#\/invoice\?/.test(review.hash))out+='<p><a class="cp-link" href="'+e(review.href)+'">Sign in to review this shift</a></p>';}catch{}}}
    if(reviewAllowed&&d.review_state!=='queried')out+=`<details class="cp-query"><summary>Query this shift</summary><form data-cp-form="query"><label>Your question<textarea name="query_note" required minlength="3" maxlength="4000" rows="3"></textarea></label><button type="submit">Send question</button></form></details>`;
    if(pending)out+='<p class="cp-notice" data-tone="waiting">◷ '+(d.status==='processing'?'Payment is processing. Wait for the confirmed result before paying again.':'Your secure checkout is being prepared. Refresh to see its progress.')+'</p>';
    if(!pending&&d.status!=='under-review'&&d.can_pay&&!managed&&d.review_state==='approved'&&d.checkout_enabled){out+=`<div class="cp-buttons">${methods(d).map(m=>`<button type="button" ${m==='card'?'class="cp-primary"':''} data-cp-checkout="${m}">${m==='payto'?'Pay from bank (PayTo)':'Pay by card'}</button>`).join('')}</div>`;}
    if(!pending&&d.status!=='under-review'&&d.can_pay&&!managed&&d.review_state==='approved'&&d.bank&&(d.bank.account_number||d.bank.payid)){
      out+=`<details class="cp-bank" open><summary>Pay by bank transfer</summary><p>Use these details and the invoice number as your reference.</p><dl>${d.bank.account_name?'<div><dt>Account name</dt><dd>'+e(d.bank.account_name)+'</dd></div>':''}${d.bank.bsb?'<div><dt>BSB</dt><dd>'+e(d.bank.bsb)+'</dd></div>':''}${d.bank.account_number?'<div><dt>Account number</dt><dd>'+e(d.bank.account_number)+'</dd></div>':''}${d.bank.payid?'<div><dt>PayID</dt><dd>'+e(d.bank.payid)+'</dd></div>':''}<div><dt>Reference</dt><dd>${e(d.invoice_no)}</dd></div><div><dt>Amount remaining</dt><dd>${money(amount(d))}</dd></div></dl><p class="cp-small">Your balance updates after receipt is confirmed and matched. Keep the payment reference if you need help.</p></details>`;
    }
    if(d.review_state==='approved'&&!managed&&d.can_pay&&!d.checkout_enabled&&!d.bank?.account_number&&!d.bank?.payid)out+='<p class="cp-notice" data-tone="waiting">Payment options are being set up. Your shift remains approved. Contact the office using the details on your invoice.</p>';
    return out;
  }
  function invoiceView(d,publicView=false){
    const s=state(d),bill=Array.isArray(d.bill_to)?d.bill_to.join(' · '):typeof d.bill_to==='object'?(d.bill_to?.name||d.bill_to?.label||''):d.bill_to;
    const lines=Array.isArray(d.lines)?d.lines:[],pdf=String(d.pdf_url||'');
    let safePdf=/^\/api\/(?!\/)/.test(pdf)?pdf:!publicView&&d.pdf_url!==null?'/api/me/invoices/'+encodeURIComponent(d.invoice_no)+'.pdf':'';
    if(safePdf&&!publicView&&api()?.actingFor&&!/[?&]for=/.test(safePdf))safePdf+=(safePdf.includes('?')?'&':'?')+'for='+encodeURIComponent(api().actingFor.id);
    return `<article class="cp-invoice"><div class="cp-heading"><div><p class="cp-eyebrow">The Care Web</p><h1>Invoice ${e(d.invoice_no)}</h1>${bill?'<p>Bill to '+e(bill)+'</p>':''}</div>${tag(s)}</div><div class="cp-amounts"><div><span>Invoice total</span><strong>${money(d.total)}</strong></div><div><span>Payment recorded</span><strong>${money(d.paid)}</strong></div><div><span>Remaining balance</span><strong>${money(amount(d))}</strong></div><div><span>Payment due</span><strong>${date(due(d))}</strong></div></div>${d.review_due?'<p>Shift review due '+date(d.review_due)+'.</p>':''}<p id="cpResult" role="status" aria-live="polite" class="cp-result"></p><div class="cp-split"><section class="cp-lines"><h2>Completed support</h2>${lines.length?`<ul>${lines.map(l=>`<li><strong>${e(l.description||l.service||'Support')}</strong><p>${e(l.date||'')} ${e(l.when||l.start||'')}${l.hours!=null?' · '+e(l.hours)+' hours':l.qty!=null?' · '+e(l.qty)+' '+e(l.unit||'hours'):''}</p>${l.worker_name?'<p>Worker: '+e(l.worker_name)+'</p>':''}${l.note?'<p class="cp-note">'+e(l.note)+'</p>':''}<span>${money(l.amount??l.total)}</span></li>`).join('')}</ul>`:'<p>See your invoice PDF for the itemised charges.</p>'}${safePdf?`<a class="cp-link" href="${e(safePdf)}" target="_blank" rel="noopener noreferrer">Download invoice PDF</a>`:''}</section><section class="cp-pay"><h2>Review & payment</h2>${controls(d,publicView)}</section></div>${Array.isArray(d.transactions)&&d.transactions.length?`<details class="cp-history"><summary>Payment history</summary><ul>${d.transactions.map(t=>`<li>${date(t.received_at||t.recorded_at||t.created_at||t.date)} · ${e(t.status||t.state||'Recorded')} · ${money(t.amount)}${t.reference?' · '+e(t.reference):''}</li>`).join('')}</ul></details>`:''}<p class="cp-small">Use Refresh to check the latest confirmed payment status. Returning from checkout does not by itself confirm payment.</p><div class="cp-buttons"><button type="button" data-cp-refresh>Refresh payment status</button>${!publicView?'<a href="#/statements">All invoices</a>':''}</div></article>`;
  }
  async function call(path,opts={},publicView=false){
    if(!publicView&&api()?.call)return api().call(path,opts);
    const response=await fetch('/api'+path,{method:opts.method||'GET',credentials:'omit',headers:{'Content-Type':'application/json'},body:opts.body?JSON.stringify(opts.body):undefined,referrerPolicy:'no-referrer'});
    let d={};try{d=await response.json();}catch{}if(!response.ok){const err=Error(d.error||'Could not load this invoice.');err.status=response.status;throw err;}return d;
  }
  function context(s){return active===s&&s.serial===serial&&(!s.publicView?identity()===s.identity&&location.hash===s.hash:true);}
  async function mount(root,opts={}){
    if(!root)return;const no=opts.invoice||q().get('invoice')||'',publicView=!!opts.token;
    const target=!publicView&&api()?.me?.role==='coordinator'?Number(q().get('for')):0;
    if(target&&target!==Number(api().actingFor?.id)){
      const before=identity(),hash=location.hash,selection=++serial;root.innerHTML='<p role="status">Checking access to this participant…</p>';
      try{const d=await call('/coordinator/clients',{noFor:true});if(before!==identity()||hash!==location.hash||selection!==serial)return;const client=(d.clients||[]).find(p=>Number(p.id)===target);if(!client)throw Error('Access to this participant is no longer available.');api().actingFor=client;refreshAlerts(true);return mount(root,opts);}
      catch(err){if(before===identity()&&hash===location.hash&&selection===serial)root.innerHTML='<div class="cp-invoice"><h1>Choose an authorised participant</h1><p>'+e(err.message)+'</p><a href="#/clients">Open My clients</a></div>';return;}
    }
    if(!publicView&&api()?.me?.role==='coordinator'&&!api().actingFor){root.innerHTML='<div class="cp-invoice"><h1>Choose a participant first</h1><p>Open the person whose invoice you want to review.</p><a href="#/clients">Open My clients</a></div>';return;}
    const s={root,publicView,serial:++serial,identity:identity(),hash:location.hash,path:publicView?'/payments/public/'+encodeURIComponent(opts.token):'/payments/invoices/'+encodeURIComponent(no),data:null};active=s;
    if(!publicView&&!api()?.me){root.innerHTML='<div class="cp-invoice"><h1>Sign in to view your invoice</h1><p>Use your own account to view invoices shared with you.</p><button type="button" class="btn btn-primary" data-open-login>Sign in</button></div>';return;}
    if(!publicView&&!no){root.innerHTML='<div class="cp-invoice"><h1>Choose an invoice</h1><a href="#/statements">Open invoices & statements</a></div>';return;}
    root.innerHTML='<p role="status">Loading your invoice…</p>';
    try{s.data=await call(s.path,{},publicView);if(!context(s))return;paint(s);}
    catch(err){if(context(s))root.innerHTML=`<div class="cp-invoice" role="alert"><h1>Invoice unavailable</h1><p>${e(err.message)}</p><p>Check that the link is current, or ask the office for a new invoice link.</p><button type="button" data-cp-refresh>Try again</button></div>`;}
    root.onclick=ev=>{const b=ev.target.closest('[data-cp-refresh],[data-cp-checkout]');if(!b||!context(s))return;ev.preventDefault();if(b.hasAttribute('data-cp-refresh'))transact(s,b,()=>reload(s));else transact(s,b,()=>checkout(s,b.dataset.cpCheckout));};
    root.onsubmit=ev=>{const f=ev.target.closest('[data-cp-form]');if(!f||!context(s))return;ev.preventDefault();transact(s,ev.submitter||f.querySelector('button'),async()=>{
      const query=f.dataset.cpForm==='query',note=f.querySelector('[name=query_note]')?.value||'',confirmed=!!f.querySelector('[name=confirm]')?.checked;
      if(!query&&!confirmed)throw Error('Please confirm that you have checked the shift and charges.');
      if(query&&note.trim().length<3)throw Error('Enter your question about this shift.');
      await call(s.path+'/review',{method:'POST',body:{action:query?'queried':'approved',query_note:note,confirm:query||confirmed,fingerprint:s.data.review_fingerprint||s.data.fingerprint}},s.publicView);
      const pay=!query&&ev.submitter?.value==='pay';await reload(s);if(!context(s))return;
      result(s,query?'Question sent. Payment is paused while the shift is reviewed.':'Shift approved. Your invoice is ready.');
      refreshAlerts(true);if(pay)await checkout(s,methods(s.data)[0]||'card');
    });};
  }
  function paint(s){if(context(s))s.root.innerHTML=invoiceView(s.data,s.publicView);}
  function result(s,message,bad=false){if(!context(s))return;const node=s.root.querySelector('#cpResult');if(node){node.textContent=message;node.dataset.tone=bad?'urgent':'success';node.setAttribute('role',bad?'alert':'status');}}
  async function reload(s){const d=await call(s.path,{},s.publicView);if(context(s)){s.data=d;paint(s);}return d;}
  async function transact(s,b,fn){if(s.busy)return;s.busy=true;if(b)b.disabled=true;try{await fn();}catch(err){if(context(s)){try{await reload(s);}catch{}result(s,err.message+' Your current shift approval is kept.',true);}}finally{s.busy=false;if(b?.isConnected)b.disabled=false;}}
  async function checkout(s,method){
    const d=await call(s.path+'/checkout',{method:'POST',body:{method}},s.publicView);if(!context(s))return;
    if(d.processing){result(s,d.message||'Your secure payment link is being prepared. This will retry automatically.');s.checkoutPending=true;s.checkoutPolls=0;pollCheckout(s);return;}
    openCheckout(d.url||d.checkout_url);
  }
  function openCheckout(value){const url=new URL(value||'',location.origin);if(url.protocol!=='https:'||!['checkout.stripe.com','pay.stripe.com'].includes(url.hostname)||url.username||url.password)throw Error('The secure checkout link is unavailable. Please refresh and try again.');location.assign(url.href);}
  function pollCheckout(s){setTimeout(async()=>{if(!context(s)||!s.checkoutPending||document.hidden)return;try{const d=await reload(s);if(!context(s))return;if(d.checkout_url){s.checkoutPending=false;openCheckout(d.checkout_url);return;}if(++s.checkoutPolls<10){result(s,'Preparing your secure checkout. Please wait…');pollCheckout(s);}else{s.checkoutPending=false;result(s,'Your payment link is still being prepared. Refresh, then choose your payment method again.');}}catch(err){s.checkoutPending=false;result(s,err.message,true);}},3000);
  }
  function alertItems(d){return (d?.tasks||[]).filter(t=>t.state!=='completed'&&t.kind!=='followup');}
  function paintAlerts(d,stale=false){
    const tasks=alertItems(d),count=Number(d?.count??tasks.length)||0,label=count+' action'+(count===1?'':'s')+' need'+(count===1?'s':'')+' attention';
    for(const id of ['actionNavBadge','actionMobileBadge']){const n=get(id);if(n){n.hidden=!count;n.textContent=count>99?'99+':String(count);n.title=stale?'Could not refresh actions. Open Next actions to retry.':label;}}
    const link=get('actionNavLink');if(link){link.setAttribute('aria-label',stale?'Next actions — could not refresh':count?'Next actions, '+label:'Next actions');link.title=stale?'Could not refresh; showing the last count.':d?.as_of?'Updated '+new Date(d.as_of).toLocaleTimeString('en-AU'):'';}
    const notice=get('bookingsInvoiceNote');if(notice&&location.hash?.split('?')[0]==='#/bookings'){
      const billing=tasks.filter(t=>['review','invoice','payment'].includes(t.kind)),first=billing[0];
      notice.innerHTML=first?`<aside class="cp-action-notice" data-tone="${first.overdue?'urgent':'action'}"><span aria-hidden="true">${first.overdue?'!':'→'}</span><div><strong>${e(first.label)}</strong>${first.detail?'<p>'+e(first.detail)+'</p>':''}${first.due_at?'<p>Due '+date(first.due_at)+'</p>':''}${stale?'<p>Could not refresh. Showing the last known action.</p>':''}</div><a href="${e(safeHref(first.destination))}">${first.kind==='review'?'Review shift':'View invoice'} →</a>${billing.length>1?'<a href="#/journey">All '+billing.length+' actions</a>':''}</aside>`:stale?'<p class="cp-small" role="status">Could not refresh actions. <a href="#/journey">Open Next actions to retry</a>.</p>':'';
    }
  }
  async function refreshAlerts(force=false){
    const who=identity();if(who!==alertKey){alertKey=who;alertSerial++;alertFlight=null;alertData=null;alertRead=0;paintAlerts(null);}
    if(!who||(api().me.role==='coordinator'&&!api().actingFor)){paintAlerts(null);return;}
    if(document.hidden||(!force&&(alertFlight||Date.now()-alertRead<25000)))return;
    const n=++alertSerial;alertFlight=n;try{const d=await call('/me/action-alerts');if(n!==alertSerial||identity()!==who)return;alertData=d;alertRead=Date.now();paintAlerts(d);}
    catch(err){if(n===alertSerial&&identity()===who){if(err.status===401||err.status===403){alertData=null;paintAlerts(null);}else paintAlerts(alertData,true);}}
    finally{if(alertFlight===n)alertFlight=null;}
  }
  function renderBookingNotice(){paintAlerts(alertData);return refreshAlerts(true);}
  function sync(){refreshAlerts(true);if(location.hash?.split('?')[0]==='#/invoice')mount(get('paymentInvoice'));
    if(location.hash?.split('?')[0]==='#/payment-tracking')renderOffice();}
  function changed(path){if(!path.startsWith('/journey/events'))refreshAlerts(true);}
  function renderInvoice(){return mount(get('paymentInvoice'));}
  let officeSerial=0,officeActive=null,officeIdentity='',officeViews={};
  const officeTabs={invoices:'Invoices',receipts:'Received payments',exceptions:'Payment exceptions',setup:'Payment connections'};
  const officeKeys={invoices:'payments',receipts:'receipts',exceptions:'payment-exceptions',setup:'payment-settings'};
  const requestKey=()=>window.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const officeTab=()=>Object.hasOwn(officeTabs,q().get('tab'))?q().get('tab'):'invoices';
  const person=i=>typeof i.participant==='object'?i.participant?.name||'':i.participant||i.participant_name||'';
  const receiptBalance=t=>Number(t.balance??Number(t.amount)-Number(t.allocated||0));
  const receiptStatus=t=>({'needs_matching':'needs-matching','unmatched':'needs-matching','partial':'part-matched','partially_allocated':'part-matched'}[t.status||t.state]||t.status||t.state||'needs-review');
  const receiptLabel=t=>({'needs-matching':'Needs matching','part-matched':'Part matched','matched':'Matched','exception':'Needs review','needs-review':'Needs review'}[receiptStatus(t)]||receiptStatus(t).replaceAll('_',' '));
  const receiptAction=t=>['needs-matching','part-matched','exception','needs-review'].includes(receiptStatus(t))&&receiptBalance(t)>0;
  const settlement=t=>t.settlement_status&&t.settlement_status!=='not_confirmed'?t.settlement_status.replaceAll('_',' '):'Bank deposit not confirmed';
  const officeFilters={
    invoices:[['all','All statuses'],['outstanding','Outstanding balance'],['review','Awaiting review / queried'],['processing','Processing'],['part-paid','Part-paid'],['paid','Paid'],['overdue','Overdue'],['failed','Payment failed'],['withdrawn','Withdrawn']],
    receipts:[['all','All receipts'],['unmatched','Needs matching / review'],['part-matched','Part matched'],['matched','Matched'],['settlement','Bank deposit not confirmed']]
  };
  function officeCurrent(s){return officeActive===s&&s.serial===officeSerial&&s.identity===identity()&&s.hash===location.hash&&!!api()?.me?.admin;}
  function invoiceMatches(i,status){
    if(status==='all')return true;
    if(status==='withdrawn')return i.status==='withdrawn';
    if(i.status==='withdrawn')return false;
    if(status==='paid')return i.status==='paid'||Number(amount(i))===0;
    if(status==='outstanding')return Number(amount(i))>0;
    if(status==='review')return i.status==='under-review'||(i.review_state&&i.review_state!=='approved');
    if(status==='processing')return i.payment_pending||i.status==='processing'||i.payment_state==='processing';
    if(status==='part-paid')return Number(i.paid)>0&&Number(amount(i))>0;
    if(status==='overdue')return i.status==='overdue';
    return status==='failed'&&(['failed','payment_failed','payment-failed'].includes(i.status)||i.payment_state==='failed');
  }
  function officePage(d,view={}){
    const tab=Object.hasOwn(officeTabs,view.tab)?view.tab:'invoices',query=String(view.search||'').trim().toLocaleLowerCase('en-AU');
    const filter=(officeFilters[tab]||[['all','All']]).some(([v])=>v===view.filter)?view.filter:'all';
    const source=tab==='receipts'?d.transfers||[]:tab==='exceptions'?d.exceptions||[]:tab==='setup'?d.accounts||[]:d.invoices||[];
    const rows=source.filter(row=>{
      if(tab==='invoices'&&!invoiceMatches(row,filter))return false;
      if(tab==='receipts'&&filter!=='all'){
        const status=receiptStatus(row);
        if(filter==='unmatched'&&!['needs-matching','exception','needs-review'].includes(status))return false;
        if(['part-matched','matched'].includes(filter)&&status!==filter)return false;
        if(filter==='settlement'&&row.settlement_status&&row.settlement_status!=='not_confirmed')return false;
      }
      if(!query)return true;
      const fields=tab==='invoices'?[row.invoice_no,person(row),row.payer_email]:tab==='receipts'?[person(row),row.reference,row.provider_transaction_id,row.provider,row.invoice_no,row.id]:tab==='setup'?[person(row),row.participant_id,row.bsb,row.account_number,row.environment]:[row.label,row.message,row.note,row.detail,row.reason,row.kind,row.invoice_no,row.provider];
      return fields.join(' ').toLocaleLowerCase('en-AU').includes(query);
    });
    const pages=Math.max(1,Math.ceil(rows.length/25)),page=Math.min(pages,Math.max(1,Math.floor(Number(view.page)||1)));
    return {tab,filter,search:String(view.search||''),page,pages,total:source.length,matched:rows.length,rows:rows.slice((page-1)*25,page*25),start:rows.length?(page-1)*25+1:0,end:Math.min(page*25,rows.length)};
  }
  function officeToolbar(d,v){
    const p=officePage(d,v),searchLabel=p.tab==='invoices'?'Find an invoice':p.tab==='receipts'?'Find a received payment':p.tab==='setup'?'Find a receiving account':'Find a payment exception';
    return `<div class="cp-office-filters"><label>${searchLabel}<input type="search" data-cp-office-search value="${e(p.search)}" placeholder="${p.tab==='invoices'?'Invoice number, participant or payer email':p.tab==='receipts'?'Reference, participant or provider':p.tab==='setup'?'Participant or receiving account':'Invoice or issue'}"></label>${officeFilters[p.tab]?`<label>Status<select data-cp-office-filter>${officeFilters[p.tab].map(([value,label])=>`<option value="${value}"${p.filter===value?' selected':''}>${label}</option>`).join('')}</select></label>`:''}</div>`;
  }
  function officePagination(p){return `<div class="cp-pagination"><p role="status" aria-live="polite">${p.matched?'Showing '+p.start+'–'+p.end+' of '+p.matched:'No matching records'}${p.matched!==p.total?' ('+p.total+' loaded)':''}</p>${p.pages>1?`<div><button type="button" data-cp-office-page="${p.page-1}"${p.page===1?' disabled':''} aria-label="Previous page">Previous</button><span>Page ${p.page} of ${p.pages}</span><button type="button" data-cp-office-page="${p.page+1}"${p.page===p.pages?' disabled':''} aria-label="Next page">Next</button></div>`:''}</div>`;}
  function invoiceRows(rows){return rows.map(i=>`<tr><td><a href="${e(invoiceHref(i.invoice_no))}">${e(i.invoice_no)}</a><br>${e(person(i))}<br><small>${e(i.payer_email||'')}</small><br><a class="cp-row-action" href="#/admin/money?section=history&amp;invoice=${e(encodeURIComponent(i.invoice_no))}">Invoice actions</a></td><td>${tag(state(i))}${i.delivery_status?'<br><small>Email: '+e(i.delivery_status)+'</small>':''}</td><td>${money(i.paid)}</td><td>${money(amount(i))}</td><td>${date(due(i))}</td><td>${e(settlement(i))}</td></tr>`).join('');}
  function receiptRows(d,rows){
    const invoiceOptions=t=>(d.invoices||[]).filter(i=>i.status!=='withdrawn'&&Number(amount(i))>0&&(!t.participant_id||!(i.participant_id||i.participant?.id)||Number(i.participant_id||i.participant?.id)===Number(t.participant_id))).map(i=>`<option value="${e(i.invoice_no)}">${e(i.invoice_no)} · ${e(person(i))} · ${money(amount(i))} due</option>`).join('');
    return rows.map(t=>`<tr><td>${date(t.received_at||t.created_at)}<br><small>${e(t.provider==='stripe'?'Stripe':t.provider==='zai'?'Zai bank transfer':t.provider||'Payment record')}</small><br>${e(person(t)||'Payer not identified')}</td><td>${e(t.reference||t.provider_transaction_id||t.id)}</td><td>${money(t.amount)}</td><td>${money(receiptBalance(t))}</td><td>${tag({tone:receiptAction(t)?'action':'muted',icon:receiptAction(t)?'→':'—',label:receiptLabel(t)})}<br>${e(settlement(t))}</td><td>${receiptAction(t)?`<details><summary>Match payment</summary><form data-cp-office-form="allocate" data-transfer="${e(t.id)}" data-request-key="${e(requestKey())}"><label>Invoice<select name="invoice_no" required><option value="">Choose invoice</option>${invoiceOptions(t)}</select></label><label>Amount to apply<input name="amount" type="number" min="0.01" step="0.01" max="${receiptBalance(t).toFixed(2)}" value="${receiptBalance(t).toFixed(2)}" required></label><label><input name="confirm" type="checkbox" required> I checked the payer, reference and invoice.</label><button type="submit">Apply payment</button><p role="status" data-cp-form-status></p></form></details>`:t.invoice_no?e(t.invoice_no):'Recorded'}</td></tr>`).join('');
  }
  function officeResults(d,v){
    const p=officePage(d,v);let content='';
    if(!p.rows.length)content=`<div class="cp-empty"><p><strong>${p.total?'No results for these filters.':p.tab==='invoices'?'No invoices yet.':p.tab==='receipts'?'No received payments yet.':p.tab==='exceptions'?'No payment exceptions recorded.':'No receiving accounts assigned yet.'}</strong></p><p>${p.total?'Try another search or clear the filters.':p.tab==='invoices'?'Invoices appear here when completed shifts enter billing.':p.tab==='receipts'?'Confirmed provider receipts appear here automatically.':p.tab==='exceptions'?'Items needing office attention will appear here.':'Assign a provider-issued account below when bank-transfer tracking is ready.'}</p>${p.total?'<button type="button" data-cp-office-clear>Clear filters</button>':''}</div>`;
    else if(p.tab==='invoices'||p.tab==='receipts')content=`<div class="cp-table-wrap" role="region" aria-label="${officeTabs[p.tab]}" tabindex="0"><table><thead><tr>${(p.tab==='invoices'?['Invoice / person','Status','Payment recorded','Balance','Due','Bank settlement']:['Received / person','Reference','Amount','Unallocated','Status / settlement','Action']).map(x=>'<th scope="col">'+x+'</th>').join('')}</tr></thead><tbody>${p.tab==='invoices'?invoiceRows(p.rows):receiptRows(d,p.rows)}</tbody></table></div>`;
    else if(p.tab==='exceptions')content='<ul class="cp-exceptions">'+p.rows.map(x=>'<li><div>'+tag({tone:x.status==='retry'?'waiting':'action',icon:x.status==='retry'?'◷':'→',label:x.status==='retry'?'Retry scheduled':'Needs review'})+'<strong>'+e(x.label||x.message||x.note||x.reason||x.kind||(x.invoice_no?'Payment issue — '+x.invoice_no:'Payment requires review'))+'</strong>'+(x.detail?'<p>'+e(x.detail)+'</p>':'')+(x.next_at?'<p class="cp-small">Next retry: '+e(new Date(x.next_at).toLocaleString('en-AU'))+'</p>':'')+'</div>'+((x.destination||x.dest)?'<a href="'+e(safeHref(x.destination||x.dest))+'">'+e(x.label||'Review payment exception')+' →</a>':x.invoice_no?'<a href="'+e(invoiceHref(x.invoice_no))+'">Open invoice →</a>':'')+'</li>').join('')+'</ul>';
    else content='<ul class="cp-account-list">'+p.rows.map(a=>'<li><strong>'+e(person(a)||'#'+a.participant_id)+'</strong><span>'+e(a.bsb||'')+' '+e(a.account_number||a.payid||'')+'</span><span>'+e(a.environment||'Environment not recorded')+'</span></li>').join('')+'</ul>';
    return content+officePagination(p);
  }
  function setupView(d,v){
    const stripe=d.providers?.stripe||{},zai=d.providers?.zai||{};
    return `<p>Connection settings and receiving accounts. A saved configuration does not confirm a successful payment or deposit.</p><div class="cp-provider-grid"><article class="cp-provider"><h3>Card & PayTo</h3>${tag({tone:stripe.configured?'waiting':'action',icon:stripe.configured?'◷':'→',label:stripe.configured?'Stripe settings present':'Stripe not configured'})}<p>PayTo ${stripe.payto_enabled?'enabled':'not enabled'}</p><p>Environment: ${e(stripe.environment||'Not selected')}</p></article><article class="cp-provider"><h3>Bank-transfer tracking</h3>${tag({tone:zai.configured&&zai.enabled?'waiting':'action',icon:zai.configured&&zai.enabled?'◷':'→',label:zai.configured&&zai.enabled?'Zai settings present':'Zai setup incomplete'})}<p>Environment: ${e(zai.environment||'Not selected')}</p>${zai.missing?.length?'<p>Still needed: '+zai.missing.map(e).join(', ')+'</p>':''}</article></div><p class="cp-small">Confirm provider access with a completed test payment. Confirm deposits separately using provider and bank records.</p><h3>Receiving account assignments</h3>${officeToolbar(d,v)}<div data-cp-office-results tabindex="-1">${officeResults(d,v)}</div><details class="cp-setup-form"><summary>Assign a receiving account</summary><p>Choose the participant and enter the account IDs supplied by Zai. The server checks the account with the provider before saving it.</p>${d.participantsError?'<p role="alert">Participant list unavailable. Refresh to try again.</p>':''}<form data-cp-office-form="account"><label>Participant<select name="participant_id" required${d.participantsError?' disabled':''}><option value="">Choose participant</option>${(d.participants||[]).map(p=>`<option value="${Number(p.id)}">${e(p.name)} · ${e(p.email)}</option>`).join('')}</select></label><label>Zai user ID<input name="provider_user_id" required maxlength="200"></label><label>Zai wallet account ID<input name="wallet_account_id" required maxlength="200"></label><label>Zai virtual account ID<input name="virtual_account_id" required maxlength="200"></label><button type="submit"${d.participantsError?' disabled':''}>Verify & save receiving account</button><p role="status" data-cp-form-status></p></form></details>`;
  }
  function officeView(d,view={}){
    const tab=Object.hasOwn(officeTabs,view.tab)?view.tab:'invoices',v={...view,tab};
    const summary=tab==='invoices'?'Track customer payments here. Confirm deposits using your provider and bank records.':tab==='receipts'?'Clear matches are applied automatically. Check the payer and invoice before allocating an unmatched receipt.':tab==='exceptions'?'Review failed payments, unmatched provider events and jobs waiting to retry.':'';
    const fallback=!window.CareAdmin?'<nav class="cp-office-tabs" aria-label="Payment pages">'+Object.entries(officeTabs).map(([key,label])=>'<a href="#/payment-tracking?tab='+key+'"'+(key===tab?' aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>':'';
    return `<div class="cp-office" data-cp-office-tab="${tab}"><div class="cp-heading"><div><p class="cp-eyebrow">Money</p><h1>${officeTabs[tab]}</h1>${summary?'<p>'+summary+'</p>':''}</div><button type="button" data-cp-office-refresh>Refresh</button></div>${fallback}<p role="status" aria-live="polite" id="cpOfficeStatus"></p><section aria-label="${officeTabs[tab]}">${tab==='setup'?setupView(d,v):officeToolbar(d,v)+'<div data-cp-office-results tabindex="-1">'+officeResults(d,v)+'</div>'}${tab==='exceptions'?'<p><button type="button" data-cp-retry>Retry pending payment jobs</button></p><p class="cp-small">Retrying queues outstanding jobs. Their confirmed result appears after processing.</p>':''}</section>${['invoices','receipts'].includes(tab)?'<p class="cp-small">Includes all records needing action and up to 250 recent closed records. Payment recorded does not by itself confirm a deposit into your business bank account.</p>':''}${tab==='invoices'?'<p class="cp-small">Customer payment does not confirm that wages have been transferred. <a href="#/journey?panel=payroll">Open worker pay</a>.</p>':''}</div>`;
  }
  function decorateOffice(s){bindOffice(s.root,s);window.CareAdmin?.decorate(s.root,officeKeys[s.tab]);}
  async function renderOffice(message=''){
    const root=get('paymentTracking');if(!root)return;
    const who=identity(),tab=officeTab(),hash=location.hash;
    if(officeIdentity!==who){officeIdentity=who;officeViews={};}
    const view=officeViews[tab]||(officeViews[tab]={tab,search:'',filter:'all',page:1});
    const s={root,identity:who,hash,tab,view,serial:++officeSerial,data:null};officeActive=s;
    if(!api()?.me?.admin){root.innerHTML='<p role="alert">Office access is required to view payment tracking.</p>';return;}
    root.innerHTML='<div class="cp-office"><h1>'+officeTabs[tab]+'</h1><p role="status">Loading '+officeTabs[tab].toLowerCase()+'…</p></div>';
    try{
      const requests=[call('/admin/payments/dashboard')];
      if(tab==='setup')requests.push(call('/admin/payments/participants').catch(()=>({participants:[],participantsError:true})));
      const [d,people]=await Promise.all(requests);if(!officeCurrent(s))return;
      s.data={...d,participants:people?.participants||[],participantsError:people?.participantsError||false};root.innerHTML=officeView(s.data,s.view);decorateOffice(s);
      if(message){const status=root.querySelector('#cpOfficeStatus');if(status)status.textContent=message;}
    }catch(err){if(officeCurrent(s)){root.innerHTML='<div class="cp-office"><h1>'+officeTabs[tab]+'</h1><p role="alert">'+e(err.message)+'</p><p>Your payment records could not be loaded. Try again.</p><button type="button" data-cp-office-refresh>Try again</button></div>';decorateOffice(s);}}
  }
  function refreshOfficeList(s){if(!officeCurrent(s)||!s.data)return;const node=s.root.querySelector('[data-cp-office-results]');if(node)node.innerHTML=officeResults(s.data,s.view);}
  function bindOffice(root,s){
    root.oninput=ev=>{if(!officeCurrent(s)||!ev.target.matches?.('[data-cp-office-search]'))return;s.view.search=ev.target.value;s.view.page=1;refreshOfficeList(s);};
    root.onchange=ev=>{if(!officeCurrent(s)||!ev.target.matches?.('[data-cp-office-filter]'))return;s.view.filter=ev.target.value;s.view.page=1;refreshOfficeList(s);};
    root.onclick=async ev=>{
      if(!officeCurrent(s))return;
      if(ev.target.closest('[data-cp-office-refresh]')){if(!s.busy)renderOffice();return;}
      const next=ev.target.closest('[data-cp-office-page]');if(next){if(!next.disabled&&!s.busy){s.view.page=Number(next.dataset.cpOfficePage)||1;refreshOfficeList(s);root.querySelector('[data-cp-office-results]')?.focus?.();}return;}
      if(ev.target.closest('[data-cp-office-clear]')){s.view.search='';s.view.filter='all';s.view.page=1;const search=root.querySelector('[data-cp-office-search]'),filter=root.querySelector('[data-cp-office-filter]');if(search)search.value='';if(filter)filter.value='all';refreshOfficeList(s);search?.focus?.();return;}
      const b=ev.target.closest('[data-cp-retry]');if(!b||b.disabled||s.busy)return;s.busy=true;b.disabled=true;
      try{await call('/admin/payments/retry',{method:'POST',body:{}});if(officeCurrent(s))await renderOffice('Pending jobs were queued for retry. Refresh to see confirmed results.');}
      catch(err){if(officeCurrent(s)){const msg=root.querySelector('#cpOfficeStatus');if(msg){msg.textContent=err.message;msg.setAttribute('role','alert');}}}finally{s.busy=false;if(b.isConnected)b.disabled=false;}
    };
    root.onsubmit=async ev=>{
      const f=ev.target.closest('[data-cp-office-form]');if(!f)return;ev.preventDefault();if(!officeCurrent(s)||s.busy)return;
      const b=f.querySelector('button'),status=f.querySelector('[data-cp-form-status]');if(!b||b.disabled)return;s.busy=true;b.disabled=true;const value=n=>f.querySelector('[name='+n+']')?.value||'';
      try{
        let message='Receiving account verified and saved.';
        if(f.dataset.cpOfficeForm==='allocate'){
          if(!f.querySelector('[name=confirm]')?.checked)throw Error('Confirm that you checked the payment and invoice.');
          await call('/admin/payments/transfers/'+encodeURIComponent(f.dataset.transfer)+'/allocate',{method:'POST',body:{invoice_no:value('invoice_no'),amount:Number(value('amount')),confirm:true,idempotency_key:f.dataset.requestKey||(f.dataset.requestKey=requestKey())}});message='Payment allocation saved. Invoice balances have been refreshed.';
        }else await call('/admin/payments/zai/accounts',{method:'POST',body:{participant_id:Number(value('participant_id')),provider_user_id:value('provider_user_id'),wallet_account_id:value('wallet_account_id'),virtual_account_id:value('virtual_account_id')}});
        if(officeCurrent(s)){await renderOffice(message);refreshAlerts(true);}
      }catch(err){if(officeCurrent(s)&&status){status.textContent=err.message;status.setAttribute('role','alert');}}finally{s.busy=false;if(b.isConnected)b.disabled=false;}
    };
  }
  if(document.addEventListener){document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAlerts(true);});}
  if(window.addEventListener){window.addEventListener('focus',()=>refreshAlerts());window.addEventListener('hashchange',()=>refreshAlerts());}
  if(typeof setInterval==='function')setInterval(()=>refreshAlerts(),30000);
  return {mount,renderInvoice,renderOffice,renderBookingNotice,sync,changed,refreshAlerts,invoiceView,officeView,officePage,state,controls,invoiceHref};
})();
CarePayments.sync();
{const page=document.getElementById('paymentPage');if(page?.dataset?.paymentToken)CarePayments.mount(page,{token:page.dataset.paymentToken});}
