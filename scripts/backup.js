#!/usr/bin/env node
'use strict';
/* BookIt — consistent backup of the database and the two document folders.

   Why this exists: bookit.db runs in WAL mode. A plain `cp` of a live WAL
   database can miss committed rows sitting in bookit.db-wal, so the copy on
   the shelf is not the database the office was using. `VACUUM INTO` asks
   SQLite itself to write a complete, consistent, single-file copy while the
   site keeps running — no stop, no sidecar files, no lock on writers.

   What one run produces, under BACKUP_DIR (default: backups/ beside the db):

     bookit-2026-08-29-021500/
       bookit.db             consistent copy, integrity-checked
       bookit-docs.tar.gz    every uploaded document
       bookit-photos.tar.gz  every profile photo
       manifest.json         row counts, file counts, sha256 of each part,
                             and every row (documents, templates, profile
                             photos) whose file is NOT in the archive that
                             was just written — if there are any, the run
                             still writes and copies the set, then exits 2
                             so the timer shows it

   Then it prunes sets older than BACKUP_KEEP_DAYS (default 35, never fewer
   than BACKUP_KEEP_MIN sets, default 3), and, if BACKUP_S3_URI is set and the
   aws CLI is installed, syncs the new set off the instance.

   What is and is not atomic. The database copy is a single consistent
   snapshot. The two folders are archived a few seconds later, so a document
   uploaded or deleted in between can differ from the snapshot. A deletion in
   that window is caught: every file the snapshot refers to is checked against
   the archive's own listing, not the live folder, and named in the manifest
   and the log. An upload in that window is harmless (the file is in the
   archive; its row arrives with the next night's snapshot). If you want the
   whole set taken from one frozen moment, stop the site around the run — see
   the commented ExecStartPre/ExecStopPost lines in ops/bookit-backup.service.

   Settings — the same names the service uses, so run it with the service's
   environment file and the paths cannot disagree:
     DB_PATH, DOCS_DIR, PHOTOS_DIR         as in /etc/bookit.env
     BACKUP_DIR                            where sets are written
     BACKUP_KEEP_DAYS, BACKUP_KEEP_MIN     pruning
     BACKUP_S3_URI                         e.g. s3://dmhc-bookit-backups/bookit
     BACKUP_ALLOW_MISSING_DIRS=1           only for a fresh install: the server
                                           creates both folders at boot, so on a
                                           running site a missing folder means
                                           the path is wrong, and the run fails.

   Run:   node scripts/backup.js            (see ops/bookit-backup.timer)
          node scripts/backup.js --dry-run  (says what it would do)

   Restore, with the site stopped, into CLEAN folders, then swap — never
   extract over the live folders, which would keep files from a later state:
     sudo systemctl stop bookit
     SET=backups/bookit-<set>
     sha256sum -c <(node -e 'const m=require("./'"$SET"'/manifest.json");for(const [f,p] of Object.entries(m.parts))console.log(p.sha256+"  '"$SET"'/"+f)')
     rm -f "$DB_PATH-wal" "$DB_PATH-shm"                 # stale sidecars of the OLD db
     cp "$SET/bookit.db" "$DB_PATH"
     mkdir /tmp/restore && tar -xzf "$SET/bookit-docs.tar.gz" -C /tmp/restore && tar -xzf "$SET/bookit-photos.tar.gz" -C /tmp/restore
     mv "$DOCS_DIR" "$DOCS_DIR.before-restore" && mv /tmp/restore/bookit-docs "$DOCS_DIR"
     mv "$PHOTOS_DIR" "$PHOTOS_DIR.before-restore" && mv /tmp/restore/bookit-photos "$PHOTOS_DIR"
     sudo systemctl start bookit
   Then open Admin › Participant files and Credentials and open one document
   from each. Exit code is non-zero on any failure, so a systemd timer shows it
   in `systemctl --failed` and `journalctl -u bookit-backup`. */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

try { process.umask(0o077); } catch (_) {}

const DRY = process.argv.includes('--dry-run');
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(ROOT, 'bookit.db'));
const DATA_DIR = path.dirname(DB_PATH);
const DOCS_DIR = path.resolve(process.env.DOCS_DIR || path.join(DATA_DIR, 'bookit-docs'));
const PHOTOS_DIR = path.resolve(process.env.PHOTOS_DIR || path.join(DATA_DIR, 'bookit-photos'));
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'));
const KEEP_DAYS = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS || 35));
const KEEP_MIN = Math.max(1, Number(process.env.BACKUP_KEEP_MIN || 3));
const S3_URI = String(process.env.BACKUP_S3_URI || '').trim();
const ALLOW_MISSING = /^(1|true|yes|on)$/i.test(process.env.BACKUP_ALLOW_MISSING_DIRS || '');

