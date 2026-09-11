# The Care Web v86.13.0 — source-review update

This is a root-relative, changed/new-files overlay for the user's uploaded v86.12.0 repository. See `release-metadata.json` for the exact base archive hash and embedded commit metadata. Remote HEAD was not read or updated. The existing public design, scene videos, photography, level artwork, branding and single-server architecture remain.

## Upload and deployment

Extract the ZIP. At the **existing repository root**, use **Add file → Upload files**, and drag the extracted files and folders, not the ZIP and not an enclosing folder. Commit together. Preserve all unchanged repository files, including `public/assets/fonts`, media and vendor assets. Every packaged path is relative to root. No deletion is required and no production database, secrets or dependencies are included.

GitHub's browser upload accepts up to 100 files at once, with a 25 MiB per-file limit. This overlay is built below both limits. Official workflow reference: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository

The pre-existing GitHub Actions workflow already runs `npm run check`; it therefore runs the expanded tests without needing a hidden workflow-file upload. Wait for it to finish. The unchanged `.nvmrc` specifies the repository's deployment pin; local test runtime is separately reported in `TEST-RESULTS.md`.

Before production deployment, create and verify the authorised backup set of database **and** document/photo folders. Compare remote work with the named base before replacing files if newer work has landed. Use your existing approved updater; the previous handover uses `sudo bookit-update`. This release does not run it for you. After boot confirm `/api/version` and inspect the service log. Environment overrides of `SCHEMA_VERSION` should not continue to report an old schema identifier.

## Changes to plan for

**Confirm worker areas before relying on new matching.** Go to worker Settings → Availability and service areas. Empty areas mean the worker's own profile suburb only, not all locations. Areas must be explicitly listed as exact suburb-and-state strings or postcodes. A participant with no recorded location will not be silently matched everywhere. No service areas were guessed or mass-populated on production profiles.

Workers may declare weekly windows, leave and travel buffers. Without precise windows the existing usual weekdays remain, with the limitation stated. New requests, cover and reassignments are checked again at acceptance. Changing availability does not silently cancel accepted work: the worker/office must arrange cover for commitments they can no longer meet.

**Replacement workers accept for themselves.** Office assignment in open cover now sends an offer; it does not mean the visit is staffed. The existing exceptional office-review action remains for a real documented conversation, with plan version and agreement evidence. It cannot override a block, lack of clearance, hard training lock, wrong service, geography, availability or a clash.

**Plan access ends when the relevant relationship ends.** Historical work no longer grants access to new clinical instructions. A current requested/accepted visit or live eligible cover invitation can grant the preparation access needed to decide about a visit. Worker-owned historical shift notes remain readable under the existing historical-record route.

**Messages have explicit pages and read receipts.** Newest messages appear first as a page, displayed chronologically. Load earlier messages retrieves older pages. Polling reads forward from the newest loaded ID, so bursts do not silently disappear. GET does not mark unread messages read.

**Drafts are not final evidence.** A worker's draft is saved in the application database, recoverable on return, private to that worker and revision-protected. Completion creates the existing immutable note and removes its draft atomically. When a conflict is shown, copy the unsaved text before loading another tab's version. Live-browser close/navigation and mobile interruption checks remain part of staging acceptance.

**Referral corrections are not repayments.** Qualification uses only eligible ordinary shift hours. Below-threshold unpaid awards are held from payroll; an already-paid award remains recorded and is flagged, never silently deleted or clawed back. Review historical awards in Growth & money.

## Schema and existing data

Boot adds four availability fields to `worker_profiles`, two provenance fields to `plan_acks`, two review fields to `referrals`, an incident owner field, the `shift_note_drafts` table and two indexes. These are additive, idempotent changes. Tests include restart against the same upgraded database.

Run the included read-only triage on the authorised host:

```sh
node --no-warnings scripts/review-existing-data.js /actual/path/to/bookit.db
```

It reports only row identifiers and issue categories for invalid open visits, blocked-worker assignments, below-threshold referral awards and worker areas awaiting confirmation. It is not a repair script. Investigate through The Care Web and retain the evidence/history; do not automatically rewrite delivered records. Do not upload real output to public GitHub.

For a rollback, stop and assess with the operator. Reverting source alone restores the old vulnerabilities even though the additive schema is backwards-compatible in shape. A data restore must use the matching database/documents/photos set and must account for work created since the backup. No automated rollback or live data migration was executed here.

## Staging acceptance

Use synthetic data to test normal sign-in and admin MFA on the actual origin; open a worker offer link from email, acknowledge the displayed current plan and accept once; test participant blocks and replacement cover; test a postcode/suburb and overnight window; read a long message thread, send while older history is open, and confirm receipts; write a note, leave/reopen, handle two-tab conflict and complete it; inspect Today and incident owner edits on phone and desktop; check media playback, cookie settings, CSP and keyboard navigation; test a representative invoice/claim/payroll export in a non-payment environment. Use the existing authorised backup/restore procedure to verify restoration onshore.

