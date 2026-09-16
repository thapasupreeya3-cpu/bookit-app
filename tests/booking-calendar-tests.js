'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'public/assets/booking-calendar.js'),'utf8'),results=[];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const flush=()=>new Promise(r=>setImmediate(r));
const event=(action,date)=>({target:{closest:()=>({dataset:{calAction:action,date}})},preventDefault(){this.prevented=true;}});
function sample(role='worker'){return {date:'2026-09-12',view:'month',from:'2026-08-31',to:'2026-10-04',today:'2026-09-12',time_zone:'Australia/Sydney',role,subject:{id:1,name:'Example participant'},alerts:{count:1,next_date:'2026-09-12'},bookings:[{id:3,date:'2026-09-12',start:'09:00',hours:2,status:'requested',service:'daily-tasks',other_name:'Example person',starts_at:'2026-09-11T23:00:00Z',ends_at:'2026-09-12T01:00:00Z',end_date:'2026-09-12',end_time:'11:00',last_date:'2026-09-12',needs_response:role==='worker'},{id:4,date:'2026-09-11',start:'21:00',hours:12,status:'accepted',service:'daily-tasks',other_name:'Overnight person',sleepover:true,starts_at:'2026-09-11T11:00:00Z',ends_at:'2026-09-11T23:00:00Z',end_date:'2026-09-12',end_time:'09:00',last_date:'2026-09-12',needs_response:false},{id:5,date:'2026-09-12',start:'14:00',hours:1,status:'cancelled',service:'daily-tasks',other_name:'Cancelled example',starts_at:'2026-09-12T04:00:00Z',end_date:'2026-09-12',end_time:'15:00',last_date:'2026-09-12'}]};}
function ui(role='worker',options={}){
 const nodes=new Map(),calls=[],timers=new Map(),events={},intervals=[],pickerOpens=[];let timer=0,data=sample(role),count=2,response;
 function node(id){let html='';const children=new Map();const n={id,hidden:false,textContent:'',value:'',dataset:{},attrs:{},classList:{},setAttribute(k,v){n.attrs[k]=v;},focus(){n.focused=true;},querySelector(sel){if(!children.has(sel))children.set(sel,node(id+sel));return children.get(sel);},get innerHTML(){return html;},set innerHTML(v){html=v;children.clear();}};return n;}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
 const ctx={esc,URLSearchParams,Date,encodeURIComponent,SVC_NAME:{'daily-tasks':'Daily support'},document:{hidden:false,getElementById:get,addEventListener(type,fn){events[type]=fn;}},location:{hash:'#/bookings?view=calendar'},API:{online:options.online??true,me:options.me||{id:1,role},actingFor:options.actingFor||null,async call(url,opts){calls.push({url,opts});if(response)return response(url,opts);if(url==='/me/booking-alerts')return {count,next_date:'2026-09-12'};return structuredClone(data);}},CareBookingCarerPicker:{open(options){pickerOpens.push(options);}},setTimeout(fn,ms){const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn,ms){intervals.push({fn,ms});},addEventListener(type,fn){events[type]=fn;}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,get,calls,timers,events,intervals,pickerOpens,setData(v){data=v;},setCount(v){count=v;},respond(fn){response=fn;},render:()=>ctx.CareBookingCalendar.render(),action:(a,d)=>get('bookingsList').onclick(event(a,d))};
}
async function test(name,run){try{await run();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(err){results.push({name,result:'FAIL',error:err.stack});console.error('FAIL '+name+' '+err.stack);}}
(async()=>{
await test('The worker gets compact request counts on Bookings and mobile menu; reading does not clear requests',async()=>{
 const v=ui();await flush();assert.equal(v.get('bookingNavBadge').textContent,'2');assert.equal(v.get('bookingMobileBadge').hidden,false);assert.match(v.get('burger').attrs['aria-label'],/2 booking requests/);await v.render();assert.match(v.get('bookingsList').innerHTML,/! Response needed/);assert.match(v.get('bookingRequestNotice').href,/date=2026-09-12/);assert.equal(v.get('bookingNavBadge').hidden,false);assert.ok(v.calls.every(c=>!c.opts?.method));
});
await test('Participants and office accounts never inherit a worker request warning',async()=>{
 const v=ui('participant');await flush();await v.render();assert.equal(v.calls.filter(c=>c.url==='/me/booking-alerts').length,0);assert.equal(v.get('bookingNavBadge').hidden,true);assert.ok(!v.get('bookingsList').innerHTML.includes('! Response needed'));v.ctx.API.me={id:2,role:'worker',admin:true};v.ctx.CareBookingCalendar.sync();await flush();assert.equal(v.get('bookingMobileBadge').hidden,true);assert.equal(v.ctx.CareBookingCalendar.handles(),false);
});
await test('Calendar displays server-time dates, overnight carry-over and exact existing booking controls',async()=>{
 const v=ui();await v.render();const out=v.get('bookingsList').innerHTML;assert.match(out,/Times shown in Australia\/Sydney/);assert.match(out,/Continues from 11 Sept? · ends 09:00/);assert.match(out,/journey\?panel=shift&amp;booking=3&amp;return_date=2026-09-12/);assert.match(out,/aria-current="date"/);assert.equal((out.match(/tabindex="0"/g)||[]).length,1);assert.ok(!out.includes('Cancelled example'));assert.ok(!out.includes('name="note"'));
});
await test('Month arithmetic crosses leap years and years without browser timezone drift',()=>{
 const v=ui(),c=v.ctx.CareBookingCalendar;assert.equal(c.shiftDate('2028-01-31',0,1),'2028-02-01');assert.equal(c.shiftDate('2028-02-28',1),'2028-02-29');assert.equal(c.shiftDate('2026-12-31',1),'2027-01-01');assert.equal(c.days('2021-02-01','2021-02-28').length,28);assert.equal(c.days('2020-08-31','2020-10-11').length,42);
});
await test('Day selection and arrow keys preserve focus and update the day agenda without a page jump',async()=>{
 const v=ui();await v.render();v.action('day','2026-09-13');assert.match(v.get('bookingsList').innerHTML,/Sunday,? 13 September/);assert.equal(v.get('bookingsList').querySelector('[data-date="2026-09-13"]').focused,true);const ev=event('day','2026-09-13');ev.key='ArrowLeft';v.get('bookingsList').onkeydown(ev);assert.equal(ev.prevented,true);assert.match(v.get('bookingsList').innerHTML,/Example person/);assert.equal(v.ctx.location.hash,'#/bookings?view=calendar');
});
await test('Clicking a calendar date opens the shared carer popup for that date with no recurring preset or booking mutation',async()=>{
 const v=ui('participant');await v.render();v.action('day','2026-09-13');assert.equal(v.pickerOpens.length,1);const request=v.pickerOpens[0];assert.equal(request.date,'2026-09-13');assert.equal(request.pattern,undefined);assert.equal(request.returnFocus,v.get('bookingsList').querySelector('[data-date="2026-09-13"]'));assert.equal(request.returnFocus.focused,true);assert.match(v.get('bookingsList').innerHTML,/Sunday,? 13 September/);assert.equal(v.ctx.location.hash,'#/bookings?view=calendar');assert.ok(v.calls.every(c=>!c.opts?.method));
 v.action('book');assert.equal(v.pickerOpens.length,2);assert.equal(v.pickerOpens[1].date,'2026-09-13');
});
await test('Past dates remain viewable while today and future dates can start a booking',async()=>{
 const v=ui('participant');await v.render();v.action('day','2026-09-11');v.action('book');assert.equal(v.pickerOpens.length,0);assert.match(v.get('bookingsList').innerHTML,/Friday,? 11 September/);assert.ok(!v.get('bookingsList').innerHTML.includes('data-cal-action="book"'));v.action('day','2026-09-12');assert.equal(v.pickerOpens.length,1);assert.equal(v.pickerOpens[0].date,'2026-09-12');
});
await test('Workers, office users and helpers without booking access cannot open the date picker',async()=>{
 for(const [role,options] of [['worker',{}],['participant',{me:{id:1,role:'participant',admin:true}}],['coordinator',{actingFor:{id:18,scopes:['invoices']}}]]){const v=ui(role,options);await v.render();v.action('day','2026-09-13');v.action('book');assert.equal(v.pickerOpens.length,0);assert.ok(!v.get('bookingsList').innerHTML.includes('data-cal-action="book"'));assert.ok(!v.get('bookingsList').innerHTML.includes('Manage recurring bookings'));}
 for(const options of [{online:false},{me:{id:1,role:'coordinator'}}]){const v=ui('participant',options);await v.render();assert.equal(v.pickerOpens.length,0);assert.ok(!v.get('bookingsList').innerHTML.includes('data-cal-action="day"'));}
});
await test('An authorised helper opens the date popup in the selected participant context and scope revocation blocks further openings',async()=>{
 const v=ui('coordinator',{actingFor:{id:18,scopes:['bookings']}});await v.render();v.action('day','2026-09-13');assert.equal(v.pickerOpens.length,1);assert.equal(v.ctx.API.actingFor.id,18);assert.equal(v.pickerOpens[0].date,'2026-09-13');v.ctx.API.actingFor.scopes=['invoices'];v.action('day','2026-09-14');v.action('book');assert.equal(v.pickerOpens.length,1);
});
await test('Arrow keys move selection without launching a popup and native Enter or Space clicks launch exactly once',async()=>{
 const v=ui('participant');await v.render();const arrow=event('day','2026-09-12');arrow.key='ArrowRight';v.get('bookingsList').onkeydown(arrow);assert.equal(arrow.prevented,true);assert.equal(v.pickerOpens.length,0);assert.equal(v.get('bookingsList').querySelector('[data-date="2026-09-13"]').focused,true);
 // Real button activation supplies a click for Enter and Space; keydown must not
 // intercept it or dispatch a second popup before the browser's native click.
 for(const key of ['Enter',' ']){const activation=event('day','2026-09-13');activation.key=key;const before=v.pickerOpens.length;v.get('bookingsList').onkeydown(activation);assert.equal(activation.prevented,undefined);assert.equal(v.pickerOpens.length,before);assert.match(v.get('bookingsList').innerHTML,/<button type="button"[^>]*data-cal-action="day" data-date="2026-09-13"/);v.action('day','2026-09-13');assert.equal(v.pickerOpens.length,before+1);}
});
await test('Calendar and List are the only main views while recurring management remains reachable from the calendar',async()=>{
 const v=ui('participant');await v.render();const nav=v.get('bookingViewControls').innerHTML;assert.match(nav,/>Calendar<\/a>/);assert.match(nav,/>List<\/a>/);assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);assert.ok(!nav.includes('view=routine'));assert.ok(!nav.includes('Add regular shift'));assert.match(v.get('bookingsList').innerHTML,/href="#\/bookings\?view=routine">Manage recurring bookings/);assert.match(v.get('bookingsList').innerHTML,/Choose a date to browse carers and book a one-off or recurring shift/);
});
await test('Month/week, date picker and Today controls request the intended date range',async()=>{
 const v=ui();await v.render();v.get('bookingsList').onchange({target:{id:'bcView',value:'week'}});await flush();assert.match(v.calls.at(-1).url,/view=week.*date=2026-09-12/);v.get('bookingsList').onchange({target:{id:'bcDate',value:'2028-02-29',validity:{valid:true}}});await flush();assert.match(v.calls.at(-1).url,/date=2028-02-29/);v.action('next');await flush();assert.match(v.calls.at(-1).url,/date=2026-10-01/);v.action('today');await flush();assert.ok(!v.calls.at(-1).url.includes('date='));assert.match(v.get('bookingsList').innerHTML,/data-date="2026-09-12"/);
});
await test('Cancelled visits are optional and toggling their display is read-only',async()=>{
 const v=ui();await v.render();v.get('bookingsList').onchange({target:{id:'bcCancelled',checked:true}});assert.match(v.get('bookingsList').innerHTML,/Cancelled example/);assert.equal(v.get('bookingsList').querySelector('#bcCancelled').focused,true);assert.ok(v.calls.every(c=>!c.opts?.method));
});
await test('Badge refresh is visible-page only, throttled and updated after booking actions',async()=>{
 const v=ui();await flush();const before=v.calls.length;await v.ctx.CareBookingCalendar.refreshAlerts();assert.equal(v.calls.length,before);v.ctx.document.hidden=true;await v.ctx.CareBookingCalendar.refreshAlerts(true);assert.equal(v.calls.length,before);v.ctx.document.hidden=false;v.setCount(0);v.ctx.CareBookingCalendar.changed('/bookings/3');await flush();assert.equal(v.get('bookingNavBadge').hidden,true);assert.equal(v.intervals[0].ms,30000);
});
await test('Late badge responses cannot leak into a new account or undo a more recent count',async()=>{
 const v=ui();await flush();let done;v.respond(()=>new Promise(r=>done=r));const pending=v.ctx.CareBookingCalendar.refreshAlerts(true);v.ctx.API.me={id:99,role:'participant'};v.ctx.CareBookingCalendar.sync();done({count:9,next_date:'2030-01-01'});await pending;assert.equal(v.get('bookingNavBadge').hidden,true);
 const r=ui();await flush();let old;r.respond(()=>new Promise(resolve=>old=resolve));const older=r.ctx.CareBookingCalendar.refreshAlerts(true);r.respond(async()=>({count:0}));await r.ctx.CareBookingCalendar.refreshAlerts(true);old({count:9});await older;assert.equal(r.get('bookingNavBadge').hidden,true);
});
await test('Late calendar reads cannot overwrite another page or a different client',async()=>{
 for(const change of ['page','client']){const v=ui('participant');let done;v.respond(()=>new Promise(r=>done=r));const load=v.render();if(change==='page')v.ctx.location.hash='#/account';else v.ctx.API.actingFor={id:77};v.get('bookingsList').innerHTML='New content';done(sample());await load;assert.equal(v.get('bookingsList').innerHTML,'New content');}
});
await test('Calendar failures and timeouts offer retry; a stale timeout response cannot overwrite recovery',async()=>{
 const v=ui('participant');v.respond(async()=>{throw Error('<offline>');});await v.render();assert.match(v.get('bookingsList').innerHTML,/&lt;offline&gt;/);assert.match(v.get('bookingsList').innerHTML,/Try again/);v.respond(async()=>sample('participant'));v.action('refresh');await flush();assert.match(v.get('bookingsList').innerHTML,/booking-calendar/);
 const slow=ui('participant');let done;slow.respond(()=>new Promise(r=>done=r));const pending=slow.render();for(const t of slow.timers.values())t.fn();await pending;assert.match(slow.get('bookingsList').innerHTML,/took too long/);const before=slow.get('bookingsList').innerHTML;done(sample('participant'));await flush();assert.equal(slow.get('bookingsList').innerHTML,before);
});
await test('Calendar strings are escaped and the selected day survives opening a booking and returning',async()=>{
 const v=ui();await flush();const d=sample();d.bookings[0].other_name='<img src=x onerror=alert(1)>';v.setData(d);await v.render();assert.match(v.get('bookingsList').innerHTML,/&lt;img/);assert.ok(!v.get('bookingsList').innerHTML.includes('<img src=x'));v.action('day','2026-09-13');v.ctx.location.hash='#/bookings?view=list&booking=3';v.ctx.CareBookingCalendar.setup();v.ctx.location.hash='#/bookings?view=calendar';await v.render();assert.match(v.get('bookingsList').innerHTML,/Sunday,? 13 September/);
});
await test('Following the request notice refreshes even when it already points to the current calendar URL',async()=>{
 const v=ui();await flush();await v.render();const before=v.calls.filter(c=>c.url.startsWith('/bookings/calendar')).length;const notice=v.get('bookingRequestNotice');notice.hash=v.ctx.location.hash;let prevented=false;v.events.click({target:{closest:()=>notice},preventDefault(){prevented=true;}});await flush();assert.equal(prevented,true);assert.equal(v.calls.filter(c=>c.url.startsWith('/bookings/calendar')).length,before+1);
});
console.log('booking calendar: '+results.filter(r=>r.result==='PASS').length+'/'+results.length+' passed');if(process.env.BOOKING_CALENDAR_RESULTS_PATH)fs.writeFileSync(process.env.BOOKING_CALENDAR_RESULTS_PATH,JSON.stringify({runtime:process.version,results},null,2)+'\n');process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
