const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const B = 'http://localhost:3114';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };
  const bodyText = () => page.textContent('#wpBody');

  console.log('— open a profile from Find workers —');
  await page.goto(B + '/#/find-workers', { waitUntil: 'networkidle' });
  await page.click('#workerGrid .worker-card button[data-worker] >> nth=0');
  await page.waitForSelector('#page-worker.active .wp-name');
  await expect(Promise.resolve(/#\/worker\/\d+$/.test(page.url())), 'shareable URL: ' + page.url().split('#')[1]);
  let t = await bodyText();
  await expect(Promise.resolve(/About /.test(t)), 'About section renders');
  await expect(Promise.resolve(/Support .* offers/.test(t)), 'Support offered section renders');
  await expect(Promise.resolve(/Typical availability/.test(t)), 'Availability section renders');
  await expect(Promise.resolve(/Checks & credentials/.test(t)), 'Checks section renders');
  await expect(Promise.resolve(/employed and insured/.test(t)), 'trust box with DMHC + reg no');
  await expect(Promise.resolve(/4-LO5XNY0/.test(t)), 'registration number shown');
  await expect(Promise.resolve(/\$73\.58/.test(t)), 'NDIS rate card in aside');
  await expect(page.isVisible('#wpBook'), 'Request a booking button');
  const crumb = await page.textContent('#wpCrumb');
  await expect(Promise.resolve(crumb.length > 2), 'breadcrumb carries worker name: ' + crumb);
  await page.screenshot({ path: 'shot-profile-visitor.png', fullPage: false });

  console.log('— save + star on find workers —');
  await page.click('#wpSave');
  await expect(page.getAttribute('#wpSave', 'aria-pressed').then(v => v === 'true'), 'save toggles on');
  await page.click('.breadcrumb a[href="#/find-workers"]');
  await page.waitForTimeout(400);
  const stars = await page.evaluate(() => document.querySelectorAll('#workerGrid .wc-rate span[title="Saved"]').length);
  await expect(Promise.resolve(stars === 1), 'saved star shows on the worker card');

  console.log('— logged-out booking nudge —');
  await page.goBack();
  await page.waitForSelector('#wpBook');
  await page.click('#wpBook');
  await expect(page.isVisible('#loginModal .modal'), 'booking while logged out → login modal');
  await page.keyboard.press('Escape');

  console.log('— participant books from the profile —');
  await page.click('#btnLogin');
  await page.fill('#loginEmail', 'demo@demo.bookit.life');
  await page.fill('#loginPw', 'demo1234');
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#acctWrap:not([hidden])');
  await page.click('#wpBook');
  await page.waitForSelector('#bookingModal.open');
  const bkName = await page.textContent('#bkWorkerName');
  await expect(Promise.resolve(bkName.length > 2), 'booking modal opens with ' + bkName);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); });

  console.log('— worker sees their own profile —');
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#btnLogin');
  await page.fill('#loginEmail', 'sarah@demo.bookit.life');
  await page.fill('#loginPw', 'demo1234');
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#acctWrap:not([hidden])');
  await page.evaluate(() => { document.getElementById('wpBody').innerHTML = ''; });
  await page.click('#acctBtn');
  await page.click('#acctMenu .acct-item:has-text("See my public profile")');
  await page.waitForSelector('#wpEdit');
  t = await bodyText();
  await expect(Promise.resolve(/This is your profile/.test(t)), 'own profile shows self-view note');
  await expect(page.isHidden('#wpBook').catch(() => true), 'no booking button on own profile');
  await page.click('#wpEdit');
  await page.waitForSelector('#cardProfile');
  await expect(Promise.resolve(page.url().includes('#/bookings')), 'Edit my profile lands on bookings');

  console.log('— worker edits availability + langs —');
  await page.click('#mpDays button[data-day="6"]');
  await page.fill('#mpLangs', 'English, Auslan');
  await page.fill('#mpExp', '7 yrs experience');
  await page.click('#mpBioSave');
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById('wpBody').innerHTML = ''; });
  await page.click('#acctBtn');
  await page.click('#acctMenu .acct-item:has-text("See my public profile")');
  await page.waitForSelector('#page-worker.active .wp-name');
  t = await bodyText();
  await expect(Promise.resolve(/English, Auslan/.test(t)), 'new languages on public page');
  await expect(Promise.resolve(/7 yrs experience/.test(t)), 'new experience on public page');
  const sunOn = await page.evaluate(() => document.querySelectorAll('#wpBody .avail-grid .dot')[6].classList.contains('on'));
  await expect(Promise.resolve(sunOn), 'Sunday now lit on public availability');
  await page.screenshot({ path: 'shot-profile-own.png' });

  console.log('— pending worker sees the not-public-yet note —');
  await page.evaluate(async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ role: 'worker', name: 'Pending Penny', email: 'penny@example.com', password: 'password99', services: ['community'] }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  const myId = await page.evaluate(() => API.me.id);
  await page.goto(B + '/#/worker/' + myId);
  await page.waitForTimeout(600);
  t = await bodyText();
  await expect(Promise.resolve(/isn't public yet/.test(t)), 'pending worker told their profile is not live yet');

  console.log('— mobile —');
  await page.setViewportSize({ width: 390, height: 830 });
  await page.goto(B + '/#/find-workers');
  await page.click('#workerGrid .worker-card button[data-worker] >> nth=1');
  await page.waitForSelector('#page-worker.active .wp-name');
  await page.screenshot({ path: 'shot-profile-mobile.png' });
  const oneCol = await page.evaluate(() => getComputedStyle(document.querySelector('.wp-layout')).gridTemplateColumns.split(' ').length === 1);
  await expect(Promise.resolve(oneCol), 'single column on mobile');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
