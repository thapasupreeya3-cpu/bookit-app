# v88.2.8 test results

The complete `npm run check` gate passed with exit code 0 on Node 24.19.0. Current receipts and this report were then added; the payload manifest was regenerated and verified. Application code did not change after the final full gate.

| Check | Result |
| --- | --- |
| Syntax | 63 scripts compiled; 0 failures; includes 4 inline application scripts |
| API/database inventories | 367 routes; 83 tables; schema 88202 |
| Clash tests | 21 passed |
| Application smoke tests | All passed |
| Review unit assertions | 46 passed |
| Review integration | 25/25 passed |
| Graphics/asset contracts | 54/54 passed |
| Audit | 8 unit groups and API scenarios passed |
| Workflows and new replacement/contact API checks | 35/35 passed |
| Verification/document previews | 46/46 passed |
| Settings | 11/11 passed |
| Navigation | 10/10 passed |
| Document workspace | 13/13 passed |
| Structural page audit | 54 explicit route entries; no unresolved literal links, duplicate static IDs or unlabelled static controls found |
| Asset preservation | 147 original image, media, font and binary files byte-identical to v88.2.7 |

## New behavior exercised

The document tests execute the shipped component and its event handlers in a DOM model. They check all 25 dropdown options, named missing essentials, unique identity points, rejected/expired/details-only states, real platform completion separation, correct request types, PDF/image preview destinations, per-type form fields, PDF size limits and the photo resize path, exact replacement target/type, history retention, retry after upload failure, saved-but-refresh-failed feedback, removal confirmation, office-removal request references, and stale page/account guards.

Navigation tests execute registered routes, role-based primary links, the referral menu shortcut, mobile keyboard handling, legacy Settings redirects, the absence of duplicate personal setup tabs, top-of-page navigation and cancellation of delayed section jumps after leaving. Settings renderers and workflow panels use real responses from a disposable local API.

Backend tests verify that a replacement cannot name another worker's file or a different document type; the verified original is retained and the new file remains submitted. The compliance record identifies both files. Verified evidence cannot be directly deleted; an unverified removal is owner-scoped. Contact-only saves retain current profile values and existing emergency-contact fields. Document origins are matched to actual module completion links.

## Limits

The DOM models are not browser rendering engines. Local browser preview access was blocked earlier in the session; no alternative browser path was used. Layout, real-browser focus behavior, enlarged text and screen-reader behavior still need confirmation on the deployed site. No live site or repository was accessed or deployed. No real emails, SMS messages or payment transactions were sent.

The project declares Node 22; the available test runtime is Node 24.19.0. Deployment CI should run the same gate on the declared runtime. No runtime dependencies or database schema changed. Backend document metadata/replacement validation, contact-save handling and task destinations changed as described in the changelog.

Current evidence: `validation/v88.2.8-check-output.txt`, `validation/v88.2.8-credentials-results.json`, `validation/v88.2.8-navigation-results.json`, `validation/v88.2.8-settings-results.json`, `validation/v88.2.8-process-results.json`, `validation/v88.2.8-page-audit.json` and `validation/v88.2.8-asset-preservation.json`. Older receipts describe their own releases.
