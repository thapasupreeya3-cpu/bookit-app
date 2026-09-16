'use strict';
/* A date starts a normal booking. Repeating support is chosen in the booking form. */
window.CareBookingCarerPicker = (() => {
  const get = id => document.getElementById(id);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = () => window.API;
  const eligible = () => !!(api()?.online && api().me && !api().me.admin && (api().me.role === 'participant' || (api().me.role === 'coordinator' && api().actingFor?.id && (!Array.isArray(api().actingFor.scopes) || api().actingFor.scopes.includes('bookings')))));
  const identity = () => eligible() ? [api().me.id, api().me.role, api().actingFor?.id || '', (api().actingFor?.scopes || []).slice().sort().join(',')].join(':') : '';
  const subject = () => Number(api()?.me?.role === 'coordinator' ? api().actingFor?.id : api()?.me?.id);
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(+new Date(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
  const dateLabel = value => validDate(value) ? new Date(value+'T12:00:00Z').toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}) : '';
  const serviceName = code => (typeof SVC_NAME !== 'undefined' && SVC_NAME[code]) || code;
  const defaultFilters = () => ({service:'',day:'',lang:'',gender:'',rating:'',sort:'',q:'',ints:[]});
  let state = null;
  const current = s => state === s && eligible() && s.key === identity() && s.hash === location.hash && s.dialog.isConnected;
  const realWorkers = workers => (Array.isArray(workers) ? workers : []).filter(w => !w.demo && Number(w.id)>0 && Array.isArray(w.services) && w.services.length);
  function ordered(workers, filters) {
    const list = window.CareWorkerFilters.filter(realWorkers(workers), filters);
    const recent = list.filter(w => w.group === 'recent').sort((a,b) => String(b.connected_at || b.last_shift || '').localeCompare(String(a.connected_at || a.last_shift || '')) || String(b.last_shift || '').localeCompare(String(a.last_shift || '')) || Number(b.id)-Number(a.id));
    return recent.concat(list.filter(w => w.group !== 'recent'));
  }
  function options(source, selected) {
    const node = get(source);
    return Array.from(node?.options || []).map(o => `<option value="${e(o.value)}" ${String(o.value)===String(selected)?'selected':''}>${e(o.textContent)}</option>`).join('');
  }
  function filterSelect(name, label, source, s) {
    return `<label>${label}<select id="cp${name}" data-cp-filter="${name}">${options(source,s.filters[name])}</select></label>`;
  }
  function shell(s) {
    return `<div class="cp-shell"><header class="cp-header"><div><h2 id="cpTitle">Choose a carer</h2><p id="cpDateLabel">${e(dateLabel(s.date))}</p></div><button type="button" class="cp-close" data-cp="close" aria-label="Close carer chooser" autofocus>×</button></header>
      <p class="cp-intro" id="cpIntro">Your recent carers first, then carers in your area.</p>
      <div class="cp-search"><label>Service<select id="cpservice" data-cp-filter="service">${options('filterService',s.filters.service)}</select></label><label>Search<input id="cpSearch" data-cp-filter="q" type="search" placeholder="Name, suburb or postcode…" autocomplete="off"></label></div>
      <details class="cp-filters" id="cpExtraDetails"><summary><span>Filters &amp; visit details <span id="cpFilterCount"></span></span><span id="cpVisitSummary">${e(s.start)} · ${e(s.hours)} hours</span></summary>
        <form id="cpVisitForm" class="cp-visit" aria-label="Check a specific visit"><div class="cp-visit-fields"><label>Date<input id="cpDate" type="date" required value="${e(s.date)}"></label><label>Start time<input id="cpStart" type="time" required value="${e(s.start)}"></label><label>Hours<input id="cpHours" type="number" min="2" max="10" step="0.25" required value="${e(s.hours)}"></label><label>Visit suburb, state or postcode<input id="cpPlace" maxlength="100" placeholder="e.g. Ryde NSW" value="${e(s.place)}"></label></div><div class="cp-visit-actions"><button type="submit" class="btn btn-secondary btn-sm">Check this visit</button><button type="button" data-cp="clear-visit">Clear time check</button><span id="cpVisitStatus" role="status">Availability is checked when you request a booking.</span></div></form>
        <div class="cp-filter-grid">${filterSelect('day','Day','filterDay',s)}<label>Language<select id="cplang" data-cp-filter="lang"></select></label>${filterSelect('gender','Gender','filterGender',s)}${filterSelect('rating','Rating','filterRating',s)}${filterSelect('sort','Sort other carers','filterSort',s)}</div><fieldset class="cp-interests"><legend>Shared interests</legend><div id="cpInterests"></div></fieldset><button type="button" data-cp="clear-filters">Clear all filters</button>
      </details>
      <p class="cp-location" id="cpLocation"></p><div id="cpResults" class="cp-results" aria-busy="true"></div><p class="cp-announcement sr-only" id="cpAnnounce" role="status" aria-live="polite" aria-atomic="true"></p>
      <footer class="cp-footer">Confirm the address and one-off or recurring support in the booking form. Your carer then accepts the request.</footer></div>`;
  }
  function renderOptions(s) {
    const langs = window.CareWorkerFilters.languages(s.base);
    const lang = get('cplang');
    lang.innerHTML = '<option value="">Any language</option>'+langs.map(value=>`<option value="${e(value)}">${e(value)}</option>`).join('');
    lang.value = s.filters.lang;
    get('cpInterests').innerHTML = window.CareWorkerFilters.interests(s.base).map(value=>`<button type="button" data-cp-interest="${e(value)}" aria-pressed="${s.filters.ints.includes(value)}">${e(value)}</button>`).join('') || '<span>No shared interests listed yet.</span>';
  }
  function imageMarkup(w) {
    /* Only same-origin worker photographs; names and profiles remain untrusted text. */
    return /^\/photos\/\d+(?:\?[^#]*)?$/.test(String(w.photo || '')) ? `<img class="cp-avatar" src="${e(w.photo)}" alt="" loading="lazy">` : `<span class="cp-avatar cp-initials" aria-hidden="true">${e(String(w.name||'').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join(''))}</span>`;
  }
  function renderResults(s, reset=false) {
    if(!current(s))return;
    const host=get('cpResults');
    host.setAttribute('aria-busy',String(s.loading));
    if(s.loading){host.innerHTML='<p class="cp-message" role="status">Loading carers…</p>';return;}
    if(s.error){host.innerHTML=`<div class="cp-message" role="alert"><p>${e(s.error)}</p><button type="button" data-cp="retry" class="btn btn-secondary btn-sm">Try again</button></div>`;get('cpAnnounce').textContent='Carer profiles could not load.';return;}
    const oldId=s.list?.[s.index]?.id;
    s.list=ordered(s.workers,s.filters);
    s.index=reset?0:Math.max(0,s.list.findIndex(w=>w.id===oldId));
    const count=s.list.length,w=s.list[s.index];
    get('cpFilterCount').textContent=Object.entries(s.filters).filter(([key,value])=>key==='ints'?value.length:key==='day'?value!=='':!!value).length?'(applied)':'';
    if(!w){host.innerHTML='<div class="cp-message"><h3>No carers match these choices</h3><p>Try another time, suburb or filter. You can also browse the full Find workers page.</p><button type="button" data-cp="clear-filters" class="btn btn-secondary btn-sm">Clear filters</button> <a href="#/find-workers" data-cp="browse">Find workers</a></div>';get('cpAnnounce').textContent='No carers match these choices.';return;}
    const recent=w.group==='recent',heading=recent?'Your recent carers':'Carers in your area';
    const stars=Number(w.shifts)>0&&Number.isFinite(Number(w.rating))?'★ '+Number(w.rating).toFixed(1)+' · '+Number(w.shifts)+' shifts':'New to The Care Web';
    const bio=String(w.bio||'Choose this carer to review your support and booking details.');
    host.innerHTML=`<div class="cp-result-top"><strong>${heading}</strong><span>${s.index+1} of ${count}</span></div><article class="cp-card" aria-labelledby="cpCarerName"><div class="cp-person">${imageMarkup(w)}<div><h3 id="cpCarerName">${e(w.name)}</h3><p>${e(w.suburb||'Service area on profile')}</p><p>${e(w.exp||'')}<span>${w.exp?' · ':''}${e(stars)}</span></p></div></div><p class="cp-bio-preview">${e(bio)}</p>
      <details class="cp-carer-details"><summary>Carer details</summary><div class="cp-carer-detail-body"><p class="cp-bio">${e(bio)}</p><div class="cp-tags">${w.services.map(service=>'<span>'+e(serviceName(service))+'</span>').join('')}${(w.interests||[]).map(tag=>'<span class="cp-interest-tag">'+e(tag)+'</span>').join('')}</div><p class="cp-languages">Languages: ${e(w.langs||'English')}</p></div></details>${s.checked?'<p class="cp-match">Matches the time checked above. Availability is checked again before you send.</p>':''}
      <div class="cp-actions" role="group" aria-label="Choose or browse carers"><button type="button" class="cp-arrow" data-cp="previous" ${count<2?'disabled':''} aria-label="Previous carer" title="Previous carer">←</button><button type="button" class="btn btn-primary cp-choose" data-cp="choose" ${s.directoryDirty?'disabled':''}>Book with ${e(String(w.name||'this carer').split(' ')[0])}</button><button type="button" class="cp-arrow" data-cp="next" ${count<2?'disabled':''} aria-label="Next carer" title="Next carer">→</button></div></article>`;
    get('cpAnnounce').textContent=`${heading}. ${s.index+1} of ${count} carers: ${w.name}.`;
  }
  function paintLocation(s) {
    get('cpLocation').textContent=s.locationLabel?'Local area: '+s.locationLabel:'Add your suburb under Filters & visit details to find local carers.';
  }
  async function read(path) {
    let timer;
    try{return await Promise.race([api().call(path),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('This request took too long. Please try again.')),20000);})]);}
    finally{clearTimeout(timer);}
  }
  function visitValues(s) {
    return {date:get('cpDate').value,start:get('cpStart').value,hours:Number(get('cpHours').value),place:get('cpPlace').value.trim(),service:s.filters.service};
  }
  function visitSummary(s) {
    const node=get('cpVisitSummary');
    if(node){const visit=visitValues(s);node.textContent=(visit.start||'Set time')+' · '+(visit.hours>0?visit.hours+' hours':'Set hours');}
  }
  async function load(s,check=false) {
    if(!current(s))return;
    const serial=++s.serial;
    const visit=visitValues(s);s.date=visit.date;s.start=visit.start;s.hours=visit.hours;s.place=visit.place;visitSummary(s);
    const query=new URLSearchParams({date:s.date});
    if(check){query.set('start',visit.start);query.set('hours',String(visit.hours));}
    if(visit.place)query.set('place',visit.place);
    if(check&&visit.service)query.set('service',visit.service);
    s.loading=true;s.error='';s.checked=false;get('cpVisitStatus').textContent=check?'Checking this visit…':'Availability is checked when you request a booking.';renderResults(s);
    try{
      const data=await read('/bookings/carers?'+query.toString());
      if(!current(s)||serial!==s.serial)return;
      if(Number(data.subject?.id)!==subject())throw Error('The selected participant changed. Close this window and choose their date again.');
      s.workers=realWorkers(data.workers);if(!check)s.base=s.workers;
      s.locationLabel=data.location?.label||'';s.checked=check&&data.interval_checked===true;
      if(check&&!s.checked)throw Error('This visit could not be checked. Please try again.');
      if(!s.place&&s.locationLabel){s.place=s.locationLabel;get('cpPlace').value=s.place;}
      s.loading=false;s.directoryDirty=false;if(validDate(data.today))get('cpDate').min=data.today;get('cpDateLabel').textContent=dateLabel(s.date);paintLocation(s);renderOptions(s);renderResults(s,true);
      get('cpVisitStatus').textContent=s.checked?'Showing carers who match this visit. '+(data.location_checked?'Service area checked.':'Location has not been checked.'):'Availability is checked when you request a booking.';
    }catch(error){if(current(s)&&serial===s.serial){s.loading=false;s.workers=[];s.error='Carer profiles could not load. '+error.message;get('cpVisitStatus').textContent='';renderResults(s);}}
  }
  function focusBack(s) {
    if(s.returnFocus?.isConnected)s.returnFocus.focus({preventScroll:true});
  }
  function close(restore=true) {
    const old=state;if(!old)return;
    state=null;old.serial++;old.dialog.close();old.dialog.remove();document.body.style.overflow=old.overflow;
    if(restore)focusBack(old);
  }
  function sync(){if(state&&!current(state))close(false);}
  function assign(id,value){const node=get(id);if(node)node.value=String(value);}
  function choose(s) {
    if(!current(s)||s.loading||s.error||s.directoryDirty)return;
    const w=s.list?.[s.index];if(!w||typeof openBookingModal!=='function')return;
    const values=visitValues(s),p=s.pattern;
    const form=get('cpVisitForm');
    if(!validDate(values.date)||(form.checkValidity&&!form.checkValidity())){
      get('cpExtraDetails').open=true;form.reportValidity();return;
    }
    if(!form.reportValidity())return;
    close(false);openBookingModal(w);
    assign('bkDate',values.date);assign('bkRepeat',p?(p.freq==='fortnightly'?'fortnightly':'weekly'):'');assign('bkRepeatMode','ongoing');assign('bkRepeatUntil','');
    assign('bkStart',values.start||p?.start||'09:00');
    const hours=Number(values.hours)||Number(p?.hours)||2,hoursNode=get('bkHours');
    if(hoursNode&&!Array.from(hoursNode.options||[]).some(o=>Number(o.value)===hours)){const option=document.createElement('option');option.value=String(hours);option.textContent=String(hours);hoursNode.appendChild(option);}assign('bkHours',hours);
    const service=s.filters.service||p?.service;
    if(service&&w.services.includes(service))assign('bkService',service);
    if(get('bkIntro'))get('bkIntro').checked=false;
    if(get('bkSleep'))get('bkSleep').checked=!!p?.sleepover;
    assign('bkNotes','');
    if(typeof syncRepeatUI==='function')syncRepeatUI();if(typeof syncSleepoverOption==='function')syncSleepoverOption();if(typeof syncBkRateLine==='function')syncBkRateLine();
    window.CareBookingPricing?.refresh(true);
    /* The booking dialog has its own focus handler. Run after that activation. */
    queueMicrotask(()=>{if(eligible()&&identity()===s.key)get('bkDate')?.focus({preventScroll:true});});
  }
  function clearFilters(s) {
    invalidate(s);
    s.filters=defaultFilters();
    s.dialog.querySelectorAll('[data-cp-filter]').forEach(node=>{node.value='';});
    renderOptions(s);renderResults(s,true);
  }
  function invalidate(s) {
    visitSummary(s);
    s.serial++;s.checked=false;s.loading=false;s.error='';s.workers=s.base;
    get('cpVisitStatus').textContent='Visit details changed. Check this visit again to filter by availability.';
    renderResults(s,true);
  }
  function bind(s) {
    get('cpVisitForm').addEventListener('invalid',()=>{if(current(s))get('cpExtraDetails').open=true;},true);
    s.dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    s.dialog.addEventListener('click',event=>{
      const chip=event.target.closest('[data-cp-interest]');
      if(chip&&current(s)){const value=chip.dataset.cpInterest;s.filters.ints=s.filters.ints.includes(value)?s.filters.ints.filter(v=>v!==value):s.filters.ints.concat(value);chip.setAttribute('aria-pressed',String(s.filters.ints.includes(value)));renderResults(s,true);return;}
      const button=event.target.closest('[data-cp]');if(!button||!current(s))return;
      const action=button.dataset.cp;
      if(action==='browse'){close();return;}
      event.preventDefault();
      if(action==='close')close();
      else if(action==='retry')load(s,false);
      else if(action==='clear-filters')clearFilters(s);
      else if(action==='clear-visit')load(s,false);
      else if(action==='choose')choose(s);
      else if((action==='previous'||action==='next')&&s.list?.length){const target=s.list[(s.index+(action==='next'?1:-1)+s.list.length)%s.list.length];s.index=s.list.indexOf(target);renderResults(s);s.dialog.querySelector('[data-cp="'+action+'"]')?.focus({preventScroll:true});}
    });
    s.dialog.addEventListener('input',event=>{
      if(!current(s))return;
      if(event.target.dataset.cpFilter==='q'){s.filters.q=event.target.value.trim();renderResults(s,true);}
      else if(['cpDate','cpStart','cpHours','cpPlace'].includes(event.target.id)){if(['cpDate','cpPlace'].includes(event.target.id))s.directoryDirty=true;invalidate(s);}
    });
    s.dialog.addEventListener('change',event=>{
      if(!current(s))return;
      if((event.target.id==='cpDate'&&validDate(event.target.value))||event.target.id==='cpPlace'){load(s,false);return;}
      const filter=event.target.dataset.cpFilter;if(!filter||filter==='q')return;
      s.filters[filter]=event.target.value;
      if(filter==='service')invalidate(s);
      renderResults(s,true);
    });
    s.dialog.addEventListener('submit',event=>{if(event.target.id==='cpVisitForm'){event.preventDefault();if(current(s)&&event.target.reportValidity())load(s,true);}});
    s.dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
      if(event.key!=='Tab')return;
      const nodes=Array.from(s.dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],summary')).filter(node=>node.getClientRects().length>0);
      const first=nodes[0],last=nodes.at(-1);
      if(first&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();event.stopImmediatePropagation();(event.shiftKey?last:first).focus({preventScroll:true});}
    });
  }
  async function open({date,returnFocus,pattern=null}={}) {
    close(false);
    if(!eligible()||!validDate(date))return false;
    const dialog=document.createElement('dialog');dialog.id='bookingCarerPicker';dialog.className='cp-dialog';dialog.setAttribute('aria-labelledby','cpTitle');dialog.setAttribute('aria-describedby','cpDateLabel cpIntro');
    const s={dialog,date,pattern,key:identity(),hash:location.hash,returnFocus:returnFocus||document.activeElement,overflow:document.body.style.overflow,filters:defaultFilters(),workers:[],base:[],list:[],index:0,serial:0,loading:true,error:'',checked:false,start:pattern?.start||'09:00',hours:Number(pattern?.hours)||2,place:'',locationLabel:''};
    if(pattern?.service)s.filters.service=pattern.service;
    state=s;dialog.innerHTML=shell(s);document.body.appendChild(dialog);bind(s);dialog.showModal();document.body.style.overflow='hidden';
    if(!window.CareWorkerFilters){s.loading=false;s.error='The carer filters could not load. Refresh the page and try again.';renderResults(s);return false;}
    await load(s);return current(s);
  }
  window.addEventListener('hashchange',sync);
  return {open,close,sync,eligible,ordered};
})();
