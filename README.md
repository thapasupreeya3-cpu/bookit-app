# BookIt — the app

The full BookIt platform: the website plus a real backend with accounts, live messaging and bookings. Built for Disability & Mental Health Care Pty Ltd (Registered NDIS Provider 4-LO5XNY0).

**Zero dependencies.** One Node.js server, one SQLite database file, one front-end file. Nothing to `npm install`.

## Run it

You need Node.js 22.5 or newer (nodejs.org — the LTS download is fine).

```
node server.js
```

Then open http://localhost:3000. That's the whole thing.

First run creates `bookit.db` (the database) and seeds it with 12 demo workers and a demo participant:

| Account | Email | Password |
|---|---|---|
| Participant | demo@demo.bookit.life | demo1234 |
| Worker (Sarah M.) | sarah@demo.bookit.life | demo1234 |
| Workers (11 more) | daniel@… priya@… tom@… amara@… liam@… grace@… noah@… isabella@… zoe@… kai@… elena@…@demo.bookit.life | demo1234 |

## What works

- **Accounts** — participants and workers register from the Get Started page and log in from the nav. Passwords are scrypt-hashed; sessions are signed HttpOnly cookies (30 days).
- **Account menu** — once logged in, the nav shows your photo (or initials) as a chip. It opens a role-aware menu: bookings, messages (with the unread count), profile & credentials for workers (with a live "profile live / awaiting approval" status), billing details for participants, the admin dashboard for admins, incident reporting for everyone, help and log out. Menu links deep-link to the right card on the Bookings page and highlight it.
- **Find workers** — served live from the database. New workers appear the moment they register.
- **Worker profile pages** — every worker gets a real, shareable page (`#/worker/id`): photo hero with verified badge and stat strip (rating, shifts completed, joined date, languages), about + facts, the support they offer with icons, a typical-availability week, checks & credentials (real uploaded documents shown label + month-level expiry only — never numbers or dates — with a "Verified by BookIt" badge once an admin verifies), and a sticky booking card with the NDIS rate, Request a booking, Message, Save (starred on Find workers, kept on the device) and Share (copies the link). Workers see their own page with an "exactly as participants see it" note and an Edit button; pending workers are told their page goes live on approval. Workers edit bio, photo, typical availability (day toggles), languages and experience from their Bookings page.
- **Messaging** — real conversations stored in the database, with unread badges and 5-second polling. Seeded demo workers send one automatic acknowledgement per conversation so demos feel alive (clearly labelled; turn off with `AUTO_REPLY=off`).
- **Bookings** — participants request a booking from a worker's profile (service, date, time, hours, notes); workers accept or decline from their Bookings page; participants can cancel. Status history stays visible to both sides.
- **Shift completion → invoicing** — on/after the shift date the worker presses "Mark shift completed". The server prices it at the 2026–27 NDIS price limits (weekday day/evening/night, Sat, Sun, household cleaning — auto-picked from the shift's date and time), stores the total + the 72% worker share, and emails the participant a summary. Admins see every completed shift in the dashboard's Invoicing table, can switch any line's rate (e.g. to Public holiday, which can't be auto-detected), and **download an invoice CSV** ready for claiming/bookkeeping.
- **Email** — welcome + email-confirmation on registration, self-serve password reset (forgot → emailed link → new password), booking notifications (request → worker; accepted/declined → participant; cancelled → worker) and a copy of every contact-form message to your inbox. Sends through your own Zoho mailbox (see below); with no SMTP settings, email is off and everything else still works. Demo accounts are never emailed.
- **Claims & payments** — participants record how their plan is managed (NDIA / plan / self) plus NDIS number and plan-manager email (at registration or from the Billing details card on their Bookings page). The admin dashboard's **Claims & payments** section then automates the money: press **Run claims & invoices** and NDIA-managed shifts join a **PACE-format bulk claim CSV** (16 columns, DD/MM/YYYY, support item numbers auto-suggested per service and day-type, every line editable) ready to upload in the myplace provider portal, while plan-managed and self-managed shifts get a **PDF tax invoice generated and emailed automatically** from your mailbox. Mark lines paid as money lands; paid lines leave the claim file. Payroll CSV exports each worker's shares. Env: `NDIS_REG_NO` (defaults 4-LO5XNY0 — confirm the exact registration number your portal expects) and `BANK_DETAILS` (printed on invoices for payers).
- **Credentials — the automatic checker** — workers upload their NDIS Worker Screening Check, WWCC and First Aid (number, expiry, PDF/JPG/PNG file) from their Bookings page. The system watches expiry dates twice a day: email warnings to worker + admin at 30 and 7 days out, and **automatic hiding of any worker whose screening lapses** (with emails both ways). Approval of a new worker is **blocked without a current screening on file** unless the admin ticks an explicit override. Admins record their one-click "verified in the NDIS Worker Screening Database" per document (the NWSD has no public API, so that check is a human step — the system records who and when). Files live in a `bookit-docs` folder next to the database (covered by server snapshots; excluded from git).
- **Incident register** — workers and admins log incidents; the five serious categories + unauthorised restrictive practice are auto-flagged REPORTABLE with the Commission deadline clock (24 hours / 5 business days) counting down in the dashboard, urgent email to the admin, mark-notified and close-with-lessons workflow, and a CSV register export for audits.
- **Complaints register** — contact-form messages with the complaint topic land in the register automatically; phone/email/in-person complaints can be logged manually; acknowledge → resolve-with-outcome workflow and CSV export.
- **Worker vetting** — new workers register but stay **hidden** from Find Workers (and can't receive messages or bookings) until an admin approves them. You get an email when someone applies; they get an email when approved.
- **Admin dashboard** — `#/admin` for accounts listed in `ADMIN_EMAILS`: live counts, pending worker approvals (approve/hide), recent bookings, contact-form messages and a user list.
- **Contact form** — messages stored in the `contact_messages` table (and emailed to you when email is on).
- **Demo fallback** — the same front-end file still works with no server at all (opened directly or hosted statically): it detects the missing API and falls back to the simulated demo.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `SECRET` | auto-generated to `.secret` | Session-signing key. Set it explicitly in production so sessions survive redeploys |
| `DB_PATH` | ./bookit.db | Where the SQLite database lives |
| `AUTO_REPLY` | on | `off` disables the demo auto-acknowledgement bot |
| `SITE_PASSWORD` | (unset) | Set it to lock the whole site behind a private-preview password screen (pages *and* API), with search engines told to stay away. Delete the variable and redeploy to go public |
| `RESEND_API_KEY` | (unset) | API key from resend.com — sends email over HTTPS. **Use this on Railway**: Railway blocks outbound SMTP on Free/Trial/Hobby plans, so Zoho SMTP times out there. Takes priority over SMTP when both are set |
| `SMTP_USER` | (unset) | The mailbox the app sends as, e.g. `hello@bookit.life` — SMTP path, for hosts that allow port 465 (e.g. your own AU VPS) |
| `SMTP_PASS` | (unset) | That mailbox's password — or a Zoho app password if MFA is on. **Both SMTP_USER and SMTP_PASS set = email on** |
| `SMTP_HOST` | smtppro.zoho.com.au | Zoho AU paid-org SMTP server (change only if Zoho's "Server Configuration Details" in Mail Settings says otherwise) |
| `SMTP_PORT` | 465 | SSL port |
| `MAIL_FROM` | = SMTP_USER | From address — must be the account address or one of its Zoho aliases |
| `APP_URL` | (auto from request) | Absolute base for links in emails, e.g. `https://demo.bookit.life` — set it in production |
| `ADMIN_EMAILS` | (unset) | Comma-separated account emails that get the admin dashboard (`#/admin`) and worker-approval powers, e.g. `you@gmail.com,ops@bookit.life` |
| `NDIS_REG_NO` | 4-LO5XNY0 | Provider registration number stamped into the PACE claim file — confirm the format your provider portal expects |
| `BANK_DETAILS` | (unset) | e.g. `BSB 000-000 · Acct 12345678 · Account name` — printed on PDF invoices so plan/self-managed payers know where to pay |

After setting the SMTP variables, log in with a real (non-demo) account and `POST /api/email-test` — or just register a fresh account — to confirm sending works. Failures are logged with the exact SMTP error.

## Private preview mode

Until you're ready for the public, set the `SITE_PASSWORD` environment variable. Every visitor sees a branded password screen first; the password unlocks the site for 30 days on that device. Search engines get `noindex` headers and a blocking robots.txt the whole time. To launch, just delete the variable.

## Deploying

Any host that runs Node works. The easy paths:

- **Railway / Render / Fly.io** — create a project from this folder, set the start command to `node server.js`, add a persistent volume mounted where `DB_PATH` points (so the database survives restarts), set `SECRET`, and attach your domain (bookit.life). These platforms give you HTTPS automatically.
- **A VPS** (e.g. a $10/month box in an Australian region): install Node 22, run the server under `systemd` or `pm2`, and put Caddy or nginx in front for HTTPS on bookit.life.

**Back up `bookit.db`** — it is your entire database. Copying that one file (while the server is briefly stopped, or via `sqlite3 bookit.db ".backup backup.db"`) is a complete backup.

## Before real participants use it — the honest checklist

This is a working MVP, deliberately simple. Before onboarding real people:

- **Hosting in Australia + HTTPS** — participant data should live in an Australian region, always encrypted in transit.
- **Email is in** ✓ — verification, password reset and booking notifications all send through your Zoho mailbox once `SMTP_USER`/`SMTP_PASS` are set. Zoho caps how many emails a mailbox can send per day (fine for an MVP; move to a transactional service like ZeptoMail or Resend when volume grows).
- **Worker vetting is in** ✓ — new workers stay hidden until you approve them from `#/admin` after sighting their NDIS Worker Screening, WWCC and First Aid. The *documents themselves* still live outside the platform (email/drive) — an upload-and-store flow is a future build.
- **Invoice lines are in ✓, money movement isn't** — the CSV gives you priced, claim-ready lines, but actually claiming from the NDIA (PACE/myplace or plan managers) and paying workers still happens outside the platform. Note: whole shifts get one rate category; a shift spanning day+evening should be split into two bookings if you want it priced exactly.
- **Privacy obligations** — as a registered provider you're subject to the Privacy Act and NDIS Practice Standards for records: written privacy policy, data-breach plan, retention rules. The database makes this easy to honour but the policies are yours to set.
- **Scale** — single process + SQLite comfortably handles thousands of users for an MVP; revisit when you're past that.

## The database

SQLite tables: `users`, `worker_profiles`, `conversations`, `messages`, `bookings`, `contact_messages`. Inspect it any time with `sqlite3 bookit.db` or a GUI like DB Browser for SQLite. Contact-form submissions: `SELECT * FROM contact_messages ORDER BY id DESC;`
