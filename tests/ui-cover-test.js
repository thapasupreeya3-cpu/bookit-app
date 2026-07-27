/* The cover front end, driven the way a person drives it.
   Three screens, three roles:
     · Maria the participant builds her care web and reorders it
     · Alex the worker says he can't make it, and Jo gets the offer
     · the office opens the board and finds it running itself
   The whole point of the feature is that the office screen stays empty, so the
   last section asserts that rather than asserting a button works. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1340, height: 1000 } });
  const B = 'http://localhost:3131';
  let pass = 0, fail = 0;
  const ok = m => { console.log('  ✓ ' + m); pass++; };
  const bad = m => { console.log('  ✗ ' + m); fail++; };
  const expect = async (cond, m) => { (await cond) ? ok(m) : bad(m); };
  const login = async (email) => {
    await page.evaluate(async (e) => {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
      await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ email: e, password: 'password99' }) });
    }, email);
  };
  /* goto() with only the hash changed does not reload, so boot never re-runs and
     API.me stays whoever was logged in first. Every navigation here reloads. */
  const nav = async (hash) => {
    if (!page.url().endsWith(hash)) await page.goto(B + hash);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
  };
  const bookings = () => nav('/#/bookings');

  console.log('— seed: one participant, three workers, one booking —');
  await page.goto(B, { waitUntil: 'networkidle' });
  const ids = await page.evaluate(async () => {
    const j = r => r.json();
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    const patch = (u, b) => fetch(u, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    const mk = async (name, email) => {
      const w = await j(await post('/api/register', { role: 'worker', name, email, password: 'password99', services: ['personal-care', 'household'] }));
      await post('/api/logout', {});
      return w.user.id;
    };
    const alex = await mk('Alex Nguyen', 'alex@example.com');
    const jo = await mk('Jo Whitton', 'jo@example.com');
    const sam = await mk('Sam Okafor', 'sam@example.com');
    await post('/api/register', { role: 'participant', name: 'The Office', email: 'boss@test.com', password: 'password99' });
    for (const id of [alex, jo, sam]) await post('/api/admin/workers/' + id + '/approve', { override: true });
    await post('/api/logout', {});
    await post('/api/register', { role: 'participant', name: 'Maria Silva', email: 'maria@example.com', password: 'password99' });
    /* far enough out that the cascade uses a real window rather than the 15-minute panic band */
    const date = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
    const bk = await j(await post('/api/bookings', { worker_id: alex, service: 'personal-care', date, start: '09:00', hours: 3 }));
    await post('/api/logout', {});
    await post('/api/login', { email: 'alex@example.com', password: 'password99' });
    await patch('/api/bookings/' + bk.id, { status: 'accepted' });
    await post('/api/logout', {});
    await post('/api/login', { email: 'maria@example.com', password: 'password99' });
    return { alex, jo, sam, bk: bk.id, date };
  });

  console.log('— Maria builds her care web —');
  await bookings();
  await page.waitForSelector('#cardCareWeb');
  ok('the care web card is on the bookings page');
  await expect(page.isVisible('.cw-sug'), 'people she has actually worked with are suggested');
  const sugNames = await page.textContent('.cw-sug');
  await expect(Promise.resolve(/Alex Nguyen/.test(sugNames)), 'Alex is suggested — she has a shift with him');

  /* add Jo and Sam from Find Workers rather than the suggestions, because they
     have no shift history with her yet — this is the cold-start path */
  await page.evaluate(async ({ jo, sam }) => {
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b) });
    await post('/api/me/care-web', { worker_id: sam, role: 'backup' });
    await post('/api/me/care-web', { worker_id: jo, role: 'backup' });
  }, ids);
  await bookings();
  await page.waitForSelector('.cw-item');
  const order1 = await page.evaluate(() => [...document.querySelectorAll('.cw-item .cw-body b')].map(b => b.textContent.trim()));
  await expect(Promise.resolve(order1.join(',') === 'Sam Okafor,Jo Whitton'), 'web renders in rank order: ' + order1.join(', '));
  await expect(page.evaluate(() => document.querySelector('.cw-item .cw-rank').classList.contains('cw-r1')), 'the person asked first is badged #1');
  await expect(page.evaluate(() => document.querySelector('.cw-item [data-cw-up]').disabled), '▲ is disabled at the top of the list');

  console.log('— she moves Jo to the top with the button, not a drag —');
  await page.click('.cw-item:nth-child(2) [data-cw-up]');
  await page.waitForFunction(() => {
    const n = document.querySelectorAll('.cw-item .cw-body b');
    return n.length === 2 && n[0].textContent.trim() === 'Jo Whitton';
  }, { timeout: 9000 });
  ok('▲ reorders the web — Jo is now first');
  const saved = await page.evaluate(async () => (await (await fetch('/api/me/care-web', { credentials: 'same-origin' })).json()).web.map(w => w.name));
  await expect(Promise.resolve(saved[0] === 'Jo Whitton'), 'the new order was saved to the server, not just the DOM');
  await expect(page.evaluate(() => /2 people are ready to step in/.test(document.querySelector('.cw-depth').textContent)), 'cover depth is stated before anything goes wrong');
  await page.screenshot({ path: 'shot-cover-1-care-web.png', clip: { x: 0, y: 0, width: 1340, height: 780 } });

  console.log('— Alex can\'t make it —');
  await login('alex@example.com');
  await bookings();
  await page.waitForSelector('[data-cant]');
  ok('the worker has an "I can\'t make it" button on a future shift');
  page.once('dialog', d => d.accept('Car broke down on the M1.'));
  await page.click('[data-cant]');
  await page.waitForTimeout(1400);
  const alexTxt = await page.textContent('#bookingsList');
  await expect(Promise.resolve(!/data-cant/.test(await page.innerHTML('#bookingsList'))), 'the button is gone once cover is open');

  console.log('— Jo is asked, and Maria can see who —');
  await login('jo@example.com');
  await bookings();
  await page.waitForSelector('.of-card');
  ok('Jo lands on a live cover offer at the top of her page');
  const offer = await page.textContent('.of-card');
  await expect(Promise.resolve(/Maria Silva/.test(offer)), 'the offer names the participant');
  await expect(Promise.resolve(/care web/.test(offer)), 'it tells her why she was asked first');
  await expect(Promise.resolve(/\$\d+\.\d\d to you/.test(offer)), 'it shows what she will be paid: ' + (offer.match(/\$[\d.]+ to you/) || [''])[0]);
  await expect(Promise.resolve(/Car broke down/.test(offer)), 'the reason Alex gave is passed on');
  await page.screenshot({ path: 'shot-cover-2-offer.png', clip: { x: 0, y: 0, width: 1340, height: 620 } });

  await login('maria@example.com');
  await bookings();
  await page.waitForSelector('.cv-strip');
  await page.waitForFunction(() => /Jo Whitton/.test((document.querySelector('.cv-chain') || {}).textContent || ''), { timeout: 9000 });
  ok('Maria sees the chain of who is being asked, live');
  const strip = await page.textContent('.cv-strip');
  await expect(Promise.resolve(/has \*?\*?not\*?\*? been cancelled|not.{0,3} been cancelled/i.test(strip)), 'the strip says the booking has NOT been cancelled');
  await expect(page.isVisible('[data-standdown]'), 'she can stand cover down if she would rather not have anyone');
  await page.screenshot({ path: 'shot-cover-3-finding.png', clip: { x: 0, y: 0, width: 1340, height: 780 } });

  console.log('— Jo says yes —');
  await login('jo@example.com');
  await bookings();
  await page.click('[data-offer-yes]');
  await page.waitForFunction(() => !document.querySelector('.of-card'), { timeout: 9000 });
  ok('the offer card clears once she accepts');
  await expect(page.evaluate(() => /Maria Silva/.test(document.querySelector('#bookingsList').textContent)), 'the shift is now in Jo\'s own bookings');

  await login('maria@example.com');
  await bookings();
  await page.waitForSelector('.cv-strip.done');
  const done = await page.textContent('.cv-strip.done');
  await expect(Promise.resolve(/Covered/.test(done) && /Jo Whitton/.test(done)), 'Maria\'s shift reads "Covered ✓ — Jo Whitton"');
  await expect(page.evaluate(() => !document.querySelector('[data-standdown]')), 'the stand-down button is gone now it is covered');

  console.log('— the worker standby panel —');
  await login('sam@example.com');
  await bookings();
  await page.waitForSelector('#cardStandby');
  const sb = await page.textContent('#cardStandby');
  await expect(Promise.resolve(/\$25\.66/.test(sb)), 'the SCHADS weekday on-call allowance is shown to the worker: $25.66');
  await expect(Promise.resolve(/\$50\.81/.test(sb)), 'and the weekend/public holiday one: $50.81');
  await expect(Promise.resolve(/whether or not we call you/.test(sb)), 'it is explicit that the allowance is paid either way');
  await page.check('#sbOptin');
  await page.selectOption('#sbMax', '3');
  await page.click('#sbSave');
  await page.waitForTimeout(1200);
  const optedIn = await page.evaluate(async () => (await (await fetch('/api/me/offers', { credentials: 'same-origin' })).json()).standby_optin);
  await expect(Promise.resolve(!!optedIn), 'opting in to the bench saves');
  await page.screenshot({ path: 'shot-cover-4-standby.png', clip: { x: 0, y: 0, width: 1340, height: 700 } });

  console.log('— the office board —');
  await login('boss@test.com');
  await nav('/#/admin');
  await page.waitForSelector('.adm-tiles');
  await page.waitForFunction(() => /Cover — when a worker can/.test(document.querySelector('#adminContent').textContent), { timeout: 12000 });
  ok('the cover board is on the admin page');
  const board = await page.textContent('#adminContent');
  await expect(Promise.resolve(/Nothing open/.test(board)), 'nothing is open — the cascade handled it with no human');
  await expect(Promise.resolve(/Filled with no human/.test(board)), 'the board reports the hands-off rate as a headline number');
  await expect(Promise.resolve(/cl\.25\.5\(f\)/.test(board)), 'the bench explains why nobody is rostered a standby shift');
  await expect(Promise.resolve(/never offered|No partner providers/.test(board)), 'a partner with no agreement on file is visibly gated');

  console.log('— add a partner provider from the form —');
  await page.click('summary:has-text("Add a partner provider")');
  await page.fill('#apName', 'Coastal Care Services');
  await page.fill('#apEmail', 'ops@coastalcare.example');
  await page.fill('#apAgree', 'DMHC-SUB-2026-01');
  await page.check('input[name="apGrp"][value="0107"]');
  ok('the registration-group pill carries the real group code (0107), not a slug');
  await page.click('#apSave');
  await page.waitForFunction(() => /Coastal Care Services/.test(document.querySelector('#adminContent').textContent), { timeout: 12000 });
  ok('the provider is saved and appears in the partner table');
  const after = await page.textContent('#adminContent');
  await expect(Promise.resolve(/DMHC-SUB-2026-01/.test(after)), 'the agreement reference — the gate on ever being offered a shift — is shown');
  await page.screenshot({ path: 'shot-cover-5-board.png', clip: { x: 0, y: 0, width: 1340, height: 1000 } });

  console.log('— nothing threw along the way —');
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await nav('/#/bookings');
  await nav('/#/admin');
  await page.waitForTimeout(1200);
  await expect(Promise.resolve(errs.length === 0), 'no uncaught JavaScript on either page' + (errs.length ? ': ' + errs[0] : ''));

  console.log('\nUI RESULT: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
