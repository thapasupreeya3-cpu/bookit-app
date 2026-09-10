The Care Web v88.1.0 — brand-only release: the navy, gold and silver logo and palette on the v87.0.1 site.

Read STARTHERE.txt before uploading or deploying. This is a 22-file overlay for the
v87.0.1 repository: header and footer logo, favicon and app icons, social card,
accent palette (teal → navy, warm paper) in the page and in emails. No change to
layout, animation, videos, routes, rules, schema or data.

Install/check: npm ci --ignore-scripts && npm run check
Refresh generated release documents: npm run release:docs
Read-only existing-data triage on the authorised host:
  node scripts/review-existing-data.js /actual/path/to/bookit.db

See docs/IMPLEMENTATION-MATRIX.md, docs/RELEASE-NOTES.md and docs/TEST-RESULTS.md.
The release has not been pushed to GitHub or deployed to the live site.
