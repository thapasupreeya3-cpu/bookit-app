const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const B = 'http://localhost:3127';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (c, m) => { (await c) ? ok(m) : bad(m); };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const vis = s => page.locator(s).isVisible();
  const admHas = async (re, m) => {
    try { await page.waitForFunction(r => new RegExp(r).test((document.getElementById('adminContent') || {}).textContent || ''), re, { timeout: 9000 }); ok(m); }
    catch { bad(m); }
  };

  await page.goto(B + '/#/get-started', { waitUntil: 'networkidle' });
  await page.click('[data-path="participant"]');
  await page.waitForSelector('#participantForm', { timeout: 8000 });

  console.log('— the question only appears when it could apply —');
  await expect(page.locator('#pHiWrap').isHidden(), 'hidden before any support type is picked');
  await page.check('input[name="pSvc"][value="household"]');
  await expect(page.locator('#pHiWrap').isHidden(), 'still hidden for a household-only signup');
  await page.check('input[name="pSvc"][value="personal-care"]');
  await expect(vis('#pHiWrap'), 'appears once personal care is picked');
  await expect(page.locator('#pHiPills label').count().then(n => n === 8), 'all eight Module 1 supports offered');

  const txt = await page.locator('#pHiWrap').textContent();
  await expect(Promise.resolve(/inserting, changing or irrigating/.test(txt)), 'catheter option is qualified, so leg-bag users do not tick it');
  await expect(Promise.resolve(/toileting and continence assistance are/i.test(txt)), 'copy says plainly that ordinary continence help is not on the list');

  console.log('— the warning only appears once something is ticked —');
  await expect(page.locator('#pHiNote').isHidden(), 'no warning while nothing is ticked');
  await page.check('input[name="pHi"][value="enteral"]');
  await expect(vis('#pHiNote'), 'warning shows after ticking PEG feeding');
  await expect(page.locator('#pHiNote').textContent().then(t => /0104/.test(t) && /0107/.test(t)), 'warning names both registration groups');
  await expect(page.locator('#pHiNote').textContent().then(t => /you engage directly/.test(t)), 'warning says the participant engages the other provider directly (an introduction, not a subcontract)');

  console.log('— unticking the support type clears the declaration —');
  await page.uncheck('input[name="pSvc"][value="personal-care"]');
  await expect(page.locator('#pHiWrap').isHidden(), 'question hides again');
  await expect(page.locator('input[name="pHi"]:checked').count().then(n => n === 0), 'ticks are cleared so nothing is submitted invisibly');

  console.log('— signing up with a declaration —');
  await page.check('input[name="pSvc"][value="personal-care"]');
  await page.check('input[name="pHi"][value="bowel"]');
  await page.fill('#pName', 'Ada Screening');
  await page.fill('#pEmail', 'ada.ui@example.com');
  await page.fill('#pPassword', 'password99');
  await page.fill('#pPostcode', 'Tuggerah');
  await page.click('#participantForm button[type="submit"]');
  await page.waitForSelector('#gsSuccess:not([hidden])', { timeout: 8000 });
  const msg = await page.locator('#gsSuccessMsg').textContent();
  await expect(Promise.resolve(/call you within one business day/.test(msg)), 'success message promises a call before anything is booked');
  await expect(Promise.resolve(/aren.t registered to deliver/.test(msg)), 'success message is honest about the boundary');

  console.log('— the declaration is editable on the participant\'s own page —');
  await page.goto(B + '/#/bookings', { waitUntil: 'networkidle' });
  await page.waitForSelector('#cardHi', { timeout: 9000 });
  await expect(page.locator('#cardHi input[value="bowel"]').isChecked(), 'what they declared at signup is shown ticked');
  await expect(page.locator('#cardHi').textContent().then(t => /Most people tick nothing/.test(t)), 'card reassures rather than alarms');
  await page.check('#cardHi input[value="trach"]');
  await page.click('#hiSave');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('hiSaveNote').textContent), null, { timeout: 8000 });
  ok('participant can add a support themselves and it saves');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#cardHi', { timeout: 9000 });
  await expect(page.locator('#cardHi input[value="trach"]').isChecked(), 'the change survives a reload');

  console.log('— the office sees it —');
  await page.evaluate(async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ role: 'participant', name: 'Bee Admin', email: 'boss@test.com', password: 'password99' }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.goto(B + '/#/admin');
  await admHas('High-intensity enquiries', 'admin section renders');
  await admHas('\\(1 to call\\)', 'the heading counts what still needs a phone call');
  await admHas('Ada Screening', 'the participant is listed');
  await admHas('Complex bowel care', 'their declaration is shown in words, not codes');
  await admHas('Tracheostomy management', 'the support they added later is shown too');
  await admHas('High-intensity — call not yet made', 'a dashboard tile tracks it');
  await expect(vis('[data-hi-refer]'), 'record-introduction button is offered');

  console.log('— a referral cannot be recorded without writing down what was said —');
  await page.click('[data-hi-refer]');
  await page.waitForFunction(() => /that line is the record/.test(document.body.textContent), null, { timeout: 6000 }).then(() => ok('empty note is refused with an explanation')).catch(() => bad('empty note is refused with an explanation'));
  await page.fill('[data-hi-note]', 'Called 27/07 — introduced to Coast Community Nursing, Ada is contacting them direct.');
  await page.click('[data-hi-refer]');
  await admHas('Coast Community Nursing', 'the note is kept as the record');
  await admHas('handled', 'the row is marked handled');
  await expect(page.locator('.adm-tiles').first().locator('.adm-tile', { hasText: 'call not yet made' }).textContent().then(t => t.trim().startsWith('0')), 'the tile drops back to zero');

  await expect(Promise.resolve(errors.length === 0), 'no JS errors anywhere (' + errors.join('; ') + ')');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH: ' + e.message); process.exit(1); });
