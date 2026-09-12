# v88.2.4 test results

`npm run check` passed with exit code 0 on Node 24.19.0. After these results were recorded, final release documents, inventories and package hashes were checked again. Application code did not change after the full regression gate.

| Check | Result |
| --- | --- |
| Syntax | 59 scripts compiled; 0 failures; 4 inline scripts included |
| Inventories | 367 routes; 83 tables; schema 88202 |
| Clash tests | 21 passed |
| Application smoke tests | Passed |
| Review unit assertions | 46 passed |
| Review integration scenarios | 25/25 passed |
| Graphics checks | 54/54 passed |
| Audit unit groups and API scenarios | 8 unit groups passed; API scenarios passed |
| Existing workflow scenarios | 32/32 passed |
| Verification scenarios | 42/42 passed, including 6 new PDF viewer scenarios |
| Actual PDF rendering | Both pages of a synthetic text/vector/image PDF rendered with bundled PDF.js 6.3.289 and native canvas |
| Upgrade from v88.2.3 | Two consecutive boots passed; 83 tables retained; records and uploaded bytes preserved |
| Database integrity and foreign keys | Passed after both upgrade boots |
| Existing artwork, media, fonts and vendor files | 119 files byte-identical to v88.2.3; new PDF viewer resources added |
| Native browser navigation | Blocked by the test environment: ERR_BLOCKED_BY_CLIENT |

## PDF regression coverage

- Worker upload through the real API, exact stored bytes, raw upload sandbox and DENY framing, private/no-store response, attachment download, and denied access from a different account.
- Participant PDF access and download retain existing permission rules.
- The authenticated viewer accepts only worker/participant scopes and positive numeric document IDs. The trusted shell allows same-origin framing; the main app and raw uploaded responses keep DENY.
- Main/worker JavaScript modules, font files, character maps and WASM decoders are served locally with suitable MIME types.
- Viewer page navigation, zoom, rotation, fit width, page text and download URLs exercised in the frontend harness.
- Missing-file, permission, expired-session, non-PDF, encrypted and unreadable-file errors exercised with a retry state.
- Worker and participant PDF panels embed the new viewer. JPG/PNG evidence keeps direct image preview and an image-error message.

## Actual rendering evidence

The bundled engine rendered a 595 × 842 two-page synthetic PDF. Page 1 contained text and vector content; 5,923 pixels were non-white. Page 2 contained an embedded image and text; 177,795 pixels were non-white. Text was extracted from both pages. The output PNGs were visually inspected locally. This confirms real PDF parsing and canvas rendering rather than only an HTTP success or a stubbed renderer.

`validation/v88.2.4-pdf-render-results.json` records this test. The renderer was exercised with a native Node canvas; this was not an end-to-end browser test. The frontend control tests use a controlled renderer interface, while the separate rendering run uses the actual bundled PDF.js code.

Other receipts are in `validation/v88.2.4-check-output.txt`, `validation/v88.2.4-verification-results.json`, `validation/v88.2.4-upgrade-results.json`, `validation/v88.2.4-pdfjs-package.json`, and `validation/v88.2.4-browser-result.txt`.

## Limits and post-deployment check

The available Chrome browser could not navigate to the local synthetic fixture because the environment returned ERR_BLOCKED_BY_CLIENT. Verify the same CPR file from the user's screenshot after deploying: initial page, page controls, full-size view, download, and a JPG/PNG. No live worker file was accessed, and no live account data or messages were changed.

The repository declares Node 22, while this environment provides Node 24.19.0. Repeat the release gate on the deployment runtime. There is no new server dependency or schema migration. The ZIP contains application source and bundled viewer assets, not the deployment's private uploaded files.
