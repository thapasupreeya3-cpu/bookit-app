'use strict';
/* Real booking requests plus the ongoing patterns that prepare future requests. */
window.CareRoutine = (() => {
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get = id => document.getElementById(id);
  const api = () => window.API;
  const query = () => new URLSearchParams(location.hash.split('?')[1] || '');
  const handles = () => location.hash.split('?')[0] === '#/bookings' && query().get('view') === 'routine';
  const eligible = () => !!(api()?.online && api().me && !api().me.admin && (api().me.role === 'participant' || (api().me.role === 'coordinator' && api().actingFor?.id && (!Array.isArray(api().actingFor.scopes) || api().actingFor.scopes.includes('bookings')))));
  const identity = () => eligible() ? [api().me.id,api().me.role,api().actingFor?.id || '',(api().actingFor?.scopes || []).slice().sort().join(',')].join(':') : '';
  const subject = () => Number(api()?.me?.role === 'coordinator' ? api().actingFor?.id : api()?.me?.id);
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(+new Date(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
  const dateObject = value => new Date(value+'T12:00:00Z');
  const dateLabel = (value, options={day:'numeric',month:'short',year:'numeric'}) => validDate(value) ? dateObject(value).toLocaleDateString('en-AU',{...options,timeZone:'UTC'}) : 'Date to confirm';
  const shiftDate = (date,days) => { const d=dateObject(date);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); };
  const amount = value => Number((Number(value)||0).toFixed(2));
  const serviceName = code => (typeof SVC_NAME !== 'undefined' && SVC_NAME[code]) || code || 'Support';
  const active = b => !['cancelled','declined'].includes(b.status);
  const coverNeeded = b => ['finding','office','uncovered','failed','referred','allied'].includes(b.cover_state);
  const visitLink = id => '#/journey?panel=shift&booking='+Number(id)+(api()?.me?.role==='coordinator'?'&for='+encodeURIComponent(subject()):'');
  let state=null, remembered=null;
  const current = s => state===s && eligible() && identity()===s.key && handles() && location.hash===s.hash && get('bookingsList')===s.wrap;
  async function read(path) { let timer;try{return await Promise.race([api().call(path),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('This request took too long. Please try again.')),20000);})]);}finally{clearTimeout(timer);} }
  function weekSummary(data) {
    const rows=(data.bookings||[]).filter(b=>active(b)&&b.date>=data.from&&b.date<=data.to);
    return {count:rows.length,hours:amount(rows.reduce((sum,b)=>sum+Number(b.hours||0),0)),requested:rows.filter(b=>b.status==='requested'&&!coverNeeded(b)).length,confirmed:rows.filter(b=>b.status==='accepted'&&!coverNeeded(b)).length,cover:rows.filter(coverNeeded).length};
  }
  function status(b) {return coverNeeded(b)?['cover','Cover being arranged']:b.status==='accepted'?['confirmed','✓ Confirmed']:b.status==='completed'?['completed','✓ Completed']:['requested','◷ Requested'];}
  function visit(b,day) {
    const [tone,label]=status(b),continues=b.date<day;
    const times=continues?'Continues · ends '+(b.end_date===day?'':dateLabel(b.end_date,{day:'numeric',month:'short'})+' ')+b.end_time:b.start+'–'+b.end_time+(b.end_date!==b.date?' · next day':'');
    return `<li><span class="cr-status ${tone}">${e(label)}</span><strong>${e(b.other_name)}</strong><span>${e(times)} · ${amount(b.hours)} hours${continues?' total':''}</span><span>${e(serviceName(b.service))}${b.sleepover?' · Sleepover':''}${b.intro?' · Meet and greet':''}</span><span class="cr-kind">${b.series_id&&!b.detached?'Regular shift':'One-off shift'}</span><a href="${e(visitLink(b.id))}">View shift<span class="sr-only"> with ${e(b.other_name)} on ${e(dateLabel(b.date))}</span></a></li>`;
  }
  function weekView(s) {
    const d=s.calendar,total=weekSummary(d),dates=Array.from({length:7},(_,i)=>shiftDate(d.from,i));
    return `<section class="cr-week" aria-labelledby="crWeekHeading"><div class="cr-toolbar"><h3 id="crWeekHeading">${e(dateLabel(d.from))} – ${e(dateLabel(d.to))}</h3><div class="cr-week-buttons"><button type="button" data-cr="previous" aria-label="Previous week">‹</button><button type="button" data-cr="today">This week</button><button type="button" data-cr="next" aria-label="Next week">›</button><label>Go to week <input id="crWeekDate" type="date" min="1901-01-01" max="9998-12-31" value="${e(d.date)}"></label></div></div><p class="cr-week-summary"><b>${total.count} ${total.count===1?'shift':'shifts'} · ${total.hours} hours</b> starting this week · ${total.confirmed} confirmed · ${total.requested} requested${total.cover?' · '+total.cover+' needing cover':''}</p><p class="cr-muted">Times in ${e(d.time_zone)}. Overnight shifts appear on both days; their hours are counted once on the starting day.</p><div class="cr-week-grid">${dates.map(day=>{
      const rows=(d.bookings||[]).filter(b=>active(b)&&b.date<=day&&(b.last_date||b.date)>=day).sort((a,b)=>(a.starts_at||a.date+a.start).localeCompare(b.starts_at||b.date+b.start)||a.id-b.id);
      return `<section class="cr-day${day===d.today?' is-today':''}"><h4>${e(dateLabel(day,{weekday:'short',day:'numeric',month:'short'}))}${day===d.today?' <span>Today</span>':''}</h4>${rows.length?`<ul>${rows.slice(0,2).map(b=>visit(b,day)).join('')}</ul>${rows.length>2?`<details><summary>${rows.length-2} more ${rows.length===3?'shift':'shifts'}</summary><ul>${rows.slice(2).map(b=>visit(b,day)).join('')}</ul></details>`:''}`:'<p class="cr-no-shifts">No shifts booked</p>'}${day>=d.today?`<button type="button" class="cr-day-add" data-cr="add" data-date="${day}">+ Book a shift<span class="sr-only"> from ${e(dateLabel(day))}</span></button>`:''}</section>`;
    }).join('')}</div></section>`;
  }
  function patternLabel(p) {return (p.freq==='fortnightly'?'Every second ':'Every ')+dateLabel(p.first_date,{weekday:'long'})+' · '+p.start+' · '+amount(p.hours)+' hours';}
  const runningPattern = p => !p.ended_at && (!!p.auto_extend || p.remaining>0);
  const automaticPattern = p => runningPattern(p) && ['ongoing','date'].includes(p.repeat_end_mode);
  function endLabel(p) {return p.ended_at?'Ended':p.repeat_end_mode==='ongoing'?'Ongoing — until cancelled':p.repeat_end_mode==='date'&&p.until_date?'Ends '+dateLabel(p.until_date):'Previously booked dates';}
  function patternCard(p,s) {return `<button type="button" class="cr-pattern${Number(p.id)===s.selected?' is-selected':''}" data-cr="pattern" data-id="${Number(p.id)}" aria-pressed="${Number(p.id)===s.selected}" aria-controls="crPatternDetail"><strong>${e(p.worker_name)}</strong><span>${e(patternLabel(p))}</span><span>${e(serviceName(p.service))}${p.sleepover?' · Sleepover':''}</span><span class="cr-end-label">${e(endLabel(p))}</span><span>${p.ended_at?'Ended':p.remaining?`${Number(p.accepted)||0} confirmed · ${Number(p.requested)||0} requested${p.cover?' · '+Number(p.cover)+' needing cover':''}`:p.auto_extend?'Preparing future requests':'No shifts left'}</span><small>${p.generated_through?'Dates checked through '+e(dateLabel(p.generated_through)):p.last_date?'Requests through '+e(dateLabel(p.last_date)):'No requested dates'}</small>${p.generation_issues?.length?'<span class="cr-status cover">! '+p.generation_issues.length+' '+(p.generation_issues.length===1?'date needs':'dates need')+' attention</span>':''}</button>`;}
  function patternsView(s) {
    const all=s.series.series||[],running=all.filter(runningPattern),past=all.filter(p=>!runningPattern(p)),chosen=all.find(p=>Number(p.id)===s.selected);
    return `<section class="cr-patterns" aria-labelledby="crPatternsHeading"><h3 id="crPatternsHeading">Your regular shifts</h3><p class="cr-muted">Choose Repeat this booking in any booking form to create weekly or fortnightly support. Ongoing means until cancelled, with no shift limit; later dates are added automatically. Each request needs the worker’s acceptance.</p>${running.length?`<div class="cr-pattern-grid">${running.map(p=>patternCard(p,s)).join('')}</div>`:'<p class="cr-empty">No recurring bookings yet. <a href="#/bookings?view=calendar">Choose a date in your calendar</a>, select a carer and choose <b>Repeat this booking</b>.</p>'}${past.length?`<details class="cr-past" ${chosen&&!runningPattern(chosen)?'open':''}><summary>Previous routines (${past.length})</summary><div class="cr-pattern-grid">${past.map(p=>patternCard(p,s)).join('')}</div></details>`:''}<div id="crPatternDetail">${chosen?patternDetail(chosen,s):''}</div></section>`;
  }
  function patternDetail(p,s) {
    const upcoming=(p.upcoming||[]).filter(b=>b.date>=s.calendar.today),automatic=automaticPattern(p),issues=Array.isArray(p.generation_issues)?p.generation_issues:[];
    const manage=typeof seriesCardHtml==='function'?seriesCardHtml({series:[p],lock_hours:s.series.lock_hours}):'';
    const continuation=automatic?`<p class="cr-muted">${p.auto_extend?'Later dates will be requested automatically as they approach.':'Requests have been prepared through the end of this routine.'} Only dates marked <b>Confirmed</b> have been accepted by your worker. Later planned dates are not yet confirmed, and their prices may change.</p>`:'<p>Book this pattern again to start a new routine with prices for you to review.</p><button type="button" class="btn btn-primary btn-sm" data-cr="continue" data-id="'+Number(p.id)+'">Book this routine again</button>';
    const attention=issues.length?`<section class="cr-issues" aria-label="Dates needing attention"><h5>! Dates needing attention</h5><p>These dates have not been booked. Change the routine below or open the calendar to arrange another shift, then recheck.</p><ul>${issues.map(issue=>`<li><b>${e(dateLabel(issue.date))}</b> — ${e(issue.message||'Please review this date.')}</li>`).join('')}</ul>${p.ended_at?'':`<button type="button" data-cr="retry-dates" data-id="${Number(p.id)}" ${s.retrying===Number(p.id)?'disabled aria-busy="true"':''}>${s.retrying===Number(p.id)?'Rechecking dates…':'Recheck these dates'}</button>`} <a href="#/bookings?view=calendar">Open calendar</a></section>`:'';
    return `<section class="cr-pattern-detail" aria-label="Selected regular shift"><h4>${e(p.worker_name)} · ${e(patternLabel(p))}</h4><p><b>${e(endLabel(p))}</b>. ${p.next_date?'Next requested or confirmed shift: <b>'+e(dateLabel(p.next_date))+'</b>. ':''}${p.generated_through?'Dates checked through <b>'+e(dateLabel(p.generated_through))+'</b>. ':p.last_date?'Requests through <b>'+e(dateLabel(p.last_date))+'</b>. ':''}</p>${continuation}${attention}${upcoming.length?`<details class="cr-dates"><summary>View ${upcoming.length} upcoming ${upcoming.length===1?'date':'dates'}</summary><ul>${upcoming.map(b=>`<li><a href="${e(visitLink(b.id))}">${e(dateLabel(b.date))} · ${e(b.start)} · ${amount(b.hours)} hours</a> <span class="cr-status ${status(b)[0]}">${e(status(b)[1])}</span></li>`).join('')}</ul></details>`:''}${manage}<p class="cr-muted">Change one visit from its shift page. Changing a routine affects eligible future visits; visits within ${Number(s.series.lock_hours)||12} hours stay as planned. Ending the routine stops future requests and can incur the agreed cancellation charge for accepted short-notice visits.</p></section>`;
  }
  function pickerView(s) {
    if(!s.picker)return '';
    const p=s.picker,workers=(p.workers||[]).filter(w=>Array.isArray(w.services)&&w.services.length&&(!p.service||w.services.includes(p.service))&&(!p.search||String(w.name).toLowerCase().includes(p.search.toLowerCase())));
    return `<section id="crPicker" class="cr-picker" aria-labelledby="crPickerHeading"><div class="cr-toolbar"><h3 id="crPickerHeading">Choose your worker</h3><button type="button" data-cr="close-picker">Close</button></div><p>First shift: <b>${e(dateLabel(p.date))}</b>. Choose a worker, then review the time, support type, dates and price before sending.</p>${p.loading?'<p role="status">Loading available worker profiles…</p>':p.error?`<p role="alert">${e(p.error)}</p><button type="button" data-cr="retry-workers">Try again</button>`:`<label>Find a worker <input id="crWorkerSearch" type="search" value="${e(p.search||'')}" placeholder="Worker’s name" autocomplete="off"></label><div class="cr-worker-results">${workers.length?workers.map(w=>`<button type="button" data-cr="choose-worker" data-id="${Number(w.id)}"><strong>${e(w.name)}</strong><span>${e((w.services||[]).map(serviceName).join(' · '))}</span></button>`).join(''):'<p>No matching workers are available. <a href="#/find-workers">Browse workers</a> or change your search.</p>'}</div><p class="cr-muted">Availability is checked for every requested date when you send the request.</p>`}</section>`;
  }
  function view(s) {return `<div class="care-routine"><div class="cr-heading"><div><h2>Manage recurring bookings</h2><p>Review, change or end your care routine.${api()?.me?.role==='coordinator'?' For <b>'+e(s.calendar.subject?.name||api().actingFor?.name)+'</b>.':''}</p></div><div class="cr-heading-buttons"><a class="btn btn-primary" href="#/bookings?view=calendar">Back to calendar</a><button type="button" class="btn btn-secondary btn-sm" data-cr="refresh">Refresh</button></div></div><p class="cr-feedback" id="crFeedback" role="status" aria-live="polite">${e(s.message||'')}</p>${pickerView(s)}${patternsView(s)}${weekView(s)}</div>`;}
  function paint(s,selector='') {if(!current(s))return;remembered={key:s.key,date:s.date,selected:s.selected};s.wrap.innerHTML=view(s);bind(s);if(selector)s.wrap.querySelector(selector)?.focus({preventScroll:true});}
  async function load(s,date=s.date,focus='') {
    if(!current(s))return;
    const serial=++s.serial,focusBefore=document.activeElement;s.picker=null;s.date=date;
    if(s.calendar&&s.wrap.querySelector('#crFeedback')){s.wrap.querySelector('#crFeedback').textContent='Refreshing your care routine…';}
    else s.wrap.innerHTML='<p class="cr-loading" role="status">Loading your care routine…</p>';
    s.wrap.setAttribute?.('aria-busy','true');
    const results=await Promise.allSettled([read('/series'),read('/bookings/calendar?view=week'+(date?'&date='+encodeURIComponent(date):''))]);
    if(!current(s)||serial!==s.serial)return;
    s.wrap.setAttribute?.('aria-busy','false');
    const fail=results.find(r=>r.status==='rejected');
    if(fail){s.wrap.innerHTML=`<div class="care-routine cr-error" role="alert"><p>Your care routine could not load. ${e(fail.reason?.message)}</p><button type="button" data-cr="refresh">Try again</button> <a href="#/bookings?view=calendar">Open calendar</a></div>`;bind(s);return;}
    const series=results[0].value,calendar=results[1].value;
    if(calendar.role!=='participant'||Number(calendar.subject?.id)!==subject()){s.wrap.innerHTML='<p role="alert">Choose the participant again to see their care routine.</p>';return;}
    s.series=series;s.calendar=calendar;s.date=calendar.date;
    const rows=series.series||[];if(!rows.some(p=>Number(p.id)===s.selected))s.selected=Number(rows.find(runningPattern)?.id||0);
    paint(s,document.activeElement===focusBefore?focus:'');
  }
  function nextStart(p,today) {
    const step=p.freq==='fortnightly'?14:7;
    let date=!p.ended_at&&validDate(p.last_date)?shiftDate(p.last_date,step):validDate(p.first_date)?p.first_date:shiftDate(today,1);
    while(date<=today)date=shiftDate(date,step);
    return date;
  }
  async function showPicker(s,pattern=null,date='') {
    if(!current(s))return;
    const proposed=pattern?nextStart(pattern,s.calendar.today):validDate(date)&&date>=s.calendar.today?date:shiftDate(s.calendar.today,1);
    if(window.CareBookingCarerPicker){return window.CareBookingCarerPicker.open({date:proposed,pattern,returnFocus:document.activeElement});}
    const picker={date:proposed,pattern,service:pattern?.service||'',workers:[],loading:true,search:''};s.picker=picker;s.message='';paint(s,'[data-cr="close-picker"]');
    try{const d=await read('/workers');if(!current(s)||s.picker!==picker)return;picker.workers=Array.isArray(d.workers)?d.workers:[];picker.loading=false;
      if(pattern){const w=picker.workers.find(w=>Number(w.id)===Number(pattern.worker_id)&&Array.isArray(w.services)&&w.services.includes(pattern.service));if(w){prefill(s,w,pattern,proposed);return;}s.message='The previous worker is not currently available for this support. Choose another worker.';}
      paint(s,'#crWorkerSearch');
    }catch(err){if(current(s)&&s.picker===picker){picker.loading=false;picker.error='Worker profiles could not load. '+err.message;paint(s,'[data-cr="retry-workers"]');}}
  }
  function prefill(s,w,pattern,date) {
    if(!current(s)||typeof openBookingModal!=='function')return;
    openBookingModal(w);
    const assign=(id,value)=>{const n=get(id);if(n)n.value=String(value);};
    assign('bkRepeat',pattern?(pattern.freq==='fortnightly'?'fortnightly':'weekly'):'');assign('bkRepeatMode','ongoing');assign('bkRepeatUntil','');assign('bkDate',date);assign('bkStart',pattern?.start||'09:00');
    const hours=Number(pattern?.hours)||3, hoursNode=get('bkHours');if(hoursNode&&!Array.from(hoursNode.options||[]).some(o=>Number(o.value)===hours)){const option=document.createElement('option');option.value=String(hours);option.textContent=String(hours);hoursNode.appendChild(option);}assign('bkHours',hours);
    if(pattern?.service)assign('bkService',pattern.service);
    if(get('bkIntro'))get('bkIntro').checked=false;
    if(get('bkSleep'))get('bkSleep').checked=!!pattern?.sleepover;
    assign('bkNotes','');
    if(typeof syncRepeatUI==='function')syncRepeatUI();if(typeof syncSleepoverOption==='function')syncSleepoverOption();
    window.CareBookingPricing?.refresh(true);s.picker=null;s.message='Choose Repeat this booking for recurring support, then review the location and prices before sending.';
    paint(s);get('bkDate')?.focus({preventScroll:true});
  }
  function bind(s) {
    s.wrap.onclick=async event=>{const b=event.target.closest('[data-cr]');if(!b||!current(s))return;event.preventDefault();const action=b.dataset.cr;
      if(action==='refresh')return load(s,s.date,'[data-cr="refresh"]');
      if(action==='previous'||action==='next')return load(s,shiftDate(s.date,action==='next'?7:-7),'[data-cr="'+action+'"]');
      if(action==='today')return load(s,'','[data-cr="today"]');
      if(action==='pattern'){s.selected=Number(b.dataset.id);paint(s,'[data-cr="pattern"][data-id="'+s.selected+'"]');}
      if(action==='add')return showPicker(s,null,b.dataset.date||'');
      if(action==='continue'){const p=(s.series.series||[]).find(p=>Number(p.id)===Number(b.dataset.id));if(p&&!automaticPattern(p))return showPicker(s,p);}
      if(action==='retry-dates'){
        const id=Number(b.dataset.id),p=(s.series.series||[]).find(p=>Number(p.id)===id);if(!p||p.ended_at||s.retrying)return;
        s.retrying=id;s.message='Rechecking dates…';paint(s);
        try{const result=await api().call('/series/'+id+'/retry',{method:'POST',body:{},actorKey:[api().me?.id,api().actingFor?.id||''].join(':')});if(!current(s))return;s.message=(Number(result.created)||0)+' new '+(Number(result.created)===1?'request':'requests')+' sent. '+((Array.isArray(result.issues)?result.issues.length:Number(result.issues)||0)>0?'Some dates still need attention.':'Your routine is up to date.');await load(s,s.date,'[data-cr="pattern"][data-id="'+id+'"]');}
        catch(error){if(current(s)){s.message='These dates could not be rechecked. '+error.message;}}
        finally{if(current(s)){s.retrying=null;paint(s,'[data-cr="retry-dates"][data-id="'+id+'"]');}}
      }
      if(action==='retry-workers')return showPicker(s,s.picker?.pattern,s.picker?.date);
      if(action==='close-picker'){s.picker=null;paint(s,'[data-cr="add"]');}
      if(action==='choose-worker'){const p=s.picker,w=p?.workers.find(w=>Number(w.id)===Number(b.dataset.id));if(w)prefill(s,w,p.pattern,p.date);}
    };
    s.wrap.onchange=event=>{if(!current(s))return;if(event.target.id==='crWeekDate'&&validDate(event.target.value)&&event.target.validity.valid)load(s,event.target.value,'#crWeekDate');};
    s.wrap.oninput=event=>{if(!current(s)||event.target.id!=='crWorkerSearch'||!s.picker)return;s.picker.search=event.target.value;const position=event.target.selectionStart;paint(s,'#crWorkerSearch');const field=s.wrap.querySelector('#crWorkerSearch');field?.setSelectionRange?.(position,position);};
  }
  async function render() {
    const wrap=get('bookingsList');if(!wrap)return;state=null;
    if(window.CarePayments)CarePayments.renderBookingNotice();
    if(!api()?.online||!api()?.me){wrap.innerHTML='<p>Sign in to plan your care routine.</p><button type="button" class="btn btn-primary btn-sm" data-open-login>Sign in</button>';return;}
    if(!eligible()){wrap.innerHTML=api().me.role==='coordinator'?'<p>Select a participant with booking access from <a href="#/clients">My clients</a> to plan their care routine.</p>':'<p>Care routines are for participants and their authorised helpers. <a href="#/bookings?view=calendar">Open bookings</a>.</p>';return;}
    const old=remembered?.key===identity()?remembered:null,s={wrap,key:identity(),hash:location.hash,serial:0,selected:/^[1-9]\d*$/.test(query().get('routine')||'')?Number(query().get('routine')):old?.selected||0,date:validDate(query().get('date'))?query().get('date'):old?.date||'',picker:null};state=s;await load(s);
  }
  function sync() {if(state&&(state.key!==identity()||!handles())){state.serial++;state.picker=null;state.wrap.innerHTML='';state=null;remembered=null;}if(handles()&&!state)return render();}
  function changed(path) {if(current(state||{})&&/\/(bookings|series)(\/|$)|\/cover/.test(path))return load(state,state.date);}
  return {handles,eligible,render,sync,changed,weekSummary,nextStart};
})();
if(CareRoutine.handles()&&typeof renderBookingsPage==='function')renderBookingsPage();
