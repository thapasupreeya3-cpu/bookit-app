# v88.2.6 test results

The full `npm run check` gate passed with exit code 0 on Node 24.19.0. Final release documentation and validation receipts were added afterward, followed by a regenerated manifest and final release integrity check. Application code did not change after the full gate.

| Check | Result |
| --- | --- |
| Syntax | 60 scripts compiled; 0 failures; 4 inline application scripts included |
| Inventories | 367 routes; 83 tables; schema 88202 |
| Clash tests | 21 passed |
| Application smoke tests | Passed |
| Review unit assertions | 46 passed |
| Review integration | 25/25 passed |
| Graphics | 54/54 passed |
| Audit | 8 unit groups and API scenarios passed |
| Existing workflows | 32/32 passed |
| Verification and document previews | 46/46 passed |
| New Settings scenarios | 11/11 passed |
| Upgrade from v88.2.5 | Two consecutive boots preserved records, uploaded bytes and all 83 tables |
| Database integrity and foreign keys | Passed after both upgrade boots |
| Existing artwork, media, fonts and vendor resources | 154 files byte-identical to v88.2.5 |

## Settings coverage

The suite executes the shipped account renderer, availability helper, and worker-section renderer functions against real responses from a disposable local server. Small DOM containers model the rendering targets; these are functional frontend/API tests, not a full browser DOM or visual test.

1. Worker Settings opens at `#/account`, without defining any admin render variables, and fetches and renders the real availability form.
2. Availability, Credentials, Earnings, Training, Jobs, Notifications, Accessibility, Security and Help render their corresponding content and API results.
3. A section link containing query parameters selects the correct section.
4. Worker Profile still displays personal details, tier and visibility.
5. Participant, coordinator and admin Settings lists render; admin's default email section fetches its preferences.
6. Signed-out state replaces loading with a login prompt.
7. A thrown section-renderer error displays Retry and retains navigation; Retry recovers successfully.
8. A simulated stalled request reaches the 15-second deadline; a late result cannot replace the timeout message.
9. Delayed responses cannot overwrite a new section or a signed-out view.
10. Email preferences recover after a failed read; optional changes persist while mandatory emails remain on.
11. Worker details save through the real endpoint and remain escaped when rendered.

The old v88.2.5 Settings renderer was also executed in a controlled harness: it raised `renderSequence is not defined` and left the initial Loading placeholder unchanged. The reproduction is retained in `validation/v88.2.6-reproduction.json`.

## Limits

The Cloud browser URL policy blocked the local/synthetic preview workflow earlier in this session. No further browser workaround was attempted. This release has no live browser screenshot or deployed-account check. Confirm worker Settings after deployment.

Testing used Node 24.19.0; the repository declares Node 22. Run the release gate on the deployment runtime too. No server dependency, endpoint, database schema, live account or private uploaded file was changed.

Receipts: `validation/v88.2.6-check-output.txt`, `validation/v88.2.6-settings-results.json`, `validation/v88.2.6-verification-results.json`, `validation/v88.2.6-upgrade-results.json`, and `validation/v88.2.6-asset-preservation.json`.
