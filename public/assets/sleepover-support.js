/* Record actual sleepover support periods using the booking's server-supplied instants. */
'use strict';
window.CareSleepoverSupport = (() => {
  const STEP=60*1000,MAX_ROWS=24,ZONE='Australia/Sydney';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const instant=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
  const hoursText=value=>`${Number(value.toFixed(2))} ${value===1?'hour':'hours'}`;
  function choices(start,end){
    const from=instant(start),to=instant(end);
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>24*36e5)return [];
    const format=new Intl.DateTimeFormat('en-AU',{timeZone:ZONE,weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'});
    const points=[];
    for(let at=from;at<to;at+=STEP)points.push({value:new Date(at).toISOString(),label:format.format(new Date(at))});
    points.push({value:new Date(to).toISOString(),label:format.format(new Date(to))});
    return points;
  }
  function options(points,value=''){
    const raw=typeof value==='string'?value.slice(0,100):'',at=instant(raw);
    const selected=Number.isFinite(at)?new Date(at).toISOString():raw;
    const missing=selected&&!points.some(p=>p.value===selected);
    return `<option value="">Choose time</option>${missing?`<option value="${esc(selected)}" selected>Previously recorded time — check this period</option>`:''}${points.map(p=>`<option value="${esc(p.value)}"${p.value===selected?' selected':''}>${esc(p.label)}</option>`).join('')}`;
  }
  function row(points,period={}){
    return `<div class="sleepover-period" data-sleepover-period><label>Support started<select data-sleepover-start>${options(points,period.start)}</select></label><label>Support ended<select data-sleepover-end>${options(points,period.end)}</select></label><button type="button" class="btn btn-secondary btn-sm" data-sleepover-remove aria-label="Remove this support period">Remove</button></div>`;
  }
  function periods(value){
    if(typeof value==='string'){try{value=JSON.parse(value);}catch{return [];}}
    return Array.isArray(value)?value.filter(p=>p&&typeof p==='object').slice(0,MAX_ROWS):[];
  }
  function render(booking){
    if(!booking?.sleepover)return '';
    const meta=booking.sleepover_pricing||{},points=choices(meta.start_at,meta.end_at),saved=periods(booking.active_periods);
    const needed=meta.timing_required_for_extras===true,required=needed&&Number(booking.active_hours)>2;
    const legacyNotice=meta.legacy_review_required?'<p class="sleepover-support-warning">This older booking needs its overnight charge checked. Record your work as usual; the office will confirm the charge before invoicing.</p>':'';
    return `<fieldset class="sleepover-support" data-sleepover-support data-period-from="${esc(meta.start_at||'')}" data-period-to="${esc(meta.end_at||'')}" data-period-timing-needed="${needed?'true':'false'}"><legend>When were you providing support?</legend>${legacyNotice}<p class="sleepover-support-intro">Record each period of active support during this sleepover. Use the total active hours field for the overall duration.</p><p class="sleepover-support-rule" data-sleepover-timing-rule>${needed?'If active support exceeds 2 hours, record all support periods so additional charges use the correct day or public holiday rate.':'You can record support periods to explain the active hours you entered.'}</p><details data-sleepover-times${required||saved.length?' open':''}><summary>${needed?'Record support times':'Record support times (optional)'}</summary><p>All times are Sydney time (AEST or AEDT). Each choice includes its date, so times after midnight are clear.</p>${points.length?'':'<p class="sleepover-support-warning">Booking times could not be loaded. Refresh this booking to load its time choices.</p>'}<div data-sleepover-periods>${saved.map(p=>row(points,p)).join('')}</div><button type="button" class="btn btn-secondary btn-sm" data-sleepover-add${!points.length||saved.length>=MAX_ROWS?' disabled':''}>Add support period</button><p class="sleepover-support-status" data-sleepover-period-status role="status" aria-live="polite">${required&&!saved.length?'Support times are needed for the additional charges.':saved.length?'Check the recorded periods against your total active hours.':'No support periods recorded.'}</p></details><p class="sleepover-support-note">The first 2 hours of active support are included in the participant’s sleepover charge. Worker pay is calculated separately.</p></fieldset>`;
  }
  function section(form){return form?.matches?.('[data-sleepover-support]')?form:form?.querySelector?.('[data-sleepover-support]');}
  function read(form){
    const box=section(form);
    return box?[...box.querySelectorAll('[data-sleepover-period]')].map(el=>({start:el.querySelector('[data-sleepover-start]').value,end:el.querySelector('[data-sleepover-end]').value})):[];
  }
  function update(form){
    const box=section(form);if(!box)return;
    const holder=box.closest('[data-note-form]')||form,total=Number(holder?.querySelector?.('.note-active')?.value||0);
    const required=box.dataset.periodTimingNeeded==='true'&&total>2,values=read(box),from=instant(box.dataset.periodFrom),to=instant(box.dataset.periodTo);
    let invalid=false,overlap=false,recorded=0;
    const ranges=[];
    for(const p of values){const start=instant(p.start),end=instant(p.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<from||end>to||end<=start||(start-from)%STEP!==0||(end-from)%STEP!==0){invalid=true;continue;}ranges.push({start,end});recorded+=(end-start)/36e5;}
    ranges.sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)overlap=true;
    let message=values.length?`Recorded periods: ${hoursText(recorded)}.`:'No support periods recorded.';
    if(invalid)message='Choose a start and a later end for every period, within this booking.';
    else if(overlap)message='Support periods overlap. Adjust them so the same time is recorded once.';
    else if(values.length&&Math.abs(recorded-total)>0.00001)message+=` Total active support entered: ${hoursText(Number.isFinite(total)?total:0)}. These totals need to match.`;
    else if(required&&!values.length)message='Add each support period. More than 2 active hours needs actual times because additional rates change during this booking.';
    else if(values.length)message+=' Matches the total active hours entered.';
    const status=box.querySelector('[data-sleepover-period-status]');status.textContent=message;
    status.classList.toggle('sleepover-support-warning',invalid||overlap||(required&&!values.length)||(values.length>0&&Math.abs(recorded-total)>0.00001));
    const details=box.querySelector('[data-sleepover-times]');if(required)details.open=true;
    const rule=box.querySelector('[data-sleepover-timing-rule]');rule.textContent=required?'Support times are needed: record all active support periods so additional charges use the correct day or public holiday rate.':box.dataset.periodTimingNeeded==='true'?'If active support exceeds 2 hours, record all support periods so additional charges use the correct day or public holiday rate.':'You can record support periods to explain the active hours you entered.';
    box.querySelector('[data-sleepover-add]').disabled=values.length>=MAX_ROWS||!choices(box.dataset.periodFrom,box.dataset.periodTo).length;
  }
  function restore(form,value){
    const box=section(form);if(!box)return;
    const points=choices(box.dataset.periodFrom,box.dataset.periodTo),saved=periods(value);
    box.querySelector('[data-sleepover-periods]').innerHTML=saved.map(p=>row(points,p)).join('');
    if(saved.length)box.querySelector('[data-sleepover-times]').open=true;
    update(form);
  }
  document.addEventListener('click',event=>{
    const add=event.target.closest?.('[data-sleepover-add]'),remove=event.target.closest?.('[data-sleepover-remove]');
    if(!add&&!remove)return;
    const box=(add||remove).closest('[data-sleepover-support]');if(!box||(add||remove).disabled)return;
    if(add){const points=choices(box.dataset.periodFrom,box.dataset.periodTo);if(!points.length||read(box).length>=MAX_ROWS)return;box.querySelector('[data-sleepover-periods]').insertAdjacentHTML('beforeend',row(points));box.querySelectorAll('[data-sleepover-start]')[read(box).length-1]?.focus();}
    if(remove){remove.closest('[data-sleepover-period]').remove();box.querySelector('[data-sleepover-add]').focus();}
    update(box);box.dispatchEvent(new Event('input',{bubbles:true}));
  });
  document.addEventListener('input',event=>{
    const form=event.target.closest?.('[data-note-form]');if(form&&(event.target.matches?.('.note-active')||event.target.closest?.('[data-sleepover-support]')))update(form);
  });
  document.addEventListener('change',event=>{if(event.target.closest?.('[data-sleepover-support]'))update(event.target.closest('[data-note-form]')||event.target.closest('[data-sleepover-support]'));});
  return {render,read,restore,update};
})();
