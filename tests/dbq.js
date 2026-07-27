/* tiny query helper for the shell tests — there is no sqlite3 CLI in here */
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2]);
const sql = process.argv.slice(3).join(' ');
try {
  if (/^\s*(select|pragma|with)/i.test(sql)) {
    const rows = db.prepare(sql).all();
    console.log(rows.map(r => Object.values(r).map(v => v === null ? '' : v).join('|')).join('\n'));
  } else { db.prepare(sql).run(); }
} catch (e) { console.error('DBQ ERROR:', e.message); process.exit(1); }
