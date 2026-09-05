#!/usr/bin/env node
'use strict';
// Compile application JavaScript, including inline scripts. Do not execute it.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');let count=0,failed=0;
function check(file,source){try{new vm.Script(source,{filename:file});count++;}catch(e){failed++;console.error(e.stack);}}
for(const dir of ['lib','scripts','tests'])for(const name of fs.readdirSync(path.join(ROOT,dir)))if(name.endsWith('.js'))check(dir+'/'+name,fs.readFileSync(path.join(ROOT,dir,name),'utf8'));
check('server.js',fs.readFileSync(path.join(ROOT,'server.js'),'utf8'));
for(const name of fs.readdirSync(path.join(ROOT,'public/assets')))if(name.endsWith('.js'))check('public/assets/'+name,fs.readFileSync(path.join(ROOT,'public/assets',name),'utf8'));
const html=fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8');let n=0;
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
 if(/\bsrc\s*=/.test(m[1])||/\btype\s*=\s*["'](?:application\/ld\+json|application\/json)/i.test(m[1]))continue;
 check('public/index.html:inline-'+(++n),m[2]);
}
console.log(`syntax: ${count} scripts compiled, ${failed} failed (${n} inline application scripts)`);process.exitCode=failed?1:0;
