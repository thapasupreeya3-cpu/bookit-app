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
function queue(db,{view='office',search='',offset=0,today,as_of}){
 view=['office','people','website'].includes(view)?view:'office';
 offset=Math.max(0,Math.floor(Number(offset)||0));
 const rows=db.prepare("SELECT t.*,u.name AS person,u.role AS person_role FROM journey_tasks t JOIN users u ON u.id=t.user_id WHERE t.state<>'completed'").all().map(t=>({...t,ui:describe(t,{today,as_of})}));
 const counts={office:0,people:0,website:0};for(const t of rows)counts[t.ui.bucket]++;
 const term=search.toLocaleLowerCase();
 const selected=rows.filter(t=>t.ui.bucket===view&&(!term||[t.ui.subject,t.label,t.detail,t.ui.action,t.ui.status].some(v=>String(v||'').toLocaleLowerCase().includes(term))));
 selected.sort((a,b)=>a.ui.rank-b.ui.rank||String(a.due_at||'9999').localeCompare(String(b.due_at||'9999'))||a.ready_at.localeCompare(b.ready_at)||a.task_key.localeCompare(b.task_key));
 // Clamp an old pagination link when tasks resolve between visits.
 offset=Math.min(offset,Math.max(0,Math.floor((selected.length-1)/100)*100));
 return {rows:selected.slice(offset,offset+100),total:selected.length,offset,view,counts,today,as_of};
}
module.exports={bucket,describe,queue};
