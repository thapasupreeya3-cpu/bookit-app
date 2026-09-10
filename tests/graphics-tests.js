'use strict';
// Deterministic presentation/asset regression checks. No server or external library needed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'), read=p=>fs.readFileSync(path.join(root,p),'utf8'),
 bytes=p=>fs.readFileSync(path.join(root,p)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const html=read('public/index.html'),css=read('public/assets/careweb/design.css'),js=read('public/assets/careweb/visuals.js');
const baseline=JSON.parse(read('docs/graphics-baseline.json'));let total=0,failed=0;
function t(name,ok){total++;if(!ok)failed++;console.log((ok?'PASS  ':'FAIL  ')+name);}
const routes=/const ROUTES = \{[\s\S]*?\n\};/.exec(html)?.[0];
t('original route map is unchanged',hash(routes||'')===baseline.route_map_sha256);
const ids=[...new Set([...html.matchAll(/id="(page-[\w-]+)"/g)].map(m=>m[1]))].sort();
t('all original page containers remain',JSON.stringify(ids)===JSON.stringify(baseline.page_ids));
for(const id of ['heroSearch','heroSearchInput','homeServices','allServices','homeWorkers','homeFaq','workerGrid','mainNav','burger','navClose','a11yOpen','a11yPanel','fsUp','tglMotion','btnLogin','btnGetStarted','acctWrap'])t(id+' DOM hook remains',html.includes('id="'+id+'"'));
const ident=JSON.parse(read('public/assets/careweb/identity-source.json'));
for(const [file,info]of Object.entries(ident.crops))t('approved original crop: '+file,hash(bytes('public/assets/careweb/'+file))===info.sha256);
t('original logo appears in header and footer',(html.match(/class="logo cw-brand"/g)||[]).length===2);
t('original name has one accessible label per lockup',(html.match(/aria-label="The Care Web — home"/g)||[]).length===2);
t('new design is linked after legacy styling',html.indexOf('careweb/design.css')>html.lastIndexOf('</style>',html.indexOf('</head>')));
t('visual script is deferred',/<script src="\/assets\/careweb\/visuals.js[^\"]*" defer><\/script>/.test(html));
t('public guest header hides stale demo-message decoration',css.includes('body[data-cw-auth=guest] #btnMessages'));
t('no authentication or business API writes in presentation script',!/(fetch\(|API\.call|localStorage|sessionStorage)/.test(js.replace(/\/\*[\s\S]*?\*\//g,'')));
t('six scene figures are user-initiated',(html.match(/data-cw-media="/g)||[]).length===6&&(html.match(/data-cw-play="/g)||[]).length===6);
t('new service figures are not selected by the legacy autoplay controller',!/<figure[^>]*data-scene=/.test(html));
t('motion preference is honoured in new CSS',css.includes('prefers-reduced-motion:reduce')&&css.includes('[data-motion=reduce]'));
t('high contrast has an explicit redesign treatment',css.includes('html[data-cw-design].high-contrast'));
t('readable type preference has an explicit redesign treatment',css.includes('[data-font=readable]'));
t('print rules keep only the active screen',css.includes('.page:not(.active){display:none!important;}'));
t('keyboard focus is visible',css.includes(':focus-visible{outline:3px solid'));
t('all seven support choices are visible rather than clipped on mobile',css.includes('#homeServices')&&!css.includes('.cw-service-card:nth-child(n+'));
t('illustrative testimonials are labelled',html.includes('not verified customer testimonials'));
const paths=['design.css','visuals.js','logo-icon.png','logo-wordmark.png','logo-stacked.png','app-icon.png','favicon-32.png','favicon.ico','apple-touch-icon.png','icon-192.png','icon-512.png','social-card.png','site.webmanifest'];
for(const file of paths)t('asset exists: '+file,fs.existsSync(path.join(root,'public/assets/careweb',file))&&bytes('public/assets/careweb/'+file).length>0);
const manifest=JSON.parse(read('public/assets/careweb/site.webmanifest'));
t('install manifest names the correct brand',manifest.name==='The Care Web');
t('all manifest icons are local and present',manifest.icons.every(i=>i.src.startsWith('/assets/careweb/')&&fs.existsSync(path.join(root,'public',i.src))));
t('no new remote font dependency',!html.includes('fonts.googleapis.com')&&!css.includes('@import'));
t('base operational libraries, rules, forms and original tests remain byte-identical',Object.entries(baseline.protected_runtime_hashes).every(([p,h])=>fs.existsSync(path.join(root,p))&&hash(bytes(p))===h));
const ver=require('../lib/version');t('database schema is unchanged at 87000',ver.SCHEMA_VERSION===87000);
console.log(`graphics: ${total-failed}/${total} passed`);process.exitCode=failed?1:0;
