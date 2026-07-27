const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const B = 'http://localhost:3112';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };
  const toastSays = async re => {
    try { await page.waitForFunction(r => new RegExp(r).test(document.getElementById('toast').textContent), re, { timeout: 8000 }); return true; }
    catch { console.log('    (toast was: ' + await page.textContent('#toast') + ')'); return false; }
  };

  console.log('— worker logs in, uploads a 12 MB phone photo —');
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.click('#btnLogin');
  await page.fill('#loginEmail', 'sarah@demo.bookit.life');
  await page.fill('#loginPw', 'demo1234');
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#acctWrap:not([hidden])');
  await page.goto(B + '/#/bookings');
  await page.waitForSelector('#mpPhoto');
  await page.setInputFiles('#mpPhoto', 'big-photo.jpg');
  await page.click('#mpPhotoSave');
  await expect(toastSays('Photo saved'), 'huge photo uploads fine (auto-shrunk)');
  await page.waitForTimeout(600);
  await expect(page.isVisible('#cardProfile img'), 'profile card shows the photo');
  await expect(page.isVisible('#acctAvatar img'), 'nav chip picked the photo up');
  const dims = await page.evaluate(async () => {
    const r = await fetch('/api/me/profile', { credentials: 'same-origin' });
    const d = await r.json();
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = d.profile.photo; });
    return { w: img.naturalWidth, h: img.naturalHeight };
  });
  await expect(Promise.resolve(dims.w === 1280 && dims.h === 960), `stored photo is shrunk to ${dims.w}×${dims.h} (from 4032×3024)`);

  const pickDoc = async (q, key) => {
    await page.waitForSelector('#cardCreds details', { timeout: 9000 });
    await page.waitForFunction(() => {
      const d = document.querySelector('#cardCreds details');
      if (!d) return false;
      d.open = true;
      const s = document.querySelector('#wdSearch');
      return !!(s && s.offsetParent !== null);
    }, null, { timeout: 9000 });
    await page.fill('#wdSearch', q);
    await page.click(`.ta-item[data-ta="${key}"]`);
  };

  console.log('— credential: A4-at-300dpi PNG scan —');
  await pickDoc('first aid', 'first-aid');
  await page.fill('#wdExpiry', '2028-01-01');
  await page.setInputFiles('#wdFile', 'big-scan.png');
  await page.click('#wdAdd');
  await expect(toastSays('the team will sight and verify'), 'huge PNG credential uploads fine (auto-shrunk)');

  console.log('— credential: 5 MB PDF gets a clear message —');
  await pickDoc('other', 'other');
  await page.setInputFiles('#wdFile', 'fake-big.pdf');
  await page.click('#wdAdd');
  await expect(toastSays('over the 4 MB limit'), 'oversized PDF stopped before upload with a friendly message');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
