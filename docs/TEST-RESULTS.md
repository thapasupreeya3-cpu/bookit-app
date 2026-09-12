# Validation — The Care Web v88.3.0

Executed in this workspace using Node 24.19.0 and disposable synthetic accounts/databases. The declared Node 22 runtime was unavailable. No production database, personal live file, external email provider, real payment or regulator submission was used.

| Check | Result |
|---|---|
| npm test (full automated suite) | Passed; includes all suites below |
| Booking clashes | 21 passed |
| Smoke / access / invoicing / exports | All passed |
| Review unit / integration | 46 assertions and 25 integration scenarios passed |
| Graphics / source conventions | Passed |
| Existing audit fixes | 8 unit groups and integration scenarios passed |
| Workflows | 42 passed |
| Verification / local document viewers | 46 passed |
| Settings | 11 passed |
| Navigation | 10 passed |
| Credentials | 17 passed |
| Next actions | 13 passed |
| Calendar / badge | 13 passed |
| New launch regression | 22 passed; rerun after the final operational-alert changes |
| Syntax | 72 scripts / 4 inline application scripts compiled; zero errors |
| Runtime inventory | 381 registered routes; 91 migrated tables; generated inventory verification passed |
| Deterministic handover documents | Verification passed |
| Upgrade from 88.2.12 | Two consecutive boots; 83 → 91 tables; synthetic account/document/reviewer/settings preserved; upload byte identical; integrity and foreign-key checks passed |
| HTML guide | 13 new current-workflow sections, unique anchors and internal links checked; embedded script compiled |

New scenarios cover reset/MFA assurance and replay, photo permissions/cache, evidence absence/staleness, actual weak secrets, awareness/harm/holiday reporting obligations, calendar void tombstones, urgent/resolved email queue rules, guarded boundary billing, partial/idempotent receipts, independently approved reversals, private owned operations, disabled unapproved AI, stale intake, incomplete backups, changed support arrangements, itemised billing revisions, actual API-backed office panel rendering and runtime route discovery.

Browser navigation to the local site returned ERR_BLOCKED_BY_CLIENT. The interface harness renders HTML strings against real APIs; it is not a browser layout or assistive-technology test. No real-browser pass, production performance, external-service delivery/settlement, independent penetration test, regulatory/financial approval or real-user research is claimed. Complete LAUNCH-ACCEPTANCE.md in authorised staging.

Package integrity/hash and overlay equivalence are recorded beside the delivered ZIPs. Per-suite receipts are in validation/v88.3.0-*. Existing older receipts remain historical.
