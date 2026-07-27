const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const B = 'http://localhost:3123';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };
  const admHas = async (re, m) => {
    try { await page.waitForFunction(r => new RegExp(r).test((document.getElementById('adminContent') || {}).textContent || ''), re, { timeout: 9000 }); ok(m); }
    catch { bad(m); }
  };

  await page.goto(B, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ role: 'participant', name: 'Bee Admin', email: 'boss@test.com', password: 'password99' }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.goto(B + '/#/admin');

  console.log('— every section renders —');
  await admHas('Launch', 'Launch section');
  await admHas('Preview lock', 'preview-lock status line');
  await admHas('13 demo accounts still in the database', 'demo count shown (13)');
  await admHas('Remove all demo data', 'launch sweep button');
  await admHas('Reviews', 'Reviews section');
  await admHas('SIL rosters', 'SIL section');
  await admHas('No SIL houses yet', 'SIL empty state');
  await admHas('Claims & payments', 'Claims section still there');
  await admHas('Credentials — the automatic checker', 'Credentials section still there');

  console.log('— build a house through the UI —');
  await page.fill('#silHouseName', 'Wattle St');
  await page.fill('#silHouseAddr', '12 Wattle St, Gosford');
  await page.click('#silAddHouse');
  await admHas('Wattle St', 'house appears');
  await page.evaluate(() => { [...document.querySelectorAll('#adminContent details')].forEach(d => { if (/repeating slot/.test(d.textContent)) d.open = true; }); });
  await page.selectOption('.sil-day-in', '5');
  await page.fill('.sil-start-in', '08:00');
  await page.fill('.sil-hours-in', '6');
  await page.selectOption('.sil-worker-in', { index: 1 });
  await page.selectOption('.sil-part-in', { index: 1 });
  await page.click('[data-sil-slot-add]');
  await admHas('08:00', 'slot appears in the Saturday column');
  const satCol = await page.evaluate(() => [...document.querySelectorAll('.sil-day')].findIndex(d => d.textContent.includes('08:00')));
  await expect(Promise.resolve(satCol === 5), 'slot sits under Sat (col ' + satCol + ')');

  console.log('— generate the week —');
  await page.click('#silGenerate');
  await page.waitForFunction(() => /booking.* created/.test(document.getElementById('toast').textContent), { timeout: 9000 });
  const toastText = await page.textContent('#toast');
  await expect(Promise.resolve(/1 booking created/.test(toastText)), 'toast reports 1 booking: ' + toastText.slice(0, 60));
  await page.evaluate(() => document.querySelector('#adminContent').scrollIntoView());
  await page.screenshot({ path: 'shot-sil.png' });

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
