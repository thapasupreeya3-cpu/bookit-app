'use strict';
// Compatibility for existing audit records. Finance sign-off is not an invoice gate.
const crypto=require('node:crypto'),T=require('./booking-time');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const NSW={jurisdiction:'NSW',from:'2026-01-01',to:'2027-12-31',dates:[
 '2026-01-01','2026-01-26','2026-04-03','2026-04-04','2026-04-05','2026-04-06','2026-04-25','2026-04-27','2026-06-08','2026-10-05','2026-12-25','2026-12-26','2026-12-28',
 '2027-01-01','2027-01-26','2027-03-26','2027-03-27','2027-03-28','2027-03-29','2027-04-25','2027-04-26','2027-06-14','2027-10-04','2027-12-25','2027-12-26','2027-12-27','2027-12-28']};
const PRICE_HOLD='Complete billing setup: confirm current prices and service agreements.';
const CALENDAR_HOLD='Complete billing setup: holiday coverage is missing for this service date.';
module.exports=function(c,{latest,approved,activeStaff}){
 const {db,setting,setSetting}=c;
 const parse=(s,fallback={})=>{try{return JSON.parse(s)||fallback;}catch{return fallback;}};
 const calendar=()=>parse(setting('billing_holiday_calendar','{}'));
 const rates=()=>Object.entries(c.invoiceRates).map(([key,r])=>({key,label:r.label,price:r.price,unit:r.perNight?'night':'hour'}));
 const fingerprint=()=>digest([calendar(),setting('billing_jurisdiction','NSW'),setting('billing_rule_version',''),rates()]);
 const token=()=>digest([fingerprint(),latest('A09')||null,setting('billing_setup_approval','')]);
 function approval(){const r=approved('A09'),binding=parse(setting('billing_setup_approval','{}'));return r&&activeStaff(r.reviewer_id)&&(!(binding.review_id===r.id)||binding.fingerprint===fingerprint())?r:null;}
 function covers(date){const h=calendar();return T.validDate(h.from)&&T.validDate(h.to)&&h.from<=date&&date<=h.to&&h.jurisdiction===setting('billing_jurisdiction','NSW')&&Array.isArray(h.dates)&&h.dates.every(d=>T.validDate(d)&&d>=h.from&&d<=h.to);}
 const flags=()=>[];
 function state(){const h=calendar(),a=approval(),today=c.ymd(),due=new Date(Date.now()+90*864e5);return {context_token:token(),ready:true,automatic:true,automation:c.holidays.status(),approved_by:a?.reviewer_id||null,reviewed_at:a?.reviewed_at||null,review_due:a?.review_due||null,issues:[],calendar:h,proposal:h.from?h:(setting('billing_jurisdiction','NSW')==='NSW'?NSW:{jurisdiction:setting('billing_jurisdiction','NSW'),from:today,to:today,dates:[]}),nsw_preset:NSW,version:setting('billing_rule_version','')||'NDIS 2026–27 v1.2 (22 July 2026)',suggested_review_due:c.ymd(due),rates:rates(),today,sources:{holidays:'https://www.nsw.gov.au/about-nsw/public-holidays',prices:'https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements'}};}
 function save(b,u){
  if(b.context_token!==token())throw Error('Billing setup changed in another session. Reload this page before saving.');
  const h=b.calendar,ref=String(b.reference||'').trim(),version=String(b.version||'').trim();
  if(b.confirm!==true||ref.length<10||ref.length>1500||version.length<5||version.length>100||!T.validDate(b.review_due)||b.review_due<c.ymd())throw Error('Confirm the actual price, agreement and holiday review, enter its reference, and choose a future review date.');
  if(!h||!['NSW','VIC','QLD','ACT','SA','WA','TAS','NT'].includes(h.jurisdiction)||!T.validDate(h.from)||!T.validDate(h.to)||h.from>h.to||!Array.isArray(h.dates)||h.dates.length>1000||h.dates.some(d=>!T.validDate(d)||d<h.from||d>h.to))throw Error('Choose the service jurisdiction and coverage dates. Each holiday must be a valid date inside that period.');
  const normal={jurisdiction:h.jurisdiction,from:h.from,to:h.to,dates:[...new Set(h.dates)].sort()};
  db.exec('BEGIN IMMEDIATE');
  try{
   setSetting('billing_holiday_calendar',JSON.stringify(normal));setSetting('billing_jurisdiction',normal.jurisdiction);setSetting('billing_rule_version',version);
   const evidence=JSON.stringify({reference:ref,confirmation:'Operator confirmed current prices, applicable time bands, service agreements and service-area holidays.',calendar:normal,version,rates:rates()});
   const id=Number(db.prepare('INSERT INTO assurance_reviews(finding_id,owner_id,decision,evidence,reviewer_id,reviewed_at,review_due) VALUES(?,?,?,?,?,?,?)').run('A09',u.id,'approved',evidence,u.id,c.now(),b.review_due).lastInsertRowid);
   setSetting('billing_setup_approval',JSON.stringify({review_id:id,fingerprint:fingerprint()}));db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return state();
 }
 return {state,save,flags,calendar,covers,approval,fingerprint,isSetupFlag:x=>[PRICE_HOLD,CALENDAR_HOLD].includes(x)};
};
