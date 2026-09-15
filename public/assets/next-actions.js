'use strict';
/* Presentation groups do not complete, dismiss or reassign the underlying tasks. */
window.CareNextActions = (() => {
  const e = value => esc(String(value ?? ''));
  const safe = href => /^#\/(?!\/)/.test(String(href || '')) ? href : '#/contact';
  const suffix = task => String(task.task_key || '').replace(/^\d+:/,'');
  // Older stored tasks name a broad office page. Resolve only those generic
  // destinations, using record identifiers rather than names or label text.
  function officeDestination(task, destination) {
    const href=String(destination||task.destination||''),generic=/^#\/admin\/compliance\/?$/.test(href);
    const positive=value=>/^\d+$/.test(String(value??''))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
    if(generic&&task.kind==='incident'){
      const id=positive(task.incident_id)||positive(task.entity_id)||positive(/(?:^|:)incident:(\d+)(?::|$)/.exec(String(task.task_key||''))?.[1])||positive(/^(?:incident:)?(\d+)$/.exec(String(task.ref||''))?.[1]);
      return id?'#/admin/assurance?incident='+id:'#/admin/records?section=incidents';
    }
    if(generic&&['document','renewal','setup'].includes(task.kind)){
      const role=task.person_role==='participant'?'participant':task.person_role==='worker'?'worker':null;
      if(role){const id=positive(task.user_id);return '#/admin/verification?role='+role+(id?'&person='+id:'');}
    }
    if(href==='#/admin/operations'&&['job','operations'].includes(task.kind))return '#/admin/assurance?tab=operations';
    if(task.kind==='invoice'&&/(?:^|:)receipt:\d+(?::|$)/.test(String(task.task_key||''))&&href.startsWith('#/journey?')){
      const params=new URLSearchParams(href.split('?')[1]);
      if(params.get('panel')==='finance'&&!params.has('section')){params.set('section','history');return '#/journey?'+params.toString();}
    }
    return href;
  }
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
  function officeCategory(t){
    const key=String(t.task_key||''),href=String(t.destination||'');
    if(/(?:^|:)training:|#\/account\/training/.test(key+' '+href)||t.kind==='training')return ['training','Training'];
    if(['invoice','payroll'].includes(t.kind)||/#\/invoice\?|panel=(?:finance|payroll)/.test(href))return ['money','Invoices & pay'];
    if(['booking','shift','review','cover','followup'].includes(t.kind))return ['visits','Bookings & visits'];
    if(['document','renewal'].includes(t.kind)||/#\/account\/(?:credentials|documents)/.test(href))return ['documents','Documents & checks'];
    if(t.kind==='recruitment')return ['application','Application'];
    if(['incident','safeguarding','transition'].includes(t.kind))return ['support','Support & safety'];
    if(['operations','job','delivery'].includes(t.kind))return ['operations','Office & website'];
    return ['details','Profile & setup'];
  }
  function officeCompactRow(t,p,options){
    const ui=t.ui,person=ui.bucket==='people',owner=p.staff?.find(s=>s.id===t.owner_id);
    return `<article class="na-office-row na-person-task" data-tone="${e(ui.tone)}"><div class="na-office-line"><div><h3>${e(t.label)}</h3><div class="na-task-labels"><span class="na-state" data-tone="${e(ui.tone)}">${e(ui.icon)} ${e(ui.status)}</span>${ui.due_date?`<span class="na-office-meta">${ui.timing==='Overdue'?'Was due':'Due'} ${e(fmtAU(ui.due_date))}</span>`:''}</div><p class="na-next-step"><b>Next step:</b> ${e(ui.next)}</p></div><a class="na-action" href="${e(safe(ui.destination))}" aria-label="${e(ui.action+' — '+t.label)}">${e(ui.action)}</a></div>${person?'':`<details><summary>${owner?'Assigned to '+e(owner.name):'Details & assignment'}</summary><p class="na-office-meta">${owner?'Owner: '+e(owner.name):'Any office reviewer can start this task.'} Added ${e(new Date(t.ready_at).toLocaleString('en-AU'))}</p>${options.assignment?.(t)||''}</details>`}</article>`;
  }
  function renderOfficePeople(p,options,rows){
    const view=p.view,names={office:'Office actions',people:'Waiting on people',website:'Website checks'},counts=p.counts||{},people=p.people||[];
    const selected=people.find(x=>x.key===p.selected_person),roleLabel=role=>({worker:'Worker',participant:'Participant',coordinator:'Helper',system:'Shared tasks'}[role]||'Person');
    const href=(patch={})=>{const values={panel:'tasks',view,offset:p.offset||0,search:options.search||'',person:p.selected_person||'',category:options.category||'',task_page:options.taskPage>1?options.taskPage:'',...patch};return '#/journey?'+Object.entries(values).filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');};
    const categories=new Map();for(const t of rows){const [key,label]=officeCategory(t);if(!categories.has(key))categories.set(key,{key,label,rows:[]});categories.get(key).rows.push(t);}
    const term=String(options.search||'').trim().toLocaleLowerCase(),matches=t=>!term||[selected?.name,selected?.role,t.ui.subject,t.label,t.detail,t.ui.action,t.ui.status].some(v=>String(v||'').toLocaleLowerCase().includes(term));
    const groups=[...categories.values()],category=categories.get(options.category)||(term?groups.find(g=>g.rows.some(matches)):null)||groups[0],size=8,pages=Math.max(1,Math.ceil((category?.rows.length||0)/size)),firstMatch=category?.rows.findIndex(matches)??-1,defaultPage=term&&!options.category&&firstMatch>=0?Math.floor(firstMatch/size)+1:1,taskPage=Math.min(pages,Math.max(1,Math.floor(Number(options.taskPage)||defaultPage))),start=(taskPage-1)*size;
    const personSize=Number(p.page_size)||12,personTotal=Number(p.person_total)||0,tabId=key=>'na-person-'+String(key).replace(/[^a-zA-Z0-9_-]/g,'-');
    const descriptions={office:'Choose a person to see the office actions for their record.',people:'Choose a worker or participant to see their outstanding steps. The office acts when they ask for help.',website:'Automatic website alerts are kept together here.'};
    const nextOffset=Number(p.offset)+people.length;
    return `<div class="na-office na-grouped-office"><nav class="na-queue-tabs" aria-label="Task responsibility">${Object.entries(names).map(([key,name])=>`<a href="${e(href({view:key,offset:0,person:null,category:null,task_page:null}))}"${key===view?' aria-current="page"':''}>${e(name)}<span class="na-queue-count">${Number(counts[key])||0}</span></a>`).join('')}</nav><div class="na-office-bar"><div><h2>${e(names[view])}</h2><p class="na-office-meta">${e(descriptions[view])}</p><p class="na-office-meta" role="status">${personTotal?`${Number(p.offset)+1}–${nextOffset} of ${personTotal} ${view==='website'?'groups':'tabs'} · ${Number(p.task_total)||0} outstanding tasks`:'No outstanding tasks'+(options.search?' match this search':' in this view')}</p></div>${options.searchForm||''}</div>${options.search?`<p class="na-office-meta">Search: <b>${e(options.search)}</b> · <a href="${e(href({search:null,person:null,offset:0,category:null,task_page:null}))}">Clear search</a></p>`:''}${p.selection_changed?'<p class="na-selection-notice" role="status">The previous selection is no longer in this view. The current matching records are shown below.</p>':''}
      ${people.length?`<div class="na-person-tabs" role="tablist" aria-label="People with outstanding tasks" data-na-person-tabs>${people.map(person=>`<a role="tab" id="${e(tabId(person.key))}" data-na-person-tab="${e(person.key)}" aria-controls="na-person-panel" aria-selected="${person.key===p.selected_person?'true':'false'}" tabindex="${person.key===p.selected_person?'0':'-1'}" href="${e(href({person:person.key,category:null,task_page:null}))}"><span class="na-person-name">${e(person.name)}</span><span class="na-person-tab-meta">${e(roleLabel(person.role))}${person.user_id?' · #'+Number(person.user_id):''}<b>${Number(person.total)||0} task${Number(person.total)===1?'':'s'}</b>${Number(person.urgent)>0?`<span class="na-person-urgent">${Number(person.urgent)} urgent / overdue</span>`:''}</span></a>`).join('')}</div>${personTotal>personSize?`<nav class="na-pagination" aria-label="People pages">${p.offset>0?`<a class="na-action" href="${e(href({offset:Math.max(0,p.offset-personSize),person:null,category:null,task_page:null}))}">Previous people</a>`:''}<span class="na-office-meta">Page ${Math.floor(p.offset/personSize)+1} of ${Math.ceil(personTotal/personSize)}</span>${nextOffset<personTotal?`<a class="na-action" href="${e(href({offset:p.offset+personSize,person:null,category:null,task_page:null}))}">Next people</a>`:''}</nav>`:''}`:''}
      ${selected?`<section id="na-person-panel" class="na-person-panel" role="tabpanel" tabindex="0" aria-labelledby="${e(tabId(selected.key))}"><div class="na-person-heading"><div><h2>${e(selected.name)}</h2><p class="na-office-meta">${e(roleLabel(selected.role))} · ${Number(selected.total)||0} outstanding task${Number(selected.total)===1?'':'s'} in ${e(names[view].toLowerCase())}</p></div>${selected.user_id&&['worker','participant'].includes(selected.role)?`<a class="na-action" href="#/admin/verification?role=${e(selected.role)}&amp;person=${Number(selected.user_id)}">View ${e(selected.role)} profile</a>`:''}</div>${options.search?`<p class="na-office-meta">${Number(selected.matched)||0} task${Number(selected.matched)===1?' matches':'s match'} your search. All ${Number(selected.total)||0} outstanding tasks for this person in this view are available below.</p>`:''}<nav class="na-category-tabs" aria-label="Task categories">${groups.map(g=>`<a data-na-category="${e(g.key)}" href="${e(href({category:g.key,task_page:null}))}"${g===category?' aria-current="page"':''}>${e(g.label)} <span class="na-queue-count">${g.rows.length}</span></a>`).join('')}</nav>${category?`<div class="na-person-category"><h3 class="na-category-heading">${e(category.label)}</h3><p class="na-office-meta" role="status">${start+1}–${Math.min(start+size,category.rows.length)} of ${category.rows.length} tasks</p><div class="na-office-list">${category.rows.slice(start,start+size).map(t=>officeCompactRow(t,p,options)).join('')}</div>${pages>1?`<nav class="na-pagination" aria-label="Task pages">${taskPage>1?`<a class="na-action" href="${e(href({category:category.key,task_page:taskPage-1}))}">Previous tasks</a>`:''}<span class="na-office-meta">Page ${taskPage} of ${pages}</span>${taskPage<pages?`<a class="na-action" href="${e(href({category:category.key,task_page:taskPage+1}))}">More tasks</a>`:''}</nav>`:''}</div>`:'<p>No outstanding tasks remain for this selection.</p>'}</section>`:`<div class="na-clear"><span aria-hidden="true">${options.search?'⌕':'✓'}</span><p>${options.search?'Try a different search or another view.':view==='office'?'No office action is currently required.':view==='people'?'No participant or worker follow-ups are outstanding.':'No website alerts currently need attention.'}</p></div>`}</div>`;
  }
  function bindOfficeTabs(root){
    const tabs=root?.querySelector('[data-na-person-tabs]');if(!tabs)return;
    tabs.addEventListener('keydown',event=>{const current=event.target.closest('[data-na-person-tab]');if(!current||!tabs.contains(current))return;const items=[...tabs.querySelectorAll('[data-na-person-tab]')],index=items.indexOf(current);let next;
      if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%items.length;else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index+items.length-1)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;else if(event.key===' '){event.preventDefault();current.click();return;}else return;
      event.preventDefault();items.forEach((item,i)=>item.tabIndex=i===next?0:-1);items[next].focus();
    });
  }
  function renderOffice(p,options={}) {
    const view=['office','people','website'].includes(p.view)?p.view:'office',counts=p.counts||{office:p.total,people:0,website:0};
    const names={office:'Office actions',people:'Waiting on people',website:'Website checks'};
    const descriptions={office:'These tasks need an office action. Urgent items appear first.',people:'These tasks belong to participants or workers. The office acts on a request for help.',website:'Website maintenance is separate from care tasks. Healthy automatic checks clear their alerts.'};
    const link=(v,offset=0,search=options.search||'')=>'#/journey?panel=tasks&view='+v+'&offset='+offset+'&search='+encodeURIComponent(search);
    const fallback=t=>({bucket:'office',tone:'action',status:'Action required',icon:'→',subject:t.person,action:t.kind==='incident'?'Review incident':['document','renewal','setup'].includes(t.kind)?'Review documents':'Review task',next:t.detail||'Open the task and complete the outstanding step.',destination:'#/admin/verification?role='+(t.person_role==='participant'?'participant':'worker')+'&person='+Number(t.user_id)});
    const rows=p.rows.map(t=>{const ui=t.ui||fallback(t),destination=officeDestination(t,t.ui?.destination||t.destination||ui.destination);return {...t,ui:{...ui,destination}};});
    if(p.pagination==='people')return renderOfficePeople({...p,view},options,rows);
    return `<div class="na-office"><nav class="na-queue-tabs" aria-label="Task responsibility">${Object.entries(names).map(([key,name])=>`<a href="${e(link(key))}"${key===view?' aria-current="page"':''}>${name}<span class="na-queue-count">${Number(counts[key])||0}</span></a>`).join('')}</nav>
    <div class="na-office-bar"><div><h2>${e(names[view])}</h2><p class="na-office-meta">${e(descriptions[view])}</p><p class="na-office-meta">${p.total?`${p.offset+1}–${p.offset+rows.length} of ${p.total} ${view==='people'?'follow-ups':'tasks'}`:'No '+(view==='people'?'follow-ups':'tasks')+(options.search?' match this search': ' in this view')}</p></div>${options.searchForm||''}</div>
    <p class="na-legend"><span class="na-state" data-tone="urgent">! Urgent / overdue</span><span class="na-state" data-tone="action">→ Action required</span><span class="na-state" data-tone="waiting">◷ Waiting</span></p>
    ${rows.length?`<div class="na-office-list">${rows.map(t=>{const ui=t.ui,person=ui.bucket==='people',owner=p.staff?.find(s=>s.id===t.owner_id);return `<article class="na-office-row" data-tone="${e(ui.tone)}"><div class="na-office-line"><div><div class="na-task-labels"><span class="na-state" data-tone="${e(ui.tone)}">${e(ui.icon)} ${e(ui.status)}</span>${!person?'<span class="na-responsibility">Office action</span>':''}${ui.due_date?`<span class="na-office-meta">${ui.timing==='Overdue'?'Was due': 'Due'} ${e(fmtAU(ui.due_date))}</span>`:''}</div><h3>${e(t.label)}</h3><p class="na-subject">${e(ui.subject)}</p><p class="na-next-step"><b>Next step:</b> ${e(ui.next)}</p>${!person?`<p class="na-office-meta">${owner?'Owner: '+e(owner.name):'Any office reviewer can start this task.'}</p>`:''}</div><a class="na-action" href="${e(safe(ui.destination))}" aria-label="${e(ui.action+' — '+ui.subject)}">${e(ui.action)}</a></div>${person?'':`<details><summary>Details & assignment</summary><p class="na-office-meta">Added ${e(new Date(t.ready_at).toLocaleString('en-AU'))}</p>${options.assignment?.(t)||''}</details>`}</article>`;}).join('')}</div>`:`<div class="na-clear"><span aria-hidden="true">${options.search?'⌕':'✓'}</span><p>${options.search?'Try a different search or another view.':view==='office'?'No office action is currently required.':view==='people'?'No participant or worker follow-ups are outstanding.':'No website alerts currently need attention.'}</p></div>`}
    <div class="na-pagination">${p.offset?`<a class="na-action" href="${e(link(view,Math.max(0,p.offset-100)))}">Previous</a>`:''}${p.offset+rows.length<p.total?`<a class="na-action" href="${e(link(view,p.offset+100))}">Next</a>`:''}</div></div>`;
  }
  return {render,renderOffice,bindOfficeTabs};
})();