const log = (...a) => console.log(`[backup ${new Date().toISOString()}]`, ...a);
const warn = (...a) => console.warn(`[backup ${new Date().toISOString()}] WARNING:`, ...a);
function fail(msg) { console.error(`[backup] FAILED: ${msg}`); process.exit(1); }

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
/* streamed, so a multi-gigabyte database is never held in memory on a 1 GB box */
function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
function countRows(db, table) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } catch { return null; }
}
const TABLES = ['users', 'bookings', 'worker_docs', 'participant_docs', 'incidents', 'complaints', 'shift_notes', 'support_plans'];

async function main() {
  /* ---- 0. preconditions ---- */
  if (!fs.existsSync(DB_PATH)) fail(`database not found at ${DB_PATH} — run with the service's environment (EnvironmentFile=/etc/bookit.env) so DB_PATH matches`);
  for (const [name, dir] of [['DOCS_DIR', DOCS_DIR], ['PHOTOS_DIR', PHOTOS_DIR]]) {
    if (fs.existsSync(dir)) continue;
    if (ALLOW_MISSING) warn(`${name} ${dir} does not exist — skipped because BACKUP_ALLOW_MISSING_DIRS is set`);
    else fail(`${name} ${dir} does not exist. The server creates it at boot, so on a running site this means the path is wrong. Check: sudo systemctl show bookit -p Environment`);
  }
  if (BACKUP_DIR.startsWith(path.join(ROOT, 'public'))) fail('BACKUP_DIR must not be inside public/');

  let setName = `bookit-${stamp()}`;
  for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, setName)); i++) setName = `bookit-${stamp()}-${i}`; /* never overwrite a set */
  const setDir = path.join(BACKUP_DIR, setName);
  log(`source db ${DB_PATH} · docs ${DOCS_DIR} · photos ${PHOTOS_DIR}`);
  log(`writing ${setDir}${DRY ? ' (dry run — nothing written)' : ''}`);
  if (DRY) return;

  fs.mkdirSync(setDir, { recursive: true, mode: 0o700 });
  const manifest = { set: setName, created: new Date().toISOString(), source: { db: DB_PATH, docs: DOCS_DIR, photos: PHOTOS_DIR },
    parts: {}, counts: {}, missing_from_archive: [], notes: [] };

  /* ---- 1. the database: a consistent copy from a live WAL file ---- */
  const dbCopy = path.join(setDir, 'bookit.db');
  try {
    const src = new DatabaseSync(DB_PATH, { readOnly: true });
    /* VACUUM INTO refuses an existing target and runs in its own read
       transaction, so writers on the live site are never blocked. */
    src.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
    /* Read after the snapshot, on the live database: these are for the log
       and the manifest only. The site may legitimately write between the
       snapshot and this read, so a difference is reported, never fatal. */
    for (const t of TABLES) manifest.counts[t] = { live_after_snapshot: countRows(src, t) };
    src.close();
  } catch (e) {
    fail(`could not copy the database: ${e.message}`);
  }

  /* ---- 2. the hard gate: the copy must be whole ---- */
  const referenced = { docs: [], photos: [] };
  try {
    const chk = new DatabaseSync(dbCopy, { readOnly: true });
    const integrity = chk.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]).join('; ');
    if (integrity !== 'ok') fail(`integrity_check on the copy returned: ${integrity}`);
    for (const t of TABLES) {
      const n = countRows(chk, t);
      if (n === null) fail(`table ${t} is missing from the copy`);
      manifest.counts[t].snapshot = n;
      if (manifest.counts[t].live_after_snapshot !== n) manifest.notes.push(`${t}: snapshot ${n}, live read a moment later ${manifest.counts[t].live_after_snapshot} — the site wrote during the run`);
    }
    /* every column that points at a file on disk: the four document tables
       and the two profile-photo columns */
    for (const [table, owner, col] of [['worker_docs', 'worker_id', 'file_path'], ['participant_docs', 'participant_id', 'file_path'], ['form_templates', 'form_key', 'file_path'], ['form_template_versions', 'form_key', 'file_path'], ['users', 'id', 'photo'], ['worker_profiles', 'user_id', 'photo']]) {
      let rows = [];
      try { rows = chk.prepare(`SELECT rowid AS id, ${owner} AS owner, ${col} AS file_path FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`).all(); } catch { continue; }
      for (const r of rows) {
        if (!/^[/\\]/.test(r.file_path) && !/^[A-Za-z]:/.test(r.file_path)) continue;   /* a URL or a colour, not a file */
        const fp = path.resolve(r.file_path);
        const bucket = fp.startsWith(PHOTOS_DIR + path.sep) ? 'photos' : 'docs';
        referenced[bucket].push({ table, column: col, id: r.id, owner: r.owner, file_path: fp });
      }
    }
    chk.close();
  } catch (e) {
    fail(`could not verify the copy: ${e.message}`);
  }
  manifest.parts['bookit.db'] = { bytes: fs.statSync(dbCopy).size, sha256: await sha256(dbCopy) };
  log(`database copied and verified · ${TABLES.map(t => `${t} ${manifest.counts[t].snapshot}`).join(', ')}`);
  for (const n of manifest.notes) warn(n);

  /* ---- 3. the two folders, then check the snapshot's files against the archive itself ---- */
  for (const [label, dir, bucket] of [['bookit-docs', DOCS_DIR, 'docs'], ['bookit-photos', PHOTOS_DIR, 'photos']]) {
    if (!fs.existsSync(dir)) continue;
    const out = path.join(setDir, `${label}.tar.gz`);
    try {
      execFileSync('tar', ['-czf', out, '-C', path.dirname(dir), path.basename(dir)], { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch (e) {
      fail(`tar of ${dir} failed: ${e.message}`);
    }
    let members;
    try {
      members = new Set(execFileSync('tar', ['-tzf', out], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n').filter(Boolean).map(m => path.resolve(path.dirname(dir), m)));
    } catch (e) {
      fail(`could not list ${out}: ${e.message}`);
    }
    for (const r of referenced[bucket]) {
      if (r.file_path.startsWith(dir + path.sep) && !members.has(r.file_path)) manifest.missing_from_archive.push({ ...r, archive: `${label}.tar.gz` });
    }
    const files = [...members].filter(m => m !== dir).length;
    manifest.parts[`${label}.tar.gz`] = { bytes: fs.statSync(out).size, sha256: await sha256(out), files };
    log(`${label}: ${files} file(s) → ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
  }
  const incomplete = manifest.missing_from_archive.length > 0;
  if (incomplete) {
    warn(`${manifest.missing_from_archive.length} row(s) in the snapshot refer to a file that is NOT in tonight's archive — see manifest.json. The set is written and copied off the instance as usual, but this run ends INCOMPLETE (exit 2) so the timer shows it: a set that cannot restore what its own database refers to must not read as green.`);
  }

  fs.writeFileSync(path.join(setDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  /* ---- 4. prune: by age, but never below KEEP_MIN sets ---- */
  const sets = fs.readdirSync(BACKUP_DIR).filter(n => /^bookit-\d{4}-\d{2}-\d{2}-\d{4,6}(-\d+)?$/.test(n)).sort();
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  let pruned = 0;
  for (const n of sets.slice(0, Math.max(0, sets.length - KEEP_MIN))) {
    const m = /^bookit-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})?(?:-\d+)?$/.exec(n);
    const when = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`).getTime();
    if (when < cutoff) { fs.rmSync(path.join(BACKUP_DIR, n), { recursive: true, force: true }); pruned++; }
  }
  if (pruned) log(`pruned ${pruned} set(s) older than ${KEEP_DAYS} days`);

  /* ---- 5. off the instance ---- */
  if (S3_URI) {
    try {
      execFileSync('aws', ['s3', 'sync', setDir, `${S3_URI.replace(/\/+$/, '')}/${setName}`, '--only-show-errors'], { stdio: 'inherit' });
      log(`synced to ${S3_URI}/${setName}`);
    } catch (e) {
      fail(`S3 sync failed (the local set is complete): ${e.message}`);
    }
  } else {
    warn('BACKUP_S3_URI not set — this set exists only on this machine. Instance snapshots are not a substitute for an off-instance copy of the records.');
  }

  log(`done: ${setName} (${Object.values(manifest.parts).reduce((n, p) => n + p.bytes, 0) / 1048576 | 0} MB)`);
  if (incomplete) {
    console.error(`[backup] INCOMPLETE: ${manifest.missing_from_archive.length} file reference(s) from the database were absent from the archives — ${path.join(setDir, 'manifest.json')} names each one. Fix the rows or the files; the next clean run goes green again.`);
    process.exitCode = 2;
  }
}

main().catch(e => fail(e && e.message ? e.message : String(e)));
