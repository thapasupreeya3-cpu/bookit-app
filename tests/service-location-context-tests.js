'use strict';
const assert=require('node:assert/strict'),{areaMatches}=require('../lib/worker-availability'),Assignment=require('../lib/assignment-policy'),Holidays=require('../lib/public-holidays');
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('Structured locality matches full suburb names, compatible state and postcode only',()=>{
 for(const [a,p] of [['Ryde NSW','Ryde NSW 2112'],['Ryde','Ryde NSW 2112'],['2112','Ryde NSW 2112'],['Ryde NSW 2112','Ryde NSW']])assert.equal(areaMatches(a,p),true,a+' / '+p);
 for(const [a,p] of [['Ryde NSW','North Ryde NSW 2113'],['Richmond NSW','Richmond VIC 3121'],['Ryde NSW 2112','Ryde NSW 9999'],['2112','Ryde NSW 21120']])assert.equal(areaMatches(a,p),false,a+' / '+p);
});
test('Assignment uses the saved visit destination even after the participant suburb changes',()=>{
 const b={id:4,participant_id:2,worker_id:1,service:'daily-tasks',date:'2031-02-03',start:'10:00',hours:2,kind:'intro',service_place:'Ryde NSW 2112'},p={visible:1,services:'["daily-tasks"]',days:'[1,1,1,1,1,1,1]',service_areas:'["Ryde NSW"]',suburb:'Ryde NSW'};
 const ctx={completeBooking:x=>x,profile:()=>p,platformEligible:()=>true,participantClosed:()=>false,blockedPair:()=>false,withdrawnFromOpenCover:()=>false,moduleState:()=>({lock:''}),participantPlace:(pid,visit)=>{assert.equal(pid,2);assert.equal(visit,b);return visit.service_place;},bookingClash:()=>false};
 assert.equal(Assignment.evaluate(ctx,1,b).ok,true);
 b.service_place='Parramatta NSW 2150';const outside=Assignment.evaluate(ctx,1,b);assert.equal(outside.code,'out_of_area');assert.equal(outside.confirm,true);
});
test('Holiday calculations use the per-visit locality rather than a newer profile address',()=>{
 let suburb='Ryde NSW',destination='Grafton NSW 2460';
 const data={years:{'2031':[]},local:[{date:'2031-02-03',name:'Synthetic local holiday',area:'Grafton',from:0,to:1440}]};
 const c={setting:(k,d)=>k==='automatic_holiday_cache'?JSON.stringify(data):d,setSetting(){},db:{prepare(){return {get(){return {suburb};}};}},bookingPlace:b=>b.id?destination:undefined};
 const h=Holidays(c);assert.equal(h.at('2031-02-03',720,{id:4,participant_id:2,suburb}).holiday,true);
 suburb='Parramatta NSW';assert.equal(h.at('2031-02-03',720,{id:4,participant_id:2,suburb}).holiday,true);
 destination='Ryde NSW 2112';assert.equal(h.at('2031-02-03',720,{id:4,participant_id:2}).holiday,false);
 destination='';assert.equal(h.at('2031-02-03',720,{id:4,participant_id:2,suburb:'Grafton NSW'}).holiday,false);
});
test('Structured preview locations never turn into an object-string calendar lookup',()=>{
 const h=Holidays({setting:(k,d)=>k==='billing_holiday_calendar'?JSON.stringify({jurisdiction:'VIC',dates:['2031-02-03']}):d,setSetting(){},db:{prepare(){throw Error('No participant lookup expected');}}});
 const result=h.at('2031-02-03',720,{service_location:{suburb:'Richmond',state:'VIC',postcode:'3121'}});assert.equal(result.jurisdiction,'VIC');assert.equal(result.holiday,true);
});
console.log('service location context: '+passed+'/'+passed+' passed');
