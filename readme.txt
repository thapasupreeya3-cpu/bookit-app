The Care Web v88.4.17 — current-update-only ZIP.

Apply over v88.4.16. Extract The-Care-Web-v88.4.17-ongoing-routines-update-only.zip; merge its files at the repository root. Read UPDATE-INSTRUCTIONS.txt before updating. Preserve live runtime data.
This release adds Care routine inside Bookings, date-by-date recurring preview, skipped dates and duplicate-request recovery. The full user guide is updated.
NSW holidays and ordinary invoicing are automatic. Independently reviewed payroll
components remain required; preparing/exporting payroll does not transfer wages.
PDF/HTML previews and earlier verification automations are retained.
Configure private billing,
email, payroll cutover and any optional document assistance before use.

Install/check: npm ci --ignore-scripts && npm run check
Refresh generated documents: npm run release:docs

See docs/RELEASE-NOTES.md, docs/IMPLEMENTATION-MATRIX.md and docs/TEST-RESULTS.md.
The package is a reviewable source update. Live deployment/provider activation
remains separate. See docs/PAYMENT-SETUP-v88.4.0.md.
