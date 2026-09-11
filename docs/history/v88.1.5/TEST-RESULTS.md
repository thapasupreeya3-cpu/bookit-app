# The Care Web v88.1.5 — executed verification

Date: 11 September 2026. Base: `bookit-app-main (4).zip`, v88.1.4, SHA-256 `51dc1f1f1afa32718e47576a2b6e49c311f7cce80549f81400ba5e6c3347fa18`.

All runtime data was synthetic and isolated. No real participant records, live messages or payments were used.

## Release gate

Executed `npm run check`, exit **0**, on Node **24.19.0**. The output is `validation/v88.1.5-check-output.txt` and the receipt is `validation/v88.1.5-check-receipt.json`.

| Component | Result |
| --- | --- |
| JavaScript compilation | 42 units, 0 failed, including 3 inline application scripts |
| Inventory verification | pass; 306 routes and 57 tables |
| Release document and full payload hash verification | pass |
| Clash tests | 21/21 pass |
| Smoke tests | 231 PASS records; full suite completed |
| Review unit tests | 46 assertions pass |
| Review integration | 25/25 scenario groups pass |
| Graphics checks | 54/54 pass, against the shipped design |
| New audit unit tests | 8/8 groups pass |
| New audit API tests | 23/23 groups pass |

Counts are deliberately separate: scenario groups contain multiple assertions and HTTP requests. The new audit tests run through `npm run test:audit`, which is included in `npm test` and the repository check workflow. The original negative-hours smoke fixtures now use a valid shift note and assert the specific hours-validation error.

## Upgrade and operational checks

- Started the actual supplied v88.1.4 code on a synthetic database, inserted a historical medicine-register record, a setting and an uploaded-file sentinel, then booted v88.1.5 twice against that same database.
- Both boots passed SQLite integrity checks. Table count changed from 54 to 57. Existing text, settings and the file were preserved exactly; no worker grants were silently added. An ungranted approved worker was denied the old medicine register after both boots.
- All six scene videos returned actual MP4 range responses; all four tier assets loaded.
- A local backup restored the database and file sentinel successfully; referenced missing-file detection returned exit 2 as designed.
- Initial boot and scheduled snapshots succeeded with no snapshot errors.

Receipts are in `validation/v88.1.5-upgrade-results.json` and `validation/v88.1.5-lifecycle-results.json`.

## Limits

The package declares Node >=22.12 and <23 and retains its existing runtime pin. The available execution runtime was Node 24.19.0, so repeat the gate on the declared Node 22 host before deployment. npm also emitted environment warnings about an inherited http-proxy setting; no test failed because of them.

Native-browser navigation to the local site is blocked in this environment. No native mobile, keyboard or screen-reader pass is claimed. Register merge behaviour is covered by unit tests and its API revision/permission checks are exercised, but the complete visual editor recovery flow still needs staging-browser validation. Availability controls and dialog focus need that same check.

Provider requests use a deterministic local Google-compatible stub. Real Google estimates, email/SMS delivery, payment/refund processing, AI integrations, cloud-backup destinations and the deployed version were not tested or changed. This is not a current rate-schedule or legal-compliance certification.

`docs/history/` contains older test and release receipts for traceability; they are not evidence for this release.
