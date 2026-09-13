'use strict';
// Provider confirmations, invoice access and receipt allocation share one durable ledger.
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cents = value => Math.round(Number(value || 0) * 100);
const money = value => Number(value || 0) / 100;
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const enabled = value => /^(1|true|on|yes)$/i.test(String(value || ''));

module.exports = function createPayments(c, w) {
  const { db, now, json } = c;
  const production=c.production===true;
  const zai = c.zaiClient || require('./zai-payments').createZaiClient({ env: process.env });
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_invoice_access (
      invoice_no TEXT PRIMARY KEY, nonce TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
      paused_at TEXT, pause_reason TEXT NOT NULL DEFAULT '', reviewed_at TEXT);
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL, method TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      state TEXT NOT NULL, checkout_id TEXT UNIQUE, payment_intent TEXT, checkout_url TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS payment_attempt_invoice ON payment_attempts(invoice_no, created_at);
    CREATE TABLE IF NOT EXISTS payment_provider_jobs (
      event_key TEXT PRIMARY KEY, provider TEXT NOT NULL, payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      next_at TEXT NOT NULL, created_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS payment_accounts (
      participant_id INTEGER NOT NULL, environment TEXT NOT NULL, provider_user_id TEXT NOT NULL,
      wallet_account_id TEXT NOT NULL, virtual_account_id TEXT NOT NULL, bsb TEXT NOT NULL,
      account_number TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '', payid TEXT NOT NULL DEFAULT '',
      verified_at TEXT NOT NULL, verified_by INTEGER NOT NULL,
      PRIMARY KEY(participant_id,environment), UNIQUE(environment,wallet_account_id), UNIQUE(environment,virtual_account_id));
    CREATE TABLE IF NOT EXISTS payment_transfers (
      id INTEGER PRIMARY KEY, provider TEXT NOT NULL, environment TEXT NOT NULL,
      provider_transaction_id TEXT NOT NULL, participant_id INTEGER, wallet_account_id TEXT,
      invoice_no TEXT, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'AUD',
      reference TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'needs-matching',
      received_at TEXT NOT NULL, settlement_status TEXT NOT NULL DEFAULT 'not_confirmed',
      UNIQUE(provider,environment,provider_transaction_id));
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id INTEGER PRIMARY KEY, transfer_id INTEGER NOT NULL REFERENCES payment_transfers(id),
      invoice_no TEXT NOT NULL, amount_cents INTEGER NOT NULL, reference TEXT UNIQUE NOT NULL,
      actor_id INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY, invoice_no TEXT, event_key TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  `);
  if (!c.setting('payment_automation_started_at', '')) c.setSetting('payment_automation_started_at', now());
  const start = c.setting('payment_automation_started_at', now());
  let ticking = null;
  const inFlight = new Map();
  const event = (no, key, kind, detail = '') => db.prepare('INSERT OR IGNORE INTO payment_events(invoice_no,event_key,kind,detail,created_at) VALUES(?,?,?,?,?)').run(no || null, key, kind, clean(detail, 1000), now());
  const getInvoice = no => c.invoiceFor(no) || c.invoiceFlow.archived(no);
  const sourceRows = no => db.prepare('SELECT id,participant_id,status,approval_state,approval_source,approval_from,approved_at,query_at,query_note,voided FROM bookings WHERE invoice_no=? ORDER BY id').all(no);
  function state(no) {
    const inv = getInvoice(no), access = db.prepare('SELECT * FROM payment_invoice_access WHERE invoice_no=?').get(no);
    const rows = sourceRows(no);
    const queried = rows.some(b => b.approval_state === 'queried');
    const approved = rows.length > 0 && rows.every(b => (b.approval_state === 'approved' && b.approval_source !== 'deemed') || b.status === 'cancelled');
    const paused = !!(access?.paused_at || queried);
    return { inv, access, rows, approved, paused, review: queried ? 'queried' : approved ? 'approved' : 'pending' };
  }
  function fingerprint(no) {
    const s = state(no);
    return digest(JSON.stringify({ invoice: no, total: s.inv?.total, lines: s.inv?.lines, withdrawn: !!s.inv?.withdrawn,
      rows: s.rows.map(b => [b.id,b.approval_state,b.approved_at,b.query_at,b.voided]), paused: s.paused }));
  }
  function rawToken(no, nonce) { return digest(c.sign('invoice-payment:' + no + ':' + nonce)); }
  function invoiceCreated(inv) {
    if (!inv || inv.withdrawn) return null;
    let record = db.prepare('SELECT * FROM payment_invoice_access WHERE invoice_no=?').get(inv.invoice_no);
    if (!record) {
      const nonce = crypto.randomBytes(24).toString('hex'), token = rawToken(inv.invoice_no, nonce);
      const expires = new Date(Math.max(Date.now(), Date.parse(inv.due || '') || 0) + 90 * 864e5).toISOString();
      db.prepare('INSERT OR IGNORE INTO payment_invoice_access(invoice_no,nonce,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(inv.invoice_no, nonce, digest(token), now(), expires);
      record = db.prepare('SELECT * FROM payment_invoice_access WHERE invoice_no=?').get(inv.invoice_no);
    }
    return record;
  }
  function invoiceUrl(no) {
    const inv = getInvoice(no), access = invoiceCreated(inv);
    if (!access || access.revoked_at || access.expires_at <= now()) return c.appUrl + '/#/invoice?invoice=' + encodeURIComponent(no);
    return c.appUrl + '/pay/' + rawToken(no, access.nonce);
  }
  function tokenInvoice(token) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const a = db.prepare('SELECT * FROM payment_invoice_access WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(digest(token), now());
    return a ? getInvoice(a.invoice_no) : null;
  }
  function canRead(req, user, inv) {
    if (!user || !inv) return false;
    return !!user.admin || c.actFor(req,user,'invoices')?.id === inv.participant.id || c.actFor(req,user,'bookings')?.id === inv.participant.id;
  }
  function canReview(req,user,inv) {
    // Office staff and payment-link recipients cannot substitute for a participant's review.
    return !!user && c.actFor(req,user,'bookings')?.id === inv.participant.id && !inv.withdrawn;
  }
  function canPay(req,user,inv,publicAccess=false) {
    const s = state(inv.invoice_no);
    if (inv.withdrawn || inv.balance <= 0 || !s.approved || s.paused || !['self','private',...(publicAccess?['plan']:[])].includes(inv.funding)) return false;
    if(db.prepare("SELECT 1 FROM payment_attempts WHERE invoice_no=? AND state='processing'").get(inv.invoice_no))return false;
    return publicAccess || (!!user && c.actFor(req,user,'invoices')?.id === inv.participant.id);
  }
  function bankFor(inv) {
    const config = zai.getStatus();
    const account = config.enabled && config.configured && (!production || config.environment === 'live') ? db.prepare('SELECT * FROM payment_accounts WHERE participant_id=? AND environment=?').get(inv.participant.id,config.environment) : null;
    if (account) return {bsb:account.bsb,account_number:account.account_number,account_name:account.account_name,payid:account.payid,automatically_tracked:true,environment:account.environment};
    return {...c.bankDetails(), automatically_tracked:false};
  }
  function invoiceStatus(inv,s) {
    if (inv.withdrawn) return 'withdrawn';
    if (s.paused) return 'under-review';
    if (inv.balance <= 0) return 'paid';
    const attempt = db.prepare('SELECT * FROM payment_attempts WHERE invoice_no=? ORDER BY created_at DESC,id DESC LIMIT 1').get(inv.invoice_no);
    if (attempt?.state === 'processing') return 'processing';
    if (inv.paid > 0) return 'part-paid';
    if (!s.approved) return 'awaiting-review';
    if (attempt?.state === 'failed') return 'payment-failed';
    return inv.due < c.ymd() ? 'overdue' : 'unpaid';
  }
  function summary(inv,req,user,publicAccess=false) {
    const s=state(inv.invoice_no), allowedPay=canPay(req,user,inv,publicAccess);
    const last=db.prepare('SELECT * FROM payment_attempts WHERE invoice_no=? ORDER BY created_at DESC,id DESC LIMIT 1').get(inv.invoice_no);
    const transactions=db.prepare("SELECT id,amount,recorded_at,recorded_at AS received_at,state FROM invoice_payment_evidence WHERE invoice_no=? AND state IN ('recorded','opening','reversed') ORDER BY id").all(inv.invoice_no);
    return {invoice_no:inv.invoice_no,funding:inv.funding,withdrawn:!!inv.withdrawn,total:inv.total,paid:inv.paid,balance:inv.balance,
      due:inv.due,due_date:inv.due_date,issued:inv.issued,status:invoiceStatus(inv,s),review_state:s.review,
      can_review:!publicAccess && canReview(req,user,inv),can_pay:allowedPay,
      can_pay_after_review:!publicAccess&&['self','private'].includes(inv.funding)&&c.actFor(req,user,'invoices')?.id===inv.participant.id,
      review_url:c.appUrl+'/#/invoice?invoice='+encodeURIComponent(inv.invoice_no),
      review_due:s.rows[0]?.approval_from?new Date(Date.parse(s.rows[0].approval_from)+7*864e5).toISOString():null,
      query_note:publicAccess?'':s.rows.find(b=>b.query_note)?.query_note||'',
      review_fingerprint:!publicAccess?fingerprint(inv.invoice_no):null,fingerprint:!publicAccess?fingerprint(inv.invoice_no):null,
      lines:publicAccess?inv.lines.map(l=>({date:l.date,description:'Delivered support',qty:l.qty,unit:l.unit,rate:l.rate,amount:l.amount})):inv.lines,
      bill_to:publicAccess?[]:inv.bill_to,participant:publicAccess?undefined:inv.participant.name,
      bank:inv.withdrawn || s.paused || !s.approved ? null : bankFor(inv),
      checkout_enabled:c.stripeEnabled(),checkout_methods:c.stripeEnabled()?(c.paytoEnabled()?['card','payto']:['card']):[],
      checkout_url:allowedPay&&last?.state==='ready'?last.checkout_url:null,
      payment_pending:['creating','retry','processing'].includes(last?.state),
      transactions,receipt_available:transactions.some(x=>x.amount>0),
      settlement_status:'not_confirmed',pause_reason:publicAccess?'':s.access?.pause_reason||'',
      pdf_url:!publicAccess&&(user?.admin||c.actFor(req,user,'invoices')?.id===inv.participant.id)?'/api/me/invoices/'+encodeURIComponent(inv.invoice_no)+'.pdf':null};
  }
  function pauseInvoice(no,reason,meta={}) {
    const inv=getInvoice(no);if(!inv)return;
    invoiceCreated(inv);
    db.prepare('UPDATE payment_invoice_access SET paused_at=?,pause_reason=? WHERE invoice_no=?').run(now(),clean(reason,1000),no);
    retire(no,'under-review');
    event(no,'pause:'+no+':'+now(),'under-review',reason);
    return {paused:true};
  }
  function resumeInvoice(no,actor) {
    const inv=getInvoice(no);if(!inv||inv.withdrawn)return false;
    if(!state(no).approved)return false;
    db.prepare("UPDATE payment_invoice_access SET paused_at=NULL,pause_reason='',reviewed_at=? WHERE invoice_no=?").run(now(),no);
    event(no,'review:'+no+':'+now(),'approved','Explicit review recorded by '+(actor?.id??actor??''));return true;
  }
  function retire(no,reason='balance-changed') {
    c.invoiceFlow.cancelLinks(no);
    for(const a of db.prepare("SELECT * FROM payment_attempts WHERE invoice_no=? AND state IN ('ready','creating','retry','processing')").all(no)) {
      if(a.checkout_id)db.prepare('INSERT OR IGNORE INTO checkout_cleanup(session_id,invoice_no,next_at,updated_at) VALUES(?,?,?,?)').run(a.checkout_id,no,now(),now());
      // Keep processing payments visible: cancellation is not proof the transfer stopped.
      db.prepare("UPDATE payment_attempts SET state=CASE WHEN state='processing' THEN state ELSE 'cancelled' END,error=?,updated_at=? WHERE id=?").run(reason,now(),a.id);
    }
    c.invoiceFlow.wake();
  }
  function validCheckoutUrl(value) {
    try {const u=new URL(value);return u.protocol==='https:'&&u.hostname==='checkout.stripe.com'&&!u.username&&!u.password;}catch{return false;}
  }
  async function createAttempt(attempt) {
    if(inFlight.has(attempt.id))return inFlight.get(attempt.id);
    const operation=(async()=>{
      let a=db.prepare('SELECT * FROM payment_attempts WHERE id=?').get(attempt.id);
      const s=state(a.invoice_no);
      if(!s.inv||s.inv.withdrawn||!s.approved||s.paused||cents(s.inv.balance)!==a.amount_cents||fingerprint(a.invoice_no)!==a.fingerprint){retire(a.invoice_no);return null;}
      if(!['creating','retry'].includes(a.state))return a;
      // Stripe retains idempotency keys for at least 24h; never recreate an uncertain older request.
      if(Date.now()-Date.parse(a.created_at)>23*36e5){db.prepare("UPDATE payment_attempts SET state='needs-review',error='Confirm the original payment request with the provider before trying again.',updated_at=? WHERE id=?").run(now(),a.id);return null;}
      db.prepare('UPDATE payment_attempts SET attempts=attempts+1,updated_at=? WHERE id=?').run(now(),a.id);
      try {
        const params={mode:'payment','payment_method_types[0]':a.method==='payto'?'payto':'card',
          'line_items[0][price_data][currency]':'aud','line_items[0][price_data][product_data][name]':'The Care Web invoice '+a.invoice_no,
          'line_items[0][price_data][unit_amount]':a.amount_cents,'line_items[0][quantity]':1,
          'metadata[invoice_no]':a.invoice_no,'metadata[careweb_attempt]':a.id,
          'payment_intent_data[metadata][invoice_no]':a.invoice_no,'payment_intent_data[metadata][careweb_attempt]':a.id,
          success_url:invoiceUrl(a.invoice_no)+'?checkout=returned',cancel_url:invoiceUrl(a.invoice_no)+'?checkout=cancelled'};
        const session=await c.stripeRequest('/v1/checkout/sessions',params,{idempotencyKey:'careweb:'+a.id});
        if(!session.id||!validCheckoutUrl(session.url)||session.currency!=='aud'||session.amount_total!==a.amount_cents)throw Error('Payment provider returned checkout details that did not match this invoice.');
        const fresh=state(a.invoice_no),live=db.prepare('SELECT * FROM payment_attempts WHERE id=?').get(a.id);
        db.prepare('UPDATE payment_attempts SET checkout_id=?,payment_intent=?,checkout_url=?,updated_at=? WHERE id=?').run(session.id,typeof session.payment_intent==='string'?session.payment_intent:null,session.url,now(),a.id);
        if(live.state==='cancelled'||!fresh.inv||fresh.inv.withdrawn||fresh.paused||!fresh.approved||cents(fresh.inv.balance)!==a.amount_cents||fingerprint(a.invoice_no)!==a.fingerprint){
          db.prepare('INSERT OR IGNORE INTO checkout_cleanup(session_id,invoice_no,next_at,updated_at) VALUES(?,?,?,?)').run(session.id,a.invoice_no,now(),now());retire(a.invoice_no);return null;
        }
        db.prepare("UPDATE payment_attempts SET state='ready',error='',updated_at=? WHERE id=?").run(now(),a.id);
        db.prepare('UPDATE bookings SET stripe_session=?,pay_url=? WHERE invoice_no=?').run(session.id,session.url,a.invoice_no);
        if(session.payment_intent)db.prepare('INSERT OR IGNORE INTO stripe_payment_links(payment_intent,invoice_no,checkout_id) VALUES(?,?,?)').run(session.payment_intent,a.invoice_no,session.id);
        return db.prepare('SELECT * FROM payment_attempts WHERE id=?').get(a.id);
      } catch(e) {
        db.prepare("UPDATE payment_attempts SET state=CASE WHEN state='cancelled' THEN state ELSE 'retry' END,error=?,next_at=?,updated_at=? WHERE id=?").run(clean(e.message,400),new Date(Date.now()+Math.min(3600000,15000*2**Math.min(a.attempts,8))).toISOString(),now(),a.id);return null;
      }
    })().finally(()=>inFlight.delete(attempt.id));
    inFlight.set(attempt.id,operation);return operation;
  }
  async function checkout(inv,method) {
    if(!c.stripeEnabled())throw Object.assign(Error('Online payment is not connected yet. Use the bank details provided on your invoice.'),{status:409});
    if(!['card','payto'].includes(method)||method==='payto'&&!c.paytoEnabled())throw Object.assign(Error('Choose an available payment method.'),{status:400});
    let a=db.prepare("SELECT * FROM payment_attempts WHERE invoice_no=? AND state IN ('creating','retry','ready','processing','needs-review') ORDER BY created_at DESC LIMIT 1").get(inv.invoice_no);
    if(a && (a.state==='needs-review'||a.state==='processing'))return {processing:true,message:a.state==='processing'?'Your bank payment is processing. We will update this invoice when confirmed.':'The office is checking an earlier payment request.'};
    if(a && a.method!==method && ['creating','retry'].includes(a.state)){
      a=await createAttempt(a);
      if(!a || a.state!=='ready')throw Object.assign(Error('Your earlier payment request is still being prepared. Change the payment method once it is ready.'),{status:409});
    }
    if(a && (a.amount_cents!==cents(inv.balance)||a.fingerprint!==fingerprint(inv.invoice_no))){retire(inv.invoice_no);a=null;}
    if(a && a.method!==method){retire(inv.invoice_no,'payment-method-changed');a=null;}
    if(a?.state==='ready')return {url:a.checkout_url,attempt_id:a.id};
    if(!a){
      // Do not offer a second payable checkout while a former one can still collect money.
      // Provider closure runs through the existing durable retry queue.
      await c.invoiceFlow.drain?.();
      if(db.prepare("SELECT 1 FROM checkout_cleanup WHERE invoice_no=? AND state<>'closed'").get(inv.invoice_no))return {processing:true,message:'Closing the previous payment link. This retries automatically; choose your payment method again once it has closed.'};
      if([...inFlight.keys()].some(id=>db.prepare('SELECT invoice_no FROM payment_attempts WHERE id=?').get(id)?.invoice_no===inv.invoice_no))return {processing:true,message:'Finishing the earlier payment request. Please try again when its status updates.'};
      const fresh=state(inv.invoice_no);
      if(!fresh.inv||fresh.inv.withdrawn||fresh.paused||!fresh.approved||fresh.inv.balance<=0)throw Object.assign(Error('This invoice changed. Refresh its payment status before continuing.'),{status:409});
      inv=fresh.inv;
      const id=crypto.randomUUID(),stamp=now();
      db.prepare('INSERT INTO payment_attempts(id,invoice_no,method,amount_cents,state,created_at,updated_at,next_at,fingerprint) VALUES(?,?,?,?,?,?,?,?,?)').run(id,inv.invoice_no,method,cents(inv.balance),'creating',stamp,stamp,stamp,fingerprint(inv.invoice_no));
      a=db.prepare('SELECT * FROM payment_attempts WHERE id=?').get(id);
    }
    const result=await createAttempt(a);
    return result?.state==='ready'?{url:result.checkout_url,attempt_id:result.id}:{processing:true,message:'Preparing your secure payment. Temporary connection failures retry automatically.'};
  }
  function receivedTransfer(input) {
    db.prepare('INSERT OR IGNORE INTO payment_transfers(provider,environment,provider_transaction_id,participant_id,wallet_account_id,invoice_no,amount_cents,reference,received_at,settlement_status) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.provider,input.environment,input.providerTransactionId,input.participantId||null,input.walletAccountId||null,input.invoiceNo||null,input.amountCents,clean(input.reference,500),now(),input.settlementStatus||'not_confirmed');
    const row=db.prepare('SELECT * FROM payment_transfers WHERE provider=? AND environment=? AND provider_transaction_id=?').get(input.provider,input.environment,input.providerTransactionId);
    if(row.amount_cents!==input.amountCents||row.participant_id!==(input.participantId||null))throw Error('A provider transaction conflicts with the recorded receipt.');
    if(!row.reference&&input.reference)db.prepare('UPDATE payment_transfers SET reference=? WHERE id=?').run(clean(input.reference,500),row.id);
    return db.prepare('SELECT * FROM payment_transfers WHERE id=?').get(row.id);
  }
  const allocated = id => Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM payment_allocations WHERE transfer_id=?').get(id).n);
  function allocate(transfer,no,amountCents,actorId=0,idempotencyKey='') {
    const currentEnvironment=transfer.provider==='zai'?zai.getStatus().environment:c.stripeEnvironment();
    if(transfer.environment!==currentEnvironment||production&&transfer.environment!=='live')throw Error('A payment from another environment cannot be allocated to this invoice.');
    const reference=idempotencyKey?'transfer:'+transfer.id+':manual:'+digest(idempotencyKey).slice(0,32):'transfer:'+transfer.id+':'+no+':'+allocated(transfer.id);
    const duplicate=db.prepare('SELECT * FROM payment_allocations WHERE reference=?').get(reference);
    if(duplicate){if(duplicate.invoice_no!==no||duplicate.amount_cents!==amountCents)throw Error('That allocation request was already used for different details.');return {ok:true,duplicate:true};}
    const inv=getInvoice(no),remaining=transfer.amount_cents-allocated(transfer.id);
    if(!inv||inv.withdrawn||transfer.participant_id!==inv.participant.id)throw Error('Choose an active invoice belonging to the receiving billing account.');
    if(state(no).paused)throw Error('This invoice is under review. The money remains recorded until the review is resolved.');
    if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>remaining||amountCents>cents(inv.balance))throw Error('The allocation must fit both the received amount and the invoice balance.');
    db.exec('BEGIN IMMEDIATE');w.paymentTransactionActive=true;
    try{
      const result=w.recordPayment(inv,{id:actorId},{amount:money(amountCents),reference,note:'Confirmed '+transfer.provider+' transfer '+transfer.provider_transaction_id+' allocated to this invoice.',confirm:true});
      if(!result.matched&&!result.duplicate)throw Error('The payment needs reconciliation before it can be allocated.');
      db.prepare('INSERT OR IGNORE INTO payment_allocations(transfer_id,invoice_no,amount_cents,reference,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(transfer.id,no,amountCents,reference,actorId,now());
      db.prepare('UPDATE payment_transfers SET status=? WHERE id=?').run(allocated(transfer.id)===transfer.amount_cents?'matched':'part-matched',transfer.id);
      event(no,'allocation:'+reference,'payment-received','Confirmed payment allocated');db.exec('COMMIT');return result;
    }catch(e){db.exec('ROLLBACK');throw e;}finally{w.paymentTransactionActive=false;}
  }
  function autoAllocate(transfer) {
    const currentEnvironment=transfer.provider==='zai'?zai.getStatus().environment:c.stripeEnvironment();
    if(transfer.environment!==currentEnvironment||production&&transfer.environment!=='live')return;
    const remaining=transfer.amount_cents-allocated(transfer.id);if(remaining<=0)return;
    let no=transfer.invoice_no;
    if(!no&&transfer.reference){
      const candidates=db.prepare('SELECT DISTINCT invoice_no FROM bookings WHERE participant_id=? AND COALESCE(invoice_no,\'\')<>\'\'').all(transfer.participant_id);
      const refs=candidates.filter(r=>new RegExp('(^|[^A-Z0-9-])'+r.invoice_no.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^A-Z0-9-])','i').test(transfer.reference));
      if(refs.length===1)no=refs[0].invoice_no;
    }
    if(!no)return;const inv=getInvoice(no);
    if(!inv||inv.withdrawn||inv.participant.id!==transfer.participant_id||state(no).paused||inv.balance<=0)return;
    allocate(transfer,no,Math.min(remaining,cents(inv.balance)),0);
  }
  function recordStripe(eventData) {
    const e=eventData,s=e.data?.object||{};
    if(production&&c.stripeEnvironment()!=='live')throw Error('Live payment configuration is required on the production website.');
    // A live webhook secret must never allow a test payment to settle a real invoice.
    if(typeof e.livemode==='boolean' && e.livemode!==(c.stripeEnvironment()==='live'))throw Error('Payment notification belongs to another Stripe environment.');
    if(c.stripeEnvironment()==='live' && e.livemode!==true)throw Error('A live payment notification must identify live mode.');
    const isSession=e.type.startsWith('checkout.session.');
    const intent=isSession?(typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id):e.type.startsWith('payment_intent.')?s.id:(typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id);
    const a=isSession?db.prepare('SELECT * FROM payment_attempts WHERE checkout_id=?').get(s.id||''):db.prepare('SELECT * FROM payment_attempts WHERE payment_intent=?').get(intent||'');
    const legacy=isSession?db.prepare('SELECT invoice_no,stripe_session FROM bookings WHERE stripe_session=? LIMIT 1').get(s.id||''):null;
    const retired=isSession?db.prepare('SELECT invoice_no,session_id FROM checkout_cleanup WHERE session_id=?').get(s.id||''):null;
    const link=intent?db.prepare('SELECT * FROM stripe_payment_links WHERE payment_intent=?').get(intent):null;
    const no=a?.invoice_no||legacy?.invoice_no||retired?.invoice_no||link?.invoice_no||null;
    const amount=e.type==='charge.refunded'?(Number.isSafeInteger(s.amount_refunded)?s.amount_refunded:null):Number.isSafeInteger(s.amount_total)?s.amount_total:Number.isSafeInteger(s.amount_received)?s.amount_received:Number.isSafeInteger(s.amount)?s.amount:null;
    db.prepare("INSERT OR IGNORE INTO finance_provider_events(event_id,event_type,object_id,payment_intent,invoice_no,amount_cents,currency,status,created_at) VALUES(?,?,?,?,?,?,?,'needs-review',?)").run(e.id,e.type,s.id||'',intent||'',no,amount,s.currency||'',now());
    if(!no){
      // Creation responses and webhooks may cross in flight. Keep the confirmed event until the stored checkout/intent exists.
      if(e.type.startsWith('checkout.session.')||e.type.startsWith('payment_intent.'))throw Error('Waiting for the stored payment request to match this confirmation.');
      return false;
    }
    if(s.metadata?.invoice_no&&s.metadata.invoice_no!==no)return false;
    if(intent)db.prepare('UPDATE finance_provider_events SET invoice_no=? WHERE payment_intent=? AND invoice_no IS NULL').run(no,intent);
    // Provider refunds and disputes are evidence for finance reconciliation, not
    // permission to issue another refund or silently reverse a participant balance.
    // Keep them visible until the existing finance review records an outcome.
    if(['charge.refunded','refund.created','refund.updated','refund.failed','charge.dispute.created','charge.dispute.updated','charge.dispute.closed'].includes(e.type))return false;
    if(intent&&isSession){db.prepare('INSERT OR IGNORE INTO stripe_payment_links(payment_intent,invoice_no,checkout_id) VALUES(?,?,?)').run(intent,no,s.id);if(a)db.prepare('UPDATE payment_attempts SET payment_intent=? WHERE id=?').run(intent,a.id);}
    const success=['checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded'].includes(e.type);
    const fail=['checkout.session.async_payment_failed','payment_intent.payment_failed','payment_intent.canceled','checkout.session.expired'].includes(e.type);
    if(fail){
      if(a)db.prepare("UPDATE payment_attempts SET state=CASE WHEN state='paid' THEN state ELSE ? END,error=?,updated_at=? WHERE id=?").run(e.type.includes('expired')?'expired':'failed','Payment was not completed. You can try again.',now(),a.id);
      if(getInvoice(no)?.balance>0){event(no,e.id,'payment-failed','Payment did not complete');queuePaymentFailure(no,e.id);}
      db.prepare("UPDATE finance_provider_events SET status='handled' WHERE event_id=?").run(e.id);return true;
    }
    if(!success)return false;
    if(isSession&&s.payment_status==='unpaid'){
      if(a)db.prepare("UPDATE payment_attempts SET state=CASE WHEN state IN ('paid','failed','expired') THEN state ELSE 'processing' END,updated_at=? WHERE id=?").run(now(),a.id);
      db.prepare("UPDATE finance_provider_events SET status='awaiting-payment' WHERE event_id=?").run(e.id);return true;
    }
    if(s.currency!=='aud'||!Number.isSafeInteger(amount)||amount<=0||isSession&&s.payment_status!=='paid'||!isSession&&s.status!=='succeeded')return false;
    if(a&&amount!==a.amount_cents)return false;
    const inv=getInvoice(no);if(!inv)return false;
    const sessionId=isSession?s.id:link?.checkout_id||a?.checkout_id;
    if(!sessionId)return false;
    const old=db.prepare('SELECT * FROM invoice_payment_evidence WHERE reference=?').get('stripe:checkout:'+sessionId);
    if(old){db.prepare("UPDATE finance_provider_events SET status='duplicate-payment' WHERE event_id=?").run(e.id);return true;}
    const transfer=receivedTransfer({provider:'stripe',environment:c.stripeEnvironment(),providerTransactionId:'checkout:'+sessionId,participantId:inv.participant.id,invoiceNo:no,amountCents:amount,reference:no});
    autoAllocate(transfer);
    if(a)db.prepare("UPDATE payment_attempts SET state='paid',updated_at=? WHERE id=?").run(now(),a.id);
    db.prepare('UPDATE finance_provider_events SET status=? WHERE event_id=?').run(allocated(transfer.id)===amount?'recorded':'needs-review',e.id);
    return true;
  }
  function enqueueProvider(provider,key,payload) {
    db.prepare('INSERT OR IGNORE INTO payment_provider_jobs(event_key,provider,payload,next_at,created_at) VALUES(?,?,?,?,?)').run(key,provider,JSON.stringify(payload),now(),now());
  }
  function stripeEvent(e) {
    if(!e?.id||!e?.type)throw Error('Missing payment event identifier.');
    enqueueProvider('stripe','stripe:'+e.id,e);
    try{const result=recordStripe(e);db.prepare("UPDATE payment_provider_jobs SET state='complete',error='' WHERE event_key=?").run('stripe:'+e.id);return result;}catch(err){db.prepare("UPDATE payment_provider_jobs SET error=? WHERE event_key=?").run(clean(err.message,400),'stripe:'+e.id);throw err;}
  }
  async function zaiWebhook(req,res,raw) {
    try {
      if(!zai.getStatus().configured)return json(res,503,{error:'Bank transfer integration is not configured.'});
      if(!req.headers['webhooks-signature']){
        const probe=JSON.parse(raw);
        if(probe&&Object.keys(probe).length===1&&probe.message==='Zai callback test')return json(res,200,{received:true});
      }
      const checked=zai.verifyWebhook(raw,req.headers['webhooks-signature']);
      if(checked.kind==='test')return json(res,200,{received:true});
      if(checked.kind==='transaction')enqueueProvider('zai','zai:'+zai.getStatus().environment+':'+checked.eventKey,{...checked,environment:zai.getStatus().environment});
      wake();return json(res,200,{received:true});
    } catch(e) {return json(res,400,{error:'Invalid bank payment notification.'});}
  }
  function queueReceipt(r) {
    const inv=getInvoice(r.invoice_no);if(!inv||r.amount<=0||!['recorded','opening'].includes(r.state)||r.state==='opening')return;
    const key='payment-receipt:'+r.id;
    if(db.prepare('SELECT 1 FROM delivery_outbox WHERE event_key=?').get(key))return;
    const to=inv.payer_email;if(!to)return;
    c.sendMail(to,'Payment received for '+inv.invoice_no+' — The Care Web','Payment received',
      '<p>We received <strong>$'+Number(r.amount).toFixed(2)+'</strong> for invoice '+c.escHtml(inv.invoice_no)+'.</p><p>Remaining balance: $'+Number(inv.balance).toFixed(2)+'.</p>',
      'View payment status',invoiceUrl(inv.invoice_no),undefined,[],{kind:'invoice',transactional:true,event_key:key,invoice_no:inv.invoice_no,payment_receipt:true});
  }
  function queuePaymentFailure(no,key) {
    const inv=getInvoice(no);if(!inv||inv.withdrawn||state(no).paused||inv.balance<=0||!inv.payer_email)return;
    c.sendMail(inv.payer_email,'Payment needs attention — '+no,'Payment not completed',
      '<p>Your payment for invoice '+c.escHtml(no)+' was not completed. Your shift approval is saved. Open the invoice to try again or use the supplied bank details.</p>',
      'View invoice',invoiceUrl(no),undefined,[],{kind:'invoice',transactional:true,event_key:'payment-failed:'+key,invoice_no:no,payment_reminder:true});
  }
  const previousPayment=w.onInvoicePayment;
  w.onInvoicePayment=no=>{previousPayment?.(no);retire(no);for(const r of db.prepare('SELECT * FROM invoice_payment_evidence WHERE invoice_no=? AND recorded_at>=?').all(no,start))queueReceipt(r);wake();};
  w.recordStripePayment=stripeEvent;
  w.paymentLinkNeedsRetirement=(no,session)=>{
    const s=state(no),a=db.prepare('SELECT * FROM payment_attempts WHERE checkout_id=? AND invoice_no=?').get(session,no);
    if(!s.inv||s.inv.withdrawn||s.paused||!s.approved||s.inv.balance<=0)return true;
    if(a)return !['ready','processing'].includes(a.state)||a.amount_cents!==cents(s.inv.balance)||a.fingerprint!==fingerprint(no);
    return !!db.prepare("SELECT 1 FROM invoice_payment_evidence WHERE invoice_no=? AND state IN ('recorded','reversed','opening')").get(no);
  };
  w.paymentSessionRecorded=session=>!!db.prepare("SELECT 1 FROM payment_transfers WHERE provider='stripe' AND provider_transaction_id=?").get('checkout:'+session);
  w.paymentDeliveryInvalid=no=>{const s=state(no);return !s.inv||s.inv.withdrawn||s.paused||s.inv.balance<=0;};
  async function tick() {
    if(ticking)return ticking;
    ticking=(async()=>{
      for(const invRow of db.prepare('SELECT invoice_no FROM invoice_snapshots').all()){const inv=getInvoice(invRow.invoice_no);if(inv&&!inv.withdrawn)invoiceCreated(inv);}
      for(const a of db.prepare("SELECT * FROM payment_attempts WHERE state IN ('creating','retry') AND next_at<=? LIMIT 20").all(now()))await createAttempt(a);
      for(const j of db.prepare("SELECT * FROM payment_provider_jobs WHERE state<>'complete' AND next_at<=? ORDER BY created_at LIMIT 50").all(now())){
        try{
          const payload=JSON.parse(j.payload);
          if(j.provider==='stripe')recordStripe(payload);
          else {
            if(payload.environment!==zai.getStatus().environment)throw Error('This notification belongs to another payment environment.');
            const receipt=await zai.fetchReceivedTransaction(payload.transactionId);
            if(!receipt.received){
              if(/pending|processing/i.test((receipt.reason||'')+' '+(receipt.providerState||'')))throw Error('Bank payment is still processing.');
              db.prepare("UPDATE payment_provider_jobs SET state='complete',error='',attempts=attempts+1 WHERE event_key=?").run(j.event_key);
              continue;
            }
            const env=zai.getStatus().environment;
            const account=db.prepare('SELECT * FROM payment_accounts WHERE environment=? AND wallet_account_id=?').get(env,receipt.walletAccountId);
            if(account&&receipt.providerUserId&&account.provider_user_id!==receipt.providerUserId)throw Error('Provider receipt and receiving account owner differ.');
            const transfer=receivedTransfer({provider:'zai',environment:env,providerTransactionId:receipt.providerTransactionId,participantId:account?.participant_id,walletAccountId:receipt.walletAccountId,amountCents:receipt.amountCents,reference:receipt.reference,settlementStatus:receipt.settlementStatus});
            if(account)autoAllocate(transfer);
            if(['retry_needed','not_available'].includes(receipt.supplementaryStatus)&&!transfer.reference&&allocated(transfer.id)<transfer.amount_cents)throw Error('Payment received. Retrying its invoice reference lookup.');
          }
          db.prepare("UPDATE payment_provider_jobs SET state='complete',error='',attempts=attempts+1 WHERE event_key=?").run(j.event_key);
        }catch(e){db.prepare("UPDATE payment_provider_jobs SET state='retry',attempts=attempts+1,error=?,next_at=? WHERE event_key=?").run(clean(e.message,400),new Date(Date.now()+Math.min(3600000,15000*2**Math.min(j.attempts,8))).toISOString(),j.event_key);}
      }
      // A crash after receipt insertion but before its allocation marker is repairable by reference.
      for(const t of db.prepare("SELECT * FROM payment_transfers WHERE status<>'matched'").all()){
        for(const r of db.prepare("SELECT * FROM invoice_payment_evidence WHERE reference LIKE ? AND state='recorded'").all('transfer:'+t.id+':%'))db.prepare('INSERT OR IGNORE INTO payment_allocations(transfer_id,invoice_no,amount_cents,reference,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(t.id,r.invoice_no,cents(r.amount),r.reference,r.recorded_by,r.recorded_at);
        if(allocated(t.id)===t.amount_cents)db.prepare("UPDATE payment_transfers SET status='matched' WHERE id=?").run(t.id);
      }
      for(const r of db.prepare("SELECT * FROM invoice_payment_evidence WHERE recorded_at>=? AND state='recorded' ORDER BY id").all(start))queueReceipt(r);
      for(const row of db.prepare('SELECT invoice_no FROM invoice_snapshots').all()){
        const s=state(row.invoice_no),inv=s.inv;if(!inv||inv.withdrawn||!s.approved||s.paused||inv.balance<=0||!inv.payer_email||inv.due>=c.ymd())continue;
        if(db.prepare("SELECT 1 FROM payment_attempts WHERE invoice_no=? AND state='processing'").get(inv.invoice_no))continue;
        const age=Math.floor((Date.parse(c.ymd())-Date.parse(inv.due))/864e5);
        if(age!==1&&age%7!==0)continue;
        c.sendMail(inv.payer_email,'Invoice payment reminder — '+inv.invoice_no,'Invoice payment is due',
          '<p>Invoice '+c.escHtml(inv.invoice_no)+' has an outstanding balance of $'+Number(inv.balance).toFixed(2)+'. Its due date was '+c.escHtml(inv.due_date)+'.</p>',
          'View invoice',invoiceUrl(inv.invoice_no),undefined,[],{kind:'invoice',transactional:true,event_key:'payment-reminder:'+inv.invoice_no+':'+c.ymd(),invoice_no:inv.invoice_no,payment_reminder:true});
      }
      await w.drain();return {ok:true};
    })().finally(()=>{ticking=null;});return ticking;
  }
  function wake(){setImmediate(()=>tick().catch(e=>console.error('[payments]',clean(e.message,200))));}
  function protect(fn){return async(req,res,m,user,body)=>{try{return await fn(req,res,m,user,body||{});}catch(e){return json(res,e.status||409,{error:clean(e.message,600)});}};}
  const invoicePattern=/^\/api\/payments\/invoices\/([A-Z0-9-]+)(?:\/(checkout|review))?$/;
  for(const method of ['GET','POST'])c.route(method,invoicePattern,protect(async(req,res,m,user,b)=>{
    const inv=getInvoice(m[1]);if(!canRead(req,user,inv))return json(res,404,{error:'Invoice not available for this account.'});
    if(req.method==='GET'&&!m[2])return json(res,200,summary(inv,req,user));
    if(req.method==='POST'&&m[2]==='review'){
      if(!canReview(req,user,inv))return json(res,403,{error:'Permission to review this participant’s support is required.'});
      if(b.confirm!==true||(b.fingerprint||b.review_fingerprint)!==fingerprint(inv.invoice_no))return json(res,409,{error:'Review the current invoice details and confirm your decision.'});
      await c.reviewInvoice(inv,user,req,{...b,action:b.action==='approved'?'approve':b.action==='queried'?'query':b.action});return json(res,200,summary(getInvoice(inv.invoice_no),req,user));
    }
    if(req.method==='POST'&&m[2]==='checkout'){
      if(!canPay(req,user,inv))return json(res,409,{error:'Payment is available after the support has been approved and any query resolved.'});
      const out=await checkout(inv,b.method||'card');return json(res,out.url?200:202,out);
    }
    return json(res,405,{error:'Action not available.'});
  }));
  const publicPattern=/^\/api\/payments\/public\/([a-f0-9]{64})(?:\/(checkout))?$/;
  for(const method of ['GET','POST']){
    c.publicAPI.push([method,publicPattern]);
    c.route(method,publicPattern,protect(async(req,res,m,user,b)=>{
      res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
      const inv=tokenInvoice(m[1]);if(!inv)return json(res,404,{error:'This payment link has expired or is unavailable. Sign in to view your invoices.'});
      if(req.method==='GET'&&!m[2])return json(res,200,summary(inv,req,null,true));
      if(req.method==='POST'&&m[2]==='checkout'){
        if(!canPay(req,null,inv,true))return json(res,409,{error:'This invoice is not ready for payment. The participant can sign in to review it.'});
        const out=await checkout(inv,b.method||'card');return json(res,out.url?200:202,out);
      }
      return json(res,405,{error:'Action not available.'});
    }));
  }
  c.route('GET',/^\/api\/admin\/payments\/participants$/,protect((req,res)=>json(res,200,{participants:db.prepare("SELECT id,name,email,plan FROM users WHERE role='participant' AND COALESCE(closed_at,'')='' ORDER BY name").all()})));
  c.route('POST',/^\/api\/admin\/payments\/zai\/accounts$/,protect(async(req,res,m,user,b)=>{
    const pid=Number(b.participant_id),p=db.prepare("SELECT id FROM users WHERE id=? AND role='participant' AND COALESCE(closed_at,'')=''").get(pid);
    if(!p)throw Error('Choose a current participant billing account.');
    const ids={userId:clean(b.provider_user_id),walletAccountId:clean(b.wallet_account_id),virtualAccountId:clean(b.virtual_account_id)};
    if(Object.values(ids).some(v=>!v))throw Error('Enter the provider user, wallet and virtual account identifiers.');
    const verified=await zai.verifyAccountMapping(ids),env=zai.getStatus().environment;
    if(!verified.active||!verified.bsb||!verified.accountNumber)throw Error('The provider has not confirmed active receiving bank details.');
    const old=db.prepare('SELECT * FROM payment_accounts WHERE participant_id=? AND environment=?').get(pid,env);
    if(old&&(old.wallet_account_id!==ids.walletAccountId||old.provider_user_id!==ids.userId||old.virtual_account_id!==ids.virtualAccountId))throw Error('This billing account already has assigned receiving details. Contact support to migrate its transaction history.');
    db.prepare('INSERT INTO payment_accounts(participant_id,environment,provider_user_id,wallet_account_id,virtual_account_id,bsb,account_number,account_name,payid,verified_at,verified_by) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(participant_id,environment) DO UPDATE SET bsb=excluded.bsb,account_number=excluded.account_number,account_name=excluded.account_name,payid=excluded.payid,verified_at=excluded.verified_at,verified_by=excluded.verified_by').run(pid,env,ids.userId,ids.walletAccountId,ids.virtualAccountId,verified.bsb,verified.accountNumber,verified.accountName||'',verified.payid||'',now(),user.id);
    db.prepare('UPDATE payment_transfers SET participant_id=? WHERE provider=\'zai\' AND environment=? AND wallet_account_id=? AND participant_id IS NULL').run(pid,env,ids.walletAccountId);
    for(const t of db.prepare("SELECT * FROM payment_transfers WHERE participant_id=? AND status<>'matched'").all(pid))autoAllocate(t);
    return json(res,200,{ok:true,message:'Receiving details verified and connected.'});
  }));
  c.route('POST',/^\/api\/admin\/payments\/transfers\/(\d+)\/allocate$/,protect((req,res,m,user,b)=>{
    if(b.confirm!==true)throw Error('Confirm this allocation.');
    const transfer=db.prepare('SELECT * FROM payment_transfers WHERE id=?').get(Number(m[1]));if(!transfer)throw Error('Payment not found.');
    if(!Number.isFinite(Number(b.amount))||Number(b.amount)!==money(cents(b.amount)))throw Error('Enter a valid amount to two decimal places.');
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(b.idempotency_key||''))throw Error('Reload the matching form before submitting this allocation.');
    return json(res,200,allocate(transfer,clean(b.invoice_no,80),cents(b.amount),user.id,b.idempotency_key));
  }));
  c.route('POST',/^\/api\/admin\/payments\/retry$/,protect((req,res)=>{db.prepare("UPDATE payment_provider_jobs SET next_at=? WHERE state<>'complete'").run(now());db.prepare("UPDATE payment_attempts SET next_at=? WHERE state='retry'").run(now());wake();return json(res,200,{ok:true});}));
  function providerReviewTasks() {
    return db.prepare("SELECT event_id,event_type,invoice_no,amount_cents,currency,created_at FROM finance_provider_events WHERE status='needs-review' ORDER BY created_at DESC,event_id").all().map(row=>{
      const dispute=row.event_type.startsWith('charge.dispute.'),refund=row.event_type==='charge.refunded'||row.event_type.startsWith('refund.');
      const action=dispute?'Review payment dispute':refund?(row.event_type==='refund.failed'?'Review failed refund':'Reconcile provider refund'):'Review payment confirmation';
      const label=action+(row.invoice_no?' — '+row.invoice_no:' — invoice needs matching');
      const amount=Number.isSafeInteger(row.amount_cents)?money(row.amount_cents).toFixed(2)+' '+clean(row.currency,8).toUpperCase():'';
      return {key:'provider-review:'+digest(row.event_id).slice(0,24),id:row.event_id,provider:'stripe',invoice_no:row.invoice_no,
        kind:'invoice',status:'needs-review',label,detail:row.event_type+(amount?' · '+(row.event_type==='charge.refunded'?'cumulative refunded ':'')+amount:'')+' · Check the provider record and reconcile the invoice ledger.',
        dest:'#/journey?panel=finance',due:null};
    });
  }
  function dashboard(req,user) {
    // Historical display limits must never hide money still owed or needing work.
    // Keep every actionable invoice and receipt, plus 250 recent closed records.
    const relatedInvoiceNos=new Set([
      ...db.prepare("SELECT invoice_no FROM finance_provider_events WHERE status='needs-review' AND invoice_no IS NOT NULL").all(),
      ...db.prepare("SELECT invoice_no FROM payment_attempts WHERE state IN ('creating','retry','processing','needs-review')").all(),
      ...db.prepare("SELECT invoice_no FROM payment_transfers t WHERE invoice_no IS NOT NULL AND amount_cents<>(SELECT COALESCE(SUM(amount_cents),0) FROM payment_allocations a WHERE a.transfer_id=t.id)").all()
    ].map(row=>row.invoice_no));
    let invoiceHistory=0;
    const invoices=[];
    for(const row of db.prepare('SELECT invoice_no FROM invoice_snapshots ORDER BY created_at DESC,invoice_no DESC').all()){
      const s=state(row.invoice_no),inv=s.inv;if(!inv)continue;
      const actionable=relatedInvoiceNos.has(inv.invoice_no)||!inv.withdrawn&&(inv.balance!==0||s.paused||!s.approved);
      if(!actionable&&invoiceHistory++>=250)continue;
      invoices.push({...summary(inv,req,user),participant:inv.participant.name,participant_id:inv.participant.id,payer_email:inv.payer_email,delivery_status:db.prepare('SELECT status FROM delivery_outbox WHERE event_key=?').get('invoice:'+inv.invoice_no)?.status||'unknown'});
    }
    let transferHistory=0;
    const transfers=db.prepare(`SELECT t.*,u.name AS participant,COALESCE(a.allocated_cents,0) AS allocated_cents
      FROM payment_transfers t LEFT JOIN users u ON u.id=t.participant_id
      LEFT JOIN (SELECT transfer_id,SUM(amount_cents) AS allocated_cents FROM payment_allocations GROUP BY transfer_id) a ON a.transfer_id=t.id
      ORDER BY t.id DESC`).all().filter(t=>t.amount_cents!==t.allocated_cents||t.status!=='matched'||transferHistory++<250).map(t=>{
        const {allocated_cents,...record}=t;
        return {...record,amount:money(t.amount_cents),allocated:money(allocated_cents),balance:money(t.amount_cents-allocated_cents)};
      });
    return {providers:{stripe:{configured:c.stripeEnabled(),payto_enabled:c.paytoEnabled(),environment:c.stripeEnvironment()},zai:zai.getStatus()},invoices,transfers,
      accounts:db.prepare('SELECT a.*,u.name AS participant FROM payment_accounts a JOIN users u ON u.id=a.participant_id ORDER BY u.name').all(),
      exceptions:[...providerReviewTasks(),...db.prepare("SELECT event_key AS id,provider,error AS detail,next_at,'retry' AS status FROM payment_provider_jobs WHERE state='retry'").all(),...db.prepare("SELECT id,invoice_no,error AS detail,state AS status FROM payment_attempts WHERE state IN ('retry','needs-review')").all()],
      settlement_note:'Payment received and settlement into the business bank are separate. Bank settlement is not confirmed by this integration.'};
  }
  c.route('GET',/^\/api\/admin\/payments\/dashboard$/,protect((req,res,m,user)=>json(res,200,dashboard(req,user))));
  w.paymentTasks=uid=>db.prepare('SELECT DISTINCT invoice_no FROM bookings WHERE participant_id=? AND COALESCE(invoice_no,\'\')<>\'\'').all(uid).map(r=>{
    const s=state(r.invoice_no),inv=s.inv;if(!inv||inv.withdrawn)return null;
    const status=invoiceStatus(inv,s),review=!s.approved&&!s.paused;
    if(!review&&(inv.balance<=0||s.paused||status==='processing'||inv.funding==='plan'))return null;
    const label=review?'Review invoice '+inv.invoice_no:status==='payment-failed'?'Retry payment for '+inv.invoice_no:status==='overdue'?'Pay overdue invoice '+inv.invoice_no:'Pay invoice '+inv.invoice_no;
    const reviewDue=review&&s.rows[0]?.approval_from?new Date(Date.parse(s.rows[0].approval_from)+7*864e5).toISOString():null;
    return {task_key:uid+':invoice:'+inv.invoice_no,user_id:uid,kind:review?'review':'invoice',label,owner_kind:'person',destination:'#/invoice?invoice='+encodeURIComponent(inv.invoice_no),detail:'Balance $'+Number(inv.balance).toFixed(2),scope:review?'bookings':'invoices',due_at:review?reviewDue:inv.due+'T23:59:59+10:00'};
  }).filter(Boolean);
  w.paymentOfficeTasks=()=>[
    ...providerReviewTasks(),
    ...db.prepare("SELECT t.*,u.name AS participant FROM payment_transfers t LEFT JOIN users u ON u.id=t.participant_id WHERE t.status<>'matched'").all().filter(t=>allocated(t.id)<t.amount_cents).map(t=>({key:'transfer:'+t.id,kind:'invoice',label:'Match received payment — $'+money(t.amount_cents-allocated(t.id)).toFixed(2),dest:'#/payment-tracking',detail:(t.participant||'Unassigned receiving account')+' · '+t.provider,due:null})),
    ...db.prepare("SELECT id,invoice_no,state,error FROM payment_attempts WHERE state='needs-review' OR (state='retry' AND attempts>=3)").all().map(a=>({key:'checkout:'+a.id,kind:'invoice',label:'Check online payment for '+a.invoice_no,dest:'#/payment-tracking',detail:a.error,due:null})),
    ...db.prepare("SELECT event_key,error FROM payment_provider_jobs WHERE state='retry' AND attempts>=3").all().map(j=>({key:'payment-event:'+digest(j.event_key).slice(0,20),kind:'invoice',label:'Check payment confirmation',dest:'#/payment-tracking',detail:j.error,due:null}))
  ];
  function servePayPage(req,res,token) {
    if(!/^[a-f0-9]{64}$/.test(token)){res.writeHead(404);res.end();return;}
    const body='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Invoice payment | The Care Web</title><link rel="stylesheet" href="/assets/payment-automation.css"></head><body><main id="paymentPage" data-payment-token="'+token+'"><p>Loading your invoice…</p></main><script src="/assets/payment-automation.js" defer></script></body></html>';
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    res.end(req.method==='HEAD'?'':body);
  }
  return {invoiceCreated,invoiceUrl,bankForInvoice:bankFor,pauseInvoice,resumeInvoice,summary,state,fingerprint,recordStripePayment:stripeEvent,zaiWebhook,tick,wake,servePayPage,allocate,receivedTransfer,autoAllocate,dashboard,zai};
};
