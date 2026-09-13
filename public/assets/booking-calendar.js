'use strict';
/* Shared, read-only diary. Booking decisions remain in the existing visit workspace. */
window.CareBookingCalendar = (() => {
  const e = value => esc(String(value ?? ''));
  const get = id => document.getElementById(id);
  const q = () => new URLSearchParams(location.hash.split('?')[1] || '');
  const onPage = () => location.hash.split('?')[0] === '#/bookings';
  const key = () => API.online && API.me ? [API.me.id,API.me.role,!!API.me.admin,API.actingFor?.id || ''].join(':') : '';
  const worker = () => !!(API.online && API.me?.role === 'worker' && !API.me.admin);
  const pad = n => String(n).padStart(2,'0');
  const iso = d => d.toISOString().slice(0,10);
  const dateObject = d => new Date(d+'T12:00:00Z');
  function shiftDate(date, days=0, months=0) {
    const d=dateObject(date); if(months){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);}else d.setUTCDate(d.getUTCDate()+days);
    return iso(d);
  }
  function days(from,to) {const out=[];for(let d=from;d<=to&&out.length<42;d=shiftDate(d,1))out.push(d);return out;}
  const fmt = (d,opts={day:'numeric',month:'short',year:'numeric'}) => dateObject(d).toLocaleDateString('en-AU',{...opts,timeZone:'UTC'});
  const visits = (data,day,cancelled=false) => data.bookings.filter(b => (cancelled || !['cancelled','declined'].includes(b.status)) && b.date<=day && (b.last_date || b.date)>=day).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id-b.id);
  const statuses={requested:'Requested',accepted:'Confirmed',completed:'Completed',cancelled:'Cancelled',declined:'Declined'};
  let state=null, lastView=null, alertSerial=0, alertKey='', alertCount=0, alertNext=null, alertFlight=null, alertRead=0;
  const current = s => state===s && key()===s.key && location.hash===s.hash && onPage() && get('bookingsList')===s.wrap;
  function badgeText(n){return n>99?'99+':String(n);}
  function paintAlerts(count,nextDate) {
    const old=alertCount;alertCount=Math.max(0,Number(count)||0);alertNext=nextDate || null;
    for(const id of ['bookingNavBadge','bookingMobileBadge']){const el=get(id);if(el){el.hidden=!alertCount;el.textContent=alertCount?badgeText(alertCount):'';}}
    const nav=get('navBookings');if(nav)nav.setAttribute('aria-label',alertCount?`Bookings, ${alertCount} booking request${alertCount===1?'':'s'}`:'Bookings');
    const burger=get('burger');if(burger)burger.setAttribute('aria-label','Open main menu'+(alertCount?`, ${alertCount} booking request${alertCount===1?'':'s'}`:''));
    const notice=get('bookingRequestNotice');if(notice){notice.hidden=!alertCount;notice.innerHTML=`<span class="booking-request-badge" aria-hidden="true">${badgeText(alertCount)}</span> ${alertCount} booking request${alertCount===1?'':'s'} <span>· Go to next request →</span>`;notice.href='#/bookings?view=calendar'+(alertNext?'&date='+encodeURIComponent(alertNext):'');}
    const announce=get('bookingAlertAnnounce');if(announce&&old!==alertCount)announce.textContent=alertCount?`${alertCount} booking request${alertCount===1?'':'s'} awaiting a response.`:'No booking requests awaiting a response.';
  }
  async function read(url,opts={}) {
    let timer;try{return await Promise.race([API.call(url,opts),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('This request took too long. Please try again.')),20000);})]);}finally{clearTimeout(timer);}
  }
  async function refreshAlerts(force=false) {
    const who=key();
    if(!worker()){if(who!==alertKey)lastView=null;alertSerial++;alertKey=who;alertFlight=null;paintAlerts(0,null);return;}
    if(who!==alertKey){lastView=null;alertSerial++;alertKey=who;alertFlight=null;alertRead=0;paintAlerts(0,null);}
    if(document.hidden || (!force && (alertFlight || Date.now()-alertRead<25000)))return;
    const serial=++alertSerial;alertFlight=serial;
    try{const d=await read('/me/booking-alerts',{noFor:true});if(serial!==alertSerial||key()!==who||!worker())return;paintAlerts(d.count,d.next_date);alertRead=Date.now();}
    catch(err){if(serial===alertSerial&&key()===who&&err.status===401)paintAlerts(0,null);}
    finally{if(alertFlight===serial)alertFlight=null;}
  }
  function setup(){
    const controls=get('bookingViewControls');if(!controls)return;
    const calendar=handles();
    controls.hidden=!(API.online&&API.me)||!!API.me.admin;
    controls.innerHTML=`<nav class="bc-view-switch" aria-label="Booking view"><a href="#/bookings?view=calendar${q().get('date')?'&amp;date='+e(q().get('date')):''}" ${calendar?'aria-current="page"':''}>Calendar</a><a href="#/bookings?view=list" ${!calendar?'aria-current="page"':''}>List</a></nav><a id="bookingRequestNotice" class="bc-request-notice" href="#/bookings?view=calendar" hidden></a>`;
    if(!calendar)state=null;
    paintAlerts(worker()?alertCount:0,alertNext);
  }
  function handles(){return onPage()&&q().get('view')!=='list'&&!API.me?.admin;}
  function timeText(b,day) {
    if(b.date<day)return `Continues from ${fmt(b.date,{day:'numeric',month:'short'})} · ends ${b.end_date===day?b.end_time:fmt(b.end_date,{day:'numeric',month:'short'})+' '+b.end_time}`;
    return `${b.start}–${b.end_time}${b.end_date!==b.date?' · ends '+fmt(b.end_date,{day:'numeric',month:'short'}):''}`;
  }
  function dayItems(s) {
    const list=visits(s.data,s.selected,s.cancelled);
    return `<section class="bc-agenda" aria-labelledby="bcDayTitle"><h3 id="bcDayTitle">${e(fmt(s.selected,{weekday:'long',day:'numeric',month:'long'}))}</h3>${list.length?`<ul>${list.map(b=>`<li><div class="bc-visit-top"><strong>${e(timeText(b,s.selected))}</strong><span class="bc-status ${b.needs_response?'needs-response':e(b.status)}">${b.needs_response?'! Response needed':e(statuses[b.status]||b.status)}</span></div><h4>${e(b.other_name)}</h4><p>${e((typeof SVC_NAME!=='undefined'&&SVC_NAME[b.service])||b.service)} · ${e(b.hours)} ${Number(b.hours)===1?'hour':'hours'}${b.intro?' · Meet and greet':''}${b.sleepover?' · Sleepover':''}${b.series_id?' · Repeating visit':''}</p>${b.cover_state?'<p>Cover status: '+e(b.cover_state)+'. Open the booking for details.</p>':''}<a class="bc-open" href="#/journey?panel=shift&amp;booking=${Number(b.id)}&amp;return_date=${s.selected}">${b.needs_response?'Review request':'Open booking'} <span aria-hidden="true">→</span></a></li>`).join('')}</ul>`:`<p class="bc-empty">No visits ${s.cancelled?'':'currently '}scheduled for this day.</p>${s.data.role==='participant'?'<a class="bc-open" href="#/find-workers">Find a worker</a>':''}`}</section>`;
  }
  function view(s) {
    const d=s.data,dates=days(d.from,d.to),heading=d.view==='month'?fmt(d.date,{month:'long',year:'numeric'}):fmt(d.from)+' – '+fmt(d.to);
    const cells=dates.map(day=>{const items=visits(d,day,s.cancelled),requests=items.filter(b=>b.needs_response).length;return `<td><button type="button" class="bc-day${day===s.selected?' is-selected':''}${day===d.today?' is-today':''}${day.slice(0,7)!==d.date.slice(0,7)?' is-outside':''}" data-cal-action="day" data-date="${day}" tabindex="${day===s.selected?'0':'-1'}" aria-pressed="${day===s.selected}" ${day===d.today?'aria-current="date"':''} aria-label="${e(fmt(day,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}, ${items.length} visit${items.length===1?'':'s'}${requests?', '+requests+' awaiting response':''}"><span class="bc-date">${Number(day.slice(8))}</span><span class="bc-day-count" aria-hidden="true">${items.length?items.length+' visit'+(items.length===1?'':'s'):''}</span><span class="bc-dots" aria-hidden="true">${items.slice(0,3).map(b=>`<i class="bc-dot ${b.needs_response?'needs-response':e(b.status)}"></i>`).join('')}${items.length>3?'<span>+</span>':''}</span></button></td>`;});
    const rows=[];for(let i=0;i<cells.length;i+=7)rows.push('<tr>'+cells.slice(i,i+7).join('')+'</tr>');
    return `<section class="booking-calendar" aria-label="Booking calendar"><div class="bc-toolbar"><div class="bc-period"><button type="button" data-cal-action="prev" aria-label="Previous ${d.view}">‹</button><h2>${e(heading)}</h2><button type="button" data-cal-action="next" aria-label="Next ${d.view}">›</button><button type="button" data-cal-action="today">Today</button></div><div class="bc-controls"><label>View <select id="bcView"><option value="month" ${d.view==='month'?'selected':''}>Month</option><option value="week" ${d.view==='week'?'selected':''}>Week</option></select></label><label>Go to date <input type="date" id="bcDate" value="${d.date}" min="1901-01-01" max="9998-12-31"></label><button type="button" data-cal-action="refresh">Refresh</button></div></div><p class="bc-zone">Times shown in ${e(d.time_zone)}${API.actingFor?' · '+e(d.subject.name):''}.</p><div class="bc-layout"><div><table class="bc-month"><caption class="sr-only">${e(heading)}. Use arrow keys to choose a day, or Go to date.</caption><thead><tr>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>'<th scope="col">'+day+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table><div class="bc-legend"><span><i class="bc-dot accepted"></i> Confirmed</span><span><i class="bc-dot ${d.role==='worker'?'needs-response':'requested'}"></i> Requested</span><span><i class="bc-dot completed"></i> Completed</span></div><label class="bc-show-cancelled"><input type="checkbox" id="bcCancelled" ${s.cancelled?'checked':''}> Show cancelled and declined</label></div>${dayItems(s)}</div><p class="bc-foot">Open a booking to respond, change it or view its details. <a href="${API.me?.role==='coordinator'?'#/journey?panel=preferences':'#/account/notifications'}">Calendar subscription settings</a></p><p id="bcStatus" class="sr-only" role="status" aria-live="polite"></p></section>`;
  }
  function remember(s){lastView={key:s.key,date:s.date,mode:s.mode,selected:s.selected,cancelled:s.cancelled};}
  function paint(s,focusDate=false){if(!current(s))return;remember(s);s.wrap.innerHTML=view(s);bind(s);if(focusDate)s.wrap.querySelector(`[data-date="${s.selected}"]`)?.focus({preventScroll:true});}
  async function load(s,date=s.date,mode=s.mode,focusDate=false,focusSelector=''){
    if(!current(s))return;const serial=++s.serial;s.date=date;s.mode=mode;s.wrap.innerHTML='<p role="status">Loading your calendar…</p>';
    try{const d=await read('/bookings/calendar?view='+encodeURIComponent(mode)+(date?'&date='+encodeURIComponent(date):''));if(!current(s)||serial!==s.serial)return;s.data=d;s.date=d.date;s.mode=d.view;if(!s.selected||s.selected<d.from||s.selected>d.to)s.selected=d.date;remember(s);s.wrap.innerHTML=view(s);bind(s);if(focusDate)s.wrap.querySelector(`[data-date="${s.selected}"]`)?.focus({preventScroll:true});else if(focusSelector)s.wrap.querySelector(focusSelector)?.focus({preventScroll:true});if(worker())paintAlerts(d.alerts?.count||0,d.alerts?.next_date);}
    catch(err){if(current(s)&&serial===s.serial){s.wrap.innerHTML=`<div class="bc-error" role="alert"><p>Calendar couldn’t load. ${e(err.message)}</p><button type="button" data-cal-action="refresh">Try again</button> <a href="#/bookings?view=list">Open booking list</a></div>`;bind(s);}}
  }
  function bind(s){
    s.wrap.onclick=event=>{const b=event.target.closest('[data-cal-action]');if(!b||!current(s))return;event.preventDefault();const action=b.dataset.calAction;
      if(action==='day'){s.selected=b.dataset.date;paint(s,true);}
      else if(action==='refresh')load(s,s.date,s.mode,false,'[data-cal-action="refresh"]');
      else if(action==='today'){s.selected='';load(s,'',s.mode,false,'[data-cal-action="today"]');}
      else if(action==='prev'||action==='next'){const dir=action==='next'?1:-1;const date=shiftDate(s.date,s.mode==='week'?dir*7:0,s.mode==='month'?dir:0);s.selected=date;load(s,date,s.mode,false,'[data-cal-action="'+action+'"]');}
    };
    s.wrap.onchange=event=>{if(!current(s))return;const id=event.target.id;if(id==='bcView')load(s,s.date,event.target.value,false,'#bcView');if(id==='bcDate'&&event.target.value&&event.target.validity.valid){s.selected=event.target.value;load(s,event.target.value,s.mode,false,'#bcDate');}if(id==='bcCancelled'){s.cancelled=event.target.checked;paint(s);s.wrap.querySelector('#bcCancelled')?.focus({preventScroll:true});}};
    s.wrap.onkeydown=event=>{const b=event.target.closest('[data-cal-action="day"]');if(!b||!current(s))return;const n={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];let date;if(n)date=shiftDate(b.dataset.date,n);else if(event.key==='Home')date=shiftDate(b.dataset.date,-(dateObject(b.dataset.date).getUTCDay()+6)%7);else if(event.key==='End')date=shiftDate(b.dataset.date,6-(dateObject(b.dataset.date).getUTCDay()+6)%7);else return;event.preventDefault();s.selected=date;if(date<s.data.from||date>s.data.to)load(s,date,s.mode,true);else paint(s,true);};
  }
  async function render(){
    const wrap=get('bookingsList');if(!wrap)return;setup();state=null;
    if(window.CarePayments)CarePayments.renderBookingNotice();
    if(!(API.online&&API.me)){wrap.innerHTML='<p>Sign in to see your calendar and booking requests.</p><button type="button" class="btn btn-primary btn-sm" data-open-login>Sign in</button>';return;}
    if(API.me.role==='coordinator'&&!API.actingFor){wrap.innerHTML='<p>Choose a person from <a href="#/clients">My clients</a> to see their calendar.</p>';return;}
    const prev=lastView?.key===key()?lastView:null;
    const s={wrap,key:key(),hash:location.hash,date:q().get('date')||prev?.date||'',mode:prev?.mode||'month',selected:q().get('date')||prev?.selected||'',cancelled:prev?.cancelled||false,serial:0};state=s;await load(s);
  }
  function sync(){if(state&&state.key!==key()){state.wrap.innerHTML='';state=null;}refreshAlerts(true);}
  function changed(path){if(/\/(bookings|series)(\/|$)|\/cover/.test(path))refreshAlerts(true);}
  document.addEventListener('click',event=>{const link=event.target.closest('#bookingRequestNotice');if(link&&link.hash===location.hash){event.preventDefault();render();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAlerts(true);});
  window.addEventListener('focus',()=>refreshAlerts());
  setInterval(()=>refreshAlerts(),30000);
  return {setup,handles,render,refreshAlerts,sync,changed,view,days,shiftDate,visits};
})();
CareBookingCalendar.sync();
if(location.hash.split('?')[0]==='#/bookings'&&typeof renderBookingsPage==='function')renderBookingsPage();
