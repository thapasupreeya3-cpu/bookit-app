'use strict';
// Exercise the shipped notification code against authenticated API responses; no messages are sent.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/assets/booking-updates.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const update = (changes = {}) => ({id:1,booking_id:40,participant_id:12,participant_name:'Alex Participant',worker_name:'Sam Worker',date:'2026-09-16',start:'19:20',hours:3,accepted_at:'2026-09-15T12:00:00Z',destination:'#/journey?panel=shift&booking=40',...changes});
function harness({role='participant',admin=false,actingFor=null,online=true,hash='#/bookings?view=calendar'} = {}) {
  const calls = [], listeners = {}, intervals = [], focusCalls = [];
  let handle = async () => ({count:1,updates:[update()]}), html = '', writes = 0;
  const matches = (node, selector) => selector[0] === '[' ? node.hasAttribute(selector.slice(1,-1)) : node.tag === selector;
  const host = {hidden:true,nodes:[],isConnected:true,querySelector(selector){return this.nodes.find(n => matches(n,selector)) || null;},querySelectorAll(selector){return this.nodes.filter(n => matches(n,selector));},contains(node){return this.nodes.includes(node);}};
  const outside = id => ({id,isConnected:true,visible:true,getClientRects(){return this.visible?[{}]:[];},focus(options){ctx.document.activeElement=this;focusCalls.push({node:this,options:clone(options)});}});
  const nav = outside('navBookings'), main = outside('main'), elsewhere = outside('other-page-control');
  Object.defineProperty(host, 'innerHTML', {get:() => html,set(value){
    if (host.contains(ctx.document.activeElement)) ctx.document.activeElement = ctx.document.body;
    for (const node of host.nodes) node.isConnected = false;
    html = value; writes++; host.nodes = [];
    for (const match of value.matchAll(/<(button|a|details|summary)\b([^>]*)>/g)) {
      const attrs = {}, dataset = {};
      for (const attr of match[2].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/gi)) attrs[attr[1]] = attr[2] ?? '';
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      const node = {tag:match[1],attrs,dataset,open:false,isConnected:true,disabled:Object.hasOwn(attrs,'disabled'),hasAttribute:key=>Object.hasOwn(attrs,key),getAttribute:key=>attrs[key]??null,focus(options){if(this.disabled||!this.isConnected)return;ctx.document.activeElement=this;focusCalls.push({node:this,options:clone(options)});},closest(selector){return selector.split(',').some(s => {const key = s.trim().slice(1,-1);return Object.hasOwn(attrs,key);}) ? this : null;}};
      host.nodes.push(node);
    }
  }});
  const ctx = {Date,Number,String,Object,Math,Map,Set,URLSearchParams,Promise,encodeURIComponent,
    location:{hash},document:{hidden:false,activeElement:null,body:{id:'body'},getElementById:id=>({bookingUpdates:host,navBookings:nav,main})[id]||null,addEventListener:(type, fn)=>listeners['document:'+type] = fn},
    API:{online:false,me:{id:12,role,admin},actingFor,call:async(url,options={})=>{calls.push({url,options:clone(options)});return handle(url,options);}},
    setInterval:(fn,ms)=>intervals.push({fn,ms}),setTimeout:()=>1,clearTimeout(){},addEventListener:(type,fn)=>listeners[type]=fn,
    localStorage:{getItem(){throw Error('Booking updates must not use local storage');},setItem(){throw Error('Booking updates must not use local storage');}},sessionStorage:{setItem(){throw Error('Booking updates must not use session storage');}}
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source,ctx);ctx.API.online = online;
  return {ctx,host,calls,listeners,intervals,nav,main,elsewhere,focusCalls,ui:ctx.CareBookingUpdates,handle:fn=>handle=fn,writes:()=>writes,
    node(attribute,value){return host.nodes.find(n=>n.hasAttribute(attribute)&&(value===undefined||n.getAttribute(attribute)===String(value)));},
    click(selector){const node=host.nodes.find(n=>Object.hasOwn(n.attrs,selector));assert.ok(node,selector);return host.onclick({target:node,preventDefault(){}});}};
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS '+name); }
(async()=>{
  await test('Accepted booking is a prominent labelled update with real worker, date and direct visit link', async()=>{
    const h=harness();await h.ui.sync();assert.equal(h.host.hidden,false);assert.match(h.host.innerHTML,/Booking accepted/);assert.match(h.host.innerHTML,/Sam Worker/);assert.match(h.host.innerHTML,/Wed, 16 Sept 2026 at 7:20 pm · 3 hours/);assert.match(h.host.innerHTML,/href="#\/journey\?panel=shift&amp;booking=40"/);assert.match(h.host.innerHTML,/aria-live="polite"/);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
  });
  await test('Calendar, List and other pages retain the global confirmation instead of clearing it', async()=>{
    const h=harness();await h.ui.sync();for(const hash of ['#/bookings?view=list','#/account/profile','#/bookings?view=calendar']){h.ctx.location.hash=hash;await h.listeners.hashchange();assert.equal(h.host.hidden,false);assert.match(h.host.innerHTML,/Booking accepted/);}assert.equal(h.calls.length,4);
  });
  await test('Public, worker, admin and unselected helper sessions do not poll participant updates', async()=>{
    for(const options of [{online:false},{role:'worker'},{admin:true},{role:'coordinator'}]){const h=harness(options);await h.ui.sync();await h.intervals[0].fn();assert.equal(h.calls.length,0);assert.equal(h.host.hidden,true);}assert.equal(harness().intervals[0].ms,15000);
  });
  await test('Selected helper sees the named participant and remains in that person’s booking context', async()=>{
    const h=harness({role:'coordinator',actingFor:{id:12,name:'Alex Participant',scopes:['bookings']}});await h.ui.sync();assert.match(h.host.innerHTML,/For Alex Participant/);assert.match(h.host.innerHTML,/booking=40&amp;for=12/);assert.equal(h.calls[0].options.noFor,undefined);
  });
  await test('View booking does not acknowledge unseen updates; explicit Dismiss posts only that update', async()=>{
    const h=harness();h.handle(async(url)=>url.endsWith('/read')?{ok:true,read:1,count:1}:{count:2,updates:[update(),update({id:2,booking_id:41,worker_name:'Other Worker'})]});await h.ui.sync();assert.match(h.host.innerHTML,/1 more accepted booking/);const link=h.host.nodes.find(n=>Object.hasOwn(n.attrs,'data-cbu-view'));h.host.onclick({target:link,preventDefault(){throw Error('Normal navigation should remain available');}});assert.equal(h.calls.length,1);await h.click('data-cbu-dismiss');assert.deepEqual(h.calls[1],{url:'/me/booking-updates/read',options:{method:'POST',body:{ids:[1]}}});assert.ok(!h.host.innerHTML.includes('Sam Worker'));assert.match(h.host.innerHTML,/Other Worker/);
  });
  await test('Failed acknowledgment retains the update and provides a retry instead of hiding it', async()=>{
    const h=harness();await h.ui.sync();h.handle(async()=>{throw Error('Offline');});await h.click('data-cbu-dismiss');assert.match(h.host.innerHTML,/Sam Worker/);assert.match(h.host.innerHTML,/Could not dismiss/);assert.ok(!h.host.nodes.find(n=>Object.hasOwn(n.attrs,'data-cbu-dismiss')).disabled);
  });
  await test('Dismissed last update disappears only after successful server acknowledgment', async()=>{
    const h=harness();await h.ui.sync();let release;h.handle(()=>new Promise(resolve=>release=resolve));const pending=h.click('data-cbu-dismiss');assert.match(h.host.innerHTML,/Sam Worker/);assert.equal(h.node('data-cbu-dismiss').getAttribute('aria-disabled'),'true');release({ok:true,read:1,count:0});await pending;assert.equal(h.host.hidden,true);assert.equal(h.host.innerHTML,'');
  });
  await test('Revoked access or expired session immediately removes cached booking names', async()=>{
    for(const status of [401,403]){const h=harness({role:'coordinator',actingFor:{id:12,scopes:['bookings']}});await h.ui.sync();h.handle(async()=>{throw Object.assign(Error('Access denied'),{status});});await h.ui.refresh(true);assert.equal(h.host.hidden,true);assert.equal(h.host.innerHTML,'');}
  });
  await test('A late response cannot expose a previous account or selected participant', async()=>{
    for(const change of [h=>h.ctx.API.me={id:90,role:'participant'},h=>h.ctx.API.actingFor={id:90,scopes:['bookings']},h=>h.ctx.API.online=false]){const h=harness({role:'coordinator',actingFor:{id:12,scopes:['bookings']}});let release;h.handle(()=>new Promise(resolve=>release=resolve));const pending=h.ui.sync();change(h);h.handle(async()=>({count:0,updates:[]}));await h.ui.sync();release({count:1,updates:[update({worker_name:'PRIVATE OLD NAME'})]});await pending;assert.ok(!h.host.innerHTML.includes('PRIVATE OLD NAME'));}
  });
  await test('A late dismissal from another account cannot alter the current account’s banner', async()=>{
    const h=harness();await h.ui.sync();let release;h.handle(()=>new Promise(resolve=>release=resolve));const pending=h.ui.acknowledge([1]);h.ctx.API.me={id:91,role:'participant'};h.handle(async()=>({count:1,updates:[update({id:9,worker_name:'New account worker'})]}));await h.ui.sync();release({ok:true,read:1,count:0});await pending;assert.match(h.host.innerHTML,/New account worker/);
  });
  await test('Background polling shares in-flight requests and preserves expanded details when unchanged', async()=>{
    const h=harness();let release;h.handle(()=>new Promise(resolve=>release=resolve));const first=h.ui.sync(),second=h.ui.sync();assert.equal(h.calls.length,1);const d={count:2,updates:[update(),update({id:2,booking_id:41})]};release(d);await Promise.all([first,second]);h.host.querySelector('details').open=true;const writes=h.writes();h.handle(async()=>d);await h.ui.refresh(true);assert.equal(h.writes(),writes);assert.equal(h.host.querySelector('details').open,true);await h.intervals[0].fn();assert.equal(h.calls.length,2);
  });
  await test('Network failure labels old data as last confirmed and retry recovers current status', async()=>{
    const h=harness();await h.ui.sync();h.handle(async()=>{throw Error('Connection lost');});await h.ui.refresh(true);assert.match(h.host.innerHTML,/last confirmed status/);assert.match(h.host.innerHTML,/Could not refresh/);h.handle(async()=>({count:0,updates:[]}));await h.click('data-cbu-refresh');assert.equal(h.host.hidden,true);
  });
  await test('Unsafe names and provider destinations cannot inject markup or external navigation', async()=>{
    const h=harness();h.handle(async()=>({count:1,updates:[update({worker_name:'<img src=x onerror=alert(1)>',destination:'javascript:alert(1)'})]}));await h.ui.sync();assert.ok(!h.host.innerHTML.includes('<img'));assert.ok(!h.host.innerHTML.includes('javascript:'));assert.match(h.host.innerHTML,/&lt;img/);assert.match(h.host.innerHTML,/#\/journey\?panel=shift&amp;booking=40/);
  });
  await test('Hidden tabs pause polling and visibility refreshes without changing scroll position', async()=>{
    const h=harness();h.ctx.document.hidden=true;await h.ui.sync();assert.equal(h.calls.length,0);h.ctx.document.hidden=false;await h.listeners['document:visibilitychange']();await Promise.resolve();await Promise.resolve();assert.equal(h.calls.length,1);assert.match(source,/setInterval\(\(\) => refresh\(\), 15000\)/);assert.ok(!/scrollTo|scrollIntoView|location\.assign/.test(source));
  });
  await test('Keyboard dismissal keeps the same focusable control while busy and ignores repeat activation', async()=>{
    const h=harness();await h.ui.sync();h.node('data-cbu-dismiss',1).focus({preventScroll:true});let release;h.handle(()=>new Promise(resolve=>release=resolve));const pending=h.click('data-cbu-dismiss');assert.equal(h.ctx.document.activeElement,h.node('data-cbu-dismiss',1));assert.equal(h.ctx.document.activeElement.getAttribute('aria-disabled'),'true');assert.equal(h.ctx.document.activeElement.disabled,false);await h.click('data-cbu-dismiss');assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);release({ok:true,read:1,count:0});await pending;assert.ok(h.focusCalls.every(c=>c.options.preventScroll===true));
  });
  await test('Failed keyboard dismissal restores focus to the same enabled update button', async()=>{
    const h=harness();await h.ui.sync();h.node('data-cbu-dismiss',1).focus({preventScroll:true});let reject;h.handle(()=>new Promise((resolve,no)=>reject=no));const pending=h.click('data-cbu-dismiss');reject(Error('Offline'));await pending;assert.equal(h.ctx.document.activeElement,h.node('data-cbu-dismiss',1));assert.equal(h.ctx.document.activeElement.getAttribute('aria-disabled'),'false');assert.match(h.host.innerHTML,/Could not dismiss/);assert.ok(h.focusCalls.every(c=>c.options.preventScroll===true));
  });
  await test('Successful keyboard dismissal moves to the next remaining booking without scrolling', async()=>{
    const h=harness();h.handle(async()=>({count:2,updates:[update(),update({id:2,booking_id:41})]}));await h.ui.sync();h.node('data-cbu-dismiss',1).focus({preventScroll:true});h.handle(async()=>({ok:true,read:1,count:1}));await h.click('data-cbu-dismiss');assert.equal(h.ctx.document.activeElement,h.node('data-cbu-view',2));assert.ok(h.focusCalls.every(c=>c.options.preventScroll===true));
  });
  await test('Dismissing the last focused update returns to visible navigation or main content on mobile', async()=>{
    for(const navVisible of [true,false]){const h=harness();h.nav.visible=navVisible;await h.ui.sync();h.node('data-cbu-dismiss',1).focus({preventScroll:true});h.handle(async()=>({ok:true,read:1,count:0}));await h.click('data-cbu-dismiss');assert.equal(h.ctx.document.activeElement,navVisible?h.nav:h.main);assert.ok(h.focusCalls.every(c=>c.options.preventScroll===true));}
  });
  await test('Dismiss success and failure never steal focus after the person moves elsewhere', async()=>{
    for(const success of [true,false]){const h=harness();await h.ui.sync();h.node('data-cbu-dismiss',1).focus({preventScroll:true});let release,reject;h.handle(()=>new Promise((yes,no)=>{release=yes;reject=no;}));const pending=h.click('data-cbu-dismiss');h.elsewhere.focus({preventScroll:true});const focusCount=h.focusCalls.length;if(success)release({ok:true,read:1,count:0});else reject(Error('Offline'));await pending;assert.equal(h.ctx.document.activeElement,h.elsewhere);assert.equal(h.focusCalls.length,focusCount);}
  });
  await test('Moving to another update during dismissal keeps focus on that selected control', async()=>{
    const h=harness();h.handle(async()=>({count:2,updates:[update(),update({id:2,booking_id:41})]}));await h.ui.sync();h.node('data-cbu-dismiss',1).focus({preventScroll:true});let release;h.handle(()=>new Promise(resolve=>release=resolve));const pending=h.click('data-cbu-dismiss');h.node('data-cbu-dismiss',2).focus({preventScroll:true});release({ok:true,read:1,count:1});await pending;assert.equal(h.ctx.document.activeElement,h.node('data-cbu-dismiss',2));assert.ok(h.focusCalls.every(c=>c.options.preventScroll===true));
  });
  console.log('booking updates UI: '+passed+'/'+passed+' passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
