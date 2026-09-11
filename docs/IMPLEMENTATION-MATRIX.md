# v88.1.5 audit resolution matrix

| Issue | Implementation | Verification |
| --- | --- | --- |
| R1: out-of-area cover with plan acknowledgement cannot be accepted | Persist the current review, recognise it for plan access, and recheck inside acceptance | Full in-area and out-of-area flows pass; expired review/offer, changed plan/visit, new leave, withdrawn eligibility and voided visits are rejected without assignment or evidence writes |
| R2: displayed travel differs from saved confirmation | Signed actor/request/visit-bound estimate proof and exact estimate storage; atomic occurrence and assignment evidence | Provider fields and checked time match; tampered proof, changed visit and bare boolean are rejected; series confirmations recorded |
| R3: every approved worker accesses shared medicine records | Office-only default; explicit expiring read/append/edit grants; optional participant scope; page/file/API permission parity | Ungranted worker denied; read cannot write; append cannot overwrite; another worker denied; revoked/expired grants denied; participant relationship and scope changes enforced |
| R4: register conflicts discard an unsaved edit | Keep working/base/latest versions; preserve editor on failure; safe three-way merge and manual conflict recovery; unload warning | Merge unit groups cover concurrent appends, row conflicts, deletion, independent tables and lost responses; native-browser interaction remains a staging gate |
| R5: malformed sleepover values and silent rounding | Strict type/number/range/quarter-hour validation before side effects; raw entry submitted; no automatic rounding | Invalid cases return specific hours errors and leave the entire booking plus shift-note rows unchanged; valid quarter-hour numeric/string values pass |
| R6: stale provenance and handover | Correct input name/hash, version, full-source instructions, current test receipt, complete payload hashes and historical document separation | Generated checks pass; final archive hashes, extraction and source payload verified |

## Earlier findings retained

F01 applicant restrictions remain and are strengthened by R3. F02 schedule enforcement remains before the area warning. F03 policy-upload and F04 register-size fixes are retained. F05/F08 are completed by R1/R2. F06 is completed by R5. F07/F13 are addressed in the current package. F09 planning-estimate language remains, and cache keys now reflect the requested traffic mode. F10 examples are neutrally labelled. F11 checks continue to measure the shipped design and run in CI. F12 boot snapshots remain deferred until initialization completes.

## Additional improvements

- Native availability calendars, time ranges, midnight controls and weekly preview.
- Explicit sleepover increments and active-support label.
- Accessible names on review and travel dialogs.
- Neutral illustrative example headings and removal of testimonial stars.

The current design and assets are preserved. Large-scale payload/module refactoring, live-provider verification and native-browser accessibility/performance certification are not claimed as completed by this release.
