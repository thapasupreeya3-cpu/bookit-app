#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'RELEASE-FILES.json'),'utf8'));
if(manifest.release!==require('../package.json').version||!manifest.files||manifest.format!=='full-source')throw Error('The release manifest does not identify this full-source package.');
let count=0;
for(const [name,record] of Object.entries(manifest.files)){
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.lstatSync(file).isFile())throw Error('Invalid manifest file: '+name);
  const sha=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(sha!==record.sha256)throw Error('Release hash mismatch: '+name);
  count++;
}
console.log(`release payload: ${count}/${count} file hashes match v${manifest.release}`);
