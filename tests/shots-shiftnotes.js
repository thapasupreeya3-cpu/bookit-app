/* Light-theme screenshots of the shift-notes flow. colorScheme:'light' is forced
   because the browser here inherits a dark preference — the site itself is light only. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1180, height: 1000 }, colorScheme: 'light' });
  const B = 'http://localhost:3130';
  const api = (u, b, m) => page.evaluate(([u, b, m]) => fetch(u, { method: m || 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: b ? JSON.stringify(b) : undefined }).then(r => r.json()), [u, b, m]);
  const openAs = async h => { await page.goto(B + '/#' + h); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(700); };

  await page.goto(B, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const j = r => r.json();
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    const patch = (u, b) => fetch(u, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    const w = await j(await post('/api/register', { role: 'worker', name: 'Nita Nguyen', email: 'nita@example.com', password: 'password99', services: ['household', 'community', 'personal-care'] }));
    await post('/api/logout', {});
    await post('/api/register', { role: 'participant', name: 'Boss', email: 'boss@test.com', password: 'password99' });
    await post('/api/admin/workers/' + w.user.id + '/approve', { override: true });
    await post('/api/logout', {});
    await post('/api/register', { role: 'participant', name: 'Polly Person', email: 'polly@example.com', password: 'password99' });
    const d = n => { const t = new Date(); t.setDate(t.getDate() - n); return t.toISOString().slice(0, 10); };
    const b1 = await j(await post('/api/bookings', { worker_id: w.user.id, service: 'household', date: d(2), start: '09:00', hours: 2 }));
    const b2 = await j(await post('/api/bookings', { worker_id: w.user.id, service: 'community', date: d(1), start: '14:00', hours: 3 }));
    const b3 = await j(await post('/api/bookings', { worker_id: w.user.id, service: 'household', date: d(0), start: '10:00', hours: 2 }));
    await post('/api/logout', {});
    await post('/api/login', { email: 'nita@example.com', password: 'password99' });
    for (const b of [b1, b2, b3]) await patch('/api/bookings/' + b.id, { status: 'accepted' });
    await patch('/api/bookings/' + b1.id, { status: 'completed', note: 'Arrived 10am. We did the fortnightly shop and put it all away together. Polly managed the trolley on her own today, which is new — she was pleased with herself. Home and settled by 12.' });
    await post('/api/bookings/' + b1.id + '/notes', { note: 'Adding to this — I forgot to mention Polly has run out of her usual laundry powder and asked me to remind the office to add it to next week\'s list.' });
    await patch('/api/bookings/' + b2.id, {
      status: 'completed',
      note: 'Afternoon at the community garden. Three good hours, Polly did the watering and had a long chat with the woman on the next plot.',
      scope: true,
      scope_detail: 'Polly\'s daughter asked me to flush her catheter before we left. I told her that isn\'t something I\'m able to do and rang the office from the car.'
    });
    window.__b3 = b3.id;
  });

  // 1 — the worker's composer, open and half-written
  await openAs('/bookings');
  await page.locator('[data-note-open]').first().click();
  await page.waitForSelector('[data-note-form]:visible');
  await page.locator('[data-note-form]:visible textarea.note-body').fill('Two hours this morning — bins out, kitchen and bathroom done, and we put a load of washing on before I left.');
  await page.locator('[data-note-form]:visible').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shot-sn-1-worker-composer.png' });

  // 2 — the same composer with the out-of-scope question answered Yes
  await page.locator('[data-note-form]:visible input[value="yes"]').check();
  await page.locator('[data-note-form]:visible .note-scope-detail').fill('Her daughter asked whether I could give Polly her evening insulin if she was running late. I said no and that I would let the office know.');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-sn-2-out-of-scope.png' });

  // 3 — what the participant sees
  await api('/api/logout', {});
  await api('/api/login', { email: 'polly@example.com', password: 'password99' });
  await openAs('/bookings');
  const twoId = await page.locator('[data-note-read]').filter({ hasText: '(2)' }).getAttribute('data-note-read');
  await page.locator(`[data-note-read="${twoId}"]`).click();
  await page.waitForSelector('.note-entry');
  await page.waitForTimeout(400);
  await page.locator(`[data-note-out="${twoId}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-sn-3-participant-reads.png' });

  // 4 — the office queue
  await api('/api/logout', {});
  await api('/api/login', { email: 'boss@test.com', password: 'password99' });
  await openAs('/admin');
  await page.waitForSelector('[data-sn-review]', { timeout: 9000 });
  await page.locator('[data-sn-note]').first().fill('Rang Nita 27/07 — she was right to decline, catheter care is a 0104 support and we hold no 0104 registration. Introducing Polly to Coast Community Nursing and noting it on her file.');
  await page.locator('[data-sn-review]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shot-sn-4-admin-queue.png' });

  // 5 — the tiles at the top of the dashboard
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'shot-sn-5-admin-tiles.png' });

  console.log('shots written');
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