This is not a penetration-test certificate, a full accessibility conformance report, an award-payroll or NDIS legal opinion, or proof of the live deployment's operation. It is tested code implementing the latest source-based assessment. The earlier guide-only legal/retention concerns remain explicitly outside this software release's certification.


# The Care Web v86.14 — out-of-area visits, and Google drive times

**What changed.** As shipped in v86.13.0, a booking outside a worker's declared service areas was refused — and with no worker having declared areas, that would have stopped every cross-suburb request on deploy day. It is now a warning the person confirms: the participant sees how far and how long (with a link to the route on Google Maps) and confirms; the worker sees the same before accepting and confirms for themselves; the booking records both. The office's own assignment, series edits and open-shift claims work the same way. Automatic pools (cover offers, "next free") stay in-area — an automatic pool never confirms on anyone's behalf.

**Where the distance comes from.** Without a key, The Care Web estimates from static locality centroids in `data/au-localities.json` (no network, no dependency) and labels it an estimate. With a key it asks Google's Routes API (Compute Route Matrix — the successor to the legacy Distance Matrix API), remembers each suburb pair for 24 hours, and falls back to the estimate if Google does not answer within three seconds. The route link is Google's documented Maps URL scheme and is free.

**Turning it on.** In Google Cloud: create a project, link billing and set a budget alert, enable the **Routes API** (not Distance Matrix), create an API key, restrict it to the Routes API and to the server's IP. On the host: add `GOOGLE_MAPS_KEY=…` to `/etc/bookit.env`, then `sudo systemctl restart bookit`. Test by booking a worker whose stated area is elsewhere: the warning should say "in current traffic". Never commit the key.

**What it costs** (Google's global price list, September 2026, US dollars). The Care Web asks for the drive time in current traffic, which is the *Compute Route Matrix Pro* SKU: the first 5,000 lookups a month are free, then US$10 per 1,000. One lookup is one origin to one destination, only when a chosen worker is outside their stated area, cached for 24 hours — a busy month is a few hundred lookups. Set `GOOGLE_MAPS_TRAFFIC=off` to ask without traffic instead: the *Essentials* SKU, 10,000 free then US$5 per 1,000, giving the road-and-speed-limit time rather than the time right now. Google has no hard billing cap by default; the budget alert, and a daily quota on the Routes API in the Cloud console, are the safety nets.

**Schema.** One additive column: `bookings.out_of_area`.


# The Care Web v87.0.0 — the rebrand

**What changed.** The product is now **The Care Web** at **thecareweb.com.au**; the registered provider is unchanged (Disability and Mental Health Care Pty Ltd). Every user-facing name, title, email sender, link and policy page was changed. The wordmark keeps the two overlapping circles and the tick (two lives, one web of care) and reads *the care web*.

**What deliberately did not change**, because renaming it would break a running deployment for no visible benefit: the systemd service (`bookit`), the env file (`/etc/bookit.env`) and its variable names (`BOOKIT_*`), the database and folders (`bookit.db`, `bookit-docs/`, `bookit-photos/`), the update script (`sudo bookit-update`), the backup units, the session cookie (`bk_session` — renaming it logs everyone out), CSS class prefixes, and the GitHub repository name. Demo accounts keep their `@demo.bookit.life` addresses and the code also recognises `@demo.thecareweb.com.au`.

**Cutting the domain over** (in this order, so nothing is down):
1. DNS: at the registrar for thecareweb.com.au, add an A record for `@` and for `www` to `15.134.116.135`. Wait until `ping thecareweb.com.au` answers from the server's IP.
2. Caddy: on the server, `sudo nano /etc/caddy/Caddyfile`; add `thecareweb.com.au, www.thecareweb.com.au` to the site address (keep `bookit.life` there too for now) and `sudo systemctl reload caddy`. Caddy fetches the new certificate automatically; check `https://thecareweb.com.au/api/version`.
3. Email: in Zoho Mail, add the domain thecareweb.com.au, verify it, add its MX, SPF and DKIM records at the registrar, create `hello@thecareweb.com.au`, and set the old address to forward to it.
4. Settings: in `/etc/bookit.env` set `APP_URL=https://thecareweb.com.au` and `MAIL_FROM=hello@thecareweb.com.au` (and the SMTP user if it changed), then `sudo systemctl restart bookit`. Emailed links now point at the new domain.
5. Stripe: update the business name, statement descriptor and the webhook endpoint URL to `https://thecareweb.com.au/api/stripe/webhook`.
6. Redirect: once the new domain works, change the Caddyfile so `bookit.life` and `www.bookit.life` 301-redirect to `https://thecareweb.com.au{uri}`; keep the old domain registered for at least a year so old links, business cards and Google results keep working.
7. Tell people: participants, workers, plan managers and the NDIS Commission (your provider record lists a website and email).

**Schema.** None.
