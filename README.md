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
- **Find workers** — served live from the database. New workers appear the moment they register.
- **Messaging** — real conversations stored in the database, with unread badges and 5-second polling. Seeded demo workers send one automatic acknowledgement per conversation so demos feel alive (clearly labelled; turn off with `AUTO_REPLY=off`).
- **Bookings** — participants request a booking from a worker's profile (service, date, time, hours, notes); workers accept or decline from their Bookings page; participants can cancel. Status history stays visible to both sides.
- **Shift completion → invoicing** — on/after the shift date the worker presses "Mark shift completed". The server prices it at the 2026–27 NDIS price limits (weekday day/evening/night, Sat, Sun, household cleaning — auto-picked from the shift's date and time), stores the total + the 72% worker share, and emails the participant a summary. Admins see every completed shift in the dashboard's Invoicing table, can switch any line's rate (e.g. to Public holiday, which can't be auto-detected), and **download an invoice CSV** ready for claiming/bookkeeping.
- **Email** — welcome + email-confirmation on registration, self-serve password reset (forgot → emailed link → new password), booking notifications (request → worker; accepted/declined → participant; cancelled → worker) and a copy of every contact-form message to your inbox. Sends through your own Zoho mailbox (see below); with no SMTP settings, email is off and everything else still works. Demo accounts are never emailed.
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
