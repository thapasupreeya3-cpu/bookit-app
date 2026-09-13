'use strict';
/* The quote uses the same pricing service as bookings. Client totals are display only. */
window.CareBookingPricing=(()=>{
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId=id=>document.getElementById(id);
  const money=value=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(value));
  const inputs=['bkService','bkDate','bkStart','bkHours','bkSleep','bkIntro','bkRepeat','bkRepeatMode','bkRepeatCount','bkRepeatUntil'];
  const supported=()=>['personal-care','daily-tasks'].includes(byId('bkService')?.value);
  const quantity=value=>Number(Number(value).toFixed(2));
  const day=value=>new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
  let generation=0,timer=null,pending=null,last=null;

  function read(){
    const intro=!!byId('bkIntro')?.checked,locationHost=byId('bookingServiceLocation');
    const place=window.CareLocations?.chooserValue(locationHost)||{mode:'unconfirmed'};
    return {service:byId('bkService')?.value||'',date:byId('bkDate')?.value||'',start:byId('bkStart')?.value||'',hours:Number(byId('bkHours')?.value),sleepover:!intro&&supported()&&!!byId('bkSleep')?.checked,intro,
      repeat:byId('bkRepeat')?.value||'',repeat_mode:byId('bkRepeatMode')?.value||'count',repeat_count:Number(byId('bkRepeatCount')?.value),repeat_until:byId('bkRepeatUntil')?.value||'',
      subject:String(window.API?.me?.id||'')+':'+String(window.API?.actingFor?.id||''),service_location:place};
  }
  const key=value=>JSON.stringify(value);
  const validQuoteKey=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{32,256}$/.test(value);
  function datesFor(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||!Number.isFinite(+new Date(value.date+'T00:00:00Z'))||new Date(value.date+'T00:00:00Z').toISOString().slice(0,10)!==value.date)throw Error('Choose a date to see your booking price.');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start))throw Error('Choose a start time to see your booking price.');
    if(value.intro&&value.repeat)throw Error('A meet-and-greet happens once. Choose a one-off booking.');
    if(!value.intro&&(!Number.isFinite(value.hours)||value.hours<2||value.hours>10))throw Error('Choose between 2 and 10 hours.');
    if(!value.repeat)return [value.date];
    if(!['weekly','fortnightly'].includes(value.repeat))throw Error('Choose weekly or fortnightly repeats.');
    const until=value.repeat_mode==='until'?value.repeat_until:'';
    if(value.repeat_mode==='until'&&!/^\d{4}-\d{2}-\d{2}$/.test(until))throw Error('Choose the last date for your repeating bookings.');
    if(until&&until<value.date)throw Error('The last date must be on or after the first booking.');
    const max=until?26:value.repeat_count;
    if(!Number.isInteger(max)||max<2||max>26)throw Error('Choose between 2 and 26 repeating bookings.');
    const dates=[],date=new Date(value.date+'T12:00:00Z');
    while(dates.length<max){const iso=date.toISOString().slice(0,10);if(until&&iso>until)break;dates.push(iso);date.setUTCDate(date.getUTCDate()+(value.repeat==='fortnightly'?14:7));}
    return dates;
  }
  function heading(value){return value.intro?'Meet-and-greet — no charge':value.sleepover?'Inactive overnight — flat per night':'Hourly support — worker awake / working';}
  function show(markup,tone='ready'){
    const host=byId('bkRateLine');if(!host)return;
    host.classList.add('bp-quote');host.dataset.state=tone;host.setAttribute('aria-busy',tone==='loading'?'true':'false');host.innerHTML=markup;
    host.querySelector('[data-bp-retry]')?.addEventListener('click',()=>refresh(true));
  }
  function notice(value,message,tone='waiting',retry=false){show(`<h3>${escape(heading(value))}</h3><p>${escape(message)}</p>${retry?'<button type="button" class="btn btn-secondary btn-sm" data-bp-retry>Refresh booking price</button>':''}`,tone);}
  function validateQuote(quote,value){
    if(!quote||!Array.isArray(quote.lines)||!quote.lines.length||!Number.isFinite(quote.total)||quote.total<=0)throw Error('The booking price is unavailable. Refresh the price before sending your request.');
    for(const line of quote.lines)if(!Number.isFinite(line.rate)||!Number.isFinite(line.amount)||!Number.isFinite(line.qty)||line.rate<=0||line.qty<=0||line.amount<=0)throw Error('The booking price is incomplete. Refresh the price before sending your request.');
    if(quote.support_type!==(value.sleepover?'sleepover':'hourly'))throw Error('The price does not match the selected support type. Refresh the booking price.');
    if(value.sleepover&&(!Number.isFinite(quote.included_active_hours)||!Array.isArray(quote.extra_active_rates)||!quote.extra_active_rates.length||quote.extra_active_rates.some(rate=>!Number.isFinite(rate.rate)||rate.rate<=0)))throw Error('The sleepover price is missing its active-support rates. Refresh the booking price.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(quote.end_date||'')||!/^\d{2}:\d{2}$/.test(quote.end_time||''))throw Error('The booking end time could not be confirmed. Refresh the booking price.');
    if(!validQuoteKey(quote.quote_key))throw Error('The booking price could not be confirmed for this request. Refresh the booking price.');
    return quote;
  }
  function lineList(quote){return `<ul class="bp-lines">${quote.lines.map(line=>`<li><div><b>${escape(line.description||line.category)}</b><span>${escape(day(line.date))} · ${escape(line.when||'')}</span><span>${quantity(line.qty)} ${line.unit==='night'?'night':'hours'} × ${money(line.rate)}${line.unit==='night'?' per night':' per hour'}</span></div><strong>${money(line.amount)}</strong></li>`).join('')}</ul>`;}
  function quoteDetails(quote,value,date){return `<p class="bp-time"><b>${escape(day(date))} ${escape(value.start)} → ${escape(day(quote.end_date))} ${escape(quote.end_time)}</b><br>${quantity(quote.duration_hours??value.hours)} hours · Sydney time</p>${lineList(quote)}`;}
  function activeRates(quote){return `<ul>${quote.extra_active_rates.map(rate=>`<li>${escape(rate.label||rate.description||rate.category)}: <b>${money(rate.rate)} per extra hour</b></li>`).join('')}</ul>${quote.extra_active_rates.length>1?'<p class="bp-note">The extra rate depends on when active support occurs. The worker records the active times when the night crosses different rates.</p>':''}`;}
  function summary(quote){
    if(!quote||!Array.isArray(quote.lines)||!Number.isFinite(quote.total))return '';
    const sleepover=quote.support_type==='sleepover',intro=quote.support_type==='intro';
    const extra=sleepover&&Array.isArray(quote.extra_active_rates)?`<p>Includes up to ${quantity(quote.included_active_hours)} hours of active support. Extra active support is recorded separately after the shift.</p>${activeRates(quote)}`:'';
    return `<section class="bp-booked-quote"><h4>${escape(quote.display_label||'Price shown at booking')}</h4><p><b>${intro?'Meet-and-greet — no charge':sleepover?'Inactive overnight — flat per night':'Hourly support — worker awake / working'}</b></p><p class="bp-total"><strong>${money(quote.total)}</strong> ${sleepover?'per night':'estimated support total'}</p><details><summary>View rate breakdown${sleepover?' and included support':''}</summary>${lineList(quote)}${extra}<p class="bp-note">Actual additional support or agreed travel is shown separately on the final invoice.</p></details></section>`;
  }
  function render(value,quotes,dates){
    if(value.intro){show('<h3>Meet-and-greet — no charge</h3><p>A 15-minute introduction. No support is provided and no participant invoice is created. Book a separate paid shift for support.</p>');return;}
    const first=quotes[0],night=value.sleepover,total=quotes.reduce((sum,quote)=>sum+Math.round(quote.total*100),0)/100;
    const extra=night?`<div class="bp-included"><b>Includes up to ${quantity(first.included_active_hours)} hours of active support</b><p>Your worker can sleep when support is not needed. Additional active support beyond the included hours is recorded after the shift and charged separately.</p>${activeRates(first)}</div>`:'<p class="bp-note">Hourly rates follow the dates and times shown. An overnight start does not select a flat sleepover rate.</p>';
    const series=quotes.length>1?`<details class="bp-series"><summary>All ${quotes.length} bookings · ${money(total)} estimated support total</summary><p>Each date is priced separately. Weekends, public holidays and published rate changes can affect later bookings.</p>${quotes.map((quote,i)=>`<section><h4>${escape(day(dates[i]))} · ${money(quote.total)}</h4>${quoteDetails(quote,value,dates[i])}${night?'<p>Extra active support beyond the included hours:</p>'+activeRates(quote):''}</section>`).join('')}</details>`:'';
    show(`<h3>${escape(heading(value))}</h3><p class="bp-total"><strong>${money(first.total)}</strong> ${night?'per night':'estimated support total'}${quotes.length>1?' · first booking':''}</p>${quoteDetails(first,value,dates[0])}${extra}${series}<p class="bp-note">${escape(first.rate_note||'Estimate for the support selected. The final invoice uses the delivered and approved support; separately agreed travel or additional support may change the amount.')}</p>`);
  }
  async function fetchQuotes(value,dates,isCurrent){
    const output=new Array(dates.length);let cursor=0;
    async function next(){while(cursor<dates.length){if(!isCurrent())return;const index=cursor++,date=dates[index];
      const body={date,start:value.start,hours:value.hours,service:value.service,sleepover:value.sleepover,service_location:value.service_location};
      const quote=await API.call('/pricing/quote',{method:'POST',body});
      if(!isCurrent())return;output[index]=validateQuote(quote,value);
    }}
    await Promise.all(Array.from({length:Math.min(4,dates.length)},next));return output;
  }
  function quoteSignature(record){return JSON.stringify(record.quotes.map(quote=>({lines:quote.lines,total:quote.total,support_type:quote.support_type,end_date:quote.end_date,end_time:quote.end_time,included_active_hours:quote.included_active_hours,extra_active_rates:quote.extra_active_rates})));}
  function refresh(force=false){
    if(timer!==null){clearTimeout(timer);timer=null;}
    const value=read(),fingerprint=key(value);let dates;
    try{dates=datesFor(value);if(!value.service)throw Error('Choose a support type to see your booking price.');}
    catch(error){generation++;pending=null;last=null;notice(value,error.message);return Promise.resolve(null);}
    if(!force&&last?.key===fingerprint&&Date.now()-last.at<60000){render(value,last.quotes,last.dates);return Promise.resolve(last);}
    if(!force&&pending?.key===fingerprint)return pending.promise;
    const ticket=++generation,isCurrent=()=>ticket===generation&&fingerprint===key(read());
    last=null;notice(value,value.intro?'Preparing your introduction…':`Checking ${dates.length>1?'all '+dates.length+' booking dates':'your selected dates and times'}…`,'loading');
    const job={key:fingerprint,promise:null};pending=job;
    job.promise=(async()=>{try{
      const quotes=value.intro?[]:await fetchQuotes(value,dates,isCurrent);if(!isCurrent())return null;
      const record={key:fingerprint,at:Date.now(),value,dates,quotes};last=record;render(value,quotes,dates);return record;
    }catch(error){if(isCurrent()){last=null;notice(value,error.message||'The booking price could not be loaded. Please try again.','error',true);}return null;}
    finally{if(pending===job)pending=null;}})();return job.promise;
  }
  function schedule(){
    generation++;pending=null;last=null;if(timer!==null)clearTimeout(timer);
    notice(read(),'Updating the booking price…','loading');timer=setTimeout(()=>{timer=null;refresh();},200);
  }
  function syncType(event){
    const sleep=byId('bkSleep'),intro=byId('bkIntro');
    if(sleep){sleep.disabled=!!intro?.checked||!supported();if(sleep.disabled)sleep.checked=false;}
    if(event?.target===sleep&&sleep.checked){byId('bkHours').value='8';const time=byId('bkStart').value;if(!time||time<='16:00')byId('bkStart').value='22:00';}
  }
  async function ensureCurrent(){
    const fingerprint=key(read()),previous=last?.key===fingerprint?last:null;
    if(previous&&Date.now()-previous.at<60000)return true;
    const record=await refresh();
    if(fingerprint!==key(read()))throw Error('The booking details changed while the price was being checked. Review the updated price and send again.');
    if(!record)throw Error('Check the booking price above before sending your request.');
    if(!previous||quoteSignature(previous)!==quoteSignature(record))throw Error('Your booking price is now displayed above. Review it, then send your booking request again.');
    return true;
  }
  function quoteKeys(){
    const value=read();if(value.intro)return [];
    if(!last||last.key!==key(value)||Date.now()-last.at>=60000||last.quotes.length!==last.dates.length||!last.quotes.length||last.quotes.some(quote=>!validQuoteKey(quote.quote_key)))throw Error('The booking details or price have changed. Refresh the booking price, review it, then send again.');
    return last.quotes.map(quote=>quote.quote_key);
  }
  function mount(){
    for(const id of inputs){const input=byId(id);if(!input)continue;input.addEventListener('change',event=>{syncType(event);refresh();});if(['bkDate','bkStart','bkRepeatUntil'].includes(id))input.addEventListener('input',schedule);}
    const location=byId('bookingServiceLocation');location?.addEventListener('input',schedule);location?.addEventListener('change',schedule);
    syncType();
  }
  window.syncBkRateLine=()=>{syncType();return refresh();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return {refresh,ensureCurrent,quoteKeys,datesFor,summary};
})();
