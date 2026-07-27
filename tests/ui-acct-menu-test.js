const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const B = 'http://localhost:3111';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };
  const menuText = () => page.textContent('#acctMenu');

  console.log('— logged out —');
  await page.goto(B, { waitUntil: 'networkidle' });
  await expect(page.isVisible('#btnLogin'), 'Log in button visible');
  await expect(page.isVisible('#btnGetStarted'), 'Get started visible');
  await expect(page.isHidden('#acctWrap'), 'account chip hidden');

  console.log('— worker logs in (Sarah) —');
  await page.click('#btnLogin');
  await page.fill('#loginEmail', 'sarah@demo.bookit.life');
  await page.fill('#loginPw', 'demo1234');
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#acctWrap:not([hidden])');
  await expect(page.isHidden('#btnLogin'), 'Log in button gone');
  await expect(page.isHidden('#btnGetStarted'), 'Get started gone');
  const initials = await page.textContent('#acctAvatar');
  await expect(Promise.resolve(initials.trim() === 'SM'), 'chip shows initials SM (no photo yet)');

  await page.click('#acctBtn');
  await page.waitForSelector('#acctMenu:not([hidden])');
  let t = await menuText();
  await expect(Promise.resolve(/G'day, Sarah/.test(t)), "menu greets G'day, Sarah");
  await expect(Promise.resolve(/Support worker/.test(t)), 'role says Support worker');
  await expect(Promise.resolve(/profile live/.test(t)), 'status: profile live');
  await expect(Promise.resolve(/Bookings & shifts/.test(t)), 'item: Bookings & shifts');
  await expect(Promise.resolve(/My profile & photo/.test(t)), 'item: My profile & photo');
  await expect(Promise.resolve(/Credentials & checks/.test(t)), 'item: Credentials & checks');
  await expect(Promise.resolve(/Report an incident/.test(t)), 'item: Report an incident');
  await expect(Promise.resolve(/Help & contact/.test(t)), 'item: Help & contact');
  await expect(Promise.resolve(/Log out/.test(t)), 'item: Log out');
  await expect(Promise.resolve(!/Billing/.test(t)), 'no Billing item for a worker');
  await expect(Promise.resolve(!/Admin dashboard/.test(t)), 'no Admin item for a worker');
  await expect(Promise.resolve(/Signed in as sarah@demo\.bookit\.life/.test(t)), 'footer shows email');
  await page.screenshot({ path: 'shot-acct-worker.png' });

  console.log('— deep link: Credentials & checks —');
  await page.click('#acctMenu .acct-item:has-text("Credentials & checks")');
  await page.waitForSelector('#cardCreds', { timeout: 5000 });
  await expect(Promise.resolve(page.url().includes('#/bookings')), 'landed on #/bookings');
  await page.waitForTimeout(600);
  const inView = await page.evaluate(() => {
    const r = document.getElementById('cardCreds').getBoundingClientRect();
    return r.top >= 0 && r.top < window.innerHeight;
  });
  await expect(Promise.resolve(inView), 'credentials card scrolled into view');
  await expect(page.isHidden('#acctMenu'), 'menu closed after navigating');

  console.log('— outside click + Esc —');
  await page.click('#acctBtn');
  await page.waitForSelector('#acctMenu:not([hidden])');
  await page.mouse.click(400, 500);
  await expect(page.isHidden('#acctMenu'), 'outside click closes menu');
  await page.click('#acctBtn');
  await page.keyboard.press('Escape');
  await expect(page.isHidden('#acctMenu'), 'Esc closes menu');

  console.log('— photo lands in the chip —');
  await page.evaluate(async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await fetch('/api/me/photo', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'same-origin',
      body: JSON.stringify({ file: { name: 'p.png', mime: 'image/png', data: PNG } }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.isVisible('#acctAvatar img'), 'chip now shows the uploaded photo');

  console.log('— log out from the menu —');
  await page.click('#acctBtn');
  await page.click('#acctMenu .acct-item.acct-out');
  await page.waitForSelector('#btnLogin:not([hidden])');
  await expect(page.isVisible('#btnLogin'), 'Log in button back');
  await expect(page.isHidden('#acctWrap'), 'chip hidden again');

  console.log('— participant menu —');
  await page.click('#btnLogin');
  await page.fill('#loginEmail', 'demo@demo.bookit.life');
  await page.fill('#loginPw', 'demo1234');
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#acctWrap:not([hidden])');
  await page.click('#acctBtn');
  t = await menuText();
  await expect(Promise.resolve(/My bookings/.test(t)), 'item: My bookings');
  await expect(Promise.resolve(/Billing & NDIS details/.test(t)), 'item: Billing & NDIS details');
  await expect(Promise.resolve(/Report an incident/.test(t)), 'participants can report incidents too');
  await expect(Promise.resolve(/Participant/.test(t)), 'role says Participant');
  await expect(Promise.resolve(!/Credentials/.test(t)), 'no Credentials item for a participant');
  await expect(Promise.resolve(!/profile live/.test(t)), 'no live/pending status for a participant');
  await page.screenshot({ path: 'shot-acct-participant.png' });

  console.log('— billing deep link opens + flashes —');
  await page.click('#acctMenu .acct-item:has-text("Billing & NDIS details")');
  await page.waitForSelector('#cardBilling');
  await page.waitForTimeout(500);
  await expect(page.isVisible('#bdPlan'), 'billing card present for participant');

  console.log('— incident deep link opens the details —');
  await page.click('#acctBtn');
  await page.click('#acctMenu .acct-item:has-text("Report an incident")');
  await page.waitForSelector('#cardIncident');
  await page.waitForTimeout(500);
  const detOpen = await page.evaluate(() => document.querySelector('#cardIncident details').open);
  await expect(Promise.resolve(detOpen), 'incident form auto-opened');
  await expect(page.isVisible('#incSubmitW'), 'participant sees the incident form');
  await page.evaluate(async () => { await fetch('/api/logout', { method:'POST', credentials:'same-origin' }); });

  console.log('— admin menu —');
  await page.evaluate(async () => {
    await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'same-origin',
      body: JSON.stringify({ role:'participant', name:'Boss Admin', email:'boss@test.com', password:'password99' }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#acctWrap:not([hidden])');
  await page.click('#acctBtn');
  t = await menuText();
  await expect(Promise.resolve(/Admin dashboard/.test(t)), 'item: Admin dashboard');
  await expect(Promise.resolve(/Participant · Admin/.test(t)), 'role line says Participant · Admin');
  await page.screenshot({ path: 'shot-acct-admin.png' });
  await page.click('#acctMenu .acct-item:has-text("Admin dashboard")');
  await page.waitForTimeout(400);
  await expect(Promise.resolve(page.url().includes('#/admin')), 'admin item lands on #/admin');

  console.log('— mobile viewport —');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#acctBtn');
  await page.waitForSelector('#acctMenu:not([hidden])');
  const w = await page.evaluate(() => document.getElementById('acctMenu').getBoundingClientRect().width);
  await expect(Promise.resolve(w > 300), 'menu goes full-width on mobile (' + Math.round(w) + 'px)');
  await page.screenshot({ path: 'shot-acct-mobile.png' });

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
