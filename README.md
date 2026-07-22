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
- **Contact form** — messages stored in the `contact_messages` table.
- **Demo fallback** — the same front-end file still works with no server at all (opened directly or hosted statically): it detects the missing API and falls back to the simulated demo.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `SECRET` | auto-generated to `.secret` | Session-signing key. Set it explicitly in production so sessions survive redeploys |
| `DB_PATH` | ./bookit.db | Where the SQLite database lives |
| `AUTO_REPLY` | on | `off` disables the demo auto-acknowledgement bot |
| `SITE_PASSWORD` | (unset) | Set it to lock the whole site behind a private-preview password screen (pages *and* API), with search engines told to stay away. Delete the variable and redeploy to go public |

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
- **No email yet** — there's no email verification, password reset or notification email. Add an email service (e.g. Resend, Postmark) before launch; until then, password resets are manual (delete the user's row or update their hash).
- **Worker verification is a flag, not a process** — registration makes a worker visible immediately. In production you'd set `worker_profiles.visible = 0` by default and flip it after checking their NDIS Worker Screening, WWCC, First Aid etc. (one-line change in server.js, marked in the code).
- **Payments/claiming isn't built** — bookings track status only. Invoicing and NDIS claiming are the next major build.
- **Privacy obligations** — as a registered provider you're subject to the Privacy Act and NDIS Practice Standards for records: written privacy policy, data-breach plan, retention rules. The database makes this easy to honour but the policies are yours to set.
- **Scale** — single process + SQLite comfortably handles thousands of users for an MVP; revisit when you're past that.

## The database

SQLite tables: `users`, `worker_profiles`, `conversations`, `messages`, `bookings`, `contact_messages`. Inspect it any time with `sqlite3 bookit.db` or a GUI like DB Browser for SQLite. Contact-form submissions: `SELECT * FROM contact_messages ORDER BY id DESC;`
