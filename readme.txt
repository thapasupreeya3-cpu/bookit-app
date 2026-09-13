The Care Web v88.4.3 — complete source package.

Extract The-Care-Web-v88.4.3-invoice-link-update-only.zip; merge its files at the repository root. Read STARTHERE.txt before updating. Preserve live runtime data.
This release implements launch-audit source corrections and updates the full user guide.
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
