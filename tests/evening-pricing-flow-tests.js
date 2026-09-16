'use strict';
// Actual routes, a disposable database and synthetic identities. A preload
// blocks all external traffic, including payment, email and calendar services.
process.env.TZ = 'Australia/Sydney';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..'), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'careweb-evening-http-'));
const stamp = new Date().toISOString(), password = 'Copper-Rainstorm!82', results = [];
const home = { street: '41 Synthetic Private Lane', suburb: 'Ryde', state: 'NSW', postcode: '2112', arrival_notes: 'Synthetic private door instruction.' };
const note = 'Delivered the agreed overnight personal support, assisted with the planned activities and recorded the participant outcome.';
let child, db, base, log = '', owner, other, helper, worker, admin, linkId, legacyInvoice;
const ins = (table, values) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
const booking = (values = {}) => ins('bookings', { participant_id: owner.id, worker_id: worker.id, service: 'personal-care', date: '2026-08-26', start: '19:20', hours: 3, sleepover: 0, status: 'accepted', created: stamp, ...values });
const row = id => db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
const period = (start, end) => ({ start, end });
async function req(method, url, person, body, forId) {
  const r = await fetch(base + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(person?.cookie ? { Cookie: person.cookie } : {}), ...(forId ? { 'X-Bookit-For': String(forId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
function ok(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.data) || r.text.slice(0, 200)); return r.data; }
async function test(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }); console.log('PASS ' + name); } catch (error) { results.push({ name, result: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ' ' + error.stack); } }
async function register(label) {
  const email = 'evening-' + label + '@example.test';
  const r = await req('POST', '/api/register', null, { role: 'participant', email, name: 'Synthetic evening ' + label, password, suburb: 'Ryde NSW', plan: 'private', terms_accepted: true, terms_version: /const CURRENT_TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT + '/server.js', 'utf8'))[1] });
  return { id: ok(r).user.id, cookie: r.cookie, email };
}
async function login(id) { const r = await req('POST', '/api/login', null, { email: db.prepare('SELECT email FROM users WHERE id=?').get(id).email, password: 'demo1234' }); ok(r); return { id, cookie: r.cookie }; }
const quoteInput = values => ({ date: '2026-08-26', start: '19:20', hours: 3, service: 'personal-care', sleepover: '0', ...values });
const quote = values => req('GET', '/api/pricing/quote?' + new URLSearchParams(quoteInput(values))).then(ok);
const complete = (id, values = {}) => req('PATCH', '/api/bookings/' + id, worker, { status: 'completed', note, active_hours: 0, ...values });
async function waitFor(fn) { for (let n = 0; n < 120; n++) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Expected automatic invoice/claim did not finish.'); }
async function issued(id) { return waitFor(() => row(id).invoice_no); }
const snapshot = no => JSON.parse(db.prepare('SELECT data FROM invoice_snapshots WHERE invoice_no=?').get(no).data);
function assertPrivateAbsent(value) { for (const secret of [home.street, home.arrival_notes]) assert.ok(!JSON.stringify(value).includes(secret), 'Exact address escaped into the price response'); }

async function main() {
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); base = 'http://127.0.0.1:' + port;
  const guard = path.join(DIR, 'loopback-only.js');
  fs.writeFileSync(guard, `'use strict';
const local=value=>{const h=typeof value==='string'||value instanceof URL?new URL(value).hostname:(value.hostname||value.host||'');if(!['127.0.0.1','localhost','::1','[::1]'].includes(h))throw Error('Synthetic evening test blocks external network');};
for(const name of ['node:http','node:https']){const m=require(name),request=m.request;m.request=function(...args){local(args[0]);return request.apply(this,args);};const get=m.get;m.get=function(...args){local(args[0]);return get.apply(this,args);};}
const fetch=global.fetch;global.fetch=function(input,...args){local(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args);};
`);
  const env = { ...require('../scripts/test-environment')(), PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, DB_PATH: path.join(DIR, 'test.db'), DOCS_DIR: path.join(DIR, 'docs'), PHOTOS_DIR: path.join(DIR, 'photos'), SECRET_FILE: path.join(DIR, 'secret'), SEED_DEMO: 'on', ADMIN_MFA_REQUIRED: 'off', SESSION_SECRET: 'synthetic-evening-price-key-with-more-than-32-characters', TZ: 'Australia/Sydney' };
  child = spawn(process.execPath, ['--no-warnings', '--require', guard, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error(log); try { if ((await fetch(base + '/api/version')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  db = new DatabaseSync(env.DB_PATH); db.exec('PRAGMA busy_timeout=5000');
  owner = await register('owner'); other = await register('other'); helper = await register('helper');
  db.prepare("UPDATE users SET role='coordinator',verified=1 WHERE id=?").run(helper.id); db.prepare('UPDATE users SET verified=1 WHERE id=?').run(owner.id); db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  linkId = ins('account_links', { participant_id: owner.id, coordinator_id: helper.id, invite_email: helper.email, invite_token: 'synthetic-evening-link', scopes: '["bookings"]', status: 'active', invited_at: stamp });
  admin = await login(1); worker = await login(10);
  db.exec(`UPDATE users SET suburb='Ryde NSW' WHERE id=10;UPDATE worker_profiles SET visible=1,self_paused=0,days='[1,1,1,1,1,1,1]',service_areas='["Ryde NSW"]',availability_windows=NULL,leave_dates='[]',services='["daily-tasks","personal-care"]' WHERE user_id=10;UPDATE module_completions SET expires_at='2032-01-01' WHERE worker_id=10`);
  ok(await req('PUT', '/api/me/service-address', owner, { revision: 0, address: home }));

  const policy=require('../lib/booking-pricing-policy');
  const oldQuote=(values={})=>{
    const q={date:'2026-08-26',start:'19:20',duration_hours:3,support_type:'hourly',total:238.21,...values};
    q.lines=[{date:q.date,when:'19:20–20:00',category:'weekday-day',item:'01_011_0107_1_1',description:'Weekday daytime',qty:2/3,unit:'hours',rate:73.58,amount:49.05},{date:q.date,when:'20:00–22:20',category:'weekday-evening',item:'01_015_0107_1_1',description:'Weekday evening',qty:7/3,unit:'hours',rate:81.07,amount:189.16}];
    return q;
  };
  for(const form_key of ['p-agreement','p-consent-privacy'])ins('participant_docs',{participant_id:owner.id,form_key,uploaded_at:stamp});
  ins('support_plans',{participant_id:owner.id,version:1,current:1,status:'confirmed',created:stamp,updated:stamp,confirmed_at:stamp,reviewed_at:stamp,reviewed_by:'Synthetic reviewer',review_due:'2031-12-31'});

  await test('Public and private quotes disclose the new whole-evening price and a signed policy',async()=>{
    for(const q of [await quote(),ok(await req('POST','/api/pricing/quote',owner,quoteInput()))]){
      assert.equal(q.total,243.21);assert.equal(q.pricing_policy,policy.CURRENT);assert.equal(q.lines.length,1);assert.equal(q.lines[0].item,'01_015_0107_1_1');assert.equal(q.lines[0].qty,3);assert.match(q.rate_note,/evening rate for the whole weekday period/);assert.match(q.quote_key,/^[a-f0-9]{64}$/);assertPrivateAbsent(q);
    }
    const midnight=await quote({start:'19:00',hours:5});assert.equal(midnight.total,405.35);assert.match(midnight.label,/Hourly support/);assert.ok(!midnight.label.includes('Active overnight'));
  });
  await test('A client cannot select legacy pricing in a new quote or booking',async()=>{
    const proposed={worker_id:worker.id,date:'2030-09-16',start:'19:20',hours:3,service:'personal-care',pricing_policy:policy.LEGACY};
    const shown=ok(await req('POST','/api/pricing/quote',owner,proposed));assert.equal(shown.total,243.21);assert.equal(shown.pricing_policy,policy.CURRENT);
    const result=ok(await req('POST','/api/bookings',owner,{...proposed,quote_keys:[shown.quote_key]}));const b=row(result.id);
    assert.equal(b.pricing_policy,policy.CURRENT);assert.equal(JSON.parse(b.booking_quote).total,243.21);assert.equal(JSON.parse(b.booking_quote).pricing_policy,policy.CURRENT);
  });
  await test('A correctly signed old-format quote is refused with refresh guidance before writing any booking',async()=>{
    const proposed={worker_id:worker.id,date:'2030-09-17',start:'19:20',hours:3,service:'personal-care'};
    const old=oldQuote({date:proposed.date});
    const key=require('node:crypto').createHmac('sha256',env.SESSION_SECRET).update('booking-price:'+JSON.stringify([proposed.service,1,proposed.date,proposed.start,proposed.hours,false,old.lines,[],[]])).digest('hex');
    const count=db.prepare('SELECT COUNT(*) n FROM bookings').get().n;
    const result=ok(await req('POST','/api/bookings',owner,{...proposed,quote_keys:[key]}),409);assert.equal(result.code,'booking_quote_changed');assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,count);
  });
  await test('A repeating request saves the new policy and displayed price for every occurrence',async()=>{
    const proposed={worker_id:worker.id,date:'2030-09-18',start:'19:20',hours:3,service:'personal-care',repeat:'weekly',repeat_count:2};
    const quotes=await Promise.all(['2030-09-18','2030-09-25'].map(date=>req('POST','/api/pricing/quote',owner,{...proposed,date}).then(ok)));
    const result=ok(await req('POST','/api/bookings',owner,{...proposed,quote_keys:quotes.map(q=>q.quote_key)}));
    const rows=db.prepare('SELECT pricing_policy,booking_quote FROM bookings WHERE series_id=?').all(row(result.id).series_id);assert.equal(rows.length,2);for(const b of rows){assert.equal(b.pricing_policy,policy.CURRENT);assert.equal(JSON.parse(b.booking_quote).total,243.21);}
  });
  await test('An unchanged legacy booking completes and invoices at its recorded $238.21 quote',async()=>{
    const q=oldQuote(),id=booking({pricing_policy:policy.LEGACY,booking_quote:JSON.stringify(q)});
    const completed=ok(await complete(id));assert.equal(completed.support_total,238.21);assert.deepEqual(JSON.parse(row(id).automatic_invoice_lines),q.lines);
    const no=await issued(id);assert.equal(snapshot(no).total,238.21);legacyInvoice={id,no};
  });
  await test('A legacy booking without a quote still uses the earlier split calculation at completion',async()=>{
    const id=booking({pricing_policy:policy.LEGACY});ok(await complete(id));assert.equal(row(id).total,238.21);assert.deepEqual(JSON.parse(row(id).automatic_invoice_lines).map(l=>l.category),['weekday-day','weekday-evening']);assert.equal(snapshot(await issued(id)).total,238.21);
  });
  await test('A changed legacy interval keeps its earlier pricing method instead of adopting the new evening policy',async()=>{
    const id=booking({pricing_policy:policy.LEGACY,start:'19:00',booking_quote:JSON.stringify(oldQuote())});ok(await complete(id));assert.equal(row(id).total,235.72);assert.equal(row(id).pricing_policy,policy.LEGACY);
  });
  await test('Newly created hourly work completes and invoices at $243.21 without changing service-item mappings',async()=>{
    const q=await quote(),id=booking({booking_quote:JSON.stringify(q)});assert.equal(row(id).pricing_policy,policy.CURRENT);const completed=ok(await complete(id));assert.equal(completed.support_total,243.21);assert.equal(row(id).rate_category,'weekday-evening');const invoice=snapshot(await issued(id));assert.equal(invoice.total,243.21);assert.equal(invoice.lines[0].item,'01_015_0107_1_1');
  });
  await test('An issued legacy invoice and its original approval amount survive repeated completion and approval',async()=>{
    const {id,no}=legacyInvoice,before=db.prepare('SELECT * FROM invoice_snapshots WHERE invoice_no=?').get(no),original=row(id);
    assert.equal(ok(await complete(id)).duplicate,true);ok(await req('PATCH','/api/bookings/'+id,owner,{status:'approved'}));ok(await req('PATCH','/api/bookings/'+id,owner,{status:'approved'}));
    assert.deepEqual(db.prepare('SELECT * FROM invoice_snapshots WHERE invoice_no=?').get(no),before);assert.equal(row(id).total,original.total);assert.equal(row(id).automatic_invoice_lines,original.automatic_invoice_lines);
  });
  await test('Already completed, approved unissued charges retain their saved price during invoice retry',async()=>{
    const q=oldQuote(),id=booking({pricing_policy:policy.LEGACY,status:'completed',completed_at:stamp,approval_state:'approved',approved_at:stamp,unit_price:79.40,total:238.21,worker_share:170,rate_category:'mixed',automatic_invoice_lines:JSON.stringify(q.lines)});
    ok(await req('POST','/api/admin/billing/retry',admin,{}));assert.equal(snapshot(await issued(id)).total,238.21);assert.equal(row(id).total,238.21);assert.equal(row(id).automatic_invoice_lines,JSON.stringify(q.lines));
  });
  await test('A changed service cannot reuse an old quote item even when its dates and duration match',async()=>{
    const id=booking({pricing_policy:policy.LEGACY,service:'daily-tasks',booking_quote:JSON.stringify(oldQuote())});ok(await complete(id));assert.equal(row(id).total,238.21);assert.deepEqual(JSON.parse(row(id).automatic_invoice_lines).map(l=>l.item),['01_801_0115_1_1','01_802_0115_1_1']);
  });
  await test('A changed receiving locality cannot reuse a new quote signed for the previous location',async()=>{
    const q=ok(await req('POST','/api/pricing/quote',owner,quoteInput()));assert.match(q.pricing_context,/^[a-f0-9]{64}$/);
    // Simulate an earlier agreed price, then a separately recorded location change.
    const prior={...q,total:210,lines:q.lines.map(l=>({...l,rate:70,amount:210}))};
    const id=booking({booking_quote:JSON.stringify(prior)});const saved=JSON.parse(db.prepare('SELECT data FROM booking_locations WHERE booking_id=?').get(id).data);
    db.prepare('UPDATE booking_locations SET data=?,revision=revision+1 WHERE booking_id=?').run(JSON.stringify({...saved,suburb:'Grafton',postcode:'2460'}),id);
    ok(await complete(id));assert.equal(row(id).total,243.21);assert.equal(JSON.parse(row(id).automatic_invoice_lines)[0].rate,81.07);
  });
  await test('Short-notice cancellation of legacy accepted support uses the existing quoted amount',async()=>{
    // A recent synthetic date puts this accepted booking inside the notice window.
    const day=new Date();while(day.getDay()!==3)day.setDate(day.getDate()-1);const date=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
    const q=oldQuote({date}),id=booking({date,pricing_policy:policy.LEGACY,booking_quote:JSON.stringify(q)});
    const result=ok(await req('PATCH','/api/bookings/'+id,owner,{status:'cancelled',reason_code:'NSDH',reason:'Synthetic cancellation for pricing regression.'}));
    assert.equal(result.short_notice,true);assert.equal(row(id).total,238.21);assert.deepEqual(JSON.parse(row(id).automatic_invoice_lines),q.lines);
  });
}
main().catch(error=>{console.error(error);results.push({name:'HTTP fixture',result:'FAIL',error:error.stack});}).finally(async()=>{
  if(db)db.close();if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  if(process.env.EVENING_PRICING_RESULTS)fs.writeFileSync(process.env.EVENING_PRICING_RESULTS,JSON.stringify({runtime:process.version,scope:'Disposable synthetic accounts; external network blocked',results,serverLog:log},null,2));
  fs.rmSync(DIR,{recursive:true,force:true});console.log(`evening pricing flow: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
});
