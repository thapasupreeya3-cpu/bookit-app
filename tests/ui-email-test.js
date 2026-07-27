const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const B = 'http://localhost:3100';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };

  await page.goto(B, { waitUntil: 'networkidle' });

  // 1. forgot-password flow UI
  await page.click('#btnLogin');
  await expect(page.isVisible('#loginModal .modal'), 'login modal opens');
  await expect(page.isVisible('#btnForgot'), 'forgot link visible in login modal');
  await page.click('#btnForgot');
  await page.waitForTimeout(300);
  await expect(page.isVisible('#forgotModal .modal'), 'forgot modal opens');
  await page.fill('#forgotEmail', 'bee@example.com');
  await page.click('#forgotForm button[type=submit]');
  await page.waitForTimeout(500);
  const note = await page.textContent('#forgotNote');
  await expect(Promise.resolve(/Done!/.test(note)), 'forgot form confirms send: ' + note.slice(0, 60));
  await page.screenshot({ path: 'shot-forgot.png' });
  await page.keyboard.press('Escape');
  await page.click('body', { position: { x: 10, y: 10 } }).catch(() => {});

  // 2. reset page via emailed-style link
  const rtoken = await page.evaluate(async () => {
    const r = await fetch('/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bee@example.com' }) });
    return (await r.json()).ok;
  });
  await page.goto(B + '/#/reset?token=r.9.9.junk', { waitUntil: 'networkidle' });
  await expect(page.isVisible('#page-reset.active #resetPw'), 'reset page renders from #/reset?token=…');
  await page.fill('#resetPw', 'freshpass1');
  await page.fill('#resetPw2', 'freshpass1');
  await page.click('#resetForm button[type=submit]');
  await page.waitForTimeout(600);
  const toastTxt = await page.textContent('#toast').catch(() => '');
  await expect(Promise.resolve(/invalid|expired/i.test(toastTxt)), 'bad token shows friendly error: ' + String(toastTxt).slice(0, 60));
  await page.screenshot({ path: 'shot-reset.png' });

  // 3. verified / verify-failed pages
  await page.goto(B + '/#/verified', { waitUntil: 'networkidle' });
  await expect(page.isVisible('#page-verified.active'), '#/verified page renders');
  await page.goto(B + '/#/verify-failed', { waitUntil: 'networkidle' });
  await expect(page.isVisible('#page-verify-failed.active'), '#/verify-failed page renders');

  // 4. unverified login → banner; resend works
  await page.evaluate(async () => {
    await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'participant', name: 'Carol Banner', email: 'carol@example.com', password: 'password99' }) });
    await fetch('/api/logout', { method: 'POST' });
  });
  await page.goto(B + '/#/', { waitUntil: 'networkidle' });
  await page.click('#btnLogin');
  await page.fill('#loginEmail', 'carol@example.com');
  await page.fill('#loginPw', 'password99');
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(700);
  await expect(page.isVisible('#verifyBanner'), 'verify banner shows for unverified user');
  await page.click('#btnResendVerify');
  await page.waitForTimeout(500);
  const t2 = await page.textContent('#toast').catch(() => '');
  await expect(Promise.resolve(/sent/i.test(t2)), 'resend gives confirmation toast');
  await page.screenshot({ path: 'shot-banner.png' });
  await page.click('#btnDismissVerify');
  await expect(page.isHidden('#verifyBanner'), 'banner dismisses');

  // 5. demo login → no banner
  await page.evaluate(async () => {
    await fetch('/api/logout', { method: 'POST' });
    await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@demo.bookit.life', password: 'demo1234' }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.isHidden('#verifyBanner'), 'no banner for verified demo account');

  // 6. no console errors on load
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(B + '/#/find-workers', { waitUntil: 'networkidle' });
  await page.goto(B + '/#/pricing', { waitUntil: 'networkidle' });
  await expect(Promise.resolve(errors.length === 0), 'no JS errors navigating (' + errors.join('; ').slice(0, 100) + ')');

  console.log(`\nUI RESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail);
})().catch(e => { console.error('HARNESS ERROR: ' + e.message); process.exit(1); });
