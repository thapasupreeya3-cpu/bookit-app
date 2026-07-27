/* UI: shift notes in the browser — the worker can't finish a shift without writing
   one, the participant can read what was written about them, corrections go
   underneath, and the office sees the out-of-scope flags. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const B = 'http://localhost:3129';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (c, m) => { (await c) ? ok(m) : bad(m); };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const toastSays = async (re, m) => {
    try { await page.waitForFunction(r => new RegExp(r).test((document.getElementById('toast') || {}).textContent || ''), re, { timeout: 9000 }); ok(m); }
    catch { bad(m + ' (toast said: ' + await page.textContent('#toast').catch(() => '—') + ')'); }
  };
  const listHas = async (re, m) => {
    try { await page.waitForFunction(r => new RegExp(r).test((document.getElementById('bookingsList') || {}).textContent || ''), re, { timeout: 9000 }); ok(m); }
    catch { bad(m); }
  };
  const admHas = async (re, m) => {
    try { await page.waitForFunction(r => new RegExp(r).test((document.getElementById('adminContent') || {}).textContent || ''), re, { timeout: 9000 }); ok(m); }
    catch { bad(m); }
  };
  const api = (u, b, method) => page.evaluate(([u, b, method]) =>
    fetch(u, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: b ? JSON.stringify(b) : undefined }).then(r => r.json()), [u, b, method]);
  /* the app reads who you are once at load, so switching accounts needs a real reload */
  const openAs = async hash => { await page.goto(B + '/#' + hash); await page.reload({ waitUntil: 'networkidle' }); };

  console.log('— set up two accepted shifts, then hand the browser to the worker —');
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const j = r => r.json();
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    const patch = (u, b) => fetch(u, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    const w = await j(await post('/api/register', { role: 'worker', name: 'Nita Notes', email: 'nita@example.com', password: 'password99', services: ['household', 'community'] }));
    await post('/api/logout', {});
    await post('/api/register', { role: 'participant', name: 'Boss', email: 'boss@test.com', password: 'password99' });
    await post('/api/admin/workers/' + w.user.id + '/approve', { override: true });
    await post('/api/logout', {});
    await post('/api/register', { role: 'participant', name: 'Polly Person', email: 'polly@example.com', password: 'password99' });
    const today = new Date().toISOString().slice(0, 10);
    const b1 = await j(await post('/api/bookings', { worker_id: w.user.id, service: 'household', date: today, start: '09:00', hours: 2 }));
    const b2 = await j(await post('/api/bookings', { worker_id: w.user.id, service: 'community', date: today, start: '14:00', hours: 2 }));
    await post('/api/logout', {});
    await post('/api/login', { email: 'nita@example.com', password: 'password99' });
    await patch('/api/bookings/' + b1.id, { status: 'accepted' });
    await patch('/api/bookings/' + b2.id, { status: 'accepted' });
  });
  await openAs('/bookings');
  await page.waitForSelector('[data-note-open]');
  ok('worker sees "Mark shift completed" on an accepted shift');

  console.log('— the button opens a note, it does not finish the shift —');
  await expect(page.locator('[data-note-form]').first().isHidden(), 'the composer starts hidden');
  await page.locator('[data-note-open]').first().click();
  await page.waitForSelector('[data-note-form]:visible');
  ok('clicking it opens the composer instead of completing outright');
  await expect(page.locator('[data-note-open]').first().isHidden(), 'the button steps aside while the composer is open');
  const ph = await page.locator('[data-note-form]:visible textarea.note-body').getAttribute('placeholder');
  await expect(Promise.resolve(/Polly/.test(ph)), 'the example note uses the participant\'s first name');
  const boxText = await page.locator('[data-note-form]:visible').textContent();
  await expect(Promise.resolve(/can't be edited/.test(boxText)), 'the worker is told up front that notes cannot be edited');
  await expect(Promise.resolve(/support coordinator/.test(boxText)), 'and that the participant will read it');

  console.log('— "not yet" closes it without completing anything —');
  await page.locator('[data-note-form]:visible [data-note-cancel]').click();
  await expect(page.locator('[data-note-form]').first().isHidden(), 'the composer closes');
  await expect(page.locator('[data-note-open]').first().isVisible(), 'the button comes back');
  await listHas('Accepted|accepted', 'the shift is still accepted, not completed');

  console.log('— an empty note is refused by the server, not silently accepted —');
  await page.locator('[data-note-open]').first().click();
  await page.waitForSelector('[data-note-form]:visible');
  await page.locator('[data-note-form]:visible [data-note-save]').click();
  await toastSays('Please write a shift note', 'the empty note bounces back with a plain-English reason');

  console.log('— the out-of-scope question —');
  await expect(page.locator('[data-note-form]:visible .note-scope-detail').isHidden(), 'the detail box is hidden while the answer is No');
  await page.locator('[data-note-form]:visible input[value="yes"]').check();
  await expect(page.locator('[data-note-form]:visible .note-scope-detail').isVisible(), 'answering Yes asks what was asked for');
  await page.locator('[data-note-form]:visible input[value="no"]').check();
  await expect(page.locator('[data-note-form]:visible .note-scope-detail').isHidden(), 'and changing back to No puts it away');

  console.log('— a real note completes the shift —');
  await page.locator('[data-note-form]:visible textarea.note-body').fill('Arrived 9am. We did the fortnightly shop and put it all away. Polly managed the trolley on her own today, which is new. Home and settled by 11.');
  await page.locator('[data-note-form]:visible [data-note-save]').click();
  await toastSays('note saved', 'the toast confirms the note went with it');
  await listHas('Read the shift note', 'the shift now offers its note to read');

  console.log('— the worker re-reads it and adds a correction underneath —');
  await page.locator('[data-note-read]').first().click();
  await page.waitForSelector('.note-entry');
  await expect(page.locator('.note-entry').first().textContent().then(t => /fortnightly shop/.test(t)), 'the note reads back exactly as written');
  await expect(page.locator('.note-out:visible').textContent().then(t => /never edited or deleted/.test(t)), 'the worker is offered an addendum, not an edit');
  await page.locator('.note-out:visible textarea.note-body').fill('Correction — it was 10am I arrived, not 9am.');
  await page.locator('[data-note-add]').first().click();
  await toastSays('Added to the notes', 'the addendum saves');
  await page.waitForFunction(() => document.querySelectorAll('.note-entry').length === 2, { timeout: 9000 });
  ok('two entries now, in the order they were written');
  const entries = await page.locator('.note-entry').allTextContents();
  await expect(Promise.resolve(/Arrived 9am/.test(entries[0])), 'the original wording survives the correction');
  await expect(Promise.resolve(/Added later/.test(entries[1])), 'the correction is labelled as added later');

  console.log('— flagging a request that is out of scope —');
  await page.locator('[data-note-open]').first().click();
  await page.waitForSelector('[data-note-form]:visible');
  await page.locator('[data-note-form]:visible textarea.note-body').fill('Afternoon at the community garden. Good two hours, Polly did the watering.');
  await page.locator('[data-note-form]:visible input[value="yes"]').check();
  await page.locator('[data-note-form]:visible .note-scope-detail').fill('Her daughter asked me to flush the catheter before we left. I said I could not and rang the office.');
  await page.locator('[data-note-form]:visible [data-note-save]').click();
  await toastSays('Thanks for flagging', 'the worker is thanked, not told off');

  console.log('— the participant reads what was written about them —');
  await api('/api/logout', {});
  await api('/api/login', { email: 'polly@example.com', password: 'password99' });
  await openAs('/bookings');
  await page.waitForSelector('[data-note-read]');
  ok('the participant is offered the note too');
  const twoUp = page.locator('[data-note-read]').filter({ hasText: '(2)' });
  await expect(twoUp.count().then(n => n === 1), 'the button says there are two entries on that shift');
  await twoUp.click();
  await page.waitForSelector('.note-entry');
  await expect(page.locator('.note-out:visible').textContent().then(t => /fortnightly shop/.test(t)), 'they can read it in their own account');
  await expect(page.locator('.note-out:visible').textContent().then(t => !/Need to add something/.test(t)), 'but they are not invited to write in the worker record');
  await page.screenshot({ path: 'shot-shiftnotes-participant.png' });

  console.log('— the office picks the flag up —');
  await api('/api/logout', {});
  await api('/api/login', { email: 'boss@test.com', password: 'password99' });
  await openAs('/admin');
  await admHas('Out-of-scope flags to follow up', 'the dashboard has a tile for it');
  await admHas('Shift notes on file', 'and a count of every note held');
  await admHas('flush the catheter', 'the flag is quoted in the queue, not summarised away');
  await admHas('0104', 'the queue says what to do when it is a 0104 support');
  await admHas('Download their notes', 'a participant\'s whole history is one click away for the auditor');
  await page.locator('[data-sn-review]').first().click();
  await toastSays('who you rang and what you told them', 'closing a flag without recording the outcome is refused');
  await page.locator('[data-sn-note]').first().fill('Rang Nita 27/07 — confirmed catheter flushing is 0104, told her she was right to decline. Polly being introduced to Coast Community Nursing.');
  await page.locator('[data-sn-review]').first().click();
  await toastSays('Recorded', 'recording what we did closes it');
  await admHas('Coast Community Nursing', 'and the record stays on the file');
  await page.screenshot({ path: 'shot-shiftnotes-admin.png', fullPage: true });

  if (errors.length) { bad('console errors: ' + errors.join(' | ')); } else { ok('no JavaScript errors anywhere in the run'); }
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
