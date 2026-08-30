#!/usr/bin/env node
'use strict';
/* BookIt — read the database from the command line, read-only.
   The guide's "last resort", made real. Opens the file read-only, so it
   cannot change anything; output is pipe-delimited, which pastes straight
   into a spreadsheet. Dates come back ISO (2026-07-30) — that is how they
   are stored; the site shows dd/mm/yyyy.

   node scripts/dbq.js bookit.db "SELECT id, name, email, role FROM users"
   node scripts/dbq.js "$DB_PATH" "SELECT u.name, p.screening_status, p.visible
     FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE p.visible = 0"

   With no SQL it lists the tables and their row counts. Only SELECT (and
   PRAGMA / EXPLAIN / WITH) is accepted — anything that could write is refused
   before it reaches SQLite, on top of the read-only open. */
const { DatabaseSync } = require('node:sqlite');
const [,, file, ...rest] = process.argv;
const sql = rest.join(' ').trim();
if (!file) { console.error('usage: node scripts/dbq.js <bookit.db> ["SELECT ..."]'); process.exit(2); }
if (sql && !/^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql)) { console.error('dbq is read-only: only SELECT / WITH / PRAGMA / EXPLAIN'); process.exit(2); }
let db;
try { db = new DatabaseSync(file, { readOnly: true }); }
catch (e) { console.error(`could not open ${file}: ${e.message}`); process.exit(1); }
try {
  if (!sql) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    for (const t of tables) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`).get().n;
      console.log(`${t.name}|${n}`);
    }
    process.exit(0);
  }
  const rows = db.prepare(sql).all();
  if (!rows.length) { console.log('(no rows)'); process.exit(0); }
  const cols = Object.keys(rows[0]);
  console.log(cols.join('|'));
  for (const r of rows) console.log(cols.map(c => String(r[c] ?? '').replace(/[\r\n|]/g, ' ')).join('|'));
} catch (e) {
  console.error(`query failed: ${e.message}`); process.exit(1);
}
