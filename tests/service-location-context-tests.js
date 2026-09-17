'use strict';
const assert=require('node:assert/strict'),{areaMatches}=require('../lib/worker-availability'),Assignment=require('../lib/assignment-policy'),Holidays=require('../lib/public-holidays');
const Ranking=require('../lib/carer-location-ranking');
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('Structured locality matches full suburb names, compatible state and postcode only',()=>{
 for(const [a,p] of [['Ryde NSW','Ryde NSW 2112'],['Ryde','Ryde NSW 2112'],['2112','Ryde NSW 2112'],['Ryde NSW 2112','Ryde NSW'],['Liverpool NSW 2170','2170'],['2170','Liverpool NSW 2170'],['2170','2170'],['Liverpool, NSW 2170','2170'],['2170','Liverpool 2170 NSW'],['Liverpool 2170 NSW','2170']])assert.equal(areaMatches(a,p),true,a+' / '+p);
 for(const [a,p] of [['Ryde NSW','North Ryde NSW 2113'],['Richmond NSW','Richmond VIC 3121'],['Ryde NSW 2112','Ryde NSW 9999'],['2112','Ryde NSW 21120'],['Liverpool NSW 2171','2170'],['Liverpool NSW','2170'],['Liverpool NSW 2170','217'],['Liverpool NSW 21700','2170'],['Liverpool NSW 2170','Other Suburb NSW 2170'],['Liverpool VIC 2170','Liverpool NSW 2170']])assert.equal(areaMatches(a,p),false,a+' / '+p);
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
test('Exact profile area ranks first without implying declared service-area consent',()=>{
 const profile={suburb:'Liverpool NSW 2170',service_areas:['Ryde NSW']},before=JSON.stringify(profile);
 const result=Ranking.rank(profile,'2170');assert.equal(result.location_rank,0);assert.equal(result.location_match,true);assert.equal(result.service_area_match,false);assert.equal(JSON.stringify(profile),before);
 const declared=Ranking.rank({suburb:'Melbourne VIC',service_areas:'["2170"]'},'2170');assert.equal(declared.location_rank,0);assert.equal(declared.service_area_match,true);
});
test('Known nearby areas sort by geographic distance while distant and unknown areas remain',()=>{
 const areas=['Melbourne VIC','Unknown synthetic area','Ryde NSW','Casula NSW','Liverpool NSW 2170'];
 const ranked=areas.map(suburb=>({suburb,...Ranking.rank({suburb},'2170')})).sort(Ranking.compare);
 assert.equal(ranked.length,areas.length);assert.equal(ranked[0].suburb,'Liverpool NSW 2170');assert.equal(ranked[1].suburb,'Casula NSW');assert.equal(ranked[2].suburb,'Ryde NSW');assert.equal(ranked[3].suburb,'Melbourne VIC');assert.equal(ranked[4].suburb,'Unknown synthetic area');
 assert.ok(ranked[1].distance_km<ranked[2].distance_km);assert.ok(ranked[2].distance_km<ranked[3].distance_km);assert.equal(ranked[4].distance_km,null);
});
test('Suburb-only names can rank by known geography without guessing postcode membership',()=>{
 const full=Ranking.rank({suburb:'Ryde NSW'},'Liverpool NSW'),short=Ranking.rank({suburb:'Ryde NSW'},'Liverpool');
 assert.equal(full.location_rank,1);assert.deepEqual(short,full);
 const near=Ranking.rank({suburb:'Liverpool NSW'},'2170');assert.equal(near.location_rank,1);assert.equal(near.location_match,false);assert.ok(near.distance_km<5);
});
test('Ambiguous and unrecognised places retain unknown distance instead of assuming a state',()=>{
 for(const place of ['Richmond','Unknown synthetic location','']){
  const result=Ranking.rank({suburb:'Ryde NSW'},place);assert.equal(result.location_rank,2);assert.equal(result.distance_km,null);
 }
 assert.equal(Ranking.rank({suburb:'Ryde NSW'},'Richmond NSW').location_rank,1);
});
test('Nearest declared service area contributes to approximate distance',()=>{
 const home=Ranking.rank({suburb:'Melbourne VIC'},'2170'),areas=Ranking.rank({suburb:'Melbourne VIC',service_areas:['Casula NSW']},'2170');
 assert.equal(areas.location_rank,1);assert.ok(areas.distance_km<home.distance_km);assert.equal(areas.service_area_match,false);
});
test('Ranking ties leave recent-carer ordering to the caller and never manufacture a distance',()=>{
 assert.equal(Ranking.compare({location_rank:0,distance_km:0},{location_rank:0,distance_km:2}),0);
 assert.equal(Ranking.compare({location_rank:2,distance_km:null},{location_rank:2,distance_km:null}),0);
 assert.equal(Ranking.rank({suburb:'Unknown synthetic',service_areas:'invalid json'},'2170').distance_km,null);
});
console.log('service location context: '+passed+'/'+passed+' passed');
