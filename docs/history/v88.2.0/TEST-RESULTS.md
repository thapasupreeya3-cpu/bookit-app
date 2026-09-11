# Executed verification — v88.2.0

Date: 11 September 2026. Base: `The-Care-Web-v88.1.5-source.zip`, SHA-256 `706621fe7a4532b11208c990ee81b303ae4526a5d44dfc7c44078fbcc23452e3`.

All application tests used isolated synthetic data and disabled external messaging/payment/AI services. No live participant data or real payments were used. This release was not deployed.

## Automated checks

`npm test` completed with exit 0. `npm run lint` compiled 50 JavaScript units, including four inline application scripts, with zero failures. The full `npm run check` release gate and final payload hash verification are included in the validation receipts.

| Suite | Result |
| --- | --- |
| Clash tests | 21/21 pass |
| Smoke tests | 231 PASS records; full suite completed |
| Review unit tests | 46 assertions pass |
| Review API scenarios | 25/25 pass |
| Graphics checks | 54/54 pass |
| Audit unit tests | 8/8 groups pass |
| Audit API scenarios | 23/23 pass; no startup errors |
| New workflow regression scenarios | 32/32 pass |
| JavaScript compilation | 50 units, zero failures |
| Generated inventories | 360 routes; 77 tables |
| Existing media, fonts and vendor assets compared with v88.1.5 | 113 files byte-for-byte unchanged |

Counts remain separate because scenarios contain multiple assertions and HTTP requests. The new suite is `tests/process-regression.js` and is included in `npm test` and `npm run check`.

## What the workflow suite exercises

Private versus missing funding; structured task ownership; scoped helper plan writes and revocation; stale plan revisions; asynchronous job locks/failures; durable outbox retry/digest/deduplication/revocation; completion by a voluntarily paused eligible worker; reviewed payroll batches and distinct external acknowledgement; task ownership/stage timing; confirmed intake revisions; duplicate uploads; interview booking and evidence; atomic selected-series acceptance; limited alternatives; routines without old notes; reviewed leave/cover; scoped visit and incident retry; preferred approvers; calendar UID, cancellation, revocation and reassignment; original invoice snapshots; receipt mismatches and retries; matching signed-payment event contents; replacement renewal tasks; follow-up and transition behaviour; disabled optional extraction; timing/privacy metrics; atomic settings; rebooking after a past interview; conflicting follow-up answers; helper visit privacy; and closure of personal workflow records.

Frontend panel rendering is executed in a JavaScript VM with a minimal document harness against real API responses for participants, workers and office users. It detects rendering/runtime errors. It does **not** simulate native browser layout, accessibility, focus, actual clicks, file selection or calendar-client synchronisation. Existing regression suites cover the underlying actions separately.

## Upgrade

The actual v88.1.5 server created a synthetic database. A historical register entry, a setting and an uploaded-file sentinel were added. The new server booted twice against the same database. Both boots passed SQLite integrity checks; 57 tables became 77, and the existing values and file were preserved. A worker without a register grant remained denied after both boots. The receipt is `validation/v88.2.0-upgrade-results.json`.

## Required staging checks and limits

The available runtime was **Node 24.19.0**. This package retains its declared **Node >=22.12 and <23** runtime and existing pin. Repeat `npm run check` on the declared Node 22 host before deployment. npm emitted an inherited http-proxy environment warning; it did not fail a suite.

The advertised browser could not navigate to the local site (`net::ERR_BLOCKED_BY_CLIENT`). No complete native-browser, mobile, keyboard or screen-reader pass is claimed. Verify plan conflicts, multi-file upload recovery, shift travel fields, dialogs, reminder login return, reporting filters and account switching in a staging browser.

The existing provider-estimate tests use a deterministic local stub. Live Google estimates, email/SMS delivery, Stripe checkout/webhook events, external payroll, real calendar-client refresh, AI extraction/model accuracy and cloud backup destinations were not exercised. Optional extraction gates and payment-event matching were tested locally; provider round trips remain configuration and staging checks. No external service credentials or contracts are bundled. Email can be delivered more than once after an ambiguous transport acknowledgement; invoice creation remains deduplicated.

The task metrics measure observed activity after this release. There is no pre-release timing baseline or proven percentage time saving. No current rate-schedule, tax, wage or regulatory compliance certification is claimed.

Older receipts in `validation/` and `docs/history/` describe their named earlier releases, not additional tests of v88.2.0.
