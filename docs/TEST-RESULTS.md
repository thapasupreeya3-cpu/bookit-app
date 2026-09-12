# v88.2.7 test results

The full `npm run check` gate passed with exit code 0 on Node 24.19.0. Final documentation and validation receipts were added afterward, then the release manifest was regenerated and checked. Application code did not change after the full gate.

| Check | Result |
| --- | --- |
| Syntax | 61 scripts compiled; 0 failures; includes 4 inline application scripts |
| API/database inventories | 367 routes; 83 tables; schema 88202 |
| Clash tests | 21 passed |
| Application smoke tests | Passed |
| Review unit assertions | 46 passed |
| Review integration | 25/25 passed |
| Graphics/asset contracts | 54/54 passed |
| Audit | 8 unit groups and API scenarios passed |
| Existing workflows | 32/32 passed |
| Verification and document previews | 46/46 passed |
| Settings | 11/11 passed |
| New navigation/upload scenarios | 10/10 passed |
| Page route audit | 54 explicit entries plus dynamic route families dispatch to existing pages |
| Static source audit | No duplicate static IDs, unlabelled static form controls or unresolved literal internal route families found |
| Original media/font/binary assets | 147 image, video, font, PDF map/font and binary files byte-identical to v88.2.6 |

## New regression coverage

The navigation suite executes the shipped functions in a DOM harness. It verifies the primary link list for visitors, workers, participants, coordinators and admins; the short role-specific account menus; all route dispatches; the credential upload destination; PDF/image link selection; keyboard menu open/close/focus behavior; failed booking/credential load recovery; uploads without the optional assistance service; partial-success retry; and changing page/account while a file is being prepared.

The Settings suite executes real renderer functions with responses from a disposable local server. Existing workflow tests similarly render worker, participant and office panels against scoped API responses. Neither harness is a browser rendering engine.

## Limits

Browser access to the local/synthetic app was blocked earlier in this session. No workaround or further browser attempt was made. Header geometry, font scaling, focus behavior in a real browser, screen-reader behavior and every possible page interaction have not been visually certified. Follow the focused deployed-site acceptance checks in `docs/SITE-USABILITY-REVIEW.md`.

The repository declares Node 22; the available test runtime is Node 24.19.0. The deployment CI should also run the release gate on its declared runtime. No real emails, SMS, payment transactions or live account mutations were made. Backend source, schema and runtime dependencies are unchanged.

Evidence is in `validation/v88.2.7-check-output.txt`, `validation/v88.2.7-navigation-results.json`, `validation/v88.2.7-settings-results.json`, `validation/v88.2.7-page-audit.json` and `validation/v88.2.7-asset-preservation.json`. Older receipts identify their own release and are not new test results.
