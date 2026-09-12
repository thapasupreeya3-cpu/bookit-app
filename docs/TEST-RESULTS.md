# v88.2.9 test results

The complete `npm run check` gate passed with exit code 0 on Node 24.19.0. Current receipts and this report were then added; the payload manifest was regenerated and verified. Application code did not change after the final full gate.

| Check | Result |
| --- | --- |
| Syntax | 65 scripts compiled; 0 failures; includes 4 inline application scripts |
| API/database inventories | 367 routes; 83 tables; schema 88202 |
| Clash tests | 21 passed |
| Application smoke tests | All passed |
| Review unit assertions | 46 passed |
| Review integration | 25/25 passed |
| Graphics/asset contracts | 54/54 passed |
| Audit | 8 unit groups and API scenarios passed |
| Workflows and API checks | 37/37 passed |
| Verification/document previews | 46/46 passed |
| Settings | 11/11 passed |
| Navigation | 10/10 passed |
| Document workspace | 13/13 passed |
| Next actions | 13/13 passed |
| Structural page audit | 54 explicit route entries; no unresolved literal links, duplicate static IDs or unlabelled static controls found |
| Asset preservation | 147 original image, media, font and binary files byte-identical to v88.2.8 |
| Standalone preview | Outer and frame scripts compile; all 5 synthetic examples render in a VM |

## New behavior exercised

The Next actions tests execute the shipped renderer and event handlers in a DOM model. They exercise document/training grouping, preservation of individual notes and deadlines, duplicate document prompts, visible overdue/today groups, site-date boundaries, collapsed office checks, appropriate record links, visible urgent cover, nonduplicated upcoming visits, completed/empty states, coordinator email scope, escaped task content, compact office assignment controls, one office queue fetch, the More tools menu and truthful resend feedback.

Two additional disposable API scenarios confirm that details-only documents do not clear worker upload prompts, real uploads do clear them, authorised upcoming visits include only the correct counterpart, site-time metadata is returned and office queue rows carry the person's role. Existing tests retain coverage of Credentials file actions, Settings loading, scroll resets, document viewers, verification automation and other workflows.

The standalone preview uses the production Next actions component with five invented sample accounts. Its controls change sample data and frame width. Account actions are intercepted and no server requests are made. It is a review artifact, not evidence of real-browser rendering or production account state.

## Limits

The DOM models are not browser rendering engines. Local browser preview access was blocked earlier in the session; no alternative browser path was used. Layout, real-browser focus behavior, enlarged text and screen-reader behavior still need confirmation on the deployed site. No live site or repository was accessed or deployed. No real emails, SMS messages or payment transactions were sent.

The project declares Node 22; the available test runtime is Node 24.19.0. Deployment CI should run the same gate on the declared runtime. No runtime dependencies or database schema changed. This release changes task presentation, document-evidence prompts and scoped journey response metadata, as described in the changelog.

Current evidence is in `validation/v88.2.9-check-output.txt`, `validation/v88.2.9-next-actions-results.json`, `validation/v88.2.9-credentials-results.json`, `validation/v88.2.9-navigation-results.json`, `validation/v88.2.9-settings-results.json`, `validation/v88.2.9-process-results.json`, `validation/v88.2.9-page-audit.json` and `validation/v88.2.9-asset-preservation.json`. Older receipts describe their own releases.
