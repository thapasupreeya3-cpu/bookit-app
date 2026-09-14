'use strict';
// Account identity changes are verified separately from ordinary profile edits.
// Existing invoice recipients and saved invoice bytes are historical evidence.
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const emailHint = email => { const [name, domain] = email.split('@'); return name.slice(0, 1) + '***@' + domain; };
module.exports = function accountEmail(c, w) {
  const { db, route, json } = c;
  const now = c.now || (() => new Date().toISOString());
  const reserved = new Set((c.reservedEmails || []).map(s => s.toLowerCase()));
  const emailPattern = c.emailPattern || /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  db.exec(`CREATE TABLE IF NOT EXISTS account_email_changes (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    old_email TEXT NOT NULL, new_email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    security_hash TEXT NOT NULL, initiated_by INTEGER NOT NULL REFERENCES users(id),
    initiator_hash TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, resolved_at TEXT
  ); CREATE INDEX IF NOT EXISTS account_email_pending ON account_email_changes(user_id,state);`);
  const person = id => db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
  function security(u) {
    if (!u) return '';
    return hash({ email:u.email, pass:u.pass, role:u.role, admin:u.is_admin || 0, closed:u.closed_at || '',
      mfa:db.prepare('SELECT secret,enabled,confirmed_at FROM mfa WHERE user_id=?').get(u.id) || null,
      links:u.role === 'coordinator' ? db.prepare('SELECT id,participant_id,scopes,status,revoked_at FROM account_links WHERE coordinator_id=? ORDER BY id').all(u.id) : [] });
  }
  function fail(res, status, error, code) { return json(res, status, { error, ...(code ? { code } : {}) }); }
  function foreignContext(req, uid) {
    const url = new URL(req.url, 'http://local');
    return [req.headers['x-bookit-for'],url.searchParams.get('for')].some(v => v !== undefined && v !== null && v !== '' && String(v) !== String(uid));
  }
  function own(req, res, u) {
    if (!u) { fail(res, 401, 'Please log in.'); return null; }
    if (foreignContext(req,u.id)) { fail(res,403,'Only the account holder can change this sign-in email. Helpers cannot change another account’s email.'); return null; }
    const row = person(u.id); if (!row || row.closed_at) { fail(res,403,'This account is not active.'); return null; } return row;
  }
  function office(req,res,u,id) {
    if (!c.requireAdmin(u,res)) return null;
    const actor = person(u.id), target = person(id);
    if (!actor?.is_admin || actor.closed_at) { fail(res,403,'An active office account is required.'); return null; }
    if (!target || target.role !== 'participant' || target.is_admin || target.closed_at) { fail(res,404,'Active participant account not found.'); return null; }
    return target;
  }
  const messageKey = id => 'account-email-change:' + id + ':verify';
  function delivery(id) {
    const row = db.prepare('SELECT id,status,delivery_result,sent_at,error FROM delivery_outbox WHERE event_key=?').get(messageKey(id));
    return row ? { id:row.id,state:row.delivery_result || row.status,sent_at:row.sent_at,error:row.error || '' } : { state:'not-queued',error:'Verification email was not queued.' };
  }
  function view(target) {
    const request = db.prepare("SELECT * FROM account_email_changes WHERE user_id=? AND state='pending' ORDER BY id DESC LIMIT 1").get(target.id);
    const valid = request && !invalid(request);
    return { email:target.email,verified:!!target.verified,can_change:true,email_enabled:!!c.emailOn(),pending:valid ? {
      id:request.id,new_email:request.new_email,requested_at:request.created_at,expires_at:request.expires_at,status:'pending',
      initiated_by_office:request.initiated_by !== target.id,delivery:delivery(request.id)
    } : null };
  }
  function cancelMail(id, why) {
    db.prepare("UPDATE delivery_outbox SET status='cancelled',error=?,payload='[]',lease_until=NULL WHERE event_key=? AND status IN ('queued','retry','failed','sending')").run(why,messageKey(id));
  }
  function invalid(request) {
    if (!request || request.state !== 'pending' || request.expires_at <= now()) return true;
    const u = person(request.user_id), actor = person(request.initiated_by);
    if (!u || u.closed_at || request.security_hash !== security(u)) return true;
    if (!actor || actor.closed_at || request.initiator_hash !== security(actor)) return true;
    if (request.initiated_by !== request.user_id && (!actor.is_admin || u.role !== 'participant' || u.is_admin || request.consent !== 1)) return true;
    if (reserved.has(request.new_email)) return true;
    return !!db.prepare('SELECT id FROM users WHERE lower(email)=? AND id<>?').get(request.new_email,request.user_id);
  }
  async function initiate(req,res,u,target,body,ip,admin) {
    if (c.limited && (c.limited(ip,'account-email-ip',20) || c.limited('email-change:'+u.id,'account-email-actor',12))) return fail(res,429,'Too many attempts. Please try again later.');
    const actor = person(u.id);
    if (!actor || !c.verifyPassword(String(body.current_password || ''),actor.pass)) return fail(res,401,'Your current password does not match.');
    const raw = String(body.new_email || '').trim(), email = raw.toLowerCase();
    if (!email || raw.length > 120 || /[\r\n\x00-\x1f\x7f]/.test(raw) || !emailPattern.test(email) || /@demo\.(bookit\.life|thecareweb\.com\.au)$/i.test(email)) return fail(res,400,'Enter a valid email address that can receive the verification message.');
    if (email === String(target.email).toLowerCase()) return fail(res,400,'That is already the account’s current email address.');
    if (reserved.has(email) || db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email)) return fail(res,409,'That email address cannot be used for this account.');
    const reason = String(body.reason || '').trim();
    if (admin && (reason.length < 10 || reason.length > 1000 || body.participant_consent !== true)) return fail(res,400,'Record the participant’s request or consent and a short reason for correcting their email.');
    if (!c.emailOn()) return fail(res,503,'Email sending is not configured. The office must complete Email setup before an address change can be verified. The current email has not changed.','email_not_configured');
    const token = crypto.randomBytes(32).toString('hex'), expires = new Date(Date.now() + 60*60000).toISOString();
    let id;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const previous of db.prepare("SELECT id FROM account_email_changes WHERE user_id=? AND state='pending'").all(target.id)) cancelMail(previous.id,'A newer email change was requested');
      db.prepare("UPDATE account_email_changes SET state='superseded',resolved_at=? WHERE user_id=? AND state='pending'").run(now(),target.id);
      id = Number(db.prepare('INSERT INTO account_email_changes(user_id,old_email,new_email,token_hash,security_hash,initiated_by,initiator_hash,reason,consent,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(target.id,target.email,email,hash(token),security(target),u.id,security(actor),admin?reason:'',admin?1:0,now(),expires).lastInsertRowid);
      // enqueueMail writes synchronously into the same transaction; no network
      // transport is run by this route. Only the background drainer sends mail.
      w.enqueueMail([email,'Confirm your new Care Web email','Confirm this email address',
        '<p>A request was made to use this address for a Care Web account. Open the link and press Confirm email change to continue. The link expires in one hour.</p><p>If you did not request or agree to this change, ignore this message. No account details have changed.</p>',
        'Review email change',c.baseUrl(req)+'/#/email-change?token='+token,undefined,[],
        {event_key:messageKey(id),user_id:target.id,kind:'security',event_kind:'account-email-verify',transactional:true,account_email_change:id,expires_at:expires}]);
      if (!db.prepare('SELECT id FROM delivery_outbox WHERE event_key=?').get(messageKey(id))) throw Error('Email could not be queued.');
      w.enqueueMail([target.email,'Care Web email change requested','Email change requested',
        '<p>A request was made to change the sign-in email on a Care Web account. The current email stays in use until the new address is confirmed.</p><p>If you did not request or agree to this change, sign in to cancel the pending change from your profile or contact the office immediately.</p>',
        'Open account profile',c.baseUrl(req)+'/#/account/profile',undefined,[],{event_key:'account-email-change:'+id+':requested-old',user_id:target.id,kind:'security',event_kind:'account-email-requested',transactional:true,expires_at:expires}]);
      w.event(target.id,'account-email','change-requested','account-email-change:'+id+':requested');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return fail(res,503,'The verification message could not be queued. Your current email has not changed. Please try again.'); }
    return json(res,200,{...view(target),ok:true,message:'Verification email queued to the new address. The current email stays in use until the link is confirmed.'});
  }
  function cancel(req,res,u,target,body) {
    const row = db.prepare("SELECT * FROM account_email_changes WHERE user_id=? AND state='pending' ORDER BY id DESC LIMIT 1").get(target.id);
    if (!row || Number(body.request_id) !== row.id) return fail(res,409,'This email change is no longer current. Refresh the profile.');
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare("UPDATE account_email_changes SET state='cancelled',resolved_at=? WHERE id=? AND state='pending'").run(now(),row.id); cancelMail(row.id,'Email change cancelled'); w.event(target.id,'account-email','change-cancelled','account-email-change:'+row.id+':cancelled'); db.exec('COMMIT'); }
    catch(e) { db.exec('ROLLBACK'); throw e; }
    json(res,200,{...view(target),ok:true,message:'Email change cancelled. The current email is unchanged.'});
  }
  const ownGet = /^\/api\/me\/email$/, ownChange = /^\/api\/me\/email-change$/, ownCancel = /^\/api\/me\/email-change\/cancel$/;
  route('GET',ownGet,(req,res,m,u)=>{const target=own(req,res,u);if(target)json(res,200,view(target));});
  route('POST',ownChange,(req,res,m,u,b,ip)=>{const target=own(req,res,u);if(target)return initiate(req,res,u,target,b,ip,false);});
  route('POST',ownCancel,(req,res,m,u,b)=>{const target=own(req,res,u);if(target)return cancel(req,res,u,target,b);});
  route('GET',/^\/api\/admin\/participants\/(\d+)\/email$/,(req,res,m,u)=>{const target=office(req,res,u,m[1]);if(target)json(res,200,view(target));});
  route('POST',/^\/api\/admin\/participants\/(\d+)\/email-change$/,(req,res,m,u,b,ip)=>{const target=office(req,res,u,m[1]);if(target)return initiate(req,res,u,target,b,ip,true);});
  route('POST',/^\/api\/admin\/participants\/(\d+)\/email-change\/cancel$/,(req,res,m,u,b)=>{const target=office(req,res,u,m[1]);if(target)return cancel(req,res,u,target,b);});
  const confirmPath = /^\/api\/email-change\/confirm$/;
  c.publicAPI.push(['GET',confirmPath],['POST',confirmPath]);
  const lookup = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? db.prepare('SELECT * FROM account_email_changes WHERE token_hash=?').get(hash(token)) : null;
  const invalidReply = res => fail(res,400,'This email change link is invalid, expired or no longer current. Request a new change from the profile.','email_change_invalid');
  route('GET',confirmPath,(req,res)=>{
    const token = new URL(req.url,'http://local').searchParams.get('token'), request = lookup(token);
    if (invalid(request)) return invalidReply(res);
    json(res,200,{valid:true,new_email_hint:emailHint(request.new_email),expires_at:request.expires_at},{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  });
  route('POST',confirmPath,async(req,res,m,u,b,ip)=>{
    if (c.limited && c.limited(ip,'email-change-confirm',20)) return fail(res,429,'Too many attempts. Please try again later.');
    const request = lookup(b.token); if (invalid(request)) return invalidReply(res);
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = db.prepare('SELECT * FROM account_email_changes WHERE id=?').get(request.id);
      if (invalid(fresh)) { db.exec('ROLLBACK'); return invalidReply(res); }
      const updated=db.prepare('UPDATE users SET email=?,verified=1 WHERE id=? AND email=?').run(request.new_email,request.user_id,request.old_email);
      if (updated.changes !== 1) throw Error('Account changed before verification');
      db.prepare("UPDATE account_email_changes SET state='confirmed',resolved_at=? WHERE id=? AND state='pending'").run(now(),request.id);
      cancelMail(request.id,'Email change completed');
      db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(),request.user_id);
      c.stampLegacyCutoff(request.user_id);
      // Generic security receipts contain no participant identity, care data,
      // new address, invoice details or sign-in tokens at either destination.
      for (const [suffix,destination] of [['old',request.old_email],['new',request.new_email]]) w.enqueueMail([destination,'Care Web email address updated','Account email changed',
        '<p>The sign-in email on a Care Web account was changed after the new address was confirmed. Existing sessions have been signed out.</p><p>If you did not authorise this change, contact the office immediately.</p>',
        'Contact The Care Web',c.baseUrl(req)+'/#/contact',undefined,[],{event_key:'account-email-change:'+request.id+':'+suffix,user_id:request.user_id,kind:'security',event_kind:'account-email-updated',transactional:true,expires_at:new Date(Date.now()+7*864e5).toISOString()}]);
      w.event(request.user_id,'account-email','change-confirmed','account-email-change:'+request.id+':confirmed');
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); return fail(res,409,'The account changed while confirming the address. Sign in and request a fresh email change.'); }
    json(res,200,{ok:true,requires_login:true,message:'Email updated. Sign in with the new email address and your existing password.'},c.clearCookie);
  });
  function suppress(row,args) {
    const id = args[8]?.account_email_change; if (!id) return '';
    const request = db.prepare('SELECT * FROM account_email_changes WHERE id=?').get(Number(id));
    return invalid(request) || row.recipient !== request.new_email || row.user_id !== request.user_id ? 'Email change expired, cancelled or superseded' : '';
  }
  return { suppress };
};
