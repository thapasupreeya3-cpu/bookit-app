'use strict';
// Calendar arithmetic in UTC only operates on date labels, never shift times.
// The booking engine still validates the actual local clock (including DST).
const DAY=86400000,HORIZON_DAYS=56;
const day=value=>Date.parse(value+'T00:00:00Z');
const label=value=>new Date(value).toISOString().slice(0,10);
const step=freq=>freq==='fortnightly'?14:7;
function index(first,freq,date){return Math.round((day(date)-day(first))/(DAY*step(freq)));}
function window(first,freq,until='',today=first){
  const anchor=first>today?first:today,limit=day(anchor)+HORIZON_DAYS*DAY;
  let n=Math.max(0,Math.ceil((day(anchor)-day(first))/(DAY*step(freq))));
  const out=[];
  for(let value=day(first)+n*step(freq)*DAY;value<limit;value+=step(freq)*DAY){
    const date=label(value);if(until&&date>until)break;out.push(date);
  }
  return out;
}
module.exports={window,index,HORIZON_DAYS};
