# The Care Web — v88.2.4 PDF preview fix

11 September 2026 · Updates v88.2.3.

## Issue addressed

The screenshot shows an uploaded CPR PDF in the document list, with a failed embedded preview. The previous workspace embedded the raw PDF endpoint. That endpoint inherits `X-Frame-Options: DENY` and serves uploads with a CSP sandbox; the iframe also applied its own sandbox. The raw response was unsuitable for this browser-embedded preview. A document row being marked Verified does not prove its file can load or render.

## Changes

- PDFs in worker and participant verification files now load in a dedicated page viewer. It fetches the original bytes through the existing authenticated document endpoint and renders pages using locally bundled PDF.js.
- Added Previous/Next, page-number entry, zoom, fit-width, rotation, page text where available, and Download PDF. Open full size opens the same PDF viewer in its own tab.
- Added a direct Download original link for worker and participant evidence.
- Added readable errors for expired sessions, denied access, missing server files, unreadable PDFs, password-protected PDFs and request timeouts. Retry reloads the file.
- Image previews remain direct JPG/PNG previews with zoom; failed images now display an explanation instead of only a broken-image icon.
- Uploaded-file responses retain `DENY`, CSP sandbox, private/no-store caching and their existing owner/admin/helper/worker access rules. Only the trusted first-party viewer shell allows same-origin framing. No public file access was added.
- PDF scripts and XFA are not run. The PDF scripting engine is not bundled. The viewer renders one page at a time and bounds canvas size. Required fonts, character maps and image decoders are bundled, so the viewer does not send documents to an external service.
- Existing worker-document grouping, training separation, verification decisions and automations are retained. No schema migration is needed from v88.2.3; schema remains 88202.

## Install the small update

1. Extract the fix ZIP and merge its contents into the existing repository root. Replace matching files and keep unchanged folders. Include the new `public/vendor/pdfjs` folder and viewer assets.
2. Preserve the deployed database, document uploads, photos and configuration. No worker files are included in this source package.
3. Restart/redeploy through your usual process and refresh Admin → Verification. Confirm `/api/version` reports 88.2.4.
4. Open the CPR PDF shown in the screenshot. Check the page renders, then try page navigation, Open full size and Download original. Also check a JPG/PNG document.

An existing file that is missing from the server still needs to be restored or uploaded again. This update fixes the viewing path; it does not recreate lost source files.

## Validation

The full `npm run check` gate and all **42 verification scenarios** passed. See TEST-RESULTS.md for the final release gate. Tests cover both worker and participant PDFs, original-file permissions and download headers, viewer framing, locally served dependencies, page controls and load errors. A two-page synthetic PDF containing text, vector content and an embedded image was also rendered with the actual bundled PDF.js engine and native canvas; both pages were visually inspected.

The available Chrome browser refused the local test page with `ERR_BLOCKED_BY_CLIENT`. These are actual PDF renderer and application tests, not a successful end-to-end browser screenshot. Confirm the live preview after deployment. The user's live PDF and deployed server were not accessed.

Testing used Node 24.19.0; the project declares Node 22. Run the release gate on that deployment host as well. Runtime data and stored upload bytes were preserved in the upgrade check.

## Dependency provenance

Bundled Mozilla PDF.js **6.3.289**, with its licenses and file hashes. The npm tarball was checked against its published SHA-512 integrity value. No new server runtime dependency or npm install step was added for the viewer.

Primary references: [PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/) and [PDF.js 6.3.289 release](https://github.com/mozilla/pdf.js/releases/tag/v6.3.289). The default browser-plugin PDF embed has been replaced by the app's own canvas page viewer.
