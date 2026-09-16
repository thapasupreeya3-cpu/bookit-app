'use strict';
// Exercise the actual shared API client, inline booking submit handler and
// booking-price module. All fetches below are in-memory synthetic responses.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const pricing = fs.readFileSync(path.join(root, 'public/assets/booking-pricing.js'), 'utf8');
const apiStart = html.indexOf('window.API = {'), apiEnd = html.indexOf('\nfunction syncPrimaryNavigation', apiStart);
const formStart = html.indexOf('const STATUS_LABEL = '), formEnd = html.indexOf("document.addEventListener('click', e => {\n  if(e.target.closest('[data-close-modal]')) closeModals();", formStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart && formStart >= 0 && formEnd > formStart, 'actual booking API and form source located');
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const clone = value => JSON.parse(JSON.stringify(value));
function harness() {
  const nodes = new Map(), calls = [], receipts = new Map(), toast = [], timers = new Map();
  let time = Date.now(), serial = 0, commitCount = 0, closed = 0, rendered = 0, failNext = 'network', customFetch = null, confirm = async () => true;
  class Clock extends Date { static now() { return time; } }
  const node = id => {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = {}, n = { id, value: '', checked: false, hidden: false, textContent: '', innerHTML: '', disabled: false, dataset: {}, attrs: {}, style: {},
      classList: { add() {} }, setAttribute(k,v) { n.attrs[k] = v; }, removeAttribute(k) { delete n.attrs[k]; },
      addEventListener(k, f) { (listeners[k] ||= []).push(f); }, async dispatch(k, target = n) { return Promise.all((listeners[k] || []).map(f => f({ target, preventDefault() {} }))); },
      contains() { return false; }, querySelector() { return null; }, focus() {}, append() {}, insertAdjacentElement() {} };
    nodes.set(id,n); return n;
  };
  const values = { bkService: 'personal-care', bkDate: '2030-10-07', bkStart: '09:00', bkHours: '3', bkRepeat: 'weekly', bkRepeatMode: 'count', bkRepeatCount: '2', bkRepeatUntil: '', bkNotes: '' };
  for (const [id,value] of Object.entries(values)) node(id).value = value;
  for (const id of ['bkIntro','bkSleep','bookingServiceLocation','bkRateLine','bkWorkerName','bookingForm','bkFormError']) node(id);
  node('bkWorkerName').dataset.workerId = '10';
  const quote = (body,date) => ({ quote_key: 'synthetic-signed-quote-'+date+'-hours-'+body.hours, date, start: body.start, duration_hours: body.hours, end_date: date, end_time: '12:00', support_type: 'hourly', total: 220.74, lines: [{ date, when: '09:00–12:00', description: 'Weekday daytime', category: 'weekday-day', qty: 3, rate: 73.58, amount: 220.74, unit: 'hours' }] });
  const preview = body => {
    const dates = [], d = new Date(body.date+'T12:00:00Z');
    for (let i=0;i<body.repeat_count;i++) { const date=d.toISOString().slice(0,10), selected=!(body.repeat_skip_dates || []).includes(date); dates.push({ date, selected, skipped: !selected, available: !commitCount, needs_confirmation: false, problem: commitCount ? 'This worker already has an overlapping booking.' : null, quote: quote(body,date) }); d.setUTCDate(d.getUTCDate()+7); }
    return { ok: true, dates, repeat: body.repeat, selected_count: dates.filter(d=>d.selected).length, skipped_count: dates.filter(d=>!d.selected).length, ready: !commitCount, needs_confirmation: false, limit: 26 };
  };
  const ctx = { Intl, URLSearchParams, Date: Clock, Promise, console,
    setTimeout(f) { const id=++serial;timers.set(id,f);return id; }, clearTimeout(id) { timers.delete(id); },
    document: { readyState:'complete',getElementById: node,addEventListener() {},querySelector() {return null;} },
    $: selector => node(selector.slice(1)), location: {hash:'#/bookings?view=routine'},
    crypto: { randomUUID: () => 'synthetic-request-'+(++serial) },
    CareLocations: { chooserValue: () => ({mode:'saved',source_revision:1}) },
    closeModals() { closed++; }, renderBookingsPage() { rendered++; }, toast: text => toast.push(text),
    outOfAreaDialog: data => confirm(data), esc: value => String(value),
    fetch: async (url, options={}) => {
      const call = {url,method:options.method || 'GET',headers:clone(options.headers||{}),body:options.body ? JSON.parse(options.body) : null};calls.push(call);
      if(customFetch)return customFetch(call);
      if(url==='/api/bookings/preview')return response(preview(call.body));
      if(url!=='/api/bookings')throw Error('Unexpected synthetic endpoint '+url);
      const prior=receipts.get(call.body.request_id);
      if(prior)return response({...prior,duplicate:true});
      const result={ok:true,id:100+(++commitCount),ids:[100+commitCount,200+commitCount],count:2,series_id:300+commitCount};receipts.set(call.body.request_id,result);
      const fail=failNext;failNext=null;if(fail==='network')throw TypeError('Synthetic response lost after commit');if(fail==='server')return response({error:'Synthetic response failure after commit'},500);
      return response(result);
    }
  };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(html.slice(apiStart,apiEnd),ctx);
  ctx.API.online=true;ctx.API.me={id:21,role:'participant'};
  vm.runInContext(html.slice(formStart,formEnd),ctx);vm.runInContext("bookingWorker={id:10,name:'Synthetic Worker'};",ctx);vm.runInContext(pricing,ctx);
  return {ctx,node,calls,toast,advance(ms){time+=ms;},submit:()=>node('bookingForm').dispatch('submit'),refresh:()=>ctx.CareBookingPricing.refresh(true),commits:()=>commitCount,closed:()=>closed,rendered:()=>rendered,
    makePreview:preview,setFail(value){failNext=value;},setFetch(fn){customFetch=fn;},setConfirm(fn){confirm=fn;},bookingCalls:()=>calls.filter(c=>c.url==='/api/bookings'),previewCalls:()=>calls.filter(c=>c.url==='/api/bookings/preview')};
}
const results=[];
async function test(name,run){try{await run();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:error.stack});console.error('FAIL '+name+' '+error.stack);}}
(async()=>{
  await test('A lost response retries the committed request receipt even after the preview cache expires',async()=>{
    const h=harness();await h.refresh();await h.submit();assert.equal(h.commits(),1);assert.equal(h.closed(),0);assert.match(h.node('bkFormError').textContent,/response lost/i);
    const first=h.bookingCalls()[0];h.advance(60001);await h.submit();assert.equal(h.bookingCalls().length,2);assert.deepEqual(h.bookingCalls()[1].body,first.body);
    assert.equal(h.previewCalls().length,1,'receipt recovery bypasses an availability check that would see its own bookings');assert.equal(h.commits(),1);assert.equal(h.closed(),1);assert.equal(h.rendered(),1);assert.equal(h.node('bkFormError').hidden,true);
  });
  await test('An ambiguous server failure retains the same request identity until its receipt is recovered',async()=>{
    const h=harness();h.setFail('server');await h.refresh();await h.submit();assert.equal(h.bookingCalls().length,1);h.advance(60001);await h.submit();assert.equal(h.bookingCalls().length,2);assert.equal(h.bookingCalls()[1].body.request_id,h.bookingCalls()[0].body.request_id);assert.equal(h.commits(),1);assert.equal(h.closed(),1);
  });
  await test('Changing the form after an ambiguous response does not replay the earlier booking intent',async()=>{
    const h=harness();await h.refresh();await h.submit();const old=h.bookingCalls()[0].body;h.setFetch(async()=>response({error:'A booking already exists at this time.',clash:true},409));h.node('bkNotes').value='A deliberately changed support instruction';await h.submit();const newer=h.bookingCalls()[1].body;
    assert.notEqual(newer.request_id,old.request_id);assert.equal(newer.notes,'A deliberately changed support instruction');assert.equal(h.bookingCalls().length,2);assert.equal(h.commits(),1);assert.equal(h.closed(),0);assert.match(h.node('bkFormError').textContent,/already exists/);
  });
  await test('A duplicate click during an in-flight submission sends only one booking request',async()=>{
    const h=harness();await h.refresh();let release;h.setFetch(async call=>{assert.equal(call.url,'/api/bookings');return new Promise(resolve=>{release=()=>resolve(response({ok:true,id:12,count:2}));});});
    const first=h.submit();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.bookingCalls().length,1);await h.submit();assert.equal(h.bookingCalls().length,1);release();await first;assert.equal(h.closed(),1);assert.equal(h.node('bkSubmit').attrs['aria-disabled'],undefined);
  });
  await test('A retry without a committed receipt handles a definitive price conflict and reviews fresh prices',async()=>{
    const h=harness();await h.refresh();let posts=0;
    h.setFetch(async call=>{
      if(call.url==='/api/bookings/preview'){const p=h.makePreview(call.body);for(const row of p.dates){row.quote.quote_key+='-updated';row.quote.total=240;row.quote.lines[0].rate=80;row.quote.lines[0].amount=240;}return response(p);}
      assert.equal(call.url,'/api/bookings');posts++;
      if(posts===1)throw TypeError('Synthetic network failure before commit');
      if(posts===2)return response({code:'booking_quote_changed',error:'The booking price has changed. Review the refreshed price.'},409);
      return response({ok:true,id:456,count:2});
    });
    await h.submit();const first=h.bookingCalls()[0].body;h.advance(60001);await h.submit();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.bookingCalls().length,2);assert.deepEqual(h.bookingCalls()[1].body,first);assert.equal(h.closed(),0);assert.equal(h.previewCalls().length,2);assert.match(h.node('bkRateLine').innerHTML,/\$480\.00/);
    await h.submit();assert.equal(h.bookingCalls().length,3);const final=h.bookingCalls()[2].body;assert.equal(final.request_id,first.request_id);assert.ok(final.quote_keys.every(key=>key.endsWith('-updated')));assert.equal(h.closed(),1);
  });
  await test('Editing details while the submission checks prices prevents sending stale form data',async()=>{
    const h=harness();await h.refresh();h.advance(60001);let release;
    h.setFetch(async call=>{assert.equal(call.url,'/api/bookings/preview');return new Promise(resolve=>{release=()=>resolve(response(h.makePreview(call.body)));});});
    const sending=h.submit();await new Promise(resolve=>setImmediate(resolve));h.node('bkHours').value='4';release();await sending;
    assert.equal(h.bookingCalls().length,0);assert.match(h.node('bkFormError').textContent,/details changed/i);assert.equal(h.closed(),0);
  });
  await test('Switching the helper’s participant during travel confirmation cannot retarget the booking retry',async()=>{
    const h=harness();h.ctx.API.me={id:30,role:'coordinator'};h.ctx.API.actingFor={id:21,scopes:['bookings']};h.setFetch(async()=>response({code:'out_of_area',confirm:true,out_of_area_token:'synthetic-proof',travel:{known:false}},409));
    h.setConfirm(async()=>{h.ctx.API.actingFor={id:22,scopes:['bookings']};return true;});
    await assert.rejects(h.ctx.API.call('/bookings',{method:'POST',body:{worker_id:10,date:'2030-10-07',start:'09:00',hours:3}}),/account|participant|changed/i);
    assert.equal(h.bookingCalls().length,1);assert.equal(h.bookingCalls()[0].headers['X-Bookit-For'],'21');
  });
  await test('Switching the signed-in person during travel confirmation prevents retry',async()=>{
    const h=harness();h.setFetch(async()=>response({code:'out_of_area',confirm:true,out_of_area_token:'synthetic-proof',travel:{known:false}},409));h.setConfirm(async()=>{h.ctx.API.me={id:22,role:'participant'};return true;});
    await assert.rejects(h.ctx.API.call('/bookings',{method:'POST',body:{worker_id:10,date:'2030-10-07',start:'09:00',hours:3}}),/account|participant|changed/i);assert.equal(h.bookingCalls().length,1);
  });
  await test('Unchanged account travel confirmation still retries with the original identity and signed proof',async()=>{
    const h=harness();h.ctx.API.me={id:30,role:'coordinator'};h.ctx.API.actingFor={id:21,scopes:['bookings']};h.setFetch(async()=>h.bookingCalls().length===1?response({code:'out_of_area',confirm:true,out_of_area_token:'synthetic-proof',travel:{known:false}},409):response({ok:true,id:123,count:2}));
    const result=await h.ctx.API.call('/bookings',{method:'POST',body:{worker_id:10,request_id:'synthetic-repeat-request',date:'2030-10-07',start:'09:00',hours:3}});assert.equal(result.id,123);assert.equal(h.bookingCalls().length,2);assert.equal(h.bookingCalls()[1].headers['X-Bookit-For'],'21');assert.equal(h.bookingCalls()[1].body.request_id,'synthetic-repeat-request');assert.equal(h.bookingCalls()[1].body.out_of_area_token,'synthetic-proof');
  });
  console.log('care routine submission: '+results.filter(r=>r.result==='PASS').length+'/'+results.length+' passed');
  if(process.env.CARE_ROUTINE_SUBMISSION_RESULTS)fs.writeFileSync(process.env.CARE_ROUTINE_SUBMISSION_RESULTS,JSON.stringify({runtime:process.version,scope:'Actual UI sources, synthetic in-memory requests only',results},null,2)+'\n');
  process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
