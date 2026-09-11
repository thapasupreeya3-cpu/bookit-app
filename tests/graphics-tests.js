'use strict';
/* Presentation and brand checks for the design that actually ships (v88.1.x): the navy,
   gold and silver logo on the original animated site. No server, no external library.
   Rewritten in v88.1.4 (audit F11): the earlier version measured the reverted v88.0.0
   redesign; this one measures what is live, and runs as part of `npm test`. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),
 bytes=p=>fs.readFileSync(path.join(root,p)),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),exists=p=>fs.existsSync(path.join(root,p));
const html=read('public/index.html'),server=read('server.js');
const baseline=JSON.parse(read('docs/graphics-baseline.json'));let total=0,failed=0;
function t(name,ok,detail){total++;if(!ok)failed++;console.log((ok?'PASS  ':'FAIL  ')+name+(ok||!detail?'':'  ('+detail+')'));}
/* the page's structure the design must not disturb */
const routes=/const ROUTES = \{[\s\S]*?\n\};/.exec(html)?.[0];
t('existing route map remains with one additive journey route',hash((routes||'').replace("\n  '/journey': 'page-journey',",''))===baseline.route_map_sha256);
const ids=[...new Set([...html.matchAll(/id="(page-[\w-]+)"/g)].map(m=>m[1]))].sort();
t('all page containers remain',JSON.stringify(ids.filter(id=>id!=='page-journey'))===JSON.stringify(baseline.page_ids));
for(const id of ['heroSearch','heroSearchInput','homeServices','allServices','homeWorkers','homeFaq','workerGrid','mainNav','burger','navClose','a11yOpen','a11yPanel','btnLogin'])t('interactive element present: #'+id,html.includes('id="'+id+'"'));
/* the logo: the approved artwork, in the places it belongs */
const ident=JSON.parse(read('public/assets/careweb/identity-source.json'));
for(const [file,info]of Object.entries(ident.crops))t('approved logo artwork: '+file,exists('public/assets/careweb/'+file)&&hash(bytes('public/assets/careweb/'+file))===info.sha256);
t('logo lockup in the header and the footer',(html.match(/class="logo cw-brand"/g)||[]).length===2);
t('the footer uses the reversed (white) marks',html.includes('logo-icon-reverse.png')&&html.includes('logo-wordmark-reverse.png'));
t('one accessible label per lockup',(html.match(/aria-label="The Care Web — home"/g)||[]).length===2);
t('favicon, touch icon and install manifest are linked',/rel="icon"[^>]*favicon-32\.png/.test(html)&&html.includes('apple-touch-icon.png')&&html.includes('site.webmanifest'));
t('social card is the brand card',html.includes('/assets/careweb/social-card.png'));
const manifest=JSON.parse(read('public/assets/careweb/site.webmanifest'));
t('install manifest names the brand and the tagline',manifest.name==='The Care Web'&&manifest.description==='Support lives here.');
t('all manifest icons are local and present',manifest.icons.every(i=>i.src.startsWith('/assets/careweb/')&&exists('public'+i.src)));
for(const file of ['logo-icon.png','logo-wordmark.png','logo-icon-reverse.png','logo-wordmark-reverse.png','logo-stacked.png','app-icon.png','favicon-32.png','favicon.ico','apple-touch-icon.png','icon-192.png','icon-512.png','social-card.png'])t('asset exists: '+file,exists('public/assets/careweb/'+file)&&bytes('public/assets/careweb/'+file).length>0);
t('logo PNGs carry an alpha channel',['logo-icon.png','logo-wordmark.png'].every(f=>bytes('public/assets/careweb/'+f)[25]===6));
/* the documents and emails carry the lockup (v88.1.1) */
t('every generated document opens with the lockup',(server.match(/class="mark"><img/g)||[]).length>=4);
t('emails carry the lockup with the name as alt text',server.includes('logo-wordmark.png" alt="The Care Web"'));
/* the palette: navy, gold, silver — and no teal left behind (v88.1.0 / v88.1.2) */
t('brand tokens are declared',['--navy:#203566','--gold:#F1BE48','--silver:#BDC3CC','--text:#1B2440'].every(x=>html.includes(x)));
const teal=/#0E6B62|#0A544D|#2AA396|#17313A|#3E5A64|#0B3F38|#15907F|rgba\(14,107,98/i;
t('no leftover teal in the page',!teal.test(html.replace(/--teal:#00443c; --teal-deep:#00291f;/,'')));
t('no leftover teal in server-rendered pages or emails',!teal.test(server));
t('high-contrast override is intact',html.includes('--ink:#000000; --ink-soft:#000000; --teal:#00443c; --teal-deep:#00291f;'));
t('keyboard focus is visible',/:focus-visible\{outline:3px solid/.test(html));
t('reduced-motion preference is honoured',html.includes('prefers-reduced-motion')&&html.includes('data-motion="reduce"'));
/* content honesty (audit F10) */
t('illustrative stories are labelled',html.includes('not customer testimonials or ratings')&&!html.includes('composites of the feedback we hear'));
t('no story claims claiming is automatic',!html.includes('Claiming is automatic'));
/* the animated site is the one that ships: the hero reel and scene videos are still there */
t('the hero reel is present',html.includes('id="heroReel"'));
t('the six scene videos are present',(html.match(/data-scene="/g)||[]).length>=6);
const ver=require('../lib/version');t('additive permission/review schema is identified as 88202',ver.SCHEMA_VERSION===88202);
console.log(`graphics: ${total-failed}/${total} passed`);process.exitCode=failed?1:0;
