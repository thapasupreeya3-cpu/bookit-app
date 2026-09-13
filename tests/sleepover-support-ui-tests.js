'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/assets/sleepover-support.js'),'utf8'),results=[];
function ui(){const events={};const ctx={Intl,Date,Event:class Event{constructor(type,options){this.type=type;Object.assign(this,options);}},document:{addEventListener(type,handler){events[type]=handler;}}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);return {api:ctx.CareSleepoverSupport,events};}
function booking(extra={}){return {sleepover:1,active_hours:0,sleepover_pricing:{start_at:'2026-09-12T12:00:00.000Z',end_at:'2026-09-12T20:00:00.000Z',timing_required_for_extras:true},...extra};}
function fixture(meta=booking().sleepover_pricing,active='3'){
 const selections=[],status={textContent:'',warning:false,classList:{toggle(name,on){status.warning=!!on;}}},details={open:false},rule={textContent:''},hours={value:active},dispatched=[];
 const add={disabled:false,focused:false,focus(){this.focused=true;},closest(sel){return sel==='[data-sleepover-support]'?box:sel==='[data-sleepover-add]'?this:null;}};
 const container={insertAdjacentHTML(position,html){parse(html).forEach(p=>addRow(p));},set innerHTML(html){selections.length=0;parse(html).forEach(p=>addRow(p));}};
 function parse(html){return [...html.matchAll(/<div class="sleepover-period"[^>]*>([\s\S]*?)<\/div>/g)].map(m=>Object.fromEntries(['start','end'].map(key=>{const s=m[1].match(new RegExp('<select data-sleepover-'+key+'>([\\s\\S]*?)<\\/select>'))?.[1]||'';return [key,s.match(/<option value="([^"]*)" selected>/)?.[1]||''];})));}
 function addRow(period={}){const row={start:{value:period.start||'',focus(){this.focused=true;}},end:{value:period.end||''},querySelector(sel){return sel==='[data-sleepover-start]'?this.start:this.end;},remove(){selections.splice(selections.indexOf(this),1);}};row.removeButton={disabled:false,closest(sel){return sel==='[data-sleepover-support]'?box:sel==='[data-sleepover-remove]'?this:sel==='[data-sleepover-period]'?row:null;}};selections.push(row);return row;}
 const box={dataset:{periodFrom:meta.start_at,periodTo:meta.end_at,periodTimingNeeded:String(meta.timing_required_for_extras)},matches(sel){return sel==='[data-sleepover-support]';},closest(sel){return sel==='[data-note-form]'?form:sel==='[data-sleepover-support]'?box:null;},querySelector(sel){return {'[data-sleepover-periods]':container,'[data-sleepover-period-status]':status,'[data-sleepover-times]':details,'[data-sleepover-timing-rule]':rule,'[data-sleepover-add]':add}[sel];},querySelectorAll(sel){return sel==='[data-sleepover-period]'?selections:sel==='[data-sleepover-start]'?selections.map(r=>r.start):[];},dispatchEvent(event){dispatched.push(event);}};
 const form={querySelector(sel){return sel==='[data-sleepover-support]'?box:sel==='.note-active'?hours:null;}};
 return {box,form,hours,status,details,rule,add,selections,addRow,dispatched};
}
function test(name,run){try{run();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(error){results.push({name,result:'FAIL',error:error.stack});console.error('FAIL '+name+' '+error.stack);}}
test('Only sleepover completion gets period controls; the included participant hours are distinct from worker pay',()=>{
 const {api}=ui();assert.equal(api.render({sleepover:0}),'');const html=api.render(booking());assert.match(html,/first 2 hours/);assert.match(html,/Worker pay is calculated separately/);assert.match(html,/Sydney time/);assert.match(html,/Add support period/);assert.ok(!html.includes('data-sleepover-period>'));assert.ok(!html.includes('data-sleepover-times open'));
});
test('Cross-midnight options include the right dates and never depend on the browser timezone',()=>{
 const {api}=ui(),html=api.render(booking({active_periods:[{start:'',end:''}]}));assert.match(html,/Sat,? 12 Sept? 2026,? 22:00 AEST/);assert.match(html,/Sun,? 13 Sept? 2026,? 06:00 AEST/);assert.match(html,/value="2026-09-12T12:00:00.000Z"/);assert.match(html,/value="2026-09-12T20:00:00.000Z"/);assert.equal((html.match(/>Choose time<\/option>/g)||[]).length,2);
});
test('A booking starting at 22:10 lets actual support start at 22:15 and end at 23:00',()=>{
 const {api}=ui(),meta={start_at:'2026-09-12T12:10:00Z',end_at:'2026-09-12T20:10:00Z',timing_required_for_extras:true},html=api.render(booking({sleepover_pricing:meta,active_periods:[{}]}));assert.match(html,/value="2026-09-12T12:15:00.000Z"/);assert.match(html,/value="2026-09-12T13:00:00.000Z"/);const f=fixture(meta,'0.75');f.addRow({start:'2026-09-12T12:15:00Z',end:'2026-09-12T13:00:00Z'});api.update(f.form);assert.match(f.status.textContent,/Recorded periods: 0.75 hours\. Matches/);assert.equal(f.status.warning,false);
});
test('Autumn daylight-saving repeated hours remain two distinct choices with offsets and actual durations',()=>{
 const {api}=ui(),meta={start_at:'2026-04-04T11:00:00Z',end_at:'2026-04-04T20:00:00Z',timing_required_for_extras:true},html=api.render(booking({sleepover_pricing:meta,active_periods:[{}]}));assert.match(html,/02:00 AEDT/);assert.match(html,/02:00 AEST/);assert.match(html,/value="2026-04-04T15:00:00.000Z"/);assert.match(html,/value="2026-04-04T16:00:00.000Z"/);const f=fixture(meta,'1');f.addRow({start:'2026-04-04T15:00:00Z',end:'2026-04-04T16:00:00Z'});api.update(f.form);assert.match(f.status.textContent,/Recorded periods: 1 hour\. Matches/);
});
test('Spring daylight saving skips nonexistent Sydney times instead of fabricating them',()=>{
 const {api}=ui(),html=api.render(booking({sleepover_pricing:{start_at:'2026-10-03T12:00:00Z',end_at:'2026-10-03T19:00:00Z'},active_periods:[{}]}));assert.match(html,/01:45 AEST/);assert.match(html,/03:00 AEDT/);assert.ok(!/>[^<]*04 Oct 2026[^<]*02:/.test(html));
});
test('Missing or offset-free server bounds cannot create guessed support times',()=>{
 const {api}=ui();for(const meta of [{},{start_at:'2026-09-12T22:00:00',end_at:'2026-09-13T06:00:00'},{start_at:'2026-09-12T12:00:00Z',end_at:'2026-09-14T20:00:00Z'}]){const html=api.render(booking({sleepover_pricing:meta}));assert.match(html,/Booking times could not be loaded/);assert.match(html,/data-sleepover-add disabled/);}
});
test('Times are required only when extra active support crosses rates; no intervals are invented',()=>{
 const {api}=ui(),f=fixture(undefined,'2');api.update(f.form);assert.equal(f.details.open,false);assert.equal(f.status.warning,false);f.hours.value='2.25';api.update(f.form);assert.equal(f.details.open,true);assert.match(f.status.textContent,/Add each support period/);assert.equal(api.read(f.form).length,0);const single=fixture({...booking().sleepover_pricing,timing_required_for_extras:false},'3');api.update(single.form);assert.equal(single.details.open,false);assert.equal(single.status.warning,false);
});
test('Exact recorded periods round-trip and match total hours without changing that total',()=>{
 const {api}=ui(),f=fixture();f.addRow({start:'2026-09-12T12:00:00Z',end:'2026-09-12T13:00:00Z'});f.addRow({start:'2026-09-12T16:00:00Z',end:'2026-09-12T18:00:00Z'});const saved=JSON.parse(JSON.stringify(api.read(f.form)));assert.equal(saved.length,2);api.update(f.form);assert.match(f.status.textContent,/Recorded periods: 3 hours\. Matches/);assert.equal(f.hours.value,'3');api.restore(f.form,saved);assert.equal(api.read(f.form).length,2);assert.equal(f.status.warning,false);assert.equal(f.details.open,true);
});
test('Incomplete drafts are preserved while incomplete, reversed, out-of-bounds and overlapping periods are explained',()=>{
 const {api}=ui();for(const values of [[{start:'2026-09-12T12:00:00Z',end:''}],[{start:'2026-09-12T13:00:00Z',end:'2026-09-12T12:00:00Z'}],[{start:'2026-09-12T10:00:00Z',end:'2026-09-12T13:00:00Z'}],[{start:'2026-09-12T12:00:00Z',end:'2026-09-12T14:00:00Z'},{start:'2026-09-12T13:00:00Z',end:'2026-09-12T15:00:00Z'}]]){const f=fixture();values.forEach(f.addRow);api.update(f.form);assert.equal(f.status.warning,true);assert.match(f.status.textContent,/Choose a start|overlap/);assert.equal(api.read(f.form).length,values.length);}
});
test('A duration mismatch is visible and does not overwrite the worker’s entered total',()=>{
 const {api}=ui(),f=fixture(undefined,'3.5');f.addRow({start:'2026-09-12T12:00:00Z',end:'2026-09-12T15:00:00Z'});api.update(f.form);assert.match(f.status.textContent,/Recorded periods: 3 hours/);assert.match(f.status.textContent,/3.5 hours.*totals need to match/);assert.equal(f.hours.value,'3.5');
});
test('Add and remove are keyboard-focusable draft edits and respect the 24-period limit',()=>{
 const {events,api}=ui(),f=fixture();events.click({target:f.add});assert.equal(f.selections.length,1);assert.equal(f.selections[0].start.focused,true);assert.equal(f.selections[0].start.value,'');assert.equal(f.dispatched.at(-1).type,'input');assert.equal(f.dispatched.at(-1).bubbles,true);for(let i=1;i<24;i++)events.click({target:f.add});assert.equal(f.selections.length,24);assert.equal(f.add.disabled,true);events.click({target:f.add});assert.equal(f.selections.length,24);events.click({target:f.selections[0].removeButton});assert.equal(f.selections.length,23);assert.equal(f.add.disabled,false);assert.equal(f.add.focused,true);assert.equal(api.read(f.form).length,23);
});
test('Metadata and saved values are escaped and unavailable historic times stay visible for correction',()=>{
 const {api}=ui(),html=api.render(booking({sleepover_pricing:{start_at:'" onmouseover="alert(1)',end_at:'<img src=x>'},active_periods:[{start:'<img src=x onerror=alert(1)>',end:''}]}));assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('data-period-from="" onmouseover'));assert.match(html,/&lt;img/);assert.match(html,/Previously recorded time/);
});
test('Older sleepover bookings explain the charge review without exposing internal errors or stopping work recording',()=>{
 const {api}=ui(),html=api.render(booking({sleepover_pricing:{...booking().sleepover_pricing,legacy_review_required:'Internal validation error: private provider detail'}}));assert.match(html,/This older booking needs its overnight charge checked/);assert.match(html,/Record your work as usual; the office will confirm the charge before invoicing/);assert.ok(!html.includes('private provider detail'));assert.match(html,/data-sleepover-add>Add support period/);assert.ok(!api.render(booking()).includes('This older booking'));
});
console.log(`sleepover support UI: ${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
