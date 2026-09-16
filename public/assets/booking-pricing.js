'use strict';
/* The quote uses the same pricing service as bookings. Client totals are display only. */
window.CareBookingPricing=(()=>{
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId=id=>document.getElementById(id);
  const money=value=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(value));
  const inputs=['bkService','bkDate','bkStart','bkHours','bkSleep','bkIntro','bkRepeat','bkRepeatMode','bkRepeatUntil'];
  const supported=()=>['personal-care','daily-tasks'].includes(byId('bkService')?.value);
  const quantity=value=>Number(Number(value).toFixed(2));
  const day=value=>new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
  let generation=0,timer=null,pending=null,last=null,skipPattern=null;
  const skipped=new Set();

  function read(){
    const intro=!!byId('bkIntro')?.checked,locationHost=byId('bookingServiceLocation');
    const place=window.CareLocations?.chooserValue(locationHost)||{mode:'unconfirmed'};
    const value={worker_id:Number(byId('bkWorkerName')?.dataset?.workerId)||null,service:byId('bkService')?.value||'',date:byId('bkDate')?.value||'',start:byId('bkStart')?.value||'',hours:Number(byId('bkHours')?.value),sleepover:!intro&&supported()&&!!byId('bkSleep')?.checked,intro,
      repeat:byId('bkRepeat')?.value||'',repeat_end_mode:byId('bkRepeatMode')?.value||'ongoing',repeat_until:byId('bkRepeatMode')?.value==='date'?(byId('bkRepeatUntil')?.value||''):'',
      subject:[window.API?.me?.id||'',window.API?.me?.role||'',window.API?.actingFor?.id||'',(window.API?.actingFor?.scopes||[]).slice().sort().join(',')].join(':'),service_location:place};
    const pattern=JSON.stringify([value.subject,value.worker_id,value.date,value.repeat,value.repeat_end_mode,value.repeat_until]);
    if(pattern!==skipPattern){skipped.clear();skipPattern=pattern;}
    return {...value,repeat_skip_dates:value.repeat?[...skipped].sort():[]};
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
    if(!['ongoing','date'].includes(value.repeat_end_mode))throw Error('Choose ongoing support or a specific end date.');
    const until=value.repeat_end_mode==='date'?value.repeat_until:'';
    if(value.repeat_end_mode==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(until)||!Number.isFinite(+new Date(until+'T12:00:00Z'))||new Date(until+'T12:00:00Z').toISOString().slice(0,10)!==until))throw Error('Choose the last date for your repeating bookings.');
    if(until&&until<value.date)throw Error('The last date must be on or after the first booking.');
    const dates=[],date=new Date(value.date+'T12:00:00Z'),horizon=new Date(+date);
    horizon.setUTCDate(horizon.getUTCDate()+56);
    while(date<horizon){const iso=date.toISOString().slice(0,10);if(until&&iso>until)break;dates.push(iso);date.setUTCDate(date.getUTCDate()+(value.repeat==='fortnightly'?14:7));}
    return dates;
  }
  function heading(value){return value.intro?'Meet-and-greet — no charge':value.sleepover?'Inactive overnight — flat per night':'Hourly support — worker awake / working';}
  function show(markup,tone='ready'){
    const host=byId('bkRateLine');if(!host)return;
    const focusDate=host.contains?.(document.activeElement)?document.activeElement?.dataset?.bpSkip:null;
    const expanded=!!host.querySelector('[data-bp-more]')?.open;
    host.classList.add('bp-quote');host.dataset.state=tone;host.setAttribute('aria-busy',tone==='loading'?'true':'false');host.innerHTML=markup;
    if(expanded&&host.querySelector('[data-bp-more]'))host.querySelector('[data-bp-more]').open=true;
    if(focusDate)host.querySelector('[data-bp-skip="'+focusDate+'"]')?.focus({preventScroll:true});
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
  function rateNote(quote){return quote.rate_note?`<p class="bp-note">${escape(quote.rate_note)}</p>`:'';}
  function quoteDetails(quote,value,date,showNote=true){return `<p class="bp-time"><b>${escape(day(date))} ${escape(value.start)} → ${escape(day(quote.end_date))} ${escape(quote.end_time)}</b><br>${quantity(quote.duration_hours??value.hours)} hours · Sydney time</p>${lineList(quote)}${showNote?rateNote(quote):''}`;}
  function activeRates(quote){return `<ul>${quote.extra_active_rates.map(rate=>`<li>${escape(rate.label||rate.description||rate.category)}: <b>${money(rate.rate)} per extra hour</b></li>`).join('')}</ul>${quote.extra_active_rates.length>1?'<p class="bp-note">The extra rate depends on when active support occurs. The worker records the active times when the night crosses different rates.</p>':''}`;}
  function summary(quote){
    if(!quote||!Array.isArray(quote.lines)||!Number.isFinite(quote.total))return '';
    const sleepover=quote.support_type==='sleepover',intro=quote.support_type==='intro';
    const extra=sleepover&&Array.isArray(quote.extra_active_rates)?`<p>Includes up to ${quantity(quote.included_active_hours)} hours of active support. Extra active support is recorded separately after the shift.</p>${activeRates(quote)}`:'';
    return `<section class="bp-booked-quote"><h4>${escape(quote.display_label||'Price shown at booking')}</h4><p><b>${intro?'Meet-and-greet — no charge':sleepover?'Inactive overnight — flat per night':'Hourly support — worker awake / working'}</b></p><p class="bp-total"><strong>${money(quote.total)}</strong> ${sleepover?'per night':'estimated support total'}</p><details><summary>View rate breakdown${sleepover?' and included support':''}</summary>${lineList(quote)}${rateNote(quote)}${extra}<p class="bp-note">Actual additional support or agreed travel is shown separately on the final invoice.</p></details></section>`;
  }
  function render(value,quotes,dates){
    if(value.intro){show('<h3>Meet-and-greet — no charge</h3><p>A 15-minute introduction. No support is provided and no participant invoice is created. Book a separate paid shift for support.</p>');return;}
    const first=quotes[0],night=value.sleepover,total=quotes.reduce((sum,quote)=>sum+Math.round(quote.total*100),0)/100;
    const extra=night?`<div class="bp-included"><b>Includes up to ${quantity(first.included_active_hours)} hours of active support</b><p>Your worker can sleep when support is not needed. Additional active support beyond the included hours is recorded after the shift and charged separately.</p>${activeRates(first)}</div>`:'<p class="bp-note">See the rate breakdown for this booking. An overnight start does not select a flat sleepover rate.</p>';
    const series=quotes.length>1?`<details class="bp-series"><summary>All ${quotes.length} bookings · ${money(total)} estimated support total</summary><p>Each date is priced separately. Weekends, public holidays and published rate changes can affect later bookings.</p>${quotes.map((quote,i)=>`<section><h4>${escape(day(dates[i]))} · ${money(quote.total)}</h4>${quoteDetails(quote,value,dates[i],i!==0)}${night?'<p>Extra active support beyond the included hours:</p>'+activeRates(quote):''}</section>`).join('')}</details>`:'';
    show(`<h3>${escape(heading(value))}</h3><p class="bp-total"><strong>${money(first.total)}</strong> ${night?'per night':'estimated support total'}${quotes.length>1?' · first booking':''}</p>${quoteDetails(first,value,dates[0])}${extra}${series}${first.rate_note?'':'<p class="bp-note">Estimate for the support selected. The final invoice uses the delivered and approved support; separately agreed travel or additional support may change the amount.</p>'}`);
  }
  function problemText(row){return typeof row.problem==='string'?row.problem:row.problem?.message||row.problem?.error||'This date cannot be requested. Choose another time or skip this date.';}
  function renderPreview(value,preview){
    const selected=preview.dates.filter(row=>row.selected),issues=selected.filter(row=>!row.available&&!row.needs_confirmation);
    const known=selected.filter(row=>row.quote),total=known.reduce((sum,row)=>sum+Math.round(row.quote.total*100),0)/100;
    const rowMarkup=row=>{
      const status=row.skipped?'Skipped':row.needs_confirmation?'Location confirmation needed':row.available?'Ready to request':'Needs attention';
      const tone=row.skipped?'skipped':row.needs_confirmation?'confirm':row.available?'ready':'conflict';
      return `<li class="bp-occurrence" data-state="${tone}"><div class="bp-occurrence-main"><label class="bp-date-choice"><input type="checkbox" data-bp-skip="${escape(row.date)}" ${row.selected?'checked':''} aria-label="Include ${escape(day(row.date))}"><span><b>${escape(day(row.date))}</b><span>${escape(value.start)}${row.quote?'–'+escape(row.quote.end_time)+(row.quote.end_date!==row.date?' · ends '+escape(day(row.quote.end_date)):''):''} · ${quantity(value.hours)} hours</span></span></label><div class="bp-occurrence-price"><strong>${row.quote?money(row.quote.total):'Price unavailable'}</strong><span class="bp-date-status">${escape(status)}</span></div></div>${row.problem&&!row.skipped?`<p class="bp-date-problem">${escape(problemText(row))}</p>`:''}${row.quote?`<details class="bp-date-details"><summary>Rate breakdown</summary>${lineList(row.quote)}${rateNote(row.quote)}${value.sleepover?`<p>Includes up to ${quantity(row.quote.included_active_hours)} hours of active support. Extra active support beyond the included hours:</p>${activeRates(row.quote)}`:''}</details>`:''}</li>`;
    };
    const first=preview.dates.slice(0,6),rest=preview.dates.slice(6);
    const complete=selected.length===known.length;
    const info=issues.length?`${issues.length} selected date${issues.length===1?' needs':'s need'} attention. Skip those dates or change the time before sending.`:selected.length<1?'Choose at least one date to send.':preview.needs_confirmation?'The location needs your confirmation before sending. Your worker still needs to accept the request.':'Your worker still needs to accept each request. Later dates are requested automatically as they approach.';
    const ends=value.repeat_end_mode==='date'?'Ends '+day(value.repeat_until):'Ongoing — repeats until cancelled';
    const windowEnd=preview.generated_through||preview.dates.at(-1)?.date;
    const windowLabel=windowEnd?'Dates shown: '+day(value.date)+' – '+day(windowEnd):'Dates shown below';
    show(`<h3>Your recurring bookings</h3><p><b>${escape(ends)}</b></p><p class="bp-note">${escape(windowLabel)}. ${value.repeat_end_mode==='date'?'Repeats automatically until your chosen end date.':'Repeats indefinitely until cancelled — there is no shift limit.'} Only the upcoming dates are shown and priced here; new requests are added automatically as they approach. Later dates need worker acceptance.</p><p>${escape(heading(value))}</p><p class="bp-total"><strong>${complete?money(total):'Total not yet available'}</strong> ${complete?'estimated support total for the selected dates shown':''}</p><p><b>${selected.length} selected</b> · ${preview.dates.length-selected.length} skipped</p><p class="bp-repeat-status" role="status">${escape(info)}</p><p class="bp-note">Untick a date to skip it. Each date is priced separately. The total covers only the dates shown here. Prices for later dates may change with weekends, public holidays or published rates.</p><ul class="bp-occurrences">${first.map(rowMarkup).join('')}</ul>${rest.length?`<details class="bp-more" data-bp-more><summary>Show ${rest.length} more dates</summary><ul class="bp-occurrences">${rest.map(rowMarkup).join('')}</ul></details>`:''}<p class="bp-note">${value.sleepover?'Each sleepover has a flat nightly price. Actual extra active support is recorded separately.':'The final invoice uses the delivered and approved support; separately agreed travel or additional support may change the amount.'}</p>`,issues.length||selected.length<1?'attention':'ready');
  }
  async function fetchPreview(value,dates){
    if(!value.worker_id)throw Error('Choose a worker before checking recurring bookings.');
    const body={worker_id:value.worker_id,date:value.date,start:value.start,hours:value.hours,service:value.service,sleepover:value.sleepover,intro:value.intro,service_location:value.service_location,repeat:value.repeat,repeat_skip_dates:value.repeat_skip_dates};
    body.repeat_end_mode=value.repeat_end_mode;
    if(value.repeat_end_mode==='date')body.repeat_until=value.repeat_until;
    const preview=await API.call('/bookings/preview',{method:'POST',body});
    if(!preview||preview.ok!==true||!Array.isArray(preview.dates)||preview.dates.length!==dates.length||preview.dates.some((row,i)=>row.date!==dates[i]||row.selected===row.skipped||typeof row.selected!=='boolean'||typeof row.skipped!=='boolean'))throw Error('The recurring dates could not be confirmed. Refresh the booking price.');
    for(const row of preview.dates){
      if(row.selected!==!value.repeat_skip_dates.includes(row.date))throw Error('The selected dates changed. Refresh the booking price.');
      if(row.quote)validateQuote(row.quote,value);
      if(row.selected&&(row.available||row.needs_confirmation)&&!row.quote)throw Error('A selected date is missing its price. Refresh the booking price.');
    }
    return preview;
  }
  function renderRecord(record){if(record.preview)renderPreview(record.value,record.preview);else render(record.value,record.quotes,record.dates);}
  function checkReady(record){
    if(!record.preview)return;
    const selected=record.preview.dates.filter(row=>row.selected),blocked=selected.filter(row=>!row.available&&!row.needs_confirmation);
    if(selected.length<1)throw Error('Choose at least one date to send.');
    if(blocked.length)throw Error('Some selected dates need attention. Review the dates above, skip them or change the time.');
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
  function quoteSignature(record){return JSON.stringify({dates:record.dates,availability:record.preview?.dates.map(row=>({date:row.date,selected:row.selected,available:row.available,needs_confirmation:row.needs_confirmation,problem:row.problem})),quotes:record.quotes.map(quote=>({lines:quote.lines,total:quote.total,support_type:quote.support_type,end_date:quote.end_date,end_time:quote.end_time,included_active_hours:quote.included_active_hours,extra_active_rates:quote.extra_active_rates,pricing_policy:quote.pricing_policy,rate_note:quote.rate_note}))});}
  function refresh(force=false){
    if(timer!==null){clearTimeout(timer);timer=null;}
    const value=read(),fingerprint=key(value);let dates;
    try{dates=datesFor(value);if(!value.service)throw Error('Choose a support type to see your booking price.');}
    catch(error){generation++;pending=null;last=null;notice(value,error.message);return Promise.resolve(null);}
    if(!force&&last?.key===fingerprint&&Date.now()-last.at<60000){renderRecord(last);return Promise.resolve(last);}
    if(!force&&pending?.key===fingerprint)return pending.promise;
    const ticket=++generation,isCurrent=()=>ticket===generation&&fingerprint===key(read());
    const preserveChoices=last?.preview&&last.value.subject===value.subject&&last.value.worker_id===value.worker_id&&last.value.date===value.date;
    last=null;if(preserveChoices){const host=byId('bkRateLine');host.dataset.state='loading';host.setAttribute('aria-busy','true');const status=host.querySelector('.bp-repeat-status');if(status)status.textContent='Checking selected dates…';}else notice(value,value.intro?'Preparing your introduction…':`Checking ${dates.length>1?'all '+dates.length+' booking dates':'your selected dates and times'}…`,'loading');
    const job={key:fingerprint,promise:null};pending=job;
    job.promise=(async()=>{try{
      const preview=value.repeat?await fetchPreview(value,dates):null;
      const selected=preview?preview.dates.filter(row=>row.selected):null;
      const quotes=preview?selected.filter(row=>row.quote).map(row=>row.quote):value.intro?[]:await fetchQuotes(value,dates,isCurrent);if(!isCurrent())return null;
      const record={key:fingerprint,at:Date.now(),value,dates:preview?selected.map(row=>row.date):dates,quotes,preview};last=record;renderRecord(record);return record;
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
    if(previous&&Date.now()-previous.at<60000){checkReady(previous);return true;}
    const record=await refresh();
    if(fingerprint!==key(read()))throw Error('The booking details changed while the price was being checked. Review the updated price and send again.');
    if(!record)throw Error('Check the booking price above before sending your request.');
    checkReady(record);
    if(!previous||quoteSignature(previous)!==quoteSignature(record))throw Error('Your booking price is now displayed above. Review it, then send your booking request again.');
    return true;
  }
  function quoteKeys(){
    const value=read();if(value.intro)return [];
    if(!last||last.key!==key(value)||Date.now()-last.at>=60000||last.quotes.length!==last.dates.length||!last.quotes.length||last.quotes.some(quote=>!validQuoteKey(quote.quote_key)))throw Error('The booking details or price have changed. Refresh the booking price, review it, then send again.');
    checkReady(last);return last.quotes.map(quote=>quote.quote_key);
  }
  function requestExtras(){const value=read();if(value.repeat){if(!last||last.key!==key(value))throw Error('Review the recurring dates before sending.');checkReady(last);}return {repeat_skip_dates:value.repeat_skip_dates.slice()};}
  function resetRepeats(){skipped.clear();skipPattern=null;generation++;pending=null;last=null;if(timer!==null){clearTimeout(timer);timer=null;}}
  function sync(){const value=read();if((last&&last.key!==key(value))||(pending&&pending.key!==key(value))){resetRepeats();notice(value,'Review your booking details to check the price.');}}
  function mount(){
    byId('bkRateLine')?.addEventListener('change',event=>{
      const date=event.target?.dataset?.bpSkip;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return;
      const value=read();let dates;try{dates=datesFor(value);}catch{return;}if(!value.repeat||!dates.includes(date))return;
      if(!event.target.checked&&!skipped.has(date)&&skipped.size>=dates.length-1){event.target.checked=true;const status=byId('bkRateLine').querySelector('.bp-repeat-status');if(status)status.textContent='Keep at least one date selected, or close this request.';return;}
      if(event.target.checked)skipped.delete(date);else skipped.add(date);refresh(true);
    });
    for(const id of inputs){const input=byId(id);if(!input)continue;input.addEventListener('change',event=>{syncType(event);refresh();});if(['bkDate','bkStart','bkRepeatUntil'].includes(id))input.addEventListener('input',schedule);}
    const location=byId('bookingServiceLocation');location?.addEventListener('input',schedule);location?.addEventListener('change',schedule);
    syncType();
  }
  window.syncBkRateLine=()=>{syncType();return refresh();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return {refresh,ensureCurrent,quoteKeys,requestExtras,resetRepeats,sync,datesFor,summary};
})();
