# v88.2.5 test results

The full `npm run check` release gate passed on Node 24.19.0. Final documentation and packaged receipts were followed by regenerated manifests and a final release integrity check.

| Check | Result |
| --- | --- |
| Syntax | 59 scripts compiled; 0 failures; 4 inline scripts included |
| Inventories | 367 routes; 83 tables; schema 88202 |
| Clash tests | 21 passed |
| Application smoke tests | Passed |
| Review unit assertions | 46 passed |
| Review integration | 25/25 passed |
| Graphics | 54/54 passed |
| Audit | 8 unit groups and API scenarios passed |
| Existing workflows | 32/32 passed |
| Verification | 46/46 passed, including 4 added HTML/compact-viewer scenarios |
| Upgrade from v88.2.4 | Two consecutive boots preserved records, uploaded bytes and all 83 tables |
| Database checks | Integrity and foreign keys passed after both upgrade boots |
| Existing artwork, media, fonts and vendor resources | 154 files byte-identical to v88.2.4 |
| Browser visual check | Not completed: Cloud Chrome URL policy blocked the synthetic fixture |

## Focused coverage

- Service Agreement, Privacy consent and Medication consent are generated through the real acceptance API. The returned HTML reaches the viewer unchanged after its isolation prefix. Stored accepted versions and original file bytes remain unchanged after reading and downloading.
- Anonymous/unrelated users cannot read the HTML document; participant owners and admins retain access. The support-plan viewer and underlying plan endpoint remain office-only.
- Original responses retain DENY framing. The trusted viewer shell alone permits same-origin framing and denies child URL navigation with `frame-src 'none'`.
- The HTML child has an empty sandbox and a restrictive CSP before the original markup. The tests inspect the produced isolation attributes and policy, rather than claiming that a mocked DOM enforces browser security.
- HTML does not load PDF.js or show PDF controls. HTML full-size view retains Download; embedded view uses the outer download action.
- PDFs retain page navigation, fit, bounded zoom, rotation and text extraction. Single-page navigation is hidden; errors expose Retry; successful rendering hides Retry and the duplicate status row. Page-text extraction failure preserves the rendered page.
- Text controls open/close and return focus to the More control. Images keep direct preview and their existing failure message.
- Frontend panel rendering is exercised with real API data. PDF renderer interactions use a controlled interface in these tests. The bundled PDF.js resources are unchanged from v88.2.4, whose separate native-canvas rendering receipts remain in `validation/`.

## Limits

The browser rejected the synthetic fixture URL, so this release has no successful browser screenshot, visual responsive check or observed CSP-enforcement test. No workaround was attempted after that rejection. The user's screenshot shows the v88.2.4 PDF renderer working on their deployed site. HTML previews and compact controls must still be checked there after deployment.

Testing used Node 24.19.0; the project declares Node 22. Run the release gate on that deployment runtime. No new npm dependency or schema migration was introduced. No live accounts, private worker files or deployed data were accessed or changed.

Receipts: `validation/v88.2.5-check-output.txt`, `validation/v88.2.5-verification-results.json`, `validation/v88.2.5-upgrade-results.json`, `validation/v88.2.5-asset-preservation.json`, and `validation/v88.2.5-browser-result.txt`.
