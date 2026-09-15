'use strict';
// Describe responsibility and urgency without changing task completion or permissions.
const T=require('./booking-time');
const siteKey=t=>/(?:^|:)ops:(?:certificate|backup|storage:|job:)/.test(t.task_key)||t.kind==='job';
const bucket=t=>t.owner_kind==='person'?'people':siteKey(t)?'website':'office';
const safe=v=>/^#\/(?!\/)/.test(String(v||''))?v:'#/admin/assurance';
function describe(t,{today,as_of}){
 const group=bucket(t),person=t.person_role==='participant'?'Participant':'Worker';
 const system=String(t.task_key).startsWith('office:');
 const href=safe(t.destination),record='#/admin/verification?role='+(t.person_role==='participant'?'participant':'worker')+'&person='+Number(t.user_id);
 let action='Review task',destination=system?href:record,next=t.detail||'Open the task and complete the outstanding step.';
 if(group==='people'){action='View '+person.toLowerCase();destination=record;next=t.kind==='followup'?'The participant can share feedback from Next actions. The office acts if they ask for help.':person+' action: '+(t.detail||t.label);}
 else if(t.kind==='recruitment'){action='Review application';destination='#/journey?panel=recruitment&worker='+Number(t.user_id);}
 else if(t.kind==='transition'){action='Review support request';destination='#/journey?panel=transitions';}
 else if(['document','renewal','setup'].includes(t.kind)){action='Review documents';destination=record;}
 else if(t.kind==='delivery'||/(?:ops:mail:)/.test(t.task_key)){action='Check delivery';destination='#/journey?panel=deliveries';}
 else if(t.kind==='payroll')action='Review pay batch';
 else if(t.kind==='invoice')action='Review payment';
 else if(t.kind==='safeguarding')action='Review arrangements';
 else if(t.kind==='incident'||/ops:incident:/.test(t.task_key)){action='Review incident';}
 else if(t.kind==='cover'||/ops:request:/.test(t.task_key)){action='Review visit';destination=href;}
 else if(/certificate/.test(t.task_key)){action='Check website security';next=t.detail;}
 else if(/backup/.test(t.task_key))action='Check backup';
 else if(/storage:/.test(t.task_key))action='Check storage';
 else if(t.kind==='job'||/ops:job:/.test(t.task_key))action='Check background task';
 else if(/panel=shift&/.test(href)){action=t.kind==='review'?'Review timesheet':'Review visit';destination=href;}
 const date=String(t.due_at||'').slice(0,10),hasDue=T.validDate(date);
 const timed=['booking','cover','incident','safeguarding','operations'].includes(t.kind)&&String(t.due_at).includes('T');
 const stamp=Date.parse(t.due_at),due=hasDue&&timed&&Number.isFinite(stamp)?new Intl.DateTimeFormat('en-CA',{timeZone:process.env.TZ||'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp)):date;
 const overdue=hasDue&&(timed?Date.parse(t.due_at)<Date.parse(as_of):due<today);
 const critical=/ops:certificate/.test(t.task_key)&&/invalid|expired/i.test(t.label);
 const urgent=overdue||critical;
 let tone=group==='people'?'waiting':urgent?'urgent':'action';
 let status=group==='people'?'Waiting on '+person.toLowerCase():urgent?(overdue?'Overdue':'Urgent'):'Action required';
 if(group!=='people'&&!urgent&&hasDue&&due===today)status='Due today';
 return {bucket:group,tone,status,icon:tone==='urgent'?'!':tone==='waiting'?'◷':'→',action,destination,next,
   subject:system?(group==='website'?'The Care Web website':'Office operations'):t.person,
   responsibility:group==='people'?person:'Office',due_date:hasDue?due:null,
   timing:overdue?'Overdue':hasDue&&due===today?'Due today':hasDue?'Due '+due:'',
   rank:urgent?0:hasDue&&due===today?1:2};
}
const compare=(a,b)=>a.ui.rank-b.ui.rank||String(a.due_at||'9999').localeCompare(String(b.due_at||'9999'))||String(a.ready_at||'').localeCompare(String(b.ready_at||''))||a.task_key.localeCompare(b.task_key);
function personQueue(rows,{view,term,offset,person,counts,today,as_of}){
 const groups=new Map();
 for(const task of rows.filter(t=>t.ui.bucket===view).sort(compare)){
  const system=String(task.task_key).startsWith('office:'),role=system?'system':String(task.person_role||'person'),key=system?'system:'+view:role+':'+Number(task.user_id);
  if(!groups.has(key))groups.set(key,{key,user_id:system?null:Number(task.user_id),role,name:system?(view==='website'?'The Care Web website':'Office operations'):task.person||'Unnamed person',tasks:[]});
  groups.get(key).tasks.push(task);
 }
 const matched=(task,g)=>!term||[g.name,g.role,task.ui.subject,task.label,task.detail,task.ui.action,task.ui.status].some(v=>String(v||'').toLocaleLowerCase().includes(term));
 const selected=[...groups.values()].map(g=>({...g,matched:g.tasks.filter(t=>matched(t,g)).length})).filter(g=>g.matched);
 const size=12,requested=String(person||''),index=selected.findIndex(g=>g.key===requested);
 offset=Math.min(Math.floor(offset/size)*size,Math.max(0,Math.floor((selected.length-1)/size)*size));
 // A direct person link opens that person's page; a resolved or filtered-out link
 // falls back to the first person on the current page and reports the change.
 if(index>=0)offset=Math.floor(index/size)*size;
 const page=selected.slice(offset,offset+size),current=index>=0?selected[index]:page[0];
 const people=page.map(({tasks,matched,...g})=>({...g,total:tasks.length,matched,urgent:tasks.filter(t=>t.ui.rank===0).length,earliest_due:tasks.map(t=>t.ui.due_date).filter(Boolean).sort()[0]||null}));
 const taskTotal=selected.reduce((n,g)=>n+g.tasks.length,0);
 return {rows:current?.tasks||[],people,selected_person:current?.key||null,selection_changed:!!requested&&current?.key!==requested,person_total:selected.length,task_total:taskTotal,total:taskTotal,offset,page_size:size,pagination:'people',group:'person',view,counts,today,as_of};
}
function queue(db,{view='office',search='',offset=0,group='',person='',today,as_of}){
 view=['office','people','website'].includes(view)?view:'office';
 offset=Number.isFinite(Number(offset))?Math.max(0,Math.floor(Number(offset))):0;
 const rows=db.prepare("SELECT t.*,u.name AS person,u.role AS person_role FROM journey_tasks t JOIN users u ON u.id=t.user_id WHERE t.state<>'completed'").all().map(t=>({...t,ui:describe(t,{today,as_of})}));
 const counts={office:0,people:0,website:0};for(const t of rows)counts[t.ui.bucket]++;
 const term=String(search||'').trim().toLocaleLowerCase();
 if(group==='person')return personQueue(rows,{view,term,offset,person,counts,today,as_of});
 const selected=rows.filter(t=>t.ui.bucket===view&&(!term||[t.ui.subject,t.label,t.detail,t.ui.action,t.ui.status].some(v=>String(v||'').toLocaleLowerCase().includes(term))));
 selected.sort(compare);
 // Clamp an old pagination link when tasks resolve between visits.
 offset=Math.min(offset,Math.max(0,Math.floor((selected.length-1)/100)*100));
 return {rows:selected.slice(offset,offset+100),total:selected.length,offset,view,counts,today,as_of};
}
module.exports={bucket,describe,queue};
