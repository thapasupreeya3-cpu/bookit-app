# The Care Web v86.13.0 — executed verification

Date: 5 September 2026. Base: the uploaded v86.12.0 archive identified in `release-metadata.json`. All runtime tests used isolated, synthetic data. No production endpoint, real email, payment or participant file was used.

## Automated checks

Command: `npm run check` — **PASS**.

| Check | Actual result |
|---|---|
| JavaScript compilation | 32 script units, zero failures; includes all three inline application scripts |
| Generated route inventory | 304 registered routes; source matches committed inventory |
| Generated database inventory | 54 tables after boot; source matches committed inventory |
| Generated handover and release identity | Version/lockfile/schema/handover consistency verified |
| Original clash assertions | 21/21 passed |
| Original server smoke assertions | 218/218 passed |
| New focused unit assertions | 42/42 passed |
| New real-HTTP regression scenario groups | 25/25 passed |

A scenario group contains multiple assertions and requests; it is not counted as one assertion equivalent to a unit test. The complete command output is `validation/check-output.txt`. The standard GitHub Actions check command now includes the new tests; no new runtime dependencies were added.

The regression tests cover blocked workers and hard training across assignment routes, explicit confirmed-plan versions, rejection after a plan change, simultaneous cover claims, current and historical clinical permissions (including a positive authorised-read control), recurring changes, office-recorded evidence, worker/allied/standby signed links, message pagination and explicit read receipts, draft privacy/conflicts/restart/finalisation, referral qualification and historical payments, exact service areas, whole-visit windows, travel buffers, SIL template validation and role boundaries.

## Actual upgrade check

Created a synthetic database with the original v86.12.0 server, inserted a persistent settings sentinel, then booted v86.13.0 against that same database twice. Both boots succeeded. The existing setting was preserved; the new availability columns and draft table were present; `PRAGMA integrity_check` returned `ok`. Table count changed from 53 to 54. The temporary database and files were removed. Results: `validation/upgrade-check.json`.

## Interface checks

Chromium normal page navigation failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. The policy was not altered. Additional checks rendered the application HTML and actual JavaScript in memory with an adapter to the isolated local API. These are **not native-origin browser end-to-end checks**.

Participant visits-first layout, worker Bookings, availability, messaging and Admin Today were rendered and inspected. Actual JavaScript interactions passed for loading older messages and receiving new messages, note autosave/reopening, and saving availability. The tested worker/admin routes recorded no JavaScript errors. Worker and admin layouts were inspected at 390px; the worker settings page had a one-pixel scroll-width difference, not a large overflow. Summary: `validation/rendered-ui-summary.json`.

Native cookie behaviour, CSP, real navigation, email delivery/link previews, production video playback, screen-reader/assistive-device conformance and live deployment still require the staging checks in `RELEASE-NOTES.md`. These results are not a penetration test or a legal/award/retention certification.

## Runtime

Executed on Node **22.16.0** with npm **10.9.2** in this environment. The repository's existing `.nvmrc` pin (**22.23.2**) is retained rather than silently changed. The package accepts Node >=22.12 and <23; repeat checks on the deployment's pinned runtime and actual host before release.

## Package verification

The final root-relative ZIP is an overlay, not the full source tree. `RELEASE-FILES.json` lists each changed/new payload file with its SHA-256 and base hash when replacing an existing path. Its own hash is omitted to avoid a self-reference. Packaging excludes runtime data, secrets, dependencies and unchanged media. A copy of the untouched base is overlaid with the actual ZIP, all payload hashes are verified, and `npm ci --ignore-scripts` plus `npm run check` are required to pass before the archive is handed over.
