# v88.2.10 test results

The complete `npm run check` gate passed with exit code 0 on Node 24.19.0 after regenerating the versioned inventories. The report and current receipts were added afterward; the payload manifest was regenerated and verified. Application code did not change after the final full gate.

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
| Document workspace | 17/17 passed |
| Next actions | 13/13 passed |
| Structural page audit | 54 explicit route entries; no unresolved literal links, duplicate static IDs or unlabelled static controls found |
| Asset preservation | 147 original image, media, font and binary files byte-identical to v88.2.9 |
| Status text contrast | Declared text/background pairs: 6.40 verified, 6.50 pending, 6.36 attention, 5.62 earlier record |
| Standalone preview | All 3 fictional states render using the production component in a VM; the preview script compiles |

## Current behavior exercised

Four new credential scenarios cover received-versus-verified summaries, mixed evidence and earlier rejected records, explicit checklist focus/scroll navigation without a route or data change, and shared identity/Training evidence explanations. Existing credential scenarios still cover the full 25-type catalogue, missing essentials, current versus expired/rejected/details-only evidence, file previews, type-specific fields, size limits, exact replacement targets, history, retries, removal requests and stale page/account guards.

The real API tests run against disposable local accounts and databases. The UI tests execute the actual application renderers and handlers using a minimal DOM model. The status preview uses fictional data and disables upload/account actions. This release changes presentation only: no backend, review/eligibility rules, schema or runtime dependencies changed.

## Limits

The DOM models are not browser rendering engines. Local browser access was blocked earlier in the session; no alternate browser route was used. The preview was not visually inspected in a browser. Deployed layout, focus behavior, enlarged text, screen readers and browser colour overrides remain unverified. Calculated contrast refers to the declared CSS pairs only. No live site was accessed or deployed, and no real messages or payments were sent.

The project declares Node 22; the available runtime was Node 24.19.0. Deployment CI should run the same gate on its declared runtime.

Current evidence is under `validation/v88.2.10-*`, including the complete check output, credential/Settings/navigation/workflow/Next actions results, structural page audit, asset comparison, status contrast calculations and preview execution receipt. Earlier receipts describe their own releases.
