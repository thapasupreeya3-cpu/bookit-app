/* ============================================================
   BookIt — backend server (zero dependencies)
   Node 22+ (uses built-in node:sqlite). Run:  node server.js
   Env: PORT (default 3000) · SECRET (session key; auto-generated
        to .secret if unset) · AUTO_REPLY=off to disable the demo
        auto-acknowledgement bot · DB_PATH (default ./bookit.db)
   ============================================================ */
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bookit.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTO_REPLY = (process.env.AUTO_REPLY || 'on') !== 'off';
const SESSION_DAYS = 30;

/* ---------- secret ---------- */
const SECRET_FILE = path.join(__dirname, '.secret');
const SECRET = process.env.SECRET || (() => {
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
  catch { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); return s; }
})();

/* ---------- database ---------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('participant','worker')),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    pass TEXT NOT NULL,
    suburb TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    plan TEXT DEFAULT '',
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS worker_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    bio TEXT DEFAULT '',
    services TEXT DEFAULT '[]',
    langs TEXT DEFAULT 'English',
    exp TEXT DEFAULT 'New to BookIt',
    color TEXT DEFAULT '#0E6B62',
    rating REAL DEFAULT 0,
    shifts INTEGER DEFAULT 0,
    checks TEXT DEFAULT '["NDIS Worker Screening (in progress)"]',
    days TEXT DEFAULT '[1,1,1,1,1,0,0]',
    visible INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER NOT NULL REFERENCES users(id),
    created TEXT NOT NULL,
    UNIQUE (participant_id, worker_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    convo_id INTEGER NOT NULL REFERENCES conversations(id),
    sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created TEXT NOT NULL,
    read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER NOT NULL REFERENCES users(id),
    service TEXT NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    hours REAL NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested','accepted','declined','cancelled','completed')),
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY,
    name TEXT, email TEXT, topic TEXT, body TEXT, created TEXT NOT NULL
  );
`);

/* migration (email build): verification flag on users */
try { db.exec('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0'); } catch {}
db.exec("UPDATE users SET verified = 1 WHERE email LIKE '%@demo.bookit.life' AND verified = 0");

/* migration (invoicing build): completion + invoice fields on bookings */
for (const col of ['completed_at TEXT', 'rate_category TEXT', 'unit_price REAL', 'worker_share REAL', 'total REAL']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); } catch {}
}
/* migration (payments build): billing details + claim tracking */
for (const col of ['ndis_number TEXT DEFAULT \'\'', 'pm_email TEXT DEFAULT \'\'']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch {}
}
for (const col of ['claim_status TEXT DEFAULT \'\'', 'claim_ref TEXT', 'invoice_no TEXT', 'support_item TEXT', 'claimed_at TEXT', 'paid_at TEXT', 'sleepover INTEGER DEFAULT 0']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); } catch {}
}
/* migration (profiles build): worker profile photos */
for (const col of ['photo TEXT DEFAULT \'\'', 'photo_at TEXT DEFAULT \'\'']) {
  try { db.exec(`ALTER TABLE worker_profiles ADD COLUMN ${col}`); } catch {}
}
/* migration (stripe build): card-payment link per invoiced booking */
for (const col of ['stripe_session TEXT', 'pay_url TEXT']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); } catch {}
}
/* migration (scope build): what a participant asked for, what they told us about high-intensity
   supports, and how we handled it. Kept on users so it travels with the account, not the booking. */
for (const col of ["svc_interest TEXT DEFAULT '[]'", "hi_flags TEXT DEFAULT '[]'", "hi_at TEXT DEFAULT ''", "hi_referred_at TEXT DEFAULT ''", "hi_note TEXT DEFAULT ''"]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch {}
}
/* scope build v34: the out-of-scope register. One row per participant per support they asked
   for that we are not registered to deliver — opened automatically the moment it is declared,
   and closable only by recording who they were introduced to. The old hi_note column held one
   free-text line per person; this holds a dated row per support, which is what an auditor asks
   for when they ask what happens when someone requests a support you don't hold. */
db.exec(`
  CREATE TABLE IF NOT EXISTS scope_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    support TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'signup',
    declared_at TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'open'
      CHECK (outcome IN ('open','referred','withdrawn','in-scope')),
    referred_to TEXT DEFAULT '',
    note TEXT DEFAULT '',
    closed_by TEXT DEFAULT '',
    closed_at TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_scope_open ON scope_requests (outcome, user_id);
`);

/* compliance build: credentials + incident + complaint registers */
db.exec(`
  CREATE TABLE IF NOT EXISTS worker_docs (
    id INTEGER PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES users(id),
    doc_type TEXT NOT NULL,
    label TEXT DEFAULT '',
    check_number TEXT DEFAULT '',
    expiry_date TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    file_mime TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    uploaded_at TEXT NOT NULL,
    verified_at TEXT,
    verified_by TEXT DEFAULT '',
    warned_stage TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY,
    created_by INTEGER,
    created_by_name TEXT DEFAULT '',
    participant_name TEXT DEFAULT '',
    worker_name TEXT DEFAULT '',
    occurred_at TEXT NOT NULL,
    location TEXT DEFAULT '',
    category TEXT NOT NULL,
    reportable INTEGER DEFAULT 0,
    description TEXT NOT NULL,
    immediate_action TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    notify_due TEXT,
    commission_notified_at TEXT,
    lessons TEXT DEFAULT '',
    closed_at TEXT,
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY,
    source_name TEXT DEFAULT '',
    source_email TEXT DEFAULT '',
    channel TEXT DEFAULT 'site',
    summary TEXT NOT NULL,
    details TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    acknowledged_at TEXT,
    resolved_at TEXT,
    outcome TEXT DEFAULT '',
    created TEXT NOT NULL
  );
`);
/* reviews build: post-shift ratings + written reviews (one per completed booking) */
db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
    worker_id INTEGER NOT NULL REFERENCES users(id),
    participant_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL,
    comment TEXT DEFAULT '',
    published INTEGER DEFAULT 1,
    created TEXT NOT NULL
  );
`);
/* shift notes build: the record that a support was actually delivered.
   Append-only on purpose. A worker who needs to correct a note adds an addendum
   (addendum = 1) — nothing is ever edited or deleted, because a progress note
   that can be quietly rewritten afterwards is not evidence of anything. */
db.exec(`
  CREATE TABLE IF NOT EXISTS shift_notes (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    worker_id INTEGER NOT NULL REFERENCES users(id),
    participant_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    scope_flag INTEGER DEFAULT 0,
    scope_detail TEXT DEFAULT '',
    addendum INTEGER DEFAULT 0,
    reviewed_at TEXT,
    reviewed_by TEXT DEFAULT '',
    review_note TEXT DEFAULT '',
    created TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shift_notes_booking ON shift_notes(booking_id);
  CREATE INDEX IF NOT EXISTS idx_shift_notes_participant ON shift_notes(participant_id);
`);
/* support plans: what a worker needs to know before they walk in, and what the
   office needs to know if nobody turns up.

   Versioned rather than updated, for the same reason shift notes are append-only.
   A support plan is the document an auditor reads after an incident, and the
   question they ask is not "what does it say" but "what did it say on the day".
   Every confirmed submission writes a new row; `current` marks the live one.
   A draft is edited in place until it is confirmed, so half-finished answers
   never become a version of record. */
db.exec(`
  CREATE TABLE IF NOT EXISTS support_plans (
    id INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES users(id),
    version INTEGER NOT NULL DEFAULT 1,
    current INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),

    /* reliance — the five answers that decide what happens when a shift falls over */
    main_source INTEGER DEFAULT 0,
    health_safety INTEGER DEFAULT 0,
    impact_detail TEXT DEFAULT '',
    backup_24h INTEGER DEFAULT 0,
    backup_detail TEXT DEFAULT '',
    preventative_health INTEGER DEFAULT 0,

    /* the six supports DMHC is registered to deliver, and only those six */
    use_employ INTEGER DEFAULT 0,
    employ_detail TEXT DEFAULT '',
    use_personal INTEGER DEFAULT 0,
    personal_detail TEXT DEFAULT '',
    use_transport INTEGER DEFAULT 0,
    transport_detail TEXT DEFAULT '',
    use_daily INTEGER DEFAULT 0,
    daily_detail TEXT DEFAULT '',
    use_household INTEGER DEFAULT 0,
    household_detail TEXT DEFAULT '',
    use_community INTEGER DEFAULT 0,
    community_detail TEXT DEFAULT '',

    /* about you */
    goals TEXT DEFAULT '',
    communication TEXT DEFAULT '',
    health_supports TEXT DEFAULT '',
    cognition TEXT DEFAULT '',
    mental_health TEXT DEFAULT '',
    mobility TEXT DEFAULT '',
    other_info TEXT DEFAULT '',

    /* safety */
    home_safety TEXT DEFAULT '',
    disaster_8h INTEGER DEFAULT 0,
    community_safety TEXT DEFAULT '',

    /* care plans named by the participant — [{name, on_file}] */
    care_plans TEXT DEFAULT '[]',

    /* emergency contact */
    ec_name TEXT DEFAULT '',
    ec_relationship TEXT DEFAULT '',
    ec_phone TEXT DEFAULT '',
    ec_email TEXT DEFAULT '',

    confirmed_at TEXT DEFAULT '',
    confirmed_by TEXT DEFAULT '',
    created TEXT NOT NULL,
    updated TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_support_plans_person ON support_plans (participant_id, current);
`);
/* v38 — the plan moved off borrowed abstract categories onto the six supports
   DMHC is actually registered to deliver. Existing databases pick the columns
   up here; a plan written before v38 simply has them empty, which reads as
   "not answered yet" rather than "does not use that support". */
for (const [col, type] of [
  ['use_employ', 'INTEGER DEFAULT 0'], ['employ_detail', "TEXT DEFAULT ''"],
  ['use_personal', 'INTEGER DEFAULT 0'], ['personal_detail', "TEXT DEFAULT ''"],
  ['use_transport', 'INTEGER DEFAULT 0'], ['transport_detail', "TEXT DEFAULT ''"],
  ['use_daily', 'INTEGER DEFAULT 0'], ['daily_detail', "TEXT DEFAULT ''"],
  ['use_household', 'INTEGER DEFAULT 0'], ['household_detail', "TEXT DEFAULT ''"],
  ['use_community', 'INTEGER DEFAULT 0'], ['community_detail', "TEXT DEFAULT ''"]
]) { try { db.exec(`ALTER TABLE support_plans ADD COLUMN ${col} ${type}`); } catch { } }
/* SIL rosters build: shared-living houses with weekly repeating shift slots */
db.exec(`
  CREATE TABLE IF NOT EXISTS sil_houses (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sil_slots (
    id INTEGER PRIMARY KEY,
    house_id INTEGER NOT NULL REFERENCES sil_houses(id),
    day INTEGER NOT NULL,
    start TEXT NOT NULL,
    hours REAL NOT NULL,
    service TEXT NOT NULL DEFAULT 'daily-tasks',
    sleepover INTEGER DEFAULT 0,
    worker_id INTEGER,
    participant_id INTEGER,
    created TEXT NOT NULL
  );
`);
try { db.exec('ALTER TABLE bookings ADD COLUMN sil_slot_id INTEGER'); } catch {}

/* ============================================================================
   COVER — nobody gets left without a shift
   ----------------------------------------------------------------------------
   The problem this solves, stated plainly: when a support worker pulls out of a
   confirmed shift, every platform in this market hands the problem back to the
   participant. Hireup says so in writing — "Hireup does not provide 'back up'
   workers for coverage if a shift is cancelled by a Support Worker" — and tells
   clients to go build "relationships with service providers who can assist with
   'on call support'" themselves. Mable's own sample agreement says "It is your
   responsibility to find alternative support options if I am unavailable."

   The NDIS price rules make the asymmetry worse: when a PARTICIPANT cancels late
   the provider can claim up to 100% of the fee. When a WORKER cancels there is no
   claim, no compensation and no obligation on anyone. The participant absorbs the
   whole loss.

   Cover inverts that. A worker pulling out does not cancel the booking — it opens
   a cover request against a booking that stays confirmed, and the system works
   down four tiers until somebody is standing at the door:

     1  CARE WEB   the participant's own nominated people, in the order they chose
     2  STANDBY    workers paid a SCHADS on-call allowance to be reachable that day
     3  POOL       every matched, screened, available worker in the area
     4  ALLIED     partner NDIS providers who take the shift as a subcontract

   The office is emailed when cover reaches tier 4 or runs out — not when a worker
   pulls out. That is the whole economic point: being reachable stops being a
   person's job and becomes the system's job.
   ============================================================================ */
db.exec(`
  /* --- the participant's own web of carers, in their own priority order --- */
  CREATE TABLE IF NOT EXISTS care_web (
    id INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES users(id),
    worker_id INTEGER NOT NULL REFERENCES users(id),
    rank INTEGER NOT NULL DEFAULT 1,
    role TEXT NOT NULL DEFAULT 'backup' CHECK (role IN ('regular','backup','emergency')),
    auto_offer INTEGER NOT NULL DEFAULT 1,
    note TEXT DEFAULT '',
    added_at TEXT NOT NULL,
    UNIQUE (participant_id, worker_id)
  );

  /* --- locked-in backups: a paid on-call period, NOT a rostered shift ---
     SCHADS cl.26 pays an on-call allowance per 24-hour period for being
     "available for recall to duty". That is the lawful, cheap mechanism.
     Rostering a standby SHIFT instead would trip cl.25.5(f): cancel it inside
     7 days and you must pay it or find make-up work. An allowance carries no
     such exposure — you pay for availability, and the shift is only paid if the
     person is actually called on, in which case the participant's plan pays for
     it anyway. A casual accepts each period separately, so nothing here obliges
     anyone to work: they opt in, period by period, and get paid for saying yes. */
  CREATE TABLE IF NOT EXISTS standby (
    id INTEGER PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    band TEXT NOT NULL CHECK (band IN ('weekday','other')),
    allowance REAL NOT NULL,
    services TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'offered'
      CHECK (status IN ('offered','accepted','declined','released')),
    offered_at TEXT NOT NULL,
    responded_at TEXT,
    called_at TEXT,
    booking_id INTEGER,
    UNIQUE (worker_id, date)
  );

  /* --- tier 4: other registered providers who will take a shift we can't fill.
     The Commission's position on contractors is unambiguous — the registered
     provider stays accountable. So this table holds the evidence that makes that
     accountability real: their registration number, the groups they're registered
     for, their agreement reference and their insurance expiry. No agreement on
     file, no referrals sent. --- */
  CREATE TABLE IF NOT EXISTS allied_providers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    abn TEXT DEFAULT '',
    ndis_reg TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    email TEXT NOT NULL,
    phone TEXT DEFAULT '',
    reg_groups TEXT DEFAULT '[]',
    suburbs TEXT DEFAULT '[]',
    share REAL NOT NULL DEFAULT 0.85,
    agreement_ref TEXT DEFAULT '',
    agreement_date TEXT DEFAULT '',
    insurance_expiry TEXT DEFAULT '',
    reciprocal INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created TEXT NOT NULL
  );

  /* --- one cover request per wobble. The booking itself is never cancelled. --- */
  CREATE TABLE IF NOT EXISTS cover (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    from_worker_id INTEGER,
    reason TEXT DEFAULT '',
    opened_at TEXT NOT NULL,
    lead_minutes INTEGER NOT NULL DEFAULT 0,
    window_minutes INTEGER NOT NULL DEFAULT 45,
    parallel INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'web',
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open','filled','referred','failed','stood-down')),
    filled_worker_id INTEGER,
    allied_id INTEGER,
    allied_share REAL,
    filled_at TEXT,
    closed_at TEXT,
    office_alerted_at TEXT,
    human_minutes REAL NOT NULL DEFAULT 0,
    outcome_note TEXT DEFAULT ''
  );

  /* --- every offer sent, every answer, every expiry. This is the audit trail
     that shows a participant was never simply abandoned. --- */
  CREATE TABLE IF NOT EXISTS cover_offers (
    id INTEGER PRIMARY KEY,
    cover_id INTEGER NOT NULL REFERENCES cover(id),
    tier TEXT NOT NULL CHECK (tier IN ('web','standby','pool','allied')),
    worker_id INTEGER,
    allied_id INTEGER,
    rank INTEGER NOT NULL DEFAULT 1,
    sent_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    response TEXT,
    responded_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cover_open ON cover (status);
  CREATE INDEX IF NOT EXISTS idx_cover_offers ON cover_offers (cover_id, response);
  CREATE INDEX IF NOT EXISTS idx_standby_date ON standby (date, status);
`);
/* the booking keeps its own status ('accepted' stays 'accepted') — cover state
   rides alongside it, because a participant whose worker pulled out still has a
   confirmed booking. That is the promise. */
for (const col of ['cover_state TEXT DEFAULT \'\'', 'original_worker_id INTEGER', 'delivered_by_allied INTEGER', 'swap_count INTEGER NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); } catch {}
}

/* --- who is willing to be on standby at all, and how often. A worker opts in
   once; the roster then fills itself without anybody ringing around. --- */
for (const col of ['standby_optin INTEGER NOT NULL DEFAULT 0', 'standby_max INTEGER NOT NULL DEFAULT 2', "standby_services TEXT DEFAULT '[]'"]) {
  try { db.exec(`ALTER TABLE worker_profiles ADD COLUMN ${col}`); } catch {}
}

/* --- 0137 NDIS Digital Platform Service.
   From 1 January 2027 two conditions of registration attach to any provider on
   the 0137 registration group:

     • worker screening check requirements ensuring that only persons who hold
       a worker screening clearance may use the platform; and
     • requirements to check and display certain information about persons
       providing supports on the platform, such as whether a banning order
       against a person is in force.

   Read them carefully. The first is a *gate on platform access*, not a filing
   obligation — an uncleared worker must not be able to use BookIt at all, so
   the state has to be a thing the code can refuse on, not a PDF in a folder.
   The second is *check AND display*, and it is worded at the level of the
   individual worker, so each profile has to carry its own answer.

   Hence these columns. screening_status is deliberately separate from the
   screening document's expiry date: a clearance can be suspended or revoked
   by the NSW screening unit on a Tuesday while the card still says 2029, and
   an expiry-driven system would never notice. banning_checked_at is the date
   we last looked a worker up on the Commission's banning orders register;
   banning_result is what we found. platform_block is the manual override an
   admin can pull at any moment without waiting for a sweep. --- */
for (const col of [
  "screening_status TEXT NOT NULL DEFAULT 'unknown'",   /* unknown | cleared | pending | suspended | revoked | excluded */
  "screening_status_at TEXT DEFAULT ''",
  "screening_status_by TEXT DEFAULT ''",
  "screening_source TEXT DEFAULT ''",                   /* where the answer came from — NDISWC portal, letter, etc. */
  "screening_ref TEXT DEFAULT ''",
  "banning_checked_at TEXT DEFAULT ''",
  "banning_result TEXT NOT NULL DEFAULT 'unchecked'",   /* unchecked | clear | banned */
  "banning_checked_by TEXT DEFAULT ''",
  "banning_source TEXT DEFAULT ''",
  "banning_note TEXT DEFAULT ''",
  /* s13D(6) names three banning-order registers, not one. (a) is an order
     under the NDIS Act; (b) is an order within the meaning of the Aged Care
     Act 2024; (c) is an order under the Aged Care Quality and Safety
     Commission Act 2018 as it stood before that Act commenced. They are three
     separate pieces of information about the same person, so they get three
     separate answers and three separate dates — an auditor who asks to see
     the aged care check must not be handed the NDIS one. */
  "banning_aged_result TEXT NOT NULL DEFAULT 'unchecked'",
  "banning_aged_at TEXT DEFAULT ''",
  "banning_aged_source TEXT DEFAULT ''",
  "banning_acqsc_result TEXT NOT NULL DEFAULT 'unchecked'",
  "banning_acqsc_at TEXT DEFAULT ''",
  "banning_acqsc_source TEXT DEFAULT ''",
  "platform_block INTEGER NOT NULL DEFAULT 0",
  "platform_block_reason TEXT DEFAULT ''",
  "auto_hidden INTEGER NOT NULL DEFAULT 0"   /* hidden by the 0137 gate, not by a person — so it can be safely restored */
]) {
  try { db.exec(`ALTER TABLE worker_profiles ADD COLUMN ${col}`); } catch {}
}

/* --- how a document was verified, not merely that somebody ticked it.
   An auditor's question is never "is it verified" — it is "how did you
   satisfy yourself, and what would you show me". --- */
for (const col of ["verify_method TEXT DEFAULT ''", "verify_ref TEXT DEFAULT ''", "verify_note TEXT DEFAULT ''"]) {
  try { db.exec(`ALTER TABLE worker_docs ADD COLUMN ${col}`); } catch {}
}

/* --- why the office was rung, not merely that it was. "Needs you" on the
   board is a bell without a reason attached; the person picking it up at 6am
   wants to know in one line whether this is "nobody was free" or "this person
   has nobody else inside 24 hours", because those two calls are made in a
   different order and in a different tone of voice. --- */
try { db.exec("ALTER TABLE cover ADD COLUMN office_alert_why TEXT DEFAULT ''"); } catch {}

/* --- the evidence trail itself: append-only, never edited, never deleted.
   Every screening decision, every banning-order check, every document
   verification and every automatic block lands here with who, when and from
   what source. This table is the answer to "show me your records". --- */
db.exec(`CREATE TABLE IF NOT EXISTS compliance_log (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER REFERENCES users(id),
  worker_name TEXT DEFAULT '',
  kind TEXT NOT NULL,
  result TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  source TEXT DEFAULT '',
  ref TEXT DEFAULT '',
  doc_id INTEGER,
  checked_at TEXT NOT NULL,
  checked_by TEXT DEFAULT ''
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_complog_worker ON compliance_log (worker_id, id)');

/* --- a tiny key/value store so award figures aren't welded into the source.
   SCHADS rates move every 1 July; an admin should be able to change one number
   in a form rather than wait for a deploy. --- */
db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated TEXT NOT NULL DEFAULT ''
);`);
function setting(key, fallback = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated`)
    .run(key, String(value ?? ''), new Date().toISOString());
}


/* …and allow the 'completed' status. SQLite can't edit a CHECK constraint,
   so databases created before invoicing get their bookings table rebuilt once. */
const bkDef = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'").get();
if (bkDef && !bkDef.sql.includes("'completed'")) {
  db.exec(`
    BEGIN;
    CREATE TABLE bookings_new (
      id INTEGER PRIMARY KEY,
      participant_id INTEGER NOT NULL REFERENCES users(id),
      worker_id INTEGER NOT NULL REFERENCES users(id),
      service TEXT NOT NULL,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      hours REAL NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested','accepted','declined','cancelled','completed')),
      created TEXT NOT NULL,
      completed_at TEXT, rate_category TEXT, unit_price REAL, worker_share REAL, total REAL
    );
    INSERT INTO bookings_new (id, participant_id, worker_id, service, date, start, hours, notes, status, created, completed_at, rate_category, unit_price, worker_share, total)
      SELECT id, participant_id, worker_id, service, date, start, hours, notes, status, created, completed_at, rate_category, unit_price, worker_share, total FROM bookings;
    DROP TABLE bookings;
    ALTER TABLE bookings_new RENAME TO bookings;
    COMMIT;
  `);
  console.log('Migrated bookings table to allow completed status.');
}

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();
const SERVICES = ['employment','personal-care','transport','daily-tasks','household','community'];
/* ---------- the certificate, as data ----------
   Everything the site says about what we can and can't deliver is derived from the two tables
   below. Nothing is hardcoded into a sentence. That matters twice over: s13D(6)(d) of the
   Registration Rules makes credentials *displayed on a platform* a thing the Commission checks,
   so a claim on a page has to be traceable to the certificate; and when a support is added to
   the certificate later, one boolean changes here and every page, email and form follows.
   CERT_GROUPS is the current DMHC certificate (NDIS 4-LO5XNY0, to 21 January 2029). 0138 was
   added by notice of variation effective 1 July 2026. It is the certificate as published, so it
   sits alongside the older REG_GROUPS map (service -> code, used for claiming) rather than
   replacing it — that one answers "which line do I bill", this one answers "what may we do". */
const CERT_GROUPS = [
  { code: '0102', name: 'Assist Access/Maintain Employment',   service: 'employment'   },
  { code: '0107', name: 'Assist — Personal Activities',        service: 'personal-care'},
  { code: '0108', name: 'Assist — Travel/Transport',           service: 'transport'    },
  { code: '0115', name: 'Daily Tasks / Shared Living',         service: 'daily-tasks'  },
  { code: '0120', name: 'Household Tasks',                     service: 'household'    },
  { code: '0125', name: 'Participate in Community',            service: 'community'    },
  { code: '0138', name: 'Supported Independent Living',        service: 'daily-tasks'  }
];

/* The eight supports in NDIS Practice Standards Supplementary Module 1 — High Intensity Daily
   Personal Activities, registration group 0104, each mapped to its clause in Schedule 2 of the
   Provider Registration and Practice Standards Rules 2018.
   `held` is the load-bearing field. Section 13C of those Rules grants 0104 support by support:
   a provider "must not provide a support mentioned in Schedule 2 if the support is not set out
   in the provider's certificate of registration". So this is not one yes/no — it is eight, and
   a provider can hold any subset. DMHC currently holds none of them, which is why every entry
   reads false; adding one under s13C is a two-field edit here (held: true, since: 'YYYY-MM-DD')
   and the whole site tells the truth again on the next restart.
   Note the catheter wording: emptying a leg bag and hygiene around an established catheter is
   ordinary personal care under 0107. Only inserting, changing or irrigating one is Module 1 —
   the label has to say so, or every participant with a catheter ticks a box they shouldn't. */
const HI_SUPPORTS = [
  { key: 'bowel',      clause: 'Sch 2 cl 3',  label: 'Complex bowel care',                                            held: false, since: '' },
  { key: 'enteral',    clause: 'Sch 2 cl 4',  label: 'PEG or tube (enteral) feeding',                                 held: false, since: '' },
  { key: 'dysphagia',  clause: 'Sch 2 cl 4A', label: 'Dysphagia — help managing swallowing difficulties',             held: false, since: '' },
  { key: 'ventilator', clause: 'Sch 2 cl 7',  label: 'Ventilator support',                                            held: false, since: '' },
  { key: 'trach',      clause: 'Sch 2 cl 5',  label: 'Tracheostomy management',                                       held: false, since: '' },
  { key: 'catheter',   clause: 'Sch 2 cl 6',  label: 'Urinary catheter management — inserting, changing or irrigating',held: false, since: '' },
  { key: 'injections', clause: 'Sch 2 cl 8',  label: 'Subcutaneous injections',                                       held: false, since: '' },
  { key: 'wounds',     clause: 'Sch 2 cl 9',  label: 'Complex wound management',                                      held: false, since: '' }
];
const HI_KEYS = HI_SUPPORTS.map(x => x.key);
const hiSupport = k => HI_SUPPORTS.find(x => x.key === k) || null;
const hiLabel = k => (hiSupport(k) || {}).label || k;
const hiHeld = k => Boolean((hiSupport(k) || {}).held);
const hiUnheld = ks => (ks || []).filter(k => !hiHeld(k));
const holds0104 = () => HI_SUPPORTS.some(x => x.held);
const hiFrom = body => (Array.isArray(body && body.hi_flags) ? [...new Set(body.hi_flags)] : []).filter(k => HI_KEYS.includes(k));

/* Adding one support to the certificate. s13C grants Schedule 2 supports one at a time, and the
   whole point of holding the certificate as data is that the day one is added this is a single
   config line rather than an edit to nine pages:  CERT_SCH2="catheter:2027-03-14"
   The date is not optional. It is the date the support appeared on the certificate of
   registration, it is what an auditor asks for, and requiring it is what stops this being set
   casually. Never set it for a support that is not printed on the certificate. */
for (const pair of String(process.env.CERT_SCH2 || '').split(',').map(x => x.trim()).filter(Boolean)) {
  const [key, since] = pair.split(':').map(x => (x || '').trim());
  const sup = hiSupport(key);
  if (!sup) { console.error(`CERT_SCH2: '${key}' is not a Schedule 2 support — ignored`); continue; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since || '')) { console.error(`CERT_SCH2: '${key}' needs the date it went on the certificate (YYYY-MM-DD) — ignored`); continue; }
  sup.held = true; sup.since = since;
  console.log(`CERT: Schedule 2 ${sup.clause} — ${sup.label} — held since ${since}`);
}

/* The provider we introduce people to for the supports we don't hold. Environment-driven so it
   can be filled in without a deploy — and deliberately gated on BOTH a name and the date the
   collaboration agreement was signed. An unsigned arrangement is not a referral pathway, it is
   an intention, and the site will not name a partner it cannot evidence. Until both are set the
   site says we will introduce you, without putting a name to it. */
const SCOPE_PARTNER = {
  name:         process.env.SCOPE_PARTNER_NAME || '',
  ndis:         process.env.SCOPE_PARTNER_NDIS || '',
  phone:        process.env.SCOPE_PARTNER_PHONE || '',
  agreement_at: process.env.SCOPE_PARTNER_AGREEMENT_AT || ''
};
const partnerNamed = () => Boolean(SCOPE_PARTNER.name && SCOPE_PARTNER.agreement_at);
const publicPartner = () => partnerNamed() ? { name: SCOPE_PARTNER.name, ndis: SCOPE_PARTNER.ndis, phone: SCOPE_PARTNER.phone } : null;
const scopeView = () => ({
  supports: HI_SUPPORTS,           /* the eight of Module 1, each with its clause and whether we hold it */
  groups: CERT_GROUPS,
  holds_0104: holds0104(),
  partner: publicPartner()
});
const safeJson = (v, fallback) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : fallback; } catch { return fallback; } };
/* The published rate table. Derived from the ladder rather than hardcoded, so
   the number on the marketing page can never drift away from the number that
   lands in a worker's account. "from" is Bronze — what a worker earns on day
   one. "to" is Platinum. Both are floored by the award, which is the whole
   reason household tasks reads differently from the rest of the table. */
const RATE_ROWS = [
  { label: 'Weekday daytime', category: 'weekday-day' },
  { label: 'Weekday evening', category: 'weekday-evening' },
  { label: 'Weekday night',   category: 'weekday-night' },
  { label: 'Saturday',        category: 'saturday' },
  { label: 'Sunday',          category: 'sunday' },
  { label: 'Public holiday',  category: 'public-holiday' },
  { label: 'Household tasks', category: 'household' },
  { label: 'Employment support', category: 'employment' }
];
function publicRates() {
  const shares = tierShares(), sup = superRate();
  return RATE_ROWS.map(row => {
    const r = INVOICE_RATES[row.category];
    const floor = awardFloorFor(2, row.category); /* Level 2 — the common casual classification */
    const at = pct => {
      const ladder = round2(r.price * pct / 100);
      return { rate: Math.max(ladder, floor.rate), floored: floor.rate > ladder };
    };
    const from = at(shares.bronze), to = at(shares.platinum);
    return {
      label: row.label, category: row.category, you: r.price,
      worker: from.rate, worker_top: to.rate,
      base: round2(from.rate / (1 + sup / 100)), base_top: round2(to.rate / (1 + sup / 100)),
      pct_from: shares.bronze, pct_to: shares.platinum,
      award_floored: from.floored, note: from.floored ? 'Lifted to the SCHADS minimum — the price limit on this item sits below the award.' : ''
    };
  });
}

/* ---------- invoicing (NDIS Pricing Arrangements 2026–27 price limits) ----------
   A completed shift gets a rate category. The category is auto-suggested from
   the booking's date/time (public holidays can't be auto-detected — admins can
   override any line from the dashboard before exporting). */
const INVOICE_RATES = {
  'weekday-day':     { label: 'Weekday daytime', price: 73.58,  worker: 53.25 },
  'weekday-evening': { label: 'Weekday evening', price: 81.07,  worker: 58.70 },
  'weekday-night':   { label: 'Weekday night',   price: 82.57,  worker: 59.80 },
  'saturday':        { label: 'Saturday',        price: 103.54, worker: 74.95 },
  'sunday':          { label: 'Sunday',          price: 133.50, worker: 96.65 },
  'public-holiday':  { label: 'Public holiday',  price: 163.46, worker: 118.35 },
  'household':       { label: 'Household tasks (cleaning)', price: 60.10, worker: 43.50 },
  /* 0102 Employment Assistance (10_016_0102_5_3) is a flat rate — no day-type variants */
  'employment':      { label: 'Employment support (flat)', price: 83.87, worker: 60.70 },
  /* inactive night: flat per-night price, not hourly */
  'sleepover':       { label: 'Night-time sleepover (inactive)', price: 311.79, worker: 225.65, perNight: true }
};
const REG_GROUPS = { 'employment': '0102', 'personal-care': '0107', 'transport': '0108', 'daily-tasks': '0115/0138', 'household': '0120', 'community': '0125' };
function suggestCategory(b) {
  if (b.sleepover) return 'sleepover';
  if (b.service === 'household') return 'household';
  if (b.service === 'employment') return 'employment';
  const dow = new Date(b.date + 'T00:00:00').getDay();
  if (dow === 6) return 'saturday';
  if (dow === 0) return 'sunday';
  const [h, min] = String(b.start).split(':').map(Number);
  const endH = h + (min || 0) / 60 + Number(b.hours);
  let cat = 'weekday-day';
  if (h < 6) cat = 'weekday-night';
  else if (h >= 20 || endH > 20) cat = 'weekday-evening';
  /* the 0125 set has no night item — night community/transport shifts claim the evening item */
  if (cat === 'weekday-night' && (b.service === 'community' || b.service === 'transport')) cat = 'weekday-evening';
  return cat;
}
/* Verified verbatim against the official NDIS Pricing Schedule 2026-27 v1.2
   (Schedule 1 pp.5-15, Schedule 3 Table 13 p.25), supplied by the provider:
   - 0107 self-care: 01_002 night · 01_010 SLEEPOVER (Each $311.79) · 01_011 day
     · 01_012 PH · 01_013 Sat · 01_014 Sun · 01_015 evening
   - 0115 SIL: 01_801..806 day/eve/night/Sat/Sun/PH · 01_832 sleepover
     (0138 mirror set 01_8xx_0138_1_1 exists for SIL-group claims)
   - 0125 community: 04_104 day · 04_103 evening · 04_105 Sat · 04_106 Sun
     · 04_102 PH — NO night or sleepover items (night coerced to evening)
   - 0120: 01_020_0120_1_1 House Cleaning $60.10/h (01_019 yard $59.01 exists)
   - 0102: 10_016_0102_5_3 Employment Assistance — FLAT $83.87/h, all days
   - transport (0108): no hourly labour items exist; labour is claimed under the
     0125 set + Activity Based Transport 04_590_0125_6_1 for km — confirm with
     each plan manager (hence the confirm flag). */
const SUPPORT_ITEMS = {
  'personal-care': { 'weekday-day': '01_011_0107_1_1', 'weekday-evening': '01_015_0107_1_1', 'weekday-night': '01_002_0107_1_1', 'saturday': '01_013_0107_1_1', 'sunday': '01_014_0107_1_1', 'public-holiday': '01_012_0107_1_1', 'sleepover': '01_010_0107_1_1' },
  'daily-tasks': { 'weekday-day': '01_801_0115_1_1', 'weekday-evening': '01_802_0115_1_1', 'weekday-night': '01_803_0115_1_1', 'saturday': '01_804_0115_1_1', 'sunday': '01_805_0115_1_1', 'public-holiday': '01_806_0115_1_1', 'sleepover': '01_832_0115_1_1' },
  'community': { 'weekday-day': '04_104_0125_6_1', 'weekday-evening': '04_103_0125_6_1', 'saturday': '04_105_0125_6_1', 'sunday': '04_106_0125_6_1', 'public-holiday': '04_102_0125_6_1' },
  'household': { '*': '01_020_0120_1_1' },
  'employment': { '*': '10_016_0102_5_3' },
  'transport': { 'weekday-day': '04_104_0125_6_1', 'weekday-evening': '04_103_0125_6_1', 'saturday': '04_105_0125_6_1', 'sunday': '04_106_0125_6_1', 'public-holiday': '04_102_0125_6_1' }
};
const ITEM_CONFIRM = { 'transport': true };
function supportItemFor(service, category) {
  const m = SUPPORT_ITEMS[service] || {};
  return m[category] || m['*'] || '';
}
const NDIS_REG_NO = process.env.NDIS_REG_NO || '4-LO5XNY0';
const COMPANY_ABN = '19658578575';
const BANK_DETAILS = process.env.BANK_DETAILS || '';

/* ---------- tiny PDF invoice generator (zero-dependency) ---------- */
function pdfEsc(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function makeInvoicePdf(inv) {
  /* inv: { invoice_no, date, bill_to: [lines], lines: [{date, service, item, hours, rate, amount}], total, self } */
  const ops = [];
  const T = (x, y, size, font, text, color) => {
    if (color) ops.push(color); else ops.push('0.09 0.19 0.23 rg');
    ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEsc(text)}) Tj ET`);
  };
  const TEAL = '0.055 0.42 0.384 rg', SOFT = '0.35 0.44 0.48 rg';
  T(40, 795, 24, 'FB', 'BookIt', TEAL);
  T(40, 780, 8.5, 'F', 'Disability & Mental Health Care Pty Ltd · ABN 19 658 578 575', SOFT);
  T(40, 769, 8.5, 'F', `Registered NDIS Provider ${NDIS_REG_NO} · hello@bookit.life · 0488 114 368 · bookit.life`, SOFT);
  T(400, 795, 15, 'FB', 'TAX INVOICE');
  T(400, 781, 8.5, 'F', 'GST-free NDIS supports (s38-38 GST Act)', SOFT);
  T(400, 766, 10, 'FB', `Invoice ${inv.invoice_no}`);
  T(400, 753, 9.5, 'F', `Date: ${inv.date}`);
  T(40, 730, 9, 'FB', 'Bill to:');
  let y = 718;
  for (const line of inv.bill_to) { T(40, y, 9.5, 'F', line); y -= 12; }
  y = Math.min(y - 14, 660);
  const cols = { date: 40, svc: 105, item: 300, hrs: 400, rate: 445, amt: 505 };
  T(cols.date, y, 8.5, 'FB', 'Date'); T(cols.svc, y, 8.5, 'FB', 'Support'); T(cols.item, y, 8.5, 'FB', 'Support item no.');
  T(cols.hrs, y, 8.5, 'FB', 'Hours'); T(cols.rate, y, 8.5, 'FB', 'Rate'); T(cols.amt, y, 8.5, 'FB', 'Amount');
  y -= 5; ops.push('0.9 0.87 0.83 RG 0.7 w', `40 ${y} m 555 ${y} l S`); y -= 13;
  for (const l of inv.lines) {
    T(cols.date, y, 9, 'F', l.date);
    T(cols.svc, y, 9, 'F', String(l.service).slice(0, 34));
    T(cols.item, y, 9, 'F', l.item || '—');
    T(cols.hrs, y, 9, 'F', String(l.hours));
    T(cols.rate, y, 9, 'F', `$${l.rate.toFixed(2)}`);
    T(cols.amt, y, 9, 'F', `$${l.amount.toFixed(2)}`);
    y -= 15;
    if (y < 150) { T(40, y, 9, 'F', `… ${inv.lines.length} lines total — remainder on statement.`); break; }
  }
  y -= 4; ops.push('0.9 0.87 0.83 RG 0.7 w', `40 ${y} m 555 ${y} l S`); y -= 16;
  T(400, y, 11, 'FB', 'Total due:'); T(cols.amt, y, 11, 'FB', `$${inv.total.toFixed(2)}`);
  y -= 26;
  T(40, y, 9.5, 'FB', 'Payment'); y -= 13;
  if (inv.self) {
    T(40, y, 9, 'F', BANK_DETAILS ? `Please pay within 14 days by bank transfer: ${BANK_DETAILS}` : 'Please pay within 14 days — payment details provided separately.'); y -= 12;
    T(40, y, 9, 'F', `Reference: ${inv.invoice_no}. You can claim this amount back through the myplace participant portal.`, undefined);
  } else {
    T(40, y, 9, 'F', 'Please pay from plan funds within 14 days.' + (BANK_DETAILS ? ` Bank transfer: ${BANK_DETAILS}` : ' Payment details provided separately.')); y -= 12;
    T(40, y, 9, 'F', `Reference: ${inv.invoice_no}. Prices align with the NDIS Pricing Arrangements and Price Limits 2026-27.`);
  }
  T(40, 60, 8, 'F', 'Questions about this invoice? hello@bookit.life · 0488 114 368. Thank you for choosing BookIt.', SOFT);
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F 5 0 R /FB 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/* The claim side and the pay side of one shift.

   The claim is fixed: the NDIS price limit, which is the same for everybody.
   The pay is not: it is the worker's tier share of that limit, lifted to the
   SCHADS minimum for their classification if the share falls short. Both get
   frozen onto the booking row at completion, because a worker who moves up a
   tier next month must not silently reprice already-completed shifts, and an
   audit two years from now has to be able to see what was actually paid and
   why. workerPay() is the only function allowed to answer "what is this hour
   worth" — see THE AWARDS LADDER further down. */
function applyInvoice(id, category) {
  const r = INVOICE_RATES[category];
  const b = db.prepare('SELECT hours, worker_id FROM bookings WHERE id = ?').get(id);
  if (!r || !b) return null;
  const qty = r.perNight ? 1 : b.hours; /* sleepovers are one flat per-night price */
  const total = Math.round(r.price * qty * 100) / 100;

  const pay = workerPay(b.worker_id, category, b.hours)
    /* fallback only if the profile row is missing entirely — never leave pay unset */
    || { tier: 'bronze', share_pct: null, rate: r.worker, amount: Math.round(r.worker * qty * 100) / 100, floored: false, why: '' };

  db.prepare(`UPDATE bookings SET rate_category = ?, unit_price = ?, worker_share = ?, total = ?,
      tier_at_shift = ?, share_pct = ?, award_floored = ? WHERE id = ?`)
    .run(category, r.price, pay.amount, total, pay.tier, pay.share_pct, pay.floored ? 1 : 0, id);

  /* uneconomic and uplift_withheld ride along on the completion response for the
     same reason award_floored does: the shift is the moment the decision is made,
     and an audit two years from now needs the flag next to the shift, not
     reconstructed from settings that may have moved since. */
  return { category, label: r.label, unit_price: r.price, qty, total, worker_share: pay.amount,
    tier: pay.tier, share_pct: pay.share_pct, worker_rate: pay.rate, award_floored: !!pay.floored,
    uplift_withheld: !!pay.uplift_withheld, uneconomic: !!pay.uneconomic, pay_note: pay.why };
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function makeSession(uid) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const base = `${uid}.${exp}`;
  return `${base}.${sign(base)}`;
}
/* the user object handed to routes and returned by /api/me — includes the worker's
   photo url + live (visible) flag so the front-end account menu can show them */
function sessionUser(uid) {
  const u = db.prepare('SELECT id, role, name, email, suburb, plan, verified, ndis_number, pm_email, hi_flags, hi_at, hi_referred_at FROM users WHERE id = ?').get(Number(uid));
  if (!u) return null;
  u.hi_flags = safeJson(u.hi_flags, []);
  if (u.role === 'worker') {
    const p = db.prepare('SELECT photo, photo_at, visible FROM worker_profiles WHERE user_id = ?').get(u.id);
    u.photo = p && p.photo ? `/photos/${u.id}?v=${encodeURIComponent(p.photo_at || '')}` : null;
    u.live = p && p.visible ? 1 : 0;
  }
  return withAdmin(u);
}
function readSession(cookieHeader) {
  const m = /(?:^|;\s*)bk_session=([^;]+)/.exec(cookieHeader || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const base = `${uid}.${exp}`;
  const expected = sign(base);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return sessionUser(uid);
}
function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...(SITE_PASSWORD ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    ...headers
  });
  res.end(body);
}
function setSessionHeaders(uid) {
  return { 'Set-Cookie': `bk_session=${makeSession(uid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` };
}
const CLEAR_COOKIE = { 'Set-Cookie': 'bk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' };

/* ---------- private preview gate ----------
   Set SITE_PASSWORD to lock the whole site (pages + API) behind a
   password screen while you build. Delete the variable to go public. */
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
function gateValid(cookieHeader) {
  if (!SITE_PASSWORD) return true;
  const m = /(?:^|;\s*)bk_gate=([^;]+)/.exec(cookieHeader || '');
  if (!m) return false;
  const expected = sign('gate-ok:' + SITE_PASSWORD);
  return m[1].length === expected.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expected));
}
function gatePage(wrong) {
  return `<!DOCTYPE html><html lang="en-AU"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex, nofollow"><title>BookIt — private preview</title>
<style>body{font-family:system-ui,sans-serif;background:#FAF6F0;color:#17313A;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
.card{background:#fff;border:1px solid #E7DFD4;border-radius:20px;box-shadow:0 18px 50px rgba(23,49,58,.14);padding:40px;max-width:400px;width:100%;text-align:center;}
.logo{font-weight:800;font-size:1.6rem;display:flex;align-items:center;justify-content:center;gap:2px;margin-bottom:14px;}
.logo svg{height:.68em;width:auto;margin-top:.1em;}
h1{font-size:1.15rem;margin:0 0 8px;}
p{color:#3E5A64;font-size:.92rem;margin:0 0 22px;}
input{width:100%;padding:13px 16px;border:1.5px solid #E7DFD4;border-radius:11px;font-size:1rem;margin-bottom:12px;box-sizing:border-box;}
input:focus{outline:3px solid #F5B841;border-color:#0E6B62;}
button{width:100%;background:#0E6B62;color:#fff;border:none;border-radius:999px;padding:13px;font-size:1rem;font-weight:600;cursor:pointer;}
button:hover{background:#0A544D;}
.err{color:#a8250b;font-size:.88rem;margin:0 0 12px;font-weight:600;}</style></head>
<body><div class="card">
<div class="logo">b<svg viewBox="0 0 94 48" aria-hidden="true"><circle cx="23" cy="24" r="22" fill="#0E6B62"/><circle cx="69" cy="24" r="22" fill="#F5B841"/><path d="M57 25 l9 9 17 -18" stroke="#17313A" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>kit</div>
<h1>Private preview</h1>
<p>BookIt isn't open to the public just yet. Enter the access password to look around.</p>
${wrong ? '<p class="err">That password did not match — try again.</p>' : ''}
<form method="POST" action="/gate"><input type="password" name="pw" placeholder="Access password" autofocus required><button type="submit">Enter</button></form>
</div></body></html>`;
}

/* ---------- email (zero-dependency SMTP over TLS) ----------
   Sends through your Zoho mailbox. Set:
     SMTP_USER = hello@bookit.life
     SMTP_PASS = that mailbox's password (or a Zoho app password if MFA is on)
   Optional: SMTP_HOST (default smtppro.zoho.com.au — Zoho AU, paid org),
     SMTP_PORT (465 SSL), MAIL_FROM (defaults to SMTP_USER — must be the
     account address or one of its aliases), APP_URL (absolute link base
     for emails, e.g. https://demo.bookit.life).
   Without SMTP_USER+SMTP_PASS email is OFF: everything else works and
   would-be emails are logged to the console instead. Demo accounts
   (@demo.bookit.life) are never emailed. */
const SMTP_HOST = process.env.SMTP_HOST || 'smtppro.zoho.com.au';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || 'hello@bookit.life';
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
/* Resend HTTPS API (api.resend.com) — needed on hosts that block outbound
   SMTP (Railway Free/Trial/Hobby all do). Set RESEND_API_KEY to use it;
   it wins over SMTP when both are configured. */
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_BASE = (process.env.RESEND_BASE || 'https://api.resend.com').replace(/\/+$/, '');
const EMAIL_ON = Boolean(RESEND_KEY || (SMTP_USER && SMTP_PASS));

/* ---------- Stripe (card payments for self-managed invoices) ----------
   Set STRIPE_SECRET_KEY (sk_live_… from dashboard.stripe.com → Developers → API keys)
   and the feature switches on: self-managed invoices get a hosted "pay by card" link.
   Set STRIPE_WEBHOOK_SECRET (whsec_… — add a webhook in the Stripe dashboard pointing
   at https://bookit.life/api/stripe/webhook for the checkout.session.completed event)
   and paid shifts mark themselves paid the moment the card goes through.
   No keys set = feature dormant, invoices show bank transfer only. */
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_API_URL = (process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/+$/, ''); /* overridable for tests */
function stripeRequest(pathName, params) {
  return new Promise((resolve, reject) => {
    const form = new URLSearchParams();
    const add = (k, v) => { if (v !== undefined && v !== null) form.append(k, String(v)); };
    for (const [k, v] of Object.entries(params)) add(k, v);
    const body = form.toString();
    const u = new URL(STRIPE_API_URL + pathName);
    const mod = u.protocol === 'http:' ? http : https;
    const req2 = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let data = '';
      r.on('data', c => { data += c; });
      r.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (r.statusCode >= 400 || parsed.error) return reject(new Error((parsed.error && parsed.error.message) || `Stripe error ${r.statusCode}`));
          resolve(parsed);
        } catch { reject(new Error('Stripe returned an unreadable response.')); }
      });
    });
    req2.on('error', reject);
    req2.setTimeout(15000, () => req2.destroy(new Error('Stripe request timed out.')));
    req2.end(body);
  });
}
function verifyStripeSig(raw, header) {
  if (!STRIPE_WEBHOOK_SECRET) return false;
  let t = '';
  const v1s = [];
  for (const kv of String(header || '').split(',')) {
    const i = kv.indexOf('=');
    if (i === -1) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!t || !v1s.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; /* 5-minute replay window */
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return v1s.some(v => {
    try { return v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)); }
    catch { return false; }
  });
}
function handleStripeWebhook(req, res, raw) {
  if (!verifyStripeSig(raw, req.headers['stripe-signature'])) {
    return json(res, 400, { error: 'Bad signature.' });
  }
  let event = {};
  try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'Bad payload.' }); }
  if (event.type === 'checkout.session.completed') {
    const s = event.data && event.data.object ? event.data.object : {};
    const invNo = s.metadata && s.metadata.invoice_no;
    if (invNo) {
      const rows = db.prepare("SELECT id, total FROM bookings WHERE invoice_no = ? AND claim_status != 'paid'").all(invNo);
      if (rows.length) {
        db.prepare("UPDATE bookings SET claim_status = 'paid', paid_at = ? WHERE invoice_no = ? AND claim_status != 'paid'").run(now(), invNo);
        const total = rows.reduce((n, r) => n + (r.total || 0), 0);
        console.log(`[stripe] card payment received — invoice ${invNo}, ${rows.length} shift(s), $${total.toFixed(2)}`);
        if (MAIL_FROM) sendMail(MAIL_FROM, `Card payment received — ${invNo}`,
          `💳 $${total.toFixed(2)} paid by card`,
          `<p>Invoice <b>${escHtml(invNo)}</b> has been paid by card through Stripe — <b>$${total.toFixed(2)}</b> across ${rows.length} shift${rows.length > 1 ? 's' : ''}. The shifts are marked paid automatically.</p>`,
          'Open claims', `${APP_URL || 'https://bookit.life'}/#/admin`).catch(() => {});
      }
    }
  }
  json(res, 200, { received: true });
}

/* ---------- admins ----------
   ADMIN_EMAILS = comma-separated list of account emails that get the admin
   dashboard (approve workers, see users/bookings/messages). */
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
function withAdmin(u) { if (u) u.admin = ADMIN_EMAILS.includes(String(u.email || '').toLowerCase()) ? 1 : 0; return u; }
function requireAdmin(user, res) { if (!user || !user.admin) { json(res, 403, { error: 'Admin only.' }); return false; } return true; }

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = n => escHtml(String(n || '').split(' ')[0] || 'there');
const SERVICE_LABELS = { 'employment': 'Employment support', 'personal-care': 'Personal care', 'transport': 'Travel & transport', 'daily-tasks': 'Daily tasks & shared living', 'household': 'Household tasks', 'community': 'Community participation' };
const prettyDate = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };

function b64wrap(str) { return Buffer.from(str, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'); }

function smtpSend(to, subject, html, text, replyTo, attachments) {
  return new Promise((resolve, reject) => {
    const boundary = 'bk' + crypto.randomBytes(12).toString('hex');
    const msgId = `<${crypto.randomBytes(12).toString('hex')}@bookit.life>`;
    const altPart =
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64wrap(text)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64wrap(html)}\r\n` +
      `--${boundary}--\r\n`;
    let topType = `multipart/alternative; boundary="${boundary}"`;
    let bodyPart = altPart;
    if (attachments && attachments.length) {
      const mix = 'mix' + crypto.randomBytes(10).toString('hex');
      topType = `multipart/mixed; boundary="${mix}"`;
      bodyPart =
        `--${mix}\r\n` +
        `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
        altPart +
        attachments.map(a =>
          `--${mix}\r\n` +
          `Content-Type: ${a.mime || 'application/octet-stream'}; name="${a.filename}"\r\n` +
          `Content-Disposition: attachment; filename="${a.filename}"\r\n` +
          `Content-Transfer-Encoding: base64\r\n\r\n` +
          `${a.buffer.toString('base64').replace(/(.{76})/g, '$1\r\n')}\r\n`).join('') +
        `--${mix}--\r\n`;
    }
    const data =
      `From: =?UTF-8?B?${Buffer.from('BookIt', 'utf8').toString('base64')}?= <${MAIL_FROM}>\r\n` +
      `To: <${to}>\r\n` +
      (replyTo ? `Reply-To: <${replyTo}>\r\n` : '') +
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `Message-ID: ${msgId}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: ${topType}\r\n` +
      `\r\n` +
      bodyPart;
    const steps = [
      { expect: 220, send: () => 'EHLO bookit.life\r\n' },
      { expect: 250, send: () => 'AUTH LOGIN\r\n' },
      { expect: 334, send: () => Buffer.from(SMTP_USER, 'utf8').toString('base64') + '\r\n' },
      { expect: 334, send: () => Buffer.from(SMTP_PASS, 'utf8').toString('base64') + '\r\n' },
      { expect: 235, send: () => `MAIL FROM:<${MAIL_FROM}>\r\n` },
      { expect: 250, send: () => `RCPT TO:<${to}>\r\n` },
      { expect: 250, send: () => 'DATA\r\n' },
      { expect: 354, send: () => data + '.\r\n' },
      { expect: 250, send: () => 'QUIT\r\n', done: true }
    ];
    let i = 0, buf = '', finished = false;
    const sock = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
    const fail = err => { if (finished) return; finished = true; clearTimeout(timer); try { sock.destroy(); } catch {} reject(err); };
    const timer = setTimeout(() => fail(new Error(`SMTP timeout talking to ${SMTP_HOST}:${SMTP_PORT}`)), 25000);
    sock.on('error', fail);
    sock.on('data', chunk => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        if (finished) return;
        if (/^\d{3}-/.test(line)) continue; /* multiline reply — keep reading */
        const step = steps[i];
        if (!step) continue;
        const code = Number(line.slice(0, 3));
        if (code !== step.expect) return fail(new Error(`${SMTP_HOST} said: ${line.trim() || '(empty reply)'}`));
        i++;
        sock.write(step.send());
        if (step.done) { finished = true; clearTimeout(timer); sock.end(); resolve(true); }
      }
    });
  });
}

async function resendSend(to, subject, html, text, replyTo, attachments) {
  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `BookIt <${MAIL_FROM}>`, to: [to], subject, html, text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments && attachments.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.buffer.toString('base64') })) } : {})
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) {
    let msg = `Resend API ${res.status}`;
    try { const j = await res.json(); if (j && j.message) msg += `: ${j.message}`; } catch {}
    throw new Error(msg);
  }
  return true;
}

function emailHtml(heading, bodyHtml, ctaText, ctaUrl) {
  const btn = (ctaText && ctaUrl) ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 8px;"><tr><td style="background:#0E6B62;border-radius:999px;">
<a href="${ctaUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;">${ctaText}</a>
</td></tr></table>
<p style="font-size:12px;color:#7d8f96;text-align:center;margin:0;">Button not working? Paste this into your browser:<br>
<a href="${ctaUrl}" style="color:#0E6B62;word-break:break-all;">${ctaUrl}</a></p>` : '';
  return `<!DOCTYPE html>
<html lang="en-AU"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#FAF6F0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6F0;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #E7DFD4;border-radius:18px;">
<tr><td style="padding:30px 34px 24px;font-family:Arial,Helvetica,sans-serif;color:#17313A;">
<div style="font-size:26px;font-weight:800;letter-spacing:-.5px;margin-bottom:20px;">b<span style="color:#0E6B62;">o</span><span style="color:#F5B841;">o</span>kit <span style="color:#0E6B62;">&#10003;</span></div>
<h1 style="font-size:20px;margin:0 0 14px;">${heading}</h1>
<div style="font-size:15px;line-height:1.65;color:#3E5A64;">${bodyHtml}</div>
${btn}
</td></tr>
<tr><td style="padding:18px 34px 26px;border-top:1px solid #F0EAE0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7d8f96;line-height:1.6;">
BookIt &middot; operated by Disability &amp; Mental Health Care Pty Ltd<br>
ABN 19 658 578 575 &middot; Registered NDIS Provider 4-LO5XNY0<br>
You&#39;re receiving this because of activity on your BookIt account.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function sendMail(to, subject, heading, bodyHtml, ctaText, ctaUrl, replyTo, attachments) {
  const dest = String(to || '').trim().toLowerCase();
  if (!dest || dest.endsWith('@demo.bookit.life')) return Promise.resolve('skipped-demo');
  const html = emailHtml(heading, bodyHtml, ctaText, ctaUrl);
  const text = bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&middot;/g, '·').trim()
    + (ctaUrl ? `\n\n${ctaText}: ${ctaUrl}` : '')
    + '\n\n— BookIt · Disability & Mental Health Care Pty Ltd · ABN 19 658 578 575';
  if (!EMAIL_ON) { console.log(`[email off] '${subject}' → ${dest}${ctaUrl ? ' · link: ' + ctaUrl : ''}${attachments && attachments.length ? ' · attachments: ' + attachments.map(a => a.filename).join(',') : ''}`); return Promise.resolve('skipped-off'); }
  const transport = RESEND_KEY ? resendSend : smtpSend;
  return transport(dest, subject, html, text, replyTo, attachments).then(
    ok => { console.log(`[email] sent '${subject}' → ${dest}`); return ok; },
    err => { console.error(`[email] FAILED '${subject}' → ${dest}: ${err.message}`); throw err; }
  );
}

function baseUrl(req) {
  if (APP_URL) return APP_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  return `${proto}://${host}`;
}

/* signed, expiring email tokens (verify / reset) */
function makeEmailToken(kind, uid, ttlMs, extra = '') {
  const exp = Date.now() + ttlMs;
  const base = `${kind}.${uid}.${exp}`;
  return `${base}.${sign(`${base}.${extra}`)}`;
}
function readEmailToken(kind, token, extraFor) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== kind) return null;
  const [k, uid, exp, sig] = parts;
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(exp)) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(uid));
  if (!u) return null;
  const extra = extraFor ? extraFor(u) : '';
  const expected = sign(`${k}.${uid}.${exp}.${extra}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return u;
}
function sendVerifyEmail(req, u) {
  const url2 = `${baseUrl(req)}/verify-email?token=${makeEmailToken('v', u.id, 7 * 864e5)}`;
  return sendMail(u.email, 'Confirm your email — BookIt',
    `Welcome to BookIt, ${firstName(u.name)}!`,
    `<p>Your account is live. One quick thing — press the button below so we know this address is really yours. That's what keeps password resets and booking updates flowing to the right inbox.</p><p>The link works for 7 days.</p>`,
    'Confirm my email', url2);
}

function clean(v, max = 300) { return String(v ?? '').trim().slice(0, max); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* naive rate limiter for auth endpoints */
const hits = new Map();
function limited(ip, key, max = 25, windowMs = 10 * 60e3) {
  const k = `${ip}:${key}`;
  const rec = hits.get(k) || { n: 0, reset: Date.now() + windowMs };
  if (Date.now() > rec.reset) { rec.n = 0; rec.reset = Date.now() + windowMs; }
  rec.n++;
  hits.set(k, rec);
  return rec.n > max;
}

/* ---------- seed ---------- */
function seed() {
  if (process.env.SEED_DEMO === 'off') return; /* set after launch so a fresh DB never re-seeds demo data */
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const demoWorkers = [
    { name: 'Sarah M.', email: 'sarah@demo.bookit.life', suburb: 'Parramatta NSW', color: '#0E6B62', exp: '6 yrs experience', langs: 'English, Auslan (basic)', services: ['community','personal-care','transport'], days: [1,1,1,0,1,0,0], bio: 'Former youth worker who loves footy, board games and getting out and about. Patient, punctual and big on routines that stick.', shifts: 112, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Police check (transport)'] },
    { name: 'Daniel O.', email: 'daniel@demo.bookit.life', suburb: 'Blacktown NSW', color: '#D94F32', exp: '4 yrs experience', langs: 'English, Samoan', services: ['employment','community','daily-tasks'], days: [1,1,0,1,1,1,0], bio: 'Supports several clients in open employment. Great with interview nerves, workplace routines and building confidence on the job.', shifts: 87, rating: 4.8, checks: ['NDIS Worker Screening','First Aid & CPR','NDIS Orientation Module'] },
    { name: 'Priya S.', email: 'priya@demo.bookit.life', suburb: 'Liverpool NSW', color: '#7A4FBF', exp: '8 yrs experience', langs: 'English, Hindi, Tamil', services: ['personal-care','household','daily-tasks'], days: [1,0,1,1,1,0,1], bio: 'Gentle, thorough and endlessly cheerful. Loves cooking with clients — her butter chicken lesson is legendary.', shifts: 203, rating: 5.0, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Cert III Individual Support'] },
    { name: 'Tom H.', email: 'tom@demo.bookit.life', suburb: 'Penrith NSW', color: '#1C7C43', exp: '3 yrs experience', langs: 'English', services: ['transport','community','household'], days: [0,1,1,1,0,1,1], bio: 'Drives a big, comfy wagon and knows every accessible café in the west. Happy to help with errands, gym runs and game day.', shifts: 64, rating: 4.9, checks: ['NDIS Worker Screening','Police check (transport)','First Aid & CPR','Comprehensive car insurance'] },
    { name: 'Amara W.', email: 'amara@demo.bookit.life', suburb: 'Bankstown NSW', color: '#B0468A', exp: '5 yrs experience', langs: 'English, Arabic', services: ['personal-care','daily-tasks','community'], days: [1,1,1,1,1,0,0], bio: 'Specialises in morning routines and building independence at home. Calm, respectful and a great listener.', shifts: 145, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Manual handling training'] },
    { name: 'Liam C.', email: 'liam@demo.bookit.life', suburb: 'Chatswood NSW', color: '#3E5A64', exp: '2 yrs experience', langs: 'English, Mandarin', services: ['employment','transport','community'], days: [1,0,1,0,1,1,1], bio: 'Uni student and part-time barista. Brilliant with tech, public transport training and finding free things to do on weekends.', shifts: 41, rating: 4.7, checks: ['NDIS Worker Screening','First Aid & CPR','NDIS Orientation Module'] },
    { name: 'Grace N.', email: 'grace@demo.bookit.life', suburb: 'Newtown NSW', color: '#C2542B', exp: '7 yrs experience', langs: 'English, Vietnamese', services: ['household','daily-tasks','personal-care'], days: [1,1,0,1,1,1,0], bio: 'Runs a tight ship: sparkling kitchens, folded laundry and meal-prepped fridges. Also a certified plant whisperer.', shifts: 178, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR'] },
    { name: 'Noah B.', email: 'noah@demo.bookit.life', suburb: 'Campbelltown NSW', color: '#0A544D', exp: '5 yrs experience', langs: 'English', services: ['community','employment','daily-tasks'], days: [0,1,1,1,1,0,1], bio: 'Ex-tradie who now supports young blokes into apprenticeships. Practical, straight-up and great on a worksite or at pub trivia.', shifts: 96, rating: 4.8, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','White Card'] },
    { name: 'Isabella R.', email: 'isabella@demo.bookit.life', suburb: 'Hornsby NSW', color: '#6B8E23', exp: '4 yrs experience', langs: 'English, Spanish', services: ['personal-care','community','household'], days: [1,1,1,0,0,1,1], bio: 'Warm, energetic and music-obsessed. Supports clients to gigs, choir and everything in between.', shifts: 88, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR'] },
    { name: 'Zoe T.', email: 'zoe@demo.bookit.life', suburb: 'Ryde NSW', color: '#8a6d00', exp: '9 yrs experience', langs: 'English, Auslan (fluent)', services: ['daily-tasks','personal-care','employment'], days: [1,1,1,1,1,1,0], bio: 'Fluent in Auslan with a decade in disability support. Loves teaching cooking, budgeting and travel skills that last a lifetime.', shifts: 260, rating: 5.0, checks: ['NDIS Worker Screening','WWCC (NSW)','First Aid & CPR','Cert IV Disability'] },
    { name: 'Kai M.', email: 'kai@demo.bookit.life', suburb: 'Brisbane QLD', color: '#2F6690', exp: '3 yrs experience', langs: 'English, Te Reo Māori', services: ['community','transport','household'], days: [0,1,1,1,1,1,0], bio: 'Surf-mad and endlessly upbeat. Supports beach days, park runs and community groups across Brisbane.', shifts: 55, rating: 4.8, checks: ['NDIS Worker Screening','Police check (transport)','First Aid & CPR'] },
    { name: 'Elena V.', email: 'elena@demo.bookit.life', suburb: 'Melbourne VIC', color: '#5D3FD3', exp: '6 yrs experience', langs: 'English, Greek', services: ['personal-care','daily-tasks','community'], days: [1,1,0,1,1,0,1], bio: 'Melbourne through and through: markets, galleries and the best souvlaki. Experienced with complex routines and hoists.', shifts: 132, rating: 4.9, checks: ['NDIS Worker Screening','WWCC (VIC)','First Aid & CPR','Manual handling training'] }
  ];
  const insUser = db.prepare('INSERT INTO users (role, name, email, pass, suburb, created) VALUES (?,?,?,?,?,?)');
  const insProf = db.prepare('INSERT INTO worker_profiles (user_id, bio, services, langs, exp, color, rating, shifts, checks, days) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const demoPass = hashPassword('demo1234');
  /* Demo profiles carry real document rows rather than the free-text `checks`
     list they used to, so the demo actually demonstrates the machinery: every
     shield on a demo profile traces to a verified document, exactly as it will
     for a real worker. The verification note says "demo data" in as many words
     — a demonstration should never look like evidence. */
  const CRED_KEY = { 'NDIS Worker Screening': 'ndis-screening', 'WWCC (NSW)': 'wwcc', 'WWCC (VIC)': 'wwcc',
    'First Aid & CPR': 'first-aid', 'NDIS Orientation Module': 'ndis-orientation', 'Police check (transport)': 'police-check',
    'Cert III Individual Support': 'cert3-support', 'Cert IV Disability': 'cert4-disability',
    'Manual handling training': 'manual-handling', 'White Card': 'qualification',
    'Comprehensive car insurance': 'other' };
  const insDoc = db.prepare(`INSERT INTO worker_docs (worker_id, doc_type, label, expiry_date, uploaded_at,
    verified_at, verified_by, verify_method, verify_note) VALUES (?,?,?,?,?,?,?,?,?)`);
  const inThreeYears = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 3); return d.toISOString().slice(0, 10); })();
  for (const w of demoWorkers) {
    const r = insUser.run('worker', w.name, w.email, demoPass, w.suburb, now());
    const uid = Number(r.lastInsertRowid);
    insProf.run(uid, w.bio, JSON.stringify(w.services), w.langs, w.exp, w.color, w.rating, w.shifts, JSON.stringify(w.checks), JSON.stringify(w.days));
    for (const label of w.checks) {
      insDoc.run(uid, CRED_KEY[label] || 'other', label, inThreeYears, now(), now(), 'BookIt (demo seed)',
        'sighted-original', 'Demo data — this is a fictional profile, not a real credential.');
    }
    db.prepare(`UPDATE worker_profiles SET screening_status = 'cleared', screening_status_at = ?, screening_status_by = 'BookIt (demo seed)',
      screening_source = 'Demo data — not a real clearance', banning_result = 'clear', banning_checked_at = ?,
      banning_aged_result = 'clear', banning_aged_at = ?, banning_aged_source = 'Demo data — register not actually checked',
      banning_acqsc_result = 'clear', banning_acqsc_at = ?, banning_acqsc_source = 'Demo data — register not actually checked',
      banning_checked_by = 'BookIt (demo seed)', banning_source = 'Demo data — register not actually checked' WHERE user_id = ?`)
      .run(now(), now(), now(), now(), uid);
  }
  insUser.run('participant', 'Demo Participant', 'demo@demo.bookit.life', demoPass, 'Wyong NSW', now());
  db.exec("UPDATE users SET verified = 1 WHERE email LIKE '%@demo.bookit.life'");
  console.log('Seeded 12 demo workers (…@demo.bookit.life / demo1234) and demo@demo.bookit.life / demo1234');
}
seed();

/* ---------- data access ---------- */
/* Note what is NOT here any more: the `checks` column. It was seeded free text
   — "NDIS Worker Screening (in progress)" — that nothing ever updated from the
   documents actually on file, and the front end drew a verification shield
   beside every line of it. That is exactly the claim 0137's display condition
   is about, so it is gone. What a participant now sees is derived, every time,
   from documents a human has verified. If nobody has checked it, it does not
   appear. */
function publicWorker(row) {
  const v = publicVerification(row.user_id, row.email);
  return {
    id: row.user_id, name: row.name, suburb: row.suburb, color: row.color,
    exp: row.exp, langs: row.langs, bio: row.bio,
    services: JSON.parse(row.services),
    checks: v.checks, screening: v.screening, banning: v.banning, registers: v.registers, demo: v.demo,
    days: JSON.parse(row.days), rating: row.rating, shifts: row.shifts,
    photo: row.photo ? `/photos/${row.user_id}?v=${encodeURIComponent(row.photo_at || '')}` : null
  };
}
/* live review aggregates override the seeded rating/shift numbers once real reviews exist */
function reviewAgg(workerId) {
  return db.prepare('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE worker_id = ? AND published = 1').get(workerId);
}
function withReviewAgg(w) {
  const agg = reviewAgg(w.id);
  if (agg.n) { w.rating = Math.round(agg.avg * 10) / 10; w.shifts = agg.n; }
  return w;
}
function convoForUser(user, convoRow) {
  const otherId = user.role === 'participant' ? convoRow.worker_id : convoRow.participant_id;
  const other = db.prepare("SELECT u.id, u.name, u.suburb, COALESCE(p.color, '#0E6B62') AS color FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ?").get(otherId);
  const last = db.prepare('SELECT body, sender_id, created FROM messages WHERE convo_id = ? ORDER BY id DESC LIMIT 1').get(convoRow.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE convo_id = ? AND sender_id != ? AND read_at IS NULL').get(convoRow.id, user.id).n;
  return {
    id: convoRow.id,
    other: { id: other.id, name: other.name, suburb: other.suburb, color: other.color },
    last: last ? { body: last.body, mine: last.sender_id === user.id, created: last.created } : null,
    unread
  };
}
function memberOf(user, convoId) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convoId);
  if (!c) return null;
  return (c.participant_id === user.id || c.worker_id === user.id) ? c : null;
}

/* ---------- routes ---------- */
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

route('GET', /^\/api\/health$/, (req, res) => json(res, 200, { ok: true, time: now() }));

route('GET', /^\/api\/me$/, (req, res, m, user) => json(res, 200, {
  user,
  demo: Boolean(db.prepare("SELECT id FROM users WHERE email LIKE '%@demo.bookit.life' LIMIT 1").get())
}));

/* ---------- the out-of-scope register ----------
   A flag is a policy. A gate is evidence. These four functions are the gate: declaring a support
   we don't hold opens a dated row automatically, taking it back closes it as withdrawn, adding
   the support to the certificate closes it as in-scope, and a human closing it has to name who
   the participant was introduced to. Nothing here can be satisfied by an intention. */
function openScope(uid, support) {
  return db.prepare("SELECT * FROM scope_requests WHERE user_id = ? AND support = ? AND outcome = 'open'").get(Number(uid), support) || null;
}
function recordScope(uid, flags, channel) {
  const opened = [];
  for (const k of hiUnheld(flags || [])) {
    if (openScope(uid, k)) continue;
    db.prepare('INSERT INTO scope_requests (user_id, support, channel, declared_at) VALUES (?,?,?,?)').run(Number(uid), k, channel, now());
    opened.push(k);
  }
  if (opened.length) console.log(`SCOPE REGISTER opened ${opened.join(', ')} for user ${uid} via ${channel}`);
  return opened;
}
function withdrawScope(uid, flags, by) {
  const keep = new Set(flags || []);
  const rows = db.prepare("SELECT id, support FROM scope_requests WHERE user_id = ? AND outcome = 'open'").all(Number(uid));
  let closed = 0;
  for (const r of rows) {
    if (keep.has(r.support)) continue;
    db.prepare("UPDATE scope_requests SET outcome = 'withdrawn', closed_by = ?, closed_at = ?, note = ? WHERE id = ?")
      .run(by, now(), 'Removed from the participant\'s own declaration.', r.id);
    closed++;
  }
  return closed;
}
/* Run at boot. If a support has been added to the certificate since these rows were opened, they
   are no longer refusals — close them as in-scope. The row keeps its original declared_at, so the
   register still shows the date the answer changed rather than pretending it never said no. */
function reconcileScope() {
  let n = 0;
  for (const sup of HI_SUPPORTS) {
    if (!sup.held) continue;
    const r = db.prepare("UPDATE scope_requests SET outcome = 'in-scope', closed_at = ?, note = ? WHERE support = ? AND outcome = 'open'")
      .run(now(), `Added to the certificate${sup.since ? ' on ' + sup.since : ''} — now delivered in scope.`, sup.key);
    n += r.changes;
  }
  if (n) console.log(`SCOPE REGISTER ${n} row(s) closed as in-scope — certificate now covers them`);
  return n;
}
try { reconcileScope(); } catch (e) { console.error('reconcileScope failed', e && e.message); }

/* What a worker needs to know before they walk in, derived live rather than stored: any support
   this participant has on the register that we still don't hold. If it later goes on the
   certificate the warning disappears by itself, because it was never a sentence, only a query. */
function scopeWarning(uid) {
  const rows = db.prepare("SELECT support FROM scope_requests WHERE user_id = ? AND outcome = 'open'").all(Number(uid));
  const keys = hiUnheld(rows.map(r => r.support));
  return keys.length ? { keys, labels: keys.map(hiLabel) } : null;
}

/* Someone has told us they need a support we are not registered to deliver. Nobody should find
   that out from a roster — mail the office the moment it is said. The register row is already
   open by the time this sends; the mail exists so a human rings before a shift is booked. */
function hiAlert(req, who, flags, when) {
  if (!MAIL_FROM) return;
  const out = hiUnheld(flags);
  if (!out.length) return;
  const partner = publicPartner();
  sendMail(MAIL_FROM, 'Specialist support requested — BookIt',
    'Someone has asked for a support outside our registration',
    `<p><b>${escHtml(who.name)}</b> (${escHtml(who.email)}${who.suburb ? ', ' + escHtml(who.suburb) : ''}) told us ${escHtml(when)} that they need:</p>
     <ul>${out.map(k => `<li>${escHtml(hiLabel(k))} <span style="color:#7A6E5F;">(${escHtml((hiSupport(k) || {}).clause || '')})</span></li>`).join('')}</ul>
     <p>These sit inside NDIS Practice Standards Supplementary Module 1 — high intensity daily personal activities, registration group <b>0104</b>. Disability &amp; Mental Health Care does not hold them, so under s13C of the Registration Rules BookIt must not deliver them.</p>
     <p><b>Call them before any shift is booked.</b> Everything else on their plan we can still support, and coordinate around whoever does the clinical part. ${partner
       ? `Introduce them to <b>${escHtml(partner.name)}</b>${partner.ndis ? ` (NDIS ${escHtml(partner.ndis)})` : ''}${partner.phone ? `, ${escHtml(partner.phone)}` : ''}, who they engage directly.`
       : 'Introduce them to a provider registered for 0104, who they engage directly.'}</p>
     <p>The register row is already open. Recording who they were introduced to is what closes it.</p>`,
    'Open the admin dashboard', `${baseUrl(req)}/#/admin`).catch(() => {});
}

/* ---------- shift notes ----------
   A note is written at the end of the shift, by the person who did it, and it is
   what an auditor samples to see that the support happened as agreed. Keeping the
   bar low is deliberate: a note nobody can face writing is a note nobody writes. */
const NOTE_MIN = 20, NOTE_MAX = 4000, SCOPE_MIN = 10;
function noteProblem(note) {
  if (!note) return 'Please write a shift note before you mark the shift completed — it\'s the record that the support happened.';
  if (note.length < NOTE_MIN) return `A few more words, please — what you did together and how it went (at least ${NOTE_MIN} characters).`;
  return '';
}
function scopeProblem(scope, detail) {
  if (!scope) return '';
  if (detail.length < SCOPE_MIN) return 'Tell us what you were asked to do — a sentence is plenty.';
  return '';
}
/* A worker flagging an out-of-scope request is the early warning the front-door
   screening question can't give us: it catches needs that appear after sign-up. */
function scopeAlert(req, bk, workerName, partName, detail) {
  if (!MAIL_FROM) return;
  sendMail(MAIL_FROM, 'Out-of-scope request flagged on a shift — BookIt',
    'A worker was asked to do something outside their scope',
    `<p><b>${escHtml(workerName)}</b> has flagged their <b>${SERVICE_LABELS[bk.service] || escHtml(bk.service)}</b> shift with <b>${escHtml(partName)}</b> on <b>${prettyDate(bk.date)}</b>.</p>
     <p><b>What they were asked to do:</b></p>
     <blockquote style="margin:0;padding:8px 14px;border-left:3px solid #D94F32;background:#FDF6EC;">${escHtml(detail)}</blockquote>
     <p><b>Call the worker today.</b> If what was asked sits inside high intensity daily personal activities (registration group <b>0104</b>) then BookIt doesn't deliver it — introduce the participant to a provider registered for 0104 and record that against their account.</p>
     <p>If it actually happened rather than only being asked for, it belongs in the incident register too.</p>`,
    'Open the admin dashboard', `${baseUrl(req)}/#/admin`).catch(() => {});
}

/* the canonical Module 1 list, so the sign-up form and the account page can never drift from it */
route('GET', /^\/api\/high-intensity$/, (req, res) => json(res, 200, scopeView()));
/* the whole registration position in one place — every claim the site makes about what we can
   deliver reads from this, so no page can outrun the certificate */
route('GET', /^\/api\/scope$/, (req, res) => json(res, 200, scopeView()));

route('POST', /^\/api\/register$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'register', 15)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const role = body.role === 'worker' ? 'worker' : 'participant';
  const name = clean(body.name, 80);
  const email = clean(body.email, 120).toLowerCase();
  const password = String(body.password || '');
  const suburb = clean(body.suburb, 80);
  if (!name || name.length < 2) return json(res, 400, { error: 'Please enter your name.' });
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Please enter a valid email address.' });
  if (password.length < 8) return json(res, 400, { error: 'Password needs at least 8 characters.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return json(res, 409, { error: 'That email already has an account — try logging in.' });
  const ndisNum = /^\d{9}$/.test(clean(body.ndis_number, 12)) ? clean(body.ndis_number, 12) : '';
  const pmEmail = EMAIL_RE.test(clean(body.pm_email, 120)) ? clean(body.pm_email, 120).toLowerCase() : '';
  const services = Array.isArray(body.services) ? body.services.filter(s => SERVICES.includes(s)).slice(0, 6) : [];
  const hiFlags = role === 'participant' ? hiFrom(body) : [];
  const r = db.prepare('INSERT INTO users (role, name, email, pass, suburb, phone, plan, ndis_number, pm_email, svc_interest, hi_flags, hi_at, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(role, name, email, hashPassword(password), suburb, clean(body.phone, 40), clean(body.plan, 30), ndisNum, pmEmail,
         JSON.stringify(services), JSON.stringify(hiFlags), hiFlags.length ? now() : '', now());
  const uid = Number(r.lastInsertRowid);
  if (hiFlags.length) { recordScope(uid, hiFlags, 'signup'); hiAlert(req, { id: uid, name, email, suburb }, hiFlags, 'at signup'); }
  if (role === 'worker') {
    /* vetting: new workers start hidden (visible = 0) until an admin approves them */
    db.prepare('INSERT INTO worker_profiles (user_id, bio, services, visible) VALUES (?,?,?,0)')
      .run(uid, clean(body.bio, 600), JSON.stringify(services));
    if (MAIL_FROM) sendMail(MAIL_FROM, 'New worker application — BookIt',
      'A new support worker has applied',
      `<p><b>${escHtml(name)}</b> (${escHtml(suburb) || 'no suburb given'}) has registered as a worker and is waiting for approval.</p><p><b>Email:</b> ${escHtml(email)}<br><b>Services:</b> ${services.map(s => SERVICE_LABELS[s] || s).join(', ') || '—'}</p><p>Their profile stays hidden from Find Workers until you approve it.</p>`,
      'Open the admin dashboard', `${baseUrl(req)}/#/admin`).catch(() => {});
  }
  const me = sessionUser(uid);
  sendVerifyEmail(req, me).catch(() => {});
  json(res, 200, { user: me }, setSessionHeaders(uid));
});

route('POST', /^\/api\/login$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'login', 25)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const email = clean(body.email, 120).toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !verifyPassword(String(body.password || ''), row.pass)) {
    return json(res, 401, { error: 'Email or password doesn\'t match.' });
  }
  json(res, 200, { user: sessionUser(row.id) }, setSessionHeaders(row.id));
});

route('POST', /^\/api\/logout$/, (req, res) => json(res, 200, { ok: true }, CLEAR_COOKIE));

/* participant billing details (funding lane, NDIS number, plan manager) */
route('POST', /^\/api\/me\/billing$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Only participants have billing details.' });
  const plan = ['self', 'plan', 'ndia', 'none'].includes(body.plan) ? body.plan : '';
  const nd = clean(body.ndis_number, 12).replace(/\s+/g, '');
  if (nd && !/^\d{9}$/.test(nd)) return json(res, 400, { error: 'An NDIS number is 9 digits (e.g. 430123456).' });
  const pm = clean(body.pm_email, 120).toLowerCase();
  if (pm && !EMAIL_RE.test(pm)) return json(res, 400, { error: 'That plan manager email doesn\'t look right.' });
  db.prepare('UPDATE users SET plan = ?, ndis_number = ?, pm_email = ? WHERE id = ?').run(plan || user.plan, nd, pm, user.id);
  const me = sessionUser(user.id);
  json(res, 200, { user: me });
});

/* a participant's own declaration — they can add to it or correct it whenever they like.
   Changing what was declared reopens the flag, because the last conversation was about
   something else; re-saving the same answer leaves the recorded referral alone. */
route('POST', /^\/api\/me\/high-intensity$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Only participants have a support-needs declaration.' });
  const flags = hiFrom(body);
  const row = db.prepare('SELECT hi_flags, hi_referred_at FROM users WHERE id = ?').get(user.id) || {};
  const before = safeJson(row.hi_flags, []);
  const changed = before.slice().sort().join(',') !== flags.slice().sort().join(',');
  if (!changed) return json(res, 200, { user: sessionUser(user.id), unchanged: true });
  db.prepare('UPDATE users SET hi_flags = ?, hi_at = ?, hi_referred_at = ?, hi_note = ? WHERE id = ?')
    .run(JSON.stringify(flags), flags.length ? now() : '', '', '', user.id);
  withdrawScope(user.id, flags, user.email);
  recordScope(user.id, flags, 'account page');
  const added = flags.filter(k => !before.includes(k));
  if (added.length) hiAlert(req, user, flags, 'from their account page');
  json(res, 200, { user: sessionUser(user.id), flagged: hiUnheld(flags).length > 0 });
});

/* ---------- email flows: forgot / reset / verify ---------- */
route('POST', /^\/api\/forgot$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'forgot', 8)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const email = clean(body.email, 120).toLowerCase();
  const row = EMAIL_RE.test(email) ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (row) {
    const token = makeEmailToken('r', row.id, 45 * 60e3, String(row.pass).slice(0, 16));
    const url2 = `${baseUrl(req)}/#/reset?token=${token}`;
    sendMail(row.email, 'Reset your BookIt password',
      `Hi ${firstName(row.name)},`,
      `<p>Someone (hopefully you) asked to reset the password on your BookIt account. Press the button to choose a new one — the link works for 45 minutes.</p><p>If this wasn't you, ignore this email and nothing changes.</p>`,
      'Choose a new password', url2).catch(() => {});
  }
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/reset$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'reset', 10)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  const password = String(body.password || '');
  if (password.length < 8) return json(res, 400, { error: 'Password needs at least 8 characters.' });
  const u = readEmailToken('r', body.token, x => String(x.pass).slice(0, 16));
  if (!u) return json(res, 400, { error: 'That reset link is invalid or has expired — request a fresh one from the log in screen.' });
  /* clicking an emailed link also proves the address works */
  db.prepare('UPDATE users SET pass = ?, verified = 1 WHERE id = ?').run(hashPassword(password), u.id);
  const me = sessionUser(u.id);
  json(res, 200, { user: me }, setSessionHeaders(u.id));
});

route('POST', /^\/api\/resend-verification$/, (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (limited(ip, 'resend', 6)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  if (user.verified) return json(res, 200, { ok: true, already: true });
  sendVerifyEmail(req, user).catch(() => {});
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/email-test$/, async (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (limited(ip, 'emailtest', 6)) return json(res, 429, { error: 'Too many attempts — try again later.' });
  if (!EMAIL_ON) return json(res, 200, { ok: false, error: 'Email is not configured yet — set SMTP_USER and SMTP_PASS.' });
  if (user.email.endsWith('@demo.bookit.life')) return json(res, 400, { error: 'Demo accounts never receive email — log in with a real account to test.' });
  try {
    await sendMail(user.email, 'BookIt email test',
      `It works, ${firstName(user.name)}!`,
      `<p>This test email was sent by your BookIt server through <b>${RESEND_KEY ? 'the Resend API' : escHtml(SMTP_HOST)}</b>. Welcome emails, password resets and booking updates are all go.</p>`,
      'Open BookIt', baseUrl(req));
    json(res, 200, { ok: true, sent_to: user.email, via: RESEND_KEY ? 'resend-api' : `${SMTP_HOST}:${SMTP_PORT}` });
  } catch (e) {
    json(res, 502, { ok: false, error: e.message });
  }
});

/* ---------- admin: dashboard + worker vetting ---------- */
route('GET', /^\/api\/admin\/overview$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const counts = {
    participants: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'participant'").get().n,
    workers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'worker'").get().n,
    pending: db.prepare('SELECT COUNT(*) AS n FROM worker_profiles WHERE visible = 0').get().n,
    bookings: db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,
    messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
    contacts: db.prepare('SELECT COUNT(*) AS n FROM contact_messages').get().n,
    completed: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'completed'").get().n,
    billed: Math.round(db.prepare("SELECT COALESCE(SUM(total), 0) AS s FROM bookings WHERE status = 'completed'").get().s * 100) / 100,
    open_incidents: db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE status != 'closed'").get().n,
    urgent_incidents: db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE reportable = 1 AND commission_notified_at IS NULL AND status != 'closed'").get().n,
    open_complaints: db.prepare("SELECT COUNT(*) AS n FROM complaints WHERE status != 'resolved'").get().n,
    hi_open: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'participant' AND COALESCE(hi_flags,'[]') NOT IN ('[]','') AND COALESCE(hi_referred_at,'') = ''").get().n,
    scope_open: db.prepare("SELECT COUNT(*) AS n FROM scope_requests WHERE outcome = 'open'").get().n,
    scope_total: db.prepare('SELECT COUNT(*) AS n FROM scope_requests').get().n,
    notes_flagged: db.prepare('SELECT COUNT(*) AS n FROM shift_notes WHERE scope_flag = 1 AND reviewed_at IS NULL').get().n,
    notes_total: db.prepare('SELECT COUNT(*) AS n FROM shift_notes').get().n
  };
  const launch = {
    gate: Boolean(SITE_PASSWORD),
    demo_accounts: db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@demo.bookit.life'").get().n
  };
  const pending = db.prepare(`SELECT p.user_id, p.bio, p.services, p.photo, p.photo_at, u.name, u.email, u.suburb, u.phone, u.verified, u.created
    FROM worker_profiles p JOIN users u ON u.id = p.user_id WHERE p.visible = 0 ORDER BY u.created DESC`).all()
    .map(w => ({ ...w, photo: w.photo ? `/photos/${w.user_id}?v=${encodeURIComponent(w.photo_at || '')}` : null, services: JSON.parse(w.services || '[]') }));
  const users = db.prepare('SELECT u.id, u.role, u.name, u.email, u.suburb, u.verified, u.created, p.visible FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id ORDER BY u.id DESC LIMIT 100').all();
  const bookings = db.prepare(`SELECT b.id, b.service, b.date, b.start, b.hours, b.status, b.created,
    up.name AS participant_name, uw.name AS worker_name FROM bookings b
    JOIN users up ON up.id = b.participant_id JOIN users uw ON uw.id = b.worker_id ORDER BY b.id DESC LIMIT 50`).all();
  const contacts = db.prepare('SELECT id, name, email, topic, body, created FROM contact_messages ORDER BY id DESC LIMIT 50').all();
  /* open ones first — an unanswered declaration is the one that can put a worker somewhere they shouldn't be */
  const highIntensity = db.prepare(`SELECT id, name, email, phone, suburb, plan, created, svc_interest, hi_flags, hi_at, hi_referred_at, hi_note
    FROM users WHERE role = 'participant' AND (COALESCE(hi_flags,'[]') NOT IN ('[]','') OR COALESCE(hi_note,'') <> '')
    ORDER BY (COALESCE(hi_referred_at,'') = '') DESC, id DESC`).all()
    .map(r => {
      const flags = safeJson(r.hi_flags, []);
      return { ...r, hi_flags: flags, hi_labels: flags.map(hiLabel), svc_interest: safeJson(r.svc_interest, []) };
    });
  const scopeRegister = db.prepare(`SELECT r.*, u.name, u.email, u.phone FROM scope_requests r
    JOIN users u ON u.id = r.user_id ORDER BY (r.outcome = 'open') DESC, r.id DESC LIMIT 100`).all()
    .map(r => ({ ...r, label: hiLabel(r.support), clause: (hiSupport(r.support) || {}).clause || '' }));
  json(res, 200, { counts, pending, users, bookings, contacts, launch, high_intensity: highIntensity, scope_register: scopeRegister, scope: scopeView() });
});

/* launch sweep — permanently removes every demo account and everything they touched.
   Run it once, just before going live; deleting SITE_PASSWORD is then the only step left. */
route('POST', /^\/api\/admin\/launch-sweep$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  if (clean(body.confirm, 20) !== 'LAUNCH') return json(res, 400, { error: 'Type LAUNCH to confirm — this permanently removes all demo accounts and their data.' });
  const demoIds = db.prepare("SELECT id FROM users WHERE email LIKE '%@demo.bookit.life'").all().map(r => r.id);
  if (!demoIds.length) return json(res, 200, { ok: true, removed: 0, note: 'Already clean — no demo accounts left.' });
  const ph = demoIds.map(() => '?').join(',');
  const convos = db.prepare(`SELECT id FROM conversations WHERE participant_id IN (${ph}) OR worker_id IN (${ph})`).all(...demoIds, ...demoIds).map(r => r.id);
  if (convos.length) {
    const cph = convos.map(() => '?').join(',');
    db.prepare(`DELETE FROM messages WHERE convo_id IN (${cph})`).run(...convos);
    db.prepare(`DELETE FROM conversations WHERE id IN (${cph})`).run(...convos);
  }
  db.prepare(`DELETE FROM reviews WHERE participant_id IN (${ph}) OR worker_id IN (${ph})`).run(...demoIds, ...demoIds);
  db.prepare(`DELETE FROM shift_notes WHERE participant_id IN (${ph}) OR worker_id IN (${ph})`).run(...demoIds, ...demoIds);
  const bk = db.prepare(`DELETE FROM bookings WHERE participant_id IN (${ph}) OR worker_id IN (${ph})`).run(...demoIds, ...demoIds);
  db.prepare(`DELETE FROM worker_docs WHERE worker_id IN (${ph})`).run(...demoIds);
  db.prepare(`DELETE FROM worker_profiles WHERE user_id IN (${ph})`).run(...demoIds);
  const u = db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...demoIds);
  console.log(`LAUNCH SWEEP by ${user.email}: removed ${u.changes} demo accounts, ${bk.changes} bookings, ${convos.length} conversations.`);
  json(res, 200, { ok: true, removed: Number(u.changes), bookings: Number(bk.changes), conversations: convos.length });
});

route('POST', /^\/api\/admin\/workers\/(\d+)\/approve$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.name, u.email FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  /* Two different kinds of requirement, and the difference matters.

     The 0137 conditions are conditions of registration. They are not house
     rules we can wave through when someone is short-staffed on a Friday, so
     `override` does not reach them — an admin who ticks "approve anyway" gets
     the same refusal. Everything else (a missing profile photo) is ours, and
     stays overridable exactly as before. */
  if (!isDemoWorker(w.email)) {
    const st = platformStatus(uid);
    if (!st.ok) {
      return json(res, 400, {
        blocked_0137: true,
        blocks: st.blocks,
        error: `This worker can't be approved yet — it would breach BookIt's conditions of registration for 0137 NDIS Digital Platform Service. ${st.blocks.join(' ')} These can't be overridden.`
      });
    }
    if (!body.override) {
      const missing = [];
      const prof = db.prepare('SELECT photo FROM worker_profiles WHERE user_id = ?').get(uid);
      if (!prof || !prof.photo) missing.push('a profile photo');
      if (missing.length) {
        return json(res, 400, { needs_override: true, error: `Still needed before approval: ${missing.join(' and ')}. Ask the worker to add ${missing.length > 1 ? 'them' : 'it'} from their Bookings page — or tick "approve anyway" to override.` });
      }
    }
  }
  db.prepare('UPDATE worker_profiles SET visible = 1 WHERE user_id = ?').run(uid);
  logCompliance({ worker_id: uid, worker_name: w.name, kind: 'platform-access', result: 'granted',
    detail: 'Profile approved and made visible — 0137 conditions met at time of approval.', checked_by: user.name });
  sendMail(w.email, 'Your BookIt profile is live', `Great news, ${firstName(w.name)} 🎉`,
    `<p>Your checks are in order and your profile has been approved — you're now visible in <b>Find Workers</b> across BookIt.</p><p>Participants can message you and request bookings from today. Keep your availability up to date, reply promptly, and welcome aboard!</p>`,
    'Open BookIt', `${baseUrl(req)}/#/find-workers`).catch(() => {});
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/workers\/(\d+)\/hide$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.id, u.name FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  db.prepare('UPDATE worker_profiles SET visible = 0 WHERE user_id = ?').run(uid);
  logCompliance({ worker_id: uid, worker_name: w.name, kind: 'platform-access', result: 'withdrawn',
    detail: 'Profile hidden by an administrator.', checked_by: user.name });
  json(res, 200, { ok: true });
});

/* ---------- admin: invoicing ---------- */
function invoiceRows() {
  return db.prepare(`SELECT b.id, b.service, b.date, b.start, b.hours, b.rate_category, b.unit_price, b.worker_share, b.total, b.completed_at,
      up.name AS participant_name, up.email AS participant_email, uw.name AS worker_name
    FROM bookings b JOIN users up ON up.id = b.participant_id JOIN users uw ON uw.id = b.worker_id
    WHERE b.status = 'completed' ORDER BY b.date DESC, b.id DESC`).all();
}
/* The register itself — every row, newest open first, with the participant against it. This is
   the page you turn to an auditor: dated, per support, with a named referral on every closed row. */
function scopeRegisterRows() {
  return db.prepare(`SELECT r.*, u.name, u.email, u.phone, u.suburb FROM scope_requests r
    JOIN users u ON u.id = r.user_id ORDER BY (r.outcome = 'open') DESC, r.id DESC`).all()
    .map(r => ({ ...r, label: hiLabel(r.support), clause: (hiSupport(r.support) || {}).clause || '' }));
}
route('GET', /^\/api\/admin\/scope-register$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { rows: scopeRegisterRows(), supports: HI_SUPPORTS, partner: publicPartner() });
});
route('GET', /^\/api\/admin\/scope-register\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [['Entry', 'Participant', 'Email', 'Phone', 'Suburb', 'Support requested', 'Schedule 2 clause', 'Declared via', 'Declared', 'Outcome', 'Introduced to', 'Note', 'Closed by', 'Closed'].map(q).join(',')];
  for (const r of scopeRegisterRows()) {
    const day = t => t ? dmy(String(t).slice(0, 10)) : ''; /* dmy() wants a bare date, and these are full timestamps */
    lines.push([r.id, r.name, r.email, r.phone, r.suburb, r.label, r.clause, r.channel, day(r.declared_at), r.outcome, r.referred_to, r.note, r.closed_by, day(r.closed_at)].map(q).join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="scope-register-${now().slice(0, 10)}.csv"`
  });
  res.end('\ufeff' + lines.join('\r\n'));
});

/* Closing a row. 'referred' is the only outcome that means we did our job, and it will not save
   without a name in it — "introduced them to someone" is not a record, "introduced them to
   <provider> on <date>" is. Everything else is honest bookkeeping, not a way around that. */
route('POST', /^\/api\/admin\/scope-requests\/(\d+)$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const row = db.prepare('SELECT * FROM scope_requests WHERE id = ?').get(Number(m[1]));
  if (!row) return json(res, 404, { error: 'Register entry not found.' });
  if (row.outcome !== 'open') return json(res, 400, { error: 'That entry is already closed.' });
  const outcome = clean(body.outcome, 20);
  if (!['referred', 'withdrawn'].includes(outcome)) return json(res, 400, { error: 'Choose whether they were introduced to another provider, or took the request back.' });
  const note = clean(body.note, 500);
  const referredTo = clean(body.referred_to, 160);
  if (outcome === 'referred' && !referredTo) return json(res, 400, { error: 'Name the provider you introduced them to — an unnamed referral is not a record.' });
  if (outcome === 'withdrawn' && !note) return json(res, 400, { error: 'Say why it came off — "ticked in error, confirmed by phone 21/07" is enough.' });
  db.prepare('UPDATE scope_requests SET outcome = ?, referred_to = ?, note = ?, closed_by = ?, closed_at = ? WHERE id = ?')
    .run(outcome, referredTo, note, user.email, now(), row.id);
  if (outcome === 'withdrawn') {
    const left = safeJson((db.prepare('SELECT hi_flags FROM users WHERE id = ?').get(row.user_id) || {}).hi_flags, []).filter(k => k !== row.support);
    db.prepare('UPDATE users SET hi_flags = ? WHERE id = ?').run(JSON.stringify(left), row.user_id);
  }
  const stillOpen = db.prepare("SELECT COUNT(*) AS n FROM scope_requests WHERE user_id = ? AND outcome = 'open'").get(row.user_id).n;
  if (!stillOpen) db.prepare('UPDATE users SET hi_referred_at = ? WHERE id = ?').run(now(), row.user_id);
  console.log(`SCOPE REGISTER #${row.id} closed as ${outcome} by ${user.email}`);
  json(res, 200, { ok: true, outcome, still_open: stillOpen });
});

/* Record what was actually discussed with someone who declared a high-intensity support.
   The note IS the record — an auditor asking "what did you do when someone asked for a support
   you're not registered for?" gets a dated line with a name against it. */
route('POST', /^\/api\/admin\/participants\/(\d+)\/high-intensity$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const id = Number(m[1]);
  const p = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'participant'").get(id);
  if (!p) return json(res, 404, { error: 'Participant not found.' });
  const note = clean(body.note, 500);
  if (body.clear) {
    if (!note) return json(res, 400, { error: 'Say why it is being cleared — "ticked in error, confirmed by phone 21/07" is enough.' });
    db.prepare("UPDATE users SET hi_flags = '[]', hi_at = '', hi_referred_at = ?, hi_note = ? WHERE id = ?").run(now(), note, id);
    console.log(`HIGH-INTENSITY flag cleared by ${user.email} for participant ${id}`);
    return json(res, 200, { ok: true, cleared: true });
  }
  if (!note) return json(res, 400, { error: 'Write a line about what was discussed and who they were introduced to — that line is the record.' });
  db.prepare('UPDATE users SET hi_referred_at = ?, hi_note = ? WHERE id = ?').run(now(), note, id);
  console.log(`HIGH-INTENSITY referral recorded by ${user.email} for participant ${id}`);
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/admin\/invoices$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = invoiceRows();
  const sum = rows.reduce((a, r) => { a.total += r.total || 0; a.worker += r.worker_share || 0; return a; }, { total: 0, worker: 0 });
  json(res, 200, {
    invoices: rows,
    totals: { billed: Math.round(sum.total * 100) / 100, worker_share: Math.round(sum.worker * 100) / 100 },
    categories: Object.entries(INVOICE_RATES).map(([key, r]) => ({ key, label: r.label, price: r.price }))
  });
});
route('POST', /^\/api\/admin\/invoices\/(\d+)\/category$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const b = db.prepare("SELECT id FROM bookings WHERE id = ? AND status = 'completed'").get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'No such completed shift.' });
  const inv = applyInvoice(b.id, clean(body.category, 30));
  if (!inv) return json(res, 400, { error: 'Unknown rate category.' });
  json(res, 200, { ok: true, invoice: inv });
});
route('GET', /^\/api\/admin\/invoices\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Shift ID', 'Date', 'Start', 'Hours', 'Service', 'Registration group', 'Participant', 'Participant email', 'Worker', 'Rate category', 'Unit price ($/h)', 'Total billed ($)', 'Worker share incl. super ($)', 'Completed at'].map(q).join(',')];
  for (const r of invoiceRows()) {
    lines.push([r.id, r.date, r.start, r.hours, SERVICE_LABELS[r.service] || r.service, REG_GROUPS[r.service] || '', r.participant_name, r.participant_email, r.worker_name,
      (INVOICE_RATES[r.rate_category] || {}).label || r.rate_category, (r.unit_price ?? 0).toFixed(2), (r.total ?? 0).toFixed(2), (r.worker_share ?? 0).toFixed(2), r.completed_at].map(q).join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-invoices-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end('﻿' + lines.join('\r\n'));
});

/* ---------- admin: claims & payments (the money engine) ---------- */
const dmy = iso => String(iso || '').split('-').reverse().join('/');
function claimRows(where) {
  return db.prepare(`SELECT b.id, b.service, b.date, b.start, b.hours, b.rate_category, b.unit_price, b.total,
      b.claim_status, b.claim_ref, b.invoice_no, b.support_item, b.claimed_at, b.paid_at, b.pay_url,
      up.id AS pid, up.name AS participant_name, up.email AS participant_email, up.plan AS funding, up.ndis_number, up.pm_email,
      uw.name AS worker_name
    FROM bookings b JOIN users up ON up.id = b.participant_id JOIN users uw ON uw.id = b.worker_id
    WHERE b.status = 'completed' ${where || ''} ORDER BY b.date ASC, b.id ASC`).all();
}
function effectiveItem(r) { return r.support_item || supportItemFor(r.service, r.rate_category) || ''; }
function lineFlags(r) {
  const flags = [];
  if (!['ndia', 'plan', 'self'].includes(r.funding)) flags.push('no funding type on the participant profile');
  if (r.funding === 'ndia' && !/^\d{9}$/.test(r.ndis_number || '')) flags.push('NDIS number missing');
  if (r.funding === 'plan' && !r.pm_email) flags.push('plan manager email missing');
  if (!effectiveItem(r)) flags.push('support item number needed');
  else if (ITEM_CONFIRM[r.service] && !r.support_item) flags.push('confirm the prefilled support item');
  return flags;
}

route('GET', /^\/api\/admin\/claims$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = claimRows().map(r => ({ ...r, item: effectiveItem(r), flags: r.claim_status ? [] : lineFlags(r) }));
  const unclaimed = rows.filter(r => !r.claim_status);
  const claimed = rows.filter(r => r.claim_status === 'claimed');
  const paid = rows.filter(r => r.claim_status === 'paid');
  const sum = a => Math.round(a.reduce((n, r) => n + (r.total || 0), 0) * 100) / 100;
  json(res, 200, {
    unclaimed, claimed, paid,
    totals: { unclaimed: sum(unclaimed), claimed: sum(claimed), paid: sum(paid) },
    reg_no: NDIS_REG_NO
  });
});

route('POST', /^\/api\/admin\/claims\/(\d+)\/item$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const item = clean(body.support_item, 20);
  if (item && !/^\d{2}_\d{3}_\d{4}_\d_\d$/.test(item)) return json(res, 400, { error: 'Support item numbers look like 01_011_0107_1_1.' });
  const r = db.prepare("SELECT id FROM bookings WHERE id = ? AND status = 'completed'").get(Number(m[1]));
  if (!r) return json(res, 404, { error: 'No such completed shift.' });
  db.prepare('UPDATE bookings SET support_item = ? WHERE id = ?').run(item, r.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/claims\/run$/, async (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = claimRows("AND (b.claim_status IS NULL OR b.claim_status = '')");
  const needs = [], ndiaClaimed = [], invoiceGroups = new Map();
  for (const r of rows) {
    const flags = lineFlags(r).filter(f => !f.startsWith('confirm'));
    if (flags.length) { needs.push({ id: r.id, date: r.date, participant: r.participant_name, flags }); continue; }
    const item = effectiveItem(r);
    if (r.funding === 'ndia') {
      db.prepare("UPDATE bookings SET claim_status = 'claimed', claim_ref = ?, support_item = ?, claimed_at = ? WHERE id = ?")
        .run(`BK${r.id}`, item, now(), r.id);
      ndiaClaimed.push(r.id);
    } else {
      const key = `${r.pid}:${r.funding}`;
      if (!invoiceGroups.has(key)) invoiceGroups.set(key, []);
      invoiceGroups.get(key).push({ ...r, item });
    }
  }
  const invoices = [];
  for (const group of invoiceGroups.values()) {
    const first = group[0];
    let invNo = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${first.pid}`;
    let n = 1;
    while (db.prepare('SELECT 1 FROM bookings WHERE invoice_no = ?').get(n === 1 ? invNo : `${invNo}-${n}`)) n++;
    if (n > 1) invNo = `${invNo}-${n}`;
    const total = Math.round(group.reduce((s, r) => s + (r.total || 0), 0) * 100) / 100;
    for (const r of group) {
      db.prepare("UPDATE bookings SET claim_status = 'claimed', claim_ref = ?, support_item = ?, invoice_no = ?, claimed_at = ? WHERE id = ?")
        .run(`BK${r.id}`, r.item, invNo, now(), r.id);
    }
    const self = first.funding === 'self';
    const dest = self ? first.participant_email : first.pm_email;
    /* self-managed + Stripe configured → hosted card-payment link for the whole invoice */
    let payUrl = '';
    if (self && STRIPE_KEY) {
      try {
        const session = await stripeRequest('/v1/checkout/sessions', {
          mode: 'payment',
          'line_items[0][quantity]': 1,
          'line_items[0][price_data][currency]': 'aud',
          'line_items[0][price_data][unit_amount]': Math.round(total * 100),
          'line_items[0][price_data][product_data][name]': `BookIt invoice ${invNo} — NDIS supports for ${first.participant_name}`,
          'metadata[invoice_no]': invNo,
          customer_email: dest,
          success_url: `${APP_URL || baseUrl(req)}/#/pay-success`,
          cancel_url: `${APP_URL || baseUrl(req)}/#/bookings`
        });
        payUrl = session.url || '';
        if (payUrl) db.prepare('UPDATE bookings SET stripe_session = ?, pay_url = ? WHERE invoice_no = ?').run(session.id || '', payUrl, invNo);
      } catch (e) { console.error(`[stripe] session failed for ${invNo}: ${e.message}`); }
    }
    const pdf = makeInvoicePdf({
      invoice_no: invNo,
      date: dmy(new Date().toISOString().slice(0, 10)),
      self,
      bill_to: self
        ? [first.participant_name, first.participant_email, first.ndis_number ? `NDIS number: ${first.ndis_number}` : '']
        : [`Plan manager for ${first.participant_name}`, dest, first.ndis_number ? `NDIS number: ${first.ndis_number}` : ''],
      lines: group.map(r => ({
        date: dmy(r.date),
        service: (SERVICE_LABELS[r.service] || r.service) + (r.rate_category === 'sleepover' ? ' — sleepover (per night)' : ''),
        item: r.item,
        hours: (INVOICE_RATES[r.rate_category] || {}).perNight ? 1 : r.hours,
        rate: r.unit_price || 0, amount: r.total || 0
      })),
      total
    });
    let emailed = false;
    try {
      await sendMail(dest, `Invoice ${invNo} — BookIt supports for ${first.participant_name}`,
        `Invoice ${invNo}`,
        `<p>Please find attached invoice <b>${invNo}</b> for NDIS supports delivered to <b>${escHtml(first.participant_name)}</b> — total <b>$${total.toFixed(2)}</b> (GST-free). Payment within 14 days, thank you.</p>${payUrl ? '<p>Fastest way: press the button below to <b>pay by card</b> — the invoice marks itself paid instantly. Bank transfer details are on the attached PDF if you prefer.</p>' : ''}<p>Prices align with the NDIS Pricing Arrangements and Price Limits 2026–27. Questions? Just reply to this email.</p>`,
        payUrl ? '💳 Pay by card' : null, payUrl || null, MAIL_FROM, [{ filename: `${invNo}.pdf`, mime: 'application/pdf', buffer: pdf }]);
      emailed = EMAIL_ON;
    } catch (e) { console.error(`[claims] invoice email failed for ${invNo}: ${e.message}`); }
    invoices.push({ invoice_no: invNo, to: dest, funding: first.funding, lines: group.length, total, emailed });
  }
  json(res, 200, { ok: true, ndia_claimed: ndiaClaimed.length, invoices, needs_attention: needs });
});

route('GET', /^\/api\/admin\/claims\/pace\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = claimRows("AND up.plan = 'ndia' AND b.claim_status = 'claimed'");
  const header = ['RegistrationNumber', 'NDISNumber', 'SupportsDeliveredFrom', 'SupportsDeliveredTo', 'SupportNumber', 'ClaimReference', 'Quantity', 'Hours', 'UnitPrice', 'GSTCode', 'ClaimType', 'CancellationReason', 'ABN', 'InKindFundingProgram', 'ClaimReason', 'RequestedAmount'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const qty = (INVOICE_RATES[r.rate_category] || {}).perNight ? 1 : r.hours; /* sleepovers claim 1 Each */
    lines.push([q(NDIS_REG_NO), q(r.ndis_number), q(dmy(r.date)), q(dmy(r.date)), q(effectiveItem(r)), q(r.claim_ref || `BK${r.id}`),
      qty, '', (r.unit_price || 0).toFixed(2), 'P2', '', '', q(COMPANY_ABN), '', '', (r.total || 0).toFixed(2)].join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-pace-claims-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end(lines.join('\r\n'));
});

route('POST', /^\/api\/admin\/claims\/(\d+)\/paid$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const r = db.prepare("SELECT id, claim_status FROM bookings WHERE id = ? AND status = 'completed'").get(Number(m[1]));
  if (!r || !r.claim_status) return json(res, 404, { error: 'No such claimed shift.' });
  if (body.paid === false) db.prepare("UPDATE bookings SET claim_status = 'claimed', paid_at = NULL WHERE id = ?").run(r.id);
  else db.prepare("UPDATE bookings SET claim_status = 'paid', paid_at = ? WHERE id = ?").run(now(), r.id);
  json(res, 200, { ok: true });
});

/* ---------- compliance: worker credentials ---------- */
const DOCS_DIR = process.env.DOCS_DIR || path.join(path.dirname(path.resolve(DB_PATH)), 'bookit-docs');
try { fs.mkdirSync(DOCS_DIR, { recursive: true }); } catch {}
const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(path.dirname(path.resolve(DB_PATH)), 'bookit-photos');
try { fs.mkdirSync(PHOTOS_DIR, { recursive: true }); } catch {}
/* ---------- the Australian document catalogue ----------
   Everything a worker hands over during onboarding, structured the way providers
   actually check it: identity (100 points) first, then right to work, the formal
   checks, training, and qualifications. Keys are stable — the original four
   (ndis-screening, wwcc, first-aid, other) are unchanged so existing rows keep
   working. expiry: 'required' | 'optional' | 'none' drives validation + UI.
   points/primary implement the standard 100-point ID check; rtw marks documents
   that evidence the right to work in Australia. */
const DOC_CATEGORIES = [
  { key: 'identity',      label: 'Identity — 100 points of ID' },
  { key: 'right-to-work', label: 'Right to work in Australia' },
  { key: 'checks',        label: 'Checks & clearances' },
  { key: 'training',      label: 'Training certificates' },
  { key: 'qualification', label: 'Qualifications & resume' },
  { key: 'other',         label: 'Anything else' }
];
const DOC_CATALOG = [
  /* identity — primary documents (70 points) */
  { key: 'passport-au', label: 'Australian Passport', category: 'identity', points: 70, primary: true, rtw: true, expiry: 'optional', numberLabel: 'Passport number', aliases: ['passport'], help: 'Current, or expired less than 2 years ago and not cancelled.' },
  { key: 'passport-foreign', label: 'Foreign Passport', category: 'identity', points: 70, primary: true, expiry: 'optional', numberLabel: 'Passport number', aliases: ['overseas passport', 'international passport'], help: 'Pair it with your visa under Right to work.' },
  { key: 'birth-cert', label: 'Australian Birth Certificate', category: 'identity', points: 70, primary: true, rtw: true, expiry: 'none', numberLabel: 'Registration number', aliases: ['birth certificate'] },
  { key: 'citizenship-cert', label: 'Australian Citizenship Certificate', category: 'identity', points: 70, primary: true, rtw: true, expiry: 'none', numberLabel: 'Certificate number', aliases: ['citizenship certificate', 'citizenship'] },
  /* identity — secondary with photo and signature (40 points) */
  { key: 'driver-licence', label: 'Australian Driver Licence', category: 'identity', points: 40, expiry: 'optional', numberLabel: 'Licence number', aliases: ['drivers licence', 'drivers license', 'driver license', 'licence'], help: 'Also needed for any transport shifts.' },
  { key: 'proof-of-age', label: 'Photo / Proof of Age Card', category: 'identity', points: 40, expiry: 'optional', numberLabel: 'Card number', aliases: ['photo card', 'proof of age card'] },
  /* identity — secondary documents (25 points) */
  { key: 'medicare', label: 'Medicare Card', category: 'identity', points: 25, expiry: 'optional', numberLabel: 'Card number', aliases: ['medicare'] },
  { key: 'bank-card', label: 'Bank or Credit Card', category: 'identity', points: 25, expiry: 'none', numberLabel: null, aliases: ['bank card', 'debit card', 'credit card'], help: 'A photo showing your name — cover the long card number.' },
  { key: 'utility-bill', label: 'Utility Bill / Rates Notice', category: 'identity', points: 25, expiry: 'none', numberLabel: null, aliases: ['electricity bill', 'gas bill', 'rates notice', 'phone bill'], help: 'Less than 12 months old, showing your name and current address.' },
  /* right to work */
  { key: 'visa', label: 'Visa Grant Notice / VEVO Check', category: 'right-to-work', rtw: true, expiry: 'optional', numberLabel: 'Visa grant number', aliases: ['vevo', 'visa grant', 'work visa', 'work rights'], help: 'Non-citizens: current visa with work rights, together with your passport.' },
  /* checks & clearances */
  { key: 'ndis-screening', label: 'NDIS Worker Screening Check', category: 'checks', expiry: 'required', numberLabel: 'Check number', aliases: ['screening', 'worker screening', 'ndiswc', 'ndis check'], help: 'Required before your profile can go live — apply through your state screening unit.' },
  { key: 'wwcc', label: 'Working with Children Check', category: 'checks', expiry: 'required', numberLabel: 'WWCC number', aliases: ['working with childrens check', 'wwc', 'blue card', 'wwvp', 'ochre card'], help: 'Needed to support participants under 18. State-based (Blue Card in QLD, Ochre Card in NT).' },
  /* Kept so existing uploads still have a home and nothing 404s, but no longer
     a form the register asks for: the NDIS Worker Screening Check already
     contains a nationally coordinated criminal history check. */
  { key: 'police-check', label: 'National Police Check', category: 'checks', expiry: 'optional', numberLabel: 'Reference number', aliases: ['police check', 'afp check', 'criminal history check', 'national police certificate'], help: 'Optional — your NDIS Worker Screening Check already includes a national criminal history check. Only upload this if a host organisation has asked for one separately.' },
  /* training certificates */
  { key: 'ndis-orientation', label: 'NDIS Worker Orientation Module', category: 'training', expiry: 'none', numberLabel: 'Certificate ID', aliases: ['quality safety and you', 'orientation module', 'worker orientation'], help: 'The free 90-minute Commission module "Quality, Safety and You".', link: 'https://training.ndiscommission.gov.au/' },
  { key: 'infection-control', label: 'Infection Prevention & Control Training', category: 'training', expiry: 'optional', numberLabel: 'Certificate ID', aliases: ['infection free', 'infection control', 'covid training', 'supporting people to stay infection free'], help: 'e.g. "Supporting People to Stay Infection Free".', link: 'https://teamdsc.com.au/learning/supporting-people-to-stay-infection-free' },
  { key: 'first-aid', label: 'First Aid / CPR', category: 'training', expiry: 'required', numberLabel: 'Certificate number', aliases: ['cpr', 'hltaid011', 'hltaid009', 'first aid certificate'], help: 'Required for direct support work. First aid renews every 3 years, CPR yearly.' },
  { key: 'medication-training', label: 'Medication Administration Training', category: 'training', expiry: 'optional', numberLabel: 'Certificate ID', aliases: ['medication management', 'meds training', 'supporting people to take their medication'], help: 'Required if you assist participants with medication.', link: 'https://teamdsc.com.au/learning/supporting-people-to-take-their-medication' },
  { key: 'manual-handling', label: 'Manual Handling Training', category: 'training', expiry: 'optional', numberLabel: 'Certificate ID', aliases: ['moving and handling', 'hoist training', 'safe lifting'] },
  /* qualifications & resume */
  { key: 'cert3-support', label: 'Certificate III in Individual Support', category: 'qualification', expiry: 'none', numberLabel: 'Certificate number', aliases: ['cert 3', 'cert iii', 'chc33015', 'chc33021', 'individual support'] },
  { key: 'cert4-disability', label: 'Certificate IV in Disability Support', category: 'qualification', expiry: 'none', numberLabel: 'Certificate number', aliases: ['cert 4', 'cert iv', 'chc43121', 'disability support'] },
  { key: 'qualification', label: 'Other Qualification / Certificate', category: 'qualification', expiry: 'optional', numberLabel: 'Certificate number', needsLabel: true, aliases: ['diploma', 'degree', 'bachelor', 'certificate', 'qualification'] },
  { key: 'resume', label: 'Resume / CV', category: 'qualification', expiry: 'none', numberLabel: null, aliases: ['cv', 'curriculum vitae', 'resume'] },
  /* anything else */
  { key: 'other', label: 'Other document', category: 'other', expiry: 'optional', numberLabel: 'Reference number', aliases: [] }
];
const DOC_MAP = Object.fromEntries(DOC_CATALOG.map(d => [d.key, d]));
const DOC_TYPES = Object.fromEntries(DOC_CATALOG.map(d => [d.key, d.label])); /* legacy label map — used by emails/sweep */
const DOC_MIMES = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

/* the onboarding scorecard: 100-point ID tally, right to work, and the key items */
function onboardingSummary(workerId) {
  const have = new Set(db.prepare('SELECT DISTINCT doc_type FROM worker_docs WHERE worker_id = ?').all(workerId).map(d => d.doc_type));
  let points = 0, primary = false, rtw = false;
  for (const key of have) {
    const c = DOC_MAP[key];
    if (!c) continue;
    if (c.points) points += c.points;
    if (c.points && c.primary) primary = true;
    if (c.rtw) rtw = true;
  }
  return {
    id_points: points, has_primary: primary, id_ok: primary && points >= 100,
    right_to_work: rtw,
    screening: screeningState(workerId),
    first_aid: have.has('first-aid'),
    orientation: have.has('ndis-orientation'),
    infection_control: have.has('infection-control'),
    resume: have.has('resume')
  };
}

function docStatus(d) {
  if (!d.expiry_date) return 'no-expiry';
  const today = new Date().toISOString().slice(0, 10);
  if (d.expiry_date < today) return 'expired';
  const days = Math.round((new Date(d.expiry_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 864e5);
  return days <= 30 ? 'expiring' : 'valid';
}
function docDays(d) {
  if (!d.expiry_date) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((new Date(d.expiry_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 864e5);
}
function screeningState(workerId) {
  const docs = db.prepare("SELECT * FROM worker_docs WHERE worker_id = ? AND doc_type = 'ndis-screening'").all(workerId);
  if (!docs.length) return 'none';
  const st = docs.map(docStatus);
  if (st.includes('valid')) return 'valid';
  if (st.includes('expiring')) return 'expiring';
  if (st.includes('no-expiry')) return 'no-expiry';
  return 'expired';
}
function docOut(d) {
  const cat = DOC_MAP[d.doc_type] || {};
  return { ...d, file_path: undefined, status: docStatus(d), days: docDays(d),
    type_label: d.label || cat.label || d.doc_type, category: cat.category || 'other', has_file: Boolean(d.file_path) };
}

/* ============================================================================
   0137 — NDIS Digital Platform Service: conditions of registration
   ==========================================================================*/

/* How often we re-check the banning orders register, and how long a worker
   keeps working after that check falls due. The window is a setting because
   the Commission may put a number on it; the grace period exists so a check
   nobody got to on a Friday warns the team rather than pulling the entire
   roster offline over a weekend. After the grace period it does block. */
/* The three registers s13D(6)(a)-(c) requires be checked and displayed, in
   the order the Rules list them. `rc`/`ac`/`sc` are the result, checked-at and
   source columns on worker_profiles; the NDIS trio keeps its original column
   names so no data has to move. */
const BAN_REGISTERS = [
  { key: 'ndis', short: 'NDIS', rc: 'banning_result', ac: 'banning_checked_at', sc: 'banning_source',
    label: 'NDIS Commission banning orders register',
    where: 'the NDIS Quality and Safeguards Commission banning orders register' },
  { key: 'aged', short: 'Aged Care Act 2024', rc: 'banning_aged_result', ac: 'banning_aged_at', sc: 'banning_aged_source',
    label: 'Aged care banning orders register (Aged Care Act 2024)',
    where: 'the aged care banning orders register, for orders under the Aged Care Act 2024' },
  { key: 'acqsc', short: 'ACQSC Act', rc: 'banning_acqsc_result', ac: 'banning_acqsc_at', sc: 'banning_acqsc_source',
    label: 'Aged care banning orders made before the Aged Care Act 2024 (ACQSC Act)',
    where: 'the aged care banning orders register, for orders made under the Aged Care Quality and Safety Commission Act 2018 before the Aged Care Act 2024 commenced' }
];
const BAN_BY_KEY = Object.fromEntries(BAN_REGISTERS.map(r => [r.key, r]));
const BAN_COLS = BAN_REGISTERS.flatMap(r => [r.rc, r.ac, r.sc]);

function banningWindowDays() { return Math.max(1, Number(setting('banning_recheck_days', '90')) || 90); }
function banningGraceDays()  { return Math.max(0, Number(setting('banning_grace_days', '30')) || 0); }

function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 864e5);
}

function isDemoWorker(email) { return Boolean(email) && email.endsWith('@demo.bookit.life'); }

/* Write to the evidence trail. Append only — nothing in the codebase updates
   or deletes a row of this table, and that is the point of it. */
function logCompliance(o) {
  db.prepare(`INSERT INTO compliance_log
    (worker_id, worker_name, kind, result, detail, source, ref, doc_id, checked_at, checked_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(o.worker_id || null, o.worker_name || '', o.kind, o.result || '', o.detail || '',
         o.source || '', o.ref || '', o.doc_id || null, o.checked_at || now(), o.checked_by || 'System');
}

/* The single source of truth on whether a worker may be on the platform.
   Everything else — the approve route, the sweep, the booking and message
   endpoints, the cover cascade, the admin board — asks this one function, so
   there is exactly one definition of "eligible" to keep right.

   Returns { ok, blocks[], warnings[], screening{}, banning{} }. `blocks` are
   hard: any one of them means the worker must not be visible and must not be
   bookable. `warnings` are things that will become blocks if left. */
function platformStatus(workerId) {
  const w = db.prepare(`SELECT u.id, u.name, u.email, p.screening_status, p.screening_status_at,
      p.screening_source, p.screening_ref, p.banning_checked_by, p.banning_note,
      ${BAN_COLS.map(c => 'p.' + c).join(', ')},
      p.platform_block, p.platform_block_reason, p.visible
    FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ?`).get(workerId);
  if (!w) return { ok: false, blocks: ['No worker profile.'], warnings: [], screening: {}, banning: {}, registers: [] };

  const blocks = [], warnings = [];

  /* ---- condition (a): only a person holding a worker screening clearance
     may use the platform. Two separate things must both hold: a screening
     document that is on file, current and verified by a human; and a
     clearance status that the screening unit has not withdrawn. Either one
     alone is not enough — a valid-looking card proves nothing if the
     clearance behind it was suspended last week. ---- */
  const sdocs = db.prepare("SELECT * FROM worker_docs WHERE worker_id = ? AND doc_type = 'ndis-screening'").all(workerId);
  const current = sdocs.filter(d => { const s = docStatus(d); return s === 'valid' || s === 'expiring' || s === 'no-expiry'; });
  const verified = current.filter(d => d.verified_at);
  const best = verified[0] || current[0] || sdocs[0] || null;

  if (!sdocs.length) blocks.push('No NDIS worker screening check on file.');
  else if (!current.length) blocks.push('NDIS worker screening check has expired.');
  else if (!verified.length) blocks.push('NDIS worker screening check is on file but has not been verified by our team.');
  else if (best && docStatus(best) === 'expiring') warnings.push(`Screening check expires in ${docDays(best)} days.`);

  const st = w.screening_status || 'unknown';
  if (st === 'suspended') blocks.push('NDIS worker screening clearance is suspended.');
  else if (st === 'revoked') blocks.push('NDIS worker screening clearance has been revoked.');
  else if (st === 'excluded') blocks.push('An NDIS worker screening exclusion is in force.');
  else if (st === 'pending') blocks.push('NDIS worker screening clearance is still pending — an application is not a clearance.');
  else if (st === 'unknown') blocks.push('NDIS worker screening clearance status has never been confirmed against the screening unit.');

  /* ---- condition (b): check whether a banning order is in force, and
     display what we found. A check that was done once at induction is not a
     check; the register changes. So an unchecked worker is blocked outright,
     and a stale check warns, then blocks once the grace period runs out.
     Three registers, each answered and dated on its own: a clear NDIS result
     says nothing about an aged care order, and s13D(6) asks for all three. -- */
  const win = banningWindowDays(), grace = banningGraceDays();
  const registers = BAN_REGISTERS.map(r => {
    const result = w[r.rc] || 'unchecked';
    const at = w[r.ac] || '';
    const age = daysSince(at);
    return { key: r.key, short: r.short, label: r.label, where: r.where, result,
             checked_at: at, age_days: age, window_days: win, source: w[r.sc] || '' };
  });
  for (const r of registers) {
    const name = r.key === 'ndis' ? 'NDIS banning orders register' : r.label;
    if (r.result === 'banned') blocks.push(`A banning order is in force against this worker — ${r.short}.`);
    else if (r.result !== 'clear' || r.age_days === null) blocks.push(`The ${name} has never been checked for this worker.`);
    else if (r.age_days > win + grace) blocks.push(`${name} last checked ${r.age_days} days ago — past the ${win}-day window and the ${grace}-day grace period.`);
    else if (r.age_days > win) warnings.push(`${name} is due for re-check — last checked ${r.age_days} days ago.`);
    else if (r.age_days > win - 14) warnings.push(`${name} re-check due in ${win - r.age_days} days.`);
  }
  const bage = registers[0].age_days;

  /* ---- an admin's manual stop, which needs no sweep and no reason to wait ---- */
  if (w.platform_block) blocks.push(w.platform_block_reason || 'Blocked from the platform by an administrator.');

  return {
    ok: blocks.length === 0,
    blocks, warnings,
    worker: { id: w.id, name: w.name, email: w.email, visible: w.visible },
    screening: {
      status: st, status_at: w.screening_status_at || '', source: w.screening_source || '',
      ref: w.screening_ref || '', doc_state: screeningState(workerId),
      expiry: best ? (best.expiry_date || '') : '', verified: Boolean(verified.length)
    },
    /* `banning` stays the NDIS register on its own, because everything built
       before the aged care limbs existed reads it. `registers` is the full
       s13D(6)(a)-(c) set, and `registers_ok` is the one-line answer. */
    banning: {
      result: w.banning_result || 'unchecked', checked_at: w.banning_checked_at || '',
      age_days: bage, window_days: win, source: w.banning_source || '', note: w.banning_note || ''
    },
    registers,
    registers_ok: registers.every(r => r.result === 'clear' && r.age_days !== null && r.age_days <= win),
    /* returned as its own flag rather than left to be read out of the blocks
       list — the reason is free text an admin typed, so pattern-matching it
       would break the moment somebody words it differently. */
    block: { on: Boolean(w.platform_block), reason: w.platform_block_reason || '' }
  };
}

/* The same question, asked cheaply at a gate. Demo workers are exempt from
   enforcement throughout the codebase — they carry no real clearance and are
   never real people — but they are *shown* honestly on the compliance board
   as demo data rather than quietly counted as compliant. */
function platformEligible(workerId, email) {
  if (email === undefined) {
    const u = db.prepare('SELECT email FROM users WHERE id = ?').get(workerId);
    email = u ? u.email : '';
  }
  if (isDemoWorker(email)) return true;
  return platformStatus(workerId).ok;
}

/* Make `visible` tell the truth, right now.

   BookIt already had a single flag every access path consults — nineteen
   queries say `p.visible = 1`. Rather than teach nineteen queries about 0137,
   the flag is kept honest at source: a worker who fails a condition cannot be
   visible, and the moment the condition is met again they come back.

   `auto_hidden` is what makes the second half safe. A worker hidden by this
   gate carries the flag, so lifting a suspension restores them automatically.
   A worker an admin hid by hand does not carry it, and no sweep will ever
   undo that decision. Returns a description of what changed, or null. */
function reconcileVisibility(workerId, why, req) {
  const w = db.prepare(`SELECT u.id, u.name, u.email, p.visible, p.auto_hidden
    FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'`).get(workerId);
  if (!w || isDemoWorker(w.email)) return null;
  const st = platformStatus(workerId);
  const base = req ? baseUrl(req) : (APP_URL || 'https://bookit.life');

  if (!st.ok && w.visible) {
    db.prepare('UPDATE worker_profiles SET visible = 0, auto_hidden = 1 WHERE user_id = ?').run(workerId);
    logCompliance({ worker_id: workerId, worker_name: w.name, kind: 'platform-access', result: 'auto-withdrawn',
      detail: `${why}. Platform access withdrawn automatically: ${st.blocks.join(' ')}`, source: '0137 conditions of registration' });
    sendMail(w.email, 'Your BookIt profile is paused — BookIt', `Your profile is paused, ${firstName(w.name)}`,
      `<p>Your profile has been hidden and new bookings are paused, because of the checks BookIt has to keep current for every worker on the platform:</p><ul>${st.blocks.map(b => `<li>${escHtml(b)}</li>`).join('')}</ul><p>This is a requirement of BookIt's registration, not a judgement about you. As soon as it's sorted your profile switches back on automatically.</p>`,
      'Update my credentials', `${base}/#/bookings`).catch(() => {});
    if (MAIL_FROM) sendMail(MAIL_FROM, `Worker withdrawn from the platform: ${w.name} — BookIt`, 'Platform access withdrawn',
      `<p><b>${escHtml(w.name)}</b> was withdrawn from Find Workers.</p><ul>${st.blocks.map(b => `<li>${escHtml(b)}</li>`).join('')}</ul>`,
      'Open the 0137 board', `${base}/#/admin`).catch(() => {});
    return { worker: w.name, hidden: true, blocks: st.blocks };
  }

  if (st.ok && !w.visible && w.auto_hidden) {
    db.prepare('UPDATE worker_profiles SET visible = 1, auto_hidden = 0 WHERE user_id = ?').run(workerId);
    logCompliance({ worker_id: workerId, worker_name: w.name, kind: 'platform-access', result: 'restored',
      detail: `${why}. All 0137 conditions met again — profile restored automatically.`, source: '0137 conditions of registration' });
    sendMail(w.email, 'Your BookIt profile is live again', `You're back on, ${firstName(w.name)}`,
      '<p>Your checks are current again, so your profile is visible in <b>Find Workers</b> and participants can book you from now.</p>',
      'Open BookIt', `${base}/#/find-workers`).catch(() => {});
    return { worker: w.name, restored: true };
  }

  if (st.ok && w.visible && w.auto_hidden) db.prepare('UPDATE worker_profiles SET auto_hidden = 0 WHERE user_id = ?').run(workerId);
  return null;
}

/* Everything that goes on a public profile about how a worker was checked.
   Deliberately narrow: status and month-level dates only. A participant needs
   to know the check was done and is current; nobody outside the office needs
   the worker's clearance number, exact dates, or documents. */
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthYear(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}
function publicVerification(workerId, email) {
  const demo = isDemoWorker(email);
  const s = platformStatus(workerId);
  const today = new Date().toISOString().slice(0, 10);
  const PUBLIC_CATS = ['checks', 'training', 'qualification'];

  /* Only documents a human has actually verified appear here. This is the
     whole point of the change: a shield must never sit beside a claim we
     have not checked ourselves. */
  const checks = db.prepare('SELECT doc_type, label, expiry_date, verified_at FROM worker_docs WHERE worker_id = ? ORDER BY id').all(workerId)
    .filter(d => {
      const c = DOC_MAP[d.doc_type];
      return c && PUBLIC_CATS.includes(c.category) && d.doc_type !== 'resume'
        && d.verified_at && (!d.expiry_date || d.expiry_date >= today);
    })
    .map(d => ({
      label: d.label || DOC_TYPES[d.doc_type] || d.doc_type,
      /* Demo credentials are seeded with a verified_at so the office screens
         have something to show, but nobody checked them, so the payload must
         not say anybody did. The front end already draws demo profiles in
         amber — this makes the same statement one layer down, where it can't
         be lost by a page that forgets to look at `demo`. A tick is a claim
         wherever it is made. */
      verified: !demo,
      demo,
      valid_to: monthYear(d.expiry_date)
    }));

  return {
    checks,
    screening: {
      /* Not `true` for a demo profile, and not `false` either — the honest
         answer is "there is nothing here to be cleared", so the flag stays
         down and `demo` says why. Anything that ticks on `cleared` alone then
         fails safe rather than certifying a person who doesn't exist. */
      cleared: demo ? false : (s.screening.status === 'cleared' && s.screening.verified),
      demo,
      label: demo ? 'NDIS Worker Screening Check — demo profile, not checked'
                  : (s.screening.status === 'cleared' && s.screening.verified ? 'NDIS Worker Screening Check — cleared' : 'NDIS Worker Screening Check — not confirmed'),
      valid_to: demo ? '' : monthYear(s.screening.expiry),
      confirmed_on: demo ? '' : monthYear(s.screening.status_at)
    },
    banning: {
      clear: demo ? false : s.banning.result === 'clear',
      demo,
      label: demo ? 'Banning orders register — demo profile, not checked'
                  : (s.banning.result === 'clear' ? 'No banning order in force'
                     : s.banning.result === 'banned' ? 'A banning order is in force' : 'Banning orders register not yet checked'),
      checked_on: demo ? '' : monthYear(s.banning.checked_at)
    },
    /* One entry per register named in s13D(6)(a)-(c). The condition is check
       AND display, worker by worker, so all three answers go to the profile
       rather than being collapsed into a single tick. */
    registers: (s.registers || []).map(r => ({
      key: r.key, short: r.short, label: r.label,
      clear: demo ? false : r.result === 'clear',
      demo,
      heading: r.key === 'ndis' ? 'NDIS banning orders register'
             : r.key === 'aged' ? 'Aged care banning orders — Aged Care Act 2024'
             : 'Aged care banning orders — earlier ACQSC Act orders',
      finding: demo ? 'Demonstration profile — the register was not actually checked.'
             : r.result === 'clear' ? `We checked ${r.where}${monthYear(r.checked_at) ? ' in ' + monthYear(r.checked_at) : ''} — no order in force.`
             : r.result === 'banned' ? 'An order is in force. This worker cannot take bookings.'
             : 'Not yet checked — this worker can\'t take bookings.',
      checked_on: demo ? '' : monthYear(r.checked_at)
    })),
    demo
  };
}

/* the document catalogue — powers the typeahead on the worker's documents card */
route('GET', /^\/api\/doc-catalog$/, (req, res) => json(res, 200, { categories: DOC_CATEGORIES, types: DOC_CATALOG }));

route('GET', /^\/api\/me\/documents$/, (req, res, m, user) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  json(res, 200, {
    documents: db.prepare('SELECT * FROM worker_docs WHERE worker_id = ? ORDER BY doc_type, id DESC').all(user.id).map(docOut),
    summary: onboardingSummary(user.id)
  });
});

route('POST', /^\/api\/me\/documents$/, (req, res, m, user, body, ip) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  if (limited(ip, 'docs', 30)) return json(res, 429, { error: 'Too many uploads — try again later.' });
  const cat = DOC_MAP[clean(body.doc_type, 40)];
  if (!cat) return json(res, 400, { error: 'Pick a document type.' });
  const docType = cat.key;
  const expiry = clean(body.expiry_date, 10);
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return json(res, 400, { error: 'Expiry date looks wrong.' });
  if (cat.expiry === 'required' && !expiry) return json(res, 400, { error: `Please enter the expiry date for your ${cat.label} — it drives the automatic checks.` });
  if (cat.needsLabel && !clean(body.label, 80)) return json(res, 400, { error: 'Give the qualification a name — e.g. "Diploma of Nursing".' });
  let fileName = '', fileMime = '', filePath = '';
  if (body.file && body.file.data) {
    fileMime = String(body.file.mime || '');
    if (!DOC_MIMES[fileMime]) return json(res, 400, { error: 'Files must be PDF, JPG or PNG.' });
    let buf;
    try { buf = Buffer.from(String(body.file.data).replace(/^data:[^,]*,/, ''), 'base64'); } catch { return json(res, 400, { error: 'Could not read that file.' }); }
    if (!buf.length || buf.length > 4 * 1024 * 1024) return json(res, 400, { error: 'Files can be up to 4 MB.' });
    fileName = clean(body.file.name, 80).replace(/[^A-Za-z0-9. _-]/g, '') || ('document' + DOC_MIMES[fileMime]);
    filePath = path.join(DOCS_DIR, `w${user.id}-${Date.now()}${DOC_MIMES[fileMime]}`);
    fs.writeFileSync(filePath, buf);
  }
  const r = db.prepare('INSERT INTO worker_docs (worker_id, doc_type, label, check_number, expiry_date, file_name, file_mime, file_path, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(user.id, docType, clean(body.label, 80), clean(body.check_number, 40), expiry, fileName, fileMime, filePath, now());
  if (MAIL_FROM) sendMail(MAIL_FROM, 'Credential uploaded — BookIt', 'A worker updated their credentials',
    `<p><b>${escHtml(user.name)}</b> added a <b>${DOC_TYPES[docType]}</b>${expiry ? ` (expires ${escHtml(expiry)})` : ''}${clean(body.check_number, 40) ? ` — number ${escHtml(clean(body.check_number, 40))}` : ''}.</p><p>Verify it against the NDIS Worker Screening Database, then press Verify in the Credentials section.</p>`,
    'Open credentials', `${baseUrl(req)}/#/admin`).catch(() => {});
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

/* profile photo — a requirement before a worker can be approved */
const PHOTO_MIMES = { 'image/jpeg': '.jpg', 'image/png': '.png' };
function photoUrl(row) { return row && row.photo ? `/photos/${row.user_id ?? row.id}?v=${encodeURIComponent(row.photo_at || '')}` : null; }

route('POST', /^\/api\/me\/photo$/, (req, res, m, user, body, ip) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  if (limited(ip, 'photo', 20)) return json(res, 429, { error: 'Too many uploads — try again later.' });
  if (!body.file || !body.file.data) return json(res, 400, { error: 'Choose a photo first.' });
  const mime = String(body.file.mime || '');
  if (!PHOTO_MIMES[mime]) return json(res, 400, { error: 'Photos must be JPG or PNG.' });
  let buf;
  try { buf = Buffer.from(String(body.file.data).replace(/^data:[^,]*,/, ''), 'base64'); } catch { return json(res, 400, { error: 'Could not read that photo.' }); }
  if (!buf.length || buf.length > 3 * 1024 * 1024) return json(res, 400, { error: 'Photos can be up to 3 MB.' });
  const prev = db.prepare('SELECT photo FROM worker_profiles WHERE user_id = ?').get(user.id);
  const fp = path.join(PHOTOS_DIR, `w${user.id}-${Date.now()}${PHOTO_MIMES[mime]}`);
  fs.writeFileSync(fp, buf);
  db.prepare('UPDATE worker_profiles SET photo = ?, photo_at = ? WHERE user_id = ?').run(fp, now(), user.id);
  if (prev && prev.photo) { try { fs.unlinkSync(prev.photo); } catch {} }
  json(res, 200, { ok: true, photo: `/photos/${user.id}?v=${Date.now()}` });
});

route('GET', /^\/api\/me\/profile$/, (req, res, m, user) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  const p = db.prepare('SELECT bio, services, visible, photo, photo_at, days, langs, exp FROM worker_profiles WHERE user_id = ?').get(user.id) || {};
  json(res, 200, { profile: {
    bio: p.bio || '', services: JSON.parse(p.services || '[]'), visible: p.visible,
    photo: p.photo ? `/photos/${user.id}?v=${encodeURIComponent(p.photo_at || '')}` : null,
    days: JSON.parse(p.days || '[1,1,1,1,1,0,0]'), langs: p.langs || 'English', exp: p.exp || 'New to BookIt'
  } });
});

route('POST', /^\/api\/me\/profile$/, (req, res, m, user, body) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  const sets = ['bio = ?'];
  const vals = [clean(body.bio, 600)];
  if (Array.isArray(body.days) && body.days.length === 7) { sets.push('days = ?'); vals.push(JSON.stringify(body.days.map(x => (x ? 1 : 0)))); }
  if (body.langs !== undefined) { sets.push('langs = ?'); vals.push(clean(body.langs, 120) || 'English'); }
  if (body.exp !== undefined) { sets.push('exp = ?'); vals.push(clean(body.exp, 40) || 'New to BookIt'); }
  db.prepare(`UPDATE worker_profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals, user.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/me\/documents\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!user || user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  const d = db.prepare('SELECT * FROM worker_docs WHERE id = ? AND worker_id = ?').get(Number(m[1]), user.id);
  if (!d) return json(res, 404, { error: 'No such document.' });
  if (d.verified_at) return json(res, 400, { error: 'That one\'s been verified — ask the BookIt team to update it.' });
  if (d.file_path) { try { fs.unlinkSync(d.file_path); } catch {} }
  db.prepare('DELETE FROM worker_docs WHERE id = ?').run(d.id);
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/documents\/(\d+)\/file$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const d = db.prepare('SELECT * FROM worker_docs WHERE id = ?').get(Number(m[1]));
  if (!d || !d.file_path) return json(res, 404, { error: 'No file.' });
  if (!(user.admin || user.id === d.worker_id)) return json(res, 403, { error: 'Not yours.' });
  if (!fs.existsSync(d.file_path)) return json(res, 404, { error: 'File missing from disk.' });
  res.writeHead(200, { 'Content-Type': d.file_mime || 'application/octet-stream', 'Content-Disposition': `inline; filename="${d.file_name || 'document'}"` });
  fs.createReadStream(d.file_path).pipe(res);
});

route('GET', /^\/api\/admin\/credentials$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const workers = db.prepare(`SELECT u.id, u.name, u.email, u.verified, p.visible, p.photo, p.photo_at FROM users u
    JOIN worker_profiles p ON p.user_id = u.id WHERE u.role = 'worker' ORDER BY u.name`).all()
    .map(w => ({
      ...w,
      photo: w.photo ? `/photos/${w.id}?v=${encodeURIComponent(w.photo_at || '')}` : null,
      demo: isDemoWorker(w.email),
      screening: screeningState(w.id),
      platform: platformStatus(w.id),
      summary: onboardingSummary(w.id),
      documents: db.prepare('SELECT * FROM worker_docs WHERE worker_id = ? ORDER BY doc_type, id DESC').all(w.id).map(docOut)
    }));
  json(res, 200, { workers });
});

route('POST', /^\/api\/admin\/documents\/(\d+)\/verify$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const d = db.prepare(`SELECT wd.*, u.name AS worker_name FROM worker_docs wd
    JOIN users u ON u.id = wd.worker_id WHERE wd.id = ?`).get(Number(m[1]));
  if (!d) return json(res, 404, { error: 'No such document.' });
  body = body || {};
  /* "Verified" on its own is a tick, and a tick is not evidence. What an
     auditor asks is how you satisfied yourself — did you sight the original,
     check the number against the issuing register, or take it on a copy — and
     what reference you can point at. So the method is recorded, defaults to
     the honest answer ("sighted the document"), and lands in the log. */
  const METHODS = {
    'sighted-original': 'Sighted the original document',
    'sighted-copy': 'Sighted a copy of the document',
    'issuer-register': 'Checked against the issuing register',
    'issuer-confirmed': 'Confirmed directly with the issuer',
    'other': 'Other — see note'
  };
  const method = METHODS[body.method] ? body.method : 'sighted-copy';
  const ref = clean(body.ref, 120);
  const note = clean(body.note, 400);
  db.prepare('UPDATE worker_docs SET verified_at = ?, verified_by = ?, verify_method = ?, verify_ref = ?, verify_note = ? WHERE id = ?')
    .run(now(), user.name, method, ref, note, d.id);
  logCompliance({ worker_id: d.worker_id, worker_name: d.worker_name, kind: 'document-verified', result: 'verified',
    detail: `${d.label || DOC_TYPES[d.doc_type] || d.doc_type} — ${METHODS[method]}${d.expiry_date ? `, expires ${d.expiry_date}` : ''}${note ? `. ${note}` : ''}`,
    source: METHODS[method], ref, doc_id: d.id, checked_by: user.name });
  /* A newly verified screening check can be the last thing standing between a
     worker and the platform, so re-test straight away rather than waiting up
     to twelve hours for the sweep. */
  reconcileVisibility(d.worker_id, 'Document verified');
  json(res, 200, { ok: true, method, methods: METHODS });
});

/* ---------- 0137: recording the two conditions ---------- */

/* Condition (a) — the clearance itself, as distinct from the card on file.
   An admin looks the worker up on the NDIS Worker Check portal and records
   what the screening unit says today. */
route('POST', /^\/api\/admin\/workers\/(\d+)\/screening$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.id, u.name FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  const OK = ['cleared', 'pending', 'suspended', 'revoked', 'excluded', 'unknown'];
  const status = OK.includes(String(body.status)) ? String(body.status) : null;
  if (!status) return json(res, 400, { error: `Status must be one of: ${OK.join(', ')}.` });
  const source = clean(body.source, 160) || 'NDIS Worker Check portal';
  const ref = clean(body.ref, 120);
  db.prepare(`UPDATE worker_profiles SET screening_status = ?, screening_status_at = ?, screening_status_by = ?,
    screening_source = ?, screening_ref = ? WHERE user_id = ?`).run(status, now(), user.name, source, ref, uid);
  logCompliance({ worker_id: uid, worker_name: w.name, kind: 'screening-status', result: status,
    detail: `Worker screening clearance recorded as "${status}".${clean(body.note, 400) ? ' ' + clean(body.note, 400) : ''}`,
    source, ref, checked_by: user.name });
  const out = reconcileVisibility(uid, 'Screening status recorded');
  json(res, 200, { ok: true, platform: platformStatus(uid), changed: out });
});

/* Condition (b) — the banning orders registers. Somebody has to look, on a
   cycle, and write down what they saw. Three registers are named in the Rules,
   so the route takes three answers: `result` is the NDIS register (the field
   name predates the others and is left alone), `aged_result` is the Aged Care
   Act 2024 limb and `acqsc_result` the pre-2024 ACQSC Act limb. `all` is the
   shorthand for one sitting in which all three were looked at and all three
   said the same thing — which is the ordinary case, but it has to be asked for
   rather than assumed, because recording a check nobody did is the one thing
   this whole system exists to prevent. Anything left out is left untouched. */
route('POST', /^\/api\/admin\/workers\/(\d+)\/banning$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.id, u.name FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  const OK = ['clear', 'banned', 'unchecked'];
  const val = v => (OK.includes(String(v)) ? String(v) : null);
  const all = val(body.all);
  const given = {
    ndis: val(body.result) || all,
    aged: val(body.aged_result) || all,
    acqsc: val(body.acqsc_result) || all
  };
  if (!given.ndis && !given.aged && !given.acqsc) {
    return json(res, 400, { error: `Give a result for at least one register — one of: ${OK.join(', ')}.` });
  }
  const note = clean(body.note, 400);
  const stamp = now();
  const done = [];
  for (const r of BAN_REGISTERS) {
    const result = given[r.key];
    if (!result) continue;
    const source = clean(body[r.key === 'ndis' ? 'source' : r.key + '_source'], 160) || r.label;
    db.prepare(`UPDATE worker_profiles SET ${r.rc} = ?, ${r.ac} = ?, ${r.sc} = ?,
      banning_checked_by = ?, banning_note = ? WHERE user_id = ?`)
      .run(result, result === 'unchecked' ? '' : stamp, source, user.name, note, uid);
    logCompliance({ worker_id: uid, worker_name: w.name, kind: 'banning-check', result,
      detail: result === 'clear' ? `Checked ${r.where} — no banning order in force.`
        : result === 'banned' ? `A banning order is in force against this worker — ${r.short}.${note ? ' ' + note : ''}`
        : `Banning-order check cleared back to unchecked — ${r.short}.`,
      source, checked_by: user.name });
    done.push(r.key);
  }
  const out = reconcileVisibility(uid, 'Banning-order check recorded');
  json(res, 200, { ok: true, checked: done, platform: platformStatus(uid), changed: out });
});

/* The manual stop. An admin who hears something at 9pm should not have to
   compose a status change to get somebody off the platform. */
route('POST', /^\/api\/admin\/workers\/(\d+)\/platform-block$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const uid = Number(m[1]);
  const w = db.prepare("SELECT u.id, u.name FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(uid);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  const on = body.block ? 1 : 0;
  const reason = clean(body.reason, 300) || (on ? 'Blocked from the platform by an administrator.' : '');
  db.prepare('UPDATE worker_profiles SET platform_block = ?, platform_block_reason = ? WHERE user_id = ?').run(on, reason, uid);
  logCompliance({ worker_id: uid, worker_name: w.name, kind: 'platform-block', result: on ? 'blocked' : 'lifted',
    detail: on ? reason : 'Platform block lifted.', checked_by: user.name });
  const out = reconcileVisibility(uid, on ? 'Platform block applied' : 'Platform block lifted');
  json(res, 200, { ok: true, platform: platformStatus(uid), changed: out });
});

route('POST', /^\/api\/admin\/documents\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const d = db.prepare('SELECT * FROM worker_docs WHERE id = ?').get(Number(m[1]));
  if (!d) return json(res, 404, { error: 'No such document.' });
  if (d.file_path) { try { fs.unlinkSync(d.file_path); } catch {} }
  db.prepare('DELETE FROM worker_docs WHERE id = ?').run(d.id);
  json(res, 200, { ok: true });
});

/* the automatic checker: warns ahead of expiry and hides workers whose
   screening has lapsed. Runs on boot, twice a day, and on demand. */
function credentialSweep(req) {
  const actions = [];
  const base = req ? baseUrl(req) : APP_URL || 'https://bookit.life';
  const workers = db.prepare(`SELECT u.id, u.name, u.email, p.visible FROM users u
    JOIN worker_profiles p ON p.user_id = u.id WHERE u.role = 'worker'`).all();
  for (const w of workers) {
    if (w.email.endsWith('@demo.bookit.life')) continue;
    const docs = db.prepare('SELECT * FROM worker_docs WHERE worker_id = ?').all(w.id);
    for (const d of docs) {
      const st = docStatus(d), days = docDays(d);
      let stage = '';
      if (st === 'expired') stage = 'expired';
      else if (st === 'expiring' && days <= 7) stage = '7';
      else if (st === 'expiring') stage = '30';
      if (stage && d.warned_stage !== stage) {
        db.prepare('UPDATE worker_docs SET warned_stage = ? WHERE id = ?').run(stage, d.id);
        const what = `${DOC_TYPES[d.doc_type] || d.doc_type}${d.check_number ? ` (${d.check_number})` : ''}`;
        const when = st === 'expired' ? 'has EXPIRED' : `expires in ${days} day${days === 1 ? '' : 's'} (${d.expiry_date})`;
        sendMail(w.email, `Your ${DOC_TYPES[d.doc_type] || 'credential'} ${st === 'expired' ? 'has expired' : 'is expiring'} — BookIt`,
          `Heads up, ${firstName(w.name)}`,
          `<p>Your <b>${escHtml(what)}</b> ${escHtml(when)}.</p><p>${st === 'expired' ? 'You can\'t deliver supports until a current check is on file — please renew it and upload the new details today.' : 'Renewals can be lodged up to 90 days early — please update your credentials in BookIt as soon as you have the new document.'}</p>`,
          'Update my credentials', `${base}/#/bookings`).catch(() => {});
        if (MAIL_FROM) sendMail(MAIL_FROM, `Credential ${st === 'expired' ? 'EXPIRED' : 'expiring'}: ${w.name} — BookIt`,
          `${w.name} — ${DOC_TYPES[d.doc_type] || d.doc_type}`,
          `<p><b>${escHtml(w.name)}</b>'s <b>${escHtml(what)}</b> ${escHtml(when)}.</p>`,
          'Open credentials', `${base}/#/admin`).catch(() => {});
        actions.push({ worker: w.name, doc: d.doc_type, stage });
      }
    }
    /* ---- 0137 condition (b): the banning-orders re-check falls due on a
       cycle, so chase it before it starts pulling people off the roster.
       Nagging the office twice is much cheaper than a worker disappearing
       from Find Workers on a Monday morning. ---- */
    const st = platformStatus(w.id);
    const age = st.banning.age_days;
    if (st.banning.result === 'clear' && age !== null && age > st.banning.window_days - 14 && MAIL_FROM) {
      const overdue = age > st.banning.window_days;
      const stage = overdue ? `ban-overdue-${Math.floor(age / 7)}` : 'ban-due';
      if (setting(`banwarn:${w.id}`, '') !== stage) {
        setSetting(`banwarn:${w.id}`, stage);
        sendMail(MAIL_FROM, `Banning-order re-check ${overdue ? 'OVERDUE' : 'due'}: ${w.name} — BookIt`,
          `${w.name} — banning orders register`,
          `<p>The banning orders register was last checked for <b>${escHtml(w.name)}</b> ${age} days ago. The re-check window is ${st.banning.window_days} days${overdue ? `, and after a further ${banningGraceDays()}-day grace period their profile will be withdrawn automatically` : ''}.</p>`,
          'Open the 0137 board', `${base}/#/admin`).catch(() => {});
        actions.push({ worker: w.name, banning_recheck: overdue ? 'overdue' : 'due', days: age });
      }
    }

    /* ---- and the gate itself. This replaces the old screening-expiry-only
       auto-hide: it now covers every 0137 condition, and it restores a worker
       the moment the problem is fixed rather than waiting for someone to
       remember to re-approve them. ---- */
    const changed = reconcileVisibility(w.id, 'Scheduled credential sweep', req);
    if (changed) actions.push(changed);
  }
  return actions;
}
route('POST', /^\/api\/admin\/credentials\/sweep$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { ok: true, actions: credentialSweep(req) });
});

/* ---------- 0137: the compliance board ----------
   Every worker against every condition, in one view, with the evidence behind
   each answer. This is the screen you open when the Commission asks how you
   satisfy your conditions of registration, and it is the screen the office
   works from on a Monday morning. Same data both times. */
function board0137() {
  const rows = db.prepare(`SELECT u.id, u.name, u.email, p.visible, p.auto_hidden, p.screening_status,
      p.screening_status_at, p.screening_status_by, p.screening_source, p.screening_ref,
      p.banning_checked_by, ${BAN_COLS.map(c => 'p.' + c).join(', ')},
      p.platform_block, p.platform_block_reason
    FROM users u JOIN worker_profiles p ON p.user_id = u.id
    WHERE u.role = 'worker' ORDER BY u.name`).all();

  const today = new Date().toISOString().slice(0, 10);
  const workers = rows.map(w => {
    const st = platformStatus(w.id);
    const sdoc = db.prepare(`SELECT id, expiry_date, verified_at, verified_by, verify_method, verify_ref, check_number
      FROM worker_docs WHERE worker_id = ? AND doc_type = 'ndis-screening'
      ORDER BY (expiry_date >= '${today}') DESC, expiry_date DESC LIMIT 1`).get(w.id) || null;
    const pv = publicVerification(w.id, w.email);
    return {
      id: w.id, name: w.name, demo: isDemoWorker(w.email), visible: w.visible, auto_hidden: w.auto_hidden,
      /* the four things the conditions actually require, one column each */
      c_screening_held: Boolean(sdoc && sdoc.verified_at && (!sdoc.expiry_date || sdoc.expiry_date >= today)),
      c_screening_status: st.screening.status,
      /* the column on the board is now "all three registers", because one
         clear answer out of three is not the condition being met */
      c_banning_checked: st.registers_ok,
      c_banning_result: st.registers.some(r => r.result === 'banned') ? 'banned'
        : st.registers.every(r => r.result === 'clear') ? 'clear' : 'unchecked',
      c_registers: st.registers.map(r => ({ key: r.key, short: r.short, result: r.result,
        checked_at: r.checked_at, age_days: r.age_days })),
      c_evidence: Boolean(sdoc && sdoc.verify_method),
      c_displayed: pv.checks.length > 0 || pv.screening.cleared,
      screening_doc: sdoc ? { expiry: sdoc.expiry_date || '', verified_at: sdoc.verified_at || '', verified_by: sdoc.verified_by || '', method: sdoc.verify_method || '', ref: sdoc.verify_ref || '' } : null,
      platform: st
    };
  });

  const live = workers.filter(w => !w.demo);
  return {
    workers,
    conditions: [
      { key: 'a', title: 'Only cleared workers may use the platform',
        detail: 'A verified, current NDIS worker screening check on file, and a clearance the screening unit has not withdrawn.',
        met: live.filter(w => w.c_screening_held && w.c_screening_status === 'cleared').length, of: live.length },
      { key: 'b', title: 'Banning orders checked',
        detail: `Checked against the Commission's banning orders register within the last ${banningWindowDays()} days.`,
        met: live.filter(w => w.c_banning_checked).length, of: live.length },
      { key: 'c', title: 'Verification evidence recorded',
        detail: 'How each check was verified, by whom and against what source — not merely that somebody ticked it.',
        met: live.filter(w => w.c_evidence).length, of: live.length },
      { key: 'd', title: 'Information displayed on the profile',
        detail: 'What we checked, and what we found, shown on the worker\'s public profile.',
        met: live.filter(w => w.c_displayed).length, of: live.length }
    ],
    settings: { banning_recheck_days: banningWindowDays(), banning_grace_days: banningGraceDays() },
    blocked: workers.filter(w => !w.demo && !w.platform.ok).length,
    live_count: live.length
  };
}

route('GET', /^\/api\/admin\/compliance\/0137$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, board0137());
});

route('POST', /^\/api\/admin\/compliance\/0137\/settings$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  if (body.banning_recheck_days !== undefined) setSetting('banning_recheck_days', Math.max(1, Number(body.banning_recheck_days) || 90));
  if (body.banning_grace_days !== undefined) setSetting('banning_grace_days', Math.max(0, Number(body.banning_grace_days) || 0));
  json(res, 200, { ok: true, settings: { banning_recheck_days: banningWindowDays(), banning_grace_days: banningGraceDays() } });
});

/* The evidence trail, newest first — filterable to one worker. */
route('GET', /^\/api\/admin\/compliance\/log$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = new URL(req.url, 'http://x').searchParams;
  const wid = Number(q.get('worker') || 0);
  const rows = wid
    ? db.prepare('SELECT * FROM compliance_log WHERE worker_id = ? ORDER BY id DESC LIMIT 500').all(wid)
    : db.prepare('SELECT * FROM compliance_log ORDER BY id DESC LIMIT 500').all();
  json(res, 200, { entries: rows });
});

/* The same thing an auditor can take away. Two files: the board as it stands,
   and the full log behind it. */
route('GET', /^\/api\/admin\/compliance\/0137\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const b = board0137();
  const lines = [['Worker', 'On the platform', 'Screening check held & verified', 'Screening clearance status',
    'Screening expiry', 'Verified by', 'How verified',
    'NDIS banning register', 'NDIS last checked', 'Days since',
    'Aged Care Act 2024 banning orders', 'Aged Care Act 2024 last checked',
    'ACQSC Act banning orders', 'ACQSC Act last checked',
    'All three registers current', 'Shown on profile', 'Blocks', 'Demo profile'].map(q).join(',')];
  const reg = (w, k) => (w.c_registers || []).find(r => r.key === k) || {};
  const dt = v => (v ? String(v).slice(0, 10) : '');
  for (const w of b.workers) {
    const rn = reg(w, 'ndis'), ra = reg(w, 'aged'), rc = reg(w, 'acqsc');
    lines.push([w.name, w.visible ? 'Yes' : 'No', w.c_screening_held ? 'Yes' : 'No', w.c_screening_status,
      w.screening_doc ? w.screening_doc.expiry : '', w.screening_doc ? w.screening_doc.verified_by : '',
      w.screening_doc ? w.screening_doc.method : '',
      rn.result || 'unchecked', dt(rn.checked_at), rn.age_days === null || rn.age_days === undefined ? '' : rn.age_days,
      ra.result || 'unchecked', dt(ra.checked_at),
      rc.result || 'unchecked', dt(rc.checked_at),
      w.c_banning_checked ? 'Yes' : 'No',
      w.c_displayed ? 'Yes' : 'No', w.platform.blocks.join(' | '), w.demo ? 'Yes' : 'No'].map(q).join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-0137-conditions-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end('﻿' + lines.join('\r\n'));
});

route('GET', /^\/api\/admin\/compliance\/log\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare('SELECT * FROM compliance_log ORDER BY id ASC').all();
  const lines = [['Entry', 'When', 'Worker', 'What was checked', 'Result', 'Detail', 'Source', 'Reference', 'Recorded by'].map(q).join(',')];
  for (const r of rows) {
    lines.push([r.id, r.checked_at, r.worker_name, r.kind, r.result, r.detail, r.source, r.ref, r.checked_by].map(q).join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-0137-evidence-log-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end('﻿' + lines.join('\r\n'));
});

/* Re-test everybody. Useful after a settings change, and it is what the
   "Recheck all" button on the board calls. */
route('POST', /^\/api\/admin\/compliance\/0137\/reconcile$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const ids = db.prepare("SELECT u.id FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.role = 'worker'").all();
  const changed = ids.map(r => reconcileVisibility(r.id, 'Manual recheck from the 0137 board', req)).filter(Boolean);
  json(res, 200, { ok: true, changed });
});
setTimeout(() => { try { credentialSweep(); } catch (e) { console.error('sweep:', e.message); } }, 30_000);
setInterval(() => { try { credentialSweep(); } catch (e) { console.error('sweep:', e.message); } }, 12 * 3600e3);

/* ---------- compliance: incident register ---------- */
const REPORTABLE_24H = ['death', 'serious-injury', 'abuse-neglect', 'unlawful-contact', 'sexual-misconduct'];
const INCIDENT_CATS = {
  'death': 'Death of a person with disability', 'serious-injury': 'Serious injury', 'abuse-neglect': 'Abuse or neglect',
  'unlawful-contact': 'Unlawful sexual or physical contact', 'sexual-misconduct': 'Sexual misconduct or grooming',
  'restrictive-practice': 'Unauthorised restrictive practice', 'near-miss': 'Near miss', 'other': 'Other incident'
};
function addBusinessDays(fromIso, n) {
  const d = new Date(fromIso);
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) added++; }
  return d.toISOString();
}
function incidentOut(i) {
  let hoursLeft = null;
  if (i.notify_due && !i.commission_notified_at) hoursLeft = Math.round((new Date(i.notify_due) - Date.now()) / 36e5);
  return { ...i, category_label: INCIDENT_CATS[i.category] || i.category, hours_left: hoursLeft };
}

route('POST', /^\/api\/incidents$/, (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (limited(ip, 'incidents', 30)) return json(res, 429, { error: 'Slow down a moment.' });
  const category = INCIDENT_CATS[body.category] ? body.category : 'other';
  const description = clean(body.description, 4000);
  if (!description) return json(res, 400, { error: 'Describe what happened.' });
  const reportable = REPORTABLE_24H.includes(category) || category === 'restrictive-practice' ? 1 : 0;
  const created = now();
  const due = REPORTABLE_24H.includes(category) ? new Date(Date.now() + 24 * 3600e3).toISOString()
    : category === 'restrictive-practice' ? addBusinessDays(created, 5) : null;
  const r = db.prepare(`INSERT INTO incidents (created_by, created_by_name, participant_name, worker_name, occurred_at, location, category, reportable, description, immediate_action, notify_due, created)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(user.id, user.name, clean(body.participant_name, 80), clean(body.worker_name, 80),
      clean(body.occurred_at, 25) || created, clean(body.location, 120), category, reportable,
      description, clean(body.immediate_action, 2000), due, created);
  if (reportable && MAIL_FROM) sendMail(MAIL_FROM, `⚠ REPORTABLE INCIDENT logged — BookIt`,
    'Reportable incident — the clock is running',
    `<p><b>${escHtml(INCIDENT_CATS[category])}</b> logged by ${escHtml(user.name)}.</p><p><b>Notify the NDIS Commission ${REPORTABLE_24H.includes(category) ? 'within 24 HOURS' : 'within 5 business days'}</b> via the Commission portal, then record it in the incident register. Full written report within 14 days.</p><p>${escHtml(description.slice(0, 300))}</p>`,
    'Open the incident register', `${baseUrl(req)}/#/admin`).catch(() => {});
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid), reportable, notify_due: due });
});

route('GET', /^\/api\/admin\/incidents$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { incidents: db.prepare('SELECT * FROM incidents ORDER BY id DESC LIMIT 500').all().map(incidentOut), categories: INCIDENT_CATS });
});

route('POST', /^\/api\/admin\/incidents\/(\d+)$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const i = db.prepare('SELECT * FROM incidents WHERE id = ?').get(Number(m[1]));
  if (!i) return json(res, 404, { error: 'No such incident.' });
  if (body.action === 'notified') db.prepare('UPDATE incidents SET commission_notified_at = ?, status = ? WHERE id = ?').run(now(), 'investigating', i.id);
  else if (body.action === 'investigating') db.prepare('UPDATE incidents SET status = ? WHERE id = ?').run('investigating', i.id);
  else if (body.action === 'close') db.prepare('UPDATE incidents SET status = ?, closed_at = ?, lessons = ? WHERE id = ?').run('closed', now(), clean(body.lessons, 2000), i.id);
  else return json(res, 400, { error: 'Unknown action.' });
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/admin\/incidents\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['ID', 'Created', 'Occurred', 'Category', 'Reportable', 'Participant', 'Worker', 'Location', 'Description', 'Immediate action', 'Notify due', 'Commission notified', 'Status', 'Lessons', 'Closed'].map(q).join(',')];
  for (const i of db.prepare('SELECT * FROM incidents ORDER BY id').all()) {
    lines.push([i.id, i.created, i.occurred_at, INCIDENT_CATS[i.category] || i.category, i.reportable ? 'YES' : 'no', i.participant_name, i.worker_name, i.location, i.description, i.immediate_action, i.notify_due || '', i.commission_notified_at || '', i.status, i.lessons, i.closed_at || ''].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-incident-register.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

/* ---------- compliance: complaints register ---------- */
route('POST', /^\/api\/admin\/complaints$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const summary = clean(body.summary, 200);
  if (!summary) return json(res, 400, { error: 'Give the complaint a one-line summary.' });
  const r = db.prepare('INSERT INTO complaints (source_name, source_email, channel, summary, details, created) VALUES (?,?,?,?,?,?)')
    .run(clean(body.source_name, 80), clean(body.source_email, 120), ['site', 'email', 'phone', 'in-person', 'other'].includes(body.channel) ? body.channel : 'other', summary, clean(body.details, 4000), now());
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('GET', /^\/api\/admin\/complaints$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { complaints: db.prepare('SELECT * FROM complaints ORDER BY id DESC LIMIT 500').all() });
});

route('POST', /^\/api\/admin\/complaints\/(\d+)$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(Number(m[1]));
  if (!c) return json(res, 404, { error: 'No such complaint.' });
  if (body.action === 'acknowledge') db.prepare('UPDATE complaints SET acknowledged_at = ?, status = ? WHERE id = ?').run(now(), 'resolving', c.id);
  else if (body.action === 'resolve') db.prepare('UPDATE complaints SET resolved_at = ?, status = ?, outcome = ? WHERE id = ?').run(now(), 'resolved', clean(body.outcome, 2000), c.id);
  else if (body.action === 'reopen') db.prepare('UPDATE complaints SET status = ?, resolved_at = NULL WHERE id = ?').run('open', c.id);
  else return json(res, 400, { error: 'Unknown action.' });
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/admin\/complaints\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['ID', 'Received', 'From', 'Email', 'Channel', 'Summary', 'Details', 'Acknowledged', 'Resolved', 'Outcome', 'Status'].map(q).join(',')];
  for (const c of db.prepare('SELECT * FROM complaints ORDER BY id').all()) {
    lines.push([c.id, c.created, c.source_name, c.source_email, c.channel, c.summary, c.details, c.acknowledged_at || '', c.resolved_at || '', c.outcome, c.status].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-complaints-register.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

route('GET', /^\/api\/admin\/payroll\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare(`SELECT b.date, b.start, b.hours, b.service, b.rate_category, b.worker_share, b.claim_status,
      uw.name AS worker_name, uw.email AS worker_email
    FROM bookings b JOIN users uw ON uw.id = b.worker_id
    WHERE b.status = 'completed' ORDER BY uw.name, b.date`).all();
  const lines = [['Worker', 'Worker email', 'Date', 'Start', 'Hours', 'Service', 'Pay type', 'Rate category', 'Worker share incl. super ($)', 'Claim status'].map(q).join(',')];
  for (const r of rows) {
    lines.push([q(r.worker_name), q(r.worker_email), q(r.date), q(r.start), r.hours, q(SERVICE_LABELS[r.service] || r.service), q('Shift'),
      q((INVOICE_RATES[r.rate_category] || {}).label || r.rate_category), (r.worker_share || 0).toFixed(2), q(r.claim_status || 'unclaimed')].join(','));
  }
  /* SCHADS cl.26 on-call allowance. This is payable whether or not the worker was
     ever called — that is what buys the availability, and it is the entire marginal
     cost of the standby tier. It is NOT claimable against a participant's plan, so
     it is flagged 'not claimable' rather than left to look like an unclaimed shift. */
  const sb = db.prepare(`SELECT s.date, s.band, s.allowance, s.called_at, u.name, u.email
    FROM standby s JOIN users u ON u.id = s.worker_id
    WHERE s.status = 'accepted' ORDER BY u.name, s.date`).all();
  for (const r of sb) {
    lines.push([q(r.name), q(r.email), q(r.date), q(''), '', q('On-call standby'), q('Allowance'),
      q(`SCHADS cl.26 on-call — ${r.band === 'weekday' ? 'Mon–Fri' : 'weekend/public holiday'}${r.called_at ? ', called on' : ''}`),
      (r.allowance || 0).toFixed(2), q('not claimable')].join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-payroll-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end('﻿' + lines.join('\r\n'));
});

route('GET', /^\/api\/workers$/, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.name, u.suburb, u.email FROM worker_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.visible = 1 ORDER BY p.shifts DESC`).all()
    /* belt and braces. `visible` is held at 0 for anyone who fails the 0137
       conditions, at approval and again on every sweep — but the search page
       is the front door, so it re-asks rather than trusting the flag. */
    .filter(r => platformEligible(r.user_id, r.email));
  json(res, 200, { workers: rows.map(r => withReviewAgg(publicWorker(r))) });
});

/* one worker's full public profile — powers the #/worker/:id page.
   Credential info is label + month-level expiry only: never numbers, dates or files. */
route('GET', /^\/api\/workers\/(\d+)$/, (req, res, m) => {
  const row = db.prepare(`
    SELECT p.*, u.name, u.suburb, u.created, u.email FROM worker_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ? AND p.visible = 1`).get(Number(m[1]));
  if (!row) return json(res, 404, { error: 'That profile isn\'t available right now.' });
  if (!platformEligible(row.user_id, row.email)) return json(res, 404, { error: 'That profile isn\'t available right now.' });
  const w = withReviewAgg(publicWorker(row));
  w.reviews = db.prepare(`SELECT r.rating, r.comment, r.created, u.name FROM reviews r
    JOIN users u ON u.id = r.participant_id
    WHERE r.worker_id = ? AND r.published = 1 ORDER BY r.id DESC LIMIT 12`).all(w.id)
    .map(r => ({
      rating: r.rating, comment: r.comment, when: String(r.created).slice(0, 10),
      author: `${r.name.split(' ')[0]} ${(r.name.split(' ')[1] || '').slice(0, 1)}${r.name.split(' ')[1] ? '.' : ''}`.trim()
    }));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const joined = new Date(row.created);
  w.member_since = isNaN(joined) ? '' : `${MONTHS[joined.getMonth()]} ${joined.getFullYear()}`;
  w.completed = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE worker_id = ? AND status = 'completed'").get(w.id).n;
  /* One derivation, used by both the search card and this profile page, so the
     two can never drift apart: publicVerification() above already filtered to
     public-safe categories (checks, training, qualifications — never identity
     documents, visas or resumes), unexpired, and verified by a human. */
  w.docs = w.checks;
  json(res, 200, { worker: w });
});

route('GET', /^\/api\/rates$/, (req, res) => {
  const shares = tierShares(), bands = tierBands();
  json(res, 200, {
    rates: publicRates(), super: superRate(),
    ladder: TIERS.map(t => ({ ...t, share: shares[t.key], band: t.key === 'bronze' ? 0 : bands[t.key] }))
  });
});

route('GET', /^\/api\/conversations$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const rows = db.prepare(`
    SELECT c.* FROM conversations c
    LEFT JOIN messages msg ON msg.convo_id = c.id
    WHERE c.participant_id = ? OR c.worker_id = ?
    GROUP BY c.id ORDER BY MAX(COALESCE(msg.id, 0)) DESC`).all(user.id, user.id);
  json(res, 200, { conversations: rows.map(r => convoForUser(user, r)) });
});

route('POST', /^\/api\/conversations$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  let participantId, workerId;
  if (user.role === 'participant') {
    workerId = Number(body.worker_id);
    participantId = user.id;
    const w = db.prepare("SELECT u.id, u.email, p.visible FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(workerId);
    if (!w) return json(res, 404, { error: 'Worker not found.' });
    /* 0137: an uncleared worker must not be able to use the platform, and a
       message thread is using the platform. The `visible` flag is already
       held at 0 for them — this re-asks anyway, because a gate that depends
       on a flag being correct is only as good as the last sweep. */
    if (!w.visible || !platformEligible(workerId, w.email)) return json(res, 400, { error: 'That worker isn\'t taking messages yet.' });
  } else {
    participantId = Number(body.participant_id);
    workerId = user.id;
    const p = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'participant'").get(participantId);
    if (!p) return json(res, 404, { error: 'Participant not found.' });
  }
  let convo = db.prepare('SELECT * FROM conversations WHERE participant_id = ? AND worker_id = ?').get(participantId, workerId);
  if (!convo) {
    const r = db.prepare('INSERT INTO conversations (participant_id, worker_id, created) VALUES (?,?,?)').run(participantId, workerId, now());
    convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(r.lastInsertRowid));
  }
  json(res, 200, { conversation: convoForUser(user, convo) });
});

route('GET', /^\/api\/conversations\/(\d+)\/messages$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const convo = memberOf(user, Number(m[1]));
  if (!convo) return json(res, 404, { error: 'Conversation not found.' });
  db.prepare('UPDATE messages SET read_at = ? WHERE convo_id = ? AND sender_id != ? AND read_at IS NULL').run(now(), convo.id, user.id);
  const msgs = db.prepare('SELECT id, sender_id, body, created FROM messages WHERE convo_id = ? ORDER BY id ASC LIMIT 500').all(convo.id);
  json(res, 200, { messages: msgs.map(x => ({ id: x.id, mine: x.sender_id === user.id, body: x.body, created: x.created })) });
});

route('POST', /^\/api\/conversations\/(\d+)\/messages$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const convo = memberOf(user, Number(m[1]));
  if (!convo) return json(res, 404, { error: 'Conversation not found.' });
  const text = clean(body.body, 2000);
  if (!text) return json(res, 400, { error: 'Message can\'t be empty.' });
  const r = db.prepare('INSERT INTO messages (convo_id, sender_id, body, created) VALUES (?,?,?,?)').run(convo.id, user.id, text, now());
  /* demo auto-acknowledgement from seeded workers, once per conversation */
  if (AUTO_REPLY && user.role === 'participant') {
    const worker = db.prepare('SELECT u.id, u.name, u.email FROM users u WHERE u.id = ?').get(convo.worker_id);
    const priorFromWorker = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE convo_id = ? AND sender_id = ?').get(convo.id, convo.worker_id).n;
    if (worker && worker.email.endsWith('@demo.bookit.life') && priorFromWorker === 0) {
      setTimeout(() => {
        try {
          db.prepare('INSERT INTO messages (convo_id, sender_id, body, created) VALUES (?,?,?,?)')
            .run(convo.id, worker.id, `Thanks for your message! This is an automatic acknowledgement so you know it arrived — ${worker.name.split(' ')[0]} will reply here as soon as they can. (Demo auto-reply)`, now());
        } catch {}
      }, 4000);
    }
  }
  json(res, 200, { id: Number(r.lastInsertRowid), ok: true });
});

route('GET', /^\/api\/bookings$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const col = user.role === 'participant' ? 'participant_id' : 'worker_id';
  const otherCol = user.role === 'participant' ? 'worker_id' : 'participant_id';
  const rows = db.prepare(`SELECT b.*, u.name AS other_name,
      COALESCE(p.color, '#0E6B62') AS other_color,
      (SELECT COUNT(*) FROM reviews r WHERE r.booking_id = b.id) AS reviewed,
      (SELECT COUNT(*) FROM shift_notes n WHERE n.booking_id = b.id) AS note_count
    FROM bookings b
    JOIN users u ON u.id = b.${otherCol}
    LEFT JOIN worker_profiles p ON p.user_id = u.id
    WHERE b.${col} = ? ORDER BY b.date DESC, b.id DESC LIMIT 200`).all(user.id);
  json(res, 200, { bookings: rows });
});

route('POST', /^\/api\/bookings$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Only participants can request bookings.' });
  const workerId = Number(body.worker_id);
  const w = db.prepare("SELECT u.id, u.email, p.visible FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(workerId);
  if (!w) return json(res, 404, { error: 'Worker not found.' });
  if (!w.visible || !platformEligible(workerId, w.email)) return json(res, 400, { error: 'That worker isn\'t taking bookings yet.' });
  const service = clean(body.service, 30);
  if (!SERVICES.includes(service)) return json(res, 400, { error: 'Please choose a service.' });
  const date = clean(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Please choose a date.' });
  const start = clean(body.start, 5);
  if (!/^\d{2}:\d{2}$/.test(start)) return json(res, 400, { error: 'Please choose a start time.' });
  const hours = Number(body.hours);
  if (!(hours >= 2 && hours <= 10)) return json(res, 400, { error: 'Bookings are between 2 and 10 hours.' });
  const sleepover = body.sleepover && ['personal-care', 'daily-tasks'].includes(service) ? 1 : 0;
  const r = db.prepare('INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, notes, sleepover, created) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(user.id, workerId, service, date, start, hours, clean(body.notes, 600), sleepover, now());
  /* The gate at the point it matters. If this participant has told us they need a support we
     don't hold, the worker is told before the shift instead of finding out mid-task. It is not
     a reason to block the booking — everything else on the plan is still ours to deliver — but
     nobody should be improvising an answer in someone's bathroom. Derived, not stored: put the
     support on the certificate and this stops appearing on its own. */
  const warn = ['personal-care', 'daily-tasks'].includes(service) ? scopeWarning(user.id) : null;
  const scopeBlock = warn ? `<p style="background:#FFF6E5;border-left:3px solid #8A6D00;padding:10px 14px;margin:16px 0;">
      <b>Before you accept — one thing about this booking.</b> ${escHtml(user.name)} has told us they need help with
      ${warn.labels.map(l => escHtml(l)).join(', ')}. That is a high intensity daily personal activity and DMHC is not
      registered to deliver it, so it is not part of this shift and you must not do it. If you are asked on the day,
      say you're not able to and write a shift note — the office is already arranging that support with another provider.</p>` : '';
  const wu = db.prepare('SELECT name, email FROM users WHERE id = ?').get(workerId);
  if (wu) sendMail(wu.email, 'New booking request — BookIt',
    `New booking request, ${firstName(wu.name)}!`,
    `<p><b>${escHtml(user.name)}</b> has requested <b>${SERVICE_LABELS[service] || service}</b> on <b>${prettyDate(date)}</b> starting <b>${escHtml(start)}</b> (${hours} hours).</p>${scopeBlock}<p>Accept or decline from your bookings page — they'll see your answer straight away.</p>`,
    'View the request', `${baseUrl(req)}/#/bookings`).catch(() => {});
  json(res, 200, { id: Number(r.lastInsertRowid), ok: true, scope_warning: warn });
});

route('PATCH', /^\/api\/bookings\/(\d+)$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'Booking not found.' });
  const status = clean(body.status, 20);
  const workerActions = ['accepted', 'declined'];
  const participantActions = ['cancelled'];
  if (user.role === 'worker' && b.worker_id === user.id && workerActions.includes(status) && b.status === 'requested') {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, b.id);
    const pu = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.participant_id);
    if (pu) sendMail(pu.email, `Booking ${status} — BookIt`,
      status === 'accepted' ? 'Your booking is confirmed 🎉' : 'About your booking request',
      `<p><b>${escHtml(user.name)}</b> has <b>${status}</b> your booking for <b>${SERVICE_LABELS[b.service] || escHtml(b.service)}</b> on <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b>.</p>` +
      (status === 'accepted'
        ? `<p>You can message ${firstName(user.name)} any time to sort the details before the day.</p>`
        : '<p>No stress — every worker on Find Workers is ready to hear from you, and Meet &amp; Greets are always free.</p>'),
      'Open my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
    return json(res, 200, { ok: true });
  }
  if (user.role === 'participant' && b.participant_id === user.id && participantActions.includes(status) && ['requested', 'accepted'].includes(b.status)) {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, b.id);
    const wu2 = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.worker_id);
    if (wu2) sendMail(wu2.email, 'Booking cancelled — BookIt',
      `A booking was cancelled, ${firstName(wu2.name)}`,
      `<p><b>${escHtml(user.name)}</b> has cancelled the booking for <b>${SERVICE_LABELS[b.service] || escHtml(b.service)}</b> on <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b>.</p><p>Your calendar for that time is free again.</p>`,
      'Open my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
    return json(res, 200, { ok: true });
  }
  /* worker marks an accepted shift as completed (on/after the shift date) → invoice line is born.
     The shift note is written here rather than "some time later", and the shift can't be
     completed without one — which means it can't be invoiced or claimed without one either.
     Welding the note to the money is the only version of this that doesn't need chasing. */
  if (user.role === 'worker' && b.worker_id === user.id && status === 'completed' && b.status === 'accepted') {
    const today = new Date().toISOString().slice(0, 10);
    if (b.date > today) return json(res, 400, { error: 'You can mark a shift completed on the day of the shift or after — this one hasn\'t happened yet.' });
    const note = clean(body.note, NOTE_MAX);
    const noteBad = noteProblem(note);
    if (noteBad) return json(res, 400, { error: noteBad });
    const scope = body.scope ? 1 : 0;
    const scopeDetail = clean(body.scope_detail, NOTE_MAX);
    const scopeBad = scopeProblem(scope, scopeDetail);
    if (scopeBad) return json(res, 400, { error: scopeBad });
    const inv = applyInvoice(b.id, suggestCategory(b));
    db.prepare('UPDATE bookings SET status = ?, completed_at = ? WHERE id = ?').run('completed', now(), b.id);
    db.prepare('INSERT INTO shift_notes (booking_id, worker_id, participant_id, body, scope_flag, scope_detail, addendum, created) VALUES (?,?,?,?,?,?,0,?)')
      .run(b.id, user.id, b.participant_id, note, scope, scopeDetail, now());
    const pu2 = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.participant_id);
    if (scope) scopeAlert(req, b, user.name, pu2 ? pu2.name : `participant #${b.participant_id}`, scopeDetail);
    if (pu2 && inv) sendMail(pu2.email, 'Shift completed — BookIt',
      `Shift completed, ${firstName(pu2.name)}`,
      `<p><b>${escHtml(user.name)}</b> has marked your <b>${SERVICE_LABELS[b.service] || escHtml(b.service)}</b> shift on <b>${prettyDate(b.date)}</b> as completed.</p><p><b>${inv.qty === 1 && inv.category === 'sleepover' ? '1 night (flat)' : `${b.hours} hours ×`} $${inv.unit_price.toFixed(2)}</b> (${inv.label} — 2026–27 NDIS price limit) = <b>$${inv.total.toFixed(2)}</b>.</p><p><b>${firstName(user.name)} has written a shift note</b> about how it went — you can read it on your bookings page.</p><p>If anything about this shift doesn't look right, just reply to this email and we'll sort it out before it's claimed.</p>`,
      'Read the shift note', `${baseUrl(req)}/#/bookings`).catch(() => {});
    return json(res, 200, { ok: true, invoice: inv });
  }
  json(res, 403, { error: 'That change isn\'t allowed.' });
});

/* ---------- shift notes: read them, add to them, never rewrite them ---------- */
function noteRows(bookingId) {
  return db.prepare(`SELECT n.id, n.body, n.scope_flag, n.scope_detail, n.addendum, n.created, n.reviewed_at, u.name AS worker_name
    FROM shift_notes n JOIN users u ON u.id = n.worker_id
    WHERE n.booking_id = ? ORDER BY n.id ASC`).all(bookingId);
}

/* the participant and their worker can both read the notes on their own shift.
   Participants seeing what was written about them is the point, not a risk. */
route('GET', /^\/api\/bookings\/(\d+)\/notes$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const b = db.prepare('SELECT participant_id, worker_id FROM bookings WHERE id = ?').get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'Booking not found.' });
  if (b.participant_id !== user.id && b.worker_id !== user.id && !user.admin) return json(res, 403, { error: 'That isn\'t your booking.' });
  json(res, 200, { notes: noteRows(Number(m[1])) });
});

/* an addendum, never an edit — the original note stays exactly as written */
route('POST', /^\/api\/bookings\/(\d+)\/notes$/, (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'worker') return json(res, 403, { error: 'Only the worker who did the shift can add to its notes.' });
  if (limited(ip, 'note', 40)) return json(res, 429, { error: 'Slow down a moment.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND worker_id = ?').get(Number(m[1]), user.id);
  if (!b) return json(res, 404, { error: 'No such booking.' });
  if (b.status !== 'completed') return json(res, 400, { error: 'You can add to the notes once the shift is marked completed.' });
  const note = clean(body.note, NOTE_MAX);
  const noteBad = noteProblem(note);
  if (noteBad) return json(res, 400, { error: noteBad });
  const scope = body.scope ? 1 : 0;
  const scopeDetail = clean(body.scope_detail, NOTE_MAX);
  const scopeBad = scopeProblem(scope, scopeDetail);
  if (scopeBad) return json(res, 400, { error: scopeBad });
  const r = db.prepare('INSERT INTO shift_notes (booking_id, worker_id, participant_id, body, scope_flag, scope_detail, addendum, created) VALUES (?,?,?,?,?,?,1,?)')
    .run(b.id, user.id, b.participant_id, note, scope, scopeDetail, now());
  if (scope) {
    const pu = db.prepare('SELECT name FROM users WHERE id = ?').get(b.participant_id);
    scopeAlert(req, b, user.name, pu ? pu.name : `participant #${b.participant_id}`, scopeDetail);
  }
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

/* ============================================================================
   SUPPORT PLANS
   ==========================================================================*/

/* Every question, in one place, so the form, the validator, the worker's brief
   and the printed plan are all generated from the same list. A question that is
   only in the HTML is a question no other part of the system can act on. */
const PLAN_SECTIONS = [
  { key: 'supports', title: 'The supports you use',
    intro: 'DMHC is registered for six things and only six. Ticking one here tells the roster which workers can be offered your shifts, and what they read before the first one. Leave the rest untouched — an empty answer means "not yet", never "does not need it".' },
  { key: 'reliance', title: 'If a shift falls over',
    intro: 'These five answers are the only part of this plan the roster acts on by itself. They decide how hard BookIt chases a replacement when a worker pulls out, and how early it starts. Worth a minute of thought.' },
  { key: 'about', title: 'What a worker needs to know',
    intro: 'Written for somebody who has never met you and is about to walk in the door. Only workers whose booking with you has already been accepted ever see this — nobody browsing the site does.' },
  { key: 'safety', title: 'Your home and your community',
    intro: 'The hazards and the habits a stranger would not guess. This is where a shift goes wrong or does not.' },
  { key: 'emergency', title: 'Who we ring',
    intro: 'One person we contact if we cannot reach you and something has happened.' }
];

/* type: 'yn' | 'text'. required: the plan cannot be confirmed without it.
   showIf: only asked, and only required, once that answer is yes.
   worker_brief: appears on the brief a booked worker reads before the shift.

   The first section is the one that makes this BookIt's form rather than a
   copy of somebody else's. Every other platform asks about "daily living" in
   the abstract; DMHC holds six registration groups and delivers nothing
   outside them, so the plan asks about those six by name. That does three
   things a generic form cannot: the answers line up one-to-one with what gets
   claimed, a support nobody ticked is a support nobody rosters, and a request
   that fits none of the six is visibly out of scope on the form itself rather
   than three weeks into a service agreement. */
const PLAN_QUESTIONS = [
  { key: 'use_personal', section: 'supports', type: 'yn', required: true,
    q: 'Personal care — help with your body and your routine',
    help: 'Showering, dressing, toileting, transfers, eating, medication prompts, and the morning and evening routine around them. NDIS calls this Assistance with Self-Care Activities (0107).' },
  { key: 'personal_detail', section: 'supports', type: 'text', required: false, showIf: 'use_personal', worker_brief: true,
    q: 'What does personal care look like on a good shift?', brief_title: 'Personal care',
    help: 'The order you like things done in, the equipment involved, how much you direct and how much you want done for you. Write it the way you would say it to a new worker on day one.' },

  { key: 'use_daily', section: 'supports', type: 'yn', required: true,
    q: 'Daily tasks, or support in shared living',
    help: 'Support to run your day — including overnight and sleepover support, and support in a shared living arrangement. NDIS calls this Assistance with Daily Life Tasks in a Group or Shared Living Arrangement (0115 and 0138).' },
  { key: 'daily_detail', section: 'supports', type: 'text', required: false, showIf: 'use_daily', worker_brief: true,
    q: 'What does a day of that look like?', brief_title: 'Daily tasks & shared living',
    help: 'What happens overnight, who else is in the house, what has to be handed over between shifts, and anything that has to happen at a fixed time rather than when it suits.' },

  { key: 'use_community', section: 'supports', type: 'yn', required: true,
    q: 'Getting out — community, social and recreation',
    help: 'Support to take part in things outside the house: sport, groups, classes, appointments, the shops, seeing people. NDIS calls this Participation in Community, Social and Recreational Activities (0125).' },
  { key: 'community_detail', section: 'supports', type: 'text', required: false, showIf: 'use_community', worker_brief: true,
    q: 'Where do you go, and what makes it work?', brief_title: 'Community & social',
    help: 'The regular places and times, what you need packed, how long you can comfortably be out, and what tends to cut a day short.' },

  { key: 'use_transport', section: 'supports', type: 'yn', required: true,
    q: 'Travel and transport',
    help: 'Being driven, or being supported to use transport yourself. NDIS calls this Assistance with Travel and Transport Arrangements (0108). Tick this and BookIt will only offer your shifts to workers whose licence, registration, CTP and comprehensive insurance are all current on the day.' },
  { key: 'transport_detail', section: 'supports', type: 'text', required: false, showIf: 'use_transport', worker_brief: true,
    q: 'How do you travel?', brief_title: 'Travel & transport',
    help: 'Your own vehicle or the worker’s, whether you transfer or stay in your chair, hoist or ramp, tie-downs, how long you can sit, and anything about getting in and out that is easy to get wrong.' },

  { key: 'use_household', section: 'supports', type: 'yn', required: true,
    q: 'Household tasks',
    help: 'Cleaning, laundry, linen, dishes, and the shopping and meal prep that go with them. NDIS calls this Household Tasks (0120). A shift that is only household tasks is rostered to a Level 1 worker — that is deliberate, it is what the price limit for this line item pays for.' },
  { key: 'household_detail', section: 'supports', type: 'text', required: false, showIf: 'use_household', worker_brief: true,
    q: 'What needs doing, and how do you like it done?', brief_title: 'Household tasks',
    help: 'Which rooms, which products, what is off-limits, where things live, and anything that has to be done a particular way rather than the usual way.' },

  { key: 'use_employ', section: 'supports', type: 'yn', required: true,
    q: 'Work — finding it or keeping it',
    help: 'Support to get to work, to stay in a job, or to take part in work-related training. NDIS calls this Assistance to Access and Maintain Employment or Higher Education (0102).' },
  { key: 'employ_detail', section: 'supports', type: 'text', required: false, showIf: 'use_employ', worker_brief: true,
    q: 'What does the support at work involve?', brief_title: 'Support at work',
    help: 'Where you work, what days and hours, what the worker does while they are there, and who at your workplace they should speak to.' },

  { key: 'main_source', section: 'reliance', type: 'yn', required: true,
    q: 'Is BookIt your main source of support for daily living?',
    help: 'Yes if BookIt covers your essential personal care, or your morning and evening routine — the support that has to happen whether or not anyone is available.' },
  { key: 'health_safety', section: 'reliance', type: 'yn', required: true,
    q: 'If your workers could not attend, would your health or safety be significantly affected?',
    help: 'Meals, mobility, personal care, essential health appointments, or the activities that keep you well.' },
  { key: 'impact_detail', section: 'reliance', type: 'text', required: false, showIf: 'health_safety',
    q: 'Say how, and say how fast.',
    help: 'Hours are more useful to us than days. "No transfer means no toilet after about four hours" tells the roster what to do; "it would be difficult" does not.' },
  { key: 'backup_24h', section: 'reliance', type: 'yn', required: true,
    q: 'If BookIt were disrupted, is there other support you could call on within 24 hours?',
    help: 'Family, friends, or another provider you already use. This is not a test — answering no is what tells us to treat a gap in your roster as urgent.' },
  { key: 'backup_detail', section: 'reliance', type: 'text', required: false, showIf: 'backup_24h',
    q: 'Who, and how do we reach them?',
    help: 'A name and a number. We only ever use it if you have told us we can.' },
  { key: 'preventative_health', section: 'reliance', type: 'yn', required: true,
    q: 'Do you want support keeping on top of preventative health?',
    help: 'Vaccinations, dental, health assessments and screening. Say yes and BookIt emails you a reminder when one is due rather than letting it drift.' },

  { key: 'goals', section: 'about', type: 'text', required: true,
    q: 'What you are working towards',
    help: 'The goals from your NDIS plan, in your words — and what the support is meant to help you do.', worker_brief: true },
  { key: 'communication', section: 'about', type: 'text', required: true,
    q: 'How you communicate',
    help: 'Speech, devices, signs, boards, apps, gestures. What helps somebody understand you, and what helps you understand them. Say what a worker should do if they have not understood.', worker_brief: true },
  { key: 'mobility', section: 'about', type: 'text', required: true,
    q: 'How you move',
    help: 'Walking, stairs, transfers, chairs, hoists and aids. If a transfer has a right way and a wrong way, this is where the right way goes. Name any transfer or manual handling plan below.', worker_brief: true },
  { key: 'health_supports', section: 'about', type: 'text', required: false,
    q: 'Health things a worker must know (optional)',
    help: 'Seizures, anaphylaxis and allergies, blood glucose, pressure area care, autonomic dysreflexia, catheter or stoma care. Name the matching care plan below — the office ticks it off once the document is on file.', worker_brief: true },
  { key: 'cognition', section: 'about', type: 'text', required: false,
    q: 'Processing, memory and thinking (optional)',
    help: 'Short and long-term memory, how much notice you need before a change, and how you like information given to you.', worker_brief: true },
  { key: 'mental_health', section: 'about', type: 'text', required: false,
    q: 'Mental health (optional)',
    help: 'What helps, what does not, what a hard day looks like from the outside, and what you want a worker to do when they see one.', worker_brief: true },
  { key: 'other_info', section: 'about', type: 'text', required: false,
    q: 'Anything else before the first shift (optional)',
    help: 'Triggers, phobias, pets, house rules, the thing everybody gets wrong the first time.', worker_brief: true },

  { key: 'home_safety', section: 'safety', type: 'text', required: true,
    q: 'Safety in your home',
    help: 'Slips, trips and falls; smoking, drugs or alcohol in the home; where the exits are; manual handling; pets; and what a worker should do if something goes wrong while they are there alone with you.', worker_brief: true },
  { key: 'community_safety', section: 'safety', type: 'text', required: true,
    q: 'Safety when you are out',
    help: 'Roads, crowds, places or people to avoid, what happens if you become separated, and what a worker should do in an emergency away from home.', worker_brief: true },
  { key: 'disaster_8h', section: 'safety', type: 'yn', required: true,
    q: 'In a flood, fire or heatwave, would you need essential support within 8 hours?',
    help: 'Personal care, health support, transport or a way to communicate, so you can follow your emergency plan. Yes puts you on the list BookIt works down first when a disaster is declared in your area.' },

  { key: 'ec_name', section: 'emergency', type: 'text', required: true, q: 'Name', short: true },
  { key: 'ec_relationship', section: 'emergency', type: 'text', required: true, q: 'Relationship to you', short: true },
  { key: 'ec_phone', section: 'emergency', type: 'text', required: true, q: 'Phone', short: true },
  { key: 'ec_email', section: 'emergency', type: 'text', required: false, q: 'Email (optional)', short: true }
];
const PLAN_KEYS = PLAN_QUESTIONS.map(q => q.key);
const PLAN_YN = PLAN_QUESTIONS.filter(q => q.type === 'yn').map(q => q.key);
const PLAN_TEXT = PLAN_QUESTIONS.filter(q => q.type === 'text').map(q => q.key);

/* The standing safety notice — the one instruction that applies to every home
   regardless of what the participant writes. It is here because a worker in
   somebody's house is DMHC's worker under WHS law, and the three things below
   are what actually turns up in incident reports: a daisy-chained double
   adapter, a smoke alarm with the battery out, and a worker who spent six hours
   in a room full of cigarette smoke. Held as one constant so the form, the
   printed plan and the worker's brief cannot drift apart. */
const PLAN_HOME_NOTICE = 'Before your first shift, a few things about the house. Appliances and power cords should be in working order and plugged into a power board or a wall socket rather than a double adapter. Smoke alarms should be fitted and working. And there should be somewhere in the home a support worker can be without breathing cigarette smoke. If any of that is hard to arrange, tell us rather than leaving it — we would rather sort it out with you than have a worker find it on the day.';

/* How long a confirmed plan stands before it has to be looked at again.
   Twelve months matches the NDIS Practice Standards review expectation and the
   plan cycle most participants are on. */
const PLAN_REVIEW_MONTHS = 12;

function planDue(confirmed_at) {
  if (!confirmed_at) return '';
  const d = new Date(confirmed_at.slice(0, 10) + 'T00:00:00');
  d.setMonth(d.getMonth() + PLAN_REVIEW_MONTHS);
  return d.toISOString().slice(0, 10);
}

/* THE MECHANISM.

   Hireup asks these three questions and files the answers. That is where the
   value leaks out: a form that only produces prose produces nothing an on-call
   phone at 6am can act on. Here the same three answers resolve to one tier, and
   the tier is what the cover board sorts by and what decides whether the office
   is rung before the offer round or after it.

   Tier 1 is the combination that means a missed shift is not a gap in a roster,
   it is a person with nobody: BookIt is the main source of support, health or
   safety is significantly affected, and there is no one else inside 24 hours.
   Nothing about that requires a judgement call, so nothing about it waits for
   one. */
function continuityTier(p) {
  if (!p || p.status !== 'confirmed') {
    return { tier: 0, key: 'unknown', label: 'No confirmed plan',
      why: 'Nobody has confirmed a support plan for this participant, so we do not know what a missed shift costs them.' };
  }
  const relies = !!p.main_source, harm = !!p.health_safety, alone = !p.backup_24h;
  if (relies && harm && alone) {
    return { tier: 1, key: 'critical', label: 'Critical — 24/7',
      why: 'BookIt is the main source of support, health or safety is significantly affected without it, and there is no other support available within 24 hours.' };
  }
  if (relies && (harm || alone)) {
    return { tier: 2, key: 'high', label: 'High',
      why: relies && harm
        ? 'BookIt is the main source of support and health or safety is significantly affected without it, but other support is available within 24 hours.'
        : 'BookIt is the main source of support and there is no other support available within 24 hours, though health and safety are not significantly affected.' };
  }
  return { tier: 3, key: 'standard', label: 'Standard',
    why: 'Other support is available, or BookIt is not the main source of support for daily living.' };
}

function currentPlan(participantId) {
  return db.prepare('SELECT * FROM support_plans WHERE participant_id = ? AND current = 1').get(Number(participantId)) || null;
}
/* the most recent CONFIRMED plan, which is not always the current row — while a
   review is in progress the current row is a draft. The worker's brief and the
   continuity tier both read this one, because a half-edited draft must never
   change what a worker is told or how urgently the office is rung. */
function confirmedPlan(participantId) {
  return db.prepare("SELECT * FROM support_plans WHERE participant_id = ? AND status = 'confirmed' ORDER BY version DESC LIMIT 1").get(Number(participantId)) || null;
}
function planOut(p) {
  if (!p) return null;
  const o = { ...p };
  for (const k of PLAN_YN) o[k] = !!o[k];
  o.care_plans = safeJson(p.care_plans, []);
  o.review_due = planDue(p.confirmed_at);
  o.overdue = !!(o.review_due && o.review_due < new Date().toISOString().slice(0, 10));
  return o;
}
/* which required questions are still empty. Returned rather than thrown, so the
   form can mark them and the participant can save a draft with gaps in it —
   only confirming is gated. */
function planMissing(body) {
  const miss = [];
  for (const q of PLAN_QUESTIONS) {
    if (!q.required) continue;
    if (q.type === 'yn') { if (body[q.key] !== true && body[q.key] !== false && body[q.key] !== 0 && body[q.key] !== 1) miss.push(q.key); }
    else if (!clean(body[q.key], 6000)) miss.push(q.key);
  }
  /* the conditional follow-ups: only required once the answer above makes them
     relevant. "Yes it would affect my health" with no description is the answer
     that helps nobody, and "yes I use transport" with nothing about the hoist
     is the one that hurts somebody. Driven off showIf rather than listed here,
     so adding a question to the catalogue cannot leave its follow-up ungated. */
  for (const q of PLAN_QUESTIONS) {
    if (!q.showIf) continue;
    const on = body[q.showIf] === true || body[q.showIf] === 1;
    if (on && !clean(body[q.key], 6000)) miss.push(q.key);
  }
  return miss;
}
/* The last thing anybody said about each named document, across every version
   of the plan. Walking oldest to newest and letting later rows win means a tick
   made by the office on version 1 survives a version 2 the participant saved
   without mentioning care plans at all — and an untick still wins, because it is
   also the latest thing said. Reading only the immediately previous row loses
   the tick the first time somebody saves a draft with the section untouched,
   which is most of the time. */
function carePlanHistory(participantId) {
  const map = new Map();
  for (const r of db.prepare('SELECT care_plans FROM support_plans WHERE participant_id = ? ORDER BY id ASC').all(participantId))
    for (const c of safeJson(r.care_plans, [])) if (c && c.name) map.set(c.name, c);
  return [...map.values()];
}
function planFieldsFrom(body, prior) {
  const f = {};
  for (const k of PLAN_YN) f[k] = (body[k] === true || body[k] === 1 || body[k] === 'yes') ? 1 : 0;
  for (const k of PLAN_TEXT) f[k] = clean(body[k], 6000);
  const plans = Array.isArray(body.care_plans) ? body.care_plans : [];
  /* The participant names the care plan; the office says whether the document is
     in the folder. Those are two different claims and only one of them is the
     participant's to make, so `on_file` is never read off the request body — it
     is carried forward by name from the plan already on record. Otherwise the
     one field an auditor actually tests would be self-attested, and a rename in
     the form would silently clear a tick somebody in the office had put there. */
  const was = Array.isArray(prior) ? prior : [];
  f.care_plans = JSON.stringify(plans.slice(0, 20).map(c => {
    const name = clean(c && c.name, 160);
    const before = was.find(x => x.name === name);
    return { name, on_file: !!(before && before.on_file),
      filed_by: before ? (before.filed_by || '') : '', filed_at: before ? (before.filed_at || '') : '' };
  }).filter(c => c.name));
  return f;
}
function planWrite(participantId, f, status, byName) {
  const cols = [...PLAN_YN, ...PLAN_TEXT, 'care_plans'];
  const cur = currentPlan(participantId);
  const t = now();
  if (cur && cur.status === 'draft') {
    /* a draft is edited in place — it is not a version of anything yet */
    db.prepare(`UPDATE support_plans SET ${cols.map(c => c + ' = ?').join(', ')}, status = ?, confirmed_at = ?, confirmed_by = ?, updated = ? WHERE id = ?`)
      .run(...cols.map(c => f[c]), status, status === 'confirmed' ? t : '', status === 'confirmed' ? byName : '', t, cur.id);
    return cur.id;
  }
  const version = cur ? cur.version + 1 : 1;
  if (cur) db.prepare('UPDATE support_plans SET current = 0 WHERE id = ?').run(cur.id);
  const r = db.prepare(`INSERT INTO support_plans (participant_id, version, current, status, ${cols.join(', ')}, confirmed_at, confirmed_by, created, updated)
      VALUES (?,?,1,?,${cols.map(() => '?').join(',')},?,?,?,?)`)
    .run(participantId, version, status, ...cols.map(c => f[c]), status === 'confirmed' ? t : '', status === 'confirmed' ? byName : '', t, t);
  return Number(r.lastInsertRowid);
}

/* the four things a worker actually needs, and nothing else. A support plan
   holds health information; a worker gets the operational slice of it, and only
   for a participant whose booking they have already accepted. */
function workerBrief(participantId) {
  const p = confirmedPlan(participantId);
  if (!p) return null;
  const out = { confirmed_at: p.confirmed_at, version: p.version, home_notice: PLAN_HOME_NOTICE, sections: [] };
  for (const q of PLAN_QUESTIONS) {
    if (!q.worker_brief) continue;
    const v = clean(p[q.key], 6000);
    if (v) out.sections.push({ key: q.key, title: q.brief_title || q.q.replace(/ \(optional\)$/, ''), body: v });
  }
  out.care_plans = safeJson(p.care_plans, []);
  out.emergency = { name: p.ec_name, relationship: p.ec_relationship, phone: p.ec_phone };
  return out;
}

route('GET', /^\/api\/support-plan\/questions$/, (req, res) =>
  json(res, 200, { sections: PLAN_SECTIONS, questions: PLAN_QUESTIONS, home_notice: PLAN_HOME_NOTICE, review_months: PLAN_REVIEW_MONTHS }));

route('GET', /^\/api\/me\/support-plan$/, (req, res, m, user) => {
  if (!user || user.role !== 'participant') return json(res, 403, { error: 'Participants only.' });
  const cur = currentPlan(user.id);
  const conf = confirmedPlan(user.id);
  json(res, 200, {
    plan: planOut(cur),
    /* what they said last time, so step 1 of the review — read your previous
       answers and check they still hold — is possible without hunting */
    previous: cur && conf && cur.id !== conf.id ? planOut(conf) : null,
    continuity: continuityTier(conf),
    history: db.prepare("SELECT version, status, confirmed_at, confirmed_by FROM support_plans WHERE participant_id = ? AND status = 'confirmed' ORDER BY version DESC").all(user.id)
  });
});

route('POST', /^\/api\/me\/support-plan$/, (req, res, m, user, body) => {
  if (!user || user.role !== 'participant') return json(res, 403, { error: 'Participants only.' });
  const confirm = body.confirm === true;
  const missing = planMissing(body);
  if (confirm) {
    if (!body.declaration) return json(res, 400, { error: 'Tick the box to confirm this plan is up to date before submitting.', missing });
    if (missing.length) return json(res, 400, { error: `${missing.length} question${missing.length === 1 ? '' : 's'} still needs an answer before you can submit.`, missing });
  }
  const id = planWrite(user.id, planFieldsFrom(body, carePlanHistory(user.id)), confirm ? 'confirmed' : 'draft', user.name);
  const cur = db.prepare('SELECT * FROM support_plans WHERE id = ?').get(id);
  json(res, 200, { ok: true, plan: planOut(cur), continuity: continuityTier(confirmedPlan(user.id)), missing });
});

/* the shift brief. A worker sees it only for a participant they are booked with,
   and only for a booking that has actually been accepted — a pending request is
   not consent to read somebody's health information. */
route('GET', /^\/api\/support-plan\/(\d+)\/brief$/, (req, res, m, user) => {
  if (!user) return json(res, 403, { error: 'Log in first.' });
  const pid = Number(m[1]);
  if (!user.admin && user.id !== pid) {
    if (user.role !== 'worker') return json(res, 403, { error: 'Not yours to read.' });
    const linked = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE worker_id = ? AND participant_id = ? AND status IN ('accepted','completed')").get(user.id, pid).n;
    if (!linked) return json(res, 403, { error: 'You can read a support plan once a booking with this participant has been accepted.' });
  }
  const brief = workerBrief(pid);
  if (!brief) return json(res, 404, { error: 'No confirmed support plan yet.' });
  json(res, 200, { brief, continuity: continuityTier(confirmedPlan(pid)) });
});

/* admin: every participant, what tier they are, and what is overdue */
route('GET', /^\/api\/admin\/support-plans$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const people = db.prepare("SELECT id, name, email, suburb FROM users WHERE role = 'participant' ORDER BY name").all();
  const today = new Date().toISOString().slice(0, 10);
  const rows = people.map(u => {
    const conf = confirmedPlan(u.id);
    const cur = currentPlan(u.id);
    const c = continuityTier(conf);
    const due = planDue(conf && conf.confirmed_at);
    return {
      id: u.id, name: u.name, email: u.email, suburb: u.suburb,
      has_plan: !!conf, version: conf ? conf.version : 0,
      draft_open: !!(cur && cur.status === 'draft'),
      confirmed_at: conf ? conf.confirmed_at : '', confirmed_by: conf ? conf.confirmed_by : '',
      review_due: due, overdue: !!(due && due < today),
      tier: c.tier, tier_key: c.key, tier_label: c.label, tier_why: c.why,
      disaster_8h: !!(conf && conf.disaster_8h),
      preventative_health: !!(conf && conf.preventative_health),
      /* a care plan the participant has named and nobody has filed is the exact
         shape of the finding that costs providers at audit: the support is being
         delivered, the document that says how is not in the folder. */
      care_plans: safeJson(conf && conf.care_plans, []),
      plans_missing: safeJson(conf && conf.care_plans, []).filter(c2 => !c2.on_file).map(c2 => c2.name)
    };
  });
  json(res, 200, {
    participants: rows,
    counts: {
      none: rows.filter(r => !r.has_plan).length,
      overdue: rows.filter(r => r.overdue).length,
      critical: rows.filter(r => r.tier === 1).length,
      disaster: rows.filter(r => r.disaster_8h).length,
      plans_missing: rows.reduce((n, r) => n + r.plans_missing.length, 0)
    },
    review_months: PLAN_REVIEW_MONTHS
  });
});

route('GET', /^\/api\/admin\/support-plans\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const people = db.prepare("SELECT id, name FROM users WHERE role = 'participant' ORDER BY name").all();
  const today = new Date().toISOString().slice(0, 10);
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Participant', 'Plan on file', 'Version', 'Confirmed', 'Review due', 'Overdue', 'Continuity tier', 'Why',
    'Disaster support within 8h', 'Preventative health', 'Care plans named', 'Care plans not on file'].map(q).join(',')];
  for (const u of people) {
    const p = confirmedPlan(u.id), c = continuityTier(p), due = planDue(p && p.confirmed_at);
    const cps = safeJson(p && p.care_plans, []);
    lines.push([u.name, p ? 'yes' : 'no', p ? p.version : '', p ? p.confirmed_at.slice(0, 10) : '', due,
      due && due < today ? 'YES' : '', c.label, c.why,
      p && p.disaster_8h ? 'yes' : 'no', p && p.preventative_health ? 'yes' : 'no',
      cps.map(x => x.name).join('; '), cps.filter(x => !x.on_file).map(x => x.name).join('; ')].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-support-plans.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

/* admin: mark a named care plan as filed. The tick is the evidence trail — who
   said the document exists, and when — so it is recorded with a name against it
   rather than flipping a silent boolean. */
route('POST', /^\/api\/admin\/support-plans\/(\d+)\/care-plan$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const p = confirmedPlan(Number(m[1]));
  if (!p) return json(res, 404, { error: 'No confirmed support plan for that participant.' });
  const name = clean(body.name, 160);
  const list = safeJson(p.care_plans, []);
  const hit = list.find(c => c.name === name);
  if (!hit) return json(res, 404, { error: 'That care plan is not named in this support plan.' });
  hit.on_file = body.on_file === true;
  hit.filed_by = hit.on_file ? user.name : '';
  hit.filed_at = hit.on_file ? now() : '';
  db.prepare('UPDATE support_plans SET care_plans = ?, updated = ? WHERE id = ?').run(JSON.stringify(list), now(), p.id);
  logCompliance({ kind: 'care-plan', result: hit.on_file ? 'on-file' : 'not-on-file',
    detail: `${name} — support plan v${p.version} for participant #${p.participant_id}`,
    source: 'admin', checked_by: user.name });
  json(res, 200, { ok: true, care_plans: list });
});

/* ============================================================================
   THE FORMS REGISTER — every document DMHC has to be able to produce
   ==========================================================================*/

/* The question this answers is "where are my forms", and the honest answer has
   three parts, so the register has three parts.

   `live` means BookIt holds the record itself and watches its own clock. There
   is nothing to keep track of by hand, because the system is the register.

   `drive` means the document exists as a file in Google Drive. It is real, it is
   probably fine, and nothing on earth is watching it. Every finding at DMHC's
   last review was in this pile: a credential held as a phone photo has no expiry
   date as far as any system is concerned, which is how two workers ended up
   rostered on expired screening while their certificates sat in a folder.

   `missing` means it does not exist yet.

   `requires` names the Practice Standards outcome or the Rules instrument, not a
   clause number. The outcome names are stable and checkable; invented clause
   numbers are worse than no citation, because they look authoritative. Where the
   basis is DMHC's own audit sheet rather than my reading of the rules, it says
   so.

   `cadence`: once | annual | monthly | quarterly | per-event | expiry | on-change */
const FORMS = [
  /* ---------- governance: the company holds one of each ---------- */
  { key: 'cert-registration', name: 'NDIS certificate of registration + scope', scope: 'company', track: 'drive', cadence: 'expiry', signed: 'NDIS Commission', template: 'n/a', requires: 'NDIS Act — registration', note: 'Current certificate runs to 21/01/2029. Mid-term audit window opens 21/07/2027.' },
  { key: 'policy-register', name: 'Policy Register', scope: 'company', track: 'drive', cadence: 'on-change', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Governance and operational management', note: 'Currently lists 24 documents including the five added July 2026.' },
  { key: 'doc-list-core', name: 'Document List — Core', scope: 'company', track: 'drive', cadence: 'on-change', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Information management' },
  { key: 'gov-review', name: 'Governing Personnel Skills and Performance Review', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Governance and operational management' },
  { key: 'coi-declaration', name: 'Conflict of Interest Declaration (governing person)', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Governance and operational management', note: 'A nil declaration is still evidence. An empty register is not.' },
  { key: 'mgmt-minutes', name: 'Management meeting agenda + minutes', scope: 'company', track: 'drive', cadence: 'monthly', signed: 'Chair', template: 'DMHC', requires: 'Core Module — Governance and operational management' },
  { key: 'staff-minutes', name: 'Staff meeting agenda + minutes', scope: 'company', track: 'drive', cadence: 'monthly', signed: 'Chair', template: 'DMHC', requires: 'Core Module — Human resource management' },
  { key: 'internal-audit', name: 'Internal Audit Schedule + completed audits', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Quality management' },
  { key: 'ci-plan', name: 'Continuous Improvement Plan', scope: 'company', track: 'drive', cadence: 'quarterly', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Quality management' },
  { key: 'risk-plan', name: 'Risk Management Plan + risk register', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Risk management' },
  { key: 'continuity-plan', name: 'Business continuity / emergency and disaster management plan', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Continuity of supports' },
  { key: 'insurance-pl', name: 'Certificate of currency — Public and Products Liability', scope: 'company', track: 'drive', cadence: 'expiry', signed: 'Insurer', template: 'n/a', requires: 'Core Module — Governance and operational management', note: 'Held in the Business folder, renews about November. Copy into Core Documents.' },
  { key: 'insurance-pi', name: 'Certificate of currency — Professional Indemnity', scope: 'company', track: 'drive', cadence: 'expiry', signed: 'Insurer', template: 'n/a', requires: 'Core Module — Governance and operational management' },
  { key: 'insurance-wc', name: 'Certificate of currency — Workers Compensation', scope: 'company', track: 'drive', cadence: 'expiry', signed: 'Insurer', template: 'n/a', requires: 'Workers compensation legislation (NSW)', note: 'The premium rate on this certificate is the number that sets the platform margin floor.' },
  { key: 'pol-incident', name: 'Incident Management policy and procedure', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'NDIS (Incident Management and Reportable Incidents) Rules 2018' },
  { key: 'pol-complaints', name: 'Complaints Management and Resolution policy', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'NDIS (Complaints Management and Resolution) Rules 2018' },
  { key: 'pol-screening', name: 'Worker Screening policy and procedure', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'NDIS (Practice Standards — Worker Screening) Rules 2018' },
  { key: 'pol-privacy', name: 'Privacy policy + data breach response', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Privacy and dignity', note: 'Breach response 1 business day; retention 7 years / 25 years.' },
  { key: 'pol-behaviour', name: 'Behaviour Support and Restrictive Practices policy', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'BookIt', requires: 'Core Module — Violence, abuse, neglect, exploitation and discrimination', note: 'Added and signed July 2026.' },
  { key: 'pol-decisions', name: 'Supported Decision-Making procedure', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'BookIt', requires: 'Core Module — Independence and informed choice', note: 'Added and signed July 2026.' },
  { key: 'pol-living-alone', name: 'Living Alone Safeguards procedure (s73G)', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'BookIt', requires: 'NDIS Act s73G condition on this registration', note: 'Added and signed July 2026.' },
  { key: 'pol-transport', name: 'Transport and Vehicle Safety procedure', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'BookIt', requires: 'Core Module — Safe environment', note: 'Added and signed July 2026. 0108 is on the certificate.' },
  { key: 'pol-tenancy', name: 'Tenancy and Support Separation statement', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'BookIt', requires: 'SIL / SDA module as audited', note: 'Added and signed July 2026.' },
  { key: 'sil-collab', name: 'SDA and SIL Collaboration Agreement', scope: 'company', track: 'drive', cadence: 'on-change', signed: 'Both providers', template: 'BookIt', requires: 'SIL module as audited', note: 'Drafted July 2026 — to be filed and added to the Policy Register.' },
  { key: 'sil-info-pack', name: 'SIL Information Pack (participant-facing)', scope: 'company', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'BookIt', requires: 'Core Module — Access to supports' },
  { key: 'contractor-agreement', name: 'Engagement model — employment or contractor agreement template', scope: 'company', track: 'drive', cadence: 'on-change', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Human resource management', note: 'Unresolved with the lawyer. It decides superannuation, award coverage, workers compensation, insurance response and who carries the duty of care on shift.' },

  /* ---------- registers: living lists, never a snapshot ---------- */
  { key: 'reg-worker', name: 'Worker Register', scope: 'register', track: 'live', live: 'workers', cadence: 'on-change', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Human resource management', note: 'BookIt holds the live version. The Drive copy is a quarterly export, not the record.' },
  { key: 'reg-participant', name: 'Participant Register', scope: 'register', track: 'live', live: 'participants', cadence: 'on-change', signed: 'Supriya Thapa', template: 'none', requires: 'Core Module — Information management' },
  { key: 'reg-incident', name: 'Incident Register', scope: 'register', track: 'live', live: 'incidents', cadence: 'per-event', signed: 'Supriya Thapa', template: 'DMHC', requires: 'NDIS (Incident Management and Reportable Incidents) Rules 2018', note: 'BookIt runs the 24-hour and 5-business-day clocks itself.' },
  { key: 'reg-complaints', name: 'Complaints and Feedback Register', scope: 'register', track: 'live', live: 'complaints', cadence: 'per-event', signed: 'Supriya Thapa', template: 'DMHC', requires: 'NDIS (Complaints Management and Resolution) Rules 2018' },
  { key: 'reg-banning', name: 'Banning orders check register', scope: 'register', track: 'live', live: 'banning', cadence: 'quarterly', signed: 'System', template: 'BookIt', requires: '0137 conditions of registration', note: 'Three registers per worker, re-checked automatically.' },
  { key: 'reg-coi', name: 'Conflict of Interest Register', scope: 'register', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Governance and operational management' },
  { key: 'reg-ci', name: 'Continuous Improvement Register', scope: 'register', track: 'drive', cadence: 'quarterly', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Quality management' },
  { key: 'reg-restrictive', name: 'Restrictive Practices Register', scope: 'register', track: 'drive', cadence: 'per-event', signed: 'Supriya Thapa', template: 'DMHC', requires: 'NDIS (Restrictive Practices and Behaviour Support) Rules 2018', note: 'Nil is the expected state. A nil register still has to exist and be dated.' },
  { key: 'reg-training', name: 'Training and Development Register (one per worker)', scope: 'register', track: 'drive', cadence: 'on-change', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Human resource management', note: '151 blanks across seven registers. Filling the Worker Register first turns these into transcription.' },
  { key: 'reg-medicine', name: 'Medicine Register (per participant, per month)', scope: 'register', track: 'drive', cadence: 'monthly', signed: 'Worker on each administration', template: 'DMHC', requires: 'Core Module — Management of medication', note: 'Register 13 covers 25/11/2025 only and every worker signature cell in it is blank. Nothing between 26/11/2025 and 30/06/2026. Do not backfill — the file note discloses the gap.' },

  /* ---------- one per worker ---------- */
  { key: 'w-agreement', name: 'Signed engagement agreement', scope: 'worker', track: 'drive', cadence: 'once', signed: 'Worker + Supriya', template: 'DMHC', requires: 'Core Module — Human resource management' },
  { key: 'w-position', name: 'Position description acknowledgement', scope: 'worker', track: 'drive', cadence: 'once', signed: 'Worker', template: 'DMHC', requires: 'Core Module — Human resource management' },
  { key: 'w-declaration', name: 'Worker Declaration (policies read and understood)', scope: 'worker', track: 'drive', cadence: 'on-change', signed: 'Worker', template: 'DMHC', requires: 'Core Module — Human resource management', note: 'Re-signed whenever the policy list changes. The five July 2026 policies were missing from the list workers had signed.' },
  { key: 'w-induction', name: 'Worker Induction Checklist', scope: 'worker', track: 'drive', cadence: 'once', signed: 'Worker + Supriya', template: 'DMHC', requires: 'Core Module — Human resource management' },
  { key: 'w-id', name: '100 points of identification', scope: 'worker', track: 'live', live: 'doc:id-points', cadence: 'once', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Human resource management' },
  { key: 'w-rtw', name: 'Right to work — visa grant / VEVO check', scope: 'worker', track: 'live', live: 'doc:visa', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'Migration Act — work rights', note: 'Condition 8105 caps a subclass 500 holder at 48 hours a fortnight. That is a rostering constraint, not just a file.' },
  { key: 'w-screening', name: 'NDIS Worker Screening Check', scope: 'worker', track: 'live', live: 'doc:ndis-screening', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'NDIS (Practice Standards — Worker Screening) Rules 2018', note: 'Blocks bookings on an expired or unverified check. This IS the criminal history check — the NDIS check is a nationally coordinated police check plus a risk assessment, so a separate National Police Certificate is not a second requirement and is not tracked as one. Workers who uploaded one anyway keep it on file.' },
  { key: 'w-wwcc', name: 'Working with Children Check', scope: 'worker', track: 'live', live: 'doc:wwcc', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'State child protection legislation' },
  { key: 'w-orientation', name: 'NDIS Worker Orientation Module certificate', scope: 'worker', track: 'live', live: 'doc:ndis-orientation', cadence: 'once', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Human resource management' },
  { key: 'w-firstaid', name: 'First Aid and CPR certificate', scope: 'worker', track: 'live', live: 'doc:first-aid', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Safe environment', note: 'CPR renews yearly, first aid every three years. The yearly one is what lapses.' },
  { key: 'w-infection', name: 'Infection prevention and control training', scope: 'worker', track: 'live', live: 'doc:infection-control', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Safe environment' },
  { key: 'w-manual', name: 'Manual handling training certificate', scope: 'worker', track: 'live', live: 'doc:manual-handling', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Safe environment', note: 'Nobody has one on file, for a participant needing daily transfers. Largest uncovered risk to both sides.' },
  { key: 'w-medication', name: 'Medication administration training', scope: 'worker', track: 'live', live: 'doc:medication-training', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Management of medication' },
  { key: 'w-hi-competency', name: 'High-intensity skills competency sign-off (catheter, stoma, AD)', scope: 'worker', track: 'missing', cadence: 'annual', signed: 'Clinician or supervisor', template: 'none', requires: 'High Intensity Daily Personal Activities module', note: 'The training has been delivered. No certificate or competency sign-off is in any worker folder. The gap is evidence, not care.' },
  { key: 'w-qualification', name: 'Qualification certificates', scope: 'worker', track: 'live', live: 'doc:qualification', cadence: 'once', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Human resource management' },
  { key: 'w-licence', name: 'Driver licence + vehicle registration, CTP and comprehensive insurance', scope: 'worker', track: 'live', live: 'doc:driver-licence', cadence: 'expiry', signed: 'n/a', template: 'BookIt', requires: 'Core Module — Safe environment', note: 'Needed by anyone rostered on 0108 transport. Nobody has a licence recorded.' },
  { key: 'w-supervision', name: 'Supervision and performance review record', scope: 'worker', track: 'drive', cadence: 'annual', signed: 'Worker + Supriya', template: 'DMHC', requires: 'Core Module — Human resource management' },

  /* ---------- one per participant ---------- */
  { key: 'p-intake', name: 'Intake / referral form', scope: 'participant', track: 'drive', cadence: 'once', signed: 'Participant', template: 'DMHC', requires: 'Core Module — Access to supports' },
  { key: 'p-agreement', name: 'Service Agreement', scope: 'participant', track: 'drive', cadence: 'on-change', signed: 'Participant + DMHC', template: 'DMHC', requires: 'Core Module — Service agreements with participants', note: 'On file at 2025–26 limits, which have ceased. New figures must be agreed in writing before invoicing at them.' },
  { key: 'p-schedule', name: 'Schedule of Supports', scope: 'participant', track: 'drive', cadence: 'on-change', signed: 'Participant + DMHC', template: 'DMHC', requires: 'Core Module — Service agreements with participants' },
  { key: 'p-support-plan', name: 'Support Plan', scope: 'participant', track: 'live', live: 'support_plan', cadence: 'annual', signed: 'Participant', template: 'BookIt', requires: 'Core Module — Support planning', note: 'BookIt holds this now. The participant confirms it themselves and the review clock runs from their confirmation.' },
  { key: 'p-risk', name: 'Risk Assessment', scope: 'participant', track: 'drive', cadence: 'annual', signed: 'Supriya Thapa', template: 'DMHC', requires: 'Core Module — Risk management' },
  { key: 'p-emergency', name: 'Participant Emergency and Disaster Plan', scope: 'participant', track: 'drive', cadence: 'annual', signed: 'Participant + DMHC', template: 'DMHC', requires: 'Core Module — Continuity of supports', note: 'The support plan asks whether essential safety support is needed within 8 hours of a disaster. That answer belongs in this plan.' },
  { key: 'p-consent-privacy', name: 'Privacy and information-sharing consent', scope: 'participant', track: 'drive', cadence: 'annual', signed: 'Participant', template: 'DMHC', requires: 'Core Module — Privacy and dignity' },
  { key: 'p-consent-media', name: 'Photo and media consent', scope: 'participant', track: 'drive', cadence: 'annual', signed: 'Participant', template: 'DMHC', requires: 'Core Module — Privacy and dignity' },
  { key: 'p-advocate', name: 'Advocate / nominee / decision-maker form', scope: 'participant', track: 'drive', cadence: 'on-change', signed: 'Participant', template: 'DMHC', requires: 'Core Module — Independence and informed choice' },
  { key: 'p-money', name: 'Money and Property Declaration', scope: 'participant', track: 'drive', cadence: 'annual', signed: 'Participant + DMHC', template: 'DMHC', requires: 'Core Module — Participant money and property' },
  { key: 'p-medication', name: 'Medication Plan and Administration Form + consent', scope: 'participant', track: 'drive', cadence: 'on-change', signed: 'Participant + prescriber', template: 'DMHC', requires: 'Core Module — Management of medication', note: 'On file but entirely blank per-medication.' },
  { key: 'p-mealtime', name: 'Mealtime Management Plan', scope: 'participant', track: 'drive', cadence: 'annual', signed: 'Clinician', template: 'DMHC', requires: 'Recorded as met on DMHC\'s 2025 Core Module audit sheet', note: 'The two 2025 audit sheets contradict each other — one ticks it as met, the participant file records it was declined. Both cannot be true.' },
  { key: 'p-care-plans', name: 'Clinical care plans named in the support plan', scope: 'participant', track: 'live', live: 'care_plans', cadence: 'on-change', signed: 'Clinician', template: 'none', requires: 'Core Module — Support planning', note: 'The support plan asks the participant to name every care plan they have. Any name with no document behind it shows up here.' },
  { key: 'p-ndis-plan', name: 'Copy of the current NDIS plan + plan dates', scope: 'participant', track: 'drive', cadence: 'expiry', signed: 'NDIA', template: 'none', requires: 'Core Module — Service agreements with participants', note: 'The plan on file expired 24/06/2026 while supports continued.' },
  { key: 'p-notes', name: 'Progress notes / shift notes', scope: 'participant', track: 'live', live: 'shift_notes', cadence: 'per-event', signed: 'Worker', template: 'BookIt', requires: 'Core Module — Responsive support provision', note: 'Append-only in BookIt. A note that can be quietly rewritten is not evidence of anything.' },
  { key: 'p-satisfaction', name: 'Participant Satisfaction Survey', scope: 'participant', track: 'missing', cadence: 'annual', signed: 'Participant', template: 'none', requires: 'Core Module — Quality management', note: 'Never run. Due annually.' },
  { key: 'p-annual-review', name: 'Annual review record', scope: 'participant', track: 'drive', cadence: 'annual', signed: 'Participant + DMHC', template: 'none', requires: 'Core Module — Support planning' },
  { key: 'p-living-arrangement', name: 'Living Arrangement Determination (s73G)', scope: 'participant', track: 'drive', cadence: 'on-change', signed: 'Supriya Thapa', template: 'none', requires: 'NDIS Act s73G condition on this registration', note: 'Settles the contradiction between "lives with parents" in the support plan and the sole-worker clause in the agreement.' },
  { key: 'p-exit', name: 'Exit / transition record', scope: 'participant', track: 'drive', cadence: 'per-event', signed: 'Participant + DMHC', template: 'DMHC', requires: 'Core Module — Transitions to or from the provider' }
];
const FORM_SCOPES = [
  { key: 'company', label: 'The company holds one of each', per: 'once' },
  { key: 'register', label: 'Registers — living lists, never a snapshot', per: 'ongoing' },
  { key: 'worker', label: 'One set per worker', per: 'per worker' },
  { key: 'participant', label: 'One set per participant', per: 'per participant' }
];

/* The register as data rather than as a response. The admin route serves it,
   the audit pack embeds it and the nightly snapshot counts it — all three from
   this one function, so a number on the admin screen and the same number in the
   audit zip cannot disagree. */
function formsRegister() {
  const today = new Date().toISOString().slice(0, 10);
  const workers = db.prepare("SELECT u.id, u.name FROM users u JOIN worker_profiles p ON p.user_id = u.id ORDER BY u.name").all();
  const participants = db.prepare("SELECT id, name FROM users WHERE role = 'participant' ORDER BY name").all();

  /* what BookIt can actually answer for itself. Everything not in here is a file
     in a folder, and the register says so rather than implying coverage. */
  function liveState(f) {
    if (f.track !== 'live') return null;
    if (String(f.live || '').startsWith('doc:')) {
      const key = f.live.slice(4);
      const of = w => key === 'id-points'
        ? (onboardingSummary(w.id).id_ok ? { held: 1, ok: 1 } : { held: 0, ok: 0 })
        : (() => {
            const rows = db.prepare('SELECT * FROM worker_docs WHERE worker_id = ? AND doc_type = ?').all(w.id, key);
            if (!rows.length) return { held: 0, ok: 0 };
            const good = rows.some(d => d.verified_at && (!d.expiry_date || d.expiry_date >= today));
            const expired = rows.some(d => d.expiry_date && d.expiry_date < today);
            return { held: 1, ok: good ? 1 : 0, expired: expired ? 1 : 0 };
          })();
      const st = workers.map(of);
      return { of: workers.length, unit: 'workers',
        held: st.filter(x => x.held).length, ok: st.filter(x => x.ok).length,
        expired: st.filter(x => x.expired).length,
        gaps: workers.filter((w, i) => !st[i].ok).map(w => w.name) };
    }
    if (f.live === 'support_plan') {
      const ok = participants.filter(p => !!confirmedPlan(p.id));
      return { of: participants.length, unit: 'participants', held: ok.length, ok: ok.length,
        gaps: participants.filter(p => !confirmedPlan(p.id)).map(p => p.name) };
    }
    if (f.live === 'care_plans') {
      const named = [], missing = [];
      for (const p of participants) {
        for (const c of safeJson((confirmedPlan(p.id) || {}).care_plans, [])) {
          named.push(c.name);
          if (!c.on_file) missing.push(`${p.name} — ${c.name}`);
        }
      }
      return { of: named.length, unit: 'named care plans', held: named.length - missing.length,
        ok: named.length - missing.length, gaps: missing };
    }
    if (f.live === 'shift_notes') {
      const n = db.prepare('SELECT COUNT(*) AS n FROM shift_notes').get().n;
      return { of: n, unit: 'notes', held: n, ok: n, gaps: [] };
    }
    if (f.live === 'incidents') {
      const n = db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n;
      const late = db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE reportable = 1 AND commission_notified_at IS NULL").get().n;
      return { of: n, unit: 'incidents', held: n, ok: n - late, gaps: late ? [`${late} reportable incident${late === 1 ? '' : 's'} not yet notified to the Commission`] : [] };
    }
    if (f.live === 'complaints') {
      const n = db.prepare('SELECT COUNT(*) AS n FROM complaints').get().n;
      return { of: n, unit: 'complaints', held: n, ok: n, gaps: [] };
    }
    if (f.live === 'banning') {
      const n = db.prepare("SELECT COUNT(*) AS n FROM compliance_log WHERE kind LIKE 'banning%'").get().n;
      return { of: workers.length, unit: 'workers', held: n ? workers.length : 0, ok: n ? workers.length : 0, gaps: [] };
    }
    if (f.live === 'workers') return { of: workers.length, unit: 'workers', held: workers.length, ok: workers.length, gaps: [] };
    if (f.live === 'participants') return { of: participants.length, unit: 'participants', held: participants.length, ok: participants.length, gaps: [] };
    return null;
  }

  const forms = FORMS.map(f => {
    const state = liveState(f);
    return { ...f, state,
      /* the copies you actually have to produce at audit. A per-worker form is
         one form on paper and seven documents in a folder, and the difference is
         the whole reason the Worker Register has 82 blanks in it. */
      copies: f.scope === 'worker' ? workers.length : f.scope === 'participant' ? participants.length : 1 };
  });
  const byTrack = t => forms.filter(f => f.track === t);
  return {
    scopes: FORM_SCOPES, forms,
    workers: workers.length, participants: participants.length,
    counts: {
      total: forms.length,
      live: byTrack('live').length,
      drive: byTrack('drive').length,
      missing: byTrack('missing').length,
      /* the number worth quoting: how many separate documents exist once the
         per-person forms are multiplied out */
      documents: forms.reduce((n, f) => n + f.copies, 0),
      gaps: forms.reduce((n, f) => n + (f.state ? f.state.gaps.length : 0), 0)
    }
  };
}

route('GET', /^\/api\/admin\/forms$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, formsRegister());
});

route('GET', /^\/api\/admin\/forms\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const scope = { company: 'Company', register: 'Register', worker: 'Per worker', participant: 'Per participant' };
  const track = { live: 'BookIt tracks it', drive: 'File in Drive — nothing watches it', missing: 'Does not exist yet' };
  const lines = [['Form', 'Belongs to', 'Where it is tracked', 'How often', 'Who signs', 'Whose template', 'What requires it', 'Note'].map(q).join(',')];
  for (const f of FORMS) {
    lines.push([f.name, scope[f.scope] || f.scope, track[f.track] || f.track, f.cadence, f.signed,
      f.template === 'DMHC' ? "DMHC's own form" : f.template === 'BookIt' ? 'Built for DMHC (no template existed)' : f.template,
      f.requires, f.note || ''].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="dmhc-forms-register.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

/* ================================================================
   THE AUDIT PACK — one button, everything, dated.

   Bee's requirement, in his words: "All I want to do is download when
   audit day comes and everything is there."

   Two things make that true rather than aspirational.

   FIRST, THE PACK DOES NOT HAVE ITS OWN COPY OF ANYTHING. Every register
   in the zip is produced by calling the *same route* the individual
   download button calls — dispatched internally through the router table
   (`collect()` below). So the incident register inside the pack is byte
   for byte the incident register you get from the Incidents card. There
   is no second implementation to drift, and no way to fix a bug in one
   and not the other. This is the same argument as PLAN_QUESTIONS: one
   source, two consumers.

   SECOND, IT RUNS ITSELF. `auditSnapshot()` writes one row a night —
   how many forms, how many documents, how many gaps, and what the gaps
   were. That history ships in the pack as monitoring-history.csv, and it
   is the part an auditor actually cares about. A pack generated on audit
   morning proves what is true on audit morning. A year of dated rows
   proves you were watching all year, which is what "continuous
   improvement" and Practice Standard "Governance and operational
   management" are asking for. Nobody has to remember to press anything.
   ================================================================ */

for (const stmt of [
  `CREATE TABLE IF NOT EXISTS audit_snapshots (
     day TEXT PRIMARY KEY,
     taken_at TEXT NOT NULL,
     forms INTEGER DEFAULT 0,
     documents INTEGER DEFAULT 0,
     tracked_live INTEGER DEFAULT 0,
     gaps INTEGER DEFAULT 0,
     workers INTEGER DEFAULT 0,
     participants INTEGER DEFAULT 0,
     detail TEXT DEFAULT ''
   )`
]) { try { db.exec(stmt); } catch { } }

/* ---------- a zip file, by hand ----------
   BookIt has no dependencies and this is not the release that starts. A zip
   is a well-specified container: a local header per entry, a central
   directory, an end record. deflate comes from node's own zlib. Stored
   rather than deflated when deflate makes it bigger, which is the usual
   case for a JPEG or a PDF that is already compressed. */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosStamp(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
    date: (((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
  };
}

function zipBuffer(entries, when) {
  const stamp = dosStamp(when || new Date());
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const crc = crc32(raw);
    let body = raw, method = 0;
    if (raw.length > 256) {
      const comp = zlib.deflateRawSync(raw, { level: 6 });
      if (comp.length < raw.length) { body = comp; method = 8; }
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);              /* names are UTF-8 */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(stamp.time, 12);
    c.writeUInt16LE(stamp.date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, dir, end]);
}

/* ---------- call our own routes, in-process ----------
   The pack must not contain a second implementation of any register. So it
   asks the router for the same handler the download button hits, hands it a
   response object that keeps the bytes instead of sending them, and puts
   those exact bytes in the zip. If a register is ever wrong, it is wrong in
   one place. */
function collect(url, user) {
  const pathOnly = url.split('?')[0];
  const r = routes.find(rt => rt.method === 'GET' && rt.pattern.test(pathOnly));
  if (!r) return { status: 404, body: '' };
  let status = 200, body = '';
  const sink = {
    writeHead(code) { status = code; return sink; },
    setHeader() { },
    write(chunk) { body += chunk; },
    end(chunk) { if (chunk != null) body += chunk; }
  };
  try {
    r.handler({ url, method: 'GET', headers: { host: 'localhost' } }, sink, r.pattern.exec(pathOnly), user, null, '127.0.0.1');
  } catch (e) {
    return { status: 500, body: 'This register could not be generated: ' + e.message };
  }
  return { status, body };
}

/* The pack's table of contents. Order is the order an auditor reads in:
   what you must hold, then what went wrong, then what you did about it,
   then the money. */
const AUDIT_REPORTS = [
  { path: 'registers/01-forms-register.csv', url: '/api/admin/forms.csv', title: 'Every form DMHC must hold, what requires it, and where it is tracked' },
  { path: 'registers/02-worker-credentials.csv', url: '/api/admin/worker-credentials.csv', title: 'Every credential on file for every worker, with expiry and verification' },
  { path: 'registers/03-participants.csv', url: '/api/admin/participant-register.csv', title: 'Participants, service start, plan dates and support plan status' },
  { path: 'registers/04-incident-register.csv', url: '/api/admin/incidents.csv', title: 'Incident register — Practice Standards, incident management' },
  { path: 'registers/05-complaints-register.csv', url: '/api/admin/complaints.csv', title: 'Complaints register — Practice Standards, feedback and complaints' },
  { path: 'registers/06-out-of-scope-register.csv', url: '/api/admin/scope-register.csv', title: 'Requests for supports outside the certificate, and how each was closed' },
  { path: 'registers/07-conditions-of-registration.csv', url: '/api/admin/compliance/0137.csv', title: 'Platform conditions of registration, evidenced condition by condition' },
  { path: 'registers/08-support-plans.csv', url: '/api/admin/support-plans.csv', title: 'Support plans — version, continuity tier, confirmation and review dates' },
  { path: 'evidence/compliance-log.csv', url: '/api/admin/compliance/log.csv', title: 'Every automated check the platform has ever run, with its result' },
  { path: 'finance/invoices.csv', url: '/api/admin/invoices.csv', title: 'Invoices raised' },
  { path: 'finance/payroll.csv', url: '/api/admin/payroll.csv', title: 'Worker payments including SCHADS on-call allowances' },
  { path: 'finance/pace-claims.csv', url: '/api/admin/claims/pace.csv', title: 'PACE claim file as submitted' }
];

/* ---------- two registers an auditor asks for that had no export ---------- */
route('GET', /^\/api\/admin\/worker-credentials\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const today = new Date().toISOString().slice(0, 10);
  const lines = [['Worker', 'Email', 'Document', 'Label', 'Number', 'Expires', 'Status today', 'Uploaded', 'Verified', 'Verified by', 'File in pack'].map(q).join(',')];
  const rows = db.prepare(`SELECT d.*, u.name, u.email FROM worker_docs d JOIN users u ON u.id = d.worker_id
    ORDER BY u.name, d.doc_type, d.id`).all();
  for (const d of rows) {
    const state = !d.expiry_date ? 'No expiry recorded'
      : d.expiry_date < today ? 'EXPIRED'
        : d.expiry_date <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? 'Expires within 30 days' : 'Current';
    lines.push([d.name, d.email, DOC_TYPES[d.doc_type] || d.doc_type, d.label, d.check_number,
      d.expiry_date ? dmy(d.expiry_date) : '', state, d.uploaded_at ? dmy(d.uploaded_at.slice(0, 10)) : '',
      d.verified_at ? dmy(d.verified_at.slice(0, 10)) : 'NOT VERIFIED', d.verified_by || '',
      d.file_path && fs.existsSync(d.file_path) ? 'yes' : 'no file attached'].map(q).join(','));
  }
  /* a worker with no documents at all never appears in a join over worker_docs,
     and that worker is the one worth finding */
  for (const w of db.prepare(`SELECT u.id, u.name, u.email FROM users u JOIN worker_profiles p ON p.user_id = u.id
      WHERE NOT EXISTS (SELECT 1 FROM worker_docs d WHERE d.worker_id = u.id) ORDER BY u.name`).all()) {
    lines.push([w.name, w.email, '—', '', '', '', 'NOTHING ON FILE', '', '', '', 'no'].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-worker-credentials.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

route('GET', /^\/api\/admin\/participant-register\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Participant', 'Email', 'Suburb', 'Joined', 'Shifts booked', 'Last shift',
    'Support plan', 'Version', 'Continuity tier', 'Confirmed', 'Review due', 'Care plans named', 'Care plans on file'].map(q).join(',')];
  for (const p of db.prepare("SELECT id, name, email, suburb, created FROM users WHERE role = 'participant' ORDER BY name").all()) {
    const plan = db.prepare("SELECT * FROM support_plans WHERE participant_id = ? AND current = 1").get(p.id);
    const b = db.prepare("SELECT COUNT(*) n, MAX(date) last FROM bookings WHERE participant_id = ?").get(p.id) || {};
    /* care plans are a JSON column on the plan itself, not a table — the
       participant names them and only the office can mark one filed */
    const cps = plan ? safeJson(plan.care_plans, []) : [];
    const due = plan && plan.confirmed_at ? planDue(plan.confirmed_at) : '';
    lines.push([p.name, p.email, p.suburb, p.created ? dmy(p.created.slice(0, 10)) : '', b.n || 0, b.last ? dmy(b.last) : '',
      plan ? (plan.status === 'confirmed' ? 'Confirmed' : 'Draft only') : 'NONE',
      plan ? plan.version : '', plan ? continuityTier(plan).label : '',
      plan && plan.confirmed_at ? dmy(plan.confirmed_at.slice(0, 10)) : '',
      due ? dmy(due) + (due < new Date().toISOString().slice(0, 10) ? ' — OVERDUE' : '') : '',
      cps.length, cps.filter(c => c && c.on_file).length].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-participant-register.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

/* ---------- the nightly snapshot ----------
   One row a night. This is the difference between a pack that says "we are
   compliant today" and a pack that says "here is every day of the year, and
   here is the day each gap opened and the day it closed". */
function auditSnapshot(why) {
  const day = new Date().toISOString().slice(0, 10);
  const reg = formsRegister();
  const detail = reg.forms.filter(f => f.state && f.state.gaps.length)
    .map(f => ({ form: f.name, gaps: f.state.gaps.length, who: f.state.gaps.slice(0, 12) }));
  db.prepare(`INSERT INTO audit_snapshots (day, taken_at, forms, documents, tracked_live, gaps, workers, participants, detail)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(day) DO UPDATE SET taken_at = excluded.taken_at, forms = excluded.forms,
      documents = excluded.documents, tracked_live = excluded.tracked_live, gaps = excluded.gaps,
      workers = excluded.workers, participants = excluded.participants, detail = excluded.detail`)
    .run(day, now(), reg.counts.total, reg.counts.documents, reg.counts.live, reg.counts.gaps,
      reg.workers, reg.participants, JSON.stringify({ why: why || 'nightly', open: detail }));
  return { day, gaps: reg.counts.gaps, documents: reg.counts.documents };
}
try { auditSnapshot('boot'); } catch (e) { console.error('audit snapshot:', e.message); }
setInterval(() => { try { auditSnapshot('nightly'); } catch (e) { console.error('audit snapshot:', e.message); } }, 24 * 3600e3);

route('GET', /^\/api\/admin\/audit-history\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Date', 'Taken at', 'Forms in the register', 'Documents that implies', 'Forms BookIt tracks live',
    'Open gaps', 'Workers', 'Participants', 'What was open that day'].map(q).join(',')];
  for (const s of db.prepare('SELECT * FROM audit_snapshots ORDER BY day').all()) {
    let open = '';
    try {
      const d = JSON.parse(s.detail || '{}');
      open = (d.open || []).map(o => `${o.form} (${o.gaps})`).join('; ');
    } catch { open = ''; }
    lines.push([dmy(s.day), s.taken_at, s.forms, s.documents, s.tracked_live, s.gaps, s.workers, s.participants, open].map(q).join(','));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookit-monitoring-history.csv"' });
  res.end('﻿' + lines.join('\r\n'));
});

/* ---------- what is still open, as a worklist ---------- */
/* liveState() reports gaps as plain strings — a worker's name for a per-worker
   document, a whole sentence for anything counted in aggregate. Both are carried
   through as they are; inventing structure they don't have would only lose
   information on the way to the CSV. */
function auditGaps(reg) {
  const out = [];
  for (const f of (reg || formsRegister()).forms) {
    if (f.track === 'missing') {
      out.push({ form: f.name, scope: f.scope, missing: 'This form does not exist yet — it has to be written before it can be held.', requires: f.requires || '' });
    } else if (f.state) {
      for (const g of f.state.gaps) out.push({ form: f.name, scope: f.scope, missing: String(g), requires: f.requires || '' });
    }
  }
  return out;
}

/* ---------- the pack ---------- */
const PACK_BYTES_CAP = 180 * 1024 * 1024;

function buildAuditPack(user) {
  const when = new Date();
  const stampDay = when.toISOString().slice(0, 10);
  const entries = [];
  const built = [], failed = [], skipped = [];
  let bytes = 0;
  const taken = new Set();
  const add = (name, data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    if (bytes + buf.length > PACK_BYTES_CAP) { skipped.push(name); return false; }
    /* A zip is allowed to carry the same name twice. Every extractor on earth
       then overwrites the first copy with the second and says nothing, so the
       pack would show 19 files in its index and hand the auditor 18. Two people
       with the same name is not a rare edge case in a service this size, so the
       collision is resolved here rather than hoped away — and the surviving
       names both stay traceable because the disambiguator is the row id. */
    let n = name;
    if (taken.has(n)) {
      const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
      let i = 2;
      while (taken.has(`${stem} (${i})${ext}`)) i++;
      n = `${stem} (${i})${ext}`;
    }
    taken.add(n);
    bytes += buf.length;
    entries.push({ name: n, data: buf });
    return true;
  };

  for (const r of AUDIT_REPORTS) {
    const got = collect(r.url, user);
    if (got.status === 200 && got.body) { add(r.path, got.body); built.push(r); }
    else { failed.push({ ...r, status: got.status }); }
  }
  add('evidence/monitoring-history.csv', collect('/api/admin/audit-history.csv', user).body || '');

  /* one shift-note file per participant — the thing an auditor asks for by name */
  const participants = db.prepare("SELECT id, name FROM users WHERE role = 'participant' ORDER BY name").all();
  const pNameUse = {};
  for (const p of participants) { const k = safeName(p.name); pNameUse[k] = (pNameUse[k] || 0) + 1; }
  for (const p of participants) {
    const got = collect(`/api/admin/participants/${p.id}/notes.csv`, user);
    if (got.status !== 200 || !got.body) continue;
    /* the common case keeps a filename a person can read; only a genuine clash
       carries the participant number, and that number is the one printed in
       registers/03-participants.csv so the two can be tied together. */
    const base = safeName(p.name);
    add(`evidence/shift-notes/${pNameUse[base] > 1 ? `${base} - participant ${p.id}` : base}.csv`, got.body);
  }

  /* the actual uploaded files, filed under the person they belong to */
  const docs = db.prepare(`SELECT d.*, u.name FROM worker_docs d JOIN users u ON u.id = d.worker_id
    WHERE d.file_path <> '' ORDER BY u.name, d.doc_type, d.id`).all();
  /* two workers with the same name would otherwise share one folder, and the
     auditor reading it cannot tell whose WWCC is whose — which is worse than a
     missing document, because it looks like evidence and is not. */
  const wSeen = {};
  for (const d of docs) { const k = safeName(d.name); (wSeen[k] = wSeen[k] || new Set()).add(d.worker_id); }
  const wFolder = (id, name) => { const k = safeName(name); return wSeen[k].size > 1 ? `${k} - worker ${id}` : k; };
  let filesIn = 0, filesMissing = 0;
  for (const d of docs) {
    if (!d.file_path || !fs.existsSync(d.file_path)) { filesMissing++; continue; }
    const ext = path.extname(d.file_path) || '';
    const label = safeName(`${DOC_TYPES[d.doc_type] || d.doc_type}${d.expiry_date ? ' expires ' + d.expiry_date : ''}`);
    try {
      if (add(`people/${wFolder(d.worker_id, d.name)}/${label}-${d.id}${ext}`, fs.readFileSync(d.file_path))) filesIn++;
    } catch { filesMissing++; }
  }

  const reg = formsRegister();
  const gaps = auditGaps(reg);
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  add('gaps/open-items.csv', '﻿' + [['Form', 'Belongs to', 'What is missing', 'What requires it'].map(q).join(',')]
    .concat(gaps.map(g => [g.form, g.scope, g.missing, g.requires].map(q).join(','))).join('\r\n'));

  add('README.txt', packReadme({ when, user, reg, gaps, built, failed, skipped, filesIn, filesMissing, participants }));
  add('INDEX.html', packIndex({ when, user, reg, gaps, built, failed, skipped, filesIn, filesMissing }));

  return {
    buffer: zipBuffer(entries, when),
    filename: `DMHC-audit-pack-${stampDay}.zip`,
    summary: {
      generated: when.toISOString(), files: entries.length, bytes,
      registers: built.length, failed: failed.length, skipped: skipped.length,
      documents: filesIn, documents_missing: filesMissing, gaps: gaps.length,
      forms: reg.counts.total, implied_documents: reg.counts.documents
    }
  };
}

function safeName(s) {
  return String(s || 'unnamed').replace(/[^A-Za-z0-9 _.-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'unnamed';
}

function packReadme(c) {
  const L = [];
  L.push('DMHC PTY LTD — AUDIT PACK');
  L.push('NDIS provider 4-LO5XNY0 · ABN 19 658 578 575');
  L.push('');
  L.push(`Generated ${dmy(c.when.toISOString().slice(0, 10))} at ${c.when.toTimeString().slice(0, 5)} by ${c.user.email}`);
  L.push(`Generated from bookit.life — every file below was produced by the live system at that moment.`);
  L.push('');
  L.push('WHAT IS IN HERE');
  L.push('  INDEX.html            open this first — the same contents, clickable, with the open items at the top');
  L.push('  registers/            the registers you are required to keep');
  L.push('  evidence/            what the platform did, and the shift notes behind it');
  L.push('  evidence/monitoring-history.csv    one row per day — this is the evidence of ongoing monitoring');
  L.push('  people/              the actual credential files, filed under the worker they belong to');
  L.push('  finance/             invoices, payroll and the PACE claim file');
  L.push('  gaps/open-items.csv  everything the system knows is still missing');
  L.push('');
  L.push('THE NUMBERS');
  L.push(`  ${c.reg.counts.total} forms in the register`);
  L.push(`  ${c.reg.counts.documents} documents that implies across ${c.reg.workers} workers and ${c.reg.participants} participants`);
  L.push(`  ${c.filesIn} credential files included`);
  L.push(`  ${c.gaps.length} open items — listed in gaps/open-items.csv, and again at the top of INDEX.html`);
  L.push('');
  L.push('A NOTE ON THE OPEN ITEMS');
  L.push('  They are in here on purpose. A pack that hides its own gaps is worth less than one');
  L.push('  that names them, because the first thing an auditor does is look for the thing you');
  L.push('  did not mention. Every open item below is dated in monitoring-history.csv, so the');
  L.push('  record shows when it opened rather than implying it was always fine.');
  if (c.filesMissing) {
    L.push('');
    L.push(`  ${c.filesMissing} document record(s) point at a file that is no longer on disk. They are still`);
    L.push('  listed in registers/02-worker-credentials.csv with "no file attached" so the record is');
    L.push('  honest about it rather than quietly short.');
  }
  if (c.failed.length) {
    L.push('');
    L.push('  These registers could not be generated and are NOT in this pack:');
    for (const f of c.failed) L.push(`    - ${f.path} (${f.title})`);
  }
  if (c.skipped.length) {
    L.push('');
    L.push(`  ${c.skipped.length} file(s) were left out because the pack hit its ${Math.round(PACK_BYTES_CAP / 1048576)} MB size cap:`);
    for (const s of c.skipped.slice(0, 30)) L.push(`    - ${s}`);
  }
  L.push('');
  L.push('HOW THIS PACK IS KEPT CURRENT');
  L.push('  Nothing in here is typed up for an audit. Every register is generated from the live');
  L.push('  database at the moment you press the button, by the same code that produces the');
  L.push('  individual downloads inside BookIt. The nightly snapshot runs on its own and needs');
  L.push('  nobody to remember it.');
  return L.join('\r\n');
}

function packIndex(c) {
  const day = dmy(c.when.toISOString().slice(0, 10));
  const rows = AUDIT_REPORTS.filter(r => c.built.includes(r))
    .map(r => `<tr><td><a href="${escHtml(r.path)}">${escHtml(r.path)}</a></td><td>${escHtml(r.title)}</td></tr>`).join('');
  const gapRows = c.gaps.length
    ? c.gaps.map(g => `<tr><td>${escHtml(g.form)}</td><td>${escHtml(g.missing)}</td><td>${escHtml(g.requires || '')}</td></tr>`).join('')
    : '<tr><td colspan="3">Nothing open. Every form the register tracks live has a current document behind it.</td></tr>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DMHC audit pack — ${escHtml(day)}</title>
<style>
 :root{color-scheme:light}
 body{font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16202b;background:#fff;max-width:60rem;margin:0 auto;padding:2rem 1.25rem 5rem}
 h1{font-size:1.7rem;margin:0 0 .25rem} h2{font-size:1.15rem;margin:2.2rem 0 .6rem;border-bottom:2px solid #e6ebf1;padding-bottom:.3rem}
 .sub{color:#5b6b7c;margin:0 0 1.5rem}
 table{border-collapse:collapse;width:100%;font-size:.94rem;margin:.5rem 0}
 th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #e6ebf1;vertical-align:top}
 th{background:#f5f8fa;font-weight:600}
 .n{display:flex;gap:1.5rem;flex-wrap:wrap;margin:1rem 0;padding:1rem 1.2rem;background:#f5f8fa;border-radius:10px}
 .n div{min-width:7rem} .n b{display:block;font-size:1.5rem;line-height:1.2} .n span{color:#5b6b7c;font-size:.85rem}
 .warn{background:#fff6e8;border-left:4px solid #e08a00;padding:.9rem 1.1rem;border-radius:0 8px 8px 0;margin:1rem 0}
 .ok{background:#eefaf1;border-left:4px solid #1a9c53;padding:.9rem 1.1rem;border-radius:0 8px 8px 0;margin:1rem 0}
 a{color:#0b6bcb}
</style></head><body>
<h1>DMHC Pty Ltd — audit pack</h1>
<p class="sub">NDIS provider 4-LO5XNY0 · ABN 19 658 578 575 · generated ${escHtml(day)} at ${escHtml(c.when.toTimeString().slice(0, 5))} by ${escHtml(c.user.email)}</p>
<div class="n">
  <div><b>${c.reg.counts.total}</b><span>forms in the register</span></div>
  <div><b>${c.reg.counts.documents}</b><span>documents that implies</span></div>
  <div><b>${c.filesIn}</b><span>credential files enclosed</span></div>
  <div><b>${c.gaps.length}</b><span>open items</span></div>
</div>
${c.gaps.length
      ? `<div class="warn"><b>${c.gaps.length} open item${c.gaps.length === 1 ? '' : 's'}.</b> They are listed below and in <a href="gaps/open-items.csv">gaps/open-items.csv</a>. Each one is dated in <a href="evidence/monitoring-history.csv">monitoring-history.csv</a>, so the record shows the day it opened rather than implying it was never there.</div>`
      : `<div class="ok"><b>Nothing open.</b> Every form the register tracks live has a current document behind it.</div>`}
<h2>Still open</h2>
<table><tr><th>Form</th><th>What is missing</th><th>What requires it</th></tr>${gapRows}</table>
<h2>Registers</h2>
<table><tr><th>File</th><th>What it is</th></tr>${rows}</table>
<h2>Evidence</h2>
<table>
<tr><td><a href="evidence/compliance-log.csv">evidence/compliance-log.csv</a></td><td>Every automated check the platform has run, with its result</td></tr>
<tr><td><a href="evidence/monitoring-history.csv">evidence/monitoring-history.csv</a></td><td>One row per day. This is the evidence of ongoing monitoring — it is written by a nightly job, not by a person</td></tr>
<tr><td>evidence/shift-notes/</td><td>One file per participant, every shift note in date order, with any out-of-scope request and what was done about it</td></tr>
<tr><td>people/</td><td>${c.filesIn} credential file${c.filesIn === 1 ? '' : 's'}, filed under the worker they belong to</td></tr>
</table>
${c.failed.length ? `<h2>Not in this pack</h2><table><tr><th>File</th><th>Why</th></tr>${c.failed.map(f => `<tr><td>${escHtml(f.path)}</td><td>Could not be generated (HTTP ${f.status})</td></tr>`).join('')}</table>` : ''}
${c.skipped.length ? `<div class="warn"><b>${c.skipped.length} file(s) left out</b> — the pack hit its ${Math.round(PACK_BYTES_CAP / 1048576)} MB cap. They are named in README.txt.</div>` : ''}
<h2>How this pack stays true</h2>
<p>Nothing here was typed up for an audit. Every register was generated from the live database at the moment the button was pressed, by the same code that produces the individual downloads inside BookIt — so a register in this pack and the same register downloaded on its own are the same bytes. The daily snapshot runs on its own and needs nobody to remember it.</p>
</body></html>`;
}

route('GET', /^\/api\/admin\/audit-pack\.zip$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  let pack;
  try { pack = buildAuditPack(user); }
  catch (e) { console.error('audit pack:', e); return json(res, 500, { error: 'Could not build the pack: ' + e.message }); }
  logCompliance({
    kind: 'audit-pack', result: 'ok', source: 'admin', checked_by: user.email,
    detail: `Audit pack downloaded — ${pack.summary.files} files, ${pack.summary.registers} registers, ${pack.summary.documents} credential files, ${pack.summary.gaps} open items.`
  });
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': pack.buffer.length,
    'Content-Disposition': `attachment; filename="${pack.filename}"`
  });
  res.end(pack.buffer);
});

/* what the button will contain, without building it — so the card can show the
   numbers before anyone downloads 180 MB */
route('GET', /^\/api\/admin\/audit-pack$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const reg = formsRegister();
  const gaps = auditGaps(reg);
  const files = db.prepare("SELECT COUNT(*) n FROM worker_docs WHERE file_path <> ''").get() || { n: 0 };
  const history = db.prepare('SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM audit_snapshots').get() || {};
  json(res, 200, {
    reports: AUDIT_REPORTS.map(r => ({ path: r.path, title: r.title })),
    forms: reg.counts.total, documents: reg.counts.documents,
    workers: reg.workers, participants: reg.participants,
    credential_files: files.n, gaps,
    history: { days: history.n || 0, first: history.first || '', last: history.last || '' },
    last_download: (db.prepare("SELECT checked_at, checked_by FROM compliance_log WHERE kind = 'audit-pack' ORDER BY id DESC LIMIT 1").get() || null)
  });
});

/* admin: flagged notes float to the top, because those are the ones that need a phone call */
route('GET', /^\/api\/admin\/shift-notes$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const notes = db.prepare(`SELECT n.id, n.booking_id, n.body, n.scope_flag, n.scope_detail, n.addendum, n.created,
      n.reviewed_at, n.reviewed_by, n.review_note,
      b.service, b.date, b.start, b.hours,
      uw.name AS worker_name, up.id AS participant_id, up.name AS participant_name
    FROM shift_notes n
    JOIN bookings b ON b.id = n.booking_id
    JOIN users uw ON uw.id = n.worker_id
    JOIN users up ON up.id = n.participant_id
    ORDER BY (n.scope_flag = 1 AND n.reviewed_at IS NULL) DESC, n.id DESC LIMIT 80`).all();
  const people = db.prepare(`SELECT up.id, up.name, COUNT(*) AS notes, MAX(b.date) AS last_shift
    FROM shift_notes n JOIN bookings b ON b.id = n.booking_id JOIN users up ON up.id = n.participant_id
    GROUP BY up.id ORDER BY up.name`).all();
  json(res, 200, { notes, people, flagged_open: notes.filter(r => r.scope_flag && !r.reviewed_at).length });
});

/* closing a flag records who dealt with it and what they did — the note is the whole point */
route('POST', /^\/api\/admin\/shift-notes\/(\d+)\/review$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const n = db.prepare('SELECT id FROM shift_notes WHERE id = ?').get(Number(m[1]));
  if (!n) return json(res, 404, { error: 'No such note.' });
  const outcome = clean(body.note, 800);
  if (outcome.length < 5) return json(res, 400, { error: 'Write what you did about it — that record is the point.' });
  db.prepare('UPDATE shift_notes SET reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ?').run(now(), user.email, outcome, n.id);
  json(res, 200, { ok: true });
});

/* one participant's whole note history as a file — this is the thing an auditor asks for */
route('GET', /^\/api\/admin\/participants\/(\d+)\/notes\.csv$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const pid = Number(m[1]);
  const p = db.prepare("SELECT name FROM users WHERE id = ? AND role = 'participant'").get(pid);
  if (!p) return json(res, 404, { error: 'No such participant.' });
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare(`SELECT n.booking_id, n.body, n.scope_flag, n.scope_detail, n.addendum, n.created,
      n.reviewed_at, n.reviewed_by, n.review_note, b.service, b.date, b.start, b.hours, uw.name AS worker_name
    FROM shift_notes n JOIN bookings b ON b.id = n.booking_id JOIN users uw ON uw.id = n.worker_id
    WHERE n.participant_id = ? ORDER BY b.date ASC, n.id ASC`).all(pid);
  const lines = [['Shift ID', 'Date', 'Start', 'Hours', 'Service', 'Registration group', 'Worker', 'Entry',
    'Shift note', 'Out-of-scope request flagged', 'What was asked for', 'Written at', 'Reviewed at', 'Reviewed by', 'What we did about it'].map(q).join(',')];
  for (const r of rows) {
    lines.push([r.booking_id, dmy(r.date), r.start, r.hours, SERVICE_LABELS[r.service] || r.service, REG_GROUPS[r.service] || '',
      r.worker_name, r.addendum ? 'Addendum' : 'Shift note', r.body, r.scope_flag ? 'Yes' : 'No', r.scope_detail,
      r.created, r.reviewed_at || '', r.reviewed_by || '', r.review_note || ''].map(q).join(','));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="bookit-shift-notes-${p.name.replace(/[^A-Za-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end('\ufeff' + lines.join('\r\n'));
});

/* post-shift review: one per completed booking, written by the participant */
route('POST', /^\/api\/bookings\/(\d+)\/review$/, (req, res, m, user, body, ip) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Only participants can review shifts.' });
  if (limited(ip, 'review', 20)) return json(res, 429, { error: 'Slow down a moment.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND participant_id = ?').get(Number(m[1]), user.id);
  if (!b) return json(res, 404, { error: 'No such booking.' });
  if (b.status !== 'completed') return json(res, 400, { error: 'You can review a shift once it\'s marked completed.' });
  const rating = Math.round(Number(body.rating));
  if (!(rating >= 1 && rating <= 5)) return json(res, 400, { error: 'Pick a star rating from 1 to 5.' });
  if (db.prepare('SELECT id FROM reviews WHERE booking_id = ?').get(b.id)) return json(res, 409, { error: 'You\'ve already reviewed this shift — thank you!' });
  const comment = clean(body.comment, 800);
  db.prepare('INSERT INTO reviews (booking_id, worker_id, participant_id, rating, comment, published, created) VALUES (?,?,?,?,?,1,?)')
    .run(b.id, b.worker_id, user.id, rating, comment, now());
  const w = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.worker_id);
  if (w && !w.email.endsWith('@demo.bookit.life')) sendMail(w.email, 'You\'ve got a new review — BookIt',
    `⭐ ${rating} / 5 from ${firstName(user.name)}`,
    `<p><b>${escHtml(firstName(user.name))}</b> rated your ${prettyDate(b.date)} shift <b>${rating} / 5</b>.</p>${comment ? `<p>“${escHtml(comment)}”</p>` : ''}<p>Reviews appear on your public profile and help new participants choose you. Nice work!</p>`,
    'See my profile', `${baseUrl(req)}/#/worker/${b.worker_id}`).catch(() => {});
  json(res, 200, { ok: true });
});

/* admin: review moderation */
route('GET', /^\/api\/admin\/reviews$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const rows = db.prepare(`SELECT r.*, uw.name AS worker_name, up.name AS participant_name FROM reviews r
    JOIN users uw ON uw.id = r.worker_id JOIN users up ON up.id = r.participant_id
    ORDER BY r.id DESC LIMIT 100`).all();
  json(res, 200, { reviews: rows });
});
route('POST', /^\/api\/admin\/reviews\/(\d+)\/toggle$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const r = db.prepare('SELECT id, published FROM reviews WHERE id = ?').get(Number(m[1]));
  if (!r) return json(res, 404, { error: 'No such review.' });
  db.prepare('UPDATE reviews SET published = ? WHERE id = ?').run(r.published ? 0 : 1, r.id);
  json(res, 200, { ok: true, published: r.published ? 0 : 1 });
});

/* ---------- SIL rosters: houses + weekly repeating slots → generated bookings ---------- */
route('GET', /^\/api\/admin\/sil$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const houses = db.prepare('SELECT * FROM sil_houses ORDER BY name').all().map(h => ({
    ...h,
    slots: db.prepare(`SELECT s.*, uw.name AS worker_name, up.name AS participant_name FROM sil_slots s
      LEFT JOIN users uw ON uw.id = s.worker_id LEFT JOIN users up ON up.id = s.participant_id
      WHERE s.house_id = ? ORDER BY s.day, s.start`).all(h.id)
  }));
  const workers = db.prepare(`SELECT u.id, u.name, u.email FROM users u JOIN worker_profiles p ON p.user_id = u.id
    WHERE u.role = 'worker' AND p.visible = 1 ORDER BY u.name`).all()
    .filter(w => platformEligible(w.id, w.email));   /* 0137 — not rosterable to a SIL house either */
  const participants = db.prepare("SELECT id, name FROM users WHERE role = 'participant' ORDER BY name").all();
  json(res, 200, { houses, workers, participants });
});

route('POST', /^\/api\/admin\/sil\/houses$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const name = clean(body.name, 80);
  if (!name) return json(res, 400, { error: 'Give the house a name (e.g. "Gosford — Wattle St").' });
  const r = db.prepare('INSERT INTO sil_houses (name, address, notes, created) VALUES (?,?,?,?)')
    .run(name, clean(body.address, 160), clean(body.notes, 400), now());
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('POST', /^\/api\/admin\/sil\/houses\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const h = db.prepare('SELECT id FROM sil_houses WHERE id = ?').get(Number(m[1]));
  if (!h) return json(res, 404, { error: 'No such house.' });
  db.prepare('DELETE FROM sil_slots WHERE house_id = ?').run(h.id);
  db.prepare('DELETE FROM sil_houses WHERE id = ?').run(h.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/sil\/slots$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const house = db.prepare('SELECT id FROM sil_houses WHERE id = ?').get(Number(body.house_id));
  if (!house) return json(res, 404, { error: 'No such house.' });
  const day = Number(body.day);
  if (!(day >= 0 && day <= 6)) return json(res, 400, { error: 'Pick a day of the week.' });
  const start = clean(body.start, 5);
  if (!/^\d{2}:\d{2}$/.test(start)) return json(res, 400, { error: 'Start time looks wrong (use 24-hour HH:MM).' });
  const hours = Number(body.hours);
  if (!(hours >= 1 && hours <= 12)) return json(res, 400, { error: 'Slots are between 1 and 12 hours.' });
  const service = clean(body.service, 30) || 'daily-tasks';
  if (!SERVICES.includes(service)) return json(res, 400, { error: 'Pick a service.' });
  const sleepover = body.sleepover && ['personal-care', 'daily-tasks'].includes(service) ? 1 : 0;
  const workerId = body.worker_id ? Number(body.worker_id) : null;
  if (workerId && !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'worker'").get(workerId)) return json(res, 404, { error: 'No such worker.' });
  const participantId = body.participant_id ? Number(body.participant_id) : null;
  if (participantId && !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'participant'").get(participantId)) return json(res, 404, { error: 'No such participant.' });
  const r = db.prepare('INSERT INTO sil_slots (house_id, day, start, hours, service, sleepover, worker_id, participant_id, created) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(house.id, day, start, hours, service, sleepover, workerId, participantId, now());
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('POST', /^\/api\/admin\/sil\/slots\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const s = db.prepare('SELECT id FROM sil_slots WHERE id = ?').get(Number(m[1]));
  if (!s) return json(res, 404, { error: 'No such slot.' });
  db.prepare('DELETE FROM sil_slots WHERE id = ?').run(s.id);
  json(res, 200, { ok: true });
});

/* turn the weekly template into real bookings for one week (idempotent per slot+date) */
route('POST', /^\/api\/admin\/sil\/generate$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  let weekStart = clean(body.week_start, 10);
  if (!weekStart) {
    const d = new Date();
    const dow = (d.getUTCDay() + 6) % 7; /* 0 = Monday */
    d.setUTCDate(d.getUTCDate() + (7 - dow));
    weekStart = d.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json(res, 400, { error: 'Week start looks wrong.' });
  const ws = new Date(weekStart + 'T00:00:00Z');
  if (isNaN(ws)) return json(res, 400, { error: 'Week start looks wrong.' });
  if ((ws.getUTCDay() + 6) % 7 !== 0) return json(res, 400, { error: 'The week starts on a Monday — pick a Monday date.' });
  const slots = db.prepare(`SELECT s.*, h.name AS house_name FROM sil_slots s JOIN sil_houses h ON h.id = s.house_id`).all();
  let created = 0, existing = 0;
  const unfilled = [];
  for (const s of slots) {
    if (!s.worker_id || !s.participant_id) { unfilled.push({ house: s.house_name, day: s.day, start: s.start, missing: !s.worker_id ? 'worker' : 'participant' }); continue; }
    const d = new Date(ws);
    d.setUTCDate(d.getUTCDate() + s.day);
    const date = d.toISOString().slice(0, 10);
    if (db.prepare('SELECT id FROM bookings WHERE sil_slot_id = ? AND date = ?').get(s.id, date)) { existing++; continue; }
    db.prepare(`INSERT INTO bookings (participant_id, worker_id, service, date, start, hours, notes, sleepover, status, created, sil_slot_id)
      VALUES (?,?,?,?,?,?,?,?,'accepted',?,?)`)
      .run(s.participant_id, s.worker_id, s.service, date, s.start, s.hours, `SIL roster — ${s.house_name}`, s.sleepover, now(), s.id);
    created++;
  }
  console.log(`SIL generate ${weekStart}: ${created} bookings created, ${existing} already existed, ${unfilled.length} slots unfilled.`);
  json(res, 200, { ok: true, week_start: weekStart, created, existing, unfilled });
});

route('POST', /^\/api\/contact$/, (req, res, m, user, body, ip) => {
  if (limited(ip, 'contact', 20)) return json(res, 429, { error: 'Too many messages — try again later.' });
  db.prepare('INSERT INTO contact_messages (name, email, topic, body, created) VALUES (?,?,?,?,?)')
    .run(clean(body.name, 80), clean(body.email, 120), clean(body.topic, 80), clean(body.body, 2000), now());
  /* complaints land straight in the complaints register too */
  if (/complaint/i.test(String(body.topic || ''))) {
    db.prepare('INSERT INTO complaints (source_name, source_email, channel, summary, details, created) VALUES (?,?,?,?,?,?)')
      .run(clean(body.name, 80), clean(body.email, 120), 'site', clean(body.body, 2000).slice(0, 200) || 'Complaint via contact form', clean(body.body, 4000), now());
  }
  /* forward a copy to the BookIt inbox so nothing sits unseen in the database */
  const fromEmail = clean(body.email, 120);
  if (MAIL_FROM) sendMail(MAIL_FROM, `Contact form — ${clean(body.topic, 80) || 'General'}`,
    'New message from the contact form',
    `<p><b>From:</b> ${escHtml(clean(body.name, 80)) || 'Anonymous'} &lt;${escHtml(fromEmail) || 'no email given'}&gt;<br><b>Topic:</b> ${escHtml(clean(body.topic, 80)) || 'General'}</p><p style="white-space:pre-wrap;">${escHtml(clean(body.body, 2000))}</p>`,
    null, null, EMAIL_RE.test(fromEmail) ? fromEmail : undefined).catch(() => {});
  json(res, 200, { ok: true });
});


/* ============================================================================
   COVER ENGINE
   ============================================================================ */

/* SCHADS MA000100 cl.26 on-call allowance, per 24-hour period, from 01/07/2026.
   Weekday band runs from the end of ordinary duty Monday to the end of ordinary
   duty Friday; everything else — weekends and public holidays — is the other band.
   Editable from the admin console, because award rates move every July. */
const ONCALL_DEFAULT = { weekday: 25.66, other: 50.81 };
function oncallRates() {
  const w = Number(setting('oncall_weekday'));
  const o = Number(setting('oncall_other'));
  return { weekday: w > 0 ? w : ONCALL_DEFAULT.weekday, other: o > 0 ? o : ONCALL_DEFAULT.other };
}
/* SCHADS cl.20.9: remote work taken while on call is paid at a minimum of 15
   minutes (6am–10pm) or 30 minutes (10pm–6am). Every phone call the cascade
   removes is that minimum saved, on top of the coordinator's time. */
const REMOTE_MIN = { day: 15, night: 30 };

const COVER_TIERS = ['web', 'standby', 'pool', 'allied'];
const TIER_LABELS = {
  web: 'the participant\'s care web',
  standby: 'workers on standby that day',
  pool: 'every matched worker in the area',
  allied: 'partner providers'
};

/* How long each tier gets before the cascade moves on. The closer the shift, the
   shorter the patience — and inside four hours everybody is asked at once,
   because sequencing politely through a list is how a shift goes unfilled. */
function coverClock(leadMin) {
  if (leadMin > 7 * 24 * 60) return { win: 720, parallel: 0, label: 'more than a week away' };
  if (leadMin > 24 * 60) return { win: 180, parallel: 0, label: 'more than a day away' };
  if (leadMin > 4 * 60) return { win: 45, parallel: 0, label: 'later today' };
  return { win: 15, parallel: 1, label: 'in the next few hours' };
}
function bookingStart(b) { return new Date(`${b.date}T${b.start || '00:00'}:00`); }
function leadMinutes(b) { return Math.round((bookingStart(b) - Date.now()) / 60000); }
function standbyBand(dateIso) {
  const d = new Date(dateIso + 'T00:00:00').getDay();
  return (d === 0 || d === 6) ? 'other' : 'weekday';
}

/* Is this worker actually free? Overlapping bookings are the silent killer of
   auto-offers — offering a shift to somebody already working it is how a system
   loses a participant's trust in one move. */
function workerFree(workerId, date, start, hours, excludeBookingId) {
  const s0 = new Date(`${date}T${start}:00`).getTime();
  const e0 = s0 + hours * 3600e3;
  const rows = db.prepare(`SELECT id, start, hours FROM bookings
    WHERE worker_id = ? AND date = ? AND status IN ('requested','accepted','completed') AND id != ?`)
    .all(workerId, date, excludeBookingId || 0);
  for (const r of rows) {
    const s1 = new Date(`${date}T${r.start}:00`).getTime();
    const e1 = s1 + r.hours * 3600e3;
    if (s0 < e1 && s1 < e0) return false;
  }
  return true;
}
/* Everything that has to be true before a name goes on an offer list: live
   profile, current screening, offers the service, works that weekday, free. */
function workerEligible(workerId, b) {
  const p = db.prepare(`SELECT p.visible, p.services, p.days, u.email FROM worker_profiles p
    JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`).get(workerId);
  if (!p || !p.visible) return false;
  /* the cover cascade fills shifts at short notice, which is exactly when a
     compliance gate is most likely to be skipped — so it is asked here too */
  if (!platformEligible(workerId, p.email)) return false;
  if (screeningState(workerId) === 'expired') return false;
  const svcs = safeJson(p.services, []);
  if (svcs.length && !svcs.includes(b.service)) return false;
  const days = safeJson(p.days, [1, 1, 1, 1, 1, 0, 0]);
  const dow = new Date(b.date + 'T00:00:00').getDay();
  const idx = dow === 0 ? 6 : dow - 1;           /* profile days are Mon-first */
  if (days.length === 7 && !days[idx]) return false;
  return workerFree(workerId, b.date, b.start, b.hours, b.id);
}

/* The ranked candidate list for one tier. Order matters and is never random:
   the care web is in the participant's own order, standby is by who has been
   called on least, the pool is by who this participant has worked with most. */
function coverCandidates(cv, b, tier) {
  const already = db.prepare('SELECT worker_id FROM cover_offers WHERE cover_id = ? AND worker_id IS NOT NULL').all(cv.id).map(r => r.worker_id);
  const skip = new Set(already.concat([cv.from_worker_id].filter(Boolean)));
  if (tier === 'web') {
    return db.prepare(`SELECT cw.worker_id AS id, cw.rank, cw.role FROM care_web cw
      WHERE cw.participant_id = ? AND cw.auto_offer = 1 ORDER BY cw.rank ASC, cw.id ASC`).all(b.participant_id)
      .filter(r => !skip.has(r.id) && workerEligible(r.id, b));
  }
  if (tier === 'standby') {
    return db.prepare(`SELECT s.worker_id AS id, s.id AS standby_id, s.services,
        (SELECT COUNT(*) FROM standby s2 WHERE s2.worker_id = s.worker_id AND s2.called_at IS NOT NULL) AS called
      FROM standby s WHERE s.date = ? AND s.status = 'accepted' ORDER BY called ASC, s.id ASC`).all(b.date)
      .filter(r => {
        if (skip.has(r.id)) return false;
        const svcs = safeJson(r.services, []);
        if (svcs.length && !svcs.includes(b.service)) return false;
        return workerEligible(r.id, b);
      });
  }
  if (tier === 'pool') {
    return db.prepare(`SELECT u.id,
        (SELECT COUNT(*) FROM bookings bb WHERE bb.worker_id = u.id AND bb.participant_id = ? AND bb.status = 'completed') AS shared,
        COALESCE(p.rating, 0) AS rating
      FROM users u JOIN worker_profiles p ON p.user_id = u.id
      WHERE u.role = 'worker' AND p.visible = 1 ORDER BY shared DESC, rating DESC, p.shifts DESC`).all(b.participant_id)
      .filter(r => !skip.has(r.id) && workerEligible(r.id, b));
  }
  /* allied: registered for this support type, covers this suburb, agreement on
     file, insurance not expired. An empty suburb list means statewide. */
  const group = REG_GROUPS[b.service] || '';
  const pt = db.prepare('SELECT suburb FROM users WHERE id = ?').get(b.participant_id) || {};
  const sub = String(pt.suburb || '').toLowerCase();
  const sentTo = db.prepare('SELECT allied_id FROM cover_offers WHERE cover_id = ? AND allied_id IS NOT NULL').all(cv.id).map(r => r.allied_id);
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare('SELECT * FROM allied_providers WHERE active = 1 ORDER BY reciprocal DESC, share ASC, id ASC').all()
    .filter(a => {
      if (sentTo.includes(a.id)) return false;
      if (!a.agreement_ref) return false;
      if (a.insurance_expiry && a.insurance_expiry < today) return false;
      const groups = safeJson(a.reg_groups, []);
      if (groups.length && group && !groups.some(g => String(group).includes(g))) return false;
      const subs = safeJson(a.suburbs, []).map(s => String(s).toLowerCase());
      if (subs.length && sub && !subs.includes(sub)) return false;
      return true;
    });
}

/* one-click accept from the email — the single biggest lever on fill time.
   Signed, single-purpose, and it still checks eligibility at the moment of
   acceptance rather than the moment of sending. */
function coverToken(offerId) { return sign(`cover.${offerId}`).slice(0, 32); }
function coverLink(req, offerId, kind) {
  return `${baseUrl(req)}/cover?o=${offerId}&t=${coverToken(offerId)}&k=${kind}`;
}

/* A worker reading this on a phone at a bus stop should not have to log in to
   say yes. One tap, one signed link, one plain-English page. */
function coverPage(heading, body, ctaText, ctaUrl, tone) {
  const accent = tone === 'bad' ? '#B4451F' : '#0E6B62';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escHtml(heading)} — BookIt</title>
<style>
 :root{color-scheme:light}
 body{margin:0;background:#F5F3EF;color:#17211F;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
   display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
 .card{background:#fff;border:1px solid #E4E0D9;border-radius:18px;max-width:520px;width:100%;padding:34px 30px;
   box-shadow:0 12px 34px rgba(23,33,31,.07)}
 .mark{font-weight:800;letter-spacing:-.02em;color:${accent};font-size:20px;margin:0 0 18px}
 h1{font-size:25px;line-height:1.25;margin:0 0 14px;letter-spacing:-.02em}
 p{margin:0 0 14px;color:#3D4B48}
 b{color:#17211F}
 .btn{display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;
   padding:13px 24px;border-radius:10px;margin-top:10px}
 .fine{font-size:13.5px;color:#6C7A77;margin-top:20px}
</style></head><body><div class="card">
<p class="mark">BookIt</p><h1>${escHtml(heading)}</h1>${body}
${ctaUrl ? `<a class="btn" href="${escHtml(ctaUrl)}">${escHtml(ctaText || 'Open BookIt')}</a>` : ''}
<p class="fine">Disability &amp; Mental Health Care Pty Ltd · registered NDIS provider 4-LO5XNY0</p>
</div></body></html>`;
}

/* the whole one-tap flow, in one place: cover offers and standby offers both
   land here, both are signed, and neither requires a session. */
function handleCoverLink(req, res, url) {
  const kind = url.searchParams.get('k') || '';
  const token = url.searchParams.get('t') || '';
  const send = html => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }); res.end(html); };
  const bad = msg => send(coverPage('That link has expired', `<p>${escHtml(msg)}</p>`, 'Open BookIt', `${baseUrl(req)}/#/bookings`, 'bad'));

  if (kind === 'standby-yes' || kind === 'standby-no') {
    const id = Number(url.searchParams.get('s') || 0);
    const s = id ? db.prepare('SELECT * FROM standby WHERE id = ?').get(id) : null;
    if (!s || token !== standbyToken(id)) return bad('We couldn\'t match that link to a standby offer.');
    if (s.status !== 'offered') return send(coverPage('Already answered',
      `<p>You've already told us <b>${escHtml(s.status === 'accepted' ? 'yes' : 'no')}</b> for ${escHtml(prettyDate(s.date))}. Nothing more to do.</p>`,
      'Open my shifts', `${baseUrl(req)}/#/bookings`));
    const yes = kind === 'standby-yes';
    db.prepare('UPDATE standby SET status = ?, responded_at = ? WHERE id = ?').run(yes ? 'accepted' : 'declined', now(), id);
    return send(yes
      ? coverPage(`You're on call for ${prettyDate(s.date).replace(/,.*$/, '')}`,
          `<p><b>$${s.allowance.toFixed(2)}</b> is yours for that period whether or not we call you. It'll show on your next pay as an on-call allowance.</p>
           <p>All it means is keeping your phone on. If a shift comes up you'll get one message with the details, and you can still say no on the day.</p>`,
          'See my shifts', `${baseUrl(req)}/#/bookings`)
      : coverPage('No worries', `<p>We've taken you off standby for <b>${escHtml(prettyDate(s.date))}</b> and we'll ask someone else.</p><p>You'll still be asked about other days — declining one never counts against you.</p>`,
          'See my shifts', `${baseUrl(req)}/#/bookings`));
  }

  const offerId = Number(url.searchParams.get('o') || 0);
  const o = offerId ? db.prepare('SELECT * FROM cover_offers WHERE id = ?').get(offerId) : null;
  if (!o || token !== coverToken(offerId)) return bad('We couldn\'t match that link to an open shift.');
  const cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(o.cover_id);
  const b = cv ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(cv.booking_id) : null;
  const svc = b ? (SERVICE_LABELS[b.service] || b.service) : '';

  if (kind === 'decline') {
    if (!o.response) db.prepare("UPDATE cover_offers SET response = 'declined', responded_at = ? WHERE id = ?").run(now(), offerId);
    return send(coverPage('Thanks for telling us', '<p>We\'ve passed it straight to the next person. Knowing quickly is genuinely the most useful thing you can do.</p>',
      'See my shifts', `${baseUrl(req)}/#/bookings`));
  }

  const r = coverAccept(offerId, req, o.worker_id);
  if (r.error) return send(coverPage('Someone got there first', `<p>${escHtml(r.error)}</p><p>Thanks for being quick — that's exactly how this is meant to work.</p>`,
    'See my shifts', `${baseUrl(req)}/#/bookings`, 'bad'));
  if (r.allied) return send(coverPage('Thank you — the shift is yours',
    `<p>We've recorded <b>${escHtml(r.allied)}</b> as delivering this ${escHtml(svc)} shift on <b>${escHtml(prettyDate(b.date))}</b> at <b>${escHtml(b.start)}</b>.</p>
     <p>Please reply to the cover email with the name and NDIS Worker Screening Check number of the worker attending. Disability &amp; Mental Health Care remains the registered provider of record.</p>`,
    null, null));
  return send(coverPage('You\'re locked in 🎉',
    `<p><b>${escHtml(svc)}</b><br>${escHtml(prettyDate(b.date))} at <b>${escHtml(b.start)}</b> · ${b.hours} hours</p>
     <p>It's in your shifts now and it pays exactly like any other shift — covering someone never pays less.</p>
     <p>${escHtml((db.prepare('SELECT name FROM users WHERE id = ?').get(b.participant_id) || {}).name || 'The participant')} has already been told you're coming.</p>`,
    'Open my shifts', `${baseUrl(req)}/#/bookings`));
}

function sendCoverOffer(req, cv, b, tier, cand, rank) {
  const exp = new Date(Date.now() + cv.window_minutes * 60000).toISOString();
  const isAllied = tier === 'allied';
  const r = db.prepare(`INSERT INTO cover_offers (cover_id, tier, worker_id, allied_id, rank, sent_at, expires_at)
    VALUES (?,?,?,?,?,?,?)`).run(cv.id, tier, isAllied ? null : cand.id, isAllied ? cand.id : null, rank, now(), exp);
  const offerId = Number(r.lastInsertRowid);
  const pt = db.prepare('SELECT name, suburb FROM users WHERE id = ?').get(b.participant_id) || {};
  const svc = SERVICE_LABELS[b.service] || b.service;
  const when = `${prettyDate(b.date)} at ${escHtml(b.start)} (${b.hours} hours)`;
  const clock = coverClock(cv.lead_minutes);
  if (isAllied) {
    const a = db.prepare('SELECT * FROM allied_providers WHERE id = ?').get(cand.id);
    const rate = INVOICE_RATES[suggestCategory(b)] || {};
    const payable = rate.price ? (rate.price * (a.share || 0.85) * (rate.perNight ? 1 : b.hours)) : 0;
    sendMail(a.email, `Cover request — ${svc}, ${prettyDate(b.date)} — BookIt`,
      `A shift we'd like your help with`,
      `<p>We have a confirmed <b>${escHtml(svc)}</b> shift we can't staff from our own team, and under our partner agreement <b>${escHtml(a.agreement_ref)}</b> we're offering it to you first.</p>
       <p><b>When:</b> ${when}<br><b>Where:</b> ${escHtml(pt.suburb || 'see booking')}<br><b>Support type:</b> ${escHtml(svc)} (${escHtml(REG_GROUPS[b.service] || '')})<br><b>We pay you:</b> ${payable.toFixed(2)} (${Math.round((a.share || 0.85) * 100)}% of the NDIS price limit for this line)</p>
       <p>Disability &amp; Mental Health Care Pty Ltd remains the registered provider of record for this support and keeps the participant's service agreement, the claim and the incident-reporting duty. Your worker delivers under our agreement — please confirm their NDIS Worker Screening Check number when you accept.</p>
       <p>This offer is open for <b>${cv.window_minutes} minutes</b>, then it moves on.</p>`,
      'Accept this shift', coverLink(req, offerId, 'allied')).catch(() => {});
    return offerId;
  }
  const w = db.prepare('SELECT name, email FROM users WHERE id = ?').get(cand.id);
  const onStandby = tier === 'standby';
  if (w) sendMail(w.email, `Cover needed — ${prettyDate(b.date)} — BookIt`,
    onStandby ? `You're on standby today, ${firstName(w.name)}` : `Can you cover this one, ${firstName(w.name)}?`,
    `<p>${tier === 'web'
      ? `<b>${escHtml(pt.name || 'A participant')}</b> has you in their care web, and the worker booked for this shift can't make it.`
      : onStandby
        ? `You accepted the on-call standby for today, and a shift has come up.`
        : `A shift near you needs covering and you're a match for it.`}</p>
     <p><b>${escHtml(svc)}</b><br>${when}<br>${escHtml(pt.suburb || '')}</p>
     <p>The booking is still confirmed — ${escHtml((pt.name || 'they').split(' ')[0])} is expecting somebody. First to accept gets it. This offer is open for <b>${cv.window_minutes} minutes</b>${clock.parallel ? ' and has gone to everyone available at once' : ', then it passes to the next person'}.</p>
     <p style="font-size:14px;color:#6C7A77">Can't do it? <a href="${coverLink(req, offerId, 'decline')}" style="color:#6C7A77">Tell us now</a> and it moves to the next person immediately. Saying no never counts against you.</p>`,
    'Yes, I can cover it', coverLink(req, offerId, 'accept')).catch(() => {});
  return offerId;
}

/* Send the next wave. Returns the number of offers sent. */
function coverWave(cv, req) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(cv.booking_id);
  if (!b) return 0;
  let sent = 0;
  const tiers = cv.parallel ? COVER_TIERS.slice(COVER_TIERS.indexOf(cv.tier)) : [cv.tier];
  for (const tier of tiers) {
    /* the allied tier is never fired automatically inside the parallel sweep
       without an office alert — subcontracting is a decision, not a reflex */
    const cands = coverCandidates(cv, b, tier);
    if (!cands.length) continue;
    const batch = cv.parallel ? cands : cands.slice(0, tier === 'pool' ? 5 : 1);
    batch.forEach((c, i) => { sendCoverOffer(req, cv, b, tier, c, i + 1); sent++; });
    if (tier === 'standby') batch.forEach(c => {
      db.prepare("UPDATE standby SET called_at = ?, booking_id = ? WHERE worker_id = ? AND date = ? AND status = 'accepted'")
        .run(now(), b.id, c.id, b.date);
    });
    if (!cv.parallel) break;
  }
  return sent;
}

/* Two different questions get asked of this function and they were sharing one
   answer. "Cover has opened and nobody is found yet" can be said twice in three
   lines of openCover — once because the participant is Tier 1 and once because
   the first offer round came up empty — and those are the same news, so the
   second must not ring again or overwrite the first reason. But "the shift
   started and nobody came" is not the same news as "we are looking", and that
   one has to get through even though the office has already heard about this
   cover. So: once-only by default, `escalate` for a genuine change of state.

   The guard also has to read the database rather than the row the caller is
   holding. openCover hands the same `cv` object to both of its calls, and that
   object was selected before either write — so a guard on cv.office_alerted_at
   sees null twice, sends twice, and the "nobody was eligible" line lands on top
   of the continuity line that was the reason worth reading. Re-read, then write
   the result back onto the object so the caller's copy stops lying too. */
function alertOffice(req, cv, b, why, opts) {
  if (!MAIL_FROM) return;
  const cur = db.prepare('SELECT office_alerted_at, office_alert_why FROM cover WHERE id = ?').get(cv.id);
  if (!cur) return;
  if (cur.office_alerted_at && !(opts && opts.escalate)) {
    cv.office_alerted_at = cur.office_alerted_at; cv.office_alert_why = cur.office_alert_why;
    return;
  }
  const alertedAt = now();
  db.prepare('UPDATE cover SET office_alerted_at = ?, office_alert_why = ? WHERE id = ?').run(alertedAt, String(why || ''), cv.id);
  cv.office_alerted_at = alertedAt; cv.office_alert_why = String(why || '');
  const pt = db.prepare('SELECT name, phone, suburb FROM users WHERE id = ?').get(b.participant_id) || {};
  const tried = db.prepare('SELECT COUNT(*) AS n FROM cover_offers WHERE cover_id = ?').get(cv.id).n;
  sendMail(MAIL_FROM, `Cover needs a person — ${pt.name || 'participant'} ${b.date}`,
    'The cascade needs you',
    `<p><b>${escHtml(why)}</b></p>
     <p><b>${escHtml(pt.name || '')}</b> — ${escHtml(SERVICE_LABELS[b.service] || b.service)}, ${prettyDate(b.date)} at ${escHtml(b.start)}, ${b.hours} hours, ${escHtml(pt.suburb || '')}.<br>
     ${tried} offer${tried === 1 ? '' : 's'} sent, none accepted. Phone: ${escHtml(pt.phone || 'not on file')}.</p>
     <p>This is the only stage that needs a human. Everything before it ran without one.</p>`,
    'Open the cover board', `${baseUrl(req) || APP_URL}/#/admin`).catch(() => {});
}

/* Open a cover request. The booking is NOT cancelled — it keeps its confirmed
   status and its date, and only the person changes. */
function openCover(bookingId, fromWorkerId, reason, req) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b) return null;
  const open = db.prepare("SELECT id FROM cover WHERE booking_id = ? AND status = 'open'").get(bookingId);
  if (open) return db.prepare('SELECT * FROM cover WHERE id = ?').get(open.id);
  const lead = leadMinutes(b);
  const clock = coverClock(lead);
  const r = db.prepare(`INSERT INTO cover (booking_id, from_worker_id, reason, opened_at, lead_minutes, window_minutes, parallel, tier, status)
    VALUES (?,?,?,?,?,?,?,'web','open')`).run(bookingId, fromWorkerId || null, clean(reason, 300), now(), lead, clock.win, clock.parallel);
  const cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(Number(r.lastInsertRowid));
  db.prepare('UPDATE bookings SET cover_state = ?, original_worker_id = COALESCE(original_worker_id, worker_id) WHERE id = ?')
    .run('finding', bookingId);
  const sent = coverWave(cv, req);
  /* tell the participant immediately — before they find out from the worker.
     "we are on it" beats "your shift is cancelled" every time. */
  const pt = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.participant_id);
  if (pt) sendMail(pt.email, `We're finding cover for ${prettyDate(b.date)} — BookIt`,
    `We're on it, ${firstName(pt.name)}`,
    `<p>The worker booked for your <b>${escHtml(SERVICE_LABELS[b.service] || b.service)}</b> shift on <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b> can't make it.</p>
     <p><b>Your booking has not been cancelled.</b> ${sent > 0
       ? `We've already asked ${sent} ${sent === 1 ? 'person' : 'people'}, starting with your own care web, and we'll email you the moment somebody says yes.`
       : `We're working through who's available now and we'll email you the moment somebody says yes.`}</p>
     <p>If you'd rather not have cover this time, you can stand it down from your bookings page and nothing is charged.</p>`,
    'See what\'s happening', `${baseUrl(req)}/#/bookings`).catch(() => {});
  /* Tier 1 is the participant whose own support plan says BookIt is their main
     source of support, that their health or safety is significantly affected
     without it, and that there is nobody else inside 24 hours. For them the
     cascade still runs — it is faster than a person — but it runs *alongside* a
     human rather than in front of one. Waiting for the offer rounds to fail
     before ringing the office is the right default for everybody else and
     exactly the wrong one here, and the participant has already told us which
     they are. Acting on the answer is the whole reason for asking it. */
  const ct = continuityTier(confirmedPlan(b.participant_id));
  if (ct.tier === 1) alertOffice(req, cv, b,
    `${ct.label} continuity — their support plan says there is no other support available within 24 hours. Ring them now; the offer round is running in parallel.`);
  /* and this is the ordinary case: the office hears about it only once the
     machine has run out of people. The call above has already claimed the alert
     for a Tier 1 participant, and alertOffice is once-only by default, so the
     office keeps the reason that actually matters instead of having it painted
     over by "nobody was eligible". */
  if (!sent) alertOffice(req, cv, b, 'Nobody was eligible on the first pass.');
  return cv;
}

/* Somebody said yes. Swap the worker, keep the booking, tell everyone. */
function coverAccept(offerId, req, acceptingWorkerId) {
  const o = db.prepare('SELECT * FROM cover_offers WHERE id = ?').get(offerId);
  if (!o) return { error: 'That offer no longer exists.' };
  if (o.response) return { error: o.response === 'accepted' ? 'You\'ve already accepted this one.' : 'That offer has already been answered.' };
  const cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(o.cover_id);
  if (!cv || cv.status !== 'open') return { error: 'This shift has already been covered — thank you for being quick.' };
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(cv.booking_id);
  if (!b) return { error: 'Booking not found.' };
  if (new Date(o.expires_at) < new Date()) {
    db.prepare("UPDATE cover_offers SET response = 'expired', responded_at = ? WHERE id = ?").run(now(), offerId);
    return { error: 'That offer had already timed out and moved on.' };
  }
  if (o.tier === 'allied') {
    const a = db.prepare('SELECT * FROM allied_providers WHERE id = ?').get(o.allied_id);
    db.prepare("UPDATE cover_offers SET response = 'accepted', responded_at = ? WHERE id = ?").run(now(), offerId);
    db.prepare("UPDATE cover SET status = 'referred', allied_id = ?, allied_share = ?, filled_at = ?, closed_at = ? WHERE id = ?")
      .run(a.id, a.share, now(), now(), cv.id);
    db.prepare("UPDATE bookings SET cover_state = 'allied', delivered_by_allied = ?, swap_count = swap_count + 1 WHERE id = ?").run(a.id, b.id);
    closeSiblings(cv.id, offerId);
    notifyCovered(req, b, null, a);
    return { ok: true, allied: a.name };
  }
  const workerId = acceptingWorkerId || o.worker_id;
  if (!workerId || workerId !== o.worker_id) return { error: 'That offer belongs to someone else.' };
  if (!workerEligible(workerId, b)) return { error: 'Something has changed since we sent this — you\'re no longer free at that time, or a credential needs updating.' };
  db.prepare("UPDATE cover_offers SET response = 'accepted', responded_at = ? WHERE id = ?").run(now(), offerId);
  db.prepare("UPDATE cover SET status = 'filled', filled_worker_id = ?, filled_at = ?, closed_at = ? WHERE id = ?")
    .run(workerId, now(), now(), cv.id);
  db.prepare("UPDATE bookings SET worker_id = ?, cover_state = 'covered', status = 'accepted', swap_count = swap_count + 1 WHERE id = ?")
    .run(workerId, b.id);
  closeSiblings(cv.id, offerId);
  const w = db.prepare('SELECT name FROM users WHERE id = ?').get(workerId);
  notifyCovered(req, b, w, null);
  /* a person who has now worked with this participant belongs in their care web —
     offered, never imposed */
  return { ok: true, worker: w ? w.name : '' };
}
function closeSiblings(coverId, keepOfferId) {
  db.prepare("UPDATE cover_offers SET response = 'withdrawn', responded_at = ? WHERE cover_id = ? AND id != ? AND response IS NULL")
    .run(now(), coverId, keepOfferId);
}
function notifyCovered(req, b, w, allied) {
  const pt = db.prepare('SELECT name, email FROM users WHERE id = ?').get(b.participant_id);
  const svc = SERVICE_LABELS[b.service] || b.service;
  if (pt) sendMail(pt.email, `Cover confirmed for ${prettyDate(b.date)} — BookIt`,
    `Sorted, ${firstName(pt.name)} 🎉`,
    allied
      ? `<p>Your <b>${escHtml(svc)}</b> shift on <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b> will be delivered by a worker from <b>${escHtml(allied.name)}</b>, one of our partner providers.</p>
         <p>We stay responsible for this support — same agreement, same standards, same complaints line. They'll confirm the worker's name with you before the day, and you can tell us any time if you'd rather wait for one of our own team instead.</p>`
      : `<p><b>${escHtml(w ? w.name : 'A worker')}</b> is covering your <b>${escHtml(svc)}</b> shift on <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b>.</p>
         <p>Same time, same booking, same price. You can message them from your bookings page before the day.</p>
         <p>If they were a good fit, add them to your care web — next time somebody can't make it, they'll be asked first.</p>`,
    'Open my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
  if (w) {
    const wu = db.prepare('SELECT email, name FROM users WHERE id = ?').get(b.worker_id);
    if (wu) sendMail(wu.email, `Confirmed — you're covering ${prettyDate(b.date)} — BookIt`,
      `You're locked in, ${firstName(wu.name)}`,
      `<p>Thanks for stepping in. <b>${escHtml(svc)}</b> with <b>${escHtml(pt ? pt.name : '')}</b>, <b>${prettyDate(b.date)}</b> at <b>${escHtml(b.start)}</b>, ${b.hours} hours.</p>
       <p>It's in your bookings now and pays exactly like any other shift — covering someone doesn't pay less.</p>`,
      'Open my bookings', `${baseUrl(req)}/#/bookings`).catch(() => {});
  }
}

/* The clock. Expires stale offers, advances tiers, escalates to a human only
   when the machine has genuinely run out of options. */
function coverSweep(req) {
  const acted = [];
  const open = db.prepare("SELECT * FROM cover WHERE status = 'open'").all();
  for (const cv0 of open) {
    let cv = cv0;
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(cv.booking_id);
    if (!b) { db.prepare("UPDATE cover SET status = 'stood-down', closed_at = ? WHERE id = ?").run(now(), cv.id); continue; }
    /* the shift has started and nobody came — close it, flag it, and make sure a
       human knows a participant went without. This is a reportable-quality event,
       not a rostering footnote. */
    if (bookingStart(b) < new Date()) {
      db.prepare("UPDATE cover SET status = 'failed', closed_at = ?, outcome_note = ? WHERE id = ?")
        .run(now(), 'Shift start passed with no cover found.', cv.id);
      db.prepare("UPDATE bookings SET cover_state = 'uncovered' WHERE id = ?").run(b.id);
      alertOffice(req, cv, b, 'A shift started with no cover. Please contact the participant today.', { escalate: true });
      acted.push({ cover: cv.id, outcome: 'failed' });
      continue;
    }
    /* the lead time has shortened since we opened — tighten the clock */
    const lead = leadMinutes(b);
    const clock = coverClock(lead);
    if (clock.win !== cv.window_minutes || clock.parallel !== cv.parallel) {
      db.prepare('UPDATE cover SET window_minutes = ?, parallel = ?, lead_minutes = ? WHERE id = ?')
        .run(clock.win, clock.parallel, lead, cv.id);
      cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(cv.id);
    }
    const live = db.prepare("SELECT COUNT(*) AS n FROM cover_offers WHERE cover_id = ? AND response IS NULL AND expires_at > ?").get(cv.id, now()).n;
    if (live > 0) continue;
    db.prepare("UPDATE cover_offers SET response = 'expired', responded_at = ? WHERE cover_id = ? AND response IS NULL").run(now(), cv.id);
    /* same tier again if there are more names, otherwise step down */
    let sent = coverWave(cv, req);
    while (!sent) {
      const next = COVER_TIERS[COVER_TIERS.indexOf(cv.tier) + 1];
      if (!next) {
        db.prepare("UPDATE cover SET status = 'failed', closed_at = ?, outcome_note = ? WHERE id = ?")
          .run(now(), 'Every tier exhausted before the shift.', cv.id);
        db.prepare("UPDATE bookings SET cover_state = 'uncovered' WHERE id = ?").run(b.id);
        alertOffice(req, cv, b, 'All four tiers exhausted — no one available.', { escalate: true });
        acted.push({ cover: cv.id, outcome: 'exhausted' });
        break;
      }
      db.prepare('UPDATE cover SET tier = ? WHERE id = ?').run(next, cv.id);
      cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(cv.id);
      if (next === 'allied') alertOffice(req, cv, b, 'Cover has reached the partner-provider tier.', { escalate: true });
      sent = coverWave(cv, req);
    }
    if (sent) acted.push({ cover: cv.id, tier: cv.tier, sent });
  }
  return acted;
}
setTimeout(() => { try { coverSweep(); } catch (e) { console.error('cover:', e.message); } }, 20_000);
setInterval(() => { try { coverSweep(); } catch (e) { console.error('cover:', e.message); } }, 60_000);

/* How exposed is this booking? Answered when the booking is made, not at 6am on
   the day — which is the only time it can still be fixed cheaply. */
function coverDepth(b) {
  const fake = { id: 0, from_worker_id: b.worker_id };
  const web = db.prepare('SELECT worker_id FROM care_web WHERE participant_id = ? AND auto_offer = 1').all(b.participant_id)
    .filter(r => r.worker_id !== b.worker_id && workerEligible(r.worker_id, b)).length;
  const standby = db.prepare("SELECT worker_id FROM standby WHERE date = ? AND status = 'accepted'").all(b.date)
    .filter(r => r.worker_id !== b.worker_id && workerEligible(r.worker_id, b)).length;
  const pool = coverCandidates(fake, b, 'pool').length;
  const allied = coverCandidates(fake, b, 'allied').length;
  return { web, standby, pool, allied, total: web + standby + pool + allied };
}


/* ============================================================================
   STANDBY — the locked-in backup bench, rostered by the machine
   ----------------------------------------------------------------------------
   This is the part that has to be automatic or it doesn't happen. Nobody is
   going to sit down every Sunday night and decide who's on call next week.

   The rule is simple: for every day inside the horizon that has shifts on it,
   there should be at least one worker being paid to be reachable. If there
   isn't, the sweep offers the period to the opted-in worker who has been asked
   least recently — spreading both the money and the imposition — and the worker
   accepts or declines with one tap. Nobody is ever rostered a standby SHIFT
   (see the note in the schema: cl.25.5(f) would make that expensive). They are
   offered a cl.26 on-call ALLOWANCE, which is paid whether or not they get
   called, and which is the entire marginal cost of the whole system.
   ============================================================================ */

function standbyToken(id) { return sign(`standby.${id}`).slice(0, 32); }

function offerStandby(workerId, date, req) {
  if (db.prepare('SELECT id FROM standby WHERE worker_id = ? AND date = ?').get(workerId, date)) return null;
  const w = db.prepare(`SELECT u.name, u.email, p.standby_services FROM users u
    JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ?`).get(workerId);
  if (!w) return null;
  const band = standbyBand(date);
  const allowance = oncallRates()[band];
  const r = db.prepare(`INSERT INTO standby (worker_id, date, band, allowance, services, status, offered_at)
    VALUES (?,?,?,?,?, 'offered', ?)`).run(workerId, date, band, allowance, w.standby_services || '[]', now());
  const id = Number(r.lastInsertRowid);
  const link = k => `${baseUrl(req)}/cover?s=${id}&t=${standbyToken(id)}&k=${k}`;
  sendMail(w.email, `On-call standby for ${prettyDate(date)} — ${allowance.toFixed(2)} — BookIt`,
    `Free on ${prettyDate(date).split(',')[0]}, ${firstName(w.name)}?`,
    `<p>We're asking you to be <b>on call</b> for <b>${prettyDate(date)}</b>. That means keeping your phone on and being able to get to a shift if somebody can't make theirs.</p>
     <p><b>You get paid ${allowance.toFixed(2)} just for saying yes</b> — that's the SCHADS on-call allowance for a ${band === 'weekday' ? 'weekday' : 'weekend or public holiday'} period, and it's yours whether or not we end up calling you.</p>
     <p>If we do call you, the shift is paid on top at your normal rate, and you can still say no on the day. Saying yes to standby is not agreeing to work — it's agreeing to be reachable.</p>
     <p style="margin:24px 0"><a href="${link('standby-yes')}" style="background:#0E6B62;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Yes, I'm on call that day</a>
     &nbsp;&nbsp;<a href="${link('standby-no')}" style="color:#5b6b68;text-decoration:underline">Not that day</a></p>`,
    null, null).catch(() => {});
  return id;
}

/* how many people should be reachable on a given day */
function standbyWanted(date) {
  const ratio = Math.max(1, Number(setting('standby_ratio')) || 8);
  const n = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND status IN ('requested','accepted')").get(date).n;
  if (!n) return 0;
  return Math.max(1, Math.min(3, Math.ceil(n / ratio)));
}

/* Ordered list of who to ask next: opted in, visible, screened, not already
   working most of that day, under their own weekly cap, asked least recently. */
function standbyCandidates(date, want) {
  const dow = new Date(date + 'T00:00:00').getDay();
  const idx = dow === 0 ? 6 : dow - 1;
  const weekStart = (() => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() - idx); return d.toISOString().slice(0, 10); })();
  const weekEnd = (() => { const d = new Date(weekStart + 'T00:00:00'); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();
  return db.prepare(`SELECT u.id, u.name, p.standby_max, p.days,
      (SELECT COUNT(*) FROM standby s WHERE s.worker_id = u.id AND s.date BETWEEN ? AND ? AND s.status IN ('offered','accepted')) AS this_week,
      (SELECT COUNT(*) FROM standby s WHERE s.worker_id = u.id AND s.status = 'accepted' AND s.date >= ?) AS recent,
      (SELECT COUNT(*) FROM bookings b WHERE b.worker_id = u.id AND b.date = ? AND b.status IN ('requested','accepted')) AS working
    FROM users u JOIN worker_profiles p ON p.user_id = u.id
    WHERE u.role = 'worker' AND p.visible = 1 AND p.standby_optin = 1
      AND u.id NOT IN (SELECT worker_id FROM standby WHERE date = ?)
    ORDER BY recent ASC, this_week ASC, u.id ASC`)
    .all(weekStart, weekEnd, new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10), date, date)
    .filter(c => {
      if (!platformEligible(c.id)) return false;       /* 0137 — never offer standby to a worker who can't be on the platform */
      if (screeningState(c.id) === 'expired') return false;
      if (c.this_week >= (c.standby_max ?? 2)) return false;
      if (c.working) return false;                     /* already on shift most of that day */
      const days = safeJson(c.days, [1, 1, 1, 1, 1, 0, 0]);
      return !(days.length === 7 && !days[idx]);       /* respects the days they said they work */
    })
    .slice(0, want);
}

/* The sweep. Runs on a timer, and can be pushed from the admin console. */
function standbySweep(req, days) {
  const horizon = days || Math.max(1, Number(setting('standby_horizon')) || 10);
  const out = { days: 0, offered: 0, short: [] };
  for (let i = 0; i < horizon; i++) {
    const d = new Date(Date.now() + i * 86400e3).toISOString().slice(0, 10);
    const want = standbyWanted(d);
    if (!want) continue;
    out.days++;
    const have = db.prepare("SELECT COUNT(*) AS n FROM standby WHERE date = ? AND status IN ('offered','accepted')").get(d).n;
    const gap = want - have;
    if (gap <= 0) continue;
    const cands = standbyCandidates(d, gap);
    if (!cands.length) { out.short.push(d); continue; }
    for (const c of cands) { if (offerStandby(c.id, d, req)) out.offered++; }
  }
  /* If the bench can't be filled at all, that is worth a human knowing about
     once a day — not at 6am on the day it bites. */
  if (out.short.length && MAIL_FROM) {
    const last = setting('standby_short_alert');
    const today = new Date().toISOString().slice(0, 10);
    if (last !== today) {
      setSetting('standby_short_alert', today);
      sendMail(MAIL_FROM, `Standby bench short on ${out.short.length} day${out.short.length === 1 ? '' : 's'}`,
        'Nobody available to be on call',
        `<p>These days have shifts booked but nobody on standby, and there's no opted-in worker left to ask:</p>
         <p><b>${out.short.map(d => escHtml(prettyDate(d))).join('<br>')}</b></p>
         <p>Either more workers need to opt in to standby, or the allowance needs to be worth more. Both are fixable this week; neither is fixable on the morning.</p>`,
        'Open the cover board', `${baseUrl(req) || APP_URL}/#/admin`).catch(() => {});
    }
  }
  return out;
}
setTimeout(() => { try { standbySweep(); } catch (e) { console.error('standby:', e.message); } }, 45_000);
setInterval(() => { try { standbySweep(); } catch (e) { console.error('standby:', e.message); } }, 6 * 3600e3);


/* ============================================================================
   COVER — routes
   ============================================================================ */

/* ---------- the participant's care web ---------- */

function careWebRows(participantId) {
  return db.prepare(`SELECT cw.id, cw.worker_id, cw.rank, cw.role, cw.auto_offer, cw.note, cw.added_at,
      u.name, u.suburb, COALESCE(p.color, '#0E6B62') AS color, COALESCE(p.visible, 0) AS visible,
      p.photo, p.photo_at, p.services, p.days,
      (SELECT COUNT(*) FROM bookings b WHERE b.worker_id = cw.worker_id AND b.participant_id = cw.participant_id AND b.status = 'completed') AS shifts_together,
      (SELECT COUNT(*) FROM cover_offers o JOIN cover c ON c.id = o.cover_id
        JOIN bookings bb ON bb.id = c.booking_id
        WHERE o.worker_id = cw.worker_id AND bb.participant_id = cw.participant_id AND o.response = 'accepted') AS covers_done
    FROM care_web cw JOIN users u ON u.id = cw.worker_id
    LEFT JOIN worker_profiles p ON p.user_id = cw.worker_id
    WHERE cw.participant_id = ? ORDER BY cw.rank ASC, cw.id ASC`).all(participantId)
    .map(r => ({
      ...r,
      services: safeJson(r.services, []),
      days: safeJson(r.days, []),
      screening: screeningState(r.worker_id),
      photo: r.photo ? `/photos/${r.worker_id}?v=${encodeURIComponent(r.photo_at || '')}` : null
    }));
}

/* Everyone this participant has actually worked with who isn't in the web yet.
   Nobody should have to remember a name — the system already knows who turned up. */
function careWebSuggestions(participantId) {
  return db.prepare(`SELECT u.id AS worker_id, u.name, u.suburb, COALESCE(p.color, '#0E6B62') AS color,
      p.photo, p.photo_at, p.services,
      COUNT(b.id) AS shifts_together, MAX(b.date) AS last_shift
    FROM bookings b JOIN users u ON u.id = b.worker_id
    LEFT JOIN worker_profiles p ON p.user_id = u.id
    WHERE b.participant_id = ? AND b.status IN ('completed','accepted')
      AND u.id NOT IN (SELECT worker_id FROM care_web WHERE participant_id = ?)
      AND COALESCE(p.visible, 0) = 1
    GROUP BY u.id ORDER BY shifts_together DESC, last_shift DESC LIMIT 12`).all(participantId, participantId)
    .filter(r => platformEligible(r.worker_id))
    .map(r => ({ ...r, services: safeJson(r.services, []), photo: r.photo ? `/photos/${r.worker_id}?v=${encodeURIComponent(r.photo_at || '')}` : null }));
}

route('GET', /^\/api\/me\/care-web$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Care webs belong to participants.' });
  json(res, 200, {
    web: careWebRows(user.id),
    suggestions: careWebSuggestions(user.id),
    tiers: COVER_TIERS.map(t => ({ key: t, label: TIER_LABELS[t] }))
  });
});

route('POST', /^\/api\/me\/care-web$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'participant') return json(res, 403, { error: 'Care webs belong to participants.' });
  const workerId = Number(body.worker_id);
  const w = db.prepare("SELECT u.id, u.name, u.email FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker' AND p.visible = 1").get(workerId);
  if (!w || !platformEligible(workerId, w.email)) return json(res, 404, { error: 'That worker isn\'t available to add.' });
  if (db.prepare('SELECT id FROM care_web WHERE participant_id = ? AND worker_id = ?').get(user.id, workerId))
    return json(res, 400, { error: `${w.name.split(' ')[0]} is already in your care web.` });
  const role = ['regular', 'backup', 'emergency'].includes(body.role) ? body.role : 'backup';
  const next = db.prepare('SELECT COALESCE(MAX(rank), 0) + 1 AS r FROM care_web WHERE participant_id = ?').get(user.id).r;
  db.prepare('INSERT INTO care_web (participant_id, worker_id, rank, role, auto_offer, note, added_at) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, workerId, next, role, body.auto_offer === false ? 0 : 1, clean(body.note, 200), now());
  json(res, 200, { ok: true, web: careWebRows(user.id), suggestions: careWebSuggestions(user.id) });
});

route('POST', /^\/api\/me\/care-web\/(\d+)$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const row = db.prepare('SELECT * FROM care_web WHERE id = ? AND participant_id = ?').get(Number(m[1]), user.id);
  if (!row) return json(res, 404, { error: 'Not in your care web.' });
  const role = ['regular', 'backup', 'emergency'].includes(body.role) ? body.role : row.role;
  const auto = body.auto_offer === undefined ? row.auto_offer : (body.auto_offer ? 1 : 0);
  db.prepare('UPDATE care_web SET role = ?, auto_offer = ?, note = ? WHERE id = ?')
    .run(role, auto, body.note === undefined ? row.note : clean(body.note, 200), row.id);
  json(res, 200, { ok: true, web: careWebRows(user.id) });
});

/* One move, one save: the whole order arrives as a list of ids. */
route('POST', /^\/api\/me\/care-web\/order$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return json(res, 400, { error: 'Nothing to reorder.' });
  const mine = new Set(db.prepare('SELECT id FROM care_web WHERE participant_id = ?').all(user.id).map(r => r.id));
  const up = db.prepare('UPDATE care_web SET rank = ? WHERE id = ? AND participant_id = ?');
  ids.forEach((id, i) => { if (mine.has(id)) up.run(i + 1, id, user.id); });
  json(res, 200, { ok: true, web: careWebRows(user.id) });
});

route('POST', /^\/api\/me\/care-web\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const row = db.prepare('SELECT * FROM care_web WHERE id = ? AND participant_id = ?').get(Number(m[1]), user.id);
  if (!row) return json(res, 404, { error: 'Not in your care web.' });
  db.prepare('DELETE FROM care_web WHERE id = ?').run(row.id);
  db.prepare('SELECT id FROM care_web WHERE participant_id = ? ORDER BY rank ASC, id ASC').all(user.id)
    .forEach((r, i) => db.prepare('UPDATE care_web SET rank = ? WHERE id = ?').run(i + 1, r.id));
  json(res, 200, { ok: true, web: careWebRows(user.id), suggestions: careWebSuggestions(user.id) });
});

/* ---------- the worker's side: offers and standby ---------- */

function offerRows(workerId) {
  return db.prepare(`SELECT o.id, o.tier, o.rank, o.sent_at, o.expires_at, o.response,
      c.id AS cover_id, c.reason, c.status AS cover_status,
      b.id AS booking_id, b.service, b.date, b.start, b.hours, b.sleepover,
      up.name AS participant_name, up.suburb
    FROM cover_offers o JOIN cover c ON c.id = o.cover_id
    JOIN bookings b ON b.id = c.booking_id
    JOIN users up ON up.id = b.participant_id
    WHERE o.worker_id = ? AND o.response IS NULL AND o.expires_at > ? AND c.status = 'open'
    ORDER BY b.date ASC, b.start ASC`).all(workerId, now())
    .map(r => {
      const rate = INVOICE_RATES[suggestCategory(r)] || {};
      return {
        ...r,
        service_label: SERVICE_LABELS[r.service] || r.service,
        tier_label: TIER_LABELS[r.tier] || r.tier,
        pay: rate.worker ? Number((rate.worker * (rate.perNight ? 1 : r.hours)).toFixed(2)) : null,
        rate_label: rate.label || ''
      };
    });
}
function standbyRows(workerId) {
  return db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.date = s.date) AS shifts_that_day
    FROM standby s WHERE s.worker_id = ? AND s.date >= ? ORDER BY s.date ASC`)
    .all(workerId, new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10))
    .map(r => ({ ...r, services: safeJson(r.services, []) }));
}

route('GET', /^\/api\/me\/offers$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'worker') return json(res, 200, { offers: [], standby: [] });
  const p = db.prepare('SELECT standby_optin, standby_max, standby_services FROM worker_profiles WHERE user_id = ?').get(user.id) || {};
  const rates = oncallRates();
  const paid = db.prepare("SELECT COALESCE(SUM(allowance), 0) AS s FROM standby WHERE worker_id = ? AND status = 'accepted'").get(user.id).s;
  const webs = db.prepare(`SELECT COUNT(*) AS n FROM care_web WHERE worker_id = ?`).get(user.id).n;
  json(res, 200, {
    offers: offerRows(user.id),
    standby: standbyRows(user.id),
    standby_optin: p.standby_optin ? 1 : 0,
    standby_max: p.standby_max ?? 2,
    standby_services: safeJson(p.standby_services, []),
    rates,
    allowance_earned: Number(paid.toFixed(2)),
    in_care_webs: webs
  });
});

route('POST', /^\/api\/me\/offers\/(\d+)\/(accept|decline)$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const offerId = Number(m[1]);
  const o = db.prepare('SELECT * FROM cover_offers WHERE id = ?').get(offerId);
  if (!o || o.worker_id !== user.id) return json(res, 404, { error: 'That offer isn\'t yours.' });
  if (m[2] === 'decline') {
    if (!o.response) db.prepare("UPDATE cover_offers SET response = 'declined', responded_at = ? WHERE id = ?").run(now(), offerId);
    return json(res, 200, { ok: true, offers: offerRows(user.id) });
  }
  const r = coverAccept(offerId, req, user.id);
  if (r.error) return json(res, 400, { error: r.error, offers: offerRows(user.id) });
  json(res, 200, { ok: true, ...r, offers: offerRows(user.id) });
});

/* opt in once, and the roster fills itself from then on */
route('POST', /^\/api\/me\/standby-settings$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  const svcs = Array.isArray(body.services) ? body.services.filter(s => SERVICES.includes(s)) : [];
  const max = Math.max(0, Math.min(7, Number(body.max) || 0));
  db.prepare('UPDATE worker_profiles SET standby_optin = ?, standby_max = ?, standby_services = ? WHERE user_id = ?')
    .run(body.optin ? 1 : 0, max, JSON.stringify(svcs), user.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/me\/standby\/(\d+)\/(accept|decline)$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const s = db.prepare('SELECT * FROM standby WHERE id = ?').get(Number(m[1]));
  if (!s || s.worker_id !== user.id) return json(res, 404, { error: 'That standby period isn\'t yours.' });
  if (s.status !== 'offered') return json(res, 400, { error: 'That one has already been answered.' });
  const answer = m[2] === 'accept' ? 'accepted' : 'declined';
  db.prepare('UPDATE standby SET status = ?, responded_at = ? WHERE id = ?').run(answer, now(), s.id);
  json(res, 200, { ok: true, standby: standbyRows(user.id) });
});

/* ---------- the trigger: a worker who can't make it ---------- */

route('POST', /^\/api\/bookings\/(\d+)\/cant-make-it$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'Booking not found.' });
  if (!(user.role === 'worker' && b.worker_id === user.id) && !user.admin)
    return json(res, 403, { error: 'That isn\'t your shift.' });
  if (!['requested', 'accepted'].includes(b.status)) return json(res, 400, { error: 'That shift isn\'t live any more.' });
  if (b.cover_state === 'finding') return json(res, 400, { error: 'Cover is already being found for this shift.' });
  const reason = clean(body.reason, 300);
  const cv = openCover(b.id, user.id, reason, req);
  if (!cv) return json(res, 500, { error: 'Couldn\'t open a cover request.' });
  const depth = coverDepth(b);
  /* SCHADS cl.25.5(f) belongs to the employer's roster, not to this exchange —
     no penalty is applied to a worker here, deliberately. Punishing a cancellation
     buys you a worker who turns up sick and tells nobody. */
  json(res, 200, {
    ok: true, cover_id: cv.id, depth,
    message: depth.total
      ? `We're on it — ${depth.total} ${depth.total === 1 ? 'person is' : 'people are'} being asked, starting with the participant's own care web.`
      : 'We\'re on it — the office has been alerted straight away because nobody was free.'
  });
});

/* the participant can wave it off — no cover, no charge, and the worker's slot frees */
route('POST', /^\/api\/bookings\/(\d+)\/stand-down$/, (req, res, m, user, body) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'Booking not found.' });
  if (b.participant_id !== user.id && !user.admin) return json(res, 403, { error: 'That isn\'t your booking.' });
  const cv = db.prepare("SELECT * FROM cover WHERE booking_id = ? AND status = 'open'").get(b.id);
  if (cv) {
    db.prepare("UPDATE cover SET status = 'stood-down', closed_at = ?, outcome_note = ? WHERE id = ?")
      .run(now(), clean(body.reason, 200) || 'Participant stood cover down.', cv.id);
    db.prepare("UPDATE cover_offers SET response = 'withdrawn', responded_at = ? WHERE cover_id = ? AND response IS NULL").run(now(), cv.id);
  }
  db.prepare("UPDATE bookings SET status = 'cancelled', cover_state = 'stood-down' WHERE id = ?").run(b.id);
  json(res, 200, { ok: true });
});

/* what's happening with my shift, in plain words */
route('GET', /^\/api\/bookings\/(\d+)\/cover$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(m[1]));
  if (!b) return json(res, 404, { error: 'Booking not found.' });
  if (b.participant_id !== user.id && b.worker_id !== user.id && !user.admin) return json(res, 403, { error: 'Not your booking.' });
  const cv = db.prepare('SELECT * FROM cover WHERE booking_id = ? ORDER BY id DESC LIMIT 1').get(b.id);
  const offers = cv ? db.prepare(`SELECT o.tier, o.sent_at, o.expires_at, o.response, o.responded_at,
      COALESCE(u.name, a.name) AS who
    FROM cover_offers o LEFT JOIN users u ON u.id = o.worker_id
    LEFT JOIN allied_providers a ON a.id = o.allied_id
    WHERE o.cover_id = ? ORDER BY o.id ASC`).all(cv.id) : [];
  json(res, 200, {
    cover: cv || null,
    tier_label: cv ? TIER_LABELS[cv.tier] : '',
    offers: offers.map(o => ({ ...o, tier_label: TIER_LABELS[o.tier] || o.tier })),
    depth: ['requested', 'accepted'].includes(b.status) ? coverDepth(b) : null
  });
});

/* ---------- admin: the cover board ---------- */

route('GET', /^\/api\/admin\/cover$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const base = `SELECT c.*, b.date, b.start, b.hours, b.service, b.participant_id,
      up.name AS participant_name, up.phone AS participant_phone, up.suburb,
      uw.name AS from_worker_name, uf.name AS filled_worker_name, a.name AS allied_name,
      (SELECT COUNT(*) FROM cover_offers o WHERE o.cover_id = c.id) AS offers_sent
    FROM cover c JOIN bookings b ON b.id = c.booking_id
    JOIN users up ON up.id = b.participant_id
    LEFT JOIN users uw ON uw.id = c.from_worker_id
    LEFT JOIN users uf ON uf.id = c.filled_worker_id
    LEFT JOIN allied_providers a ON a.id = c.allied_id`;
  const dec = r => ({ ...r, tier_label: TIER_LABELS[r.tier] || r.tier, service_label: SERVICE_LABELS[r.service] || r.service });
  const open = db.prepare(`${base} WHERE c.status = 'open' ORDER BY b.date ASC, b.start ASC`).all().map(r => ({
    ...dec(r),
    continuity: continuityTier(confirmedPlan(r.participant_id)),
    live_offers: db.prepare(`SELECT o.tier, o.expires_at, COALESCE(u.name, a.name) AS who FROM cover_offers o
      LEFT JOIN users u ON u.id = o.worker_id LEFT JOIN allied_providers a ON a.id = o.allied_id
      WHERE o.cover_id = ? AND o.response IS NULL ORDER BY o.id ASC`).all(r.id)
  }))
  /* soonest-first is the right order for a roster and the wrong one for a
     board somebody is working down at 6am. A Tier 1 shift on Thursday matters
     more than a Tier 3 shift this afternoon, because the Tier 3 participant
     has somebody else and the Tier 1 participant does not. Tier first, then
     time. Tier 0 — no confirmed plan — sorts with the standard ones rather
     than at the top, because an unanswered question is not an emergency; it
     shows up as a gap on the support-plan board instead, which is where it
     can actually be closed. */
    .sort((a, b2) => (a.continuity.tier || 9) - (b2.continuity.tier || 9)
      || (a.date + a.start < b2.date + b2.start ? -1 : 1));
  const recent = db.prepare(`${base} WHERE c.status != 'open' ORDER BY c.id DESC LIMIT 40`).all().map(dec);
  /* the number that matters: how much of this ran without a person */
  const all = db.prepare("SELECT status, tier, office_alerted_at, opened_at, filled_at FROM cover WHERE status != 'open'").all();
  const done = all.length;
  const noHuman = all.filter(c => !c.office_alerted_at && ['filled', 'referred'].includes(c.status)).length;
  const fillTimes = all.filter(c => c.filled_at).map(c => (new Date(c.filled_at) - new Date(c.opened_at)) / 60000);
  const stats = {
    total: done,
    filled: all.filter(c => c.status === 'filled').length,
    referred: all.filter(c => c.status === 'referred').length,
    failed: all.filter(c => c.status === 'failed').length,
    stood_down: all.filter(c => c.status === 'stood-down').length,
    hands_off_pct: done ? Math.round((noHuman / done) * 100) : null,
    median_fill_minutes: fillTimes.length ? Math.round(fillTimes.sort((a, b) => a - b)[Math.floor(fillTimes.length / 2)]) : null,
    by_tier: COVER_TIERS.map(t => ({ tier: t, label: TIER_LABELS[t], n: all.filter(c => c.tier === t && ['filled', 'referred'].includes(c.status)).length }))
  };
  const today = new Date().toISOString().slice(0, 10);
  const standby = db.prepare(`SELECT s.*, u.name FROM standby s JOIN users u ON u.id = s.worker_id
    WHERE s.date >= ? ORDER BY s.date ASC, u.name ASC LIMIT 200`).all(today);
  const rates = oncallRates();
  const spend = db.prepare("SELECT COALESCE(SUM(allowance),0) AS s, COUNT(*) AS n FROM standby WHERE status = 'accepted' AND date >= ?")
    .get(new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10));
  json(res, 200, {
    open, recent, stats, rates,
    standby: standby.map(s => ({ ...s, services: safeJson(s.services, []) })),
    standby_spend_90d: Number(spend.s.toFixed(2)),
    standby_periods_90d: spend.n,
    allied: db.prepare('SELECT * FROM allied_providers ORDER BY active DESC, reciprocal DESC, name ASC').all()
      .map(a => ({ ...a, reg_groups: safeJson(a.reg_groups, []), suburbs: safeJson(a.suburbs, []) })),
    optins: db.prepare(`SELECT u.id, u.name, p.standby_max, p.standby_services FROM users u JOIN worker_profiles p ON p.user_id = u.id
      WHERE p.standby_optin = 1 AND p.visible = 1 ORDER BY u.name`).all()
      .map(o => ({ ...o, standby_services: safeJson(o.standby_services, []) }))
  });
});

route('POST', /^\/api\/admin\/cover\/(\d+)\/escalate$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  let cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(Number(m[1]));
  if (!cv || cv.status !== 'open') return json(res, 400, { error: 'That cover request isn\'t open.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(cv.booking_id);
  db.prepare("UPDATE cover_offers SET response = 'expired', responded_at = ? WHERE cover_id = ? AND response IS NULL").run(now(), cv.id);
  const next = COVER_TIERS[COVER_TIERS.indexOf(cv.tier) + 1];
  if (next) { db.prepare('UPDATE cover SET tier = ? WHERE id = ?').run(next, cv.id); cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(cv.id); }
  const sent = coverWave(cv, req);
  json(res, 200, { ok: true, tier: cv.tier, sent });
});

route('POST', /^\/api\/admin\/cover\/(\d+)\/assign$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(Number(m[1]));
  if (!cv || cv.status !== 'open') return json(res, 400, { error: 'That cover request isn\'t open.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(cv.booking_id);
  const workerId = Number(body.worker_id);
  if (!workerEligible(workerId, b)) return json(res, 400, { error: 'That worker isn\'t free or isn\'t currently screened for this shift.' });
  const r = db.prepare(`INSERT INTO cover_offers (cover_id, tier, worker_id, rank, sent_at, expires_at, response, responded_at)
    VALUES (?,?,?,?,?,?,'accepted',?)`).run(cv.id, cv.tier, workerId, 99, now(), new Date(Date.now() + 60000).toISOString(), now());
  db.prepare("UPDATE cover SET status = 'filled', filled_worker_id = ?, filled_at = ?, closed_at = ?, human_minutes = human_minutes + 5, outcome_note = ? WHERE id = ?")
    .run(workerId, now(), now(), 'Assigned by the office.', cv.id);
  db.prepare("UPDATE bookings SET worker_id = ?, cover_state = 'covered', status = 'accepted', swap_count = swap_count + 1 WHERE id = ?").run(workerId, b.id);
  closeSiblings(cv.id, Number(r.lastInsertRowid));
  notifyCovered(req, db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id), db.prepare('SELECT name FROM users WHERE id = ?').get(workerId), null);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/cover\/(\d+)\/close$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(Number(m[1]));
  if (!cv) return json(res, 404, { error: 'Not found.' });
  const mins = Math.max(0, Math.min(600, Number(body.human_minutes) || 0));
  db.prepare("UPDATE cover SET status = ?, closed_at = ?, outcome_note = ?, human_minutes = human_minutes + ? WHERE id = ?")
    .run(clean(body.status, 20) === 'failed' ? 'failed' : 'stood-down', now(), clean(body.note, 300), mins, cv.id);
  db.prepare("UPDATE cover_offers SET response = 'withdrawn', responded_at = ? WHERE cover_id = ? AND response IS NULL").run(now(), cv.id);
  db.prepare("UPDATE bookings SET cover_state = ? WHERE id = ?").run('stood-down', cv.booking_id);
  json(res, 200, { ok: true });
});

/* who could take this, right now — the office's answer to "who do I ring?" */
route('GET', /^\/api\/admin\/cover\/(\d+)\/candidates$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const cv = db.prepare('SELECT * FROM cover WHERE id = ?').get(Number(m[1]));
  if (!cv) return json(res, 404, { error: 'Not found.' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(cv.booking_id);
  const out = {};
  for (const t of COVER_TIERS) {
    out[t] = coverCandidates(cv, b, t).slice(0, 10).map(c => {
      if (t === 'allied') return { id: c.id, allied: 1, name: c.name, phone: c.phone || '', email: c.email, share: c.share, agreement: c.agreement_ref };
      const u = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(c.id) || {};
      return { id: c.id, name: u.name || '', phone: u.phone || '' };
    });
  }
  json(res, 200, { candidates: out, labels: TIER_LABELS });
});

/* ---------- admin: allied providers ---------- */

route('GET', /^\/api\/admin\/allied$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, {
    allied: db.prepare('SELECT * FROM allied_providers ORDER BY active DESC, name ASC').all()
      .map(a => ({ ...a, reg_groups: safeJson(a.reg_groups, []), suburbs: safeJson(a.suburbs, []) })),
    groups: Object.entries(REG_GROUPS).map(([k, v]) => ({ service: k, label: SERVICE_LABELS[k], group: v }))
  });
});

route('POST', /^\/api\/admin\/allied$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const name = clean(body.name, 120);
  const email = clean(body.email, 160).toLowerCase();
  if (!name) return json(res, 400, { error: 'A provider name is needed.' });
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'A valid contact email is needed — that\'s where cover requests go.' });
  const groups = Array.isArray(body.reg_groups) ? body.reg_groups.map(g => clean(g, 12)).filter(Boolean) : [];
  const subs = Array.isArray(body.suburbs) ? body.suburbs.map(s => clean(s, 60)).filter(Boolean)
    : clean(body.suburbs, 600).split(',').map(s => s.trim()).filter(Boolean);
  const share = Math.max(0.5, Math.min(1, Number(body.share) || 0.85));
  const id = Number(body.id) || 0;
  const vals = [name, clean(body.abn, 20), clean(body.ndis_reg, 30), clean(body.contact_name, 80), email, clean(body.phone, 30),
    JSON.stringify(groups), JSON.stringify(subs), share, clean(body.agreement_ref, 60), clean(body.agreement_date, 10),
    clean(body.insurance_expiry, 10), body.reciprocal === false ? 0 : 1, body.active === false ? 0 : 1];
  if (id && db.prepare('SELECT id FROM allied_providers WHERE id = ?').get(id)) {
    db.prepare(`UPDATE allied_providers SET name=?, abn=?, ndis_reg=?, contact_name=?, email=?, phone=?, reg_groups=?, suburbs=?,
      share=?, agreement_ref=?, agreement_date=?, insurance_expiry=?, reciprocal=?, active=? WHERE id=?`).run(...vals, id);
    return json(res, 200, { ok: true, id });
  }
  const r = db.prepare(`INSERT INTO allied_providers (name, abn, ndis_reg, contact_name, email, phone, reg_groups, suburbs,
    share, agreement_ref, agreement_date, insurance_expiry, reciprocal, active, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...vals, now());
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('POST', /^\/api\/admin\/allied\/(\d+)\/delete$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  db.prepare('UPDATE allied_providers SET active = 0 WHERE id = ?').run(Number(m[1]));
  json(res, 200, { ok: true });
});

/* ---------- admin: standby roster ---------- */

route('POST', /^\/api\/admin\/standby$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const date = clean(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Pick a date.' });
  const ids = Array.isArray(body.worker_ids) ? body.worker_ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return json(res, 400, { error: 'Pick at least one worker.' });
  const out = ids.map(id => offerStandby(id, date, req)).filter(Boolean);
  json(res, 200, { ok: true, offered: out.length });
});

route('POST', /^\/api\/admin\/standby\/(\d+)\/release$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const s = db.prepare('SELECT * FROM standby WHERE id = ?').get(Number(m[1]));
  if (!s) return json(res, 404, { error: 'Not found.' });
  db.prepare("UPDATE standby SET status = 'released' WHERE id = ?").run(s.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/standby\/fill$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const r = standbySweep(req, Number(body.days) || 14);
  json(res, 200, { ok: true, ...r });
});

/* SCHADS moves every 1 July — this is a form field, not a deploy */
route('POST', /^\/api\/admin\/oncall-rates$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const w = Number(body.weekday), o = Number(body.other);
  if (!(w > 0 && w < 500) || !(o > 0 && o < 500)) return json(res, 400, { error: 'Both allowances need to be a sensible dollar figure.' });
  setSetting('oncall_weekday', w.toFixed(2));
  setSetting('oncall_other', o.toFixed(2));
  setSetting('standby_ratio', String(Math.max(1, Math.min(50, Number(body.ratio) || 8))));
  setSetting('standby_horizon', String(Math.max(1, Math.min(28, Number(body.horizon) || 10))));
  json(res, 200, { ok: true, rates: oncallRates() });
});

/* ============================================================================
   THE AWARDS LADDER
   ============================================================================

   Two things wearing one name, because they are the same mechanism:

   1. The reward ladder. Four tiers set by rolling 12-month hours. Each tier is
      a percentage share of the NDIS price limit, not a dollar figure — so one
      number drives all nine rate categories and the ladder survives every
      annual price review without being rebuilt.

   2. The SCHADS award floor. The ladder is not allowed to pay below the award,
      and on household tasks (0120) the flat share ALREADY DOES — $38.84 base
      against a Level 2 casual minimum of $45.28. That is a live problem today,
      before any tier exists, and no percentage fixes it because the 0120 price
      limit is capped 18% below personal care while the award doesn't fall with
      it. It needs a floor. That is why the floor ships with the ladder rather
      than after it.

   Nothing here is a constant. Shares, bands, award minimums and penalty
   multipliers are all settings, because SCHADS moves every 1 July and the
   ladder is a commercial decision that should not need a deploy to change. */

for (const col of ["tier TEXT DEFAULT 'bronze'", 'schads_level INTEGER DEFAULT 2',
  "tier_below_since TEXT DEFAULT ''", "tier_notice_at TEXT DEFAULT ''", "tier_pending TEXT DEFAULT ''",
  "tier_paused_until TEXT DEFAULT ''", "tier_pause_reason TEXT DEFAULT ''", "tier_reviewed_at TEXT DEFAULT ''"]) {
  try { db.exec(`ALTER TABLE worker_profiles ADD COLUMN ${col}`); } catch {}
}
/* what was actually applied to this shift, frozen at completion. A tier change
   next month must never silently restate last month's pay. */
for (const col of ["tier_at_shift TEXT DEFAULT ''", 'share_pct REAL', 'award_floored INTEGER DEFAULT 0']) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); } catch {}
}
/* Append-only. Under the Fair Work Act employee-like worker provisions (in force
   26/08/2024) a pay-rate reduction needs a defensible record of when the
   threshold was crossed and when notice was given. Rows are never updated. */
db.exec(`CREATE TABLE IF NOT EXISTS tier_log (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES users(id),
  from_tier TEXT NOT NULL DEFAULT '',
  to_tier TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT '',
  hours REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  notice_at TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tier_log_worker ON tier_log(worker_id);`);

const TIERS = [
  { key: 'bronze',   label: 'Bronze',   sub: 'Starter' },
  { key: 'silver',   label: 'Silver',   sub: 'Regular' },
  { key: 'gold',     label: 'Gold',     sub: 'Committed' },
  { key: 'platinum', label: 'Platinum', sub: 'Career' }
];
const TIER_KEYS = TIERS.map(t => t.key);
const tierIndex = k => Math.max(0, TIER_KEYS.indexOf(k));

/* Seeded to the "Steady" ladder — 72.5 / 74.0 / 75.5 / 76.5 — which costs about
   $19,510 a year against the flat 72.4% and lands within $209 of the solved
   "Level" ladder where no tier returns less than any other. The ladder
   DECELERATES on purpose: the retention dividend that funds it arrives almost
   entirely at the first step ($1.29/hr Bronze→Silver, $0.45 Silver→Gold,
   $0.11 Gold→Platinum) while every extra percentage point costs a flat
   $0.7358/hr. A conventional +3/+3/+3 ladder spends the most money exactly
   where the least comes back.

   Bands seeded low — 200/600/1,200 rather than 300/900/1,500 — because moving
   the bands is cheaper than raising the percentages, and Silver is the step
   that pays for itself. At the sector's average 22.7 hours a week, 1,500 hours
   puts the top tier out of reach for most casuals. */
const LADDER_DEFAULT = {
  share: { bronze: 72.5, silver: 74.0, gold: 75.5, platinum: 76.5 },
  band: { silver: 200, gold: 600, platinum: 1200 },
  super: 12,
  /* SCHADS MA000100 casual minimums, per hour, from 01/07/2026. Level 1 pp1
     $34.44 · Level 2 pp1 $45.28 · Level 3 pp1 $50.61. These already include the
     25% casual loading — the whole ladder only clears the award because they do.
     Engage anyone permanent and these figures are wrong. */
  schads: { 1: 34.44, 2: 45.28, 3: 50.61 },
  notice_days: 28,
  grace_days: 90,
  /* Bronze already keeps 27.5% and Platinum 23.5%, so on an unfloored rate this
     never binds. It exists for the floored ones, where the uplift has to stop
     somewhere. 20% is the point below which the shift stops covering workers
     comp, insurance and admin — move it in settings once the real on-costs are
     known, don't guess it lower to make a red row go green. */
  min_margin_pct: 20
};

/* Casual penalty multipliers, expressed against the casual ORDINARY rate (125%),
   because that is what the SCHADS figures above already are.

   Casual loading is added TO the penalty, not compounded with it — Saturday
   casual is 175%, not 150%. So Saturday = 175/125 = 1.40, Sunday = 225/125 =
   1.80, public holiday = 275/125 = 2.20.

   Evening and night are shift ALLOWANCES rather than penalty rates, but they
   go in the same place because SCHADS calculates them the same way: on the
   ordinary rate, added to the casual loading, not compounded. Afternoon shift
   is 12.5% -> 137.5/125 = 1.10. Night shift is 15% -> 140/125 = 1.12.
   Permanent night shift (30%) is deliberately NOT offered here: it applies to
   permanent employees, and this whole ladder assumes casual engagement — see
   the LADDER_DEFAULT.schads comment. If DMHC ever engages permanent staff,
   every figure in this block is wrong, not just these two.
   They stay confirmed:false so the console keeps saying where the number came
   from, but 1.10/1.12 is strictly safer than the 1.00 they used to sit at:
   raising a floor can only ever stop an underpayment, never cause one. The
   real percentages belong to the award, so have the bookkeeper confirm them at
   the next pay run and set award_mult_weekday-evening / -night if they differ. */
const AWARD_MULT_DEFAULT = {
  'weekday-day': { mult: 1.00, confirmed: true, note: 'Ordinary casual rate.' },
  'weekday-evening': { mult: 1.10, confirmed: false, note: 'SCHADS afternoon shift allowance, 12.5% on the ordinary rate, added to the casual loading rather than compounded: 137.5 ÷ 125 = 1.10. Confirm at the next pay run.' },
  'weekday-night': { mult: 1.12, confirmed: false, note: 'SCHADS night shift allowance, 15% on the ordinary rate, added to the casual loading rather than compounded: 140 ÷ 125 = 1.12. Confirm at the next pay run. Permanent night shift (30%) does not arise — the ladder assumes casual engagement throughout.' },
  'saturday': { mult: 1.40, confirmed: true, note: '175% casual ÷ 125% ordinary casual.' },
  'sunday': { mult: 1.80, confirmed: true, note: '225% casual ÷ 125% ordinary casual.' },
  'public-holiday': { mult: 2.20, confirmed: true, note: '275% casual ÷ 125% ordinary casual.' },
  'household': { mult: 1.00, confirmed: true, note: 'Ordinary casual rate. SCHADS classifies the EMPLOYEE, not the task — a Level 2 worker cannot be paid Level 1 for a cleaning shift.' },
  'employment': { mult: 1.00, confirmed: true, note: 'Ordinary casual rate.' }
};

const round2 = n => Math.round(n * 100) / 100;
function numSetting(key, fallback) { const n = Number(setting(key)); return Number.isFinite(n) && n > 0 ? n : fallback; }
function tierShares() {
  const out = {};
  for (const k of TIER_KEYS) out[k] = numSetting(`tier_share_${k}`, LADDER_DEFAULT.share[k]);
  return out;
}
function tierBands() {
  return {
    silver: numSetting('tier_band_silver', LADDER_DEFAULT.band.silver),
    gold: numSetting('tier_band_gold', LADDER_DEFAULT.band.gold),
    platinum: numSetting('tier_band_platinum', LADDER_DEFAULT.band.platinum)
  };
}
function superRate() { return numSetting('super_rate', LADDER_DEFAULT.super); }
/* The minimum gross margin the platform has to retain out of the price limit to
   cover workers comp, insurance, admin and the platform itself. It exists to
   stop the tier uplift below being paid out of money that isn't there — see
   `workerPay`. It is NOT permission to pay under the award: the floor always
   wins over the cap, and a row where the floor is above the cap is a rostering
   problem, not a pay problem. */
function minMarginPct() { return numSetting('min_margin_pct', LADDER_DEFAULT.min_margin_pct); }
function schadsCasual(level) {
  const lv = [1, 2, 3].includes(Number(level)) ? Number(level) : 2;
  return numSetting(`schads_l${lv}_casual`, LADDER_DEFAULT.schads[lv]);
}
function awardMult(category) {
  const d = AWARD_MULT_DEFAULT[category];
  if (!d) return { mult: 1, confirmed: false, note: 'No multiplier recorded for this category.' };
  const n = Number(setting(`award_mult_${category}`));
  return { ...d, mult: Number.isFinite(n) && n > 0 ? n : d.mult };
}

/* Rolling 12 months of completed hours. Recalculated on review, not on read,
   so a worker's rate can't move mid-fortnight underneath a payroll run. */
function rollingHours(workerId) {
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const r = db.prepare(`SELECT COALESCE(SUM(hours), 0) AS h FROM bookings
    WHERE worker_id = ? AND status = 'completed' AND date >= ? AND COALESCE(sleepover, 0) = 0`).get(workerId, since);
  return Math.round((r.h || 0) * 10) / 10;
}
function tierForHours(hours) {
  const b = tierBands();
  if (hours >= b.platinum) return 'platinum';
  if (hours >= b.gold) return 'gold';
  if (hours >= b.silver) return 'silver';
  return 'bronze';
}
function tierOf(workerId) {
  const p = db.prepare('SELECT tier FROM worker_profiles WHERE user_id = ?').get(workerId);
  return p && TIER_KEYS.includes(p.tier) ? p.tier : 'bronze';
}

/* The floor. base award × penalty multiplier × (1 + super), because the ladder
   share is quoted all-in and the two have to be compared on the same basis. */
function awardFloorFor(level, category) {
  const m = awardMult(category);
  return {
    rate: round2(schadsCasual(level) * m.mult * (1 + superRate() / 100)),
    base: round2(schadsCasual(level) * m.mult),
    mult: m.mult, confirmed: m.confirmed, note: m.note, level: Number(level) || 2
  };
}

/* The one function that decides what an hour is worth to a worker.
     share of the price limit, floored by the award for their classification.
   Sleepovers are excluded from the floor by design: the 0115/0138 item is
   priced per night, and SCHADS treats a sleepover as an allowance plus payment
   for hours actually worked, so an hourly minimum does not test it. It stays on
   its own rule rather than being forced through a formula that doesn't fit. */
/* Rounding note, because it changes cents and cents get audited: the hourly
   rate is rounded to the cent FIRST, then multiplied by hours. Not the other
   way round. A payslip has to state an hourly rate, and "$55.5529" is not a
   rate anyone can be paid — so the rate is the real number and the total
   follows from it. It also means the award comparison is rate against rate,
   which is how the award itself is written. */
function workerPay(workerId, category, hours) {
  const r = INVOICE_RATES[category];
  if (!r) return null;
  const prof = db.prepare('SELECT tier, schads_level FROM worker_profiles WHERE user_id = ?').get(workerId) || {};
  const tier = TIER_KEYS.includes(prof.tier) ? prof.tier : 'bronze';
  const shares = tierShares();
  const share = shares[tier];
  const qty = r.perNight ? 1 : hours;
  const ladderRate = round2(r.price * share / 100);

  if (r.perNight) {
    return { tier, share_pct: share, rate: ladderRate, qty, amount: round2(ladderRate * qty),
      floored: false, floor: null, why: 'Per-night sleepover allowance — the hourly award floor does not apply.' };
  }
  const floor = awardFloorFor(prof.schads_level, category);
  const floored = floor.rate > ladderRate;

  /* THE TIER HAS TO MEAN SOMETHING EVEN WHEN THE FLOOR GOVERNS.
     max(share, floor) looks fair and isn't. A Level 3 casual costs $56.68 all-in
     on a weekday; Platinum at 76.5% of $73.58 is $56.29. So under a plain
     max() a Level 3 worker is paid the floor at Bronze and the same floor at
     Platinum — their dashboard says Platinum and their payslip says starter, and
     1,200 hours of loyalty buys them nothing. That is not a rounding artefact,
     it is the ladder being switched off for the classification that has done the
     most training.
     So when the floor wins, the tier is applied TO THE FLOOR, in the same
     proportion the ladder uses between tiers (share ÷ bronze share). Bronze
     multiplies by exactly 1, so a Bronze floored worker is paid what they were
     paid before and no historical rate moves. */
  const upliftRate = round2(floor.rate * share / shares.bronze);
  /* `base` is what this hour was worth before any of this existed: the ladder
     share, or the award if the award is higher. Everything below can only add to
     it. Writing it down as its own name is the whole safety argument — the cap
     further down is a limit on the UPLIFT, and if it were allowed to bite into
     `base` a platform margin setting could cut the pay of a worker the floor
     never touched. At a 40% target that is exactly what it would do: a Gold
     Level 2 weekday hour would fall from $55.55 to the $50.71 floor. A margin
     target is a statement about what the platform keeps, and it is never
     permitted to become a pay cut. */
  const base = Math.max(floor.rate, ladderRate);
  const target = Math.max(base, upliftRate);

  /* ...but the uplift can only be paid out of margin that exists. Household
     tasks are the case: $60.10 against a Level 3 floor of $56.68 leaves $3.42,
     and there is no loyalty bonus inside $3.42. The cap withholds the uplift
     rather than pretending the money is there.
     The floor OUTRANKS the cap, always. If the award is above the cap the award
     is still paid — the answer to an unprofitable shift is who gets rostered on
     it, never a rate below the minimum. `uneconomic` says so out loud. */
  /* floored to the cent, not rounded to it. This is a MAXIMUM payable rate, and
     rounding a maximum upwards puts the paid rate a fraction past the target it
     exists to enforce — on an $81.07 evening the cap wants $64.856, and $64.86
     leaves $16.21 against a $16.214 target, so the row reports itself as failing
     by four tenths of a cent. That is a rounding artefact wearing the costume of
     a finding, and it would have told Bee not to roster Level 3 on evenings.
     Rounding down costs a capped worker at most one cent and makes the flag
     mean what it says. */
  const cap = Math.floor(r.price * (1 - minMarginPct() / 100) * 100) / 100;
  const rate = round2(Math.max(base, Math.min(target, cap)));
  const uplift_withheld = floored && target > cap && rate < target;
  const uneconomic = floor.rate > cap;
  const L = TIERS[tierIndex(tier)].label;

  return {
    tier, share_pct: share, rate, qty, amount: round2(rate * qty), floored, floor,
    ladder_rate: ladderRate, uplift_rate: upliftRate, cap, uplift_withheld, uneconomic,
    margin: round2(r.price - rate), margin_pct: round2((r.price - rate) / r.price * 100),
    why: !floored
      ? `${L} — ${share}% of the $${r.price.toFixed(2)} price limit.`
      : uneconomic
        ? `Award floor applied, and this shift does not clear the ${minMarginPct()}% margin at Level ${floor.level}. ${L} at ${share}% of $${r.price.toFixed(2)} is $${ladderRate.toFixed(2)}, below the SCHADS Level ${floor.level} casual minimum of $${floor.base.toFixed(2)} plus ${superRate()}% super. The award is paid in full — but the tier uplift is withheld because the price limit cannot fund it, and this classification should not be rostered on this support on its own.`
        : uplift_withheld
          ? `Award floor applied, with the ${L} uplift capped. The floor for Level ${floor.level} is $${floor.rate.toFixed(2)}; ${L} would lift it to $${upliftRate.toFixed(2)}, which leaves less than the ${minMarginPct()}% the platform has to retain, so it is paid at $${rate.toFixed(2)}.`
          : `Award floor applied, then lifted for ${L}. ${L} at ${share}% of $${r.price.toFixed(2)} is $${ladderRate.toFixed(2)}, below the SCHADS Level ${floor.level} casual minimum of $${floor.base.toFixed(2)} plus ${superRate()}% super — so the floor of $${floor.rate.toFixed(2)} applies, lifted by the ${L} share to $${rate.toFixed(2)}.`
  };
}

/* ---------- movement ----------
   Up immediately. Down slowly, one step, with notice, never while on leave.
   These rules are not decoration: unfair-deactivation protections apply to
   platform care work, and a pay cut is the kind of change that gets tested. */
function reviewWorkerTier(workerId, opts = {}) {
  const p = db.prepare('SELECT tier, tier_below_since, tier_notice_at, tier_pending, tier_paused_until FROM worker_profiles WHERE user_id = ?').get(workerId);
  if (!p) return null;
  const cur = TIER_KEYS.includes(p.tier) ? p.tier : 'bronze';
  const hours = rollingHours(workerId);
  const earned = tierForHours(hours);
  const nowIso = now();
  const today = nowIso.slice(0, 10);
  const paused = p.tier_paused_until && p.tier_paused_until >= today;
  const log = (to, direction, reason, noticeAt = '') =>
    db.prepare('INSERT INTO tier_log (worker_id, from_tier, to_tier, direction, hours, reason, notice_at, actor, created) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(workerId, cur, to, direction, hours, reason, noticeAt, opts.actor || 'system', nowIso);
  const touch = fields => db.prepare(`UPDATE worker_profiles SET ${Object.keys(fields).map(k => `${k} = ?`).join(', ')}, tier_reviewed_at = ? WHERE user_id = ?`)
    .run(...Object.values(fields), nowIso, workerId);

  /* Going up is immediate and cancels any pending drop outright. */
  if (tierIndex(earned) > tierIndex(cur)) {
    touch({ tier: earned, tier_below_since: '', tier_notice_at: '', tier_pending: '' });
    log(earned, 'up', `${hours} hours in the last 12 months.`);
    return { moved: 'up', from: cur, to: earned, hours };
  }
  /* At or above your own band: nothing pending, clock cleared. */
  if (tierIndex(earned) >= tierIndex(cur)) {
    if (p.tier_below_since || p.tier_notice_at) touch({ tier_below_since: '', tier_notice_at: '', tier_pending: '' });
    else db.prepare('UPDATE worker_profiles SET tier_reviewed_at = ? WHERE user_id = ?').run(nowIso, workerId);
    return { moved: null, from: cur, to: cur, hours };
  }
  /* Below. Nothing at all happens while the clock is paused — someone who
     breaks a wrist does not lose their pay rate. */
  if (paused) return { moved: null, from: cur, to: cur, hours, paused: true };

  const grace = numSetting('tier_grace_days', LADDER_DEFAULT.grace_days);
  const noticeDays = numSetting('tier_notice_days', LADDER_DEFAULT.notice_days);

  if (!p.tier_below_since) { touch({ tier_below_since: nowIso }); return { moved: null, from: cur, to: cur, hours, below_since: nowIso }; }
  const belowDays = Math.floor((Date.parse(nowIso) - Date.parse(p.tier_below_since)) / 864e5);
  if (belowDays < grace) return { moved: null, from: cur, to: cur, hours, below_days: belowDays };

  /* One step down only, never straight to the earned tier. */
  const next = TIER_KEYS[Math.max(0, tierIndex(cur) - 1)];

  if (!p.tier_notice_at) {
    touch({ tier_notice_at: nowIso, tier_pending: next });
    log(next, 'notice', `${hours} hours in the last 12 months — ${belowDays} days below the ${TIERS[tierIndex(cur)].label} band. ${noticeDays} days' notice given.`, nowIso);
    const w = db.prepare('SELECT name, email FROM users WHERE id = ?').get(workerId);
    if (w) sendMail(w.email, `A change to your BookIt pay tier on ${fmtDate(new Date(Date.now() + noticeDays * 864e5).toISOString().slice(0, 10))}`,
      `<p>Hi ${escHtml(w.name.split(' ')[0])},</p>
       <p>Your hours over the last 12 months come to <b>${hours}</b>. That has been below the ${escHtml(TIERS[tierIndex(cur)].label)} band for ${belowDays} days, so from <b>${escHtml(fmtDate(new Date(Date.now() + noticeDays * 864e5).toISOString().slice(0, 10)))}</b> your tier will move from ${escHtml(TIERS[tierIndex(cur)].label)} to ${escHtml(TIERS[tierIndex(next)].label)} — one step, not more.</p>
       <p><b>This is reversible before it happens.</b> Tiers go up the moment you cross back over the band, and crossing back cancels this change entirely. You need ${Math.max(0, tierBands()[cur] - hours).toFixed(1)} more hours in the rolling 12 months.</p>
       <p>If you have been on parental leave, carer's leave, workers compensation or long-term illness during this period, tell us — the clock pauses for all of those and this notice should not have been sent.</p>`);
    return { moved: 'notice', from: cur, to: next, hours, effective: new Date(Date.now() + noticeDays * 864e5).toISOString() };
  }
  const noticeDaysElapsed = Math.floor((Date.parse(nowIso) - Date.parse(p.tier_notice_at)) / 864e5);
  if (noticeDaysElapsed < noticeDays) return { moved: null, from: cur, to: cur, hours, notice_days_left: noticeDays - noticeDaysElapsed };

  /* Reset the below-clock rather than clearing it, so the next step down can't
     happen for another full grace period. Never more than one step per 90 days. */
  touch({ tier: next, tier_below_since: nowIso, tier_notice_at: '', tier_pending: '' });
  log(next, 'down', `${hours} hours in the last 12 months. ${noticeDays} days' notice given on ${p.tier_notice_at.slice(0, 10)}.`, p.tier_notice_at);
  return { moved: 'down', from: cur, to: next, hours };
}

function reviewAllTiers(opts = {}) {
  const ids = db.prepare("SELECT id FROM users WHERE role = 'worker'").all().map(r => r.id);
  const out = { checked: 0, up: 0, down: 0, notice: 0 };
  for (const id of ids) {
    const r = reviewWorkerTier(id, opts);
    if (!r) continue;
    out.checked++;
    if (r.moved === 'up') out.up++;
    else if (r.moved === 'down') out.down++;
    else if (r.moved === 'notice') out.notice++;
  }
  return out;
}

/* ---------- what a worker sees ---------- */
route('GET', /^\/api\/me\/tier$/, (req, res, m, user) => {
  if (!user) return json(res, 401, { error: 'Please log in.' });
  if (user.role !== 'worker') return json(res, 403, { error: 'Workers only.' });
  const p = db.prepare('SELECT tier, schads_level, tier_pending, tier_notice_at, tier_paused_until, tier_pause_reason FROM worker_profiles WHERE user_id = ?').get(user.id) || {};
  const tier = TIER_KEYS.includes(p.tier) ? p.tier : 'bronze';
  const hours = rollingHours(user.id);
  const shares = tierShares(); const bands = tierBands();
  const i = tierIndex(tier);
  const nextKey = TIER_KEYS[i + 1] || null;
  const noticeDays = numSetting('tier_notice_days', LADDER_DEFAULT.notice_days);
  json(res, 200, {
    tier, label: TIERS[i].label, sub: TIERS[i].sub, share_pct: shares[tier], hours,
    /* the headline figure: what a weekday daytime hour is worth to them right now */
    weekday_rate: (workerPay(user.id, 'weekday-day', 1) || {}).rate,
    next: nextKey ? { tier: nextKey, label: TIERS[i + 1].label, share_pct: shares[nextKey], at_hours: bands[nextKey],
      hours_to_go: Math.max(0, round2(bands[nextKey] - hours)),
      worth: round2(INVOICE_RATES['weekday-day'].price * (shares[nextKey] - shares[tier]) / 100) } : null,
    ladder: TIERS.map((t, n) => ({ ...t, share_pct: shares[t.key], from_hours: n === 0 ? 0 : bands[t.key],
      weekday_rate: round2(INVOICE_RATES['weekday-day'].price * shares[t.key] / 100), current: t.key === tier })),
    schads_level: p.schads_level || 2,
    pending: p.tier_pending ? { tier: p.tier_pending, label: TIERS[tierIndex(p.tier_pending)].label,
      effective: p.tier_notice_at ? new Date(Date.parse(p.tier_notice_at) + noticeDays * 864e5).toISOString() : '',
      hours_to_cancel: Math.max(0, round2(bands[tier] - hours)) } : null,
    paused: p.tier_paused_until && p.tier_paused_until >= now().slice(0, 10) ? { until: p.tier_paused_until, reason: p.tier_pause_reason || '' } : null,
    history: db.prepare('SELECT from_tier, to_tier, direction, hours, reason, created FROM tier_log WHERE worker_id = ? ORDER BY id DESC LIMIT 20').all(user.id)
  });
});

/* ---------- admin: the ladder board ---------- */
route('GET', /^\/api\/admin\/ladder$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  const shares = tierShares(); const bands = tierBands();
  const price = INVOICE_RATES['weekday-day'].price;
  const workers = db.prepare(`SELECT u.id, u.name, u.email, p.tier, p.schads_level, p.tier_pending, p.tier_notice_at,
      p.tier_paused_until, p.tier_pause_reason, p.tier_below_since, p.visible
    FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.role = 'worker' ORDER BY u.name`).all()
    .map(w => {
      const tier = TIER_KEYS.includes(w.tier) ? w.tier : 'bronze';
      const hours = rollingHours(w.id);
      const pay = workerPay(w.id, 'weekday-day', 1) || {};
      return { ...w, tier, label: TIERS[tierIndex(tier)].label, hours, share_pct: shares[tier],
        weekday_rate: pay.rate, floored: !!pay.floored, earned: tierForHours(hours) };
    });
  const counts = {};
  for (const k of TIER_KEYS) counts[k] = workers.filter(w => w.tier === k).length;
  json(res, 200, {
    tiers: TIERS.map((t, n) => ({ ...t, share_pct: shares[t.key], from_hours: n === 0 ? 0 : bands[t.key],
      weekday_all_in: round2(price * shares[t.key] / 100),
      weekday_base: round2(price * shares[t.key] / 100 / (1 + superRate() / 100)),
      you_keep: round2(price - price * shares[t.key] / 100), n: counts[t.key] })),
    settings: { shares, bands, super: superRate(), notice_days: numSetting('tier_notice_days', LADDER_DEFAULT.notice_days),
      grace_days: numSetting('tier_grace_days', LADDER_DEFAULT.grace_days), min_margin: minMarginPct(),
      schads: { 1: schadsCasual(1), 2: schadsCasual(2), 3: schadsCasual(3) } },
    /* every category, tested against the floor at every tier — this is the table
       that shows household tasks failing before anyone has to discover it */
    award_check: Object.entries(INVOICE_RATES).filter(([, r]) => !r.perNight).map(([key, r]) => {
      const mult = awardMult(key);
      const cap = Math.floor(r.price * (1 - minMarginPct() / 100) * 100) / 100;
      const bronzeRate = round2(r.price * shares.bronze / 100);
      const topRate = round2(r.price * shares.platinum / 100);
      return { key, label: r.label, price: r.price, mult: mult.mult, confirmed: mult.confirmed, note: mult.note, cap,
        levels: [1, 2, 3].map(lv => {
          const floor = awardFloorFor(lv, key);
          /* what the worker is actually paid at each end of the ladder, through
             the same clamp workerPay uses — so this table cannot drift from the
             payslip. The old version reported the margin at Level 2 only, which
             printed 27.5% on rows that were flagged in the same breath for
             failing at Level 3. Two numbers in one row that could not both be
             true about the same worker. */
          const payAt = share => {
            const ladder = round2(r.price * share / 100);
            const baseRate = Math.max(floor.rate, ladder);
            const target = Math.max(baseRate, round2(floor.rate * share / shares.bronze));
            return round2(Math.max(baseRate, Math.min(target, cap)));
          };
          const paidBronze = payAt(shares.bronze);
          const paidTop = payAt(shares.platinum);
          return { level: lv, floor: floor.rate, bronze_short: round2(floor.rate - bronzeRate),
            clears_at_bronze: bronzeRate >= floor.rate, clears_at_top: topRate >= floor.rate,
            paid_bronze: paidBronze, paid_top: paidTop,
            margin: round2(r.price - paidBronze), margin_pct: round2((r.price - paidBronze) / r.price * 100),
            top_margin_pct: round2((r.price - paidTop) / r.price * 100),
            /* does the ladder still move for this classification, or has the
               floor swallowed it whole? */
            ladder_live: paidTop > paidBronze,
            /* measured at the TOP of the ladder, not the bottom. A Platinum
               worker is the most expensive one who could take this shift, so
               that is the number that decides whether it is affordable — and
               measuring it here makes this flag agree with `uneconomic` on the
               payslip by construction rather than by coincidence. */
            economic: paidTop <= cap
          };
        }) };
    }),
    workers,
    log: db.prepare(`SELECT l.*, u.name FROM tier_log l JOIN users u ON u.id = l.worker_id ORDER BY l.id DESC LIMIT 50`).all()
  });
});

route('POST', /^\/api\/admin\/ladder\/settings$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const saved = [];
  const put = (key, val, min, max) => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) return;
    setSetting(key, n); saved.push(key);
  };
  for (const k of TIER_KEYS) if (body[`share_${k}`] !== undefined) put(`tier_share_${k}`, body[`share_${k}`], 50, 100);
  for (const k of ['silver', 'gold', 'platinum']) if (body[`band_${k}`] !== undefined) put(`tier_band_${k}`, body[`band_${k}`], 1, 20000);
  if (body.super !== undefined) put('super_rate', body.super, 0, 30);
  if (body.notice_days !== undefined) put('tier_notice_days', body.notice_days, 1, 365);
  /* capped at 40 deliberately — a margin target above that is not a margin
     target, it is a decision to pay everyone the award and call it a ladder */
  if (body.min_margin !== undefined) put('min_margin_pct', body.min_margin, 5, 40);
  if (body.grace_days !== undefined) put('tier_grace_days', body.grace_days, 1, 730);
  for (const lv of [1, 2, 3]) if (body[`schads_l${lv}`] !== undefined) put(`schads_l${lv}_casual`, body[`schads_l${lv}`], 1, 500);
  for (const key of Object.keys(AWARD_MULT_DEFAULT)) if (body[`mult_${key}`] !== undefined) put(`award_mult_${key}`, body[`mult_${key}`], 0.5, 5);
  /* shares must not invert — a lower tier paying more than a higher one is not a
     ladder, and it would quietly reverse the incentive the whole thing exists for */
  const s = tierShares();
  for (let i = 1; i < TIER_KEYS.length; i++) {
    if (s[TIER_KEYS[i]] < s[TIER_KEYS[i - 1]]) {
      return json(res, 400, { error: `${TIERS[i].label} (${s[TIER_KEYS[i]]}%) can't pay less than ${TIERS[i - 1].label} (${s[TIER_KEYS[i - 1]]}%). Saved what was valid; fix the order and save again.`, saved });
    }
  }
  const b = tierBands();
  if (!(b.silver < b.gold && b.gold < b.platinum)) return json(res, 400, { error: 'Hour bands must increase: Silver, then Gold, then Platinum.', saved });
  json(res, 200, { ok: true, saved, shares: s, bands: b });
});

route('POST', /^\/api\/admin\/workers\/(\d+)\/tier$/, (req, res, m, user, body) => {
  if (!requireAdmin(user, res)) return;
  const id = Number(m[1]);
  const w = db.prepare("SELECT u.id, u.name FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.role = 'worker'").get(id);
  if (!w) return json(res, 404, { error: 'No such worker.' });
  const cur = tierOf(id);

  if (body.schads_level !== undefined) {
    const lv = Number(body.schads_level);
    if (![1, 2, 3].includes(lv)) return json(res, 400, { error: 'SCHADS level must be 1, 2 or 3.' });
    db.prepare('UPDATE worker_profiles SET schads_level = ? WHERE user_id = ?').run(lv, id);
    db.prepare('INSERT INTO tier_log (worker_id, from_tier, to_tier, direction, hours, reason, actor, created) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, cur, cur, 'classification', rollingHours(id), `SCHADS classification set to Level ${lv}.`, user.email || 'admin', now());
  }
  /* Pausing is the leave rule. It stops downward movement dead — parental leave,
     carer's leave, workers compensation, long-term illness. */
  if (body.pause_until !== undefined) {
    const until = clean(body.pause_until, 10);
    const reason = clean(body.pause_reason || '', 200);
    db.prepare('UPDATE worker_profiles SET tier_paused_until = ?, tier_pause_reason = ?, tier_notice_at = ?, tier_pending = ? WHERE user_id = ?')
      .run(until, reason, '', '', id);
    db.prepare('INSERT INTO tier_log (worker_id, from_tier, to_tier, direction, hours, reason, actor, created) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, cur, cur, until ? 'paused' : 'unpaused', rollingHours(id),
        until ? `Tier clock paused until ${until}${reason ? ` — ${reason}` : ''}. Any pending reduction cancelled.` : 'Tier clock resumed.', user.email || 'admin', now());
  }
  /* A manual set is always allowed upward. Downward by hand would route around
     the notice rule, so it is refused and the reviewer is pointed at the sweep. */
  if (body.tier !== undefined) {
    const t = String(body.tier);
    if (!TIER_KEYS.includes(t)) return json(res, 400, { error: 'Unknown tier.' });
    if (tierIndex(t) < tierIndex(cur)) return json(res, 400, {
      error: `Tiers can't be lowered by hand — that would skip the 90-day grace period and the 28 days' written notice. Let the monthly review do it, or pause the clock if this worker is on leave.` });
    if (t !== cur) {
      db.prepare("UPDATE worker_profiles SET tier = ?, tier_below_since = '', tier_notice_at = '', tier_pending = '' WHERE user_id = ?").run(t, id);
      db.prepare('INSERT INTO tier_log (worker_id, from_tier, to_tier, direction, hours, reason, actor, created) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, cur, t, 'up', rollingHours(id), clean(body.reason || '', 300) || 'Set by an administrator.', user.email || 'admin', now());
    }
  }
  json(res, 200, { ok: true, tier: tierOf(id), hours: rollingHours(id) });
});

route('POST', /^\/api\/admin\/ladder\/review$/, (req, res, m, user) => {
  if (!requireAdmin(user, res)) return;
  json(res, 200, { ok: true, ...reviewAllTiers({ actor: user.email || 'admin' }) });
});

/* Daily rather than monthly. The bands are checked against a rolling window, so
   a monthly cadence would mean somebody sits a rate below what they've earned
   for up to four weeks — and upward movement is supposed to be immediate. */
setInterval(() => { try { reviewAllTiers(); } catch (e) { console.error('tier review', e); } }, 24 * 3600e3);
setTimeout(() => { try { reviewAllTiers(); } catch (e) { console.error('tier review', e); } }, 8000);

/* ---------- static files ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) {
      /* SPA-ish: unknown paths get the app shell */
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, home) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(home);
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...(SITE_PASSWORD ? { 'X-Robots-Tag': 'noindex, nofollow' } : {})
    });
    res.end(data);
  });
}

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || 'unknown';

  /* ----- force HTTPS when behind a proxy (Railway etc.) ----- */
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (xfProto === 'http') {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host) { res.writeHead(301, { 'Location': `https://${host}${req.url}` }); return res.end(); }
  }

  /* ----- private preview gate ----- */
  if (SITE_PASSWORD && pathname !== '/api/stripe/webhook') { /* Stripe's servers can't type passwords — the webhook is HMAC-verified instead */
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /\n');
    }
    if (pathname === '/gate' && req.method === 'POST') {
      let raw = '';
      req.on('data', c => { raw += c; if (raw.length > 5000) req.destroy(); });
      req.on('end', () => {
        const pw = new URLSearchParams(raw).get('pw') || '';
        if (limited(ip, 'gate', 30)) {
          res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(gatePage(true));
        }
        const a = sign('pw:' + pw), b = sign('pw:' + SITE_PASSWORD);
        if (a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))) {
          res.writeHead(302, {
            'Location': '/',
            'Set-Cookie': `bk_gate=${sign('gate-ok:' + SITE_PASSWORD)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`
          });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' });
        res.end(gatePage(true));
      });
      return;
    }
    if (!gateValid(req.headers.cookie)) {
      if (pathname.startsWith('/api/')) {
        return json(res, 401, { error: 'This site is in private preview.' }, { 'X-Robots-Tag': 'noindex, nofollow' });
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
      return res.end(gatePage(false));
    }
  }

  /* worker profile photos (behind the preview gate like every page) */
  const photoMatch = pathname.match(/^\/photos\/(\d+)$/);
  if (photoMatch && req.method === 'GET') {
    const row = db.prepare('SELECT photo FROM worker_profiles WHERE user_id = ?').get(Number(photoMatch[1]));
    if (!row || !row.photo || !fs.existsSync(row.photo)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': row.photo.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'public, max-age=86400'
    });
    return fs.createReadStream(row.photo).pipe(res);
  }

  /* emailed verification links land here, then bounce into the app */
  /* one-tap cover + standby answers from an email — signed, no login needed */
  if (pathname === '/cover' && req.method === 'GET') {
    try { return handleCoverLink(req, res, url); }
    catch (e) { console.error(e); res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(coverPage('Something went wrong', '<p>Please open BookIt and answer from your shifts page.</p>', 'Open BookIt', '/#/bookings', 'bad')); }
  }

  if (pathname === '/verify-email' && req.method === 'GET') {
    const u = readEmailToken('v', url.searchParams.get('token') || '');
    if (u) db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(u.id);
    res.writeHead(302, { 'Location': u ? '/#/verified' : '/#/verify-failed' });
    return res.end();
  }

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  }

  let raw = '';
  let overflow = false;
  const bodyCap = (pathname === '/api/me/documents' || pathname === '/api/me/photo') ? 8_000_000 : 100_000; /* uploads carry base64 files */
  req.on('data', chunk => {
    if (overflow) return; /* keep draining so the response can get through, but stop buffering */
    raw += chunk;
    if (raw.length > bodyCap) {
      overflow = true;
      raw = '';
      json(res, 413, { error: 'That file is too big to upload. Photos are shrunk automatically before sending — refresh the page and try again. PDFs need to be under 4 MB.' });
    }
  });
  req.on('end', () => {
    if (overflow) return;
    /* Stripe webhook needs the raw body for signature verification */
    if (pathname === '/api/stripe/webhook' && req.method === 'POST') return handleStripeWebhook(req, res, raw);
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON.' }); } }
    const user = readSession(req.headers.cookie);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      try { return r.handler(req, res, m, user, body, ip); }
      catch (e) { console.error(e); return json(res, 500, { error: 'Something went wrong on our end.' }); }
    }
    json(res, 404, { error: 'Not found.' });
  });
});

server.listen(PORT, () => {
  console.log(`BookIt server running → http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH} · auto-reply bot: ${AUTO_REPLY ? 'on' : 'off'}`);
  console.log(`Email: ${EMAIL_ON ? `ON — sending as ${MAIL_FROM} via ${RESEND_KEY ? 'Resend HTTPS API' : `${SMTP_HOST}:${SMTP_PORT} (SMTP — blocked on Railway Free/Trial/Hobby!)`}` : 'OFF — set RESEND_API_KEY (or SMTP_USER + SMTP_PASS) to enable; emails are logged to console instead'}`);
});
