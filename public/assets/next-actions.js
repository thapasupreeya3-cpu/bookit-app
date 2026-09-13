'use strict';
/* Presentation groups do not complete, dismiss or reassign the underlying tasks. */
window.CareNextActions = (() => {
  const e = value => esc(String(value ?? ''));
  const safe = href => /^#\/(?!\/)/.test(String(href || '')) ? href : '#/contact';
  const suffix = task => String(task.task_key || '').replace(/^\d+:/,'');
  const dateOnly = value => /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''))?.[0] || '';
  const dateLabel = value => dateOnly(value) ? fmtAU(dateOnly(value)) : '';
  const dayNumber = value => Date.parse(dateOnly(value)+'T00:00:00Z') / 864e5;
  function timing(task, today, now) {
    const due=dateOnly(task.due_at);if(!due)return {rank:9,label:'',className:'',stamp:Infinity};
    const delta=dayNumber(due)-dayNumber(today),stamp=Date.parse(task.due_at);
    // Visit deadlines are times; document due dates are calendar days.
    const timed=['booking','cover'].includes(task.kind);
    if(delta<0 || (timed && Number.isFinite(stamp) && stamp<now))return {rank:0,label:'Overdue',className:'na-overdue',stamp};
    if(delta===0)return {rank:1,label:'Due today',className:'na-due',stamp};
    if(delta<=7)return {rank:2,label:'Due '+dateLabel(due),className:'na-due',stamp};
    return {rank:8,label:'Due '+dateLabel(due),className:'',stamp};
  }
  function action(task, role, destination) {
    const href=safe(destination(task)),key=suffix(task),worker=role==='worker';
    if(worker && href.startsWith('#/account/credentials'))return {group:'credentials',title:'Complete your document checklist',hint:'Add or replace the files listed in Credentials & checks.',verb:'Open checklist',href};
    if(worker && href.startsWith('#/account/training'))return {group:'training',title:'Complete your training',hint:'Finish the modules that are outstanding or due for renewal.',verb:'Open training',href};
    if(href==='#/support-plan')return {group:'support-plan',title:'Review your support plan',hint:'Complete the sections that still need your attention.',verb:'Open support plan',href};
    if(href==='#/account/billing'||href==='#/journey?panel=billing')return {group:'funding',title:'Confirm your funding details',hint:'Check how your support will be paid for.',verb:'Review funding',href};
    if(role==='coordinator'&&href==='#/clients')return {group:'client-documents',title:'Review their documents',hint:'Open the selected person’s file to review the requested documents.',verb:'Open client file',href};
    if(href==='#/account/documents')return {group:'documents',title:'Complete your document checklist',hint:'Review the missing, requested or expiring items on your file.',verb:'Open checklist',href};
    if(key.includes('verify-email'))return {group:'email',title:role==='coordinator'?'Confirm their email address':'Confirm your email address',hint:role==='coordinator'?'Ask the person to use the verification link in their email.':'Use the verification link in your email. You can request another copy.',verb:role==='coordinator'?'Open client file':'Resend email',href:role==='coordinator'?'#/clients':href,email:role!=='coordinator'};
    if(href==='#/account/profile')return {group:'profile',title:'Complete your profile',hint:'Update the details needed for your account.',verb:'Open profile',href};
    if(href.startsWith('#/invoice?'))return {group:href,title:task.label||'Review invoice',hint:task.detail||'',verb:task.kind==='review'?'Review shift':'View invoice',href};
    const verb={booking:'Review request',shift:'Write shift note',review:worker?'Answer question':'Review timesheet',followup:'Share feedback',renewal:'Renew document',document:'Open document',setup:href.startsWith('#/form/')?'Review form':'Open details'}[task.kind] || 'Open task';
    return {group:href,title:task.label || 'Review this task',hint:task.detail || '',verb,href,optional:task.kind==='followup'};
  }
  function waitingAction(task, role) {
    const key=suffix(task),worker=role==='worker',destination=String(task.destination || '');
    if(task.kind==='cover')return {group:'cover:'+key,title:task.label,href:safe(destination),verb:'View visit'};
    if(task.kind==='recruitment'||/setup:activation/.test(key))return {group:'application',title:'Application review',href:'#/journey?panel=recruitment',verb:'View application'};
    if(task.kind==='document'||/setup:(verify-|screening-status|register-)/.test(key))return {group:'documents',title:'Document and screening checks',href:worker?'#/account/credentials':role==='coordinator'?'#/clients':'#/account/documents',verb:'View documents'};
    if(task.kind==='transition')return {group:'transition:'+destination,title:'Support changes',href:safe(destination),verb:'View request'};
    // Never send a person into an office-only route or back into this same list.
    const href=destination.startsWith('#/admin')||/^#\/journey(?:\?panel=tasks)?$/.test(destination)?'#/contact':safe(destination);
    return {group:href,title:task.label || 'Office review',href,verb:href==='#/contact'?'Contact the office':'View record'};
  }
  function build(data,destination) {
    const now=Date.parse(data.as_of || '') || Date.now(),today=data.today || new Date(now).toISOString().slice(0,10);
    const groups={person:new Map(),office:new Map()},seen=new Set();
    for(const t of data.tasks || []){
      if(t.state==='completed' || seen.has(t.task_key))continue;seen.add(t.task_key);
      const owner=t.owner_kind==='person'?'person':'office';
      const meta=owner==='person'?action(t,data.role,destination):waitingAction(t,data.role);
      let group=groups[owner].get(meta.group);
      if(!group){group={...meta,owner,tasks:[],items:new Map(),rank:9,stamp:Infinity};groups[owner].set(meta.group,group);}
      const time=timing(t,today,now);
      const workRank=meta.group==='email'?2:meta.group==='profile'?3:({review:2,shift:2,booking:3,setup:4,document:4,followup:5,renewal:6}[t.kind] ?? 6);
      const rank=Math.min(time.rank,workRank);
      group.tasks.push(t);
      if(rank<group.rank || (rank===group.rank&&time.stamp<group.stamp)){group.rank=rank;group.stamp=time.stamp;group.time=time;group.first=t;if(owner==='person')group.href=meta.href;}
      const href=owner==='person'?meta.href:group.href;
      const type=/[?&]type=([^&]+)/.exec(href)?.[1];
      const itemLabel=owner==='office'&&group.group==='documents'?String(t.label||'').replace(/^(?:Office review: |Review received |Office check: )/,''):String(t.label||'');
      const itemKey=owner==='person'&&type?'type:'+type:href+'|'+itemLabel;
      let item=group.items.get(itemKey);
      if(!item){item={task:t,href,label:itemLabel || 'Review item',notes:new Set(),time};group.items.set(itemKey,item);}
      if(time.rank<item.time.rank){item.task=t;item.label=itemLabel;item.time=time;}
      if(t.detail)item.notes.add(t.detail);
    }
    const sort=list=>[...list.values()].sort((a,b)=>a.rank-b.rank||a.stamp-b.stamp||String(a.first?.task_key||a.group).localeCompare(String(b.first?.task_key||b.group)));
    return {mine:sort(groups.person),office:sort(groups.office),today,now};
  }
  const dueTag = time => time?.label?`<span class="na-tag ${time.className}">${e(time.label)}</span>`:'';
  function subitems(group) {
    const items=[...group.items.values()].sort((a,b)=>a.time.rank-b.time.rank||a.time.stamp-b.time.stamp);
    if(items.length===1 && items[0].label===group.title && (!items[0].notes.size || [...items[0].notes].join(' ')===group.hint))return '';
    return `<details class="na-details"><summary>${items.length===1?'Details':items.length+' items to check'}</summary><ul class="na-subitems">${items.map(item=>`<li><div><strong>${e(item.label)}</strong>${dueTag(item.time)}${[...item.notes].map(n=>`<p>${e(n)}</p>`).join('')}</div>${group.owner==='person'&&!group.email?`<a href="${e(item.href)}" data-flow-task="${e(item.task.task_key)}" aria-label="Open ${e(item.label)}">Open</a>`:''}</li>`).join('')}</ul></details>`;
  }
  function taskRow(group,index){
    return `<li class="na-task${index===0?' na-first':''}"><span class="na-number" aria-hidden="true">${index+1}</span><div class="na-task-body"><div class="na-task-title"><h3>${e(group.title)}</h3>${group.optional?'<span class="na-state" data-tone="waiting">◷ Optional feedback</span>':group.time?.label?dueTag(group.time):'<span class="na-state" data-tone="action">→ Action required</span>'}</div>${group.hint?`<p>${e(group.hint)}</p>`:''}${subitems(group)}</div><div class="na-task-go">${index===0?'<span class="na-start">Start here</span>':''}${group.email?`<button type="button" class="na-action${index===0?' na-primary':''}" data-flow-action="resend-email" data-flow-task="${e(group.first.task_key)}">Resend email</button>`:`<a class="na-action${index===0?' na-primary':''}" href="${e(group.href)}" data-flow-task="${e(group.first.task_key)}">${e(group.verb)}</a>`}</div></li>`;
  }
  function render(data,destination=t=>t.destination) {
    const model=build(data,destination),{mine,office}=model;
    // Keep every overdue/today group visible, even when there are more than three.
    const visible=Math.max(3,mine.filter(g=>g.time?.rank<=1).length);
    const onlyOptional=mine.length>0&&mine.every(g=>g.optional);
    const heading=onlyOptional?'Optional follow-up':mine.length?mine.length+' action'+(mine.length===1?'':'s')+' need'+(mine.length===1?'s':'')+' your attention':office.length?'Nothing you need to do right now':'You are up to date';
    const hint=onlyOptional?'Share how your support is going when you are ready.':mine.length?'Start with the first item. Related steps are grouped together.':office.length?'Your outstanding reviews are with the office.':'New requests and anything due will appear here.';
    const activeBookings=new Set(mine.flatMap(g=>g.tasks).map(t=>/[?&]booking=(\d+)/.exec(String(t.destination))?.[1]).filter(Boolean));
    const next=(data.next || []).find(v=>!activeBookings.has(String(v.id)) && (!v.ends_at||Date.parse(v.ends_at)>model.now));
    const urgentOffice=office.filter(g=>g.time?.rank<=1&&g.tasks.some(t=>t.kind==='cover'));
    return `<div class="na-workspace"><div class="na-intro"><div><h2>${e(heading)}</h2><p>${e(hint)}</p></div><button type="button" class="na-refresh" data-flow-action="refresh">Refresh list</button></div><p id="naStatus" role="status" aria-live="polite"></p>
      ${mine.length?`<ol class="na-list">${mine.slice(0,visible).map(taskRow).join('')}</ol>${mine.length>visible?`<details class="na-more"><summary>Show ${mine.length-visible} more action${mine.length-visible===1?'':'s'}</summary><ol class="na-list" start="${visible+1}">${mine.slice(visible).map((g,i)=>taskRow(g,i+visible)).join('')}</ol></details>`:''}`:'<div class="na-clear"><span aria-hidden="true">✓</span><p>No action is currently required from you.</p></div>'}
      ${urgentOffice.map(g=>`<aside class="na-cover"><b>With the office: ${e(g.title)}</b><p>The office is handling this staffing issue. ${dueTag(g.time)}</p><a href="${e(g.href)}">View visit</a> · <a href="#/contact">Contact the office</a></aside>`).join('')}
      ${office.length?`<details class="na-waiting"><summary><span class="na-state" data-tone="waiting">◷ With the office</span><span class="na-count">${office.length} review${office.length===1?'':'s'}</span></summary><p class="na-muted">These checks belong to the office. They are separate from the actions above.</p><ul class="na-wait-list">${office.map(g=>`<li><div><h3>${e(g.title)}</h3><p>${g.items.size} item${g.items.size===1?'':'s'} being reviewed</p>${subitems(g)}</div><a href="${e(g.href)}">${e(g.verb)}</a></li>`).join('')}</ul></details>`:''}
      ${next?`<aside class="na-next-visit"><div><span class="na-muted">${next.starts_at&&Date.parse(next.starts_at)<=model.now?'Current visit':'Next visit'}</span><p><b>${e(dateLabel(next.date))} at ${e(next.start)}</b>${next.other_name?' · '+e(next.other_name):''}</p><span class="na-muted">${next.status==='requested'?'Awaiting confirmation':'Confirmed'} · ${e(next.hours)} hours</span></div><a href="#/journey?panel=shift&booking=${Number(next.id)}">View visit</a></aside>`:''}
      <p class="na-foot">This list is based on your current records. <a href="#/contact">Need help?</a></p></div>`;
  }
  function renderOffice(p,options={}) {
    const view=['office','people','website'].includes(p.view)?p.view:'office',counts=p.counts||{office:p.total,people:0,website:0};
    const names={office:'Office actions',people:'Waiting on people',website:'Website checks'};
    const descriptions={office:'These tasks need an office action. Urgent items appear first.',people:'These tasks belong to participants or workers. The office acts on a request for help.',website:'Website maintenance is separate from care tasks. Healthy automatic checks clear their alerts.'};
    const link=(v,offset=0,search=options.search||'')=>'#/journey?panel=tasks&view='+v+'&offset='+offset+'&search='+encodeURIComponent(search);
    const fallback=t=>({bucket:'office',tone:'action',status:'Action required',icon:'→',subject:t.person,action:'Review documents',next:t.detail||'Review the outstanding items on this person’s file.',destination:'#/admin/verification?role='+(t.person_role==='participant'?'participant':'worker')+'&person='+Number(t.user_id)});
    const rows=p.rows.map(t=>({...t,ui:t.ui||fallback(t)}));
    return `<div class="na-office"><nav class="na-queue-tabs" aria-label="Task responsibility">${Object.entries(names).map(([key,name])=>`<a href="${e(link(key))}"${key===view?' aria-current="page"':''}>${name}<span class="na-queue-count">${Number(counts[key])||0}</span></a>`).join('')}</nav>
    <div class="na-office-bar"><div><h2>${e(names[view])}</h2><p class="na-office-meta">${e(descriptions[view])}</p><p class="na-office-meta">${p.total?`${p.offset+1}–${p.offset+rows.length} of ${p.total} ${view==='people'?'follow-ups':'tasks'}`:'No '+(view==='people'?'follow-ups':'tasks')+(options.search?' match this search': ' in this view')}</p></div>${options.searchForm||''}</div>
    <p class="na-legend"><span class="na-state" data-tone="urgent">! Urgent / overdue</span><span class="na-state" data-tone="action">→ Action required</span><span class="na-state" data-tone="waiting">◷ Waiting</span></p>
    ${rows.length?`<div class="na-office-list">${rows.map(t=>{const ui=t.ui,person=ui.bucket==='people',owner=p.staff?.find(s=>s.id===t.owner_id);return `<article class="na-office-row" data-tone="${e(ui.tone)}"><div class="na-office-line"><div><div class="na-task-labels"><span class="na-state" data-tone="${e(ui.tone)}">${e(ui.icon)} ${e(ui.status)}</span>${!person?'<span class="na-responsibility">Office action</span>':''}${ui.due_date?`<span class="na-office-meta">${ui.timing==='Overdue'?'Was due': 'Due'} ${e(fmtAU(ui.due_date))}</span>`:''}</div><h3>${e(t.label)}</h3><p class="na-subject">${e(ui.subject)}</p><p class="na-next-step"><b>Next step:</b> ${e(ui.next)}</p>${!person?`<p class="na-office-meta">${owner?'Owner: '+e(owner.name):'Any office reviewer can start this task.'}</p>`:''}</div><a class="na-action" href="${e(safe(ui.destination))}" aria-label="${e(ui.action+' — '+ui.subject)}">${e(ui.action)}</a></div>${person?'':`<details><summary>Details & assignment</summary><p class="na-office-meta">Added ${e(new Date(t.ready_at).toLocaleString('en-AU'))}</p>${options.assignment?.(t)||''}</details>`}</article>`;}).join('')}</div>`:`<div class="na-clear"><span aria-hidden="true">${options.search?'⌕':'✓'}</span><p>${options.search?'Try a different search or another view.':view==='office'?'No office action is currently required.':view==='people'?'No participant or worker follow-ups are outstanding.':'No website alerts currently need attention.'}</p></div>`}
    <div class="na-pagination">${p.offset?`<a class="na-action" href="${e(link(view,Math.max(0,p.offset-100)))}">Previous</a>`:''}${p.offset+rows.length<p.total?`<a class="na-action" href="${e(link(view,p.offset+100))}">Next</a>`:''}</div></div>`;
  }
  return {render,renderOffice};
})();
