const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const B = 'http://localhost:3120';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };

  console.log('— set up completed shift via API —');
  await page.goto(B, { waitUntil: 'networkidle' });
  const wid = await page.evaluate(async () => {
    const j = (r) => r.json();
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    const w = await j(await post('/api/register', { role: 'worker', name: 'Star Worker', email: 'starw@example.com', password: 'password99', services: ['community'] }));
    await post('/api/logout', {});
    await post('/api/register', { role: 'participant', name: 'Boss', email: 'boss@test.com', password: 'password99' });
    await post('/api/admin/workers/' + w.user.id + '/approve', { override: true });
    await post('/api/logout', {});
    await post('/api/register', { role: 'participant', name: 'Rita Rater', email: 'rita@example.com', password: 'password99' });
    const today = new Date().toISOString().slice(0, 10);
    const b = await j(await post('/api/bookings', { worker_id: w.user.id, service: 'community', date: today, start: '09:00', hours: 3 }));
    await post('/api/logout', {});
    await post('/api/login', { email: 'starw@example.com', password: 'password99' });
    await fetch('/api/bookings/' + b.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ status: 'accepted' }) });
    await fetch('/api/bookings/' + b.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ status: 'completed', note: 'Community access shift. We got out for a couple of hours and Rita enjoyed it.' }) });
    await post('/api/logout', {});
    await post('/api/login', { email: 'rita@example.com', password: 'password99' });
    return w.user.id;
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.goto(B + '/#/bookings');
  await page.waitForSelector('.rate-row');
  ok('star widget on the completed shift');

  console.log('— rate it —');
  await page.click('.rate-row .star[data-star="4"]');
  await expect(page.isVisible('.rate-more'), 'comment box appears after starring');
  const lit = await page.evaluate(() => [...document.querySelectorAll('.rate-row .star')].map(s => s.textContent).join(''));
  await expect(Promise.resolve(lit === '★★★★☆'), 'four stars lit: ' + lit);
  await page.fill('.rate-text', 'Brilliant with my son — patient and fun.');
  await page.click('.rate-send');
  await page.waitForFunction(() => /thank you/i.test((document.querySelector('#bookingsList') || {}).textContent || ''), { timeout: 9000 });
  ok('booking now shows Reviewed ✓');

  console.log('— review on the public profile —');
  await page.goto(B + '/#/worker/' + wid);
  await page.waitForSelector('.rev');
  const t = await page.textContent('#wpBody');
  await expect(Promise.resolve(/★ 4\.0/.test(t)), 'aggregate ★ 4.0 shown');
  await expect(Promise.resolve(/Brilliant with my son/.test(t)), 'comment displayed');
  await expect(Promise.resolve(/Rita R\./.test(t)), 'author shown as Rita R.');
  const stars = await page.textContent('.rev-stars');
  await expect(Promise.resolve(stars === '★★★★☆'), 'review stars render: ' + stars);
  await page.screenshot({ path: 'shot-reviews.png' });

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
