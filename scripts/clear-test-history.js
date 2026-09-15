/* clear-test-history.js — remove a TEST participant's bookings, including
   completed ones, and every row anywhere that points at those bookings or
   their invoices, so that reset-walkthrough.js can then reset the account.

   This exists for the walkthrough accounts only. It is deliberately not part
   of the app and it is not reversible. Run on the server with the service
   stopped:

     sudo systemctl stop bookit
     sudo env DB_PATH=/opt/bookit-data/bookit.db node clear-test-history.js you+participant@gmail.com        # dry run: shows what would go
     sudo env DB_PATH=/opt/bookit-data/bookit.db node clear-test-history.js you+participant@gmail.com --yes  # does it
     sudo chown bookit:bookit /opt/bookit-data/bookit.db*
     sudo systemctl start bookit

   With --all-bookings instead of an email it clears EVERY booking, invoice
   and pay batch on the site (all people, all statuses) and keeps accounts,
   documents, registers, messages and settings:

     sudo env DB_PATH=/opt/bookit-data/bookit.db node clear-test-history.js --all-bookings        # dry run
     sudo env DB_PATH=/opt/bookit-data/bookit.db node clear-test-history.js --all-bookings --yes

   With an email it refuses any account that is not a participant, and it
   never touches another person's rows: everything it removes is selected by
   this person's booking ids and invoice numbers. Foreign keys are switched off while it
   works and a foreign-key check afterwards removes anything left dangling
   (the same approach the app's own launch sweep uses).                      */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const args = process.argv.slice(2);
const email = (args.find(a => !a.startsWith('--')) || '').trim().toLowerCase();
const yes = args.includes('--yes');
const everything = args.includes('--all-bookings');
const dbPath = process.env.DB_PATH || process.env.BOOKIT_DB;
if ((!email && !everything) || !dbPath) { console.error('usage: DB_PATH=/opt/bookit-data/bookit.db node clear-test-history.js (participant@example.com | --all-bookings) [--yes]'); process.exit(2); }
const db = new DatabaseSync(dbPath);
let u = { id: null, name: 'Everyone', email: 'all accounts' };
if (!everything) {
  u = db.prepare('SELECT id, name, email, role FROM users WHERE lower(email) = ?').get(email);
  if (!u) { console.error(`No account with the email ${email}.`); process.exit(1); }
  if (u.role !== 'participant') { console.error(`${u.name} is a ${u.role}, not a participant. Nothing changed.`); process.exit(1); }
}
const bookings = everything ? db.prepare('SELECT id, invoice_no, status FROM bookings').all() : db.prepare('SELECT id, invoice_no, status FROM bookings WHERE participant_id = ?').all(u.id);
const ids = bookings.map(b => b.id);
const invoices = [...new Set(bookings.map(b => b.invoice_no).filter(Boolean))];
console.log(everything ? '\nEvery booking and invoice on the site' : `\n${u.name} <${u.email}> — participant #${u.id}`);
console.log(`  bookings: ${bookings.length} (${Object.entries(bookings.reduce((m, b) => (m[b.status] = (m[b.status] || 0) + 1, m), {})).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'})`);
console.log(`  invoices: ${invoices.length}${invoices.length ? ' (' + invoices.join(', ') + ')' : ''}`);
if (!ids.length) { console.log('\nNothing to clear.'); process.exit(0); }
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
const colsOf = t => db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
const plan = [];
for (const t of tables) {
  if (t === 'bookings') continue;
  const cols = colsOf(t);
  if (cols.includes('booking_id')) plan.push({ table: t, col: 'booking_id', keys: ids });
  if (invoices.length && cols.includes('invoice_no')) plan.push({ table: t, col: 'invoice_no', keys: invoices });
}
/* pay batches are built from completed bookings; with the bookings gone they would point at nothing */
const payTables = everything ? ['payroll_lines', 'payroll_notification_events', 'payroll_batches'].filter(t => tables.includes(t)) : [];
const ph = keys => keys.map(() => '?').join(',');
console.log('\nRows that point at those bookings or invoices:');
let totalPlanned = 0;
for (const p of plan) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM "${p.table}" WHERE "${p.col}" IN (${ph(p.keys)})`).get(...p.keys).n;
  if (n) { console.log(`  ${p.table}.${p.col}: ${n}`); totalPlanned += n; }
}
for (const t of payTables) { const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n; if (n) console.log(`  ${t}: ${n} (all)`); }
console.log(`  bookings: ${ids.length}`);
if (!yes) { console.log('\nDry run — nothing changed. Add --yes to remove the rows above.'); process.exit(0); }
db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN');
let removed = 0;
try {
  for (const p of plan) removed += Number(db.prepare(`DELETE FROM "${p.table}" WHERE "${p.col}" IN (${ph(p.keys)})`).run(...p.keys).changes);
  for (const t of payTables) removed += Number(db.prepare(`DELETE FROM "${t}"`).run().changes);
  removed += Number(db.prepare(everything ? 'DELETE FROM bookings' : `DELETE FROM bookings WHERE id IN (${ph(ids)})`).run(...(everything ? [] : ids)).changes);
  /* anything now pointing at a row that is gone */
  let orphans = 0;
  for (let pass = 0; pass < 8; pass++) {
    const bad = db.prepare('PRAGMA foreign_key_check').all().filter(r => r.rowid !== null && r.rowid !== undefined);
    if (!bad.length) break;
    const byTable = new Map();
    for (const r of bad) { if (!byTable.has(r.table)) byTable.set(r.table, new Set()); byTable.get(r.table).add(r.rowid); }
    for (const [t, rows] of byTable) orphans += Number(db.prepare(`DELETE FROM "${t}" WHERE rowid IN (${[...rows].map(() => '?').join(',')})`).run(...rows).changes);
  }
  db.exec('COMMIT');
  console.log(`\nRemoved ${removed} rows${orphans ? ` and ${orphans} rows left dangling` : ''}. ${everything ? 'The site has no bookings, invoices or pay batches now.' : u.name + ' has no service history now — run reset-walkthrough.js next.'}`);
} catch (e) { db.exec('ROLLBACK'); console.error('\nFailed, nothing changed:', e.message); process.exit(1); }
finally { db.exec('PRAGMA foreign_keys = ON'); }
