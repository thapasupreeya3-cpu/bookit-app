const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const B = 'http://localhost:3116';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };
  const toastSays = async re => {
    try { await page.waitForFunction(r => new RegExp(r).test(document.getElementById('toast').textContent), re, { timeout: 8000 }); return true; }
    catch { console.log('    (toast: ' + await page.textContent('#toast') + ')'); return false; }
  };
  const openAdd = () => page.evaluate(() => { document.querySelector('#cardCreds details').open = true; });
  const cardText = () => page.textContent('#cardCreds');
  /* waits for the async card re-render — never trusts stale DOM or repeated toasts */
  const cardHas = async (re, m) => {
    try{
      await page.waitForFunction(r => new RegExp(r).test((document.getElementById('cardCreds') || {}).textContent || ''), re, { timeout: 9000 });
      ok(m);
    }catch{ bad(m + ' (card: ' + (await cardText()).replace(/\s+/g, ' ').slice(0, 140) + ')'); }
  };

  console.log('— fresh worker lands on the checklist —');
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ role: 'worker', name: 'Typea Head', email: 'typea@example.com', password: 'password99', services: ['community'] }) });
  });
  await page.goto(B + '/#/bookings');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#cardCreds');
  let t = await cardText();
  await expect(Promise.resolve(/Onboarding 0 of 7 complete/.test(t)), 'onboarding meter starts at 0 of 7');
  await expect(Promise.resolve(/100 points of ID/.test(t)), 'checklist has 100 points of ID');
  await expect(Promise.resolve(/Right to work/.test(t)), 'checklist has right to work');
  await expect(page.isVisible('#wdSearch'), 'add-a-document open by default when empty');

  console.log('— typeahead: type "pass" → Australian Passport —');
  await page.click('#wdSearch');
  await page.waitForSelector('#wdMenu:not([hidden])');
  t = await page.textContent('#wdMenu');
  await expect(Promise.resolve(/Identity — 100 points of ID/.test(t)), 'menu groups start with identity');
  await page.fill('#wdSearch', 'pass');
  t = await page.textContent('#wdMenu');
  await expect(Promise.resolve(/Australian Passport/.test(t)), 'passport suggested');
  await expect(Promise.resolve(/70 pts · primary/.test(t)), 'points + primary badge shown');
  await page.click('.ta-item[data-ta="passport-au"]');
  await expect(page.isVisible('#wdChosen'), 'chosen chip appears');
  const numLab = await page.textContent('#wdNumberLab');
  await expect(Promise.resolve(numLab === 'Passport number'), 'number field renamed: ' + numLab);
  await expect(page.isHidden('#wdExpReq'), 'expiry optional for a passport');
  await page.fill('#wdNumber', 'PA1112223');
  await page.click('#wdAdd');
  await expect(toastSays('sight and verify'), 'passport added');
  await cardHas('70 / 100 pts · primary ✓', 'tally shows 70/100 + primary');
  await cardHas('Onboarding 1 of 7', 'right to work ticked (1 of 7)');

  console.log('— alias search + keyboard select: drivers license —');
  await openAdd();
  await page.fill('#wdSearch', 'drivers license');
  await page.waitForSelector('.ta-item[data-ta="driver-licence"]');
  await page.press('#wdSearch', 'ArrowDown');
  await page.press('#wdSearch', 'Enter');
  await expect(page.isVisible('#wdChosen'), 'keyboard selection works');
  await page.fill('#wdNumber', '87654321');
  await page.fill('#wdExpiry', '2031-02-14');
  await page.click('#wdAdd');
  await cardHas('110 / 100 pts', '110 points now');
  await cardHas('expires 14/02/2031', 'expiry shown DD/MM/YYYY (14/02/2031)');

  console.log('— orientation module carries its link —');
  await openAdd();
  await page.fill('#wdSearch', 'orient');
  await page.click('.ta-item[data-ta="ndis-orientation"]');
  await expect(page.isHidden('#wdExpiryWrap'), 'no expiry field for the orientation module');
  const link = await page.getAttribute('#wdHelp a', 'href');
  await expect(Promise.resolve(/training\.ndiscommission\.gov\.au/.test(link)), 'do-it-online link → ' + link);
  await page.click('#wdAdd');
  await cardHas('Onboarding 3 of 7', 'orientation added (ID + RTW + orientation = 3 of 7)');

  console.log('— required expiry enforced for first aid —');
  await openAdd();
  await page.fill('#wdSearch', 'first');
  await page.click('.ta-item[data-ta="first-aid"]');
  await expect(page.isVisible('#wdExpReq'), '(required) mark on expiry');
  await page.click('#wdAdd');
  await expect(toastSays('expiry date'), 'server insists on the expiry');
  await page.fill('#wdExpiry', '2029-05-01');
  await page.click('#wdAdd');
  await cardHas('expires 01/05/2029', 'first aid expiry as 01/05/2029');
  await cardHas('Onboarding 4 of 7', '4 of 7 after ID + RTW + orientation + first aid');
  await cardHas('Identity — 100 points of ID.*Australian Passport', 'docs grouped under identity heading');
  await cardHas('Training certificates', 'docs grouped under training heading');
  await page.screenshot({ path: 'shot-catalog.png', clip: await page.locator('#cardCreds').boundingBox() });

  console.log('— no-match fallback —');
  await openAdd();
  await page.click('#wdChange').catch(() => {});
  await page.fill('#wdSearch', 'zzzzqq');
  t = await page.textContent('#wdMenu');
  await expect(Promise.resolve(/Nothing matches/.test(t)), 'graceful no-match message');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
