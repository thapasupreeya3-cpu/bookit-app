# v88.2.2 test results

The complete `npm run check` release gate passed with exit code 0 on Node v24.19.0. This command includes syntax, inventory and release-document checks, package hashes, and every test suite listed below.

| Check | Result |
| --- | --- |
| JavaScript compilation | 55 scripts, 0 failures; includes 4 inline application scripts |
| Generated inventories | 366 registered routes; 83 database tables |
| Clash tests | 21 passed |
| Application smoke tests | Passed |
| Review unit assertions | 46 passed |
| Review integration scenarios | 25/25 passed |
| Graphics checks | 54/54 passed |
| Audit unit groups | 8 passed |
| Audit API scenarios | Passed |
| Existing workflow scenarios | 32/32 passed |
| Verification scenarios | 30/30 passed, including 14 new automation scenarios |
| Upgrade from v88.2.1 | Passed twice; 79 to 83 tables, existing records and uploaded bytes preserved |
| Database integrity and foreign keys | Passed after each upgrade boot |
| Existing media, fonts and vendor assets | 120 files byte-identical to v88.2.1 |

The new scenarios cover office-only permissions, settings conflicts, workload/role/capacity-aware assignment, business-day deadlines, manual ownership, correct recruitment task ownership, approved combined requests, duplicate submissions, delivery-aware reminder stages, completion and escalation, stop/closure behaviour, plan snapshots and exact changes, legacy-plan compatibility, in-place plan changes, source-bound extraction suggestions, live-update draft preservation, selective queue invalidation, and a final outbox recheck with a capturing transport.

The cache test uses an instrumented summary function to verify that an unchanged second queue read rebuilds no people, a single changed person rebuilds one, and policy/time invalidation rebuilds the relevant population. It is a regression check, not a claimed production timing benchmark.

## Evidence

- `validation/v88.2.2-check-output.txt` — complete release gate output.
- `validation/v88.2.2-check-receipt.json` — command, runtime and scope.
- `validation/v88.2.2-verification-results.json` — individual verification results.
- `validation/v88.2.2-upgrade-results.json` — two upgrade boots and preservation checks.
- `validation/v88.2.2-asset-preservation.json` — asset preservation result.
- `RELEASE-FILES.json` — final package payload hashes. After adding final documentation and receipts, syntax, inventories, release documents and hashes were checked again; application code was unchanged.

## Remaining staging checks

The browser environment rejected the local preview with `net::ERR_BLOCKED_BY_CLIENT`. Desktop/mobile rendering, keyboard focus, screen-reader announcements and actual PDF viewing therefore have not been confirmed in a native browser here. The standalone preview is synthetic and cannot send messages or change real records.

Tests ran on Node v24.19.0; the repository declares Node 22. Repeat the release gate on that deployment runtime. No deployed site, live database, real applicant messages, government-register connection or external extraction-provider round trip was used. Email and optional extraction require configuration and authorised staging tests. Queueing does not prove inbox delivery; the existing outbox's transport limitations remain.
