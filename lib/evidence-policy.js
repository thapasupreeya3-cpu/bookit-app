'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const workerMethods={'sighted-original':'Sighted the original','sighted-copy':'Checked a copy','issuer-register':'Checked the issuing register','issuer-confirmed':'Confirmed with the issuer','other':'Other method'};
function revision(d){let file=null;try{if(d.file_path){const s=fs.statSync(d.file_path);file=[s.size,s.mtimeMs];}}catch{file='missing';}
 return crypto.createHash('sha256').update(JSON.stringify([d.id,d.worker_id||d.participant_id,d.doc_type||d.form_key,d.file_path,file,d.expiry_date,d.check_number,d.accepted_at,d.verified_at,d.review_state,d.review_note,d.verify_note])).digest('hex');}
function validate(d,b,methods=workerMethods){
 const error=(message,status=409)=>({message,status});
 if(b.evidence_revision!==revision(d))return error('This evidence changed or has not been opened for review. Reload the person’s verification file.');
 if(b.confirm!==true)return error('Confirm that you reviewed this evidence.',400);
 if(!Object.hasOwn(methods,b.method))return error('Choose how you checked this evidence.',400);
 if(String(b.note||'').trim().length<10)return error('Record your review evidence in at least 10 characters.',400);
 if(['superseded','rejected'].includes(d.review_state))return error('This evidence has been superseded or returned. Review the replacement.');
 if(!d.accepted_at&&(!d.file_path||!fs.existsSync(d.file_path)))return error('There is no uploaded file or recorded agreement to verify. Request the evidence first.');
 const today=new Date();const ymd=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
 if(d.expiry_date&&d.expiry_date<ymd&&b.expired_ack!==true)return error('Acknowledge the expired evidence. Verification will not make it current.');
 if(['issuer-register','issuer-confirmed'].includes(b.method)&&String(b.ref||'').trim().length<4)return error('Record the issuer or register reference you checked.',400);
 return null;
}
module.exports={revision,validate,workerMethods};
