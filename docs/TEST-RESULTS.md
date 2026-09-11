# v88.2.3 test results

The full `npm run check` release gate passed with exit code 0 on Node 24.19.0. Documentation and package hashes were refreshed and verified again after recording these results; application code was unchanged.

| Check | Result |
| --- | --- |
| JavaScript compilation | 56 scripts, 0 failures; includes 4 inline application scripts |
| Generated inventories | 366 registered routes; 83 database tables |
| Clash tests | 21 passed |
| Application smoke tests | Passed |
| Review unit assertions | 46 passed |
| Review integration scenarios | 25/25 passed |
| Graphics checks | 54/54 passed |
| Audit unit groups | 8 passed |
| Audit API scenarios | Passed |
| Existing workflow scenarios | 32/32 passed |
| Verification scenarios | 36/36 passed, including 6 new document regression scenarios |
| Upgrade from v88.2.2 | Passed on two consecutive boots; 83 tables retained |
| Records and uploaded file preservation | Existing person, profile, document, ownership and setting records retained; uploaded bytes identical |
| Database integrity and foreign keys | Passed after each upgrade boot |
| Existing media, fonts and vendor assets | 119 files byte-identical to v88.2.2 |

## Document regression coverage

- Uploaded real synthetic files through the worker upload API for 12 types across every category: passport, driver licence, Medicare, visa, screening, WWCC, orientation, First Aid, CPR, qualification, resume and a labelled engagement agreement under Other.
- Verified every original-file endpoint was accessible to the office and denied to a different worker.
- Completed a training module through the actual quiz API. Its generated certificate appeared in Training; uploaded external certificates remained in Worker documents, and queue counts excluded the generated record.
- Retained unknown legacy types, misleading module-like titles, metadata-only rows, and uploaded files referenced by old completion records. A cross-person completion link did not hide evidence.
- Exercised the frontend with real API responses: category headings, filenames, missing statuses, details-only warnings, preselected document requests and separate module certificates.
- Checked a training-only worker's explicit zero-upload message and missing document catalogue.
- Verified immediate rebuilding of old mixed-document queue counts and preserved participant document behaviour.

Evidence: `validation/v88.2.3-check-output.txt`, `validation/v88.2.3-verification-results.json`, `validation/v88.2.3-upgrade-results.json`, and `validation/v88.2.3-asset-preservation.json`.

## Limits

Tests used isolated synthetic accounts, temporary databases and local files; no live applicant data or external messages were used. The deployed database and host were not accessed. The standalone preview contains labelled examples only.

Native browser rendering, keyboard layout and PDF preview interaction need staging verification. Local browser access was blocked in the preceding verification run; this release does not claim a successful visual browser check. The project declares Node 22; repeat the release gate on that deployment runtime. No runtime or dependency change was introduced.
