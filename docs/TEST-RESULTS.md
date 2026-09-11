# Executed verification — v88.2.1

11 September 2026. Baseline: `The-Care-Web-v88.2.0-source.zip`, SHA-256 `05ad3387a585a2a8fa0fb7e12f859a11379c41e115d1e99a7041194f45491d8a`.

Tests used isolated synthetic data. External email, payment and AI services were disabled. No production users, messages or payments were changed. This source was not deployed.

## Automated results

`npm test` completed with exit 0. The complete release gate and final payload verification are recorded in the included validation receipts.

| Suite | Result |
| --- | --- |
| JavaScript compilation | 53 units, zero failures; includes four inline application scripts |
| Clash tests | 21/21 pass |
| Smoke tests | 231 PASS records; complete suite passed |
| Review unit tests | 46 assertions pass |
| Review API scenarios | 25/25 pass |
| Graphics checks | 54/54 pass |
| Audit unit groups | 8/8 pass |
| Audit API scenarios | 23/23 pass |
| Earlier workflow scenarios | 32/32 pass |
| New admin verification scenarios | 16/16 pass |
| Standalone preview | Three inline scripts compile |
| Generated inventories | 363 routes and 79 tables |

Scenario and assertion counts have different granularity and are not summed. `tests/admin-verification-tests.js` is run through `npm run test:verification`, included in `npm test` and `npm run check`.

## New verification coverage

The new suite tests anonymous/non-admin denial; queue filtering and validation; safe file URLs and private path exclusion; explicit review method/evidence/confirmation; the established document writer and attributable history; duplicate and stale decisions; document ownership; expired-evidence acknowledgement without eligibility override; participant review without funding changes or blanket approval; retained evidence and replacement requests; invalid dates and duplicate requests; reviewer assignment and filtering; separate screening/recruitment decisions; current-version plan review; pagination beyond 30 files; closed-file exclusion; frontend double-submit prevention against the real API; and rendering every panel with real API responses and escaped user text.

The frontend checks use a JavaScript VM and a minimal document/form harness. They exercise rendering and a real form-to-API path, including duplicate-submission handling. They do not reproduce native browser layout, PDF rendering, file selection, focus order, mobile gestures or assistive technology.

## Upgrade and assets

The actual v88.2.0 server created a synthetic database with a historical register entry, a setting and an uploaded-file sample. v88.2.1 then booted twice against it. Both boots passed SQLite integrity checks, retained the existing values/file, and kept an ungranted worker denied access to the register. Table count changed from 77 to 79. The receipt is `validation/v88.2.1-upgrade-results.json`.

Existing public media, fonts and vendor files are compared byte-for-byte against v88.2.0. The asset-preservation receipt identifies the count and any differences. New verification CSS/JavaScript and the sample preview are additions; the public brand assets are not replaced.

## Limits

The available execution runtime was **Node 24.19.0**. The repository retains **Node >=22.12 and <23** and its existing pin. Repeat `npm run check` on the declared Node 22 host before deployment. The inherited npm http-proxy warning did not fail a suite.

The supported browser could not open the local site (`net::ERR_BLOCKED_BY_CLIENT`). No native desktop/mobile, keyboard or screen-reader pass is claimed. In staging, verify the two-column layout, small-screen stacking, sticky queue, tab/document focus, preserved form drafts after conflict, PDF/image previews, zoom controls, reminder delivery and account switching. The sample HTML is a design preview, not evidence of a live browser test.

Live messaging providers, calendar clients, Stripe, AI processing and the deployed site were not exercised. Existing provider simulations remain synthetic. No current regulatory, tax or wage-rate certification is claimed. Older receipts in `docs/history/` and `validation/` refer to their named releases.
