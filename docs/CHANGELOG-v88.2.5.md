# The Care Web — v88.2.5 HTML previews and compact controls

12 September 2026 · Updates v88.2.4.

## Fixed

- Accepted HTML agreements and consents now use the document viewer. The previous update fixed PDFs but still embedded raw HTML responses, which were blocked by the server's framing protection.
- The support-plan tab uses the same HTML preview path; plan access remains office-only.
- The viewer checks the response's file type. HTML no longer receives PDF controls or PDF-specific instructions. Unreadable or unsupported files display an explanation and a download option.
- A failure to extract PDF text no longer hides an otherwise successfully rendered page.

## More compact

- One PDF toolbar with 28px desktop controls, small page-number entry, arrow buttons, zoom and Fit. Touch controls remain 40px.
- Rotation and page text moved into the three-dot menu. Page text opens only when requested.
- Retry appears only after a loading or rendering error. The duplicate successful-load status row is visually hidden but remains announced to screen readers.
- Single-page PDFs omit the disabled previous/next buttons.
- Embedded viewers use the outer Download action; the duplicate internal download is hidden. Full-size viewers retain their own Download action.
- Shorter Open/Download header, tighter document rows and category headings, filenames on one line with a full-name tooltip, and explanatory text and missing-item requests collapsed initially.
- PDF and HTML viewers fill the available preview height without an extra outer scrollbar. Zooming a PDF above Fit can still require horizontal scrolling.

## Access and stored records

The viewer fetches through the existing authenticated file endpoints. Originals keep their existing permissions, private caching and framing protections. HTML is displayed in an empty-sandbox child frame with a leading restrictive content policy: scripts, forms, popups and access to the app are disabled; outside resources are blocked. Inline document styles and embedded images are retained, and the two local Care Web logos are allowed. The generated Print/Back toolbar is hidden in this read-only preview. Original downloads remain unchanged.

No acceptance dates, accepted versions, verification decisions, reminders, worker documents or participant documents are rewritten. No new dependency or schema migration; schema remains 88202.

## Install the small update

1. Extract `The-Care-Web-v88.2.5-preview-fix-only.zip` and merge its contents into the existing **v88.2.4** repository root. Replace matching files and keep other folder contents. Upload the extracted files, not the ZIP itself.
2. Preserve the deployed database, private uploads, photos and configuration. Restart/redeploy using the usual process, then refresh the verification page. `/api/version` should report 88.2.5.
3. Open a Service Agreement, Privacy consent and Medication consent HTML copy, then a support plan, a PDF and a JPG/PNG. Check Open, Download and the compact PDF controls.

If updating an earlier release, use the cumulative all-updates ZIP instead. See `UPDATE-INSTRUCTIONS.txt` in each package.

## Validation and limits

The full `npm run check` gate and all **46 verification scenarios** passed. Two upgrade boots preserved records and uploaded bytes; 154 existing assets and viewer resources are byte-identical. See `TEST-RESULTS.md` and the packaged validation receipts. The application API and frontend harness exercise real generated agreement content, permission checks, viewer routing, isolation attributes, error handling and compact control behavior. These automated checks do not establish browser rendering or CSP enforcement visually. The Cloud Chrome URL policy blocked the synthetic preview test in this environment; confirm the HTML preview on the deployed site after applying this update. The supplied screenshot confirms the previous PDF renderer works on the user's site; that renderer and its bundled resources are unchanged here.

Security design references: [MDN iframe srcdoc isolation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc) and [W3C Content Security Policy inheritance](https://www.w3.org/TR/CSP/#security-inherit-csp). The empty iframe sandbox is the isolation boundary; the leading CSP further restricts allowed resources.
