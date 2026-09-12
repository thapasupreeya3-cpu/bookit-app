# v88.2.11 test results

The complete `npm run check` gate passed with exit code 0 on Node 24.19.0. This report and current receipts were added afterward; the payload manifest was regenerated and verified. Application code did not change after the final full gate.

| Check | Result |
| --- | --- |
| Syntax | 67 scripts compiled; 0 failures; includes 4 inline application scripts |
| API/database inventories | 369 routes; 83 tables; schema 88202 |
| Clash tests | 21 passed |
| Application smoke tests | All passed |
| Review unit assertions | 46 passed |
| Review integration | 25/25 passed |
| Graphics/asset contracts | 54/54 passed |
| Audit | 8 unit groups and API scenarios passed |
| Workflows and API checks | 42/42 passed |
| Verification/document previews | 46/46 passed |
| Settings | 11/11 passed |
| Navigation | 10/10 passed |
| Document workspace | 17/17 passed |
| Next actions | 13/13 passed |
| Booking calendar and request badge | 13/13 passed |
| Structural page audit | 54 explicit route entries; no unresolved literal links, duplicate static IDs or unlabelled static controls found |
| Asset preservation | 147 original image, media, font and binary files byte-identical to v88.2.10 |
| Preview | Standalone script compiled; production component tested with fictional worker and participant data |

## New API behavior exercised

Five new scenarios run against the actual server with disposable accounts and databases. They verify worker-only request counts and a real decline action, exclusion of past/cancelled/covered/voided records, participant and worker ownership, omission of care notes from the calendar payload, active helper booking scope and revocation, exact scoped booking lookup, Sydney daylight saving and overnight carry-in, exclusive midnight endings, leap-month boundaries, 405 bookings in one calendar range, an old focused record outside the list cap, and invalid dates/view/booking-ID rejection.

## New UI behavior exercised

Thirteen scenarios execute the production component in a VM with a minimal DOM model. They verify desktop/mobile counts, no worker badge on participant/admin accounts, server-time display, carry-over visits, exact record links, calendar arithmetic, arrow-key/day focus, month/week/date/Today controls, optional cancelled records, read-only display actions, polling cadence and hidden-page suppression, refresh after mutation, stale response/account isolation, timeouts/retry, escaped names, return-to-calendar selection and same-URL request refresh.

Existing tests retain coverage of booking acceptance, cancellation, completion and timesheet rules; account loading/navigation; document file actions and review status; and verification automation. The new calendar opens the existing booking controls instead of introducing separate approval or payment handlers.

## Limits

DOM models are not browser rendering engines. Local browser access was blocked earlier in this session; no alternate browser route was used. The interactive preview was not visually inspected in a real browser. Deployed layout, mobile/enlarged text, focus behavior, screen readers and browser colour overrides remain unverified. The preview uses fictional data and does not perform real account mutations.

The request badge polls approximately every 30 seconds while the site is visible. It is not an operating-system push notification. Calendar data refreshes on opening, date/view changes, Today or Refresh; the selected calendar is not continuously replaced in the background. Existing email and external-calendar behavior is unchanged. No live deployment, real messages or payment transactions were performed.

The project declares Node 22; the test runtime was Node 24.19.0. Deployment CI should run the same gate on its declared runtime. No schema or runtime dependencies changed.

Current evidence is under `validation/v88.2.11-*`: check output, workflow/API, calendar, Next actions, Credentials, Settings and navigation results, page audit, asset comparison and preview receipt. Earlier validation files describe their own releases.
