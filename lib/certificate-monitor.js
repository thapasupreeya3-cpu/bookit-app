'use strict';
// Checks the configured public origin only. No account, document or request data is sent.
const tls=require('node:tls'),dns=require('node:dns').promises,net=require('node:net');
const DAY=86400000,HOUR=3600000;
const blocked=new net.BlockList();
for(const [ip,bits]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
const publicIP=ip=>net.isIP(ip)===4?!blocked.check(ip,'ipv4'):net.isIP(ip)===6&&/^2[0-9a-f]{3}:/i.test(ip)&&!/^2001:(?:0:|db8:)/i.test(ip);
function target(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||net.isIP(u.hostname)||!u.hostname.includes('.')||/\.(?:localhost|local|internal|test|invalid)$/i.test(u.hostname))return null;return u.hostname;}catch{return null;}}
async function probe(host,{lookup=dns.lookup,connect=tls.connect,timeout=8000}={}){
 let timer,socket,closed=false;
 const work=(async()=>{
   const addresses=await lookup(host,{all:true,verbatim:true});
   if(closed)throw Error('Check timed out.');
   if(!addresses.length||addresses.some(x=>!publicIP(x.address)))throw Error('Public hostname could not be safely resolved.');
   return new Promise((resolve,reject)=>{
     // Pin the checked address. SNI and hostname verification still use the public hostname.
     socket=connect({host:addresses[0].address,port:443,servername:host,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>tls.checkServerIdentity(host,cert)},()=>{
       if(!socket.authorized)return reject(Error('Certificate could not be trusted.'));
       const cert=socket.getPeerCertificate(),expiry=Date.parse(cert.valid_to);
       if(!Number.isFinite(expiry))return reject(Error('Certificate expiry was unavailable.'));
       resolve({expires_at:new Date(expiry).toISOString(),issuer:String(cert.issuer?.O||cert.issuer?.CN||'').slice(0,200),fingerprint:cert.fingerprint256||''});
     });socket.once('error',reject);
   });
 })();
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{const e=Error('Connection timed out.');e.code='ETIMEDOUT';reject(e);},timeout);})]);}
 finally{closed=true;clearTimeout(timer);socket?.destroy();}
}
module.exports=function(c,options={}){
 const clock=options.clock||Date.now,check=options.probe||probe,hostname=target(c.appUrl);let inFlight;
 const read=()=>{try{const s=JSON.parse(c.setting('certificate_monitor','{}'));return s.hostname===hostname?s:{};}catch{return {};}};
 const write=s=>c.setSetting('certificate_monitor',JSON.stringify(s));
 function status(){
   const s=read(),age=clock()-Date.parse(s.checked_at||''),days=(Date.parse(s.expires_at||'')-clock())/DAY;
   let state=!hostname?'setup':!s.checked_at?'pending':s.state;
   if(s.expires_at&&days<=0)state='invalid';
   else if(state==='healthy'&&days<=14)state='expiring';
   if(Number.isFinite(age)&&age>2*DAY&&state!=='invalid')state='stale';
   const labels={setup:'Website address needed',pending:'Automatic check scheduled',healthy:'Website security checked',expiring:'Certificate renewal due soon',invalid:'Website certificate invalid or expired',retry:'Automatic check retrying',unavailable:'Automatic security check needs attention',stale:'Automatic security check is out of date'};
   return {...s,hostname,state,label:labels[state],tone:state==='healthy'?'complete':state==='invalid'?'urgent':['pending','retry'].includes(state)?'waiting':'action',next_at:s.next_at||null};
 }
 async function run(){
   if(!hostname)return status();const old=read();if(Date.parse(old.next_at||'')>clock())return status();
   try{
     const result=await check(hostname);if(!Number.isFinite(Date.parse(result.expires_at)))throw Error('Certificate expiry was unavailable.');
     write({hostname,...result,state:Date.parse(result.expires_at)<=clock()?'invalid':Date.parse(result.expires_at)-clock()<=14*DAY?'expiring':'healthy',checked_at:new Date(clock()).toISOString(),last_ok:new Date(clock()).toISOString(),next_at:new Date(clock()+DAY).toISOString(),failures:0,error:''});
   }catch(e){
     const failures=(old.failures||0)+1,invalid=/CERT|TLS_CERT|SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(String(e.code));
     write({...old,hostname,state:invalid?'invalid':failures>=3?'unavailable':'retry',checked_at:new Date(clock()).toISOString(),next_at:new Date(clock()+HOUR).toISOString(),failures,error:invalid?'The certificate failed trust, hostname or validity checks.':'The public website could not be checked. The system will retry automatically.'});
   }
   return status();
 }
 const tick=()=>{if(!inFlight)inFlight=run().finally(()=>{inFlight=null;});return inFlight;};
 function alert(){const s=status();if(['healthy','pending','retry'].includes(s.state))return null;return {key:'certificate',title:s.label,detail:s.state==='setup'?'Set APP_URL to the public HTTPS website address in hosting settings. Monitoring starts automatically.':s.state==='invalid'?'Ask the hosting provider to restore a valid website certificate. Automatic checks continue and clear this alert after recovery.':s.state==='expiring'?'Ask the hosting provider to confirm automatic renewal before '+s.expires_at.slice(0,10)+'. Monitoring continues automatically.':'The automatic check could not confirm website security. Ask the hosting provider to check the domain and outbound connection. The system keeps retrying.',due_at:s.state==='expiring'?s.expires_at:null};}
 return {tick,status,alert};
};
module.exports.probe=probe;module.exports.target=target;module.exports.publicIP=publicIP;
