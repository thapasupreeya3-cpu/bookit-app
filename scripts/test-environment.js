'use strict';
// Tests must never inherit production integrations or secret providers.
module.exports=function testEnvironment(base=process.env){const env={...base};
 for(const key of Object.keys(env))if(/^(SMTP_|RESEND_|STRIPE_|AI_|SCOPE_PARTNER_|BOOKIT_SECRET|BOOKIT_SESSION_SECRET)/.test(key)||['SECRET','SESSION_SECRET','ADMIN_EMAILS','SITE_PASSWORD','STRICT_PROD','ADMIN_MFA_REQUIRED'].includes(key))delete env[key];
 return {...env,NODE_ENV:'',AUTO_REPLY:'off'};
};
